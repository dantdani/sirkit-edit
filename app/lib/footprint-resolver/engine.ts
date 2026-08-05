import { evaluatePhysicalReadiness } from "../physical-binding/readiness";
import type { ComponentPhysicalBinding, PhysicalReadinessAssessment } from "../physical-binding/types";
import { authorityRank, STAGE5_PASSIVE_FOOTPRINT_POLICY_VERSION } from "./policy";
import { normalizeAndDeduplicateCandidates } from "./normalize";
import { contextTechnicalDigest, resolutionDecisionPayload, resolverDigest, resolverId } from "./stable";
import {
  FOOTPRINT_COMPATIBILITY_VALIDATOR_VERSION,
  FOOTPRINT_RESOLVER_NORMALIZATION_VERSION,
  FOOTPRINT_RESOLUTION_RESULT_VERSION,
  FOOTPRINT_RESOLUTION_TRACE_VERSION,
  FOOTPRINT_RESOLVER_VERSION,
  type CandidateDisposition,
  type CandidateDispositionKind,
  type FootprintResolutionResult,
  type FootprintResolutionStatus,
  type ImmutableResolutionContext,
  type NormalizedFootprintCandidate,
  type ResolutionConflict,
  type ResolutionIssue,
  type ResolutionTraceStep,
  type SourceAuthorityClass,
  type SuggestedCandidateView,
} from "./types";
import { resolutionIssue, validateResolutionContext } from "./validation";

interface BindingAssessment {
  binding: ComponentPhysicalBinding;
  assessment: PhysicalReadinessAssessment;
  issues: ResolutionIssue[];
  sourceAuthorityClass: SourceAuthorityClass;
  sourceKind: NormalizedFootprintCandidate["originRecords"][number]["sourceKind"];
  authorityRank: number;
  eligible: boolean;
}

interface AssessedCandidate {
  candidate: NormalizedFootprintCandidate;
  bindings: BindingAssessment[];
  best: BindingAssessment;
  disposition: CandidateDisposition;
}

function issue(binding: ComponentPhysicalBinding, candidateId: string, code: string, message: string, category: ResolutionIssue["remediationCategory"], field: string, causedBy: string[] = []): ResolutionIssue {
  return resolutionIssue({ code, componentId: binding.scope.componentInstanceId, candidateId, message, category, fields: [field], dependencies: [binding.recordDigest], causedBy });
}

function isQualifiedPassivePolicyBinding(context: ImmutableResolutionContext, sourceKind: BindingAssessment["sourceKind"], binding: ComponentPhysicalBinding): boolean {
  return sourceKind === "passive_policy" && binding.origin.kind === "project_passive_policy" && context.policy.version === STAGE5_PASSIVE_FOOTPRINT_POLICY_VERSION && context.policy.enabledSources.includes("passive_policy");
}

