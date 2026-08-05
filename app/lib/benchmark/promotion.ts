import { pairedBootstrap } from "./statistics";
import type { BenchmarkResult, ExperimentSpec } from "./types";
import { validateExperiment } from "./validation";

export interface PromotionDecision {
  state: "promote" | "reject" | "insufficient_evidence";
  reasons: string[];
  primaryEffects: Array<{ metricId: string; pairs: number; medianDelta: number | null; confidenceInterval95: [number, number] | null }>;
}

/** Guardrail evaluator. It cannot query hidden holdouts and it never changes metric thresholds. */
export function evaluatePromotion(input: { spec: ExperimentSpec; baseline: readonly BenchmarkResult[]; candidate: readonly BenchmarkResult[]; baselinePairKeys?: readonly string[]; candidatePairKeys?: readonly string[]; minimumPairs?: number; metricDirections: Readonly<Record<string, "lower" | "higher">>; practicalThresholds: Readonly<Record<string, number>> }): PromotionDecision {
  const reasons = validateExperiment(input.spec).map((item) => item.code);
  const baselineByRun = new Map(input.baseline.map((result, index) => [input.baselinePairKeys?.[index] ?? result.runId, result]));
  const pairs = input.candidate.map((candidate, index) => ({ candidate, baseline: baselineByRun.get(input.candidatePairKeys?.[index] ?? candidate.runId) })).filter((item): item is { candidate: BenchmarkResult; baseline: BenchmarkResult } => item.baseline !== undefined);
  if (!pairs.length) reasons.push("NO_PAIRED_RESULTS");
  else if (pairs.length < (input.minimumPairs ?? 3)) reasons.push("INSUFFICIENT_PAIRED_FAMILIES");
  for (const metricId of input.spec.guardrailMetrics) for (const pair of pairs) {
    const baselineGate = pair.baseline.correctnessGates.find((gate) => gate.metricId === metricId);
    const candidateGate = pair.candidate.correctnessGates.find((gate) => gate.metricId === metricId);
    if (baselineGate?.state === "passed" && candidateGate?.state !== "passed") reasons.push(`GUARDRAIL_REGRESSION:${metricId}`);
  }
  const primaryEffects = input.spec.primaryMetrics.map((metricId) => {
    const numeric = pairs.map((pair) => ({ baseline: pair.baseline.metricValues.find((metric) => metric.metricId === metricId), candidate: pair.candidate.metricValues.find((metric) => metric.metricId === metricId) })).filter((pair) => typeof pair.baseline?.value === "number" && pair.baseline.state === "measured" && typeof pair.candidate?.value === "number" && pair.candidate.state === "measured");
    const effect = pairedBootstrap({ baseline: numeric.map((pair) => pair.baseline!.value as number), candidate: numeric.map((pair) => pair.candidate!.value as number), lowerIsBetter: input.metricDirections[metricId] === "lower", practicalTie: input.practicalThresholds[metricId] ?? 0, iterations: 2_000, seed: 9 });
    const threshold = input.practicalThresholds[metricId] ?? 0; const direction = input.metricDirections[metricId];
    const confirmed = direction === "lower" ? (effect.confidenceInterval95?.[1] ?? Infinity) <= -threshold : (effect.confidenceInterval95?.[0] ?? -Infinity) >= threshold;
    if (!confirmed) reasons.push(`PRIMARY_NOT_CONFIRMED:${metricId}`);
    return { metricId, pairs: effect.pairs, medianDelta: effect.medianDelta, confidenceInterval95: effect.confidenceInterval95 };
  });
  const unique = [...new Set(reasons)].sort();
  return { state: unique.some((reason) => reason.startsWith("GUARDRAIL")) ? "reject" : unique.length ? "insufficient_evidence" : "promote", reasons: unique, primaryEffects };
}
