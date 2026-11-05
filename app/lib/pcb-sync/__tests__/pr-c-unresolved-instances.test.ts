/**
 * [PR-C F-08] `listUnresolvedInstances` — the pure listing `handleSync` consults BEFORE any server call (app/lib/pcb-sync/
 * unresolved-instances.ts): a KiCad instance without a published exact revision, one with a revision but without its installed
 * symbol asset, a Theory part that is a physical component (R/C/L/D) with no physical package; ground symbols and voltage/current
 * sources (no footprint, never on the board) are not listed; the order is the displayed reference, natural and case-insensitive;
 * a fully resolved schematic lists nothing. The refusal sentence names the count, up to five references and the list below.
 *
 * Pure: no cache, no network, no DOM, nothing written.
 */
import { describe, expect, it } from "vitest";
import type { KicadComponentInstance, SchComponent, SchematicState } from "@/lib/schematic-types";
import { listUnresolvedInstances, UNRESOLVED_MISSING_LABEL, UNRESOLVED_REVIEW_PATH, UNRESOLVED_TOAST_REFS, unresolvedInstancesRefusal } from "../unresolved-instances";

const kicad = (refDes: string, extra: Partial<KicadComponentInstance> = {}): KicadComponentInstance => ({ id: `kicad:${refDes}`, partId: "part-1", x: 0, y: 0, rotation: 0, refDes, value: "x", ...extra });
const theory = (id: string, type: SchComponent["type"], refDes?: string): SchComponent => ({ id, type, x: 0, y: 0, rotation: 0, value: "1", ...(refDes ? { refDes } : {}) });
const state = (parts: { kicad?: KicadComponentInstance[]; theory?: SchComponent[] }): SchematicState => ({ components: parts.theory ?? [], wires: [], kicadComponents: parts.kicad ?? [] });

describe("[PR-C] listUnresolvedInstances", () => {
  it("1. a KiCad instance without atomicPartRevisionId is missing its published exact revision, with the Build Library review path", () => {
    const items = listUnresolvedInstances(state({ kicad: [kicad("U1")] }));
    expect(items).toEqual([{ refDes: "U1", family: "kicad", missing: "published_exact_revision", reviewPath: UNRESOLVED_REVIEW_PATH.published_exact_revision }]);
    expect(items[0]!.reviewPath).toContain("Use published exact revision");
    // an empty string is "absent" by the editor's own bind filter (`Boolean(k.atomicPartRevisionId)`)
    expect(listUnresolvedInstances(state({ kicad: [kicad("U1", { atomicPartRevisionId: "" })] }))[0]?.missing).toBe("published_exact_revision");
  });

  it("2. a KiCad instance with a revision but without symbolAssetVersionId is missing its symbol asset (the publication would throw PS_SYMBOL_ASSET_REQUIRED)", () => {
    const items = listUnresolvedInstances(state({ kicad: [kicad("R1", { atomicPartRevisionId: "rev-1" })] }));
    expect(items).toEqual([{ refDes: "R1", family: "kicad", missing: "symbol_asset", reviewPath: UNRESOLVED_REVIEW_PATH.symbol_asset }]);
    expect(items[0]!.reviewPath).toBe("re-place the part from its published revision");
  });

  it("3. a KiCad instance with both ids is resolved and not listed", () => {
    expect(listUnresolvedInstances(state({ kicad: [kicad("R1", { atomicPartRevisionId: "rev-1", symbolAssetVersionId: "sym-1" })] }))).toEqual([]);
  });

  it("4. a Theory R/C/L/D is listed as a Theory symbol only; ground symbols and voltage/current sources are not (no footprint, never on the board)", () => {
    const items = listUnresolvedInstances(state({ theory: [
      theory("r-1", "resistor", "R1"), theory("c-1", "capacitor", "C1"), theory("l-1", "inductor", "L1"), theory("d-1", "diode", "D1"),
      theory("gnd-1", "ground"), theory("v-1", "voltage-source", "V1"), theory("i-1", "current-source", "I1"),
    ] }));
    expect(items.map((item) => item.refDes)).toEqual(["C1", "D1", "L1", "R1"]);
    for (const item of items) {
      expect(item.family).toBe("theory");
      expect(item.missing).toBe("theory_symbol_only");
      expect(item.reviewPath).toBe(UNRESOLVED_REVIEW_PATH.theory_symbol_only);
    }
  });

  it("5. a Theory part without refDes is named by its stable id, exactly as the netlist publishes it (refDes ?? id, trimmed)", () => {
    const items = listUnresolvedInstances(state({ theory: [theory("resistor-1", "resistor"), theory("r-2", "resistor", "  RSENSE ")] }));
    expect(items.map((item) => item.refDes)).toEqual(["resistor-1", "RSENSE"]);
  });

  it("6. the order is the displayed reference, natural and case-insensitive, across both families (R2 before R10; a tie keeps the KiCad row first)", () => {
    const items = listUnresolvedInstances(state({
      theory: [theory("t-1", "resistor", "R2"), theory("t-2", "capacitor", "c1")],
      kicad: [kicad("U1"), kicad("R10"), kicad("C1", { atomicPartRevisionId: "rev" }), kicad("r1")],
    }));
    expect(items.map((item) => `${item.family}:${item.refDes}`)).toEqual(["kicad:C1", "theory:c1", "kicad:r1", "theory:R2", "kicad:R10", "kicad:U1"]);
  });

  it("7. a fully resolved schematic (and an empty one) lists nothing", () => {
    expect(listUnresolvedInstances({ components: [], wires: [] })).toEqual([]);
    expect(listUnresolvedInstances(state({
      kicad: [kicad("U1", { atomicPartRevisionId: "rev-u", symbolAssetVersionId: "sym-u" }), kicad("R1", { atomicPartRevisionId: "rev-r", symbolAssetVersionId: "sym-r" })],
      theory: [theory("gnd", "ground")],
    }))).toEqual([]);
  });

  it("8. the refusal sentence names the count, up to five references in list order, an ellipsis beyond, and the list below", () => {
    const three = listUnresolvedInstances(state({ kicad: [kicad("U1"), kicad("R1"), kicad("R2")] }));
    expect(unresolvedInstancesRefusal(three)).toBe("Schematic → PCB refused: 3 part(s) have no published exact revision (R1, R2, U1). See the list below.");
    const seven = listUnresolvedInstances(state({ kicad: ["R1", "R2", "R3", "R4", "R5", "R6", "U1"].map((ref) => kicad(ref)) }));
    expect(UNRESOLVED_TOAST_REFS).toBe(5);
    expect(unresolvedInstancesRefusal(seven)).toBe("Schematic → PCB refused: 7 part(s) have no published exact revision (R1, R2, R3, R4, R5, …). See the list below.");
  });

  it("9. every missing fact has a label and a review path, and the three are distinct sentences", () => {
    const keys = ["published_exact_revision", "symbol_asset", "theory_symbol_only"] as const;
    expect(Object.keys(UNRESOLVED_MISSING_LABEL).sort()).toEqual([...keys].sort());
    expect(Object.keys(UNRESOLVED_REVIEW_PATH).sort()).toEqual([...keys].sort());
    expect(new Set(keys.map((key) => UNRESOLVED_REVIEW_PATH[key])).size).toBe(3);
    expect(new Set(keys.map((key) => UNRESOLVED_MISSING_LABEL[key])).size).toBe(3);
  });
});
