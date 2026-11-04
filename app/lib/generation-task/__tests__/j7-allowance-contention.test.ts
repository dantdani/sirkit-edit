/**
 * [PR-J, 2026-11-04] Runbook J.7, increment J7-2 (multi-sheet/workload-limits.md, "J7-2, allowance contention"; J.9: "More logical subsystem
 * tasks than concurrent worker slots complete through the queue without missing blocks, uncontrolled spawning, unbounded costs or privilege
 * changes") - proved over the PRODUCTION store, worker and slice runner (`GenerationTaskStore`, `GenerationWorker`, `runGenerationSlice`)
 * with a scripted provider, on the drone planned as EIGHT blocks against a worker of THREE slots.
 *
 * A block slice reserves 6 calls x 8 192 output tokens at its claim, and the claim counts the reservations its running siblings hold. With
 * an operator unit below the run's concurrent peak but at or above its sequential need, a queued block used to park `allowance_exhausted`
 * ("Continue with another allowance") although it fits once a sibling ends. Now, when ONLY live siblings' held reservations stop a claim -
 * or the pre-call input admission - the block is re-queued under a fresh slice id after a bounded deterministic wait and woken by the
 * sibling's end; a genuine exhaustion still parks exactly as before.
 *
 *  1. a unit of 30 model calls (the same run peaks at 31 with the default unit; its sequential need is 28): every block is saved, nothing
 *     omitted, never `allowance_exhausted`, committed (spent + held + uncertain) <= 30 on every head revision, no slice claimed twice, the
 *     re-queues counted and within the bound - tick by tick, and again through the worker's own loop;
 *  2. a unit of 20 calls (below the sequential need): blocks wait while siblings hold, then park `allowance_exhausted` only once their own
 *     need does not fit; "Continue with another allowance" is offered and finishes the design;
 *  3. a demotion to viewer while a block waits for the allowance stops the task at the next claim (`authority_revoked`): the waiting block
 *     never runs, nothing parks, and every claim - the re-queued one included - was revalidated;
 *  4. the card: while a block waits for the allowance the status sentence says so (never "a free worker slot");
 *  5. the pre-call input admission: concurrent blocks whose in-flight input bounds fill the task's input limit re-queue instead of parking;
 *     committed input stays within the limit on every revision and the design completes;
 *  6. the wait bound is derived from the slice policy, and no limit value moved.
 *
 * Fixture proof only: the scripted provider, the in-memory durable repository and a simulated clock - no paid call, no database, no network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/erc", () => ({
  runErc: vi.fn(() => ({ ok: true, errors: [], criticalCount: 0, warningCount: 0, reward: 1 })),
  formatErcFeedback: vi.fn(() => "ERC: offline fixture feedback."),
}));
vi.mock("@/lib/kg", () => ({ kgDesignNotes: vi.fn(() => null) }));

import { InMemoryDurableWorkflowRepository } from "../../durable-workflow/repository";
import { durableAggregateIdentity } from "../../durable-workflow/stable";
import type { LLMRequest, LLMResponse } from "../../llm/types";
import type { BuildLlmPort } from "../../schematic/build-loop-slice";
import { generationTaskStatusText, readGenerationTaskSnapshot, reduceGenerationTaskView } from "../../project/generation-task-client";
import {
  GENERATION_ALLOWANCE_WAIT, GENERATION_SLICE_POLICY, GENERATION_SLICE_TOPIC, GENERATION_TASK_AGGREGATES, GENERATION_TASK_ALLOWANCE_UNIT, GENERATION_TASK_BOUNDS,
  generationAllowanceLimits, generationAllowanceWaitMs, generationCommitted, type GenerationAllowanceUnit, type GenerationTaskHead,
} from "../contracts";
import { buildGenerationTaskSnapshot } from "../snapshot";
import type { GenerationSliceRevalidator } from "../store";
import { GENERATION_QUEUE_WAIT_REASONS, GENERATION_WAITING_REASONS } from "../vocabulary";
import { generationRequestInputBound } from "../worker/accounting";
import { createGenerationSliceRevalidator } from "../worker/runtime";
import { GenerationWorker } from "../worker/worker";
import {
  EDITOR, EIGHT_BLOCKS, EIGHT_BLOCK_CALLS, EIGHT_BLOCK_PROMPT, ScriptedModel, drive, droneCatalog, droneScripts, eightBlockScripts, head, l3Env, membership, settledOrWaiting, startTask,
  type L3Env,
} from "./_l3-worker-fixtures";

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

const SLOTS = 3;
const RESERVED_CALLS = GENERATION_SLICE_POLICY.maxBlockTurnsPerSlice; // one block slice's worst case at its claim
const unitOf = (modelCalls: number): GenerationAllowanceUnit => ({ ...GENERATION_TASK_ALLOWANCE_UNIT, modelCalls });
const REQUEUED = /: requeued \(GENERATION_ALLOWANCE_CONTENDED\)$/;

function deferred<T = void>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  return { promise: new Promise<T>((yes) => { resolve = yes; }), resolve };
}
const heads = async (env: L3Env, taskId: string): Promise<GenerationTaskHead[]> =>
  (await env.repository.history<GenerationTaskHead>(durableAggregateIdentity(env.scope, GENERATION_TASK_AGGREGATES.head, taskId))).map((record) => record.payload);
const blocksWith = (task: GenerationTaskHead, status: string): string[] => (task.plan?.blocks ?? []).filter((block) => task.blocks[block.blockId]!.status === status).map((block) => block.name);
const nameOf = (task: GenerationTaskHead, blockId: string | null): string => task.plan?.blocks.find((block) => block.blockId === blockId)?.name ?? "";

/** What the head history says about the run: the peak committed calls, the re-queues (each a fresh slice id carrying `wait`), their largest
 *  consecutive count, the slices that were ever claimed (with every fence each one was claimed under), and whether anything ever parked. */
