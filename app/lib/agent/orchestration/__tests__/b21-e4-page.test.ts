/**
 * [B21 E4] The page `composer-and-first-turn.md`, pinned by content: its sections, labels, base and tag; section 1's counts, digests,
 * residue list, rule line and exports ARE the code's and the suites'; section 2's reason, line, purpose and in-place route lines ARE the
 * runtime's and the route's; every citation resolves by content exactly once and, for every production file E4 changed, on the line it
 * states; every suite row carries its real `it(` count; the two new explicit suites are admitted to CI by one entry each; the B, D3 and
 * E1 pages carry their dated E4 notes in the blocks E4 changed and their re-pinned rows; what E4 does not do is stated; and the "For the
 * lead" texts are all present, the discovery titles quoted exactly.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { anchorOccurrences, pageCitations } from "@/app/lib/mcp/server/__tests__/_citations";
import * as composerModule from "@/app/lib/project/composer-routing";
import { REPLACE_PART, partKindSwap, routeComposerMessage } from "@/app/lib/project/composer-routing";
import { FIRST_TURN_PAUSED_REASON, firstTurnPausedLine } from "@/app/api/chat/orchestration-runtime";
import { PROVIDER_FAILURES_WITHOUT_RETRY } from "@/app/lib/ai-preferences";
import { providerRetryOffered } from "@/app/lib/agent/run-consumer";
import { normalizeRouterMessage } from "../router";
import { FALSE_DAG, RECORDED_SEMANTIC, REPLACEMENT_REQUESTS } from "./_d3-router-corpus";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8").replaceAll(`${String.fromCharCode(13)}${NEWLINE}`, NEWLINE);
const PAGE = "artifacts/ai-control-plane-b21/composer-and-first-turn.md";
const BASE = "fafc90e";
const COMPOSER_SUITE = "app/lib/project/__tests__/b21-e4-composer-routing.test.ts";
const GRAMMAR_SUITE = "app/lib/agent/orchestration/__tests__/b21-e4-replacement-grammar.test.ts";
const ROUTE_SUITE = "app/api/chat/__tests__/b21-e4-chat-first-turn.test.ts";
const SUITES = [COMPOSER_SUITE, GRAMMAR_SUITE, "app/lib/agent/orchestration/__tests__/b21-e4-first-turn.test.ts", ROUTE_SUITE, "app/lib/agent/orchestration/__tests__/b21-e4-page.test.ts"];
/** the production files E4 changed: their cited lines must be current, and each is cited */
const CHANGED = ["app/lib/project/composer-routing.ts", "app/lib/agent/orchestration/router.ts", "app/api/chat/route.ts", "app/api/chat/orchestration-runtime.ts", "app/lib/ai-preferences.ts"];
const section = (page: string, from: number): string => page.slice(page.indexOf(`## ${from}. `), page.indexOf(`## ${from + 1}. `) > 0 ? page.indexOf(`## ${from + 1}. `) : undefined);
const digestsIn = (text: string): string[] => [...text.matchAll(/eng1-[0-9a-f]{16}/g)].map((match) => match[0]!);
const lineOf = (source: string, marker: string): string => source.split(NEWLINE).find((line) => line.includes(marker))!;
const lineCount = (path: string): number => read(path).split(NEWLINE).length - 1;

