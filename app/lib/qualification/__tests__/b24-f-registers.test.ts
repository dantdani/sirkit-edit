/**
 * [B24-F] The two registers (D24-39; D24-40, B24-F's half; OD-220, OD-221): `threat-model-closure-register.md` and
 * `open-risks-and-owner-decisions.md`, re-derived from the records they cite.
 *
 *  1. the register's id set equals the ids parsed from the seven numbered registers, each exactly once;
 *  2. every state is from the closed set; every closed, closed-in-part or closed-as-recorded row names a suite that exists or a commit
 *     (7-40 hex) a record binds to its own closing increment - its ledger paragraph or the next, a B19..B23 changed-files row, B19's
 *     report row or a B24 closure line, never B24-F's pages and never through git (CI checkouts are shallow) - and only D24-39 and
 *     D24-40 may name `this commit (B24-Fb)`; every BLOCKED row names LB ids the register holds ([B24-F review, 2026-10-10]
 *     correctness-5, security-2: the check bites on two swapped commits and a planted one; security-4: D24-3 is closed in part);
 *  3. the inputs section is exactly the threat-model sources, each existing at its cited line;
 *  4. every OD number from 1 to the highest appears once, with its recorded place, status and markers equal to the facts derived from
 *     `OWNER_DECISIONS.md` and the B20/B23 unknowns pages; the double-heading set is exactly OD-52, OD-54, OD-135, OD-150 and OD-174 and
 *     the amendment headings exactly OD-74 and OD-80, so a second heading a B24 increment wrote fails here (D13). Green only once the
 *     lead has applied OD-220, OD-221, OD-240 and OD-241;
 *  5. the branch rows match the recorded listing on the page;
 *  6. the superseded-statement table (D5): every row's `path:line` resolves at this tree (the discovery's at `58c0834`'s numbering, so
 *     the closure lines the lead adds in this commit move none), every source exists and holds a list, each row's increment is its
 *     source's, every B24 record holding such a list is a source, the generated map's stale pages are rows, a checksum-bound migration
 *     or a B11-scanned file is never to be noted in place, and no row carries more than its path, line, increment, source and note
 *     state ([B24-F review, 2026-10-10] correctness-1, correctness-4, security-1).
 *
 * Failing first on 58c0834: neither page exists (`threat-model-closure-register.md` section 1; D24-39's counterexample is an empty
 * `git grep -i "closure register"`). Files are read as text; nothing is written and no process starts.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { registerRows } from "./_b24-e-register";
import { readRepo, records, sectionOf, tableUnder } from "./_b24-f-pages";
import { B11_SCANNED_FILES } from "@/app/lib/agent/orchestration/tripwires";
import { AFTER_BASE_LINE, commitBinder, defectIds, discoveryAtBase, FORWARD_MIGRATION, LEDGER, NOT_NOTED_WITH_REASON, NOTE_STATES, OWNER_DECISIONS, ownerDecisionListProblems, supersededListSources } from "./_b24-f-registers";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const REGISTER = "artifacts/ai-control-plane-b24/threat-model-closure-register.md";
const RISKS = "artifacts/ai-control-plane-b24/open-risks-and-owner-decisions.md";
const LIVE_BLOCKERS = "artifacts/remaining-builder-program/LIVE_BLOCKERS.md";
const B24 = "artifacts/ai-control-plane-b24/";
const STATES = /^(?:closed|closed in part|closed as recorded|open|BLOCKED-LIVE-QUALIFICATION \((LB-\d+(?:, LB-\d+)*)\))$/;
const exists = (path: string): boolean => existsSync(join(ROOT, ...path.split("/")));
const lineCount = (path: string): number => readRepo(path).split(NEWLINE).length;
/** Every test file under app/ by its suite name (`b24-f-maps` -> its path). */
function suitesByName(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(join(ROOT, ...dir.split("/")), { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else {
        const match = /^(.+)\.test\.tsx?$/.exec(entry.name);
        if (match) out.set(match[1]!, [...(out.get(match[1]!) ?? []), path]);
      }
    }
  };
  walk("app");
  return out;
}
const registerTable = () => records(tableUnder(readRepo(REGISTER), "5. The register"));

