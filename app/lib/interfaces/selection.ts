import type { EngineeringActor } from "../engineering/types";
import { interfaceDigest, interfaceId } from "./stable";
import type { InterfaceObjective, InterfacePlanningCandidate, InterfacePlanningDecision } from "./types";

function usable(objective: InterfaceObjective): objective is InterfaceObjective & { rawValue: number } { return objective.rawValue !== null && objective.evidenceState === "pass" && Number.isFinite(objective.rawValue); }
export function interfaceCandidateDominates(left: InterfacePlanningCandidate, right: InterfacePlanningCandidate): boolean {
  const other = new Map(right.objectiveVector.map((item) => [item.objectiveId, item])); let compared = 0; let better = false;
  for (const objective of left.objectiveVector) { const target = other.get(objective.objectiveId); if (!usable(objective) || !target || !usable(target) || objective.direction !== target.direction) continue; compared++; const delta = objective.rawValue - target.rawValue; if (objective.direction === "minimize" ? delta > 0 : delta < 0) return false; if (delta !== 0) better = true; }
  return compared > 0 && better;
}
export function interfaceParetoCandidateIds(candidates: readonly InterfacePlanningCandidate[]): string[] {
  const eligible = candidates.filter((candidate) => !candidate.contractSet.hardGateResults.some((gate) => gate.hard && gate.state !== "pass"));
  return eligible.filter((candidate) => !eligible.some((other) => other.candidateId !== candidate.candidateId && interfaceCandidateDominates(other, candidate))).map((item) => item.candidateId).sort();
}
export function compareInterfaceCandidates(candidates: readonly InterfacePlanningCandidate[]) {
  if (new Set(candidates.map((item) => item.problemDigest)).size > 1) throw new Error("INTERFACE_COMPARISON_PROBLEM_MISMATCH");
  const hardGateSummary = candidates.map((candidate) => ({ candidateId: candidate.candidateId, passed: !candidate.contractSet.hardGateResults.some((gate) => gate.hard && gate.state !== "pass") })).sort((a, b) => a.candidateId.localeCompare(b.candidateId));
  const objectiveVectors = candidates.map((candidate) => ({ candidateId: candidate.candidateId, objectives: structuredClone(candidate.objectiveVector) })).sort((a, b) => a.candidateId.localeCompare(b.candidateId)); const paretoCandidateIds = interfaceParetoCandidateIds(candidates);
  const unknowns = [...new Set(candidates.flatMap((candidate) => candidate.objectiveVector.filter((item) => !usable(item)).map((item) => item.objectiveId)))].sort(); const sensitivitySummary = unknowns.length ? [`Unknown objectives excluded: ${unknowns.join(", ")}.`, "Selection may change when exact part or physical feedback resolves these objectives."] : ["All compared objective values used in ranking are evidence-backed."];
  return { hardGateSummary, objectiveVectors, paretoCandidateIds, sensitivitySummary, deterministicDigest: interfaceDigest({ hardGateSummary, objectiveVectors, paretoCandidateIds, sensitivitySummary }) };
}
export function createInterfacePlanningDecision(input: { candidates: readonly InterfacePlanningCandidate[]; candidateId: string; exactPartAllocationCandidateIds?: string[]; rejectedReasons?: Array<{ candidateId: string; reason: string }>; unresolvedRiskIds: string[]; approver: EngineeringActor; rationale: string; approvedAt: string }): InterfacePlanningDecision {
  if (input.approver.actorKind !== "human" || !["reviewer", "project_admin"].includes(input.approver.role)) throw new Error("INTERFACE_SELECTION_UNAUTHORIZED"); if (input.candidates.length < 2) throw new Error("INTERFACE_SELECTION_ALTERNATIVES_REQUIRED");
  const candidate = input.candidates.find((item) => item.candidateId === input.candidateId); if (!candidate) throw new Error("INTERFACE_SELECTION_CANDIDATE_NOT_FOUND");
  if (candidate.contractSet.hardGateResults.some((gate) => gate.hard && gate.state !== "pass") || !["feasible_at_logical_planning", "feasible_for_exact_part_package"].includes(candidate.feasibilityState)) throw new Error("INTERFACE_SELECTION_HARD_GATE_FAILED");
  const openRisks = candidate.risks.filter((risk) => !["closed", "mitigation_verified"].includes(risk.mitigationState)).map((risk) => risk.riskId); if (openRisks.some((id) => !input.unresolvedRiskIds.includes(id))) throw new Error("INTERFACE_SELECTION_RISK_ACKNOWLEDGEMENT_REQUIRED");
  if (!input.rationale.trim() || !Number.isFinite(Date.parse(input.approvedAt))) throw new Error("INTERFACE_SELECTION_RECORD_INCOMPLETE"); const comparison = compareInterfaceCandidates(input.candidates);
  const allocationIds = input.exactPartAllocationCandidateIds ?? []; if (allocationIds.some((id) => !candidate.exactAllocationCandidates.some((allocation) => allocation.allocationCandidateId === id && allocation.feasibilityState === "feasible_for_exact_part_package"))) throw new Error("INTERFACE_SELECTION_EXACT_ALLOCATION_INVALID");
  const base = { decisionId: interfaceId("interface-selection", { candidate: candidate.deterministicDigest, approver: input.approver.actorId, approvedAt: input.approvedAt }), problemDigest: candidate.problemDigest, candidateId: candidate.candidateId, candidateDigest: candidate.deterministicDigest, candidateIdsCompared: input.candidates.map((item) => item.candidateId).sort(), exactPartAllocationCandidateIds: [...allocationIds].sort(), hardGateSummary: comparison.hardGateSummary, objectiveVectors: comparison.objectiveVectors, paretoCandidateIds: comparison.paretoCandidateIds, sensitivitySummary: comparison.sensitivitySummary, rejectedReasons: structuredClone((input.rejectedReasons ?? []).sort((a, b) => a.candidateId.localeCompare(b.candidateId))), unresolvedRiskIds: [...new Set(input.unresolvedRiskIds)].sort(), approver: structuredClone(input.approver), rationale: input.rationale.trim(), approvalState: "approved" as const, approvedAt: input.approvedAt, invalidationDependencies: [candidate.problemDigest, candidate.deterministicDigest, ...allocationIds].sort() };
  return { ...base, deterministicDigest: interfaceDigest(base) };
}

