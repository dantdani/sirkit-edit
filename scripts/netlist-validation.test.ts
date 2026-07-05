/**
 * Tests for the schematic netlist validator (lib/validate-netlist.ts).
 * Run: npx tsx scripts/netlist-validation.test.ts
 *
 * Builds synthetic geometry by computing real pin world positions, so wires
 * connect (or don't) by exact coincidence — exactly what the validator reads.
 */

import { validateSchematicNetlist, validateTheoryNetlist, rerouteToLabels } from "../lib/validate-netlist";
import { schematicToBuildNetlist } from "../lib/schematic-to-netlist";
import { buildReviewInput } from "../lib/netlist-review";
import { mergeBuildNetlists } from "../app/lib/merge-netlists";
import {
  resolvePinCoincidences,
  resolveComponentCollisions,
  nearestNeighborGaps,
  evaluateRespacing,
  DEFAULT_COMFORT_GAP,
} from "../lib/build-auto-layout";
import { kicadPinWorldPos, pinWorldPos } from "../app/lib/geometry";
import { resolveFootprint, assignFootprints } from "../lib/footprint-assign";
import { planPageFit, pageSizePx } from "../lib/page-sizes";
import { normalizeBuildNetlist, crossCheckNetlists, classifyComponent } from "../lib/netlist-crosscheck";
import { parseSchGenSource } from "../lib/schgen-netlist";
import { componentBodyBox } from "../lib/build-auto-layout";
import type { CachedPart } from "../app/lib/parts-cache";
import type { KicadPin, PinOrientation } from "../app/lib/kicad/types";
import type {
  BuildLogicalNetlist,
  LogicalNetlist,
  KicadComponentInstance,
  NetLabel,
  SchComponent,
  SchComponentType,
  SchematicState,
  Wire,
  Point,
} from "../lib/schematic-types";

// ── synthetic catalog/geometry helpers ──────────────────────────────────────
function mkPart(id: string, value = "1k"): CachedPart {
  const pin = (number: string, xmm: number): KicadPin => ({
    number,
    name: number,
    type: "passive",
    position: { x: xmm, y: 0 },
    orientation: 0,
    length: 2.54,
  });
  return {
    id,
    name: value,
    description: "",
    mpn: null,
    manufacturer: null,
    datasheet: null,
    footprintHint: null,
    mainCategory: "Passive Components",
    libraryName: "Device",
    pins: [pin("1", -2.54), pin("2", 2.54)],
    symbolRaw: "",
    properties: {},
  };
}

function mkInst(refDes: string, partId: string, x: number, y: number): KicadComponentInstance {
  return { id: refDes, partId, x, y, rotation: 0, refDes, value: "1k" };
}

const wire = (a: Point, b: Point): Wire => ({ id: `${a.x},${a.y}-${b.x},${b.y}`, vertices: [a, b] });

// ── tiny assertion harness ──────────────────────────────────────────────────
let failures = 0;
function check(name: string, cond: boolean) {
  console.log(`${cond ? "PASS" : "FAIL"} — ${name}`);
  if (!cond) failures++;
}
const hasKind = (vs: { kind: string }[], k: string) => vs.some((v) => v.kind === k);

// ── shared fixtures ──────────────────────────────────────────────────────────
const PART = "part-2pin";
const parts = new Map<string, CachedPart>([[PART, mkPart(PART)]]);
const part = parts.get(PART)!;
const pinWorld = (inst: KicadComponentInstance, number: string) =>
  kicadPinWorldPos(inst, part.pins.find((p) => p.number === number)!);

function stateOf(insts: KicadComponentInstance[], wires: Wire[]): SchematicState {
  return { components: [], wires, kicadComponents: insts, netLabels: [] };
}

// 1. Happy path — one real connection, no spurious violations.
{
  const r1 = mkInst("R1", PART, 0, 0);
  const r2 = mkInst("R2", PART, 200, 0);
  const w = wire(pinWorld(r1, "2"), pinWorld(r2, "1")); // R1.2 ── R2.1
  const logical: BuildLogicalNetlist = {
    components: [
      { refDes: "R1", partId: PART, value: "1k", role: "passive" },
      { refDes: "R2", partId: PART, value: "1k", role: "passive" },
    ],
    connections: [{ kind: "wire", from: "R1.2", to: "R2.1" }],
    explanation: "",
  };
  const res = validateSchematicNetlist(logical, stateOf([r1, r2], [w]), parts);
  check("happy path is electrically valid", res.ok);
}

// 2. Self-shorted component (2-terminal, both pins on one net, not a jumper).
{
  const r1 = mkInst("R1", PART, 0, 0);
  const w = wire(pinWorld(r1, "1"), pinWorld(r1, "2")); // shorts R1 across itself
  const logical: BuildLogicalNetlist = {
    components: [{ refDes: "R1", partId: PART, value: "1k", role: "passive" }],
    connections: [
      { kind: "label", pin: "R1.1", labelName: "NETA", labelKind: "label" },
      { kind: "label", pin: "R1.2", labelName: "NETB", labelKind: "label" },
    ],
    explanation: "",
  };
  const res = validateSchematicNetlist(logical, stateOf([r1], [w]), parts);
  check("self-short is flagged", hasKind(res.violations, "self-short"));
}

