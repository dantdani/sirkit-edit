/**
 * [B21 E2] The page `run-events-and-trace.md` (E2's first run), pinned by content: its sections, labels, base and tag; the event table
 * IS `ORCHESTRATION_RUN_EVENT_TYPES` with each type's `RUN_EVENT_KEYS`, the degraded-reason table IS `DEGRADED_REASONS`, the statuses
 * and the traced types ARE the code's lists, the line table maps B21-B's lines to events of the pinned list only; the status line
 * quoted IS `orchestrationStatusLine`'s and the bounds quoted ARE `RUN_EVENT_BOUNDS`; every citation resolves by content exactly once
 * and, for every file E2 changed, on the line it states; every suite row carries its real `it(` count and the route suite is admitted
 * to CI by one explicit entry; what E2 does NOT do and the STOP of the trace block are stated with the probe's own refusal; E1's page
 * carries its dated pointer here; and the "For the lead" texts are present. [B21 E2 fix] Cases 8 to 10 answer the adversarial review:
 * the A..E1 pages' dated E2 notes (regressions-3), the review's facts on the page (coverage-3, tests-4, coverage-5, security-2,
 * coverage-2, security-1, tests-2), chat-run-view.ts line-neutral where the discovery cites it and no raw control byte (tests-5, tests-6).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { anchorOccurrences, pageCitations } from "@/app/lib/mcp/server/__tests__/_citations";
import { DEGRADED_REASONS, ORCHESTRATION_RUN_EVENT_TYPES, SPECIALIST_FINISHED_STATUSES } from "@/app/lib/agent/contracts";
import { initialRunView, orchestrationStatusLine } from "@/app/lib/project/chat-run-view";
import { RUN_EVENT_BOUNDS, RUN_EVENT_KEYS, RUN_EVENT_TRACE_TYPES } from "../run-events";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8").replaceAll(`${String.fromCharCode(13)}${NEWLINE}`, NEWLINE);
const PAGE = "artifacts/ai-control-plane-b21/run-events-and-trace.md";
const BASE = "3a32317";
const ROUTE_SUITE = "app/api/chat/__tests__/b21-e2-chat-events.test.ts";
const SUITES = [
  "app/lib/agent/orchestration/__tests__/b21-e2-run-events.test.ts",
  "app/lib/agent/orchestration/__tests__/b21-e2-run-view.test.ts",
  "app/lib/agent/orchestration/__tests__/b21-e2-page.test.ts",
  ROUTE_SUITE,
];
/** every file E2 changed: its cited lines must be current */
const CHANGED = [
  "app/lib/agent/contracts.ts", "app/lib/agent/orchestration/run-events.ts", "app/lib/agent/orchestration/scheduler.ts", "app/api/chat/orchestration-runtime.ts",
  "app/lib/project/chat-run-view.ts", "app/page.tsx", ".github/workflows/deterministic-manufacturing.yml",
];
const quoted = (value: string): string => `\`${value}\``;
const section = (page: string, from: number): string => page.slice(page.indexOf(`## ${from}. `), page.indexOf(`## ${from + 1}. `) > 0 ? page.indexOf(`## ${from + 1}. `) : undefined);
const cells = (row: string): string[] => row.split(" | ").map((cell) => cell.replace(/^\| /, "").replace(/ \|$/, ""));
const ticks = (cell: string): string[] => [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1]!);
/** the prose with every run of whitespace one space (a sentence may wrap anywhere) */
const flat = (text: string): string => text.replace(/\s+/g, " ");

