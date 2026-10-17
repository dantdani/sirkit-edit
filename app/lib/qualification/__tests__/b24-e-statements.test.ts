/**
 * [B24-E] The statement tripwire (runbook `:1025` "not permission to overstate physical validation", `:1123` "do not convert a
 * fake-backed result into a live claim", `:1157`; D24-33, OD-217), after `b22-closeout-statements` and `b23-closeout-statements`,
 * which it edits not. No production copy (the sources under app, lib, components and scripts, the three browser-spec folders and the
 * root source files) and no page (every artifacts Markdown page but the lead's records, B24's README and discovery and the qualification
 * matrix; the docs; the root README) claims a live, staging or physical pass the matrix does not hold, in a closed vocabulary:
 *
 *  (a) a live provider turn or evaluation passed, or a multi-agent run with live models passed (LB-2, LB-7, LB-9; Q1, Q15);
 *  (b) production or staging authentication passed (LB-1, LB-13; Q2);
 *  (c) a live distributor check passed (LB-15; Q3);
 *  (d) a run on the qualified sandbox platform (LB-10; Q4);
 *  (e) a board fabricated, assembled, inspected, functionally or electrically tested, or physically validated (LB-5; Q7, Q8);
 *  (f) a blocked readiness scope (runbook `:1146-1155`) stated as ready;
 *  (g) a real-server or staging database property verified (LB-4, LB-14; Q9, Q10) - LB-4's 2026-09-24 run the one allowed instance;
 *  (h) Sirkit deployed to, or verified on, a staging or production environment (LB-13; Q11);
 *  (i) a live external MCP server consumed, or its contract passed (LB-16; Q12);
 *  (j) the kicad-cli live oracle passed (LB-17; Q13);
 *  (k) a live router run in CI or on a qualified runner (LB-3, LB-8; Q4);
 *  (l) a live DFM, quote or order exchange with a provider (LB-11, LB-12; Q5).
 *
 * A statement is admitted by exactly one of: it is negated or conditional (a negation or condition that governs it, read locally as
 * B23's tripwire reads one - see `negatedOrConditional` - or, for a negation of a shape that rule does not parse, a reviewed exact text);
 * an allow-list entry by exact text, with its reason, its count and the matrix row whose recorded live runs hold it; or B24-E's dated
 * in-place note after the statement it supersedes. It is a vocabulary: a phrasing outside it is not seen (page part 3 lists every form).
 * [B24-E review, 2026-10-10] correctness-2, security-2: a negation, condition or time word anywhere earlier in the sentence used to admit
 * a claim ("When the owner supplied the project, production authentication passed."); now only one that governs it does (case 3).
 * correctness-3: a note used to admit every claim before it on its line; now only the statement it supersedes (case 3). Test files
 * are not copy. The suite also holds B24-E's in-place notes on the register's retired vocabulary, and the finds left for the
 * closeout's one table (OD-221). Every foreign note prefix, tag and claim word is assembled at run time, so this file spells none.
 * Failing first on 6e4e1bb: no note and no matrix exist (qualification-matrix.md part 3). Files are read as text; nothing is written to
 * disk and no process is started. The walks yield between files.
 * [PR-G, 2026-10-17] The pages not read also hold the owner's own assignment of the post-B24 work (EXCLUDED's note): instruction text.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { matrixRows, type MatrixRow } from "./_b24-e-register";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const cache = new Map<string, string>();
const read = (path: string): string => {
  let text = cache.get(path);
  if (text === undefined) {
    try {
      text = readFileSync(join(ROOT, path), "utf8").replaceAll(`${CR}${NEWLINE}`, NEWLINE);
    } catch {
      text = "";
    }
    cache.set(path, text);
  }
  return text;
};
const SELF = "app/lib/qualification/__tests__/b24-e-statements.test.ts";
const MATRIX = "artifacts/ai-control-plane-b24/qualification-matrix.md";
/** B24-E's dated in-place note, as every statement it supersedes carries it. */
const NOTE = "[superseded 2026-10-10 by B24-E (D24-33, OD-217): ";
/** The B21, B22 and B23 closeouts' note prefixes and tags, assembled so this file never spells one. */
const FOREIGN = [["[superseded 2026-09-29 by the B21 clos", "eout ("], ["[superseded 2026-10-02 by the B22 clos", "eout ("], ["[superseded 2026-10-05 by the B23 clos", "eout ("], ["[B21 clos", "eout, 2026-09-29]"], ["[B22 clos", "eout, 2026-10-02]"], ["[B23 clos", "eout, 2026-10-05]"]].map((parts) => parts.join(""));
/** ... and the claim words their tripwires scan notes for, assembled the same way; a note never holds a table's cell separator. "isolated"
 *  is OD-191's word for the staging project: B22's forms need it beside ngspice, a smoke test, a fixture or queued jobs, which no B24-E
 *  note names. */
const FOREIGN_WORDS = new RegExp([String.raw`single[- ]agent`, String.raw`\bsand` + "box", String.raw`\bno net` + String.raw`work\b`, "exactly" + " 12", "five" + " spawners", String.raw`\|`].join("|"), "i");

// ── the vocabulary ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A space, or a line break with the comment or quote prefix of the next line. */
const S = String.raw`[\s*/>]+`;
/** One word (code spans and dotted names included). */
const WORD = String.raw`[\w'()\x60-]+(?:\.\w+)*`;
/** Up to n words between a subject and its verb. */
const GAP = (n: number): string => String.raw`(?:${S}${WORD}){0,${n}}?`;
/** Auxiliaries and adverbs before a verb, at least `min`. */
const AUX = (min: number): string => String.raw`(?:(?:has|have|had|was|were|is|are|been|now|all|already|also|then)${S}){${min},3}`;
const PASS = "(?:passed|succeeded|qualified|exercised)";

