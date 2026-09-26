/**
 * [B21 A] The page `orchestration-contracts.md`, pinned by content: every citation resolves exactly once (the B20 `_citations`
 * pattern), the refusal vocabulary, the denylist, the reasoning stems, the declared names, the verifier ids, the nine roles, the
 * schema ids, the action kinds, the evidence kinds, the bounds, the aggregate type, the record kinds, the decision vocabulary, the
 * idempotency key format and the per-run replay partition are quoted from the code, every suite row carries its real `it(` count
 * and its runtime-test rule (a formula for the guard's `it.each`, never today's total), the CI admission it states is what the
 * workflow and the guard hold (the guard's chapter list pinned by MEMBERSHIP, never verbatim), and the "For the lead" texts are
 * all present with the review's corrections.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { anchorOccurrences, pageCitations } from "@/app/lib/mcp/server/__tests__/_citations";
import { CAPSULE_DENYLIST_KEYS, EVIDENCE_KINDS, ORCHESTRATION_BOUNDS, ORCHESTRATION_REFUSALS, PROPOSED_ACTION_KINDS, REASONING_SHAPED_STEMS, SEALED_ARTIFACT_DECLARED_NAMES, SPECIALIST_REQUEST_SCHEMA, SPECIALIST_RESULT_SCHEMA, SPECIALIST_ROLES, VALIDATION_BINDING_TOOL_IDS } from "../contracts";
import { ORCHESTRATION_AGGREGATE_TYPE, ORCHESTRATION_DECISIONS, ORCHESTRATION_RECORD_KINDS, ORCHESTRATION_RECORD_SCHEMA, ORCHESTRATION_STORE_REFUSALS, orchestrationIdempotencyKey } from "../store";
import { B11_SCANNED_FILES } from "../tripwires";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8").replaceAll(`${String.fromCharCode(13)}${NEWLINE}`, NEWLINE);
const PAGE = "artifacts/ai-control-plane-b21/orchestration-contracts.md";
const BASE = "5677b15";
const SUITES = [
  "app/lib/agent/orchestration/__tests__/b21-a-contracts.test.ts",
  "app/lib/agent/orchestration/__tests__/b21-a-store.test.ts",
  "app/lib/agent/orchestration/__tests__/b21-a-import-gates.test.ts",
  "app/lib/agent/orchestration/__tests__/b21-a-page.test.ts",
];
const GUARD = "app/lib/acquisition/__tests__/b19-e-ci-job-scope.test.ts";
const WORKFLOW = ".github/workflows/deterministic-manufacturing.yml";
const quoted = (value: string): string => `\`${value}\``;
/** the guard's chapter list, read as text: its members, never its exact spelling (the next chapter extends it) */
const guardChapters = (): string[] => [...(read(GUARD).match(/^const CHAPTERS = \[([^\]]*)\] as const;$/m)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((match) => match[1]!);

describe("[B21 A] the orchestration-contracts page", () => {
  it("1. the page exists with its sections in order, its labels, and the base it cites", () => {
    const page = read(PAGE);
    const headings = [...page.matchAll(/^## (\d+)\. /gm)].map((match) => Number(match[1]));
    expect(headings).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(page).toMatch(new RegExp(`^## 9\\. Citations, as of base ${BASE}`, "m"));
    for (const label of ["CONFIRMED", "RECORDED", "INFERRED", "UNKNOWN", "BLOCKED-LIVE-QUALIFICATION"]) expect(page, label).toContain(label);
    expect(page).toContain("[B21 A]");
  });

  it("2. every citation resolves by content: its anchor occurs exactly once in its file, or in the body of the function it names; ids run C1..Cn in order; the lines beside them are for the reader and never checked; the guard's chapter line is anchored on its head, not its members", () => {
    const page = read(PAGE);
    const citations = pageCitations(page);
    expect(citations.length).toBeGreaterThanOrEqual(20);
    expect(citations.map((citation) => citation.id)).toEqual(citations.map((_, index) => `C${index + 1}`));
    const wrong = citations.filter((citation) => anchorOccurrences(ROOT, citation) !== 1).map((citation) => `${citation.id} ${citation.path}: ${anchorOccurrences(ROOT, citation)}`);
    expect(wrong).toEqual([]);
    // every module of the increment and the three reused authorities are cited at least once
    for (const path of ["app/lib/agent/orchestration/contracts.ts", "app/lib/agent/orchestration/store.ts", "app/lib/agent/orchestration/tripwires.ts", "app/lib/agent/replay-capsule.ts", "app/lib/agent/redaction.ts", "app/lib/agent/plain-capture.ts", "app/lib/engineering/agent-exposure.ts", "app/lib/engineering/granted-execution-families.ts", "app/lib/db/schema.ts", "app/lib/embeddings.ts"]) {
      expect(citations.some((citation) => citation.path === path), path).toBe(true);
    }
    // [B21 A review] the guard citation must survive the next chapter's admission: its anchor is the line's head only
    const guard = citations.filter((citation) => citation.path === GUARD);
    expect(guard.length).toBeGreaterThanOrEqual(1);
    for (const citation of guard) expect(citation.anchor, citation.id).not.toMatch(/"b2\d-"/);
  });

  it("3. the vocabularies on the page are the code's: every refusal (and their count), the ten denylist keys, the four reasoning stems, the three declared names, the five verifier ids, the nine roles in order, both schema ids, the four action kinds, the five evidence kinds, the bounds, the aggregate type, the record schema, the five record kinds, the six decisions, the three store refusals, the idempotency key format and its example, the per-run replay partition, the mismatch, unavailable and scope-invalid sentences, and the nine scanned files", () => {
    const page = read(PAGE);
    for (const refusal of ORCHESTRATION_REFUSALS) expect(page, refusal).toContain(quoted(refusal));
    expect(page).toContain(`${ORCHESTRATION_REFUSALS.length} refusals`);
    for (const key of CAPSULE_DENYLIST_KEYS) expect(page, key).toContain(quoted(key));
    for (const stem of REASONING_SHAPED_STEMS) expect(page, stem).toContain(quoted(stem));
    for (const name of SEALED_ARTIFACT_DECLARED_NAMES) expect(page, name).toContain(quoted(name));
    for (const toolId of VALIDATION_BINDING_TOOL_IDS) expect(page, toolId).toContain(quoted(toolId));
    expect(page).toContain(SPECIALIST_ROLES.map(quoted).join(", "));
    for (const value of [SPECIALIST_REQUEST_SCHEMA, SPECIALIST_RESULT_SCHEMA, ...PROPOSED_ACTION_KINDS, ...EVIDENCE_KINDS, ORCHESTRATION_AGGREGATE_TYPE, ORCHESTRATION_RECORD_SCHEMA, ...ORCHESTRATION_RECORD_KINDS, ...ORCHESTRATION_DECISIONS, ...ORCHESTRATION_STORE_REFUSALS]) expect(page, value).toContain(quoted(value));
    expect(page).toContain(`${ORCHESTRATION_BOUNDS.maxSummaryChars.toLocaleString("en-US").replace(",", " ")} characters`);
    expect(page).toContain(`${ORCHESTRATION_BOUNDS.maxTextChars.toLocaleString("en-US").replace(",", " ")} characters`);
    expect(page).toContain(`${ORCHESTRATION_BOUNDS.maxArrayEntries} entries`);
    expect(page).toContain("`orchestration:<runId>:<taskId>:<attempt>`");
    expect(page).toContain("`orchestration:<runId>:<taskId>:<attempt>:<kind>`");
    expect(page).toContain(quoted(orchestrationIdempotencyKey("run-1", "task-1", 0, "request")));
    expect(page).toContain("`orchestrationReplayScopeKey`");
    expect(page).toContain("`agent-orchestration:<runId>`");
    expect(page).toContain("`AGENT_ORCHESTRATION_RECORD_MISMATCH`");
    expect(page).toContain("`AGENT_ORCHESTRATION_STORE_UNAVAILABLE`");
    expect(page).toContain("`AGENT_ORCHESTRATION_SCOPE_INVALID`");
    expect(page).toContain("`requestDigest`");
    expect(page).toContain("no outbox");
    expect(page).toContain("type-only");
    for (const file of B11_SCANNED_FILES) expect(page, file).toContain(quoted(file));
  });

  it("4. every suite row names a file that exists with the `it(` count it states and its runtime-test rule (equal to the `it(` count, or `N + k per chapter` for a suite with `it.each(CHAPTERS)` - a formula, never today's total, so the next chapter's admission moves nothing here); the four A suites and the guard are all listed; the CI admission the page states is what the workflow and the guard hold - the guard's chapter list contains `b21-` (its membership, never its exact spelling)", () => {
    const page = read(PAGE);
    const rows = [...page.matchAll(/^\| `((?:app|e2e)\/[^`]+\.(?:test|spec)\.ts)` \| (\d+) \| ([^|]+?) \|/gm)];
    expect(rows.map((row) => row[1])).toEqual(expect.arrayContaining([...SUITES, GUARD]));
    const chapters = guardChapters();
    for (const row of rows) {
      const source = read(row[1]!);
      const blocks = (source.match(/^\s*it\(/gm) ?? []).length;
      const each = (source.match(/^\s*it\.each\(CHAPTERS\)/gm) ?? []).length;
      expect(blocks, `${row[1]} it( blocks`).toBe(Number(row[2]));
      expect(row[3], `${row[1]} runtime tests`).toBe(each === 0 ? String(blocks) : `${blocks} + ${each} per chapter`);
      // [B21 A lead] the rule really is what a run prints today: only the guard carries an `it.each(CHAPTERS)`, exactly one, over
      // three or more chapters (10 runtime tests today); every other suite prints its `it(` blocks and nothing else
      expect(each, `${row[1]} it.each(CHAPTERS) blocks`).toBe(row[1] === GUARD ? 1 : 0);
      if (row[1] === GUARD) expect(blocks + each * chapters.length, `${row[1]} runtime tests today`).toBeGreaterThanOrEqual(10);
    }
    expect(read(WORKFLOW)).toMatch(/^ {10}app\/lib\/agent\/orchestration\/__tests__$/m);
    // [B21 A review] membership, not the whole line: the next chapter extends the list without touching this closed increment
    expect(chapters).toContain("b21-");
    expect(chapters.length).toBeGreaterThanOrEqual(3);
    expect(page).toContain("`app/lib/agent/orchestration/__tests__`");
    expect(page).toContain("prompt-to-gerber");
    expect(page).toContain("OD-124");
  });

  it("5. the \"For the lead\" section holds every reserved text in full: OD-106, OD-107 (4 specialists, parallelism 1, DAG wall time 300 s), OD-108, OD-109, OD-110, OD-111 (the record is server-internal in B21; no runtime binds the store in A - a stated deviation), OD-118, OD-124, OD-128 (the LB-9 row in the register's format), OD-131 (the recorded pattern set and the format-character cost); the README row; the ledger paragraph (with the deviation and the review); the PROGRAM_STATE text; the closure clauses for D21-1, D21-2, D21-3 (in part: tool calls are NOT persisted, B21-E carries them) and D21-26; the recorded clauses for D21-25, D21-28 and D21-29; and the new finding D21-32", () => {
    const page = read(PAGE);
    const lead = page.slice(page.indexOf("## 8. "), page.indexOf("## 9. "));
    expect(lead.length).toBeGreaterThan(4_000);
    for (const od of ["OD-106", "OD-107", "OD-108", "OD-109", "OD-110", "OD-111", "OD-118", "OD-124", "OD-128", "OD-131"]) expect(lead).toMatch(new RegExp(`^### ${od} `, "m"));
    expect(lead).toMatch(/at most 4 specialists/i);
    expect(lead).toMatch(/parallelism 1/i);
    expect(lead).toMatch(/300 s/);
    expect(lead).toMatch(/^\| LB-9 \| Real specialist disagreement \/ provider fallback \/ quota failure with live models \| BLOCKED-LIVE-QUALIFICATION \| .+ \| .*unblocks as LB-2 \|$/m);
    for (const heading of ["README row", "ledger paragraph", "PROGRAM_STATE", "discovery closure"]) expect(lead.toLowerCase(), heading).toContain(heading.toLowerCase());
    for (const defect of ["D21-1", "D21-2", "D21-3", "D21-26"]) expect(lead).toMatch(new RegExp(`\\*\\*${defect}\\b[^*]*\\*\\*[^\\n]*(?:closed|CLOSED)`));
    for (const defect of ["D21-25", "D21-28", "D21-29"]) expect(lead).toMatch(new RegExp(`\\*\\*${defect}\\b[^*]*\\*\\*[^\\n]*(?:recorded|RECORDED)`));
    expect(lead).toMatch(/\*\*D21-32\b/);
    expect(page).toContain("app/lib/db/schema.ts");
    expect(page).toContain("app/lib/embeddings.ts");
    expect(lead).toContain("MULTI-AGENT STATUS");
    // [B21 A review] the corrections the review forced, each stated where the lead copies it from
    expect(lead).toMatch(/\*\*D21-3\b[^\n]*tool calls are NOT persisted[^\n]*B21-E/);
    expect(lead).toMatch(/### OD-111[\s\S]*?server-internal[\s\S]*?### OD-118/);
    expect(lead).toMatch(/### OD-111[\s\S]*?no runtime binds the store in A[\s\S]*?### OD-118/);
    expect(lead).toMatch(/### OD-111[\s\S]*?tool calls are NOT persisted[\s\S]*?### OD-118/);
    expect(lead).toMatch(/### OD-131[\s\S]*?NAME=value[\s\S]*?### The README row/);
    expect(lead).toMatch(/### OD-131[\s\S]*?soft hyphen[\s\S]*?### The README row/);
    expect(lead).toMatch(/ledger paragraph[\s\S]*?deviation/i);
    expect(lead).toMatch(/README row[\s\S]*?tool calls are NOT persisted/);
  });

  it("6. what the page says about retention, authority, the wrapped interior and provider facts: retention is recorded and not implemented (OD-111: the grant retention as the default, purge and access audit deferred), the contracts carry zero authority, a wrapped artifact's interior is scanned but exempt from the capsule's exact keys (a real certificate carries `state` there) and the sealers' declared names are exempt from the name check only, no runtime binds the store in A, and the increment implements against the recorded provider facts (OD-118) with no re-read", () => {
    const page = read(PAGE);
    for (const claim of ["retention", "purge", "access audit", "OD-111", "zero authority", "OD-118", "provider-reference-notes.md", "GRANT_PREVIEW_TTL_MS"]) expect(page, claim).toContain(claim);
    expect(page).toMatch(/not implemented/);
    expect(page).toMatch(/no generator input/i);
    expect(page).toContain("165");
    // [B21 A review] the interior and the declared names, stated as the code has them
    expect(page).toMatch(/interior[^\n]*exempt[^\n]*capsule/i);
    expect(page).toMatch(/declared names?[^\n]*exempt[^\n]*NAME check[^\n]*values? (?:are|is) still scanned/i);
    expect(page).toContain("no runtime binds the store in A");
    expect(page).toContain("tool calls are NOT persisted");
  });
});
