// @vitest-environment jsdom
/**
 * [PR-J3, 2026-10-22] Runbook section J increment 3 (J.9 "a root overview plus at least three real subsystem sheets ...; a denser
 * multi-sheet fixture remains readable without giant off-page wire runs or overlapping critical controls"; J.8.1-J.8.2; OD-257 item 9):
 * the committed multi-sheet drone fixture (app/lib/schematic/__tests__/_j3-fixtures.ts, fixtures/j3-drone-sheets-*.json). What it proves:
 *
 *  1. the frozen state is exactly what the builder produces from the flat drone (three planner moves; deterministic ids, no random
 *     draw); the planner's previews name the crossings (PWM1-4; I2C_SCL, I2C_SDA, IMU_INT1; none for Power);
 *  2. the structure: a root "Overview" first, then Power / Motor drivers / IMU; every one of the 41 instances on exactly one sheet, by
 *     the planner's own function blocks; the three sheets hold real circuitry; validateSheetHierarchy reports nothing (no error, no
 *     warning: every port bound and anchored);
 *  3. connectivity: resolveProjectConnectivity is ok, multi-sheet, and its pin-to-net partition digest equals the flat drone's; the
 *     7 interface nets are hierarchical and keep their names; the rails stay global; the whole-project consumers publish the same 41
 *     components and the same netlist partition (the j2 proof, reused on this fixture);
 *  4. readability: every sheet's content fits the A3 page; no wire is longer than a quarter of the page; the overview blocks do not
 *     overlap each other, the page edge, or any entity that stays on the overview; blocks and entities sit on the 10 px grid;
 *  5. the project file: formatVersion 2, integrity verified, byte-stable (the canonical payload), and it imports and re-exports byte
 *     for byte through the real importer and exporter (jsdom localStorage, a stubbed parts route). MULTI_SHEET_EDITOR_AVAILABLE gates
 *     the import: while it is false the import is the recoverable SHEETS_EDITOR_PENDING refusal and nothing is written;
 *  6. the single-sheet goldens are untouched by the fixture's existence (the flat drone's digest).
 * No network, no database; the BOM's catalog reads see an empty mocked database.
 */
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/db/client", () => {
  const chain: unknown = new Proxy(function query() {}, { get: (_target, key) => (key === "then" ? (resolve: (rows: unknown[]) => void) => resolve([]) : chain), apply: () => chain });
  return { getDb: () => chain };
});

import { buildBom } from "@/app/lib/bom/build";
import { schematicStateDigest } from "@/app/lib/engineering/schematic-model";
import { kicadPinWorldPos } from "@/app/lib/geometry";
import { buildNetlist, buildPcbSyncPublicationGraph, type PcbNetlist } from "@/app/lib/pcb/netlist-bridge";
import { canonicalJson } from "@/app/lib/pcb/revision";
import { listUnresolvedInstances } from "@/app/lib/pcb-sync/unresolved-instances";
import { computeDesignChecks } from "@/app/lib/schematic/design-checks";
import { resolveProjectConnectivity } from "@/app/lib/schematic/project-connectivity";
import { sheetOf, validateSheetHierarchy } from "@/app/lib/schematic/sheets";
import { pageSizePx } from "@/lib/page-sizes";
import { ROOT_SHEET_ID, type SchematicState } from "@/lib/schematic-types";
import { MULTI_SHEET_EDITOR_AVAILABLE, PROJECT_FILE_VERSION_SHEETS, SHEETS_EDITOR_PENDING, exportProjectFile, importProjectFile } from "@/app/lib/project/file";
import { droneFixtureState, fixturePartLookup, fixtureParts } from "./_j1-fixtures";
import { J3_FIXTURE_EXPORTED_AT, J3_FIXTURE_PROJECT_ID, J3_FIXTURE_PROJECT_NAME, J3_ROOT_NAME, J3_ROOT_REFS, J3_SHEETS, buildMultiSheetDrone, multiSheetDroneFixtureState, multiSheetDroneProjectFile } from "./_j3-fixtures";

const sha = (text: string): string => createHash("sha256").update(text).digest("hex");
const lookup = fixturePartLookup();
const parts = fixtureParts();
const GRID = 10;
const PAGE = pageSizePx("A3"); // the drone's page

