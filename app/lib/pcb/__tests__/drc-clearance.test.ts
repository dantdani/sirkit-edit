// DRC clearance (#1) + short interplay (Stage 12). A too-small gap is a clearance
// error; a touching different-net pair is a SHORT (connectivity), not a clearance.

import { describe, it, expect } from "vitest";
import { buildDrcContext } from "../drc/run-drc";
import { checkCopperClearance } from "../drc/checks/clearance";
import { checkUnconnectedAndShorts } from "../drc/checks/connectivity";
import { getPreset } from "../drc/presets";
import { createEmptyBoard } from "../types";
import type { PcbBoard, Track, FootprintDef, FootprintInstance } from "../types";
import type { DrcRules } from "../drc/types";
import { mmToNm } from "../units";

// clearance relaxed to 0.20 mm to match the plan's scenario; other defaults kept.
const RULES: DrcRules = { default: { ...getPreset("jlcpcb-2l").rules.default, clearanceNm: 200_000 }, perClass: {} };

function board(nets: Record<number, string>, footprints: FootprintInstance[] = [], tracks: Track[] = []): PcbBoard {
  return {
    ...createEmptyBoard(),
    nets: [{ id: 0, name: "" }, ...Object.entries(nets).map(([id, name]) => ({ id: Number(id), name }))],
    footprints,
    tracks,
  };
}

/** Horizontal track at `yMm`, centred in the board (far from any edge). */
function htrack(id: string, netId: number, yMm: number): Track {
  return {
    id,
    layer: "copperTop",
    width: mmToNm(0.15),
    start: { x: mmToNm(10), y: mmToNm(yMm) },
    end: { x: mmToNm(20), y: mmToNm(yMm) },
    netId,
  };
}

function padDef(): FootprintDef {
  return {
    libName: "T",
    name: "P",
    attributes: { smd: true, throughHole: false, excludeFromPos: false, excludeFromBom: false },
    pads: [
      {
        number: "1",
        type: "smd",
        shape: { kind: "rect", width: mmToNm(1), height: mmToNm(1) },
        at: { x: 0, y: 0 },
        rotationDeg: 0,
        layers: ["copperTop", "maskTop"],
      },
    ],
    graphics: [],
    bodyBBox: { minX: 0, minY: 0, maxX: mmToNm(1), maxY: mmToNm(1) },
    models: [],
    rawSexpr: "",
  };
}

function inst(id: string, netId: number): FootprintInstance {
  return { id, ref: id.toUpperCase(), footprintId: "T:P", def: padDef(), at: { x: mmToNm(40), y: mmToNm(40) }, rotationDeg: 0, side: "top", padNets: { "1": netId } };
}

describe("DRC clearance", () => {
  it("(a) two same-net tracks 0.10 mm apart (under 0.20 mm) → 1 clearance violation", () => {
    // widths 0.15 mm; centres 0.25 mm apart → 0.10 mm edge gap.
    const b = board({ 1: "N1" }, [], [htrack("t1", 1, 40), htrack("t2", 1, 40.25)]);
    const v = checkCopperClearance(buildDrcContext(b, RULES)).filter((x) => x.kind === "clearance");
    expect(v).toHaveLength(1);
    expect(v[0].measuredNm).toBe(100_000);
    expect(v[0].thresholdNm).toBe(200_000);
    expect(v[0].items).toHaveLength(2);
  });

  it("(b) same tracks 0.30 mm apart → 0 clearance violations", () => {
    const b = board({ 1: "N1" }, [], [htrack("t1", 1, 40), htrack("t2", 1, 40.45)]);
    expect(checkCopperClearance(buildDrcContext(b, RULES)).filter((x) => x.kind === "clearance")).toEqual([]);
  });

  it("(c) touching different-net pads → 1 short, 0 clearance violations", () => {
    const b = board({ 1: "A", 2: "B" }, [inst("fa", 1), inst("fb", 2)]);
    const ctx = buildDrcContext(b, RULES);
    expect(checkCopperClearance(ctx)).toEqual([]);
    const shorts = checkUnconnectedAndShorts(ctx).filter((x) => x.kind === "short");
    expect(shorts).toHaveLength(1);
    expect(shorts[0].severity).toBe("error");
  });
});
