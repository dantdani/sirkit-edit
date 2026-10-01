/**
 * [B21 C] The page `specialist-roles.md`, pinned by content: its sections, labels, base and tag; the vocabularies quoted from
 * the code (the seven role-table violations, the eight context claims, the three specialist statuses, `allowlist_invalid` and
 * the A4L bound); the trimmed full-circuit lists equal the router's data, with the runbook's six and runbook line :810; the
 * D21-9 pin-move rule names the pins C leaves untouched; every citation resolves by content exactly once and, for the new
 * module, on the line it states; every suite row carries its real `it(` count; the "For the lead" texts are all present.
 * (The role table itself equals `INTENTIONAL_ROLE_TOOL_IDS` and `ROLE_TOOL_REASONS` row for row: b21-c-role-tools case 4.)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { anchorOccurrences, pageCitations } from "@/app/lib/mcp/server/__tests__/_citations";
import { RUN_ALLOWLIST_MAX_IDS } from "@/app/lib/agent/loop";
import { DAG_ROLE_LISTS, FULL_CIRCUIT_RUNBOOK_ROLES, FULL_CIRCUIT_TRIM, ROUTER_RULES } from "../router";
import { ROLE_TOOL_VIOLATIONS, PROPOSING_ROLES } from "../role-tools";
import { ROLE_HAS_NO_TOOLS, SPECIALIST_CONTEXT_CLAIMS, SPECIALIST_CONTEXT_REFUSAL_STATUS, SPECIALIST_REFUSAL_STATUS } from "../scheduler";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8").replaceAll(`${String.fromCharCode(13)}${NEWLINE}`, NEWLINE);
const PAGE = "artifacts/ai-control-plane-b21/specialist-roles.md";
const BASE = "0396c9e";
const SUITES = [
  "app/lib/agent/orchestration/__tests__/b21-c-role-tools.test.ts",
  "app/lib/agent/orchestration/__tests__/b21-c-least-privilege.test.ts",
  "app/lib/agent/orchestration/__tests__/b21-c-no-elevation.test.ts",
  "app/lib/agent/orchestration/__tests__/b21-c-page.test.ts",
  "app/lib/agent/orchestration/__tests__/b21-b-router.test.ts",
  "app/lib/agent/orchestration/__tests__/b21-b-scheduler.test.ts",
  "app/lib/agent/orchestration/__tests__/b21-a-import-gates.test.ts",
  "app/api/chat/__tests__/b21-b-chat-router.test.ts",
];
const quoted = (value: string): string => `\`${value}\``;
const section = (page: string, from: number): string => page.slice(page.indexOf(`## ${from}. `), page.indexOf(`## ${from + 1}. `) > 0 ? page.indexOf(`## ${from + 1}. `) : undefined);

describe("[B21 C] the specialist-roles page", () => {
  it("1. the page exists with its sections in order, its labels, its base and its tag", () => {
    const page = read(PAGE);
    const headings = [...page.matchAll(/^## (\d+)\. /gm)].map((match) => Number(match[1]));
    expect(headings).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(page).toMatch(new RegExp(`^## 8\\. Citations, as of base ${BASE}`, "m"));
    for (const label of ["CONFIRMED", "RECORDED", "INFERRED", "UNKNOWN", "BLOCKED-LIVE-QUALIFICATION"]) expect(page, label).toContain(label);
    expect(page).toContain("[B21 C]");
    expect(page).toContain("provider-reference-notes.md");
  });

  it("2. the vocabularies are the code's: the seven role-table violations, the eight context claims, `role_context_elevated`, `role_not_permitted_tool`, `role_has_no_tools`, `allowlist_invalid` and the A4L bound; the proposing roles; the elevation proof names the case that proves each claim, structural and behavioural", () => {
    const page = read(PAGE);
    for (const value of [...ROLE_TOOL_VIOLATIONS, ...SPECIALIST_CONTEXT_CLAIMS, SPECIALIST_CONTEXT_REFUSAL_STATUS, SPECIALIST_REFUSAL_STATUS, ROLE_HAS_NO_TOOLS, "allowlist_invalid"]) expect(page, value).toContain(quoted(value));
    expect(page).toContain(`${RUN_ALLOWLIST_MAX_IDS} ids`);
    for (const role of PROPOSING_ROLES) expect(page, role).toContain(quoted(role));
    const proof = section(page, 3);
    for (const claim of ["structural", "behavioural", "b21-c-no-elevation.test.ts", "b21-c-least-privilege.test.ts", "b21-b-chat-router.test.ts", "executionGrants", "verifyAgentContextIntegrity"]) expect(proof, claim).toContain(claim);
    for (const index of [1, 2, 3, 4, 5]) expect(proof, `case ${index}`).toMatch(new RegExp(`case ${index}\\b`));
  });

  it("3. the full-circuit trim is the router's data: the runbook's six at :810, the fixed priority, both trimmed lists (the PCB specialist in place of the schematic one for a layout ask with a board), the rule ids, and the owner's cap decision (OD-107)", () => {
    const page = read(PAGE);
    const trim = section(page, 4);
    expect(trim).toContain(":810");
    expect(trim).toContain(FULL_CIRCUIT_RUNBOOK_ROLES.map(quoted).join(", "));
    expect(trim).toContain(FULL_CIRCUIT_TRIM.priority.map(quoted).join(", "));
    for (const shape of ["full-circuit-creation", "full-circuit-layout"] as const) {
      expect(trim, shape).toContain(quoted(shape));
      expect(trim, shape).toContain(DAG_ROLE_LISTS[shape].map(quoted).join(", "));
    }
    for (const rule of ROUTER_RULES.filter((entry) => entry.id.startsWith("D-full-circuit"))) expect(trim, rule.id).toContain(quoted(rule.id));
    expect(trim).toContain("OD-107");
    expect(trim).toMatch(/plan_exceeds_specialist_cap/);
    expect(trim).toMatch(/requirements-analyst[^\n]*coordinator/);
  });

  it("4. what did not move is stated with the pins: no descriptor, no channel, no exclusion reason, no route, no UI; the D21-9 pin-move rule names the seven pins and the B04/B01 byte artifacts; D21-31 is recorded with OD-123; no generator input changed and the census stays 165", () => {
    const page = read(PAGE);
    const unmoved = section(page, 5);
    for (const pin of ["b18-c-exposure-lift.test.ts:58", "b17-f-agent-exposure.test.ts:92-93", "b20-a4-observation-descriptor.test.ts:88", "b20-b3-mcp-subset-move.test.ts:136-137", "b20-c1-three-way-parity.test.ts:241", "b20-b1-mcp-exposure.test.ts:441-449", "b04-tool-registry.test.ts:465-476"]) expect(unmoved, pin).toContain(pin);
    for (const claim of ["D21-9", "D21-31", "OD-123", "schematic.set-property", "schematic.move-rotate", "EXECUTION_FAMILIES", "no generator input", "165"]) expect(unmoved, claim).toContain(claim);
    for (const claim of ["no new exposed tool", "no new discovery channel", "no new exclusion reason", "no new route", "no UI"]) expect(page.toLowerCase(), claim).toContain(claim.toLowerCase());
    // [B21 C fix] C's OWN pins over every exposed descriptor are in the rule too (review): least-privilege case 1's admitted-read
    // list and case 6's four byte digests (read from the suite, so a new digest there must be named here)
    const suite = read("app/lib/agent/orchestration/__tests__/b21-c-least-privilege.test.ts");
    const digests = [...suite.matchAll(/toBe\("(eng1-[0-9a-f]{16})"\)/g)].map((match) => match[1]!);
    expect(digests).toHaveLength(4);
    const rule = unmoved.slice(unmoved.indexOf("**D21-9"), unmoved.indexOf("**D21-31"));
    for (const pin of ["b21-c-least-privilege.test.ts", "FULL_CONTEXT_EFFECTIVE", "case 1", "case 6", ...digests]) expect(rule, pin).toContain(pin);
  });

  it("5. every citation resolves by content exactly once, ids run C1..Cn; for the new module the cited line IS current; the changed production files are all cited; every suite row names a file with the `it(` count it states", () => {
    const page = read(PAGE);
    const citations = pageCitations(page);
    expect(citations.length).toBeGreaterThanOrEqual(20);
    expect(citations.map((citation) => citation.id)).toEqual(citations.map((_, index) => `C${index + 1}`));
    const wrong = citations.filter((citation) => anchorOccurrences(ROOT, citation) !== 1).map((citation) => `${citation.id} ${citation.path}: ${anchorOccurrences(ROOT, citation)}`);
    expect(wrong).toEqual([]);
    for (const path of ["app/lib/agent/orchestration/role-tools.ts", "app/lib/agent/orchestration/scheduler.ts", "app/lib/agent/orchestration/router.ts", "app/lib/agent/loop.ts", "app/lib/agent/gateway.ts", "app/lib/agent/context.ts", "app/lib/engineering/agent-exposure.ts", "app/lib/engineering/execution-grant.ts"]) {
      expect(citations.some((citation) => citation.path === path), path).toBe(true);
    }
    // [B21 C fix] every file C wrote or changed, not only the new module: its cited line IS current
    const fresh = citations.filter((citation) => ["app/lib/agent/orchestration/role-tools.ts", "app/lib/agent/orchestration/scheduler.ts", "app/lib/agent/orchestration/router.ts", "app/lib/agent/loop.ts"].includes(citation.path));
    expect(fresh.length).toBeGreaterThanOrEqual(20);
    const stale = fresh.filter((citation) => !(read(citation.path).split(NEWLINE)[citation.line - 1] ?? "").includes(citation.anchor)).map((citation) => `${citation.id}:${citation.line}`);
    expect(stale).toEqual([]);
    const rows = [...page.matchAll(/^\| `((?:app|e2e)\/[^`]+\.(?:test|spec)\.ts)` \| (\d+) \|/gm)];
    expect(rows.map((row) => row[1])).toEqual(expect.arrayContaining(SUITES));
    for (const row of rows) expect((read(row[1]!).match(/^\s*it\(/gm) ?? []).length, `${row[1]} it( blocks`).toBe(Number(row[2]));
  });

  it("6. the \"For the lead\" section holds every reserved text in full: OD-109, OD-120, OD-121 and OD-123 as applied, the OD-107 resolution, the README row, the ledger paragraph, the PROGRAM_STATE texts, the discovery closure clauses (D21-7 and D21-8 closed, D21-9 and D21-31 recorded) and the section 10 amendment line", () => {
    const page = read(PAGE);
    const lead = section(page, 7);
    expect(lead.length).toBeGreaterThan(4_000);
    for (const od of ["OD-107", "OD-109", "OD-120", "OD-121", "OD-123"]) expect(lead).toMatch(new RegExp(`^### ${od} `, "m"));
    for (const heading of ["README row", "ledger paragraph", "PROGRAM_STATE", "discovery closure", "§10"]) expect(lead.toLowerCase(), heading).toContain(heading.toLowerCase());
    for (const defect of ["D21-7", "D21-8"]) expect(lead).toMatch(new RegExp(`\\*\\*${defect}\\b[^*]*\\*\\*[^\\n]*CLOSED`));
    for (const defect of ["D21-9", "D21-31"]) expect(lead).toMatch(new RegExp(`\\*\\*${defect}\\b[^*]*\\*\\*[^\\n]*RECORDED`));
    expect(lead).toContain("MULTI-AGENT STATUS");
    expect(lead).toMatch(/### OD-120[\s\S]*?dormant[\s\S]*?### OD-121/i);
    expect(lead).toMatch(/### OD-121[\s\S]*?allowlist_invalid[\s\S]*?### OD-123/);
    expect(lead).toMatch(/### OD-109[\s\S]*?role_context_elevated[\s\S]*?### OD-120/);
  });

  it("7. [B21 C fix] the page states what the tree enforces about a role with no tools and about the sourcing specialist (review): a role with no tools this run is NOT RUN yet keeps its task in the plan (the ids come from the plan's roles, so a resume never depends on this run's resources) and records the missing evidence as dissent `escalated`, which the outcome and the follow-up envelope carry; the sourcing specialist runs only when at least one schematic component has a durable binding that loads within the loader's deadline - never claimed for the fixture runtime as such; the full-circuit rule needs a new circuit named from words and the layout variant its own layout ask", () => {
    const page = read(PAGE);
    const drop = section(page, 2);
    for (const claim of ["not run", "keeps its task", "dissent `escalated`", "task ids", "plan_mismatch", "specialistResultsEnvelope", "at least one schematic component has a durable binding", "5 s"]) expect(drop, claim).toContain(claim);
    expect(drop).not.toMatch(/under the fixture runtime the authority is loaded and the role runs/);
    expect(drop).not.toMatch(/drops it `role_has_no_tools`[^.]*before the record is written/);
    const lead = section(page, 7);
    expect(lead).toMatch(/### OD-120[\s\S]*?at least one schematic component has a durable binding[\s\S]*?### OD-121/);
    expect(lead).toMatch(/### OD-107[\s\S]*?new circuit named from words[\s\S]*?### OD-109/);
    const trim = section(page, 4);
    for (const claim of ["new circuit named from words", "an indefinite object", "circuit-kind noun", "its own layout ask", "D-bounded-pcb-proposal", "Make the placement more compact."]) expect(trim, claim).toContain(claim);
  });
});
