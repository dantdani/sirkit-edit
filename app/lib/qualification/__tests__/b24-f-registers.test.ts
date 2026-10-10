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
import { registerRows } from "./_b24-e-register";
import { readRepo, records, sectionOf, tableUnder } from "./_b24-f-pages";
import { B11_SCANNED_FILES } from "@/app/lib/agent/orchestration/tripwires";
import { AFTER_BASE_LINE, commitBinder, defectIds, discoveryAtBase, FORWARD_MIGRATION, NOTE_STATES, OWNER_DECISIONS, ownerDecisionListProblems, supersededListSources } from "./_b24-f-registers";

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
      if (!(NOTE_STATES as readonly string[]).includes(note)) problems.push(`${cite}: note ${note}`);
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
});
