// @vitest-environment jsdom
/**
 * [B24-D3] D24-32, OD-215 "the BOM dialogs moved onto the shared dialog" (discovery section 8 item 10): the four BOM dialogs
 * (`SourcingWorksheetModal`, `HistoryPanel`, `NotificationsDrawer`, `AlternatesDrawer` in app/components/bom/BomView.tsx) run on
 * components/ui/dialog.tsx (Base UI). For each of the four:
 *
 *  1. it is named by its visible heading (`getByRole("dialog", { name })`);
 *  2. focus is inside it once it opens;
 *  3. Escape closes it and focus returns to the control that opened it - the opener is focused before it is activated
 *     (`fireEvent.click` moves no focus in jsdom, and `@testing-library/user-event` is neither installed nor admitted, OD-215);
 *     the worksheet's opener is the "Export for distributor ▾" trigger, whose menu item unmounts when the worksheet opens, so the
 *     case focuses that menu item before clicking it, as a browser does, and focus can only come back through `finalFocus`;
 *  4. it has exactly one control named "Close": `DialogContent`'s own (the drawers' "✕" buttons are gone; the worksheet's "Cancel"
 *     is its form's cancel, not a Close); and no button inside it is named by a glyph alone - a "✕" takes its name from its
 *     content, never "Close", so the count alone could not see one come back ([B24-D3 review, 2026-10-10] correctness-3).
 *
 * The harness is b19-e-bom-workbench's (jsdom, fetch stubbed in process; no network). Base UI's Tab trap is NOT measured here:
 * jsdom has no sequential focus navigation, so the trap stays INFERRED for these four (accessibility.md); the browser spec
 * e2e/keyboard-and-focus.spec.ts measures it on the Tier 1 card only.
 *
 * Each case renders the BOM afresh and waits for its result (a cold import of the BOM view can take a few seconds), so each carries
 * an explicit 30 s budget (lead lesson 14).
 *
 * Failing first on 3773c6a: every case of every dialog (hand-rolled `role="dialog"` containers with no name, no focus move, no
 * Escape handler; the drawers' close controls are named "✕"). Nothing is written.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BomView } from "@/app/components/bom/BomView";

const SCOPE = { tenantId: "local", projectId: "p1", branchId: "main" };
const STATE = { components: [], wires: [], kicadComponents: [{ id: "c1", partId: "p1", x: 0, y: 0, rotation: 0, refDes: "U1", value: "ATmega328P" }] } as never;
const STORAGE_KEY = "sirkit:bom:pricingChoice";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** One BOM line with two alternates (so its alternates control renders) and no pricing. */
function bomResult(t0: number) {
  const row = {
    partId: "p1", atomicRevisionId: null, refDes: "U1", refDesList: ["U1"], qty: 1, name: "ATmega328P-AU", mpn: "ATMEGA328P-AU", manufacturer: "Microchip", package: "TQFP-32", value: "ATmega328P", datasheet: null, category: null,
    pricing: { partId: "p1", mpn: "ATMEGA328P-AU", offers: [], bestOverall: null, lifecycleStatus: "active", sourcesQueried: [], sourcesFromCache: 0, sourcesFromLive: 0 },
    lifecycleStatus: "active", alternatesCount: 2,
    riskScore: { total: 90, grade: "excellent", components: { lifecycle: 35, availability: 30, diversity: 10, pricing: 15 }, notes: [] },
  };
  return {
    ok: true, rows: [row], totalUnitsAvailable: [], estimatedProjectCost: { value: null, currency: null }, pricingSource: "none", cached: 0, fetched: 0,
    lifecycleSummary: { active: 1, nrnd: 0, last_time_buy: 0, eol: 0, obsolete: 0, unknown: 0, totalRows: 1, riskRecommendation: "ok" },
    riskSummary: { overallScore: 90, overallGrade: "excellent", totalRows: 1, rowsAtRisk: 0, worstRows: [], productionReady: true, recommendation: "Supply signals look healthy." },
    warnings: [], pricingMode: "none", registryVersion: "1.0.0", sources: [], generatedAt: t0,
  };
}

