// 3D zone shapes (PCB Stage 15): winding normalization (outer CCW, holes CW —
// three.js triangulation relies on it) and Stage 11 fixture compatibility.

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { mmToNm } from "../units";
import type { Vec2 } from "../geometry";
import type { FilledRegion } from "../types";
import { polygonBBox, ringAreaNm2 } from "../zones/geometry";
import { computeFill } from "../zones/compute-fill";
import { makeEffectiveClearance } from "../zones/types";
import { makePlaneZone } from "../zones/plane";
import { buildRoutedDemo } from "../demo/routed-demo";
import { zoneRegionShape } from "../3d/geom/zone-shape";

const mm = (v: number): number => mmToNm(v);
const v2 = (xMm: number, yMm: number): Vec2 => ({ x: mm(xMm), y: mm(yMm) });

function region(outer: Vec2[], holes: Vec2[][] = []): FilledRegion {
  return { outer, holes, boundingBox: polygonBBox(outer), areaNm2: ringAreaNm2(outer) };
}

/** Unique outline vertices (drop closing duplicate + consecutive dups). */
function uniquePoints(pts: THREE.Vector2[]): THREE.Vector2[] {
  const out = pts.filter((p, i) => i === 0 || !p.equals(pts[i - 1]));
  if (out.length > 1 && out[0].equals(out[out.length - 1])) out.pop();
  return out;
}

describe("zoneRegionShape", () => {
  it("(a) 10 mm square region → 4 outline points, outer wound CCW", () => {
    const shape = zoneRegionShape(
      region([v2(0, 0), v2(10, 0), v2(10, 10), v2(0, 10)]),
    );
    const pts = uniquePoints(shape.getPoints());
    expect(pts).toHaveLength(4);
    expect(THREE.ShapeUtils.isClockWise(pts)).toBe(false); // outer = CCW
  });

  it("(b) region with one hole → hole present, wound opposite to the outer", () => {
    const shape = zoneRegionShape(
      region(
        [v2(0, 0), v2(10, 0), v2(10, 10), v2(0, 10)],
        [[v2(4, 4), v2(6, 4), v2(6, 6), v2(4, 6)]],
      ),
    );
    expect(shape.holes).toHaveLength(1);
    expect(THREE.ShapeUtils.isClockWise(uniquePoints(shape.getPoints()))).toBe(false);
    expect(THREE.ShapeUtils.isClockWise(uniquePoints(shape.holes[0].getPoints()))).toBe(true);
  });

  it("(c) Stage 11 demo fill regions build without throwing", () => {
    const board = buildRoutedDemo();
    // The fixture's small zone overlaps no GND copper (islands drop it) —
    // pour a full-board GND plane instead, the Stage 11 verification shape.
    const zone = makePlaneZone(board, "copperTop", 1);
    board.zones = [zone];
    const { regions } = computeFill({
      board,
      zone,
      effectiveClearance: makeEffectiveClearance(board, zone),
    });
    expect(regions.length).toBeGreaterThanOrEqual(1);
    for (const r of regions) {
      const shape = zoneRegionShape(r);
      expect(shape.getPoints().length).toBeGreaterThanOrEqual(3);
      expect(shape.holes.length).toBe(r.holes.length);
    }
  });
});
