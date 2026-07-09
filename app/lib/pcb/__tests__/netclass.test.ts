// Net classes (Stage 10): getNetClass fallback + override, rule-delta apply +
// conflict resolution, and the deterministic auto-classifier.

import { describe, it, expect } from "vitest";
import { getNetClass, applyRuleDeltas, DEFAULT_CLASSES, type RuleDelta } from "../netclass";
import { autoClassifyNets, reclassifyBoard } from "../netclass-rules";
import { createEmptyBoard } from "../types";
import type { FootprintDef, FootprintInstance, PcbBoard } from "../types";
import { mmToNm } from "../units";

function board(netNames: Record<number, string>, footprints: FootprintInstance[] = []): PcbBoard {
  return {
    ...createEmptyBoard(),
    nets: [{ id: 0, name: "" }, ...Object.entries(netNames).map(([id, name]) => ({ id: Number(id), name }))],
    footprints,
  };
}

/** A footprint instance with N single-net pads (numbered "1".."N"). */
function padDef(padCount: number): FootprintDef {
  return {
    libName: "T",
    name: "IC",
    attributes: { smd: true, throughHole: false, excludeFromPos: false, excludeFromBom: false },
    pads: Array.from({ length: padCount }, (_, i) => ({
      number: String(i + 1),
      type: "smd" as const,
      shape: { kind: "rect" as const, width: mmToNm(0.5), height: mmToNm(0.5) },
      at: { x: mmToNm(i), y: 0 },
      rotationDeg: 0,
      layers: ["copperTop" as const, "maskTop" as const],
    })),
    graphics: [],
    bodyBBox: { minX: 0, minY: 0, maxX: mmToNm(padCount), maxY: mmToNm(1) },
    models: [],
    rawSexpr: "",
  };
}

function inst(id: string, padNets: Record<string, number>): FootprintInstance {
  const padCount = Math.max(1, ...Object.keys(padNets).map(Number));
  return {
    id,
    ref: id.toUpperCase(),
    footprintId: "T:IC",
    def: padDef(padCount),
    at: { x: 0, y: 0 },
    rotationDeg: 0,
    side: "top",
    padNets,
  };
}

describe("getNetClass", () => {
  it("returns Default when the net has no assignment", () => {
    const nc = getNetClass(board({ 1: "SIG" }), 1);
    expect(nc.id).toBe("Default");
    expect(nc.trackWidth).toBe(DEFAULT_CLASSES.Default.trackWidth);
    expect(nc.explanation).toBe("");
  });

  it("override on an assignment wins over the class default", () => {
    const b = board({ 1: "VCC" });
    b.netClassing = {
      version: 1,
      assignments: { 1: { classId: "Power", explanation: "manual", override: { trackWidth: 800_000 } } },
      ruleDeltas: [],
    };
    const nc = getNetClass(b, 1);
    expect(nc.id).toBe("Power");
    expect(nc.trackWidth).toBe(800_000); // override wins
    expect(nc.clearance).toBe(DEFAULT_CLASSES.Power.clearance); // untouched fields keep class default
  });
});

