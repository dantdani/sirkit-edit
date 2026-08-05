import { compareQuantities } from "../constraints/quantity";
import type { ConstraintQuantity } from "../constraints/types";
import type { CapabilityAssessment, DesignCapabilityEntry, DesignCapabilityProfile, Requirement, RequirementPredicate } from "./types";
import { requirementsDigest } from "./stable";

const SUPPORT_ORDER: Record<CapabilityAssessment["state"], number> = {
  supported_and_verifiable: 0,
  supported_with_limitations: 1,
  exploration_only: 2,
  external_review_required: 3,
  unknown_not_assessed: 4,
  unsupported: 5,
};

function profile(input: Omit<DesignCapabilityProfile, "deterministicDigest">): DesignCapabilityProfile {
  return { ...input, deterministicDigest: requirementsDigest(input) };
}

function capability(input: DesignCapabilityEntry): DesignCapabilityEntry { return input; }

const COMMON_DOMAINS: DesignCapabilityEntry["requirementDomains"] = [
  "product_functional", "use_case_operating_mode", "electrical_supply_load", "power_energy_battery", "digital_interface_protocol",
  "timing_latency_bandwidth", "clock_reset_boot_debug_firmware", "environmental", "mechanical_enclosure_connector",
  "reliability_lifecycle_serviceability", "component_sourcing_cost_volume", "manufacturing_assembly", "calibration_test_diagnostics",
  "pcb_placement_routing_stackup", "documentation_release_process",
];
const COMMON_KINDS: DesignCapabilityEntry["requirementKinds"] = ["capability_behavior", "minimum", "maximum", "range", "target", "exact_or_set", "required_forbidden_relationship", "budget_allocation", "sequence_state_transition", "interface_contract", "quality_attribute", "process_evidence_obligation", "implementation_mandate", "preference_objective", "informational_context"];
const COMMON_FORMS: RequirementPredicate["form"][] = ["minimum", "maximum", "range", "equals", "not_equals", "allowed_set", "forbidden_set", "required_set", "must_exist", "must_connect", "must_not_connect", "distance", "containment", "ordering", "budget", "target", "objective", "require_coverage", "qualitative_rubric", "temporal_sequence"];

