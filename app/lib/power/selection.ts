import type { EngineeringActor } from "../engineering/types";
import { powerDigest, powerId } from "./stable";
import type { PowerArchitectureCandidate, PowerObjective, PowerSelectionDecision } from "./types";

function usable(objective: PowerObjective): objective is PowerObjective & { rawValue: number } {
  return objective.rawValue !== null && objective.evidenceState === "pass" && Number.isFinite(objective.rawValue);
}

export function dominates(left: PowerArchitectureCandidate, right: PowerArchitectureCandidate): boolean {
  const rightById = new Map(right.objectiveVector.map((item) => [item.objectiveId, item]));
  let compared = 0; let strictlyBetter = false;
  for (const objective of left.objectiveVector) {
    const other = rightById.get(objective.objectiveId);
    // Unknown evidence is never converted into a favorable score.
    if (!usable(objective) || !other || !usable(other) || objective.direction !== other.direction) continue;
    compared++;
    const delta = objective.rawValue - other.rawValue;
    const worse = objective.direction === "minimize" ? delta > 0 : delta < 0;
    if (worse) return false;
    if (delta !== 0) strictlyBetter = true;
  }
  return compared > 0 && strictlyBetter;
}

export function paretoCandidateIds(candidates: readonly PowerArchitectureCandidate[]): string[] {
  const eligible = candidates.filter((candidate) => !candidate.hardGateResults.some((gate) => gate.hard && ["fail", "unsupported", "external_review_required"].includes(gate.state)));
  return eligible.filter((candidate) => !eligible.some((other) => other.candidateId !== candidate.candidateId && dominates(other, candidate))).map((item) => item.candidateId).sort();
}

export function comparePowerCandidates(candidates: readonly PowerArchitectureCandidate[]): { hardGateSummary: PowerSelectionDecision["hardGateSummary"]; objectiveVectors: PowerSelectionDecision["objectiveVectors"]; paretoCandidateIds: string[]; sensitivitySummary: string[]; deterministicDigest: string } {
  if (new Set(candidates.map((item) => item.problemDigest)).size > 1) throw new Error("POWER_COMPARISON_PROBLEM_MISMATCH");
  const hardGateSummary = candidates.map((candidate) => ({ candidateId: candidate.candidateId, passed: !candidate.hardGateResults.some((gate) => gate.hard && gate.state !== "pass") })).sort((a, b) => a.candidateId.localeCompare(b.candidateId));
  const objectiveVectors = candidates.map((candidate) => ({ candidateId: candidate.candidateId, objectives: structuredClone(candidate.objectiveVector) })).sort((a, b) => a.candidateId.localeCompare(b.candidateId));
  const pareto = paretoCandidateIds(candidates);
  const unknownIds = [...new Set(candidates.flatMap((candidate) => candidate.objectiveVector.filter((item) => !usable(item)).map((item) => item.objectiveId)))].sort();
  const sensitivitySummary = unknownIds.length ? [`Unknown objectives excluded from ranking: ${unknownIds.join(", ")}.`, "Selection may change when downstream evidence resolves unknown objectives."] : ["All compared objective values are evidence-backed at this stage."];
  const base = { hardGateSummary, objectiveVectors, paretoCandidateIds: pareto, sensitivitySummary };
  return { ...base, deterministicDigest: powerDigest(base) };
}

export function createPowerSelectionDecision(input: { candidates: readonly PowerArchitectureCandidate[]; candidateId: string; approver: EngineeringActor; rationale: string; unresolvedRiskIds: string[]; approvedAt: string }): PowerSelectionDecision {
  if (input.approver.actorKind !== "human") throw new Error("AI_POWER_SELECTION_FORBIDDEN");
  if (!['reviewer', 'project_admin'].includes(input.approver.role)) throw new Error("POWER_SELECTION_UNAUTHORIZED");
  if (input.candidates.length < 2) throw new Error("POWER_SELECTION_ALTERNATIVES_REQUIRED");
  const candidate = input.candidates.find((item) => item.candidateId === input.candidateId); if (!candidate) throw new Error("POWER_SELECTION_CANDIDATE_NOT_FOUND");
  if (candidate.hardGateResults.some((gate) => gate.hard && ["fail", "unsupported", "external_review_required"].includes(gate.state))) throw new Error("POWER_SELECTION_HARD_GATE_FAILED");
  const openRisks = candidate.risks.filter((item) => !["closed", "mitigation_verified"].includes(item.mitigationState)).map((item) => item.riskId);
  if (openRisks.some((id) => !input.unresolvedRiskIds.includes(id))) throw new Error("POWER_SELECTION_RISK_ACKNOWLEDGEMENT_REQUIRED");
  if (!input.rationale.trim() || !Number.isFinite(Date.parse(input.approvedAt))) throw new Error("POWER_SELECTION_RECORD_INCOMPLETE");
  const comparison = comparePowerCandidates(input.candidates);
  const base = { decisionId: powerId("power-selection", { candidate: candidate.deterministicDigest, approver: input.approver.actorId, approvedAt: input.approvedAt }), problemDigest: candidate.problemDigest, candidateId: candidate.candidateId, candidateDigest: candidate.deterministicDigest, candidateIdsCompared: input.candidates.map((item) => item.candidateId).sort(), hardGateSummary: comparison.hardGateSummary, objectiveVectors: comparison.objectiveVectors, paretoCandidateIds: comparison.paretoCandidateIds, sensitivitySummary: comparison.sensitivitySummary, unresolvedRiskIds: [...new Set(input.unresolvedRiskIds)].sort(), approver: structuredClone(input.approver), rationale: input.rationale.trim(), approvedAt: input.approvedAt };
  return { ...base, deterministicDigest: powerDigest(base) };
}
