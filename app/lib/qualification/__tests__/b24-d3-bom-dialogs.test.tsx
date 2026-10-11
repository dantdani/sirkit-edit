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
 *
 * [B24-D4, 2026-10-10] D24-32's CI red (run 38061798204, e2e/keyboard-and-focus.spec.ts case 4: focus on `body` after Escape on the
 * Tier 1 card). Case 5, after the four dialogs: the card (`GrantedExecutionDialog`, mounted by PcbEditor) opens from a chat run sent
 * from the prompt while the prompt is disabled (focus on `body`), and when it closes - by Escape, Cancel or Confirm - focus lands on
 * the prompt, through the card's `finalFocus`. Failing first on 1fe719e (`d4r2-04-red-card-focus`): Base UI's default returned focus
 * to the element focused when the card opened, `body`, and moved it to `body`'s first tabbable control.
 * [B24-D4 review, 2026-10-10] correctness-1, case 6: the card closed while the prompt is STILL disabled (the run streaming) moves no
 * focus - Base UI's default would put it on the last element an earlier popup recorded (here, as locally, the page's first control),
 * where page.tsx's run-end return (`app/page.tsx`, `returnFocus`, which acts only from `body`) cannot reach it - so focus is on
 * `body`, and the run's end takes it to the prompt (that line's code is transpiled and run over jsdom here, as
 * b24-d3-accessible-names 11 runs the page's focus code, since a unit cannot mount the page). Failing first on the D4 tree before
 * this fix (`d4fix-03-red-card-focus`, `d4fix-06-red-card-focus-2`: focus on the page's first control).
 */
import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BomView } from "@/app/components/bom/BomView";
import { GrantedExecutionDialog } from "@/app/components/pcb/GrantedExecutionDialog";
import type { PublicExecutionGrant } from "@/app/lib/engineering/execution-grant";
import { CHAT_PROMPT_LABEL } from "@/app/lib/accessibility/statements";

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

/** [B24-D4, 2026-10-10] A Tier 1 move grant the card shows (b18-d-granted-execution-card's shape). */
function cardGrant(): PublicExecutionGrant {
  return {
    grantId: `xg-${"4".repeat(32)}`,
    binding: {
      operation: { family: "pcb.move-footprint", tier: 1, decision: "preview_then_confirm", autonomy: { mode: "proposal_only", revision: 1 } },
      targets: { resolvedFrom: "named", objectIds: ["fp-r3"], netIds: [], kinds: ["footprint"] },
      proposal: { operationCount: 1, operations: [{ kind: "move_footprint", footprintId: "fp-r3", at: { x: 52_000_000, y: 47_480_000 } }], preview: { before: "R3 at (50.000, 47.480) mm", after: "R3 at (52.000, 47.480) mm", warnings: [] } },
      base: { pcb: { pcbRevisionId: "pcb2-0123456789abcdef0123456789", headSequence: 7, validationPolicy: { presetId: "jlcpcb-2l", presetVersion: "2" } } },
      scope: { projectId: "proj-b24d4", branchId: "main" },
      instruction: { excerpt: "Move R3 2 mm to the right.", explicit: { proven: false, grammarId: "pcb.move-footprint", grammarVersion: "1.4.0", coverage: "unproven", derivedOperationsDigest: null } },
      expiresAt: "2026-10-10T12:10:00.000Z",
    },
  } as unknown as PublicExecutionGrant;
}

