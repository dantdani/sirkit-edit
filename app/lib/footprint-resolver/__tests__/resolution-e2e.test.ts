import { describe, expect, it } from "vitest";
import { createProductionFootprintResolutionService, FootprintResolutionService } from "../service";
import { ACTOR, exactCandidate, legacyRepository, NOW, resolverRequest, scope } from "./fixtures";
import { createPhysicalBindingCandidate } from "../../physical-binding/domain";
import { InMemoryPhysicalBindingRepository, PhysicalBindingService } from "../../physical-binding/repository";
import { createApprovedValidation } from "../../physical-binding/transitions";
import { transition } from "../../physical-binding/__tests__/fixtures";
import type { ComponentPhysicalBinding } from "../../physical-binding/types";
import { InMemoryPassivePolicyContextProvider } from "../../passive-policy/providers";
import { ASSEMBLY, componentFixture, contextFixture, policyFixture, profileFixture } from "../../passive-policy/__tests__/fixtures";
import { passiveExceptionContextDigest, withPassiveExceptionDecisionIntegrity } from "../../passive-policy/policy";
import { passivePolicyDigest, withPolicyDigest } from "../../passive-policy/stable";
import { PASSIVE_EXCEPTION_CONTRACT_VERSION, type PassiveComponentException, type PassiveComponentSnapshot } from "../../passive-policy/types";
import { InMemoryPcbSyncSnapshotProvider } from "../../pcb-sync/providers";
import { InMemoryPcbSyncRepository } from "../../pcb-sync/repository";
import { PcbSynchronizationService } from "../../pcb-sync/service";
import { pcbSyncDigest } from "../../pcb-sync/stable";
import type { PcbSyncFootprintMaterialization } from "../../pcb-sync/types";
import { applyRequest, footprintDef, preflightRequest, snapshot } from "../../pcb-sync/__tests__/fixtures";

function withDecisionEvidence(request: ReturnType<typeof transition>, evidenceRefs: string[]) {
  return { ...request, decisionEvidenceRefs: [...new Set(evidenceRefs)].sort() };
}

async function addReadyCandidate(repository: InMemoryPhysicalBindingRepository, candidate: ComponentPhysicalBinding): Promise<ComponentPhysicalBinding> {
  const service = new PhysicalBindingService(repository);
  let state = await service.createCandidate(candidate, `create-${candidate.bindingId}`);
  state = await service.transition(state.set.setId, withDecisionEvidence(transition(candidate, state.set.revision, "select", ACTOR), candidate.evidenceRefs));
  let current = state.bindings.find((binding) => binding.revisionId === state.set.effectiveSelectedRevisionId)!;
  const validation = transition(current, state.set.revision, "revalidate", ACTOR);
  validation.validation = createApprovedValidation(current, { validatorVersion: "physical-binding-validator/1", at: validation.at, evidenceRefs: ["evidence-mapping"] });
  state = await service.transition(state.set.setId, validation);
  current = state.bindings.find((binding) => binding.revisionId === state.set.effectiveSelectedRevisionId)!;
  state = await service.transition(state.set.setId, withDecisionEvidence(transition(current, state.set.revision, "approve", ACTOR), current.evidenceRefs));
  return state.bindings.find((binding) => binding.revisionId === state.set.effectiveSelectedRevisionId)!;
}

async function readyRepository(componentId: string, options: { manufacturingComplete?: boolean; variants?: string[] } = {}) {
  const repository = new InMemoryPhysicalBindingRepository();
  const binding = await addReadyCandidate(repository, exactCandidate(componentId, options));
  return { repository, binding };
}

