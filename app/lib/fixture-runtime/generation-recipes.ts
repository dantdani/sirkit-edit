/**
 * [PR-L6, 2026-10-19] Runbook L.7 items 9 and 10 (OD-253 (1)-(4)): the DATA of the fixture runtime's scripted generation provider - the
 * design recipes the engine (`generation-policy.ts`) follows when it answers the slice core's real turns. Pure data and two pure
 * readers: no catalog, no container, no network.
 *
 *  - A recipe is chosen by the request's FEATURES (`requestFeatures`), never by the exact sentence: a drone / quadcopter / multirotor
 *    with one to four motors (and optionally a barometer), a 555 PWM LED dimmer, a 555 LED blinker. Anything else has no recipe.
 *  - A recipe names ROLES (what to search for and what a returned part must satisfy: its category, its pin names, its pin count, its
 *    value keys) and the circuit over those roles (components by reference, connections by PIN NAME). It names no catalog part id:
 *    every partId and every pin number of a submission comes from the search results the provider actually received.
 *  - The blinker is an exact transcription of `BLINKER_NETLIST` (its five recorded searches, its components, its connections in order
 *    and its explanation verbatim), so the recorded blinker design and the prompt-to-Gerber replay stay unchanged.
 *  - The drone is designed as four planned blocks (power and 3.3 V regulator; N motor driver stages; the flight-controller MCU; the
 *    IMU), with the disclosed assumptions of OD-253 (2) and the requested coverage in its plan; a requested barometer adds a fifth block
 *    whose part the fixture catalog does not hold (the honest missing-part path).
 *
 * Truth boundary: the ATmega328P pin-function table below (which port pin carries PWM, I2C, the interrupt and the ISP lines) is
 * engineering knowledge held in recipe DATA, not catalog authority; the engine refuses to design when a returned part lacks a named pin.
 * Fake-backed: a scripted provider over a committed catalog - not a live model, a live catalog or a datasheet check.
 */
import { BLINKER_NETLIST } from "./blinker/catalog";
import type { ComponentRole, NetLabelKind } from "@/lib/schematic-types";

/** One catalog search a role may make: its words and the catalog category (the fixture catalog's own singular names). */
export interface RoleQuery { query: string; category?: string }
/** What a part must be to fill a role. Every pin a connection names on a component of the role is required too. */
export interface RoleSpec {
  key: string;
  /** the role in words, for the provider's text reply when no returned part fits it */
  label: string;
  /** the first query and its alternatives, tried in order (one per turn) */
  queries: readonly RoleQuery[];
  category?: string;
  pinCount?: number;
  /** must match the returned name / MPN / description (catalog text the provider reads, as a model would) */
  text?: RegExp;
  requiredPins?: readonly string[];
}
/** A component: its reference, its role, the values it may take (the first one the chosen part can be ordered at) or the part's name. */
export interface ComponentSpec { ref: string; role: string; values: readonly string[] | "part-name"; componentRole: ComponentRole; parent?: string }
/** A pin of a component by NAME (`U1:VCC`, every pin of that name for a label), a `/`-separated name token (`U1:~{RESET}`), or `#n` (a
 *  pin NUMBER, for parts whose pins are unnamed: resistors and capacitors). */
export type PinRef = string;
export type ConnectionSpec = { label: PinRef; net: string; kind?: NetLabelKind } | { wire: readonly [PinRef, PinRef] };
export interface DesignSpec {
  /** the provider's id prefix for this design's tool calls */
  key: string;
  roles: readonly RoleSpec[];
  components: readonly ComponentSpec[];
  connections: readonly ConnectionSpec[];
  explanation: string;
}
export interface PlanSpec {
  blocks: Array<{ name: string; brief: string; sharedNets: string[] }>;
  rationale: string;
  /** material assumptions the plan discloses (OD-253 (3)) */
  assumptions: string[];
  /** the requested functional coverage the plan keeps */
  coverage: string[];
}
export type RequestRecipe =
  | { kind: "single"; key: "blinker" | "led-dimmer"; design: DesignSpec }
  | { kind: "planned"; key: "drone"; motors: number; barometer: boolean; plan: PlanSpec };

// ─── Features ────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The marker a strategy seed starts with (worker/progress.ts `strategySeedText`): what follows it is not the user's request. */
export const STRATEGY_SEED_MARKER = "\n\n[Design strategy";
export const DRONE_MAX_MOTORS = 4;

