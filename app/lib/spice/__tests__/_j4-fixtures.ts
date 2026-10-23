/**
 * [PR-J4, 2026-10-23] Section J increment 4 SPICE fixtures (shared by j4-spice-sheets and j4-ir-sheets; not a test file itself).
 *
 *  - `twoSubsystemTheory()`: a flat Theory circuit of two subsystems - a 5 V source with a two-resistor divider (V1, R1, R2, G1, G2)
 *    and a diode load (R3, D1, G3) fed from the divider's midpoint by one wire.
 *  - `splitTwoSubsystemTheory()`: the same circuit after the move-to-sheet planner moved the diode load (with its attached wires) onto
 *    the child sheet "Diode load": the midpoint net crosses through an explicit port. Deterministic ids (planner prefix "j4-load").
 *  - `railsAndReturnsTheory(kind)`: a source and ground symbol on the overview, R1 on the overview returning to a ground-kind AGND
 *    label, R2 on sheet "A" returning to a ground-kind DGND label, a +3V3 power label on the overview, on sheet "A" and on sheet "B"
 *    (one rail by exact name), and a local OUT label on sheet "A" and on sheet "B" (two nets). `kind` drops the ground symbol ("lone"
 *    keeps only AGND; "ambiguous" keeps AGND and DGND with no GND).
 *  - `multiSheetDimmer()`: the fixture LED dimmer (j2-dimmer-state, five KiCad parts) with U1 moved onto the child sheet "Timer" by the
 *    planner - its RA / TIMING / PWM / RB locals cross through ports, VCC and GND stay rails.
 * Every id is deterministic; no random draw anywhere.
 */
import { kicadPinWorldPos, pinWorldPos, pointKey } from "@/app/lib/geometry";
import type { KicadPin } from "@/app/lib/kicad/types";
import { planMoveToSheet, type MoveEntityRef } from "@/app/lib/schematic/sheet-operations";
import { PIN_NAMES, ROOT_SHEET_ID, type NetLabel, type Point, type SchComponent, type SchComponentType, type SchematicSheet, type SchematicState, type Wire } from "@/lib/schematic-types";
import { fixturePartLookup } from "@/app/lib/schematic/__tests__/_j1-fixtures";
import { dimmerFixtureState } from "@/app/lib/schematic/__tests__/_j2-fixtures";

export const comp = (id: string, type: SchComponentType, x: number, y: number, value = "1k", sheetId?: string): SchComponent => ({ id, type, x, y, rotation: 0, value, ...(sheetId ? { sheetId } : {}) });
export const wire = (id: string, vertices: Point[], sheetId?: string): Wire => ({ id, vertices, ...(sheetId ? { sheetId } : {}) });
export const label = (id: string, name: string, position: Point, extra: Partial<NetLabel> = {}): NetLabel => ({ id, position, name, kind: "label", orientation: 0, ...extra });
export const sheet = (id: string, name: string, parentId: string | null = ROOT_SHEET_ID, extra: Partial<SchematicSheet> = {}): SchematicSheet => ({ id, name, parentId, ...extra });
export const tree = (...children: SchematicSheet[]): NonNullable<SchematicState["sheets"]> => ({ version: 1, sheets: [sheet(ROOT_SHEET_ID, "Overview", null), ...children] });
export const pin = (component: SchComponent, name: string): Point => pinWorldPos(component, name);

export function twoSubsystemTheory(): SchematicState {
  const v1 = comp("V1", "voltage-source", 100, 200, "5");
  const g1 = comp("G1", "ground", 100, 260, "");
  const r1 = comp("R1", "resistor", 200, 170, "1k");
  const r2 = comp("R2", "resistor", 300, 170, "2k");
  const g2 = comp("G2", "ground", 330, 220, "");
  const r3 = comp("R3", "resistor", 500, 170, "470");
  const d1 = comp("D1", "diode", 600, 170, "1N4148");
  const g3 = comp("G3", "ground", 630, 220, "");
  const mid = { x: 250, y: 170 };
  return {
    components: [v1, g1, r1, r2, g2, r3, d1, g3],
    wires: [
      wire("w-v1-r1", [pin(v1, "+"), pin(r1, "left")]),
      wire("w-v1-g1", [pin(v1, "-"), pin(g1, "pin")]),
      wire("w-r1-r2", [pin(r1, "right"), mid, pin(r2, "left")]),
      wire("w-r2-g2", [pin(r2, "right"), pin(g2, "pin")]),
      wire("w-mid-r3", [mid, { x: 250, y: 120 }, { x: 470, y: 120 }, pin(r3, "left")]),
      wire("w-r3-d1", [pin(r3, "right"), pin(d1, "anode")]),
      wire("w-d1-g3", [pin(d1, "cathode"), pin(g3, "pin")]),
    ],
    netLabels: [],
  };
}

/** The Theory components named, the wires touching their pins and the labels at those wires' ends (the j1 / j3 selection rule). */
export function attachedTheorySelection(state: SchematicState, ids: readonly string[]): MoveEntityRef[] {
  const components = state.components.filter((item) => ids.includes(item.id));
  if (components.length !== ids.length) throw new Error(`attachedTheorySelection: ${ids.length} named, ${components.length} found`);
  const pinKeys = new Set(components.flatMap((item) => (PIN_NAMES[item.type] ?? []).map((name) => pointKey(pinWorldPos(item, name)))));
  const wires = state.wires.filter((item) => pinKeys.has(pointKey(item.vertices[0]!)) || pinKeys.has(pointKey(item.vertices[item.vertices.length - 1]!)));
  const ends = new Set([...pinKeys, ...wires.flatMap((item) => [pointKey(item.vertices[0]!), pointKey(item.vertices[item.vertices.length - 1]!)])]);
  const labels = (state.netLabels ?? []).filter((item) => ends.has(pointKey(item.position)));
  return [...components.map((item) => ({ family: "theory" as const, id: item.id })), ...wires.map((item) => ({ family: "wire" as const, id: item.id })), ...labels.map((item) => ({ family: "label" as const, id: item.id }))];
}

