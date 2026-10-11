/**
 * [B24-D1] D24-28 (runbook :1109), OD-212 - the threshold census: every real-clock bound CI gates, read from the test sources AS
 * THEY ARE with the TypeScript compiler API (the B17-A pattern, app/lib/engineering/control-surface.ts), never a regex over
 * assertions. Six closed kinds:
 *  - `elapsed`: an assertion on measured wall time - an expression or identifier holding a `Date.now()`/`performance.now()`/`hrtime`
 *    difference, a call of a helper that returns one or a timestamp ([B24-D1 review, 2026-10-09]: b20-a1-redaction-linear's
 *    `elapsed`), or the best of pushed timings spread into Math.min/max - compared by toBeLessThan[OrEqual] or
 *    toBeGreaterThan[OrEqual]; one row each, keyed by file + test title path + ordinal (never a line number), the ordinal counted
 *    over elapsed-or-moved sites in document order;
 *  - `moved`: a `void <x>; // [B24-D1, <date>] performance bound moved to b24-d1-latency <metricId> (OD-212)` statement, keyed exactly
 *    as the elapsed row it replaced, so its classification (`movedTo`) never goes stale and the other bounds keep their ordinals;
 *  - `budget`: explicit case and hook timeouts (`{ timeout: N }` or a numeric last argument), one aggregate row per file;
 *  - `yield`: `setImmediate` yields in a test file, one aggregate row per file (against vitest's 60 s onTaskUpdate limit);
 *  - `wait`: `vi.waitFor` and `vi.waitUntil` calls, one aggregate row per file: the count, how many take the 1,000 ms default, the
 *    minimum and maximum explicit timeout;
 *  - `config`: vitest's 5 s default, its 60 s worker-RPC limit, vi.waitFor's 1,000 ms default, Playwright's test and expect
 *    timeouts, and every CI job's `timeout-minutes`.
 * Scope: every file vitest includes (vitest.config.ts: app/**+/__tests__/*.test.ts(x)), each marked with the CI jobs that select it
 * (the positional-substring rule of b19-e-ci-job-scope, net of prompt-to-gerber's `--exclude` lines since B24-D0; benchmark-core is
 * the stage-09 file plus `stage10:test`'s directory, benchmark-nightly adds the stage-08 file and the corpus suite). The two
 * benchmark-latency suites are excluded ([B24-D2, 2026-10-09] three: + b24-d2-memory). `classifyThresholdCensus` joins the rows to the hand classification
 * (threshold-classification.ts): a CI `elapsed` row without a classification fails, so does a classification without a row, a
 * `performance` row left in CI, a moved marker naming an uncatalogued metric, a moved marker with no classification, and a kept row
 * that records nothing it disproves. The walk is async and yields between files; it reads files and never writes.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { LATENCY_METRICS } from "./latency-policy";

export const THRESHOLD_CENSUS_VERSION = "sirkit.threshold-census.v1" as const;
export const THRESHOLD_KINDS = Object.freeze(["elapsed", "moved", "budget", "yield", "wait", "config"] as const);
export type ThresholdKind = (typeof THRESHOLD_KINDS)[number];
export const THRESHOLD_CLASSES = Object.freeze(["deadline-proof", "complexity-proof", "performance"] as const);
export type ThresholdClass = (typeof THRESHOLD_CLASSES)[number];
export const RULE_CLASSES = Object.freeze({ budget: "hang-guard", yield: "rpc-yield", wait: "poll-deadline", config: "harness-default" } as const);
export type RuleClass = (typeof RULE_CLASSES)[keyof typeof RULE_CLASSES];
export const VITEST_DEFAULT_TIMEOUT_MS = 5_000;
export const VITEST_WORKER_RPC_LIMIT_MS = 60_000;
export const VI_WAIT_FOR_DEFAULT_MS = 1_000;
/** In the admission helper's order (B24-B1's CI_JOB_IDS), so a file's job list reads the same in both. */
export const CENSUS_JOBS = Object.freeze(["prompt-to-gerber", "database-delivery", "benchmark-core", "benchmark-nightly", "agent-boundary-suites"] as const);
export type CensusJob = (typeof CENSUS_JOBS)[number];
/** The two suites the benchmark-latency job runs: outside the census by design (their budgets are the job's). */
export const CENSUS_EXCLUDED_FILES = Object.freeze(["app/lib/qualification/__tests__/b24-d1-latency.test.ts", "app/lib/qualification/__tests__/b24-d1-latency-workflow.test.ts", "app/lib/qualification/__tests__/b24-d2-memory.test.ts"]); // [B24-D2, 2026-10-09] + the memory suite, the third benchmark-latency suite (its budgets are the job's too)
const MOVED_PREFIX = ["// [B24-D1, ", "] performance bound moved to b24-d1-latency "].join("<date>");
/** The marker a moved bound carries, assembled so this file's own text never reads as one. */
export const MOVED_MARKER = new RegExp(`^${MOVED_PREFIX.replace("<date>", "(\\d{4}-\\d{2}-\\d{2})").replace(/[[\]]/g, (c) => `\\${c}`)}(\\S+) \\(OD-212\\)$`);

