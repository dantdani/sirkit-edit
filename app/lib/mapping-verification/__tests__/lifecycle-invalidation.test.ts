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

import { InMemoryDurableWorkflowRepository } from "../../durable-workflow/repository";
import { readyRepository } from "../../footprint-resolver/__tests__/fixtures";
import { evaluatePhysicalReadiness } from "../../physical-binding/readiness";
import { PhysicalBindingService } from "../../physical-binding/repository";
import { createApprovedValidation } from "../../physical-binding/transitions";
import { ACTOR as PHYSICAL_ACTOR, transition as physicalTransition } from "../../physical-binding/__tests__/fixtures";
import { InMemoryPcbSyncRepository } from "../../pcb-sync/repository";
import { preflightRequest, readyHarness as pcbReadyHarness } from "../../pcb-sync/__tests__/fixtures";
import { ScopedMappingInvalidationTarget } from "../invalidation";
import { DurableMappingContextStore } from "../durable";
import { InMemoryMappingContextProvider } from "../providers";
import { InMemoryMappingRepository } from "../repository";
import { MappingVerificationService } from "../service";
import { InMemoryStage1MappingProjector, PhysicalBindingMappingProjector } from "../stage1-projector";
import { candidateTechnicalPayload, mappingDigest, mappingId } from "../stable";
import type { MappingMutationRequest, MappingRecord } from "../types";
import { ACTOR, contextFixture, exactCandidate, NOW, request } from "./fixtures";

function mutation(input: Partial<MappingMutationRequest> = {}): MappingMutationRequest {
  return { requestId: "mutation-1", tenantId: "tenant-1", projectId: "project-1", branchId: "main", componentInstanceId: "component-1", assemblyVariantId: "variant-default", expectedRevision: 0, idempotencyKey: "mapping-change-1", reason: "Review exact Stage 4 mapping.", actorContext: ACTOR, requestedAt: "2026-07-19T14:01:00.000Z", ...input };
}

async function harness(pcbRepository?: InMemoryPcbSyncRepository) {
  const context = contextFixture({ ...(pcbRepository ? { componentInstanceId: "sync-u1" } : {}) }), candidate = exactCandidate(context, { equivalence: true });
  const provider = new InMemoryMappingContextProvider({ contexts: [context], candidates: [candidate] });
  const repository = new InMemoryMappingRepository(), projector = new InMemoryStage1MappingProjector();
  const resultStore = new DurableMappingContextStore(new InMemoryDurableWorkflowRepository());
  const service = new MappingVerificationService({ provider, resultStore, repository, stage1Projector: projector, invalidation: new ScopedMappingInvalidationTarget(pcbRepository) });
  const verification = await service.verify(request(context, candidate));
  return { context, candidate, provider, repository, projector, service, verification };
}

