// makePlaneZone (PCB Stage 11): a plane is a zone whose polygon is the board
// outline — no separate model.

import { describe, expect, it } from "vitest";
import { mmToNm } from "../units";
import { createEmptyBoard } from "../types";
import { makePlaneZone } from "../zones/plane";

describe("makePlaneZone", () => {
  it("returns a board-outline zone on the requested inner layer", () => {
    const board = createEmptyBoard(); // 100×80 rect at origin
    board.stackup = 4;
    board.nets.push({ id: 7, name: "GND" });

    const zone = makePlaneZone(board, "in1", 7);
    expect(zone.layer).toBe("in1");
    expect(zone.netId).toBe(7);
    expect(zone.connection).toBe("thermal");
    expect(zone.appearance).toBe("solid");
    expect(zone.dirty).toBe(true);
    expect(zone.fill).toEqual([]);
    expect(zone.polygon).toEqual([
      { x: 0, y: 0 },
      { x: mmToNm(100), y: 0 },
      { x: mmToNm(100), y: mmToNm(80) },
      { x: 0, y: mmToNm(80) },
    ]);
  });

  it("honors appearance/connection options and generates unique ids", () => {
    const board = createEmptyBoard();
    const a = makePlaneZone(board, "copperBottom", 1, { appearance: "hatched", connection: "solid" });
    const b = makePlaneZone(board, "copperBottom", 1);
    expect(a.appearance).toBe("hatched");
    expect(a.connection).toBe("solid");
    expect(a.id).not.toBe(b.id);
  });

  it("rejects non-copper layers", () => {
    const board = createEmptyBoard();
    expect(() => makePlaneZone(board, "silkTop", 1)).toThrow(/copper/);
  });
});
