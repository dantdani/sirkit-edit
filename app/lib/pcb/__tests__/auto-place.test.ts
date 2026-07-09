// End-to-end auto-place (Stage 8): the fixture contract — collision-free,
// inside the outline, ≥ 60% rats-nest reduction, deterministic, < 500 ms.

import { describe, it, expect } from "vitest";
import type { PcbBoard } from "../types";
import { autoPlace, isLocked } from "../autoplace/auto-place";
import type { AutoPlaceResult } from "../autoplace/types";
import {
  bboxesOverlap,
  courtyardFitsOutline,
  localCourtyardBBox,
  worldCourtyardBBox,
} from "../autoplace/geometry";
import { buildFixtureBoard30, buildFixtureBoard100, type LockableInstance } from "./autoplace-fixture";

/** World courtyard boxes of the board AFTER applying a result. */
function finalBoxes(board: PcbBoard, result: AutoPlaceResult) {
  return board.footprints.map((inst) => {
    const p = result.placements.get(inst.id);
    const at = p?.position ?? inst.at;
    const rot = p?.rotationDeg ?? inst.rotationDeg;
    return worldCourtyardBBox(localCourtyardBBox(inst.def), at, rot, inst.side === "bottom");
  });
}

function assertCollisionFreeInsideOutline(board: PcbBoard, result: AutoPlaceResult): void {
  const boxes = finalBoxes(board, result);
  for (let i = 0; i < boxes.length; i++) {
    expect(courtyardFitsOutline(boxes[i], board.outline)).toBe(true);
    for (let j = i + 1; j < boxes.length; j++) {
      expect(bboxesOverlap(boxes[i], boxes[j])).toBe(false);
    }
  }
}

const serialize = (r: AutoPlaceResult): string =>
  JSON.stringify([...r.placements.entries()].sort(([a], [b]) => a.localeCompare(b)));

describe("autoPlace", () => {
  it("30-footprint fixture: collision-free, inside outline, rats-nest −60%+", () => {
    const board = buildFixtureBoard30();
    const result = autoPlace(board, null);

    expect(result.placements.size).toBe(30); // every footprint placed
    assertCollisionFreeInsideOutline(board, result);

    const { initialRatsnestLengthNm: before, finalRatsnestLengthNm: after } = result.stats;
    expect(before).toBeGreaterThan(0);
    const reduction = (before - after) / before;
    expect(reduction).toBeGreaterThanOrEqual(0.6);
  });

  it("is deterministic: two runs produce identical placements", () => {
    const board = buildFixtureBoard30();
    expect(serialize(autoPlace(board, null))).toBe(serialize(autoPlace(board, null)));
  });

  it("30-footprint fixture completes in under 500 ms", () => {
    const board = buildFixtureBoard30();
    const result = autoPlace(board, null);
    expect(result.stats.elapsedMs).toBeLessThan(500);
  });

  it("respects locked footprints: never moved, never overlapped", () => {
    const board = buildFixtureBoard30();
    (board.footprints[5] as LockableInstance).locked = true;
    const locked = board.footprints[5];
    expect(isLocked(locked)).toBe(true);

    const result = autoPlace(board, null);
    expect(result.placements.has(locked.id)).toBe(false); // omitted from the result
    expect(result.placements.size).toBe(29);
    assertCollisionFreeInsideOutline(board, result); // includes the locked box as an obstacle
  });

  it("100-footprint synthetic board: still collision-free and inside the outline", () => {
    const board = buildFixtureBoard100();
    const result = autoPlace(board, null);
    expect(result.placements.size).toBe(100);
    assertCollisionFreeInsideOutline(board, result);
    // Goal < 2000 ms — logged, not asserted (CI machines vary).
    console.log(
      `auto-place 100 footprints: ${result.stats.elapsedMs}ms, ` +
        `${result.stats.iterations} iterations (converged=${result.stats.converged}), ` +
        `rats-nest ${Math.round(
          (1 - result.stats.finalRatsnestLengthNm / result.stats.initialRatsnestLengthNm) * 100,
        )}% shorter`,
    );
  });

  it("empty board is a clean no-op", () => {
    const board = buildFixtureBoard30();
    const empty: PcbBoard = { ...board, footprints: [] };
    const result = autoPlace(empty, null);
    expect(result.placements.size).toBe(0);
    expect(result.stats.converged).toBe(true);
  });
});
