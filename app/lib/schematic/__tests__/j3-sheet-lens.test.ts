/**
 * [PR-J3, 2026-10-22] Runbook J.3 items 2, 3, 7, 8 (OD-257 items 1, 2): the pure half of the Sheets navigator
 * (app/lib/schematic/sheet-lens.ts).
 *
 *  1. legacy identity: a single-sheet document projects to the SAME array references, merges to the SAME graph object and scopes
 *     its command state to the same state (nothing about the single-sheet editor changes);
 *  2. the projection of the fixture drone split (the IMU moved to its own sheet by planMoveToSheet) shows only that sheet's entities,
 *     the root the rest, the two together the whole project; the branded lens is never returned;
 *  3. a scoped command never touches another sheet's wire at the same XY: deleting the active sheet's wire through the scoped graph
 *     leaves the other sheet's identical wire the same object; new entities are stamped with the active sheet, none on the root;
 *  4. the reference namespace stays project-wide: the scoped command state carries every sheet's components, so the next free
 *     designator is minted over the whole project;
 *  5. merge: other sheets' order preserved, round trip (merging a sheet's own projection reproduces the base byte for byte),
 *     determinism (two merges are byte-identical), and diffSchematicGraphOps reproduces the merged graph (no GRAPH_DIFF_ORDER,
 *     no GRAPH_DIFF_IMMUTABLE) - the dropped, replaced and appended cases;
 *  6. the planning helpers: the attached selection (the part, the wires of its sheet touching its pins, the local labels at their
 *     ends - never a port anchor), the connected group restricted to the sheet, the movable contents; the delete impact of a populated
 *     sheet (not deletable, the message names what it holds and the two-step path) and the structural cleanup of an emptied one
 *     (sheet pins, hierarchical labels, ports, then the sheet - one batch the executor's own code applies; the single-sheet drone
 *     comes back digest-identical); add port (one batch: port + hierarchical label on the child + sheet pin on the parent's block
 *     edge), its refusals (root, duplicate name); the sheet-pin snap; reorder, names, block slots; the cross-sheet signals of the
 *     IMU split (I2C_SCL, I2C_SDA, IMU_INT1 reach the IMU sheet and back).
 * Pure / in-memory: no React, no network, no randomness.
 */
import { describe, expect, it } from "vitest";
import { applySchematicOperationsToCanonical } from "@/app/lib/engineering/operations";
import { diffSchematicGraphOps } from "@/app/lib/engineering/schematic-graph";
import { nextTheoryDisplayRef } from "@/app/lib/engineering/schematic-graph";
import { fromCanonicalSchematic, schematicStateDigest, toCanonicalSchematic } from "@/app/lib/engineering/schematic-model";
import type { EngineeringOperation } from "@/app/lib/engineering/types";
import { resolveProjectConnectivity } from "@/app/lib/schematic/project-connectivity";
import {
  addPortOperations,
  attachedSelection,
  connectedSelection,
  deleteSheetImpact,
  deleteSheetOperations,
  freeBlockSlot,
  interfaceSignals,
  legacyIdentity,
  mergeSheetAfter,
  movableContents,
  nearestBlockEdgePoint,
  nextSheetName,
  parentSheetOf,
  projectSheet,
  reorderedSheets,
  scopedCommandState,
  scopedGraph,
  sheetBlockOf,
  sheetNameProblem,
  sheetOfComponentRef,
  snapSheetPinToBlock,
  type SchematicGraphApi,
} from "@/app/lib/schematic/sheet-lens";
import { planMoveToSheet } from "@/app/lib/schematic/sheet-operations";
import { SHEET_LENS_BRAND, sheetLens, sheetsOf } from "@/app/lib/schematic/sheets";
import { ROOT_SHEET_ID, type NetLabel, type SchComponent, type SchematicState, type Wire } from "@/lib/schematic-types";
import { droneFixtureState, fixturePartLookup } from "./_j1-fixtures";

const lookup = fixturePartLookup();
const getPart = (partId: string) => lookup(partId);
const apply = (state: SchematicState, operations: EngineeringOperation[]): SchematicState => fromCanonicalSchematic(applySchematicOperationsToCanonical(toCanonicalSchematic(state), operations).schematic);
const bytes = (value: unknown): string => JSON.stringify(value);

