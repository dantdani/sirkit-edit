import { validateDesignRequirementsPackage } from "../requirements/validation";
import type { DesignRequirementsPackage, Requirement, RequirementPredicate } from "../requirements/types";
import { architectureDigest, architectureId } from "./stable";
import type {
  ArchitectureBudget,
  ArchitectureDiagnostic,
  ArchitectureFlowKind,
  ArchitectureProblem,
  ArchitectureProblemRequirement,
  CompileArchitectureProblemResult,
  RequiredExternalInteraction,
  RequiredFunctionalCapability,
} from "./types";
import { ARCHITECTURE_COMPILER_VERSION, ARCHITECTURE_PROBLEM_SCHEMA_VERSION } from "./types";

export function validateArchitectureProblem(problem: ArchitectureProblem): string[] {
  const errors: string[] = [];
  if (problem.schemaVersion !== ARCHITECTURE_PROBLEM_SCHEMA_VERSION || problem.compilerVersion !== ARCHITECTURE_COMPILER_VERSION) errors.push("ARCHITECTURE_PROBLEM_SCHEMA_UNSUPPORTED");
  if (!problem.problemId || !problem.tenantId || !problem.projectId || !problem.branchId || problem.requirementsPackageRef.status !== "accepted_for_architecture_exploration") errors.push("ARCHITECTURE_PROBLEM_IDENTITY_INVALID");
  if (!problem.selectedCapabilityProfileRefs.length || !Array.isArray(problem.requirements) || !Array.isArray(problem.functionalCapabilities)) errors.push("ARCHITECTURE_PROBLEM_CONTENT_INVALID");
  if (architectureDigest({ ...problem, deterministicDigest: undefined }) !== problem.deterministicDigest) errors.push("ARCHITECTURE_PROBLEM_DIGEST_MISMATCH");
  return errors.sort();
}

const DOMAIN_CAPABILITIES: Record<Requirement["domain"], string> = {
  product_functional: "provide_product_behavior",
  use_case_operating_mode: "manage_operating_modes",
  electrical_supply_load: "manage_energy",
  power_energy_battery: "manage_energy",
  analog_performance: "sense_and_measure",
  digital_interface_protocol: "communicate",
  timing_latency_bandwidth: "coordinate_timing",
  clock_reset_boot_debug_firmware: "startup_supervision_and_debug",
  environmental: "interface_with_environment",
  mechanical_enclosure_connector: "mechanical_interface",
  safety_isolation_compliance: "protect_and_isolate",
  reliability_lifecycle_serviceability: "supervise_and_service",
  component_sourcing_cost_volume: "manage_resource_policy",
  manufacturing_assembly: "manufacture_and_test",
  calibration_test_diagnostics: "diagnose_and_calibrate",
  pcb_placement_routing_stackup: "physical_realization",
  security_privacy: "secure_and_establish_trust",
  documentation_release_process: "release_and_govern",
};

const EXTERNAL_ROLE_WORDS = ["external", "user", "operator", "host", "sensor", "load", "source", "supply", "battery", "network", "cloud", "debug", "test", "environment", "service", "connector"];

function diagnostic(code: string, message: string, severity: ArchitectureDiagnostic["severity"] = "blocking", refs: string[] = []): ArchitectureDiagnostic {
  return { diagnosticId: architectureId("architecture-diagnostic", { code, message, refs }), code, severity, message, objectRefs: [], requirementRefs: refs, nextActions: ["Resolve the authoritative CD-1 package and compile again"] };
}

function flowKind(requirement: Requirement): ArchitectureFlowKind | "unspecified" {
  if (["electrical_supply_load", "power_energy_battery"].includes(requirement.domain)) return "power";
  if (requirement.domain === "analog_performance") return "analog";
  if (requirement.domain === "digital_interface_protocol") return "data";
  if (requirement.domain === "timing_latency_bandwidth") return "data";
  if (requirement.domain === "clock_reset_boot_debug_firmware") {
    const text = `${requirement.title} ${requirement.normalizedStatement}`.toLowerCase();
    if (text.includes("clock")) return "clock";
    if (text.includes("reset")) return "reset";
    if (text.includes("debug")) return "debug";
    return "control";
  }
  if (requirement.domain === "environmental") return "thermal";
  if (requirement.domain === "mechanical_enclosure_connector") return "mechanical";
  return "unspecified";
}

function directionForRole(role: string): RequiredExternalInteraction["direction"] {
  const lower = role.toLowerCase();
  if (["source", "supply", "sensor", "input"].some((term) => lower.includes(term))) return "input";
  if (["load", "output", "actuator"].some((term) => lower.includes(term))) return "output";
  return "bidirectional";
}

