/**
 * [B21 F] The page `evaluation-matrix.md`, pinned by content: its sections, labels, base and tag; section 1's matrix IS the case table
 * (`_f-cases.ts`), row for row; section 2's scripted sentences, capsule id, category capsules and pin moves ARE the code's and the moved
 * files'; section 3's flags and spend bound ARE the live command's, and its live section is the lead's; section 4's browser facts ARE the
 * config's, the router's, the spec's and the installed Next's; every citation resolves by content exactly once and, for every production
 * file F changed, on the line it states; every suite row carries its real `it(` count; what F does not do is stated and the untouched B11
 * files are the hashes the E2 page states; and the "For the lead" texts are all present, the discovery titles quoted exactly.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { anchorOccurrences, pageCitations } from "@/app/lib/mcp/server/__tests__/_citations";
import { FIXTURE_FOLLOW_UP_FAILURE, FIXTURE_FOLLOW_UP_FAILURES, FIXTURE_RESULT_TOOL_NAME, FIXTURE_ROLE_SCRIPTS, fixtureSentenceKey } from "@/app/lib/agent/fixture-agent-adapter";
import { AGENT_REPLAY_CAPSULE_SCHEMA } from "@/app/lib/agent/replay-capsule";
import { ORCHESTRATION_ENABLED_ENV } from "@/app/api/chat/orchestration-runtime";
import { routeComposerMessage } from "@/app/lib/project/composer-routing";
import { SPECIALIST_RESULT_TOOL_NAME } from "../result-tool";
import { ROLE_MODELS_ENV, parseRoleModelOverrides } from "../provider-policy";
import { routeTaskComplexity } from "../router";
import { B11_SCANNED_FILES } from "../tripwires";
import { B21_F_CASES, B21_F_SENTENCES, BROWSER_PROVEN, BROWSER_PROVEN_F12, BROWSER_PROVEN_IN_PART_F6, BROWSER_PROVEN_IN_PART_F12, MODEL_IN_LOOP_LIVE_DAG, MODEL_IN_LOOP_NO_PATH, MODEL_IN_LOOP_SHAPE_ONLY } from "./_f-cases";
import { B21_REPLAY_PINS_SCHEMA, ORCHESTRATION_EVALUATION_CATEGORY, buildOrchestrationEvaluationCases } from "./_f-capsules";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8").replaceAll(`${String.fromCharCode(13)}${NEWLINE}`, NEWLINE);
const PAGE = "artifacts/ai-control-plane-b21/evaluation-matrix.md";
const BASE = "d03f182";
const flat = (text: string): string => text.replace(/\s+/g, " ");
const section = (page: string, from: number): string => page.slice(page.indexOf(`## ${from}. `), page.indexOf(`## ${from + 1}. `) > 0 ? page.indexOf(`## ${from + 1}. `) : undefined);
const sha = (path: string): string => createHash("sha256").update(readFileSync(join(ROOT, path))).digest("hex");
/** the production files F changed: their cited lines must be current, and each is cited */
const CHANGED = ["app/lib/agent/fixture-agent-adapter.ts", "app/lib/agent/replay-capsule.ts"];
const SUITES = ["app/lib/agent/orchestration/__tests__/b21-f-evaluation.test.ts", "app/lib/agent/orchestration/__tests__/b21-f-replay-capsule.test.ts", "app/lib/agent/orchestration/__tests__/b21-f-page.test.ts"];
const NOTED_PAGES = ["artifacts/ai-control-plane-b21/run-events-and-trace.md", "artifacts/ai-control-plane-b21/orchestration-contracts.md", "artifacts/ai-control-plane-b20/mcp-provider-connectors.md", "artifacts/ai-control-plane-b18/chat-execution-ux.md", "artifacts/ai-control-plane-b11/deterministic-replay-contract.md", "artifacts/ai-control-plane-b11-4/immutable-replay-ownership.md", "artifacts/ai-control-plane-b11-4/README.md", "artifacts/ai-control-plane-b11-5/README.md", "artifacts/ai-control-plane-b11-6/README.md", "artifacts/ai-control-plane-b11-7/README.md"];
/** [B21 F fix: coverage-1] the matrix's model-in-loop cell per class */
const MODEL_IN_LOOP_LABELS: Readonly<Record<string, string>> = { [MODEL_IN_LOOP_LIVE_DAG]: "| RECORDED (OD-125): live DAG |", [MODEL_IN_LOOP_SHAPE_ONLY]: "| RECORDED (OD-125): DAG shape only |", [MODEL_IN_LOOP_NO_PATH]: "| NO LIVE PATH |" };
const FACTS = { hasSchematic: true, hasBoard: true, actorRole: "pcb_editor" as const, autonomyMode: "proposal_only" as const, selectionCount: 0 };
/** [B21 F2] the browser proof's own config and spec (D21-43 decided), and the matrix's browser cell per class */
const ORCHESTRATION_CONFIG = "playwright.orchestration.config.ts";
const BROWSER_SPEC = "e2e-orchestration/specialist-orchestration.spec.ts";
const BROWSER_LABELS: Readonly<Record<string, string>> = { [BROWSER_PROVEN]: "| PROVEN (section 4) |", [BROWSER_PROVEN_IN_PART_F6]: "| PROVEN IN PART (section 4) |", [BROWSER_PROVEN_IN_PART_F12]: "| PROVEN IN PART (section 4) |", [BROWSER_PROVEN_F12]: "| PROVEN (section 4) |", "not required": "| not required |" }; // [B21 F2b, 2026-09-29] F12's class since B21-F2b added (D21-45 closed); the in-part classes stay mapped for their record
/** [B21 F2 fix: tests-05, security-1] One web server of the two Playwright configs, as Playwright loads it: only the fields the cases
 *  compare - never its environment, which spreads this process's own. */
interface LoadedServer { readonly command: string; readonly url: string; readonly roleModels: string | undefined }
const CONFIG_MODULE = "../../../../../playwright.config";
const ORCHESTRATION_CONFIG_MODULE = "../../../../../playwright.orchestration.config";
/** Loads both configs with `@playwright/test` stubbed (the runner is never loaded inside vitest) and, when `baseCommand` is given, the
 *  base config's web-server command changed first - so a case sees what the orchestration config makes of the base it imports. */
async function loadWebServers(baseCommand?: (command: string) => string): Promise<{ base: LoadedServer; orchestration: LoadedServer }> {
  type Server = { command: string; url?: string; env?: Record<string, string | undefined> };
  const serverOf = (config: unknown): LoadedServer => { const web = (config as { webServer: Server }).webServer; return { command: web.command, url: String(web.url), roleModels: web.env?.[ROLE_MODELS_ENV] }; };
  vi.resetModules();
  vi.doMock("@playwright/test", () => ({ defineConfig: (config: unknown) => config, devices: { "Desktop Chrome": {} } }));
  if (baseCommand) vi.doMock(CONFIG_MODULE, async () => { const actual = (await vi.importActual<{ default: { webServer: Server } }>(CONFIG_MODULE)).default; return { default: { ...actual, webServer: { ...actual.webServer, command: baseCommand(actual.webServer.command) } } }; });
  try {
    const base = serverOf(((await import(CONFIG_MODULE)) as { default: unknown }).default);
    const orchestration = serverOf(((await import(ORCHESTRATION_CONFIG_MODULE)) as { default: unknown }).default);
    return { base, orchestration };
  } finally {
    vi.doUnmock("@playwright/test");
    vi.doUnmock(CONFIG_MODULE);
    vi.resetModules();
  }
}