describe("[B24-D4] the Tier 1 card returns focus to the prompt (D24-32, 2.4.3; CI run 38061798204, keyboard-and-focus 4)", () => {
  it("5. the card, opened while the prompt was disabled (focus on body), closes by Escape, Cancel or Confirm and focus lands on the prompt - never on body or the page's first control", { timeout: 30_000 }, async () => {
    for (const close of ["Escape", "Cancel", "Confirm"] as const) {
      const onCancel = vi.fn();
      const onConfirm = vi.fn();
      // the page around the card: a control before the prompt (the header's first button), then the chat's prompt as page.tsx renders it
      const view = (pending: PublicExecutionGrant | null, promptDisabled: boolean) => (
        <>
          <button type="button">Header first control</button>
          <textarea data-testid="prompt-input" aria-label={CHAT_PROMPT_LABEL} disabled={promptDisabled} />
          <GrantedExecutionDialog grant={pending} note={null} busy={false} disableReason={null} onConfirm={onConfirm} onCancel={onCancel} />
        </>
      );
      // the run streams: the prompt is disabled, so focus is on body when the card opens
      const { rerender, unmount } = render(view(null, true));
      (document.activeElement as HTMLElement | null)?.blur();
      expect(document.activeElement).toBe(document.body);
      rerender(view(cardGrant(), true));
      const dialog = await screen.findByRole("dialog", { name: "AI change — confirm before it is made" });
      await waitFor(() => expect(dialog.contains(document.activeElement), `${close}: focus is inside the card`).toBe(true));
      // the run ends with the card open: the prompt is enabled again
      rerender(view(cardGrant(), false));
      if (close === "Escape") fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
      else if (close === "Cancel") fireEvent.click(within(dialog).getByRole("button", { name: "Cancel — change nothing" }));
      else fireEvent.click(within(dialog).getByTestId("granted-execution-confirm"));
      expect(close === "Confirm" ? onConfirm : onCancel, `${close} reaches its handler`).toHaveBeenCalledTimes(1);
      // PcbEditor clears the pending grant (cancelled, or the confirmed change settled): the card closes
      rerender(view(null, false));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      const prompt = screen.getByTestId("prompt-input");
      await waitFor(() => expect(document.activeElement, `${close}: focus is on ${document.activeElement?.outerHTML.slice(0, 120)}`).toBe(prompt));
      unmount();
    }
  });

  it("6. [B24-D4 review] the card closed while the prompt is still disabled moves no focus - never onto the page's first control, Base UI's default target here - so it is on body, where page.tsx's run-end return takes it to the prompt", { timeout: 30_000 }, async () => {
    // page.tsx's run-end return, as written on its line, transpiled and run over jsdom's document (a unit cannot mount the page; the
    // B24-D3 precedent is b24-d3-accessible-names 11): for a run sent from the prompt with no pointer pressed since
    // (chatFocusReturnRef set), it acts only from body, waits frame by frame while the prompt is disabled, then focuses it
    const pageLine = readFileSync("app/page.tsx", "utf8").split(String.fromCharCode(10)).find((line) => line.includes("const returnFocus = (frames: number): void =>"));
    expect(pageLine, "page.tsx's run-end return").toBeTruthy();
    const from = pageLine!.indexOf("const returnFocus = ");
    const scheduled = "window.requestAnimationFrame(() => returnFocus(30));";
    const until = pageLine!.indexOf(scheduled, from);
    expect(until, "the return is scheduled on the same line").toBeGreaterThan(from);
    const runEndJs = ts.transpileModule(pageLine!.slice(from, until + scheduled.length), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText.replace(/^"use strict";\s*/, "").replace(/^export \{\};\s*$/m, "");
    /** The run ends: page.tsx's code runs; its frames run when `flush` is called (a frame queue, as a browser's). */
    const runEnd = (): { flush: () => void } => {
      const frames: Array<() => void> = [];
      new Function("chatFocusReturnRef", "document", "window", runEndJs)({ current: true }, document, { requestAnimationFrame: (callback: () => void) => frames.push(callback) });
      return { flush: () => { for (const callback of frames.splice(0)) callback(); } };
    };
    for (const close of ["Escape", "Cancel", "Confirm"] as const) {
      const onCancel = vi.fn();
      const onConfirm = vi.fn();
      const view = (pending: PublicExecutionGrant | null, promptDisabled: boolean) => (
        <>
          <button type="button">Header first control</button>
          <textarea data-testid="prompt-input" aria-label={CHAT_PROMPT_LABEL} disabled={promptDisabled} />
          <GrantedExecutionDialog grant={pending} note={null} busy={false} disableReason={null} onConfirm={onConfirm} onCancel={onCancel} />
        </>
      );
      const { rerender, unmount } = render(view(null, false));
      // an earlier popup of this session opened while the page's first control held focus: Base UI records it as its default
      // return target (its list of previously focused elements); this card, closed with the prompt enabled, still returns to the prompt
      screen.getByRole("button", { name: "Header first control" }).focus();
      rerender(view(cardGrant(), false));
      const earlier = await screen.findByRole("dialog", { name: "AI change — confirm before it is made" });
      await waitFor(() => expect(earlier.contains(document.activeElement)).toBe(true));
      fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
      rerender(view(null, false));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      const prompt = screen.getByTestId("prompt-input") as HTMLTextAreaElement;
      await waitFor(() => expect(document.activeElement).toBe(prompt));
      onCancel.mockClear();
      // the next run streams: the prompt is disabled and focus falls to body (a browser blurs a control it disables; jsdom does not,
      // and refuses blur() on a disabled one, so the blur comes first); the grant arrives mid-stream and the card opens
      prompt.blur();
      rerender(view(null, true));
      expect(document.activeElement).toBe(document.body);
      rerender(view(cardGrant(), true));
      const dialog = await screen.findByRole("dialog", { name: "AI change — confirm before it is made" });
      await waitFor(() => expect(dialog.contains(document.activeElement), `${close}: focus is inside the card`).toBe(true));
      // closed at once, before the run ends: the prompt is still disabled
      if (close === "Escape") fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
      else if (close === "Cancel") fireEvent.click(within(dialog).getByRole("button", { name: "Cancel — change nothing" }));
      else fireEvent.click(within(dialog).getByTestId("granted-execution-confirm"));
      expect(close === "Confirm" ? onConfirm : onCancel, `${close} reaches its handler`).toHaveBeenCalledTimes(1);
      rerender(view(null, true));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(document.activeElement, `${close}: focus is on ${document.activeElement?.outerHTML.slice(0, 120)}, not on body`).toBe(document.body);
      // the run ends: page.tsx's return runs while the prompt is still disabled (it waits a frame), the prompt is enabled on the
      // re-render, and the next frame takes focus from body to the prompt
      const end = runEnd();
      end.flush();
      expect(document.activeElement, `${close}: the prompt still disabled, the return waits`).toBe(document.body);
      rerender(view(null, false));
      end.flush();
      expect(document.activeElement, `${close}: after the run's end`).toBe(prompt);
      unmount();
    }
  });
});
