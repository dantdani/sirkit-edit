/**
 * [PR-J, 2026-10-22] Runbook section J increment 1 (J.4, J.5, J.9; OD-255 items 2, 3, 4, 5, 8): the sheet contract
 * (app/lib/schematic/sheets.ts) and THE project connectivity authority (app/lib/schematic/project-connectivity.ts).
 *
 *  1. Legacy parity: on the fixture blinker, the fixture drone and a Theory design, a single-sheet document resolves to EXACTLY the
 *     PCB netlist's nets (same endpoint sets, same names, the same union-find root strings) - the AGND/DGND -> GND collapse included,
 *     and reported as LEGACY_GROUND_NAME_COLLAPSE.
 *  2. Scope: identical coordinates and identical LOCAL label text on two sheets stay separate nets ("A/OUT", "B/OUT"); a sheet pin
 *     joins exactly its port's hierarchical labels (a same-named local label does not); global, power and ground labels join by exact
 *     name across sheets and different rail names never merge.
 *  3. Refusals with named diagnostics: missing / foreign ports, unbound ports, duplicate pins (conflicting bindings), cycles, two roots,
 *     unknown sheets, depth above 16, bus ports, repeated instances, split packages, a local name shadowing a global one, and an
 *     isolation-domain join.
 *  4. The branded lens can never be handed to a whole-project consumer; normalizeHierarchy restores the single-sheet form.
 * Pure: no network, no database, no randomness.
 */
import { describe, expect, it } from "vitest";
import { buildNetUnionFind } from "@/app/lib/connectivity";
import { kicadPinWorldPos, pinWorldPos, pointKey } from "@/app/lib/geometry";
import type { KicadPin } from "@/app/lib/kicad/types";
import { buildNetlist, type PartLookup } from "@/app/lib/pcb/netlist-bridge";
import { LOW_VOLTAGE_SCHEMATIC_PROFILE_V1 } from "@/app/lib/schematic-compiler/capability";
import { ROOT_SHEET_ID, type NetLabel, type SchComponent, type SchematicSheet, type SchematicState, type Wire } from "@/lib/schematic-types";
import { compareCodePoints } from "@/app/lib/stable-compare";
import { resolveProjectConnectivity, type PartPinsLookup, type ProjectConnectivity } from "../project-connectivity";
import { SHEET_LENS_BRAND, SHEET_LIMITS, SHEET_PORT_DIRECTIONS, assertWholeProject, carriesSheetLens, isSingleSheet, normalizeHierarchy, sheetLens, sheetOf, sheetPathName, validateSheetHierarchy } from "../sheets";
import { blinkerFixtureState, droneFixtureState, fixturePartLookup, theoryLegacyFixture } from "./_j1-fixtures";

// ── builders ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const resistor = (id: string, x: number, y: number, sheetId?: string): SchComponent => ({ id, type: "resistor", x, y, rotation: 0, value: "1k", ...(sheetId ? { sheetId } : {}) });
const wire = (id: string, a: { x: number; y: number }, b: { x: number; y: number }, sheetId?: string): Wire => ({ id, vertices: [a, b], ...(sheetId ? { sheetId } : {}) });
const label = (id: string, name: string, at: { x: number; y: number }, extra: Partial<NetLabel> = {}): NetLabel => ({ id, position: at, name, kind: "label", orientation: 0, ...extra });
const sheet = (id: string, name: string, parentId: string | null, extra: Partial<SchematicSheet> = {}): SchematicSheet => ({ id, name, parentId, ...extra });
const tree = (...children: SchematicSheet[]): SchematicState["sheets"] => ({ version: 1, sheets: [sheet(ROOT_SHEET_ID, "Overview", null), ...children] });
const key = (componentId: string, pin: string): string => `${encodeURIComponent(componentId)}::${encodeURIComponent(pin)}`;
const netOf = (state: SchematicState, member: string) => resolveProjectConnectivity(state).netOfPin(member);

// ── 1. legacy parity ────────────────────────────────────────────────────────────────────────────────────────────────────────

describe("[PR-J J1] 1. a single-sheet document resolves to exactly the nets the consumers publish today", () => {
  const cases: Array<[string, () => SchematicState, PartLookup | undefined]> = [
    ["the fixture blinker", blinkerFixtureState, fixturePartLookup()],
    ["the fixture drone", droneFixtureState, fixturePartLookup()],
    ["a Theory design with two ground names", theoryLegacyFixture, undefined],
  ];
  it.each(cases)("%s: every PCB netlist net is one project net with the same physical endpoints and name; root strings are buildNetUnionFind's", (_name, make, lookup) => {
    const state = make();
    const conn = resolveProjectConnectivity(state, lookup);
    expect(conn.mode).toBe("single-sheet");
    expect(conn.ok).toBe(true);
    expect(isSingleSheet(state)).toBe(true);
    const netlist = buildNetlist(state, lookup ?? (() => null));
    const physical = new Set(netlist.nets.flatMap((net) => net.endpointKeys));
    expect(netlist.nets.length).toBeGreaterThan(0);
    for (const published of netlist.nets) {
      const net = conn.netOfPin(published.endpointKeys[0]!);
      expect(net, published.name).not.toBeNull();
      expect(net!.members.filter((member) => physical.has(member)), published.name).toEqual(published.endpointKeys);
      if (!published.name.startsWith("N$")) expect(net!.name).toBe(published.name);
      else expect(net!.name).toBeNull();
    }
    // the union-find root of every pin is the legacy root string (SPICE node names and buildNetlist grouping depend on it)
    const kicadPoints = (state.kicadComponents ?? []).flatMap((instance) => (lookup?.(instance.partId)?.pins ?? []).map((pin) => kicadPinWorldPos(instance, pin)));
    const uf = buildNetUnionFind(state.components, state.wires, kicadPoints, state.netLabels ?? []);
    for (const pin of conn.pins) expect(conn.rootAt(ROOT_SHEET_ID, pin.point)).toBe(uf.find(pointKey(pin.point)));
    // every pin is in exactly one net
    expect(conn.nets.flatMap((net) => net.members).sort()).toEqual([...new Set(conn.pins.map((pin) => pin.key))].sort());
  });

  it("the legacy ground collapse is kept for a single-sheet design and reported; blinker and drone (one ground name) report nothing", () => {
    const theory = resolveProjectConnectivity(theoryLegacyFixture());
    const collapse = theory.diagnostics.find((item) => item.code === "LEGACY_GROUND_NAME_COLLAPSE");
    expect(collapse?.severity).toBe("warning");
    expect(collapse?.refs).toEqual(["AGND", "DGND"]);
    expect(collapse?.message).toContain("GND, AGND, DGND are joined");
    const gnd = theory.nets.find((net) => net.name === "GND")!;
    expect(gnd.kind).toBe("ground");
    expect(gnd.members).toEqual(expect.arrayContaining([key("R2", "2"), key("D1", "1"), key("GND1", "pin"), key("V1", "-")]));
    for (const make of [blinkerFixtureState, droneFixtureState]) {
      expect(resolveProjectConnectivity(make(), fixturePartLookup()).diagnostics.map((item) => item.code)).not.toContain("LEGACY_GROUND_NAME_COLLAPSE");
    }
  });

  it("an isolation-domain join wired in a single-sheet design is reported (not repaired)", () => {
    const state: SchematicState = { components: [], wires: [wire("w", { x: 0, y: 0 }, { x: 50, y: 0 })], netLabels: [label("a", "AGND", { x: 0, y: 0 }, { kind: "ground" }), label("d", "DGND", { x: 50, y: 0 }, { kind: "ground" })] };
    const conn = resolveProjectConnectivity(state);
    expect(conn.ok).toBe(true);
    expect(conn.railJoins).toEqual(["AGND|DGND"]);
    expect(conn.diagnostics.find((item) => item.code === "ISOLATION_DOMAIN_JOIN")?.message).toContain("AGND, DGND");
  });
});

