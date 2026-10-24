// @vitest-environment jsdom
/**
 * [PR-J5, 2026-10-23] OD-255 item 9 / OD-257 item 4: a SHEETED generation proposal (a planned result laid out as sheets) survives a
 * reload through the existing pending-proposal store without any store change - the whole state, its sheet tree and every entity's
 * sheet included, round-trips byte for byte - and the restore rule (the stored base digest must equal the live document's content
 * digest, sheets included) discards it once the base gains or loses a sheet. Browser state only; jsdom, no network.
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { schematicStateDigest } from "@/app/lib/engineering/schematic-model";
import { multiSheetDroneFixtureState } from "@/app/lib/schematic/__tests__/_j3-fixtures";
import { droneFixtureState } from "@/app/lib/schematic/__tests__/_j1-fixtures";
import { ROOT_SHEET_ID } from "@/lib/schematic-types";
import { clearPendingProposal, loadPendingProposal, savePendingProposal } from "../pending-proposal-store";

afterEach(() => window.localStorage.clear());

describe("[PR-J5] a sheeted proposal in the pending-proposal store", () => {
  it("saves and loads intact: the sheet tree, the blocks, the ports and every entity's sheetId", () => {
    const state = multiSheetDroneFixtureState();
    expect(state.sheets!.sheets.length).toBeGreaterThan(1);
    const baseDigest = schematicStateDigest(droneFixtureState());
    expect(savePendingProposal({ projectId: "p-sheets", baseDigest, state, explanation: "the drone as sheets", prompt: "build me a drone", validationNote: "Laid out as System overview + 3 subsystem sheets.", task: { taskId: "generation-task:" + "ab".repeat(16), resultDigest: "dw1-r" } })).toBe(true);
    const stored = loadPendingProposal("p-sheets");
    expect(stored).not.toBeNull();
    expect(JSON.stringify(stored!.state)).toBe(JSON.stringify(state));
    expect(stored!.state.sheets!.sheets[0]!.id).toBe(ROOT_SHEET_ID);
    expect(stored!.state.kicadComponents!.filter((item) => item.sheetId !== undefined).length).toBeGreaterThan(0);
    expect(stored!.task).toEqual({ taskId: "generation-task:" + "ab".repeat(16), resultDigest: "dw1-r" });
    clearPendingProposal("p-sheets");
    expect(loadPendingProposal("p-sheets")).toBeNull();
  });

  it("the restore digest rule: the base digest changes when the base gains sheets, so a proposal made before is discarded as stale", () => {
    const flat = droneFixtureState();
    const sheeted = multiSheetDroneFixtureState();
    expect(schematicStateDigest(flat)).not.toBe(schematicStateDigest(sheeted));
    // the page compares the stored base digest with the LIVE content digest (sheets included, OD-257 item 4) before it re-offers
    const page = readFileSync("app/page.tsx", "utf8").replaceAll("\r\n", "\n");
    expect(page).toMatch(/stored\.baseDigest !== proposalContentDigest\(|proposalContentDigest\([^)]*\) !== stored\.baseDigest/);
    expect(page).toContain("const proposalContentDigest = useCallback((state: SchematicState): string => schematicStateDigest({ components: state.components ?? [], wires: state.wires ?? [], kicadComponents: state.kicadComponents ?? [], netLabels: state.netLabels ?? [], ...(state.sheets !== undefined ? { sheets: state.sheets } : {}) }), []);");
  });
});
