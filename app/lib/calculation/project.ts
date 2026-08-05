import { validateCd7UpstreamCompletionSignoff } from "./capability";
import { validateEquationModelRegistrySnapshot } from "./model-registry";
import { calculationDigest } from "./stable";
import { CALCULATION_SCHEMA_VERSION } from "./types";
import type { CalculationProjectState, Cd7UpstreamCompletionSignoff, CircuitCalculationProblem, EquationModelRegistrySnapshot, CalculationVariable, CorrelationModel, CornerDimension } from "./types";

export function createCalculationProjectState(input: { projectId: string; branchId: string; upstreamSignoff: Cd7UpstreamCompletionSignoff; problem: CircuitCalculationProblem; registrySnapshot: EquationModelRegistrySnapshot; variables?: CalculationVariable[]; correlationModels?: CorrelationModel[]; cornerDimensions?: CornerDimension[] }): CalculationProjectState {
  if (input.problem.projectId !== input.projectId || input.problem.branchId !== input.branchId) throw new Error("CD7_PROJECT_SCOPE_MISMATCH");
  const base: Omit<CalculationProjectState, "deterministicDigest"> = { schemaVersion: CALCULATION_SCHEMA_VERSION, projectId: input.projectId, branchId: input.branchId, upstreamSignoff: structuredClone(input.upstreamSignoff), problem: structuredClone(input.problem), registrySnapshot: structuredClone(input.registrySnapshot), variables: structuredClone(input.variables ?? []).sort((a, b) => a.variableId.localeCompare(b.variableId)), correlationModels: structuredClone(input.correlationModels ?? []).sort((a, b) => a.correlationModelId.localeCompare(b.correlationModelId)), graph: null, cornerDimensions: structuredClone(input.cornerDimensions ?? []).sort((a, b) => a.dimensionId.localeCompare(b.dimensionId)), reports: [], feedback: [], decision: null, transactionRecords: [] };
  const value = { ...base, deterministicDigest: calculationDigest(base) };
  const errors = validateCalculationProjectState(value); if (errors.length) throw new Error(errors.join(",")); return value;
}

export function validateCalculationProjectState(value: CalculationProjectState): string[] {
  const errors: string[] = [];
  if (!value || value.schemaVersion !== CALCULATION_SCHEMA_VERSION) return ["CD7_PROJECT_SCHEMA_INVALID"];
  if (value.projectId !== value.problem.projectId || value.branchId !== value.problem.branchId) errors.push("CD7_PROJECT_SCOPE_MISMATCH");
  errors.push(...validateCd7UpstreamCompletionSignoff(value.upstreamSignoff), ...validateEquationModelRegistrySnapshot(value.registrySnapshot));
  if (value.problem.equationRegistrySnapshotId !== value.registrySnapshot.registrySnapshotId) errors.push("CD7_PROJECT_REGISTRY_REF_MISMATCH");
  if (value.graph && (value.graph.problemRevisionId !== value.problem.problemId || value.graph.deterministicDigest !== calculationDigest({ ...value.graph, deterministicDigest: undefined }) || value.graph.nodes.some((item) => item.deterministicDigest !== calculationDigest({ ...item, deterministicDigest: undefined })))) errors.push("CD7_GRAPH_PROBLEM_REF_MISMATCH");
  if (value.variables.some((item) => item.deterministicDigest !== calculationDigest({ ...item, deterministicDigest: undefined }))) errors.push("CD7_VARIABLE_DIGEST_INVALID");
  if (value.correlationModels.some((item) => item.deterministicDigest !== calculationDigest({ ...item, deterministicDigest: undefined }))) errors.push("CD7_CORRELATION_DIGEST_INVALID");
  if (value.cornerDimensions.some((item) => item.deterministicDigest !== calculationDigest({ ...item, deterministicDigest: undefined }))) errors.push("CD7_CORNER_DIMENSION_DIGEST_INVALID");
  if (value.feedback.some((item) => item.sourceCalculationProblemId !== value.problem.problemId || item.deterministicDigest !== calculationDigest({ ...item, deterministicDigest: undefined }))) errors.push("CD7_FEEDBACK_INVALID");
  const reportIds = new Set(value.reports.map((item) => item.reportId));
  if (value.reports.some((item) => item.projectId !== value.projectId || item.problemRevisionId !== value.problem.problemId || item.deterministicDigest !== calculationDigest({ ...item, deterministicDigest: undefined }))) errors.push("CD7_REPORT_INVALID");
  if (value.decision && (!reportIds.has(value.decision.reportId) || value.decision.problemDigest !== value.problem.deterministicDigest || value.decision.reportDigest !== value.reports.find((item) => item.reportId === value.decision!.reportId)?.deterministicDigest || value.decision.state === "approved" && value.decision.approver?.actorKind !== "human")) errors.push("CD7_DECISION_REF_INVALID");
  if (value.decision && value.decision.deterministicDigest !== calculationDigest({ ...value.decision, deterministicDigest: undefined })) errors.push("CD7_DECISION_DIGEST_INVALID");
  if (value.transactionRecords.some((item) => item.integrityDigest !== calculationDigest({ ...item, integrityDigest: undefined }) || item.transaction.deterministicDigest !== calculationDigest({ ...item.transaction, deterministicDigest: undefined }))) errors.push("CD7_TRANSACTION_RECORD_INVALID");
  if (new Set(value.variables.map((item) => item.variableId)).size !== value.variables.length) errors.push("CD7_VARIABLE_ID_DUPLICATE");
  if (value.deterministicDigest !== calculationDigest({ ...value, deterministicDigest: undefined })) errors.push("CD7_PROJECT_DIGEST_MISMATCH");
  return [...new Set(errors)].sort();
}

export function invalidateCalculationState(state: CalculationProjectState, dependencyRefs: string[], reason: string): CalculationProjectState {
  const next = structuredClone(state); next.graph = null; next.decision = null;
  for (const report of next.reports) if (report.lifecycleState !== "archived" && report.lifecycleState !== "superseded") { report.lifecycleState = "invalidated"; report.approvalState = "unreviewed"; report.reproducibilityDigest = calculationDigest({ prior: report.reproducibilityDigest, dependencyRefs: [...dependencyRefs].sort(), reason }); report.deterministicDigest = calculationDigest({ ...report, deterministicDigest: undefined }); }
  next.deterministicDigest = calculationDigest({ ...next, deterministicDigest: undefined }); return next;
}