const COUNT_WORDS: Readonly<Record<string, number>> = Object.freeze({ one: 1, single: 1, two: 2, twin: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 });
/** The request's features the recipe choice reads (the text before any strategy seed; case and punctuation do not matter). */
export interface RequestFeatures { drone: boolean; motors: number | null; barometer: boolean; ledDimmer: boolean; blinker: boolean }
export function requestFeatures(request: string): RequestFeatures {
  const text = request.split(STRATEGY_SEED_MARKER)[0]!.toLowerCase();
  const quad = /\bquad[\s-]?(?:copter|rotor)s?\b|\bquad\b/.test(text);
  const drone = quad || /\b(?:drones?|multi[\s-]?(?:copter|rotor)s?|tri[\s-]?copters?|hexa[\s-]?copters?|octo[\s-]?copters?|bi[\s-]?copters?)\b/.test(text);
  let motors: number | null = null;
  const counted = /\b(\d{1,2}|one|single|two|twin|three|four|five|six|seven|eight)[\s-]*(?:x\s*)?(?:(?:small|tiny|brushed|brushless|coreless|dc|bldc|mini|micro|propeller|prop)[\s-]+){0,3}motors?\b/.exec(text);
  if (counted) motors = /^\d+$/.test(counted[1]!) ? Number(counted[1]) : COUNT_WORDS[counted[1]!] ?? null;
  else if (quad) motors = 4;
  else if (/\btri[\s-]?copters?\b/.test(text)) motors = 3;
  else if (/\bhexa[\s-]?copters?\b/.test(text)) motors = 6;
  else if (/\bocto[\s-]?copters?\b/.test(text)) motors = 8;
  else if (/\bbi[\s-]?copters?\b/.test(text)) motors = 2;
  const barometer = /\b(?:barometers?|barometric|altimeter|pressure sensors?|bmp\d{3})\b/.test(text);
  const led = /\bleds?\b/.test(text);
  const ledDimmer = led && /\b(?:dimm(?:er|ing|able)?|brightness|fad(?:e|er|ing)|pwm)\b/.test(text);
  const blinker = /\b555\b/.test(text) && /\b(?:blink(?:er|ing|s)?|astable|flash(?:er|ing)?)\b/.test(text);
  return { drone, motors, barometer, ledDimmer, blinker };
}

/** The recipe the request's features select, or null (no recipe: the provider declines rather than invent a circuit). */
export function selectRecipe(request: string): RequestRecipe | null {
  const features = requestFeatures(request);
  if (features.drone) {
    const motors = features.motors ?? 4;
    if (!Number.isSafeInteger(motors) || motors < 1 || motors > DRONE_MAX_MOTORS) return null;
    return { kind: "planned", key: "drone", motors, barometer: features.barometer, plan: dronePlan(motors, features.barometer) };
  }
  if (features.ledDimmer) return { kind: "single", key: "led-dimmer", design: LED_DIMMER };
  if (features.blinker) return { kind: "single", key: "blinker", design: BLINKER };
  return null;
}

// ─── Shared roles ────────────────────────────────────────────────────────────────────────────────────────────────────────

const RESISTOR: RoleSpec = { key: "resistor", label: "0805 resistor", queries: [{ query: "0805 resistor", category: "Resistor" }, { query: "resistor" }], category: "Resistor", pinCount: 2 };
const CAPACITOR: RoleSpec = { key: "capacitor", label: "0805 capacitor", queries: [{ query: "0805 capacitor", category: "Capacitor" }, { query: "capacitor" }], category: "Capacitor", pinCount: 2 };
const LED: RoleSpec = { key: "led", label: "0805 LED", queries: [{ query: "0805 LED", category: "LED" }, { query: "LED" }], category: "LED", pinCount: 2 };
const HEADER_2: RoleSpec = { key: "header2", label: "2-pin 2.54 mm header", queries: [{ query: "2-pin 2.54 mm header connector", category: "Connector" }, { query: "pin header connector" }], category: "Connector", pinCount: 2 };
const TIMER: RoleSpec = { key: "timer", label: "555 timer", queries: [{ query: "NE555 timer SOIC-8", category: "Timer" }, { query: "555 timer" }], category: "Timer", text: /555/ };
const NMOS: RoleSpec = { key: "nmos", label: "logic-level N-channel MOSFET", queries: [{ query: "AO3400A N-channel MOSFET SOT-23", category: "Transistor" }, { query: "N-channel MOSFET logic-level" }], category: "Transistor", text: /mosfet|nmos|n-channel/i };

/** The blinker's five recorded searches (query, catalog category), in order - the first query of each blinker role. */
export const BLINKER_SEARCHES = Object.freeze([TIMER, RESISTOR, CAPACITOR, LED, HEADER_2].map((role) => Object.freeze({ query: role.queries[0]!.query, category: role.queries[0]!.category! })));

