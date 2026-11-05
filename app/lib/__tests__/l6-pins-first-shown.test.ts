/**
 * [PR-L6 integration, 2026-10-19] F3 and F9 (the engine review of increment 6): what the model has actually been SHOWN of a part's pins.
 *
 *  1. F3: a cached search whose parts are all in `surfaced` but whose pins the conversation never showed (seed parts the seed text cut, or
 *     parts find_alternates registered compact) sends their full pin lists for the first time - that turn is NOT a repeat, so two such
 *     turns no longer end a seeded slice as no_progress; a later cached search of the same parts (now compact) still is a repeat;
 *  2. F9: a part whose pins an EARLIER turn listed, returned twice in one turn, points the model at that earlier result in BOTH entries -
 *     never at "that result" of this turn, which is itself the compact entry without pins;
 *  3. F8: when compaction folds a cached search's turn into the note, the note lists the part ids the search returned (the cached result
 *     is wrapped as { cacheNote, results }), never only "result recorded".
 *
 * The slice core with a scripted model and a fake catalog; no provider, no database, no network.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/erc", () => ({ runErc: vi.fn(() => ({ ok: true, errors: [], criticalCount: 0, warningCount: 0, reward: 1 })), formatErcFeedback: vi.fn(() => "") }));
vi.mock("@/lib/kg", () => ({ kgDesignNotes: vi.fn(() => null) }));

import { compactBuildLoopCheckpoint } from "@/app/lib/generation-task/checkpoint";
import { generationSliceId, generationTaskId } from "@/app/lib/generation-task/contracts";
import type { LLMRequest, LLMResponse, LLMToolCall, LLMToolResultPart } from "@/app/lib/llm/types";
import type { AiPartResult } from "@/app/lib/parts-search";
import { BUILD_PINS_LISTED_NOTE, runBlockSlice, type BuildCatalogPort } from "@/app/lib/schematic/build-loop-slice";

const FET: AiPartResult = { partId: "p-fet", name: "Offline logic-level N-MOSFET", mpn: "MPN-FET", description: "Offline pin-valid fixture.", mainCategory: "Transistors", pins: [{ number: "1", name: "G", type: "input" }, { number: "2", name: "D", type: "passive" }, { number: "3", name: "S", type: "passive" }], lifecycleStatus: "active", similarity: 0.9 };
const DIODE: AiPartResult = { partId: "p-diode", name: "Offline Schottky diode", mpn: "MPN-D", description: "Offline pin-valid fixture.", mainCategory: "Diodes", pins: [{ number: "1", name: "A", type: "passive" }, { number: "2", name: "K", type: "passive" }], lifecycleStatus: "active", similarity: 0.8 };
/** A catalog whose every answer is reported as answered from the task's facts (`cached`), as the facts port reports a hit. */
const cachedCatalog: BuildCatalogPort = {
  identity: { catalogProfile: "fixture-scripted", embeddingModel: "text-embedding-3-small" },
  async searchParts(query, _category, _limit, options) {
    options.onOutcome?.({ category: { status: "none", requested: null, applied: null, candidates: [], note: null }, ranking: "fused", rerank: { state: "not_needed" }, cached: true });
    return /diode/i.test(query) ? [structuredClone(DIODE)] : [structuredClone(FET)];
  },
  async findAlternates() { return []; },
  async partsByIds(ids) { return [FET, DIODE].filter((part) => ids.includes(part.partId)).map((part) => structuredClone(part)); },
};
const NETLIST = { components: [{ refDes: "Q1", partId: "p-fet", value: "N-MOSFET", role: "output" }, { refDes: "D1", partId: "p-diode", value: "Schottky", role: "support", parentRefDes: "Q1" }], connections: [{ kind: "label", pin: "Q1.G", labelName: "PWM1" }, { kind: "label", pin: "Q1.S", labelName: "GND", labelKind: "ground" }, { from: "Q1.D", to: "D1.A" }, { kind: "label", pin: "D1.K", labelName: "VBAT", labelKind: "power" }], explanation: "One channel." };
const search = (id: string, query: string): LLMToolCall => ({ id, name: "search_parts", input: { query } });
/** A model answering turn n with `turns[n - 1]`. */
function scripted(turns: LLMToolCall[][]) {
  const requests: LLMRequest[] = [];
  return {
    requests,
    llm: {
      generate: async (request: LLMRequest): Promise<LLMResponse> => {
        requests.push(structuredClone({ ...request, signal: undefined }));
        const turn = request.messages.filter((message) => message.role === "assistant").length + 1;
        return { provider: request.provider, model: "offline", text: "", toolCalls: turns[Math.min(turn, turns.length) - 1]!, stopReason: "tool_use", usage: { inputTokens: 10, outputTokens: 5 } };
      },
    },
  };
}
const TASK = generationTaskId({ tenantId: "tenant-l6", projectId: "project-l6-pins-shown", branchId: "main" }, "user-l6", "00000000-0000-4000-8000-0000000006f3");
const identity = (seq: number) => ({ taskId: TASK, blockId: "b1" as const, sliceId: generationSliceId(TASK, seq), attempt: 1, fence: seq, strategy: "S3-catalog-guided" as const });
const entriesOf = (request: LLMRequest, turn: number, index = 0): Array<Record<string, unknown>> => {
  const output = (request.messages[2 * turn]!.content as LLMToolResultPart[])[index]!.output;
  const parsed = JSON.parse(output) as unknown;
  return (Array.isArray(parsed) ? parsed : (parsed as { results: unknown[] }).results) as Array<Record<string, unknown>>;
};