async function dnpRepository(componentId: string) {
  const repository = new InMemoryPhysicalBindingRepository();
  const candidate = createPhysicalBindingCandidate({ scope: scope(componentId), classification: { populationKind: "dnp", deviceClass: "passive", mountingTechnology: "unknown", polarity: "unknown", classificationEvidenceRefs: ["variant-rule"] }, origin: { kind: "human_selection", actor: ACTOR, sourceRef: "variant-rule", createdAt: NOW, evidenceRefs: ["variant-rule"] }, evidenceRefs: ["variant-rule"], applicabilityState: "not_applicable", createdAt: NOW, createdBy: ACTOR, candidateKey: `dnp-${componentId}` });
  const service = new PhysicalBindingService(repository);
  let state = await service.createCandidate(candidate, `create-dnp-${componentId}`);
  state = await service.transition(state.set.setId, withDecisionEvidence(transition(candidate, state.set.revision, "select", ACTOR), candidate.evidenceRefs));
  const current = state.bindings.find((binding) => binding.revisionId === state.set.effectiveSelectedRevisionId)!;
  const revalidate = transition(current, state.set.revision, "revalidate", ACTOR);
  revalidate.validation = createApprovedValidation(current, { validatorVersion: "variant-validator/1", at: revalidate.at, evidenceRefs: ["variant-rule"] });
  state = await service.transition(state.set.setId, revalidate);
  return { repository, binding: state.bindings.find((binding) => binding.revisionId === state.set.effectiveSelectedRevisionId)! };
}

function policyWithCompleteProfileException(component: PassiveComponentSnapshot) {
  const profile = profileFixture();
  const base = policyFixture({ profile, revision: 1 });
  const approvedContext = contextFixture({ component, policy: base, profiles: [profile], purpose: "stage2_resolution" });
  const effectivePolicyRevisionId = `${base.policyId}:exception-r2`;
  const selection = { kind: "profile" as const, profileId: profile.profileId, profileRevisionId: profile.revisionId, profileDigest: profile.profileDigest, packageIdentityId: profile.exactPackageIdentity.packageIdentityId, packageRevisionId: profile.exactPackageIdentity.packageRevisionId, footprintLogicalAssetId: profile.exactFootprintAssetIdentity.logicalAssetId, footprintAssetVersionId: profile.exactFootprintAssetIdentity.assetVersionId, footprintContentDigest: profile.exactFootprintAssetIdentity.contentDigest!, mappingRevisionId: profile.stage4MappingProfileRef.mappingRevisionId!, mappingContentDigest: profile.stage4MappingProfileRef.mappingContentDigest!, mappingResultDigest: profile.stage4MappingProfileRef.verificationResultDigest! };
  const exception = withPassiveExceptionDecisionIntegrity({ exceptionContractVersion: PASSIVE_EXCEPTION_CONTRACT_VERSION, exceptionId: "exception-profile-c1", decisionRevision: 1, componentInstanceId: component.scope.componentInstanceId, assemblyVariantIds: [component.scope.assemblyVariantId], action: "assign_profile" as const, targetProfileId: profile.profileId, selection, authority: { tenantId: component.scope.tenantId, projectId: component.scope.projectId, branchId: component.scope.branchId, componentInstanceId: component.scope.componentInstanceId, variants: [{ assemblyVariantId: component.scope.assemblyVariantId, boardInstanceId: component.scope.boardInstanceId, componentSnapshotId: component.snapshotId, componentRevisionId: component.componentRevisionId, componentDigest: component.dependencyDigest, stableComponentIdentityDigest: passivePolicyDigest(component.stableIdentity), contextDependencyDigest: passiveExceptionContextDigest(approvedContext.dependencySnapshot, base.technicalDigest) }], policyId: base.policyId, approvedAgainstPolicyRevisionId: base.revisionId, approvedAgainstPolicyDigest: base.technicalDigest, expectedPolicyRecordRevision: 1, effectivePolicyRevisionId, assemblyProfileId: ASSEMBLY.assemblyProfileId, assemblyProfileRevisionId: ASSEMBLY.revisionId, assemblyProfileDigest: ASSEMBLY.dependencyDigest }, state: "approved" as const, reason: "Approved exact profile exception.", evidenceRefs: ["exception-evidence-r1"], approvedAt: "2026-07-18T13:00:00.000Z", createdBy: ACTOR, mutationDigest: passivePolicyDigest({ operation: "approve", component: component.dependencyDigest, policy: base.technicalDigest }) } as PassiveComponentException);
  const policy = withPolicyDigest({ ...base, revision: 2, revisionId: effectivePolicyRevisionId, supersedesRevisionId: base.revisionId, componentExceptions: [exception], technicalDigest: undefined } as never);
  return { profile, exception, policy, context: contextFixture({ component, policy, profiles: [profile], purpose: "stage2_resolution" }) };
}