function bindingIssues(context: ImmutableResolutionContext, candidate: NormalizedFootprintCandidate, binding: ComponentPhysicalBinding, assessment: PhysicalReadinessAssessment, sourceKind: BindingAssessment["sourceKind"]): ResolutionIssue[] {
  const issues: ResolutionIssue[] = [];
  const id = candidate.candidateId;
  const variantApplies = binding.scope.assemblyVariantIds.length === 0 || binding.scope.assemblyVariantIds.includes(context.request.assemblyVariantId);
  if (!variantApplies) issues.push(issue(binding, id, "FR_VARIANT_INAPPLICABLE", "Candidate does not apply to the requested assembly variant.", "variant", "scope.assemblyVariantIds"));
  if (binding.applicabilityState === "unknown") issues.push(issue(binding, id, "FR_APPLICABILITY_UNKNOWN", "Physical applicability is unknown for the requested variant.", "variant", "applicabilityState"));
  if (binding.applicabilityState === "not_applicable") issues.push(issue(binding, id, "FR_COMPONENT_NOT_APPLICABLE", "Component is explicitly not fitted in this variant.", "variant", "applicabilityState"));
  if (binding.lifecycleState === "superseded") issues.push(issue(binding, id, "FR_LIFECYCLE_SUPERSEDED", "Binding is superseded.", "lifecycle", "lifecycleState"));
  else if (binding.lifecycleState === "obsolete" || binding.lifecycleState === "orphaned" || binding.lifecycleState === "withdrawn") issues.push(issue(binding, id, "FR_LIFECYCLE_INVALID", `Binding lifecycle ${binding.lifecycleState} is not active.`, "lifecycle", "lifecycleState"));
  if (!context.effectiveSelectedRevisionIds.includes(binding.revisionId) && !isQualifiedPassivePolicyBinding(context, sourceKind, binding)) issues.push(issue(binding, id, "FR_EFFECTIVE_SELECTION_REQUIRED", "Candidate is not the effective selected Stage 1 binding.", "user_decision", "lifecycleState"));
  if (binding.approval.state === "revoked") issues.push(issue(binding, id, "FR_APPROVAL_REVOKED", "Binding approval was revoked.", "approval", "approval.state"));
  else if (binding.approval.state === "rejected") issues.push(issue(binding, id, "FR_APPROVAL_REJECTED", "Binding approval was rejected.", "approval", "approval.state"));
  else if (binding.approval.state === "expired" || (binding.approval.expiresAt && Date.parse(binding.approval.expiresAt) <= Date.parse(context.request.requestedAt))) issues.push(issue(binding, id, "FR_APPROVAL_EXPIRED", "Binding approval has expired.", "approval", "approval.expiresAt"));
  else if (binding.approval.state !== "approved" || binding.approval.contentDigest !== binding.technicalDigest) issues.push(issue(binding, id, "FR_APPROVAL_REQUIRED", "Current digest-scoped approval is required.", "approval", "approval"));
  if (binding.technicalValidation.state === "invalid") issues.push(issue(binding, id, "FR_TECHNICAL_VALIDATION_FAILED", "Technical validation failed.", "validation", "technicalValidation"));
  else if (binding.technicalValidation.state === "unsupported") issues.push(issue(binding, id, "FR_TECHNICAL_VALIDATION_UNSUPPORTED", "Technical validation is unsupported.", "validation", "technicalValidation"));
  else if (binding.technicalValidation.state !== "valid" || binding.technicalValidation.validatedDigest !== binding.technicalDigest) issues.push(issue(binding, id, "FR_TECHNICAL_VALIDATION_PENDING", "Current digest-scoped technical validation is required.", "validation", "technicalValidation"));
  if (binding.freshness.state !== "current") issues.push(issue(binding, id, binding.freshness.state === "stale" ? "FR_DEPENDENCY_STALE" : binding.freshness.state === "missing_source" ? "FR_SOURCE_MISSING" : "FR_FRESHNESS_UNKNOWN", `Binding freshness is ${binding.freshness.state}.`, "freshness", "freshness"));
  if (binding.conflict.state === "present") issues.push(issue(binding, id, "FR_BINDING_CONFLICT", "Stage 1 binding has unresolved conflicts.", "conflict", "conflict"));
  if (!binding.package) {
    const ambiguousLegacyPackage = binding.legacySource?.diagnostics.includes("PB_LEGACY_PACKAGE_AMBIGUOUS") === true;
    issues.push(issue(binding, id, ambiguousLegacyPackage ? "FR_PACKAGE_AMBIGUOUS" : "FR_PACKAGE_MISSING", ambiguousLegacyPackage ? "Legacy package token is ambiguous until metric/imperial semantics are explicit." : "An explicit normalized package identity is required.", "package", "package"));
  }
  else if (binding.footprint?.packageCompatibility === "ambiguous") issues.push(issue(binding, id, "FR_PACKAGE_AMBIGUOUS", "Package identity or package-to-footprint relationship is ambiguous.", "package", "footprint.packageCompatibility"));
  else if (binding.footprint?.packageCompatibility === "incompatible") issues.push(issue(binding, id, "FR_PACKAGE_INCOMPATIBLE", "Package and footprint are explicitly incompatible.", "package", "footprint.packageCompatibility"));
  else if (binding.footprint?.packageCompatibility !== "compatible") issues.push(issue(binding, id, "FR_PACKAGE_COMPATIBILITY_UNKNOWN", "Approved package-to-footprint compatibility is unavailable.", "package", "footprint.packageCompatibility"));
  if (!binding.footprint) issues.push(issue(binding, id, "FR_FOOTPRINT_ASSET_MISSING", "Exact immutable footprint asset is missing.", "asset", "footprint"));
  else if (!binding.footprint.contentDigest) issues.push(issue(binding, id, "FR_FOOTPRINT_DIGEST_MISSING", "Footprint content digest is missing.", "asset", "footprint.contentDigest"));
  else if (binding.footprint.availability !== "available") issues.push(issue(binding, id, binding.footprint.availability === "unsupported" ? "FR_FOOTPRINT_ASSET_UNSUPPORTED" : "FR_FOOTPRINT_ASSET_UNAVAILABLE", `Footprint asset is ${binding.footprint.availability}.`, "asset", "footprint.availability"));
  const mapping = binding.pinPadMapping;
  if (mapping.state === "missing") issues.push(issue(binding, id, "FR_MAPPING_MISSING", "Pin-to-pad mapping is missing.", "mapping", "pinPadMapping"));
  else if (mapping.state === "stale") issues.push(issue(binding, id, "FR_MAPPING_STALE", "Pin-to-pad mapping is stale.", "mapping", "pinPadMapping"));
  else if (mapping.state === "failed") issues.push(issue(binding, id, "FR_MAPPING_FAILED", "Pin-to-pad mapping failed verification.", "mapping", "pinPadMapping"));
  else if (mapping.state === "unsupported") issues.push(issue(binding, id, "FR_MAPPING_UNSUPPORTED", "Pin-to-pad mapping is unsupported.", "mapping", "pinPadMapping"));
  else if (mapping.state !== "verified" || mapping.footprintAssetVersionId !== binding.footprint?.assetVersionId || mapping.footprintContentDigest !== binding.footprint?.contentDigest || mapping.symbolAssetVersionId !== binding.dependencies.symbolAssetVersionId || !mapping.mappingCertificateId || !mapping.verifierVersion) issues.push(issue(binding, id, "FR_MAPPING_UNVERIFIED", `Pin-to-pad mapping is ${mapping.state} or does not match active revisions.`, "mapping", "pinPadMapping"));
  else if (!context.policy.acceptedMappingVerifierVersions.includes(mapping.verifierVersion)) issues.push(issue(binding, id, "FR_MAPPING_VERIFIER_UNSUPPORTED", "Mapping verifier version is not accepted by the resolver policy.", "mapping", "pinPadMapping.verifierVersion"));
  else if (mapping.verifierVersion === "sirkit.mapping-verifier/4.0.0" && (!mapping.verificationTier || !context.policy.acceptedLayoutMappingTiers.includes(mapping.verificationTier as typeof context.policy.acceptedLayoutMappingTiers[number]) || mapping.mappingApprovalState !== "approved" || mapping.mappingFreshnessState !== "current" || mapping.mappingConflictState !== "none" || mapping.mappingLifecycleState !== "active" || !mapping.mappingRevisionId || !mapping.mappingContentDigest || !mapping.mappingDependencyDigest || !mapping.verificationResultDigest)) issues.push(issue(binding, id, "FR_MAPPING_TIER_OR_STATE_UNACCEPTED", "Stage 4 mapping tier/state/approval/freshness is not accepted for layout transfer.", "mapping", "pinPadMapping"));
  const requiredReadiness = context.request.purpose === "manufacturing_assessment" ? assessment.manufacturing : assessment.layout;
  if (requiredReadiness !== "ready") {
    for (const gate of assessment.gates.filter((item) => item.blocking)) issues.push(issue(binding, id, `FR_READINESS_${gate.code}`, gate.message, "readiness", gate.recordPath, [gate.code]));
  }
  return [...new Map(issues.map((item) => [`${item.code}\0${item.fieldRefs.join("|")}`, item])).values()].sort((a, b) => a.code.localeCompare(b.code) || a.fieldRefs.join().localeCompare(b.fieldRefs.join()));
}

