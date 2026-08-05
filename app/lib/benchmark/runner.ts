import { cpus, platform, arch, totalmem } from "node:os";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { candidateVisiblePackage, licenseAllows } from "./governance";
import { evaluateCorrectnessGates, CORE_METRICS } from "./metrics";
import { evaluateAnalyticalOracle, resolveOracleConsensus } from "./oracles";
import { ImmutableBenchmarkStore, type StoredRunBundle } from "./result-store";
import { assertArtifactSafe } from "./security";
import { benchmarkDigest, benchmarkStableId, canonicalBenchmarkJson, withoutDigest } from "./stable";
import { quantile } from "./statistics";
import type { BenchmarkPackage, BenchmarkResult, BenchmarkRun, BenchmarkRunStatus, CapabilityState, EnvironmentProfile, MetricValue, OracleResult } from "./types";
import { validateBenchmarkPackage, validateRunManifest } from "./validation";

export interface BenchmarkExecutionOutput {
  output: Record<string, unknown>;
  metrics: MetricValue[];
  capabilities?: Array<{ capabilityId: string; state: CapabilityState; evidenceRefs?: string[]; explanation: string }>;
  warnings?: string[];
  artifacts?: Array<{ name: string; kind: string; content: string; access?: "public" | "internal" | "restricted" }>;
}

export interface BenchmarkExecutorInput {
  package: BenchmarkPackage;
  seed: number;
  trial: number;
  workspace: string;
  signal: AbortSignal;
  configuration: Readonly<Record<string, unknown>>;
}

export type BenchmarkExecutor = (input: BenchmarkExecutorInput) => Promise<BenchmarkExecutionOutput>;

export interface BenchmarkRunnerOptions {
  artifactRoot: string;
  repositoryRoot: string;
  suiteId: string;
  corpusVersion: number;
  productUnderTest: string;
  productVersion: string;
  codeRevision: string;
  configuration?: Record<string, unknown>;
  randomSeeds?: number[];
  cacheState?: EnvironmentProfile["cacheState"];
  scope?: "local" | "ci" | "internal_report" | "public_report";
  abortSignal?: AbortSignal;
  assistanceProtocol?: BenchmarkRun["assistanceProtocol"];
}

async function dependencyDigest(repositoryRoot: string): Promise<string> {
  for (const filename of ["pnpm-lock.yaml", "package-lock.json", "yarn.lock"]) {
    try { return benchmarkDigest({ filename, content: await readFile(path.join(repositoryRoot, filename), "utf8") }); } catch { /* try next */ }
  }
  return benchmarkDigest({ missing: "dependency-lock" });
}

export function captureEnvironment(input: { cacheState: EnvironmentProfile["cacheState"]; concurrency: number; memoryLimitMiB: number; network: EnvironmentProfile["networkPolicy"] }): EnvironmentProfile {
  const processors = cpus();
  const allowedEnvironment = ["CI", "NODE_ENV", "TZ", "LANG"].map((key) => ({ key, present: process.env[key] !== undefined }));
  return {
    profileId: benchmarkStableId("environment", { platform: platform(), arch: arch(), cpu: processors[0]?.model, cores: processors.length, node: process.version, ...input }),
    os: platform(), architecture: arch(), cpuModel: processors[0]?.model ?? "unknown", logicalCores: processors.length,
    memoryLimitMiB: Math.min(input.memoryLimitMiB, Math.round(totalmem() / 1_048_576)), runtimeVersions: { node: process.version, v8: process.versions.v8 },
    locale: Intl.DateTimeFormat().resolvedOptions().locale, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    envAllowlistDigest: benchmarkDigest(allowedEnvironment), networkPolicy: input.network, cacheState: input.cacheState,
    buildProfile: process.env.NODE_ENV ?? "test", concurrency: input.concurrency, externalTools: [],
  };
}