function audit(history: readonly GenerationTaskHead[]) {
  const waits = new Map<string, number>(), fences = new Map<string, Set<number>>();
  let peak = 0, allowanceParks = 0;
  for (const revision of history) {
    peak = Math.max(peak, generationCommitted(revision).modelCalls);
    for (const [sliceId, entry] of Object.entries(revision.pending)) {
      if (entry.wait && !waits.has(sliceId)) waits.set(sliceId, entry.wait.requeues);
      if (entry.owner) fences.set(sliceId, new Set([...(fences.get(sliceId) ?? []), entry.owner.fence]));
    }
    allowanceParks += Object.values(revision.blocks).filter((block) => block?.blocker === "allowance_exhausted").length;
  }
  return { peak, requeues: waits.size, maxConsecutive: Math.max(0, ...waits.values()), claimed: fences, allowanceParks };
}

/** The status sentence the task card shows for this head, through the production snapshot and the browser's reader. */
async function cardText(env: L3Env, task: GenerationTaskHead): Promise<string> {
  const processing = (await env.repository.listOutbox({ topic: GENERATION_SLICE_TOPIC, state: "processing" })).map((event) => ({ sliceId: String(event.payload.sliceId), leaseToken: event.leaseToken ?? null, leaseExpiresAt: event.leaseExpiresAt ?? null, leaseOwner: event.leaseOwner ?? null }));
  const snapshot = readGenerationTaskSnapshot(JSON.parse(JSON.stringify(buildGenerationTaskSnapshot(task, { nowMs: env.time.now(), processing }))))!;
  return generationTaskStatusText(reduceGenerationTaskView(null, { task: snapshot, events: task.milestones.map((event) => ({ seq: event.seq, at: event.at, type: event.type, phase: event.phase, blockId: event.blockId, message: event.message })), gap: false }).view);
}

/** The eight blocks tick by tick (each tick claims up to the three slots, then its slices settle). */
async function eightByTicks(name: string, unit: GenerationAllowanceUnit) {
  const env = l3Env({ name, repository: new InMemoryDurableWorkflowRepository(), catalog: droneCatalog() });
  const model = new ScriptedModel(eightBlockScripts(), env.time, () => 1_000);
  const task = await startTask(env, { prompt: EIGHT_BLOCK_PROMPT, allowanceUnit: unit });
  const { task: done } = await drive(env, env.worker({ llm: model, policy: { concurrency: SLOTS } }), task.taskId, { until: settledOrWaiting, maxTicks: 60 });
  return { env, model, task, done, history: await heads(env, task.taskId) };
}

