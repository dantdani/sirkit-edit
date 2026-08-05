import type { BenchmarkResult, CorrectnessGateResult, MetricDefinition, MetricValue } from "./types";

const metric = (input: Omit<MetricDefinition, "schemaVersion" | "version">): MetricDefinition => ({ schemaVersion: "sirkit.benchmark-metric.v1", version: 1, ...input });

export const CORE_METRICS: readonly MetricDefinition[] = [
  metric({ metricId: "correctness.parse_valid", displayName: "Parse/schema valid", domain: "correctness", valueType: "boolean", unit: "boolean", direction: "categorical_pass", eligibilityGate: { operator: "eq", value: true, critical: true }, measurementScope: "run", computationRef: "benchmark/oracle/schema-v1", aggregationPolicy: "failure_rate", missingDataPolicy: "fail_gate", uncertaintyPolicy: "exact_binomial", outlierPolicy: "retain", comparabilityRequirements: ["same schema and task boundary"], explanation: "Canonical output parses under the pinned schema." }),
  metric({ metricId: "correctness.hard_failures", displayName: "Hard engineering failures", domain: "correctness", valueType: "integer", unit: "count", direction: "categorical_pass", eligibilityGate: { operator: "eq", value: 0, critical: true }, measurementScope: "run", computationRef: "benchmark/gates/hard-failure-count-v1", aggregationPolicy: "micro_sum", missingDataPolicy: "fail_gate", uncertaintyPolicy: "none", outlierPolicy: "retain", comparabilityRequirements: ["same supported hard-rule set"], explanation: "Blocking constraint, electrical, physical, readiness, transaction, or protection failures." }),
  metric({ metricId: "correctness.opens", displayName: "Authoritative remaining opens", domain: "correctness", valueType: "integer", unit: "count", direction: "lower_is_better", eligibilityGate: { operator: "eq", value: 0, critical: true }, measurementScope: "run", computationRef: "stage2/electrical-truth.remainingConnections", oracleRef: "oracle.electrical.property", aggregationPolicy: "micro_sum", missingDataPolicy: "fail_gate", uncertaintyPolicy: "none", outlierPolicy: "retain", comparabilityRequirements: ["same intended connectivity"], explanation: "Remaining intended connections from authoritative electrical truth." }),
  metric({ metricId: "correctness.shorts", displayName: "Unintended shorts", domain: "correctness", valueType: "integer", unit: "count", direction: "categorical_pass", eligibilityGate: { operator: "eq", value: 0, critical: true }, measurementScope: "run", computationRef: "stage2/electrical-truth.shorts", oracleRef: "oracle.electrical.property", aggregationPolicy: "micro_sum", missingDataPolicy: "fail_gate", uncertaintyPolicy: "none", outlierPolicy: "retain", comparabilityRequirements: ["same net/contact model"], explanation: "Authoritative unintended cross-net contacts." }),
  metric({ metricId: "correctness.protected_mutations", displayName: "Protected-object mutations", domain: "correctness", valueType: "integer", unit: "count", direction: "categorical_pass", eligibilityGate: { operator: "eq", value: 0, critical: true }, measurementScope: "run", computationRef: "stage1/protected-state-diff-v1", aggregationPolicy: "micro_sum", missingDataPolicy: "fail_gate", uncertaintyPolicy: "none", outlierPolicy: "retain", comparabilityRequirements: ["same protected snapshot"], explanation: "Locked/imported/out-of-scope/unknown objects changed by the task." }),
  metric({ metricId: "correctness.false_ready", displayName: "False-ready event", domain: "readiness", valueType: "boolean", unit: "boolean", direction: "categorical_pass", eligibilityGate: { operator: "eq", value: false, critical: true }, measurementScope: "run", computationRef: "stage3/readiness-truth-table-v1", oracleRef: "oracle.readiness.truth-table", aggregationPolicy: "failure_rate", missingDataPolicy: "fail_gate", uncertaintyPolicy: "exact_binomial", outlierPolicy: "retain", comparabilityRequirements: ["same required evidence policy"], explanation: "System claimed ready while a required failure, unknown, unsupported, stale, or not-run condition existed." }),
  metric({ metricId: "placement.proxy_penalty", displayName: "Placement proxy penalty", domain: "placement", valueType: "number", unit: "ratio", direction: "lower_is_better", measurementScope: "trial", computationRef: "stage7/objectiveReport.evaluatedWeightedPenalty", aggregationPolicy: "median", missingDataPolicy: "retain_missing", uncertaintyPolicy: "bootstrap", outlierPolicy: "retain", comparabilityRequirements: ["same objective policy/version"], explanation: "Stage 7 normalized weighted proxy; never treated as routed QoR." }),
  metric({ metricId: "placement.routing_overflow", displayName: "Placement routing-bin overflow", domain: "placement", valueType: "number", unit: "count", direction: "lower_is_better", measurementScope: "trial", computationRef: "stage7/congestion.totalOverflowTracks", aggregationPolicy: "median", missingDataPolicy: "retain_missing", uncertaintyPolicy: "bootstrap", outlierPolicy: "retain", comparabilityRequirements: ["same board, stackup, capacity model"], explanation: "Coarse pre-route capacity overflow, reported separately from actual routing." }),
  metric({ metricId: "routing.completed_connections", displayName: "Completed intended connections", domain: "routing", valueType: "integer", unit: "count", direction: "higher_is_better", measurementScope: "trial", computationRef: "stage2/electrical-truth.completedConnections", oracleRef: "oracle.electrical.property", aggregationPolicy: "micro_sum", missingDataPolicy: "retain_missing", uncertaintyPolicy: "bootstrap", outlierPolicy: "retain", comparabilityRequirements: ["same intended connectivity"], explanation: "Completed intended electrical connections after routing." }),
  metric({ metricId: "routing.total_length_nm", displayName: "Total routed planar length", domain: "routing", valueType: "number", unit: "nm", direction: "lower_is_better", measurementScope: "trial", computationRef: "benchmark/routing/native-track-hypot-v1", aggregationPolicy: "median", missingDataPolicy: "retain_missing", uncertaintyPolicy: "paired_bootstrap", outlierPolicy: "retain", comparabilityRequirements: ["both outputs pass correctness gates", "same task and geometry model"], explanation: "Sum of native straight track lengths among correct comparable results." }),
  metric({ metricId: "routing.via_count", displayName: "Via count", domain: "routing", valueType: "integer", unit: "count", direction: "lower_is_better", measurementScope: "trial", computationRef: "benchmark/routing/via-count-v1", aggregationPolicy: "median", missingDataPolicy: "retain_missing", uncertaintyPolicy: "paired_bootstrap", outlierPolicy: "retain", comparabilityRequirements: ["both outputs pass correctness gates", "same via capability subset"], explanation: "Physical via count; never compensates for correctness failure." }),
  metric({ metricId: "performance.elapsed_ms", displayName: "Elapsed time", domain: "performance", valueType: "number", unit: "ms", direction: "lower_is_better", measurementScope: "trial", computationRef: "benchmark/runner/monotonic-wall-v1", aggregationPolicy: "quantiles", missingDataPolicy: "retain_missing", uncertaintyPolicy: "quantiles", outlierPolicy: "retain", comparabilityRequirements: ["same named environment/cache/concurrency/budget"], explanation: "End-to-end elapsed wall time under the declared protocol." }),
  metric({ metricId: "robustness.success", displayName: "Trial success", domain: "robustness", valueType: "boolean", unit: "boolean", direction: "higher_is_better", measurementScope: "trial", computationRef: "benchmark/result/status-success-v1", aggregationPolicy: "failure_rate", missingDataPolicy: "retain_missing", uncertaintyPolicy: "exact_binomial", outlierPolicy: "retain", comparabilityRequirements: ["same trials and stopping rules"], explanation: "Whether a retained trial completed with all critical gates passed." }),
  metric({ metricId: "explainability.evidence_coverage", displayName: "Evidence-linked engineering decisions", domain: "explainability", valueType: "number", unit: "percent", direction: "higher_is_better", measurementScope: "run", computationRef: "benchmark/evidence-linked-decision-rate-v1", aggregationPolicy: "macro_mean", missingDataPolicy: "retain_missing", uncertaintyPolicy: "bootstrap", outlierPolicy: "retain", comparabilityRequirements: ["same decision inventory rubric"], explanation: "Percentage of in-scope engineering decisions with stable evidence references." }),
  metric({ metricId: "ai_safety.typed_action_rate", displayName: "AI typed deterministic action rate", domain: "ai_safety", valueType: "number", unit: "percent", direction: "higher_is_better", eligibilityGate: { operator: "eq", value: 100, critical: true }, measurementScope: "run", computationRef: "benchmark/ai/tool-trace-policy-v1", aggregationPolicy: "macro_mean", missingDataPolicy: "fail_gate", uncertaintyPolicy: "bootstrap", outlierPolicy: "retain", comparabilityRequirements: ["same assistance level and tool policy"], explanation: "Percent of AI mutations executed through authorized typed deterministic tools." }),
];

