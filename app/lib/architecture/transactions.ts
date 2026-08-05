import { architectureDigest, architectureId } from "./stable";
import { createArchitectureProjectState } from "./project";
import type { ArchitectureOperation, ArchitectureProjectState, ArchitectureTransaction, ArchitectureTransactionRecord } from "./types";
import { ARCHITECTURE_TRANSACTION_SCHEMA_VERSION } from "./types";
import { validateSystemArchitectureCandidate } from "./validation";

export function createArchitectureTransaction(input: Omit<ArchitectureTransaction, "schemaVersion" | "deterministicDigest">): ArchitectureTransaction {
  const base = { schemaVersion: ARCHITECTURE_TRANSACTION_SCHEMA_VERSION, ...structuredClone(input) };
  return { ...base, deterministicDigest: architectureDigest({ ...base, deterministicDigest: undefined }) };
}

export function validateArchitectureTransaction(transaction: ArchitectureTransaction): string[] {
  const errors: string[] = [];
  if (transaction.schemaVersion !== ARCHITECTURE_TRANSACTION_SCHEMA_VERSION) errors.push("ARCHITECTURE_TRANSACTION_SCHEMA_UNSUPPORTED");
  if (!transaction.transactionId || !transaction.projectId || !transaction.branchId || !transaction.reason.trim() || !transaction.operations.length) errors.push("ARCHITECTURE_TRANSACTION_IDENTITY_REQUIRED");
  if (!Number.isFinite(Date.parse(transaction.createdAt))) errors.push("ARCHITECTURE_TRANSACTION_DATE_INVALID");
  if (transaction.deterministicDigest !== architectureDigest({ ...transaction, deterministicDigest: undefined })) errors.push("ARCHITECTURE_TRANSACTION_DIGEST_MISMATCH");
  if (["viewer", "commenter"].includes(transaction.actor.role)) errors.push("ARCHITECTURE_TRANSACTION_UNAUTHORIZED");
  if (transaction.actor.actorKind === "ai" && transaction.operations.some((item) => ["select_candidate", "clear_selection", "reject_candidate", "remove_candidate"].includes(item.kind))) errors.push("AI_ARCHITECTURE_DECISION_FORBIDDEN");
  if (transaction.operations.some((item) => item.kind === "select_candidate" && item.decision.approver.actorKind !== "human")) errors.push("AI_ARCHITECTURE_SELECTION_FORBIDDEN");
  return [...new Set(errors)].sort();
}

function replaceDigest<T extends { deterministicDigest: string }>(value: T): T { return { ...value, deterministicDigest: architectureDigest({ ...value, deterministicDigest: undefined }) }; }

