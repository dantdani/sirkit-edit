// DRC engine (Stage 12): empty board, the routed demo under a strict preset
// (< 200 ms + surfaces the short), loose rules pass, deterministic sort, and
// plain-English summaries (no codes).

import { describe, it, expect } from "vitest";
import { runDrc } from "../drc/run-drc";
import { getPreset } from "../drc/presets";
import { createEmptyBoard } from "../types";
import type { PcbBoard, Track } from "../types";
import type { DrcRules } from "../drc/types";
import { buildRoutedDemo } from "../demo/routed-demo";
import { mmToNm } from "../units";

const JLC = getPreset("jlcpcb-2l").rules;

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

describe("runDrc", () => {
  it("(a) empty board → clean, zero violations, zero checked items", () => {
    const res = runDrc(createEmptyBoard(), JLC);
    expect(res.ok).toBe(true);
    expect(res.violations).toEqual([]);
    expect(res.stats.checkedItems).toBe(0);
  });

  it("(b) routed demo + jlcpcb-2l → not ok, ≥1 violation, under 200 ms", () => {
    const res = runDrc(buildRoutedDemo(), JLC, { presetId: "jlcpcb-2l" });
    expect(res.ok).toBe(false); // the deliberate short is an error
    expect(res.violations.length).toBeGreaterThanOrEqual(1);
    expect(res.violations.some((v) => v.kind === "short")).toBe(true);
    expect(res.presetId).toBe("jlcpcb-2l");
    expect(res.stats.elapsedMs).toBeLessThan(200);
    // report the measured value for the record
    console.log(`[run-drc] demo DRC: ${res.violations.length} violations in ${res.stats.elapsedMs.toFixed(2)} ms`);
  });

  it("(c) loosening every rule to 0 clears rule-based errors (a lone thin track → ok)", () => {
    // one thin track on its own net: a minTrackWidth error under JLC, only a
    // (non-error) unconnected warning under ZERO rules.
    const thin: Track = {
      id: "t1",
      layer: "copperTop",
      width: mmToNm(0.05),
      start: { x: mmToNm(40), y: mmToNm(40) },
      end: { x: mmToNm(50), y: mmToNm(40) },
      netId: 1,
    };
    const b: PcbBoard = {
      ...createEmptyBoard(),
      nets: [
        { id: 0, name: "" },
        { id: 1, name: "N1" },
      ],
      tracks: [thin],
    };
    expect(runDrc(b, JLC).ok).toBe(false); // thin track fails minTrackWidth
    const loose = runDrc(b, ZERO);
    expect(loose.ok).toBe(true); // no errors remain
    expect(loose.violations.some((v) => v.severity === "error")).toBe(false);
  });

  it("(d) violation order is deterministic and severity-grouped across two runs", () => {
    const b = buildRoutedDemo();
    const a = runDrc(b, JLC);
    const c = runDrc(b, JLC);
    expect(a.violations.map((v) => v.id)).toEqual(c.violations.map((v) => v.id));
    // errors precede warnings precede info
    const sev = a.violations.map((v) => v.severity);
    const rank = { error: 0, warning: 1, info: 2 } as const;
    for (let i = 1; i < sev.length; i++) expect(rank[sev[i]]).toBeGreaterThanOrEqual(rank[sev[i - 1]]);
  });

  it("(e) every violation summary is plain English (no CLR / VIA_ / DRC_ codes)", () => {
    const res = runDrc(buildRoutedDemo(), JLC);
    expect(res.violations.length).toBeGreaterThan(0);
    for (const v of res.violations) {
      expect(v.summary).not.toMatch(/CLR|VIA_|DRC_/);
      expect(v.summary.length).toBeLessThanOrEqual(120);
    }
  });
});
