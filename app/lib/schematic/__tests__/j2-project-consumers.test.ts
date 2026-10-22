/**
 * [PR-J, 2026-10-22] Runbook section J increment 2 (J.4, J.5, J.9; OD-255 items 2-5): the whole-project consumers - the PCB netlist and
 * publication, the ERC's logical netlist and report, the drawn-netlist validation, the design checks, the AI review input, the missing
 * parts / Prepare PCB preflight, the BOM and the agent-delete check - read THE project connectivity authority, for documents WITH
 * sheets. (Documents without sheets: j2-consumers-golden.test.ts pins every output byte for byte.)
 *
 *  1. Project-wide ERC / BOM / PCB sync include every sheet regardless of what the editor shows; one sheet's view is refused by every
 *     consumer (SHEET_LENS_NOT_PROJECT).
 *  2. Moving a subsystem to another sheet keeps the PCB footprint count and the pin-to-net partition: the fixture drone organised into
 *     two sheets publishes the same 41 components and the same net identities and memberships, and a synced board re-syncs with every
 *     footprint kept in place and only identity-preserving net changes.
 *  3. Sheet-only presentation changes (rename, reorder, block geometry, re-laying one sheet's drawing) do not change connectivity.
 *  4. The strict rules reach the consumers: equal coordinates and local labels on two sheets are two PCB and two ERC nets; AGND and
 *     DGND stay two ground rails (the ERC with per-name ground nodes, the validation, the design checks); ports join exactly; a
 *     structural error or a net-name collision publishes nothing and the design checks say why.
 *  5. The agent delete / replacement planners and the connectivity check stay on the part's own sheet.
 * Pure / in-memory: no network; the BOM's catalog reads see an empty mocked database.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/db/client", () => {
  // every query chain resolves to no rows: the part catalog is empty and the BOM still builds (pricing "none": no vendor call)
  const chain: unknown = new Proxy(function query() {}, { get: (_target, key) => (key === "then" ? (resolve: (rows: unknown[]) => void) => resolve([]) : chain), apply: () => chain });
  return { getDb: () => chain };
});

import { buildBom } from "@/app/lib/bom/build";
import { agentDeleteConnectivityRefusal } from "@/app/lib/engineering/agent-delete-connectivity";
import { applySchematicOperationsToCanonical } from "@/app/lib/engineering/operations";
import { fromCanonicalSchematic, toCanonicalSchematic } from "@/app/lib/engineering/schematic-model";
import { planSchematicDelete, planSchematicReplacement } from "@/app/lib/engineering/schematic-plans";
import type { EngineeringOperation } from "@/app/lib/engineering/types";
import { kicadPinWorldPos, pointKey } from "@/app/lib/geometry";
import { exportToKicadSch, EXPORT_HIERARCHY_PENDING, SchematicExportHierarchyPendingError } from "@/app/lib/kicad-export";
import { schematicToSpice, SPICE_SHEETS_PENDING } from "@/app/lib/netlist";
import type { KicadPin } from "@/app/lib/kicad/types";
import type { FootprintSearchHit } from "@/app/lib/pcb/footprint-api-types";
import { parseKicadMod } from "@/app/lib/pcb/kicad-mod";
import { buildNetlist, buildPcbSyncPublicationGraph, syncFromSchematic, type FootprintResolver, type NetlistPartData, type PartLookup, type PcbNetlist, type PcbSyncPublicationGraph } from "@/app/lib/pcb/netlist-bridge";
import { buildPcbSyncPreflightReport } from "@/app/lib/pcb-sync/preflight-read";
import { listUnresolvedInstances } from "@/app/lib/pcb-sync/unresolved-instances";
import { computeDesignChecks } from "@/app/lib/schematic/design-checks";
import { resolveProjectConnectivity } from "@/app/lib/schematic/project-connectivity";
import { planMoveToSheet, renameSheetOperation, reorderSheetsOperation, type MoveEntityRef } from "@/app/lib/schematic/sheet-operations";
import { sheetLens } from "@/app/lib/schematic/sheets";
import { compileCanonicalIr } from "@/app/lib/spice/ir";
import { createSimulationProject } from "@/app/lib/spice/project";
import { runErc } from "@/lib/erc";
import { buildReviewInput } from "@/lib/netlist-review";
import { ROOT_SHEET_ID, type KicadComponentInstance, type NetLabel, type SchComponent, type SchematicSheet, type SchematicState, type Wire } from "@/lib/schematic-types";
import { schematicToBuildNetlist } from "@/lib/schematic-to-netlist";
import { validateSchematicNetlist, validateTheoryNetlist } from "@/lib/validate-netlist";
import { droneFixtureState, fixturePartLookup, fixtureParts } from "./_j1-fixtures";
import { groundKindDimmerState } from "./_j2-fixtures";

// ── shared builders ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const lookup = fixturePartLookup();
const parts = fixtureParts();
const ercParts = new Map([...parts.entries()].map(([id, part]) => [id, { name: part.name, pins: part.pins }] as const));
const label = (id: string, name: string, at: { x: number; y: number }, extra: Partial<NetLabel> = {}): NetLabel => ({ id, position: at, name, kind: "label", orientation: 0, ...extra });
const wire = (id: string, a: { x: number; y: number }, b: { x: number; y: number }, sheetId?: string): Wire => ({ id, vertices: [a, b], ...(sheetId ? { sheetId } : {}) });
const resistor = (id: string, x: number, y: number, sheetId?: string): SchComponent => ({ id, type: "resistor", x, y, rotation: 0, value: "1k", ...(sheetId ? { sheetId } : {}) });
const sheet = (id: string, name: string, parentId: string | null, extra: Partial<SchematicSheet> = {}): SchematicSheet => ({ id, name, parentId, ...extra });
const tree = (...children: SchematicSheet[]): SchematicState["sheets"] => ({ version: 1, sheets: [sheet(ROOT_SHEET_ID, "Overview", null), ...children] });
const key = (componentId: string, pin: string): string => `${encodeURIComponent(componentId)}::${encodeURIComponent(pin)}`;
const apply = (state: SchematicState, operations: EngineeringOperation[]): SchematicState => fromCanonicalSchematic(applySchematicOperationsToCanonical(toCanonicalSchematic(state), operations).schematic);

/** The components named, the wires touching their pins, and the labels on their pins or on those wires' ends (j1-sheet-operations). */
function attachedSelection(state: SchematicState, refs: readonly string[], partLookup: (partId: string) => { pins: readonly KicadPin[] } | null): MoveEntityRef[] {
  const instances = (state.kicadComponents ?? []).filter((item) => refs.includes(item.refDes));
  const pinKeys = new Set(instances.flatMap((item) => (partLookup(item.partId)?.pins ?? []).map((pin) => pointKey(kicadPinWorldPos(item, pin)))));
  const wires = state.wires.filter((item) => pinKeys.has(pointKey(item.vertices[0]!)) || pinKeys.has(pointKey(item.vertices[item.vertices.length - 1]!)));
  const ends = new Set([...pinKeys, ...wires.flatMap((item) => [pointKey(item.vertices[0]!), pointKey(item.vertices[item.vertices.length - 1]!)])]);
  const labels = (state.netLabels ?? []).filter((item) => ends.has(pointKey(item.position)));
  return [...instances.map((item) => ({ family: "kicad" as const, id: item.id })), ...wires.map((item) => ({ family: "wire" as const, id: item.id })), ...labels.map((item) => ({ family: "label" as const, id: item.id }))];
}