describe("[B24-F] the threat-model closure register and the open-risk list are their records' (D24-39, D24-40; OD-220, OD-221)", () => {
  it("1. the register's id set equals the ids of the seven numbered registers (F18, D19, D20..D24), each exactly once", () => {
    const expected = defectIds(readRepo);
    expect(expected.length).toBeGreaterThanOrEqual(186);
    expect(new Set(expected).size).toBe(expected.length);
    const rows = registerTable();
    const ids = rows.map((row) => row.id!);
    expect(new Set(ids).size).toBe(ids.length);
    const byNumber = (a: string, b: string): number => a.slice(0, 3).localeCompare(b.slice(0, 3)) || Number(a.slice(4)) - Number(b.slice(4));
    expect([...ids].sort(byNumber)).toEqual([...expected].sort(byNumber));
    // the parse bites: B21's reader ids are no headings, and a dated D24 heading is one
    expect(expected).not.toContain("D21-49");
    expect(expected).toEqual(expect.arrayContaining(["F18-1", "D19-12", "D20-36", "D21-48", "D22-24", "D23-21", "D24-1", "D24-40", "D24-43"]));
  });

  it("2. every state is from the closed set; a closed row names an existing suite or a commit the records bind to its closing increment, and only D24-39 and D24-40 name this commit; every BLOCKED row's LBs are register rows", () => {
    const suites = suitesByName();
    const lbs = new Set(registerRows(readRepo(LIVE_BLOCKERS)).map((row) => row.id));
    // [B24-F review, 2026-10-10] correctness-5, security-2: a commit is bound to the row's own closing increment by a record (its ledger
    // paragraph or the next, a B19..B23 changed-files row, B19's report row or a B24 closure line); B24-F's pages are never read.
    const bound = commitBinder(readRepo);
    const rowProblems = (rows: ReadonlyArray<Readonly<Record<string, string>>>): string[] => {
      const problems: string[] = [];
      for (const row of rows) {
        const state = STATES.exec(row.state!);
        if (state === null) { problems.push(`${row.id}: state ${row.state}`); continue; }
        for (const id of (state[1] ?? "").split(", ").filter(Boolean)) if (!lbs.has(id)) problems.push(`${row.id}: ${id} is no register row`);
        const suite = row.suite === "none" ? null : /^`([a-z0-9-]+)`$/.exec(row.suite!)?.[1] ?? "?";
        if (suite !== null && (suites.get(suite)?.length ?? 0) !== 1) problems.push(`${row.id}: suite ${row.suite} is not one test file`);
        const commit = row.commit!;
        if (commit.startsWith("this commit")) {
          if (!["D24-39", "D24-40"].includes(row.id!) || commit !== "this commit (B24-Fb)") problems.push(`${row.id}: ${commit}`);
        } else if (commit !== "-") {
          const sha = /^`([0-9a-f]{7,40})`$/.exec(commit)?.[1];
          if (sha === undefined) problems.push(`${row.id}: commit ${commit}`);
          else if (bound(sha, row["closing increment"]!).length === 0) problems.push(`${row.id}: no record binds ${sha} to ${row["closing increment"]}`);
        }
        if (/^closed/.test(row.state!) && suite === null && commit === "-") problems.push(`${row.id}: ${row.state} with no suite and no commit`);
      }
      return problems;
    };
    const rows = registerTable();
    expect(rowProblems(rows)).toEqual([]);
    // the commit check bites: two rows' commits swapped, and a commit no record holds, are each reported
    const commitOf = (id: string): string => rows.find((row) => row.id === id)!.commit!;
    const swapped = rows.map((row) => (row.id === "D20-3" ? { ...row, commit: commitOf("D24-1") } : row.id === "D24-1" ? { ...row, commit: commitOf("D20-3") } : row));
    expect(rowProblems(swapped).map((problem) => problem.split(":")[0])).toEqual(["D20-3", "D24-1"]);
    expect(rowProblems(rows.map((row) => (row.id === "D24-4" ? { ...row, commit: "`deadbee`" } : row)))).toEqual(["D24-4: no record binds deadbee to B24-A2"]);
    // [B24-F review, 2026-10-10] security-4: D24-3's role half is recorded, not applied (OD-192 keeps the application role PROPOSED), so
    // the row is closed in part and its residual names the owning role, the decision and the live blocker
    const d243 = rows.find((row) => row.id === "D24-3")!;
    expect(d243.state).toBe("closed in part");
    for (const fact of ["owning role", "OD-192", "LB-14"]) expect(d243.residual, fact).toContain(fact);
    expect(readRepo(OWNER_DECISIONS)).toContain("The application role is PROPOSED only");
  });

  it("3. the inputs section is exactly the threat-model sources (B03.1, B09 and B13's security boundaries, the CD-10 report's threat model, B22's threat model sections 4 and 5 and adversarial matrix sections 6 and 10), each existing at its cited line", () => {
    const inputs = tableUnder(readRepo(REGISTER), "2. Inputs").rows.map((row) => /^`(.+):(\d+)`$/.exec(row[1]!)?.slice(1) ?? []);
    expect(inputs.map(([path, line]) => `${path}:${line}`)).toEqual([
      "artifacts/ai-control-plane-b03-1/security-boundary.md:1",
      "artifacts/ai-control-plane-b09/security-boundary.md:1",
      "artifacts/ai-control-plane-b13/security-boundary.md:1",
      "docs/stage-reports/SIRKIT_CD_10_MODEL_BACKED_SIMULATION_IMPLEMENTATION.md:55",
      "artifacts/ai-control-plane-b22/threat-model.md:117",
      "artifacts/ai-control-plane-b22/threat-model.md:140",
      "artifacts/ai-control-plane-b22/adversarial-matrix.md:174",
      "artifacts/ai-control-plane-b22/adversarial-matrix.md:323",
    ]);
    const heading = (path: string, line: number): string => readRepo(path).split(NEWLINE)[line - 1] ?? "";
    expect(heading("docs/stage-reports/SIRKIT_CD_10_MODEL_BACKED_SIMULATION_IMPLEMENTATION.md", 55)).toBe("## Threat model");
    expect(heading("artifacts/ai-control-plane-b22/threat-model.md", 117)).toMatch(/^## 4\. /);
    expect(heading("artifacts/ai-control-plane-b22/threat-model.md", 140)).toMatch(/^## 5\. /);
    expect(heading("artifacts/ai-control-plane-b22/adversarial-matrix.md", 174)).toMatch(/^## 6\. /);
    expect(heading("artifacts/ai-control-plane-b22/adversarial-matrix.md", 323)).toMatch(/^## 10\. /);
    for (const [path] of inputs) expect(exists(path!), path).toBe(true);
    // the scope claims no threat modelling for another chapter, and names the review-input mention as no source
    const scope = sectionOf(readRepo(REGISTER), "1. Scope");
    expect(scope).toContain("claims no threat modelling for any other chapter");
    expect(scope).toContain("`app/lib/requirements/verification.ts:12`");
  });

  it("4. every OD number from OD-1 to the highest appears once, its recorded place, status and markers derived from OWNER_DECISIONS.md and the B20/B23 unknowns pages; the doubles are exactly OD-52, OD-54, OD-135, OD-150 and OD-174 and the amendment headings OD-74 and OD-80 (green once the lead has applied OD-220, OD-221, OD-240 and OD-241)", () => {
    const rows = records(tableUnder(readRepo(RISKS), "1. Every owner decision"));
    expect(rows.length).toBeGreaterThanOrEqual(239);
    // the check bites: a second heading for a headed number, a dropped marker and a wrong status are each reported
    const doubled = (path: string): string => (path === OWNER_DECISIONS ? `${readRepo(path)}${NEWLINE}## OD-209 — a second heading (B24-Z, 2026-10-10)${NEWLINE}` : readRepo(path));
    expect(ownerDecisionListProblems(doubled, rows).join(NEWLINE)).toContain("doubles 52, 54, 135, 150, 174, 209");
    expect(ownerDecisionListProblems(readRepo, rows.map((row) => (row.OD === "OD-74" ? { ...row, markers: "headed" } : row))).join(NEWLINE)).toContain("OD-74: markers");
    expect(ownerDecisionListProblems(readRepo, rows.map((row) => (row.OD === "OD-229" ? { ...row, status: "applied" } : row))).join(NEWLINE)).toContain("OD-229: status");
    // the list itself last (red until the lead appends OD-220, OD-221, OD-240 and OD-241, then green)
    expect(ownerDecisionListProblems(readRepo, rows)).toEqual([]);
  });

  it("5. the branch rows match the recorded listing: every local unmerged branch of the listing is a row, and every row a listed branch", () => {
    const section = sectionOf(readRepo(RISKS), "2.1 Unmerged branches");
    const listing = /```text\n([\s\S]*?)\n```/.exec(section)?.[1] ?? "";
    const local = listing.split(NEWLINE).map((line) => line.replace(/^[*+]?\s+|^[*+]\s*/, "").trim()).filter((name) => name !== "" && !name.startsWith("remotes/"));
    expect(local.length).toBeGreaterThan(0);
    const rows = records(tableUnder(readRepo(RISKS), "2.1 Unmerged branches"));
    expect(rows.map((row) => row.branch).sort()).toEqual([...local].sort());
    const remote = new Set(listing.split(NEWLINE).map((line) => line.trim()).filter((line) => line.startsWith("remotes/origin/")).map((line) => line.slice("remotes/origin/".length)));
    for (const row of rows) expect(row["on origin"]!.startsWith("yes"), row.branch).toBe(remote.has(row.branch!));
    expect(rows.find((row) => row.branch === "codex/reconstruct-b06-b16-history")?.["commits not in main"]).toBe("162");
  });

  it("6. the superseded-statement table (D5): every path:line resolves at this tree, every source exists and holds a list, every B24 record that holds one is a source, the map's stale pages are rows, and a row carries only its path, line, increment, source and note state", () => {
    const sources = records(tableUnder(readRepo(RISKS), "3.1 The sources"));
    const rows = tableUnder(readRepo(RISKS), "3.2 The table");
    expect(rows.header).toEqual(["path:line", "increment", "source", "note"]);
    const problems: string[] = [];
    const sourceSet = new Set(sources.map((row) => row.source));
    // [B24-F review, 2026-10-10] correctness-1: a row's increment is its source's; correctness-4: the discovery is cited at 58c0834's
    // numbering; security-1: a checksum-bound migration or a B11-scanned file is never to be noted in place, and a generated file never
    const incrementOfSource = new Map(sources.map((row) => [row.source, row.increment] as const));
    const DISCOVERY = `${B24}discovery.md`;
    const discovery = discoveryAtBase(readRepo(DISCOVERY));
    const generated = new Set(records(tableUnder(readRepo(`${B24}generator-inventory.md`), "2. Outputs")).map((row) => row.output));
    expect(generated.size).toBeGreaterThan(50);
    const discoveryRows: Array<readonly [string, number, number]> = [];
    for (const row of rows.rows) {
      if (row.length !== 4) { problems.push(`a row of ${row.length} cells`); continue; }
      const [cite, increment, source, note] = row as [string, string, string, string];
      const match = /^`([^`:]+):(\d+)(?:-(\d+))?`$/.exec(cite);
      if (match === null) { problems.push(`${cite}: not a path:line`); continue; }
      const [path, first, last] = [match[1]!, Number(match[2]), Number(match[3] ?? match[2])];
      const count = path === DISCOVERY ? discovery.length : lineCount(path);
      if (!exists(path) || last > count || first < 1) problems.push(`${cite}: does not resolve`);
      if (path === DISCOVERY) discoveryRows.push([cite, first, last]);
      if (!/^B24-(?:[A-F]\d?[a-z]?|Fa|Fb)$/.test(increment)) problems.push(`${cite}: increment ${increment}`);
      if (!sourceSet.has(source)) problems.push(`${cite}: source ${source} is not in 3.1`);
      else if (incrementOfSource.get(source) !== increment) problems.push(`${cite}: ${increment}'s row names ${incrementOfSource.get(source)}'s source ${source}`);
      if (!(NOTE_STATES as readonly string[]).includes(note) && !NOT_NOTED_WITH_REASON.test(note)) problems.push(`${cite}: note ${note}`); // [B24-closeout review, 2026-10-10] the task's `not noted (<reason>)` is a state too; case 10 admits it only where the row's own source calls the line still true or unchanged
      const frozen = FORWARD_MIGRATION.test(path) ? NOTE_STATES[4] : (B11_SCANNED_FILES as readonly string[]).includes(path) ? NOTE_STATES[5] : null;
      if (frozen !== null ? note !== frozen : note.startsWith("never noted")) problems.push(`${cite}: note ${note}${frozen === null ? "" : `, not ${frozen}`}`);
      if (generated.has(path)) problems.push(`${cite}: a generated file, noted only through its generator`);
    }
    // the discovery rows hold their text when the lead adds F's four closure lines (simulated: one dated line after each of D24-37..D24-40)
    const raw = readRepo(DISCOVERY).split(NEWLINE);
    const closures = ["D24-37", "D24-38", "D24-39", "D24-40"].map((id) => raw.findIndex((line) => line.startsWith(`**${id} - `) || line.startsWith(`**${id} ${String.fromCharCode(0x2014)} `)));
    expect(closures.every((index) => index > 0)).toBe(true);
    const inserted = raw.flatMap((line, index) => (closures.includes(index) ? [line, `- [B24-F, 2026-10-10] ${raw[index]!.slice(2, 8)}: closed (simulated)`] : [line]));
    expect(inserted.filter((line) => AFTER_BASE_LINE.test(line))).toHaveLength(raw.filter((line) => AFTER_BASE_LINE.test(line)).length + 4); // [B24-F lead, 2026-10-10] exactly four simulated on top of the post-base lines the tree already holds (F's applied clauses and section-10 line, then the closeout's): the lead's application of F's records counted them twice (9, not 4)
    const after = discoveryAtBase(inserted.join(NEWLINE));
    const textAt = (lines: readonly string[], first: number, last: number): string => lines.slice(first - 1, last).join(NEWLINE);
    for (const [cite, first, last] of discoveryRows) if (textAt(after, first, last) !== textAt(discovery, first, last)) problems.push(`${cite}: moves when the closure lines are added`);
    expect(discoveryRows.length).toBeGreaterThan(30);
    // the bite: counted raw, every discovery row past D24-37's heading would move by four
    expect(discoveryRows.filter(([, first, last]) => textAt(inserted, first, last) !== textAt(raw, first, last)).length).toBeGreaterThanOrEqual(10);
    expect(sectionOf(readRepo(RISKS), "3. Superseded statements")).toContain("cited at `58c0834`'s numbering");
    // every source exists and holds a superseded-statement list at its line
    for (const row of sources) {
      const match = /^`([^`:]+):(\d+)`$/.exec(row.source!);
      if (match === null) { problems.push(`${row.source}: not a path:line`); continue; }
      const text = readRepo(match[1]!).split(NEWLINE);
      const at = `${text[Number(match[2]) - 1] ?? ""} ${text[Number(match[2])] ?? ""}`;
      if (!/Superseded statements|Statements A\d supersedes|superseded-statement table takes it|Superseded hand-written pages/i.test(at)) problems.push(`${row.source}: holds no list`);
    }
    // every B24 record holding such a list is a source (B24-F's own pages and the lead's README and discovery aside)
    const own = new Set(["threat-model-closure-register.md", "open-risks-and-owner-decisions.md", "final-verdict.md", "executive-summary.md", "README.md", "discovery.md"]);
    const pages = readdirSync(join(ROOT, ...B24.split("/").filter(Boolean))).filter((name) => name.endsWith(".md") && !own.has(name)).map((name) => `${B24}${name}`);
    const holders = supersededListSources(readRepo, pages).filter((at) => !at.startsWith(`${B24}current-system-map.md`));
    for (const holder of holders) if (!sourceSet.has(`\`${holder}\``)) problems.push(`${holder}: a list that is no source`);
    expect(holders.length).toBeGreaterThanOrEqual(17);
    // the generated map's stale pages are rows (Fa)
    for (const stale of ["artifacts/ai-control-plane-b16-1c/current-prompt-to-gerber-map.md:18", "artifacts/ai-control-plane-b18/permission-tiers.md:30", "artifacts/ai-control-plane-b18/permission-tiers.md:37", "artifacts/ai-control-plane-b16-closeout/clean-and-upgrade-db-proof.md:14", "artifacts/ai-control-plane-b16-closeout/clean-and-upgrade-db-proof.md:16", "artifacts/ai-control-plane-b16-closeout/clean-and-upgrade-db-proof.md:17"]) {
      if (!rows.rows.some((row) => row[0] === `\`${stale}\`` && row[1] === "B24-Fa")) problems.push(`${stale}: not a row`);
    }
    expect(problems).toEqual([]);
    expect(rows.rows.length).toBeGreaterThan(150);
  });

  // [B24-closeout, 2026-10-10] Closeout commit 1/2 (lead decision D5; OD-221's closeout half), test-first: on 7ce1236 cases 7 and 8 are
  // red (96 rows `not noted`; the page has no section 4). Both read the page's section 4 drafts by their headings; nothing is written.
  it("7. [B24-closeout, 2026-10-10] no row is `not noted`; every `noted` row's cited lines carry its own increment's dated note or the closeout's note naming its increment and source (a row in the lead's files by the page's draft, which case 8 finds applied); every closeout note stands on the lines of a `noted` row it names, in a comment on a code line; every other discovery row is `noted nearby`, named once by a drafted discovery line placed after its block that moves no row at 58c0834's numbering; and the two suites that cite the discovery at a committed numbering skip that line", () => {
    const page = readRepo(RISKS);
    const problems: string[] = [];
    const rows = records(tableUnder(page, "3.2 The table")).map((row) => {
      const match = /^`([^`:]+):(\d+)(?:-(\d+))?`$/.exec(row["path:line"]!)!;
      return { cite: row["path:line"]!.slice(1, -1), path: match[1]!, first: Number(match[2]), last: Number(match[3] ?? match[2]), increment: row.increment!, source: row.source!.slice(1, -1), note: row.note! };
    });
    const base = discoveryAtBase(readRepo(CLOSEOUT_DISCOVERY));
    const linesOf = (path: string): string[] => (path === CLOSEOUT_DISCOVERY ? base : readRepo(path).split(NEWLINE));
    const ownNote = (increment: string): RegExp => new RegExp(`\\[(?:superseded \\d{4}-\\d\\d-\\d\\d by )?${increment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[ ,]`);
    const lead = records(tableUnder(page, "4.7 For the lead: the in-place notes")).map((row) => ({ at: /^`(.+):(\d+)`$/.exec(row["path:line"]!), note: row.note! }));
    // every drafted in-place note is in a lead file and names a noted row that holds its line
    for (const entry of lead) {
      if (entry.at === null || !CLOSEOUT_LEAD_FILES.includes(entry.at[1]!)) { problems.push(`a drafted note outside the lead's files: ${entry.note}`); continue; }
      if (!rows.some((row) => row.path === entry.at![1] && row.first <= Number(entry.at![2]) && Number(entry.at![2]) <= row.last && row.note === "noted" && closeoutNote(row.increment, row.source) === entry.note)) problems.push(`${entry.at[1]}:${entry.at[2]}: a drafted note no noted row names`);
    }
    for (const row of rows) {
      if (row.note === "not noted") problems.push(`${row.cite}: not noted`);
      if (row.note !== "noted") continue;
      const text = linesOf(row.path).slice(row.first - 1, row.last).join(NEWLINE);
      const closeout = text.split(closeoutNote(row.increment, row.source)).length - 1;
      const drafted = lead.filter((entry) => entry.at !== null && entry.at[1] === row.path && row.first <= Number(entry.at[2]) && Number(entry.at[2]) <= row.last && entry.note === closeoutNote(row.increment, row.source)).length;
      if (closeout > 1 || drafted > 1) problems.push(`${row.cite}: the closeout's note ${closeout} times, drafted ${drafted} times`);
      else if (closeout === 0 && drafted === 0 && !ownNote(row.increment).test(text)) problems.push(`${row.cite}: no dated note of ${row.increment}`);
    }
    // [B24-closeout review, 2026-10-10] correctness-5, security-3, correctness-3: every closeout note in the tree (a whole-tree walk; the
    // page and this suite aside, which spell it) stands on the lines of a noted row it names; on a code line, inside a comment the parser
    // reads as one and after a sentence or clause end (closeoutNoteProblems; case 10 plants each breakage); the walk reaches files no row names
    const files = closeoutTextFiles();
    for (const path of ["app/lib/auth/route-handlers.ts", "vitest.config.ts", LEDGER, OWNER_DECISIONS, CLOSEOUT_DISCOVERY]) if (!files.includes(path)) problems.push(`${path}: not walked`);
    if (files.includes(RISKS) || files.includes(CLOSEOUT_SELF) || files.length < 3000) problems.push(`the walk: ${files.length} files, the page or this suite among them`);
    for (const path of files) {
      const text = readRepo(path);
      if (text.includes(CLOSEOUT_NOTE)) problems.push(...closeoutNoteProblems(path, text, rows));
    }
    // the discovery rows the lead notes nearby: each named once by a drafted line placed after its block, one line per block, in order
    const drafts = records(tableUnder(page, "4.8 For the lead: the discovery lines")).map((row) => ({ after: Number(/^`discovery\.md:(\d+)`$/.exec(row.after!)?.[1]), line: row.line! }));
    const named = new Map<string, Array<{ after: number; increment: string; source: string }>>();
    for (const draft of drafts) {
      const body = CLOSEOUT_DISCOVERY_LINE.exec(draft.line)?.[1];
      if (body === undefined || !Number.isInteger(draft.after)) { problems.push(`a discovery line of no form: ${draft.line}`); continue; }
      for (const item of body.split("; ")) {
        const match = /^discovery\.md:(\d+(?:-\d+)?) by (B24-[A-Za-z0-9]+)'s record, (\S+:\d+)$/.exec(item);
        if (match === null) problems.push(`a discovery item of no form: ${item}`);
        else named.set(match[1]!, [...(named.get(match[1]!) ?? []), { after: draft.after, increment: match[2]!, source: match[3]! }]);
      }
    }
    expect(drafts.map((draft) => draft.after)).toEqual([...new Set(drafts.map((draft) => draft.after))].sort((a, b) => a - b));
    const nearby = rows.filter((row) => row.path === CLOSEOUT_DISCOVERY && row.note !== "noted");
    for (const row of nearby) {
      const entries = named.get(row.cite.slice(row.cite.lastIndexOf(":") + 1)) ?? [];
      if (row.note !== "noted nearby") problems.push(`${row.cite}: ${row.note}, not noted nearby`);
      if (entries.length !== 1) { problems.push(`${row.cite}: named by ${entries.length} drafted items`); continue; }
      const entry = entries[0]!;
      if (entry.increment !== row.increment || entry.source !== row.source) problems.push(`${row.cite}: drafted for ${entry.increment}, ${entry.source}`);
      if (entry.after !== blockEnd(base, row.last)) problems.push(`${row.cite}: drafted after ${entry.after}, its block ends at ${blockEnd(base, row.last)}`);
    }
    for (const key of named.keys()) if (!nearby.some((row) => row.cite.endsWith(`:${key}`))) problems.push(`discovery.md:${key}: drafted, no discovery row`);
    // inserted as the lead will, after the raw line that is each base line, the drafts move no line of 58c0834's numbering
    const raw = readRepo(CLOSEOUT_DISCOVERY).split(NEWLINE);
    const simulated = [...raw];
    for (const draft of [...drafts].sort((a, b) => b.after - a.after)) simulated.splice(rawIndexOfBase(raw, draft.after) + 1, 0, draft.line);
    expect(discoveryAtBase(simulated.join(NEWLINE))).toEqual(base);
    // the two suites that cite the discovery at a committed numbering skip such a line, and still count the lead's own dated lines
    for (const suite of ["app/lib/qualification/__tests__/b24-a1-environment-profile.test.ts", "app/lib/qualification/__tests__/b24-b3-scenario-map.test.ts"]) {
      const literal = /filter\(\(line\) => !\/(\^- \\\[B24.*?)\/\.test\(line\)\)/.exec(readRepo(suite))?.[1];
      const filter = literal === undefined ? null : new RegExp(literal);
      if (filter === null || !drafts.every((draft) => filter.test(draft.line)) || filter.test("- [B24 lead, 2026-10-06] Re-verification")) problems.push(`${suite}: its discovery filter counts the closeout's lines`);
    }
    expect(drafts.length).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });

  it("8. [B24-closeout, 2026-10-10] green once the lead has applied commit 1/2's drafts (as case 4 waited for B24-F's appends): each in-place note of the page's section 4.7 stands once in its lead file, on its line, and each discovery line of 4.8 stands once in the discovery, among the dated lines right after its base line", () => {
    const page = readRepo(RISKS);
    const problems: string[] = [];
    const notes = records(tableUnder(page, "4.7 For the lead: the in-place notes"));
    for (const row of notes) {
      const at = /^`(.+):(\d+)`$/.exec(row["path:line"]!);
      if (at === null) { problems.push(`${row["path:line"]}: no path:line`); continue; }
      const text = readRepo(at[1]!);
      // a file holds a note as many times as 4.7 drafts it there (two rows of one increment and source share its text)
      const drafted = notes.filter((other) => other["path:line"]!.startsWith(`\`${at[1]}:`) && other.note === row.note).length;
      if (text.split(row.note!).length - 1 !== drafted || !(text.split(NEWLINE)[Number(at[2]) - 1] ?? "").includes(row.note!)) problems.push(`${at[1]}:${at[2]}: not applied once on its line`);
    }
    const raw = readRepo(CLOSEOUT_DISCOVERY).split(NEWLINE);
    const drafts = records(tableUnder(page, "4.8 For the lead: the discovery lines"));
    for (const row of drafts) {
      const after = Number(/^`discovery\.md:(\d+)`$/.exec(row.after!)?.[1]);
      const run: string[] = [];
      for (let index = rawIndexOfBase(raw, after) + 1; index < raw.length && AFTER_BASE_LINE.test(raw[index]!); index += 1) run.push(raw[index]!);
      if (raw.filter((line) => line === row.line).length !== 1 || !run.includes(row.line!)) problems.push(`discovery.md:${after}: not applied once after its base line`);
    }
    expect(notes.length + drafts.length).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });

  // [B24-closeout review, 2026-10-10] The review round, test-first: on the round's base tree case 9 is red (the OD-221 amendment drafted
  // as a `###` heading block, section 2.3's hand-off unnoted, OD-5's two texts saying the 2026-09-24 run applied every migration) and
  // case 10 is red (five notes on lines their sources call still true or unchanged; two notes splitting a sentence). Nothing is written.
  it("9. [B24-closeout review, 2026-10-10] the lead's OD texts: the OD-221 amendment is one dated line under OD-221's heading (D13), and section 4.9's three OD texts, applied in memory as drafted, leave case 4's check green (correctness-1); section 2's hand-offs to the closeout carry its dated note (correctness-2); OD-5's two texts state the 2026-09-24 run as the migration proof's section 3 records it - 0031 not yet written, 0029 and 0030 INFERRED, the run RECORDED - and 0031's real-server apply BLOCKED-LIVE-QUALIFICATION (security-1)", () => {
    const page = readRepo(RISKS);
    const problems: string[] = [];
    const odRows = records(tableUnder(page, "1. Every owner decision"));
    // correctness-1: one dated line; with the OD-5 and OD-19 texts applied as the page says, case 4's check holds
    const applied = applyOwnerDecisionDrafts(readRepo(OWNER_DECISIONS), page);
    problems.push(...applied.problems);
    const simulated = (path: string): string => (path === OWNER_DECISIONS ? applied.text : readRepo(path));
    if (!applied.already) problems.push(...ownerDecisionListProblems(simulated, odRows).map((problem) => `applied as drafted: ${problem}`));
    // the D13 check bites on a `###` amendment heading, which the double and amendment-heading checks do not read
    const headed = (path: string): string => (path === OWNER_DECISIONS ? readRepo(path).replace(`${NEWLINE}## OD-241 `, `${NEWLINE}### OD-221 amendment${NEWLINE}${NEWLINE}## OD-241 `) : readRepo(path));
    expect(ownerDecisionListProblems(headed, odRows).join(NEWLINE)).toContain("OD-221: a heading of another level");
    // correctness-2: a section-2 bullet that hands a correction to the closeout carries the closeout's dated note naming section 4.3
    const handOffs = bulletsOf(sectionOf(page, "2. Open risks").split(NEWLINE), 0).filter((bullet) => bullet.text.includes("correction is the closeout's"));
    expect(handOffs.length).toBeGreaterThan(0);
    for (const bullet of handOffs) if (!/\[B24-closeout, 2026-10-10\][^[]*section 4\.3/.test(bullet.text)) problems.push(`section 2, a hand-off with no dated note naming section 4.3: ${bullet.text.slice(0, 60)}`);
    // security-1: OD-5's two texts against the proof's record of the run (its section 3, cited by its lines)
    const proof = readRepo(MIGRATION_PROOF).split(NEWLINE);
    const start = proof.findIndex((line) => line.startsWith("## 3. The 2026-09-24 run"));
    const next = proof.findIndex((line, index) => index > start && line.startsWith("## "));
    expect(start).toBeGreaterThan(0);
    let end = next - 1;
    while (end > start && proof[end]!.trim() === "") end -= 1;
    const recorded = proof.slice(start, end + 1).join(" ").replaceAll("`", "");
    for (const fact of ["0031 did not exist then", "is not recorded (INFERRED yes"]) expect(recorded, fact).toContain(fact);
    const od5Paragraph = paragraphAt(sectionOf(page, "4.3 OD-221's record corrections").split(NEWLINE), "**OD-5:");
    expect(od5Paragraph).not.toBe("");
    problems.push(...od5Problems("4.3's OD-5", od5Paragraph, `${start + 1}-${end + 1}`), ...od5Problems("4.9's OD-5 draft", (draftParts(page, "OD-5, in place:")?.draft ?? []).join(" "), `${start + 1}-${end + 1}`));
    expect(problems).toEqual([]);
  });

  it("10. [B24-closeout review, 2026-10-10] a closeout note says only what its record says: a row whose own source calls its line still true or unchanged reads `not noted (<that> per its source, <path:line>)` and carries no note - B24-A1's two auth headers and B24-C2's call record, orchestration store and trace store, derived (correctness-3, security-2) - and a reasoned row is only such a row; the note checks case 7 runs over the tree bite on planted texts - a note in a string after `https://`, in a template literal or in JSX text, a note splitting a sentence, a note in a file no row names, a SQL `--` note admitted (security-3, correctness-5, correctness-3)", () => {
    const rows = closeoutRows(readRepo(RISKS));
    const problems: string[] = [];
    const holding: string[] = [];
    for (const row of rows) {
      const reason = stillHoldsReason(row);
      if (reason === null) {
        if (NOT_NOTED_WITH_REASON.test(row.note)) problems.push(`${row.cite}: ${row.note}, but its source does not call the line still true or unchanged`);
        continue;
      }
      holding.push(row.cite);
      if (row.note !== `not noted (${reason})`) problems.push(`${row.cite}: ${row.note}, its source says ${reason}`);
    }
    // the rule's reading, reviewed: "true of B24-A3's increment, not of the tree" and "true of C1's tree, superseded by this increment"
    // (abuse-controls.md:31, observability-and-replay.md:296-304) stay superseded, so exactly these five hold
    expect(holding).toEqual(["app/lib/auth/expected-origin.ts:16-19", "app/lib/auth/trusted-request-context.ts:15-16", "app/lib/observability/llm-call-record.ts:2-20", "app/lib/agent/orchestration/store.ts:22", "app/lib/observability/run-trace-store.ts:23"]);
    // the note checks bite on planted texts (nothing is written): each problem without its place
    const source = "artifacts/ai-control-plane-b24/observability-and-replay.md:338";
    const note = closeoutNote("B24-C1", source);
    const planted = (path: string, text: string, named = true): string[] => closeoutNoteProblems(path, text, named ? [{ cite: `${path}:1-3`, path, first: 1, last: 3, increment: "B24-C1", source, note: "noted" }] : []).map((problem) => problem.slice(problem.indexOf(": ") + 2));
    expect(planted("app/x.ts", `const BASE = "https://api.example/v1 ${note}";`)).toEqual(["a code note outside a comment"]);
    expect(planted("app/x.ts", `// fine.${NEWLINE}const t = \`// ${note}\`;`)).toEqual(["a code note outside a comment"]);
    expect(planted("app/x.tsx", `export const A = () => <p>// ${note}</p>;`)).toEqual(["a code note outside a comment"]);
    expect(planted("app/x.ts", `/**${NEWLINE} * It never returns a ${note}${NEWLINE} * token. */`)).toEqual(["a code note inside a sentence"]);
    expect(planted("app/x.ts", `/**${NEWLINE} * It never returns a token. ${note}${NEWLINE} * The next sentence. */`)).toEqual([]);
    expect(planted("app/x.ts", `import { a } from "./a"; // the meter (unchanged) ${note}${NEWLINE}import { b } from "./b";`)).toEqual([]);
    expect(planted("app/x.sql", `SELECT 1; -- ${note}`)).toEqual([]);
    expect(planted("app/x.sql", `SELECT '-- ${note}';`)).toEqual(["a code note outside a comment"]);
    expect(planted("app/lib/auth/route-handlers.ts", `// fine. ${note}`, false)).toEqual(["a closeout note no noted row names"]);
    expect(planted("artifacts/x.md", `A line. ${note}`)).toEqual([]);
    expect(problems).toEqual([]);
  });
});

// ── [B24-closeout, 2026-10-10] cases 7 and 8 (declared after the describe block, so no line above moves) ────────────────────────────

const CLOSEOUT_DISCOVERY = "artifacts/ai-control-plane-b24/discovery.md";
/** The lead's files: the closeout drafts their notes on the page and the lead applies them (case 8). */
const CLOSEOUT_LEAD_FILES: readonly string[] = [OWNER_DECISIONS, LEDGER, LIVE_BLOCKERS, "artifacts/remaining-builder-program/PROGRAM_STATE.json", "artifacts/ai-control-plane-b24/README.md"];
/** The closeout's in-place note, as the task fixes it: ` [B24-closeout, 2026-10-10] superseded: <increment>'s record, <source path:line>.` */
const CLOSEOUT_NOTE = "[B24-closeout, 2026-10-10] superseded: ";
const closeoutNote = (increment: string, source: string): string => `${CLOSEOUT_NOTE}${increment}'s record, ${source}.`;
/** A drafted discovery line: one dated line per block, naming each row it notes by its line, its increment and its source. */
const CLOSEOUT_DISCOVERY_LINE = /^- \[B24-closeout, 2026-10-10\] superseded at 58c0834's numbering: (.+)\.$/;
/** The 0-based raw index of a discovery line given at 58c0834's numbering (the dated lines B24-F and the closeout add not counted). */
function rawIndexOfBase(raw: readonly string[], line: number): number {
  let seen = 0;
  for (let index = 0; index < raw.length; index += 1) if (!AFTER_BASE_LINE.test(raw[index]!) && ++seen === line) return index;
  return -1;
}
/** The base line a discovery statement's block ends on: a table row's whole table, else its paragraph or list item up to the next blank
 *  line, bullet, heading, table, fence, rule, defect heading or numbered item (the closeout's dated line goes right after it). */
function blockEnd(base: readonly string[], last: number): number {
  let end = last;
  if ((base[last - 1] ?? "").startsWith("|")) {
    while (end < base.length && base[end]!.startsWith("|")) end += 1;
    return end;
  }
  while (end < base.length && !/^(?:$|- |#|\||```|---|\*\*D2\d-\d+ |\d+\. )/.test(base[end]!)) end += 1;
  return end;
}

// ── [B24-closeout review, 2026-10-10] cases 7, 9 and 10: the review round (declared at the end, so no line above moves) ──────────────

const CLOSEOUT_SELF = "app/lib/qualification/__tests__/b24-f-registers.test.ts";
const MIGRATION_PROOF = "artifacts/ai-control-plane-b24/database-migration-proof.md";
/** A row of section 3.2 as cases 7 and 10 read it. */
interface CloseoutRow {
  readonly cite: string;
  readonly path: string;
  readonly first: number;
  readonly last: number;
  readonly increment: string;
  readonly source: string;
  readonly note: string;
}
function closeoutRows(page: string): CloseoutRow[] {
  return records(tableUnder(page, "3.2 The table")).map((row) => {
    const match = /^`([^`:]+):(\d+)(?:-(\d+))?`$/.exec(row["path:line"]!)!;
    return { cite: row["path:line"]!.slice(1, -1), path: match[1]!, first: Number(match[2]), last: Number(match[3] ?? match[2]), increment: row.increment!, source: row.source!.slice(1, -1), note: row.note! };
  });
}

/** The roots a closeout note could stand in (correctness-5): the source, page, test and workflow folders; `node_modules` and dot folders
 *  inside them aside. The repository root's own files join them, never a `.env` file. */
const CLOSEOUT_ROOTS = [".github", "app", "artifacts", "components", "docs", "drizzle", "e2e", "e2e-orchestration", "e2e-production-auth", "lib", "progress", "public", "schgen-endpoint", "scripts"];
const CLOSEOUT_TEXT = /\.(?:tsx?|jsx|[cm]?js|sql|md|json|csv|ya?ml|txt|html|xml|svg|py|ps1|toml)$/;
const CLOSEOUT_CODE = /\.(?:tsx?|jsx|[cm]?js|sql)$/;
/** Every text file of the walk, sorted; the page and this suite, which spell the note, excluded (about 4,200 files read in under a
 *  second here, so case 7 keeps the default budget: lead lesson 14's line is 1.5 s). */
function closeoutTextFiles(): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(ROOT, { withFileTypes: true })) if (entry.isFile() && !entry.name.startsWith(".") && CLOSEOUT_TEXT.test(entry.name)) out.push(entry.name);
  const walk = (dir: string): void => {
    for (const entry of readdirSync(join(ROOT, ...dir.split("/")), { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (CLOSEOUT_TEXT.test(entry.name)) out.push(path);
    }
  };
  for (const root of CLOSEOUT_ROOTS) if (exists(root)) walk(root);
  return out.filter((path) => path !== RISKS && path !== CLOSEOUT_SELF).sort();
}

/** The comment ranges of a code file as its parser reads them (security-3): a `//` in a string, a template literal, a regular
 *  expression or JSX text opens none. SQL has its own scan. */
function commentRanges(path: string, text: string): Array<readonly [number, number]> {
  if (path.endsWith(".sql")) return sqlCommentRanges(text);
  const kind = /\.[tj]sx$/.test(path) ? ts.ScriptKind.TSX : /\.[cm]?js$/.test(path) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind);
  const found = new Map<number, number>();
  const jsxText: Array<readonly [number, number]> = [];
  const visit = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.JsxText) { jsxText.push([node.pos, node.end]); return; }
    for (const range of [...(ts.getLeadingCommentRanges(text, node.pos) ?? []), ...(ts.getTrailingCommentRanges(text, node.end) ?? [])]) found.set(range.pos, range.end);
    for (const child of node.getChildren(file)) visit(child);
  };
  visit(file);
  return [...found].filter(([from]) => !jsxText.some(([start, end]) => start <= from && from < end));
}
/** SQL comment ranges: a double-dash comment to its line end and a slash-star block, outside a quoted string, a quoted identifier or
 *  a dollar quote. */
function sqlCommentRanges(text: string): Array<readonly [number, number]> {
  const out: Array<readonly [number, number]> = [];
  for (let at = 0; at < text.length;) {
    const pair = text.slice(at, at + 2);
    if (pair === "--" || pair === "/*") {
      const close = pair === "--" ? text.indexOf(NEWLINE, at) : text.indexOf("*/", at + 2);
      const end = close < 0 ? text.length : pair === "--" ? close : close + 2;
      out.push([at, end]);
      at = end;
    } else if (text[at] === "'" || text[at] === "\"") {
      const close = text.indexOf(text[at]!, at + 1);
      at = close < 0 ? text.length : close + 1;
    } else if (text[at] === "$" && /^\$[A-Za-z_]*\$/.test(text.slice(at, at + 64))) {
      const tag = /^\$[A-Za-z_]*\$/.exec(text.slice(at, at + 64))![0];
      const close = text.indexOf(tag, at + tag.length);
      at = close < 0 ? text.length : close + tag.length;
    } else at += 1;
  }
  return out;
}

/** Every closeout note of one file: it names a `noted` row of this file whose lines hold it (the row's increment and source); the
 *  discovery takes none (its rows take the lead's dated lines, 4.8); on a code line it stands inside a comment (security-3) and after a
 *  sentence or clause end - a full stop, a semicolon, a closing bracket or the comment's opener - or as its comment's end, so it splits
 *  no sentence (correctness-3). */
function closeoutNoteProblems(path: string, text: string, rows: readonly CloseoutRow[]): string[] {
  const problems: string[] = [];
  const lines = text.split(NEWLINE);
  const code = CLOSEOUT_CODE.test(path);
  const comments = code ? commentRanges(path, text) : [];
  let offset = 0;
  lines.forEach((line, index) => {
    for (let at = line.indexOf(CLOSEOUT_NOTE); at >= 0; at = line.indexOf(CLOSEOUT_NOTE, at + 1)) {
      const where = `${path}:${index + 1}`;
      if (path === CLOSEOUT_DISCOVERY) { problems.push(`${where}: a closeout note in the discovery`); continue; }
      const named = /^(B24-[A-Za-z0-9]+)'s record, (\S+:\d+)\./.exec(line.slice(at + CLOSEOUT_NOTE.length));
      if (named === null) { problems.push(`${where}: a closeout note of no form`); continue; }
      if (!rows.some((row) => row.path === path && row.first <= index + 1 && index + 1 <= row.last && row.note === "noted" && row.increment === named[1] && row.source === named[2])) problems.push(`${where}: a closeout note no noted row names`);
      if (!code) continue;
      const comment = comments.find(([from, to]) => from <= offset + at && offset + at + CLOSEOUT_NOTE.length <= to);
      if (comment === undefined) { problems.push(`${where}: a code note outside a comment`); continue; }
      const endsComment = comment[1] <= offset + line.length && !/^\s*(?:\/\/|--)/.test(lines[index + 1] ?? "");
      if (!endsComment && !/(?:[.;\]]|\/\/|\/\*|--|^\s*\*)\s*$/.test(line.slice(0, at))) problems.push(`${where}: a code note inside a sentence`);
    }
    offset += line.length + 1;
  });
  return problems;
}

/** Bullets of a list: each `- ` line with its indented continuation lines, and its 1-based line (`from` is the index of `lines[0]`). */
function bulletsOf(lines: readonly string[], from: number): Array<{ line: number; text: string }> {
  const out: Array<{ line: number; text: string }> = [];
  let current: { line: number; text: string } | null = null;
  lines.forEach((line, index) => {
    if (line.startsWith("- ")) out.push((current = { line: from + index + 1, text: line }));
    else if (current !== null && /^\s+\S/.test(line)) current.text += ` ${line.trim()}`;
    else current = null;
  });
  return out;
}
/** What a row's own source says of its line when it says the line still holds (correctness-3, security-2): `still true per its source,
 *  <path:line>` ("still true", or "true of" its subject with no "not of" and no "superseded" before the first semicolon) or `unchanged
 *  per its source, <path:line>`; else null. The verdict is the text after the first " - " that follows the row's citation in the bullet
 *  of the source's list naming the row's file (its path, or its bare file name). */
function stillHoldsReason(row: CloseoutRow): string | null {
  const sourcePath = row.source.slice(0, row.source.lastIndexOf(":"));
  const sourceLine = Number(row.source.slice(row.source.lastIndexOf(":") + 1));
  const lines = readRepo(sourcePath).split(NEWLINE);
  const stop = lines.findIndex((line, index) => index >= sourceLine && /^#{1,6} /.test(line));
  const bullets = bulletsOf(lines.slice(sourceLine, stop < 0 ? undefined : stop), sourceLine);
  const name = row.path.slice(row.path.lastIndexOf("/") + 1);
  const bare = new RegExp(`(?:^|[^\\w./-])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:`);
  const bullet = bullets.find((entry) => entry.text.includes(row.path)) ?? bullets.find((entry) => bare.test(entry.text));
  if (bullet === undefined) return null;
  const at = bullet.text.includes(row.path) ? bullet.text.indexOf(row.path) : bullet.text.search(bare);
  const dash = bullet.text.indexOf(" - ", at);
  if (dash < 0) return null;
  const verdict = bullet.text.slice(dash + 3);
  const word = /^(?:still true|true of)\b/.test(verdict) && !/\bnot of\b|\bsuperseded\b/.test(verdict.split(";")[0]!) ? "still true" : /^unchanged\b/.test(verdict) ? "unchanged" : null;
  return word === null ? null : `${word} per its source, ${sourcePath}:${bullet.line}`;
}

/** A paragraph of a section: from the line that starts with `prefix` to the next blank line, joined. */
function paragraphAt(lines: readonly string[], prefix: string): string {
  const start = lines.findIndex((line) => line.startsWith(prefix));
  if (start < 0) return "";
  const end = lines.findIndex((line, index) => index > start && line.trim() === "");
  return lines.slice(start, end < 0 ? undefined : end).join(" ");
}
/** A draft of section 4.9: the paragraph that starts with `label`, and the lines of the fenced text block after it. */
function draftParts(page: string, label: string): { paragraph: string; draft: string[] } | null {
  const lines = page.split(NEWLINE);
  const section = lines.findIndex((line) => line.startsWith("### 4.9 For the lead"));
  const at = lines.findIndex((line, index) => section >= 0 && index > section && line.startsWith(label));
  const open = lines.findIndex((line, index) => at >= 0 && index > at && line === "```text");
  const close = lines.findIndex((line, index) => open >= 0 && index > open && line === "```");
  return close < 0 ? null : { paragraph: lines.slice(at, open).join(" "), draft: lines.slice(open + 1, close) };
}
/** Section 4.9's three OD texts applied to the register's text as the page says (correctness-1; nothing is written): OD-5's Status cell
 *  replaced and OD-19's note appended on the lines the paragraphs name, and the OD-221 amendment - one dated line, no heading (D13) -
 *  inserted right after the line its paragraph names, which must be OD-221's last line. When the register already holds the dated line,
 *  the lead has applied the drafts: it must stand once inside OD-221's entry, and case 4 reads the register itself. */
function applyOwnerDecisionDrafts(register: string, page: string): { text: string; problems: string[]; already: boolean } {
  const lines = register.split(NEWLINE);
  const [od5, od19, od221] = [draftParts(page, "OD-5, in place:"), draftParts(page, "OD-19, in place:"), draftParts(page, "OD-221 amendment:")];
  if (od5 === null || od19 === null || od221 === null) return { text: register, problems: ["section 4.9 lacks the OD-5, OD-19 or OD-221 text"], already: false };
  const problems: string[] = [];
  if (od221.draft.length !== 1 || !/^- \[B24-closeout, 2026-10-10\] /.test(od221.draft[0]!)) problems.push(`the OD-221 amendment is ${od221.draft.length} lines, not one dated line (D13): ${od221.draft.map((line) => line.slice(0, 22)).join(" / ")}`);
  const heading = lines.findIndex((line) => line.startsWith("## OD-221 "));
  const next = lines.findIndex((line, index) => index > heading && line.startsWith("## "));
  let last = next - 1;
  while (last > heading && lines[last]!.trim() === "") last -= 1;
  const dated = od221.draft.filter((line) => line.startsWith("- [B24-closeout"));
  if (dated.length > 0 && dated.every((line) => lines.includes(line))) {
    for (const line of dated) if (lines.filter((other) => other === line).length !== 1 || !(heading < lines.indexOf(line) && lines.indexOf(line) < next)) problems.push("the OD-221 amendment does not stand once in OD-221's entry");
    return { text: register, problems, already: true };
  }
  const named = (parts: { paragraph: string }): number => Number(/`OWNER_DECISIONS\.md:(\d+)`/.exec(parts.paragraph)?.[1]);
  const [at5, at19, at221] = [named(od5) - 1, named(od19) - 1, named(od221)];
  if (!(lines[at5] ?? "").startsWith("| OD-5 |") || od5.draft.length !== 1 || od5.draft[0]!.includes("|")) problems.push("OD-5's text: not one line for OD-5's Status cell");
  else lines[at5] = lines[at5]!.replace(/\| [^|]*\|$/, `| ${od5.draft[0]} |`);
  const od19Heading = lines.findIndex((line) => line.startsWith("## OD-19 "));
  if (!(lines[at19] ?? "").startsWith("- Question") || at19 < od19Heading || lines.slice(od19Heading + 1, at19).some((line) => line.startsWith("## ")) || od19.draft.length !== 1) problems.push("OD-19's text: not one line for OD-19's Question bullet");
  else lines[at19] = `${lines[at19]} ${od19.draft[0]}`;
  if (at221 !== last + 1) problems.push(`the OD-221 amendment goes after :${at221}, OD-221's last line is :${last + 1}`);
  else lines.splice(at221, 0, ...od221.draft);
  return { text: lines.join(NEWLINE), problems, already: false };
}
/** What an OD-5 closing text gets wrong against the migration proof's record of the 2026-09-24 run (security-1): it cites that record
 *  by its lines, says 0031 did not exist then, marks 0029 and 0030 INFERRED and the run RECORDED, keeps 0031 on PGlite with its
 *  real-server apply BLOCKED-LIVE-QUALIFICATION (LB-14), and never says the run applied them all or B16-B's commit registered 0029-0031. */
function od5Problems(label: string, text: string, range: string): string[] {
  const plain = text.replaceAll("`", "");
  const problems: string[] = [];
  if (!plain.includes(`database-migration-proof.md:${range}`)) problems.push(`${label}: cites no database-migration-proof.md:${range}`);
  for (const fact of ["0031 did not exist then", "0029 and 0030", "INFERRED", "RECORDED", "PGlite", "BLOCKED-LIVE-QUALIFICATION (LB-14)"]) if (!plain.includes(fact)) problems.push(`${label}: no "${fact}"`);
  for (const claim of [/\bapplied them\b/, /\b(?:all|the) 32\b[^.;]*2026-09-24/, /2026-09-24[^.;]*\b(?:all|the) 32\b/, /\bregisters 0027-0031\b/]) if (claim.test(plain)) problems.push(`${label}: claims ${claim.source}`);
  return problems;
}
