import { describe, expect, it, vi } from "vitest";
vi.mock("../../footprint-resolver/__tests__/fixtures", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../footprint-resolver/__tests__/fixtures")>();
  const { InMemoryPhysicalBindingRepository, PhysicalBindingService } = await import("../../physical-binding/repository");
  const { createApprovedValidation } = await import("../../physical-binding/transitions");
  const physicalFixtures = await import("../../physical-binding/__tests__/fixtures");
  return { ...original, readyRepository: async (componentId = "resolver-ready", options: { manufacturingComplete?: boolean } = {}) => {
    const repository = new InMemoryPhysicalBindingRepository(), candidate = original.exactCandidate(componentId, { manufacturingComplete: options.manufacturingComplete }), service = new PhysicalBindingService(repository);
    let state = await service.createCandidate(candidate, `create-${candidate.bindingId}`), request = physicalFixtures.transition(candidate, state.set.revision, "select", original.ACTOR); request.decisionEvidenceRefs = [candidate.evidenceRefs[0]!]; state = await service.transition(state.set.setId, request);
    let current = state.bindings.find((binding) => binding.revisionId === state.set.effectiveSelectedRevisionId)!; const validation = physicalFixtures.transition(current, state.set.revision, "revalidate", original.ACTOR); validation.validation = createApprovedValidation(current, { validatorVersion: "physical-binding-validator/1", at: validation.at, evidenceRefs: ["evidence-mapping"] }); state = await service.transition(state.set.setId, validation);
    current = state.bindings.find((binding) => binding.revisionId === state.set.effectiveSelectedRevisionId)!; request = physicalFixtures.transition(current, state.set.revision, "approve", original.ACTOR); request.decisionEvidenceRefs = [current.evidenceRefs[0]!]; state = await service.transition(state.set.setId, request);
    return { repository, binding: state.bindings.find((binding) => binding.revisionId === state.set.effectiveSelectedRevisionId)! };
  } };
});
import { DurableMappingContextStore, DurableMappingRepository, mappingOutboxHandlers, readyMappingInvalidationTopics } from "../../mapping-verification/durable";
import { MappingVerificationService } from "../../mapping-verification/service";
import type { MappingInvalidationTarget, MappingMutationRequest, Stage1MappingProjector } from "../../mapping-verification/types";
import { contextFixture as mappingContext, exactCandidate as mappingCandidate, request as mappingRequest, ACTOR as MAPPING_ACTOR } from "../../mapping-verification/__tests__/fixtures";
import { DurablePassivePolicyContextStore, DurablePassivePolicyRepository, passivePolicyOutboxHandlers } from "../../passive-policy/durable";
import { PassivePolicyService } from "../../passive-policy/service";
import { PASSIVE_EXCEPTION_CONTRACT_VERSION, type PassivePolicyExceptionRevokeMutationRequest, type PassivePolicyInvalidationTarget, type PassivePolicyMutationRequest } from "../../passive-policy/types";
import { passivePolicyDigest } from "../../passive-policy/stable";
import { ADMIN, REVIEWER, NOW, componentFixture, contextFixture as passiveContext, policyFixture, profileFixture } from "../../passive-policy/__tests__/fixtures";
import { DurablePcbSyncRepository, DurablePcbSyncSnapshotStore } from "../../pcb-sync/durable";
import { PcbSynchronizationService } from "../../pcb-sync/service";
import { applyRequest, preflightRequest, readyHarness } from "../../pcb-sync/__tests__/fixtures";
import { DurableOutboxDispatcher } from "../outbox";
import { InMemoryDurableWorkflowRepository } from "../repository";