export interface CensusRow {
  readonly kind: ThresholdKind;
  readonly key: string;
  readonly file: string;
  readonly test: string;
  readonly ordinal: number;
  readonly ci: readonly CensusJob[];
  readonly comparator: string | null;
  readonly boundMs: number | null;
  readonly expression: string | null;
  readonly count: number | null;
  readonly min: number | null;
  readonly max: number | null;
  readonly defaults: number | null;
  readonly metricId: string | null;
}

const NEWLINE = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const TEST_CALLEES = new Set(["it", "test", "describe", "suite"]);
const HOOK_CALLEES = new Set(["beforeAll", "beforeEach", "afterAll", "afterEach"]);
const FACTORY_MODIFIERS = new Set(["each", "for", "runIf", "skipIf"]);
const COMPARATORS = new Set(["toBeLessThan", "toBeLessThanOrEqual", "toBeGreaterThan", "toBeGreaterThanOrEqual"]);
const CONVERTERS = new Set(["round", "floor", "ceil", "trunc", "abs", "max", "min"]);

const numberOf = (node: ts.Node): number | null => (ts.isNumericLiteral(node) ? Number(node.text.replace(/_/g, "")) : ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand) ? -Number(node.operand.text.replace(/_/g, "")) : null);
const unwrap = (node: ts.Expression): ts.Expression => {
  let inner = node;
  while (ts.isParenthesizedExpression(inner) || ts.isAsExpression(inner) || ts.isNonNullExpression(inner) || ts.isTypeAssertionExpression(inner)) inner = inner.expression;
  return inner;
};
const titleOf = (node: ts.Expression | undefined, source: ts.SourceFile): string | null => {
  if (!node) return null;
  const inner = unwrap(node);
  if (ts.isStringLiteralLike(inner)) return inner.text;
  if (ts.isTemplateExpression(inner)) return inner.getText(source);
  return null;
};

interface TestCall { readonly base: string; readonly title: string | null; readonly args: readonly ts.Expression[]; readonly kind: "case" | "suite" | "hook" }
/** `it(...)`, `it.skip(...)`, `it.each(table)(...)`, `describe.runIf(cond)(...)`, `beforeAll(...)`: the base callee, the title and the arguments. */
function testCall(node: ts.CallExpression, source: ts.SourceFile): TestCall | null {
  let callee: ts.Expression = unwrap(node.expression);
  if (ts.isCallExpression(callee)) {
    const inner = unwrap(callee.expression);
    if (!ts.isPropertyAccessExpression(inner) || !FACTORY_MODIFIERS.has(inner.name.text)) return null;
    callee = unwrap(inner.expression);
  }
  while (ts.isPropertyAccessExpression(callee)) callee = unwrap(callee.expression);
  if (!ts.isIdentifier(callee)) return null;
  const base = callee.text;
  if (TEST_CALLEES.has(base)) return { base, title: titleOf(node.arguments[0], source), args: node.arguments.slice(1), kind: base === "it" || base === "test" ? "case" : "suite" };
  if (HOOK_CALLEES.has(base)) return { base, title: null, args: [...node.arguments], kind: "hook" };
  return null;
}
/** A call's explicit budgets: `{ timeout: N }` among the arguments, or a trailing numeric argument. */
function budgetsOf(call: TestCall): number[] {
  const found: number[] = [];
  for (const argument of call.args) {
    const inner = unwrap(argument);
    if (ts.isObjectLiteralExpression(inner)) for (const property of inner.properties) {
      if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === "timeout") { const value = numberOf(unwrap(property.initializer)); if (value !== null) found.push(value); }
    }
  }
  const last = call.args[call.args.length - 1];
  if (last) { const value = numberOf(unwrap(last)); if (value !== null) found.push(value); }
  return found;
}

