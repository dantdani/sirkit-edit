import { physicalBindingDigest, physicalBindingId } from "../physical-binding/stable";
import type { FootprintResolutionResult, ImmutableResolutionContext, NormalizedFootprintCandidate } from "./types";

export const resolverDigest = physicalBindingDigest;
export const resolverId = physicalBindingId;

export function candidateTechnicalPayload(candidate: Pick<NormalizedFootprintCandidate, "componentId" | "assemblyVariantScope" | "exactPartIdentity" | "packageIdentity" | "footprintAssetIdentity" | "pinPadMappingRef" | "dependencyDigests">): unknown {
  const exactPart = candidate.exactPartIdentity;
  const packageIdentity = candidate.packageIdentity;
  const footprint = candidate.footprintAssetIdentity;
  const mapping = candidate.pinPadMappingRef;
  return {
    componentId: candidate.componentId,
    assemblyVariantScope: [...candidate.assemblyVariantScope].sort(),
    exactPartIdentity: exactPart ? { atomicPartRevisionId: exactPart.atomicPartRevisionId, exactPartId: exactPart.exactPartId, manufacturerId: exactPart.manufacturerId, exactPublishedMpn: exactPart.exactPublishedMpn } : undefined,
    packageIdentity: packageIdentity ? { packageIdentityId: packageIdentity.packageIdentityId, packageRevisionId: packageIdentity.packageRevisionId, exactPartId: packageIdentity.exactPartId } : undefined,
    footprintAssetIdentity: footprint ? { logicalAssetId: footprint.logicalAssetId, assetVersionId: footprint.assetVersionId, contentDigest: footprint.contentDigest, semanticDigest: footprint.semanticDigest } : undefined,
    pinPadMappingRef: { state: mapping.state, mappingCertificateId: mapping.mappingCertificateId, symbolAssetVersionId: mapping.symbolAssetVersionId, footprintAssetVersionId: mapping.footprintAssetVersionId, footprintContentDigest: mapping.footprintContentDigest, verifierVersion: mapping.verifierVersion, verificationTier: mapping.verificationTier, mappingRevisionId: mapping.mappingRevisionId, mappingContentDigest: mapping.mappingContentDigest, mappingDependencyDigest: mapping.mappingDependencyDigest, verificationResultDigest: mapping.verificationResultDigest, mappingApprovalState: mapping.mappingApprovalState, mappingFreshnessState: mapping.mappingFreshnessState, mappingConflictState: mapping.mappingConflictState, mappingLifecycleState: mapping.mappingLifecycleState, approvalDecisionId: mapping.approvalDecisionId },
  };
}

export function resolutionDecisionPayload(result: Omit<FootprintResolutionResult, "decisionDigest">): unknown {
  return {
    status: result.status,
    resolvedBinding: result.resolvedBinding,
    suggestedCandidates: result.suggestedCandidates,
    consideredCandidates: result.consideredCandidates.map((item) => ({ candidateId: item.candidateId, primary: item.primary, authorityClass: item.authorityClass, authorityRank: item.authorityRank, eligible: item.eligible, blocking: item.blocking, reasonCodes: item.reasonCodes })),
    blockers: result.blockers,
    warnings: result.warnings,
    conflicts: result.conflicts,
    technicalTraceDigest: result.trace.technicalTraceDigest,
    inputSnapshot: result.inputSnapshot,
    policyId: result.policyId,
    policyVersion: result.policyVersion,
    resolverVersion: result.resolverVersion,
    normalizationVersion: result.normalizationVersion,
    compatibilityValidatorVersion: result.compatibilityValidatorVersion,
    cache: result.cache,
  };
}

export function contextTechnicalDigest(context: ImmutableResolutionContext): string {
  return resolverDigest({
    schemaVersion: context.schemaVersion,
    request: { ...context.request, requestId: undefined, requestedAt: undefined, actorContext: undefined, traceLevel: undefined },
    componentIdentity: context.componentIdentity,
    componentRevisionDigest: context.componentRevisionDigest,
    variantRevisionDigest: context.variantRevisionDigest,
    bindingSets: context.bindingSets.map((set) => set.recordDigest).sort(),
    sourceResults: context.sourceResults.map((source) => ({ sourceKind: source.sourceKind, sourceVersion: source.sourceVersion, status: source.status, candidates: source.candidates.map((candidate) => candidate.binding.recordDigest).sort(), dependencyDigests: source.dependencyDigests })).sort((a, b) => a.sourceKind.localeCompare(b.sourceKind)),
    policy: context.policy,
    libraryAvailability: context.libraryAvailability,
    dependencyDigests: context.dependencyDigests,
  });
}
