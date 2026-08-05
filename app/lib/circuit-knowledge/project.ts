import { validateCircuitRecipeLibrary } from "./library";
import { validateCd5PcbFoundationSignoff, validateCd5UpstreamCompletionSignoff } from "./capability";
import { circuitDigest } from "./stable";
import type { Cd5PcbFoundationSignoff, Cd5UpstreamCompletionSignoff, CircuitKnowledgeProblem, CircuitKnowledgeProjectState, CircuitRecipeLibrary } from "./types";
import { CIRCUIT_KNOWLEDGE_SCHEMA_VERSION } from "./types";

export function createCircuitKnowledgeProjectState(input: { projectId: string; branchId: string; upstreamSignoff: Cd5UpstreamCompletionSignoff; pcbFoundationSignoff: Cd5PcbFoundationSignoff; problem: CircuitKnowledgeProblem; library: CircuitRecipeLibrary }): CircuitKnowledgeProjectState {
  if (input.problem.projectId !== input.projectId || input.problem.branchId !== input.branchId) throw new Error("CIRCUIT_PROJECT_SCOPE_MISMATCH");
  const base: Omit<CircuitKnowledgeProjectState, "deterministicDigest"> = { schemaVersion: CIRCUIT_KNOWLEDGE_SCHEMA_VERSION, projectId: input.projectId, branchId: input.branchId, upstreamSignoff: structuredClone(input.upstreamSignoff), pcbFoundationSignoff: structuredClone(input.pcbFoundationSignoff), problem: structuredClone(input.problem), library: structuredClone(input.library), bindings: [], compositions: [], novelProposals: [], selection: null, transactionRecords: [] };
  return { ...base, deterministicDigest: circuitDigest(base) };
}

export function validateCircuitKnowledgeProjectState(state: CircuitKnowledgeProjectState): string[] {
  const errors: string[] = [];
  if (state.schemaVersion !== CIRCUIT_KNOWLEDGE_SCHEMA_VERSION || state.problem.projectId !== state.projectId || state.problem.branchId !== state.branchId) errors.push("CIRCUIT_PROJECT_IDENTITY_INVALID");
  if (state.upstreamSignoff.deterministicDigest !== state.problem.upstreamSignoffDigest) errors.push("CIRCUIT_PROJECT_UPSTREAM_SIGNOFF_MISMATCH");
  if (state.pcbFoundationSignoff.deterministicDigest !== state.problem.pcbFoundationSignoffDigest) errors.push("CIRCUIT_PROJECT_PCB_FOUNDATION_SIGNOFF_MISMATCH");
  errors.push(...validateCd5UpstreamCompletionSignoff(state.upstreamSignoff), ...validateCd5PcbFoundationSignoff(state.pcbFoundationSignoff));
  errors.push(...validateCircuitRecipeLibrary(state.library));
  if (new Set(state.bindings.map((item) => item.bindingCandidateId)).size !== state.bindings.length) errors.push("CIRCUIT_PROJECT_BINDING_ID_REUSE");
  if (new Set(state.novelProposals.map((item) => item.proposalId)).size !== state.novelProposals.length) errors.push("CIRCUIT_PROJECT_NOVEL_PROPOSAL_ID_REUSE");
  if (state.selection?.selectedBindingId && !state.bindings.some((item) => item.bindingCandidateId === state.selection!.selectedBindingId)) errors.push("CIRCUIT_PROJECT_SELECTION_ORPHAN");
  if (state.deterministicDigest !== circuitDigest({ ...state, deterministicDigest: undefined })) errors.push("CIRCUIT_PROJECT_DIGEST_MISMATCH");
  return [...new Set(errors)].sort();
}
