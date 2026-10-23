/**
 * [PR-J, 2026-10-22] Runbook J.7 (OD-255 item 10): "More logical subsystem tasks than concurrent worker slots complete through the queue
 * without missing blocks, uncontrolled spawning, unbounded costs or privilege changes" - proved over the PRODUCTION store, worker and slice
 * runner (`GenerationTaskStore`, `GenerationWorker`, `runGenerationSlice`) with a scripted provider: the drone as EIGHT subsystem blocks
 * (the task's block limit) against a worker of THREE slots.
 *
 *  1. the queue: the worker (asked for 5 slots, held to the durable 3) fills its slots, the other five blocks wait queued - the card says so -
 *     and every block is designed and saved; the merge reads all eight; never more than 3 slices or 3 provider calls at once;
 *  2. no uncontrolled spawning: on every head revision at most one pending slice per block and never more than the planned blocks; no plan
 *     slice after the plan; the plan never changes; one outbox event per scheduled slice, each claimed once;
 *  3. bounded cost: on every head revision spent + held + uncertain stays within the allowance; the usage equals the provider's calls;
 *     the allowance is the one unit the task started with (nothing extended itself) and no reservation is left held;
 *  4. no privilege change: the initiator, request, identities and allowance unit never change; every claim is revalidated; a principal
 *     demoted to viewer while blocks are still queued stops the task at the next claim (authority_revoked) - no further call, the queued
 *     blocks never run;
 *  5. two workers of 3 slots each on the eight blocks: no slice runs twice, every block is saved once, the result is complete;
 *  6. the limit is explicit, never a truncation: a planner that proposes 9 blocks on both attempts is designed as ONE circuit from the
 *     whole request, and the plan_ready milestone names the limit and the remedy (an unreadable plan keeps its own message);
 *  7. the coupled limits move together: the block limit, the block ids, the event data counts, the store's plan refusal and the browser
 *     reader's block list agree, so raising one alone fails here instead of overrunning another.
 *
 * The deprecated synchronous route's loop pool (`BUILD_BUDGET.concurrencyCap`) is moved to 5 in this suite: the durable worker's slots are
 * its own documented constant (contracts.ts `workerConcurrency`) and must not move with it.
 *
 * Fixture proof only: the scripted provider, the in-memory durable repository and a fake clock - no paid call, no database, no network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/erc", () => ({
  runErc: vi.fn(() => ({ ok: true, errors: [], criticalCount: 0, warningCount: 0, reward: 1 })),
  formatErcFeedback: vi.fn(() => "ERC: offline fixture feedback."),
}));
vi.mock("@/lib/kg", () => ({ kgDesignNotes: vi.fn(() => null) }));
vi.mock("../../schematic/build-result", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../schematic/build-result")>();
  return { ...actual, BUILD_BUDGET: Object.freeze({ ...actual.BUILD_BUDGET, concurrencyCap: 5 }) };
});

import { InMemoryDurableWorkflowRepository } from "../../durable-workflow/repository";
import { durableAggregateIdentity } from "../../durable-workflow/stable";
import type { LLMRequest, LLMResponse } from "../../llm/types";
import type { BuildLlmPort } from "../../schematic/build-loop-slice";
import { BUILD_BUDGET } from "../../schematic/build-result";
import { GENERATION_TASK_BLOCK_IDS } from "../../agent/generation-task-tools";
import { generationTaskStatusText, readGenerationTaskSnapshot, reduceGenerationTaskView } from "../../project/generation-task-client";
import { GENERATION_SLICE_POLICY, GENERATION_SLICE_TOPIC, GENERATION_TASK_AGGREGATES, GENERATION_TASK_BOUNDS, generationAllowanceLimits, generationCommitted, type GenerationTaskHead } from "../contracts";
import { generationTaskEvent } from "../events";
import { buildGenerationTaskSnapshot } from "../snapshot";
import type { GenerationSliceRevalidator } from "../store";
import { GENERATION_BLOCK_IDS, GenerationTaskContractError } from "../vocabulary";
import { createGenerationSliceRevalidator } from "../worker/runtime";
import { GenerationWorker } from "../worker/worker";
import {
  EIGHT_BLOCKS, EIGHT_BLOCK_CALLS, EIGHT_BLOCK_DESIGNS, EIGHT_BLOCK_PROMPT, ScriptedModel, droneCatalog, drive, eightBlockScripts, firstText, head, l3Env, membership, planReply, reply, search, settle, startTask, submit,
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
function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  return { promise: new Promise<T>((yes) => { resolve = yes; }), resolve };
}
const isPlanRequest = (request: LLMRequest): boolean => typeof request.toolChoice === "object" && request.toolChoice !== null && request.toolChoice.name === "submit_plan";

/** The provider seam with counters: calls in flight at once (all, and design calls), and the worker's running slices at each call. */
class CountingPort implements BuildLlmPort {
  inFlight = 0;
  peak = 0;
  blockInFlight = 0;
  blockPeak = 0;
  runningPeak = 0;
  workers: GenerationWorker[] = [];
  constructor(readonly inner: ScriptedModel) {}
  async generate(request: LLMRequest): Promise<LLMResponse> {
    const block = !isPlanRequest(request);
    this.inFlight += 1; this.peak = Math.max(this.peak, this.inFlight);
    if (block) { this.blockInFlight += 1; this.blockPeak = Math.max(this.blockPeak, this.blockInFlight); }
    this.runningPeak = Math.max(this.runningPeak, ...this.workers.map((worker) => worker.runningSlices().length));
    try {
      return await this.inner.generate(request);
    } finally {
      this.inFlight -= 1;
      if (block) this.blockInFlight -= 1;
    }
  }
}