describe("[B21 E2] the run-events-and-trace page", () => {
  it("1. the page exists with its sections in order, its labels, its base, its tag, its scope (E2's first run; E3's items elsewhere) and the STOP of the trace block", () => {
    const page = read(PAGE);
    expect([...page.matchAll(/^## (\d+)\. /gm)].map((match) => Number(match[1]))).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(page).toMatch(new RegExp(`^## 7\\. Citations, as of base ${BASE}`, "m"));
    for (const label of ["CONFIRMED", "INFERRED", "RECORDED", "UNKNOWN", "BLOCKED-LIVE-QUALIFICATION"]) expect(page, label).toContain(label);
    expect(page).toContain("[B21 E2]");
    expect(page).toMatch(/^## 3\. The trace block \(OD-112\): STOPPED - D21-41, then APPLIED \(B21-E2 2\/2\)$/m); // [B21 E2b] pin move: the heading names the stop AND E2's second run's application (the stop's record stays whole below it as 3.1; case 6's claims on it unchanged)
    expect(flat(page)).toContain("the first-turn breaker are B21-E3's (a later run)");
  });

  it("2. the event table IS the pinned list with each type's closed key set, in order; the statuses, the degraded reasons (in order) and the traced types ARE the code's lists; the bounds quoted ARE RUN_EVENT_BOUNDS", () => {
    const events = section(read(PAGE), 1);
    const rows = events.split(NEWLINE).filter((line) => /^\| `[a-z_]+` \| /.test(line)).map(cells);
    const eventRows = rows.filter((row) => (ORCHESTRATION_RUN_EVENT_TYPES as readonly string[]).includes(ticks(row[0]!)[0]!));
    expect(eventRows.map((row) => ticks(row[0]!)[0])).toEqual([...ORCHESTRATION_RUN_EVENT_TYPES]);
    for (const row of eventRows) expect(ticks(row[1]!), row[0]).toEqual([...RUN_EVENT_KEYS[ticks(row[0]!)[0] as keyof typeof RUN_EVENT_KEYS]]);
    const reasonRows = rows.filter((row) => (DEGRADED_REASONS as readonly string[]).includes(ticks(row[0]!)[0]!));
    expect(reasonRows.map((row) => ticks(row[0]!)[0])).toEqual([...DEGRADED_REASONS]);
    for (const status of SPECIALIST_FINISHED_STATUSES) expect(events, status).toContain(quoted(status));
    const prose = flat(events);
    expect(prose).toContain("the first `ORCHESTRATION_TRACE_LINES_MAX` (12) status lines");
    expect(prose).toContain(`the runtime records the message of a ${RUN_EVENT_TRACE_TYPES.slice(0, -1).map(quoted).join(", ")} or ${quoted(RUN_EVENT_TRACE_TYPES.at(-1)!)} event`);
    const untraced = ORCHESTRATION_RUN_EVENT_TYPES.filter((type) => !RUN_EVENT_TRACE_TYPES.includes(type));
    expect(prose).toContain(`${untraced.map(quoted).join(" and ")}, which replace no B line, are stream-only`);
    const spaced = (value: number): string => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    expect(prose).toContain(`a message at most ${spaced(RUN_EVENT_BOUNDS.maxMessageChars)} characters and a reason at most ${spaced(RUN_EVENT_BOUNDS.maxReasonChars)}`);
    expect(prose).toContain(`a model id at most ${RUN_EVENT_BOUNDS.maxModelChars} characters`);
  });

  it("3. the line table maps each of B21-B's plan, status and stand-down lines to an event of the pinned list, and the refusal, merge and approval lines to `warning` - nothing else", () => {
    const events = section(read(PAGE), 1);
    const table = events.slice(events.indexOf("| B21-B's line (its opening) | now |"));
    const rows = table.split(NEWLINE).slice(2).filter((line) => line.startsWith("| ")).map(cells);
    expect(rows.length).toBeGreaterThanOrEqual(10);
    for (const row of rows) expect([...ORCHESTRATION_RUN_EVENT_TYPES, "warning"], row[0]).toContain(ticks(row[1]!)[0]);
    expect(rows.filter((row) => ticks(row[1]!)[0] === "warning").map((row) => row[0])).toEqual([expect.stringContaining("refused: <status>"), expect.stringContaining("presented for approval")]);
  });

  it("4. the status line quoted IS orchestrationStatusLine's for the counters the page states", () => {
    const state = { ...initialRunView(), orchestrated: true, specialistsScheduled: 3, specialistsFinished: 3, specialistsDegraded: 1, partialResult: { usable: 3, planned: 4 } };
    expect(section(read(PAGE), 2)).toContain(quoted(orchestrationStatusLine(state)!));
  });

  it("5. every citation resolves by content exactly once, ids run C1..Cn; for every file E2 changed the cited line IS current and each is cited; every suite row names a file with the `it(` count it states; the route suite is admitted to CI by one explicit entry", () => {
    const page = read(PAGE);
    const citations = pageCitations(page);
    expect(citations.length).toBeGreaterThanOrEqual(50);
    expect(citations.map((citation) => citation.id)).toEqual(citations.map((_, index) => `C${index + 1}`));
    const wrong = citations.filter((citation) => anchorOccurrences(ROOT, citation) !== 1).map((citation) => `${citation.id} ${citation.path}: ${anchorOccurrences(ROOT, citation)}`);
    expect(wrong).toEqual([]);
    for (const path of CHANGED) expect(citations.some((citation) => citation.path === path), path).toBe(true);
    const stale = citations.filter((citation) => CHANGED.includes(citation.path) && !(read(citation.path).split(NEWLINE)[citation.line - 1] ?? "").includes(citation.anchor)).map((citation) => `${citation.id} ${citation.path}:${citation.line}`);
    expect(stale).toEqual([]);
    const rows = [...page.matchAll(/^\| `((?:app|e2e)\/[^`]+\.(?:test|spec)\.tsx?)` \| (\d+) \|/gm)];
    expect(rows.map((row) => row[1])).toEqual(expect.arrayContaining(SUITES));
    for (const row of rows) expect((read(row[1]!).match(/^\s*it\(/gm) ?? []).length, `${row[1]} it( blocks`).toBe(Number(row[2]));
    expect(read(".github/workflows/deterministic-manufacturing.yml")).toMatch(/^ {10}app\/api\/chat\/__tests__\/b21-e2-chat-events\.test\.ts$/m);
  });

  it("6. what E2's first run does NOT do is stated, and the STOP of the trace block with the probe's own refusal, the held work and its hashes; E1's page points here with a dated note and keeps its sentence", () => {
    const page = read(PAGE);
    const not = section(page, 4).toLowerCase();
    for (const claim of ["no trace block", "no route-level resume", "no composer routing", "no first-turn breaker", "no evaluations", "no new ui control", "no new route", "no new exposed tool", "no request key", "no change to protocol version 1", "no edit to the nine b11-scanned files", "no change to the redaction authority", "no reserved-file edit", "165 = 162 canonical + 3 factories + 0 raw"]) expect(not, claim).toContain(claim);
    const stop = section(page, 3);
    for (const claim of ["`trace.runId: contains secret-shaped content`", "`trace_validation_failure`", "`ta[redacted]`", "`b21/e2/trace-block-held/`", "`held.sha256`", "**D21-41**", "**UNVERIFIED**", "task-<n>-<role>"]) expect(stop, claim).toContain(claim);
    const e1 = read("artifacts/ai-control-plane-b21/provider-routing-and-failure.md");
    expect(e1).toContain("This page holds the E1 sections; B21-E2");
    expect(e1).toContain("[B21 E2, 2026-09-27] E2's first run (the additive run events and the status line; the trace block stopped - D21-41) is on\nits own page, `run-events-and-trace.md`");
  });

  it("7. the \"For the lead\" section holds every reserved text in full: OD-126 and OD-127 as applied, OD-112 stopped with the owner's options, the README row, the ledger paragraph, the PROGRAM_STATE texts, the discovery clauses (D21-22 closed; D21-11 and D21-3 addenda; D21-41 new) and the section-10 line", () => {
    const lead = section(read(PAGE), 6);
    expect(lead.length).toBeGreaterThan(8_000);
    for (const od of ["OD-126", "OD-127"]) expect(lead).toMatch(new RegExp(`^### ${od} .*as applied \\(B21-E2, 2026-09-27\\)$`, "m"));
    expect(lead).toMatch(/^### OD-112 .*NOT applied - stopped \(B21-E2, 2026-09-27\)$/m);
    for (const option of ["(A) anchor", "(B) the per-task trace run id", "(C) a task-id grammar", "(D) editing the scanned validator"]) expect(lead, option).toContain(option);
    for (const heading of ["The README row", "The ledger paragraph", "PROGRAM_STATE.json", "Discovery closure clauses", "§10, B21-E2 (1/2) amendment"]) expect(lead, heading).toContain(heading);
    expect(lead).toMatch(/^\| B21-E2 \(1\/2\) /m);
    expect(lead).toMatch(/^### B21-E2 \(1\/2\) — /m);
    expect(lead).toMatch(/\*\*D21-22 [^*]*\*\* — CLOSED\s+by B21-E2/);
    for (const defect of ["D21-11", "D21-3"]) expect(lead).toMatch(new RegExp(`\\*\\*${defect} [^*]*\\*\\* — addendum by B21-E2`));
    expect(lead).toMatch(/\*\*D21-41 \(new, medium\)/);
    expect(lead).toContain("MULTI-AGENT STATUS");
  });

  it("8. [B21 E2 fix: regressions-3] every A..E1 statement E2 made untrue carries a dated E2 note IN ITS OWN BLOCK (paragraph or bullet) naming this page: B's 'Not in B' paragraph (the run log's warning channel), its degraded-mode sentence and its **Warnings** bullet (the plan, status and STALE lines), C's not-run 'visible warning', D2's held-artifact line", () => {
    const note = "[B21 E2, 2026-09-27]";
    /** the paragraph or bullet holding the claim: a block starts at a blank line, a bullet, a table row or a heading */
    const blockWith = (path: string, claim: string): string => {
      const blocks: string[] = [];
      for (const line of read(path).split(NEWLINE)) {
        if (line.trim() === "" || /^(?:- |\| |#)/.test(line)) blocks.push("");
        blocks[blocks.length - 1] = `${blocks.at(-1) ?? ""} ${line}`;
      }
      return blocks.find((block) => flat(block).includes(claim)) ?? "";
    };
    const claims: Array<[string, string]> = [
      ["artifacts/ai-control-plane-b21/task-complexity-router.md", "here the run log's `warning` channel carries one line per scheduled specialist, one plan line"],
      ["artifacts/ai-control-plane-b21/task-complexity-router.md", "degraded mode is a visible warning naming the closed reason only"],
      ["artifacts/ai-control-plane-b21/task-complexity-router.md", "**Warnings**: the run log's `warning` channel carries one plan line"],
      ["artifacts/ai-control-plane-b21/specialist-roles.md", "and one visible warning names it"],
      ["artifacts/ai-control-plane-b21/specialist-proposals.md", "one line on the stream (`COORDINATOR_ARTIFACT_HELD_LINE`, C61)"],
    ];
    for (const [path, claim] of claims) {
      const block = flat(blockWith(path, claim));
      expect(block, `${path}: ${claim}`).toContain(claim);
      expect(block, `${path}: ${claim}`).toContain(note);
      expect(block, `${path}: ${claim}`).toContain("`run-events-and-trace.md`");
    }
  });

  it("9. [B21 E2 fix: coverage-3, tests-4, coverage-5, security-2, coverage-2, security-1, tests-2] the page and its lead texts say what the review found: OD-126 records that an older v1 page loses the plan, status and stand-down lines, with the owner's options (the warning beside the event, or a protocol v2); the D21-22 clause quotes the defect's title VERBATIM from discovery.md and names how each item is met, the budget remaining included; the run-events header claims no more than the code does (an undeclared key's model-chosen name withheld); a replayed or stale result names no provider; the partial result counts what the merge withheld; a withheld re-run is closed", () => {
    const page = read(PAGE);
    const lead = flat(section(page, 6));
    const od126 = flat(lead.slice(lead.indexOf("### OD-126"), lead.indexOf("### OD-127")));
    for (const claim of ["an OLDER v1 page", "loses", "the warning beside the event", "protocol v2"]) expect(od126, claim).toContain(claim);
    expect(od126).not.toContain("an older reducer and the pre-E2 page ignore the five (their `default`). Proven");
    const discovery = flat(read("artifacts/ai-control-plane-b21/discovery.md"));
    const title = /\*\*(D21-22 — [^*]+)\*\*/.exec(discovery)?.[1];
    expect(title).toMatch(/a budget remaining or a degraded mode/);
    expect(lead).toContain(`**${title!}** — CLOSED by B21-E2`);
    const clause = lead.slice(lead.indexOf(`**${title!}**`), lead.indexOf("**D21-11"));
    for (const item of ["`plan`", "`specialist_started`", "`specialist_finished`", "`partial_result`", "`degraded`", "`wallTimeRemainingMs`", "`outputTokensRemaining`", "RECORDED: provider streaming"]) expect(clause, item).toContain(item);
    const header = read("app/lib/agent/orchestration/run-events.ts").split("*/")[0]!;
    expect(header).not.toContain("never model text");
    expect(flat(header)).toContain("an undeclared key");
    const events = flat(section(page, 1));
    for (const claim of ["`UNDECLARED_KEY_WITHHELD`", "`provider` is null", "`mergeWithheld`", "`wallTimeRemainingMs`", "was not run again"]) expect(events, claim).toContain(claim);
    expect(events).not.toContain("a reason is the scheduler's closed dissent reason, never model text");
  });

  it("10. [B21 E2 fix: tests-5, tests-6] chat-run-view.ts is line-neutral against the base where the discovery cites it (the additive code is appended): each cited line holds what it held at base 3a32317 - the initial view, the reducer's comment and signature, its default, the projection, the restored-entry helpers; and every file E2 wrote or changed is LF-only with no raw control, format or line-separator character (such a character in a test is written with String.fromCharCode)", () => {
    const view = read("app/lib/project/chat-run-view.ts").split(NEWLINE);
    const held: Array<[number, string]> = [
      [115, "export const initialRunView = (): RunViewState => ({ answer: \"\", interim: [],"], [117, "/** Fold one raw run event (as the page receives it) into the run view. Unknown events change nothing. */"],
      [118, "export function reduceRunView(state: RunViewState, event: Record<string, unknown>): RunViewState {"], [147, "    default:"], [148, "      return "], [150, "}"],
      [161, "export function projectRunView(state: RunViewState): RunViewProjection {"], [185, "}"], [514, "export const RESTORED_UNDO_HINTS = Object.freeze({"],
      [519, "export function restoredEntryLog<M extends { id: string; entries: ReadonlyArray<{ id: string; text: string }> }>(message: M): M {"], [527, "}"],
    ];
    for (const [line, text] of held) expect(view[line - 1]!.startsWith(text), `chat-run-view.ts:${line} ${view[line - 1]}`).toBe(true);
    const discovery = read("artifacts/ai-control-plane-b21/discovery.md");
    for (const citation of ["chat-run-view.ts:117-118, :147-148", "chat-run-view.ts:514-527", "`reduceRunView` `:117-150`, `projectRunView` `:161-185`", "chat-run-view.ts:117-185", "chat-run-view.ts:519-527", "chat-run-view.ts:115, :117-150"]) expect(discovery, citation).toContain(citation);
    const codes = [...Array.from({ length: 32 }, (_, code) => code).filter((code) => code !== 9 && code !== 10), 0x7f, 0x2028, 0x2029]; // the lead's commit rule (no control byte but TAB and LF), a CR, DEL and the two Unicode line separators
    const forbidden = new RegExp(`[${codes.map((code) => String.fromCharCode(code)).join("")}]`);
    const files = [...CHANGED, ...SUITES, PAGE, "app/lib/agent/orchestration/__tests__/_e2-fixtures.ts", "app/lib/agent/orchestration/__tests__/_e1-fixtures.ts", "artifacts/ai-control-plane-b21/task-complexity-router.md", "artifacts/ai-control-plane-b21/specialist-roles.md", "artifacts/ai-control-plane-b21/specialist-proposals.md", "artifacts/ai-control-plane-b21/provider-routing-and-failure.md"];
    for (const file of files) expect(forbidden.test(readFileSync(join(ROOT, file), "utf8")), file).toBe(false);
  });
});
