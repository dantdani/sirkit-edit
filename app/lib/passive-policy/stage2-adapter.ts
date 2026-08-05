import { performance } from "node:perf_hooks";
import { physicalBindingId, withBindingDigests } from "../physical-binding/stable";
import { PHYSICAL_BINDING_SCHEMA_VERSION, type ComponentPhysicalBinding } from "../physical-binding/types";
import { resolverDigest, resolverId } from "../footprint-resolver/stable";
import type { CandidateCollectionContext, CandidateSourceResult, FootprintCandidateSource, RawFootprintCandidate } from "../footprint-resolver/types";
import { inspectAssemblyVariantScope } from "../footprint-resolver/variant-scope";
import { DeterministicPassivePolicyEvaluator } from "./evaluator";
import { passivePolicyId } from "./stable";
import { PASSIVE_EVALUATION_REQUEST_VERSION, PASSIVE_POLICY_EVALUATOR_VERSION, type PassivePolicyContext, type PassivePolicyContextProvider, type PassivePolicyEvaluationResult } from "./types";

const ELIGIBLE = new Set<PassivePolicyEvaluationResult["status"]>(["eligible_characterized_generic", "eligible_layout_reservation"]);

function passiveAuthorityDependencies(context: PassivePolicyContext, result?: PassivePolicyEvaluationResult): string[] {
  const policy = context.policy;
  const profile = result?.selectedProfile;
  const appliedException = result?.appliedException;
  const completeException = appliedException ? policy?.componentExceptions.find((item) => item.decisionId === appliedException.decisionId) : undefined;
  const authorityDigest = resolverDigest({
    policy: policy ? { id: policy.policyId, revision: policy.revision, revisionId: policy.revisionId, technicalDigest: policy.technicalDigest, ruleLanguageVersion: policy.ruleLanguageVersion, evaluatorVersion: policy.evaluatorVersion } : null,
    context: context.dependencySnapshot,
    component: { snapshotId: context.component.snapshotId, revisionId: context.component.componentRevisionId, dependencyDigest: context.component.dependencyDigest },
    assemblyProfile: { id: context.assemblyProfile.assemblyProfileId, revisionId: context.assemblyProfile.revisionId, dependencyDigest: context.assemblyProfile.dependencyDigest },
    profile: profile ? { id: profile.profileId, revision: profile.revision, revisionId: profile.revisionId, profileDigest: profile.profileDigest, packageRevisionId: profile.exactPackageIdentity.packageRevisionId, footprintAssetVersionId: profile.exactFootprintAssetIdentity.assetVersionId, footprintContentDigest: profile.exactFootprintAssetIdentity.contentDigest, mappingRevisionId: profile.stage4MappingProfileRef.mappingRevisionId, mappingContentDigest: profile.stage4MappingProfileRef.mappingContentDigest, mappingResultDigest: profile.stage4MappingProfileRef.verificationResultDigest } : null,
    exception: completeException ?? null,
    result: result ? { resultDigest: result.resultDigest, appliedException } : null,
  });
  return [...new Set([
    authorityDigest,
    context.dependencySnapshot.dependencyDigest,
    context.component.dependencyDigest,
    context.component.componentRevisionId,
    context.assemblyProfile.revisionId,
    context.assemblyProfile.dependencyDigest,
    policy?.revisionId,
    policy?.technicalDigest,
    profile?.revisionId,
    profile?.profileDigest,
    profile?.exactPackageIdentity.packageRevisionId,
    profile?.exactFootprintAssetIdentity.assetVersionId,
    profile?.exactFootprintAssetIdentity.contentDigest,
    profile?.stage4MappingProfileRef.mappingRevisionId,
    profile?.stage4MappingProfileRef.mappingContentDigest,
    profile?.stage4MappingProfileRef.verificationResultDigest,
    appliedException?.decisionId,
    appliedException?.approvalDigest,
    appliedException?.mutationDigest,
    result?.resultDigest,
  ].filter((value): value is string => Boolean(value)))].sort();
}