const heads = async (env: L3Env, taskId: string): Promise<GenerationTaskHead[]> =>
  (await env.repository.history<GenerationTaskHead>(durableAggregateIdentity(env.scope, GENERATION_TASK_AGGREGATES.head, taskId))).map((record) => record.payload);
const blockStatus = (task: GenerationTaskHead, status: string): string[] => (task.plan?.blocks ?? []).filter((block) => task.blocks[block.blockId]!.status === status).map((block) => block.name);

/** Wait (real time, bounded) until the head meets `until`; the worker's own loop runs meanwhile. */
async function waitFor(env: L3Env, taskId: string, until: (task: GenerationTaskHead) => boolean, maxMs = 30_000): Promise<GenerationTaskHead> {
  const started = performance.now();
  for (;;) {
    const task = await head(env, taskId);
    if (until(task)) return task;
    if (performance.now() - started > maxMs) throw new Error(`the condition did not hold (state ${task.state}, blocks ${JSON.stringify(Object.values(task.blocks).map((block) => [block?.blockId, block?.status]))})`);
    await new Promise<void>((resolve) => { setTimeout(resolve, 5); });
  }
}

/** The status sentence the task card shows for this head, through the production snapshot and the browser's reader. */
async function cardText(env: L3Env, task: GenerationTaskHead): Promise<{ text: string; liveness: string }> {
  const processing = (await env.repository.listOutbox({ topic: GENERATION_SLICE_TOPIC, state: "processing" })).map((event) => ({ sliceId: String(event.payload.sliceId), leaseToken: event.leaseToken ?? null, leaseExpiresAt: event.leaseExpiresAt ?? null, leaseOwner: event.leaseOwner ?? null }));
  const snapshot = readGenerationTaskSnapshot(JSON.parse(JSON.stringify(buildGenerationTaskSnapshot(task, { nowMs: env.time.now(), processing }))))!;
  const view = reduceGenerationTaskView(null, { task: snapshot, events: task.milestones.map((event) => ({ seq: event.seq, at: event.at, type: event.type, phase: event.phase, blockId: event.blockId, message: event.message })), gap: false }).view;
  return { text: generationTaskStatusText(view), liveness: view.liveness.state };
}

interface EightRun { env: L3Env; model: ScriptedModel; port: CountingPort; task: GenerationTaskHead; done: GenerationTaskHead; history: GenerationTaskHead[]; atFull: GenerationTaskHead; card: { text: string; liveness: string } }

