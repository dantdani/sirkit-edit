/**
 * [PR-L6, 2026-10-19] L.6 part 2, item 4 (limit-and-stall-map.md section 7.6): a part's full pin list is sent to the model ONCE per
 * conversation. A part surfaced again in a later turn carries its pin count and a note instead of its pins, as long as the earlier result
 * that listed them is still in the conversation; derived from the normalized conversation itself, so it is resume-deterministic and
 * compaction-aware.
 *
 *  1. turn 2 surfaces the turn-1 part again: a compact entry (pinCount, the bounded catalog text, the note) - no pins; the submission that
 *     uses its pins is still validated against the full record (accepted);
 *  2. after compaction removes the earlier result, the pins are sent once more;
 *  3. an uninterrupted slice and the same conversation resumed from a checkpoint after every turn send byte-identical requests;
 *  4. the request-lifetime loop is unchanged (its per-turn dedup only).
 *
 * The slice core with a scripted model and a fake catalog; no provider, no database, no network.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/erc", () => ({ runErc: vi.fn(() => ({ ok: true, errors: [], criticalCount: 0, warningCount: 0, reward: 1 })), formatErcFeedback: vi.fn(() => "") }));
vi.mock("@/lib/kg", () => ({ kgDesignNotes: vi.fn(() => null) }));

import { compactBuildLoopCheckpoint, type BuildLoopCheckpoint } from "@/app/lib/generation-task/checkpoint";
import { generationSliceId, generationTaskId } from "@/app/lib/generation-task/contracts";
import type { LLMRequest, LLMResponse, LLMToolResultPart } from "@/app/lib/llm/types";
import type { AiPartResult } from "@/app/lib/parts-search";
import { BUILD_PINS_LISTED_NOTE, pinsInConversation, runBlockSlice, runInMemoryBuildLoop, type BuildCatalogPort } from "@/app/lib/schematic/build-loop-slice";

const FET: AiPartResult = { partId: "p-fet", name: "Offline logic-level N-MOSFET", mpn: "MPN-FET", description: "Offline pin-valid fixture.", mainCategory: "Transistors", pins: [{ number: "1", name: "G", type: "input" }, { number: "2", name: "D", type: "passive" }, { number: "3", name: "S", type: "passive" }], lifecycleStatus: "active", similarity: 0.9 };
const DIODE: AiPartResult = { partId: "p-diode", name: "Offline Schottky diode", mpn: "MPN-D", description: "Offline pin-valid fixture.", mainCategory: "Diodes", pins: [{ number: "1", name: "A", type: "passive" }, { number: "2", name: "K", type: "passive" }], lifecycleStatus: "active", similarity: 0.8 };
const catalog: BuildCatalogPort = {
  identity: { catalogProfile: "fixture-scripted", embeddingModel: "text-embedding-3-small" },
  async searchParts(query) { return /diode/i.test(query) ? [structuredClone(DIODE), structuredClone(FET)] : [structuredClone(FET)]; },
  async findAlternates() { return []; },
  async partsByIds(ids) { return [FET, DIODE].filter((part) => ids.includes(part.partId)).map((part) => structuredClone(part)); },
};
const NETLIST = { components: [{ refDes: "Q1", partId: "p-fet", value: "N-MOSFET", role: "output" }, { refDes: "D1", partId: "p-diode", value: "Schottky", role: "support", parentRefDes: "Q1" }], connections: [{ kind: "label", pin: "Q1.G", labelName: "PWM1" }, { kind: "label", pin: "Q1.S", labelName: "GND", labelKind: "ground" }, { from: "Q1.D", to: "D1.A" }, { kind: "label", pin: "D1.K", labelName: "VBAT", labelKind: "power" }], explanation: "One channel." };
const QUERIES = ["logic level mosfet", "n-channel mosfet sot-23", "schottky flyback diode"];
/** The scripted answer to the n-th request of a model (call ids unique per model, so a compacted conversation never reuses one). */
const answer = (request: LLMRequest, n: number): LLMResponse => {
  const turn = request.messages.filter((message) => message.role === "assistant").length + 1;
  const toolCalls = turn <= QUERIES.length ? [{ id: `call_${n}`, name: "search_parts", input: { query: QUERIES[turn - 1]! } }] : [{ id: `call_submit_${n}`, name: "submit_schematic", input: NETLIST as unknown as Record<string, unknown> }];
  return { provider: request.provider, model: "offline", text: "", toolCalls, stopReason: "tool_use", usage: { inputTokens: 10, outputTokens: 5 } };
};
const recordingModel = () => { const requests: LLMRequest[] = []; return { requests, llm: { generate: async (request: LLMRequest) => { requests.push(structuredClone({ ...request, signal: undefined })); return answer(request, requests.length); } } }; };
const TASK = generationTaskId({ tenantId: "tenant-l6", projectId: "project-l6-dedup", branchId: "main" }, "user-l6", "00000000-0000-4000-8000-0000000006d4");
const identity = (seq: number) => ({ taskId: TASK, blockId: "b1" as const, sliceId: generationSliceId(TASK, seq), attempt: 1, fence: seq, strategy: "S1-baseline" as const });
const BLOCK = { systemPrompt: "Design the block.", userMessage: "Block: Motor drivers\n\nOne low-side channel with its flyback diode.", allowEmpty: false };
const resultsOf = (request: LLMRequest, turn: number): Array<Record<string, unknown>> => {
  const message = request.messages[2 * turn]!;
  const output = (message.content as LLMToolResultPart[])[0]!.output;
  const parsed = JSON.parse(output) as unknown;
  return (Array.isArray(parsed) ? parsed : (parsed as { results: unknown[] }).results) as Array<Record<string, unknown>>;
};

