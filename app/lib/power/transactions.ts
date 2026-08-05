import type { EngineeringActor } from "../engineering/types";
import { validatePowerArchitectureCandidate } from "./compiler";
import { createPowerProjectState } from "./project";
import { powerDigest, powerId } from "./stable";
import type { PowerOperation, PowerProjectState, PowerTransaction, PowerTransactionRecord } from "./types";
import { POWER_TRANSACTION_SCHEMA_VERSION } from "./types";

export function createPowerTransaction(input: Omit<PowerTransaction, "schemaVersion" | "deterministicDigest">): PowerTransaction { const base = { schemaVersion: POWER_TRANSACTION_SCHEMA_VERSION, ...structuredClone(input) }; return { ...base, deterministicDigest: powerDigest({ ...base, deterministicDigest: undefined }) }; }

export function validatePowerTransaction(transaction: PowerTransaction): string[] {
  const errors: string[] = [];
  if (transaction.schemaVersion !== POWER_TRANSACTION_SCHEMA_VERSION || !transaction.transactionId || !transaction.projectId || !transaction.branchId || !transaction.reason.trim() || !transaction.idempotencyKey || !transaction.operations.length) errors.push("POWER_TRANSACTION_IDENTITY_INVALID");
  if (!Number.isFinite(Date.parse(transaction.createdAt)) || transaction.deterministicDigest !== powerDigest({ ...transaction, deterministicDigest: undefined })) errors.push("POWER_TRANSACTION_INTEGRITY_INVALID");
  if (["viewer", "commenter"].includes(transaction.actor.role)) errors.push("POWER_TRANSACTION_UNAUTHORIZED");
  if (transaction.actor.actorKind === "ai" && transaction.operations.some((item) => ["remove_candidate", "select_candidate", "clear_selection"].includes(item.kind))) errors.push("AI_POWER_DECISION_FORBIDDEN");
  if (transaction.operations.some((item) => item.kind === "select_candidate" && item.decision.approver.actorKind !== "human")) errors.push("AI_POWER_SELECTION_FORBIDDEN");
  return [...new Set(errors)].sort();
}

function redigest<T extends { deterministicDigest: string }>(value: T): T { return { ...value, deterministicDigest: powerDigest({ ...value, deterministicDigest: undefined }) }; }

function apply(state: PowerProjectState, operation: PowerOperation): PowerOperation {
  if (operation.kind === "add_candidate") { if (state.candidates.some((item) => item.candidateId === operation.candidate.candidateId || item.structuralSignature === operation.candidate.structuralSignature)) throw new Error("POWER_CANDIDATE_ID_OR_STRUCTURE_REUSE"); const errors = validatePowerArchitectureCandidate(operation.candidate, state.problem); if (errors.length) throw new Error(errors.join(",")); state.candidates.push(structuredClone(operation.candidate)); return { operationId: powerId("inverse-operation", operation.operationId), kind: "remove_candidate", candidateId: operation.candidate.candidateId, expectedDigest: operation.candidate.deterministicDigest }; }
  if (operation.kind === "remove_candidate") { const index = state.candidates.findIndex((item) => item.candidateId === operation.candidateId); if (index < 0) throw new Error("POWER_CANDIDATE_NOT_FOUND"); const candidate = state.candidates[index]; if (candidate.deterministicDigest !== operation.expectedDigest) throw new Error("POWER_CANDIDATE_STALE"); if (state.selection?.candidateId === candidate.candidateId) throw new Error("SELECTED_POWER_CANDIDATE_CANNOT_BE_REMOVED"); state.candidates.splice(index, 1); return { operationId: powerId("inverse-operation", operation.operationId), kind: "add_candidate", candidate: structuredClone(candidate) }; }
  if (operation.kind === "replace_candidate") { const index = state.candidates.findIndex((item) => item.candidateId === operation.candidate.candidateId); if (index < 0) throw new Error("POWER_CANDIDATE_NOT_FOUND"); const prior = state.candidates[index]; if (prior.deterministicDigest !== operation.expectedDigest) throw new Error("POWER_CANDIDATE_STALE"); if (state.selection?.candidateId === prior.candidateId) throw new Error("SELECTED_POWER_CANDIDATE_REQUIRES_CLEAR_SELECTION"); const errors = validatePowerArchitectureCandidate(operation.candidate, state.problem); if (errors.length) throw new Error(errors.join(",")); state.candidates[index] = structuredClone(operation.candidate); return { operationId: powerId("inverse-operation", operation.operationId), kind: "replace_candidate", candidate: structuredClone(prior), expectedDigest: operation.candidate.deterministicDigest }; }
  if (operation.kind === "select_candidate") { if (state.selection) throw new Error("POWER_SELECTION_ALREADY_EXISTS"); const candidate = state.candidates.find((item) => item.candidateId === operation.decision.candidateId && item.deterministicDigest === operation.decision.candidateDigest); if (!candidate) throw new Error("POWER_SELECTION_CANDIDATE_STALE"); if (operation.decision.problemDigest !== state.problem.deterministicDigest || operation.decision.deterministicDigest !== powerDigest({ ...operation.decision, deterministicDigest: undefined })) throw new Error("POWER_SELECTION_INVALID"); state.selection = structuredClone(operation.decision); return { operationId: powerId("inverse-operation", operation.operationId), kind: "clear_selection", expectedDecisionDigest: operation.decision.deterministicDigest }; }
  if (operation.kind === "clear_selection") { if (!state.selection || state.selection.deterministicDigest !== operation.expectedDecisionDigest) throw new Error("POWER_SELECTION_NOT_FOUND_OR_STALE"); const prior = state.selection; state.selection = null; return { operationId: powerId("inverse-operation", operation.operationId), kind: "select_candidate", decision: structuredClone(prior) }; }
  if (operation.kind === "mark_stale") { const index = state.candidates.findIndex((item) => item.candidateId === operation.candidateId); if (index < 0) throw new Error("POWER_CANDIDATE_NOT_FOUND"); const prior = state.candidates[index]; if (prior.deterministicDigest !== operation.expectedDigest) throw new Error("POWER_CANDIDATE_STALE"); if (state.selection?.candidateId === prior.candidateId) throw new Error("SELECTED_POWER_CANDIDATE_REQUIRES_CLEAR_SELECTION"); state.candidates[index] = redigest({ ...prior, revision: prior.revision + 1, parentCandidateId: prior.candidateId, staleState: "stale" as const, risks: prior.risks.map((risk) => ({ ...risk, staleDependencies: [...new Set([...risk.staleDependencies, ...operation.dependencyKeys])].sort() })) }); return { operationId: powerId("inverse-operation", operation.operationId), kind: "replace_candidate", candidate: structuredClone(prior), expectedDigest: state.candidates[index].deterministicDigest }; }
  throw new Error("POWER_OPERATION_UNSUPPORTED");
}