/** The eight-block design through ONE worker's own loop (`start()`: a freed slot is refilled while the others still run). The first round
 *  is held in the provider until all three slots are busy, so the queue's state is observed at a known moment. */
async function runEightBlocks(): Promise<EightRun> {
  const env = l3Env({ name: "j7-queue", repository: new InMemoryDurableWorkflowRepository(), catalog: droneCatalog() });
  const model = new ScriptedModel(eightBlockScripts(), env.time, () => 1_000);
  const full = deferred<void>(), release = deferred<void>();
  let held = 0, holding = true;
  model.intercept = async (_request, kind) => {
    if (kind !== "block" || !holding) return undefined;
    held += 1;
    if (held === SLOTS) full.resolve();
    await release.promise;
    return undefined;
  };
  const port = new CountingPort(model);
  const task = await startTask(env, { prompt: EIGHT_BLOCK_PROMPT });
  const worker = env.worker({ llm: port, policy: { concurrency: 5, idleTickMs: 5 } }); // asked for 5: the durable limit holds it to 3
  port.workers = [worker];
  worker.start();
  await full.promise; // three design calls in the provider at once: every slot is busy
  await settle();
  const atFull = await head(env, task.taskId);
  const card = await cardText(env, atFull);
  holding = false;
  release.resolve();
  const done = await waitFor(env, task.taskId, (current) => current.state === "awaiting-review");
  await worker.stop({ graceMs: 0 });
  return { env, model, port, task, done, history: await heads(env, task.taskId), atFull, card };
}
let eightRun: Promise<EightRun> | null = null;
const eight = (): Promise<EightRun> => (eightRun ??= runEightBlocks());