describe("[B21 E4] the composer-and-first-turn page", () => {
  it("1. the page exists with its sections in order, its labels, its base and its tag; it is ONE new page and names the three pages that carry its dated notes", () => {
    const page = read(PAGE);
    expect([...page.matchAll(/^## (\d+)\. /gm)].map((match) => Number(match[1]))).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(page).toMatch(new RegExp(`^## 6\\. Citations, as of base ${BASE}`, "m"));
    for (const label of ["CONFIRMED", "INFERRED", "RECORDED", "UNKNOWN", "BLOCKED-LIVE-QUALIFICATION"]) expect(page, label).toContain(label);
    expect(page).toContain("`[B21 E4,");
    expect(page).toContain("This is ONE new page for B21-E4");
    for (const other of ["specialist-replacement.md", "task-complexity-router.md", "provider-routing-and-failure.md"]) expect(page.slice(0, page.indexOf("## 0. ")), other).toContain(other);
  });

  it("2. section 1 IS the code's and the suites': the corpus sizes; HEAD's recorded digests (the router's five, the grammar's, the composer's) are the suites' own constants; the moves the composer suite pins; the 36 residues listed ARE the recorded residues the pairing misses, each now asking; the rule line; the module's exports; the router's new length", () => {
    const one = section(read(PAGE), 1);
    const flat = one.replace(/\s+/g, " ");
    expect([FALSE_DAG.length, REPLACEMENT_REQUESTS.length, RECORDED_SEMANTIC.length]).toEqual([1007, 194, 46]);
    expect(flat).toContain("1007 false DAG phrasings, 194 genuine requests, 46 recorded semantic residues");
    const grammar = read(GRAMMAR_SUITE);
    const recorded = [...digestsIn(lineOf(grammar, "const HEAD_ROUTER_ANSWERS")), ...digestsIn(lineOf(grammar, "const HEAD_GRAMMAR")), ...digestsIn(lineOf(read(COMPOSER_SUITE), "const HEAD_COMPOSER_DIGEST"))];
    expect(recorded).toHaveLength(7);
    for (const digest of recorded) expect(one, digest).toContain(digest);
    expect(lineOf(grammar, "const HEAD_GRAMMAR")).toContain("count: 47");
    expect(flat).toContain("47 code lines");
    const composerSuite = read(COMPOSER_SUITE);
    for (const pinned of ["entry.from !== entry.to)).toHaveLength(133)", "entry.from !== entry.to)).toHaveLength(36)", "entry.from === entry.to)).toHaveLength(46)", "{ edit: 652, ask: 355, generate: 0 }"]) expect(composerSuite, pinned).toContain(pinned);
    for (const claim of ["133 genuine requests and 36 residues", "46 genuine polite or question-form requests", "652 schematic edits and 355 assistant requests"]) expect(flat, claim).toContain(claim);
    const listed = [...one.matchAll(/^- `([^`]+)`$/gm)].map((match) => match[1]!);
    const missed = RECORDED_SEMANTIC.filter((text) => !REPLACE_PART.test(text.trim().toLowerCase()));
    expect(listed).toEqual(missed);
    expect(listed).toHaveLength(36);
    for (const text of listed) {
      expect(partKindSwap(normalizeRouterMessage(text), text), text).toBe(true);
      expect(routeComposerMessage(text, true).route, text).toBe("ask");
    }
    const rule = "if (REPLACE_PART.test(t) || partKindSwap(replacementMessage(text), text)) return routed(\"ask\", ";
    expect(read("app/lib/project/composer-routing.ts")).toContain(rule);
    expect(flat).toContain(`${rule}...)`);
    expect(Object.keys(composerModule).sort()).toEqual(["COMPOSER_ROUTE_LABELS", "POLITE", "REPLACE_PART", "partKindSwap", "routeComposerMessage"]);
    expect(flat).toContain("`REPLACE_PART`, `partKindSwap`, `POLITE` and `routeComposerMessage`");
    expect(lineCount("app/lib/agent/orchestration/router.ts")).toBe(186);
    expect(flat).toContain("186 lines instead of 291");
  });

  it("3. section 2 IS the runtime's and the route's: the reason and the line's prefix quoted are the runtime's; the reason is one the card never retries; the purpose is `interactive`; B21-B's four HEAD digests quoted are the route suite's; route.ts keeps 562 lines and exactly its lines 35, 504 and 507 carry the E4 tag", () => {
    const two = section(read(PAGE), 2).replace(/\s+/g, " ");
    expect(FIRST_TURN_PAUSED_REASON).toBe("provider_breaker_open");
    expect(two).toContain("`provider_breaker_open` (C21)");
    const prefix = firstTurnPausedLine({ reason: "breaker_open", message: "", retryAtMs: 0 });
    expect(prefix).toBe("No model call was made for this message: ");
    expect(two).toContain(`\`${prefix}\``);
    expect(PROVIDER_FAILURES_WITHOUT_RETRY).toContain(FIRST_TURN_PAUSED_REASON);
    expect(providerRetryOffered(FIRST_TURN_PAUSED_REASON)).toBe(false);
    expect(two).toContain("the `interactive` purpose's ceiling - the whole PROCESS-WIDE window"); // [B21 E4 fix: security-1] never "the person's share": the window is every principal's
    expect(two).not.toMatch(/the person's (?:`interactive` |whole )share/);
    expect(read("app/api/chat/orchestration-runtime.ts")).toContain('.pause(input.provider, undefined, "interactive", ');
    const heads = digestsIn(lineOf(read(ROUTE_SUITE), "const HEAD_DIGESTS"));
    expect(heads).toHaveLength(4);
    for (const digest of heads) expect(two, digest).toContain(digest);
    const route = read("app/api/chat/route.ts").split(NEWLINE);
    expect(route.length - 1).toBe(562);
    expect(route.flatMap((line, index) => (line.includes("[B21 E4]") ? [index + 1] : []))).toEqual([35, 504, 507]);
    expect(two).toContain("keeps its 562 lines");
    for (const at of ["(C15, line 35)", "(C16, line 504)", "(C17, line 507)"]) expect(two, at).toContain(at);
  });

  it("4. every citation resolves by content exactly once, ids run C1..Cn; for every production file E4 changed the cited line IS current and each is cited; every suite row names a file with the `it(` count it states; the route suite and the composer suite are admitted to CI by one explicit entry each", () => {
    const page = read(PAGE);
    const citations = pageCitations(page);
    expect(citations.length).toBeGreaterThanOrEqual(30);
    expect(citations.map((citation) => citation.id)).toEqual(citations.map((_, index) => `C${index + 1}`));
    const wrong = citations.filter((citation) => anchorOccurrences(ROOT, citation) !== 1).map((citation) => `${citation.id} ${citation.path}: ${anchorOccurrences(ROOT, citation)}`);
    expect(wrong).toEqual([]);
    for (const path of CHANGED) expect(citations.some((citation) => citation.path === path), path).toBe(true);
    const stale = citations.filter((citation) => CHANGED.includes(citation.path) && !(read(citation.path).split(NEWLINE)[citation.line - 1] ?? "").includes(citation.anchor)).map((citation) => `${citation.id} ${citation.path}:${citation.line}`);
    expect(stale).toEqual([]);
    const rows = [...page.matchAll(/^\| `((?:app|e2e)\/[^`]+\.(?:test|spec)\.ts)` \| (\d+) \|/gm)];
    expect(rows.map((row) => row[1])).toEqual(expect.arrayContaining(SUITES));
    for (const row of rows) expect((read(row[1]!).match(/^\s*it\(/gm) ?? []).length, `${row[1]} it( blocks`).toBe(Number(row[2]));
    const workflow = read(".github/workflows/deterministic-manufacturing.yml");
    for (const suite of [ROUTE_SUITE, COMPOSER_SUITE]) expect(workflow.match(new RegExp(`^ {10}${suite.replaceAll("/", "\\/").replaceAll(".", "\\.")}$`, "gm")), suite).toHaveLength(1);
  });

  it("5. the B, D3 and E1 pages carry their dated E4 notes IN the blocks whose statements E4 changed, and the re-pinned rows carry them: B's C35 (the import line), D3's C10 and C34 (now in composer-routing.ts), D3's phrasing bullet and its D21-38 record, B's replacement rule, E1's breaker paragraph and its first-turn paragraph", () => {
    const NOTE = "\\[B21 E4, 2026-09-28\\]";
    const BLOCK = "(?:(?!\\n\\n|\\n- |\\n {2}- )[\\s\\S])*?";
    const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const noted = (stale: string): RegExp => new RegExp(`${escape(stale)}${BLOCK}${NOTE}`);
    const b = read("artifacts/ai-control-plane-b21/task-complexity-router.md");
    const d3 = read("artifacts/ai-control-plane-b21/specialist-replacement.md");
    const e1 = read("artifacts/ai-control-plane-b21/provider-routing-and-failure.md");
    expect(b).toMatch(new RegExp(`^\\| C35 \\| \`app/lib/agent/orchestration/router\\.ts\` \\| 23 \\| — \\| \`import \\{ POLITE, partKindSwap \\} from "\\.\\./\\.\\./project/composer-routing";\` \\| [^\\n]*${NOTE}`, "m"));
    expect(d3).toMatch(new RegExp(`^\\| C10 \\| \`app/lib/project/composer-routing\\.ts\` \\| \\d+ \\| — \\| \`const PART_KIND_SWAP = \` \\| [^\\n]*${NOTE}`, "m"));
    expect(d3).toMatch(new RegExp(`^\\| C34 \\| \`app/lib/project/composer-routing\\.ts\` \\| \\d+ \\| — \\| \`function partKindSwap\\(message: string, raw: string\\): boolean \\{\` \\| [^\\n]*${NOTE}`, "m"));
    expect(b).toMatch(noted("the imported pairing kept as the part words' agreement check"));
    expect(d3).toMatch(noted("the router still imports `REPLACE_PART` and requires it to agree."));
    expect(d3).toMatch(noted("**RECORDED (D21-38, low):**"));
    expect(e1).toMatch(noted("specialists make no call at all under the `provider_paused` line)."));
    expect(e1).toMatch(noted("**Not the coordinator's first turn (RECORDED).**"));
    for (const page of [b, d3, e1]) expect(page).toContain("composer-and-first-turn.md");
  });

  it("6. what E4 does NOT do is stated: no exposed tool, descriptor, route or generator input (census 165), no UI control and no B17-A rule change, no run-event type, reason or request key, no router answer changed, no metering of the first turn, no evaluations, no reserved-file edit", () => {
    const not = section(read(PAGE), 3).toLowerCase().replace(/\s+/g, " ");
    for (const claim of ["no new exposed tool", "165 = 162 canonical + 3 factories + 0 raw", "zero drift", "no new ui control", "no b17-a rule change", "no b18-d wire", "no new run-event type", "request key", "no router answer changed", "no metering of the first turn", "no evaluations", "no reserved-file edit"]) expect(not, claim).toContain(claim);
  });

  it("7. the \"For the lead\" section holds every reserved text in full: OD-115 amended, the README row for B21-E4, the ledger paragraph, the PROGRAM_STATE texts (next B21-F), the discovery closure clauses - D21-38 and D21-39 CLOSED and D21-18's addendum, each title quoted exactly from discovery.md - the §10 line and the report line; no placeholder is left anywhere on the page", () => {
    const page = read(PAGE);
    const lead = section(page, 5);
    expect(lead.length).toBeGreaterThan(4_000);
    expect(lead).toMatch(/^### OD-115 /m);
    for (const heading of ["README row", "ledger paragraph", "PROGRAM_STATE", "Discovery closure", "§10, B21-E4"]) expect(lead, heading).toContain(heading);
    expect(lead).toMatch(/^\| B21-E4 /m);
    expect(lead).toMatch(/^### B21-E4 — /m);
    expect(lead).toMatch(/next B21-F/);
    expect(lead).toContain("MULTI-AGENT STATUS");
    const discovery = read("artifacts/ai-control-plane-b21/discovery.md");
    for (const [defect, closure] of [["D21-38", "CLOSED by B21-E4"], ["D21-39", "CLOSED by B21-E4"], ["D21-18", "addendum by B21-E4"]] as const) {
      const title = new RegExp(`\\*\\*${defect} — [^*]+\\*\\*`).exec(discovery)![0].replace(/\s+/g, " "); // the title as discovery.md words it (its own line wrap aside)
      expect(lead.replace(/\s+/g, " "), defect).toContain(`- ${title} — ${closure}`);
    }
    for (const placeholder of ["G1_FILES", "G1_TESTS", "ESLINT_RESULT", "TODO", "TBD"]) expect(page, placeholder).not.toContain(placeholder);
  });

  it("8. [B21 E4 fix] the review's findings are answered on the page: section 4 lists all seven with the suite and case that reproduce each; section 2 states the trial-in-flight rule (C37), the PROCESS-WIDE window and its cross-tenant consequence, that the gate never fires on a flag-off process, the one-window limit under persistent no-credits and D21-42; section 1 states the linear scans; the \"For the lead\" texts carry D21-42 and the narrowed D21-39 and D21-18 clauses; the D3 page's phrasing note supersedes its stale clause in words", () => {
    const page = read(PAGE);
    const four = section(page, 4);
    expect(four).toContain("### The review's findings (E4)");
    const findings = four.slice(four.indexOf("### The review's findings (E4)"));
    for (const id of ["regressions-1", "security-1", "security-3", "coverage-1", "coverage-2", "coverage-4", "tests-1"]) expect(findings, id).toMatch(new RegExp(`^\\| \`${id}\` \\|`, "m"));
    const two = section(page, 2).replace(/\s+/g, " ");
    for (const claim of ["a half-open breaker whose one trial call is in flight never gates the first turn (C37)", "PROCESS-WIDE", "every tenant's first turn", "the gate never fires on a flag-off process", "at most ONE window", "D21-42"]) expect(two, claim).toContain(claim);
    const one = section(page, 1).replace(/\s+/g, " ");
    for (const claim of ["from its START alone", "(C38)", "(C39)"]) expect(one, claim).toContain(claim);
    const lead = section(page, 5).replace(/\s+/g, " ");
    expect(lead).toContain("**D21-42 — The llm-provider breaker is armed only by metered calls");
    for (const claim of ["the gate never fires on a flag-off process", "at most ONE window", "OPENED by B21-E4's review"]) expect(lead, claim).toContain(claim);
    const d3 = read("artifacts/ai-control-plane-b21/specialist-replacement.md").replace(/\s+/g, " ");
    expect(d3).toContain("the router still imports `REPLACE_PART` and requires it to agree. [B21 E4, 2026-09-28] Superseded: since B21-E4 the router no longer imports `REPLACE_PART`");
    expect(read("artifacts/ai-control-plane-b21/task-complexity-router.md")).toMatch(/^\| C35 \| [^\n]*no longer imports `REPLACE_PART`/m);
  });
});
