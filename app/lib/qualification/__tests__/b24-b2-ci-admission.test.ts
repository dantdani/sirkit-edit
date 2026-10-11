/**
 * [B24-B2] The CI admission guard (D24-15, OD-204; runbook section 4 :1206-1207 "trace/replay/evals cover the required scenarios;" /
 * "GitHub CI and benchmark-quality are green;"). It reads both workflows and B24-B1's catalog JSON as files and selects test files
 * only through B24-B1's `_ci-admission.ts` (B19-E's positional-filter rule, re-implemented there; b19-e-ci-job-scope is never
 * imported, so its cases are not registered twice, and no second reader exists):
 *
 *  1. (a) every suite the catalog links exists, a CI job selects it, and its recorded `ciJobs` are the derived ones: a PGlite suite
 *     counts only through database-delivery, a spec through page-browser-e2e, an opt-in live suite through any job (it skips itself
 *     without its flag, OD-222); benchmark-nightly alone selects only stage-08-professional-routing;
 *  2. (b) the closed negative list: autoroute-boundary-integrity, autonomous-layout-qualification and manufacturing-release-gate start a
 *     real FreeRouting/Java process with no skip gate, so no job selects them and no catalog row links them; the catalog's
 *     placement-routing x physical_hardware row is blocked on LB-3;
 *  3. (c) the named D24-15 list: the 23 B09-B11 suites, the four B16.0 byte pins, pin-pad-mapping and the five footprint-resolver
 *     suites, each selected by exactly one prompt-to-gerber filter and none starting PGlite; no app/lib/agent/__tests__ filter;
 *  4. (c, live) the three catalogued opt-in live suites no job selected at f663d71, each by exactly one prompt-to-gerber filter, each
 *     skipping itself without its flag, which neither workflow sets (OD-222);
 *  5. (d) the corpus suite rides benchmark-nightly's vitest step, whose env sets SIRKIT_B24_CORPUS_NIGHTLY "1"; benchmark-core and
 *     the deterministic workflow never name the flag, and prompt-to-gerber selects the suite, where it skips;
 *  6. detector parity: the helper's PGlite detector over B19-E's own detector fixtures (b19-e-ci-job-scope.test.ts:107-125; [B24-D0, 2026-10-09] was :106-124);
 *  7. the helper's env reader bites: an `env:` with no entry, a stray line under the step and a doubled key each throw CI_ANCHOR;
 *  8. [B24-B2 review, 2026-10-08] (a, browser) the quote-order browser link asserts its own turn: E9's earlier turn leaves the same
 *     refusal line, labelled note and nothing-changed label in the serial spec's page, so the order case counts each before it sends
 *     and requires more after, never by .last() alone; its order-path check is deliverable 5's pattern with no word boundary; the
 *     catalog's gap says "no browser request" and PROPOSED;
 *  9. [B24-B2 review, 2026-10-08] each comment that says the browser spec sends 82 chat runs carries B2's dated note with 85.
 *
 * Failing first on b0af256 (ci-admission.md section 2): cases 1, 3, 4, 5 and 7 red. [B24-B2 review, 2026-10-08] security-7: this
 * line said "cases 1, 3, 4 and 5"; b2-red-1-ci-admission-corpus records case 7 red too (b0af256's nightly step has no env block).
 * Cases 8 and 9 failed first on the reviewed tree (b2fix-red-1). Files are read as text; nothing is written to disk and no process
 * is started.
 * [B24-D0, 2026-10-09] Reviewed pin moves (OD-30's split, ci-split.md): in cases 3 and 4 "exactly one prompt-to-gerber filter" became
 * "exactly one positional filter of the one job that runs it - prompt-to-gerber net of its `--exclude` lines, or the appended
 * `agent-boundary-suites`"; the 25 moved names (the B09-B11 suites but `b09-loop-safety` and `b11-trace-replay-evaluation`, the four
 * B16.0 pins) run in agent-boundary-suites, the other 11 and the three live suites in prompt-to-gerber.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CI_ADMISSION_ANCHORS, ciAdmission, readRepoText, startsPglite, type CiJobId, type RepoReader } from "./_ci-admission";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const read = readRepoText;
const DETERMINISTIC = ".github/workflows/deterministic-manufacturing.yml";
const BENCHMARK = ".github/workflows/benchmark.yml";
const CATALOG_JSON = "artifacts/ai-control-plane-b24/eval-catalog.json";
const CORPUS_SUITE = "app/lib/qualification/__tests__/b24-b2-corpus-nightly.test.ts";
const CORPUS_FLAG = "SIRKIT_B24_CORPUS_NIGHTLY";

const AGENT = "app/lib/agent/__tests__/";
const CHAT = "app/api/chat/__tests__/";
/** D24-15's named list: the 23 B09-B11 suites (19 agent, 4 chat route). */
const B09_B11 = [
  ...["b09-1-boundary.test.ts", "b09-1-recovery.test.tsx", "b09-2-closure.test.ts", "b09-2-recovery.test.tsx", "b09-3-closure.test.ts", "b09-loop-safety.test.ts", "b09-proposals.test.ts", "b09-provider-contracts.test.ts", "b10-1-strict-mode-publisher.test.tsx", "b10-editor-context.test.ts", "b11-1-trace-integrity.test.ts", "b11-2-replay-context.test.ts", "b11-3-generated-pcb-shape.test.ts", "b11-4-capture-ownership.test.ts", "b11-4-no-execution.test.ts", "b11-5-capture-exactness.test.ts", "b11-6-projection-ownership.test.ts", "b11-7-primitive-discipline.test.ts", "b11-trace-replay-evaluation.test.ts"].map((name) => `${AGENT}${name}`),
  ...["b10-1-request-boundary.test.ts", "b10-2-closure.test.ts", "b10-chat-boundary.test.ts", "b11-1-route-finalization.test.ts"].map((name) => `${CHAT}${name}`),
] as const;
/** The four B16.0 byte pins: the exact route policy and resource classification (`b16-0-1-ci-gates.test.ts:107-111`), auth coverage
 *  (`b16-0-2-gates.test.ts:266-270`, `b16-0-auth-route-coverage.test.ts:42-48`) and the raw baseline (`b16-0-8-migration-ratchet.test.ts:299-370`). */
