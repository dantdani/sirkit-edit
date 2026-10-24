/**
 * [PR-J5, 2026-10-23] Runbook J.6.2-J.6.3 (OD-255 item 9; OD-259 items 3, 5): a planned generation result laid out as REAL sheets
 * (lib/build-sheet-layout.ts `layoutGeneratedSheets`) over the fixture drone's result - built exactly as the fixture provider submits it
 * (its block designs over the committed catalog, merged with final reference designators, the sheet set derived by J5-1's
 * `deriveGeneratedSheets`). What it proves:
 *
 *  1. the four-motor drone: System overview + 4 sheets in plan order, each of the 41 catalog parts on exactly one child (the set's own
 *     partition), the ports as the set declares them, every port's labels inside its block turned into ONE hierarchical label each,
 *     exactly one sheet pin per port on its block's edge with a plain local label named after the interface at the same point, no
 *     hierarchy diagnostic at all, the project connectivity ok and multi-sheet, every bound interface's pins exactly the flat drawing's
 *     label group, the pin-to-net partition (every catalog pin) identical to the flat drawing's, the whole sheeted drawing validated
 *     against the flat netlist (a block alone reports its interface pins floating; the sheeted drawing does not);
 *  2. the barometer partial: the omitted block is an empty sheet with its declared ports, its block and pins on the overview - unanchored
 *     warnings only, never an error, never dropped;
 *  3. a tampered set (a label-joined part moved across blocks; a wire crossing two blocks; sheets that do not hold the parts) keeps
 *     the flat page with a finding; a set with no designed sheet too;
 *  4. rails by exact name: AGND and GND on two sheets are two rails, their interface one net;
 *  5. determinism: two runs give the same tree, ports, pins and structural ids; the module draws no crypto.randomUUID of its own (the
 *     per-block layouts draw exactly what they draw alone);
 *  6. the small helpers: the block netlist keeps literal-ground wires; the direction mapping.
 * Pure: no store, no provider, no database, no network.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mergeBuildNetlists } from "@/app/lib/merge-netlists";
import { BLINKER_PART_IDS } from "@/app/lib/fixture-runtime/blinker/catalog";
import { DRONE_BLOCK_NAMES } from "@/app/lib/fixture-runtime/generation-recipes";
import { deriveGeneratedSheets, type GeneratedSheetSet, type GeneratedSheetsPlannedBlock } from "@/app/lib/schematic/generated-sheets";
import { resolveProjectConnectivity, type ProjectConnectivity } from "@/app/lib/schematic/project-connectivity";
import { sheetOf, validateSheetHierarchy } from "@/app/lib/schematic/sheets";
import { ROOT_SHEET_ID, netLabelNameKey, type BuildLogicalNetlist, type SchematicState } from "@/lib/schematic-types";
import { autoLayoutBuildValidated } from "@/lib/build-auto-layout";
import { blockNetlistOf, generatedSheetId, generatedSheetSeedKey, layoutGeneratedSheets, sheetPortDirectionOf, type GeneratedSheetLayout } from "@/lib/build-sheet-layout";
import { J5_FIXTURE_CATALOG, J5_PIN_TYPED_PARTS, generatedDrone, j5FixtureLookup } from "./_j5-generated-drone";

afterEach(() => vi.restoreAllMocks());

// ─── the fixture drone as the provider submits it (the j5-generated-sheets recipe; app/lib/__tests__/_j5-generated-drone.ts) ─────────

const catalog = J5_FIXTURE_CATALOG;
const PARTS = J5_PIN_TYPED_PARTS;
const drone = generatedDrone;
const SEED = "eng1-0123456789abcdef0123456789abcdef";
const lookup = j5FixtureLookup;
const laidOut = (layout: GeneratedSheetLayout): Extract<GeneratedSheetLayout, { kind: "sheets" }> => { if (layout.kind !== "sheets") throw new Error(`kept flat: ${layout.finding}`); return layout; };
/** every catalog pin of a connectivity result as "REF#pad", grouped per net with two or more pins, canonical */
function pinGroups(state: SchematicState, conn: ProjectConnectivity): string[] {
  const refOf = new Map((state.kicadComponents ?? []).map((item) => [item.id, item.refDes] as const));
  return conn.nets.map((net) => net.pins.filter((pin) => pin.family === "kicad").map((pin) => `${refOf.get(pin.componentId)}#${pin.pinId}`).sort().join(",")).filter((group) => group.includes(",")).sort();
}
function pinsOfNet(state: SchematicState, conn: ProjectConnectivity, pick: (net: ProjectConnectivity["nets"][number]) => boolean): string[] {
  const refOf = new Map((state.kicadComponents ?? []).map((item) => [item.id, item.refDes] as const));
  const nets = conn.nets.filter(pick);
  expect(nets).toHaveLength(1);
  return nets[0]!.pins.filter((pin) => pin.family === "kicad").map((pin) => `${refOf.get(pin.componentId)}#${pin.pinId}`).sort();
}