/** The fixture drone with the IMU (U3, its wires and local labels) moved to a new child sheet "IMU" (the j1 proof reused). */
function imuSplit(): { drone: SchematicState; after: SchematicState; crossings: string[] } {
  const drone = droneFixtureState();
  const u3 = drone.kicadComponents!.find((item) => item.refDes === "U3")!;
  const entities = attachedSelection(drone, { family: "kicad", id: u3.id }, getPart)!;
  const plan = planMoveToSheet(drone, { entities, target: { newSheet: { id: "sheet-imu", name: "IMU", block: { x: 3200, y: 600, width: 300, height: 200 } } }, rootName: "Overview", operationIdPrefix: "move-imu" }, lookup);
  if (!plan.ok) throw new Error(`${plan.code}: ${plan.message}`);
  return { drone, after: plan.after, crossings: plan.preview.crossings.map((crossing) => crossing.netName ?? "") };
}

const resistor = (id: string, x: number, y: number, sheetId?: string): SchComponent => ({ id, type: "resistor", x, y, rotation: 0, value: "1k", refDes: id, ...(sheetId ? { sheetId } : {}) });
const wire = (id: string, a: { x: number; y: number }, b: { x: number; y: number }, sheetId?: string): Wire => ({ id, vertices: [a, b], ...(sheetId ? { sheetId } : {}) });
const label = (id: string, name: string, at: { x: number; y: number }, extra: Partial<NetLabel> = {}): NetLabel => ({ id, position: at, name, kind: "label", orientation: 0, ...extra });

/** Two sheets with an identical wire at the same XY on each (the J.4 case that must stay two nets and two objects). */
function twinWires(): SchematicState {
  return {
    components: [resistor("R1", 100, 100), resistor("R2", 100, 300, "child")],
    wires: [wire("w-root", { x: 130, y: 100 }, { x: 200, y: 100 }), wire("w-child", { x: 130, y: 100 }, { x: 200, y: 100 }, "child"), wire("w-child-2", { x: 130, y: 300 }, { x: 200, y: 300 }, "child")],
    kicadComponents: [],
    netLabels: [label("l-root", "A", { x: 200, y: 100 }), label("l-child", "A", { x: 200, y: 100 }, { sheetId: "child" })],
    sheets: { version: 1, sheets: [{ id: ROOT_SHEET_ID, name: "Overview", parentId: null }, { id: "child", name: "Child", parentId: ROOT_SHEET_ID, block: { x: 400, y: 100, width: 300, height: 200 } }] },
  };
}

/** A graph authority that records what it is handed and runs `buildAfter` on demand. */
function recordingGraph(state: () => SchematicState) {
  const calls: Array<{ kind: string; payload: unknown }> = [];
  const pending: Array<(state: SchematicState) => unknown> = [];
  const graph: SchematicGraphApi = {
    run: (label, commandId, buildAfter) => { calls.push({ kind: "run", payload: { label, commandId } }); pending.push(buildAfter); },
    begin: () => { calls.push({ kind: "begin", payload: null }); return true; },
    preview: (frame) => calls.push({ kind: "preview", payload: frame }),
    cancel: () => calls.push({ kind: "cancel", payload: null }),
    commit: (label, finalGraph) => calls.push({ kind: "commit", payload: { label, finalGraph } }),
  };
  return { graph, calls, flush: () => pending.splice(0).map((build) => build(state())) };
}

describe("[PR-J3] 1. legacy identity", () => {
  it("a single-sheet document projects to the same arrays, merges to the same object, scopes to the same state", () => {
    const drone = droneFixtureState();
    expect(legacyIdentity(drone)).toBe(true);
    const projected = projectSheet(drone, ROOT_SHEET_ID);
    expect(projected.components).toBe(drone.components);
    expect(projected.wires).toBe(drone.wires);
    expect(projected.kicadComponents).toBe(drone.kicadComponents);
    expect(projected.netLabels).toBe(drone.netLabels);
    const after = { wires: drone.wires.slice(1) };
    expect(mergeSheetAfter(drone, ROOT_SHEET_ID, after)).toBe(after);
    expect(scopedCommandState(drone, ROOT_SHEET_ID)).toBe(drone);
    expect(SHEET_LENS_BRAND in projected.components).toBe(false);
  });
});