function policyBinding(context: PassivePolicyContext, result: PassivePolicyEvaluationResult, authorityDependencies: string[]): ComponentPhysicalBinding {
  const policy = context.policy;
  const profile = result.selectedProfile;
  if (!policy || !profile || !ELIGIBLE.has(result.status)) throw new Error("PP_STAGE2_RESULT_NOT_ELIGIBLE");
  const component = context.component;
  const actor = policy.policyOwner;
  const authorityAt = policy.publishedAt ?? policy.createdAt;
  const exceptionEvidence = result.appliedException?.evidenceRefs ?? [];
  const evidenceRefs = [...new Set([...component.evidenceRefs, ...policy.evidenceRefs, ...profile.sourceEvidenceRefs, ...exceptionEvidence, ...(result.appliedException ? [result.appliedException.decisionId, result.appliedException.approvalDigest, result.appliedException.mutationDigest] : []), result.resultDigest])].sort();
  const decisionEvidenceRefs = [...new Set([...policy.evidenceRefs, ...profile.sourceEvidenceRefs, ...exceptionEvidence, result.resultDigest])].sort();
  const identity = { policyRevisionId: policy.revisionId, componentRevisionId: component.componentRevisionId, profileRevisionId: profile.revisionId, resultDigest: result.resultDigest, authorityDependencyDigest: authorityDependencies[0] };
  const bindingId = physicalBindingId("passive-policy-binding", identity);
  const revisionId = physicalBindingId("passive-policy-binding-revision", identity);
  const base: Omit<ComponentPhysicalBinding, "technicalDigest" | "recordDigest"> = {
    schemaVersion: PHYSICAL_BINDING_SCHEMA_VERSION,
    bindingId,
    revisionId,
    lineageId: physicalBindingId("passive-policy-binding-lineage", { component: component.scope.componentInstanceId, policy: policy.policyId }),
    revision: policy.revision,
    scope: {
      tenantId: component.scope.tenantId,
      projectId: component.scope.projectId,
      branchId: component.scope.branchId,
      boardInstanceId: component.scope.boardInstanceId,
      componentInstanceId: component.scope.componentInstanceId,
      hierarchyPath: [...component.scope.hierarchyPath],
      assemblyVariantIds: [component.scope.assemblyVariantId],
    },
    componentIdentity: structuredClone(component.stableIdentity),
    classification: {
      populationKind: "physical",
      deviceClass: String(component.passiveClass.value),
      mountingTechnology: profile.mountingTechnology,
      polarity: component.polarity.value === "polarized" ? "polarized" : component.polarity.value === "nonpolar" ? "nonpolar" : "unknown",
      classificationEvidenceRefs: [...new Set([...component.passiveClass.evidenceRefs, ...component.polarity.evidenceRefs])].sort(),
    },
    package: structuredClone(profile.exactPackageIdentity),
    footprint: structuredClone(profile.exactFootprintAssetIdentity),
    pinPadMapping: structuredClone(profile.stage4MappingProfileRef),
    origin: {
      kind: "project_passive_policy",
      actor: structuredClone(actor),
      sourceRef: result.appliedException?.decisionId ?? policy.revisionId,
      createdAt: authorityAt,
      evidenceRefs,
      ruleVersion: `${policy.ruleLanguageVersion}:${policy.revisionId}:${result.appliedException?.decisionRevision ?? "policy"}`,
    },
    evidenceRefs,
    lifecycleState: "selected",
    applicabilityState: "applicable",
    approval: { state: "unreviewed" },
    technicalValidation: { state: "pending", evidenceRefs: [], reasonCodes: ["PP_STAGE2_VALIDATION_PENDING"] },
    freshness: { state: "current", evaluatedAt: authorityAt, reasonCodes: [], staleDependencyIds: [] },
    conflict: { state: "none", conflictIds: [], reasonCodes: [] },
    dependencies: {
      symbolAssetVersionId: profile.stage4MappingProfileRef.symbolAssetVersionId,
      packageRevisionId: profile.exactPackageIdentity.packageRevisionId,
      footprintAssetVersionId: profile.exactFootprintAssetIdentity.assetVersionId,
      footprintContentDigest: profile.exactFootprintAssetIdentity.contentDigest,
      mappingCertificateId: profile.stage4MappingProfileRef.mappingCertificateId,
      mappingVerifierVersion: profile.stage4MappingProfileRef.verifierVersion,
      approvalPolicyVersion: policy.revisionId,
      variantDefinitionDigest: component.dependencyDigest,
      packagePolicyRevision: policy.revisionId,
      exactPartFootprintCompatibility: "pending",
      manufacturingEvidenceRefs: [],
      supplyEvidenceRefs: [],
      externalValidationRefs: [...new Set([result.resultDigest, context.dependencySnapshot.dependencyDigest, ...authorityDependencies.filter((item) => item.startsWith("pb1-"))])].sort(),
    },
    createdAt: authorityAt,
    createdBy: structuredClone(actor),
  };
  const preliminary = withBindingDigests(base);
  const binding = withBindingDigests({
    ...base,
    approval: { state: "approved", contentDigest: preliminary.technicalDigest, approvalScope: "layout", decisionId: passivePolicyId("passive-policy-layout-approval", identity), decidedBy: structuredClone(actor), decidedAt: authorityAt, reason: "Published project passive package policy", policyVersion: policy.revisionId, decisionEvidenceRefs },
    technicalValidation: { state: "valid", validatorVersion: PASSIVE_POLICY_EVALUATOR_VERSION, validatedDigest: preliminary.technicalDigest, validatedAt: authorityAt, evidenceRefs: [result.resultDigest], reasonCodes: [] },
  });
  if (binding.technicalDigest !== preliminary.technicalDigest) throw new Error("PP_STAGE2_BINDING_DIGEST_UNSTABLE");
  return binding;
}

