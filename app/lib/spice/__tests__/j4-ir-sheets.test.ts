/**
 * [PR-J4, 2026-10-23] Runbook section J increment 4 (J.4, J.5; OD-258 item 1): the Studio's canonical IR (app/lib/spice/ir.ts
 * compileCanonicalIr, behind POST /api/spice/compile and the Studio worker) of a project organised into sheets is built on THE project
 * connectivity (app/lib/spice/project-nodes.ts), with the same node names and probe-key shape as the Theory deck.
 *
 *  1. GOLDEN: the single-sheet IR projection (nodes, devices, warnings, componentPinNodes, pointNodes) of six fixtures is byte-identical
 *     to before this increment (digests computed at 290e9e5a, before the connectivity stage was split off; the legacy stage is verbatim).
 *  2. Isomorphism ("simulates identically"): the frozen j3 drone (4 sheets, 7 ports) against the flat j1 drone, and the fixture dimmer
 *     with U1 moved onto a Timer sheet against the flat dimmer, through compileCanonicalIr with the fixture parts: devices equal (ids,
 *     names, types, values; every pin's node under the pin-derived bijection), node count equal, ground pins equal, 0 fixed.
 *  3. Parity with the Theory deck: every `pinNodes` key of schematicToSpice appears in `pointNodes` with the same node name, for the
 *     default and for a named probe sheet; the devices' pin nodes agree with the deck's.
 *  4. Scoped nodes and aliases: two sheets' local OUT labels are A_OUT / B_OUT with the project names "A/OUT" / "B/OUT" as aliases, so an
 *     overlay probe on net "A/OUT" resolves to v(A_OUT); node 0 carries the alias GND; AGND / DGND are non-ground nodes with the warnings.
 *  5. Refusals: KiCad parts whose pins are unknown refuse SIM_SHEET_HIERARCHY_INVALID naming them (the flat path keeps its per-part
 *     warning); a structural error refuses; several ground rails with none named GND refuse SIM_GROUND_AMBIGUOUS; POST /api/spice/compile
 *     surfaces the structured message (422) and compiles a valid sheeted project (200, scoped probe keys).
 *  6. Probe keys: the j3 drone's IMU points are keyed "sheet-imu|x,y" and the overview's bare; `probeSheetId` swaps them.
 * Pure / in-memory: no network, no process, no randomness beyond the project's own entity ids (never part of a projection).
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { POST as compilePost } from "@/app/api/spice/compile/route";
import { pinWorldPos } from "@/app/lib/geometry";
import { schematicToSpice } from "@/app/lib/netlist";
import { blinkerFixtureState, droneFixtureState, fixtureParts, theoryLegacyFixture } from "@/app/lib/schematic/__tests__/_j1-fixtures";
import { dimmerFixtureState, groundKindDimmerState } from "@/app/lib/schematic/__tests__/_j2-fixtures";
import { multiSheetDroneFixtureState } from "@/app/lib/schematic/__tests__/_j3-fixtures";
import { sheetOf } from "@/app/lib/schematic/sheets";
import { PIN_NAMES, ROOT_SHEET_ID, type SchematicState } from "@/lib/schematic-types";
import { compileCanonicalIr, type CompileIrResult } from "../ir";
import { SIM_GROUND_AMBIGUOUS, SIM_SHEET_HIERARCHY_INVALID, spiceProbeKey } from "../project-nodes";
import { createSimulationProject, updateTest } from "../project";
import type { SimulationPartSnapshot, SimulationProject } from "../types";
import { dividerSchematic } from "./fixtures";
import { multiSheetDimmer, railsAndReturnsTheory, splitTwoSubsystemTheory, TIMER_SHEET_ID } from "./_j4-fixtures";

const sha = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const NOW = "2026-10-23T00:00:00.000Z";
/** The committed fixture catalog as the Studio's part snapshots. */
const snapshots = (): SimulationPartSnapshot[] => [...fixtureParts().values()].map((part) => ({ id: part.id, name: part.name, mpn: part.mpn, manufacturer: part.manufacturer, pins: part.pins }));
const projectOf = (state: SchematicState): SimulationProject => createSimulationProject(state, { now: NOW });
const compile = (state: SchematicState, parts: SimulationPartSnapshot[] = [], probeSheetId?: string): CompileIrResult => {
  const project = projectOf(state);
  return compileCanonicalIr({ project, testId: project.tests[0]!.id, parts, ...(probeSheetId !== undefined ? { probeSheetId } : {}) });
};
/** The deterministic part of a compile (entity ids and timestamps of the project are random by construction and left out). */
const projection = (compiled: CompileIrResult) => ({
  nodes: compiled.ir.nodes.map((node) => [node.name, node.aliases, node.ground, node.sourceRefs]),
  devices: compiled.ir.devices.map((device) => [device.id, device.name, device.deviceType, device.pins, device.value, device.modelId ?? null]),
  warnings: compiled.ir.warnings,
  componentPinNodes: compiled.componentPinNodes,
  pointNodes: compiled.pointNodes,
});
const nodeName = (compiled: CompileIrResult, nodeId: string): string => compiled.ir.nodes.find((node) => node.id === nodeId)!.name;
const groundPins = (compiled: CompileIrResult): string[] => Object.entries(compiled.componentPinNodes).filter(([, id]) => compiled.ir.nodes.find((node) => node.id === id)!.ground).map(([key]) => key).sort();