describe("Stage 4 immutable lifecycle, approval, and invalidation", () => {
  it("persists verified-but-unapproved, separately approves, and replays idempotently", async () => {
    const h = await harness();
    const persisted = await h.service.persistVerification(mutation({ verificationId: h.verification.verificationId }));
    expect(persisted.record).toMatchObject({ revision: 1, lifecycle: "candidate", approval: { state: "unreviewed" }, verificationState: "verified_exact_part" });
    expect(persisted.stage1Reference).toMatchObject({ state: "pending", mappingApprovalState: "unreviewed" });
    const approved = await h.service.approve(mutation({ requestId: "approve-1", mappingId: persisted.record.mappingId, expectedRevision: 1, expectedMappingContentDigest: persisted.record.mappingContentDigest, idempotencyKey: "approve-key", requestedAt: "2026-07-19T14:02:00.000Z" }));
    expect(approved.record).toMatchObject({ revision: 2, lifecycle: "active", approval: { state: "approved" } });
    expect(approved.stage1Reference).toMatchObject({ state: "verified", verificationTier: "exact_part", mappingApprovalState: "approved", mappingFreshnessState: "current" });
    const replay = await h.service.approve(mutation({ requestId: "approve-replay", mappingId: persisted.record.mappingId, expectedRevision: 1, expectedMappingContentDigest: persisted.record.mappingContentDigest, idempotencyKey: "approve-key", requestedAt: "2026-07-19T14:03:00.000Z" }));
    expect(replay.idempotent).toBe(true);
    expect(await h.repository.history({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", componentInstanceId: "component-1", assemblyVariantId: "variant-default" })).toHaveLength(2);
    expect(await h.repository.audits({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", componentInstanceId: "component-1", assemblyVariantId: "variant-default" })).toHaveLength(2);
  });

  it("revokes through an immutable successor and makes the Stage 1 reference unusable", async () => {
    const h = await harness();
    const saved = await h.service.persistVerification(mutation({ verificationId: h.verification.verificationId }));
    const approved = await h.service.approve(mutation({ mappingId: saved.record.mappingId, expectedRevision: 1, idempotencyKey: "approve-2", requestedAt: "2026-07-19T14:02:00.000Z" }));
    const revoked = await h.service.revoke(mutation({ mappingId: saved.record.mappingId, expectedRevision: 2, idempotencyKey: "revoke-1", requestedAt: "2026-07-19T14:03:00.000Z", reason: "Evidence approval revoked." }));
    expect(revoked.record).toMatchObject({ revision: 3, lifecycle: "revoked", approval: { state: "revoked" }, verificationState: "revoked" });
    expect(revoked.stage1Reference.state).toBe("failed");
    expect((await h.repository.history({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", componentInstanceId: "component-1", assemblyVariantId: "variant-default" })).map((item) => item.revision)).toEqual([1, 2, 3]);
    expect(approved.record.recordDigest).not.toBe(revoked.record.recordDigest);
  });

  it("stales an applicable Stage 3 plan without creating or changing a board", async () => {
    const pcb = await pcbReadyHarness();
    const stage3 = await pcb.service.preflight(preflightRequest());
    expect(stage3.plan?.lifecycle).toBe("applicable");
    const h = await harness(pcb.repository);
    const before = await pcb.repository.getBoard({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", boardId: "board-1" });
    const saved = await h.service.persistVerification(mutation({ verificationId: h.verification.verificationId, componentInstanceId: "sync-u1" }));
    expect(saved.invalidation).toMatchObject({ stage2CacheMode: "disabled", stage3PlansStaled: 1 });
    expect((await pcb.repository.getPlan({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", boardId: "board-1" }, stage3.plan!.planId))?.lifecycle).toBe("stale");
    expect(await pcb.repository.getBoard({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", boardId: "board-1" })).toEqual(before);
    expect((await new ScopedMappingInvalidationTarget(pcb.repository).invalidate({ scope: saved.record.scope, oldCertificateId: saved.invalidation.oldCertificateId, newCertificateId: saved.invalidation.newCertificateId, newMappingRevisionId: saved.record.revisionId, reason: "Duplicate delivery", occurredAt: saved.record.createdAt })).stage3PlansStaled).toBe(0);
  });

  it("rejects cross-scope mutation, AI approval, stale revision, and wrong digest", async () => {
    const h = await harness();
    await expect(h.service.persistVerification(mutation({ verificationId: h.verification.verificationId, tenantId: "tenant-other" }))).rejects.toThrow("MV_VERIFICATION_NOT_PERSISTABLE");
    const saved = await h.service.persistVerification(mutation({ verificationId: h.verification.verificationId }));
    await expect(h.service.approve(mutation({ mappingId: saved.record.mappingId, expectedRevision: 1, idempotencyKey: "ai-approval", actorContext: { ...ACTOR, actorKind: "ai" } }))).rejects.toThrow("MV_MAPPING_MUTATION_HUMAN_REQUIRED");
    await expect(h.service.approve(mutation({ mappingId: saved.record.mappingId, expectedRevision: 0, idempotencyKey: "stale-approval" }))).rejects.toThrow("MV_OPTIMISTIC_REVISION_CONFLICT");
    await expect(h.service.approve(mutation({ mappingId: saved.record.mappingId, expectedRevision: 1, expectedMappingContentDigest: "mv1-wrong", idempotencyKey: "wrong-digest" }))).rejects.toThrow("MV_MAPPING_CONTENT_DIGEST_MISMATCH");
  });

  it("serializes concurrent approvals so exactly one expected revision wins", async () => {
    const h = await harness();
    const saved = await h.service.persistVerification(mutation({ verificationId: h.verification.verificationId }));
    const attempts = await Promise.allSettled(["concurrent-a", "concurrent-b"].map((key) => h.service.approve(mutation({ mappingId: saved.record.mappingId, expectedRevision: 1, idempotencyKey: key }))));
    expect(attempts.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((item) => item.status === "rejected" && String(item.reason).includes("MV_OPTIMISTIC_REVISION_CONFLICT"))).toHaveLength(1);
  });

  it("revalidates authoritative dependencies at persist and approval time", async () => {
    const beforePersist = await harness();
    const staleContext = structuredClone(beforePersist.context);
    staleContext.evidence[0]!.freshness = "stale";
    beforePersist.provider.setContext(staleContext);
    await expect(beforePersist.service.persistVerification(mutation({ verificationId: beforePersist.verification.verificationId }))).rejects.toThrow("MV_VERIFICATION_STALE");

    const beforeApproval = await harness();
    const saved = await beforeApproval.service.persistVerification(mutation({ verificationId: beforeApproval.verification.verificationId }));
    const conflictingContext = structuredClone(beforeApproval.context);
    conflictingContext.evidence[0]!.freshness = "conflicting";
    beforeApproval.provider.setContext(conflictingContext);
    await expect(beforeApproval.service.approve(mutation({ mappingId: saved.record.mappingId, expectedRevision: 1, idempotencyKey: "approve-after-change" }))).rejects.toThrow("MV_VERIFICATION_STALE");
  });

  it("projects mapping evidence without silently granting Stage 1 physical approval", async () => {
    const h = await harness();
    const saved = await h.service.persistVerification(mutation({ verificationId: h.verification.verificationId }));
    const approved = await h.service.approve(mutation({ mappingId: saved.record.mappingId, expectedRevision: 1, idempotencyKey: "approve-projectable" }));
    const stage1 = await readyRepository("component-1");
    const states = await stage1.repository.findForComponentVariant({ ...stage1.binding.scope, assemblyVariantId: "variant-default" });
    const original = states[0]!, current = original.bindings.find((item) => item.revisionId === original.set.effectiveSelectedRevisionId)!;
    const projectable = structuredClone(approved.record) as MappingRecord;
    projectable.scope = { tenantId: current.scope.tenantId, projectId: current.scope.projectId, branchId: current.scope.branchId, boardInstanceId: current.scope.boardInstanceId, componentInstanceId: current.scope.componentInstanceId, bindingSetId: original.set.setId, bindingRevisionId: current.revisionId, hierarchyPath: current.scope.hierarchyPath, assemblyVariantId: "variant-default" };
    projectable.candidate.scope = projectable.scope;
    projectable.candidate.symbolIdentity.versionId = current.dependencies.symbolAssetVersionId!;
    projectable.candidate.footprintIdentity.versionId = current.footprint!.assetVersionId;
    projectable.candidate.footprintIdentity.contentDigest = current.footprint!.contentDigest!;
    projectable.candidate.packageIdentity.packageIdentityId = current.package!.packageIdentityId;
    projectable.candidate.packageIdentity.packageRevisionId = current.package!.packageRevisionId;
    projectable.candidate.candidateDigest = mappingDigest(candidateTechnicalPayload(projectable.candidate));
    projectable.candidate.mappingCandidateId = mappingId("mapping-candidate", projectable.candidate.candidateDigest);
    projectable.mappingContentDigest = mappingDigest({ scope: projectable.scope, candidate: candidateTechnicalPayload(projectable.candidate), verificationResultDigest: projectable.verification.resultDigest });
    const { recordDigest: _digest, ...raw } = projectable; void _digest; projectable.recordDigest = mappingDigest(raw);
    const projector = new PhysicalBindingMappingProjector(stage1.repository);
    const reference = await projector.project(projectable, ACTOR, "project-real-stage1");
    expect(reference).toMatchObject({ state: "verified", verificationTier: "exact_part", mappingRevisionId: projectable.revisionId });
    const after = (await stage1.repository.findForComponentVariant({ ...current.scope, assemblyVariantId: "variant-default" }))[0]!;
    const successor = after.bindings.find((item) => item.revisionId === after.set.effectiveSelectedRevisionId)!;
    expect(successor.predecessorRevisionId).toBe(current.revisionId);
    expect(successor.approval.state).toBe("unreviewed");
    expect(successor.technicalValidation.state).toBe("pending");
    expect(evaluatePhysicalReadiness(successor, { assessedAt: NOW, effectiveSelectedRevisionId: successor.revisionId }).layout).not.toBe("ready");
    await projector.project(projectable, ACTOR, "project-real-stage1");
    expect((await stage1.repository.load(after.set.setId))?.set.revision).toBe(after.set.revision);

    const physical = new PhysicalBindingService(stage1.repository);
    let physicalRequest = physicalTransition(successor, after.set.revision, "revalidate", PHYSICAL_ACTOR);
    physicalRequest.idempotencyKey = "b08-explicit-revalidate";
    physicalRequest.validation = createApprovedValidation(successor, { validatorVersion: "physical-binding-validator/1", at: physicalRequest.at, evidenceRefs: ["evidence-mapping"] });
    const validated = await physical.transition(after.set.setId, physicalRequest), validatedBinding = validated.bindings.find((item) => item.revisionId === validated.set.effectiveSelectedRevisionId)!;
    physicalRequest = physicalTransition(validatedBinding, validated.set.revision, "approve", PHYSICAL_ACTOR);
    physicalRequest.idempotencyKey = "b08-explicit-approve";
    physicalRequest.decisionEvidenceRefs = ["evidence-datasheet"];
    const physicallyApproved = await physical.transition(validated.set.setId, physicalRequest), approvedBinding = physicallyApproved.bindings.find((item) => item.revisionId === physicallyApproved.set.effectiveSelectedRevisionId)!;
    expect(approvedBinding.approval).toMatchObject({ state: "approved", decisionEvidenceRefs: ["evidence-datasheet"] });
    expect(evaluatePhysicalReadiness(approvedBinding, { assessedAt: NOW, effectiveSelectedRevisionId: approvedBinding.revisionId }).layout).toBe("ready");
  });
});
