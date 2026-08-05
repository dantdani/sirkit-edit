import { compareQuantities } from "../constraints/quantity";
import { powerDigest } from "./stable";
import type { PowerCapabilityProfile, PowerQuantityRange, UpstreamCompletionSignoff } from "./types";

const range = (dimension: PowerQuantityRange["dimension"], min: string, max: string, unit: string): PowerQuantityRange => ({ dimension, min: { dimension, value: min, unit }, max: { dimension, value: max, unit }, basis: "guaranteed_maximum", conditionRefs: ["profile:embedded-low-voltage-power-v1"], evidenceRefs: ["sirkit-cd3-analytical-model-envelope"], confidence: "high" });

const profileBase: Omit<PowerCapabilityProfile, "deterministicDigest"> = {
  profileId: "embedded-low-voltage-power-v1", version: "1.0.0",
  supportedSourceKinds: ["regulated_external_dc", "usb_fixed", "battery_low_energy", "upstream_board_rail", "internally_generated", "test_programming_source"],
  supportedTopologyClasses: ["direct_distribution", "step_down", "step_up", "step_up_down", "low_noise_post_regulation", "pass_switch", "reverse_blocking", "isolation_transfer", "monitored_branch"],
  supportedThreatKinds: ["reverse_polarity", "overcurrent", "short_circuit", "overvoltage", "undervoltage", "esd", "hot_plug_inrush", "inductive_kick", "reverse_current", "back_power", "miswiring", "thermal_overload", "stored_energy_discharge", "source_contention"],
  limits: { maximumInputVoltage: { dimension: "voltage", value: "60", unit: "V" }, maximumContinuousPower: { dimension: "power", value: "25", unit: "W" }, maximumSources: 8, maximumRails: 64, maximumDemands: 256, maximumScenarios: 64, maximumSequenceStates: 64, maximumSolverEvents: 20 },
  requiredInputs: ["source operating voltage range", "source current or power limit", "load bounded maximum or explicit unknown", "operating modes", "scenario concurrency", "return-domain intent", "external-boundary threats"],
  requiredEvaluatorRefs: ["sirkit-power/1.0.0", "sirkit-power-concurrency/1.0.0", "sirkit-power-budget/1.0.0", "sirkit-power-sequence/1.0.0"],
  externalReviewRules: ["galvanic isolation and any compliance claim", "ESD/EFT/surge compliance", "safety-related protection", "battery chemistry behavior beyond the simple supplied energy envelope"],
  unsupportedRules: ["direct mains or hazardous voltage", "high-energy battery packs, charging, balancing, or thermal-runaway safety", "automotive load dump or severe surge", "life-safety, implantable, flight-critical, intrinsic-safety, or certified systems", "high-current inverters, traction, welding, or unmodeled inductive power", "USB Power Delivery or PoE negotiation", "RF/microwave power and EM-dependent return design"],
  benchmarkCoverage: ["cd3:analytical-budget", "cd3:concurrency-oracle", "cd3:rail-return-closure", "cd3:sequence-cycle", "cd3:threat-policy", "cd3:unsupported-scope"],
  owner: "Sirkit engineering", approvalState: "approved",
};
export const EMBEDDED_LOW_VOLTAGE_POWER_PROFILE_V1: PowerCapabilityProfile = { ...profileBase, deterministicDigest: powerDigest(profileBase) };

export function validatePowerCapabilityProfile(profile: PowerCapabilityProfile): string[] {
  const errors: string[] = [];
  if (profile.profileId !== "embedded-low-voltage-power-v1" || profile.version !== "1.0.0" || profile.approvalState !== "approved") errors.push("POWER_PROFILE_IDENTITY_INVALID");
  if (profile.deterministicDigest !== powerDigest({ ...profile, deterministicDigest: undefined })) errors.push("POWER_PROFILE_DIGEST_MISMATCH");
  if (profile.limits.maximumSources < 1 || profile.limits.maximumRails < 1 || profile.limits.maximumDemands < 1 || profile.limits.maximumSolverEvents < 1) errors.push("POWER_PROFILE_LIMIT_INVALID");
  return errors.sort();
}

export function createUpstreamCompletionSignoff(input: Omit<UpstreamCompletionSignoff, "schemaVersion" | "deterministicDigest">): UpstreamCompletionSignoff {
  if (input.approver.actorKind !== "human" || !["reviewer", "project_admin"].includes(input.approver.role)) throw new Error("UPSTREAM_SIGNOFF_UNAUTHORIZED");
  const base = { schemaVersion: "sirkit.cd-upstream-signoff.v1" as const, ...structuredClone(input) }; return { ...base, deterministicDigest: powerDigest(base) };
}

export function validateUpstreamCompletionSignoff(signoff: UpstreamCompletionSignoff): string[] {
  const errors: string[] = [];
  if (signoff.schemaVersion !== "sirkit.cd-upstream-signoff.v1" || signoff.cd1Verdict !== "CD-1 COMPLETE" || signoff.cd2Verdict !== "CD-2 COMPLETE") errors.push("UPSTREAM_COMPLETION_VERDICT_MISSING");
  if (signoff.approver.actorKind !== "human" || !["reviewer", "project_admin"].includes(signoff.approver.role)) errors.push("UPSTREAM_SIGNOFF_UNAUTHORIZED");
  if (!Number.isFinite(Date.parse(signoff.approvedAt))) errors.push("UPSTREAM_SIGNOFF_DATE_INVALID");
  if (signoff.deterministicDigest !== powerDigest({ ...signoff, deterministicDigest: undefined })) errors.push("UPSTREAM_SIGNOFF_DIGEST_MISMATCH");
  return errors.sort();
}

export function rangeWithinProfile(input: PowerQuantityRange, profile = EMBEDDED_LOW_VOLTAGE_POWER_PROFILE_V1): boolean {
  if (input.dimension !== "voltage") return true;
  try { return compareQuantities(input.max, profile.limits.maximumInputVoltage) <= 0; } catch { return false; }
}

export const POWER_PROFILE_REFERENCE_RANGES = { inputVoltage: range("voltage", "0", "60", "V"), continuousPower: range("power", "0", "25", "W") } as const;
