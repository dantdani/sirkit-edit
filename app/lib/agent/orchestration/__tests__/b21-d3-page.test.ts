/**
 * [B21 D3] The page `specialist-replacement.md`, pinned by content: its sections, labels, base and tag; the option table IS what
 * `specialistGatewayOptions` returns; the proposal tables ARE `SPECIALIST_PROPOSAL_TOOL_IDS`, `DORMANT_SPECIALIST_PROPOSALS`,
 * `roleProposalToolIds` and `SEALER_CONTEXT_FACTS`; the DAG list IS `DAG_ROLE_LISTS["component-replacement"]`; the phrasing table IS what
 * the router answers; the added-module list IS the one the pin-facts suite pins; every deterministic rejection the variants name is
 * quoted from the code and every variant names the cases that prove it; every citation resolves by content exactly once and, for the
 * four modules D3 changed, on the line it states; every suite row carries its real `it(` count; the route suite is admitted to CI by one
 * explicit entry; the A..D2 pages carry their dated D3 notes; and the "For the lead" texts are all present.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { anchorOccurrences, pageCitations } from "@/app/lib/mcp/server/__tests__/_citations";
import { specialistGatewayOptions } from "@/app/api/chat/orchestration-runtime";
import { resetReplacementPinFactsSourceFactory, setReplacementPinFactsSourceFactory } from "@/app/api/chat/replacement-facts-runtime";
import { SPECIALIST_ROLES } from "../contracts";
import { DAG_ROLE_LISTS, routeTaskComplexity } from "../router";
import { DORMANT_SPECIALIST_PROPOSALS, ROLE_TOOL_REASONS, SPECIALIST_PROPOSAL_TOOL_IDS, roleProposalToolIds } from "../role-tools";
import { SEALER_CONTEXT_FACTS } from "../scheduler";
import { SCENARIO_17, SCENARIO_17_VARIANTS } from "./_d3-fixtures";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8").replaceAll(`${String.fromCharCode(13)}${NEWLINE}`, NEWLINE);
const PAGE = "artifacts/ai-control-plane-b21/specialist-replacement.md";
const BASE = "d5d3f05";
const ROUTE_SUITE = "app/api/chat/__tests__/b21-d3-chat-replacement.test.ts";
const SUITES = [
  "app/lib/agent/orchestration/__tests__/b21-d3-pin-facts.test.ts",
  "app/lib/agent/orchestration/__tests__/b21-d3-replacement-roles.test.ts",
  "app/lib/agent/orchestration/__tests__/b21-d3-scenario17.test.ts",
  "app/lib/agent/orchestration/__tests__/b21-d3-page.test.ts",
  ROUTE_SUITE,
];
/** the modules D3 changed: their cited lines must be current */
const CHANGED = ["app/lib/agent/orchestration/role-tools.ts", "app/lib/agent/orchestration/scheduler.ts", "app/lib/agent/orchestration/router.ts", "app/api/chat/orchestration-runtime.ts"];
const quoted = (value: string): string => `\`${value}\``;
const section = (page: string, from: number): string => page.slice(page.indexOf(`## ${from}. `), page.indexOf(`## ${from + 1}. `) > 0 ? page.indexOf(`## ${from + 1}. `) : undefined);
const caseTitle = (path: string, index: string): string | null => new RegExp(`^ {2}it\\("${index}\\. `, "m").test(read(path)) ? index : null;

