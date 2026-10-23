/**
 * [PR-J4, 2026-10-23] Runbook section J increment 4, J4-B (J.5): the Missing parts listing names each unresolved instance's sheet for a
 * project with sheets (`sheet: { id, name }`, the root by its own name, a child by its path) and carries no such key for a project
 * without (byte identity; j2-consumers-golden pins the digests of five single-sheet documents). Pure: no network, no DOM.
 */
import { describe, expect, it } from "vitest";
import { listUnresolvedInstances, UNRESOLVED_REVIEW_PATH } from "@/app/lib/pcb-sync/unresolved-instances";
import type { SchematicState } from "@/lib/schematic-types";
import { droneFixtureState } from "../../schematic/__tests__/_j1-fixtures";
import { multiSheetDroneFixtureState } from "../../schematic/__tests__/_j3-fixtures";

/** The drone with the exact revision removed from the named references (so the listing names them). */
function unresolve(state: SchematicState, refs: readonly string[]): SchematicState {
  return { ...state, kicadComponents: state.kicadComponents!.map((instance) => { if (!refs.includes(instance.refDes)) return instance; const copy = { ...instance }; delete copy.atomicPartRevisionId; delete copy.symbolAssetVersionId; return copy; }) };
}

describe("[PR-J4 J4-B] the Missing parts listing names the sheet of each unresolved instance only for a project with sheets", () => {
  it("the organised drone: U3 on IMU, U2 on the overview (by the root's own name), a Theory primitive on its sheet", () => {
    const state = unresolve(multiSheetDroneFixtureState(), ["U2", "U3"]);
    state.components = [{ id: "theory-l1", type: "inductor", x: 600, y: 600, rotation: 0, value: "10uH", refDes: "L1", sheetId: "sheet-power" }];
    const items = listUnresolvedInstances(state);
    expect(items).toEqual([
      { refDes: "L1", family: "theory", missing: "theory_symbol_only", reviewPath: UNRESOLVED_REVIEW_PATH.theory_symbol_only, sheet: { id: "sheet-power", name: "Power" } },
      { refDes: "U2", family: "kicad", missing: "published_exact_revision", reviewPath: UNRESOLVED_REVIEW_PATH.published_exact_revision, sheet: { id: "root", name: "Overview" } },
      { refDes: "U3", family: "kicad", missing: "published_exact_revision", reviewPath: UNRESOLVED_REVIEW_PATH.published_exact_revision, sheet: { id: "sheet-imu", name: "IMU" } },
    ]);
  });

  it("a nested sheet is named by its path", () => {
    const state = unresolve(multiSheetDroneFixtureState(), ["U3"]);
    state.sheets = { version: 1, sheets: [...state.sheets!.sheets, { id: "sheet-imu-filter", name: "Filter", parentId: "sheet-imu" }] };
    state.kicadComponents = state.kicadComponents!.map((instance) => (instance.refDes === "U3" ? { ...instance, sheetId: "sheet-imu-filter" } : instance));
    expect(listUnresolvedInstances(state).map((item) => item.sheet)).toEqual([{ id: "sheet-imu-filter", name: "IMU/Filter" }]);
  });

  it("a project without sheets: the exact rows as before, no `sheet` key", () => {
    const items = listUnresolvedInstances(unresolve(droneFixtureState(), ["U2", "U3"]));
    expect(items).toEqual([
      { refDes: "U2", family: "kicad", missing: "published_exact_revision", reviewPath: UNRESOLVED_REVIEW_PATH.published_exact_revision },
      { refDes: "U3", family: "kicad", missing: "published_exact_revision", reviewPath: UNRESOLVED_REVIEW_PATH.published_exact_revision },
    ]);
    for (const item of items) expect("sheet" in item).toBe(false);
    expect(listUnresolvedInstances(droneFixtureState())).toEqual([]);
  });
});
