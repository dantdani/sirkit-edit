// @vitest-environment jsdom
/**
 * [PR-J1 integration, 2026-10-22] The BOM view's post-action banner ("Snapshot saved.", "Sourcing worksheet downloaded ...") had the
 * PCB editor toast's dismissal race (B24 investigation; fixed for the editor in e1830cfc): `useState` plus an 8 s `setTimeout` in an
 * effect keyed on the banner TEXT. The same text shown again is no state change, so the effect is not re-armed and the FIRST show's
 * timer erases the second banner early; and an earlier timer that comes due between a newer banner's commit and React's passive
 * effects erases the newer banner. The banner now reuses the editor's numbered shows (app/components/pcb/hooks/useToastDismissal.ts):
 * every show arms its own 8 s dismissal, which clears only that show.
 *
 * Case 1 renders the real BomView (fake fetch, no network) and is red on the former composition: a second "Snapshot saved." at 7 s
 * was gone at 8 s instead of staying until 15 s. Case 2 pins the composition in place (no cited line of BomView.tsx moves).
 */
import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BomView } from "../BomView";

const SCOPE = { tenantId: "local", projectId: "p1", branchId: "main" };
const STATE = { components: [], wires: [], kicadComponents: [{ id: "c1", partId: "p1", x: 0, y: 0, rotation: 0, refDes: "U1", value: "ATmega328P" }] } as never;
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
const BOM = {
  ok: true,
  rows: [{ partId: "p1", atomicRevisionId: null, refDes: "U1", refDesList: ["U1"], qty: 1, name: "ATmega328P-AU", mpn: "ATMEGA328P-AU", manufacturer: "Microchip", package: "TQFP-32", value: "ATmega328P", datasheet: null, category: null, pricing: null, lifecycleStatus: "active", alternatesCount: 0, riskScore: { total: 90, grade: "excellent", components: { lifecycle: 35, availability: 30, diversity: 10, pricing: 15 }, notes: [] } }],
  totalUnitsAvailable: [], estimatedProjectCost: { value: 0, currency: "USD" }, pricingSource: "none", cached: 0, fetched: 0,
  lifecycleSummary: { active: 1, nrnd: 0, last_time_buy: 0, eol: 0, obsolete: 0, unknown: 0, totalRows: 1, riskRecommendation: "ok" },
  riskSummary: { overallScore: 90, overallGrade: "excellent", totalRows: 1, rowsAtRisk: 0, worstRows: [], productionReady: true, recommendation: "Supply signals look healthy." }, warnings: [], pricingMode: "none", registryVersion: "1.0.0", sources: [], generatedAt: 0,
};

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); window.localStorage.clear(); });

const BANNER = "Snapshot saved.";
const bannerShown = (): boolean => screen.queryByText(BANNER) !== null;
/** Takes a snapshot through the view's own controls; resolves once the save's answer is handled. */
async function takeSnapshot(): Promise<void> {
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Take snapshot" })); });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save" })); for (let tick = 0; tick < 10; tick += 1) await Promise.resolve(); });
}

describe("[PR-J1 integration, 2026-10-22] the BOM banner's dismissal clears only the show it was armed for", () => {
  it("1. the same banner shown again at 7 s stays its full 8 s (until 15 s): the first show's timer does not cut it short", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url === "/api/bom") return json(BOM);
      if (url === "/api/bom/snapshot") return json({ ok: true, snapshots: [] });
      if (url === "/api/bom/notifications") return json({ ok: true, notifications: [] });
      throw new Error(`unexpected request ${url}`);
    }));
    render(<BomView state={STATE} projectScope={SCOPE} />);
    await screen.findByText("U1");
    await waitFor(() => expect((screen.getByRole("button", { name: "Take snapshot" }) as HTMLButtonElement).disabled).toBe(false));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await takeSnapshot();
    expect(bannerShown()).toBe(true);
    act(() => { vi.advanceTimersByTime(7000); });
    expect(bannerShown()).toBe(true);
    await takeSnapshot();
    expect(bannerShown()).toBe(true);
    act(() => { vi.advanceTimersByTime(2000); }); // 9 s after the first show, 2 s after the second
    expect(bannerShown(), "the second banner is still on screen 2 s after its show").toBe(true);
    act(() => { vi.advanceTimersByTime(5900); });
    expect(bannerShown()).toBe(true);
    act(() => { vi.advanceTimersByTime(200); }); // 8.1 s after the second show
    expect(bannerShown()).toBe(false);
  });

  it("2. the view composes the editor's numbered shows, edited in place: no other banner timer, the dismiss control unchanged", () => {
    const source = readFileSync("app/components/bom/BomView.tsx", "utf8");
    const lines = source.split("\n");
    expect(source).toContain('import { firstToast, showToast, useToastDismissal } from "@/app/components/pcb/hooks/useToastDismissal";');
    expect(lines[447]).toMatch(/^ {2}const \[shownBanner, setBanner\] = useReducer\(showToast, null, firstToast\); const banner = shownBanner\.text;/);
    expect(lines[487]).toMatch(/^ {2}useToastDismissal\(shownBanner, setBanner, BANNER_DISMISS_MS\);/);
    expect(source).not.toMatch(/setTimeout\([^;]*setBanner\(/);
    expect(source.match(/useToastDismissal\(/g)).toHaveLength(1);
    expect(source).toContain("onClick={() => setBanner(null)}");
  });
});
