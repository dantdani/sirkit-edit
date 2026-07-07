// Rats-nest (Stage 5): MST minimality on a square net, per-net cache identity
// under `changedNets`, and bottom-side pad mirroring.

import { describe, it, expect } from "vitest";
import { computeRatsnest, padWorldPosition, type Airwire } from "../ratsnest";
import type { FootprintDef, FootprintInstance, PcbBoard } from "../types";
import { createEmptyBoard } from "../types";
import { mmToNm, NM_PER_MM } from "../units";

/** Single-pad def; the pad sits at a local offset so transforms matter. */
function makeDef(padOffsetMmX = 0): FootprintDef {
  return {
    libName: "Test",
    name: "TP",
    attributes: { smd: true, throughHole: false, excludeFromPos: false, excludeFromBom: false },
    pads: [
      {
        number: "1",
        type: "smd",
        shape: { kind: "circle", radius: mmToNm(0.5) },
        at: { x: mmToNm(padOffsetMmX), y: 0 },
        rotationDeg: 0,
        layers: ["copperTop", "maskTop"],
      },
    ],
    graphics: [],
    bodyBBox: { minX: -mmToNm(1), minY: -mmToNm(1), maxX: mmToNm(1), maxY: mmToNm(1) },
    models: [],
    rawSexpr: "",
  };
}

function makeInst(
  id: string,
  xMm: number,
  yMm: number,
  netId: number,
  overrides: Partial<FootprintInstance> = {},
): FootprintInstance {
  return {
    id,
    ref: id.toUpperCase(),
    footprintId: "Test:TP",
    def: makeDef(),
    at: { x: mmToNm(xMm), y: mmToNm(yMm) },
    rotationDeg: 0,
    side: "top",
    padNets: { "1": netId },
    ...overrides,
  };
}

function makeBoard(footprints: FootprintInstance[], netIds: number[]): PcbBoard {
  return {
    ...createEmptyBoard(),
    nets: [{ id: 0, name: "" }, ...netIds.map((id) => ({ id, name: `N${id}` }))],
    footprints,
  };
}

function totalLengthMm(wires: Airwire[]): number {
  return wires.reduce(
    (sum, w) => sum + Math.hypot(w.to.x - w.from.x, w.to.y - w.from.y) / NM_PER_MM,
    0,
  );
}

describe("computeRatsnest", () => {
  it("connects a 4-pad square net with 3 airwires of minimal total length", () => {
    const board = makeBoard(
      [
        makeInst("a", 10, 10, 1),
        makeInst("b", 20, 10, 1),
        makeInst("c", 20, 20, 1),
        makeInst("d", 10, 20, 1),
      ],
      [1],
    );
    const wires = computeRatsnest(board);
    expect(wires).toHaveLength(3);
    // MST of a 10 mm square is three sides = 30 mm. The worst chain that still
    // spans all 4 pads includes a diagonal: 10 + 10 + 10·√2 ≈ 34.14 mm.
    expect(totalLengthMm(wires)).toBeCloseTo(30, 6);
    expect(totalLengthMm(wires)).toBeLessThan(20 + 10 * Math.SQRT2);
  });

  it("produces nothing for nets with fewer than 2 pads and for net 0", () => {
    const board = makeBoard(
      [
        makeInst("a", 10, 10, 1), // net 1 has one pad only
        makeInst("b", 20, 10, 0), // net 0 = unconnected, always ignored
        makeInst("c", 30, 10, 0),
      ],
      [1],
    );
    expect(computeRatsnest(board)).toHaveLength(0);
  });

  it("returns cached airwire identities for nets not in changedNets", () => {
    const board = makeBoard(
      [
        makeInst("a", 10, 10, 1),
        makeInst("b", 20, 10, 1),
        makeInst("c", 40, 40, 2),
        makeInst("d", 50, 40, 2),
        makeInst("e", 50, 50, 2),
      ],
      [1, 2],
    );
    const first = computeRatsnest(board); // full compute seeds the cache
    const net2Before = first.filter((w) => w.netId === 2);
    expect(net2Before).toHaveLength(2);

    // Move instance "a" (net 1 only) and recompute just net 1.
    const moved: PcbBoard = {
      ...board,
      footprints: board.footprints.map((f) =>
        f.id === "a" ? { ...f, at: { x: mmToNm(15), y: mmToNm(30) } } : f,
      ),
    };
    const second = computeRatsnest(moved, [1]);

    const net2After = second.filter((w) => w.netId === 2);
    expect(net2After).toHaveLength(2);
    // Same object identity — the untouched net came straight from the cache.
    net2After.forEach((w, i) => expect(w).toBe(net2Before[i]));

    // The changed net was actually recomputed.
    const net1 = second.filter((w) => w.netId === 1);
    expect(net1).toHaveLength(1);
    expect(net1[0].from.y === mmToNm(30) || net1[0].to.y === mmToNm(30)).toBe(true);
  });

  it("a full compute (no changedNets) drops all cached identities", () => {
    const board = makeBoard(
      [makeInst("a", 10, 10, 1), makeInst("b", 20, 10, 1)],
      [1],
    );
    const first = computeRatsnest(board);
    const second = computeRatsnest(board);
    expect(second).toEqual(first);
    expect(second[0]).not.toBe(first[0]);
  });
});

describe("padWorldPosition", () => {
  const withOffset = (over: Partial<FootprintInstance>): FootprintInstance => ({
    ...makeInst("a", 10, 10, 1),
    def: makeDef(1), // pad at local (+1 mm, 0)
    ...over,
  });

  it("mirrors X in footprint-local space for bottom-side instances", () => {
    const top = withOffset({ side: "top" });
    const bottom = withOffset({ side: "bottom" });
    expect(padWorldPosition(top, top.def.pads[0])).toEqual({
      x: mmToNm(11),
      y: mmToNm(10),
    });
    expect(padWorldPosition(bottom, bottom.def.pads[0])).toEqual({
      x: mmToNm(9),
      y: mmToNm(10),
    });
  });

  it("applies mirror BEFORE rotation (mirror is footprint-local)", () => {
    // Local (+1, 0) → mirrored (−1, 0) → rotated +90° CCW (+y down): (0, +1).
    const inst = withOffset({ side: "bottom", rotationDeg: 90 });
    expect(padWorldPosition(inst, inst.def.pads[0])).toEqual({
      x: mmToNm(10),
      y: mmToNm(11),
    });
  });

  it("feeds mirrored positions into bottom-side airwires", () => {
    const a = withOffset({ side: "bottom" }); // pad at (9, 10)
    const b = { ...makeInst("b", 20, 10, 1) }; // pad at (20, 10)
    const board = makeBoard([a, b], [1]);
    const wires = computeRatsnest(board);
    expect(wires).toHaveLength(1);
    expect(totalLengthMm(wires)).toBeCloseTo(11, 6);
  });
});
