/**
 * [PR-J, 2026-10-22] Runbook section J increment 1 (J.3 items 1, 3, 7; J.5; J.8 items 1-3; J.9; OD-255 items 1, 4, 8): the canonical
 * sheet model and operations.
 *
 *  1. GOLDEN byte identity of single-sheet documents (the fixture blinker, the fixture drone, a Theory design): the canonical schematic
 *     stays sirkit.schematic.v1 and every digest / byte output pinned here was computed at 5bf1e599, BEFORE the sheet contract existed:
 *     the canonical digest and JSON, the PCB netlist and its hash, the publication source digest, the KiCad and SPICE exports.
 *  2. The v2 model: written only with a sheet tree, round-trips exactly, and the validator refuses inconsistent documents.
 *  3. Every sheet operation has an EXACT inverse (digest-identical), deleting the last child sheet restores the v1 document and its
 *     original digest, and the refusals (populated sheet, port in use, precondition, rail / isolation joins) change nothing.
 *  4. The executor binds the two commands; the graph diff refuses sheet membership / scope changes.
 *  5. Moving a connected subsystem of the fixture drone to new sheets preserves the pin-to-net partition, BOM groups, physical
 *     identities and footprint count; the canonical session executes it as one transaction and undo / redo replay exactly.
 * Pure / in-memory: no network, no database, no randomness.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { kicadPinWorldPos, pinWorldPos, pointKey } from "@/app/lib/geometry";
import { exportToKicadSch } from "@/app/lib/kicad-export";
import { schematicToSpice } from "@/app/lib/netlist";
import { buildNetlist, buildPcbSyncPublicationGraph, netlistHash, type NetlistPartData } from "@/app/lib/pcb/netlist-bridge";
import { resolveProjectConnectivity } from "@/app/lib/schematic/project-connectivity";
import { createSheetOperation, planMoveToSheet, type MoveEntityRef } from "@/app/lib/schematic/sheet-operations";
import { ROOT_SHEET_ID, type NetLabel, type SchComponent, type SchematicState } from "@/lib/schematic-types";
import { blinkerFixtureState, droneFixtureState, fixturePartLookup, fixtureParts, theoryLegacyFixture } from "../../schematic/__tests__/_j1-fixtures";
import { ACTION_COVERAGE_REGISTRY, validateActionCoverageRegistry, type ActionCoverageRecord } from "../action-registry";
import { CanonicalExecutor, KERNEL_OPERATION_BINDINGS, resolveExecutorContract } from "../executor";
import { createEditorSessionChannel } from "../interactive-channel.internal";
import { createEmptyBoard } from "../../pcb/types";
import { EngineeringTransactionService } from "../transaction-service";
import { applySchematicOperationsToCanonical, SHEET_OPERATION_KINDS } from "../operations";
import { permissionTierOfAction } from "../permission-tiers";
import { InMemoryAtomicProjectStore } from "../persistence";
import { diffSchematicGraphOps } from "../schematic-graph";
import { CANONICAL_SCHEMATIC_SCHEMA, CANONICAL_SCHEMATIC_SCHEMA_V2, fromCanonicalSchematic, parseCanonicalSchematic, schematicSemanticDigest, schematicStateDigest, toCanonicalSchematic, validateCanonicalSchematic, type CanonicalSchematic } from "../schematic-model";
import { SchematicEditorSession } from "../schematic-session";
import { declaredScopeForOperations } from "../transaction-service";
import type { CanonicalProjectState, EngineeringActor, EngineeringOperation } from "../types";

const sha = (text: string): string => createHash("sha256").update(text).digest("hex");
const PX = { schemaVersion: 1 as const, units: "px" as const };

// ── 1. golden byte identity (pinned at 5bf1e599, before section J) ───────────────────────────────────────────────────────────

const GOLDEN = {
  blinker: { stateDigest: "eng1-4bda06f6c086cf99", canonicalSha: "cb3a6bbef6ad8777305c50bd2653c3b65080c859083b0975ad67378c8623da79", netlistSha: "0a7ee14d0075c6236f4cab81727990996b6d77c27918bf0c88b951497cbc0d7d", netlistHash: "1doq5yp", publicationSourceDigest: "pb1-7642e1298827e8de1b859ad6329912a64127ea51e332fc55aad32856349bd768", kicadSha: "ef6e212628d49835864c6155e3d79ebda11ac22b5cf0e70b1c46330ab32afee8", spiceSha: "d63b72bae8939c55df65859df0c879eeb262d2442d82c7f294d083abdce77227" },
  drone: { stateDigest: "eng1-66f025a6dde8f8c3", canonicalSha: "3a2623251688fceb89b65e5077ade94680b8bc3cb158394f0fb67ef5c345ac70", netlistSha: "55bf26f29223318903143d9e8207f0953988ec1d535e8c1a098224f1dbb6c2c1", netlistHash: "1q8sbo0", publicationSourceDigest: "pb1-883659da1f6412a3d92f0ab23ad07a03a7e6405473a884b682ac0d38b41205d6", kicadSha: "1a98f1d331f42bbb2a378a64dc19dfecb44e134b3b9ca1d1cbf414fc6206f94d", spiceSha: "d63b72bae8939c55df65859df0c879eeb262d2442d82c7f294d083abdce77227" },
  theory: { stateDigest: "eng1-5dd93bc732d32fde", canonicalSha: "da9559678c8475bc8aa740c4146e49c730f42c3bcb164f91e27979bc29506ffb", netlistSha: "3e6e2d53303775d02c4a58fdd888a80241c7b193dd196ebe11b5fcf114c16894", netlistHash: "c9w17x", publicationSourceDigest: "pb1-69104bfd3cd8950edb43176da3d79261e40d0dc2b59200af4f1844391a1247a4", kicadSha: "48bcfd6d7df1191fbc8cc2f8aeb792405bd751b262f42027bb18c7402acb82ae", spiceSha: "17ffd2d3f6d45366a52a56e5c7a598dbe8e8d9efa02f954b89407e7a7a1b44b7" },
} as const;
const FIXTURES: Array<[keyof typeof GOLDEN, () => SchematicState]> = [["blinker", blinkerFixtureState], ["drone", droneFixtureState], ["theory", theoryLegacyFixture]];

describe("[PR-J J1] 1. a single-sheet document keeps every digest and export byte-identical (golden, pinned before section J)", () => {
  it.each(FIXTURES)("%s: canonical v1 digest and JSON, PCB netlist, publication digest, KiCad and SPICE bytes", (name, make) => {
    const state = make();
    const lookup = fixturePartLookup();
    const canonical = toCanonicalSchematic(state);
    expect(canonical.schemaVersion).toBe(CANONICAL_SCHEMATIC_SCHEMA);
    expect("sheets" in canonical).toBe(false);
    expect(validateCanonicalSchematic(canonical)).toEqual([]);
    expect(schematicStateDigest(state)).toBe(GOLDEN[name].stateDigest);
    expect(sha(JSON.stringify(canonical))).toBe(GOLDEN[name].canonicalSha);
    expect(schematicStateDigest(fromCanonicalSchematic(canonical))).toBe(GOLDEN[name].stateDigest);
    const netlist = buildNetlist(state, lookup);
    expect(sha(JSON.stringify(netlist))).toBe(GOLDEN[name].netlistSha);
    expect(netlistHash(netlist)).toBe(GOLDEN[name].netlistHash);
    expect(buildPcbSyncPublicationGraph(state, lookup).sourceDigest).toBe(GOLDEN[name].publicationSourceDigest);
    expect(sha(exportToKicadSch({ state, parts: fixtureParts() }).replace(/\(date "[0-9-]+"\)/g, '(date "X")'))).toBe(GOLDEN[name].kicadSha);
    expect(sha(JSON.stringify(schematicToSpice(state)))).toBe(GOLDEN[name].spiceSha);
  });
});

// ── shared builders ─────────────────────────────────────────────────────────────────────────────────────────────────────────

let opCounter = 0;
const opId = (kind: string): string => `op:j1:${opCounter++}:${kind}`;
const digestOf = (schematic: CanonicalSchematic): string => schematicSemanticDigest(schematic);
const apply = (schematic: CanonicalSchematic, operations: EngineeringOperation[]) => applySchematicOperationsToCanonical(schematic, operations);
const label = (id: string, name: string, at: { x: number; y: number }, extra: Partial<NetLabel> = {}): NetLabel => ({ id, position: at, name, kind: "label", orientation: 0, ...extra });

/** Apply each operation, then its inverse, and require the exact previous digest; returns the state after all operations. */
function stepWithExactInverses(start: CanonicalSchematic, operations: EngineeringOperation[]): CanonicalSchematic {
  let current = start;
  for (const operation of operations) {
    const before = digestOf(current);
    const forward = apply(current, [operation]);
    expect(digestOf(forward.schematic), operation.kind).not.toBe(before);
    const back = apply(forward.schematic, forward.inverseOperations);
    expect(digestOf(back.schematic), `${operation.kind} inverse`).toBe(before);
    expect(JSON.stringify(back.schematic), `${operation.kind} inverse bytes`).toBe(JSON.stringify(current));
    current = forward.schematic;
  }
  return current;
}