// ─── The blinker (an exact transcription of BLINKER_NETLIST) ─────────────────────────────────────────────────────────────

const BLINKER: DesignSpec = {
  key: "blinker",
  roles: [TIMER, RESISTOR, CAPACITOR, LED, HEADER_2],
  components: [
    { ref: "U1", role: "timer", values: ["NE555D"], componentRole: "processor" },
    { ref: "R1", role: "resistor", values: ["10k"], componentRole: "passive" },
    { ref: "R2", role: "resistor", values: ["56k"], componentRole: "passive" },
    { ref: "R3", role: "resistor", values: ["330"], componentRole: "passive" },
    { ref: "C1", role: "capacitor", values: ["10uF"], componentRole: "passive" },
    { ref: "C2", role: "capacitor", values: ["100nF"], componentRole: "support", parent: "U1" },
    { ref: "C3", role: "capacitor", values: ["10nF"], componentRole: "support", parent: "U1" },
    { ref: "D1", role: "led", values: ["LED"], componentRole: "indicator" },
    { ref: "J1", role: "header2", values: ["PWR_5V"], componentRole: "connector" },
  ],
  connections: [
    { label: "U1:VCC", net: "VCC" }, { label: "U1:~{RST}", net: "VCC" }, { label: "R1:#1", net: "VCC" }, { label: "C2:#1", net: "VCC" }, { label: "J1:Pin_1", net: "VCC" },
    { label: "U1:GND", net: "GND" }, { label: "C1:#2", net: "GND" }, { label: "C2:#2", net: "GND" }, { label: "C3:#2", net: "GND" }, { label: "D1:K", net: "GND" }, { label: "J1:Pin_2", net: "GND" },
    { wire: ["R1:#2", "U1:DISCH"] }, { wire: ["R2:#1", "U1:DISCH"] }, { wire: ["R2:#2", "U1:THRES"] }, { wire: ["R2:#2", "U1:TRIG"] }, { wire: ["C1:#1", "U1:THRES"] },
    { wire: ["C3:#1", "U1:CONT"] },
    { wire: ["U1:OUT", "R3:#1"] }, { wire: ["R3:#2", "D1:A"] },
  ],
  explanation: BLINKER_NETLIST.explanation,
};

// ─── The LED dimmer (L.7 item 10: the second ordinary circuit, OD-253 (4)) ───────────────────────────────────────────────

const POTENTIOMETER: RoleSpec = { key: "potentiometer", label: "10k potentiometer", queries: [{ query: "10k potentiometer trimmer", category: "Potentiometer" }, { query: "potentiometer" }], category: "Potentiometer", pinCount: 3 };
const SIGNAL_DIODE: RoleSpec = { key: "signal-diode", label: "1N4148 switching diode", queries: [{ query: "1N4148 switching diode", category: "Diode" }, { query: "1N4148 diode" }], category: "Diode", pinCount: 2, text: /1n4148/i };

