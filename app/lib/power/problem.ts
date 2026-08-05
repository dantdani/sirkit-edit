import { compareQuantities } from "../constraints/quantity";
import type { ConstraintQuantity } from "../constraints/types";
import { validateArchitectureProjectState } from "../architecture/project";
import type { ArchitectureBlock, SystemArchitectureCandidate } from "../architecture/types";
import { validateDesignRequirementsPackage } from "../requirements/validation";
import type { Requirement, RequirementPredicate } from "../requirements/types";
import { validatePowerCapabilityProfile, validateUpstreamCompletionSignoff } from "./capability";
import { powerDigest, powerId } from "./stable";
import { voltageCurrentPower } from "./quantity";
import type { LoadOperatingPoint, LoadProfile, PowerDiagnostic, PowerProblemCompileInput, PowerProblemCompileResult, PowerQuantityRange, PowerScenario, PowerSourceEnvelope } from "./types";
import { POWER_COMPILER_VERSION, POWER_PROBLEM_SCHEMA_VERSION } from "./types";

function diagnostic(code: string, message: string, severity: PowerDiagnostic["severity"], blocks: PowerDiagnostic["blocks"], objectRefs: string[] = [], requirementRefs: string[] = [], nextAction = "Provide the missing authoritative input and compile a new pinned problem."): PowerDiagnostic {
  return { diagnosticId: powerId("power-diagnostic", { code, message, objectRefs, requirementRefs }), code, severity, message, objectRefs: [...objectRefs].sort(), requirementRefs: [...requirementRefs].sort(), blocks, derivation: "Deterministic CD-3 prerequisite/problem compiler", nextAction, staleDependencyKeys: [...objectRefs, ...requirementRefs].sort() };
}

function quantityRange(predicate: RequirementPredicate, basis: PowerQuantityRange["basis"], requirementId: string): PowerQuantityRange | null {
  let min: ConstraintQuantity | undefined; let max: ConstraintQuantity | undefined;
  if (predicate.form === "range") { min = predicate.min; max = predicate.max; }
  else if (predicate.form === "equals" && typeof predicate.value === "object" && "dimension" in predicate.value) min = max = predicate.value;
  else if (predicate.form === "target") { min = predicate.value; max = predicate.value; }
  else if (predicate.form === "maximum") { min = { ...predicate.value, value: "0" }; max = predicate.value; }
  else if (predicate.form === "budget" && "dimension" in predicate.limit) { min = { ...predicate.limit, value: "0" }; max = predicate.limit; }
  if (!min || !max || min.dimension !== max.dimension) return null;
  try { if (compareQuantities(min, max) > 0) return null; } catch { return null; }
  return { dimension: min.dimension, min: structuredClone(min), max: structuredClone(max), basis, conditionRefs: [], evidenceRefs: [`requirement:${requirementId}`], confidence: basis === "typical" || basis === "assumed" ? "low" : "high" };
}

function basis(requirement: Requirement): PowerQuantityRange["basis"] {
  const text = `${requirement.title} ${requirement.normalizedStatement}`.toLowerCase();
  if (text.includes("typical")) return "typical";
  if (requirement.authority === "ai_proposal" || requirement.authority === "inferred_observation") return "assumed";
  if (requirement.kind === "maximum" || requirement.typedPredicate.form === "maximum" || requirement.typedPredicate.form === "budget") return "guaranteed_maximum";
  if (requirement.kind === "minimum" || requirement.typedPredicate.form === "minimum") return "guaranteed_minimum";
  return "bounded_estimate";
}

function sourceRole(requirement: Requirement): string | null {
  return requirement.subjectRefsOrRoles.find((role) => /source|supply|adapter|usb|battery|power[_-]?input|vin/i.test(role)) ?? null;
}

function sourceKind(role: string): PowerSourceEnvelope["sourceKind"] {
  if (/battery/i.test(role)) return "battery_low_energy"; if (/usb/i.test(role)) return "usb_fixed"; if (/program|debug|test/i.test(role)) return "test_programming_source"; if (/upstream|board/i.test(role)) return "upstream_board_rail"; return "regulated_external_dc";
}

function rangeFor(requirements: readonly Requirement[], dimension: ConstraintQuantity["dimension"]): PowerQuantityRange | null {
  const values = requirements.map((item) => ({ requirement: item, range: quantityRange(item.typedPredicate, basis(item), item.requirementId) })).filter((item): item is { requirement: Requirement; range: PowerQuantityRange } => item.range?.dimension === dimension);
  if (!values.length) return null;
  return structuredClone(values.sort((a, b) => a.requirement.requirementId.localeCompare(b.requirement.requirementId))[0].range);
}

