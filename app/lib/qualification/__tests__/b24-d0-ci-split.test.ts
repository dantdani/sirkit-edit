/**
 * [B24-D0] The OD-30 split of prompt-to-gerber: the measurement, then the split the lead chose. OD-30's rule ("within five minutes of
 * the limit: split the job") was crossed at B24-C2's CI run (20 min 37 s of 25; 21 min 33 s at C3's). D0's first run measured the job's
 * own selection locally and STOPPED (page sections 1-3): the entries that carry 77.6 % of the time are the chapter directory filters
 * whose suites the golden catalog and the scenario map record (`ciJobs`, production data in `app/lib/evaluation/`), and every entry no
 * production record holds adds up to 22.5 %, under the task's 40 %. The lead chose option 2 of section 3 (2026-10-09): B24-B2's 25
 * unlinked named suites, the 11 unheld files of 2 s or more, and the `app/lib/mcp` and `app/lib/computation/__tests__` directory
 * filters - 38 items, 109 files, 42.8 % of the measured testcase time - move by insertions only: one `--exclude '<pattern>'` line each
 * before prompt-to-gerber's `--reporter` line and a job `agent-boundary-suites` appended at the end of the workflow running exactly
 * those items, with the two catalog modules recording the move. This suite pins the measurement to the committed evidence (cases 1-3,
 * unchanged from the first run) and the split to the tree:
 *
 *  1. the committed junit evidence is prompt-to-gerber's own positional selection at this tree: its files are exactly the files the
 *     job's positional filters select (`_ci-admission.ts`'s reader, B19-E's rule), 471 files, 5430 tests, 0 failures, 0 errors, 42 skipped;
 *  2. the page's measurement tables are the evidence: the totals line, the top 25 files by summed testcase time with the entry that
 *     selects each, and every directory filter's file count, time, share and class;
 *  3. the holders are derived from the tree, not asserted: an entry is held by production data when a file it selects is a catalog
 *     link or scenario-map evidence, by test or page pins when a file it selects is in the live registry, a workflow citation anchor,
 *     B19-E's explicit prompt-to-gerber list, B24-B2's named list, a B20 suite under the mcp filters or a B21 suite, or the entry is
 *     a pinned directory filter; the three classes' totals and the ceiling are the page's figures, the ceiling is under 40 %, and the
 *     five heaviest directory filters each hold a catalog link and a scenario-map path;
 *  4. [B24-D0, 2026-10-09] reviewed pin move (the lead's decision): was "the tree is unsplit at D0 and the page says so"; now the tree
 *     is split at D0 and the page says so - 38 `--exclude` lines, the `agent-boundary-suites` key last, the six job keys in order, no
 *     `timeout-minutes` changed; the page's sections in order, its labels, the lead's decision, this suite's row with its real it(
 *     count, every citation on the line it names, the records for the lead under their headings, and no CI time claimed CONFIRMED for
 *     the job that has not run (the split's figures are INFERRED until CI);
 *  5. (i) the new job exists at the end of the workflow with exactly the moved items in prompt-to-gerber's order and the reporter line
 *     last: 20 minutes, the same checkout, pnpm, node and install steps as prompt-to-gerber verbatim, one folded vitest step, an
 *     always() diagnostics upload; no environment variable, secret, database or browser; every other job's limit unchanged;
 *  6. (ii) every `--exclude` of prompt-to-gerber names an item the new job lists and vice versa (a directory filter as `<dir>/**`, a
 *     file as its exact path), the 38 lines contiguous at `:293-330` right before the `--reporter` line, each removing at least one
 *     file the positional filters select; the helper reads them and refuses a bare, unquoted or mis-shaped exclude, another flag, an
 *     exclude above a positional filter and one no positional filter touches;
 *  7. (iii) no item runs in both jobs: over the tree's test files the two selections are disjoint and their union is the former
 *     selection; the 109 moved files are the measured files under the moved items; none starts PGlite; the e2e replay chain and this
 *     suite stay in prompt-to-gerber;
 *  8. (iv) the page's moved-set table equals the xml's figures per item (its workflow line, files, time, share) and in total;
 *  9. (v) the moved set's local total is at least 40 % of the measured total, and the page's OD-30 arithmetic is the task's: each job's
 *     expected CI time is its local testcase time at CI's ratio (20 min 37 s / the local total), stated INFERRED;
 * 10. (vi) A1's insertion table has D0's two rows, the exclusions (`:293`, 38) and the appended job (`:551`, its count including the
 *     leading blank line, A2's convention), each resolving on the tree, as its last two rows;
 * 11. every page citation the 38 lines moved stands on its new line with a dated D0 note, and every statement the split supersedes
 *     (the 36 suites riding prompt-to-gerber, the mcp and computation suites running there, the closed job set, secret-scan last)
 *     carries one;
 * 12. [B24-D0 review, 2026-10-09] the review round's confirmed findings, each a check that was red on the tree the review read and
 *     every problem listed in one run: the guard's helpers sit after its describe block so its cases keep HEAD's lines but for the
 *     in-case notes, and every citation of a guard line those notes moved is re-pinned with a dated note (correctness-1, security-3);
 *     the page holds no placeholder and section 6's gates table has a numeric exit for every gate the task lists, the new job's local
 *     selection among them (correctness-2, security-1); the two B24-B2 statements the split supersedes carry dated notes
 *     (correctness-3); the C1-C3 README-row drafts cite the moved workflow lines (correctness-4); `b24-a2-secret-scan` (c) is titled
 *     as it pins (correctness-5, security-4); the evidence's one hostname is recorded on the page (security-2); the merge gate is
 *     drafted for the lead and listed open (security-5).
 *
 * Red first at `aaa6a1b` (page section 6): cases 4 to 11 fail (no exclude line, no job, no rows, no notes); cases 1 to 3 hold on the
 * evidence. Case 12 red first on the reviewed tree (`d0r3-red-1-review`, section 6), then green. Files are read as text; nothing is
 * written to disk and no process is started.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CI_ADMISSION_ANCHORS, ciAdmission, readRepoText, startsPglite, type RepoReader } from "./_ci-admission";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const read = readRepoText;
const lines = (path: string): string[] => read(path).split(NEWLINE);
const WORKFLOW = ".github/workflows/deterministic-manufacturing.yml";
const PAGE = "artifacts/ai-control-plane-b24/ci-split.md";
const XML = "artifacts/ai-control-plane-b24/evidence/d0-ptg-timing.xml";
const CATALOG_JSON = "artifacts/ai-control-plane-b24/eval-catalog.json";
const SCENARIO_JSON = "artifacts/ai-control-plane-b24/scenario-map.json";
const LIVE_SUITES = "app/lib/evaluation/live-suites.ts";
const GUARD = "app/lib/acquisition/__tests__/b19-e-ci-job-scope.test.ts";
const SELF = "app/lib/qualification/__tests__/b24-d0-ci-split.test.ts";
const ENV_PAGE = "artifacts/ai-control-plane-b24/environments-and-deployment.md";
const DATE = "2026-10-09";
const NEW_JOB = "agent-boundary-suites";
const JOB_KEY = /^ {2}[a-z][a-z0-9-]*:$/;
const EXCLUDE_LINE = /^ {10}--exclude '([^'\s]+)'$/;
const REPORTER_P2G = "          --reporter=dot --reporter=junit --outputFile=vitest-deterministic-manufacturing.xml";
const REPORTER_NEW = `          --reporter=dot --reporter=junit --outputFile=vitest-${NEW_JOB}.xml`;
/** The first `--exclude` line (the first run's C2, the `--reporter` line, before the insertion) and the appended job's first line.
 *  [B24-D1, 2026-10-09] reviewed pin move: A1's insertion rows keep D0's numbers (`:293`, `:551`, 66 lines: the frozen row values,
 *  carried through later rows); the tree's lines moved +1 and +6 under B24-D1's OD-30 steps (prompt-to-gerber's start step at `:32`
 *  and its headroom step at `:344-345`, page-browser-e2e's at `:405` and `:432-433`), and the job gained its own three lines. [B24-D2, 2026-10-09] the job's first line +1 more, under B24-D2's database-delivery entry at `:384`; A1's rows are unchanged. */
const FIRST_EXCLUDE_ROW = 293;
const JOB_FIRST_LINE_ROW = 551;
const JOB_LINES_AT_D0 = 66;
const FIRST_EXCLUDE = 294;
const JOB_FIRST_LINE = 560; // [B24-D2, 2026-10-09] was 557 (B24-D2's database-delivery entry at `:384`); [B24-D4, 2026-10-10] was 558 (B24-D4's two-line env mapping at `:418-419`, OD-30's split of page-browser-e2e)
/** B24-C2's prompt-to-gerber run, 20 min 37 s, the numerator of CI's ratio (task-D0 "What D0 delivers" 6). */
const CI_SECONDS = 1237;
/** The lead's set (page section 3, option 2), in prompt-to-gerber's order: B24-B2's 25 unlinked named suites, the 11 unheld files of
 *  2 s or more, and the `app/lib/mcp` and `app/lib/computation/__tests__` directory filters. */
