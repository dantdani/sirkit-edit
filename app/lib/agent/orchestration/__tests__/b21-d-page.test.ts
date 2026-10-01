/**
 * [B21 D] The page `merge-and-disagreement.md`, pinned by content: its sections, labels, base and tag; the merge's rule table IS
 * the module's `MERGE_RULES` (in the runbook's order, each with the case that proves it - and that case exists); the verifier
 * table IS `MERGE_VERIFIERS`; the family-code table IS `MERGE_FAMILY_CODES`; the claim, identity and decision vocabularies and the
 * allowed resolutions are quoted from the code; every citation resolves by content exactly once and, for the new module and the
 * runtime file, on the line it states; every suite row carries its real `it(` count; the route suite is admitted to CI by an
 * explicit entry; what D does NOT do is stated; and the "For the lead" texts are all present. [B21 D fix] The own-code table IS
 * `MERGE_OWN_CODES`, every one of the adversarial review's confirmed findings is listed with the cases that reproduce it (and they
 * exist), and the closure clauses say what the tree does in production - no escalation "by construction", D21-17 against the
 * request-time snapshot only.
 * [B21 D4] Case 8: D21-46 closed - section 5's dated note and subsection, the fix's citation (C87) and D4's reserved texts.
 * [B21 D4 review] Case 9: D4's reserved nextAction is the applied one without its B21-D4 clause; each section-10 line has its Section 7.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { anchorOccurrences, pageCitations } from "@/app/lib/mcp/server/__tests__/_citations";
import { ALLOWED_RESOLUTIONS, MERGE_CLAIM_KINDS, MERGE_DECISION_PRECEDENCE, MERGE_FAMILY_CODES, MERGE_IDENTITY_KINDS, MERGE_OUTCOME_SCHEMA, MERGE_OWN_CODES, MERGE_REFUSALS, MERGE_RULES, MERGE_TASK_PREFIX, MERGE_VERIFIERS } from "../merge";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8").replaceAll(`${String.fromCharCode(13)}${NEWLINE}`, NEWLINE);
const PAGE = "artifacts/ai-control-plane-b21/merge-and-disagreement.md";
const BASE = "5f1b498";
const ROUTE_SUITE = "app/api/chat/__tests__/b21-d-chat-merge.test.ts";
const SUITES = [
  "app/lib/agent/orchestration/__tests__/b21-d-merge.test.ts",
  "app/lib/agent/orchestration/__tests__/b21-d-verification-requests.test.ts",
  "app/lib/agent/orchestration/__tests__/b21-d-page.test.ts",
  ROUTE_SUITE,
  "app/lib/agent/orchestration/__tests__/b21-a-import-gates.test.ts",
];
const quoted = (value: string): string => `\`${value}\``;
const section = (page: string, from: number): string => page.slice(page.indexOf(`## ${from}. `), page.indexOf(`## ${from + 1}. `) > 0 ? page.indexOf(`## ${from + 1}. `) : undefined);
/** one closure clause of the "For the lead" section: from its bold label to the next bullet */
const clause = (lead: string, id: string): string => { const start = lead.indexOf(`- **${id} `); return start < 0 ? "" : lead.slice(start, lead.indexOf(`${NEWLINE}- **`, start + 1) > 0 ? lead.indexOf(`${NEWLINE}- **`, start + 1) : undefined); };
/** [B21 D fix] the adversarial review's confirmed findings (the fix pass's input), each of which the page must list */
const REVIEW_FINDINGS = [
  "regressions-1", "regressions-2", "regressions-3", "regressions-4",
  "security-self-minted-artifacts-accepted", "security-source-count-provider-controlled", "security-readiness-free-text-bypass", "security-evidence-standing-self-asserted",
  "coverage-1", "coverage-3", "coverage-4", "coverage-5", "coverage-7", "coverage-8", "coverage-9", "coverage-10", "coverage-11", "coverage-12", "coverage-13",
  "tests-1", "tests-2", "tests-3", "tests-4", "tests-5", "tests-6", "tests-7", "tests-8", "tests-9", "tests-10", "tests-11",
];

