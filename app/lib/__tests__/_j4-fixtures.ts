/**
 * [PR-J4, 2026-10-23] Section J increment 4 fixtures for the hierarchical KiCad export (shared by the J4-B suites; not a test file).
 *
 *  - `stageFixture()`: a DEPTH-2 hierarchy built from the fixture catalog's resistor (`b16-1c-part-r`, Device:R, pins "1" above and "2"
 *    below at rotation 0): R1 on the overview feeds the "Stage" sheet through the port SIG (its sheet pin sits at the end of a root
 *    wire, NOT on the block edge, as the editor's planner leaves it); Stage holds R2 and feeds its own child "Inner" through the port IN
 *    (input); Inner holds R3 returning to the GND rail; R1's other pin is on the +3V3 rail. Four nets: {R1.1}, {R1.2, R2.1},
 *    {R2.2, R3.1}, {R3.2}.
 *  - `globalFixture()`: three sheets (overview + two children): a scope "global" CLK label on the overview and on "Clock", a LOCAL CLK
 *    label on "Sensors" (its own net), every second pin on GND.
 *  - `unpinnedInstances(state)`: the same document without the exact-revision fields, so a route test exports from the catalog mock
 *    instead of loading published snapshots (the hierarchy does not depend on them).
 *  - [PR-J4 integration, 2026-10-23] `collinearPinsFixture()` (review J4R-OUT-1): two child blocks side by side on the overview, A
 *    {400,100,300,200} with port PA anchored at (400,50) above its top-left corner and B {800,100,300,200} with port PB anchored at
 *    (200,100), level with the blocks' top edge, so PB's nearest edge point (800,100) would be reached by a straight wire passing exactly
 *    over PA's pin at (400,100); R1 / R2 on the overview feed PA / PB, R3 on A and R4 on B carry the hierarchical labels. Six nets:
 *    {R1.1, R3.1}, {R2.1, R4.1} and four singletons - the exporter must keep R1/R3 apart from R2/R4.
 * Every coordinate is on the 10 px grid; every id is a literal (no randomness).
 */
import { kicadPinWorldPos } from "@/app/lib/geometry";
import { ROOT_SHEET_ID, type KicadComponentInstance, type NetLabel, type SchematicState } from "@/lib/schematic-types";
import { fixtureParts } from "../schematic/__tests__/_j1-fixtures";

export const J4_RESISTOR_PART_ID = "b16-1c-part-r";

function resistor(id: string, refDes: string, x: number, y: number, sheetId?: string): KicadComponentInstance {
  return { id, partId: J4_RESISTOR_PART_ID, x, y, rotation: 0, refDes, value: "1k", ...(sheetId ? { sheetId } : {}) };
}

/** The world position of the fixture resistor's pin "1" (above) or "2" (below). */
export function resistorPin(instance: KicadComponentInstance, number: "1" | "2"): { x: number; y: number } {
  const part = fixtureParts().get(J4_RESISTOR_PART_ID);
  if (!part) throw new Error("the fixture catalog has no resistor");
  const pin = part.pins.find((item) => item.number === number);
  if (!pin) throw new Error(`the fixture resistor has no pin ${number}`);
  return kicadPinWorldPos(instance, pin);
}

export function stageFixture(): SchematicState {
  const r1 = resistor("j4-r1", "R1", 200, 200);
  const r2 = resistor("j4-r2", "R2", 200, 200, "stage");
  const r3 = resistor("j4-r3", "R3", 200, 200, "inner");
  const labels: NetLabel[] = [
    { id: "j4-l-3v3", position: resistorPin(r1, "1"), name: "+3V3", kind: "power", orientation: 0 },
    { id: "j4-pin-stage-sig", position: { x: 200, y: 300 }, name: "SIG", kind: "label", orientation: 0, scope: "sheet-pin", portId: "j4-port-sig", childSheetId: "stage" },
    { id: "j4-lbl-stage-sig", position: resistorPin(r2, "1"), name: "SIG", kind: "label", orientation: 0, sheetId: "stage", scope: "hierarchical", portId: "j4-port-sig" },
    { id: "j4-pin-inner-in", position: { x: 200, y: 300 }, name: "IN", kind: "label", orientation: 0, sheetId: "stage", scope: "sheet-pin", portId: "j4-port-in", childSheetId: "inner" },
    { id: "j4-lbl-inner-in", position: resistorPin(r3, "1"), name: "IN", kind: "label", orientation: 0, sheetId: "inner", scope: "hierarchical", portId: "j4-port-in" },
    { id: "j4-l-gnd", position: resistorPin(r3, "2"), name: "GND", kind: "ground", orientation: 0, sheetId: "inner" },
  ];
  return {
    components: [],
    kicadComponents: [r1, r2, r3],
    wires: [
      { id: "j4-w-root", vertices: [resistorPin(r1, "2"), { x: resistorPin(r1, "2").x, y: 300 }] },
      { id: "j4-w-stage", sheetId: "stage", vertices: [resistorPin(r2, "2"), { x: resistorPin(r2, "2").x, y: 300 }] },
    ],
    netLabels: labels,
    pageSize: "A4",
    sheets: {
      version: 1,
      sheets: [
        { id: ROOT_SHEET_ID, name: "Overview", parentId: null },
        { id: "stage", name: "Stage", parentId: ROOT_SHEET_ID, block: { x: 400, y: 100, width: 300, height: 200 }, ports: [{ id: "j4-port-sig", name: "SIG", direction: "passive" }] },
        { id: "inner", name: "Inner", parentId: "stage", block: { x: 400, y: 100, width: 300, height: 200 }, ports: [{ id: "j4-port-in", name: "IN", direction: "input" }] },
      ],
    },
  };
}

