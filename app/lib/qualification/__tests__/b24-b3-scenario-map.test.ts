/**
 * [B24-B3] The twenty-scenario map (D24-17, OD-206; runbook section 3 `:1165` "The final system must demonstrate all of these without
 * bypassing authority:" and section 4 `:1206` "trace/replay/evals cover the required scenarios;"): app/lib/evaluation/scenario-map.ts.
 *
 *  1. the map's shape and schema: 20 rows, row n on runbook `:1166+n`, the runbook's twenty sentences verbatim, and
 *     `scenarioMapProblems(SCENARIO_MAP, facts)` returning [] with the facts read from the tree (CI selection through B1's
 *     `_ci-admission.ts`, the LB ids of the register, a file reader);
 *  2. every refusal code fires on its own mutated copy ("in part: human only" is STANDING_NOT_CLOSED, section 7's test), and the
 *     generator refuses before it writes anything;
 *  3. every cite resolves, every LB id is a register row, every suite or spec a demonstrated row cites is selected by a CI job, and every
 *     evidence item's recorded CI jobs are the ones the workflows give it;
 *  4. the fixed standings: 8 and 20 by refusal, 17 by recorded deviation, 18 blocked (OD-206), and 3 never covered (D24-42, OD-229);
 *  5. the byte gate: scenario-map.csv and scenario-map.json are the module's renderings;
 *  6. the page: its table equals the CSV, every row that is not demonstrated shows its missing text and its LB ids, no sentence calls a
 *     scenario demonstrated unless its standing is, and its discovery citations resolve at the discovery's committed numbering.
 *
 * Failing first on 4738aa3: the module, the generator and the page do not exist (scenario-map.md section 5). Files are read as text;
 * nothing is written to disk and no process is started.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { liveBlockerIdsOf } from "@/app/lib/evaluation/golden-catalog";
import {
  SCENARIO_MAP,
  SCENARIO_MAP_CSV_HEADER,
  SCENARIO_MAP_SCHEMA,
  SCENARIO_MAP_VERSION,
  SCENARIO_PROBLEM_CODES,
  SCENARIO_STANDINGS,
  describeScenarioMapProblems,
  recordedCiJobsOf,
  renderScenarioMapCsv,
  renderScenarioMapJson,
  renderScenarioMapTable,
  scenarioMapProblems,
  type ScenarioEvidence,
  type ScenarioMapFacts,
  type ScenarioRow,
} from "@/app/lib/evaluation/scenario-map";
import { ciAdmission, readRepoText } from "./_ci-admission";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const read = readRepoText;
const PAGE = "artifacts/ai-control-plane-b24/scenario-map.md";
const CSV = "artifacts/ai-control-plane-b24/scenario-map.csv";
const JSON_FILE = "artifacts/ai-control-plane-b24/scenario-map.json";
const REGISTER = "artifacts/remaining-builder-program/LIVE_BLOCKERS.md";
const DISCOVERY = "artifacts/ai-control-plane-b24/discovery.md";
const GENERATOR = "scripts/generate-b24-scenario-map.ts";
const readOrNull = (path: string): string | null => (existsSync(join(ROOT, path)) ? readFileSync(join(ROOT, path), "utf8").replaceAll(`${String.fromCharCode(13)}${NEWLINE}`, NEWLINE) : null);

/** The runbook's twenty sentences (`:1167-1186`), copied here by hand from the runbook so the module's own copy is checked against them. */
const RUNBOOK_SCENARIOS = [
  "Inspect any selected schematic or PCB object.",
  "Add, move, rotate, edit, delete and replace schematic components under the correct permission tier.",
  "Add/edit/remove wires, nets, labels and power symbols.",
  "Assign and validate exact symbols, footprints, package geometry and pin-to-pad mappings.",
  "Move, rotate and lock footprints.",
  "Generate, review and apply auto-placement.",
  "Add/edit/delete tracks, vias, zones, keepouts, dimensions, text and board-outline geometry.",
  "Change all vias on a stable net under manufacturing constraints.",
  "Generate, review and apply selected-net and full-board routing.",
  "Run ERC, connectivity, DRC, parity, readiness and deterministic release checks.",
  "Open/control/read the 3D view and focus J1 without altering engineering state.",
  "Recover across refresh, cancellation, provider failure, role change, revision conflict and process failure.",
  "Undo/redo without crossing divergent history.",
  "Obtain external component observations without elevating them to authority.",
  "Use an approved external MCP read tool without credential or project leakage.",
  "Expose a Sirkit read/propose tool over MCP with the same role/revision behavior as native invocation.",
  "Run a complex lower-power timer replacement through the adaptive specialist DAG with deterministic disagreement resolution.",
  "Execute an approved sandboxed simulation without network/secrets/filesystem escape.",
  "Generate a deterministic manufacturing package that the AI cannot release.",
  "Refuse purchase/order without exact Tier 3 human authority.",
] as const;