/** A Theory design with two subsystems wired on the overview. */
function twoBlocks(): SchematicState {
  const r1: SchComponent = { id: "R1", type: "resistor", x: 100, y: 100, rotation: 0, value: "1k" };
  const r2: SchComponent = { id: "R2", type: "resistor", x: 300, y: 100, rotation: 0, value: "2k" };
  const c1: SchComponent = { id: "C1", type: "capacitor", x: 500, y: 100, rotation: 0, value: "100n" };
  return {
    components: [r1, r2, c1],
    wires: [{ id: "w12", vertices: [pinWorldPos(r1, "right"), pinWorldPos(r2, "left")] }, { id: "w2c", vertices: [pinWorldPos(r2, "right"), pinWorldPos(c1, "left")] }],
    netLabels: [label("l-in", "IN", pinWorldPos(r1, "left")), label("l-gnd", "GND", pinWorldPos(c1, "right"), { kind: "ground" })],
  };
}

// ── 2. the v2 model ────────────────────────────────────────────────────────────────────────────────────────────────────────

describe("[PR-J J1] 2. the multi-sheet canonical model (sirkit.schematic.v2) exists only with a sheet tree", () => {
  const multi = (): SchematicState => ({ ...twoBlocks(), components: twoBlocks().components.map((item) => (item.id === "C1" ? { ...item, sheetId: "out" } : item)), sheets: { version: 1, sheets: [{ id: ROOT_SHEET_ID, name: "Overview", parentId: null }, { id: "out", name: "Output", parentId: ROOT_SHEET_ID, block: { x: 600, y: 0, width: 200, height: 100 } }] } });

  it("round-trips exactly; the digest covers the tree; a reader refuses inconsistent documents", () => {
    const canonical = toCanonicalSchematic(multi());
    expect(canonical.schemaVersion).toBe(CANONICAL_SCHEMATIC_SCHEMA_V2);
    expect(validateCanonicalSchematic(canonical)).toEqual([]);
    expect(fromCanonicalSchematic(canonical)).toEqual({ ...multi(), kicadComponents: [] });
    expect(toCanonicalSchematic(fromCanonicalSchematic(canonical))).toEqual(canonical);
    expect(schematicStateDigest(multi())).not.toBe(schematicStateDigest({ ...multi(), sheets: { version: 1, sheets: [{ id: ROOT_SHEET_ID, name: "Overview", parentId: null }, { id: "out", name: "Output 2", parentId: ROOT_SHEET_ID, block: { x: 600, y: 0, width: 200, height: 100 } }] } }));
    const issuesOf = (mutate: (value: CanonicalSchematic) => void): string[] => { const value = structuredClone(canonical); mutate(value); return validateCanonicalSchematic(value); };
    expect(issuesOf((value) => { value.schemaVersion = CANONICAL_SCHEMATIC_SCHEMA; })[0]).toContain("carries no sheet tree");
    expect(issuesOf((value) => { delete value.sheets; })[0]).toContain("must carry its sheet tree");
    expect(issuesOf((value) => { value.components[2]!.sheetId = "nowhere"; })[0]).toMatch(/^SHEETS: SHEET_REFERENCE_INVALID/);
    expect(issuesOf((value) => { value.sheets!.sheets.push({ id: "out", name: "Twin", parentId: ROOT_SHEET_ID }); })[0]).toMatch(/^SHEETS: SHEET_ID_DUPLICATE/);
    expect(issuesOf((value) => { value.sheets!.sheets.shift(); })[0]).toMatch(/^SHEETS: SHEET_ROOT_CARDINALITY/);
    expect(issuesOf((value) => { value.sheets!.sheets[1]!.block = { x: 605, y: 0, width: 200, height: 100 }; })[0]).toMatch(/^SHEETS: SHEET_BLOCK_INVALID/);
    expect(parseCanonicalSchematic({ ...canonical, sheets: { version: 2, sheets: [] } })).toBeNull();
    expect(parseCanonicalSchematic(canonical)).not.toBeNull();
    // a v1 document is refused any sheet reference: the single-sheet form never carries one
    expect(validateCanonicalSchematic({ ...toCanonicalSchematic(twoBlocks()), wires: [{ id: "w", vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }], sheetId: "out" }] })[0]).toMatch(/^SHEETS: SHEET_REFERENCE_INVALID/);
  });
});

