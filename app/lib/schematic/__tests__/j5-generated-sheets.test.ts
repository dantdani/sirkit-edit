/**
 * [PR-J, 2026-10-22] Runbook J.6.2-J.6.3, increment J5-1 (OD-255 items 2 and 9): the sheet set a planned generation result carries
 * (app/lib/schematic/generated-sheets.ts `deriveGeneratedSheets`), over the merge's per-block netlists with their FINAL reference designators
 * (app/lib/merge-netlists.ts `blocks`). What it proves:
 *
 *  1. the fixture drone (4 planned blocks, built by the fixture provider's own `designSubmission` over the committed catalog's parts):
 *     a root overview and 4 child sheets in plan order; ports exactly the 7 shared signal nets (PWM1-4, I2C_SDA, I2C_SCL, IMU_INT1) with
 *     directions from the catalog pin types; 7 bound interfaces; rails VBAT, +3V3 and GND project-wide; every component on exactly one
 *     sheet; the flat merged netlist untouched; no finding;
 *  2. a single design (the LED dimmer, block main) is one page: no sheets, no finding;
 *  3. an omitted planned block stays a visible "omitted" sheet whose declared ports are unbound (the barometer), never dropped;
 *  4. the conservative rule: an undeclared same-name signal label in two blocks keeps the flat page with a finding naming it;
 *  5. rails by EXACT name: AGND and GND are two rails (never merged by look-alike), each joining its own pins across sheets;
 *  6. a declared shared net only one block labels is an unbound interface with a finding; the partition proof refuses a sheet set that
 *     would not reproduce the merged connections; bounds refuse with a finding, never a cut;
 *  7. determinism (the same input gives the same document) and the defensive reader.
 * Pure: no store, no provider, no database, no network.
 */
import { describe, expect, it } from "vitest";
import { mergeBuildNetlists } from "@/app/lib/merge-netlists";
import { mergeAndValidate } from "../build-multi-generation";
import type { AiPartResult } from "@/app/lib/parts-search";
import { BLINKER_PART_IDS, FIXTURE_RESOLUTION_PART_IDS, GENERATION_FIXTURE_PART_IDS, fixtureRuntimeCatalog } from "@/app/lib/fixture-runtime/blinker/catalog";
import { DRONE_BLOCK_NAMES, droneBlockDesign, dronePlan, selectRecipe, type DesignSpec } from "@/app/lib/fixture-runtime/generation-recipes";
import { designSubmission, type ReturnedPart } from "@/app/lib/fixture-runtime/generation-policy";
import { GENERATED_SHEETS_BOUNDS, GENERATION_SHEETS_SCHEMA, deriveGeneratedSheets, readGeneratedSheets, type GeneratedSheets, type GeneratedSheetsPlannedBlock, type PinTypedPart } from "../generated-sheets";
import type { BuildLogicalNetlist } from "@/lib/schematic-types";

// ─── The fixture drone's block netlists, as the fixture provider submits them ─────────────────────────────────────────────────

const ROLE_PART: Readonly<Record<string, string>> = {
  header2: BLINKER_PART_IDS.header, capacitor: BLINKER_PART_IDS.capacitor, resistor: BLINKER_PART_IDS.resistor, led: BLINKER_PART_IDS.led,
  ldo: GENERATION_FIXTURE_PART_IDS.ldo, nmos: GENERATION_FIXTURE_PART_IDS.nmos, schottky: GENERATION_FIXTURE_PART_IDS.schottky, mcu: GENERATION_FIXTURE_PART_IDS.mcu,
  imu: GENERATION_FIXTURE_PART_IDS.imu, "header-isp": GENERATION_FIXTURE_PART_IDS.header2x03, "header-uart": GENERATION_FIXTURE_PART_IDS.header1x04,
  timer: BLINKER_PART_IDS.timer, potentiometer: GENERATION_FIXTURE_PART_IDS.potentiometer, "signal-diode": FIXTURE_RESOLUTION_PART_IDS.eligibleDiode,
};
const catalog = fixtureRuntimeCatalog().cachedParts;
function returned(partId: string): ReturnedPart {
  const part = catalog.get(partId);
  if (!part) throw new Error(`fixture part ${partId} missing`);
  return { partId, mainCategory: part.mainCategory, pins: part.pins.map((pin) => ({ number: pin.number, name: pin.name, type: pin.type ?? "" })), verified: true, orderableValues: null, text: part.name, name: part.name };
}
/** One recipe design as the fixture provider submits it: its roles filled with the committed catalog's parts, endpoints as pin numbers. */
function submitted(design: DesignSpec): BuildLogicalNetlist {
  const filled = new Map(design.roles.map((role) => {
    const part = returned(ROLE_PART[role.key]!);
    const values = new Map(design.components.filter((component) => component.role === role.key).map((component) => [component.ref, component.values === "part-name" ? part.name : component.values[0]!] as const));
    return [role.key, { part, values }] as const;
  }));
  return designSubmission(design, filled) as unknown as BuildLogicalNetlist;
}
const PARTS: PinTypedPart[] = [...new Set(Object.values(ROLE_PART))].map((partId) => ({ partId, pins: returned(partId).pins }));
const typeOf = (partId: string, pinName: string): string => returned(partId).pins.find((pin) => pin.name === pinName)!.type;

