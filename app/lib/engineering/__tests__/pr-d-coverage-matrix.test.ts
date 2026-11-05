/**
 * [PR-D] The UI <-> AI coverage matrix gates (assignment D.1 / D.2 / D.10):
 *
 *  (a) DRIFT: the matrix regenerated in memory from the current tree (registries, the
 *      B17 control scan, the test corpus) byte-matches the committed CSV and summary -
 *      a new actionable control, route or tool without a classified row fails here
 *      until `pnpm exec tsx scripts/generate-pr-d-coverage-matrix.ts` is re-run and
 *      the change reviewed;
 *  (b) no row without a disposition and a reason (unexplained = 0);
 *  (c) every id in INTENTIONAL_AGENT_EXPOSED_TOOL_IDS has an active catalog descriptor
 *      with a handler (a bound, callable module#symbol), a validation strategy and at
 *      least one test file that mentions the id - a declaration is not coverage;
 *  (d) every action-registry record, every B17 control site, every route and every
 *      tool descriptor appears in at least one row;
 *  (e) `missing` only with a listed gap;
 *  (f) the disposition set is closed (exactly the nine of D.2) and every row's
 *      disposition is one of them.
 *
 * Nothing here names a tool id: other builders add tools concurrently and the
 * generator picks them up by re-running.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ACTION_COVERAGE_REGISTRY, API_ROUTE_COVERAGE } from "../action-registry";
import { INTENTIONAL_AGENT_EXPOSED_TOOL_IDS } from "../agent-exposure";
import { PARITY_DISPOSITIONS, PARITY_MATRIX_COLUMNS, parityMatrixIds, type ParityDisposition } from "../parity-matrix";
import { sirkitToolRegistry } from "../tool-catalog";
import { PR_D_COVERAGE_ARTIFACT_DIR, PR_D_COVERAGE_CSV, PR_D_COVERAGE_SUMMARY, generateCoverageMatrix, readTestEvidenceIndex } from "../../../../scripts/generate-pr-d-coverage-matrix";

const cwd = process.cwd();
const generated = generateCoverageMatrix(cwd);
const { rows, controls, summary } = generated;
const registry = sirkitToolRegistry();
const REGENERATE = "run: pnpm exec tsx scripts/generate-pr-d-coverage-matrix.ts";

/** The first two CSV fields of one line (quote-aware: a quoted field may hold commas and doubled quotes). */
function rowIdOf(line: string): string {
  const fields: string[] = [];
  let i = 0;
  while (fields.length < 2 && i <= line.length) {
    if (line[i] === '"') {
      let value = "";
      i += 1;
      while (i < line.length) {
        if (line[i] === '"') { if (line[i + 1] === '"') { value += '"'; i += 2; continue; } i += 1; break; }
        value += line[i]; i += 1;
      }
      fields.push(value); i += 1;
    } else {
      const end = line.indexOf(",", i);
      const stop = end === -1 ? line.length : end;
      fields.push(line.slice(i, stop)); i = stop + 1;
    }
  }
  return fields[1] ?? "";
}

describe("PR-D coverage matrix - (a) the committed artifacts equal the render (drift gate)", () => {
  it("the committed CSV byte-matches the regenerated matrix", () => {
    const committed = resolve(cwd, PR_D_COVERAGE_ARTIFACT_DIR, PR_D_COVERAGE_CSV);
    expect(existsSync(committed), REGENERATE).toBe(true);
    const text = readFileSync(committed, "utf8").replaceAll("\r\n", "\n");
    // One row per line (no cell holds a line break), so a drift can be named by row before the byte comparison
    // instead of as a megabyte diff.
    expect(generated.csv.split("\n").length - 2, "one CSV line per row").toBe(rows.length);
    const committedIds = new Set(text.split("\n").slice(1).filter(Boolean).map(rowIdOf));
    const renderedIds = new Set(rows.map((row) => row.rowId));
    expect([...renderedIds].filter((id) => !committedIds.has(id)), `rows missing from the committed CSV - ${REGENERATE}`).toEqual([]);
    expect([...committedIds].filter((id) => !renderedIds.has(id)), `stale rows in the committed CSV - ${REGENERATE}`).toEqual([]);
    expect(text === generated.csv, `the committed CSV differs from the render - ${REGENERATE}`).toBe(true);
  });

  it("the committed summary equals the regenerated summary; the render is LF-only, header-exact and byte-stable across two renders", () => {
    const committed = resolve(cwd, PR_D_COVERAGE_ARTIFACT_DIR, PR_D_COVERAGE_SUMMARY);
    expect(existsSync(committed), REGENERATE).toBe(true);
    expect(JSON.parse(readFileSync(committed, "utf8")), REGENERATE).toEqual(summary);
    expect(generated.csv.includes("\r")).toBe(false);
    expect(generated.summaryJson.includes("\r")).toBe(false);
    expect(generated.csv.split("\n")[0]).toBe(PARITY_MATRIX_COLUMNS.join(","));
    expect(generated.csv.endsWith("\n")).toBe(true);
    expect(/timestamp|generatedAt|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(generated.summaryJson)).toBe(false);
    const again = generateCoverageMatrix(cwd, controls);
    expect(again.csv).toBe(generated.csv);
    expect(again.summaryJson).toBe(generated.summaryJson);
  });
});

