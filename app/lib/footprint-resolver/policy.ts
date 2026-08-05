import { DEFAULT_PHYSICAL_READINESS_POLICY } from "../physical-binding/readiness";
import { deepFreezeBinding } from "../physical-binding/stable";
import {
  FOOTPRINT_RESOLUTION_POLICY_VERSION,
  type CandidateSourceKind,
  type FootprintResolutionPolicy,
  type FootprintResolutionPurpose,
  type SourceAuthorityClass,
} from "./types";

const authority: Record<CandidateSourceKind, SourceAuthorityClass> = {
  selected_stage1_binding: "selected_stage1",
  approved_exact_part_binding: "approved_exact_part",
  explicit_component_assignment: "approved_component_assignment",
  symbol_attached_fact: "approved_symbol_fact",
  normalized_package_mapping: "approved_package_mapping",
  passive_policy: "approved_passive_policy",
  legacy_assignment: "suggestion_only",
  human_suggestion: "suggestion_only",
  ai_catalog_suggestion: "suggestion_only",
  generated_overlay: "suggestion_only",
};

const selectedRequirements = {
  requireEffectiveSelection: true,
  requireApproval: true,
  requireTechnicalValidation: true,
  requireCurrentFreshness: true,
  requireVerifiedMapping: true,
  requireAvailableAsset: true,
  requirePackageCompatibility: true,
  requireLayoutReadiness: true,
  requireManufacturingReadiness: false,
};

export const STAGE5_PASSIVE_FOOTPRINT_POLICY_VERSION = "1.1.0-stage5-passive-policy" as const;

export const DEFAULT_FOOTPRINT_RESOLUTION_POLICY: Readonly<FootprintResolutionPolicy> = deepFreezeBinding({
  schemaVersion: FOOTPRINT_RESOLUTION_POLICY_VERSION,
  policyId: "sirkit.default-footprint-resolution",
  version: "1.0.0",
  supportedPurposes: ["preview", "layout_transfer", "manufacturing_assessment", "migration_analysis", "shadow_comparison"],
  sourcePrecedence: [
    { authorityClass: "selected_stage1", rank: 1 },
    { authorityClass: "approved_exact_part", rank: 2 },
    { authorityClass: "approved_component_assignment", rank: 3 },
    { authorityClass: "approved_symbol_fact", rank: 4 },
    { authorityClass: "approved_package_mapping", rank: 5 },
    { authorityClass: "approved_passive_policy", rank: 6 },
    { authorityClass: "suggestion_only", rank: 7 },
  ],
  sourceAuthority: authority,
  purposeRequirements: {
    preview: { ...selectedRequirements },
    layout_transfer: { ...selectedRequirements },
    manufacturing_assessment: { ...selectedRequirements, requireManufacturingReadiness: true },
    migration_analysis: { ...selectedRequirements },
    shadow_comparison: { ...selectedRequirements },
  },
  enabledSources: ["selected_stage1_binding", "approved_exact_part_binding", "explicit_component_assignment", "symbol_attached_fact", "normalized_package_mapping", "legacy_assignment", "human_suggestion", "ai_catalog_suggestion"],
  maxCandidates: 256,
  maxTraceSteps: 2_048,
  maxBatchSize: 256,
  adapterTimeoutMs: 1_500,
  includeSuggestions: true,
  failOnUnavailableAuthoritativeSource: true,
  cacheMode: "disabled",
  cacheBehaviorVersion: "no-cache/1",
  acceptedMappingVerifierVersions: ["sirkit.atomic-mapping/1", "physical-binding-validator/1", "sirkit.mapping-verifier/4.0.0"],
  acceptedLayoutMappingTiers: ["exact_part", "package_family", "curated_pair"],
  stage1ReadinessPolicy: DEFAULT_PHYSICAL_READINESS_POLICY,
});

/** Versioned Stage 5 policy. Requests opt in by version; custom source sets must also enable the Stage 5 adapter explicitly. */
export const STAGE5_PASSIVE_FOOTPRINT_RESOLUTION_POLICY: Readonly<FootprintResolutionPolicy> = deepFreezeBinding({
  ...structuredClone(DEFAULT_FOOTPRINT_RESOLUTION_POLICY),
  version: STAGE5_PASSIVE_FOOTPRINT_POLICY_VERSION,
  enabledSources: [...DEFAULT_FOOTPRINT_RESOLUTION_POLICY.enabledSources, "passive_policy"],
});

export function authorityRank(policy: FootprintResolutionPolicy, authorityClass: SourceAuthorityClass): number {
  return policy.sourcePrecedence.find((entry) => entry.authorityClass === authorityClass)?.rank ?? Number.MAX_SAFE_INTEGER;
}

