/**
 * [PR-L, 2026-10-17] Runbook L.7 item 3 (increment 3; task-worker-contract.md sections 3.2-3.4 and 4): ownership, fencing and honest
 * failure through the real `GenerationWorker` and `GenerationTaskStore`:
 *
 *  1. a HUNG provider call is abandoned at `perCallMs`; the slice waits with a backoff, its call charged as uncertain at the worst case,
 *     and a new attempt continues the block from its committed checkpoint under valid ownership;
 *  2. a slice whose lease lapses is taken by a SECOND worker (a newer fence); when the first worker's late answer finally arrives it
 *     commits nothing - no checkpoint revision, no end - and its attempt's reservation stays uncertain;
 *  3. a duplicate or stale slice event is a no-op (no model call, no head change), and two workers ticking at once never run one slice
 *     twice;
 *  4. a slice that loses its worker again and again becomes the visible `platform_failure` blocker after `maxAttemptsPerSlice`, with
 *     nothing left queued - never an infinitely failing queue;
 *  5. a principal revoked while the task waits makes the next continuation commit `failed` / `authority_revoked`, with no model call;
 *  6. the worker claims only its free capacity, each slice under its own lease, and runs them concurrently;
 *  7. a cancel seen by the control poll aborts the in-flight call; the slice settles the cancel and the late answer is never committed;
 *  8. S3: the generic effects dispatcher never claims the slice topic, even when asked for it;
 *  9. a pause lets the running slice finish its turn and yield at the boundary with its checkpoint (nothing more is scheduled); a resume
 *     schedules fresh slices and the design continues from that checkpoint;
 * 10. a worker shutdown asks running slices to yield at their next boundary and, after the grace, aborts and RELEASES the rest for
 *     immediate takeover: another worker continues at once from the last checkpoint (no lease left to lapse).
 *
 * Fake model and catalog ports, the in-memory durable repository, a simulated clock. No provider, no database, no network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({ repository: null as unknown }));
vi.mock("@/lib/erc", () => ({
  runErc: vi.fn(() => ({ ok: true, errors: [], criticalCount: 0, warningCount: 0, reward: 1 })),
  formatErcFeedback: vi.fn(() => "ERC: offline fixture feedback."),
}));
vi.mock("@/lib/kg", () => ({ kgDesignNotes: vi.fn(() => null) }));
// S3's dispatcher resolves the process repository; here it is this suite's in-memory one (never a database)
vi.mock("../../durable-workflow/runtime", () => ({ getDurableWorkflowRepository: () => harness.repository }));

import { InMemoryDurableWorkflowRepository } from "../../durable-workflow/repository";
import { durableAggregateIdentity } from "../../durable-workflow/stable";
import { dispatchDurableEffects } from "../../durable-workflow/effects-runtime";
import type { LLMResponse } from "../../llm/types";
import type { BuildLoopCheckpoint } from "../checkpoint";
import { GENERATION_SLICE_CONTRACT, GENERATION_SLICE_EVENT, GENERATION_SLICE_POLICY, GENERATION_SLICE_TOPIC, GENERATION_TASK_AGGREGATES } from "../contracts";
import { COMPONENT_RESOLUTION_SLICE_CONTRACT, COMPONENT_RESOLUTION_SLICE_EVENT, COMPONENT_RESOLUTION_SLICE_TOPIC, COMPONENT_RESOLUTION_TASK_AGGREGATE } from "../../component-resolution/task/contracts"; // [PR-L/M integration, 2026-10-18] M2-SEC-10 / M2-1: the second worker-owned topic
import type { WorkerTimers } from "../worker/worker";
import { ScriptedModel, droneCatalog, droneScripts, drive, head, l3Env, membership, reply, settle, startTask, type L3Env } from "./_l3-worker-fixtures";

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

/** Timers that never fire an interval: a worker that never notices anything between its own boundaries (a stalled or dying process). */
const DEAF: WorkerTimers = { setInterval: () => null, clearInterval: () => undefined, setTimeout: (run, ms) => setTimeout(run, ms), clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) };
function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  return { promise: new Promise<T>((yes) => { resolve = yes; }), resolve };
}
const NEVER = new Promise<LLMResponse>(() => undefined);
const blockRecords = async (env: L3Env, taskId: string, block: string) => (await env.repository.history<BuildLoopCheckpoint>(durableAggregateIdentity(env.scope, GENERATION_TASK_AGGREGATES.block, `${taskId}/${block}`))).map((record) => record.payload);
const SINGLE_PLAN = (): LLMResponse => reply([]); // no submit_plan: the request is designed as ONE block ("main")