/** Every form of the claim: [kind (the task's letter), form id, source]. Case 3 reports each by its own examples. */
const FORMS: ReadonlyArray<readonly [kind: string, form: string, source: string]> = [
  ["a", "live-provider-passed", String.raw`\b(?:live|real)${S}(?:provider|model|OpenAI|Anthropic|LLM)s?(?:${S}(?:turns?|calls?|runs?|evaluations?|contract${S}turns?|capsules?))?${GAP(6)}${S}${AUX(0)}${PASS}\b`],
  ["a", "multi-agent-live", String.raw`\b(?:model-in-loop${S}(?:command|evaluation|run|class|track|suite)s?|two-provider${S}capsule|contract${S}turns?|multi-agent${S}(?:run|orchestration|DAG)s?|(?:specialist${S}disagreement|provider${S}fallback|quota${S}failure)${S}with${S}live${S}models)${GAP(6)}${S}${AUX(0)}(?:ran${S}live|passed${S}live|qualified|passed${S}(?:against|with|on)${S}(?:live|real))\b`],
  ["b", "auth-passed", String.raw`\b(?:(?:production|staging)${S}(?:auth(?:entication)?|sign-in)|production-auth|live${S}auth(?:entication)?)${GAP(6)}${S}${AUX(0)}${PASS}\b`],
  ["b", "signed-in-against", String.raw`\bsigned${S}in${S}(?:against|to|on)${S}(?:a|an|the)${S}(?:live|staging|production|isolated)${S}(?:Supabase${S})?(?:project|deployment)\b`],
  ["c", "distributor-passed", String.raw`\b(?:live${S}(?:distributor|DigiKey|Digi-Key|Octopart|Nexar|Mouser|LCSC)|distributor${S}(?:contract|live${S}check))${GAP(6)}${S}${AUX(0)}${PASS}\b`],
  ["d", "ran-on-qualified-platform", String.raw`\b(?:ran|runs|executed|executes|qualified|validated|passed)${GAP(6)}${S}on${S}(?:the${S}|a${S})?qualified${S}(?:OCI${S}|sandbox(?:ed)?${S}|container${S})*(?:platform|runner|host)\b`],
  ["d", "sandbox-qualified", String.raw`\b(?:sandbox|OCI)${S}(?:platform|profile|image|runner)${GAP(4)}${S}${AUX(1)}(?:qualified|validated)\b`],
  ["d", "authoritative-simulation", String.raw`\bauthoritative${S}simulation${S}${AUX(0)}(?:ran|passed|enabled|qualified)\b`],
  ["e", "board-made", String.raw`\b(?:board|boards|PCB|PCBs|prototype|prototypes|unit|units|lot)${GAP(3)}${S}(?:has|have|had|was|were|is|are|got)${S}(?:(?:been|now|already|successfully|also|then)${S}){0,2}(?:fabricated|assembled|inspected|functionally${S}tested|electrically${S}tested|physically${S}(?:tested|validated)|bench[- ]tested|powered${S}up|brought${S}up)\b`],
  ["e", "physical-passed", String.raw`\b(?:physical(?:ly)?${S}(?:validation|qualification)|incoming${S}inspection|functional${S}test|bring-up)${GAP(3)}${S}${AUX(0)}(?:passed|succeeded|complete|completed)\b`],
  ["f", "scope-ready", String.raw`\b(?:staging${S}authentication|live${S}provider|external${S}component-provider|MCP|sandbox|external${S}quote/order|physical${S}hardware)${S}(?:readiness|validation)(?:[\s*/>]*:|${S}(?:is|was))?${S}(?:READY|ready|PASS|passed|complete|COMPLETE|achieved)\b`],
  ["g", "database-verified", String.raw`\b(?:Data${S}API${S}exposure|roles|backups?|PITR|point-in-time${S}recovery|failover|restarts?|rollbacks?)${GAP(4)}${S}${AUX(0)}(?:verified|qualified|tested|proven|confirmed)${S}(?:on|against|in)${S}(?:the${S}|a${S})?(?:real|live|staging|production|Supabase|main)\b`],
  ["g", "qualified-on-real-server", String.raw`\b(?:qualified|verified|proven)${S}on${S}(?:a${S}|the${S})?real${S}(?:PostgreSQL|Postgres|database|server)\b`],
  ["h", "deployed-to", String.raw`\b(?:deployed|hosted)${S}(?:to|on|in)${S}(?:the${S}|a${S})?(?:staging|production)\b`],
  ["h", "verified-on-environment", String.raw`\b(?:verified|qualified)${S}(?:on|in|against)${S}(?:the${S}|a${S})?(?:staging|production)${S}(?:environment|host|deployment)\b`],
  ["i", "external-mcp-consumed", String.raw`\b(?:live|approved|real)${S}external${S}MCP${S}servers?${GAP(4)}${S}${AUX(0)}(?:consumed|called|connected|qualified|passed|exercised)\b`],
  ["i", "consumed-external-mcp", String.raw`\b(?:consumed|called)${S}(?:a|an|the)${S}(?:live|approved|real)${S}external${S}MCP${S}server\b`],
  ["i", "external-mcp-contract", String.raw`\bexternal${S}MCP${S}contract${S}${AUX(0)}(?:passed|qualified)\b`],
  ["j", "kicad-oracle-passed", String.raw`\bkicad-cli${S}(?:live${S})?oracle${GAP(4)}${S}${AUX(0)}(?:passed|qualified|exercised|green)\b`],
  ["k", "live-router-in-ci", String.raw`\blive${S}(?:FreeRouting${S})?(?:router|routing|route)${GAP(4)}${S}${AUX(0)}(?:ran|runs|passed|exercised)${S}(?:in${S}CI|on${S}(?:a${S}|the${S})?qualified${S}runner)\b`],
  ["k", "router-ran-in-ci", String.raw`\b(?:FreeRouting|the${S}router)${S}(?:ran|runs)${S}(?:live${S})?in${S}CI\b`],
  ["l", "live-exchange", String.raw`\blive${S}(?:DFM|quote|order|DFM/quote)${S}(?:exchange|check|request|run)s?${GAP(4)}${S}${AUX(0)}(?:passed|succeeded|completed|accepted|exercised)\b`],
];
const KINDS = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"] as const;
const PATTERNS: ReadonlyArray<readonly [string, RegExp]> = FORMS.map(([kind, form, source]) => [`${kind}:${form}`, new RegExp(source, "gi")] as const);
// [B24-E review, 2026-10-10] correctness-2, security-2: a negation or a condition admits a statement only where it governs it, as B23's
// tripwire reads one (`b23-closeout-statements`: NOT, IF, WHEN) - never because such a word stands somewhere earlier in the sentence.
/** The verbs the forms end on (a statement's verb, which a verb negation or a modal must stand right before). */
const FORM_VERB = String.raw`(?:passed|succeeded|qualified|exercised|ran|runs|executed|executes|validated|enabled|fabricated|assembled|inspected|functionally|electrically|physically|bench[- ]tested|powered|brought|complete|completed|ready|pass|achieved|verified|tested|proven|confirmed|consumed|called|connected|green|accepted|deployed|hosted|signed)`;
/** Inside the statement: a verb negation or a modal right before its verb, only auxiliaries and adverbs between ("has not been exercised"). */
const NEGATED_VERB = new RegExp(String.raw`\b(?:not|never|cannot|\w+n't|would|could|should|may|might|can|will|must)(?:${S}(?:has|have|had|was|were|is|are|be|been|being|yet|ever|already|also|then|now|still))*${S}${FORM_VERB}\b`, "i");
/** Before the statement's first word, with only BETWEEN words after it: a negation ("No live provider turn", "Nothing was"). */
const NEGATION = /^(?:not|never|no|nor|neither|nothing|none|cannot|without|\w+n't)$/i;
/** ... a condition ("if the live provider turn passed"). */
const CONDITION = /^(?:if|unless|whether)$/i;
/** ... or a time word, a condition only before a present or perfect verb ("until it has passed"); before a simple past it dates a claim. */
const TEMPORAL = /^(?:until|before|when|once)$/i;
const PRESENT_OR_PERFECT = /^(?:is|are|am|has|have|be|been)$/i;
/** What may stand between such a word and the statement: articles, "of", "that", auxiliaries and a few adverbs. */
const BETWEEN = /^(?:the|a|an|any|of|that|is|are|was|were|has|have|had|be|been|being|yet|ever|already|also|then|now|still)$/i;
/** A reporting verb right after a negation keeps it ("does not mean a board was fabricated"). */
const REPORTING = /^(?:mean|means|meant|imply|implies|implied|prove|proves|proved|show|shows|showed|say|says|said|claim|claims|claimed|state|states|stated)$/i;
/** Which matrix rows each kind speaks for (case 4: every kind maps to rows that exist, every row citing an LB to a kind). */
const KIND_ROWS: Readonly<Record<(typeof KINDS)[number], readonly string[]>> = { a: ["Q1", "Q15"], b: ["Q2"], c: ["Q3"], d: ["Q4"], e: ["Q7", "Q8"], f: ["Q1", "Q2", "Q3", "Q4", "Q5", "Q7", "Q8", "Q12"], g: ["Q9", "Q10"], h: ["Q11"], i: ["Q12"], j: ["Q13"], k: ["Q4"], l: ["Q5"] };

type Entry = { readonly path: string; readonly text: string; readonly why: string; readonly admits: number; readonly row: string; readonly kind: (typeof KINDS)[number]; readonly run: string };
/** The statements that state a claim and stay as written: LB-4's 2026-09-24 run (form g), held by Q9's recorded live runs. */
const ALLOWED: readonly Entry[] = [
  { path: "artifacts/ai-control-plane-b20/final-verdict.md", text: ["The database migration mechanism, by contrast, WAS qualified", "  on a real PostgreSQL 17.6 server on 2026-09-24 (LB-4)."].join(NEWLINE), why: "B20's verdict records the lead's owner-authorised 2026-09-24 run on the main project's server (EXECUTION_LEDGER.md:2490-2509): true, and LB-4's QUALIFIED form; non-isolated, isolated staging is LB-14", admits: 1, row: "Q9", kind: "g", run: "2026-09-24" },
];
/** [B24-E review, 2026-10-10] The negations a review read whose shape the local rule does not parse, by exact text and counted (case 4):
 *  each must still match a form, stay unparsed and carry no note, so the list cannot rot. */
const REVIEWED_NEGATED: readonly Pick<Entry, "path" | "text" | "why" | "admits">[] = [
  { path: "artifacts/footprint-binding-remediation/r03-b10d-u01-report.md", text: "no revision-zero or empty committed board is fabricated", why: "R03's loader contract: on not_found it never invents an empty committed board - another sense of the word, negated by the determiner of a noun phrase four words long, which the local rule does not read through", admits: 1 },
];

// ── the register's retired vocabulary (D24-33, OD-217): noted in place by B24-E, or left for the closeout's one table ────────────────

const RETIRED: ReadonlyArray<readonly [string, RegExp]> = [
  ["LB-2 classified UNKNOWN", /\| LB-2 \|[^|\n]*\| UNKNOWN \|/g],
  ["LB-3 classified local-only", /\| LB-3 \|[^|\n]*\| local-only(?=[;| ])/g], // [B24-E review, 2026-10-10] the end char a lookahead, so the statement is the noted claim exactly (correctness-3)
  ["LB-4 classified a dead external resource", /\| LB-4 \|[^|\n]*\| dead external resource\b/g],
  ["LB-5 classified not attempted", /\| LB-5 \|[^|\n]*\| not attempted\b|\bnot attempted \(LB-5\)|LB-5 \(C41\) stays "not attempted"/g],
  ["OD-179's four rows left out of the mirror", /LB-4, LB-6, LB-7 and LB-8 stay unmirrored/g],
];
/** Every line B24-E noted, the statement it keeps, and what its note says. */
type Noted = { readonly path: string; readonly claim: string; readonly keeps: readonly string[] };
const NOTED: readonly Noted[] = [
  { path: "artifacts/ai-control-plane-b21/unknowns-and-owner-decisions.md", claim: "| LB-4 | Database-backed tests | dead external resource", keeps: ["QUALIFIED (2026-09-24", "non-isolated", "LB-14"] },
  { path: "artifacts/ai-control-plane-b22/unknowns-and-owner-decisions.md", claim: "| LB-2 | Real LLM provider turn (OpenAI / Anthropic) | UNKNOWN", keeps: ["BLOCKED-LIVE-QUALIFICATION", "OD-216"] },
  { path: "artifacts/ai-control-plane-b22/unknowns-and-owner-decisions.md", claim: "| LB-3 | Live routing in CI | local-only", keeps: ["BLOCKED-LIVE-QUALIFICATION for CI and qualified platforms"] },
  { path: "artifacts/ai-control-plane-b22/unknowns-and-owner-decisions.md", claim: "| LB-4 | Database-backed tests | dead external resource", keeps: ["QUALIFIED (2026-09-24", "non-isolated", "LB-14"] },
  { path: "artifacts/ai-control-plane-b22/unknowns-and-owner-decisions.md", claim: "| LB-5 | Physical fabrication | not attempted", keeps: ["BLOCKED-LIVE-QUALIFICATION", "OD-218"] },
  { path: "artifacts/ai-control-plane-b23/unknowns-and-owner-decisions.md", claim: "LB-4, LB-6, LB-7 and LB-8 stay unmirrored by choice", keeps: ["mirrors every row", "OD-179"] },
  { path: "artifacts/ai-control-plane-b23/unknowns-and-owner-decisions.md", claim: "| LB-5 | Physical fabrication, assembly, incoming inspection, functional test | not attempted", keeps: ["BLOCKED-LIVE-QUALIFICATION", "OD-218"] },
  { path: "artifacts/ai-control-plane-b23/physical-evidence.md", claim: "LB-5 (C41) stays \"not attempted\"", keeps: ["BLOCKED-LIVE-QUALIFICATION", "OD-218", "own increment", "C41"] },
];
const NOTE_COUNTS: Readonly<Record<string, number>> = {
  "artifacts/ai-control-plane-b21/unknowns-and-owner-decisions.md": 1,
  "artifacts/ai-control-plane-b22/unknowns-and-owner-decisions.md": 4,
  "artifacts/ai-control-plane-b23/unknowns-and-owner-decisions.md": 2,
  "artifacts/ai-control-plane-b23/physical-evidence.md": 1,
};
/** The finds left for the closeout's one table (OD-221): dated chapter records B24-E does not note (its ten-note budget), by exact text. */
const CLOSEOUT: readonly Pick<Entry, "path" | "text" | "why" | "admits">[] = [
  { path: "artifacts/ai-control-plane-b21/unknowns-and-owner-decisions.md", text: "| LB-2 | Real LLM provider turn (OpenAI / Anthropic) | UNKNOWN |", why: "B21's close-time copy of the register; left for the closeout's one table", admits: 1 },
  { path: "artifacts/ai-control-plane-b21/unknowns-and-owner-decisions.md", text: "| LB-3 | Live routing in CI | local-only |", why: "B21's close-time copy of the register; left for the closeout's one table", admits: 1 },
  { path: "artifacts/ai-control-plane-b21/unknowns-and-owner-decisions.md", text: "| LB-5 | Physical fabrication | not attempted |", why: "B21's close-time copy of the register; left for the closeout's one table", admits: 1 },
  { path: "artifacts/ai-control-plane-b18/unknowns-and-owner-decisions.md", text: "| not attempted (LB-5) |", why: "B18's status of U18-3 in the register's old word; left for the closeout's one table", admits: 1 },
];

// ── the scope ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const SOURCE = /\.(?:tsx?|mjs|cjs|js)$/;
function sources(dir: string): string[] {
  let entries;
  try {
    entries = readdirSync(join(ROOT, dir), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return entry.name === "__tests__" || entry.name === "node_modules" || entry.name.startsWith(".") ? [] : sources(path);
    return SOURCE.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}
function everyFile(dir: string, keep: (name: string) => boolean): string[] {
  let entries;
  try {
    entries = readdirSync(join(ROOT, dir), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return entry.name === "node_modules" || entry.name.startsWith(".") ? [] : everyFile(path, keep);
    return keep(entry.name) ? [path] : [];
  });
}
const COPY_ROOTS = ["app", "lib", "components", "scripts", "e2e", "e2e-orchestration", "e2e-production-auth"] as const;
const productionCopy = (): string[] => [...COPY_ROOTS.flatMap((dir) => sources(dir)), ...readdirSync(ROOT, { withFileTypes: true }).filter((entry) => entry.isFile() && SOURCE.test(entry.name)).map((entry) => entry.name)];
/** The pages not read: the lead's records, B24's README and discovery (the lead's), and the matrix (the claims' home).
 *  [PR-G, 2026-10-17] ... and the owner's own assignment of the post-B24 reliability work (OWNER_DIRECTIVE, prepared 2026-10-14, with
 *  its additive owner requests J and K): the owner's instruction text, not a page a builder states results on, read as the lead's
 *  records are (its section H forbids relabelling blocked live or physical work because local CI is green: a directive whose negation
 *  governs a verb four words back, which the local rule does not parse, never a claim). Exactly that one path: the other pages beside it in
 *  artifacts/astra-guided-pcb/ (README, CONTINUATION, the qualification-census addendum) stay read, and case 2 pins the set. */
const OWNER_DIRECTIVE = "artifacts/astra-guided-pcb/PROMPT_TO_PCB_RELIABILITY_AND_SIMPLE_UI.md";
const EXCLUDED = (path: string): boolean => path.startsWith("artifacts/remaining-builder-program/") || ["artifacts/ai-control-plane-b24/README.md", "artifacts/ai-control-plane-b24/discovery.md", MATRIX, OWNER_DIRECTIVE].includes(path);
const pages = (): string[] => [...everyFile("artifacts", (name) => name.endsWith(".md")).filter((path) => !EXCLUDED(path)), ...everyFile("docs", (name) => name.endsWith(".md")), "README.md"];
const yieldToLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

// ── the scan ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

interface Found { readonly path: string; readonly line: number; readonly claim: string; readonly start: number; readonly end: number }
type TextOf = (path: string) => string;
/** Every statement of the patterns in one file, with the line it ends on (a statement wrapped over lines ends where its last word is). */
function statementsIn(path: string, body: string, patterns: ReadonlyArray<readonly [string, RegExp]>): Found[] {
  const found: Found[] = [];
  for (const [claim, pattern] of patterns) {
    for (const match of body.matchAll(new RegExp(pattern.source, pattern.flags))) {
      const end = match.index! + match[0].length;
      found.push({ path, line: body.slice(0, end).split(NEWLINE).length, claim, start: match.index!, end });
    }
  }
  return found;
}
/** The words right before a statement, nearest first: a run of words and spaces (a comment's or a quote's line prefix counts as a space),
 *  ended by any other character - a comma, a colon, a full stop, a bracket, a cell - or by a blank line. */
function wordsBefore(body: string, start: number): string[] {
  const run = /(?:[\w'\x60-]+[\s*/>]+)*$/.exec(body.slice(Math.max(0, start - 120), start))?.[0] ?? "";
  const paragraph = run.lastIndexOf(`${NEWLINE}${NEWLINE}`);
  return (paragraph >= 0 ? run.slice(paragraph) : run).split(/[\s*/>]+/).filter((word) => word !== "").reverse();
}
/** Whether a negation or a condition governs the statement: a verb negation or a modal right before its verb, or a negation (a negated
 *  reporting verb too), a condition, or a time word before a present or perfect verb, right before its first word. */
function negatedOrConditional(body: string, start: number, end: number): boolean {
  const statement = body.slice(start, end);
  if (NEGATED_VERB.test(statement)) return true;
  const between: string[] = [];
  let reporting = false;
  for (const word of wordsBefore(body, start)) {
    if (NEGATION.test(word)) return true;
    if (reporting) return false;
    if (CONDITION.test(word)) return true;
    if (TEMPORAL.test(word)) return [...between, ...statement.split(/[\s*/>]+/)].some((part) => PRESENT_OR_PERFECT.test(part));
    if (REPORTING.test(word)) reporting = true;
    else if (BETWEEN.test(word)) between.push(word);
    else return false;
  }
  return false;
}
/** Whether an allow-list entry's text, at one of its places in the file, holds the statement whole. */
function inside(found: Found, body: string, entry: Pick<Entry, "path" | "text">): boolean {
  if (entry.path !== found.path) return false;
  for (let at = body.indexOf(entry.text); at >= 0; at = body.indexOf(entry.text, at + 1)) if (found.start >= at && found.end <= at + entry.text.length) return true;
  return false;
}
/** [B24-E review, 2026-10-10] correctness-3: whether B24-E's note admits the statement - only the one it supersedes, so the statement
 *  must lie inside a NOTED statement that ends before the note on its line; any other claim on that line stays a claim. */
function notedOn(found: Found, body: string, noted: ReadonlyArray<Pick<Noted, "path" | "claim">>): boolean {
  const lineStart = body.lastIndexOf(NEWLINE, found.end - 1) + 1;
  const lineEnd = body.indexOf(NEWLINE, found.end);
  const line = body.slice(lineStart, lineEnd < 0 ? undefined : lineEnd);
  const note = line.indexOf(NOTE);
  return note >= 0 && noted.some((entry) => {
    const at = entry.path === found.path ? line.indexOf(entry.claim) : -1;
    return at >= 0 && at + entry.claim.length <= note && found.start >= lineStart + at && found.end <= lineStart + at + entry.claim.length;
  });
}
/** What admits a statement: a negation or condition that governs it (or a reviewed one, by exact text), an allow-list entry around it,
 *  or B24-E's note after the statement it supersedes. */
function admittedBy(found: Found, body: string, allowed: ReadonlyArray<Pick<Entry, "path" | "text">>, negation = true, noted: ReadonlyArray<Pick<Noted, "path" | "claim">> = NOTED): "negated" | "allowed" | "noted" | null {
  if (negation && (negatedOrConditional(body, found.start, found.end) || REVIEWED_NEGATED.some((entry) => inside(found, body, entry)))) return "negated";
  if (allowed.some((entry) => inside(found, body, entry))) return "allowed";
  return notedOn(found, body, noted) ? "noted" : null;
}
const report = (found: readonly Found[]): string[] => found.map((entry) => `${entry.path}:${entry.line} (${entry.claim})`).sort();
/** The claims nothing admits, over the files (yielding between files). */
async function uncorrected(paths: readonly string[], text: TextOf, allowed: ReadonlyArray<Pick<Entry, "path" | "text">>, patterns = PATTERNS, negation = true): Promise<string[]> {
  const out: Found[] = [];
  let done = 0;
  for (const path of paths) {
    const body = text(path);
    out.push(...statementsIn(path, body, patterns).filter((found) => admittedBy(found, body, allowed, negation) === null));
    if (++done % 60 === 0) await yieldToLoop();
  }
  return report(out);
}
const uncorrectedNow = (paths: readonly string[], text: TextOf, allowed: ReadonlyArray<Pick<Entry, "path" | "text">>): string[] =>
  report(paths.flatMap((path) => statementsIn(path, text(path), PATTERNS).filter((found) => admittedBy(found, text(path), allowed) === null)));
/** How many statements each entry admits in its own file. */
const admittedCounts = (list: ReadonlyArray<Pick<Entry, "path" | "text">>, patterns: ReadonlyArray<readonly [string, RegExp]>): number[] =>
  list.map((entry) => statementsIn(entry.path, read(entry.path), patterns).filter((found) => inside(found, read(entry.path), entry)).length);
/** Each B24-E note's own text, from its bracket to the bracket that closes it. */
function notesIn(text: string): string[] {
  const out: string[] = [];
  for (let start = text.indexOf(NOTE); start >= 0; start = text.indexOf(NOTE, start + 1)) {
    let depth = 0;
    let end = start;
    for (; end < text.length; end += 1) {
      if (text[end] === "[") depth += 1;
      else if (text[end] === "]" && --depth === 0) break;
    }
    out.push(text.slice(start, end + 1));
  }
  return out;
}
const unnoted = (text: string): string => notesIn(text).reduce((out, note) => out.replace(` ${note}`, "").replace(note, ""), text);
const matrixOf = (): MatrixRow[] => matrixRows(read(MATRIX)).rows;

describe("[B24-E] no copy claims a live, staging or physical pass the matrix does not hold (runbook :1025, :1123, :1157; D24-33, OD-217)", () => {
  it("1. no production copy - the sources under app, lib, components and scripts, the three browser-spec folders and the root source files; test files are not copy - states a claim of the vocabulary that no negation or condition admits", { timeout: 120_000 }, async () => {
    const copy = productionCopy();
    expect(copy).toEqual(expect.arrayContaining(["e2e-production-auth/production-auth.spec.ts", "playwright.production-auth.config.ts", "e2e-orchestration/specialist-orchestration.spec.ts", "app/lib/deployment/production-auth-target.ts"]));
    expect(copy.filter((path) => path.includes("/__tests__/") || /\.test\.tsx?$/.test(path))).toEqual([]);
    expect(copy).not.toContain(SELF);
    expect(await uncorrected(copy, read, [])).toEqual([]);
  });

  it("2. no page - the artifacts' Markdown but the lead's records, B24's README and discovery and the matrix; the docs; the root README - states such a claim outside LB-4's allow-listed 2026-09-24 run", { timeout: 120_000 }, async () => {
    const paths = pages();
    expect(paths).toEqual(expect.arrayContaining(["README.md", "artifacts/ai-control-plane-b20/final-verdict.md", "artifacts/prompt-to-gerber/r05-e2e01-report.md", "artifacts/ai-control-plane-b24/eval-catalog.md"]));
    expect(paths.filter(EXCLUDED)).toEqual([]);
    expect(everyFile("artifacts", (name) => name.endsWith(".md")).filter(EXCLUDED).filter((path) => !path.startsWith("artifacts/remaining-builder-program/")).sort()).toEqual(["artifacts/ai-control-plane-b24/README.md", "artifacts/ai-control-plane-b24/discovery.md", MATRIX, OWNER_DIRECTIVE].sort()); // [PR-G, 2026-10-17] + the owner's assignment (EXCLUDED's note)
    expect(paths).toEqual(expect.arrayContaining(["artifacts/astra-guided-pcb/README.md", "artifacts/astra-guided-pcb/CONTINUATION.md", "artifacts/astra-guided-pcb/qualification-census-addendum.md"])); // [PR-G, 2026-10-17] the other pages beside it stay read
    expect(await uncorrected(paths, read, ALLOWED)).toEqual([]);
    // without the allow-list, exactly its one statement is reported: the vocabulary holds no other find at this tree
    expect(await uncorrected(paths, read, [])).toEqual(["artifacts/ai-control-plane-b20/final-verdict.md:59 (g:qualified-on-real-server)"]);
  });

  it("3. the vocabulary bites: every form is reported under its kind by its own examples - wrapped over two lines too - and a negated or conditional statement is not; a claim planted in production copy or a page, appended to an allowed text, or on an allowed text moved to another file is reported", () => {
    const CLAIMED: Readonly<Record<string, readonly string[]>> = {
      "live-provider-passed": ["The live provider turn passed on 2026-10-10.", "Live OpenAI contract turns have passed.", "The real model evaluation was exercised.", "live Anthropic calls succeeded"],
      "multi-agent-live": ["The model-in-loop command ran live against both providers.", "The two-provider capsule passed live.", "The multi-agent run passed against live models.", "Provider fallback with live models qualified."],
      "auth-passed": ["Production authentication passed against the isolated project.", "The staging sign-in has been qualified.", "The production-auth browser E2E passed.", "Live auth qualification was exercised."],
      "signed-in-against": ["The spec signed in against the staging Supabase project."],
      "distributor-passed": ["The live distributor contract passed for NE555P.", "Live DigiKey reads were exercised.", "The distributor contract has passed."],
      "ran-on-qualified-platform": ["The router ran on the qualified OCI platform.", "Simulation executed on a qualified sandbox runner."],
      "sandbox-qualified": ["The OCI profile has been validated.", "The sandbox platform is qualified."],
      "authoritative-simulation": ["Authoritative simulation is enabled.", "authoritative simulation ran"],
      "board-made": ["The board was fabricated and assembled.", "Five boards have been functionally tested.", "The prototype units were inspected.", "The PCB has been brought up."],
      "physical-passed": ["Physical validation passed.", "Incoming inspection is complete.", "The functional test passed on all five units."],
      "scope-ready": ["Staging authentication readiness: READY", "sandbox readiness is ready", "Physical hardware validation: PASS", "MCP readiness: READY", "Live provider readiness achieved"],
      "database-verified": ["Backups were verified on the production project.", "PITR has been tested against the staging database.", "Failover proven on the real server."],
      "qualified-on-real-server": ["The migrations were qualified on a real PostgreSQL server.", "verified on the real database"],
      "deployed-to": ["Sirkit is deployed to production.", "The app was hosted on a staging environment."],
      "verified-on-environment": ["The headers were verified on the staging environment."],
      "external-mcp-consumed": ["The approved external MCP server was consumed.", "A real external MCP server has been called."],
      "consumed-external-mcp": ["Sirkit consumed an approved external MCP server."],
      "external-mcp-contract": ["The external MCP contract passed."],
      "kicad-oracle-passed": ["The kicad-cli live oracle passed.", "The kicad-cli oracle has been exercised."],
      "live-router-in-ci": ["The live FreeRouting router ran in CI.", "Live routing passed on a qualified runner."],
      "router-ran-in-ci": ["FreeRouting ran live in CI."],
      "live-exchange": ["The live DFM exchange succeeded.", "Live quote requests were accepted."],
    };
    const NOT_CLAIMED: Readonly<Record<string, string>> = {
      "live-provider-passed": "No live provider turn has passed.",
      "multi-agent-live": "The model-in-loop command never ran live.",
      "auth-passed": "Production authentication has not passed; it is BLOCKED-LIVE-QUALIFICATION.",
      "signed-in-against": "The spec has never signed in against a staging project.",
      "distributor-passed": "The live distributor contract is not exercised.",
      "ran-on-qualified-platform": "Nothing ran on the qualified OCI platform.",
      "sandbox-qualified": "Until the sandbox platform is qualified, production stays blocked.",
      "authoritative-simulation": "If authoritative simulation is enabled, the runner must be qualified first.",
      "board-made": "No board has been fabricated, assembled, inspected or tested for Sirkit.",
      "physical-passed": "Until incoming inspection is complete, LB-5 stays as it is.",
      "scope-ready": "When staging authentication readiness is ready, LB-1 closes.",
      "database-verified": "Backups were never verified on the production project.",
      "qualified-on-real-server": "Nothing was qualified on a real PostgreSQL server by B24.",
      "deployed-to": "Nothing is deployed to production by the builder.",
      "verified-on-environment": "The headers are not verified on the staging environment.",
      "external-mcp-consumed": "No live external MCP server was consumed.",
      "consumed-external-mcp": "Sirkit never consumed an approved external MCP server.",
      "external-mcp-contract": "Unless the external MCP contract passed, LB-16 stays.",
      "kicad-oracle-passed": "The kicad-cli oracle has not been exercised.",
      "live-router-in-ci": "The live router never ran in CI.",
      "router-ran-in-ci": "If FreeRouting ran live in CI, the recording would be refreshed.",
      "live-exchange": "No live DFM exchange has succeeded.",
    };
    const problems: string[] = [];
    expect(Object.keys(CLAIMED).sort()).toEqual(FORMS.map(([, form]) => form).sort());
    expect(Object.keys(NOT_CLAIMED).sort()).toEqual(FORMS.map(([, form]) => form).sort());
    expect(FORMS).toHaveLength(22);
    expect([...new Set(FORMS.map(([kind]) => kind))]).toEqual([...KINDS]);
    for (const [kind, form, source] of FORMS) {
      for (const line of CLAIMED[form] ?? []) {
        if (!new RegExp(source, "i").test(line)) problems.push(`${form} does not match: ${line}`);
        if (!statementsIn("docs/new.md", line, PATTERNS).some((found) => found.claim.startsWith(`${kind}:`))) problems.push(`not reported as (${kind}): ${line}`);
        if (uncorrectedNow(["docs/new.md"], () => line, []).length === 0) problems.push(`admitted: ${line}`);
      }
      const negated = NOT_CLAIMED[form] ?? "";
      if (!new RegExp(source, "i").test(negated)) problems.push(`${form}'s non-claim does not match the form: ${negated}`);
      if (uncorrectedNow(["docs/new.md"], () => negated, []).length !== 0) problems.push(`reported: ${negated}`);
    }
    // wrapped over two lines, in a comment and in a list item
    expect(uncorrectedNow(["app/lib/new.ts"], () => [" * The live provider", " * turn passed on 2026-10-10."].join(NEWLINE), [])).toEqual(["app/lib/new.ts:2 (a:live-provider-passed)"]);
    expect(uncorrectedNow(["docs/new.md"], () => ["- the board was", "  fabricated and assembled"].join(NEWLINE), [])).toEqual(["docs/new.md:2 (e:board-made)"]);
    // planted in production copy and in a page
    expect(uncorrectedNow(["app/lib/deployment/production-auth-target.ts"], (path) => `${read(path)}${NEWLINE}// Production authentication passed on 2026-10-10.${NEWLINE}`, [])).toHaveLength(1);
    expect(uncorrectedNow(["README.md"], (path) => `${read(path)}${NEWLINE}Sirkit is deployed to production.${NEWLINE}`, [])).toEqual([`README.md:${read("README.md").split(NEWLINE).length + 1} (h:deployed-to)`]);
    // appended to an allowed text, or an allowed text moved to another file
    const entry = ALLOWED[0]!;
    expect(uncorrectedNow([entry.path], (path) => read(path).replace(entry.text, `${entry.text} The live provider turn passed.`), ALLOWED)).toHaveLength(1);
    expect(uncorrectedNow(["artifacts/ai-control-plane-b24/moved.md"], () => read(entry.path), ALLOWED)).toEqual(["artifacts/ai-control-plane-b24/moved.md:59 (g:qualified-on-real-server)"]);
    // a claim written after or inside one of B24-E's notes is reported (a note admits only what ends before it)
    const noted = NOTED[0]!;
    const note = notesIn(read(noted.path))[0] ?? "";
    expect(note.length).toBeGreaterThan(NOTE.length);
    for (const [how, text] of [["after", `${note} The kicad-cli oracle passed.`], ["inside", `${note.slice(0, -1)}; the kicad-cli oracle passed]`]] as const) if (uncorrectedNow([noted.path], (path) => read(path).replace(note, text), []).length !== 1) problems.push(`a claim ${how} a note is not reported`);
    // [B24-E review, 2026-10-10] correctness-3: a note admits only the statement it supersedes, never another claim earlier on its line
    const line = read(noted.path).split(NEWLINE).find((text) => text.includes(noted.claim) && text.includes(NOTE)) ?? "";
    expect(line.length).toBeGreaterThan(0);
    for (const [how, text] of [["before the noted statement", `The kicad-cli oracle passed. ${line}`], ["between the statement and its note", line.replace(` ${NOTE}`, ` The kicad-cli oracle passed. ${NOTE}`)]] as const) {
      expect(text, how).not.toBe(line);
      if (uncorrectedNow([noted.path], (path) => read(path).replace(line, text), []).length !== 1) problems.push(`a claim ${how} on a noted line is not reported`);
    }
    // [B24-E review, 2026-10-10] correctness-2, security-2: a negation, a condition or a time word in an EARLIER clause or sentence
    // admits nothing; a time word before a simple past dates a claim (B23's rule); before a present or perfect it is a condition
    const IN_CONTEXT: ReadonlyArray<readonly [string, string]> = [
      ["When the owner supplied the isolated project on 2026-10-12, production authentication passed.", "b:auth-passed"],
      ["Once credits arrived, the live provider turn passed.", "a:live-provider-passed"],
      ["LB-1, blocked since B16, is closed: production authentication passed.", "b:auth-passed"],
      ["LB-1 is no longer blocked: production authentication passed on 2026-10-12.", "b:auth-passed"],
      [["LB-1 had no staging target yet.", "Production authentication passed on 2026-10-12."].join(NEWLINE), "b:auth-passed"],
      ["When the owner ran the harness on 2026-10-12, Sirkit was deployed to production.", "h:deployed-to"],
      ["When the live provider turn passed, LB-2 closed.", "a:live-provider-passed"],
      ["Missing credits aside, the kicad-cli oracle passed.", "j:kicad-oracle-passed"],
      ["The live provider turn that had not run before passed.", "a:live-provider-passed"],
      ["Until 2026-10-12 nothing ran; then the live distributor contract passed.", "c:distributor-passed"],
      ["The capsule may be retired, but the live provider turn passed.", "a:live-provider-passed"],
    ];
    for (const [text, claim] of IN_CONTEXT) if (JSON.stringify(uncorrectedNow(["docs/new.md"], () => text, [])) !== JSON.stringify([`docs/new.md:${text.split(NEWLINE).length} (${claim})`])) problems.push(`admitted by an earlier clause: ${text}`);
    const STILL_NOT: readonly string[] = [
      "When the live provider turn has passed, LB-2 closes.",
      "Until the kicad-cli oracle has been exercised, LB-17 stays.",
      "The live provider turn could have passed with credits.",
      "This does not mean a board was fabricated.",
      "Neither the live provider turn nor the capsule has passed.",
      "None of the boards has been fabricated.",
      "(no live provider turn has passed)",
    ];
    for (const text of STILL_NOT) if (uncorrectedNow(["docs/new.md"], () => text, []).length !== 0) problems.push(`reported: ${text}`);
    expect(problems).toEqual([]);
  });

  it("4. the allow-list is exact and cannot rot, and every form and row is mapped: each entry on its one place, still a claim, with no note, admitting its pinned count, its reason given and its matrix row's recorded live runs holding its run; every kind speaks for rows the matrix has, every row that cites an LB is spoken for, and Q6 and Q14 by none", () => {
    const rows = matrixOf();
    const problems: string[] = [];
    for (const entry of ALLOWED) {
      const body = read(entry.path);
      if (body.split(entry.text).length - 1 !== 1) problems.push(`${entry.path}: its text is not in one place`);
      if (body.slice(body.indexOf(entry.text), body.indexOf(entry.text) + entry.text.length).includes(NOTE)) problems.push(`${entry.path}: a note`);
      if (entry.why.length < 40) problems.push(`${entry.path}: no reason`);
      const row = rows.find((candidate) => candidate.row === entry.row);
      if (!row || row.recorded === "none" || !row.recorded.includes(entry.run)) problems.push(`${entry.path}: ${entry.row}'s recorded live runs do not hold ${entry.run}`);
      if (!KIND_ROWS[entry.kind].includes(entry.row)) problems.push(`${entry.path}: (${entry.kind}) does not speak for ${entry.row}`);
    }
    // [B24-E review, 2026-10-10] the reviewed negations: each in one place, still matching a form, still unparsed by the local rule (else
    // it is no longer needed), with no note and a reason, admitting its pinned count
    for (const entry of REVIEWED_NEGATED) {
      const body = read(entry.path);
      if (body.split(entry.text).length - 1 !== 1) problems.push(`${entry.path}: the reviewed text is not in one place`);
      if (entry.why.length < 40) problems.push(`${entry.path}: no reason`);
      const inner = statementsIn(entry.path, body, PATTERNS).filter((found) => inside(found, body, entry));
      if (inner.some((found) => negatedOrConditional(body, found.start, found.end))) problems.push(`${entry.path}: the local rule now parses it; drop the entry`);
      const line = body.split(NEWLINE).find((text) => text.includes(entry.text)) ?? "";
      if (line.includes(NOTE)) problems.push(`${entry.path}: a note`);
    }
    expect(problems).toEqual([]);
    expect(admittedCounts(REVIEWED_NEGATED, PATTERNS)).toEqual(REVIEWED_NEGATED.map((entry) => entry.admits));
    expect(REVIEWED_NEGATED).toHaveLength(1);
    expect(admittedCounts(ALLOWED, PATTERNS)).toEqual(ALLOWED.map((entry) => entry.admits));
    expect(ALLOWED.map((entry) => entry.admits).every((count) => count >= 1)).toBe(true);
    const ids = new Set(rows.map((row) => row.row));
    for (const kind of KINDS) for (const id of KIND_ROWS[kind]) expect(ids.has(id), `(${kind}) ${id}`).toBe(true);
    const spoken = new Set(Object.values(KIND_ROWS).flat());
    expect(rows.filter((row) => row.lb.length > 0 && !spoken.has(row.row)).map((row) => row.row)).toEqual([]);
    expect(rows.filter((row) => row.lb.length === 0).map((row) => row.row)).toEqual(["Q6", "Q14"]);
    expect(["Q6", "Q14"].filter((id) => spoken.has(id))).toEqual([]);
  });

  it("5. B24-E's in-place notes: each of the eight noted lines keeps its statement before exactly one note that says what it must; no other line in scope carries one; each file keeps its count; a note states no claim of the vocabulary and spells no foreign prefix, tag or claim word", { timeout: 120_000 }, async () => {
    const problems: string[] = [];
    const matched = new Set<string>();
    for (const noted of NOTED) {
      const lines = read(noted.path).split(NEWLINE).flatMap((line, index) => (line.includes(noted.claim) && line.includes(NOTE) ? [[index, line] as const] : []));
      if (lines.length !== 1) {
        problems.push(`${noted.path}: "${noted.claim}" noted on ${lines.length} lines`);
        continue;
      }
      const [index, line] = lines[0]!;
      matched.add(`${noted.path}:${index + 1}`);
      const notes = notesIn(line);
      if (notes.length !== 1) problems.push(`${noted.path}:${index + 1}: ${notes.length} notes`);
      if (line.indexOf(noted.claim) > line.indexOf(NOTE)) problems.push(`${noted.path}:${index + 1}: the note stands before its statement`);
      for (const kept of noted.keeps) if (!(notes[0] ?? "").includes(kept)) problems.push(`${noted.path}:${index + 1}: the note does not say "${kept}"`);
    }
    expect(problems).toEqual([]);
    expect(NOTED).toHaveLength(8);
    const counts: Record<string, number> = {};
    const everyNoted: string[] = [];
    let done = 0;
    for (const path of [...productionCopy(), ...pages()]) {
      const text = read(path);
      const count = text.split(NOTE).length - 1;
      if (count > 0) {
        counts[path] = count;
        text.split(NEWLINE).forEach((line, index) => { if (line.includes(NOTE)) everyNoted.push(`${path}:${index + 1}`); });
      }
      if (++done % 60 === 0) await yieldToLoop();
    }
    expect(counts).toEqual(NOTE_COUNTS);
    expect(everyNoted.sort()).toEqual([...matched].sort());
    expect(Object.values(NOTE_COUNTS).reduce((sum, count) => sum + count, 0)).toBe(8);
    for (const path of Object.keys(NOTE_COUNTS)) {
      for (const note of notesIn(read(path))) {
        for (const prefix of FOREIGN) expect(note, path).not.toContain(prefix);
        expect(note, path).not.toMatch(FOREIGN_WORDS);
        expect(uncorrectedNow([path], () => note, []), path).toEqual([]);
        expect(statementsIn(path, note, PATTERNS).filter((found) => !negatedOrConditional(note, found.start, found.end)), path).toEqual([]);
      }
    }
  });

  it("6. the register's retired vocabulary stands nowhere in scope uncorrected: every find carries B24-E's note or is one of the four finds left for the closeout's one table (OD-221), counted; with the notes stripped the scan reports exactly the eight noted lines; the matrix's part 3 lists every find", { timeout: 120_000 }, async () => {
    const paths = [...productionCopy(), ...pages()];
    expect(await uncorrected(paths, read, CLOSEOUT, RETIRED, false)).toEqual([]);
    expect(admittedCounts(CLOSEOUT, RETIRED)).toEqual(CLOSEOUT.map((entry) => entry.admits));
    for (const entry of CLOSEOUT) expect(read(entry.path).split(entry.text).length - 1, entry.text).toBe(1);
    const stripped = await uncorrected(paths, (path) => unnoted(read(path)), CLOSEOUT, RETIRED, false);
    const expected = NOTED.map((noted) => { const index = read(noted.path).split(NEWLINE).findIndex((line) => line.includes(noted.claim) && line.includes(NOTE)); return `${noted.path}:${index + 1}`; });
    expect(stripped.map((found) => found.slice(0, found.indexOf(" ("))).sort()).toEqual(expected.sort());
    const three = read(MATRIX).slice(read(MATRIX).indexOf(`${NEWLINE}## Part 3. `));
    expect(three.length).toBeGreaterThan(100);
    for (const line of [...expected, ...CLOSEOUT.map((entry) => `${entry.path}:${read(entry.path).split(NEWLINE).findIndex((text) => text.includes(entry.text)) + 1}`)]) expect(three, line).toContain(`\`${line}\``);
  });

  it("7. this suite spells no B21, B22 or B23 note prefix or tag (each is assembled at run time), and reads no file it writes: it writes none", () => {
    const own = read(SELF);
    for (const prefix of FOREIGN) expect(own.includes(prefix), prefix.slice(0, 20)).toBe(false);
    expect(FOREIGN).toHaveLength(6);
    expect(own.includes(["write", "FileSync("].join(""))).toBe(false);
  });
});