function mappingMutation(input: Partial<MappingMutationRequest> = {}): MappingMutationRequest { return { requestId: "durable-mapping-mutation", tenantId: "tenant-1", projectId: "project-1", branchId: "main", componentInstanceId: "component-1", assemblyVariantId: "variant-default", expectedRevision: 0, idempotencyKey: "durable-mapping-key", reason: "Durable mapping qualification.", actorContext: MAPPING_ACTOR, requestedAt: "2026-07-19T14:01:00.000Z", ...input }; }
function policyMutation(expectedRevision: number, action: string): PassivePolicyMutationRequest { return { requestId: `durable-${action}`, tenantId: "tenant-1", projectId: "project-1", branchId: "main", policyId: "project-passive-policy", expectedRevision, idempotencyKey: `durable-${action}`, reason: `Durable ${action} qualification.`, actorContext: action === "approve" ? REVIEWER : ADMIN, requestedAt: NOW }; }
type PassiveInvalidationInput = Parameters<PassivePolicyInvalidationTarget["invalidate"]>[0];
function isPassiveInvalidationEvent(event: Awaited<ReturnType<InMemoryDurableWorkflowRepository["listOutbox"]>>[number]): event is typeof event & { eventType: "passive-policy.invalidate"; eventVersion: 1; payload: PassiveInvalidationInput } {
  return event.eventType === "passive-policy.invalidate" && event.eventVersion === 1 && typeof event.payload.toPolicyRevisionId === "string";
}

async function durableMappingHarness(projector: Stage1MappingProjector, invalidation: MappingInvalidationTarget) {
  const workflow = new InMemoryDurableWorkflowRepository(), store = new DurableMappingContextStore(workflow), repository = new DurableMappingRepository(workflow), context = mappingContext(), candidate = mappingCandidate(context, { equivalence: true });
  await store.publishContext(context, { expectedRevision: 0, idempotencyKey: "publish-mapping-context", publishedAt: NOW });
  await store.publishCandidate(candidate, context, { expectedRevision: 0, idempotencyKey: "publish-mapping-candidate", publishedAt: NOW });
  const service = new MappingVerificationService({ provider: store, resultStore: store, repository, stage1Projector: projector, invalidation, effectMode: "outbox" }), verification = await service.verify(mappingRequest(context, candidate)), persisted = await service.persistVerification(mappingMutation({ verificationId: verification.verificationId }));
  return { workflow, repository, persisted };
}

