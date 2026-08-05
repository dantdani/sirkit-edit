import { quantile } from "./statistics";
import type { BenchmarkResult, BenchmarkRunStatus } from "./types";

export const REGRESSION_POLICY_VERSION = "sirkit.benchmark-regression-policy/1.0.0" as const;

export type RegressionSuiteId =
  | "precommit_micro"
  | "pull_request_correctness"
  | "pull_request_qor_smoke"
  | "nightly_stochastic"
  | "scheduled_full"
  | "release_hidden_holdout"
  | "manual_licensed_competitor"
  | "periodic_expert_usability";

export interface RegressionSuitePolicy {
  suiteId: RegressionSuiteId;
  trigger: string;
  partitions: string[];
  maximumWallMinutes: number;
  correctnessAction: "block" | "quarantine_with_owner" | "report_only";
  qorAction: "block_material_regression" | "report_only";
  owner: string;
  notes: string[];
}

export interface RegressionBudget {
  budgetId: string;
  suiteId: RegressionSuiteId;
  metricId: string;
  criticalCorrectness: boolean;
  practicalRegression: number;
  noiseBand: number;
  direction: "lower_is_better" | "higher_is_better";
  maximumP95?: number;
  unit: string;
  domainGuardrail: string;
  failureAction: "block" | "investigate" | "report";
  owner: string;
}

export const REGRESSION_SUITES: readonly RegressionSuitePolicy[] = [
  { suiteId: "precommit_micro", trigger: "local and optional pre-commit", partitions: ["publicDevelopment:analytical"], maximumWallMinutes: 2, correctnessAction: "block", qorAction: "report_only", owner: "benchmark-core", notes: ["Deterministic schema, digest, leakage, oracle, and security tests."] },
  { suiteId: "pull_request_correctness", trigger: "every pull request", partitions: ["publicDevelopment"], maximumWallMinutes: 15, correctnessAction: "block", qorAction: "report_only", owner: "pcb-correctness", notes: ["No recent failing build may be promoted to baseline."] },
  { suiteId: "pull_request_qor_smoke", trigger: "every pull request affecting placement/routing", partitions: ["publicDevelopment:placement", "publicDevelopment:routing"], maximumWallMinutes: 15, correctnessAction: "block", qorAction: "block_material_regression", owner: "pcb-qor", notes: ["Stable seeds; raw vectors retained."] },
  { suiteId: "nightly_stochastic", trigger: "nightly schedule", partitions: ["publicDevelopment", "validation"], maximumWallMinutes: 90, correctnessAction: "block", qorAction: "block_material_regression", owner: "pcb-qor", notes: ["Repeated paired trials; every timeout/crash remains in the denominator."] },
  { suiteId: "scheduled_full", trigger: "weekly schedule", partitions: ["publicDevelopment", "validation", "stress"], maximumWallMinutes: 240, correctnessAction: "block", qorAction: "block_material_regression", owner: "benchmark-core", notes: ["Includes scale families and cold/warm protocols when implemented."] },
  { suiteId: "release_hidden_holdout", trigger: "release candidate by holdout administrator", partitions: ["hiddenHoldout"], maximumWallMinutes: 240, correctnessAction: "block", qorAction: "block_material_regression", owner: "holdout-admin", notes: ["Candidate generation never receives hidden inputs or expectations."] },
  { suiteId: "manual_licensed_competitor", trigger: "authorized manual run", partitions: ["competitive"], maximumWallMinutes: 480, correctnessAction: "report_only", qorAction: "report_only", owner: "competitive-review", notes: ["License, exact build/modules, operator assistance, conversion loss, and budgets are mandatory."] },
  { suiteId: "periodic_expert_usability", trigger: "approved study", partitions: ["competitive", "privateReplay"], maximumWallMinutes: 480, correctnessAction: "report_only", qorAction: "report_only", owner: "ux-research", notes: ["Consent, blinded rubric, corrections, and active human time are retained."] },
];

export const REGRESSION_BUDGETS: readonly RegressionBudget[] = [
  { budgetId: "correctness-hard-failures-v1", suiteId: "pull_request_correctness", metricId: "correctness.hard_failures", criticalCorrectness: true, practicalRegression: 0, noiseBand: 0, direction: "lower_is_better", unit: "count", domainGuardrail: "No package or domain may introduce a hard engineering failure.", failureAction: "block", owner: "pcb-correctness" },
  { budgetId: "correctness-false-ready-v1", suiteId: "pull_request_correctness", metricId: "correctness.false_ready", criticalCorrectness: true, practicalRegression: 0, noiseBand: 0, direction: "lower_is_better", unit: "count", domainGuardrail: "One false-ready event blocks promotion.", failureAction: "block", owner: "readiness" },
  { budgetId: "protected-mutation-v1", suiteId: "pull_request_correctness", metricId: "correctness.protected_mutations", criticalCorrectness: true, practicalRegression: 0, noiseBand: 0, direction: "lower_is_better", unit: "count", domainGuardrail: "One protected mutation blocks promotion.", failureAction: "block", owner: "data-integrity" },
  { budgetId: "qor-runtime-p95-v1", suiteId: "pull_request_qor_smoke", metricId: "performance.elapsed_ms", criticalCorrectness: false, practicalRegression: 0.1, noiseBand: 0.05, direction: "lower_is_better", maximumP95: 2_000, unit: "ms", domainGuardrail: "No domain p95 may exceed the absolute budget or regress materially after uncertainty.", failureAction: "block", owner: "benchmark-core" },
  { budgetId: "routing-length-v1", suiteId: "nightly_stochastic", metricId: "routing.total_length_nm", criticalCorrectness: false, practicalRegression: 0.03, noiseBand: 0.02, direction: "lower_is_better", unit: "ratio", domainGuardrail: "Evaluate paired board-family deltas only after correctness; no critical-domain regression may be hidden by aggregate gains.", failureAction: "investigate", owner: "routing" },
  { budgetId: "placement-overflow-v1", suiteId: "nightly_stochastic", metricId: "placement.routing_overflow", criticalCorrectness: false, practicalRegression: 1, noiseBand: 0, direction: "lower_is_better", unit: "count", domainGuardrail: "Report proxy separately from actual routing outcomes.", failureAction: "investigate", owner: "placement" },
];

