/**
 * [B24-B2] The stage-09 corpus in the nightly job (D24-15; OD-204's second half; runbook :1070, :147).
 *
 * `benchmark baseline` cannot carry OD-204's corpus: it selects publicDevelopment only (`scripts/benchmark.ts:72`), writes with flag
 * `wx` into the committed artifacts/stage-09 (`:39-42, :71, :79`) and runs `git` (`:17-33`). This suite runs every corpus package
 * outside hiddenHoldout (the holdout stays declared unavailable, benchmark.yml's last nightly step) through `runBenchmarkPackage` and
 * the built-in executor, each with its `runBudgetProfile.trials` seeds as `scripts/benchmark.ts:65` does, into a `mkdtempSync` root
 * under the OS temp directory (removed afterwards); nothing is written under the repository, `scripts/benchmark.ts` is not edited, a
 * fixed `codeRevision` is passed and `productTreeRevision()`/`gitHead()` are never called, so the suite starts no process.
 *
 * Gate: one line-start `describe.runIf` on SIRKIT_B24_CORPUS_NIGHTLY exactly "1" - a non-live, scheduled-job gate (no catalog class, no
 * LB), set only by benchmark-nightly's vitest step (schedule and dispatch). Without the flag the corpus is `not exercised`, never
 * passed. Pull-request jobs never set it: prompt-to-gerber selects this file and runs case 1 alone.
 *
 *  1. (always) benchmark.yml's nightly vitest step selects this suite and its env sets the flag to "1"; the job runs on schedule and
 *     dispatch only; benchmark-core and the deterministic workflow never name the flag; the holdout step stays; this file holds the
 *     one line-start gate and the other B2 suites none;
 *  2. the executor starts no process: the static import closure of builtin-executor.ts holds none of b20-b4's APP_SPAWNERS (read from
 *     that file as text); this file names no process module;
 *  3. the status partition is closed: every BenchmarkRunStatus (types.ts, as text) has exactly one bucket - passed, unknown, blocked,
 *     failing - and failing is exactly the statuses `evaluateRegressionResults([], [status], ...)` blocks with BLOCKING_STATUS:<status>;
 *  4. the corpus: a package that passed in the frozen baseline (artifacts/stage-09, 11 runs, read through ImmutableBenchmarkStore) is
 *     still `passed` (completed_with_unknowns included as a failure); no package's status blocks unless the stored baseline records
 *     that package as failed_correctness and it still is; the four bucket counts are reported apart, never one score.
 *  5. (always; [B24-B2 review, 2026-10-08] correctness-corpus-nightly-red-skips-stage10, security-1) a red corpus run skips no later
 *     nightly step: stage10:test and the holdout declaration run unless the run is cancelled, the diagnostics upload on failure.
 *     Failing first on the reviewed tree (b2fix-red-1): both steps ran only after success.
 */
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evaluateRegressionResults } from "../../benchmark/regression-policy";
import type { BenchmarkRunStatus } from "../../benchmark/types";
import { CI_ADMISSION_ANCHORS, ciAdmission, readRepoText } from "./_ci-admission";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const read = readRepoText;
const SELF = "app/lib/qualification/__tests__/b24-b2-corpus-nightly.test.ts";
const FLAG = "SIRKIT_B24_CORPUS_NIGHTLY";
const BENCHMARK = ".github/workflows/benchmark.yml";
const DETERMINISTIC = ".github/workflows/deterministic-manufacturing.yml";
const EXECUTOR = "app/lib/benchmark/builtin-executor.ts";
const SUITE_ID = "b24-b2-corpus-nightly";
/** Fixed: the suite never derives a revision from git (scripts/benchmark.ts:17-33 would start `git`). */
const CODE_REVISION = "b24-b2-corpus-nightly:fixed-revision";
/** A gate at a line start (B24-B3's census rule). */
const LINE_GATE = /^\s*(?:describe|it|test)\.(?:runIf|skipIf)\(/;

type Bucket = "passed" | "unknown" | "blocked" | "failing";
/** The closed partition of every run status, counted apart (B24-B1's separation): tsc refuses a status with no bucket. */
const BUCKET: Readonly<Record<BenchmarkRunStatus, Bucket>> = Object.freeze({
  passed: "passed",
  completed_with_unknowns: "unknown",
  blocked_by_prerequisite: "blocked", unsupported: "blocked", license_unavailable: "blocked", not_comparable: "blocked",
  failed_correctness: "failing", timeout: "failing", crash: "failing", cancelled: "failing", environment_failure: "failing", oracle_disagreement: "failing", invalid_fixture: "failing",
});
/** Does the regression policy block this status by itself? (BLOCKING_STATUSES is module-private and is neither exported nor copied.) */
const blocks = (status: BenchmarkRunStatus): boolean => evaluateRegressionResults([], [status], "nightly_stochastic").reasons.includes(`BLOCKING_STATUS:${status}`);

describe("[B24-B2] the corpus rides benchmark-nightly only (OD-204)", () => {
  it("1. benchmark.yml's nightly vitest step selects this suite and sets SIRKIT_B24_CORPUS_NIGHTLY to exactly \"1\" (schedule and dispatch only); no pull-request job names the flag; the holdout stays declared unavailable; this file holds the one line-start gate, on the flag alone", () => {
    const admission = ciAdmission();
    expect(admission.jobsOf(SELF)).toEqual(["prompt-to-gerber", "benchmark-nightly"]);
    expect(admission.filters["benchmark-nightly"]).toContain(SELF);
    expect(admission.stepEnv["benchmark-nightly"][FLAG]).toBe("1");
    expect(admission.stepEnv["benchmark-core"][FLAG]).toBeUndefined();
    expect(read(DETERMINISTIC)).not.toContain(FLAG);
    const benchmark = read(BENCHMARK).split(NEWLINE);
    const nightly = benchmark.indexOf(CI_ADMISSION_ANCHORS.benchmarkNightly);
    expect(benchmark[nightly + 1]!.trim()).toBe(CI_ADMISSION_ANCHORS.nightlyCondition);
    expect(benchmark.filter((line) => line.includes(FLAG))).toEqual([`          ${FLAG}: "1"`]);
    // the holdout and licensed suites stay declared unavailable in the nightly job (OD-204's exclusion)
    const holdout = benchmark.findIndex((line) => line.trim() === "- name: Declare unavailable protected suites");
    expect(holdout).toBeGreaterThan(nightly);
    // [B24-B2 review, 2026-10-08] read within the step (its `if:` line, case 5, now precedes `run: |`)
    const holdoutEnd = benchmark.findIndex((line, index) => index > holdout && /^ {0,6}\S/.test(line));
    expect(benchmark.slice(holdout, holdoutEnd < 0 ? benchmark.length : holdoutEnd).some((line) => line.includes("Hidden holdout requires holdout-admin credentials and is not exposed to CI candidates."))).toBe(true);
    // one line-start gate in this file, on the flag alone; none in the other B2 suites
    const gates = read(SELF).split(NEWLINE).filter((line) => LINE_GATE.test(line));
    expect(gates).toEqual([`describe.runIf(process.env.${FLAG} === "1")("[B24-B2] the corpus run (benchmark-nightly; SIRKIT_B24_CORPUS_NIGHTLY exactly \\"1\\")", () => {`]);
    for (const other of ["b24-b2-ci-admission", "b24-b2-power-ground"]) {
      expect(read(`app/lib/qualification/__tests__/${other}.test.ts`).split(NEWLINE).filter((line) => LINE_GATE.test(line)), other).toEqual([]);
    }
  });

  it("5. [B24-B2 review, 2026-10-08] a red corpus run skips no later nightly step: stage10:test and the holdout declaration run unless the run is cancelled, the diagnostics upload on failure; the check bites when either loses its condition", () => {
    const text = read(BENCHMARK);
    const later = nightlyStepsAfterVitest(text);
    expect(later.filter((entry) => entry.condition === null || !RUNS_AFTER_FAILURE.includes(entry.condition)).map((entry) => `${entry.step}: runs only after success`)).toEqual([]);
    expect(later).toEqual([
      { step: `${CI_ADMISSION_ANCHORS.stage10Step}--reporter=dot --reporter=junit --outputFile=vitest-stage10.xml`, condition: NOT_CANCELLED },
      { step: "- name: Upload failure diagnostics", condition: "failure()" },
      { step: "- name: Declare unavailable protected suites", condition: NOT_CANCELLED },
    ]);
    // [PR-L/M integration, 2026-10-18] no stage10 step hands pnpm a literal `--` before its flags (pnpm 11 passes it through, and vitest
    // then ignores the reporter and output flags after it: vitest-stage10.xml was never written for the diagnostics upload)
    expect(text.split(NEWLINE).filter((line) => /pnpm run stage10:test\s+--(\s|$)/.test(line))).toEqual([]);
    // the check bites: without their conditions both steps run only after success again
    const stripped = text.split(NEWLINE).filter((line) => !line.trim().startsWith(`if: ${NOT_CANCELLED}`)).join(NEWLINE);
    expect(stripped).not.toBe(text);
    expect(nightlyStepsAfterVitest(stripped).filter((entry) => entry.condition === null).map((entry) => entry.step)).toEqual([later[0]!.step, later[2]!.step]);
  });
});

describe.runIf(process.env.SIRKIT_B24_CORPUS_NIGHTLY === "1")("[B24-B2] the corpus run (benchmark-nightly; SIRKIT_B24_CORPUS_NIGHTLY exactly \"1\")", () => {
  let root = "";
  let corpus: typeof import("../../benchmark/corpus-v1");
  let runner: typeof import("../../benchmark/runner");
  let executor: typeof import("../../benchmark/builtin-executor");
  let store: typeof import("../../benchmark/result-store");
  beforeAll(async () => {
    // loaded here, not at the top: a pull-request job that skips this block never loads the executor's closure
    [corpus, runner, executor, store] = await Promise.all([import("../../benchmark/corpus-v1"), import("../../benchmark/runner"), import("../../benchmark/builtin-executor"), import("../../benchmark/result-store")]);
    root = mkdtempSync(join(tmpdir(), "sirkit-b24-b2-corpus-"));
  }, 120_000);
  afterAll(async () => {
    if (root !== "") await rm(root, { recursive: true, force: true });
  });

  it("2. the executor starts no process: builtin-executor.ts's static import closure holds none of b20-b4's APP_SPAWNERS, and this file names no process module", async () => {
    const [{ collectProductionFiles }, { importClosure }] = await Promise.all([import("@/app/lib/project/__tests__/_import-gate-helpers"), import("@/app/lib/mcp/server/__tests__/_import-closure")]);
    const gate = read("app/lib/mcp/server/__tests__/b20-b4-process-gate.test.ts");
    const list = /const APP_SPAWNERS = \[([^\]]*)\];/.exec(gate);
    expect(list, "b20-b4's APP_SPAWNERS").not.toBeNull();
    const spawners = [...list![1]!.matchAll(/"([^"]+)"/g)].map((match) => match[1]!);
    expect(spawners).toEqual(expect.arrayContaining(["app/lib/pcb/autoroute/runner.ts", "app/lib/pcb/fab/kicad-cli-runner.ts", "app/lib/computation/diagnostic-runner.ts"]));
    const closure = importClosure(collectProductionFiles(ROOT), [EXECUTOR]);
    expect(closure.size).toBeGreaterThan(50);
    expect(spawners.filter((file) => closure.has(file)).map((file) => closure.get(file)!.join(" -> "))).toEqual([]);
    // this file's own modules: none is a process module or scripts/benchmark.ts (whose productTreeRevision and gitHead run git)
    const specifiers = [...read(SELF).matchAll(/(?:from\s+|import\(\s*)"([^"]+)"/g)].map((match) => match[1]!);
    expect([...new Set(specifiers)].sort()).toEqual([
      "../../benchmark/builtin-executor", "../../benchmark/corpus-v1", "../../benchmark/regression-policy", "../../benchmark/result-store", "../../benchmark/runner", "../../benchmark/types",
      "./_ci-admission", "@/app/lib/mcp/server/__tests__/_import-closure", "@/app/lib/project/__tests__/_import-gate-helpers",
      "node:fs", "node:fs/promises", "node:os", "node:path", "vitest",
    ]);
  }, 60_000); // [B24-B2] measured 1.7 s locally (2026-10-08, b2-corpus-flagged-1): a whole-tree read and the closure walk

  it("3. the status partition is closed: every BenchmarkRunStatus has exactly one bucket, and failing is exactly what the regression policy blocks with BLOCKING_STATUS", () => {
    const union = /export type BenchmarkRunStatus = ([^;]+);/.exec(read("app/lib/benchmark/types.ts"));
    expect(union).not.toBeNull();
    const statuses = [...union![1]!.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]! as BenchmarkRunStatus);
    expect(statuses).toHaveLength(13);
    expect([...statuses].sort()).toEqual(Object.keys(BUCKET).sort());
    expect(statuses.filter((status) => blocks(status)).sort()).toEqual(statuses.filter((status) => BUCKET[status] === "failing").sort());
    const sizes = (["passed", "unknown", "blocked", "failing"] as const).map((bucket) => statuses.filter((status) => BUCKET[status] === bucket).length);
    expect(sizes).toEqual([1, 1, 4, 7]);
  });

  it("4. every corpus package outside hiddenHoldout runs with its trials' seeds into the temporary root: a baseline pass stays passed, no status blocks unless the baseline recorded that package failed_correctness and it still is; the four bucket counts are reported apart", async () => {
    const all = corpus.STAGE9_CORPUS_PACKAGES;
    const packages = all.filter((pkg) => pkg.partition !== "hiddenHoldout");
    expect([all.length, all.length - packages.length, packages.length]).toEqual([63, 5, 58]);
    // the frozen baseline, read as scripts/benchmark.ts:44-48 reads it
    const baselineRoot = join(ROOT, "artifacts", "stage-09");
    const index = JSON.parse(read("artifacts/stage-09/baseline-index.json")) as { runIds: string[]; statuses: Record<string, number> };
    const baseline = await Promise.all(index.runIds.map((runId) => new store.ImmutableBenchmarkStore(baselineRoot).read(runId)));
    expect(baseline).toHaveLength(11);
    const recorded = new Map(baseline.map((bundle) => [bundle.run.packageId, bundle.run.status] as const));
    const baselinePassed = [...recorded].filter(([, status]) => status === "passed").map(([id]) => id);
    const baselineFailedCorrectness = [...recorded].filter(([, status]) => status === "failed_correctness").map(([id]) => id);
    expect([baselinePassed.length, baselineFailedCorrectness.length]).toEqual([index.statuses.passed, index.statuses.failed_correctness]);
    expect([...recorded.keys()].filter((id) => !packages.some((pkg) => pkg.packageId === id))).toEqual([]);

    const outcome = new Map<string, BenchmarkRunStatus>();
    for (const pkg of packages) {
      const stored = await runner.runBenchmarkPackage(pkg, executor.builtinBenchmarkExecutor, {
        artifactRoot: root, repositoryRoot: ROOT, suiteId: SUITE_ID, corpusVersion: corpus.STAGE9_CORPUS_V1.version, productUnderTest: "Sirkit",
        productVersion: SUITE_ID, codeRevision: CODE_REVISION, cacheState: "cold", scope: "ci",
        randomSeeds: Array.from({ length: pkg.runBudgetProfile.trials }, (_, index) => index + 1),
      });
      expect(stored.runDirectory.startsWith(root), pkg.packageId).toBe(true);
      outcome.set(pkg.packageId, stored.run.status);
    }
    const problems: string[] = [];
    for (const id of baselinePassed) if (outcome.get(id) !== "passed") problems.push(`${id}: passed in the baseline, ${outcome.get(id)} now`);
    for (const [id, status] of outcome) {
      if (blocks(status) && !(status === "failed_correctness" && baselineFailedCorrectness.includes(id))) problems.push(`${id}: ${status} (BLOCKING_STATUS)`);
    }
    const counts = { passed: 0, unknown: 0, blocked: 0, failing: 0 } as Record<Bucket, number>;
    const byStatus: Record<string, number> = {};
    for (const status of outcome.values()) {
      counts[BUCKET[status]] += 1;
      byStatus[status] = (byStatus[status] ?? 0) + 1;
    }
    // separate counts, never one score (runbook :1070); the failing count includes the baseline's recorded failed_correctness packages
    console.info(`[B24-B2] corpus ${outcome.size} packages - passed ${counts.passed}; unknown ${counts.unknown}; blocked ${counts.blocked}; failing ${counts.failing}; by status ${JSON.stringify(byStatus)}`);
    console.info(`[B24-B2] corpus packages not passed: ${JSON.stringify([...outcome].filter(([, status]) => status !== "passed").map(([id, status]) => `${id}=${status}${recorded.has(id) ? ` (baseline ${recorded.get(id)})` : ""}`))}`);
    expect(outcome.size).toBe(packages.length);
    expect(problems).toEqual([]);
  }, 120_000); // [B24-B2] measured 2.8 s locally for all 58 packages (2026-10-08, b2-corpus-flagged-1); the nightly allows 90 minutes
});

