import { describe, expect, it } from "vitest";
import { buildRoutedDemo } from "../demo/routed-demo";
import { ensureBoardPadstacks } from "../padstack/migrate";
import { reclassifyBoard } from "../netclass-rules";
import { ensureNetClassing, layerRuleDeltas } from "../netclass";
import { resolveRoutingProfile } from "../routing-profile";

function board() {
  const value = buildRoutedDemo();
  ensureBoardPadstacks(value);
  return value;
}

describe("resolveRoutingProfile", () => {
  it("keeps legacy boards on class defaults without a migration", () => {
    const value = board();
    const profile = resolveRoutingProfile(value, 3);
    expect(profile.trackWidth).toBe(250_000);
    expect(profile.viaPadstackId).toBe("via-default");
    expect([profile.viaSize, profile.viaDrill]).toEqual([600_000, 300_000]);
  });

  it("uses deterministic classification for both trace and via defaults", () => {
    const value = board();
    reclassifyBoard(value);
    const profile = resolveRoutingProfile(value, 1); // GND => Power
    expect(profile.trackWidth).toBe(500_000);
    expect(profile.viaPadstackId).toBe("via-power");
    expect([profile.viaSize, profile.viaDrill]).toEqual([800_000, 400_000]);
  });

  it("honors explicit new-route width and padstack choices", () => {
    const value = board();
    value.routingPreferences = {
      version: 1,
      trackWidthMode: "custom",
      customTrackWidthNm: 750_000,
      viaMode: "padstack",
      viaPadstackId: "via-highcurrent",
    };
    const profile = resolveRoutingProfile(value, 3);
    expect(profile.trackWidth).toBe(750_000);
    expect(profile.widthSource).toBe("custom");
    expect(profile.viaPadstackId).toBe("via-highcurrent");
    expect([profile.viaSize, profile.viaDrill]).toEqual([1_200_000, 600_000]);
  });

  it("lets an AI/manual via rule override the seeded class padstack", () => {
    const value = board();
    reclassifyBoard(value);
    const classing = ensureNetClassing(value);
    classing.assignments = { ...classing.base };
    layerRuleDeltas(value, [{
      id: "ai-via",
      createdAt: "2026-07-14T00:00:00.000Z",
      source: "ai-brief",
      changes: [{ appliesTo: { kind: "nets", netIds: [1] }, viaSizeNm: 1_000_000, viaDrillNm: 500_000 }],
      explanation: "Larger transition for the stated rail current.",
    }]);
    const profile = resolveRoutingProfile(value, 1);
    expect(profile.viaSource).toBe("rule-override");
    expect(profile.viaPadstackId).toBeUndefined();
    expect([profile.viaSize, profile.viaDrill]).toEqual([1_000_000, 500_000]);
  });
});