function sourceForBinding(candidate: NormalizedFootprintCandidate, binding: ComponentPhysicalBinding, context: ImmutableResolutionContext): { sourceKind: BindingAssessment["sourceKind"]; sourceAuthorityClass: SourceAuthorityClass; rank: number } {
  const origins = candidate.originRecords.filter((record) => record.bindingRevisionId === binding.revisionId).sort((a, b) => authorityRank(context.policy, a.sourceAuthorityClass) - authorityRank(context.policy, b.sourceAuthorityClass) || a.sourceKind.localeCompare(b.sourceKind));
  const first = origins[0] ?? candidate.originRecords[0]!;
  return { sourceKind: first.sourceKind, sourceAuthorityClass: first.sourceAuthorityClass, rank: authorityRank(context.policy, first.sourceAuthorityClass) };
}

function dispositionFromIssues(binding: ComponentPhysicalBinding, issues: ResolutionIssue[], candidate: NormalizedFootprintCandidate): CandidateDispositionKind {
  const codes = new Set(issues.map((item) => item.code));
  if (codes.has("FR_VARIANT_INAPPLICABLE") || codes.has("FR_COMPONENT_NOT_APPLICABLE")) return "inapplicable_variant";
  if (binding.lifecycleState === "superseded") return "superseded";
  if (binding.approval.state === "revoked") return "revoked";
  if (binding.approval.state === "rejected") return "rejected";
  if (codes.has("FR_BINDING_CONFLICT")) return "conflicting";
  if (codes.has("FR_DEPENDENCY_STALE")) return "stale";
  if (codes.has("FR_FOOTPRINT_ASSET_UNAVAILABLE") || codes.has("FR_SOURCE_MISSING")) return "asset_unavailable";
  if (codes.has("FR_PACKAGE_AMBIGUOUS") || codes.has("FR_PACKAGE_MISSING")) return "package_ambiguous";
  if (codes.has("FR_PACKAGE_INCOMPATIBLE")) return "package_incompatible";
  if (codes.has("FR_MAPPING_MISSING")) return "mapping_missing";
  if (codes.has("FR_MAPPING_STALE")) return "mapping_stale";
  if (codes.has("FR_MAPPING_UNVERIFIED")) return "mapping_unverified";
  if (codes.has("FR_MAPPING_FAILED") || codes.has("FR_TECHNICAL_VALIDATION_FAILED")) return "technically_invalid";
  if (codes.has("FR_MAPPING_UNSUPPORTED") || codes.has("FR_TECHNICAL_VALIDATION_UNSUPPORTED")) return "unsupported";
  if (codes.has("FR_TECHNICAL_VALIDATION_PENDING")) return "technically_unverified";
  if (codes.has("FR_APPROVAL_REQUIRED") || codes.has("FR_APPROVAL_EXPIRED")) return "unapproved";
  if (candidate.originRecords.every((record) => record.sourceAuthorityClass === "suggestion_only")) return "suggestion_only";
  return "malformed";
}