// ── 3. operations: exact inverses and refusals ──────────────────────────────────────────────────────────────────────────────

describe("[PR-J J1] 3. every sheet operation has an exact inverse; the tree exists only while a child sheet exists", () => {
  it("create -> v2; rename, reorder, ports, sheet pin, hierarchical label, scope, assign each invert exactly; deleting the last child restores the v1 digest", () => {
    const start = toCanonicalSchematic(twoBlocks());
    const original = digestOf(start);
    const r2 = twoBlocks().components[1]!;
    let current = stepWithExactInverses(start, [createSheetOperation(twoBlocks(), { operationId: opId("create"), sheet: { id: "out", name: "Output", parentId: ROOT_SHEET_ID }, rootName: "System overview" })]);
    expect(current.schemaVersion).toBe(CANONICAL_SCHEMATIC_SCHEMA_V2);
    expect(current.sheets!.sheets.map((sheet) => sheet.name)).toEqual(["System overview", "Output"]);
    current = stepWithExactInverses(current, [
      { ...PX, operationId: opId("create2"), kind: "schematic_create_sheet", sheet: { id: "aux", name: "Aux", parentId: ROOT_SHEET_ID, block: { x: 0, y: 400, width: 100, height: 60 } }, atIndex: 2 },
      { ...PX, operationId: opId("rename"), kind: "schematic_rename_sheet", sheetId: "out", name: "Output stage" },
      { ...PX, operationId: opId("reorder"), kind: "schematic_reorder_sheets", order: [ROOT_SHEET_ID, "aux", "out"] },
      { ...PX, operationId: opId("port"), kind: "schematic_add_sheet_port", sheetId: "out", port: { id: "p-mid", name: "MID", direction: "input" }, atIndex: 0 },
      { ...PX, operationId: opId("assign"), kind: "schematic_assign_sheet", entries: [{ family: "theory", id: "C1", from: ROOT_SHEET_ID, to: "out" }, { family: "label", id: "l-gnd", from: ROOT_SHEET_ID, to: "out" }] },
      { ...PX, operationId: opId("hier"), kind: "schematic_add_net_label", label: { id: "h-mid", position: pinWorldPos(twoBlocks().components[2]!, "left"), name: "MID", kind: "label", orientation: 0, sheetId: "out", scope: "hierarchical", portId: "p-mid" }, atIndex: 2 },
      { ...PX, operationId: opId("pin"), kind: "schematic_add_sheet_pin", pin: { id: "pin-mid", position: pinWorldPos(r2, "right"), name: "MID", kind: "label", orientation: 180, scope: "sheet-pin", portId: "p-mid", childSheetId: "out" }, atIndex: 3 },
      { ...PX, operationId: opId("scope"), kind: "schematic_set_label_scope", labelId: "l-in", scope: "global", portId: null, childSheetId: null },
    ]);
    // the moved C1 is still connected to R2 (through the port): the partition did not change
    expect(resolveProjectConnectivity(fromCanonicalSchematic(current)).partitionDigest).toBe(resolveProjectConnectivity(twoBlocks()).partitionDigest);
    // tear everything down again with the inverse-capable operations
    current = stepWithExactInverses(current, [
      { ...PX, operationId: opId("unscope"), kind: "schematic_set_label_scope", labelId: "l-in", scope: null, portId: null, childSheetId: null },
      { ...PX, operationId: opId("unpin"), kind: "schematic_remove_sheet_pin", labelId: "pin-mid" },
      { ...PX, operationId: opId("unhier"), kind: "schematic_delete_net_label", labelId: "h-mid" },
      { ...PX, operationId: opId("unassign"), kind: "schematic_assign_sheet", entries: [{ family: "theory", id: "C1", from: "out", to: ROOT_SHEET_ID }, { family: "label", id: "l-gnd", from: "out", to: ROOT_SHEET_ID }] },
      { ...PX, operationId: opId("unport"), kind: "schematic_remove_sheet_port", sheetId: "out", portId: "p-mid" },
      { ...PX, operationId: opId("del-aux"), kind: "schematic_delete_sheet", sheetId: "aux" },
    ]);
    const last = apply(current, [{ ...PX, operationId: opId("del-out"), kind: "schematic_delete_sheet", sheetId: "out" }]);
    expect(last.schematic.schemaVersion).toBe(CANONICAL_SCHEMATIC_SCHEMA);
    expect("sheets" in last.schematic).toBe(false);
    expect(last.inverseOperations[0]).toMatchObject({ kind: "schematic_create_sheet", atIndex: 1, root: { id: ROOT_SHEET_ID, name: "System overview", parentId: null } });
    expect(digestOf(apply(last.schematic, last.inverseOperations).schematic)).toBe(digestOf(current));
    // renamed / reordered state was fully undone above, so the v1 digest is the original one
    expect(digestOf({ ...last.schematic })).toBe(original);
  });

  it("refusals change nothing: a populated sheet, the root, a port in use, a stale precondition, a bad order, an invalid binding", () => {
    const tree = apply(toCanonicalSchematic(twoBlocks()), [
      createSheetOperation(twoBlocks(), { operationId: opId("c"), sheet: { id: "out", name: "Output", parentId: ROOT_SHEET_ID } }),
      { ...PX, operationId: opId("p"), kind: "schematic_add_sheet_port", sheetId: "out", port: { id: "p1", name: "X", direction: "passive" }, atIndex: 0 },
      { ...PX, operationId: opId("a"), kind: "schematic_assign_sheet", entries: [{ family: "theory", id: "C1", from: ROOT_SHEET_ID, to: "out" }] },
      { ...PX, operationId: opId("h"), kind: "schematic_add_net_label", label: { id: "h1", position: { x: 0, y: 0 }, name: "X", kind: "label", orientation: 0, sheetId: "out", scope: "hierarchical", portId: "p1" }, atIndex: 2 },
    ]).schematic;
    const attempt = (operation: EngineeringOperation): string => { try { apply(tree, [operation]); return "applied"; } catch (error) { return (error as Error).message; } };
    expect(attempt({ ...PX, operationId: opId("d"), kind: "schematic_delete_sheet", sheetId: "out" })).toMatch(/^SHEET_NOT_EMPTY:out: sheet "Output" still holds 1 component\(s\), 1 label or sheet pin\(s\), 1 port\(s\); move its contents to another sheet first\. Nothing was deleted\.$/);
    expect(attempt({ ...PX, operationId: opId("d"), kind: "schematic_delete_sheet", sheetId: ROOT_SHEET_ID })).toMatch(/^SHEET_DELETE_REFUSED:root/);
    expect(attempt({ ...PX, operationId: opId("r"), kind: "schematic_remove_sheet_port", sheetId: "out", portId: "p1" })).toMatch(/^SHEET_PORT_IN_USE:p1: port "X" still has 1 hierarchical label/);
    expect(attempt({ ...PX, operationId: opId("s"), kind: "schematic_assign_sheet", entries: [{ family: "theory", id: "C1", from: ROOT_SHEET_ID, to: "out" }] })).toMatch(/^SHEET_ASSIGN_PRECONDITION_FAILED:theory:C1: it is on sheet out, not root$/);
    expect(attempt({ ...PX, operationId: opId("o"), kind: "schematic_reorder_sheets", order: ["out"] })).toMatch(/^INVALID_SHEET_ORDER/);
    expect(attempt({ ...PX, operationId: opId("o2"), kind: "schematic_reorder_sheets", order: ["out", ROOT_SHEET_ID] })).toMatch(/^SCHEMATIC_INTEGRITY:SHEETS: SHEET_ROOT_CARDINALITY/);
    expect(attempt({ ...PX, operationId: opId("pin"), kind: "schematic_add_sheet_pin", pin: { id: "pin2", position: { x: 0, y: 0 }, name: "X", kind: "label", orientation: 0, scope: "sheet-pin", portId: "p-missing", childSheetId: "out" }, atIndex: 0 })).toMatch(/^SCHEMATIC_INTEGRITY:SHEETS: SHEET_PIN_PORT_MISSING/);
    expect(attempt({ ...PX, operationId: opId("c2"), kind: "schematic_create_sheet", sheet: { id: "x", name: "X", parentId: ROOT_SHEET_ID }, atIndex: 2, root: { id: ROOT_SHEET_ID, name: "O", parentId: null } })).toMatch(/^INVALID_SHEET:x: the sheet tree exists/);
    expect(attempt({ ...PX, operationId: opId("c3"), kind: "schematic_create_sheet", sheet: { id: "x", name: "A/B", parentId: ROOT_SHEET_ID }, atIndex: 2 })).toMatch(/^SCHEMATIC_INTEGRITY:SHEETS: SHEET_NAME_INVALID/);
  });

  it("OD-255 item 4: a sheet operation that would join two different rail / isolation domains is refused; a join that already existed is not", () => {
    // AGND on the overview wired to local label X; DGND on a child sheet wired to its own local X: making both X global joins AGND+DGND
    const state: SchematicState = {
      components: [], wires: [{ id: "wa", vertices: [{ x: 0, y: 0 }, { x: 50, y: 0 }] }, { id: "wd", vertices: [{ x: 0, y: 0 }, { x: 50, y: 0 }], sheetId: "dig" }],
      netLabels: [label("ag", "AGND", { x: 0, y: 0 }, { kind: "ground" }), label("xa", "X", { x: 50, y: 0 }), label("dg", "DGND", { x: 0, y: 0 }, { kind: "ground", sheetId: "dig" }), label("xd", "X", { x: 50, y: 0 }, { sheetId: "dig" })],
      sheets: { version: 1, sheets: [{ id: ROOT_SHEET_ID, name: "Overview", parentId: null }, { id: "dig", name: "Digital", parentId: ROOT_SHEET_ID, ports: [{ id: "px", name: "X", direction: "passive" }] }] },
    };
    const canonical = toCanonicalSchematic(state);
    expect(validateCanonicalSchematic(canonical)).toEqual([]);
    const globalBoth: EngineeringOperation[] = [
      { ...PX, operationId: opId("g1"), kind: "schematic_set_label_scope", labelId: "xa", scope: "global", portId: null, childSheetId: null },
      { ...PX, operationId: opId("g2"), kind: "schematic_set_label_scope", labelId: "xd", scope: "global", portId: null, childSheetId: null },
    ];
    expect(() => apply(canonical, globalBoth)).toThrow(/^SHEET_RAIL_JOIN_REFUSED:AGND\|DGND: this sheet operation would connect different rail \/ isolation domains/);
    // binding the port to both X nets is the same join through a port: refused
    const bind: EngineeringOperation[] = [
      { ...PX, operationId: opId("h"), kind: "schematic_add_net_label", label: { id: "hx", position: { x: 50, y: 0 }, name: "X", kind: "label", orientation: 0, sheetId: "dig", scope: "hierarchical", portId: "px" }, atIndex: 4 },
      { ...PX, operationId: opId("p"), kind: "schematic_add_sheet_pin", pin: { id: "pxp", position: { x: 50, y: 0 }, name: "X", kind: "label", orientation: 0, scope: "sheet-pin", portId: "px", childSheetId: "dig" }, atIndex: 5 },
    ];
    expect(() => apply(canonical, bind)).toThrow(/^SHEET_RAIL_JOIN_REFUSED:AGND\|DGND/);
    // a plain label edit (not a sheet operation) is never refused for an existing join
    const joined = toCanonicalSchematic({ ...state, netLabels: [...state.netLabels!, label("dg2", "DGND", { x: 50, y: 0 }, { kind: "ground" })] });
    expect(() => apply(joined, [{ ...PX, operationId: opId("ren"), kind: "schematic_rename_sheet", sheetId: "dig", name: "Digital logic" }])).not.toThrow();
  });
});