// ── 1. golden ────────────────────────────────────────────────────────────────────────────────────────────────────────────

const GOLDEN_IR: Record<string, string> = {
  divider: "e0faabc11da479c62eddecd86fe06ba9cc4c7f5315a0f506b2bc2ab6d2331c62",
  theory: "eede0104e9c7ac6e8ab99aca857fd4c578ab3a5496fef4d98ed9a2df19e0de1d",
  blinker: "80f625b27209b3748e409a99cec57c4ebed6c1861a0c297ec561f503d350d5cd",
  drone: "16c56d0a01889b40800104a98c31d893a7a3fa97a576a45d80b6928d878378ad",
  dimmer: "9b0e73170509b03bbfa7d1b67ae2f993a5cc7cb4daaea9b6ec11bf7d6e424122",
  "ground-kind dimmer": "8ac848fbd939fd48361b06fe4b8516c56d6007d68473ccb306fec3d86ebf794f",
};
const FIXTURES: Array<[keyof typeof GOLDEN_IR, () => SchematicState]> = [["divider", dividerSchematic], ["theory", theoryLegacyFixture], ["blinker", blinkerFixtureState], ["drone", droneFixtureState], ["dimmer", dimmerFixtureState], ["ground-kind dimmer", groundKindDimmerState]];

describe("[PR-J4] 1. a single-sheet document's IR projection is byte-identical to before this increment (the legacy stage is verbatim)", () => {
  it.each(FIXTURES)("%s", (name, make) => {
    const compiled = compile(make(), snapshots());
    expect(sha(projection(compiled))).toBe(GOLDEN_IR[name]);
    // a probeSheetId on a single-sheet compile changes nothing (the legacy stage ignores it)
    expect(sha(projection(compile(make(), snapshots(), "anything")))).toBe(GOLDEN_IR[name]);
  });
});

// ── 2. isomorphism ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** Every device equal and every pin on the same node under the bijection the pins define; 0 fixed; same node count; same ground pins. */
function expectIsomorphic(flat: CompileIrResult, split: CompileIrResult): Map<string, string> {
  const forward = new Map<string, string>();
  const backward = new Map<string, string>();
  expect(Object.keys(split.componentPinNodes).sort()).toEqual(Object.keys(flat.componentPinNodes).sort());
  for (const [key, flatId] of Object.entries(flat.componentPinNodes)) {
    const before = nodeName(flat, flatId);
    const after = nodeName(split, split.componentPinNodes[key]!);
    expect(forward.get(before) ?? after, key).toBe(after);
    expect(backward.get(after) ?? before, key).toBe(before);
    forward.set(before, after);
    backward.set(after, before);
  }
  expect(forward.get("0")).toBe("0");
  const summary = (compiled: CompileIrResult, map?: Map<string, string>) => compiled.ir.devices.map((device) => [device.id, device.name, device.deviceType, device.value, device.modelId ?? null, device.pins.map((pin) => [pin.name, pin.modelPin ?? null, map ? map.get(nodeName(compiled, pin.nodeId)) : nodeName(compiled, pin.nodeId)])]);
  expect(summary(split)).toEqual(summary(flat, forward));
  expect(split.ir.nodes.length).toBe(flat.ir.nodes.length);
  expect(groundPins(split)).toEqual(groundPins(flat));
  expect(split.ir.nodes.filter((node) => node.ground).map((node) => node.name)).toEqual(["0"]);
  return forward;
}

