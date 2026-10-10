/**
 * [B24-F] Readers for B24-Fb's two registers, test-only (lead decision D17): the seven numbered defect registers, the owner-decision
 * facts of `OWNER_DECISIONS.md` and the B20/B23 unknowns pages, and the places the B24 records hold a superseded-statement list. Pure
 * over text: every function takes the files' text through `read` and returns data.
 */
const NEWLINE = String.fromCharCode(10);
const DASH = String.fromCharCode(0x2014);

export type Read = (path: string) => string;

/** The seven numbered registers (OD-220): F18's table, D19's table, and the defect headings of B20..B24's discoveries. */
export const DEFECT_REGISTERS = Object.freeze([
  { prefix: "F18", path: "artifacts/ai-control-plane-b18/unknowns-and-owner-decisions.md", shape: "table" },
  { prefix: "D19", path: "artifacts/ai-control-plane-b19/discovery.md", shape: "table" },
  { prefix: "D20", path: "artifacts/ai-control-plane-b20/discovery.md", shape: "heading" },
  { prefix: "D21", path: "artifacts/ai-control-plane-b21/discovery.md", shape: "heading" },
  { prefix: "D22", path: "artifacts/ai-control-plane-b22/discovery.md", shape: "heading" },
  { prefix: "D23", path: "artifacts/ai-control-plane-b23/discovery.md", shape: "heading" },
  { prefix: "D24", path: "artifacts/ai-control-plane-b24/discovery.md", shape: "heading" },
] as const);

/** Every defect id of the seven registers, in register order: a `| F18-n |` or `| D19-n |` table row, or a `**D2x-n - ` (or an em dash)
 *  defect heading at a line's start (after a dated `- [<tag>] ` prefix too); B21's reader ids (`D21-49`..) are sources, never headings. */
export function defectIds(read: Read): string[] {
  const ids: string[] = [];
  for (const register of DEFECT_REGISTERS) {
    const pattern = register.shape === "table" ? new RegExp(`^\\| (${register.prefix}-\\d+) \\|`) : new RegExp(`^(?:- \\[[^\\]]+\\] )?\\*\\*(${register.prefix}-\\d+) [-\\u2014] `);
    for (const line of read(register.path).split(NEWLINE)) {
      const match = pattern.exec(line);
      if (match) ids.push(match[1]!);
    }
  }
  return ids;
}

/** The chapter directory prefix a defect id belongs to (`F18-3` -> `artifacts/ai-control-plane-b18`). */
export const chapterOf = (id: string): string => `artifacts/ai-control-plane-b${/^[FD](\d\d)-/.exec(id)![1]}`;

// ── owner decisions ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const OWNER_DECISIONS = "artifacts/remaining-builder-program/OWNER_DECISIONS.md";
export const B20_UNKNOWNS = "artifacts/ai-control-plane-b20/unknowns-and-owner-decisions.md";
export const B23_UNKNOWNS = "artifacts/ai-control-plane-b23/unknowns-and-owner-decisions.md";

export interface OwnerDecisionFact {
  readonly n: number;
  /** the 1-based lines of its `## OD-n` headings (an amendment heading excluded) */
  readonly headings: readonly number[];
  readonly headingStatus: "applied" | "applied in part" | "proposed" | "recorded" | null;
  /** its first-table row's line, and that row's status cell */
  readonly firstTable: { readonly line: number; readonly status: string } | null;
  /** the lines of its `## OD-n amendment` headings */
  readonly amendmentHeadings: readonly number[];
  /** the tags that amended it: a B24 dated line under its heading by another increment, or a bold `**Amendment (<tag>, ...)` naming OD-n */
  readonly amendedBy: readonly string[];
  readonly reserved: { readonly path: string; readonly line: number } | null;
  readonly discoveryOnly: { readonly path: string; readonly line: number } | null;
  readonly neverAssigned: { readonly path: string; readonly line: number } | null;
}

/** A B24 dated line's increment: its tag without a ` lead` or ` review...` qualifier (`B24-B2 lead` -> `B24-B2`; `B24-A3b` stays). */
const baseTag = (tag: string): string => tag.replace(/\s+(?:lead|review)\b.*$/, "").trim();