// 2b. Same short, but a 0Ω link is an ALLOWED intentional short.
{
  const jumperParts = new Map<string, CachedPart>([["J0", mkPart("J0", "0")]]);
  const r1 = mkInst("R1", "J0", 0, 0);
  const jp = jumperParts.get("J0")!;
  const pw = (n: string) => kicadPinWorldPos(r1, jp.pins.find((p) => p.number === n)!);
  const w = wire(pw("1"), pw("2"));
  const logical: BuildLogicalNetlist = {
    components: [{ refDes: "R1", partId: "J0", value: "0", role: "passive" }],
    connections: [
      { kind: "label", pin: "R1.1", labelName: "NETA", labelKind: "label" },
      { kind: "label", pin: "R1.2", labelName: "NETB", labelKind: "label" },
    ],
    explanation: "",
  };
  const res = validateSchematicNetlist(logical, stateOf([r1], [w]), jumperParts);
  check("0Ω link self-short is allowed", !hasKind(res.violations, "self-short"));
}

// 3. Unintended net merge (a wire shorts two different components' nets).
{
  const r1 = mkInst("R1", PART, 0, 0);
  const r2 = mkInst("R2", PART, 200, 0);
  const w = wire(pinWorld(r1, "1"), pinWorld(r2, "1")); // R1.1 ── R2.1 (not intended)
  const logical: BuildLogicalNetlist = {
    components: [
      { refDes: "R1", partId: PART, value: "1k", role: "passive" },
      { refDes: "R2", partId: PART, value: "1k", role: "passive" },
    ],
    connections: [
      { kind: "label", pin: "R1.1", labelName: "NETA", labelKind: "label" },
      { kind: "label", pin: "R2.1", labelName: "NETB", labelKind: "label" },
    ],
    explanation: "",
  };
  const res = validateSchematicNetlist(logical, stateOf([r1, r2], [w]), parts);
  check("unintended merge is flagged", hasKind(res.violations, "unintended-merge"));
}

// 4. Floating required pin (netlist connects it, geometry doesn't).
{
  const r1 = mkInst("R1", PART, 0, 0);
  const r2 = mkInst("R2", PART, 200, 0);
  const logical: BuildLogicalNetlist = {
    components: [
      { refDes: "R1", partId: PART, value: "1k", role: "passive" },
      { refDes: "R2", partId: PART, value: "1k", role: "passive" },
    ],
    connections: [{ kind: "wire", from: "R1.2", to: "R2.1" }], // intended, but no wire drawn
    explanation: "",
  };
  const res = validateSchematicNetlist(logical, stateOf([r1, r2], []), parts);
  check("floating required pin is flagged", hasKind(res.violations, "floating-pin"));
  check("…and the missing connection is broken", hasKind(res.violations, "broken-connection"));
}

// 5. Crossing wires WITHOUT a junction do not connect (rule 4).
{
  const r1 = mkInst("R1", PART, 0, 0);
  const r2 = mkInst("R2", PART, 0, 200);
  const a = pinWorld(r1, "1");
  const b = pinWorld(r2, "1");
  // Two wires that geometrically cross at a shared X/Y but never share a vertex.
  const wH = wire({ x: a.x - 40, y: a.y }, { x: a.x + 40, y: a.y });
  const wV = wire({ x: b.x, y: b.y - 40 }, { x: b.x, y: b.y + 40 });
  // attach each pin to its own wire endpoint
  const wA = wire(a, { x: a.x - 40, y: a.y });
  const wB = wire(b, { x: b.x, y: b.y - 40 });
  const logical: BuildLogicalNetlist = {
    components: [
      { refDes: "R1", partId: PART, value: "1k", role: "passive" },
      { refDes: "R2", partId: PART, value: "1k", role: "passive" },
    ],
    // Intended SEPARATE — so if the crossing falsely merged them it'd flag a merge.
    connections: [
      { kind: "label", pin: "R1.1", labelName: "NETA", labelKind: "label" },
      { kind: "label", pin: "R2.1", labelName: "NETB", labelKind: "label" },
    ],
    explanation: "",
  };
  const res = validateSchematicNetlist(logical, stateOf([r1, r2], [wH, wV, wA, wB]), parts);
  check("crossing-without-junction does NOT create a merge", !hasKind(res.violations, "unintended-merge"));
}

// 6. A wire that LOOKS connected (ends near a pin) but isn't on the pin's point.
{
  const r1 = mkInst("R1", PART, 0, 0);
  const r2 = mkInst("R2", PART, 200, 0);
  const p1 = pinWorld(r1, "2");
  const p2 = pinWorld(r2, "1");
  // Wire ends 4px short of R1.2 — visually adjacent, electrically not on the pin.
  const w = wire({ x: p1.x - 4, y: p1.y }, p2);
  const logical: BuildLogicalNetlist = {
    components: [
      { refDes: "R1", partId: PART, value: "1k", role: "passive" },
      { refDes: "R2", partId: PART, value: "1k", role: "passive" },
    ],
    connections: [{ kind: "wire", from: "R1.2", to: "R2.1" }],
    explanation: "",
  };
  const res = validateSchematicNetlist(logical, stateOf([r1, r2], [w]), parts);
  check("near-but-not-on-pin wire is NOT counted as connected", !res.ok);
  check("…surfaced as broken/floating", hasKind(res.violations, "broken-connection") || hasKind(res.violations, "floating-pin"));
}