describe("[PR-J5] 1. the four-motor drone lays out as System overview + 4 sheets", () => {
  const { netlist, set } = drone(4, false);
  const layout = laidOut(layoutGeneratedSheets(netlist, set, catalog, { seed: SEED }));
  const state = layout.state;
  const children = state.sheets!.sheets.filter((sheet) => sheet.parentId !== null);

  it("the tree: the root first, 4 children in plan order with deterministic ids and the set's names", () => {
    expect(state.sheets!.sheets[0]).toMatchObject({ id: ROOT_SHEET_ID, name: "System overview", parentId: null });
    expect(children.map((sheet) => sheet.id)).toEqual(["b1", "b2", "b3", "b4"].map((key) => `gen-${generatedSheetSeedKey(SEED)}-${key}`));
    expect(generatedSheetSeedKey(SEED)).toBe("0123456789ab");
    expect(children.map((sheet) => sheet.name)).toEqual([DRONE_BLOCK_NAMES.power, DRONE_BLOCK_NAMES.motors, DRONE_BLOCK_NAMES.mcu, DRONE_BLOCK_NAMES.imu]);
    expect(children.every((sheet) => sheet.block !== undefined && sheet.block.width > 0 && sheet.block.height > 0)).toBe(true);
    expect(layout.sheets.map((sheet) => [sheet.name, sheet.status, sheet.components])).toEqual([[DRONE_BLOCK_NAMES.power, "designed", set.children[0]!.components.length], [DRONE_BLOCK_NAMES.motors, "designed", set.children[1]!.components.length], [DRONE_BLOCK_NAMES.mcu, "designed", set.children[2]!.components.length], [DRONE_BLOCK_NAMES.imu, "designed", set.children[3]!.components.length]]);
  });

  it("every one of the 41 parts is on exactly one child, the set's own partition; nothing is drawn on the overview", () => {
    expect(state.kicadComponents).toHaveLength(41);
    for (const [index, child] of set.children.entries()) {
      const onSheet = state.kicadComponents!.filter((item) => item.sheetId === children[index]!.id).map((item) => item.refDes).sort();
      expect(onSheet).toEqual([...child.components].sort());
    }
    expect(state.kicadComponents!.filter((item) => item.sheetId === undefined)).toEqual([]);
    expect(state.components.filter((item) => sheetOf(item) === ROOT_SHEET_ID)).toEqual([]);
    expect(state.wires.filter((wire) => sheetOf(wire) === ROOT_SHEET_ID)).toEqual([]);
  });

  it("the ports as the set declares them; each port's labels inside are hierarchical labels of that port, none stays local", () => {
    expect(children.map((sheet) => (sheet.ports ?? []).map((port) => `${port.name}:${port.direction}`))).toEqual([
      [], ["PWM1", "PWM2", "PWM3", "PWM4"].map((net) => `${net}:passive`), ["PWM1", "PWM2", "PWM3", "PWM4", "I2C_SDA", "I2C_SCL", "IMU_INT1"].map((net) => `${net}:bidirectional`), ["I2C_SDA:bidirectional", "I2C_SCL:input", "IMU_INT1:output"],
    ]);
    for (const sheet of children) {
      for (const port of sheet.ports ?? []) {
        expect(port.id).toBe(`${sheet.id}:port:${port.name}`);
        const anchors = state.netLabels!.filter((label) => label.sheetId === sheet.id && label.portId === port.id && label.scope === "hierarchical");
        expect(anchors.length, `${sheet.name}/${port.name}`).toBeGreaterThanOrEqual(1);
        expect(anchors.map((label) => label.id)).toEqual(anchors.map((_, index) => `${port.id}:label:${index + 1}`));
        expect(anchors.every((label) => label.kind === "label" && label.name === port.name)).toBe(true);
        expect(state.netLabels!.filter((label) => label.sheetId === sheet.id && label.scope === undefined && netLabelNameKey(label.name) === netLabelNameKey(port.name))).toEqual([]);
      }
    }
    // rails stay as drawn: power and ground labels on every sheet, never scoped
    expect(state.netLabels!.filter((label) => label.kind === "power" || label.kind === "ground").every((label) => label.scope === undefined && label.sheetId !== undefined)).toBe(true);
  });

  it("the overview: one sheet pin per port on its block's edge and a local label named after the interface at the same point", () => {
    for (const sheet of children) {
      for (const port of sheet.ports ?? []) {
        const pins = state.netLabels!.filter((label) => label.scope === "sheet-pin" && label.portId === port.id);
        expect(pins).toHaveLength(1);
        const pin = pins[0]!;
        expect(pin).toMatchObject({ id: `${port.id}:pin`, name: port.name, kind: "label", childSheetId: sheet.id });
        expect(pin.sheetId).toBeUndefined();
        const block = sheet.block!;
        const inbound = port.direction === "input" || port.direction === "power_in";
        expect(pin.position.x).toBe(inbound ? block.x : block.x + block.width);
        expect(pin.position.y).toBeGreaterThanOrEqual(block.y);
        expect(pin.position.y).toBeLessThanOrEqual(block.y + block.height);
        const locals = state.netLabels!.filter((label) => label.id === `${port.id}:net`);
        expect(locals).toHaveLength(1);
        expect(locals[0]).toMatchObject({ name: port.name, kind: "label", position: pin.position });
        expect(locals[0]!.scope).toBeUndefined();
        expect(locals[0]!.sheetId).toBeUndefined();
      }
    }
    // the blocks do not overlap one another
    const blocks = children.map((sheet) => sheet.block!);
    for (const a of blocks) for (const b of blocks) if (a !== b) expect(a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height).toBe(false);
  });

  it("no hierarchy diagnostic; the connectivity is ok and multi-sheet; 7 interfaces; the partition equals the flat drawing's", () => {
    expect(validateSheetHierarchy(state)).toEqual([]);
    const conn = resolveProjectConnectivity(state, lookup);
    expect(conn.ok).toBe(true);
    expect(conn.mode).toBe("multi-sheet");
    expect(layout.interfaces).toEqual(["PWM1", "PWM2", "PWM3", "PWM4", "I2C_SDA", "I2C_SCL", "IMU_INT1"]);
    const flat = autoLayoutBuildValidated(netlist, catalog);
    expect(flat.validation.ok).toBe(true);
    const flatConn = resolveProjectConnectivity(flat.state, lookup);
    expect(pinGroups(state, conn)).toEqual(pinGroups(flat.state, flatConn));
    for (const net of layout.interfaces) {
      const portIds = new Set(children.flatMap((sheet) => (sheet.ports ?? []).filter((port) => port.name === net).map((port) => port.id)));
      const drawn = pinsOfNet(state, conn, (candidate) => candidate.portIds.some((id) => portIds.has(id)));
      const expected = pinsOfNet(flat.state, flatConn, (candidate) => candidate.name === net);
      expect(drawn, net).toEqual(expected);
      expect(drawn.length).toBeGreaterThanOrEqual(2);
    }
    // the rails are project-wide: one GND net across the four sheets, one VBAT, one +3V3
    for (const rail of ["GND", "VBAT", "+3V3"]) expect(conn.nets.filter((net) => net.name === rail && net.scope === "global")).toHaveLength(1);
    expect(conn.nets.find((net) => net.name === "GND")!.sheetIds.length).toBe(4);
  });

  it("the sheeted drawing validates against the flat netlist (no floating interface pin) and the layout reports no finding", () => {
    expect(layout.validation.ok).toBe(true);
    expect(layout.validation.violations).toEqual([]);
    expect(layout.findings).toEqual([]);
    // why the check is the whole drawing's: alone, a block's drawing reports each interface pin as floating (its one label has no
    // partner on that sheet) - through its port the pin reaches the other sheets, so the sheeted drawing has no such finding
    const mcu = set.children[2]!;
    const alone = autoLayoutBuildValidated(blockNetlistOf(netlist, mcu), catalog).validation;
    expect(alone.ok).toBe(false);
    expect(alone.violations.length).toBeGreaterThan(0);
    expect(alone.violations.every((item) => item.kind === "floating-pin")).toBe(true);
  });
});

