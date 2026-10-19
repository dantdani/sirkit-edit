/**
 * [PR-L6, 2026-10-19] L.6 part 2, item 7 (limit-and-stall-map.md section 7; L.7 item 5 "identical no-progress loops cannot burn credits
 * forever"): the turn-level repeat detector of a durable slice. A turn REPEATS when every call in it is a search the task's facts answered
 * that surfaced no part the conversation lacked, or a rejected submission identical (fingerprint and codes) to a recorded one. Two
 * consecutive repeat turns end the slice at once as a stagnant slice; the strategy ladder is unchanged.
 *
 *  1. a model repeating one search: each slice ends after two repeat turns (3 calls, then 2 - never the 6 a slice may take), three such
 *     slices end the strategy, the ladder walks on, and the block ends `no_progress` far inside the 60-call allowance;
 *  2. an identical rejected submission is a repeat too (and its made-up partId is never accepted);
 *  3. a turn that surfaces something new is never a repeat.
 *
 * The real worker, store and slice code; a scripted model, a fake catalog, the in-memory durable repository, a simulated clock.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/erc", () => ({
  runErc: vi.fn(() => ({ ok: true, errors: [], criticalCount: 0, warningCount: 0, reward: 1 })),
  formatErcFeedback: vi.fn(() => "ERC: offline fixture feedback."),
}));
vi.mock("@/lib/kg", () => ({ kgDesignNotes: vi.fn(() => null) }));

import { InMemoryDurableWorkflowRepository } from "../../durable-workflow/repository";
import { GENERATION_TASK_ALLOWANCE_UNIT } from "../contracts";
import { ScriptedModel, drive, droneCatalog, l3Env, reply, search, startTask, submit, type BlockScript } from "./_l3-worker-fixtures";

const singleScripts = (main: BlockScript) => ({ plan: () => reply([]), blocks: { "": main } });
const INVENTED = { components: [{ refDes: "Q1", partId: "p-invented", value: "N-MOSFET", role: "output" }], connections: [], explanation: "A part that no search returned." };

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

describe("[PR-L6] two consecutive repeat turns end a slice as stagnant (item 7)", () => {
  it("1. one search repeated: each slice ends after two repeat turns; three stagnant slices advance the ladder; the block ends no_progress inside the allowance", { timeout: 60_000 }, async () => {
    const env = l3Env({ name: "repeat-search", repository: new InMemoryDurableWorkflowRepository(), catalog: droneCatalog() });
    const model = new ScriptedModel(singleScripts(({ turn }) => reply([search(`call_${turn}`, "logic level mosfet")])), env.time, () => 1_000);
    const task = await startTask(env);
    const { task: stopped } = await drive(env, env.worker({ llm: model }), task.taskId, { until: (current) => current.state === "waiting-for-resource", maxTicks: 60 });

    const s1 = model.calls.filter((call) => call.kind === "block" && call.strategy === "S1-baseline").map((call) => call.turn);
    expect(s1).toEqual([1, 2, 3, 4, 5, 6, 7]); // slice 1: a new search, then two repeats; slices 2 and 3: two repeats each (6 calls a slice would allow)
    const repeated = stopped.milestones.filter((event) => event.type === "slice_yielded" && /repeated earlier searches or submissions/.test(event.message));
    expect(repeated.length).toBeGreaterThanOrEqual(2);
    const changes = stopped.milestones.filter((event) => event.type === "strategy_changed").map((event) => `${event.data.from}->${event.data.to}`);
    expect(changes[0]).toBe("S1-baseline->S2-fresh-seeded"); // the ladder is unchanged: S1's three stagnant slices end it
    expect(stopped.blocks.main).toMatchObject({ status: "blocked", blocker: "no_progress" });
    expect(stopped.usage.modelCalls).toBeLessThan(GENERATION_TASK_ALLOWANCE_UNIT.modelCalls);
    expect(stopped.usage.modelCalls).toBe(model.calls.length);
    expect(stopped.blocker).toMatchObject({ code: "no_progress" });
  });

  it("2. an identical rejected submission is a repeat; its made-up partId is never accepted", { timeout: 60_000 }, async () => {
    const env = l3Env({ name: "repeat-submit", repository: new InMemoryDurableWorkflowRepository(), catalog: droneCatalog() });
    const model = new ScriptedModel(singleScripts(({ turn }) => (turn === 1 ? reply([search("call_1", "logic level mosfet")]) : reply([submit(`call_submit_${turn}`, INVENTED)]))), env.time, () => 1_000);
    const task = await startTask(env);
    const { task: first } = await drive(env, env.worker({ llm: model }), task.taskId, { until: (current) => current.milestones.some((event) => event.type === "slice_yielded" && event.blockId === "main"), maxTicks: 5 });
    // turn 2 submits (rejected: UNKNOWN_PART), turns 3 and 4 submit the same arguments again: two repeat turns end the slice
    expect(model.calls.filter((call) => call.kind === "block").map((call) => call.turn)).toEqual([1, 2, 3, 4]);
    expect(first.blocks.main).toMatchObject({ status: "queued", stagnantSlices: 1, strategy: "S1-baseline" });
    const checkpoint = await env.store.readBlock(env.scope, first, "main");
    expect(checkpoint!.submissions.map((entry) => entry.codes)).toEqual([["UNKNOWN_PART"], ["UNKNOWN_PART"], ["UNKNOWN_PART"]]);
    expect(new Set(checkpoint!.submissions.map((entry) => entry.fingerprint)).size).toBe(1);
    expect(checkpoint!.result).toBeNull(); // never saved with the invented part
  });

  it("3. a turn that surfaces a new part is never a repeat, even when another of its searches is cached", { timeout: 60_000 }, async () => {
    const env = l3Env({ name: "repeat-progress", repository: new InMemoryDurableWorkflowRepository(), catalog: droneCatalog() });
    const queries = ["logic level mosfet", "schottky flyback diode", "3.3 v ldo regulator", "imu gyro", "battery connector"];
    // every turn repeats the first search AND makes one new search that surfaces a new part: progress every turn
    const model = new ScriptedModel(singleScripts(({ turn }) => reply([search(`call_${turn}_a`, "logic level mosfet"), search(`call_${turn}_b`, queries[Math.min(turn, queries.length - 1)]!)])), env.time, () => 1_000);
    const task = await startTask(env, { allowanceUnit: { ...GENERATION_TASK_ALLOWANCE_UNIT, modelCalls: 8 } });
    const { task: after } = await drive(env, env.worker({ llm: model }), task.taskId, { until: (current) => current.milestones.some((event) => event.type === "slice_yielded" && event.blockId === "main"), maxTicks: 5 });
    // turns 1-4 each surface a new part, so the slice runs on; only the turns that surface nothing new (5, 6) count as repeats
    expect(model.calls.filter((call) => call.kind === "block").map((call) => call.turn)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(after.milestones.some((event) => /repeated earlier searches/.test(event.message))).toBe(true);
  });
});