// 3b. Shared ground net is NOT a false merge, even when some pins on it are
//     unaddressed by the netlist (only one is explicitly GND-labeled).
{
  const u1 = mkInst("U1", PART, 0, 0);   // pin 1 = GND-labeled, pin 2 = unaddressed
  const u2 = mkInst("U2", PART, 200, 0); // both pins unaddressed
  // One actual ground net touching all four pins.
  const w1 = wire(pinWorld(u1, "1"), pinWorld(u1, "2"));
  const w2 = wire(pinWorld(u1, "2"), pinWorld(u2, "1"));
  const w3 = wire(pinWorld(u2, "1"), pinWorld(u2, "2"));
  const logical: BuildLogicalNetlist = {
    components: [
      { refDes: "U1", partId: PART, value: "1k", role: "passive" },
      { refDes: "U2", partId: PART, value: "1k", role: "passive" },
    ],
    connections: [{ kind: "label", pin: "U1.1", labelName: "GND", labelKind: "ground" }],
    explanation: "",
  };
  const res = validateSchematicNetlist(logical, stateOf([u1, u2], [w1, w2, w3]), parts);
  check("shared net with unaddressed pins is NOT a false merge", !hasKind(res.violations, "unintended-merge"));
}

// 7. Unanchored net label (not on any pin or wire vertex).
{
  const r1 = mkInst("R1", PART, 0, 0);
  const st: SchematicState = {
    components: [],
    wires: [],
    kicadComponents: [r1],
    netLabels: [{ id: "L1", position: { x: 9999, y: 9999 }, name: "VCC", kind: "power", orientation: 0 }],
  };
  const logical: BuildLogicalNetlist = {
    components: [{ refDes: "R1", partId: PART, value: "1k", role: "passive" }],
    connections: [],
    explanation: "",
  };
  const res = validateSchematicNetlist(logical, st, parts);
  check("unanchored label is flagged", hasKind(res.violations, "unanchored-label"));
}

// 8. rerouteToLabels turns a broken wire connection into shared-name labels.
{
  const r1 = mkInst("R1", PART, 0, 0);
  const r2 = mkInst("R2", PART, 200, 0);
  const logical: BuildLogicalNetlist = {
    components: [
      { refDes: "R1", partId: PART, value: "1k", role: "passive" },
      { refDes: "R2", partId: PART, value: "1k", role: "passive" },
    ],
    connections: [{ kind: "wire", from: "R1.2", to: "R2.1" }],
    explanation: "",
  };
  const st = stateOf([r1, r2], []); // nothing drawn → broken
  const before = validateSchematicNetlist(logical, st, parts);
  const fixed = rerouteToLabels(logical, parts, st, before.violations);
  const labelCount = fixed.connections.filter((c) => c.kind === "label").length;
  const wireCount = fixed.connections.filter((c) => c.kind !== "label").length;
  check("reroute converts the broken wire to labels", labelCount >= 2 && wireCount === 0);
}

// ── Theory-mode validator ─────────────────────────────────────────────────────
const tComp = (id: string, type: SchComponentType, x: number, y: number, value = "1k", rotation: 0 | 90 | 180 | 270 = 0): SchComponent =>
  ({ id, type, x, y, rotation, value });
const tPin = (c: SchComponent, name: string) => pinWorldPos(c, name);

// T1. Valid RC filter — V1 → R1 → C1 → GND.
{
  const V1 = tComp("V1", "voltage-source", 0, 0, "5V");
  const R1 = tComp("R1", "resistor", 120, -40, "10k");
  const C1 = tComp("C1", "capacitor", 240, 0, "16n");
  const G1 = tComp("GND1", "ground", 120, 120, "");
  const comps = [V1, R1, C1, G1];
  const wires: Wire[] = [
    wire(tPin(V1, "+"), tPin(R1, "left")),
    wire(tPin(R1, "right"), tPin(C1, "left")),
    wire(tPin(C1, "right"), tPin(G1, "pin")),
    wire(tPin(V1, "-"), tPin(G1, "pin")),
  ];
  const logical: LogicalNetlist = {
    components: [
      { id: "V1", type: "voltage-source", value: "5V" },
      { id: "R1", type: "resistor", value: "10k" },
      { id: "C1", type: "capacitor", value: "16n" },
      { id: "GND1", type: "ground", value: "" },
    ],
    connections: [
      { from: "V1.+", to: "R1.left" },
      { from: "R1.right", to: "C1.left" },
      { from: "C1.right", to: "GND1.pin" },
      { from: "V1.-", to: "GND1.pin" },
    ],
    explanation: "",
  };
  const res = validateTheoryNetlist(logical, { components: comps, wires });
  check("theory: valid RC filter is electrically valid", res.ok);
}