// ── 2. scoped connectivity ──────────────────────────────────────────────────────────────────────────────────────────────────

/** R1 on sheet A and R2 on sheet B at IDENTICAL coordinates, each with a wire at the same XY and a local "OUT" label. */
function twinSheets(): SchematicState {
  return {
    components: [resistor("R1", 100, 100, "sa"), resistor("R2", 100, 100, "sb")],
    wires: [wire("wa", { x: 130, y: 100 }, { x: 200, y: 100 }, "sa"), wire("wb", { x: 130, y: 100 }, { x: 200, y: 100 }, "sb")],
    netLabels: [label("la", "OUT", { x: 200, y: 100 }, { sheetId: "sa" }), label("lb", "OUT", { x: 200, y: 100 }, { sheetId: "sb" })],
    sheets: tree(sheet("sa", "Analog", ROOT_SHEET_ID), sheet("sb", "Digital", ROOT_SHEET_ID)),
  };
}

describe("[PR-J J1] 2. coordinates and local labels connect only on their own sheet", () => {
  it("identical coordinates and identical LOCAL label text on two sheets give two nets, named by sheet path", () => {
    const conn = resolveProjectConnectivity(twinSheets());
    expect(conn.mode).toBe("multi-sheet");
    expect(conn.ok).toBe(true);
    const a = conn.netOfPin(key("R1", "2"))!;
    const b = conn.netOfPin(key("R2", "2"))!;
    expect(a.id).not.toBe(b.id);
    expect([a.name, b.name]).toEqual(["Analog/OUT", "Digital/OUT"]);
    expect([a.scope, b.scope]).toEqual(["local", "local"]);
    expect(conn.netAt("sa", { x: 200, y: 100 })).toBe(a);
    expect(conn.netAt("sb", { x: 200, y: 100 })).toBe(b);
    expect(conn.netAt(ROOT_SHEET_ID, { x: 200, y: 100 })).toBeNull();
    // the same two parts on ONE sheet are one net (the legacy behaviour the scope replaces)
    const flat = normalizeHierarchy({ ...twinSheets(), components: [resistor("R1", 100, 100), resistor("R2", 100, 400)], wires: [wire("wa", { x: 130, y: 100 }, { x: 200, y: 100 }), wire("wb", { x: 130, y: 400 }, { x: 200, y: 400 })], netLabels: [label("la", "OUT", { x: 200, y: 100 }), label("lb", "OUT", { x: 200, y: 400 })], sheets: undefined });
    expect(netOf(flat, key("R1", "2"))!.members).toEqual([key("R1", "2"), key("R2", "2")]);
  });

  it("net identity is endpoint-based: renaming a sheet renames its local nets but keeps their ids", () => {
    const before = resolveProjectConnectivity(twinSheets()).netOfPin(key("R1", "2"))!;
    const renamed = twinSheets();
    renamed.sheets!.sheets[1]!.name = "Front end";
    const after = resolveProjectConnectivity(renamed).netOfPin(key("R1", "2"))!;
    expect(after.name).toBe("Front end/OUT");
    expect(after.id).toBe(before.id);
  });
});

/** Overview with R1 wired to a sheet pin "SIG" of child "ADC"; inside ADC, R2 wired to the hierarchical label of the same port. A
 *  local label "SIG" on the overview at R3 must NOT join (names never connect ports). */
function boundPorts(withPin = true): SchematicState {
  return {
    components: [resistor("R1", 100, 100), resistor("R3", 100, 300), resistor("R2", 100, 100, "adc")],
    wires: [wire("w1", { x: 130, y: 100 }, { x: 300, y: 100 }), wire("w2", { x: 130, y: 100 }, { x: 300, y: 100 }, "adc")],
    netLabels: [
      ...(withPin ? [label("pin-sig", "SIG", { x: 300, y: 100 }, { scope: "sheet-pin", portId: "p-sig", childSheetId: "adc" })] : []),
      label("h-sig", "SIG", { x: 300, y: 100 }, { sheetId: "adc", scope: "hierarchical", portId: "p-sig" }),
      label("l-sig", "SIG", { x: 130, y: 300 }),
    ],
    sheets: tree(sheet("adc", "ADC", ROOT_SHEET_ID, { block: { x: 400, y: 50, width: 200, height: 100 }, ports: [{ id: "p-sig", name: "SIG", direction: "input" }] })),
  };
}

