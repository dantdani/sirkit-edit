/**
 * [PR-L6, 2026-10-19] OD-253 item 6 (live-run.md H, D4): a worker restricted to ONE scope (`--scope <tenant>/<project>/<branch>`) claims
 * only that scope's queued slices - of BOTH topics it consumes (the generation slices and the component-resolution slices) - and leaves
 * every other scope's events untouched (pending, attempts 0); with no scope it claims across scopes, as before. On the in-memory
 * repository and on PostgreSQL (PGlite: the real `claimOutbox` SQL with its scope clause).
 *
 * Fake model and catalog ports; no provider, no network. This file starts PGlite, so its CI admission is the database-delivery job's.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

import { InMemoryProjectMembershipRepository } from "../../auth/project-membership";
import { InMemoryDurableWorkflowRepository } from "../../durable-workflow/repository";
import type { DurableWorkflowRepository, DurableWorkflowScope } from "../../durable-workflow/types";
import { COMPONENT_RESOLUTION_SLICE_CONTRACT, COMPONENT_RESOLUTION_SLICE_EVENT, COMPONENT_RESOLUTION_SLICE_TOPIC, COMPONENT_RESOLUTION_TASK_AGGREGATE } from "../../component-resolution/task/contracts";
import { ComponentResolutionTaskStore } from "../../component-resolution/task/store";
import { componentResolutionTopicRunner } from "../../component-resolution/task/topic-runner";
import { GENERATION_SLICE_TOPIC } from "../contracts";
import { GenerationTaskStore } from "../store";
import { parseGenerationWorkerArguments, parseWorkerScope } from "../worker/cli";
import { createGenerationSliceRevalidator } from "../worker/runtime";
import { GenerationWorker } from "../worker/worker";
import { ScriptedModel, SimulatedTime, droneCatalog, droneScripts, membership, startTask } from "./_l3-worker-fixtures";

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

/** A queued component-resolution slice event in `scope` (its payload is not a valid slice: a claim drops it, which proves the claim). */
async function queueResolutionSlice(repository: DurableWorkflowRepository, scope: DurableWorkflowScope, name: string, at: number): Promise<void> {
  const taskId = `cr-task:${name.padEnd(32, "0").slice(0, 32)}`;
  await repository.commit({
    scope, scopeKey: `l6-scope-${name}`, idempotencyKey: `l6-scope-${name}-start`,
    operations: [{ aggregateType: COMPONENT_RESOLUTION_TASK_AGGREGATE, aggregateKey: taskId, expectedRevision: 0, payload: { taskId } }],
    outbox: [{ owner: { aggregateType: COMPONENT_RESOLUTION_TASK_AGGREGATE, aggregateKey: taskId }, eventType: COMPONENT_RESOLUTION_SLICE_EVENT, eventVersion: 1, topic: COMPONENT_RESOLUTION_SLICE_TOPIC, payload: { contract: COMPONENT_RESOLUTION_SLICE_CONTRACT, taskId, sliceId: `${taskId}:s1`, kind: "acquire" } }],
    result: {}, committedAt: new Date(at).toISOString(),
  });
}