// [B24-B2 review, 2026-10-08] case 5's reader, declared at the end of the file (the review lesson: new declarations go last)
/** [B24-B2 review, 2026-10-08] correctness-corpus-nightly-red-skips-stage10, security-1: a step with no `if:` runs only when every step
 *  before it succeeded (GitHub's implicit success()), so a red corpus run on the nightly's vitest step would skip it. The conditions
 *  under which a later nightly step still runs after that step failed. */
const NOT_CANCELLED = "${{ !cancelled() }}";
const RUNS_AFTER_FAILURE: readonly string[] = [NOT_CANCELLED, "failure()"];
/** benchmark-nightly's steps after its vitest step: each step's first line (trimmed) and its `if:` (null when it has none). */
function nightlyStepsAfterVitest(text: string): Array<{ readonly step: string; readonly condition: string | null }> {
  const lines = text.split(NEWLINE);
  const start = lines.indexOf(CI_ADMISSION_ANCHORS.benchmarkNightly);
  const next = lines.findIndex((line, index) => index > start && /^ {2}[A-Za-z0-9_-]+:\s*$/.test(line));
  const end = next < 0 ? lines.length : next;
  const firsts = lines.flatMap((line, index) => (index > start && index < end && /^ {6}- /.test(line) ? [index] : []));
  const steps = firsts.map((first, at) => lines.slice(first, firsts[at + 1] ?? end));
  const vitest = steps.findIndex((step) => step[0]!.trim().startsWith(`- run: ${CI_ADMISSION_ANCHORS.vitestStep} `));
  if (start < 0 || vitest < 0) throw new Error("benchmark-nightly or its vitest step is absent");
  return steps.slice(vitest + 1).map((step) => {
    const condition = step.map((line) => /^ {6}- if: (.+?)\s*(?:#.*)?$/.exec(line) ?? /^ {8}if: (.+?)\s*(?:#.*)?$/.exec(line)).find((match) => match !== null);
    return { step: step[0]!.trim(), condition: condition ? condition[1]! : null };
  });
}