describe("PR-D coverage matrix - (b) and (f) every row is explained from the closed disposition set", () => {
  it("the disposition set is closed: exactly the nine of D.2, in the summary too", () => {
    expect([...PARITY_DISPOSITIONS]).toEqual(["callable-now", "proposal-only", "grant-required", "human-admin-only", "view-session-only", "intentionally-ui-only", "unavailable", "legacy", "missing"]);
    expect(Object.keys(summary.byDisposition).sort()).toEqual([...PARITY_DISPOSITIONS].sort());
    expect(summary.dispositions).toEqual([...PARITY_DISPOSITIONS]);
  });

  it("no row without a disposition in the set and a reason naming a registry fact; unexplained = 0", () => {
    const allowed = new Set<string>(PARITY_DISPOSITIONS);
    const unexplained = rows.filter((row) => !allowed.has(row.disposition) || row.reason.trim().length === 0).map((row) => `${row.rowKind} ${row.rowId}`);
    expect(unexplained).toEqual([]);
    expect(summary.unexplained).toBe(0);
    expect(summary.rows).toBe(rows.length);
    expect(rows.length).toBeGreaterThan(ACTION_COVERAGE_REGISTRY.length + controls.length);
    // Every reason names at least one registry module, function, list or field it was decided from.
    const FACT = /permissionTierOfAction|permissionTierOfDescriptor|TIER3_FLOOR_PATTERN|decideAgentExecution|authorization\.ts|AGENT_EXPOSABLE_OPERATION_CLASSES|INTENTIONAL_AGENT_EXPOSED_TOOL_IDS|GRANTED_EXECUTION_TOOLS|granted-execution-families|grantedExecutionViolations|NEVER_GRANTED_COMMAND_IDS|NEVER_EXPOSED_TOOL_PATTERNS|AUTONOMY_WRITE_ROLES|toolExposure|domainCommand|registry status|B17 control classification|lifecycle|binding|route-only|api-only|view record|authentication boundary|execution-grant|Tier [0-3]/;
    expect(rows.filter((row) => !FACT.test(row.reason)).map((row) => `${row.rowId}: ${row.reason}`)).toEqual([]);
  });

  it("(e) `missing` only with a listed gap, and every gap of a missing row names an absence", () => {
    const missing = rows.filter((row) => row.disposition === "missing");
    expect(missing.filter((row) => row.gaps.length === 0).map((row) => row.rowId)).toEqual([]);
    expect(summary.missing.rows).toBe(missing.length);
    expect(summary.missing.withoutGap).toBe(0);
    for (const row of missing) expect(row.gaps.some((gap) => /no (handler|tool|validation|test|AI path|route|agent-exposed|proposal)|status (missing|partial)|unknown record|forbids a grant/.test(gap)), `${row.rowId}: ${row.gaps.join(" | ")}`).toBe(true);
  });
});

