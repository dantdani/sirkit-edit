import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { builtinBenchmarkExecutor } from "../builtin-executor";
import { COMPETITIVE_CAPABILITY_REGISTRY } from "../capability-registry";
import { STAGE9_CORPUS_PACKAGES, STAGE9_CORPUS_V1 } from "../corpus-v1";
import { candidateVisiblePackage, detectSimilarityLeakage, licenseAllows } from "../governance";
import { compareResults, CORE_METRICS, evaluateCorrectnessGates, feasibilityClass, type DecisionProfile } from "../metrics";
import { evaluateAnalyticalOracle, resolveOracleConsensus } from "../oracles";
import { evaluatePromotion } from "../promotion";
import { evaluateRegressionResults, REGRESSION_BUDGETS, REGRESSION_SUITES, validateFlakyQuarantine, validateThresholdChange } from "../regression-policy";
import { ImmutableBenchmarkStore } from "../result-store";
import { runBenchmarkPackage, validateStoredResultDigest, type BenchmarkExecutor } from "../runner";
import { assertArtifactSafe, redactSecrets, resolveInside, validatePackagePath } from "../security";
import { benchmarkDigest, canonicalBenchmarkJson } from "../stable";
import { benjaminiHochberg, failureRate, pairedBootstrap, paretoFront, quantile, spearmanRankCorrelation } from "../statistics";
import type { BenchmarkResult, CorrectnessGateResult, ExperimentSpec, MetricValue } from "../types";
import { finalizeBenchmarkPackage, validateBenchmarkPackage, validateCorpusManifest, validateMetricDefinition, validateRunManifest } from "../validation";

function result(id: string, gates: CorrectnessGateResult[], values: MetricValue[]): BenchmarkResult {
  return { schemaVersion: "sirkit.benchmark-result.v1", resultId: id, runId: `run:${id}`, correctnessGates: gates, metricValues: values, objectiveVector: values.map((value) => value.metricId), capabilityStates: [], oracleResults: [], unsupportedEvidence: [], warnings: [], exclusions: [], performanceSamples: [], artifactDigests: [], resultDigest: benchmarkDigest({ id }) };
}

const gate = (state: CorrectnessGateResult["state"]): CorrectnessGateResult => ({ gateId: "gate:correctness", metricId: "correctness.hard_failures", state, critical: true, evidenceRefs: [], explanation: state });
const value = (metricId: string, number: number): MetricValue => ({ metricId, value: number, state: "measured", unit: metricId.includes("length") ? "nm" : "count", evidenceRefs: [] });