const LED_DIMMER: DesignSpec = {
  key: "led-dimmer",
  roles: [TIMER, RESISTOR, POTENTIOMETER, SIGNAL_DIODE, CAPACITOR, NMOS, LED, HEADER_2],
  components: [
    { ref: "U1", role: "timer", values: ["NE555D"], componentRole: "processor" },
    { ref: "R1", role: "resistor", values: ["330"], componentRole: "passive" },
    { ref: "RV1", role: "potentiometer", values: ["10k"], componentRole: "input" },
    { ref: "D1", role: "signal-diode", values: "part-name", componentRole: "passive" },
    { ref: "D2", role: "signal-diode", values: "part-name", componentRole: "passive" },
    { ref: "C1", role: "capacitor", values: ["10nF"], componentRole: "passive" },
    { ref: "C2", role: "capacitor", values: ["10nF"], componentRole: "support", parent: "U1" },
    { ref: "C3", role: "capacitor", values: ["100nF"], componentRole: "support", parent: "U1" },
    { ref: "R2", role: "resistor", values: ["330"], componentRole: "passive" },
    { ref: "R3", role: "resistor", values: ["10k"], componentRole: "passive" },
    { ref: "Q1", role: "nmos", values: "part-name", componentRole: "output" },
    { ref: "D3", role: "led", values: ["LED"], componentRole: "indicator" },
    { ref: "R4", role: "resistor", values: ["330"], componentRole: "passive" },
    { ref: "J1", role: "header2", values: ["PWR_5V"], componentRole: "connector" },
  ],
  connections: [
    { label: "U1:VCC", net: "VCC" }, { label: "U1:~{RST}", net: "VCC" }, { label: "R1:#1", net: "VCC" }, { label: "C3:#1", net: "VCC" }, { label: "R4:#1", net: "VCC" }, { label: "J1:Pin_1", net: "VCC" },
    { label: "U1:GND", net: "GND" }, { label: "C1:#2", net: "GND" }, { label: "C2:#2", net: "GND" }, { label: "C3:#2", net: "GND" }, { label: "R3:#2", net: "GND" }, { label: "Q1:S", net: "GND" }, { label: "J1:Pin_2", net: "GND" },
    // timing: R1 to DISCH, the pot's wiper on DISCH; D1 charges TIMING through the pot's pin-1 side, D2 discharges it through the pin-3 side
    { wire: ["R1:#2", "U1:DISCH"] }, { wire: ["RV1:2", "U1:DISCH"] },
    { wire: ["D1:A", "RV1:1"] }, { label: "D1:K", net: "TIMING" }, { label: "D2:A", net: "TIMING" }, { wire: ["D2:K", "RV1:3"] },
    { label: "U1:THRES", net: "TIMING" }, { label: "U1:TRIG", net: "TIMING" }, { label: "C1:#1", net: "TIMING" },
    { wire: ["C2:#1", "U1:CONT"] },
    // output: gate resistor and pulldown, the MOSFET switches the LED's cathode, R4 limits the LED current
    { wire: ["U1:OUT", "R2:#1"] }, { wire: ["R2:#2", "Q1:G"] }, { wire: ["R3:#1", "Q1:G"] },
    { wire: ["Q1:D", "D3:K"] }, { wire: ["D3:A", "R4:#2"] },
  ],
  explanation:
    "555 PWM LED dimmer: R1=330 from VCC to DISCH; the 10k potentiometer's wiper (RV1 pin 2) is on DISCH, so C1=10nF charges through R1, the pin-1 side of the pot and D1, and discharges through D2, the pin-3 side and DISCH. The duty cycle follows the wiper while the period stays about 0.693 x (330 + 10k) x 10nF ~ 72 us (~14 kHz). " +
    "OUT drives the AO3400A gate through R2=330 with R3=10k to GND; the MOSFET switches the LED cathode, R4=330 limits the LED to ~9 mA from 5 V. C2=10nF bypasses CONT; C3=100nF decouples VCC. J1 is the 5 V/GND header (pin 1 = +5 V, pin 2 = GND).",
};

// ─── The drone (L.7 item 9: four planned blocks, OD-253 (1)-(3)) ─────────────────────────────────────────────────────────

export const DRONE_BLOCK_NAMES = Object.freeze({
  power: "Power input and 3.3 V regulator",
  motors: "Motor driver stages",
  mcu: "Flight controller MCU",
  imu: "IMU",
  barometer: "Barometer",
} as const);

const LDO: RoleSpec = { key: "ldo", label: "3.3 V LDO regulator", queries: [{ query: "MIC5504 3.3V LDO regulator", category: "Regulator" }, { query: "3.3V LDO regulator" }], category: "Regulator", requiredPins: ["VIN", "GND", "EN", "VOUT"] };
const SCHOTTKY: RoleSpec = { key: "schottky", label: "Schottky flyback diode", queries: [{ query: "SS14 Schottky diode", category: "Diode" }, { query: "Schottky diode" }], category: "Diode", pinCount: 2, text: /schottky/i };
const MCU: RoleSpec = { key: "mcu", label: "ATmega328P microcontroller", queries: [{ query: "ATmega328P microcontroller TQFP-32", category: "MCU" }, { query: "ATmega328P microcontroller" }], category: "MCU", pinCount: 32, text: /atmega328p/i };
const IMU: RoleSpec = { key: "imu", label: "6-axis IMU (accelerometer and gyroscope)", queries: [{ query: "LSM6DS3 IMU accelerometer gyroscope", category: "Sensor" }, { query: "LSM6DS3 IMU" }], category: "Sensor", text: /lsm6ds3/i };
const HEADER_ISP: RoleSpec = { key: "header-isp", label: "2x3 2.54 mm ISP header", queries: [{ query: "2x3 6-pin 2.54 mm ISP header connector", category: "Connector" }, { query: "2x3 pin header" }], category: "Connector", pinCount: 6 };
const HEADER_UART: RoleSpec = { key: "header-uart", label: "4-pin 2.54 mm header", queries: [{ query: "4-pin 2.54 mm header connector", category: "Connector" }, { query: "1x4 pin header" }], category: "Connector", pinCount: 4 };
const BAROMETER: RoleSpec = { key: "barometer", label: "BMP280 barometric pressure sensor", queries: [{ query: "BMP280", category: "Sensor" }, { query: "BMP280 barometer" }], category: "Sensor", text: /bmp280|barometer|barometric/i };

