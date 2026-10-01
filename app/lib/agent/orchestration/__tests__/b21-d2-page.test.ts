/**
 * [B21 D2] The page `specialist-proposals.md`, pinned by content: its sections, labels, base and tag; the live / dormant proposal
 * table IS `SPECIALIST_PROPOSAL_TOOL_IDS` and `DORMANT_SPECIALIST_PROPOSALS` (with their reasons), the role table IS
 * `roleProposalToolIds`, the sealer-fact table IS `SEALER_CONTEXT_FACTS`, the approval table IS `SPECIALIST_APPROVAL_OUTCOMES` and
 * `SPECIALIST_PROPOSAL_EVENTS`; the closed codes and the frame's rule are quoted from the code; every citation resolves by content
 * exactly once and, for the four modules D2 changed, on the line it states; every suite row carries its real `it(` count; the route
 * suite is admitted to CI by one explicit entry; the stop-condition finding and what D2 does NOT do are stated; the A..D pages carry
 * their dated D2 notes; and the "For the lead" texts are all present.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { anchorOccurrences, pageCitations } from "@/app/lib/mcp/server/__tests__/_citations";
import { COORDINATOR_ARTIFACT_EVENTS, SPECIALIST_PROPOSAL_EVENTS } from "@/app/api/chat/orchestration-runtime";
import { SPECIALIST_ROLES } from "../contracts";
import { DORMANT_SPECIALIST_PROPOSALS, SPECIALIST_PROPOSAL_TOOL_IDS, roleProposalToolIds } from "../role-tools";
import { PROPOSAL_NOT_SEALED_IN_RUN, SEALED_PROPOSALS_RULE, SEALER_CONTEXT_FACTS } from "../scheduler";
import { MERGE_ARTIFACT_PROVENANCE, SPECIALIST_APPROVAL_OUTCOMES } from "../merge";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8").replaceAll(`${String.fromCharCode(13)}${NEWLINE}`, NEWLINE);
const PAGE = "artifacts/ai-control-plane-b21/specialist-proposals.md";
const BASE = "21ae845";
const ROUTE_SUITE = "app/api/chat/__tests__/b21-d2-chat-proposals.test.ts";
const SUITES = [
  "app/lib/agent/orchestration/__tests__/b21-d2-proposing-roles.test.ts",
  "app/lib/agent/orchestration/__tests__/b21-d2-provenance.test.ts",
  "app/lib/agent/orchestration/__tests__/b21-d2-approval.test.ts",
  "app/lib/agent/orchestration/__tests__/b21-d2-page.test.ts",
  ROUTE_SUITE,
];
/** the modules D2 changed: their cited lines must be current */
const CHANGED = ["app/lib/agent/orchestration/scheduler.ts", "app/lib/agent/orchestration/merge.ts", "app/lib/agent/orchestration/role-tools.ts", "app/api/chat/orchestration-runtime.ts"];
const quoted = (value: string): string => `\`${value}\``;
const section = (page: string, from: number): string => page.slice(page.indexOf(`## ${from}. `), page.indexOf(`## ${from + 1}. `) > 0 ? page.indexOf(`## ${from + 1}. `) : undefined);