describe("[PR-J5] 2. the barometer partial: the omitted block is a visible incomplete sheet", () => {
  it("an empty sheet with its declared ports, its block and sheet pins on the overview; unanchored warnings only", () => {
    const { netlist, set } = drone(4, true, [DRONE_BLOCK_NAMES.barometer]);
    expect(set.children.map((child) => child.status)).toEqual(["designed", "designed", "designed", "designed", "omitted"]);
    const layout = laidOut(layoutGeneratedSheets(netlist, set, catalog, { seed: SEED }));
    const omitted = layout.state.sheets!.sheets.find((sheet) => sheet.id === generatedSheetId(SEED, "b5"))!;
    expect(omitted).toMatchObject({ name: DRONE_BLOCK_NAMES.barometer, parentId: ROOT_SHEET_ID });
    expect((omitted.ports ?? []).map((port) => port.name)).toEqual(["I2C_SDA", "I2C_SCL"]);
    expect(omitted.block).toBeDefined();
    expect(layout.state.kicadComponents!.filter((item) => item.sheetId === omitted.id)).toEqual([]);
    expect(layout.state.netLabels!.filter((label) => label.scope === "sheet-pin" && label.childSheetId === omitted.id)).toHaveLength(2);
    const diagnostics = validateSheetHierarchy(layout.state);
    expect(diagnostics.every((item) => item.severity === "warning" && item.code === "SHEET_PORT_UNANCHORED")).toBe(true);
    expect(diagnostics).toHaveLength(2);
    expect(resolveProjectConnectivity(layout.state, lookup).ok).toBe(true);
    expect(layout.sheets.find((sheet) => sheet.sheetKey === "b5")).toMatchObject({ status: "omitted", components: 0, ports: ["I2C_SDA", "I2C_SCL"] });
    expect(layout.interfaces).toEqual(["PWM1", "PWM2", "PWM3", "PWM4", "I2C_SDA", "I2C_SCL", "IMU_INT1"]);
  });
});

