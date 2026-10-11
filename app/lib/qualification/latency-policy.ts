/**
 * [B24-D1] D24-27, D24-28, OD-212 - the latency policy: the closed metric catalogue, the two documents (`sirkit.latency-results.v1`,
 * `sirkit.latency-baseline.v1`), the evaluation of a run against the latest committed baseline and the widening rule over the
 * append-only baseline. Pure: no I/O, no clock, no environment; `quantile` is the stage-09 one (`app/lib/benchmark/statistics.ts`),
 * never a second implementation, and a widening is accepted only by a change record `validateThresholdChange` accepts
 * (`app/lib/benchmark/regression-policy.ts`).
 *
 * The states, one per catalogued metric: `pass`; `block` (the p50 exceeds the baseline by more than the practical regression plus the
 * noise band AND by more than the floor; the same test on the p95 once the sample count reaches LATENCY_P95_MINIMUM_SAMPLES, below
 * which the p95 is reported only); `baseline_missing`; `sample_shortfall`; `unmeasured` (a catalogued metric absent from the
 * results). `block`, `sample_shortfall` and `unmeasured` always block. `baseline_missing` blocks too, with one exception (lead
 * decision D3): while the latest version of the committed baseline is the declared-without-values v1, it is a recorded, non-blocking
 * BLOCKED state, because the owner has not accepted the job's Actions minutes (OD-212, OD-30; discovery section 8 item 11). Nothing
 * passes silently: a non-blocking `baseline_missing` renders as BLOCKED, never as pass. [B24-D1 review, 2026-10-09] The exception is
 * version 1's alone: a declared-without-values version at any later position is a shape problem (DECLARED_AFTER_V1), a recorded value
 * nulled in a later version is a widening (values_dropped), a results file carries only its own suite's metrics (METRIC_FOREIGN_SUITE)
 * and a metric measured in two results documents is refused (LATENCY_RESULTS_METRIC_DOUBLED), never overridden.
 *
 * The baseline's budget is the stage-09 shape (`practicalRegression`, `noiseBand`, `direction: "lower_is_better"`,
 * `failureAction: "block"`) plus `floorMs`; never a `maximumP95` (OD-212: no absolute target until the owner sets one). The stated
 * defaults (OD-234): practicalRegression 0.10, noiseBand = max(0.20, the relative p95 spread across at least three runner runs),
 * floorMs 1.
 */
import { quantile } from "../benchmark/statistics";
import { validateThresholdChange, type RegressionBudget, type ThresholdChangeRequest } from "../benchmark/regression-policy";

export const LATENCY_RESULTS_SCHEMA = "sirkit.latency-results.v1" as const;
export const LATENCY_BASELINE_SCHEMA = "sirkit.latency-baseline.v1" as const;
export const LATENCY_POLICY_VERSION = "sirkit.latency-policy/1.0.0" as const;
export const LATENCY_PRACTICAL_REGRESSION = 0.1;
export const LATENCY_NOISE_BAND_MINIMUM = 0.2;
export const LATENCY_FLOOR_MS = 1;
export const LATENCY_P95_MINIMUM_SAMPLES = 20;
export const LATENCY_BASELINE_MINIMUM_RUNS = 3;
/** The fixed first-answer delay of the stream workload's fake provider (OD-234). */
export const STREAM_PROVIDER_DELAY_MS = 250;

export const LATENCY_SUITES = Object.freeze(["b24-d1-latency", "b24-d1-latency-workflow", "b24-d2-memory"] as const); // [B24-D2, 2026-10-09] + b24-d2-memory (OD-212's memory half)
export type LatencySuite = (typeof LATENCY_SUITES)[number];
export const LATENCY_FAMILIES = Object.freeze(["view", "read", "edit", "stream", "workflow", "moved", "memory"] as const); // [B24-D2, 2026-10-09] + memory
/** [B24-D2, 2026-10-09] The unit a metric's samples, quantiles, baseline values and floor are in: milliseconds for B24-D1's families, MiB (2^20 bytes)
 *  for B24-D2's memory family. The evaluation is unit-free (the same band and floor rule); only the reading of the numbers differs. */
export const LATENCY_UNITS = Object.freeze(["ms", "MiB"] as const);
export type LatencyUnit = (typeof LATENCY_UNITS)[number];
export type LatencyFamily = (typeof LATENCY_FAMILIES)[number];

