import { architectureDigest } from "./stable";
import type { ArchitectureProjectState } from "./types";
import { ARCHITECTURE_SCHEMA_VERSION } from "./types";
import { validateSystemArchitectureCandidate } from "./validation";

export function createArchitectureProjectState(input: Omit<ArchitectureProjectState, "schemaVersion" | "deterministicDigest" | "transactionRecords"> & { transactionRecords?: ArchitectureProjectState["transactionRecords"] }): ArchitectureProjectState {
  if (input.problem.projectId !== input.projectId || input.problem.branchId !== input.branchId) throw new Error("ARCHITECTURE_PROJECT_SCOPE_MISMATCH");
  const base = { schemaVersion: ARCHITECTURE_SCHEMA_VERSION, ...structuredClone(input), transactionRecords: structuredClone(input.transactionRecords ?? []) };
  return { ...base, deterministicDigest: architectureDigest({ ...base, deterministicDigest: undefined }) };
}

export function validateArchitectureProjectState(value: unknown): value is ArchitectureProjectState {
  if (!value || typeof value !== "object") return false;
  const state = value as ArchitectureProjectState;
  if (state.schemaVersion !== ARCHITECTURE_SCHEMA_VERSION || !state.projectId || !state.branchId || state.problem.projectId !== state.projectId || state.problem.branchId !== state.branchId) return false;
  if (!Array.isArray(state.candidates) || !Array.isArray(state.comparisons) || !Array.isArray(state.transactionRecords)) return false;
  if (state.candidates.some((item) => validateSystemArchitectureCandidate(item, state.problem).length)) return false;
  if (state.selection && !state.candidates.some((item) => item.candidateId === state.selection!.candidateId && item.deterministicDigest === state.selection!.candidateDigest)) return false;
  return state.deterministicDigest === architectureDigest({ ...state, deterministicDigest: undefined });
}
