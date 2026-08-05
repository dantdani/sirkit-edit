import { describe, expect, it, vi } from "vitest";

vi.mock("../../footprint-resolver/__tests__/fixtures", async () => {
  const { InMemoryPhysicalBindingRepository, PhysicalBindingService } = await import("../../physical-binding/repository");
  const { createApprovedValidation } = await import("../../physical-binding/transitions");
  const { ACTOR, exactCandidate, transition } = await import("../../physical-binding/__tests__/fixtures");
  return { readyRepository: async (componentId = "resolver-ready") => {
    const repository = new InMemoryPhysicalBindingRepository(), service = new PhysicalBindingService(repository), candidate = exactCandidate(componentId);
    let state = await service.createCandidate(candidate, `create-${candidate.bindingId}`), request = transition(candidate, state.set.revision, "select", ACTOR); request.decisionEvidenceRefs = ["evidence-datasheet"];
    state = await service.transition(state.set.setId, request); let current = state.bindings.find((binding) => binding.revisionId === state.set.effectiveSelectedRevisionId)!;
    request = transition(current, state.set.revision, "revalidate", ACTOR); request.validation = createApprovedValidation(current, { validatorVersion: "physical-binding-validator/1", at: request.at, evidenceRefs: ["evidence-mapping"] });
    state = await service.transition(state.set.setId, request); current = state.bindings.find((binding) => binding.revisionId === state.set.effectiveSelectedRevisionId)!;
    request = transition(current, state.set.revision, "approve", ACTOR); request.decisionEvidenceRefs = ["evidence-datasheet"]; state = await service.transition(state.set.setId, request);
    return { repository, binding: state.bindings.find((binding) => binding.revisionId === state.set.effectiveSelectedRevisionId)! };
  } };
});

import { buildPassiveDependencySnapshot } from "../adapters";
import { InMemoryDurableWorkflowRepository } from "../../durable-workflow/repository";
import { DurablePassivePolicyRepository } from "../durable";
import { InMemoryPassivePolicyContextProvider } from "../providers";
import { InMemoryPassivePolicyRepository } from "../repository";
import { PassivePolicyService } from "../service";
import { ScopedPassivePolicyInvalidationTarget } from "../invalidation";
import { passivePolicyDigest } from "../stable";
import { PASSIVE_EXCEPTION_CONTRACT_VERSION, PASSIVE_EVALUATION_REQUEST_VERSION, type PassiveComponentException, type PassiveExceptionAction, type PassivePackageProfile, type PassivePolicyContext, type PassivePolicyExceptionApproveMutationRequest, type PassivePolicyExceptionRevokeMutationRequest, type PassivePolicyExceptionSupersedeMutationRequest, type PassivePolicyInvalidationTarget, type PassivePolicyMutationRequest, type PassivePolicyRecord } from "../types";
import { readyHarness, preflightRequest } from "../../pcb-sync/__tests__/fixtures";
import type { EngineeringActor } from "../../engineering/types";
import { ADMIN, AI, NOW, REVIEWER, componentFixture, contextFixture, policyFixture, profileFixture } from "./fixtures";

function mutation(expectedRevision: number, action: string, actor: EngineeringActor = ADMIN): PassivePolicyMutationRequest { return { requestId: `request-${action}`, tenantId: "tenant-1", projectId: "project-1", branchId: "main", policyId: "project-passive-policy", expectedRevision, idempotencyKey: `key-${action}`, reason: `Qualification ${action} transition.`, actorContext: actor, requestedAt: NOW }; }
function serviceFixture(invalidation?: PassivePolicyInvalidationTarget) {
  const profile = profileFixture(), draft = policyFixture({ profile, lifecycle: "draft", approval: "unreviewed" }), contexts = [contextFixture({ component: componentFixture({ componentId: "C1" }), policy: draft, profiles: [profile] }), contextFixture({ component: componentFixture({ componentId: "C2" }), policy: draft, profiles: [profile] })], provider = new InMemoryPassivePolicyContextProvider(contexts), repository = new InMemoryPassivePolicyRepository();
  const target = invalidation ?? { invalidate: async (input) => ({ stage2DependencyKeys: input.affectedComponentIds.map((id) => `dependency:${id}`), stage3PlansStaled: 0 }) };
  return { draft, profile, contexts, provider, repository, target, service: new PassivePolicyService({ repository, contextProvider: provider, invalidation: target, effectMode: "outbox" }) };
}