/** The fixture drone organised into an IMU sheet and a Motor-driver sheet by the move-to-sheet planner (two canonical moves). */
function organisedDrone(): SchematicState {
  const drone = droneFixtureState();
  const imu = planMoveToSheet(drone, { entities: attachedSelection(drone, ["U3"], lookup), target: { newSheet: { id: "sheet-imu", name: "IMU", block: { x: 3200, y: 600, width: 300, height: 200 } } }, rootName: "Drone overview", operationIdPrefix: "move-imu" }, lookup);
  if (!imu.ok) throw new Error(`${imu.code}: ${imu.message}`);
  const motors = planMoveToSheet(imu.after, { entities: attachedSelection(imu.after, ["Q1", "Q2", "Q3", "Q4", "D2", "D3", "D4"], lookup), target: { newSheet: { id: "sheet-motors", name: "Motor drivers" } }, operationIdPrefix: "move-motors" }, lookup);
  if (!motors.ok) throw new Error(`${motors.code}: ${motors.message}`);
  return motors.after;
}

/** The pin-to-net partition of a netlist: each net's sorted endpoint keys (names ignored). */
const partition = (netlist: PcbNetlist): string[] => netlist.nets.map((net) => net.endpointKeys.join("|")).sort();
/** The published net identities and memberships (display names ignored). */
const publishedNets = (graph: PcbSyncPublicationGraph): string[] => graph.nets.map((net) => JSON.stringify([net.stableNetId, net.connectivityRevision, net.members, net.canonicalScope])).sort();
/** A state whose entity arrays came from one sheet's lens (what a careless caller would hand a consumer). */
function lensState(state: SchematicState, sheetId: string): SchematicState {
  const lens = sheetLens(state, sheetId);
  return { ...state, components: lens.components as unknown as SchComponent[], wires: lens.wires as unknown as Wire[], kicadComponents: lens.kicadComponents as unknown as KicadComponentInstance[], netLabels: lens.netLabels as unknown as NetLabel[] };
}
const bomRows = async (state: SchematicState) => (await buildBom(state, "none")).rows;

// ── 1. project-wide consumers include every sheet ───────────────────────────────────────────────────────────────────────────

