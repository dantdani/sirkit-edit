/**
 * [PR-L6 spend, 2026-10-19] SPEND-3: the shared request input bound (`app/lib/llm/request-input-bound.ts`), which the durable generation
 * task's `generationRequestInputBound` now delegates to and the post-apply Tidy and Review admission reads.
 *
 *  1. IDENTITY: on the generation task's own requests (the planner's, a block's first and later turns, collected from the real slice code
 *     with fake ports) and on an image-free request with every context section, the shared bound, the generation bound and a FROZEN copy
 *     of the pre-move formula (written out here, not imported) are the same number - the move changed no generation number. With an image,
 *     the generation bound differs from the frozen formula by exactly (36,000 - the image data URL's JSON bytes).
 *  2. IMAGE ALLOWANCE by provider, model and detail (CONFIRMED-by-documentation: the OpenAI vision guide, read 2026-10-19): patch-based
 *     gpt-5.x / gpt-6 models "high" 3,000, "low" 308, anything else 36,000; any other provider or model 36,000.
 *     [PR-L6 spend, 2026-10-19] SPEND-3-A1 / A4 (the attack review), pins moved: "high" 3,000 and "low" 308 only for the three documented
 *     ids (gpt-5.6-sol / terra / luna, exactly); any other GPT-5.x / GPT-6 family id 36,000 at every detail; an OpenAI id outside the
 *     family (or an unnamed serving model) UNBOUNDED (+Infinity: the request cannot be bounded); every Anthropic model 36,000, an
 *     over-count of the documented ~4,784-token cap.
 *  3. BASE64 IS NEVER COUNTED: the same request with a 4-byte and a 3 MB image payload has the same bound.
 *  4. MONOTONIC in every section: growing the system prompt, any context section, the tools, the tool choice, a message's text, a tool
 *     call's input, a tool result, or adding a message, a part or an image never lowers the bound - and raises it by at least the bytes added.
 *  5. AN UPPER BOUND without a tokenizer: for both adapters, the bound covers the UTF-8 bytes of every provider-visible string of the mapped
 *     request (byte-level BPE never yields more tokens than bytes), the image payloads replaced by their allowances.
 *
 * Fake ports and fake SDK clients; no provider, no database, no network.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/erc", () => ({ runErc: vi.fn(() => ({ ok: true, errors: [], criticalCount: 0, warningCount: 0, reward: 1 })), formatErcFeedback: vi.fn(() => "") }));
vi.mock("@/lib/kg", () => ({ kgDesignNotes: vi.fn(() => null) }));

import { composeInstructions } from "../context";
import { AnthropicProvider } from "../anthropic-provider";
import { OpenAIProvider } from "../openai-provider";
import type { LLMImagePart, LLMRequest, LLMResponse } from "../types";
import {
  MAX_IMAGE_INPUT_TOKENS, OPENAI_PATCH_IMAGE_HIGH_DETAIL_TOKENS, OPENAI_PATCH_IMAGE_LOW_DETAIL_TOKENS, REQUEST_INPUT_FRAMING,
  imageAllowanceFor, imageInputAllowance, requestInputBound, worstCaseImageAllowance,
  ANTHROPIC_DOCUMENTED_MAX_IMAGE_TOKENS, OPENAI_PATCH_BUDGET_IMAGE_MODELS, UNBOUNDED_IMAGE_ALLOWANCE, // [PR-L6 spend, 2026-10-19] SPEND-3-A1 / A4
} from "../request-input-bound";
import { GENERATION_INPUT_BOUND, generationRequestInputBound } from "../../generation-task/worker/accounting";
import { generationSliceId, generationTaskId } from "../../generation-task/contracts";
import type { AiPartResult } from "../../parts-search";
import { runBlockSlice, type BuildCatalogPort } from "../../schematic/build-loop-slice";
import { planGeneration } from "../../schematic/build-multi-generation";

const utf8 = (text: string): number => new TextEncoder().encode(text).length;
const json = (value: unknown): number => utf8(JSON.stringify(value ?? null));
const CONTEXT_KEYS = ["retrievedContext", "schematicState", "boardState", "designConstraints", "userRequest"] as const;
const GPT = { provider: "openai", model: "gpt-5.6-sol" } as const;
const atGpt = { imageAllowance: imageAllowanceFor(GPT) };

/** The pre-move formula, FROZEN here as accounting.ts held it at 0f1c446b (written out, not imported): the identity's independent side. */
function frozenGenerationBound(request: LLMRequest): number {
  const tools = request.tools ?? [];
  const parts = request.messages.reduce((sum, message) => sum + (typeof message.content === "string" ? 1 : message.content.length), 0);
  return utf8(composeInstructions(request) ?? "") + utf8(JSON.stringify(tools)) + utf8(JSON.stringify(request.toolChoice ?? null)) + utf8(JSON.stringify(request.messages))
    + 1_024 + 16 * request.messages.length + 8 * parts + 64 * tools.length;
}