export const EMBEDDED_LOW_VOLTAGE_PROFILE_V1: DesignCapabilityProfile = profile({
  profileId: "embedded-low-voltage-v1",
  version: "1.0.0",
  title: "Embedded low-voltage circuit design envelope",
  scope: "Low-voltage embedded digital and mixed-signal boards using the currently modeled CD and PCB evaluators.",
  capabilityEntries: [
    capability({ capabilityId: "embedded-low-voltage", domain: "electrical", task: "Low-voltage embedded design requirements", requirementDomains: COMMON_DOMAINS, requirementKinds: COMMON_KINDS, supportedPredicateForms: COMMON_FORMS, limits: [{ field: "maximum_voltage", predicate: { form: "maximum", value: { dimension: "voltage", value: "60", unit: "V" } }, explanation: "The initial autonomous envelope is limited to 60 V DC and below; sources and transients still require explicit limits." }], requiredPrerequisiteData: ["input voltage range", "load range", "operating modes", "temperature range"], evaluatorRefs: ["sirkit-requirements/1.0.0", "sirkit-constraints/1.0.0"], evidenceLevel: "deterministic", supportState: "supported_with_limitations", knownLimitations: ["Architecture-dependent feasibility is deferred to CD-2 onward", "No certification claim"], benchmarkCoverage: ["cd1:led-status", "cd1:dc-regulator", "cd1:battery-sensor"], version: "1.0.0" }),
    capability({ capabilityId: "common-digital-interfaces", domain: "interfaces", task: "GPIO, I2C, SPI, UART, PWM, ADC/DAC, CAN, and RS-485 requirement planning", requirementDomains: ["digital_interface_protocol", "timing_latency_bandwidth", "clock_reset_boot_debug_firmware"], requirementKinds: COMMON_KINDS, supportedPredicateForms: COMMON_FORMS, limits: [], requiredPrerequisiteData: ["interface standard/version", "voltage domain", "speed", "connector/environment"], evaluatorRefs: ["cd4-interface-plan:planned", "pcb-stage8:limited"], evidenceLevel: "exploration_only", supportState: "supported_with_limitations", knownLimitations: ["Pin assignment and circuit realization are later-stage work"], benchmarkCoverage: ["cd1:usb-mcu", "cd1:can-rs485"], version: "1.0.0" }),
    capability({ capabilityId: "usb-full-speed", domain: "interfaces", task: "USB 2.0 Full Speed requirements", requirementDomains: ["digital_interface_protocol", "timing_latency_bandwidth"], requirementKinds: COMMON_KINDS, supportedPredicateForms: COMMON_FORMS, limits: [], requiredPrerequisiteData: ["USB speed", "role", "connector", "power role", "ESD environment"], evaluatorRefs: ["cd4-usb:planned", "pcb-stage8:differential-static"], evidenceLevel: "exploration_only", supportState: "supported_with_limitations", knownLimitations: ["No internal USB certification"], benchmarkCoverage: ["cd1:usb-mcu"], version: "1.0.0" }),
    capability({ capabilityId: "regulated-dc-power", domain: "power", task: "Regulated DC LDO/buck/boost requirement planning", requirementDomains: ["electrical_supply_load", "power_energy_battery"], requirementKinds: COMMON_KINDS, supportedPredicateForms: COMMON_FORMS, limits: [], requiredPrerequisiteData: ["input range and transient", "output range", "load range", "temperature", "ripple/efficiency targets"], evaluatorRefs: ["cd3-power:planned", "cd7-corner-analysis:planned", "cd10-simulation:planned"], evidenceLevel: "exploration_only", supportState: "supported_with_limitations", knownLimitations: ["Topology selection is outside CD-1"], benchmarkCoverage: ["cd1:dc-regulator"], version: "1.0.0" }),
    capability({ capabilityId: "pcb-2-4-layer", domain: "pcb", task: "Two- through four-layer PCB requirement planning", requirementDomains: ["pcb_placement_routing_stackup", "manufacturing_assembly"], requirementKinds: COMMON_KINDS, supportedPredicateForms: COMMON_FORMS, limits: [], requiredPrerequisiteData: ["layer count or profile", "fabrication profile", "outline limits"], evaluatorRefs: ["sirkit-constraints/1.0.0", "pcb-stage3-readiness", "pcb-stage4-native-manufacturing"], evidenceLevel: "deterministic", supportState: "supported_and_verifiable", knownLimitations: ["Signal-integrity field solving is not included"], benchmarkCoverage: ["stage9:two-layer", "stage9:four-layer"], version: "1.0.0" }),
    capability({ capabilityId: "precision-analog", domain: "analog", task: "Precision/noise/drift requirement planning", requirementDomains: ["analog_performance", "calibration_test_diagnostics"], requirementKinds: COMMON_KINDS, supportedPredicateForms: COMMON_FORMS, limits: [], requiredPrerequisiteData: ["accuracy", "resolution", "bandwidth", "noise", "source impedance", "temperature", "calibration"], evaluatorRefs: ["cd7:planned", "cd10:planned", "human-expert-review"], evidenceLevel: "exploration_only", supportState: "exploration_only", knownLimitations: ["Unmodeled precision/noise/drift targets require expert review"], benchmarkCoverage: ["cd1:mixed-signal-acquisition"], version: "1.0.0" }),
    capability({ capabilityId: "external-compliance", domain: "compliance", task: "External standards and certification obligation planning", requirementDomains: ["safety_isolation_compliance", "documentation_release_process"], requirementKinds: ["external_approval_certification", "process_evidence_obligation"], supportedPredicateForms: ["external_evidence", "qualitative_rubric"], limits: [], requiredPrerequisiteData: ["standard identifier and version", "region", "product classification", "authority"], evaluatorRefs: ["external-authority"], evidenceLevel: "external", supportState: "external_review_required", externalReviewRequirement: "An authorized laboratory, certifier, or qualified expert owns the evidence.", knownLimitations: ["Sirkit cannot certify legal or regulatory compliance"], benchmarkCoverage: ["cd1:mains-life-safety"], version: "1.0.0" }),
    ...["mains-high-voltage", "life-safety", "high-energy-battery", "intrinsic-safety", "rf-microwave", "unmodeled-high-current-power", "ddr-very-high-speed"].map((capabilityId): DesignCapabilityEntry => capability({ capabilityId, domain: "specialized", task: `${capabilityId} design`, requirementDomains: ["electrical_supply_load", "power_energy_battery", "safety_isolation_compliance", "digital_interface_protocol", "timing_latency_bandwidth"], requirementKinds: COMMON_KINDS, supportedPredicateForms: COMMON_FORMS, limits: [], requiredPrerequisiteData: ["specialized capability pack"], evaluatorRefs: [], evidenceLevel: capabilityId === "life-safety" || capabilityId === "intrinsic-safety" ? "external" : "exploration_only", supportState: capabilityId === "life-safety" || capabilityId === "intrinsic-safety" ? "external_review_required" : "unsupported", ...(capabilityId === "life-safety" || capabilityId === "intrinsic-safety" ? { externalReviewRequirement: "Qualified external safety authority required." } : {}), knownLimitations: ["No complete specialized models, checkers, evidence, and benchmark pack"], benchmarkCoverage: ["cd1:mains-life-safety"], version: "1.0.0" })),
  ],
  defaultPolicies: [],
  externalReviewRules: ["Legal, regulatory, safety, and certification claims require external authority evidence."],
  owner: "Sirkit engineering",
  evidenceRefs: ["SIRKIT_STAGE_03_READINESS_SIGNOFF_IMPLEMENTATION.md", "SIRKIT_STAGE_06_HIERARCHICAL_CONSTRAINT_LANGUAGE_IMPLEMENTATION.md", "SIRKIT_STAGE_09_COMPETITIVE_BENCHMARK_QOR_IMPLEMENTATION.md"],
  effectiveFrom: "2026-07-17T00:00:00.000Z",
});

