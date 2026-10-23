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
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const ROOTS = ["app", "lib", "components"] as const;
// [PR-J1 integration, 2026-10-22] J1-CONS-5: + the two wrappers, and any whitespace before the parenthesis (was the two names, "(" adjacent)
const UNION_CALLERS = "buildNetUnionFind|findConnectedGroup|classifyNets|findNetRoot";
const CALL = new RegExp(`\\b(${UNION_CALLERS})\\s*\\(`, "g");
const DEFINITION = new RegExp(`export function (${UNION_CALLERS})\\s*\\(`, "g");
/** An import that renames one of them (`import { classifyNets as colour }`): its calls would escape the count. */
const ALIASED = new RegExp(`\\b(${UNION_CALLERS})\\s+as\\s+[A-Za-z_$]`);

/** The call sites a file's text holds (its own definitions excluded), and whether it renames one of the functions on import. */
function unionCallSites(text: string): { calls: number; aliased: boolean } {
  const body = text.replace(DEFINITION, "");
  return { calls: [...body.matchAll(CALL)].length, aliased: ALIASED.test(body) };
}

/** file -> number of call sites, and why each file may call the coordinate-only union. */
const CLASSIFIED: Record<string, { calls: number; why: string }> = {
  "app/lib/schematic/project-connectivity.ts": { calls: 1, why: "the authority itself: the single-sheet branch only (a multi-sheet document takes the scoped union)" },
  "app/lib/connectivity.ts": { calls: 1, why: "findNetRoot, a legacy single-sheet helper over the arrays it is given" },
  // [PR-J, 2026-10-22] J2: was 2 calls, "UNMIGRATED whole-project consumer (netlist validation)"; validateSchematicNetlist moved onto the authority
  "lib/validate-netlist.ts": { calls: 1, why: "validateTheoryNetlist only: a freshly laid-out Theory generation (one page by construction); it refuses a document with sheets (SHEET_HIERARCHY_UNSUPPORTED)" },
  // [PR-J, 2026-10-22] J2: guarded, not yet migrated (was "refused or migrated in increment 2")
  "app/lib/netlist.ts": { calls: 1, why: "SPICE /api/simulate deck: a document with sheets is refused before the union (SIM_MULTI_SHEET_PENDING) until the SPICE export reads the project connectivity" },
  "app/lib/spice/ir.ts": { calls: 1, why: "SPICE IR /api/spice/compile: a document with sheets is refused before the union (SIM_MULTI_SHEET_PENDING) until the IR reads the project connectivity" },
  "app/lib/nets.ts": { calls: 1, why: "editor net colouring over the visible arrays (increment 3 passes a sheet lens)" },
  // [PR-J1 integration, 2026-10-22] J1-CONS-5 pin move: was 2 calls (the drag-group gestures); the net-colouring memo's classifyNets is now counted
  "app/page.tsx": { calls: 3, why: "editor drag-group gestures (findConnectedGroup x2) and the net-colouring memo (classifyNets) over the visible arrays (increment 3 passes a sheet lens)" },
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
