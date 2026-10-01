/**
 * [B21 E3] The route-level resume's page `route-resume.md`, pinned by content: its sections in order; the refusal table IS
 * `CHAT_RESUME_REFUSALS` (codes and statuses, in the order they are decided); the entry table IS `ORCHESTRATION_RESUME_KINDS` with the
 * keys `orchestrationResumeIdempotencyKey` builds; the bounds, the lease, the deadline, the withheld reasons, the stand-down and
 * transient lists and the lines quoted ARE the code's; the precise reason the first turn is not a `decision` record in B21-B's store
 * names the record's real kinds and text bound; every citation resolves by content exactly once and, for every production file E3
 * changed, on the line it states; every E3 suite row carries its real `it(` count and the orchestration suites ride the directory
 * filter while the route suite has its one explicit entry; what E3 does NOT do is stated; the texts for the lead are in full (the
 * discovery titles quoted VERBATIM); the earlier pages carry their dated E3 notes; every file E3 wrote is LF-only with no raw control
 * byte and no credential-shaped literal. No network, no model.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { anchorOccurrences, pageCitations } from "@/app/lib/mcp/server/__tests__/_citations";
import { ORCHESTRATION_BOUNDS } from "../contracts";
import { SPECIALIST_APPROVAL_OUTCOMES } from "../merge";
import {
  ORCHESTRATION_RECORD_KINDS, ORCHESTRATION_RESUME_AGGREGATE_TYPE, ORCHESTRATION_RESUME_ANSWER_WITHHELD, ORCHESTRATION_RESUME_BOUNDS, ORCHESTRATION_RESUME_KINDS,
  ORCHESTRATION_RESUME_RECORD_SCHEMA, orchestrationResumeIdempotencyKey,
} from "../store";
import { CHAT_RESUME_BODY_KEY, CHAT_RESUME_REFUSALS, CHAT_RUN_ID_PATTERN, RESUME_LEASE_MS, RESUME_RECORD_DEADLINE_MS, resumedRunLine, unrecordedFirstAnswer } from "@/app/api/chat/orchestration-runtime";
import { CHAT_RESUME_STAND_DOWN_REASONS, CHAT_RESUME_TRANSIENT_REFUSALS, chatResumeOfferLine, chatResumingLine } from "@/app/lib/project/chat-run-view";
import { TRACE_BOUNDS } from "@/app/lib/agent/trace";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");
const PAGE = "artifacts/ai-control-plane-b21/route-resume.md";
/** every production file E3 changed: its cited lines must be current */
const CHANGED_E3 = ["app/api/chat/route.ts", "app/api/chat/orchestration-runtime.ts", "app/lib/agent/orchestration/store.ts", "app/lib/agent/orchestration/merge.ts", "app/lib/agent/orchestration/scheduler.ts", "app/lib/project/chat-run-view.ts", "app/page.tsx"]; // [B21 E3 fix: security-2, coverage-2] + the scheduler (a route-level resume's replay rule)
const SUITES_E3 = [
  "app/lib/agent/orchestration/__tests__/b21-e3-resume-record.test.ts",
  "app/lib/agent/orchestration/__tests__/b21-e3-resume-runtime.test.ts",
  "app/lib/agent/orchestration/__tests__/b21-e3-resume-offer.test.ts",
  "app/lib/agent/orchestration/__tests__/b21-e3-page.test.ts",
];
const ROUTE_SUITE = "app/api/chat/__tests__/b21-e3-chat-resume.test.ts";
const MOVED = "app/lib/agent/orchestration/__tests__/b21-d2-approval.test.ts";
const NOTED_PAGES = ["artifacts/ai-control-plane-b21/task-complexity-router.md", "artifacts/ai-control-plane-b21/specialist-proposals.md", "artifacts/ai-control-plane-b21/specialist-replacement.md"];
/** every file E3 wrote or changed */
const WRITTEN = [...CHANGED_E3, ...SUITES_E3, ROUTE_SUITE, MOVED, PAGE, ...NOTED_PAGES, ".github/workflows/deterministic-manufacturing.yml"];
const SECTIONS = [
  "0. What E3 delivers", "1. The resume at the route", "2. The resume record", "3. The resumed run", "4. The userMessageDigest ledger (OD-122 across resumes)",
  "5. OD-130's part review from a production POST (D21-16's route half)", "6. \"Resume\" on the chat surface: a run-log line (OD-127)", "7. What E3 does NOT do",
  "8. Suites, evidence, the pin moves, gates", "9. For the lead — the reserved texts, in full", "10. Citations",
];
const quoted = (value: string): string => `\`${value}\``;
const flat = (text: string): string => text.replace(/\s+/g, " ");
const cells = (row: string): string[] => row.split(" | ").map((cell) => cell.replace(/^\| /, "").replace(/ \|$/, ""));
const ticks = (cell: string): string[] => [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1]!);
const section = (page: string, index: number): string => {
  const start = page.indexOf(`## ${SECTIONS[index]}`);
  const next = index + 1 < SECTIONS.length ? page.indexOf(`## ${SECTIONS[index + 1]}`) : -1;
  return start < 0 ? "" : page.slice(start, next > start ? next : undefined);
};