describe("[B21 D2] the specialist-proposals page", () => {
  it("1. the page exists with its sections in order, its labels, its base and its tag", () => {
    const page = read(PAGE);
    const headings = [...page.matchAll(/^## (\d+)\. /gm)].map((match) => Number(match[1]));
    expect(headings).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(page).toMatch(new RegExp(`^## 8\\. Citations, as of base ${BASE}`, "m"));
    for (const label of ["CONFIRMED", "RECORDED", "INFERRED", "UNKNOWN", "BLOCKED-LIVE-QUALIFICATION"]) expect(page, label).toContain(label);
    expect(page).toContain("[B21 D2]");
    expect(page).toContain("provider-reference-notes.md");
  });

  it("2. the proposal tables ARE the code's data: one row per live proposal and per dormant one (with its reason, verbatim), one row per role with the proposals it may be offered, one row per sealer fact", () => {
    const tools = section(read(PAGE), 1);
    const rows = [...tools.matchAll(/^\| `(sirkit\.[a-z0-9.-]+)` \| (live|dormant) \| ([^|]+?) \|$/gm)].map((row) => ({ toolId: row[1]!, state: row[2]!, reason: row[3]! }));
    expect(rows.filter((row) => row.state === "live").map((row) => row.toolId)).toEqual([...SPECIALIST_PROPOSAL_TOOL_IDS]);
    expect(rows.filter((row) => row.state === "dormant").map((row) => [row.toolId, row.reason])).toEqual(Object.entries(DORMANT_SPECIALIST_PROPOSALS));
    const roles = [...tools.matchAll(/^\| `([a-z-]+)` \| (—|(?:`sirkit\.[a-z0-9.-]+`(?:, )?)+) \|$/gm)].map((row) => [row[1]!, row[2]!]);
    expect(roles).toEqual(SPECIALIST_ROLES.map((role) => [role, roleProposalToolIds(role).length === 0 ? "—" : roleProposalToolIds(role).map(quoted).join(", ")]));
    const facts = [...tools.matchAll(/^\| `(sirkit\.[a-z0-9.-]+)` \| `([a-zA-Z]+)` \|$/gm)].map((row) => [row[1]!, row[2]!]);
    expect(facts).toEqual(Object.entries(SEALER_CONTEXT_FACTS));
  });

  it("3. the provenance rule and the approval rule are the code's: the closed codes, the provenance token and the frame's rule quoted verbatim; the approval table IS SPECIALIST_APPROVAL_OUTCOMES in order, the family events ARE SPECIALIST_PROPOSAL_EVENTS", () => {
    const page = read(PAGE);
    for (const value of [PROPOSAL_NOT_SEALED_IN_RUN, "proposal-not-sealed-in-run", MERGE_ARTIFACT_PROVENANCE, "proposal_ready", "pcb_proposal_ready", "layout_candidate_ready"]) expect(page, value).toContain(quoted(value));
    expect(section(page, 2)).toContain(SEALED_PROPOSALS_RULE);
    const approval = section(page, 3);
    const outcomes = [...approval.matchAll(/^\| `([a-z_]+)` \| (\d+) \| ([^|]+?) \|$/gm)].map((row) => row[1]!);
    expect(outcomes).toEqual([...SPECIALIST_APPROVAL_OUTCOMES]);
    const events = [...approval.matchAll(/^\| `(sirkit\.[a-z0-9.-]+)` \| `([a-z_]+)` \| `(sirkit\.[a-z0-9.-]+|[a-z]+ -> [^`]+)` \|$/gm)].map((row) => [row[1]!, row[2]!]);
    expect(events).toEqual(Object.entries(SPECIALIST_PROPOSAL_EVENTS).map(([kind, entry]) => [kind, entry.event]));
  });

  it("4. what D2 does NOT do and the stop-condition finding are stated: no new exposed tool, route, run event, UI, grant or mutation; no long-running proposal for a specialist; the replacement stays dormant because its sealer needs the pin-facts reads only the coordinator's gateway holds, and so the OD-130 part review is not reachable at the route", () => {
    const page = read(PAGE);
    const not = section(page, 5).toLowerCase();
    for (const claim of ["no new exposed tool", "no new route", "no new run event", "no ui", "no grant", "no mutation", "no long-running proposal", "no reserved-file edit"]) expect(not, claim).toContain(claim);
    const stop = section(page, 4);
    for (const claim of ["pin-facts", "replacementPinFacts", "current-pin-authority-unavailable", "OD-130", "not reachable at the route", "stop condition"]) expect(stop, claim).toContain(claim);
  });

  it("5. every citation resolves by content exactly once, ids run C1..Cn; for the four modules D2 changed the cited line IS current and each is cited; every suite row names a file with the `it(` count it states; the route suite is admitted to CI by one explicit entry", () => {
    const page = read(PAGE);
    const citations = pageCitations(page);
    expect(citations.length).toBeGreaterThanOrEqual(20);
    expect(citations.map((citation) => citation.id)).toEqual(citations.map((_, index) => `C${index + 1}`));
    const wrong = citations.filter((citation) => anchorOccurrences(ROOT, citation) !== 1).map((citation) => `${citation.id} ${citation.path}: ${anchorOccurrences(ROOT, citation)}`);
    expect(wrong).toEqual([]);
    for (const path of CHANGED) expect(citations.some((citation) => citation.path === path), path).toBe(true);
    const stale = citations.filter((citation) => CHANGED.includes(citation.path) && !(read(citation.path).split(NEWLINE)[citation.line - 1] ?? "").includes(citation.anchor)).map((citation) => `${citation.id} ${citation.path}:${citation.line}`);
    expect(stale).toEqual([]);
    const rows = [...page.matchAll(/^\| `((?:app|e2e)\/[^`]+\.(?:test|spec)\.ts)` \| (\d+) \|/gm)];
    expect(rows.map((row) => row[1])).toEqual(expect.arrayContaining(SUITES));
    for (const row of rows) expect((read(row[1]!).match(/^\s*it\(/gm) ?? []).length, `${row[1]} it( blocks`).toBe(Number(row[2]));
    expect(read(".github/workflows/deterministic-manufacturing.yml")).toMatch(/^ {10}app\/api\/chat\/__tests__\/b21-d2-chat-proposals\.test\.ts$/m);
  });

  it("6. the A..D pages carry their dated D2 notes: D's D21-10 no longer only CONFIRMED-unreachable, C's three live row entries and its dormant count, B's \"a specialist never seals a proposal\" and A's wrapped artifacts - each restated with a [B21 D2, 2026-09-26] note that names this page", () => {
    const note = /\[B21 D2, 2026-09-26\][^\n]*specialist-proposals\.md/;
    for (const path of ["orchestration-contracts.md", "task-complexity-router.md", "specialist-roles.md", "merge-and-disagreement.md"]) expect(read(`artifacts/ai-control-plane-b21/${path}`), path).toMatch(note);
    // [B21 D2 fix] (review tests-8) each note is pinned by the CLAIM it restates, never by a word an inverted note would also hold
    // ("unreachable" contains "reachable"), and no D2 note on any of the four pages may say the escalation stays unreachable
    const merge = read("artifacts/ai-control-plane-b21/merge-and-disagreement.md");
    expect(merge).toMatch(/CONFIRMED-unreachable[\s\S]{0,1500}\[B21 D2, 2026-09-26\] D21-10's escalation is reachable in production since B21-D2: /);
    expect(merge).toMatch(/\*\*D21-14 [^\n]*\n(?:[^\n]*\n){0,6}[^\n]*which no specialist carries today;[^\n]*\n[^\n]*\[B21 D2, 2026-09-26\] Since B21-D2 two circuit specialists' conflicting SEALED Tier 1 edits escalate in the full-circuit DAGs/);
    for (const path of ["orchestration-contracts.md", "task-complexity-router.md", "specialist-roles.md", "merge-and-disagreement.md"]) {
      expect(read(`artifacts/ai-control-plane-b21/${path}`), path).not.toMatch(/\[B21 D2, 2026-09-26\][^\n]*\b(?:remains|still|stays|is still) (?:CONFIRMED-)?unreachable\b/i);
    }
    const roles = read("artifacts/ai-control-plane-b21/specialist-roles.md");
    expect(roles).toMatch(/\[B21 D2, 2026-09-26\] Three of those entries \(two distinct ids\) are LIVE since B21-D2/);
    const router = read("artifacts/ai-control-plane-b21/task-complexity-router.md");
    expect(router).toMatch(/never seals a proposal[\s\S]{0,400}\[B21 D2, 2026-09-26\] since B21-D2 a proposing role's specialist seals a Tier 2 proposal through its own gateway/);
  });

  it("7. the \"For the lead\" section holds every reserved text in full: OD-109, OD-120 and OD-122 amended, the README row for B21-D2, the ledger paragraph, the PROGRAM_STATE texts, the discovery closure clauses (D21-10's production half closed) and the section-10 amendment line, and the pin moves with their reasons", () => {
    const page = read(PAGE);
    const lead = section(page, 7);
    expect(lead.length).toBeGreaterThan(4_000);
    for (const od of ["OD-109", "OD-120", "OD-122"]) expect(lead).toMatch(new RegExp(`^### ${od} `, "m"));
    for (const heading of ["README row", "ledger paragraph", "PROGRAM_STATE", "discovery closure", "§10"]) expect(lead, heading).toContain(heading);
    expect(lead).toMatch(/^\| B21-D2 /m);
    expect(lead).toMatch(/\*\*D21-10\b[^*]*\*\*[^\n]*(?:closed|CLOSED)/);
    expect(lead).toContain("MULTI-AGENT STATUS");
    const moves = section(page, 6);
    for (const suite of ["b21-d-merge.test.ts", "b21-d-chat-merge.test.ts", "b21-b-chat-router.test.ts", "b21-c-least-privilege.test.ts", "b21-c-no-elevation.test.ts", "_merge-fixtures.ts"]) expect(moves, suite).toContain(suite);
  });

  it("8. [B21 D2 fix] the review round's statements are on the page: the coordinator's artifact events ARE `COORDINATOR_ARTIFACT_EVENTS` and, once one was emitted, no specialist is offered a proposal (OD-122's `proposal_exists` clause, `artifactHeld`, stated in the OD-122 amendment); `incomplete` withholds a presentation a peer's unjudged seal or an unrun proposing specialist could contest; the presentation is ALWAYS on the trace (CONFIRMED, never the old RECORDED sentence); the frame follows the run's effective set; scenario 17's replacement DAG has one proposing role, D21-37 is rated medium and the status line says where the escalation is reachable; the preamble claims the real gateway only for the artifacts a suite accepts, presents or approves", () => {
    const page = read(PAGE);
    const approval = section(page, 3);
    expect(approval).toContain(`The coordinator's artifact events (\`COORDINATOR_ARTIFACT_EVENTS\`, in order): ${COORDINATOR_ARTIFACT_EVENTS.map(quoted).join(", ")}.`);
    expect(approval).toContain("ALWAYS recorded on the run's trace");
    expect(page).not.toContain("the presentation is recorded on the stream and the trace as one bounded line");
    expect(section(page, 1)).toContain("follows the run's EFFECTIVE set");
    const scenario = section(page, 4);
    for (const claim of ["scenario 17", "`component-replacement`", "`full-circuit-creation`", "`full-circuit-layout`", "ONE proposing specialist"]) expect(scenario, claim).toContain(claim);
    const lead = section(page, 7);
    const od122 = lead.slice(lead.indexOf("### OD-122 "), lead.indexOf("### The README row"));
    for (const claim of ["`proposal_exists`", "`artifactHeld`", "`incomplete`", "ALWAYS recorded on the run's trace"]) expect(od122, claim).toContain(claim);
    expect(lead).toMatch(/\*\*D21-37 \(new, medium\)[^\n]*\n(?:[^\n]*\n){0,8}[^\n]*scenario 17/);
    expect(lead).toMatch(/\*\*D21-14 \(deterministic verification thin for circuit\/topology claims\)\*\* — addendum by B21-D2/);
    expect(lead).toMatch(/MULTI-AGENT STATUS: [^`]*the\s+conflicting-proposals escalation reachable in production in the two full-circuit DAGs \(B21-D2\)/);
    expect(page).not.toContain("every artifact a D2 suite asserts on was sealed by the REAL gateway");
    expect(page).toContain("every artifact a D2 suite accepts, presents or approves was sealed by the REAL gateway");
  });
});