const FET: AiPartResult = { partId: "p-fet", name: "Offline logic-level N-MOSFET – ±20 V", mpn: "MPN-FET", description: "Offline pin-valid fixture (µA leakage).", mainCategory: "Transistors", pins: [{ number: "1", name: "G", type: "input" }, { number: "2", name: "D", type: "passive" }, { number: "3", name: "S", type: "passive" }], lifecycleStatus: "active", similarity: 0.9 };
const catalog: BuildCatalogPort = {
  identity: { catalogProfile: "fixture-scripted", embeddingModel: "text-embedding-3-small" },
  async searchParts() { return [structuredClone(FET)]; },
  async findAlternates() { return []; },
  async partsByIds(ids) { return ids.includes(FET.partId) ? [structuredClone(FET)] : []; },
};
const answer = (request: LLMRequest): LLMResponse => {
  const turn = request.messages.filter((message) => message.role === "assistant").length + 1;
  return { provider: request.provider, model: "offline", text: turn === 1 ? "Searching for the switch." : "", toolCalls: turn <= 2 ? [{ id: `call_${turn}`, name: "search_parts", input: { query: `logic level mosfet ${turn} – 20 V`, category: "Transistors" } }] : [], stopReason: "tool_use", usage: { inputTokens: 10, outputTokens: 5 } };
};

/** The generation task's own requests: the planner's and a block's three turns, from the real slice code with fake ports. */
async function generationRequests(): Promise<Array<{ label: string; request: LLMRequest }>> {
  const requests: Array<{ label: string; request: LLMRequest }> = [];
  await planGeneration({ prompt: "A four-motor drone controller with an IMU – 1S LiPo, µC at 3.3 V.", provider: "openai", llm: { generate: async (request) => { requests.push({ label: "plan", request: structuredClone({ ...request, signal: undefined }) }); return { provider: "openai", model: "offline", text: "", toolCalls: [], stopReason: "end_turn" }; } }, maxBlocks: 8 });
  const task = generationTaskId({ tenantId: "tenant-l6", projectId: "project-l6-spend", branchId: "main" }, "user-l6", "00000000-0000-4000-8000-0000000006c1");
  const block = { systemPrompt: "Design the block.", userMessage: "Block: Motor drivers\n\nFour low-side channels – flyback diodes.\n\nSHARED BOARD NETS (connect to these by exact-name labels): VBAT, GND, PWM1", allowEmpty: false };
  await runBlockSlice({ block, checkpoint: null, identity: { taskId: task, blockId: "b1", sliceId: generationSliceId(task, 2), attempt: 1, fence: 2, strategy: "S1-baseline" }, policy: { maxTurns: 3 }, provider: "openai", catalog, llm: { generate: async (request) => { requests.push({ label: `block turn ${requests.filter((entry) => entry.label.startsWith("block")).length + 1}`, request: structuredClone({ ...request, signal: undefined }) }); return answer(request); } } });
  expect(requests.map((entry) => entry.label)).toEqual(["plan", "block turn 1", "block turn 2", "block turn 3"]);
  return requests;
}

