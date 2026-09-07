import { describe, expect, it } from "vitest";
import { describeSchematicProposal } from "../review-summary";
import { layoutProposal } from "./fixtures/harness";
import { BLINKER_NETLIST, blinkerCatalog } from "./fixtures/blinker-catalog";

describe("describeSchematicProposal — the review dialog states what will change", () => {
  it("an empty sheet: apply adds every generated part and label, removes nothing", () => {
    const laidOut = layoutProposal(BLINKER_NETLIST, blinkerCatalog().cachedParts);
    const summary = describeSchematicProposal(laidOut.state, { components: [], wires: [], kicadComponents: [], netLabels: [] });
    expect(summary.replaces).toBe(false);
    expect(summary.partCount).toBe(9);
    expect(summary.parts).toContain("U1=NE555D");
    expect(summary.parts).toContain("R2=56k");
    expect(summary.netLabels).toEqual(expect.arrayContaining(["GND", "VCC"]));
    expect(summary.headline).toMatch(/empty sheet/);
    expect(summary.details[2]).toBe("Nothing existing is removed.");
  });

  it("a populated sheet: the headline says replace and counts what disappears", () => {
    const laidOut = layoutProposal(BLINKER_NETLIST, blinkerCatalog().cachedParts);
    const summary = describeSchematicProposal(laidOut.state, { components: [{ id: "r-old", type: "resistor", x: 0, y: 0, rotation: 0, value: "1k" }], wires: [{ id: "w1", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] } as never], kicadComponents: [], netLabels: [] });
    expect(summary.replaces).toBe(true);
    expect(summary.currentPartCount).toBe(1);
    expect(summary.headline).toMatch(/Replace the current schematic \(1 part, 1 wire/);
    expect(summary.details[2]).toMatch(/removed by the apply/);
  });
});
