/**
 * [B24-D1] The latency policy (D24-28, OD-212), the results writer's confinement (lead decision D15), the OD-30 headroom core and the
 * CI shape D1 adds: the `benchmark-latency` job (benchmark.yml, appended) and the start and headroom steps of `prompt-to-gerber`,
 * `page-browser-e2e` and `agent-boundary-suites` (lead decisions D8, D19, OD-30). Always on: no flag, no measurement, no write.
 *
 *  1. the catalogue is closed: ids unique, families and suites closed, the counts OD-234 states (view/read 20 and 200, edit 3 and 30,
 *     stream 5 and 50, workflow 1 and 10, every moved workload 1 and 10);
 *  2. every evaluation state: pass, block (the band AND the floor, on the p50; on the p95 only from 20 samples), sample_shortfall,
 *     unmeasured; the table prints every state;
 *  3. baseline_missing (lead decision D3): recorded and non-blocking while the latest committed version is the declared-without-values
 *     v1, printed BLOCKED and never pass; blocking against a planted latest version that holds runner values; unmeasured,
 *     sample_shortfall and block still blocking under v1; an empty results set is unmeasured for every metric;
 *  4. widening: every consecutive pair - a raised p50, p95, band or floor, or a dropped metric, without a change record
 *     validateThresholdChange accepts is UNREVIEWED_WIDENING; v1 to the first runner baseline is not a widening;
 *  5. the committed baseline parses, its latest version names every catalogued metric, and it is append-only (v1 declared);
 *  6. the writer's confinement: unset, relative and in-repository directories are each refused before any write, and a planted
 *     in-repository path does not exist afterwards (B22-A3's _pinned-ngspice.ts precedent; nothing here names a write primitive);
 *  7. headroom at 24:59 and 25:01 of 30, at 19:59 and 20:01 of 25, and a missing start (unknown, failing); the three jobs' limits read
 *     off the workflow;
 *  8. the benchmark-latency job's shape: 30 minutes, no `if:`, the directory in the job's env and the flag in the vitest step's env
 *     (exactly "1"), the step order (start with mkdir -p, install, the two suites with --no-file-parallelism, the gate, route-bench
 *     redirected into the directory, the headroom report, the always() upload), `if: success() || failure()` on the gate, route-bench
 *     and headroom steps, no continue-on-error, the permissions unchanged, no other job setting the flag, the gate script selecting
 *     only *.latency-results.json of the schema;
 *  9. the first and last steps of prompt-to-gerber, page-browser-e2e and agent-boundary-suites, each naming its own job; still exactly
 *     two "playwright test" lines; no new line ending in `pnpm exec vitest run`; the admission helper still derives the three jobs;
 * 10. the three names: the inventory's kinds, the census's classes (D16), and SIRKIT_JOB_STARTED_AT set only by the four start steps
 *     and read only by scripts/ci-job-headroom.ts.
 *
 * Failing first on 6acae24: the policy, the writer and the headroom core are absent, no job runs route-bench or a latency suite, and
 * no job has a start or headroom step (performance-and-reliability.md section 8). Files are read as text; nothing is written to disk
 * and no process is started.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { FLAG_INVENTORY } from "@/app/lib/deployment/flag-inventory";
import { ENVIRONMENT_NAMES } from "@/app/lib/deployment/environment-names";
import { NON_LIVE_GATES } from "@/app/lib/evaluation/live-suites";
import { OD30_HEADROOM_MINUTES, OD30_SPLIT_REQUIRED, OD30_START_UNKNOWN, headroom, parseStartedAt, readJobTimeoutMinutes, renderHeadroom } from "../ci-headroom";
import {
  BASELINE_MISSING_NOTE,
  LATENCY_BASELINE_MINIMUM_RUNS,
  LATENCY_BASELINE_SCHEMA,
  LATENCY_FAMILIES,
  LATENCY_FLOOR_MS,
  LATENCY_METRICS,
  LATENCY_NOISE_BAND_MINIMUM,
  LATENCY_P95_MINIMUM_SAMPLES,
  LATENCY_POLICY_VERSION,
  LATENCY_PRACTICAL_REGRESSION,
  LATENCY_RESULTS_SCHEMA,
  LATENCY_SUITES,
  baselineWideningProblems,
  declaredLatencyBaseline,
  defaultLatencyBudget,
  evaluateLatency,
  latencyBaselineProblems,
  latencyMetric,
  latencyResultsDocument,
  latencyResultsProblems,
  latencyVerdictLabel,
  latestLatencyBaseline,
  noiseBandFromRuns,
  proposeLatencyBaseline,
  renderLatencyTable,
  type LatencyBaselineDocument,
  type LatencyBaselineVersion,
  type LatencyEnvironment,
  type LatencyResultsDocument,
} from "../latency-policy";
import { BENCHMARK_DIR_ENV, BENCHMARK_FLAG_ENV, RESULTS_FILE_SUFFIX, benchmarkRequested, latencyEnvironment, resolveBenchmarkDirectory, writeLatencyResults } from "../latency-results-writer";
import { ciAdmission, readRepoText } from "./_ci-admission";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const read = readRepoText;
const lines = (path: string): string[] => read(path).split(NEWLINE);
const DETERMINISTIC = ".github/workflows/deterministic-manufacturing.yml";
const BENCHMARK = ".github/workflows/benchmark.yml";
const BASELINE = "artifacts/ai-control-plane-b24/latency-baseline.json";
const GATE_SCRIPT = "scripts/b24-latency-gate.ts";
const HEADROOM_SCRIPT = "scripts/ci-job-headroom.ts";
const JOB = "benchmark-latency";
const DIRECTORY = "/tmp/sirkit-b24-benchmark";
const STARTED_AT = "SIRKIT_JOB_STARTED_AT";
const yieldToLoop = (): Promise<void> => new Promise((done) => setImmediate(done));

const ENVIRONMENT: LatencyEnvironment = { platform: "linux", architecture: "x64", osRelease: "6.8.0-fake", image: "ubuntu24", node: "v24.0.0", cpu: "fake cpu", logicalCores: 4 };
const committedBaseline = (): LatencyBaselineDocument => JSON.parse(read(BASELINE)) as LatencyBaselineDocument;
/** A full results set: every catalogued metric with its full sample count, each sample `ms`. */
function results(ms: number | ((metricId: string) => number), overrides: Partial<Record<string, number[]>> = {}): LatencyResultsDocument[] {
  return LATENCY_SUITES.map((suite) => latencyResultsDocument({ suite, commit: "fake-commit", environment: ENVIRONMENT, metrics: LATENCY_METRICS.filter((entry) => entry.suite === suite).map((entry) => ({ metricId: entry.metricId, samples: overrides[entry.metricId] ?? Array.from({ length: entry.samples }, (_, index) => (typeof ms === "function" ? ms(entry.metricId) : ms) + index * 1e-6) })) }));
}
/** A runner baseline version: every metric at p50/p95 `ms`, the default budget. */
function runnerVersion(version: number, ms: number, policyVersion = LATENCY_POLICY_VERSION, extra: Partial<LatencyBaselineVersion> = {}): LatencyBaselineVersion {
  return { version, policyVersion, recordedAt: "2026-10-09T00:00:00.000Z", declaredWithoutValues: false, runIds: ["r1", "r2", "r3"], metrics: LATENCY_METRICS.map((entry) => ({ metricId: entry.metricId, p50: ms, p95: ms * 1.1, runIds: ["r1", "r2", "r3"], budget: defaultLatencyBudget() })), changeRecords: [], ...extra };
}
const withValues = (ms: number): LatencyBaselineDocument => ({ schema: LATENCY_BASELINE_SCHEMA, versions: [declaredLatencyBaseline("2026-10-09T00:00:00.000Z"), runnerVersion(2, ms)] });
const stateOf = (document: LatencyBaselineDocument, run: LatencyResultsDocument[], metricId: string) => evaluateLatency(run, document).verdicts.find((verdict) => verdict.metricId === metricId)!;
/** The lines of a job's block (its key line to the line before the next job key). */
function jobBlock(workflow: readonly string[], job: string): { start: number; end: number; lines: string[] } {
  const start = workflow.indexOf(`  ${job}:`);
  const next = workflow.findIndex((line, index) => index > start && /^ {2}[A-Za-z0-9_-]+:\s*$/.test(line));
  const end = next < 0 ? workflow.length - (workflow[workflow.length - 1] === "" ? 1 : 0) : next;
  return { start, end, lines: workflow.slice(start, end) };
}
/** Each step of a job: its lines (from `      - ` to the next step, continuation lines included); the job-level comment lines above the next job's key are not steps. */
function steps(block: readonly string[]): string[][] {
  const stepLines = block.filter((line) => /^ {6}/.test(line));
  const firsts = stepLines.flatMap((line, index) => (/^ {6}- /.test(line) ? [index] : []));
  return firsts.map((first, at) => stepLines.slice(first, firsts[at + 1] ?? stepLines.length));
}
const startLine = (job: string): string => `      - run: echo "${STARTED_AT}=$(date +%s)" >> "$GITHUB_ENV" # [B24-D1] OD-30: ${job}'s start`;
const headroomLines = (job: string): string[] => [`      - if: always() # [B24-D1] OD-30: ${job}'s headroom`, `        run: pnpm exec tsx ${HEADROOM_SCRIPT} ${DETERMINISTIC} ${job}`];
const WHOLE_FLAG = new RegExp(`(?<![A-Z0-9_])${BENCHMARK_FLAG_ENV}(?![A-Z0-9_])`);