function architectureCandidate(input: PowerProblemCompileInput): SystemArchitectureCandidate | undefined {
  const decision = input.architectureState.selection; if (!decision) return undefined;
  return input.architectureState.candidates.find((item) => item.candidateId === decision.candidateId && item.deterministicDigest === decision.candidateDigest);
}

function demandBlocks(candidate: SystemArchitectureCandidate): ArchitectureBlock[] {
  return candidate.blocks.filter((item) => item.parentBlockId !== null && ["hardware", "firmware", "software"].includes(item.ownerKind) && !/source|supply|battery|external|boundary|connector|operating[_-]?mode|manage[_-]?modes/i.test(item.role));
}

export function validatePowerArchitectureProblem(problem: import("./types").PowerArchitectureProblem): string[] {
  const errors: string[] = [];
  if (problem.schemaVersion !== POWER_PROBLEM_SCHEMA_VERSION || problem.compilerVersion !== POWER_COMPILER_VERSION) errors.push("POWER_PROBLEM_SCHEMA_UNSUPPORTED");
  if (!problem.problemId || !problem.projectId || !problem.branchId || !problem.requirementsPackageRef.digest || !problem.architectureRef.candidateDigest) errors.push("POWER_PROBLEM_IDENTITY_INVALID");
  if (problem.deterministicDigest !== powerDigest({ ...problem, deterministicDigest: undefined })) errors.push("POWER_PROBLEM_DIGEST_MISMATCH");
  return errors.sort();
}