const isNowCallee = (callee: ts.Expression): boolean => {
  const inner = unwrap(callee);
  if (!ts.isPropertyAccessExpression(inner)) return false;
  const object = unwrap(inner.expression);
  if (inner.name.text === "now" && ts.isIdentifier(object) && (object.text === "Date" || object.text === "performance")) return true;
  if (inner.name.text === "bigint" && ts.isPropertyAccessExpression(object) && object.name.text === "hrtime") return true;
  if (inner.name.text === "hrtime" && ts.isIdentifier(object) && object.text === "process") return true;
  return false;
};

/** The declarations and assignments of `name` visible from `from`: every enclosing function body or the file, searched whole. */
function bindingsOf(name: string, from: ts.Node): ts.Expression[] {
  const found: ts.Expression[] = [];
  const collect = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) found.push(node.initializer);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(node.left) && node.left.text === name) found.push(node.right);
    ts.forEachChild(node, collect);
  };
  let scope: ts.Node | undefined = from;
  while (scope) {
    if (ts.isFunctionLike(scope) || ts.isSourceFile(scope)) { collect(scope); if (found.length > 0) return found; }
    scope = scope.parent;
  }
  return found;
}

/** [B24-D1 review, 2026-10-09] The functions `name` is bound to, visible from `from`: an arrow or function expression it is declared or
 *  assigned with, or a function declaration of that name (b20-a1-redaction-linear's `elapsed` helper). */
function functionsOf(name: string, from: ts.Node): ts.FunctionLikeDeclaration[] {
  const found: ts.FunctionLikeDeclaration[] = [];
  for (const bound of bindingsOf(name, from)) { const inner = unwrap(bound); if (ts.isArrowFunction(inner) || ts.isFunctionExpression(inner)) found.push(inner); }
  const collect = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found.push(node);
    ts.forEachChild(node, collect);
  };
  let scope: ts.Node | undefined = from;
  while (scope && found.length === 0) {
    if (ts.isFunctionLike(scope) || ts.isSourceFile(scope)) collect(scope);
    scope = scope.parent;
  }
  return found;
}
/** The expressions a function returns: an arrow's expression body, else every `return <x>` of its own body (nested functions excluded). */
function returnsOf(fn: ts.FunctionLikeDeclaration): ts.Expression[] {
  if (!fn.body) return [];
  if (!ts.isBlock(fn.body)) return [fn.body];
  const out: ts.Expression[] = [];
  const walk = (node: ts.Node): void => {
    if (ts.isReturnStatement(node)) { if (node.expression) out.push(node.expression); return; }
    if (ts.isFunctionLike(node)) return;
    ts.forEachChild(node, walk);
  };
  ts.forEachChild(fn.body, walk);
  return out;
}
/** [B24-D1 review, 2026-10-09] The elements an array named `name` holds, visible from `from`: the elements of the array literals it is
 *  declared or assigned with, and every argument of `name.push(...)` (connectivity-board's `runs`). */
function elementsOf(name: string, from: ts.Node): ts.Expression[] {
  const found: ts.Expression[] = [];
  for (const bound of bindingsOf(name, from)) { const inner = unwrap(bound); if (ts.isArrayLiteralExpression(inner)) found.push(...inner.elements); }
  const collect = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "push" && ts.isIdentifier(unwrap(node.expression.expression)) && (unwrap(node.expression.expression) as ts.Identifier).text === name) found.push(...node.arguments);
    ts.forEachChild(node, collect);
  };
  let scope: ts.Node | undefined = from;
  while (scope) {
    if (ts.isFunctionLike(scope) || ts.isSourceFile(scope)) { collect(scope); if (found.length > 0) return found; }
    scope = scope.parent;
  }
  return found;
}
/** A call of a user helper whose every return path is judged by `judge` (any returned expression satisfying it). */
const callsHelper = (call: ts.CallExpression, judge: (returned: ts.Expression) => boolean): boolean => {
  const callee = unwrap(call.expression);
  return ts.isIdentifier(callee) && callee.text !== "Number" && functionsOf(callee.text, callee).some((fn) => returnsOf(fn).some(judge));
};

