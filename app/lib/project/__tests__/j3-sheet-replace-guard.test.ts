/**
 * [PR-J3, 2026-10-22] Runbook section J increment 3 (OD-255 item 6, OD-257 item 3): the pure AI replace-result guard
 * (app/lib/project/sheet-replace-guard.ts). What it proves:
 *
 *  1. a single-sheet base is never refused (null), whatever the incoming state - the legacy path is unchanged;
 *  2. a multi-sheet base and a FLAT incoming state: a message that names the sheet count and the sheet names in document order;
 *  3. an incoming state that carries its own sheet tree is not a flattening: null (a J5-2 sheet-aware result passes to the review);
 *  4. the result-less call sites (Build start, edit, Tidy) refuse a multi-sheet base with the same message;
 *  5. the message is bounded (under 240 characters for 512 sheets with 120-character names), lists at most four names, shortens long
 *     ones, and ends with the page's "Nothing was changed." wording; the fixture drone's organised document reads in full;
 *  6. purity: the inputs are not touched.
 *  [PR-J5 integration, 2026-10-23] review B-5: case 5 also bounds a LONG root name, the Build advisory, the Theory composer's refusal
 *  (review B-2) and the refusal with its "Why it is one page" findings - every one within 240 characters (the 84-character tail made
 *  the 512-sheet worst case 246, the advisory 255, two long findings 889).
 * Pure: no I/O, no React, no page import.
 */
import { describe, expect, it } from "vitest";
import { ROOT_SHEET_ID, type SchematicState } from "@/lib/schematic-types";
import { droneFixtureState } from "../../schematic/__tests__/_j1-fixtures";
import { multiSheetDroneFixtureState } from "../../schematic/__tests__/_j3-fixtures";
import {
  SHEET_REPLACE_GUARD_MAX_MESSAGE_LENGTH,
  SHEET_REPLACE_GUARD_MAX_NAMES,
  SHEET_REPLACE_GUARD_MAX_NAME_LENGTH,
  SHEET_REPLACE_GUARD_TAIL,
  SHEET_REPLACE_GUARD_THEORY_TAIL,
  flatReplacementRefusal,
  flatReplacementRefusalWithFindings,
  multiSheetReplaceAdvisory,
  multiSheetReplaceRefusal,
  sheetNamesForMessage,
} from "../sheet-replace-guard";

const flat = (): SchematicState => ({ components: [], wires: [], kicadComponents: [], netLabels: [] });
const sheeted = (names: readonly string[]): SchematicState => ({
  ...flat(),
  sheets: { version: 1, sheets: [{ id: ROOT_SHEET_ID, name: "Overview", parentId: null }, ...names.map((name, index) => ({ id: `s${index + 1}`, name, parentId: ROOT_SHEET_ID }))] },
});

