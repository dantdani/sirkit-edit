/**
 * [PR-J5, 2026-10-23] Runbook J.6.1 (OD-259 item 1): the review dialog's summary of a proposal that carries a sheet tree
 * (`describeSchematicProposal`, review-summary.ts). What it proves:
 *
 *  1. a sheeted proposal over an empty document: the headline names the sheet count; the details name the overview and every child with
 *     its parts, ports and rails, the interfaces (ports shared by two or more sheets) and the incomplete (empty) sheets;
 *  2. over a multi-sheet document: the headline counts the current sheets and the details end with the replaced-sheets sentence, naming
 *     every existing sheet; `replacedSheetsLine` is that sentence alone (null for a document without sheets);
 *  3. a flat proposal's headline and details are byte-identical to before (the three lines, in order), whatever the current document.
 * Pure over states; no DOM.
 */
import { describe, expect, it } from "vitest";
import { ROOT_SHEET_ID, type SchematicState } from "@/lib/schematic-types";
import { describeSchematicProposal, replacedSheetsLine } from "../review-summary";

const part = (id: string, refDes: string, value: string, sheetId?: string) => ({ id, partId: "p", x: 0, y: 0, rotation: 0 as const, refDes, value, ...(sheetId ? { sheetId } : {}) });
const label = (id: string, name: string, kind: "label" | "power" | "ground", extra: Record<string, unknown> = {}) => ({ id, position: { x: 0, y: 0 }, name, kind, orientation: 0 as const, ...extra });

function sheeted(): SchematicState {
  return {
    components: [],
    wires: [{ id: "w1", vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }], sheetId: "a" }],
    kicadComponents: [part("k1", "U1", "MCU", "a"), part("k2", "R1", "10k", "a"), part("k3", "J1", "CONN", "b")],
    netLabels: [
      label("l1", "CLK", "label", { sheetId: "a", scope: "hierarchical", portId: "a:port:CLK" }),
      label("l2", "GND", "ground", { sheetId: "a" }),
      label("l3", "+3V3", "power", { sheetId: "a" }),
      label("l4", "CLK", "label", { sheetId: "b", scope: "hierarchical", portId: "b:port:CLK" }),
      label("p1", "CLK", "label", { scope: "sheet-pin", portId: "a:port:CLK", childSheetId: "a" }),
      label("p2", "CLK", "label", { scope: "sheet-pin", portId: "b:port:CLK", childSheetId: "b" }),
      label("n1", "CLK", "label"),
    ],
    pageSize: "A4",
    sheets: { version: 1, sheets: [
      { id: ROOT_SHEET_ID, name: "System overview", parentId: null },
      { id: "a", name: "MCU", parentId: ROOT_SHEET_ID, block: { x: 100, y: 100, width: 300, height: 200 }, ports: [{ id: "a:port:CLK", name: "CLK", direction: "output" }] },
      { id: "b", name: "Connectors", parentId: ROOT_SHEET_ID, block: { x: 460, y: 100, width: 300, height: 200 }, ports: [{ id: "b:port:CLK", name: "CLK", direction: "input" }, { id: "b:port:RX", name: "RX", direction: "input" }] },
      { id: "c", name: "Barometer", parentId: ROOT_SHEET_ID, block: { x: 820, y: 100, width: 300, height: 200 }, ports: [{ id: "c:port:RX", name: "RX", direction: "output" }] },
    ] },
  };
}
const empty = (): Pick<SchematicState, "components" | "wires" | "kicadComponents" | "netLabels"> => ({ components: [], wires: [], kicadComponents: [], netLabels: [] });
const flatNext = (): SchematicState => ({ components: [{ id: "r1", type: "resistor", x: 0, y: 0, rotation: 0, value: "1k" }], wires: [], kicadComponents: [part("k1", "U1", "NE555")], netLabels: [label("l1", "GND", "ground"), label("l2", "VCC", "power")] });