describe("[PR-J J2] 1. project-wide ERC / BOM / PCB sync include every sheet, whatever the editor shows", () => {
  const drone = droneFixtureState();
  const organised = organisedDrone();

  it("the drone organised into IMU and Motor-driver sheets publishes all 41 components; missing parts, the preflight census and the BOM are the flat drone's", async () => {
    expect(organised.sheets!.sheets.map((item) => item.name)).toEqual(["Drone overview", "IMU", "Motor drivers"]);
    const onSheets = (organised.kicadComponents ?? []).filter((item) => item.sheetId !== undefined).map((item) => item.refDes).sort();
    expect(onSheets).toEqual(["D2", "D3", "D4", "Q1", "Q2", "Q3", "Q4", "U3"]);
    const netlist = buildNetlist(organised, lookup);
    expect(netlist.components).toEqual(buildNetlist(drone, lookup).components);
    expect(netlist.components).toHaveLength(41);
    const graph = buildPcbSyncPublicationGraph(organised, lookup);
    expect(graph.components).toEqual(buildPcbSyncPublicationGraph(drone, lookup).components);
    expect(graph.components.map((item) => item.hierarchyPath)).toEqual(graph.components.map(() => ["root"])); // OD-255 item 5
    expect(graph.nets.every((net) => net.canonicalScope.length === 1 && net.canonicalScope[0] === "root")).toBe(true);
    expect(listUnresolvedInstances(organised)).toEqual(listUnresolvedInstances(drone));
    expect(buildPcbSyncPreflightReport(organised)).toEqual(buildPcbSyncPreflightReport(drone));
    expect(await bomRows(organised)).toEqual(await bomRows(drone));
    // the ERC's logical netlist lists every part on every sheet
    expect(schematicToBuildNetlist(organised, parts).components).toEqual(schematicToBuildNetlist(drone, parts).components);
    expect(buildReviewInput(organised, parts).components).toEqual(buildReviewInput(drone, parts).components);
  });

  it("every whole-project consumer refuses one sheet's view (SHEET_LENS_NOT_PROJECT), whichever sheet it shows", async () => {
    for (const sheetId of [ROOT_SHEET_ID, "sheet-imu", "sheet-motors"]) {
      const view = lensState(organised, sheetId);
      const refusals: Array<[string, () => unknown]> = [
        ["pcb-netlist", () => buildNetlist(view, lookup)],
        ["pcb-netlist", () => buildPcbSyncPublicationGraph(view, lookup)],
        ["erc-netlist", () => schematicToBuildNetlist(view, parts)],
        ["netlist-validation", () => validateSchematicNetlist({ components: [], connections: [], explanation: "" }, view, parts)],
        ["design-checks", () => computeDesignChecks(view, parts, "d", "build")],
        ["review-input", () => buildReviewInput(view, parts)],
        ["missing-parts", () => listUnresolvedInstances(view)],
        ["pcb-sync-preflight", () => buildPcbSyncPreflightReport(view)],
        ["agent-delete-connectivity", () => agentDeleteConnectivityRefusal(view, [], new Map())],
      ];
      for (const [consumer, run] of refusals) expect(run, `${consumer} on ${sheetId}`).toThrow(`SHEET_LENS_NOT_PROJECT:${consumer}`);
      await expect(buildBom(view, "none")).rejects.toThrow("SHEET_LENS_NOT_PROJECT:bom");
    }
  });
});

// ── 2. moving a subsystem keeps the PCB ─────────────────────────────────────────────────────────────────────────────────────

describe("[PR-J J2] 2. moving a subsystem to another sheet keeps the PCB footprint count and the pin-to-net partition", () => {
  it("the drone's two moves keep the netlist partition, every published net identity and membership, and the ERC and design-check results", () => {
    const drone = droneFixtureState();
    const organised = organisedDrone();
    expect(resolveProjectConnectivity(organised, lookup).partitionDigest).toBe(resolveProjectConnectivity(drone, lookup).partitionDigest);
    const before = buildNetlist(drone, lookup);
    const after = buildNetlist(organised, lookup);
    expect(partition(after)).toEqual(partition(before));
    expect(publishedNets(buildPcbSyncPublicationGraph(organised, lookup))).toEqual(publishedNets(buildPcbSyncPublicationGraph(drone, lookup)));
    // the nets the moves cut keep their names (the overview's labels still name them); nothing is renamed on the board
    expect(after.nets.map((net) => net.name).sort()).toEqual(before.nets.map((net) => net.name).sort());
    // the ERC sees the same circuit: the same findings
    const ercOf = (state: SchematicState) => runErc(schematicToBuildNetlist(state, parts), ercParts, state.sheets ? { groundNodes: "per-name" } : {});
    expect(ercOf(organised).errors).toEqual(ercOf(drone).errors);
    const checks = (state: SchematicState) => computeDesignChecks(state, parts, "d", "build").checks;
    expect(checks(organised).slice(0, 2)).toEqual(checks(drone));
    expect(checks(organised)[2]).toMatchObject({ id: "sheet-interfaces", label: "Sheet connections", state: "pass" });
  });

  it("a synced board re-syncs after a subsystem moves to a new sheet: every footprint kept in place, only identity-preserving net changes", async () => {
    const flat = twoStageCircuit();
    const first = await syncFromSchematic(flat, undefined, { getPart: rLookup, resolver: rResolver() });
    expect(first.ok).toBe(true);
    expect(first.board.footprints).toHaveLength(4);
    const move = planMoveToSheet(flat, { entities: [{ family: "kicad", id: "k3" }, { family: "kicad", id: "k4" }, { family: "wire", id: "w34" }, { family: "label", id: "l-in-2" }, { family: "label", id: "l-out" }], target: { newSheet: { id: "stage-2", name: "Stage 2" } }, operationIdPrefix: "move-stage-2" }, rLookup);
    if (!move.ok) throw new Error(`${move.code}: ${move.message}`);
    expect(move.preview.crossings.map((crossing) => crossing.netName)).toEqual(["IN"]);
    const resync = await syncFromSchematic(move.after, first.board, { getPart: rLookup, resolver: rResolver() });
    expect(resync.ok).toBe(true);
    expect(resync.report.added).toEqual([]);
    expect(resync.report.removed).toEqual([]);
    expect(resync.board.footprints.map((item) => [item.id, item.at])).toEqual(first.board.footprints.map((item) => [item.id, item.at]));
    expect(new Set(resync.report.reconciliation.map((change) => change.kind))).toEqual(new Set(["preserved", "renamed"]));
    // the one sheet-local net is renamed by its sheet path; its stable identity (and every pad's net) is unchanged
    expect(resync.board.nets.map((net) => [net.stableId, net.name]).sort()).toEqual(first.board.nets.map((net) => [net.stableId, net.name === "OUT" ? "Stage 2/OUT" : net.name]).sort());
    const padPartition = (board: typeof first.board) => {
      const byStable = new Map(board.nets.map((net) => [net.id, net.stableId]));
      return board.footprints.map((item) => [item.id, Object.entries(item.padNets).map(([pad, id]) => [pad, byStable.get(id) ?? null])]);
    };
    expect(padPartition(resync.board)).toEqual(padPartition(first.board));
    // a move that CUTS a previously unnamed net (R4 alone: the R3-R4 link) carries it through a new port, which names it; on the
    // board that is a rename of the same stable net (builder A's open question, confirmed here), never a new or split net
    const cut = planMoveToSheet(flat, { entities: [{ family: "kicad", id: "k4" }, { family: "wire", id: "w34" }, { family: "label", id: "l-out" }], target: { newSheet: { id: "stage-2", name: "Stage 2" } }, operationIdPrefix: "move-r4" }, rLookup);
    if (!cut.ok) throw new Error(`${cut.code}: ${cut.message}`);
    expect(cut.preview.crossings.map((crossing) => crossing.netName)).toEqual([null]);
    const cutSync = await syncFromSchematic(cut.after, first.board, { getPart: rLookup, resolver: rResolver() });
    expect(cutSync.ok).toBe(true);
    expect([cutSync.report.added, cutSync.report.removed]).toEqual([[], []]);
    expect(new Set(cutSync.report.reconciliation.map((change) => change.kind))).toEqual(new Set(["preserved", "renamed"]));
    expect(cutSync.board.nets.map((net) => net.stableId).sort()).toEqual(first.board.nets.map((net) => net.stableId).sort());
    expect(padPartition(cutSync.board)).toEqual(padPartition(first.board));
  });
});

