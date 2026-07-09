// IPC-2152 width calculator (Stage 10): reference point, monotonicity, floor,
// and explanation formatting.

import { describe, it, expect } from "vitest";
import { ipc2152Width } from "../ipc2152";

describe("ipc2152Width", () => {
  it("hits the 2 A / 10 °C / 1 oz external reference (~1.24 mm)", () => {
    const r = ipc2152Width({ currentAmps: 2.0, copperOz: 1, tempRiseCelsius: 10, layer: "external" });
    console.log(`IPC-2152 reference (2 A, 10 °C, 1 oz, external): ${(r.widthNm / 1e6).toFixed(3)} mm`);
    expect(r.widthNm).toBeGreaterThanOrEqual(1_150_000);
    expect(r.widthNm).toBeLessThanOrEqual(1_320_000);
  });

  it("width increases monotonically with current (other params fixed)", () => {
    const w = (a: number): number =>
      ipc2152Width({ currentAmps: a, copperOz: 1, tempRiseCelsius: 10, layer: "external" }).widthNm;
    const widths = [0.5, 1, 2, 3, 5].map(w);
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i]).toBeGreaterThan(widths[i - 1]);
    }
  });

  it("clamps tiny currents to the 0.15 mm fabrication floor", () => {
    const r = ipc2152Width({ currentAmps: 0.001, copperOz: 1, tempRiseCelsius: 10, layer: "external" });
    expect(r.widthNm).toBe(150_000);
  });

  it("explanation contains the input current and temp rise verbatim", () => {
    const r = ipc2152Width({ currentAmps: 2.0, copperOz: 1, tempRiseCelsius: 10, layer: "external" });
    expect(r.explanation).toContain("2 A");
    expect(r.explanation).toContain("10 °C");
    expect(r.explanation).toContain("mm");
  });

  it("marks internal-layer requests with the post-MVP note", () => {
    const r = ipc2152Width({ currentAmps: 2.0, copperOz: 1, tempRiseCelsius: 10, layer: "internal" });
    expect(r.explanation).toContain("internal derating is post-MVP");
  });
});