function assessCandidates(context: ImmutableResolutionContext, candidates: NormalizedFootprintCandidate[]): AssessedCandidate[] {
  return candidates.map((candidate) => {
    const bindings: BindingAssessment[] = candidate.contributingBindings.map((binding) => {
      const source = sourceForBinding(candidate, binding, context);
      const effectiveSelectedRevisionId = context.effectiveSelectedRevisionIds.includes(binding.revisionId) || isQualifiedPassivePolicyBinding(context, source.sourceKind, binding) ? binding.revisionId : undefined;
      const assessment = evaluatePhysicalReadiness(binding, { policy: context.policy.stage1ReadinessPolicy, assessedAt: context.request.requestedAt, effectiveSelectedRevisionId });
      const issues = bindingIssues(context, candidate, binding, assessment, source.sourceKind);
      return { binding, assessment, issues, sourceKind: source.sourceKind, sourceAuthorityClass: source.sourceAuthorityClass, authorityRank: source.rank, eligible: issues.length === 0 };
    }).sort((a, b) => Number(b.eligible) - Number(a.eligible) || a.authorityRank - b.authorityRank || a.binding.revisionId.localeCompare(b.binding.revisionId));
    const best = bindings[0]!;
    const equivalentMerged = candidate.contributingBindings.length > 1 && best.eligible;
    const primary = best.eligible ? (context.effectiveSelectedRevisionIds.includes(best.binding.revisionId) ? "selected_authoritative" : equivalentMerged ? "equivalent_merged" : "eligible_lower_precedence") : dispositionFromIssues(best.binding, best.issues, candidate);
    const disposition: CandidateDisposition = { candidateId: candidate.candidateId, primary, authorityClass: best.sourceAuthorityClass, authorityRank: best.authorityRank, eligible: best.eligible, blocking: best.issues.some((item) => item.blocking), reasonCodes: best.issues.length ? best.issues.map((item) => item.code).sort() : ["FR_CANDIDATE_ALL_GATES_PASS"], issues: best.issues, evidenceRefs: candidate.evidenceRefs, implicatedFields: [...new Set(best.issues.flatMap((item) => item.fieldRefs))].sort(), readinessAssessment: best.assessment };
    return { candidate, bindings, best, disposition };
  }).sort((a, b) => a.candidate.candidateId.localeCompare(b.candidate.candidateId));
}

