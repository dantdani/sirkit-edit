// PCB history stack (Stage 5): execute/undo/redo round-trips, the 200-entry
// cap, transient/execute coalescing, and a seeded random-gesture soak.

import { describe, it, expect, vi } from "vitest";
import { createHistory } from "../history";
import type { FootprintDef, FootprintInstance, PcbBoard } from "../types";
import { createEmptyBoard } from "../types";
import { mmToNm } from "../units";

function makeDef(): FootprintDef {
  return {
    libName: "Test",
    name: "R_test",
    attributes: { smd: true, throughHole: false, excludeFromPos: false, excludeFromBom: false },
    pads: [
      {
        number: "1",
        type: "smd",
        shape: { kind: "rect", width: mmToNm(1), height: mmToNm(1) },
        at: { x: -mmToNm(1), y: 0 },
        rotationDeg: 0,
        layers: ["copperTop", "maskTop"],
      },
      {
        number: "2",
        type: "smd",
        shape: { kind: "rect", width: mmToNm(1), height: mmToNm(1) },
        at: { x: mmToNm(1), y: 0 },
        rotationDeg: 0,
        layers: ["copperTop", "maskTop"],
      },
    ],
    graphics: [],
    bodyBBox: {
      minX: -mmToNm(1.5),
      minY: -mmToNm(0.5),
      maxX: mmToNm(1.5),
      maxY: mmToNm(0.5),
    },
    models: [],
    rawSexpr: "",
  };
}

function makeBoard(count: number): PcbBoard {
  const def = makeDef();
  const board = createEmptyBoard();
  const footprints: FootprintInstance[] = [];
  for (let i = 0; i < count; i++) {
    footprints.push({
      id: `fp-${i}`,
      ref: `R${i + 1}`,
      footprintId: "Test:R_test",
      def,
      at: { x: mmToNm(10 + (i % 8) * 5), y: mmToNm(10 + Math.floor(i / 8) * 5) },
      rotationDeg: 0,
      side: "top",
      padNets: { "1": i + 1, "2": ((i + 1) % count) + 1 },
    });
  }
  return { ...board, footprints };
}

/** Deterministic PRNG (mulberry32) for the gesture soak. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("createHistory", () => {
  it("execute → undo → redo restores deep-equal boards", () => {
    const initial = makeBoard(3);
    const h = createHistory(initial);
    const before = JSON.parse(JSON.stringify(h.present)) as PcbBoard;

    h.execute("Move R1", (d) => {
      d.footprints[0].at = { x: mmToNm(42), y: mmToNm(24) };
      d.footprints[0].rotationDeg = 270;
    });
    const after = JSON.parse(JSON.stringify(h.present)) as PcbBoard;
    expect(h.present.footprints[0].at.x).toBe(mmToNm(42));

    h.undo();
    expect(h.present).toEqual(before);
    expect(h.canRedo).toBe(true);

    h.redo();
    expect(h.present).toEqual(after);
  });

  it("caps at 200 entries, evicting the oldest", () => {
    const h = createHistory(makeBoard(1));
    for (let i = 0; i < 205; i++) {
      h.execute(`Nudge ${i}`, (d) => {
        d.footprints[0].at = { x: d.footprints[0].at.x + 1, y: d.footprints[0].at.y };
      });
    }
    const finalX = h.present.footprints[0].at.x;
    let undos = 0;
    while (h.canUndo) {
      h.undo();
      undos++;
    }
    expect(undos).toBe(200);
    // The 5 oldest entries were evicted — their +1s are baked in forever.
    expect(h.present.footprints[0].at.x).toBe(finalX - 200);
  });

  it("transient frames + one execute yield ONE entry whose undo restores the pre-transient state", () => {
    const h = createHistory(makeBoard(2));
    const before = JSON.parse(JSON.stringify(h.present)) as PcbBoard;

    // Simulated drag: many transient frames…
    for (let frame = 1; frame <= 10; frame++) {
      h.transient((d) => {
        d.footprints[0].at = { x: mmToNm(frame), y: mmToNm(frame) };
      });
    }
    expect(h.present.footprints[0].at.x).toBe(mmToNm(10));
    expect(h.canUndo).toBe(false); // no entries recorded during the drag

    // …then a single drop commit.
    h.execute("Move R1", (d) => {
      d.footprints[0].at = { x: mmToNm(10), y: mmToNm(10) };
    });
    expect(h.canUndo).toBe(true);

    h.undo();
    expect(h.present).toEqual(before);
    expect(h.canUndo).toBe(false); // exactly one entry existed
  });

  it("undo during uncommitted transient edits discards them first", () => {
    const h = createHistory(makeBoard(1));
    const start = JSON.parse(JSON.stringify(h.present)) as PcbBoard;
    h.execute("Move R1", (d) => {
      d.footprints[0].at = { x: 111, y: 222 };
    });
    h.transient((d) => {
      d.footprints[0].at = { x: 999, y: 999 };
    });
    h.undo(); // drops the transient preview AND undoes the move
    expect(h.present).toEqual(start);
  });

  it("notifies subscribers on execute/undo/redo but never on transient", () => {
    const h = createHistory(makeBoard(1));
    const cb = vi.fn();
    const unsubscribe = h.subscribe(cb);

    h.transient((d) => {
      d.footprints[0].at = { x: 1, y: 1 };
    });
    expect(cb).not.toHaveBeenCalled();

    h.execute("Move R1", (d) => {
      d.footprints[0].at = { x: 2, y: 2 };
    });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenLastCalledWith(h.present, { label: "Move R1" });

    h.undo();
    h.redo();
    expect(cb).toHaveBeenCalledTimes(3);

    unsubscribe();
    h.undo();
    expect(cb).toHaveBeenCalledTimes(3);
  });

  it("25 seeded random gestures then 25 undos deep-equal the starting board", () => {
    const rand = mulberry32(0x5eed);
    const h = createHistory(makeBoard(10));
    const start = JSON.parse(JSON.stringify(h.present)) as PcbBoard;

    for (let g = 0; g < 25; g++) {
      const idx = Math.floor(rand() * 10);
      const kind = Math.floor(rand() * 3);
      if (kind === 0) {
        // Drag: transient frames then a drop commit.
        const tx = Math.round(rand() * 100) * mmToNm(0.5);
        const ty = Math.round(rand() * 100) * mmToNm(0.5);
        for (let f = 0; f < 5; f++) {
          h.transient((d) => {
            d.footprints[idx].at = { x: Math.round(tx * (f / 5)), y: Math.round(ty * (f / 5)) };
          });
        }
        h.execute("Move", (d) => {
          d.footprints[idx].at = { x: tx, y: ty };
        });
      } else if (kind === 1) {
        h.execute("Rotate", (d) => {
          d.footprints[idx].rotationDeg = (d.footprints[idx].rotationDeg - 90 + 360) % 360;
        });
      } else {
        h.execute("Flip", (d) => {
          const fp = d.footprints[idx];
          fp.side = fp.side === "top" ? "bottom" : "top";
          fp.rotationDeg = (360 - fp.rotationDeg) % 360;
        });
      }
    }

    for (let i = 0; i < 25; i++) h.undo();
    expect(h.canUndo).toBe(false);
    expect(h.present).toEqual(start);
  });
});