// ── 4. executor, registry, graph diff ───────────────────────────────────────────────────────────────────────────────────────

/** The registry as the Sheets navigator (increment 3) will ship it: the two section J records implemented. */
function withSheetCommandsImplemented(): ActionCoverageRecord[] {
  return ACTION_COVERAGE_REGISTRY.map((record) => (record.id === "schematic.sheet-structure" || record.id === "schematic.move-to-sheet" ? { ...record, status: "implemented" as const } : record));
}

describe("[PR-J J1] 4. the commands are bound; only they change sheet membership or scope", () => {
  it("schematic.sheet-structure and schematic.move-to-sheet are bound Tier-2 mutations, PARTIAL (not kernel-executable) until a control reaches them; undo / redo replays every sheet kind; scope is declared", () => {
    expect(validateActionCoverageRegistry()).toEqual([]);
    for (const id of ["schematic.sheet-structure", "schematic.move-to-sheet"]) {
      const contract = resolveExecutorContract(id)!;
      expect(contract, id).toMatchObject({ kind: "mutate", status: "partial", executable: false, approvalTier: "topology-or-geometry" });
      expect(resolveExecutorContract(id, withSheetCommandsImplemented())!.executable, id).toBe(true);
      expect(permissionTierOfAction(ACTION_COVERAGE_REGISTRY.find((record) => record.id === id)!), id).toBe(2);
    }
    expect(resolveExecutorContract("schematic.move-to-sheet")!.allowedOperationKinds).toContain("schematic_assign_sheet");
    expect(resolveExecutorContract("schematic.sheet-structure")!.allowedOperationKinds).not.toContain("schematic_assign_sheet");
    for (const [command, kinds] of Object.entries(KERNEL_OPERATION_BINDINGS)) {
      if (command === "schematic.move-to-sheet" || command === "pcb.undo-redo-canonical") continue;
      expect((kinds as readonly string[]).includes("schematic_assign_sheet"), command).toBe(false);
    }
    for (const kind of SHEET_OPERATION_KINDS) expect(KERNEL_OPERATION_BINDINGS["pcb.undo-redo-canonical"] as readonly string[]).toContain(kind);
    expect(declaredScopeForOperations([{ ...PX, operationId: "a", kind: "schematic_assign_sheet", entries: [{ family: "kicad", id: "u1", from: ROOT_SHEET_ID, to: "s" }, { family: "wire", id: "w1", from: ROOT_SHEET_ID, to: "s" }] }]).objectIds).toEqual(["schcomp:u1", "schwire:w1"]);
    expect(declaredScopeForOperations([{ ...PX, operationId: "c", kind: "schematic_create_sheet", sheet: { id: "s", name: "S", parentId: ROOT_SHEET_ID }, atIndex: 1 }]).objectIds).toEqual(["schsheet:root", "schsheet:s", "schsheets:order"]);
  });

  it("the graph diff refuses a sheet change or a scope change of an existing entity; new entities may carry a sheet", () => {
    const state: SchematicState = { ...twoBlocks(), sheets: { version: 1, sheets: [{ id: ROOT_SHEET_ID, name: "Overview", parentId: null }, { id: "out", name: "Output", parentId: ROOT_SHEET_ID }] } };
    const before = toCanonicalSchematic(state);
    expect(() => diffSchematicGraphOps(before, { components: state.components.map((item) => (item.id === "C1" ? { ...item, sheetId: "out" } : item)) })).toThrow(/^GRAPH_DIFF_IMMUTABLE:C1: sheet membership changes must use the move-to-sheet operation/);
    expect(() => diffSchematicGraphOps(before, { wires: state.wires.map((item) => ({ ...item, sheetId: "out" })) })).toThrow(/^GRAPH_DIFF_IMMUTABLE:w12/);
    expect(() => diffSchematicGraphOps(before, { netLabels: state.netLabels!.map((item) => (item.id === "l-in" ? { ...item, scope: "global" as const } : item)) })).toThrow(/^GRAPH_DIFF_IMMUTABLE:l-in: a label's connection scope/);
    const added = diffSchematicGraphOps(before, { wires: [...state.wires, { id: "w-new", vertices: [{ x: 0, y: 500 }, { x: 50, y: 500 }], sheetId: "out" }] });
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ kind: "schematic_add_wire", wire: { id: "w-new", sheetId: "out" } });
    expect(fromCanonicalSchematic(apply(before, added).schematic).wires.at(-1)).toEqual({ id: "w-new", vertices: [{ x: 0, y: 500 }, { x: 50, y: 500 }], sheetId: "out" });
  });
});

