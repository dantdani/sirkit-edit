/**
 * [B23 closeout (1/2), 2026-10-05] The closeout's tripwire (D23-16 under OD-178; the pattern of `b21-closeout-statements` and
 * `b22-closeout-statements`). No provider has accepted, quoted, priced, DFM-checked or ordered a Sirkit bundle: no provider is
 * admitted, no reviewed transfer descriptor exists and no exchange record holds an acknowledged receipt (LB-11; ordering, LB-12). So
 * the copy that said a provider's quote tool takes the bundle, and the B23 statements a later B23 increment made untrue, are
 * superseded IN PLACE with a dated note - never rewritten, no line added - and one stale title is retitled to what its body asserts
 * (assertions and `it(` count unchanged). This suite pins that no production copy (the sources and the fab presets' notes), doc or
 * page states such an answer outside a small exact allow-list; that no superseded B23 statement comes back uncorrected; that each
 * note keeps what it must say and each file its number of notes; that the retired title never returns; that the closeout page's
 * export record holds against the tree; and that the page's tables are the tree's notes and retitle, row for row.
 * Failing first on dfd51e3 (before the notes, the retitle and the page): see `closeout-statements.md` section 5. Files are read as
 * text (case 7 also parses five of them with the TypeScript API); nothing is written to disk and no process is started.
 * [B23 closeout (1/2) review, 2026-10-05] The review's nine bite gaps are closed, each shown by a breakage the reviewed suite let
 * through and this one reports (page section 5): the claim vocabulary takes auxiliaries, an object before the preposition, present
 * forms and a DFM pass, every form pinned by its own example; an allowed line admits only the claims inside its allowed text, and a
 * note only the claims before it; the allowed admissions and the control name's uses are pinned per entry and per file; no note states
 * a claim; CS-B20's statement is scanned; the retitle is tied to the files its body pins; and each production composition is parsed.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const cache = new Map<string, string>();
const read = (path: string): string => {
  let text = cache.get(path);
  if (text === undefined) {
    text = readFileSync(join(ROOT, path), "utf8").replaceAll(`${CR}${NEWLINE}`, NEWLINE);
    cache.set(path, text);
  }
  return text;
};
/** The closeout's dated note, as every superseded statement carries it (the references after the parenthesis vary by item). */
const NOTE = "[superseded 2026-10-05 by the B23 closeout (";
/** The same-line note the retitled case carries. */
const RETITLED = "[B23 closeout, 2026-10-05] retitled";
/** The closeout's code tag (the retitle note opens with it). */
const TAG = "[B23 closeout, 2026-10-05] ";
const SELF = "app/lib/manufacturing-providers/__tests__/b23-closeout-statements.test.ts";
const B23 = "artifacts/ai-control-plane-b23/";
const PAGE = `${B23}closeout-statements.md`;
/** What every D23-16 note says (OD-178). */
const TRUTH = "a bundle prepared for a provider's quote upload; no upload has been recorded, and no provider has accepted, quoted, DFM-checked or ordered a Sirkit bundle (no stored acknowledged receipt; LB-11)";
/** The B21 and B22 closeouts' own prefixes and tags, which their tripwires count per file: assembled here so this file never spells one. */
const FOREIGN = [["[superseded 2026-09-29 by the B21 clos", "eout ("], ["[superseded 2026-10-02 by the B22 clos", "eout ("], ["[B21 clos", "eout, 2026-09-29]"], ["[B22 clos", "eout, 2026-10-02]"]].map((parts) => parts.join(""));
/** ... and the claim words those tripwires scan notes for, assembled the same way; a note never holds a table's cell separator either. */
const FOREIGN_WORDS = new RegExp([String.raw`single[- ]agent`, String.raw`\bsand` + "box", String.raw`\bno net` + String.raw`work\b`, String.raw`\biso` + String.raw`lated\b`, "exactly" + " 12", "five" + " spawners", String.raw`\|`].join("|"), "i");

// ── the claim: a provider accepted, quoted, priced, DFM-checked or ordered something, or Sirkit sent it a bundle ─────────────────────

const PROVIDER = String.raw`(?:JLCPCB|PCBWay|OSH Park|MacroFab|Eurocircuits|Digi-?Key|Mouser|Nexar|LCSC)`;
/** A space, or a line break with the comment or quote prefix of the next line. */
const S = String.raw`[\s*/>]+`;
// [B23 closeout (1/2) review] security-1, coverage-1, tests-1: the vocabulary below takes "the JLCPCB quote tool", two providers
// joined by and/or, an auxiliary before the verb ("has accepted"), an object before the preposition ("sent the Gerbers to"), the
// present forms and a DFM pass; a negation or a condition before the provider ("nor PCBWay accepted", "if the provider accepts") is
// still no claim. It is a vocabulary: a phrasing outside it is not seen (page section 4 lists every form).
/** What of a provider can answer: its quote tool or page, its DFM check, its API. */
const PART = String.raw`(?:quote${S}tool|online${S}quote|quote|DFM(?:${S}check)?|API)`;
const ROLE = String.raw`(?:provider|manufacturer|fab|fabricator|assembler|distributor)`;
/** One provider: by name, or the provider (manufacturer, fab, ...) or a quote tool, with what of it answered. */
const ONE = String.raw`(?:${PROVIDER}(?:'s)?(?:${S}${PART})?|(?:the|a|their|its)${S}(?:(?:${PROVIDER}${S})?${ROLE}(?:'s)?(?:${S}${PART})?|${PROVIDER}${S}${PART}))`; // [B23 closeout lead, 2026-10-05] a bare "the API" or "a quote" is no provider: its name or role is named
const WHO = String.raw`${ONE}(?:${S}(?:and|or)${S}${ONE})*`;
/** Up to three auxiliaries or adverbs between a provider and its verb ("has accepted", "has already quoted"). */
const AUX = String.raw`(?:(?:has|have|had|is|are|was|were|will|would|been|now|already|also|then|just)${S}){0,3}`;
/** Up to six words between a verb and its preposition ("sent the Gerbers to", "ordered the boards from"). */
const OBJ = String.raw`(?:${S}[\w'.-]+){0,6}?`;
/** A negation right before the verb ("not accepted by", "nothing is sent to") is no claim. */
const NOT = String.raw`(?<!\b(?:not|never|nothing(?:${S}(?:is|was))?|no${S}(?:file|bundle|board|package|order)(?:${S}(?:is|was))?)${S})`;
/** Nor is a provider named after a negation or a condition ("nor PCBWay accepted", "if the provider accepts"). */
const IF = String.raw`(?<!\b(?:no|nor|neither|not|if|unless|whether)${S})`;
/** [B23 closeout lead, 2026-10-05] A temporal word makes a condition only before a present or perfect verb ("until JLCPCB has quoted"); before a simple past it dates a claim ("When JLCPCB accepted the bundle"). */
const WHEN = String.raw`(?<!\b(?:until|before|when|once)${S})`;
/** What may stand between a provider and a simple past inside a temporal clause: past auxiliaries and adverbs only. */
const PAST_AUX = String.raw`(?:(?:had|was|were|then|already|also|just)${S}){0,3}`;
/** A provider saying it: any verb form outside a negation, a condition or a temporal clause, and the simple past inside a temporal clause. */
const said = (who: string, verbs: string, past: string): string => String.raw`${IF}(?:${WHEN}\b${who}${S}${AUX}${verbs}|\b${who}${S}${PAST_AUX}${past})\b`;
const CONTROL = "the Send to fab control name";
const VERDICT = "a verification verdict read as acceptance";
/** Every form of the claim, by kind. Case 3 reports each form by its own examples (CLAIMED), so no form can be dropped unseen. */
const FORMS: ReadonlyArray<readonly [kind: string, form: string, source: string]> = [
  ["a provider accepted the bundle", "who-accepts", said(WHO, "(?:accepts?|accepted|approves?|approved)", "(?:accepted|approved)")],
  ["a provider accepted the bundle", "accepted-by", String.raw`${NOT}\b(?:accepted|approved)${S}by${S}${WHO}`],
  ["a provider accepted the bundle", "quote-tool-accepts", String.raw`\bquote${S}tool${S}${AUX}(?:accepts?|accepted)\b`],
  ["a provider quoted or priced it", "who-quotes", said(WHO, "(?:quotes|quoted|prices|priced)", "(?:quoted|priced)")],
  ["a provider quoted or priced it", "quoted-by", String.raw`${NOT}\b(?:quoted|priced)${OBJ}${S}by${S}${WHO}`],
  ["a provider DFM-checked it", "dfm-checked-by", String.raw`${NOT}\bDFM[- ]checked${OBJ}${S}by\b`],
  ["a provider DFM-checked it", "who-dfm-checked", said(WHO, "DFM[- ]checked", "DFM[- ]checked")],
  ["a provider DFM-checked it", "passed-provider-dfm", String.raw`${NOT}\bpassed${S}(?:(?:the|a)${S})?${PROVIDER}(?:'s)?${S}DFM\b`],
  ["a provider DFM-checked it", "passed-dfm-at", String.raw`${NOT}\bpassed${S}DFM(?:${S}checks?)?${S}(?:at|with|by)${S}${WHO}`],
  ["a provider DFM-checked it", "dfm-check-passed", said(String.raw`(?:${PROVIDER}(?:'s)?|(?:the|a|their|its)${S}(?:${PROVIDER}${S})?${ROLE}(?:'s)?)${S}DFM(?:${S}check)?`, "(?:passed|cleared|succeeded)", "(?:passed|cleared|succeeded)")],
  ["an order with a provider", "ordered-from", String.raw`${NOT}\b(?:ordered|placed|bought|purchased)${OBJ}${S}(?:from|at|with|through)${S}${WHO}`],
  ["an order with a provider", "who-ordered", said(WHO, "(?:ordered|shipped|fulfilled)", "(?:ordered|shipped|fulfilled)")],
  ["an order with a provider", "order-at-site", String.raw`\bOrder${S}at${S}(?:jlcpcb|pcbway|oshpark)\.com\b`],
  ["an order with a provider", "order-with-confirmed", String.raw`\border${S}(?:with|at|from)${S}${WHO}${S}${AUX}(?:confirmed|placed|accepted)\b`],
  ["a bundle sent to a provider", "sent-to", String.raw`${NOT}\b(?:sent|uploaded|submitted|transferred)${OBJ}${S}to${S}${WHO}`],
  // the present tense names a provider: "what Sirkit sends to a provider" describes the egress, "Sirkit uploads the bundle to JLCPCB" claims a send
  ["a bundle sent to a provider", "sends-to-named", String.raw`${NOT}\b(?:sends|uploads|submits|transfers)${OBJ}${S}to${S}(?:(?:the|a)${S})?${PROVIDER}\b`],
  ["an upload a provider takes as-is", "upload-as-is", String.raw`\b(?:uploads?|uploaded|uploading)\b[^\n]*?\bas-is\b`],
  [VERDICT, "verdict", String.raw`MANUFACTURER${S}UPLOAD${S}(?:ZIP${S}READY|VERIFICATION):${S}(?:YES|PASS)`],
  [CONTROL, "control", String.raw`\bSend${S}to${S}fab\b`],
];
/** One pattern per kind, its forms joined; the verdict and the control name are matched in their own case. */
const CLAIMS: ReadonlyArray<readonly [string, RegExp]> = [...new Set(FORMS.map(([kind]) => kind))].map((kind) => [kind, new RegExp(FORMS.filter(([own]) => own === kind).map(([, , source]) => source).join("|"), kind === VERDICT || kind === CONTROL ? "g" : "gi")] as const);