/** The frozen fixture, read once per file (nothing below changes it). */
const fixture = multiSheetDroneFixtureState();
const flat = droneFixtureState();

type Box = { minX: number; minY: number; maxX: number; maxY: number };
const overlaps = (a: Box, b: Box): boolean => a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
const blockBox = (block: { x: number; y: number; width: number; height: number }): Box => ({ minX: block.x, minY: block.y, maxX: block.x + block.width, maxY: block.y + block.height });

/** Every drawn point of one sheet: part anchors and KiCad pins (from the fixture catalog), wire vertices, label anchors. */
function sheetPoints(state: SchematicState, sheetId: string): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [];
  for (const instance of state.kicadComponents ?? []) {
    if (sheetOf(instance) !== sheetId) continue;
    points.push({ x: instance.x, y: instance.y });
    for (const pin of lookup(instance.partId)?.pins ?? []) points.push(kicadPinWorldPos(instance, pin));
  }
  for (const component of state.components) if (sheetOf(component) === sheetId) points.push({ x: component.x, y: component.y });
  for (const wire of state.wires) if (sheetOf(wire) === sheetId) points.push(...wire.vertices);
  for (const label of state.netLabels ?? []) if (sheetOf(label) === sheetId) points.push(label.position);
  return points;
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(J3_FIXTURE_EXPORTED_AT));
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify({ ok: true, part: { id: decodeURIComponent(String(input).split("/").pop() ?? "") } }), { status: 200, headers: { "content-type": "application/json" } })));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("[PR-J3] 1. the frozen fixture is the builder's output: three planner moves with deterministic ids", () => {
  it("rebuilding the organised drone from the flat drone reproduces the frozen state exactly; the previews name the crossings", () => {
    const built = buildMultiSheetDrone();
    expect(built.state).toEqual(fixture);
    expect(schematicStateDigest(built.state)).toBe(schematicStateDigest(fixture));
    expect(built.previews.map((preview) => [preview.sheetId, preview.crossings.map((crossing) => crossing.portName)])).toEqual([
      ["sheet-power", []],
      ["sheet-motors", ["PWM1", "PWM2", "PWM3", "PWM4"]],
      ["sheet-imu", ["I2C_SCL", "I2C_SDA", "IMU_INT1"]],
    ]);
    // every crossing's port carries the net's own name (no SIG<n>: every cut net was named on the page)
    expect(built.previews.flatMap((preview) => preview.crossings).every((crossing) => crossing.netName === crossing.portName)).toBe(true);
    // the motor stage's local nets are displayed by sheet path afterwards (a rename of the same net; j2 proves the identity)
    expect(built.previews[1]!.renamedNets.map((item) => item.to)).toEqual([1, 2, 3, 4].flatMap((n) => [`Motor drivers/M${n}_DRAIN`, `Motor drivers/M${n}_GATE`]));
    expect(built.previews[0]!.renamedNets).toEqual([]);
    expect(built.previews[2]!.renamedNets).toEqual([]);
  });

  it("no id is a random draw: sheet ids are the fixed names, port and anchor ids derive from the port, two builds are byte-identical", () => {
    expect(JSON.stringify(buildMultiSheetDrone().state)).toBe(JSON.stringify(buildMultiSheetDrone().state));
    expect(fixture.sheets!.sheets.map((sheet) => sheet.id)).toEqual([ROOT_SHEET_ID, ...J3_SHEETS.map((sheet) => sheet.id)]);
    const ports = fixture.sheets!.sheets.flatMap((sheet) => sheet.ports ?? []);
    expect(ports.map((port) => port.name)).toEqual(J3_SHEETS.flatMap((sheet) => [...sheet.ports]));
    for (const port of ports) expect(port.id).toMatch(/^port:sheet-(motors|imu):[0-9a-f]{12}$/);
    const anchors = fixture.netLabels!.filter((label) => label.scope === "hierarchical" || label.scope === "sheet-pin");
    expect(anchors).toHaveLength(ports.length * 2);
    for (const anchor of anchors) expect(anchor.id).toBe(`${anchor.portId}:${anchor.scope === "sheet-pin" ? "pin" : "label"}`);
    // the drone's own entity ids (the fixture browser's counter uuids) are untouched
    expect(fixture.kicadComponents!.map((item) => item.id).sort()).toEqual(flat.kicadComponents!.map((item) => item.id).sort());
    expect(fixture.wires.map((item) => item.id).sort()).toEqual(flat.wires.map((item) => item.id).sort());
    expect(fixture.netLabels!.filter((label) => label.scope === undefined).map((item) => item.id).sort()).toEqual(flat.netLabels!.map((item) => item.id).sort());
  });
});

