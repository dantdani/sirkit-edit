import { describe, expect, it, vi } from "vitest";

vi.mock("../../footprint-resolver/__tests__/fixtures", async () => {
  const { InMemoryPhysicalBindingRepository, PhysicalBindingService } = await import("../../physical-binding/repository");
  const { createApprovedValidation } = await import("../../physical-binding/transitions");
  const { ACTOR, exactCandidate, transition } = await import("../../physical-binding/__tests__/fixtures");
  return { readyRepository: async (componentId = "resolver-ready") => {
    const repository = new InMemoryPhysicalBindingRepository(), service = new PhysicalBindingService(repository), candidate = exactCandidate(componentId);
    let state = await service.createCandidate(candidate, `create-${candidate.bindingId}`), request = transition(candidate, state.set.revision, "select", ACTOR);
    request.decisionEvidenceRefs = ["evidence-datasheet"];
    state = await service.transition(state.set.setId, request);
    let current = state.bindings.find((binding) => binding.revisionId === state.set.effectiveSelectedRevisionId)!;
    request = transition(current, state.set.revision, "revalidate", ACTOR);
    request.validation = createApprovedValidation(current, { validatorVersion: "physical-binding-validator/1", at: request.at, evidenceRefs: ["evidence-mapping"] });
    state = await service.transition(state.set.setId, request);
    current = state.bindings.find((binding) => binding.revisionId === state.set.effectiveSelectedRevisionId)!;
    request = transition(current, state.set.revision, "approve", ACTOR);
    request.decisionEvidenceRefs = ["evidence-datasheet"];
    state = await service.transition(state.set.setId, request);
    return { repository, binding: state.bindings.find((binding) => binding.revisionId === state.set.effectiveSelectedRevisionId)! };
  } };
});
import { PcbSynchronizationService } from "../service";
import type { PcbSyncFaultInjector } from "../types";
import { executePcbSyncPlan, validateStagedBoard } from "../executor";
import { createEmptyBoard } from "../../pcb/types";
import { assertPcbSyncPlanTransition } from "../lifecycle";
import { InMemoryDurableWorkflowRepository } from "../../durable-workflow/repository";
import { DurablePcbSyncRepository } from "../durable";
import type { PcbSyncRepository } from "../repository";
import { applyRequest, preflightRequest, readyHarness as baseReadyHarness } from "./fixtures";

const scope = { tenantId: "tenant-1", projectId: "project-1", branchId: "main", boardId: "board-1" };
const APPLY_AT = "2026-07-19T12:01:00.000Z";
const precommitPoints: Parameters<PcbSyncFaultInjector["hit"]>[0][] = ["after_lock", "after_revalidation", "after_stage", "after_mutation", "after_serialize", "after_reparse", "after_validation", "before_commit", "during_commit"];

function serviceFor(harness: Awaited<ReturnType<typeof baseReadyHarness>>, input: { repository?: PcbSyncRepository; faultInjector?: PcbSyncFaultInjector; applyAt?: string } = {}): PcbSynchronizationService {
  return new PcbSynchronizationService({ snapshotProvider: harness.snapshotProvider, resolver: harness.resolver, resourceProvider: harness.resourceProvider, repository: input.repository ?? harness.repository, faultInjector: input.faultInjector, clock: () => input.applyAt ?? APPLY_AT });
}

async function readyHarness(...args: Parameters<typeof baseReadyHarness>) {
  const harness = await baseReadyHarness(...args);
  return { ...harness, service: serviceFor(harness) };
}