/** The ATmega328P port pin of PWM channel n (1..4): OC0A (PD6), OC0B (PD5), OC1A (PB1), OC1B (PB2) - recipe knowledge, not catalog data. */
const MCU_PWM_PINS = Object.freeze(["PD6", "PD5", "PB1", "PB2"]);
const pwmNets = (motors: number): string[] => Array.from({ length: motors }, (_, index) => `PWM${index + 1}`);

// The drone blocks join their local nets by named labels (M1_GATE, MISO, LED_A, ...) rather than wires, and their decoupling capacitors
// are "support" parts without an anchoring parent: measured on the page's own layout (`autoLayoutBuildValidated`), the four-motor merge
// drawn with wires and parent-anchored capacitors overlapped parts and shorted a motor drain onto +3V3 in the DRAWING (an unintended
// merge the validator caught); with labels and unanchored support parts every motor count validates.
function powerBlock(): DesignSpec {
  return {
    key: "drone-power",
    roles: [HEADER_2, LDO, CAPACITOR],
    components: [
      { ref: "J1", role: "header2", values: ["BATT_1S"], componentRole: "source" },
      { ref: "U1", role: "ldo", values: "part-name", componentRole: "regulator" },
      { ref: "C1", role: "capacitor", values: ["10uF"], componentRole: "support" },
      { ref: "C2", role: "capacitor", values: ["10uF"], componentRole: "support" },
      { ref: "C3", role: "capacitor", values: ["10uF"], componentRole: "passive" },
    ],
    connections: [
      { label: "J1:Pin_1", net: "VBAT", kind: "power" }, { label: "J1:Pin_2", net: "GND" },
      { label: "U1:VIN", net: "VBAT", kind: "power" }, { label: "U1:EN", net: "VBAT", kind: "power" }, { label: "U1:GND", net: "GND" }, { label: "U1:VOUT", net: "+3V3" },
      { label: "C1:#1", net: "VBAT", kind: "power" }, { label: "C1:#2", net: "GND" },
      { label: "C2:#1", net: "+3V3" }, { label: "C2:#2", net: "GND" },
      { label: "C3:#1", net: "VBAT", kind: "power" }, { label: "C3:#2", net: "GND" },
    ],
    explanation: "Battery input and 3.3 V rail: J1 takes one 1S LiPo cell (pin 1 = VBAT, pin 2 = GND). U1, a MIC5504-3.3 LDO, has VIN and EN on VBAT and VOUT on +3V3, with C1=10uF at its input and C2=10uF at its output; C3=10uF is bulk capacitance on VBAT for the motor current. The 3.3 V rail falls out of regulation below about 3.5 V of battery.",
  };
}

function motorBlock(motors: number): DesignSpec {
  const components: ComponentSpec[] = [], connections: ConnectionSpec[] = [];
  for (let n = 1; n <= motors; n += 1) {
    const q = `Q${n}`, rg = `R${2 * n - 1}`, rp = `R${2 * n}`, d = `D${n}`, j = `J${n}`, gate = `M${n}_GATE`, drain = `M${n}_DRAIN`;
    components.push(
      { ref: q, role: "nmos", values: "part-name", componentRole: "output" },
      { ref: rg, role: "resistor", values: ["330"], componentRole: "passive" },
      { ref: rp, role: "resistor", values: ["10k"], componentRole: "passive" },
      { ref: d, role: "schottky", values: "part-name", componentRole: "passive" },
      { ref: j, role: "header2", values: [`MOTOR${n}`], componentRole: "connector" },
    );
    connections.push(
      { label: `${rg}:#1`, net: `PWM${n}` }, { label: `${rg}:#2`, net: gate }, { label: `${q}:G`, net: gate }, { label: `${rp}:#1`, net: gate }, { label: `${rp}:#2`, net: "GND" },
      { label: `${q}:S`, net: "GND" }, { label: `${q}:D`, net: drain }, { label: `${j}:Pin_2`, net: drain }, { label: `${d}:A`, net: drain },
      { label: `${d}:K`, net: "VBAT", kind: "power" }, { label: `${j}:Pin_1`, net: "VBAT", kind: "power" },
    );
  }
  return {
    key: "drone-motors",
    roles: [NMOS, RESISTOR, SCHOTTKY, HEADER_2],
    components, connections,
    explanation: `${motors} low-side motor driver stage(s): each AO3400A (Q1..Q${motors}) switches its brushed motor's return (J pin 2) to GND, driven from PWM1..PWM${motors} through a 330 gate resistor with a 10k gate pulldown (the motor stays off while the MCU resets); an SS14 Schottky (D1..D${motors}) clamps the motor's flyback to VBAT; J pin 1 is VBAT. Sized for coreless motors of about 1 A each.`,
  };
}

