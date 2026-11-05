/**
 * [PR-J, 2026-10-22] Runbook section J increment 1 (J.4: "use the existing canonical connectivity authority, extended for sheet
 * scope, instead of a second inconsistent checker"): a RATCHET on the coordinate-only union. `buildNetUnionFind` and
 * `findConnectedGroup` (app/lib/connectivity.ts) key points by bare "x,y" and join same-named labels across the whole state, so
 * handed a multi-sheet document they would short identical coordinates and local labels on different sheets together. Every call
 * site is listed here with its classification; a NEW call site fails this suite until it is classified - it must either take a
 * single-sheet input (a sheet lens, or a document checked with isSingleSheet) or use resolveProjectConnectivity instead.
 * Section J increment 2 moves the whole-project consumers onto the authority and updates this list (a dated note per change).
 *
 * [PR-J, 2026-10-22] J2 pin move: the PCB netlist / publication (app/lib/pcb/netlist-bridge.ts), the ERC's logical netlist
 * (lib/schematic-to-netlist.ts), the drawn-netlist validation (lib/validate-netlist.ts validateSchematicNetlist), the AI review input
 * (lib/netlist-review.ts) and the agent-delete check (app/lib/engineering/agent-delete-connectivity.ts) now read
 * resolveProjectConnectivity and left this list (their single-sheet outputs are pinned byte for byte in j2-consumers-golden.test.ts);
 * validate-netlist keeps ONE call (the Theory generation validator, which refuses a document with sheets), and the two SPICE compilers
 * keep theirs behind an explicit refusal of a document with sheets (SIM_MULTI_SHEET_PENDING) until they move onto the authority.
 *
 * [PR-J1 integration, 2026-10-22] review J1-CONS-5: the ratchet now also counts the two exported WRAPPERS that run the coordinate-only
 * union over whatever arrays they are handed (`classifyNets`, app/lib/nets.ts; `findNetRoot`, app/lib/connectivity.ts), accepts
 * whitespace before the parenthesis, and refuses an aliased import of any of the four (an alias would hide every call from the count).
 * Pin move: app/page.tsx 2 -> 3 (its net-colouring memo calls classifyNets with the whole state's arrays); every other count holds.
 * [PR-J3, 2026-10-22] + app/lib/schematic/sheet-lens.ts (1): the Sheets navigator's connected-group selection over one sheet's entities.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const ROOTS = ["app", "lib", "components"] as const;
// [PR-J1 integration, 2026-10-22] J1-CONS-5: + the two wrappers, and any whitespace before the parenthesis (was the two names, "(" adjacent)
const UNION_CALLERS = "buildNetUnionFind|findConnectedGroup|classifyNets|findNetRoot";
const CALL = new RegExp(`\\b(${UNION_CALLERS})\\s*\\(`, "g");
const DEFINITION = new RegExp(`export function (${UNION_CALLERS})\\s*\\(`, "g");
/** An import / export clause that renames one of them (`import { classifyNets as colour }`, `export { findNetRoot as root } from`):
 *  its calls would escape the count. [PR-J1 review, 2026-10-22] R2-4: anchored to the clause ([^}] spans a multi-line list), so the
 *  English "classifyNets as the ..." in a comment is not an alias. */
const ALIASED = new RegExp(`\\b(?:import|export)\\b[^;]*?\\{[^}]*\\b(${UNION_CALLERS})\\s+as\\s+[A-Za-z_$]`);
/** [PR-J1 review, 2026-10-22] R2-4: block and line comments are stripped before matching, so prose ("classifyNets (app/lib/nets.ts)")
 *  is never a call site. A "//" right after ":" (a URL inside a string) is not a comment; any other "//" inside a string literal on a
 *  call's line would hide that call - acceptable for a ratchet. */
