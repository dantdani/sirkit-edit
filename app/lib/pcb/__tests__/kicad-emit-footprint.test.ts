// Footprint emission (Stage 13): position/rotation on the (at ...) header,
// bottom-side layer flip, net omission on unconnected pads, unique UUIDs.
//
// Rotation contract: sirkit's rotationDeg is ALREADY KiCad-convention
// (CCW-positive, +y down — geometry.ts). The UI's one-click 90° CW rotation
// stores 270, which emits as -90 via (-180, 180] normalization. Angles are
// never sign-flipped: a footprint parsed from a .kicad_mod at 90 re-emits 90.

import { describe, it, expect } from "vitest";
import { emitFootprint } from "../kicad/emit-footprint";
import type { FootprintDef, FootprintInstance, PcbBoard } from "../types";
import { createEmptyBoard } from "../types";
import type { PcbNetlist } from "../netlist-bridge";
import { mmToNm } from "../units";

function testDef(): FootprintDef {
  return {
    libName: "Resistor_SMD",
    name: "R_0603_1608Metric",
    attributes: { smd: true, throughHole: false, excludeFromPos: false, excludeFromBom: false },
    pads: [
      {
        number: "1",
        type: "smd",
        shape: { kind: "rect", width: mmToNm(0.9), height: mmToNm(0.9) },
        at: { x: mmToNm(-0.75), y: 0 },
        rotationDeg: 0,
        layers: ["copperTop", "maskTop", "pasteTop"],
      },
      {
        number: "2",
        type: "smd",
        shape: { kind: "rect", width: mmToNm(0.9), height: mmToNm(0.9) },
        at: { x: mmToNm(0.75), y: 0 },
        rotationDeg: 0,
        layers: ["copperTop", "maskTop", "pasteTop"],
      },
    ],
    graphics: [
      {
        kind: "text",
        textKind: "reference",
        text: "REF**",
        at: { x: 0, y: mmToNm(-1.5) },
        rotationDeg: 0,
        sizeX: mmToNm(1),
        sizeY: mmToNm(1),
        thickness: mmToNm(0.15),
        layer: "silkTop",
      },
      {
        kind: "text",
        textKind: "value",
        text: "10k",
        at: { x: 0, y: mmToNm(1.5) },
        rotationDeg: 0,
        sizeX: mmToNm(1),
        sizeY: mmToNm(1),
        thickness: mmToNm(0.15),
        layer: "fabTop",
      },
      {
        kind: "line",
        start: { x: mmToNm(-1.5), y: mmToNm(-0.9) },
        end: { x: mmToNm(1.5), y: mmToNm(-0.9) },
        width: mmToNm(0.12),
        layer: "courtyardTop",
      },
    ],
    bodyBBox: { minX: mmToNm(-1.5), minY: mmToNm(-0.9), maxX: mmToNm(1.5), maxY: mmToNm(0.9) },
    models: [],
    rawSexpr: "",
  };
}

function instance(overrides: Partial<FootprintInstance> = {}): FootprintInstance {
  return {
    id: "fp-1",
    ref: "R7",
    footprintId: "Resistor_SMD:R_0603_1608Metric",
    def: testDef(),
    at: { x: mmToNm(152.4), y: mmToNm(76.2) },
    rotationDeg: 0,
    side: "top",
    padNets: { "1": 5, "2": 3 },
    ...overrides,
  };
}

function board(): PcbBoard {
  const b = createEmptyBoard();
  b.nets = [
    { id: 0, name: "" },
    { id: 3, name: "GND" },
    { id: 5, name: "VBUS" },
  ];
  return b;
}

const netlist: PcbNetlist = { components: [], nets: [] };

describe("emitFootprint", () => {
  it("(a) one UI 90°-CW turn (stored 270) emits 'at 152.400000 76.200000 -90.000000'", () => {
    const out = emitFootprint(instance({ rotationDeg: 270 }), board(), netlist);
    expect(out).toContain("(at 152.400000 76.200000 -90.000000)");
  });

  it("(a2) KiCad-parsed 90 passes through unmodified — no sign flip", () => {
    const out = emitFootprint(instance({ rotationDeg: 90 }), board(), netlist);
    expect(out).toContain("(at 152.400000 76.200000 90.000000)");
  });

  it("(a3) rotation 0 omits the angle", () => {
    const out = emitFootprint(instance(), board(), netlist);
    expect(out).toContain("(at 152.400000 76.200000)");
  });

  it("(b) bottom-side footprint: (layer \"B.Cu\") header, pad layers flip, x mirrors", () => {
    const out = emitFootprint(instance({ side: "bottom" }), board(), netlist);
    expect(out).toContain(`(layer "B.Cu")`);
    expect(out).toContain(`(layers "B.Cu" "B.Mask" "B.Paste")`);
    expect(out).not.toContain(`(layers "F.Cu"`);
    // pad 1 local x mirrors: -0.75 → 0.75 (both pads present, mirrored)
    expect(out).toContain("(at 0.750000 0.000000)");
    expect(out).toContain("(at -0.750000 0.000000)");
    // courtyard + text layers flip too
    expect(out).toContain(`(layer "B.CrtYd")`);
    expect(out).toContain(`(layer "B.SilkS")`);
  });

  it("(c) unconnected pad (missing / net 0) omits the (net ...) block", () => {
    const out = emitFootprint(instance({ padNets: { "1": 5 } }), board(), netlist);
    expect(out).toContain(`(net 5 "VBUS")`);
    // exactly one (net ...) — pad 2 has none
    expect(out.match(/\(net /g)?.length).toBe(1);

    const zeroed = emitFootprint(instance({ padNets: { "1": 0, "2": 0 } }), board(), netlist);
    expect(zeroed).not.toContain("(net ");
  });

  it("(d) footprint + every pad/graphic carry unique UUIDs", () => {
    const out = emitFootprint(instance(), board(), netlist);
    const uuids = [...out.matchAll(/\(uuid "([0-9a-f-]+)"\)/g)].map((m) => m[1]);
    // footprint + 2 properties + 1 line + 2 pads = 6
    expect(uuids.length).toBe(6);
    expect(new Set(uuids).size).toBe(uuids.length);
  });

  it("emits Reference/Value properties and the library name", () => {
    const out = emitFootprint(instance(), board(), netlist);
    expect(out).toContain(`footprint "Resistor_SMD:R_0603_1608Metric"`);
    expect(out).toContain(`property "Reference" "R7"`);
    expect(out).toContain(`property "Value" "10k"`);
    expect(out).toContain("(attr smd)");
  });

  it("pad angles are absolute (footprint angle folded in)", () => {
    const def = testDef();
    def.pads[0].rotationDeg = 45;
    const out = emitFootprint(instance({ def, rotationDeg: 90 }), board(), netlist);
    // top side: 90 + 45 = 135, position stays footprint-local
    expect(out).toContain("(at -0.750000 0.000000 135.000000)");
  });
});