// R_0805 resistors over the committed KiCad footprint fixture (app/lib/pcb/__tests__/fixtures), the netlist-bridge suite's way.
const R_PINS: KicadPin[] = [
  { number: "1", name: "~", type: "passive", position: { x: -2.54, y: 0 }, orientation: 0, length: 1.27 },
  { number: "2", name: "~", type: "passive", position: { x: 2.54, y: 0 }, orientation: 180, length: 1.27 },
];
const R_PART: NetlistPartData = { pins: R_PINS, footprintHint: "Resistor_SMD:R_0805_2012Metric", mpn: "RC0805FR-0710KL", name: "R_0805", description: "Thick film resistor" };
const rLookup: PartLookup = (partId) => (partId === "part-r" ? R_PART : null);
function rResolver(): FootprintResolver {
  const rawSexpr = readFileSync(join(process.cwd(), "app", "lib", "pcb", "__tests__", "fixtures", "R_0805_2012Metric.kicad_mod"), "utf8");
  const def = parseKicadMod(rawSexpr, "Resistor_SMD");
  const hit: FootprintSearchHit = { id: "id-r0805", libName: "Resistor_SMD", name: def.name, fullName: "Resistor_SMD:R_0805_2012Metric", description: def.description ?? null, padCount: def.pads.length, attrSmd: def.attributes.smd, attrTht: def.attributes.throughHole, bodyBBox: def.bodyBBox, score: 1 };
  return { resolve: async (fullName) => (fullName === hit.fullName ? hit : null), detail: async (id) => (id === hit.id ? { libName: "Resistor_SMD", rawSexpr } : null) };
}
/** Two resistor stages on one page: R1-R2 (IN, an unnamed link, GND) and R3-R4 (IN by name, an unnamed link, OUT). */
function twoStageCircuit(): SchematicState {
  const r = (id: string, refDes: string, x: number, y: number): KicadComponentInstance => ({ id, partId: "part-r", x, y, rotation: 0, refDes, value: "10k" });
  return {
    components: [],
    kicadComponents: [r("k1", "R1", 100, 100), r("k2", "R2", 200, 100), r("k3", "R3", 100, 300), r("k4", "R4", 200, 300)],
    wires: [wire("w12", { x: 120, y: 100 }, { x: 180, y: 100 }), wire("w34", { x: 120, y: 300 }, { x: 180, y: 300 })],
    netLabels: [label("l-in-1", "IN", { x: 80, y: 100 }), label("l-gnd", "GND", { x: 220, y: 100 }, { kind: "ground" }), label("l-in-2", "IN", { x: 80, y: 300 }), label("l-out", "OUT", { x: 220, y: 300 })],
  };
}

// ── 3. presentation-only changes ────────────────────────────────────────────────────────────────────────────────────────────