const MOVED = [
  "app/lib/project/__tests__/b18-b-import-gates.test.ts",
  "app/lib/distributors/__tests__/b19-distributor-egress.test.ts",
  "app/lib/mcp",
  "app/lib/auth/__tests__/b20-b2-mcp-route-policy.test.ts",
  "app/lib/auth/__tests__/b20-b2-route-matrices-pinned.test.ts",
  "app/lib/distributors/__tests__/b19-connector-policy.test.ts",
  "app/lib/distributors/__tests__/b19-d-exact-mpn-connectors.test.ts",
  "app/components/parts/__tests__/b19-e-atomic-publication-panel.test.tsx",
  "app/lib/computation/__tests__",
  "app/lib/engineering/__tests__/b18-e-lost-settlement.test.ts",
  "app/lib/engineering/__tests__/b18-c-result-contract.test.ts",
  "app/lib/engineering/__tests__/b18-c-review-3.test.ts",
  "app/lib/engineering/__tests__/b18-c-review-fixes.test.ts",
  "app/lib/agent/__tests__/b09-1-boundary.test.ts",
  "app/lib/agent/__tests__/b09-1-recovery.test.tsx",
  "app/lib/agent/__tests__/b09-2-closure.test.ts",
  "app/lib/agent/__tests__/b09-2-recovery.test.tsx",
  "app/lib/agent/__tests__/b09-3-closure.test.ts",
  "app/lib/agent/__tests__/b09-proposals.test.ts",
  "app/lib/agent/__tests__/b09-provider-contracts.test.ts",
  "app/lib/agent/__tests__/b10-1-strict-mode-publisher.test.tsx",
  "app/lib/agent/__tests__/b10-editor-context.test.ts",
  "app/lib/agent/__tests__/b11-1-trace-integrity.test.ts",
  "app/lib/agent/__tests__/b11-2-replay-context.test.ts",
  "app/lib/agent/__tests__/b11-3-generated-pcb-shape.test.ts",
  "app/lib/agent/__tests__/b11-4-capture-ownership.test.ts",
  "app/lib/agent/__tests__/b11-4-no-execution.test.ts",
  "app/lib/agent/__tests__/b11-5-capture-exactness.test.ts",
  "app/lib/agent/__tests__/b11-6-projection-ownership.test.ts",
  "app/lib/agent/__tests__/b11-7-primitive-discipline.test.ts",
  "app/api/chat/__tests__/b10-1-request-boundary.test.ts",
  "app/api/chat/__tests__/b10-2-closure.test.ts",
  "app/api/chat/__tests__/b10-chat-boundary.test.ts",
  "app/api/chat/__tests__/b11-1-route-finalization.test.ts",
  "app/lib/auth/__tests__/b16-0-1-ci-gates.test.ts",
  "app/lib/auth/__tests__/b16-0-2-gates.test.ts",
  "app/api/__tests__/b16-0-auth-route-coverage.test.ts",
  "app/lib/auth/__tests__/b16-0-8-migration-ratchet.test.ts",
] as const;
const MOVED_FILES = 109;

/** The test files vitest collects (vitest.config.ts: app/**+/__tests__/*.test.ts(x)), repository-relative, forward slashes, sorted. */
function testFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(ROOT, dir))) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = `${dir}/${entry}`;
    if (statSync(join(ROOT, full)).isDirectory()) testFiles(full, out);
    else if (/\.test\.tsx?$/.test(entry) && full.includes("/__tests__/")) out.push(full);
  }
  return out;
}
const ALL_TESTS = testFiles("app").sort();
/** vitest's positional rule (B19-E): a file is selected when its path contains a filter. */
const positional = (filters: readonly string[]): string[] => ALL_TESTS.filter((file) => filters.some((filter) => file.includes(filter)));
const isTestFile = (entry: string): boolean => /\.test\.tsx?$/.test(entry);
/** An item's `--exclude` pattern: a file its exact path, a directory filter `<dir>/**`. */
const asPattern = (item: string): string => (isTestFile(item) ? item : `${item}/**`);
/** vitest's exclude rule for the two shapes: `<dir>/**` leaves out every file under the directory, a path that one file. */
const excludedBy = (pattern: string, file: string): boolean => (pattern.endsWith("/**") ? file.startsWith(pattern.slice(0, -2)) : file === pattern);
const inMoved = (file: string): boolean => MOVED.some((item) => file.includes(item));
const lineCount = (workflow: readonly string[]): number => workflow.length - (workflow[workflow.length - 1] === "" ? 1 : 0);
/** A job's block of the workflow: its header's 0-based index and its lines to the line before the next header (or the end). */
function jobBlock(workflow: readonly string[], key: string): { start: number; end: number; lines: string[] } {
  const start = workflow.indexOf(key);
  const next = workflow.findIndex((line, index) => index > start && JOB_KEY.test(line));
  const end = next < 0 ? lineCount(workflow) : next;
  return { start, end, lines: workflow.slice(start, end) };
}

// ── the evidence, parsed as the page's tables were derived: document order, testcase times summed per file ────────────────────
interface Measured { readonly file: string; readonly caseTime: number; readonly tests: number; readonly failures: number; readonly errors: number; readonly skipped: number }
const attr = (head: string, name: string): string | null => new RegExp(`\\b${name}="([^"]*)"`).exec(head)?.[1] ?? null;
function parseJunit(xml: string): Measured[] {
  const out = new Map<string, { caseTime: number; tests: number; failures: number; errors: number; skipped: number }>();
  for (const suite of xml.matchAll(/<testsuite\b([^>]*)>([\s\S]*?)<\/testsuite>/g)) {
    const name = attr(suite[1]!, "name")!;
    const record = out.get(name) ?? { caseTime: 0, tests: 0, failures: 0, errors: 0, skipped: 0 };
    for (const field of ["tests", "failures", "errors", "skipped"] as const) record[field] += Number(attr(suite[1]!, field) ?? 0);
    for (const testcase of suite[2]!.matchAll(/<testcase\b([^>]*?)(?:\/>|>)/g)) record.caseTime += Number(attr(testcase[1]!, "time") ?? 0);
    out.set(name, record);
  }
  return [...out].map(([file, record]) => ({ file, ...record }));
}
const seconds = (value: number): string => value.toFixed(2);
const percent = (part: number, whole: number): string => (100 * part / whole).toFixed(1);
const sum = (rows: readonly Measured[]): number => rows.reduce((total, row) => total + row.caseTime, 0);
/** "m min ss s" of a whole number of seconds (the page's CI figures). */
const minutesSeconds = (value: number): string => {
  const whole = Math.round(value);
  return `${Math.floor(whole / 60)} min ${String(whole % 60).padStart(2, "0")} s`;
};