export function validateResolutionPolicy(policy: FootprintResolutionPolicy): string[] {
  const errors: string[] = [];
  const stage5PassiveEnabled = policy.version === STAGE5_PASSIVE_FOOTPRINT_POLICY_VERSION;
  if (policy.schemaVersion !== FOOTPRINT_RESOLUTION_POLICY_VERSION || policy.policyId !== "sirkit.default-footprint-resolution" || !["1.0.0", STAGE5_PASSIVE_FOOTPRINT_POLICY_VERSION].includes(policy.version)) errors.push("FR_POLICY_VERSION_UNSUPPORTED");
  const purposes = new Set<FootprintResolutionPurpose>(policy.supportedPurposes);
  if (purposes.size !== 5) errors.push("FR_POLICY_PURPOSES_INCOMPLETE");
  const ranks = policy.sourcePrecedence.map((entry) => entry.rank);
  if (new Set(ranks).size !== ranks.length || ranks.some((rank) => !Number.isInteger(rank) || rank < 1)) errors.push("FR_POLICY_PRECEDENCE_INVALID");
  if (policy.sourcePrecedence.at(-1)?.authorityClass !== "suggestion_only") errors.push("FR_POLICY_SUGGESTION_AUTHORITY_INVALID");
  for (const purpose of policy.supportedPurposes) {
    const requirements = policy.purposeRequirements[purpose];
    if (!requirements.requireEffectiveSelection || !requirements.requireApproval || !requirements.requireTechnicalValidation || !requirements.requireCurrentFreshness || !requirements.requireVerifiedMapping || !requirements.requireAvailableAsset || !requirements.requirePackageCompatibility || !requirements.requireLayoutReadiness) errors.push(`FR_POLICY_MANDATORY_GATE_WEAKENED:${purpose}`);
    if (purpose === "manufacturing_assessment" && !requirements.requireManufacturingReadiness) errors.push("FR_POLICY_MANUFACTURING_GATE_WEAKENED");
  }
  if (policy.sourceAuthority.ai_catalog_suggestion !== "suggestion_only" || policy.sourceAuthority.legacy_assignment !== "suggestion_only" || policy.sourceAuthority.human_suggestion !== "suggestion_only" || policy.sourceAuthority.generated_overlay !== "suggestion_only") errors.push("FR_POLICY_SUGGESTION_PROMOTION_FORBIDDEN");
  if (policy.sourceAuthority.passive_policy !== "approved_passive_policy" || policy.enabledSources.includes("generated_overlay")) errors.push("FR_POLICY_DEFERRED_SOURCE_ENABLED");
  if (!stage5PassiveEnabled && policy.enabledSources.includes("passive_policy")) errors.push("FR_POLICY_DEFERRED_SOURCE_ENABLED");
  if (stage5PassiveEnabled && !policy.enabledSources.includes("passive_policy")) errors.push("FR_POLICY_PASSIVE_SOURCE_REQUIRED");
  if (policy.maxCandidates < 1 || policy.maxCandidates > 256 || policy.maxBatchSize < 1 || policy.maxBatchSize > 256 || policy.maxTraceSteps < 64 || policy.maxTraceSteps > 4_096 || policy.adapterTimeoutMs < 50 || policy.adapterTimeoutMs > 10_000) errors.push("FR_POLICY_LIMIT_INVALID");
  if (policy.cacheMode !== "disabled" || policy.cacheBehaviorVersion !== "no-cache/1") errors.push("FR_POLICY_CACHE_MODE_UNSUPPORTED");
  if (!policy.acceptedMappingVerifierVersions.includes("sirkit.mapping-verifier/4.0.0") || policy.acceptedLayoutMappingTiers.includes("limited_direct_pair" as never)) errors.push("FR_POLICY_MAPPING_ACCEPTANCE_INVALID");
  return [...new Set(errors)].sort();
}

export function resolveFootprintPolicy(policyId: string, version: string, options: { allowStage5PassivePolicy?: boolean } = {}): FootprintResolutionPolicy {
  if (policyId !== DEFAULT_FOOTPRINT_RESOLUTION_POLICY.policyId) throw new Error("FR_POLICY_VERSION_UNSUPPORTED");
  if (version === DEFAULT_FOOTPRINT_RESOLUTION_POLICY.version) return structuredClone(DEFAULT_FOOTPRINT_RESOLUTION_POLICY) as FootprintResolutionPolicy;
  if (version === STAGE5_PASSIVE_FOOTPRINT_POLICY_VERSION && options.allowStage5PassivePolicy === true) return structuredClone(STAGE5_PASSIVE_FOOTPRINT_RESOLUTION_POLICY) as FootprintResolutionPolicy;
  throw new Error("FR_POLICY_VERSION_UNSUPPORTED");
}
