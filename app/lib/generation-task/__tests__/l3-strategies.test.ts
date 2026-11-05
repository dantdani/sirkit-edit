/**
 * [PR-L, 2026-10-17] Runbook L.7 item 5 (increment 3; task-worker-contract.md section 5): no-progress detection by SEMANTIC progress and
 * the strategy ladder, through the real worker and store:
 *
 *  1. four genuinely different strategies fail (S1 repeats a search, S2 keeps submitting a part no search returned, S3 re-searches the
 *     catalog and S4 asks for alternates, each without progress) and S5 - the block split into sub-functions by one planner call -
 *     succeeds; each strategy began its OWN conversation (four distinct first messages after the baseline's), and the history records it;
 *  2. a model that loops identically under every strategy stops burning calls: the ladder ends with `no_progress`, the saved blocks are
 *     kept, nothing is left queued and no later tick calls the model;
 *  3. a part the catalog does not hold ends the ladder at S6 with `missing_part` - zero model calls for S6, the empty search named in the
 *     milestone, the two saved blocks kept as `partial_available`; once the part exists, `retry-block` restarts the block at S3, whose
 *     fresh catalog re-search (bypassing the cache that remembered the empty answer) finds it, and the design completes;
 *  4. a partial result exists only through an explicit `review-partial`: the blocked block is omitted and named, the result is `partial`;
 *  5. a provider quota refusal blocks the block (`provider_quota`) while the saved blocks are kept, with an actionable resolution.
 *
 * Fake model and catalog ports, the in-memory durable repository, a simulated clock; two turns per block slice (the operator-lowered
 * slice allowance) so the ladder is walked in few calls. No provider, no database, no network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/erc", () => ({
  runErc: vi.fn(() => ({ ok: true, errors: [], criticalCount: 0, warningCount: 0, reward: 1 })),
  formatErcFeedback: vi.fn(() => "ERC: offline fixture feedback."),
}));
vi.mock("@/lib/kg", () => ({ kgDesignNotes: vi.fn(() => null) }));

import { InMemoryDurableWorkflowRepository } from "../../durable-workflow/repository";
import type { LLMResponse } from "../../llm/types";
import { NETLISTS, ScriptedModel, alternatesCall, droneCatalog, droneScripts, drive, head, l3Env, part, providerError, reply, search, startTask, submit, type BlockScript } from "./_l3-worker-fixtures";

const editor = { principalId: "user-l3-editor", role: "pcb_editor" as const };
const TWO_TURNS = { blockTurnsPerSlice: 2 };

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

const BAD_PART = { ...NETLISTS["Motor drivers"], components: NETLISTS["Motor drivers"].components.map((component) => ({ ...component, partId: component.partId === "p-fet" ? "p-not-in-any-search" : component.partId })) };
const SUBPLAN = (): LLMResponse => reply([{ id: "call_subplan", name: "submit_plan", input: { rationale: "Split the motor stage.", blocks: [{ name: "Switches", brief: "Four low-side N-MOSFETs.", sharedNets: ["GND"] }, { name: "Clamps", brief: "Four flyback diodes.", sharedNets: ["VBAT"] }] } }]);

describe("[PR-L L.7-5] no-progress detection and the strategy ladder", () => {
  it("1. S1-S4 fail without progress, each from its own fresh start; S5 (the block split) succeeds", { timeout: 60_000 }, async () => {
    const env = l3Env({ name: "s1", repository: new InMemoryDurableWorkflowRepository(), catalog: droneCatalog(), storeOptions: TWO_TURNS });
    const motor: BlockScript = ({ strategy, turn }) => {
      switch (strategy) {
        case "S1-baseline": return reply([search(`s1_${turn}_a`, "logic level mosfet"), search(`s1_${turn}_b`, "schottky flyback diode")]); // the same searches, forever
        case "S2-fresh-seeded": return reply([submit(`s2_${turn}`, BAD_PART)]); // a part no search returned, again and again
        case "S3-catalog-guided": return reply([search(`s3_${turn}`, "logic level mosfet", "Transistors")]);
        case "S4-alternates-guided": return reply([alternatesCall(`s4_${turn}`, "p-fet")]);
        default: return reply([submit(`s5_${turn}`, NETLISTS["Motor drivers"])]); // S5: the split brief, then the whole block at once
      }
    };
    const model = new ScriptedModel({ ...droneScripts({ "Motor drivers": motor }), subplan: SUBPLAN }, env.time, () => 1_000);
    const task = await startTask(env);
    const { task: done } = await drive(env, env.worker({ llm: model }), task.taskId, { until: (current) => current.state === "awaiting-review", maxTicks: 80 });
    const motorBlock = done.blocks.b3!;
    expect(motorBlock.status).toBe("saved");
    expect(motorBlock.strategyHistory.map((entry) => [entry.id, entry.outcome])).toEqual([["S1-baseline", "stagnant"], ["S2-fresh-seeded", "stagnant"], ["S3-catalog-guided", "stagnant"], ["S4-alternates-guided", "stagnant"], ["S5-block-split", "succeeded"]]);
    const changes = done.milestones.filter((event) => event.type === "strategy_changed" && event.blockId === "b3").map((event) => `${event.data.from}>${event.data.to}`);
    // the milestone ring (48) may have rolled past the first changes; the ones it holds are the ladder's, ending at S5
    const ladder = ["S1-baseline>S2-fresh-seeded", "S2-fresh-seeded>S3-catalog-guided", "S3-catalog-guided>S4-alternates-guided", "S4-alternates-guided>S5-block-split"];
    expect(changes.length).toBeGreaterThan(0);
    expect(changes).toEqual(ladder.slice(ladder.length - changes.length));
    // each strategy began its OWN conversation: distinct first messages, each seeded with what the earlier ones established
    const firsts = new Map<string, string>();
    for (const request of model.requests) {
      const call = model.calls[model.requests.indexOf(request)]!;
      if (call.kind === "block" && call.block === "Motor drivers" && !firsts.has(call.strategy)) firsts.set(call.strategy, JSON.stringify(request.messages[0]));
    }
    expect([...firsts.keys()]).toEqual(["S1-baseline", "S2-fresh-seeded", "S3-catalog-guided", "S4-alternates-guided", "S5-block-split"]);
    expect(new Set(firsts.values()).size).toBe(5);
    expect(firsts.get("S2-fresh-seeded")).toContain("p-fet"); // the seed carries the validated catalog facts as data
    expect(firsts.get("S3-catalog-guided")).toContain("The catalog's category names");
    expect(firsts.get("S4-alternates-guided")).toContain("alternates for");
    expect(firsts.get("S5-block-split")).toContain("Switches");
    expect(model.calls.filter((call) => call.kind === "subplan")).toHaveLength(1);
    // S1's repeated searches were answered from the task's facts after the first: no repeated catalog call
    expect(done.usage.cacheHits).toBeGreaterThan(0);
    expect((await head(env, task.taskId)).result).toMatchObject({ status: "complete" });
  });

  it("2. an identical no-progress loop under every strategy stops burning calls: no_progress, saved blocks kept, nothing queued", { timeout: 60_000 }, async () => {
    const env = l3Env({ name: "s2", repository: new InMemoryDurableWorkflowRepository(), catalog: droneCatalog(), storeOptions: TWO_TURNS });
    const loop: BlockScript = ({ turn }) => reply([search(`loop_${turn}`, "logic level mosfet")]);
    const model = new ScriptedModel({ ...droneScripts({ "Motor drivers": loop }), subplan: () => reply([]) }, env.time, () => 1_000);
    const task = await startTask(env);
    const worker = env.worker({ llm: model });
    const { task: parked } = await drive(env, worker, task.taskId, { until: (current) => current.state === "waiting-for-resource", maxTicks: 80 });
    expect(parked.blocks.b3).toMatchObject({ status: "blocked", blocker: "no_progress" });
    expect(parked.blocker).toMatchObject({ code: "partial_available", blockId: "b3", evidence: { savedBlocks: 2, blockedBlocks: 1, cause: "no_progress" } });
    expect(parked.blocks.b1?.status).toBe("saved");
    expect(parked.blocks.b2?.status).toBe("saved");
    expect(parked.pending).toEqual({});
    const loopCalls = model.callsOf("Motor drivers");
    expect(loopCalls).toBeLessThanOrEqual(2 * (4 + 3 + 3 + 3 + 3)); // bounded by the ladder, far below the 60-call allowance
    expect(parked.usage.modelCalls).toBeLessThan(parked.allowance.unit.modelCalls);
    for (let tick = 0; tick < 5; tick += 1) await worker.runOnce();
    expect(model.callsOf("Motor drivers")).toBe(loopCalls); // nothing burns calls while the task waits for a person
    expect(parked.blocks.b3!.strategyHistory.at(-1)).toMatchObject({ id: "S5-block-split", outcome: "exhausted" });
  });

  it("3. a part the catalog lacks ends the ladder at S6 (missing_part, zero calls); once it exists, retry-block restarts at S3, whose fresh re-search finds it", { timeout: 60_000 }, async () => {
    const catalog = droneCatalog();
    const env = l3Env({ name: "s3", repository: new InMemoryDurableWorkflowRepository(), catalog, storeOptions: TWO_TURNS });
    const GATE = part("p-gate", "Offline quad low-side gate driver", "Power Management", ["IN1", "IN2", "IN3", "IN4", "OUT1", "OUT2", "OUT3", "OUT4", "VDD", "GND"]);
    const GATE_NETLIST = { components: [{ refDes: "U9", partId: "p-gate", value: "gate driver", role: "output" }], connections: [{ kind: "label", pin: "U9.IN1", labelName: "PWM1" }, { kind: "label", pin: "U9.GND", labelName: "GND" }, { kind: "label", pin: "U9.VDD", labelName: "VBAT" }], explanation: "One quad driver." };
    const motor: BlockScript = ({ turn, first }) => (first.includes("p-gate") ? reply([submit(`gate_${turn}`, GATE_NETLIST)]) : reply([search(`gate_${turn}`, "quad gate driver ic")]));
    const model = new ScriptedModel({ ...droneScripts({ "Motor drivers": motor }), subplan: () => reply([]) }, env.time, () => 1_000);
    const task = await startTask(env);
    const worker = env.worker({ llm: model });
    const { task: parked } = await drive(env, worker, task.taskId, { until: (current) => current.state === "waiting-for-resource", maxTicks: 80 });
    expect(parked.blocks.b3).toMatchObject({ status: "blocked", blocker: "missing_part", strategy: "S6-missing-part" });
    expect(parked.blocks.b3!.strategyHistory.at(-1)).toEqual({ id: "S6-missing-part", slices: 0, outcome: "exhausted" }); // S6 made no model call
    expect(parked.blocker).toMatchObject({ code: "partial_available", resolution: expect.stringMatching(/retry the blocked block/i), evidence: { cause: "missing_part", savedBlocks: 2 } });
    const named = parked.milestones.find((event) => event.type === "waiting_resource" && event.blockId === "b3");
    expect(named?.message).toContain("quad gate driver ic"); // the missing fact, named; never an invented part
    expect(Object.values(parked.blocks).filter((block) => block?.status === "saved").map((block) => block!.blockId).sort()).toEqual(["b1", "b2"]);
    // the part is added (K's path, outside this test), and the person retries the block
    catalog.add(GATE, /gate driver/i);
    const searchesBefore = catalog.searches.length;
    expect(await env.store.control({ scope: env.scope, taskId: task.taskId, principal: editor, action: "retry-block", clientActionId: "retry-motor", blockId: "b3" })).toMatchObject({ ok: true, task: { state: "queued" } });
    const { task: done } = await drive(env, worker, task.taskId, { until: (current) => current.state === "awaiting-review", maxTicks: 20 });
    expect(catalog.searches.slice(searchesBefore).some((entry) => /gate driver/.test(entry.query))).toBe(true); // a FRESH re-search reached the catalog
    expect(done.blocks.b3).toMatchObject({ status: "saved" });
    expect(done.blocks.b3!.strategyHistory.slice(-2).map((entry) => [entry.id, entry.outcome])).toEqual([["S6-missing-part", "exhausted"], ["S3-catalog-guided", "succeeded"]]);
    expect(done.blocks.b1?.turnsUsed).toBe(parked.blocks.b1?.turnsUsed); // the saved blocks were never redone
    expect((await head(env, task.taskId)).result).toMatchObject({ status: "complete" });
  });

  it("4. a partial result exists only through an explicit review-partial: the blocked block is omitted and named", { timeout: 60_000 }, async () => {
    const env = l3Env({ name: "s4", repository: new InMemoryDurableWorkflowRepository(), catalog: droneCatalog(), storeOptions: TWO_TURNS });
    const model = new ScriptedModel({ ...droneScripts({ "Motor drivers": ({ turn }) => reply([search(`missing_${turn}`, "unobtainium motor bridge")]) }), subplan: () => reply([]) }, env.time, () => 1_000);
    const task = await startTask(env);
    const worker = env.worker({ llm: model });
    const { task: parked } = await drive(env, worker, task.taskId, { until: (current) => current.state === "waiting-for-resource", maxTicks: 80 });
    expect(parked.result).toBeNull(); // blocked work is never silently delivered as partial
    for (let tick = 0; tick < 3; tick += 1) await worker.runOnce();
    expect((await head(env, task.taskId)).result).toBeNull();
    expect(await env.store.control({ scope: env.scope, taskId: task.taskId, principal: editor, action: "review-partial", clientActionId: "partial-1" })).toMatchObject({ ok: true });
    const { task: done } = await drive(env, worker, task.taskId, { until: (current) => current.state === "awaiting-review", maxTicks: 10 });
    expect(done.result).toMatchObject({ status: "partial", omittedBlocks: ["Motor drivers"] });
    const result = await env.store.readResult(env.scope, done);
    expect(result).toMatchObject({ status: "partial", omittedBlocks: ["Motor drivers"] });
    expect(result!.netlist.components.map((component) => component.partId)).not.toContain("p-fet");
  });

  it("5. a provider quota refusal blocks the block (provider_quota) while the saved blocks are kept", { timeout: 60_000 }, async () => {
    const env = l3Env({ name: "s5", repository: new InMemoryDurableWorkflowRepository(), catalog: droneCatalog() });
    const model = new ScriptedModel(droneScripts(), env.time, () => 1_000);
    model.intercept = (_request, kind, block) => { if (kind === "block" && block === "Motor drivers") throw providerError("insufficient_quota"); return undefined; };
    const task = await startTask(env);
    const { task: parked } = await drive(env, env.worker({ llm: model }), task.taskId, { until: (current) => current.state === "waiting-for-resource", maxTicks: 20 });
    expect(parked.blocks.b3).toMatchObject({ status: "blocked", blocker: "provider_quota" });
    expect(parked.blocker).toMatchObject({ code: "partial_available", evidence: { cause: "provider_quota" } });
    expect(model.callsOf("Motor drivers")).toBe(1); // a refusal no retry can fix is not retried
    expect(parked.blocks.b1?.status).toBe("saved");
  });
});
