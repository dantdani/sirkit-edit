/**
 * Stage 17 Phase B gate: previewEdits — dry-run + single-item-scope checks.
 * - illegal width under jlcpcb-2l yields the preset-aware warning without
 *   blocking the commit (the violation then shows up in a batch runDrc);
 * - clearance/edge violations surface for moved copper;
 * - the input board is never touched;
 * - compute latency is measured (target < 20 ms at demo scale).
 */

import { describe, it, expect } from "vitest";
import { buildRoutedDemo } from "../demo/routed-demo";
import { createHistory } from "../history";
import type { PcbBoard } from "../types";
import { previewEdits, previewSummary } from "../edit/preview";
import { applyEdits } from "../edit/apply";
import { runDrc } from "../drc/run-drc";
import { getPreset } from "../drc/presets";
import { fmtMm } from "../drc/format";
import { mmToNm } from "../units";

const RULES = getPreset("jlcpcb-2l").rules;

function twoTrackBoard(): PcbBoard {
  return {
    formatVersion: 1,
    stackup: 2,
    outline: { kind: "rect", width: mmToNm(60), height: mmToNm(40), origin: { x: 0, y: 0 } },
    nets: [
      { id: 0, name: "" },
      { id: 1, name: "A" },
      { id: 2, name: "B" },
    ],
    footprints: [],
    tracks: [
      {
        id: "ta",
        layer: "copperTop",
        width: mmToNm(0.25),
        start: { x: mmToNm(10), y: mmToNm(10) },
        end: { x: mmToNm(20), y: mmToNm(10) },
        netId: 1,
      },
      {
        id: "tb",
        layer: "copperTop",
        width: mmToNm(0.25),
        start: { x: mmToNm(10), y: mmToNm(20) },
        end: { x: mmToNm(20), y: mmToNm(20) },
        netId: 2,
      },
    ],
    vias: [
      {
        id: "va",
        at: { x: mmToNm(40), y: mmToNm(20) },
        size: RULES.default.minViaOuterNm - mmToNm(0.05),
        drill: mmToNm(0.2),
        netId: 1,
        layers: ["copperTop", "copperBottom"],
      },
    ],
    zones: [],
    texts: [],
    silkItems: [],
  };
}

describe("previewEdits", () => {
  it("warns on an illegal track width with the preset threshold — Stage 12 voice", () => {
    const board = buildRoutedDemo();
    const track = board.tracks[0];
    const preview = previewEdits(
      board,
      [{ op: "set-track-width", ids: [track.id], widthNm: mmToNm(0.1) }],
      RULES,
    );
    expect(preview.errors).toEqual([]);
    const width = preview.violations.find((v) => v.kind === "minTrackWidth");
    expect(width).toBeDefined();
    expect(width?.thresholdNm).toBe(RULES.default.minTrackWidthNm);
    expect(width?.summary).toContain("0.10 mm wide");
    expect(width?.summary).toContain(`need ≥ ${fmtMm(RULES.default.minTrackWidthNm)} mm`);
    expect(previewSummary(preview)).toBe(width?.summary);
  });

  it("never mutates the input board", () => {
    const board = buildRoutedDemo();
    const snapshot = JSON.stringify(board);
    previewEdits(
      board,
      [{ op: "set-track-width", ids: [board.tracks[0].id], widthNm: mmToNm(0.05) }],
      RULES,
    );
    expect(JSON.stringify(board)).toBe(snapshot);
  });

  it("does NOT block the commit — the violation then appears in batch DRC", () => {
    const board = buildRoutedDemo();
    const track = board.tracks[0];
    const history = createHistory(board);
    const result = applyEdits(history, [
      { op: "set-track-width", ids: [track.id], widthNm: mmToNm(0.1) },
    ]);
    expect(result.ok).toBe(true); // warnings are hints; invalid values commit
    expect(history.present.tracks[0].width).toBe(mmToNm(0.1));

    const drc = runDrc(history.present, RULES);
    expect(
      drc.violations.some(
        (v) => v.kind === "minTrackWidth" && v.items.some((i) => i.kind === "track" && i.id === track.id),
      ),
    ).toBe(true);
  });

  it("reports clearance when a moved track lands too close to another net", () => {
    const board = twoTrackBoard();
    const clearance = RULES.default.clearanceNm;
    // Move tb so the copper gap to ta becomes clearance/2.
    const targetCenterGap = mmToNm(0.25) + Math.round(clearance / 2);
    const deltaY = mmToNm(10) + targetCenterGap - mmToNm(20);
    const preview = previewEdits(
      board,
      [{ op: "move-items", refs: [{ kind: "track", id: "tb" }], deltaNm: { x: 0, y: deltaY } }],
      RULES,
    );
    const v = preview.violations.find((x) => x.kind === "clearance");
    expect(v).toBeDefined();
    expect(v?.thresholdNm).toBe(clearance);
    expect(v?.summary).toContain("need ≥");
  });

  it("reports edge clearance when copper approaches the outline", () => {
    const board = twoTrackBoard();
    const minEdge = RULES.default.minEdgeClearanceNm;
    // Move ta so its copper sits minEdge/2 from the top edge (y = 0).
    const targetCenterY = mmToNm(0.125) + Math.round(minEdge / 2);
    const preview = previewEdits(
      board,
      [
        {
          op: "move-items",
          refs: [{ kind: "track", id: "ta" }],
          deltaNm: { x: 0, y: targetCenterY - mmToNm(10) },
        },
      ],
      RULES,
    );
    expect(preview.violations.some((v) => v.kind === "edgeClearance")).toBe(true);
  });

  it("runs via geometry checks on touched vias", () => {
    const board = twoTrackBoard(); // via 'va' is below the preset's min outer
    const preview = previewEdits(
      board,
      [{ op: "move-items", refs: [{ kind: "via", id: "va" }], deltaNm: { x: mmToNm(1), y: 0 } }],
      RULES,
    );
    expect(preview.violations.some((v) => v.kind === "viaOuterDiameter")).toBe(true);
  });

  it("returns validation errors without running checks", () => {
    const board = twoTrackBoard();
    const preview = previewEdits(
      board,
      [{ op: "set-track-width", ids: ["ghost"], widthNm: mmToNm(0.3) }],
      RULES,
    );
    expect(preview.errors).toEqual(["No track ghost on this board."]);
    expect(preview.violations).toEqual([]);
  });

  it("stays fast at demo scale (gate: < 20 ms compute)", () => {
    const board = buildRoutedDemo();
    const ids = board.tracks.map((t) => t.id);
    // Warm-up (JIT + preset caches), then measure.
    previewEdits(board, [{ op: "set-track-width", ids, widthNm: mmToNm(0.3) }], RULES);
    const t0 = performance.now();
    const preview = previewEdits(
      board,
      [{ op: "set-track-width", ids, widthNm: mmToNm(0.3) }],
      RULES,
    );
    const elapsed = performance.now() - t0;
    expect(preview.errors).toEqual([]);
    // eslint-disable-next-line no-console
    console.log(
      `[stage17-b] previewEdits over ${ids.length} tracks: ${elapsed.toFixed(2)} ms`,
    );
    expect(elapsed).toBeLessThan(100); // hard cap; gate target is < 20 ms
  });
});