describe("Stage 9 schemas, corpus governance, and leakage", () => {
  it("keeps official capability hypotheses separate from measured QoR", () => {
    expect(COMPETITIVE_CAPABILITY_REGISTRY).toHaveLength(5);
    expect(COMPETITIVE_CAPABILITY_REGISTRY.every((item) => item.claimIsMeasuredQor === false && item.officialSourceUrl.startsWith("https://"))).toBe(true);
    expect(COMPETITIVE_CAPABILITY_REGISTRY.find((item) => item.vendor === "Synopsys")?.measurementStatus).toBe("not_comparable");
    expect(COMPETITIVE_CAPABILITY_REGISTRY.filter((item) => ["Cadence", "Altium"].includes(item.vendor)).every((item) => item.measurementStatus === "license_unavailable")).toBe(true);
  });
  it("content-addresses every package and validates corpus v1 without family leakage", () => {
    expect(STAGE9_CORPUS_PACKAGES.length).toBeGreaterThanOrEqual(18);
    expect(validateCorpusManifest(STAGE9_CORPUS_V1, STAGE9_CORPUS_PACKAGES)).toEqual([]);
    expect(detectSimilarityLeakage(STAGE9_CORPUS_PACKAGES)).toEqual([]);
    expect(new Set(STAGE9_CORPUS_PACKAGES.map((item) => item.packageDigest)).size).toBe(STAGE9_CORPUS_PACKAGES.length);
  });

  it("canonical digests ignore object insertion order but reject semantic changes", () => {
    expect(benchmarkDigest({ b: 2, a: 1 })).toBe(benchmarkDigest({ a: 1, b: 2 }));
    expect(benchmarkDigest({ b: 3, a: 1 })).not.toBe(benchmarkDigest({ a: 1, b: 2 }));
    expect(canonicalBenchmarkJson({ z: undefined, b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  });

  it("rejects unresolved licenses and detects family/source leakage", () => {
    const source = STAGE9_CORPUS_PACKAGES[0];
    const invalid = finalizeBenchmarkPackage({ ...source, packageId: "invalid:license", familyId: "family:invalid-license", license: { ...source.license, thirdPartyAssets: [{ assetId: "x", license: "unknown", resolved: false }] }, packageDigest: undefined } as never);
    expect(validateBenchmarkPackage(invalid).map((item) => item.code)).toContain("THIRD_PARTY_LICENSE_UNRESOLVED");
    expect(licenseAllows(invalid.license, "public_report").allowed).toBe(false);
    const leaked = finalizeBenchmarkPackage({ ...source, packageId: "leaked:copy", partition: "tuning", packageDigest: undefined } as never);
    expect(detectSimilarityLeakage([source, leaked])[0]?.reason).toBe("same family across partitions");
  });

  it("removes hidden inputs and all oracle expectations from candidate-visible packages", () => {
    const holdout = STAGE9_CORPUS_PACKAGES.find((item) => item.partition === "hiddenHoldout")!;
    const visible = candidateVisiblePackage(holdout);
    expect(visible.canonicalInputs.every((input) => !input.hidden)).toBe(true);
    expect(visible.oracleBundle).toEqual([]);
    expect(visible.hiddenAssets).toBeUndefined();
  });

  it("rejects malicious paths, executables, and secrets", () => {
    expect(() => resolveInside("C:\\safe", "..\\escape")).toThrow(/TRAVERSAL/);
    expect(() => validatePackagePath("assets/run.ps1")).toThrow(/EXECUTABLE/);
    const secret = `key=sk-${"a".repeat(32)}`;
    expect(redactSecrets(secret)).toMatchObject({ matches: 1 });
    expect(() => assertArtifactSafe(secret)).toThrow(/SECRET/);
  });
});

describe("Stage 9 correctness-first metrics and statistics", () => {
  it("validates typed metric semantics and evaluates missing critical evidence as unknown", () => {
    expect(CORE_METRICS.flatMap(validateMetricDefinition)).toEqual([]);
    const gates = evaluateCorrectnessGates([], [CORE_METRICS.find((item) => item.metricId === "correctness.false_ready")!]);
    expect(gates).toMatchObject([{ state: "unknown", critical: true }]);
  });

  it("never ranks an illegal shorter route above a legal route", () => {
    const profile: DecisionProfile = { profileId: "route-qor", version: 1, orderedMetrics: [{ metricId: "routing.total_length_nm", direction: "lower_is_better", practicalTie: 0 }], missingBehavior: "lose", rationale: "Legal routes only, then length." };
    const illegal = result("illegal", [gate("failed")], [value("routing.total_length_nm", 10)]);
    const legal = result("legal", [gate("passed")], [value("routing.total_length_nm", 1_000)]);
    expect(compareResults(legal, illegal, profile)).toBeLessThan(0);
  });

  it("keeps raw vectors while named profiles expose different Pareto tradeoffs", () => {
    const a = result("a", [gate("passed")], [value("routing.total_length_nm", 100), value("routing.via_count", 4)]);
    const b = result("b", [gate("passed")], [value("routing.total_length_nm", 120), value("routing.via_count", 1)]);
    const lengthFirst: DecisionProfile = { profileId: "length", version: 1, orderedMetrics: [{ metricId: "routing.total_length_nm", direction: "lower_is_better", practicalTie: 0 }], missingBehavior: "lose", rationale: "Length first." };
    const viasFirst: DecisionProfile = { profileId: "vias", version: 1, orderedMetrics: [{ metricId: "routing.via_count", direction: "lower_is_better", practicalTie: 0 }], missingBehavior: "lose", rationale: "Vias first." };
    expect(compareResults(a, b, lengthFirst)).toBeLessThan(0);
    expect(compareResults(a, b, viasFirst)).toBeGreaterThan(0);
    expect(a.metricValues.map((item) => item.value)).toEqual([100, 4]);
    expect(paretoFront([{ id: "a", feasible: true, values: { length: 100, vias: 4 } }, { id: "b", feasible: true, values: { length: 120, vias: 1 } }, { id: "illegal", feasible: false, values: { length: 1, vias: 0 } }], [{ metricId: "length", direction: "lower_is_better" }, { metricId: "vias", direction: "lower_is_better" }]).map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("computes known quantiles, rank correlation, paired uncertainty, correction, and visible failure denominators", () => {
    expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(spearmanRankCorrelation([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1);
    expect(spearmanRankCorrelation([1, 2, 3, 4], [40, 30, 20, 10])).toBeCloseTo(-1);
    const paired = pairedBootstrap({ baseline: [10, 10, 10, 10], candidate: [8, 9, 8, 9], lowerIsBetter: true, iterations: 500, seed: 9 });
    expect(paired).toMatchObject({ pairs: 4, wins: 4, losses: 0, meanDelta: -1.5 });
    expect(paired.confidenceInterval95?.[1]).toBeLessThan(0);
    expect(benjaminiHochberg([0.001, 0.02, 0.5])).toEqual([true, true, false]);
    expect(failureRate(["passed", "timeout", "crash", "unsupported"], ["passed"])).toEqual({ total: 4, successes: 1, failures: 3, rate: 0.75, denominators: { passed: 1, timeout: 1, crash: 1, unsupported: 1 } });
  });

  it("blocks oracle disagreement and catches intentionally corrupted analytical output", () => {
    const spec = STAGE9_CORPUS_PACKAGES[0].oracleBundle[0];
    const failed = evaluateAnalyticalOracle(spec, { stable: false, protectedMutations: 0 });
    expect(failed.state).toBe("failed");
    expect(resolveOracleConsensus([{ ...failed, state: "failed" }, { ...failed, oracleId: "other", state: "passed" }]).state).toBe("oracle_disagreement");
    expect(feasibilityClass({ ...result("oracle-failed", [gate("passed")], []), oracleResults: [failed] })).toBe("failed_correctness");
  });
});

describe("Stage 9 isolated immutable runner", () => {
  it("runs a production-backed package, pins a complete manifest, and publishes immutable evidence", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "sirkit-benchmark-"));
    const pkg = STAGE9_CORPUS_PACKAGES.find((item) => item.packageId.endsWith("stable-net-permutation"))!;
    const sourceDigest = benchmarkDigest(pkg);
    const stored = await runBenchmarkPackage(pkg, builtinBenchmarkExecutor, { artifactRoot: root, repositoryRoot: process.cwd(), suiteId: "test", corpusVersion: 1, productUnderTest: "Sirkit", productVersion: "stage9-test", codeRevision: "test-revision", randomSeeds: [11], cacheState: "cold" });
    expect(stored.run.status).toBe("passed");
    expect(validateRunManifest(stored.run)).toEqual([]);
    expect(validateStoredResultDigest(stored.result)).toBe(true);
    expect(benchmarkDigest(pkg)).toBe(sourceDigest);
    expect(stored.run.artifactRefs).toHaveLength(1);
    expect(JSON.parse(await readFile(path.join(stored.runDirectory, "run.json"), "utf8")).runId).toBe(stored.run.runId);
    await expect(runBenchmarkPackage(pkg, builtinBenchmarkExecutor, { artifactRoot: root, repositoryRoot: process.cwd(), suiteId: "test", corpusVersion: 1, productUnderTest: "Sirkit", productVersion: "stage9-test", codeRevision: "test-revision", randomSeeds: [11], cacheState: "cold" })).rejects.toThrow(/IMMUTABLE_RUN_EXISTS/);
  });

  it("retains timeout and crash as denominator-visible results", async () => {
    const pkg = STAGE9_CORPUS_PACKAGES[0];
    const timeoutPackage = finalizeBenchmarkPackage({ ...pkg, packageId: "test:timeout", familyId: "family:test-timeout", runBudgetProfile: { ...pkg.runBudgetProfile, timeoutMs: 5 }, packageDigest: undefined } as never);
    const slow: BenchmarkExecutor = async ({ signal }) => new Promise((resolve, reject) => { const timer = setTimeout(() => resolve({ output: {}, metrics: [] }), 100); signal.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }); });
    const root = await mkdtemp(path.join(tmpdir(), "sirkit-benchmark-timeout-"));
    const stored = await runBenchmarkPackage(timeoutPackage, slow, { artifactRoot: root, repositoryRoot: process.cwd(), suiteId: "timeout", corpusVersion: 1, productUnderTest: "Sirkit", productVersion: "test", codeRevision: "test", randomSeeds: [1] });
    expect(stored.run.status).toBe("timeout");
    expect(stored.result.exclusions).toMatchObject([{ state: "timeout" }]);
    expect(stored.result.performanceSamples).toHaveLength(1);
  });

  it("does not expose hidden oracle values to executors", async () => {
    const pkg = STAGE9_CORPUS_PACKAGES.find((item) => item.packageId.endsWith("private-replay-demo"))!;
    const checking: BenchmarkExecutor = async ({ package: visible }) => {
      expect(visible.oracleBundle).toEqual([]);
      expect(visible.hiddenAssets).toBeUndefined();
      expect(visible.canonicalInputs.every((item) => !item.hidden)).toBe(true);
      return { output: { rawPublic: false, aggregateAllowed: true }, metrics: [{ metricId: "correctness.parse_valid", value: true, state: "measured", unit: "boolean", evidenceRefs: [] }, { metricId: "correctness.hard_failures", value: 0, state: "measured", unit: "count", evidenceRefs: [] }] };
    };
    const root = await mkdtemp(path.join(tmpdir(), "sirkit-benchmark-hidden-"));
    expect((await runBenchmarkPackage(pkg, checking, { artifactRoot: root, repositoryRoot: process.cwd(), suiteId: "hidden", corpusVersion: 1, productUnderTest: "Sirkit", productVersion: "test", codeRevision: "test", randomSeeds: [1] })).run.status).toBe("passed");
  });

  it("detects tampered stored result digests", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "sirkit-benchmark-store-"));
    const store = new ImmutableBenchmarkStore(root);
    expect(() => store.runDirectory("../../escape")).toThrow(/RUN_ID_PATH_INVALID/);
    const clean = result("clean", [gate("passed")], [value("routing.via_count", 1)]);
    expect(validateStoredResultDigest({ ...clean, resultDigest: "sha256:deadbeef" })).toBe(false);
  });
});

