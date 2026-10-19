/**
 * [PR-L6 integration, 2026-10-19] F7 (the engine review of increment 6): liveness is scope-aware.
 *
 * Since increment 6 a worker may run with `--scope` and claim only that scope's slices. The liveness judgement read "a live lease exists"
 * as "the workers are busy and this design is queued", so a due slice of ANOTHER scope - one no running worker will ever claim - read
 * `workers_busy` instead of `no_worker` (L.7 item 6: an accepted job nobody consumes must be shown truthfully). A --scope worker now
 * claims under an owner id naming its scope's tag, and only a live lease of an unrestricted worker, or of one restricted to the task's
 * own scope, counts toward `workers_busy`.
 *
 *  1. an A-scoped worker busy on A: project B's due task reads `no_worker` through the real service; A's own task reads `running`;
 *  2. the same with an UNRESTRICTED busy worker: B reads `workers_busy`, as before.
 *
 * Fake model and catalog ports, the in-memory durable repository, a simulated clock. No provider, no database, no network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/erc", () => ({
  runErc: vi.fn(() => ({ ok: true, errors: [], criticalCount: 0, warningCount: 0, reward: 1 })),
  formatErcFeedback: vi.fn(() => "ERC: offline fixture feedback."),
}));
vi.mock("@/lib/kg", () => ({ kgDesignNotes: vi.fn(() => null) }));

import { InMemoryProjectMembershipRepository } from "../../auth/project-membership";
import { InMemoryDurableWorkflowRepository } from "../../durable-workflow/repository";
import type { DurableWorkflowScope } from "../../durable-workflow/types";
import type { LLMResponse } from "../../llm/types";
import { GENERATION_SLICE_POLICY } from "../contracts";
import { GenerationTaskService } from "../service";
import { GenerationTaskStore } from "../store";
import { createGenerationSliceRevalidator } from "../worker/runtime";
import { GenerationWorker, type WorkerTimers } from "../worker/worker";
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

const DEAF: WorkerTimers = { setInterval: () => null, clearInterval: () => undefined, setTimeout: (run, ms) => setTimeout(run, ms), clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) };
const NEVER = new Promise<LLMResponse>(() => undefined);

async function livenessWith(name: string, workerScope: "A" | null): Promise<{ a: unknown; b: unknown; worker: GenerationWorker }> {
  const time = new SimulatedTime();
  const repository = new InMemoryDurableWorkflowRepository();
  const scopeA: DurableWorkflowScope = { tenantId: "tenant-l6-live", projectId: `project-${name}-a`, branchId: "main" };
  const scopeB: DurableWorkflowScope = { tenantId: "tenant-l6-live", projectId: `project-${name}-b`, branchId: "main" };
  const memberships = new InMemoryProjectMembershipRepository();
  memberships.set(membership(scopeA));
  memberships.set(membership(scopeB));
  const store = new GenerationTaskStore({ repository, clock: time.clock });
  const service = new GenerationTaskService({ store, repository, clock: time.clock, providerServable: () => true, identities: () => { throw new Error("no start through the service here"); }, durability: "durable" });
  const taskA = await startTask({ store, scope: scopeA });
  // the A-scoped (or unrestricted) worker takes A's plan, whose provider call never answers: it holds a live lease on A
  const model = new ScriptedModel({ ...droneScripts(), plan: () => NEVER });
  const worker = new GenerationWorker({
    store, workerId: `worker-${name}`, ports: { llm: model, catalog: droneCatalog() },
    revalidate: createGenerationSliceRevalidator({ membership: () => memberships, providerServable: () => true }),
    clock: time.clock, random: () => 0.5, timers: DEAF, policy: { concurrency: 1 }, ...(workerScope === "A" ? { scope: scopeA } : {}),
  });
  const tick = await worker.tick();
  expect(tick.started).toHaveLength(1);
  const taskB = await startTask({ store, scope: scopeB });
  // B's plan is due and past the pickup grace; A's lease is still live
  time.jump(time.now() + GENERATION_SLICE_POLICY.workerPickupGraceMs + 5_000);
  const read = async (scope: DurableWorkflowScope, taskId: string) => ((await service.inspect(scope, taskId)).body as { task: { liveness: unknown } }).task.liveness;
  return { a: await read(scopeA, taskA.taskId), b: await read(scopeB, taskB.taskId), worker };
}

describe("[PR-L6 integration] F7: a worker restricted to another scope never makes a task read workers_busy", () => {
  it("1. an A-scoped busy worker: B's due task reads no_worker; A's own reads running", async () => {
    const { a, b, worker } = await livenessWith("scoped", "A");
    expect(a).toMatchObject({ state: "running" });
    expect(b).toMatchObject({ state: "no_worker" });
    await worker.stop({ graceMs: 10 });
  });

  it("2. an unrestricted busy worker: B's due task reads workers_busy, as before", async () => {
    const { a, b, worker } = await livenessWith("unscoped", null);
    expect(a).toMatchObject({ state: "running" });
    expect(b).toMatchObject({ state: "workers_busy" });
    await worker.stop({ graceMs: 10 });
  });
});
