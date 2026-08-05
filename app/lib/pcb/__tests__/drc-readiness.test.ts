import { describe, expect, it } from "vitest";
import { runDrc } from "../drc/run-drc";
import type { DrcRules } from "../drc/types";
import type { FootprintDef, FootprintInstance, PcbBoard, Track } from "../types";
import { createEmptyBoard } from "../types";
import { mmToNm } from "../units";
import { normalizeDrcReport } from "../ai/violation-normalizer";

const mm = mmToNm;
const ZERO: DrcRules = {
  default: {
    clearanceNm: 0,
    minTrackWidthNm: 0,
    minViaOuterNm: 0,
    minViaDrillNm: 0,
    minAnnularRingNm: 0,
    minHoleToHoleNm: 0,
    minEdgeClearanceNm: 0,
    minSilkPadClearanceNm: 0,
    minCourtyardClearanceNm: 0,
  },
  perClass: {},
};

const DEF: FootprintDef = {
  libName: "test",
  name: "one-pad",
  attributes: { smd: true, throughHole: false, excludeFromPos: false, excludeFromBom: false },
  pads: [{
    number: "1",
    type: "smd",
    shape: { kind: "circle", radius: mm(0.2) },
    at: { x: 0, y: 0 },
    rotationDeg: 0,
    layers: ["copperTop"],
  }],
  graphics: [],
  bodyBBox: { minX: mm(-1), minY: mm(-1), maxX: mm(1), maxY: mm(1) },
  models: [],
  rawSexpr: "",
};

function part(id: string, ref: string, x: number, y: number, overhang?: boolean): FootprintInstance {
  return {
    id,
    ref,
    footprintId: "test:one-pad",
    def: DEF,
    at: { x: mm(x), y: mm(y) },
    rotationDeg: 0,
    side: "top",
    padNets: { "1": 1 },
    ...(overhang === undefined ? {} : { bodyMayOverhang: overhang }),
  };
}

function track(id: string, ax: number, ay: number, bx: number, by: number): Track {
  return {
    id,
    layer: "copperTop",
    width: mm(0.2),
    start: { x: mm(ax), y: mm(ay) },
    end: { x: mm(bx), y: mm(by) },
    netId: 1,
  };
}

function board(footprints: FootprintInstance[], tracks: Track[] = []): PcbBoard {
  return {
    ...createEmptyBoard(),
    outline: { kind: "rect", origin: { x: 0, y: 0 }, width: mm(10), height: mm(10) },
    nets: [
      { id: 0, name: "", stableId: "net:unconnected", endpointKeys: [] },
      { id: 1, name: "SIGNAL", stableId: "net:signal", endpointKeys: [] },
    ],
    footprints,
    tracks,
  };
}

describe("DRC containment and execution summary", () => {
  it("blocks a completely unrouted net and reports remaining airwires", () => {
    const result = runDrc(board([part("a", "J1", 2, 5), part("b", "U1", 8, 5)]), ZERO);
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.kind === "incompleteNet" && v.severity === "error")).toBe(true);
    expect(result.summary).toMatchObject({ state: "failed", incompleteNets: 1, unroutedConnections: 1 });
  });

  it("blocks a partially routed three-pad net", () => {
    const result = runDrc(
      board(
        [part("a", "J1", 2, 5), part("b", "U1", 5, 5), part("c", "U2", 8, 5)],
        [track("ab", 2, 5, 5, 5)],
      ),
      ZERO,
    );
    expect(result.summary.state).toBe("failed");
    expect(result.summary.unroutedConnections).toBe(1);
  });

  it("marks a fully routed, contained net DRC-passed without making a fabrication claim", () => {
    const result = runDrc(
      board([part("a", "J1", 2, 5), part("b", "U1", 8, 5)], [track("ab", 2, 5, 8, 5)]),
      ZERO,
    );
    expect(result.violations).toEqual([]);
    expect(result.summary).toMatchObject({ state: "passed", errors: 0, warnings: 0, unroutedConnections: 0 });
  });

  it("blocks pads and tracks outside the manufactured outline", () => {
    const result = runDrc(
      board([part("outside", "J1", -0.5, 5), part("inside", "U1", 8, 5)], [track("edge", -0.5, 5, 8, 5)]),
      ZERO,
    );
    expect(result.violations.some((v) => v.kind === "padOutsideBoard" && v.severity === "error")).toBe(true);
    expect(result.violations.some((v) => v.kind === "trackOutsideBoard" && v.severity === "error")).toBe(true);
    expect(result.summary.state).toBe("failed");
  });

  it("allows an explicitly reviewed connector body overhang when its pad remains inside", () => {
    const result = runDrc(board([part("connector", "J1", 0.3, 5, true)]), ZERO);
    expect(result.violations.some((v) => v.kind === "footprintOutsideBoard")).toBe(false);
    expect(result.violations.some((v) => v.kind === "padOutsideBoard")).toBe(false);
  });

  it("normalizes exact footprint IDs even when a geometry violation has no copper item", () => {
    const b = board([part("connector", "J1", 0.3, 5, false)]);
    const result = runDrc(b, ZERO);
    const normalized = normalizeDrcReport(b, result).find((violation) => violation.type === "footprintOutsideBoard");
    expect(normalized?.objectIds).toContain("connector");
  });

  it("enforces an explicitly assigned manual net width in DRC", () => {
    const b = board([part("a", "J1", 2, 5), part("b", "U1", 8, 5)], [track("ab", 2, 5, 8, 5)]);
    b.netClassing = {
      version: 1,
      assignments: {
        1: { classId: "Default", explanation: "manual", override: { trackWidth: mm(0.5) } },
      },
      ruleDeltas: [],
    };
    const result = runDrc(b, ZERO);
    expect(result.violations.some((v) => v.kind === "minTrackWidth" && v.thresholdNm === mm(0.5))).toBe(true);
  });
});
