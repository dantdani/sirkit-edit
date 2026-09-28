/**
 * [B21 F] The page `evaluation-matrix.md`, pinned by content: its sections, labels, base and tag; section 1's matrix IS the case table
 * (`_f-cases.ts`), row for row; section 2's scripted sentences, capsule id, category capsules and pin moves ARE the code's and the moved
 * files'; section 3's flags and spend bound ARE the live command's, and its live section is the lead's; section 4's browser facts ARE the
 * config's, the router's, the spec's and the installed Next's; every citation resolves by content exactly once and, for every production
 * file F changed, on the line it states; every suite row carries its real `it(` count; what F does not do is stated and the untouched B11
 * files are the hashes the E2 page states; and the "For the lead" texts are all present, the discovery titles quoted exactly.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { anchorOccurrences, pageCitations } from "@/app/lib/mcp/server/__tests__/_citations";
import { FIXTURE_RESULT_TOOL_NAME, FIXTURE_ROLE_SCRIPTS } from "@/app/lib/agent/fixture-agent-adapter";
import { AGENT_REPLAY_CAPSULE_SCHEMA } from "@/app/lib/agent/replay-capsule";
import { ORCHESTRATION_ENABLED_ENV } from "@/app/api/chat/orchestration-runtime";
import { SPECIALIST_RESULT_TOOL_NAME } from "../result-tool";
import { routeTaskComplexity } from "../router";
import { B11_SCANNED_FILES } from "../tripwires";
import { B21_F_CASES, B21_F_SENTENCES, BROWSER_BLOCKED, MODEL_IN_LOOP_LIVE_DAG, MODEL_IN_LOOP_NO_PATH, MODEL_IN_LOOP_SHAPE_ONLY } from "./_f-cases";
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
      expect(rest, entry.id).toContain(entry.browser === BROWSER_BLOCKED ? "| BLOCKED (section 4) |" : "| not required |");
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
    expect(workflow.match(/^ {10}app\/lib\/agent\/orchestration\/__tests__$/gm)).toHaveLength(1);
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
      ["app/lib/agent/__tests__/b11-4-capture-ownership.test.ts", 'it("the wire contract did NOT change: the committed versions are unchanged"'],
      ["app/lib/agent/__tests__/b11-4-capture-ownership.test.ts", "validates unchanged, so no version bump is warranted"],
      ["app/lib/agent/__tests__/b11-3-generated-pcb-shape.test.ts", 'it("the context is v2 and the capsule v3; older versions refuse EXPLICITLY"'],
      ["app/lib/agent/orchestration/__tests__/b21-e2b-trace-attribution.test.ts", "/** sha256 of the nine B11-scanned files at HEAD 41330e6"],
      ["app/lib/agent/orchestration/__tests__/b21-e2b-trace-attribution.test.ts", 'it("8. the nine B11-scanned files are byte-identical to HEAD'],
      ["app/lib/agent/orchestration/__tests__/b21-e2b-page.test.ts", "(byte-identical to HEAD 41330e6)"],
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
});
