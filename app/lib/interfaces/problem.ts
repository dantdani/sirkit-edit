import { validateArchitectureProjectState } from "../architecture/project";
import type { SystemArchitectureCandidate } from "../architecture/types";
import { validatePowerProjectState } from "../power/project";
import type { PowerArchitectureCandidate } from "../power/types";
import { validateDesignRequirementsPackage } from "../requirements/validation";
import { validateCd4UpstreamCompletionSignoff, validateInterfaceCapabilityProfile } from "./capability";
import { interfaceDigest, interfaceId } from "./stable";
import type { InterfaceDiagnostic, InterfacePlanningProblem, InterfaceProblemCompileInput, InterfaceProblemCompileResult } from "./types";
import { INTERFACE_COMPILER_VERSION, INTERFACE_PROBLEM_SCHEMA_VERSION } from "./types";

function diagnostic(code: string, message: string, severity: InterfaceDiagnostic["severity"], blocks: InterfaceDiagnostic["blocks"], objectRefs: string[] = [], requirementRefs: string[] = [], nextAction = "Provide the missing authoritative input and compile a new immutable CD-4 problem."): InterfaceDiagnostic {
  return { diagnosticId: interfaceId("interface-diagnostic", { code, message, objectRefs, requirementRefs }), code, severity, message, objectRefs: [...new Set(objectRefs)].sort(), requirementRefs: [...new Set(requirementRefs)].sort(), blocks, derivation: "Deterministic CD-4 prerequisite and problem compiler", nextAction, staleDependencyKeys: [...new Set([...objectRefs, ...requirementRefs])].sort() };
}

function selectedArchitecture(input: InterfaceProblemCompileInput): SystemArchitectureCandidate | undefined {
  const selection = input.architectureState.selection;
  return selection ? input.architectureState.candidates.find((candidate) => candidate.candidateId === selection.candidateId && candidate.deterministicDigest === selection.candidateDigest) : undefined;
}

function selectedPower(input: InterfaceProblemCompileInput): PowerArchitectureCandidate | undefined {
  const selection = input.powerState.selection;
  return selection ? input.powerState.candidates.find((candidate) => candidate.candidateId === selection.candidateId && candidate.deterministicDigest === selection.candidateDigest) : undefined;
}

export function validateInterfacePlanningProblem(problem: InterfacePlanningProblem): string[] {
  const errors: string[] = [];
  if (problem.schemaVersion !== INTERFACE_PROBLEM_SCHEMA_VERSION) errors.push("INTERFACE_PROBLEM_SCHEMA_UNSUPPORTED");
  if (!problem.problemId || !problem.projectId || !problem.branchId || !problem.requirementsPackageRevision.digest || !problem.systemArchitectureCandidateRevision.candidateDigest || !problem.powerArchitectureCandidateRevision.candidateDigest) errors.push("INTERFACE_PROBLEM_IDENTITY_INVALID");
  if (!problem.policyRuleRegistryRevision || !problem.capabilityProfileRevision) errors.push("INTERFACE_PROBLEM_RULE_SNAPSHOT_MISSING");
  if (problem.deterministicDigest !== interfaceDigest({ ...problem, deterministicDigest: undefined })) errors.push("INTERFACE_PROBLEM_DIGEST_MISMATCH");
  if (new Set(problem.architectureEndpointIds).size !== problem.architectureEndpointIds.length || new Set(problem.interfaceObligationIds).size !== problem.interfaceObligationIds.length) errors.push("INTERFACE_PROBLEM_ID_REUSE");
  return errors.sort();
}