describe("applyRuleDeltas", () => {
  it("a namePattern delta sets Power on matching nets and leaves others alone", () => {
    const b = board({ 1: "VCC", 2: "VBUS", 3: "SPI_CLK" });
    const delta: RuleDelta = {
      id: "d1",
      createdAt: "2026-07-08T00:00:00.000Z",
      source: "manual",
      explanation: "All V* rails are power",
      changes: [{ className: "Power", appliesTo: { kind: "namePattern", regex: "^V.*" } }],
    };
    applyRuleDeltas(b, [delta]);
    expect(getNetClass(b, 1).id).toBe("Power");
    expect(getNetClass(b, 2).id).toBe("Power");
    expect(getNetClass(b, 3).id).toBe("Default"); // SPI_CLK untouched
    expect(b.netClassing?.ruleDeltas).toHaveLength(1);
  });

  it("the later delta (higher createdAt) wins on overlapping nets", () => {
    const b = board({ 1: "RAIL" });
    const early: RuleDelta = {
      id: "d-early",
      createdAt: "2026-07-08T00:00:00.000Z",
      source: "ai-brief",
      explanation: "make it Power",
      changes: [{ className: "Power", appliesTo: { kind: "nets", netIds: [1] } }],
    };
    const late: RuleDelta = {
      id: "d-late",
      createdAt: "2026-07-08T01:00:00.000Z",
      source: "ai-brief",
      explanation: "actually HighCurrent",
      changes: [{ className: "HighCurrent", appliesTo: { kind: "nets", netIds: [1] } }],
    };
    // Apply out of chronological order; sort-by-createdAt must still let `late` win.
    applyRuleDeltas(b, [late]);
    applyRuleDeltas(b, [early]);
    expect(getNetClass(b, 1).id).toBe("HighCurrent");
    expect(getNetClass(b, 1).explanation).toBe("actually HighCurrent");
  });

  it("class-scoped + net-scoped deltas are order-independent (regression)", () => {
    // net5 auto-classifies to Default → base recorded.
    const build = (): PcbBoard => {
      const b = board({ 5: "SIG5" });
      reclassifyBoard(b);
      return b;
    };
    const D1: RuleDelta = {
      id: "D1",
      createdAt: "2026-07-08T01:00:00.000Z",
      source: "manual",
      explanation: "widen the Default class",
      changes: [{ trackWidthNm: 300_000, appliesTo: { kind: "class", classId: "Default" } }],
    };
    const D2: RuleDelta = {
      id: "D2",
      createdAt: "2026-07-08T02:00:00.000Z",
      source: "manual",
      explanation: "net 5 is Power",
      changes: [{ className: "Power", appliesTo: { kind: "nets", netIds: [5] } }],
    };

    const a = build();
    applyRuleDeltas(a, [D1]);
    applyRuleDeltas(a, [D2]);

    const b2 = build();
    applyRuleDeltas(b2, [D2]);
    applyRuleDeltas(b2, [D1]);

    const ca = getNetClass(a, 5);
    const cb = getNetClass(b2, 5);
    // Same effective result in both call orders (was order-dependent before the base reset).
    expect(ca.id).toBe(cb.id);
    expect(ca.trackWidth).toBe(cb.trackWidth);
    // Deterministic value: D2 (latest) sets Power; D1's class-Default width matched the BASE.
    expect(ca.id).toBe("Power");
    expect(ca.trackWidth).toBe(300_000);
  });

  it("width-only change sets an override without changing the class", () => {
    const b = board({ 1: "GND" });
    reclassifyBoard(b); // GND → Power
    applyRuleDeltas(b, [
      {
        id: "d2",
        createdAt: "2026-07-08T02:00:00.000Z",
        source: "manual",
        explanation: "wider ground",
        changes: [{ trackWidthNm: 1_000_000, appliesTo: { kind: "nets", netIds: [1] } }],
      },
    ]);
    const nc = getNetClass(b, 1);
    expect(nc.id).toBe("Power"); // class unchanged
    expect(nc.trackWidth).toBe(1_000_000); // override applied
  });
});

describe("autoClassifyNets", () => {
  it("classifies by name: +5V→Power, MOTOR_A→HighCurrent, SPI_MOSI→Default, GND→Power", () => {
    const a = autoClassifyNets(board({ 1: "+5V", 2: "MOTOR_A", 3: "SPI_MOSI", 4: "GND" }));
    expect(a[1].classId).toBe("Power");
    expect(a[1].explanation).toMatch(/power-net convention/);
    expect(a[2].classId).toBe("HighCurrent");
    expect(a[2].explanation).toMatch(/high-current/);
    expect(a[3].classId).toBe("Default");
    expect(a[4].classId).toBe("Power"); // ground is Power-class in our model
  });

  it("classifies an unnamed rail by topology (≥5 instances + IC power pin)", () => {
    // "RAIL_A" doesn't match any name heuristic (no PWR/VDD/VCC/SUPPLY token).
    const footprints = ["u1", "u2", "u3", "u4", "u5", "u6"].map((id) => inst(id, { "1": 7 }));
    const b = board({ 7: "RAIL_A" }, footprints);
    // u1.pad1 is the IC's VCC pin (pin name from the netlist).
    const pinNames = { u1: { "1": "VCC" } };
    const a = autoClassifyNets(b, { pinNames });
    expect(a[7].classId).toBe("Power");
    expect(a[7].explanation).toMatch(/Topology/);
  });

  it("does NOT topology-classify a rail without an IC power pin", () => {
    const footprints = ["u1", "u2", "u3", "u4", "u5", "u6"].map((id) => inst(id, { "1": 7 }));
    const a = autoClassifyNets(board({ 7: "RAIL_A" }, footprints)); // no pinNames
    expect(a[7].classId).toBe("Default");
  });
});
