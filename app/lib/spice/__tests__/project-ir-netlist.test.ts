import { describe, expect, it } from "vitest";
import { compileCanonicalIr } from "../ir";
import { compileNgspiceNetlist, sourceForNetlistLine } from "../netlist";
import { createSimulationProject, refreshDesignRevision, updateTest } from "../project";
import { auditCompiledIr } from "../readiness";
import { dividerSchematic } from "./fixtures";

describe("SPICE project, canonical IR, and source-mapped netlist", () => {
  it("creates immutable design revisions without changing the original project", () => {
    const schematic = dividerSchematic();
    const project = createSimulationProject(schematic, { now: "2026-07-14T00:00:00.000Z" });
    const changed = structuredClone(schematic);
    changed.components[1].value = "2k";
    const next = refreshDesignRevision(project, changed, "2026-07-14T01:00:00.000Z");
    expect(project.designRevisions).toHaveLength(1);
    expect(project.designRevisions[0].schematic.components[1].value).toBe("1kΩ");
    expect(next.designRevisions).toHaveLength(2);
    expect(next.activeDesignRevisionId).not.toBe(project.activeDesignRevisionId);
  });

  it("compiles deterministic connectivity and a source map", () => {
    const project = createSimulationProject(dividerSchematic());
    const test = project.tests[0];
    const compiledA = compileCanonicalIr({ project, testId: test.id });
    const compiledB = compileCanonicalIr({ project, testId: test.id });
    expect(compiledA.ir.nodes.map((node) => node.name)).toEqual(compiledB.ir.nodes.map((node) => node.name));
    expect(compiledA.ir.nodes.some((node) => node.name === "0")).toBe(true);
    expect(compiledA.ir.nodes.some((node) => node.name === "VIN")).toBe(true);
    expect(compiledA.ir.devices.map((device) => device.name)).toEqual(["R1", "V1"]);

    const netlist = compileNgspiceNetlist(compiledA.ir, { analysisId: test.analyses[1].id, pinNodes: compiledA.pointNodes });
    expect(netlist.executed).toContain("V1 VIN 0 DC 5 AC 1");
    expect(netlist.executed).toContain("R1 VIN 0 1k");
    expect(netlist.executed).toContain(".tran 10u 10m 10u");
    const resistorLine = netlist.executed.split("\n").findIndex((line) => line.startsWith("R1 ")) + 1;
    expect(sourceForNetlistLine(netlist, resistorLine)).toContainEqual(expect.objectContaining({ id: "R1" }));
  });

  it("keeps overlays non-destructive and readiness-aware", () => {
    const base = createSimulationProject(dividerSchematic());
    const testId = base.tests[0].id;
    const next = updateTest(base, testId, (test) => {
      test.overlay.elements.push({
        id: "load-overlay",
        kind: "resistive-load",
        name: "LOAD",
        positive: { kind: "net", net: "VIN" },
        negative: { kind: "net", net: "GND" },
        value: "2k",
        enabled: true,
      });
    });
    expect(base.tests[0].overlay.elements).toHaveLength(0);
    const compiled = compileCanonicalIr({ project: next, testId });
    expect(compiled.ir.devices.some((device) => device.id === "load-overlay")).toBe(true);
    const audit = auditCompiledIr(compiled);
    expect(audit.blocking).toBe(0);
  });

  it("rejects unsafe custom directives", () => {
    const project = createSimulationProject(dividerSchematic());
    project.tests[0].analyses = [{ id: "bad", name: "bad", type: "custom", commands: [".control"], enabled: true }];
    const compiled = compileCanonicalIr({ project, testId: project.tests[0].id });
    expect(() => compileNgspiceNetlist(compiled.ir)).toThrow(/Unsafe custom ngspice directive/);
  });
});
