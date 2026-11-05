/**
 * [PR-L, 2026-10-17] Runbook L.7 item 4 (increment 3; task-worker-contract.md sections 1, 3.2 and 5): a worker that dies mid-design
 * loses nothing that was committed, and the restarted worker does not redo paid or saved work:
 *
 *  1. (in-memory and PostgreSQL on PGlite) a worker dies inside a block's third model call: the saved blocks, the block's committed
 *     checkpoint (two turns), the validated catalog facts, the counters, the strategy history and the dead attempt's reservation survive;
 *     a NEW store and worker (on PostgreSQL: fresh modules over the same database) resume the block at its third turn - no search is
 *     repeated, no saved block is asked again - and the unknown completion of the dead call stays charged as UNCERTAIN (its remaining
 *     reservation at the worst case), never as an exact call;
 *  2. an ambiguous commit (the transport fails after the commit landed) is retried with the same idempotency key and applied ONCE;
 *  3. a worker that crashes after its end commit but before acknowledging the event leaves only a stale event, which the next worker
 *     settles without any work;
 *  4. the task's facts are a cache: a delta the facts aggregate cannot hold (its 512 KB bound) is dropped and logged, and the slice's
 *     checkpoint and end still commit - the design is never wedged by its cache;
 *  5. [PR-L6, 2026-10-19] (PGlite) the input dimension survives a crash inside a call: the call's input bound was recorded on its
 *     reservation before it was sent, so the restarted claim charges it as uncertain, the resumed slice's admission counts it, and the
 *     resumed call that no longer fits is never sent - no input overshoot across the restart (OD-253 item 6).
 *
 * Fake model and catalog ports, a simulated clock; PostgreSQL is PGlite in process (the l2 pattern: `vi.mock` of the database client).
 * This file starts PGlite, so its CI admission is the database-delivery job's (a separate, line-pinned workflow entry, F20).
 */
import { afterAll, beforeAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../../db/schema";
import { loadMigrationManifest } from "../../db/migrations/manifest";
import { migrateDatabase } from "../../db/migrations/runner";
import { disposablePostgres, type DisposablePostgres } from "../../db/disposable-postgres";

let pg: DisposablePostgres | null = null;
let orm: ReturnType<typeof drizzle<typeof schema>>;
vi.mock("../../db/client", () => ({ getDb: () => orm }));
vi.mock("@/lib/erc", () => ({
  runErc: vi.fn(() => ({ ok: true, errors: [], criticalCount: 0, warningCount: 0, reward: 1 })),
  formatErcFeedback: vi.fn(() => "ERC: offline fixture feedback."),
}));
vi.mock("@/lib/kg", () => ({ kgDesignNotes: vi.fn(() => null) }));

import { InMemoryDurableWorkflowRepository } from "../../durable-workflow/repository";
import { durableAggregateIdentity } from "../../durable-workflow/stable";
import type { DurableWorkflowRepository } from "../../durable-workflow/types";
import type { LLMRequest, LLMResponse } from "../../llm/types";
import type { BuildLlmPort } from "../../schematic/build-loop-slice";
import { GENERATION_SLICE_POLICY, GENERATION_SLICE_TOPIC, GENERATION_TASK_AGGREGATES, GENERATION_TASK_ALLOWANCE_UNIT, generationCommitted, type GenerationTaskHead } from "../contracts";
import { generationRequestInputBound } from "../worker/accounting";
import { GenerationTaskStore } from "../store";
import type { GenerationWorker, WorkerTimers } from "../worker/worker";
import { NETLISTS, ScriptedModel, SimulatedTime, droneCatalog, droneScripts, drive, l3Env, membership, part, reply, scopeFor, search, startTask, submit } from "./_l3-worker-fixtures";
import { InMemoryProjectMembershipRepository } from "../../auth/project-membership";
import { hookedRepository } from "./_l2-store-scenarios";

const DEAF: WorkerTimers = { setInterval: () => null, clearInterval: () => undefined, setTimeout: (run, ms) => setTimeout(run, ms), clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) };
const NEVER = new Promise<LLMResponse>(() => undefined);

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