export function validateDesignCapabilityProfile(value: DesignCapabilityProfile): string[] {
  const errors: string[] = [];
  if (!value.profileId.trim() || !value.version.trim() || !value.owner.trim() || !Number.isFinite(Date.parse(value.effectiveFrom))) errors.push("CAPABILITY_PROFILE_IDENTITY_INVALID");
  if (new Set(value.capabilityEntries.map((item) => item.capabilityId)).size !== value.capabilityEntries.length) errors.push("CAPABILITY_PROFILE_DUPLICATE_ENTRY");
  if (value.capabilityEntries.some((item) => item.version !== value.version)) errors.push("CAPABILITY_ENTRY_VERSION_MISMATCH");
  if (requirementsDigest({ ...value, deterministicDigest: undefined }) !== value.deterministicDigest) errors.push("CAPABILITY_PROFILE_DIGEST_MISMATCH");
  return errors;
}

function predicateMaximum(predicate: RequirementPredicate): ConstraintQuantity | undefined {
  if (predicate.form === "maximum") return predicate.value;
  if (predicate.form === "range") return predicate.max;
  if (predicate.form === "equals" && typeof predicate.value === "object" && predicate.value !== null && "dimension" in predicate.value) return predicate.value;
  if (predicate.form === "target") return predicate.value;
  return undefined;
}

function entryAssessment(entry: DesignCapabilityEntry, requirement: Requirement, profileRef: string): CapabilityAssessment {
  let state = entry.supportState;
  const limitations = [...entry.knownLimitations];
  if (!entry.supportedPredicateForms.includes(requirement.typedPredicate.form)) {
    state = "unknown_not_assessed";
    limitations.push(`Predicate form ${requirement.typedPredicate.form} is not evaluated by this capability entry.`);
  }
  for (const limit of entry.limits) {
    if (limit.field !== "maximum_voltage" || limit.predicate.form !== "maximum") continue;
    const requested = predicateMaximum(requirement.typedPredicate);
    if (!requested || requested.dimension !== "voltage") continue;
    try {
      if (compareQuantities(requested, limit.predicate.value) > 0) {
        state = "unsupported";
        limitations.push(limit.explanation);
      }
    } catch { state = "unknown_not_assessed"; }
  }
  return { profileRef, capabilityId: entry.capabilityId, state, limitations: [...new Set(limitations)].sort(), requiredEvidence: entry.evidenceLevel === "external" ? [entry.externalReviewRequirement ?? "External authority evidence"] : entry.evaluatorRefs, evaluatorRefs: entry.evaluatorRefs, explanation: `${entry.task}: ${state.replaceAll("_", " ")}.` };
}

export function assessRequirementCapability(requirement: Requirement, profiles: readonly DesignCapabilityProfile[], selectedRefs: readonly string[]): CapabilityAssessment {
  const selected = profiles.filter((item) => selectedRefs.includes(`${item.profileId}@${item.version}`));
  if (!selected.length) return { profileRef: "none", state: "unknown_not_assessed", limitations: ["No matching versioned capability profile is selected."], requiredEvidence: [], evaluatorRefs: [], explanation: "Capability cannot be assessed without a selected profile revision." };
  const assessments: CapabilityAssessment[] = [];
  for (const selectedProfile of selected) {
    const explicitDemandIds = requirement.capabilityDemandIds;
    const demanded = explicitDemandIds.length
      ? selectedProfile.capabilityEntries.filter((entry) => explicitDemandIds.includes(entry.capabilityId))
      : selectedProfile.capabilityEntries.filter((entry) => entry.requirementDomains.includes(requirement.domain) && entry.requirementKinds.includes(requirement.kind));
    const unmatched = explicitDemandIds.filter((id) => !selectedProfile.capabilityEntries.some((entry) => entry.capabilityId === id));
    assessments.push(...unmatched.map((capabilityId) => ({ profileRef: `${selectedProfile.profileId}@${selectedProfile.version}`, capabilityId, state: "unknown_not_assessed" as const, limitations: [`Capability demand '${capabilityId}' has no entry in the selected profile.`], requiredEvidence: [], evaluatorRefs: [], explanation: `Capability demand '${capabilityId}' is not assessed by the selected profile.` })));
    if (!demanded.length) assessments.push({ profileRef: `${selectedProfile.profileId}@${selectedProfile.version}`, state: "unknown_not_assessed", limitations: [`No capability entry covers ${requirement.domain}/${requirement.kind}.`], requiredEvidence: [], evaluatorRefs: [], explanation: "The selected profile has not assessed this demand." });
    else assessments.push(...demanded.map((entry) => entryAssessment(entry, requirement, `${selectedProfile.profileId}@${selectedProfile.version}`)));
  }
  return assessments.sort((left, right) => SUPPORT_ORDER[right.state] - SUPPORT_ORDER[left.state] || (left.capabilityId ?? "").localeCompare(right.capabilityId ?? ""))[0];
}

export function aggregateCapabilityBlock(requirements: readonly Requirement[]): Requirement[] {
  return requirements.filter((item) => (item.strength === "hard" || item.strength === "externally_mandated") && item.status === "confirmed" && item.capabilityAssessment.state === "unsupported");
}