// T2. Theory self-short — R1 shorted across itself.
{
  const R1 = tComp("R1", "resistor", 0, 0, "10k");
  const wires: Wire[] = [wire(tPin(R1, "left"), tPin(R1, "right"))];
  const logical: LogicalNetlist = {
    components: [
      { id: "R1", type: "resistor", value: "10k" },
      { id: "V1", type: "voltage-source", value: "5V" },
      { id: "GND1", type: "ground", value: "" },
    ],
    connections: [
      { from: "V1.+", to: "R1.left" },
      { from: "R1.right", to: "GND1.pin" },
    ],
    explanation: "",
  };
  const res = validateTheoryNetlist(logical, { components: [R1], wires });
  check("theory: self-short is flagged", hasKind(res.violations, "self-short"));
}

// T3. Theory floating — intended connection with no wire drawn.
{
  const R1 = tComp("R1", "resistor", 0, 0, "10k");
  const C1 = tComp("C1", "capacitor", 200, 0, "1u");
  const logical: LogicalNetlist = {
    components: [
      { id: "R1", type: "resistor", value: "10k" },
      { id: "C1", type: "capacitor", value: "1u" },
    ],
    connections: [{ from: "R1.right", to: "C1.left" }], // intended, no wire
    explanation: "",
  };
  const res = validateTheoryNetlist(logical, { components: [R1, C1], wires: [] });
  check("theory: floating required pin is flagged", hasKind(res.violations, "floating-pin"));
}

// T4. Two separate ground symbols are NOT a false split/merge (SPICE node 0).
{
  const V1 = tComp("V1", "voltage-source", 0, 0, "5V");
  const R1 = tComp("R1", "resistor", 120, -40, "10k");
  const G1 = tComp("GND1", "ground", 0, 120, "");
  const G2 = tComp("GND2", "ground", 240, 120, "");
  const comps = [V1, R1, G1, G2];
  const wires: Wire[] = [
    wire(tPin(V1, "+"), tPin(R1, "left")),
    wire(tPin(V1, "-"), tPin(G1, "pin")),   // source returns to GND1
    wire(tPin(R1, "right"), tPin(G2, "pin")), // R1 to a SEPARATE ground symbol
  ];
  const logical: LogicalNetlist = {
    components: [
      { id: "V1", type: "voltage-source", value: "5V" },
      { id: "R1", type: "resistor", value: "10k" },
      { id: "GND1", type: "ground", value: "" },
      { id: "GND2", type: "ground", value: "" },
    ],
    connections: [
      { from: "V1.+", to: "R1.left" },
      { from: "V1.-", to: "GND1.pin" },
      { from: "R1.right", to: "GND2.pin" },
    ],
    explanation: "",
  };
  const res = validateTheoryNetlist(logical, { components: comps, wires });
  check("theory: two ground symbols are one net (no false split/merge)", res.ok);
}

// ── schematicToBuildNetlist extractor (Tier-2 round-trip) ─────────────────────
const nl = (name: string, kind: "power" | "ground" | "label", p: Point): NetLabel =>
  ({ id: `${name}@${p.x},${p.y}`, position: p, name, kind, orientation: 0 });
type LabelConn = { kind: "label"; pin: string; labelName: string; labelKind: string };
const isLabel = (c: { kind?: string }): c is LabelConn => c.kind === "label";

// X1. Wire net stays a wire; ground/power labels are preserved.
{
  const r1 = mkInst("R1", PART, 0, 0);
  const r2 = mkInst("R2", PART, 200, 0);
  const wires: Wire[] = [wire(pinWorld(r1, "2"), pinWorld(r2, "1"))]; // R1.2 ── R2.1
  const labels = [nl("GND", "ground", pinWorld(r1, "1")), nl("VCC", "power", pinWorld(r2, "2"))];
  const state: SchematicState = { components: [], wires, kicadComponents: [r1, r2], netLabels: labels };
  const out = schematicToBuildNetlist(state, parts);

  const gnd = out.connections.find((c) => isLabel(c) && c.labelName === "GND") as LabelConn | undefined;
  const vcc = out.connections.find((c) => isLabel(c) && c.labelName === "VCC") as LabelConn | undefined;
  const wireConn = out.connections.find((c) => c.kind !== "label");

  check("extractor: keeps components + partIds", out.components.length === 2 && out.components.every((c) => c.partId === PART));
  check("extractor: 2-pin net → wire connection", !!wireConn);
  check("extractor: ground label preserved", gnd?.labelKind === "ground" && gnd?.pin === "R1.1");
  check("extractor: power label preserved", vcc?.labelKind === "power" && vcc?.pin === "R2.2");
}