function isTimestamp(expression: ts.Expression, depth = 0): boolean {
  const inner = unwrap(expression);
  if (depth > 6) return false;
  if (ts.isCallExpression(inner)) {
    if (isNowCallee(inner.expression)) return true;
    const callee = unwrap(inner.expression);
    if (ts.isIdentifier(callee) && callee.text === "Number") return inner.arguments.length === 1 && isTimestamp(inner.arguments[0]!, depth + 1);
    // [B24-D1 review, 2026-10-09] a helper that returns a timestamp (`const now = () => performance.now()`)
    return callsHelper(inner, (returned) => isTimestamp(returned, depth + 1));
  }
  if (ts.isIdentifier(inner)) return bindingsOf(inner.text, inner).some((bound) => isTimestamp(bound, depth + 1));
  return false;
}
/** A measured wall time: a timestamp difference, an identifier bound to one (declared or assigned), a conversion of one, a helper's
 *  returned difference, or the best of pushed timings spread into Math.min/max. */
export function isElapsedExpression(expression: ts.Expression, depth = 0): boolean {
  const inner = unwrap(expression);
  if (depth > 6) return false;
  if (ts.isBinaryExpression(inner)) {
    const operator = inner.operatorToken.kind;
    if (operator === ts.SyntaxKind.MinusToken) return isTimestamp(inner.left, depth + 1) || isTimestamp(inner.right, depth + 1);
    if (operator === ts.SyntaxKind.SlashToken || operator === ts.SyntaxKind.AsteriskToken) return isElapsedExpression(inner.left, depth + 1);
    return false;
  }
  if (ts.isCallExpression(inner)) {
    const callee = unwrap(inner.expression);
    const converter = (ts.isIdentifier(callee) && callee.text === "Number") || (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(unwrap(callee.expression)) && (unwrap(callee.expression) as ts.Identifier).text === "Math" && CONVERTERS.has(callee.name.text));
    if (converter) return inner.arguments.some((argument) => isElapsedExpression(argument, depth + 1));
    // [B24-D1 review, 2026-10-09] a call of a helper that returns a measured time (b20-a1-redaction-linear's `elapsed(run)`)
    return callsHelper(inner, (returned) => isElapsedExpression(returned, depth + 1));
  }
  // [B24-D1 review, 2026-10-09] `...runs` spread into a converter: the array's declared or pushed elements (connectivity-board's best of n runs)
  if (ts.isSpreadElement(inner)) {
    const spread = unwrap(inner.expression);
    if (ts.isArrayLiteralExpression(spread)) return spread.elements.some((element) => isElapsedExpression(element, depth + 1));
    return ts.isIdentifier(spread) && elementsOf(spread.text, spread).some((element) => isElapsedExpression(element, depth + 1));
  }
  if (ts.isIdentifier(inner)) return bindingsOf(inner.text, inner).some((bound) => isElapsedExpression(bound, depth + 1));
  return false;
}

/** `expect(<x>[, message])[.not].toBeLessThan(...)`: the measured expression and the comparator, or null. */
function elapsedAssertion(node: ts.CallExpression): { measured: ts.Expression; comparator: string; bound: ts.Expression | undefined } | null {
  const callee = unwrap(node.expression);
  if (!ts.isPropertyAccessExpression(callee) || !COMPARATORS.has(callee.name.text)) return null;
  let chain = unwrap(callee.expression);
  while (ts.isPropertyAccessExpression(chain) && (chain.name.text === "not" || chain.name.text === "resolves")) chain = unwrap(chain.expression);
  if (!ts.isCallExpression(chain)) return null;
  const expectCallee = unwrap(chain.expression);
  if (!ts.isIdentifier(expectCallee) || expectCallee.text !== "expect" || chain.arguments.length === 0) return null;
  return { measured: chain.arguments[0]!, comparator: callee.name.text, bound: node.arguments[0] };
}

/** A `void <x>;` statement whose trailing comment is the moved marker: the metric id and the voided expression, or null. */
function movedMarker(statement: ts.ExpressionStatement, text: string, source: ts.SourceFile): { metricId: string; expression: string } | null {
  const inner = unwrap(statement.expression);
  if (!ts.isVoidExpression(inner)) return null;
  for (const range of ts.getTrailingCommentRanges(text, statement.end) ?? []) {
    const comment = text.slice(range.pos, range.end).trim();
    const match = MOVED_MARKER.exec(comment);
    if (match) return { metricId: match[2]!, expression: inner.expression.getText(source) };
  }
  return null;
}