describe("durable Stage 3-5 owner adapters", () => {
  it("preserves Stage 3 plan, board, audit, and replay across repository recreation", async () => {
    const source = await readyHarness(), workflow = new InMemoryDurableWorkflowRepository(), snapshots = new DurablePcbSyncSnapshotStore(workflow), repository = new DurablePcbSyncRepository(workflow);
    await snapshots.publish(source.snapshot, { expectedRevision: 0, idempotencyKey: "publish-stage3-snapshot", publishedAt: NOW });
    const service = new PcbSynchronizationService({ snapshotProvider: snapshots, resolver: source.resolver, resourceProvider: source.resourceProvider, repository, clock: () => "2026-07-19T12:01:00.000Z" });
    const preflight = await service.preflight(preflightRequest());
    expect(preflight.plan?.lifecycle).toBe("applicable");
    const applied = await service.apply(applyRequest(preflight.plan!));
    expect(applied.status).toBe("applied");
    expect(applied.boardChanged).toBe(true);
    const restarted = new DurablePcbSyncRepository(workflow);
    expect((await restarted.getPlan(preflight.plan!.scope, preflight.plan!.planId))?.lifecycle).toBe("applied");
    expect(await restarted.listAudits(preflight.plan!.scope)).toHaveLength(1);
    expect((await restarted.getIdempotentResult(preflight.plan!.scope, "apply-key-1"))?.audit?.auditId).toBe(applied.audit?.auditId);
  });

  it("persists Stage 4 verification/lifecycle and delivers projection plus invalidation through the outbox", async () => {
    const workflow = new InMemoryDurableWorkflowRepository(), store = new DurableMappingContextStore(workflow), repository = new DurableMappingRepository(workflow), context = mappingContext(), candidate = mappingCandidate(context, { equivalence: true });
    await store.publishContext(context, { expectedRevision: 0, idempotencyKey: "publish-mapping-context", publishedAt: NOW });
    await store.publishCandidate(candidate, context, { expectedRevision: 0, idempotencyKey: "publish-mapping-candidate", publishedAt: NOW });
    const projector = { project: vi.fn(async () => ({ state: "pending" as const, evidenceRefs: [], reasonCodes: [] })) }, invalidation = { invalidate: vi.fn(async () => ({ stage2DependencyKeys: [], stage3PlansStaled: 0 })) };
    const service = new MappingVerificationService({ provider: store, resultStore: store, repository, stage1Projector: projector, invalidation, effectMode: "outbox" });
    const verification = await service.verify(mappingRequest(context, candidate)), persisted = await service.persistVerification(mappingMutation({ verificationId: verification.verificationId }));
    const restartedService = new MappingVerificationService({ provider: store, resultStore: store, repository: new DurableMappingRepository(workflow), stage1Projector: projector, invalidation, effectMode: "outbox" });
    const approved = await restartedService.approve(mappingMutation({ requestId: "durable-mapping-approve", mappingId: persisted.record.mappingId, expectedRevision: 1, expectedMappingContentDigest: persisted.record.mappingContentDigest, idempotencyKey: "durable-mapping-approve", requestedAt: "2026-07-19T14:02:00.000Z" }));
    expect(approved.record).toMatchObject({ revision: 2, lifecycle: "active" });
    expect(persisted.invalidation.stage3PlansStaled).toBeNull();
    expect(await repository.convergence(mappingMutation(), approved.record.revisionId)).toMatchObject({ state: "pending", projection: { state: "pending" }, invalidation: { state: "pending", attempts: 0 }, outcome: null });
    expect(await new DurableMappingContextStore(workflow).get({ verificationId: verification.verificationId, tenantId: "tenant-1", projectId: "project-1", branchId: "main" })).not.toBeNull();
    const handlers = mappingOutboxHandlers({ workflow, projector, invalidation }), dispatcher = new DurableOutboxDispatcher(workflow, handlers);
    const projectedFirst = await dispatcher.dispatch({ workerId: "mapping-worker", now: "2026-07-19T14:03:00.000Z", topics: ["mapping.stage1-project"], limit: 1 });
    expect(invalidation.invalidate).not.toHaveBeenCalled();
    const invalidatedFirst = await dispatcher.dispatch({ workerId: "mapping-worker", now: "2026-07-19T14:03:00.000Z", topics: await readyMappingInvalidationTopics(workflow), limit: 1 });
    expect(await repository.convergence(mappingMutation(), approved.record.revisionId)).toMatchObject({ state: "pending", projection: { state: "pending" }, invalidation: { state: "pending" } });
    const projectedSecond = await dispatcher.dispatch({ workerId: "mapping-worker", now: "2026-07-19T14:03:00.000Z", topics: ["mapping.stage1-project"], limit: 1 }), invalidatedSecond = await dispatcher.dispatch({ workerId: "mapping-worker", now: "2026-07-19T14:03:00.000Z", topics: await readyMappingInvalidationTopics(workflow), limit: 1 });
    const phases = [projectedFirst, invalidatedFirst, projectedSecond, invalidatedSecond];
    expect({ claimed: phases.reduce((sum, item) => sum + item.claimed, 0), completed: phases.reduce((sum, item) => sum + item.completed, 0), failed: phases.reduce((sum, item) => sum + item.failed, 0) }).toMatchObject({ claimed: 4, completed: 4, failed: 0 });
    expect(projector.project).toHaveBeenCalledTimes(2);
    expect(invalidation.invalidate).toHaveBeenCalledTimes(2);
    expect(await new DurableMappingRepository(workflow).convergence(mappingMutation(), approved.record.revisionId)).toMatchObject({ state: "completed", projection: { state: "completed" }, invalidation: { state: "completed" }, outcome: { stage3PlansStaled: 0 } });
    const delivered = (await workflow.listOutbox({ eventType: "mapping.invalidate" })).find((event) => event.ownerAggregateRevision === approved.record.revision)!;
    await handlers.get("mapping.invalidate@2")!(delivered);
    expect(invalidation.invalidate).toHaveBeenCalledTimes(2);
  });

  it("defers mapping invalidation, exposes retries, and converges after acknowledgement loss", async () => {
    const projector = { project: vi.fn().mockRejectedValueOnce(new Error("MV_PROJECTION_TRANSIENT")).mockResolvedValue({ state: "pending" as const, evidenceRefs: [], reasonCodes: [] }) }, invalidation = { invalidate: vi.fn(async () => ({ stage2DependencyKeys: ["dependency-b", "dependency-a"], stage3PlansStaled: 2 })) }, h = await durableMappingHarness(projector, invalidation), handlers = mappingOutboxHandlers({ workflow: h.workflow, projector, invalidation }), dispatcher = new DurableOutboxDispatcher(h.workflow, handlers);
    const first = await dispatcher.dispatch({ workerId: "retry-worker", now: "2026-07-19T14:02:00.000Z", topics: ["mapping.stage1-project"], maxAttempts: 2 });
    expect(first.retried).toBe(1);
    expect(await h.repository.convergence(mappingMutation(), h.persisted.record.revisionId)).toMatchObject({ state: "retryable_failed", projection: { state: "retryable_failed" }, invalidation: { state: "pending", attempts: 0 } });
    expect(await readyMappingInvalidationTopics(h.workflow)).toEqual([]);
    expect(invalidation.invalidate).not.toHaveBeenCalled();

    await dispatcher.dispatch({ workerId: "retry-worker", now: "2026-07-19T14:02:06.000Z", topics: ["mapping.stage1-project"], maxAttempts: 2 });
    vi.spyOn(h.workflow, "completeOutbox").mockRejectedValueOnce(new Error("ACK_LOST"));
    const ackLost = await dispatcher.dispatch({ workerId: "retry-worker", now: "2026-07-19T14:02:06.000Z", topics: await readyMappingInvalidationTopics(h.workflow), maxAttempts: 2 });
    expect(ackLost.retried).toBe(1);
    expect(await new DurableMappingRepository(h.workflow).convergence(mappingMutation(), h.persisted.record.revisionId)).toMatchObject({ state: "retryable_failed", outcome: { stage2DependencyKeys: ["dependency-a", "dependency-b"], stage3PlansStaled: 2 } });
    await dispatcher.dispatch({ workerId: "retry-worker", now: "2026-07-19T14:02:12.000Z", topics: await readyMappingInvalidationTopics(h.workflow), maxAttempts: 2 });
    expect(invalidation.invalidate).toHaveBeenCalledTimes(1);
    expect(await new DurableMappingRepository(h.workflow).convergence(mappingMutation(), h.persisted.record.revisionId)).toMatchObject({ state: "completed", outcome: { stage3PlansStaled: 2 } });
  });

  it("keeps terminal projection and invalidation failures visible and not ready", async () => {
    const projector = { project: vi.fn(async () => { throw new Error("MV_PROJECTION_AUTHORITY_MISMATCH"); }) }, invalidation = { invalidate: vi.fn(async () => ({ stage2DependencyKeys: [], stage3PlansStaled: 0 })) }, projection = await durableMappingHarness(projector, invalidation), projectionDispatcher = new DurableOutboxDispatcher(projection.workflow, mappingOutboxHandlers({ workflow: projection.workflow, projector, invalidation }));
    expect((await projectionDispatcher.dispatch({ workerId: "terminal-worker", now: "2026-07-19T14:02:00.000Z", topics: ["mapping.stage1-project"], maxAttempts: 1 })).failed).toBe(1);
    expect(await projection.repository.convergence(mappingMutation(), projection.persisted.record.revisionId)).toMatchObject({ state: "terminal_failed", projection: { state: "terminal_failed", errorCode: "MV_PROJECTION_AUTHORITY_MISMATCH" }, invalidation: { state: "terminal_failed", errorCode: "MV_PROJECTION_TERMINAL_BLOCK" } });
    expect((await projection.workflow.listOutbox({ eventType: "mapping.invalidate" }))[0]).toMatchObject({ state: "pending", attempts: 0 });
    expect(invalidation.invalidate).not.toHaveBeenCalled();

    const validProjector = { project: vi.fn(async () => ({ state: "pending" as const, evidenceRefs: [], reasonCodes: [] })) }, failingInvalidation = { invalidate: vi.fn(async () => { throw new Error("MV_INVALIDATION_AUTHORITY_MISMATCH"); }) }, invalidationFailure = await durableMappingHarness(validProjector, failingInvalidation), invalidationDispatcher = new DurableOutboxDispatcher(invalidationFailure.workflow, mappingOutboxHandlers({ workflow: invalidationFailure.workflow, projector: validProjector, invalidation: failingInvalidation }));
    await invalidationDispatcher.dispatch({ workerId: "terminal-worker", now: "2026-07-19T14:02:00.000Z", topics: ["mapping.stage1-project"] });
    expect((await invalidationDispatcher.dispatch({ workerId: "terminal-worker", now: "2026-07-19T14:02:00.000Z", topics: await readyMappingInvalidationTopics(invalidationFailure.workflow), maxAttempts: 1 })).failed).toBe(1);
    expect(await invalidationFailure.repository.convergence(mappingMutation(), invalidationFailure.persisted.record.revisionId)).toMatchObject({ state: "terminal_failed", invalidation: { state: "terminal_failed", errorCode: "MV_INVALIDATION_AUTHORITY_MISMATCH" }, outcome: null });
  });

  it("persists a Stage 5 component exception, rehydrates the successor policy, and retries invalidation safely", async () => {
    const workflow = new InMemoryDurableWorkflowRepository(), repository = new DurablePassivePolicyRepository(workflow), contexts = new DurablePassivePolicyContextStore(workflow), profile = profileFixture(), draft = policyFixture({ profile, lifecycle: "draft", approval: "unreviewed" }), component = componentFixture({ componentId: "C1" });
    await contexts.publish(passiveContext({ component, policy: draft, profiles: [profile] }), { expectedRevision: 0, idempotencyKey: "publish-passive-context", publishedAt: NOW });
    const invalidate = vi.fn(async (input: PassiveInvalidationInput) => ({ stage2DependencyKeys: input.affectedComponentIds.map((id) => `dependency:${id}`), stage3PlansStaled: new Set(input.affectedComponentIds).size })), target: PassivePolicyInvalidationTarget = { invalidate };
    const service = new PassivePolicyService({ repository, contextProvider: contexts, invalidation: target, effectMode: "outbox" });
    let result = await service.createDraft(draft, policyMutation(0, "create"));
    result = await service.validate({ ...policyMutation(1, "validate"), recordId: result.record.recordId });
    result = await service.submit({ ...policyMutation(2, "submit"), recordId: result.record.recordId });
    result = await service.approve({ ...policyMutation(3, "approve"), recordId: result.record.recordId, expectedPolicyDigest: result.record.policy.technicalDigest });
    result = await service.publish({ ...policyMutation(4, "publish"), recordId: result.record.recordId, expectedPolicyDigest: result.record.policy.technicalDigest });
    const current = await contexts.getContext({ requestSchemaVersion: "sirkit.passive-policy-evaluation-request.v1", requestId: "durable-authority", tenantId: "tenant-1", projectId: "project-1", branchId: "main", componentInstanceId: "C1", assemblyVariantId: "variant-default", policyRevisionId: result.record.policy.revisionId, purpose: "stage2_resolution", actorContext: ADMIN, requestedAt: NOW });
    const exceptionRequest = { ...policyMutation(5, "exception"), recordId: result.record.recordId, expectedPolicyDigest: result.record.policy.technicalDigest, exception: { exceptionContractVersion: PASSIVE_EXCEPTION_CONTRACT_VERSION, exceptionId: "exception-c1", componentInstanceId: "C1", assemblyVariantIds: ["variant-default"], action: "require_exact_part" as const, selection: { kind: "none" as const }, authority: { tenantId: "tenant-1", projectId: "project-1", branchId: "main", componentInstanceId: "C1", variants: [{ assemblyVariantId: "variant-default", boardInstanceId: component.scope.boardInstanceId, componentSnapshotId: component.snapshotId, componentRevisionId: component.componentRevisionId, componentDigest: component.dependencyDigest, stableComponentIdentityDigest: passivePolicyDigest(component.stableIdentity), contextDependencyDigest: current.dependencySnapshot.dependencyDigest }], policyId: result.record.policy.policyId, approvedAgainstPolicyRevisionId: result.record.policy.revisionId, approvedAgainstPolicyDigest: result.record.policy.technicalDigest, expectedPolicyRecordRevision: result.record.revision, assemblyProfileId: current.assemblyProfile.assemblyProfileId, assemblyProfileRevisionId: current.assemblyProfile.revisionId, assemblyProfileDigest: current.assemblyProfile.dependencyDigest }, state: "pending" as const, reason: "Connector requires exact sourcing.", evidenceRefs: ["review-1"], createdBy: ADMIN } };
    const changed = await service.applyApprovedException(exceptionRequest), replay = await service.applyApprovedException(exceptionRequest);
    expect(changed.record.policy.componentExceptions).toHaveLength(1);
    expect(replay.idempotent).toBe(true);
    const evaluated = await service.evaluate({ requestSchemaVersion: "sirkit.passive-policy-evaluation-request.v1", requestId: "durable-passive-evaluate", tenantId: "tenant-1", projectId: "project-1", branchId: "main", componentInstanceId: "C1", assemblyVariantId: "variant-default", policyRevisionId: changed.record.policy.revisionId, purpose: "stage2_resolution", actorContext: ADMIN, requestedAt: NOW });
    expect(evaluated.policyRevisionId).toBe(changed.record.policy.revisionId);
    const active = changed.record.policy.componentExceptions.find((item) => item.state === "approved")!, revokeRequest = { ...policyMutation(6, "revoke-exception"), actorContext: REVIEWER, recordId: changed.record.recordId, expectedPolicyDigest: changed.record.policy.technicalDigest, operation: "revoke" as const, exceptionId: active.exceptionId, expectedExceptionDecisionRevision: active.decisionRevision!, decisionEvidenceRefs: ["revoke-evidence-r1"] } satisfies PassivePolicyExceptionRevokeMutationRequest, revoked = await service.revokeException(revokeRequest);
    expect(await repository.convergence({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", policyId: draft.policyId }, revoked.record.recordId)).toMatchObject({ state: "pending", invalidation: { state: "pending", attempts: 0 }, outcome: null });
    const handlers = passivePolicyOutboxHandlers({ workflow, target }), dispatcher = new DurableOutboxDispatcher(workflow, handlers);
    const dispatched = await dispatcher.dispatch({ workerId: "passive-worker", now: "2026-07-19T16:00:00.000Z", topics: ["passive-policy.invalidate"], limit: 10 });
    expect(dispatched.completed).toBeGreaterThanOrEqual(1);
    expect((await new DurablePassivePolicyRepository(workflow).audits({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", policyId: draft.policyId })).at(-1)?.action).toBe("revoke_exception");
    expect(await new DurablePassivePolicyRepository(workflow).convergence({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", policyId: draft.policyId }, revoked.record.recordId)).toMatchObject({ state: "completed", outcome: { stage2DependencyKeys: ["dependency:C1"], stage3PlansStaled: 1 } });
    const revokeEvent = (await workflow.listOutbox({ eventType: "passive-policy.invalidate" })).filter(isPassiveInvalidationEvent).find((event) => event.payload.toPolicyRevisionId === revoked.record.policy.revisionId)!;
    await handlers.get("passive-policy.invalidate@1")!(revokeEvent);
    expect(invalidate.mock.calls.filter(([input]) => input.toPolicyRevisionId === revoked.record.policy.revisionId)).toHaveLength(1);
  });
});