function dimensionOf(predicate: RequirementPredicate): string {
  const value = predicate as unknown as Record<string, unknown>;
  for (const field of ["limit", "value", "min", "max"]) {
    const item = value[field];
    if (item && typeof item === "object" && "dimension" in item) return String((item as { dimension: unknown }).dimension);
  }
  return predicate.form;
}

function requiredModes(requirements: readonly Requirement[]): string[] {
  const modes = new Set<string>();
  for (const requirement of requirements) {
    if (requirement.domain !== "use_case_operating_mode" && requirement.typedPredicate.form !== "temporal_sequence") continue;
    if (requirement.typedPredicate.form === "temporal_sequence") requirement.typedPredicate.states.forEach((state) => modes.add(state));
    requirement.subjectRefsOrRoles.filter((item) => item.toLowerCase().includes("mode")).forEach((item) => modes.add(item.replace(/^mode:/i, "")));
  }
  return [...modes].sort();
}

export interface ArchitectureProblemCompileInput {
  tenantId: string;
  branchId: string;
  requirementsPackage: DesignRequirementsPackage;
}

export function compileArchitectureProblem(input: ArchitectureProblemCompileInput): CompileArchitectureProblemResult {
  const pkg = input.requirementsPackage;
  const diagnostics: ArchitectureDiagnostic[] = [];
  if (!input.tenantId.trim() || !input.branchId.trim()) diagnostics.push(diagnostic("ARCHITECTURE_SCOPE_REQUIRED", "Tenant and branch identities are required."));
  if (!validateDesignRequirementsPackage(pkg)) diagnostics.push(diagnostic("CD1_PACKAGE_INTEGRITY_FAILED", "The CD-1 package failed schema or deterministic digest validation."));
  if (pkg.status !== "accepted_for_architecture_exploration") diagnostics.push(diagnostic("CD1_PACKAGE_NOT_ACCEPTED", `CD-1 package status is '${pkg.status}', not accepted_for_architecture_exploration.`));
  if (pkg.conflicts.some((item) => item.status !== "resolved" && item.severity === "blocking")) diagnostics.push(diagnostic("CD1_BLOCKING_CONFLICT", "The CD-1 package contains unresolved blocking conflicts.", "blocking", pkg.conflicts.flatMap((item) => item.involvedRequirementIds)));
  if (pkg.openQuestions.some((item) => item.status === "open" && ["before_package_acceptance", "before_architecture"].includes(item.blockingLevel))) diagnostics.push(diagnostic("CD1_BLOCKING_QUESTION", "The CD-1 package contains a question that blocks architecture exploration.", "blocking", pkg.openQuestions.flatMap((item) => item.relatedRequirementIds)));
  const unconfirmedHard = pkg.requirements.filter((item) => ["hard", "externally_mandated"].includes(item.strength) && item.status !== "confirmed");
  if (unconfirmedHard.length) diagnostics.push(diagnostic("CD1_HARD_REQUIREMENT_UNCONFIRMED", "Every hard or externally mandated requirement must be confirmed.", "blocking", unconfirmedHard.map((item) => item.requirementId)));
  const unsupportedHard = pkg.requirements.filter((item) => ["hard", "externally_mandated"].includes(item.strength) && item.capabilityAssessment.state === "unsupported");
  if (unsupportedHard.length) diagnostics.push(diagnostic("CD1_HARD_REQUIREMENT_UNSUPPORTED", "An accepted package cannot contain unsupported hard requirements.", "blocking", unsupportedHard.map((item) => item.requirementId)));
  if (!pkg.selectedCapabilityProfileRefs.length || pkg.requirements.some((item) => !pkg.selectedCapabilityProfileRefs.includes(item.capabilityAssessment.profileRef))) diagnostics.push(diagnostic("CD1_CAPABILITY_PROFILE_NOT_EXACT", "Every requirement assessment must reference one of the package's exact selected capability profiles."));
  if (diagnostics.some((item) => item.severity === "blocking" || item.severity === "error")) return { ok: false, diagnostics };

  const requirements: ArchitectureProblemRequirement[] = pkg.requirements.map((item) => ({
    requirementId: item.requirementId, revision: item.revision, statement: item.normalizedStatement, domain: item.domain,
    strength: item.strength, criticality: item.criticality, predicate: structuredClone(item.typedPredicate),
    subjectRoles: [...item.subjectRefsOrRoles].sort(), capabilityAssessment: structuredClone(item.capabilityAssessment),
    verificationObligationRefs: [...item.verificationPlanRefs].sort(), sourceRefs: item.originalSourceRefs.map((source) => `${source.sourceId}@${source.sourceVersion}`).sort(),
  })).sort((left, right) => left.requirementId.localeCompare(right.requirementId));

  const capabilityGroups = new Map<string, string[]>();
  for (const item of pkg.requirements) {
    const role = DOMAIN_CAPABILITIES[item.domain];
    capabilityGroups.set(role, [...(capabilityGroups.get(role) ?? []), item.requirementId]);
  }
  const functionalCapabilities: RequiredFunctionalCapability[] = [...capabilityGroups.entries()].map(([role, refs]) => ({
    capabilityId: architectureId("required-capability", { package: pkg.deterministicDigest, role }), role,
    requirementRefs: [...new Set(refs)].sort(), requiredInteractions: [],
  })).sort((left, right) => left.capabilityId.localeCompare(right.capabilityId));

  const interactionGroups = new Map<string, { role: string; kind: ArchitectureFlowKind | "unspecified"; direction: RequiredExternalInteraction["direction"]; refs: string[]; predicate: RequirementPredicate }>();
  for (const requirement of pkg.requirements) for (const role of requirement.subjectRefsOrRoles) {
    if (!EXTERNAL_ROLE_WORDS.some((word) => role.toLowerCase().includes(word))) continue;
    const key = `${role.toLowerCase()}|${flowKind(requirement)}|${directionForRole(role)}`;
    const existing = interactionGroups.get(key);
    interactionGroups.set(key, { role, kind: flowKind(requirement), direction: directionForRole(role), refs: [...(existing?.refs ?? []), requirement.requirementId], predicate: requirement.typedPredicate });
  }
  const externalInteractions: RequiredExternalInteraction[] = [...interactionGroups.values()].map((item) => ({
    interactionId: architectureId("external-interaction", { package: pkg.deterministicDigest, role: item.role, kind: item.kind, direction: item.direction }),
    externalRole: item.role, flowKind: item.kind, direction: item.direction, requirementRefs: [...new Set(item.refs)].sort(), knownContract: structuredClone(item.predicate),
  })).sort((left, right) => left.interactionId.localeCompare(right.interactionId));
  for (const capability of functionalCapabilities) capability.requiredInteractions = externalInteractions.filter((interaction) => interaction.requirementRefs.some((ref) => capability.requirementRefs.includes(ref))).map((interaction) => interaction.interactionId).sort();

  const budgets: ArchitectureBudget[] = pkg.requirements.filter((item) => item.typedPredicate.form === "budget" || item.kind === "budget_allocation").map((item) => ({
    budgetId: architectureId("architecture-budget", { requirement: item.requirementId, revision: item.revision }), dimension: dimensionOf(item.typedPredicate),
    predicate: structuredClone(item.typedPredicate), requirementRefs: [item.requirementId], allocationState: "unallocated" as const,
  })).sort((left, right) => left.budgetId.localeCompare(right.budgetId));

  const acceptedAssumptions = pkg.assumptions.filter((item) => item.status === "accepted_for_exploration" || item.status === "confirmed_as_fact_or_requirement").sort((left, right) => left.assumptionId.localeCompare(right.assumptionId));
  const unresolvedNonBlockingItems = [
    ...pkg.openQuestions.filter((item) => item.status === "open").map((item) => `question:${item.questionId}`),
    ...pkg.feasibilityDiagnostics.filter((item) => item.state === "unknown" || item.state === "external_review_required").map((item) => `feasibility:${item.diagnosticId}`),
  ].sort();
  const base: Omit<ArchitectureProblem, "deterministicDigest"> = {
    schemaVersion: ARCHITECTURE_PROBLEM_SCHEMA_VERSION,
    problemId: architectureId("architecture-problem", { package: pkg.deterministicDigest, branch: input.branchId }), tenantId: input.tenantId,
    projectId: pkg.projectId, branchId: input.branchId,
    requirementsPackageRef: { packageId: pkg.packageId, revision: pkg.revision, digest: pkg.deterministicDigest, status: pkg.status },
    selectedCapabilityProfileRefs: [...pkg.selectedCapabilityProfileRefs].sort(), requirements, functionalCapabilities, externalInteractions, budgets,
    acceptedAssumptions: structuredClone(acceptedAssumptions), verificationObligations: structuredClone(pkg.verificationObligations).sort((left, right) => left.obligationId.localeCompare(right.obligationId)),
    requiredModeVocabulary: requiredModes(pkg.requirements), unresolvedNonBlockingItems, compilerVersion: ARCHITECTURE_COMPILER_VERSION,
  };
  return { ok: true, problem: { ...base, deterministicDigest: architectureDigest(base) }, diagnostics };
}