/** Every OD number's recorded facts, derived from the register and the two unknowns pages (OD-1..`max`). */
export function ownerDecisionFacts(read: Read, max: number): OwnerDecisionFact[] {
  const lines = read(OWNER_DECISIONS).split(NEWLINE);
  const headings = new Map<number, number[]>();
  const amendmentHeadings = new Map<number, number[]>();
  const status = new Map<number, OwnerDecisionFact["headingStatus"]>();
  const amended = new Map<number, Set<string>>();
  const firstTable = new Map<number, { line: number; status: string }>();
  let current: { n: number; tag: string | null } | null = null;
  lines.forEach((line, index) => {
    const heading = /^## OD-(\d+)\b(.*)$/.exec(line);
    if (heading) {
      const n = Number(heading[1]);
      if (/^\s*amendment\b/.test(heading[2]!)) {
        amendmentHeadings.set(n, [...(amendmentHeadings.get(n) ?? []), index + 1]);
        current = null;
        return;
      }
      headings.set(n, [...(headings.get(n) ?? []), index + 1]);
      if (!status.has(n)) status.set(n, /\bproposed\b/.test(line) ? "proposed" : /as applied in part/.test(line) ? "applied in part" : /as applied/.test(line) ? "applied" : "recorded");
      const tags = [...line.matchAll(/\((B\d\d[^,()]*|SEC-1[^,()]*),\s*\d{4}-\d\d-\d\d/g)].map((match) => baseTag(match[1]!));
      current = { n, tag: tags.at(-1) ?? null };
      return;
    }
    if (/^## /.test(line)) current = null;
    const dated = /^\s*- \[(B24-[^,\]]+), \d{4}-\d\d-\d\d\]/.exec(line);
    if (dated && current !== null && baseTag(dated[1]!) !== current.tag) amended.set(current.n, (amended.get(current.n) ?? new Set()).add(baseTag(dated[1]!)));
    const bold = new RegExp(String.raw`^\*\*Amendment \(([^,]+), \d{4}-\d\d-\d\d\) ` + `${DASH} OD-(\\d+) ${DASH}`).exec(line);
    if (bold) amended.set(Number(bold[2]), (amended.get(Number(bold[2])) ?? new Set()).add(bold[1]!.trim()));
    const row = index < 40 ? /^\| OD-(\d+) \|.*\| ([^|]+) \|$/.exec(line) : null;
    if (row) firstTable.set(Number(row[1]), { line: index + 1, status: row[2]!.trim() });
  });
  // the reserved numbers: OWNER_DECISIONS.md's "OD-83, 84, 85, 86 and 88 are not recorded ... reserved" and B23's "OD-189 is reserved"
  const reserved = new Map<number, { path: string; line: number }>();
  lines.forEach((line, index) => {
    const match = /^- OD-(\d+), ([\d, and]+) are not recorded: their numbers stay reserved/.exec(line);
    if (match) for (const n of [match[1]!, ...match[2]!.split(/,\s*|\s+and\s+/)].filter(Boolean)) reserved.set(Number(n), { path: OWNER_DECISIONS, line: index + 1 });
  });
  read(B23_UNKNOWNS).split(NEWLINE).forEach((line, index) => {
    const match = /\bOD-(\d+) is reserved and unused\b/.exec(line);
    if (match) reserved.set(Number(match[1]), { path: B23_UNKNOWNS, line: index + 1 });
  });
  const discoveryOnly = new Map<number, { path: string; line: number }>();
  const neverAssigned = new Map<number, { path: string; line: number }>();
  read(B20_UNKNOWNS).split(NEWLINE).forEach((line, index) => {
    const match = /^\| OD-(\d+) \| - \| no: (recorded in discovery\.md section 6|a numbering gap: never assigned)/.exec(line);
    if (match) (match[2]!.startsWith("recorded") ? discoveryOnly : neverAssigned).set(Number(match[1]), { path: B20_UNKNOWNS, line: index + 1 });
  });
  return Array.from({ length: max }, (_, index) => index + 1).map((n) => ({
    n,
    headings: headings.get(n) ?? [],
    headingStatus: status.get(n) ?? null,
    firstTable: firstTable.get(n) ?? null,
    amendmentHeadings: amendmentHeadings.get(n) ?? [],
    amendedBy: [...(amended.get(n) ?? [])].sort(),
    reserved: reserved.get(n) ?? null,
    discoveryOnly: discoveryOnly.get(n) ?? null,
    neverAssigned: neverAssigned.get(n) ?? null,
  }));
}

/** The markers a row of the OD list carries, in this order, from its facts. */
export function ownerDecisionMarkers(fact: OwnerDecisionFact): string[] {
  const markers: string[] = [];
  if (fact.firstTable) markers.push("first-table");
  if (fact.headings.length === 1) markers.push("headed");
  if (fact.headings.length > 1) markers.push("double heading");
  if (fact.amendmentHeadings.length > 0) markers.push("amended in place");
  if (fact.amendedBy.length > 0) markers.push(`amended by ${fact.amendedBy.join(", ")}`);
  if (fact.reserved) markers.push("reserved");
  if (fact.discoveryOnly) markers.push("discovery-only");
  if (fact.neverAssigned) markers.push("never assigned");
  return markers;
}

/** A first-table status cell in the list's closed vocabulary. */
export function firstTableStatus(cell: string): string {
  if (/^closed\b/i.test(cell)) return "closed";
  if (/^resolved\b/i.test(cell)) return "resolved";
  if (/^open\b/i.test(cell)) return "open";
  if (/^needs owner resource\b/i.test(cell)) return "needs owner resource";
  if (/^standing\b/i.test(cell)) return "standing";
  return "unclassified";
}

/** The status a fact gives its row. */
export function ownerDecisionStatus(fact: OwnerDecisionFact): string {
  if (fact.firstTable) return firstTableStatus(fact.firstTable.status);
  if (fact.headingStatus) return fact.headingStatus;
  if (fact.reserved) return "reserved";
  if (fact.discoveryOnly) return "recorded in discovery only";
  if (fact.neverAssigned) return "never assigned";
  return "unrecorded";
}

/** OD-220 and OD-221 (the discovery's drafts B24-F applies) and OD-240 and OD-241 (B24-F's choices), appended by the lead in B24-F's
 *  commit: their line is known only once appended, so their rows name the commit and pass once the register holds one heading each. */
export const LEAD_APPENDS: readonly number[] = Object.freeze([220, 221, 240, 241]);
export const APPENDED = "`OWNER_DECISIONS.md`, appended by the lead in this commit (B24-F)";

/** What the OD list (`open-risks-and-owner-decisions.md` section 1) breaks against the facts: a number missing or out of order, a recorded
 *  place, status or marker that differs, a number recorded nowhere, a double heading beyond OD-52, OD-54, OD-135, OD-150 and OD-174, an
 *  amendment heading beyond OD-74 and OD-80, or a highest heading that is not the list's last number (lead decision D13). */
export function ownerDecisionListProblems(read: Read, rows: ReadonlyArray<Readonly<Record<string, string>>>): string[] {
  const problems: string[] = [];
  const numbers = rows.map((row) => Number(/^OD-(\d+)$/.exec(row.OD ?? "")?.[1]));
  const max = Math.max(...numbers);
  if (JSON.stringify(numbers) !== JSON.stringify(Array.from({ length: max }, (_, index) => index + 1))) problems.push("the numbers are not OD-1..OD-max, each once, in order");
  const facts = ownerDecisionFacts(read, max);
  const doubles = facts.filter((fact) => fact.headings.length > 1).map((fact) => fact.n);
  if (doubles.join(", ") !== "52, 54, 135, 150, 174") problems.push(`doubles ${doubles.join(", ")}`);
  const amendmentHeadings = facts.filter((fact) => fact.amendmentHeadings.length > 0).map((fact) => fact.n);
  if (amendmentHeadings.join(", ") !== "74, 80") problems.push(`amendment headings ${amendmentHeadings.join(", ")}`);
  const highest = Math.max(...facts.filter((fact) => fact.headings.length > 0).map((fact) => fact.n));
  if (highest !== max) problems.push(`the highest heading is OD-${highest}, the list ends at OD-${max}`);
  const cite = (path: string, line: number): string => `\`${path}:${line}\``;
  for (const fact of facts) {
    const row = rows[fact.n - 1];
    if (row === undefined) continue;
    const where = fact.firstTable ? cite(OWNER_DECISIONS, fact.firstTable.line)
      : fact.headings.length > 0 ? fact.headings.map((line) => cite(OWNER_DECISIONS, line)).join(", ")
        : fact.reserved ? cite(fact.reserved.path, fact.reserved.line)
          : fact.discoveryOnly ? cite(fact.discoveryOnly.path, fact.discoveryOnly.line)
            : fact.neverAssigned ? cite(fact.neverAssigned.path, fact.neverAssigned.line) : "-";
    const amendments = fact.amendmentHeadings.length > 0 ? `, amendment ${fact.amendmentHeadings.map((line) => cite(OWNER_DECISIONS, line)).join(", ")}` : "";
    const appended = LEAD_APPENDS.includes(fact.n) && row["recorded at"] === APPENDED && fact.headings.length === 1;
    if (!appended && row["recorded at"] !== `${where}${amendments}`) problems.push(`OD-${fact.n}: recorded at ${row["recorded at"]}, derived ${where}${amendments}`);
    if (row.status !== ownerDecisionStatus(fact)) problems.push(`OD-${fact.n}: status ${row.status}, derived ${ownerDecisionStatus(fact)}`);
    if (row.markers !== ownerDecisionMarkers(fact).join(", ")) problems.push(`OD-${fact.n}: markers ${row.markers}, derived ${ownerDecisionMarkers(fact).join(", ")}`);
    if (ownerDecisionStatus(fact) === "unrecorded") problems.push(`OD-${fact.n}: recorded nowhere`);
  }
  return problems;
}

// ── superseded-statement lists ───────────────────────────────────────────────────────────────────────────────────────────────────────

export const LEDGER = "artifacts/remaining-builder-program/EXECUTION_LEDGER.md";
/** Every place a B24 record holds a superseded-statement list: a B24 page heading that names one (B24-F's own pages and the lead's
 *  README and discovery aside), and a ledger line that hands one to B24-F. */
export function supersededListSources(read: Read, pages: readonly string[]): string[] {
  const out: string[] = [];
  for (const page of pages) {
    read(page).split(NEWLINE).forEach((line, index) => {
      if (/^#{2,3} .*(?:Superseded statements|Statements A\d supersedes)/i.test(line)) out.push(`${page}:${index + 1}`);
    });
  }
  const ledger = read(LEDGER).split(NEWLINE);
  ledger.forEach((line, index) => {
    const joined = `${line} ${ledger[index + 1] ?? ""}`;
    if (/Superseded statements for B24-F/.test(line) || (/B24-F's$/.test(line) && /superseded-statement table takes it/.test(joined))) out.push(`${LEDGER}:${index + 1}`);
  });
  return out;
}

// ── [B24-F review] commit records (b24-f-registers 2; correctness-5, security-2) ────────────────────────────────────────────────────

/** A closing-increment cell's increments (`B21-A, B21-E2 (2/2)` -> `B21-A`, `B21-E2 (2/2)`). */
export const incrementsOf = (cell: string): string[] => cell.split(",").map((part) => part.trim()).filter(Boolean);
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Whether a ledger heading's title (after `### `) is the increment's: it starts with the increment and a space, or it is a range of
 *  its chapter (`B20-C1..C3 - ...` holds B20-C2). */
function ledgerTitleNames(title: string, increment: string): boolean {
  const bare = increment.replace(/\s*\(\d\/\d\)$/, "");
  if (title.startsWith(`${increment} `) || title.startsWith(`${bare} `)) return true;
  const range = /^(B\d\d-)([A-Z])(\d+)\.\.([A-Z]?)(\d+) /.exec(title);
  const one = /^(B\d\d-)([A-Z])(\d+)$/.exec(bare);
  return range !== null && one !== null && range[1] === one[1] && range[2] === one[2] && (range[4] === "" || range[4] === one[2]) && Number(range[3]) <= Number(one[3]) && Number(one[3]) <= Number(range[5]);
}

/** Where the records bind a commit to one of a row's closing increments, read as text at this tree (never git: CI checkouts are
 *  shallow). An increment's ledger paragraph says "this commit", so its commit stands in the paragraph itself or in the next one,
 *  where the following increment records its base:
 *  - `ledger <increment>`: the increment's own `EXECUTION_LEDGER.md` section, or the section after it, holds the commit;
 *  - `changed-files <increment>`: a B19..B23 `changed-files.md` row names "`<commit>` <increment>" (each written from git by its
 *    chapter's closeout);
 *  - `b19-report <increment>`: a B19 test-and-validation row "| <I-id> `<commit>` |";
 *  - `closure <increment>`: a B24 discovery closure line "- [<increment>, <date>] ..." holds the commit.
 *  B24-F's own pages are never read, so a register row can never vouch for its own commit. */
export function commitBinder(read: Read): (sha: string, cell: string) => string[] {
  const ledger = read(LEDGER).split(NEWLINE);
  const headings = ledger.flatMap((line, index) => (line.startsWith("### ") ? [index] : []));
  const sectionAt = (heading: number): string[] => ledger.slice(heading, headings.find((index) => index > heading) ?? ledger.length);
  const changed = ["b19", "b20", "b21", "b22", "b23"].flatMap((chapter) => read(`artifacts/ai-control-plane-${chapter}/changed-files.md`).split(NEWLINE));
  const b19Report = read("artifacts/ai-control-plane-b19/test-and-validation-report.md").split(NEWLINE);
  const discovery = read("artifacts/ai-control-plane-b24/discovery.md").split(NEWLINE);
  return (sha, cell) => {
    const found: string[] = [];
    for (const increment of incrementsOf(cell)) {
      for (const heading of headings.filter((index) => ledgerTitleNames(ledger[index]!.slice(4), increment))) {
        const next = headings.find((index) => index > heading);
        if (sectionAt(heading).some((line) => line.includes(sha)) || (next !== undefined && sectionAt(next).some((line) => line.includes(sha)))) found.push(`ledger ${increment}`);
      }
      const row = new RegExp(`\`${sha}\` ${escapeRegExp(increment)}(?:[: ]|$)`);
      if (changed.some((line) => row.test(line))) found.push(`changed-files ${increment}`);
      const short = /^B19 (I\w+)$/.exec(increment)?.[1];
      if (short !== undefined && b19Report.some((line) => line.includes(`| ${short} \`${sha}\` |`))) found.push(`b19-report ${increment}`);
      if (discovery.some((line) => line.startsWith(`- [${increment}, `) && line.includes(sha))) found.push(`closure ${increment}`);
    }
    return found;
  };
}

// ── [B24-F review] the superseded-statement table's numbering and frozen lines (b24-f-registers 6; correctness-4, security-1) ────────

/** The dated lines B24-F and the closeout add to the discovery after `58c0834`: the table cites the discovery at `58c0834`'s
 *  numbering, so these lines are not counted (the b24-a1-environment-profile case 14 rule, for the increments after `58c0834`). */
export const AFTER_BASE_LINE = /^- \[B24[- ](?:F[ab]?|closeout)\b/;
/** The discovery's lines at `58c0834`'s numbering (index 0 is line 1). */
export const discoveryAtBase = (text: string): string[] => text.split(NEWLINE).filter((line) => !AFTER_BASE_LINE.test(line));
/** A forward migration (`drizzle/NNNN_*.sql`): its whole-file checksum is recorded and re-verified, so a note on it is drift. */
export const FORWARD_MIGRATION = /^drizzle\/\d{4}_[^/]+\.sql$/;
/** The note states a superseded line may carry; the last two mark a line that is never noted in place. */
export const NOTE_STATES = Object.freeze(["noted", "noted nearby", "rewritten", "not noted", "never noted in place (checksum-bound)", "never noted in place (B11-scanned, OD-113)"] as const);
