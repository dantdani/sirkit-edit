// 3D track capsule shapes (PCB Stage 15). Scene space is mm with y NEGATED
// (board +y is down); a track along board +x stays along scene +x.

import { describe, expect, it } from "vitest";
import { mmToNm } from "../units";
import { trackShape } from "../3d/geom/track-shape";

function bboxOf(points: { x: number; y: number }[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

describe("trackShape", () => {
  it("(a) horizontal 10 mm track, 0.25 mm wide → capsule bbox (-0.125,-0.125)..(10.125,0.125)", () => {
    const shape = trackShape({ x: 0, y: 0 }, { x: mmToNm(10), y: 0 }, mmToNm(0.25));
    const b = bboxOf(shape.getPoints(12));
    expect(b.minX).toBeCloseTo(-0.125, 6);
    expect(b.maxX).toBeCloseTo(10.125, 6);
    expect(b.minY).toBeCloseTo(-0.125, 6);
    expect(b.maxY).toBeCloseTo(0.125, 6);
  });

  it("(b) diagonal 10×10 mm track → bbox spans 10.25 mm per axis (capsule caps add r each side)", () => {
    // (Spec text said "√2·10 + 0.25" — that's the capsule LENGTH; the axis-
    // aligned bbox of a diagonal capsule spans span+2r = 10.25 per dimension.)
    const shape = trackShape({ x: 0, y: 0 }, { x: mmToNm(10), y: mmToNm(10) }, mmToNm(0.25));
    const b = bboxOf(shape.getPoints(12));
    expect(b.maxX - b.minX).toBeCloseTo(10.25, 6);
    expect(b.maxY - b.minY).toBeCloseTo(10.25, 6);
    // y flip: board +y down → scene −y.
    expect(b.minY).toBeCloseTo(-10.125, 6);
    expect(b.maxY).toBeCloseTo(0.125, 6);
  });

  it("zero-length track degrades to a circle of the track width", () => {
    const at = { x: mmToNm(5), y: mmToNm(5) };
    const shape = trackShape(at, at, mmToNm(0.5));
    const b = bboxOf(shape.getPoints(24));
    expect(b.maxX - b.minX).toBeCloseTo(0.5, 3);
    expect(b.maxY - b.minY).toBeCloseTo(0.5, 3);
  });
});