const image = (detail?: LLMImagePart["detail"], payload = "aGk="): LLMImagePart => ({ type: "image", dataUrl: `data:image/png;base64,${payload}`, ...(detail ? { detail } : {}) });
/** Every section populated (no image): the identity's synthetic case and the monotonicity base. */
function everySection(): LLMRequest {
  return {
    provider: "openai", system: "System prompt – with « non-ASCII » text.", maxTokens: 64,
    tools: [{ name: "submit_schematic", description: "Submit – the netlist", inputSchema: { type: "object", properties: { note: { type: "string" } }, additionalProperties: false }, strict: true }],
    toolChoice: { name: "submit_schematic" },
    retrievedContext: { notes: ["µ", "Ω", "<tag>"] }, schematicState: { components: [{ refDes: "R1", value: "10 kΩ" }] }, boardState: { layers: 2 }, designConstraints: ["≤ 50 mm"], userRequest: "Make it «small» & cheap",
    messages: [
      { role: "user", content: [{ type: "text", text: "Rendered schematic – see the manifest" }] },
      { role: "assistant", content: [{ type: "text", text: "Checking." }, { type: "tool_call", id: "call_x", name: "search_parts", input: { query: "10 kΩ resistor \"0805\"" } }] },
      { role: "user", content: [{ type: "tool_result", toolCallId: "call_x", output: JSON.stringify([{ partId: "p-r", name: "10 kΩ – 0805" }]) }] },
    ],
  };
}
/** The post-apply Tidy's shape: an image and a manifest in one user message, the state in the instructions. */
function tidyShaped(detail: LLMImagePart["detail"] = "high", payload = "aGk="): LLMRequest {
  return { provider: "openai", system: "Flag crowded groups.", tools: [{ name: "report_layout_issues", description: "Report", inputSchema: { type: "object" } }], toolChoice: { name: "report_layout_issues" }, schematicState: { kicadComponents: [{ refDes: "R1", partId: "p1", x: 0, y: 0 }] }, messages: [{ role: "user", content: [image(detail, payload), { type: "text", text: "Manifest: [{\"refDes\":\"R1\"}]" }] }] };
}

describe("[PR-L6 spend] 1. identity: the move changed no generation number", () => {
  it("the framing constants are the generation task's, value for value", () => {
    expect({ ...REQUEST_INPUT_FRAMING }).toEqual({ perCall: 1_024, perMessage: 16, perPart: 8, perTool: 64 });
    expect({ ...GENERATION_INPUT_BOUND }).toEqual({ ...REQUEST_INPUT_FRAMING });
  });

  it("on the generation task's own requests and an image-free request with every section: shared bound = generation bound = the frozen pre-move formula", async () => {
    const cases = [...(await generationRequests()), { label: "every section", request: everySection() }, { label: "every section, anthropic", request: { ...everySection(), provider: "anthropic" as const } }];
    for (const { label, request } of cases) {
      const frozen = frozenGenerationBound(request);
      expect(generationRequestInputBound(request), label).toBe(frozen);
      expect(requestInputBound(request, atGpt), label).toBe(frozen);
      expect(requestInputBound(request, { imageAllowance: worstCaseImageAllowance }), label).toBe(frozen);
    }
  });

  it("with an image the generation bound charges the documented worst case instead of the payload: frozen - JSON bytes of the data URL + 36,000", () => {
    const request = { ...everySection(), messages: [...everySection().messages, { role: "user" as const, content: [image("high")] }] };
    const dataUrlJsonBytes = json(image("high").dataUrl) - json("");
    expect(generationRequestInputBound(request)).toBe(frozenGenerationBound(request) - dataUrlJsonBytes + MAX_IMAGE_INPUT_TOKENS);
    // the shared bound at the served model charges the model's allowance (gpt-5.6-sol, "high": 3,000)
    expect(requestInputBound(request, atGpt)).toBe(frozenGenerationBound(request) - dataUrlJsonBytes + OPENAI_PATCH_IMAGE_HIGH_DETAIL_TOKENS);
  });
});

