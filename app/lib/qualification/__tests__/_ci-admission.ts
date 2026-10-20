/**
 * [B24-B1] Which CI jobs run a test file or spec (D24-14, OD-203): the golden catalog records each link's `ciJobs` as data and
 * `b24-b1-catalog` case 4 derives them here, from the workflows themselves. Test-only (lead decision D17): no production module and
 * no generator imports this file; B24-B2 extends it in place. It re-implements B19-E's job-filter reader and PGlite detector
 * (`b19-e-ci-job-scope.test.ts`) - a test file is never imported.
 *
 * Every anchor is found by its text, never by its line, and must appear exactly once (absent or twice throws CI_ANCHOR):
 *  - deterministic-manufacturing.yml: the `pull_request` trigger; the job keys `prompt-to-gerber`, `database-delivery` and
 *    `page-browser-e2e`; each vitest job's `pnpm exec vitest run` step (its filters run to the `--reporter` line; a path is selected
 *    when it contains a filter - B19-E's rule - and each line is split on white space as the shell splits the folded step); the
 *    two Playwright run lines, matched as whole trimmed lines so the first never matches the second;
 *  - playwright.config.ts and playwright.orchestration.config.ts: `testDir` and `testMatch`;
 *  - benchmark.yml: the `pull_request` trigger; the job keys `benchmark-core` and `benchmark-nightly`; each job's vitest step and its
 *    `stage10:test` step; the nightly job's schedule-and-dispatch condition;
 *  - package.json: the `stage10:test` script (`vitest run app/lib/engineering/__tests__`);
 *  - vitest.config.ts: the include pattern (vitest runs only `app/**` + `/__tests__/` + `*.test.ts(x)` files).
 * It holds no route-file matcher (b20-b2-route-tree case 3).
 * [B24-B2, 2026-10-08] Extended in place (D24-15, OD-204; no second reader): each benchmark job's one-line vitest step may carry an
 * `env` block (the nightly step's `SIRKIT_B24_CORPUS_NIGHTLY: "1"`), returned as `stepEnv`; an `env:` with no entry, an entry
 * outside one, or a doubled key throws CI_ANCHOR.
 * [B24-D0, 2026-10-09] Extended in place (OD-30's split, ci-split.md; no second reader): a folded vitest step may end, right before
 * its `--reporter` line, in `--exclude '<pattern>'` lines - each a quoted `<dir>/**` or test-file path that some positional filter
 * touches - returned as `excludes`; a job runs a path only when a positional filter selects it and no exclude leaves it out. A bare,
 * unquoted or mis-shaped exclude, another flag, or a positional filter after an exclude throws CI_ANCHOR. The job key
 * `agent-boundary-suites` is a sixth anchor and a sixth job id. [B24-D4, 2026-10-10] OD-30's split of page-browser-e2e: the end of the file. [PR-L7, 2026-10-20] OD-254: a second appended browser job, page-browser-e2e-agent, read the same way (its anchor on pageBrowser's line; the one anchor that may be absent - a workflow from before OD-254 has no such job - though never doubled).
 */
import { readFileSync } from "node:fs";
import { join, posix } from "node:path";

export const CI_JOB_IDS = ["prompt-to-gerber", "database-delivery", "benchmark-core", "benchmark-nightly", "page-browser-e2e", "page-browser-e2e-b24", "page-browser-e2e-agent", "agent-boundary-suites", "benchmark-latency"] as const; // [PR-L7, 2026-10-20] + page-browser-e2e-agent (OD-254, OD-30's split of page-browser-e2e again: the appended browser job running e2e/agent-execution.spec.ts), after page-browser-e2e-b24; [B24-D0, 2026-10-09] + agent-boundary-suites (OD-30's split); [B24-D1, 2026-10-09] + benchmark-latency (OD-212: the appended benchmark job, its one-line vitest step and its env; no stage10 step); [B24-D4, 2026-10-10] + page-browser-e2e-b24 (OD-30's split of page-browser-e2e: the appended browser job, B24's own browser specs; [B24-D4 lead, 2026-10-10] named for them, option (b)), after page-browser-e2e
export type CiJobId = (typeof CI_JOB_IDS)[number];

