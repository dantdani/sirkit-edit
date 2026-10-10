/**
 * [B24-F] The verdict lines (D24-40's B24-F half; section 5's `:1157` / `:1266` pin; lead decisions D3, D4, D5): `final-verdict.md`
 * and B24-F's ten other written pages, held to E's qualification matrix, the register and the code.
 *
 *  1. ten scope lines, in runbook `:1146-1155`'s order and words, each with one state of the closed set;
 *  2. scopes 3-10 each equal the state computed from every E matrix row whose Readiness scope cell names the scope (D4): NOT READY when
 *     a row's recorded live runs hold E's failing marker, READY when every row passes, IN PART when some pass, else
 *     BLOCKED-LIVE-QUALIFICATION with every row's LB; scopes 1-2 are PENDING-FINAL-RUN; a scope with no row, or no failing marker
 *     defined by E, is a STOP;
 *  3. every LB the verdict names is a BLOCKED-LIVE-QUALIFICATION register row, mirrored in `PROGRAM_STATE.json`;
 *  4. "Application complete" stands only beside a READY scope, and no page claims physical completion while scope 10 is not READY;
 *  5. the sandbox, manufacturing-file, MCP and quote/order lines carry their facts (the release id and expiry computed from code), and
 *     the CI-readiness line carries D3's `baseline_missing` rule;
 *  6. the count lines of `final-verdict.md` and `executive-summary.md` equal the generated `current-system-map.md`;
 *  7. PENDING-FINAL-RUN appears only on scopes 1-2;
 *  8. every backticked `path:line` on the pages resolves - a bare file name against the page's directory or the lead's records, a
 *     `:N` continuation against the last path of its paragraph or table row, never skipped - every cited suite or script exists, and a
 *     citation of the B15 or B16.0.7 verdict says "pre-program" ([B24-F review, 2026-10-10] correctness-11; case 4's physical check
 *     needs the negation on the completion word itself);
 *  9. `b24-e-statements` scans every B24-F page (deliverable 7);
 * 10. each report carries its required tokens, derived from code and pins, never typed;
 * 11. the status-line -> row table (D5): ten rows in runbook `:1241-1250`'s order, each naming exactly its E rows.
 *
 * Failing first on 58c0834: the pages do not exist (D24-40's counterexample: no single list covers OD-1..OD-222). Files are read as
 * text; nothing is written and no process starts.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NON_LIVE_GATES } from "@/app/lib/evaluation/live-suites";
import { renderClassScoreLines } from "@/app/lib/evaluation/golden-catalog";
import { JLCPCB_2L_RULE_PROFILE_EVIDENCE, ruleProfileExpiry } from "@/app/lib/pcb/fab/rule-profile";
import { LATENCY_STATES } from "@/app/lib/qualification/latency-policy";
import { CI_EVIDENCE_JOBS, READINESS_SCOPES, STATUS_LINE_ROWS, classificationOf, matrixRows, registerRows, type MatrixRow } from "./_b24-e-register";
import { markdownTables, readRepo, records, sectionOf, tableUnder } from "./_b24-f-pages";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const B24 = "artifacts/ai-control-plane-b24/";
const VERDICT = `${B24}final-verdict.md`;
const SUMMARY = `${B24}executive-summary.md`;
const MATRIX = `${B24}qualification-matrix.md`;
const MAP = `${B24}current-system-map.md`;
/** B24-Fb's eleven written pages. */
const PAGES = ["threat-model-closure-register.md", "open-risks-and-owner-decisions.md", "database-migration-proof.md", "provider-security-report.md", "mcp-security-report.md", "sandbox-security-report.md", "eval-catalog-and-results.md", "performance-reliability-report.md", "executive-summary.md", "changed-files.md", "final-verdict.md"].map((name) => `${B24}${name}`);
const STATE = /^(?:READY|READY \(scoped: .+\)|IN PART \(.+\)|NOT READY \(.+\)|BLOCKED-LIVE-QUALIFICATION \(LB-\d+(?:, LB-\d+)*(?:; .+)?\)|PENDING-FINAL-RUN(?: \(.+\))?)$/;
const scopeRows = () => records(tableUnder(readRepo(VERDICT), "1. The ten readiness scopes"));
const matrix = (): MatrixRow[] => matrixRows(readRepo(MATRIX)).rows;
/** A row passes by E's column rule: QUALIFIED, or NOT APPLICABLE with CI evidence named in Built offline. */
const passes = (row: MatrixRow): boolean => classificationOf(row.state)?.form === "QUALIFIED" || (row.state === "NOT APPLICABLE" && CI_EVIDENCE_JOBS.some((job) => row.builtOffline.includes(job)));
/** E's failing marker for Recorded live runs (its column rules: "a failing result is marked `failing`"). */
const FAILING = "`failing`";
/** A scope's state kind and its rows' LBs, computed from the matrix by D4's rule. */
function computed(scope: string, rows: readonly MatrixRow[]): { kind: string; ids: string[]; lbs: string[]; failing: string[] } {
  const matched = rows.filter((row) => row.scope === scope);
  const failing = matched.filter((row) => row.recorded.includes(FAILING)).map((row) => row.row);
  const kind = matched.length === 0 ? "STOP: no matrix row" : failing.length > 0 ? "NOT READY" : matched.every(passes) ? "READY" : matched.some(passes) ? "IN PART" : "BLOCKED-LIVE-QUALIFICATION";
  return { kind, ids: matched.map((row) => row.row), lbs: [...new Set(matched.flatMap((row) => row.lb))], failing };
}
const exists = (path: string): boolean => existsSync(join(ROOT, ...path.split("/")));
/** [B24-F review, 2026-10-10] correctness-11: a backticked citation - a repository path, or a bare file name - with its line, or a bare
 *  `:N` that continues the last path (or is the runbook's line). */