function mcuBlock(motors: number): DesignSpec {
  const connections: ConnectionSpec[] = [
    { label: "U1:VCC", net: "+3V3" }, { label: "U1:AVCC", net: "+3V3" }, { label: "U1:GND", net: "GND" },
    { label: "C1:#1", net: "+3V3" }, { label: "C1:#2", net: "GND" }, { label: "C2:#1", net: "+3V3" }, { label: "C2:#2", net: "GND" },
    { label: "C3:#1", net: "+3V3" }, { label: "C3:#2", net: "GND" },
    { label: "U1:AREF", net: "AREF" }, { label: "C4:#1", net: "AREF" }, { label: "C4:#2", net: "GND" },
    { label: "C5:#1", net: "+3V3" }, { label: "C5:#2", net: "GND" },
    { label: "R1:#1", net: "+3V3" }, { label: "R1:#2", net: "RESET" }, { label: "U1:~{RESET}", net: "RESET" },
    ...pwmNets(motors).map((net, index): ConnectionSpec => ({ label: `U1:${MCU_PWM_PINS[index]!}`, net })),
    { label: "U1:PC4", net: "I2C_SDA" }, { label: "U1:PC5", net: "I2C_SCL" }, { label: "U1:PD2", net: "IMU_INT1" },
    // the 6-pin AVR ISP header: 1 MISO, 2 VCC, 3 SCK, 4 MOSI, 5 RESET, 6 GND
    { label: "J1:Pin_1", net: "MISO" }, { label: "U1:PB4", net: "MISO" }, { label: "J1:Pin_2", net: "+3V3" }, { label: "J1:Pin_3", net: "SCK" }, { label: "U1:PB5", net: "SCK" },
    { label: "J1:Pin_4", net: "MOSI" }, { label: "U1:PB3", net: "MOSI" }, { label: "J1:Pin_5", net: "RESET" }, { label: "J1:Pin_6", net: "GND" },
    // the receiver UART header: 1 GND, 2 +3V3, 3 RXD (PD0), 4 TXD (PD1)
    { label: "J2:Pin_1", net: "GND" }, { label: "J2:Pin_2", net: "+3V3" }, { label: "J2:Pin_3", net: "UART_RXD" }, { label: "U1:PD0", net: "UART_RXD" }, { label: "J2:Pin_4", net: "UART_TXD" }, { label: "U1:PD1", net: "UART_TXD" },
    // the status LED on PB0
    { label: "U1:PB0", net: "LED_DRV" }, { label: "R2:#1", net: "LED_DRV" }, { label: "R2:#2", net: "LED_A" }, { label: "D1:A", net: "LED_A" }, { label: "D1:K", net: "GND" },
  ];
  const pins = MCU_PWM_PINS.slice(0, motors).map((pin, index) => `PWM${index + 1} on ${pin}`).join(", ");
  return {
    key: "drone-mcu",
    roles: [MCU, CAPACITOR, RESISTOR, LED, HEADER_ISP, HEADER_UART],
    components: [
      { ref: "U1", role: "mcu", values: "part-name", componentRole: "processor" },
      { ref: "C1", role: "capacitor", values: ["100nF"], componentRole: "support" },
      { ref: "C2", role: "capacitor", values: ["100nF"], componentRole: "support" },
      { ref: "C3", role: "capacitor", values: ["100nF"], componentRole: "support" },
      { ref: "C4", role: "capacitor", values: ["100nF"], componentRole: "support" },
      { ref: "C5", role: "capacitor", values: ["10uF"], componentRole: "support" },
      { ref: "R1", role: "resistor", values: ["10k"], componentRole: "passive" },
      { ref: "J1", role: "header-isp", values: ["ISP"], componentRole: "connector" },
      { ref: "J2", role: "header-uart", values: ["UART_RX"], componentRole: "connector" },
      { ref: "R2", role: "resistor", values: ["330"], componentRole: "passive" },
      { ref: "D1", role: "led", values: ["LED"], componentRole: "indicator" },
    ],
    connections,
    explanation: `ATmega328P-AU flight controller on its internal 8 MHz oscillator: VCC (pins 4, 6) and AVCC (18) on +3V3 with 100nF each (C1-C3) and a 10uF bulk (C5), AREF decoupled by C4=100nF, RESET pulled up by R1=10k. ${pins} (timer compare outputs); I2C_SDA on PC4, I2C_SCL on PC5; the IMU interrupt on INT0 (PD2). J1 is the 6-pin AVR ISP header (MISO, VCC, SCK, MOSI, RESET, GND); J2 the UART header for an external receiver (GND, +3V3, RXD, TXD). D1 with R2=330 on PB0 is a status LED. No firmware is supplied.`,
  };
}