export function globalFixture(): SchematicState {
  const r1 = resistor("j4-g-r1", "R1", 200, 200);
  const r2 = resistor("j4-g-r2", "R2", 200, 200, "clock");
  const r3 = resistor("j4-g-r3", "R3", 200, 200, "sensors");
  return {
    components: [],
    kicadComponents: [r1, r2, r3],
    wires: [],
    netLabels: [
      { id: "j4-g-clk-root", position: resistorPin(r1, "1"), name: "CLK", kind: "label", orientation: 0, scope: "global" },
      { id: "j4-g-clk-clock", position: resistorPin(r2, "1"), name: "CLK", kind: "label", orientation: 0, sheetId: "clock", scope: "global" },
      { id: "j4-g-clk-sensors", position: resistorPin(r3, "1"), name: "CLK", kind: "label", orientation: 0, sheetId: "sensors" },
      { id: "j4-g-gnd-root", position: resistorPin(r1, "2"), name: "GND", kind: "ground", orientation: 0 },
      { id: "j4-g-gnd-clock", position: resistorPin(r2, "2"), name: "GND", kind: "ground", orientation: 0, sheetId: "clock" },
      { id: "j4-g-gnd-sensors", position: resistorPin(r3, "2"), name: "GND", kind: "ground", orientation: 0, sheetId: "sensors" },
    ],
    pageSize: "A4",
    sheets: {
      version: 1,
      sheets: [
        { id: ROOT_SHEET_ID, name: "Overview", parentId: null },
        { id: "clock", name: "Clock", parentId: ROOT_SHEET_ID, block: { x: 400, y: 100, width: 300, height: 200 } },
        { id: "sensors", name: "Sensors", parentId: ROOT_SHEET_ID, block: { x: 800, y: 100, width: 300, height: 200 } },
      ],
    },
  };
}

/** [PR-J4 integration, 2026-10-23] Review J4R-OUT-1's geometry (see the header): a later sheet pin's straight wire would cross an earlier pin. */
export function collinearPinsFixture(): SchematicState {
  const r1 = resistor("x-r1", "R1", 100, 100);
  const r2 = resistor("x-r2", "R2", 100, 300);
  const r3 = resistor("x-r3", "R3", 200, 200, "a");
  const r4 = resistor("x-r4", "R4", 200, 200, "b");
  return {
    components: [],
    kicadComponents: [r1, r2, r3, r4],
    wires: [
      { id: "x-w1", vertices: [resistorPin(r1, "1"), { x: 400, y: 50 }] },
      { id: "x-w2", vertices: [resistorPin(r2, "1"), { x: 200, y: 100 }] },
    ],
    netLabels: [
      { id: "x-pin-a", position: { x: 400, y: 50 }, name: "PA", kind: "label", orientation: 0, scope: "sheet-pin", portId: "x-port-a", childSheetId: "a" },
      { id: "x-lbl-a", position: resistorPin(r3, "1"), name: "PA", kind: "label", orientation: 0, sheetId: "a", scope: "hierarchical", portId: "x-port-a" },
      { id: "x-pin-b", position: { x: 200, y: 100 }, name: "PB", kind: "label", orientation: 0, scope: "sheet-pin", portId: "x-port-b", childSheetId: "b" },
      { id: "x-lbl-b", position: resistorPin(r4, "1"), name: "PB", kind: "label", orientation: 0, sheetId: "b", scope: "hierarchical", portId: "x-port-b" },
    ],
    pageSize: "A4",
    sheets: {
      version: 1,
      sheets: [
        { id: ROOT_SHEET_ID, name: "Overview", parentId: null },
        { id: "a", name: "A", parentId: ROOT_SHEET_ID, block: { x: 400, y: 100, width: 300, height: 200 }, ports: [{ id: "x-port-a", name: "PA", direction: "passive" }] },
        { id: "b", name: "B", parentId: ROOT_SHEET_ID, block: { x: 800, y: 100, width: 300, height: 200 }, ports: [{ id: "x-port-b", name: "PB", direction: "passive" }] },
      ],
    },
  };
}

/** The document with every exact-revision field removed from its KiCad instances (the hierarchy export does not read them). */
export function unpinnedInstances(state: SchematicState): SchematicState {
  return {
    ...state,
    kicadComponents: (state.kicadComponents ?? []).map((instance) => {
      const copy: KicadComponentInstance = { ...instance };
      for (const key of ["atomicPartRevisionId", "symbolAssetVersionId", "footprintAssetVersionId", "mappingCertificateId", "selectionRecordId"] as const) delete copy[key];
      return copy;
    }),
  };
}