const CITATION = /`((?:(?:app|artifacts|scripts|docs|e2e|e2e-orchestration|e2e-production-auth|lib|components|drizzle|\.github)\/[^`\s:]+)|[A-Za-z0-9_.-]+\.(?:json|ts|tsx|yml|md|mjs|sql|csv))?:(\d+)(?:-(\d+))?`/g;
/** [B24-F review, 2026-10-10] correctness-11: a line naming physical work with a completion word that no negation governs (a negation
 *  among the three words before the word itself: "is not complete", "has never passed"); a negation elsewhere on the line excuses
 *  nothing. */
function physicalCompletionClaim(line: string): boolean {
  if (!/\bphysical/i.test(line)) return false;
  for (const match of line.matchAll(/\b(?:achieved|completed|passed|complete)\b/gi)) {
    const before = line.slice(0, match.index).split(/\s+/).filter(Boolean).slice(-3).map((word) => word.replace(/[^A-Za-z']/g, ""));
    if (!before.some((word) => /^(?:not|never|no|nor|without|cannot|isn't|wasn't|aren't|weren't|hasn't|haven't)$/i.test(word))) return true;
  }
  return false;
}
function testNames(): Set<string> {
  const out = new Set<string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(join(ROOT, ...dir.split("/")), { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      if (entry.isDirectory()) walk(`${dir}/${entry.name}`);
      else if (/\.test\.tsx?$/.test(entry.name)) out.add(entry.name.replace(/\.test\.tsx?$/, ""));
    }
  };
  walk("app");
  return out;
}

describe("[B24-F] the verdict lines are the matrix's and the code's (runbook :1144-1157, :1266; D24-40; lead decisions D3, D4, D5)", () => {
  it("1. ten scope lines, in runbook :1146-1155's order and words, each with one state of the closed set", () => {
    const rows = scopeRows();
    expect(rows.map((row) => row.scope)).toEqual([...READINESS_SCOPES]);
    expect(rows.map((row) => row["#"])).toEqual(READINESS_SCOPES.map((_, index) => String(index + 1)));
    for (const row of rows) expect(row.state, row.scope).toMatch(STATE);
    expect(readRepo(VERDICT)).toMatch(/^\*\*Verdict \(as of B24-F\): (?:PARTIAL|COMPLETE|BLOCKED)\.\*\*/m);
    // the headline is PARTIAL unless every scope is READY
    const allReady = rows.every((row) => /^READY\b/.test(row.state!));
    expect(/^\*\*Verdict \(as of B24-F\): PARTIAL\.\*\*/m.test(readRepo(VERDICT))).toBe(!allReady);
  });

  it("2. scopes 3-10 each equal the state computed from E's matrix rows whose Readiness scope names them (D4); scopes 1-2 are PENDING-FINAL-RUN; every scope has a row and E defines its failing marker", () => {
    expect(sectionOf(readRepo(MATRIX), "2.1 Column rules")).toContain("a failing result is marked `failing`");
    const rows = matrix();
    expect(rows.length).toBe(15);
    const problems: string[] = [];
    scopeRows().forEach((row, index) => {
      if (index < 2) {
        if (!row.state!.startsWith("PENDING-FINAL-RUN")) problems.push(`${row.scope}: ${row.state}`);
        if (row["E rows"] !== "-") problems.push(`${row.scope}: rows ${row["E rows"]}`);
        return;
      }
      const want = computed(row.scope!, rows);
      if (want.kind.startsWith("STOP")) { problems.push(`${row.scope}: ${want.kind}`); return; }
      if (!row.state!.startsWith(want.kind === "READY" ? "READY" : `${want.kind} (`)) problems.push(`${row.scope}: ${row.state} is not ${want.kind}`);
      if (want.kind !== "READY") for (const lb of want.lbs) if (!row.state!.includes(lb)) problems.push(`${row.scope}: ${lb} unnamed`);
      for (const id of want.failing) if (!row.state!.includes(id) && !row.state!.includes("class 4 NOT CONTAINED")) problems.push(`${row.scope}: the failing row ${id} unnamed`);
      if (row["E rows"] !== want.ids.join(", ")) problems.push(`${row.scope}: rows ${row["E rows"]}, matched ${want.ids.join(", ")}`);
    });
    expect(problems).toEqual([]);
    // the rule bites: a passing Q12 makes MCP READY, a Q4 without its failing mark is BLOCKED, a scope with no row is a STOP
    const edit = (id: string, patch: Partial<MatrixRow>): MatrixRow[] => rows.map((row) => (row.row === id ? { ...row, ...patch } : row));
    expect(computed("MCP readiness", edit("Q12", { state: "NOT APPLICABLE", builtOffline: "prompt-to-gerber", lb: [] })).kind).toBe("READY");
    expect(computed("sandbox readiness", edit("Q4", { recorded: "none" })).kind).toBe("BLOCKED-LIVE-QUALIFICATION");
    expect(computed("staging authentication readiness", edit("Q2", { scope: "—" })).kind).toMatch(/^STOP/);
  });

  it("3. every LB the verdict names is a BLOCKED-LIVE-QUALIFICATION row of the register, mirrored in PROGRAM_STATE.json", () => {
    const register = new Map(registerRows(readRepo("artifacts/remaining-builder-program/LIVE_BLOCKERS.md")).map((row) => [row.id, row] as const));
    const mirror = (JSON.parse(readRepo("artifacts/remaining-builder-program/PROGRAM_STATE.json")) as { liveBlockers: string[] }).liveBlockers;
    const named = [...new Set(readRepo(VERDICT).match(/\bLB-\d+\b/g) ?? [])];
    expect(named.length).toBeGreaterThan(10);
    const problems: string[] = [];
    for (const id of named) {
      const row = register.get(id);
      if (row === undefined) { problems.push(`${id}: no register row`); continue; }
      if (classificationOf(row.cells[2] ?? "")?.form !== "BLOCKED-LIVE-QUALIFICATION") problems.push(`${id}: not BLOCKED-LIVE-QUALIFICATION`);
      if (!mirror.some((entry) => entry.startsWith(`${id}: BLOCKED-LIVE-QUALIFICATION`))) problems.push(`${id}: not mirrored`);
    }
    expect(problems).toEqual([]);
  });

  it("4. \"Application complete\" stands only beside a READY scope, and no page claims physical completion while physical hardware validation is not READY (runbook :1157)", () => {
    const ready = new Set(scopeRows().filter((row) => /^READY\b/.test(row.state!)).map((row) => row.scope));
    const physicalReady = ready.has("physical hardware validation");
    const problems: string[] = [];
    for (const page of PAGES) {
      readRepo(page).split(NEWLINE).forEach((line, index) => {
        if (/application complete/i.test(line)) {
          const scope = READINESS_SCOPES.find((name) => line.includes(`| ${name} |`));
          if (page !== VERDICT || scope === undefined || !ready.has(scope)) problems.push(`${page}:${index + 1}: application complete beside no READY scope`);
        }
        if (!physicalReady && physicalCompletionClaim(line)) problems.push(`${page}:${index + 1}: a physical completion claim`);
      });
    }
    expect(problems).toEqual([]);
    expect(physicalReady).toBe(false);
    // [B24-F review, 2026-10-10] correctness-11: the negation must govern the completion word itself; a "no" elsewhere on the line
    // excuses nothing
    expect(physicalCompletionClaim("Physical hardware validation passed on all boards; no regressions")).toBe(true);
    expect(physicalCompletionClaim("Physical hardware validation completed (BLOCKED elsewhere)")).toBe(true);
    expect(physicalCompletionClaim("physical hardware validation is not complete")).toBe(false);
    expect(physicalCompletionClaim("physical hardware validation has never passed")).toBe(false);
  });

  it("5. the sandbox, manufacturing-file, MCP and quote/order lines carry their facts - the release id and expiry computed from code - and the CI-readiness line carries D3's baseline_missing rule", () => {
    const state = (scope: string): string => scopeRows().find((row) => row.scope === scope)?.state ?? "";
    for (const fact of ["class 4 NOT CONTAINED", "LB-10, LB-3, LB-8", "diagnostic-only"]) expect(state("sandbox readiness"), fact).toContain(fact);
    const identities = JSON.parse(readRepo("app/lib/workflow/prompt-to-gerber/__tests__/fixtures/expected-identities.json")) as { release: { releaseId: string } };
    const expiry = ruleProfileExpiry(JLCPCB_2L_RULE_PROFILE_EVIDENCE.retrievedAt);
    expect(expiry).toBe(JLCPCB_2L_RULE_PROFILE_EVIDENCE.expiresAt);
    for (const fact of ["jlcpcb-2l", identities.release.releaseId, `valid through ${expiry}`, "OD-219"]) expect(state("manufacturing-file readiness"), fact).toContain(fact);
    for (const fact of ["Q14 passes", "nine-read", "Q12", "LB-16"]) expect(state("MCP readiness"), fact).toContain(fact);
    for (const fact of ["LB-11, LB-12", "ordering visibly disabled"]) expect(state("external quote/order readiness"), fact).toContain(fact);
    for (const fact of ["`baseline_missing`", "non-blocking BLOCKED", "declared-without-values v1", "never counted as pass", "`unmeasured`", "`sample_shortfall`", "regressions", "block"]) expect(state("CI readiness"), fact).toContain(fact);
    // D3 holds at this tree: the latest committed baseline is the declared-without-values v1
    const baseline = JSON.parse(readRepo(`${B24}latency-baseline.json`)) as { versions: Array<{ version: number; declaredWithoutValues?: boolean }> };
    expect(baseline.versions.at(-1)).toMatchObject({ version: 1, declaredWithoutValues: true });
  });

  it("6. the count lines of final-verdict.md and executive-summary.md equal the generated current-system map", () => {
    const map = new Map(records(tableUnder(readRepo(MAP), "1. Counts")).map((row) => [row.count, row.derived] as const));
    const problems: string[] = [];
    for (const [page, heading] of [[VERDICT, "3. Report lines"], [SUMMARY, "3. Counts"]] as const) {
      const rows = records(tableUnder(readRepo(page), heading));
      expect(rows.length, page).toBeGreaterThan(8);
      for (const row of rows) if (map.get(row.count) !== row.value) problems.push(`${page}: ${row.count} ${row.value}, the map ${map.get(row.count)}`);
    }
    expect(problems).toEqual([]);
  });

  it("7. PENDING-FINAL-RUN appears only on scopes 1-2", () => {
    const found: string[] = [];
    for (const page of PAGES) readRepo(page).split(NEWLINE).forEach((line, index) => { if (line.includes("PENDING-FINAL-RUN")) found.push(`${page}:${/^\| (\d+) \|/.exec(line)?.[1] ?? `line ${index + 1}`}`); });
    expect(found).toEqual([`${VERDICT}:1`, `${VERDICT}:2`]);
  });

  it("8. every backticked path:line on B24-F's pages resolves (file exists, line in range) - a bare file name against the page's directory or the lead's records, a `:N` continuation against the last path of its paragraph or table row, a runbook line as the runbook's - every cited suite or script exists, and a citation of the B15 or B16.0.7 verdict says pre-program", () => {
    const tests = testNames();
    const problems: string[] = [];
    let cited = 0;
    for (const page of PAGES) {
      const lines = readRepo(page).split(NEWLINE);
      let carried: string | null = null;
      lines.forEach((line, index) => {
        // [B24-F review, 2026-10-10] correctness-11: bare file names and `:N` continuations are resolved too, never skipped
        if (line.trim() === "" || line.startsWith("#") || line.startsWith("|")) carried = null;
        for (const match of line.matchAll(CITATION)) {
          const [, named, first, last] = match;
          let path: string | null = named ?? null;
          if (path === null) {
            if (/runbook(?:\s*`:\d+(?:-\d+)?`,?)*\s*$/.test(line.slice(0, match.index))) continue;
            path = carried;
            if (path === null) { problems.push(`${page}:${index + 1}: :${first} continues no path`); continue; }
          } else if (!path.includes("/")) {
            path = [page.slice(0, page.lastIndexOf("/") + 1), "artifacts/remaining-builder-program/"].map((dir) => `${dir}${named}`).find(exists) ?? null;
            if (path === null) { problems.push(`${page}:${index + 1}: ${named} is in neither the page's directory nor the lead's records`); continue; }
          }
          cited += 1;
          carried = path;
          if (!exists(path)) { problems.push(`${page}:${index + 1}: ${path} does not exist`); continue; }
          const count = readRepo(path).split(NEWLINE).length;
          if (Number(last ?? first) > count || Number(first) < 1) problems.push(`${page}:${index + 1}: ${path}:${first} is out of range (${count})`);
        }
        if (line.startsWith("|")) carried = null;
        for (const match of line.matchAll(/`(b\d\d-[a-z0-9-]+)`/g)) {
          if (!tests.has(match[1]!) && !exists(`scripts/${match[1]}.ts`)) problems.push(`${page}:${index + 1}: ${match[1]} is no suite or script`);
        }
        if (/ai-control-plane-b(?:15|16-0-7)\/final-verdict\.md/.test(line) && !line.includes("pre-program")) problems.push(`${page}:${index + 1}: a pre-program verdict cited without saying so`);
      });
    }
    expect(problems).toEqual([]);
    expect(cited).toBeGreaterThan(300);
  });

  it("9. b24-e-statements scans every B24-F page: its page set is every artifacts Markdown page but the lead's records, B24's README and discovery and the matrix (deliverable 7)", () => {
    const tripwire = readRepo("app/lib/qualification/__tests__/b24-e-statements.test.ts");
    expect(tripwire).toContain(`const pages = (): string[] => [...everyFile("artifacts", (name) => name.endsWith(".md")).filter((path) => !EXCLUDED(path))`);
    expect(tripwire).toContain(`const EXCLUDED = (path: string): boolean => path.startsWith("artifacts/remaining-builder-program/") || ["artifacts/ai-control-plane-b24/README.md", "artifacts/ai-control-plane-b24/discovery.md", MATRIX].includes(path);`);
    const excluded = (path: string): boolean => path.startsWith("artifacts/remaining-builder-program/") || [`${B24}README.md`, `${B24}discovery.md`, MATRIX].includes(path);
    for (const page of [...PAGES, `${B24}trust-boundary-map.md`, MAP, `${B24}agent-graph.md`, `${B24}generator-inventory.md`]) {
      expect(excluded(page), page).toBe(false);
      expect(exists(page), page).toBe(true);
    }
  });

  it("10. each report carries its required tokens, derived from code and pins: the migration count, the MCP and sandbox records, one score line per class with no cross-class sum and each non-live gate apart, the latency gate's states, the SDK importers", () => {
    const page = (name: string): string => readRepo(`${B24}${name}`);
    const migrations = Number(/\.toHaveLength\((\d+)\)/.exec(readRepo("app/lib/db/__tests__/b16-b-migrations.test.ts").split(NEWLINE)[38] ?? "")?.[1]);
    expect(migrations).toBe(32);
    for (const token of [`${migrations} SQL migrations`, "non-isolated", "OD-191", "LB-14"]) expect(page("database-migration-proof.md"), token).toContain(token);
    for (const token of ["OD-51", "D2.5", "OD-82", "OD-87", "LB-16"]) expect(page("mcp-security-report.md"), token).toContain(token);
    for (const token of ["LB-10", "OD-134", "class 4 NOT CONTAINED"]) expect(page("sandbox-security-report.md"), token).toContain(token);
    const evaluation = page("eval-catalog-and-results.md");
    const lines = renderClassScoreLines();
    expect(lines).toHaveLength(6);
    for (const line of lines) expect(evaluation.split(NEWLINE), line).toContain(line);
    expect(evaluation).not.toMatch(/\btotal\b/i);
    const gates = records(tableUnder(evaluation, "4. Non-live gates"));
    expect(gates.map((row) => row.gate)).toEqual(NON_LIVE_GATES.map((entry) => entry.id));
    for (const entry of NON_LIVE_GATES) {
      const row = gates.find((candidate) => candidate.gate === entry.id)!;
      expect(row.flag, entry.id).toBe(`\`${entry.flag.name}\``);
      expect(row["CI job"], entry.id).toContain(`\`${entry.job.id}\``);
      expect(Object.values(row).join(" "), entry.id).not.toMatch(/\bLB-\d+/);
      expect(row["in CI"], entry.id).toBe(entry.recorded.state === "exercised" ? "exercised" : "not exercised");
    }
    const performance = page("performance-reliability-report.md");
    for (const state of LATENCY_STATES) expect(performance, state).toContain(`\`${state}\``);
    expect(performance).toMatch(/\*\*BLOCKED\*\* \(`baseline_missing`; never a pass\)/);
    expect(performance).toContain("declared without values");
    expect(performance).not.toMatch(/`baseline_missing`[^.|\n]*\b(?<!never )(?:is|counts as|counted as) (?:a )?pass\b/);
    const importers = [.../expect\(importers\)\.toEqual\(\[([^\]]*)\]\)/.exec(readRepo("app/lib/agent/orchestration/__tests__/b21-a-import-gates.test.ts").split(NEWLINE)[90] ?? "")![1]!.matchAll(/"([^"]+)"/g)].map((match) => match[1]!);
    for (const importer of importers) expect(page("provider-security-report.md"), importer).toContain(importer);
  });

  it("11. the status-line -> row table (D5): ten rows in runbook :1241-1250's order, each naming exactly its E rows - the multi-agent line E's one row with B21's suites and LB-9, LB-7 - and every id a matrix row", () => {
    const rows = records(tableUnder(readRepo(VERDICT), "2. The status-line -> row table"));
    const expected: ReadonlyArray<readonly [string, string]> = [["provider", "Q1"], ["production auth", "Q2"], ["database/RLS", "Q9, Q10"], ["component acquisition", "Q3"], ["MCP", "Q12, Q14"], ["multi-agent", "Q15"], ["sandbox", "Q4"], ["manufacturing release", "Q6"], ["external quote/order", "Q5"], ["physical hardware", "Q7, Q8"]];
    expect(rows.map((row) => [row["status line"], row["E rows"]])).toEqual(expected);
    expect(expected.map(([line, ids]) => [line, ids.split(", ")])).toEqual(Object.entries(STATUS_LINE_ROWS).map(([line, ids]) => [line, [...ids]]));
    const ids = new Set(matrix().map((row) => row.row));
    for (const [, cell] of expected) for (const id of cell.split(", ")) expect(ids.has(id), id).toBe(true);
    const multiAgent = matrix().filter((row) => row.lb.join(", ") === "LB-9, LB-7" && /B21's suites/.test(row.builtOffline));
    expect(multiAgent.map((row) => row.row)).toEqual(["Q15"]);
    expect(markdownTables(readRepo(VERDICT)).length).toBeGreaterThanOrEqual(3);
  });
});
