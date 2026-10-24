// @vitest-environment jsdom
/**
 * [PR-J5, 2026-10-23] Runbook J.6.5 / J.6.6 (OD-259): the editor wiring of the agent's `schematic.open-sheet` view command - the sheet
 * lens hands the schematic editor the sheets it lists (id, display name, path) and an open action (`editorProps.viewSheets`,
 * `editorProps.openViewSheet`), and app/page.tsx passes them into the editor's view-session sources, so the command the agent reaches
 * through sirkit.view.canvas-navigation 1.2.0 opens a real sheet through the navigator's controller (navigation stays a view command).
 *
 *  1. a multi-sheet document: every sheet with its path, the root first; opening an existing sheet switches the active sheet and answers
 *     true; an unknown id answers false and switches nothing; a single-sheet document lists no sheets (the command answers unavailable);
 *  2. through the REAL view-session bus over the lens's props: `schematic.open-sheet` with the sheet's display name settles and the lens
 *     shows that sheet; a name no sheet has is refused and nothing switches;
 *  3. app/page.tsx: the editor destructures and types the two props on existing lines and its view-session sources carry them iff the
 *     lens lists sheets (9156 lines kept).
 * jsdom; no network; nothing on disk.
 */
import { readFileSync } from "node:fs";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { multiSheetDroneFixtureState } from "@/app/lib/schematic/__tests__/_j3-fixtures";
import { droneFixtureState } from "@/app/lib/schematic/__tests__/_j1-fixtures";
import { createViewCommand, ViewSessionBus } from "@/app/lib/view-session/bus";
import { schematicCommands, schematicInitialState, schematicViewProbe, type SchematicProbeSources, type SchematicViewState } from "@/app/lib/view-session/schematic";
import type { TrustedViewActor, ViewSessionIdentity } from "@/app/lib/view-session/types";
import { ROOT_SHEET_ID } from "@/lib/schematic-types";
import type { SchematicSheetLens } from "../hooks/useSchematicSheetLens";
import { FakePage, Harness, MemoryStorage, recordingGraph, settle } from "./_j3-harness";

let latest: SchematicSheetLens | null = null;
const lens = (): SchematicSheetLens => { if (!latest) throw new Error("no lens yet"); return latest; };
const onLens = (next: SchematicSheetLens): void => { latest = next; };
const active = (): string | undefined => screen.getByTestId("lens").dataset.active;

beforeEach(() => { latest = null; });
afterEach(() => cleanup());

const AGENT: TrustedViewActor = { actorId: "agent-1", role: "pcb_editor", actorKind: "agent" };
const T0 = "2026-10-23T12:00:00.000Z";
const IDENTITY: ViewSessionIdentity = { sessionId: "vs-sch", projectId: "p1", branchId: "main", editor: "schematic" };

describe("[PR-J5] the open-sheet wiring of the schematic editor", () => {
  it("1. the lens lists the sheets with their paths and opens one by id; a single-sheet document lists none", async () => {
    render(<Harness page={new FakePage(multiSheetDroneFixtureState())} graph={recordingGraph().graph} projectId="p1" storage={new MemoryStorage()} onLens={onLens} />);
    await settle();
    expect(lens().editorProps.viewSheets).toEqual([
      { id: ROOT_SHEET_ID, name: "Overview", path: "" },
      { id: "sheet-power", name: "Power", path: "Power" },
      { id: "sheet-motors", name: "Motor drivers", path: "Motor drivers" },
      { id: "sheet-imu", name: "IMU", path: "IMU" },
    ]);
    expect(active()).toBe(ROOT_SHEET_ID);
    expect(lens().editorProps.openViewSheet("sheet-imu")).toBe(true);
    await settle();
    expect(active()).toBe("sheet-imu");
    expect(lens().editorProps.openViewSheet("sheet-ghost")).toBe(false);
    await settle();
    expect(active()).toBe("sheet-imu");
    expect(lens().notice).toBeNull();
    expect(lens().editorProps.openViewSheet(ROOT_SHEET_ID)).toBe(true);
    await settle();
    expect(active()).toBe(ROOT_SHEET_ID);
    cleanup();
    render(<Harness page={new FakePage(droneFixtureState())} graph={recordingGraph().graph} projectId="p1" storage={new MemoryStorage()} onLens={onLens} />);
    await settle();
    expect(lens().legacy).toBe(true);
    expect(lens().editorProps.viewSheets).toBeUndefined();
    expect(lens().editorProps.openViewSheet(ROOT_SHEET_ID)).toBe(false);
  });

  it("2. the agent's schematic.open-sheet through the real bus over the lens's props opens the named sheet", async () => {
    render(<Harness page={new FakePage(multiSheetDroneFixtureState())} graph={recordingGraph().graph} projectId="p1" storage={new MemoryStorage()} onLens={onLens} />);
    await settle();
    // the editor's sources as app/page.tsx builds them: the canvas arrays plus the lens's sheets and open action iff it lists sheets
    const sources = (): SchematicProbeSources => {
      const { viewSheets, openViewSheet } = lens().editorProps;
      return { components: [], kicadComponents: [], netLabels: [], pagePx: { width: 1123, height: 794 }, ...(viewSheets ? { sheets: viewSheets, openSheet: openViewSheet } : {}) };
    };
    const bus = new ViewSessionBus<SchematicViewState>({ identity: IDENTITY, initialState: schematicInitialState(), commands: schematicCommands(() => schematicViewProbe(sources())), clock: () => T0 });
    const opened = await bus.dispatch(createViewCommand({ identity: IDENTITY, commandId: "schematic.open-sheet", payload: { sheet: "motor drivers" }, actor: AGENT, expectedViewRevision: 0, issuedAt: T0, invocationId: "o-1" }));
    expect(opened).toMatchObject({ status: "settled" });
    await settle();
    expect(active()).toBe("sheet-motors");
    const unknown = await bus.dispatch(createViewCommand({ identity: IDENTITY, commandId: "schematic.open-sheet", payload: { sheet: "Radio" }, actor: AGENT, expectedViewRevision: (opened as { viewRevision: number }).viewRevision, issuedAt: T0, invocationId: "o-2" }));
    expect(unknown).toMatchObject({ status: "refused", refusal: { code: "VS_UNAVAILABLE" } });
    expect((unknown as { refusal: { message: string } }).refusal.message).toContain("Motor drivers [sheet-motors]");
    await settle();
    expect(active()).toBe("sheet-motors");
  });

  it("3. app/page.tsx passes the two props into the editor's view-session sources on existing lines", () => {
    const page = readFileSync("app/page.tsx", "utf8");
    expect(page.split("\n").length - 1).toBe(9156);
    expect(page).toContain("  viewScope, viewSheets, openViewSheet, // [PR-J5, 2026-10-23]");
    expect(page).toContain("  viewScope: { projectId: string; branchId: string }; viewSheets?: ReadonlyArray<{ id: string; name: string; path: string }>; openViewSheet?: (sheetId: string) => boolean; // [PR-J5, 2026-10-23]");
    expect(page).toContain("    sources: { components, kicadComponents, netLabels, pagePx: { width: pageSizePx(pageSize).widthPx, height: pageSizePx(pageSize).heightPx }, ...(viewSheets && openViewSheet ? { sheets: viewSheets, openSheet: openViewSheet } : {}) }, // [PR-J5, 2026-10-23]");
    expect(page.split("{...sheetLens.editorProps}").length - 1).toBe(1); // the props reach the editor through the lens's one spread
  });
});