describe("[B24-D1] the latency policy, the writer's confinement, the headroom core and the CI shape (D24-27, D24-28, OD-212, OD-30)", () => {
  it("1. the catalogue is closed: unique ids, closed families and suites, OD-234's counts (view/read 20 and 200, edit 3 and 30, stream 5 and 50, workflow 1 and 10, every moved workload 1 and 10), each added by B24-D1", () => {
    expect(new Set(LATENCY_METRICS.map((entry) => entry.metricId)).size).toBe(LATENCY_METRICS.length);
    expect(LATENCY_METRICS.length).toBe(16); // [B24-D1 review, 2026-10-09] was 15: + moved.redaction-linear-200-scrubs (the bound the first census scan missed)
    for (const entry of LATENCY_METRICS) {
      expect(LATENCY_FAMILIES, entry.metricId).toContain(entry.family);
      expect(LATENCY_SUITES, entry.metricId).toContain(entry.suite);
      expect(entry.metricId.startsWith(`${entry.family}.`), entry.metricId).toBe(true);
      expect(entry.addedBy).toBe("B24-D1");
      expect(entry.workload.length).toBeGreaterThan(20);
      const counts = { view: [20, 200], read: [20, 200], edit: [3, 30], stream: [5, 50], workflow: [1, 10], moved: [1, 10] }[entry.family];
      expect([entry.warmups, entry.samples], entry.metricId).toEqual(counts);
      expect(entry.family === "workflow" ? "b24-d1-latency-workflow" : "b24-d1-latency").toBe(entry.suite);
    }
    expect(LATENCY_METRICS.filter((entry) => entry.family === "moved").map((entry) => entry.metricId)).toEqual(["moved.observation-normalizer-huge-text", "moved.observation-normalizer-many-blocks", "moved.observation-normalizer-pathological-marks", "moved.observation-normalizer-structured-budget", "moved.pcb-sync-preflight-small-fixture", "moved.pcb-sync-aggregate-500-components", "moved.redaction-linear-200-scrubs"]); // [B24-D1 review, 2026-10-09] + the seventh
    expect([LATENCY_PRACTICAL_REGRESSION, LATENCY_NOISE_BAND_MINIMUM, LATENCY_FLOOR_MS, LATENCY_P95_MINIMUM_SAMPLES]).toEqual([0.1, 0.2, 1, 20]);
    expect(defaultLatencyBudget()).toEqual({ practicalRegression: 0.1, noiseBand: 0.2, direction: "lower_is_better", failureAction: "block", floorMs: 1 });
    expect(defaultLatencyBudget(0.35).noiseBand).toBe(0.35);
    expect(defaultLatencyBudget(0.05).noiseBand).toBe(0.2);
    expect(noiseBandFromRuns([100, 110, 130])).toBeCloseTo(Math.max(0.2, 30 / 110), 10);
    expect(noiseBandFromRuns([100, 101, 102])).toBe(0.2);
    expect(() => noiseBandFromRuns([100, 110])).toThrow(/LATENCY_BASELINE_RUNS_INSUFFICIENT/);
    // a results document: sorted samples, the stage-09 quantile, correctness verified; a foreign metric or an empty vector is refused
    const [first] = results(10);
    expect(latencyResultsProblems(first)).toEqual([]);
    expect(first!.metrics.every((entry) => entry.correctness === "verified" && entry.samples.every((sample, index) => index === 0 || sample >= entry.samples[index - 1]!))).toBe(true);
    expect(() => latencyResultsDocument({ suite: "b24-d1-latency", commit: "c", environment: ENVIRONMENT, metrics: [{ metricId: "no.such", samples: [1] }] })).toThrow(/LATENCY_METRIC_UNKNOWN/);
    expect(() => latencyResultsDocument({ suite: "b24-d1-latency", commit: "c", environment: ENVIRONMENT, metrics: [{ metricId: "view.pcb-fit-board", samples: [] }] })).toThrow(/LATENCY_SAMPLES_EMPTY/);
    expect(latencyResultsProblems({ ...first, schema: "sirkit.latency-results.v0" })).toContain("SCHEMA");
    expect(latencyResultsProblems({ ...first, metrics: [{ ...first!.metrics[0]!, correctness: "assumed" }] })).toContain(`CORRECTNESS:${first!.metrics[0]!.metricId}`);
    expect(LATENCY_RESULTS_SCHEMA).toBe("sirkit.latency-results.v1");
    // [B24-D1 review, 2026-10-09] a results file carries only its own suite's metrics (review security-4): a foreign metric is a problem, and the constructor refuses it
    const workflowMetric = LATENCY_METRICS.find((entry) => entry.suite === "b24-d1-latency-workflow")!;
    expect(latencyResultsProblems({ ...first, metrics: [...first!.metrics, { ...first!.metrics[0]!, metricId: workflowMetric.metricId }] })).toEqual([`METRIC_FOREIGN_SUITE:${workflowMetric.metricId}`]);
    expect(() => latencyResultsDocument({ suite: "b24-d1-latency-workflow", commit: "c", environment: ENVIRONMENT, metrics: [{ metricId: "view.pcb-fit-board", samples: [1] }] })).toThrow(/LATENCY_METRIC_FOREIGN_SUITE/);
    // [B24-D1 review, 2026-10-09] the silent-gap workload names the measurement the suite takes: the longest interval between two consecutive lines (review correctness-5)
    expect(latencyMetric("stream.silent-gap-ms").workload).toMatch(/longest interval between two consecutive NDJSON lines/);
  });

  it("2. every evaluation state: pass, block (the band AND the floor on the p50; the p95 only from 20 samples, reported below), sample_shortfall and unmeasured; the table prints every verdict", () => {
    const baseline = withValues(100);
    const pass = evaluateLatency(results(100), baseline);
    expect(pass.blocking).toBe(false);
    expect(new Set(pass.verdicts.map((verdict) => verdict.state))).toEqual(new Set(["pass"]));
    expect(pass).toMatchObject({ policyVersion: LATENCY_POLICY_VERSION, baselineVersion: 2, declaredWithoutValues: false });
    // the band: 100 * (1 + 0.1 + 0.2) = 130; 129 passes, 131 blocks (the floor of 1 ms is met far earlier)
    expect(stateOf(baseline, results(129), "view.pcb-fit-board").state).toBe("pass");
    const blocked = stateOf(baseline, results(131), "view.pcb-fit-board");
    expect(blocked).toMatchObject({ state: "block", blocking: true });
    expect(blocked.reasons[0]).toMatch(/^P50_REGRESSION:131/);
    // the floor: a baseline of 1 ms with the band would block at 1.3 ms; the floor of 1 ms holds the gate to 2 ms
    const tiny = withValues(1);
    expect(stateOf(tiny, results(1.9), "view.pcb-fit-board").state).toBe("pass");
    expect(stateOf(tiny, results(2.1), "view.pcb-fit-board").state).toBe("block");
    // the p95: a 200-sample metric whose p50 is at baseline but whose p95 regressed blocks on the p95; a 10-sample metric only reports it
    const spiky = (count: number, metricId: string): number[] => Array.from({ length: count }, (_, index) => (index >= Math.floor(count * 0.9) ? 1_000 : 100) + (metricId.length % 7) * 1e-6);
    const p95 = stateOf(baseline, results(100, { "view.pcb-fit-board": spiky(200, "view.pcb-fit-board") }), "view.pcb-fit-board");
    expect(p95.state).toBe("block");
    expect(p95.reasons.some((reason) => reason.startsWith("P95_REGRESSION:"))).toBe(true);
    const ten = stateOf(baseline, results(100, { "workflow.publish-preflight-apply-qualify-ms": spiky(10, "w") }), "workflow.publish-preflight-apply-qualify-ms");
    expect(ten.state).toBe("pass");
    expect(ten.reasons).toEqual(["P95_REPORTED_ONLY"]);
    expect(LATENCY_METRICS.find((entry) => entry.metricId === "workflow.publish-preflight-apply-qualify-ms")!.samples).toBeLessThan(LATENCY_P95_MINIMUM_SAMPLES);
    // sample_shortfall and unmeasured block
    const short = stateOf(baseline, results(100, { "read.via-inspect": [100, 100, 100] }), "read.via-inspect");
    expect(short).toMatchObject({ state: "sample_shortfall", blocking: true });
    const partial = results(100).map((document) => ({ ...document, metrics: document.metrics.filter((entry) => entry.metricId !== "edit.granted-move-footprint") }));
    const unmeasured = stateOf(baseline, partial, "edit.granted-move-footprint");
    expect(unmeasured).toMatchObject({ state: "unmeasured", blocking: true, measured: null });
    expect(evaluateLatency(partial, baseline).blocking).toBe(true);
    // [B24-D1 review, 2026-10-09] a metric measured in two results documents is refused, never overridden by the file read last (review security-4)
    expect(() => evaluateLatency([...results(100), results(100)[0]!], baseline)).toThrow(/LATENCY_RESULTS_METRIC_DOUBLED:view\.pcb-fit-board/);
    // the table names every metric and every state
    const table = renderLatencyTable(evaluateLatency(partial.map((document) => ({ ...document, metrics: document.metrics.map((entry) => (entry.metricId === "read.via-inspect" ? { ...entry, samples: [100, 100, 100] } : entry)) })), baseline));
    for (const entry of LATENCY_METRICS) expect(table).toContain(`| \`${entry.metricId}\` |`);
    for (const state of ["BLOCKING unmeasured", "BLOCKING sample_shortfall", "| pass"]) expect(table).toContain(state);
    expect(table).toContain("BLOCKING.");
  });

  it("3. baseline_missing (lead decision D3): recorded and non-blocking while the latest committed version is the declared-without-values v1, printed BLOCKED and never pass; blocking against a planted latest version with runner values; unmeasured, sample_shortfall and block still block under v1; an empty results set is unmeasured for every metric; the exception is v1's alone - a later declared version is refused and blocks", () => {
    const committed = committedBaseline();
    const v1 = committed.versions[0]!;
    expect(v1).toMatchObject({ version: 1, declaredWithoutValues: true });
    // [B24-D1 review, 2026-10-09] the D3 rule is tested against the committed v1 alone, so the lead's records commit (a runner v2) leaves this case green; case 5 checks the committed latest version (review security-3)
    const underV1: LatencyBaselineDocument = { schema: LATENCY_BASELINE_SCHEMA, versions: [v1] };
    const full = evaluateLatency(results(100), underV1);
    expect(full.blocking).toBe(false);
    expect(full.declaredWithoutValues).toBe(true);
    for (const verdict of full.verdicts) {
      expect(verdict, verdict.metricId).toMatchObject({ state: "baseline_missing", blocking: false, reasons: [BASELINE_MISSING_NOTE] });
      expect(latencyVerdictLabel(verdict)).toBe(`BLOCKED (${BASELINE_MISSING_NOTE})`);
      expect(latencyVerdictLabel(verdict)).not.toMatch(/pass/i);
    }
    const table = renderLatencyTable(full);
    expect(table.split(NEWLINE).filter((line) => line.includes("BLOCKED (OD-212/OD-30: baseline not recorded; Actions minutes not accepted)"))).toHaveLength(LATENCY_METRICS.length);
    expect(table).not.toMatch(/\| pass/);
    expect(table).toContain("not blocking.");
    // a planted latest version with runner values that lacks one metric: baseline_missing blocks there
    const planted: LatencyBaselineDocument = { schema: LATENCY_BASELINE_SCHEMA, versions: [v1, runnerVersion(2, 100, LATENCY_POLICY_VERSION, { metrics: runnerVersion(2, 100).metrics.filter((entry) => entry.metricId !== "view.pcb-fit-board") })] };
    const missing = stateOf(planted, results(100), "view.pcb-fit-board");
    expect(missing).toMatchObject({ state: "baseline_missing", blocking: true, reasons: ["BASELINE_MISSING"] });
    expect(latencyVerdictLabel(missing)).toBe("BLOCKING baseline_missing");
    expect(evaluateLatency(results(100), planted).blocking).toBe(true);
    // under v1 the other states still block
    expect(stateOf(underV1, results(100, { "read.via-inspect": [1, 2, 3] }), "read.via-inspect")).toMatchObject({ state: "sample_shortfall", blocking: true });
    expect(evaluateLatency([], underV1).verdicts.every((verdict) => verdict.state === "unmeasured" && verdict.blocking)).toBe(true);
    expect(evaluateLatency([], underV1).blocking).toBe(true);
    expect(evaluateLatency([], underV1).verdicts).toHaveLength(LATENCY_METRICS.length);
    // [B24-D1 review, 2026-10-09] the exception is v1's alone (review correctness-1, security-2): a declared-without-values version appended after a runner
    // version is refused by the shape validator (DECLARED_AFTER_V1), nulling every recorded value is an unreviewed widening (values_dropped), and
    // evaluateLatency blocks baseline_missing against it - the gate never re-arms the non-blocking state
    const v2 = runnerVersion(2, 100);
    const declaredLater: LatencyBaselineVersion = { ...declaredLatencyBaseline("2026-10-10T00:00:00.000Z"), version: 3 };
    const rearmed: LatencyBaselineDocument = { schema: LATENCY_BASELINE_SCHEMA, versions: [v1, v2, declaredLater] };
    expect(latencyBaselineProblems(rearmed)).toEqual(["DECLARED_AFTER_V1:v3"]);
    expect(baselineWideningProblems(rearmed)).toEqual(LATENCY_METRICS.map((entry) => `UNREVIEWED_WIDENING:v3:${entry.metricId}:values_dropped:CHANGE_RECORD_MISSING`));
    const rearmedRun = evaluateLatency(results(100), rearmed);
    expect(rearmedRun.blocking).toBe(true);
    for (const verdict of rearmedRun.verdicts) expect(verdict, verdict.metricId).toMatchObject({ state: "baseline_missing", blocking: true, reasons: ["BASELINE_MISSING"] });
    expect(renderLatencyTable(rearmedRun)).not.toContain(BASELINE_MISSING_NOTE);
    const declaredSecond: LatencyBaselineDocument = { schema: LATENCY_BASELINE_SCHEMA, versions: [v1, { ...declaredLater, version: 2 }] };
    expect(latencyBaselineProblems(declaredSecond)).toEqual(["DECLARED_AFTER_V1:v2"]);
    expect(evaluateLatency(results(100), declaredSecond).blocking).toBe(true);
    expect(evaluateLatency(results(100), declaredSecond).verdicts.every((verdict) => verdict.state === "baseline_missing" && verdict.blocking)).toBe(true);
  });

  it("4. widening: every consecutive pair - a raised p50, p95, noise band or floor, or a dropped metric, without a change record validateThresholdChange accepts, is UNREVIEWED_WIDENING; v1 to the first runner baseline is never a widening; a tightened version needs no record", () => {
    const v1 = declaredLatencyBaseline("2026-10-09T00:00:00.000Z");
    const v2 = runnerVersion(2, 100);
    expect(baselineWideningProblems({ schema: LATENCY_BASELINE_SCHEMA, versions: [v1, v2] })).toEqual([]);
    expect(baselineWideningProblems({ schema: LATENCY_BASELINE_SCHEMA, versions: [v1, runnerVersion(2, 100_000)] })).toEqual([]);
    const raised = runnerVersion(3, 100, LATENCY_POLICY_VERSION, { metrics: v2.metrics.map((entry) => (entry.metricId === "view.pcb-fit-board" ? { ...entry, p50: 150 } : entry)) });
    const problems = baselineWideningProblems({ schema: LATENCY_BASELINE_SCHEMA, versions: [v1, v2, raised] });
    expect(problems).toEqual(["UNREVIEWED_WIDENING:v3:view.pcb-fit-board:p50:CHANGE_RECORD_MISSING"]);
    const record = { metricId: "view.pcb-fit-board", fromPolicyVersion: LATENCY_POLICY_VERSION, toPolicyVersion: "sirkit.latency-policy/1.1.0", rationale: "the runner image changed", beforeDistributionRef: "runs r1-r3", afterDistributionRef: "runs r4-r6", affectedClaimIds: [], reviewer: "the lead", approved: true };
    const reviewed = { ...raised, policyVersion: "sirkit.latency-policy/1.1.0", changeRecords: [record] };
    expect(baselineWideningProblems({ schema: LATENCY_BASELINE_SCHEMA, versions: [v1, v2, reviewed] })).toEqual([]);
    // the record must pass validateThresholdChange: an unchanged policy version, no reviewer, no approval, no rationale each refuse
    expect(baselineWideningProblems({ schema: LATENCY_BASELINE_SCHEMA, versions: [v1, v2, { ...raised, changeRecords: [{ ...record, toPolicyVersion: LATENCY_POLICY_VERSION }] }] })[0]).toMatch(/POLICY_VERSION_MUST_CHANGE/);
    expect(baselineWideningProblems({ schema: LATENCY_BASELINE_SCHEMA, versions: [v1, v2, { ...reviewed, changeRecords: [{ ...record, approved: false }] }] })[0]).toMatch(/REVIEW_APPROVAL_REQUIRED/);
    expect(baselineWideningProblems({ schema: LATENCY_BASELINE_SCHEMA, versions: [v1, v2, { ...reviewed, changeRecords: [{ ...record, rationale: " " }] }] })[0]).toMatch(/RATIONALE_REQUIRED/);
    // the other widenings and a dropped metric
    const widen = (patch: Partial<LatencyBaselineVersion["metrics"][number]>): string[] => baselineWideningProblems({ schema: LATENCY_BASELINE_SCHEMA, versions: [v1, v2, runnerVersion(3, 100, LATENCY_POLICY_VERSION, { metrics: v2.metrics.map((entry) => (entry.metricId === "read.via-inspect" ? { ...entry, ...patch } : entry)) })] });
    expect(widen({ p95: 200 })).toEqual(["UNREVIEWED_WIDENING:v3:read.via-inspect:p95:CHANGE_RECORD_MISSING"]);
    expect(widen({ budget: { ...defaultLatencyBudget(), noiseBand: 0.3 } })).toEqual(["UNREVIEWED_WIDENING:v3:read.via-inspect:noiseBand:CHANGE_RECORD_MISSING"]);
    expect(widen({ budget: { ...defaultLatencyBudget(), floorMs: 2 } })).toEqual(["UNREVIEWED_WIDENING:v3:read.via-inspect:floorMs:CHANGE_RECORD_MISSING"]);
    expect(widen({ budget: { ...defaultLatencyBudget(), practicalRegression: 0.2 } })).toEqual(["UNREVIEWED_WIDENING:v3:read.via-inspect:practicalRegression:CHANGE_RECORD_MISSING"]);
    expect(baselineWideningProblems({ schema: LATENCY_BASELINE_SCHEMA, versions: [v1, v2, runnerVersion(3, 100, LATENCY_POLICY_VERSION, { metrics: v2.metrics.slice(1) })] })).toEqual([`UNREVIEWED_WIDENING:v3:${v2.metrics[0]!.metricId}:dropped:CHANGE_RECORD_MISSING`]);
    expect(baselineWideningProblems({ schema: LATENCY_BASELINE_SCHEMA, versions: [v1, v2, runnerVersion(3, 90)] })).toEqual([]);
    // [B24-D1 review, 2026-10-09] a recorded value nulled in a later version is a widening too (values_dropped), accepted only with a record (review correctness-1, security-2)
    expect(widen({ p50: null, p95: null, runIds: [] })).toEqual(["UNREVIEWED_WIDENING:v3:read.via-inspect:values_dropped:CHANGE_RECORD_MISSING"]);
    const nulled: LatencyBaselineVersion = { ...runnerVersion(3, 100, LATENCY_POLICY_VERSION, { metrics: v2.metrics.map((entry) => (entry.metricId === "read.via-inspect" ? { ...entry, p50: null, p95: null, runIds: [] } : entry)) }), policyVersion: "sirkit.latency-policy/1.1.0", changeRecords: [{ ...record, metricId: "read.via-inspect" }] };
    expect(baselineWideningProblems({ schema: LATENCY_BASELINE_SCHEMA, versions: [v1, v2, nulled] })).toEqual([]);
    // the proposal: medians over at least three runs, the band from the p95 spread, the next version number, nothing written
    const proposed = proposeLatencyBaseline({ runs: [{ runId: "r1", results: results(100) }, { runId: "r2", results: results(120) }, { runId: "r3", results: results(110) }], previous: { schema: LATENCY_BASELINE_SCHEMA, versions: [v1] }, recordedAt: "2026-10-10T00:00:00.000Z" });
    expect(proposed).toMatchObject({ version: 2, declaredWithoutValues: false, runIds: ["r1", "r2", "r3"], changeRecords: [] });
    const proposedView = proposed.metrics.find((entry) => entry.metricId === "view.pcb-fit-board")!;
    expect(proposedView.runIds).toEqual(["r1", "r2", "r3"]);
    expect(proposedView.p50).toBeCloseTo(110, 3);
    expect(proposedView.budget.noiseBand).toBe(LATENCY_NOISE_BAND_MINIMUM);
    expect(() => proposeLatencyBaseline({ runs: [{ runId: "r1", results: results(100) }], previous: { schema: LATENCY_BASELINE_SCHEMA, versions: [v1] }, recordedAt: "2026-10-10T00:00:00.000Z" })).toThrow(/LATENCY_BASELINE_RUNS_INSUFFICIENT/);
  });

  it("5. the committed baseline parses, is append-only from the declared-without-values v1 (the default budget), names every catalogued metric in its latest version with the stage-09 budget shape plus the floor, the band at least the minimum and never a maximumP95, and carries no widening", () => {
    const committed = committedBaseline();
    expect(latencyBaselineProblems(committed)).toEqual([]);
    expect(baselineWideningProblems(committed)).toEqual([]);
    expect(committed.versions[0]).toMatchObject({ version: 1, declaredWithoutValues: true, runIds: [], changeRecords: [] });
    for (const entry of committed.versions[0]!.metrics) expect(entry.budget, entry.metricId).toEqual(defaultLatencyBudget());
    expect(committed.versions.map((version) => version.version)).toEqual(committed.versions.map((_, index) => index + 1));
    const latest = latestLatencyBaseline(committed);
    expect(latest.metrics.map((entry) => entry.metricId)).toEqual(LATENCY_METRICS.map((entry) => entry.metricId));
    // [B24-D1 review, 2026-10-09] the latest version is declared only when it is v1; a runner version's band is the measured spread, at least the minimum
    // (OD-234), so its budget is checked by shape and never by equality with the default - the lead's records commit lands green (review security-3)
    expect(latest.declaredWithoutValues).toBe(latest.version === 1);
    for (const entry of latest.metrics) {
      expect(entry.budget, entry.metricId).toMatchObject({ practicalRegression: LATENCY_PRACTICAL_REGRESSION, direction: "lower_is_better", failureAction: "block", floorMs: LATENCY_FLOOR_MS });
      expect(entry.budget.noiseBand, entry.metricId).toBeGreaterThanOrEqual(LATENCY_NOISE_BAND_MINIMUM);
      expect("maximumP95" in entry.budget).toBe(false);
      if (!latest.declaredWithoutValues) {
        expect(entry.p50, entry.metricId).not.toBeNull();
        expect(entry.p95, entry.metricId).not.toBeNull();
        expect(entry.runIds.length, entry.metricId).toBeGreaterThanOrEqual(LATENCY_BASELINE_MINIMUM_RUNS);
      }
    }
    expect(read(BASELINE)).not.toContain("maximumP95");
    expect(read(BASELINE).endsWith(NEWLINE)).toBe(true);
    // [B24-D1 review, 2026-10-09] a declared version appended after the committed ones is refused (review correctness-1, security-2)
    expect(latencyBaselineProblems({ ...committed, versions: [...committed.versions, { ...committed.versions[0]!, version: committed.versions.length + 1 }] })).toEqual([`DECLARED_AFTER_V1:v${committed.versions.length + 1}`]);
    // the validator bites: a widened absolute target, a doubled metric, a value in a declared version
    expect(latencyBaselineProblems({ ...committed, versions: [{ ...committed.versions[0]!, metrics: committed.versions[0]!.metrics.map((entry) => ({ ...entry, budget: { ...entry.budget, maximumP95: 2_000 } })) }] })).toEqual(expect.arrayContaining(["BUDGET_ABSOLUTE_TARGET:v1:view.pcb-fit-board"]));
    expect(latencyBaselineProblems({ ...committed, versions: [{ ...committed.versions[0]!, metrics: [...committed.versions[0]!.metrics, committed.versions[0]!.metrics[0]!] }] })).toContain("METRIC_DOUBLED:v1:view.pcb-fit-board");
    expect(latencyBaselineProblems({ ...committed, versions: [{ ...committed.versions[0]!, metrics: committed.versions[0]!.metrics.map((entry, index) => (index === 0 ? { ...entry, p50: 5 } : entry)) }] })).toContain("VALUES:v1:view.pcb-fit-board");
    expect(latencyBaselineProblems({ ...committed, versions: [{ ...committed.versions[0]!, declaredWithoutValues: false }] })).toEqual(expect.arrayContaining(["V1_NOT_DECLARED"]));
  });

  it("6. the writer's confinement (lead decision D15): an unset, a blank, a relative and an in-repository directory are each refused before any write, the planted in-repository path does not exist afterwards, and the flag is exactly \"1\"", () => {
    const planted = join(ROOT, "artifacts", "ai-control-plane-b24", "b24-d1-planted-never-written");
    const document = results(10)[0]!;
    // [B24-D1 review, 2026-10-09] a repository child whose name starts with two dots is inside the repository (review security-1, correctness-3)
    const dotted = join(ROOT, "..planted");
    for (const [label, env, refusal] of [["unset", {}, "unset"], ["blank", { [BENCHMARK_DIR_ENV]: "  " }, "unset"], ["relative", { [BENCHMARK_DIR_ENV]: "artifacts/benchmark" }, "relative"], ["the repository root", { [BENCHMARK_DIR_ENV]: ROOT }, "inside_repository"], ["inside the repository", { [BENCHMARK_DIR_ENV]: planted }, "inside_repository"], ["a child named with two dots", { [BENCHMARK_DIR_ENV]: dotted }, "inside_repository"], ["a nested child of it", { [BENCHMARK_DIR_ENV]: join(dotted, "deeper") }, "inside_repository"], ["a child named with three dots", { [BENCHMARK_DIR_ENV]: join(ROOT, "...") }, "inside_repository"]] as const) {
      expect(resolveBenchmarkDirectory(env, ROOT), label).toEqual({ ok: false, refusal });
      expect(() => writeLatencyResults(document, env, ROOT), label).toThrow(new RegExp(`^LATENCY_RESULTS_DIR_REFUSED: ${BENCHMARK_DIR_ENV} ${refusal}$`));
    }
    expect(existsSync(planted)).toBe(false);
    expect(existsSync(join(planted, `${document.suite}${RESULTS_FILE_SUFFIX}`))).toBe(false);
    expect(existsSync(dotted)).toBe(false);
    expect(existsSync(join(ROOT, "..."))).toBe(false);
    const outside = resolve(tmpdir(), "sirkit-b24-d1-policy-never-written");
    expect(resolveBenchmarkDirectory({ [BENCHMARK_DIR_ENV]: outside }, ROOT)).toEqual({ ok: true, directory: outside });
    expect(existsSync(outside)).toBe(false); // resolving never creates it
    // the repository's parent and a sibling are outside (`..` and `../<x>`)
    const sibling = resolve(ROOT, "..", "sirkit-b24-d1-policy-never-written");
    expect(resolveBenchmarkDirectory({ [BENCHMARK_DIR_ENV]: sibling }, ROOT)).toEqual({ ok: true, directory: sibling });
    expect(resolveBenchmarkDirectory({ [BENCHMARK_DIR_ENV]: resolve(ROOT, "..") }, ROOT).ok).toBe(true);
    expect(existsSync(sibling)).toBe(false);
    // an invalid document is refused before the directory is even resolved
    expect(() => writeLatencyResults({ ...document, schema: "sirkit.latency-results.v0" } as unknown as LatencyResultsDocument, { [BENCHMARK_DIR_ENV]: outside }, ROOT)).toThrow(/^LATENCY_RESULTS_INVALID/);
    expect(existsSync(outside)).toBe(false);
    expect([benchmarkRequested({}), benchmarkRequested({ [BENCHMARK_FLAG_ENV]: "1" }), benchmarkRequested({ [BENCHMARK_FLAG_ENV]: " 1" }), benchmarkRequested({ [BENCHMARK_FLAG_ENV]: "true" })]).toEqual([false, true, false, false]);
    expect([BENCHMARK_FLAG_ENV, BENCHMARK_DIR_ENV]).toEqual(["SIRKIT_B24_BENCHMARK", "SIRKIT_B24_BENCHMARK_DIR"]);
    expect(latencyResultsProblems({ ...document, environment: latencyEnvironment({}) })).toEqual([]);
    expect(latencyEnvironment({ ImageOS: "ubuntu24" }).image).toBe("ubuntu24");
  });

  it("7. headroom: 24:59 and 25:01 elapsed of 30, 19:59 and 20:01 of 25, a missing or future start (unknown, failing); the three jobs' limits read off the workflow and the benchmark job's off its own", () => {
    expect(OD30_HEADROOM_MINUTES).toBe(5);
    expect(headroom({ timeoutMinutes: 30, startedAtSec: 1_000, nowSec: 1_000 + 24 * 60 + 59 })).toMatchObject({ state: "ok", elapsedSec: 1_499, headroomSec: 301, failing: false, code: null });
    expect(headroom({ timeoutMinutes: 30, startedAtSec: 1_000, nowSec: 1_000 + 25 * 60 + 1 })).toMatchObject({ state: "split_required", elapsedSec: 1_501, headroomSec: 299, failing: true, code: OD30_SPLIT_REQUIRED });
    expect(headroom({ timeoutMinutes: 25, startedAtSec: 1_000, nowSec: 1_000 + 19 * 60 + 59 })).toMatchObject({ state: "ok", headroomSec: 301, failing: false });
    expect(headroom({ timeoutMinutes: 25, startedAtSec: 1_000, nowSec: 1_000 + 20 * 60 + 1 })).toMatchObject({ state: "split_required", headroomSec: 299, failing: true });
    expect(headroom({ timeoutMinutes: 25, startedAtSec: null, nowSec: 1_000 })).toMatchObject({ state: "unknown", elapsedSec: null, headroomSec: null, failing: true, code: OD30_START_UNKNOWN });
    expect(headroom({ timeoutMinutes: 25, startedAtSec: 2_000, nowSec: 1_000 })).toMatchObject({ state: "unknown", failing: true });
    expect(() => headroom({ timeoutMinutes: 0, startedAtSec: 1, nowSec: 2 })).toThrow(/OD30_TIMEOUT_INVALID/);
    expect([parseStartedAt(undefined), parseStartedAt(""), parseStartedAt("abc"), parseStartedAt("1760000000"), parseStartedAt(" 1760000000 ")]).toEqual([null, null, null, 1_760_000_000, 1_760_000_000]);
    expect(renderHeadroom("prompt-to-gerber", headroom({ timeoutMinutes: 25, startedAtSec: 0, nowSec: 1_201 }))).toBe("OD-30 headroom: prompt-to-gerber elapsed 20 min 01 s of 25 min, headroom 4 min 59 s: split_required (OD30_SPLIT_REQUIRED)");
    const deterministic = read(DETERMINISTIC);
    expect([readJobTimeoutMinutes(deterministic, "prompt-to-gerber"), readJobTimeoutMinutes(deterministic, "page-browser-e2e"), readJobTimeoutMinutes(deterministic, "agent-boundary-suites"), readJobTimeoutMinutes(deterministic, "no-such-job")]).toEqual([25, 30, 20, null]);
    expect(readJobTimeoutMinutes(read(BENCHMARK), JOB)).toBe(30);
  });

  it("8. the benchmark-latency job: appended after benchmark-nightly, 30 minutes, no if:, the directory in the job's env and the flag in the vitest step's env (exactly \"1\"); the step order; if: success() || failure() on the gate, route-bench and headroom steps and no continue-on-error; the always() upload; the permissions unchanged; no other job sets the flag; the gate script selects only *.latency-results.json of the schema", () => {
    const workflow = lines(BENCHMARK);
    expect(workflow.slice(0, 12).join(NEWLINE)).toContain(`permissions:${NEWLINE}  contents: read${NEWLINE}`);
    expect(workflow.filter((line, index) => index > workflow.indexOf("jobs:") && /^ {2}[a-z0-9-]+:$/.test(line))).toEqual(["  benchmark-core:", "  benchmark-nightly:", `  ${JOB}:`]);
    const job = jobBlock(workflow, JOB);
    expect(job.start).toBeGreaterThan(workflow.indexOf("  benchmark-nightly:"));
    expect(job.end).toBe(workflow.length - (workflow[workflow.length - 1] === "" ? 1 : 0));
    expect(workflow[job.start - 1]).toMatch(/^ {2}# /);
    expect(job.lines.slice(0, 6)).toEqual([`  ${JOB}:`, "    runs-on: ubuntu-latest", "    timeout-minutes: 30", "    env:", `      # outside the repository, as prompt-to-gerber's SIRKIT_B16_1C_EVIDENCE_DIR is (a literal path: the \`runner\` context is not available in job-level env)`, `      ${BENCHMARK_DIR_ENV}: ${DIRECTORY}`]);
    expect(job.lines.filter((line) => /^ {4}if:/.test(line))).toEqual([]);
    expect(job.lines.some((line) => line.includes("continue-on-error"))).toBe(false);
    const jobSteps = steps(job.lines);
    expect(jobSteps.map((step) => step[0])).toEqual([
      `      - run: mkdir -p "$${BENCHMARK_DIR_ENV}" && echo "${STARTED_AT}=$(date +%s)" >> "$GITHUB_ENV" # [B24-D1] OD-30: ${JOB}'s start`,
      "      - uses: actions/checkout@v4",
      "      - uses: pnpm/action-setup@v4",
      "      - uses: actions/setup-node@v4",
      "      - run: pnpm install --frozen-lockfile",
      `      - run: pnpm exec vitest run app/lib/qualification/__tests__/b24-d1-latency.test.ts app/lib/qualification/__tests__/b24-d1-latency-workflow.test.ts --no-file-parallelism --reporter=dot --reporter=junit --outputFile=vitest-${JOB}.xml`,
      "      - if: success() || failure()",
      "      - if: success() || failure()",
      `      - if: success() || failure() # [B24-D1] OD-30: ${JOB}'s headroom (reports only)`,
      "      - name: Upload the latency results",
    ]);
    expect(jobSteps[5]).toEqual([jobSteps[5]![0], "        env:", `          ${BENCHMARK_FLAG_ENV}: "1"`]);
    expect(jobSteps[6]).toEqual(["      - if: success() || failure()", `        run: pnpm exec tsx ${GATE_SCRIPT}`]);
    expect(jobSteps[7]).toEqual(["      - if: success() || failure()", `        run: pnpm exec tsx scripts/route-bench.ts > "$${BENCHMARK_DIR_ENV}/route-bench.json"`]);
    expect(jobSteps[8]).toEqual([jobSteps[8]![0], `        run: pnpm exec tsx ${HEADROOM_SCRIPT} ${BENCHMARK} ${JOB} --report-only`]);
    expect(jobSteps[9]).toEqual(["      - name: Upload the latency results", "        if: always()", "        uses: actions/upload-artifact@v4", "        with:", `          name: ${JOB}-results`, "          path: |", `            vitest-${JOB}.xml`, `            ${DIRECTORY}`, "          if-no-files-found: ignore", "          retention-days: 14"]);
    // the helper reads the job: its two files, its step env, and the job among the suites' CI jobs
    const admission = ciAdmission();
    expect(admission.stepEnv[JOB]).toEqual({ [BENCHMARK_FLAG_ENV]: "1" });
    expect(admission.stepEnv["benchmark-core"]).toEqual({});
    expect(Object.hasOwn(admission.stepEnv["benchmark-nightly"], BENCHMARK_FLAG_ENV)).toBe(false);
    expect(admission.filters[JOB]).toEqual(["app/lib/qualification/__tests__/b24-d1-latency.test.ts", "app/lib/qualification/__tests__/b24-d1-latency-workflow.test.ts"]);
    expect(admission.jobsOf("app/lib/qualification/__tests__/b24-d1-latency.test.ts")).toEqual(["prompt-to-gerber", JOB]);
    expect(admission.jobsOf("app/lib/qualification/__tests__/b24-d1-latency-workflow.test.ts")).toEqual(["prompt-to-gerber", JOB]);
    expect(admission.jobsOf("app/lib/qualification/__tests__/b24-d1-latency-policy.test.ts")).toEqual(["prompt-to-gerber"]);
    // the flag, as a whole name, stands on exactly one line of the benchmark workflow (the step's env) and on none of the deterministic one
    expect(workflow.filter((line) => WHOLE_FLAG.test(line))).toEqual([`          ${BENCHMARK_FLAG_ENV}: "1"`]);
    expect(lines(DETERMINISTIC).some((line) => WHOLE_FLAG.test(line))).toBe(false);
    expect(workflow.filter((line) => line.includes(BENCHMARK_DIR_ENV))).toHaveLength(3);
    expect(workflow.filter((line) => line.includes("scripts/route-bench.ts"))).toHaveLength(1);
    expect(read("scripts/route-bench.ts")).toContain('if (report.direct500Tracks.p50 >= 16) throw new Error("RouteBench: direct-route p50 budget exceeded.");');
    expect(read("scripts/route-bench.ts")).toContain('if (report.walkAroundSingleBlocker.p95 >= 50) throw new Error("RouteBench: walk-around p95 budget exceeded.");');
    expect(read("package.json")).toContain('"pcb:routebench": "tsx scripts/route-bench.ts"');
    // the gate script: only *.latency-results.json of the schema, route-bench.json ignored; the baseline from the committed file; --baseline writes nothing
    const gate = read(GATE_SCRIPT);
    expect(gate).toContain("readdirSync(resolved.directory).filter((name) => name.endsWith(RESULTS_FILE_SUFFIX))");
    expect(gate).toContain("if (parsed?.schema !== LATENCY_RESULTS_SCHEMA) return null;");
    expect(gate).toContain('const BASELINE_PATH = "artifacts/ai-control-plane-b24/latency-baseline.json";');
    expect(gate).toContain("return evaluation.blocking ? 1 : 0;");
    expect(gate.slice(gate.indexOf("function baseline("), gate.indexOf("try {"))).not.toMatch(/writeFileSync|appendFileSync/);
    expect(RESULTS_FILE_SUFFIX).toBe(".latency-results.json");
    // [B24-D1 review, 2026-10-09] the gate refuses a committed baseline with an unreviewed widening, not only a malformed one (review correctness-1)
    expect(gate).toContain("const widening = baselineWideningProblems(document as LatencyBaselineDocument);");
    expect(gate).toContain("if (widening.length > 0) throw new Error(`LATENCY_BASELINE_UNREVIEWED_WIDENING: ${widening.join(\", \")}`);");
    // the two entries are registered as non-live gates of this job (B24-B3's registry; honesty case 10 holds the rest)
    expect(NON_LIVE_GATES.filter((entry) => entry.job.id === JOB).map((entry) => [entry.id, entry.kind, entry.flag.name, entry.job.workflow])).toEqual([["b24-d1-latency", "non-live", BENCHMARK_FLAG_ENV, BENCHMARK], ["b24-d1-latency-workflow", "non-live", BENCHMARK_FLAG_ENV, BENCHMARK]]);
    // [B24-D1 review, 2026-10-09] honesty case 10's title still names B3's single gate; its id list moved by review, so its it( line carries the dated note (review correctness-6)
    expect(read("app/lib/qualification/__tests__/b24-b3-live-suite-honesty.test.ts")).toMatch(/^  it\("10\. NON_LIVE_GATES \(lead decision D2\) holds exactly b24-b2-corpus-nightly:[^\n]*\(\) => \{ \/\/ \[B24-D1, 2026-10-09\] [^\n]*b24-d1-latency[^\n]*$/m);
  });

  it("9. the OD-30 steps (lead decisions D8, D19): prompt-to-gerber, page-browser-e2e and agent-boundary-suites each start with the one-line start step naming its own job and end, after their upload step, with the two-line headroom step; still exactly two playwright test lines; no new line ends in pnpm exec vitest run; the helper still derives the three jobs", () => {
    const workflow = lines(DETERMINISTIC);
    for (const [job, upload] of [["prompt-to-gerber", "      - name: Upload evidence and diagnostics"], ["page-browser-e2e", "      - name: Upload browser evidence"], ["agent-boundary-suites", "      - name: Upload diagnostics"]] as const) {
      const block = jobBlock(workflow, job);
      const jobSteps = steps(block.lines);
      expect(jobSteps[0], job).toEqual([startLine(job)]);
      expect(block.lines[block.lines.indexOf("    steps:") + 1], job).toBe(startLine(job));
      expect(jobSteps[jobSteps.length - 2]![0], job).toBe(upload);
      expect(jobSteps[jobSteps.length - 1], job).toEqual(headroomLines(job));
      expect(block.lines.filter((line) => line.includes(STARTED_AT)), job).toHaveLength(1);
      expect(block.lines.filter((line) => line.includes(HEADROOM_SCRIPT)), job).toHaveLength(1);
      expect(block.lines.some((line) => line.includes("continue-on-error")), job).toBe(false);
    }
    for (const job of ["database-delivery", "production-smoke", "secret-scan"]) expect(jobBlock(workflow, job).lines.some((line) => line.includes(STARTED_AT) || line.includes(HEADROOM_SCRIPT)), job).toBe(false);
    expect(workflow.filter((line) => line.includes("playwright test"))).toHaveLength(2);
    expect(workflow.filter((line) => /pnpm exec vitest run\s*$/.test(line))).toHaveLength(3);
    expect(workflow.filter((line) => /^ {4}timeout-minutes: /.test(line)).map((line) => line.trim())).toEqual(["timeout-minutes: 25", "timeout-minutes: 15", "timeout-minutes: 30", "timeout-minutes: 20", "timeout-minutes: 10", "timeout-minutes: 20"]);
    expect(read(DETERMINISTIC)).toContain(`permissions:${NEWLINE}  contents: read${NEWLINE}`);
    const admission = ciAdmission();
    expect(admission.filters["prompt-to-gerber"]).toContain("app/lib/qualification/__tests__");
    expect(admission.filters["agent-boundary-suites"]).toContain("app/lib/mcp");
    expect(admission.excludes["prompt-to-gerber"]).toContain("app/lib/mcp/**");
    // the headroom script: reads the start from the one name, fails on split_required and unknown unless --report-only, appends to the step summary only
    const script = read(HEADROOM_SCRIPT);
    expect(script).toContain(`export const JOB_STARTED_AT_ENV = "${STARTED_AT}";`);
    expect(script).toContain("return report.failing && !reportOnly ? 1 : 0;");
    expect(script).toContain('const reportOnly = process.argv.includes("--report-only");');
    expect(script.match(/appendFileSync\(/g) ?? []).toHaveLength(1);
    expect(script).not.toMatch(/writeFileSync|spawn|exec(?:File)?Sync|child_process/);
  });

  it("10. the three names (lead decisions D15, D16): the inventory's kinds (live-test-gate, tooling, tooling), the census's classes (qualification-opt-in, platform, platform) with a reason each, the flag's owner the writer, the start name set by exactly the four start steps and read only by the headroom script", async () => {
    const inventory = (name: string) => FLAG_INVENTORY.find((entry) => entry.name === name);
    expect(inventory(BENCHMARK_FLAG_ENV)).toMatchObject({ kind: "live-test-gate", default: "off", direction: "enables", constant: "BENCHMARK_FLAG_ENV", rule: { parse: "exact", value: "1" } });
    expect(inventory(BENCHMARK_FLAG_ENV)!.owner).toMatch(/^app\/lib\/qualification\/latency-results-writer\.ts:\d+$/);
    expect(inventory(BENCHMARK_DIR_ENV)).toMatchObject({ kind: "tooling", direction: "selects", constant: "BENCHMARK_DIR_ENV" });
    expect(inventory(STARTED_AT)).toMatchObject({ kind: "tooling", direction: "selects", constant: "JOB_STARTED_AT_ENV" });
    expect(inventory(STARTED_AT)!.owner).toMatch(new RegExp(`^${HEADROOM_SCRIPT.replace(".", "\\.")}:\\d+$`));
    const census = (name: string) => ENVIRONMENT_NAMES.find((row) => row.name === name);
    expect(census(BENCHMARK_FLAG_ENV)).toMatchObject({ class: "qualification-opt-in", reader: "app/lib/qualification/latency-results-writer.ts" });
    expect(census(BENCHMARK_DIR_ENV)).toMatchObject({ class: "platform", reader: "app/lib/qualification/latency-results-writer.ts" });
    expect(census(STARTED_AT)).toMatchObject({ class: "platform", reader: HEADROOM_SCRIPT });
    for (const name of [BENCHMARK_FLAG_ENV, BENCHMARK_DIR_ENV, STARTED_AT]) expect(census(name)!.reason?.length ?? 0, name).toBeGreaterThan(20);
    expect(read(".env.example")).not.toMatch(new RegExp(`${BENCHMARK_FLAG_ENV}|${STARTED_AT}`));
    // the start name in code: set by the workflows' four start steps, read by the headroom script alone (tests and pages aside)
    expect([...lines(DETERMINISTIC), ...lines(BENCHMARK)].filter((line) => line.includes(`${STARTED_AT}=$(date +%s)`))).toHaveLength(4);
    const holders: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const entry of readdirSync(join(ROOT, dir))) {
        if (entry === "node_modules" || entry.startsWith(".")) continue;
        const path = `${dir}/${entry}`;
        if (statSync(join(ROOT, path)).isDirectory()) { await walk(path); continue; }
        if (!/\.(?:ts|tsx|mjs|js)$/.test(entry) || path.includes("/__tests__/")) continue;
        if (readFileSync(join(ROOT, path), "utf8").includes(STARTED_AT)) holders.push(path);
      }
      await yieldToLoop();
    };
    for (const dir of ["app", "scripts", "lib", "components"]) if (existsSync(join(ROOT, dir))) await walk(dir);
    expect(holders.sort()).toEqual(["app/lib/deployment/environment-names.ts", "app/lib/deployment/flag-inventory.ts", HEADROOM_SCRIPT]);
  }, 120_000);
});
