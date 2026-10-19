/**
 * [PR-L, 2026-10-17] Runbook L.7 item 1 (increment 3; task-worker-contract.md sections 3 and 9): a design that needs MORE than the old
 * request-lifetime allowances (BUILD_BUDGET: 20 turns, 180 s) reaches a complete, validated, reviewable result through the real
 * `GenerationWorker` over the real `GenerationTaskStore`, in many finite slices:
 *
 *  1. the owner's four-motor request is planned into three blocks; "Motor drivers" needs 24 model turns of 55 simulated seconds - each
 *     block slice runs as many turns as its 300 s window allows (5: no turn starts with under 60 s left) and the window's end QUEUES a
 *     continuation (the task is queued, never failed); every block is saved the moment its submission passes; the merge slice writes a
 *     complete result whose shared nets all join two blocks;
 *  2. a turn the window cuts off mid-call is DISCARDED (never synthesized): the next slice asks the provider for the same turn again
 *     from the last committed checkpoint, and the design still completes;
 *  3. the slice windows are finite and the worker's clock is the store's: a block slice never runs past its window, and the
 *     continuation is claimable at once (no lost time between slices).
 *
 * Fake model and catalog ports, the in-memory durable repository, a simulated clock (Date faked; the worker's renewal and control-poll
 * intervals fire as simulated time passes). No provider, no database, no network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/erc", () => ({
  runErc: vi.fn(() => ({ ok: true, errors: [], criticalCount: 0, warningCount: 0, reward: 1 })),
  formatErcFeedback: vi.fn(() => "ERC: offline fixture feedback."),
}));
vi.mock("@/lib/kg", () => ({ kgDesignNotes: vi.fn(() => null) }));

import { InMemoryDurableWorkflowRepository } from "../../durable-workflow/repository";
import { BUILD_BUDGET } from "../../schematic/build-result";
import { generationTaskResultIssue } from "../contracts";
import { NETLISTS, ScriptedModel, T0, droneCatalog, droneScripts, drive, head, l3Env, reply, search, startTask, submit, type BlockScript } from "./_l3-worker-fixtures";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Motor drivers: the MOSFET and diode searches, 21 searches that each surface a NEW catalog candidate, then the submission (24 turns). */
const longMotorBlock: BlockScript = ({ turn }) => {
  if (turn === 1) return reply([search("call_m_1", "logic level mosfet")]);
  if (turn === 2) return reply([search("call_m_2", "schottky flyback diode")]);
  if (turn < 24) return reply([search(`call_m_${turn}`, `motor channel candidate ${turn}`)]);
  return reply([submit("call_m_submit", NETLISTS["Motor drivers"])]);
};