// ── the holders, each derived from the tree ────────────────────────────────────────────────────────────────────────────────────
type Holder = "catalog" | "scenario-map" | "live-registry" | "citation-anchor" | "guard-explicit" | "b24-b2-named" | "guard-b20" | "guard-b21" | "pinned-filter";
type EntryClass = "production-data" | "test-page-pins" | "free";
const catalogLinks = (): Set<string> => new Set((JSON.parse(read(CATALOG_JSON)) as { rows: { links: { path: string }[] }[] }).rows.flatMap((row) => row.links.map((link) => link.path)));
const scenarioPaths = (): Set<string> => new Set((JSON.parse(read(SCENARIO_JSON)) as { scenarios: { evidence: { path: string }[] }[] }).scenarios.flatMap((row) => row.evidence.map((item) => item.path)));
const liveRegistry = (): Set<string> => new Set([...read(LIVE_SUITES).matchAll(/"(app\/[^"]+\.test\.tsx?)"/g)].map((match) => match[1]!));
/** Every anchor of a page citation row of the workflow (`| Cn | \`<workflow>\` | <line> | [<within> |] \`<anchor>\` |`): the text must
 *  stand once on its line (b21-f-page 6 and the B22-B24 page suites), so a filter or file named there is held by that page. */
function workflowAnchors(): Set<string> {
  const anchors = new Set<string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(join(ROOT, dir))) {
      const full = `${dir}/${entry}`;
      if (statSync(join(ROOT, full)).isDirectory()) walk(full);
      else if (entry.endsWith(".md")) for (const row of read(full).matchAll(/^\| C\d+ \| `\.github\/workflows\/deterministic-manufacturing\.yml` \| \d+ \|(?:[^|]*\|)? `([^`]+)` \|/gm)) anchors.add(row[1]!);
    }
  };
  walk("artifacts");
  return anchors;
}
/** B19-E's explicit prompt-to-gerber expectations (b19-e-ci-job-scope cases [B19-E E3], [B20 A4], [SEC-1]): named files that must stay. */
const GUARD_EXPLICIT = new Set([
  "app/lib/acquisition/__tests__/b19-e-agent-read-port.test.ts", "app/lib/acquisition/__tests__/b19-e-live-contract.test.ts", "app/lib/agent/__tests__/b19-e-external-read-service.test.ts",
  "app/lib/agent/__tests__/b20-a4-observation-read-service.test.ts", "app/lib/agent/__tests__/b20-a4-trace-attribution.test.ts", "app/lib/engineering/__tests__/b20-a4-observation-descriptor.test.ts", "app/api/chat/__tests__/b20-a4-chat-mcp-runtime.test.ts",
  "app/lib/mcp/__tests__/b20-a4-observation-normalizer.test.ts", "app/lib/mcp/__tests__/b20-a4-agent-read-port.test.ts", "app/lib/acquisition/__tests__/b20-a4-mcp-quarantine.test.ts",
  "app/lib/spice/__tests__/sec-1-deck-injection.test.ts",
]);
/** Directory filters a suite or a page pins as prompt-to-gerber's: the e2e replay chain (the job's name), A1's and B23's filters
 *  (b24-a1-environment-profile 12 wants each line once), the mcp filters ([B20 A0]), the orchestration filter ([B21 A]) and
 *  acquisition ([B20 A4]). */
const PINNED_FILTERS = new Set(["app/lib/workflow/prompt-to-gerber/__tests__", "app/lib/qualification/__tests__", "app/lib/manufacturing-providers/__tests__", "app/lib/mcp", "app/api/mcp/__tests__", "app/lib/agent/orchestration/__tests__", "app/lib/acquisition"]);
/** B24-B2's named list (b24-b2-ci-admission 3 and 4): the B09-B11 suites, the four B16.0 byte pins, pin-pad-mapping, the
 *  footprint-resolver suites and the three opt-in live suites, each "selected by exactly one prompt-to-gerber filter". */
const b24B2Named = (file: string): boolean =>
  /\/(?:b09|b10|b11)-/.test(file) || /b16-0-(?:1-ci-gates|2-gates|auth-route-coverage|8-migration-ratchet)\.test\.ts$/.test(file) || file.includes("app/lib/footprint-resolver/__tests__") || file.endsWith("pin-pad-mapping.test.ts") || file.endsWith("assist-live.test.ts") || file.endsWith("b16-1b-live-qualification.test.ts") || file.endsWith("kicad-cli-oracle.test.ts");
function holdersOf(file: string, records: { catalog: Set<string>; scenario: Set<string>; live: Set<string>; anchors: Set<string> }): Holder[] {
  const holders: Holder[] = [];
  if (records.catalog.has(file)) holders.push("catalog");
  if (records.scenario.has(file)) holders.push("scenario-map");
  if (records.live.has(file)) holders.push("live-registry");
  if (records.anchors.has(file)) holders.push("citation-anchor");
  if (GUARD_EXPLICIT.has(file)) holders.push("guard-explicit");
  if (b24B2Named(file)) holders.push("b24-b2-named");
  if (/\/b2[0-4]-/.test(file) && (file.startsWith("app/lib/mcp") || file.startsWith("app/api/mcp"))) holders.push("guard-b20");
  if (/\/b21-/.test(file)) holders.push("guard-b21");
  return holders;
}
const classOf = (holders: readonly Holder[]): EntryClass => (holders.length === 0 ? "free" : holders.some((holder) => holder === "catalog" || holder === "scenario-map") ? "production-data" : "test-page-pins");
/** Every positional entry of prompt-to-gerber with its measured files, time, holders and class. */
function entryTable(measured: readonly Measured[]): { entry: string; files: Measured[]; time: number; holders: Holder[]; class: EntryClass }[] {
  const records = { catalog: catalogLinks(), scenario: scenarioPaths(), live: liveRegistry(), anchors: workflowAnchors() };
  return ciAdmission().filters["prompt-to-gerber"].map((entry) => {
    const files = measured.filter((row) => row.file.includes(entry));
    const holders = new Set<Holder>();
    if (PINNED_FILTERS.has(entry) || records.anchors.has(entry)) holders.add(isTestFile(entry) ? "citation-anchor" : "pinned-filter");
    for (const row of files) for (const holder of holdersOf(row.file, records)) holders.add(holder);
    return { entry, files, time: sum(files), holders: [...holders], class: classOf([...holders]) };
  });
}

// ── the page ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const SECTIONS = [
  "0. What B24-D0 is: the measurement, the lead's decision, the split",
  "1. The measurement",
  "2. What holds each heavy entry, and the ceiling",
  "3. The candidate sets and the OD-30 arithmetic",
  "4. The split: what moves and what stays",
  "5. The guards, the helper and the pins moved",
  "6. Test-first record and gates",
  "7. Superseded statements",
  "8. What stays open",
  "9. For the lead",
  "10. Citations",
] as const;
const section = (page: string, title: string): string => {
  const start = page.indexOf(`${NEWLINE}## ${title}${NEWLINE}`);
  const next = page.indexOf(`${NEWLINE}## `, start + 1);
  return start < 0 ? "" : page.slice(start, next < 0 ? undefined : next);
};
/** A1's insertion-table row (b24-a1-environment-profile's INSERTION_ROW): task, date, job, first line, count. */
const INSERTION_ROW = /^\| \[(B24-[A-F]\d*[a-z]?), (\d{4}-\d{2}-\d{2})\] \| ([a-z][a-z0-9-]*) \| `:(\d+)` \| ([1-9]\d*) \|$/;
const insertionRows = (): RegExpExecArray[] => {
  const ten = section(read(ENV_PAGE), "10. The workflow shift (old -> new)").split(NEWLINE);
  const header = ten.indexOf("| task | job | first line | count |");
  const rows: RegExpExecArray[] = [];
  for (let at = header + 2; at < ten.length && ten[at]!.startsWith("|"); at += 1) {
    const row = INSERTION_ROW.exec(ten[at]!);
    if (row) rows.push(row);
  }
  return rows;
};
/** A line of an earlier tree carried through later insertion rows (A1's `carry`). */
const carry = (line: number, rows: readonly RegExpExecArray[]): number => rows.reduce((at, row) => (at >= Number(row[4]) ? at + Number(row[5]) : at), line);

describe("[B24-D0] the OD-30 split of prompt-to-gerber: the measurement and the split", () => {
  it("1. the committed evidence is prompt-to-gerber's own selection at this tree: its files are exactly what the job's positional filters select, 471 files, 5430 tests, 0 failures, 0 errors, 42 skipped", () => {
    expect(existsSync(join(ROOT, XML))).toBe(true);
    const measured = parseJunit(read(XML));
    const filters = ciAdmission().filters["prompt-to-gerber"];
    expect(filters).toHaveLength(242);
    // this suite joined the qualification filter's selection after the measurement ran, so it is the one file set aside
    expect(measured.map((row) => row.file).sort()).toEqual(positional(filters).filter((file) => file !== SELF && !/\/b24-d[1234]-[a-z-]+\.test\.tsx?$/.test(file))); // [B24-D1, 2026-10-09] reviewed pin move: B24-D1's four suites joined the qualification filter's selection after the measurement ran, set aside with this one; [B24-D2, 2026-10-09] reviewed pin move: B24-D2's four suites in app/lib/qualification/__tests__ (board-read, memory, process-cleanup, working-copy) set aside the same way; [B24-D3, 2026-10-10] reviewed pin move: B24-D3's two suites (accessible-names, bom-dialogs - a .tsx) set aside the same way; [B24-D4, 2026-10-10] reviewed pin move: b24-d4-browser-split (the guard of OD-30's split of page-browser-e2e) set aside the same way
    expect(measured).toHaveLength(471);
    const totals = measured.reduce((all, row) => ({ tests: all.tests + row.tests, failures: all.failures + row.failures, errors: all.errors + row.errors, skipped: all.skipped + row.skipped }), { tests: 0, failures: 0, errors: 0, skipped: 0 });
    expect(totals).toEqual({ tests: 5430, failures: 0, errors: 0, skipped: 42 });
    expect(measured.filter((row) => row.tests === row.skipped).map((row) => row.file)).toHaveLength(5); // the opt-in live suites skip whole (OD-222)
    expect(read(XML)).not.toContain(String.fromCharCode(13));
  });

  it("2. the page's measurement tables are the evidence: the totals line, the top 25 files by summed testcase time with the entry that selects each, and every directory filter's files, time, share and class", () => {
    const measured = parseJunit(read(XML));
    const total = sum(measured);
    const page = read(PAGE);
    const one = section(page, SECTIONS[1]);
    const totals = measured.reduce((all, row) => ({ tests: all.tests + row.tests, failures: all.failures + row.failures, errors: all.errors + row.errors, skipped: all.skipped + row.skipped }), { tests: 0, failures: 0, errors: 0, skipped: 0 });
    expect(one).toContain(`**${seconds(total)} s** of testcase time over ${measured.length} files (${totals.tests} tests, ${totals.failures} failures, ${totals.errors} errors, ${totals.skipped} skipped)`);
    const entries = ciAdmission().filters["prompt-to-gerber"];
    const ranked = [...measured].sort((a, b) => b.caseTime - a.caseTime).slice(0, 25);
    const top = [...one.matchAll(/^\| (\d+) \| `([^`]+)` \| ([\d.]+) \| `([^`]+)` \|$/gm)];
    expect(top.map((row) => [Number(row[1]), row[2], row[3], row[4]])).toEqual(ranked.map((row, index) => [index + 1, row.file, seconds(row.caseTime), entries.find((entry) => row.file.includes(entry))]));
    const table = entryTable(measured);
    const directories = table.filter((row) => !isTestFile(row.entry));
    expect(directories).toHaveLength(21);
    const rows = [...one.matchAll(/^\| `([^`]+)` \| (\d+) \| ([\d.]+) \| ([\d.]+) % \| (production-data|test\/page pins|free) \|$/gm)];
    expect(rows.map((row) => [row[1], Number(row[2]), row[3], row[4], row[5]])).toEqual(directories.map((row) => [row.entry, row.files.length, seconds(row.time), percent(row.time, total), row.class === "test-page-pins" ? "test/page pins" : row.class]));
  });

  it("3. the holders are derived from the tree: the three classes' totals and the ceiling are the page's figures, the ceiling without a production-data edit is under 40 %, and the five heaviest directory filters each hold a catalog link and a scenario-map path", () => {
    const measured = parseJunit(read(XML));
    const total = sum(measured);
    const table = entryTable(measured).filter((row) => row.files.length > 0);
    const byClass = (name: EntryClass): { count: number; time: number } => ({ count: table.filter((row) => row.class === name).length, time: table.filter((row) => row.class === name).reduce((all, row) => all + row.time, 0) });
    const production = byClass("production-data");
    const pins = byClass("test-page-pins");
    const free = byClass("free");
    // the class totals are per-entry sums: a file two entries select (B19-E's rule, `qualify-human-only` under `app/api/pcb/qualify`) counts in each
    const filters = ciAdmission().filters["prompt-to-gerber"];
    const doubleCounted = measured.reduce((all, row) => all + row.caseTime * (filters.filter((entry) => row.file.includes(entry)).length - 1), 0);
    expect(seconds(production.time + pins.time + free.time - total)).toBe(seconds(doubleCounted));
    expect(doubleCounted).toBeLessThan(0.1);
    const ceiling = pins.time + free.time;
    expect(ceiling / total).toBeLessThan(0.4);
    expect(production.time / total).toBeGreaterThan(0.7);
    const two = section(read(PAGE), SECTIONS[2]);
    expect(two).toContain(`production data: ${production.count} entries, **${seconds(production.time)} s** (${percent(production.time, total)} %)`);
    expect(two).toContain(`test or page pins only: ${pins.count} entries, **${seconds(pins.time)} s** (${percent(pins.time, total)} %)`);
    expect(two).toContain(`held by nothing: ${free.count} entries, **${seconds(free.time)} s** (${percent(free.time, total)} %)`);
    expect(two).toContain(`the ceiling without a production-data edit is **${seconds(ceiling)} s** (${percent(ceiling, total)} %)`);
    const heaviest = table.filter((row) => !isTestFile(row.entry)).sort((a, b) => b.time - a.time).slice(0, 5);
    const catalog = catalogLinks();
    const scenario = scenarioPaths();
    for (const row of heaviest) {
      expect(row.files.some((file) => catalog.has(file.file)), `${row.entry} holds a catalog link`).toBe(true);
      expect(row.files.some((file) => scenario.has(file.file)), `${row.entry} holds a scenario-map path`).toBe(true);
      expect(row.class, row.entry).toBe("production-data");
      expect(two, row.entry).toContain(`| \`${row.entry}\` | ${row.files.length} | ${seconds(row.time)} | ${percent(row.time, total)} % |`);
    }
    expect(heaviest.map((row) => row.entry)).toEqual(["app/lib/manufacturing-providers/__tests__", "app/lib/mcp", "app/lib/qualification/__tests__", "app/lib/agent/orchestration/__tests__", "app/lib/computation/__tests__"]);
  });

  it("4. [B24-D0, 2026-10-09] reviewed pin move (the lead's decision; was: the tree is unsplit): the tree is split at D0 and the page says so - 38 --exclude lines, the agent-boundary-suites key sixth of seven ([B24-D4, 2026-10-10] was: last among six; B24-D4 appended page-browser-e2e-b24 after it), no timeout-minutes changed; sections in order, the labels, the decision, this suite's row with its it( count, every citation on the line it names, the records for the lead under their headings, no CI time claimed CONFIRMED for the job that has not run", () => {
    const workflow = lines(WORKFLOW);
    expect(workflow.filter((line) => line.trim().startsWith("--exclude"))).toHaveLength(MOVED.length);
    expect(workflow.filter((line) => line.trim().startsWith("--exclude") && !EXCLUDE_LINE.test(line))).toEqual([]);
    expect(workflow.filter((line, index) => index > workflow.indexOf("jobs:") && JOB_KEY.test(line)).map((line) => line.trim())).toEqual(["prompt-to-gerber:", "database-delivery:", "page-browser-e2e:", "production-smoke:", "secret-scan:", `${NEW_JOB}:`, "page-browser-e2e-b24:"]); // [B24-D4, 2026-10-10] reviewed pin move: + the job B24-D4 appended after this one (OD-30's split of page-browser-e2e)
    expect(workflow.filter((line) => /^ {4}timeout-minutes: /.test(line)).map((line) => line.trim())).toEqual(["timeout-minutes: 25", "timeout-minutes: 15", "timeout-minutes: 30", "timeout-minutes: 20", "timeout-minutes: 10", "timeout-minutes: 20", "timeout-minutes: 20"]); // [B24-D4, 2026-10-10] reviewed pin move: + page-browser-e2e-b24's 20; no limit raised
    const page = read(PAGE);
    expect(page.startsWith("# B24-D0 - ")).toBe(true);
    const positions = SECTIONS.map((title) => page.indexOf(`${NEWLINE}## ${title}${NEWLINE}`));
    expect(positions.every((position) => position > 0), JSON.stringify(positions)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    for (const label of ["CONFIRMED", "INFERRED", "RECORDED", "PROPOSED"]) expect(page, label).toContain(`**${label}**`);
    const zero = section(page, SECTIONS[0]);
    expect(zero).toContain("option 2");
    expect(zero).toContain("insertions only");
    for (const fact of ["OD-30", "20 min 37 s", "19 min 58 s", "12 min 38 s", "21 min 33 s", "at least 40 %", "168 = 165 canonical + 3 factories + 0 raw", "47 / 36 / 9 / 27", "107 action records", "32 migrations", `\`${XML}\``, "`ba4f562`", "`aaa6a1b`"]) expect(page, fact).toContain(fact);
    const rows = [...section(page, SECTIONS[6]).matchAll(/^\| `(app\/[^`]+\.test\.tsx?)` \| (\d+) \|$/gm)]; // the suite table of section 6 (section 2's holder rows carry more cells)
    expect(rows.map((row) => row[1])).toEqual([SELF]);
    for (const row of rows) expect((read(row[1]!).match(/^\s*it\(/gm) ?? []).length, `${row[1]} it( blocks`).toBe(Number(row[2]));
    const citations = [...section(page, SECTIONS[10]).matchAll(/^\| (C\d+) \| `([^`]+)` \| (\d+) \| `(.+)` \|$/gm)];
    expect(citations.length).toBeGreaterThanOrEqual(12);
    expect(citations.map((row) => row[1])).toEqual(citations.map((_, index) => `C${index + 1}`));
    const stale = citations.filter((row) => !(lines(row[2]!)[Number(row[3]) - 1] ?? "").includes(row[4]!.replaceAll("\\|", "|"))).map((row) => `${row[1]} ${row[2]}:${row[3]}`);
    expect(stale).toEqual([]);
    for (const cited of [WORKFLOW, GUARD, "app/lib/qualification/__tests__/_ci-admission.ts", "app/lib/evaluation/golden-catalog.ts", "app/lib/evaluation/scenario-map.ts", "app/lib/qualification/__tests__/b24-b2-ci-admission.test.ts", "app/lib/qualification/__tests__/b24-a1-environment-profile.test.ts", "app/lib/qualification/__tests__/b24-a2-secret-scan.test.ts"]) expect(citations.some((row) => row[2] === cited), cited).toBe(true);
    const lead = section(page, SECTIONS[9]);
    for (const heading of ["### OD-30 amendment", "### The discovery section 10 line", "### The README row", `### B24-D0 - the OD-30 split of prompt-to-gerber (${DATE} local; increment workflow + lead; this commit)`]) expect(lead, heading).toContain(heading);
    expect(lead).toMatch(new RegExp(`^- \\[B24-D0, ${DATE}\\] B24-D0 landed `, "m"));
    expect(lead).toMatch(/^\| B24-D0 /m);
    expect(lead).not.toContain("### The lead's decision"); // decided: the split landed
    // no CI time is claimed CONFIRMED for the job that has not run in CI, and the split's figures are INFERRED
    expect(page).not.toMatch(/agent-boundary-suites[^\n]*\b\d+ min \d+ s\b[^\n]*\*\*CONFIRMED\*\*/);
    expect(page).not.toMatch(/\*\*CONFIRMED\*\*[^\n]*agent-boundary-suites[^\n]*\b\d+ min \d+ s\b/);
    expect(page).toMatch(/11 min 47 s[^\n]*\*\*INFERRED\*\*|\*\*INFERRED\*\*[^\n]*11 min 47 s/);
  });

  it("5. (i) the new job is appended at the end of the workflow with exactly the moved items in prompt-to-gerber's order and the reporter line last: 20 minutes, prompt-to-gerber's checkout, pnpm, node and install steps verbatim, one folded vitest step, an always() diagnostics upload; no env, secret, database or browser; the other jobs' limits unchanged", () => {
    const workflow = lines(WORKFLOW);
    const job = ownBlock(workflow, `  ${NEW_JOB}:`); // [B24-D4, 2026-10-10] reviewed pin move: the job's own lines - its block ends where the next job's leading blank and comment lines begin (A1's jobRegions rule), since B24-D4 appended page-browser-e2e-b24 after it
    expect(job.start).toBeGreaterThan(workflow.indexOf("  secret-scan:"));
    expect(job.end).toBe(regionStart(workflow, "  page-browser-e2e-b24:")); // [B24-D4, 2026-10-10] reviewed pin move: was the workflow's end (lineCount); B24-D4's appended job follows
    // appended: its [B24-D0] comment lines sit right above its header, one blank line above them, secret-scan's last step above that
    let above = job.start - 1;
    while (workflow[above]!.startsWith("  # ")) above -= 1;
    expect(job.start - above).toBeGreaterThanOrEqual(2);
    expect(workflow[job.start - 1]).toMatch(/^ {2}# /);
    expect(workflow.slice(above + 1, job.start).join(NEWLINE)).toContain("[B24-D0]");
    expect(workflow[above]).toBe("");
    expect(workflow[above - 1]).toBe('        run: pnpm exec tsx scripts/scan-secrets.ts --history "$BASE_SHA..$HEAD_SHA"');
    expect(above + 1).toBe(JOB_FIRST_LINE);
    // the shape
    const p2g = jobBlock(workflow, CI_ADMISSION_ANCHORS.promptToGerber).lines;
    const setup = p2g.slice(p2g.indexOf("      - uses: actions/checkout@v4"), p2g.indexOf("      - run: pnpm install --frozen-lockfile") + 1);
    expect(setup).toHaveLength(9);
    const expected = [
      `  ${NEW_JOB}:`,
      "    runs-on: ubuntu-latest",
      "    timeout-minutes: 20",
      "    steps:",
      `      - run: echo "SIRKIT_JOB_STARTED_AT=$(date +%s)" >> "$GITHUB_ENV" # [B24-D1] OD-30: ${NEW_JOB}'s start`, // [B24-D1, 2026-10-09] reviewed pin move: the job's OD-30 start step (lead decision D19)
      ...setup,
      "      - run: >-",
      "          pnpm exec vitest run",
      ...MOVED.map((item) => `          ${item}`),
      REPORTER_NEW,
      "      - name: Upload diagnostics",
      "        if: always()",
      "        uses: actions/upload-artifact@v4",
      "        with:",
      `          name: ${NEW_JOB}-diagnostics`,
      `          path: vitest-${NEW_JOB}.xml`,
      "          if-no-files-found: ignore",
      "          retention-days: 14",
      `      - if: always() # [B24-D1] OD-30: ${NEW_JOB}'s headroom`, // [B24-D1, 2026-10-09] reviewed pin move: the job's OD-30 headroom step after its upload (lead decision D19)
      `        run: pnpm exec tsx scripts/ci-job-headroom.ts ${WORKFLOW} ${NEW_JOB}`,
    ];
    expect(job.lines).toEqual(expected);
    const text = job.lines.join(NEWLINE);
    for (const absent of ["env:", "secrets.", "permissions:", "DATABASE_URL", "playwright", "tsc", "next build", "next start", "SUPABASE", "OPENAI", "ANTHROPIC"]) expect(text, absent).not.toContain(absent);
    // the items are in prompt-to-gerber's positional order, each one of its entries
    const order = ciAdmission().filters["prompt-to-gerber"];
    const indexes = MOVED.map((item) => order.indexOf(item));
    expect(indexes.every((index) => index >= 0)).toBe(true);
    expect([...indexes].sort((a, b) => a - b)).toEqual(indexes);
    expect(MOVED).toHaveLength(38);
    expect(MOVED.filter((item) => !isTestFile(item))).toEqual(["app/lib/mcp", "app/lib/computation/__tests__"]);
  });

  it("6. (ii) prompt-to-gerber's --exclude lines are exactly the new job's items (a directory filter as <dir>/**, a file as its path), 38 contiguous lines at :293-330 right before the --reporter line, each removing at least one positionally selected file; the helper reads them the same way and refuses a bare, unquoted or mis-shaped exclude, another flag, an exclude above a positional filter and one no positional filter touches", () => {
    const admission = ciAdmission();
    expect(admission.excludes["prompt-to-gerber"]).toEqual(MOVED.map(asPattern));
    expect(admission.filters[NEW_JOB]).toEqual([...MOVED]);
    expect(admission.excludes[NEW_JOB]).toEqual([]);
    expect(admission.excludes["database-delivery"]).toEqual([]);
    const workflow = lines(WORKFLOW);
    const p2g = jobBlock(workflow, CI_ADMISSION_ANCHORS.promptToGerber);
    const at = workflow.flatMap((line, index) => (EXCLUDE_LINE.test(line) ? [index + 1] : []));
    expect(at).toEqual(Array.from({ length: MOVED.length }, (_, index) => FIRST_EXCLUDE + index));
    expect(at.every((line) => line > p2g.start + 1 && line <= p2g.end)).toBe(true);
    expect(workflow[FIRST_EXCLUDE - 2]).toBe("          app/lib/spice/__tests__/worker-integration.test.ts"); // B24-B3's entry, the last positional line, unmoved
    expect(workflow[FIRST_EXCLUDE + MOVED.length - 1]).toBe(REPORTER_P2G);
    expect(workflow.slice(FIRST_EXCLUDE - 1, FIRST_EXCLUDE + MOVED.length - 1).map((line) => EXCLUDE_LINE.exec(line)![1])).toEqual(MOVED.map(asPattern));
    const selectedByFilters = positional(admission.filters["prompt-to-gerber"]);
    for (const pattern of admission.excludes["prompt-to-gerber"]) expect(selectedByFilters.some((file) => excludedBy(pattern, file)), pattern).toBe(true);
    // the helper bites on each malformed shape (each plant changes the text; the message starts CI_ANCHOR)
    const files = new Map<string, string>();
    for (const path of [WORKFLOW, ".github/workflows/benchmark.yml", "playwright.config.ts", "playwright.orchestration.config.ts", "package.json", "vitest.config.ts"]) files.set(path, read(path));
    const withWorkflow = (text: string): RepoReader => (path) => (path === WORKFLOW ? text : files.get(path) ?? read(path));
    const original = files.get(WORKFLOW)!;
    const first = `          --exclude '${asPattern(MOVED[0])}'`;
    expect(original).toContain(`${NEWLINE}${first}${NEWLINE}`);
    const bites = (text: string, pattern: RegExp): boolean => {
      expect(text, "the plant changes the text").not.toBe(original);
      try {
        ciAdmission(withWorkflow(text));
        return false;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return message.startsWith("CI_ANCHOR: ") && pattern.test(message);
      }
    };
    const silent: string[] = [];
    const plants: ReadonlyArray<readonly [string, string, RegExp]> = [
      ["a bare --exclude", "          --exclude", /a flag that is not --exclude '<pattern>'/],
      ["an unquoted --exclude", `          --exclude ${asPattern(MOVED[0])}`, /a flag that is not --exclude '<pattern>'/],
      ["another flag", "          --bail 1", /a flag that is not --exclude '<pattern>'/],
      ["a mis-shaped pattern (a directory without /**)", "          --exclude 'app/lib/mcp'", /neither <dir>\/\*\* nor a test file/],
      ["a mis-shaped pattern (a file with /**)", `          --exclude '${MOVED[0]}/**'`, /neither <dir>\/\*\* nor a test file/],
      ["an exclude no positional filter touches", "          --exclude 'app/lib/nowhere/__tests__/absent.test.ts'", /no positional filter selects/],
      ["a positional filter after an exclude", `${first}${NEWLINE}          app/lib/net`, /a positional filter after an --exclude/],
    ];
    for (const [name, line, pattern] of plants) if (!bites(original.replace(`${NEWLINE}${first}${NEWLINE}`, `${NEWLINE}${line}${NEWLINE}`), pattern)) silent.push(name);
    expect(silent).toEqual([]);
    // and the derivation still holds with every exclude line dropped: the positional selection alone (case 1's)
    const unsplit = ciAdmission(withWorkflow(original.split(NEWLINE).filter((line) => !EXCLUDE_LINE.test(line)).join(NEWLINE)));
    expect(unsplit.excludes["prompt-to-gerber"]).toEqual([]);
    expect(unsplit.jobsOf(MOVED[0])).toEqual(["prompt-to-gerber", NEW_JOB]);
    expect(admission.jobsOf(MOVED[0])).toEqual([NEW_JOB]);
  });

  it("7. (iii) no item runs in both jobs: the two selections are disjoint and their union is the former selection; the 109 moved files are the measured files under the moved items; none starts PGlite; the e2e replay chain and this suite stay in prompt-to-gerber", { timeout: 60_000 }, () => {
    const admission = ciAdmission();
    const promptToGerber = ALL_TESTS.filter((file) => admission.jobsOf(file).includes("prompt-to-gerber"));
    const moved = ALL_TESTS.filter((file) => admission.jobsOf(file).includes(NEW_JOB));
    expect(moved.filter((file) => promptToGerber.includes(file))).toEqual([]);
    expect([...promptToGerber, ...moved].sort()).toEqual(positional(admission.filters["prompt-to-gerber"]));
    expect(moved).toHaveLength(MOVED_FILES);
    const measured = parseJunit(read(XML));
    expect(moved).toEqual(measured.map((row) => row.file).filter(inMoved).sort());
    expect(moved.filter((file) => startsPglite(file))).toEqual([]);
    expect(ALL_TESTS.filter((file) => admission.jobsOf(file).includes("database-delivery") && admission.jobsOf(file).includes(NEW_JOB))).toEqual([]);
    for (const file of positional(["app/lib/workflow/prompt-to-gerber/__tests__"])) expect(promptToGerber, file).toContain(file);
    expect(promptToGerber).toContain(SELF);
    expect(promptToGerber).toHaveLength(484 - MOVED_FILES); // [B24-D4, 2026-10-10] reviewed pin move: 483 -> 484, b24-d4-browser-split in app/lib/qualification/__tests__ (OD-30's split of page-browser-e2e); [B24-D1, 2026-10-09] reviewed pin move: 472 -> 476, B24-D1's four suites in app/lib/qualification/__tests__ (two of them skipped there, gated by SIRKIT_B24_BENCHMARK); [B24-D2, 2026-10-09] reviewed pin move: 476 -> 480, B24-D2's four suites in app/lib/qualification/__tests__ (board-read, memory, process-cleanup, working-copy; the memory suite skipped there, gated by SIRKIT_B24_BENCHMARK); [B24-D2B, 2026-10-10] reviewed pin move: 480 -> 481, b24-d2-crash-recovery (the crash notice's unit proof); [B24-D3, 2026-10-10] reviewed pin move: 481 -> 483, B24-D3's two suites in app/lib/qualification/__tests__ (b24-d3-accessible-names, b24-d3-bom-dialogs)
  });

  it("8. (iv) the page's moved-set table equals the xml's figures per item - its workflow line, files, testcase time and share - and in total", () => {
    const measured = parseJunit(read(XML));
    const total = sum(measured);
    const workflow = lines(WORKFLOW);
    const four = section(read(PAGE), SECTIONS[4]);
    const rows = [...four.matchAll(/^\| `:(\d+)` \| `([^`]+)` \| (\d+) \| ([\d.]+) \| ([\d.]+) % \|$/gm)];
    const expected = MOVED.map((item) => {
      const files = measured.filter((row) => row.file.includes(item));
      return [String(workflow.indexOf(`          ${item}`) + 1), item, String(files.length), seconds(sum(files)), percent(sum(files), total)];
    });
    expect(rows.map((row) => [row[1], row[2], row[3], row[4], row[5]])).toEqual(expected);
    const movedRows = measured.filter((row) => inMoved(row.file));
    expect(four).toContain(`**${seconds(sum(movedRows))} s** of the measured ${seconds(total)} s (${percent(sum(movedRows), total)} %), ${movedRows.length} files`);
  });

  it("9. (v) the moved set's local total is at least 40 % of the measured total, and the page's OD-30 arithmetic is the task's: each job's expected CI time is its local testcase time at CI's ratio (20 min 37 s over the local total), stated INFERRED", () => {
    const measured = parseJunit(read(XML));
    const total = sum(measured);
    const moved = sum(measured.filter((row) => inMoved(row.file)));
    expect(moved / total).toBeGreaterThanOrEqual(0.4);
    const ratio = CI_SECONDS / total;
    const page = read(PAGE);
    const four = section(page, SECTIONS[4]);
    expect(four).toContain(`${percent(moved, total)} %`);
    const promptToGerber = minutesSeconds((total - moved) * ratio);
    const newJob = minutesSeconds(moved * ratio);
    expect(four).toMatch(new RegExp(`prompt-to-gerber[^\\n]*${promptToGerber} of 25[^\\n]*\\*\\*INFERRED\\*\\*`));
    expect(four).toMatch(new RegExp(`${NEW_JOB}[^\\n]*${newJob} of 20[^\\n]*\\*\\*INFERRED\\*\\*`));
    expect(four).toContain(`ratio ${ratio.toFixed(3)}`);
    expect(four).toContain(`${minutesSeconds(25 * 60 - Math.round((total - moved) * ratio))}`); // prompt-to-gerber's expected headroom
  });

  it("10. (vi) A1's insertion table has D0's two rows as its last two - the exclusions (:293, 38) and the appended job (:551, its count including the leading blank line, A2's convention) - each resolving on the tree", () => { // [B24-D1, 2026-10-09] reviewed pin move: D0's two rows now precede B24-D1's six (its OD-30 steps); each D0 row resolves on the tree carried through D1's rows (A1's `carry`)
    const rows = insertionRows();
    const mine = rows.filter((row) => row[1] === "B24-D0");
    const d0 = rows.indexOf(mine[0]!);
    expect(rows.slice(d0, d0 + 2)).toEqual(mine);
    const later = rows.slice(d0 + 2); // [B24-D1, 2026-10-09] D1's rows, each on a line after D0's or above them (the carry moves D0's lines)
    expect(later.map((row) => [row[1], row[3], Number(row[4]), Number(row[5])])).toEqual([["B24-D1", "prompt-to-gerber", 32, 1], ["B24-D1", "prompt-to-gerber", 344, 2], ["B24-D1", "page-browser-e2e", 405, 1], ["B24-D1", "page-browser-e2e", 432, 2], ["B24-D1", "agent-boundary-suites", 565, 1], ["B24-D1", "agent-boundary-suites", 624, 2], ["B24-D2", "database-delivery", 384, 1], ["B24-D4", "page-browser-e2e", 418, 2], ["B24-D4", "page-browser-e2e-b24", 629, 35]]); // [B24-D2, 2026-10-09] reviewed pin move: + B24-D2's database-delivery row (the handover's rule (1)); [B24-D4, 2026-10-10] reviewed pin move: + B24-D4's two rows (page-browser-e2e's env mapping, the appended page-browser-e2e-b24 job; OD-30's split)
    const workflow = lines(WORKFLOW);
    const jobLines = ownBlock(workflow, `  ${NEW_JOB}:`).end - JOB_FIRST_LINE + 1; // [B24-D4, 2026-10-10] reviewed pin move: the job's own region's last line (was the workflow's last line; B24-D4's job follows it)
    expect(jobLines).toBe(JOB_LINES_AT_D0 + 3); // [B24-D1, 2026-10-09] the job gained its start step and its two headroom lines
    expect(mine.map((row) => [row[2], row[3], Number(row[4]), Number(row[5])])).toEqual([[DATE, "prompt-to-gerber", FIRST_EXCLUDE_ROW, MOVED.length], [DATE, NEW_JOB, JOB_FIRST_LINE_ROW, JOB_LINES_AT_D0]]);
    expect(carry(FIRST_EXCLUDE_ROW, later)).toBe(FIRST_EXCLUDE);
    expect(carry(JOB_FIRST_LINE_ROW, later)).toBe(JOB_FIRST_LINE);
    expect(EXCLUDE_LINE.test(workflow[FIRST_EXCLUDE - 1]!)).toBe(true);
    expect(workflow[JOB_FIRST_LINE - 1]).toBe("");
    expect(workflow[JOB_FIRST_LINE]).toMatch(/^ {2}# /);
    expect(ownBlock(workflow, `  ${NEW_JOB}:`).end).toBe(JOB_FIRST_LINE + jobLines - 1); // [B24-D4, 2026-10-10] reviewed pin move: its own lines (ownBlock), as case 5
    // A2's convention, read from the tree: its secret-scan row (:447 at A2's tree) carried through the later rows is the blank line
    // above secret-scan's comment, and its 26 lines end right above D0's blank line
    const earlier = rows.slice(0, d0);
    const secretScan = earlier.find((row) => row[3] === "secret-scan")!;
    const [first, count] = [Number(secretScan[4]), Number(secretScan[5])];
    const afterSecretScan = [...earlier.slice(earlier.indexOf(secretScan) + 1), ...mine, ...later]; // [B24-D1, 2026-10-09] carried through D0's and D1's rows too
    expect(workflow[carry(first, afterSecretScan) - 1]).toBe("");
    expect(carry(first + count - 1, afterSecretScan)).toBe(JOB_FIRST_LINE - 1);
    // the rows account for every line since A1 (435 lines then; A1's own check), D0's two and D1's six included
    expect(rows.reduce((all, row) => all + Number(row[5]), 0)).toBe(lineCount(workflow) - 435);
  });

  it("11. every page citation the 38 lines moved stands on its new line with a dated D0 note, and every statement the split supersedes carries one", () => {
    const workflow = lines(WORKFLOW);
    const note = `[B24-D0, ${DATE}]`;
    const holds = (path: string, text: string): void => expect(read(path), `${path}: ${text}`).toContain(text);
    const onLine = (line: number, anchor: string): void => expect(workflow[line - 1] ?? "", `${WORKFLOW}:${line}`).toContain(anchor);
    // B21's C49, C93, C94 (b21-f-page 6)
    const matrix = lines("artifacts/ai-control-plane-b21/evaluation-matrix.md");
    for (const [id, line, anchor] of [["C49", 417, "- run: pnpm exec playwright test"], ["C93", 422, "run: pnpm exec playwright test -c playwright.orchestration.config.ts"], ["C94", 431, "playwright-report-orchestration"]] as const) { // [B24-D4, 2026-10-10] reviewed pin move: C93 and C94 +2 (B24-D4's env mapping at `:418-419`); C49 unmoved // [B24-D1, 2026-10-09] reviewed pin move: +4 (B24-D1's OD-30 steps at `:32`, `:344-345` and `:405`); D0's note stays on each row; [B24-D2, 2026-10-09] reviewed pin move: +1 more (B24-D2's database-delivery entry at `:384`)
      const row = matrix.find((candidate) => candidate.startsWith(`| ${id} |`))!;
      expect(row, id).toContain(`| ${id} | \`${WORKFLOW}\` | ${line} | — | \`${anchor}\` |`);
      expect(row, id).toContain(`${note} re-pinned +38`);
      onLine(line, anchor);
    }
    // B23's C64 and its prose citation (b23-b-dfm-quote-flow-page 3, b24-a1-environment-profile 17)
    const pglite = "app/lib/manufacturing-providers/database/__tests__/b23-b-exchange-ledger-pglite.test.ts";
    // [B24-D1, 2026-10-09] reviewed pin move: C64 and its prose cite `:376` with D1's note before D0's (B24-D1's OD-30 steps at `:32` and `:344-345`)
    holds("artifacts/ai-control-plane-b23/dfm-quote-flow.md", `| C64 | \`${WORKFLOW}\` | 376 | \`${pglite}\` |`);
    holds("artifacts/ai-control-plane-b23/dfm-quote-flow.md", `(\`${WORKFLOW}:376\`; [B24-D1, 2026-10-09] was \`:373\` before B24-D1's OD-30 steps at \`:32\` and \`:344-345\`; ${note} was \`:335\` before B24-D0's 38 prompt-to-gerber \`--exclude\` lines at \`:293-330\``);
    holds("artifacts/ai-control-plane-b23/dfm-quote-flow.md", `${note} C64 re-pinned \`:335\` -> \`:373\` in place: B24-D0 inserted 38 prompt-to-gerber \`--exclude\` lines at \`:293-330\` (OD-30's split; the moves of B24-B2 and B24-B3 between are noted on the prose citation's line). [B24-D1, 2026-10-09] C64 re-pinned \`:373\` -> \`:376\` in place: B24-D1's OD-30 steps at \`:32\` and \`:344-345\`.`); // [B24-D1 review, 2026-10-09] D0's whole sentence, then D1's as its own: an earlier note is kept, never spliced (review correctness-4)
    onLine(376, pglite);
    // B24's pages: ci-admission.md's limit line, C1-C3's database-delivery rows and C50, A4's workflow lines
    holds("artifacts/ai-control-plane-b24/ci-admission.md", `| page-browser-e2e | 30 min (\`:398\`; ${note} was \`:360\` before B24-D0's 38 prompt-to-gerber \`--exclude\` lines at \`:293-330\`;`);
    onLine(402, "timeout-minutes: 30"); // [B24-D1, 2026-10-09] reviewed pin move: +3 (the page line keeps D0's text and carries D1's note); [B24-D2, 2026-10-09] +1 more (B24-D2's database-delivery entry at `:384`; the page line carries D2's note)
    holds("artifacts/ai-control-plane-b24/observability-and-replay.md", `| \`${WORKFLOW}:378\` | one database-delivery line, \`app/lib/qualification/database/__tests__/b24-c1-durable-records-pglite.test.ts\`, after B24-A4's last PGlite entry (\`:377\`; ${note}`);
    holds("artifacts/ai-control-plane-b24/observability-and-replay.md", `(\`deterministic-manufacturing.yml:380\`, C50; ${note}`);
    holds("artifacts/ai-control-plane-b24/observability-and-replay.md", `| \`${WORKFLOW}:380\` | one database-delivery line, \`app/lib/qualification/database/__tests__/b24-c3-trace-read-pglite.test.ts\`, after C2's entry (\`:379\`; ${note}`);
    holds("artifacts/ai-control-plane-b24/observability-and-replay.md", `| C50 | \`${WORKFLOW}\` | 383 | \`app/lib/qualification/database/__tests__/b24-c3-trace-read-pglite.test.ts\` |`); // [B24-D1, 2026-10-09] reviewed pin move: 380 -> 383 (b24-c3-recorded-limits resolves the row)
    holds("artifacts/ai-control-plane-b24/retention-and-deletion.md", `| \`${WORKFLOW}:379\` | one database-delivery line, \`app/lib/qualification/database/__tests__/b24-c2-retention-pglite.test.ts\`, after C1's entry (\`:378\`; ${note}`);
    for (const [line, anchor] of [[381, "b24-c1-durable-records-pglite.test.ts"], [382, "b24-c2-retention-pglite.test.ts"], [383, "b24-c3-trace-read-pglite.test.ts"], [377, "b24-a4-rls-default-deny.test.ts"], [380, "b24-a4-restore.test.ts"], [349, "timeout-minutes: 15"]] as const) onLine(line, anchor); // [B24-D1, 2026-10-09] reviewed pin move: +3 each (B24-D1's OD-30 steps at `:32` and `:344-345`)
    holds("artifacts/ai-control-plane-b24/database-and-recovery.md", `four database-delivery entries at \`deterministic-manufacturing.yml:374-377\`, after B23's PGlite entry (\`:373\`, unmoved); ${note}`);
    holds("artifacts/ai-control-plane-b24/database-and-recovery.md", `\`timeout-minutes: 15\` (\`deterministic-manufacturing.yml:346\`; ${note}`);
    // the statements the split supersedes, each with its dated note on its own line
    holds("artifacts/ai-control-plane-b24/ci-admission.md", `so they ride prompt-to-gerber (OD-204's default); no new job, and no \`timeout-minutes\` changed. ${note}`);
    holds("artifacts/ai-control-plane-b24/eval-catalog.md", `The closed job set is \`prompt-to-gerber\`, \`database-delivery\`, \`benchmark-core\`, \`benchmark-nightly\` and \`page-browser-e2e\`, ${note}`);
    holds("artifacts/ai-control-plane-b24/edge-security.md", `so no cited line moves; ${note} B24-D0 appended \`${NEW_JOB}\` after it (OD-30)`);
    holds("artifacts/ai-control-plane-b22/deck-and-secret-corrections.md", `(workflow \`:226\`, after SEC-1's entry; ${note}`);
    holds("artifacts/ai-control-plane-b20/mcp-client-boundary.md", `\`app/lib/mcp\` is a \`prompt-to-gerber\` directory filter (explicit files under it are refused by the redundancy rule); ${note}`);
    holds("artifacts/ai-control-plane-b20/mcp-provider-connectors.md", `(\`app/lib/mcp\`)), so no workflow entry was added. ${note}`);
    // the suites whose pins moved carry the note
    for (const path of [GUARD, "app/lib/qualification/__tests__/_ci-admission.ts", "app/lib/qualification/__tests__/b24-b2-ci-admission.test.ts", "app/lib/qualification/__tests__/b24-a1-environment-profile.test.ts", "app/lib/qualification/__tests__/b24-a2-secret-scan.test.ts", "app/lib/qualification/__tests__/b24-b1-catalog.test.ts", "app/lib/evaluation/golden-catalog.ts", "app/lib/evaluation/scenario-map.ts"]) holds(path, note);
  });

  it("12. [B24-D0 review, 2026-10-09] the review round, every problem listed in one run: the guard's helpers sit after its describe block and every citation of a guard line the in-case notes moved is re-pinned (correctness-1, security-3); no placeholder on the page and a numeric exit for every gate the task lists, the new job's local selection among them (correctness-2, security-1); the superseded B24-B2 statements noted (correctness-3); the C1-C3 README-row drafts on the moved lines (correctness-4); b24-a2-secret-scan (c) titled as it pins (correctness-5, security-4); the evidence's one hostname recorded (security-2); the merge gate drafted and open (security-5)", () => {
    const problems: string[] = [];
    const check = (condition: boolean, problem: string): void => {
      if (!condition) problems.push(problem);
    };
    const holds = (path: string, text: string, times = 1): void => check(read(path).split(text).length - 1 === times, `${path} lacks (${times}x): ${text}`);
    const note = `[B24-D0, ${DATE}]`;
    const A2 = "app/lib/qualification/__tests__/b24-a2-secret-scan.test.ts";
    const B2 = "app/lib/qualification/__tests__/b24-b2-ci-admission.test.ts";
    const CI_ADMISSION = "artifacts/ai-control-plane-b24/ci-admission.md";
    const OBSERVABILITY = "artifacts/ai-control-plane-b24/observability-and-replay.md";
    const RETENTION = "artifacts/ai-control-plane-b24/retention-and-deletion.md";
    const page = read(PAGE);
    // correctness-1, security-3: the helpers after the describe block, the describe on HEAD's :95; the cases that moved re-pinned
    const guard = lines(GUARD);
    const describeAt = guard.indexOf('describe("[B19-E E2 review] CI job scope", () => {') + 1;
    const describeEnd = guard.indexOf("});", describeAt) + 1;
    check(describeAt === 95, `${GUARD}: the describe is on :${describeAt}, HEAD's :95`);
    for (const helper of ["function jobExcludes(", "const excludedBy = ", "const runBy = ", "const OFFLINE_JOBS = ", "const offlineRuns = "]) {
      const at = guard.findIndex((line) => line.startsWith(helper)) + 1;
      check(at > describeEnd, `${GUARD}: ${helper} on :${at}, not after the describe block (ends :${describeEnd})`);
    }
    const caseLine = (start: string): number => guard.findIndex((line) => line.startsWith(start)) + 1;
    const endOf = (start: number): number => guard.findIndex((line, index) => index >= start - 1 && /^ {2}\}(, 60_000)?\);$/.test(line)) + 1;
    const detector = caseLine('  it("[B19-E E2 follow-up] the detector');
    const chapter = caseLine('  it.each(CHAPTERS)("[B20 A0] every %s suite');
    const a0 = caseLine('  it("[B20 A0] the B20 suites:');
    const redundancy = caseLine('  it("no explicit test file in prompt-to-gerber');
    check(detector === 107 && chapter === 150 && a0 === 158, `${GUARD}: the detector, chapter and A0 cases on :${detector}, :${chapter}, :${a0} (HEAD's :106, :148, :156 plus the in-case notes: 107, 150, 158)`);
    holds(CI_ADMISSION, `\`b19-e-ci-job-scope.test.ts:${redundancy}-${endOf(redundancy)}\`; ${note} was \`:236-240\``);
    holds(CI_ADMISSION, `\`b19-e-ci-job-scope.test.ts:${detector}-${endOf(detector)}\`; ${note} was \`:106-124\``);
    holds("artifacts/ai-control-plane-b20/mcp-client-boundary.md", `\`:${chapter}-${endOf(a0)}\` (${note} was \`:147-164\`;`);
    holds(B2, `b19-e-ci-job-scope.test.ts:${detector}-${endOf(detector)}; ${note} was :106-124`, 2);
    check(!/b19-e-ci-job-scope\.test\.ts:(?:106-124|236-240|147-164)[^;]/.test(read(CI_ADMISSION) + read(B2) + read("artifacts/ai-control-plane-b20/mcp-client-boundary.md")), "a HEAD-numbered guard citation stands without its note");
    holds(PAGE, "declared after the describe block, at the end of the file");
    // correctness-2, security-1: no placeholder; section 6's gates table has a numeric exit for every gate the task lists
    check(!/PLACEHOLDER/.test(page), "the page holds a PLACEHOLDER");
    const gates = [...section(page, SECTIONS[6]).matchAll(/^\| (.+?) \| (.*?) \| (.*?) \| (.*?) \|$/gm)].filter((row) => row[1] !== "gate" && !/^-+$/.test(row[1]!));
    check(gates.length >= 16, `section 6's gates table has ${gates.length} rows`);
    for (const row of gates) check(/^\d+(, \d+)*$/.test(row[4]!), `section 6's gates table: no numeric exit in "${row[1]}"`);
    for (const must of ["b24-d0-ci-split", "app/lib/qualification/__tests__", "b19-e-ci-job-scope", "b21-f-page", "b23-b-dfm-quote-flow-page", "b22-a1-page", "b23-d-physical-evidence-contract", "b23-a-provider-admission", "b21-closeout-statements", "b22-closeout-statements", "b23-closeout-statements", "b11-5-capture-exactness", "action-registry", "tsc", "eslint", "generate-b24-eval-catalog", "generate-b24-scenario-map", "generate-b17-control-inventory", "the new job's selection"]) check(gates.some((row) => row[1]!.includes(must)), `section 6's gates table: no row for ${must}`);
    check(gates.some((row) => row[1]!.includes("b24-d0-ci-split") && row[1]!.includes("green") && row[4] === "0"), "section 6's gates table: no green row of this suite with exit 0");
    check(gates.some((row) => row[1]!.includes("the new job's selection") && row[4] === "0" && /^\d+ files$/.test(row[2]!)), "section 6's gates table: no row of the new job's selection run with its files and exit 0");
    check(!/none failed\. \*\*CONFIRMED\*\* by execution/.test(section(page, SECTIONS[4])) || gates.some((row) => row[1]!.includes("the new job's selection") && row[4] === "0"), "section 4 claims the selection run CONFIRMED without its gate row");
    // correctness-3: the two B24-B2 statements the split supersedes carry dated notes, and ci-split.md section 7 lists them
    holds(CI_ADMISSION, `each selected by exactly one prompt-to-gerber filter (${note} superseded in part: 25 of these - the B09-B11 suites but \`b09-loop-safety\` and \`b11-trace-replay-evaluation\`, the four B16.0 pins - are excluded from prompt-to-gerber at \`deterministic-manufacturing.yml:306-330\` and run in the appended \`agent-boundary-suites\` job`);
    holds(CI_ADMISSION, `\`b11-1-trace-integrity.test.ts:445-448\` now run in prompt-to-gerber (\`:278\`, \`:270\`). CONFIRMED; ${note} superseded in part:`);
    holds(CI_ADMISSION, `and the B16.0 gates (\`:283-286\`). CONFIRMED; ${note} superseded:`);
    holds(CI_ADMISSION, `the B11.1 integrity suite (\`:270\`). CONFIRMED; ${note} superseded:`);
    for (const line of ["ci-admission.md:83", "ci-admission.md:362", "ci-admission.md:364", "ci-admission.md:365"]) check(section(page, SECTIONS[7]).includes(`\`${line}\``), `section 7 does not list ${line}`);
    // correctness-4: the C1-C3 README-row drafts cite the moved workflow lines with the dated note
    holds(OBSERVABILITY, `workflow \`deterministic-manufacturing.yml:378\` (${note} was \`:340\` before B24-D0's 38 prompt-to-gerber \`--exclude\` lines at \`:293-330\`); suites \`b24-c1-durable-trace\``);
    holds(OBSERVABILITY, `workflow \`deterministic-manufacturing.yml:380\` (${note} was \`:342\` before B24-D0's 38 prompt-to-gerber \`--exclude\` lines at \`:293-330\`); suites \`b24-c3-trace-read\``);
    holds(RETENTION, `workflow \`deterministic-manufacturing.yml:379\` (${note} was \`:341\` before B24-D0's 38 prompt-to-gerber \`--exclude\` lines at \`:293-330\`); suites \`b24-c2-attribution\``);
    check(!/deterministic-manufacturing\.yml:34[0-2]`;/.test(read(OBSERVABILITY) + read(RETENTION)), "a README-row draft still cites :340-342 without its note");
    for (const [line, was, is] of [[378, 340, "observability-and-replay.md:526"], [380, 342, "observability-and-replay.md:1336"], [379, 341, "retention-and-deletion.md:274"]] as const) check(section(page, SECTIONS[5]).includes(`\`:${was}\` -> \`:${line}\` (\`${is}\``), `section 5 does not record the README-row draft move ${was} -> ${line}`);
    // correctness-5, security-4: b24-a2-secret-scan (c) is titled as its body pins, the suite's header too, the retitle recorded
    const a2 = read(A2);
    check(!a2.includes("the workflow's last job is secret-scan,"), `${A2}: the (c) title still claims secret-scan is the last job`);
    check(!a2.includes("is the workflow's last job."), `${A2}: the header still says secret-scan is the last job`);
    holds(A2, `it("(c) the CI job: secret-scan follows production-smoke and precedes the appended agent-boundary-suites (${note} was: the workflow's last job is secret-scan), declares no permissions`);
    holds(A2, `The CI job \`secret-scan\` follows production-smoke; ${note} it was the workflow's last job until B24-D0 appended \`agent-boundary-suites\` after it (OD-30's split).`);
    check(section(page, SECTIONS[5]).includes("retitled in place to what the body pins"), "section 5's pin table does not record the (c) retitle");
    // security-2: the evidence carries one hostname on every testsuite element; the page records it and drafts the scrub for the lead
    const hosts = [...new Set([...read(XML).matchAll(/\bhostname="([^"]*)"/g)].map((match) => match[1]!))];
    check(hosts.length === 1, `the evidence carries ${hosts.length} hostnames`);
    check(section(page, SECTIONS[8]).includes(`hostname="${hosts[0]}"`), "section 8 does not record the evidence's hostname attribute");
    check(section(page, SECTIONS[9]).includes("### The evidence file's hostname attribute"), "section 9 does not draft the hostname decision for the lead");
    // security-5: the merge gate drafted for the lead and listed open; no job depends on another, as the page states
    check(section(page, SECTIONS[9]).includes("### The merge gate"), "section 9 has no merge-gate heading");
    check(/merge gate/.test(section(page, SECTIONS[8])), "section 8 does not list the merge gate as open");
    check(!/^\s+needs:/m.test(read(WORKFLOW)), "the workflow has a needs: line (the page says no job depends on another)");
    // the lead's files: one drafted line per guard citation the in-case notes moved
    const draft = section(page, SECTIONS[9]);
    check(draft.includes("### The guard's line citations in the lead's files"), "section 9 has no heading for the lead's guard citations");
    for (const cited of ["ai-control-plane-b24/discovery.md:977", "ai-control-plane-b24/discovery.md:986", "ai-control-plane-b24/discovery.md:1436", "ai-control-plane-b24/discovery.md:1569", "ai-control-plane-b22/discovery.md:843", "ai-control-plane-b22/discovery.md:1327", "ai-control-plane-b20/discovery.md:142"]) check(draft.includes(`\`artifacts/${cited}\``), `section 9 drafts nothing for ${cited}`);
    expect(problems).toEqual([]);
  });
});

/** [B24-D4, 2026-10-10] The 0-based index where a job's region begins: its key line, preceded by the blank and `  # ` comment lines
 *  that belong to it (A1's jobRegions rule, b24-a1-environment-profile.test.ts). Declared after the describe block (no case line moves). */
function regionStart(workflow: readonly string[], key: string): number {
  let start = workflow.indexOf(key);
  while (start > 0 && /^(?:\s*| {2}#.*)$/.test(workflow[start - 1]!)) start -= 1;
  return start;
}
/** [B24-D4, 2026-10-10] A job's own lines: jobBlock's lines up to the next job's region (its leading blank and comment lines excluded). */
function ownBlock(workflow: readonly string[], key: string): { start: number; end: number; lines: string[] } {
  const block = jobBlock(workflow, key);
  let end = block.end;
  while (end > block.start + 1 && /^(?:\s*| {2}#.*)$/.test(workflow[end - 1]!)) end -= 1;
  return { start: block.start, end, lines: workflow.slice(block.start, end) };
}
