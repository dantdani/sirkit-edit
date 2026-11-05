/**
 * [B24-D1] The threshold census (D24-28, runbook :1109, OD-212): every CI-gated real-clock bound, read from the test sources with the
 * TypeScript compiler API (app/lib/qualification/threshold-census.ts), hand-classified one by one (threshold-classification.ts).
 * Always on: no flag, no measurement, no write.
 *
 *  1. (walk) every CI `elapsed` row is classified with a reason, no classification is stale, every kept row records what it
 *     disproves, no CI row is `performance`, every `moved` marker is classified and its metric catalogued; the counts at the commit;
 *  2. (walk) the census's CI selection equals the admission helper's (B24-B1's re-implementation of b19-e-ci-job-scope's rule) for
 *     every test file, prompt-to-gerber net of its exclusions included;
 *  3. in-memory counterexamples, each caught: an identifier-held bound, a `{ timeout }`, a trailing numeric timeout, a yield, a
 *     default vi.waitFor, a stale row, a performance row left in CI, a moved marker naming an uncatalogued metric, a moved marker with
 *     no classification, a kept row with nothing disproved;
 *  4. the config rows: vitest's 5 s default (vitest.config.ts sets none), its 60 s worker-RPC limit, vi.waitFor's 1,000 ms default
 *     (confirmed in the installed vitest), Playwright's 180 s and 20 s, every job's timeout-minutes;
 *  5. (walk) the CSV byte pin: threshold-census.csv is the rendering, byte for byte, LF, no line number;
 *  6. (walk) the wait rows the CI selects at the commit, by file;
 *  7. (walk) the six moved markers, each in a converted file whose line count and it( count are unchanged, and this suite's own budget
 *     and yield rows.
 *
 * Failing first on 6acae24: the census module is absent (then, with it, 53 CI bounds unclassified; performance-and-reliability.md
 * section 8; [B24-D1 review, 2026-10-09] 55 once the scanner followed a helper-returned timing - b20-a1-redaction-linear's two - and
 * the generator refused them unclassified). The walking cases are async, yield between files and carry 120 s budgets. Files are
 * read as text; nothing is written to disk and no process is started.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LATENCY_METRICS } from "../latency-policy";
import { THRESHOLD_CLASSIFICATIONS } from "../threshold-classification";
import {
  CENSUS_CSV_HEADER,
  CENSUS_EXCLUDED_FILES,
  CENSUS_JOBS,
  MOVED_MARKER,
  RULE_CLASSES,
  THRESHOLD_CLASSES,
  THRESHOLD_KINDS,
  VI_WAIT_FOR_DEFAULT_MS,
  VITEST_DEFAULT_TIMEOUT_MS,
  VITEST_WORKER_RPC_LIMIT_MS,
  censusCounts,
  censusJobs,
  classifyThresholdCensus,
  configRows,
  renderThresholdCensusCsv,
  scanTestSource,
  scanThresholdCensus,
  vitestTestFiles,
  type CensusRow,
  type CensusScan,
  type ThresholdClassification,
} from "../threshold-census";
import { ciAdmission, readRepoText } from "./_ci-admission";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const read = readRepoText;
const CSV = "artifacts/ai-control-plane-b24/threshold-census.csv";
const SELF = "app/lib/qualification/__tests__/b24-d1-threshold-census.test.ts";
const PLANTED = "app/lib/planted/__tests__/b24-d1-planted.test.ts";
const DATE = "2026-10-09";
/** The marker, assembled at run time so this file's own lines never read as a moved bound. */
const marker = (metricId: string): string => ["// [B24-D1, ", DATE, "] performance bound moved to b24-d1-latency ", metricId, " (OD-212)"].join("");
const CI: readonly ["prompt-to-gerber"] = ["prompt-to-gerber"];
const withCi = (rows: readonly Omit<CensusRow, "ci">[], ci: readonly CensusRow["ci"][number][] = CI): CensusRow[] => rows.map((row) => ({ ...row, ci: [...ci] }));
/** One walk, shared by the walking cases (each awaits it; the first runs it). */
let walk: Promise<CensusScan> | null = null;
const census = (): Promise<CensusScan> => (walk ??= scanThresholdCensus({ root: ROOT }));