/** The drone's planned blocks (b1..), the designed ones' netlists, and the merge (final refDes per block). */
function drone(motors: number, barometer: boolean, omit: readonly string[] = []) {
  const plan = dronePlan(motors, barometer);
  const planned: GeneratedSheetsPlannedBlock[] = plan.blocks.map((block, index) => ({ blockId: `b${index + 1}`, name: block.name, sharedNets: block.sharedNets, status: omit.includes(block.name) ? "omitted" : "designed" }));
  const designedBlocks = plan.blocks.filter((block) => !omit.includes(block.name)).map((block) => ({ name: block.name, netlist: submitted(droneBlockDesign(block.name, block.sharedNets)!) }));
  const merged = mergeBuildNetlists(designedBlocks);
  const ids = planned.filter((block) => block.status === "designed").map((block) => block.blockId);
  return { planned, merged, designed: merged.blocks.map((block, index) => ({ blockId: ids[index]!, name: block.name, netlist: block.netlist })) };
}
const PWM = ["PWM1", "PWM2", "PWM3", "PWM4"];

// ─── Small synthetic blocks (the rules, isolated) ───────────────────────────────────────────────────────────────────────────

const R = "part-r", U = "part-u";
const SYNTH_PARTS: PinTypedPart[] = [
  { partId: R, pins: [{ number: "1", name: "~", type: "passive" }, { number: "2", name: "~", type: "passive" }] },
  { partId: U, pins: [{ number: "1", name: "VDD", type: "power_in" }, { number: "2", name: "GND", type: "power_in" }, { number: "3", name: "OUT", type: "output" }, { number: "4", name: "IN", type: "input" }, { number: "5", name: "EN", type: "input" }] },
];
const label = (pin: string, labelName: string, labelKind?: "label" | "power" | "ground") => ({ kind: "label" as const, pin, labelName, ...(labelKind ? { labelKind } : {}) });
const block = (refs: Array<[string, string]>, connections: BuildLogicalNetlist["connections"]): BuildLogicalNetlist => ({ components: refs.map(([refDes, partId]) => ({ refDes, partId, value: "x", role: "passive" as const })), connections, explanation: "" });
function synth(blocks: Array<{ name: string; sharedNets: string[]; netlist: BuildLogicalNetlist | null }>, parts: PinTypedPart[] | null = SYNTH_PARTS): { doc: GeneratedSheets; flat: BuildLogicalNetlist } {
  const planned: GeneratedSheetsPlannedBlock[] = blocks.map((entry, index) => ({ blockId: `b${index + 1}`, name: entry.name, sharedNets: entry.sharedNets, status: entry.netlist ? "designed" : "omitted" }));
  const merged = mergeBuildNetlists(blocks.filter((entry) => entry.netlist).map((entry) => ({ name: entry.name, netlist: entry.netlist! })));
  const ids = planned.filter((entry) => entry.status === "designed").map((entry) => entry.blockId);
  const doc = deriveGeneratedSheets({ planned, designed: merged.blocks.map((entry, index) => ({ blockId: ids[index]!, name: entry.name, netlist: entry.netlist })), flat: merged.netlist, parts });
  return { doc, flat: merged.netlist };
}