describe("[PR-J J7-2] a block that only waits for its siblings' reservations is re-queued, never parked", () => {
  it("1. a unit of 30 calls: all eight blocks saved, nothing omitted, never allowance_exhausted, committed <= 30 on every revision, no slice claimed twice, re-queues counted and bounded", { timeout: 60_000 }, async () => {
    // the same tick-stepped run with the default unit peaks above 30 (three fresh reservations at once): 30 sits below the concurrent peak
    const reference = await eightByTicks("j7-2-reference", GENERATION_TASK_ALLOWANCE_UNIT);
    expect(reference.done.state).toBe("awaiting-review");
    const referencePeak = audit(reference.history).peak;
    expect(referencePeak).toBe(31);
    expect(audit(reference.history).requeues).toBe(0); // nothing waits under the default unit

    const { env, model, done, history } = await eightByTicks("j7-2-thirty", unitOf(30));
    const evidence = JSON.stringify({ state: done.state, blocker: done.blocker, blocks: Object.values(done.blocks).map((block) => [block?.name, block?.status, block?.blocker]) });
    expect(done.state, evidence).toBe("awaiting-review");
    expect(blocksWith(done, "saved")).toEqual(EIGHT_BLOCKS.map((block) => block.name));
    expect(done.result).toMatchObject({ status: "complete", omittedBlocks: [] });
    const run = audit(history);
    expect(run.allowanceParks).toBe(0);
    expect(history.some((revision) => revision.blocker !== null || revision.milestones.some((event) => event.type === "waiting_resource"))).toBe(false);
    // committed (spent + held + uncertain) within the unit on every head revision; the peak is measured
    for (const revision of history) expect(generationCommitted(revision).modelCalls, `revision at ${revision.updatedAt}`).toBeLessThanOrEqual(30);
    expect(run.peak).toBe(28);
    expect(run.peak).toBeLessThan(referencePeak);
    // the re-queue happened (the eighth block's claim met the reservation the seventh held), is counted, and is within the bound
    expect(run.requeues).toBe(1);
    expect(run.maxConsecutive).toBeLessThanOrEqual(GENERATION_ALLOWANCE_WAIT.maxRequeues);
    expect(env.logs.filter((line) => REQUEUED.test(line))).toHaveLength(run.requeues);
    // no slice claimed twice: each claimed slice id has one owner fence, each outbox event was leased at most once, no turn was asked twice
    for (const [sliceId, fenceSet] of run.claimed) expect(fenceSet.size, sliceId).toBe(1);
    expect(done.usage.attempts).toBe(run.claimed.size);
    const events = await env.repository.listOutbox({ topic: GENERATION_SLICE_TOPIC });
    expect(events.every((event) => event.attempts <= 1)).toBe(true);
    expect(events).toHaveLength(1 + EIGHT_BLOCKS.length + 1 + run.requeues + 1); // the plan, eight blocks, the merge, the re-queue, and its wake
    const turns = model.calls.filter((call) => call.kind === "block").map((call) => `${call.block}#${call.turn}`);
    expect(new Set(turns).size).toBe(turns.length);
    expect(model.calls).toHaveLength(EIGHT_BLOCK_CALLS);
    expect(done.usage).toMatchObject({ modelCalls: EIGHT_BLOCK_CALLS, uncertainModelCalls: 0 });
    expect(done.reservations).toEqual([]);
    expect(done.allowance).toMatchObject({ units: 1, extensions: [] });
    expect(Object.keys(done.pending)).toEqual([]);

    // the worker's own loop (a freed slot is refilled while the others still run): the same guarantees
    const live = l3Env({ name: "j7-2-thirty-loop", repository: new InMemoryDurableWorkflowRepository(), catalog: droneCatalog() });
    const loopModel = new ScriptedModel(eightBlockScripts(), live.time, () => 1_000);
    const loopTask = await startTask(live, { prompt: EIGHT_BLOCK_PROMPT, allowanceUnit: unitOf(30) });
    const worker = live.worker({ llm: loopModel, policy: { concurrency: SLOTS, idleTickMs: 5 } });
    worker.start();
    const started = performance.now();
    let settled = await head(live, loopTask.taskId);
    while (!settledOrWaiting(settled) && performance.now() - started < 30_000) { await new Promise<void>((resolve) => { setTimeout(resolve, 5); }); settled = await head(live, loopTask.taskId); }
    await worker.stop({ graceMs: 0 });
    expect(settled.state, JSON.stringify(settled.blocker)).toBe("awaiting-review");
    expect(blocksWith(settled, "saved")).toHaveLength(EIGHT_BLOCKS.length);
    const loopHistory = await heads(live, loopTask.taskId), loopRun = audit(loopHistory);
    for (const revision of loopHistory) expect(generationCommitted(revision).modelCalls).toBeLessThanOrEqual(30);
    expect(loopRun.allowanceParks).toBe(0);
    expect(loopRun.maxConsecutive).toBeLessThanOrEqual(GENERATION_ALLOWANCE_WAIT.maxRequeues);
    expect(live.logs.filter((line) => REQUEUED.test(line))).toHaveLength(loopRun.requeues);
    for (const [sliceId, fenceSet] of loopRun.claimed) expect(fenceSet.size, sliceId).toBe(1);
    expect((await live.repository.listOutbox({ topic: GENERATION_SLICE_TOPIC })).every((event) => event.attempts <= 1)).toBe(true);
    expect(loopModel.calls).toHaveLength(EIGHT_BLOCK_CALLS);
    console.info(`[j7-2 measured] ticks: peak ${run.peak}/30 (default unit ${referencePeak}), re-queues ${run.requeues}, calls ${model.calls.length}; loop: peak ${loopRun.peak}/30, re-queues ${loopRun.requeues}, calls ${loopModel.calls.length}`);
  });

  it("2. a unit of 20 calls (below the sequential need): blocks wait while siblings hold, then park allowance_exhausted only once their own need does not fit; another allowance finishes the design", { timeout: 60_000 }, async () => {
    const unit = 20;
    const { env, model, task, done, history } = await eightByTicks("j7-2-twenty", unitOf(unit));
    expect(done.state).toBe("waiting-for-resource");
    expect(done.blocker).toMatchObject({ code: "partial_available", evidence: { cause: "allowance_exhausted" } });
    const parked = (done.plan?.blocks ?? []).filter((block) => done.blocks[block.blockId]!.status === "blocked");
    expect(parked.length).toBeGreaterThan(0);
    for (const block of parked) {
      expect(done.blocks[block.blockId], block.name).toMatchObject({ blocker: "allowance_exhausted", turnsUsed: 0 });
      expect(model.callsOf(block.name), block.name).toBe(0); // a parked block never sent a call
    }
    expect(blocksWith(done, "saved").length).toBeGreaterThan(0);
    const run = audit(history);
    expect(run.requeues).toBeGreaterThan(0); // blocks first WAITED for their siblings (the contention was real), then parked
    expect(run.maxConsecutive).toBeLessThanOrEqual(GENERATION_ALLOWANCE_WAIT.maxRequeues);
    for (const revision of history) expect(generationCommitted(revision).modelCalls).toBeLessThanOrEqual(unit);
    // each park happened only when the block's OWN need did not fit: spent + uncertain + every uncertain reservation + 6 > the unit
    for (let index = 1; index < history.length; index += 1) {
      const before = history[index - 1]!, after = history[index]!;
      for (const block of parked) {
        if (before.blocks[block.blockId]?.status === "blocked" || after.blocks[block.blockId]?.status !== "blocked") continue;
        const ownNeed = before.usage.modelCalls + before.usage.uncertainModelCalls + before.reservations.filter((entry) => entry.state === "uncertain").reduce((sum, entry) => sum + entry.modelCalls, 0) + RESERVED_CALLS;
        expect(ownNeed, `${block.name} parked at ${after.updatedAt}`).toBeGreaterThan(unit);
      }
    }
    console.info(`[j7-2 measured] unit 20: saved ${blocksWith(done, "saved").length}, parked ${parked.length}, re-queues ${run.requeues}, peak ${run.peak}/20, calls ${model.calls.length}`);
    // the card offers "Continue with another allowance" (extend-allowance) and the review of the saved blocks
    expect(buildGenerationTaskSnapshot(done, { nowMs: env.time.now(), processing: [] }).actions).toEqual(["cancel", "extend-allowance", "review-partial"]);
    const resumed = await env.store.control({ scope: env.scope, taskId: task.taskId, principal: { principalId: EDITOR, role: "pcb_editor" }, action: "resume", clientActionId: "j7-2-extend", extendAllowance: true });
    expect(resumed.ok).toBe(true);
    const { task: finished } = await drive(env, env.worker({ llm: model, policy: { concurrency: SLOTS } }), task.taskId, { until: settledOrWaiting, maxTicks: 60 });
    expect(finished.state).toBe("awaiting-review");
    expect(finished.result).toMatchObject({ status: "complete", omittedBlocks: [] });
    expect(finished.usage.modelCalls).toBe(EIGHT_BLOCK_CALLS);
    for (const revision of await heads(env, task.taskId)) expect(generationCommitted(revision).modelCalls).toBeLessThanOrEqual(generationAllowanceLimits(revision.allowance).modelCalls);
  });
});

