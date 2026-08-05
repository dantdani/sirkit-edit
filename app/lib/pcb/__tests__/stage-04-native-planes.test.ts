import { describe, expect, it } from "vitest";
import { computeConnectivity } from "../connectivity-board";
import { computeElectricalTruth } from "../electrical-truth";
import { getPreset } from "../drc/presets";
import { verifyAutorouteCandidate } from "../autoroute/verification";
import { stackupProfile } from "../stackup";
import { createEmptyBoard, type FootprintDef, type PcbBoard, type Zone } from "../types";
import { mmToNm } from "../units";
import {
  applyZoneFillCandidate,
  computeZoneFillCandidate,
  zoneFillIsCurrent,
} from "../zones/fill-lifecycle";
import {
  reconcileStackupPlaneZones,
  stackupPlaneZoneId,
} from "../zones/plane";
import { boardToDsn, writeDsn } from "../dsn/write-dsn";
import { validateDsn } from "../dsn/preflight";
import { regionContainsPoint } from "../zones/geometry";
import { createHistory } from "../history";
import { migrateBoardElectricalIdentities } from "../integrity";

const mm = mmToNm;
const P = (x: number, y: number) => ({ x: mm(x), y: mm(y) });

function provenBoard(): PcbBoard {
  const board = createEmptyBoard();
  board.nets.push(
    { id: 1, name: "GND", stableId: "net:gnd", endpointKeys: [] },
    { id: 2, name: "3V3", stableId: "net:3v3", endpointKeys: [] },
  );
  return board;
}

function topPadDef(): FootprintDef {
  return {
    libName: "Test",
    name: "PAD",
    attributes: { smd: true, throughHole: false, excludeFromPos: false, excludeFromBom: false },
    pads: [{
      number: "1",
      type: "smd",
      shape: { kind: "circle", radius: mm(0.5) },
      at: { x: 0, y: 0 },
      rotationDeg: 0,
      layers: ["copperTop"],
    }],
    graphics: [],
    bodyBBox: { minX: -mm(0.5), minY: -mm(0.5), maxX: mm(0.5), maxY: mm(0.5) },
    models: [],
    rawSexpr: "",
  };
}

function userZone(id = "user-zone"): Zone {
  return {
    id,
    layer: "copperTop",
    netId: 1,
    source: "user",
    priority: 0,
    polygon: [P(5, 5), P(40, 5), P(40, 35), P(5, 35)],
    appearance: "solid",
    connection: "solid",
    fill: [],
    dirty: true,
  };
}