export interface LatencyMetric {
  readonly metricId: string;
  readonly family: LatencyFamily;
  readonly suite: LatencySuite;
  readonly workload: string;
  readonly warmups: number;
  readonly samples: number;
  /** the increment that added the metric */
  readonly addedBy: string;
  /** [B24-D2, 2026-10-09] the unit of every number this metric carries */
  readonly unit: LatencyUnit;
  /** [B24-D2, 2026-10-09] the floor, in `unit`: a regression must also exceed the baseline by this much (the baseline budget's `floorMs` carries it) */
  readonly floor: number;
}

const metric = (metricId: string, family: LatencyFamily, suite: LatencySuite, workload: string, warmups: number, samples: number): LatencyMetric =>
  Object.freeze({ metricId, family, suite, workload, warmups, samples, addedBy: "B24-D1", unit: "ms" as const, floor: LATENCY_FLOOR_MS });
/** [B24-D2, 2026-10-09] D24-29, OD-212's memory half: a memory metric of b24-d2-memory - a heapUsed or rss delta in MiB with its floor in MiB, the
 *  same warm-ups and sample count for every memory metric (at least LATENCY_P95_MINIMUM_SAMPLES, so the p95 is gated too). */
export const MEMORY_WARMUPS = 2;
export const MEMORY_SAMPLES = 30;
const memoryMetric = (metricId: string, workload: string, floor: number): LatencyMetric =>
  Object.freeze({ metricId, family: "memory" as const, suite: "b24-d2-memory" as const, workload, warmups: MEMORY_WARMUPS, samples: MEMORY_SAMPLES, addedBy: "B24-D2", unit: "MiB" as const, floor });
/** [B24-D2, 2026-10-09] The memory floors (OD-235): heapUsed 1 MiB, rss 8 MiB - an rss delta moves in whole pages the allocator maps and the OS trims
 *  (measured locally 2026-10-09: about half the rss deltas negative, single samples to 66 MiB), so its floor is wider. */
export const MEMORY_HEAP_FLOOR_MIB = 1;
export const MEMORY_RSS_FLOOR_MIB = 8;