function stubFetch(t0: number) {
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) => {
    if (url === "/api/bom") return json(bomResult(t0));
    if (url === "/api/bom/snapshot") return json({ ok: true, snapshots: [] });
    if (url === "/api/bom/notifications") return json({ ok: true, notifications: [] });
    if (url.startsWith("/api/parts/p1/alternates")) return json({ ok: true, alternates: [] });
    throw new Error(`unexpected request ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function renderLoaded(): Promise<void> {
  stubFetch(Date.now());
  render(<BomView state={STATE} projectScope={SCOPE} />);
  await screen.findByText("U1");
}

interface BomDialog {
  readonly id: string;
  /** The dialog's visible heading, its accessible name. */
  readonly name: string | RegExp;
  /** Focuses the opener, activates it (as a person would), and returns the control focus must come back to. */
  readonly open: () => Promise<HTMLElement>;
}

const DIALOGS: readonly BomDialog[] = [
  {
    id: "SourcingWorksheetModal",
    name: "Sourcing worksheet (CSV, unverified)",
    open: async () => {
      const trigger = screen.getByRole("button", { name: /Export for distributor/ });
      await waitFor(() => expect((trigger as HTMLButtonElement).disabled).toBe(false));
      trigger.focus();
      fireEvent.click(trigger);
      const item = screen.getByRole("button", { name: /Sourcing worksheet \(CSV, unverified\)/ });
      item.focus(); // a click focuses the menu item in a browser; the item unmounts as the worksheet opens
      fireEvent.click(item);
      return trigger;
    },
  },
  {
    id: "HistoryPanel",
    name: "Snapshot history",
    open: async () => {
      const opener = screen.getByRole("button", { name: /^History \(/ });
      await waitFor(() => expect((opener as HTMLButtonElement).disabled).toBe(false));
      opener.focus();
      fireEvent.click(opener);
      return opener;
    },
  },
  {
    id: "NotificationsDrawer",
    name: "Notifications",
    open: async () => {
      const opener = screen.getByTitle("Supply-chain notifications");
      await waitFor(() => expect((opener as HTMLButtonElement).disabled).toBe(false));
      opener.focus();
      fireEvent.click(opener);
      return opener;
    },
  },
  {
    id: "AlternatesDrawer",
    name: /^Alternates for U1/,
    open: async () => {
      const opener = screen.getByTitle("View alternate parts");
      opener.focus();
      fireEvent.click(opener);
      return opener;
    },
  },
];

beforeEach(() => {
  window.localStorage.setItem(STORAGE_KEY, "none");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

for (const dialog of DIALOGS) {
  describe(`[B24-D3] the BOM's ${dialog.id} on the shared dialog`, () => {
    it("1. it is named by its visible heading", { timeout: 30_000 }, async () => {
      await renderLoaded();
      await dialog.open();
      expect(await screen.findByRole("dialog", { name: dialog.name })).toBeTruthy();
    });

    it("2. focus is inside it once it opens", { timeout: 30_000 }, async () => {
      await renderLoaded();
      await dialog.open();
      const opened = await screen.findByRole("dialog", { name: dialog.name });
      await waitFor(() => expect(opened.contains(document.activeElement), `focus is on ${document.activeElement?.outerHTML.slice(0, 120)}`).toBe(true));
    });

    it("3. Escape closes it and focus returns to the control that opened it", { timeout: 30_000 }, async () => {
      await renderLoaded();
      const opener = await dialog.open();
      const opened = await screen.findByRole("dialog", { name: dialog.name });
      await waitFor(() => expect(opened.contains(document.activeElement)).toBe(true));
      fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      await waitFor(() => expect(document.activeElement, `focus is on ${document.activeElement?.outerHTML.slice(0, 120)}`).toBe(opener));
    });

    it('4. it has exactly one control named "Close"', { timeout: 30_000 }, async () => {
      await renderLoaded();
      await dialog.open();
      const opened = await screen.findByRole("dialog"); // by role alone: on 3773c6a the dialog has no name, and this case's red is the count
      const close = screen.queryAllByRole("button", { name: "Close" });
      expect(close).toHaveLength(1);
      // [B24-D3 review, 2026-10-10] correctness-3: a hand-rolled "✕" is named by its glyph (content wins over title), never "Close",
      // so the count alone let one back in: the one Close is the shared dialog's, and no button inside is named by a glyph alone.
      expect(close[0]!.getAttribute("data-slot")).toBe("dialog-close");
      const glyphOnly = within(opened).queryAllByRole("button").filter((button) => !button.getAttribute("aria-label") && !/[\p{L}\p{N}]/u.test(button.textContent ?? ""));
      expect(glyphOnly.map((button) => button.outerHTML.slice(0, 160)), "a button named by a glyph alone").toEqual([]);
    });
  });
}