describe("[PR-J4] 2. a design organised into sheets compiles to an IR isomorphic to its flat original", () => {
  it("the frozen j3 drone (4 sheets, 7 ports) against the flat j1 drone: 41 devices equal under the bijection; rails one node each; ports by name", () => {
    const flat = compile(droneFixtureState(), snapshots());
    const split = compile(multiSheetDroneFixtureState(), snapshots());
    expect(split.ir.warnings).toEqual([]);
    const forward = expectIsomorphic(flat, split);
    expect(split.ir.devices).toHaveLength(41);
    const names = split.ir.nodes.map((node) => node.name);
    expect(names).toEqual(expect.arrayContaining(["0", "+3V3", "VBAT", "PWM1", "PWM2", "PWM3", "PWM4", "I2C_SCL", "I2C_SDA", "IMU_INT1", "Motor_drivers_M1_GATE", "Motor_drivers_M1_DRAIN"]));
    expect(names.filter((name) => /^GND/i.test(name))).toEqual([]);
    expect(names.filter((name) => /^N\d{3}$/.test(name)).length).toBeGreaterThan(0);
    expect([...forward.values()].filter((name) => name === "0")).toEqual(["0"]);
    // the ground node carries the rail name as its alias; a sheet-local node its project name
    expect(split.ir.nodes.find((node) => node.name === "0")).toMatchObject({ ground: true, aliases: ["GND"] });
    expect(split.ir.nodes.find((node) => node.name === "Motor_drivers_M1_GATE")).toMatchObject({ ground: false, aliases: ["Motor drivers/M1_GATE"] });
  });

  it("the fixture dimmer with U1 moved onto a Timer sheet against the flat dimmer: equal under the bijection, the locals crossing through ports", () => {
    const { flat, split, portNames } = multiSheetDimmer();
    expect(split.sheets!.sheets.map((item) => item.id)).toEqual([ROOT_SHEET_ID, TIMER_SHEET_ID]);
    expect(portNames.length).toBeGreaterThan(0);
    const compiledFlat = compile(flat, snapshots());
    const compiledSplit = compile(split, snapshots());
    expect(compiledSplit.ir.warnings).toEqual([]);
    expectIsomorphic(compiledFlat, compiledSplit);
    const names = compiledSplit.ir.nodes.map((node) => node.name);
    for (const port of portNames) expect(names).toContain(port);
    expect(names).toEqual(expect.arrayContaining(["0", "VCC"]));
  });

  it("the same document compiles to the same projection twice (no randomness in the stage)", () => {
    const state = multiSheetDroneFixtureState();
    expect(sha(projection(compile(state, snapshots())))).toBe(sha(projection(compile(state, snapshots()))));
  });
});

// ── 3. parity with the Theory deck ───────────────────────────────────────────────────────────────────────────────────────

describe("[PR-J4] 3. the Studio IR and the Theory deck agree on every probe key and node name (the same key shape on both ends)", () => {
  it.each([["the rails-and-returns circuit", () => railsAndReturnsTheory("strict")], ["the split two-subsystem circuit", () => splitTwoSubsystemTheory().split]] as const)("%s, by default and with probe sheet sa / sheet-load", (_name, make) => {
    const state = make();
    for (const probeSheetId of [undefined, "sa", "sheet-load"]) {
      const deck = schematicToSpice(state, probeSheetId === undefined ? undefined : { probeSheetId });
      const compiled = compile(state, [], probeSheetId);
      for (const [key, name] of Object.entries(deck.pinNodes)) expect(compiled.pointNodes[key], `${key} (probe ${probeSheetId})`).toBe(name);
      // a probe sheet the document lacks falls back to the root (both ends warn and key the overview bare)
      const effective = probeSheetId !== undefined && state.sheets!.sheets.some((item) => item.id === probeSheetId) ? probeSheetId : ROOT_SHEET_ID;
      for (const component of state.components) {
        for (const pin of PIN_NAMES[component.type] ?? []) {
          if (component.type === "ground") continue;
          const key = spiceProbeKey(sheetOf(component), pinWorldPos(component, pin), effective);
          expect(nodeName(compiled, compiled.componentPinNodes[`${component.id}.${pin}`]!), `${component.id}.${pin}`).toBe(deck.pinNodes[key]);
        }
      }
      expect(compiled.ir.warnings).toEqual(deck.warnings);
    }
  });
});

// ── 4. scoped nodes and aliases ──────────────────────────────────────────────────────────────────────────────────────────