describe("[PR-L6 spend] 2. the per-image allowance by provider, model and detail (CONFIRMED-by-documentation, read 2026-10-19)", () => {
  it("the three documented ids, exactly (gpt-5.6-sol / terra / luna): high 3,000, low 308, auto / unset / original 36,000", () => {
    expect([OPENAI_PATCH_IMAGE_HIGH_DETAIL_TOKENS, OPENAI_PATCH_IMAGE_LOW_DETAIL_TOKENS, MAX_IMAGE_INPUT_TOKENS]).toEqual([3_000, 308, 36_000]);
    // the documented arithmetic: ceil(patches x 1.2) for the 2,500-patch high budget, (512 / 32)^2 low patches and the 30,000-patch rejection limit
    expect([Math.ceil(2_500 * 1.2), Math.ceil((512 / 32) ** 2 * 1.2), Math.ceil(30_000 * 1.2)]).toEqual([3_000, 308, 36_000]);
    expect([...OPENAI_PATCH_BUDGET_IMAGE_MODELS].sort()).toEqual(["gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-terra"]);
    for (const model of ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]) {
      expect(imageInputAllowance({ provider: "openai", model }, "high"), model).toBe(3_000);
      expect(imageInputAllowance({ provider: "openai", model }, "low"), model).toBe(308);
      for (const detail of ["auto", undefined, "original", "HIGH", ""]) expect(imageInputAllowance({ provider: "openai", model }, detail), `${model} ${String(detail)}`).toBe(36_000);
    }
  });

  it("[SPEND-3-A1] any other GPT-5.x / GPT-6 family id - no documented high / low budget - is charged the family's 36,000 at EVERY detail", () => {
    // [PR-L6 spend, 2026-10-19] pin moved: these ids expected 3,000 at "high" and 308 at "low" under the family regex; the guide documents those budgets for the three ids above only
    for (const model of ["gpt-5.6", "gpt-6-astra", "gpt-6", "gpt-6.1-sol", "gpt-5.4-mini", "gpt-5.6-sol-2026-10-01", "gpt-5.6-solar"]) {
      for (const detail of ["high", "low", "auto", undefined, "original"]) expect(imageInputAllowance({ provider: "openai", model }, detail), `${model} ${String(detail)}`).toBe(36_000);
    }
  });

  it("[SPEND-3-A4] an OpenAI id outside the patch family, or an unnamed serving model, has no documented cap: the image is unbounded and so is the request", () => {
    // [PR-L6 spend, 2026-10-19] pin moved: these OpenAI ids expected 36,000 - the family's limit, which the guide does not give them
    for (const model of ["gpt-5", "gpt-5-mini", "gpt-5-nano", "gpt-4.1", "o4-mini", "gpt-50", "xgpt-5.6-sol", "", undefined]) {
      for (const detail of ["high", "low", "auto", undefined] as const) expect(imageInputAllowance({ provider: "openai", model }, detail), `${String(model)} ${String(detail)}`).toBe(UNBOUNDED_IMAGE_ALLOWANCE);
    }
    expect(UNBOUNDED_IMAGE_ALLOWANCE).toBe(Number.POSITIVE_INFINITY);
    expect(requestInputBound(tidyShaped("high"), { imageAllowance: imageAllowanceFor({ provider: "openai", model: "gpt-4.1" }) })).toBe(Number.POSITIVE_INFINITY);
    // an image-free request's bound does not depend on the model
    expect(requestInputBound(everySection(), { imageAllowance: imageAllowanceFor({ provider: "openai", model: "gpt-4.1" }) })).toBe(frozenGenerationBound(everySection()));
  });

  it("[SPEND-3-A4] every Anthropic model, named or not: 36,000 at any detail, an over-count of the documented cap (~4,784 tokens at the 2,576 px long edge)", () => {
    expect(ANTHROPIC_DOCUMENTED_MAX_IMAGE_TOKENS).toBe(4_784);
    expect(MAX_IMAGE_INPUT_TOKENS).toBeGreaterThan(ANTHROPIC_DOCUMENTED_MAX_IMAGE_TOKENS);
    for (const model of ["claude-opus-4-7", "claude-sonnet-4-6", "gpt-5.6-sol", undefined]) {
      for (const detail of ["high", "low", "auto", undefined] as const) expect(imageInputAllowance({ provider: "anthropic", model }, detail), `${String(model)} ${String(detail)}`).toBe(36_000);
    }
  });

  it("each image of a request adds exactly its allowance", () => {
    const base = tidyShaped("high");
    const two = { ...base, messages: [{ role: "user" as const, content: [image("high"), image("low"), { type: "text" as const, text: "Manifest: [{\"refDes\":\"R1\"}]" }] }] };
    const delta = requestInputBound(two, atGpt) - requestInputBound(base, atGpt);
    expect(delta).toBe(308 + REQUEST_INPUT_FRAMING.perPart + json({ type: "image", dataUrl: "", detail: "low" }) + 1); // + the comma between parts
  });
});

