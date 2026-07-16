import { describe, expect, it } from "vitest";
import { applyApprovedModelTransforms, assertModelSafeForExecution, importModelText } from "../models";
import { createSimulationProject } from "../project";
import { estimateRunPlan } from "../run-plan";
import { dividerSchematic } from "./fixtures";

describe("model governance and run-plan expansion", () => {
  it("parses model declarations without silently applying compatibility patches", () => {
    const source = `simulator lang=spectre\n.subckt OPA INP INM VDD VSS OUT\nR1 OUT VSS {RO}\n.ends OPA`;
    const report = importModelText("opa.lib", source, { manufacturer: "Example Semi", provenance: "vendor" });
    expect(report.dialect).toBe("spectre");
    expect(report.declarations[0]).toMatchObject({ kind: "subckt", name: "OPA", pins: ["INP", "INM", "VDD", "VSS", "OUT"] });
    expect(report.candidate.transformedContent).toBeUndefined();
    expect(report.candidate.transforms.length).toBeGreaterThan(0);
    expect(() => assertModelSafeForExecution(report.candidate)).toThrow(/forbidden/);
    report.candidate.transforms.forEach((patch) => { patch.approved = true; });
    const transformed = applyApprovedModelTransforms(report.candidate);
    expect(transformed.originalContent).toBe(source);
    expect(transformed.transformedContent).not.toBe(source);
  });

  it("expands sweeps, corners, analyses, and deterministic Monte Carlo", () => {
    const project = createSimulationProject(dividerSchematic());
    const test = project.tests[0];
    test.analyses = [{ id: "tran", name: "Transient", type: "tran", outputStep: "1u", stopTime: "1m", enabled: true }];
    test.variables = [
      { id: "vin", name: "VIN", value: "5V", unit: "V", distribution: { kind: "uniform", tolerance: 0.1 }, enabled: true },
    ];
    test.sweeps = [{ id: "load", name: "Load", variable: "RLOAD", definition: { kind: "list", values: ["100", "1k"] }, enabled: true }];
    test.cornerSets = [{ id: "temp", name: "Temperature", mode: "listed", enabled: true, corners: [
      { id: "cold", name: "Cold", variableValues: {}, modelSections: {}, temperatureC: -20, enabled: true },
      { id: "hot", name: "Hot", variableValues: {}, modelSections: {}, temperatureC: 85, enabled: true },
    ] }];
    test.monteCarlo = { enabled: true, samples: 3, seed: 42, method: "latin-hypercube", includeNominal: true };
    const plan = project.runPlans[0];
    plan.includeMonteCarlo = true;
    const first = estimateRunPlan(project, plan.id);
    const second = estimateRunPlan(project, plan.id);
    expect(first.totalRuns).toBe(2 * 2 * 4);
    expect(first.runPoints.map((point) => point.variableValues)).toEqual(second.runPoints.map((point) => point.variableValues));
    expect(new Set(first.runPoints.map((point) => point.temperatureC))).toEqual(new Set([-20, 85]));
  });
});
