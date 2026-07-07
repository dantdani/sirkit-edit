// Copper distance primitives (PCB Stage 6) — pinned contract tests.
// Distances are integer nm; expected values are EXACT (no epsilon fudge).

import { describe, expect, it } from "vitest";
import { mmToNm } from "../units";
import type { Vec2 } from "../geometry";
import type { Pad, Track, Via, FootprintInstance, FootprintDef } from "../types";
import type { LayerId } from "../layers";
import {
  padPadDistance,
  padWorldPosition,
  segmentDistance,
  trackPadDistance,
  trackTrackDistance,
  trackViaDistance,
  viaPadDistance,
  viaViaDistance,
} from "../geometry-copper";

const mm = (v: number): number => mmToNm(v);
const v = (xMm: number, yMm: number): Vec2 => ({ x: mm(xMm), y: mm(yMm) });

let trackN = 0;
function track(start: Vec2, end: Vec2, widthMm: number, layer: LayerId = "copperTop"): Track {
  return { id: `t${++trackN}`, layer, width: mm(widthMm), start, end, netId: 1 };
}

let viaN = 0;
function via(at: Vec2, sizeMm: number, layers: Via["layers"] = ["copperTop", "copperBottom"]): Via {
  return { id: `v${++viaN}`, at, size: mm(sizeMm), drill: mm(sizeMm / 2), netId: 1, layers };
}

function circlePad(number: string, atMm: Vec2, radiusMm: number, layers: LayerId[] = ["copperTop"]): Pad {
  return {
    number,
    type: "smd",
    shape: { kind: "circle", radius: mm(radiusMm) },
    at: { x: mm(atMm.x), y: mm(atMm.y) },
    rotationDeg: 0,
    layers,
  };
}

function instWith(
  pads: Pad[],
  atMm: Vec2,
  rotationDeg = 0,
  side: "top" | "bottom" = "top",
): FootprintInstance {
  const def: FootprintDef = {
    libName: "test",
    name: "fp",
    attributes: { smd: true, throughHole: false, excludeFromPos: false, excludeFromBom: false },
    pads,
    graphics: [],
    bodyBBox: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    models: [],
    rawSexpr: "",
  };
  return {
    id: "i1",
    ref: "U1",
    footprintId: "test:fp",
    def,
    at: { x: mm(atMm.x), y: mm(atMm.y) },
    rotationDeg,
    side,
    padNets: {},
  };
}

describe("segmentDistance", () => {
  it("parallel segments: exact centerline gap", () => {
    expect(segmentDistance(v(0, 0), v(10, 0), v(0, 2), v(10, 2))).toBe(mm(2));
  });

  it("crossing segments → 0", () => {
    expect(segmentDistance(v(0, 0), v(10, 10), v(0, 10), v(10, 0))).toBe(0);
  });

  it("collinear with a gap: exact end-to-end distance", () => {
    expect(segmentDistance(v(0, 0), v(2, 0), v(5, 0), v(8, 0))).toBe(mm(3));
  });

  it("collinear overlapping → 0", () => {
    expect(segmentDistance(v(0, 0), v(5, 0), v(3, 0), v(8, 0))).toBe(0);
  });

  it("touching at a shared endpoint → 0", () => {
    expect(segmentDistance(v(0, 0), v(5, 0), v(5, 0), v(5, 5))).toBe(0);
  });
});

describe("trackTrackDistance", () => {
  it("capsules at exactly width/2 + width/2 separation → 0", () => {
    const a = track(v(0, 0), v(10, 0), 0.4);
    const b = track(v(0, 0.4), v(10, 0.4), 0.4);
    expect(trackTrackDistance(a, b)).toBe(0);
  });

  it("overlapping capsules → negative", () => {
    const a = track(v(0, 0), v(10, 0), 0.4);
    const b = track(v(0, 0.3), v(10, 0.3), 0.4);
    expect(trackTrackDistance(a, b)).toBe(-mm(0.1));
  });

  it("different layers → Infinity", () => {
    const a = track(v(0, 0), v(10, 0), 0.4, "copperTop");
    const b = track(v(0, 0), v(10, 0), 0.4, "copperBottom");
    expect(trackTrackDistance(a, b)).toBe(Infinity);
  });

  it("vertical vs horizontal crossing → negative overlap", () => {
    const a = track(v(5, -5), v(5, 5), 0.2);
    const b = track(v(0, 0), v(10, 0), 0.2);
    expect(trackTrackDistance(a, b)).toBe(-mm(0.2));
  });
});