describe("[PR-J5] 3. the conservative rule: a tampered or empty set keeps the flat page with a finding", () => {
  it("a label-joined part moved across blocks: its local nets would split, so the drawing proof keeps the flat page", () => {
    const { netlist, set } = drone(4, false);
    const motors = set.children[1]!, mcu = set.children[2]!;
    const q1 = motors.components.find((ref) => ref.startsWith("Q"))!;
    const tampered: GeneratedSheetSet = { ...set, children: set.children.map((child) => (child === motors ? { ...child, components: child.components.filter((ref) => ref !== q1) } : child === mcu ? { ...child, components: [...child.components, q1] } : child)) };
    const layout = layoutGeneratedSheets(netlist, tampered, catalog, { seed: SEED });
    expect(layout.kind).toBe("flat");
    if (layout.kind === "flat") expect(layout.finding).toMatch(/^Kept on one page: the sheeted drawing connects pins differently from the design \(\d+ net group\(s\) differ\)\.$/);
  });

  it("a wire between two blocks (a connection crossing without an interface) keeps the flat page", () => {
    const R = BLINKER_PART_IDS.resistor;
    const a: BuildLogicalNetlist = { components: [{ refDes: "R1", partId: R, value: "1k", role: "passive" }], connections: [{ kind: "label", pin: "R1.1", labelName: "SIG" }, { kind: "label", pin: "R1.2", labelName: "GND", labelKind: "ground" }], explanation: "" };
    const b: BuildLogicalNetlist = { components: [{ refDes: "R1", partId: R, value: "2k", role: "passive" }], connections: [{ kind: "label", pin: "R1.1", labelName: "SIG" }, { kind: "label", pin: "R1.2", labelName: "GND", labelKind: "ground" }], explanation: "" };
    const merged = mergeBuildNetlists([{ name: "A", netlist: a }, { name: "B", netlist: b }]);
    const planned: GeneratedSheetsPlannedBlock[] = [{ blockId: "b1", name: "A", sharedNets: ["SIG"], status: "designed" }, { blockId: "b2", name: "B", sharedNets: ["SIG"], status: "designed" }];
    const doc = deriveGeneratedSheets({ planned, designed: merged.blocks.map((block, index) => ({ blockId: `b${index + 1}`, name: block.name, netlist: block.netlist })), flat: merged.netlist, parts: PARTS });
    expect(doc.sheets).not.toBeNull();
    const crossing: BuildLogicalNetlist = { ...merged.netlist, connections: [...merged.netlist.connections, { from: "R1.1", to: "R2.1" }] };
    expect(layoutGeneratedSheets(crossing, doc.sheets!, catalog, { seed: SEED })).toEqual({ kind: "flat", kept: "flat", finding: "Kept on one page: 1 connection(s) cross sheets without a declared interface." });
    expect(laidOut(layoutGeneratedSheets(merged.netlist, doc.sheets!, catalog, { seed: SEED })).interfaces).toEqual(["SIG"]);
  });

  it("a set whose sheets do not hold the design's parts, and a set with no designed sheet", () => {
    const { netlist, set } = drone(4, false);
    const dropped: GeneratedSheetSet = { ...set, children: set.children.map((child, index) => (index === 3 ? { ...child, components: child.components.slice(1) } : child)) };
    expect(layoutGeneratedSheets(netlist, dropped, catalog, { seed: SEED })).toMatchObject({ kind: "flat", kept: "flat", finding: "Kept on one page: the sheets do not hold exactly the design's parts, each once." });
    const none: GeneratedSheetSet = { ...set, children: set.children.map((child) => ({ ...child, status: "omitted", components: [] })) };
    expect(layoutGeneratedSheets(netlist, none, catalog, { seed: SEED })).toMatchObject({ kind: "flat", finding: "Kept on one page: no planned sheet was designed." });
  });
});