const NEWLINE = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const DETERMINISTIC = ".github/workflows/deterministic-manufacturing.yml";
const BENCHMARK = ".github/workflows/benchmark.yml";
const PLAYWRIGHT = "playwright.config.ts";
const PLAYWRIGHT_ORCHESTRATION = "playwright.orchestration.config.ts";
const PACKAGE = "package.json";
const VITEST_CONFIG = "vitest.config.ts";

/** The anchors, each by its exact text (a whole trimmed line unless noted). */
export const CI_ADMISSION_ANCHORS = Object.freeze({
  trigger: "pull_request:",
  promptToGerber: "  prompt-to-gerber:",
  databaseDelivery: "  database-delivery:",
  pageBrowser: "  page-browser-e2e:", pageBrowserB24: "  page-browser-e2e-b24:", pageBrowserAgent: "  page-browser-e2e-agent:", // [B24-D4, 2026-10-10] + the appended browser job (OD-30's split of page-browser-e2e); [PR-L7, 2026-10-20] + the second appended browser job (OD-254)
  agentBoundary: "  agent-boundary-suites:", // [B24-D0, 2026-10-09] the appended job (OD-30's split)
  vitestStep: "pnpm exec vitest run",
  playwrightRun: "- run: pnpm exec playwright test",
  orchestrationRun: "run: pnpm exec playwright test -c playwright.orchestration.config.ts",
  e2eTestDir: 'testDir: "./e2e",',
  orchestrationTestDir: 'testDir: "./e2e-orchestration",',
  testMatch: "testMatch: /.*\\.spec\\.ts/,",
  benchmarkCore: "  benchmark-core:",
  benchmarkNightly: "  benchmark-nightly:",
  benchmarkLatency: "  benchmark-latency:", // [B24-D1, 2026-10-09] the appended latency job (OD-212)
  nightlyCondition: "if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'",
  stage10Step: "- run: pnpm run stage10:test ", // [PR-L/M integration, 2026-10-18] reviewed pin move: the literal `--` dropped from both stage10 steps (pnpm 11 passed it to vitest, which then ignored the reporter and output flags: vitest-stage10.xml was never written)
  stage10Script: '"stage10:test": "vitest run app/lib/engineering/__tests__",',
  vitestInclude: 'include: ["app/**/__tests__/**/*.test.{ts,tsx}"],',
});

export type RepoReader = (path: string) => string;
const ROOT = process.cwd();
/** The repository's own files, read as text (LF). */
export const readRepoText: RepoReader = (path) => readFileSync(join(ROOT, path), "utf8").replaceAll(`${CR}${NEWLINE}`, NEWLINE);

const fail = (what: string): never => {
  throw new Error(`CI_ANCHOR: ${what}`);
};
/** The one index of a line equal to `text` (untrimmed when `exact`, else trimmed), or a loud failure. */
function onlyLine(lines: readonly string[], text: string, file: string, exact: boolean, from = 0, to = lines.length): number {
  const hits: number[] = [];
  lines.forEach((line, index) => {
    if (index >= from && index < to && (exact ? line : line.trim()) === text) hits.push(index);
  });
  if (hits.length !== 1) fail(`${file}: "${text}" ${hits.length === 0 ? "absent" : "appears twice"}`);
  return hits[0]!;
}
/** The one line starting with `prefix` (trimmed) inside [from, to), or a loud failure. */
function onlyLineStarting(lines: readonly string[], prefix: string, file: string, from: number, to: number): number {
  const hits = lines.map((line, index) => [line.trim(), index] as const).filter(([line, index]) => index >= from && index < to && line.startsWith(prefix)).map(([, index]) => index);
  if (hits.length !== 1) fail(`${file}: a line starting "${prefix}" ${hits.length === 0 ? "absent" : "appears twice"}`);
  return hits[0]!;
}
/** A job's block: from its key line to the next job key (two-space indent) or the end. */
function jobBlock(lines: readonly string[], key: string, file: string): readonly [number, number] {
  const start = onlyLine(lines, key, file, true);
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[index]!)) { end = index; break; }
  }
  return [start, end];
}
/** A folded vitest step as read: its positional filters and, [B24-D0] since OD-30's split, its `--exclude` patterns. */
interface FoldedStep { readonly filters: readonly string[]; readonly excludes: readonly string[] }
/** The positional filters of a job's folded `pnpm exec vitest run` step, split as the shell splits them, and [B24-D0, 2026-10-09] its
 *  `--exclude '<pattern>'` lines after them (OD-30's split): each a quoted `<dir>/**` or test-file path some positional filter
 *  touches; another flag, a bare, unquoted or mis-shaped exclude, or a positional filter after an exclude throws CI_ANCHOR. */