describe("trackViaDistance", () => {
  it("track ending exactly at the via center → -(size/2 + width/2)", () => {
    const t = track(v(0, 0), v(2, 0), 0.3);
    expect(trackViaDistance(t, via(v(2, 0), 0.6))).toBe(-mm(0.45));
  });

  it("via not spanning the track's layer → Infinity", () => {
    const t = track(v(0, 0), v(2, 0), 0.3, "copperBottom");
    expect(trackViaDistance(t, via(v(2, 0), 0.6, ["copperTop", "copperTop"]))).toBe(Infinity);
  });

  it("clear separation is exact", () => {
    const t = track(v(0, 0), v(2, 0), 0.3);
    expect(trackViaDistance(t, via(v(4, 0), 0.6))).toBe(mm(2 - 0.3 - 0.15));
  });
});

describe("trackPadDistance", () => {
  it("track ending exactly on a circular pad center → exact negative, zero fudge", () => {
    const inst = instWith([circlePad("1", { x: 1, y: 0 }, 0.5)], { x: 10, y: 10 });
    const t = track(v(8, 10), v(11, 10), 0.2);
    expect(trackPadDistance(t, inst, inst.def.pads[0])).toBe(-mm(0.6));
  });

  it("same, with the instance rotated 90° (pad world position moves)", () => {
    const inst = instWith([circlePad("1", { x: 1, y: 0 }, 0.5)], { x: 10, y: 10 }, 90);
    // KiCad CCW with +y down: local (1,0) rotates to screen-up → world (10, 9).
    expect(padWorldPosition(inst, inst.def.pads[0])).toEqual(v(10, 9));
    const t = track(v(10, 6), v(10, 9), 0.2);
    expect(trackPadDistance(t, inst, inst.def.pads[0])).toBe(-mm(0.6));
  });

  it("pad without copper on the track's layer → Infinity", () => {
    const inst = instWith([circlePad("1", { x: 0, y: 0 }, 0.5)], { x: 0, y: 0 });
    const t = track(v(0, 0), v(1, 0), 0.2, "copperBottom");
    expect(trackPadDistance(t, inst, inst.def.pads[0])).toBe(Infinity);
  });

  it("bottom-side instance mirrors the pad across x", () => {
    const inst = instWith([circlePad("1", { x: 1, y: 0 }, 0.5)], { x: 10, y: 10 }, 0, "bottom");
    expect(padWorldPosition(inst, inst.def.pads[0])).toEqual(v(9, 10));
    // Bottom-side flips the pad's copper to copperBottom.
    const tBot = track(v(7, 10), v(9, 10), 0.2, "copperBottom");
    expect(trackPadDistance(tBot, inst, inst.def.pads[0])).toBe(-mm(0.6));
    const tTop = track(v(7, 10), v(9, 10), 0.2, "copperTop");
    expect(trackPadDistance(tTop, inst, inst.def.pads[0])).toBe(Infinity);
  });
});

describe("viaViaDistance / viaPadDistance / padPadDistance", () => {
  it("via barrels at exactly size/2 + size/2 separation → 0", () => {
    expect(viaViaDistance(via(v(0, 0), 0.6), via(v(0.6, 0), 0.6))).toBe(0);
  });

  it("vias with disjoint layer spans → Infinity", () => {
    const a = via(v(0, 0), 0.6, ["copperTop", "in1"]);
    const b = via(v(0, 0), 0.6, ["in2", "copperBottom"]);
    expect(viaViaDistance(a, b)).toBe(Infinity);
  });

  it("via sitting exactly on a circular pad center → exact negative", () => {
    const inst = instWith([circlePad("1", { x: 0, y: 0 }, 0.5)], { x: 3, y: 3 });
    expect(viaPadDistance(via(v(3, 3), 0.6), inst, inst.def.pads[0])).toBe(-mm(0.8));
  });

  it("pad-pad gap between two instances is exact", () => {
    const a = instWith([circlePad("1", { x: 0, y: 0 }, 0.5)], { x: 0, y: 0 });
    const b = instWith([circlePad("1", { x: 0, y: 0 }, 0.5)], { x: 2, y: 0 });
    expect(padPadDistance(a, a.def.pads[0], b, b.def.pads[0])).toBe(mm(1));
  });
});