describe("[PR-L6 spend] 3. an image's base64 is never counted", () => {
  it("a 4-byte and a 3 MB payload give the same bound, at every detail and for both providers", () => {
    const big = "A".repeat(3_000_000);
    for (const detail of ["high", "low", "auto", undefined] as const) {
      for (const target of [GPT, { provider: "anthropic", model: "claude-opus-4-7" }] as const) {
        const options = { imageAllowance: imageAllowanceFor(target) };
        const small = requestInputBound({ ...tidyShaped(detail, "aGk="), provider: target.provider }, options);
        expect(requestInputBound({ ...tidyShaped(detail, big), provider: target.provider }, options), `${target.provider} ${String(detail)}`).toBe(small);
        expect(small).toBeLessThan(10_000 + MAX_IMAGE_INPUT_TOKENS);
      }
    }
  });

  it("only image parts are emptied: a tool call input or a text that happens to carry a dataUrl field is counted in full", () => {
    const payload = `data:image/png;base64,${"B".repeat(50_000)}`;
    const request: LLMRequest = { provider: "openai", messages: [{ role: "assistant", content: [{ type: "tool_call", id: "c", name: "t", input: { dataUrl: payload } }] }, { role: "user", content: [{ type: "text", text: payload }] }] };
    expect(requestInputBound(request, atGpt)).toBe(frozenGenerationBound(request));
    expect(requestInputBound(request, atGpt)).toBeGreaterThan(100_000);
  });
});

describe("[PR-L6 spend] 4. monotonic in every section", () => {
  const grow = `${"Ω-grown text «x» ".repeat(40)}end`; // no edge whitespace: the composer trims the system prompt
  const growBytes = utf8(grow);
  const variants = (base: LLMRequest): Array<[string, LLMRequest, number]> => [
    ["system", { ...base, system: `${base.system ?? ""}${grow}` }, growBytes],
    ...CONTEXT_KEYS.map((key): [string, LLMRequest, number] => [key, { ...base, [key]: typeof base[key] === "string" ? `${base[key] as string}${grow}` : { previous: base[key] ?? null, grown: grow } }, growBytes]),
    ["tools", { ...base, tools: [...(base.tools ?? []), { name: "extra", description: grow, inputSchema: { type: "object" } }] }, growBytes],
    ["toolChoice", { ...base, toolChoice: { name: `${typeof base.toolChoice === "object" ? base.toolChoice.name : "submit"}_${"x".repeat(200)}` } }, 200],
    ["message text", { ...base, messages: base.messages.map((message, index) => (index === 0 ? { ...message, content: typeof message.content === "string" ? `${message.content}${grow}` : [...message.content, { type: "text" as const, text: grow }] } : message)) }, growBytes],
    ["tool call input", { ...base, messages: [...base.messages, { role: "assistant", content: [{ type: "tool_call", id: "g", name: "search_parts", input: { query: grow } }] }] }, growBytes],
    ["tool result", { ...base, messages: [...base.messages, { role: "user", content: [{ type: "tool_result", toolCallId: "g", output: grow }] }] }, growBytes],
    ["a message", { ...base, messages: [...base.messages, { role: "user", content: grow }] }, growBytes + REQUEST_INPUT_FRAMING.perMessage + REQUEST_INPUT_FRAMING.perPart],
    ["an image (low)", { ...base, messages: [...base.messages, { role: "user", content: [image("low")] }] }, OPENAI_PATCH_IMAGE_LOW_DETAIL_TOKENS],
    ["an image (auto)", { ...base, messages: [...base.messages, { role: "user", content: [image("auto")] }] }, MAX_IMAGE_INPUT_TOKENS],
  ];
  it("growing any section of a request with every section, and of the Tidy-shaped request, raises the bound by at least the bytes added", () => {
    for (const base of [everySection(), tidyShaped("high")]) {
      const bound = requestInputBound(base, atGpt);
      for (const [label, grown, atLeast] of variants(base)) {
        const after = requestInputBound(grown, atGpt);
        expect(after - bound, label).toBeGreaterThanOrEqual(atLeast);
        expect(generationRequestInputBound(grown) - generationRequestInputBound(base), `generation: ${label}`).toBeGreaterThanOrEqual(Math.min(atLeast, growBytes));
      }
    }
  });

  it("a sequence of random growths never lowers the bound (seeded, 200 steps)", () => {
    let seed = 0x5eed;
    const next = (): number => { seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31; return seed / 2 ** 31; };
    let request = everySection();
    let previous = requestInputBound(request, atGpt);
    for (let step = 0; step < 200; step += 1) {
      const options = variants(request);
      request = options[Math.floor(next() * options.length)]![1];
      const bound = requestInputBound(request, atGpt);
      expect(bound, `step ${step}`).toBeGreaterThan(previous);
      previous = bound;
    }
  });
});