function revokeCompleteProfileException(complete: ReturnType<typeof policyWithCompleteProfileException>) {
  const exception = withPassiveExceptionDecisionIntegrity({ ...complete.exception, decisionRevision: 2, predecessorDecisionId: complete.exception.decisionId, state: "revoked" as const, approvedAt: "2026-07-18T13:30:00.000Z", mutationDigest: passivePolicyDigest({ operation: "revoke", decision: complete.exception.decisionId }) });
  const policy = withPolicyDigest({ ...complete.policy, revision: 3, revisionId: `${complete.policy.policyId}:exception-r3`, supersedesRevisionId: complete.policy.revisionId, componentExceptions: [exception], technicalDigest: undefined } as never);
  return { exception, policy };
}

async function stage3HarnessForResolver(componentId: string, resolver: FootprintResolutionService) {
  const resolution = await resolver.resolve(resolverRequest(componentId, { policyVersion: "1.1.0-stage5-passive-policy" }));
  const binding = resolution.resolvedBinding!;
  const def = footprintDef();
  const mappingBase = { schemaVersion: "sirkit.verified-pin-pad-mapping.v1" as const, mappingCertificateId: binding.pinPadMapping.mappingCertificateId!, verifierVersion: binding.pinPadMapping.verifierVersion!, state: "verified" as const, symbolAssetVersionId: binding.pinPadMapping.symbolAssetVersionId!, footprintAssetVersionId: binding.footprintAsset.assetVersionId, footprintContentDigest: binding.footprintAsset.contentDigest!, entries: [{ symbolPinNumber: "1", pinInstanceId: `${componentId}:pin:1`, padNumbers: ["1"], mappingKind: "electrical" as const }, { symbolPinNumber: "2", pinInstanceId: `${componentId}:pin:2`, padNumbers: ["2"], mappingKind: "electrical" as const }], mechanicalPadNumbers: [], evidenceRefs: ["mapping-evidence"] };
  const mapping = { ...mappingBase, artifactDigest: pcbSyncDigest(mappingBase) };
  const materializationBase = { componentInstanceId: componentId, bindingRevisionId: binding.bindingRevisionId, assetVersionId: binding.footprintAsset.assetVersionId, assetContentDigest: binding.footprintAsset.contentDigest!, assetSemanticDigest: binding.footprintAsset.semanticDigest, footprintFullName: `${def.libName}:${def.name}`, footprintDef: def, mapping };
  const materialization: PcbSyncFootprintMaterialization = { ...materializationBase, materializationDigest: pcbSyncDigest({ ...materializationBase, footprintDef: { libName: def.libName, name: def.name, pads: def.pads } }) };
  const repository = new InMemoryPcbSyncRepository();
  const service = new PcbSynchronizationService({ snapshotProvider: new InMemoryPcbSyncSnapshotProvider([snapshot([componentId])]), resolver, resourceProvider: { async materialize() { return structuredClone(materialization); } }, repository, clock: () => "2026-07-19T12:01:00.000Z" });
  return { repository, service };
}

