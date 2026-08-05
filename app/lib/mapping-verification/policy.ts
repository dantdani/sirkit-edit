import { deepFreezeMapping } from "./stable";
import { MAPPING_POLICY_VERSION, MAPPING_VERIFIER_VERSION, type MappingVerificationPolicy } from "./types";

export const DEFAULT_MAPPING_POLICY: Readonly<MappingVerificationPolicy> = deepFreezeMapping({
  schemaVersion: MAPPING_POLICY_VERSION,
  policyId: "sirkit.mapping-verification",
  version: "1.0.0",
  acceptedParserVersions: { symbol: ["sirkit.kicad-assets/1"], footprint: ["sirkit.kicad-assets/1"], packageTerminal: ["sirkit.package-terminal-facts/1"] },
  acceptedVerifierVersions: [MAPPING_VERIFIER_VERSION],
  acceptedEvidenceClasses: ["manufacturer_datasheet", "manufacturer_cad", "manufacturer_application_note", "official_kicad_library", "organization_authored", "human_reviewed"],
  acceptedLayoutTiers: ["exact_part", "package_family", "curated_pair"],
  minimumTierByRisk: {
    symmetric_two_terminal_nonpolar: "curated_pair",
    polarized_two_terminal: "exact_part",
    diode_led_rectifier: "exact_part",
    transistor_fet: "exact_part",
    simple_connector: "package_family",
    keyed_or_power_connector: "exact_part",
    crystal_oscillator: "exact_part",
    multi_unit_logic_amplifier: "package_family",
    regulator_power_ic: "exact_part",
    complex_ic: "exact_part",
    thermal_exposed_pad: "exact_part",
    high_density_leadless: "exact_part",
    electromechanical: "exact_part",
    rf_high_speed_special: "exact_part",
    unsupported_unknown: "unsupported",
  },
  allowedLimitedDirectRisks: ["symmetric_two_terminal_nonpolar"],
  requireReviewedEvidence: true,
  requireCurrentEvidence: true,
  requireCompleteCoverage: true,
  requireExplicitMechanicalDisposition: true,
  maxPins: 4_096,
  maxTerminals: 4_096,
  maxPads: 8_192,
  maxEdges: 16_384,
  maxEquivalenceClasses: 512,
  maxEvidence: 4_096,
  maxFindings: 16_384,
  maxBatchSize: 64,
  timeoutMs: 5_000,
});

const tierRank = { limited_direct_pair: 1, curated_pair: 2, package_family: 3, exact_part: 4 } as const;
export function tierSatisfies(actual: keyof typeof tierRank, required: keyof typeof tierRank): boolean { return tierRank[actual] >= tierRank[required]; }

export function validateMappingPolicy(policy: MappingVerificationPolicy): string[] {
  const errors: string[] = [];
  if (policy.schemaVersion !== MAPPING_POLICY_VERSION || policy.policyId !== "sirkit.mapping-verification" || policy.version !== "1.0.0") errors.push("MV_POLICY_UNSUPPORTED");
  if (!policy.requireReviewedEvidence || !policy.requireCurrentEvidence || !policy.requireCompleteCoverage || !policy.requireExplicitMechanicalDisposition) errors.push("MV_POLICY_MANDATORY_GATE_WEAKENED");
  if (policy.acceptedLayoutTiers.includes("limited_direct_pair")) errors.push("MV_POLICY_LIMITED_DIRECT_LAYOUT_FORBIDDEN");
  if (policy.allowedLimitedDirectRisks.some((risk) => risk !== "symmetric_two_terminal_nonpolar")) errors.push("MV_POLICY_LIMITED_DIRECT_RISK_WEAKENED");
  if (policy.minimumTierByRisk.unsupported_unknown !== "unsupported") errors.push("MV_POLICY_UNKNOWN_RISK_WEAKENED");
  if (policy.maxPins < 1 || policy.maxPins > 4_096 || policy.maxTerminals < 1 || policy.maxTerminals > 4_096 || policy.maxPads < 1 || policy.maxPads > 8_192 || policy.maxEdges < 1 || policy.maxEdges > 16_384 || policy.maxEvidence < 1 || policy.maxEvidence > 4_096 || policy.maxFindings < 128 || policy.maxFindings > 16_384 || policy.maxBatchSize < 1 || policy.maxBatchSize > 64 || policy.timeoutMs < 100 || policy.timeoutMs > 30_000) errors.push("MV_POLICY_LIMIT_INVALID");
  if (!policy.acceptedVerifierVersions.includes(MAPPING_VERIFIER_VERSION)) errors.push("MV_POLICY_VERIFIER_MISSING");
  return [...new Set(errors)].sort();
}

export function resolveMappingPolicy(id: string, version: string): MappingVerificationPolicy {
  if (id !== DEFAULT_MAPPING_POLICY.policyId || version !== DEFAULT_MAPPING_POLICY.version) throw new Error("MV_POLICY_UNSUPPORTED");
  return structuredClone(DEFAULT_MAPPING_POLICY) as MappingVerificationPolicy;
}