/** Every string a mapped request carries, in UTF-8 bytes, an image payload replaced by nothing (its allowance is added separately). */
function visibleBytes(value: unknown, payloads: ReadonlySet<string>): number {
  if (typeof value === "string") return payloads.has(value) ? 0 : utf8(value);
  if (Array.isArray(value)) return value.reduce((sum: number, entry) => sum + visibleBytes(entry, payloads), 0);
  if (value !== null && typeof value === "object") return Object.values(value as Record<string, unknown>).reduce((sum: number, entry) => sum + visibleBytes(entry, payloads), 0);
  return 0;
}

describe("[PR-L6 spend] 5. an upper bound without a tokenizer (bytes >= tokens for text; images at their documented allowance)", () => {
  it("for both adapters the bound covers every provider-visible string of the mapped request plus each image's allowance", async () => {
    const payload = "iVBORw0KGgo".repeat(2_000);
    const cases: Array<[string, LLMRequest]> = [
      ...(await generationRequests()).map(({ label, request }): [string, LLMRequest] => [label, request]),
      ["every section", everySection()],
      ["tidy-shaped, high", tidyShaped("high", payload)],
      ["tidy-shaped, low", tidyShaped("low", payload)],
      ["tidy-shaped, auto", tidyShaped("auto", payload)],
    ];
    for (const [label, request] of cases) {
      const images = request.messages.flatMap((message) => (typeof message.content === "string" ? [] : message.content.filter((part): part is LLMImagePart => part.type === "image")));
      const payloads = new Set(images.flatMap((part) => [part.dataUrl, part.dataUrl.replace(/^data:[^,]*,/, "")]));
      const openaiCreate = vi.fn(async () => ({ id: "r", model: "gpt-5.6-sol", output: [], output_text: "", status: "completed", usage: { input_tokens: 1, output_tokens: 1 } }));
      await new OpenAIProvider({ responses: { create: openaiCreate } } as never, "gpt-5.6-sol").generate(request);
      const openai = (openaiCreate.mock.calls as unknown as Array<[Record<string, unknown>]>)[0]![0];
      const openaiText = utf8(String(openai.instructions ?? "")) + json(openai.tools ?? []) + json(openai.tool_choice ?? null) + visibleBytes(openai.input, payloads);
      const openaiImages = images.reduce((sum, part) => sum + imageInputAllowance(GPT, part.detail), 0);
      expect(requestInputBound(request, atGpt), `${label}: openai`).toBeGreaterThanOrEqual(openaiText + openaiImages);
      const anthropicCreate = vi.fn(async () => ({ id: "m", model: "claude-opus-4-7", content: [], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }));
      const anthropicRequest = { ...request, provider: "anthropic" as const };
      await new AnthropicProvider({ messages: { create: anthropicCreate } } as never, "claude-opus-4-7").generate(anthropicRequest);
      const anthropic = (anthropicCreate.mock.calls as unknown as Array<[Record<string, unknown>]>)[0]![0];
      const anthropicText = utf8(String(anthropic.system ?? "")) + json(anthropic.tools ?? []) + json(anthropic.tool_choice ?? null) + visibleBytes(anthropic.messages, payloads);
      const anthropicImages = images.length * MAX_IMAGE_INPUT_TOKENS;
      expect(requestInputBound(anthropicRequest, { imageAllowance: imageAllowanceFor({ provider: "anthropic", model: "claude-opus-4-7" }) }), `${label}: anthropic`).toBeGreaterThanOrEqual(anthropicText + anthropicImages);
    }
  });
});