function currentContext(context: PassivePolicyContext, head: PassivePolicyRecord): PassivePolicyContext { const next = structuredClone(context); next.policy = structuredClone(head.policy); next.dependencySnapshot = buildPassiveDependencySnapshot({ component: next.component, policy: head.policy, profiles: next.profiles, assemblyProfile: next.assemblyProfile }); return next; }
function exceptionInput(head: PassivePolicyRecord, context: PassivePolicyContext, profile: PassivePackageProfile, action: PassiveExceptionAction, exceptionId = `exception-${action}`): PassiveComponentException {
  const current = currentContext(context, head), component = current.component, selection = action === "assign_profile" ? { kind: "profile" as const, profileId: profile.profileId, profileRevisionId: profile.revisionId, profileDigest: profile.profileDigest, packageIdentityId: profile.exactPackageIdentity.packageIdentityId, packageRevisionId: profile.exactPackageIdentity.packageRevisionId, footprintLogicalAssetId: profile.exactFootprintAssetIdentity.logicalAssetId, footprintAssetVersionId: profile.exactFootprintAssetIdentity.assetVersionId, footprintContentDigest: profile.exactFootprintAssetIdentity.contentDigest!, mappingRevisionId: profile.stage4MappingProfileRef.mappingRevisionId!, mappingContentDigest: profile.stage4MappingProfileRef.mappingContentDigest!, mappingResultDigest: profile.stage4MappingProfileRef.verificationResultDigest! } : { kind: "none" as const };
  return { exceptionContractVersion: PASSIVE_EXCEPTION_CONTRACT_VERSION, exceptionId, componentInstanceId: component.scope.componentInstanceId, assemblyVariantIds: [component.scope.assemblyVariantId], action, ...(selection.kind === "profile" ? { targetProfileId: selection.profileId } : {}), selection, authority: { tenantId: component.scope.tenantId, projectId: component.scope.projectId, branchId: component.scope.branchId, componentInstanceId: component.scope.componentInstanceId, variants: [{ assemblyVariantId: component.scope.assemblyVariantId, boardInstanceId: component.scope.boardInstanceId, componentSnapshotId: component.snapshotId, componentRevisionId: component.componentRevisionId, componentDigest: component.dependencyDigest, stableComponentIdentityDigest: passivePolicyDigest(component.stableIdentity), contextDependencyDigest: current.dependencySnapshot.dependencyDigest }], policyId: head.policy.policyId, approvedAgainstPolicyRevisionId: head.policy.revisionId, approvedAgainstPolicyDigest: head.policy.technicalDigest, expectedPolicyRecordRevision: head.revision, assemblyProfileId: current.assemblyProfile.assemblyProfileId, assemblyProfileRevisionId: current.assemblyProfile.revisionId, assemblyProfileDigest: current.assemblyProfile.dependencyDigest }, state: "pending", reason: "Pinned exception input.", evidenceRefs: ["exception-decision-evidence-r1"], createdBy: REVIEWER };
}
async function exceptionHarness(action: PassiveExceptionAction = "assign_profile") {
  const h = await approvedHarness(), approveRequest = { ...mutation(4, `exception-${action}`, REVIEWER), recordId: h.approved.record.recordId, expectedPolicyDigest: h.approved.record.policy.technicalDigest, operation: "approve" as const, exception: exceptionInput(h.approved.record, h.contexts[0]!, h.profile, action) } satisfies PassivePolicyExceptionApproveMutationRequest, committed = await h.service.applyApprovedException(approveRequest);
  return { ...h, approveRequest, committed };
}
async function approvedHarness() {
  const harness = serviceFixture();
  let result = await harness.service.createDraft(harness.draft, mutation(0, "create"));
  result = await harness.service.validate({ ...mutation(1, "validate"), recordId: result.record.recordId });
  result = await harness.service.submit({ ...mutation(2, "submit"), recordId: result.record.recordId });
  result = await harness.service.approve({ ...mutation(3, "approve", REVIEWER), recordId: result.record.recordId, expectedPolicyDigest: result.record.policy.technicalDigest });
  return { ...harness, approved: result };
}