function conflict(context: ImmutableResolutionContext, kind: ResolutionConflict["conflictClass"], candidates: AssessedCandidate[], message: string): ResolutionConflict {
  const candidateIds = candidates.map((item) => item.candidate.candidateId).sort();
  return { conflictId: resolverId("footprint-resolution-conflict", { kind, candidates: candidateIds, dependency: context.dependencyDigest }), conflictClass: kind, candidateIds, blocking: true, message, evidenceRefs: [...new Set(candidates.flatMap((item) => item.candidate.evidenceRefs))].sort() };
}

function analyzeConflicts(context: ImmutableResolutionContext, candidates: AssessedCandidate[]): ResolutionConflict[] {
  const conflicts: ResolutionConflict[] = [];
  const selected = candidates.filter((item) => item.candidate.contributingBindings.some((binding) => context.effectiveSelectedRevisionIds.includes(binding.revisionId)));
  if (selected.length > 1) conflicts.push(conflict(context, "multiple_active_selections", selected, "More than one effective Stage 1 selection applies to this component and variant."));
  const currentApproved = candidates.filter((item) => item.candidate.contributingBindings.some((binding) => binding.approval.state === "approved" && binding.approval.contentDigest === binding.technicalDigest && binding.technicalValidation.state === "valid" && binding.technicalValidation.validatedDigest === binding.technicalDigest && binding.freshness.state === "current" && binding.conflict.state === "none" && binding.applicabilityState === "applicable" && !["superseded", "withdrawn", "orphaned", "obsolete"].includes(binding.lifecycleState)));
  for (let leftIndex = 0; leftIndex < currentApproved.length; leftIndex++) for (let rightIndex = leftIndex + 1; rightIndex < currentApproved.length; rightIndex++) {
    const left = currentApproved[leftIndex]!, right = currentApproved[rightIndex]!;
    const leftAsset = left.candidate.footprintAssetIdentity, rightAsset = right.candidate.footprintAssetIdentity;
    if (!leftAsset || !rightAsset) continue;
    if (leftAsset.libraryNickname === rightAsset.libraryNickname && leftAsset.footprintName === rightAsset.footprintName && leftAsset.contentDigest !== rightAsset.contentDigest) conflicts.push(conflict(context, "asset_name_digest_collision", [left, right], "Approved footprint records share a display name but have different content digests."));
    if (leftAsset.contentDigest !== rightAsset.contentDigest || leftAsset.assetVersionId !== rightAsset.assetVersionId) conflicts.push(conflict(context, "incompatible_approved_assets", [left, right], "Current approved candidates claim materially different footprint assets."));
    else if (left.candidate.pinPadMappingRef.mappingCertificateId !== right.candidate.pinPadMappingRef.mappingCertificateId) conflicts.push(conflict(context, "pin_pad_mapping_disagreement", [left, right], "Current approved candidates disagree on pin-to-pad mapping."));
  }
  for (const candidate of candidates) {
    const states = new Set(candidate.candidate.contributingBindings.map((binding) => binding.approval.state));
    if (states.has("approved") && (states.has("revoked") || states.has("rejected"))) conflicts.push(conflict(context, "inconsistent_duplicate_state", [candidate], "Equivalent technical candidates contain incompatible approval states."));
  }
  return [...new Map(conflicts.map((item) => [item.conflictId, item])).values()].sort((a, b) => a.conflictClass.localeCompare(b.conflictClass) || a.conflictId.localeCompare(b.conflictId));
}

function sourceIssues(context: ImmutableResolutionContext): { blockers: ResolutionIssue[]; warnings: ResolutionIssue[] } {
  const blockers: ResolutionIssue[] = [], warnings: ResolutionIssue[] = [];
  for (const source of context.sourceResults) {
    if (!["failed", "unavailable", "timeout", "cancelled", "unsupported"].includes(source.status)) continue;
    const enabled = context.policy.enabledSources.includes(source.sourceKind);
    const blocking = enabled && source.sourceKind === "selected_stage1_binding" && source.status !== "unsupported";
    const item = resolutionIssue({ code: source.status === "timeout" ? "FR_SOURCE_TIMEOUT" : source.status === "unavailable" ? "FR_SOURCE_UNAVAILABLE" : source.status === "cancelled" ? "FR_SOURCE_CANCELLED" : source.status === "unsupported" ? "FR_SOURCE_UNSUPPORTED" : "FR_SOURCE_FAILED", componentId: context.request.componentId, message: `Candidate source ${source.sourceKind} is ${source.status}.`, category: "source", blocking, severity: blocking ? "blocking" : "warning", details: { sourceKind: source.sourceKind, sourceVersion: source.sourceVersion } });
    (blocking ? blockers : warnings).push(item);
  }
  return { blockers: blockers.sort((a, b) => a.code.localeCompare(b.code)), warnings: warnings.sort((a, b) => a.code.localeCompare(b.code)) };
}