describe("[PR-J J2] 3. sheet-only presentation changes do not change connectivity", () => {
  it("renaming and reordering sheets, moving a block and re-laying one sheet's drawing keep the partition, the publication identities and the netlist", () => {
    const organised = organisedDrone();
    const baseNetlist = buildNetlist(organised, lookup);
    const baseGraph = buildPcbSyncPublicationGraph(organised, lookup);
    const baseDigest = resolveProjectConnectivity(organised, lookup).partitionDigest;
    const renamed = apply(organised, [renameSheetOperation("op-rename", "sheet-imu", "Inertial")]);
    const reordered = apply(organised, [reorderSheetsOperation("op-order", [ROOT_SHEET_ID, "sheet-motors", "sheet-imu"])]);
    const blockMoved: SchematicState = { ...organised, sheets: { version: 1, sheets: organised.sheets!.sheets.map((item) => (item.id === "sheet-imu" ? { ...item, block: { x: 400, y: 1200, width: 400, height: 300 } } : item)) } };
    const shift = <T extends { sheetId?: string }>(item: T, move: (value: T) => T): T => (item.sheetId === "sheet-motors" ? move(item) : item);
    const relaid: SchematicState = {
      ...organised,
      kicadComponents: (organised.kicadComponents ?? []).map((item) => shift(item, (value) => ({ ...value, x: value.x + 200, y: value.y - 100 }))),
      wires: organised.wires.map((item) => shift(item, (value) => ({ ...value, vertices: value.vertices.map((vertex) => ({ x: vertex.x + 200, y: vertex.y - 100 })) }))),
      netLabels: (organised.netLabels ?? []).map((item) => shift(item, (value) => ({ ...value, position: { x: value.position.x + 200, y: value.position.y - 100 } }))),
    };
    for (const [name, state] of [["rename", renamed], ["reorder", reordered], ["block", blockMoved], ["re-laid sheet", relaid]] as const) {
      expect(resolveProjectConnectivity(state, lookup).partitionDigest, name).toBe(baseDigest);
      expect(partition(buildNetlist(state, lookup)), name).toEqual(partition(baseNetlist));
      expect(publishedNets(buildPcbSyncPublicationGraph(state, lookup)), name).toEqual(publishedNets(baseGraph));
      expect(buildPcbSyncPublicationGraph(state, lookup).components, name).toEqual(baseGraph.components);
    }
    // nothing here names a net by sheet path (every net of the moved subsystems is named on the overview), so even the bytes hold
    for (const state of [renamed, reordered, blockMoved, relaid]) expect(buildNetlist(state, lookup)).toEqual(baseNetlist);
  });
});

// ── 4. the strict rules in the consumers ────────────────────────────────────────────────────────────────────────────────────