function foldedVitestStep(lines: readonly string[], key: string, file: string): FoldedStep {
  const [start, end] = jobBlock(lines, key, file);
  const run = onlyLine(lines, CI_ADMISSION_ANCHORS.vitestStep, file, false, start, end);
  const filters: string[] = [];
  const excludes: string[] = [];
  let reporter = run + 1;
  while (reporter < end && !/--reporter/.test(lines[reporter]!)) reporter += 1;
  if (reporter >= end) fail(`${file}: ${key.trim()}'s vitest step has no --reporter line`);
  for (let index = run + 1; index < reporter; index += 1) {
    const line = lines[index]!.trim();
    if (!line.startsWith("--")) {
      if (excludes.length > 0) fail(`${file}: ${key.trim()}'s vitest step has a positional filter after an --exclude: "${line}"`);
      filters.push(...line.split(/\s+/).filter(Boolean));
      continue;
    }
    const exclude = /^--exclude '([^'\s]+)'$/.exec(line);
    if (exclude === null) fail(`${file}: ${key.trim()}'s vitest step has a flag that is not --exclude '<pattern>': "${line}"`);
    const pattern = exclude![1]!;
    const item = pattern.endsWith("/**") ? pattern.slice(0, -3) : pattern;
    if (pattern.endsWith("/**") ? /\.tsx?$/.test(item) : !/\.test\.tsx?$/.test(item)) fail(`${file}: ${key.trim()}'s vitest step has an --exclude that is neither <dir>/** nor a test file: "${pattern}"`);
    if (!filters.some((filter) => item.includes(filter) || filter.includes(item))) fail(`${file}: ${key.trim()}'s vitest step has an --exclude no positional filter selects: "${pattern}"`);
    excludes.push(pattern);
  }
  if (filters.length === 0) fail(`${file}: ${key.trim()}'s vitest step has no filter`);
  return { filters, excludes };
}
/** The filters of a one-line `pnpm exec vitest run <files> --reporter...` step inside a job. */
function inlineVitestFilters(lines: readonly string[], start: number, end: number, file: string, key: string): string[] {
  const run = onlyLineStarting(lines, `- run: ${CI_ADMISSION_ANCHORS.vitestStep} `, file, start, end);
  const tokens = lines[run]!.trim().slice(`- run: ${CI_ADMISSION_ANCHORS.vitestStep} `.length).split(/\s+/);
  const filters = tokens.slice(0, tokens.findIndex((token) => token.startsWith("--")) < 0 ? tokens.length : tokens.findIndex((token) => token.startsWith("--")));
  if (filters.length === 0) fail(`${file}: ${key.trim()}'s vitest step has no filter`);
  return filters;
}
/** [B24-B2] The `env` block of a job's one-line vitest step: the step's own keys (eight spaces) up to the next step or the job's end;
 *  `env:` among them, then its `KEY: value` entries (ten spaces), each value with one pair of surrounding quotes removed. */