describe("Stage 4 native planes and same-net proof", () => {
  it("C-05 materializes exactly one stable native plane and updates/removes it without touching user zones", () => {
    const board = provenBoard();
    board.stackup = 4;
    board.stackupConfig = stackupProfile("signal-plane-4");
    const in1 = board.stackupConfig.copperLayers.find((layer) => layer.id === "in1")!;
    const in2 = board.stackupConfig.copperLayers.find((layer) => layer.id === "in2")!;
    in1.planeNetId = 1;
    in2.role = "signal";
    board.zones.push(userZone());

    expect(reconcileStackupPlaneZones(board).created).toEqual([stackupPlaneZoneId("in1")]);
    expect(reconcileStackupPlaneZones(board).created).toEqual([]);
    expect(board.zones.filter((zone) => zone.source === "stackup-plane")).toHaveLength(1);
    const plane = board.zones.find((zone) => zone.id === stackupPlaneZoneId("in1"))!;
    expect(plane).toMatchObject({ source: "stackup-plane", sourceLayerId: "in1", netId: 1, priority: -1000, dirty: true, fill: [] });

    in1.planeNetId = 2;
    expect(reconcileStackupPlaneZones(board).updated).toEqual([plane.id]);
    expect(board.zones.find((zone) => zone.id === plane.id)?.netId).toBe(2);
    in1.role = "signal";
    expect(reconcileStackupPlaneZones(board).removed).toEqual([plane.id]);
    expect(board.zones.map((zone) => zone.id)).toEqual(["user-zone"]);
  });

  it("rejects a late fill result and produces deterministic revision/hash evidence", () => {
    const board = provenBoard();
    const zone = userZone();
    board.zones.push(zone);
    const first = computeZoneFillCandidate(board, zone);
    const second = computeZoneFillCandidate(structuredClone(board), structuredClone(zone));
    expect(second.sourceRevision).toBe(first.sourceRevision);
    expect(second.state.fillHash).toBe(first.state.fillHash);

    board.tracks.push({ id: "later", layer: "copperTop", width: mm(0.25), start: P(20, 0), end: P(20, 40), netId: 2 });
    const before = JSON.stringify(board);
    expect(applyZoneFillCandidate(board, first)).toBe(false);
    expect(JSON.stringify(board)).toBe(before);
    expect(zoneFillIsCurrent(board, zone)).toBe(false);
  });

  it("realizes a plane, thermal via access, connectivity, C-11 layer use, and DSN certificate from one native truth", () => {
    const board = provenBoard();
    board.stackup = 4;
    board.stackupConfig = stackupProfile("signal-plane-4");
    const in1 = board.stackupConfig.copperLayers.find((layer) => layer.id === "in1")!;
    const in2 = board.stackupConfig.copperLayers.find((layer) => layer.id === "in2")!;
    in1.planeNetId = 1;
    in2.role = "signal";
    board.footprints.push({
      id: "j1",
      ref: "J1",
      footprintId: "Test:PAD",
      def: topPadDef(),
      at: P(20, 20),
      rotationDeg: 0,
      side: "top",
      padNets: { "1": 1 },
    });
    board.vias.push({
      id: "gnd-via",
      at: P(20, 20),
      size: mm(0.8),
      drill: mm(0.4),
      netId: 1,
      layers: ["copperTop", "copperBottom"],
    });
    reconcileStackupPlaneZones(board);
    const plane = board.zones.find((zone) => zone.id === stackupPlaneZoneId("in1"))!;
    const candidate = computeZoneFillCandidate(board, plane);
    expect(applyZoneFillCandidate(board, candidate)).toBe(true);
    expect(zoneFillIsCurrent(board, plane)).toBe(true);
    expect(plane.fill.length).toBeGreaterThan(0);
    expect(plane.fillState?.stats?.thermalAccessCount).toBe(1);

    const connectivity = computeConnectivity(board);
    expect(connectivity.nets.get(1)?.clusters.flat().some((ref) => ref.kind === "zone-region" && ref.zoneId === plane.id)).toBe(true);
    expect(computeElectricalTruth(board).unresolved.some((item) => item.code === "NATIVE_PLANE_UNRESOLVED")).toBe(false);

    const verification = verifyAutorouteCandidate(board, getPreset("jlcpcb-4l").rules);
    expect(verification.layerUsage.in1?.filledAreaNm2).toBeGreaterThan(0);
    expect(verification.layerUsage.in1?.zoneIds).toEqual([plane.id]);
    expect(verification.layerUsage.in1?.stableNetIds).toEqual(["net:gnd"]);

    const dsn = boardToDsn(board);
    expect(dsn.layers.find((layer) => layer.name === "In1.Cu")?.plane?.zoneId).toBe(plane.id);
    expect(dsn.integrity?.planes?.[0]?.fillHash).toBe(plane.fillState?.fillHash);
    expect(writeDsn(dsn)).toContain(`(plane \"GND\" (polygon In1.Cu`);
    expect(validateDsn(board, dsn).issues.some((issue) => issue.code === "NATIVE_PLANE_UNRESOLVED")).toBe(false);
  });

  it("fills deterministically around copper keepouts and resolves contested zones by explicit priority", () => {
    const board = provenBoard();
    board.routingKeepouts = [{
      id: "no-copper",
      polygon: [P(10, 10), P(15, 10), P(15, 15), P(10, 15)],
      layers: ["copperTop"],
      forbidTracks: true,
      forbidVias: true,
    }];
    const low = userZone("low");
    const high: Zone = {
      ...userZone("high"),
      netId: 2,
      priority: 10,
      polygon: [P(25, 15), P(35, 15), P(35, 25), P(25, 25)],
    };
    board.zones.push(low, high);
    const lowFill = computeZoneFillCandidate(board, low);
    const highFill = computeZoneFillCandidate(board, high);
    expect(lowFill.regions.some((region) => regionContainsPoint(region, P(12, 12)))).toBe(false);
    expect(lowFill.regions.some((region) => regionContainsPoint(region, P(30, 20)))).toBe(false);
    expect(highFill.regions.some((region) => regionContainsPoint(region, P(30, 20)))).toBe(true);

    const tiny = userZone("tiny");
    tiny.polygon = [P(50, 50), P(51, 50), P(51, 51), P(50, 51)];
    tiny.minIslandAreaNm2 = mm(2) * mm(2);
    board.zones = [tiny];
    expect(computeZoneFillCandidate(board, tiny).regions).toEqual([]);
  });

  it("migrates old plane intent exactly once and keeps assignment undo/redo atomic in project history", () => {
    const legacy = provenBoard();
    legacy.stackup = 4;
    legacy.stackupConfig = stackupProfile("signal-plane-4");
    legacy.stackupConfig.copperLayers.find((layer) => layer.id === "in1")!.planeNetId = 1;
    delete legacy.identityVersion;
    legacy.nets.forEach((net) => {
      delete net.stableId;
      delete net.endpointKeys;
    });
    const first = migrateBoardElectricalIdentities(legacy, "stage4-migration");
    const second = migrateBoardElectricalIdentities(first.board, "stage4-migration");
    expect(first.board.zones.filter((zone) => zone.source === "stackup-plane")).toHaveLength(1);
    expect(second.board.zones.filter((zone) => zone.source === "stackup-plane")).toHaveLength(1);
    expect(second.board.zones[0].id).toBe(first.board.zones[0].id);

    const editable = provenBoard();
    editable.stackup = 4;
    editable.stackupConfig = stackupProfile("signal-plane-4");
    const history = createHistory(editable);
    history.execute("Assign GND plane", (draft) => {
      draft.stackupConfig!.copperLayers.find((layer) => layer.id === "in1")!.planeNetId = 1;
      reconcileStackupPlaneZones(draft);
    }, { operationType: "assign-native-plane", actor: "human", affectedObjects: [stackupPlaneZoneId("in1")] });
    expect(history.present.zones.map((zone) => zone.id)).toContain(stackupPlaneZoneId("in1"));
    expect(history.events.at(-1)?.operation).toBe("assign-native-plane");
    history.undo();
    expect(history.present.zones).toEqual([]);
    history.redo();
    expect(history.present.zones.map((zone) => zone.id)).toEqual([stackupPlaneZoneId("in1")]);
  });
});
