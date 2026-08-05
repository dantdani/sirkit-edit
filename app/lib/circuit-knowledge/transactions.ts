import { circuitDigest, circuitId } from "./stable";
import type { CircuitKnowledgeOperation, CircuitKnowledgeProjectState, CircuitKnowledgeTransaction, CircuitKnowledgeTransactionRecord } from "./types";
import { CIRCUIT_TRANSACTION_VERSION } from "./types";

export interface CircuitTransactionResult { state: CircuitKnowledgeProjectState; record: CircuitKnowledgeTransactionRecord; }

function canMutate(transaction: CircuitKnowledgeTransaction): boolean {
  const actor = transaction.actor;
  if (actor.actorKind === "ai") return transaction.operations.every((item) => item.kind === "add_novel_proposal" && item.proposal.approvalState === "quarantined");
  if (["replace_library", "select_binding", "clear_selection"].some((kind) => transaction.operations.some((item) => item.kind === kind))) return actor.actorKind === "human" && ["reviewer", "project_admin"].includes(actor.role);
  return ["human", "automated_engine", "import_adapter"].includes(actor.actorKind) && actor.role !== "viewer" && actor.role !== "commenter";
}

export function createCircuitKnowledgeTransaction(input: Omit<CircuitKnowledgeTransaction, "schemaVersion" | "transactionId" | "deterministicDigest"> & { transactionId?: string }): CircuitKnowledgeTransaction {
  if (!input.reason.trim() || !input.idempotencyKey.trim() || !input.operations.length) throw new Error("CIRCUIT_TRANSACTION_METADATA_INCOMPLETE");
  const base = structuredClone({ ...input, schemaVersion: CIRCUIT_TRANSACTION_VERSION, transactionId: input.transactionId ?? circuitId("circuit-transaction", { project: input.projectId, branch: input.branchId, idempotency: input.idempotencyKey, base: input.baseStateDigest, operations: input.operations }) });
  return { ...base, deterministicDigest: circuitDigest(base) };
}

function domainResultDigest(state: CircuitKnowledgeProjectState): string {
  return circuitDigest({ projectId: state.projectId, branchId: state.branchId, library: state.library.deterministicDigest, bindings: state.bindings.map((item) => item.deterministicDigest).sort(), compositions: state.compositions.map((item) => item.deterministicDigest).sort(), novel: state.novelProposals.map((item) => item.deterministicDigest).sort(), selection: state.selection?.deterministicDigest ?? null });
}

function rejected(state: CircuitKnowledgeProjectState, transaction: CircuitKnowledgeTransaction, recordState: "rejected" | "conflict", diagnostics: string[]): CircuitTransactionResult {
  const recordBase: Omit<CircuitKnowledgeTransactionRecord, "integrityDigest"> = { transaction, state: recordState, diagnostics: [...new Set(diagnostics)].sort(), inverseOperations: [] };
  return { state, record: { ...recordBase, integrityDigest: circuitDigest(recordBase) } };
}

