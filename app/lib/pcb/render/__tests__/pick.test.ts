import { describe, it, expect } from "vitest";
import { buildPickIndex, type PickEntry, type PickResult } from "../pick";
import { mmToNm } from "../../units";

/**
 * Synthetic 1,000-entry index: a 40×25 grid of 2×2 mm footprint boxes on a
 * 3 mm pitch (so boxes never touch). Entry (col, row) spans
 * [col*3, col*3+2] × [row*3, row*3+2] mm with id `fp-<row*40+col>`.
 */
function syntheticEntries(): PickEntry[] {
  const entries: PickEntry[] = [];
  for (let row = 0; row < 25; row++) {
    for (let col = 0; col < 40; col++) {
      entries.push({
        result: { kind: "footprint", id: `fp-${row * 40 + col}` },
        bbox: {
          minX: mmToNm(col * 3),
          minY: mmToNm(row * 3),
          maxX: mmToNm(col * 3 + 2),
          maxY: mmToNm(row * 3 + 2),
        },
      });
    }
  }
  return entries;
}

function idOf(r: PickResult | null): string | null {
  return r?.kind === "footprint" ? r.id : null;
}

describe("buildPickIndex", () => {
  const index = buildPickIndex(syntheticEntries());

  it("known point hits the expected id", () => {
    // Centre of entry (col 7, row 3) = (22, 10) mm → id fp-127.
    expect(idOf(index.pickAt({ x: mmToNm(22), y: mmToNm(10) }))).toBe("fp-127");
    // Corner containment is inclusive.
    expect(idOf(index.pickAt({ x: mmToNm(21), y: mmToNm(9) }))).toBe("fp-127");
  });

  it("empty point misses", () => {
    // (2.5, 2.5) mm is in the 1 mm gutter between boxes.
    expect(index.pickAt({ x: mmToNm(2.5), y: mmToNm(2.5) })).toBeNull();
    expect(index.pickAt({ x: mmToNm(-50), y: mmToNm(-50) })).toBeNull();
  });

  it("pickIn marquee returns the exact contained set", () => {
    // Rect covering exactly rows 0-1 × cols 0-1 boxes (fully contained):
    // boxes span up to (3+2)=5 mm; marquee [−0.5, 5.5]².
    const hits = index.pickIn({
      minX: mmToNm(-0.5),
      minY: mmToNm(-0.5),
      maxX: mmToNm(5.5),
      maxY: mmToNm(5.5),
    });
    const ids = hits.map(idOf).sort();
    expect(ids).toEqual(["fp-0", "fp-1", "fp-40", "fp-41"]);
    // A marquee that only PARTIALLY covers a box excludes it (containment).
    const partial = index.pickIn({
      minX: mmToNm(-0.5),
      minY: mmToNm(-0.5),
      maxX: mmToNm(4), // cuts through col-1 boxes ([3,5] mm)
      maxY: mmToNm(5.5),
    });
    expect(partial.map(idOf).sort()).toEqual(["fp-0", "fp-40"]);
  });

  it("outline handles win over overlapping footprints", () => {
    const entries = syntheticEntries();
    entries.push({
      result: { kind: "outline-handle", handle: "nw" },
      bbox: { minX: mmToNm(0.5), minY: mmToNm(0.5), maxX: mmToNm(1.5), maxY: mmToNm(1.5) },
    });
    const withHandle = buildPickIndex(entries);
    expect(withHandle.pickAt({ x: mmToNm(1), y: mmToNm(1) })).toEqual({
      kind: "outline-handle",
      handle: "nw",
    });
  });

  it("empty index never throws", () => {
    const empty = buildPickIndex([]);
    expect(empty.pickAt({ x: 0, y: 0 })).toBeNull();
    expect(empty.pickIn({ minX: 0, minY: 0, maxX: 1, maxY: 1 })).toEqual([]);
  });
});