describe("[B21 E3] the route-resume page", () => {
  it("1. the title and the eleven sections in order; section 0 names what E3 delivers (the body key, the record, the replay against the LIVE head, the follow-up once, one request at a time, the ledger, OD-130's part review, the run-log line) and that the work was ADOPTED from an interrupted run", () => {
    const page = read(PAGE);
    expect(page.split(NEWLINE)[0]).toMatch(/^# B21-E3 — the route-level resume and the userMessageDigest ledger/);
    const headings = [...page.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
    expect(headings).toEqual(SECTIONS);
    const zero = flat(section(page, 0));
    for (const claim of [quoted(CHAT_RESUME_BODY_KEY), "`X-Sirkit-Run-Id`", "`ALLOWED_BODY_KEYS`", quoted(ORCHESTRATION_RESUME_AGGREGATE_TYPE), "REPLAYED from the record", "LIVE head", "runs ONCE", "one request of a run at a time", "`already_presented`", "`request_atomic_review`", "run-log line", "ADOPTED"]) expect(zero, claim).toContain(claim);
  });

  it("2. the refusal table IS `CHAT_RESUME_REFUSALS` - every code with its status, in the order the route decides them; the body key, the run-id grammar and the flag-off refusal are stated; the checks the wrapper makes first are named", () => {
    const page = read(PAGE);
    const one = section(page, 1);
    const rows = one.split(NEWLINE).filter((line) => /^\| `resume_[a-z_]+` \|/.test(line)).map(cells);
    expect(rows.map((row) => [ticks(row[0]!)[0], Number(row[1])])).toEqual(Object.entries(CHAT_RESUME_REFUSALS).map(([code, refusal]) => [code, refusal.status]));
    const text = flat(one);
    expect(text).toContain(quoted(CHAT_RUN_ID_PATTERN.source));
    for (const claim of ["`chatResumeBodyKeyAdmitted`", "refused exactly as HEAD refuses it", "identity", "live membership", "role", "CSRF", "before any provider call", "`resolveChatResume`", "`resumeChatRun`", "`userInstructionDigest`", "RECORDED"]) expect(text, claim).toContain(claim);
  });

  it("3. the entry table IS `ORCHESTRATION_RESUME_KINDS` with the key each entry commits under (`orchestrationResumeIdempotencyKey`); the aggregate, schema, bounds, withheld reasons, lease and deadline quoted ARE the code's; the precise reason the first turn is not a `decision` record in B21-B's store names the record's real kinds and its text bound", () => {
    const page = read(PAGE);
    const two = section(page, 2);
    const rows = two.split(NEWLINE).filter((line) => /^\| `[a-z-]+` \| `orchestration-resume:/.test(line)).map(cells);
    expect(rows.map((row) => ticks(row[0]!)[0])).toEqual([...ORCHESTRATION_RESUME_KINDS]);
    for (const [index, kind] of ORCHESTRATION_RESUME_KINDS.entries()) {
      const key = orchestrationResumeIdempotencyKey("<runId>", { kind, userMessageDigest: "<userMessageDigest>", ordinal: "<n>" as unknown as number });
      expect(ticks(rows[index]![1]!)[0], kind).toBe(key);
    }
    const text = flat(two);
    for (const value of [ORCHESTRATION_RESUME_AGGREGATE_TYPE, ORCHESTRATION_RESUME_RECORD_SCHEMA, ...ORCHESTRATION_RESUME_ANSWER_WITHHELD, "encodeResumeAnswer", "orchestrationResumeStoreOf", "AGENT_ORCHESTRATION_RESUME_MISMATCH"]) expect(text, value).toContain(quoted(value));
    expect(text).toContain(`${ORCHESTRATION_RESUME_BOUNDS.maxAnswerChars.toLocaleString("en-US").replace(",", " ")} characters`);
    expect(text).toContain(`at most ${ORCHESTRATION_RESUME_BOUNDS.maxOrdinal.toLocaleString("en-US").replace(",", " ")} requests`);
    const why = flat(two.slice(two.indexOf("**Why not a `decision` record in B21-B's store.**")));
    expect(two.indexOf("**Why not a `decision` record in B21-B's store.**")).toBeGreaterThan(0);
    expect(why).toContain(ORCHESTRATION_RECORD_KINDS.map(quoted).join(", "));
    expect(why).toContain(`${ORCHESTRATION_BOUNDS.maxTextChars.toLocaleString("en-US").replace(",", " ")} characters`);
    const three = flat(section(page, 3));
    expect(three).toContain(`\`RESUME_LEASE_MS\` (${RESUME_LEASE_MS.toLocaleString("en-US").replace(",", " ")} ms)`);
    expect(three).toContain(`\`RESUME_RECORD_DEADLINE_MS\` (${RESUME_RECORD_DEADLINE_MS.toLocaleString("en-US").replace(",", " ")} ms)`);
  });

  it("4. the lines and lists quoted ARE the code's: the resumed line and the placeholder (section 3), the approval outcome appended LAST (section 4), the stand-down reasons, the transient refusals, the offer and the resuming lines (section 6)", () => {
    const page = read(PAGE);
    const three = flat(section(page, 3));
    expect(three).toContain(resumedRunLine("<runId>", { answer: "(the answer)", answerWithheld: null }));
    expect(three).toContain(unrecordedFirstAnswer("answer_refused"));
    const four = flat(section(page, 4));
    expect(SPECIALIST_APPROVAL_OUTCOMES.at(-1)).toBe("already_presented");
    expect(four).toContain(SPECIALIST_APPROVAL_OUTCOMES.map(quoted).join(", "));
    const six = flat(section(page, 6));
    expect(six).toContain(CHAT_RESUME_STAND_DOWN_REASONS.map(quoted).join(", "));
    expect(six).toContain(CHAT_RESUME_TRANSIENT_REFUSALS.map(quoted).join(" and "));
    expect(six).toContain(chatResumeOfferLine("<runId>", "<provider>"));
    expect(six).toContain(chatResumingLine("<runId>"));
    for (const claim of ["no control", "B17-A", "B18-D"]) expect(six, claim).toContain(claim); // [B21 E3 fix: tests-9] no snapshot of the page's length
  });

  it("5. every citation resolves by content exactly once (ids C1..Cn in order) and, for every production file E3 changed, on the line it states; each changed file is cited", () => {
    const page = read(PAGE);
    const citations = pageCitations(page);
    expect(citations.length).toBeGreaterThanOrEqual(50);
    expect(citations.map((citation) => citation.id)).toEqual(citations.map((_, index) => `C${index + 1}`));
    expect(citations.filter((citation) => anchorOccurrences(ROOT, citation) !== 1).map((citation) => `${citation.id} ${citation.path}: ${anchorOccurrences(ROOT, citation)}`)).toEqual([]);
    for (const path of CHANGED_E3) expect(citations.some((citation) => citation.path === path), path).toBe(true);
    const stale = citations.filter((citation) => CHANGED_E3.includes(citation.path) && !(read(citation.path).split(NEWLINE)[citation.line - 1] ?? "").includes(citation.anchor)).map((citation) => `${citation.id} ${citation.path}:${citation.line}`);
    expect(stale).toEqual([]);
  });

  it("6. every E3 suite row carries its real `it(` count, the moved D2 suite included; the orchestration suites ride the directory filter with no explicit entry (the redundancy rule) and the route suite has exactly ONE explicit entry", () => {
    const page = read(PAGE);
    const rows = new Map([...page.matchAll(/^\| `((?:app|e2e)\/[^`]+\.(?:test|spec)\.tsx?)` \| (\d+) \|/gm)].map((row) => [row[1]!, Number(row[2])]));
    for (const suite of [...SUITES_E3, ROUTE_SUITE, MOVED]) {
      expect(rows.has(suite), suite).toBe(true);
      expect((read(suite).match(/^\s*it\(/gm) ?? []).length, `${suite} it( blocks`).toBe(rows.get(suite));
    }
    const workflow = read(".github/workflows/deterministic-manufacturing.yml");
    expect(workflow).toMatch(/^ {10}app\/lib\/agent\/orchestration\/__tests__$/m);
    for (const suite of SUITES_E3) expect(workflow, suite).not.toContain(suite);
    expect(workflow.match(/b21-e3-chat-resume\.test\.ts/g)).toHaveLength(1);
  });

  it("7. what E3 does NOT do is stated (section 7), and the texts for the lead are in full (section 9): OD-122 as applied across resumes, the OD-111 amendment, the README row, the ledger paragraph, PROGRAM_STATE naming B21-E4 next, the discovery closure clauses quoting D21-4's, D21-16's and D21-17's titles VERBATIM, the section-10 amendment and the report line", () => {
    const page = read(PAGE);
    const not = flat(section(page, 7)).toLowerCase();
    for (const claim of ["no composer routing", "no first-turn breaker", "b21-e4", "no new route", "165 = 162 canonical + 3 factories + 0 raw", "no new control", "no new run-event type", "no edit to the nine b11-scanned files", "`redaction.ts`", "no reserved-file edit", "`allowed_body_keys` itself is unchanged", "no cross-run ledger", "no change to the router"]) expect(not, claim).toContain(claim);
    const lead = section(page, 9);
    expect(lead).toMatch(/^### OD-122 .*across resumes.*\(B21-E3, 2026-09-27\)$/m);
    expect(lead).toMatch(/^### OD-111 .*\(B21-E3, 2026-09-27\)$/m);
    expect(lead).toMatch(/^\| B21-E3 /m);
    expect(lead).toMatch(/^### B21-E3 — /m);
    const text = flat(lead);
    expect(text).toContain("B21-E4");
    const discovery = flat(read("artifacts/ai-control-plane-b21/discovery.md"));
    for (const [defect, verdict] of [["D21-4", "CLOSED at the route by B21-E3"], ["D21-16", "the route half CLOSED by B21-E3"], ["D21-17", "the live-head half CLOSED by B21-E3"]] as const) {
      const title = new RegExp(`\\*\\*(${defect} — [^*]+)\\*\\*`).exec(discovery)?.[1];
      expect(title, defect).toBeTruthy();
      expect(text, defect).toContain(`**${title!}** — ${verdict}`);
    }
    expect(text).toContain("§10, B21-E3");
    expect(text).toContain("MULTI-AGENT STATUS");
  });

  it("8. the earlier pages carry their dated E3 notes (B's resume statements, D2's approval table and its route-level clause, D3's route half), and every file E3 wrote or changed is LF-only with no raw control, format or separator character and no credential-shaped literal", () => {
    for (const path of NOTED_PAGES) expect(read(path), path).toContain("[B21 E3, 2026-09-27]");
    expect(read("artifacts/ai-control-plane-b21/specialist-proposals.md")).toMatch(/^\| `already_presented` \| 9 \|/m);
    // [B21 E3 fix: tests-10] every control (C0 and C1), format and separator character - a TAB and a LF alone allowed
    const forbidden = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
    for (const file of WRITTEN) {
      const text = readFileSync(join(ROOT, file), "utf8");
      expect(forbidden.test(text.replaceAll(String.fromCharCode(9), "").replaceAll(NEWLINE, "")), file).toBe(false);
      expect(text, file).not.toMatch(/\bsk-(?:ant-)?[A-Za-z0-9]{20,}/);
    }
  });

  it("9. [B21 E3 fix: regressions-4] every line the page says is recorded on the trace states the recorder's SHARED warning bound beside it (TRACE_BOUNDS.maxWarnings: past it the trace records `trace_event_capacity_reached`, the stream keeps the line)", () => {
    const page = flat(read(PAGE));
    const bound = `the recorder's shared ${TRACE_BOUNDS.maxWarnings}-warning bound`;
    const claims = [...page.matchAll(/on the stream and the trace/g)].map((match) => match.index!);
    expect(claims.length).toBeGreaterThanOrEqual(3);
    for (const at of claims) expect(page.slice(at, at + 240), page.slice(Math.max(0, at - 80), at + 40)).toContain(bound);
  });

  it("10. [B21 E3 fix: coverage-6] the page's count of `app/page.tsx` lines changed in place IS the citation table's: section 6, the README row and the ledger paragraph say the number of `app/page.tsx` rows marked in place", () => {
    const page = read(PAGE);
    const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen"];
    const inPlace = pageCitations(page).filter((citation) => citation.path === "app/page.tsx" && /in place/.test(page.split(NEWLINE).find((line) => line.startsWith(`| ${citation.id} |`)) ?? "")).length;
    expect(inPlace).toBeGreaterThanOrEqual(10);
    const word = words[inPlace]!;
    expect(flat(section(page, 6))).toContain(`${word[0]!.toUpperCase()}${word.slice(1)} lines changed in place`);
    const lead = flat(section(page, 9));
    expect(lead.match(new RegExp(`\`(?:app/)?page\\.tsx\` \\(${word} lines in place, no control\\)`, "g"))).toHaveLength(2); // the README row (`app/page.tsx`) and the ledger paragraph (`page.tsx`)
    expect(flat(page)).not.toMatch(/\bnine lines\b/i);
  });
});