/** The closed catalogue (runbook :1094-1097 and the moved bounds). The counts are OD-234's stated choice. */
export const LATENCY_METRICS: readonly LatencyMetric[] = Object.freeze([
  metric("view.pcb-fit-board", "view", "b24-d1-latency", "pcb.fit-board through the view-session bus (createViewCommand, pcbCommands) on a recorded ROUTED board", 20, 200),
  metric("view.pcb-pan-to-component", "view", "b24-d1-latency", "pcb.pan-to a component by reference through the view-session bus on a recorded ROUTED board", 20, 200),
  metric("read.selection-inspect", "read", "b24-d1-latency", "sirkit.selection.inspect through the real gateway over the activated read binding, on a recorded ROUTED board", 20, 200),
  metric("read.via-inspect", "read", "b24-d1-latency", "sirkit.pcb.via-inspect through the real gateway over the activated read binding, on a recorded ROUTED board", 20, 200),
  metric("edit.granted-move-footprint", "edit", "b24-d1-latency", "one granted reversible edit (Move R3 2 mm to the right under execute_explicit_tier1 through the B18-C harness): the chat run, the minted grant, the ritual and the settlement; exactly one committed transaction", 3, 30),
  metric("stream.first-event-ms", "stream", "b24-d1-latency", "POST /api/chat with a fake provider whose first answer is delayed by STREAM_PROVIDER_DELAY_MS: the first NDJSON line (run_started)", 5, 50),
  metric("stream.silent-gap-ms", "stream", "b24-d1-latency", "the silent gap of the same run: the longest interval between two consecutive NDJSON lines (the provider wait, about STREAM_PROVIDER_DELAY_MS; the warning lines follow run_started at once and nothing is sent until the provider answers)", 5, 50),
  metric("stream.completion-ms", "stream", "b24-d1-latency", "the terminal line of the same run (exactly one terminal event)", 5, 50),
  metric("workflow.publish-preflight-apply-qualify-ms", "workflow", "b24-d1-latency-workflow", "publish, preflight, apply and POST /api/pcb/qualify on the committed recorded router, after the untimed acceptance steps 1-4 on fresh repositories; verified against the pinned identities", 1, 10),
  metric("moved.observation-normalizer-huge-text", "moved", "b24-d1-latency", "b20-a4-observation-normalizer case 6: one 5,000,000-character text block observed (the budget is charged before any work)", 1, 10),
  metric("moved.observation-normalizer-many-blocks", "moved", "b24-d1-latency", "b20-a4-observation-normalizer case 6: 100,000 benign text blocks observed (16 read, the rest counted)", 1, 10),
  metric("moved.observation-normalizer-pathological-marks", "moved", "b24-d1-latency", "b20-a4-observation-normalizer case 6: 16 blocks of ill-ordered combining marks observed (the NFC reorder)", 1, 10),
  metric("moved.observation-normalizer-structured-budget", "moved", "b24-d1-latency", "b20-a4-observation-normalizer case 6: 1,998 structured leaves past the budget observed (withheld_budget before any NFC)", 1, 10),
  metric("moved.pcb-sync-preflight-small-fixture", "moved", "b24-d1-latency", "pcb-sync performance-resilience case 1: one preflight of the small exact new-board fixture over the ready harness (ready_to_apply)", 1, 10),
  metric("moved.pcb-sync-aggregate-500-components", "moved", "b24-d1-latency", "pcb-sync performance-resilience case 2: one preflight aggregating a 500-component blocked design in two batches, no board created", 1, 10),
  // [B24-D1 review, 2026-10-09] found by the census once it followed a helper-returned timing; the B19 pattern's quadratic scan (1,371 ms, the B20 page) sat under the 2,000 ms bound, so it disproved nothing
  metric("moved.redaction-linear-200-scrubs", "moved", "b24-d1-latency", "b20-a1-redaction-linear (linear time) case 1: 200 scrubVendorText scrubs of a 4,000-character 'a.' leaf with a word boundary at every letter (the scrubbed output stays asserted)", 1, 10),
  // [B24-D2, 2026-10-09] D24-29, OD-212's memory half: gc() before each sample, the delta of process.memoryUsage() across one run with its result held;
  // a negative delta (the collector ran during the run) is recorded as 0 and counted by the suite
  memoryMetric("memory.board-inspect-routed-heap", "heapUsed delta: board-inspect's snapshot (buildAIPcbSnapshot) of each recorded ROUTED board of e2e/fixtures/blinker-route-fixture.json, both built per sample", MEMORY_HEAP_FLOOR_MIB),
  memoryMetric("memory.board-inspect-routed-rss", "rss delta: the same run as memory.board-inspect-routed-heap", MEMORY_RSS_FLOOR_MIB),
  memoryMetric("memory.board-pages-routed-heap", "heapUsed delta: the full paged read (buildBoardPage, sirkit.pcb.board-page-inspect) of each recorded ROUTED board by every enabled copper layer and every net, following nextCursor to the last page; both boards whole per sample", MEMORY_HEAP_FLOOR_MIB),
  memoryMetric("memory.board-pages-routed-rss", "rss delta: the same run as memory.board-pages-routed-heap", MEMORY_RSS_FLOOR_MIB),
  memoryMetric("memory.board-inspect-placed-heap", "heapUsed delta: board-inspect's snapshot of the placed golden board (buildAutonomousGoldenBoard, 15 footprints, no track), as a reference", MEMORY_HEAP_FLOOR_MIB),
  memoryMetric("memory.board-inspect-placed-rss", "rss delta: the same run as memory.board-inspect-placed-heap", MEMORY_RSS_FLOOR_MIB),
]);

export function latencyMetric(metricId: string): LatencyMetric {
  const found = LATENCY_METRICS.find((candidate) => candidate.metricId === metricId);
  if (!found) throw new Error(`LATENCY_METRIC_UNKNOWN: ${metricId}`);
  return found;
}

// ── the results document ────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface LatencyEnvironment {
  readonly platform: string;
  readonly architecture: string;
  readonly osRelease: string;
  /** the runner image when the environment names one (GitHub's ImageOS), else null */
  readonly image: string | null;
  readonly node: string;
  readonly cpu: string;
  readonly logicalCores: number;
}

export interface LatencyMetricResult {
  readonly metricId: string;
  /** the sorted sample vector, in the metric's unit ([B24-D2, 2026-10-09] milliseconds, or MiB for the memory family) */
  readonly samples: readonly number[];
  readonly p50: number;
  readonly p95: number;
  readonly correctness: "verified";
}