describe("[PR-J J5-1] the fixture drone as sheets", () => {
  it("1. four planned blocks: an overview and 4 sheets in plan order, ports exactly the 7 shared signal nets, 7 bound interfaces, rails VBAT / +3V3 / GND, every component once, the flat netlist untouched, no finding", () => {
    const { planned, merged, designed } = drone(4, false);
    const flatBefore = JSON.stringify(merged.netlist);
    const doc = deriveGeneratedSheets({ planned, designed, flat: merged.netlist, parts: PARTS });
    expect(JSON.stringify(merged.netlist)).toBe(flatBefore); // the one truth is not touched
    expect(doc.schema).toBe(GENERATION_SHEETS_SCHEMA);
    expect(doc.findings).toEqual([]);
    const set = doc.sheets!;
    expect(set.root).toEqual({ sheetKey: "overview", name: "System overview" });
    expect(set.children.map((child) => [child.sheetKey, child.name, child.status])).toEqual([
      ["b1", DRONE_BLOCK_NAMES.power, "designed"], ["b2", DRONE_BLOCK_NAMES.motors, "designed"], ["b3", DRONE_BLOCK_NAMES.mcu, "designed"], ["b4", DRONE_BLOCK_NAMES.imu, "designed"],
    ]);
    expect(set.children.map((child) => child.ports.map((port) => port.net))).toEqual([[], PWM, [...PWM, "I2C_SDA", "I2C_SCL", "IMU_INT1"], ["I2C_SDA", "I2C_SCL", "IMU_INT1"]]);
    expect(set.children.every((child) => child.ports.every((port) => port.state === "bound" && port.portKey === `${child.sheetKey}:${port.net}`))).toBe(true);
    expect(set.interfaces.map((entry) => [entry.net, entry.ports, entry.state])).toEqual([
      ...PWM.map((net) => [net, [`b2:${net}`, `b3:${net}`], "bound"]),
      ["I2C_SDA", ["b3:I2C_SDA", "b4:I2C_SDA"], "bound"], ["I2C_SCL", ["b3:I2C_SCL", "b4:I2C_SCL"], "bound"], ["IMU_INT1", ["b3:IMU_INT1", "b4:IMU_INT1"], "bound"],
    ]);
    expect(set.rails).toEqual([{ net: "VBAT", kind: "power", sheets: ["b1", "b2"] }, { net: "GND", kind: "ground", sheets: ["b1", "b2", "b3", "b4"] }, { net: "+3V3", kind: "power", sheets: ["b1", "b3", "b4"] }]);
    expect(set.children[1]!.localNets).toEqual([1, 2, 3, 4].flatMap((n) => [`M${n}_GATE`, `M${n}_DRAIN`]));
    expect(set.children[2]!.localNets).toEqual(["AREF", "RESET", "MISO", "SCK", "MOSI", "UART_RXD", "UART_TXD", "LED_DRV", "LED_A"]);
    // every physical component on exactly one sheet, with its FINAL (merged) reference designator
    expect(set.children.flatMap((child) => child.components)).toEqual(merged.netlist.components.map((component) => component.refDes));
    expect(set.children.flatMap((child) => child.components)).toHaveLength(41);
    expect(new Set(set.children.flatMap((child) => child.components)).size).toBe(41);
    // directions come from the catalog pin types: the motor stages' gate resistors are passive; the MCU's port pins are bidirectional;
    // the IMU's SDA is bidirectional, its SCL an input and its INT1 an output (each beside a passive pull-up, which never decides)
    expect([typeOf(GENERATION_FIXTURE_PART_IDS.mcu, "PD6"), typeOf(GENERATION_FIXTURE_PART_IDS.imu, "SDA"), typeOf(GENERATION_FIXTURE_PART_IDS.imu, "SCL"), typeOf(GENERATION_FIXTURE_PART_IDS.imu, "INT1")]).toEqual(["bidirectional", "bidirectional", "input", "output"]);
    expect(set.children.map((child) => child.ports.map((port) => port.direction))).toEqual([[], PWM.map(() => "passive"), [...PWM, "I2C_SDA", "I2C_SCL", "IMU_INT1"].map(() => "bidirectional"), ["bidirectional", "input", "output"]]);
    // without the catalog read, every direction is unspecified (never guessed)
    const unknown = deriveGeneratedSheets({ planned, designed, flat: merged.netlist, parts: null });
    expect(unknown.sheets!.children.flatMap((child) => child.ports).every((port) => port.direction === "unspecified")).toBe(true);
    expect(unknown.sheets!.interfaces).toEqual(set.interfaces);
  });

  it("2. a single design (the LED dimmer, block main) stays one page: no sheets, no finding", () => {
    const recipe = selectRecipe("Design a 5 V LED dimmer: a 555 timer PWM with a 10k potentiometer setting the brightness, switching the LED through an N-channel MOSFET.");
    if (recipe?.kind !== "single" || recipe.key !== "led-dimmer") throw new Error("the LED dimmer recipe is expected");
    const dimmer = { name: "Whole circuit", netlist: submitted(recipe.design) };
    expect(dimmer.netlist.components).toHaveLength(14);
    const doc = deriveGeneratedSheets({ planned: [{ blockId: "main", name: dimmer.name, sharedNets: [], status: "designed" }], designed: [{ blockId: "main", ...dimmer }], flat: dimmer.netlist, parts: PARTS });
    expect(doc).toEqual({ schema: GENERATION_SHEETS_SCHEMA, sheets: null, findings: [] });
  });

  it("3. an omitted planned block is a visible omitted sheet with unbound ports (the barometer), never dropped", () => {
    const { planned, merged, designed } = drone(4, true, [DRONE_BLOCK_NAMES.barometer]);
    const doc = deriveGeneratedSheets({ planned, designed, flat: merged.netlist, parts: PARTS });
    const set = doc.sheets!;
    expect(set.children).toHaveLength(5);
    expect(set.children[4]).toEqual({
      sheetKey: "b5", name: DRONE_BLOCK_NAMES.barometer, status: "omitted", components: [],
      ports: [{ portKey: "b5:I2C_SDA", net: "I2C_SDA", direction: "unspecified", state: "unbound" }, { portKey: "b5:I2C_SCL", net: "I2C_SCL", direction: "unspecified", state: "unbound" }],
      rails: [{ net: "+3V3", kind: "power" }, { net: "GND", kind: "ground" }], localNets: [],
    });
    // the I2C interface still joins the MCU and the IMU; the barometer's port on it is listed, unbound
    expect(set.interfaces.find((entry) => entry.net === "I2C_SDA")).toEqual({ net: "I2C_SDA", ports: ["b3:I2C_SDA", "b4:I2C_SDA", "b5:I2C_SDA"], state: "bound" });
    expect(set.rails.find((rail) => rail.net === "+3V3")!.sheets).toEqual(["b1", "b3", "b4", "b5"]);
    expect(doc.findings).toEqual([`${DRONE_BLOCK_NAMES.barometer} was not designed: its ports I2C_SDA, I2C_SCL are unbound.`]);
  });
});

