/**
 * Stage 17 Phase D gate: arrange math — align/distribute/snap on known
 * fixtures, one undo entry per action, locked/pad rejection, and the
 * 100-item align < 200 ms performance gate (measured + printed).
 */

import { describe, it, expect } from "vitest";
import type { PcbBoard, Via } from "../types";
import type { SelectionRef } from "../edit/commands";
import { computeAlign, computeDistribute, computeSnapToGrid } from "../edit/arrange";
import { applyEdits } from "../edit/apply";
import { validateCommand } from "../edit/validate";
import { createHistory } from "../history";
import { buildRoutedDemo } from "../demo/routed-demo";
import { mmToNm } from "../units";

const mm = mmToNm;
const via = (id: string): SelectionRef => ({ kind: "via", id });

function viaAt(id: string, xMm: number, yMm: number): Via {
  return {
    id,
    at: { x: mm(xMm), y: mm(yMm) },
    size: mm(0.6),
    drill: mm(0.3),
    netId: 1,
    layers: ["copperTop", "copperBottom"],
  };
}

function boardWithVias(vias: Via[]): PcbBoard {
  return {
    formatVersion: 1,
    stackup: 2,
    outline: { kind: "rect", width: mm(100), height: mm(80), origin: { x: 0, y: 0 } },
    nets: [
      { id: 0, name: "" },
      { id: 1, name: "N1" },
    ],
    footprints: [],
    tracks: [
      {
        id: "t1",
        layer: "copperTop",
        width: mm(0.25),
        start: { x: mm(10.3), y: mm(30.2) },
        end: { x: mm(20.3), y: mm(30.2) },
        netId: 1,
      },
    ],
    vias,
    zones: [],
    texts: [],
    silkItems: [],
  };
}

describe("arrange math", () => {
  const board = boardWithVias([viaAt("v1", 10, 10), viaAt("v2", 20, 15), viaAt("v3", 37, 20)]);
  const refs = [via("v1"), via("v2"), via("v3")];

  it("align left: every bbox left edge lands on the union's left edge", () => {
    const history = createHistory(structuredClone(board));
    const result = applyEdits(history, [{ op: "align", refs, mode: "left" }]);
    expect(result.ok).toBe(true);
    // Union minX = 10 - 0.3 (v1's barrel radius); every via center → 10 mm.
    for (const v of history.present.vias) expect(v.at.x).toBe(mm(10));
    // Ys untouched.
    expect(history.present.vias.map((v) => v.at.y)).toEqual([mm(10), mm(15), mm(20)]);
    history.undo();
    expect(history.canUndo).toBe(false); // one entry
    expect(history.present).toEqual(board);
  });

  it("align centerV: vertical centers meet the union's center", () => {
    const deltas = computeAlign(board, refs, "centerV");
    // Union spans y 9.7..20.3 → center 15 mm; centers are 10/15/20.
    expect(deltas.get("via:v1")).toEqual({ x: 0, y: mm(5) });
    expect(deltas.get("via:v2")).toEqual({ x: 0, y: 0 });
    expect(deltas.get("via:v3")).toEqual({ x: 0, y: -mm(5) });
  });

  it("distribute h: anchors first/last, equalizes center spacing", () => {
    const history = createHistory(structuredClone(board));
    applyEdits(history, [{ op: "distribute", refs, axis: "h" }]);
    // Centers 10, 20, 37 → first/last stay, middle → (10+37)/2 = 23.5 mm.
    expect(history.present.vias.map((v) => v.at.x)).toEqual([mm(10), mm(23.5), mm(37)]);
  });

  it("snap-to-grid snaps anchors and moves whole items (no skew)", () => {
    const b = structuredClone(board);
    const history = createHistory(b);
    const trackRef: SelectionRef = { kind: "track", id: "t1" };
    applyEdits(history, [{ op: "snap-to-grid", refs: [trackRef], gridNm: mm(0.5) }]);
    const t = history.present.tracks[0];
    expect(t.start).toEqual({ x: mm(10.5), y: mm(30) }); // 10.3→10.5, 30.2→30
    // The end moved by the SAME delta — segment length/direction preserved.
    expect(t.end).toEqual({ x: mm(20.5), y: mm(30) });

    const deltas = computeSnapToGrid(board, refs, mm(0.5));
    expect(deltas.get("via:v1")).toEqual({ x: 0, y: 0 }); // already on grid
  });

  it("distribute needs three items; align needs two; grid must be positive", () => {
    expect(
      validateCommand(board, { op: "distribute", refs: refs.slice(0, 2), axis: "h" }),
    ).toContain("Distributing needs at least three items.");
    expect(validateCommand(board, { op: "align", refs: [via("v1")], mode: "left" })).toContain(
      "Aligning needs at least two items.",
    );
    expect(
      validateCommand(board, { op: "snap-to-grid", refs, gridNm: 0 }),
    ).toContain("Snap grid must be a positive number of nanometers.");
  });

  it("locked footprints and pads are rejected", () => {
    const demo = buildRoutedDemo();
    demo.footprints[0].locked = true;
    const fpRef: SelectionRef = { kind: "footprint", id: demo.footprints[0].id };
    const otherRef: SelectionRef = { kind: "footprint", id: demo.footprints[1].id };
    const errors = validateCommand(demo, { op: "align", refs: [fpRef, otherRef], mode: "left" });
    expect(errors.some((e) => e.includes("is locked"))).toBe(true);

    const padRef: SelectionRef = {
      kind: "pad",
      footprintId: demo.footprints[1].id,
      padNumber: demo.footprints[1].def.pads[0].number,
    };
    expect(
      validateCommand(demo, { op: "align", refs: [padRef, otherRef], mode: "left" }),
    ).toContain("Pads move with their footprint — align the footprint instead.");
  });

  it("aligns 100 items in < 200 ms (gate; measured)", () => {
    const many = boardWithVias(
      Array.from({ length: 100 }, (_, i) => viaAt(`m${i}`, 5 + (i % 13) * 7, 5 + (i % 7) * 9)),
    );
    const manyRefs = many.vias.map((v) => via(v.id));
    const history = createHistory(many);
    const t0 = performance.now();
    const result = applyEdits(history, [{ op: "align", refs: manyRefs, mode: "top" }]);
    const elapsed = performance.now() - t0;
    expect(result.ok).toBe(true);
    // eslint-disable-next-line no-console
    console.log(`[stage17-d] 100-item align: ${elapsed.toFixed(2)} ms`);
    expect(elapsed).toBeLessThan(200);
    const minY = Math.min(...many.vias.map((v) => v.at.y - v.size / 2));
    for (const v of history.present.vias) expect(v.at.y - v.size / 2).toBe(minY);
  });
});