describe("[PR-J3] 2. the structure: an overview and three real subsystem sheets, every instance on exactly one sheet", () => {
  it("root first, then Power / Motor drivers / IMU with their blocks; the planner's function blocks; nothing flagged by the sheet contract", () => {
    expect(fixture.sheets).toMatchObject({ version: 1 });
    expect(fixture.sheets!.sheets.map((sheet) => [sheet.id, sheet.name, sheet.parentId])).toEqual([
      [ROOT_SHEET_ID, J3_ROOT_NAME, null],
      ...J3_SHEETS.map((sheet) => [sheet.id, sheet.name, ROOT_SHEET_ID]),
    ]);
    for (const sheet of J3_SHEETS) expect(fixture.sheets!.sheets.find((item) => item.id === sheet.id)!.block).toEqual(sheet.block);
    const onSheet = (sheetId: string): string[] => fixture.kicadComponents!.filter((item) => sheetOf(item) === sheetId).map((item) => item.refDes).sort();
    expect(onSheet(ROOT_SHEET_ID)).toEqual([...J3_ROOT_REFS].sort());
    for (const sheet of J3_SHEETS) expect(onSheet(sheet.id)).toEqual([...sheet.refs].sort());
    expect(fixture.kicadComponents).toHaveLength(41);
    expect(new Set(fixture.kicadComponents!.map((item) => item.refDes)).size).toBe(41);
    // three REAL subsystem sheets: each holds parts and local labels of the circuit (not an empty tab)
    for (const sheet of J3_SHEETS) {
      expect(onSheet(sheet.id).length).toBeGreaterThanOrEqual(5);
      expect(fixture.netLabels!.filter((label) => sheetOf(label) === sheet.id && label.scope === undefined).length).toBeGreaterThan(0);
    }
    expect(validateSheetHierarchy(fixture)).toEqual([]);
  });

  it("the ports: Motor drivers carries PWM1-4, IMU carries I2C_SCL / I2C_SDA / IMU_INT1, Power none (the rails join by name); each port has one sheet pin on the overview and a hierarchical label inside", () => {
    const byId = new Map(fixture.sheets!.sheets.map((sheet) => [sheet.id, sheet]));
    expect(byId.get("sheet-power")!.ports).toBeUndefined();
    expect(byId.get("sheet-motors")!.ports!.map((port) => port.name)).toEqual(["PWM1", "PWM2", "PWM3", "PWM4"]);
    expect(byId.get("sheet-imu")!.ports!.map((port) => port.name)).toEqual(["I2C_SCL", "I2C_SDA", "IMU_INT1"]);
    for (const sheet of fixture.sheets!.sheets) {
      for (const port of sheet.ports ?? []) {
        const pins = fixture.netLabels!.filter((label) => label.scope === "sheet-pin" && label.portId === port.id);
        const anchors = fixture.netLabels!.filter((label) => label.scope === "hierarchical" && label.portId === port.id);
        expect(pins.map((pin) => [sheetOf(pin), pin.childSheetId, pin.name])).toEqual([[ROOT_SHEET_ID, sheet.id, port.name]]);
        expect(anchors.length).toBeGreaterThanOrEqual(1);
        for (const anchor of anchors) expect([sheetOf(anchor), anchor.name]).toEqual([sheet.id, port.name]);
      }
    }
    // the rails are never ports: no port is named like a power or ground label of the design
    const railNames = new Set(fixture.netLabels!.filter((label) => label.kind !== "label").map((label) => label.name));
    expect(railNames).toEqual(new Set(["VBAT", "+3V3", "GND"]));
    for (const sheet of fixture.sheets!.sheets) for (const port of sheet.ports ?? []) expect(railNames.has(port.name)).toBe(false);
  });
});