describe("[PR-J J1] 3. a hierarchical binding connects exactly the intended pins", () => {
  it("R1.2 (overview) and R2.2 (ADC) are one net through port SIG; R3's same-named local label is a different net, and that is a name collision", () => {
    const conn = resolveProjectConnectivity(boundPorts());
    const bound = conn.netOfPin(key("R1", "2"))!;
    expect(bound.members).toEqual([key("R1", "2"), key("R2", "2")]);
    expect(bound.scope).toBe("hierarchical");
    expect(bound.portIds).toEqual(["p-sig"]);
    expect(bound.sheetIds).toEqual(["adc", ROOT_SHEET_ID].sort());
    expect(conn.netOfPin(key("R3", "2"))!.id).not.toBe(bound.id);
    // both nets would be published as "SIG": distinct nets never share a board name
    expect(conn.ok).toBe(false);
    expect(conn.diagnostics.find((item) => item.code === "SHEET_NET_NAME_COLLISION")?.message).toContain("SIG");
  });

  it("without the colliding local label the binding is clean; removing the sheet pin separates the pins again (and reports the unbound port)", () => {
    const clean = boundPorts();
    clean.netLabels = clean.netLabels!.filter((item) => item.id !== "l-sig");
    const conn = resolveProjectConnectivity(clean);
    expect(conn.ok).toBe(true);
    expect(conn.netOfPin(key("R1", "2"))!.name).toBe("SIG");
    const unbound = boundPorts(false);
    unbound.netLabels = unbound.netLabels!.filter((item) => item.id !== "l-sig");
    const separated = resolveProjectConnectivity(unbound);
    expect(separated.ok).toBe(true);
    expect(separated.netOfPin(key("R1", "2"))!.members).toEqual([key("R1", "2")]);
    expect(separated.netOfPin(key("R2", "2"))!.name).toBe("ADC/SIG");
    expect(separated.diagnostics.find((item) => item.code === "SHEET_PORT_UNBOUND")).toMatchObject({ severity: "warning", refs: ["adc", "p-sig"] });
    expect(separated.partitionDigest).not.toBe(conn.partitionDigest);
  });
});

describe("[PR-J J1] 4. intentional project-global nets; distinct rails never merge", () => {
  function globals(): SchematicState {
    return {
      components: [resistor("R1", 100, 100), resistor("R2", 100, 100, "s1"), resistor("R3", 100, 100, "s2")],
      wires: [],
      netLabels: [
        label("v0", "+3V3", { x: 70, y: 100 }, { kind: "power" }), label("v1", "+3V3", { x: 70, y: 100 }, { kind: "power", sheetId: "s1" }), label("v2", "+3V3", { x: 70, y: 100 }, { kind: "power", sheetId: "s2" }),
        label("g1", "SPI_CLK", { x: 130, y: 100 }, { scope: "global" }), label("g2", "SPI_CLK", { x: 130, y: 100 }, { scope: "global", sheetId: "s1" }),
        label("l3", "SPI_CLK", { x: 130, y: 100 }, { sheetId: "s2" }),
      ],
      sheets: tree(sheet("s1", "MCU", ROOT_SHEET_ID), sheet("s2", "ADC", ROOT_SHEET_ID)),
    };
  }
  it("+3V3 power labels on three sheets are one net; a global SPI_CLK joins across sheets while an unscoped SPI_CLK does not", () => {
    const conn = resolveProjectConnectivity(globals());
    const rail = conn.netOfPin(key("R1", "1"))!;
    expect(rail.members).toEqual([key("R1", "1"), key("R2", "1"), key("R3", "1")]);
    expect([rail.name, rail.kind, rail.scope]).toEqual(["+3V3", "power", "global"]);
    const clk = conn.netOfPin(key("R1", "2"))!;
    expect(clk.members).toEqual([key("R1", "2"), key("R2", "2")]);
    const local = conn.netOfPin(key("R3", "2"))!;
    expect(local.id).not.toBe(clk.id);
    // the unscoped SPI_CLK on ADC is ADC's own net, displayed by its sheet path (no collision with the global name)
    expect([clk.name, clk.scope, local.name, local.scope]).toEqual(["SPI_CLK", "global", "ADC/SPI_CLK", "local"]);
    expect(conn.ok).toBe(true);
  });
  it("AGND on one sheet and DGND on another stay separate nets; ground symbols and GND labels are one GND net across sheets", () => {
    const state: SchematicState = {
      components: [resistor("R1", 100, 100), resistor("R2", 100, 100, "s1"), { id: "G1", type: "ground", x: 130, y: 120, rotation: 0, value: "", sheetId: "s1" }],
      wires: [],
      netLabels: [label("a", "AGND", { x: 70, y: 100 }, { kind: "ground" }), label("d", "DGND", { x: 70, y: 100 }, { kind: "ground", sheetId: "s1" }), label("g", "GND", { x: 130, y: 100 }, { kind: "ground" })],
      sheets: tree(sheet("s1", "Digital", ROOT_SHEET_ID)),
    };
    const conn = resolveProjectConnectivity(state);
    expect(conn.ok).toBe(true);
    expect(conn.netOfPin(key("R1", "1"))!.name).toBe("AGND");
    expect(conn.netOfPin(key("R2", "1"))!.name).toBe("DGND");
    expect(conn.netOfPin(key("R1", "1"))!.id).not.toBe(conn.netOfPin(key("R2", "1"))!.id);
    const gnd = conn.netOfPin(key("R1", "2"))!;
    expect(gnd.members).toEqual([key("G1", "pin"), key("R1", "2"), key("R2", "2")].sort());
    expect(gnd.groundSymbol).toBe(true);
    expect(conn.diagnostics.map((item) => item.code)).not.toContain("LEGACY_GROUND_NAME_COLLAPSE");
    expect(conn.railJoins).toEqual([]);
  });
});

// ── 3. refusals ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

