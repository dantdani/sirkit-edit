/**
 * [PR-J3, 2026-10-22] Section J increment 3 fixtures (shared by the J3 suites and the browser spec; not a test file itself).
 *
 * `buildMultiSheetDrone()` organises the fixture four-motor drone (`j1-drone-state.json`, 41 instances, one page) into a root
 * overview and THREE real subsystem sheets with the move-to-sheet planner (three canonical, equivalence-proven moves), grouped by the
 * planner's own function blocks (app/lib/fixture-runtime/generation-recipes.ts dronePlan, final reference designators from the merge):
 *
 *   Overview (root)  the flight-controller MCU block stays here: U2, C4-C8, R9, R10, J6 (ISP), J7 (UART), D5
 *   Power            J1 (battery header), U1 (MIC5504 LDO), C1-C3 - no ports: VBAT, +3V3 and GND are project rails by name
 *   Motor drivers    Q1-Q4, R1-R8, D1-D4, J2-J5 - ports PWM1..PWM4 (the MCU's drive signals), M<n>_GATE / M<n>_DRAIN stay local
 *   IMU              U3, R11, R12 (I2C pull-ups), C9, C10 - ports I2C_SCL, I2C_SDA, IMU_INT1 (the planner lists them by name)
 *
 * Every id is deterministic: sheet ids "sheet-power" / "sheet-motors" / "sheet-imu", operation ids from the prefixes, port and
 * anchor ids derived by the planner from the net identities. No random draw anywhere (the fixture browser's uuid sequence stays).
 * The frozen files:
 *  - `fixtures/j3-drone-sheets-state.json`: the organised state (what `buildMultiSheetDrone()` returns);
 *  - `fixtures/j3-drone-sheets-project.sirkit.json`: the project file `exportProjectFile` writes for it (formatVersion 2, project id
 *    "j3-drone-sheets", exportedAt 2026-10-22T00:00:00.000Z), opened by e2e/j3-multi-sheet.spec.ts through the page's file input.
 * A test (j3-fixture-readability) proves the frozen state equals the builder's output and the file imports and re-exports byte for byte.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { KicadPin } from "@/app/lib/kicad/types";
import { kicadPinWorldPos, pointKey } from "@/app/lib/geometry";
import { planMoveToSheet, type MoveEntityRef } from "@/app/lib/schematic/sheet-operations";
import type { SchematicSheetSnapshot } from "@/app/lib/engineering/types";
import type { SchematicState } from "@/lib/schematic-types";
import { droneFixtureState, fixturePartLookup } from "./_j1-fixtures";

const DIR = join(process.cwd(), "app", "lib", "schematic", "__tests__", "fixtures");

export const J3_FIXTURE_PROJECT_ID = "j3-drone-sheets";
export const J3_FIXTURE_PROJECT_NAME = "Drone (sheets)";
export const J3_FIXTURE_EXPORTED_AT = "2026-10-22T00:00:00.000Z";
export const J3_STATE_FILE = join(DIR, "j3-drone-sheets-state.json");
export const J3_PROJECT_FILE = join(DIR, "j3-drone-sheets-project.sirkit.json");

/** The three subsystem sheets, in the order they are created (and listed after the root). */
export const J3_SHEETS = Object.freeze([
  { id: "sheet-power", name: "Power", refs: ["J1", "U1", "C1", "C2", "C3"], block: { x: 400, y: 1640, width: 500, height: 200 }, ports: [] as readonly string[] },
  { id: "sheet-motors", name: "Motor drivers", refs: ["Q1", "Q2", "Q3", "Q4", "R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "D1", "D2", "D3", "D4", "J2", "J3", "J4", "J5"], block: { x: 1100, y: 1640, width: 500, height: 200 }, ports: ["PWM1", "PWM2", "PWM3", "PWM4"] as readonly string[] },
  { id: "sheet-imu", name: "IMU", refs: ["U3", "R11", "R12", "C9", "C10"], block: { x: 1800, y: 1640, width: 500, height: 200 }, ports: ["I2C_SCL", "I2C_SDA", "IMU_INT1"] as readonly string[] },
] as const);
export const J3_ROOT_NAME = "Overview";
/** The parts that stay on the overview (the planner's MCU block). */
export const J3_ROOT_REFS = Object.freeze(["U2", "C4", "C5", "C6", "C7", "C8", "R9", "R10", "J6", "J7", "D5"]);

/** The components named, the wires touching their pins, and the labels on their pins or on those wires' ends (j1-sheet-operations). */
export function attachedSelection(state: SchematicState, refs: readonly string[], partLookup: (partId: string) => { pins: readonly KicadPin[] } | null): MoveEntityRef[] {
  const instances = (state.kicadComponents ?? []).filter((item) => refs.includes(item.refDes));
  if (instances.length !== refs.length) throw new Error(`attachedSelection: ${refs.length} references named, ${instances.length} found`);
  const pinKeys = new Set(instances.flatMap((item) => (partLookup(item.partId)?.pins ?? []).map((pin) => pointKey(kicadPinWorldPos(item, pin)))));
  const wires = state.wires.filter((item) => pinKeys.has(pointKey(item.vertices[0]!)) || pinKeys.has(pointKey(item.vertices[item.vertices.length - 1]!)));
  const ends = new Set([...pinKeys, ...wires.flatMap((item) => [pointKey(item.vertices[0]!), pointKey(item.vertices[item.vertices.length - 1]!)])]);
  const labels = (state.netLabels ?? []).filter((item) => ends.has(pointKey(item.position)));
  return [...instances.map((item) => ({ family: "kicad" as const, id: item.id })), ...wires.map((item) => ({ family: "wire" as const, id: item.id })), ...labels.map((item) => ({ family: "label" as const, id: item.id }))];
}

export interface MultiSheetDroneBuild {
  state: SchematicState;
  /** Each move's preview, in creation order (Power, Motor drivers, IMU). */
  previews: Array<{ sheetId: string; crossings: Array<{ netName: string | null; portName: string }>; renamedNets: Array<{ from: string; to: string | null }> }>;
}

/** Organise the fixture drone into the three subsystem sheets with the move-to-sheet planner; throws on any refusal. */
export function buildMultiSheetDrone(): MultiSheetDroneBuild {
  const lookup = fixturePartLookup();
  let state = droneFixtureState();
  const previews: MultiSheetDroneBuild["previews"] = [];
  for (const sheet of J3_SHEETS) {
    const block: SchematicSheetSnapshot["block"] = { ...sheet.block };
    const plan = planMoveToSheet(state, {
      entities: attachedSelection(state, sheet.refs, lookup),
      target: { newSheet: { id: sheet.id, name: sheet.name, block } },
      rootName: J3_ROOT_NAME,
      operationIdPrefix: `j3-${sheet.id}`,
    }, lookup);
    if (!plan.ok) throw new Error(`${sheet.name}: ${plan.code}: ${plan.message}`);
    previews.push({ sheetId: sheet.id, crossings: plan.preview.crossings.map((crossing) => ({ netName: crossing.netName, portName: crossing.port.name })), renamedNets: plan.preview.renamedNets.map((item) => ({ from: item.from, to: item.to })) });
    state = plan.after;
  }
  return { state, previews };
}

/** The frozen organised drone (`fixtures/j3-drone-sheets-state.json`). */
export function multiSheetDroneFixtureState(): SchematicState {
  return JSON.parse(readFileSync(J3_STATE_FILE, "utf8")) as SchematicState;
}

/** The frozen project file's text (`fixtures/j3-drone-sheets-project.sirkit.json`). */
export function multiSheetDroneProjectFile(): string {
  return readFileSync(J3_PROJECT_FILE, "utf8");
}