/** The rows of one test source (the CI marking is the caller's). */
export function scanTestSource(file: string, text: string): Omit<CensusRow, "ci">[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const rows: Omit<CensusRow, "ci">[] = [];
  const budgets: number[] = [];
  let yields = 0;
  const waits: Array<number | null> = [];
  const ordinals = new Map<string, number>();
  const titles: string[] = [];
  const nextOrdinal = (test: string): number => { const value = (ordinals.get(test) ?? 0) + 1; ordinals.set(test, value); return value; };
  const empty = { comparator: null, boundMs: null, expression: null, count: null, min: null, max: null, defaults: null, metricId: null };
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === "setImmediate") yields += 1;
    if (ts.isExpressionStatement(node)) {
      const moved = movedMarker(node, text, source);
      if (moved) {
        const test = titles.join(" > ");
        rows.push({ ...empty, kind: "moved", key: `${file}#${test}#${nextOrdinal(test)}`, file, test, ordinal: ordinals.get(test)!, expression: moved.expression, metricId: moved.metricId });
      }
    }
    if (ts.isCallExpression(node)) {
      const call = testCall(node, source);
      if (call) {
        budgets.push(...budgetsOf(call));
        if (call.title !== null) {
          titles.push(call.title);
          ts.forEachChild(node, visit);
          titles.pop();
          return;
        }
      }
      const wait = (() => {
        const callee = unwrap(node.expression);
        if (!ts.isPropertyAccessExpression(callee) || (callee.name.text !== "waitFor" && callee.name.text !== "waitUntil")) return false;
        const object = unwrap(callee.expression);
        return ts.isIdentifier(object) && object.text === "vi";
      })();
      if (wait) {
        const options = node.arguments[1] ? unwrap(node.arguments[1]) : undefined;
        let explicit: number | null = options ? numberOf(options) : null;
        if (options && ts.isObjectLiteralExpression(options)) for (const property of options.properties) if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === "timeout") explicit = numberOf(unwrap(property.initializer));
        waits.push(explicit);
      }
      const assertion = elapsedAssertion(node);
      if (assertion && isElapsedExpression(assertion.measured)) {
        const test = titles.join(" > ");
        const bound = assertion.bound ? numberOf(unwrap(assertion.bound)) : null;
        rows.push({ ...empty, kind: "elapsed", key: `${file}#${test}#${nextOrdinal(test)}`, file, test, ordinal: ordinals.get(test)!, comparator: assertion.comparator, boundMs: bound, expression: bound === null && assertion.bound ? `${assertion.measured.getText(source)} vs ${assertion.bound.getText(source)}` : assertion.measured.getText(source) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (budgets.length > 0) rows.push({ ...empty, kind: "budget", key: file, file, test: "", ordinal: 0, count: budgets.length, min: Math.min(...budgets), max: Math.max(...budgets) });
  if (yields > 0) rows.push({ ...empty, kind: "yield", key: file, file, test: "", ordinal: 0, count: yields });
  if (waits.length > 0) {
    const explicit = waits.filter((value): value is number => value !== null);
    rows.push({ ...empty, kind: "wait", key: file, file, test: "", ordinal: 0, count: waits.length, defaults: waits.length - explicit.length, min: explicit.length ? Math.min(...explicit) : null, max: explicit.length ? Math.max(...explicit) : null });
  }
  return rows;
}

// ── the CI marking: the positional-substring rule net of the exclusions, read off the workflows ──────────────────────────────

export type CensusReader = (path: string) => string;
const DETERMINISTIC = ".github/workflows/deterministic-manufacturing.yml";
const BENCHMARK = ".github/workflows/benchmark.yml";
const STAGE09 = "app/lib/benchmark/__tests__/stage-09-benchmark-core.test.ts";
interface JobSelection { readonly filters: readonly string[]; readonly excludes: readonly string[] }
const jobLines = (lines: readonly string[], job: string): readonly string[] => {
  const start = lines.indexOf(`  ${job}:`);
  if (start < 0) throw new Error(`CENSUS_JOB_ABSENT: ${job}`);
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[index]!)) { end = index; break; }
  return lines.slice(start, end);
};
/** A folded `pnpm exec vitest run` step: the positional tokens, then the `--exclude '<pattern>'` lines, to the `--reporter` line. */
function foldedSelection(lines: readonly string[], job: string): JobSelection {
  const block = jobLines(lines, job);
  const run = block.findIndex((line) => line.trim() === "pnpm exec vitest run");
  if (run < 0) throw new Error(`CENSUS_VITEST_STEP_ABSENT: ${job}`);
  const filters: string[] = [];
  const excludes: string[] = [];
  for (let index = run + 1; index < block.length; index += 1) {
    const line = block[index]!.trim();
    if (line.startsWith("--reporter")) break;
    const exclude = /^--exclude '([^'\s]+)'$/.exec(line);
    if (exclude) excludes.push(exclude[1]!);
    else if (!line.startsWith("--")) filters.push(...line.split(/\s+/).filter(Boolean));
  }
  return { filters, excludes };
}
/** A one-line `- run: pnpm exec vitest run <files> --...` step inside a job: its files. */
function inlineSelection(lines: readonly string[], job: string): readonly string[] {
  const block = jobLines(lines, job);
  const run = block.find((line) => line.trim().startsWith("- run: pnpm exec vitest run "));
  if (!run) throw new Error(`CENSUS_VITEST_STEP_ABSENT: ${job}`);
  const tokens = run.trim().slice("- run: pnpm exec vitest run ".length).split(/\s+/);
  const flag = tokens.findIndex((token) => token.startsWith("--"));
  return tokens.slice(0, flag < 0 ? tokens.length : flag);
}
const excludedBy = (pattern: string, path: string): boolean => (pattern.endsWith("/**") ? path.startsWith(pattern.slice(0, -2)) : path === pattern);