describe("[PR-J J5-1] the connection policy", () => {
  it("4. an undeclared same-name signal label in two blocks keeps the flat page with a finding naming it (the flat merge is unchanged)", () => {
    const a = block([["U1", U], ["R1", R]], [label("U1.EN", "EN"), label("R1.1", "EN"), label("U1.OUT", "SIG")]);
    const b = block([["U1", U]], [label("U1.EN", "EN"), label("U1.IN", "SIG")]);
    const { doc, flat } = synth([{ name: "Sensor", sharedNets: ["SIG"], netlist: a }, { name: "Logic", sharedNets: ["SIG"], netlist: b }]);
    expect(doc).toEqual({ schema: GENERATION_SHEETS_SCHEMA, sheets: null, findings: ["Kept on one page: EN is labelled in Sensor, Logic but is not a planned shared net."] });
    expect(flat.connections.filter((connection) => connection.kind === "label" && connection.labelName === "EN")).toHaveLength(3); // still one EN net on the flat page
    // declared, the same label is an interface instead
    const declared = synth([{ name: "Sensor", sharedNets: ["SIG", "EN"], netlist: a }, { name: "Logic", sharedNets: ["SIG", "EN"], netlist: b }]).doc;
    expect(declared.sheets!.interfaces.map((entry) => [entry.net, entry.state])).toEqual([["SIG", "bound"], ["EN", "bound"]]);
  });

  it("5. rails by EXACT name: AGND and GND are two rails, each joining its own pins across sheets, never merged by look-alike", () => {
    const a = block([["U1", U], ["R1", R]], [label("U1.GND", "GND"), label("R1.2", "AGND"), label("U1.OUT", "SIG")]);
    const b = block([["U1", U], ["R1", R]], [label("U1.GND", "AGND"), label("R1.2", "GND"), label("U1.IN", "SIG"), { from: "R1.1", to: "GND" }]);
    const { doc } = synth([{ name: "Analog", sharedNets: ["SIG", "AGND"], netlist: a }, { name: "Digital", sharedNets: ["SIG"], netlist: b }]);
    expect(doc.findings).toEqual([]);
    expect(doc.sheets!.rails).toEqual([{ net: "GND", kind: "ground", sheets: ["b1", "b2"] }, { net: "AGND", kind: "ground", sheets: ["b1", "b2"] }]);
    expect(doc.sheets!.children.map((child) => child.rails.map((rail) => rail.net))).toEqual([["GND", "AGND"], ["AGND", "GND"]]); // the literal GND wire endpoint is the GND rail
    expect(doc.sheets!.children.flatMap((child) => child.ports.map((port) => port.net))).toEqual(["SIG", "SIG"]); // a rail is never a port
    // an explicit labelKind decides: VREF as a power label in one block is a rail everywhere (one name, one net)
    const c = block([["U1", U]], [label("U1.VDD", "VREF", "power"), label("U1.OUT", "SIG")]);
    const d = block([["U1", U]], [label("U1.VDD", "VREF"), label("U1.IN", "SIG")]);
    expect(synth([{ name: "A", sharedNets: ["SIG"], netlist: c }, { name: "B", sharedNets: ["SIG"], netlist: d }]).doc.sheets!.rails).toEqual([{ net: "VREF", kind: "power", sheets: ["b1", "b2"] }]);
    // one name used as power in one block and ground in another is ambiguous: one page with a finding
    const e = block([["U1", U]], [label("U1.VDD", "VX", "power"), label("U1.OUT", "SIG")]);
    const f = block([["U1", U]], [label("U1.GND", "VX", "ground"), label("U1.IN", "SIG")]);
    expect(synth([{ name: "A", sharedNets: ["SIG"], netlist: e }, { name: "B", sharedNets: ["SIG"], netlist: f }]).doc).toEqual({ schema: GENERATION_SHEETS_SCHEMA, sheets: null, findings: ["Kept on one page: VX is labelled both as a power rail and as a ground."] });
  });

  it("6a. a declared shared net only one block labels is an unbound interface with a finding; a declared net a block does not label is its unbound port", () => {
    const a = block([["U1", U]], [label("U1.OUT", "SIG"), label("U1.EN", "WAKE")]);
    const b = block([["U1", U]], [label("U1.IN", "SIG")]);
    const { doc } = synth([{ name: "Sensor", sharedNets: ["SIG", "WAKE"], netlist: a }, { name: "Logic", sharedNets: ["SIG", "WAKE"], netlist: b }]);
    expect(doc.sheets!.interfaces).toEqual([{ net: "SIG", ports: ["b1:SIG", "b2:SIG"], state: "bound" }, { net: "WAKE", ports: ["b1:WAKE", "b2:WAKE"], state: "unbound" }]);
    expect(doc.sheets!.children.map((child) => child.ports.map((port) => `${port.net}:${port.direction}:${port.state}`))).toEqual([["SIG:output:bound", "WAKE:input:unbound"], ["SIG:input:bound", "WAKE:unspecified:unbound"]]);
    expect(doc.findings).toEqual(["Interface WAKE is carried by Sensor only; a shared net must join at least two sheets.", "Logic declares WAKE but does not label it; its port is unbound."]);
  });

  it("6b. the partition proof refuses a sheet set that would not reproduce the merged connections; inconsistent inputs refuse too", () => {
    const a = block([["U1", U], ["R1", R]], [label("U1.OUT", "SIG"), { from: "R1.1", to: "U1.EN" }]);
    const b = block([["U2", U]], [label("U2.IN", "SIG")]);
    const planned: GeneratedSheetsPlannedBlock[] = [{ blockId: "b1", name: "A", sharedNets: ["SIG"], status: "designed" }, { blockId: "b2", name: "B", sharedNets: ["SIG"], status: "designed" }];
    const merged = mergeBuildNetlists([{ name: "A", netlist: a }, { name: "B", netlist: b }]);
    const designed = merged.blocks.map((entry, index) => ({ blockId: `b${index + 1}`, name: entry.name, netlist: entry.netlist }));
    expect(deriveGeneratedSheets({ planned, designed, flat: merged.netlist, parts: SYNTH_PARTS }).sheets).not.toBeNull();
    // the same counts, one wire moved: not the merged design -> one page
    const moved = { ...merged.netlist, connections: merged.netlist.connections.map((connection) => ("from" in connection && connection.from === "R1.1" ? { from: "R1.1", to: "U2.EN" } : connection)) };
    expect(deriveGeneratedSheets({ planned, designed, flat: moved, parts: SYNTH_PARTS })).toEqual({ schema: GENERATION_SHEETS_SCHEMA, sheets: null, findings: ["Kept on one page: the sheet-scoped connections would not reproduce the merged design's pin-to-net partition."] });
    expect(deriveGeneratedSheets({ planned, designed, flat: { ...merged.netlist, connections: merged.netlist.connections.slice(1) }, parts: SYNTH_PARTS }).findings).toEqual(["Kept on one page: the designed blocks do not add up to the merged design."]);
    expect(deriveGeneratedSheets({ planned, designed: designed.slice(1), flat: merged.netlist, parts: SYNTH_PARTS }).findings).toEqual(["Kept on one page: the designed blocks do not match the plan's designed blocks."]);
    expect(deriveGeneratedSheets({ planned: planned.map((entry) => ({ ...entry, blockId: "main" })), designed, flat: merged.netlist, parts: SYNTH_PARTS }).findings).toEqual(["Kept on one page: the plan's blocks do not carry distinct block ids b1..b8."]);
  });

  it("6c. bounds refuse with a finding, never a silent cut: more than 8 planned blocks, more than 16 ports on a sheet", () => {
    const one = (index: number) => ({ name: `Block ${index}`, sharedNets: ["SIG"], netlist: block([[`U${index}`, U]], [label(`U${index}.OUT`, "SIG")]) });
    const nine = synth(Array.from({ length: 9 }, (_, index) => one(index + 1)));
    expect(nine.doc).toEqual({ schema: GENERATION_SHEETS_SCHEMA, sheets: null, findings: ["Kept on one page: the plan has 9 blocks; at most 8 subsystem sheets are derived."] });
    const nets = Array.from({ length: GENERATED_SHEETS_BOUNDS.portsPerSheet + 1 }, (_, index) => `S${index + 1}`);
    const wide = block(nets.map((_, index): [string, string] => [`R${index + 1}`, R]), nets.map((net, index) => label(`R${index + 1}.1`, net)));
    const narrow = block(nets.map((_, index): [string, string] => [`R${index + 1}`, R]), nets.map((net, index) => label(`R${index + 1}.2`, net)));
    const over = synth([{ name: "Wide", sharedNets: nets, netlist: wide }, { name: "Narrow", sharedNets: nets, netlist: narrow }]);
    expect(over.doc.sheets).toBeNull();
    expect(over.doc.findings).toEqual(["Kept on one page: Wide has 17 ports; a sheet records at most 16.", "Kept on one page: Narrow has 17 ports; a sheet records at most 16."]);
  });
});

