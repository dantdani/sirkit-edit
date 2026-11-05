/**
 * [PR-L, 2026-10-17] Increment 3 part 1 (runbook L.3; task-worker-contract.md sections 1.3, 3.1, 3.2): the resumable slice core
 * (app/lib/schematic/build-loop-slice.ts `runBlockSlice`) through its real code, with a scripted model port and a fake catalog port.
 *
 *  1. a block that needs more than one slice: slice 1 yields at its turn allowance with a valid checkpoint, slice 2 resumes from it
 *     (the request carries exactly the checkpoint's conversation) and submits; the ERC rejection count is cumulative across slices;
 *  2. resume after a simulated process loss (fresh modules, fresh ports, the checkpoint through JSON) uses ONLY the checkpoint: no
 *     search is repeated and the provider receives the conversation an uninterrupted slice sent;
 *  3. a turn interrupted by the window (waiting on the provider, or on a search) is discarded, never synthesized, and redone by the
 *     next slice; a late answer changes nothing; no new turn starts inside `minTurnStartMs`;
 *  4. a truncated or empty submission is refused with a correction and recorded, never saved as a block;
 *  5. cancellation mid-turn, a hung call at `perCallMs`, transient and permanent provider failures, the caller's yield, foreign or
 *     tampered checkpoints, and an already saved block each end as their own status.
 *
 * No provider, no database, no network: the ports are in-test fakes, the ERC and the KG are mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LLMMessage, LLMRequest, LLMResponse, LLMToolCall } from "@/app/lib/llm/types";
import type { AiPartResult } from "@/app/lib/parts-search";
import { LLMProviderError } from "@/app/lib/llm/errors";
import { buildLoopCheckpointIssue, checkpointMessagesIssue, type BuildLoopCheckpoint } from "@/app/lib/generation-task/checkpoint";
import { generationSliceId, generationTaskId } from "@/app/lib/generation-task/contracts";
import { runBlockSlice, type BlockSliceIdentity, type BlockSliceInput, type BlockSliceOutcome, type BuildCatalogPort, type BuildLlmPort } from "../build-loop-slice";

const harness = vi.hoisted(() => ({
  /** ERC answers, oldest first; empty = a clean report */
  erc: [] as Array<{ ok: boolean; errors: Array<{ severity: string; category: string; message: string }>; criticalCount: number; warningCount: number; reward: number }>,
  ercCalls: 0,
}));
vi.mock("@/lib/erc", () => ({
  runErc: vi.fn(() => { harness.ercCalls += 1; return harness.erc.shift() ?? { ok: true, errors: [], criticalCount: 0, warningCount: 0, reward: 1 }; }),
  formatErcFeedback: vi.fn(() => "ERC: VBAT has no source in this block (offline fixture)."),
}));
vi.mock("@/lib/kg", () => ({ kgDesignNotes: vi.fn(() => null) }));

const SCOPE = { tenantId: "tenant-l3", projectId: "project-l3", branchId: "main" };
const TASK = generationTaskId(SCOPE, "user-l3-editor", "00000000-0000-4000-8000-000000000301");
const T0 = Date.UTC(2026, 9, 17, 14);
const MOSFET_ID = "33333333-3333-4333-8333-333333333301";
const DIODE_ID = "33333333-3333-4333-8333-333333333302";
const MOSFET: AiPartResult = {
  partId: MOSFET_ID, name: "Offline logic-level N-MOSFET", mpn: null, description: "Pin-valid test fixture, not a component recommendation.", mainCategory: "Transistors",
  pins: [{ number: "1", name: "G", type: "input" }, { number: "2", name: "D", type: "passive" }, { number: "3", name: "S", type: "passive" }], lifecycleStatus: "active", similarity: 0.91,
};
const DIODE: AiPartResult = {
  partId: DIODE_ID, name: "Offline Schottky flyback diode", mpn: null, description: "Pin-valid test fixture, not a component recommendation.", mainCategory: "Diodes",
  pins: [{ number: "1", name: "K", type: "passive" }, { number: "2", name: "A", type: "passive" }], lifecycleStatus: "active", similarity: 0.88,
};
const BLOCK = {
  systemPrompt: "You design ONE subsystem block (offline l3 fixture).",
  userMessage: "Block: Motor drivers\n\nOne low-side N-MOSFET channel with a flyback diode.\n\nSHARED BOARD NETS (connect to these by exact-name labels): VBAT, GND, PWM1",
  allowEmpty: false,
};
const NETLIST = {
  components: [{ refDes: "Q1", partId: MOSFET_ID, value: "N-MOSFET", role: "output" }, { refDes: "D1", partId: DIODE_ID, value: "Schottky", role: "support", parentRefDes: "Q1" }],
  connections: [
    { kind: "label", pin: "Q1.G", labelName: "PWM1", labelKind: "label" }, { kind: "label", pin: "Q1.S", labelName: "GND", labelKind: "ground" },
    { from: "Q1.D", to: "D1.A" }, { kind: "label", pin: "D1.K", labelName: "VBAT", labelKind: "power" },
  ],
  explanation: "One low-side channel; the diode clamps the motor's flyback.",
};