const COMMENTS = [/\/\*[\s\S]*?\*\//g, /(?<!:)\/\/.*$/gm] as const;

/** The call sites a file's text holds (comments and its own definitions excluded), and whether it renames one of the functions on import. */
function unionCallSites(text: string): { calls: number; aliased: boolean } {
  const body = COMMENTS.reduce<string>((acc, comment) => acc.replace(comment, ""), text).replace(DEFINITION, "");
  return { calls: [...body.matchAll(CALL)].length, aliased: ALIASED.test(body) };
}

/** file -> number of call sites, and why each file may call the coordinate-only union. */
const CLASSIFIED: Record<string, { calls: number; why: string }> = {
  "app/lib/schematic/project-connectivity.ts": { calls: 1, why: "the authority itself: the single-sheet branch only (a multi-sheet document takes the scoped union)" },
  "app/lib/connectivity.ts": { calls: 1, why: "findNetRoot, a legacy single-sheet helper over the arrays it is given" },
  // [PR-J, 2026-10-22] J2: was 2 calls, "UNMIGRATED whole-project consumer (netlist validation)"; validateSchematicNetlist moved onto the authority
  "lib/validate-netlist.ts": { calls: 1, why: "validateTheoryNetlist only: a freshly laid-out Theory generation (one page by construction); it refuses a document with sheets (SHEET_HIERARCHY_UNSUPPORTED)" },
  // [PR-J, 2026-10-22] J2: guarded, not yet migrated (was "refused or migrated in increment 2"); [PR-J4, 2026-10-23] MIGRATED (OD-258 item 1): both
  // compilers branch BEFORE their legacy body - a document with sheets (or with sheet references and no tree) takes the project-connectivity
  // stage (app/lib/spice/project-nodes.ts, resolveProjectConnectivity) and never reaches the union; the one call left in each file is the
  // single-sheet stage, whose output is pinned byte for byte (j1-sheet-operations spiceSha; j4-ir-sheets)
  "app/lib/netlist.ts": { calls: 1, why: "SPICE /api/simulate deck: the legacy single-sheet body only (byte-pinned); a document with sheets is built on resolveProjectConnectivity before this call (schematicToSpiceOnProjectConnectivity)" },
  "app/lib/spice/ir.ts": { calls: 1, why: "SPICE IR /api/spice/compile: the legacy single-sheet stage only (legacyIrConnectivity, output pinned); a document with sheets takes sheetedIrConnectivity on resolveProjectConnectivity before this call" },
  "app/lib/nets.ts": { calls: 1, why: "editor net colouring over the visible arrays (increment 3 passes a sheet lens)" },
  // [PR-J1 integration, 2026-10-22] J1-CONS-5 pin move: was 2 calls (the drag-group gestures); the net-colouring memo's classifyNets is now counted
  "app/page.tsx": { calls: 3, why: "editor drag-group gestures (findConnectedGroup x2) and the net-colouring memo (classifyNets) over the visible arrays - since [PR-J3, 2026-10-22] the ACTIVE sheet's plain lens arrays (useSchematicSheetLens; a single-sheet document is the same arrays)" },
  // [PR-J3, 2026-10-22] pin move (runbook J.3 item 3, OD-257 item 1): + the sheet lens's connected-group selection for Move to sheet - sheet-aware by
  // construction (it runs over ONE sheet's own entities, projectSheet, so a same-named label on another sheet never joins); the whole-project
  // partition stays resolveProjectConnectivity's
  "app/lib/schematic/sheet-lens.ts": { calls: 1, why: "connectedSelection: the drag-group union over the active sheet's own entities only (Move to sheet's 'connected group' option); project-wide nets come from resolveProjectConnectivity" },
  // [PR-J, 2026-10-22] J2: removed (moved onto resolveProjectConnectivity): app/lib/pcb/netlist-bridge.ts (1), lib/schematic-to-netlist.ts (1),
  // lib/netlist-review.ts (1), app/lib/engineering/agent-delete-connectivity.ts (2)
};

function sourceFiles(dir: string, out: string[]): void {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return; }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".next" || entry === "__tests__") continue;
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
}

