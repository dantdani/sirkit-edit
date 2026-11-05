/**
 * [PR-L6 integration, 2026-10-19] Test-integrity review F3 of increment 6: the UPPER-BOUND property of `generationRequestInputBound`,
 * tested independently of itself.
 *
 * Every input-allowance case (l3-input-allowance, l3-crash-resume) reports 40 % of the same function's output, so an estimator that
 * dropped a term (the tools, a context section, a message) would pass all of them, and the only defense left would be the runtime
 * self-check - after an over-bound call was billed. Over representative requests (the planner's, a block's first and a later turn with
 * tool calls and results, and one with every context section and an image):
 *
 *  (a) the bound covers the UTF-8 bytes of the composed instructions, JSON(tools), JSON(toolChoice) and JSON(messages);
 *  (b) removing the tools, the tool choice, any context section or any message lowers it by at least that part's UTF-8 bytes (so a
 *      dropped term cannot hide);
 *  (c) for both adapters it covers the provider-visible content of the mapped request (the instructions or system text, the mapped tools
 *      and tool choice, and every string the mapped messages carry - a function call's arguments counted as their own text).
 *
 * Fake model and catalog ports and fake SDK clients; no provider, no database, no network.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/erc", () => ({ runErc: vi.fn(() => ({ ok: true, errors: [], criticalCount: 0, warningCount: 0, reward: 1 })), formatErcFeedback: vi.fn(() => "") }));
vi.mock("@/lib/kg", () => ({ kgDesignNotes: vi.fn(() => null) }));

import { composeInstructions } from "../../llm/context";
import { AnthropicProvider } from "../../llm/anthropic-provider";
import { OpenAIProvider } from "../../llm/openai-provider";
import type { LLMRequest, LLMResponse } from "../../llm/types";
import type { AiPartResult } from "../../parts-search";
import { runBlockSlice, type BuildCatalogPort } from "../../schematic/build-loop-slice";
import { planGeneration } from "../../schematic/build-multi-generation";
import { generationSliceId, generationTaskId } from "../contracts";
import { generationRequestInputBound } from "../worker/accounting";

const utf8 = (text: string): number => new TextEncoder().encode(text).length;
const json = (value: unknown): number => utf8(JSON.stringify(value ?? null));
const CONTEXT_KEYS = ["retrievedContext", "schematicState", "boardState", "designConstraints", "userRequest"] as const;

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

/** The planner's request, a block's first turn and its third turn (two tool calls and results behind it), and a synthetic request with
 *  every context section, a multi-part user message with an image, a tool call and a tool result. */
async function representativeRequests(): Promise<Array<{ label: string; request: LLMRequest }>> {
  const requests: Array<{ label: string; request: LLMRequest }> = [];
  await planGeneration({ prompt: "A four-motor drone controller with an IMU – 1S LiPo, µC at 3.3 V.", provider: "openai", llm: { generate: async (request) => { requests.push({ label: "plan", request: structuredClone({ ...request, signal: undefined }) }); return { provider: "openai", model: "offline", text: "", toolCalls: [], stopReason: "end_turn" }; } }, maxBlocks: 8 });
  const task = generationTaskId({ tenantId: "tenant-l6", projectId: "project-l6-bound", branchId: "main" }, "user-l6", "00000000-0000-4000-8000-0000000006b1");
  const block = { systemPrompt: "Design the block.", userMessage: "Block: Motor drivers\n\nFour low-side channels – flyback diodes.\n\nSHARED BOARD NETS (connect to these by exact-name labels): VBAT, GND, PWM1", allowEmpty: false };
  await runBlockSlice({ block, checkpoint: null, identity: { taskId: task, blockId: "b1", sliceId: generationSliceId(task, 2), attempt: 1, fence: 2, strategy: "S1-baseline" }, policy: { maxTurns: 3 }, provider: "openai", catalog, llm: { generate: async (request) => { requests.push({ label: `block turn ${requests.filter((entry) => entry.label.startsWith("block")).length + 1}`, request: structuredClone({ ...request, signal: undefined }) }); return answer(request); } } });
  requests.push({
    label: "every context section",
    request: {
      provider: "openai", system: "System prompt – with « non-ASCII » text.", maxTokens: 64,
      tools: [{ name: "submit_schematic", description: "Submit – the netlist", inputSchema: { type: "object", properties: { note: { type: "string" } }, additionalProperties: false }, strict: true }],
      toolChoice: { name: "submit_schematic" },
      retrievedContext: { notes: ["µ", "Ω", "<tag>"] }, schematicState: { components: [{ refDes: "R1", value: "10 kΩ" }] }, boardState: { layers: 2 }, designConstraints: ["≤ 50 mm"], userRequest: "Make it «small» & cheap",
      messages: [
        { role: "user", content: [{ type: "text", text: "Rendered schematic – see image" }, { type: "image", dataUrl: "data:image/png;base64,aGk=", detail: "high" }] },
        { role: "assistant", content: [{ type: "text", text: "Checking." }, { type: "tool_call", id: "call_x", name: "search_parts", input: { query: "10 kΩ resistor \"0805\"" } }] },
        { role: "user", content: [{ type: "tool_result", toolCallId: "call_x", output: JSON.stringify([{ partId: "p-r", name: "10 kΩ – 0805" }]) }] },
      ],
    },
  });
  expect(requests.map((entry) => entry.label)).toEqual(["plan", "block turn 1", "block turn 2", "block turn 3", "every context section"]);
  return requests;
}

