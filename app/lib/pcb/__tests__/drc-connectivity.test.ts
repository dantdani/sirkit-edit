// DRC connectivity checks (Stage 12): the routed-demo's deliberate short and
// orphan track become 'short' / 'unconnected' violations.

import { describe, it, expect } from "vitest";
import { buildDrcContext } from "../drc/run-drc";
import { checkUnconnectedAndShorts } from "../drc/checks/connectivity";
import { getPreset } from "../drc/presets";
import { buildRoutedDemo } from "../demo/routed-demo";

const RULES = getPreset("jlcpcb-2l").rules;

describe("DRC connectivity checks", () => {
  it("(a) the routed demo's deliberate short becomes a 'short' error", () => {
    const v = checkUnconnectedAndShorts(buildDrcContext(buildRoutedDemo(), RULES));
    const shorts = v.filter((x) => x.kind === "short");
    expect(shorts.length).toBeGreaterThanOrEqual(1);
    expect(shorts[0].severity).toBe("error");
    expect(shorts[0].items).toHaveLength(2);
    // mentions the two nets by name (VCC crosses GND), not a code
    expect(shorts[0].summary).toMatch(/GND|VCC/);
  });

  it("(b) the orphan net-0 track becomes an 'unconnected' warning", () => {
    const v = checkUnconnectedAndShorts(buildDrcContext(buildRoutedDemo(), RULES));
    const orphans = v.filter((x) => x.kind === "unconnected");
    expect(orphans.length).toBeGreaterThanOrEqual(1);
    expect(orphans[0].severity).toBe("warning");
    expect(orphans[0].items).toHaveLength(1);
  });
});
