// @vitest-environment jsdom
/**
 * [PR-J3, 2026-10-22] Runbook J.3 (OD-255 item 7): the sheet lens hook survives React StrictMode - Next's development default, so
 * `next dev` (every browser proof) mounts app/page.tsx under it. StrictMode runs an effect's cleanup once on a simulated unmount and
 * mounts the SAME component instance again: the hook's mount effect disposed its controller on that cleanup, and a disposed controller
 * ignores every sheet switch, so the Sheets navigator was dead in the dev server while every plain jsdom test passed. The mount effect
 * now revives the controller.
 *
 *  1. under <StrictMode> a sheet opens, the activation moves, Back returns to the overview, a notice shows and dismisses;
 *  2. the controller alone: dispose() makes it inert, revive() makes it live again (the exact pair the effect runs).
 * jsdom; B's page-mimicking harness (_j3-harness.tsx); no network.
 */
import { StrictMode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ROOT_SHEET_ID } from "@/lib/schematic-types";
import { SheetNavigationController } from "../hooks/sheet-navigation-controller";
import type { SchematicSheetLens } from "../hooks/useSchematicSheetLens";
import { FakePage, Harness, MemoryStorage, getPart, imuSplit, recordingGraph, settle } from "./_j3-harness";

let latest: SchematicSheetLens | null = null;
const lens = (): SchematicSheetLens => { if (!latest) throw new Error("no lens yet"); return latest; };
const onLens = (next: SchematicSheetLens): void => { latest = next; };

afterEach(() => { cleanup(); latest = null; });

describe("[PR-J3] the sheet lens under React StrictMode", () => {
  it("1. a sheet opens, the activation moves, Back and the notice work after the simulated unmount / remount", async () => {
    const { after } = imuSplit();
    const page = new FakePage(after);
    const { graph } = recordingGraph();
    render(<StrictMode><Harness page={page} graph={graph} projectId="p1" storage={new MemoryStorage()} onLens={onLens} /></StrictMode>);
    await settle();
    expect(lens().legacy).toBe(false);
    expect(lens().activeSheetId).toBe(ROOT_SHEET_ID);
    const activation = lens().activation;
    lens().controller.openSheet("sheet-imu");
    await settle();
    expect(lens().activeSheetId).toBe("sheet-imu");
    expect(lens().activation).toBe(activation + 1);
    expect(screen.getByTestId("sheets-navigator").getAttribute("data-active-sheet")).toBe("sheet-imu");
    expect(lens().kicadComponents.map((item) => item.refDes)).toEqual(["U3"]);
    lens().controller.api.goBack();
    await settle();
    expect(lens().activeSheetId).toBe(ROOT_SHEET_ID);
    expect(lens().activation).toBe(activation + 2);
    lens().controller.openSheet("sheet-missing");
    await settle();
    expect(lens().notice).toMatch(/does not exist/);
    lens().controller.api.dismissNotice();
    await settle();
    expect(lens().notice).toBeNull();
  });

  it("2. dispose() makes the controller inert; revive() makes it live again", async () => {
    const { after } = imuSplit();
    const page = new FakePage(after);
    const { graph } = recordingGraph();
    const controller = new SheetNavigationController({ authoritative: after, projectId: "p1", graph, runSchematicCommand: page.runSchematicCommand, getPart, viewSessionBridge: null, selectedId: undefined, selectedKicadId: undefined, captureScope: undefined, onSheetSwitch: undefined }, new MemoryStorage());
    expect(controller.getSnapshot().activeSheetId).toBe(ROOT_SHEET_ID);
    controller.dispose();
    controller.openSheet("sheet-imu");
    expect(controller.getSnapshot().activeSheetId).toBe(ROOT_SHEET_ID); // inert
    controller.revive();
    controller.openSheet("sheet-imu");
    expect(controller.getSnapshot().activeSheetId).toBe("sheet-imu");
    expect(controller.getSnapshot().activation).toBe(2);
    controller.dispose();
  });
});