export function deriveFootprintResolutionStatus(blockers: readonly ResolutionIssue[], conflicts: readonly ResolutionConflict[], candidates: readonly { eligible: boolean; primary: CandidateDispositionKind }[]): FootprintResolutionStatus {
  if (conflicts.some((item) => item.blocking)) return "blocked_conflict";
  const codes = new Set(blockers.map((item) => item.code));
  if ([...codes].some((code) => code.includes("INVALID") || code.includes("FAILED") || code.includes("LIMIT") || code === "FR_STAGE1_BINDING_INVALID")) return "blocked_invalid";
  if ([...codes].some((code) => code.includes("STALE") || code.includes("EXPIRED") || code.includes("REVISION_MISMATCH"))) return "blocked_stale";
  if ([...codes].some((code) => code.includes("UNAVAILABLE") || code === "FR_SOURCE_MISSING")) return "blocked_unavailable";
  if ([...codes].some((code) => code.includes("UNSUPPORTED"))) return "blocked_unsupported";
  if (codes.has("FR_PACKAGE_AMBIGUOUS")) return "unresolved_ambiguous";
  if ([...codes].some((code) => code.includes("_MISSING"))) return "unresolved_missing_data";
  if ([...codes].some((code) => code.includes("APPROVAL"))) return "blocked_unapproved";
  if (candidates.length > 1 && candidates.every((item) => !item.eligible)) return "unresolved_ambiguous";
  if (candidates.length && candidates.some((item) => item.primary === "suggestion_only" || item.primary === "unapproved" || item.primary === "eligible_lower_precedence")) return "deferred_to_user_decision";
  return "unresolved_missing_data";
}

function suggestions(candidates: AssessedCandidate[]): SuggestedCandidateView[] {
  return candidates.filter((item) => !item.best.eligible).map((item) => {
    const codes = new Set(item.disposition.reasonCodes);
    const requires: SuggestedCandidateView["requires"] = [];
    if (codes.has("FR_EFFECTIVE_SELECTION_REQUIRED")) requires.push("selection");
    if ([...codes].some((code) => code.startsWith("FR_APPROVAL"))) requires.push("approval");
    if ([...codes].some((code) => code.startsWith("FR_TECHNICAL"))) requires.push("technical_validation");
    if ([...codes].some((code) => code.startsWith("FR_MAPPING"))) requires.push("mapping_verification");
    if ([...codes].some((code) => code.startsWith("FR_PACKAGE"))) requires.push("package_clarification");
    if ([...codes].some((code) => code.startsWith("FR_FOOTPRINT"))) requires.push("asset_availability");
    const confidences = item.candidate.originRecords.map((record) => record.confidence).filter((value): value is number => value !== undefined);
    return { candidateId: item.candidate.candidateId, footprintAsset: item.candidate.footprintAssetIdentity ?? null, packageIdentity: item.candidate.packageIdentity ?? null, sourceKinds: [...new Set(item.candidate.originRecords.map((record) => record.sourceKind))].sort(), ...(confidences.length ? { confidence: Math.max(...confidences) } : {}), reasonCodes: item.disposition.reasonCodes, requires: [...new Set(requires)].sort() };
  }).sort((a, b) => a.candidateId.localeCompare(b.candidateId));
}