describe("[B21 D3] the specialist-replacement page", () => {
  afterEach(() => {
    resetReplacementPinFactsSourceFactory();
  });

  it("1. the page exists with its sections in order, its labels, its base and its tag", () => {
    const page = read(PAGE);
    const headings = [...page.matchAll(/^## (\d+)\. /gm)].map((match) => Number(match[1]));
    expect(headings).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(page).toMatch(new RegExp(`^## 8\\. Citations, as of base ${BASE}`, "m"));
    for (const label of ["CONFIRMED", "RECORDED", "INFERRED", "UNKNOWN", "BLOCKED-LIVE-QUALIFICATION"]) expect(page, label).toContain(label);
    expect(page).toContain("[B21 D3]");
    expect(page).toContain("provider-reference-notes.md");
  });

  it("2. the tables ARE the code's data: the one option of the specialist gateway; the live and dormant proposals (the dormant reasons verbatim); the per-role live proposals; the sealer facts; the replacement DAG's list; the six modules the reader adds to the runtime's closure are the ones the pin-facts suite pins", () => {
    const page = read(PAGE);
    setReplacementPinFactsSourceFactory(() => ({ loadPinFacts: async () => null }));
    const options = [...section(page, 1).matchAll(/^\| `([a-zA-Z]+)` \| [^|]+ \|$/gm)].map((row) => row[1]!);
    expect(options).toEqual(Object.keys(specialistGatewayOptions() ?? {}));
    const proposals = section(page, 2);
    const rows = [...proposals.matchAll(/^\| `(sirkit\.[a-z0-9.-]+)` \| (live|dormant) \| ([^|]+?) \|$/gm)].map((row) => ({ toolId: row[1]!, state: row[2]!, reason: row[3]! }));
    expect(rows.filter((row) => row.state === "live").map((row) => row.toolId)).toEqual([...SPECIALIST_PROPOSAL_TOOL_IDS]);
    expect(rows.filter((row) => row.state === "dormant").map((row) => [row.toolId, row.reason])).toEqual(Object.entries(DORMANT_SPECIALIST_PROPOSALS));
    const roles = [...proposals.matchAll(/^\| `([a-z-]+)` \| (—|(?:`sirkit\.[a-z0-9.-]+`(?:, )?)+) \|$/gm)].map((row) => [row[1]!, row[2]!]);
    expect(roles).toEqual(SPECIALIST_ROLES.map((role) => [role, roleProposalToolIds(role).length === 0 ? "—" : roleProposalToolIds(role).map(quoted).join(", ")]));
    const facts = [...proposals.matchAll(/^\| `(sirkit\.[a-z0-9.-]+)` \| `([a-zA-Z]+)` \|$/gm)].map((row) => [row[1]!, row[2]!]);
    expect(facts).toEqual(Object.entries(SEALER_CONTEXT_FACTS));
    expect(section(page, 3)).toContain(`The list (the DAG IS \`DAG_ROLE_LISTS["component-replacement"]\`): ${DAG_ROLE_LISTS["component-replacement"].map(quoted).join(", ")}.`);
    // the added modules: the list the pin-facts suite pins, read from it (a change there must be named here)
    const suite = read("app/lib/agent/orchestration/__tests__/b21-d3-pin-facts.test.ts");
    const pinned = /expect\(added\)\.toEqual\(\[([^\]]+)\]\)/.exec(suite)![1]!.split(", ").map((entry) => (entry === "READER" ? "app/api/chat/replacement-facts-runtime.ts" : entry.replaceAll('"', "")));
    expect(pinned).toHaveLength(6);
    for (const file of pinned) expect(section(page, 1), file).toContain(quoted(file));
    expect(ROLE_TOOL_REASONS.schematic["sirkit.schematic.propose-component-replacement"]).toContain("Live since B21-D3");
  });

  it("3. the phrasing table IS what the router answers (a schematic present, a pcb_editor): the runbook's own sentence and the two variants route to `D-component-replacement`, every other row as it says; the runbook sentence on the page is the suites' own", () => {
    const page = read(PAGE);
    const rows = [...section(page, 3).matchAll(/^\| ([A-Z][^|`]+?) \| `([A-Za-z-]+)` \|$/gm)].map((row) => [row[1]!, row[2]!]);
    expect(rows.length).toBeGreaterThanOrEqual(8);
    const facts = { hasSchematic: true, hasBoard: true, actorRole: "pcb_editor" as const, autonomyMode: "proposal_only" as const, selectionCount: 0 };
    for (const [phrasing, rule] of rows) expect(routeTaskComplexity(phrasing!, facts).rule, phrasing).toBe(rule);
    for (const phrasing of [SCENARIO_17, ...SCENARIO_17_VARIANTS]) expect(rows.find((row) => row[0] === phrasing)?.[1], phrasing).toBe("D-component-replacement");
    expect(section(page, 3)).toContain("D21-38");
  });

  it("4. the scenario-17 variants: each deterministic rejection the page names in code quotes is the code's own (quoted from the family or the merge that raises it), each variant names the suite cases that prove it and those cases exist; the resolution deviation, the part review's limit, the providers' record and what D3 does NOT do are stated", () => {
    const page = read(PAGE);
    const scenario = section(page, 4);
    const sources: Record<string, string> = {
      "pins-unavailable": "app/lib/engineering/schematic-plans.ts",
      "expected-mpn-mismatch": "app/lib/engineering/replacement-proposal-assembler.ts",
      "current-pin-authority-unavailable": "app/lib/engineering/replacement-proposal-assembler.ts",
      "part-not-exact-authority": "app/lib/agent/orchestration/merge.ts",
      "request_atomic_review": "app/lib/agent/orchestration/merge.ts",
      "sealed-in-run": "app/lib/agent/orchestration/merge.ts",
      "verification-failed": "app/lib/engineering/approved-replacement-mutations.ts",
    };
    for (const [code, path] of Object.entries(sources)) {
      expect(page, code).toContain(quoted(code));
      expect(read(path), `${code} in ${path}`).toContain(`"${code}"`);
    }
    expect(scenario).toContain(quoted("conflict:same_field"));
    // [B21 D3 fix] reviewed pin move (review coverage-3 / tests-2 / tests-3): the variants are labelled by what decides them - a party
    // that cannot seal, two sealed parties (always escalated), the part review through the scheduler seam - never "resolved"
    const variants = [...scenario.matchAll(/^\| (one party cannot seal|the replacement cannot seal|both seal: escalated|part review \(scheduler seam\)) \|[^\n]*\| ([^|]+) \|$/gm)].map((row) => ({ variant: row[1]!, proof: row[2]! }));
    expect(variants.map((row) => row.variant)).toEqual(["one party cannot seal", "the replacement cannot seal", "both seal: escalated", "part review (scheduler seam)"]);
    for (const { variant, proof } of variants) {
      const scenarioCases = [...proof.matchAll(/scenario17 cases? (\d+)(?: and (\d+))?/g)].flatMap((match) => [match[1]!, ...(match[2] ? [match[2]] : [])]);
      const routeCases = [...proof.matchAll(/route case (\d+)/g)].map((match) => match[1]!);
      expect(scenarioCases.length, variant).toBeGreaterThan(0);
      for (const index of scenarioCases) expect(caseTitle("app/lib/agent/orchestration/__tests__/b21-d3-scenario17.test.ts", index), `${variant}: scenario17 case ${index}`).toBe(index);
      for (const index of routeCases) expect(caseTitle(ROUTE_SUITE, index), `${variant}: route case ${index}`).toBe(index);
    }
    for (const claim of ["RECORDED as a deviation", "withholds every presentation", "never reaches the merge", "in ONE route run", "resume", "B21-E1", "B21-F", "one provider is one source", "never-execution sweep"]) expect(scenario, claim).toContain(claim);
    const not = section(page, 5).toLowerCase();
    for (const claim of ["no new exposed tool", "no new route", "no new run event", "no ui change", "no grant", "no minter", "no long-running proposal", "no reserved-file edit", "165"]) expect(not, claim).toContain(claim);
  });

  it("5. every citation resolves by content exactly once, ids run C1..Cn; for the four modules D3 changed the cited line IS current and each is cited; every suite row names a file with the `it(` count it states; the route suite is admitted to CI by one explicit entry", () => {
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
    expect(read(".github/workflows/deterministic-manufacturing.yml").match(/^ {10}app\/api\/chat\/__tests__\/b21-d3-chat-replacement\.test\.ts$/gm)).toHaveLength(1);
  });

  it("6. the A..D2 pages carry their dated D3 notes naming this page: B's rule table and DAG list are the router's (its row updated), C's role table cell is the live reason and a note says four entries are live, D's note on the dormant replacement, D2's notes restating D21-37, scenario 17 and the dormant replacement; B's C46 and C's C33 re-pinned to the specialist gateway's construction line with a D3 note", () => {
    const note = /\[B21 D3, 2026-09-26\][^\n]*specialist-replacement\.md/;
    for (const path of ["task-complexity-router.md", "specialist-roles.md", "merge-and-disagreement.md", "specialist-proposals.md"]) expect(read(`artifacts/ai-control-plane-b21/${path}`), path).toMatch(note);
    const roles = read("artifacts/ai-control-plane-b21/specialist-roles.md");
    expect(roles).toMatch(/\[B21 D3, 2026-09-26\] Four of those entries \(three distinct ids\) are LIVE since B21-D3/);
    expect(roles).toMatch(/^\| C33 \| `app\/api\/chat\/orchestration-runtime\.ts` \| 240 \| — \| `const specialistGateway = createAgentToolGateway\(deps\.registry, specialistGatewayOptions\(request\.signal\)\);` \| [^\n]*\[B21 D3\]/m); // [B21 closeout, 2026-09-29] reviewed pin move 260 -> 240: the D21-36 retirement deleted B's envelope (20 lines) above the anchor
    const router = read("artifacts/ai-control-plane-b21/task-complexity-router.md");
    expect(router).toMatch(/^\| C46 \| `app\/api\/chat\/orchestration-runtime\.ts` \| 240 \| — \| `const specialistGateway = createAgentToolGateway\(deps\.registry, specialistGatewayOptions\(request\.signal\)\);` \| [^\n]*\[B21 D3\]/m); // [B21 closeout, 2026-09-29] reviewed pin move 260 -> 240: the D21-36 retirement deleted B's envelope (20 lines) above the anchor
    expect(router).toMatch(/`D-component-replacement`[^\n]*\[B21 D3, 2026-09-26\]/);
    const proposals = read("artifacts/ai-control-plane-b21/specialist-proposals.md");
    const scenario = section(proposals, 4);
    expect(scenario).toMatch(/\[B21 D3, 2026-09-26\][^\n]*scenario 17[^\n]*specialist-replacement\.md/);
    expect(scenario).toMatch(/\[B21 D3, 2026-09-26\][^\n]*D21-37[^\n]*CLOSED/);
    expect(section(proposals, 1)).toMatch(/\[B21 D3, 2026-09-26\][^\n]*replacement[^\n]*live/i);
    // no D3 note may say the replacement stays dormant or that scenario 17 stays without a structural disagreement
    for (const path of ["task-complexity-router.md", "specialist-roles.md", "merge-and-disagreement.md", "specialist-proposals.md"]) {
      expect(read(`artifacts/ai-control-plane-b21/${path}`), path).not.toMatch(/\[B21 D3, 2026-09-26\][^\n]*\b(?:stays|remains|is still) dormant\b/i);
    }
  });

  it("7. the \"For the lead\" section holds every reserved text in full: OD-107, OD-109 and OD-120 amended, the README row for B21-D3, the ledger paragraph, the PROGRAM_STATE texts (next B21-E), the discovery closure clauses (D21-37 CLOSED, [B21 D3 fix] D21-16's route half: the envelope capability CONFIRMED and CONFIRMED-unreachable from a production POST, D21-10's addendum, D21-38 new) and the section-10 amendment line", () => {
    const lead = section(read(PAGE), 7);
    expect(lead.length).toBeGreaterThan(4_000);
    for (const od of ["OD-107", "OD-109", "OD-120"]) expect(lead).toMatch(new RegExp(`^### ${od} `, "m"));
    for (const heading of ["README row", "ledger paragraph", "PROGRAM_STATE", "discovery closure", "§10"]) expect(lead, heading).toContain(heading);
    expect(lead).toMatch(/^\| B21-D3 /m);
    expect(lead).toMatch(/\*\*D21-37\b[^*]*\*\*[^\n]*CLOSED by B21-D3/);
    // [B21 D3 fix] reviewed pin move (review coverage-2 / tests-3): the route half is NOT closed - the envelope renders the part review
    // (through the scheduler seam) and a production POST cannot produce it until B21-E's route-level resume
    expect(lead).toMatch(/\*\*D21-16\b[^*]*\*\*[^\n]*the route half[^\n]*CONFIRMED-unreachable from a production POST/);
    expect(lead).not.toMatch(/the route half CLOSED/);
    expect(lead).toMatch(/\*\*D21-10\b[^*]*\*\*[^\n]*addendum by B21-D3/);
    expect(lead).toMatch(/\*\*D21-38 \(new, low\)/);
    expect(lead).toMatch(/next B21-E/);
    expect(lead).toContain("MULTI-AGENT STATUS");
  });

  it("8. the page records what the tree enforces, no more: the reader's closure (the D21-32 chain, the database client, nothing the coordinator's read does not already use), an absent source never faked, the approval path not refusing a specialist-sealed replacement, the composer gap, and live behaviour BLOCKED-LIVE-QUALIFICATION", () => {
    const page = read(PAGE);
    const pin = section(page, 1);
    for (const claim of ["D21-32", "`postgres`", "`current-pin-authority-unavailable`", "never faked", "request's signal", "`DEFAULT_PIN_FACTS_DEADLINE_MS`"]) expect(pin, claim).toContain(claim);
    expect(pin).toMatch(/nothing\s+the\s+coordinator's\s+read\s+does\s+not\s+already\s+use/i);
    expect(section(page, 4).replace(/\s+/g, " ")).toContain("does NOT refuse an artifact sealed under a specialist run id"); // the page wraps its lines
    expect(section(page, 3)).toMatch(/composer[^\n]*rule 8/);
    expect(section(page, 6)).toContain("BLOCKED-LIVE-QUALIFICATION");
  });

  it("9. [B21 D3 fix] (review regressions-3, security-2, coverage-6) every A..D2 statement D3 made untrue carries a dated D3 note IN ITS OWN BLOCK (paragraph or bullet), pinned by the claim it restates: D2's 'Zero authority by construction' (the bare gateway with no option; no replacement ever offered to a specialist), C's zero-authority paragraph and its '(C33, no option at all)' sentence, B's 'built with no option at all (C46)' - each note naming the route's pin-facts reader as the specialist gateway's one option and the schematic role as the one offered the replacement; B's 'one grammar, never a wider copy' noted as a superset since D3; D2's part-review note and D's D3 note keep the route statement standing (CONFIRMED-unreachable from a production POST)", () => {
    const pages = Object.fromEntries(["task-complexity-router.md", "specialist-roles.md", "merge-and-disagreement.md", "specialist-proposals.md"].map((path) => [path, read(`artifacts/ai-control-plane-b21/${path}`)]));
    const BLOCK = "(?:(?!\\n\\n|\\n- |\\n {2}- )[\\s\\S])*?"; // within the same paragraph or bullet
    const noted = (stale: string, ...claims: string[]): RegExp => new RegExp(`${stale}${BLOCK}\\[B21 D3, 2026-09-26\\][^\\n]*${claims.join("[^\\n]*")}`);
    const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const cases: Array<[string, string, string[]]> = [
      ["specialist-proposals.md", "the ONE bare gateway the composition root builds with no option", ["pin-facts reader", "schematic"]],
      ["specialist-proposals.md", "no replacement is ever offered to a specialist", ["pin-facts reader", "schematic"]],
      ["specialist-roles.md", "the composition root's one bare specialist gateway, C33, is the only one under every wrapper", ["pin-facts reader", "schematic"]],
      ["specialist-roles.md", "ONE bare specialist gateway (C33, no option at all)", ["pin-facts reader", "schematic"]],
      ["task-complexity-router.md", "the SPECIALIST gateway is built with no option", ["pin-facts reader", "schematic"]], // "... at all (C46)" wraps to the next line
      ["task-complexity-router.md", "one grammar, never a wider copy", ["superset"]],
    ];
    for (const [path, stale, claims] of cases) {
      expect(pages[path], `${path}: ${stale}`).toContain(stale);
      expect(pages[path], `${path}: ${stale}`).toMatch(noted(escape(stale), ...claims.map(escape)));
    }
    // the D2 part-review note and D's D3 note: the route statement stands - the envelope renders it, a production POST cannot produce it
    expect(pages["specialist-proposals.md"]).not.toContain("reaches the route's envelope from a real seal");
    expect(pages["specialist-proposals.md"]).toMatch(/which the route never performs \(a fresh\s+run id per POST\)[\s\S]{0,400}\[B21 D3, 2026-09-26\][^\n]*CONFIRMED-unreachable from a production POST/);
    expect(pages["merge-and-disagreement.md"]).toMatch(/\[B21 D3, 2026-09-26\][^\n]*CONFIRMED-unreachable from a production POST/);
    expect(pages["merge-and-disagreement.md"]).not.toMatch(/\[B21 D3, 2026-09-26\][^\n]*part review reaches the route's envelope for a seal/);
  });

  it("10. [B21 D3 fix] (review coverage-2, coverage-3, coverage-5, tests-2, tests-3) the page states what the tree enforces: the order is a presentation and budget order only (no specialist reads another's result before B21-E); no scenario-17 disagreement between two sealed parties is resolved - they always escalate, and a party whose edit cannot seal never reaches the merge (the agent path's empty pin map), so presenting or escalating follows the circuit specialist's op choice (an open OD-122 question); OD-130's part review renders at the envelope through the scheduler seam and is CONFIRMED-unreachable from a production POST; neither the page, its reserved texts, the D2 notes nor router.ts claims otherwise; the phrasing table carries the review's phrasings", () => {
    const page = read(PAGE);
    const flat = (text: string): string => text.replace(/\s+/g, " ");
    const order = flat(section(page, 3));
    for (const claim of ["a presentation and budget order", "no specialist reads another's result before B21-E", "history is empty", "the verified exact authority"]) expect(order, claim).toContain(claim);
    const scenario = flat(section(page, 4));
    for (const claim of ["one party cannot seal", "always escalate", "EMPTY pin map", "op choice", "open OD-122 question", "scheduler seam", "CONFIRMED-unreachable from a production POST", "route case 7", "scenario17 case 7", "scenario17 case 8"]) expect(scenario, claim).toContain(claim);
    const lead = flat(section(page, 7));
    for (const claim of ["two SEALED parties", "always escalated", "never reaches the merge", "op choice", "CONFIRMED-unreachable from a production POST", "route-level resume"]) expect(lead, claim).toContain(claim);
    for (const stale of ["the evidence precedes the seal", "reads last, after every proposing role", "resolved by the families' and the merge's deterministic checks", "the route half CLOSED", "OD-130's part review at the route's envelope from a resumed seal", "Resolved by a verifier, never by count"]) {
      expect(flat(page), stale).not.toContain(stale);
      expect(flat(read("artifacts/ai-control-plane-b21/specialist-proposals.md")), stale).not.toContain(stale);
    }
    expect(read("app/lib/agent/orchestration/router.ts")).not.toContain("the evidence precedes the seal");
    // the review's phrasings are rows of the phrasing table (case 3 checks each row against the router)
    const rows = [...section(page, 3).matchAll(/^\| ([A-Z][^|`]+?) \| `([A-Za-z-]+)` \|$/gm)].map((row) => row[1]!);
    for (const phrasing of ["Please replace C3 with 10uF for the LDO.", "Replace the decoupling cap for the regulator.", "Swap R4 and R5 for the op-amp gain.", "Replace the footprint for the regulator with SOT-223.", "Why did you replace R1 with a 10k for the op-amp?", "Do not replace U1 with a different timer, just explain its pinout.", "Replace R1 with 4k7 for a timer.", "Replace C5 with 10uF near the regulator."]) expect(rows, phrasing).toContain(phrasing);
  });
});