function inlineStepEnv(lines: readonly string[], start: number, end: number, file: string, key: string): Record<string, string> {
  const run = onlyLineStarting(lines, `- run: ${CI_ADMISSION_ANCHORS.vitestStep} `, file, start, end);
  const env: Record<string, string> = {};
  let inEnv = false;
  let entries = 0;
  for (let index = run + 1; index < end && /^ {8,}\S/.test(lines[index]!); index += 1) {
    const line = lines[index]!;
    if (/^ {8}\S/.test(line)) {
      if (inEnv && entries === 0) fail(`${file}: ${key.trim()}'s vitest step has an env block with no entry`);
      inEnv = /^ {8}env:\s*$/.test(line);
      continue;
    }
    const entry = /^ {10}([A-Za-z_][A-Za-z0-9_]*):\s*(.*?)\s*$/.exec(line);
    if (!inEnv || entry === null) fail(`${file}: ${key.trim()}'s vitest step has a line outside an env entry: "${line.trim()}"`);
    if (Object.hasOwn(env, entry![1]!)) fail(`${file}: ${key.trim()}'s vitest step sets ${entry![1]} twice`);
    env[entry![1]!] = /^"(.*)"$|^'(.*)'$/.test(entry![2]!) ? entry![2]!.slice(1, -1) : entry![2]!;
    entries += 1;
  }
  if (inEnv && entries === 0) fail(`${file}: ${key.trim()}'s vitest step has an env block with no entry`);
  return env;
}

export interface CiAdmission {
  /** The jobs that run `path` (repository-relative), in CI_JOB_IDS order. */
  readonly jobsOf: (path: string) => CiJobId[];
  /** The positional filters each vitest job applies, as derived (for the page and the bite checks). */
  readonly filters: Readonly<Record<"prompt-to-gerber" | "database-delivery" | "benchmark-core" | "benchmark-nightly" | "agent-boundary-suites" | "benchmark-latency", readonly string[]>>; // [B24-D1, 2026-10-09] + benchmark-latency
  /** [B24-D0] The `--exclude` patterns of each folded vitest job, in order ([] when the step has none). */
  readonly excludes: Readonly<Record<"prompt-to-gerber" | "database-delivery" | "agent-boundary-suites", readonly string[]>>; /** [B24-D4, 2026-10-10] page-browser-e2e's SIRKIT_E2E_SKIP globs and page-browser-e2e-b24's spec arguments, as read; [PR-L7, 2026-10-20] and page-browser-e2e-agent's (OD-254). */ readonly browser: Readonly<{ skip: readonly string[]; b24: readonly string[]; agent: readonly string[] }>;
  /** [B24-B2] The `env` block of each benchmark job's vitest step, values unquoted ({} when the step has none). */
  readonly stepEnv: Readonly<Record<"benchmark-core" | "benchmark-nightly" | "benchmark-latency", Readonly<Record<string, string>>>>; // [B24-D1, 2026-10-09] + benchmark-latency (its vitest step's env holds SIRKIT_B24_BENCHMARK)
}

