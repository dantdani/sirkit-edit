/**
 * [B21 B] The page `task-complexity-router.md`, pinned by content: the router's rule table equals the router's data (rule, kind,
 * runbook line, role list), the caps table equals the scheduler's constants, the flag name, the build-multi source hash, the
 * scheduler's refusal and status vocabularies, every citation resolves exactly once, every suite row carries its real `it(`
 * count, the proof order is stated with the case that proves each step, and the "For the lead" texts are all present.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { anchorOccurrences, pageCitations } from "@/app/lib/mcp/server/__tests__/_citations";
import { ORCHESTRATION_ENABLED_ENV } from "@/app/api/chat/orchestration-runtime";
import { DAG_ROLE_LISTS, ROUTER_RULES, TIER3_FAMILIES, TIER3_REFUSAL_SENTENCE } from "../router";
import { SCHEDULER_REFUSALS, SCHEDULER_STOPS, SPECIALIST_CAPS, SPECIALIST_REFUSAL_STATUS, SPECIALIST_TASK_STATUSES } from "../scheduler";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8").replaceAll(`${String.fromCharCode(13)}${NEWLINE}`, NEWLINE);
const PAGE = "artifacts/ai-control-plane-b21/task-complexity-router.md";
const BASE = "4b6d0e2";
const SUITES = [
  "app/lib/agent/orchestration/__tests__/b21-b-router.test.ts",
  "app/lib/agent/orchestration/__tests__/b21-b-scheduler.test.ts",
  "app/api/chat/__tests__/b21-b-chat-router.test.ts",
  "app/lib/agent/orchestration/__tests__/b21-b-page.test.ts",
  "app/lib/agent/orchestration/__tests__/b21-a-import-gates.test.ts",
];
const quoted = (value: string): string => `\`${value}\``;

describe("[B21 B] the task-complexity-router page", () => {
  it("1. the page exists with its sections in order, its labels, its base and its tag", () => {
    const page = read(PAGE);
    const headings = [...page.matchAll(/^## (\d+)\. /gm)].map((match) => Number(match[1]));
    expect(headings).toEqual(headings.map((_, index) => index));
    expect(headings.length).toBeGreaterThanOrEqual(8);
    expect(page).toMatch(new RegExp(`^## ${headings.length - 1}\\. Citations, as of base ${BASE}`, "m"));
    for (const label of ["CONFIRMED", "RECORDED", "INFERRED", "UNKNOWN", "BLOCKED-LIVE-QUALIFICATION"]) expect(page, label).toContain(label);
    expect(page).toContain("[B21 B]");
  });

  it("2. the rule table IS the router's data: one row per rule with its id, kind, runbook line and role list, in the router's order; the Tier 3 family words and the refusal sentence are quoted; the five role lists are on the page", () => {
    const page = read(PAGE);
    const rows = [...page.matchAll(/^\| `([A-Za-z0-9-]+)` \| (single|refused|dag) \| ([^|]+?) \| ([^|]+?) \|$/gm)].map((row) => ({ id: row[1]!, kind: row[2]!, runbook: row[3]!.trim(), roles: row[4]!.trim() }));
    expect(rows.map((row) => row.id)).toEqual(ROUTER_RULES.map((rule) => rule.id));
    for (const [index, rule] of ROUTER_RULES.entries()) {
      const row = rows[index]!;
      expect(row.kind, rule.id).toBe(rule.kind);
      expect(row.runbook, rule.id).toBe(rule.runbook);
      expect(row.roles, rule.id).toBe(rule.roles ? rule.roles.map(quoted).join(", ") : "—");
    }
    for (const entry of TIER3_FAMILIES) for (const word of entry.words) expect(page, word).toContain(quoted(word));
    expect(page).toContain(TIER3_REFUSAL_SENTENCE);
    for (const [shape, roles] of Object.entries(DAG_ROLE_LISTS)) { expect(page, shape).toContain(quoted(shape)); expect(page, shape).toContain(roles.map(quoted).join(", ")); }
  });

  it("3. the caps table equals SPECIALIST_CAPS; the token-ceiling formula, the flag (exactly \"1\", default off), the scheduler's refusal, stop and status vocabularies, the read-only refusal status, the build-multi source hash (equal to the file's sha256 today) and the resume and cancellation semantics are on the page", () => {
    const page = read(PAGE);
    const caps = Object.fromEntries([...page.matchAll(/^\| `([a-zA-Z]+)` \| ([\d ]+) \|/gm)].map((row) => [row[1]!, Number(row[2]!.replaceAll(" ", ""))]));
    for (const [key, value] of Object.entries(SPECIALIST_CAPS)) expect(caps[key], key).toBe(value);
    expect(page).toContain("6 × (2 + 2 × specialists) × 4 096");
    expect(page).not.toContain("6 × (1 + specialists) × 4 096");
    expect(page).toContain(quoted(ORCHESTRATION_ENABLED_ENV));
    expect(page).toMatch(/exactly `"1"`/);
    expect(page).toMatch(/default(?:s)? (?:is |to )?off/i);
    for (const value of [...SCHEDULER_REFUSALS, ...SCHEDULER_STOPS, ...SPECIALIST_TASK_STATUSES, SPECIALIST_REFUSAL_STATUS]) expect(page, value).toContain(quoted(value));
    const sha256 = createHash("sha256").update(readFileSync(join(ROOT, "app/api/schematic/build-multi/route.ts"))).digest("hex");
    expect(page).toContain(sha256);
    for (const claim of ["resume", "cancellation", "`escalated`", "`cancelled`", "`deadline`", "`malformed`", "never re-runs", "insufficient_quota", "replayed"]) expect(page, claim).toContain(claim);
  });

  it("4. the proof order of discovery §9 is stated with the case that proves each step, and what B does NOT do is stated", () => {
    const page = read(PAGE);
    const order = page.slice(page.indexOf("## 2. "), page.indexOf("## 3. "));
    expect(order).toMatch(/Tier 0\/1/);
    expect(order).toMatch(/3D\/view/);
    expect(order).toMatch(/Tier 3/);
    expect(order).toMatch(/b21-b-router\.test\.ts/);
    expect(order).toMatch(/b21-b-chat-router\.test\.ts/);
    expect(order).toMatch(/no provider call/i);
    expect(order).toMatch(/byte-identical/);
    for (const claim of ["no per-role tool subset", "no merge", "no provider routing", "no new run events", "no UI", "no new route", "no new exposed tool"]) expect(page.toLowerCase(), claim).toContain(claim.toLowerCase());
    expect(page).toContain("strict result tool");
    expect(page).toContain("B21-E");
  });

  it("5. every citation resolves by content exactly once, ids run C1..Cn; every suite row names a file that exists with the `it(` count it states; the five modules of the increment and the route are cited", () => {
    const page = read(PAGE);
    const citations = pageCitations(page);
    expect(citations.length).toBeGreaterThanOrEqual(12);
    expect(citations.map((citation) => citation.id)).toEqual(citations.map((_, index) => `C${index + 1}`));
    const wrong = citations.filter((citation) => anchorOccurrences(ROOT, citation) !== 1).map((citation) => `${citation.id} ${citation.path}: ${anchorOccurrences(ROOT, citation)}`);
    expect(wrong).toEqual([]);
    for (const path of ["app/lib/agent/orchestration/router.ts", "app/lib/agent/orchestration/scheduler.ts", "app/api/chat/orchestration-runtime.ts", "app/api/chat/route.ts", "app/lib/engineering/permission-tiers.ts", "app/lib/project/composer-routing.ts", "app/lib/agent/loop.ts", "app/api/schematic/build-multi/route.ts"]) {
      expect(citations.some((citation) => citation.path === path), path).toBe(true);
    }
    const rows = [...page.matchAll(/^\| `((?:app|e2e)\/[^`]+\.(?:test|spec)\.ts)` \| (\d+) \|/gm)];
    expect(rows.map((row) => row[1])).toEqual(expect.arrayContaining(SUITES));
    for (const row of rows) {
      const blocks = (read(row[1]!).match(/^\s*it\(/gm) ?? []).length;
      expect(blocks, `${row[1]} it( blocks`).toBe(Number(row[2]));
    }
    expect(page).toContain("app/api/chat/__tests__/b21-b-chat-router.test.ts");
    expect(read(".github/workflows/deterministic-manufacturing.yml")).toMatch(/^ {10}app\/api\/chat\/__tests__\/b21-b-chat-router\.test\.ts$/m);
  });

  it("6. the \"For the lead\" section holds every reserved text in full: OD-107, OD-110 and OD-122 as applied, OD-106's tripwire statement, the README row, the ledger paragraph, the PROGRAM_STATE texts, the discovery closure clauses for D21-4, D21-5, D21-6 and D21-17 (wall-time clause), A's deviation closed, and the new finding D21-33", () => {
    const page = read(PAGE);
    const start = page.indexOf("## 7. ");
    const end = page.indexOf("## 8. ");
    expect(start).toBeGreaterThan(0);
    const lead = page.slice(start, end);
    expect(lead.length).toBeGreaterThan(4_000);
    for (const od of ["OD-106", "OD-107", "OD-110", "OD-122"]) expect(lead).toMatch(new RegExp(`^### ${od} `, "m"));
    expect(lead).toMatch(/at most 4 specialists/i);
    expect(lead).toMatch(/parallelism 1/i);
    expect(lead).toMatch(/300 s/);
    for (const heading of ["README row", "ledger paragraph", "PROGRAM_STATE", "discovery closure"]) expect(lead.toLowerCase(), heading).toContain(heading.toLowerCase());
    for (const defect of ["D21-4", "D21-5", "D21-6", "D21-17"]) expect(lead).toMatch(new RegExp(`\\*\\*${defect}\\b[^*]*\\*\\*[^\\n]*(?:closed|CLOSED)`));
    expect(lead).toMatch(/\*\*D21-33\b/);
    expect(lead).toMatch(/deviation[^\n]*closed/i);
    expect(lead).toContain("MULTI-AGENT STATUS");
    expect(lead).toContain("app/lib/pcb/fab/presets");
    expect(lead).toMatch(/full circuit creation[^\n]*six specialists/i);
    // [review] the page states what the tree enforces, no more: D21-4 is closed at the scheduler only (the route mints a fresh
    // run id per POST, so a Retry re-runs the specialists); OD-108 is a recorded DEVIATION (user-message carriage, read-only
    // follow-up turn), OD-122's one artifact per user message holds because the follow-up turn is read-only; the SDK's own
    // retries under the scheduler's counts are stated (OD-107)
    expect(lead).toMatch(/\*\*D21-4\b[^*]*\*\*[^\n]*CLOSED IN PART/);
    expect(lead).toMatch(/route-level resume[^\n]*B21-E/i);
    expect(lead).not.toMatch(/costs only the tasks that never completed/);
    expect(lead).toMatch(/^### OD-108 /m);
    expect(lead).toMatch(/OD-108[\s\S]*Deviation from the default/);
    expect(lead).toMatch(/maxRetries/);
    expect(lead).toMatch(/follow-up[^\n]*read-only/i);
  });

  it("7. for the modules that do not exist at the base (the router, the scheduler, the runtime file) the cited line IS current: the anchor sits on that line of the file as left", () => {
    const page = read(PAGE);
    const newModules = new Set(["app/lib/agent/orchestration/router.ts", "app/lib/agent/orchestration/scheduler.ts", "app/api/chat/orchestration-runtime.ts"]);
    const cited = pageCitations(page).filter((citation) => newModules.has(citation.path));
    expect(cited.length).toBeGreaterThanOrEqual(12);
    const stale = cited.filter((citation) => !(read(citation.path).split(NEWLINE)[citation.line - 1] ?? "").includes(citation.anchor)).map((citation) => `${citation.id} ${citation.path}:${citation.line}`);
    expect(stale).toEqual([]);
  });

  it("8. [B21 C fix] the run shapes the page states are the ones the route suite pins (review: C moved route case 4 and the page kept B's shape): each \"the record at revision N ... (route case K)\" names the head revision case K asserts; route case 4's title claims no more requests and results than it asserts; the route suite row does not claim a three-specialist run unqualified; C39 names only the caller that uses `withdrawAuthority` in the tree", () => {
    const page = read(PAGE);
    const suite = read("app/api/chat/__tests__/b21-b-chat-router.test.ts");
    const caseBody = (index: string): string => { const start = suite.indexOf(`  it("${index}. `); const next = suite.indexOf(`  it("`, start + 1); return suite.slice(start, next > 0 ? next : undefined); };
    const claims = [...page.matchAll(/the\s+record\s+at\s+revision\s+(\d+)[^()]*\(route\s+case\s+(\d+)\)/g)].map((match) => ({ revision: Number(match[1]), routeCase: match[2]! }));
    expect(claims.map((claim) => claim.routeCase).sort()).toEqual(["17", "4"]);
    for (const claim of claims) expect(caseBody(claim.routeCase), `route case ${claim.routeCase}`).toContain(`map((head) => head.revision)).toEqual([${claim.revision}])`);
    const title = /^ {2}it\("4\. ([^"]*)"/m.exec(suite)![1]!;
    expect(title).not.toMatch(/three requests and three results/);
    expect(title).toMatch(/revision 8/); // [B21 D] pin move: the merge's two decisions follow the committed results (6 -> 8)
    const row = page.split(NEWLINE).find((line) => line.startsWith("| `app/api/chat/__tests__/b21-b-chat-router.test.ts` |"))!;
    expect(row).not.toMatch(/the three-specialist DAG in one stream/);
    const c39 = page.split(NEWLINE).find((line) => line.startsWith("| C39 |"))!;
    expect(c39).not.toMatch(/specialists and the follow-up turn/);
    const callers = ["app/lib/agent/orchestration/scheduler.ts", "app/api/chat/orchestration-runtime.ts"].filter((path) => read(path).split(NEWLINE).some((line) => /withdrawAuthority\(/.test(line) && !/export function withdrawAuthority/.test(line)));
    expect(callers).toEqual(["app/api/chat/orchestration-runtime.ts"]);
  });
});
