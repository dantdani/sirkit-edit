import { describe, expect, it } from "vitest";
import { computeElectricalTruth } from "../electrical-truth";
import { createEmptyBoard, type FootprintInstance, type Pad, type PcbBoard, type Track } from "../types";
import { mmToNm } from "../units";
import { schematicEndpointKey } from "../integrity";
import { stackupProfile } from "../stackup";
import { pcbRevisionId } from "../revision";

function pad(number: string, xMm = 0): Pad {
  return {
    number, type: "smd", shape: { kind: "circle", radius: mmToNm(0.5) },
    at: { x: mmToNm(xMm), y: 0 }, rotationDeg: 0,
    layers: ["copperTop", "maskTop", "pasteTop"],
  };
}

function footprint(id: string, ref: string, xMm: number, endpoint: string, pads: Pad[] = [pad("1")]): FootprintInstance {
  return {
    id, ref, footprintId: "Truth:Fixture",
    def: {
      libName: "Truth", name: "Fixture",
      attributes: { smd: true, throughHole: false, excludeFromPos: false, excludeFromBom: false },
      pads, graphics: [], bodyBBox: { minX: 0, minY: 0, maxX: mmToNm(2), maxY: mmToNm(2) },
      models: [], rawSexpr: "",
    },
    at: { x: mmToNm(xMm), y: mmToNm(10) }, rotationDeg: 0, side: "top",
    padNets: { "1": 1 },
    pinPadMappings: [{
      componentInstanceId: id, endpointKey: endpoint, symbolPinNumber: "1", padNumbers: ["1"],
      mappingKind: "electrical", provenance: "exact-number",
    }],
  };
}

function assignedBoard(): PcbBoard {
  const board = createEmptyBoard();
  const aKey = schematicEndpointKey("a", "1");
  const bKey = schematicEndpointKey("b", "1");
  board.footprints = [footprint("a", "J1", 10, aKey), footprint("b", "J2", 20, bKey)];
  board.nets.push({ id: 1, name: "SIG", stableId: "net:sig", endpointKeys: [aKey, bKey].sort() });
  return board;
}

function connectingTrack(id = "t1"): Track {
  return {
    id, layer: "copperTop", width: mmToNm(0.25),
    start: { x: mmToNm(10), y: mmToNm(10) }, end: { x: mmToNm(20), y: mmToNm(10) }, netId: 1,
  };
}

