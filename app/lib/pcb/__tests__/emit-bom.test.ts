// BOM emission (Stage 14): grouping by (footprint, value), RFC 4180 escaping,
// optional MPN pass-through, and UTF-8 with NO byte-order mark.

import { describe, it, expect } from "vitest";
import { computeBomRows, emitBomCsv } from "../fab/emit-bom";
import type { FootprintDef, FootprintInstance, PcbBoard } from "../types";
import { createEmptyBoard } from "../types";
import type { PcbNetlist } from "../netlist-bridge";
import { mmToNm } from "../units";

function def(name: string, description?: string): FootprintDef {
  return {
    libName: "Test",
    name,
    ...(description !== undefined ? { description } : {}),
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

function inst(id: string, ref: string, d: FootprintDef): FootprintInstance {
  return {
    id,
    ref,
    footprintId: `Test:${d.name}`,
    def: d,
    at: { x: 0, y: 0 },
    rotationDeg: 0,
    side: "top",
    padNets: {},
  };
}

function boardWith(instances: FootprintInstance[]): PcbBoard {
  return { ...createEmptyBoard(), footprints: instances };
}

function netlistFor(
  entries: { id: string; ref: string; value?: string; mpn?: string }[],
): PcbNetlist {
  return {
    components: entries.map((e) => ({
      id: e.id,
      ref: e.ref,
      ...(e.value !== undefined ? { value: e.value } : {}),
      ...(e.mpn !== undefined ? { mpn: e.mpn } : {}),
      pins: [],
    })),
    nets: [],
  };
}

describe("computeBomRows", () => {
  it("(a) 5 identical 10k resistors → one row, qty 5, refs naturally sorted", () => {
    const r = def("R_0603_1608Metric");
    const instances = ["R3", "R10", "R1", "R2", "R11"].map((ref, i) => inst(`c${i}`, ref, r));
    const netlist = netlistFor(instances.map((i) => ({ id: i.id, ref: i.ref, value: "10k" })));
    const rows = computeBomRows(boardWith(instances), netlist);
    expect(rows.length).toBe(1);
    expect(rows[0].quantity).toBe(5);
    expect(rows[0].refs).toBe("R1,R2,R3,R10,R11");
    expect(rows[0].value).toBe("10k");
    expect(rows[0].footprint).toBe("R_0603_1608Metric");
  });

  it("different values split rows; rows sort by (footprint, value, refs)", () => {
    const r = def("R_0603_1608Metric");
    const c = def("C_0603_1608Metric");
    const instances = [inst("a", "R1", r), inst("b", "R2", r), inst("c", "C1", c)];
    const netlist = netlistFor([
      { id: "a", ref: "R1", value: "10k" },
      { id: "b", ref: "R2", value: "1k" },
      { id: "c", ref: "C1", value: "100n" },
    ]);
    const rows = computeBomRows(boardWith(instances), netlist);
    expect(rows.map((row) => `${row.footprint}/${row.value}`)).toEqual([
      "C_0603_1608Metric/100n",
      "R_0603_1608Metric/1k",
      "R_0603_1608Metric/10k",
    ]);
  });

  it("(c) missing MPN → empty column, no error; present MPN passes through", () => {
    const r = def("R_0603_1608Metric");
    const instances = [inst("a", "R1", r), inst("b", "U1", def("SOT-23"))];
    const netlist = netlistFor([
      { id: "a", ref: "R1", value: "10k" },
      { id: "b", ref: "U1", value: "MCP1700", mpn: "MCP1700T-3302E/TT" },
    ]);
    const rows = computeBomRows(boardWith(instances), netlist);
    expect(rows.find((row) => row.refs === "R1")?.mpn).toBe("");
    expect(rows.find((row) => row.refs === "U1")?.mpn).toBe("MCP1700T-3302E/TT");
  });

  it("excludeFromBom footprints are skipped", () => {
    const fiducial = def("Fiducial_1mm");
    fiducial.attributes.excludeFromBom = true;
    const rows = computeBomRows(boardWith([inst("a", "FID1", fiducial)]), netlistFor([]));
    expect(rows).toEqual([]);
  });
});

describe("emitBomCsv", () => {
  const columns = ["refs", "value", "footprint", "quantity", "mpn"] as const;

  it("(b) value containing a comma is RFC 4180-quoted", () => {
    const r = def("R_0603_1608Metric");
    const netlist = netlistFor([{ id: "a", ref: "R1", value: '10k, 1%, "E96"' }]);
    const csv = emitBomCsv(computeBomRows(boardWith([inst("a", "R1", r)]), netlist), [...columns]);
    expect(csv).toContain('"10k, 1%, ""E96"""');
    // refs field with multiple designators is quoted too
    const multi = emitBomCsv(
      computeBomRows(
        boardWith([inst("a", "R1", r), inst("b", "R2", r)]),
        netlistFor([
          { id: "a", ref: "R1", value: "10k" },
          { id: "b", ref: "R2", value: "10k" },
        ]),
      ),
      [...columns],
    );
    expect(multi).toContain('"R1,R2"');
  });

  it("(d) UTF-8 without a BOM byte, CRLF line endings, header row present", () => {
    const csv = emitBomCsv([], [...columns]);
    const bytes = Buffer.from(csv, "utf8");
    expect(bytes[0]).not.toBe(0xef);
    expect(csv.startsWith("Designator,Value,Footprint,Quantity,MPN\r\n")).toBe(true);
    expect(csv.includes("\n")).toBe(true);
    expect(csv.replace(/\r\n/g, "")).not.toContain("\n");
  });
});
