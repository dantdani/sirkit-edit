import { describe, expect, it } from "vitest";
import { autoPlace } from "../autoplace/auto-place";
import { applyAutoPlaceCommand, buildAutoPlaceCommand, invertAutoPlaceCommand } from "../autoplace/command";
import { makeBoard, makeInstance, makeResistorDef } from "./autoplace-fixture";
import { mmToNm } from "../units";

describe("route-aware placement region", () => {
  it("expands generated placement width and height by exactly 10 percent", () => {
    const board = makeBoard(100, 80, [makeInstance("r1", makeResistorDef(), { x: 10, y: 10 })], 0);
    board.placementPolicy = { outlineSource: "generated" };
    const result = autoPlace(board, null, { maxIterations: 1, candidateCount: 1 });
    expect(result.outlineAfter).toEqual({
      kind: "rect",
      width: mmToNm(110),
      height: mmToNm(88),
      origin: { x: mmToNm(-5), y: mmToNm(-4) },
    });
    expect(result.outlineResized).toBe(true);
  });

  it("does not silently resize a user-authored outline", () => {
    const board = makeBoard(100, 80, [makeInstance("r1", makeResistorDef(), { x: 10, y: 10 })], 0);
    board.placementPolicy = { outlineSource: "user" };
    const result = autoPlace(board, null, { maxIterations: 1, candidateCount: 1 });
    expect(result.outlineAfter).toEqual(board.outline);
    expect(result.outlineResized).toBe(false);
  });

  it("applies and undoes placement plus outline expansion as one transaction", () => {
    const board = makeBoard(100, 80, [makeInstance("r1", makeResistorDef(), { x: 10, y: 10 })], 0);
    board.placementPolicy = { outlineSource: "generated" };
    const result = autoPlace(board, null, { maxIterations: 1, candidateCount: 1 });
    const command = buildAutoPlaceCommand(board, result.placements, result.outlineAfter);
    const applied = applyAutoPlaceCommand(board, command);
    expect(applied.outline).toEqual(result.outlineAfter);
    const restored = applyAutoPlaceCommand(applied, invertAutoPlaceCommand(command));
    expect(restored.outline).toEqual(board.outline);
    expect(result.routeabilityAfter).toHaveProperty("pinAccessFailures");
  });
});
