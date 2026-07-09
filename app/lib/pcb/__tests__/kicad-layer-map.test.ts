// Layer map (Stage 13): exhaustive over LayerId, agrees with Stage 1's LAYERS
// table, canonical types, and the (layers ...) header covers everything KiCad
// requires for 2- and 4-layer stackups.

import { describe, it, expect } from "vitest";
import { LAYER_MAP, toKicadLayer, toKicadLayerCanonical, layerHeaderEntries } from "../kicad/layer-map";
import { LAYERS } from "../layers";

describe("kicad/layer-map", () => {
  it("(a) every LayerId has a LAYER_MAP entry, matching Stage 1's kicadName", () => {
    for (const layer of LAYERS) {
      expect(LAYER_MAP[layer.id], layer.id).toBe(layer.kicadName);
      expect(toKicadLayer(layer.id)).toBe(layer.kicadName);
    }
    expect(Object.keys(LAYER_MAP).length).toBe(LAYERS.length);
  });

  it("(b) toKicadLayerCanonical('copperTop') → { name: 'F.Cu', type: 'signal' }", () => {
    expect(toKicadLayerCanonical("copperTop")).toEqual({ name: "F.Cu", type: "signal" });
    expect(toKicadLayerCanonical("in1")).toEqual({ name: "In1.Cu", type: "signal" });
    expect(toKicadLayerCanonical("edge")).toEqual({ name: "Edge.Cuts", type: "user" });
    expect(toKicadLayerCanonical("silkTop")).toEqual({ name: "F.SilkS", type: "user" });
  });

  it("(c) 4-layer header includes In1.Cu and In2.Cu; 2-layer omits them", () => {
    const four = layerHeaderEntries(4).map((e) => e.name);
    expect(four).toContain("In1.Cu");
    expect(four).toContain("In2.Cu");
    const two = layerHeaderEntries(2).map((e) => e.name);
    expect(two).not.toContain("In1.Cu");
    expect(two).not.toContain("In2.Cu");
  });

  it("header always carries the standard non-copper set KiCad's loader needs", () => {
    const required = [
      "Edge.Cuts", "F.Mask", "B.Mask", "F.Paste", "B.Paste", "F.SilkS", "B.SilkS",
      "F.CrtYd", "B.CrtYd", "F.Fab", "B.Fab", "Cmts.User", "Eco1.User", "Eco2.User", "Dwgs.User",
    ];
    for (const stackup of [2, 4] as const) {
      const names = layerHeaderEntries(stackup).map((e) => e.name);
      for (const name of required) expect(names, `${stackup}-layer`).toContain(name);
      // ordinals strictly increasing → stable, parseable header
      const ordinals = layerHeaderEntries(stackup).map((e) => e.ordinal);
      expect([...ordinals].sort((a, b) => a - b)).toEqual(ordinals);
    }
  });
});
