// DRC fab presets (Stage 12): JSON parses, mm→nm conversion is exact integer nm.

import { describe, it, expect } from "vitest";
import { PRESETS, getPreset, convertMmToNm } from "../drc/presets";
import type { DrcPresetId, DrcRuleSet } from "../drc/types";

const IDS: DrcPresetId[] = ["jlcpcb-2l", "jlcpcb-4l", "pcbway-standard", "oshpark-4l"];

describe("DRC presets", () => {
  it("(a) every preset parses; default has all *Nm fields present and manufacturing minima > 0", () => {
    expect(PRESETS).toHaveLength(4);
    const positiveKeys: (keyof DrcRuleSet)[] = [
      "clearanceNm",
      "minTrackWidthNm",
      "minViaOuterNm",
      "minViaDrillNm",
      "minAnnularRingNm",
      "minHoleToHoleNm",
      "minEdgeClearanceNm",
      "minSilkPadClearanceNm",
    ];
    for (const id of IDS) {
      const preset = getPreset(id);
      expect(preset.id).toBe(id);
      const d = preset.rules.default;
      for (const key of positiveKeys) expect(d[key]).toBeGreaterThan(0);
      expect(d.minCourtyardClearanceNm).toBeGreaterThanOrEqual(0); // 0 = touching allowed
      expect(preset.verifiedAt).toBeTruthy();
      expect(preset.specUrl).toContain("http");
    }
  });

  it("(b) convertMmToNm yields exact integer nm for present keys only (no float drift)", () => {
    expect(convertMmToNm({ clearanceMm: 0.127 })).toEqual({ clearanceNm: 127_000 });
    expect(convertMmToNm({ minViaOuterMm: 0.6, minViaDrillMm: 0.3 })).toEqual({
      minViaOuterNm: 600_000,
      minViaDrillNm: 300_000,
    });
    // ignores non-*Mm keys and non-numbers
    expect(convertMmToNm({ id: "x", clearanceMm: 0.2 })).toEqual({ clearanceNm: 200_000 });
  });

  it("per-class overrides convert to sparse nm partials", () => {
    const jlc = getPreset("jlcpcb-2l");
    expect(jlc.rules.perClass.Power).toEqual({ clearanceNm: 200_000, minTrackWidthNm: 400_000 });
    expect(jlc.rules.perClass.HighCurrent).toEqual({ clearanceNm: 300_000, minTrackWidthNm: 1_000_000 });
  });

  it("getPreset throws on an unknown id", () => {
    // @ts-expect-error — exercising the runtime guard with an invalid id
    expect(() => getPreset("nope")).toThrow();
  });
});