describe("[PR-J J1] 5. invalid hierarchies refuse with named diagnostics and resolve to no nets", () => {
  const base = (): SchematicState => { const state = boundPorts(); state.netLabels = state.netLabels!.filter((item) => item.id !== "l-sig"); return state; };
  const errorCodes = (state: SchematicState): string[] => validateSheetHierarchy(state).filter((item) => item.severity === "error").map((item) => item.code);
  const cases: Array<[string, (state: SchematicState) => void, string]> = [
    ["a sheet pin naming a port that does not exist", (state) => { state.netLabels![0]!.portId = "p-nope"; }, "SHEET_PIN_PORT_MISSING"],
    ["a hierarchical label on the wrong sheet", (state) => { delete state.netLabels![1]!.sheetId; }, "SHEET_PIN_PORT_MISSING"],
    ["a sheet pin that is not on the child's parent", (state) => { state.sheets!.sheets.push(sheet("s2", "Other", ROOT_SHEET_ID)); state.netLabels![0]!.sheetId = "s2"; }, "SHEET_PIN_PLACEMENT_INVALID"],
    ["two sheet pins for one port (conflicting bindings)", (state) => { state.netLabels!.push(label("pin-2", "SIG", { x: 500, y: 500 }, { scope: "sheet-pin", portId: "p-sig", childSheetId: "adc" })); }, "SHEET_BINDING_DUPLICATE"],
    ["a parent cycle", (state) => { state.sheets!.sheets.push(sheet("x1", "X1", "x2"), sheet("x2", "X2", "x1")); }, "SHEET_HIERARCHY_CYCLE"],
    ["two roots", (state) => { state.sheets!.sheets.push(sheet("r2", "Second root", null)); }, "SHEET_ROOT_CARDINALITY"],
    ["an entity on an unknown sheet", (state) => { state.components[0]!.sheetId = "nowhere"; }, "SHEET_REFERENCE_INVALID"],
    ["an entity that stores the root id", (state) => { state.components[0]!.sheetId = ROOT_SHEET_ID; }, "SHEET_REFERENCE_NONCANONICAL"],
    ["a missing parent", (state) => { state.sheets!.sheets.push(sheet("orphan", "Orphan", "gone")); }, "SHEET_PARENT_MISSING"],
    ["two sibling sheets with one name", (state) => { state.sheets!.sheets.push(sheet("adc2", "adc", ROOT_SHEET_ID)); }, "SHEET_NAME_DUPLICATE"],
    ["a bus port name", (state) => { state.sheets!.sheets[1]!.ports!.push({ id: "p-bus", name: "DATA[0..7]", direction: "input" }); }, "SHEET_BUNDLE_UNSUPPORTED"],
    ["a bundle port field", (state) => { (state.sheets!.sheets[1]!.ports![0] as unknown as Record<string, unknown>).members = ["D0", "D1"]; }, "SHEET_BUNDLE_UNSUPPORTED"],
    ["a repeated sheet instance", (state) => { (state.sheets!.sheets[1] as unknown as Record<string, unknown>).instanceOf = "adc"; }, "SHEET_REPEATED_INSTANCE_UNSUPPORTED"],
    ["one package's units split across sheets", (state) => { state.kicadComponents = [{ id: "u1", partId: "p", x: 0, y: 0, rotation: 0, refDes: "U1", value: "x", unitPlacements: [{ unit: 2, sheetId: "adc" }] } as never]; }, "SHEET_UNIT_SPLIT_UNSUPPORTED"],
    ["a port on the root sheet", (state) => { state.sheets!.sheets[0]!.ports = [{ id: "p-root", name: "X", direction: "input" }]; }, "SHEET_PORT_ON_ROOT"],
    ["two ports with one name on a sheet", (state) => { state.sheets!.sheets[1]!.ports!.push({ id: "p-sig-2", name: "sig", direction: "output" }); }, "SHEET_PORT_NAME_DUPLICATE"],
    ["a power label with a scope", (state) => { state.netLabels!.push(label("pw", "+5V", { x: 0, y: 0 }, { kind: "power", scope: "global" })); }, "SHEET_LABEL_SCOPE_INVALID"],
    ["a sheet tree with only the root", (state) => { state.sheets = tree(); state.components = state.components.filter((item) => !item.sheetId); state.wires = state.wires.filter((item) => !item.sheetId); state.netLabels = []; }, "SHEET_SET_TRIVIAL"],
  ];
  it.each(cases)("%s -> %s", (_label, mutate, code) => {
    const state = base();
    expect(errorCodes(state)).toEqual([]);
    mutate(state);
    expect(errorCodes(state)).toContain(code);
    const conn = resolveProjectConnectivity(state);
    expect(conn.ok).toBe(false);
    expect(conn.nets).toEqual([]);
    expect(conn.diagnostics.find((item) => item.code === code)?.message.length).toBeGreaterThan(20);
  });

  it("depth above 16 (the CD-8 capability limit) is refused; 16 levels are accepted", () => {
    const chain = (levels: number): SchematicState => {
      const sheets = Array.from({ length: levels }, (_, index) => sheet(`d${index + 1}`, `Level ${index + 1}`, index === 0 ? ROOT_SHEET_ID : `d${index}`));
      return { components: [], wires: [], sheets: { version: 1, sheets: [sheet(ROOT_SHEET_ID, "Overview", null), ...sheets] } };
    };
    expect(validateSheetHierarchy(chain(16)).filter((item) => item.severity === "error")).toEqual([]);
    expect(validateSheetHierarchy(chain(17)).map((item) => item.code)).toContain("SHEET_DEPTH_LIMIT");
    expect(sheetPathName(chain(3), "d3")).toBe("Level 1/Level 2/Level 3");
  });

  it("a single-sheet document may not carry sheet references or port labels (a v1 document has no sheets); a global label is allowed", () => {
    expect(validateSheetHierarchy({ components: [resistor("R1", 0, 0, "s1")], wires: [] }).map((item) => item.code)).toEqual(["SHEET_REFERENCE_INVALID"]);
    expect(validateSheetHierarchy({ components: [], wires: [], netLabels: [label("h", "X", { x: 0, y: 0 }, { scope: "hierarchical", portId: "p" })] }).map((item) => item.code)).toEqual(["SHEET_REFERENCE_INVALID"]);
    expect(validateSheetHierarchy({ components: [], wires: [], netLabels: [label("g", "X", { x: 0, y: 0 }, { scope: "global" })] })).toEqual([]);
  });

  it("the port vocabulary and the limits are CD-8's", () => {
    expect(SHEET_LIMITS.maximumSheets).toBe(LOW_VOLTAGE_SCHEMATIC_PROFILE_V1.limits.maximumSheets);
    expect(SHEET_LIMITS.maximumHierarchyDepth).toBe(LOW_VOLTAGE_SCHEMATIC_PROFILE_V1.limits.maximumHierarchyDepth);
    expect([...SHEET_PORT_DIRECTIONS].sort()).toEqual(["bidirectional", "input", "output", "passive", "power_in", "power_out"]);
  });
});

