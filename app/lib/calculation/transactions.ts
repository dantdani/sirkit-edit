import { calculationDigest, calculationId } from "./stable";
import { CALCULATION_TRANSACTION_VERSION } from "./types";
import type { CalculationProjectState, CalculationTransaction, CalculationTransactionRecord, CircuitCalculationReport } from "./types";

export function createCalculationTransaction(input: Omit<CalculationTransaction, "schemaVersion" | "transactionId" | "deterministicDigest"> & { transactionId?: string }): CalculationTransaction {
  if (!input.reason.trim() || !input.idempotencyKey.trim() || !input.operations.length) throw new Error("CD7_TRANSACTION_METADATA_INCOMPLETE");
  const base = structuredClone({ ...input, schemaVersion: CALCULATION_TRANSACTION_VERSION, transactionId: input.transactionId ?? calculationId("calculation-transaction", { project: input.projectId, branch: input.branchId, base: input.baseStateDigest, idempotency: input.idempotencyKey, operations: input.operations }) });
  return { ...base, deterministicDigest: calculationDigest(base) };
}

function authorized(transaction: CalculationTransaction): boolean {
  if (transaction.actor.actorKind === "ai") return false;
  if (transaction.operations.some((item) => item.kind === "approve_report")) return transaction.actor.actorKind === "human" && ["reviewer", "project_admin"].includes(transaction.actor.role);
  return !["viewer", "commenter"].includes(transaction.actor.role);
}
function record(transaction: CalculationTransaction, state: CalculationTransactionRecord["state"], diagnostics: string[], resultStateDigest?: string): CalculationTransactionRecord { const base = { transaction, state, diagnostics: [...new Set(diagnostics)].sort(), resultStateDigest }; return { ...base, integrityDigest: calculationDigest(base) }; }

export function applyCalculationTransaction(stateInput: CalculationProjectState, transaction: CalculationTransaction): { state: CalculationProjectState; record: CalculationTransactionRecord } {
  const prior = stateInput.transactionRecords.find((item) => item.transaction.idempotencyKey === transaction.idempotencyKey); if (prior) return { state: stateInput, record: prior };
  if (transaction.deterministicDigest !== calculationDigest({ ...transaction, deterministicDigest: undefined })) return { state: stateInput, record: record(transaction, "rejected", ["CD7_TRANSACTION_DIGEST_MISMATCH"]) };
  if (transaction.projectId !== stateInput.projectId || transaction.branchId !== stateInput.branchId) return { state: stateInput, record: record(transaction, "rejected", ["CD7_TRANSACTION_SCOPE_MISMATCH"]) };
  if (transaction.baseStateDigest !== stateInput.deterministicDigest) return { state: stateInput, record: record(transaction, "conflict", ["CD7_TRANSACTION_STALE_BASE"]) };
  if (!authorized(transaction)) return { state: stateInput, record: record(transaction, "rejected", ["CD7_TRANSACTION_UNAUTHORIZED"]) };
  const state = structuredClone(stateInput), errors: string[] = [];
  for (const operation of transaction.operations) {
    if (operation.kind === "set_graph") { if (operation.expectedDigest && operation.expectedDigest !== state.graph?.deterministicDigest || operation.graph.problemRevisionId !== state.problem.problemId) errors.push("CD7_GRAPH_PRECONDITION_FAILED"); else state.graph = structuredClone(operation.graph); }
    else if (operation.kind === "add_report") { if (state.reports.some((item) => item.reportId === operation.report.reportId) || operation.report.projectId !== state.projectId || operation.report.problemRevisionId !== state.problem.problemId) errors.push("CD7_REPORT_INVALID_OR_EXISTS"); else state.reports.push(structuredClone(operation.report)); }
    else if (operation.kind === "add_feedback") { if (state.feedback.some((item) => item.feedbackId === operation.feedback.feedbackId) || operation.feedback.sourceCalculationProblemId !== state.problem.problemId) errors.push("CD7_FEEDBACK_INVALID_OR_EXISTS"); else state.feedback.push(structuredClone(operation.feedback)); }
    else if (operation.kind === "approve_report") { const report = state.reports.find((item) => item.reportId === operation.decision.reportId); if (!report || operation.decision.state !== "approved" || operation.decision.approver?.actorKind !== "human" || operation.decision.reportDigest !== report.deterministicDigest || operation.decision.problemDigest !== state.problem.deterministicDigest) errors.push("CD7_DECISION_APPROVAL_INVALID"); else state.decision = structuredClone(operation.decision); }
    else { const priorReport = state.reports.find((item) => item.reportId === operation.reportId); if (!priorReport || priorReport.deterministicDigest !== operation.expectedDigest) { errors.push("CD7_REPORT_PRECONDITION_FAILED"); continue; } const successor = structuredClone(priorReport) as CircuitCalculationReport; successor.reportId = calculationId("invalidated-calculation-report", { prior: priorReport.deterministicDigest, dependencies: [...operation.dependencyRefs].sort(), reason: operation.reason }); successor.lifecycleState = "invalidated"; successor.approvalState = "unreviewed"; successor.reproducibilityDigest = calculationDigest({ prior: priorReport.reproducibilityDigest, dependencies: operation.dependencyRefs, reason: operation.reason }); successor.deterministicDigest = calculationDigest({ ...successor, deterministicDigest: undefined }); state.reports.push(successor); if (state.decision?.reportId === priorReport.reportId) state.decision = null; }
  }
  if (errors.length) return { state: stateInput, record: record(transaction, "conflict", errors) };
  state.reports.sort((a, b) => a.reportId.localeCompare(b.reportId)); state.feedback.sort((a, b) => a.feedbackId.localeCompare(b.feedbackId));
  const resultDigest = calculationDigest({ ...state, deterministicDigest: undefined }); const accepted = record(transaction, "accepted", [], resultDigest); state.transactionRecords.push(accepted); state.deterministicDigest = calculationDigest({ ...state, deterministicDigest: undefined }); return { state, record: accepted };
}