/** Derive the admission from the workflows; throws CI_ANCHOR when any anchor is absent or appears twice. */
export function ciAdmission(read: RepoReader = readRepoText): CiAdmission {
  const deterministic = read(DETERMINISTIC).split(NEWLINE);
  onlyLine(deterministic, CI_ADMISSION_ANCHORS.trigger, DETERMINISTIC, false);
  const promptToGerber = foldedVitestStep(deterministic, CI_ADMISSION_ANCHORS.promptToGerber, DETERMINISTIC);
  const databaseDelivery = foldedVitestStep(deterministic, CI_ADMISSION_ANCHORS.databaseDelivery, DETERMINISTIC);
  const agentBoundary = foldedVitestStep(deterministic, CI_ADMISSION_ANCHORS.agentBoundary, DETERMINISTIC); // [B24-D0, 2026-10-09]
  const [browserStart, browserEnd] = jobBlock(deterministic, CI_ADMISSION_ANCHORS.pageBrowser, DETERMINISTIC);
  const playwrightRun = onlyLine(deterministic, CI_ADMISSION_ANCHORS.playwrightRun, DETERMINISTIC, false);
  const orchestrationRun = onlyLine(deterministic, CI_ADMISSION_ANCHORS.orchestrationRun, DETERMINISTIC, false);
  for (const [name, index] of [["playwright test", playwrightRun], ["orchestration playwright test", orchestrationRun]] as const) {
    if (index < browserStart || index >= browserEnd) fail(`${DETERMINISTIC}: the ${name} line is outside page-browser-e2e`);
  }
  const playwright = read(PLAYWRIGHT).split(NEWLINE);
  onlyLine(playwright, CI_ADMISSION_ANCHORS.e2eTestDir, PLAYWRIGHT, false);
  onlyLine(playwright, `${CI_ADMISSION_ANCHORS.testMatch} ${E2E_SKIP_SUFFIX}`, PLAYWRIGHT, false); // [B24-D4, 2026-10-10] line 21 holds testMatch and, in place, the SIRKIT_E2E_SKIP reader (E2E_SKIP_SUFFIX, the end of the file)
  const orchestration = read(PLAYWRIGHT_ORCHESTRATION).split(NEWLINE);
  onlyLine(orchestration, CI_ADMISSION_ANCHORS.orchestrationTestDir, PLAYWRIGHT_ORCHESTRATION, false);
  onlyLine(orchestration, CI_ADMISSION_ANCHORS.testMatch, PLAYWRIGHT_ORCHESTRATION, false);

  const pkg = read(PACKAGE).split(NEWLINE);
  const stage10 = pkg[onlyLine(pkg, CI_ADMISSION_ANCHORS.stage10Script, PACKAGE, false)]!.trim();
  const stage10Filters = stage10.slice(stage10.indexOf("vitest run ") + "vitest run ".length, stage10.lastIndexOf('"')).split(/\s+/).filter(Boolean);
  const benchmark = read(BENCHMARK).split(NEWLINE);
  onlyLine(benchmark, CI_ADMISSION_ANCHORS.trigger, BENCHMARK, false);
  const benchmarkFilters = (key: string): string[] => {
    const [start, end] = jobBlock(benchmark, key, BENCHMARK);
    onlyLineStarting(benchmark, CI_ADMISSION_ANCHORS.stage10Step, BENCHMARK, start, end);
    return [...inlineVitestFilters(benchmark, start, end, BENCHMARK, key), ...stage10Filters];
  };
  const core = benchmarkFilters(CI_ADMISSION_ANCHORS.benchmarkCore);
  const nightly = benchmarkFilters(CI_ADMISSION_ANCHORS.benchmarkNightly);
  const stepEnvOf = (key: string): Readonly<Record<string, string>> => {
    const [start, end] = jobBlock(benchmark, key, BENCHMARK);
    return Object.freeze(inlineStepEnv(benchmark, start, end, BENCHMARK, key));
  };
  // [B24-D1, 2026-10-09] the latency job: one inline vitest step (two files), no stage10 step; its env carries the benchmark flag
  const [latencyStart, latencyEnd] = jobBlock(benchmark, CI_ADMISSION_ANCHORS.benchmarkLatency, BENCHMARK);
  const latency = inlineVitestFilters(benchmark, latencyStart, latencyEnd, BENCHMARK, CI_ADMISSION_ANCHORS.benchmarkLatency);
  const stepEnv = Object.freeze({ "benchmark-core": stepEnvOf(CI_ADMISSION_ANCHORS.benchmarkCore), "benchmark-nightly": stepEnvOf(CI_ADMISSION_ANCHORS.benchmarkNightly), "benchmark-latency": stepEnvOf(CI_ADMISSION_ANCHORS.benchmarkLatency) });
  const [nightlyStart, nightlyEnd] = jobBlock(benchmark, CI_ADMISSION_ANCHORS.benchmarkNightly, BENCHMARK);
  const condition = onlyLine(benchmark, CI_ADMISSION_ANCHORS.nightlyCondition, BENCHMARK, false);
  if (condition < nightlyStart || condition >= nightlyEnd) fail(`${BENCHMARK}: the schedule-and-dispatch condition is outside benchmark-nightly`);

  const vitestConfig = read(VITEST_CONFIG).split(NEWLINE);
  onlyLine(vitestConfig, CI_ADMISSION_ANCHORS.vitestInclude, VITEST_CONFIG, false);
  const vitestCollects = (path: string): boolean => path.startsWith("app/") && path.includes("/__tests__/") && /\.test\.tsx?$/.test(path);
  const contains = (filters: readonly string[], path: string): boolean => filters.some((filter) => path.includes(filter));
  // [B24-D0, 2026-10-09] vitest's exclude for the two admitted shapes: `<dir>/**` every path under the directory, a file path that file
  const excludedBy = (pattern: string, path: string): boolean => (pattern.endsWith("/**") ? path.startsWith(pattern.slice(0, -2)) : path === pattern);
  const runs = (step: FoldedStep, path: string): boolean => contains(step.filters, path) && !step.excludes.some((pattern) => excludedBy(pattern, path));
  // [B24-D4, 2026-10-10] OD-30's split of page-browser-e2e, read from the workflow: the SIRKIT_E2E_SKIP globs of its first browser
  // step (playwright.config.ts:21 ignores them) and the specs page-browser-e2e-b24's one run line names - the same specs
  const browser = browserSplit(deterministic, playwrightRun, browserEnd, read);

  const jobsOf = (path: string): CiJobId[] => {
    const normal = posix.normalize(path);
    const jobs = new Set<CiJobId>();
    if (vitestCollects(normal)) {
      if (runs(promptToGerber, normal)) jobs.add("prompt-to-gerber");
      if (runs(databaseDelivery, normal)) jobs.add("database-delivery");
      if (runs(agentBoundary, normal)) jobs.add("agent-boundary-suites"); // [B24-D0, 2026-10-09]
      if (contains(core, normal)) jobs.add("benchmark-core");
      if (contains(nightly, normal)) jobs.add("benchmark-nightly");
      if (contains(latency, normal)) jobs.add("benchmark-latency"); // [B24-D1, 2026-10-09]
    }
    if (/^e2e\/[^/]+\.spec\.ts$/.test(normal)) { // [B24-D4, 2026-10-10] page-browser-e2e runs every e2e spec its skip globs leave in (a `**/` glob: the file name at any depth), the new job the specs it names
      if (!browser.skip.some((glob) => normal.endsWith(`/${glob.slice(3)}`))) jobs.add("page-browser-e2e");
      if (browser.b24.includes(normal)) jobs.add("page-browser-e2e-b24"); if (browser.agent.includes(normal)) jobs.add("page-browser-e2e-agent"); // [PR-L7, 2026-10-20] OD-254
    }
    if (/^e2e-orchestration\/[^/]+\.spec\.ts$/.test(normal)) jobs.add("page-browser-e2e");
    return CI_JOB_IDS.filter((job) => jobs.has(job));
  };
  return Object.freeze({
    jobsOf,
    filters: Object.freeze({ "prompt-to-gerber": promptToGerber.filters, "database-delivery": databaseDelivery.filters, "benchmark-core": core, "benchmark-nightly": nightly, "agent-boundary-suites": agentBoundary.filters, "benchmark-latency": latency }), // [B24-D1, 2026-10-09] + benchmark-latency
    excludes: Object.freeze({ "prompt-to-gerber": promptToGerber.excludes, "database-delivery": databaseDelivery.excludes, "agent-boundary-suites": agentBoundary.excludes }), // [B24-D0, 2026-10-09]
    stepEnv,
    browser, // [B24-D4, 2026-10-10]
  });
}