describe("[PR-J J7-2] authority, cancellation and the card while a block waits for the allowance", () => {
  /** Ticks 1-3 (the plan, then six blocks), then tick 4 with the first call of the block it claims first held in the provider: the claim of
   *  the other remaining block meets the reservation the running one holds and is re-queued. (The claim order is the outbox's - by event
   *  id among events committed together - not the plan's.) */
  async function toTheWait(name: string) {
    const env = l3Env({ name, repository: new InMemoryDurableWorkflowRepository(), catalog: droneCatalog() });
    const model = new ScriptedModel(eightBlockScripts(), env.time, () => 1_000);
    const production = createGenerationSliceRevalidator({ membership: () => env.memberships, providerServable: () => true });
    let revalidations = 0;
    const revalidate: GenerationSliceRevalidator = async (task) => { revalidations += 1; return production(task); };
    const worker = new GenerationWorker({ store: env.store, workerId: `worker-${name}`, ports: { llm: model, catalog: droneCatalog() }, revalidate, clock: env.time.clock, random: () => 0.5, timers: env.time, policy: { concurrency: SLOTS }, log: (line) => env.logs.push(line) });
    const task = await startTask(env, { prompt: EIGHT_BLOCK_PROMPT, allowanceUnit: unitOf(30) });
    for (let tick = 0; tick < 3; tick += 1) await worker.runOnce();
    expect(blocksWith(await head(env, task.taskId), "saved")).toHaveLength(6);
    const remaining = blocksWith(await head(env, task.taskId), "queued");
    expect(remaining).toHaveLength(2);
    const held = deferred(), reached = deferred<string>();
    model.intercept = async (_request, kind, block) => {
      if (kind !== "block") return undefined;
      reached.resolve(block);
      await held.promise;
      return undefined;
    };
    const fourth = worker.runOnce();
    const running = await reached.promise;
    const waiter = remaining.find((block) => block !== running)!;
    const waiting = await head(env, task.taskId);
    return { env, model, worker, task, waiting, running, waiter, fourth, release: () => { model.intercept = null; held.resolve(); }, revalidations: () => revalidations };
  }

  it("3. a demotion to viewer while a block waits for the allowance stops the next claim (authority_revoked): the waiting block never runs and nothing parks", { timeout: 60_000 }, async () => {
    const { env, model, worker, task, waiting, running, waiter, fourth, release, revalidations } = await toTheWait("j7-2-demotion");
    // the waiter waits for the allowance the running block holds: queued again under a fresh slice id, never parked
    const entries = Object.values(waiting.pending);
    expect(entries.filter((entry) => entry.owner !== null).map((entry) => nameOf(waiting, entry.blockId))).toEqual([running]);
    expect(entries.filter((entry) => entry.wait).map((entry) => [nameOf(waiting, entry.blockId), entry.wait])).toEqual([[waiter, { reason: "allowance", requeues: 1 }]]);
    expect(Object.values(waiting.blocks).find((block) => block?.name === waiter)).toMatchObject({ status: "queued", blocker: null });
    expect(revalidations()).toBe(waiting.usage.attempts + 1); // every claim was revalidated - the re-queued one too
    // the requester is demoted while the block waits
    env.memberships.set(membership(env.scope, EDITOR, "viewer"));
    release();
    await fourth; // the running block finishes (its slice was already running) and its end wakes the waiter
    const calls = model.calls.length;
    const next = await worker.runOnce();
    expect(next.tick.started).toEqual([]);
    expect(next.tick.claims.find((claim) => claim.outcome === "failed")).toMatchObject({ code: "authority_revoked" });
    const failed = await head(env, task.taskId);
    expect(failed).toMatchObject({ state: "failed", failure: { reason: "authority_revoked" }, pending: {} });
    expect(model.calls.length).toBe(calls);
    expect(model.callsOf(waiter)).toBe(0);
    const history = await heads(env, task.taskId);
    expect(audit(history).allowanceParks).toBe(0);
    for (const revision of history) {
      expect(revision.initiator).toEqual(task.initiator);
      expect(revision.allowance).toEqual(task.allowance);
      expect(generationCommitted(revision).modelCalls).toBeLessThanOrEqual(30);
    }
    expect((await worker.runOnce()).tick.started).toEqual([]);
  });

  it("3b. a cancel while a block waits for the allowance stops it: the waiting block never runs", { timeout: 60_000 }, async () => {
    const { env, model, worker, task, waiter, fourth, release } = await toTheWait("j7-2-cancel");
    const cancel = await env.store.control({ scope: env.scope, taskId: task.taskId, principal: { principalId: EDITOR, role: "pcb_editor" }, action: "cancel", clientActionId: "j7-2-cancel" });
    expect(cancel).toMatchObject({ ok: true, task: { state: "cancel-requested" } });
    release();
    await fourth;
    for (let tick = 0; tick < 3; tick += 1) await worker.runOnce();
    const ended = await head(env, task.taskId);
    expect(ended).toMatchObject({ state: "cancelled", pending: {} });
    expect(model.callsOf(waiter)).toBe(0);
    expect(audit(await heads(env, task.taskId)).allowanceParks).toBe(0);
  });

  it("4. the card says a waiting block waits for a running block's reserved allowance, never for a free worker slot", { timeout: 60_000 }, async () => {
    const { env, task, waiting, running, fourth, release, worker } = await toTheWait("j7-2-card");
    expect(await cardText(env, waiting)).toBe(`Running: designing "${running}"; 1 more block(s) waiting for a running block to release its reserved allowance.`);
    release();
    await fourth;
    await drive(env, worker, task.taskId, { until: settledOrWaiting, maxTicks: 10 });
    const done = await head(env, task.taskId);
    expect(done.state).toBe("awaiting-review");
    expect(buildGenerationTaskSnapshot(done, { nowMs: env.time.now(), processing: [] }).plan!.blocks.some((block) => "waiting" in block)).toBe(false); // the mark lives only while the block waits

    // the browser's reader and sentence: slot, allowance and provider waits each said for what they are; nothing else changes the sentence
    const at = new Date(env.time.now()).toISOString();
    const block = (index: number, status: string, waitingFor?: string) => ({ blockId: `b${index}`, name: String.fromCharCode(64 + index), status, strategy: "S1-baseline", turnsUsed: 0, blocker: null, ...(waitingFor ? { waiting: waitingFor } : {}) });
    const view = (blocks: object[], events: Array<{ seq: number; type: string; blockId: string }> = []) => reduceGenerationTaskView(null, {
      task: readGenerationTaskSnapshot({ schema: "sirkit.generation-task-snapshot.v1", taskId: "generation-task:" + "e".repeat(32), clientRequestId: "00000000-0000-4000-8000-000000000001", scope: { tenantId: "t", projectId: "p", branchId: "main" }, state: "running", terminal: false, phase: "designing", provider: "openai", createdAt: at, updatedAt: at, serverNow: at, liveness: { state: "running", since: null, retryAt: null }, plan: { planner: "planned", rationale: "", assumptions: [], blocks }, blocker: null, failure: null, usage: { slices: 1, attempts: 1, modelCalls: 1, uncertainModelCalls: 0, inputTokens: 0, outputTokens: 0, catalogSearches: 0, cacheHits: 0 }, base: { schematicDigest: "eng1-0123456789abcdef0123456789abcdef", recipe: "build-pin", moved: false }, result: null, review: null, control: { cancelRequested: false, pauseRequested: false }, actions: ["cancel", "pause"], retryBlocks: [], eventCursor: events.length, activity: [] })!,
      events: events.map((event) => ({ ...event, at, phase: "designing", message: `m${event.seq}` })), gap: false,
    }).view;
    expect(generationTaskStatusText(view([block(1, "designing"), block(2, "designing"), block(3, "queued", "allowance"), block(4, "queued"), block(5, "queued", "allowance"), block(6, "queued")], [{ seq: 1, type: "waiting_provider", blockId: "b6" }, { seq: 2, type: "waiting_provider", blockId: "b5" }])))
      .toBe('Running: designing "A", "B"; 1 more block(s) queued for a free worker slot; 2 more block(s) waiting for a running block to release its reserved allowance; 1 more block(s) waiting for the model provider.');
    expect(generationTaskStatusText(view([block(1, "designing"), block(2, "queued")]))).toBe('Running: designing "A"; 1 more block(s) queued for a free worker slot.'); // unchanged without the mark
    expect(readGenerationTaskSnapshot({ ...JSON.parse(JSON.stringify(buildGenerationTaskSnapshot(waiting, { nowMs: env.time.now(), processing: [] }))), plan: { planner: "planned", rationale: "", assumptions: [], blocks: [block(1, "queued", "anything else")] } })!.plan!.blocks[0]).not.toHaveProperty("waiting"); // an unknown mark is dropped
  });
});