describe("[PR-J J.7] more logical blocks than worker slots complete through the queue", () => {
  it("1. eight blocks, three slots: the rest wait queued (the card says so), every block is saved, the merge reads all eight", { timeout: 60_000 }, async () => {
    // the deprecated route's pool moved (this suite's mock); the durable worker's slots did not
    expect(BUILD_BUDGET.concurrencyCap).toBe(5);
    expect(GENERATION_SLICE_POLICY.workerConcurrency).toBe(SLOTS);
    const { env, done, atFull, card, port, model } = await eight();
    // the moment the slots were full: three blocks designing, five queued - and the card says how many wait and why
    const designing = blockStatus(atFull, "designing");
    expect(designing).toHaveLength(SLOTS);
    expect(blockStatus(atFull, "queued")).toHaveLength(EIGHT_BLOCKS.length - SLOTS);
    expect(atFull.state).toBe("running");
    expect(card.liveness).toBe("running");
    expect(card.text).toBe(`Running: designing ${designing.map((name) => `"${name}"`).join(", ")}; ${EIGHT_BLOCKS.length - SLOTS} more block(s) queued for a free worker slot.`);
    // never more than the slots: slices, provider calls, design calls; and the slots were actually full
    expect(port.runningPeak).toBe(SLOTS);
    expect(port.peak).toBe(SLOTS);
    expect(port.blockPeak).toBe(SLOTS);
    // every block designed and saved; the merge read all eight; nothing omitted
    expect(done.plan!.blocks.map((block) => block.name)).toEqual(EIGHT_BLOCKS.map((block) => block.name));
    expect(done.plan!.blocks.map((block) => block.blockId)).toEqual(GENERATION_BLOCK_IDS.slice(1));
    expect(blockStatus(done, "saved")).toHaveLength(EIGHT_BLOCKS.length);
    expect(done.result).toMatchObject({ status: "complete", omittedBlocks: [] });
    const result = (await env.repository.history<{ blocks: Array<{ blockId: string }>; netlist: { components: unknown[] } }>(durableAggregateIdentity(env.scope, GENERATION_TASK_AGGREGATES.result, done.taskId))).at(-1)!.payload;
    expect(result.blocks.map((block) => block.blockId)).toEqual(GENERATION_BLOCK_IDS.slice(1));
    const parts = EIGHT_BLOCKS.reduce((sum, block) => sum + (EIGHT_BLOCK_DESIGNS[block.name]!.netlist as { components: unknown[] }).components.length, 0);
    expect(result.netlist.components).toHaveLength(parts); // every block's parts are in the merged design
    for (const block of EIGHT_BLOCKS) expect(model.callsOf(block.name), block.name).toBe(EIGHT_BLOCK_DESIGNS[block.name]!.searches.length + 1);
  });

  it("2. no uncontrolled spawning: one pending slice per block at most, no plan after the plan, one event per slice, each claimed once", { timeout: 60_000 }, async () => {
    const { env, done, history } = await eight();
    let planned: GenerationTaskHead["plan"] = null;
    const scheduled = new Set<string>();
    for (const revision of history) {
      const pending = Object.entries(revision.pending);
      for (const [sliceId] of pending) scheduled.add(sliceId);
      const perBlock = new Map<string, number>();
      for (const [, entry] of pending) if (entry.blockId) perBlock.set(entry.blockId, (perBlock.get(entry.blockId) ?? 0) + 1);
      expect(Math.max(0, ...perBlock.values()), `revision at ${revision.updatedAt}`).toBeLessThanOrEqual(1);
      expect(pending.length).toBeLessThanOrEqual(Math.max(1, revision.plan?.blocks.length ?? 1));
      expect(pending.length).toBeLessThanOrEqual(GENERATION_TASK_BOUNDS.pending);
      if (planned) {
        expect(revision.plan).toEqual(planned); // the plan (and its block count) never changes once set
        expect(pending.some(([, entry]) => entry.kind === "plan")).toBe(false);
      } else if (revision.plan) planned = revision.plan;
    }
    expect(planned!.blocks).toHaveLength(EIGHT_BLOCKS.length);
    // one slice per piece of work: the plan, each block once, the merge
    expect(scheduled.size).toBe(1 + EIGHT_BLOCKS.length + 1);
    expect(done.usage).toMatchObject({ slices: scheduled.size, attempts: scheduled.size });
    const events = await env.repository.listOutbox({ topic: GENERATION_SLICE_TOPIC });
    expect(events.map((event) => String(event.payload.sliceId)).sort()).toEqual([...scheduled].sort());
    expect(events.every((event) => event.attempts === 1 && event.state === "completed")).toBe(true);
  });

  it("3. bounded cost: spent + held + uncertain within the allowance on every revision; usage = the provider's calls; nothing extended", { timeout: 60_000 }, async () => {
    const { done, history, model } = await eight();
    for (const revision of history) {
      const limits = generationAllowanceLimits(revision.allowance), committed = generationCommitted(revision);
      expect(committed.modelCalls, `revision at ${revision.updatedAt}`).toBeLessThanOrEqual(limits.modelCalls);
      expect(committed.outputTokens, `revision at ${revision.updatedAt}`).toBeLessThanOrEqual(limits.outputTokens);
      expect(revision.allowance.units).toBe(1);
      expect(revision.allowance.extensions).toEqual([]);
      expect(revision.reservations.length).toBeLessThanOrEqual(GENERATION_TASK_BOUNDS.reservations);
    }
    // the slots' reservations were held at once (the peak), and the work fit one allowance unit
    expect(Math.max(...history.map((revision) => revision.reservations.filter((entry) => entry.state === "held").length))).toBe(SLOTS);
    expect(model.calls).toHaveLength(EIGHT_BLOCK_CALLS);
    expect(done.usage).toMatchObject({ modelCalls: EIGHT_BLOCK_CALLS, uncertainModelCalls: 0, uncertainOutputTokens: 0 });
    expect(done.reservations).toEqual([]);
    expect(done.allowance).toMatchObject({ units: 1, extensions: [] });
  });
});

