# SchGen HF Inference Endpoint

Files to deploy to the HuggingFace model repo backing your Inference Endpoint so
it serves Sirkit's cross-verify contract: `POST {"prompt": "..."} → {"code": "..."}`.

## Deploy
1. Put `handler.py` + `requirements.txt` in the endpoint's model repo (a custom
   handler repo). The repo can be the base `openai/gpt-oss-20b` — the handler
   pulls the `microsoft/SchGen` LoRA itself (override via `SCHGEN_ADAPTER`).
2. **GPU:** pick an **H100** instance — gpt-oss-20b is MXFP4 and runs natively on
   Hopper, so the handler loads it as-is. On a non-Hopper GPU, either set env
   `SCHGEN_LOAD_4BIT=1` (uncomment `bitsandbytes` in requirements) or deploy a
   pre-merged bf16 checkpoint on an 80 GB GPU.
3. Expect a slow first request (cold start loads ~20B params + adapter). The
   Sirkit route already retries on 503 and allows 120 s per attempt.

## Wire up Sirkit (`.env.local`)
```
SCHGEN_ENDPOINT_URL=https://<your-endpoint>.endpoints.huggingface.cloud
SCHGEN_ENDPOINT_TOKEN=<your-hf-token>     # endpoints are protected by default
```

## Env knobs (handler.py)
- `SCHGEN_BASE_MODEL` (default `openai/gpt-oss-20b`)
- `SCHGEN_ADAPTER` (default `microsoft/SchGen`)
- `SCHGEN_MAX_NEW_TOKENS` (default 8192)
- `SCHGEN_REASONING` (default `low`) — gpt-oss reasoning effort. Keep `low`: at
  higher effort the model loops in its analysis channel and never reaches the
  `final` code within the token budget.
- `SCHGEN_LOAD_4BIT=1` — 4-bit NF4 load for non-Hopper GPUs

## Note: HF router requires an `inputs` key
Even with a custom handler, HF's endpoint router rejects a body without an
`inputs` key (400). Sirkit's route sends `{inputs, prompt, parameters}`; the
handler reads `prompt` (falls back to `inputs`).

## Fidelity note
Symbol selection (SchGen's separate LLM step that grounds the model on specific
library symbols) is omitted for self-containment; the fine-tune still emits valid
DSL, which is sufficient for a component/net cross-check. To add it, precompute a
`symbol_context` string and pass it in the request body — the handler forwards it
into the prompt.

## Quick test
```bash
curl -s https://<your-endpoint>.endpoints.huggingface.cloud \
  -H "Authorization: Bearer $HF_TOKEN" -H "Content-Type: application/json" \
  -d '{"prompt":"a 3.3V regulator based on AP2112K"}' | python -c "import sys,json;print(json.load(sys.stdin)['code'][:400])"
```
