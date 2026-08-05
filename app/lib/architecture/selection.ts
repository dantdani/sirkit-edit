import { architectureDigest, architectureId } from "./stable";
import type { EngineeringActor } from "../engineering/types";
import type { ArchitectureSelectionDecision, SystemArchitectureCandidate } from "./types";

export interface SelectArchitectureInput {
  candidate: SystemArchitectureCandidate;
  approver: EngineeringActor;
  rationale: string;
  consideredCandidateIds: string[];
  acceptedRiskIds: string[];
  unresolvedQuestionIds: string[];
  createdAt: string;
}

export function createArchitectureSelectionDecision(input: SelectArchitectureInput): ArchitectureSelectionDecision {
  if (input.approver.actorKind !== "human") throw new Error("AI_ARCHITECTURE_SELECTION_FORBIDDEN");
  if (!["reviewer", "project_admin"].includes(input.approver.role)) throw new Error("ARCHITECTURE_SELECTION_UNAUTHORIZED");
  if (!["feasible_for_review", "feasible_with_unresolved"].includes(input.candidate.status)) throw new Error("ARCHITECTURE_CANDIDATE_NOT_FEASIBLE");
  if (!input.rationale.trim() || !input.consideredCandidateIds.includes(input.candidate.candidateId)) throw new Error("ARCHITECTURE_SELECTION_RECORD_INCOMPLETE");
  const knownRisks = new Set(input.candidate.risks.map((item) => item.riskId)); const knownQuestions = new Set(input.candidate.architectureQuestions.map((item) => item.questionId));
  if (input.acceptedRiskIds.some((id) => !knownRisks.has(id)) || input.unresolvedQuestionIds.some((id) => !knownQuestions.has(id))) throw new Error("ARCHITECTURE_SELECTION_REFERENCE_INVALID");
  const materialRisks = input.candidate.risks.filter((item) => item.impact === "high" || item.impact === "critical").map((item) => item.riskId);
  if (materialRisks.some((id) => !input.acceptedRiskIds.includes(id))) throw new Error("MATERIAL_ARCHITECTURE_RISK_ACKNOWLEDGEMENT_REQUIRED");
  const openBlocking = input.candidate.architectureQuestions.filter((item) => item.blocking && item.status === "open").map((item) => item.questionId);
  if (openBlocking.some((id) => !input.unresolvedQuestionIds.includes(id))) throw new Error("BLOCKING_ARCHITECTURE_QUESTION_ACKNOWLEDGEMENT_REQUIRED");
  const base = { decisionId: architectureId("architecture-selection", { candidate: input.candidate.deterministicDigest, approver: input.approver.actorId, at: input.createdAt }), candidateId: input.candidate.candidateId, candidateDigest: input.candidate.deterministicDigest, problemDigest: input.candidate.provenance.problemDigest, approver: structuredClone(input.approver), rationale: input.rationale.trim(), consideredCandidateIds: [...new Set(input.consideredCandidateIds)].sort(), acceptedRisks: [...new Set(input.acceptedRiskIds)].sort(), unresolvedQuestionIds: [...new Set(input.unresolvedQuestionIds)].sort(), createdAt: input.createdAt };
  return { ...base, deterministicDigest: architectureDigest(base) };
}