describe("Stage 9 promotion and regression governance", () => {
  const experiment: ExperimentSpec = {
    schemaVersion: "sirkit.benchmark-experiment.v1", experimentId: "test:promotion", hypothesis: "A shorter correct route is useful.", owner: "test", preRegisteredAt: "2026-07-17T00:00:00.000Z", baselineRevision: "baseline", candidateRevision: "candidate",
    tunableParameters: [], fixedParameters: {}, corpusPartitions: ["validation"], primaryMetrics: ["routing.total_length_nm"], guardrailMetrics: ["correctness.hard_failures"], statisticalPlan: "Paired bootstrap across independent families.", stoppingRule: "Three declared families.", multipleComparisonPolicy: "One primary metric.", successCriteria: ["CI clears practical threshold"], rollbackCriteria: ["Any correctness regression"], specDigest: "",
  };

  it("rejects an apparent QoR improvement that regresses a critical guardrail", () => {
    const baseline = [1, 2, 3].map((n) => result(`b${n}`, [gate("passed")], [value("routing.total_length_nm", 100)]));
    const candidate = [1, 2, 3].map((n) => result(`c${n}`, [gate(n === 2 ? "failed" : "passed")], [value("routing.total_length_nm", 50)]));
    const decision = evaluatePromotion({ spec: experiment, baseline, candidate, baselinePairKeys: ["1", "2", "3"], candidatePairKeys: ["1", "2", "3"], metricDirections: { "routing.total_length_nm": "lower" }, practicalThresholds: { "routing.total_length_nm": 1 } });
    expect(decision.state).toBe("reject");
    expect(decision.reasons).toContain("GUARDRAIL_REGRESSION:correctness.hard_failures");
  });

  it("defines every required CI/manual tier and blocks denominator-visible failures", () => {
    expect(REGRESSION_SUITES).toHaveLength(8);
    expect(REGRESSION_BUDGETS.some((item) => item.metricId === "correctness.false_ready" && item.failureAction === "block")).toBe(true);
    expect(evaluateRegressionResults([result("bad", [gate("failed")], [])], ["failed_correctness"], "pull_request_correctness")).toMatchObject({ state: "block", statusDenominators: { failed_correctness: 1 } });
  });

  it("requires reviewed versioned threshold changes and visible time-bounded quarantines", () => {
    expect(validateThresholdChange({ metricId: "x", fromPolicyVersion: "1", toPolicyVersion: "1", rationale: "", beforeDistributionRef: "", afterDistributionRef: "", affectedClaimIds: [], reviewer: "", approved: false })).toEqual(expect.arrayContaining(["RATIONALE_REQUIRED", "DISTRIBUTIONS_REQUIRED", "POLICY_VERSION_MUST_CHANGE", "REVIEW_APPROVAL_REQUIRED"]));
    expect(validateFlakyQuarantine({ quarantineId: "q", owner: "", evidenceRef: "", scope: "", expiresAt: "2020-01-01", remediationPlan: "", denominatorVisible: false }, new Date("2026-07-17"))).toEqual(expect.arrayContaining(["QUARANTINE_FIELDS_REQUIRED", "DENOMINATOR_MUST_REMAIN_VISIBLE", "QUARANTINE_EXPIRY_INVALID"]));
  });
});
