// Rotation optimization (Stage 8): pad-to-connected-centroid scoring picks the
// orientation that shortens airwires; locked footprints are skipped.

import { describe, it, expect } from "vitest";
import type { PcbBoard } from "../types";
import type { Vec2 } from "../geometry";
import { optimizeRotations, snapRotation } from "../autoplace/rotation";
import { makeBoard, makeDef, makeInstance, makePad, makeResistorDef } from "./autoplace-fixture";

/** Identity position map — optimize rotations in place. */
function positionsOf(board: PcbBoard): Map<string, Vec2> {
  return new Map(board.footprints.map((f) => [f.id, { ...f.at }]));
}

const targetDef = makeDef("PAD_TEST", 2, 2, [makePad("1", 0, 0)]);

describe("optimizeRotations", () => {
  it("keeps 0° when pin 2 already faces its connected footprint to the east", () => {
    const board = makeBoard(
      100,
      80,
      [
        // Resistor: pin 1 left (−0.9 mm), pin 2 right (+0.9 mm). Net 1 ties
        // pin 2 to a footprint 10 mm east — 0° is already correct.
        makeInstance("r1", makeResistorDef(), { x: 40, y: 40 }, { "2": 1 }),
        makeInstance("t1", targetDef, { x: 50, y: 40 }, { "1": 1 }),
      ],
      1,
    );
    const rot = optimizeRotations(board, positionsOf(board), new Set());
    expect(rot.get("r1")).toBe(0);
  });

  it("flips to 180° when the connected footprint is west instead", () => {
    const board = makeBoard(
      100,
      80,
      [
        makeInstance("r1", makeResistorDef(), { x: 40, y: 40 }, { "2": 1 }),
        makeInstance("t1", targetDef, { x: 30, y: 40 }, { "1": 1 }),
      ],
      1,
    );
    const rot = optimizeRotations(board, positionsOf(board), new Set());
    expect(rot.get("r1")).toBe(180);
  });

  it("picks 90°/270° for vertical neighbors (KiCad CCW convention, +y down)", () => {
    // Connected footprint due NORTH (−y). Pin 2 (+x) lands at (0, −0.9) under
    // +90° CCW — so 90° must win.
    const board = makeBoard(
      100,
      80,
      [
        makeInstance("r1", makeResistorDef(), { x: 40, y: 40 }, { "2": 1 }),
        makeInstance("t1", targetDef, { x: 40, y: 30 }, { "1": 1 }),
      ],
      1,
    );
    const rot = optimizeRotations(board, positionsOf(board), new Set());
    expect(rot.get("r1")).toBe(90);
  });

  it("skips locked footprints — they keep their existing rotation", () => {
    const board = makeBoard(
      100,
      80,
      [
        makeInstance("r1", makeResistorDef(), { x: 40, y: 40 }, { "2": 1 }, { rotationDeg: 90, locked: true }),
        makeInstance("t1", targetDef, { x: 50, y: 40 }, { "1": 1 }),
      ],
      1,
    );
    const rot = optimizeRotations(board, positionsOf(board), new Set(["r1"]));
    expect(rot.has("r1")).toBe(false);
  });

  it("snaps unconnected footprints to the nearest axis rotation", () => {
    const board = makeBoard(100, 80, [makeInstance("r1", makeResistorDef(), { x: 40, y: 40 })], 0);
    const rot = optimizeRotations(board, positionsOf(board), new Set());
    expect(rot.get("r1")).toBe(0);
    expect(snapRotation(87)).toBe(90);
    expect(snapRotation(-90)).toBe(270);
    expect(snapRotation(359)).toBe(0);
  });
});
