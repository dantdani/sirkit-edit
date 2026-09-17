// DSN emitter (Stage 9): padstack dedup, per-instance images, layer stackup,
// net-name quoting, and deterministic (golden) output. Pure — no subprocess.

import { describe, it, expect } from "vitest";
import { boardToDsn, DsnEmitError, writeDsn } from "../dsn/write-dsn";
import { assertDsnReady, validateDsn } from "../dsn/preflight";
import { createEmptyBoard } from "../types";
import type { PcbBoard, FootprintDef, FootprintInstance, Pad } from "../types";
import { buildRoutedDemo } from "../demo/routed-demo";
import { mmToNm } from "../units";

function smdPad(number: string, xMm: number): Pad {
  return {
    number,
    type: "smd",
    shape: { kind: "rect", width: mmToNm(0.6), height: mmToNm(0.6) },
    at: { x: mmToNm(xMm), y: 0 },
    rotationDeg: 0,
    layers: ["copperTop", "maskTop"],
  };
}

function def(pads: Pad[]): FootprintDef {
  return {
    libName: "T",
    name: "R",
    attributes: { smd: true, throughHole: false, excludeFromPos: false, excludeFromBom: false },
    pads,
    graphics: [],
    bodyBBox: { minX: 0, minY: 0, maxX: mmToNm(2), maxY: mmToNm(1) },
    models: [],
    rawSexpr: "",
  };
}

function inst(
  id: string,
  ref: string,
  pads: Pad[],
  padNets: Record<string, number>,
  at = { x: mmToNm(10), y: mmToNm(10) },
): FootprintInstance {
  return { id, ref, footprintId: "T:R", def: def(pads), at, rotationDeg: 0, side: "top", padNets };
}

function board(netNames: Record<number, string>, footprints: FootprintInstance[]): PcbBoard {
  return {
    ...createEmptyBoard(),
    nets: [{ id: 0, name: "" }, ...Object.entries(netNames).map(([id, name]) => ({ id: Number(id), name }))],
    footprints,
  };
}