describe("[PR-J3] the AI replace-result guard", () => {
  it("1. a single-sheet base is never refused, whatever the incoming state", () => {
    expect(flatReplacementRefusal(flat(), flat())).toBeNull();
    expect(flatReplacementRefusal(droneFixtureState(), droneFixtureState())).toBeNull();
    expect(flatReplacementRefusal(flat(), sheeted(["A"]))).toBeNull();
    expect(multiSheetReplaceRefusal(flat())).toBeNull();
    expect(multiSheetReplaceRefusal(droneFixtureState())).toBeNull();
    // a `sheets` field without a child is not a stored form (normalizeHierarchy drops it); it still refuses nothing
    expect(multiSheetReplaceRefusal({ sheets: { version: 1, sheets: [] } })).toBeNull();
  });

  it("2. a multi-sheet base and a flat incoming state: the message names the sheet count and the names in document order", () => {
    const base = sheeted(["Power", "Motor drivers", "IMU"]);
    expect(flatReplacementRefusal(base, flat())).toBe(`This project has 4 schematic sheets (Overview, Power, Motor drivers, IMU). A flat AI result would replace them. ${SHEET_REPLACE_GUARD_TAIL}`);
    expect(flatReplacementRefusal(base, droneFixtureState())).toBe(flatReplacementRefusal(base, flat()));
    expect(flatReplacementRefusal(sheeted(["Only child"]), flat())).toContain("This project has 2 schematic sheets (Overview, Only child).");
  });

  it("3. an incoming state that carries its own sheet tree is not a flattening: null", () => {
    const base = sheeted(["Power", "Motor drivers", "IMU"]);
    expect(flatReplacementRefusal(base, sheeted(["Power"]))).toBeNull();
    expect(flatReplacementRefusal(base, base)).toBeNull();
    expect(flatReplacementRefusal(base, multiSheetDroneFixtureState())).toBeNull();
  });

  it("4. the result-less call sites (Build start, edit, Tidy) refuse a multi-sheet base with the same message as the final boundary", () => {
    const base = multiSheetDroneFixtureState();
    const message = multiSheetReplaceRefusal(base);
    expect(message).toBe(flatReplacementRefusal(base, droneFixtureState()));
    expect(message).toBe(`This project has 4 schematic sheets (Overview, Power, Motor drivers, IMU). A flat AI result would replace them. ${SHEET_REPLACE_GUARD_TAIL}`);
  });

  it("5. the message is bounded: at most four names, long names shortened, under 240 characters for 512 long-named sheets, the page's closing words", () => {
    expect(SHEET_REPLACE_GUARD_MAX_NAMES).toBe(4);
    expect(SHEET_REPLACE_GUARD_MAX_NAME_LENGTH).toBe(16);
    expect(SHEET_REPLACE_GUARD_MAX_MESSAGE_LENGTH).toBe(240);
    expect(SHEET_REPLACE_GUARD_TAIL.endsWith("Nothing was changed.")).toBe(true);
    const longName = "Analog front end and filtering stage with the anti-alias network before the converter and its references and clocks"; // 120 chars
    expect(longName.length).toBeLessThanOrEqual(120);
    const many = sheeted(Array.from({ length: 511 }, (_, index) => `${longName} ${index}`.slice(0, 120)));
    expect(many.sheets!.sheets).toHaveLength(512);
    const message = multiSheetReplaceRefusal(many)!;
    expect(message.length).toBeLessThanOrEqual(SHEET_REPLACE_GUARD_MAX_MESSAGE_LENGTH);
    expect(message.startsWith("This project has 512 schematic sheets (Overview, Analog front en…, Analog front en…, Analog front en… and 508 more). ")).toBe(true);
    expect(message.endsWith(SHEET_REPLACE_GUARD_TAIL)).toBe(true);
    expect(sheetNamesForMessage(sheeted(["A", "B", "C", "D", "E"]))).toBe("Overview, A, B, C and 2 more");
    expect(sheetNamesForMessage(sheeted(["A", "B", "C"]))).toBe("Overview, A, B, C");
    expect(sheetNamesForMessage(sheeted(["  padded  "]))).toBe("Overview, padded");
    // the fixture drone's organised document reads in full (no shortening, no "more")
    const organised = multiSheetReplaceRefusal(multiSheetDroneFixtureState())!;
    expect(organised).not.toContain("…");
    expect(organised).not.toContain(" more");
    expect(organised.length).toBeLessThanOrEqual(SHEET_REPLACE_GUARD_MAX_MESSAGE_LENGTH);
    // [PR-J5 integration, 2026-10-23] review B-5: the worst case with a LONG root name (a renamed overview), for every message the guard words
    const longRoot = (state: SchematicState): SchematicState => ({ ...state, sheets: { version: 1, sheets: state.sheets!.sheets.map((sheet) => (sheet.parentId === null ? { ...sheet, name: longName } : sheet)) } });
    const worst = longRoot(many);
    const refusal = multiSheetReplaceRefusal(worst)!;
    expect(refusal.length).toBeLessThanOrEqual(SHEET_REPLACE_GUARD_MAX_MESSAGE_LENGTH);
    expect(refusal.endsWith(SHEET_REPLACE_GUARD_TAIL)).toBe(true);
    const theory = multiSheetReplaceRefusal(worst, "theory")!;
    expect(theory.length).toBeLessThanOrEqual(SHEET_REPLACE_GUARD_MAX_MESSAGE_LENGTH);
    expect(theory.endsWith(SHEET_REPLACE_GUARD_THEORY_TAIL)).toBe(true);
    expect(theory).toContain("Theory mode draws one page");
    const advisory = multiSheetReplaceAdvisory(worst)!;
    expect(advisory.length).toBeLessThanOrEqual(SHEET_REPLACE_GUARD_MAX_MESSAGE_LENGTH);
    expect(advisory.startsWith("This project has 512 schematic sheets (Analog front en…, Analog front en…")).toBe(true);
    // the refusal with why it is one page: bounded in length (cut with "…"), the refusal itself never cut
    const longFinding = `Kept on one page: ${"PWM1 is labelled in Motor driver stages, Flight controller MCU and IMU but is not a planned shared net. ".repeat(4)}`;
    const withFindings = flatReplacementRefusalWithFindings(refusal, [longFinding, longFinding, longFinding]);
    expect(withFindings.length).toBeLessThanOrEqual(SHEET_REPLACE_GUARD_MAX_MESSAGE_LENGTH);
    expect(withFindings.startsWith(refusal)).toBe(true);
    const short = multiSheetReplaceRefusal(sheeted(["Power"]))!;
    const shortWithFindings = flatReplacementRefusalWithFindings(short, [longFinding, longFinding]);
    expect(shortWithFindings.length).toBe(SHEET_REPLACE_GUARD_MAX_MESSAGE_LENGTH);
    expect(shortWithFindings.startsWith(`${short} Why it is one page: PWM1 is labelled`)).toBe(true);
    expect(shortWithFindings.endsWith("…")).toBe(true);
    expect(flatReplacementRefusalWithFindings(short, ["Kept on one page: a."])).toBe(`${short} Why it is one page: a.`);
  });

  it("6. pure: neither argument is changed", () => {
    const base = sheeted(["Power", "IMU"]);
    const incoming = flat();
    const baseJson = JSON.stringify(base);
    const incomingJson = JSON.stringify(incoming);
    flatReplacementRefusal(base, incoming);
    multiSheetReplaceRefusal(base);
    sheetNamesForMessage(base);
    expect(JSON.stringify(base)).toBe(baseJson);
    expect(JSON.stringify(incoming)).toBe(incomingJson);
  });
});