export function compileInterfacePlanningProblem(input: InterfaceProblemCompileInput): InterfaceProblemCompileResult {
  const cd1: InterfaceDiagnostic[] = []; const cd2: InterfaceDiagnostic[] = []; const cd3: InterfaceDiagnostic[] = []; const cd4: InterfaceDiagnostic[] = [];
  const requirements = input.requirementsPackage; const architectureState = input.architectureState; const powerState = input.powerState; const signoff = input.upstreamSignoff;
  if (!validateDesignRequirementsPackage(requirements)) cd1.push(diagnostic("CD1_PACKAGE_INTEGRITY_FAILED", "The CD-1 requirements package failed schema or digest validation.", "blocking", "logical_planning"));
  if (requirements.status !== "accepted_for_architecture_exploration") cd1.push(diagnostic("CD1_PACKAGE_NOT_ACCEPTED", `CD-1 package status '${requirements.status}' is not accepted.`, "blocking", "logical_planning"));
  if (signoff.requirementsDigest !== requirements.deterministicDigest || validateCd4UpstreamCompletionSignoff(signoff).length) cd1.push(diagnostic("CD1_COMPLETION_SIGNOFF_INVALID", "CD-4 requires a human CD-1 COMPLETE signoff pinned to this exact requirements digest.", "blocking", "logical_planning"));
  if (cd1.length) return { ok: false, verdict: "BLOCKED BY CD-1", diagnostics: cd1 };

  if (!validateArchitectureProjectState(architectureState) || architectureState.projectId !== requirements.projectId || architectureState.branchId !== input.branchId) cd2.push(diagnostic("CD2_PROJECT_STATE_INVALID", "The CD-2 state is invalid or outside the exact project and branch.", "blocking", "logical_planning"));
  const architecture = selectedArchitecture(input);
  if (!architectureState.selection || !architecture) cd2.push(diagnostic("CD2_SELECTED_CANDIDATE_REQUIRED", "A current human-selected CD-2 architecture is required.", "blocking", "logical_planning"));
  if (architectureState.selection?.approver.actorKind !== "human") cd2.push(diagnostic("CD2_HUMAN_SELECTION_REQUIRED", "The CD-2 selection was not approved by a human.", "blocking", "logical_planning"));
  if (architecture && !["feasible_for_review", "selected"].includes(architecture.status)) cd2.push(diagnostic("CD2_SELECTED_CANDIDATE_INCOMPLETE", `Selected CD-2 candidate status '${architecture.status}' is not complete for CD-4.`, "blocking", "logical_planning", [architecture.candidateId]));
  if (architectureState.selection && architecture && (signoff.architectureProblemDigest !== architectureState.problem.deterministicDigest || signoff.architectureCandidateDigest !== architecture.deterministicDigest || signoff.architectureDecisionDigest !== architectureState.selection.deterministicDigest)) cd2.push(diagnostic("CD2_DIGEST_CHAIN_MISMATCH", "The CD-2 problem, candidate, or human decision changed after upstream signoff.", "blocking", "logical_planning"));
  if (cd2.length) return { ok: false, verdict: "BLOCKED BY CD-2", diagnostics: cd2 };

  if (!validatePowerProjectState(powerState) || powerState.projectId !== requirements.projectId || powerState.branchId !== input.branchId) cd3.push(diagnostic("CD3_PROJECT_STATE_INVALID", "The CD-3 state is invalid or outside the exact project and branch.", "blocking", "logical_planning"));
  const power = selectedPower(input);
  if (!powerState.selection || !power) cd3.push(diagnostic("CD3_SELECTED_CANDIDATE_REQUIRED", "A current human-selected CD-3 power architecture is required.", "blocking", "logical_planning"));
  if (powerState.selection?.approver.actorKind !== "human") cd3.push(diagnostic("CD3_HUMAN_SELECTION_REQUIRED", "The CD-3 selection was not approved by a human.", "blocking", "logical_planning"));
  if (power && power.feasibilityState !== "feasible_at_architecture_level") cd3.push(diagnostic("CD3_SELECTED_CANDIDATE_INCOMPLETE", `Selected CD-3 candidate state '${power.feasibilityState}' is not complete at architecture resolution.`, "blocking", "logical_planning", [power.candidateId]));
  if (powerState.selection && power && (signoff.powerProblemDigest !== powerState.problem.deterministicDigest || signoff.powerCandidateDigest !== power.deterministicDigest || signoff.powerDecisionDigest !== powerState.selection.deterministicDigest)) cd3.push(diagnostic("CD3_DIGEST_CHAIN_MISMATCH", "The CD-3 problem, candidate, or human decision changed after upstream signoff.", "blocking", "logical_planning"));
  if (power && !power.handoffs.some((handoff) => handoff.targetStage === "CD-4")) cd3.push(diagnostic("CD3_INTERFACE_HANDOFF_REQUIRED", "The selected CD-3 candidate has no typed CD-4 interface/reset/boot handoff.", "blocking", "logical_planning", [power.candidateId]));
  if (cd3.length) return { ok: false, verdict: "BLOCKED BY CD-3", diagnostics: cd3 };

  const profileErrors = validateInterfaceCapabilityProfile(input.capabilityProfile);
  if (profileErrors.length) cd4.push(diagnostic("INTERFACE_CAPABILITY_PROFILE_INVALID", profileErrors.join(", "), "blocking", "logical_planning"));
  if (!architecture!.flows.length) cd4.push(diagnostic("INTERFACE_REQUIRED_FLOW_MISSING", "The selected architecture has no explicit flow to compile into endpoint contracts.", "blocking", "logical_planning", [architecture!.candidateId]));
  const portIds = new Set(architecture!.ports.map((port) => port.portId));
  for (const flow of architecture!.flows) {
    if (!portIds.has(flow.producerPortId) || flow.consumerPortIds.some((id) => !portIds.has(id))) cd4.push(diagnostic("INTERFACE_FLOW_ENDPOINT_REFERENCE_INVALID", `Flow '${flow.flowId}' references a missing architecture port.`, "blocking", "logical_planning", [flow.flowId, flow.producerPortId, ...flow.consumerPortIds], flow.requirementRefs));
    if (!flow.consumerPortIds.length) cd4.push(diagnostic("INTERFACE_FLOW_CONSUMER_REQUIRED", `Flow '${flow.flowId}' has no explicit consumer endpoint.`, "blocking", "logical_planning", [flow.flowId], flow.requirementRefs));
  }
  if (architecture!.flows.length > input.capabilityProfile.limits.maximumInterfaces || architecture!.ports.length > input.capabilityProfile.limits.maximumEndpoints) cd4.push(diagnostic("INTERFACE_PROFILE_SCALE_LIMIT_EXCEEDED", "Architecture flow or endpoint count exceeds the pinned capability profile.", "blocking", "logical_planning"));
  if (cd4.some((item) => item.severity === "blocking")) return { ok: false, verdict: "CD-4 INCOMPLETE", diagnostics: cd4.sort((a, b) => a.code.localeCompare(b.code)) };

  const interfaceObligationIds = [...new Set([...architecture!.downstreamObligations.filter((item) => item.targetStage === "CD-4").map((item) => item.obligationId), ...power!.handoffs.filter((item) => item.targetStage === "CD-4").map((item) => item.obligationId)])].sort();
  const endpointIds = architecture!.ports.map((port) => port.portId).sort();
  const voltageDomainIds = [...new Set([...architecture!.domains.map((domain) => domain.domainId), ...power!.rails.map((rail) => rail.railId)])].sort();
  const dependencyIds = [...new Set([...power!.sequenceMachines.flatMap((machine) => [machine.machineId, ...machine.railDependencyEdges.map((edge) => `${edge.fromRailId}->${edge.toRailId}:${edge.relation}`)]), ...architecture!.flows.filter((flow) => ["clock", "reset"].includes(flow.flowKind)).map((flow) => flow.flowId)])].sort();
  const unknowns = [...new Set([...architecture!.architectureQuestions.filter((question) => question.status === "open").map((question) => question.questionId), ...power!.risks.filter((risk) => !["closed", "mitigation_verified"].includes(risk.mitigationState)).map((risk) => risk.riskId)])].sort();
  const base: Omit<InterfacePlanningProblem, "deterministicDigest"> = {
    schemaVersion: INTERFACE_PROBLEM_SCHEMA_VERSION,
    problemId: interfaceId("interface-problem", { requirements: requirements.deterministicDigest, architecture: architecture!.deterministicDigest, power: power!.deterministicDigest, profile: input.capabilityProfile.deterministicDigest, policy: input.policyRuleRegistryRevision, facts: input.componentFactSnapshotRevision ?? null }),
    tenantId: input.tenantId, projectId: requirements.projectId, branchId: input.branchId,
    requirementsPackageRevision: { packageId: requirements.packageId, revision: requirements.revision, digest: requirements.deterministicDigest },
    systemArchitectureCandidateRevision: { candidateId: architecture!.candidateId, revision: architecture!.revision, problemDigest: architectureState.problem.deterministicDigest, candidateDigest: architecture!.deterministicDigest, decisionDigest: architectureState.selection!.deterministicDigest },
    powerArchitectureCandidateRevision: { candidateId: power!.candidateId, revision: power!.revision, problemDigest: powerState.problem.deterministicDigest, candidateDigest: power!.deterministicDigest, decisionDigest: powerState.selection!.deterministicDigest },
    upstreamSignoffDigest: signoff.deterministicDigest,
    capabilityProfileRevision: `${input.capabilityProfile.profileId}@${input.capabilityProfile.version}:${input.capabilityProfile.deterministicDigest}`,
    interfaceObligationIds, architectureEndpointIds: endpointIds, architectureFlowIds: architecture!.flows.map((flow) => flow.flowId).sort(), operatingModeIds: architecture!.modes.map((mode) => mode.modeId).sort(), voltageDomainIds, clockResetPowerDependencyIds: dependencyIds, externalBoundaryIds: [...new Set([...architecture!.boundaries.filter((boundary) => boundary.kind === "isolation" || boundary.kind === "protection").map((boundary) => boundary.boundaryId), ...architectureState.problem.externalInteractions.map((interaction) => interaction.interactionId)])].sort(), activeAssumptionIds: [...new Set([...architecture!.assumptions, ...powerState.problem.activeAssumptionIds])].sort(), blockingUnknownIds: unknowns, policyRuleRegistryRevision: input.policyRuleRegistryRevision, componentFactSnapshotRevision: input.componentFactSnapshotRevision, diagnostics: cd4, createdBy: structuredClone(input.actor), createdAt: input.createdAt,
  };
  return { ok: true, problem: { ...base, deterministicDigest: interfaceDigest({ ...base, deterministicDigest: undefined }) }, diagnostics: cd4 };
}

export const INTERFACE_PROBLEM_COMPILER_VERSION = INTERFACE_COMPILER_VERSION;
