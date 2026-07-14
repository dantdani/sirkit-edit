/**
 * Stage 17 Phase A gate: copper-level picking — exact hits for vias, tracks,
 * pads and zone outlines at known coordinates, with the pinned overlap
 * priority (via > pad > track > text > footprint > zone) and the 0.15 mm
 * at-cursor tolerance.
 */

import { describe, it, expect } from "vitest";
import {
  buildPickIndex,
  buildBoardPickEntries,
  PICK_TOLERANCE_NM,
  type PickEntry,
} from "../pick";
import { buildRoutedDemo } from "../../demo/routed-demo";
import { silkItemPolylines } from "../../silk/geometry";
import type { PcbBoard, FootprintDef, FootprintInstance } from "../../types";
import type { SilkTextItem } from "../../silk/types";
import { mmToNm } from "../../units";

const mm = mmToNm;

function minimalDef(): FootprintDef {
  return {
    libName: "Test",
    name: "TEST",
    attributes: { smd: true, throughHole: false, excludeFromPos: false, excludeFromBom: false },
    pads: [
      {
        number: "1",
        type: "smd",
        shape: { kind: "rect", width: mm(1), height: mm(1) },
        at: { x: 0, y: 0 },
        rotationDeg: 0,
        layers: ["copperTop"],
      },
    ],
    graphics: [],
    bodyBBox: { minX: -mm(2), minY: -mm(1), maxX: mm(2), maxY: mm(1) },
    models: [],
    rawSexpr: "",
  };
}

const silkText: SilkTextItem = {
  kind: "text",
  id: "s1",
  layer: "silkTop",
  position: { x: mm(20), y: mm(20) },
  text: "X",
  heightNm: mm(1),
  strokeWidthNm: mm(0.15),
  rotationDeg: 0,
  mirror: false,
  anchor: "left",
};

function syntheticBoard(): PcbBoard {
  const fp: FootprintInstance = {
    id: "fp1",
    ref: "U1",
    footprintId: "Test:TEST",
    def: minimalDef(),
    at: { x: mm(10), y: mm(10) },
    rotationDeg: 0,
    side: "top",
    padNets: { "1": 1 },
  };
  return {
    formatVersion: 1,
    stackup: 2,
    outline: { kind: "rect", width: mm(60), height: mm(30), origin: { x: 0, y: 0 } },
    nets: [
      { id: 0, name: "" },
      { id: 1, name: "N1" },
    ],
    footprints: [fp],
    tracks: [
      {
        id: "t1",
        layer: "copperTop",
        width: mm(0.25),
        start: { x: mm(20), y: mm(10) },
        end: { x: mm(30), y: mm(10) },
        netId: 1,
      },
    ],
    vias: [
      {
        id: "v1",
        at: { x: mm(30), y: mm(10) },
        size: mm(0.6),
        drill: mm(0.3),
        netId: 1,
        layers: ["copperTop", "copperBottom"],
      },
    ],
    zones: [
      {
        id: "z1",
        layer: "copperTop",
        netId: 1,
        polygon: [
          { x: mm(40), y: mm(5) },
          { x: mm(50), y: mm(5) },
          { x: mm(50), y: mm(15) },
          { x: mm(40), y: mm(15) },
        ],
        appearance: "solid",
        connection: "thermal",
        fill: [],
        dirty: true,
      },
    ],
    texts: [],
    silkItems: [silkText],
  };
}

/** The scene merges footprint bbox entries with the copper entries. */
function fullIndex(board: PcbBoard) {
  const entries: PickEntry[] = board.footprints.map((f) => ({
    result: { kind: "footprint", id: f.id },
    bbox: {
      minX: f.at.x + f.def.bodyBBox.minX,
      minY: f.at.y + f.def.bodyBBox.minY,
      maxX: f.at.x + f.def.bodyBBox.maxX,
      maxY: f.at.y + f.def.bodyBBox.maxY,
    },
  }));
  entries.push(...buildBoardPickEntries(board, PICK_TOLERANCE_NM));
  return buildPickIndex(entries);
}

describe("copper picking", () => {
  const board = syntheticBoard();
  const index = fullIndex(board);
  const at = (xMm: number, yMm: number) => index.pickAt({ x: mm(xMm), y: mm(yMm) }, PICK_TOLERANCE_NM);

  it("hits a via — and the via beats the track ending on it", () => {
    expect(at(30, 10)).toEqual({ kind: "via", id: "v1" });
  });

  it("hits a track along its run", () => {
    expect(at(25, 10)).toEqual({ kind: "track", id: "t1" });
  });

  it("hits a pad — and the pad beats its footprint's bbox", () => {
    expect(at(10, 10)).toEqual({ kind: "pad", footprintId: "fp1", padNumber: "1" });
  });

  it("falls back to the footprint bbox off-pad", () => {
    expect(at(11.5, 10.5)).toEqual({ kind: "footprint", id: "fp1" });
  });

  it("hits zone OUTLINES only — the fill interior is not a target", () => {
    expect(at(40, 10)).toEqual({ kind: "zone", id: "z1" }); // on the left edge
    expect(at(45, 10)).toBeNull(); // interior, ≥ tolerance from every edge
  });

  it("hits silk text by its stroke bbox", () => {
    const lines = silkItemPolylines(silkText);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const line of lines) {
      for (const p of line) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
    }
    const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    expect(index.pickAt(center, PICK_TOLERANCE_NM)).toEqual({ kind: "text", id: "s1" });
  });

  it("applies the 0.15 mm at-cursor tolerance to copper", () => {
    // Track half-width is 0.125 mm: 0.25 mm off-axis is 0.125 mm from the
    // copper edge — inside the tolerance. 0.5 mm off-axis is 0.375 mm — out.
    expect(at(25, 10.25)).toEqual({ kind: "track", id: "t1" });
    expect(at(25, 10.5)).toBeNull();
    // Via barrel radius 0.3 mm + tolerance.
    expect(at(30.4, 10)).toEqual({ kind: "via", id: "v1" });
    expect(at(30.5, 10)).toBeNull();
  });

  it("pickIn returns fully contained copper for the marquee", () => {
    const picked = index.pickIn({
      minX: mm(19),
      minY: mm(9),
      maxX: mm(31),
      maxY: mm(11),
    });
    expect(picked).toContainEqual({ kind: "track", id: "t1" });
    expect(picked).toContainEqual({ kind: "via", id: "v1" });
    expect(picked.some((p) => p.kind === "zone" || p.kind === "footprint")).toBe(false);
  });

  it("pickIn: a marquee snug around a zone's exact bbox contains it", () => {
    const picked = index.pickIn({
      minX: mm(40),
      minY: mm(5),
      maxX: mm(50),
      maxY: mm(15),
    });
    expect(picked).toContainEqual({ kind: "zone", id: "z1" });
  });

  it("smoke: routed demo vias pick by exact center", () => {
    const demo = buildRoutedDemo();
    const demoIndex = buildPickIndex(buildBoardPickEntries(demo, PICK_TOLERANCE_NM));
    const via = demo.vias[0];
    expect(demoIndex.pickAt(via.at, PICK_TOLERANCE_NM)).toEqual({ kind: "via", id: via.id });
  });
});