// X2. A ground COMPONENT (not a label) becomes a GND label on the wired pin.
{
  const r3 = mkInst("R3", PART, 0, 0);
  const g1 = tComp("GND1", "ground", 0, 120, "");
  const wires: Wire[] = [wire(pinWorld(r3, "2"), tPin(g1, "pin"))];
  const state: SchematicState = { components: [g1], wires, kicadComponents: [r3], netLabels: [] };
  const out = schematicToBuildNetlist(state, parts);
  const gnd = out.connections.find((c) => isLabel(c) && c.pin === "R3.2") as LabelConn | undefined;
  check("extractor: ground component → GND label on its pin", gnd?.labelName === "GND" && gnd?.labelKind === "ground");
}

// ── buildReviewInput (Layer-2 ground truth) ──────────────────────────────────
// R1.1 ── R2.1 (a real net); R1.2 floats; R2.2 → GND label.
{
  const r1 = mkInst("R1", PART, 0, 0);
  const r2 = mkInst("R2", PART, 200, 0);
  const wires: Wire[] = [wire(pinWorld(r1, "1"), pinWorld(r2, "1"))];
  const labels = [nl("GND", "ground", pinWorld(r2, "2"))];
  const state: SchematicState = { components: [], wires, kicadComponents: [r1, r2], netLabels: labels };
  const input = buildReviewInput(state, parts);

  check("review: floating pin detected", input.floatingPins.includes("R1.2"));
  check("review: ground pin is NOT floating", !input.floatingPins.includes("R2.2"));
  const gnd = input.nets.find((n) => n.kind === "ground");
  check("review: ground net named GND with R2.2", gnd?.name === "GND" && gnd.pins.includes("R2.2"));
  check("review: components enumerated", input.components.length === 2);
}

// ── mergeBuildNetlists (multi-agent deterministic merge) ──────────────────────
{
  const power: { name: string; netlist: BuildLogicalNetlist } = {
    name: "Power",
    netlist: {
      components: [
        { refDes: "U1", partId: "p", value: "AMS1117", role: "regulator" },
        { refDes: "C1", partId: "c", value: "10u", role: "support" },
      ],
      connections: [
        { kind: "wire", from: "U1.OUT", to: "C1.1" },
        { kind: "label", pin: "U1.OUT", labelName: "+3V3", labelKind: "power" },
        { kind: "label", pin: "U1.GND", labelName: "GND", labelKind: "ground" },
      ],
      explanation: "",
    },
  };
  const mcu: { name: string; netlist: BuildLogicalNetlist } = {
    name: "MCU",
    netlist: {
      components: [
        { refDes: "U1", partId: "q", value: "ESP32", role: "processor" }, // collides with Power.U1
        { refDes: "R1", partId: "r", value: "330", role: "indicator" },
      ],
      connections: [
        { kind: "label", pin: "U1.VDD", labelName: "+3V3", labelKind: "power" },
        { kind: "wire", from: "U1.GPIO2", to: "R1.1" },
      ],
      explanation: "",
    },
  };

  const { netlist, notes } = mergeBuildNetlists([power, mcu]);
  const refs = netlist.components.map((c) => c.refDes);
  const mcuRef = refs.find((r) => r !== "U1" && r.startsWith("U")); // the renamed ESP32
  const mcuWire = netlist.connections.find(
    (c) => c.kind !== "label" && (c as { from: string }).from.startsWith(`${mcuRef}.`),
  );
  const p3v3 = netlist.connections.filter((c) => isLabel(c) && c.labelName === "+3V3");

  check("merge: refDes unique after de-collision", new Set(refs).size === refs.length && refs.length === 4);
  check("merge: collided U1 was renamed", !!mcuRef && notes.some((n) => n.includes("U1")));
  check("merge: connection endpoints follow the rename", !!mcuWire);
  check("merge: shared net names preserved (both +3V3 labels)", p3v3.length === 2);
}