function makeTrace(context: ImmutableResolutionContext, normalization: ReturnType<typeof normalizeAndDeduplicateCandidates>, assessed: AssessedCandidate[], conflicts: ResolutionConflict[], status: FootprintResolutionStatus): FootprintResolutionResult["trace"] {
  const steps: Omit<ResolutionTraceStep, "ordinal">[] = [
    { phase: "request", code: "FR_REQUEST_ACCEPTED", message: "Versioned request and policy were validated.", candidateIds: [], safeDetails: { purpose: context.request.purpose, policyVersion: context.policy.version } },
    { phase: "snapshot", code: "FR_SNAPSHOT_ASSEMBLED", message: "One immutable Stage 1 snapshot was assembled.", candidateIds: [], safeDetails: { bindingSetCount: context.bindingSets.length, dependencyDigest: context.dependencyDigest } },
    ...context.sourceResults.map((source) => ({ phase: "collection" as const, code: `FR_SOURCE_${source.status.toUpperCase()}`, message: `Candidate source ${source.sourceKind} returned ${source.status}.`, candidateIds: source.candidates.map((candidate) => candidate.rawCandidateId).sort(), sourceKind: source.sourceKind, safeDetails: { sourceVersion: source.sourceVersion, candidateCount: source.candidates.length } })),
    ...normalization.groups.map((group) => ({ phase: "normalization" as const, code: group.rawCandidateIds.length > 1 ? "FR_EQUIVALENT_CANDIDATES_MERGED" : "FR_CANDIDATE_NORMALIZED", message: group.rawCandidateIds.length > 1 ? "Technically equivalent candidates were merged with provenance preserved." : "Candidate technical identity was canonicalized.", candidateIds: [group.candidateId], safeDetails: { contributingCount: group.rawCandidateIds.length, technicalIdentityDigest: group.technicalIdentityDigest } })),
    ...assessed.map((item) => ({ phase: "eligibility" as const, code: `FR_DISPOSITION_${item.disposition.primary.toUpperCase()}`, message: `Candidate disposition is ${item.disposition.primary}.`, candidateIds: [item.candidate.candidateId], safeDetails: { eligible: item.disposition.eligible, authorityRank: item.disposition.authorityRank } })),
    ...conflicts.map((item) => ({ phase: "conflict" as const, code: `FR_CONFLICT_${item.conflictClass.toUpperCase()}`, message: item.message, candidateIds: item.candidateIds, safeDetails: { blocking: item.blocking } })),
    { phase: "decision", code: `FR_STATUS_${status.toUpperCase()}`, message: `Deterministic final status is ${status}.`, candidateIds: assessed.filter((item) => item.best.eligible).map((item) => item.candidate.candidateId).sort(), safeDetails: { status } },
  ];
  const bounded = steps.slice(0, context.policy.maxTraceSteps).map((step, ordinal) => ({ ...step, ordinal }));
  return { schemaVersion: FOOTPRINT_RESOLUTION_TRACE_VERSION, steps: bounded, truncated: steps.length > bounded.length, technicalTraceDigest: resolverDigest(bounded) };
}