// ── 5. moving connected subsystems of the fixture drone ─────────────────────────────────────────────────────────────────────

/** The components named, the wires touching their pins, and the labels on their pins or on those wires' ends. */
function attachedSelection(state: SchematicState, refs: readonly string[], lookup: (partId: string) => NetlistPartData | null): MoveEntityRef[] {
  const instances = (state.kicadComponents ?? []).filter((item) => refs.includes(item.refDes));
  const pinKeys = new Set(instances.flatMap((item) => (lookup(item.partId)?.pins ?? []).map((pin) => pointKey(kicadPinWorldPos(item, pin)))));
  const wires = state.wires.filter((wire) => pinKeys.has(pointKey(wire.vertices[0]!)) || pinKeys.has(pointKey(wire.vertices[wire.vertices.length - 1]!)));
  const ends = new Set([...pinKeys, ...wires.flatMap((wire) => [pointKey(wire.vertices[0]!), pointKey(wire.vertices[wire.vertices.length - 1]!)])]);
  const labels = (state.netLabels ?? []).filter((item) => ends.has(pointKey(item.position)));
  return [...instances.map((item) => ({ family: "kicad" as const, id: item.id })), ...wires.map((item) => ({ family: "wire" as const, id: item.id })), ...labels.map((item) => ({ family: "label" as const, id: item.id }))];
}

