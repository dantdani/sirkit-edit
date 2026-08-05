import { candidateTechnicalPayload, resolverDigest, resolverId } from "./stable";
import type { CandidateOriginRecord, CandidateSourceResult, FootprintResolutionPolicy, NormalizedFootprintCandidate, RawFootprintCandidate } from "./types";

function dependencyDigests(raw: RawFootprintCandidate): string[] {
  const binding = raw.binding;
  return [...new Set([
    binding.technicalDigest,
    binding.dependencies.variantDefinitionDigest,
    binding.dependencies.symbolAssetVersionId,
    binding.dependencies.packageRevisionId,
    binding.dependencies.footprintAssetVersionId,
    binding.dependencies.footprintContentDigest,
    binding.dependencies.mappingCertificateId,
    binding.dependencies.mappingVerifierVersion,
    binding.dependencies.exactPartEvidenceDigest,
    binding.dependencies.approvalPolicyVersion,
    binding.dependencies.packagePolicyRevision,
    ...binding.dependencies.externalValidationRefs,
  ].filter((value): value is string => Boolean(value)))].sort();
}

function origin(raw: RawFootprintCandidate, policy: FootprintResolutionPolicy): CandidateOriginRecord {
  const binding = raw.binding;
  return {
    sourceKind: raw.sourceKind,
    sourceVersion: raw.sourceVersion,
    sourceAuthorityClass: policy.sourceAuthority[raw.sourceKind],
    bindingRevisionId: binding.revisionId,
    originKind: binding.origin.kind,
    sourceRef: binding.origin.sourceRef,
    evidenceRefs: [...new Set([...binding.origin.evidenceRefs, ...binding.evidenceRefs])].sort(),
    ...(binding.origin.confidence !== undefined ? { confidence: binding.origin.confidence } : {}),
  };
}

function fromRaw(raw: RawFootprintCandidate, policy: FootprintResolutionPolicy): NormalizedFootprintCandidate {
  const binding = raw.binding;
  const base: Omit<NormalizedFootprintCandidate, "candidateId" | "technicalIdentityDigest"> = {
    schemaVersion: "sirkit.normalized-footprint-candidate.v1",
    componentId: binding.scope.componentInstanceId,
    assemblyVariantScope: [...binding.scope.assemblyVariantIds].sort(),
    ...(binding.exactPart ? { exactPartIdentity: structuredClone(binding.exactPart) } : {}),
    ...(binding.package ? { packageIdentity: structuredClone(binding.package) } : {}),
    ...(binding.footprint ? { footprintAssetIdentity: structuredClone(binding.footprint) } : {}),
    pinPadMappingRef: structuredClone(binding.pinPadMapping),
    originRecords: [origin(raw, policy)],
    evidenceRefs: [...new Set(binding.evidenceRefs)].sort(),
    contributingBindings: [structuredClone(binding)],
    dependencyDigests: dependencyDigests(raw),
  };
  const technicalIdentityDigest = resolverDigest(candidateTechnicalPayload(base));
  return { ...base, candidateId: resolverId("footprint-candidate", technicalIdentityDigest), technicalIdentityDigest };
}

function mergeEquivalent(candidates: NormalizedFootprintCandidate[]): NormalizedFootprintCandidate {
  const ordered = [...candidates].sort((a, b) => a.candidateId.localeCompare(b.candidateId) || a.originRecords[0]!.bindingRevisionId.localeCompare(b.originRecords[0]!.bindingRevisionId));
  const first = ordered[0]!;
  const originRecords = ordered.flatMap((candidate) => candidate.originRecords).sort((a, b) => a.sourceKind.localeCompare(b.sourceKind) || a.bindingRevisionId.localeCompare(b.bindingRevisionId));
  const bindings = ordered.flatMap((candidate) => candidate.contributingBindings).sort((a, b) => a.revisionId.localeCompare(b.revisionId));
  return {
    ...first,
    originRecords: [...new Map(originRecords.map((record) => [`${record.sourceKind}\0${record.bindingRevisionId}`, record])).values()],
    evidenceRefs: [...new Set(ordered.flatMap((candidate) => candidate.evidenceRefs))].sort(),
    contributingBindings: [...new Map(bindings.map((binding) => [binding.revisionId, binding])).values()],
    dependencyDigests: [...new Set(ordered.flatMap((candidate) => candidate.dependencyDigests))].sort(),
  };
}

export interface NormalizationResult {
  candidates: NormalizedFootprintCandidate[];
  groups: Array<{ technicalIdentityDigest: string; rawCandidateIds: string[]; candidateId: string }>;
}

export function normalizeAndDeduplicateCandidates(sourceResults: readonly CandidateSourceResult[], policy: FootprintResolutionPolicy): NormalizationResult {
  const raw = sourceResults.flatMap((source) => source.candidates).sort((a, b) => a.rawCandidateId.localeCompare(b.rawCandidateId));
  const groups = new Map<string, Array<{ raw: RawFootprintCandidate; normalized: NormalizedFootprintCandidate }>>();
  for (const item of raw) {
    const normalized = fromRaw(item, policy);
    const bucket = groups.get(normalized.technicalIdentityDigest) ?? [];
    bucket.push({ raw: item, normalized });
    groups.set(normalized.technicalIdentityDigest, bucket);
  }
  const candidates: NormalizedFootprintCandidate[] = [];
  const report: NormalizationResult["groups"] = [];
  for (const [technicalIdentityDigest, entries] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const candidate = mergeEquivalent(entries.map((entry) => entry.normalized));
    candidates.push(candidate);
    report.push({ technicalIdentityDigest, rawCandidateIds: entries.map((entry) => entry.raw.rawCandidateId).sort(), candidateId: candidate.candidateId });
  }
  return { candidates: candidates.sort((a, b) => a.candidateId.localeCompare(b.candidateId)), groups: report };
}