beforeEach(() => { vi.spyOn(console, "warn").mockImplementation(() => undefined); vi.spyOn(console, "log").mockImplementation(() => undefined); });

describe("[PR-L6] a part's pins are sent once per conversation (item 4)", () => {
  it("1. a part surfaced again carries its pin count and a note, not its pins; the submission using its pins is validated against the full record", async () => {
    const { requests, llm } = recordingModel();
    const outcome = await runBlockSlice({ block: BLOCK, checkpoint: null, identity: identity(2), policy: { maxTurns: 6 }, provider: "openai", llm, catalog });
    expect(outcome.status).toBe("submitted");
    const [firstFet] = resultsOf(requests[1]!, 1);
    expect(firstFet).toMatchObject({ partId: "p-fet", pins: [{ name: "G" }, { name: "D" }, { name: "S" }] });
    const [again] = resultsOf(requests[2]!, 2);
    expect(again).toEqual({ partId: "p-fet", mainCategory: "Transistors", pinCount: 3, untrustedCatalogText: { name: "Offline logic-level N-MOSFET", mpn: "MPN-FET" }, note: BUILD_PINS_LISTED_NOTE });
    const third = resultsOf(requests[3]!, 3);
    expect(third.map((entry) => [entry.partId, Array.isArray(entry.pins)])).toEqual([["p-diode", true], ["p-fet", false]]); // the new part in full, the known one compact
    expect(outcome.checkpoint!.surfaced["p-fet"]!.part.pins).toHaveLength(3); // validation kept the full record
    expect(pinsInConversation(requests[3]!.messages)).toEqual(new Set(["p-fet", "p-diode"]));
  });

  it("2. once compaction removes the result that listed them, the pins are sent once more", async () => {
    const { requests, llm } = recordingModel();
    const twoTurns = await runBlockSlice({ block: BLOCK, checkpoint: null, identity: identity(2), policy: { maxTurns: 2 }, provider: "openai", llm, catalog });
    expect(twoTurns).toMatchObject({ status: "yielded", reason: "turn_allowance" });
    const compacted = compactBuildLoopCheckpoint(twoTurns.checkpoint!, { maxTurns: 1 }); // turn 1 (the result with the pins) folded into the note
    expect(compacted.compaction).toMatchObject({ compactedTurns: 1 });
    expect(pinsInConversation(compacted.messages).has("p-fet")).toBe(false);
    const resumed = await runBlockSlice({ block: BLOCK, checkpoint: compacted as BuildLoopCheckpoint, identity: identity(3), policy: { maxTurns: 1 }, provider: "openai", llm, catalog });
    expect(resumed.status, resumed.status === "refused" ? resumed.error : "").toBe("yielded");
    expect(requests).toHaveLength(3);
    const answered = resumed.checkpoint!.messages.at(-1)!.content as LLMToolResultPart[]; // the resumed turn's search result
    const parsed = JSON.parse(answered[0]!.output) as Array<Record<string, unknown>>;
    expect(parsed.find((entry) => entry.partId === "p-fet")!.pins).toHaveLength(3);
  });

  it("3. an uninterrupted slice and the conversation resumed after every turn send byte-identical requests", async () => {
    const whole = recordingModel();
    await runBlockSlice({ block: BLOCK, checkpoint: null, identity: identity(2), policy: { maxTurns: 6 }, provider: "openai", llm: whole.llm, catalog });
    const pieces = recordingModel();
    let checkpoint: BuildLoopCheckpoint | null = null;
    for (let slice = 0; slice < 4; slice += 1) {
      const outcome = await runBlockSlice({ block: BLOCK, checkpoint, identity: identity(10 + slice), policy: { maxTurns: 1 }, provider: "openai", llm: pieces.llm, catalog });
      checkpoint = outcome.checkpoint;
      if (outcome.status === "submitted") break;
    }
    expect(pieces.requests).toHaveLength(whole.requests.length);
    for (let index = 0; index < whole.requests.length; index += 1) expect(JSON.stringify(pieces.requests[index]!.messages), `request ${index + 1}`).toBe(JSON.stringify(whole.requests[index]!.messages));
  });

  it("4. the request-lifetime loop is unchanged: the part listed in an earlier turn is listed again in full", async () => {
    const { requests, llm } = recordingModel();
    const { end } = await runInMemoryBuildLoop({ block: BLOCK, provider: "openai", llm, catalog, maxTurns: 6 });
    expect(end.kind).toBe("submitted");
    expect(resultsOf(requests[2]!, 2)[0]).toMatchObject({ partId: "p-fet", pins: [{ name: "G" }, { name: "D" }, { name: "S" }] });
    expect(requests[0]!.tools!.map((tool) => tool.name)).toEqual(["search_parts", "find_alternates", "submit_schematic"]); // no report_unfilled_role outside a durable task
  });
});
