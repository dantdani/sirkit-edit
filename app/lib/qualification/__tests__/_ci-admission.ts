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
 * `agent-boundary-suites` is a sixth anchor and a sixth job id.
 */
import { readFileSync } from "node:fs";
import { join, posix } from "node:path";

export const CI_JOB_IDS = ["prompt-to-gerber", "database-delivery", "benchmark-core", "benchmark-nightly", "page-browser-e2e", "agent-boundary-suites", "benchmark-latency"] as const; // [B24-D0, 2026-10-09] + agent-boundary-suites (OD-30's split); [B24-D1, 2026-10-09] + benchmark-latency (OD-212: the appended benchmark job, its one-line vitest step and its env; no stage10 step)
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
  pageBrowser: "  page-browser-e2e:",
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
  stage10Step: "- run: pnpm run stage10:test -- ",
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
  readonly excludes: Readonly<Record<"prompt-to-gerber" | "database-delivery" | "agent-boundary-suites", readonly string[]>>;
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
  onlyLine(playwright, CI_ADMISSION_ANCHORS.testMatch, PLAYWRIGHT, false);
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
    if (/^e2e\/[^/]+\.spec\.ts$/.test(normal) || /^e2e-orchestration\/[^/]+\.spec\.ts$/.test(normal)) jobs.add("page-browser-e2e");
    return CI_JOB_IDS.filter((job) => jobs.has(job));
  };
  return Object.freeze({
    jobsOf,
    filters: Object.freeze({ "prompt-to-gerber": promptToGerber.filters, "database-delivery": databaseDelivery.filters, "benchmark-core": core, "benchmark-nightly": nightly, "agent-boundary-suites": agentBoundary.filters, "benchmark-latency": latency }), // [B24-D1, 2026-10-09] + benchmark-latency
    excludes: Object.freeze({ "prompt-to-gerber": promptToGerber.excludes, "database-delivery": databaseDelivery.excludes, "agent-boundary-suites": agentBoundary.excludes }), // [B24-D0, 2026-10-09]
    stepEnv,
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