/** The jobs selecting each test file, derived from the workflows and package.json's `stage10:test`. */
export function censusJobs(read: CensusReader): (path: string) => CensusJob[] {
  const deterministic = read(DETERMINISTIC).replaceAll(`${CR}${NEWLINE}`, NEWLINE).split(NEWLINE);
  const benchmark = read(BENCHMARK).replaceAll(`${CR}${NEWLINE}`, NEWLINE).split(NEWLINE);
  const stage10 = /"stage10:test": "vitest run ([^"]+)"/.exec(read("package.json"));
  if (!stage10) throw new Error("CENSUS_STAGE10_SCRIPT_ABSENT");
  const stage10Filters = stage10[1]!.split(/\s+/).filter(Boolean);
  const folded: Record<"prompt-to-gerber" | "database-delivery" | "agent-boundary-suites", JobSelection> = { "prompt-to-gerber": foldedSelection(deterministic, "prompt-to-gerber"), "database-delivery": foldedSelection(deterministic, "database-delivery"), "agent-boundary-suites": foldedSelection(deterministic, "agent-boundary-suites") };
  const core = [...inlineSelection(benchmark, "benchmark-core"), ...stage10Filters];
  const nightly = [...inlineSelection(benchmark, "benchmark-nightly"), ...stage10Filters];
  if (!core.includes(STAGE09)) throw new Error("CENSUS_BENCHMARK_CORE_SHAPE");
  const runs = (selection: JobSelection, path: string): boolean => selection.filters.some((filter) => path.includes(filter)) && !selection.excludes.some((pattern) => excludedBy(pattern, path));
  return (path) => {
    const selected = new Set<CensusJob>();
    if (runs(folded["prompt-to-gerber"], path)) selected.add("prompt-to-gerber");
    if (runs(folded["database-delivery"], path)) selected.add("database-delivery");
    if (runs(folded["agent-boundary-suites"], path)) selected.add("agent-boundary-suites");
    if (core.some((filter) => path.includes(filter))) selected.add("benchmark-core");
    if (nightly.some((filter) => path.includes(filter))) selected.add("benchmark-nightly");
    return CENSUS_JOBS.filter((job) => selected.has(job));
  };
}