describe("Stage 2 end-to-end product truth", () => {
  it("uses the canonical production source composition for a qualified passive policy", async () => {
    const contexts = new InMemoryPassivePolicyContextProvider([contextFixture({ component: componentFixture({ componentId: "policy-c1", hierarchyPath: ["root", "motor-control"] }), purpose: "stage2_resolution" })]);
    const service = createProductionFootprintResolutionService({ repository: new InMemoryPhysicalBindingRepository(), passivePolicyContexts: contexts });
    const request = resolverRequest("policy-c1", { policyVersion: "1.1.0-stage5-passive-policy" });
    const result = await service.resolve(request);
    const batch = await service.resolveBatch({ schemaVersion: "sirkit.footprint-resolution-batch-request.v1", batchId: "policy-c1-batch", requests: [request] });
    expect(result.blockers.map((issue) => ({ code: issue.code, details: issue.safeDetails }))).toEqual([]);
    expect(result.status).toBe("resolved");
    expect(result.resolvedBinding?.authorityClass).toBe("approved_passive_policy");
    expect(result.inputSnapshot.sourceVersions.find((source) => source.sourceKind === "passive_policy")).toMatchObject({ status: "success", sourceVersion: "sirkit.passive-policy-stage2-adapter/1.1.0" });
    expect(result.inputSnapshot.sourceVersions.some((source) => source.sourceVersion.includes("disabled"))).toBe(false);
    expect(batch.results[0]?.decisionDigest).toBe(result.decisionDigest);
    expect(batch.results[0]?.inputSnapshot.dependencyDigest).toBe(result.inputSnapshot.dependencyDigest);
  });

  it("fails closed when Stage 5 authority is unavailable and never guesses a package", async () => {
    const service = createProductionFootprintResolutionService({ repository: new InMemoryPhysicalBindingRepository(), passivePolicyContexts: new InMemoryPassivePolicyContextProvider() });
    const result = await service.resolve(resolverRequest("missing-policy-c1", { policyVersion: "1.1.0-stage5-passive-policy" }));
    expect(result.status).toBe("blocked_unavailable");
    expect(result.resolvedBinding).toBeUndefined();
    expect(result.blockers.map((issue) => issue.code)).toContain("PP_STAGE2_AUTHORITY_UNAVAILABLE");
    expect(result.suggestedCandidates).toEqual([]);
  });

  it("keeps identical B5 authority deterministic and invalidates dependencies on policy revision", async () => {
    const component = componentFixture({ componentId: "policy-revision-c1", hierarchyPath: ["root", "motor-control"] });
    const contexts = new InMemoryPassivePolicyContextProvider([contextFixture({ component, policy: policyFixture({ revision: 1 }), purpose: "stage2_resolution" })]);
    const service = createProductionFootprintResolutionService({ repository: new InMemoryPhysicalBindingRepository(), passivePolicyContexts: contexts });
    const request = resolverRequest("policy-revision-c1", { policyVersion: "1.1.0-stage5-passive-policy" });
    const first = await service.resolve(request);
    const unchanged = await service.resolve({ ...request, requestId: "policy-revision-c1-repeat", requestedAt: "2026-07-18T14:01:00.000Z" });
    expect(unchanged.inputSnapshot.dependencyDigest).toBe(first.inputSnapshot.dependencyDigest);
    expect(unchanged.decisionDigest).toBe(first.decisionDigest);
    contexts.set(contextFixture({ component, policy: policyFixture({ revision: 2 }), purpose: "stage2_resolution" }));
    const revised = await service.resolve({ ...request, requestId: "policy-revision-c1-r2" });
    expect(revised.inputSnapshot.dependencyDigest).not.toBe(first.inputSnapshot.dependencyDigest);
    expect(revised.decisionDigest).not.toBe(first.decisionDigest);
  });

  it("traces a revision-complete B04 exception and invalidates its lifecycle dependency", async () => {
    const component = componentFixture({ componentId: "exception-c1", hierarchyPath: ["root", "motor-control"] });
    const complete = policyWithCompleteProfileException(component);
    const contexts = new InMemoryPassivePolicyContextProvider([complete.context]);
    const service = createProductionFootprintResolutionService({ repository: new InMemoryPhysicalBindingRepository(), passivePolicyContexts: contexts });
    const request = resolverRequest("exception-c1", { policyVersion: "1.1.0-stage5-passive-policy" });
    const approved = await service.resolve(request);
    const approvedContext = await service.assembleContext(request);
    const passiveSource = approvedContext.sourceResults.find((source) => source.sourceKind === "passive_policy")!;
    expect(approved.status).toBe("resolved");
    expect(approved.resolvedBinding?.approvalEvidenceRefs).toEqual(expect.arrayContaining([complete.exception.decisionId, complete.exception.approvalDigest, complete.exception.mutationDigest, "exception-evidence-r1"]));
    expect(passiveSource.dependencyDigests).toEqual(expect.arrayContaining([complete.exception.decisionId, complete.exception.approvalDigest, complete.exception.mutationDigest, complete.policy.revisionId, complete.policy.technicalDigest, complete.profile.revisionId, complete.profile.profileDigest]));

    const revoked = revokeCompleteProfileException(complete);
    contexts.set(contextFixture({ component, policy: revoked.policy, profiles: [complete.profile], purpose: "stage2_resolution" }));
    const afterRevocation = await service.resolve({ ...request, requestId: "exception-c1-revoked" });
    expect(afterRevocation.inputSnapshot.dependencyDigest).not.toBe(approved.inputSnapshot.dependencyDigest);
    expect(afterRevocation.decisionDigest).not.toBe(approved.decisionDigest);
  });

  it("does not let an incomplete legacy exception produce a ready candidate", async () => {
    const component = componentFixture({ componentId: "legacy-exception-c1", hierarchyPath: ["root", "motor-control"] });
    const base = policyFixture();
    const legacy: PassiveComponentException = { exceptionId: "legacy-exception", componentInstanceId: component.scope.componentInstanceId, assemblyVariantIds: [component.scope.assemblyVariantId], action: "assign_profile", targetProfileId: profileFixture().profileId, state: "approved", reason: "Legacy incomplete exception.", evidenceRefs: ["legacy-exception-evidence"], createdBy: ACTOR };
    const policy = withPolicyDigest({ ...base, componentExceptions: [legacy], technicalDigest: undefined } as never);
    const contexts = new InMemoryPassivePolicyContextProvider([contextFixture({ component, policy, purpose: "stage2_resolution" })]);
    const result = await createProductionFootprintResolutionService({ repository: new InMemoryPhysicalBindingRepository(), passivePolicyContexts: contexts }).resolve(resolverRequest("legacy-exception-c1", { policyVersion: "1.1.0-stage5-passive-policy" }));
    expect(result.status).toBe("blocked_stale");
    expect(result.resolvedBinding).toBeUndefined();
    expect(result.blockers.map((issue) => issue.code)).toContain("PP_STAGE2_POLICY_STALE");
  });

  it("makes B02 apply revalidation reject a plan after a real B5 policy revision change", async () => {
    const componentId = "stage3-policy-c1";
    const component = componentFixture({ componentId, hierarchyPath: ["root", "motor-control"] });
    const contexts = new InMemoryPassivePolicyContextProvider([contextFixture({ component, policy: policyFixture({ revision: 1 }), purpose: "stage2_resolution" })]);
    const resolver = createProductionFootprintResolutionService({ repository: new InMemoryPhysicalBindingRepository(), passivePolicyContexts: contexts });
    const stage3 = await stage3HarnessForResolver(componentId, resolver);
    const preflight = await stage3.service.preflight(preflightRequest({ requestId: "b05-policy-r1", resolutionPolicyVersion: "1.1.0-stage5-passive-policy" }));
    expect(preflight.status).toBe("ready_to_apply");
    contexts.set(contextFixture({ component, policy: policyFixture({ revision: 2 }), purpose: "stage2_resolution" }));
    const applied = await stage3.service.apply(applyRequest(preflight.plan!, { requestId: "b05-policy-r2-apply" }));
    expect(applied).toMatchObject({ status: "blocked_stale", boardChanged: false });
    expect(applied.blockers.map((issue) => issue.code)).toContain("PS_PLAN_STALE");
    expect(await stage3.repository.getBoard({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", boardId: "board-1" })).toBeNull();
  });

  it("makes B02 apply revalidation reject an old plan after B04 exception revocation", async () => {
    const componentId = "stage3-exception-c1";
    const component = componentFixture({ componentId, hierarchyPath: ["root", "motor-control"] });
    const complete = policyWithCompleteProfileException(component);
    const contexts = new InMemoryPassivePolicyContextProvider([complete.context]);
    const resolver = createProductionFootprintResolutionService({ repository: new InMemoryPhysicalBindingRepository(), passivePolicyContexts: contexts });
    const stage3 = await stage3HarnessForResolver(componentId, resolver);
    const preflight = await stage3.service.preflight(preflightRequest({ requestId: "b05-exception-approved", resolutionPolicyVersion: "1.1.0-stage5-passive-policy" }));
    expect(preflight.status).toBe("ready_to_apply");
    const revoked = revokeCompleteProfileException(complete);
    contexts.set(contextFixture({ component, policy: revoked.policy, profiles: [complete.profile], purpose: "stage2_resolution" }));
    const applied = await stage3.service.apply(applyRequest(preflight.plan!, { requestId: "b05-exception-revoked-apply" }));
    expect(applied).toMatchObject({ status: "blocked_stale", boardChanged: false });
    expect(applied.blockers.map((issue) => issue.code)).toContain("PS_PLAN_STALE");
    expect(await stage3.repository.getBoard({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", boardId: "board-1" })).toBeNull();
  });

  it("keeps an exact approved B1 binding ahead of project passive policy", async () => {
    const { repository, binding } = await readyRepository("precedence-c1");
    const contexts = new InMemoryPassivePolicyContextProvider([contextFixture({ component: componentFixture({ componentId: "precedence-c1", hierarchyPath: ["root", "motor-control"] }), purpose: "stage2_resolution" })]);
    const result = await createProductionFootprintResolutionService({ repository, passivePolicyContexts: contexts }).resolve(resolverRequest("precedence-c1", { policyVersion: "1.1.0-stage5-passive-policy" }));
    expect(result.status).toBe("resolved");
    expect(result.resolvedBinding).toMatchObject({ bindingRevisionId: binding.revisionId, authorityClass: "selected_stage1" });
    expect(result.inputSnapshot.sourceVersions.find((source) => source.sourceKind === "passive_policy")?.status).toBe("empty");
  });

  it("resolves global and multi-variant bindings consistently without changing binding identity", async () => {
    const global = await readyRepository("global-c1", { variants: [] });
    const globalA = await new FootprintResolutionService(global.repository).resolve(resolverRequest("global-c1", { assemblyVariantId: "variant-a", requestId: "global-a" }));
    const globalB = await new FootprintResolutionService(global.repository).resolve(resolverRequest("global-c1", { assemblyVariantId: "variant-b", requestId: "global-b" }));
    expect(globalA.status).toBe("resolved");
    expect(globalB.status).toBe("resolved");
    expect(globalA.resolvedBinding?.bindingRevisionId).toBe(global.binding.revisionId);
    expect(globalB.resolvedBinding?.bindingRevisionId).toBe(global.binding.revisionId);

    const explicit = await readyRepository("multi-c1", { variants: ["variant-b", "variant-a"] });
    expect((await new FootprintResolutionService(explicit.repository).resolve(resolverRequest("multi-c1", { assemblyVariantId: "variant-a" }))).status).toBe("resolved");
    expect((await new FootprintResolutionService(explicit.repository).resolve(resolverRequest("multi-c1", { assemblyVariantId: "variant-b" }))).status).toBe("resolved");
    const nonmatching = await new FootprintResolutionService(explicit.repository).resolve(resolverRequest("multi-c1", { assemblyVariantId: "variant-c" }));
    expect(nonmatching.status).toBe("unresolved_missing_data");
    expect(nonmatching.blockers.map((issue) => issue.code)).toContain("FR_STAGE1_BINDING_SET_MISSING");
  });
  it("returns one immutable exact asset only for a selected approved current validated binding", async () => {
    const { repository, binding } = await readyRepository("exact-resolved");
    const result = await new FootprintResolutionService(repository).resolve(resolverRequest("exact-resolved"));
    expect(result.status).toBe("resolved");
    expect(result.resolvedBinding).toMatchObject({ bindingRevisionId: binding.revisionId, footprintAsset: { assetVersionId: binding.footprint?.assetVersionId, contentDigest: binding.footprint?.contentDigest }, pinPadMapping: { state: "verified" }, readiness: { layout: "ready", manufacturing: "not_ready" } });
    expect(result.trace.steps.at(-1)?.code).toBe("FR_STATUS_RESOLVED");
    expect(result.cache).toMatchObject({ mode: "disabled", status: "not_applicable" });
  });

  it("distinguishes layout resolution from manufacturing-incomplete resolution", async () => {
    const { repository } = await readyRepository("manufacturing-incomplete");
    const service = new FootprintResolutionService(repository);
    expect((await service.resolve(resolverRequest("manufacturing-incomplete", { purpose: "layout_transfer" }))).status).toBe("resolved");
    const manufacturing = await service.resolve(resolverRequest("manufacturing-incomplete", { purpose: "manufacturing_assessment", requestId: "request-manufacturing" }));
    expect(manufacturing.status).not.toBe("resolved");
    expect(manufacturing.readinessAssessment?.manufacturing).toBe("not_ready");
    expect(manufacturing.blockers.map((issue) => issue.code)).toContain("FR_READINESS_PB_MANUFACTURING_EVIDENCE");
  });

  it("resolves manufacturing purpose only when Stage 1 manufacturing gates pass", async () => {
    const { repository } = await readyRepository("manufacturing-ready", { manufacturingComplete: true });
    const result = await new FootprintResolutionService(repository).resolve(resolverRequest("manufacturing-ready", { purpose: "manufacturing_assessment" }));
    expect(result.status).toBe("resolved");
    expect(result.resolvedBinding?.readiness.manufacturing).toBe("ready");
  });

  it("does not solve generic J1 from refdes or pin count", async () => {
    const result = await new FootprintResolutionService(new InMemoryPhysicalBindingRepository()).resolve(resolverRequest("generic-j1"));
    expect(result.status).toBe("unresolved_missing_data");
    expect(result.resolvedBinding).toBeUndefined();
    expect(result.blockers.map((issue) => issue.code)).toContain("FR_STAGE1_BINDING_SET_MISSING");
  });

  it("does not turn electrical value 100n into package truth", async () => {
    const { repository } = await legacyRepository("generic-100n", { refDes: "C1", value: "100n", footprintHint: "Capacitor_SMD:C_0603_1608Metric" });
    const result = await new FootprintResolutionService(repository).resolve(resolverRequest("generic-100n"));
    expect(result.status).toBe("unresolved_missing_data");
    expect(result.resolvedBinding).toBeUndefined();
    expect(result.blockers.map((issue) => issue.code)).toContain("FR_PACKAGE_MISSING");
  });

  it("preserves bare 0603 as explicit package ambiguity", async () => {
    const { repository } = await legacyRepository("ambiguous-0603", { refDes: "C1", value: "100n", package: "0603", footprintHint: "Capacitor_SMD:C_0603_1608Metric" });
    const result = await new FootprintResolutionService(repository).resolve(resolverRequest("ambiguous-0603"));
    expect(result.status).toBe("unresolved_ambiguous");
    expect(result.resolvedBinding).toBeUndefined();
    expect(result.suggestedCandidates).toHaveLength(1);
    expect(result.blockers.map((issue) => issue.code)).toEqual(expect.arrayContaining(["FR_PACKAGE_AMBIGUOUS", "FR_MAPPING_UNVERIFIED", "FR_APPROVAL_REQUIRED"]));
  });

  it("returns explicit not-applicable for a current selected DNP variant", async () => {
    const { repository } = await dnpRepository("dnp-c1");
    const result = await new FootprintResolutionService(repository).resolve(resolverRequest("dnp-c1"));
    expect(result.status).toBe("not_applicable");
    expect(result.resolvedBinding).toBeUndefined();
  });

  it("uses stable component identity rather than a reference designator", async () => {
    const { repository } = await readyRepository("stable-component-id");
    const before = await new FootprintResolutionService(repository).resolve(resolverRequest("stable-component-id", { requestId: "before-refdes-rename" }));
    const after = await new FootprintResolutionService(repository).resolve(resolverRequest("stable-component-id", { requestId: "after-refdes-rename" }));
    expect(after.resolvedBinding).toEqual(before.resolvedBinding);
    expect(after.decisionDigest).toBe(before.decisionDigest);
  });
});