async function scenario(repository: DurableWorkflowRepository, prefix: string): Promise<void> {
  const time = new SimulatedTime();
  const scopeA = { tenantId: `tenant-${prefix}`, projectId: `project-${prefix}-a`, branchId: "main" };
  const scopeB = { tenantId: `tenant-${prefix}`, projectId: `project-${prefix}-b`, branchId: "feature/scope-b" };
  const memberships = new InMemoryProjectMembershipRepository();
  memberships.set(membership(scopeA));
  memberships.set(membership(scopeB));
  const store = new GenerationTaskStore({ repository, clock: time.clock });
  // B's work is queued FIRST (a FIFO claim with no scope would take it first)
  const taskB = await startTask({ store, scope: scopeB });
  await queueResolutionSlice(repository, scopeB, `${prefix}b`, time.now());
  const taskA = await startTask({ store, scope: scopeA });
  await queueResolutionSlice(repository, scopeA, `${prefix}a`, time.now());
  const model = new ScriptedModel(droneScripts(), time, () => 1_000);
  const worker = (workerId: string, scope?: DurableWorkflowScope) => new GenerationWorker({
    store, workerId, ports: { llm: model, catalog: droneCatalog() },
    revalidate: createGenerationSliceRevalidator({ membership: () => memberships, providerServable: () => true }),
    clock: time.clock, random: () => 0.5, timers: time, policy: { concurrency: 3 },
    topics: [componentResolutionTopicRunner({ store: new ComponentResolutionTaskStore({ repository, clock: time.clock }), ports: () => { throw new Error("no slice of this suite runs"); }, revalidate: async () => ({ ok: true }) })],
    ...(scope ? { scope } : {}),
  });
  const events = async (scope: DurableWorkflowScope, topic: string) => (await repository.listOutbox({ scope, topic })).map((event) => ({ state: event.state, attempts: event.attempts }));

  // a worker with scope A: A's plan slice and A's resolution slice are claimed; B's stay pending, never attempted
  const scoped = worker(`worker-${prefix}-scoped`, scopeA);
  const { tick } = await scoped.runOnce();
  expect(tick.started).toEqual([`${taskA.taskId}:s1`]); // A's plan slice ran; A's resolution event was claimed and settled (its payload is no slice)
  expect(model.planCalls).toBe(1);
  expect(await events(scopeA, GENERATION_SLICE_TOPIC)).toEqual(expect.arrayContaining([{ state: "completed", attempts: 1 }]));
  expect((await events(scopeA, COMPONENT_RESOLUTION_SLICE_TOPIC)).map((event) => event.attempts)).toEqual([1]);
  expect(await events(scopeB, GENERATION_SLICE_TOPIC)).toEqual([{ state: "pending", attempts: 0 }]);
  expect(await events(scopeB, COMPONENT_RESOLUTION_SLICE_TOPIC)).toEqual([{ state: "pending", attempts: 0 }]);
  const loadedB = await store.load(scopeB, taskB.taskId);
  expect(loadedB.ok && loadedB.task).toMatchObject({ state: "queued", plan: null, fenceCounter: 0 });
  // more ticks of the scoped worker still never touch B (A's block slices are claimed instead)
  await scoped.runOnce();
  expect(await events(scopeB, GENERATION_SLICE_TOPIC)).toEqual([{ state: "pending", attempts: 0 }]);

  // no scope: today's cross-scope behaviour - B's queued work is claimed too
  const open = worker(`worker-${prefix}-open`);
  await open.runOnce();
  expect((await events(scopeB, GENERATION_SLICE_TOPIC))[0]).toMatchObject({ attempts: 1 });
  expect((await events(scopeB, COMPONENT_RESOLUTION_SLICE_TOPIC))[0]).toMatchObject({ attempts: 1 });
}

describe("[PR-L6] a worker restricted to one scope (OD-253 item 6)", () => {
  it("1. --scope parses <tenant>/<project>/<branch> (the branch may hold /); malformed scopes refuse; the pump refuses a scope it cannot honour", () => {
    expect(parseWorkerScope("tenant-1/project-1/main")).toEqual({ tenantId: "tenant-1", projectId: "project-1", branchId: "main" });
    expect(parseWorkerScope("tenant-1/project-1/feature/x")).toEqual({ tenantId: "tenant-1", projectId: "project-1", branchId: "feature/x" });
    for (const bad of [undefined, "", "tenant-1", "tenant-1/project-1", "/project-1/main", "tenant-1//main", "tenant-1/project-1/", " tenant-1/project-1/main", "tenant-1/proj\u0007/main"]) expect(parseWorkerScope(bad), String(bad)).toBeNull();
    expect(parseGenerationWorkerArguments(["--scope", "tenant-1/project-1/main", "--once"])).toEqual({ ok: true, args: expect.objectContaining({ scope: { tenantId: "tenant-1", projectId: "project-1", branchId: "main" }, once: true }) });
    expect(parseGenerationWorkerArguments([])).toEqual({ ok: true, args: expect.objectContaining({ scope: null }) });
    expect(parseGenerationWorkerArguments(["--scope", "tenant-1/project-1"])).toMatchObject({ ok: false, message: expect.stringMatching(/--scope takes/) });
    expect(parseGenerationWorkerArguments(["--scope"])).toMatchObject({ ok: false });
    expect(parseGenerationWorkerArguments(["--transport", "pump", "--origin", "http://127.0.0.1:3005", "--scope", "t/p/main"])).toMatchObject({ ok: false, message: expect.stringMatching(/direct transport only/) });
  });

  it("2. (in-memory) the scoped worker claims only its scope's events of both topics; no scope claims across scopes", { timeout: 60_000 }, () => scenario(new InMemoryDurableWorkflowRepository(), "l6mem"));
});

describe("[PR-L6] a worker restricted to one scope, on PostgreSQL (PGlite)", () => {
  beforeAll(async () => {
    pg = await disposablePostgres();
    await migrateDatabase(pg, { manifest: loadMigrationManifest() });
    orm = drizzle(pg.db, { schema });
  }, 120_000);
  afterAll(async () => { await pg?.close(); });

  it("3. (PGlite) the scoped claimOutbox SQL leaves another scope's generation and resolution slices pending with no attempt", { timeout: 180_000 }, async () => {
    const { PostgresDurableWorkflowRepository } = await import("../../durable-workflow/server-repository");
    await scenario(new PostgresDurableWorkflowRepository(), "l6pg");
  });
});