// ── componentBodyBox: body-accurate obstacle sizing ───────────────────────────
// Regression for the "wire routes through a component body" bug. The obstacle box
// must reflect a part's real body, not collapse to a pin-column sliver for
// one-sided parts (connectors, switches). Box dimensions are placement-invariant,
// so we read them off a part at the origin (plus a rotated instance for the
// rotation transform). Values are the ones the routing fix was verified against.
{
  const O: Record<"west" | "east" | "south" | "north", PinOrientation> =
    { west: 0, east: 180, south: 90, north: 270 };
  const kpin = (number: string, xmm: number, ymm: number, exit: keyof typeof O): KicadPin =>
    ({ number, name: number, type: "passive", position: { x: xmm, y: ymm }, orientation: O[exit], length: 2.54 });
  // bodyRect [x1,y1,x2,y2] in symbol mm-space (y-up); omit for a graphic-less part.
  const mkKicad = (id: string, pins: KicadPin[], bodyRect?: [number, number, number, number]): CachedPart => ({
    id, name: id, description: "", mpn: null, manufacturer: null, datasheet: null, footprintHint: null,
    mainCategory: "x", libraryName: "Lib", pins,
    symbolRaw: bodyRect
      ? `(symbol "${id}" (symbol "${id}_0_1" (rectangle (start ${bodyRect[0]} ${bodyRect[1]}) (end ${bodyRect[2]} ${bodyRect[3]}))))`
      : "",
    properties: {},
  });
  const ic = (id: string, l: number, r: number): CachedPart => {
    const pins: KicadPin[] = [];
    for (let i = 0; i < l; i++) pins.push(kpin(`L${i + 1}`, -5.08, ((l - 1) / 2 - i) * 2.54, "west"));
    for (let i = 0; i < r; i++) pins.push(kpin(`R${i + 1}`, 5.08, ((r - 1) / 2 - i) * 2.54, "east"));
    const half = ((Math.max(l, r) - 1) / 2) * 2.54 + 1.27;
    return mkKicad(id, pins, [-2.54, half, 2.54, -half]);
  };
  const inst = (rot: 0 | 90 = 0): KicadComponentInstance =>
    ({ id: "X", partId: "x", x: 0, y: 0, rotation: rot, refDes: "X", value: "" });
  const dims = (p: CachedPart, rot: 0 | 90 = 0) => {
    const b = componentBodyBox(inst(rot), p);
    return { w: b.width, h: b.height };
  };
  const near = (a: number, b: number) => Math.abs(a - b) <= 0.6;

  // Repro parts (same geometry the routing fix was verified against).
  const mcu = ic("mcu", 8, 8);
  const usb = mkKicad("usb", [
    kpin("VBUS", -2.54, 5.08, "west"), kpin("DP", -2.54, 2.54, "west"), kpin("DM", -2.54, 0, "west"),
    kpin("GND", -2.54, -2.54, "west"), kpin("SHLD", -2.54, -5.08, "west"),
  ], [0, 6, 5.08, -6]);
  const sw = mkKicad("sw", [
    kpin("A", -2.54, 2.54, "west"), kpin("B", -2.54, 0, "west"), kpin("C", -2.54, -2.54, "west"),
  ], [0, 3.5, 5.08, -3.5]);
  const reg = mkKicad("reg", [
    kpin("IN", -2.54, 0, "west"), kpin("OUT", 2.54, 0, "east"), kpin("GND", 0, -2.54, "south"),
  ], [-2.54, 2.54, 2.54, -2.54]);

  // (1) parts WITH graphics → box matches the drawn body (verified repro values).
  check("bbox: 2-sided IC matches symbol body (80×160)", near(dims(mcu).w, 80) && near(dims(mcu).h, 160));
  check("bbox: one-sided USB covers its body (60×94)", near(dims(usb).w, 60) && near(dims(usb).h, 94));
  check("bbox: one-sided switch covers its body (60×55)", near(dims(sw).w, 60) && near(dims(sw).h, 55));
  check("bbox: 3-pin regulator covers its body (40×40)", near(dims(reg).w, 40) && near(dims(reg).h, 40));

  // (2) part WITHOUT graphics → pin extents + padding (no sliver). Same 3 west
  // pins as `sw` but no symbolRaw: pins span 0×40px, padded 30/side → 60×100.
  const bare = mkKicad("bare", [
    kpin("A", -2.54, 2.54, "west"), kpin("B", -2.54, 0, "west"), kpin("C", -2.54, -2.54, "west"),
  ]);
  check("bbox: graphic-less one-sided part pads pin extents (60×100)", near(dims(bare).w, 60) && near(dims(bare).h, 100));

  // (3) BOTH yield body-sized boxes — never the old one-sided sliver (~24px).
  check("bbox: one-sided WITH graphics is body-sized, not a sliver", dims(sw).w >= 50 && dims(sw).h >= 50);
  check("bbox: one-sided WITHOUT graphics is body-sized, not a sliver", dims(bare).w >= 50 && dims(bare).h >= 50);

  // rotation transform: a 90° instance swaps width/height.
  check("bbox: rotation swaps width/height (IC 90° → 160×80)", near(dims(mcu, 90).w, 160) && near(dims(mcu, 90).h, 80));
}

// ── resolvePinCoincidences (pin-coincidence guard) ───────────────────────────
{
  const part = mkPart("PP");
  const sized = (refDes: string, x: number, y: number) => ({
    comp: { refDes, partId: "PP", value: "v", role: "passive" as const },
    part,
    role: "passive" as const,
    width: 60,
    height: 20,
    placed: true,
    instance: { id: refDes, partId: "PP", x, y, rotation: 0 as const, refDes, value: "v" },
  });
  // Two identical placements → every pin coincides (a silent short).
  const a = sized("R1", 100, 100);
  const b = sized("R2", 100, 100);
  const residual = resolvePinCoincidences([a, b]);
  const coords = [a, b].flatMap((s) =>
    part.pins.map((p) => {
      const w = kicadPinWorldPos(s.instance, p);
      return `${w.x},${w.y}`;
    }),
  );
  check(
    "pin-guard: coincident pins separated (no shared coordinate)",
    residual === 0 && new Set(coords).size === coords.length,
  );
}

