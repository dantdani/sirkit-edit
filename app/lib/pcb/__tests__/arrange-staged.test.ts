import { describe, expect, it } from "vitest";
import { arrangeStagedFootprints } from "../autoplace/arrange-staged";
import { createEmptyBoard, type FootprintInstance, type PcbBoard } from "../types";
import { outlineBBoxNm } from "../render/outline";
import { footprintWorldBBox } from "../edit/arrange";
import { mmToNm } from "../units";

function footprint(id: string, ref: string, xNm: number, yNm: number): FootprintInstance {
  return {
    id, ref, footprintId: `fp-${id}`,
    at: { x: xNm, y: yNm }, rotationDeg: 0, side: "top",
    padNets: {},
    def: {
      name: `fp-${id}`,
      pads: [],
      graphics: [],
      models: [],
      bodyBBox: { minX: -mmToNm(1), minY: -mmToNm(0.6), maxX: mmToNm(1), maxY: mmToNm(0.6) },
      courtyardBBox: { minX: -mmToNm(1.2), minY: -mmToNm(0.8), maxX: mmToNm(1.2), maxY: mmToNm(0.8) },
    },
  } as unknown as FootprintInstance;
}

function boardWithStagedParts(): PcbBoard {
  const board = createEmptyBoard();
  // The durable sync plan stages new parts at x = -50mm + column*4mm.
  board.footprints.push(
    footprint("a", "C1", -mmToNm(50), 0),
    footprint("b", "R1", -mmToNm(46), 0),
    footprint("c", "U1", -mmToNm(42), 0),
  );
  return board;
}

describe("arrangeStagedFootprints (R06 Sections 9/10)", () => {
  it("moves every staged (off-board) footprint inside the outline", () => {
    const board = boardWithStagedParts();
    const outline = outlineBBoxNm(board.outline);
    for (const fp of board.footprints) expect(footprintWorldBBox(fp).maxX).toBeLessThan(outline.minX);

    const arranged = arrangeStagedFootprints(board)!;
    expect(arranged).not.toBeNull();
    for (const fp of arranged.footprints) {
      const bb = footprintWorldBBox(fp);
      expect(bb.minX).toBeGreaterThanOrEqual(outline.minX);
      expect(bb.maxX).toBeLessThanOrEqual(outline.maxX);
      expect(bb.minY).toBeGreaterThanOrEqual(outline.minY);
      expect(bb.maxY).toBeLessThanOrEqual(outline.maxY);
    }
  });

  it("is deterministic: identical input yields identical output", () => {
    const first = arrangeStagedFootprints(boardWithStagedParts())!;
    const second = arrangeStagedFootprints(boardWithStagedParts())!;
    expect(JSON.stringify(first.footprints.map((fp) => [fp.id, fp.at]))).toBe(JSON.stringify(second.footprints.map((fp) => [fp.id, fp.at])));
  });

  it("never touches footprints already on the board and returns null when nothing is staged", () => {
    const board = createEmptyBoard();
    const placed = footprint("z", "U9", mmToNm(30), mmToNm(20));
    board.footprints.push(placed);
    expect(arrangeStagedFootprints(board)).toBeNull();

    const mixed = boardWithStagedParts();
    mixed.footprints.push(footprint("keep", "J1", mmToNm(30), mmToNm(20)));
    const arranged = arrangeStagedFootprints(mixed)!;
    const kept = arranged.footprints.find((fp) => fp.id === "keep")!;
    expect(kept.at).toEqual({ x: mmToNm(30), y: mmToNm(20) });
  });

  it("does not mutate the input board (a new board object is returned)", () => {
    const board = boardWithStagedParts();
    const before = JSON.stringify(board.footprints.map((fp) => fp.at));
    const arranged = arrangeStagedFootprints(board)!;
    expect(arranged).not.toBe(board);
    expect(JSON.stringify(board.footprints.map((fp) => fp.at))).toBe(before);
  });
});
