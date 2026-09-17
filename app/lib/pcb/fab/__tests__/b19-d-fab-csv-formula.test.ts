/**
 * [B19-D I5c row 33] Fabrication CSVs never hand a spreadsheet a formula.
 *
 * The fab BOM and pick-and-place writers quoted RFC-4180 fields but left a cell starting with `=`, `+`, `-`, `@`, tab or CR
 * as-is, so a component value, MPN or reference opened in a spreadsheet could run. Only TEXT columns are neutralised:
 * numeric coordinates like `-90.0000` must stay numbers.
 */
import { describe, expect, it } from "vitest";
import { emitBomCsv } from "../emit-bom";
import { emitPositionCsv } from "../emit-position";
import { emitNativePlacement } from "../native/ancillary";
import { createEmptyBoard } from "../../types";
import { mmToNm } from "../../units";

describe("[B19-D I5c row 33] the fab BOM neutralises formula text", () => {
  it("value, MPN and description cells that start a formula are prefixed; header and quantity unchanged", () => {
    const csv = emitBomCsv([{ refs: "U1", quantity: 1, value: "=1+1", footprint: "SOIC-8", mpn: "@SUM(1,2)", supplier: "", supplierPart: "", description: "+HYPERLINK(1)" } as never], ["refs", "quantity", "value", "footprint", "mpn", "description"] as never);
    const [header, row] = csv.trim().split("\r\n");
    expect(header).not.toMatch(/^'/);
    expect(row).toBe("U1,1,'=1+1,SOIC-8,\"'@SUM(1,2)\",'+HYPERLINK(1)");
  });
});

describe("[B19-D I5c row 33] pick-and-place neutralises text columns only", () => {
  // A formula-shaped REFERENCE is already refused by board integrity (BoardIntegrityError, measured); the text columns a
  // position file carries besides it are the footprint's value text and package name.
  it("a value or package that starts a formula is prefixed, while a negative coordinate or rotation stays a number", () => {
    const b = createEmptyBoard();
    b.footprints = [{
      id: "f1", ref: "R1", footprintId: "L:R", at: { x: mmToNm(-10), y: mmToNm(5) }, rotationDeg: 270, side: "top", padNets: {},
      def: { libName: "L", name: "=HYPERLINK(1)", attributes: { smd: true, throughHole: false, excludeFromPos: false, excludeFromBom: false }, pads: [{ number: "1", type: "smd", shape: { kind: "rect", width: 1, height: 1 }, at: { x: 0, y: 0 }, rotationDeg: 0, layers: ["copperTop"] }], graphics: [{ kind: "text", textKind: "value", text: "@SUM(1,2)", at: { x: 0, y: 0 }, rotationDeg: 0, sizeX: 1, sizeY: 1, thickness: 1, layer: "fabTop" }], bodyBBox: { minX: 0, minY: 0, maxX: 0, maxY: 0 }, models: [], rawSexpr: "" },
    } as never];
    const csv = emitPositionCsv(b, "kicad-default", "both");
    const row = csv.trim().split("\r\n")[1]!;
    expect(row).toBe("R1,\"'@SUM(1,2)\",'=HYPERLINK(1),-10.0000,5.0000,-90.0000,top");
  });

  it("[review] the Side column is a closed token, never the stored text", () => {
    const b = createEmptyBoard();
    const fp = (side: string) => ({ id: `f-${side.length}`, ref: side === "bottom" ? "R2" : "R1", footprintId: "L:R", at: { x: 0, y: 0 }, rotationDeg: 0, side, padNets: {}, def: { libName: "L", name: "R", attributes: { smd: true, throughHole: false, excludeFromPos: false, excludeFromBom: false }, pads: [{ number: "1", type: "smd", shape: { kind: "rect", width: 1, height: 1 }, at: { x: 0, y: 0 }, rotationDeg: 0, layers: ["copperTop"] }], graphics: [], bodyBBox: { minX: 0, minY: 0, maxX: 0, maxY: 0 }, models: [], rawSexpr: "" } });
    b.footprints = [fp('=HYPERLINK("https://evil.example","x")'), fp("bottom")] as never;
    const csv = emitPositionCsv(b, "kicad-default", "both");
    expect(csv).not.toContain("HYPERLINK");
    const sides = csv.trim().split("\r\n").slice(1).map((line) => line.split(",").at(-1));
    expect(sides.sort()).toEqual(["bottom", "top"]);
  });
});

describe("[B19-D I5c review] native placement neutralises its text columns", () => {
  it("a formula-shaped footprint name is prefixed while the negative coordinate stays a number", () => {
    const footprint = { ref: "R1", side: "top", rotationDeg: 270, at: { x: -10_000_000, y: 0 }, def: { name: "=HYPERLINK(1)", attributes: { excludeFromPos: false }, pads: [{ number: "1" }] } };
    const csv = emitNativePlacement({ board: { footprints: [footprint] }, transform: { originXNm: 0, originYNm: 0 } } as never);
    expect(csv.trim().split("\r\n")[1]).toBe("R1,-10.000000,0.000000,Top,-90,'=HYPERLINK(1)");
  });
});