export const LOAD_SHEET_ID = "sheet-load";

export function splitTwoSubsystemTheory(): { flat: SchematicState; split: SchematicState; portName: string } {
  const flat = twoSubsystemTheory();
  const plan = planMoveToSheet(flat, {
    entities: attachedTheorySelection(flat, ["R3", "D1", "G3"]),
    target: { newSheet: { id: LOAD_SHEET_ID, name: "Diode load", block: { x: 400, y: 400, width: 300, height: 150 } } },
    rootName: "Overview",
    operationIdPrefix: "j4-load",
  });
  if (!plan.ok) throw new Error(`${plan.code}: ${plan.message}`);
  if (plan.preview.crossings.length !== 1) throw new Error(`expected one crossing, got ${plan.preview.crossings.length}`);
  return { flat, split: plan.after, portName: plan.preview.crossings[0]!.port.name };
}

export function railsAndReturnsTheory(kind: "strict" | "lone" | "ambiguous" = "strict"): SchematicState {
  const v1 = comp("V1", "voltage-source", 100, 200, "5");
  const g1 = comp("G1", "ground", 100, 260, "");
  const r1 = comp("R1", "resistor", 200, 170, "1k");
  const r2 = comp("R2", "resistor", 200, 170, "2k", "sa");
  const r3 = comp("R3", "resistor", 200, 300, "3k", "sb");
  const r4 = comp("R4", "resistor", 400, 170, "4k", "sa");
  const r5 = comp("R5", "resistor", 400, 170, "5k", "sb");
  const components = [v1, ...(kind === "strict" ? [g1] : []), r1, r2, r3, r4, r5];
  const netLabels: NetLabel[] = [
    label("l-agnd", "AGND", pin(r1, "right"), { kind: "ground" }),
    ...(kind === "lone" ? [] : [label("l-dgnd", "DGND", pin(r2, "right"), { kind: "ground", sheetId: "sa" })]),
    label("l-3v3-root", "+3V3", pin(r1, "left"), { kind: "power" }),
    label("l-3v3-a", "+3V3", pin(r2, "left"), { kind: "power", sheetId: "sa" }),
    label("l-3v3-b", "+3V3", pin(r3, "left"), { kind: "power", sheetId: "sb" }),
    label("l-out-a", "OUT", pin(r4, "right"), { sheetId: "sa" }),
    label("l-out-b", "OUT", pin(r5, "right"), { sheetId: "sb" }),
  ];
  return {
    components,
    wires: [wire("w-v1-r1", [pin(v1, "+"), pin(r1, "left")]), wire("w-v1-g1", [pin(v1, "-"), pin(g1, "pin")])],
    netLabels,
    sheets: tree(sheet("sa", "A"), sheet("sb", "B")),
  };
}

export const TIMER_SHEET_ID = "sheet-timer";

/** The components named, the wires touching their KiCad pins and the labels on those pins or wire ends (j3's attachedSelection). */
function attachedKicadSelection(state: SchematicState, refs: readonly string[], partLookup: (partId: string) => { pins: readonly KicadPin[] } | null): MoveEntityRef[] {
  const instances = (state.kicadComponents ?? []).filter((item) => refs.includes(item.refDes));
  if (instances.length !== refs.length) throw new Error(`attachedKicadSelection: ${refs.length} named, ${instances.length} found`);
  const pinKeys = new Set(instances.flatMap((item) => (partLookup(item.partId)?.pins ?? []).map((kicadPin) => pointKey(kicadPinWorldPos(item, kicadPin)))));
  const wires = state.wires.filter((item) => pinKeys.has(pointKey(item.vertices[0]!)) || pinKeys.has(pointKey(item.vertices[item.vertices.length - 1]!)));
  const ends = new Set([...pinKeys, ...wires.flatMap((item) => [pointKey(item.vertices[0]!), pointKey(item.vertices[item.vertices.length - 1]!)])]);
  const labels = (state.netLabels ?? []).filter((item) => ends.has(pointKey(item.position)));
  return [...instances.map((item) => ({ family: "kicad" as const, id: item.id })), ...wires.map((item) => ({ family: "wire" as const, id: item.id })), ...labels.map((item) => ({ family: "label" as const, id: item.id }))];
}

export function multiSheetDimmer(): { flat: SchematicState; split: SchematicState; portNames: string[] } {
  const lookup = fixturePartLookup();
  const flat = dimmerFixtureState();
  const plan = planMoveToSheet(flat, {
    entities: attachedKicadSelection(flat, ["U1"], lookup),
    target: { newSheet: { id: TIMER_SHEET_ID, name: "Timer", block: { x: 900, y: 100, width: 300, height: 150 } } },
    rootName: "Overview",
    operationIdPrefix: "j4-timer",
  }, lookup);
  if (!plan.ok) throw new Error(`${plan.code}: ${plan.message}`);
  return { flat, split: plan.after, portNames: plan.preview.crossings.map((crossing) => crossing.port.name).sort() };
}