describe("PR-D coverage matrix - (c) a claimed exposed operation has a handler, a validation and a test", () => {
  const tests = readTestEvidenceIndex(cwd, parityMatrixIds());

  it("every id in INTENTIONAL_AGENT_EXPOSED_TOOL_IDS has an active, callable, bound descriptor with a module#symbol handler", () => {
    for (const id of INTENTIONAL_AGENT_EXPOSED_TOOL_IDS) {
      const descriptor = registry.get(id);
      expect(descriptor, `${id}: no catalog descriptor`).toBeDefined();
      expect(descriptor!.lifecycle, id).toBe("active");
      expect(descriptor!.callability, id).toBe("callable");
      expect(descriptor!.binding.status, id).not.toBe("unbound");
      expect(descriptor!.binding.module, `${id}: handler module`).toBeTruthy();
      expect(descriptor!.binding.symbol, `${id}: handler symbol`).toBeTruthy();
      expect(registry.inspectBinding(id).state, id).toBe("bound");
    }
  });

  it("every intentional id declares a validation strategy (never n/a or empty)", () => {
    for (const id of INTENTIONAL_AGENT_EXPOSED_TOOL_IDS) {
      const validation = registry.get(id)?.validationStrategy ?? "";
      expect(validation.trim().length, id).toBeGreaterThan(0);
      expect(/^n\/a/i.test(validation.trim()), `${id}: validation is n/a`).toBe(false);
    }
  });

  it("every intentional id is mentioned by at least one test file under app/**/__tests__ or e2e/** (file presence), and its tool row says so", () => {
    const untested = INTENTIONAL_AGENT_EXPOSED_TOOL_IDS.filter((id) => tests.directoriesMentioning(id).length === 0);
    expect(untested, "an exposed tool without a test file that mentions its id").toEqual([]);
    for (const id of INTENTIONAL_AGENT_EXPOSED_TOOL_IDS) {
      const row = rows.find((candidate) => candidate.rowKind === "tool" && candidate.rowId.startsWith(`${id}@`));
      expect(row, id).toBeDefined();
      expect(row!.tests.length, `${id}: tests column`).toBeGreaterThan(0);
      expect(["callable-now", "proposal-only", "grant-required", "view-session-only"], `${id}: an exposed tool's disposition`).toContain(row!.disposition);
    }
  });

  it("no exposed tool row is unavailable, missing or legacy; no unexposed tool row claims an agent disposition", () => {
    const exposedIds = new Set(registry.list().filter((descriptor) => descriptor.agentExposed).map((descriptor) => descriptor.toolId));
    const agentDispositions: readonly ParityDisposition[] = ["callable-now", "proposal-only", "grant-required", "view-session-only"];
    for (const row of rows.filter((candidate) => candidate.rowKind === "tool")) {
      const id = row.rowId.replace(/@.*$/, "");
      if (exposedIds.has(id)) expect(agentDispositions, row.rowId).toContain(row.disposition);
      else expect(agentDispositions, `${row.rowId} is not agent-exposed yet claims ${row.disposition}`).not.toContain(row.disposition);
    }
  });
});

describe("PR-D coverage matrix - (d) every record, control, route and tool appears", () => {
  it("every action-registry record has exactly one action row", () => {
    const actionIds = rows.filter((row) => row.rowKind === "action").map((row) => row.rowId);
    expect([...actionIds].sort()).toEqual(ACTION_COVERAGE_REGISTRY.map((record) => record.id).sort());
    expect(summary.actions).toEqual({ records: ACTION_COVERAGE_REGISTRY.length, rows: ACTION_COVERAGE_REGISTRY.length });
  });

  it("every B17 control site appears in at least one control row, and every control row is a scanned site", () => {
    expect(controls.length).toBeGreaterThan(400); // the inventory is the whole application, never a sample
    const controlRows = rows.filter((row) => row.rowKind === "control");
    const keys = new Set(controls.map((control) => control.key));
    const rowKeys = new Set(controlRows.map((row) => row.rowId.replace(/->[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/, "")));
    expect([...keys].filter((key) => !rowKeys.has(key)), "control sites without a row").toEqual([]);
    expect([...rowKeys].filter((key) => !keys.has(key)), "control rows without a scanned site").toEqual([]);
    // A semantic/dispatcher site has one row per record it reaches; a view/internal/unavailable site without a record has one row.
    for (const control of controls) {
      const own = controlRows.filter((row) => row.rowId === control.key || row.rowId.startsWith(`${control.key}->`));
      expect(own.length, control.key).toBe(Math.max(1, new Set(control.recordIds).size));
      if (control.recordIds.length === 0) expect(["intentionally-ui-only", "unavailable"], control.key).toContain(own[0]!.disposition);
      else for (const row of own) expect(row.disposition, row.rowId).toBe(rows.find((action) => action.rowKind === "action" && action.rowId === row.rowId.replace(/^.*->/, ""))!.disposition);
    }
    expect(summary.controls.sites).toBe(controls.length);
    expect(summary.controls.rows).toBe(controlRows.length);
  });

  it("every API route appears in its record's invocation path; every tool descriptor has exactly one tool row", () => {
    const actionRows = new Map(rows.filter((row) => row.rowKind === "action").map((row) => [row.rowId, row] as const));
    for (const route of API_ROUTE_COVERAGE) expect(actionRows.get(route.recordId)?.invocationPath ?? "", `${route.path} -> ${route.recordId}`).toContain(` ${route.path}`);
    const toolIds = rows.filter((row) => row.rowKind === "tool").map((row) => row.rowId).sort();
    expect(toolIds).toEqual(registry.list().map((descriptor) => `${descriptor.toolId}@${descriptor.version}`).sort());
    expect(summary.tools.descriptors).toBe(registry.list().length);
    expect(summary.tools.agentExposed).toBe(registry.list().filter((descriptor) => descriptor.agentExposed).length);
  });

  it("the rows are in a stable order: action, control, tool, each by code point", () => {
    const rank = { action: 0, control: 1, tool: 2 } as const;
    for (let i = 1; i < rows.length; i += 1) {
      const a = rows[i - 1]!, b = rows[i]!;
      expect(rank[a.rowKind] < rank[b.rowKind] || (a.rowKind === b.rowKind && a.rowId < b.rowId), `${a.rowId} before ${b.rowId}`).toBe(true);
    }
  });
});