describe("boardToDsn / writeDsn", () => {
  it("(a) trivial 2-pad-1-net board → 1 padstack, 1 image w/ 2 pins, 1 net w/ 2 nodes, a rule", () => {
    const fp = inst("r1", "R1", [smdPad("1", 0), smdPad("2", 1)], { "1": 1, "2": 1 });
    const dsn = boardToDsn(board({ 1: "N1" }, [fp]));

    expect(dsn.padstacks).toHaveLength(1);
    expect(dsn.components).toHaveLength(1);
    expect(dsn.components[0].pins).toHaveLength(2);
    expect(dsn.networks).toHaveLength(1);
    expect(dsn.networks[0].nodes).toHaveLength(2);
    expect(dsn.rules.length).toBeGreaterThanOrEqual(1);

    const text = writeDsn(dsn);
    expect(text).toContain("(resolution um 1)");
    expect(text).toContain('(pins "R1"-"1" "R1"-"2")');
    expect(text).toContain("(padstack");
    expect(text).toContain("(image");
    expect(text).toContain('(net "N1"');
    expect(text).toContain("(class Default");
    expect(text).toContain('(place "R1" 0 0 front 0)');
  });

  it("(b) padstack dedup: 5 identical resistors → exactly 1 padstack, referenced 10 times", () => {
    const fps = Array.from({ length: 5 }, (_, i) =>
      inst(`r${i}`, `R${i}`, [smdPad("1", 0), smdPad("2", 1)], { "1": i + 1, "2": 0 }, {
        x: mmToNm(i * 5 + 5),
        y: mmToNm(5),
      }),
    );
    const dsn = boardToDsn(board({ 1: "N1", 2: "N2", 3: "N3", 4: "N4", 5: "N5" }, fps));

    expect(dsn.padstacks).toHaveLength(1);
    const psName = dsn.padstacks[0].name;
    const refs = dsn.components.flatMap((c) => c.pins).filter((p) => p.padstackName === psName).length;
    expect(refs).toBe(10);
  });

  it("(c) 4-layer board emits both In1.Cu and In2.Cu copper layers", () => {
    const fp = inst("r1", "R1", [smdPad("1", 0), smdPad("2", 1)], { "1": 1, "2": 1 });
    const b: PcbBoard = { ...board({ 1: "N1" }, [fp]), stackup: 4 };
    const dsn = boardToDsn(b);

    const names = dsn.layers.map((l) => l.name);
    expect(names).toContain("In1.Cu");
    expect(names).toContain("In2.Cu");
    const text = writeDsn(dsn);
    expect(text).toContain("In1.Cu");
    expect(text).toContain("In2.Cu");
    expect(text).toContain("(autoroute_settings");
    expect(text).toContain("(layer_rule In1.Cu");
    expect(dsn.vias.every((via) => via.onLayers.length === 4)).toBe(true);
  });

  it("(d) net names with special characters are double-quoted; a quote FreeRouting cannot read back is refused", () => {
    const fp = inst("r1", "R1", [smdPad("1", 0), smdPad("2", 1)], { "1": 1, "2": 1 });
    expect(writeDsn(boardToDsn(board({ 1: "A B/C+" }, [fp])))).toContain('(net "A B/C+"');
    // [B19-D I5e review; reviewed pin move] this case pinned `(net "A\\"B"`, but FreeRouting's lexer has no escape inside a
    // quoted string: the backslash is a plain character and the quote ends the string, so the old output was the injection
    expect(() => writeDsn(boardToDsn(board({ 1: 'A"B' }, [fp])))).toThrow(DsnEmitError);
  });

  it("(f) NPTH pads and phantom padNets entries never produce dangling network nodes", () => {
    const pads: Pad[] = [
      smdPad("1", 0),
      {
        number: "MH",
        type: "np_thru_hole",
        shape: { kind: "circle", radius: mmToNm(1) },
        at: { x: mmToNm(3), y: 0 },
        rotationDeg: 0,
        layers: [],
        drill: { diameter: mmToNm(2) },
      },
    ];
    // "MH" is a mechanical hole; "99" is not a real pad — neither may leak into the net.
    const fp = inst("r1", "R1", pads, { "1": 1, MH: 1, "99": 1 });
    const dsn = boardToDsn(board({ 1: "N1" }, [fp]));

    expect(dsn.components[0].pins.map((p) => p.padNumber)).toEqual(["1"]);
    expect(dsn.networks[0].nodes.map((nd) => nd.padNumber)).toEqual(["1"]);
  });

  it("(e) golden: a fixed board produces byte-identical DSN across two runs", () => {
    const demo = buildRoutedDemo();
    const first = writeDsn(boardToDsn(demo));
    const second = writeDsn(boardToDsn(demo));
    expect(first).toBe(second);
    // and the real demo fixture emits a well-formed pcb document
    expect(first.startsWith("(pcb sirkit-export-")).toBe(true);
    expect(first.trimEnd().endsWith(")")).toBe(true);
    expect(first).toContain("(wiring");
    expect(first).toContain("(type protect)");
  });

  it("rejects two schematic endpoints claiming one pad without internally-common authority", () => {
    const fp = inst("u1", "U1", [smdPad("1", 0)], { "1": 1 });
    fp.pinPadMappings = [
      { componentInstanceId: "u1", endpointKey: "u1::A", symbolPinNumber: "A", padNumbers: ["1"], mappingKind: "electrical", provenance: "library-explicit" },
      { componentInstanceId: "u1", endpointKey: "u1::B", symbolPinNumber: "B", padNumbers: ["1"], mappingKind: "electrical", provenance: "library-explicit" },
    ];
    const b = board({ 1: "SIG" }, [fp]);
    b.nets[1] = { id: 1, name: "SIG", stableId: "stable-sig", endpointKeys: ["u1::A", "u1::B"] };

    const report = validateDsn(b, boardToDsn(b));

    expect(report.ok).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain("PAD_NET_CONFLICT");
  });

  it("accepts one verified endpoint mapped to multiple physical pads", () => {
    const fp = inst("u1", "U1", [smdPad("1", 0), smdPad("2", 1)], { "1": 1, "2": 1 });
    fp.pinPadMappings = [
      { componentInstanceId: "u1", endpointKey: "u1::GND", symbolPinNumber: "GND", padNumbers: ["1", "2"], mappingKind: "internally-common", provenance: "library-explicit" },
    ];
    const b = board({ 1: "GND" }, [fp]);
    b.nets[1] = { id: 1, name: "GND", stableId: "stable-gnd", endpointKeys: ["u1::GND"] };

    const report = assertDsnReady(b, boardToDsn(b));

    expect(report.ok).toBe(true);
    expect(boardToDsn(b).integrity?.expectedEndpoints[0]?.padNumbers).toEqual(["1", "2"]);
  });

  it("blocks an unclassified exposed pad but ignores an explicit mechanical NPTH hole", () => {
    const mechanical: Pad = {
      number: "MH",
      type: "np_thru_hole",
      shape: { kind: "circle", radius: mmToNm(0.5) },
      at: { x: mmToNm(3), y: 0 },
      rotationDeg: 0,
      layers: [],
      drill: { diameter: mmToNm(0.8) },
    };
    const fp = inst("u1", "U1", [smdPad("1", 0), smdPad("EP", 1), mechanical], { "1": 1 });
    fp.pinPadMappings = [
      { componentInstanceId: "u1", endpointKey: "u1::1", symbolPinNumber: "1", padNumbers: ["1"], mappingKind: "electrical", provenance: "library-explicit" },
    ];
    fp.footprintPadClassifications = { MH: "mechanical" };
    const b = board({ 1: "SIG" }, [fp]);
    b.nets[1] = { id: 1, name: "SIG", stableId: "stable-sig", endpointKeys: ["u1::1"] };

    const blocked = validateDsn(b, boardToDsn(b));
    expect(blocked.issues.map((issue) => issue.code)).toContain("UNCLASSIFIED_FOOTPRINT_PAD");

    fp.footprintPadClassifications.EP = "intentional-no-connect";
    expect(assertDsnReady(b, boardToDsn(b)).ok).toBe(true);
  });
});