describe("Stage 5 lifecycle and preview", () => {
  it("requires human role-separated approval, publishes idempotently, and never mutates a board", async () => {
    const { service, repository, approved } = await approvedHarness();
    const request = { ...mutation(4, "publish"), recordId: approved.record.recordId, expectedPolicyDigest: approved.record.policy.technicalDigest };
    const published = await service.publish(request), replay = await service.publish(request);
    expect(published.record.lifecycle).toBe("published");
    expect(published.invalidation.boardChanged).toBe(false);
    expect(published.invalidation.affectedComponentIds).toEqual(["C1", "C2"]);
    expect(replay.idempotent).toBe(true);
    expect((await repository.audits({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", policyId: "project-passive-policy" })).map((item) => item.action)).toEqual(["create_draft", "validate", "submit", "approve", "publish"]);
  });

  it("blocks AI policy authority and serializes concurrent publish attempts", async () => {
    const blocked = serviceFixture();
    await expect(blocked.service.createDraft(blocked.draft, mutation(0, "ai-create", AI))).rejects.toThrow("PP_HUMAN_POLICY_AUTHORITY_REQUIRED");
    const { service, approved } = await approvedHarness();
    const first = { ...mutation(4, "publish-a"), recordId: approved.record.recordId }, second = { ...mutation(4, "publish-b"), recordId: approved.record.recordId };
    const outcomes = await Promise.allSettled([service.publish(first), service.publish(second)]);
    expect(outcomes.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((item) => item.status === "rejected")).toHaveLength(1);
  });

  it("previews the complete project read-only with explicit manufacturing gaps", async () => {
    const { service, draft } = serviceFixture(), preview = await service.preview(draft, { tenantId: "tenant-1", projectId: "project-1", branchId: "main", assemblyVariantId: "variant-default", actorContext: ADMIN, requestedAt: NOW });
    expect(preview.results).toHaveLength(2);
    expect(preview.boardChanged).toBe(false);
    expect(preview.manufacturingGapCounts.exact_part).toBe(2);
  });

  it("commits a revision-complete exact profile decision and reproduces it in a fresh service", async () => {
    const h = await exceptionHarness(), active = h.committed.record.policy.componentExceptions.find((item) => item.state === "approved")!;
    expect(active).toMatchObject({ exceptionContractVersion: PASSIVE_EXCEPTION_CONTRACT_VERSION, action: "assign_profile", decisionRevision: 1, selection: { kind: "profile", profileRevisionId: h.profile.revisionId } });
    expect(h.committed.audit.action).toBe("approve_exception");
    expect(h.committed.invalidation).toMatchObject({ affectedComponentIds: ["C1"], boardChanged: false });
    h.provider.set(currentContext(h.contexts[0]!, h.committed.record));
    const restarted = new PassivePolicyService({ repository: h.repository, contextProvider: h.provider, invalidation: h.target, effectMode: "outbox" }), evaluated = await restarted.evaluate({ requestSchemaVersion: PASSIVE_EVALUATION_REQUEST_VERSION, requestId: "fresh-evaluation", tenantId: "tenant-1", projectId: "project-1", branchId: "main", componentInstanceId: "C1", assemblyVariantId: "variant-default", policyRevisionId: h.committed.record.policy.revisionId, purpose: "preview", actorContext: ADMIN, requestedAt: NOW });
    expect(evaluated).toMatchObject({ status: "eligible_characterized_generic", selectedProfile: { revisionId: h.profile.revisionId }, appliedException: { decisionId: active.decisionId } });
  });

  it("recreates the service over the same durable owner repository", async () => {
    const profile = profileFixture(), draft = policyFixture({ profile, lifecycle: "draft", approval: "unreviewed" }), context = contextFixture({ component: componentFixture({ componentId: "C1" }), policy: draft, profiles: [profile] }), provider = new InMemoryPassivePolicyContextProvider([context]), workflow = new InMemoryDurableWorkflowRepository(), repository = new DurablePassivePolicyRepository(workflow), target = { invalidate: async () => ({ stage2DependencyKeys: [], stage3PlansStaled: 0 }) }, service = new PassivePolicyService({ repository, contextProvider: provider, invalidation: target, effectMode: "outbox" });
    let head = await service.createDraft(draft, mutation(0, "durable-create")); head = await service.validate({ ...mutation(1, "durable-validate"), recordId: head.record.recordId }); head = await service.submit({ ...mutation(2, "durable-submit"), recordId: head.record.recordId }); head = await service.approve({ ...mutation(3, "durable-approve", REVIEWER), recordId: head.record.recordId, expectedPolicyDigest: head.record.policy.technicalDigest });
    const committed = await service.applyApprovedException({ ...mutation(4, "durable-exception", REVIEWER), recordId: head.record.recordId, expectedPolicyDigest: head.record.policy.technicalDigest, operation: "approve", exception: exceptionInput(head.record, context, profile, "assign_profile") });
    const restartedRepository = new DurablePassivePolicyRepository(workflow), restarted = new PassivePolicyService({ repository: restartedRepository, contextProvider: provider, invalidation: target, effectMode: "outbox" }), history = await restarted.history({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", policyId: "project-passive-policy" }, ADMIN, NOW);
    expect(history).toHaveLength(5);
    expect(history.at(-1)?.recordDigest).toBe(committed.record.recordDigest);
    provider.set(currentContext(context, committed.record));
    expect((await restarted.evaluate({ requestSchemaVersion: PASSIVE_EVALUATION_REQUEST_VERSION, requestId: "durable-restart-evaluation", tenantId: "tenant-1", projectId: "project-1", branchId: "main", componentInstanceId: "C1", assemblyVariantId: "variant-default", policyRevisionId: committed.record.policy.revisionId, purpose: "preview", actorContext: ADMIN, requestedAt: NOW })).appliedException?.decisionId).toBe(committed.record.policy.componentExceptions.find((item) => item.state === "approved")?.decisionId);
  });

  it("fails stale authority and detects changed same-key decisions", async () => {
    const h = await approvedHarness(), exception = exceptionInput(h.approved.record, h.contexts[0]!, h.profile, "assign_profile"), legacy: PassiveComponentException = { exceptionId: "legacy-stage6-exception", componentInstanceId: "C1", assemblyVariantIds: ["variant-default"], action: "assign_profile", targetProfileId: h.profile.profileId, state: "approved", reason: "Incomplete Stage 6 input.", evidenceRefs: ["legacy-evidence"], createdBy: REVIEWER }, stale = structuredClone(exception); stale.authority!.variants[0]!.componentDigest = "pp1-stale-component";
    await expect(h.service.applyApprovedException({ ...mutation(4, "legacy-exception", REVIEWER), recordId: h.approved.record.recordId, operation: "approve", exception: legacy })).rejects.toThrow("PP_EXCEPTION_AUTHORITY_INCOMPLETE");
    await expect(h.service.applyApprovedException({ ...mutation(4, "stale-exception", REVIEWER), recordId: h.approved.record.recordId, operation: "approve", exception: stale })).rejects.toThrow("PP_EXCEPTION_COMPONENT_AUTHORITY_STALE");
    const crossScope = structuredClone(exception); crossScope.authority!.projectId = "project-other";
    await expect(h.service.applyApprovedException({ ...mutation(4, "cross-scope-exception", REVIEWER), recordId: h.approved.record.recordId, operation: "approve", exception: crossScope })).rejects.toThrow("PP_EXCEPTION_AUTHORITY_STALE");
    const crossVariant = structuredClone(exception); crossVariant.assemblyVariantIds = ["variant-other"];
    await expect(h.service.applyApprovedException({ ...mutation(4, "cross-variant-exception", REVIEWER), recordId: h.approved.record.recordId, operation: "approve", exception: crossVariant })).rejects.toThrow("PP_EXCEPTION_VARIANT_SCOPE_MISMATCH");
    const wrongFootprint = structuredClone(exception); if (wrongFootprint.selection?.kind === "profile") wrongFootprint.selection.footprintContentDigest = "sha256:wrong-footprint";
    await expect(h.service.applyApprovedException({ ...mutation(4, "wrong-footprint-exception", REVIEWER), recordId: h.approved.record.recordId, operation: "approve", exception: wrongFootprint })).rejects.toThrow("PP_EXCEPTION_PROFILE_AUTHORITY_STALE");
    const request = { ...mutation(4, "valid-exception", REVIEWER), recordId: h.approved.record.recordId, expectedPolicyDigest: h.approved.record.policy.technicalDigest, operation: "approve" as const, exception } satisfies PassivePolicyExceptionApproveMutationRequest, committed = await h.service.applyApprovedException(request), replay = await h.service.applyApprovedException({ ...request, requestId: "retry-valid-exception", requestedAt: "2026-07-19T16:01:00.000Z" });
    expect(replay.idempotent).toBe(true);
    await expect(h.service.applyApprovedException({ ...request, reason: "Changed decision with reused key." })).rejects.toThrow("PP_IDEMPOTENCY_KEY_REUSE_CONFLICT");
    expect((await h.repository.history({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", policyId: "project-passive-policy" }))).toHaveLength(5);
    expect(committed.record.policy.componentExceptions).toHaveLength(1);
  });

  it("refuses to approve an exception that fails a non-waivable safety gate", async () => {
    const profile = profileFixture(), draft = policyFixture({ profile, lifecycle: "draft", approval: "unreviewed" }), context = contextFixture({ component: componentFixture({ componentId: "C1", polarity: "polarized" }), policy: draft, profiles: [profile] }), provider = new InMemoryPassivePolicyContextProvider([context]), repository = new InMemoryPassivePolicyRepository(), service = new PassivePolicyService({ repository, contextProvider: provider, invalidation: { invalidate: async () => ({ stage2DependencyKeys: [], stage3PlansStaled: 0 }) }, effectMode: "outbox" });
    let head = await service.createDraft(draft, mutation(0, "risky-create")); head = await service.validate({ ...mutation(1, "risky-validate"), recordId: head.record.recordId }); head = await service.submit({ ...mutation(2, "risky-submit"), recordId: head.record.recordId }); head = await service.approve({ ...mutation(3, "risky-approve", REVIEWER), recordId: head.record.recordId, expectedPolicyDigest: head.record.policy.technicalDigest });
    const request = { ...mutation(4, "risky-exception", REVIEWER), recordId: head.record.recordId, expectedPolicyDigest: head.record.policy.technicalDigest, operation: "approve" as const, exception: exceptionInput(head.record, context, profile, "assign_profile") } satisfies PassivePolicyExceptionApproveMutationRequest;
    await expect(service.applyApprovedException(request)).rejects.toThrow("PP_EXCEPTION_NON_WAIVABLE_GATE_FAILED");
    expect((await repository.history({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", policyId: "project-passive-policy" }))).toHaveLength(4);
  });

  it("revokes immutably, replays once, and stops evaluating the decision", async () => {
    const h = await exceptionHarness("opt_out"), active = h.committed.record.policy.componentExceptions.find((item) => item.state === "approved")!, revoke = { ...mutation(5, "revoke-exception", REVIEWER), recordId: h.committed.record.recordId, expectedPolicyDigest: h.committed.record.policy.technicalDigest, operation: "revoke" as const, exceptionId: active.exceptionId, expectedExceptionDecisionRevision: active.decisionRevision!, decisionEvidenceRefs: ["revoke-evidence-r1"] } satisfies PassivePolicyExceptionRevokeMutationRequest;
    await expect(h.service.revokeException({ ...revoke, operation: "destroy" as never })).rejects.toThrow("PP_EXCEPTION_OPERATION_UNSUPPORTED");
    const revoked = await h.service.revokeException(revoke), replay = await h.service.revokeException({ ...revoke, requestId: "retry-revoke-exception", requestedAt: "2026-07-19T16:01:00.000Z" }), current = revoked.record.policy.componentExceptions.find((item) => item.exceptionId === active.exceptionId)!;
    expect(current).toMatchObject({ state: "revoked", decisionRevision: 2, predecessorDecisionId: active.decisionId });
    expect(revoked.audit.action).toBe("revoke_exception");
    expect(replay.idempotent).toBe(true);
    await expect(h.service.revokeException({ ...revoke, reason: "Changed revoke payload." })).rejects.toThrow("PP_IDEMPOTENCY_KEY_REUSE_CONFLICT");
    h.provider.set(currentContext(h.contexts[0]!, revoked.record));
    const evaluated = await h.service.evaluate({ requestSchemaVersion: PASSIVE_EVALUATION_REQUEST_VERSION, requestId: "after-revoke", tenantId: "tenant-1", projectId: "project-1", branchId: "main", componentInstanceId: "C1", assemblyVariantId: "variant-default", policyRevisionId: revoked.record.policy.revisionId, purpose: "preview", actorContext: ADMIN, requestedAt: NOW });
    expect(evaluated.status).toBe("eligible_characterized_generic");
    expect(evaluated.appliedException).toBeUndefined();
    expect((await h.repository.history({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", policyId: "project-passive-policy" }))).toHaveLength(6);
    expect((await h.repository.invalidations({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", policyId: "project-passive-policy" })).filter((item) => item.affectedComponentIds.includes("C1"))).toHaveLength(2);
  });

  it("supersedes with a linked complete successor and rejects stale lifecycle revision", async () => {
    const h = await exceptionHarness("opt_out"), predecessor = h.committed.record.policy.componentExceptions.find((item) => item.state === "approved")!, successor = exceptionInput(h.committed.record, h.contexts[0]!, h.profile, "assign_profile", "exception-profile-successor"), request = { ...mutation(5, "supersede-exception", REVIEWER), recordId: h.committed.record.recordId, expectedPolicyDigest: h.committed.record.policy.technicalDigest, operation: "supersede" as const, predecessorExceptionId: predecessor.exceptionId, expectedExceptionDecisionRevision: predecessor.decisionRevision!, decisionEvidenceRefs: ["supersede-evidence-r1"], exception: successor } satisfies PassivePolicyExceptionSupersedeMutationRequest;
    await expect(h.service.supersedeException({ ...request, expectedExceptionDecisionRevision: 99 })).rejects.toThrow("PP_EXCEPTION_REVISION_CONFLICT");
    const result = await h.service.supersedeException(request), old = result.record.policy.componentExceptions.find((item) => item.exceptionId === predecessor.exceptionId)!, active = result.record.policy.componentExceptions.find((item) => item.exceptionId === successor.exceptionId)!;
    expect(old).toMatchObject({ state: "superseded", supersededByDecisionId: active.decisionId });
    expect(active).toMatchObject({ state: "approved", predecessorDecisionId: predecessor.decisionId, action: "assign_profile" });
    expect(result.audit.action).toBe("supersede_exception");
    expect(result.invalidation.affectedComponentIds).toEqual(["C1"]);
    expect((await h.repository.invalidations({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", policyId: "project-passive-policy" })).filter((item) => item.affectedComponentIds.includes("C1"))).toHaveLength(2);
  });

  it("leaves the predecessor effective when owner commit fails", async () => {
    const h = await exceptionHarness("opt_out"), active = h.committed.record.policy.componentExceptions.find((item) => item.state === "approved")!, repositoryScope = { tenantId: "tenant-1", projectId: "project-1", branchId: "main", policyId: "project-passive-policy" }, before = await h.repository.history(repositoryScope), beforeInvalidations = await h.repository.invalidations(repositoryScope), commit = vi.spyOn(h.repository, "commit").mockRejectedValueOnce(new Error("simulated-owner-commit-failure"));
    await expect(h.service.revokeException({ ...mutation(5, "failed-revoke", REVIEWER), recordId: h.committed.record.recordId, operation: "revoke", exceptionId: active.exceptionId, expectedExceptionDecisionRevision: active.decisionRevision!, decisionEvidenceRefs: ["revoke-evidence-r1"] })).rejects.toThrow("simulated-owner-commit-failure");
    commit.mockRestore();
    const after = await h.repository.history(repositoryScope);
    expect(after).toEqual(before);
    expect(await h.repository.invalidations(repositoryScope)).toEqual(beforeInvalidations);
    expect(after.at(-1)!.policy.componentExceptions.find((item) => item.exceptionId === active.exceptionId)?.state).toBe("approved");
  });
});

describe("Stage 3 invalidation contract", () => {
  it("stales dependent unapplied plans while preserving the board record", async () => {
    const stage3 = await readyHarness("C1"), preflight = await stage3.service.preflight(preflightRequest({ requestId: "preflight-passive", target: { kind: "new_board", boardId: "board-1", boardName: "Main Board", boardFormatVersion: "sirkit-json-pcb/1" } }));
    expect(preflight.plan).toBeDefined();
    if (!preflight.plan) throw new Error("PP_TEST_STAGE3_PLAN_REQUIRED");
    expect(["validated", "applicable"]).toContain(preflight.plan.lifecycle);
    const scope = { tenantId: "tenant-1", projectId: "project-1", branchId: "main", boardId: "board-1" }, boardBefore = await stage3.repository.getBoard(scope), target = new ScopedPassivePolicyInvalidationTarget(stage3.repository, [scope, scope]);
    const outcome = await target.invalidate({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", assemblyVariantIds: ["variant-default"], affectedComponentIds: ["C1"], fromPolicyRevisionId: null, toPolicyRevisionId: "project-passive-policy:r1", reason: "Policy publication", occurredAt: NOW });
    expect(outcome.stage3PlansStaled).toBe(1);
    expect((await stage3.repository.getPlan(scope, preflight.plan.planId))?.lifecycle).toBe("stale");
    expect(await stage3.repository.getBoard(scope)).toEqual(boardBefore);
    expect((await target.invalidate({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", assemblyVariantIds: ["variant-default", "variant-default"], affectedComponentIds: ["C1", "C1"], fromPolicyRevisionId: null, toPolicyRevisionId: "project-passive-policy:r1", reason: "Duplicate delivery", occurredAt: NOW })).stage3PlansStaled).toBe(0);
  });
});