// ── 4. packages, lens, canonical form ───────────────────────────────────────────────────────────────────────────────────────

describe("[PR-J J1] 6. one package is one instance; the lens is never the project; the canonical form", () => {
  const PINS: KicadPin[] = [1, 2, 3, 4].map((n) => ({ number: String(n), name: `P${n}`, type: "passive", position: { x: n * 2.54, y: 0 }, orientation: 0, length: 2.54, unit: n <= 2 ? 1 : 2 }));
  const lookup: PartPinsLookup = (partId) => (partId === "dual" ? { pins: PINS } : null);

  it("a multi-unit part placed once on a child sheet is one component with all its pins, counted once", () => {
    const state: SchematicState = { components: [], wires: [], kicadComponents: [{ id: "u1", partId: "dual", x: 100, y: 100, rotation: 0, refDes: "U1", value: "LM358", sheetId: "amp" }], sheets: tree(sheet("amp", "Amplifier", ROOT_SHEET_ID)) };
    const conn = resolveProjectConnectivity(state, lookup);
    expect(conn.pins.filter((pin) => pin.componentId === "u1").map((pin) => pin.pinId)).toEqual(["1", "2", "3", "4"]);
    expect(new Set(conn.pins.map((pin) => pin.sheetId))).toEqual(new Set(["amp"]));
    expect(conn.nets.flatMap((net) => net.members).filter((member) => member.startsWith("u1::"))).toHaveLength(4);
  });

  it("sheetLens returns one sheet's entities, frozen and branded; a whole-project consumer refuses it and anything rebuilt from it", () => {
    const state = twinSheets();
    const lens = sheetLens(state, "sa");
    expect(lens.components.map((item) => item.id)).toEqual(["R1"]);
    expect(lens.wires.map((item) => item.id)).toEqual(["wa"]);
    expect(lens.netLabels.map((item) => item.id)).toEqual(["la"]);
    expect(Object.isFrozen(lens.components)).toBe(true);
    expect(lens[SHEET_LENS_BRAND]).toBe("sa");
    expect(JSON.stringify(lens.components)).toBe(JSON.stringify([state.components[0]]));
    expect(() => assertWholeProject(lens, "buildNetlist")).toThrow(/^SHEET_LENS_NOT_PROJECT:buildNetlist/);
    const rebuilt = { components: lens.components, wires: lens.wires } as unknown as SchematicState;
    expect(carriesSheetLens(rebuilt)).toBe(true);
    expect(() => assertWholeProject(rebuilt, "buildPcbSyncPublicationGraph")).toThrow(/SHEET_LENS_NOT_PROJECT/);
    expect(() => assertWholeProject(state, "buildNetlist")).not.toThrow();
    expect(carriesSheetLens(structuredClone({ components: [...lens.components], wires: [] }))).toBe(false);
    const compileTimeOnly = (): void => {
      // @ts-expect-error a lens is not a SchematicState (readonly branded arrays): it cannot be passed to a whole-project consumer
      buildNetlist(lens);
    };
    void compileTimeOnly;
    expect(() => sheetLens(state, "missing")).toThrow("SHEET_NOT_FOUND:missing");
    expect(sheetLens(blinkerFixtureState(), ROOT_SHEET_ID).kicadComponents).toHaveLength(9);
  });

  it("normalizeHierarchy: a canonical document is returned as is; a tree with no child sheet collapses to the single-sheet document", () => {
    const state = twinSheets();
    expect(normalizeHierarchy(state)).toBe(state);
    const flat = blinkerFixtureState();
    expect(normalizeHierarchy(flat)).toBe(flat);
    const collapsed = normalizeHierarchy({ ...flat, components: [resistor("R9", 0, 0, ROOT_SHEET_ID)], sheets: tree() });
    expect(collapsed.sheets).toBeUndefined();
    expect(collapsed.components[0]).toEqual(resistor("R9", 0, 0));
    expect(Object.keys(collapsed.components[0]!)).not.toContain("sheetId");
    const emptyPorts = twinSheets();
    emptyPorts.sheets!.sheets[1]!.ports = [];
    expect(Object.keys(normalizeHierarchy(emptyPorts).sheets!.sheets[1]!)).toEqual(["id", "name", "parentId"]);
    expect(sheetOf({})).toBe(ROOT_SHEET_ID);
    expect(pinWorldPos(state.components[0]!, "right")).toEqual({ x: 130, y: 100 });
  });
});

// ── [PR-J1 integration, 2026-10-22] the round-1 review's confirmed findings (PC-1 .. PC-7, J1-OPS-2) ─────────────────────────

/** Two sibling sheets "Power" and "Filter", each with an output port "OUT" bound by a sheet pin on the overview and wired (or not
 *  yet) to its own overview resistor. No user label anywhere: the only names are the port anchors (the J.1 layout). */