beforeEach(() => { vi.spyOn(console, "warn").mockImplementation(() => undefined); vi.spyOn(console, "log").mockImplementation(() => undefined); });

describe("[PR-L6 integration] F3: a search that first shows a part's pins is not a repeat", () => {
  it("1. two cached searches of seed parts the conversation never showed send their pins and do not end the slice as no_progress; the design is submitted", async () => {
    // the seed parts are in `surfaced` (validation may use them) but the block message never listed their pins
    const block = { systemPrompt: "Design the block.", userMessage: "Block: Motor drivers\n\nOne low-side channel with its flyback diode.", allowEmpty: false, seedParts: [FET, DIODE] };
    const { requests, llm } = scripted([[search("call_1", "logic level mosfet")], [search("call_2", "schottky flyback diode")], [{ id: "call_submit", name: "submit_schematic", input: NETLIST as unknown as Record<string, unknown> }]]);
    const outcome = await runBlockSlice({ block, checkpoint: null, identity: identity(2), policy: { maxTurns: 6 }, provider: "openai", llm, catalog: cachedCatalog });
    expect(outcome.status).toBe("submitted");
    expect(requests).toHaveLength(3);
    expect(entriesOf(requests[1]!, 1)[0]).toMatchObject({ partId: "p-fet", pins: [{ name: "G" }, { name: "D" }, { name: "S" }] }); // first shown here
    expect(entriesOf(requests[2]!, 2)[0]).toMatchObject({ partId: "p-diode", pins: [{ name: "A" }, { name: "K" }] });
  });

  it("2. a cached search returning only parts whose pins are already shown is still a repeat: two such turns end the slice as no_progress", async () => {
    const block = { systemPrompt: "Design the block.", userMessage: "Block: Motor drivers\n\nOne low-side channel.", allowEmpty: false, seedParts: [FET] };
    const { requests, llm } = scripted([[search("call_1", "logic level mosfet")], [search("call_2", "n-channel mosfet")], [search("call_3", "mosfet sot-23")], [search("call_4", "mosfet again")]]);
    const outcome = await runBlockSlice({ block, checkpoint: null, identity: identity(3), policy: { maxTurns: 6 }, provider: "openai", llm, catalog: cachedCatalog });
    expect(outcome).toMatchObject({ status: "yielded", reason: "no_progress" });
    expect(requests).toHaveLength(3); // turn 1 shows the pins (not a repeat); turns 2 and 3 repeat it compactly
    expect(entriesOf(requests[2]!, 2)[0]).toMatchObject({ partId: "p-fet", note: BUILD_PINS_LISTED_NOTE });
  });
});

describe("[PR-L6 integration] F9: a same-turn duplicate of a part whose pins an earlier turn listed", () => {
  it("1. both entries point at the earlier turn's result (the compact pins-listed note), never at this turn's first entry", async () => {
    const block = { systemPrompt: "Design the block.", userMessage: "Block: Motor drivers\n\nOne low-side channel.", allowEmpty: false };
    const { requests, llm } = scripted([[search("call_1", "logic level mosfet")], [search("call_2a", "n-channel mosfet"), search("call_2b", "mosfet sot-23")], [{ id: "call_submit", name: "submit_schematic", input: NETLIST as unknown as Record<string, unknown> }]]);
    await runBlockSlice({ block, checkpoint: null, identity: identity(4), policy: { maxTurns: 3 }, provider: "openai", llm, catalog: cachedCatalog });
    expect(requests.length).toBeGreaterThanOrEqual(3);
    const first = entriesOf(requests[2]!, 2, 0)[0]!, duplicate = entriesOf(requests[2]!, 2, 1)[0]!;
    expect(first).toMatchObject({ partId: "p-fet", note: BUILD_PINS_LISTED_NOTE });
    expect(first).not.toHaveProperty("pins");
    expect(duplicate).toMatchObject({ partId: "p-fet", note: BUILD_PINS_LISTED_NOTE });
    expect(String(duplicate.note)).not.toMatch(/full pin list is in that result/);
  });
});

describe("[PR-L6 integration] F8: compaction keeps a cached search's part ids", () => {
  it("1. a folded cached-search turn reads '1 result(s): p-fet' in the note, not 'result recorded'", async () => {
    const block = { systemPrompt: "Design the block.", userMessage: "Block: Motor drivers\n\nOne low-side channel.", allowEmpty: false };
    const { llm } = scripted([[search("call_1", "logic level mosfet")], [search("call_2", "schottky flyback diode")]]);
    const twoTurns = await runBlockSlice({ block, checkpoint: null, identity: identity(5), policy: { maxTurns: 2 }, provider: "openai", llm, catalog: cachedCatalog });
    expect(twoTurns).toMatchObject({ status: "yielded", reason: "turn_allowance" });
    const wrapped = JSON.parse((twoTurns.checkpoint!.messages[2]!.content as LLMToolResultPart[])[0]!.output) as Record<string, unknown>;
    expect(Object.keys(wrapped)).toEqual(["cacheNote", "results"]); // the cached shape this case is about
    const compacted = compactBuildLoopCheckpoint(twoTurns.checkpoint!, { maxTurns: 1 });
    expect(compacted.compaction).toMatchObject({ compactedTurns: 1 });
    const first = compacted.messages[0]!.content;
    const note = typeof first === "string" ? first : first.map((part) => (part.type === "text" ? part.text : "")).join("\n");
    expect(note).toContain('turn 1: search_parts "logic level mosfet" -> 1 result(s): p-fet');
    expect(note).not.toContain("result recorded");
  });
});