/** The modules a restarted process loads (in memory: the same classes; on PostgreSQL: fresh modules over the same database). */
interface RestartModules {
  Store: typeof GenerationTaskStore;
  Worker: typeof import("../worker/worker").GenerationWorker;
  revalidator: typeof import("../worker/runtime").createGenerationSliceRevalidator;
  repository: () => DurableWorkflowRepository;
}
interface CrashEnv { name: string; repository: () => DurableWorkflowRepository; restart: (repository: DurableWorkflowRepository) => Promise<RestartModules> }

/** Tick until the hang happens (the "process" then dies: its slice is abandoned and never settles): each round ends when the slices it
 *  started settle or the crash happens - events, never a polling deadline. */
async function runUntilHang(worker: GenerationWorker, crash: Promise<void>, hung: () => boolean): Promise<void> {
  for (let round = 0; round < 12 && !hung(); round += 1) {
    await worker.tick();
    await Promise.race([worker.idle(), crash]);
  }
  if (!hung()) throw new Error("the block never reached the call the crash happens in");
}

async function scenarioCrashResume(env: CrashEnv): Promise<void> {
  const repository = env.repository(), time = new SimulatedTime(), scope = scopeFor(`crash-${env.name}`);
  const memberships = new InMemoryProjectMembershipRepository();
  memberships.set(membership(scope));
  const { createGenerationSliceRevalidator } = await import("../worker/runtime");
  const { GenerationWorker: Worker } = await import("../worker/worker");
  const store = new GenerationTaskStore({ repository, clock: time.clock });
  const catalog = droneCatalog();
  let crashed = false, crashNow: () => void = () => undefined;
  const crash = new Promise<void>((resolve) => { crashNow = resolve; });
  const model = new ScriptedModel(droneScripts(), time, () => 10_000);
  model.intercept = (request, kind, block) => {
    const turn = request.messages.filter((message) => message.role === "assistant").length + 1;
    if (kind === "block" && block === "Motor drivers" && turn === 3 && !crashed) { crashed = true; crashNow(); return NEVER; } // the process dies in this call
    return undefined;
  };
  const task = await startTask({ store, scope });
  const workerA = new Worker({ store, workerId: `worker-${env.name}-a`, ports: { llm: model, catalog }, revalidate: createGenerationSliceRevalidator({ membership: () => memberships, providerServable: () => true }), clock: time.clock, random: () => 0.5, timers: DEAF, policy: { concurrency: 1 } });
  await runUntilHang(workerA, crash, () => crashed);

  // what the crash leaves behind
  const before = (await store.load(scope, task.taskId)) as { ok: true; task: GenerationTaskHead };
  expect(before.ok).toBe(true);
  const savedBefore = Object.values(before.task.blocks).filter((block) => block?.status === "saved").map((block) => block!.name);
  const callsBefore = Object.fromEntries(["Flight controller", "Power", "Motor drivers"].map((name) => [name, model.callsOf(name)]));
  const motorCheckpoint = await store.readBlock(scope, before.task, "b3");
  expect(motorCheckpoint).toMatchObject({ turnsUsed: 2, attempt: 1, result: null });
  const facts = await store.readFacts(scope, before.task);
  expect(Object.keys(facts!.parts)).toEqual(expect.arrayContaining(["p-fet", "p-diode"]));
  const deadSlice = Object.entries(before.task.pending).find(([, entry]) => entry.blockId === "b3")!;
  expect(deadSlice[1].owner).toMatchObject({ attempt: 1 });
  expect(before.task.reservations).toEqual([expect.objectContaining({ sliceId: deadSlice[0], attempt: 1, state: "held", modelCalls: 6 - 2 })]); // drawn down by the two settled turns

  // the process is gone; its lease lapses; a NEW process starts over the same durable state
  time.jump(time.now() + GENERATION_SLICE_POLICY.leaseMs + 15_000);
  const fresh = await env.restart(repository);
  const restartedStore = new fresh.Store({ repository: fresh.repository(), clock: time.clock });
  const workerB = new fresh.Worker({ store: restartedStore, workerId: `worker-${env.name}-b`, ports: { llm: model, catalog }, revalidate: fresh.revalidator({ membership: () => memberships, providerServable: () => true }), clock: time.clock, random: () => 0.5, timers: DEAF, policy: { concurrency: 1 } });
  const searchesBefore = catalog.searches.map((entry) => entry.query);
  const { task: done } = await drive({ store: restartedStore, scope, time }, workerB, task.taskId, { until: (current) => current.state === "awaiting-review", maxTicks: 30 });

  // the block resumed at its third turn from the committed conversation: the resumed request carries the two recorded turns
  const motorTurns = model.calls.filter((call) => call.kind === "block" && call.block === "Motor drivers").map((call) => call.turn);
  expect(motorTurns).toEqual([1, 2, 3, 3]);
  expect(done.blocks.b3).toMatchObject({ status: "saved", turnsUsed: 3, strategyHistory: [{ id: "S1-baseline", slices: 1, outcome: "succeeded" }] });
  // no search was repeated by the resumed block, and no saved block was asked again
  const searchesAfter = catalog.searches.map((entry) => entry.query).slice(searchesBefore.length);
  expect(searchesAfter.filter((query) => /mosfet|flyback/.test(query))).toEqual([]);
  for (const name of savedBefore) expect(model.callsOf(name)).toBe(callsBefore[name]);
  // the counters are cumulative and exact; the dead call's completion is unknown, so its attempt's remaining reservation is UNCERTAIN
  expect(done.usage.modelCalls).toBe(1 + 4 + 4 + 3);
  // (the held reservation was drawn down by what the two settled turns actually used: 2 calls and 2 x 60 output tokens)
  expect(done.reservations).toEqual([expect.objectContaining({ sliceId: deadSlice[0], attempt: 1, state: "uncertain", modelCalls: 4, outputTokens: 6 * GENERATION_SLICE_POLICY.turnOutputTokens - 2 * 60 })]);
  expect(done.usage.attempts).toBeGreaterThanOrEqual(5); // the plan, three blocks, and the resumed attempt
  // the facts the dead process learnt are still the task's (one shared search answered from them: a cache hit, no catalog call)
  const after = await restartedStore.readFacts(scope, done);
  for (const key of Object.keys(facts!.lookups)) expect(after!.lookups[key]).toBeDefined();
  expect(catalog.searches.filter((entry) => entry.query === "decoupling capacitor")).toHaveLength(1);
  expect(done.usage.cacheHits).toBeGreaterThanOrEqual(1);
  expect(await restartedStore.readResult(scope, done)).toMatchObject({ status: "complete" });
}

