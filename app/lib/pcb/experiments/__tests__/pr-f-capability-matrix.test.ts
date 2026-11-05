/**
 * [PR-F] The routing capability matrix gates (the owner's Astra directive, section 10):
 *
 *  (a) DRIFT: the matrix regenerated in memory from the current tree byte-matches the committed CSV and summary; the render is LF-only,
 *      header-exact, clock-free and byte-stable across two renders;
 *  (b) DERIVED: no resolution problem; every cell cites at least one existing file:line and the cited line holds the anchor it was
 *      resolved from; every named kind is a member of ConstraintKind / RelationshipKind; the compiler's support entry per kind is the
 *      compiler's own line;
 *  (c) HONEST: every `unsupported` cell and every row with an unsupported stage carries a reason; the verdict and status sets are closed;
 *  (d) DIRECTIVE 10: differential coupling, skew, impedance, return paths and the per-net via policy are `unsupported` at the routing
 *      stage (FreeRouting is not assumed to enforce them), and impedance / return paths / differential coupling / routed analog separation
 *      / keepouts are `unsupported` verdicts (nothing proves them on autorouted copper - recorded, never relabelled).
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CONSTRAINT_COMPILER, CONSTRAINT_TYPES, DIRECTIVE_10_EXPECTED_UNSUPPORTED_ROUTING, ROUTING_CAPABILITY_COLUMNS, ROUTING_CAPABILITY_ROWS, ROUTING_CAPABILITY_STAGES, ROUTING_CAPABILITY_STATUSES, ROUTING_CAPABILITY_VERDICTS, anchorLine, compilerSupportTable, routingCapabilityVerdict, unionMembers } from "../routing-capability-matrix";
import { PR_F_ROUTING_MATRIX_CSV, PR_F_ROUTING_MATRIX_DIR, PR_F_ROUTING_MATRIX_SUMMARY, generateRoutingCapabilityMatrix, readRepoFile } from "../../../../../scripts/generate-pr-f-routing-capability-matrix";

const cwd = process.cwd();
const generated = generateRoutingCapabilityMatrix(cwd);
const { rows, problems } = generated.resolved;
const REGENERATE = "run: pnpm exec tsx scripts/generate-pr-f-routing-capability-matrix.ts";
/** The committed outputs, named by repository path (the B24-F generator inventory reads these literals). */
const COMMITTED_CSV = "artifacts/product-reliability-simple-ui/astra/routing-capability-matrix.csv";
const COMMITTED_SUMMARY = "artifacts/product-reliability-simple-ui/astra/routing-capability-matrix-summary.json";

describe("PR-F routing capability matrix - (a) the committed artifacts equal the render (drift gate)", () => {
  it("the committed CSV byte-matches the regenerated matrix", () => {
    expect(COMMITTED_CSV).toBe(`${PR_F_ROUTING_MATRIX_DIR}/${PR_F_ROUTING_MATRIX_CSV}`);
    const committed = resolve(cwd, COMMITTED_CSV);
    expect(existsSync(committed), REGENERATE).toBe(true);
    const text = readFileSync(committed, "utf8").replaceAll("\r\n", "\n");
    expect(generated.csv.split("\n").length - 2, "one CSV line per row").toBe(rows.length);
    expect(text, `the committed CSV differs from the render - ${REGENERATE}`).toBe(generated.csv);
  });

  it("the committed summary equals the regenerated summary; the render is LF-only, header-exact, clock-free and byte-stable", () => {
    expect(COMMITTED_SUMMARY).toBe(`${PR_F_ROUTING_MATRIX_DIR}/${PR_F_ROUTING_MATRIX_SUMMARY}`);
    const committed = resolve(cwd, COMMITTED_SUMMARY);
    expect(existsSync(committed), REGENERATE).toBe(true);
    expect(JSON.parse(readFileSync(committed, "utf8")), REGENERATE).toEqual(generated.summary);
    expect(generated.csv.includes("\r")).toBe(false);
    expect(generated.summaryJson.includes("\r")).toBe(false);
    expect(generated.csv.split("\n")[0]).toBe(ROUTING_CAPABILITY_COLUMNS.join(","));
    expect(generated.csv.endsWith("\n")).toBe(true);
    expect(/timestamp|generatedAt|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(generated.summaryJson)).toBe(false);
    const again = generateRoutingCapabilityMatrix(cwd);
    expect(again.csv).toBe(generated.csv);
    expect(again.summaryJson).toBe(generated.summaryJson);
  });
});

