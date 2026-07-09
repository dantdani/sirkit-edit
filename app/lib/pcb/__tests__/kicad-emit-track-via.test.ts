// Track/via emission (Stage 13): segment fields, via diameters/drill/layers.

import { describe, it, expect } from "vitest";
import { emitTrack } from "../kicad/emit-track";
import { emitVia } from "../kicad/emit-via";
import { createEmptyBoard } from "../types";
import type { PcbNetlist } from "../netlist-bridge";
import { mmToNm } from "../units";

const board = createEmptyBoard();
const netlist: PcbNetlist = { components: [], nets: [] };

describe("emitTrack", () => {
  it("(a) emits start/end/width/layer/net in KiCad mm", () => {
    const out = emitTrack(
      {
        id: "t1",
        layer: "copperTop",
        width: mmToNm(0.25),
        start: { x: 0, y: 0 },
        end: { x: mmToNm(10), y: 0 },
        netId: 5,
      },
      board,
      netlist,
    );
    expect(out).toMatch(
      /^\(segment \(start 0\.000000 0\.000000\) \(end 10\.000000 0\.000000\) \(width 0\.250000\) \(layer "F\.Cu"\) \(net 5\) \(uuid "[0-9a-f-]+"\)\)$/,
    );
  });

  it("bottom-layer track maps to B.Cu", () => {
    const out = emitTrack(
      { id: "t2", layer: "copperBottom", width: mmToNm(0.3), start: { x: 0, y: 0 }, end: { x: 1, y: 1 }, netId: 0 },
      board,
      netlist,
    );
    expect(out).toContain(`(layer "B.Cu")`);
    expect(out).toContain("(net 0)");
  });
});

describe("emitVia", () => {
  it("(b) emits outer diameter, drill, layer span, and net", () => {
    const out = emitVia(
      {
        id: "v1",
        at: { x: mmToNm(12), y: mmToNm(34.5) },
        size: mmToNm(0.6),
        drill: mmToNm(0.3),
        netId: 2,
        layers: ["copperTop", "copperBottom"],
      },
      board,
      netlist,
    );
    expect(out).toMatch(
      /^\(via \(at 12\.000000 34\.500000\) \(size 0\.600000\) \(drill 0\.300000\) \(layers "F\.Cu" "B\.Cu"\) \(net 2\) \(uuid "[0-9a-f-]+"\)\)$/,
    );
  });
});
