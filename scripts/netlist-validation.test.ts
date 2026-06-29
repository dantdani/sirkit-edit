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
import { resolvePinCoincidences } from "../lib/build-auto-layout";
import { kicadPinWorldPos, pinWorldPos } from "../app/lib/geometry";
import type { CachedPart } from "../app/lib/parts-cache";
import type { KicadPin } from "../app/lib/kicad/types";
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

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
