import type { CandidateDisposition, FootprintResolutionRequest, FootprintResolutionResult, SourceAuthorityClass } from "../footprint-resolver/types";
import type { MappingVerificationResult } from "../mapping-verification/types";
import type { PassivePolicyEvaluationResult } from "../passive-policy/types";
import type { ComponentTransferAssessment, PcbSyncPreflightRequest } from "../pcb-sync/types";
import type { ComponentPhysicalBinding, ComponentPhysicalBindingSet, PhysicalReadinessGateResult } from "../physical-binding/types";
import { assignmentDigest, assignmentId, sourceBundleTechnicalPayload } from "./stable";
import { ASSIGNMENT_SOURCE_VERSION, type AssignmentCandidateReference, type AssignmentOwnerReferences, type AssignmentSourceBundle } from "./types";

export function assignmentCandidateFromBinding(input: { binding: ComponentPhysicalBinding; set: ComponentPhysicalBindingSet; disposition?: CandidateDisposition; sourceKinds?: string[] }): AssignmentCandidateReference {
  const binding = input.binding, disposition = input.disposition;
  const rejected = ["rejected", "revoked"].includes(binding.approval.state) || ["superseded", "withdrawn", "orphaned", "obsolete"].includes(binding.lifecycleState), mappingAccepted = binding.pinPadMapping.state === "verified" && binding.pinPadMapping.mappingApprovalState === "approved" && binding.pinPadMapping.mappingFreshnessState === "current", technicallyReady = binding.technicalValidation.state === "valid" && binding.technicalValidation.validatedDigest === binding.technicalDigest;
  return {
    candidateId: disposition?.candidateId ?? binding.revisionId,
    candidateDigest: disposition ? assignmentDigest({ disposition: disposition.candidateId, binding: binding.technicalDigest }) : binding.technicalDigest,
    origin: [...new Set([binding.origin.kind, ...(input.sourceKinds ?? [])])].sort(),
    authorityClass: disposition?.authorityClass ?? (binding.lifecycleState === "selected" ? "selected_stage1" : "suggestion_only") as SourceAuthorityClass,
    authorityRank: disposition?.authorityRank ?? (binding.lifecycleState === "selected" ? 1 : 99),
    ...(binding.exactPart ? { exactPart: { exactPartId: binding.exactPart.exactPartId, manufacturerId: binding.exactPart.manufacturerId, exactMpn: binding.exactPart.exactPublishedMpn, supplierSkus: binding.exactPart.supplierParts.map((item) => item.supplierSku).sort() } } : {}),
    ...(binding.package ? { package: { packageIdentityId: binding.package.packageIdentityId, packageRevisionId: binding.package.packageRevisionId, canonicalName: binding.package.canonicalName, mountingTechnology: binding.package.mountingTechnology, ...(binding.package.pinCount !== undefined ? { pinCount: binding.package.pinCount } : {}), ...(binding.package.pitchNm !== undefined ? { pitchNm: binding.package.pitchNm } : {}), ...(binding.package.bodyWidthNm !== undefined ? { bodyWidthNm: binding.package.bodyWidthNm } : {}), ...(binding.package.bodyLengthNm !== undefined ? { bodyLengthNm: binding.package.bodyLengthNm } : {}), exposedPad: binding.package.exposedPad } } : {}),
    ...(binding.footprint ? { footprint: { logicalAssetId: binding.footprint.logicalAssetId, assetVersionId: binding.footprint.assetVersionId, ...(binding.footprint.contentDigest ? { contentDigest: binding.footprint.contentDigest } : {}), libraryNickname: binding.footprint.libraryNickname, footprintName: binding.footprint.footprintName, availability: binding.footprint.availability, validationState: binding.footprint.validationState } } : {}),
    mapping: { state: binding.pinPadMapping.state, ...(binding.pinPadMapping.verificationTier ? { tier: binding.pinPadMapping.verificationTier } : {}), ...(binding.pinPadMapping.mappingRevisionId ? { revisionId: binding.pinPadMapping.mappingRevisionId } : {}), ...(binding.pinPadMapping.mappingContentDigest ? { contentDigest: binding.pinPadMapping.mappingContentDigest } : {}) },
    approvalState: binding.approval.state,
    technicalState: binding.technicalValidation.state,
    freshnessState: binding.freshness.state,
    lifecycleState: binding.lifecycleState,
    conflictState: binding.conflict.state,
    applicabilityState: binding.applicabilityState,
    evidenceRefs: [...new Set(binding.evidenceRefs)].sort(),
    missingFacts: [!binding.exactPart ? "exact_part" : "", !binding.package ? "package" : "", !binding.footprint ? "footprint" : "", !mappingAccepted ? "mapping" : ""].filter(Boolean),
    disqualificationReasons: [...new Set([...(disposition?.reasonCodes ?? []), ...binding.freshness.reasonCodes, ...binding.conflict.reasonCodes])].sort(),
    selectable: !rejected && binding.applicabilityState === "applicable" && Boolean(binding.package && binding.footprint) && mappingAccepted && technicallyReady && binding.freshness.state === "current" && binding.conflict.state === "none",
    approvalReady: !rejected && mappingAccepted && technicallyReady && binding.freshness.state === "current" && binding.conflict.state === "none",
    suggestionOnly: disposition?.authorityClass === "suggestion_only" || binding.origin.kind === "ai_suggestion",
    stage1: { setId: input.set.setId, bindingRevisionId: binding.revisionId, expectedSetRevision: input.set.revision },
  };
}