describe("[PR-J3] 3. connectivity: the same circuit as the flat drone, now explicit across sheets", () => {
  it("ok, multi-sheet, the same pin-to-net partition; the seven interface nets are hierarchical and keep their names; the rails stay global", () => {
    const organised = resolveProjectConnectivity(fixture, lookup);
    const original = resolveProjectConnectivity(flat, lookup);
    expect(organised.ok).toBe(true);
    expect(organised.mode).toBe("multi-sheet");
    expect(organised.diagnostics).toEqual([]);
    expect(organised.kicadPinsResolved).toBe(true);
    expect(organised.unresolvedPartIds).toEqual([]);
    expect(organised.partitionDigest).toBe(original.partitionDigest);
    const interfaces = organised.nets.filter((net) => net.portIds.length > 0);
    expect(interfaces.map((net) => net.name).sort()).toEqual(["I2C_SCL", "I2C_SDA", "IMU_INT1", "PWM1", "PWM2", "PWM3", "PWM4"]);
    for (const net of interfaces) {
      expect(net.scope).toBe("hierarchical");
      expect(net.homeSheetId).toBe(ROOT_SHEET_ID);
      expect(net.sheetIds).toHaveLength(2);
      expect(original.nets.find((candidate) => candidate.name === net.name)!.members).toEqual(net.members); // the same pins as on the flat page
    }
    // the rails join by exact name on every sheet that labels them: GND everywhere, +3V3 on the overview, Power and IMU, VBAT on Power
    // and Motor drivers only (the MCU block draws no VBAT)
    const sheetsLabelling = (name: string): string[] => [...new Set(fixture.netLabels!.filter((label) => label.name === name).map((label) => sheetOf(label)))].sort();
    expect(sheetsLabelling("GND")).toEqual([ROOT_SHEET_ID, "sheet-imu", "sheet-motors", "sheet-power"]);
    expect(sheetsLabelling("+3V3")).toEqual([ROOT_SHEET_ID, "sheet-imu", "sheet-power"]);
    expect(sheetsLabelling("VBAT")).toEqual(["sheet-motors", "sheet-power"]);
    for (const rail of ["VBAT", "+3V3", "GND"]) {
      const net = organised.nets.find((candidate) => candidate.name === rail)!;
      expect(net.scope).toBe("global");
      expect([...net.sheetIds].sort()).toEqual(sheetsLabelling(rail));
      expect(net.members).toEqual(original.nets.find((candidate) => candidate.name === rail)!.members);
    }
    // the motor stage's local nets live on their sheet alone, named by its path
    for (const n of [1, 2, 3, 4]) {
      for (const suffix of ["GATE", "DRAIN"]) {
        const net = organised.nets.find((candidate) => candidate.name === `Motor drivers/M${n}_${suffix}`)!;
        expect(net.scope).toBe("local");
        expect(net.sheetIds).toEqual(["sheet-motors"]);
        expect(net.members).toEqual(original.nets.find((candidate) => candidate.name === `M${n}_${suffix}`)!.members);
      }
    }
  });

  it("the whole-project consumers read the fixture as the complete drone: 41 published components, the flat netlist partition, no missing part, the BOM rows, Sheet connections passing", async () => {
    const netlist = buildNetlist(fixture, lookup);
    const flatNetlist = buildNetlist(flat, lookup);
    expect(netlist.components).toEqual(flatNetlist.components);
    expect(netlist.components).toHaveLength(41);
    const partition = (nets: PcbNetlist["nets"]): string[] => nets.map((net) => net.endpointKeys.join("|")).sort();
    expect(partition(netlist.nets)).toEqual(partition(flatNetlist.nets));
    const graph = buildPcbSyncPublicationGraph(fixture, lookup);
    expect(graph.components).toEqual(buildPcbSyncPublicationGraph(flat, lookup).components);
    expect(listUnresolvedInstances(fixture)).toEqual(listUnresolvedInstances(flat));
    expect(listUnresolvedInstances(fixture)).toEqual([]);
    expect((await buildBom(fixture, "none")).rows).toEqual((await buildBom(flat, "none")).rows);
    const checks = computeDesignChecks(fixture, parts, "j3", "build").checks;
    expect(checks.map((check) => check.id)).toEqual(["floating-nets", "supply-rails", "sheet-interfaces"]);
    expect(checks[2]).toMatchObject({ id: "sheet-interfaces", label: "Sheet connections", state: "pass" });
    expect(checks.slice(0, 2).map((check) => [check.state, check.count])).toEqual(computeDesignChecks(flat, parts, "j3", "build").checks.map((check) => [check.state, check.count]));
  });
});