function siblingOuts(withOverviewWires = true): SchematicState {
  return {
    components: [resistor("R1", 100, 100), resistor("R2", 100, 300), resistor("R3", 100, 100, "pa"), resistor("R4", 100, 100, "pb")],
    wires: withOverviewWires ? [wire("w1", { x: 130, y: 100 }, { x: 300, y: 100 }), wire("w2", { x: 130, y: 300 }, { x: 300, y: 300 })] : [],
    netLabels: [
      label("pin-a", "OUT", { x: 300, y: 100 }, { scope: "sheet-pin", portId: "pa-out", childSheetId: "pa" }),
      label("pin-b", "OUT", { x: 300, y: 300 }, { scope: "sheet-pin", portId: "pb-out", childSheetId: "pb" }),
      label("h-a", "OUT", { x: 130, y: 100 }, { sheetId: "pa", scope: "hierarchical", portId: "pa-out" }),
      label("h-b", "OUT", { x: 130, y: 100 }, { sheetId: "pb", scope: "hierarchical", portId: "pb-out" }),
    ],
    sheets: tree(
      sheet("pa", "Power", ROOT_SHEET_ID, { ports: [{ id: "pa-out", name: "OUT", direction: "output" }] }),
      sheet("pb", "Filter", ROOT_SHEET_ID, { ports: [{ id: "pb-out", name: "OUT", direction: "output" }] }),
    ),
  };
}

const codesOf = (state: SchematicState): string[] => resolveProjectConnectivity(state).diagnostics.map((item) => `${item.severity}:${item.code}`);

describe("[PR-J1 integration, 2026-10-22] PC-1: nets named only by their port anchors never collide", () => {
  it("two sibling sheets with an OUT port each, bound on the overview: two nets named by the port's sheet path, published", () => {
    const state = siblingOuts();
    expect(validateSheetHierarchy(state).filter((item) => item.severity === "error")).toEqual([]);
    const conn = resolveProjectConnectivity(state);
    expect(conn.ok, codesOf(state).join(" ")).toBe(true);
    expect(conn.diagnostics.map((item) => item.code)).not.toContain("SHEET_NET_NAME_COLLISION");
    const power = conn.netOfPin(key("R1", "2"))!;
    const filter = conn.netOfPin(key("R2", "2"))!;
    expect([power.name, power.members]).toEqual(["Power/OUT", [key("R1", "2"), key("R3", "2")]]);
    expect([filter.name, filter.members]).toEqual(["Filter/OUT", [key("R2", "2"), key("R4", "2")]]);
    expect(buildNetlist(state).nets.map((net) => net.name).filter((name) => name.endsWith("OUT")).sort()).toEqual(["Filter/OUT", "Power/OUT"]);
  });

  it("the same sheet pins with nothing wired on the overview yet are still a valid project", () => {
    const conn = resolveProjectConnectivity(siblingOuts(false));
    expect(conn.ok).toBe(true);
    expect([conn.netOfPin(key("R3", "2"))!.name, conn.netOfPin(key("R4", "2"))!.name]).toEqual(["Power/OUT", "Filter/OUT"]);
  });

  it("a name the user wrote is still never shared: a local OUT on the overview next to the two port nets is a collision", () => {
    const state = siblingOuts();
    state.components.push(resistor("R5", 100, 500));
    state.netLabels!.push(label("l-out", "OUT", { x: 130, y: 500 }));
    const conn = resolveProjectConnectivity(state);
    expect(conn.ok).toBe(false);
    expect(conn.diagnostics.find((item) => item.code === "SHEET_NET_NAME_COLLISION")?.message).toContain("OUT");
  });

  it("a qualified port name that meets a user's name on that sheet gets a deterministic suffix (the shadow is reported)", () => {
    const state = siblingOuts();
    state.components.push(resistor("R6", 100, 300, "pa"));
    state.netLabels!.push(label("l-pa-out", "OUT", { x: 130, y: 300 }, { sheetId: "pa" }));
    const conn = resolveProjectConnectivity(state);
    expect(conn.ok, codesOf(state).join(" ")).toBe(true);
    expect(conn.netOfPin(key("R6", "2"))!.name).toBe("Power/OUT");
    expect(conn.netOfPin(key("R1", "2"))!.name).toBe("Power/OUT_2");
    expect(conn.netOfPin(key("R2", "2"))!.name).toBe("Filter/OUT");
    expect(new Set(conn.nets.flatMap((net) => (net.name === null ? [] : [net.name]))).size).toBe(conn.nets.filter((net) => net.name !== null).length);
    expect(conn.diagnostics.find((item) => item.code === "SHEET_LOCAL_SHADOWS_PORT")).toMatchObject({ severity: "warning", refs: ["h-a", "l-pa-out"] });
  });
});