// ── B19-E's PGlite detector, re-implemented (b19-e-ci-job-scope.test.ts; never imported) ─────────────────────────────────────────

/** An import specifier that starts the disposable PostgreSQL or PGlite (statically or dynamically, by any relative spelling). */
const POSTGRES_SPECIFIER = new RegExp(["(^|/)disposable-postgres(\\.ts)?$", "^@electric-sql/pglite", "^drizzle-orm/pglite"].join("|"));
const IMPORT_SPECIFIER = /(?:from\s+|import\(\s*|import\s+)["']([^"']+)["']/g;
const fileCache = new Map<string, string | null>();
/** A repository file's text, or null when it is no file. */
export const readRepoFileOrNull = (path: string): string | null => {
  if (!fileCache.has(path)) {
    try {
      fileCache.set(path, readRepoText(path));
    } catch {
      fileCache.set(path, null);
    }
  }
  return fileCache.get(path)!;
};
/** Does a suite start PostgreSQL, itself or through a relative import it follows (up to `depth` levels)? */
export function startsPglite(file: string, read: (file: string) => string | null = readRepoFileOrNull, depth = 4, seen = new Set<string>()): boolean {
  if (seen.has(file)) return false;
  seen.add(file);
  const source = read(file);
  if (source === null) return false;
  for (const match of source.matchAll(IMPORT_SPECIFIER)) {
    const specifier = match[1]!;
    if (POSTGRES_SPECIFIER.test(specifier)) return true;
    if (depth > 0 && specifier.startsWith(".")) {
      const base = posix.normalize(posix.join(posix.dirname(file), specifier));
      for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
        if (read(candidate) !== null) {
          if (startsPglite(candidate, read, depth - 1, seen)) return true;
          break;
        }
      }
    }
  }
  return false;
}