export function buildAssignmentSourceBundle(input: {
  tenantId: string; projectId: string; branchId: string; designId: string; componentId: string; componentRevision: string; referenceDesignator: string; displayName: string; assemblyVariantId: string;
  stage1Gates?: PhysicalReadinessGateResult[]; resolution?: FootprintResolutionResult; pcbComponent?: ComponentTransferAssessment; mapping?: MappingVerificationResult; passivePolicy?: PassivePolicyEvaluationResult; candidates?: AssignmentCandidateReference[]; ownerReferences?: AssignmentOwnerReferences; resolutionRequest?: FootprintResolutionRequest; pcbPreflightRequest?: PcbSyncPreflightRequest; capturedAt: string;
}): AssignmentSourceBundle {
  const draft = { sourceSchemaVersion: ASSIGNMENT_SOURCE_VERSION, sourceBundleId: "", sourceBundleDigest: "", tenantId: input.tenantId, projectId: input.projectId, branchId: input.branchId, designId: input.designId, componentId: input.componentId, componentRevision: input.componentRevision, referenceDesignator: input.referenceDesignator, displayName: input.displayName, assemblyVariantId: input.assemblyVariantId, stage1Gates: structuredClone(input.stage1Gates ?? []), ...(input.resolution ? { resolution: structuredClone(input.resolution) } : {}), ...(input.pcbComponent ? { pcbComponent: structuredClone(input.pcbComponent) } : {}), ...(input.mapping ? { mapping: structuredClone(input.mapping) } : {}), ...(input.passivePolicy ? { passivePolicy: structuredClone(input.passivePolicy) } : {}), candidates: structuredClone(input.candidates ?? []), ownerReferences: structuredClone(input.ownerReferences ?? {}), ...(input.resolutionRequest ? { resolutionRequest: structuredClone(input.resolutionRequest) } : {}), ...(input.pcbPreflightRequest ? { pcbPreflightRequest: structuredClone(input.pcbPreflightRequest) } : {}), capturedAt: input.capturedAt } satisfies AssignmentSourceBundle;
  const sourceBundleDigest = assignmentDigest(sourceBundleTechnicalPayload(draft)); return { ...draft, sourceBundleDigest, sourceBundleId: assignmentId("assignment-source", sourceBundleDigest) };
}
