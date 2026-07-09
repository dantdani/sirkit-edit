// KiCad export units (Stage 13): 6-decimal mm formatting, exact nm round-trip
// on grid-snapped values, ≤1 nm error everywhere else, angle normalization.

import { describe, it, expect } from "vitest";
import { nmToMm, mmToNm, nmVec2ToMm, formatDeg } from "../kicad/units";
import { mmToNm as modelMmToNm } from "../units";

describe("kicad/units", () => {
  it("(a) nmToMm(1_000_000) → '1.000000'", () => {
    expect(nmToMm(1_000_000)).toBe("1.000000");
  });

  it("(b) nmToMm(1_270_000) → '1.270000'", () => {
    expect(nmToMm(1_270_000)).toBe("1.270000");
  });

  it("(c) mmToNm(nmToMm(n)) is exact for grid-snapped values", () => {
    const gridSnapped = [0, 1_000_000_000, modelMmToNm(0.5), modelMmToNm(152.4), modelMmToNm(-76.2), 500_000];
    for (const n of gridSnapped) {
      expect(mmToNm(nmToMm(n))).toBe(n);
    }
  });

  it("(d) non-grid values round-trip within 1 nm", () => {
    const nonGrid = [1, 3, 1_234_567, -9_876_543, 333_333_333, 707_107];
    for (const n of nonGrid) {
      expect(Math.abs(mmToNm(nmToMm(n)) - n)).toBeLessThanOrEqual(1);
    }
  });

  it("always emits exactly 6 decimal places and never '-0.000000'", () => {
    expect(nmToMm(0)).toBe("0.000000");
    expect(nmToMm(-0)).toBe("0.000000");
    expect(nmToMm(-1_270_000)).toBe("-1.270000");
    expect(nmToMm(3)).toBe("0.000003");
  });

  it("nmVec2ToMm converts both components", () => {
    expect(nmVec2ToMm({ x: 152_400_000, y: 76_200_000 })).toEqual({
      x: "152.400000",
      y: "76.200000",
    });
  });

  it("formatDeg normalizes to (-180, 180] with no sign flip", () => {
    expect(formatDeg(0)).toBe("0.000000");
    expect(formatDeg(90)).toBe("90.000000"); // CCW-positive passes through
    expect(formatDeg(270)).toBe("-90.000000"); // one UI 90°-CW turn
    expect(formatDeg(-90)).toBe("-90.000000");
    expect(formatDeg(180)).toBe("180.000000");
    expect(formatDeg(-180)).toBe("180.000000");
    expect(formatDeg(720)).toBe("0.000000");
  });
});