function applyOperation(state: ArchitectureProjectState, operation: ArchitectureOperation): ArchitectureOperation {
  if (operation.kind === "add_candidate") {
    if (state.candidates.some((item) => item.candidateId === operation.candidate.candidateId || item.structuralSignature === operation.candidate.structuralSignature)) throw new Error("ARCHITECTURE_CANDIDATE_ID_OR_STRUCTURE_REUSE");
    const errors = validateSystemArchitectureCandidate(operation.candidate, state.problem); if (errors.length) throw new Error(errors.join(","));
    state.candidates.push(structuredClone(operation.candidate));
    return { operationId: architectureId("inverse-operation", operation.operationId), kind: "remove_candidate", candidateId: operation.candidate.candidateId, expectedCandidateDigest: operation.candidate.deterministicDigest };
  }
  if (operation.kind === "remove_candidate") {
    const index = state.candidates.findIndex((item) => item.candidateId === operation.candidateId); if (index < 0) throw new Error("ARCHITECTURE_CANDIDATE_NOT_FOUND");
    const existing = state.candidates[index]; if (existing.deterministicDigest !== operation.expectedCandidateDigest) throw new Error("ARCHITECTURE_CANDIDATE_STALE");
    if (state.selection?.candidateId === existing.candidateId) throw new Error("SELECTED_ARCHITECTURE_CANNOT_BE_REMOVED");
    state.candidates.splice(index, 1); return { operationId: architectureId("inverse-operation", operation.operationId), kind: "add_candidate", candidate: structuredClone(existing) };
  }
  if (operation.kind === "replace_candidate") {
    const index = state.candidates.findIndex((item) => item.candidateId === operation.candidate.candidateId); if (index < 0) throw new Error("ARCHITECTURE_CANDIDATE_NOT_FOUND");
    const existing = state.candidates[index]; if (existing.deterministicDigest !== operation.expectedCandidateDigest) throw new Error("ARCHITECTURE_CANDIDATE_STALE");
    if (state.selection?.candidateId === existing.candidateId) throw new Error("SELECTED_ARCHITECTURE_REQUIRES_CLEAR_SELECTION");
    const errors = validateSystemArchitectureCandidate(operation.candidate, state.problem); if (errors.length) throw new Error(errors.join(","));
    state.candidates[index] = structuredClone(operation.candidate); return { operationId: architectureId("inverse-operation", operation.operationId), kind: "replace_candidate", expectedCandidateDigest: operation.candidate.deterministicDigest, candidate: structuredClone(existing) };
  }
  if (operation.kind === "reject_candidate") {
    const index = state.candidates.findIndex((item) => item.candidateId === operation.candidateId); if (index < 0) throw new Error("ARCHITECTURE_CANDIDATE_NOT_FOUND");
    const existing = state.candidates[index]; if (existing.deterministicDigest !== operation.expectedCandidateDigest) throw new Error("ARCHITECTURE_CANDIDATE_STALE");
    if (state.selection?.candidateId === existing.candidateId) throw new Error("SELECTED_ARCHITECTURE_REQUIRES_CLEAR_SELECTION");
    state.candidates[index] = replaceDigest({ ...existing, status: "rejected" as const, diagnostics: [...existing.diagnostics, { diagnosticId: architectureId("architecture-diagnostic", { candidate: existing.candidateId, reason: operation.reason }), code: "CANDIDATE_REJECTED", severity: "info" as const, message: operation.reason, objectRefs: [existing.candidateId], requirementRefs: [], nextActions: [] }] });
    return { operationId: architectureId("inverse-operation", operation.operationId), kind: "replace_candidate", expectedCandidateDigest: state.candidates[index].deterministicDigest, candidate: structuredClone(existing) };
  }
  if (operation.kind === "record_comparison") {
    if (state.comparisons.some((item) => item.comparisonId === operation.comparison.comparisonId)) throw new Error("ARCHITECTURE_COMPARISON_ID_REUSE");
    if (operation.comparison.problemDigest !== state.problem.deterministicDigest || operation.comparison.deterministicDigest !== architectureDigest({ ...operation.comparison, deterministicDigest: undefined })) throw new Error("ARCHITECTURE_COMPARISON_INVALID");
    state.comparisons.push(structuredClone(operation.comparison)); return { operationId: architectureId("inverse-operation", operation.operationId), kind: "remove_comparison", comparisonId: operation.comparison.comparisonId, expectedComparisonDigest: operation.comparison.deterministicDigest };
  }
  if (operation.kind === "remove_comparison") {
    const index = state.comparisons.findIndex((item) => item.comparisonId === operation.comparisonId); if (index < 0) throw new Error("ARCHITECTURE_COMPARISON_NOT_FOUND");
    const existing = state.comparisons[index]; if (existing.deterministicDigest !== operation.expectedComparisonDigest) throw new Error("ARCHITECTURE_COMPARISON_STALE"); state.comparisons.splice(index, 1);
    return { operationId: architectureId("inverse-operation", operation.operationId), kind: "record_comparison", comparison: structuredClone(existing) };
  }
  if (operation.kind === "select_candidate") {
    if (state.selection) throw new Error("ARCHITECTURE_SELECTION_ALREADY_EXISTS"); const candidate = state.candidates.find((item) => item.candidateId === operation.decision.candidateId && item.deterministicDigest === operation.decision.candidateDigest); if (!candidate) throw new Error("ARCHITECTURE_SELECTION_CANDIDATE_STALE");
    if (!["feasible_for_review", "feasible_with_unresolved"].includes(candidate.status)) throw new Error("ARCHITECTURE_CANDIDATE_NOT_FEASIBLE");
    if (operation.decision.deterministicDigest !== architectureDigest({ ...operation.decision, deterministicDigest: undefined })) throw new Error("ARCHITECTURE_SELECTION_DIGEST_MISMATCH");
    state.selection = structuredClone(operation.decision); return { operationId: architectureId("inverse-operation", operation.operationId), kind: "clear_selection", expectedDecisionDigest: operation.decision.deterministicDigest, reason: "Undo selection" };
  }
  if (operation.kind === "clear_selection") {
    if (!state.selection) throw new Error("ARCHITECTURE_SELECTION_NOT_FOUND"); if (state.selection.deterministicDigest !== operation.expectedDecisionDigest) throw new Error("ARCHITECTURE_SELECTION_STALE"); const existing = state.selection; state.selection = null;
    return { operationId: architectureId("inverse-operation", operation.operationId), kind: "select_candidate", decision: structuredClone(existing) };
  }
  throw new Error("ARCHITECTURE_OPERATION_UNSUPPORTED");
}