describe("[PR-J J2] 4. the strict sheet rules reach every consumer", () => {
  /** Two NE555s on two sheets at IDENTICAL coordinates, each output on a LOCAL label "OUT" at the same point. */
  function twinTimers(sheets: boolean): SchematicState {
    const timer = parts.get("b16-1c-part-ne555d")!;
    const out = timer.pins.find((pin) => pin.number === "3")!;
    const u = (id: string, refDes: string, sheetId?: string): KicadComponentInstance => ({ id, partId: "b16-1c-part-ne555d", x: 400, y: 300, rotation: 0, refDes, value: "NE555D", symbolAssetVersionId: "symbolv_fixture_ne555", ...(sheets && sheetId ? { sheetId } : {}) });
    const at = kicadPinWorldPos(u("x", "x"), out);
    return {
      components: [],
      kicadComponents: [u("u-a", "U1", "sa"), u("u-b", "U2", "sb")],
      wires: [],
      netLabels: [label("out-a", "OUT", at, sheets ? { sheetId: "sa" } : {}), label("out-b", "OUT", at, sheets ? { sheetId: "sb" } : {})],
      ...(sheets ? { sheets: tree(sheet("sa", "Timer A", ROOT_SHEET_ID), sheet("sb", "Timer B", ROOT_SHEET_ID)) } : {}),
    };
  }

  it("equal coordinates and equal local labels on two sheets are two PCB nets and two ERC nets; the same drawing on one sheet is one", () => {
    const strict = buildNetlist(twinTimers(true), lookup);
    const outs = strict.nets.filter((net) => net.name.endsWith("/OUT"));
    expect(outs.map((net) => [net.name, net.endpointKeys])).toEqual([["Timer A/OUT", [key("u-a", "3")]], ["Timer B/OUT", [key("u-b", "3")]]]);
    expect(strict.nets.every((net) => net.endpointKeys.every((member) => member.startsWith("u-a::")) || net.endpointKeys.every((member) => member.startsWith("u-b::")))).toBe(true);
    const flat = buildNetlist(twinTimers(false), lookup);
    expect(flat.nets.find((net) => net.name === "OUT")!.endpointKeys).toEqual([key("u-a", "3"), key("u-b", "3")]);
    // the ERC: two push-pull outputs on one net are a conflict only where they ARE one net
    const conflicts = (state: SchematicState, groundNodes?: "per-name") => runErc(schematicToBuildNetlist(state, parts), ercParts, groundNodes ? { groundNodes } : {}).errors.filter((error) => error.category === "erc_conflict");
    expect(conflicts(twinTimers(true), "per-name")).toEqual([]);
    expect(conflicts(twinTimers(false)).length).toBeGreaterThan(0);
    // the publication has two distinct board names, no collision
    const graph = buildPcbSyncPublicationGraph(twinTimers(true), lookup);
    expect(graph.nets.map((net) => net.displayName).filter((name) => name.endsWith("/OUT")).sort()).toEqual(["Timer A/OUT", "Timer B/OUT"]);
  });

  it("AGND and DGND stay two ground rails in a document with sheets (PCB, ERC per-name grounds, validation, design checks); without sheets the legacy GND collapse is kept", () => {
    const legacy = groundKindDimmerState();
    const sheeted: SchematicState = { ...groundKindDimmerState(), sheets: tree(sheet("spare", "Spare", ROOT_SHEET_ID)) };
    const legacyNet = buildNetlist(legacy, lookup).nets.filter((net) => ["GND", "AGND", "DGND"].includes(net.name));
    expect(legacyNet.map((net) => [net.name, net.endpointKeys])).toEqual([["GND", [key("kc-c1", "2"), key("kc-u1", "1")]]]);
    const strictNets = buildNetlist(sheeted, lookup).nets.filter((net) => ["GND", "AGND", "DGND"].includes(net.name));
    expect(strictNets.map((net) => [net.name, net.endpointKeys])).toEqual([["AGND", [key("kc-c1", "2")]], ["DGND", [key("kc-u1", "1")]]]);
    // the ERC's logical netlist names both rails as grounds; per-name ground nodes keep them apart (and both are ground references)
    const logical = schematicToBuildNetlist(sheeted, parts);
    expect(logical.connections.filter((connection) => connection.kind === "label" && connection.labelKind === "ground").map((connection) => connection.kind === "label" ? [connection.pin, connection.labelName] : [])).toEqual([["U1.1", "DGND"], ["C1.2", "AGND"]]);
    const erc = runErc(logical, ercParts, { groundNodes: "per-name" });
    expect(erc.errors.map((error) => error.category)).not.toContain("no_ground");
    // the drawn-netlist validation agrees with the scoped partition: no split ground (the legacy single-sheet check reports one)
    expect(validateSchematicNetlist(logical, sheeted, parts).violations.filter((violation) => violation.kind === "broken-connection")).toEqual([]);
    expect(validateSchematicNetlist(schematicToBuildNetlist(legacy, parts), legacy, parts).violations.filter((violation) => violation.kind === "broken-connection").map((violation) => violation.ground)).toEqual([true]);
    const checks = computeDesignChecks(sheeted, parts, "d", "build").checks;
    expect(checks.map((check) => check.id)).toEqual(["floating-nets", "supply-rails", "sheet-interfaces"]);
    expect(checks[0]!.findings.join(" ")).not.toContain("split across");
    expect(computeDesignChecks(legacy, parts, "d", "build").checks[0]!.findings.join(" ")).toContain("split across 2 nets: U1.1, C1.2");
    // the review input names both rails
    expect(buildReviewInput(sheeted, parts).nets.filter((net) => net.kind === "ground").map((net) => [net.name, net.pins])).toEqual([["AGND", ["C1.2"]], ["DGND", ["U1.GND"]]]);
  });

  it("the ERC's per-name ground nodes keep two ground rails apart; the shared default keeps the legacy single ground", () => {
    const logical = {
      components: [{ refDes: "U1", partId: "b16-1c-part-ne555d", value: "NE555D", role: "processor" as const }, { refDes: "U2", partId: "b16-1c-part-ne555d", value: "NE555D", role: "processor" as const }],
      connections: [
        { kind: "label" as const, pin: "U1.3", labelName: "AGND", labelKind: "ground" as const },
        { kind: "label" as const, pin: "U2.3", labelName: "DGND", labelKind: "ground" as const },
      ],
      explanation: "",
    };
    const shared = runErc(logical, ercParts).errors.filter((error) => error.category === "erc_conflict");
    expect(shared.map((error) => error.message)).toEqual(["Net [GND] has 2 push-pull drivers shorted together: U1.3, U2.3."]);
    expect(runErc(logical, ercParts, { groundNodes: "per-name" }).errors.filter((error) => error.category === "erc_conflict")).toEqual([]);
    // each rail is still a ground reference (no "no ground" finding), and a per-name ground net is reported by its own name
    expect(runErc(logical, ercParts, { groundNodes: "per-name" }).errors.map((error) => error.category)).not.toContain("no_ground");
    const sameRail = { ...logical, connections: logical.connections.map((connection) => ({ ...connection, labelName: "AGND" })) };
    expect(runErc(sameRail, ercParts, { groundNodes: "per-name" }).errors.filter((error) => error.category === "erc_conflict").map((error) => error.net)).toEqual(["AGND"]);
    expect(runErc(sameRail, ercParts).errors.filter((error) => error.category === "erc_conflict").map((error) => error.net)).toEqual(["GND"]);
  });

  it("the drawn-netlist validation anchors a label only on its own sheet", () => {
    const empty = { components: [], connections: [], explanation: "" };
    const sheeted: SchematicState = { components: [], wires: [wire("wa", { x: 100, y: 100 }, { x: 300, y: 100 }, "sa")], netLabels: [label("x", "X", { x: 300, y: 100 }, { sheetId: "sb" })], sheets: tree(sheet("sa", "A", ROOT_SHEET_ID), sheet("sb", "B", ROOT_SHEET_ID)) };
    expect(validateSchematicNetlist(empty, sheeted, new Map()).violations).toEqual([{ kind: "unanchored-label", message: 'Net label "X" at (300,100) is not on any pin or wire.' }]);
    const flat: SchematicState = { components: [], wires: [wire("wa", { x: 100, y: 100 }, { x: 300, y: 100 })], netLabels: [label("x", "X", { x: 300, y: 100 })] };
    expect(validateSchematicNetlist(empty, flat, new Map()).violations).toEqual([]);
  });

  /** R1 on the overview bound through port SIG to R2 on child sheet ADC (j1-project-connectivity's boundPorts, without the collision). */
  function boundPorts(): SchematicState {
    return {
      components: [resistor("R1", 100, 100), resistor("R3", 100, 300), resistor("R2", 100, 100, "adc")],
      wires: [wire("w1", { x: 130, y: 100 }, { x: 300, y: 100 }), wire("w2", { x: 130, y: 100 }, { x: 300, y: 100 }, "adc"), wire("w3", { x: 130, y: 300 }, { x: 300, y: 300 })],
      netLabels: [
        label("pin-sig", "SIG", { x: 300, y: 100 }, { scope: "sheet-pin", portId: "p-sig", childSheetId: "adc" }),
        label("h-sig", "SIG", { x: 300, y: 100 }, { sheetId: "adc", scope: "hierarchical", portId: "p-sig" }),
        label("l-loc", "LOC", { x: 300, y: 300 }),
      ],
      sheets: tree(sheet("adc", "ADC", ROOT_SHEET_ID, { block: { x: 400, y: 50, width: 200, height: 100 }, ports: [{ id: "p-sig", name: "SIG", direction: "input" }] })),
    };
  }

  it("a port joins exactly the pins it binds in the PCB netlist and the review input", () => {
    const netlist = buildNetlist(boundPorts());
    expect(netlist.nets.find((net) => net.name === "SIG")!.endpointKeys).toEqual([key("R1", "2"), key("R2", "2")]);
    expect(netlist.nets.find((net) => net.name === "LOC")!.endpointKeys).toEqual([key("R3", "2")]);
    expect(buildReviewInput(boundPorts(), new Map()).nets.find((net) => net.name === "SIG")).toEqual({ name: "SIG", kind: "label", pins: ["R1.right", "R2.right"] });
  });

  it("a structural error or a net-name collision publishes nothing; the design checks say why and do not run the electrical checks", () => {
    const broken = organisedDrone();
    const hierarchical = broken.netLabels!.find((item) => item.scope === "hierarchical")!;
    hierarchical.portId = "no-such-port";
    expect(() => buildNetlist(broken, lookup)).toThrow(/^PS_SHEET_HIERARCHY_INVALID: SHEET_PIN_PORT_MISSING: /);
    expect(() => buildPcbSyncPublicationGraph(broken, lookup)).toThrow(/^PS_SHEET_HIERARCHY_INVALID: SHEET_PIN_PORT_MISSING/);
    expect(() => schematicToBuildNetlist(broken, parts)).toThrow(/^SHEET_HIERARCHY_INVALID: SHEET_PIN_PORT_MISSING/);
    expect(() => validateSchematicNetlist({ components: [], connections: [], explanation: "" }, broken, parts)).toThrow(/^SHEET_HIERARCHY_INVALID: SHEET_PIN_PORT_MISSING/);
    expect(() => buildReviewInput(broken, parts)).toThrow(/^SHEET_HIERARCHY_INVALID: SHEET_PIN_PORT_MISSING/);
    const checks = computeDesignChecks(broken, parts, "d", "build").checks;
    expect(checks.slice(0, 2).map((check) => [check.state, check.reason])).toEqual([["not_run", "the sheet structure has an error (see Sheet connections)"], ["not_run", "the sheet structure has an error (see Sheet connections)"]]);
    expect(checks[2]).toMatchObject({ id: "sheet-interfaces", state: "findings" });
    expect(checks[2]!.findings[0]).toContain("no-such-port");
    // a local "SIG" on the overview and the bound SIG are two different nets with one name: nothing is published
    const collision = boundPorts();
    collision.netLabels!.push(label("l-sig", "SIG", { x: 70, y: 300 })); // on R3's free pin
    expect(() => buildNetlist(collision)).toThrow(/^PS_SHEET_HIERARCHY_INVALID: SHEET_NET_NAME_COLLISION: /);
  });

  it("the design checks of a document with sheets add Sheet connections with the authority's findings (an unbound port)", () => {
    const unbound = boundPorts();
    unbound.netLabels = unbound.netLabels!.filter((item) => item.id !== "pin-sig");
    const checks = computeDesignChecks(unbound, new Map(), "d", "theory").checks;
    expect(checks.map((check) => [check.id, check.state])).toEqual([["floating-nets", "not_run"], ["supply-rails", "not_run"], ["sheet-interfaces", "findings"]]);
    expect(checks[2]!.findings).toEqual(['Port "SIG" of sheet "ADC" has no sheet pin on "Overview": it connects nothing outside its sheet.']);
    // a single-sheet document never shows the third check
    expect(computeDesignChecks(droneFixtureState(), parts, "d", "build").checks.map((check) => check.id)).toEqual(["floating-nets", "supply-rails"]);
  });

  it("the outputs not yet on the project connectivity (flat KiCad export, both SPICE compilers) refuse a document with sheets; a single-sheet one is unchanged", () => {
    const sheeted: SchematicState = { ...boundPorts(), components: [...boundPorts().components, { id: "G1", type: "ground", x: 100, y: 500, rotation: 0, value: "" }, { id: "V1", type: "voltage-source", x: 300, y: 500, rotation: 0, value: "5" }] };
    expect(() => exportToKicadSch({ state: sheeted, parts })).toThrow(SchematicExportHierarchyPendingError);
    expect(() => exportToKicadSch({ state: sheeted, parts })).toThrow(EXPORT_HIERARCHY_PENDING);
    expect(() => schematicToSpice(sheeted)).toThrow(SPICE_SHEETS_PENDING);
    const project = createSimulationProject(sheeted, { now: "2026-10-22T00:00:00.000Z" });
    expect(() => compileCanonicalIr({ project, testId: project.tests[0]!.id })).toThrow(/^SIM_MULTI_SHEET_PENDING: /);
    // the same circuit without sheets (every entity on one page) exports and simulates as before
    const onRoot = <T extends { sheetId?: string }>(item: T): T => { const copy = { ...item }; delete copy.sheetId; return copy; };
    const flat: SchematicState = { components: sheeted.components.map(onRoot), wires: sheeted.wires.map(onRoot), netLabels: [] };
    expect(exportToKicadSch({ state: flat, parts })).toContain("(kicad_sch");
    expect(schematicToSpice(flat).netlist).toContain(".end");
  });

  it("the Theory generation validator refuses a document with sheets instead of validating across sheets", () => {
    expect(() => validateTheoryNetlist({ components: [], connections: [], explanation: "" }, boundPorts())).toThrow(/^SHEET_HIERARCHY_UNSUPPORTED/);
  });
});