describe("[PR-J1 integration, 2026-10-22] PC-2: the single-sheet derivation is linear in the pins", () => {
  const mkPins = (count: number): KicadPin[] => Array.from({ length: count }, (_, index) => ({ number: String(index + 1), name: `P${index + 1}`, type: "passive", position: { x: (index % 2 === 0 ? -1 : 1) * 7.62, y: -Math.floor(index / 2) * 2.54 }, orientation: 0, length: 2.54 }) as unknown as KicadPin);
  const PARTS = new Map<string, { pins: KicadPin[] }>([["p2", { pins: mkPins(2) }], ["p40", { pins: mkPins(40) }]]);
  const partLookup: PartPinsLookup = (partId) => PARTS.get(partId) ?? null;
  /** mulberry32: a fixed pseudo-random sequence (no Math.random). */
  const sequence = (seed: number): (() => number) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  const fastest = (run: () => unknown): number => { run(); let best = Number.POSITIVE_INFINITY; for (let round = 0; round < 5; round += 1) { const start = performance.now(); run(); best = Math.min(best, performance.now() - start); } return best; };

  it("1,000 parts (17,200 pins) and 4,000 wires: the nets are the union's partition in document order, at a small multiple of the union's cost", () => {
    const next = sequence(11);
    const kicadComponents = Array.from({ length: 1000 }, (_, index) => ({ id: `k${index}`, partId: index < 400 ? "p40" : "p2", x: (index % 40) * 400, y: Math.floor(index / 40) * 400, rotation: 0 as const, refDes: `U${index}`, value: "v" }));
    const points = kicadComponents.flatMap((instance) => PARTS.get(instance.partId)!.pins.map((pin) => kicadPinWorldPos(instance, pin)));
    expect(points).toHaveLength(17_200);
    const wires: Wire[] = Array.from({ length: 4000 }, (_, index) => { const a = points[Math.floor(next() * points.length)]!; const b = points[Math.floor(next() * points.length)]!; return { id: `w${index}`, vertices: [a, { x: a.x, y: b.y }, b] }; });
    const state: SchematicState = { components: [], wires, kicadComponents, netLabels: [] };
    const conn = resolveProjectConnectivity(state, partLookup);
    // correctness: one net per union root (no labels, so no name merging), each net's pins in document order
    const uf = buildNetUnionFind([], wires, points, []);
    const byRoot = new Map<string, string[]>();
    conn.pins.forEach((pin) => { const root = uf.find(pointKey(pin.point)); byRoot.set(root, [...(byRoot.get(root) ?? []), pin.key]); });
    expect(conn.nets.map((net) => net.members.join("|")).sort()).toEqual([...byRoot.values()].map((members) => [...members].sort().join("|")).sort());
    const order = new Map(conn.pins.map((pin, index) => [pin, index] as const));
    for (const net of conn.nets) expect(net.pins.every((pin, index) => index === 0 || order.get(net.pins[index - 1]!)! < order.get(pin)!)).toBe(true);
    // cost: the derivation must not scan every pin once per net (that was ~45x the union here; linear is ~6x)
    const unionMs = fastest(() => buildNetUnionFind([], wires, points, []));
    const resolveMs = fastest(() => resolveProjectConnectivity(state, partLookup));
    expect(resolveMs, `resolve ${resolveMs.toFixed(1)} ms, union ${unionMs.toFixed(1)} ms`).toBeLessThan(25 * unionMs + 20);
  });
});

describe("[PR-J1 integration, 2026-10-22] PC-3: the authority itself refuses one sheet's view", () => {
  it("resolveProjectConnectivity refuses a lens, and a state rebuilt from a lens's arrays", () => {
    const lens = sheetLens(twinSheets(), "sa");
    expect(() => resolveProjectConnectivity(lens as unknown as SchematicState)).toThrow(/^SHEET_LENS_NOT_PROJECT:project-connectivity/);
    expect(() => resolveProjectConnectivity({ components: lens.components, wires: lens.wires } as unknown as SchematicState)).toThrow(/^SHEET_LENS_NOT_PROJECT:project-connectivity/);
    expect(() => resolveProjectConnectivity(twinSheets())).not.toThrow();
  });
});

describe("[PR-J1 integration, 2026-10-22] PC-4 / J1-OPS-2: the legacy ground collapse is reported (and is a rail join) only when it joins nets", () => {
  const oneGroundName = (name: string): SchematicState => ({
    components: [resistor("R1", 100, 100), resistor("R2", 300, 100)],
    wires: [wire("w1", { x: 130, y: 100 }, { x: 270, y: 100 })],
    netLabels: [label("g1", name, { x: 70, y: 100 }, { kind: "ground" }), label("g2", name, { x: 330, y: 100 }, { kind: "ground" })],
  });

  it.each(["AGND", "VSS"])("a design whose only ground name is %s: nothing is joined, so no collapse - a rename finding, no rail join", (name) => {
    const conn = resolveProjectConnectivity(oneGroundName(name));
    expect(conn.ok).toBe(true);
    expect(conn.diagnostics.map((item) => item.code)).not.toContain("LEGACY_GROUND_NAME_COLLAPSE");
    const renamed = conn.diagnostics.find((item) => item.code === "LEGACY_GROUND_RENAMED");
    expect(renamed?.severity).toBe("warning");
    expect(renamed?.message).toContain(name);
    expect(renamed?.message).not.toContain("joined");
    expect(renamed?.refs).toEqual([name]);
    expect(conn.railJoins).toEqual([]);
    expect(conn.netOfPin(key("R1", "1"))!.name).toBe("GND");
  });

  it("the theory fixture's AGND, DGND and ground symbol on three nets ARE joined: the collapse is reported and is a rail-join key", () => {
    const conn = resolveProjectConnectivity(theoryLegacyFixture());
    expect(conn.diagnostics.find((item) => item.code === "LEGACY_GROUND_NAME_COLLAPSE")?.message).toContain("GND, AGND, DGND are joined");
    expect(conn.diagnostics.map((item) => item.code)).not.toContain("LEGACY_GROUND_RENAMED");
    expect(conn.railJoins).toEqual(["AGND|DGND|GND"]);
  });

  it("AGND and DGND wired together on one net: the existing join is the isolation finding, the collapse joins nothing more", () => {
    const state: SchematicState = { components: [], wires: [wire("w", { x: 0, y: 0 }, { x: 50, y: 0 })], netLabels: [label("a", "AGND", { x: 0, y: 0 }, { kind: "ground" }), label("d", "DGND", { x: 50, y: 0 }, { kind: "ground" })] };
    const conn = resolveProjectConnectivity(state);
    expect(conn.railJoins).toEqual(["AGND|DGND"]);
    expect(conn.diagnostics.map((item) => item.code)).not.toContain("LEGACY_GROUND_NAME_COLLAPSE");
  });
});

describe("[PR-J1 integration, 2026-10-22] PC-5: one name is never a rail join", () => {
  it("a ground symbol and a power-kind GND label on one pin: no isolation-domain finding and no rail-join key, with or without sheets", () => {
    const single: SchematicState = { components: [{ id: "G1", type: "ground", x: 100, y: 120, rotation: 0, value: "" }, resistor("R1", 130, 100)], wires: [], netLabels: [label("p", "GND", { x: 100, y: 100 }, { kind: "power" })] };
    for (const state of [single, { ...single, sheets: tree(sheet("s1", "Spare", ROOT_SHEET_ID)) }]) {
      const conn = resolveProjectConnectivity(state);
      expect(conn.railJoins).toEqual([]);
      expect(conn.diagnostics.map((item) => item.code)).not.toContain("ISOLATION_DOMAIN_JOIN");
    }
  });
});