const admission = ciAdmission();
const FACTS: ScenarioMapFacts = { ciJobsOf: (path) => admission.jobsOf(path), liveBlockerIds: liveBlockerIdsOf(read(REGISTER)), read: readOrNull };
/** A mutable copy of a row, so each refusal case can change one field. */
type MutableEvidence = { -readonly [K in keyof ScenarioEvidence]: ScenarioEvidence[K] };
type MutableRow = { -readonly [K in keyof ScenarioRow]: K extends "evidence" ? MutableEvidence[] : K extends "standing" ? string : ScenarioRow[K] };
const copy = (): MutableRow[] => structuredClone(SCENARIO_MAP) as unknown as MutableRow[];
const row = (rows: MutableRow[], n: number): MutableRow => rows.find((candidate) => candidate.n === n)!;
const isPage = (path: string): boolean => path.startsWith("artifacts/") && path.endsWith(".md");
/** A section of the page, from its `## n. ` heading to the next `## `. */
function section(page: string, n: number): string {
  const start = page.indexOf(`${NEWLINE}## ${n}. `);
  if (start < 0) return "";
  const end = page.indexOf(`${NEWLINE}## `, start + 1);
  return end < 0 ? page.slice(start) : page.slice(start, end);
}
/** One CSV record per line (the renderer writes no line break inside a cell), split on commas outside quotes. */
function csvRecords(text: string): string[][] {
  return text.trimEnd().split(NEWLINE).map((line) => {
    const cells: string[] = [];
    let cell = "";
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const character = line[index]!;
      if (quoted) {
        if (character === "\"" && line[index + 1] === "\"") { cell += "\""; index += 1; } else if (character === "\"") quoted = false; else cell += character;
      } else if (character === "\"") quoted = true;
      else if (character === ",") { cells.push(cell); cell = ""; } else cell += character;
    }
    cells.push(cell);
    return cells;
  });
}

