// Island removal (PCB Stage 11): keep regions that reach the zone's net,
// drop floating copper. Track/via anchors only count when they themselves
// connect to a pad (Stage 6 connectivity clusters).

import { describe, expect, it } from "vitest";
import { mmToNm } from "../units";
import type { Vec2 } from "../geometry";
import type { FilledRegion, FootprintInstance, Pad, PcbBoard, Track, Via, Zone } from "../types";
import type { LayerId } from "../layers";
import { createEmptyBoard } from "../types";
import { filterIslandsByConnection } from "../zones/islands";
import { polygonBBox, ringAreaNm2 } from "../zones/geometry";

const mm = (v: number): number => mmToNm(v);
const v2 = (xMm: number, yMm: number): Vec2 => ({ x: mm(xMm), y: mm(yMm) });

function region(x0: number, y0: number, x1: number, y1: number): FilledRegion {
  const outer = [v2(x0, y0), v2(x1, y0), v2(x1, y1), v2(x0, y1)];
  return { outer, holes: [], boundingBox: polygonBBox(outer), areaNm2: ringAreaNm2(outer) };
}

function circlePad(number: string, at: Vec2, layers: LayerId[] = ["copperTop"]): Pad {
  return { number, type: "smd", shape: { kind: "circle", radius: mm(0.5) }, at, rotationDeg: 0, layers };
}

let instN = 0;
function inst(atMm: Vec2, pads: Pad[], padNets: Record<string, number>): FootprintInstance {
  return {
    id: `isl-${++instN}`,
    ref: `U${instN}`,
    footprintId: "test:fp",
    def: {
      libName: "test",
      name: "fp",
      attributes: { smd: true, throughHole: false, excludeFromPos: false, excludeFromBom: false },
      pads,
      graphics: [],
      bodyBBox: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      models: [],
      rawSexpr: "",
    },
    at: atMm,
    rotationDeg: 0,
    side: "top",
    padNets,
  };
}

let zoneN = 0;
function gndZone(): Zone {
  return {
    id: `iz-${++zoneN}`,
    layer: "copperTop",
    netId: 1,
    polygon: [v2(0, 0), v2(60, 0), v2(60, 40), v2(0, 40)],
    appearance: "solid",
    connection: "thermal",
    fill: [],
    dirty: true,
  };
}

let n = 0;
const track = (netId: number, start: Vec2, end: Vec2, layer: LayerId = "copperTop"): Track => ({
  id: `it-${++n}`,
  layer,
  width: mm(0.25),
  start,
  end,
  netId,
});
const via = (netId: number, at: Vec2): Via => ({
  id: `iv-${++n}`,
  at,
  size: mm(0.6),
  drill: mm(0.3),
  netId,
  layers: ["copperTop", "copperBottom"],
});

function boardWith(parts: Partial<Pick<PcbBoard, "footprints" | "tracks" | "vias">>): PcbBoard {
  const b = createEmptyBoard();
  b.nets.push(
    { id: 1, name: "GND", stableId: "net:gnd", endpointKeys: [] },
    { id: 2, name: "SIG", stableId: "net:sig", endpointKeys: [] },
  );
  Object.assign(b, parts);
  return b;
}

describe("filterIslandsByConnection", () => {
  it("(a) two islands, one contains a same-net pad → keep 1, dropped 1", () => {
    const board = boardWith({ footprints: [inst(v2(10, 10), [circlePad("1", { x: 0, y: 0 })], { "1": 1 })] });
    const { keep, dropped } = filterIslandsByConnection(
      [region(5, 5, 15, 15), region(30, 5, 40, 15)],
      board,
      gndZone(),
    );
    expect(keep).toHaveLength(1);
    expect(dropped).toBe(1);
    expect(keep[0].boundingBox.minX).toBe(mm(5));
  });

  it("(b) island containing only a foreign-net trace → dropped", () => {
    const board = boardWith({
      footprints: [inst(v2(50, 30), [circlePad("1", { x: 0, y: 0 })], { "1": 1 })], // GND exists, elsewhere
      tracks: [track(2, v2(31, 10), v2(39, 10))], // SIG trace inside the island
    });
    const { keep, dropped } = filterIslandsByConnection([region(30, 5, 40, 15)], board, gndZone());
    expect(keep).toHaveLength(0);
    expect(dropped).toBe(1);
  });

  it("(b2) a floating same-net stub does NOT rescue an island", () => {
    const board = boardWith({
      footprints: [inst(v2(50, 30), [circlePad("1", { x: 0, y: 0 })], { "1": 1 })],
      tracks: [track(1, v2(31, 10), v2(39, 10))], // GND stub, connected to nothing
    });
    const { keep, dropped } = filterIslandsByConnection([region(30, 5, 40, 15)], board, gndZone());
    expect(keep).toHaveLength(0);
    expect(dropped).toBe(1);
  });

  it("(c) island with a same-net via that reaches a pad through the other layer → kept", () => {
    const viaAt = v2(35, 10);
    const padAt = v2(50, 30);
    const board = boardWith({
      footprints: [inst(padAt, [circlePad("1", { x: 0, y: 0 }, ["copperBottom"])], { "1": 1 })],
      vias: [via(1, viaAt)],
      tracks: [track(1, viaAt, padAt, "copperBottom")], // via → pad on the bottom layer
    });
    const { keep, dropped } = filterIslandsByConnection([region(30, 5, 40, 15)], board, gndZone());
    expect(keep).toHaveLength(1);
    expect(dropped).toBe(0);
  });

  it("keeps everything when the zone's net has no copper at all (nothing to reach)", () => {
    const board = boardWith({});
    const { keep, dropped } = filterIslandsByConnection(
      [region(5, 5, 15, 15), region(30, 5, 40, 15)],
      board,
      gndZone(),
    );
    expect(keep).toHaveLength(2);
    expect(dropped).toBe(0);
  });
});
