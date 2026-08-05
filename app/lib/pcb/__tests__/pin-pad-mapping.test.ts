import { describe, expect, it } from "vitest";
import type { FootprintDef, Pad } from "../types";
import { mmToNm } from "../units";
import { resolvePinPadMapping, type PinPadComponent } from "../pin-pad-mapping";
import { schematicEndpointKey } from "../integrity";

function pad(number: string, type: Pad["type"] = "smd"): Pad {
  return {
    number,
    type,
    shape: { kind: "rect", width: mmToNm(1), height: mmToNm(1) },
    at: { x: 0, y: 0 },
    rotationDeg: 0,
    layers: type === "np_thru_hole" ? [] : ["copperTop", "maskTop", "pasteTop"],
  };
}

function footprint(pads: Pad[]): FootprintDef {
  return {
    libName: "Audit",
    name: "MappingFixture",
    attributes: { smd: true, throughHole: false, excludeFromPos: false, excludeFromBom: false },
    pads,
    graphics: [],
    bodyBBox: { minX: 0, minY: 0, maxX: mmToNm(2), maxY: mmToNm(2) },
    models: [],
    rawSexpr: "(footprint MappingFixture)",
  };
}

function netMap(componentId: string, entries: Record<string, number>): Map<string, number> {
  return new Map(Object.entries(entries).map(([pin, netId]) => [schematicEndpointKey(componentId, pin), netId]));
}

describe("explicit pin-to-pad mapping invariant", () => {
  it("rejects equal-count 1,3 symbol pins against 1,2 footprint pads", () => {
    const component: PinPadComponent = { id: "r7", ref: "R7", pins: [{ number: "1" }, { number: "3" }] };
    const result = resolvePinPadMapping(component, footprint([pad("1"), pad("2")]), netMap("r7", { "1": 1, "3": 2 }));
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("UNMAPPED_SCHEMATIC_PIN");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("UNCLASSIFIED_FOOTPRINT_PAD");
  });

  it("maps exact alphanumeric identifiers independently of array order", () => {
    const component: PinPadComponent = { id: "u1", ref: "U1", pins: [{ number: "A2" }, { number: "A1" }] };
    const result = resolvePinPadMapping(component, footprint([pad("A1"), pad("A2")]), netMap("u1", { A1: 1, A2: 2 }));
    expect(result.ok).toBe(true);
    expect(result.mappings.map((mapping) => mapping.symbolPinNumber)).toEqual(["A1", "A2"]);
    expect(result.padNets).toEqual({ A1: 1, A2: 2 });
  });

  it("supports trusted one-to-many, exposed-pad, mechanical, and intentional no-connect classifications", () => {
    const component: PinPadComponent = {
      id: "u2",
      ref: "U2",
      pins: [{ number: "GND" }, { number: "EP" }, { number: "NC" }],
      pinPadMapping: {
        mappings: [
          { symbolPinNumber: "GND", padNumbers: ["1", "2"], mappingKind: "internally-common", provenance: "library-explicit" },
          { symbolPinNumber: "EP", padNumbers: ["EP"], mappingKind: "exposed-pad", provenance: "library-explicit" },
          { symbolPinNumber: "NC", padNumbers: ["NC"], mappingKind: "intentional-no-connect", provenance: "library-explicit" },
        ],
        footprintPadClassifications: { M: "mechanical" },
      },
    };
    const result = resolvePinPadMapping(
      component,
      footprint([pad("2"), pad("M"), pad("EP"), pad("1"), pad("NC")]),
      netMap("u2", { GND: 1, EP: 2 }),
    );
    expect(result.ok).toBe(true);
    expect(result.padNets).toEqual({ "1": 1, "2": 1, EP: 2 });
    expect(result.accounting.classifiedExtraPads).toEqual(["M"]);
    expect(result.accounting.intentionalSchematicOnlyPins).toEqual(["NC"]);
  });

  it("maps multiple physical pads sharing one exact pad number to one logical pin", () => {
    const component: PinPadComponent = { id: "q1", ref: "Q1", pins: [{ number: "1" }] };
    const result = resolvePinPadMapping(component, footprint([pad("1"), pad("1")]), netMap("q1", { "1": 4 }));
    expect(result.ok).toBe(true);
    expect(result.mappings[0].padNumbers).toEqual(["1"]);
    expect(result.padNets).toEqual({ "1": 4 });
  });

  it("rejects two different nets claiming one pad even when mappings say internally common", () => {
    const component: PinPadComponent = {
      id: "u3",
      ref: "U3",
      pins: [{ number: "A" }, { number: "B" }],
      pinPadMapping: {
        mappings: [
          { symbolPinNumber: "A", padNumbers: ["1"], mappingKind: "internally-common" },
          { symbolPinNumber: "B", padNumbers: ["1"], mappingKind: "internally-common" },
        ],
      },
    };
    const result = resolvePinPadMapping(component, footprint([pad("1")]), netMap("u3", { A: 1, B: 2 }));
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "PAD_NET_CONFLICT")).toBe(true);
  });

  it("accepts explicitly internally-common symbol pins while their shared pad is unconnected", () => {
    const component: PinPadComponent = {
      id: "u-open", ref: "U5", pins: [{ number: "A" }, { number: "B" }],
      pinPadMapping: { mappings: [
        { symbolPinNumber: "A", padNumbers: ["1"], mappingKind: "internally-common" },
        { symbolPinNumber: "B", padNumbers: ["1"], mappingKind: "internally-common" },
      ] },
    };
    const result = resolvePinPadMapping(component, footprint([pad("1")]), new Map());
    expect(result.ok).toBe(true);
    expect(result.padNets).toEqual({});
  });

  it("rejects a no-connect/schematic-only classification when the endpoint is on a routable net", () => {
    const component: PinPadComponent = {
      id: "u4", ref: "U4", pins: [{ number: "NC" }],
      pinPadMapping: { schematicPinClassifications: { NC: "intentional-no-connect" } },
    };
    const result = resolvePinPadMapping(component, footprint([]), netMap("u4", { NC: 9 }));
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "CONNECTED_NONPHYSICAL_PIN_UNSUPPORTED")).toBe(true);
  });
});
