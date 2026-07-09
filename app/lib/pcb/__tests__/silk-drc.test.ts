// Silk-over-pad DRC with user silk items (Stage 16 extends Stage 12's check):
// a silk line crossing a pad flags a warning; same geometry on the opposite
// side or far away is clean; text over a pad flags too.

import { describe, it, expect } from "vitest";
import { runDrc } from "../drc/run-drc";
import { getPreset } from "../drc/presets";
import { createEmptyBoard } from "../types";
import type { FootprintDef, FootprintInstance, PcbBoard } from "../types";
import type { SilkItem } from "../silk/types";
import { mmToNm } from "../units";

const JLC = getPreset("jlcpcb-2l").rules;

function padOnlyDef(): FootprintDef {
  return {
    libName: "Test",
    name: "PAD_2mm",
    attributes: { smd: true, throughHole: false, excludeFromPos: false, excludeFromBom: false },
    pads: [
      {
        number: "1",
        type: "smd",
        shape: { kind: "rect", width: mmToNm(2), height: mmToNm(2) },
        at: { x: 0, y: 0 },
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

function boardWithSilk(items: SilkItem[]): PcbBoard {
  const inst: FootprintInstance = {
    id: "u1",
    ref: "U1",
    footprintId: "Test:PAD_2mm",
    def: padOnlyDef(),
    at: { x: mmToNm(20), y: mmToNm(20) },
    rotationDeg: 0,
    side: "top",
    padNets: {},
  };
  return { ...createEmptyBoard(), footprints: [inst], silkItems: items };
}

const silkOverPad = (board: PcbBoard) =>
  runDrc(board, JLC).violations.filter((v) => v.kind === "silkOverPad");

describe("silk items in checkSilkOverPad", () => {
  it("a silk line crossing the pad → warning on the right layer", () => {
    const violations = silkOverPad(
      boardWithSilk([
        {
          kind: "line",
          id: "s1",
          layer: "silkTop",
          from: { x: mmToNm(18), y: mmToNm(20) },
          to: { x: mmToNm(22), y: mmToNm(20) },
          strokeWidthNm: 150_000,
        },
      ]),
    );
    expect(violations.length).toBeGreaterThanOrEqual(1);
    expect(violations[0].severity).toBe("warning");
    expect(violations[0].layer).toBe("silkTop");
  });

  it("same line on silkBottom (pad is top-only) → clean", () => {
    const violations = silkOverPad(
      boardWithSilk([
        {
          kind: "line",
          id: "s2",
          layer: "silkBottom",
          from: { x: mmToNm(18), y: mmToNm(20) },
          to: { x: mmToNm(22), y: mmToNm(20) },
          strokeWidthNm: 150_000,
        },
      ]),
    );
    expect(violations).toEqual([]);
  });

  it("silk text over the pad flags; far-away text is clean", () => {
    const text = (x: number, id: string): SilkItem => ({
      kind: "text",
      id,
      layer: "silkTop",
      position: { x: mmToNm(x), y: mmToNm(20) },
      text: "REV",
      heightNm: mmToNm(1),
      strokeWidthNm: 150_000,
      rotationDeg: 0,
      mirror: false,
      anchor: "center",
    });
    expect(silkOverPad(boardWithSilk([text(20, "near")])).length).toBeGreaterThanOrEqual(1);
    expect(silkOverPad(boardWithSilk([text(35, "far")]))).toEqual([]);
  });

  it("filled circle over the pad flags; hollow ring around it (clear of copper) is clean", () => {
    const circle = (radiusMm: number, filled: boolean): SilkItem => ({
      kind: "circle",
      id: "c1",
      layer: "silkTop",
      center: { x: mmToNm(20), y: mmToNm(20) },
      radiusNm: mmToNm(radiusMm),
      strokeWidthNm: 150_000,
      filled,
    });
    expect(silkOverPad(boardWithSilk([circle(0.5, true)])).length).toBeGreaterThanOrEqual(1);
    // 4 mm-radius outline ring: circumference stays ~3 mm from the 1 mm pad half-width
    expect(silkOverPad(boardWithSilk([circle(4, false)]))).toEqual([]);
  });
});