const identity = (seq: number, overrides: Partial<BlockSliceIdentity> = {}): BlockSliceIdentity => ({ taskId: TASK, blockId: "b3", sliceId: generationSliceId(TASK, seq), attempt: 1, fence: seq, strategy: "S1-baseline", ...overrides });
const reply = (toolCalls: LLMToolCall[], extra: Partial<LLMResponse> = {}): LLMResponse => ({ provider: "openai", model: "offline-l3", text: "", toolCalls, stopReason: "tool_use", usage: { inputTokens: 100, outputTokens: 20 }, ...extra });
const search = (id: string, query: string): LLMToolCall => ({ id, name: "search_parts", input: { query } });
const submit = (id: string, input: Record<string, unknown> = NETLIST): LLMToolCall => ({ id, name: "submit_schematic", input });
/** The turn a request is for: one more than the assistant turns its conversation already holds (slice boundaries do not matter). */
const turnOf = (request: LLMRequest): number => request.messages.filter((message) => message.role === "assistant").length + 1;
/** The default script: search the MOSFET, search the diode, submit the channel. */
function threeTurns(request: LLMRequest): LLMResponse {
  const turn = turnOf(request);
  if (turn === 1) return reply([search("call_search_mosfet", "logic level n-mosfet")]);
  if (turn === 2) return reply([search("call_search_diode", "schottky flyback diode")]);
  return reply([submit(`call_submit_${turn}`)]);
}

type Script = (request: LLMRequest) => LLMResponse | Promise<LLMResponse>;
function scriptedLlm(script: Script): { port: BuildLlmPort; requests: LLMRequest[] } {
  const requests: LLMRequest[] = [];
  return {
    requests,
    port: {
      generate: async (request) => {
        requests.push({ ...request, messages: structuredClone(request.messages) }); // the conversation as sent; the signal by reference
        return script(request);
      },
    },
  };
}
function fakeCatalog(search?: (query: string) => AiPartResult[] | Promise<AiPartResult[]>): { port: BuildCatalogPort; searches: string[] } {
  const searches: string[] = [];
  return {
    searches,
    port: {
      identity: { catalogProfile: "fixture-scripted", embeddingModel: "text-embedding-3-small" },
      searchParts: async (query) => {
        searches.push(query);
        if (search) return search(query);
        return structuredClone(/mosfet/i.test(query) ? [MOSFET] : /diode/i.test(query) ? [DIODE] : []);
      },
      findAlternates: async () => [],
      partsByIds: async () => [],
    },
  };
}
function sliceInput(llm: BuildLlmPort, catalog: BuildCatalogPort, overrides: Partial<BlockSliceInput> = {}): BlockSliceInput {
  return { block: BLOCK, checkpoint: null, identity: identity(1), policy: { maxTurns: 6 }, provider: "openai", llm, catalog, now: () => T0, ...overrides };
}
function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}
const expectStatus = <S extends BlockSliceOutcome["status"]>(outcome: BlockSliceOutcome, status: S): Extract<BlockSliceOutcome, { status: S }> => {
  expect(outcome.status).toBe(status);
  return outcome as Extract<BlockSliceOutcome, { status: S }>;
};
/** The tool_result parts of a message list's last message. */
const lastResults = (messages: readonly LLMMessage[]) => {
  const last = messages[messages.length - 1]!;
  return Array.isArray(last.content) ? last.content.filter((part) => part.type === "tool_result") : [];
};