describe("[PR-J3] 2. the projection of the IMU split", () => {
  it("shows only the IMU sheet's entities, the root the rest, both together the whole; plain arrays, never the branded lens", () => {
    const { drone, after, crossings } = imuSplit();
    expect(crossings).toEqual(expect.arrayContaining(["I2C_SCL", "I2C_SDA", "IMU_INT1"]));
    expect(legacyIdentity(after)).toBe(false);
    const imu = projectSheet(after, "sheet-imu");
    const root = projectSheet(after, ROOT_SHEET_ID);
    expect(imu.kicadComponents.map((item) => item.refDes)).toEqual(["U3"]);
    expect(imu.components).toEqual([]);
    expect(imu.wires.length).toBeGreaterThan(0);
    expect(imu.wires.every((item) => item.sheetId === "sheet-imu")).toBe(true);
    expect(imu.netLabels.every((item) => item.sheetId === "sheet-imu")).toBe(true);
    expect(imu.netLabels.some((item) => item.scope === "hierarchical")).toBe(true);
    expect(root.kicadComponents.length).toBe(drone.kicadComponents!.length - 1);
    expect(root.netLabels.some((item) => item.scope === "sheet-pin" && item.childSheetId === "sheet-imu")).toBe(true);
    expect(root.kicadComponents.length + imu.kicadComponents.length).toBe(after.kicadComponents!.length);
    expect(root.wires.length + imu.wires.length).toBe(after.wires.length);
    expect(root.netLabels.length + imu.netLabels.length).toBe(after.netLabels!.length);
    for (const array of [imu.components, imu.wires, imu.kicadComponents, imu.netLabels]) {
      expect(Object.isFrozen(array)).toBe(false);
      expect(SHEET_LENS_BRAND in array).toBe(false);
    }
    // sheets.ts's lens agrees on the membership but stays what it is: branded and frozen
    const branded = sheetLens(after, "sheet-imu");
    expect([...branded.wires].map((item) => item.id)).toEqual(imu.wires.map((item) => item.id));
    expect(Object.isFrozen(branded.wires)).toBe(true);
  });
});

describe("[PR-J3] 3. a scoped command stays on its sheet", () => {
  it("deleting the active sheet's wire leaves the other sheet's identical wire the same object; a new wire is stamped with the active sheet (none on the root)", () => {
    let state = twinWires();
    const recorder = recordingGraph(() => state);
    const scoped = scopedGraph(recorder.graph, () => state, () => "child");
    scoped.run("Deleted wire", "schematic.connect", (view) => {
      expect(view.wires.map((item) => item.id)).toEqual(["w-child", "w-child-2"]); // the child sheet's wires only
      expect(view.components.map((item) => item.id)).toEqual(["R1", "R2"]); // the FULL component lists
      return { wires: [...view.wires.filter((item) => item.id !== "w-child"), { id: "w-new", vertices: [{ x: 0, y: 500 }, { x: 50, y: 500 }] }] };
    });
    const [after] = recorder.flush() as [{ wires: Wire[] }];
    expect(after.wires.map((item) => item.id)).toEqual(["w-root", "w-child-2", "w-new"]);
    expect(after.wires[0]).toBe(state.wires[0]); // the root's identical wire: untouched, the same object
    expect(after.wires[2]).toMatchObject({ id: "w-new", sheetId: "child" });
    // the same command on the root stamps nothing
    const onRoot = scopedGraph(recorder.graph, () => state, () => ROOT_SHEET_ID);
    onRoot.run("Added wire", "schematic.connect", (view) => ({ wires: [...view.wires, { id: "w-root-2", vertices: [{ x: 0, y: 600 }, { x: 50, y: 600 }], sheetId: "child" }] }));
    const [rootAfter] = recorder.flush() as [{ wires: Wire[] }];
    expect(rootAfter.wires.at(-1)).toEqual({ id: "w-root-2", vertices: [{ x: 0, y: 600 }, { x: 50, y: 600 }] });
    expect("sheetId" in rootAfter.wires.at(-1)!).toBe(false);
    state = { ...state, wires: after.wires };
    // a preview frame (the editor's FULL scoped array, one wire moved) and a commit are merged onto the whole project before the
    // coordinator sees them: the root's wire is present and untouched
    scoped.preview({ wires: [{ id: "w-child-2", vertices: [{ x: 130, y: 310 }, { x: 200, y: 310 }], sheetId: "child" }, after.wires[2]!] });
    const preview = recorder.calls.find((call) => call.kind === "preview")!.payload as { wires: Wire[] };
    expect(preview.wires.map((item) => item.id)).toEqual(["w-root", "w-child-2", "w-new"]);
    expect(preview.wires[0]).toBe(state.wires[0]);
    expect(preview.wires[1]!.vertices[0]).toEqual({ x: 130, y: 310 });
    // a frame that lists only part of the sheet drops the rest of THAT sheet (the editor's frames are whole arrays), never the root's
    scoped.preview({ wires: [after.wires[2]!] });
    expect((recorder.calls.at(-1)!.payload as { wires: Wire[] }).wires.map((item) => item.id)).toEqual(["w-root", "w-new"]);
    scoped.commit("Moved wire", { wires: preview.wires.filter((item) => item.sheetId === "child") });
    const commit = recorder.calls.find((call) => call.kind === "commit")!.payload as { finalGraph: { wires: Wire[] } };
    expect(commit.finalGraph.wires.map((item) => item.id)).toEqual(["w-root", "w-child-2", "w-new"]);
    scoped.cancel();
    expect(recorder.calls.at(-1)!.kind).toBe("cancel");
  });

  it("the gesture lifecycle on the root passes frames through untouched for a legacy document", () => {
    const drone = droneFixtureState();
    const recorder = recordingGraph(() => drone);
    const scoped = scopedGraph(recorder.graph, () => drone, () => ROOT_SHEET_ID);
    const frame = { components: drone.components };
    scoped.preview(frame);
    expect(recorder.calls[0]!.payload).toBe(frame);
    expect(scoped.begin()).toBe(true);
  });
});

