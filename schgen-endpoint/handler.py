"""
HuggingFace Inference Endpoint handler for the SchGen schematic generator.

Serves Sirkit's /api/schematic/cross-verify contract: accepts {"prompt": ...}
and returns {"code": "<python DSL>"} — the SchGen schematic program.

What this does that a stock text-generation handler does NOT:
  1. Loads the base model AND attaches the fine-tuned SchGen LoRA adapter.
  2. Builds the SchGen chat prompt (system contract + user request) and applies
     the model's chat template (gpt-oss "harmony" format).
  3. Keeps special tokens and extracts the `final` channel — gpt-oss emits an
     `analysis` channel then a `final` channel; only the latter is the answer.
  4. Returns clean Python in {"code": ...}.

Deployment notes:
  - GPU: gpt-oss-20b is MXFP4. On a Hopper GPU (H100) it runs MXFP4 natively —
    load as-is (this file's default). On non-Hopper, either deploy a pre-merged
    bf16 checkpoint (~48 GB, needs an 80 GB GPU) or set SCHGEN_LOAD_4BIT=1 (needs
    bitsandbytes; slower cold start). H100 is the simplest.
  - Symbol selection is OMITTED here (SchGen's separate LLM step that grounds the
    model on specific library symbols). The fine-tune still emits valid DSL
    without it — good enough for a cross-check second opinion. To add it later,
    pass a prebuilt `symbol_context` string in the request body.
"""

import os
import re
import torch
from transformers import AutoTokenizer, AutoModelForCausalLM
from peft import PeftModel

BASE_MODEL = os.environ.get("SCHGEN_BASE_MODEL", "openai/gpt-oss-20b")
ADAPTER = os.environ.get("SCHGEN_ADAPTER", "microsoft/SchGen")
DEFAULT_MAX_NEW_TOKENS = int(os.environ.get("SCHGEN_MAX_NEW_TOKENS", "8192"))

# SchGen's system contract (from SchGen/config.py prepare_context). The one-shot
# example is dropped — the LoRA fine-tune bakes in the output format — but the
# function contract and coordinate rules materially shape the generated DSL.
SYSTEM_PROMPT = """
You need to complete a user request by outputting executable Python code that generates a KiCad schematic file corresponding to the request. Generate the Python code to edit the schematic file using the KiCad Python API. YOU MUST MAKE SURE THE FINAL CODE ALIGN WITH THE THINKING PROCESS.
###
You have the following functions available to you and can create new functions based on them:
- add_schematic_symbol(symbol_lib, symbol_name, pos_x, pos_y, reference, value, rotation=0, mirror=None): Add a component symbol from a KiCad library. pos_x/pos_y are the center in mm; reference is the unique id ("U1", "R1"); value is e.g. "10K"/"100nF" (no spaces, no "()", no "TBD").
- get_pin_location(symbol_ref, pin_name): Get a pin's location. For a power symbol or label, pin_name is "1".
- add_label(label_pos, label_text, label_ref, label_type="input", text_orient="left"): Add a label. label_pos is [x, y] in mm; label_text e.g. "SDA"; label_ref is a unique id e.g. "SDA_0".
- connect_pins(sym_a, pin_a, sym_b, pin_b): Connect pin_a of sym_a to pin_b of sym_b. Labels are symbols with one pin "1".
- write_out_all_wires(): Write out all wire connections.
###
NOTES:
1. Mind spatial placement — reasonable positions and ample spacing so bounding boxes do not overlap.
2. The sheet is 210x297 mm (A4), X-Y axes, origin [0,0] at bottom-left; keep the circuit centered using integer offsets.
3. Check the symbol context for size, orientation, and pin locations (symbol center at (0,0), Y axis up).
4. Use existing references and correct pin names from the symbol context.
5. Output valid Python with correct indentation; comments start with #.
###
CRITICAL OUTPUT FORMAT: Your final answer must be ONLY the executable Python code — no markdown, no tables, no prose, no explanation. Begin directly with `from modules.kicad_sch_interface import *` and emit the add_schematic_symbol / add_label / connect_pins / write_out_all_wires calls. Do NOT describe the design in words.
"""

