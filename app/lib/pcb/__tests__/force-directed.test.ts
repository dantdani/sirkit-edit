// Force-directed core (Stage 8): spring rest-length convergence, repulsion
// separation, and the locked-footprint invariant. Pure — no Pixi/React.

import { describe, it, expect } from "vitest";
import type { PcbBoard } from "../types";
import { mmToNm } from "../units";
import { runForceDirected, type ForceDirectedInput } from "../autoplace/force-directed";
import { resolveParams, type AutoPlaceParams, type FootprintPlacement } from "../autoplace/types";
import { localCourtyardBBox } from "../autoplace/geometry";
import { makeBoard, makeInstance, makeResistorDef, type LockableInstance } from "./autoplace-fixture";

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

function run(board: PcbBoard, params: AutoPlaceParams = {}): ReturnType<typeof runForceDirected> {
  const input: ForceDirectedInput = {
    board,
    footprints: placementsOf(board),
    params: resolveParams(params, 42),
  };
  return runForceDirected(input);
}

const distMm = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
  Math.hypot(a.x - b.x, a.y - b.y) / 1_000_000;

describe("runForceDirected", () => {
  it("pulls two footprints on one net to the spring rest length (±10%)", () => {
    const def = makeResistorDef();
    const board = makeBoard(
      100,
      80,
      [
        makeInstance("a", def, { x: 20, y: 40 }, { "1": 1 }),
        makeInstance("b", def, { x: 50, y: 40 }, { "1": 1 }),
      ],
      1,
    );
    const r = run(board);
    const d = distMm(r.positions.get("a")!, r.positions.get("b")!);
    expect(d).toBeGreaterThanOrEqual(4.5); // rest length 5 mm ± 10%
    expect(d).toBeLessThanOrEqual(5.5);
    expect(r.converged).toBe(true);
  });

  it("repulsion drifts two disconnected footprints apart, never closer than 5 mm", () => {
    const def = makeResistorDef();
    const board = makeBoard(
      100,
      80,
      [
        // Overlapping courtyards, no shared net → only repulsion acts.
        makeInstance("a", def, { x: 49.5, y: 40 }),
        makeInstance("b", def, { x: 50.5, y: 40 }),
      ],
      0,
    );
    // Pinned default repulsionK is deliberately gentle (collision resolution
    // owns hard separation); boost it here to exercise the repulsion path.
    const r = run(board, { repulsionK: 4e16 });
    const d = distMm(r.positions.get("a")!, r.positions.get("b")!);
    expect(d).toBeGreaterThanOrEqual(5);
  });

  it("a locked footprint's position at iteration 400 equals its initial position exactly", () => {
    const def = makeResistorDef();
    const board = makeBoard(
      100,
      80,
      [
        makeInstance("anchor", def, { x: 30, y: 40 }, { "1": 1 }, { locked: true }),
        makeInstance("mover", def, { x: 70, y: 40 }, { "1": 1 }),
      ],
      1,
    );
    const before = distMm({ x: mmToNm(30), y: mmToNm(40) }, { x: mmToNm(70), y: mmToNm(40) });
    // Convergence disabled so the full 400 iterations run.
    const r = run(board, { convergenceThresholdNm: 0 });
    expect(r.iterations).toBe(400);
    expect(r.positions.get("anchor")).toEqual({ x: mmToNm(30), y: mmToNm(40) });
    const after = distMm(r.positions.get("anchor")!, r.positions.get("mover")!);
    expect(after).toBeLessThan(before); // the mover came to the anchor
    expect(after).toBeLessThanOrEqual(5.5);
  });

  it("is deterministic: identical inputs produce identical positions", () => {
    const def = makeResistorDef();
    const board = makeBoard(
      100,
      80,
      [
        // Off-board start → exercises the seeded-jitter grid path.
        makeInstance("a", def, { x: -20, y: 10 }, { "1": 1 }),
        makeInstance("b", def, { x: -20, y: 22 }, { "1": 1 }),
      ],
      1,
    );
    const r1 = run(board);
    const r2 = run(board);
    expect([...r1.positions.entries()]).toEqual([...r2.positions.entries()]);
  });
});