describe("[PR-J J.7] no privilege change, and two workers on one queue", () => {
  it("4. the principal and the allowance never change; every claim is revalidated; a demotion while blocks are queued stops the next claim", { timeout: 60_000 }, async () => {
    const env = l3Env({ name: "j7-privilege", repository: new InMemoryDurableWorkflowRepository(), catalog: droneCatalog() });
    const model = new ScriptedModel(eightBlockScripts(), env.time, () => 1_000);
    const production = createGenerationSliceRevalidator({ membership: () => env.memberships, providerServable: () => true });
    let revalidations = 0;
    const revalidate: GenerationSliceRevalidator = async (task) => { revalidations += 1; return production(task); };
    const worker = new GenerationWorker({ store: env.store, workerId: "worker-j7-privilege", ports: { llm: model, catalog: droneCatalog() }, revalidate, clock: env.time.clock, random: () => 0.5, timers: env.time, policy: { concurrency: SLOTS } });
    const task = await startTask(env, { prompt: EIGHT_BLOCK_PROMPT });
    await worker.runOnce(); // the plan
    const first = await worker.runOnce(); // three blocks fill the slots and are saved; five stay queued
    expect(first.tick.started).toHaveLength(SLOTS);
    const midway = await head(env, task.taskId);
    expect(blockStatus(midway, "saved")).toHaveLength(SLOTS);
    const queued = blockStatus(midway, "queued");
    expect(queued).toHaveLength(EIGHT_BLOCKS.length - SLOTS);
    expect(revalidations).toBe(1 + SLOTS); // one revalidation per claim
    expect(revalidations).toBe(midway.usage.attempts);
    const calls = model.calls.length;
    // the requester is demoted to viewer while five blocks wait in the queue
    env.memberships.set(membership(env.scope, "user-l3-editor", "viewer"));
    const next = await worker.runOnce();
    expect(next.tick.started).toEqual([]);
    expect(next.tick.claims[0]).toMatchObject({ outcome: "failed", code: "authority_revoked" });
    expect(revalidations).toBe(1 + SLOTS + 1);
    const failed = await head(env, task.taskId);
    expect(failed).toMatchObject({ state: "failed", failure: { reason: "authority_revoked" }, pending: {} });
    expect(model.calls.length).toBe(calls); // no further model call
    for (const name of queued) expect(model.callsOf(name), name).toBe(0); // a queued block never ran
    expect((await worker.runOnce()).tick.started).toEqual([]);
    // on every revision: the same initiator, request, identities and allowance unit; no control was applied
    const history = await heads(env, task.taskId);
    for (const revision of history) {
      expect(revision.initiator).toEqual(task.initiator);
      expect(revision.request).toEqual(task.request);
      expect(revision.identities).toEqual(task.identities);
      expect(revision.allowance).toEqual(task.allowance);
      expect(revision.control.applied).toEqual([]);
    }
    expect(task.initiator).toMatchObject({ principalId: "user-l3-editor", role: "pcb_editor" });
  });

  it("5. two workers of three slots each on the eight blocks: no slice runs twice, every block is saved once, the result is complete", { timeout: 60_000 }, async () => {
    const env = l3Env({ name: "j7-two-workers", repository: new InMemoryDurableWorkflowRepository(), catalog: droneCatalog() });
    const model = new ScriptedModel(eightBlockScripts(), env.time, () => 1_000);
    const port = new CountingPort(model);
    const task = await startTask(env, { prompt: EIGHT_BLOCK_PROMPT });
    const [x, y] = [env.worker({ llm: port, workerId: "worker-j7-x", policy: { concurrency: SLOTS } }), env.worker({ llm: port, workerId: "worker-j7-y", policy: { concurrency: SLOTS } })];
    port.workers = [x, y];
    for (let round = 0; round < 16; round += 1) {
      await Promise.all([x.runOnce(), y.runOnce()]);
      if ((await head(env, task.taskId)).state === "awaiting-review") break;
    }
    const done = await head(env, task.taskId);
    expect(done.state).toBe("awaiting-review");
    expect(done.result).toMatchObject({ status: "complete", omittedBlocks: [] });
    const turns = model.calls.filter((call) => call.kind === "block").map((call) => `${call.block}#${call.turn}`);
    expect(new Set(turns).size).toBe(turns.length); // no turn of any block was asked twice
    expect(model.planCalls).toBe(1);
    expect(model.calls).toHaveLength(EIGHT_BLOCK_CALLS);
    expect(port.blockPeak).toBeLessThanOrEqual(2 * SLOTS);
    const history = await heads(env, task.taskId);
    for (const block of done.plan!.blocks) {
      const savedAt = history.filter((revision, index) => revision.blocks[block.blockId]?.status === "saved" && history[index - 1]?.blocks[block.blockId]?.status !== "saved");
      expect(savedAt, block.name).toHaveLength(1); // saved exactly once, and never un-saved
    }
    const events = await env.repository.listOutbox({ topic: GENERATION_SLICE_TOPIC });
    expect(events).toHaveLength(1 + EIGHT_BLOCKS.length + 1);
    expect(events.every((event) => event.attempts === 1)).toBe(true); // every slice claimed once, by one worker
    const owners = new Set(history.flatMap((revision) => Object.values(revision.pending).flatMap((entry) => (entry.owner ? [entry.owner.workerId] : []))));
    expect([...owners].sort()).toEqual(["worker-j7-x", "worker-j7-y"]); // both workers took work from the one queue
  });
});