describe("PR-F routing capability matrix - (b) every cell is derived from an existing file:line", () => {
  it("no resolution problem; the row set is the definition's, with unique ids", () => {
    expect(problems).toEqual([]);
    expect(rows.map((row) => row.id)).toEqual(ROUTING_CAPABILITY_ROWS.map((row) => row.id));
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
    expect(rows.length).toBeGreaterThanOrEqual(16);
  });

  it("every cell cites at least one file:line that exists, and the cited line holds the anchor it was resolved from", () => {
    const misses: string[] = [];
    for (const row of rows) for (const stage of ROUTING_CAPABILITY_STAGES) {
      const cell = row.cells[stage];
      if (cell.citations.length === 0) misses.push(`${row.id}.${stage}: no citation`);
      for (const citation of cell.citations) {
        const text = readRepoFile(cwd, citation.file);
        if (text === null) { misses.push(`${row.id}.${stage}: ${citation.file} missing`); continue; }
        const line = text.split("\n")[citation.line - 1];
        if (citation.line < 1 || line === undefined || !line.includes(citation.anchor)) misses.push(`${row.id}.${stage}: ${citation.file}:${citation.line} does not hold ${JSON.stringify(citation.anchor)}`);
      }
    }
    expect(misses).toEqual([]);
    expect(generated.summary.citations).toBe(rows.reduce((sum, row) => sum + ROUTING_CAPABILITY_STAGES.reduce((inner, stage) => inner + row.cells[stage].citations.length, 0) + row.compilerSupport.length, 0));
  });

  it("every named kind is a ConstraintKind or RelationshipKind of the constraints schema, and each compiler-support entry is the compiler's own line", () => {
    const types = readRepoFile(cwd, CONSTRAINT_TYPES)!;
    const compiler = readRepoFile(cwd, CONSTRAINT_COMPILER)!;
    const constraintKinds = unionMembers(types, "ConstraintKind");
    const relationshipKinds = unionMembers(types, "RelationshipKind");
    expect(constraintKinds.size).toBeGreaterThan(40);
    expect(relationshipKinds.size).toBeGreaterThan(8);
    const table = compilerSupportTable(compiler);
    expect(table.get("target_impedance")?.support).toBe("unsupported");
    expect(table.get("pair_skew")?.support).toBe("enforced");
    expect(table.has("return_reference")).toBe(false);
    for (const row of rows) {
      expect(row.kinds.length).toBeGreaterThan(0);
      for (const kind of row.kinds) expect(constraintKinds.has(kind) || relationshipKinds.has(kind), `${row.id}: ${kind}`).toBe(true);
      expect(row.compilerSupport.map((entry) => entry.kind)).toEqual([...row.kinds]);
      for (const entry of row.compilerSupport) {
        const line = compiler.split("\n")[entry.citation.line - 1] ?? "";
        expect(line.includes(entry.citation.anchor), `${row.id}: ${entry.kind} -> ${CONSTRAINT_COMPILER}:${entry.citation.line}`).toBe(true);
        if (constraintKinds.has(entry.kind) && table.has(entry.kind)) expect(entry.support).toBe(table.get(entry.kind)!.support);
        if (constraintKinds.has(entry.kind) && !table.has(entry.kind)) expect(entry.support).toBe("unsupported");
      }
    }
    expect(anchorLine("a\nb\nc", "b")).toBe(2);
    expect(anchorLine("a\nb", "zzz")).toBeNull();
  });
});