describe("[PR-J3] 4. readability: everything fits the page, no off-page wire runs, blocks clear of each other and of the overview's circuitry", () => {
  it("every sheet's content lies inside the A3 page with a margin; no wire segment is longer than a quarter of the page", () => {
    expect(fixture.pageSize).toBe("A3");
    expect(PAGE).toEqual({ widthPx: 3307, heightPx: 2339 });
    for (const sheet of fixture.sheets!.sheets) {
      const points = sheetPoints(fixture, sheet.id);
      expect(points.length, sheet.name).toBeGreaterThan(0);
      for (const point of points) {
        expect(point.x, `${sheet.name} x`).toBeGreaterThanOrEqual(40);
        expect(point.x, `${sheet.name} x`).toBeLessThanOrEqual(PAGE.widthPx - 40);
        expect(point.y, `${sheet.name} y`).toBeGreaterThanOrEqual(40);
        expect(point.y, `${sheet.name} y`).toBeLessThanOrEqual(PAGE.heightPx - 40);
      }
    }
    for (const wire of fixture.wires) {
      for (let index = 1; index < wire.vertices.length; index += 1) {
        const a = wire.vertices[index - 1]!;
        const b = wire.vertices[index]!;
        expect(Math.hypot(b.x - a.x, b.y - a.y), wire.id).toBeLessThan(Math.min(PAGE.widthPx, PAGE.heightPx) / 4);
      }
    }
  });

  it("the overview blocks are grid-aligned, inside the page, disjoint from each other and from every entity that stays on the overview", () => {
    const blocks = J3_SHEETS.map((sheet) => ({ name: sheet.name, box: blockBox(fixture.sheets!.sheets.find((item) => item.id === sheet.id)!.block!) }));
    for (const { name, box } of blocks) {
      expect([box.minX, box.minY, box.maxX, box.maxY].every((value) => value % GRID === 0), `${name} on the grid`).toBe(true);
      expect(box.minX, name).toBeGreaterThanOrEqual(40);
      expect(box.minY, name).toBeGreaterThanOrEqual(40);
      expect(box.maxX, name).toBeLessThanOrEqual(PAGE.widthPx - 40);
      expect(box.maxY, name).toBeLessThanOrEqual(PAGE.heightPx - 40);
    }
    for (let a = 0; a < blocks.length; a += 1) for (let b = a + 1; b < blocks.length; b += 1) expect(overlaps(blocks[a]!.box, blocks[b]!.box), `${blocks[a]!.name} vs ${blocks[b]!.name}`).toBe(false);
    const rootPoints = sheetPoints(fixture, ROOT_SHEET_ID);
    expect(rootPoints.length).toBeGreaterThan(0);
    for (const { name, box } of blocks) {
      const inside = rootPoints.filter((point) => point.x > box.minX - 20 && point.x < box.maxX + 20 && point.y > box.minY - 20 && point.y < box.maxY + 20);
      expect(inside, `${name} overlaps overview circuitry at ${JSON.stringify(inside.slice(0, 3))}`).toEqual([]);
    }
    // every part anchor, wire vertex and label sits on the schematic grid (the planner moved nothing off it)
    const onGrid = (value: number): boolean => value % GRID === 0;
    for (const sheetId of [ROOT_SHEET_ID, ...J3_SHEETS.map((sheet) => sheet.id)]) {
      for (const instance of fixture.kicadComponents!.filter((item) => sheetOf(item) === sheetId)) expect([onGrid(instance.x), onGrid(instance.y)], instance.refDes).toEqual([true, true]);
      for (const wire of fixture.wires.filter((item) => sheetOf(item) === sheetId)) for (const vertex of wire.vertices) expect([onGrid(vertex.x), onGrid(vertex.y)], wire.id).toEqual([true, true]);
      for (const label of fixture.netLabels!.filter((item) => sheetOf(item) === sheetId)) expect([onGrid(label.position.x), onGrid(label.position.y)], label.id).toEqual([true, true]);
    }
  });
});