describe("[PR-J J.7] the block limit is explicit and its dependent bounds move together", () => {
  const NINE_BLOCKS = [...EIGHT_BLOCKS, { name: "Status light", brief: "A status indicator on a spare MCU pin.", sharedNets: ["+3V3", "GND"] }];
  const LIMIT_MESSAGE = `The planner proposed more than ${GENERATION_TASK_BOUNDS.blocks} subsystem blocks (a design task holds at most ${GENERATION_TASK_BOUNDS.blocks}), so the whole request is designed as one circuit. To design subsystems as separate blocks, ask for at most ${GENERATION_TASK_BOUNDS.blocks} or group related ones.`;

  it("6. nine planned blocks on both attempts: ONE circuit from the whole request, and the milestone names the limit and the remedy", { timeout: 60_000 }, async () => {
    expect(LIMIT_MESSAGE.length).toBeLessThanOrEqual(240); // the milestone message bound: never cut
    const env = l3Env({ name: "j7-limit", repository: new InMemoryDurableWorkflowRepository(), catalog: droneCatalog() });
    const whole = EIGHT_BLOCK_DESIGNS["Flight controller"]!;
    const model = new ScriptedModel({
      plan: () => planReply(NINE_BLOCKS),
      blocks: { "": ({ turn }) => (turn <= whole.searches.length ? reply([search(`call_whole_${turn}`, whole.searches[turn - 1]!)]) : reply([submit(`call_whole_submit_${turn}`, whole.netlist)])) },
    }, env.time, () => 1_000);
    const task = await startTask(env, { prompt: EIGHT_BLOCK_PROMPT });
    const { task: done } = await drive(env, env.worker({ llm: model, policy: { concurrency: SLOTS } }), task.taskId, { until: (current) => current.state === "awaiting-review", maxTicks: 20 });
    expect(model.planCalls).toBe(GENERATION_SLICE_POLICY.planAttempts); // the one correction attempt named the limit
    expect(JSON.stringify(model.requests[1]!.messages)).toContain(`more than ${GENERATION_TASK_BOUNDS.blocks} blocks`);
    expect(done.plan).toMatchObject({ planner: { state: "failed_fallback" }, blocks: [{ blockId: "main" }] });
    const ready = done.milestones.find((event) => event.type === "plan_ready")!;
    expect(ready).toMatchObject({ message: LIMIT_MESSAGE, data: { blocks: 1, planner: "failed_fallback" } });
    // the single design is asked for the WHOLE request (nothing the planner proposed is dropped), and it completes
    const designCall = model.requests.find((request) => !isPlanRequest(request))!;
    expect(firstText(designCall.messages)).toBe(EIGHT_BLOCK_PROMPT);
    expect(done.result).toMatchObject({ status: "complete", omittedBlocks: [] });

    // an unreadable plan keeps its own message: the limit text is only for a plan over the limit
    const unreadable = l3Env({ name: "j7-unreadable", repository: new InMemoryDurableWorkflowRepository(), catalog: droneCatalog() });
    const bad = new ScriptedModel({ plan: () => reply([{ id: "call_plan", name: "submit_plan", input: { blocks: "not a list" } }]), blocks: {} }, unreadable.time);
    const other = await startTask(unreadable, { prompt: EIGHT_BLOCK_PROMPT });
    await unreadable.worker({ llm: bad }).runOnce();
    expect((await head(unreadable, other.taskId)).milestones.find((event) => event.type === "plan_ready")).toMatchObject({ message: "The plan could not be read; designing the request as one circuit.", data: { planner: "failed_fallback" } });
  });

  it("7. the block limit, the block ids, the event counts, the store's plan refusal and the browser reader agree", { timeout: 60_000 }, async () => {
    const limit = GENERATION_TASK_BOUNDS.blocks;
    expect(limit).toBe(8); // OD-255 item 10: the value is unchanged; raising it is a measured later increment (J7-4)
    expect(GENERATION_BLOCK_IDS.length - 1).toBe(limit);
    expect(GENERATION_TASK_BLOCK_IDS).toEqual(GENERATION_BLOCK_IDS); // the agent's retry tool names the same ids
    const at = new Date(Date.parse("2026-10-22T00:00:00.000Z")).toISOString();
    const counted = (type: "plan_ready" | "merge_started" | "result_ready", n: number) => () => generationTaskEvent(type, { at, message: "m", data: type === "plan_ready" ? { blocks: n, planner: "planned" } : type === "merge_started" ? { blocks: n } : { status: "partial", omitted: n } });
    for (const type of ["plan_ready", "merge_started", "result_ready"] as const) {
      expect(counted(type, limit), type).not.toThrow();
      expect(counted(type, limit + 1), type).toThrow(GenerationTaskContractError);
    }
    // the store takes a plan of `limit` blocks and refuses one more
    const blocks = (n: number) => Array.from({ length: n }, (_, index) => ({ name: `Block ${index + 1}`, brief: "A block.", sharedNets: ["GND"] }));
    for (const [n, ok] of [[limit + 1, false], [limit, true]] as const) {
      const env = l3Env({ name: `j7-store-${n}`, repository: new InMemoryDurableWorkflowRepository(), catalog: droneCatalog() });
      await startTask(env, { prompt: EIGHT_BLOCK_PROMPT });
      const [claim] = await env.store.claimSlices({ workerId: "worker-j7-store", limit: 1, revalidate: async () => ({ ok: true }) });
      if (claim?.outcome !== "claimed") throw new Error("the plan slice was not claimed");
      const ended = await env.store.endSlice(claim.lease, { plan: { planner: { state: "planned", blocks: Math.min(n, limit) }, rationale: "", assumptions: [], blocks: blocks(n) }, usage: {}, schedule: "next-work" });
      expect(ended.ok, `${n} blocks`).toBe(ok);
      if (!ended.ok) expect(ended.code).toBe("GENERATION_SLICE_END_INVALID");
      else expect(Object.values(ended.task.pending)).toHaveLength(limit); // one queued slice per block, all of them
    }
    // the browser's reader keeps every block the server may plan
    const snapshot = (n: number) => ({ schema: "sirkit.generation-task-snapshot.v1", taskId: "generation-task:" + "c".repeat(32), clientRequestId: "00000000-0000-4000-8000-000000000001", scope: { tenantId: "t", projectId: "p", branchId: "main" }, state: "running", terminal: false, phase: "designing", provider: "openai", createdAt: at, updatedAt: at, serverNow: at, liveness: { state: "running", since: null, retryAt: null }, plan: { planner: "planned", rationale: "", assumptions: [], blocks: GENERATION_BLOCK_IDS.slice(1, n + 1).map((blockId, index) => ({ blockId, name: `Block ${index + 1}`, status: "queued", strategy: "S1-baseline", turnsUsed: 0, blocker: null })) }, blocker: null, failure: null, usage: { slices: 0, attempts: 0, modelCalls: 0, uncertainModelCalls: 0, inputTokens: 0, outputTokens: 0, catalogSearches: 0, cacheHits: 0 }, base: { schematicDigest: "eng1-0123456789abcdef0123456789abcdef", recipe: "build-pin", moved: false }, result: null, review: null, control: { cancelRequested: false, pauseRequested: false }, actions: [], retryBlocks: [], eventCursor: 0, activity: [] });
    expect(readGenerationTaskSnapshot(snapshot(limit))!.plan!.blocks).toHaveLength(limit);
  });
});