export interface RegressionEvaluation {
  state: "pass" | "block" | "insufficient_evidence";
  reasons: string[];
  statusDenominators: Record<string, number>;
  elapsedP95Ms: number | null;
}

const BLOCKING_STATUSES = new Set<BenchmarkRunStatus>(["failed_correctness", "timeout", "crash", "cancelled", "environment_failure", "oracle_disagreement", "invalid_fixture"]);

/** Correctness and denominator visibility are evaluated before any soft QoR budget. */
export function evaluateRegressionResults(results: readonly BenchmarkResult[], statuses: readonly BenchmarkRunStatus[], suiteId: RegressionSuiteId): RegressionEvaluation {
  const reasons: string[] = [];
  const statusDenominators: Record<string, number> = {};
  for (const status of statuses) {
    statusDenominators[status] = (statusDenominators[status] ?? 0) + 1;
    if (BLOCKING_STATUSES.has(status)) reasons.push(`BLOCKING_STATUS:${status}`);
  }
  for (const result of results) for (const gate of result.correctnessGates) {
    if (gate.critical && gate.state !== "passed" && gate.state !== "not_applicable") reasons.push(`CRITICAL_GATE:${gate.metricId}:${gate.state}`);
  }
  const elapsed = results.flatMap((result) => result.performanceSamples.map((sample) => sample.elapsedMs));
  const elapsedP95Ms = quantile(elapsed, 0.95);
  const runtimeBudget = REGRESSION_BUDGETS.find((budget) => budget.suiteId === suiteId && budget.metricId === "performance.elapsed_ms");
  if (runtimeBudget?.maximumP95 !== undefined && elapsedP95Ms !== null && elapsedP95Ms > runtimeBudget.maximumP95) reasons.push(`BUDGET_EXCEEDED:performance.elapsed_ms:p95=${elapsedP95Ms}`);
  if (!results.length) reasons.push("NO_RESULTS");
  const unique = [...new Set(reasons)].sort();
  return { state: unique.some((reason) => reason.startsWith("BLOCKING_") || reason.startsWith("CRITICAL_") || reason.startsWith("BUDGET_")) ? "block" : unique.length ? "insufficient_evidence" : "pass", reasons: unique, statusDenominators, elapsedP95Ms };
}

export interface ThresholdChangeRequest {
  metricId: string;
  fromPolicyVersion: string;
  toPolicyVersion: string;
  rationale: string;
  beforeDistributionRef: string;
  afterDistributionRef: string;
  affectedClaimIds: string[];
  reviewer: string;
  approved: boolean;
}

export function validateThresholdChange(request: ThresholdChangeRequest): string[] {
  const errors: string[] = [];
  if (!request.rationale.trim()) errors.push("RATIONALE_REQUIRED");
  if (!request.beforeDistributionRef || !request.afterDistributionRef) errors.push("DISTRIBUTIONS_REQUIRED");
  if (request.fromPolicyVersion === request.toPolicyVersion) errors.push("POLICY_VERSION_MUST_CHANGE");
  if (!request.reviewer || !request.approved) errors.push("REVIEW_APPROVAL_REQUIRED");
  return errors;
}

export interface FlakyQuarantine {
  quarantineId: string;
  owner: string;
  evidenceRef: string;
  scope: string;
  expiresAt: string;
  remediationPlan: string;
  denominatorVisible: boolean;
}

export function validateFlakyQuarantine(item: FlakyQuarantine, now = new Date()): string[] {
  const errors: string[] = [];
  if (!item.owner || !item.evidenceRef || !item.scope || !item.remediationPlan) errors.push("QUARANTINE_FIELDS_REQUIRED");
  if (!item.denominatorVisible) errors.push("DENOMINATOR_MUST_REMAIN_VISIBLE");
  if (!Number.isFinite(Date.parse(item.expiresAt)) || Date.parse(item.expiresAt) <= now.getTime()) errors.push("QUARANTINE_EXPIRY_INVALID");
  return errors;
}
