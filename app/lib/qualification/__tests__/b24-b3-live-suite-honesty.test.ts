/**
 * [B24-B3] Opt-in live suites that cannot pass without their resource (D24-19, OD-209; D24-18's `assist-live` half), through the
 * registry `app/lib/evaluation/live-suites.ts` (`LIVE_SUITES`, and `NON_LIVE_GATES` for an opt-in whose flag arms a scheduled or
 * otherwise non-live run, lead decision D2):
 *
 *  1. the census: every line-start `describe|it|test` `.runIf(`/`.skipIf(` gate under app, lib, components, e2e, e2e-orchestration and
 *     scripts is exactly one of four closed kinds - a registered live suite's, a database-qualification gate (its condition derives from
 *     `databaseQualification()`, or it sits inside such a block), the protected-original check, or a registered non-live gate; 17 gates
 *     in 15 files at f663d71 (three kinds), 18 in 16 at 4738aa3 (B24-B2's corpus gate), 19 in 16 after B24-B3 (the canary's
 *     `it.runIf` inside the live-auth block);
 *  2. every registered suite runs on its flag alone, registers the resource gate once in each gated block (an entry with no resources
 *     needs none), has no resource-guarded early `return`, and is selected by a CI job that leaves a live flag unset;
 *  3. the truth table of `liveSuiteState` and `assertLiveResources` for every entry of both registries, names only, never a value;
 *  4. each linked live entry's class and blockers equal B1's catalog row, the unlinked two state theirs, and every LB id is a register row;
 *  5. the two vacuous returns are gone and the oracle exports the routed demo behind a positive control;
 *  6. `assist-live`, offline: its request reaches `generate` once with `provider: "anthropic"` (today's request is refused 400
 *     `AUTH_PROJECT_SELECTOR_REQUIRED` with zero `generate` calls);
 *  7. the oracle's positive control, offline: the routed demo has a DRC error and the empty board has none;
 *  8. `recorded` is `exercised` only with a record that resolves;
 *  9. scenario-map.md section 3 equals both registries row for row, names only;
 * 10. `NON_LIVE_GATES` holds exactly B24-B2's corpus gate: its kind is closed, it carries no class and no LB, and only the job it names
 *     sets its flag, to exactly "1", in the step that selects it.
 *
 * Failing first on 4738aa3: the registry, the request builder and the page do not exist (scenario-map.md section 5). Nothing is
 * written to disk, no process is started and no network is reached: the model router is a mock and every environment is a literal.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/llm/router", () => ({ llmRouter: { generate: vi.fn() } }));

import { POST as assistPost } from "@/app/api/pcb/edit/assist/route";
import { injectAuthorizedPrincipal, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { EVAL_CLASS_IDS, GOLDEN_EVAL_CATALOG, liveBlockerIdsOf } from "@/app/lib/evaluation/golden-catalog";
import {
  LIVE_SUITES,
  NON_LIVE_GATE_KINDS,
  NON_LIVE_GATES,
  assertLiveResources,
  liveSuiteState,
  resourceLabels,
  type LiveResource,
  type NonLiveGateEntry,
  type LiveSuiteEntry,
} from "@/app/lib/evaluation/live-suites";
import { llmRouter } from "@/app/lib/llm/router";
import { buildRoutedDemo } from "@/app/lib/pcb/demo/routed-demo";
import { runDrc } from "@/app/lib/pcb/drc/run-drc";
import { getPreset } from "@/app/lib/pcb/drc/presets";
import { ensureBoardPadstacks } from "@/app/lib/pcb/padstack/migrate";
import { createEmptyBoard } from "@/app/lib/pcb/types";
import { ASSIST_LIVE_PRINCIPAL, assistLiveRequest } from "@/app/api/pcb/edit/__tests__/_assist-live-request";
import { ciAdmission, readRepoText } from "./_ci-admission";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const read = readRepoText;
const lines = (path: string): string[] => read(path).split(NEWLINE);
const PAGE = "artifacts/ai-control-plane-b24/scenario-map.md";
const REGISTER = "artifacts/remaining-builder-program/LIVE_BLOCKERS.md";
const DETERMINISTIC = ".github/workflows/deterministic-manufacturing.yml";
const BENCHMARK = ".github/workflows/benchmark.yml";
const PROTECTED_ORIGINAL_FILE = "app/api/__tests__/b16-1c-invariant-tripwires.test.ts";
const generate = vi.mocked(llmRouter.generate);
type Entry = LiveSuiteEntry | NonLiveGateEntry;
const ENTRIES: readonly Entry[] = [...LIVE_SUITES, ...NON_LIVE_GATES];
const yieldToLoop = (): Promise<void> => new Promise((done) => setImmediate(done));

// ── gate syntax, assembled at run time so this file's own lines never read as a gate ────────────────────────────────────────────

const GATE = new RegExp(["^(\\s*)(?:const\\s+\\w+\\s*=\\s*)?(?:describe|it|test)\\.", "(?:runIf|skipIf)", "\\("].join(""));
const RESOURCE_GATE = (id: string): string => ["beforeAll(() => assert", `LiveResources("${id}"))`].join("");
const SOURCE_FILE = /\.(?:tsx?|mts|mjs|cjs|js)$/;
const SCAN_ROOTS = ["app", "lib", "components", "e2e", "e2e-orchestration", "scripts"] as const;

interface Gate { readonly file: string; readonly line: number; readonly text: string; readonly indented: boolean; readonly method: "runIf" | "skipIf"; readonly condition: string }
type GateKind = "live" | "database" | "protected-original" | "non-live";

/** The text inside the parentheses that open at `open` (the index of a "("), or null when they never close. */
function balanced(text: string, open: number): string | null {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    const character = text[index]!;
    if (character === "(") depth += 1;
    else if (character === ")") {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, index);
    }
  }
  return null;
}
function gatesOf(file: string, source: string): Gate[] {
  return source.split(NEWLINE).flatMap((text, index) => {
    const match = GATE.exec(text);
    if (!match) return [];
    const method = text.includes(".runIf(") ? "runIf" : "skipIf";
    const condition = balanced(text, text.indexOf(`.${method}(`) + method.length + 1) ?? "";
    return [{ file, line: index + 1, text, indented: match[1]!.length > 0, method, condition }];
  });
}
async function walk(dir: string, out: Array<readonly [string, string]>): Promise<void> {
  let entries: string[];
  try {
    entries = readdirSync(join(ROOT, dir));
  } catch {
    return;
  }
  for (const name of entries) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const path = `${dir}/${name}`;
    if (statSync(join(ROOT, path)).isDirectory()) { await walk(path, out); continue; }
    if (SOURCE_FILE.test(name)) out.push([path, read(path)]);
    if (out.length % 200 === 0) await yieldToLoop();
  }
}