describe("authoritative electrical truth", () => {
  it("separates proven intent/assignment from incomplete physical realization", () => {
    const report = computeElectricalTruth(assignedBoard());
    expect(report.intended.state).toBe("proven");
    expect(report.assigned.state).toBe("proven");
    expect(report.realized.state).toBe("failed");
    expect(report.nets[0]).toMatchObject({
      stableNetId: "net:sig", requiredConnections: 1, completedConnections: 0,
      remainingConnections: 1, padContainingClusterCount: 2,
    });
  });

  it("proves completion from the same native copper clusters", () => {
    const board = assignedBoard();
    board.tracks = [connectingTrack()];
    const report = computeElectricalTruth(board);
    expect(report.realized).toMatchObject({ state: "proven", requiredConnections: 1, completedConnections: 1, remainingConnections: 0 });
    expect(report.nets[0].realizationState).toBe("proven");
    expect(report.realized.airwires).toEqual([]);
  });

  it("counts one logical terminal mapped to duplicate physical pads only once", () => {
    const board = assignedBoard();
    board.footprints[0] = footprint(
      "a", "J1", 10, schematicEndpointKey("a", "1"), [pad("1", 0), pad("1", 2)],
    );
    const report = computeElectricalTruth(board);
    expect(report.assigned.physicalPads.filter((item) => item.componentId === "a")).toHaveLength(2);
    expect(report.assigned.terminalGroups).toHaveLength(2);
    expect(report.nets[0]).toMatchObject({ requiredConnections: 1, remainingConnections: 1 });
  });

  it("keeps native plane intent unknown until a current filled zone exists", () => {
    const board = assignedBoard();
    board.tracks = [connectingTrack()];
    board.stackup = 4;
    board.stackupConfig = stackupProfile("signal-plane-4");
    board.stackupConfig.copperLayers.find((layer) => layer.id === "in1")!.planeNetId = 1;
    const report = computeElectricalTruth(board);
    expect(report.nets[0].realizationState).toBe("unknown");
    expect(report.unresolved.map((item) => item.code)).toContain("NATIVE_PLANE_UNRESOLVED");
  });

  it("reports shorted and orphan copper with stable object identities", () => {
    const board = assignedBoard();
    board.nets.push({ id: 2, name: "OTHER", stableId: "net:other", endpointKeys: [] });
    board.tracks = [
      connectingTrack("sig"),
      { ...connectingTrack("other"), netId: 2, start: { x: mmToNm(15), y: mmToNm(5) }, end: { x: mmToNm(15), y: mmToNm(15) } },
      { ...connectingTrack("orphan"), netId: 0, start: { x: mmToNm(30), y: mmToNm(30) }, end: { x: mmToNm(31), y: mmToNm(30) } },
    ];
    const report = computeElectricalTruth(board);
    expect(report.shorts).toHaveLength(1);
    expect(report.shorts[0].stableNetIds).toEqual(["net:other", "net:sig"]);
    expect(report.orphanCopper.some((item) => item.objectId === "track:orphan" && item.reason === "unassigned")).toBe(true);
  });

  it("is revision/order deterministic for semantically unordered arrays", () => {
    const board = assignedBoard();
    board.tracks = [connectingTrack("a"), { ...connectingTrack("b"), start: { x: mmToNm(10), y: mmToNm(11) }, end: { x: mmToNm(20), y: mmToNm(11) } }];
    const shuffled = structuredClone(board);
    shuffled.nets.reverse();
    shuffled.footprints.reverse();
    shuffled.tracks.reverse();
    shuffled.footprints.forEach((item) => item.def.pads.reverse());
    expect(pcbRevisionId(shuffled)).toBe(pcbRevisionId(board));
    expect(computeElectricalTruth(shuffled).nets).toEqual(computeElectricalTruth(board).nets);
  });

  it("invalidates the v2 revision for every routing-significant state family", () => {
    const board = assignedBoard();
    board.tracks = [connectingTrack()];
    board.stackupConfig = stackupProfile("simple-2");
    const base = pcbRevisionId(board);
    const variants: PcbBoard[] = [
      { ...structuredClone(board), outline: { kind: "rect", origin: { x: 0, y: 0 }, width: mmToNm(101), height: mmToNm(80) } },
      { ...structuredClone(board), nets: board.nets.map((net) => net.id === 1 ? { ...net, name: "RENAMED" } : net) },
      { ...structuredClone(board), footprints: board.footprints.map((item, index) => index === 0 ? { ...item, at: { ...item.at, x: item.at.x + 1 } } : item) },
      { ...structuredClone(board), tracks: board.tracks.map((item) => ({ ...item, width: item.width + 1 })) },
      { ...structuredClone(board), stackupConfig: { ...board.stackupConfig!, routing: { ...board.stackupConfig!.routing, viaCost: board.stackupConfig!.routing.viaCost + 1 } } },
      { ...structuredClone(board), routingPreferences: { version: 1, trackWidthMode: "custom", customTrackWidthNm: mmToNm(0.3), viaMode: "net-class" } },
      { ...structuredClone(board), routingKeepouts: [{ id: "ko", polygon: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }], layers: ["copperTop"], forbidTracks: true, forbidVias: true }] },
      { ...structuredClone(board), placementPreferences: { spacingPreset: "comfortable", envelopeScale: 1.2 } },
    ];
    for (const variant of variants) expect(pcbRevisionId(variant)).not.toBe(base);
  });
});