// ── spread hints (layout critic) widen the de-overlap courtyard ──────────────
{
  const sp = mkPart("SP");
  const sized = (refDes: string, x: number, y: number, spread?: number) => ({
    comp: { refDes, partId: "SP", value: "v", role: "passive" as const },
    part: sp,
    role: "passive" as const,
    width: 60,
    height: 20,
    placed: true,
    spread,
    instance: { id: refDes, partId: "SP", x, y, rotation: 0 as const, refDes, value: "v" },
  });
  const sep = (a: ReturnType<typeof sized>, b: ReturnType<typeof sized>) =>
    Math.abs(a.instance.x - b.instance.x) + Math.abs(a.instance.y - b.instance.y);

  // An overlapping pair resolved with default clearance …
  const a0 = sized("R1", 100, 100);
  const b0 = sized("R2", 120, 100);
  resolveComponentCollisions([a0, b0]);
  const gap0 = sep(a0, b0);

  // … vs the same pair with R2 flagged crowded (extra courtyard clearance):
  // the critic's hint must push them strictly further apart.
  const a1 = sized("R1", 100, 100);
  const b1 = sized("R2", 120, 100, 80);
  resolveComponentCollisions([a1, b1]);
  const gap1 = sep(a1, b1);

  check("spread-hints: flagged component pushed strictly further apart", gap1 > gap0);
}

// ── respacing regression guard (Tidy "don't crowd elsewhere") ────────────────
{
  // nearestNeighborGaps: a far-apart pair has a larger nearest gap than a close pair.
  const gp = mkPart("GP");
  const pmap = new Map<string, CachedPart>([["GP", gp]]);
  const close = nearestNeighborGaps(
    [mkInst("A", "GP", 0, 0), mkInst("B", "GP", 40, 0)],
    pmap,
  );
  const far = nearestNeighborGaps(
    [mkInst("A", "GP", 0, 0), mkInst("B", "GP", 1000, 0)],
    pmap,
  );
  check(
    "respacing: nearest-neighbour gap grows with distance",
    (far.get("A") ?? 0) > (close.get("A") ?? Infinity),
  );

  // evaluateRespacing decision logic (pure, comfort = DEFAULT_COMFORT_GAP = 60).
  const C = DEFAULT_COMFORT_GAP;
  // Flagged R1 gains room; comfortable R2 stays comfortable → accept.
  const good = evaluateRespacing(
    new Map([["R1", 10], ["R2", 100]]),
    new Map([["R1", 80], ["R2", 90]]),
    ["R1"],
  );
  check("respacing: improvement with no regression is accepted", good.improved && good.regressed.length === 0);

  // Flagged R1 gains room but comfortable R2 is pushed below comfort → regression.
  const bad = evaluateRespacing(
    new Map([["R1", 10], ["R2", 100]]),
    new Map([["R1", 80], ["R2", C - 10]]),
    ["R1"],
  );
  check("respacing: a crowded-out comfortable part is flagged as regressed", bad.improved && bad.regressed.includes("R2"));

  // Already-tight R2 (below comfort before) is NOT counted as a regression.
  const tight = evaluateRespacing(
    new Map([["R1", 10], ["R2", 20]]),
    new Map([["R1", 80], ["R2", 15]]),
    ["R1"],
  );
  check("respacing: a part that was already tight is not a regression", tight.regressed.length === 0);

  // No measurable gain for the flagged part → not improved.
  const flat = evaluateRespacing(new Map([["R1", 50]]), new Map([["R1", 50]]), ["R1"]);
  check("respacing: no gain for flagged parts → not improved", !flat.improved);
}

// ── footprint assignment (PCB seam) ──────────────────────────────────────────
{
  // 1) A real footprint id on the symbol is trusted verbatim.
  const hint = resolveFootprint({ refDes: "U1", footprintHint: "Package_QFP:LQFP-48_7x7mm_P0.5mm" });
  check("footprint: real hint is trusted", hint.source === "hint" && hint.footprint === "Package_QFP:LQFP-48_7x7mm_P0.5mm");

  // 2) A wildcard footprint FILTER is not a real id → falls back to a default.
  const filt = resolveFootprint({ refDes: "C3", footprintHint: "Capacitor_SMD:C_*" });
  check("footprint: wildcard filter rejected, default used", filt.source === "default" && filt.footprint === "Capacitor_SMD:C_0603_1608Metric");

  // 3) Category defaults by refDes prefix.
  check("footprint: R default", resolveFootprint({ refDes: "R7", footprintHint: null }).footprint === "Resistor_SMD:R_0603_1608Metric");
  check("footprint: L default", resolveFootprint({ refDes: "L2", footprintHint: "" }).footprint === "Inductor_SMD:L_0603_1608Metric");
  check("footprint: Q default", resolveFootprint({ refDes: "Q1", footprintHint: null }).footprint === "Package_TO_SOT_SMD:SOT-23");

  // 4) Diode vs LED (both refDes "D") disambiguated by name/value.
  const diode = resolveFootprint({ refDes: "D1", footprintHint: null, name: "1N4148 Fast Diode" });
  const led = resolveFootprint({ refDes: "D2", footprintHint: null, name: "Red LED", value: "RED" });
  check("footprint: plain diode → SOD-123", diode.footprint === "Diode_SMD:D_SOD-123");
  check("footprint: LED-named diode → LED land", led.footprint === "LED_SMD:LED_0603_1608Metric");

  // 5) Unknown/variable package (IC, connector) is surfaced, not guessed.
  const ic = resolveFootprint({ refDes: "U2", footprintHint: null });
  check("footprint: unresolved IC → null (surfaced)", ic.source === "none" && ic.footprint === null);

  // 6) Batch assignment over a schematic maps each refDes.
  const fpParts = new Map([
    ["p-mcu", { footprintHint: "Package_QFP:LQFP-32_5x5mm_P0.5mm", name: "STM32", mainCategory: "IC" }],
    ["p-res", { footprintHint: null, name: "Resistor", mainCategory: "Passive" }],
  ]);
  const assigned = assignFootprints(
    [
      { refDes: "U1", partId: "p-mcu", value: "STM32" },
      { refDes: "R1", partId: "p-res", value: "10k" },
      { refDes: "J1", partId: "p-missing", value: "" },
    ],
    fpParts,
  );
  const byRef = new Map(assigned.map((a) => [a.refDes, a]));
  check(
    "footprint: batch assigns hint + default + null",
    byRef.get("U1")!.source === "hint" &&
      byRef.get("R1")!.footprint === "Resistor_SMD:R_0603_1608Metric" &&
      byRef.get("J1")!.footprint === null,
  );
}

