// DRC geometry checks (Stage 12): min track width, via outer/drill/annular,
// hole-to-hole. Each check is exercised in isolation via buildDrcContext.

import { describe, it, expect } from "vitest";
import { buildDrcContext } from "../drc/run-drc";
import { checkMinTrackWidth, checkVia, checkHoleToHole } from "../drc/checks/geometry";
import { getPreset } from "../drc/presets";
import { createEmptyBoard } from "../types";
import type { PcbBoard, Track, Via } from "../types";
import { mmToNm } from "../units";

const RULES = getPreset("jlcpcb-2l").rules;

function board(tracks: Track[] = [], vias: Via[] = []): PcbBoard {
  return {
    ...createEmptyBoard(),
    nets: [
      { id: 0, name: "" },
      { id: 1, name: "N1" },
    ],
    tracks,
    vias,
  };
}

function track(id: string, widthNm: number): Track {
  return {
    id,
    layer: "copperTop",
    width: widthNm,
    start: { x: mmToNm(40), y: mmToNm(40) },
    end: { x: mmToNm(50), y: mmToNm(40) },
    netId: 1,
  };
}

function via(id: string, xMm: number, sizeNm: number, drillNm: number): Via {
  return {
    id,
    at: { x: mmToNm(xMm), y: mmToNm(40) },
    size: sizeNm,
    drill: drillNm,
    netId: 1,
    layers: ["copperTop", "copperBottom"],
  };
}

describe("DRC geometry checks", () => {
  it("(a) 0.10 mm track vs 0.127 mm rule → violation naming both values", () => {
    const v = checkMinTrackWidth(buildDrcContext(board([track("t1", 100_000)]), RULES));
    expect(v).toHaveLength(1);
    expect(v[0].kind).toBe("minTrackWidth");
    expect(v[0].summary).toContain("0.10 mm");
    expect(v[0].summary).toContain("0.127 mm");
    expect(v[0].measuredNm).toBe(100_000);
    expect(v[0].thresholdNm).toBe(127_000);
  });

  it("passes a 0.20 mm track against the 0.127 mm rule", () => {
    expect(checkMinTrackWidth(buildDrcContext(board([track("t1", 200_000)]), RULES))).toEqual([]);
  });

  it("(b) via outer 0.5 mm vs 0.6 mm rule → an outer-diameter violation", () => {
    const v = checkVia(buildDrcContext(board([], [via("v1", 40, 500_000, 300_000)]), RULES));
    expect(v.filter((x) => x.kind === "viaOuterDiameter")).toHaveLength(1);
  });

  it("(c) annular ring: outer 0.6 / drill 0.4 → 0.1 mm ring vs 0.15 mm rule → violation", () => {
    const v = checkVia(buildDrcContext(board([], [via("v1", 40, 600_000, 400_000)]), RULES));
    const annular = v.filter((x) => x.kind === "annularRing");
    expect(annular).toHaveLength(1);
    expect(annular[0].measuredNm).toBe(100_000);
    // outer 0.6 == rule 0.6 and drill 0.4 > rule 0.3, so ONLY the ring fails
    expect(v.filter((x) => x.kind === "viaOuterDiameter")).toHaveLength(0);
    expect(v.filter((x) => x.kind === "viaDrill")).toHaveLength(0);
  });

  it("(d) hole-to-hole: 0.3 mm drills 0.3 mm apart → 0 mm rim gap vs 0.5 mm rule → violation", () => {
    const b = board([], [via("v1", 40, 800_000, 300_000), via("v2", 40.3, 800_000, 300_000)]);
    const v = checkHoleToHole(buildDrcContext(b, RULES));
    expect(v).toHaveLength(1);
    expect(v[0].kind).toBe("holeToHole");
    expect(v[0].measuredNm).toBeCloseTo(0, 0);
    expect(v[0].thresholdNm).toBe(500_000);
  });
});