describe("[PR-J J5-1] determinism and the defensive reader", () => {
  it("7a. the same input gives the same document (no clock, no random id), and a fresh merge of the same blocks gives it again", () => {
    const first = drone(4, false), second = drone(4, false);
    const a = deriveGeneratedSheets({ planned: first.planned, designed: first.designed, flat: first.merged.netlist, parts: PARTS });
    const b = deriveGeneratedSheets({ planned: second.planned, designed: second.designed, flat: second.merged.netlist, parts: [...PARTS].reverse() });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(JSON.stringify(deriveGeneratedSheets({ planned: first.planned, designed: first.designed, flat: first.merged.netlist, parts: PARTS }))).toBe(JSON.stringify(a));
  });

  it("7b. readGeneratedSheets returns a fresh equal copy of a derived document and refuses a malformed one whole", () => {
    const { planned, merged, designed } = drone(4, true, [DRONE_BLOCK_NAMES.barometer]);
    const doc = deriveGeneratedSheets({ planned, designed, flat: merged.netlist, parts: PARTS });
    const read = readGeneratedSheets(JSON.parse(JSON.stringify(doc)));
    expect(read).toEqual(doc);
    expect(readGeneratedSheets({ schema: GENERATION_SHEETS_SCHEMA, sheets: null, findings: ["x"] })).toEqual({ schema: GENERATION_SHEETS_SCHEMA, sheets: null, findings: ["x"] });
    const copy = (): GeneratedSheets => JSON.parse(JSON.stringify(doc)) as GeneratedSheets;
    const broken: Array<(value: GeneratedSheets) => unknown> = [
      (value) => ({ ...value, extra: true }),
      (value) => ({ ...value, schema: "sirkit.generation-sheets.v2" }),
      (value) => { value.sheets!.children[1]!.ports[0]!.portKey = "b1:PWM1"; return value; },
      (value) => { value.sheets!.interfaces[0]!.ports.push("b4:NOPE"); return value; },
      (value) => { value.sheets!.children[4]!.components = ["U9"]; return value; },
      (value) => { value.sheets!.children[0]!.sheetKey = "b2"; return value; },
      (value) => { value.sheets!.rails[0]!.sheets = ["b9" as never]; return value; },
      (value) => { (value.sheets!.children[0] as unknown as Record<string, unknown>).hidden = 1; return value; },
      (value) => { value.sheets!.children = value.sheets!.children.slice(0, 1); return value; },
    ];
    for (const [index, mutate] of broken.entries()) expect(readGeneratedSheets(mutate(copy())), `mutation ${index}`).toBeNull();
  });
});