const memoryEnv: CrashEnv = {
  name: "memory",
  repository: () => new InMemoryDurableWorkflowRepository(),
  restart: async (repository) => ({ Store: GenerationTaskStore, Worker: (await import("../worker/worker")).GenerationWorker, revalidator: (await import("../worker/runtime")).createGenerationSliceRevalidator, repository: () => repository }),
};

describe("[PR-L L.7-4] a crash loses nothing committed, and resume redoes no paid or saved work (in-memory repository)", () => {
  it("1. a worker dies inside a block's third call; a new worker resumes it at that turn with no repeated search or saved block, and the dead call stays uncertain", { timeout: 60_000 }, () => scenarioCrashResume(memoryEnv));

  it("2. an ambiguous commit (the transport fails after the commit) is retried with the same key and applied once", { timeout: 60_000 }, async () => {
    const ambiguousKeys = new Set<string>();
    const env = l3Env({ name: "ambiguous", repository: hookedRepository(new InMemoryDurableWorkflowRepository(), { ambiguousKeys }), catalog: droneCatalog() });
    const model = new ScriptedModel(droneScripts(), env.time, () => 1_000);
    const task = await startTask(env);
    ambiguousKeys.add(`${task.taskId}:s1:a1:end`); // the plan slice's end commit lands, then its answer is lost
    const worker = env.worker({ llm: model });
    const { slices } = await worker.runOnce();
    expect(slices[0]).toMatchObject({ kind: "plan", outcome: "planned", state: "queued" });
    expect(ambiguousKeys.size).toBe(0); // the fault fired
    const heads = await env.repository.history(durableAggregateIdentity(env.scope, GENERATION_TASK_AGGREGATES.head, task.taskId));
    expect(heads.filter((record) => (record.payload as GenerationTaskHead).plan !== null)).toHaveLength(1); // applied once
    expect(await env.repository.listOutbox({ scope: env.scope, topic: GENERATION_SLICE_TOPIC, state: "pending" })).toHaveLength(3); // three block slices, not six
    expect(model.planCalls).toBe(1); // no model work was redone to re-derive the commit
    const { task: done } = await drive(env, worker, task.taskId, { until: (current) => current.state === "awaiting-review", maxTicks: 20 });
    expect(done.result).toMatchObject({ status: "complete" });
  });

  it("3. a crash after the end commit but before the event's acknowledgement leaves a stale event the next worker settles without work", { timeout: 60_000 }, async () => {
    const crashOnComplete = new Set<string>();
    const inner = new InMemoryDurableWorkflowRepository();
    const env = l3Env({ name: "ack", repository: hookedRepository(inner, { crashOnComplete }), catalog: droneCatalog() });
    const model = new ScriptedModel(droneScripts(), env.time, () => 1_000);
    const task = await startTask(env);
    const [planEvent] = await inner.listOutbox({ scope: env.scope, topic: GENERATION_SLICE_TOPIC });
    crashOnComplete.add(planEvent!.eventId);
    const dying = env.worker({ llm: model, workerId: "worker-dies-at-ack", timers: DEAF });
    const { slices } = await dying.runOnce();
    expect(slices[0]).toMatchObject({ kind: "plan", outcome: "fenced" }); // its end landed; it could not acknowledge, and wrote nothing more
    const planned = await env.store.load(env.scope, task.taskId);
    expect(planned).toMatchObject({ ok: true, task: { state: "queued", plan: { planner: { state: "planned" } } } });
    // the unacknowledged event is not completed: the failed acknowledgement handed it back (pending) for the next worker to settle
    expect((await inner.listOutbox({ scope: env.scope, topic: GENERATION_SLICE_TOPIC })).find((event) => event.eventId === planEvent!.eventId)).toMatchObject({ state: "pending" });
    crashOnComplete.clear();
    env.time.jump(env.time.now() + GENERATION_SLICE_POLICY.leaseMs + 1_000);
    const next = env.worker({ llm: model, workerId: "worker-next", policy: { concurrency: 3 } });
    const { tick } = await next.runOnce();
    expect(tick.claims.filter((claim) => claim.outcome === "stale-event")).toHaveLength(1);
    expect(model.planCalls).toBe(1);
    expect(await inner.listOutbox({ scope: env.scope, topic: GENERATION_SLICE_TOPIC, state: "processing" })).toEqual([]);
  });
});