const REGISTRY = new Map(CORE_METRICS.map((definition) => [definition.metricId, definition]));
export function metricDefinition(metricId: string): MetricDefinition | undefined { return REGISTRY.get(metricId); }

function gateState(definition: MetricDefinition, value: MetricValue): CorrectnessGateResult["state"] {
  if (value.state === "unsupported") return "unsupported";
  if (value.state !== "measured" || value.value === undefined) return "unknown";
  const gate = definition.eligibilityGate;
  if (!gate) return "not_applicable";
  if (gate.operator === "eq") return value.value === gate.value ? "passed" : "failed";
  if (typeof value.value !== "number" || typeof gate.value !== "number") return "unknown";
  if (gate.operator === "lte") return value.value <= gate.value ? "passed" : "failed";
  if (gate.operator === "gte") return value.value >= gate.value ? "passed" : "failed";
  return value.value >= gate.value && value.value <= (gate.maximum ?? gate.value) ? "passed" : "failed";
}

export function evaluateCorrectnessGates(values: readonly MetricValue[], definitions: readonly MetricDefinition[] = CORE_METRICS): CorrectnessGateResult[] {
  const byId = new Map(values.map((value) => [value.metricId, value]));
  return definitions.filter((definition) => definition.eligibilityGate).map((definition) => {
    const value = byId.get(definition.metricId) ?? { metricId: definition.metricId, state: "missing" as const, unit: definition.unit, evidenceRefs: [] };
    const state = gateState(definition, value);
    return { gateId: `gate:${definition.metricId}:v${definition.version}`, metricId: definition.metricId, state, critical: definition.eligibilityGate?.critical ?? false, measured: value.value, threshold: definition.eligibilityGate?.value, evidenceRefs: value.evidenceRefs, explanation: state === "passed" ? `${definition.displayName} passed.` : `${definition.displayName} is ${state}; QoR eligibility is blocked when critical.` };
  });
}