function imuBlock(): DesignSpec {
  return {
    key: "drone-imu",
    roles: [IMU, RESISTOR, CAPACITOR],
    components: [
      { ref: "U1", role: "imu", values: "part-name", componentRole: "input" },
      { ref: "R1", role: "resistor", values: ["10k"], componentRole: "passive" },
      { ref: "R2", role: "resistor", values: ["10k"], componentRole: "passive" },
      { ref: "C1", role: "capacitor", values: ["100nF"], componentRole: "support" },
      { ref: "C2", role: "capacitor", values: ["100nF"], componentRole: "support" },
    ],
    connections: [
      { label: "U1:VDD", net: "+3V3" }, { label: "U1:VDDIO", net: "+3V3" }, { label: "U1:GND", net: "GND" }, { label: "U1:CS", net: "+3V3" },
      { label: "U1:SA0", net: "GND" }, { label: "U1:SDX", net: "GND" }, { label: "U1:SCX", net: "GND" },
      { label: "U1:SDA", net: "I2C_SDA" }, { label: "U1:SCL", net: "I2C_SCL" }, { label: "U1:INT1", net: "IMU_INT1" },
      { label: "R1:#1", net: "+3V3" }, { label: "R1:#2", net: "I2C_SDA" }, { label: "R2:#1", net: "+3V3" }, { label: "R2:#2", net: "I2C_SCL" },
      { label: "C1:#1", net: "+3V3" }, { label: "C1:#2", net: "GND" }, { label: "C2:#1", net: "+3V3" }, { label: "C2:#2", net: "GND" },
    ],
    explanation: "LSM6DS3TR-C 6-axis IMU on I2C at address 0x6A (SA0 to GND; CS high selects I2C): VDD and VDDIO on +3V3 with C1 and C2 = 100nF, R1 and R2 = 10k pull-ups on I2C_SDA and I2C_SCL, INT1 to IMU_INT1. The auxiliary bus (SDX, SCX) is tied to GND; INT2 and pins 10/11 are left open.",
  };
}

function barometerBlock(): DesignSpec {
  return {
    key: "drone-barometer",
    roles: [BAROMETER, CAPACITOR],
    components: [
      { ref: "U1", role: "barometer", values: "part-name", componentRole: "input" },
      { ref: "C1", role: "capacitor", values: ["100nF"], componentRole: "support" },
    ],
    connections: [
      { label: "U1:VDD", net: "+3V3" }, { label: "U1:VDDIO", net: "+3V3" }, { label: "U1:GND", net: "GND" }, { label: "U1:CSB", net: "+3V3" }, { label: "U1:SDO", net: "GND" },
      { label: "U1:SDI", net: "I2C_SDA" }, { label: "U1:SCK", net: "I2C_SCL" },
      { label: "C1:#1", net: "+3V3" }, { label: "C1:#2", net: "GND" },
    ],
    explanation: "BMP280 barometric pressure sensor on the shared I2C bus (CSB high selects I2C, SDO to GND sets address 0x76), VDD and VDDIO on +3V3 with C1=100nF.",
  };
}