describe("[PR-J J7-2] the pre-call input admission", () => {
  /** Every call's bound (as the admission computes it) and a reported input of 40 % of it. */
  class ReportingPort implements BuildLlmPort {
    readonly bounds: number[] = [];
    readonly reported: number[] = [];
    constructor(readonly inner: ScriptedModel) {}
    async generate(request: LLMRequest): Promise<LLMResponse> {
      const bound = generationRequestInputBound(request);
      this.bounds.push(bound);
      const response = await this.inner.generate(request);
      const input = Math.floor(bound * 0.4);
      this.reported.push(input);
      return { ...response, usage: { inputTokens: input, outputTokens: 60 } };
    }
  }

  it("5. concurrent blocks whose in-flight input bounds fill the task's input limit re-queue instead of parking; committed input stays within the limit and the design completes", { timeout: 60_000 }, async () => {
    // calibration (one slice at a time, a limit that never binds): the calls' bounds and the reported input
    const calibration = l3Env({ name: "j7-2-input-calibration", repository: new InMemoryDurableWorkflowRepository(), catalog: droneCatalog() });
    const calibrationModel = new ScriptedModel(droneScripts(), calibration.time, () => 1_000);
    const calibrationPort = new ReportingPort(calibrationModel);
    const calibrated = await startTask(calibration, { allowanceUnit: { ...GENERATION_TASK_ALLOWANCE_UNIT, inputTokens: 50_000_000 } });
    await drive(calibration, calibration.worker({ llm: calibrationPort }), calibrated.taskId, { until: (current) => current.state === "awaiting-review", maxTicks: 30 });
    // a limit EVERY order of these calls fits one at a time (the reported input of all of them, plus the largest bound's unreported part),
    // but not three calls in flight at once late in the run
    const limit = sum(calibrationPort.reported) + Math.max(...calibrationPort.bounds.map((bound) => bound - Math.floor(bound * 0.4)));
    const env = l3Env({ name: "j7-2-input", repository: new InMemoryDurableWorkflowRepository(), catalog: droneCatalog() });
    const model = new ScriptedModel(droneScripts(), env.time, () => 1_000);
    const port = new ReportingPort(model);
    const task = await startTask(env, { allowanceUnit: { ...GENERATION_TASK_ALLOWANCE_UNIT, inputTokens: limit } });
    const { task: done } = await drive(env, env.worker({ llm: port, policy: { concurrency: SLOTS } }), task.taskId, { until: settledOrWaiting, maxTicks: 60 });
    const evidence = JSON.stringify({ state: done.state, blocker: done.blocker, blocks: Object.values(done.blocks).map((block) => [block?.name, block?.status, block?.blocker, block?.turnsUsed]) });
    expect(done.state, evidence).toBe("awaiting-review");
    expect(done.result).toMatchObject({ status: "complete", omittedBlocks: [] });
    const history = await heads(env, task.taskId);
    for (const revision of history) expect(generationCommitted(revision).inputTokens, `revision at ${revision.updatedAt}`).toBeLessThanOrEqual(limit);
    expect(sum(port.reported)).toBeLessThanOrEqual(limit);
    // the admission met live siblings' in-flight input and re-queued (nothing sent for the refused call), never allowance_exhausted
    const contended = env.logs.filter((line) => /sirkit_input_allowance_contended/.test(line));
    expect(contended.length).toBeGreaterThan(0);
    expect(audit(history).allowanceParks).toBe(0);
    expect(env.logs.some((line) => /sirkit_input_allowance_exhausted|platform_failure/.test(line))).toBe(false);
    expect(history.at(-1)!.milestones.some((event) => event.type === "slice_yielded" && /did not fit the input allowance while other blocks held theirs; nothing was sent/.test(event.message))).toBe(true);
    // the same calls as one at a time: none sent twice, none lost
    const turns = model.calls.filter((call) => call.kind === "block").map((call) => `${call.block}#${call.turn}`);
    expect(new Set(turns).size).toBe(turns.length);
    expect(model.calls).toHaveLength(calibrationModel.calls.length);
    expect(done.usage.uncertainModelCalls).toBe(0);
    console.info(`[j7-2 measured] input: limit ${limit}, admission re-queues ${contended.length}, calls ${model.calls.length}, peak committed input ${Math.max(...history.map((revision) => generationCommitted(revision).inputTokens))}`);
  });
});