// ── 5. agent delete / replacement stay on the part's sheet ──────────────────────────────────────────────────────────────────

describe("[PR-J J2] 5. the agent delete and replacement planners and the connectivity check stay on the part's own sheet", () => {
  /** Sheet A: R1 and R3 tied by one wire whose middle vertex carries a local label MID. Sheet B: wires and a label at the SAME
   *  coordinates (one wire starting on R1's pin position, another joining MID's position to R3's), plus R5. */
  function twins(): SchematicState {
    return {
      components: [resistor("R1", 100, 100, "sa"), resistor("R3", 300, 100, "sa"), resistor("R5", 300, 100, "sb")],
      wires: [
        { id: "wa", vertices: [{ x: 130, y: 100 }, { x: 200, y: 100 }, { x: 270, y: 100 }], sheetId: "sa" },
        wire("wb", { x: 130, y: 100 }, { x: 200, y: 100 }, "sb"), wire("wc", { x: 200, y: 100 }, { x: 270, y: 100 }, "sb"),
      ],
      netLabels: [label("mid", "MID", { x: 200, y: 100 }, { sheetId: "sa" }), label("lb", "OUT", { x: 70, y: 100 }, { sheetId: "sb" })],
      sheets: tree(sheet("sa", "A", ROOT_SHEET_ID), sheet("sb", "B", ROOT_SHEET_ID)),
    };
  }

  it("deleting R1 on sheet A plans only sheet A's wire, and the connectivity check judges sheet A on sheet A", () => {
    const planned = planSchematicDelete(twins(), { family: "theory", componentId: "R1" });
    if (!planned.ok) throw new Error(planned.detail);
    // sheet B's wire starting at R1's pin coordinates and its label there are another circuit
    expect(planned.plan.removeWireIds).toEqual(["wa"]);
    expect(planned.plan.removeNetLabelIds).toEqual([]);
    // removing wa cuts MID off R3 on sheet A. A coordinate-only union would see sheet B's wc still joining (200,100) and (270,100)
    // and miss it; the scoped check refuses.
    expect(agentDeleteConnectivityRefusal(twins(), [planned.plan], new Map())).toBe("AI deletion would disconnect surviving pins, labels or wires. No changes were proposed; edit the shared wiring explicitly first.");
    // without MID nothing surviving is disconnected on either sheet
    const noMid = twins();
    noMid.netLabels = noMid.netLabels!.filter((item) => item.id !== "mid");
    const plan = planSchematicDelete(noMid, { family: "theory", componentId: "R1" });
    if (!plan.ok) throw new Error(plan.detail);
    expect(agentDeleteConnectivityRefusal(noMid, [plan.plan], new Map())).toBeNull();
    // a sheet-structure error refuses the check
    const broken = twins();
    broken.wires[0] = { ...broken.wires[0]!, sheetId: "no-such-sheet" };
    expect(agentDeleteConnectivityRefusal(broken, [planned.plan], new Map())).toContain("sheet structure has an error");
  });

  it("a replacement only moves wire ends and labels on the part's own sheet", () => {
    const pinsA: KicadPin[] = R_PINS;
    const pinsB: KicadPin[] = [{ ...R_PINS[0]!, position: { x: -5.08, y: 0 } }, { ...R_PINS[1]!, position: { x: 5.08, y: 0 } }];
    const k = (id: string, refDes: string, sheetId?: string): KicadComponentInstance => ({ id, partId: "part-r", x: 100, y: 100, rotation: 0, refDes, value: "10k", ...(sheetId ? { sheetId } : {}) });
    const state: SchematicState = {
      components: [],
      kicadComponents: [k("ka", "R1", "sa"), k("kb", "R2", "sb")],
      wires: [wire("wa", { x: 120, y: 100 }, { x: 200, y: 100 }, "sa"), wire("wb", { x: 120, y: 100 }, { x: 200, y: 100 }, "sb")],
      netLabels: [label("la", "IN", { x: 80, y: 100 }, { sheetId: "sa" }), label("lb", "IN", { x: 80, y: 100 }, { sheetId: "sb" })],
      sheets: tree(sheet("sa", "A", ROOT_SHEET_ID), sheet("sb", "B", ROOT_SHEET_ID)),
    };
    const planned = planSchematicReplacement(state, { componentId: "ka", currentPins: pinsA, target: { partId: "part-r-wide", pins: pinsB } });
    if (!planned.ok) throw new Error(planned.detail);
    expect(planned.plan.wireEndpointMoves.map((move) => move.wireId)).toEqual(["wa"]);
    expect(planned.plan.netLabelMoves.map((move) => move.labelId)).toEqual(["la"]);
  });
});