describe("[PR-J J1] the coordinate-only union has exactly the classified callers", () => {
  it("every call site of buildNetUnionFind / findConnectedGroup is classified (a new one must be sheet-aware or guarded)", () => {
    const cwd = process.cwd();
    const files: string[] = [];
    for (const root of ROOTS) sourceFiles(join(cwd, root), files);
    const found: Record<string, number> = {};
    for (const file of files) {
      const { calls, aliased } = unionCallSites(readFileSync(file, "utf8"));
      const name = relative(cwd, file).split(sep).join("/");
      expect(aliased, `${name} imports a coordinate-union function under another name`).toBe(false);
      if (calls > 0) found[name] = calls;
    }
    expect(found).toEqual(Object.fromEntries(Object.entries(CLASSIFIED).map(([file, entry]) => [file, entry.calls])));
    for (const entry of Object.values(CLASSIFIED)) expect(entry.why.length).toBeGreaterThan(20);
  });
});

describe("[PR-J1 integration, 2026-10-22] J1-CONS-5: the ratchet sees the wrappers and every spelling", () => {
  it("counts classifyNets / findNetRoot calls and whitespace before the parenthesis; excludes the definitions; flags an alias", () => {
    expect(unionCallSites("const nets = classifyNets(state.components, state.wires, [], getPart, state.netLabels);")).toEqual({ calls: 1, aliased: false });
    expect(unionCallSites("const root = findNetRoot (point, state.components, state.wires);")).toEqual({ calls: 1, aliased: false });
    expect(unionCallSites("const uf = buildNetUnionFind\n  (components, wires);")).toEqual({ calls: 1, aliased: false });
    expect(unionCallSites("export function findNetRoot(point: Point) { return buildNetUnionFind([], []); }")).toEqual({ calls: 1, aliased: false });
    expect(unionCallSites('import { classifyNets as colourNets } from "./lib/nets";').aliased).toBe(true);
    expect(unionCallSites('import { buildNetUnionFind, UnionFind } from "@/app/lib/connectivity";')).toEqual({ calls: 0, aliased: false });
  });
});

describe("[PR-J1 review, 2026-10-22] R2-4: prose in a comment is neither a call site nor an alias", () => {
  it("a line or block comment that mentions a function (even 'X (path)' or 'X as the ...') counts nothing; a call before a trailing comment still counts", () => {
    expect(unionCallSites("// the colours come from classifyNets (app/lib/nets.ts) once per render")).toEqual({ calls: 0, aliased: false });
    expect(unionCallSites("// we treat classifyNets as the single source of net colours")).toEqual({ calls: 0, aliased: false });
    expect(unionCallSites("/* findConnectedGroup (the drag gesture) runs classifyNets as a memo\n   over the lens */\nconst nets = 1;")).toEqual({ calls: 0, aliased: false });
    expect(unionCallSites("const nets = classifyNets(state.components, state.wires); // classifyNets (app/lib/nets.ts), once per render")).toEqual({ calls: 1, aliased: false });
    expect(unionCallSites('const url = "https://example.test/x"; const root = findNetRoot(point, components, wires);')).toEqual({ calls: 1, aliased: false });
  });

  it("only an import / export clause that renames one of the four is an alias; a TypeScript `as` elsewhere is not", () => {
    expect(unionCallSites('import { classifyNets as colourNets } from "./lib/nets";').aliased).toBe(true);
    expect(unionCallSites('import {\n  buildNetUnionFind,\n  findNetRoot as rootOf,\n} from "@/app/lib/connectivity";').aliased).toBe(true);
    expect(unionCallSites('import type { UnionFind } from "@/app/lib/connectivity";\nexport { findConnectedGroup as group } from "@/app/lib/connectivity";').aliased).toBe(true);
    expect(unionCallSites('import { buildNetUnionFind, UnionFind } from "@/app/lib/connectivity";\nconst text = value as string;')).toEqual({ calls: 0, aliased: false });
  });
});