describe("[B21 D] the merge-and-disagreement page", () => {
  it("1. the page exists with its sections in order, its labels, its base and its tag", () => {
    const page = read(PAGE);
    const headings = [...page.matchAll(/^## (\d+)\. /gm)].map((match) => Number(match[1]));
    expect(headings).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(page).toMatch(new RegExp(`^## 9\\. Citations, as of base ${BASE}`, "m"));
    for (const label of ["CONFIRMED", "RECORDED", "INFERRED", "UNKNOWN", "BLOCKED-LIVE-QUALIFICATION"]) expect(page, label).toContain(label);
    expect(page).toContain("[B21 D]");
    expect(page).toContain(quoted(MERGE_OUTCOME_SCHEMA));
  });

  it("2. the rule table IS `MERGE_RULES`, in the runbook's order (B21-D :835-843): one row per rule with its runbook line, the runbook's words, what the merge does and the case that proves it - and every named case exists in its suite", () => {
    const rules = section(read(PAGE), 1);
    const rows = [...rules.matchAll(/^\| (D\d+) \| (:\d+) \| ([^|]+?) \| ([^|]+?) \| ([^|]+?) \|$/gm)].map((row) => ({ id: row[1]!, runbook: row[2]!, rule: row[3]!, merge: row[4]!, proof: row[5]! }));
    expect(rows).toEqual(MERGE_RULES.map((rule) => ({ id: rule.id, runbook: rule.runbook, rule: rule.rule, merge: rule.merge, proof: rule.proof })));
    expect(MERGE_RULES.map((rule) => rule.runbook)).toEqual([":835", ":836", ":837", ":838", ":839", ":840", ":841", ":842", ":843"]);
    for (const rule of MERGE_RULES) {
      for (const reference of rule.proof.split("; ")) {
        const match = /^(b21-[a-z0-9-]+) case (\d+)$/.exec(reference);
        expect(match, `${rule.id}: ${reference}`).not.toBeNull();
        const suite = SUITES.find((path) => path.endsWith(`/${match![1]}.test.ts`));
        expect(suite, `${rule.id}: ${reference}`).toBeDefined();
        expect(read(suite!), `${rule.id}: ${reference}`).toMatch(new RegExp(`^ {2}it\\("${match![2]}\\. `, "m"));
      }
    }
  });

  it("3. the taxonomy is the code's: the claim kinds, the identity kinds, the decision precedence, the family codes table (IS `MERGE_FAMILY_CODES`), the allowed resolutions, the refusals, the escalation key prefix; the verifier table IS `MERGE_VERIFIERS` in the binding order", () => {
    const page = read(PAGE);
    for (const value of [...MERGE_CLAIM_KINDS, ...MERGE_IDENTITY_KINDS, ...MERGE_REFUSALS, ...ALLOWED_RESOLUTIONS, "rerun_candidate", MERGE_TASK_PREFIX]) expect(page, value).toContain(quoted(value));
    expect(page).toContain(MERGE_DECISION_PRECEDENCE.map(quoted).join(" > "));
    const taxonomy = section(page, 2);
    const families = [...taxonomy.matchAll(/^\| `(tier1|replacement|pcb-edit|layout)` \| ([^|]*?) \| ([^|]*?) \| ([^|]*?) \| ([^|]*?) \|$/gm)].map((row) => ({ family: row[1]!, malformed: row[2]!, stale: row[3]!, expired: row[4]!, contradicted: row[5]! }));
    const cell = (codes: readonly string[]): string => (codes.length === 0 ? "—" : codes.map(quoted).join(", "));
    expect(families).toEqual(Object.entries(MERGE_FAMILY_CODES).map(([family, codes]) => ({ family, malformed: cell(codes.malformed), stale: cell(codes.stale), expired: cell(codes.expired), contradicted: cell(codes.contradicted) })));
    for (const conflict of ["same_field", "edit_vs_delete", "schematic_vs_pcb", "net_vs_routing", "unknown_interaction"]) expect(taxonomy, conflict).toContain(quoted(conflict));
    const verifiers = section(page, 3);
    const rows = [...verifiers.matchAll(/^\| `(sirkit\.[a-z.-]+)` \| ([^|]+?) \| ([^|]+?) \| `([a-z-]+)` \|$/gm)].map((row) => ({ bindingToolId: row[1]!, runs: row[2]!, fails: row[3]!, claim: row[4]! }));
    expect(rows).toEqual(MERGE_VERIFIERS.map((verifier) => ({ bindingToolId: verifier.bindingToolId, runs: verifier.runs, fails: verifier.fails, claim: verifier.claim })));
    for (const claim of ["deterministic validation outranks consensus", "`deterministic_verifier`", "`trace-event`", "`readiness-report`", "no model"]) expect(verifiers, claim).toContain(claim);
  });

  it("4. the readiness evidence rule (OD-129) and the candidate-part rule (OD-130) are stated as the code applies them, and what D does NOT do is stated", () => {
    const page = read(PAGE);
    const rules = section(page, 4);
    for (const claim of ["OD-129", "reportId", "designRevision", "manufacturingProfileId", "freshness", "qualification-authority", "free text", "`readiness-claim-unreferenced`", "`readiness-report-stale`"]) expect(rules, claim).toContain(claim);
    for (const claim of ["OD-130", "exact authority", "request_atomic_review", "`part-not-exact-authority`", "never a replacement target"]) expect(rules, claim).toContain(claim);
    const not = section(page, 6).toLowerCase();
    for (const claim of ["no content judgement", "no model", "no ui", "no new run event", "no provider routing", "no new route", "no new exposed tool", "no proposal_ready"]) expect(not, claim).toContain(claim);
  });

  it("5. every citation resolves by content exactly once, ids run C1..Cn; for the new module and the runtime file the cited line IS current; every suite row names a file with the `it(` count it states; the route suite is admitted to CI by one explicit entry", () => {
    const page = read(PAGE);
    const citations = pageCitations(page);
    expect(citations.length).toBeGreaterThanOrEqual(20);
    expect(citations.map((citation) => citation.id)).toEqual(citations.map((_, index) => `C${index + 1}`));
    const wrong = citations.filter((citation) => anchorOccurrences(ROOT, citation) !== 1).map((citation) => `${citation.id} ${citation.path}: ${anchorOccurrences(ROOT, citation)}`);
    expect(wrong).toEqual([]);
    const current = new Set(["app/lib/agent/orchestration/merge.ts", "app/api/chat/orchestration-runtime.ts", "app/lib/agent/orchestration/scheduler.ts"]);
    const stale = citations.filter((citation) => current.has(citation.path) && !(read(citation.path).split(NEWLINE)[citation.line - 1] ?? "").includes(citation.anchor)).map((citation) => `${citation.id} ${citation.path}:${citation.line}`);
    expect(stale).toEqual([]);
    for (const path of ["app/lib/agent/orchestration/merge.ts", "app/api/chat/orchestration-runtime.ts", "app/lib/engineering/schematic-proposals.ts", "app/lib/engineering/replacement-proposals.ts", "app/lib/pcb/proposal/sealed-pcb-edit-proposal.ts", "app/lib/pcb/candidates/layout-candidate.ts", "app/lib/engineering/collaboration.ts", "app/lib/engineering/types.ts", "app/lib/pcb/readiness/types.ts", "app/lib/engineering/replacement-proposal-assembler.ts"]) {
      expect(citations.some((citation) => citation.path === path), path).toBe(true);
    }
    const rows = [...page.matchAll(/^\| `((?:app|e2e)\/[^`]+\.(?:test|spec)\.ts)` \| (\d+) \|/gm)];
    expect(rows.map((row) => row[1])).toEqual(expect.arrayContaining(SUITES));
    for (const row of rows) {
      const blocks = (read(row[1]!).match(/^\s*it\(/gm) ?? []).length;
      expect(blocks, `${row[1]} it( blocks`).toBe(Number(row[2]));
    }
    expect(read(".github/workflows/deterministic-manufacturing.yml")).toMatch(/^ {10}app\/api\/chat\/__tests__\/b21-d-chat-merge\.test\.ts$/m);
    expect(page).toContain(ROUTE_SUITE);
  });

  it("6. the \"For the lead\" section holds every reserved text in full: OD-114, OD-129, OD-130, OD-132 and OD-133 as applied, the README row, the ledger paragraph, the PROGRAM_STATE texts, the discovery closure clauses (D21-10, D21-11's envelope half, D21-12, D21-13, D21-15, D21-16, D21-17's stale clause closed; D21-14 recorded), the new findings and the section-10 amendment line", () => {
    const page = read(PAGE);
    const lead = section(page, 8);
    expect(lead.length).toBeGreaterThan(4_000);
    for (const od of ["OD-114", "OD-129", "OD-130", "OD-132", "OD-133"]) expect(lead).toMatch(new RegExp(`^### ${od} `, "m"));
    for (const heading of ["README row", "ledger paragraph", "PROGRAM_STATE", "discovery closure", "§10"]) expect(lead, heading).toContain(heading);
    for (const defect of ["D21-10", "D21-11", "D21-12", "D21-13", "D21-15", "D21-16", "D21-17"]) expect(lead).toMatch(new RegExp(`\\*\\*${defect}\\b[^*]*\\*\\*[^\\n]*(?:closed|CLOSED)`));
    expect(lead).toMatch(/\*\*D21-14\b[^*]*\*\*[^\n]*RECORDED/);
    expect(lead).toMatch(/\*\*D21-34\b/);
    expect(lead).toMatch(/\*\*D21-35\b/);
    expect(lead).toContain("MULTI-AGENT STATUS");
    // [B21 D fix: coverage-1, coverage-8, coverage-7] the clauses say what the tree does in production (pin move: the earlier
    // "escalation by construction" claim was false - an escalation needs two artifacts and no specialist carries one)
    expect(clause(lead, "D21-14")).toMatch(/not detected and NOT escalated/);
    expect(clause(lead, "D21-10")).toMatch(/CONFIRMED-unreachable/);
    expect(clause(lead, "D21-17")).toMatch(/request-time snapshot/);
    expect(clause(lead, "D21-17")).toMatch(/OPEN for\s+B21-E\/F/);
    expect(clause(lead, "D21-15")).toMatch(/manufacturing-readiness reviewer, structurally/);
    expect(clause(lead, "D21-16")).toMatch(/part review request/);
    expect(lead).toMatch(/\*\*D21-36\b/);
    expect(page).not.toMatch(/is an escalation by construction/i);
  });

  it("7. [B21 D fix] the own-code table IS `MERGE_OWN_CODES`, row for row; the review's findings table lists every confirmed finding exactly once with the cases that reproduce it, and every case it names exists in its suite", () => {
    const page = read(PAGE);
    const own = [...section(page, 2).matchAll(/^\| `([a-z:<>-]+)` \| `([a-z]+)` \| ([^|]+?) \| ([^|]+?) \|$/gm)].map((row) => ({ code: row[1]!, decision: row[2]!, claim: row[3]!, when: row[4]! }));
    expect(own).toEqual(MERGE_OWN_CODES.map((entry) => ({ code: entry.code, decision: entry.decision, claim: entry.claim, when: entry.when })));
    const rows = [...section(page, 7).matchAll(/^\| `([a-z0-9-]+)` \| ([^|]+?) \| ([^|]+?) \| ([^|]+?) \|$/gm)];
    expect(rows.map((row) => row[1]).sort()).toEqual([...REVIEW_FINDINGS].sort());
    for (const row of rows) {
      for (const reference of row[2]!.split("; ")) {
        const match = /^(b21-[a-z0-9-]+) case (\d+)$/.exec(reference);
        expect(match, `${row[1]}: ${reference}`).not.toBeNull();
        const suite = SUITES.find((path) => path.endsWith(`/${match![1]}.test.ts`));
        expect(suite, `${row[1]}: ${reference}`).toBeDefined();
        expect(read(suite!), `${row[1]}: ${reference}`).toMatch(new RegExp(`^ {2}it\\("${match![2]}\\. `, "m"));
      }
    }
  });

  it("8. [B21 D4] D21-46 closed: section 5 carries ONE dated D4 note and ONE D4 subsection - the fix on the persistence loop's own line (C87, current: the skip names the latest record's key), nothing written changed (OD-114 unchanged), the suite's row with its real `it(` count, its failing-first and no pin move - beside F3's RECORDED line, which stays; section 8 holds D4's reserved texts once (the README row, the ledger paragraph, PROGRAM_STATE, the D21-46 closure clause under its discovery title quoted exactly, the section-10 line), none claiming a record, OD-114 or a pinned replay digest moved", () => {
    const D4_SUITE = "app/lib/agent/orchestration/__tests__/b21-d4-merge-records.test.ts";
    const page = read(PAGE);
    const five = section(page, 5);
    expect(five).toContain("[B21 F3, 2026-09-28] RECORDED: not once a replayed verdict was CHAINED");
    expect(five.split("[B21 D4, 2026-09-28] D21-46 closed by B21-D4").length - 1).toBe(1);
    expect(page.split("### [B21 D4, 2026-09-28] ").length - 1).toBe(1);
    expect(five.indexOf("### [B21 D4, 2026-09-28] ")).toBeGreaterThan(0);
    const sub = five.slice(five.indexOf("### [B21 D4, 2026-09-28] ")).replace(/\s+/g, " ");
    for (const claim of ["D21-46", "OD-114", "(C87,", "`records`", "LATEST", "CHAINED", "UNCHAINED", "Nothing is written that was not written before", "a pass that wrote nothing still writes nothing", "`mergedResultsEnvelope`", "**Failing-first.**", "**Pin moves: none.**", "`replay-trace-pins-b21.json`", "**CONFIRMED**"]) expect(sub, claim).toContain(claim);
    const rows = [...sub.matchAll(/\| `((?:app|e2e)\/[^`]+\.(?:test|spec)\.ts)` \| (\d+) \|/g)];
    expect(rows.map((row) => row[1])).toEqual([D4_SUITE]);
    expect((read(D4_SUITE).match(/^\s*it\(/gm) ?? []).length).toBe(Number(rows[0]![2]));
    // C87: the fix is the skip line itself - a pass that finds the same latest verdict names that record's key, then writes nothing
    const c87 = pageCitations(page).find((citation) => citation.id === "C87");
    expect(c87).toMatchObject({ path: "app/lib/agent/orchestration/merge.ts" });
    const line = read(c87!.path).split(NEWLINE)[c87!.line - 1] ?? "";
    for (const part of [c87!.anchor, "sameVerdict(latest.record, entry.record)", "taskId: latest.taskId", "record: latest.record", "continue;", "[B21 D4]"]) expect(line, part).toContain(part);
    expect(anchorOccurrences(ROOT, c87!)).toBe(1);
    // the reserved texts (the lead's to apply): once, at the end of section 8, each named; D21-46's clause quotes the discovery's title exactly
    const eight = section(page, 8);
    const HEADING = "### B21-D4 — the reserved texts, in full (the lead's to apply)";
    expect(page.split(HEADING).length - 1).toBe(1);
    expect(eight.indexOf(HEADING)).toBeGreaterThan(eight.indexOf("### B21-F3 — the reserved texts, in full (the lead's to apply)"));
    const lead = eight.slice(eight.indexOf(HEADING));
    for (const heading of ["#### The README row", "#### The ledger paragraph", "### B21-D4 — the merge's view names the records the store holds", "#### PROGRAM_STATE.json", "#### The discovery closure clause", "**§10, B21-D4"]) expect(lead, heading).toContain(heading);
    expect(lead).toMatch(/^\| B21-D4 /m);
    const title = /\*\*D21-46 — [^*]+\*\*/.exec(read("artifacts/ai-control-plane-b21/discovery.md"))![0].replace(/\s+/g, " ");
    const flat = lead.replace(/\s+/g, " ");
    expect(flat).toContain(`- ${title} — CLOSED by B21-D4`);
    for (const overclaim of [/\brecords? (?:was|were) (?:re)?written\b/i, /\breplay (?:pin|digest)s? (?:moved|changed)\b/i, /\bOD-114 (?:is )?(?:amended|changed)\b/i, /\bdiffers between two passes that write nothing\b/i]) expect(`${sub} ${flat}`).not.toMatch(overclaim);
  });

  it("9. [B21 D4 review: coverage-1, coverage-2] D4's reserved PROGRAM_STATE `nextAction` is the one the lead applied with only its leading B21-D4 clause removed, word for word (the D21-36 retirement, the tripwire, the four validation artifacts, a normal merge and each owner question by number kept; the evidence gap's \"lead's decision\" clause not brought back); and every reserved section-10 increment line on this page (F3's, D4's) records the plan's amendment - a `Section 7, B21-<X>:` clause between its Section 6 (or 4) and Section 8 clauses - D4's naming the merge's `records` fix (C87) with nothing written changed", () => {
    const eight = section(read(PAGE), 8);
    const lead = eight.slice(eight.indexOf("### B21-D4 — the reserved texts, in full (the lead's to apply)"));
    const issues: string[] = [];
    // coverage-1: the reserved nextAction is built from the APPLIED state (the lead's PROGRAM_STATE.json), never from F3's reserved draft
    const reserved = (/`nextAction`: "([^"]+)"/.exec(lead)?.[1] ?? "").replace(/\s+/g, " ");
    const applied = String((JSON.parse(read("artifacts/remaining-builder-program/PROGRAM_STATE.json")) as { nextAction?: unknown }).nextAction ?? "");
    const D4_CLAUSE = /^B21-D4: [^;]+; then /; // present until the lead applies D4's texts; afterwards the applied nextAction IS D4's (or a later one)
    if (D4_CLAUSE.test(applied) && reserved !== applied.replace(D4_CLAUSE, "")) issues.push(`coverage-1: the reserved nextAction is not the applied one without its B21-D4 clause: ${reserved}`);
    for (const kept of ["B21-F2b: the browser half of human rejection and resume (D21-45, option a)", "B's specialistResultsEnvelope retired (D21-36), a tripwire", "commit 2/2: the four validation artifacts, the verdict, README, ledger and state", "PR #11 undrafted, green CI, a normal merge", "the one live run under OD-125 if credits exist", "OD-126's older-page question, OD-112's option A, OD-122's across-runs, at-least-once and stale-artifact options, OD-111's retention question and OD-115's first-turn options stay with the owner"]) {
      if (!reserved.includes(kept)) issues.push(`coverage-1: the reserved nextAction drops: ${kept}`);
    }
    if (/lead's decision|B21-D4/.test(reserved)) issues.push("coverage-1: the reserved nextAction brings back a clause the lead removed");
    // coverage-2: each reserved section-10 increment line carries its Section 7 clause, in order, as every section-10 entry of discovery.md does
    const tenLine = (id: string): string => {
      const start = eight.indexOf(`- **§10, ${id} (recorded by the lead, `);
      if (start < 0) return "";
      const ends = [eight.indexOf(`${NEWLINE}${NEWLINE}`, start), eight.indexOf(`${NEWLINE}- `, start)].filter((index) => index > 0);
      return eight.slice(start, ends.length > 0 ? Math.min(...ends) : undefined).replace(/\s+/g, " ");
    };
    for (const [id, plan] of [["B21-F3", "Section 7, B21-F: amended - "], ["B21-D4", "Section 7, B21-D: amended - "]] as const) {
      const line = tenLine(id);
      const at = (label: string): number => line.indexOf(label);
      if (line === "") issues.push(`coverage-2: no section-10 line for ${id}`);
      else if (at(plan) < 0) issues.push(`coverage-2: ${id}'s section-10 line has no "${plan.trim()}" clause`);
      else if (!(Math.max(at("Section 4: "), at("Section 6: ")) < at(plan) && at(plan) < at("Section 8: "))) issues.push(`coverage-2: ${id}'s Section 7 clause is out of order`);
    }
    const d4Line = tenLine("B21-D4");
    const d4Plan = d4Line.indexOf("Section 7, B21-D: amended - ") < 0 ? "" : d4Line.slice(d4Line.indexOf("Section 7, B21-D: amended - "), d4Line.indexOf("Section 8: "));
    for (const part of ["`records`", "C87", "nothing written changed", "OD-114 unchanged"]) if (!d4Plan.includes(part)) issues.push(`coverage-2: D4's Section 7 clause does not name ${part}`);
    expect(issues).toEqual([]);
  });
});