describe("[PR-J3] 5. the project file: formatVersion 2, integrity verified, byte-stable, imports and re-exports byte for byte", () => {
  it("the committed file is the exporter's output for the frozen state (project id, name, record fields, canonical payload, sha256)", () => {
    const content = multiSheetDroneProjectFile();
    const parsed = JSON.parse(content) as { format: string; formatVersion: number; exportedAt: string; integrity: string; payload: { project: Record<string, unknown>; checkpoints: unknown[] } };
    expect(parsed.format).toBe("sirkit-project");
    expect(parsed.formatVersion).toBe(PROJECT_FILE_VERSION_SHEETS);
    expect(parsed.exportedAt).toBe(J3_FIXTURE_EXPORTED_AT);
    expect(parsed.integrity).toBe(`sha256:${sha(canonicalJson(parsed.payload))}`);
    expect(parsed.payload.checkpoints).toEqual([]);
    expect(parsed.payload.project).toMatchObject({ id: J3_FIXTURE_PROJECT_ID, name: J3_FIXTURE_PROJECT_NAME, schemaVersion: 2, createdAt: 1, updatedAt: 1 });
    expect(parsed.payload.project["state"]).toEqual(fixture);
    expect(schematicStateDigest(parsed.payload.project["state"] as SchematicState)).toBe(schematicStateDigest(fixture));
    // byte-stable: the canonical payload of the same record is the same text, so the file never drifts
    expect(canonicalJson({ project: { id: J3_FIXTURE_PROJECT_ID, name: J3_FIXTURE_PROJECT_NAME, state: fixture, createdAt: 1, updatedAt: 1, schemaVersion: 2 }, checkpoints: [] })).toBe(canonicalJson(parsed.payload));
    expect(content.includes("\r")).toBe(false);
  });

  it("import -> export through the real importer and exporter: byte for byte once the editor opens sheets; the recoverable refusal (nothing written) while it does not", async () => {
    const content = multiSheetDroneProjectFile();
    const result = await importProjectFile(content);
    if (MULTI_SHEET_EDITOR_AVAILABLE) {
      if (!result.ok) throw new Error(result.reason);
      expect(result.importedAsCopy).toBe(false);
      expect(result.project.id).toBe(J3_FIXTURE_PROJECT_ID);
      expect(result.project.state).toEqual(fixture);
      expect(result.missingParts).toEqual([]);
      // the imported record carries the import's own updatedAt (now); pin it to the file's so the bytes compare
      const key = `sirkit:project:${J3_FIXTURE_PROJECT_ID}`;
      const stored = JSON.parse(localStorage.getItem(key)!) as Record<string, unknown>;
      localStorage.setItem(key, JSON.stringify({ ...stored, updatedAt: 1 }));
      const exported = await exportProjectFile(J3_FIXTURE_PROJECT_ID);
      if (!exported.ok) throw new Error(exported.reason);
      expect(exported.content).toBe(content);
      expect(JSON.parse(exported.content).formatVersion).toBe(PROJECT_FILE_VERSION_SHEETS);
    } else {
      // [PR-J3, 2026-10-22] until builder A flips MULTI_SHEET_EDITOR_AVAILABLE (plan 1q), the file is validated completely and refused recoverably
      expect(result).toMatchObject({ ok: false, reason: `${SHEETS_EDITOR_PENDING}: this project has 4 schematic sheets, and this version of the editor cannot open a multi-sheet project yet. Nothing was imported; keep the file and open it again after the Sheets update.` });
      expect(localStorage.length).toBe(0);
    }
  });

  it("6. the single-sheet golden is untouched: the flat drone keeps its pre-section-J digest beside the organised fixture", () => {
    expect(schematicStateDigest(flat)).toBe("eng1-66f025a6dde8f8c3"); // j1-sheet-operations GOLDEN.drone.stateDigest
    expect(flat.sheets).toBeUndefined();
    expect(schematicStateDigest(fixture)).not.toBe(schematicStateDigest(flat));
  });
});