/** The drone's plan for `motors` (1..4) motors, with a barometer block when one was requested. */
export function dronePlan(motors: number, barometer: boolean): PlanSpec {
  const pwm = pwmNets(motors);
  const blocks = [
    { name: DRONE_BLOCK_NAMES.power, brief: "One 1S LiPo battery header and a MIC5504 3.3 V LDO with input, output and bulk capacitors: VBAT for the motors and +3V3 for the logic.", sharedNets: ["VBAT", "+3V3", "GND"] },
    { name: DRONE_BLOCK_NAMES.motors, brief: `${motors} low-side N-MOSFET (AO3400A) motor driver stage(s), each with a gate resistor, a gate pulldown, a Schottky flyback diode and a 2-pin motor header, driven by ${pwm.join(", ")}.`, sharedNets: ["VBAT", "GND", ...pwm] },
    { name: DRONE_BLOCK_NAMES.mcu, brief: `ATmega328P flight-controller MCU on its internal 8 MHz oscillator with decoupling, a reset pull-up, a 6-pin ISP header, a 4-pin UART header for a receiver and a status LED; ${pwm.join(", ")} to the motor drivers, I2C and the IMU interrupt to the IMU.`, sharedNets: ["+3V3", "GND", ...pwm, "I2C_SDA", "I2C_SCL", "IMU_INT1"] },
    { name: DRONE_BLOCK_NAMES.imu, brief: "LSM6DS3 6-axis IMU (accelerometer and gyroscope) on I2C with pull-ups and decoupling; INT1 to the MCU.", sharedNets: ["+3V3", "GND", "I2C_SDA", "I2C_SCL", "IMU_INT1"] },
    ...(barometer ? [{ name: DRONE_BLOCK_NAMES.barometer, brief: "BMP280 barometric pressure sensor on the shared I2C bus with decoupling.", sharedNets: ["+3V3", "GND", "I2C_SDA", "I2C_SCL"] }] : []),
  ];
  return {
    blocks,
    rationale: `A minimal ${motors}-motor drone controller in ${blocks.length} blocks: battery input and a 3.3 V LDO; ${motors} low-side MOSFET motor driver(s) with flyback diodes; an ATmega328P flight controller with ISP and UART headers; an LSM6DS3 IMU on I2C${barometer ? "; a BMP280 barometer on I2C" : ""}. Assumed: brushed 1S coreless motors (~1 A each), a 1S LiPo without charger or protection, the internal 8 MHz oscillator, a UART header for a receiver (no radio), no firmware or flight qualification.`,
    assumptions: [
      `Motors: ${motors} brushed 1S coreless DC motor(s) of about 1 A each, switched low-side; brushless motors would need ESCs instead.`,
      "Supply: one 1S LiPo cell (3.0-4.2 V) on a 2-pin header; no charger, protection or fuel gauge on this board.",
      "Regulation: a MIC5504 3.3 V LDO for the logic; it falls out of regulation below about 3.5 V of battery.",
      "Clock: the ATmega328P runs from its internal 8 MHz oscillator; no crystal.",
      "Radio: none; a 4-pin UART header is provided for an external receiver.",
      "No firmware and no flight qualification are supplied: this is a schematic proposal, not a flight-tested controller.",
    ],
    coverage: [
      "battery input and 3.3 V regulation",
      `${motors} motor driver stage(s) with flyback protection`,
      "flight-controller MCU with ISP programming and a receiver UART",
      "6-axis IMU (accelerometer and gyroscope) on I2C",
      ...(barometer ? ["barometric pressure sensor on I2C (requested)"] : []),
    ],
  };
}

/** The design of one planned drone block, from its name and its shared nets (the motor count is the number of PWMn nets); null when
 *  the block is not one of the drone recipe's. */
export function droneBlockDesign(name: string, sharedNets: readonly string[]): DesignSpec | null {
  const trimmed = name.trim();
  const motors = sharedNets.filter((net) => /^PWM[1-9]$/.test(net.trim().toUpperCase())).length;
  switch (trimmed) {
    case DRONE_BLOCK_NAMES.power: return powerBlock();
    case DRONE_BLOCK_NAMES.motors: return motors >= 1 && motors <= DRONE_MAX_MOTORS ? motorBlock(motors) : null;
    case DRONE_BLOCK_NAMES.mcu: return motors >= 1 && motors <= DRONE_MAX_MOTORS ? mcuBlock(motors) : null;
    case DRONE_BLOCK_NAMES.imu: return imuBlock();
    case DRONE_BLOCK_NAMES.barometer: return barometerBlock();
    default: return null;
  }
}

/** Every design a recipe may produce (the suites check each one's electrical sanity on the fixture pins). */
export function allRecipeDesigns(): Array<{ name: string; design: DesignSpec }> {
  const out: Array<{ name: string; design: DesignSpec }> = [{ name: "blinker", design: BLINKER }, { name: "led-dimmer", design: LED_DIMMER }];
  for (let motors = 1; motors <= DRONE_MAX_MOTORS; motors += 1) {
    for (const block of dronePlan(motors, true).blocks) {
      const design = droneBlockDesign(block.name, block.sharedNets);
      if (design) out.push({ name: `drone(${motors}) ${block.name}`, design });
    }
  }
  return out;
}
