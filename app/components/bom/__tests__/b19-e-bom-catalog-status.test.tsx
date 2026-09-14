// @vitest-environment jsdom
/**
 * [B19-E E5 h] The BOM workbench shows each line's atomic revision status: a published revision shows nothing extra; a
 * deprecated, superseded, revoked or unpublished one shows a badge that says what it means (OD-38), and a line whose revision
 * names a successor offers "Review successor", which hands the line to the page (the rebind itself is a reviewer's act in the
 * component review panel). Nothing here reads as an order.
 *
 * Reproduced on the unchanged code: no badge and no action existed.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BomView } from "../BomView";

const SCOPE = { tenantId: "local", projectId: "p1", branchId: "main" };
const STATE = { components: [], wires: [], kicadComponents: [{ id: "c1", partId: "p1", x: 0, y: 0, rotation: 0, refDes: "U1", value: "NE555" }] } as never;

function line(refDes: string, catalogStatus: { state: string; successorRevisionId: string | null } | null) {
  return {
    partId: `p-${refDes}`, atomicRevisionId: catalogStatus ? `atomic_${refDes.toLowerCase()}` : null, refDes, refDesList: [refDes], qty: 1, name: `${refDes}-PART`, mpn: `${refDes}-MPN`, manufacturer: "Fixture Corp", package: null, value: null, datasheet: null, category: null,
    pricing: null, lifecycleStatus: "unknown", alternatesCount: 0,
    riskScore: { total: 50, grade: "caution", components: { lifecycle: 10, availability: 10, diversity: 10, pricing: 20 }, notes: [] },
    catalogStatus,
  };
}

function bomResult(rows: ReturnType<typeof line>[]) {
  return {
    ok: true, rows, totalUnitsAvailable: [], estimatedProjectCost: { value: null, currency: null }, pricingSource: "none", cached: 0, fetched: 0,
    lifecycleSummary: { active: 0, nrnd: 0, last_time_buy: 0, eol: 0, obsolete: 0, unknown: rows.length, totalRows: rows.length, riskRecommendation: "ok" },
    riskSummary: { overallScore: 50, overallGrade: "caution", totalRows: rows.length, rowsAtRisk: 0, worstRows: [], productionReady: false, recommendation: "Supply signals unknown." },
    warnings: [], pricingMode: "none", registryVersion: "1.1.0", sources: [], generatedAt: Date.now(),
  };
}

const ROWS = [
  line("U1", { state: "published", successorRevisionId: null }),
  line("U2", { state: "superseded", successorRevisionId: "atomic_u2_successor" }),
  line("U3", { state: "revoked", successorRevisionId: null }),
  line("U4", { state: "deprecated", successorRevisionId: "atomic_u4_successor" }),
  line("U5", { state: "unpublished", successorRevisionId: null }),
  line("U6", null),
];

function stubFetch() {
  const fetchMock = vi.fn(async (url: string) => {
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    if (url === "/api/bom") return json(bomResult(ROWS));
    if (url === "/api/bom/snapshot") return json({ ok: true, snapshots: [] });
    if (url === "/api/bom/notifications") return json({ ok: true, notifications: [] });
    throw new Error(`unexpected request ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
}
const rowOf = (refDes: string) => screen.getByText(refDes, { selector: "td" }).closest("tr")!;

beforeEach(() => { window.localStorage.setItem("sirkit:bom:pricingChoice", "none"); stubFetch(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); window.localStorage.clear(); });

describe("[B19-E E5 h] BOM catalog status badge and Review successor", () => {
  it("labels every withdrawn or unpublished revision and leaves a published one unmarked", async () => {
    render(<BomView state={STATE} projectScope={SCOPE} onReviewSuccessor={() => undefined} />);
    await screen.findByText("U6", { selector: "td" });
    expect(within(rowOf("U1")).queryByTestId("bom-catalog-status")).toBeNull();
    expect(within(rowOf("U6")).queryByTestId("bom-catalog-status")).toBeNull();
    const badge = (refDes: string) => within(rowOf(refDes)).getByTestId("bom-catalog-status");
    expect(badge("U2").textContent).toBe("Superseded revision");
    expect(badge("U3").textContent).toBe("Revoked revision");
    expect(badge("U4").textContent).toBe("Deprecated revision");
    expect(badge("U5").textContent).toBe("Unpublished revision");
    expect(badge("U2").getAttribute("title")).toMatch(/existing pins keep working/i);
    expect(badge("U3").getAttribute("title")).toMatch(/fails closed/i);
  });

  it("offers Review successor only where a successor is named, and hands the line to the page", async () => {
    const onReviewSuccessor = vi.fn();
    render(<BomView state={STATE} projectScope={SCOPE} onReviewSuccessor={onReviewSuccessor} />);
    await screen.findByText("U6", { selector: "td" });
    expect(within(rowOf("U3")).queryByRole("button", { name: "Review successor" })).toBeNull();
    expect(within(rowOf("U1")).queryByRole("button", { name: "Review successor" })).toBeNull();
    fireEvent.click(within(rowOf("U2")).getByRole("button", { name: "Review successor" }));
    expect(onReviewSuccessor).toHaveBeenCalledTimes(1);
    expect(onReviewSuccessor.mock.calls[0]![0]).toMatchObject({ refDesList: ["U2"], atomicRevisionId: "atomic_u2", catalogStatus: { state: "superseded", successorRevisionId: "atomic_u2_successor" } });
    expect(within(rowOf("U4")).getByRole("button", { name: "Review successor" })).toBeTruthy();
  });

  it("without a page handler no Review successor action is shown; no status control reads as an order", async () => {
    render(<BomView state={STATE} projectScope={SCOPE} />);
    await screen.findByText("U6", { selector: "td" });
    expect(screen.queryByRole("button", { name: "Review successor" })).toBeNull();
    for (const badge of screen.getAllByTestId("bom-catalog-status")) expect(`${badge.textContent} ${badge.getAttribute("title")}`).not.toMatch(/add to cart|checkout|\bbuy\b|place (an )?order|purchase order|order now/i);
  });
});