export function applyCircuitKnowledgeTransaction(stateInput: CircuitKnowledgeProjectState, transaction: CircuitKnowledgeTransaction): CircuitTransactionResult {
  const prior = stateInput.transactionRecords.find((item) => item.transaction.idempotencyKey === transaction.idempotencyKey);
  if (prior) return { state: stateInput, record: prior };
  if (transaction.deterministicDigest !== circuitDigest({ ...transaction, deterministicDigest: undefined })) return rejected(stateInput, transaction, "rejected", ["CIRCUIT_TRANSACTION_DIGEST_MISMATCH"]);
  if (transaction.projectId !== stateInput.projectId || transaction.branchId !== stateInput.branchId) return rejected(stateInput, transaction, "rejected", ["CIRCUIT_TRANSACTION_SCOPE_MISMATCH"]);
  if (transaction.baseStateDigest !== stateInput.deterministicDigest) return rejected(stateInput, transaction, "conflict", ["CIRCUIT_TRANSACTION_STALE_BASE"]);
  if (!canMutate(transaction)) return rejected(stateInput, transaction, "rejected", ["CIRCUIT_TRANSACTION_UNAUTHORIZED"]);
  const state = structuredClone(stateInput);
  const inverse: CircuitKnowledgeOperation[] = [];
  const diagnostics: string[] = [];
  for (const operation of transaction.operations) {
    switch (operation.kind) {
      case "replace_library":
        if (state.library.deterministicDigest !== operation.expectedDigest) { diagnostics.push("CIRCUIT_LIBRARY_PRECONDITION_FAILED"); break; }
        inverse.unshift({ operationId: `${operation.operationId}:inverse`, kind: "replace_library", expectedDigest: operation.library.deterministicDigest, library: structuredClone(state.library) });
        state.library = structuredClone(operation.library); break;
      case "add_binding":
        if (state.bindings.some((item) => item.bindingCandidateId === operation.binding.bindingCandidateId)) { diagnostics.push("CIRCUIT_BINDING_ALREADY_EXISTS"); break; }
        state.bindings.push(structuredClone(operation.binding)); inverse.unshift({ operationId: `${operation.operationId}:inverse`, kind: "remove_binding", bindingId: operation.binding.bindingCandidateId, expectedDigest: operation.binding.deterministicDigest }); break;
      case "replace_binding": {
        const index = state.bindings.findIndex((item) => item.bindingCandidateId === operation.bindingId);
        if (index < 0 || state.bindings[index].deterministicDigest !== operation.expectedDigest || operation.binding.bindingCandidateId !== operation.bindingId) { diagnostics.push("CIRCUIT_BINDING_PRECONDITION_FAILED"); break; }
        inverse.unshift({ operationId: `${operation.operationId}:inverse`, kind: "replace_binding", bindingId: operation.bindingId, expectedDigest: operation.binding.deterministicDigest, binding: structuredClone(state.bindings[index]) });
        state.bindings[index] = structuredClone(operation.binding); break;
      }
      case "remove_binding": {
        const index = state.bindings.findIndex((item) => item.bindingCandidateId === operation.bindingId);
        if (index < 0 || state.bindings[index].deterministicDigest !== operation.expectedDigest) { diagnostics.push("CIRCUIT_BINDING_PRECONDITION_FAILED"); break; }
        const [removed] = state.bindings.splice(index, 1); inverse.unshift({ operationId: `${operation.operationId}:inverse`, kind: "add_binding", binding: removed });
        if (state.selection?.selectedBindingId === operation.bindingId) state.selection = null; break;
      }
      case "add_novel_proposal":
        if (state.novelProposals.some((item) => item.proposalId === operation.proposal.proposalId) || operation.proposal.publicationCandidateState !== "not_eligible") { diagnostics.push("NOVEL_CIRCUIT_PROPOSAL_INVALID"); break; }
        state.novelProposals.push(structuredClone(operation.proposal)); inverse.unshift({ operationId: `${operation.operationId}:inverse`, kind: "remove_novel_proposal", proposalId: operation.proposal.proposalId, expectedDigest: operation.proposal.deterministicDigest }); break;
      case "remove_novel_proposal": {
        const index = state.novelProposals.findIndex((item) => item.proposalId === operation.proposalId);
        if (index < 0 || state.novelProposals[index].deterministicDigest !== operation.expectedDigest) { diagnostics.push("NOVEL_CIRCUIT_PROPOSAL_PRECONDITION_FAILED"); break; }
        const [removed] = state.novelProposals.splice(index, 1); inverse.unshift({ operationId: `${operation.operationId}:inverse`, kind: "add_novel_proposal", proposal: removed }); break;
      }
      case "select_binding":
        if (operation.decision.approvalState !== "approved" || operation.decision.approver?.actorKind !== "human" || !operation.decision.selectedBindingId || !state.bindings.some((item) => item.bindingCandidateId === operation.decision.selectedBindingId && item.feasibilityState === "feasible_at_recipe_resolution")) { diagnostics.push("CIRCUIT_SELECTION_APPROVAL_INVALID"); break; }
        inverse.unshift(state.selection ? { operationId: `${operation.operationId}:inverse`, kind: "select_binding", decision: structuredClone(state.selection) } : { operationId: `${operation.operationId}:inverse`, kind: "clear_selection", expectedDigest: operation.decision.deterministicDigest });
        state.selection = structuredClone(operation.decision); break;
      case "clear_selection":
        if (!state.selection || state.selection.deterministicDigest !== operation.expectedDigest) { diagnostics.push("CIRCUIT_SELECTION_PRECONDITION_FAILED"); break; }
        inverse.unshift({ operationId: `${operation.operationId}:inverse`, kind: "select_binding", decision: structuredClone(state.selection) }); state.selection = null; break;
      case "mark_binding_stale": {
        const index = state.bindings.findIndex((item) => item.bindingCandidateId === operation.bindingId);
        if (index < 0 || state.bindings[index].deterministicDigest !== operation.expectedDigest) { diagnostics.push("CIRCUIT_BINDING_PRECONDITION_FAILED"); break; }
        const before = structuredClone(state.bindings[index]); const next = structuredClone(before); next.feasibilityState = "stale"; next.hardGateResults.push({ gateId: "dependency_invalidation", state: "stale", explanation: "A pinned dependency changed.", objectRefs: [...operation.dependencyKeys].sort() }); next.deterministicDigest = circuitDigest({ ...next, deterministicDigest: undefined }); state.bindings[index] = next;
        inverse.unshift({ operationId: `${operation.operationId}:inverse`, kind: "replace_binding", bindingId: operation.bindingId, expectedDigest: next.deterministicDigest, binding: before }); if (state.selection?.selectedBindingId === operation.bindingId) state.selection = null; break;
      }
    }
  }
  if (diagnostics.length) return rejected(stateInput, transaction, "conflict", diagnostics);
  state.bindings.sort((a, b) => a.bindingCandidateId.localeCompare(b.bindingCandidateId)); state.novelProposals.sort((a, b) => a.proposalId.localeCompare(b.proposalId));
  const recordBase: Omit<CircuitKnowledgeTransactionRecord, "integrityDigest"> = { transaction, state: "accepted", resultStateDigest: domainResultDigest(state), diagnostics: [], inverseOperations: inverse };
  const record: CircuitKnowledgeTransactionRecord = { ...recordBase, integrityDigest: circuitDigest(recordBase) };
  state.transactionRecords.push(record);
  state.deterministicDigest = circuitDigest({ ...state, deterministicDigest: undefined });
  return { state, record };
}

export function diffCircuitKnowledgeStates(before: CircuitKnowledgeProjectState, after: CircuitKnowledgeProjectState): { libraryChanged: boolean; addedBindings: string[]; removedBindings: string[]; staleBindings: string[]; selectionChanged: boolean; } {
  const beforeBindings = new Map(before.bindings.map((item) => [item.bindingCandidateId, item])); const afterBindings = new Map(after.bindings.map((item) => [item.bindingCandidateId, item]));
  return { libraryChanged: before.library.deterministicDigest !== after.library.deterministicDigest, addedBindings: [...afterBindings.keys()].filter((id) => !beforeBindings.has(id)).sort(), removedBindings: [...beforeBindings.keys()].filter((id) => !afterBindings.has(id)).sort(), staleBindings: [...afterBindings.values()].filter((item) => item.feasibilityState === "stale" && beforeBindings.get(item.bindingCandidateId)?.feasibilityState !== "stale").map((item) => item.bindingCandidateId).sort(), selectionChanged: before.selection?.deterministicDigest !== after.selection?.deterministicDigest };
}