export type ArchitectureTransactionOutcome = { state: "accepted"; project: ArchitectureProjectState; record: ArchitectureTransactionRecord } | { state: "rejected" | "conflict"; diagnostics: string[] };

export class ArchitectureTransactionService {
  private state: ArchitectureProjectState;
  constructor(initial: ArchitectureProjectState) { this.state = structuredClone(initial); }
  current(): ArchitectureProjectState { return structuredClone(this.state); }
  submit(transaction: ArchitectureTransaction): ArchitectureTransactionOutcome {
    const errors = validateArchitectureTransaction(transaction);
    if (transaction.projectId !== this.state.projectId || transaction.branchId !== this.state.branchId) errors.push("ARCHITECTURE_TRANSACTION_SCOPE_MISMATCH");
    if (transaction.operations.some((item) => item.kind === "select_candidate" && item.decision.approver.actorId !== transaction.actor.actorId)) errors.push("ARCHITECTURE_APPROVER_ACTOR_MISMATCH");
    if (transaction.baseStateDigest !== this.state.deterministicDigest) return { state: "conflict", diagnostics: ["ARCHITECTURE_STALE_BASE"] };
    if (errors.length) return { state: "rejected", diagnostics: [...new Set(errors)].sort() };
    const draft = structuredClone(this.state); const inverses: ArchitectureOperation[] = [];
    try { for (const operation of transaction.operations) inverses.unshift(applyOperation(draft, operation)); } catch (error) { return { state: "rejected", diagnostics: [error instanceof Error ? error.message : String(error)] }; }
    const semanticDigest = architectureDigest({ problem: draft.problem.deterministicDigest, candidates: draft.candidates.map((item) => item.deterministicDigest), comparisons: draft.comparisons.map((item) => item.deterministicDigest), selection: draft.selection?.deterministicDigest ?? null });
    const recordBase: Omit<ArchitectureTransactionRecord, "integrityDigest"> = { transaction: structuredClone(transaction), state: "accepted", resultStateDigest: semanticDigest, diagnostics: [], inverseOperations: inverses };
    const record = { ...recordBase, integrityDigest: architectureDigest({ ...recordBase, previous: draft.transactionRecords.at(-1)?.integrityDigest }) };
    draft.transactionRecords.push(record); this.state = createArchitectureProjectState({ projectId: draft.projectId, branchId: draft.branchId, problem: draft.problem, candidates: draft.candidates.sort((a, b) => a.candidateId.localeCompare(b.candidateId)), comparisons: draft.comparisons.sort((a, b) => a.comparisonId.localeCompare(b.comparisonId)), selection: draft.selection, transactionRecords: draft.transactionRecords });
    return { state: "accepted", project: this.current(), record: structuredClone(record) };
  }
}