beforeEach(() => {
  harness.erc = [];
  harness.ercCalls = 0;
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("[PR-L L.3] a block that needs more than one slice", () => {
  it("slice 1 yields at its turn allowance with a valid checkpoint; slice 2 resumes from exactly that conversation and submits", async () => {
    const llm = scriptedLlm(threeTurns), catalog = fakeCatalog();
    const first = expectStatus(await runBlockSlice(sliceInput(llm.port, catalog.port, { policy: { maxTurns: 2, windowDeadlineAt: Date.now() + 300_000 } })), "yielded");
    expect(first).toMatchObject({ reason: "turn_allowance", stage: "turn_boundary", turns: 2 });
    expect(buildLoopCheckpointIssue(first.checkpoint)).toBeNull();
    expect(first.checkpoint).toMatchObject({ taskId: TASK, blockId: "b3", sliceId: identity(1).sliceId, attempt: 1, fence: 1, turnsUsed: 2, nudges: 0, ercRejections: 0, result: null });
    expect(first.checkpoint.messages).toHaveLength(5); // the prompt and two complete turns, ending on the tool results
    expect(Object.keys(first.checkpoint.surfaced).sort()).toEqual([MOSFET_ID, DIODE_ID].sort());
    expect(Object.values(first.checkpoint.searches).map((entry) => entry.partIds)).toEqual([[MOSFET_ID], [DIODE_ID]]);
    expect(first.usage).toEqual({ modelCalls: 2, uncertainModelCalls: 0, inputTokens: 200, outputTokens: 40, catalogSearches: 2, alternatesLookups: 0 });
    expect(first.progress).toMatchObject({ newPartIds: [MOSFET_ID, DIODE_ID].sort(), submitted: false });

    const second = expectStatus(await runBlockSlice(sliceInput(llm.port, catalog.port, { checkpoint: first.checkpoint, identity: identity(2), policy: { maxTurns: 2, windowDeadlineAt: Date.now() + 300_000 } })), "submitted");
    // the resumed request is the checkpoint's conversation itself: every tool_result answers the call of the turn right before it
    expect(llm.requests[2]!.messages).toEqual(first.checkpoint.messages);
    expect(checkpointMessagesIssue(llm.requests[2]!.messages, { saved: false, compaction: null })).toBeNull();
    expect(second).toMatchObject({ turns: 1, usage: { modelCalls: 1, catalogSearches: 0 } });
    expect(second.checkpoint).toMatchObject({ sliceId: identity(2).sliceId, fence: 2, turnsUsed: 3 });
    expect(second.checkpoint.result).toEqual(second.result);
    expect(second.result.netlist.components.map((component) => component.partId)).toEqual([MOSFET_ID, DIODE_ID]);
    expect(second.result.erc).toEqual({ state: "passed", criticalCount: 0, warningCount: 0 });
    expect(second.checkpoint.submissions.map((entry) => entry.codes)).toEqual([["ACCEPTED"]]);
    expect(buildLoopCheckpointIssue(second.checkpoint)).toBeNull();
    expect(catalog.searches).toEqual(["logic level n-mosfet", "schottky flyback diode"]); // no search repeated by the resume
  });

  it("the ERC gate's rejection count is checkpointed: two rejections across two slices, then the best effort is saved with its findings", async () => {
    const failing = { ok: false, errors: [{ severity: "critical", category: "rail", message: "VBAT has no source in this block" }], criticalCount: 1, warningCount: 0, reward: 0.4 };
    harness.erc = [failing, failing, failing];
    const llm = scriptedLlm((request) => (turnOf(request) === 1 ? reply([search("call_a", "logic level n-mosfet"), search("call_b", "schottky flyback diode")]) : reply([submit(`call_submit_${turnOf(request)}`)])));
    const catalog = fakeCatalog();
    const first = expectStatus(await runBlockSlice(sliceInput(llm.port, catalog.port, { policy: { maxTurns: 2 } })), "yielded");
    expect(first.checkpoint.ercRejections).toBe(1);
    expect(first.checkpoint.submissions.map((entry) => entry.codes)).toEqual([["ERC_REJECTED"]]);
    const second = expectStatus(await runBlockSlice(sliceInput(llm.port, catalog.port, { checkpoint: first.checkpoint, identity: identity(2), policy: { maxTurns: 6 } })), "submitted");
    expect(second.turns).toBe(2); // one more rejection (2 of 2), then the gate accepts instead of looping forever
    expect(second.checkpoint.ercRejections).toBe(2);
    expect(second.result.erc).toEqual({ state: "findings", criticalCount: 1, warningCount: 0, findings: ["VBAT has no source in this block"] });
    expect(second.checkpoint.submissions.map((entry) => entry.codes)).toEqual([["ERC_REJECTED"], ["ERC_REJECTED"], ["ACCEPTED_WITH_ERC_FINDINGS"]]);
    expect(harness.ercCalls).toBe(3);
  });
});

describe("[PR-L L.3] resume after a simulated process loss uses only the checkpoint", () => {
  it("fresh modules and fresh ports, the checkpoint through JSON: the same conversation an uninterrupted slice sent, and no search again", async () => {
    // the uninterrupted reference: one slice designs the block in three turns
    const reference = scriptedLlm(threeTurns);
    const whole = expectStatus(await runBlockSlice(sliceInput(reference.port, fakeCatalog().port)), "submitted");
    expect(whole.turns).toBe(3);

    const llm = scriptedLlm(threeTurns);
    const first = expectStatus(await runBlockSlice(sliceInput(llm.port, fakeCatalog().port, { policy: { maxTurns: 2 } })), "yielded");
    const persisted = JSON.parse(JSON.stringify(first.checkpoint)) as BuildLoopCheckpoint; // what the durable store returns

    vi.resetModules(); // the process is gone: nothing of the first slice survives but the stored checkpoint
    const restarted = await import("../build-loop-slice");
    const resumedLlm = scriptedLlm(threeTurns);
    const blind = fakeCatalog(() => { throw new Error("a resumed slice must not search for parts its checkpoint already holds"); });
    const resumed = expectStatus(await restarted.runBlockSlice(sliceInput(resumedLlm.port, blind.port, { checkpoint: persisted, identity: identity(2, { attempt: 2 }) })), "submitted");

    expect(resumedLlm.requests).toHaveLength(1);
    expect(resumedLlm.requests[0]!.messages).toEqual(reference.requests[2]!.messages);
    expect(resumedLlm.requests[0]!.system).toBe(reference.requests[2]!.system);
    expect(blind.searches).toEqual([]);
    expect(resumed.result).toEqual(whole.result);
    expect(resumed.checkpoint.turnsUsed).toBe(whole.checkpoint.turnsUsed);
    expect(resumed.checkpoint.messages).toEqual(whole.checkpoint.messages);
    expect(resumed.checkpoint).toMatchObject({ attempt: 2, sliceId: identity(2).sliceId });
  });
});

describe("[PR-L L.3] a long block conversation is compacted and still resumes", () => {
  it("past 24 turns the checkpoint folds the oldest turn into its note; the next slice resumes from the compacted checkpoint and saves", async () => {
    const compacted = (request: LLMRequest) => Array.isArray(request.messages[0]!.content);
    const llm = scriptedLlm((request) => {
      if (compacted(request)) return reply([submit("call_submit_after_compaction")]);
      const turn = turnOf(request);
      return reply([turn === 1 ? search("call_search_diode", "schottky flyback diode") : search(`call_search_${turn}`, `logic level n-mosfet variant ${turn}`)]);
    });
    const catalog = fakeCatalog();
    let checkpoint: BuildLoopCheckpoint | null = null;
    let outcome: BlockSliceOutcome | null = null;
    const policies = [6, 6, 6, 6, 1, 6];
    for (const [index, maxTurns] of policies.entries()) {
      outcome = await runBlockSlice(sliceInput(llm.port, catalog.port, { checkpoint, identity: identity(index + 1), policy: { maxTurns } }));
      if (outcome.status !== "yielded") break;
      checkpoint = outcome.checkpoint;
      if (index === 4) {
        // slice 5 ran turn 25: its checkpoint is the first compacted one (24 complete turns kept, turn 1 folded into the note)
        expect(checkpoint.compaction).toMatchObject({ compactedTurns: 1 });
        expect(checkpoint.turnsUsed).toBe(25);
        expect(checkpoint.messages).toHaveLength(1 + 2 * 24);
        expect(buildLoopCheckpointIssue(checkpoint)).toBeNull();
      }
    }
    const saved = expectStatus(outcome!, "submitted");
    expect(saved.checkpoint.compaction).toMatchObject({ compactedTurns: 1 });
    expect(saved.checkpoint.turnsUsed).toBe(26);
    expect(saved.result.netlist.components.map((component) => component.partId)).toEqual([MOSFET_ID, DIODE_ID]); // the diode came from the folded turn
    const resumed = llm.requests[llm.requests.length - 1]!;
    expect(resumed.messages).toEqual(checkpoint!.messages); // slice 6 resumed from the compacted checkpoint as stored
    const first = resumed.messages[0]!.content as Array<{ type: string; text: string }>;
    expect(first[0]!.text).toBe(BLOCK.userMessage);
    expect(first[1]!.text).toMatch(/turn 1: search_parts "schottky flyback diode" -> 1 result\(s\)/);
    expect(catalog.searches).toHaveLength(25);
  });
});

describe("[PR-L L.3] an interrupted turn is discarded and redone; the window yields cleanly", () => {
  it("the window closes while the provider is answering turn 2: yielded at turn 1's boundary, the late answer is ignored, the next slice redoes turn 2", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const hung = deferred<LLMResponse>();
    let hungRequest: LLMRequest | undefined;
    const llm = scriptedLlm((request) => {
      if (turnOf(request) === 2) { hungRequest = request; return hung.promise; }
      return threeTurns(request);
    });
    const catalog = fakeCatalog();
    const onTurn = vi.fn();
    const job = runBlockSlice(sliceInput(llm.port, catalog.port, { policy: { maxTurns: 6, windowDeadlineAt: Date.now() + 10_000 }, onTurn }));
    await vi.advanceTimersByTimeAsync(10_001);
    const outcome = expectStatus(await job, "yielded");
    expect(outcome).toMatchObject({ reason: "window", stage: "provider", turns: 1 });
    expect(outcome.checkpoint.turnsUsed).toBe(1);
    expect(outcome.checkpoint.messages).toHaveLength(3); // turn 2 never happened as far as the checkpoint is concerned
    expect(outcome.usage).toMatchObject({ modelCalls: 2, uncertainModelCalls: 1 });
    expect(hungRequest?.signal?.aborted).toBe(true);
    expect(onTurn).toHaveBeenCalledTimes(1);

    hung.resolve(reply([search("call_late", "schottky flyback diode")]));
    await vi.advanceTimersByTimeAsync(0);
    expect(catalog.searches).toEqual(["logic level n-mosfet"]); // the late answer started no search
    expect(onTurn).toHaveBeenCalledTimes(1);
    expect(outcome.checkpoint.messages).toHaveLength(3);
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();

    const redo = scriptedLlm(threeTurns);
    const resumed = expectStatus(await runBlockSlice(sliceInput(redo.port, catalog.port, { checkpoint: outcome.checkpoint, identity: identity(2) })), "submitted");
    expect(redo.requests[0]!.messages).toEqual(llm.requests[1]!.messages); // the same turn, asked again
    expect(resumed.checkpoint.turnsUsed).toBe(3);
  });

  it("the window closes while turn 2's search runs: the received response is discarded with its turn, never answered by a fabricated result", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const slow = deferred<AiPartResult[]>();
    const llm = scriptedLlm(threeTurns);
    const catalog = fakeCatalog((query) => (/diode/i.test(query) ? slow.promise : [structuredClone(MOSFET)]));
    const job = runBlockSlice(sliceInput(llm.port, catalog.port, { policy: { maxTurns: 6, windowDeadlineAt: Date.now() + 10_000 } }));
    await vi.advanceTimersByTimeAsync(10_001);
    const outcome = expectStatus(await job, "yielded");
    expect(outcome).toMatchObject({ reason: "window", stage: "search", turns: 1 });
    expect(outcome.checkpoint.messages).toHaveLength(3);
    expect(outcome.checkpoint.messages.flatMap((message) => (Array.isArray(message.content) ? message.content : [])).some((part) => part.type === "tool_call" && part.id === "call_search_diode")).toBe(false);
    expect(Object.keys(outcome.checkpoint.surfaced)).toEqual([MOSFET_ID]);
    expect(outcome.usage).toMatchObject({ modelCalls: 2, uncertainModelCalls: 0, catalogSearches: 2 });
    slow.resolve([structuredClone(DIODE)]);
    await vi.advanceTimersByTimeAsync(0);
    expect(Object.keys(outcome.checkpoint.surfaced)).toEqual([MOSFET_ID]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("no new turn starts with less than minTurnStartMs of window left", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const llm = scriptedLlm((request) => { vi.setSystemTime(Date.now() + 45_000); return threeTurns(request); }); // each turn takes 45 s
    const outcome = expectStatus(await runBlockSlice(sliceInput(llm.port, fakeCatalog().port, { policy: { maxTurns: 6, windowDeadlineAt: T0 + 100_000, minTurnStartMs: 60_000 } })), "yielded");
    expect(outcome).toMatchObject({ reason: "window", stage: "turn_start", turns: 1 }); // 55 s left after turn 1: below the 60 s floor
    expect(llm.requests).toHaveLength(1);
    expect(outcome.checkpoint.turnsUsed).toBe(1);
    const none = expectStatus(await runBlockSlice(sliceInput(scriptedLlm(threeTurns).port, fakeCatalog().port, { policy: { maxTurns: 6, windowDeadlineAt: Date.now() + 30_000, minTurnStartMs: 60_000 } })), "yielded");
    expect(none).toMatchObject({ turns: 0, usage: { modelCalls: 0 } });
    expect(none.checkpoint.messages).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("[PR-L L.3] a truncated or empty submission is refused, never saved as a block", () => {
  it("a submit_schematic cut at the output limit is refused with a correction and recorded; the whole netlist is then saved", async () => {
    const llm = scriptedLlm((request) => {
      const turn = turnOf(request);
      if (turn === 3) return reply([submit("call_submit_cut", { _raw: '{"components":[{"refDes":"Q1","partId":"3333' })], { stopReason: "max_tokens", usage: { inputTokens: 100, outputTokens: 8_192 } });
      return threeTurns(request);
    });
    const outcome = expectStatus(await runBlockSlice(sliceInput(llm.port, fakeCatalog().port)), "submitted");
    expect(outcome.turns).toBe(4);
    const refusal = lastResults(llm.requests[3]!.messages).find((part) => part.type === "tool_result" && part.toolCallId === "call_submit_cut");
    expect(refusal).toMatchObject({ isError: true });
    expect(refusal && "output" in refusal ? refusal.output : "").toMatch(/^This submit_schematic was not accepted: the response stopped at the provider's output limit \(stop reason "max_tokens"\)/);
    expect(outcome.checkpoint.submissions.map((entry) => entry.codes)).toEqual([["SUBMISSION_CUT"], ["ACCEPTED"]]);
    expect(outcome.progress.codes).toEqual(["ACCEPTED", "SUBMISSION_CUT"]);
    expect(outcome.result.netlist.components).toHaveLength(2);
    expect(outcome.usage.outputTokens).toBe(20 * 3 + 8_192);
  });

  it("a cut submission at the turn allowance ends the slice with the refusal answered in its checkpoint; the next slice resubmits", async () => {
    const script = (request: LLMRequest) => (turnOf(request) === 3 ? reply([submit("call_submit_cut", { components: NETLIST.components })], { stopReason: "max_tokens" }) : threeTurns(request));
    const llm = scriptedLlm(script);
    const first = expectStatus(await runBlockSlice(sliceInput(llm.port, fakeCatalog().port, { policy: { maxTurns: 3 } })), "yielded");
    expect(first.reason).toBe("turn_allowance");
    expect(first.checkpoint.result).toBeNull();
    expect(lastResults(first.checkpoint.messages)).toEqual([expect.objectContaining({ toolCallId: "call_submit_cut", isError: true })]);
    const second = expectStatus(await runBlockSlice(sliceInput(llm.port, fakeCatalog().port, { checkpoint: first.checkpoint, identity: identity(2) })), "submitted");
    expect(second.result.netlist.components).toHaveLength(2);
  });

  it("a block slice refuses a complete but empty netlist (EMPTY_BLOCK) and saves the next real one", async () => {
    const llm = scriptedLlm((request) => (turnOf(request) === 3 ? reply([submit("call_submit_empty", { components: [], connections: [], explanation: "Nothing needed." })]) : threeTurns(request)));
    const outcome = expectStatus(await runBlockSlice(sliceInput(llm.port, fakeCatalog().port)), "submitted");
    const refusal = lastResults(llm.requests[3]!.messages)[0];
    expect(refusal && "output" in refusal ? refusal.output : "").toMatch(/a subsystem block must contain at least one component/);
    expect(outcome.checkpoint.submissions.map((entry) => entry.codes)).toEqual([["EMPTY_BLOCK"], ["ACCEPTED"]]);
    expect(outcome.result.netlist.components.length).toBeGreaterThan(0);
  });
});

describe("[PR-L L.3] what a slice records for the next one", () => {
  it("a netlist the checkpoint cannot store (an empty refDes) is refused with the field's path, never saved; the corrected one is", async () => {
    const llm = scriptedLlm((request) => (turnOf(request) === 3 ? reply([submit("call_submit_unnamed", { ...NETLIST, components: [{ ...NETLIST.components[0]!, refDes: "" }, NETLIST.components[1]!] })]) : threeTurns(request)));
    const outcome = expectStatus(await runBlockSlice(sliceInput(llm.port, fakeCatalog().port)), "submitted");
    const refusal = lastResults(llm.requests[3]!.messages)[0];
    expect(refusal && "output" in refusal ? refusal.output : "").toMatch(/^This submit_schematic was not accepted: its netlist cannot be stored as a design block \(netlist\.components\[0\]\.refDes: a bounded line is required\)/);
    expect(outcome.checkpoint.submissions.map((entry) => entry.codes)).toEqual([["SUBMISSION_UNSTORABLE"], ["ACCEPTED"]]);
    expect(outcome.result.netlist.components.map((component) => component.refDes)).toEqual(["Q1", "D1"]);
  });

  it("searches are recorded by their semantic key: the same words in another order or punctuation are ONE entry, refreshed", async () => {
    const llm = scriptedLlm((request) => {
      const turn = turnOf(request);
      if (turn === 1) return reply([search("call_a", "Schottky, flyback diode")]);
      if (turn === 2) return reply([search("call_b", "flyback diode schottky!")]);
      return reply([search(`call_${turn}`, "logic level n-mosfet")]);
    });
    const outcome = expectStatus(await runBlockSlice(sliceInput(llm.port, fakeCatalog().port, { policy: { maxTurns: 3 } })), "yielded");
    expect(Object.values(outcome.checkpoint.searches)).toEqual([
      { resultDigest: expect.stringMatching(/^dw1-/), partIds: [DIODE_ID], count: 1 },
      { resultDigest: expect.stringMatching(/^dw1-/), partIds: [MOSFET_ID], count: 1 },
    ]);
    expect(outcome.usage.catalogSearches).toBe(3); // recorded once, searched each time (the lookup cache is increment 6's)
  });
});

describe("[PR-L L.3] cancellation, hung calls, provider failures and the caller's yield", () => {
  it("cancellation mid-turn: cancelled at the last boundary, the request aborted, a late answer starts nothing", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const hung = deferred<LLMResponse>();
    let hungRequest: LLMRequest | undefined;
    const llm = scriptedLlm((request) => { if (turnOf(request) === 2) { hungRequest = request; return hung.promise; } return threeTurns(request); });
    const catalog = fakeCatalog();
    const controller = new AbortController();
    const job = runBlockSlice(sliceInput(llm.port, catalog.port, { signal: controller.signal, policy: { maxTurns: 6, windowDeadlineAt: Date.now() + 300_000, perCallMs: 120_000 } }));
    await vi.advanceTimersByTimeAsync(0);
    expect(hungRequest).toBeDefined();
    controller.abort();
    const outcome = expectStatus(await job, "cancelled");
    expect(outcome).toMatchObject({ stage: "provider", turns: 1, usage: { modelCalls: 2, uncertainModelCalls: 1 } });
    expect(outcome.checkpoint.turnsUsed).toBe(1);
    expect(hungRequest?.signal?.aborted).toBe(true);
    hung.resolve(reply([search("call_late", "schottky flyback diode")]));
    await vi.advanceTimersByTimeAsync(0);
    expect(catalog.searches).toEqual(["logic level n-mosfet"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("an already-cancelled slice makes no provider or catalog call", async () => {
    const llm = scriptedLlm(threeTurns), catalog = fakeCatalog();
    const controller = new AbortController();
    controller.abort();
    const outcome = expectStatus(await runBlockSlice(sliceInput(llm.port, catalog.port, { signal: controller.signal })), "cancelled");
    expect(outcome.turns).toBe(0);
    expect(llm.requests).toHaveLength(0);
    expect(catalog.searches).toHaveLength(0);
  });

  it("a hung call is abandoned at perCallMs: provider_waiting (timeout) with the last boundary's checkpoint, the call aborted and counted uncertain", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    let hungRequest: LLMRequest | undefined;
    const llm = scriptedLlm((request) => { if (turnOf(request) === 2) { hungRequest = request; return new Promise<LLMResponse>(() => undefined); } return threeTurns(request); });
    const job = runBlockSlice(sliceInput(llm.port, fakeCatalog().port, { policy: { maxTurns: 6, windowDeadlineAt: Date.now() + 300_000, perCallMs: 5_000 } }));
    await vi.advanceTimersByTimeAsync(5_001);
    const outcome = expectStatus(await job, "provider_waiting");
    expect(outcome).toMatchObject({ reason: "timeout", retryAfterMs: null, turns: 1, usage: { modelCalls: 2, uncertainModelCalls: 1 } });
    expect(outcome.checkpoint.turnsUsed).toBe(1);
    expect(hungRequest?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a transient provider failure is provider_waiting with its Retry-After; a quota failure is provider_failed; completed turns are kept", async () => {
    const limited = Object.assign(new LLMProviderError("openai", "rate_limit", 429, "rate_limit_exceeded"), { retryAfterMs: 7_000 });
    const waiting = expectStatus(await runBlockSlice(sliceInput(scriptedLlm((request) => { if (turnOf(request) === 2) throw limited; return threeTurns(request); }).port, fakeCatalog().port)), "provider_waiting");
    expect(waiting).toMatchObject({ provider: "openai", reason: "rate_limit", retryAfterMs: 7_000, turns: 1, usage: { modelCalls: 2, uncertainModelCalls: 0 } });
    expect(waiting.checkpoint.turnsUsed).toBe(1);
    const quota = new LLMProviderError("openai", "insufficient_quota", 429, "insufficient_quota");
    const failed = expectStatus(await runBlockSlice(sliceInput(scriptedLlm(() => { throw quota; }).port, fakeCatalog().port)), "provider_failed");
    expect(failed).toMatchObject({ provider: "openai", reason: "insufficient_quota", turns: 0 });
    expect(failed.error).toBe(quota.message);
  });

  it("a local failure is refused (loop_failed) with a bounded, redacted sentence and the last boundary's checkpoint", async () => {
    const outcome = expectStatus(await runBlockSlice(sliceInput(scriptedLlm((request) => { if (turnOf(request) === 2) throw new Error(`adapter crashed postgres://u:SENTINELPW@db.internal:5432/x ${"x".repeat(2_000)}`); return threeTurns(request); }).port, fakeCatalog().port)), "refused");
    expect(outcome.code).toBe("loop_failed");
    expect(outcome.error.length).toBeLessThanOrEqual(300);
    expect(JSON.stringify(outcome)).not.toContain("SENTINELPW");
    expect(outcome.checkpoint?.turnsUsed).toBe(1);
  });

  it("the caller's onTurn sees every boundary's valid checkpoint; 'yield' ends the slice there (pause); its throw reaches the caller unchanged", async () => {
    const seen: BuildLoopCheckpoint[] = [];
    const paused = expectStatus(await runBlockSlice(sliceInput(scriptedLlm(threeTurns).port, fakeCatalog().port, { onTurn: ({ checkpoint, turns }) => { seen.push(checkpoint); return turns === 2 ? "yield" : undefined; } })), "yielded");
    expect(paused).toMatchObject({ reason: "requested", turns: 2 });
    expect(seen.map((checkpoint) => checkpoint.turnsUsed)).toEqual([1, 2]);
    for (const checkpoint of seen) expect(buildLoopCheckpointIssue(checkpoint)).toBeNull();
    expect(paused.checkpoint).toBe(seen[1]);
    const fenced = new Error("GENERATION_SLICE_FENCED");
    await expect(runBlockSlice(sliceInput(scriptedLlm(threeTurns).port, fakeCatalog().port, { onTurn: () => { throw fenced; } }))).rejects.toBe(fenced);
  });
});

describe("[PR-L L.3] a checkpoint resumes only its own block's conversation", () => {
  async function yieldedCheckpoint(): Promise<BuildLoopCheckpoint> {
    return expectStatus(await runBlockSlice(sliceInput(scriptedLlm(threeTurns).port, fakeCatalog().port, { policy: { maxTurns: 1 } })), "yielded").checkpoint;
  }

  it("another block, another strategy or another prompt is refused (checkpoint_mismatch) before any provider call", async () => {
    const checkpoint = await yieldedCheckpoint();
    for (const [overrides, block] of [[{ blockId: "b2" as const }, BLOCK], [{ strategy: "S2-fresh-seeded" as const }, BLOCK], [{}, { ...BLOCK, userMessage: "Block: Power\n\nA 3.3 V regulator." }]] as const) {
      const llm = scriptedLlm(threeTurns);
      const outcome = expectStatus(await runBlockSlice(sliceInput(llm.port, fakeCatalog().port, { checkpoint, identity: identity(2, overrides), block })), "refused");
      expect(outcome).toMatchObject({ code: "checkpoint_mismatch", checkpoint: null, turns: 0 });
      expect(llm.requests).toHaveLength(0);
    }
  });

  it("a tampered checkpoint (a tool result without its call) is refused (checkpoint_invalid)", async () => {
    const checkpoint = await yieldedCheckpoint();
    const tampered = { ...checkpoint, messages: [checkpoint.messages[0]!, { role: "assistant", content: [] }, checkpoint.messages[2]!] } as BuildLoopCheckpoint;
    const llm = scriptedLlm(threeTurns);
    const outcome = expectStatus(await runBlockSlice(sliceInput(llm.port, fakeCatalog().port, { checkpoint: tampered, identity: identity(2) })), "refused");
    expect(outcome.code).toBe("checkpoint_invalid");
    expect(outcome.error).toMatch(/a tool result must answer a call of the turn right before it/);
    expect(llm.requests).toHaveLength(0);
  });

  it("an already saved block answers its saved result again under the new slice's identity, with no provider call", async () => {
    const saved = expectStatus(await runBlockSlice(sliceInput(scriptedLlm(threeTurns).port, fakeCatalog().port)), "submitted");
    const llm = scriptedLlm(threeTurns);
    const again = expectStatus(await runBlockSlice(sliceInput(llm.port, fakeCatalog().port, { checkpoint: saved.checkpoint, identity: identity(2) })), "submitted");
    expect(again).toMatchObject({ turns: 0, usage: { modelCalls: 0 } });
    expect(again.result).toEqual(saved.result);
    expect(again.checkpoint.sliceId).toBe(identity(2).sliceId);
    expect(llm.requests).toHaveLength(0);
  });
});
