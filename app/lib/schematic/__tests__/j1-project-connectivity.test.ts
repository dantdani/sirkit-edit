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
import { resolveProjectConnectivity, type PartPinsLookup } from "../project-connectivity";
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
