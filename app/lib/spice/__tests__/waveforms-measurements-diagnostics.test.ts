import { describe, expect, it } from "vitest";
import { diagnoseNgspiceLog } from "../diagnostics";
import { evaluateMeasurement, evaluateSpecifications, summarizeScalars } from "../measurements";
import type { Measurement, Specification, WaveformSeries } from "../types";
import { detectSteadyState, downsampleMinMax, parseNgspiceAsciiRaw } from "../waveforms";

function sineSeries(): WaveformSeries {
  const x = Array.from({ length: 2001 }, (_, index) => index * 1e-5);
  const y = x.map((time) => 5 + 0.02 * Math.sin(2 * Math.PI * 1000 * time));
  return { id: "wave", name: "v(out)", unit: "V", xName: "time", xUnit: "s", x, y, sourceRefs: [] };
}

describe("waveforms, measurements, specifications, and diagnostics", () => {
  it("parses real ngspice ASCII raw data", () => {
    const raw = `Title: demo\nPlotname: Transient Analysis\nFlags: real\nNo. Variables: 2\nNo. Points: 3\nVariables:\n  0 time time\n  1 v(out) voltage\nValues:\n0 0\n 0\n1 1e-3\n 1.2\n2 2e-3\n 2.4\n`;
    const parsed = parseNgspiceAsciiRaw(raw);
    expect(parsed.waveforms[0].name).toBe("v(out)");
    expect(parsed.waveforms[0].y).toEqual([0, 1.2, 2.4]);
  });

  it("preserves spikes during multiresolution downsampling", () => {
    const x = Array.from({ length: 10_000 }, (_, index) => index);
    const y = x.map(() => 0); y[4567] = 100;
    const sampled = downsampleMinMax(x, y, 500);
    expect(sampled.y).toContain(100);
    expect(sampled.x.length).toBeLessThanOrEqual(502);
  });

  it("detects steady state and evaluates ripple/specification yield", () => {
    const series = sineSeries();
    const steady = detectSteadyState(series, 5);
    expect(steady.detected).toBe(true);
    expect(steady.period).toBeCloseTo(1e-3, 2);
    const measurement: Measurement = { id: "ripple", name: "Output ripple", operator: "ripple", expression: "v(out)", unit: "V", enabled: true };
    const scalar = evaluateMeasurement(measurement, { runId: "run-1", waveforms: [series], autoSteadyState: true });
    expect(scalar.value).toBeCloseTo(0.04, 3);
    const specification: Specification = { id: "spec", name: "Ripple ≤ 40 mV", measurementId: measurement.id, comparison: "<=", limit: 0.04, unit: "V", severity: "error", applicableTestIds: ["test"], enabled: true };
    const evaluated = evaluateSpecifications("run-1", [specification], [scalar], "test");
    expect(["pass", "fail"]).toContain(evaluated[0].status);
    const stats = summarizeScalars([evaluated[0], { ...evaluated[0], id: "s2", runId: "run-2", value: 0.05, status: "fail" }]);
    expect(stats?.count).toBe(2);
    expect(stats?.failures).toBeGreaterThanOrEqual(1);
  });

  it("turns raw convergence logs into actionable structured diagnostics", () => {
    const diagnostics = diagnoseNgspiceLog("Error: singular matrix: check nodes n001 and n002\nno convergence in dc operating point");
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain("singular-matrix");
    expect(diagnostics[0].suggestions.some((suggestion) => suggestion.kind === "physical")).toBe(true);
    expect(diagnostics[0].suggestions.some((suggestion) => suggestion.kind === "numerical")).toBe(true);
  });
});
