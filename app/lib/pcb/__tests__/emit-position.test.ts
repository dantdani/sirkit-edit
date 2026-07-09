// Pick-and-place emission (Stage 14): jlcpcb-cpl coordinates + the Stage 13
// rotation rule (model stores KiCad CCW-positive; one UI 90°-CW turn is 270
// and must emit -90.0000 — normalization, not sign-flip), side filtering,
// header-only on empty boards, and excludeFromPos handling.

import { describe, it, expect } from "vitest";
import { emitPositionCsv } from "../fab/emit-position";
import type { FootprintDef, FootprintInstance, PcbBoard } from "../types";
import { createEmptyBoard } from "../types";
import { mmToNm } from "../units";

function def(name = "R_0603_1608Metric"): FootprintDef {
  return {
    libName: "Test",
    name,
    attributes: { smd: true, throughHole: false, excludeFromPos: false, excludeFromBom: false },
    pads: [
      {
        number: "1",
        type: "smd",
        shape: { kind: "rect", width: mmToNm(1), height: mmToNm(1) },
        at: { x: 0, y: 0 },
        rotationDeg: 0,
        layers: ["copperTop"],
      },
    ],
    graphics: [],
    bodyBBox: { minX: 0, minY: 0, maxX: mmToNm(1), maxY: mmToNm(1) },
    models: [],
    rawSexpr: "",
  };
}

function inst(ref: string, overrides: Partial<FootprintInstance> = {}): FootprintInstance {
  return {
    id: `id-${ref}`,
    ref,
    footprintId: "Test:R_0603_1608Metric",
    def: def(),
    at: { x: mmToNm(152.4), y: mmToNm(76.2) },
    rotationDeg: 0,
    side: "top",
    padNets: {},
    ...overrides,
  };
}

function boardWith(instances: FootprintInstance[]): PcbBoard {
  return { ...createEmptyBoard(), footprints: instances };
}

describe("emitPositionCsv", () => {
  it("(a) 90° CW footprint (stored 270) → Mid X=152.4000, Mid Y=76.2000, Rotation=-90.0000", () => {
    const csv = emitPositionCsv(boardWith([inst("R1", { rotationDeg: 270 })]), "jlcpcb-cpl", "top");
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("Designator,Mid X,Mid Y,Layer,Rotation");
    expect(lines[1]).toBe("R1,152.4000,76.2000,T,-90.0000");
  });

  it("CCW-parsed 90 passes through as 90.0000 — no sign flip", () => {
    const csv = emitPositionCsv(boardWith([inst("R1", { rotationDeg: 90 })]), "jlcpcb-cpl", "top");
    expect(csv).toContain("R1,152.4000,76.2000,T,90.0000");
  });

  it("(b) side 'top' skips bottom footprints; bottom rows carry B", () => {
    const board = boardWith([inst("R1"), inst("R2", { side: "bottom" })]);
    const top = emitPositionCsv(board, "jlcpcb-cpl", "top");
    expect(top).toContain("R1,");
    expect(top).not.toContain("R2,");
    const bottom = emitPositionCsv(board, "jlcpcb-cpl", "bottom");
    expect(bottom).not.toContain("R1,");
    expect(bottom).toContain("R2,152.4000,76.2000,B,0.0000");
  });

  it("(c) empty board → CSV with the header row only", () => {
    expect(emitPositionCsv(boardWith([]), "jlcpcb-cpl", "both")).toBe(
      "Designator,Mid X,Mid Y,Layer,Rotation\r\n",
    );
    expect(emitPositionCsv(boardWith([]), "kicad-default", "both")).toBe(
      "Ref,Val,Package,PosX,PosY,Rot,Side\r\n",
    );
    expect(emitPositionCsv(boardWith([]), "pcbway-standard", "both")).toBe(
      "Designator,Center-X(mm),Center-Y(mm),Rotation,Layer\r\n",
    );
  });

  it("skips excludeFromPos and pad-less (mechanical) footprints", () => {
    const virtual = inst("LOGO1");
    virtual.def.attributes.excludeFromPos = true;
    const padless = inst("H1");
    padless.def.pads = [];
    const csv = emitPositionCsv(boardWith([inst("R1"), virtual, padless]), "jlcpcb-cpl", "both");
    expect(csv).toContain("R1,");
    expect(csv).not.toContain("LOGO1");
    expect(csv).not.toContain("H1");
  });

  it("kicad-default and pcbway rows carry side/layer in their own vocabulary", () => {
    const board = boardWith([inst("R1", { side: "bottom", rotationDeg: 180 })]);
    expect(emitPositionCsv(board, "kicad-default", "both")).toContain(
      "R1,R_0603_1608Metric,R_0603_1608Metric,152.4000,76.2000,180.0000,bottom",
    );
    expect(emitPositionCsv(board, "pcbway-standard", "both")).toContain(
      "R1,152.4000,76.2000,180.0000,BottomLayer",
    );
  });
});