describe("[PR-J4] 4. scoped node names, project names as aliases, the strict ground rule in the IR", () => {
  it("two sheets' OUT locals are A_OUT / B_OUT (aliases A/OUT, B/OUT); an overlay probe on net \"A/OUT\" is v(A_OUT); node 0 has the alias GND; AGND / DGND are warned non-ground nodes", () => {
    const state = railsAndReturnsTheory("strict");
    const project = projectOf(state);
    const testId = project.tests[0]!.id;
    const probed = updateTest(project, testId, (test) => {
      test.overlay.elements.push({ id: "probe-a-out", kind: "probe", name: "P_A", target: { kind: "net", net: "A/OUT" }, quantity: "voltage", enabled: true });
      test.overlay.elements.push({ id: "probe-gnd", kind: "probe", name: "P_G", target: { kind: "net", net: "GND" }, quantity: "voltage", enabled: true });
    });
    const compiled = compileCanonicalIr({ project: probed, testId });
    expect(compiled.ir.nodes.find((node) => node.name === "A_OUT")).toMatchObject({ aliases: ["A/OUT"], ground: false });
    expect(compiled.ir.nodes.find((node) => node.name === "B_OUT")).toMatchObject({ aliases: ["B/OUT"], ground: false });
    expect(compiled.ir.nodes.find((node) => node.name === "0")).toMatchObject({ aliases: ["GND"], ground: true });
    expect(compiled.ir.nodes.find((node) => node.name === "AGND")).toMatchObject({ aliases: ["AGND"], ground: false });
    expect(compiled.ir.nodes.find((node) => node.name === "DGND")).toMatchObject({ aliases: ["DGND"], ground: false });
    expect(compiled.ir.nodes.find((node) => node.name === "+3V3")).toMatchObject({ aliases: ["+3V3"], ground: false });
    expect(compiled.ir.outputs.filter((output) => output.id.startsWith("probe-")).map((output) => output.expression)).toEqual(["v(A_OUT)", "v(0)"]);
    expect(compiled.ir.warnings).toEqual([
      "The ground rail AGND is a separate return and not node 0 (node AGND); tie it to the GND rail explicitly if the two returns are one.",
      "The ground rail DGND is a separate return and not node 0 (node DGND); tie it to the GND rail explicitly if the two returns are one.",
    ]);
    // a sheet-local node's source refs are its own labels
    expect(compiled.ir.nodes.find((node) => node.name === "A_OUT")!.sourceRefs).toEqual([{ kind: "schematic-net", id: "l-out-a", label: "OUT" }]);
  });
});

// ── 5. refusals ──────────────────────────────────────────────────────────────────────────────────────────────────────────