export class DeterministicFootprintResolutionEngine {
  evaluate(context: ImmutableResolutionContext): FootprintResolutionResult {
    const contextIssues = validateResolutionContext(context);
    const normalization = normalizeAndDeduplicateCandidates(context.sourceResults, context.policy);
    const assessed = assessCandidates(context, normalization.candidates);
    const source = sourceIssues(context);
    const conflicts = analyzeConflicts(context, assessed);
    const explicitNotApplicable = assessed.length > 0 && assessed.every((item) => item.best.binding.applicabilityState === "not_applicable" && item.best.binding.freshness.state === "current" && item.best.binding.conflict.state === "none");
    const eligible = assessed.filter((item) => item.best.eligible).sort((a, b) => a.disposition.authorityRank - b.disposition.authorityRank || a.candidate.candidateId.localeCompare(b.candidate.candidateId));
    const highestRank = eligible[0]?.disposition.authorityRank;
    const highest = eligible.filter((item) => item.disposition.authorityRank === highestRank);
    if (highest.length > 1 && !conflicts.some((item) => item.candidateIds.length === highest.length && item.candidateIds.every((id) => highest.some((candidate) => candidate.candidate.candidateId === id)))) conflicts.push(conflict(context, "incompatible_approved_assets", highest, "More than one materially different eligible candidate remains at the highest authority rank."));
    const winner = conflicts.some((item) => item.blocking) || highest.length !== 1 ? undefined : highest[0];
    const candidateIssues = assessed.flatMap((item) => item.disposition.issues);
    const decisionCandidateIssues = winner ? winner.disposition.issues : candidateIssues;
    const lowerCandidateWarnings = winner ? assessed.filter((item) => item.candidate.candidateId !== winner.candidate.candidateId).flatMap((item) => item.disposition.issues.map((candidateIssue) => ({ ...candidateIssue, blocking: false, severity: "warning" as const }))) : [];
    const blockers = [...contextIssues, ...source.blockers, ...decisionCandidateIssues].filter((item) => item.blocking).sort((a, b) => a.code.localeCompare(b.code) || (a.candidateId ?? "").localeCompare(b.candidateId ?? ""));
    const warnings = [...source.warnings, ...candidateIssues.filter((item) => !item.blocking), ...lowerCandidateWarnings].sort((a, b) => a.code.localeCompare(b.code));
    const status: FootprintResolutionStatus = explicitNotApplicable ? "not_applicable" : winner && blockers.length === 0 && conflicts.length === 0 ? "resolved" : deriveFootprintResolutionStatus(blockers, conflicts, assessed.map((item) => ({ eligible: item.best.eligible, primary: item.disposition.primary })));
    const trace = makeTrace(context, normalization, assessed, conflicts, status);
    const resolvedBinding = status === "resolved" && winner?.candidate.footprintAssetIdentity && winner.candidate.packageIdentity ? {
      componentId: context.request.componentId,
      assemblyVariantId: context.request.assemblyVariantId,
      bindingRevisionId: winner.best.binding.revisionId,
      bindingTechnicalDigest: winner.best.binding.technicalDigest,
      footprintAsset: winner.candidate.footprintAssetIdentity,
      packageIdentity: winner.candidate.packageIdentity,
      ...(winner.candidate.exactPartIdentity ? { exactPartIdentity: winner.candidate.exactPartIdentity } : {}),
      pinPadMapping: winner.candidate.pinPadMappingRef,
      approvalEvidenceRefs: [...new Set(winner.best.binding.evidenceRefs)].sort(),
      readiness: { layout: winner.best.assessment.layout, manufacturing: winner.best.assessment.manufacturing },
      purpose: context.request.purpose,
      dependencyDigest: context.dependencyDigest,
      authorityClass: winner.disposition.authorityClass,
      authorityReasonCode: `FR_AUTHORITY_${winner.disposition.authorityClass.toUpperCase()}`,
    } : undefined;
    const readinessAssessments = Object.fromEntries(assessed.map((item) => [item.candidate.candidateId, item.best.assessment]));
    const inputSnapshot = {
      componentIdentityDigest: resolverDigest(context.componentIdentity),
      componentId: context.request.componentId,
      assemblyVariantId: context.request.assemblyVariantId,
      bindingSetDigests: context.bindingSets.map((set) => set.recordDigest).sort(),
      effectiveSelectedRevisionIds: [...context.effectiveSelectedRevisionIds].sort(),
      sourceVersions: context.sourceResults.map((result) => ({ sourceKind: result.sourceKind, sourceVersion: result.sourceVersion, status: result.status })).sort((a, b) => a.sourceKind.localeCompare(b.sourceKind)),
      dependencyDigest: context.dependencyDigest,
      stage1SchemaVersion: "sirkit.physical-binding.v1",
      stage1ReadinessPolicyVersion: context.policy.stage1ReadinessPolicy.policyVersion,
    };
    const base: Omit<FootprintResolutionResult, "decisionDigest"> = {
      resultSchemaVersion: FOOTPRINT_RESOLUTION_RESULT_VERSION,
      requestId: context.request.requestId,
      status,
      ...(resolvedBinding ? { resolvedBinding } : {}),
      suggestedCandidates: context.policy.includeSuggestions ? suggestions(assessed) : [],
      consideredCandidates: assessed.map((item) => item.disposition),
      blockers,
      warnings,
      conflicts: conflicts.sort((a, b) => a.conflictClass.localeCompare(b.conflictClass) || a.conflictId.localeCompare(b.conflictId)),
      trace,
      readinessAssessment: winner?.best.assessment ?? assessed.find((item) => context.effectiveSelectedRevisionIds.includes(item.best.binding.revisionId))?.best.assessment ?? assessed[0]?.best.assessment ?? null,
      readinessAssessments,
      inputSnapshot,
      policyId: context.policy.policyId,
      policyVersion: context.policy.version,
      resolverVersion: FOOTPRINT_RESOLVER_VERSION,
      normalizationVersion: FOOTPRINT_RESOLVER_NORMALIZATION_VERSION,
      compatibilityValidatorVersion: FOOTPRINT_COMPATIBILITY_VALIDATOR_VERSION,
      cache: { mode: "disabled", status: "not_applicable", behaviorVersion: "no-cache/1", dependencyDigest: context.dependencyDigest },
      evaluatedAt: context.request.requestedAt,
    };
    return { ...base, decisionDigest: resolverDigest(resolutionDecisionPayload(base)) };
  }
}

export function assertContextDigest(context: ImmutableResolutionContext): void {
  if (contextTechnicalDigest(context) !== context.dependencyDigest) throw new Error("FR_CONTEXT_DEPENDENCY_DIGEST_MISMATCH");
}