export interface LatencyResultsDocument {
  readonly schema: typeof LATENCY_RESULTS_SCHEMA;
  readonly policyVersion: typeof LATENCY_POLICY_VERSION;
  readonly suite: LatencySuite;
  readonly commit: string;
  readonly environment: LatencyEnvironment;
  readonly metrics: readonly LatencyMetricResult[];
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;

/** The sorted vector with its p50 and p95 (the stage-09 quantile). */
export function summarizeSamples(samples: readonly number[]): { samples: number[]; p50: number; p95: number } {
  if (samples.length === 0) throw new Error("LATENCY_SAMPLES_EMPTY");
  for (const sample of samples) if (!finite(sample) || sample < 0) throw new Error("LATENCY_SAMPLE_INVALID");
  const sorted = [...samples].sort((a, b) => a - b);
  return { samples: sorted, p50: quantile(sorted, 0.5)!, p95: quantile(sorted, 0.95)! };
}

/** A results document from raw sample vectors, each metric verified by the suite that measured it. */
export function latencyResultsDocument(input: { suite: LatencySuite; commit: string; environment: LatencyEnvironment; metrics: ReadonlyArray<{ metricId: string; samples: readonly number[] }> }): LatencyResultsDocument {
  const metrics = input.metrics.map((entry) => {
    const catalogued = latencyMetric(entry.metricId);
    if (catalogued.suite !== input.suite) throw new Error(`LATENCY_METRIC_FOREIGN_SUITE: ${entry.metricId} is ${catalogued.suite}'s, not ${input.suite}'s`);
    return { metricId: entry.metricId, ...summarizeSamples(entry.samples), correctness: "verified" as const };
  });
  return { schema: LATENCY_RESULTS_SCHEMA, policyVersion: LATENCY_POLICY_VERSION, suite: input.suite, commit: input.commit, environment: input.environment, metrics };
}

/** Why a value is not a `sirkit.latency-results.v1` document ([] when it is). */
export function latencyResultsProblems(value: unknown): string[] {
  const problems: string[] = [];
  if (!value || typeof value !== "object") return ["NOT_AN_OBJECT"];
  const document = value as Record<string, unknown>;
  if (document.schema !== LATENCY_RESULTS_SCHEMA) problems.push("SCHEMA");
  if (document.policyVersion !== LATENCY_POLICY_VERSION) problems.push("POLICY_VERSION");
  if (!(LATENCY_SUITES as readonly string[]).includes(String(document.suite))) problems.push("SUITE");
  if (!text(document.commit)) problems.push("COMMIT");
  const environment = document.environment as Record<string, unknown> | undefined;
  if (!environment || typeof environment !== "object" || !text(environment.platform) || !text(environment.architecture) || !text(environment.osRelease) || !(environment.image === null || text(environment.image)) || !text(environment.node) || !text(environment.cpu) || !finite(environment.logicalCores)) problems.push("ENVIRONMENT");
  if (!Array.isArray(document.metrics)) return [...problems, "METRICS"];
  const seen = new Set<string>();
  for (const entry of document.metrics as unknown[]) {
    const result = entry as Record<string, unknown>;
    const id = String(result?.metricId ?? "");
    const catalogued = LATENCY_METRICS.find((candidate) => candidate.metricId === id);
    if (!catalogued) { problems.push(`METRIC_UNKNOWN:${id}`); continue; }
    // [B24-D1 review, 2026-10-09] a results file carries only its own suite's metrics (a known suite; an unknown one is SUITE above)
    if ((LATENCY_SUITES as readonly string[]).includes(String(document.suite)) && catalogued.suite !== document.suite) problems.push(`METRIC_FOREIGN_SUITE:${id}`);
    if (seen.has(id)) problems.push(`METRIC_DOUBLED:${id}`);
    seen.add(id);
    const samples = result.samples;
    if (!Array.isArray(samples) || samples.length === 0 || samples.some((sample) => !finite(sample) || sample < 0)) { problems.push(`SAMPLES:${id}`); continue; }
    const sorted = [...(samples as number[])].sort((a, b) => a - b);
    if (sorted.some((sample, index) => sample !== samples[index])) problems.push(`SAMPLES_UNSORTED:${id}`);
    if (result.p50 !== quantile(sorted, 0.5) || result.p95 !== quantile(sorted, 0.95)) problems.push(`QUANTILES:${id}`);
    if (result.correctness !== "verified") problems.push(`CORRECTNESS:${id}`);
  }
  return problems;
}

// ── the baseline document ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The stage-09 budget shape plus the floor; never a `maximumP95` (OD-212). */
export type LatencyBudget = Pick<RegressionBudget, "practicalRegression" | "noiseBand" | "direction" | "failureAction"> & { /** [B24-D2, 2026-10-09] in the metric's unit (the name predates the unit field: MiB for a memory metric) */ readonly floorMs: number };

export interface LatencyBaselineMetric {
  readonly metricId: string;
  /** null in a declared-without-values version */
  readonly p50: number | null;
  readonly p95: number | null;
  /** the runner run ids the values came from ([] when declared without values) */
  readonly runIds: readonly string[];
  readonly budget: LatencyBudget;
}

export type LatencyChangeRecord = ThresholdChangeRequest;

export interface LatencyBaselineVersion {
  readonly version: number;
  readonly policyVersion: string;
  readonly recordedAt: string;
  readonly declaredWithoutValues: boolean;
  readonly runIds: readonly string[];
  readonly metrics: readonly LatencyBaselineMetric[];
  /** from the second version on: one record per widened or dropped metric */
  readonly changeRecords: readonly LatencyChangeRecord[];
}

export interface LatencyBaselineDocument {
  readonly schema: typeof LATENCY_BASELINE_SCHEMA;
  readonly versions: readonly LatencyBaselineVersion[];
}

export function defaultLatencyBudget(noiseBand: number = LATENCY_NOISE_BAND_MINIMUM, floor: number = LATENCY_FLOOR_MS): LatencyBudget { // [B24-D2, 2026-10-09] + the metric's floor (B24-D1's 1 ms by default)
  return { practicalRegression: LATENCY_PRACTICAL_REGRESSION, noiseBand: Math.max(LATENCY_NOISE_BAND_MINIMUM, noiseBand), direction: "lower_is_better", failureAction: "block", floorMs: floor };
}

/** The noise band: max(0.20, the relative p95 spread over at least LATENCY_BASELINE_MINIMUM_RUNS runner runs). */
export function noiseBandFromRuns(p95s: readonly number[]): number {
  if (p95s.length < LATENCY_BASELINE_MINIMUM_RUNS) throw new Error(`LATENCY_BASELINE_RUNS_INSUFFICIENT: ${p95s.length} < ${LATENCY_BASELINE_MINIMUM_RUNS}`);
  for (const value of p95s) if (!finite(value) || value < 0) throw new Error("LATENCY_P95_INVALID");
  const median = quantile(p95s, 0.5)!;
  const spread = median > 0 ? (Math.max(...p95s) - Math.min(...p95s)) / median : 0;
  return Math.max(LATENCY_NOISE_BAND_MINIMUM, spread);
}

/** Version 1: every catalogued metric declared with the default budget and no runner value. */
export function declaredLatencyBaseline(recordedAt: string): LatencyBaselineVersion {
  return { version: 1, policyVersion: LATENCY_POLICY_VERSION, recordedAt, declaredWithoutValues: true, runIds: [], metrics: LATENCY_METRICS.map((entry) => ({ metricId: entry.metricId, p50: null, p95: null, runIds: [], budget: defaultLatencyBudget(LATENCY_NOISE_BAND_MINIMUM, entry.floor) })), changeRecords: [] };
}

function budgetProblems(budget: unknown, id: string): string[] {
  const problems: string[] = [];
  const value = budget as Record<string, unknown> | undefined;
  if (!value || typeof value !== "object") return [`BUDGET:${id}`];
  if (!finite(value.practicalRegression) || (value.practicalRegression as number) < 0) problems.push(`BUDGET_PRACTICAL_REGRESSION:${id}`);
  if (!finite(value.noiseBand) || (value.noiseBand as number) < 0) problems.push(`BUDGET_NOISE_BAND:${id}`);
  if (value.direction !== "lower_is_better") problems.push(`BUDGET_DIRECTION:${id}`);
  if (value.failureAction !== "block") problems.push(`BUDGET_FAILURE_ACTION:${id}`);
  if (!finite(value.floorMs) || (value.floorMs as number) < 0) problems.push(`BUDGET_FLOOR:${id}`);
  if ("maximumP95" in value) problems.push(`BUDGET_ABSOLUTE_TARGET:${id}`);
  return problems;
}

/** Why a value is not a `sirkit.latency-baseline.v1` document ([] when it is): the shape only; widening is `baselineWideningProblems`. */
export function latencyBaselineProblems(value: unknown): string[] {
  const problems: string[] = [];
  if (!value || typeof value !== "object") return ["NOT_AN_OBJECT"];
  const document = value as Record<string, unknown>;
  if (document.schema !== LATENCY_BASELINE_SCHEMA) problems.push("SCHEMA");
  if (!Array.isArray(document.versions) || document.versions.length === 0) return [...problems, "VERSIONS"];
  (document.versions as unknown[]).forEach((entry, index) => {
    const version = entry as Record<string, unknown>;
    const label = `v${String(version?.version ?? "?")}`;
    if (version?.version !== index + 1) problems.push(`VERSION_NUMBER:${label}`);
    if (!text(version?.policyVersion)) problems.push(`POLICY_VERSION:${label}`);
    if (!text(version?.recordedAt) || !Number.isFinite(Date.parse(String(version.recordedAt)))) problems.push(`RECORDED_AT:${label}`);
    if (typeof version?.declaredWithoutValues !== "boolean") problems.push(`DECLARED:${label}`);
    if (!Array.isArray(version?.runIds) || (version.runIds as unknown[]).some((id) => !text(id))) problems.push(`RUN_IDS:${label}`);
    if (!Array.isArray(version?.changeRecords)) problems.push(`CHANGE_RECORDS:${label}`);
    if (!Array.isArray(version?.metrics)) { problems.push(`METRICS:${label}`); return; }
    const seen = new Set<string>();
    for (const item of version.metrics as unknown[]) {
      const entryMetric = item as Record<string, unknown>;
      const id = String(entryMetric?.metricId ?? "");
      if (!LATENCY_METRICS.some((candidate) => candidate.metricId === id)) problems.push(`METRIC_UNKNOWN:${label}:${id}`);
      if (seen.has(id)) problems.push(`METRIC_DOUBLED:${label}:${id}`);
      seen.add(id);
      const declared = version.declaredWithoutValues === true;
      if (declared ? entryMetric.p50 !== null || entryMetric.p95 !== null : !finite(entryMetric.p50) || !finite(entryMetric.p95)) problems.push(`VALUES:${label}:${id}`);
      if (!Array.isArray(entryMetric.runIds) || (declared ? (entryMetric.runIds as unknown[]).length !== 0 : (entryMetric.runIds as unknown[]).length < LATENCY_BASELINE_MINIMUM_RUNS)) problems.push(`METRIC_RUN_IDS:${label}:${id}`);
      problems.push(...budgetProblems(entryMetric.budget, `${label}:${id}`));
    }
    if (index === 0 && version.declaredWithoutValues !== true) problems.push("V1_NOT_DECLARED");
    // [B24-D1 review, 2026-10-09] only v1 is declared without values: a later declared version would re-arm the non-blocking state (lead decision D3 is v1's alone)
    if (index > 0 && version.declaredWithoutValues === true) problems.push(`DECLARED_AFTER_V1:${label}`);
  });
  return problems;
}

/** The latest version (the last of the append-only list). */
export function latestLatencyBaseline(document: LatencyBaselineDocument): LatencyBaselineVersion {
  const latest = document.versions[document.versions.length - 1];
  if (!latest) throw new Error("LATENCY_BASELINE_EMPTY");
  return latest;
}

/** Every consecutive pair: a raised p50, p95, noise band or floor, a dropped metric, or a recorded value nulled ([B24-D1 review]
 *  values_dropped), needs a change record `validateThresholdChange` accepts (from the earlier policy version to the later one);
 *  anything else is UNREVIEWED_WIDENING. The declared-without-values v1 to the first runner baseline is not a widening. */
export function baselineWideningProblems(document: LatencyBaselineDocument): string[] {
  const problems: string[] = [];
  for (let index = 1; index < document.versions.length; index += 1) {
    const previous = document.versions[index - 1]!;
    const next = document.versions[index]!;
    if (previous.declaredWithoutValues) continue;
    const records = new Map(next.changeRecords.map((record) => [record.metricId, record] as const));
    for (const before of previous.metrics) {
      const after = next.metrics.find((candidate) => candidate.metricId === before.metricId);
      const widened: string[] = [];
      if (!after) widened.push("dropped");
      else {
        if ((before.p50 !== null && after.p50 === null) || (before.p95 !== null && after.p95 === null)) widened.push("values_dropped");
        if (after.p50 !== null && before.p50 !== null && after.p50 > before.p50) widened.push("p50");
        if (after.p95 !== null && before.p95 !== null && after.p95 > before.p95) widened.push("p95");
        if (after.budget.practicalRegression > before.budget.practicalRegression) widened.push("practicalRegression");
        if (after.budget.noiseBand > before.budget.noiseBand) widened.push("noiseBand");
        if (after.budget.floorMs > before.budget.floorMs) widened.push("floorMs");
      }
      if (widened.length === 0) continue;
      const record = records.get(before.metricId);
      const errors = record ? validateThresholdChange(record) : ["CHANGE_RECORD_MISSING"];
      if (record && (record.fromPolicyVersion !== previous.policyVersion || record.toPolicyVersion !== next.policyVersion)) errors.push("POLICY_VERSIONS_MISMATCH");
      if (errors.length > 0) problems.push(`UNREVIEWED_WIDENING:v${next.version}:${before.metricId}:${widened.join("+")}:${errors.join(",")}`);
    }
  }
  return problems;
}

// ── the evaluation ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type LatencyState = "pass" | "block" | "baseline_missing" | "sample_shortfall" | "unmeasured";
export const LATENCY_STATES = Object.freeze(["pass", "block", "baseline_missing", "sample_shortfall", "unmeasured"] as const);
/** Lead decision D3's text for the one non-blocking state. */
export const BASELINE_MISSING_NOTE = "OD-212/OD-30: baseline not recorded; Actions minutes not accepted";

export interface LatencyVerdict {
  readonly metricId: string;
  readonly state: LatencyState;
  readonly blocking: boolean;
  readonly reasons: readonly string[];
  readonly measured: { readonly samples: number; readonly p50: number; readonly p95: number } | null;
  readonly baseline: { readonly p50: number; readonly p95: number; readonly budget: LatencyBudget } | null;
}

export interface LatencyEvaluation {
  readonly policyVersion: string;
  readonly baselineVersion: number;
  readonly declaredWithoutValues: boolean;
  readonly verdicts: readonly LatencyVerdict[];
  readonly blocking: boolean;
}

/** The threshold a measured quantile must exceed on BOTH counts to block: the band and the floor. */
export function exceedsBudget(measured: number, baseline: number, budget: LatencyBudget): boolean {
  return measured > baseline * (1 + budget.practicalRegression + budget.noiseBand) && measured > baseline + budget.floorMs;
}

export function evaluateLatency(results: readonly LatencyResultsDocument[], baseline: LatencyBaselineDocument): LatencyEvaluation {
  const latest = latestLatencyBaseline(baseline);
  // [B24-D1 review, 2026-10-09] lead decision D3's exception is the declared-without-values VERSION 1 alone, never a later declared version
  const recordedBlocked = latest.version === 1 && latest.declaredWithoutValues;
  const measuredById = new Map<string, LatencyMetricResult>();
  for (const document of results) for (const entry of document.metrics) {
    // [B24-D1 review, 2026-10-09] a metric measured in two documents is refused, never overridden by the document read last
    if (measuredById.has(entry.metricId)) throw new Error(`LATENCY_RESULTS_METRIC_DOUBLED:${entry.metricId}`);
    measuredById.set(entry.metricId, entry);
  }
  const verdicts = LATENCY_METRICS.map((entry): LatencyVerdict => {
    const measured = measuredById.get(entry.metricId);
    if (!measured) return { metricId: entry.metricId, state: "unmeasured", blocking: true, reasons: ["NO_RESULT"], measured: null, baseline: null };
    const summary = { samples: measured.samples.length, p50: measured.p50, p95: measured.p95 };
    if (measured.samples.length < entry.samples) return { metricId: entry.metricId, state: "sample_shortfall", blocking: true, reasons: [`SAMPLES:${measured.samples.length}<${entry.samples}`], measured: summary, baseline: null };
    const base = latest.metrics.find((candidate) => candidate.metricId === entry.metricId);
    if (!base || base.p50 === null || base.p95 === null) {
      return { metricId: entry.metricId, state: "baseline_missing", blocking: !recordedBlocked, reasons: [recordedBlocked ? BASELINE_MISSING_NOTE : "BASELINE_MISSING"], measured: summary, baseline: null };
    }
    const reasons: string[] = [];
    if (exceedsBudget(measured.p50, base.p50, base.budget)) reasons.push(`P50_REGRESSION:${measured.p50.toFixed(3)}>${base.p50.toFixed(3)}`);
    if (measured.samples.length >= LATENCY_P95_MINIMUM_SAMPLES && exceedsBudget(measured.p95, base.p95, base.budget)) reasons.push(`P95_REGRESSION:${measured.p95.toFixed(3)}>${base.p95.toFixed(3)}`);
    if (measured.samples.length < LATENCY_P95_MINIMUM_SAMPLES) reasons.push("P95_REPORTED_ONLY");
    const blocked = reasons.some((reason) => reason.startsWith("P50_") || reason.startsWith("P95_REGRESSION"));
    return { metricId: entry.metricId, state: blocked ? "block" : "pass", blocking: blocked, reasons, measured: summary, baseline: { p50: base.p50, p95: base.p95, budget: base.budget } };
  });
  return { policyVersion: LATENCY_POLICY_VERSION, baselineVersion: latest.version, declaredWithoutValues: latest.declaredWithoutValues, verdicts, blocking: verdicts.some((verdict) => verdict.blocking) };
}

/** The label a table prints: a non-blocking baseline_missing is BLOCKED (recorded), never pass. */
export function latencyVerdictLabel(verdict: LatencyVerdict): string {
  if (verdict.state === "baseline_missing" && !verdict.blocking) return `BLOCKED (${BASELINE_MISSING_NOTE})`;
  return verdict.blocking ? `BLOCKING ${verdict.state}` : verdict.state;
}

const ms = (value: number | null | undefined): string => (value === null || value === undefined ? "-" : value.toFixed(3));

/** The gate's table (markdown): one row per catalogued metric, every state visible, nothing passing silently. */
export function renderLatencyTable(evaluation: LatencyEvaluation): string {
  const lines = [
    `| metric | unit | samples | p50 | p95 | baseline p50 | baseline p95 | state |`, // [B24-D2, 2026-10-09] the unit column: ms, or MiB for the memory family
    `|---|---|---|---|---|---|---|---|`,
    ...evaluation.verdicts.map((verdict) => {
      const reasons = verdict.reasons.filter((reason) => reason !== BASELINE_MISSING_NOTE);
      return `| \`${verdict.metricId}\` | ${latencyMetric(verdict.metricId).unit} | ${verdict.measured?.samples ?? 0} | ${ms(verdict.measured?.p50)} | ${ms(verdict.measured?.p95)} | ${ms(verdict.baseline?.p50)} | ${ms(verdict.baseline?.p95)} | ${latencyVerdictLabel(verdict)}${reasons.length ? ` (${reasons.join("; ")})` : ""} |`;
    }),
    ``,
    `Policy ${evaluation.policyVersion}; baseline version ${evaluation.baselineVersion}${evaluation.declaredWithoutValues ? " (declared without values)" : ""}; ${evaluation.blocking ? "BLOCKING" : "not blocking"}.`,
  ];
  return `${lines.join("\n")}\n`;
}

/** The proposed next version from at least LATENCY_BASELINE_MINIMUM_RUNS runs' results: per metric the median p50 and p95 across the
 *  runs, the noise band from the runs' p95 spread, the run ids; the caller (the lead) appends it after review. Nothing is written. */
export function proposeLatencyBaseline(input: { runs: ReadonlyArray<{ runId: string; results: readonly LatencyResultsDocument[] }>; previous: LatencyBaselineDocument; recordedAt: string }): LatencyBaselineVersion {
  if (input.runs.length < LATENCY_BASELINE_MINIMUM_RUNS) throw new Error(`LATENCY_BASELINE_RUNS_INSUFFICIENT: ${input.runs.length} < ${LATENCY_BASELINE_MINIMUM_RUNS}`);
  const latest = latestLatencyBaseline(input.previous);
  const metrics = LATENCY_METRICS.map((entry): LatencyBaselineMetric => {
    const measured = input.runs.map((run) => ({ runId: run.runId, result: run.results.flatMap((document) => document.metrics).find((candidate) => candidate.metricId === entry.metricId) })).filter((item): item is { runId: string; result: LatencyMetricResult } => item.result !== undefined);
    if (measured.length < LATENCY_BASELINE_MINIMUM_RUNS) throw new Error(`LATENCY_BASELINE_METRIC_UNMEASURED: ${entry.metricId} in ${measured.length} runs`);
    const p50s = measured.map((item) => item.result.p50);
    const p95s = measured.map((item) => item.result.p95);
    return { metricId: entry.metricId, p50: quantile(p50s, 0.5)!, p95: quantile(p95s, 0.5)!, runIds: measured.map((item) => item.runId), budget: defaultLatencyBudget(noiseBandFromRuns(p95s), entry.floor) };
  });
  return { version: latest.version + 1, policyVersion: LATENCY_POLICY_VERSION, recordedAt: input.recordedAt, declaredWithoutValues: false, runIds: input.runs.map((run) => run.runId), metrics, changeRecords: [] };
}
