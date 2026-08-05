import { validatePowerArchitectureCandidate } from "./compiler";
import { validateUpstreamCompletionSignoff } from "./capability";
import { validatePowerArchitectureProblem } from "./problem";
import { powerDigest } from "./stable";
import type { PowerProjectState, PowerSelectionDecision } from "./types";
import { POWER_SCHEMA_VERSION } from "./types";

export function createPowerProjectState(input: Omit<PowerProjectState, "schemaVersion" | "deterministicDigest" | "transactionRecords"> & { transactionRecords?: PowerProjectState["transactionRecords"] }): PowerProjectState {
  if (input.problem.projectId !== input.projectId || input.problem.branchId !== input.branchId) throw new Error("POWER_PROJECT_SCOPE_MISMATCH");
  const base = { schemaVersion: POWER_SCHEMA_VERSION, projectId: input.projectId, branchId: input.branchId, upstreamSignoff: structuredClone(input.upstreamSignoff), problem: structuredClone(input.problem), candidates: structuredClone([...input.candidates].sort((a, b) => a.candidateId.localeCompare(b.candidateId))), selection: structuredClone(input.selection), transactionRecords: structuredClone(input.transactionRecords ?? []) };
  return { ...base, deterministicDigest: powerDigest({ ...base, deterministicDigest: undefined }) };
}

export function validatePowerSelectionDecision(decision: PowerSelectionDecision): string[] {
  const errors: string[] = [];
  if (decision.approver.actorKind !== "human" || !decision.rationale.trim() || !Number.isFinite(Date.parse(decision.approvedAt))) errors.push("POWER_SELECTION_AUTHORITY_INVALID");
  if (decision.deterministicDigest !== powerDigest({ ...decision, deterministicDigest: undefined })) errors.push("POWER_SELECTION_DIGEST_MISMATCH");
  if (!decision.candidateIdsCompared.includes(decision.candidateId)) errors.push("POWER_SELECTION_COMPARISON_INCOMPLETE");
  return errors.sort();
}

export function validatePowerProjectState(value: unknown): value is PowerProjectState {
  if (!value || typeof value !== "object") return false; const state = value as PowerProjectState;
  if (state.schemaVersion !== POWER_SCHEMA_VERSION || !state.projectId || !state.branchId || state.problem.projectId !== state.projectId || state.problem.branchId !== state.branchId) return false;
  if (!Array.isArray(state.candidates) || !Array.isArray(state.transactionRecords) || validatePowerArchitectureProblem(state.problem).length || state.candidates.some((item) => validatePowerArchitectureCandidate(item, state.problem).length)) return false;
  if (validateUpstreamCompletionSignoff(state.upstreamSignoff).length || state.upstreamSignoff.deterministicDigest !== state.problem.upstreamSignoffDigest || state.upstreamSignoff.requirementsDigest !== state.problem.requirementsPackageRef.digest || state.upstreamSignoff.architectureCandidateDigest !== state.problem.architectureRef.candidateDigest || state.upstreamSignoff.architectureDecisionDigest !== state.problem.architectureRef.decisionDigest) return false;
  if (new Set(state.candidates.map((item) => item.candidateId)).size !== state.candidates.length || new Set(state.candidates.map((item) => item.structuralSignature)).size !== state.candidates.length) return false;
  if (state.selection && (validatePowerSelectionDecision(state.selection).length || !state.candidates.some((item) => item.candidateId === state.selection!.candidateId && item.deterministicDigest === state.selection!.candidateDigest))) return false;
  if (new Set(state.transactionRecords.map((item) => item.transaction.transactionId)).size !== state.transactionRecords.length || new Set(state.transactionRecords.map((item) => item.transaction.idempotencyKey)).size !== state.transactionRecords.length) return false;
  let previous: string | null = null;
  for (const record of state.transactionRecords) {
    if (record.transaction.projectId !== state.projectId || record.transaction.branchId !== state.branchId || record.transaction.deterministicDigest !== powerDigest({ ...record.transaction, deterministicDigest: undefined })) return false;
    const { integrityDigest, ...recordBase } = record; if (integrityDigest !== powerDigest({ ...recordBase, previous })) return false; previous = integrityDigest;
  }
  return state.deterministicDigest === powerDigest({ ...state, deterministicDigest: undefined });
}