describe("[PR-J3] 4. the reference namespace stays project-wide", () => {
  it("the scoped command state carries every sheet's components: the next designator is free over the whole project", () => {
    const state = twinWires();
    const scoped = scopedCommandState(state, "child");
    expect(scoped.components.map((item) => item.id)).toEqual(["R1", "R2"]);
    expect(scoped.wires.map((item) => item.id)).toEqual(["w-child", "w-child-2"]);
    expect(scoped.netLabels!.map((item) => item.id)).toEqual(["l-child"]);
    expect(nextTheoryDisplayRef("resistor", scoped.components)).toBe("R3");
    expect(nextTheoryDisplayRef("resistor", projectSheet(state, "child").components)).not.toBe("R3"); // the counterexample: a per-sheet namespace would mint R2 twice
  });
});

describe("[PR-J3] 5. merge: order, round trip, determinism, the graph diff reproduces it", () => {
  it("merging a sheet's own projection reproduces the base; two merges are byte-identical; dropped, replaced and appended entities diff cleanly", () => {
    const { after } = imuSplit();
    const imu = projectSheet(after, "sheet-imu");
    const roundTrip = mergeSheetAfter(after, "sheet-imu", { components: imu.components, wires: imu.wires, kicadComponents: imu.kicadComponents, netLabels: imu.netLabels });
    expect(bytes(roundTrip.components)).toBe(bytes(after.components));
    expect(bytes(roundTrip.wires)).toBe(bytes(after.wires));
    expect(bytes(roundTrip.kicadComponents)).toBe(bytes(after.kicadComponents));
    expect(bytes(roundTrip.netLabels)).toBe(bytes(after.netLabels));
    expect(diffSchematicGraphOps(toCanonicalSchematic(after), roundTrip)).toEqual([]);
    // dropped (the first IMU wire), replaced (U3 moved by a grid step), appended (a new local label on the IMU sheet)
    const u3 = imu.kicadComponents[0]!;
    const scopedAfter = {
      kicadComponents: imu.kicadComponents.map((item) => ({ ...item, x: item.x + 10 })),
      wires: imu.wires.slice(1),
      netLabels: [...imu.netLabels, { id: "l-new", position: { x: 10, y: 10 }, name: "NEW", kind: "label" as const, orientation: 0 as const }],
    };
    const merged = mergeSheetAfter(after, "sheet-imu", scopedAfter);
    expect(bytes(merged)).toBe(bytes(mergeSheetAfter(after, "sheet-imu", scopedAfter)));
    // other sheets' order and objects: every root entity in its base position
    const rootWires = after.wires.filter((item) => item.sheetId === undefined);
    expect(merged.wires!.filter((item) => item.sheetId === undefined)).toEqual(rootWires);
    expect(merged.wires!.map((item) => item.id)).toEqual(after.wires.filter((item) => item.id !== imu.wires[0]!.id).map((item) => item.id));
    expect(merged.kicadComponents!.find((item) => item.id === u3.id)).toMatchObject({ x: u3.x + 10, sheetId: "sheet-imu" });
    expect(merged.kicadComponents!.findIndex((item) => item.id === u3.id)).toBe(after.kicadComponents!.findIndex((item) => item.id === u3.id));
    expect(merged.netLabels!.at(-1)).toEqual({ id: "l-new", position: { x: 10, y: 10 }, name: "NEW", kind: "label", orientation: 0, sheetId: "sheet-imu" });
    const operations = diffSchematicGraphOps(toCanonicalSchematic(after), merged);
    expect(operations.map((operation) => operation.kind).sort()).toEqual(["schematic_add_net_label", "schematic_delete_wire", "schematic_transform_component"]);
    const applied = apply(after, operations);
    expect(bytes(applied.wires)).toBe(bytes(merged.wires));
    expect(bytes(applied.kicadComponents)).toBe(bytes(merged.kicadComponents));
    expect(bytes(applied.netLabels)).toBe(bytes(merged.netLabels));
    expect(applied.sheets).toEqual(after.sheets);
  });

  it("a result that claims another sheet's entity changed is ignored for that entity (another sheet is never written)", () => {
    const state = twinWires();
    const merged = mergeSheetAfter(state, "child", { components: [resistor("R1", 999, 999), resistor("R2", 100, 310, "child")] });
    expect(merged.components![0]).toBe(state.components[0]); // R1 on the root: the base object, not the claimed move
    expect(merged.components![1]).toMatchObject({ id: "R2", y: 310, sheetId: "child" });
  });
});