// ── SchGen cross-verification (second-opinion diff) ──────────────────────────
{
  // classifyComponent basics.
  check("crosscheck: classify R→resistor", classifyComponent("R1") === "resistor");
  check("crosscheck: classify D+led name→led", classifyComponent("D3", "Green LED") === "led");
  check("crosscheck: classify U→ic", classifyComponent("U1", "STM32") === "ic");

  // Parse a small SchGen DSL sample (keyword + positional connect_pins) → netlist.
  const schgenSrc = `
from modules.kicad_sch_interface import *
add_schematic_symbol(symbol_lib="Regulator_Linear", symbol_name="AP2112K-3.3", pos_x=100, pos_y=100, reference="U1", value="AP2112K-3.3")
add_schematic_symbol(symbol_lib="Device", symbol_name="C", pos_x=80, pos_y=90, reference="C1", value="1uF")
add_schematic_symbol(symbol_lib="Device", symbol_name="C", pos_x=120, pos_y=90, reference="C2", value="1uF")
add_schematic_symbol(symbol_lib="Device", symbol_name="C", pos_x=140, pos_y=90, reference="C3", value="100nF")
add_label([100, 130], "VIN", "VIN_0", "input", "left")
connect_pins("U1", "VIN", "C1", "1")
connect_pins("U1", "VIN", "VIN_0", "1")
connect_pins("U1", "VOUT", "C2", "1")
connect_pins("U1", "EN", "C3", "1")
write_out_all_wires()
`;
  const parsed = parseSchGenSource(schgenSrc);
  check("crosscheck: parses SchGen components", parsed.netlist.components.length === 4);
  check("crosscheck: parses SchGen connections", parsed.coverage.connections === 4);
  check(
    "crosscheck: VIN label becomes a named net",
    parsed.netlist.nets.some((n) => n.name === "VIN"),
  );

  // Primary (Sirkit) netlist with FEWER caps than the second opinion → the diff
  // should flag a possible missing decoupling/bulk capacitor.
  const primaryNl: BuildLogicalNetlist = {
    components: [
      { refDes: "U1", partId: "ldo", value: "AP2112K-3.3", role: "regulator" },
      { refDes: "C1", partId: "cap", value: "1uF", role: "passive" },
    ],
    connections: [
      { kind: "label", pin: "U1.VIN", labelName: "VIN", labelKind: "power" },
      { kind: "wire", from: "U1.VOUT", to: "C1.1" },
    ],
    explanation: "",
  };
  const primary = normalizeBuildNetlist(primaryNl);
  const result = crossCheckNetlists(primary, parsed.netlist);
  check(
    "crosscheck: flags missing capacitor vs second opinion",
    result.findings.some((f) => f.severity === "warning" && /capacitor/i.test(f.title)),
  );

  // Identical netlists → no findings, full agreement.
  const same = crossCheckNetlists(parsed.netlist, parsed.netlist);
  check("crosscheck: identical netlists agree (no findings)", same.findings.length === 0 && same.agreement === 1);
}

// ── page fit: content is centred, not crowded into the corner ────────────────
{
  // A small circuit well inside A4's printable area.
  const bounds = { minX: 1000, minY: 1000, maxX: 1200, maxY: 1100 };
  const fit = planPageFit(bounds);
  const { widthPx, heightPx } = pageSizePx(fit.pageSize);
  const centerX = (bounds.minX + bounds.maxX) / 2 + fit.dx;
  const centerY = (bounds.minY + bounds.maxY) / 2 + fit.dy;
  check("page-fit: small circuit centred horizontally (not left-crowded)", Math.abs(centerX - widthPx / 2) <= 20);
  // Vertically centred within the upper band (above the reserved title block),
  // so the content sits above the page's true middle.
  check("page-fit: content sits in the upper half vertically", centerY > 40 && centerY < heightPx / 2 + 40);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
