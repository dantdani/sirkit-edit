import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { builtinBenchmarkExecutor } from "../app/lib/benchmark/builtin-executor";
import { STAGE9_CORPUS_PACKAGES, STAGE9_CORPUS_V1 } from "../app/lib/benchmark/corpus-v1";
import { evaluatePromotion } from "../app/lib/benchmark/promotion";
import { runBenchmarkPackage } from "../app/lib/benchmark/runner";
import { canonicalBenchmarkJson } from "../app/lib/benchmark/stable";
import { finalizeExperiment } from "../app/lib/benchmark/validation";

const root = process.cwd(); const artifactRoot = path.join(root, "artifacts", "stage-09");
const revision = (JSON.parse(readFileSync(path.join(artifactRoot, "baseline-index.json"), "utf8")) as { codeRevision: string }).codeRevision;
const experiment = finalizeExperiment({
  schemaVersion: "sirkit.benchmark-experiment.v1", experimentId: "experiment:placement-candidate-allocation-v1", hypothesis: "Additional deterministic Stage 7 starts reduce proxy penalty or physical routing overflow without legality regressions.", owner: "stage9:qor", preRegisteredAt: "2026-07-17T00:00:00.000Z", baselineRevision: revision,
  tunableParameters: [{ parameterId: "stage7.candidate_count", valueType: "integer", unit: "count", allowedValues: [1, 2, 3, 4], minimum: 1, maximum: 4, defaultValue: 2, safetyBounds: "1..8; no hard-rule changes", algorithmVersion: "stage7-placement/1" }],
  fixedParameters: { maxIterations: 100, localRefinementPasses: 0, seeds: [11, 12, 13] }, corpusPartitions: ["tuning", "validation"], primaryMetrics: ["placement.proxy_penalty", "placement.routing_overflow"], guardrailMetrics: ["correctness.hard_failures"], statisticalPlan: "Paired retained trials; tuning selects a candidate count, validation confirms direction. Minimum three independent families required for promotion.", stoppingRule: "Evaluate candidate counts 1,2,3,4 once on the preregistered tuning package; do not inspect holdout.", multipleComparisonPolicy: "Final untouched validation; no holdout access.", successCriteria: ["zero legality regression", "practically lower proxy penalty or overflow", "confirmed across at least three independent families"], rollbackCriteria: ["any hard-gate regression", "runtime increase without practical QoR gain", "validation direction reversal"],
});

async function writeExclusive(file: string, value: unknown): Promise<void> { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, `${canonicalBenchmarkJson(value)}\n`, { flag: "wx" }); }

async function run() {
  const experimentDir = path.join(artifactRoot, "experiments", experiment.experimentId.replaceAll(":", "_"));
  await writeExclusive(path.join(experimentDir, "spec.json"), experiment);
  const tuning = STAGE9_CORPUS_PACKAGES.find((item) => item.packageId.endsWith("placement-density-tune"))!;
  const options = { artifactRoot, repositoryRoot: root, suiteId: experiment.experimentId, corpusVersion: STAGE9_CORPUS_V1.version, productUnderTest: "Sirkit", productVersion: "stage7-placement-current", codeRevision: revision, randomSeeds: [11, 12, 13], cacheState: "cold" as const, scope: "local" as const };
  const tuningRuns = [];
  for (const candidateCount of [1, 2, 3, 4]) {
    const stored = await runBenchmarkPackage(tuning, builtinBenchmarkExecutor, { ...options, configuration: { candidateCount, maxIterations: 100 } });
    const proxy = stored.result.metricValues.find((metric) => metric.metricId === "placement.proxy_penalty")?.value;
    const overflow = stored.result.metricValues.find((metric) => metric.metricId === "placement.routing_overflow")?.value;
    tuningRuns.push({ candidateCount, runId: stored.run.runId, status: stored.run.status, proxy, overflow, elapsedMs: stored.result.metricValues.find((metric) => metric.metricId === "performance.elapsed_ms")?.value });
  }
  const feasible = tuningRuns.filter((item) => item.status === "passed").sort((a, b) => Number(a.overflow) - Number(b.overflow) || Number(a.proxy) - Number(b.proxy) || Number(a.elapsedMs) - Number(b.elapsedMs) || a.candidateCount - b.candidateCount);
  const selected = feasible[0]?.candidateCount ?? 2;
  const validation = STAGE9_CORPUS_PACKAGES.find((item) => item.packageId.endsWith("placement-validation"))!;
  const baseline = await runBenchmarkPackage(validation, builtinBenchmarkExecutor, { ...options, suiteId: `${experiment.experimentId}:validation:baseline`, configuration: { candidateCount: 2, maxIterations: 100 } });
  const candidate = await runBenchmarkPackage(validation, builtinBenchmarkExecutor, { ...options, suiteId: `${experiment.experimentId}:validation:candidate`, configuration: { candidateCount: selected, maxIterations: 100 } });
  const decision = evaluatePromotion({ spec: experiment, baseline: [baseline.result], candidate: [candidate.result], baselinePairKeys: [validation.packageId], candidatePairKeys: [validation.packageId], minimumPairs: 3, metricDirections: { "placement.proxy_penalty": "lower", "placement.routing_overflow": "lower" }, practicalThresholds: { "placement.proxy_penalty": 0.001, "placement.routing_overflow": 1 } });
  const report = { schema: "sirkit.benchmark-experiment-result.v1", experimentId: experiment.experimentId, tuningRuns, selectedCandidateCount: selected, validation: { packageId: validation.packageId, baselineRunId: baseline.run.runId, candidateRunId: candidate.run.runId }, decision, holdoutAccessed: false, promoted: decision.state === "promote" };
  await writeExclusive(path.join(experimentDir, "result.json"), report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
run().catch((error) => { process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`); process.exitCode = 1; });
