// Story fixture (Stage 16): the canonical demo start state can't drift —
// unplaced footprints in the staging strip, complete netlist (every net ≥ 2
// nodes), fresh board (no copper, no zones, no silk), 40 × 30 outline.

import { describe, it, expect } from "vitest";
import { buildStoryDemo, STORY_NETS } from "../demo/story-demo";
import { mmToNm } from "../units";

describe("buildStoryDemo", () => {
  const board = buildStoryDemo();

  it("40 × 30 mm rect outline at origin, 2-layer stackup", () => {
    expect(board.outline).toEqual({
      kind: "rect",
      width: mmToNm(40),
      height: mmToNm(30),
      origin: { x: 0, y: 0 },
    });
    expect(board.stackup).toBe(2);
  });

  it("12–20 footprints, ALL staged left of the board (unplaced)", () => {
    expect(board.footprints.length).toBeGreaterThanOrEqual(12);
    expect(board.footprints.length).toBeLessThanOrEqual(20);
    for (const f of board.footprints) {
      expect(f.at.x, f.ref).toBeLessThan(0); // outline starts at x=0
      expect(f.side).toBe("top");
    }
    const refs = board.footprints.map((f) => f.ref);
    expect(new Set(refs).size).toBe(refs.length);
  });

  it("complete netlist: named nets, every net has ≥ 2 pads, no dangling pad nets", () => {
    expect(board.nets).toEqual(STORY_NETS.map((n) => ({ ...n })));
    const counts = new Map<number, number>();
    for (const f of board.footprints) {
      for (const [pad, netId] of Object.entries(f.padNets)) {
        expect(board.nets.some((n) => n.id === netId), `${f.ref}.${pad} → net ${netId}`).toBe(true);
        expect(netId).not.toBe(0);
        counts.set(netId, (counts.get(netId) ?? 0) + 1);
      }
    }
    for (const net of board.nets) {
      if (net.id === 0) continue;
      expect(counts.get(net.id) ?? 0, `net ${net.name} needs ≥2 nodes`).toBeGreaterThanOrEqual(2);
    }
  });

  it("fresh board: no tracks, vias, zones, texts, or silk — the demo adds them live", () => {
    expect(board.tracks).toEqual([]);
    expect(board.vias).toEqual([]);
    expect(board.zones).toEqual([]);
    expect(board.texts).toEqual([]);
    expect(board.silkItems).toEqual([]);
  });

  it("pad references are real: every padNets key exists on the footprint", () => {
    for (const f of board.footprints) {
      const padNumbers = new Set(f.def.pads.map((p) => p.number));
      for (const pad of Object.keys(f.padNets)) {
        expect(padNumbers.has(pad), `${f.ref} pad ${pad}`).toBe(true);
      }
    }
  });

  it("deterministic: two builds are deep-equal", () => {
    expect(buildStoryDemo()).toEqual(board);
  });
});
