// Thermal spokes (PCB Stage 11). Rotation convention is Stage 1's: positive
// angles are CCW on screen with +y DOWN, so a +45° spoke points up-right
// (dx > 0, dy < 0).

import { describe, expect, it } from "vitest";
import { mmToNm } from "../units";
import type { Vec2 } from "../geometry";
import type { Pad } from "../types";
import { generateThermalSpokes } from "../zones/thermals";

const mm = (v: number): number => mmToNm(v);

function circlePad(radiusNm: number): Pad {
  return {
    number: "1",
    type: "smd",
    shape: { kind: "circle", radius: radiusNm },
    at: { x: 0, y: 0 },
    rotationDeg: 0,
    layers: ["copperTop"],
  };
}

function centroid(poly: Vec2[]): Vec2 {
  let x = 0;
  let y = 0;
  for (const p of poly) {
    x += p.x;
    y += p.y;
  }
  return { x: x / poly.length, y: y / poly.length };
}

const PARAMS = { spokeWidthNm: 250_000, gapNm: 100_000, spokes: 4 as const, angleOffsetDeg: 45 };
const CENTER: Vec2 = { x: mm(10), y: mm(10) };

describe("generateThermalSpokes", () => {
  it("(a) 4 spokes at 45° offset → rectangles pointing 45°/135°/225°/315°", () => {
    const spokes = generateThermalSpokes(circlePad(mm(0.5)), CENTER, 0, PARAMS);
    expect(spokes).toHaveLength(4);
    for (const s of spokes) expect(s).toHaveLength(4);
    // Quadrant of each spoke centroid relative to the pad center, in order:
    // 45° (right-up), 135° (left-up), 225° (left-down), 315° (right-down).
    const quads = spokes.map((s) => {
      const c = centroid(s);
      return [Math.sign(c.x - CENTER.x), Math.sign(c.y - CENTER.y)];
    });
    expect(quads).toEqual([
      [1, -1],
      [-1, -1],
      [-1, 1],
      [1, 1],
    ]);
  });

  it("(b) 2 spokes at 0° → horizontal only", () => {
    const spokes = generateThermalSpokes(circlePad(mm(0.5)), CENTER, 0, {
      ...PARAMS,
      spokes: 2,
      angleOffsetDeg: 0,
    });
    expect(spokes).toHaveLength(2);
    const half = PARAMS.spokeWidthNm / 2;
    for (const s of spokes) {
      for (const p of s) {
        expect(Math.abs(p.y - CENTER.y)).toBeLessThanOrEqual(half);
      }
    }
    expect(centroid(spokes[0]).x).toBeGreaterThan(CENTER.x); // 0° → +x
    expect(centroid(spokes[1]).x).toBeLessThan(CENTER.x); // 180° → −x
  });

  it("(c) spoke width and length match the params exactly", () => {
    const padR = mm(0.5);
    const spokes = generateThermalSpokes(circlePad(padR), CENTER, 0, {
      ...PARAMS,
      spokes: 2,
      angleOffsetDeg: 0,
    });
    const s = spokes[0]; // 0° spoke: axis-aligned rectangle
    const minX = Math.min(...s.map((p) => p.x));
    const maxX = Math.max(...s.map((p) => p.x));
    const minY = Math.min(...s.map((p) => p.y));
    const maxY = Math.max(...s.map((p) => p.y));
    expect(maxY - minY).toBe(PARAMS.spokeWidthNm); // width
    expect(minX).toBe(CENTER.x); // starts at the pad center
    expect(maxX - CENTER.x).toBe(padR + 2 * PARAMS.gapNm); // outer bound + 2·gap
  });

  it("pad world rotation rotates the spokes with it", () => {
    const spokes = generateThermalSpokes(circlePad(mm(0.5)), CENTER, 45, {
      ...PARAMS,
      spokes: 2,
      angleOffsetDeg: 0,
    });
    // 0° + 45° world → up-right.
    const c = centroid(spokes[0]);
    expect(c.x).toBeGreaterThan(CENTER.x);
    expect(c.y).toBeLessThan(CENTER.y);
  });
});