describe("[PR-L L.7-3] ownership, fencing and honest failure", () => {
  it("1. a hung call is abandoned at perCallMs; the slice waits with a backoff and a new attempt continues from the committed checkpoint", { timeout: 60_000 }, async () => {
    const env = l3Env({ name: "f1", repository: new InMemoryDurableWorkflowRepository(), catalog: droneCatalog() });
    let hang = true;
    const model = new ScriptedModel(droneScripts(), env.time, () => 1_000);
    model.intercept = (request, kind, block) => {
      const turn = request.messages.filter((message) => message.role === "assistant").length + 1;
      if (kind === "block" && block === "Power" && turn === 2 && hang) { hang = false; return NEVER; }
      return undefined;
    };
    const task = await startTask(env);
    // the per-call bound is measured on the slice's clock (simulated here): the 1 s calls fit it; the hung call is abandoned when its
    // 3 s timer fires (a real 3 s wait in this test)
    const { task: done } = await drive(env, env.worker({ llm: model, policy: { perCallMs: 3_000 } }), task.taskId, { until: (current) => current.state === "awaiting-review", maxTicks: 30 });
    const power = model.calls.filter((call) => call.kind === "block" && call.block === "Power").map((call) => call.turn);
    expect(power).toEqual([1, 2, 2, 3, 4]); // turn 2 hung, was abandoned, and was asked again by the next attempt
    const waits = done.milestones.filter((event) => event.type === "waiting_provider" && event.blockId === "b2");
    expect(waits.map((event) => event.data.reason)).toEqual(["timeout"]);
    expect(done.usage).toMatchObject({ uncertainModelCalls: 1, uncertainOutputTokens: GENERATION_SLICE_POLICY.turnOutputTokens });
    expect(done.blocks.b2).toMatchObject({ status: "saved", turnsUsed: 4 });
  });

  it("2. a lapsed lease is taken by a second worker; the first worker's late answer commits nothing and its reservation stays uncertain", { timeout: 60_000 }, async () => {
    const env = l3Env({ name: "f2", repository: new InMemoryDurableWorkflowRepository(), catalog: droneCatalog() });
    const held = deferred<LLMResponse>();
    let first = true;
    const model = new ScriptedModel(droneScripts(), env.time, () => 1_000);
    model.intercept = (_request, kind) => {
      if (kind === "block" && first) { first = false; return held.promise; }
      return undefined;
    };
    const task = await startTask(env);
    const workerA = env.worker({ llm: model, workerId: "worker-a", timers: DEAF });
    await workerA.runOnce(); // the plan
    const tick = await workerA.tick(); // one block slice starts; its first call is held
    expect(tick.started).toHaveLength(1);
    const sliceA = tick.started[0]!;
    await model.whenBlockCalls(1);
    const blockA = (await head(env, task.taskId)).pending[sliceA]!.blockId!;
    // worker A stalls past its 45 s lease; worker B claims everything claimable, A's lapsed slice included, and finishes it
    env.time.jump(env.time.now() + GENERATION_SLICE_POLICY.leaseMs + 15_000);
    const workerB = env.worker({ llm: model, workerId: "worker-b", policy: { concurrency: 3 } });
    const { task: done } = await drive(env, workerB, task.taskId, { until: (current) => current.state === "awaiting-review", maxTicks: 30 });
    expect(done.blocks[blockA]).toMatchObject({ status: "saved" });
    const ownerB = (await blockRecords(env, task.taskId, blockA)).at(-1)!;
    expect(ownerB).toMatchObject({ sliceId: sliceA, attempt: 2 });
    const revisionsBefore = (await blockRecords(env, task.taskId, blockA)).length;
    const headBefore = await env.repository.loadHead(durableAggregateIdentity(env.scope, GENERATION_TASK_AGGREGATES.head, task.taskId));
    // now A's provider answers, late: A's boundary finds another owner and stops; nothing of A is written
    held.resolve(reply([{ id: "call_late", name: "search_parts", input: { query: "logic level mosfet" } }]));
    const [reportA] = await workerA.idle();
    expect(reportA).toMatchObject({ sliceId: sliceA, attempt: 1, outcome: "fenced", state: null });
    expect((await blockRecords(env, task.taskId, blockA)).length).toBe(revisionsBefore);
    expect((await blockRecords(env, task.taskId, blockA)).some((record) => record.sliceId === sliceA && record.attempt === 1)).toBe(false);
    const headAfter = await env.repository.loadHead(durableAggregateIdentity(env.scope, GENERATION_TASK_AGGREGATES.head, task.taskId));
    expect(headAfter!.revision).toBe(headBefore!.revision);
    // A's attempt never ended: its reservation is kept as UNCERTAIN (worst case), not dropped and not settled as exact
    expect(done.reservations).toEqual([expect.objectContaining({ sliceId: sliceA, attempt: 1, state: "uncertain" })]);
  });

  it("3. a duplicate or stale slice event is a no-op, and two workers ticking at once never run one slice twice", { timeout: 60_000 }, async () => {
    const env = l3Env({ name: "f3", repository: new InMemoryDurableWorkflowRepository(), catalog: droneCatalog() });
    const model = new ScriptedModel(droneScripts(), env.time, () => 1_000);
    const task = await startTask(env);
    const [x, y] = [env.worker({ llm: model, workerId: "worker-x", policy: { concurrency: 3 } }), env.worker({ llm: model, workerId: "worker-y", policy: { concurrency: 3 } })];
    for (let round = 0; round < 12; round += 1) {
      await Promise.all([x.runOnce(), y.runOnce()]);
      if ((await head(env, task.taskId)).state === "awaiting-review") break;
    }
    const done = await head(env, task.taskId);
    expect(done.state).toBe("awaiting-review");
    const turns = model.calls.filter((call) => call.kind === "block").map((call) => `${call.block}#${call.turn}`);
    expect(new Set(turns).size).toBe(turns.length); // no turn of any block was asked twice
    expect(model.planCalls).toBe(1);
    // a duplicate delivery of an ended slice (an event of another owner revision naming the same slice id)
    const ended = done.milestones.find((event) => event.type === "block_saved")!;
    const endedSlice = `${task.taskId}:s2`;
    await env.repository.commit({
      scope: env.scope, scopeKey: "l3-duplicate-probe", idempotencyKey: "duplicate-1", committedAt: new Date().toISOString(), result: {},
      operations: [{ aggregateType: "l3.duplicate-probe.v1", aggregateKey: "probe", expectedRevision: 0, payload: { probe: true } }],
      outbox: [{ owner: { aggregateType: "l3.duplicate-probe.v1", aggregateKey: "probe" }, eventType: GENERATION_SLICE_EVENT.eventType, eventVersion: GENERATION_SLICE_EVENT.eventVersion, topic: GENERATION_SLICE_TOPIC, payload: { schema: GENERATION_SLICE_CONTRACT, taskId: task.taskId, sliceId: endedSlice, kind: "block", blockId: ended.blockId }, idempotencyKey: "duplicate-1" }],
    });
    const before = await env.repository.loadHead(durableAggregateIdentity(env.scope, GENERATION_TASK_AGGREGATES.head, task.taskId));
    const calls = model.calls.length;
    const { tick } = await x.runOnce();
    expect(tick.claims).toEqual([{ outcome: "stale-event", taskId: task.taskId, sliceId: null }]);
    expect(model.calls.length).toBe(calls);
    expect((await env.repository.loadHead(durableAggregateIdentity(env.scope, GENERATION_TASK_AGGREGATES.head, task.taskId)))!.revision).toBe(before!.revision);
    expect(await env.repository.listOutbox({ topic: GENERATION_SLICE_TOPIC, state: "pending" })).toEqual([]);
  });

  it("4. a slice that keeps losing its worker becomes the visible platform_failure blocker after maxAttemptsPerSlice, with nothing left queued", { timeout: 60_000 }, async () => {
    const env = l3Env({ name: "f4", repository: new InMemoryDurableWorkflowRepository(), catalog: droneCatalog() });
    const model = new ScriptedModel({ plan: SINGLE_PLAN, blocks: { "": () => reply([]) } }, env.time, () => 1_000);
    model.intercept = (_request, kind) => (kind === "block" ? NEVER : undefined); // every worker dies inside the block's first call
    const task = await startTask(env);
    await env.worker({ llm: model, workerId: "planner" }).runOnce();
    expect((await head(env, task.taskId)).plan?.blocks.map((block) => block.blockId)).toEqual(["main"]);
    for (let attempt = 1; attempt <= GENERATION_SLICE_POLICY.maxAttemptsPerSlice; attempt += 1) {
      const dying = env.worker({ llm: model, workerId: `dying-${attempt}`, timers: DEAF });
      expect((await dying.tick()).started).toHaveLength(1);
      await model.whenBlockCalls(attempt);
      env.time.jump(env.time.now() + GENERATION_SLICE_POLICY.leaseMs + 1_000); // the process is gone; its lease lapses
    }
    const last = await env.worker({ llm: model, workerId: "survivor" }).runOnce();
    expect(last.tick.claims).toEqual([{ outcome: "blocked", taskId: task.taskId, sliceId: null, code: "platform_failure" }]);
    const parked = await head(env, task.taskId);
    expect(parked.state).toBe("waiting-for-resource");
    expect(parked.blocker).toMatchObject({ code: "platform_failure", blockId: "main" });
    expect(parked.pending).toEqual({});
    expect(model.calls.filter((call) => call.kind === "block")).toHaveLength(GENERATION_SLICE_POLICY.maxAttemptsPerSlice); // the 6th claim made no call
    expect(await env.repository.listOutbox({ topic: GENERATION_SLICE_TOPIC, state: "pending" })).toEqual([]);
    expect(await env.repository.listOutbox({ topic: GENERATION_SLICE_TOPIC, state: "processing" })).toEqual([]);
    expect(parked.usage.uncertainModelCalls + parked.reservations.filter((entry) => entry.state === "uncertain").length).toBeGreaterThan(0); // every lost attempt stays charged
  });

  it("5. a principal revoked while the task waits makes the next continuation fail with authority_revoked and no model call", { timeout: 60_000 }, async () => {
    const env = l3Env({ name: "f5", repository: new InMemoryDurableWorkflowRepository(), catalog: droneCatalog() });
    const model = new ScriptedModel(droneScripts(), env.time, () => 1_000);
    const task = await startTask(env);
    const worker = env.worker({ llm: model });
    await worker.runOnce(); // the plan
    await worker.runOnce(); // one block
    const calls = model.calls.length;
    env.memberships.set(membership(env.scope, "user-l3-editor", "editor", "revoked"));
    const next = await worker.runOnce();
    expect(next.tick.claims[0]).toMatchObject({ outcome: "failed", code: "authority_revoked" });
    const failed = await head(env, task.taskId);
    expect(failed).toMatchObject({ state: "failed", failure: { reason: "authority_revoked" }, pending: {} });
    expect(model.calls.length).toBe(calls);
    expect((await env.store.loadIndex(env.scope)).index.active).toBeNull();
    // a demotion below an editor role is the same refusal
    const demoted = l3Env({ name: "f5-demoted", repository: new InMemoryDurableWorkflowRepository(), catalog: droneCatalog() });
    const second = await startTask(demoted);
    demoted.memberships.set(membership(demoted.scope, "user-l3-editor", "viewer"));
    expect((await demoted.worker({ llm: model }).runOnce()).tick.claims[0]).toMatchObject({ outcome: "failed", code: "authority_revoked" });
    expect((await head(demoted, second.taskId)).state).toBe("failed");
  });

  it("6. the worker claims only its free capacity, each slice under its own lease, and runs them concurrently", { timeout: 60_000 }, async () => {
    const env = l3Env({ name: "f6", repository: new InMemoryDurableWorkflowRepository(), catalog: droneCatalog() });
    const gates = new Map<string, ReturnType<typeof deferred<void>>>();
    const allGated = deferred<void>();
    const model = new ScriptedModel(droneScripts(), env.time, () => 1_000);
    model.intercept = async (_request, kind, block) => {
      if (kind !== "block") return undefined;
      if (!gates.has(block)) { gates.set(block, deferred<void>()); if (gates.size === 3) allGated.resolve(); }
      await gates.get(block)!.promise;
      return undefined;
    };
    const task = await startTask(env);
    const worker = env.worker({ llm: model, policy: { concurrency: 3 } });
    await worker.runOnce(); // the plan
    const tick = await worker.tick();
    expect(tick.started).toHaveLength(3);
    await allGated.promise; // three calls in flight at once
    expect(worker.runningSlices()).toHaveLength(3);
    const leases = await env.repository.listOutbox({ topic: GENERATION_SLICE_TOPIC, state: "processing" });
    expect(new Set(leases.map((event) => event.leaseToken)).size).toBe(3); // each slice under its own lease
    expect((await worker.tick()).started).toEqual([]); // no free slot: nothing more is claimed
    for (const gate of gates.values()) gate.resolve();
    await worker.idle();
    const { task: done } = await drive(env, worker, task.taskId, { until: (current) => current.state === "awaiting-review", maxTicks: 20 });
    expect(done.result).toMatchObject({ status: "complete" });
  });

  it("7. a cancel seen by the control poll aborts the in-flight call; the slice settles the cancel and its late answer is never committed", { timeout: 60_000 }, async () => {
    const env = l3Env({ name: "f7", repository: new InMemoryDurableWorkflowRepository(), catalog: droneCatalog() });
    const held = deferred<LLMResponse>();
    const model = new ScriptedModel(droneScripts(), env.time, () => 1_000);
    let holding = true;
    model.intercept = (_request, kind) => (kind === "block" && holding ? held.promise : undefined);
    const task = await startTask(env);
    const worker = env.worker({ llm: model, policy: { controlPollMs: 2_000 } });
    await worker.runOnce(); // the plan
    const tick = await worker.tick();
    await model.whenBlockCalls(1);
    expect(await env.store.control({ scope: env.scope, taskId: task.taskId, principal: { principalId: "user-l3-editor", role: "pcb_editor" }, action: "cancel", clientActionId: "stop-1" })).toMatchObject({ ok: true, task: { state: "cancel-requested" } });
    const settling = worker.idle(); // the running slice's settlement
    await env.time.advance(2_500); // the control poll fires and aborts the slice
    const [report] = await settling;
    expect(report).toMatchObject({ sliceId: tick.started[0], outcome: "cancelled", state: "cancelled" });
    holding = false;
    held.resolve(reply([{ id: "call_late", name: "search_parts", input: { query: "logic level mosfet" } }]));
    await settle();
    const cancelled = await head(env, task.taskId);
    expect(cancelled).toMatchObject({ state: "cancelled", pending: {} });
    expect(await blockRecordsCount(env, task.taskId)).toBe(0); // the late answer never became a checkpoint
    expect((await worker.runOnce()).tick.started).toEqual([]); // a cancelled task is never restarted
    expect(cancelled.usage.uncertainModelCalls).toBe(1); // the aborted call is charged as uncertain
  });

  it("8. S3: the generic effects dispatcher never claims the slice topic, even when asked for it", { timeout: 60_000 }, async () => {
    const repository = new InMemoryDurableWorkflowRepository();
    harness.repository = repository;
    const env = l3Env({ name: "f8", repository, catalog: droneCatalog() });
    const task = await startTask(env);
    expect(GENERATION_SLICE_TOPIC).toBe("generation-task.slice"); // effects-runtime.ts holds this literal (it does not import the contracts)
    const asked = await dispatchDurableEffects({ workerId: "effects-worker", now: new Date(env.time.now() + 60_000).toISOString(), topics: [GENERATION_SLICE_TOPIC, "passive-policy.invalidate"] });
    expect(asked).toEqual({ claimed: 0, completed: 0, retried: 0, failed: 0 });
    const defaults = await dispatchDurableEffects({ workerId: "effects-worker", now: new Date(env.time.now() + 60_000).toISOString() });
    expect(defaults.claimed).toBe(0);
    const [plan] = await repository.listOutbox({ topic: GENERATION_SLICE_TOPIC });
    expect(plan).toMatchObject({ state: "pending", attempts: 0 });
    expect(plan!.payload).toMatchObject({ taskId: task.taskId, kind: "plan" });
    // [PR-L/M integration, 2026-10-18] M2-SEC-10 / M2-1: the M2 acquisition task's slice topic is worker-owned too (the same outbox, claimed
    // only by the same worker): a generic dispatch that names it claims nothing and leaves the queued slice pending - never failed
    // terminally for want of a handler (DW_EFFECT_HANDLER_MISSING)
    expect(COMPONENT_RESOLUTION_SLICE_TOPIC).toBe("component-resolution-slice"); // effects-runtime.ts holds this literal too
    const acquisitionTaskId = `cr-task:${"ab".repeat(16)}`;
    await repository.commit({
      scope: env.scope, scopeKey: "l3-f8-acquisition", idempotencyKey: "l3-f8-acquisition-start",
      operations: [{ aggregateType: COMPONENT_RESOLUTION_TASK_AGGREGATE, aggregateKey: acquisitionTaskId, expectedRevision: 0, payload: { taskId: acquisitionTaskId } }],
      outbox: [{ owner: { aggregateType: COMPONENT_RESOLUTION_TASK_AGGREGATE, aggregateKey: acquisitionTaskId }, eventType: COMPONENT_RESOLUTION_SLICE_EVENT, eventVersion: 1, topic: COMPONENT_RESOLUTION_SLICE_TOPIC, payload: { contract: COMPONENT_RESOLUTION_SLICE_CONTRACT, taskId: acquisitionTaskId, sliceId: `${acquisitionTaskId}:s1`, kind: "acquire" } }],
      result: {}, committedAt: new Date(env.time.now()).toISOString(),
    });
    const askedAcquisition = await dispatchDurableEffects({ workerId: "effects-worker", now: new Date(env.time.now() + 60_000).toISOString(), topics: [COMPONENT_RESOLUTION_SLICE_TOPIC, "passive-policy.invalidate"] });
    expect(askedAcquisition).toEqual({ claimed: 0, completed: 0, retried: 0, failed: 0 });
    const [acquire] = await repository.listOutbox({ topic: COMPONENT_RESOLUTION_SLICE_TOPIC });
    expect(acquire).toMatchObject({ state: "pending", attempts: 0 });
  });
});

