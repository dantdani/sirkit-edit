// @vitest-environment jsdom
/**
 * [PR-J4, 2026-10-23] Runbook section J increment 4, J4-B (J.5): a Missing parts row names the sheet its instance is drawn on
 * (" · sheet IMU") when the listing carries one (a project with sheets), and nothing more otherwise; every existing test id and control
 * of the row stays. Fake fetch (nothing is requested), no network.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UNRESOLVED_REVIEW_PATH, type UnresolvedInstance } from "@/app/lib/pcb-sync/unresolved-instances";
import type { SchematicState } from "@/lib/schematic-types";
import { MissingPartsList } from "../MissingPartsList";

const schematic: SchematicState = {
  components: [],
  wires: [],
  kicadComponents: [{ id: "u3", partId: "p-imu", x: 100, y: 100, rotation: 0, refDes: "U3", value: "LSM6DS3", sheetId: "sheet-imu" }],
  netLabels: [],
  sheets: { version: 1, sheets: [{ id: "root", name: "Overview", parentId: null }, { id: "sheet-imu", name: "IMU", parentId: "root" }] },
};
const item = (sheet?: UnresolvedInstance["sheet"]): UnresolvedInstance => ({ refDes: "U3", family: "kicad", missing: "published_exact_revision", reviewPath: UNRESOLVED_REVIEW_PATH.published_exact_revision, ...(sheet ? { sheet } : {}) });

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("[PR-J4 J4-B] the Missing parts row names its sheet", () => {
  it("with a sheet: the row shows ' · sheet IMU' beside the missing fact; its test ids and checklist control are unchanged", () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => { throw new Error(`unexpected request ${url}`); }));
    render(<MissingPartsList items={[item({ id: "sheet-imu", name: "IMU" })]} schematic={schematic} projectScope={null} />);
    const row = screen.getByTestId("sync-unresolved-U3");
    expect(row.getAttribute("data-missing")).toBe("published_exact_revision");
    const sheet = screen.getByTestId("sync-unresolved-sheet-U3");
    expect(sheet.textContent).toBe(" · sheet IMU");
    expect(sheet.getAttribute("data-sheet-id")).toBe("sheet-imu");
    expect(row.textContent).toContain("U3 — no published exact revision · sheet IMU");
    expect(screen.getByTestId("missing-checklist-toggle-U3")).toBeTruthy();
    expect(screen.getByTestId("missing-parts-find-replacement")).toBeTruthy();
  });

  it("without a sheet (a project without sheets): the row is exactly what it was", () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => { throw new Error(`unexpected request ${url}`); }));
    render(<MissingPartsList items={[item()]} schematic={{ ...schematic, sheets: undefined, kicadComponents: [{ ...schematic.kicadComponents![0]!, sheetId: undefined }] }} projectScope={null} />);
    expect(screen.queryByTestId("sync-unresolved-sheet-U3")).toBeNull();
    expect(screen.getByTestId("sync-unresolved-U3").textContent).toContain("U3 — no published exact revision");
    expect(screen.getByTestId("sync-unresolved-U3").textContent).not.toContain("sheet");
  });
});