/** A const's initializer in `source` (the first `const NAME = ...;`), or null. */
function declaration(source: string, name: string): string | null {
  const match = new RegExp(`(?:^|\\n)[ \\t]*const\\s+${name}\\s*=\\s*([\\s\\S]*?);[ \\t]*(?://[^\\n]*)?(?:\\n|$)`).exec(source);
  return match ? match[1]!.trim() : null;
}
/** The condition with every const it names replaced by its initializer (four levels at most). */
function resolveCondition(source: string, condition: string): string {
  let resolved = condition;
  for (let depth = 0; depth < 4; depth += 1) {
    const next = resolved.replace(/(?<![.\w$"'`])([A-Za-z_$][\w$]*)(?![\w$])/g, (name) => {
      if (["process", "env", "Boolean", "typeof", "true", "false", "null", "undefined"].includes(name)) return name;
      const value = declaration(source, name);
      return value === null ? name : `(${value})`;
    });
    if (next === resolved) break;
    resolved = next;
  }
  return resolved;
}
const compact = (text: string): string => text.replace(/\s+/g, "").replace(/^\((.*)\)$/, "$1");
const envNamesIn = (text: string): string[] => [...new Set([...text.matchAll(/process\.env(?:\.([A-Z_][A-Z0-9_]*)|\[["']([A-Z_][A-Z0-9_]*)["']\])/g)].map((match) => match[1] ?? match[2]!))];
const resourceNames = (resources: readonly LiveResource[]): string[] => resources.flatMap((resource) => (resource.check === "oneOf" ? [...resource.names] : resource.check === "hostPlatform" ? [] : [resource.name]));

/** Is a top-level gate's condition its entry's flag alone, in one of the accepted spellings? */
function onFlagAlone(gate: Gate, source: string, entry: Entry): boolean {
  const resolved = compact(resolveCondition(source, gate.condition));
  const flag = `process.env.${entry.flag.name}`;
  const accepted = entry.flag.kind === "exact-1"
    ? (gate.method === "runIf" ? [`${flag}==="1"`, `(${flag}==="1")`] : [`${flag}!=="1"`, `!(${flag}==="1")`, `!((${flag}==="1"))`])
    : (gate.method === "runIf" ? [`Boolean(${flag})`, `Boolean((${flag}))`] : [`!${flag}`, `!(${flag})`]);
  return accepted.includes(resolved);
}

/** Each column-0 gated block of a file: from its gate line to the first column-0 `});` after it. */
function gatedBlocks(source: string): Array<{ start: number; end: number; text: string }> {
  const all = source.split(NEWLINE);
  return gatesOf("", source).filter((gate) => !gate.indented).map((gate) => {
    let end = all.length;
    for (let index = gate.line; index < all.length; index += 1) if (all[index] === "});") { end = index + 1; break; }
    return { start: gate.line, end, text: all.slice(gate.line - 1, end).join(NEWLINE) };
  });
}
/** The enclosing column-0 gate of an indented one (no column-0 `});` between them), or null. */
function enclosing(gates: readonly Gate[], source: string, gate: Gate): Gate | null {
  const all = source.split(NEWLINE);
  const before = gates.filter((candidate) => candidate.file === gate.file && !candidate.indented && candidate.line < gate.line).at(-1);
  if (!before) return null;
  for (let index = before.line; index < gate.line - 1; index += 1) if (all[index] === "});") return null;
  return before;
}

/** The census's kind of one gate, or null (unclassified). */
function kindOf(gate: Gate, gates: readonly Gate[], sources: ReadonlyMap<string, string>): GateKind | null {
  if (LIVE_SUITES.some((entry) => entry.path === gate.file)) return "live";
  if (NON_LIVE_GATES.some((entry) => entry.path === gate.file)) return "non-live";
  if (gate.file === PROTECTED_ORIGINAL_FILE && gate.method === "skipIf" && compact(gate.condition) === "!existsSync(PROTECTED_ORIGINAL)") return "protected-original";
  const source = sources.get(gate.file) ?? "";
  if (/\bdatabaseQualification\(/.test(resolveCondition(source, gate.condition))) return "database";
  if (gate.indented) {
    const outer = enclosing(gates, source, gate);
    if (outer && /\bdatabaseQualification\(/.test(resolveCondition(source, outer.condition))) return "database";
  }
  return null;
}

/** Early returns guarded by a resource: an `if` whose condition names a resource (or a const read from one) and that returns. */
function resourceGuardedReturns(source: string, entry: Entry): string[] {
  const names = [...resourceNames(entry.resources), ...resourceNames("optional" in entry ? entry.optional : [])];
  const guards = new Set<string>(names);
  // [B24-B3 review] correctness-8: every const is resolved through the consts it names first, so one derived from a resource with no
  // `process.env` of its own (b16-1b's folded `LIVE`, its marker test `ISOLATED`) guards a resource too
  for (const match of source.matchAll(/(?:^|\n)[ \t]*const\s+([A-Za-z_$][\w$]*)\s*=\s*([^;]*);/g)) {
    const resolved = resolveCondition(source, match[2]!);
    // a const read from a resource name, or from the whole environment (an admission over `process.env`), guards a resource
    if (envNamesIn(resolved).some((name) => name !== entry.flag.name) || /process\.env(?![.[\w])/.test(resolved)) guards.add(match[1]!);
  }
  const found: string[] = [];
  for (let at = source.indexOf("if ("); at >= 0; at = source.indexOf("if (", at + 1)) {
    const condition = balanced(source, at + 3);
    if (condition === null) continue;
    if (![...guards].some((guard) => new RegExp(`(?<![\\w$])${guard}(?![\\w$])`).test(condition))) continue;
    const after = source.slice(at + 3 + condition.length + 2).trimStart();
    let body = after.split(NEWLINE)[0]!;
    if (after.startsWith("{")) {
      let depth = 0;
      for (let index = 0; index < after.length; index += 1) {
        if (after[index] === "{") depth += 1;
        else if (after[index] === "}") { depth -= 1; if (depth === 0) { body = after.slice(0, index + 1); break; } }
      }
    }
    if (/\breturn\b/.test(body)) found.push(`${entry.id}: if (${condition.trim()}) returns`);
  }
  return found;
}

const census: { gates: Gate[]; sources: Map<string, string> } = { gates: [], sources: new Map() };
beforeAll(async () => {
  const files: Array<readonly [string, string]> = [];
  for (const root of SCAN_ROOTS) await walk(root, files);
  census.sources = new Map(files);
  census.gates = files.flatMap(([file, source]) => gatesOf(file, source));
}, 120_000);

afterEach(() => {
  resetInjectedIdentity();
  generate.mockReset();
});

// ── fixtures: fake values assembled at run time, a fake host and a fake file system ───────────────────────────────────────────

const fakeValue = (name: string): string => (name === "SIRKIT_AUTH_QUALIFICATION_PROJECT" ? ["sirkit-auth-qualification", "b3", "fake"].join("-") : ["fake", name.toLowerCase().replaceAll("_", "-"), "b3"].join("-"));
const fakePath = (name: string): string => resolve(tmpdir(), `sirkit-b24-b3-fake-${name.toLowerCase()}`);
/** An environment holding the flag set and every resource (and optional resource) present, with the paths it names. */
function fullEnvironment(entry: Entry): { env: Record<string, string>; paths: Set<string>; platform: string } {
  const env: Record<string, string> = { [entry.flag.name]: entry.flag.kind === "exact-1" ? "1" : fakePath(entry.flag.name) };
  const paths = new Set<string>();
  let platform = "linux-x64";
  for (const resource of [...entry.resources, ...("optional" in entry ? entry.optional : [])]) {
    if (resource.check === "oneOf") env[resource.names[0]!] = fakeValue(resource.names[0]!);
    else if (resource.check === "hostPlatform") platform = resource.platform;
    else if (resource.check === "absolutePathExists") { env[resource.name] = env[resource.name] ?? fakePath(resource.name); paths.add(env[resource.name]!); }
    else env[resource.name] = fakeValue(resource.name);
  }
  return { env, paths, platform };
}

describe("[B24-B3] the opt-in live suites' census and their registry (D24-19, OD-209)", () => {
  it("1. the census: every line-start runIf/skipIf gate is one of four closed kinds - a registered live suite's, a database-qualification gate, the protected-original check, a registered non-live gate - 19 gates in 16 files after B24-B3 (17 in 15 at f663d71, 18 in 16 at 4738aa3); an unregistered gate is unclassified", { timeout: 60_000 }, () => {
    const gates = census.gates;
    expect(census.sources.size).toBeGreaterThan(1500);
    const unclassified = gates.filter((gate) => kindOf(gate, gates, census.sources) === null).map((gate) => `${gate.file}:${gate.line} ${gate.text.trim().slice(0, 80)}`);
    expect(unclassified).toEqual([]);
    const byKind = (kind: GateKind): Gate[] => gates.filter((gate) => kindOf(gate, gates, census.sources) === kind);
    const count = (kind: GateKind): [number, number] => [byKind(kind).length, new Set(byKind(kind).map((gate) => gate.file)).size];
    expect({ live: count("live"), database: count("database"), protectedOriginal: count("protected-original"), nonLive: count("non-live") }).toEqual({ live: [9, 7], database: [8, 7], protectedOriginal: [1, 1], nonLive: [4, 4] }); // [B24-D1, 2026-10-09] reviewed pin move: nonLive 1 -> 3, the two latency benchmark gates (b24-d1-latency, b24-d1-latency-workflow; lead decision D2, OD-212); [B24-D2, 2026-10-09] reviewed pin move: nonLive 3 -> 4, the memory gate (b24-d2-memory; lead decision D2)
    expect([gates.length, new Set(gates.map((gate) => gate.file)).size]).toEqual([22, 19]); // [B24-D1, 2026-10-09] reviewed pin move: 19 in 16 -> 21 in 18; [B24-D2, 2026-10-09] reviewed pin move: 21 in 18 -> 22 in 19 (b24-d2-memory, kind non-live)
    // every registered entry's file holds at least one gate, and the database kind includes the second-database case inside its block
    for (const entry of ENTRIES) expect(gates.some((gate) => gate.file === entry.path), entry.id).toBe(true);
    expect(byKind("database").map((gate) => gate.file)).toEqual(expect.arrayContaining(["app/lib/db/__tests__/b16-b-postgres-qualification.test.ts", "app/lib/durable-workflow/__tests__/tenant-scope.test.ts", "app/lib/physical-binding/__tests__/schema-integrity.test.ts"]));
    // the census bites: a gate in an unregistered file on anything but databaseQualification() is unclassified
    const synthetic = gatesOf("app/lib/x/__tests__/unregistered.test.ts", ["describe.", "runIf(process.env.SOME_LIVE_FLAG === \"1\")(\"x\", () => {"].join(""));
    expect(synthetic).toHaveLength(1);
    expect(kindOf(synthetic[0]!, synthetic, new Map([["app/lib/x/__tests__/unregistered.test.ts", ""]]))).toBeNull();
  });

  it("2. every registered suite runs on its flag alone (an inner gate only on an optional sub-resource), registers the resource gate once in each gated block, has no resource-guarded early return, and is selected by a CI job that leaves a live flag unset", { timeout: 60_000 }, () => {
    const admission = ciAdmission();
    const deterministic = read(DETERMINISTIC);
    const problems: string[] = [];
    for (const entry of ENTRIES) {
      const source = read(entry.path);
      const own = gatesOf(entry.path, source);
      for (const gate of own.filter((candidate) => !candidate.indented)) if (!onFlagAlone(gate, source, entry)) problems.push(`${entry.id}:${gate.line} not on ${entry.flag.name} alone: ${gate.condition}`);
      const optional = resourceNames("optional" in entry ? entry.optional : []);
      for (const gate of own.filter((candidate) => candidate.indented)) {
        const names = envNamesIn(resolveCondition(source, gate.condition));
        if (names.length === 0 || names.some((name) => !optional.includes(name))) problems.push(`${entry.id}:${gate.line} an inner gate on ${names.join(", ") || "nothing"}, not an optional sub-resource`);
      }
      const blocks = gatedBlocks(source);
      if (blocks.length === 0) problems.push(`${entry.id}: no gated block`);
      const expected = entry.resources.length > 0 ? 1 : 0;
      for (const block of blocks) {
        const registered = block.text.split(RESOURCE_GATE(entry.id)).length - 1;
        if (registered !== expected) problems.push(`${entry.id}:${block.start} registers the resource gate ${registered} times (expected ${expected})`);
      }
      if (source.split(RESOURCE_GATE(entry.id)).length - 1 !== expected * blocks.length) problems.push(`${entry.id}: a resource gate outside its gated blocks`);
      problems.push(...resourceGuardedReturns(source, entry));
      const jobs = admission.jobsOf(entry.path);
      if (jobs.length === 0) problems.push(`${entry.id}: no CI job selects it`);
      if ("evaluationClass" in entry) {
        if (deterministic.includes(entry.flag.name) || Object.values(admission.stepEnv).some((env) => Object.hasOwn(env, entry.flag.name))) problems.push(`${entry.id}: a CI step names its live flag ${entry.flag.name}`);
      }
    }
    expect(problems).toEqual([]);
    // the rule bites on the defects it closes (in-memory sources, never a file): a flag folded with a resource, a resource-guarded return
    const assist = LIVE_SUITES.find((entry) => entry.id === "assist-live")!;
    const folded = ["const hasKey = typeof process.env.ANTHROPIC_API_KEY === \"string\" && process.env.PCB_ASSIST_LIVE === \"1\";", ["describe.", "skipIf(!hasKey)(\"x\", () => {"].join("")].join(NEWLINE);
    expect(onFlagAlone(gatesOf(assist.path, folded)[0]!, folded, assist)).toBe(false);
    const contract = LIVE_SUITES.find((entry) => entry.id === "b19-e-live-contract")!;
    const vacuous = ["const admission = admitSource(id, process.env);", "if (!admission.admitted) {", "  expect(1).toBe(1);", "  return;", "}"].join(NEWLINE);
    expect(resourceGuardedReturns(vacuous, contract)).toHaveLength(1);
    expect(resourceGuardedReturns(vacuous.replace("return;", "throw new Error(\"x\");"), contract)).toEqual([]);
    // [B24-B3 review] correctness-8: a const derived from a resource through other consts, with no `process.env` of its own (b16-1b's
    // folded `LIVE` and its marker test `ISOLATED`), guards a resource too; the flag's own const does not
    const auth = LIVE_SUITES.find((entry) => entry.id === "b16-1b-live-qualification")!;
    const folded16 = [
      "const FLAG = process.env.SIRKIT_LIVE_AUTH_QUALIFICATION === \"1\";",
      "const MARKER = process.env.SIRKIT_AUTH_QUALIFICATION_PROJECT ?? \"\";",
      "const BASE = process.env.SIRKIT_AUTH_QUALIFICATION_BASE_URL ?? \"\";",
      "const ISOLATED = /^sirkit-auth-qualification-[a-z0-9-]+$/i.test(MARKER);",
      "const LIVE = FLAG && ISOLATED && BASE.length > 0;",
    ].join(NEWLINE);
    expect(resourceGuardedReturns([folded16, "if (!LIVE) return;"].join(NEWLINE), auth)).toHaveLength(1);
    expect(resourceGuardedReturns([folded16, "if (!ISOLATED) return;"].join(NEWLINE), auth)).toHaveLength(1);
    expect(resourceGuardedReturns([folded16, "if (!FLAG) return;"].join(NEWLINE), auth)).toEqual([]);
  });

  it("3. the truth table of liveSuiteState and assertLiveResources, per entry of both registries: the flag unset; the flag set with each resource removed in turn; everything present - and every message carries names only, never a value", () => {
    for (const entry of ENTRIES) {
      const { env, paths, platform } = fullEnvironment(entry);
      const exists = (path: string): boolean => paths.has(path);
      expect(liveSuiteState(entry, {}, exists, platform), `${entry.id} unset`).toEqual({ state: "not_exercised", reason: "flag_unset" });
      const flagOff = { ...env, [entry.flag.name]: entry.flag.kind === "exact-1" ? "true" : "" };
      expect(liveSuiteState(entry, flagOff, exists, platform), `${entry.id} flag not exactly set`).toEqual({ state: "not_exercised", reason: "flag_unset" });
      expect(liveSuiteState(entry, env, exists, platform), `${entry.id} all present`).toEqual({ state: "requested" });
      for (const resource of entry.resources) {
        const [label] = resourceLabels([resource]);
        let reduced: Record<string, string> = { ...env };
        let reducedPlatform = platform;
        let reducedExists = exists;
        if (resource.check === "hostPlatform") reducedPlatform = "linux-arm64";
        else if (resource.check === "oneOf") for (const name of resource.names) delete reduced[name];
        else if (resource.check === "absolutePathExists" && resource.name === entry.flag.name) reducedExists = () => false;
        else if (resource.check === "pattern") reduced = { ...reduced, [resource.name]: "not-an-isolated-project" };
        else delete reduced[resource.name];
        expect(liveSuiteState(entry, reduced, reducedExists, reducedPlatform), `${entry.id} without ${label}`).toEqual({ state: "not_exercised", reason: "resource_absent", missing: [label] });
      }
      // a relative path never counts as an existing absolute path
      for (const resource of entry.resources.filter((candidate): candidate is Extract<LiveResource, { check: "absolutePathExists" }> => candidate.check === "absolutePathExists")) {
        const relative = { ...env, [resource.name]: "relative/path" };
        expect(liveSuiteState(entry, relative, () => true, platform), `${entry.id} ${resource.name} relative`).toMatchObject({ state: "not_exercised", reason: "resource_absent" });
      }
      // assertLiveResources: quiet with the flag unset; NOT EXERCISED with every absent name and the flag's name, and no value
      expect(() => assertLiveResources(entry.id, {})).not.toThrow();
      const bare = { [entry.flag.name]: env[entry.flag.name]! };
      const state = liveSuiteState(entry, bare);
      if (state.state === "not_exercised" && state.reason === "resource_absent") {
        let message = "";
        try {
          assertLiveResources(entry.id, bare);
        } catch (error) {
          message = (error as Error).message;
        }
        expect(message, entry.id).toBe(`NOT EXERCISED: ${entry.id}: ${state.missing.join(", ")} absent while ${entry.flag.name} is set`);
        for (const value of Object.values(env)) if (value !== "1" && value !== env[entry.flag.name]) expect(message.includes(value), `${entry.id} leaks a value`).toBe(false);
      } else {
        expect(entry.resources, `${entry.id} has no resource`).toEqual([]);
        expect(() => assertLiveResources(entry.id, bare)).not.toThrow();
      }
    }
    expect(() => assertLiveResources("no-such-suite", {})).toThrow(/^LIVE_SUITE_UNKNOWN: no-such-suite$/);
    // the oracle's counterexample shape: KICAD_CLI set to an absolute path that does not exist
    const missing = resolve(tmpdir(), "sirkit-b24-b3-no-kicad-cli");
    expect(() => assertLiveResources("kicad-cli-oracle", { KICAD_CLI: missing })).toThrow("NOT EXERCISED: kicad-cli-oracle: KICAD_CLI absent while KICAD_CLI is set");
  });

  it("4. each linked LIVE_SUITES entry's class and blockers equal B1's catalog row that links it (five links: assist-live, b16-1b-live-qualification, b19-e-live-contract, kicad-cli-oracle, b22-d-adversarial-live); the two unlinked entries state a catalog class and register LB ids; every LB id is a register row", () => {
    const register = new Set(liveBlockerIdsOf(read(REGISTER)));
    const linked: string[] = [];
    for (const entry of LIVE_SUITES) {
      const rows = GOLDEN_EVAL_CATALOG.filter((row) => row.links.some((link) => link.kind === "live_opt_in" && link.path === entry.path));
      expect(rows.length, entry.id).toBeLessThanOrEqual(1);
      if (rows.length === 1) {
        linked.push(entry.id);
        expect([entry.evaluationClass, [...entry.blockers]], entry.id).toEqual([rows[0]!.class, [...rows[0]!.liveBlockers]]);
      } else {
        expect(EVAL_CLASS_IDS, entry.id).toContain(entry.evaluationClass);
        expect(entry.blockers.length > 0 || entry.recorded.state === "exercised", `${entry.id}: blockers empty only for a lead-local resource with a recorded exercised run`).toBe(true);
      }
      for (const id of entry.blockers) expect(register.has(id), `${entry.id} ${id}`).toBe(true);
    }
    expect(linked.sort()).toEqual(["assist-live", "b16-1b-live-qualification", "b19-e-live-contract", "b22-d-adversarial-live", "kicad-cli-oracle"]);
    expect(LIVE_SUITES.map((entry) => entry.id)).toEqual(["assist-live", "b19-e-live-contract", "b16-1b-live-qualification", "kicad-cli-oracle", "worker-integration", "b22-a3-runner-live", "b22-d-adversarial-live"]);
  });

  it("5. the two vacuous returns are gone (b19-e-live-contract.test.ts:34-37, b16-1b-live-qualification.test.ts:196) and the oracle's first case exports the routed demo behind a NOT MEASURED positive control", () => {
    const contract = read("app/lib/acquisition/__tests__/b19-e-live-contract.test.ts");
    expect(contract).not.toMatch(/if \(!admission\.admitted\) \{[^}]*\breturn\b/);
    expect(contract).toContain("throw new Error(`NOT EXERCISED: ${id} not admitted (${admission.refusal})`);");
    const auth = lines("app/lib/auth/__tests__/b16-1b-live-qualification.test.ts");
    expect(auth.some((text) => /if \(!DB_URL\)[^\n]*return/.test(text))).toBe(false);
    expect(auth[194]).toContain(["it.", "runIf(DB_URL !== \"\")(\"membership canary"].join(""));
    expect(auth[25]).toBe("const FLAG = process.env.SIRKIT_LIVE_AUTH_QUALIFICATION === \"1\";");
    const oracle = read("app/lib/pcb/__tests__/kicad-cli-oracle.test.ts");
    const firstBlock = gatedBlocks(oracle)[0]!.text;
    expect(firstBlock).toContain("const board = buildRoutedDemo();");
    expect(firstBlock).not.toContain("createEmptyBoard()");
    const control = firstBlock.indexOf("NOT MEASURED:");
    expect(control).toBeGreaterThan(0);
    expect(control).toBeLessThan(firstBlock.indexOf("expect(Math.abs(kicadErrors - ourErrors))"));
    expect(control).toBeGreaterThan(firstBlock.indexOf("const ourErrors = "));
  });

  it("6. assist-live, offline: its request (an injected editor, the selector headers, the origin, provider anthropic) reaches generate exactly once with provider \"anthropic\"; today's request (a content type only) is refused 400 AUTH_PROJECT_SELECTOR_REQUIRED with zero generate calls", { timeout: 30_000 }, async () => {
    const board = buildRoutedDemo();
    ensureBoardPadstacks(board);
    // the counterexample: the request as assist-live built it at 4738aa3, under the local-development principal
    const legacy = await assistPost(new Request("http://localhost/api/pcb/edit/assist", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ instruction: "align these vertically", digest: {}, items: [] }) }));
    expect(legacy.status).toBe(400);
    expect(((await legacy.json()) as { code?: string }).code).toBe("AUTH_PROJECT_SELECTOR_REQUIRED");
    expect(generate).not.toHaveBeenCalled();
    // the repaired request
    generate.mockResolvedValue({ provider: "anthropic", model: "fake-model", text: "", toolCalls: [{ id: "call-1", name: "ask_user", input: { question: "Which net?" } }], stopReason: "tool_use" });
    injectAuthorizedPrincipal(ASSIST_LIVE_PRINCIPAL);
    const response = await assistPost(assistLiveRequest(board, "move R3 next to U1"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ commands: [], question: "Which net?" });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0]![0]).toMatchObject({ provider: "anthropic" });
    // [B24-B3 review] security-5: the registry's recorded reason states what this case shows - refused before any model call, so it reached
    // no provider; the route would have sent it to OpenAI - never that it went there
    const assist = LIVE_SUITES.find((entry) => entry.id === "assist-live")!;
    expect(assist.recorded.state).toBe("not exercised");
    const reason = assist.recorded.state === "not exercised" ? assist.recorded.reason : "";
    expect(reason).toMatch(/refused 400 before any model call/);
    expect(reason).not.toMatch(/\b(?:went|was sent|reached|answered)\b[^;]*\b(?:OpenAI|Anthropic)\b/);
    expect(reason).toMatch(/would have sent it to OpenAI/);
  });

  it("7. the oracle's positive control, offline: Sirkit's DRC finds at least one error on the routed demo (the deliberate short) and none on the empty board - why the oracle's first case could never hold as written", () => {
    const rules = getPreset("jlcpcb-2l").rules;
    const errors = (board: ReturnType<typeof createEmptyBoard>): number => runDrc(board, rules).violations.filter((violation) => violation.severity === "error").length;
    expect(errors(buildRoutedDemo())).toBeGreaterThan(0);
    expect(errors(createEmptyBoard())).toBe(0);
  });

  it("8. recorded is exercised only with a record that resolves: its file and line exist and the line names the suite (or its date, in a file that names the suite); every not-exercised entry says why", () => {
    const resolves = (entry: Entry): boolean => {
      if (entry.recorded.state !== "exercised") return false;
      const at = entry.recorded.record.lastIndexOf(":");
      const [path, line] = [entry.recorded.record.slice(0, at), Number(entry.recorded.record.slice(at + 1))];
      if (!existsSync(join(ROOT, path)) || !Number.isInteger(line) || line < 1) return false;
      const text = lines(path)[line - 1] ?? "";
      return text.includes(entry.id) || (text.includes(entry.recorded.date) && read(path).includes(entry.id));
    };
    for (const entry of ENTRIES) {
      if (entry.recorded.state === "exercised") {
        expect(resolves(entry), entry.id).toBe(true);
        expect(entry.recorded.date, entry.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(entry.recorded.outcome.length, entry.id).toBeGreaterThan(10);
      } else {
        expect(entry.recorded.reason.length, entry.id).toBeGreaterThan(10);
      }
    }
    expect(LIVE_SUITES.filter((entry) => entry.recorded.state === "exercised").map((entry) => entry.id)).toEqual(["b22-a3-runner-live", "b22-d-adversarial-live"]);
    // the rule bites: a record that names another line does not resolve
    const d = LIVE_SUITES.find((entry) => entry.id === "b22-d-adversarial-live")!;
    expect(resolves({ ...d, recorded: { ...d.recorded, record: "artifacts/ai-control-plane-b22/adversarial-matrix.md:1" } } as Entry)).toBe(false);
  });

  it("9. scenario-map.md section 3 equals LIVE_SUITES and NON_LIVE_GATES row for row: id, flag, resource names, class, LB ids and recorded state; kind, job and resources for a non-live gate - names only, no value", () => {
    const page = read(PAGE);
    const start = page.indexOf(`${NEWLINE}## 3. `);
    const three = page.slice(start, page.indexOf(`${NEWLINE}## `, start + 1));
    const names = (resources: readonly LiveResource[]): string => resourceLabels(resources).map((label) => `\`${label}\``).join(", ") || "(none)";
    const recorded = (entry: Entry): string => (entry.recorded.state === "exercised" ? `exercised ${entry.recorded.date} (\`${entry.recorded.record}\`)` : "not exercised");
    const liveRows = LIVE_SUITES.map((entry) => `| \`${entry.id}\` | \`${entry.flag.name}\` (${entry.flag.kind}) | ${names(entry.resources)} | ${names(entry.optional)} | \`${entry.evaluationClass}\` | ${entry.blockers.join(", ")} | ${recorded(entry)} |`);
    const gateRows = NON_LIVE_GATES.map((entry) => `| \`${entry.id}\` | \`${entry.kind}\` | \`${entry.flag.name}\` (${entry.flag.kind}) | \`${entry.job.workflow}\` \`${entry.job.id}\` | ${names(entry.resources)} | ${recorded(entry)} |`);
    const tableRows = three.split(NEWLINE).filter((line) => /^\| `[a-z0-9-]+` \|/.test(line));
    expect(tableRows).toEqual([...liveRows, ...gateRows]);
    expect(three).toMatch(/B24-D1 and B24-D2 append their suites[^\n]*by a reviewed edit/);
    for (const entry of ENTRIES) expect(three, entry.id).toContain(`\`${entry.path}\``);
  });

  it("10. NON_LIVE_GATES (lead decision D2) holds exactly b24-b2-corpus-nightly: its kind is closed, it carries no catalog class and no LB id, and only the job it names sets its flag - to exactly \"1\" - in the vitest step that selects it (benchmark-nightly, schedule and dispatch only); every other job that selects it leaves the flag unset; its local run is a note, never the recorded state", () => { // [B24-D1, 2026-10-09] + the two latency benchmark gates b24-d1-latency and b24-d1-latency-workflow (benchmark-latency, every trigger; lead decision D2, OD-212): the title keeps B3's text, the pinned list below moved by review; [B24-D2, 2026-10-09] + the memory gate b24-d2-memory (the same job, flag and step; lead decision D2, OD-212's memory half): the pinned list and the local-run log below moved by review
    // B24-D1 and B24-D2 move this pinned list by a reviewed edit when they append their entries
    expect(NON_LIVE_GATES.map((entry) => entry.id)).toEqual(["b24-b2-corpus-nightly", "b24-d1-latency", "b24-d1-latency-workflow", "b24-d2-memory"]); // [B24-D1, 2026-10-09] reviewed pin move: + the two latency benchmark gates (lead decision D2, OD-212); [B24-D2, 2026-10-09] reviewed pin move: + the memory gate
    expect([...NON_LIVE_GATE_KINDS]).toEqual(["scheduled-benchmark", "non-live"]);
    const admission = ciAdmission();
    for (const entry of NON_LIVE_GATES) {
      expect(NON_LIVE_GATE_KINDS, entry.id).toContain(entry.kind);
      expect(Object.keys(entry).filter((key) => key === "evaluationClass" || key === "blockers"), entry.id).toEqual([]);
      expect(entry.flag.kind).toBe("exact-1");
      expect(entry.job.workflow).toBe(BENCHMARK);
      const jobs = admission.jobsOf(entry.path);
      expect(jobs, entry.id).toContain(entry.job.id);
      const stepEnv = admission.stepEnv as Readonly<Record<string, Readonly<Record<string, string>>>>;
      expect(stepEnv[entry.job.id]?.[entry.flag.name], entry.id).toBe("1");
      for (const [job, env] of Object.entries(stepEnv)) if (job !== entry.job.id) expect(Object.hasOwn(env, entry.flag.name), `${entry.id} ${job}`).toBe(false);
      expect(read(DETERMINISTIC)).not.toContain(entry.flag.name);
      // [B24-D1, 2026-10-09] reviewed pin move: the flag as a whole name (SIRKIT_B24_BENCHMARK_DIR, the latency job's directory variable, carries it as a prefix on three lines)
      const wholeName = new RegExp(`(?<![A-Z0-9_])${entry.flag.name}(?![A-Z0-9_])`);
      expect(read(BENCHMARK).split(NEWLINE).filter((line) => wholeName.test(line))).toHaveLength(1);
      if (entry.kind === "scheduled-benchmark") expect(entry.job.id).toBe("benchmark-nightly");
      if (entry.kind === "non-live") expect(entry.job.id, entry.id).toBe("benchmark-latency"); // [B24-D1, 2026-10-09] the job that also runs on pull_request
      expect(entry.recorded.state, entry.id).toBe("not exercised");
      // [B24-D1, 2026-10-09] reviewed pin move: each gate's measured local run is its own (B2's red corpus run; D1's green latency runs)
      if (entry.id === "b24-b2-corpus-nightly") {
        expect(entry.localRun).toMatchObject({ date: "2026-10-08", log: "b2-corpus-flagged-2" });
        expect(entry.localRun!.result).toMatch(/^red/);
      } else {
        expect(entry.localRun, entry.id).toMatchObject({ date: "2026-10-09", log: entry.id === "b24-d1-latency" ? "d1-green-latency-flagged" : entry.id === "b24-d2-memory" ? "d2-green-memory-flagged" : "d1-green-latency-workflow-flagged" }); // [B24-D2, 2026-10-09] + the memory gate's own green run
        expect(entry.localRun!.result, entry.id).toMatch(/^green/);
      }
    }
  });
});