export class PassivePolicyCandidateSource implements FootprintCandidateSource {
  readonly sourceKind = "passive_policy" as const;
  readonly sourceVersion = "sirkit.passive-policy-stage2-adapter/1.1.0";
  constructor(private readonly contexts: PassivePolicyContextProvider, private readonly evaluator = new DeterministicPassivePolicyEvaluator()) {}

  async collect(context: CandidateCollectionContext, signal: AbortSignal): Promise<CandidateSourceResult> {
    const started = performance.now();
    const finish = (partial: Omit<CandidateSourceResult, "sourceKind" | "sourceVersion" | "durationMs">): CandidateSourceResult => ({ sourceKind: this.sourceKind, sourceVersion: this.sourceVersion, durationMs: Number((performance.now() - started).toFixed(3)), ...partial });
    if (signal.aborted) return finish({ status: "cancelled", candidates: [], diagnostics: [{ code: "PP_STAGE2_CANCELLED", severity: "warning", message: "Passive policy evaluation was cancelled." }], dependencyDigests: [] });
    if (context.bindingSets.some((set) => Boolean(set.effectiveSelectedRevisionId))) return finish({ status: "empty", candidates: [], diagnostics: [{ code: "PP_STAGE1_SELECTION_PRECEDENCE", severity: "info", message: "An effective Stage 1 selection takes precedence over the passive policy." }], dependencyDigests: [] });
    const request = {
      requestSchemaVersion: PASSIVE_EVALUATION_REQUEST_VERSION,
      requestId: passivePolicyId("passive-policy-stage2-request", { requestId: context.request.requestId, component: context.request.componentId }),
      tenantId: context.request.tenantId,
      projectId: context.request.projectId,
      branchId: context.request.branchId,
      componentInstanceId: context.request.componentId,
      assemblyVariantId: context.request.assemblyVariantId,
      purpose: "stage2_resolution" as const,
      actorContext: structuredClone(context.request.actorContext),
      requestedAt: context.request.requestedAt,
    };
    let passiveContext: PassivePolicyContext;
    try {
      passiveContext = await this.contexts.getContext(request, signal);
    } catch {
      if (signal.aborted) return finish({ status: "cancelled", candidates: [], diagnostics: [{ code: "PP_STAGE2_CANCELLED", severity: "warning", message: "Passive policy evaluation was cancelled." }], dependencyDigests: [] });
      return finish({ status: "unavailable", candidates: [], diagnostics: [{ code: "PP_STAGE2_AUTHORITY_UNAVAILABLE", severity: "error", message: "The durable passive-policy authority required for this component is unavailable." }], dependencyDigests: [] });
    }
    if (passiveContext.component.scope.boardInstanceId !== context.request.boardInstanceId || passiveContext.component.stableIdentity.componentInstanceId !== context.componentIdentity.componentInstanceId) throw new Error("PP_STAGE2_TRUSTED_CONTEXT_MISMATCH");
    const policyScope = inspectAssemblyVariantScope(passiveContext.policy?.assemblyVariantIds, context.request.assemblyVariantId);
    if (!policyScope.applies) return finish({ status: "empty", candidates: [], diagnostics: [{ code: policyScope.kind === "invalid" ? "PP_STAGE2_POLICY_VARIANT_SCOPE_INVALID" : "PP_STAGE2_POLICY_VARIANT_INAPPLICABLE", severity: policyScope.kind === "invalid" ? "error" : "info", message: "The passive policy does not apply to the requested assembly variant." }], dependencyDigests: passiveAuthorityDependencies(passiveContext) });
    const result = this.evaluator.evaluate(passiveContext);
    const authorityDependencies = passiveAuthorityDependencies(passiveContext, result);
    if (!ELIGIBLE.has(result.status) || !result.selectedProfile) return finish({ status: "empty", candidates: [], diagnostics: [{ code: `PP_STAGE2_${result.status.toUpperCase()}`, severity: result.blockers.length ? "error" : "info", message: "Passive policy produced no eligible layout package candidate." }], dependencyDigests: authorityDependencies });
    const binding = policyBinding(passiveContext, result, authorityDependencies);
    const candidate: RawFootprintCandidate = { schemaVersion: "sirkit.raw-footprint-candidate.v1", rawCandidateId: resolverId("raw-footprint-candidate", { sourceKind: this.sourceKind, binding: binding.recordDigest }), sourceKind: this.sourceKind, sourceVersion: this.sourceVersion, binding };
    return finish({ status: "success", candidates: [candidate], diagnostics: [{ code: result.appliedException ? "PP_STAGE2_EXCEPTION_LAYOUT_CANDIDATE_QUALIFIED" : "PP_STAGE2_LAYOUT_CANDIDATE_QUALIFIED", severity: "info", message: result.appliedException ? "A revision-complete component exception qualified a layout-only footprint candidate." : "Published passive policy qualified a layout-only footprint candidate." }], dependencyDigests: [...new Set([...authorityDependencies, binding.recordDigest])].sort() });
  }
}
