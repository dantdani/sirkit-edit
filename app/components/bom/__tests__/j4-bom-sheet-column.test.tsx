// @vitest-environment jsdom
/**
 * [PR-J4, 2026-10-23] Runbook section J increment 4, J4-B (J.5): the BOM view's Sheet column exists ONLY for a project with sheets - a
 * `Sheet` header (sortable like the others, through the existing header control) and a cell per line with the line's sheet names;
 * sorting by it groups the lines per sheet with a group line (text only, no control). A project without sheets renders exactly the
 * columns it had. Fake fetch (the BOM answer carries `sheets` on each row), no network.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BomView } from "../BomView";

const SCOPE = { tenantId: "local", projectId: "p1", branchId: "main" };
const SHEETS = { version: 1, sheets: [{ id: "root", name: "Overview", parentId: null }, { id: "sheet-imu", name: "IMU", parentId: "root" }] };
const FLAT = { components: [], wires: [], kicadComponents: [{ id: "c1", partId: "p1", x: 0, y: 0, rotation: 0, refDes: "U1", value: "ATmega328P" }, { id: "c2", partId: "p2", x: 100, y: 0, rotation: 0, refDes: "U3", value: "LSM6DS3" }] } as never;
const SHEETED = { components: [], wires: [], kicadComponents: [{ id: "c1", partId: "p1", x: 0, y: 0, rotation: 0, refDes: "U1", value: "ATmega328P" }, { id: "c2", partId: "p2", x: 100, y: 0, rotation: 0, refDes: "U3", value: "LSM6DS3", sheetId: "sheet-imu" }], sheets: SHEETS } as never;
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
// the banner suite's row shape (an excellent risk grade: the view's at-risk summary then names no reference a second time)
const row = (refDes: string, name: string, sheets?: string[]) => ({ partId: `p-${refDes}`, atomicRevisionId: null, refDes, refDesList: [refDes], qty: 1, name, mpn: null, manufacturer: null, package: null, value: null, datasheet: null, category: null, pricing: null, lifecycleStatus: "active", alternatesCount: 0, riskScore: { total: 90, grade: "excellent", components: { lifecycle: 35, availability: 30, diversity: 10, pricing: 15 }, notes: [] }, ...(sheets ? { sheets } : {}) });
const bom = (rows: unknown[]) => ({
  ok: true, rows, totalUnitsAvailable: [], estimatedProjectCost: { value: 0, currency: "USD" }, pricingSource: "none", cached: 0, fetched: 0,
  lifecycleSummary: { active: rows.length, nrnd: 0, last_time_buy: 0, eol: 0, obsolete: 0, unknown: 0, totalRows: rows.length, riskRecommendation: "ok" },
  riskSummary: { overallScore: 90, overallGrade: "excellent", totalRows: rows.length, rowsAtRisk: 0, worstRows: [], productionReady: true, recommendation: "Supply signals look healthy." }, warnings: [], pricingMode: "none", registryVersion: "1.0.0", sources: [], generatedAt: 0,
});
/** The table has rendered: the reference cell is on screen (a BOM row's `refDes` cell). */
const tableShown = async (): Promise<void> => { await screen.findAllByText("U1"); };

function stubFetch(rows: unknown[]): void {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url === "/api/bom") return json(bom(rows));
    if (url === "/api/bom/snapshot") return json({ ok: true, snapshots: [] });
    if (url === "/api/bom/notifications") return json({ ok: true, notifications: [] });
    throw new Error(`unexpected request ${url}`);
  }));
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); window.localStorage.clear(); });

describe("[PR-J4 J4-B] the BOM view's Sheet column", () => {
  it("a project with sheets: the Sheet header and a cell per line; sorting by it groups the lines per sheet", async () => {
    stubFetch([row("U1", "ATmega328P-AU", ["Overview"]), row("U3", "LSM6DS3TR-C", ["IMU"]), row("C1", "Capacitor", ["IMU", "Overview"])]);
    render(<BomView state={SHEETED} projectScope={SCOPE} />);
    await tableShown();
    expect(screen.getByRole("columnheader", { name: /^Sheet/ })).toBeTruthy();
    expect(screen.getAllByTestId("bom-row-sheets").map((cell) => cell.textContent)).toEqual(["C1", "U1", "U3"].map((ref) => ({ C1: "IMU, Overview", U1: "Overview", U3: "IMU" })[ref]));
    expect(screen.queryAllByTestId("bom-sheet-group")).toHaveLength(0); // sorted by reference: no group lines
    await act(async () => { fireEvent.click(screen.getByRole("columnheader", { name: /^Sheet/ })); });
    expect(screen.getAllByTestId("bom-sheet-group").map((line) => line.getAttribute("data-sheets"))).toEqual(["IMU", "IMU, Overview", "Overview"]);
    expect(screen.getAllByTestId("bom-row-sheets").map((cell) => cell.textContent)).toEqual(["IMU", "IMU, Overview", "Overview"]);
    await act(async () => { fireEvent.click(screen.getByRole("columnheader", { name: /^Sheet/ })); }); // the second click flips the direction
    expect(screen.getAllByTestId("bom-row-sheets").map((cell) => cell.textContent)).toEqual(["Overview", "IMU, Overview", "IMU"]);
  });

  it("a project without sheets: no Sheet header, no sheet cell, no group line - the columns it had", async () => {
    stubFetch([row("U1", "ATmega328P-AU"), row("U3", "LSM6DS3TR-C")]);
    render(<BomView state={FLAT} projectScope={SCOPE} />);
    await tableShown();
    expect(screen.queryByRole("columnheader", { name: /^Sheet/ })).toBeNull();
    expect(screen.queryAllByTestId("bom-row-sheets")).toHaveLength(0);
    expect(screen.queryAllByTestId("bom-sheet-group")).toHaveLength(0);
    expect(screen.getAllByRole("columnheader").map((header) => header.textContent)).toEqual(["#", "RefDes", "Qty", "Name", "MPN", "Manufacturer", "Package", "Value", "Lifecycle", "Risk", "Alternates", "Best Source", "Stock", "Unit Price", "Ext. Price", ""].map((label, index) => (index === 1 ? "RefDes ▲" : label)));
  });
});