describe("[PR-J3] 6. the planning helpers", () => {
  const { drone, after } = imuSplit();
  const u3 = drone.kicadComponents!.find((item) => item.refDes === "U3")!;

  it("the attached selection: the part, the wires of its sheet at its pins, the local labels at their ends; never a port anchor; the connected group stays on the sheet", () => {
    const selection = attachedSelection(drone, { family: "kicad", id: u3.id }, getPart)!;
    expect(selection[0]).toEqual({ family: "kicad", id: u3.id });
    expect(selection.filter((ref) => ref.family === "wire").length).toBeGreaterThan(0);
    expect(selection.filter((ref) => ref.family === "label").length).toBeGreaterThan(0);
    expect(attachedSelection(drone, { family: "kicad", id: "nope" }, getPart)).toBeNull();
    // on the split: the IMU's selection names only IMU-sheet entities, and never the hierarchical labels
    const onImu = attachedSelection(after, { family: "kicad", id: u3.id }, getPart)!;
    const anchors = new Set(after.netLabels!.filter((item) => item.scope !== undefined).map((item) => item.id));
    expect(onImu.some((ref) => anchors.has(ref.id))).toBe(false);
    for (const ref of onImu) {
      const pool = ref.family === "kicad" ? after.kicadComponents! : ref.family === "wire" ? after.wires : ref.family === "label" ? after.netLabels! : after.components;
      expect(pool.find((item) => item.id === ref.id)!.sheetId).toBe("sheet-imu");
    }
    const group = connectedSelection(after, { family: "kicad", id: u3.id }, getPart)!;
    expect(group.length).toBeGreaterThanOrEqual(onImu.length);
    for (const ref of group) {
      const pool = ref.family === "kicad" ? after.kicadComponents! : ref.family === "wire" ? after.wires : ref.family === "label" ? after.netLabels! : after.components;
      expect(pool.find((item) => item.id === ref.id)!.sheetId).toBe("sheet-imu");
      expect(anchors.has(ref.id)).toBe(false);
    }
    const contents = movableContents(after, "sheet-imu");
    expect(contents.some((ref) => ref.id === u3.id)).toBe(true);
    expect(contents.some((ref) => anchors.has(ref.id))).toBe(false);
  });

  it("delete: a populated sheet is not deletable and the impact names the two-step path; after the contents move back, ONE structural batch deletes the sheet and the single-sheet drone returns digest-identical", () => {
    const populated = deleteSheetImpact(after, "sheet-imu");
    expect(populated).toMatchObject({ name: "IMU", components: 1, populated: true, deletable: false, childSheets: 0 });
    expect(populated.ports).toBe(after.sheets!.sheets.find((sheet) => sheet.id === "sheet-imu")!.ports!.length);
    expect(populated.message).toMatch(/still holds 1 component\(s\).*move its contents to the parent sheet first \(one transaction\), then delete the empty sheet \(a second\)\. Nothing was deleted\./);
    expect(deleteSheetOperations(after, "sheet-imu", "t")).toEqual({ ok: false, message: populated.message });
    expect(deleteSheetImpact(after, ROOT_SHEET_ID)).toMatchObject({ deletable: false, message: "The overview (root) sheet cannot be deleted." });
    // step 1: the contents back to the overview (the planner proves the partition)
    const back = planMoveToSheet(after, { entities: movableContents(after, "sheet-imu"), target: { sheetId: ROOT_SHEET_ID }, operationIdPrefix: "back" }, lookup);
    if (!back.ok) throw new Error(`${back.code}: ${back.message}`);
    expect(resolveProjectConnectivity(back.after, lookup).partitionDigest).toBe(resolveProjectConnectivity(drone, lookup).partitionDigest);
    const emptied = deleteSheetImpact(back.after, "sheet-imu");
    expect(emptied).toMatchObject({ components: 0, wires: 0, labels: 0, populated: false, deletable: true });
    expect(emptied.anchors).toBe(emptied.ports * 2); // one hierarchical label and one sheet pin per port
    expect(emptied.message).toMatch(/removes its \d+ port\(s\) with \d+ sheet pin\(s\) and hierarchical label\(s\), then the sheet - one transaction, one undo step/);
    // step 2: one batch - pins, labels, ports, sheet - applied with the executor's own code
    const cleanup = deleteSheetOperations(back.after, "sheet-imu", "cleanup");
    if (!cleanup.ok) throw new Error(cleanup.message);
    expect(cleanup.operations.map((operation) => operation.kind)).toEqual([
      ...Array.from({ length: emptied.ports }, () => "schematic_remove_sheet_pin"),
      ...Array.from({ length: emptied.ports }, () => "schematic_delete_net_label"),
      ...Array.from({ length: emptied.ports }, () => "schematic_remove_sheet_port"),
      "schematic_delete_sheet",
    ]);
    expect(new Set(cleanup.operations.map((operation) => operation.operationId)).size).toBe(cleanup.operations.length);
    const restored = apply(back.after, cleanup.operations);
    expect(restored.sheets).toBeUndefined();
    expect(schematicStateDigest(restored)).toBe(schematicStateDigest(drone));
  });

  it("add port: one batch with the port, its hierarchical label on the child and its sheet pin on the parent's block edge; refusals for the root and a duplicate name", () => {
    const built = addPortOperations(after, { sheetId: "sheet-imu", port: { id: "port-x", name: " IMU_CS ", direction: "input" }, labelId: "port-x:label", pinId: "port-x:pin", operationIdPrefix: "add" });
    if (!built.ok) throw new Error(built.message);
    expect(built.operations.map((operation) => operation.kind)).toEqual(["schematic_add_sheet_port", "schematic_add_net_label", "schematic_add_sheet_pin"]);
    const next = apply(after, built.operations);
    const sheet = next.sheets!.sheets.find((item) => item.id === "sheet-imu")!;
    expect(sheet.ports!.at(-1)).toEqual({ id: "port-x", name: "IMU_CS", direction: "input" });
    const hierarchical = next.netLabels!.find((item) => item.id === "port-x:label")!;
    const pin = next.netLabels!.find((item) => item.id === "port-x:pin")!;
    expect(hierarchical).toMatchObject({ name: "IMU_CS", sheetId: "sheet-imu", scope: "hierarchical", portId: "port-x" });
    expect(pin).toMatchObject({ name: "IMU_CS", scope: "sheet-pin", portId: "port-x", childSheetId: "sheet-imu" });
    expect("sheetId" in pin).toBe(false); // the parent is the root: no stamp
    const block = sheet.block!;
    expect(pin.position.x).toBe(block.x); // an input: the block's left edge
    expect(pin.position.y).toBeGreaterThanOrEqual(block.y);
    expect(pin.position.y).toBeLessThanOrEqual(block.y + block.height);
    expect(hierarchical.position.x % 10).toBe(0);
    expect(resolveProjectConnectivity(next, lookup).ok).toBe(true);
    // an output goes to the right edge; the second port of the same direction takes the next free slot
    const out = addPortOperations(next, { sheetId: "sheet-imu", port: { id: "port-y", name: "IMU_RDY", direction: "output" }, labelId: "port-y:label", pinId: "port-y:pin", operationIdPrefix: "add2" });
    if (!out.ok) throw new Error(out.message);
    const withOut = apply(next, out.operations);
    expect(withOut.netLabels!.find((item) => item.id === "port-y:pin")!.position.x).toBe(block.x + block.width);
    const second = addPortOperations(withOut, { sheetId: "sheet-imu", port: { id: "port-z", name: "IMU_CS2", direction: "input" }, labelId: "port-z:label", pinId: "port-z:pin", operationIdPrefix: "add3" });
    if (!second.ok) throw new Error(second.message);
    const withSecond = apply(withOut, second.operations);
    expect(withSecond.netLabels!.find((item) => item.id === "port-z:pin")!.position).not.toEqual(pin.position);
    expect(addPortOperations(after, { sheetId: ROOT_SHEET_ID, port: { id: "p", name: "X", direction: "passive" }, labelId: "a", pinId: "b", operationIdPrefix: "t" })).toMatchObject({ ok: false, message: expect.stringContaining("overview has none") });
    expect(addPortOperations(next, { sheetId: "sheet-imu", port: { id: "p", name: "imu_cs", direction: "passive" }, labelId: "a", pinId: "b", operationIdPrefix: "t" })).toMatchObject({ ok: false, message: expect.stringContaining("already has a port named imu_cs") });
    expect(addPortOperations(after, { sheetId: "sheet-imu", port: { id: "p", name: "  ", direction: "passive" }, labelId: "a", pinId: "b", operationIdPrefix: "t" })).toMatchObject({ ok: false, message: "A port needs a name." });
  });

  it("the sheet-pin snap, reorder, names and block slots", () => {
    const state = twinWires();
    const block = state.sheets!.sheets[1]!.block!;
    expect(nearestBlockEdgePoint(block, { x: 450, y: 150 })).toEqual({ x: 400, y: 150 });
    expect(nearestBlockEdgePoint(block, { x: 690, y: 290 })).toEqual({ x: 700, y: 290 }); // a tie (right and bottom edge both 10 px away) resolves to the right edge, deterministically
    expect(nearestBlockEdgePoint(block, { x: 650, y: 290 })).toEqual({ x: 650, y: 300 });
    const pin = label("pin", "X", { x: 455, y: 123 }, { scope: "sheet-pin", portId: "p", childSheetId: "child" });
    expect(snapSheetPinToBlock(state, pin).position).toEqual({ x: 460, y: 100 }); // the top edge is the nearest (23 px), grid-snapped
    const onEdge = label("pin2", "X", { x: 400, y: 150 }, { scope: "sheet-pin", portId: "p", childSheetId: "child" });
    expect(snapSheetPinToBlock(state, onEdge)).toBe(onEdge);
    const plain = label("l", "X", { x: 455, y: 123 });
    expect(snapSheetPinToBlock(state, plain)).toBe(plain);
    const blockless: SchematicState = { ...state, sheets: { version: 1, sheets: [{ id: ROOT_SHEET_ID, name: "Overview", parentId: null }, { id: "child", name: "Child", parentId: ROOT_SHEET_ID }, { id: "other", name: "Other", parentId: ROOT_SHEET_ID }] } };
    expect(snapSheetPinToBlock(blockless, pin)).toBe(pin);
    const defaults = [sheetBlockOf(blockless, blockless.sheets!.sheets[1]!), sheetBlockOf(blockless, blockless.sheets!.sheets[2]!)];
    expect(defaults[0]).not.toEqual(defaults[1]); // two blockless siblings: two cells
    expect(defaults).toEqual([sheetBlockOf(blockless, blockless.sheets!.sheets[1]!), sheetBlockOf(blockless, blockless.sheets!.sheets[2]!)]); // deterministic
    const slot = freeBlockSlot(state, ROOT_SHEET_ID);
    expect(slot.x % 10 + slot.y % 10).toBe(0);
    expect(slot.x < block.x + block.width && block.x < slot.x + slot.width && slot.y < block.y + block.height && block.y < slot.y + slot.height).toBe(false); // clear of the existing block
    expect(freeBlockSlot(state, ROOT_SHEET_ID)).toEqual(slot);
    // reorder among siblings only; the root never moves
    const three: SchematicState = { ...state, sheets: { version: 1, sheets: [{ id: ROOT_SHEET_ID, name: "Overview", parentId: null }, { id: "a", name: "A", parentId: ROOT_SHEET_ID }, { id: "b", name: "B", parentId: ROOT_SHEET_ID }, { id: "c", name: "C", parentId: "a" }] } };
    expect(reorderedSheets(three, "b", -1)).toEqual([ROOT_SHEET_ID, "b", "a", "c"]);
    expect(reorderedSheets(three, "a", -1)).toBeNull();
    expect(reorderedSheets(three, "c", 1)).toBeNull();
    expect(reorderedSheets(three, ROOT_SHEET_ID, 1)).toBeNull();
    expect(nextSheetName(three, ROOT_SHEET_ID, "Sheet")).toBe("Sheet");
    expect(nextSheetName(three, ROOT_SHEET_ID, "a")).toBe("a 2");
    expect(sheetNameProblem(three, ROOT_SHEET_ID, " b ")).toMatch(/already exists here/);
    expect(sheetNameProblem(three, ROOT_SHEET_ID, "b", "b")).toBeNull(); // renaming to its own name
    expect(sheetNameProblem(three, ROOT_SHEET_ID, "Power/Aux")).toMatch(/cannot contain/);
    expect(sheetNameProblem(three, ROOT_SHEET_ID, "")).toBe("A sheet needs a name.");
    expect(parentSheetOf(three, "c")).toBe("a");
    expect(parentSheetOf(three, "ghost")).toBe(ROOT_SHEET_ID);
    expect(sheetOfComponentRef(after, "U3")).toBe("sheet-imu");
    expect(sheetOfComponentRef(after, "u3")).toBe("sheet-imu");
    expect(sheetOfComponentRef(after, u3.id)).toBe("sheet-imu");
    expect(sheetOfComponentRef(after, "U1")).toBe(ROOT_SHEET_ID);
    expect(sheetOfComponentRef(after, "U99")).toBeNull();
  });

  it("cross-sheet signals: the overview's sheet pins reach the IMU sheet's hierarchical labels and back, by the port's name", () => {
    const conn = resolveProjectConnectivity(after, lookup);
    expect(conn.ok).toBe(true);
    const onRoot = interfaceSignals(after, conn, ROOT_SHEET_ID);
    const names = onRoot.map((signal) => signal.name);
    expect(names).toEqual(expect.arrayContaining(["I2C_SCL", "I2C_SDA", "IMU_INT1"]));
    const scl = onRoot.find((signal) => signal.name === "I2C_SCL")!;
    expect(scl.scope).toBe("sheet-pin");
    expect(scl.destinations.length).toBeGreaterThan(0);
    expect(scl.destinations.every((destination) => destination.sheetId === "sheet-imu" && destination.sheetPath === "IMU" && destination.sheetName === "IMU")).toBe(true);
    expect(scl.destinations.some((destination) => destination.scope === "hierarchical" && destination.labelName === "I2C_SCL")).toBe(true);
    const onImu = interfaceSignals(after, conn, "sheet-imu");
    const back = onImu.find((signal) => signal.name === "I2C_SCL")!;
    expect(back.scope).toBe("hierarchical");
    expect(back.destinations.some((destination) => destination.sheetId === ROOT_SHEET_ID && destination.sheetPath === "" && destination.labelName === "I2C_SCL")).toBe(true);
    expect(interfaceSignals(drone, resolveProjectConnectivity(drone, lookup), ROOT_SHEET_ID)).toEqual([]);
    expect(sheetsOf(after).map((sheet) => sheet.name)).toEqual(["Overview", "IMU"]);
  });
});