describe("[PR-L L.7-4] the facts cache never wedges a slice", () => {
  it("4. a facts delta beyond the facts bound is dropped and logged; the checkpoints and ends still commit and the design completes", { timeout: 60_000 }, async () => {
    const catalog = droneCatalog();
    // three catalog parts of ~190 KB of pin facts each, one surfaced by each block: every checkpoint holds one; the task's facts would hold all three
    const giant = (id: string) => part(id, `Offline ${id} with a very long pin list`, "Microcontrollers", Array.from({ length: 1_024 }, (_, index) => `${id.toUpperCase()}_PIN_${index}_${"X".repeat(110)}`));
    catalog.add(giant("p-giant-a"), /flight controller mcu/).add(giant("p-giant-b"), /battery connector/).add(giant("p-giant-c"), /logic level mosfet/);
    const env = l3Env({ name: "facts-bound", repository: new InMemoryDurableWorkflowRepository(), catalog });
    const model = new ScriptedModel(droneScripts(), env.time, () => 1_000);
    const task = await startTask(env);
    const { task: done } = await drive(env, env.worker({ llm: model }), task.taskId, { until: (current) => current.state === "awaiting-review", maxTicks: 30 });
    expect(done.result).toMatchObject({ status: "complete" });
    expect(env.logs.some((line) => /the facts learnt could not be stored \(GENERATION_TASK_TOO_LARGE\)/.test(line))).toBe(true);
    const facts = await env.store.readFacts(env.scope, done);
    expect(Object.keys(facts!.parts).filter((id) => id.startsWith("p-giant")).length).toBeLessThan(3); // what did not fit was not kept
  });
});