const B16_0_PINS = ["app/lib/auth/__tests__/b16-0-1-ci-gates.test.ts", "app/lib/auth/__tests__/b16-0-2-gates.test.ts", "app/api/__tests__/b16-0-auth-route-coverage.test.ts", "app/lib/auth/__tests__/b16-0-8-migration-ratchet.test.ts"] as const;
const RESOLVER = "app/lib/footprint-resolver/__tests__/";
const FOOTPRINT_PIN = ["app/lib/pcb/__tests__/pin-pad-mapping.test.ts", ...["normalization-conflict", "policy-request", "resolution-e2e", "safety-status-property", "service-shadow-api-security"].map((name) => `${RESOLVER}${name}.test.ts`)] as const;
/** The three catalogued opt-in live suites no job selected at f663d71, with the flag each needs (CI never sets one, OD-222). */
const LIVE_SKIPPING: ReadonlyArray<readonly [string, string]> = [
  ["app/api/pcb/edit/__tests__/assist-live.test.ts", "PCB_ASSIST_LIVE"],
  ["app/lib/auth/__tests__/b16-1b-live-qualification.test.ts", "SIRKIT_LIVE_AUTH_QUALIFICATION"],
  ["app/lib/pcb/__tests__/kicad-cli-oracle.test.ts", "KICAD_CLI"],
];
/** The closed negative list, each with its reason: it starts a real FreeRouting/Java process and has no skip gate. */
const NEGATIVE: ReadonlyArray<readonly [string, string]> = [
  ["app/lib/pcb/__tests__/autoroute-boundary-integrity.test.ts", "runFreerouting("],
  ["app/lib/pcb/__tests__/autonomous-layout-qualification.test.ts", "createAutonomousGoldenRealRouter()"],
  ["app/lib/pcb/__tests__/manufacturing-release-gate.test.ts", "createAutonomousGoldenRealRouter()"],
];
const SKIP_GATE = /describe\.(?:skipIf|runIf)\(/;

interface CatalogJsonLink { readonly path: string; readonly kind: "suite" | "spec" | "pglite" | "live_opt_in"; readonly ciJobs: readonly string[] }
interface CatalogJsonRow { readonly area: string; readonly class: string; readonly state: string; readonly links: readonly CatalogJsonLink[]; readonly liveBlockers: readonly string[]; readonly note: string }
const catalogRows = (): CatalogJsonRow[] => (JSON.parse(read(CATALOG_JSON)) as { rows: CatalogJsonRow[] }).rows;
const isFile = (path: string): boolean => existsSync(join(ROOT, path)) && statSync(join(ROOT, path)).isFile();
/** A link is admitted when a job that may run its kind selects it. */
const admitted = (kind: CatalogJsonLink["kind"], jobs: readonly CiJobId[]): boolean =>
  kind === "pglite" ? jobs.includes("database-delivery") : kind === "spec" ? jobs.includes("page-browser-e2e") : jobs.length > 0;

// [B24-B2 review, 2026-10-08] the browser order case (cases 8 and 9)
const AGENT_SPEC = "e2e/agent-execution.spec.ts";
/** A spec test's source: from its `test("<prefix>` line to the next top-level `test(` line. */
function specTest(spec: string, prefix: string): string {
  const start = spec.indexOf(`${NEWLINE}test("${prefix}`);
  if (start < 0) throw new Error(`${AGENT_SPEC}: no test "${prefix}"`);
  const next = spec.indexOf(`${NEWLINE}test(`, start + 1);
  return spec.slice(start + 1, next < 0 ? spec.length : next);
}
/** What E9's "Release the board." turn leaves in the serial spec's one page, as both tests locate it: its refusal line, its labelled
 *  note and the nothing-changed label (correctness-order-e2e-last-matches-e9, security-3). */
const TURN_LOCATORS: ReadonlyArray<readonly [string, string]> = [
  ["refusals", "/Unknown tool — refused before running \\(unknown_tool\\) — nothing ran/"],
  ["notes", "/^Assistant note \\(written before the result\\): \\(fixture interim\\)/"],
  ["nothingChanged", "NOTHING_CHANGED"],
];
/** The comments that state how many chat runs the browser spec sends (correctness-stale-82-chat-runs-production-comments). */
const CHAT_RUN_STATEMENTS = ["app/lib/auth/abuse-limits.ts", "app/lib/fixture-runtime/clock.ts"] as const;

describe("[B24-B2] CI admission (D24-15, OD-204)", () => {
  it("1. (a) every suite the catalog links exists, a CI job selects it (a PGlite suite through database-delivery, a spec through page-browser-e2e, an opt-in live suite through any job), and its recorded ciJobs are the derived ones; benchmark-nightly alone selects only stage-08-professional-routing", () => {
    const admission = ciAdmission();
    const links = catalogRows().flatMap((row) => row.links.map((entry) => ({ ...entry, where: `${row.area}/${row.class}` })));
    expect(links.length).toBeGreaterThan(100);
    const problems: string[] = [];
    for (const entry of links) {
      if (!isFile(entry.path)) { problems.push(`${entry.where} ${entry.path}: no such file`); continue; }
      const jobs = admission.jobsOf(entry.path);
      if (!admitted(entry.kind, jobs)) problems.push(`${entry.where} ${entry.path} (${entry.kind}): selected by ${jobs.join("+") || "no job"}`);
      if (JSON.stringify(entry.ciJobs) !== JSON.stringify(jobs)) problems.push(`${entry.where} ${entry.path}: recorded ${entry.ciJobs.join("+") || "none"}, derived ${jobs.join("+") || "none"}`);
      if (entry.kind === "pglite" && !startsPglite(entry.path)) problems.push(`${entry.where} ${entry.path}: a pglite link that starts no PGlite`);
    }
    expect(problems).toEqual([]);
    const nightlyOnly = [...new Set(links.filter((entry) => entry.kind === "suite").map((entry) => entry.path))].filter((path) => JSON.stringify(admission.jobsOf(path)) === JSON.stringify(["benchmark-nightly"]));
    expect(nightlyOnly).toEqual(["app/lib/pcb/__tests__/stage-08-professional-routing.test.ts"]);
  });

  it("2. (b) the closed negative list: three FreeRouting/Java suites with no skip gate - each exists, no job of either workflow selects it, no catalog row links it - and placement-routing x physical_hardware is blocked on LB-3", () => {
    const admission = ciAdmission();
    const linked = new Set(catalogRows().flatMap((row) => row.links.map((entry) => entry.path)));
    for (const [path, starter] of NEGATIVE) {
      expect(isFile(path), path).toBe(true);
      const source = read(path);
      expect(source, `${path} reaches the real router`).toContain(starter);
      expect(SKIP_GATE.test(source), `${path} has no skip gate`).toBe(false);
      expect(source.split(NEWLINE).some((line) => line.startsWith("describe(")), `${path}: a plain describe(`).toBe(true);
      expect(admission.jobsOf(path), path).toEqual([]);
      expect(linked.has(path), path).toBe(false);
    }
    const row = catalogRows().find((candidate) => candidate.area === "placement-routing" && candidate.class === "physical_hardware")!;
    expect([row.state, row.liveBlockers, row.links]).toEqual(["blocked", ["LB-3"], []]);
  });

  it("3. (c) the named D24-15 list - the 23 B09-B11 suites, the four B16.0 byte pins, pin-pad-mapping and the five footprint-resolver suites - each selected by exactly one prompt-to-gerber filter, none starting PGlite; no app/lib/agent/__tests__ directory filter", () => {
    // the list is closed: the B09-B11 files on the tree are exactly the named ones
    const onTree = [AGENT, CHAT].flatMap((dir) => readdirSync(join(ROOT, dir)).filter((name) => /^b(?:09|10|11)-.*\.test\.tsx?$/.test(name)).map((name) => `${dir}${name}`));
    expect([...onTree].sort()).toEqual([...B09_B11].sort());
    expect(readdirSync(join(ROOT, RESOLVER)).filter((name) => /\.test\.tsx?$/.test(name)).map((name) => `${RESOLVER}${name}`).sort()).toEqual(FOOTPRINT_PIN.slice(1));
    const named = [...B09_B11, ...B16_0_PINS, ...FOOTPRINT_PIN];
    expect(named).toHaveLength(33);
    const admission = ciAdmission();
    // [B24-D0, 2026-10-09] reviewed pin move (OD-30's split): each name runs in exactly one of prompt-to-gerber (net of its exclusions) and agent-boundary-suites, selected there by exactly one positional filter
    const runsIn = (path: string): ("prompt-to-gerber" | "agent-boundary-suites")[] => admission.jobsOf(path).filter((job): job is "prompt-to-gerber" | "agent-boundary-suites" => job === "prompt-to-gerber" || job === "agent-boundary-suites");
    const off = named.filter((path) => !isFile(path) || runsIn(path).length !== 1 || admission.filters[runsIn(path)[0]!].filter((filter) => path.includes(filter)).length !== 1 || startsPglite(path));
    expect(off).toEqual([]);
    const moved = [...B09_B11.filter((path) => !path.endsWith("b09-loop-safety.test.ts") && !path.endsWith("b11-trace-replay-evaluation.test.ts")), ...B16_0_PINS];
    expect(moved).toHaveLength(25);
    expect(named.filter((path) => runsIn(path)[0] === "agent-boundary-suites").sort()).toEqual([...moved].sort());
    for (const job of ["prompt-to-gerber", "agent-boundary-suites"] as const) expect(admission.filters[job]).not.toContain("app/lib/agent/__tests__");
  });

  it("4. (c, live) the three catalogued opt-in live suites are each selected by exactly one prompt-to-gerber filter, skip themselves without their flag, and neither workflow sets the flag (OD-222)", () => {
    const admission = ciAdmission();
    const filters = admission.filters["prompt-to-gerber"];
    const linkedLive = new Set(catalogRows().flatMap((row) => row.links.filter((entry) => entry.kind === "live_opt_in").map((entry) => entry.path)));
    const workflows = [read(DETERMINISTIC), read(BENCHMARK)];
    for (const [path, flag] of LIVE_SKIPPING) {
      expect(linkedLive.has(path), `${path} is a catalogued live_opt_in link`).toBe(true);
      const source = read(path);
      expect(SKIP_GATE.test(source), `${path} skips itself`).toBe(true);
      expect(source, `${path} reads ${flag}`).toContain(`process.env.${flag}`);
      expect(startsPglite(path), path).toBe(false);
      expect(filters.filter((filter) => path.includes(filter)), path).toHaveLength(1);
      expect(admission.jobsOf(path), path).toEqual(["prompt-to-gerber"]); // [B24-D0, 2026-10-09] net of the exclusions: the three stay in prompt-to-gerber (OD-30's split)
      for (const workflow of workflows) expect(workflow.includes(flag), `a workflow names ${flag}`).toBe(false);
    }
    expect(LIVE_SKIPPING.length + B09_B11.length + B16_0_PINS.length + FOOTPRINT_PIN.length).toBe(36);
  });

  it("5. (d) the corpus suite rides benchmark-nightly's vitest step, whose env sets SIRKIT_B24_CORPUS_NIGHTLY \"1\" (schedule and dispatch only); benchmark-core and the deterministic workflow never name the flag; prompt-to-gerber selects the suite, where it skips", () => {
    const admission = ciAdmission();
    expect(isFile(CORPUS_SUITE)).toBe(true);
    expect(admission.jobsOf(CORPUS_SUITE)).toEqual(["prompt-to-gerber", "benchmark-nightly"]);
    expect(admission.filters["benchmark-nightly"]).toContain(CORPUS_SUITE);
    expect(admission.stepEnv["benchmark-nightly"]).toEqual({ [CORPUS_FLAG]: "1" });
    expect(admission.stepEnv["benchmark-core"]).toEqual({});
    const benchmark = read(BENCHMARK).split(NEWLINE);
    expect(benchmark.filter((line) => line.includes(CORPUS_FLAG))).toEqual([`          ${CORPUS_FLAG}: "1"`]);
    expect(read(DETERMINISTIC)).not.toContain(CORPUS_FLAG);
    // the step that carries the flag is the nightly job's, under its schedule-and-dispatch condition
    const nightly = benchmark.indexOf(CI_ADMISSION_ANCHORS.benchmarkNightly);
    const flagLine = benchmark.findIndex((line) => line.includes(CORPUS_FLAG));
    expect(nightly).toBeGreaterThan(benchmark.indexOf(CI_ADMISSION_ANCHORS.benchmarkCore));
    expect(flagLine).toBeGreaterThan(nightly);
    expect(benchmark.slice(nightly, flagLine).some((line) => line.trim() === CI_ADMISSION_ANCHORS.nightlyCondition)).toBe(true);
  });

  it("6. detector parity: the helper's PGlite detector answers B19-E's detector fixtures as B19-E's does", () => {
    // B19-E's fixtures (b19-e-ci-job-scope.test.ts:107-125; [B24-D0, 2026-10-09] was :106-124), specifiers assembled at run time so this file never reads as starting PostgreSQL
    const DISPOSABLE = ["disposable", "postgres"].join("-");
    const PGLITE = ["@electric-sql", "pglite"].join("/");
    const files: Record<string, string> = {
      "app/lib/db/__tests__/direct.test.ts": `import { disposablePostgres } from "../${DISPOSABLE}";`,
      "app/lib/acquisition/__tests__/via-harness.test.ts": `import { withDb } from "../../distributors/__tests__/_pg-harness";`,
      "app/lib/distributors/__tests__/_pg-harness.ts": `export { disposablePostgres as withDb } from "../../db/${DISPOSABLE}";`,
      "app/lib/acquisition/__tests__/dynamic.test.ts": `const pg = await import("${PGLITE}");`,
      "app/lib/acquisition/__tests__/plain.test.ts": `import { searchExternalCandidates } from "../external-search";${NEWLINE}import { x } from "./helper";`,
      "app/lib/acquisition/__tests__/helper.ts": `export const x = "${DISPOSABLE} is only a word here";`,
      "app/lib/acquisition/external-search.ts": `import { SOURCE_REGISTRY } from "./source-registry";`,
    };
    const fixture = (file: string): string | null => files[file] ?? null;
    expect(startsPglite("app/lib/db/__tests__/direct.test.ts", fixture)).toBe(true);
    expect(startsPglite("app/lib/acquisition/__tests__/via-harness.test.ts", fixture)).toBe(true);
    expect(startsPglite("app/lib/acquisition/__tests__/dynamic.test.ts", fixture)).toBe(true);
    expect(startsPglite("app/lib/acquisition/__tests__/plain.test.ts", fixture)).toBe(false);
    // and on the tree: B19-E's own PGlite examples, and none of the 36
    expect(startsPglite("app/lib/distributors/__tests__/b19-offer-retention.test.ts")).toBe(true);
    expect(startsPglite("app/lib/manufacturing-providers/database/__tests__/b23-b-exchange-ledger-pglite.test.ts")).toBe(true);
  });

  it("7. the helper's env reader bites: an env block with no entry, a stray line under the step and a doubled key each throw CI_ANCHOR; a step with no env reads {}", () => {
    const benchmark = read(BENCHMARK);
    const files = new Map<string, string>();
    for (const path of [DETERMINISTIC, BENCHMARK, "playwright.config.ts", "playwright.orchestration.config.ts", "package.json", "vitest.config.ts"]) files.set(path, read(path));
    const withBenchmark = (text: string): RepoReader => (path) => (path === BENCHMARK ? text : files.get(path) ?? read(path));
    const flagLine = `          ${CORPUS_FLAG}: "1"`;
    expect(benchmark).toContain(`        env:${NEWLINE}${flagLine}`);
    const bites = (text: string, pattern: RegExp): boolean => {
      expect(text, "the plant changes the text").not.toBe(benchmark);
      try {
        ciAdmission(withBenchmark(text));
        return false;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return message.startsWith("CI_ANCHOR: ") && pattern.test(message);
      }
    };
    expect(bites(benchmark.replace(`${NEWLINE}${flagLine}`, ""), /benchmark-nightly:'s vitest step has an env block with no entry$/)).toBe(true);
    expect(bites(benchmark.replace(`        env:${NEWLINE}${flagLine}`, flagLine), /benchmark-nightly:'s vitest step has a line outside an env entry/)).toBe(true);
    expect(bites(benchmark.replace(flagLine, `${flagLine}${NEWLINE}${flagLine}`), /benchmark-nightly:'s vitest step sets SIRKIT_B24_CORPUS_NIGHTLY twice$/)).toBe(true);
    // the env block dropped whole: the derivation holds, and case 5's pin is what fails
    const withoutEnv = ciAdmission(withBenchmark(benchmark.replace(`        env:${NEWLINE}${flagLine}${NEWLINE}`, "")));
    expect(withoutEnv.stepEnv["benchmark-nightly"]).toEqual({});
    expect(withoutEnv.stepEnv["benchmark-core"]).toEqual({});
    // an unquoted value reads the same
    expect(ciAdmission(withBenchmark(benchmark.replace(flagLine, `          ${CORPUS_FLAG}: 1`))).stepEnv["benchmark-nightly"]).toEqual({ [CORPUS_FLAG]: "1" });
  });

  it("8. [B24-B2 review, 2026-10-08] (a, browser) the quote-order browser link asserts its own turn: the spec is serial and E9's earlier turn leaves the same refusal line, labelled note and nothing-changed label in the page, so the order case counts each before it sends \"Order the parts.\" and requires more after, never by .last() alone; its order-path check is the task's pattern with no word boundary; the catalog's gap says browser request and PROPOSED", () => {
    const spec = read(AGENT_SPEC);
    expect(spec).toContain(`test.describe.configure({ mode: "serial" });`);
    const e9 = specTest(spec, "[B18-E E9] scenario 8 in the browser");
    const order = specTest(spec, "[B24-B2] an order request in the browser");
    const sent = order.indexOf(`await chat("Order the parts.");`);
    expect(sent).toBeGreaterThan(0);
    const [before, after] = [order.slice(0, sent), order.slice(sent)];
    const problems: string[] = [];
    for (const [name, locator] of TURN_LOCATORS) {
      // the hazard: E9 shows the same text earlier in the same page, so a .last() check in the order case can pass on E9's line
      expect(e9, `E9 asserts ${name} by .last()`).toContain(`page.getByText(${locator}).last()).toBeVisible()`);
      if (order.includes(`page.getByText(${locator}).last()`)) problems.push(`${name}: asserted by .last()`);
      if (!before.includes(`const ${name} = page.getByText(${locator});`)) problems.push(`${name}: no locator before the turn`);
      if (!before.includes(`const ${name}Before = await ${name}.count();`)) problems.push(`${name}: not counted before the turn`);
      if (!new RegExp(`await expect\\.poll\\(\\(\\) => ${name}\\.count\\(\\)[^;]*\\)\\.toBeGreaterThan\\(${name}Before\\);`).test(after)) problems.push(`${name}: not required to grow after the turn`);
    }
    expect(problems).toEqual([]);
    // the order-path check is deliverable 5's pattern, `order|purchase|checkout|cart`, with no word boundary
    expect(order).toContain("/order|purchase|checkout|cart/i.test(");
    expect(order).not.toContain("\\b");
    // the catalog's gap: the recorder sees browser requests only, and the case has not run in a browser yet
    const row = catalogRows().find((candidate) => candidate.area === "quote-order" && candidate.class === "browser_e2e")!;
    expect(row.links.map((entry) => entry.path)).toEqual([AGENT_SPEC]);
    expect(row.note).toContain("no browser request");
    expect(row.note).toContain("PROPOSED");
  });

  it("9. [B24-B2 review, 2026-10-08] each comment that says the browser spec sends 82 chat runs carries B2's dated note with 85 (the order case adds a board read, the order turn and a board read)", () => {
    const statements = CHAT_RUN_STATEMENTS.flatMap((path) => read(path).split(NEWLINE).flatMap((line, index) => (/sends 82\b/.test(line) ? [{ at: `${path}:${index + 1}`, line }] : [])));
    expect(statements.map((statement) => statement.at.split(":")[0])).toEqual([...CHAT_RUN_STATEMENTS]);
    expect(statements.filter((statement) => !(statement.line.includes("[B24-B2, 2026-10-08]") && /\b85\b/.test(statement.line))).map((statement) => `${statement.at}: no dated B24-B2 note with 85`)).toEqual([]);
  });
});