type Entry = { readonly path: string; readonly text: string; readonly why: string; readonly admits: number };
/** The production lines that state a claim and stay as written, each by its exact text; an entry admits only the claims that lie inside
 *  that text, as many as `admits` says. `jlcpcb-2l`'s notes are inside the pinned release identity (the qualified authority reads only
 *  that preset); the other three presets' notes feed a native snapshot's source hash and are kept as written by the closeout's task. */
const ALLOWED: readonly Entry[] = [
  { path: "app/lib/pcb/fab/presets/jlcpcb-2l.fab.json", text: "\"notes\": \"Order at jlcpcb.com/quote: upload this zip as the Gerber file. For SMT assembly, upload the BOM and CPL CSVs separately in the assembly step.\"", why: "a hand-off instruction to a person (the registry's manual-quote-upload hand-off), not a receipt; the qualified preset, inside the pinned release identity", admits: 1 },
  { path: "app/lib/pcb/fab/presets/jlcpcb-4l.fab.json", text: "\"notes\": \"Order at jlcpcb.com/quote: upload this zip as the Gerber file (pick 4 layers). For SMT assembly, upload the BOM and CPL CSVs separately.\"", why: "the same hand-off instruction for the 4-layer preset, which feeds any 4-layer snapshot's source hash; not a receipt", admits: 1 },
  { path: "app/lib/pcb/fab/presets/pcbway-standard.fab.json", text: "\"notes\": \"Order at pcbway.com: upload this zip in the online quote. PCBWay accepts KiCad's default gerber names. Include the position file only if ordering assembly.\"", why: "a hand-off instruction and a file-naming fact from PCBWay's help page (verified 2026-07-09), not an answer about any Sirkit bundle", admits: 2 },
  { path: "app/lib/pcb/fab/presets/oshpark-4l.fab.json", text: "\"notes\": \"Order at oshpark.com: upload this zip directly. OSH Park reads KiCad's default gerber names. Position/BOM files are for your own assembly reference.\"", why: "a hand-off instruction and a file-naming fact from OSH Park's page (verified 2026-07-09), not an answer about any Sirkit bundle", admits: 1 },
  { path: "app/lib/manufacturing-providers/order-contract.ts", text: "ORDER_ACCEPTED: \"The provider accepted the order; its order id is recorded.", why: "the order contract's answer only after it settled a provider's acceptance with the order id recorded - a stored acknowledged receipt; no production module imports the contract", admits: 1 },
];
/** The page lines that state a claim and stay as written: the R05 report's own verification verdicts, dated, in a record that says
 *  no board was uploaded, quoted or ordered. */
const PAGE_ALLOWED: readonly Entry[] = [
  { path: "artifacts/prompt-to-gerber/r05-e2e01-report.md", text: "`MANUFACTURER UPLOAD VERIFICATION: PASS`", why: "Sirkit's own byte and parse verdict on the ZIP, in a dated R05 record whose summary says nothing was uploaded, quoted or ordered", admits: 1 },
  { path: "artifacts/prompt-to-gerber/r05-e2e01-report.md", text: "MANUFACTURER UPLOAD ZIP READY: YES", why: "the same verdict line; two lines below it the report says MANUFACTURER UPLOAD PERFORMED: NO", admits: 1 },
];
/** The control B19 recorded and deferred the rename of: a fabrication ZIP export, not a send (acquisition-ux.md). Its name is admitted
 *  wherever it is the control's name; its uses are pinned per file, so a new or moved use is reviewed (tests-6). */
const CONTROL_ADMITS: { readonly production: Readonly<Record<string, number>>; readonly pages: Readonly<Record<string, number>> } = {
  production: { "app/components/pcb/FabDialog.tsx": 3, "app/components/pcb/PcbEditor.tsx": 2, "app/components/pcb/PcbToolbar.tsx": 3, "app/components/pcb/ShortcutsHelp.tsx": 1, "app/lib/manufacturing-providers/provider-registry.ts": 3 },
  pages: { "artifacts/ai-control-plane-b19/acquisition-ux.md": 1, "artifacts/ai-control-plane-b19/final-verdict.md": 1, "artifacts/ai-control-plane-b19/unknowns-and-owner-decisions.md": 1, "artifacts/ai-control-plane-b23/provider-registry.md": 1, "artifacts/product-reliability-simple-ui/fault-register.md": 1, "docs/native-fab-compiler.md": 1, "docs/pcb-quickstart.md": 1 }, // [PR-G, 2026-10-17] reviewed pin move: + the product-reliability fault register (1), whose F-27 row names the export control by its name in its stage column ("export (Send to fab)") - the fabrication ZIP export's own name in a defect record, not a send to a provider; the row dates from checkpoint A+B (535760f)
};
const total = (counts: Readonly<Record<string, number>>): number => Object.values(counts).reduce((sum, count) => sum + count, 0);
/** The one fab preset the qualified release path reads (its notes are inside the pinned release identity). */
const QUALIFY = "app/api/pcb/qualify/route.ts";

// ── the B23 statements a later B23 increment made untrue ───────────────────────────────────────────────────────────────────────────

const SUPERSEDED: ReadonlyArray<readonly [string, RegExp]> = [
  ["the registry read by no route (B23-B1, B23-B3)", /no route reads this registry yet/g],
  ["every route row false on externalTransfer (B23-B1)", /Both are false on every row/g],
  ["no transfer row in the route table (B23-B1)", /The table carries no transfer and no spend row/g],
  ["an observation query exactly when the closure reaches the boundary (B23-B1, B23-B2)", /sends an observation query exactly when its runtime import closure/g],
  ["no record carrying the side effect (B23-B1)", /every record computes the tier it computed at 79fa18b, and none carries the side effect/g],
  ["the B3 page sections as 17-26 (B23-B3 review)", /B23-B3 sections \(17-26\)/g],
  ["production injecting nothing into the provider egress (B23-B2)", /production passes nothing and gets the real transport, the real resolver and the system clock/g],
  // [B23 closeout (1/2) review] coverage-7: CS-B20's statement is scanned too, so all eleven noted statements are (the dot is the em dash)
  ["the meters keyed by a source, a server or a tool alone (B23-B2)", /keyed by an `AdmissionKey` . a distributor source \(exactly as before\), an MCP[\s*]+server, or one tool of an MCP server/g],
];
/** The lines that quote a superseded statement as the record of it, each by text (no other line may). */
const QUOTING: readonly Entry[] = [
  { path: `${B23}outbound-disclosure.md`, text: "`provider-registry.ts:16` still says \"Nothing here calls a provider, and no route reads this registry yet.\"", why: "B1's record of the stale header, which b23-b-page case 4 requires while the sentence stands", admits: 1 },
  { path: `${B23}outbound-disclosure.md`, text: "| C31 | `app/lib/manufacturing-providers/provider-registry.ts` | 16 | `no route reads this registry yet` |", why: "B1's citation row: the anchor text b23-b-page case 3 resolves on the line", admits: 1 },
  { path: "app/lib/manufacturing-providers/__tests__/b23-b-page.test.ts", text: "const STALE_SENTENCE = \"no route reads this registry yet\";", why: "the page suite's anchor for the record above (case 4)", admits: 1 },
  { path: "app/lib/manufacturing-providers/__tests__/b23-b-dfm-quote-flow-page.test.ts", text: "\"no route reads this registry yet.\\\"; since B1\"", why: "B3's page suite pinning the B3 note on B1's record (case 9)", admits: 1 },
];