/** Every string a mapped message carries (a function call's arguments are their own text). */
function stringLeaves(value: unknown): number {
  if (typeof value === "string") return utf8(value);
  if (Array.isArray(value)) return value.reduce((sum: number, entry) => sum + stringLeaves(entry), 0);
  if (value !== null && typeof value === "object") return Object.values(value as Record<string, unknown>).reduce((sum: number, entry) => sum + stringLeaves(entry), 0);
  return 0;
}

describe("[PR-L6 integration] test-integrity F3: generationRequestInputBound is an upper bound, tested independently", () => {
  it("(a) the bound covers the instructions, JSON(tools), JSON(toolChoice) and JSON(messages)", async () => {
    for (const { label, request } of await representativeRequests()) {
      const floor = utf8(composeInstructions(request) ?? "") + json(request.tools ?? []) + json(request.toolChoice ?? null) + json(request.messages);
      expect(generationRequestInputBound(request), label).toBeGreaterThanOrEqual(floor);
    }
  });

  it("(b) removing the tools, the tool choice, any context section or any message lowers the bound by at least its bytes", async () => {
    for (const { label, request } of await representativeRequests()) {
      const bound = generationRequestInputBound(request);
      if (request.tools?.length) expect(bound - generationRequestInputBound({ ...request, tools: [] }), `${label}: tools`).toBeGreaterThanOrEqual(json(request.tools) - json([]));
      if (request.toolChoice) expect(bound - generationRequestInputBound({ ...request, toolChoice: undefined }), `${label}: toolChoice`).toBeGreaterThanOrEqual(json(request.toolChoice) - json(null));
      for (const key of CONTEXT_KEYS) {
        if (request[key] === undefined) continue;
        const without = { ...request, [key]: undefined } as LLMRequest;
        expect(bound - generationRequestInputBound(without), `${label}: ${key}`).toBeGreaterThanOrEqual(utf8(composeInstructions(request) ?? "") - utf8(composeInstructions(without) ?? ""));
      }
      for (let index = 0; index < request.messages.length; index += 1) {
        const without = { ...request, messages: request.messages.filter((_, at) => at !== index) };
        expect(bound - generationRequestInputBound(without), `${label}: message ${index}`).toBeGreaterThanOrEqual(json(request.messages[index]));
      }
    }
  });

  it("(c) for both adapters, the bound covers the provider-visible content of the mapped request", async () => {
    for (const { label, request } of await representativeRequests()) {
      const bound = generationRequestInputBound(request);
      const openaiCreate = vi.fn(async () => ({ id: "r", model: "gpt-test", output: [], output_text: "", status: "completed", usage: { input_tokens: 1, output_tokens: 1 } }));
      await new OpenAIProvider({ responses: { create: openaiCreate } } as never, "gpt-test").generate(request);
      const openai = (openaiCreate.mock.calls as unknown as Array<[Record<string, unknown>]>)[0]![0];
      const openaiVisible = utf8(String(openai.instructions ?? "")) + json(openai.tools ?? []) + json(openai.tool_choice ?? null) + stringLeaves(openai.input);
      expect(bound, `${label}: openai`).toBeGreaterThanOrEqual(openaiVisible);
      const anthropicCreate = vi.fn(async () => ({ id: "m", model: "claude-test", content: [], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }));
      await new AnthropicProvider({ messages: { create: anthropicCreate } } as never, "claude-test").generate({ ...request, provider: "anthropic" });
      const anthropic = (anthropicCreate.mock.calls as unknown as Array<[Record<string, unknown>]>)[0]![0];
      const anthropicVisible = utf8(String(anthropic.system ?? "")) + json(anthropic.tools ?? []) + json(anthropic.tool_choice ?? null) + stringLeaves(anthropic.messages);
      expect(generationRequestInputBound({ ...request, provider: "anthropic" }), `${label}: anthropic`).toBeGreaterThanOrEqual(anthropicVisible);
    }
  });
});