function aggregateMetrics(trials: readonly BenchmarkExecutionOutput[]): MetricValue[] {
  const metricIds = [...new Set(trials.flatMap((trial) => trial.metrics.map((metric) => metric.metricId)))].sort();
  return metricIds.map((metricId) => {
    const values = trials.map((trial) => trial.metrics.find((metric) => metric.metricId === metricId)).filter((value): value is MetricValue => value !== undefined);
    const measured = values.filter((value) => value.state === "measured");
    const numbers = measured.map((value) => value.value).filter((value): value is number => typeof value === "number");
    const booleans = measured.map((value) => value.value).filter((value): value is boolean => typeof value === "boolean");
    const strings = measured.map((value) => value.value).filter((value): value is string => typeof value === "string");
    const value = numbers.length === measured.length && numbers.length ? quantile(numbers, 0.5)! : booleans.length === measured.length && booleans.length ? booleans.every(Boolean) : strings.length === measured.length && new Set(strings).size === 1 ? strings[0] : undefined;
    const state = measured.length === values.length && value !== undefined ? "measured" as const : values.some((item) => item.state === "unsupported") ? "unsupported" as const : "missing" as const;
    return { metricId, ...(value === undefined ? {} : { value }), state, unit: values[0]?.unit ?? CORE_METRICS.find((metric) => metric.metricId === metricId)?.unit ?? "categorical", evidenceRefs: [...new Set(values.flatMap((item) => item.evidenceRefs))].sort(), explanation: `Aggregate retains ${values.length} trial value(s); numeric value is the median.` };
  });
}

function engineeringResultDigest(result: Omit<BenchmarkResult, "resultDigest">): string {
  return benchmarkDigest({
    ...result,
    performanceSamples: result.performanceSamples.map((sample) => ({ operation: sample.operation, cacheState: sample.cacheState, trial: sample.trial, ...(sample.seed === undefined ? {} : { seed: sample.seed }) })),
    metricValues: result.metricValues.filter((metric) => metric.metricId !== "performance.elapsed_ms"),
  });
}

async function executeWithTimeout(executor: BenchmarkExecutor, input: BenchmarkExecutorInput, timeoutMs: number, parent?: AbortSignal): Promise<BenchmarkExecutionOutput> {
  const controller = new AbortController();
  const abort = (): void => controller.abort(parent?.reason ?? new Error("cancelled"));
  parent?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
  try {
    return await Promise.race([
      executor({ ...input, signal: controller.signal }),
      new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true })),
    ]);
  } finally { clearTimeout(timer); parent?.removeEventListener("abort", abort); }
}

