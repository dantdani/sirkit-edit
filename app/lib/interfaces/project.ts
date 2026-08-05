import { validateCd4UpstreamCompletionSignoff } from "./capability";
import { validateInterfacePlanningCandidate } from "./compiler";
import { validateInterfacePlanningProblem } from "./problem";
import { interfaceDigest } from "./stable";
import type { InterfacePlanningDecision, InterfaceProjectState } from "./types";
import { INTERFACE_SCHEMA_VERSION } from "./types";

export function validateInterfacePlanningDecision(decision: InterfacePlanningDecision): string[] {
  const errors: string[] = [];
  if (decision.approver.actorKind !== "human" || !["reviewer", "project_admin"].includes(decision.approver.role) || !decision.rationale.trim() || !Number.isFinite(Date.parse(decision.approvedAt))) errors.push("INTERFACE_SELECTION_AUTHORITY_INVALID");
  if (decision.approvalState !== "approved" || decision.deterministicDigest !== interfaceDigest({ ...decision, deterministicDigest: undefined })) errors.push("INTERFACE_SELECTION_INTEGRITY_INVALID");
  if (!decision.candidateIdsCompared.includes(decision.candidateId) || decision.candidateIdsCompared.length < 2) errors.push("INTERFACE_SELECTION_COMPARISON_INCOMPLETE");
  return errors.sort();
}

export function createInterfaceProjectState(input: Omit<InterfaceProjectState, "schemaVersion" | "deterministicDigest" | "transactionRecords"> & { transactionRecords?: InterfaceProjectState["transactionRecords"] }): InterfaceProjectState {
  if (input.problem.projectId !== input.projectId || input.problem.branchId !== input.branchId) throw new Error("INTERFACE_PROJECT_SCOPE_MISMATCH");
  const base = { schemaVersion: INTERFACE_SCHEMA_VERSION, projectId: input.projectId, branchId: input.branchId, upstreamSignoff: structuredClone(input.upstreamSignoff), problem: structuredClone(input.problem), candidates: structuredClone([...input.candidates].sort((a, b) => a.candidateId.localeCompare(b.candidateId))), selection: structuredClone(input.selection), transactionRecords: structuredClone(input.transactionRecords ?? []) };
  return { ...base, deterministicDigest: interfaceDigest({ ...base, deterministicDigest: undefined }) };
}

export function validateInterfaceProjectState(value: unknown): value is InterfaceProjectState {
  if (!value || typeof value !== "object") return false; const state = value as InterfaceProjectState;
  if (state.schemaVersion !== INTERFACE_SCHEMA_VERSION || !state.projectId || !state.branchId || state.problem.projectId !== state.projectId || state.problem.branchId !== state.branchId) return false;
  if (validateCd4UpstreamCompletionSignoff(state.upstreamSignoff).length || validateInterfacePlanningProblem(state.problem).length || state.problem.upstreamSignoffDigest !== state.upstreamSignoff.deterministicDigest) return false;
  if (state.upstreamSignoff.requirementsDigest !== state.problem.requirementsPackageRevision.digest || state.upstreamSignoff.architectureCandidateDigest !== state.problem.systemArchitectureCandidateRevision.candidateDigest || state.upstreamSignoff.architectureDecisionDigest !== state.problem.systemArchitectureCandidateRevision.decisionDigest || state.upstreamSignoff.powerCandidateDigest !== state.problem.powerArchitectureCandidateRevision.candidateDigest || state.upstreamSignoff.powerDecisionDigest !== state.problem.powerArchitectureCandidateRevision.decisionDigest) return false;
  if (!Array.isArray(state.candidates) || state.candidates.some((item) => validateInterfacePlanningCandidate(item, state.problem).length) || new Set(state.candidates.map((item) => item.candidateId)).size !== state.candidates.length || new Set(state.candidates.map((item) => item.structuralSignature)).size !== state.candidates.length) return false;
  if (state.selection && (validateInterfacePlanningDecision(state.selection).length || !state.candidates.some((item) => item.candidateId === state.selection!.candidateId && item.deterministicDigest === state.selection!.candidateDigest))) return false;
  if (!Array.isArray(state.transactionRecords) || new Set(state.transactionRecords.map((item) => item.transaction.transactionId)).size !== state.transactionRecords.length || new Set(state.transactionRecords.map((item) => item.transaction.idempotencyKey)).size !== state.transactionRecords.length) return false;
  let previous: string | null = null; for (const record of state.transactionRecords) { if (record.transaction.projectId !== state.projectId || record.transaction.branchId !== state.branchId || record.transaction.deterministicDigest !== interfaceDigest({ ...record.transaction, deterministicDigest: undefined })) return false; const { integrityDigest, ...base } = record; if (integrityDigest !== interfaceDigest({ ...base, previous })) return false; previous = integrityDigest; }
  return state.deterministicDigest === interfaceDigest({ ...state, deterministicDigest: undefined });
}