export function compilePowerArchitectureProblem(input: PowerProblemCompileInput): PowerProblemCompileResult {
  const cd1: PowerDiagnostic[] = []; const cd2: PowerDiagnostic[] = []; const cd3: PowerDiagnostic[] = [];
  const pkg = input.requirementsPackage; const architecture = input.architectureState; const signoff = input.upstreamSignoff;
  if (!validateDesignRequirementsPackage(pkg)) cd1.push(diagnostic("CD1_PACKAGE_INTEGRITY_FAILED", "The CD-1 package failed schema or digest validation.", "blocking", "architecture"));
  if (pkg.status !== "accepted_for_architecture_exploration") cd1.push(diagnostic("CD1_PACKAGE_NOT_ACCEPTED", `CD-1 package status '${pkg.status}' is not accepted for architecture exploration.`, "blocking", "architecture"));
  if (signoff.requirementsDigest !== pkg.deterministicDigest || validateUpstreamCompletionSignoff(signoff).length) cd1.push(diagnostic("CD1_COMPLETION_SIGNOFF_INVALID", "A human CD-1 COMPLETE signoff pinned to this exact requirements digest is required.", "blocking", "architecture"));
  if (cd1.length) return { ok: false, verdict: "BLOCKED BY CD-1", diagnostics: cd1 };
  if (!validateArchitectureProjectState(architecture) || architecture.projectId !== pkg.projectId || architecture.branchId !== input.branchId) cd2.push(diagnostic("CD2_PROJECT_STATE_INVALID", "The CD-2 project state is invalid or outside the exact project/branch.", "blocking", "architecture"));
  const selected = architectureCandidate(input); if (!architecture.selection || !selected) cd2.push(diagnostic("CD2_SELECTED_CANDIDATE_REQUIRED", "A current human-selected CD-2 candidate is required.", "blocking", "architecture"));
  if (selected && !["feasible_for_review", "feasible_with_unresolved"].includes(selected.status)) cd2.push(diagnostic("CD2_SELECTED_CANDIDATE_NOT_FEASIBLE", `Selected CD-2 candidate state '${selected.status}' cannot enter CD-3.`, "blocking", "architecture", [selected.candidateId]));
  if (architecture.selection && selected && (signoff.architectureProblemDigest !== architecture.problem.deterministicDigest || signoff.architectureCandidateDigest !== selected.deterministicDigest || signoff.architectureDecisionDigest !== architecture.selection.deterministicDigest || signoff.cd2Verdict !== "CD-2 COMPLETE")) cd2.push(diagnostic("CD2_COMPLETION_SIGNOFF_INVALID", "A human CD-2 COMPLETE signoff must pin the exact architecture problem, candidate, and decision digests.", "blocking", "architecture"));
  if (selected && !selected.modes.length) cd2.push(diagnostic("CD2_OPERATING_MODES_REQUIRED", "The selected architecture has no explicit operating modes for scenario compilation.", "blocking", "architecture", [selected.candidateId]));
  if (cd2.length) return { ok: false, verdict: "BLOCKED BY CD-2", diagnostics: cd2 };
  const profileErrors = validatePowerCapabilityProfile(input.capabilityProfile); if (profileErrors.length) cd3.push(diagnostic("POWER_CAPABILITY_PROFILE_INVALID", profileErrors.join(", "), "blocking", "architecture"));
  const candidate = selected!; const sourceGroups = new Map<string, Requirement[]>();
  for (const requirement of pkg.requirements) { const role = sourceRole(requirement); if (role) sourceGroups.set(role, [...(sourceGroups.get(role) ?? []), requirement]); }
  for (const interaction of architecture.problem.externalInteractions.filter((item) => item.flowKind === "power" || item.flowKind === "energy")) if (!sourceGroups.has(interaction.externalRole)) sourceGroups.set(interaction.externalRole, []);
  const sourceDomainIds = new Map<string, string>();
  const sources: PowerSourceEnvelope[] = [...sourceGroups.entries()].map(([role, requirements]) => {
    const sourceId = powerId("power-source", { problem: architecture.problem.deterministicDigest, role }); const groundReferenceId = powerId("return-domain", { problem: architecture.problem.deterministicDigest, role: `${role}:reference` }); sourceDomainIds.set(role, groundReferenceId);
    const voltageRange = rangeFor(requirements, "voltage"); const continuousCurrentRange = rangeFor(requirements, "current"); const energyCapacityEnvelope = rangeFor(requirements, "energy"); const unknownFieldIds: string[] = [];
    if (!voltageRange) unknownFieldIds.push(`${sourceId}:operating-voltage-range`); if (!continuousCurrentRange && !rangeFor(requirements, "power")) unknownFieldIds.push(`${sourceId}:continuous-current-or-power-limit`);
    return { sourceId, sourceKind: sourceKind(role), boundaryId: powerId("power-boundary", { problem: architecture.problem.deterministicDigest, role }), requirementIds: requirements.map((item) => item.requirementId).sort(), availabilityModeIds: candidate.modes.map((item) => item.modeId), voltageRange, continuousCurrentRange, peakCurrentEnvelope: null, sourceImpedanceEnvelope: null, energyCapacityEnvelope, transientConditionIds: [], reverseCurrentPolicy: "unknown", hotPlugPolicy: /connector|usb|adapter|external/i.test(role) ? "unknown" : "not_applicable", groundReferenceId, externalOwnerRole: role, evidenceState: unknownFieldIds.length ? "unknown" : "not_evaluated", assumptionIds: [], unknownFieldIds, verificationObligationIds: requirements.flatMap((item) => item.verificationPlanRefs).sort() } satisfies PowerSourceEnvelope;
  }).sort((a, b) => a.sourceId.localeCompare(b.sourceId));
  if (!sources.length) cd3.push(diagnostic("POWER_SOURCE_REQUIRED", "No accepted external, stored, upstream, or generated source envelope was found.", "blocking", "architecture"));
  for (const source of sources) if (source.unknownFieldIds.length) cd3.push(diagnostic("POWER_SOURCE_ENVELOPE_INCOMPLETE", `Source ${source.externalOwnerRole ?? source.sourceId} lacks ${source.unknownFieldIds.join(", ")}.`, "blocking", "architecture", [source.sourceId], source.requirementIds));
  for (const source of sources) {
    if (!input.capabilityProfile.supportedSourceKinds.includes(source.sourceKind)) cd3.push(diagnostic("POWER_SOURCE_KIND_UNSUPPORTED", `Source kind '${source.sourceKind}' is outside the pinned capability profile.`, "blocking", "architecture", [source.sourceId], source.requirementIds));
    if (source.voltageRange) { try { if (compareQuantities(source.voltageRange.max, input.capabilityProfile.limits.maximumInputVoltage) > 0) cd3.push(diagnostic("POWER_INPUT_VOLTAGE_UNSUPPORTED", "The source envelope exceeds the pinned low-voltage capability limit.", "blocking", "architecture", [source.sourceId], source.requirementIds)); } catch { cd3.push(diagnostic("POWER_INPUT_VOLTAGE_MODEL_UNSUPPORTED", "The source voltage cannot be compared with the capability envelope.", "blocking", "architecture", [source.sourceId], source.requirementIds)); } }
    if (source.voltageRange && source.continuousCurrentRange) { try { if (compareQuantities(voltageCurrentPower(source.voltageRange, source.continuousCurrentRange).max, input.capabilityProfile.limits.maximumContinuousPower) > 0) cd3.push(diagnostic("POWER_CONTINUOUS_POWER_UNSUPPORTED", "The source envelope exceeds the pinned continuous-power capability limit.", "blocking", "architecture", [source.sourceId], source.requirementIds)); } catch { cd3.push(diagnostic("POWER_CONTINUOUS_POWER_MODEL_UNSUPPORTED", "The source power envelope cannot be evaluated by this profile.", "blocking", "architecture", [source.sourceId], source.requirementIds)); } }
    if (source.sourceKind === "battery_low_energy" && !source.energyCapacityEnvelope) cd3.push(diagnostic("POWER_BATTERY_ENERGY_CAPACITY_REQUIRED", "A battery source requires an accepted energy-capacity envelope before runtime architecture can be evaluated.", "blocking", "architecture", [source.sourceId], source.requirementIds));
  }
  if (sources.length > input.capabilityProfile.limits.maximumSources) cd3.push(diagnostic("POWER_SOURCE_LIMIT_EXCEEDED", "Source count exceeds the capability profile limit.", "blocking", "architecture", sources.map((item) => item.sourceId)));
  const blocks = demandBlocks(candidate); const demands = blocks.map((block) => {
    const requirements = pkg.requirements.filter((item) => block.requirementRefs.includes(item.requirementId) && !sourceRole(item)); const railRequirement = rangeFor(requirements, "voltage"); const demandId = powerId("power-demand", { candidate: candidate.deterministicDigest, block: block.blockId });
    const returnRequirement = /analog|measure|sensor|reference/i.test(block.role) ? "sensitive_reference_return" as const : /motor|actuator|switch|power/i.test(block.role) ? "power_switching_return" as const : "circuit_return" as const;
    return { demandId, architectureBlockId: block.blockId, abstractPinGroupRole: `${block.role}:power-input-group`, railRequirement, returnRequirement, loadProfileId: powerId("load-profile", demandId), modeApplicability: candidate.modes.map((item) => item.modeId), requiredAvailability: "mode_scoped" as const, powerStateOwner: block.ownerKind === "firmware" || block.ownerKind === "software" ? "firmware" as const : "hardware" as const, partialPowerPolicy: "unknown" as const, backPowerSensitivity: "unknown" as const, requirementIds: requirements.map((item) => item.requirementId), downstreamExpansionObligationIds: [powerId("powered-pin-expansion-obligation", { demandId, stage: "CD-6/CD-8" })] };
  }).sort((a, b) => a.demandId.localeCompare(b.demandId));
  if (!demands.length) cd3.push(diagnostic("POWER_DEMAND_REQUIRED", "No internal CD-2 powered role was identified; vacuous powered-pin closure is forbidden.", "blocking", "architecture"));
  for (const demand of demands.filter((item) => !item.railRequirement)) cd3.push(diagnostic("POWER_DEMAND_VOLTAGE_REQUIREMENT_MISSING", "A powered architecture role has no operating rail-voltage contract.", "blocking", "architecture", [demand.demandId], demand.requirementIds));
  if (demands.length > input.capabilityProfile.limits.maximumDemands) cd3.push(diagnostic("POWER_DEMAND_LIMIT_EXCEEDED", "Demand count exceeds the capability profile limit.", "blocking", "architecture"));
  const loadProfiles: LoadProfile[] = demands.map((demand) => {
    const requirements = pkg.requirements.filter((item) => demand.requirementIds.includes(item.requirementId)); const current = rangeFor(requirements, "current"); const power = rangeFor(requirements, "power"); const points: LoadOperatingPoint[] = [{ operatingPointId: powerId("load-point", { demand: demand.demandId, class: current || power ? "steady" : "unknown" }), demandClass: current || power ? "steady_bounded" : "unknown", currentRange: current, powerRange: power, energyRange: rangeFor(requirements, "energy"), voltageRange: demand.railRequirement, modeIds: demand.modeApplicability, uncertaintyDrivers: current || power ? [] : ["bounded maximum load is missing"] }];
    return { loadProfileId: demand.loadProfileId, demandClass: points[0].demandClass, operatingPointRecords: points, concurrencyGroupIds: [], correlationPolicy: "unknown", measurementOrEstimateMethod: current || power ? "accepted CD-1 quantity" : "not available", uncertaintyModel: current || power ? "source range" : "blocking unknown", unknownFieldIds: current || power ? [] : [`${demand.demandId}:bounded-maximum-load`] };
  });
  for (const profile of loadProfiles.filter((item) => item.unknownFieldIds.length)) cd3.push(diagnostic("POWER_LOAD_ENVELOPE_INCOMPLETE", `Load profile ${profile.loadProfileId} has no bounded maximum current or power. Typical or absent data cannot pass a hard budget.`, "blocking", "architecture", [profile.loadProfileId]));
  const scenarios: PowerScenario[] = candidate.modes.map((mode) => ({ scenarioId: powerId("power-scenario", { candidate: candidate.deterministicDigest, mode: mode.modeId }), modeId: mode.modeId, triggeringEvents: [], activeDemandIds: demands.filter((item) => item.modeApplicability.includes(mode.modeId)).map((item) => item.demandId), inactiveDemandIds: [], optionalDemandIds: [], concurrencyConstraints: demands.length > 1 ? [{ constraintId: powerId("concurrency", { mode: mode.modeId, kind: "unknown" }), kind: "unknown", demandIds: demands.map((item) => item.demandId), source: "scenario_policy", requirementIds: [] }] : [], environmentConditionRefs: [], sourceAvailabilityIds: sources.filter((item) => item.availabilityModeIds.includes(mode.modeId)).map((item) => item.sourceId), variantConditionRefs: [], requirementIds: mode.requirementRefs, assumptionIds: [], unknownConcurrencyPolicy: "conservative_overlap" }));
  if (scenarios.length > input.capabilityProfile.limits.maximumScenarios) cd3.push(diagnostic("POWER_SCENARIO_LIMIT_EXCEEDED", "Scenario count exceeds the capability profile limit.", "blocking", "architecture"));
  if (cd3.some((item) => item.severity === "blocking")) return { ok: false, verdict: "CD-3 INCOMPLETE", diagnostics: cd3.sort((a, b) => a.code.localeCompare(b.code) || a.diagnosticId.localeCompare(b.diagnosticId)) };
  const downstreamPoweredPinClosureObligationId = powerId("powered-pin-closure", { candidate: candidate.deterministicDigest, stages: ["CD-6", "CD-8"] });
  const base: Omit<import("./types").PowerArchitectureProblem, "deterministicDigest"> = { schemaVersion: POWER_PROBLEM_SCHEMA_VERSION, problemId: powerId("power-problem", { requirements: pkg.deterministicDigest, architecture: candidate.deterministicDigest, decision: architecture.selection!.deterministicDigest, profile: input.capabilityProfile.deterministicDigest, policy: input.policyProfileRevision, rules: input.ruleModelRegistryRevision }), tenantId: input.tenantId, projectId: pkg.projectId, branchId: input.branchId, requirementsPackageRef: { packageId: pkg.packageId, revision: pkg.revision, digest: pkg.deterministicDigest, status: pkg.status }, architectureRef: { problemDigest: architecture.problem.deterministicDigest, candidateId: candidate.candidateId, candidateRevision: candidate.revision, candidateDigest: candidate.deterministicDigest, decisionDigest: architecture.selection!.deterministicDigest }, upstreamSignoffDigest: signoff.deterministicDigest, capabilityProfileRef: `${input.capabilityProfile.profileId}@${input.capabilityProfile.version}:${input.capabilityProfile.deterministicDigest}`, policyProfileRevision: input.policyProfileRevision, ruleModelRegistryRevision: input.ruleModelRegistryRevision, requirements: pkg.requirements.map((item) => ({ requirementId: item.requirementId, revision: item.revision, strength: item.strength, domain: item.domain })).sort((a, b) => a.requirementId.localeCompare(b.requirementId)), sources, demands, loadProfiles, scenarios, operatingModeIds: candidate.modes.map((item) => item.modeId), externalBoundaryIds: sources.map((item) => item.boundaryId), architectureIsolationBoundaryIds: candidate.boundaries.filter((item) => item.kind === "isolation").map((item) => item.boundaryId), architectureRiskIds: candidate.risks.map((item) => item.riskId), activeAssumptionIds: pkg.assumptions.filter((item) => item.status === "accepted_for_exploration" || item.status === "confirmed_as_fact_or_requirement").map((item) => item.assumptionId), blockingUnknownIds: [], downstreamPoweredPinClosureObligationId, diagnostics: cd3, compilerVersion: POWER_COMPILER_VERSION, createdBy: structuredClone(input.actor), createdAt: input.createdAt };
  return { ok: true, problem: { ...base, deterministicDigest: powerDigest({ ...base, deterministicDigest: undefined }) }, diagnostics: cd3 };
}
