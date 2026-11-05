/**
 * [PR-L, 2026-10-17] Runbook L.6 in the Build loop (app/lib/build-loop.ts): the search tool's category note and unreadable
 * submissions.
 *
 *  - The search reports how it read the category (`onOutcome`); a normalized or unrecognised category reaches the model as
 *    `{ categoryNote, results }`. Without a note the result is the plain list, exactly as before.
 *  - finalizeSubmission used to read a missing `components` as [] - so a submit_schematic cut at the output limit (`{ _raw }` from
 *    the OpenAI adapter, or a partial input from Anthropic) was accepted as an EMPTY successful block (limit-and-stall-map.md
 *    section 4, block Y). It now refuses a submission from a turn the provider cut short, one that is not a readable object, or one
 *    whose `components`/`connections` are not arrays, with a correction the model gets as an error tool_result; the loop goes on
 *    within its turn allowance. A complete, deliberately empty netlist is still a judged design (edit-build's "remove everything").
 *
 * No provider, no database: the router, the part search, the KG and the ERC are mocked (the pr-c-build-loop-budget seams).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Turn = { text: string; toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }>; stopReason: string };

const harness = vi.hoisted(() => ({
  turns: [] as Array<{ text: string; toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }>; stopReason: string }>,
  requests: [] as Array<Record<string, unknown>>,
  categoryNote: null as string | null,
  searchOptions: [] as unknown[],
  part: { partId: "p-good", name: "DRV8833", mpn: "DRV8833PWPR", description: "Dual H-bridge motor driver", mainCategory: "Drivers", pins: [{ number: "1", name: "GND", type: "power_in" }, { number: "2", name: "VM", type: "power_in" }], lifecycleStatus: "active", similarity: 1 },
}));

vi.mock("@/app/lib/parts-search", () => ({
  searchPartsForAI: vi.fn(async (_query: string, category: string | undefined, _limit: number, options?: { onOutcome?: (outcome: unknown) => void }) => {
    harness.searchOptions.push(options);
    options?.onOutcome?.({ category: { status: harness.categoryNote ? "normalized" : "none", requested: category ?? null, applied: null, candidates: [], note: harness.categoryNote }, ranking: "fused", rerank: { state: "unavailable" } });
    return [harness.part];
  }),
  getPartsByIds: vi.fn(async () => []),
  fetchAlternatesForAI: vi.fn(async () => []),
}));
vi.mock("@/lib/erc", () => ({ runErc: vi.fn(() => ({ ok: true, errors: [], criticalCount: 0, warningCount: 0, reward: 1 })), formatErcFeedback: vi.fn(() => "") }));
vi.mock("@/lib/kg", () => ({ kgDesignNotes: vi.fn(() => null) }));
vi.mock("@/app/lib/llm/router", () => ({
  llmRouter: {
    generate: vi.fn(async (request: Record<string, unknown>) => {
      harness.requests.push(structuredClone({ ...request, signal: undefined }));
      const turn = harness.turns.shift() ?? { text: "thinking", toolCalls: [], stopReason: "end_turn" };
      return { provider: "openai", model: "fake", usage: {}, ...turn };
    }),
  },
}));

const search = (category?: string): Turn => ({ text: "", toolCalls: [{ id: "search-1", name: "search_parts", input: { query: "dual H-bridge motor driver", ...(category ? { category } : {}) } }], stopReason: "tool_use" });
const NETLIST = { components: [{ refDes: "U1", partId: "p-good", value: "DRV8833", role: "output" }], connections: [{ kind: "label", pin: "U1.GND", labelName: "GND", labelKind: "ground" }, { kind: "label", pin: "U1.VM", labelName: "VBAT", labelKind: "power" }], explanation: "Motor driver." };
const submit = (id: string, input: Record<string, unknown>, stopReason = "tool_use"): Turn => ({ text: "", toolCalls: [{ id, name: "submit_schematic", input }], stopReason });

async function run(maxIterations?: number) {
  const { runBuildToolLoop } = await import("@/app/lib/build-loop");
  return runBuildToolLoop({ provider: "openai", systemPrompt: "S", userMessage: "Block: Motor drivers", ...(maxIterations ? { budget: { maxIterations } } : {}) });
}
/** The tool_result parts the loop sent back on the given model request (its last message). */
function toolResults(index: number): Array<{ toolCallId: string; output: string; isError?: boolean }> {
  const messages = (harness.requests[index]?.messages ?? []) as Array<{ content: unknown }>;
  const last = messages[messages.length - 1];
  return Array.isArray(last?.content) ? (last!.content as Array<{ type: string; toolCallId: string; output: string; isError?: boolean }>).filter((part) => part.type === "tool_result") : [];
}