describe("[B24-D1] the threshold census (D24-28, OD-212)", () => {
  it("1. every CI elapsed row is classified with a reason and no classification is stale; kept rows record what they disprove; no CI row is performance; every moved marker is classified and catalogued - 55 CI bounds at 6acae24 (48 kept, 7 moved), 13 outside CI", { timeout: 120_000 }, async () => { // [B24-D1 review, 2026-10-09] reviewed pin move: 53 (47, 6), 12 -> 55 (48, 7), 13 once the scanner followed a helper-returned timing (b20-a1-redaction-linear's two CI bounds, connectivity-board's best-of-runs outside CI)
    const scan = await census();
    expect(scan.files).toBeGreaterThan(800);
    const classified = classifyThresholdCensus(scan.rows, THRESHOLD_CLASSIFICATIONS);
    expect(classified.problems).toEqual([]);
    const counts = censusCounts(classified.rows);
    expect([counts["elapsed:ci"], counts["moved:ci"], counts["elapsed:none"]]).toEqual([51, 7, 13]); // [PR-J7, 2026-11-04] reviewed pin move (OD-261): 14 -> 13 outside CI and 50 -> 51 CI bounds, j1-project-connectivity's PC-2 bound in CI once the J suites were admitted (agent-boundary-suites), classified a complexity-proof (threshold-classification.ts); [PR-J1 integration, 2026-10-22] reviewed pin move: 13 -> 14 outside CI, the elapsed bound review PC-2 asked for in j1-project-connectivity (a file no CI job selects): the single-sheet connectivity derivation on 17,200 pins stays under 25x the union's own time (+20 ms) - a complexity proof (the quadratic scan it replaced measured ~250x), unclassified as the other thirteen are (only a CI row needs a class); the CI counts and this case's title unchanged (the title keys its own budget row); [PR-G, 2026-10-17] reviewed pin move (OD-250): [48, 7, 15] -> [50, 7, 13] - the two bounds below joined CI with their suites (prompt-to-gerber's positional selection, run in agent-boundary-suites), each classified as its neighbours are: pr-c-composer-question's linearity bound a complexity-proof, pr-f-missing-facts-read's port deadline a deadline-proof; [PR-G, 2026-10-17] reviewed pin move: 13 -> 15 outside CI, the two elapsed bounds PR-C and PR-F added in files no CI job selects (pr-c-composer-question: the empty-project question rule linear on hostile text, < 1,000 ms; pr-f-missing-facts-read: a hanging catalog port meets the read's deadline), unclassified as the other thirteen are (only a CI row needs a class); the CI counts unchanged; [B24-D1 review, 2026-10-09] was [47, 6, 12]
    expect([counts["elapsed:ci:deadline-proof"], counts["elapsed:ci:complexity-proof"], counts["elapsed:ci:performance"] ?? 0, counts["moved:ci:performance"]]).toEqual([34, 17, 0, 7]); // [PR-J7, 2026-11-04] reviewed pin move (OD-261): was [34, 16, 0, 7], + PC-2's complexity-proof; [PR-G, 2026-10-17] reviewed pin move (OD-250): was [33, 15, 0, 7], + one deadline-proof and one complexity-proof (the two admitted bounds); [B24-D1 review, 2026-10-09] was [33, 14, 0, 6]
    expect(THRESHOLD_CLASSIFICATIONS).toHaveLength(58); // [PR-J7, 2026-11-04] reviewed pin move (OD-261): was 57, + PC-2's classification; [PR-G, 2026-10-17] reviewed pin move (OD-250): was 55, + the two admitted bounds; [B24-D1 review, 2026-10-09] was 53
    for (const entry of THRESHOLD_CLASSIFICATIONS) {
      expect(THRESHOLD_CLASSES, entry.key).toContain(entry.class);
      expect(entry.reason.length, entry.key).toBeGreaterThan(24);
      if (entry.class === "performance") expect(LATENCY_METRICS.some((metric) => metric.metricId === entry.movedTo), entry.key).toBe(true);
      else expect(entry.disproves?.length ?? 0, entry.key).toBeGreaterThan(8);
      expect(entry.key).not.toMatch(/:\d+$/); // never a line number
    }
    // a CI row keyed by file + title path + ordinal; every file of the census is one vitest includes
    for (const row of scan.rows.filter((candidate) => candidate.kind === "elapsed" || candidate.kind === "moved")) {
      expect(row.key, row.key).toBe(`${row.file}#${row.test}#${row.ordinal}`);
      expect(row.file.startsWith("app/") && row.file.includes("/__tests__/") && /\.test\.tsx?$/.test(row.file), row.key).toBe(true);
    }
    for (const file of CENSUS_EXCLUDED_FILES) expect(scan.rows.some((row) => row.file === file), file).toBe(false);
    expect([...THRESHOLD_KINDS]).toEqual(["elapsed", "moved", "budget", "yield", "wait", "config"]);
    expect(RULE_CLASSES).toEqual({ budget: "hang-guard", yield: "rpc-yield", wait: "poll-deadline", config: "harness-default" });
  });

  it("2. the census's CI selection equals the admission helper's for every test file (B24-B1's re-implementation of b19-e-ci-job-scope's positional rule, prompt-to-gerber net of its exclusions since B24-D0)", { timeout: 120_000 }, async () => {
    const jobsOf = censusJobs(read);
    const admission = ciAdmission();
    const files = vitestTestFiles(ROOT);
    expect(files.length).toBeGreaterThan(800);
    const wrong: string[] = [];
    for (const [index, file] of files.entries()) {
      const expected = admission.jobsOf(file).filter((job) => (CENSUS_JOBS as readonly string[]).includes(job));
      if (JSON.stringify(jobsOf(file)) !== JSON.stringify(expected)) wrong.push(`${file}: census ${jobsOf(file).join("+") || "none"}, helper ${expected.join("+") || "none"}`);
      if (index % 100 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
    }
    expect(wrong).toEqual([]);
    expect(jobsOf("app/lib/mcp/__tests__/b20-a4-observation-normalizer.test.ts")).toEqual(["agent-boundary-suites"]);
    expect(jobsOf("app/lib/pcb-sync/__tests__/performance-resilience.test.ts")).toEqual(["prompt-to-gerber"]);
    expect(jobsOf("app/lib/benchmark/__tests__/stage-09-benchmark-core.test.ts")).toEqual(["benchmark-core", "benchmark-nightly"]);
    expect(jobsOf("app/lib/pcb/__tests__/route-tool.test.ts")).toEqual([]);
    expect(jobsOf(SELF)).toEqual(["prompt-to-gerber"]);
  });

  it("3. in-memory counterexamples, each caught: an identifier-held bound, a { timeout }, a trailing numeric timeout, a yield, a default vi.waitFor, a stale row, a performance row left in CI, a moved marker naming an uncatalogued metric, one with no classification, and a kept row with nothing disproved", () => {
    const source = [
      'import { describe, expect, it, vi } from "vitest";',
      'describe("planted", () => {',
      '  it("holds a bound", { timeout: 7_000 }, async () => {',
      "    const started = performance.now();",
      "    await work();",
      "    const spent = performance.now() - started;",
      "    expect(spent).toBeLessThan(900);",
      "    expect(Date.now() - started).toBeGreaterThanOrEqual(10);",
      "    await new Promise((resolve) => setImmediate(resolve));",
      "    await vi.waitFor(() => expect(x).toBe(1));",
      "    await vi.waitFor(() => expect(y).toBe(1), { timeout: 2_500 });",
      "    expect(count).toBeLessThan(5);",
      "  });",
      '  it("has a trailing budget", () => {',
      "    expect(1).toBe(1);",
      "  }, 12_000);",
      // [B24-D1 review, 2026-10-09] a timing returned by a helper (b20-a1-redaction-linear's `elapsed`), a helper declared as a function, a
      // helper returning a timestamp, and the best of an array of timings spread into Math.min (connectivity-board): each an elapsed row
      "  const elapsed = (run: () => void): number => { const started = performance.now(); run(); return performance.now() - started; };",
      "  const now = () => performance.now();",
      '  it("times through helpers", () => {',
      "    expect(elapsed(() => work())).toBeLessThan(2_000);",
      "    const spent = elapsed(() => work());",
      '    expect(spent, "shape").toBeLessThan(1_000);',
      "    expect(timed(() => work())).toBeLessThanOrEqual(10);",
      "    const t1 = now();",
      "    work();",
      "    expect(now() - t1).toBeLessThan(30);",
      "    const runs: number[] = [];",
      "    for (let i = 0; i < 3; i += 1) { const t0 = performance.now(); work(); runs.push(performance.now() - t0); }",
      "    const best = Math.min(...runs);",
      "    expect(best).toBeLessThan(50);",
      "    expect(helperWithoutTime(() => work())).toBeLessThan(5);",
      "  });",
      "});",
      "function timed(run: () => void): number { const t = Date.now(); run(); return Date.now() - t; }",
      "function helperWithoutTime(run: () => void): number { run(); return 3; }",
    ].join(NEWLINE);
    const rows = scanTestSource(PLANTED, source);
    const elapsed = rows.filter((row) => row.kind === "elapsed");
    expect(elapsed.map((row) => [row.key, row.comparator, row.boundMs, row.expression])).toEqual([
      [`${PLANTED}#planted > holds a bound#1`, "toBeLessThan", 900, "spent"],
      [`${PLANTED}#planted > holds a bound#2`, "toBeGreaterThanOrEqual", 10, "Date.now() - started"],
      [`${PLANTED}#planted > times through helpers#1`, "toBeLessThan", 2_000, "elapsed(() => work())"],
      [`${PLANTED}#planted > times through helpers#2`, "toBeLessThan", 1_000, "spent"],
      [`${PLANTED}#planted > times through helpers#3`, "toBeLessThanOrEqual", 10, "timed(() => work())"],
      [`${PLANTED}#planted > times through helpers#4`, "toBeLessThan", 30, "now() - t1"],
      [`${PLANTED}#planted > times through helpers#5`, "toBeLessThan", 50, "best"],
    ]);
    expect(rows.find((row) => row.kind === "budget")).toMatchObject({ key: PLANTED, count: 2, min: 7_000, max: 12_000 });
    expect(rows.find((row) => row.kind === "yield")).toMatchObject({ key: PLANTED, count: 1 });
    expect(rows.find((row) => row.kind === "wait")).toMatchObject({ key: PLANTED, count: 2, defaults: 1, min: 2_500, max: 2_500 });
    // the classification join
    const first = `${PLANTED}#planted > holds a bound#1`;
    const second = `${PLANTED}#planted > holds a bound#2`;
    const helperKeys = [1, 2, 3, 4, 5].map((ordinal) => `${PLANTED}#planted > times through helpers#${ordinal}`); // [B24-D1 review, 2026-10-09]
    const kept: ThresholdClassification[] = [{ key: first, class: "deadline-proof", reason: "the planted deadline", disproves: "an unbounded wait" }, { key: second, class: "deadline-proof", reason: "the planted lower bound", disproves: "an immediate refusal" }, ...helperKeys.map((key): ThresholdClassification => ({ key, class: "deadline-proof", reason: "the planted helper-timed bound", disproves: "a helper that never returns" }))];
    const rest = kept.slice(1); // every planted classification but the first bound's
    expect(classifyThresholdCensus(withCi(rows), kept).problems).toEqual([]);
    expect(classifyThresholdCensus(withCi(rows), []).problems).toEqual([first, second, ...helperKeys].map((key) => `UNCLASSIFIED:${key}`).sort());
    expect(classifyThresholdCensus(withCi(rows, []), []).problems).toEqual([]); // outside CI: no class needed
    expect(classifyThresholdCensus(withCi(rows), [...kept, { key: `${PLANTED}#gone#1`, class: "deadline-proof", reason: "stale", disproves: "x" }]).problems).toEqual([`STALE:${PLANTED}#gone#1`]);
    expect(classifyThresholdCensus(withCi(rows), [{ key: first, class: "performance", reason: "left in CI" }, ...rest]).problems).toEqual([`PERFORMANCE_IN_CI:${first}`]);
    expect(classifyThresholdCensus(withCi(rows), [{ key: first, class: "performance", reason: "left in CI", movedTo: "view.pcb-fit-board" }, ...rest]).problems).toEqual([`ELAPSED_WITH_MOVED_TO:${first}`, `PERFORMANCE_IN_CI:${first}`]);
    expect(classifyThresholdCensus(withCi(rows), [{ key: first, class: "deadline-proof", reason: "no disproof" }, ...rest]).problems).toEqual([`DISPROVES_MISSING:${first}`]);
    // the moved marker keeps the original's key and ordinal; an uncatalogued metric and a missing classification are caught
    const moved = source.replace("    expect(spent).toBeLessThan(900);", `    void spent; ${marker("view.pcb-fit-board")}`);
    const movedRows = scanTestSource(PLANTED, moved);
    expect(movedRows.filter((row) => row.kind === "moved").map((row) => [row.key, row.metricId, row.expression])).toEqual([[first, "view.pcb-fit-board", "spent"]]);
    expect(movedRows.filter((row) => row.kind === "elapsed").map((row) => row.key)).toEqual([second, ...helperKeys]);
    const movedClass: ThresholdClassification = { key: first, class: "performance", reason: "moved in the plant", movedTo: "view.pcb-fit-board" };
    expect(classifyThresholdCensus(withCi(movedRows), [movedClass, ...rest]).problems).toEqual([]);
    expect(classifyThresholdCensus(withCi(movedRows), rest).problems).toEqual([`MOVED_UNCLASSIFIED:${first}`]);
    expect(classifyThresholdCensus(withCi(movedRows), [{ ...movedClass, movedTo: "read.via-inspect" }, ...rest]).problems).toEqual([`MOVED_TO_MISMATCH:${first}:read.via-inspect!=view.pcb-fit-board`]);
    const unknown = scanTestSource(PLANTED, source.replace("    expect(spent).toBeLessThan(900);", `    void spent; ${marker("no.such-metric")}`));
    expect(classifyThresholdCensus(withCi(unknown), [{ ...movedClass, movedTo: "no.such-metric" }, ...rest]).problems).toEqual([`MOVED_TO_UNKNOWN_METRIC:${first}:no.such-metric`]);
    // [B24-D1 review, 2026-10-09] a helper-returned timing voided in place is a moved row keyed as the bound it replaced (b20-a1-redaction-linear's shape)
    const movedHelper = scanTestSource(PLANTED, source.replace("    expect(elapsed(() => work())).toBeLessThan(2_000);", `    void elapsed(() => work()); ${marker("moved.redaction-linear-200-scrubs")}`));
    expect(movedHelper.filter((row) => row.kind === "moved").map((row) => [row.key, row.metricId, row.expression])).toEqual([[helperKeys[0], "moved.redaction-linear-200-scrubs", "elapsed(() => work())"]]);
    expect(movedHelper.filter((row) => row.kind === "elapsed").map((row) => row.key)).toEqual([first, second, ...helperKeys.slice(1)]);
    expect(MOVED_MARKER.test(marker("view.pcb-fit-board"))).toBe(true);
    expect(MOVED_MARKER.test("// moved somewhere else")).toBe(false);
    // the marker inside a string literal is not a moved bound (this file's own plants)
    expect(scanTestSource(PLANTED, `const text = "void spent; ${marker("view.pcb-fit-board")}";`).filter((row) => row.kind === "moved")).toEqual([]);
    // a bound that is not a measured time is not an elapsed row
    expect(scanTestSource(PLANTED, 'it("x", () => { expect(list.length).toBeLessThan(5); expect(Date.now()).toBeGreaterThan(0); });').filter((row) => row.kind === "elapsed")).toEqual([]);
  });

  it("4. the config rows: vitest's 5 s default (vitest.config.ts sets no testTimeout), its 60 s worker-RPC limit, vi.waitFor's 1,000 ms default confirmed in the installed vitest, Playwright's 180 s and 20 s, every job's timeout-minutes of both workflows", () => {
    const rows = configRows(read);
    const byKey = Object.fromEntries(rows.map((row) => [row.key, row.boundMs]));
    expect(byKey).toEqual({
      "vitest.testTimeout.default": 5_000,
      "vitest.worker-rpc.onTaskUpdate": 60_000,
      "vi.waitFor.timeout.default": 1_000,
      "playwright.timeout": 180_000,
      "playwright.expect.timeout": 20_000,
      "ci.prompt-to-gerber.timeout-minutes": 25 * 60_000,
      "ci.database-delivery.timeout-minutes": 15 * 60_000,
      "ci.page-browser-e2e.timeout-minutes": 30 * 60_000,
      "ci.production-smoke.timeout-minutes": 20 * 60_000,
      "ci.secret-scan.timeout-minutes": 10 * 60_000,
      "ci.agent-boundary-suites.timeout-minutes": 20 * 60_000,
      "ci.page-browser-e2e-b24.timeout-minutes": 30 * 60_000 /* [PR-J1 integration, 2026-10-22] reviewed pin move, OD-256: 20 -> 30 min */, "ci.page-browser-e2e-agent.timeout-minutes": 30 * 60_000, // [B24-D4, 2026-10-10] reviewed pin move: + the job B24-D4 appended (OD-30's split of page-browser-e2e); [PR-L7, 2026-10-20] reviewed pin move: + page-browser-e2e-agent, the job PR-L7 appended (OD-254)
      "ci.benchmark-core.timeout-minutes": 20 * 60_000,
      "ci.benchmark-nightly.timeout-minutes": 90 * 60_000,
      "ci.benchmark-latency.timeout-minutes": 30 * 60_000,
    });
    expect([VITEST_DEFAULT_TIMEOUT_MS, VITEST_WORKER_RPC_LIMIT_MS, VI_WAIT_FOR_DEFAULT_MS]).toEqual([5_000, 60_000, 1_000]);
    expect(read("vitest.config.ts")).not.toContain("testTimeout");
    expect(read("package.json")).toContain('"vitest": "^3.2.6"');
    expect((JSON.parse(readFileSync(join(ROOT, "node_modules/vitest/package.json"), "utf8")) as { version: string }).version).toBe("3.2.6");
    const chunks = readdirSync(join(ROOT, "node_modules/vitest/dist/chunks")).filter((name) => name.endsWith(".js"));
    const defaults = chunks.map((name) => (readFileSync(join(ROOT, "node_modules/vitest/dist/chunks", name), "utf8").match(/const \{ interval = 50, timeout = 1e3 \} = typeof options === "number" \? \{ timeout: options \} : options;/g) ?? []).length).reduce((sum, count) => sum + count, 0);
    expect(defaults, "vi.waitFor and vi.waitUntil each default to 1,000 ms in the installed vitest").toBe(2);
    // the row set bites: a testTimeout in vitest.config.ts stales the 5 s row
    expect(() => configRows((path) => (path === "vitest.config.ts" ? `${read(path)}// testTimeout: 10_000` : read(path)))).toThrow(/CENSUS_VITEST_TIMEOUT_SET/);
  });

  it("5. the byte pin: threshold-census.csv is the rendering of the classified census, byte for byte - the exact header, LF, a final newline, no CR, no line number", { timeout: 120_000 }, async () => {
    const scan = await census();
    const classified = classifyThresholdCensus(scan.rows, THRESHOLD_CLASSIFICATIONS);
    expect(classified.problems).toEqual([]);
    const rendered = renderThresholdCensusCsv(classified.rows);
    const committed = readFileSync(join(ROOT, CSV), "utf8");
    expect(committed.includes(String.fromCharCode(13))).toBe(false);
    expect(committed.split(NEWLINE)[0]).toBe(CENSUS_CSV_HEADER);
    expect(committed.endsWith(NEWLINE)).toBe(true);
    expect(committed).toBe(rendered);
    expect(committed.split(NEWLINE).length - 2).toBe(classified.rows.length);
    expect(CENSUS_CSV_HEADER.split(",")).not.toContain("line");
  });

  it("6. the wait rows the CI selects at the commit: 26 vi.waitFor calls in 12 files, 24 at the 1,000 ms default, two explicit 15 s timeouts; one more outside CI (b14-1)", { timeout: 120_000 }, async () => { // [B24-D2, 2026-10-09] reviewed pin move: 30 calls in 13 files since B24-D2 - b24-d2-process-cleanup's four, each with an explicit timeout (the 15 s pair unchanged)
    const scan = await census();
    const waits = scan.rows.filter((row) => row.kind === "wait");
    const inCi = waits.filter((row) => row.ci.length > 0);
    expect(inCi.map((row) => [row.file, row.count, row.defaults, row.max])).toEqual([
      ["app/api/chat/__tests__/b18-d-chat-stop.test.ts", 2, 2, null],
      ["app/api/chat/__tests__/b21-b-chat-router.test.ts", 4, 4, null],
      ["app/api/chat/__tests__/b21-d2-chat-proposals.test.ts", 1, 1, null], ["app/lib/__tests__/l6-embedding-cache.test.ts", 1, 1, null], // [PR-L7, 2026-10-20] reviewed pin move: + l6-embedding-cache, admitted to database-delivery (OD-254)
      ["app/lib/computation/__tests__/b22-b-exposure.test.ts", 1, 0, 15_000],
      ["app/lib/mcp/__tests__/b20-a1-http-transport.test.ts", 5, 5, null],
      ["app/lib/mcp/__tests__/b20-a3-authorized-post.test.ts", 2, 2, null],
      ["app/lib/mcp/__tests__/b20-a3-token-cache.test.ts", 2, 2, null],
      ["app/lib/mcp/server/__tests__/b20-b3-read-call.test.ts", 2, 2, null],
      ["app/lib/qualification/__tests__/b24-a3-embedding-admission.test.ts", 1, 1, null],
      ["app/lib/qualification/__tests__/b24-c1-durable-trace.test.ts", 4, 4, null],
      ["app/lib/qualification/__tests__/b24-c1-llm-call-record.test.ts", 1, 1, null],
      ["app/lib/qualification/__tests__/b24-c2-attribution.test.ts", 1, 0, 15_000], ["app/lib/qualification/__tests__/b24-d2-process-cleanup.test.ts", 4, 0, 7_000], // [B24-D2, 2026-10-09] + the process cleanup's four polls (5 s, 5 s, 7 s and the confirm wait)
    ]);
    expect([inCi.reduce((sum, row) => sum + (row.count ?? 0), 0), inCi.reduce((sum, row) => sum + (row.defaults ?? 0), 0)]).toEqual([31, 25]); // [PR-L7, 2026-10-20] 30 -> 31 and 24 -> 25 (+ l6-embedding-cache's one, at the default; OD-254); [B24-D2, 2026-10-09] 26 -> 30 (+ b24-d2-process-cleanup's four, none at the default)
    expect(waits.filter((row) => row.ci.length === 0).map((row) => [row.file, row.count])).toEqual([["app/lib/project/__tests__/b14-1-production-integration.test.tsx", 1]]); // [PR-L7, 2026-10-20] reviewed pin move: - l6-embedding-cache, in CI since PR-L7 admitted it to database-delivery (OD-254); [PR-L6 integration, 2026-10-19] reviewed pin move: + l6-embedding-cache's one vi.waitFor at the default (PR-L6, a suite in no CI job until increment 7 admits it)
  });

  it("7. the seven moved markers: four in b20-a4-observation-normalizer case 6, two in pcb-sync performance-resilience and one in b20-a1-redaction-linear, each a performance row with its catalogued metric, in a converted file whose line count and it( count are unchanged (674 and 17; 62 and 4; 109 and 4); this suite's own budget and yield rows", { timeout: 120_000 }, async () => { // [B24-D1 review, 2026-10-09] reviewed pin move: six -> seven (the redaction-linear bound the first scan missed)
    const scan = await census();
    const moved = scan.rows.filter((row) => row.kind === "moved");
    expect(moved.map((row) => [row.key, row.metricId])).toEqual([
      ["app/lib/mcp/__tests__/b20-a1-redaction-linear.test.ts#[B20 A1] the URL-credential pattern: linear time > 200 scrubs of a 4 000-character leaf with a word boundary at every letter finish well under 2 000 ms#1", "moved.redaction-linear-200-scrubs"], // [B24-D1 review, 2026-10-09]
      ["app/lib/mcp/__tests__/b20-a4-observation-normalizer.test.ts#[B20 A4] 6.1 the observation normalizer > 6. enormous content is bounded before any work and within pinned times#1", "moved.observation-normalizer-huge-text"],
      ["app/lib/mcp/__tests__/b20-a4-observation-normalizer.test.ts#[B20 A4] 6.1 the observation normalizer > 6. enormous content is bounded before any work and within pinned times#2", "moved.observation-normalizer-many-blocks"],
      ["app/lib/mcp/__tests__/b20-a4-observation-normalizer.test.ts#[B20 A4] 6.1 the observation normalizer > 6. enormous content is bounded before any work and within pinned times#3", "moved.observation-normalizer-pathological-marks"],
      ["app/lib/mcp/__tests__/b20-a4-observation-normalizer.test.ts#[B20 A4] 6.1 the observation normalizer > 6. enormous content is bounded before any work and within pinned times#4", "moved.observation-normalizer-structured-budget"],
      ["app/lib/pcb-sync/__tests__/performance-resilience.test.ts#Stage 3 performance and resilience budgets > aggregates a 500-component blocked design completely without creating a board#1", "moved.pcb-sync-aggregate-500-components"],
      ["app/lib/pcb-sync/__tests__/performance-resilience.test.ts#Stage 3 performance and resilience budgets > preflights and applies the small exact new-board fixture within a generous CI budget#1", "moved.pcb-sync-preflight-small-fixture"],
    ]);
    for (const row of moved) expect(row.ci.length, row.key).toBeGreaterThan(0);
    for (const [file, lineCount, itCount, markers] of [["app/lib/mcp/__tests__/b20-a4-observation-normalizer.test.ts", 674, 17, 4], ["app/lib/pcb-sync/__tests__/performance-resilience.test.ts", 62, 4, 2], ["app/lib/mcp/__tests__/b20-a1-redaction-linear.test.ts", 109, 4, 1]] as const) { // [B24-D1 review, 2026-10-09] + redaction-linear
      const text = read(file);
      expect(text.split(NEWLINE).length - (text.endsWith(NEWLINE) ? 1 : 0), file).toBe(lineCount);
      expect((text.match(/^\s*it\(/gm) ?? []).length, file).toBe(itCount);
      expect(text.split(NEWLINE).filter((line) => MOVED_MARKER.test(line.slice(line.indexOf("//")).trim())).length, file).toBe(markers);
    }
    expect(read("app/lib/mcp/__tests__/b20-a4-observation-normalizer.test.ts")).toContain(`it("6. enormous content is bounded before any work and within pinned times", () => { // [B24-D1, ${DATE}] performance bounds moved to b24-d1-latency (OD-212)`);
    expect(read("app/lib/mcp/__tests__/b20-a1-redaction-linear.test.ts")).toContain(`it("200 scrubs of a 4 000-character leaf with a word boundary at every letter finish well under 2 000 ms", () => { // [B24-D1, ${DATE}] performance bound moved to b24-d1-latency (OD-212)`); // [B24-D1 review, 2026-10-09]
    expect(scan.rows.find((row) => row.kind === "budget" && row.file === SELF)).toMatchObject({ count: 5, min: 120_000, max: 120_000 });
    expect(scan.rows.find((row) => row.kind === "yield" && row.file === SELF)?.count).toBeGreaterThanOrEqual(1);
  });
});
