import { describe, it, expect } from "vitest";
import { mmToNm, formatMm } from "../units";
import {
  transformPoint,
  shapeBBox,
  bboxUnion,
  shapeDistance,
} from "../geometry";
import type { PlacedShape } from "../geometry";

const mm = mmToNm;

function circle(radiusMm: number, xMm: number, yMm: number): PlacedShape {
  return {
    shape: { kind: "circle", radius: mm(radiusMm) },
    at: { x: mm(xMm), y: mm(yMm) },
    rotationDeg: 0,
  };
}

function rect(wMm: number, hMm: number, xMm: number, yMm: number, rot = 0): PlacedShape {
  return {
    shape: { kind: "rect", width: mm(wMm), height: mm(hMm) },
    at: { x: mm(xMm), y: mm(yMm) },
    rotationDeg: rot,
  };
}

describe("shapeDistance", () => {
  it("two 1 mm-radius circles with centers 3 mm apart gap exactly 1 mm", () => {
    expect(shapeDistance(circle(1, 0, 0), circle(1, 3, 0))).toBe(1_000_000);
  });

  it("overlapping rects give <= 0", () => {
    expect(shapeDistance(rect(2, 2, 0, 0), rect(2, 2, 1, 0))).toBeLessThanOrEqual(0);
  });

  it("touching rects give <= 0", () => {
    expect(shapeDistance(rect(2, 2, 0, 0), rect(2, 2, 2, 0))).toBeLessThanOrEqual(0);
  });

  it("circle vs rect is exact", () => {
    // 2×2 mm rect at origin; r=0.5 mm circle at (3, 0): gap = 3 − 1 − 0.5.
    expect(shapeDistance(rect(2, 2, 0, 0), circle(0.5, 3, 0))).toBe(1_500_000);
  });

  it("oval (stadium) vs circle is exact", () => {
    const oval: PlacedShape = {
      shape: { kind: "oval", width: mm(3), height: mm(1) },
      at: { x: 0, y: 0 },
      rotationDeg: 0,
    };
    // Spine ±1 mm horizontal with 0.5 mm radius; circle r=0.5 at (0, 2):
    // gap = 2 − 0.5 − 0.5 = 1 mm.
    expect(shapeDistance(oval, circle(0.5, 0, 2))).toBe(1_000_000);
  });

  it("roundrect vs circle is exact", () => {
    const rr: PlacedShape = {
      shape: { kind: "roundrect", width: mm(2), height: mm(2), cornerRadius: mm(0.5) },
      at: { x: 0, y: 0 },
      rotationDeg: 0,
    };
    // Right edge at x = 1 mm; circle r=0.25 at (2.25, 0): gap = 1 mm.
    expect(shapeDistance(rr, circle(0.25, 2.25, 0))).toBe(1_000_000);
  });

  it("containment without boundary contact is an overlap", () => {
    expect(shapeDistance(rect(5, 5, 0, 0), rect(0.5, 0.5, 0, 0))).toBeLessThanOrEqual(0);
    expect(shapeDistance(rect(5, 5, 0, 0), circle(0.2, 0.5, 0.5))).toBeLessThanOrEqual(0);
  });

  it("rotation is respected", () => {
    // 4×1 mm rect rotated 90° becomes 1 mm wide × 4 mm tall: its right edge
    // sits at x = 0.5 mm, so a r=0.5 circle at (3, 0) gaps 2 mm.
    expect(shapeDistance(rect(4, 1, 0, 0, 90), circle(0.5, 3, 0))).toBe(2_000_000);
  });

  it("polygon pads work (non-convex L-shape vs circle)", () => {
    const ell: PlacedShape = {
      shape: {
        kind: "polygon",
        points: [
          { x: 0, y: 0 },
          { x: mm(2), y: 0 },
          { x: mm(2), y: mm(1) },
          { x: mm(1), y: mm(1) },
          { x: mm(1), y: mm(2) },
          { x: 0, y: mm(2) },
        ],
      },
      at: { x: 0, y: 0 },
      rotationDeg: 0,
    };
    // Circle r=0.5 at (4, 0.5): nearest polygon edge is x=2 → gap 1.5 mm.
    expect(shapeDistance(ell, circle(0.5, 4, 0.5))).toBe(1_500_000);
  });
});

describe("shapeBBox", () => {
  it("bounds an axis-aligned rect exactly", () => {
    expect(shapeBBox(rect(2, 1, 1, 1))).toEqual({
      minX: 0,
      minY: mm(0.5),
      maxX: mm(2),
      maxY: mm(1.5),
    });
  });

  it("bounds a 90°-rotated rect (within 1 nm)", () => {
    const bb = shapeBBox(rect(2, 1, 0, 0, 90));
    expect(Math.abs(bb.minX - -mm(0.5))).toBeLessThanOrEqual(1);
    expect(Math.abs(bb.maxX - mm(0.5))).toBeLessThanOrEqual(1);
    expect(Math.abs(bb.minY - -mm(1))).toBeLessThanOrEqual(1);
    expect(Math.abs(bb.maxY - mm(1))).toBeLessThanOrEqual(1);
  });

  it("bounds a circle", () => {
    expect(shapeBBox(circle(1, 2, 3))).toEqual({
      minX: mm(1),
      minY: mm(2),
      maxX: mm(3),
      maxY: mm(4),
    });
  });
});

describe("bboxUnion", () => {
  it("unions two boxes", () => {
    expect(
      bboxUnion(
        { minX: 0, minY: 0, maxX: 10, maxY: 5 },
        { minX: -3, minY: 2, maxX: 4, maxY: 9 },
      ),
    ).toEqual({ minX: -3, minY: 0, maxX: 10, maxY: 9 });
  });
});

describe("transformPoint (+y down, positive rotation = screen CCW)", () => {
  const origin = { x: 0, y: 0 };
  const p = { x: mm(1), y: 0 };

  it("rotates 90° to screen up (0, −1 mm)", () => {
    expect(transformPoint(p, origin, 90)).toEqual({ x: 0, y: -mm(1) });
  });

  it("rotates 180°", () => {
    expect(transformPoint(p, origin, 180)).toEqual({ x: -mm(1), y: 0 });
  });

  it("rotates 270°", () => {
    expect(transformPoint(p, origin, 270)).toEqual({ x: 0, y: mm(1) });
  });

  it("translates after rotating", () => {
    expect(transformPoint(p, { x: mm(10), y: mm(20) }, 90)).toEqual({
      x: mm(10),
      y: mm(19),
    });
  });

  it("mirrors x before rotating", () => {
    expect(transformPoint(p, origin, 0, true)).toEqual({ x: -mm(1), y: 0 });
    expect(transformPoint(p, origin, 90, true)).toEqual({ x: 0, y: mm(1) });
  });
});

describe("formatMm", () => {
  it("formats without trailing zeros and never -0", () => {
    expect(formatMm(1_250_000)).toBe("1.25");
    expect(formatMm(100)).toBe("0.0001");
    expect(formatMm(0)).toBe("0");
    expect(formatMm(-0)).toBe("0");
    expect(formatMm(1)).toBe("0.000001");
    expect(formatMm(-1_500_000)).toBe("-1.5");
    expect(formatMm(mm(100))).toBe("100");
  });
});