describe("[PR-J J5-1] mergeAndValidate carries the sheet set beside the body, only for a planned result given its plan blocks", () => {
  const budget = () => ({ iterationCap: 20, iterationsUsed: 2, deadlineMs: 180_000, elapsedMs: 1, concurrencyCap: 3 });
  const a = block([["U1", U]], [label("U1.OUT", "SIG"), label("U1.GND", "GND")]);
  const b = block([["U1", U]], [label("U1.IN", "SIG"), label("U1.GND", "GND")]);
  const designed = [{ name: "Sensor", netlist: a, sharedNets: ["SIG", "GND"] }, { name: "Logic", netlist: b, sharedNets: ["SIG", "GND"] }];
  const plannedBlocks: GeneratedSheetsPlannedBlock[] = [{ blockId: "b1", name: "Sensor", sharedNets: ["SIG", "GND"], status: "designed" }, { blockId: "b2", name: "Logic", sharedNets: ["SIG", "GND"], status: "designed" }, { blockId: "b3", name: "Display", sharedNets: ["SIG"], status: "omitted" }];
  const common = { omittedBlocks: ["Display"], rationale: "", planner: { state: "planned" as const, blocks: 3 }, budget, emptyBlocks: "refuse" as const, partsByIds: async () => SYNTH_PARTS as unknown as AiPartResult[] };

  it("8. with the plan blocks: the derived set (the merge's final refDes) beside an unchanged body; without them, or for a single design: no sheets key", async () => {
    const withPlan = await mergeAndValidate({ ...common, designed, plannedBlocks });
    const without = await mergeAndValidate({ ...common, designed });
    if (withPlan.kind !== "merged" || without.kind !== "merged") throw new Error("merged expected");
    expect(withPlan.body).toEqual(without.body); // the route's body never carries sheets
    expect(withPlan.body).not.toHaveProperty("sheets");
    expect(without).not.toHaveProperty("sheets");
    const merged = mergeBuildNetlists(designed.map((entry) => ({ name: entry.name, netlist: entry.netlist })));
    expect(withPlan.sheets).toEqual(deriveGeneratedSheets({ planned: plannedBlocks, designed: merged.blocks.map((entry, index) => ({ blockId: `b${index + 1}`, name: entry.name, netlist: entry.netlist })), flat: merged.netlist, parts: SYNTH_PARTS }));
    expect(withPlan.sheets!.sheets!.children.map((child) => [child.sheetKey, child.status, child.components])).toEqual([["b1", "designed", ["U1"]], ["b2", "designed", ["U2"]], ["b3", "omitted", []]]);
    const single = await mergeAndValidate({ ...common, omittedBlocks: [], designed: [{ name: "Whole circuit", netlist: a }], planner: { state: "single", reason: "simple_request" }, plannedBlocks: [{ blockId: "main", name: "Whole circuit", sharedNets: [], status: "designed" }] });
    expect(single).not.toHaveProperty("sheets");
  });
});