/** Every line the closeout noted, what it states, its references, and what its note keeps saying. */
const NOTED: ReadonlyArray<{ readonly path: string; readonly claim: string; readonly refs: string; readonly keeps: readonly string[] }> = [
  { path: "app/lib/manufacturing-providers/provider-registry.ts", claim: "Nothing here calls a provider, and no route reads this registry yet.", refs: "B23-B1, B23-B3", keeps: ["POST /api/pcb/provider-exchange reads this registry since B23-B1", "GET /api/pcb-sync", "nothing here calls a provider", "not a registry revision"] },
  { path: "app/lib/auth/route-policy.ts", claim: "Both are false on every row;", refs: "B23-B1, OD-174", keeps: ["one row is externalTransfer", "POST /api/pcb/provider-exchange", "spend stays false on every row"] },
  { path: "app/lib/auth/route-resource-classification.ts", claim: "a path sends an observation query exactly when its runtime import closure reaches", refs: "B23-B1, B23-B2, OD-182", keeps: ["declared `files`", "provider-egress.ts", "observation-query"] },
  { path: "app/lib/acquisition/admission-control.ts", claim: " * server, or one tool of an MCP server", refs: "B23-B2, OD-165", keeps: ["a manufacturing provider", "agent share 0"] },
  { path: "app/lib/manufacturing-providers/provider-egress.ts", claim: "production passes nothing", refs: "B23-B2", keeps: ["its own clock", "nothing else"] },
  { path: "app/lib/manufacturing-providers/__tests__/b23-a-tier3-vocabulary.test.ts", claim: "and none carries the side effect", refs: "B23-B1, B23-C", keeps: ["manufacturing.provider-exchange", "manufacturing.provider-order", "legacyActionTier"] },
  { path: "app/lib/manufacturing-providers/__tests__/b23-b-dfm-quote-flow-page.test.ts", claim: "The page's B23-B3 sections (17-26)", refs: "B23-B3 review", keeps: ["17-28", "section 28"] },
  { path: "README.md", claim: "pick-and-place bundle that JLCPCB's quote tool accepts.", refs: "D23-16, OD-178", keeps: [TRUTH] },
  { path: "docs/pcb-quickstart.md", claim: "quote tool accepts.", refs: "D23-16, OD-178", keeps: [TRUTH] },
  { path: "docs/pcb-quickstart.md", claim: "a BOM. Upload it to jlcpcb.com/quote (or pcbway.com) as-is.", refs: "D23-16, OD-178", keeps: [TRUTH, "a person's own act outside Sirkit"] },
  { path: `${B23}tier3-vocabulary.md`, claim: "The table carries no transfer and no spend row.", refs: "B23-B1, OD-174", keeps: ["one transfer row", "POST /api/pcb/provider-exchange", "no row is spend"] },
];
/** Every note the closeout wrote, by file: a note reverted or dropped (or one added unregistered) changes a count. */
const NOTE_COUNTS: Readonly<Record<string, number>> = {
  "app/lib/manufacturing-providers/provider-registry.ts": 1,
  "app/lib/auth/route-policy.ts": 1,
  "app/lib/auth/route-resource-classification.ts": 1,
  "app/lib/acquisition/admission-control.ts": 1,
  "app/lib/manufacturing-providers/provider-egress.ts": 1,
  "app/lib/manufacturing-providers/__tests__/b23-a-tier3-vocabulary.test.ts": 1,
  "app/lib/manufacturing-providers/__tests__/b23-b-dfm-quote-flow-page.test.ts": 1,
  "README.md": 1,
  "docs/pcb-quickstart.md": 2,
  [`${B23}tier3-vocabulary.md`]: 1,
};

