// Silk text shaping (Stage 16): scaling, anchors, mirror, rotation, fallback.
// Font: Hershey Simplex (see silk/stroke-font.ts header for the choice note).

import { describe, it, expect } from "vitest";
import { textToPolylines, textWidthNm } from "../silk/text-to-polylines";
import { CAP_HEIGHT_UNITS, glyphFor } from "../silk/stroke-font";
import type { SilkTextItem } from "../silk/types";
import { mmToNm } from "../units";

function item(overrides: Partial<SilkTextItem> = {}): SilkTextItem {
  return {
    kind: "text",
    id: "t1",
    layer: "silkTop",
    position: { x: 0, y: 0 },
    text: "ABC",
    heightNm: mmToNm(1),
    strokeWidthNm: 150_000,
    rotationDeg: 0,
    mirror: false,
    anchor: "left",
    ...overrides,
  };
}

function bbox(polylines: { x: number; y: number }[][]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const line of polylines) {
    for (const p of line) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  return { minX, minY, maxX, maxY };
}

describe("textToPolylines", () => {
  it("'ABC' at 1 mm: width ≈ advance sum, glyph ink inside the cap band", () => {
    const polylines = textToPolylines(item());
    expect(polylines.length).toBeGreaterThan(5); // A=3 strokes, B/C several
    const b = bbox(polylines);
    const expectedWidth = textWidthNm({ text: "ABC", heightNm: mmToNm(1) });
    // ink stays within the advance run (side bearings keep it inside)
    expect(b.minX).toBeGreaterThanOrEqual(0);
    expect(b.maxX).toBeLessThanOrEqual(expectedWidth);
    expect(expectedWidth).toBeGreaterThan(mmToNm(1.5)); // 3 caps ≈ ≥0.5 mm each
    expect(expectedWidth).toBeLessThan(mmToNm(4));
    // vertical: cap band centered on position.y → ink in [-h/2, +h/2] (no descenders in ABC)
    expect(b.minY).toBeGreaterThanOrEqual(-mmToNm(0.5) - 1);
    expect(b.maxY).toBeLessThanOrEqual(mmToNm(0.5) + 1);
  });

  it("cap height scales exactly to heightNm", () => {
    const b = bbox(textToPolylines(item({ text: "X", heightNm: mmToNm(2) })));
    expect(b.maxY - b.minY).toBe(mmToNm(2)); // X spans exactly cap-top → baseline
  });

  it("anchors shift the run: center straddles position, right ends at it", () => {
    const left = bbox(textToPolylines(item()));
    const center = bbox(textToPolylines(item({ anchor: "center" })));
    const right = bbox(textToPolylines(item({ anchor: "right" })));
    const w = textWidthNm({ text: "ABC", heightNm: mmToNm(1) });
    // anchor = pure shift of the advance run: center by −w/2, right by −w
    expect(Math.abs(center.minX - (left.minX - w / 2))).toBeLessThanOrEqual(2);
    expect(Math.abs(right.minX - (left.minX - w))).toBeLessThanOrEqual(2);
    expect(right.maxX).toBeLessThanOrEqual(0);
  });

  it("mirror flips X; rotation follows the KiCad CCW convention", () => {
    const plain = bbox(textToPolylines(item()));
    const mirrored = bbox(textToPolylines(item({ mirror: true })));
    expect(mirrored.maxX).toBeLessThanOrEqual(0);
    expect(Math.abs(mirrored.minX + plain.maxX)).toBeLessThanOrEqual(2);
    // +90° CCW on screen (+y down): ink that ran +x now runs −y (screen up)
    const rotated = bbox(textToPolylines(item({ rotationDeg: 90 })));
    expect(rotated.minY).toBeLessThan(-mmToNm(1));
    expect(rotated.maxX - rotated.minX).toBeLessThanOrEqual(mmToNm(1) + 2);
  });

  it("unknown characters fall back to '?' — never throw, never vanish", () => {
    expect(glyphFor("→").s).toEqual(glyphFor("?").s);
    const polylines = textToPolylines(item({ text: "→" }));
    expect(polylines.length).toBe(glyphFor("?").s.length);
  });

  it("every ASCII printable has a glyph; capHeight metadata is sane", () => {
    for (let c = 32; c <= 126; c++) {
      const g = glyphFor(String.fromCharCode(c));
      expect(g.a).toBeGreaterThan(0);
    }
    expect(CAP_HEIGHT_UNITS).toBeGreaterThan(10);
    expect(glyphFor(" ").s.length).toBe(0); // space is pure advance
  });
});