describe("[PR-L L.3] pause and graceful shutdown at a turn boundary", () => {
  it("9. a pause lets the running slice yield at its next boundary with its checkpoint; a resume continues from it", { timeout: 60_000 }, async () => {
    const env = l3Env({ name: "f9", repository: new InMemoryDurableWorkflowRepository(), catalog: droneCatalog() });
    const held = deferred<void>();
    let holding = true;
    const model = new ScriptedModel(droneScripts(), env.time, () => 1_000);
    model.intercept = async (_request, kind) => { if (kind === "block" && holding) { holding = false; await held.promise; } return undefined; };
    const task = await startTask(env);
    const worker = env.worker({ llm: model, timers: DEAF });
    await worker.runOnce(); // the plan
    const tick = await worker.tick();
    await model.whenBlockCalls(1);
    const paused = await env.store.control({ scope: env.scope, taskId: task.taskId, principal: { principalId: "user-l3-editor", role: "pcb_editor" }, action: "pause", clientActionId: "pause-1" });
    expect(paused).toMatchObject({ ok: true, task: { state: "running", control: { pause: { action: "pause" } } } }); // the live owner finishes its turn
    const settling = worker.idle();
    held.resolve();
    const [report] = await settling;
    expect(report).toMatchObject({ sliceId: tick.started[0], outcome: "yielded", state: "paused" });
    const atPause = await head(env, task.taskId);
    expect(atPause.pending).toEqual({});
    const block = Object.values(atPause.blocks).find((entry) => entry?.turnsUsed === 1)!;
    expect(block.artifactRef).not.toBeNull(); // the turn that was running is committed, not lost
    expect((await worker.runOnce()).tick.started).toEqual([]); // a paused task schedules nothing
    expect(await env.store.control({ scope: env.scope, taskId: task.taskId, principal: { principalId: "user-l3-editor", role: "pcb_editor" }, action: "resume", clientActionId: "resume-1" })).toMatchObject({ ok: true, task: { state: "queued" } });
    const { task: done } = await drive(env, worker, task.taskId, { until: (current) => current.state === "awaiting-review", maxTicks: 20 });
    const resumedBlock = done.blocks[block.blockId]!;
    expect(resumedBlock.status).toBe("saved");
    expect(model.calls.filter((call) => call.kind === "block" && call.block === resumedBlock.name).map((call) => call.turn)[1]).toBe(2); // resumed at turn 2
  });

  it("10. a shutdown yields at the next boundary or, after the grace, releases the slice for immediate takeover from its checkpoint", { timeout: 60_000 }, async () => {
    const env = l3Env({ name: "f10", repository: new InMemoryDurableWorkflowRepository(), catalog: droneCatalog() });
    const model = new ScriptedModel(droneScripts(), env.time, () => 1_000);
    let hangSecond = true;
    model.intercept = (request, kind) => {
      const turn = request.messages.filter((message) => message.role === "assistant").length + 1;
      if (kind === "block" && turn === 2 && hangSecond) { hangSecond = false; return NEVER; } // the first block's second call never answers
      return undefined;
    };
    const task = await startTask(env);
    const leaving = env.worker({ llm: model, workerId: "worker-leaving", timers: DEAF });
    await leaving.runOnce(); // the plan
    const tick = await leaving.tick();
    await model.whenBlockCalls(2); // turn 1 committed; turn 2 hangs
    const [report] = await leaving.stop({ graceMs: 50 });
    expect(report).toMatchObject({ sliceId: tick.started[0], outcome: "released", state: "queued" });
    const released = await head(env, task.taskId);
    const entry = released.pending[tick.started[0]!]!;
    expect(entry).toMatchObject({ state: "queued", owner: null });
    expect(Date.parse(entry.notBefore)).toBeLessThanOrEqual(env.time.now()); // takeover at once: no lease left to lapse
    expect(released.reservations.find((reservation) => reservation.sliceId === tick.started[0])).toMatchObject({ state: "uncertain" }); // the abandoned call
    const taker = env.worker({ llm: model, workerId: "worker-taker" });
    const next = await taker.runOnce();
    expect(next.slices[0]).toMatchObject({ sliceId: tick.started[0], attempt: 2 });
    const { task: done } = await drive(env, taker, task.taskId, { until: (current) => current.state === "awaiting-review", maxTicks: 20 });
    expect(done.result).toMatchObject({ status: "complete" });
  });
});

async function blockRecordsCount(env: L3Env, taskId: string): Promise<number> {
  let total = 0;
  for (const block of ["b1", "b2", "b3"]) total += (await blockRecords(env, taskId, block)).length;
  return total;
}