describe("PR-F routing capability matrix - (c) honest statuses, closed sets, reasons", () => {
  it("the status and verdict sets are closed and every row's verdict follows the declared rule", () => {
    expect([...ROUTING_CAPABILITY_STATUSES]).toEqual(["exact", "conservative", "advisory", "post_route_check", "not_applicable", "unsupported"]);
    expect([...ROUTING_CAPABILITY_VERDICTS]).toEqual(["survives", "survives-conservatively", "placement-only", "check-only", "advisory-only", "scope-only", "unsupported"]);
    for (const row of rows) {
      expect(ROUTING_CAPABILITY_VERDICTS as readonly string[]).toContain(row.verdict);
      expect(row.verdict).toBe(routingCapabilityVerdict(row.cells));
      for (const stage of ROUTING_CAPABILITY_STAGES) expect(ROUTING_CAPABILITY_STATUSES as readonly string[]).toContain(row.cells[stage].status);
    }
    expect(Object.keys(generated.summary.byVerdict).sort()).toEqual([...ROUTING_CAPABILITY_VERDICTS].sort());
    expect(Object.values(generated.summary.byVerdict).reduce((sum, count) => sum + count, 0)).toBe(rows.length);
    expect(generated.summary.unsupportedRows).toEqual(rows.filter((row) => row.verdict === "unsupported").map((row) => row.id));
  });

  it("every unsupported cell and every row with an unsupported stage carries a reason", () => {
    for (const row of rows) {
      let unsupported = false;
      for (const stage of ROUTING_CAPABILITY_STAGES) {
        const cell = row.cells[stage];
        if (cell.status === "unsupported") { unsupported = true; expect(cell.reason.trim().length, `${row.id}.${stage}`).toBeGreaterThanOrEqual(20); }
      }
      if (unsupported || row.verdict === "unsupported") expect(row.reason.trim().length, row.id).toBeGreaterThanOrEqual(20);
    }
  });

  it("(d) directive 10: FreeRouting is not assumed to enforce differential coupling, skew, impedance, return paths or per-net via rules; what nothing proves on autorouted copper stays `unsupported`", () => {
    expect([...DIRECTIVE_10_EXPECTED_UNSUPPORTED_ROUTING]).toEqual(["differential-coupling-separation", "differential-skew", "impedance", "return-paths", "via-policy-per-net"]);
    for (const id of DIRECTIVE_10_EXPECTED_UNSUPPORTED_ROUTING) expect(rows.find((row) => row.id === id)?.cells.routing.status, id).toBe("unsupported");
    expect(generated.summary.directive10.map((entry) => [entry.id, entry.routing])).toEqual(DIRECTIVE_10_EXPECTED_UNSUPPORTED_ROUTING.map((id) => [id, "unsupported"]));
    // [PR-F, 2026-10-17] the findings as read from the tree on this date: no code carries or checks these on routed copper
    expect(generated.summary.unsupportedRows).toEqual(["keepouts", "sensitive-analog-routing-separation", "return-paths", "differential-coupling-separation", "impedance"]);
    // skew and the per-net via / layer policies are measured AFTER import (check-only): found, never obeyed during routing
    for (const id of ["differential-skew", "via-policy-per-net", "layer-policy-per-net"]) expect(rows.find((row) => row.id === id)?.verdict, id).toBe("check-only");
    // what survives: connectivity, the class rules, the board-wide via policy, the stackup roles
    for (const id of ["connectivity-conservation", "via-policy-board", "stackup-layer-roles"]) expect(rows.find((row) => row.id === id)?.verdict, id).toBe("survives");
    expect(rows.find((row) => row.id === "net-class-width-clearance")?.verdict).toBe("survives-conservatively");
    expect(rows.find((row) => row.id === "mechanical-envelope")?.verdict).toBe("survives-conservatively");
    for (const id of ["decoupling-proximity", "sensitive-analog-separation-placement", "connectors"]) expect(rows.find((row) => row.id === id)?.verdict, id).toBe("placement-only");
    expect(rows.find((row) => row.id === "switching-loops")?.verdict).toBe("advisory-only");
    expect(rows.find((row) => row.id === "critical-net-priority")?.verdict).toBe("scope-only");
  });
});