export async function runBenchmarkPackage(pkg: BenchmarkPackage, executor: BenchmarkExecutor, options: BenchmarkRunnerOptions): Promise<StoredRunBundle> {
  const packageDiagnostics = validateBenchmarkPackage(pkg);
  const seeds = options.randomSeeds?.length ? [...options.randomSeeds] : Array.from({ length: pkg.runBudgetProfile.trials }, (_, index) => index + 1);
  const configuration = structuredClone(options.configuration ?? {});
  const dependencyLockDigest = await dependencyDigest(options.repositoryRoot);
  const runId = benchmarkStableId("benchmark-run", { suiteId: options.suiteId, packageDigest: pkg.packageDigest, codeRevision: options.codeRevision, configuration, seeds, product: options.productVersion, cache: options.cacheState ?? "cold" });
  const store = new ImmutableBenchmarkStore(options.artifactRoot);
  const runDirectory = await store.initializeRun(runId);
  const environmentProfile = captureEnvironment({ cacheState: options.cacheState ?? "cold", concurrency: pkg.runBudgetProfile.concurrency, memoryLimitMiB: pkg.runBudgetProfile.memoryMiB, network: pkg.runBudgetProfile.network });
  const startedAt = new Date().toISOString();
  const sourceBefore = benchmarkDigest(pkg);
  const artifactRefs: BenchmarkRun["artifactRefs"] = [];
  const exclusions: BenchmarkResult["exclusions"] = [];
  const outputs: BenchmarkExecutionOutput[] = [];
  const oracleResults: OracleResult[] = [];
  const performanceSamples: BenchmarkResult["performanceSamples"] = [];
  let status: BenchmarkRunStatus = "passed";
  const license = licenseAllows(pkg.license, options.scope ?? "local");
  if (packageDiagnostics.some((item) => item.severity === "error")) { status = "invalid_fixture"; exclusions.push({ state: status, reason: packageDiagnostics.map((item) => item.code).join(","), evidenceRefs: [] }); }
  else if (!license.allowed) { status = "license_unavailable"; exclusions.push({ state: status, reason: license.reason, evidenceRefs: [] }); }
  else if (pkg.expectedCapabilityStates.some((item) => item.state === "blocked_by_prerequisite")) { status = "blocked_by_prerequisite"; exclusions.push({ state: status, reason: pkg.expectedCapabilityStates.filter((item) => item.state === "blocked_by_prerequisite").map((item) => item.reason).join("; "), evidenceRefs: [] }); }
  else if (pkg.expectedCapabilityStates.some((item) => item.state === "license_unavailable")) { status = "license_unavailable"; exclusions.push({ state: status, reason: "Required licensed external tool is unavailable.", evidenceRefs: [] }); }

  if (status === "passed") for (let trial = 0; trial < seeds.length; trial += 1) {
    const seed = seeds[trial]; const started = performance.now();
    try {
      const output = await executeWithTimeout(executor, { package: candidateVisiblePackage(structuredClone(pkg)), seed, trial, workspace: runDirectory, signal: options.abortSignal ?? new AbortController().signal, configuration }, pkg.runBudgetProfile.timeoutMs, options.abortSignal);
      const elapsedMs = performance.now() - started;
      const serialized = canonicalBenchmarkJson(output.output); assertArtifactSafe(serialized);
      if (Buffer.byteLength(serialized) > pkg.runBudgetProfile.outputMiB * 1_048_576) throw new Error("OUTPUT_BUDGET_EXCEEDED");
      const artifact = await store.writeArtifact(runId, `trial-${trial}/output.json`, `${serialized}\n`);
      artifactRefs.push({ artifactId: `trial:${trial}:output`, kind: "task-output", digest: artifact.digest, relativePath: `artifacts/trial-${trial}/output.json`, bytes: artifact.bytes, access: pkg.privacyClassification === "public" ? "public" : "restricted" });
      for (const extra of output.artifacts ?? []) {
        assertArtifactSafe(extra.content);
        const stored = await store.writeArtifact(runId, `trial-${trial}/${extra.name}`, extra.content);
        artifactRefs.push({ artifactId: `trial:${trial}:${extra.name}`, kind: extra.kind, digest: stored.digest, relativePath: `artifacts/trial-${trial}/${extra.name}`, bytes: stored.bytes, access: extra.access ?? "internal" });
      }
      outputs.push(output); performanceSamples.push({ operation: "package-execute", elapsedMs, cacheState: environmentProfile.cacheState, trial, seed });
      for (const oracle of pkg.oracleBundle) oracleResults.push(evaluateAnalyticalOracle(oracle, output.output));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const elapsedMs = performance.now() - started; performanceSamples.push({ operation: "package-execute", elapsedMs, cacheState: environmentProfile.cacheState, trial, seed });
      const aborted = options.abortSignal?.aborted;
      const trialStatus: BenchmarkRunStatus = aborted ? "cancelled" : /timeout/i.test(message) ? "timeout" : "crash";
      status = trialStatus; exclusions.push({ state: trialStatus, reason: message, evidenceRefs: [] });
    }
  }

  if (benchmarkDigest(pkg) !== sourceBefore) { status = "failed_correctness"; exclusions.push({ state: status, reason: "SOURCE_PACKAGE_MUTATED_DURING_RUN", evidenceRefs: [] }); }
  const consensus = resolveOracleConsensus(oracleResults);
  if (consensus.state === "oracle_disagreement") status = "oracle_disagreement";
  else if (consensus.state === "failed" && status === "passed") status = "failed_correctness";
  const metricValues = aggregateMetrics(outputs);
  if (performanceSamples.length) metricValues.push({ metricId: "performance.elapsed_ms", value: quantile(performanceSamples.map((sample) => sample.elapsedMs), 0.5)!, state: "measured", unit: "ms", evidenceRefs: artifactRefs.map((artifact) => artifact.artifactId), explanation: "Median retained trial elapsed time." });
  const correctnessGates = evaluateCorrectnessGates(metricValues, CORE_METRICS.filter((metric) => pkg.metricProfile.metricIds.includes(metric.metricId)));
  if (correctnessGates.some((gate) => gate.critical && gate.state === "failed") && status === "passed") status = "failed_correctness";
  else if (correctnessGates.some((gate) => gate.critical && (gate.state === "unknown" || gate.state === "unsupported")) && status === "passed") status = "completed_with_unknowns";
  const baseResult: Omit<BenchmarkResult, "resultDigest"> = {
    schemaVersion: "sirkit.benchmark-result.v1", resultId: benchmarkStableId("benchmark-result", { runId, package: pkg.packageDigest, code: options.codeRevision }), runId,
    correctnessGates, metricValues, objectiveVector: metricValues.filter((metric) => CORE_METRICS.find((definition) => definition.metricId === metric.metricId)?.domain !== "correctness").map((metric) => metric.metricId),
    capabilityStates: pkg.expectedCapabilityStates.map((item) => ({ capabilityId: item.capabilityId, state: item.state, evidenceRefs: [pkg.packageDigest], explanation: item.reason ?? `Package declares ${item.state}.` })),
    oracleResults, unsupportedEvidence: pkg.expectedCapabilityStates.filter((item) => item.state === "unsupported" || item.state === "blocked_by_prerequisite").map((item) => item.reason ?? item.capabilityId),
    warnings: [...new Set(outputs.flatMap((output) => output.warnings ?? []))], exclusions, performanceSamples, artifactDigests: artifactRefs.map((artifact) => artifact.digest),
    ...(status === "passed" || status === "completed_with_unknowns" ? {} : { failureSignature: benchmarkStableId("failure", { status, exclusions: exclusions.map((item) => item.reason).sort() }) }),
  };
  const result: BenchmarkResult = { ...baseResult, resultDigest: engineeringResultDigest(baseResult) };
  const run: BenchmarkRun = {
    schemaVersion: "sirkit.benchmark-run.v1", runId, suiteId: options.suiteId, corpusVersion: options.corpusVersion, packageId: pkg.packageId, packageDigest: pkg.packageDigest, partition: pkg.partition,
    productUnderTest: options.productUnderTest, productVersion: options.productVersion, codeRevision: options.codeRevision, buildProfile: environmentProfile.buildProfile, environmentProfile, dependencyLockDigest,
    randomSeeds: seeds, configuration, assistanceProtocol: options.assistanceProtocol ?? { level: "deterministic_engine", protocolVersion: "1.0.0", allowedMutations: [], humanInterventionPolicy: "none" },
    startTime: startedAt, endTime: new Date().toISOString(), status, inputDigests: pkg.canonicalInputs.filter((input) => !input.hidden).map((input) => input.digest), artifactRefs, resultDigest: result.resultDigest,
  };
  const manifestDiagnostics = validateRunManifest(run);
  if (manifestDiagnostics.length) throw new Error(`RUN_MANIFEST_INVALID:${manifestDiagnostics.map((item) => item.code).join(",")}`);
  return store.publish(run, result);
}

export function deterministicEngineeringDigest(result: BenchmarkResult): string {
  return engineeringResultDigest(withoutDigest(result as unknown as Record<string, unknown>, "resultDigest") as Omit<BenchmarkResult, "resultDigest">);
}

export function validateStoredResultDigest(result: BenchmarkResult): boolean {
  return deterministicEngineeringDigest(result) === result.resultDigest;
}