describe("[PR-J1 integration, 2026-10-22] PC-6: a local label with a port anchor's name on the same sheet is always flagged", () => {
  const shadowed = (bound: boolean): SchematicState => ({
    components: [resistor("R1", 100, 100), resistor("R3", 100, 100, "pa"), resistor("R5", 100, 300, "pa")],
    wires: [wire("w1", { x: 130, y: 100 }, { x: 300, y: 100 })],
    netLabels: [
      ...(bound ? [label("pin-a", "SIG", { x: 300, y: 100 }, { scope: "sheet-pin", portId: "pa-sig", childSheetId: "pa" })] : []),
      label("h-a", "SIG", { x: 130, y: 100 }, { sheetId: "pa", scope: "hierarchical", portId: "pa-sig" }),
      label("loc", "SIG", { x: 130, y: 300 }, { sheetId: "pa" }),
    ],
    sheets: tree(sheet("pa", "Power", ROOT_SHEET_ID, { ports: [{ id: "pa-sig", name: "SIG", direction: "input" }] })),
  });

  it("bound or not, the pair is the named finding SHEET_LOCAL_SHADOWS_PORT (two nets, never joined by name)", () => {
    for (const bound of [true, false]) {
      const conn = resolveProjectConnectivity(shadowed(bound));
      const shadow = conn.diagnostics.find((item) => item.code === "SHEET_LOCAL_SHADOWS_PORT");
      expect(shadow, `bound=${bound}`).toMatchObject({ severity: "warning", refs: ["h-a", "loc"] });
      expect(shadow!.message).toContain("SIG");
    }
    const bound = resolveProjectConnectivity(shadowed(true));
    expect(bound.ok).toBe(true);
    expect(bound.netOfPin(key("R5", "2"))!.id).not.toBe(bound.netOfPin(key("R3", "2"))!.id);
  });
});

describe("[PR-J1 integration, 2026-10-22] PC-7: a bus name never joins sheets, whatever the label kind", () => {
  it.each([["power", "DATA[0..7]"], ["ground", "{SDA SCL}"]] as const)("a %s label named %s in a document with sheets is refused (SHEET_BUNDLE_UNSUPPORTED); without sheets it is not", (kind, name) => {
    const sheeted: SchematicState = {
      components: [resistor("R1", 100, 100), resistor("R2", 100, 100, "sa")], wires: [],
      netLabels: [label("p0", name, { x: 70, y: 100 }, { kind }), label("p1", name, { x: 70, y: 100 }, { kind, sheetId: "sa" })],
      sheets: tree(sheet("sa", "A", ROOT_SHEET_ID)),
    };
    const bundle = validateSheetHierarchy(sheeted).filter((item) => item.code === "SHEET_BUNDLE_UNSUPPORTED");
    expect(bundle.map((item) => item.severity)).toEqual(["error", "error"]);
    expect(bundle[0]!.message).toContain(kind);
    expect(resolveProjectConnectivity(sheeted).ok).toBe(false);
    expect(validateSheetHierarchy({ components: [resistor("R1", 100, 100)], wires: [], netLabels: [label("p0", name, { x: 70, y: 100 }, { kind })] })).toEqual([]);
  });
});

// ── R2-2: collision diagnostics are canonical ───────────────────────────────────────────────────────────────────────────────

describe("[PR-J1 review, 2026-10-22] R2-2: SHEET_NET_NAME_COLLISION diagnostics follow (name, id) order, never entity order", () => {
  /** Two global / local pairs (X and Y) on the overview of a two-sheet document: two collisions. `reverse` lists every array backwards. */
  const pairs = (reverse: boolean): SchematicState => {
    const r1 = resistor("R1", 100, 100), r2 = resistor("R2", 300, 100), r3 = resistor("R3", 100, 300), r4 = resistor("R4", 300, 300);
    const components = [r1, r2, r3, r4];
    const labels = [
      label("gx", "X", pinWorldPos(r1, "left"), { scope: "global" }), label("lx", "X", pinWorldPos(r2, "left")),
      label("gy", "Y", pinWorldPos(r3, "left"), { scope: "global" }), label("ly", "Y", pinWorldPos(r4, "left")),
    ];
    return { components: reverse ? [...components].reverse() : components, wires: [], netLabels: reverse ? [...labels].reverse() : labels, sheets: tree(sheet("aux", "Aux", ROOT_SHEET_ID)) };
  };
  const collisions = (conn: ProjectConnectivity) => conn.diagnostics.filter((item) => item.code === "SHEET_NET_NAME_COLLISION").map((item) => ({ code: item.code, severity: item.severity, message: item.message, refs: item.refs }));

  it("the same document with every array reversed gives identical diagnostics (position, message order, refs)", () => {
    const forward = resolveProjectConnectivity(pairs(false));
    const reversed = resolveProjectConnectivity(pairs(true));
    expect(forward.ok).toBe(false);
    const found = collisions(forward);
    expect(found).toHaveLength(2);
    expect(found.map((item) => /are all named (\S+) /.exec(item.message)?.[1])).toEqual(["X", "Y"]);
    for (const item of found) expect(item.refs).toEqual([...item.refs].sort(compareCodePoints));
    expect(collisions(reversed)).toEqual(found);
    expect(reversed.diagnostics).toEqual(forward.diagnostics);
    expect(reversed.nets.map((net) => [net.name, net.id])).toEqual(forward.nets.map((net) => [net.name, net.id]));
  });

  it("PC-1's user-written OUT beside the two port nets: the three refs are the colliding net ids in id order", () => {
    const state = siblingOuts();
    state.components.push(resistor("R5", 100, 500));
    state.netLabels!.push(label("l-out", "OUT", { x: 130, y: 500 }));
    const found = collisions(resolveProjectConnectivity(state));
    expect(found).toHaveLength(1);
    expect(found[0]!.refs).toHaveLength(3);
    expect(found[0]!.refs).toEqual([...found[0]!.refs].sort(compareCodePoints));
    expect(collisions(resolveProjectConnectivity({ ...state, components: [...state.components].reverse(), netLabels: [...state.netLabels!].reverse() }))).toEqual(found);
  });
});
