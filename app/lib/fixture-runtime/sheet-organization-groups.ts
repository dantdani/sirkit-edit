/**
 * [PR-J5, 2026-10-23] Runbook J.3 item 4 and J.6.4 (OD-259 item 4): the DATA the fixture runtime's scripted agent proposes when a user
 * asks it to "Organize this schematic into subsystem sheets" - the groups (a sheet name and the reference designators it holds) for the
 * two fixture designs a flat page may hold: the 555 PWM LED dimmer (14 parts) and the drone with one to four motors (the final reference
 * designators of the merged planned result; 41 parts for four motors). Pure data and two pure readers. This module imports NOTHING, so
 * the chat closure that carries the scripted agent gains no module when the adapter imports it (the b19-d / b24-c1 closure pins).
 * [PR-J5 integration, 2026-10-26] the adapter imports it now (review J5R-AI-6): the chat closure gains exactly this one module and
 * nothing behind it; no closure pin enumerates the adapter's closure, and b24-c1 / b19-d stay green unmoved.
 *
 * The shape is the organise planner's closed input (`OrganizeGroupInput { name, refs }`, app/lib/schematic/sheet-organization.ts), spelt
 * structurally here so that module is not imported. The drone's groups are the generation plan's own blocks: one sheet per block, named
 * after the block (the recipe's `DRONE_BLOCK_NAMES`), holding every part the merge gave that block; j5-fixture-recipes pins both
 * equalities and plans each grouping through the real planner (one transaction, the pin-to-net partition kept). The dimmer's grouping is
 * the one the J5 plan names: the 555 timing core, the LED driver it switches, the power header. Its ONE boundary crossing is the
 * connection from U1 OUT to the gate resistor R2; `crossings` names it by the two parts it joins (layout-independent: the page's layout
 * draws that connection as a wire or, when no clean route exists, as a deterministically named label pair, and the planner's port takes
 * the net's name - `SIG1` for an unnamed wire, the label's name otherwise) and suggests the port name PWM_OUT for it.
 *
 * Consumed by the fixture agent adapter's organise turn (builder A): after `sirkit.schematic.inspect` it reads the reference designators
 * the inspection returned and takes `fixtureSheetOrganizationFor(refs)` - the matching design's groups, or null (no proposal is invented
 * for a schematic it does not know); a run with no schematic read (no PCB board yet, so no canonical-state resource) tries
 * `fixtureSheetOrganizationCandidates()` in order through the tool, which refuses every proposal naming a part the schematic does not
 * hold; `fixtureSheetOrganizationArgs` spells one as the tool's input. Nothing here applies anything: the proposal is sealed by the tool and applied only by the user's
 * Approve (J.6.6 "structural changes remain properly reviewed canonical mutations").
 */

/** One proposed sheet: its name (sibling-unique, no "/", at most 80 characters) and the catalog parts it holds, by reference designator. */
export interface FixtureSheetGroup { name: string; refs: readonly string[] }
/** A whole proposal for one fixture design. */
export interface FixtureSheetOrganization {
  key: "led-dimmer" | "drone";
  /** the drone's motor count (1..4); null for the dimmer */
  motors: number | null;
  groups: readonly FixtureSheetGroup[];
  /** why these groups, in the scripted model's words (the proposal card's rationale; at most 600 characters) */
  rationale: string;
  /** the boundary crossings the model expects, each named by the two parts it joins, with the port name it suggests (OD-257 item 6:
   *  the planner names an unnamed crossing SIG<n>; the model may supply a name) */
  crossings: readonly FixtureSheetCrossing[];
}
/** One expected boundary crossing: the two parts (reference designators, in different groups) and the suggested port name. */
export interface FixtureSheetCrossing { between: readonly [string, string]; name: string }

/** The chat sentence the scripted agent answers with a sheet-organisation proposal (the composer routes it to the assistant). */
export const ORGANIZE_SHEETS_SENTENCE = "Organize this schematic into subsystem sheets";
export const DRONE_SHEET_GROUPS_MAX_MOTORS = 4;

/** The dimmer's three subsystems: the timing core, the driver, the power header - every one of its 14 parts exactly once. */
export const LED_DIMMER_SHEET_GROUPS: readonly FixtureSheetGroup[] = Object.freeze([
  Object.freeze({ name: "555 PWM timing", refs: Object.freeze(["C1", "C2", "C3", "D1", "D2", "R1", "RV1", "U1"]) }),
  Object.freeze({ name: "LED driver", refs: Object.freeze(["D3", "Q1", "R2", "R3", "R4"]) }),
  Object.freeze({ name: "Power input", refs: Object.freeze(["J1"]) }),
]);
export const LED_DIMMER_SHEET_RATIONALE =
  "Three subsystems: the 555 timing core (U1 with its timing network R1, RV1, D1, D2, C1 and its decoupling C2, C3), the LED driver it switches (the gate resistor R2, the pulldown R3, Q1, the LED D3 and its limiter R4) and the 5 V input header J1. One signal crosses a boundary - U1 OUT to R2 - and becomes a port; VCC and GND are project rails.";
/** The dimmer's one crossing (U1 OUT to the gate resistor R2); the model suggests the port name PWM_OUT. */
export const LED_DIMMER_CROSSINGS: readonly FixtureSheetCrossing[] = Object.freeze([Object.freeze({ between: Object.freeze(["U1", "R2"] as const), name: "PWM_OUT" })]);

/** The drone blocks' names - the recipe's `DRONE_BLOCK_NAMES`, repeated here so this module imports nothing (pinned equal by a test). */
export const DRONE_SHEET_NAMES = Object.freeze({
  power: "Power input and 3.3 V regulator",
  motors: "Motor driver stages",
  mcu: "Flight controller MCU",
  imu: "IMU",
} as const);