// ── [B24-D4, 2026-10-10] OD-30's split of page-browser-e2e (ci-split.md section 11; declared last, so no cited line above moves) ───────
// page-browser-e2e's first browser step carries an `env:` mapping with exactly one entry, SIRKIT_E2E_SKIP: a quoted comma-separated
// list of spec globs, each `**` + `/<name>.spec.ts` naming a spec under e2e/ (playwright.config.ts:21 splits it, trims each glob and
// drops blanks; a `**/` glob matches the file name at any depth). The appended job page-browser-e2e-b24 runs the specs its
// one `run: pnpm exec playwright test <spec>...` line names, each an `e2e/<name>.spec.ts` that exists. The two lists name the same
// specs. A malformed mapping, glob or argument, a glob naming no spec, a missing or doubled run line, or a disagreement throws CI_ANCHOR.

/** Line 21 of playwright.config.ts after `testMatch`, exactly (admitted in place): the SIRKIT_E2E_SKIP reader and its dated note. */
export const E2E_SKIP_SUFFIX = `testIgnore: (process.env.SIRKIT_E2E_SKIP ?? "").split(",").map((glob) => glob.trim()).filter(Boolean), // [B24-D4, 2026-10-10] OD-30's split: SIRKIT_E2E_SKIP, a comma-separated list of spec globs, leaves those specs out of a run (page-browser-e2e skips the four page-browser-e2e-b24 runs); unset or empty ignores nothing`;
const B24_RUN = "run: pnpm exec playwright test ";
/** Does the repository hold this file (through the reader the derivation was given)? */
const holds = (read: RepoReader, path: string): boolean => {
  try {
    read(path);
    return true;
  } catch {
    return false;
  }
};
/** The SIRKIT_E2E_SKIP globs of page-browser-e2e's first browser step ([] with no mapping) and the specs the appended jobs run ([PR-L7, 2026-10-20]
 *  two since OD-254: page-browser-e2e-b24 and page-browser-e2e-agent; the skip list names exactly their specs, none in both). */
