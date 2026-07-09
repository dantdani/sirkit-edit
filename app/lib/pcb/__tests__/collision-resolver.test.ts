// Collision resolver (Stage 8): grid snap, boundary hard-clip, greedy nudge,
// BFS spiral fallback — and the never-throw-on-crowding guarantee.

import { describe, it, expect, vi, afterEach } from "vitest";
import type { PcbBoard } from "../types";
import { mmToNm } from "../units";
import { resolveCollisions } from "../autoplace/collision-resolver";
import type { FootprintPlacement } from "../autoplace/types";
import { bboxesOverlap, courtyardFitsOutline, localCourtyardBBox, worldCourtyardBBox } from "../autoplace/geometry";
import { makeBoard, makeDef, makeInstance, makeResistorDef, type LockableInstance } from "./autoplace-fixture";

const GRID = 100_000; // 100 μm

function placementsOf(board: PcbBoard): FootprintPlacement[] {
  return board.footprints.map((inst) => ({
    id: inst.id,
    position: { ...inst.at },
    rotationDeg: inst.rotationDeg,
    side: inst.side,
    courtyardLocal: localCourtyardBBox(inst.def),
    locked: (inst as LockableInstance).locked === true,
  }));
}

function worldBoxes(placements: FootprintPlacement[]) {
  return placements.map((p) =>
    worldCourtyardBBox(p.courtyardLocal, p.position, p.rotationDeg, p.side === "bottom"),
  );
}

function overlapCount(placements: FootprintPlacement[]): number {
  const boxes = worldBoxes(placements);
  let count = 0;
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (bboxesOverlap(boxes[i], boxes[j])) count++;
    }
  }
  return count;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveCollisions", () => {
  it("separates two footprints stacked on the same position", () => {
    const def = makeResistorDef();
    const board = makeBoard(
      100,
      80,
      [makeInstance("a", def, { x: 50, y: 40 }), makeInstance("b", def, { x: 50, y: 40 })],
      0,
    );
    const r = resolveCollisions(board, placementsOf(board), GRID);
    expect(overlapCount(r.placements)).toBe(0);
    expect(r.collisionsResolved).toBeGreaterThan(0);
    for (const p of r.placements) {
      expect(p.position.x % GRID).toBe(0); // grid-snapped
      expect(p.position.y % GRID).toBe(0);
      expect(
        courtyardFitsOutline(
          worldCourtyardBBox(p.courtyardLocal, p.position, p.rotationDeg, false),
          board.outline,
        ),
      ).toBe(true);
    }
  });

  it("preserves relative order: A left of B stays left of B after nudging", () => {
    const def = makeResistorDef();
    const board = makeBoard(
      100,
      80,
      [makeInstance("a", def, { x: 49, y: 40 }), makeInstance("b", def, { x: 50, y: 40 })],
      0,
    );
    const r = resolveCollisions(board, placementsOf(board), GRID);
    const a = r.placements.find((p) => p.id === "a")!;
    const b = r.placements.find((p) => p.id === "b")!;
    expect(overlapCount(r.placements)).toBe(0);
    expect(a.position.x).toBeLessThan(b.position.x);
  });

  it("clips footprints outside the outline back onto the board", () => {
    const def = makeResistorDef();
    const board = makeBoard(100, 80, [makeInstance("a", def, { x: -20, y: 40 })], 0);
    const r = resolveCollisions(board, placementsOf(board), GRID);
    expect(r.footprintsClippedToBoundary).toBe(1);
    const box = worldCourtyardBBox(r.placements[0].courtyardLocal, r.placements[0].position, 0, false);
    expect(courtyardFitsOutline(box, board.outline)).toBe(true);
  });

  it("locked footprints are untouched and act as obstacles", () => {
    const def = makeResistorDef();
    const at = { x: mmToNm(50.05), y: mmToNm(40) }; // off-grid on purpose
    const board = makeBoard(
      100,
      80,
      [
        makeInstance("anchor", def, { x: 50.05, y: 40 }, {}, { locked: true }),
        makeInstance("mover", def, { x: 50, y: 40 }),
      ],
      0,
    );
    const r = resolveCollisions(board, placementsOf(board), GRID);
    const anchor = r.placements.find((p) => p.id === "anchor")!;
    expect(anchor.position).toEqual(at); // not snapped, not moved
    expect(overlapCount(r.placements)).toBe(0);
  });

  it("crammed board: BFS spiral fires, warns on the unresolvable tail, never throws", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const def = makeDef("BIG", 5, 5, []);
    // 20 × 25 mm² of courtyard into a 20×20 mm board (400 mm²) — impossible
    // to fully resolve; the guarantee is graceful degradation, not magic.
    const board = makeBoard(
      20,
      20,
      Array.from({ length: 20 }, (_, i) =>
        makeInstance(`fp-${String(i).padStart(2, "0")}`, def, { x: 10, y: 10 }),
      ),
      0,
    );
    let result: ReturnType<typeof resolveCollisions> | null = null;
    expect(() => {
      result = resolveCollisions(board, placementsOf(board), GRID);
    }).not.toThrow();
    expect(result!.placements).toHaveLength(20);
    expect(result!.collisionsResolved).toBeGreaterThan(0);
    expect(warn).toHaveBeenCalled();
    // Even the unresolved tail stays inside the outline.
    for (const p of result!.placements) {
      const box = worldCourtyardBBox(p.courtyardLocal, p.position, p.rotationDeg, false);
      expect(courtyardFitsOutline(box, board.outline)).toBe(true);
    }
  });

  it("throws a clear error when a footprint is larger than the board", () => {
    const def = makeDef("HUGE", 30, 30, []);
    const board = makeBoard(20, 20, [makeInstance("a", def, { x: 10, y: 10 })], 0);
    expect(() => resolveCollisions(board, placementsOf(board), GRID)).toThrow(/larger than the board/);
  });
});
