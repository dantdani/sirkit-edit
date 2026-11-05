/**
 * [PR-E] The Build sidebar's design checks are computed, never decorative (fault F-07): "No floating nets" from the drawn
 * schematic's own netlist validation, "Supply rails connected" from the ERC's supply findings; a check that cannot run says
 * so with its reason and is never a pass; the result names the digest it was computed on.
 */
import { describe, expect, it } from "vitest";
import type { CachedPart } from "@/app/lib/parts-cache";
import type { SchematicState } from "@/lib/schematic-types";
import { computeDesignChecks } from "../design-checks";

const resistor: CachedPart = { id: "part-r", name: "R", mpn: null, description: "resistor", keywords: "", manufacturer: null, datasheet: null, footprintHint: null, pins: [{ number: "1", name: "~", type: "passive", position: { x: -2.54, y: 0 }, orientation: "right", length: 2.54 }, { number: "2", name: "~", type: "passive", position: { x: 2.54, y: 0 }, orientation: "left", length: 2.54 }], symbolRaw: "", properties: {}, libraryId: "lib", isGeneric: true, lifecycleStatus: "unknown", internalPartNumber: null, rohsStatus: null, packageNormalized: null, keySpecs: null, mainCategory: "Passive Components" } as unknown as CachedPart;

const parts = new Map<string, CachedPart>([["part-r", resistor]]);
const empty: SchematicState = { components: [], wires: [], kicadComponents: [], netLabels: [] };
const twoResistorsUnwired: SchematicState = { components: [], wires: [], kicadComponents: [{ id: "k1", partId: "part-r", x: 0, y: 0, rotation: 0, refDes: "R1", value: "1k" }, { id: "k2", partId: "part-r", x: 50, y: 0, rotation: 0, refDes: "R2", value: "1k" }], netLabels: [] };

describe("design checks", () => {
  it("Theory mode and an empty sheet are 'not run' with a reason, never a pass", () => {
    for (const result of [computeDesignChecks(empty, parts, "d0", "theory"), computeDesignChecks(empty, parts, "d0", "build")]) {
      expect(result.checks.map((check) => check.state)).toEqual(["not_run", "not_run"]);
      expect(result.checks.every((check) => check.reason && check.count === 0)).toBe(true);
      expect(result.digest).toBe("d0");
    }
  });

  it("a placed part whose catalog record is not loaded makes both checks 'not run' (its pins are unknown)", () => {
    const result = computeDesignChecks(twoResistorsUnwired, new Map(), "d1", "build");
    expect(result.checks.map((check) => check.state)).toEqual(["not_run", "not_run"]);
    expect(result.checks[0].reason).toMatch(/still loading/);
  });

  it("unwired parts are findings (floating pins), with bounded messages and a count", () => {
    const result = computeDesignChecks(twoResistorsUnwired, parts, "d2", "build");
    const floating = result.checks.find((check) => check.id === "floating-nets")!;
    expect(floating.state).toBe("findings");
    expect(floating.count).toBeGreaterThan(0);
    expect(floating.findings.length).toBeLessThanOrEqual(5);
    expect(floating.findings.every((message) => message.length <= 200)).toBe(true);
    const supply = result.checks.find((check) => check.id === "supply-rails")!;
    expect(["pass", "findings"]).toContain(supply.state); // a real result either way, never not_run with parts loaded
  });
});