/** The config rows: the harness defaults, Playwright's two timeouts and every job's `timeout-minutes`. */
export function configRows(read: CensusReader): CensusRow[] {
  const empty = { file: "", test: "", ordinal: 0, ci: [] as CensusJob[], comparator: null, expression: null, count: null, min: null, max: null, defaults: null, metricId: null };
  const row = (key: string, boundMs: number): CensusRow => ({ ...empty, kind: "config", key, boundMs });
  const vitestConfig = read("vitest.config.ts");
  if (/testTimeout/.test(vitestConfig)) throw new Error("CENSUS_VITEST_TIMEOUT_SET: vitest.config.ts sets testTimeout; the 5 s default row is stale");
  const playwright = read("playwright.config.ts");
  const testTimeout = /^\s*timeout: ([\d_]+),/m.exec(playwright);
  const expectTimeout = /expect: \{ timeout: ([\d_]+) \}/.exec(playwright);
  if (!testTimeout || !expectTimeout) throw new Error("CENSUS_PLAYWRIGHT_TIMEOUTS_ABSENT");
  const rows = [row("vitest.testTimeout.default", VITEST_DEFAULT_TIMEOUT_MS), row("vitest.worker-rpc.onTaskUpdate", VITEST_WORKER_RPC_LIMIT_MS), row("vi.waitFor.timeout.default", VI_WAIT_FOR_DEFAULT_MS), row("playwright.timeout", Number(testTimeout[1]!.replace(/_/g, ""))), row("playwright.expect.timeout", Number(expectTimeout[1]!.replace(/_/g, "")))];
  for (const workflow of [DETERMINISTIC, BENCHMARK]) {
    const lines = read(workflow).replaceAll(`${CR}${NEWLINE}`, NEWLINE).split(NEWLINE);
    let job: string | null = null;
    for (const line of lines) {
      const key = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
      if (key && key[1] !== "jobs") job = key[1]!;
      const limit = /^ {4}timeout-minutes: (\d+)\s*$/.exec(line);
      if (limit && job) rows.push(row(`ci.${job}.timeout-minutes`, Number(limit[1]) * 60_000));
    }
  }
  return rows;
}

/** Every file vitest includes, repository-relative with forward slashes, sorted. */
export function vitestTestFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(join(root, dir))) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const path = `${dir}/${entry}`;
      if (statSync(join(root, path)).isDirectory()) walk(path);
      else if (/\.test\.tsx?$/.test(entry) && path.includes("/__tests__/")) out.push(path);
    }
  };
  walk("app");
  return out.sort();
}

export interface CensusScan { readonly rows: CensusRow[]; readonly files: number }
/** The whole census: the test files (minus the benchmark-latency suites), each marked with its CI jobs, plus the config rows. The
 *  walk yields to the event loop between files (vitest's 60 s onTaskUpdate limit). */
