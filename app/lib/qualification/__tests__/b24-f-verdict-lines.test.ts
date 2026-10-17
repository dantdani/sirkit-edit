/**
 * [B24-F] The verdict lines (D24-40's B24-F half; section 5's `:1157` / `:1266` pin; lead decisions D3, D4, D5): `final-verdict.md`
 * and B24-F's ten other written pages, held to E's qualification matrix, the register and the code.
 *
 *  1. ten scope lines, in runbook `:1146-1155`'s order and words, each with one state of the closed set;
 *  2. scopes 3-10 each equal the state computed from every E matrix row whose Readiness scope cell names the scope (D4): NOT READY when
 *     a row's recorded live runs hold E's failing marker, READY when every row passes, IN PART when some pass, else
 *     BLOCKED-LIVE-QUALIFICATION with every row's LB; scopes 1-2 are PENDING-FINAL-RUN; a scope with no row, or no failing marker
 *     defined by E, is a STOP; [B24-closeout, 2026-10-10] since commit 2/2 scopes 1-2 carry the state their recorded gates compute
 *     (`test-and-validation-report.md` sections 1-2: READY only when every gate passed, else NOT READY naming each failing gate),
 *     naming the final SHA; [B24-closeout review, 2026-10-11] correctness-4, security-5, security-6: both tables stand under headings
 *     naming the final SHA, each workflow's rows are exactly its pull-request jobs (benchmark.yml's too), no page claims "every job"
 *     unqualified, and scope 2, the report and the final report name what no CI job selects (the b16-0 security suites apart);
 *  3. every LB the verdict names is a BLOCKED-LIVE-QUALIFICATION register row, mirrored in `PROGRAM_STATE.json`;
 *  4. "Application complete" stands only beside a READY scope, and no page claims physical completion while scope 10 is not READY;
 *  5. the sandbox, manufacturing-file, MCP and quote/order lines carry their facts (the release id and expiry computed from code), and
 *     the CI-readiness line carries D3's `baseline_missing` rule;
 *  6. the count lines of `final-verdict.md` and `executive-summary.md` equal the generated `current-system-map.md`;
 *  7. PENDING-FINAL-RUN appears only on scopes 1-2; [B24-closeout, 2026-10-10] since commit 2/2 on no page, the closeout's two new
 *     pages among them (cases 4 and 8 read them too); [B24-closeout review, 2026-10-11] correctness-2, -3, -5, -6: no register row
 *     still names `this commit`, no page calls commit 2/2 records-only while this suite carries its edits, and the closeout's two
 *     pages are their records' (the unknowns page's OD headings, states and counts, its defect states by their clauses and tallies;
 *     the report's suite table by the files and the job-scope rule);
 *  8. every backticked `path:line` on the pages resolves - a bare file name against the page's directory or the lead's records, a
 *     `:N` continuation against the last path of its paragraph or table row, never skipped - every cited suite or script exists, and a
 *     citation of the B15 or B16.0.7 verdict says "pre-program" ([B24-F review, 2026-10-10] correctness-11; case 4's physical check
 *     needs the negation on the completion word itself);
 *  9. `b24-e-statements` scans every B24-F page (deliverable 7);
 * 10. each report carries its required tokens, derived from code and pins, never typed;
 * 11. the status-line -> row table (D5): ten rows in runbook `:1241-1250`'s order, each naming exactly its E rows; [B24-closeout,
 *     2026-10-10] and the final report's ten status lines (section 5) each the state section 1's rule computes over its rows;
 *     [B24-closeout review, 2026-10-11] correctness-3, correctness-1, security-1: 5.2's computed column too, and the three integrity
 *     lines answer what 5.3 measured (an inference 5.3 records is labelled on the line; PROTECTED ORIGINAL MODIFIED is YES whenever
 *     the listing counts a modified file; SECRETS EXPOSED names the pushed commits outside its scanned reach).
 *
 * Failing first on 58c0834: the pages do not exist (D24-40's counterexample: no single list covers OD-1..OD-222). Files are read as
 * text; nothing is written and no process starts.
 */