describe("[PR-J4] 5. refusals: unresolved parts, structural errors and an ambiguous ground; the compile route surfaces them", () => {
  it("KiCad parts whose pins are unknown refuse SIM_SHEET_HIERARCHY_INVALID naming them; the flat path keeps its per-part warning", () => {
    expect(() => compile(multiSheetDroneFixtureState(), [])).toThrow(new RegExp(`^${SIM_SHEET_HIERARCHY_INVALID}: the catalog pins of \\d+ part\\(s\\) are unknown \\([^)]*\\): a project organised into sheets is compiled only from resolved parts, so their pins are never placed by guess; nothing was compiled$`));
    const all = snapshots();
    const partial = all.filter((part) => !/mic5504/i.test(`${part.id} ${part.name} ${part.mpn ?? ""}`));
    expect(partial.length).toBeLessThan(all.length);
    let message = "";
    try { compile(multiSheetDroneFixtureState(), partial); } catch (error) { message = (error as Error).message; }
    const missing = all.filter((part) => !partial.includes(part)).map((part) => part.id);
    expect(missing.length).toBeGreaterThan(0);
    for (const id of missing) expect(message).toContain(id);
    expect(message).toMatch(new RegExp(`^${SIM_SHEET_HIERARCHY_INVALID}: the catalog pins of ${missing.length} part\\(s\\) are unknown`));
    const flat = compile(droneFixtureState(), []);
    expect(flat.ir.warnings).toHaveLength(41);
    expect(flat.ir.warnings[0]).toMatch(/catalog pin metadata is unavailable/);
  });

  it("a structural error (a hierarchical label whose port is gone) refuses SIM_SHEET_HIERARCHY_INVALID before any device", () => {
    const broken = multiSheetDroneFixtureState();
    broken.netLabels!.find((item) => item.scope === "hierarchical")!.portId = "no-such-port";
    expect(() => compile(broken, snapshots())).toThrow(new RegExp(`^${SIM_SHEET_HIERARCHY_INVALID}: the sheet structure of this project has \\d+ error\\(s\\): `));
  });

  it("several ground rails with none named GND refuse SIM_GROUND_AMBIGUOUS naming them", () => {
    expect(() => compile(railsAndReturnsTheory("ambiguous"))).toThrow(new RegExp(`^${SIM_GROUND_AMBIGUOUS}: 2 ground rails and none is named GND \\(AGND on the overview; DGND on sheet "A"\\)`));
  });

  it("POST /api/spice/compile: 422 with the structured message for an invalid tree; 200 with scoped probe keys for a valid sheeted project", async () => {
    const request = (body: unknown): Request => new Request("http://localhost/api/spice/compile", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost" }, body: JSON.stringify(body) });
    const broken = multiSheetDroneFixtureState();
    broken.kicadComponents![0]!.sheetId = "ghost";
    const brokenProject = projectOf(broken);
    const refused = await compilePost(request({ project: brokenProject, testId: brokenProject.tests[0]!.id, parts: snapshots() }));
    expect(refused.status).toBe(422);
    expect(await refused.json()).toEqual({ ok: false, error: expect.stringMatching(new RegExp(`^${SIM_SHEET_HIERARCHY_INVALID}: .*ghost`)) });
    // the drone's KiCad parts carry no model bindings, so the deck compiler refuses it flat or sheeted alike ("XC1 is missing a subcircuit
    // model name", pre-existing): the success case is the Theory two-subsystem circuit organised into sheets
    const { split, portName } = splitTwoSubsystemTheory();
    const project = projectOf(split);
    const ok = await compilePost(request({ project, testId: project.tests[0]!.id, parts: [] }));
    expect(ok.status).toBe(200);
    const body = await ok.json() as { ok: boolean; netlist: { pinNodes: Record<string, string>; executed: string }; irSummary: { nodes: number; devices: number; warnings: string[] } };
    expect(body.ok).toBe(true);
    expect(body.irSummary.devices).toBe(5);
    expect(body.irSummary.warnings).toEqual([]);
    expect(Object.keys(body.netlist.pinNodes).some((key) => key.startsWith("sheet-load|"))).toBe(true);
    expect(Object.keys(body.netlist.pinNodes).some((key) => key.startsWith("root|"))).toBe(false);
    expect(body.netlist.executed).toMatch(new RegExp(`^R3 ${portName} N\\d{3} 470$`, "m"));
  });
});

// ── 6. probe keys ────────────────────────────────────────────────────────────────────────────────────────────────────────

describe("[PR-J4] 6. probe keys per sheet", () => {
  it("the j3 drone: IMU points are \"sheet-imu|x,y\", the overview's bare; probeSheetId sheet-imu makes the IMU bare and the overview \"root|x,y\"", () => {
    const state = multiSheetDroneFixtureState();
    const byDefault = compile(state, snapshots());
    const keys = Object.keys(byDefault.pointNodes);
    expect(keys.some((key) => key.startsWith("sheet-imu|"))).toBe(true);
    expect(keys.some((key) => key.startsWith("sheet-motors|"))).toBe(true);
    expect(keys.some((key) => key.startsWith("root|"))).toBe(false);
    expect(keys.some((key) => /^\d+,\d+$/.test(key))).toBe(true);
    const onImu = compile(state, snapshots(), "sheet-imu");
    const imuKeys = Object.keys(onImu.pointNodes);
    expect(imuKeys.some((key) => key.startsWith("sheet-imu|"))).toBe(false);
    expect(imuKeys.some((key) => key.startsWith("root|"))).toBe(true);
    expect(imuKeys.some((key) => key.startsWith("sheet-motors|"))).toBe(true);
    // the same points, the same nodes: only the key prefix moves
    const strip = (entries: Record<string, string>) => Object.fromEntries(Object.entries(entries).map(([key, name]) => [key.replace(/^[^|]*\|/, ""), name]));
    const sameSheet = (entries: Record<string, string>, sheet: string) => Object.fromEntries(Object.entries(entries).filter(([key]) => key.startsWith(`${sheet}|`)));
    expect(strip(sameSheet(byDefault.pointNodes, "sheet-imu"))).toEqual(Object.fromEntries(Object.entries(onImu.pointNodes).filter(([key]) => /^\d+,\d+$/.test(key))));
    expect(strip(sameSheet(onImu.pointNodes, "root"))).toEqual(Object.fromEntries(Object.entries(byDefault.pointNodes).filter(([key]) => /^\d+,\d+$/.test(key))));
    expect(onImu.ir.warnings).toEqual([]);
    const unknown = compile(state, snapshots(), "zzz");
    expect(unknown.pointNodes).toEqual(byDefault.pointNodes);
    expect(unknown.ir.warnings).toEqual(["The probe sheet zzz is not a sheet of this project: the overview's points are keyed bare."]);
  });
});