describe("[PR-J5] describeSchematicProposal for a sheeted proposal", () => {
  it("1. over an empty document: the sheet count in the headline; the overview, children, interfaces and incomplete sheets in the details", () => {
    const summary = describeSchematicProposal(sheeted(), empty());
    expect(summary.replaces).toBe(false);
    expect(summary.headline).toBe("Apply the generated design as 3 subsystem sheets?");
    expect(summary.sheets).toEqual({
      overview: "System overview",
      children: [
        { name: "MCU", parts: 2, ports: ["CLK"], rails: ["+3V3", "GND"], incomplete: false },
        { name: "Connectors", parts: 1, ports: ["CLK", "RX"], rails: [], incomplete: false },
        { name: "Barometer", parts: 0, ports: ["RX"], rails: [], incomplete: true },
      ],
      interfaces: ["CLK", "RX"],
      replacedSheets: [],
    });
    expect(summary.details).toEqual([
      "3 parts: J1=CONN, R1=10k, U1=MCU",
      "1 wire, net labels: +3V3, CLK, GND",
      "System overview + 3 sheets: MCU (2 parts; ports CLK; rails +3V3, GND), Connectors (1 part; ports CLK, RX), Barometer (0 parts; ports RX)",
      "Interfaces: CLK, RX",
      "Incomplete: Barometer (not designed; ports unbound)",
      "Nothing existing is removed.",
    ]);
    expect(summary.partCount).toBe(3);
    expect(summary.wireCount).toBe(1);
  });

  it("2. over a multi-sheet document: the current sheets are counted and the replaced-sheets sentence names them", () => {
    const current: SchematicState = { ...sheeted(), sheets: { version: 1, sheets: [{ id: ROOT_SHEET_ID, name: "Overview", parentId: null }, { id: "x", name: "Power", parentId: ROOT_SHEET_ID }, { id: "y", name: "IMU", parentId: ROOT_SHEET_ID }] } };
    const summary = describeSchematicProposal(sheeted(), current);
    expect(summary.replaces).toBe(true);
    expect(summary.headline).toBe("Replace the current schematic (3 parts, 8 wires/labels, 3 sheets) with the generated 3-sheet design?");
    expect(summary.details[summary.details.length - 1]).toBe("Every existing sheet (Overview, Power, IMU) is replaced by the apply (one undoable transaction).");
    expect(summary.sheets!.replacedSheets).toEqual(["Overview", "Power", "IMU"]);
    expect(replacedSheetsLine(current)).toBe("Every existing sheet (Overview, Power, IMU) is replaced by the apply (one undoable transaction).");
    expect(replacedSheetsLine(empty())).toBeNull();
    expect(replacedSheetsLine({ sheets: undefined })).toBeNull();
    // a populated single-sheet document: the generic removal sentence, as before
    expect(describeSchematicProposal(sheeted(), { ...empty(), kicadComponents: [part("old", "R9", "1k")] }).details.at(-1)).toBe("Every existing component, wire and label on this sheet is removed by the apply (one undoable transaction).");
  });

  it("3. a flat proposal's lines are byte-identical to before, whatever the current document", () => {
    const over = (current: Pick<SchematicState, "components" | "wires" | "kicadComponents" | "netLabels"> & Partial<Pick<SchematicState, "sheets">>) => describeSchematicProposal(flatNext(), current);
    const fresh = over(empty());
    expect(fresh.sheets).toBeUndefined();
    expect(fresh.headline).toBe("Apply the generated schematic to the empty sheet?");
    expect(fresh.details).toEqual(["2 parts: r1=1k, U1=NE555", "0 wires, net labels: GND, VCC", "Nothing existing is removed."]);
    const populated = over({ ...empty(), components: [{ id: "r-old", type: "resistor", x: 0, y: 0, rotation: 0, value: "1k" }], wires: [{ id: "w", vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }] });
    expect(populated.headline).toBe("Replace the current schematic (1 part, 1 wire/labels) with the generated one?");
    expect(populated.details[2]).toBe("Every existing component, wire and label on this sheet is removed by the apply (one undoable transaction).");
    // a flat proposal over a multi-sheet document reads exactly as over a flat one (the offer refuses it before any dialog; the summary adds nothing)
    expect(over({ ...empty(), sheets: sheeted().sheets }).details).toEqual(fresh.details);
  });
});
