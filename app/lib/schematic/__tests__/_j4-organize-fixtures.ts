/**
 * [PR-J4, 2026-10-23] Section J increment 4 (J4-C) fixtures: the FLAT fixture drone as a formatVersion-1 project file the browser proof
 * opens before organising it (`fixtures/j4-drone-flat-project.sirkit.json`: project id "j4-drone-flat", name "Drone (flat)", exportedAt
 * 2026-10-23T00:00:00.000Z, the j3 fixture's recipe without sheets), the generation plan's blocks as organise HINTS (the J3 sheets plus the
 * MCU block the j3 fixture kept on the overview), and the deterministic grouping the planner proposes WITHOUT hints (pinned by
 * j4-organize-sheets and read by the browser spec). Not a test file itself; nothing here touches the network.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SchematicState } from "@/lib/schematic-types";
import type { OrganizeHint } from "../sheet-organization";
import { J3_ROOT_REFS, J3_SHEETS } from "./_j3-fixtures";

const DIR = join(process.cwd(), "app", "lib", "schematic", "__tests__", "fixtures");

export const J4_FLAT_PROJECT_ID = "j4-drone-flat";
export const J4_FLAT_PROJECT_NAME = "Drone (flat)";
export const J4_FLAT_EXPORTED_AT = "2026-10-23T00:00:00.000Z";
export const J4_FLAT_PROJECT_FILE = join(DIR, "j4-drone-flat-project.sirkit.json");

/** The frozen flat project file's text. */
export function flatDroneProjectFile(): string {
  return readFileSync(J4_FLAT_PROJECT_FILE, "utf8");
}

/** The state the frozen flat project file carries (equal to `droneFixtureState()`; a test proves it). */
export function flatDroneProjectState(): SchematicState {
  return (JSON.parse(flatDroneProjectFile()) as { payload: { project: { state: SchematicState } } }).payload.project.state;
}

/** The generation plan's blocks as organise hints: the three j3 sheets and the MCU block (app/lib/fixture-runtime/generation-recipes.ts dronePlan). */
export const J4_DRONE_HINTS: readonly OrganizeHint[] = Object.freeze([
  ...J3_SHEETS.map((sheet) => ({ name: sheet.name, refs: [...sheet.refs] })),
  { name: "Flight controller MCU", refs: [...J3_ROOT_REFS] },
]);

/** The planner's proposal for the flat drone WITHOUT hints (deterministic; the names come from the hubs' values). */
export const J4_DRONE_PROPOSAL = Object.freeze([
  { name: "MOTOR x4 (J2-J5)", hubs: ["J2", "J3", "J4", "J5"], refs: ["C1", "C3", "D1", "D2", "D3", "D4", "J1", "J2", "J3", "J4", "J5", "Q1", "Q2", "Q3", "Q4", "R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8"], ports: ["PWM1", "PWM2", "PWM3", "PWM4"] },
  { name: "MIC5504-3.3YM5 (U1)", hubs: ["U1"], refs: ["C2", "C4", "C5", "C6", "C8", "C9", "C10", "U1"], ports: [] as string[] },
  { name: "ATmega328P-AU (U2)", hubs: ["U2"], refs: ["C7", "D5", "J6", "J7", "R9", "R10", "U2"], ports: ["I2C_SCL", "I2C_SDA", "IMU_INT1", "PWM1", "PWM2", "PWM3", "PWM4"] },
  { name: "LSM6DS3TR-C (U3)", hubs: ["U3"], refs: ["R11", "R12", "U3"], ports: ["I2C_SCL", "I2C_SDA", "IMU_INT1"] },
] as const);

/** The planner's proposal for the flat drone WITH the plan's blocks as hints: the j3 fixture's grouping, plus the MCU as its own sheet. */
export const J4_DRONE_HINTED_PROPOSAL = Object.freeze([
  { name: "Motor drivers", hubs: ["J2", "J3", "J4", "J5"], refs: ["D1", "D2", "D3", "D4", "J2", "J3", "J4", "J5", "Q1", "Q2", "Q3", "Q4", "R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8"], ports: ["PWM1", "PWM2", "PWM3", "PWM4"] },
  { name: "Power", hubs: ["U1"], refs: ["C1", "C2", "C3", "J1", "U1"], ports: [] as string[] },
  { name: "Flight controller MCU", hubs: ["U2"], refs: ["C4", "C5", "C6", "C7", "C8", "D5", "J6", "J7", "R9", "R10", "U2"], ports: ["I2C_SCL", "I2C_SDA", "IMU_INT1", "PWM1", "PWM2", "PWM3", "PWM4"] },
  { name: "IMU", hubs: ["U3"], refs: ["C9", "C10", "R11", "R12", "U3"], ports: ["I2C_SCL", "I2C_SDA", "IMU_INT1"] },
] as const);