_FINAL_RE = re.compile(
    r"<\|channel\|>\s*final\s*<\|message\|>(.*?)(?:<\|channel\|>|<\|end\|>|<\|return\|>|$)",
    re.S | re.I,
)


def _extract_final_python(decoded: str) -> str:
    """Pull the `final` channel out of a gpt-oss response and isolate the code."""
    m = _FINAL_RE.search(decoded)
    seg = m.group(1) if m else decoded
    seg = re.sub(r"(?:\s*<\|return\|>\s*)+$", "", seg, flags=re.S).strip()
    # If the model wrapped the code in prose, prefer the fenced code block.
    fence = re.search(r"```(?:python)?\s*(.*?)```", seg, flags=re.S | re.I)
    if fence:
        return fence.group(1).strip()
    seg = re.sub(r"^\s*```(?:python)?\s*|\s*```\s*$", "", seg, flags=re.S).strip()
    return seg


class EndpointHandler:
    def __init__(self, path=""):
        self.tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL)

        load_kwargs = dict(torch_dtype="auto", device_map="auto")
        if os.environ.get("SCHGEN_LOAD_4BIT") == "1":
            from transformers import BitsAndBytesConfig
            load_kwargs["quantization_config"] = BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_quant_type="nf4",
                bnb_4bit_use_double_quant=True,
                bnb_4bit_compute_dtype=torch.bfloat16,
            )

        base = AutoModelForCausalLM.from_pretrained(BASE_MODEL, **load_kwargs)
        # The whole point: attach the fine-tuned SchGen adapter (kept attached;
        # cannot be merged into 4-bit weights).
        self.model = PeftModel.from_pretrained(base, ADAPTER)
        self.model.eval()

        if self.tokenizer.pad_token_id is None:
            self.tokenizer.pad_token = self.tokenizer.eos_token

    def __call__(self, data):
        # Accept the route's {"prompt"} contract; tolerate stock {"inputs"}.
        prompt = data.get("prompt") or data.get("inputs") or ""
        params = data.get("parameters", {}) or {}
        max_new_tokens = int(params.get("max_new_tokens", DEFAULT_MAX_NEW_TOKENS))
        symbol_context = data.get("symbol_context", "")

        if not prompt:
            return {"code": "", "error": "no prompt provided"}

        user = f"The user request is: {prompt}"
        if symbol_context:
            user += (
                "\n###\nWe have the following symbols and their related context "
                f"information as listed below: {symbol_context}\n###"
            )
        user += "\nLimit your thinking process to less than 1000 words."

        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user},
        ]
        # `reasoning_effort=low` is the key lever: gpt-oss otherwise rambles in its
        # analysis channel (looping on coordinates) and never reaches `final`
        # within the token budget. Fall back if the template lacks the kwarg.
        reasoning = os.environ.get("SCHGEN_REASONING", "low")
        try:
            input_ids = self.tokenizer.apply_chat_template(
                messages, add_generation_prompt=True, reasoning_effort=reasoning,
                return_tensors="pt",
            ).to(self.model.device)
        except TypeError:
            input_ids = self.tokenizer.apply_chat_template(
                messages, add_generation_prompt=True, return_tensors="pt",
            ).to(self.model.device)

        with torch.no_grad():
            output_ids = self.model.generate(
                input_ids,
                max_new_tokens=max_new_tokens,
                do_sample=False,  # greedy → reproducible second opinion
                repetition_penalty=1.1,   # break the "I'm repeating" loops
                no_repeat_ngram_size=4,
                attention_mask=torch.ones_like(input_ids),
                pad_token_id=self.tokenizer.pad_token_id,
            )

        decoded = self.tokenizer.decode(
            output_ids[0, input_ids.shape[-1]:], skip_special_tokens=False
        )
        code = _extract_final_python(decoded)
        return {"code": code}