describe("[PR-J J7-2] the wait's bound and the vocabulary", () => {
  it("6. the waits are deterministic and capped, their sum outlasts the longest a live sibling holds its reservation, and no limit value moved", () => {
    const waits = Array.from({ length: GENERATION_ALLOWANCE_WAIT.maxRequeues }, (_, index) => generationAllowanceWaitMs(index + 1));
    expect(waits).toEqual([5_000, 10_000, 20_000, 40_000, ...Array.from({ length: GENERATION_ALLOWANCE_WAIT.maxRequeues - 4 }, () => 60_000)]);
    expect(Math.max(...waits)).toBe(GENERATION_ALLOWANCE_WAIT.capMs);
    expect(sum(waits)).toBeGreaterThan(GENERATION_SLICE_POLICY.blockWindowMs + GENERATION_SLICE_POLICY.perCallMs + GENERATION_SLICE_POLICY.leaseMs);
    // the queue's wait is its own closed word; the provider's waiting reasons are unchanged
    expect(GENERATION_QUEUE_WAIT_REASONS).toEqual(["allowance"]);
    expect(GENERATION_WAITING_REASONS).toEqual(["rate_limit", "overloaded", "timeout", "network", "admission"]);
    // J.7 moves no limit value
    expect(GENERATION_TASK_ALLOWANCE_UNIT).toEqual({ modelCalls: 60, outputTokens: 480_000, catalogSearches: 300, wallClockMs: 72 * 3_600_000 });
    expect([GENERATION_SLICE_POLICY.maxBlockTurnsPerSlice, GENERATION_SLICE_POLICY.turnOutputTokens, GENERATION_SLICE_POLICY.workerConcurrency, GENERATION_SLICE_POLICY.planAttempts, GENERATION_TASK_BOUNDS.blocks, GENERATION_TASK_BOUNDS.pending, GENERATION_TASK_BOUNDS.reservations]).toEqual([6, 8_192, 3, 2, 8, 16, 12]);
  });
});

function sum(values: readonly number[]): number { return values.reduce((total, value) => total + value, 0); }