describe("Stage 3 atomicity, recovery, concurrency, and lifecycle", () => {
  for (const point of precommitPoints) it(`leaves the original absent/unchanged when fault injection fires at ${point}`, async () => {
    const harness = await readyHarness();
    const service = serviceFor(harness, { faultInjector: { hit(at) { if (at === point) throw new Error(`fault:${point}`); } } });
    const preflight = await service.preflight(preflightRequest());
    const result = await service.apply(applyRequest(preflight.plan!));
    expect(result.status).toBe("failed_precommit");
    expect(result.boardChanged).toBe(false);
    expect(await harness.repository.getBoard(scope)).toBeNull();
    expect(await harness.repository.listAudits(scope)).toHaveLength(0);
    expect((await harness.repository.getPlan(scope, preflight.plan!.planId))?.lifecycle).toBe("applicable");
  });

  it("records one atomic commit despite post-commit response uncertainty and makes retry idempotent", async () => {
    const harness = await readyHarness();
    let failAfterCommit = true;
    const service = serviceFor(harness, { faultInjector: { hit(at) {
      if (at === "after_commit" && failAfterCommit) { failAfterCommit = false; throw new Error("client-timeout"); }
    } } });
    const preflight = await service.preflight(preflightRequest());
    const request = applyRequest(preflight.plan!);
    const uncertain = await service.apply(request);
    expect(uncertain.status).toBe("recoverable_commit_uncertainty");
    expect(uncertain.boardChanged).toBe(true);
    expect(await harness.repository.getBoard(scope)).not.toBeNull();
    expect(await harness.repository.listAudits(scope)).toHaveLength(1);
    const replay = await serviceFor(harness).apply({ ...request, requestId: "retry", requestedAt: "2026-07-19T12:02:00.000Z" });
    expect(replay.status).toBe("idempotent_replay");
    expect(replay.committedBoardRevision).toBe(uncertain.committedBoardRevision);
    expect(await harness.repository.listAudits(scope)).toHaveLength(1);
  });

  it("serializes simultaneous same-plan applies and commits exactly once", async () => {
    const harness = await readyHarness();
    const preflight = await harness.service.preflight(preflightRequest());
    const request = applyRequest(preflight.plan!);
    const [a, b] = await Promise.all([harness.service.apply(request), harness.service.apply({ ...request, requestId: "parallel" })]);
    expect([a.status, b.status].sort()).toEqual(["applied", "idempotent_replay"]);
    expect(await harness.repository.listAudits(scope)).toHaveLength(1);
  });

  it("rejects reuse of one idempotency key for a different plan", async () => {
    const harness = await readyHarness();
    const first = await harness.service.preflight(preflightRequest());
    await harness.service.apply(applyRequest(first.plan!));
    await expect(harness.service.apply(applyRequest({ planId: "pcb-sync-plan:other", planDigest: "pb1-other" }, { requestId: "collision" }))).rejects.toThrow("PS_IDEMPOTENCY_SCOPE_CONFLICT");
  });

  it("post-stage validation catches a missing component before publication", async () => {
    const harness = await readyHarness();
    const preflight = await harness.service.preflight(preflightRequest());
    const staged = executePcbSyncPlan(createEmptyBoard(), { ...preflight.plan!, lifecycle: "applying" });
    staged.board.footprints = [];
    expect(validateStagedBoard(staged.board, null, preflight.plan!).map((item) => item.code)).toContain("PS_STAGED_COMPONENT_SET_MISMATCH");
    expect(await harness.repository.getBoard(scope)).toBeNull();
  });

  it("rejects unknown injected operation kinds", async () => {
    const harness = await readyHarness();
    const preflight = await harness.service.preflight(preflightRequest());
    const corrupt = structuredClone(preflight.plan!);
    (corrupt.operations[0] as { kind: string }).kind = "write_arbitrary_file";
    expect(() => executePcbSyncPlan(createEmptyBoard(), { ...corrupt, lifecycle: "applying" })).toThrow("PS_EXECUTOR_OPERATION_UNSUPPORTED");
  });

  it("enforces legal plan lifecycle transitions", () => {
    expect(() => assertPcbSyncPlanTransition("applicable", "applying")).not.toThrow();
    expect(() => assertPcbSyncPlanTransition("applying", "applicable")).not.toThrow();
    expect(() => assertPcbSyncPlanTransition("applied", "applying")).toThrow("PS_PLAN_LIFECYCLE_TRANSITION_INVALID");
    expect(() => assertPcbSyncPlanTransition("stale", "applicable")).toThrow("PS_PLAN_LIFECYCLE_TRANSITION_INVALID");
  });

  it("times out bounded board-lock contention without mutating", async () => {
    const harness = await readyHarness();
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const first = harness.repository.withBoardLock(scope, 500, async () => { await held; });
    await expect(harness.repository.withBoardLock(scope, 20, async () => undefined)).rejects.toThrow("PS_BOARD_LOCK_TIMEOUT");
    expect(await harness.repository.getBoard(scope)).toBeNull();
    release();
    await first;
  });

  it("recovers a legacy stranded applying plan through fresh durable repository and service instances", async () => {
    const harness = await readyHarness(), workflow = new InMemoryDurableWorkflowRepository();
    const firstRepository = new DurablePcbSyncRepository(workflow), firstService = serviceFor(harness, { repository: firstRepository });
    const preflight = await firstService.preflight(preflightRequest());
    await firstRepository.setPlanLifecycle(scope, preflight.plan!.planId, "applying");
    expect((await firstRepository.getPlan(scope, preflight.plan!.planId))?.lifecycle).toBe("applying");

    const recoveredRepository = new DurablePcbSyncRepository(workflow), recoveredService = serviceFor(harness, { repository: recoveredRepository });
    const result = await recoveredService.apply(applyRequest(preflight.plan!, { requestId: "fresh-process-retry" }));
    expect(result.status).toBe("applied");
    expect((await recoveredRepository.getPlan(scope, preflight.plan!.planId))?.lifecycle).toBe("applied");
    expect(await recoveredRepository.listAudits(scope)).toHaveLength(1);
  });

  it("rolls back an interrupted final durable commit and permits a clean retry from a fresh adapter", async () => {
    let interruptCommit = false;
    const harness = await readyHarness(), workflow = new InMemoryDurableWorkflowRepository((phase) => { if (interruptCommit && phase === "after_records") throw new Error("simulated-process-loss"); });
    const firstRepository = new DurablePcbSyncRepository(workflow), firstService = serviceFor(harness, { repository: firstRepository });
    const preflight = await firstService.preflight(preflightRequest()), request = applyRequest(preflight.plan!);
    interruptCommit = true;
    const interrupted = await firstService.apply(request);
    expect(interrupted).toMatchObject({ status: "failed_precommit", boardChanged: false });
    expect(await firstRepository.getBoard(scope)).toBeNull();
    expect(await firstRepository.listAudits(scope)).toHaveLength(0);
    expect((await firstRepository.getPlan(scope, preflight.plan!.planId))?.lifecycle).toBe("applicable");

    interruptCommit = false;
    const retryRepository = new DurablePcbSyncRepository(workflow), retryService = serviceFor(harness, { repository: retryRepository });
    const retried = await retryService.apply({ ...request, requestId: "retry-after-durable-interruption" });
    expect(retried.status).toBe("applied");
    expect(await retryRepository.listAudits(scope)).toHaveLength(1);
  });

  it("converges identical concurrent durable attempts and explicitly rejects a different-key loser", async () => {
    const harness = await readyHarness(), workflow = new InMemoryDurableWorkflowRepository(), repository = new DurablePcbSyncRepository(workflow);
    const preflight = await serviceFor(harness, { repository }).preflight(preflightRequest()), request = applyRequest(preflight.plan!);
    const identical = await Promise.all([
      serviceFor(harness, { repository: new DurablePcbSyncRepository(workflow) }).apply(request),
      serviceFor(harness, { repository: new DurablePcbSyncRepository(workflow) }).apply({ ...request, requestId: "identical-racer" }),
    ]);
    expect(identical.map((result) => result.status).sort()).toEqual(["applied", "idempotent_replay"]);
    expect(await repository.listAudits(scope)).toHaveLength(1);

    const secondHarness = await readyHarness(), secondWorkflow = new InMemoryDurableWorkflowRepository(), secondRepository = new DurablePcbSyncRepository(secondWorkflow);
    const secondPlan = await serviceFor(secondHarness, { repository: secondRepository }).preflight(preflightRequest({ requestId: "different-racer-plan" }));
    const base = applyRequest(secondPlan.plan!, { requestId: "different-racer-a", idempotencyKey: "different-racer-a" });
    const conflicting = await Promise.all([
      serviceFor(secondHarness, { repository: new DurablePcbSyncRepository(secondWorkflow) }).apply(base),
      serviceFor(secondHarness, { repository: new DurablePcbSyncRepository(secondWorkflow) }).apply({ ...base, requestId: "different-racer-b", idempotencyKey: "different-racer-b" }),
    ]);
    expect(conflicting.filter((result) => result.status === "applied")).toHaveLength(1);
    const loser = conflicting.find((result) => result.status !== "applied")!;
    expect(loser.status).toBe("blocked_stale");
    expect(loser.blockers[0]?.code).toContain("REVISION");
    expect((await secondRepository.getPlan(scope, secondPlan.plan!.planId))?.lifecycle).toBe("applied");
    expect(await secondRepository.listAudits(scope)).toHaveLength(1);
  });
});