/** What the BOM groups by (app/lib/bom/build.ts buildBom: atomic revision or part, value -> references, instance ids). */
function bomGroups(state: SchematicState): string[] {
  const groups = new Map<string, string[]>();
  for (const item of state.kicadComponents ?? []) groups.set(`k|${item.atomicPartRevisionId ?? item.partId}|${item.value}`, [...(groups.get(`k|${item.atomicPartRevisionId ?? item.partId}|${item.value}`) ?? []), `${item.refDes}#${item.id}`]);
  for (const item of state.components) if (item.type !== "ground") groups.set(`t|${item.type}|${item.value}`, [...(groups.get(`t|${item.type}|${item.value}`) ?? []), item.refDes ?? item.id]);
  return [...groups.entries()].map(([group, refs]) => `${group}=${refs.sort().join(",")}`).sort();
}

describe("[PR-J J1] 5. moving a connected subsystem to another sheet keeps the circuit, the BOM and the physical identities", () => {
  const lookup = fixturePartLookup();
  const drone = droneFixtureState();
  const imu = planMoveToSheet(drone, { entities: attachedSelection(drone, ["U3"], lookup), target: { newSheet: { id: "sheet-imu", name: "IMU", block: { x: 3200, y: 600, width: 300, height: 200 } } }, rootName: "Drone overview", operationIdPrefix: "move-imu" }, lookup);

  it("the IMU (U3 with its wires and labels) moves to a new IMU sheet: every cut local net is carried by an explicit port, nothing else changes", () => {
    if (!imu.ok) throw new Error(`${imu.code}: ${imu.message}`);
    const before = resolveProjectConnectivity(drone, lookup);
    const after = resolveProjectConnectivity(imu.after, lookup);
    expect(after.ok).toBe(true);
    expect(after.mode).toBe("multi-sheet");
    expect(after.partitionDigest).toBe(before.partitionDigest);
    expect(imu.preview).toMatchObject({ sourceSheetId: ROOT_SHEET_ID, targetSheetId: "sheet-imu", createdSheet: { id: "sheet-imu", name: "IMU", parentId: ROOT_SHEET_ID } });
    expect(imu.preview.crossings.length).toBeGreaterThan(0);
    for (const crossing of imu.preview.crossings) {
      expect(crossing.port.sheetId).toBe("sheet-imu");
      expect(crossing.sheetPin.sheetId).toBe(ROOT_SHEET_ID);
      expect(crossing.hierarchicalLabels.every((item) => item.sheetId === "sheet-imu")).toBe(true);
      expect(crossing.netName).not.toBeNull();
      // the net keeps its board name: the overview's local label still names it
      expect(after.netOfPin(before.nets.find((net) => net.id === crossing.netId)!.members[0]!)!.name).toBe(crossing.netName);
    }
    // global rails (+3V3, GND) were not cut: they join by name across sheets
    expect(imu.preview.crossings.map((crossing) => crossing.netName)).not.toContain("GND");
    expect(imu.preview.crossings.map((crossing) => crossing.netName)).not.toContain("+3V3");
    // identities: BOM groups, the physical netlist components (ids, references, values, pins) and the footprint count are unchanged
    expect(bomGroups(imu.after)).toEqual(bomGroups(drone));
    expect(buildNetlist(imu.after, lookup).components).toEqual(buildNetlist(drone, lookup).components);
    expect(buildNetlist(imu.after, lookup).components).toHaveLength(41);
    expect(imu.after.kicadComponents!.find((item) => item.refDes === "U3")!.sheetId).toBe("sheet-imu");
    // the plan's exact inverse restores the single-sheet document byte for byte
    const undone = apply(toCanonicalSchematic(imu.after), imu.inverseOperations).schematic;
    expect(undone.schemaVersion).toBe(CANONICAL_SCHEMATIC_SCHEMA);
    expect(schematicSemanticDigest(undone)).toBe(GOLDEN.drone.stateDigest);
  });

  it("a second move (the motor drivers to their own sheet) works on the existing tree and still keeps the partition; its inverse restores the first result", () => {
    if (!imu.ok) throw new Error(imu.message);
    const motors = planMoveToSheet(imu.after, { entities: attachedSelection(imu.after, ["Q1", "Q2", "Q3", "Q4", "D2", "D3", "D4"], lookup), target: { newSheet: { id: "sheet-motors", name: "Motor drivers" } }, operationIdPrefix: "move-motors" }, lookup);
    if (!motors.ok) throw new Error(`${motors.code}: ${motors.message}`);
    expect(resolveProjectConnectivity(motors.after, lookup).partitionDigest).toBe(resolveProjectConnectivity(drone, lookup).partitionDigest);
    expect(motors.after.sheets!.sheets.map((sheet) => sheet.name)).toEqual(["Drone overview", "IMU", "Motor drivers"]);
    expect(bomGroups(motors.after)).toEqual(bomGroups(drone));
    expect(schematicSemanticDigest(apply(toCanonicalSchematic(motors.after), motors.inverseOperations).schematic)).toBe(schematicStateDigest(imu.after));
  });

  it("the real session refuses the move while the command is partial (fail-closed until the Sheets UI binds it); nothing changes", async () => {
    if (!imu.ok) throw new Error(imu.message);
    const editor = new SchematicEditorSession({ tenantId: "tenant-j1", projectId: "project-j1", branchId: "main" }, { store: new InMemoryAtomicProjectStore() });
    await editor.openForProject(drone, null);
    const refused = await editor.execute(drone, { commandId: "schematic.move-to-sheet", label: "Move the IMU to its own sheet", buildOperations: () => imu.operations });
    expect(refused).toMatchObject({ ok: false, reasonCode: "not_executable" });
    // the same operations under a command that may not move entities are refused too
    const smuggled = await editor.execute(drone, { commandId: "schematic.connect", label: "Smuggle a move", buildOperations: () => [imu.operations.find((operation) => operation.kind === "schematic_assign_sheet")!] });
    expect(smuggled).toMatchObject({ ok: false, reasonCode: "operation_mismatch" });
  });

  it("once implemented, the executor runs the move as ONE transaction and undo / redo replay it exactly (verified replay, not a rebase)", async () => {
    if (!imu.ok) throw new Error(imu.message);
    const project: CanonicalProjectState = { schemaVersion: "sirkit.engineering.v1", tenantId: "tenant-j1", projectId: "project-j1", branchId: "main", pcb: createEmptyBoard(), schematic: toCanonicalSchematic(drone), pinnedAssets: [] };
    const service = await EngineeringTransactionService.open(project, { buildId: "j1-test", store: new InMemoryAtomicProjectStore() });
    const executor = new CanonicalExecutor(service, withSheetCommandsImplemented(), { interactiveChannel: createEditorSessionChannel("j1 test session") });
    const human: EngineeringActor = { actorId: "owner", actorKind: "human", sessionId: "s-j1", role: "project_admin" };
    const lineage = { tenantId: "tenant-j1", projectId: "project-j1", branchId: "main", lineageId: executor.lineageId };
    const executed = await executor.execute({ commandId: "schematic.move-to-sheet", actor: human, expectedRevision: service.currentRevision(), idempotencyKey: "move-imu", reason: "Move the IMU to its own sheet", operations: imu.operations, provenance: { source: "ui" } });
    if (executed.status !== "executed") throw new Error(JSON.stringify(executed));
    expect(service.durableRecords()).toHaveLength(1);
    const head = (): CanonicalSchematic => parseCanonicalSchematic(service.currentProject().schematic)!;
    expect(schematicSemanticDigest(head())).toBe(schematicStateDigest(imu.after));
    const undo = await executor.executeUndoRedo({ referencedTransactionId: executed.transactionId, direction: "undo", actor: human, expectedLineage: lineage, expectedHeadRevision: service.currentRevision(), expectedSourceStateDigest: executed.semanticDigestAfter!, expectedResultStateDigest: executed.semanticDigestBefore!, idempotencyKey: "undo-move", reason: "Undo" });
    expect(undo.status).toBe("executed");
    expect(schematicSemanticDigest(head())).toBe(GOLDEN.drone.stateDigest);
    expect(head().schemaVersion).toBe(CANONICAL_SCHEMATIC_SCHEMA);
    const redo = await executor.executeUndoRedo({ referencedTransactionId: executed.transactionId, direction: "redo", actor: human, expectedLineage: lineage, expectedHeadRevision: service.currentRevision(), expectedSourceStateDigest: executed.semanticDigestBefore!, expectedResultStateDigest: executed.semanticDigestAfter!, idempotencyKey: "redo-move", reason: "Redo" });
    expect(redo.status).toBe("executed");
    expect(schematicSemanticDigest(head())).toBe(schematicStateDigest(imu.after));
  });

  it("refusals: the legacy ground collapse, a non-adjacent target, a landing on existing connections (until offset), and port anchors", () => {
    const theory = planMoveToSheet(theoryLegacyFixture(), { entities: [{ family: "theory", id: "R2" }], target: { newSheet: { id: "s1", name: "Load" } } });
    expect(theory).toMatchObject({ ok: false, code: "SHEET_MOVE_NOT_EQUIVALENT" });
    if (!theory.ok) expect(theory.message).toContain("GND, AGND, DGND are joined");
    // a two-block Theory design: move C1 to a child sheet, then try to move R1 from the overview onto the same coordinates
    const blocks = twoBlocks();
    const first = planMoveToSheet(blocks, { entities: [{ family: "theory", id: "C1" }, { family: "label", id: "l-gnd" }], target: { newSheet: { id: "out", name: "Output" } } });
    if (!first.ok) throw new Error(first.message);
    expect(first.preview.crossings.map((crossing) => crossing.port.name)).toEqual(["SIG1"]);
    const sibling = planMoveToSheet({ ...first.after, sheets: { version: 1, sheets: [...first.after.sheets!.sheets, { id: "aux", name: "Aux", parentId: ROOT_SHEET_ID }] } }, { entities: [{ family: "theory", id: "C1" }], target: { sheetId: "aux" } });
    expect(sibling).toMatchObject({ ok: false, code: "SHEET_MOVE_TARGET_UNSUPPORTED" });
    const shifted = { ...first.after, components: first.after.components.map((item) => (item.id === "R1" ? { ...item, x: 500, y: 100 } : item)), wires: first.after.wires.filter((item) => item.id !== "w12") };
    shifted.netLabels = shifted.netLabels!.map((item) => (item.id === "l-in" ? { ...item, position: pinWorldPos(shifted.components[0]!, "left") } : item));
    const landing = planMoveToSheet(shifted, { entities: [{ family: "theory", id: "R1" }, { family: "label", id: "l-in" }], target: { sheetId: "out" } });
    expect(landing).toMatchObject({ ok: false, code: "SHEET_MOVE_NOT_EQUIVALENT" });
    const clear = planMoveToSheet(shifted, { entities: [{ family: "theory", id: "R1" }, { family: "label", id: "l-in" }], target: { sheetId: "out" }, offset: { dx: 0, dy: 300 } });
    expect(clear.ok).toBe(true);
    const anchors = planMoveToSheet(first.after, { entities: [{ family: "label", id: first.after.netLabels!.find((item) => item.scope === "sheet-pin")!.id }], target: { sheetId: "out" } });
    expect(anchors).toMatchObject({ ok: false, code: "SHEET_MOVE_SELECTION_INVALID" });
  });
});