// ─── [PR-L6, 2026-10-19] the input dimension across a crash (OD-253 item 6) ─────────────────────────────────────────────────

const INPUT_QUERIES = ["flight controller mcu", "imu gyro", "decoupling capacitor"];
/** One block (the planner answers no submit_plan): three searches, then the submission. */
const singleScripts = () => ({
  plan: () => reply([]),
  blocks: { "": ({ turn }: { turn: number }) => (turn <= INPUT_QUERIES.length ? reply([search(`call_main_${turn}`, INPUT_QUERIES[turn - 1]!)]) : reply([submit("call_main_submit", NETLISTS["Flight controller"])])) },
});
/** The provider seam: each call's bound (as the admission computes it) and the input it reports (40 % of the bound). */
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

describe("[PR-L L.7-4] the same crash and resume on PostgreSQL (PGlite), with a restart of the modules", () => {
  beforeAll(async () => {
    pg = await disposablePostgres();
    await migrateDatabase(pg, { manifest: loadMigrationManifest() });
    orm = drizzle(pg.db, { schema });
  }, 120_000);
  afterAll(async () => { await pg?.close(); });

  it("1. (PGlite) a worker dies inside a block's third call; fresh modules over the same database resume it with no repeated work", { timeout: 180_000 }, async () => {
    const { PostgresDurableWorkflowRepository } = await import("../../durable-workflow/server-repository");
    await scenarioCrashResume({
      name: "pglite",
      repository: () => new PostgresDurableWorkflowRepository(),
      restart: async () => {
        vi.resetModules(); // the process's singletons and module state are dropped; the database is kept
        const [repositoryModule, storeModule, workerModule, runtimeModule] = await Promise.all([import("../../durable-workflow/server-repository"), import("../store"), import("../worker/worker"), import("../worker/runtime")]);
        return { Store: storeModule.GenerationTaskStore as unknown as typeof GenerationTaskStore, Worker: workerModule.GenerationWorker, revalidator: runtimeModule.createGenerationSliceRevalidator, repository: () => new repositoryModule.PostgresDurableWorkflowRepository() };
      },
    });
    const rows = await pg!.db.query<{ n: number }>("select count(*)::int as n from durable_workflow_heads where tenant_id = 'tenant-l3'");
    expect(rows.rows[0]!.n).toBeGreaterThan(0); // the scenario wrote the real tables
  });

  it("5. [PR-L6, 2026-10-19] (PGlite) a crash inside a call keeps its input bound charged: the restarted slice counts it, and the resumed call that no longer fits is never sent", { timeout: 180_000 }, async () => {
    // the deterministic bounds and reported inputs of the calls up to the crash (plan, three turns), measured in memory first
    const calibration = l3Env({ name: "crash-input-calibration", repository: new InMemoryDurableWorkflowRepository(), catalog: droneCatalog() });
    const measured = new ReportingPort(new ScriptedModel(singleScripts(), calibration.time, () => 1_000));
    const measuredTask = await startTask(calibration, { allowanceUnit: { ...GENERATION_TASK_ALLOWANCE_UNIT, inputTokens: 50_000_000 } });
    await drive(calibration, calibration.worker({ llm: measured }), measuredTask.taskId, { until: (current) => current.state === "awaiting-review", maxTicks: 20 });
    const b3 = measured.bounds[3]!, settledInput = measured.reported[0]! + measured.reported[1]! + measured.reported[2]!;
    const limit = settledInput + 2 * b3 - 1; // the third turn fits once (before the crash), and no longer once its dead attempt is charged

    const { PostgresDurableWorkflowRepository } = await import("../../durable-workflow/server-repository");
    const repository = new PostgresDurableWorkflowRepository(), time = new SimulatedTime(), scope = scopeFor("crash-input-pglite");
    const memberships = new InMemoryProjectMembershipRepository();
    memberships.set(membership(scope));
    const { createGenerationSliceRevalidator } = await import("../worker/runtime");
    const { GenerationWorker: Worker } = await import("../worker/worker");
    const store = new GenerationTaskStore({ repository, clock: time.clock });
    const catalog = droneCatalog();
    let crashed = false, crashNow: () => void = () => undefined;
    const crash = new Promise<void>((resolve) => { crashNow = resolve; });
    const model = new ScriptedModel(singleScripts(), time, () => 1_000);
    model.intercept = (request, kind) => {
      const turn = request.messages.filter((message) => message.role === "assistant").length + 1;
      if (kind === "block" && turn === 3 && !crashed) { crashed = true; crashNow(); return NEVER; } // the process dies in this call
      return undefined;
    };
    const port = new ReportingPort(model);
    const task = await startTask({ store, scope }, { allowanceUnit: { ...GENERATION_TASK_ALLOWANCE_UNIT, inputTokens: limit } });
    const workerA = new Worker({ store, workerId: "worker-crash-input-a", ports: { llm: port, catalog }, revalidate: createGenerationSliceRevalidator({ membership: () => memberships, providerServable: () => true }), clock: time.clock, random: () => 0.5, timers: DEAF, policy: { concurrency: 1 } });
    await runUntilHang(workerA, crash, () => crashed);
    expect(port.bounds).toEqual(measured.bounds.slice(0, 4)); // the same requests as measured

    // what the crash leaves: the settled input in the usage, and the dead call's bound on its attempt's reservation
    const before = await store.load(scope, task.taskId);
    if (!before.ok) throw new Error(before.code);
    expect(before.task.usage.inputTokens).toBe(settledInput);
    expect(before.task.reservations).toEqual([expect.objectContaining({ attempt: 1, state: "held", inputTokens: b3 })]);

    // the process is gone; its lease lapses; fresh modules over the same database resume the block
    time.jump(time.now() + GENERATION_SLICE_POLICY.leaseMs + 15_000);
    vi.resetModules();
    const [repositoryModule, storeModule, workerModule, runtimeModule] = await Promise.all([import("../../durable-workflow/server-repository"), import("../store"), import("../worker/worker"), import("../worker/runtime")]);
    const restartedStore = new storeModule.GenerationTaskStore({ repository: new repositoryModule.PostgresDurableWorkflowRepository(), clock: time.clock }) as unknown as GenerationTaskStore;
    const workerB = new workerModule.GenerationWorker({ store: restartedStore as never, workerId: "worker-crash-input-b", ports: { llm: port, catalog }, revalidate: runtimeModule.createGenerationSliceRevalidator({ membership: () => memberships, providerServable: () => true }), clock: time.clock, random: () => 0.5, timers: DEAF, policy: { concurrency: 1 } });
    const { task: parked } = await drive({ store: restartedStore, scope, time }, workerB as never, task.taskId, { until: (current) => current.state === "waiting-for-resource", maxTicks: 10 });

    // the dead call stays charged (uncertain, at its bound); the resumed third turn did not fit what remained and was never sent
    expect(port.bounds).toHaveLength(4);
    expect(model.calls.filter((call) => call.kind === "block").map((call) => call.turn)).toEqual([1, 2, 3]);
    expect(parked.blocker).toMatchObject({ code: "allowance_exhausted" });
    expect(parked.blocks.main).toMatchObject({ status: "blocked", blocker: "allowance_exhausted", turnsUsed: 2 });
    expect(parked.reservations).toEqual([expect.objectContaining({ attempt: 1, state: "uncertain", inputTokens: b3 })]);
    expect(parked.usage.inputTokens).toBe(settledInput);
    expect(generationCommitted(parked).inputTokens).toBe(settledInput + b3);
    expect(generationCommitted(parked).inputTokens).toBeLessThanOrEqual(limit); // no input overshoot across the restart
  });
});