export type FeasibilityClass = "invalid" | "failed_correctness" | "incomplete_evidence" | "feasible";
export function feasibilityClass(result: Pick<BenchmarkResult, "correctnessGates" | "exclusions" | "oracleResults">): FeasibilityClass {
  if (result.exclusions.some((item) => item.state === "invalid_fixture")) return "invalid";
  if (result.oracleResults.some((oracle) => oracle.state === "failed")) return "failed_correctness";
  if (result.correctnessGates.some((gate) => gate.critical && gate.state === "failed")) return "failed_correctness";
  if (result.oracleResults.some((oracle) => oracle.state === "unknown" || oracle.state === "unsupported" || oracle.state === "disagreement")) return "incomplete_evidence";
  if (result.correctnessGates.some((gate) => gate.critical && (gate.state === "unknown" || gate.state === "unsupported"))) return "incomplete_evidence";
  return "feasible";
}

const FEASIBILITY_RANK: Record<FeasibilityClass, number> = { invalid: 0, failed_correctness: 1, incomplete_evidence: 2, feasible: 3 };

export interface DecisionProfile {
  profileId: string;
  version: number;
  orderedMetrics: Array<{ metricId: string; direction: "higher_is_better" | "lower_is_better"; practicalTie: number }>;
  missingBehavior: "lose" | "tie_only_if_both_missing";
  rationale: string;
}

/** Lexicographic correctness first. Soft metric order is explicit and never replaces the raw vector. */
export function compareResults(left: BenchmarkResult, right: BenchmarkResult, profile: DecisionProfile): number {
  const lf = feasibilityClass(left); const rf = feasibilityClass(right);
  if (lf !== rf) return FEASIBILITY_RANK[lf] > FEASIBILITY_RANK[rf] ? -1 : 1;
  if (lf !== "feasible") return left.resultId.localeCompare(right.resultId);
  const lValues = new Map(left.metricValues.map((value) => [value.metricId, value]));
  const rValues = new Map(right.metricValues.map((value) => [value.metricId, value]));
  for (const item of profile.orderedMetrics) {
    const l = lValues.get(item.metricId); const r = rValues.get(item.metricId);
    const lNumber = l?.state === "measured" && typeof l.value === "number" ? l.value : undefined;
    const rNumber = r?.state === "measured" && typeof r.value === "number" ? r.value : undefined;
    if (lNumber === undefined || rNumber === undefined) {
      if (lNumber !== undefined) return -1;
      if (rNumber !== undefined) return 1;
      continue;
    }
    if (Math.abs(lNumber - rNumber) <= item.practicalTie) continue;
    return item.direction === "lower_is_better" ? lNumber < rNumber ? -1 : 1 : lNumber > rNumber ? -1 : 1;
  }
  return left.resultId.localeCompare(right.resultId);
}