export type PowerTransactionOutcome = { state: "accepted"; project: PowerProjectState; record: PowerTransactionRecord } | { state: "rejected" | "conflict"; diagnostics: string[] };

export class PowerTransactionService {
  private state: PowerProjectState;
  constructor(initial: PowerProjectState) { this.state = structuredClone(initial); }
  current(): PowerProjectState { return structuredClone(this.state); }
  submit(transaction: PowerTransaction): PowerTransactionOutcome {
    const prior = this.state.transactionRecords.find((item) => item.transaction.idempotencyKey === transaction.idempotencyKey);
    if (prior) return prior.transaction.deterministicDigest === transaction.deterministicDigest && prior.state === "accepted" ? { state: "accepted", project: this.current(), record: structuredClone(prior) } : { state: "conflict", diagnostics: ["POWER_IDEMPOTENCY_KEY_REUSE"] };
    const errors = validatePowerTransaction(transaction); if (transaction.projectId !== this.state.projectId || transaction.branchId !== this.state.branchId) errors.push("POWER_TRANSACTION_SCOPE_MISMATCH"); if (transaction.baseStateDigest !== this.state.deterministicDigest) return { state: "conflict", diagnostics: ["POWER_STALE_BASE"] }; if (errors.length) return { state: "rejected", diagnostics: [...new Set(errors)].sort() };
    const draft = structuredClone(this.state); const inverseOperations: PowerOperation[] = [];
    try { for (const operation of transaction.operations) inverseOperations.unshift(apply(draft, operation)); } catch (error) { return { state: "rejected", diagnostics: [error instanceof Error ? error.message : String(error)] }; }
    const resultStateDigest = powerDigest({ problem: draft.problem.deterministicDigest, candidates: draft.candidates.map((item) => item.deterministicDigest).sort(), selection: draft.selection?.deterministicDigest ?? null });
    const recordBase: Omit<PowerTransactionRecord, "integrityDigest"> = { transaction: structuredClone(transaction), state: "accepted", resultStateDigest, diagnostics: [], inverseOperations };
    const record = { ...recordBase, integrityDigest: powerDigest({ ...recordBase, previous: draft.transactionRecords.at(-1)?.integrityDigest ?? null }) }; draft.transactionRecords.push(record);
    this.state = createPowerProjectState({ projectId: draft.projectId, branchId: draft.branchId, upstreamSignoff: draft.upstreamSignoff, problem: draft.problem, candidates: draft.candidates, selection: draft.selection, transactionRecords: draft.transactionRecords }); return { state: "accepted", project: this.current(), record: structuredClone(record) };
  }
  undo(transactionId: string, actor: EngineeringActor, createdAt: string): PowerTransactionOutcome {
    const record = [...this.state.transactionRecords].reverse().find((item) => item.transaction.transactionId === transactionId && item.state === "accepted"); if (!record) return { state: "rejected", diagnostics: ["POWER_TRANSACTION_NOT_UNDOABLE"] };
    return this.submit(createPowerTransaction({ transactionId: powerId("power-undo", { transactionId, state: this.state.deterministicDigest }), projectId: this.state.projectId, branchId: this.state.branchId, actor, reason: `Undo ${transactionId}`, baseStateDigest: this.state.deterministicDigest, idempotencyKey: `undo:${record.integrityDigest}`, operations: structuredClone(record.inverseOperations), createdAt }));
  }
}