export async function scanThresholdCensus(options: { root?: string; read?: CensusReader; files?: readonly string[] } = {}): Promise<CensusScan> {
  const root = options.root ?? process.cwd();
  const read: CensusReader = options.read ?? ((path) => readFileSync(join(root, path), "utf8"));
  const jobsOf = censusJobs(read);
  const files = (options.files ?? vitestTestFiles(root)).filter((file) => !CENSUS_EXCLUDED_FILES.includes(file));
  const rows: CensusRow[] = [];
  for (const file of files) {
    const ci = jobsOf(file);
    for (const row of scanTestSource(file, read(file).replaceAll(`${CR}${NEWLINE}`, NEWLINE))) rows.push({ ...row, ci });
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  rows.push(...configRows(read));
  return { rows: sortRows(rows), files: files.length };
}

const KIND_ORDER: Readonly<Record<ThresholdKind, number>> = { elapsed: 0, moved: 1, budget: 2, yield: 3, wait: 4, config: 5 };
export const sortRows = <T extends { kind: ThresholdKind; key: string }>(rows: readonly T[]): T[] => [...rows].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

// ── the classification join ──────────────────────────────────────────────────────────────────────────────────────────────────

export interface ThresholdClassification {
  /** an elapsed or moved row's key */
  readonly key: string;
  readonly class: ThresholdClass;
  /** one line */
  readonly reason: string;
  /** kept rows (deadline-proof, complexity-proof): the bound and the value it disproves */
  readonly disproves?: string;
  /** moved rows: the catalogued metric the workload became */
  readonly movedTo?: string;
}

export interface ClassifiedRow extends CensusRow {
  readonly class: ThresholdClass | RuleClass | null;
  readonly reason: string;
  readonly disproves: string;
  readonly movedTo: string;
}

const RULE_REASONS: Readonly<Record<Exclude<ThresholdKind, "elapsed" | "moved">, string>> = {
  budget: "an explicit case or hook budget: a hang guard sized to the case, never a performance claim (lead lesson 14)",
  yield: "a setImmediate yield between walks, against vitest's 60 s onTaskUpdate limit (EXECUTION_LEDGER 9cb675d)",
  wait: "a vi.waitFor/vi.waitUntil poll deadline: a bounded wait for a fake that completes at once, never a measurement",
  config: "a harness default or a CI job limit",
};

export function classifyThresholdCensus(rows: readonly CensusRow[], classifications: readonly ThresholdClassification[]): { rows: ClassifiedRow[]; problems: string[] } {
  const problems: string[] = [];
  const byKey = new Map<string, ThresholdClassification>();
  for (const entry of classifications) {
    if (byKey.has(entry.key)) problems.push(`DOUBLED_CLASSIFICATION:${entry.key}`);
    byKey.set(entry.key, entry);
    if (!THRESHOLD_CLASSES.includes(entry.class)) problems.push(`CLASS_UNKNOWN:${entry.key}:${String(entry.class)}`);
    if (!entry.reason.trim()) problems.push(`REASON_MISSING:${entry.key}`);
  }
  const metricIds = new Set(LATENCY_METRICS.map((entry) => entry.metricId));
  const keyed = new Set(rows.filter((row) => row.kind === "elapsed" || row.kind === "moved").map((row) => row.key));
  for (const entry of classifications) if (!keyed.has(entry.key)) problems.push(`STALE:${entry.key}`);
  const classified = rows.map((row): ClassifiedRow => {
    if (row.kind === "elapsed") {
      const entry = byKey.get(row.key);
      const inCi = row.ci.length > 0;
      if (inCi && !entry) problems.push(`UNCLASSIFIED:${row.key}`);
      if (entry && entry.class === "performance" && inCi) problems.push(`PERFORMANCE_IN_CI:${row.key}`);
      if (entry && entry.class !== "performance" && !entry.disproves?.trim()) problems.push(`DISPROVES_MISSING:${row.key}`);
      if (entry && entry.movedTo) problems.push(`ELAPSED_WITH_MOVED_TO:${row.key}`);
      return { ...row, class: entry?.class ?? null, reason: entry?.reason ?? "", disproves: entry?.disproves ?? "", movedTo: "" };
    }
    if (row.kind === "moved") {
      const entry = byKey.get(row.key);
      if (!row.metricId || !metricIds.has(row.metricId)) problems.push(`MOVED_TO_UNKNOWN_METRIC:${row.key}:${row.metricId ?? ""}`);
      if (!entry) problems.push(`MOVED_UNCLASSIFIED:${row.key}`);
      else {
        if (entry.class !== "performance") problems.push(`MOVED_NOT_PERFORMANCE:${row.key}`);
        if (entry.movedTo !== row.metricId) problems.push(`MOVED_TO_MISMATCH:${row.key}:${entry.movedTo ?? ""}!=${row.metricId ?? ""}`);
      }
      return { ...row, class: entry?.class ?? null, reason: entry?.reason ?? "", disproves: "", movedTo: row.metricId ?? "" };
    }
    return { ...row, class: RULE_CLASSES[row.kind], reason: RULE_REASONS[row.kind], disproves: "", movedTo: "" };
  });
  return { rows: classified, problems: [...new Set(problems)].sort() };
}

// ── the CSV ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const CENSUS_CSV_HEADER = "kind,key,file,test,ordinal,ci,class,reason,disproves,movedTo,comparator,boundMs,expression,count,min,max,defaults";
const cell = (value: string | number | null): string => {
  const textValue = value === null ? "" : String(value);
  return /[",\r\n]/.test(textValue) ? `"${textValue.replaceAll('"', '""')}"` : textValue;
};
/** Byte-stable: the header, one row per classified row in census order, LF, a final newline; no line number anywhere. */
export function renderThresholdCensusCsv(rows: readonly ClassifiedRow[]): string {
  const lines = [CENSUS_CSV_HEADER, ...sortRows(rows).map((row) => [row.kind, row.key, row.file, row.test, row.ordinal, row.ci.join("+") || "none", row.class ?? "", row.reason, row.disproves, row.movedTo, row.comparator, row.boundMs, row.expression, row.count, row.min, row.max, row.defaults].map(cell).join(","))];
  return `${lines.join(NEWLINE)}${NEWLINE}`;
}

/** The census by kind and, for elapsed rows, by class and CI (the page's counts). */
export function censusCounts(rows: readonly ClassifiedRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  const add = (key: string): void => { counts[key] = (counts[key] ?? 0) + 1; };
  for (const row of rows) {
    add(row.kind);
    if (row.kind === "elapsed" || row.kind === "moved") { add(`${row.kind}:${row.ci.length ? "ci" : "none"}`); if (row.class) add(`${row.kind}:${row.ci.length ? "ci" : "none"}:${row.class}`); }
  }
  return counts;
}