function browserSplit(lines: readonly string[], playwrightRun: number, browserEnd: number, read: RepoReader): Readonly<{ skip: readonly string[]; b24: readonly string[]; agent: readonly string[] }> {
  const where = `${DETERMINISTIC}: page-browser-e2e's playwright test step`;
  const env: string[] = [];
  for (let index = playwrightRun + 1; index < browserEnd && /^ {8,}\S/.test(lines[index]!); index += 1) env.push(lines[index]!);
  let skip: string[] = [];
  if (env.length > 0) {
    if (env[0] !== "        env:" || env.length !== 2) fail(`${where} has an env block that is not one SIRKIT_E2E_SKIP entry`);
    const entry = /^ {10}SIRKIT_E2E_SKIP: "([^"]*)"(?: # .*)?$/.exec(env[1]!);
    if (entry === null) fail(`${where} sets something other than one quoted SIRKIT_E2E_SKIP: "${env[1]!.trim()}"`);
    skip = entry![1]!.split(",").map((glob) => glob.trim()).filter(Boolean);
    for (const glob of skip) {
      if (!/^\*\*\/[a-z0-9-]+\.spec\.ts$/.test(glob)) fail(`${where} has a skip glob that is not **/<name>.spec.ts: "${glob}"`);
      if (!holds(read, `e2e/${glob.slice(3)}`)) fail(`${where} has a skip glob that names no spec under e2e/: "${glob}"`);
    }
  }
  const b24 = appendedBrowserSpecs(lines, CI_ADMISSION_ANCHORS.pageBrowserB24, read);
  const agent = appendedBrowserSpecs(lines, CI_ADMISSION_ANCHORS.pageBrowserAgent, read, true); // [PR-L7, 2026-10-20] OD-254; optional: a workflow from before it (b24-f-verdict-lines reads B24's final tree) has none
  const appended = [...b24, ...agent];
  if (new Set(appended).size !== appended.length) fail(`${DETERMINISTIC}: a spec runs in both appended browser jobs: ${appended.filter((spec, index) => appended.indexOf(spec) !== index).join(", ")}`);
  const skipped = skip.map((glob) => `e2e/${glob.slice(3)}`).sort();
  if (JSON.stringify(skipped) !== JSON.stringify([...appended].sort())) fail(`${DETERMINISTIC}: page-browser-e2e skips ${skipped.join(", ") || "nothing"} but page-browser-e2e-b24 runs ${[...b24].sort().join(", ")} and page-browser-e2e-agent runs ${[...agent].sort().join(", ")}: the skip list and the appended jobs disagree`);
  return Object.freeze({ skip: Object.freeze(skip), b24: Object.freeze(b24), agent: Object.freeze(agent) });
}
/** [PR-L7, 2026-10-20] The specs an appended browser job's one `run: pnpm exec playwright test <spec>...` line names (B24-D4's reader, now
 *  shared by page-browser-e2e-b24 and page-browser-e2e-agent): each an `e2e/<name>.spec.ts` that exists; a missing or doubled run line,
 *  no spec or another argument throws CI_ANCHOR; an `optional` job whose key is absent runs nothing (a doubled key still throws). */
function appendedBrowserSpecs(lines: readonly string[], key: string, read: RepoReader, optional = false): readonly string[] {
  const job = key.trim().slice(0, -1);
  if (optional && !lines.includes(key)) return Object.freeze([]);
  const [start, end] = jobBlock(lines, key, DETERMINISTIC);
  const runs = lines.flatMap((line, index) => (index > start && index < end && line.trim().startsWith(B24_RUN) ? [index] : []));
  if (runs.length !== 1) fail(`${DETERMINISTIC}: ${job}'s playwright test line ${runs.length === 0 ? "absent" : "appears twice"}`);
  const specs = lines[runs[0]!]!.trim().slice(B24_RUN.length).split(/\s+/).filter(Boolean);
  if (specs.length === 0) fail(`${DETERMINISTIC}: ${job}'s playwright test line names no spec`);
  for (const spec of specs) if (!/^e2e\/[a-z0-9-]+\.spec\.ts$/.test(spec) || !holds(read, spec)) fail(`${DETERMINISTIC}: ${job} has an argument that is not an e2e spec: "${spec}"`);
  return Object.freeze(specs);
}