/** The stale title the closeout retitled (assertions unchanged): the retired wording may never return in a title of its suite. */
const ADMISSION = "app/lib/manufacturing-providers/__tests__/b23-a-provider-admission.test.ts";
const RETIRED_TITLES: ReadonlyArray<readonly [string, string]> = [[ADMISSION, "only the CSV generator reads the registry"]];
/** The retitled suite's `it(` count, as measured on dfd51e3. */
const IT_COUNTS: Readonly<Record<string, number>> = { [ADMISSION]: 11 };
// [B23 closeout (1/2) review] tests-5: the new title is tied to its body - to the files the pin lists, in order, and to the assertions
/** What the new title calls each file its body's pin lists, in the pin's order. */
const TITLED: ReadonlyArray<readonly [string, string]> = [
  ["app/api/pcb/provider-exchange/route.ts", "the provider exchange route"],
  ["app/api/pcb-sync/handler.ts", "GET /api/pcb-sync's handler.ts"],
  ["app/api/pcb-sync/manufacturing-summary.ts", "manufacturing-summary.ts"],
  ["app/api/pcb-sync/route.ts", "and route.ts"],
  ["scripts/generate-b23-provider-registry.ts", "the CSV generator"],
];
/** What else the new title says, and the text of the suite (the case's body, or its walk's roots) that asserts it. */
const TITLE_ASSERTS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["exactly five source files under app, lib, components, scripts and e2e", ["expect(importersOf(ROOT, TOP_LEVEL, DISK)).toEqual([", "const TOP_LEVEL = [\"app\", \"lib\", \"components\", \"scripts\", \"e2e\"] as const;"]],
  ["whose text names neither admission nor the CD-12 projection", ["expect(generator).not.toContain(\"provider-admission\");", "expect(generator).not.toContain(\"cd12-projection\");"]],
  ["a read error anywhere in the walk fails the case", ["toThrow(/EBUSY/);"]],
];
/** What the retitled case's title says that its body (or, for the walk's roots, its suite) does not pin. */
function retitleProblems(lines: readonly string[], at: number): string[] {
  const problems: string[] = [];
  const title = lines[at]!.slice(0, lines[at]!.indexOf("\", "));
  const next = lines.findIndex((line, index) => index > at && /^\s*it\(/.test(line));
  const body = lines.slice(at, next < 0 ? undefined : next).join(NEWLINE);
  const pinned = [...(/expect\(importersOf\(ROOT, TOP_LEVEL, DISK\)\)\.toEqual\(\[([^\]]*)\]\)/.exec(lines[at + 1] ?? "")?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((match) => match[1]!);
  if (JSON.stringify(pinned) !== JSON.stringify(TITLED.map(([path]) => path))) problems.push(`the pin lists ${pinned.join(", ")}`);
  for (const [, named] of TITLED) if (!title.includes(named)) problems.push(`the title does not say "${named}"`);
  for (const [said, asserted] of TITLE_ASSERTS) {
    if (!title.includes(said)) problems.push(`the title does not say "${said}"`);
    for (const text of asserted) if (!(text.startsWith("const ") ? lines.join(NEWLINE) : body).includes(text)) problems.push(`nothing asserts "${said}": ${text}`);
  }
  return problems;
}

// ── the trees ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

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
const productionSources = (): string[] => [
  ...["app", "lib", "components", "scripts", "e2e", "e2e-orchestration"].flatMap((dir) => sources(dir)),
  ...readdirSync(ROOT, { withFileTypes: true }).filter((entry) => entry.isFile() && SOURCE.test(entry.name)).map((entry) => entry.name),
];
/** The fab presets' notes are production copy too: the Send to fab dialog shows them and the KiCad-assisted export writes them out. */
const PRESETS = "app/lib/pcb/fab/presets";
const productionCopy = (): string[] => [...productionSources(), ...readdirSync(join(ROOT, PRESETS)).filter((name) => name.endsWith(".fab.json")).map((name) => `${PRESETS}/${name}`)];
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
/** The lead's records (reserved files) quote the claims; they are not scanned. */
const LEAD_RECORDS = (path: string): boolean => path.startsWith("artifacts/remaining-builder-program/") || path === `${B23}README.md` || path === `${B23}discovery.md`;
const testFiles = (): string[] => everyFile("app", (name) => SOURCE.test(name)).filter((path) => (path.includes("/__tests__/") || /\.test\.tsx?$/.test(path)) && path !== SELF);
/** Every page: the artifacts' Markdown (the lead's records and this closeout's own page aside), the docs and the root README. */
const pages = (): string[] => [
  ...everyFile("artifacts", (name) => name.endsWith(".md")).filter((path) => !LEAD_RECORDS(path) && path !== PAGE),
  ...everyFile("docs", (name) => name.endsWith(".md")),
  "README.md",
];
const occurrences = (text: string, needle: string): number => text.split(needle).length - 1;

// ── the scans ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A statement found: the line it ends on, that line's text, and where on that line it starts (below 0 when wrapped) and ends. */
interface Found { readonly path: string; readonly line: number; readonly claim: string; readonly text: string; readonly from: number; readonly to: number }
/** Every statement of a pattern, with the line it ends on (a statement wrapped over lines ends where its last word is). */
function statements(paths: readonly string[], text: (path: string) => string, patterns: ReadonlyArray<readonly [string, RegExp]>): Found[] {
  const found: Found[] = [];
  for (const path of paths) {
    const body = text(path);
    const lines = body.split(NEWLINE);
    for (const [claim, pattern] of patterns) {
      for (const match of body.matchAll(new RegExp(pattern.source, pattern.flags))) {
        const end = match.index! + match[0].length;
        const start = body.lastIndexOf(NEWLINE, end - 1) + 1;
        const line = body.slice(0, end).split(NEWLINE).length;
        found.push({ path, line, claim, text: lines[line - 1] ?? "", from: match.index! - start, to: end - start });
      }
    }
  }
  return found;
}
/** Whether a statement lies inside an allow-list entry's text on its line. */
function inside(found: Found, entry: Pick<Entry, "path" | "text">): boolean {
  if (entry.path !== found.path) return false;
  for (let at = found.text.indexOf(entry.text); at >= 0; at = found.text.indexOf(entry.text, at + 1)) if (found.from >= at && found.to <= at + entry.text.length) return true;
  return false;
}
// [B23 closeout (1/2) review] coverage-2, tests-3, tests-2: an allowed line admits only what lies inside its allowed text, and a note
// only what ends before the note - a claim appended to an allowed line, or written in or after a note, is reported
/** What admits a statement: the closeout's note after it on its line, an allow-list entry around it, or the control's name. */
function admittedBy(found: Found, allowed: ReadonlyArray<Pick<Entry, "path" | "text">>): "noted" | "allowed" | "control" | null {
  const note = found.text.indexOf(NOTE);
  if (note >= 0 && found.to <= note) return "noted";
  if (allowed.some((entry) => inside(found, entry))) return "allowed";
  return found.claim === CONTROL ? "control" : null;
}
const report = (found: readonly Found[]): string[] => found.map((entry) => `${entry.path}:${entry.line} (${entry.claim})`).sort();
/** The claims nothing admits. */
const uncorrectedClaims = (paths: readonly string[], text: (path: string) => string, allowed: ReadonlyArray<Pick<Entry, "path" | "text">>): string[] =>
  report(statements(paths, text, CLAIMS).filter((found) => admittedBy(found, allowed) === null));
/** The superseded statements with no note after them on their line, outside the quoting records. */
const uncorrectedStatements = (paths: readonly string[], text: (path: string) => string): string[] =>
  report(statements(paths, text, SUPERSEDED).filter((found) => admittedBy(found, QUOTING) === null));
/** How many statements each allow-list entry admits in its own file. */
const admitted = (list: readonly Entry[], patterns: ReadonlyArray<readonly [string, RegExp]>, text: (path: string) => string = read): number[] =>
  list.map((entry) => statements([entry.path], text, patterns).filter((found) => inside(found, entry)).length);
/** The control name's uses, per file. */
function controls(paths: readonly string[], text: (path: string) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const found of statements(paths, text, CLAIMS)) if (admittedBy(found, []) === "control") counts[found.path] = (counts[found.path] ?? 0) + 1;
  return counts;
}
/** Each closeout note's own text, from its opening bracket to the bracket that closes it. */
function notesIn(text: string): string[] {
  const found: string[] = [];
  for (let start = text.indexOf(NOTE); start >= 0; start = text.indexOf(NOTE, start + 1)) {
    let depth = 0;
    let end = start;
    for (; end < text.length; end += 1) {
      if (text[end] === "[") depth += 1;
      else if (text[end] === "]" && --depth === 0) break;
    }
    found.push(text.slice(start, end + 1));
  }
  return found;
}
/** The text with every closeout note removed, and the one space before it. */
function unnoted(text: string): string {
  let out = text;
  for (const note of notesIn(text)) out = out.replace(` ${note}`, "").replace(note, "");
  return out;
}
/** A page section: from its heading line to the next `## ` heading. */
function section(text: string, heading: string): string {
  const start = text.indexOf(`${NEWLINE}${heading}`);
  if (start < 0) return "";
  const end = text.indexOf(`${NEWLINE}## `, start + 1);
  return text.slice(start, end < 0 ? undefined : end);
}
/** A page subsection: from its `### ` heading to the next heading of any level. */
function subsection(text: string, heading: string): string {
  const start = text.indexOf(`${NEWLINE}${heading}`);
  if (start < 0) return "";
  const end = text.slice(start + 1).search(/\n#{2,3} /);
  return end < 0 ? text.slice(start) : text.slice(start, start + 1 + end);
}
const pageText = (): string => {
  try {
    return read(PAGE);
  } catch {
    return "";
  }
};

// ── the export record ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

const EXPORT_ROW = /^\| ((?:DC|CO)-[0-9A-Z]+) \| `((?:app|scripts)\/[^`]+\.tsx?)` \| `([A-Za-z_][A-Za-z0-9_]*|\*)` \| (-|`[A-Za-z_]+`(?:, `[A-Za-z_]+`)*) \| (extension point|dormant contract|vocabulary|test oracle|test seam|test gate|generator render|injection seam|deferred retirement) \| (RECORD|RETIRE) \| `([a-z0-9-]+\.md)` \| ([^|]+) \|$/gm;
const stripComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
/** Each whole module recorded unbound and the production modules that may import it (the C cluster imports itself only). */
const DORMANT_IMPORTERS: Readonly<Record<string, readonly string[]>> = {
  "app/lib/manufacturing-providers/cd12-projection.ts": [],
  "app/lib/manufacturing-providers/order-contract.ts": [],
  "app/lib/manufacturing-providers/purchase-authorization.ts": ["app/lib/manufacturing-providers/order-contract.ts"],
  "app/lib/manufacturing-providers/webhook-verification.ts": ["app/lib/manufacturing-providers/order-contract.ts"],
  "app/lib/manufacturing-providers/ordering-enablement.ts": ["app/lib/manufacturing-providers/order-contract.ts", "app/lib/manufacturing-providers/purchase-authorization.ts"],
  "app/lib/manufacturing-providers/physical-evidence.ts": [],
};
/** The one production module a generator render may be named by. */
const GENERATORS = ["scripts/generate-b23-provider-registry.ts"];
const LEDGER = "app/lib/manufacturing-providers/exchange-ledger.ts";
/** Where production composes each member's owner: the member is never named in the call there - every production call is listed - and
 *  the call passes a closed object literal (or JSX attributes) of exactly the pinned keys, parsed (security-2, tests-4: a named options
 *  object or a spread is reported); or, for the exchange record's two reads, never called by a module that holds the record (and those
 *  are exactly its importers). */
type Composed = { readonly anchor: string; readonly callee: string; readonly argument: number | "props"; readonly keys: readonly string[]; readonly sites: readonly string[] };
const MEMBER_SITES: Readonly<Record<string, Composed | { readonly holders: readonly string[] }>> = {
  ProviderExchangeServiceOptions: { anchor: "new ProviderExchangeService(", callee: "ProviderExchangeService", argument: 0, keys: ["env"], sites: ["app/api/pcb/provider-exchange/route.ts"] },
  ProviderExchangeService: { holders: ["*"] },
  ProviderExchangePanelProps: { anchor: "<ProviderExchangePanel ", callee: "ProviderExchangePanel", argument: "props", keys: ["scope", "authority", "canAct"], sites: ["app/components/pcb/ManufacturingWorkflowPanel.tsx"] },
  ProviderExchangeLedger: { holders: ["app/api/pcb-sync/route.ts", "app/api/pcb/provider-exchange/route.ts", "app/lib/manufacturing-providers/provider-exchange.ts", "app/lib/manufacturing-providers/provider-observation.ts"] },
  ManufacturingSummaryOptions: { anchor: "createManufacturingSummaryReader(", callee: "createManufacturingSummaryReader", argument: 1, keys: ["observations"], sites: ["app/api/pcb-sync/route.ts"] },
  createProviderObservationReader: { anchor: "createProviderObservationReader(", callee: "createProviderObservationReader", argument: 0, keys: ["exchanges"], sites: ["app/api/pcb-sync/route.ts"] },
  ProviderSendInput: { anchor: "sendProviderExchange(", callee: "sendProviderExchange", argument: 0, keys: ["descriptor", "package", "idempotencyKey", "env", "beforeSend"], sites: ["app/lib/manufacturing-providers/provider-exchange.ts"] },
};
/** Each call of `callee` in a source, parsed: the sorted keys of the object literal it passes at `argument` (or of its JSX attributes),
 *  or why they are not a closed list of named keys. */
function compositions(path: string, text: string, callee: string, argument: number | "props"): string[] {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: string[] = [];
  const keysOf = (node: ts.Expression | undefined): string => {
    if (node === undefined) return "no argument";
    if (!ts.isObjectLiteralExpression(node)) return `not an object literal: ${node.getText(source)}`;
    const keys: string[] = [];
    for (const property of node.properties) {
      if ((ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) keys.push(property.name.text);
      else return `not a named key: ${property.getText(source)}`;
    }
    return keys.sort().join(", ");
  };
  const visit = (node: ts.Node): void => {
    if (argument === "props" && (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(source) === callee) {
      const names = node.attributes.properties.map((attribute) => (ts.isJsxAttribute(attribute) ? attribute.name.getText(source) : `a spread: ${attribute.getText(source)}`));
      found.push(names.find((name) => name.startsWith("a spread: ")) ?? names.sort().join(", "));
    } else if (argument !== "props" && (ts.isCallExpression(node) || ts.isNewExpression(node)) && node.expression.getText(source) === callee) {
      found.push(keysOf(node.arguments?.[argument]));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}
/** The call (balanced parentheses) or JSX element that starts at the anchor. */
function callAt(text: string, at: number): string {
  if (!text.startsWith("<", at)) {
    let depth = 0;
    for (let index = text.indexOf("(", at); index < text.length; index += 1) {
      if (text[index] === "(") depth += 1;
      else if (text[index] === ")" && --depth === 0) return text.slice(at, index + 1);
    }
    return text.slice(at);
  }
  const end = text.indexOf("/>", at);
  return text.slice(at, end < 0 ? undefined : end + 2);
}
/** The deliveries the B23 pages describe as delivered and unbound: never retired, each still exported. */
const DELIVERED_UNBOUND: ReadonlyArray<readonly [string, string]> = [
  ["app/lib/manufacturing-providers/provider-egress.ts", "PROVIDER_TRANSFER_DESCRIPTORS"],
  ["app/lib/manufacturing-providers/provider-egress.ts", "sendProviderExchange"],
  [LEDGER, "createProviderExchangeLedger"],
  ["app/lib/manufacturing-providers/provider-observation.ts", "createProviderObservationReader"],
  ["app/lib/manufacturing-providers/order-contract.ts", "OrderContract"],
  ["app/lib/manufacturing-providers/purchase-authorization.ts", "PurchaseAuthorizationStore"],
];
const RECORD_HEADING = "The B23 closeout's export record";
const PINNED_SECTIONS = "Sections 1 to 4 are re-derived from the tree by";
const NOTE_ROW = /^\| ([A-Za-z0-9-]+) \| `([^`]+):(\d+)` \| ([^|]+) \| ([^|]+) \|$/gm;
const TITLE_ROW = /^\| ([A-Za-z0-9-]+) \| `([^`]+):(\d+)` \| (.+) \| (\d+) \|$/gm;

describe("[B23 closeout] no copy claims a provider's answer without a stored receipt, and no superseded B23 statement comes back uncorrected (D23-16, OD-178)", () => {
  it("1. no production copy - the sources and the fab presets' notes - claims, in the vocabulary's forms, that a provider accepted, quoted, priced, DFM-checked or ordered anything, or that Sirkit sent it a bundle, outside the allowed text of five exact allow-listed lines and the Send to fab control name; and no superseded B23 statement stands uncorrected in production or in a test file", { timeout: 60_000 }, () => {
    const copy = productionCopy();
    expect(copy).toEqual(expect.arrayContaining(["app/components/pcb/FabDialog.tsx", `${PRESETS}/jlcpcb-2l.fab.json`, "scripts/generate-b23-provider-registry.ts"]));
    expect(copy.filter((path) => path.includes("/__tests__/") || /\.test\.tsx?$/.test(path))).toEqual([]);
    expect(uncorrectedClaims(copy, read, ALLOWED)).toEqual([]);
    const tests = testFiles();
    expect(tests).not.toContain(SELF);
    expect(uncorrectedStatements([...productionSources(), ...tests], read)).toEqual([]);
  });

  it("2. no page - the artifacts (the lead's records aside), the docs and the root README - claims such an answer outside the R05 report's two verification verdicts and the Send to fab control name, and no superseded B23 statement stands uncorrected on a page", { timeout: 60_000 }, () => {
    const paths = pages();
    expect(paths).toEqual(expect.arrayContaining(["README.md", "docs/pcb-quickstart.md", `${B23}tier3-vocabulary.md`, "artifacts/prompt-to-gerber/r05-e2e01-report.md"]));
    expect(paths.filter(LEAD_RECORDS)).toEqual([]);
    expect(paths).not.toContain(PAGE);
    expect(uncorrectedClaims(paths, read, PAGE_ALLOWED)).toEqual([]);
    expect(uncorrectedStatements(paths, read)).toEqual([]);
  });

  it("3. the allow-lists are small, exact and cannot rot, and the scans bite: each entry on exactly one line, still stating a claim, carrying no note and admitting a pinned number of statements inside its own text; the control name's uses pinned per file; with every note stripped the scans report exactly the statements the closeout noted - its 3 claims and 8 superseded statements, all eleven; every form of the claim is reported by its own examples - wrapped over two lines too - and a negation or a condition is not; a claim appended to an allowed line, written after or inside a note, or on an allowed line moved to another file is reported; and the page's section 4 records every entry, the per-file uses and the one preset inside the pinned release identity", { timeout: 60_000 }, () => {
    const problems: string[] = [];
    // [B23 closeout (1/2) review] security-1, coverage-1, tests-1: every form is reported by its own examples (the review's missed
    // phrasings among them), under its kind, with an example for each verb, preposition and site a form names; a form or an
    // alternative dropped or narrowed turns this red
    const CLAIMED: Readonly<Record<string, readonly string[]>> = {
      "who-accepts": ["JLCPCB accepted the board.", "JLCPCB has accepted the bundle.", "The provider has accepted the order", "a bundle that JLCPCB and PCBWay accept", "JLCPCB approved the Gerbers.", "the manufacturer accepts the zip as uploaded", "the fab approves every board", "When JLCPCB accepted the bundle, Sirkit stored its order id.", "Until JLCPCB accepted the bundle on 2026-10-06, nothing was ordered."],
      "accepted-by": ["the bundle was accepted by PCBWay", "accepted by the JLCPCB quote tool", "the stackup was approved by the fabricator"],
      "quote-tool-accepts": ["a bundle any quote tool accepts", "a zip each quote tool has accepted"],
      "who-quotes": ["MacroFab quoted twelve dollars for five boards", "PCBWay has quoted the board at four dollars.", "The provider has quoted it.", "JLCPCB quotes the board in seconds.", "JLCPCB prices the board at two dollars.", "the assembler priced the run", "Once PCBWay quoted the board, the person paid."],
      "quoted-by": ["priced by the manufacturer at four dollars", "the board was quoted at two dollars by PCBWay"],
      "dfm-checked-by": ["the zip was DFM-checked by JLCPCB", "the zip was DFM checked last week by OSH Park"],
      "who-dfm-checked": ["JLCPCB has DFM-checked the zip"],
      "passed-provider-dfm": ["the board passed JLCPCB's DFM", "the zip passed the PCBWay DFM"],
      "passed-dfm-at": ["the boards passed DFM at JLCPCB", "the board passed DFM checks with the fab", "the board passed DFM by the manufacturer"],
      "dfm-check-passed": ["PCBWay's DFM check passed", "the provider's DFM check has passed", "the JLCPCB DFM cleared", "the Eurocircuits DFM check succeeded"],
      "ordered-from": ["the boards were ordered from OSH Park", "We ordered the boards from OSH Park", "placed the order with PCBWay", "bought the parts at LCSC", "purchased the stencil through JLCPCB"],
      "who-ordered": ["MacroFab has shipped the boards", "the assembler fulfilled the order", "the distributor ordered the reels", "Before the provider shipped the boards, the order was paid."],
      "order-at-site": ["Order at jlcpcb.com and pay there.", "Order at pcbway.com today", "Order at oshpark.com now"],
      "order-with-confirmed": ["Your order with JLCPCB is confirmed.", "the order at PCBWay was placed", "the order from Mouser has been accepted"],
      "sent-to": ["the Gerbers were uploaded to the provider", "Sirkit sent the Gerbers to JLCPCB.", "Sirkit uploaded the bundle to PCBWay.", "Sirkit has sent your board files to the manufacturer.", "the bundle was submitted to Eurocircuits", "the files were transferred to the assembler"],
      "sends-to-named": ["Sirkit sends the bundle to JLCPCB.", "Sirkit uploads the bundle to JLCPCB as-is.", "Sirkit submits the order to MacroFab", "Sirkit transfers the files to the PCBWay quote tool"],
      "upload-as-is": ["Upload the zip to jlcpcb.com as-is.", "the bundle uploaded as-is", "uploading it as-is works", "a person uploads it as-is"],
      verdict: ["MANUFACTURER UPLOAD ZIP READY: YES", "MANUFACTURER UPLOAD VERIFICATION: PASS"],
      control: ["Open Send to fab again."],
    };
    expect(Object.keys(CLAIMED).sort()).toEqual(FORMS.map(([, form]) => form).sort());
    expect(FORMS).toHaveLength(19);
    for (const [kind, form, source] of FORMS) {
      for (const line of CLAIMED[form] ?? []) {
        if (!new RegExp(source, kind === VERDICT || kind === CONTROL ? "" : "i").test(line)) problems.push(`${form} does not match: ${line}`);
        if (!statements(["docs/new.md"], () => line, CLAIMS).some((found) => found.claim === kind)) problems.push(`not reported as ${kind}: ${line}`);
        if (kind !== CONTROL && uncorrectedClaims(["docs/new.md"], () => line, []).length === 0) problems.push(`not reported: ${line}`);
      }
    }
    const wrapped = uncorrectedClaims(["app/lib/new.ts"], () => [" * JLCPCB's quote", " * tool accepts the bundle"].join(NEWLINE), []);
    if (JSON.stringify(wrapped) !== JSON.stringify(["app/lib/new.ts:2 (a provider accepted the bundle)"])) problems.push(`wrapped: ${JSON.stringify(wrapped)}`);
    // a negation, a condition, the registry's hand-off wording, the egress's own description and this closeout's truth are not claims
    // [B23 closeout lead, 2026-10-05] the check's two low issues: a temporal word before a provider is a condition only before a present or
    // perfect verb ("until JLCPCB has quoted"), never before a simple past ("When JLCPCB accepted the bundle" claims it, CLAIMED above); and
    // "the API" or "a quote" is no provider without its name or role ("the API accepts only a JSON body")
    const NEGATIONS = [TRUTH, "Nothing is sent to the provider; a commit is refused.", "The bundle was not accepted by the provider.", "a person uploads the Gerber bundle at JLCPCB's quote page", "Sirkit never orders hardware or spends money.", "no file is uploaded to JLCPCB", "JLCPCB has not accepted the bundle.", "neither JLCPCB nor PCBWay accepted it", "if the provider accepts the order, its order id is recorded", "until JLCPCB has quoted the board, nothing is shown", "Sirkit has never sent a bundle to JLCPCB.", "A5 governs what Sirkit sends to a provider.", "when the provider accepts the order, its id is recorded", "once JLCPCB has accepted the bundle, the order id is stored", "the API accepts only a JSON body", "the API accepted the request with 202", "a quote priced in euros"];
    for (const line of NEGATIONS) if (uncorrectedClaims(["docs/new.md"], () => line, []).length !== 0) problems.push(`reported: ${line}`);
    // the allow-lists: each entry on exactly one line of its file, still a claim, with no note on it, admitting its pinned number of
    // statements inside its own text (coverage-2, tests-3: what an entry admits cannot grow unseen)
    for (const [list, patterns] of [[ALLOWED, CLAIMS], [PAGE_ALLOWED, CLAIMS], [QUOTING, SUPERSEDED]] as const) {
      for (const entry of list) {
        const lines = read(entry.path).split(NEWLINE).filter((line) => line.includes(entry.text));
        if (lines.length !== 1) problems.push(`${entry.path}: ${entry.text} on ${lines.length} lines`);
        else if (!patterns.some(([, pattern]) => new RegExp(pattern.source, pattern.flags.replace("g", "")).test(lines[0]!))) problems.push(`${entry.path}: ${entry.text} states no claim`);
        else if (lines[0]!.includes(NOTE)) problems.push(`${entry.path}: ${entry.text} carries a note`);
        if (entry.why.length < 20) problems.push(`${entry.path}: no reason`);
      }
      expect(admitted(list, patterns), list[0]!.path).toEqual(list.map((entry) => entry.admits));
    }
    expect([ALLOWED.length, PAGE_ALLOWED.length, QUOTING.length]).toEqual([5, 2, 4]);
    expect([ALLOWED, PAGE_ALLOWED].map((list) => list.reduce((sum, entry) => sum + entry.admits, 0))).toEqual([6, 2]);
    // coverage-6: only the qualified preset's notes are called inside the pinned release identity
    const qualified = /QUALIFIED_FABRICATION_PROFILE_ID = "([a-z0-9-]+)"/.exec(read(QUALIFY))?.[1];
    expect(qualified).toBe("jlcpcb-2l");
    for (const entry of ALLOWED.filter((own) => own.path.startsWith(`${PRESETS}/`))) if (entry.why.includes("pinned release identity") !== (entry.path === `${PRESETS}/${qualified}.fab.json`)) problems.push(`${entry.path}: the reason misstates the pinned release identity`);
    // a claim appended to an allowed line, written after or inside a note, or on an allowed line moved to another file, is reported
    const contract = ALLOWED[4]!;
    const appended = (path: string): string => read(path).replace(contract.text, `${contract.text} JLCPCB shipped the boards.`);
    const contractLine = read(contract.path).split(NEWLINE).findIndex((line) => line.includes(contract.text)) + 1;
    if (JSON.stringify(uncorrectedClaims([contract.path], appended, ALLOWED)) !== JSON.stringify([`${contract.path}:${contractLine} (an order with a provider)`])) problems.push("a claim appended to an allowed line is not reported");
    const readmeNote = notesIn(read("README.md"))[0]!;
    const afterNote = (path: string): string => read(path).replace(readmeNote, `${readmeNote} JLCPCB accepted it.`);
    const inNote = (path: string): string => read(path).replace(readmeNote, `${readmeNote.slice(0, -1)}; JLCPCB accepted it on 2026-10-06]`);
    for (const [how, text] of [["after", afterNote], ["inside", inNote]] as const) if (JSON.stringify(uncorrectedClaims(["README.md"], text, PAGE_ALLOWED)) !== JSON.stringify(["README.md:41 (a provider accepted the bundle)"])) problems.push(`a claim ${how} a note is not reported`);
    const moved = ALLOWED[2]!;
    if (uncorrectedClaims(["app/lib/pcb/fab/presets/moved.fab.json"], () => read(moved.path), ALLOWED).length === 0) problems.push("a moved allowed line is not reported");
    // the control name: its uses pinned per file in production and on the pages, so a new or moved use is reviewed (tests-6)
    expect([controls(productionCopy(), read), controls(pages(), read)]).toEqual([CONTROL_ADMITS.production, CONTROL_ADMITS.pages]);
    const shuffled = (path: string): string => (path === "app/components/pcb/ShortcutsHelp.tsx" ? read(path).replace("Send to fab (Gerber bundle)", "Export fab bundle") : `${read(path)}${NEWLINE}Open **Send to fab** again.`);
    const pair = ["app/components/pcb/ShortcutsHelp.tsx", "docs/pcb-quickstart.md"];
    if (total(controls(pair, shuffled)) !== total(controls(pair, read)) || JSON.stringify(controls(pair, shuffled)) === JSON.stringify(controls(pair, read))) problems.push("a moved Send to fab is not seen");
    // with every note stripped, the scans report exactly what the closeout noted
    const stripped = (path: string): string => unnoted(read(path));
    const claimed = [...uncorrectedClaims(productionCopy(), stripped, ALLOWED), ...uncorrectedClaims(pages(), stripped, PAGE_ALLOWED)].sort();
    expect(claimed).toEqual([
      "README.md:41 (a provider accepted the bundle)",
      "docs/pcb-quickstart.md:47 (an upload a provider takes as-is)",
      "docs/pcb-quickstart.md:6 (a provider accepted the bundle)",
    ]);
    expect(uncorrectedStatements([...productionSources(), ...testFiles(), ...pages()], stripped)).toEqual([
      `${B23}tier3-vocabulary.md:166 (no transfer row in the route table (B23-B1))`,
      "app/lib/acquisition/admission-control.ts:19 (the meters keyed by a source, a server or a tool alone (B23-B2))",
      "app/lib/auth/route-policy.ts:358 (every route row false on externalTransfer (B23-B1))",
      "app/lib/auth/route-resource-classification.ts:107 (an observation query exactly when the closure reaches the boundary (B23-B1, B23-B2))",
      "app/lib/manufacturing-providers/__tests__/b23-a-tier3-vocabulary.test.ts:279 (no record carrying the side effect (B23-B1))",
      "app/lib/manufacturing-providers/__tests__/b23-b-dfm-quote-flow-page.test.ts:103 (the B3 page sections as 17-26 (B23-B3 review))",
      "app/lib/manufacturing-providers/provider-egress.ts:135 (production injecting nothing into the provider egress (B23-B2))",
      "app/lib/manufacturing-providers/provider-registry.ts:16 (the registry read by no route (B23-B1, B23-B3))",
    ].sort());
    expect(claimed.length + SUPERSEDED.length).toBe(NOTED.length);
    // the page records every entry, every file the control name is used in, and the one preset inside the pinned release identity
    const four = section(pageText(), "## 4. ");
    for (const entry of [...ALLOWED, ...PAGE_ALLOWED, ...QUOTING]) if (!four.includes(`\`${entry.path}\``)) problems.push(`the page's section 4 does not name ${entry.path}`);
    for (const [path, count] of [...Object.entries(CONTROL_ADMITS.production), ...Object.entries(CONTROL_ADMITS.pages)]) if (!four.includes(`\`${path}\` (${count})`)) problems.push(`the page's section 4 does not say: ${path} (${count})`);
    for (const fact of ["Send to fab", `${total(CONTROL_ADMITS.production)} times in production`, `${total(CONTROL_ADMITS.pages)} on the pages`, "Only `" + qualified + "`'s notes are inside the pinned release identity"]) if (!four.includes(fact)) problems.push(`the page's section 4 does not say: ${fact}`);
    expect(problems).toEqual([]);
  });

  it("4. each superseded statement keeps its own words and its note says the truth beside it - the D23-16 notes the closeout's words exactly - for ALL eleven lines that carry the note, with the line's own references; no other line carries one; no note spells another closeout's prefix or claim words; and no note states a claim of this closeout's vocabulary", { timeout: 60_000 }, () => {
    const problems: string[] = [];
    const matched = new Set<string>();
    for (const noted of NOTED) {
      const lines = read(noted.path).split(NEWLINE).flatMap((line, index) => (line.includes(noted.claim) && line.includes(NOTE) ? [[index, line] as const] : []));
      if (lines.length !== 1) {
        problems.push(`${noted.path}: ${noted.claim} noted on ${lines.length} lines`);
        continue;
      }
      matched.add(`${noted.path}:${lines[0]![0] + 1}`);
      const notes = notesIn(lines[0]![1]);
      if (notes.length !== 1) problems.push(`${noted.path}: ${notes.length} notes on the line`);
      const note = notes[0] ?? "";
      if (!note.startsWith(`${NOTE}${noted.refs}): `)) problems.push(`${noted.path}: the note's references are not (${noted.refs})`);
      for (const kept of noted.keeps) if (!note.includes(kept)) problems.push(`${noted.path}: the note does not say "${kept}"`);
      if (lines[0]![1].indexOf(noted.claim) > lines[0]![1].indexOf(NOTE)) problems.push(`${noted.path}: the note stands before its statement`);
    }
    expect(problems).toEqual([]);
    expect(NOTED).toHaveLength(11);
    const everyNoted = [...productionCopy(), ...testFiles(), ...pages()].flatMap((path) => read(path).split(NEWLINE).flatMap((line, index) => (line.includes(NOTE) ? [`${path}:${index + 1}`] : [])));
    expect(everyNoted.sort()).toEqual([...matched].sort());
    for (const path of new Set(NOTED.map((noted) => noted.path))) {
      for (const note of notesIn(read(path))) {
        for (const prefix of FOREIGN) expect(note, path).not.toContain(prefix);
        expect(note, path).not.toMatch(FOREIGN_WORDS);
        // [B23 closeout (1/2) review] tests-2: a note states no claim itself (case 3 shows one written into a note is reported)
        expect(report(statements([path], () => note, CLAIMS)), path).toEqual([]);
      }
    }
    // the D23-16 notes say exactly the closeout's words (OD-178)
    for (const noted of NOTED.filter((entry) => entry.refs === "D23-16, OD-178")) expect(notesIn(read(noted.path)).some((note) => note.startsWith(`${NOTE}${noted.refs}): ${TRUTH}`)), noted.claim).toBe(true);
  });

  it("5. every file keeps its pinned number of notes - eleven in ten files: five production lines, two test files, three pages - and no other file carries one (the lead's records are not scanned)", { timeout: 60_000 }, () => {
    const counts: Record<string, number> = {};
    for (const path of [...productionCopy(), ...testFiles(), ...pages()]) {
      const count = occurrences(read(path), NOTE);
      if (count > 0) counts[path] = count;
    }
    expect(counts).toEqual(NOTE_COUNTS);
    expect(Object.values(NOTE_COUNTS).reduce((sum, count) => sum + count, 0)).toBe(5 + 2 + 4);
  });

  it("6. the stale title the closeout retitled never comes back: the retired wording is in no title of its suite and on no page, the suite carries the one same-line retitle note, its new title names - in the pin's order - exactly the five files its body pins and says only what the case's body asserts (a deleted assertion or a swapped file is reported), and its `it(` count is unchanged", { timeout: 60_000 }, () => {
    const titleLines = (path: string): string[] => read(path).split(NEWLINE).filter((line) => /^\s*(?:it|describe)(?:\.runIf\([^)]*\))?\(/.test(line));
    const problems: string[] = [];
    for (const [path, retired] of RETIRED_TITLES) {
      if (titleLines(path).some((line) => line.slice(0, line.indexOf("\", ") < 0 ? undefined : line.indexOf("\", ")).includes(retired))) problems.push(`${path}: a title still says "${retired}"`);
      for (const page of pages()) if (read(page).includes(retired)) problems.push(`${page} quotes "${retired}"`);
    }
    const retitled = testFiles().flatMap((path) => read(path).split(NEWLINE).flatMap((line, index) => (line.includes(RETITLED) ? [[path, index] as const] : [])));
    expect(retitled.map(([path]) => path)).toEqual([ADMISSION]);
    const lines = read(ADMISSION).split(NEWLINE);
    const [, at] = retitled[0]!;
    const title = lines[at]!.slice(0, lines[at]!.indexOf("\", "));
    expect(title).toMatch(/^\s*it\("8\. /);
    // [B23 closeout (1/2) review] tests-5: the title is derived from the body - the pin's files in order, and each assertion it names
    expect(retitleProblems(lines, at)).toEqual([]);
    expect(TITLED).toHaveLength(5);
    const withoutGenerator = lines.map((line) => (line.includes("expect(generator).not.toContain(") ? "" : line));
    const swapped = lines.map((line, index) => (index === at + 1 ? line.replace("\"app/api/pcb-sync/manufacturing-summary.ts\"", "\"app/api/pcb-sync/stage3.ts\"") : line));
    if (retitleProblems(withoutGenerator, at).length === 0) problems.push("deleted generator assertions are not reported");
    if (swapped[at + 1] === lines[at + 1] || retitleProblems(swapped, at).length === 0) problems.push("a swapped pinned file is not reported");
    expect(lines[at]).toMatch(/; assertions unchanged$/);
    expect(problems).toEqual([]);
    for (const [path, count] of Object.entries(IT_COUNTS)) expect((read(path).match(/^\s*it\(/gm) ?? []).length, path).toBe(count);
  });

  it("7. the closeout page records every B23 export with no production caller and what was done with it, re-derived from the tree: a recorded export is still exported and used only as its kind says, a member is never passed or called where production composes its owner and each composition passes a closed literal of exactly its pinned keys (parsed: a named options object or a spread is reported), a dormant module has no production importer but its allowed ones, nothing is retired, the deliveries the B23 pages call delivered and unbound are each recorded or kept, and each B23 page's closing section names its records", { timeout: 60_000 }, () => {
    const rows = [...section(pageText(), "## 3. ").matchAll(EXPORT_ROW)].map((match) => ({ item: match[1]!, module: match[2]!, name: match[3]!, members: match[4] === "-" ? [] : match[4]!.split(", ").map((member) => member.replace(/`/g, "")), kind: match[5]!, decision: match[6]!, page: match[7]!, why: match[8]!.trim() }));
    expect(rows).toHaveLength(34);
    expect(rows.filter((row) => row.decision === "RETIRE")).toHaveLength(0);
    const production = productionSources().map((path) => [path, read(path)] as const);
    const stripped = new Map(production.map(([path, text]) => [path, stripComments(text)] as const));
    const tests = testFiles().map((path) => read(path));
    const word = (name: string): RegExp => new RegExp(`\\b${name}\\b`);
    const named = (name: string, except: string): string[] => [...stripped].filter(([path, text]) => path !== except && word(name).test(text)).map(([path]) => path);
    const importers = (target: string): string[] => {
      const base = target.slice(target.lastIndexOf("/") + 1).replace(/\.tsx?$/, "");
      const specifier = new RegExp(`(?:from\\s+|import\\(\\s*)["'][^"']*\\/${base}["']`);
      return production.filter(([path, text]) => path !== target && specifier.test(text)).map(([path]) => path).sort();
    };
    const problems: string[] = [];
    for (const row of rows) {
      const own = read(row.module);
      const exported = new RegExp(`export (?:const|function|type|interface|class) ${row.name}\\b`).test(own);
      if (row.why.length < 20) problems.push(`${row.item}: no reason`);
      if (row.name === "*") {
        if (row.kind !== "extension point" && row.kind !== "dormant contract") problems.push(`${row.item}: a whole module is not a ${row.kind}`);
        const allowed = DORMANT_IMPORTERS[row.module];
        if (allowed === undefined) problems.push(`${row.item}: ${row.module} has no importer allow-list`);
        else if (JSON.stringify(importers(row.module)) !== JSON.stringify([...allowed].sort())) problems.push(`${row.item}: ${row.module} is imported by ${importers(row.module).join(", ")}`);
      } else if (row.members.length === 0) {
        if (!exported) problems.push(`${row.item}: ${row.module} does not export ${row.name}`);
        const others = named(row.name, row.module);
        const testNamed = tests.some((text) => word(row.name).test(text));
        if (row.kind === "generator render") {
          if (others.some((path) => !GENERATORS.includes(path))) problems.push(`${row.item}: ${row.name} is named by ${others.join(", ")}`);
          if (!testNamed) problems.push(`${row.item}: no test names ${row.name}`);
        } else if (["vocabulary", "test oracle", "test seam", "test gate", "deferred retirement"].includes(row.kind)) {
          if (others.length > 0) problems.push(`${row.item}: ${row.name} is named by ${others.join(", ")}`);
          if (row.kind === "vocabulary" && !own.includes(`typeof ${row.name}`)) problems.push(`${row.item}: no type is read from ${row.name}`);
          if (["test oracle", "test seam", "test gate"].includes(row.kind) && !testNamed) problems.push(`${row.item}: no test names ${row.name}`);
          if (row.kind === "deferred retirement" && testNamed) problems.push(`${row.item}: a test names ${row.name}`);
        } else problems.push(`${row.item}: ${row.kind} is not a kind for a name`);
      } else {
        if (!new RegExp(`export (?:interface|class|function) ${row.name}\\b`).test(own)) problems.push(`${row.item}: ${row.module} does not declare ${row.name}`);
        for (const member of row.members) if (!new RegExp(`\\b${member}\\??(?:\\(|:)`).test(own)) problems.push(`${row.item}: ${row.name} has no ${member}`);
        if (row.kind === "deferred retirement") {
          // the parameter no caller passes: every call, in production and in the tests, passes nothing
          const calls = [...production.map(([, text]) => text), ...tests].join(NEWLINE).split(`${row.name}(`).length - 1 - 1;
          const bare = [...production.map(([, text]) => text), ...tests].join(NEWLINE).split(`${row.name}()`).length - 1;
          if (calls !== bare || calls < 1) problems.push(`${row.item}: ${calls} calls of ${row.name}, ${bare} without an argument`);
          continue;
        }
        if (!["test seam", "test oracle", "injection seam"].includes(row.kind)) problems.push(`${row.item}: ${row.kind} is not a kind for a member`);
        const site = MEMBER_SITES[row.name];
        if (site === undefined) {
          problems.push(`${row.item}: no composition site for ${row.name}`);
          continue;
        }
        if ("anchor" in site) {
          const calls = [...stripped].filter(([path]) => path !== row.module).flatMap(([path, text]) => [...text.matchAll(new RegExp(site.anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))].map((match) => [path, callAt(text, match.index!)] as const));
          if (JSON.stringify([...new Set(calls.map(([path]) => path))].sort()) !== JSON.stringify([...site.sites].sort())) problems.push(`${row.item}: ${site.anchor} is called in ${calls.map(([path]) => path).join(", ")}`);
          for (const [path, call] of calls) for (const member of row.members) if (word(member).test(call.slice(site.anchor.length))) problems.push(`${row.item}: ${path} passes ${member}`);
          // parsed: each site composes the owner once, with a closed literal of exactly the pinned keys - no named object, no spread
          const pinned = [...site.keys].sort().join(", ");
          if (site.keys.some((key) => row.members.includes(key))) problems.push(`${row.item}: a pinned key is a member`);
          for (const path of site.sites) {
            const composed = compositions(path, read(path), site.callee, site.argument);
            if (JSON.stringify(composed) !== JSON.stringify([pinned])) problems.push(`${row.item}: ${path} composes ${site.callee} with ${composed.join(" / ") || "nothing"}, not { ${pinned} }`);
          }
        } else {
          const holders = site.holders[0] === "*" ? [...stripped.keys()].filter((path) => path !== row.module) : site.holders;
          if (site.holders[0] !== "*" && JSON.stringify(importers(row.module)) !== JSON.stringify([...site.holders].sort())) problems.push(`${row.item}: ${row.module} is held by ${importers(row.module).join(", ")}`);
          for (const path of holders) for (const member of row.members) if (new RegExp(`\\.${member}\\s*\\(`).test(stripped.get(path) ?? "")) problems.push(`${row.item}: ${path} calls ${member}`);
        }
      }
      const record = read(`${B23}${row.page}`);
      const block = record.includes(RECORD_HEADING) ? record.slice(record.indexOf(RECORD_HEADING)) : "";
      for (const mention of [row.name === "*" ? `\`${row.module.slice(row.module.lastIndexOf("/") + 1)}\`` : `\`${row.name}\``, ...row.members.map((member) => `\`${member}\``)]) if (!block.includes(mention)) problems.push(`${row.item}: ${row.page} does not record ${mention}`);
    }
    expect(problems).toEqual([]);
    // [B23 closeout (1/2) review] security-2, tests-4: the parse bites - a named options object, a spread, a JSX spread and an extra key
    const ROUTE = "app/api/pcb/provider-exchange/route.ts";
    const COMPOSITION = "new ProviderExchangeService({ env: process.env })";
    expect(read(ROUTE)).toContain(COMPOSITION);
    for (const [variant, expected] of [
      ["const SERVICE_OPTIONS = { env: process.env, transfer: { descriptors: [] } }; const exchanges = new ProviderExchangeService(SERVICE_OPTIONS);", "not an object literal: SERVICE_OPTIONS"],
      ["const exchanges = new ProviderExchangeService({ ...options, env: process.env });", "not a named key: ...options"],
      ["const exchanges = new ProviderExchangeService({ env: process.env, now: () => 0 });", "env, now"],
    ] as const) expect(compositions(ROUTE, read(ROUTE).replace(`const exchanges = ${COMPOSITION};`, variant), "ProviderExchangeService", 0)).toEqual([expected]);
    expect(compositions("app/components/pcb/ManufacturingWorkflowPanel.tsx", "const panel = <ProviderExchangePanel {...panelProps} />;", "ProviderExchangePanel", "props")).toEqual(["a spread: {...panelProps}"]);
    // the verified sweep's 27 items and the five C/D modules, each once
    expect(rows.map((row) => row.item).sort()).toEqual([...["01", "03A", "03B", "04", "05R", "06", "07", "08", "09", "10", "11", "12", "13", "14", "15", "16A", "16B", "17", "18", "19", "20", "21", "22", "23", "24", "25", "26", "27", "28"].map((id) => `DC-${id}`), "CO-E1", "CO-E2", "CO-E3", "CO-E4", "CO-E5"].sort());
    // the deliveries the B23 pages describe as delivered and unbound are kept: still exported, and no retirement names their modules
    for (const [path, name] of DELIVERED_UNBOUND) {
      expect(new RegExp(`export (?:async )?(?:const|function|class) ${name}\\b`).test(read(path)), `${path}: ${name}`).toBe(true);
      expect(rows.some((row) => row.module === path && row.decision === "RETIRE"), path).toBe(false);
    }
    for (const path of Object.keys(DORMANT_IMPORTERS)) expect(rows.some((row) => row.module === path && row.name === "*" && row.decision === "RECORD"), path).toBe(true);
  });

  it("8. the page's sections 1 and 2 are the tree's notes and retitle, row for row - each row's file:line carries the note with the row's references and words, or the retitle note in a suite of the row's `it(` count; no note or retitle in the tree lacks a row - every closeout tag in app/ is the retitle, and the page's head says which sections the tripwire re-derives", { timeout: 60_000 }, () => {
    const page = pageText();
    const problems: string[] = [];
    const head = page.slice(0, page.indexOf(`${NEWLINE}## 0. `));
    if (!head.includes(PINNED_SECTIONS)) problems.push(`the page's head does not say: ${PINNED_SECTIONS}`);
    const noteRows: string[] = [];
    for (const [heading, count] of [["### 1.1 ", 5], ["### 1.2 ", 2], ["### 1.3 ", 4]] as const) {
      const rows = [...subsection(page, heading).matchAll(NOTE_ROW)];
      if (rows.length !== count) problems.push(`${heading}: ${rows.length} rows, not ${count}`);
      for (const [, item, path, line, references, says] of rows) {
        const text = read(path!).split(NEWLINE)[Number(line) - 1] ?? "";
        if (!text.includes(`${NOTE}${references!.trim()}): ${says!.trim().replace(/ \.\.\.$/, "")}`)) problems.push(`${item} ${path}:${line}: the line does not carry the row's note`);
        noteRows.push(`${path}:${line}`);
      }
    }
    const treeNotes = [...productionCopy(), ...testFiles(), ...pages()].flatMap((path) => read(path).split(NEWLINE).flatMap((line, index) => (line.includes(NOTE) ? [`${path}:${index + 1}`] : [])));
    expect(problems).toEqual([]);
    expect(noteRows.sort()).toEqual(treeNotes.sort());
    const titleRows = [...section(page, "## 2. ").matchAll(TITLE_ROW)].map(([, item, path, line, retired, count]) => ({ item: item!, path: path!, line: Number(line), retired: retired!, count: Number(count) }));
    expect(titleRows).toHaveLength(1);
    for (const row of titleRows) {
      const own = read(row.path);
      expect(own.split(NEWLINE)[row.line - 1], `${row.item} ${row.path}:${row.line}`).toContain(RETITLED);
      expect((own.match(/^\s*it\(/gm) ?? []).length, row.path).toBe(row.count);
      expect(IT_COUNTS[row.path], row.path).toBe(row.count);
      expect(RETIRED_TITLES.some(([path, retired]) => path === row.path && row.retired.includes(retired)), row.retired).toBe(true);
    }
    // every closeout tag in code is the retitle
    const tags = [...productionSources(), ...testFiles()].flatMap((path) => read(path).split(NEWLINE).filter((line) => line.includes(TAG)).map((line) => `${path}: ${line.includes(RETITLED) ? "retitle" : line.trim()}`));
    expect(tags).toEqual([`${ADMISSION}: retitle`]);
  });
});