/** [B21 F2b review: regressions-1, tests-1] B21-F2b's reserved `nextAction` against the APPLIED one (PROGRAM_STATE.json) - case 16
 *  applies it to the live state, case 17 drives it over the states the program passes through. As b21-d-page case 9 rules it: while
 *  the applied nextAction still leads with its B21-F2b clause, the reserved one IS it with that clause removed, word for word;
 *  afterwards the applied nextAction is F2b's (or a LATER state's: the closeout's commit 2/2 writes state), never compared - only a
 *  reserved text that brings a B21-F2b clause back fails then. The issues found, [] when it holds. */
function f2bNextActionIssues(reserved: string, applied: string): string[] {
  const THEN = "; then the B21 closeout";
  const issues = /B21-F2b/.test(reserved) ? [`the reserved nextAction brings a B21-F2b clause back: ${reserved}`] : [];
  if (applied.startsWith("B21-F2b:") && (applied.indexOf(THEN) < 0 || reserved !== `The B21 closeout${applied.slice(applied.indexOf(THEN) + THEN.length)}`)) issues.push(`the reserved nextAction is not the applied one without its B21-F2b clause: ${reserved}`);
  return issues;
}

describe("[B21 F] the evaluation-matrix page", () => {
  it("1. the page exists with its sections in order, its labels, its base and its tag; it is ONE new page and names the ten pages that carry its dated notes, each of which carries one", () => { // [B21 F fix] ten pages since the review's fixes; [B21 F lead] retitled (a new suite) (the B11 contract page, B11.4's ownership page and four B11 READMEs added)
    const page = read(PAGE);
    expect([...page.matchAll(/^## (\d+)\. /gm)].map((match) => Number(match[1]))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(page).toMatch(new RegExp(`^## 8\\. Citations, as of base ${BASE}`, "m"));
    for (const label of ["CONFIRMED", "INFERRED", "RECORDED", "UNKNOWN", "BLOCKED-LIVE-QUALIFICATION"]) expect(page, label).toContain(label);
    expect(page).toContain("`[B21 F, 2026-09-28]`");
    expect(page).toContain("This is ONE new page for B21-F");
    const head = page.slice(0, page.indexOf("## 0. "));
    for (const noted of NOTED_PAGES) {
      expect(head, noted).toContain(noted.slice(noted.indexOf("ai-control-plane-")));
      expect(read(noted), noted).toContain("[B21 F, 2026-09-28]");
    }
  });

  it("2. section 1's matrix IS the case table, row for row - the id, the runbook line, the item, the route, the three classes, the suite case, the pins - and names every mutation of the failing-first evidence with the cases it failed", () => {
    const one = section(read(PAGE), 1);
    const rows = [...one.matchAll(/^\| (F\d+) \| :(\d+) \| ([^|]+) \| (.+)$/gm)];
    expect(rows.map((row) => row[1])).toEqual(B21_F_CASES.map((entry) => entry.id));
    for (const [index, entry] of B21_F_CASES.entries()) {
      const row = rows[index]!;
      expect(Number(row[2]), entry.id).toBe(entry.runbookLine);
      expect(row[3]!.trim(), entry.id).toBe(entry.item);
      const rest = row[4]!;
      expect(rest, entry.id).toContain(`| ${entry.offline} |`);
      expect(rest, entry.id).toContain(BROWSER_LABELS[entry.browser]!); // [B21 F2, 2026-09-28] reviewed pin move: B21-F wrote F4, F6 and F12 as "| BLOCKED (section 4) |"; B21-F2 delivered the browser spec on its own flag-on config, so the three cells are the delivered classes (F4 PROVEN; [B21 F2 fix: security-1] F6 and F12 PROVEN IN PART)
      expect(rest, entry.id).toContain(MODEL_IN_LOOP_LABELS[entry.modelInLoop]!); // [B21 F fix: coverage-1] what the record-only command can run, row by row
      expect(rest, entry.id).toContain(`\`${entry.suiteCase}\``);
      expect(rest.trim().endsWith(entry.pins.length > 0 ? `${entry.pins.map((pin) => `\`${pin}\``).join(", ")} |` : "(none) |"), entry.id).toBe(true);
      expect(rest, entry.id).toContain(`\`${entry.route.split(" ")[1]}\``);
    }
    const flatOne = flat(one);
    for (const claim of ["fails cases 1, 5, 6, 7, 8, 9, 11, 12 and 13", "while 2, 3, 4 (one coordinator turn), 10 and 16", "fails the capsule suite's cases 1 to 6 and 10 and the pins (case 15)", "(M3) fails cases 2, 3, 4 and 5 and the pins (case 15", "the first-turn gate removed (M4) fails case 10", "(M5) fails cases 11 and 15", "stopping the DAG (M6) fails cases 9 and 15", "forgetting its claim (M7) fails case 12", "ignoring the scope (M8) fails case 8", "(M9, C78) fails case 1", "(M10, C81) fails case 6", "(M11, C80) fails case 6", "(M12) fails case 7", "(M13) fails cases 7 and 15", "(M14) fails case 11", "(M15) fails cases 15 and 16", "(M16) fails capsule case 7", "(M17) fails capsule case 8", "Every one of the twelve runbook cases is red under a mutation of the mechanism it names"]) expect(flatOne, claim).toContain(claim); // [B21 F fix: coverage-8] seventeen mutations, M9 to M17 added by the review's fixes
  });

  it("3. section 2 IS the code's: the scripted sentences listed ARE the script table's keys and each routes to a DAG; the result tool's name is the scheduler's; the capsule id, the category and its seven capsules; the pins schema; every moved suite and page carries its [B21 F] reason", () => {
    const two = section(read(PAGE), 2);
    const listed = [...two.matchAll(/^- `([^`]+)`$/gm)].map((match) => match[1]!);
    expect(listed).toEqual(Object.keys(FIXTURE_ROLE_SCRIPTS));
    for (const key of listed) expect(routeTaskComplexity(key, FACTS).kind, key).toBe("dag");
    expect(FIXTURE_RESULT_TOOL_NAME).toBe(SPECIALIST_RESULT_TOOL_NAME);
    expect(two).toContain(`\`${SPECIALIST_RESULT_TOOL_NAME}\``);
    expect(two).toContain(AGENT_REPLAY_CAPSULE_SCHEMA);
    expect(two).toContain(`\`${ORCHESTRATION_EVALUATION_CATEGORY}\``);
    expect(two).toContain(B21_REPLAY_PINS_SCHEMA);
    const capsules = buildOrchestrationEvaluationCases().map((entry) => entry.caseId);
    expect(capsules).toHaveLength(7);
    for (const caseId of capsules) expect(two, caseId).toContain(`\`${caseId}\``);
    for (const moved of ["app/lib/agent/__tests__/b11-3-generated-pcb-shape.test.ts", "app/lib/agent/__tests__/b11-4-capture-ownership.test.ts", "app/lib/agent/orchestration/__tests__/b21-e2b-trace-attribution.test.ts"]) {
      expect(two, moved).toContain(`\`${moved}\``);
      expect(read(moved), moved).toContain("[B21 F] reviewed pin move");
    }
    expect(read("artifacts/ai-control-plane-b21/run-events-and-trace.md")).toContain(sha("app/lib/agent/replay-capsule.ts"));
    expect(read("artifacts/ai-control-plane-b21/orchestration-contracts.md")).toMatch(/^\| C20 \| `app\/lib\/agent\/replay-capsule\.ts` \| 154 \| [^\n]*\[B21 F, 2026-09-28\]/m);
  });

  it("4. section 3 IS the live command's: its flags, its call bound and output-token bound, the command line; the state of the providers and LB-9; the live section is the LEAD's - reserved, or filled by the lead - and nowhere else on the page", async () => {
    const live = await import("../../../../../scripts/run-b21-live-orchestration-evaluation");
    const three = section(read(PAGE), 3);
    const text = flat(three);
    for (const claim of [live.LIVE_FLAG, live.LIVE_PROVIDER_FLAG, `\`LIVE_CALL_BOUND\``, `At most ${live.LIVE_CALL_BOUND} provider requests`, `SDK retries ${live.LIVE_SDK_MAX_RETRIES}`, "no provider disagreement and no provider fallback", "never reproduces a capsule's scripted fault", `at most ${live.LIVE_OUTPUT_TOKEN_BOUND} output tokens`, "scripts/run-b21-live-orchestration-evaluation.ts", "429 You have no credits remaining", "2026-09-24", "**UNKNOWN**", "LB-9", "**BLOCKED-LIVE-QUALIFICATION**", "Not a test (OD-102)"]) expect(text, claim).toContain(claim);
    expect(three).toContain("### The live run (for the lead)");
    const leadPart = three.slice(three.indexOf("### The live run (for the lead)"));
    expect(leadPart.includes("[LIVE SECTION - RESERVED FOR THE LEAD") || /Recorded by the lead/.test(leadPart)).toBe(true);
    expect(read(PAGE).split("[LIVE SECTION").length - 1).toBeLessThanOrEqual(1);
  });

  it("5. section 4's browser facts ARE the code's: the one web server's environment names no orchestration flag while the flag is read from the server's environment; with the flag on the router refuses \"Release the board.\" (T3-release) and routes scenario 4's sentence to the replacement DAG; the B18-E spec sends both; the installed Next locks its dev dist dir by default", () => {
    const four = flat(section(read(PAGE), 4));
    const config = read("playwright.config.ts");
    expect(config).not.toContain(ORCHESTRATION_ENABLED_ENV);
    expect(read("app/api/chat/orchestration-runtime.ts")).toContain("return environment[ORCHESTRATION_ENABLED_ENV] === \"1\";");
    expect(routeTaskComplexity("Release the board.", FACTS)).toMatchObject({ kind: "refused", rule: "T3-release" });
    expect(routeTaskComplexity(B21_F_SENTENCES.deleteReplace, FACTS)).toMatchObject({ kind: "dag", rule: "D-component-replacement" });
    const spec = read("e2e/agent-execution.spec.ts");
    expect(spec).toContain('await chat("Release the board.");');
    expect(spec).toContain(`await chat("${B21_F_SENTENCES.deleteReplace}");`);
    expect(readFileSync(join(ROOT, "node_modules/next/dist/server/config-shared.js"), "utf8")).toContain("lockDistDir: true");
    for (const claim of ["rule `T3-release`", "`lockDistDir: true`", "Another next dev server is already running.", "OD-30's 30-minute job", "(F4, F6, F12)"]) expect(four, claim).toContain(claim);
    for (const path of ["e2e/specialist-orchestration.spec.ts"]) expect(() => readFileSync(join(ROOT, path)), path).toThrow();
  });

  it("6. every citation resolves by content exactly once, ids run C1..Cn; for every production file F changed the cited line IS current and each is cited; every suite row names a file with the `it(` count it states; the three new suites ride the orchestration directory filter with no explicit CI entry", () => {
    const page = read(PAGE);
    const citations = pageCitations(page);
    expect(citations.length).toBeGreaterThanOrEqual(50);
    expect(citations.map((citation) => citation.id)).toEqual(citations.map((_, index) => `C${index + 1}`));
    const wrong = citations.filter((citation) => anchorOccurrences(ROOT, citation) !== 1).map((citation) => `${citation.id} ${citation.path}: ${anchorOccurrences(ROOT, citation)}`);
    expect(wrong).toEqual([]);
    for (const path of CHANGED) expect(citations.some((citation) => citation.path === path), path).toBe(true);
    const stale = citations.filter((citation) => !(read(citation.path).split(NEWLINE)[citation.line - 1] ?? "").includes(citation.anchor)).map((citation) => `${citation.id} ${citation.path}:${citation.line}`);
    expect(stale).toEqual([]);
    const rows = [...page.matchAll(/^\| `((?:app|e2e)\/[^`]+\.(?:test|spec)\.ts)` \| (\d+) \|/gm)];
    expect(rows.map((row) => row[1])).toEqual(expect.arrayContaining(SUITES));
    for (const row of rows) expect((read(row[1]!).match(/^\s*it\(/gm) ?? []).length, `${row[1]} it( blocks`).toBe(Number(row[2]));
    const workflow = read(".github/workflows/deterministic-manufacturing.yml");
    expect(workflow.match(/^ {10}app\/lib\/agent\/orchestration\/__tests__$/gm)).toHaveLength(2); expect(workflow.match(/^ {10}--exclude 'app\/lib\/agent\/orchestration\/__tests__\/\*\*'$/gm)).toHaveLength(1); // [PR-G, 2026-10-17] reviewed pin move (OD-250): was 1 - the filter is prompt-to-gerber's positional line and agent-boundary-suites' line, excluded from the first by its one --exclude and run by the second (ci-split.md section 4); still no explicit entry under it
    for (const suite of SUITES) expect(workflow, suite).not.toContain(suite);
  });

  it("7. what F does NOT do is stated, and the B11 files F left alone ARE the hashes the E2 page states (only the replay capsule moved, with its note): no production behaviour change, census 165, zero drift, no control, no run-event type or request key, no live call, no browser spec, no reserved-file edit", () => {
    const not = flat(section(read(PAGE), 5)).toLowerCase();
    for (const claim of ["no production behaviour change", "165 = 162 canonical + 3 factories + 0 raw", "zero drift", "no new ui control", "no b17-a rule change", "no b18-d wire", "no new run-event type", "request key", "no change to the v1 trace contract", "no live call", "no browser spec", "no reserved-file edit"]) expect(not, claim).toContain(claim);
    const e2 = read("artifacts/ai-control-plane-b21/run-events-and-trace.md");
    for (const file of B11_SCANNED_FILES.filter((path) => path !== "app/lib/agent/replay-capsule.ts")) expect(e2, file).toContain(sha(file));
    expect(e2).toContain(sha("app/lib/agent/redaction.ts"));
  });

  it("8. the \"For the lead\" section holds every reserved text in full: OD-125 applied, the README row for B21-F, the ledger paragraph, the PROGRAM_STATE texts (next the closeout), the discovery clauses - D21-23, D21-24 and D21-40 CLOSED, D21-25 RECORDED, D21-30's addendum, each title quoted exactly from discovery.md, and D21-43 new - the §10 line and the report line; no placeholder is left anywhere on the page but the lead's live section", () => {
    const page = read(PAGE);
    const lead = section(page, 7);
    expect(lead.length).toBeGreaterThan(6_000);
    expect(lead).toMatch(/^### OD-125 /m);
    for (const heading of ["README row", "ledger paragraph", "PROGRAM_STATE", "Discovery closure", "§10, B21-F"]) expect(lead, heading).toContain(heading);
    expect(lead).toMatch(/^\| B21-F /m);
    expect(lead).toMatch(/^### B21-F — /m);
    expect(lead).toMatch(/next the B21 closeout/);
    expect(lead).toContain("MULTI-AGENT STATUS");
    const discovery = read("artifacts/ai-control-plane-b21/discovery.md");
    for (const [defect, closure] of [["D21-23", "CLOSED by B21-F"], ["D21-24", "CLOSED by B21-F"], ["D21-25", "RECORDED by B21-F"], ["D21-30", "addendum by B21-F"], ["D21-40", "CLOSED by B21-F"]] as const) {
      const title = new RegExp(`\\*\\*${defect} — [^*]+\\*\\*`).exec(discovery)![0].replace(/\s+/g, " ");
      expect(flat(lead), defect).toContain(`- ${title} — ${closure}`);
    }
    // [B21 F fix: coverage-3] D21-44 too; [B21 F lead] a NEW defect is absent from discovery.md until the lead applies the records, then
    // inserted there ONCE under the title the page states (an absence-only pin would fail on every tree after the records)
    for (const defect of ["D21-43", "D21-44"]) {
      expect(lead, defect).toContain(`**${defect} — `);
      const inserted = discovery.split(`**${defect} — `).length - 1;
      expect(inserted, defect).toBeLessThanOrEqual(1);
      if (inserted === 1) expect(flat(lead), defect).toContain(`- ${new RegExp(`\\*\\*${defect} — [^*]+\\*\\*`).exec(discovery)![0].replace(/\s+/g, " ")}`);
    }
    for (const placeholder of ["TODO", "TBD", "G1_FILES", "ESLINT_RESULT"]) expect(page, placeholder).not.toContain(placeholder);
  });

  it("9. F's pin moves leave no statement silently false (the review's regressions-3, regressions-5, coverage-13): the B11 replay contract page, B11.4's ownership page and the B11.4 to B11.7 READMEs carry the dated note naming the capsule v4; every moved suite's title or comment that states the old version carries its [B21 F] note on that same line; and every line the B21 discovery cites in b11-3 still holds what it cites (F moved none)", () => {
    const NOTE = "[B21 F, 2026-09-28]";
    for (const doc of ["artifacts/ai-control-plane-b11/deterministic-replay-contract.md", "artifacts/ai-control-plane-b11-4/immutable-replay-ownership.md", "artifacts/ai-control-plane-b11-4/README.md", "artifacts/ai-control-plane-b11-5/README.md", "artifacts/ai-control-plane-b11-6/README.md", "artifacts/ai-control-plane-b11-7/README.md"]) {
      const text = read(doc);
      expect(text, doc).toContain(NOTE);
      expect(flat(text.slice(text.indexOf(NOTE))).slice(0, 600), doc).toContain(`\`${AGENT_REPLAY_CAPSULE_SCHEMA}\``);
    }
    const statements: ReadonlyArray<readonly [string, string]> = [
      ["app/lib/agent/__tests__/b11-4-capture-ownership.test.ts", 'it("the wire contract did NOT change in B11.4: the context is v2 and the capsule v4 (v3 when written'], // [B21 closeout, 2026-09-29] reviewed pin move: the title retitled (D21-27, OD-113), its [B21 F] note kept on its line
      ["app/lib/agent/__tests__/b11-4-capture-ownership.test.ts", "validates unchanged, so no version bump is warranted"],
      ["app/lib/agent/__tests__/b11-3-generated-pcb-shape.test.ts", 'it("the context is v2 and the capsule v4 (v3 when written'], // [B21 closeout, 2026-09-29] reviewed pin move: the title retitled (D21-27, OD-113), its [B21 F] note kept on its line
      ["app/lib/agent/orchestration/__tests__/b21-e2b-trace-attribution.test.ts", "/** sha256 of the nine B11-scanned files at HEAD 41330e6"],
      ["app/lib/agent/orchestration/__tests__/b21-e2b-trace-attribution.test.ts", 'it("8. the nine B11-scanned files hash to their pinned digests'], // [B21 closeout, 2026-09-29] reviewed pin move: the title retitled (D21-27, OD-113), its [B21 F] note kept on its line
      ["app/lib/agent/orchestration/__tests__/b21-e2b-page.test.ts", "(byte-identical to HEAD 41330e6 but the replay capsule"], // [B21 closeout, 2026-09-29] reviewed pin move: the title retitled (D21-27, OD-113), its [B21 F] note kept on its line
    ];
    for (const [path, statement] of statements) {
      const lines = read(path).split(NEWLINE).filter((line) => line.includes(statement));
      expect(lines, `${path}: ${statement}`).toHaveLength(1);
      expect(lines[0], `${path}: ${statement}`).toContain("[B21 F");
    }
    const discovery = read("artifacts/ai-control-plane-b21/discovery.md");
    for (const cited of ["`b11-3:741`", "`b11-3:743`", "`b11-3-generated-pcb-shape.test.ts:743-745`"]) expect(discovery, cited).toContain(cited);
    const b113 = read("app/lib/agent/__tests__/b11-3-generated-pcb-shape.test.ts").split(NEWLINE);
    expect(b113[740], "b11-3:741").toContain("INTENTIONAL_AGENT_EXPOSED_TOOL_IDS.length");
    expect(b113[742], "b11-3:743").toContain('for (const file of ["pcb-shape-projection.ts", "pcb-shape-types.ts", "replay-context.ts", "generated/pcb-shape-descriptor.ts"])');
    expect(b113[744], "b11-3:745").toContain(".not.toMatch(/modelcontextprotocol|mcpServer|spawnAgent|multiAgent/i)");
  });

  it("10. [B21 F2] section 4 IS the delivered browser proof (D21-43 decided): the orchestration config runs the base config's web server (imported, its environment spread) with the flag on its own origin and nothing else changed but the blanked role-model override, never reusing a server, with its own test dir, report and output folders (ignored by git), workers 1, retries 0 and the base's per-test timeout; the base config and e2e/ carry no flag; the spec's four tests (three when written; B21-F2b appended test 4) send the case table's sentences under their own namespace; the CI job runs it AFTER the existing suite and uploads both folders; the matrix's browser cells are the delivered classes", () => { // [B21 closeout, 2026-09-29] retitled (D21-27, OD-113): B21-F2b's fourth test; assertions unchanged
    const config = read(ORCHESTRATION_CONFIG);
    for (const line of ['import base from "./playwright.config";', 'testDir: "./e2e-orchestration",', "workers: 1,", "retries: 0,", "timeout: base.timeout,", 'outputDir: "test-results-orchestration",', 'outputFolder: "playwright-report-orchestration"', "reuseExistingServer: false,", "...baseServer,", "...baseServer.env,", `${ORCHESTRATION_ENABLED_ENV}: "1",`, `${ROLE_MODELS_ENV}: JSON.stringify({ "circuit-topology": { provider: "anthropic", model: "inherit" } }),`]) expect(config, line).toContain(line); // [B21 F2 fix: security-1] reviewed pin move: the role-model override was blanked ("") - one provider, one source; F6's two parties now run on two providers (case 12)
    const env = config.slice(config.indexOf("...baseServer.env,"), config.indexOf("},", config.indexOf("...baseServer.env,")));
    expect([...env.matchAll(/^\s+([A-Z][A-Z0-9_]+):/gm)].map((match) => match[1]), "the only keys over the base environment").toEqual(["SIRKIT_EXPECTED_ORIGIN", ORCHESTRATION_ENABLED_ENV, ROLE_MODELS_ENV]);
    expect(read("playwright.config.ts")).toContain('testDir: "./e2e",');
    for (const file of readdirSync(join(ROOT, "e2e")).filter((name) => name.endsWith(".ts"))) expect(read(`e2e/${file}`), file).not.toContain(ORCHESTRATION_ENABLED_ENV);
    const ignored = read(".gitignore").split(NEWLINE);
    for (const folder of ["/playwright-report/", "/test-results/", "/playwright-report-orchestration/", "/test-results-orchestration/"]) expect(ignored, folder).toContain(folder);
    const spec = read(BROWSER_SPEC);
    expect(spec.match(/^test\(/gm) ?? []).toHaveLength(4); // [B21 F2b, 2026-09-29] reviewed pin move: B21-F2 wrote three tests; B21-F2b appended test 4 (F12 presented, rejected, stood down and resumed in the browser: D21-45, the lead's option (a)) - this title's "three tests" is kept for the closeout's retitling; [B21 closeout, 2026-09-29] retitled
    expect(spec).toContain('from "../e2e/fixture-journey";');
    expect(spec).toContain('const EVIDENCE = "artifacts/ai-control-plane-b21/evidence";');
    const namespace = /const UUID_NAMESPACE = "([0-9a-f]{8})";/.exec(spec)?.[1];
    expect(namespace).toBeDefined();
    for (const file of readdirSync(join(ROOT, "e2e")).filter((name) => name.endsWith(".ts"))) expect(read(`e2e/${file}`), file).not.toContain(namespace!);
    for (const key of ["view3d", "timer", "timerBothSeal", "timeout"] as const) expect(spec, key).toContain(`B21_F_SENTENCES.${key}`);
    const workflow = read(".github/workflows/deterministic-manufacturing.yml").split(NEWLINE);
    const job = workflow.indexOf("  page-browser-e2e:");
    const existing = workflow.indexOf("      - run: pnpm exec playwright test");
    const orchestration = workflow.indexOf(`        run: pnpm exec playwright test -c ${ORCHESTRATION_CONFIG}`);
    const upload = workflow.indexOf("      - name: Upload browser evidence");
    expect(job).toBeGreaterThan(0);
    expect([existing > job, orchestration > existing, upload > orchestration]).toEqual([true, true, true]);
    expect(workflow.filter((line) => line.includes("playwright test")), "two browser runs, one after the other").toEqual(["      - run: pnpm exec playwright test", `        run: pnpm exec playwright test -c ${ORCHESTRATION_CONFIG}`, "        run: pnpm exec playwright test e2e/multi-tab.spec.ts e2e/crash-recovery.spec.ts e2e/keyboard-and-focus.spec.ts e2e/minimum-width.spec.ts"]); // [B24-D4, 2026-10-10] reviewed pin move: was toHaveLength(2); the two runs of page-browser-e2e, one after the other, and the third in the appended page-browser-e2e-b24 (OD-30's split), each line exactly; [B24-D4 lead, 2026-10-10] reviewed pin move: the third names the four specs (option (b): B24-D2's two, then B24-D3's two) in the job renamed from the draft's
    for (const folder of ["playwright-report", "test-results", "playwright-report-orchestration", "test-results-orchestration"]) expect(workflow.slice(upload), folder).toContain(`            ${folder}`);
    expect(B21_F_CASES.filter((entry) => entry.browser !== "not required").map((entry) => [entry.id, entry.browser])).toEqual([["F4", BROWSER_PROVEN], ["F6", BROWSER_PROVEN_IN_PART_F6], ["F12", BROWSER_PROVEN_F12]]); // [B21 F2 fix: security-1] reviewed pin move: F6 was BROWSER_PROVEN, but the browser cancels its review and never receives the envelope (case 12); [B21 F2b, 2026-09-29] reviewed pin move: F12 was BROWSER_PROVEN_IN_PART_F12 - test 4 now presents, rejects, stands down and resumes in the browser (D21-45 closed), so F12 is BROWSER_PROVEN_F12 (case 15)
    const four = flat(section(read(PAGE), 4));
    for (const claim of ["[B21 F2, 2026-09-28]", "DELIVERED by B21-F2", "`e2e-orchestration/specialist-orchestration.spec.ts`", `\`${ORCHESTRATION_CONFIG}\``, "`reuseExistingServer: false`", "one `next dev` at a time", "PULL-THROUGH", "F12 in part", "`already_presented`", "stay proven offline (case 12)", "Failing-first", "The budget (OD-30)"]) expect(four, claim).toContain(claim);
  });

  it("11. [B21 F2] no statement of the page is left saying the browser spec is stopped: the head, section 0's 'what it is not', section 1's class note and section 5 carry the dated F2 note; section 6 names the spec with its real test( count; section 7 holds F2's reserved texts in full - the README rows, the ledger paragraph, PROGRAM_STATE, D21-30 and D21-43 CLOSED quoting discovery's titles exactly, D21-40's browser clause and the §10 line", () => {
    const page = read(PAGE);
    const NOTE = "[B21 F2, 2026-09-28]";
    expect(page.slice(0, page.indexOf("## 0. ")), "the head").toContain(NOTE);
    const zero = section(page, 0);
    expect(zero.slice(zero.indexOf("- **What it is not:**")), "section 0").toContain(NOTE);
    const one = section(page, 1);
    expect(one.slice(0, one.indexOf("| id | runbook |")), "section 1's class note").toContain(NOTE);
    expect(section(page, 5), "section 5").toContain(NOTE);
    const row = new RegExp(`^\\| \`${BROWSER_SPEC}\` \\| (\\d+) \\|`, "m").exec(section(page, 6));
    expect(row, "section 6 names the browser spec").not.toBeNull();
    expect((read(BROWSER_SPEC).match(/^test\(/gm) ?? []).length).toBe(Number(row![1]));
    const lead = section(page, 7);
    const f2 = lead.slice(lead.indexOf("### B21-F2 — "));
    expect(lead.indexOf("### B21-F2 — "), "F2's reserved texts").toBeGreaterThan(0);
    for (const heading of ["README row", "ledger paragraph", "PROGRAM_STATE", "Discovery closure", "§10, B21-F2"]) expect(f2, heading).toContain(heading);
    expect(f2).toMatch(/^\| B21-F2 /m);
    expect(f2).toMatch(/^### B21-F2 — the browser spec/m);
    const discovery = read("artifacts/ai-control-plane-b21/discovery.md");
    for (const [defect, closure] of [["D21-30", "CLOSED by B21-F2 (the browser half)"], ["D21-43", "CLOSED by B21-F2"], ["D21-40", "addendum by B21-F2"]] as const) {
      const title = new RegExp(`\\*\\*${defect} — [^*]+\\*\\*`).exec(discovery)![0].replace(/\s+/g, " ");
      expect(flat(f2), defect).toContain(`- ${title} — ${closure}`);
    }
  });

  it("12. [B21 F2 fix: security-1, coverage-1, tests-01] F6's browser cell claims no more than the browser shows: the orchestration config routes the circuit specialist to the provider the page does not default to - two sources, as case 6 runs them - the spec asserts every role's provider and the escalation's two sources, and the cell is PROVEN IN PART naming what stays offline (the principal's approval: the browser cancels the review; the escalation's exact-authority citation: the follow-up's envelope, which the page never receives); no statement says F6 is PROVEN in the browser", async () => {
    const pageDefault = /const \[aiBrain, setAiBrain\] = useState<LLMProviderId>\("(openai|anthropic)"\);/.exec(read("app/page.tsx"))?.[1];
    expect(pageDefault, "the page's default provider: the coordinator's and every inheriting role's").toBeDefined();
    const other = pageDefault === "openai" ? "anthropic" : "openai";
    const { orchestration } = await loadWebServers();
    const routed = parseRoleModelOverrides(orchestration.roleModels);
    expect(routed, "the config's role override parses (a refused map approves nothing)").toMatchObject({ ok: true });
    expect(routed.ok ? routed.overrides : null, "ONE role routed: the circuit specialist on the OTHER provider; the schematic specialist inherits the page's").toEqual({ "circuit-topology": { provider: other, model: "inherit" } });
    const spec = read(BROWSER_SPEC);
    const two = spec.slice(spec.indexOf('test("[B21 F2] F6:'), spec.indexOf("test(\"[B21 F2] F12's"));
    expect(two, "the escalation counts two sources").toContain('"; 2 source(s);"');
    expect(spec, "never one").not.toContain("; 1 source(s);");
    expect(two.match(/\[event\.role, event\.provider\]/g) ?? [], "both requests' specialist_started providers asserted, role by role").toHaveLength(2);
    expect(two, "the page's own provider asserted").toContain(`.body.provider, "the page's default provider").toBe("${pageDefault}")`);
    const f6 = B21_F_CASES.find((entry) => entry.id === "F6")!;
    expect(f6.browser.startsWith("PROVEN IN PART: "), "F6 is PROVEN IN PART in the browser").toBe(true);
    for (const named of ["2 source(s)", "approval", "exact authority", "case 6"]) expect(f6.browser, named).toContain(named);
    const page = read(PAGE);
    for (const overclaim of ["F4 and F6 PROVEN", "F4 and F6 in the browser", "(F4, F6; F12 in part)"]) expect(flat(page), overclaim).not.toContain(overclaim);
    const four = flat(section(page, 4));
    for (const claim of ["F6 in part", "2 source(s)", "the principal's approval", "never receives"]) expect(four, claim).toContain(claim);
  });

  it("13. [B21 F2 fix: tests-05] the orchestration server's command IS the base config's: derived from the base web server's command with only its port moved to this config's, never a command of its own - a change to the base command reaches the orchestration server, and a base command without its port flag refuses to load", async () => {
    const normalized = (server: LoadedServer): string => server.command.replaceAll(`--port ${new URL(server.url).port}`, "--port <PORT>");
    const plain = await loadWebServers();
    expect(new URL(plain.orchestration.url).port, "its own port").not.toBe(new URL(plain.base.url).port);
    expect(new URL(plain.orchestration.url).pathname, "the base's readiness url, on its own origin").toBe(new URL(plain.base.url).pathname);
    expect(normalized(plain.orchestration), "the base's command, its port moved").toBe(normalized(plain.base));
    const probe = "--b21-f2-probe";
    const changed = await loadWebServers((command) => `${command} ${probe}`);
    expect(changed.base.command).toContain(probe);
    expect(changed.orchestration.command, "a change to the base command reaches the orchestration server").toContain(probe);
    expect(normalized(changed.orchestration)).toBe(normalized(changed.base));
    await expect(loadWebServers(() => "pnpm exec next dev"), "no port flag to move: the orchestration config refuses to load").rejects.toThrow(/--port/);
    // [B21 F2 lead] a DEFAULT base port (the URL omits it) still moves whole: never "--port 310180"
    const savedPort = process.env.SIRKIT_E2E_PORT; process.env.SIRKIT_E2E_PORT = "80";
    try {
      const onDefault = await loadWebServers();
      expect(onDefault.base.command).toContain("--port 80");
      expect(onDefault.orchestration.command, "the default port moved, never garbled").toBe(onDefault.base.command.replace("--port 80", `--port ${new URL(onDefault.orchestration.url).port}`));
      expect(onDefault.orchestration.command).not.toMatch(/--port \d*80(?![0-9])/);
    } finally { if (savedPort === undefined) delete process.env.SIRKIT_E2E_PORT; else process.env.SIRKIT_E2E_PORT = savedPort; }
    expect(read(ORCHESTRATION_CONFIG), "no command literal of its own").not.toMatch(/command:\s*[`"']/);
  });

  it("14. [B21 F2 fix: coverage-2] F12's browser remainder stays tracked once D21-43 closes: F2's reserved texts open D21-45 (new, low: no browser run presents a proposal and then stands down, so the rejected presentation and already_presented are observed only offline and test 3's nothing-presented checks cannot see a second presentation) with its options - absent from discovery.md or inserted there once under the title the page states; D21-43's closure, the §10 line, PROGRAM_STATE's nextAction, section 4 and F12's browser cell name it", () => {
    const page = read(PAGE);
    const lead = section(page, 7);
    const f2 = flat(lead.slice(lead.indexOf("### B21-F2 — ")));
    const clause = f2.slice(f2.indexOf("- **D21-45 — "), f2.indexOf("- **§10, B21-F2"));
    expect(f2.indexOf("- **D21-45 — "), "D21-45 opened among F2's discovery clauses").toBeGreaterThan(0);
    expect(f2.indexOf("- **D21-45 — "), "before the §10 line").toBeLessThan(f2.indexOf("- **§10, B21-F2"));
    for (const claim of ["Requirement:", "`:874`", "Finding:", "Severity low", "**CONFIRMED**", "Closes: the lead's decision - (a)", "(b)", "Source: B21-F2's adversarial review (coverage-2)"]) expect(clause, claim).toContain(claim);
    const discovery = read("artifacts/ai-control-plane-b21/discovery.md");
    const inserted = discovery.split("**D21-45 — ").length - 1;
    expect(inserted, "D21-45 is inserted into discovery.md at most once").toBeLessThanOrEqual(1);
    if (inserted === 1) expect(f2, "the title the page states").toContain(`- ${/\*\*D21-45 — [^*]+\*\*/.exec(discovery)![0].replace(/\s+/g, " ")}`);
    expect(f2.slice(f2.indexOf("- **D21-43 — "), f2.indexOf("- **D21-45 — ")), "D21-43's closure hands F12's browser remainder to D21-45").toContain("D21-45");
    expect(f2.slice(f2.indexOf("- **§10, B21-F2")), "the §10 line opens it").toContain("D21-45 opened (low");
    expect(f2.slice(f2.indexOf("`nextAction`:"), f2.indexOf("#### Discovery closure")), "PROGRAM_STATE's nextAction carries it").toContain("D21-45");
    expect(flat(section(page, 4)), "section 4 names it").toContain("D21-45");
    expect(B21_F_CASES.find((entry) => entry.id === "F12")!.browser, "F12's browser cell names where its remainder is tracked").toContain("D21-45");
  });

  it("15. [B21 F2b] F12 is PROVEN in the browser (D21-45 closed, the lead's option (a)): the scripted agent's ONE follow-up failure is the browser sentence's alone - keyed on it, overloaded 529 (case 12's vocabulary) - and that sentence routes to the replacement DAG, reaches the assistant from the composer and plays case 12's script; the spec's fourth test sends it, rejects through the review's own Cancel and asserts the stand-down, the offer, the resume, `already_presented` and one presentation in all, with its two evidence PNGs; F12's cell is PROVEN naming D21-45 closed; sections 2 and 4 state the failure, test 4, its failing-first and both wall times, every statement that said F12 is in part carries the dated note, and the offline suite has its row", () => {
    const NOTE = "[B21 F2b, 2026-09-29]";
    const key = fixtureSentenceKey(B21_F_SENTENCES.rejectResumeBrowser);
    expect(FIXTURE_FOLLOW_UP_FAILURES).toEqual([key]);
    expect(FIXTURE_FOLLOW_UP_FAILURE).toEqual({ reason: "overloaded", status: 529 });
    expect(FIXTURE_ROLE_SCRIPTS[key], "case 12's script").toEqual(FIXTURE_ROLE_SCRIPTS[fixtureSentenceKey(B21_F_SENTENCES.rejectResume)]);
    expect(routeTaskComplexity(B21_F_SENTENCES.rejectResumeBrowser, FACTS)).toMatchObject({ kind: "dag", rule: "D-component-replacement" });
    expect(routeComposerMessage(B21_F_SENTENCES.rejectResumeBrowser, true).route, "E4's composer asks the assistant").toBe("ask");
    const spec = read(BROWSER_SPEC);
    const head = 'test("[B21 F2b] F12 / D21-45:';
    expect(spec.indexOf(head), "test 4 follows test 3").toBeGreaterThan(spec.indexOf("test(\"[B21 F2] F12's"));
    const four = spec.slice(spec.indexOf(head));
    for (const claim of ["B21_F_SENTENCES.rejectResumeBrowser", 'name: "Cancel — change nothing" }).click();', '"the run stood down: its follow-up turn failed"', '"(provider_overloaded)"', "chatResumeOfferLine(runId, provider)", "chatResumingLine(runId)", "(already_presented): ", '"approval: already_presented."', '"one presentation across both requests"', "f12-presented-rejected-stood-down.png", "f12-resume-nothing-presented-again.png"]) expect(four, claim).toContain(claim);
    for (const png of ["f12-presented-rejected-stood-down.png", "f12-resume-nothing-presented-again.png"]) expect(readFileSync(join(ROOT, "artifacts/ai-control-plane-b21/evidence", png)).length, png).toBeGreaterThan(0);
    const f12 = B21_F_CASES.find((entry) => entry.id === "F12")!;
    expect(f12.browser).toBe(BROWSER_PROVEN_F12);
    for (const named of ["PROVEN: ", "tests 3 and 4", "D21-45 closed", "already_presented", "case 12"]) expect(f12.browser, named).toContain(named);
    const page = read(PAGE);
    expect(/^\| F12 \|.*$/m.exec(page)![0]).toContain("| PROVEN (section 4) |");
    const two = flat(section(page, 2));
    for (const claim of [NOTE, "`FIXTURE_FOLLOW_UP_FAILURES`", "HTTP 529", "`provider_overloaded`", "`already_presented`", "no line cited above moved"]) expect(two, claim).toContain(claim);
    const fourth = flat(section(page, 4));
    for (const claim of [`4. **${NOTE} F12, presented then stood down`, "Cancel — change nothing", "ONE presentation in all", `**${NOTE} Failing-first of test 4**`, `**${NOTE} The budget, after B21-F2b**`, "48 of 48", "4 of 4", "Superseded by B21-F2b"]) expect(fourth, claim).toContain(claim);
    // every statement that said F12 is in part carries the dated note
    expect(page.slice(0, page.indexOf("## 0. ")), "the head").toContain(NOTE);
    const zero = section(page, 0);
    expect(zero.slice(zero.indexOf("- **What it is not:**")), "section 0").toContain(NOTE);
    const one = section(page, 1);
    expect(one.slice(0, one.indexOf("| id | runbook |")), "section 1's class note").toContain(NOTE);
    const inPart = section(page, 4);
    expect(inPart.slice(inPart.indexOf("**F12 in part (RECORDED).**"), inPart.indexOf("**Failing-first.**")), "section 4's F12 in part note").toContain(NOTE);
    expect(section(page, 5), "section 5").toContain(NOTE);
    // the offline suite: its row in section 6 (case 6 checks its count) and the orchestration directory filter, no explicit CI entry
    const suite = "app/lib/agent/orchestration/__tests__/b21-f2b-follow-up-failure.test.ts";
    expect(section(page, 6).split(NEWLINE).some((line) => line.startsWith("| `" + suite + "` | ")), "section 6 names the offline suite").toBe(true);
    expect(read(".github/workflows/deterministic-manufacturing.yml")).not.toContain(suite);
  });

  it("16. [B21 F2b] B21-F2b's \"For the lead\" texts are in section 7 in full, once, after F2's: the README row, the ledger paragraph, the PROGRAM_STATE texts (next the B21 closeout; the nextAction the applied one with its B21-F2b clause removed, word for word), D21-45 CLOSED and D21-43's addendum, each quoting discovery's title exactly, and the §10 line", () => {
    const page = read(PAGE);
    const lead = section(page, 7);
    const HEADING = "### B21-F2b — the reserved texts, in full (the lead's to apply)";
    expect(page.split(HEADING).length - 1, "once").toBe(1);
    expect(lead.indexOf(HEADING), "after F2's texts").toBeGreaterThan(lead.indexOf("### B21-F2 — the reserved texts"));
    const f2b = lead.slice(lead.indexOf(HEADING));
    for (const heading of ["#### The README row", "#### The ledger paragraph", "#### PROGRAM_STATE.json", "#### Discovery closure clauses"]) expect(f2b, heading).toContain(heading);
    expect(f2b).toMatch(/^\| B21-F2b /m);
    expect(f2b).toMatch(/^### B21-F2b — the browser half of human rejection and resume /m);
    const flatF2b = flat(f2b);
    expect(flatF2b).toContain("next the B21 closeout");
    const discovery = read("artifacts/ai-control-plane-b21/discovery.md");
    for (const [defect, closure] of [["D21-45", "CLOSED by B21-F2b (the lead's option (a))"], ["D21-43", "addendum by B21-F2b"]] as const) {
      const title = new RegExp(`\\*\\*${defect} — [^*]+\\*\\*`).exec(discovery)![0].replace(/\s+/g, " ");
      expect(flatF2b, defect).toContain(`- ${title} — ${closure}`);
    }
    expect(flatF2b).toContain("- **§10, B21-F2b (recorded by the lead, 2026-09-29):** Section 4: D21-45 closed");
    // the nextAction: the one the lead applied, with its leading B21-F2b clause removed word for word (or, once applied, that one)
    const reserved = /`nextAction`: "([^"]+)"/.exec(flatF2b)![1]!;
    const applied = (JSON.parse(read("artifacts/remaining-builder-program/PROGRAM_STATE.json")) as { nextAction: string }).nextAction;
    expect(f2bNextActionIssues(reserved, applied)).toEqual([]); // [B21 F2b review: regressions-1, tests-1] the rule at module scope; case 17 drives it
  });

  it("17. [B21 F2b review: regressions-1, tests-1] case 16's nextAction rule lets the program move on, as the D page's case 9 does: the reserved nextAction is compared word for word only while the applied one still leads with its B21-F2b clause; the reserved text once the lead applied it, and any LATER state (the closeout's commit 2/2 writes state), pass; a reserved text that drops or changes a clause, or brings a B21-F2b clause back, still fails", () => {
    const lead = section(read(PAGE), 7);
    const reserved = /`nextAction`: "([^"]+)"/.exec(flat(lead.slice(lead.indexOf("### B21-F2b — the reserved texts, in full (the lead's to apply)"))))![1]!;
    expect(reserved.startsWith("The B21 closeout (")).toBe(true);
    // the states: before the lead applies F2b's texts (the applied one leads with the B21-F2b clause), F2b's applied, a later state's
    const before = `B21-F2b: the browser half of human rejection and resume (D21-45, option a); then the B21 closeout${reserved.slice("The B21 closeout".length)}`;
    const later = "The B22 chapter as the runbook assigns it (B21 merged: PR #11 undrafted, green CI, a normal merge); the one live run under OD-125 if credits exist";
    expect(f2bNextActionIssues(reserved, before), "before the lead applies F2b's texts").toEqual([]);
    expect(f2bNextActionIssues(reserved, reserved), "F2b's texts applied").toEqual([]);
    expect(f2bNextActionIssues(reserved, later), "a LATER state: the closeout's commit 2/2 writes state").toEqual([]);
    // it still bites while the clause stands, and a clause brought back fails in every state
    expect(f2bNextActionIssues(reserved.replace(" a tripwire;", ""), before), "a dropped clause").toHaveLength(1);
    expect(f2bNextActionIssues(reserved.replace("a normal merge", "a squash merge"), before), "a changed word").toHaveLength(1);
    const back = `${reserved}; B21-F2b: the browser half again`;
    for (const [state, applied] of [["before", before], ["applied", reserved], ["later", later]] as const) expect(f2bNextActionIssues(back, applied).length, `a B21-F2b clause brought back (${state})`).toBeGreaterThan(0);
  });

  it("18. [B21 F2b review: tests-4] the offline suite claims no rejection it does not drive: the human's rejection - the review's own Cancel, page-side - is proven in the browser alone (spec test 4, C115), so no case title or comment of `b21-f2b-follow-up-failure.test.ts` says the human rejects or that a Cancel applies nothing; its header and case 2 say where the rejection is proven, and case 2 still asserts what the server holds - the page's consumer receives the family's sealed proposal and nothing is applied, before and after the resume", () => {
    const suite = read("app/lib/agent/orchestration/__tests__/b21-f2b-follow-up-failure.test.ts");
    const OVERCLAIM = /\bthe human rejects\b|\bCancel applies nothing\b|\brejects it \(nothing applied\)/i;
    expect(suite.split(NEWLINE).filter((line) => OVERCLAIM.test(line)), "no title or comment claims an offline rejection").toEqual([]);
    const WHERE = "the human's rejection (the review's own Cancel) is page-side: the browser proves it, spec test 4";
    const header = suite.slice(0, suite.indexOf("*/"));
    expect(flat(header), "the header").toContain(WHERE);
    const two = suite.slice(suite.indexOf('it("2. '));
    expect(flat(two.slice(0, two.indexOf(NEWLINE))), "case 2's title").toContain(WHERE);
    expect(two.match(/expect\(receiveReplacementProposalEvent\(artifactsOf\(first\.events\)\[0\]!\)\)\.not\.toBeNull\(\);/g) ?? [], "the page's consumer receives the sealed proposal").toHaveLength(1);
    expect(two.match(/expect\(editor\.executed\(\)\)\.toBe\(0\);/g) ?? [], "nothing applied, before and after the resume").toHaveLength(2);
  });

  it("19. [B21 F2b review: regressions-2, tests-2, tests-3] the spec's test 4 cannot pass on a line an earlier test left on the ONE shared page (the spec is serial): it takes no `.last()` - every page line it claims that an earlier test also renders is COUNTED before and after among the chat's own lines (the transient toast, `role=\"status\"`, excluded); the discard line counts one up, no applied line appears; the status lines are literal counters through the page's builder (4 scheduled, 4 finished and ONE degraded notice; then 4 and 4), never the page's own reducer over the stream it received", () => {
    const spec = read(BROWSER_SPEC);
    const four = spec.slice(spec.indexOf('test("[B21 F2b] F12 / D21-45:'));
    expect(four.match(/\.last\(\)/g) ?? [], "no `.last()` in test 4").toEqual([]);
    expect(four, "no status line from the page's own reducer").not.toContain("reduceRunView");
    for (const claim of [
      `.and(page.locator('xpath=//*[not(ancestor-or-self::*[@role="status"])]'))`,
      "const discardedLines = chatLines(replacementChatLines.discarded());",
      'toHaveCount(discardedBefore + 1)', '"rejected: nothing applied"',
      "const appliedLines = chatLines(/^Replacement (?:(?:was already )?applied — |NOT applied: )/);",
      "toHaveCount(appliedBefore)",
      "orchestrationStatusLine({ ...initialRunView(), orchestrated: true, specialistsScheduled: 4, specialistsFinished: 4, specialistsDegraded: 1 })!",
      "toHaveCount(stoodDownStatusBefore + 1)",
      "const resumedStatusBefore = await chatLines(statusLine(4, 4)).count();",
      "toHaveCount(resumedStatusBefore + 1)",
    ]) expect(four, claim).toContain(claim);
    expect(four.split("toHaveCount(appliedBefore)").length - 1, "no applied line: after the Cancel and after the resume").toBe(2);
  });
});