import { existsSync, readdirSync } from "node:fs"; import { createHash } from "node:crypto";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NON_LIVE_GATES } from "@/app/lib/evaluation/live-suites";
import { renderClassScoreLines } from "@/app/lib/evaluation/golden-catalog";
import { JLCPCB_2L_RULE_PROFILE_EVIDENCE, ruleProfileExpiry } from "@/app/lib/pcb/fab/rule-profile";
import { LATENCY_STATES } from "@/app/lib/qualification/latency-policy";
import { CI_EVIDENCE_JOBS, READINESS_SCOPES, STATUS_LINE_ROWS, classificationOf, matrixRows, registerRows, type MatrixRow } from "./_b24-e-register";
import { markdownTables, readRepo, records, sectionOf, tableUnder } from "./_b24-f-pages";
import { OWNER_DECISIONS, ownerDecisionFacts, ownerDecisionStatus } from "./_b24-f-registers"; // [B24-closeout review, 2026-10-11] correctness-3
import { CI_JOB_IDS, ciAdmission } from "./_ci-admission"; // [B24-closeout review, 2026-10-11] security-6, correctness-3

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const B24 = "artifacts/ai-control-plane-b24/";
const VERDICT = `${B24}final-verdict.md`;
const SUMMARY = `${B24}executive-summary.md`;
const MATRIX = `${B24}qualification-matrix.md`;
const MAP = `${B24}current-system-map.md`;
/** B24-Fb's eleven written pages. */
const PAGES = ["threat-model-closure-register.md", "open-risks-and-owner-decisions.md", "database-migration-proof.md", "provider-security-report.md", "mcp-security-report.md", "sandbox-security-report.md", "eval-catalog-and-results.md", "performance-reliability-report.md", "executive-summary.md", "changed-files.md", "final-verdict.md"].map((name) => `${B24}${name}`);
const STATE = /^(?:READY|READY \(scoped: .+\)|IN PART \(.+\)|NOT READY \(.+\)|BLOCKED-LIVE-QUALIFICATION \(LB-\d+(?:, LB-\d+)*(?:; .+)?\))$/; // [B24-closeout, 2026-10-10] reviewed pin move (commit 2/2, D5): PENDING-FINAL-RUN left the closed set once scopes 1-2 were measured
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
    expect(new RegExp(String.raw`^\*\*Verdict \(as of the closeout, commit 2/2, at \x60${FINAL_SHA}\x60\): PARTIAL\.\*\*`, "m").test(readRepo(VERDICT))).toBe(!allReady); // [B24-closeout, 2026-10-10] the verdict restated at the final SHA (D5)
  });

  it("2. scopes 3-10 each equal the state computed from E's matrix rows whose Readiness scope names them (D4); scopes 1-2 are the states their recorded gates compute at the final SHA (D5); every scope has a row and E defines its failing marker; the CI tables stand at the final SHA, each workflow's rows its pull-request jobs, and what no CI job selects is named", () => { // [B24-closeout, 2026-10-10] retitled in place: scopes 1-2 were PENDING-FINAL-RUN until commit 2/2; [B24-closeout review, 2026-10-11] the CI clause added in place
    expect(sectionOf(readRepo(MATRIX), "2.1 Column rules")).toContain("a failing result is marked `failing`");
    const rows = matrix();
    expect(rows.length).toBe(15);
    const problems: string[] = [];
    scopeRows().forEach((row, index) => {
      if (index < 2) {
        problems.push(...measuredScopeProblems(row.scope!, row.state!, index === 0 ? finalRunGates() : ciJobGates())); // [B24-closeout, 2026-10-10] reviewed pin move (commit 2/2, D5): was PENDING-FINAL-RUN; now the state the recorded gates compute, naming the final SHA
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
    // [B24-closeout, 2026-10-10] the measured rule bites (D5): READY beside a failing gate, NOT READY with none failing, a failing gate
    // unnamed and no final SHA are each reported; the gates are the final run's six and every job of the deterministic workflow
    const sha = `\x60${FINAL_SHA}\x60`;
    expect(measuredScopeProblems("s", `READY (scoped: at ${sha})`, [{ name: "tsc", ok: true }])).toEqual([]);
    expect(measuredScopeProblems("s", `READY (scoped: at ${sha})`, [{ name: "eslint", ok: false }])).toEqual(["s: READY, not NOT READY", "s: the failing gate eslint unnamed"]);
    expect(measuredScopeProblems("s", `NOT READY (eslint at ${sha})`, [{ name: "eslint", ok: true }])).toEqual(["s: NOT READY, not READY"]);
    expect(measuredScopeProblems("s", "NOT READY (eslint)", [{ name: "eslint", ok: false }])).toEqual(["s: names no final SHA"]);
    expect(finalRunGates().map((gate) => gate.name)).toEqual(["vitest", "tsc", "eslint", "browser, page-browser-e2e", "browser, page-browser-e2e-b24", "browser, orchestration"]);
    // [B24-closeout review, 2026-10-11] correctness-4, security-5: was the deterministic-manufacturing rows against that workflow's jobs
    // only; now each workflow's rows are exactly its pull-request jobs (benchmark.yml's too: benchmark-nightly's job-level `if` keeps it
    // off pull requests), and both tables stand under headings naming the final SHA - a table at another SHA is no table here
    expect(ciWorkflowProblems(ciRows())).toEqual([]);
    expect(ciWorkflowProblems(ciRows().filter((entry) => entry.workflow !== "benchmark-quality"))).toEqual([`benchmark-quality: rows none, its pull-request jobs ${pullRequestJobs(BENCHMARK_WORKFLOW).join(", ")}`]);
    expect(workflowJobs(BENCHMARK_WORKFLOW)).toContain("benchmark-nightly");
    expect(pullRequestJobs(BENCHMARK_WORKFLOW)).not.toContain("benchmark-nightly");
    const report = readRepo(REPORT);
    expect(() => ciRows(report.replace(`## ${CI_HEADING}`, `## 2. CI at ${TICK}7ce1236${TICK}`))).toThrow(/B24_F_TABLE: 0 tables/);
    expect(() => finalRunGates(report.replace(`## ${FINAL_RUN_HEADING}`, `## 1. The final run at ${TICK}7ce1236${TICK}`))).toThrow(/B24_F_TABLE: 0 tables/);
    // security-5: "every job" never stands unqualified on the verdict or the closeout's pages (benchmark-nightly runs in no pull-request run)
    expect(everyJobClaims()).toEqual([]);
    expect(everyJobLines(`CI at ${FINAL_SHA}: every job green.`)).toEqual([1]);
    expect(everyJobLines("every pull-request job green; every job that ran")).toEqual([]);
    // security-6: CI runs a selection - scope 2, the report's Not-in-CI bullet and the final report name what no CI job selects
    expect(outsideCiProblems()).toEqual([]);
    const historical = historicalCiSnapshot();
    expect(ciCensusCounts(historical)).toEqual({ files: 878, outside: 302, security: 73, securityOutside: 64 });
    expect(() => historicalCiSnapshot(readRepo(HISTORICAL_CI_CENSUS).replace('"project"', '"altered"') + " ")).toThrow(/HISTORICAL_CI_CENSUS_HASH/);
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
    for (const page of [...PAGES, ...CLOSEOUT_PAGES]) { // [B24-closeout, 2026-10-10] the closeout's two new pages too
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

  it("7. PENDING-FINAL-RUN appears on no page: closeout commit 2/2 measured scopes 1-2 (D5); no register row names this commit, no page calls commit 2/2 records-only, and the closeout's two pages are their records'", () => { // [B24-closeout, 2026-10-10] reviewed pin move: it stood on scopes 1-2 only until commit 2/2; [B24-closeout review, 2026-10-11] the review round's clause added in place
    const found: string[] = [];
    for (const page of [...PAGES, ...CLOSEOUT_PAGES]) readRepo(page).split(NEWLINE).forEach((line, index) => { if (line.includes("PENDING-FINAL-RUN")) found.push(`${page}:${/^\| (\d+) \|/.exec(line)?.[1] ?? `line ${index + 1}`}`); });
    expect(found).toEqual([]); // [B24-closeout, 2026-10-10] was [scope 1, scope 2]
    expect(CLOSEOUT_PAGES.filter((page) => readRepo(page) === "")).toEqual([]);
    // [B24-closeout review, 2026-10-11] correctness-6: the register's section 4 has the closeout replace `this commit (B24-Fb)` in place
    expect(records(tableUnder(readRepo(REGISTER), "5. The register")).filter((row) => /^this commit\b/.test(row.commit ?? "")).map((row) => row.id)).toEqual([]);
    // correctness-2: commit 2/2 changes this suite (its closeout lines), so no page and no note here calls commit 2/2 records-only
    expect(recordsOnlyClaims()).toEqual([]);
    expect(recordsOnlyLines(["x", ["and closeout commit 2/2 adds records", "and reports only."].join(" ")].join(NEWLINE))).toEqual([2]);
    // correctness-3, correctness-5: the closeout's two new pages are their records'; each check bites on a planted change
    const unknowns = readRepo(UNKNOWNS);
    expect(unknownsPageProblems(unknowns)).toEqual([]);
    const rowOf = (text: string, key: string): string => { const lines = text.split(NEWLINE); return lines.find((line) => line.startsWith(`| ${key} |`)) ?? lines.find((line) => line.startsWith("| ") && line.includes(` | ${key} | `)) ?? ""; };
    const swap = (text: string, key: string, edit: (row: string) => string): string => text.replace(rowOf(text, key), edit(rowOf(text, key)));
    expect(unknownsPageProblems(swap(unknowns, "OD-229", (row) => row.replace("| proposed |", "| applied |")))).toContain("OD-229: state applied, derived proposed");
    expect(unknownsPageProblems(swap(unknowns, "OD-241", (row) => row.replace(/:(\d+)`/, (_, line: string) => `:${Number(line) + 1}${TICK}`)))[0]).toMatch(/^OD-241: heading /);
    expect(unknownsPageProblems(swap(unknowns, "D24-3", (row) => row.replace("| closed offline |", "| in part |")))[0]).toBe("D24-3: in part, its clauses give closed offline");
    expect(unknownsPageProblems(unknowns.replace(/Counts: (\d+) closed offline/, (_, count: string) => `Counts: ${Number(count) + 1} closed offline`))[0]).toMatch(/^the defect counts: /);
    const report = readRepo(REPORT);
    expect(suiteTableProblems(report)).toEqual([]);
    expect(suiteTableProblems(swap(report, `${TICK}${SELF}${TICK}`, (row) => row.replace(/\| (\d+) \|/, (_, count: string) => `| ${Number(count) + 1} |`)))[0]).toMatch(/^app\/lib\/qualification\/__tests__\/b24-f-verdict-lines\.test\.ts: \d+ cases stated, \d+ read$/);
    expect(suiteTableProblems(swap(report, `${TICK}app/lib/qualification/__tests__/b24-d1-latency.test.ts${TICK}`, (row) => row.replace("benchmark-latency with its flag", "with its flag")))).toEqual(["app/lib/qualification/__tests__/b24-d1-latency.test.ts: benchmark-latency selects it, unnamed"]);
  });

  it("8. every backticked path:line on B24-F's pages resolves (file exists, line in range) - a bare file name against the page's directory or the lead's records, a `:N` continuation against the last path of its paragraph or table row, a runbook line as the runbook's - every cited suite or script exists, and a citation of the B15 or B16.0.7 verdict says pre-program", () => {
    const tests = testNames();
    const problems: string[] = [];
    let cited = 0;
    for (const page of [...PAGES, ...CLOSEOUT_PAGES]) { // [B24-closeout, 2026-10-10] the closeout's two new pages too
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
    expect(tripwire).toContain(`const EXCLUDED = (path: string): boolean => path.startsWith("artifacts/remaining-builder-program/") || ["artifacts/ai-control-plane-b24/README.md", "artifacts/ai-control-plane-b24/discovery.md", MATRIX, OWNER_DIRECTIVE].includes(path);`); // [PR-G, 2026-10-17] reviewed pin move: + OWNER_DIRECTIVE, the owner's assignment (an instruction, never a claim) excluded by path from b24-e's claim scan; the lead's records, B24's README and discovery and the matrix stand
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

  it("11. the status-line -> row table (D5): ten rows in runbook :1241-1250's order, each naming exactly its E rows - the multi-agent line E's one row with B21's suites and LB-9, LB-7 - and every id a matrix row; 5.2's computed column is the rule's, and the integrity lines answer what 5.3 measured", () => { // [B24-closeout review, 2026-10-11] retitled in place: the 5.2 and integrity clause added
    const rows = records(tableUnder(readRepo(VERDICT), "2. The status-line -> row table"));
    const expected: ReadonlyArray<readonly [string, string]> = [["provider", "Q1"], ["production auth", "Q2"], ["database/RLS", "Q9, Q10"], ["component acquisition", "Q3"], ["MCP", "Q12, Q14"], ["multi-agent", "Q15"], ["sandbox", "Q4"], ["manufacturing release", "Q6"], ["external quote/order", "Q5"], ["physical hardware", "Q7, Q8"]];
    expect(rows.map((row) => [row["status line"], row["E rows"]])).toEqual(expected);
    expect(expected.map(([line, ids]) => [line, ids.split(", ")])).toEqual(Object.entries(STATUS_LINE_ROWS).map(([line, ids]) => [line, [...ids]]));
    const ids = new Set(matrix().map((row) => row.row));
    for (const [, cell] of expected) for (const id of cell.split(", ")) expect(ids.has(id), id).toBe(true);
    const multiAgent = matrix().filter((row) => row.lb.join(", ") === "LB-9, LB-7" && /B21's suites/.test(row.builtOffline));
    expect(multiAgent.map((row) => row.row)).toEqual(["Q15"]);
    expect(markdownTables(readRepo(VERDICT)).length).toBeGreaterThanOrEqual(3);
    // [B24-closeout, 2026-10-10] commit 2/2 (D5): the final report's ten status lines are section 1's rule over each line's rows
    expect(statusLineProblems(matrix())).toEqual([]);
    expect(statusLineProblems(matrix().map((row) => (row.row === "Q12" ? { ...row, state: "NOT APPLICABLE", builtOffline: "prompt-to-gerber", lb: [] } : row)))).toEqual(["MCP: IN PART is not READY"]);
    // [B24-closeout review, 2026-10-11] correctness-3: 5.2's computed column is the rule's too (it claimed this case recomputed it)
    expect(computedTableProblems(matrix())).toEqual([]);
    expect(computedTableProblems(matrix().map((row) => (row.row === "Q12" ? { ...row, state: "NOT APPLICABLE", builtOffline: "prompt-to-gerber", lb: [] } : row)))).toEqual(["MCP: computed IN PART, the rule READY"]);
    // correctness-1, security-1: the three integrity lines answer what 5.3 measured; each rule bites on a planted change
    const verdict = readRepo(VERDICT);
    expect(integrityProblems(verdict)).toEqual([]);
    const answeredNo = verdict.replace("PROTECTED ORIGINAL MODIFIED: YES (", "PROTECTED ORIGINAL MODIFIED: NO (").replace(`| ${TICK}PROTECTED ORIGINAL MODIFIED${TICK} | YES`, `| ${TICK}PROTECTED ORIGINAL MODIFIED${TICK} | NO`);
    expect(integrityProblems(answeredNo)).toEqual([expect.stringMatching(/^PROTECTED ORIGINAL MODIFIED: NO, the listing's \d[\d,]* modified files since \d{4}-\d\d-\d\d answer YES$/)]);
    expect(integrityProblems(verdict.replace("after their merges, INFERRED", "after their merges,"))).toEqual(["HISTORY FABRICATED OR BACKDATED: 5.3 holds INFERRED, the report line does not say so"]);
    expect(integrityProblems(verdict.replace(/the (\d+) commits of the five pushed/, "the commits of the five pushed"))[0]) /* [B24-closeout lead, 2026-10-11] the bite moved from "not scanned:" (the lead has since scanned them) to the count itself */.toMatch(/^SECRETS EXPOSED: the report line names no \d+ commits outside its reach$/);
  });
});

// ── [B24-closeout, 2026-10-10] commit 2/2: scopes 1-2 measured and the report's status lines (lead decision D5; declared after the
// describe block, so no line above moves more than the cases' own) ─────────────────────────────────────────────────────────────────

/** The final SHA of the chapter's code (closeout commit 1/2); commit 2/2 changes no production code - it adds records and reports and
 *  changes this one suite, which prompt-to-gerber runs ([B24-closeout review, 2026-10-11] correctness-2). */
const FINAL_SHA = "26dc8b8";
const REPORT = `${B24}test-and-validation-report.md`;
/** The closeout's two new pages, read by cases 4, 7 and 8 beside B24-F's eleven. */
const CLOSEOUT_PAGES = ["test-and-validation-report.md", "unknowns-and-owner-decisions.md"].map((name) => `${B24}${name}`);
type Gate = { readonly name: string; readonly ok: boolean };
const TICK = String.fromCharCode(96);
/** [B24-closeout review, 2026-10-11] security-5: the two tables' headings name the final SHA (was a prefix with no SHA). */
const FINAL_RUN_HEADING = `1. The final run at ${TICK}${FINAL_SHA}${TICK}`;
const CI_HEADING = `2. CI at ${TICK}${FINAL_SHA}${TICK}`;
/** Scope 1's gates: the lead's final run at the final SHA (the report's section 1), each passing only on exit 0. */
const finalRunGates = (text: string = readRepo(REPORT)): Gate[] => records(tableUnder(text, FINAL_RUN_HEADING)).map((row) => ({ name: row.gate ?? "", ok: row.exit === "0" }));
/** Scope 2's gates: every pull-request job of CI's two runs at the final SHA (the report's section 2), each passing only on `success`. */
const ciRows = (text: string = readRepo(REPORT)): Array<Readonly<Record<string, string>>> => records(tableUnder(text, CI_HEADING));
const ciJobGates = (): Gate[] => ciRows().map((row) => ({ name: row.job ?? "", ok: row.result === "success" }));
/** A measured scope's problems (D5): READY (or READY, scoped) only when every gate passed, else NOT READY naming each failing gate;
 *  and it names the final SHA. */
function measuredScopeProblems(scope: string, state: string, gates: readonly Gate[]): string[] {
  const problems: string[] = [];
  const failing = gates.filter((gate) => !gate.ok).map((gate) => gate.name);
  const want = failing.length === 0 ? "READY" : "NOT READY";
  const kind = /^NOT READY \(/.test(state) ? "NOT READY" : /^READY\b/.test(state) ? "READY" : state.split(" (")[0]!;
  if (gates.length === 0) problems.push(`${scope}: no gate recorded`);
  else if (kind !== want) problems.push(`${scope}: ${kind}, not ${want}`);
  for (const name of failing) if (!state.includes(name)) problems.push(`${scope}: the failing gate ${name} unnamed`);
  if (!state.includes(`\x60${FINAL_SHA}\x60`)) problems.push(`${scope}: names no final SHA`);
  return problems;
}
/** The jobs a workflow declares, in order: its two-space keys under `jobs:`. */
function workflowJobs(path: string): string[] {
  const lines = readRepo(path).split(NEWLINE);
  const start = lines.indexOf("jobs:");
  return lines.slice(start + 1).flatMap((line) => /^ {2}([a-z][a-z0-9-]*):\s*$/.exec(line)?.slice(1) ?? []);
}
/** The runbook's ten status-line labels (`:1241-1250`), in `STATUS_LINE_ROWS`' order. */
const STATUS_LABELS = ["PROVIDER", "PRODUCTION AUTH", "DATABASE/RLS", "COMPONENT-ACQUISITION", "MCP", "MULTI-AGENT", "SANDBOX", "MANUFACTURING RELEASE", "EXTERNAL QUOTE/ORDER", "PHYSICAL HARDWARE"] as const;
/** Section 1's rule over a status line's rows (D4, D5): NOT READY on a failing recorded run, READY when every row passes, IN PART when
 *  some pass, else BLOCKED-LIVE-QUALIFICATION; a row id the matrix lacks is a STOP. The LBs are those of the rows that do not pass (a
 *  passing row's QUALIFIED LB is no blocker, and case 3 admits only BLOCKED-LIVE-QUALIFICATION ids on the page). */
function computedOver(ids: readonly string[], rows: readonly MatrixRow[]): { kind: string; lbs: string[] } {
  const matched = rows.filter((row) => ids.includes(row.row));
  const kind = matched.length !== ids.length ? "STOP" : matched.some((row) => row.recorded.includes(FAILING)) ? "NOT READY" : matched.every(passes) ? "READY" : matched.some(passes) ? "IN PART" : "BLOCKED-LIVE-QUALIFICATION";
  return { kind, lbs: [...new Set(matched.filter((row) => !passes(row)).flatMap((row) => row.lb))] };
}
/** The final report's status lines (`final-verdict.md` section 5) against the rule: one line per label, its state of the computed kind,
 *  naming every LB of its blocking rows unless READY. */
function statusLineProblems(rows: readonly MatrixRow[]): string[] {
  const report = sectionOf(readRepo(VERDICT), "5. The final program report").split(NEWLINE);
  const problems: string[] = [];
  Object.entries(STATUS_LINE_ROWS).forEach(([line, ids], index) => {
    const label = `${STATUS_LABELS[index]} STATUS: `;
    const found = report.filter((text) => text.startsWith(label));
    if (found.length !== 1) { problems.push(`${line}: ${found.length} status lines`); return; }
    const state = found[0]!.slice(label.length);
    const want = computedOver(ids, rows);
    const kind = /^NOT READY \(/.test(state) ? "NOT READY" : /^READY\b/.test(state) ? "READY" : /^IN PART \(/.test(state) ? "IN PART" : /^BLOCKED-LIVE-QUALIFICATION \(/.test(state) ? "BLOCKED-LIVE-QUALIFICATION" : state.slice(0, 24);
    if (kind !== want.kind) problems.push(`${line}: ${kind} is not ${want.kind}`);
    if (want.kind !== "READY") for (const lb of want.lbs) if (!state.includes(lb)) problems.push(`${line}: ${lb} unnamed`);
  });
  return problems;
}

// ── [B24-closeout review, 2026-10-11] the review round (correctness-1 to -6, security-1, -5, -6): the CI tables bound to the final SHA
// and to each workflow's pull-request jobs, what no CI job selects, the closeout's two pages against their records, 5.2's computed
// column and the integrity lines against 5.3; pure over text (the job-scope rule reads the workflows), nothing written ───────────────

const DETERMINISTIC_WORKFLOW = ".github/workflows/deterministic-manufacturing.yml";
const BENCHMARK_WORKFLOW = ".github/workflows/benchmark.yml";
const SELF = "app/lib/qualification/__tests__/b24-f-verdict-lines.test.ts";
const REGISTER = `${B24}threat-model-closure-register.md`;
const UNKNOWNS = `${B24}unknowns-and-owner-decisions.md`;
const RISKS = `${B24}open-risks-and-owner-decisions.md`;
/** Whitespace folded and backticks dropped: a phrase reads the same in a cell, a wrapped paragraph and the report's text block. */
const folded = (text: string): string => text.split(TICK).join("").replace(/\s+/g, " ");
/** A workflow's top-level name. */
const workflowName = (path: string): string => /^name:\s*(\S+)\s*$/m.exec(readRepo(path))?.[1] ?? "";
/** A workflow's jobs a pull request runs, in order: none unless `on:` lists pull_request; a job whose job-level `if:` names the event
 *  without pull_request (benchmark-nightly's schedule-and-dispatch condition) runs on none. */
function pullRequestJobs(path: string): string[] {
  const lines = readRepo(path).split(NEWLINE);
  if (!lines.some((line) => /^ {2}pull_request:/.test(line))) return [];
  const jobs: Array<{ name: string; off: boolean }> = [];
  for (const line of lines.slice(lines.indexOf("jobs:") + 1)) {
    const job = /^ {2}([a-z][a-z0-9-]*):\s*$/.exec(line);
    if (job) { jobs.push({ name: job[1]!, off: false }); continue; }
    const condition = /^ {4}if:\s*(.+)$/.exec(line)?.[1];
    if (condition !== undefined && jobs.length > 0 && /github\.event_name/.test(condition) && !/pull_request/.test(condition)) jobs[jobs.length - 1]!.off = true;
  }
  return jobs.filter((job) => !job.off).map((job) => job.name);
}
/** Each workflow's rows of the report's CI table are exactly its pull-request jobs, in order, and no row names a third workflow. */
function ciWorkflowProblems(rows: ReadonlyArray<Readonly<Record<string, string>>>): string[] {
  const problems: string[] = [];
  const named = [DETERMINISTIC_WORKFLOW, BENCHMARK_WORKFLOW].map((path) => [path, workflowName(path)] as const);
  for (const [path, name] of named) {
    const jobs = rows.filter((row) => row.workflow === name).map((row) => row.job ?? "");
    const want = pullRequestJobs(path);
    if (want.length === 0 || jobs.join(", ") !== want.join(", ")) problems.push(`${name}: rows ${jobs.join(", ") || "none"}, its pull-request jobs ${want.join(", ")}`);
  }
  for (const row of rows) if (!named.some(([, name]) => name === row.workflow)) problems.push(`${row.workflow}: no workflow of the two`);
  return problems;
}
/** The lines that claim "every job" with no qualifier (a pull-request run runs no schedule-only job, so the claim names its jobs). */
const everyJobLines = (text: string): number[] => text.split(NEWLINE).flatMap((line, index) => (/\bevery job\b(?! that ran)/i.test(line) ? [index + 1] : []));
const everyJobClaims = (): string[] => [VERDICT, ...CLOSEOUT_PAGES].flatMap((page) => everyJobLines(readRepo(page)).map((line) => `${page}:${line}`));
/** Every vitest file as vitest.config.ts collects them: a `.test.ts` or `.test.tsx` file inside a `__tests__` folder under `app`. */
function vitestFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(join(ROOT, ...dir.split("/")), { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (path.includes("/__tests__/") && /\.test\.tsx?$/.test(entry.name)) out.push(path);
    }
  };
  walk("app");
  return out.sort();
}
/** security-6: what no CI job selects, by the job-scope rule (B24-B1's `ciAdmission`, as CI's guard derives it): the vitest files, and
 *  the `b16-0-*` security suites apart (OD-228 (f)); scope 2, the report's Not-in-CI bullet and the final report each name both. */
function outsideCiProblems(): string[] {
  // These reports name 26dc8b8. Later tests cannot change what its CI selected.
  const counts = ciCensusCounts(historicalCiSnapshot());
  const phrases = [`${counts.outside} of the ${counts.files} vitest test files`, `${counts.securityOutside} of the ${counts.security} b16-0-* suites`];
  const ci = sectionOf(readRepo(REPORT), CI_HEADING).split(NEWLINE);
  const at = ci.findIndex((line) => line.startsWith("- **Not in CI.**"));
  const bullet: string[] = [];
  if (at >= 0) for (let index = at; index < ci.length && (index === at || ci[index]!.startsWith("  ")); index += 1) bullet.push(ci[index]!);
  const places: ReadonlyArray<readonly [string, string]> = [["scope 2", scopeRows()[1]?.state ?? ""], ["the report's Not-in-CI bullet", bullet.join(" ")], ["the final report", sectionOf(readRepo(VERDICT), "5.1 The report")]];
  return places.flatMap(([place, text]) => phrases.filter((phrase) => !folded(text).includes(phrase)).map((phrase) => `${place}: "${phrase}" unnamed`));
}

/** Captured by git ls-tree/git show on 2026-10-11. Its digest detects edits;
 * Git object ids record provenance, not authentication of a contributor. */
const HISTORICAL_CI_CENSUS = `${B24}ci-census-26dc8b8.json`;
const HISTORICAL_CI_CENSUS_SHA256 = "857de056bf70e1a69f7c05d2362e24be8106cdcb862a680499455b3ffd60bbb9";
interface HistoricalCiSnapshot {
  schemaVersion: "sirkit.historical-ci-census.v1";
  sourceCommit: string;
  sourceTree: string;
  files: Array<{ path: string; blob: string }>;
  policyInputs: Record<string, { blob: string; text: string }>;
  existenceInputs: Array<{ path: string; blob: string }>;
}
function historicalCiSnapshot(raw = readRepo(HISTORICAL_CI_CENSUS)): HistoricalCiSnapshot {
  if (createHash("sha256").update(raw).digest("hex") !== HISTORICAL_CI_CENSUS_SHA256) throw new Error("HISTORICAL_CI_CENSUS_HASH");
  const snapshot = JSON.parse(raw) as HistoricalCiSnapshot;
  if (snapshot.schemaVersion !== "sirkit.historical-ci-census.v1" || snapshot.sourceCommit !== "26dc8b8a71a2471cc0f542da9ecc05c37c1abc51" || !snapshot.sourceCommit.startsWith(FINAL_SHA) || !/^[a-f0-9]{40}$/.test(snapshot.sourceTree)) throw new Error("HISTORICAL_CI_CENSUS_PROVENANCE");
  const paths = snapshot.files.map((entry) => entry.path);
  if (new Set(paths).size !== paths.length || JSON.stringify(paths) !== JSON.stringify([...paths].sort((a, b) => a.localeCompare(b))) || snapshot.files.some((entry) => !/^app\/.*\/__tests__\/.*\.test\.tsx?$/.test(entry.path) || !/^[a-f0-9]{40}$/.test(entry.blob))) throw new Error("HISTORICAL_CI_CENSUS_FILES");
  for (const [path, input] of Object.entries(snapshot.policyInputs)) {
    const blob = createHash("sha1").update(`blob ${Buffer.byteLength(input.text)}\0`).update(input.text).digest("hex");
    if (blob !== input.blob) throw new Error(`HISTORICAL_CI_CENSUS_BLOB: ${path}`);
  }
  return snapshot;
}
function ciCensusCounts(snapshot: HistoricalCiSnapshot): { files: number; outside: number; security: number; securityOutside: number } {
  const existence = new Set(snapshot.existenceInputs.map((entry) => entry.path));
  const admission = ciAdmission((path) => {
    const input = snapshot.policyInputs[path];
    if (input) return input.text;
    if (existence.has(path)) return "";
    throw new Error(`HISTORICAL_CI_CENSUS_INPUT_ABSENT: ${path}`);
  });
  const files = snapshot.files.map((entry) => entry.path), outside = files.filter((path) => admission.jobsOf(path).length === 0);
  const security = (paths: readonly string[]): number => paths.filter((path) => /\/b16-0-[^/]*\.test\.tsx?$/.test(path)).length;
  return { files: files.length, outside: outside.length, security: security(files), securityOutside: security(outside) };
}
/** correctness-2: the records-only phrasings; commit 2/2 changes this suite, so no page and no note here may use one. */
const RECORDS_ONLY = new RegExp(["adds records(?: and reports)? only", "[(]records only[)]"].join("|"), "i");
const recordsOnlyLines = (text: string): number[] => text.split(NEWLINE).flatMap((line, index) => (RECORDS_ONLY.test(line) ? [index + 1] : []));
const recordsOnlyClaims = (): string[] => [...PAGES, ...CLOSEOUT_PAGES, SELF].flatMap((path) => recordsOnlyLines(readRepo(path)).map((line) => `${path}:${line}`));
/** A dated discovery line that closes or narrows a defect: `- [<tag>, <date>] D24-n: <body>`. */
const CLOSURE_CLAUSE = /^- \[([^\]]+)\] (D24-\d+): (.*)$/;
/** The state a clause's opening words give; null when it states none (a later clause recording a CI red or a failing class). */
function stateOfClause(body: string): string | null {
  if (/^(?:in part|partly closed)\b/i.test(body)) return "in part";
  if (/^(?:closed as recorded|as recorded|recorded by)\b/i.test(body)) return "closed as recorded";
  if (/^offline\b|\bclosed offline\b/i.test(body)) return "closed offline";
  if (/^closed by\b/i.test(body)) return "closed";
  return null;
}
/** correctness-5: a defect's state by its clauses - the last stating clause's, `open` when none states one; a later clause that hands
 *  the row to the register's re-read at commit 2/2 (D24-38's closeout half) takes the register's state (its `closed in part` = in part). */
function clauseState(discovery: readonly string[], id: string, register: ReadonlyMap<string, string>): string {
  let state = "open";
  let toRegister = false;
  for (const line of discovery) {
    const clause = CLOSURE_CLAUSE.exec(line);
    if (clause === null || clause[2] !== id) continue;
    const said = stateOfClause(clause[3]!);
    if (said !== null) { state = said; toRegister = false; }
    if (/the register's row is re-read at commit 2\/2/.test(clause[3]!)) toRegister = true;
  }
  if (!toRegister) return state;
  const held = register.get(id) ?? "?";
  return held === "closed in part" ? "in part" : held;
}
/** correctness-3, correctness-5: the unknowns page against its records - each OD row's heading the register's one `## OD-n` heading
 *  (its title on that line) and its state the heading's status with its amenders (`b24-f-registers` 4's derivation), the OD counts;
 *  each defect row's state the one its clauses give, the severity and state tallies recounted. */
function unknownsPageProblems(page: string, read: (path: string) => string = readRepo): string[] {
  const problems: string[] = [];
  const decisions = records(tableUnder(page, "1. Owner decisions OD-190 to OD-241"));
  const numbers = decisions.map((row) => Number(/^OD-(\d+)$/.exec(row.OD ?? "")?.[1]));
  const max = Math.max(...numbers);
  if (numbers.join(",") !== Array.from({ length: max - 189 }, (_, index) => index + 190).join(",")) problems.push(`the OD rows: ${numbers.join(", ")}`);
  const facts = ownerDecisionFacts(read, max);
  const register = read(OWNER_DECISIONS).split(NEWLINE);
  for (const row of decisions) {
    const fact = facts[Number(/^OD-(\d+)$/.exec(row.OD ?? "")?.[1]) - 1];
    if (fact === undefined || fact.headings.length !== 1) { problems.push(`${row.OD}: not one heading`); continue; }
    const heading = `${TICK}OWNER_DECISIONS.md:${fact.headings[0]}${TICK}`;
    if (row.heading !== heading) problems.push(`${row.OD}: heading ${row.heading}, the register's ${heading}`);
    if (!(register[fact.headings[0]! - 1] ?? "").toLowerCase().includes((row["title (as recorded)"] ?? "?").toLowerCase())) problems.push(`${row.OD}: its title is not on its heading`);
    const state = `${ownerDecisionStatus(fact)}${fact.amendedBy.length > 0 ? `, amended by ${fact.amendedBy.join(", ")}` : ""}`;
    if (row.state !== state) problems.push(`${row.OD}: state ${row.state}, derived ${state}`);
  }
  const status = (row: Readonly<Record<string, string>>): string => (row.state ?? "").split(", amended by")[0]!;
  const withStatus = (want: string): string[] => decisions.filter((row) => status(row) === want).map((row) => row.OD!);
  const [applied, inPart, proposed] = [withStatus("applied"), withStatus("applied in part"), withStatus("proposed")];
  if (applied.length + inPart.length + proposed.length !== decisions.length) problems.push("the OD states: one outside applied, applied in part and proposed");
  const odCounts = `Counts: ${decisions.length} numbers - ${applied.length} applied, ${inPart.length} applied in part (${inPart.join(", ")}), ${proposed.length} proposed (${proposed.join(", ")}).`;
  if (!folded(page).includes(odCounts)) problems.push(`the OD counts: "${odCounts}" not stated`);
  const defects = records(tableUnder(page, "2. Discovery defects D24-1 to D24-43"));
  const discovery = read(`${B24}discovery.md`).split(NEWLINE);
  const held = new Map(records(tableUnder(read(REGISTER), "5. The register")).map((row) => [row.id ?? "", row.state ?? ""] as const));
  for (const row of defects) {
    const want = clauseState(discovery, row.defect ?? "", held);
    if (row.state !== want) problems.push(`${row.defect}: ${row.state}, its clauses give ${want}`);
  }
  const ids = (key: string, value: string): string[] => defects.filter((row) => row[key] === value).map((row) => row.defect ?? "");
  const severities = `tally states it: ${ids("severity", "high").length} high, ${ids("severity", "medium").length} medium, ${ids("severity", "low").length} low.`;
  if (!folded(page).includes(severities)) problems.push(`the severity tally: "${severities}" not stated`);
  const states = `Counts: ${ids("state", "closed offline").length} closed offline, ${ids("state", "closed").length} closed, ${ids("state", "closed as recorded").length} closed as recorded, ${ids("state", "in part").length} in part (${ids("state", "in part").join(", ")}), ${ids("state", "open").length} open (${ids("state", "open").join(", ")}).`;
  if (!folded(page).includes(states)) problems.push(`the defect counts: "${states}" not stated`);
  return problems;
}
/** correctness-3: the report's suite table against the files - its vitest rows every B24 suite under `app`, each row's cases its file's
 *  blocks (the page's counters), its CI cell naming exactly the jobs the job-scope rule derives (`none` when none), the totals recounted. */
function suiteTableProblems(report: string): string[] {
  const problems: string[] = [];
  const rows = records(tableUnder(report, "3. The B24 suites the chapter added")).map((row) => ({ increment: row.increment ?? "", path: /^`(.+)`$/.exec(row.suite ?? "")?.[1] ?? "", stated: Number(/^(\d+)/.exec(row.cases ?? "")?.[1]), cell: row["selected by"] ?? "" }));
  const admission = ciAdmission();
  const isSpec = (path: string): boolean => /\.spec\.ts$/.test(path);
  const suites = vitestFiles().filter((path) => /\/b24-[^/]+\.test\.tsx?$/.test(path));
  if (rows.filter((row) => !isSpec(row.path)).map((row) => row.path).sort().join(",") !== suites.join(",")) problems.push(`the vitest rows are not the ${suites.length} B24 suites under app`);
  const names = (cell: string, job: string): boolean => new RegExp(`(?:^|[^a-z0-9-])${job}(?![a-z0-9-])`).test(cell);
  const blocks = new Map<string, number>();
  for (const row of rows) {
    const text = readRepo(row.path);
    if (text === "") { problems.push(`${row.path}: no file`); continue; }
    const count = (text.match(isSpec(row.path) ? /^\s*test(?:\.(?:only|skip|fixme|fail|slow))?\(/gm : /^\s*it(?:\.each)?[(<]/gm) ?? []).length;
    blocks.set(row.path, count);
    if (row.stated !== count) problems.push(`${row.path}: ${row.stated} cases stated, ${count} read`);
    const jobs = admission.jobsOf(row.path);
    for (const job of jobs) if (!names(row.cell, job)) problems.push(`${row.path}: ${job} selects it, unnamed`);
    for (const job of CI_JOB_IDS) if (!jobs.includes(job) && names(row.cell, job)) problems.push(`${row.path}: ${job} named, selecting it not`);
    if (jobs.length === 0 && !row.cell.startsWith("none")) problems.push(`${row.path}: no job selects it, the cell reads ${row.cell}`);
  }
  const vitest = rows.filter((row) => !isSpec(row.path));
  const specs = rows.filter((row) => isSpec(row.path));
  const sum = (list: typeof rows): number => list.reduce((total, row) => total + (blocks.get(row.path) ?? 0), 0);
  const under = (dir: string): number => vitest.filter((row) => row.path.startsWith(`${dir}/`)).length;
  const totals = `Totals: ${vitest.length} vitest suites with ${sum(vitest)} it( blocks (${under("app/lib/qualification/__tests__")} under app/lib/qualification/__tests__, ${under("app/lib/qualification/database/__tests__")} PGlite suites under app/lib/qualification/database/__tests__) and ${specs.length} Playwright specs with ${sum(specs)} test( blocks.`;
  if (!folded(report).includes(totals)) problems.push(`the totals: "${totals}" not stated`);
  const parts = [...new Set(rows.map((row) => row.increment))].map((increment) => {
    const own = vitest.filter((row) => row.increment === increment);
    const ownSpecs = specs.filter((row) => row.increment === increment);
    return `${increment} ${own.length} / ${sum(own)}${ownSpecs.length > 0 ? ` and ${ownSpecs.length} spec${ownSpecs.length === 1 ? "" : "s"} / ${sum(ownSpecs)}` : ""}`;
  });
  const byIncrement = `By increment, suites / blocks: ${parts.join(", ")}.`;
  if (!folded(report).includes(byIncrement)) problems.push(`the increments: "${byIncrement}" not stated`);
  return problems;
}
/** correctness-3: 5.2's table, one row per status line in STATUS_LINE_ROWS' order, its E rows those, its computed state the rule's. */
function computedTableProblems(rows: readonly MatrixRow[], text: string = readRepo(VERDICT)): string[] {
  const table = records(tableUnder(text, "5.2 The ten status lines, computed"));
  const problems: string[] = [];
  const lines = Object.entries(STATUS_LINE_ROWS);
  if (table.length !== lines.length) problems.push(`${table.length} rows, ${lines.length} status lines`);
  lines.forEach(([line, ids], index) => {
    const row = table[index];
    if (row?.["status line"] !== line || row["E rows"] !== ids.join(", ")) { problems.push(`${line}: the row reads ${row?.["status line"]} (${row?.["E rows"]})`); return; }
    const stated = (row.computed ?? "").replace(/ \(scoped\)$/, "");
    const want = computedOver(ids, rows).kind;
    if (stated !== want) problems.push(`${line}: computed ${stated}, the rule ${want}`);
  });
  return problems;
}
const INTEGRITY_LINES = ["SECRETS EXPOSED", "PROTECTED ORIGINAL MODIFIED", "HISTORY FABRICATED OR BACKDATED"] as const;
const CHAPTER_BRANCH = "chapter/b24-production-qualification";
/** correctness-1, security-1: the final report's integrity lines (5.1) against 5.3 - the same answer; an INFERRED or UNKNOWN that 5.3
 *  records about a line is labelled on the line itself; PROTECTED ORIGINAL MODIFIED is YES whenever the listing counts a file modified
 *  since the program began (NO only at none); SECRETS EXPOSED's line and 5.3's reach cell name the pushed commits the scan's range does
 *  not reach: the commits not in main of every pushed, unmerged branch but the chapter's (`open-risks-and-owner-decisions.md` 2.1). */
function integrityProblems(text: string, risks: string = readRepo(RISKS)): string[] {
  const problems: string[] = [];
  const report = sectionOf(text, "5.1 The report").split(NEWLINE);
  const table = tableUnder(text, "5.3 The three integrity lines").rows;
  const lineOf = (name: string): string => {
    const start = report.findIndex((line) => line.startsWith(`${name}: `));
    if (start < 0) return "";
    const block = [report[start]!];
    for (let index = start + 1; index < report.length && report[index]!.startsWith("  "); index += 1) block.push(report[index]!.trim());
    return block.join(" ");
  };
  const rowOf = (name: string): readonly string[] => table.find((cells) => cells[0] === `${TICK}${name}${TICK}`) ?? [];
  const answers = new Map<string, string>();
  for (const name of INTEGRITY_LINES) {
    const line = lineOf(name);
    const answer = line.startsWith(`${name}: NO (`) ? "NO" : line.startsWith(`${name}: YES (`) ? "YES" : "none";
    const recorded = /^(NO|YES)\b/.exec(rowOf(name)[1] ?? "")?.[1] ?? "none";
    answers.set(name, answer);
    if (answer === "none" || answer !== recorded) problems.push(`${name}: the report answers ${answer}, 5.3 ${recorded}`);
    for (const label of ["INFERRED", "UNKNOWN"]) if (rowOf(name).some((cell) => cell.includes(label)) && !line.includes(label)) problems.push(`${name}: 5.3 holds ${label}, the report line does not say so`);
  }
  const listing = /(\d[\d,]*) modified on or after (\d{4}-\d\d-\d\d)/.exec(rowOf("PROTECTED ORIGINAL MODIFIED").join(" "));
  if (listing === null) problems.push("PROTECTED ORIGINAL MODIFIED: 5.3 counts no modified file");
  else {
    const want = Number(listing[1]!.split(",").join("")) > 0 ? "YES" : "NO";
    if (answers.get("PROTECTED ORIGINAL MODIFIED") !== want) problems.push(`PROTECTED ORIGINAL MODIFIED: ${answers.get("PROTECTED ORIGINAL MODIFIED")}, the listing's ${listing[1]} modified files since ${listing[2]} answer ${want}`);
  }
  const pushed = records(tableUnder(risks, "2.1 Unmerged branches")).filter((row) => (row["on origin"] ?? "").startsWith("yes") && row.branch !== CHAPTER_BRANCH).reduce((total, row) => total + Number(row["commits not in main"]), 0);
  if (!lineOf("SECRETS EXPOSED").includes(`${pushed} commits`)) problems.push(`SECRETS EXPOSED: the report line names no ${pushed} commits outside its reach`);
  if (!(rowOf("SECRETS EXPOSED")[4] ?? "").includes(`${pushed} commits`)) problems.push(`SECRETS EXPOSED: 5.3's reach cell names no ${pushed} commits outside it`);
  return problems;
}