describe("[B24-B3] the twenty-scenario map (D24-17, OD-206)", () => {
  it("1. the map's shape and schema: 20 rows, row n on runbook :1166+n with the runbook's sentence verbatim, standings from the closed six, and no refusal over the tree's facts", { timeout: 60_000 }, () => {
    expect(SCENARIO_MAP_SCHEMA).toBe("sirkit.scenario-map.v1");
    expect(SCENARIO_MAP_VERSION).toBe("1.0.0");
    expect([...SCENARIO_STANDINGS]).toEqual(["demonstrated", "demonstrated offline only", "in part", "by refusal", "by recorded deviation", "blocked"]);
    expect(SCENARIO_MAP).toHaveLength(20);
    expect(SCENARIO_MAP.map((entry) => entry.n)).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
    expect(SCENARIO_MAP.map((entry) => entry.runbookLine)).toEqual(Array.from({ length: 20 }, (_, index) => 1167 + index));
    expect(SCENARIO_MAP.map((entry) => entry.scenario)).toEqual([...RUNBOOK_SCENARIOS]);
    for (const entry of SCENARIO_MAP) {
      expect(Object.keys(entry).sort(), String(entry.n)).toEqual(["blockers", "decisions", "evidence", "missing", "n", "runbookLine", "scenario", "standing"]);
      for (const item of entry.evidence) expect(Object.keys(item).sort(), `${entry.n} ${item.path}`).toEqual(["ciJobs", "class", "path", "refs"]);
    }
    expect(Object.isFrozen(SCENARIO_MAP)).toBe(true);
    expect(scenarioMapProblems(SCENARIO_MAP, FACTS)).toEqual([]);
    expect(describeScenarioMapProblems(SCENARIO_MAP, FACTS)).toEqual([]);
    // no field totals or scores anything across classes (:1070)
    const json = JSON.parse(read(JSON_FILE)) as Record<string, unknown>;
    expect(Object.keys(json).sort()).toEqual(["mapDigest", "runbook", "scenarios", "schema", "standings", "version"]);
    expect(read("app/lib/evaluation/scenario-map.ts")).not.toMatch(/\b(?:total|score|sum)\w*\s*[:=(]/i);
  });

  it("2. every refusal code fires on its own mutated copy - an open standing such as \"in part: human only\" is STANDING_NOT_CLOSED - and the generator refuses before it writes anything", () => {
    const fires = (code: string, mutate: (rows: MutableRow[]) => void): void => {
      const rows = copy();
      mutate(rows);
      expect(scenarioMapProblems(rows as unknown as readonly ScenarioRow[], FACTS), code).toEqual([code]);
    };
    fires("MAP_SHAPE", (rows) => { rows.pop(); });
    fires("MAP_SHAPE", (rows) => { row(rows, 2).n = 3; });
    fires("MAP_SHAPE", (rows) => { row(rows, 5).runbookLine = 1170; });
    fires("MAP_SHAPE", (rows) => { row(rows, 6).scenario = "Generate and apply auto-placement."; });
    fires("STANDING_NOT_CLOSED", (rows) => { row(rows, 3).standing = "in part: human only"; });
    fires("BLOCKED_WITHOUT_LB", (rows) => { row(rows, 18).blockers = []; });
    fires("LB_UNKNOWN", (rows) => { row(rows, 18).blockers = ["LB-10", "LB-99"]; });
    fires("LB_UNKNOWN", (rows) => { row(rows, 12).missing = `${row(rows, 12).missing} (LB-98)`; });
    fires("DEMONSTRATED_NOT_IN_CI", (rows) => { row(rows, 1).evidence = [...row(rows, 1).evidence, { class: "deterministic_offline", path: "app/components/pcb/__tests__/inspector-commands.test.tsx", refs: ["locked footprints disable move/rotate fields"], ciJobs: [] }]; });
    fires("DEMONSTRATED_WITH_REMAINDER", (rows) => { row(rows, 10).missing = "something is not shown"; });
    fires("DEMONSTRATED_WITH_REMAINDER", (rows) => { row(rows, 13).blockers = ["LB-3"]; });
    fires("OFFLINE_ONLY_WITHOUT_LB", (rows) => { row(rows, 9).blockers = []; });
    fires("IN_PART_WITHOUT_GAP", (rows) => { row(rows, 7).missing = ""; });
    fires("IN_PART_WITHOUT_GAP", (rows) => { row(rows, 16).decisions = []; });
    fires("REFUSAL_WITHOUT_CITE", (rows) => { row(rows, 8).evidence = row(rows, 8).evidence.filter((item) => isPage(item.path)); });
    fires("DEVIATION_WITHOUT_RECORD", (rows) => { row(rows, 17).evidence = row(rows, 17).evidence.filter((item) => !isPage(item.path)); });
    fires("DEVIATION_WITHOUT_RECORD", (rows) => { row(rows, 17).decisions = []; });
    fires("CITE_UNRESOLVED", (rows) => { row(rows, 11).evidence = [{ ...row(rows, 11).evidence[0]!, refs: ["a fragment no file holds (b24-b3)"] }, ...row(rows, 11).evidence.slice(1)]; });
    fires("CITE_UNRESOLVED", (rows) => { row(rows, 20).evidence = [{ ...row(rows, 20).evidence[0]!, path: "app/lib/nowhere/__tests__/absent.test.ts" }, ...row(rows, 20).evidence.slice(1)]; });
    fires("CITE_UNRESOLVED", (rows) => { const page = row(rows, 17).evidence.find((item) => isPage(item.path))!; page.refs = [":2 Scenario 17's disagreement is never resolved to a winner"]; });
    expect([...SCENARIO_PROBLEM_CODES]).toEqual(["MAP_SHAPE", "STANDING_NOT_CLOSED", "BLOCKED_WITHOUT_LB", "LB_UNKNOWN", "DEMONSTRATED_NOT_IN_CI", "DEMONSTRATED_WITH_REMAINDER", "OFFLINE_ONLY_WITHOUT_LB", "IN_PART_WITHOUT_GAP", "REFUSAL_WITHOUT_CITE", "DEVIATION_WITHOUT_RECORD", "CITE_UNRESOLVED"]);
    // the generator: its guard runs over the module's map before the first write, and a problem makes it throw (exit non-zero)
    const generator = read(GENERATOR);
    const guard = generator.indexOf("scenarioMapProblems(SCENARIO_MAP, facts)");
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(generator.indexOf("await mkdir("));
    expect(guard).toBeLessThan(generator.indexOf("await writeFile("));
    expect(generator).toMatch(/if \(problems\.length > 0\) throw new Error\(`Refused: nothing written\./);
    expect(generator).toContain("process.exitCode = 1;");
  });

  it("3. every cite resolves, every LB id is a register row, every suite or spec a demonstrated row cites is selected by a CI job, and every evidence item's recorded CI jobs are the ones the workflows give it (the generator's facts)", { timeout: 60_000 }, () => {
    const register = new Set(FACTS.liveBlockerIds);
    const cited = new Set(SCENARIO_MAP.flatMap((entry) => [...entry.blockers, ...[...entry.missing.matchAll(/\bLB-[0-9]+/g)].map((match) => match[0])]));
    expect([...cited].filter((id) => !register.has(id))).toEqual([]);
    expect(cited.size).toBeGreaterThanOrEqual(8);
    const unresolved = describeScenarioMapProblems(SCENARIO_MAP, FACTS).filter((line) => line.startsWith("CITE_UNRESOLVED"));
    expect(unresolved).toEqual([]);
    for (const entry of SCENARIO_MAP.filter((candidate) => candidate.standing === "demonstrated")) {
      for (const item of entry.evidence.filter((candidate) => !isPage(candidate.path))) expect(admission.jobsOf(item.path), `${entry.n} ${item.path}`).not.toEqual([]);
    }
    const drift: string[] = [];
    for (const entry of SCENARIO_MAP) for (const item of entry.evidence) {
      const derived = isPage(item.path) ? [] : admission.jobsOf(item.path);
      if (JSON.stringify(item.ciJobs) !== JSON.stringify(derived)) drift.push(`${entry.n} ${item.path}: recorded ${item.ciJobs.join("+") || "(none)"}, derived ${derived.join("+") || "(none)"}`);
    }
    expect(drift).toEqual([]);
    // the generator's facts are the recorded jobs, so it refuses exactly what this case's derived facts refuse
    const recorded = recordedCiJobsOf(SCENARIO_MAP);
    for (const entry of SCENARIO_MAP) for (const item of entry.evidence) expect(recorded(item.path), item.path).toEqual(item.ciJobs);
    expect(recorded("app/lib/nowhere/__tests__/absent.test.ts")).toEqual([]);
  });

  it("4. the fixed standings hold: 8 by refusal (padstack-bound vias, LB-8), 17 by recorded deviation (B21's verdict, OD-122, LB-9), 18 blocked (LB-10, B22's verdict, OD-134), 20 by refusal (OD-170..OD-172, LB-12); 3 is never covered while its power-ground counterexample stands (D24-42, OD-229)", () => {
    const at = (n: number): ScenarioRow => SCENARIO_MAP.find((entry) => entry.n === n)!;
    expect(at(8)).toMatchObject({ standing: "by refusal", blockers: ["LB-8"] });
    expect(at(8).evidence.map((item) => item.path)).toContain("app/lib/engineering/__tests__/b18-e-scenario-2.test.tsx");
    expect(at(17)).toMatchObject({ standing: "by recorded deviation", decisions: ["OD-122"], blockers: ["LB-9"] });
    expect(at(17).evidence.find((item) => item.path === "artifacts/ai-control-plane-b21/final-verdict.md")?.refs[0]).toMatch(/^:89 /);
    expect(at(18)).toMatchObject({ standing: "blocked", decisions: ["OD-134"], blockers: ["LB-10"] });
    expect(at(18).evidence.find((item) => item.path === "artifacts/ai-control-plane-b22/final-verdict.md")?.refs.map((ref) => ref.split(" ")[0])).toEqual([":3", ":17"]);
    expect(at(20)).toMatchObject({ standing: "by refusal", decisions: ["OD-170", "OD-171", "OD-172"], blockers: ["LB-12"] });
    expect(at(20).evidence.map((item) => item.path)).toEqual(expect.arrayContaining([
      "app/lib/engineering/__tests__/b19-e-no-purchase-tripwire.test.ts", "app/lib/engineering/__tests__/b18-e-scenario-8.test.ts", "app/lib/manufacturing-providers/__tests__/b23-a-no-order-structural.test.ts",
      "app/lib/manufacturing-providers/__tests__/b23-c-purchase-authorization.test.ts", "app/lib/manufacturing-providers/__tests__/b23-c-order-contract.test.ts", "app/lib/manufacturing-providers/__tests__/b23-c-ordering-disabled.test.tsx", "e2e/agent-execution.spec.ts",
    ]));
    expect(at(3).standing).toBe("in part");
    expect(at(3).decisions).toEqual(expect.arrayContaining(["OD-16", "OD-229"]));
    expect(at(3).missing).toContain("D24-42");
    expect(at(3).evidence.find((item) => item.path === "app/lib/qualification/__tests__/b24-b2-power-ground.test.ts")?.refs).toContain("9");
    expect(at(12)).toMatchObject({ standing: "in part" });
    expect(at(12).decisions).toContain("OD-27");
    expect(at(12).missing).toContain("D24-31");
  });

  it("5. the byte gate: scenario-map.csv and scenario-map.json are the module's renderings (LF, a final newline)", () => {
    const csv = renderScenarioMapCsv();
    const json = renderScenarioMapJson();
    expect(read(CSV)).toBe(csv);
    expect(read(JSON_FILE)).toBe(json);
    for (const text of [csv, json]) {
      expect(text.endsWith(NEWLINE)).toBe(true);
      expect(text.includes(String.fromCharCode(13))).toBe(false);
    }
    expect(csv.split(NEWLINE)[0]).toBe(SCENARIO_MAP_CSV_HEADER.join(","));
    expect(csvRecords(csv)).toHaveLength(21);
  });

  it("6. the page: section 1's table equals the CSV row for row; every row that is not demonstrated shows its missing text and its LB ids; section 2 sets each standing in order; no sentence calls a scenario demonstrated unless its standing is; every discovery citation resolves at the discovery's committed numbering", () => {
    const page = read(PAGE);
    expect(page.startsWith("# B24-B3 - ")).toBe(true);
    for (const label of ["CONFIRMED", "INFERRED", "RECORDED", "UNKNOWN", "BLOCKED-LIVE-QUALIFICATION"]) expect(page, label).toContain(`**${label}**`);
    const one = section(page, 1);
    expect(one).toContain(renderScenarioMapTable());
    const unescape = (cell: string): string => cell.trim().replaceAll("\\|", "|");
    const tableRows = one.split(NEWLINE).filter((line) => /^\| \d+ \|/.test(line)).map((line) => line.slice(2, -2).split(/(?<!\\) \| /).map(unescape));
    const csvRows = csvRecords(read(CSV)).slice(1);
    expect(tableRows).toHaveLength(20);
    tableRows.forEach((cells, index) => {
      const record = csvRows[index]!;
      expect(cells, `row ${index + 1}`).toEqual([record[1], record[2], record[3], record[4], record[5], record[6], record[7], record[8]].map((cell) => (cell === "(none)" ? "(none)" : cell)));
    });
    for (const entry of SCENARIO_MAP.filter((candidate) => candidate.standing !== "demonstrated")) {
      const line = one.split(NEWLINE).find((candidate) => candidate.startsWith(`| ${entry.n} |`))!;
      expect(unescape(line), String(entry.n)).toContain(entry.missing);
      for (const id of entry.blockers) expect(line, `${entry.n} ${id}`).toContain(id);
    }
    // section 2: one line per row, in order, naming the standing it set
    const two = section(page, 2).split(NEWLINE).filter((line) => /^- \d+\. /.test(line));
    expect(two.map((line) => Number(/^- (\d+)\./.exec(line)![1]))).toEqual(SCENARIO_MAP.map((entry) => entry.n));
    two.forEach((line, index) => expect(line.startsWith(`- ${index + 1}. ${SCENARIO_MAP[index]!.standing}: `), line.slice(0, 60)).toBe(true));
    // no sentence calls a scenario demonstrated unless its standing is (section 1's table aside)
    const prose = page.replace(one, "");
    const wrong: string[] = [];
    for (const sentence of prose.split(/(?<=[.;])\s+|\n/)) {
      if (!/\bdemonstrated\b/i.test(sentence)) continue;
      for (const match of sentence.matchAll(/\b[Ss]cenarios? ((?:\d+(?:, | and |-| or )?)+)/g)) {
        const numbers = match[1]!.split(/, | and | or /).flatMap((part) => (part.includes("-") ? [] : [Number(part)])).filter((n) => n >= 1 && n <= 20);
        for (const n of numbers) {
          const standing = SCENARIO_MAP[n - 1]!.standing;
          const offline = /\bdemonstrated offline only\b/i.test(sentence);
          if (offline ? !standing.startsWith("demonstrated") : standing !== "demonstrated" && !/\bnot demonstrated\b|\bnever demonstrated\b|\bdemonstrated only\b/i.test(sentence)) wrong.push(`scenario ${n} (${standing}): ${sentence.trim().slice(0, 120)}`);
        }
      }
    }
    expect(wrong).toEqual([]);
    // discovery citations: each `discovery.md:N` on the page is a row of section 2's citation table, whose anchor its line holds at the
    // committed numbering (the lead's later one-line `- [B24-...` closure clauses dropped, as b24-a1-environment-profile case 14 does)
    const discovery = read(DISCOVERY).split(NEWLINE).filter((line) => !/^- \[B24-[A-F]\d*[a-z]?(?:,| )/.test(line));
    const cites = [...page.matchAll(/^\| `discovery\.md:(\d+)` \| `([^`]+)` \|$/gm)];
    expect(cites.length).toBeGreaterThanOrEqual(6);
    for (const cite of cites) expect(discovery[Number(cite[1]) - 1] ?? "", `discovery.md:${cite[1]}`).toContain(cite[2]!);
    const tabled = new Set(cites.map((cite) => cite[1]));
    // a bare `discovery.md:N` is B24's discovery (another chapter's is cited with its directory, artifacts/ai-control-plane-b22/...)
    for (const inline of page.matchAll(/(?<![/\w-])discovery\.md:(\d+)/g)) expect(tabled.has(inline[1]!), `discovery.md:${inline[1]} is not in the citation table`).toBe(true);
  });
});