describe("[PR-J5] 4. rails by exact name across sheets", () => {
  it("AGND and GND on two sheets are two rails; the shared signal is one interface net", () => {
    const R = BLINKER_PART_IDS.resistor;
    const a: BuildLogicalNetlist = { components: [{ refDes: "R1", partId: R, value: "1k", role: "passive" }], connections: [{ kind: "label", pin: "R1.1", labelName: "SIG" }, { kind: "label", pin: "R1.2", labelName: "AGND", labelKind: "ground" }], explanation: "" };
    const b: BuildLogicalNetlist = { components: [{ refDes: "R1", partId: R, value: "2k", role: "passive" }], connections: [{ kind: "label", pin: "R1.1", labelName: "SIG" }, { kind: "label", pin: "R1.2", labelName: "GND", labelKind: "ground" }], explanation: "" };
    const merged = mergeBuildNetlists([{ name: "Analog", netlist: a }, { name: "Digital", netlist: b }]);
    const planned: GeneratedSheetsPlannedBlock[] = [{ blockId: "b1", name: "Analog", sharedNets: ["SIG"], status: "designed" }, { blockId: "b2", name: "Digital", sharedNets: ["SIG"], status: "designed" }];
    const doc = deriveGeneratedSheets({ planned, designed: merged.blocks.map((block, index) => ({ blockId: `b${index + 1}`, name: block.name, netlist: block.netlist })), flat: merged.netlist, parts: PARTS });
    expect(doc.sheets).not.toBeNull();
    expect(doc.sheets!.rails.map((rail) => rail.net)).toEqual(["AGND", "GND"]);
    const layout = laidOut(layoutGeneratedSheets(merged.netlist, doc.sheets!, catalog, { seed: "rails" }));
    const conn = resolveProjectConnectivity(layout.state, lookup);
    expect(conn.ok).toBe(true);
    expect(conn.nets.filter((net) => net.kind === "ground").map((net) => net.name).sort()).toEqual(["AGND", "GND"]);
    expect(conn.diagnostics.filter((item) => item.code === "ISOLATION_DOMAIN_JOIN")).toEqual([]);
    expect(pinsOfNet(layout.state, conn, (net) => net.portIds.length > 0)).toEqual(["R1#1", "R2#1"]);
    expect(layout.interfaces).toEqual(["SIG"]);
  });
});