const range = (prefix: string, from: number, to: number): string[] => Array.from({ length: Math.max(0, to - from + 1) }, (_, index) => `${prefix}${from + index}`);

/**
 * The drone's groups for `motors` (1..4) motors: the generation plan's four blocks with the FINAL reference designators the merge assigns
 * (plan order; each prefix numbered on across blocks): the power block J1 / U1 / C1-C3; the motor stages Q1..Qn, R1..R2n, D1..Dn and the
 * headers J2..J(n+1); the MCU U2 with C4-C8, R(2n+1) (reset pull-up), J(n+2) (ISP), J(n+3) (UART), R(2n+2) and D(n+1) (status LED); the IMU
 * U3 with R(2n+3), R(2n+4) and C9, C10. Natural order inside each group. Null outside 1..4 (no recipe designs more motors).
 */
export function droneSheetGroups(motors: number): readonly FixtureSheetGroup[] | null {
  if (!Number.isSafeInteger(motors) || motors < 1 || motors > DRONE_SHEET_GROUPS_MAX_MOTORS) return null;
  const n = motors;
  return [
    { name: DRONE_SHEET_NAMES.power, refs: ["C1", "C2", "C3", "J1", "U1"] },
    { name: DRONE_SHEET_NAMES.motors, refs: [...range("D", 1, n), ...range("J", 2, n + 1), ...range("Q", 1, n), ...range("R", 1, 2 * n)] },
    { name: DRONE_SHEET_NAMES.mcu, refs: ["C4", "C5", "C6", "C7", "C8", `D${n + 1}`, `J${n + 2}`, `J${n + 3}`, `R${2 * n + 1}`, `R${2 * n + 2}`, "U2"] },
    { name: DRONE_SHEET_NAMES.imu, refs: ["C9", "C10", `R${2 * n + 3}`, `R${2 * n + 4}`, "U3"] },
  ];
}
/** The owner's four-motor drone (41 parts). */
export const DRONE_SHEET_GROUPS: readonly FixtureSheetGroup[] = droneSheetGroups(4)!;

export function droneSheetRationale(motors: number): string {
  const pwm = range("PWM", 1, motors).join(", ");
  return `The generation plan's four blocks: battery input and the 3.3 V regulator; the ${motors} motor driver stage${motors === 1 ? "" : "s"}; the flight-controller MCU; the IMU. ${pwm} cross${motors === 1 ? "es" : ""} from the MCU to the motor stage${motors === 1 ? "" : "s"}, I2C_SDA, I2C_SCL and IMU_INT1 between the MCU and the IMU; VBAT, +3V3 and GND are project rails.`;
}

const sortedUnique = (refs: readonly string[]): string[] => [...new Set(refs.map((ref) => ref.trim()).filter(Boolean))].sort();
const sameSet = (a: readonly string[], b: readonly string[]): boolean => { const left = sortedUnique(a), right = sortedUnique(b); return left.length === right.length && left.every((ref, index) => ref === right[index]); };

/**
 * The proposal for a flat schematic whose catalog parts are exactly `refs` (order and repeats do not matter): the dimmer's, the drone's for
 * the motor count whose parts these are, or null when the parts are not a fixture design's (the scripted agent then proposes nothing).
 */
export function fixtureSheetOrganizationFor(refs: readonly string[]): FixtureSheetOrganization | null {
  return fixtureSheetOrganizationCandidates().find((organization) => sameSet(refs, organization.groups.flatMap((group) => group.refs))) ?? null;
}

/**
 * [PR-J5, 2026-10-23] Every fixture organisation, in the order a scripted agent tries them when the run has NO schematic read (a
 * schematic-only page: `sirkit.schematic.inspect` needs the canonical-state resource, which the chat context claims only with a PCB
 * board): the dimmer, then the drone from four motors down. The organise tool resolves every member by name and refuses a proposal
 * naming a part the schematic does not hold, so the first proposal the tool SEALS is the design's own - no other order is unambiguous
 * (a drone's groups for k motors name only parts a drone with more motors also holds; the descending order refuses the larger ones
 * first). With a read, `fixtureSheetOrganizationFor(refs)` picks the organisation directly.
 */
export function fixtureSheetOrganizationCandidates(): FixtureSheetOrganization[] {
  const drones = Array.from({ length: DRONE_SHEET_GROUPS_MAX_MOTORS }, (_, index) => DRONE_SHEET_GROUPS_MAX_MOTORS - index).map((motors): FixtureSheetOrganization => ({
    // the drone's crossings are all NAMED nets (PWMn, I2C_SDA, I2C_SCL, IMU_INT1): the planner's ports take those names, nothing to suggest
    key: "drone", motors, groups: droneSheetGroups(motors)!, rationale: droneSheetRationale(motors), crossings: [],
  }));
  return [{ key: "led-dimmer", motors: null, groups: LED_DIMMER_SHEET_GROUPS, rationale: LED_DIMMER_SHEET_RATIONALE, crossings: LED_DIMMER_CROSSINGS }, ...drones];
}

/** [PR-J5, 2026-10-23] The organise tool's arguments for one organisation (`sirkit.schematic.propose-sheet-organization`'s closed input:
 *  groups of { name, members }; fresh arrays, never the frozen data). No `interfaceNames`: the optional crossing names (OD-259 item 4)
 *  key the SIG<n> port a FIRST proposal reported, which the agent learns only from that proposal's result. */
export function fixtureSheetOrganizationArgs(organization: FixtureSheetOrganization): { groups: Array<{ name: string; members: string[] }> } {
  return { groups: organization.groups.map((group) => ({ name: group.name, members: [...group.refs] })) };
}