describe("[PR-L L.7-1] a design longer than any single slice or the old request completes through finite slices", () => {
  it("1. three blocks; one needs 24 turns of 55 simulated seconds: each window end queues a continuation, every block is saved at once, and the merge writes a complete reviewable result", { timeout: 120_000 }, async () => {
    const catalog = droneCatalog();
    catalog.generateCandidates = true;
    const env = l3Env({ name: "c1", repository: new InMemoryDurableWorkflowRepository(), catalog });
    const model = new ScriptedModel(droneScripts({ "Motor drivers": longMotorBlock }), env.time, (kind, block) => (kind === "block" && block === "Motor drivers" ? 55_000 : 20_000));
    const task = await startTask(env);
    const worker = env.worker({ llm: model });
    const states: string[] = [];
    const { task: done } = await drive(env, worker, task.taskId, { until: (current) => { states.push(current.state); return current.state === "awaiting-review"; }, maxTicks: 60 });

    // the logical task outlived every finite allowance of the old request-lifetime generation
    const motor = done.blocks.b3!;
    expect(motor).toMatchObject({ name: "Motor drivers", status: "saved", turnsUsed: 24, strategy: "S1-baseline", blocker: null });
    expect(motor.turnsUsed).toBeGreaterThan(BUILD_BUDGET.iterationCap);
    expect(env.time.now() - T0).toBeGreaterThan(BUILD_BUDGET.deadlineMs); // simulated time (the suite's clock), never a wall-clock bound
    expect(env.time.now() - T0).toBeGreaterThan(24 * 55_000);
    // each Motor drivers slice ended at its WINDOW (5 turns of 55 s fit in 300 s with 60 s reserved), never at a failure
    const yields = done.milestones.filter((event) => event.type === "slice_yielded" && event.blockId === "b3");
    expect(yields.length).toBeGreaterThanOrEqual(4);
    expect(yields.every((event) => event.data.turns === 5)).toBe(true);
    expect(states).not.toContain("failed");
    expect(states).not.toContain("waiting-for-resource");
    expect(done.milestones.some((event) => event.type === "failed")).toBe(false);
    // the other blocks were saved by their own slices, before the long block finished
    expect(done.blocks.b1).toMatchObject({ status: "saved", turnsUsed: 4 });
    expect(done.blocks.b2).toMatchObject({ status: "saved", turnsUsed: 4 });
    // accounting is cumulative across every slice: 1 plan call + 4 + 4 + 24 block turns, exact (nothing uncertain)
    expect(done.usage).toMatchObject({ modelCalls: 33, uncertainModelCalls: 0, uncertainOutputTokens: 0 });
    expect(done.usage.slices).toBeGreaterThanOrEqual(1 + 1 + 1 + 5 + 1);
    expect(done.reservations).toEqual([]);
    // the result is a validated, complete, reviewable artifact
    const result = await env.store.readResult(env.scope, done);
    expect(result).not.toBeNull();
    expect(generationTaskResultIssue(result)).toBeNull();
    expect(result!).toMatchObject({ status: "complete", omittedBlocks: [], electricalCheck: { state: "passed" }, planner: { state: "planned", blocks: 3 }, sharedNets: { checked: 7, findings: [] } });
    expect(result!.netlist.components).toHaveLength(3 + 3 + 8);
    expect(result!.blocks.map((block) => block.blockId)).toEqual(["b1", "b2", "b3"]);
    expect(done.result).toMatchObject({ status: "complete", resultDigest: result!.resultDigest });
    expect(done.milestones.map((event) => event.type)).toEqual(expect.arrayContaining(["block_saved", "merge_started", "validation_result", "result_ready"]));
    // the merge revalidated every part the saved netlists use against the catalog
    expect(catalog.byIds.some((ids) => ["p-mcu", "p-fet", "p-reg"].every((id) => ids.includes(id)))).toBe(true);
  });

  it("2. a turn the window cuts off mid-call is discarded, never synthesized: the next slice asks for the same turn again from the committed checkpoint, and the design completes", { timeout: 60_000 }, async () => {
    const env = l3Env({ name: "c2", repository: new InMemoryDurableWorkflowRepository(), catalog: droneCatalog() });
    // every Power call takes 115 simulated seconds: turns 1 and 2 fit the 300 s window; turn 3 starts at 230 s (70 s left, over the 60 s
    // minimum) and its answer arrives at 345 s, after the window ended
    const model = new ScriptedModel(droneScripts(), env.time, (kind, block) => (kind === "block" && block === "Power" ? 115_000 : 5_000));
    const task = await startTask(env);
    const worker = env.worker({ llm: model });
    const { task: done } = await drive(env, worker, task.taskId, { until: (current) => current.state === "awaiting-review", maxTicks: 40 });
    const powerTurns = model.calls.filter((call) => call.kind === "block" && call.block === "Power").map((call) => call.turn);
    // turns 1-2 (115 s each) fit; turn 3 starts at 230 s with 70 s left, ends at 345 s past the 300 s window: discarded, redone next slice
    expect(powerTurns).toEqual([1, 2, 3, 3, 4]);
    const redone = model.requests.filter((request) => /^Block: Power/.test(typeof request.messages[0]!.content === "string" ? request.messages[0]!.content : "") && request.messages.filter((message) => message.role === "assistant").length === 2);
    expect(redone).toHaveLength(2);
    expect(redone[1]!.messages).toEqual(redone[0]!.messages); // the identical committed conversation: the cut turn left no trace
    expect(done.blocks.b2).toMatchObject({ status: "saved", turnsUsed: 4 });
    // the late answer arrived (the provider did the work), so its call is billed exactly even though its turn was discarded: 1 plan call,
    // 4 Flight controller turns, 5 Power calls (one discarded), 3 Motor drivers turns
    expect(done.usage).toMatchObject({ modelCalls: 13, uncertainModelCalls: 0 });
    const result = await env.store.readResult(env.scope, done);
    expect(result).toMatchObject({ status: "complete" });
  });

  it("3. a block slice never runs past its window, and its continuation is claimable at once by the same or another worker", { timeout: 60_000 }, async () => {
    const env = l3Env({ name: "c3", repository: new InMemoryDurableWorkflowRepository(), catalog: droneCatalog() });
    // [PR-L6, 2026-10-19] pin move: each turn searches new words (was: the same two searches alternated - from the third turn on, cached
    // repeats that surface nothing new, which the repeat detector now ends as a no-progress slice after two turns: l6-repeat-turns); the
    // case is about windows and continuations, unchanged
    const model = new ScriptedModel(droneScripts({ "Motor drivers": ({ turn }) => (turn < 12 ? reply([search(`call_${turn}`, turn % 2 ? `logic level mosfet option ${turn}` : `schottky flyback diode option ${turn}`)]) : reply([submit("call_submit", NETLISTS["Motor drivers"])])) }), env.time, () => 40_000);
    const task = await startTask(env);
    const first = env.worker({ llm: model, workerId: "worker-c3-first" });
    // plan, then the three block slices, each run by the first worker; Motor drivers yields at its window with a continuation
    for (let index = 0; index < 4; index += 1) await first.runOnce();
    const queued = await head(env, task.taskId);
    const continuation = Object.entries(queued.pending).find(([, entry]) => entry.blockId === "b3");
    expect(continuation?.[1]).toMatchObject({ kind: "block", state: "queued", owner: null });
    expect(Date.parse(continuation![1].notBefore)).toBeLessThanOrEqual(env.time.now()); // claimable now: no time is lost between slices
    expect(queued.state).toBe("queued");
    const windows = queued.milestones.filter((event) => event.type === "slice_yielded" && event.blockId === "b3");
    expect(windows.length).toBeGreaterThanOrEqual(1);
    // another worker (a restart, a second replica) takes the continuation at once and finishes the design
    const second = env.worker({ llm: model, workerId: "worker-c3-second" });
    const { task: done } = await drive(env, second, task.taskId, { until: (current) => current.state === "awaiting-review", maxTicks: 20 });
    expect(done.blocks.b3).toMatchObject({ status: "saved", turnsUsed: 12 });
    // no Motor drivers slice ran more than its window allows (300 s, 60 s reserved: 6 turns of 40 s at most - here the 6-turn allowance)
    expect(done.milestones.filter((event) => event.type === "slice_yielded" && event.blockId === "b3").every((event) => Number(event.data.turns) <= 6)).toBe(true);
  });
});