describe("[PR-J5] 5. determinism and no id draw of its own", () => {
  const structural = (state: SchematicState) => ({
    sheets: state.sheets,
    labels: (state.netLabels ?? []).filter((label) => label.scope !== undefined || label.id.includes(":port:")).map((label) => [label.id, label.name, label.position, label.scope ?? null, label.portId ?? null, label.childSheetId ?? null, label.sheetId ?? null]),
    partsBySheet: (state.kicadComponents ?? []).map((item) => `${item.refDes}@${item.sheetId}`).sort(),
    pageSize: state.pageSize,
  });

  it("two runs give the same tree, ports, pins, structural ids and placement", () => {
    const { netlist, set } = drone(4, false);
    const first = laidOut(layoutGeneratedSheets(netlist, set, catalog, { seed: SEED }));
    const second = laidOut(layoutGeneratedSheets(netlist, set, catalog, { seed: SEED }));
    expect(JSON.stringify(structural(second.state))).toBe(JSON.stringify(structural(first.state)));
    // another seed: another tree id, the same structure otherwise
    const other = laidOut(layoutGeneratedSheets(netlist, set, catalog, { seed: "eng1-fedcba9876543210" }));
    expect(other.state.sheets!.sheets[1]!.id).toBe("gen-fedcba987654-b1");
    expect(other.state.sheets!.sheets.length).toBe(first.state.sheets!.sheets.length);
  });

  it("the module draws no crypto.randomUUID; the layout draws exactly what its blocks' own layouts draw", () => {
    expect(readFileSync(join(process.cwd(), "lib", "build-sheet-layout.ts"), "utf8")).not.toContain("randomUUID");
    const { netlist, set } = drone(4, false);
    const spy = vi.spyOn(crypto, "randomUUID");
    for (const child of set.children) if (child.status === "designed") autoLayoutBuildValidated(blockNetlistOf(netlist, child), catalog);
    const alone = spy.mock.calls.length;
    spy.mockClear();
    laidOut(layoutGeneratedSheets(netlist, set, catalog, { seed: SEED }));
    expect(spy.mock.calls.length).toBe(alone);
    expect(alone).toBeGreaterThan(0);
  });
});

describe("[PR-J5] 6. the helpers", () => {
  it("a block netlist keeps its components, its label connections and the wires whose endpoints are its pins or the literal GND", () => {
    const flat: BuildLogicalNetlist = { components: [{ refDes: "R1", partId: "p", value: "", role: "passive" }, { refDes: "R2", partId: "p", value: "", role: "passive" }], connections: [{ from: "R1.1", to: "GND" }, { from: "R1.2", to: "R2.1" }, { kind: "label", pin: "R2.2", labelName: "X" }], explanation: "e" };
    expect(blockNetlistOf(flat, { components: ["R1"] })).toEqual({ components: [flat.components[0]], connections: [{ from: "R1.1", to: "GND" }], explanation: "e" });
    expect(blockNetlistOf(flat, { components: ["R2"] }).connections).toEqual([{ kind: "label", pin: "R2.2", labelName: "X" }]);
  });

  it("the direction mapping: tri-state is bidirectional, unspecified is passive", () => {
    expect(["input", "output", "bidirectional", "tri_state", "passive", "unspecified"].map((direction) => sheetPortDirectionOf(direction as never))).toEqual(["input", "output", "bidirectional", "bidirectional", "passive", "passive"]);
  });
});