const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
beforeEach(() => {
  harness.turns = [];
  harness.requests.length = 0;
  harness.searchOptions.length = 0;
  harness.categoryNote = null;
  warn.mockClear();
});
afterEach(() => { vi.clearAllMocks(); });

describe("[PR-L L.6] the search tool's category note reaches the model", () => {
  it("a normalized or unrecognised category: the result is { categoryNote, results } with the same compact parts", async () => {
    harness.categoryNote = 'Category "Motor Drivers" is not a catalog category name; searched the "Drivers" category.';
    harness.turns = [search("Motor Drivers"), submit("submit-1", NETLIST)];
    const result = await run();
    expect(result.ok).toBe(true);
    expect(harness.searchOptions[0]).toMatchObject({ onOutcome: expect.any(Function) });
    const [searchResult] = toolResults(1);
    const payload = JSON.parse(searchResult!.output) as { categoryNote: string; results: Array<Record<string, unknown>> };
    expect(payload.categoryNote).toBe(harness.categoryNote);
    expect(payload.results.map((part) => part.partId)).toEqual(["p-good"]);
    expect(payload.results[0]!.untrustedCatalogText).toMatchObject({ name: "DRV8833" });
  });

  it("no note (no category, or a catalog name as given): the plain list, unchanged", async () => {
    harness.turns = [search(), submit("submit-1", NETLIST)];
    await run();
    const payload = JSON.parse(toolResults(1)[0]!.output) as Array<Record<string, unknown>>;
    expect(Array.isArray(payload)).toBe(true);
    expect(payload.map((part) => part.partId)).toEqual(["p-good"]);
  });
});

describe("[PR-L L.6] finalizeSubmission refuses a submission it cannot read whole; the loop retries within its turns", () => {
  it("an OpenAI turn cut at max_output_tokens ({ _raw }, stopReason max_tokens): refused with a correction, then the whole netlist is accepted", async () => {
    harness.turns = [search(), submit("submit-cut", { _raw: '{"components":[{"refDes":"U1","partId":"p-go' }, "max_tokens"), submit("submit-whole", NETLIST)];
    const result = await run();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.iterationsUsed).toBe(3);
    expect(result.netlist.components.map((component) => component.partId)).toEqual(["p-good"]);
    const refusal = toolResults(2).find((part) => part.toolCallId === "submit-cut")!;
    expect(refusal.isError).toBe(true);
    expect(refusal.output).toMatch(/^This submit_schematic was not accepted: the response stopped at the provider's output limit \(stop reason "max_tokens"\)/);
    expect(refusal.output).toMatch(/Call submit_schematic again with the complete netlist/);
  });

  it("before, the same cut turn was the block's end: an empty 'success'. Now, with no turn left, the block is NOT ok", async () => {
    harness.turns = [search(), submit("submit-cut", { _raw: '{"components":[' }, "max_tokens")];
    const result = await run(2);
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ code: "build_budget_exhausted", retryable: true, iterationsUsed: 2 });
  });

  it.each([
    ["Anthropic: a parsed but partial input from a max_tokens stop", { components: NETLIST.components }, "max_tokens", /output limit \(stop reason "max_tokens"\)/],
    ["an OpenAI incomplete for another reason (content_filter)", NETLIST, "incomplete", /output limit \(stop reason "incomplete"\)/],
    ["Anthropic's context-window stop", NETLIST, "model_context_window_exceeded", /stop reason "model_context_window_exceeded"/],
    ["unparseable arguments from a completed turn", { _raw: "{components: not json" }, "completed", /its arguments were not a readable JSON object/],
    ["a netlist without its connections", { components: NETLIST.components, explanation: "x" }, "tool_use", /"components" and "connections" must both be arrays/],
    ["components that are not a list", { components: "U1 DRV8833", connections: [], explanation: "x" }, "tool_use", /"components" and "connections" must both be arrays/],
  ] as const)("%s is refused, never accepted as a block", async (_label, input, stopReason, message) => {
    harness.turns = [search(), submit("submit-bad", input as Record<string, unknown>, stopReason), submit("submit-whole", NETLIST)];
    const result = await run();
    expect(result.ok && result.netlist.components.length).toBe(1);
    const refusal = toolResults(2).find((part) => part.toolCallId === "submit-bad")!;
    expect(refusal).toMatchObject({ isError: true });
    expect(refusal.output).toMatch(message);
  });

  it("a complete, deliberately empty netlist from a normal turn is still a judged design (unchanged)", async () => {
    harness.turns = [submit("submit-empty", { components: [], connections: [], explanation: "Remove everything." })];
    const result = await run();
    expect(result.ok).toBe(true);
    expect(result.ok && result.netlist.components).toEqual([]);
  });
});
