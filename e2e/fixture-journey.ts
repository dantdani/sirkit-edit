/**
 * Shared steps of the fixture-runtime browser journey (B16-C.5): a fresh
 * browser, deterministic ids and a frozen clock, the recorded blinker design
 * approved, the review handoff completed, the durable board synchronized and
 * the exact plan applied. The B17 proofs start from this synchronized board.
 */
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { BLINKER_ACCEPTANCE_PROMPT } from "../app/lib/fixture-runtime/blinker/catalog";
import { FIXTURE_CLOCK_DEFAULT } from "../app/lib/fixture-runtime/clock";

export type FixtureRole = "editor" | "reviewer" | "admin" | "viewer";
export const REFS = ["U1", "R1", "R2", "R3", "C1", "C2", "C3", "D1", "J1"] as const;
export const FIXTURE_CLOCK = process.env.SIRKIT_FIXTURE_CLOCK?.trim() || FIXTURE_CLOCK_DEFAULT;

/**
 * Deterministic browser ids: `crypto.randomUUID()` yields a numbered sequence
 * persisted in localStorage (so reloads continue it). Every spec that shares a
 * dev server passes its OWN `uuidNamespace` so two journeys never mint the same
 * project/board ids (the B17-C CI run found the prompt-to-Gerber spec landing
 * on the 3D spec's board: same server, same ids); the placed-board revision the
 * router recording is keyed by is content-derived, so the namespace does not
 * change which recording replays.
 */
export async function installDeterministicBrowser(page: Page, context: BrowserContext, uuidNamespace = "b16c0000"): Promise<void> {
  await context.addInitScript((namespace: string) => {
    const next = (): string => {
      let n = 0;
      try { n = Number(window.localStorage.getItem("sirkit-e2e-uuid-seq") ?? "0"); } catch { n = 0; }
      n += 1;
      try { window.localStorage.setItem("sirkit-e2e-uuid-seq", String(n)); } catch { /* storage unavailable */ }
      return `${namespace}-e2e0-4000-8000-${String(n).padStart(12, "0")}`;
    };
    Object.defineProperty(crypto, "randomUUID", { value: next, configurable: true });
  }, uuidNamespace);
  await page.clock.setFixedTime(new Date(FIXTURE_CLOCK));
}

/** The workspace is interactive only once the client hydrated and the project record loaded (the header shows the
 *  project name instead of "Loading…"); a cold Turbopack client compile can take longer than one expect budget. */
export async function expectHydrated(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: /Untitled project/ })).toBeVisible({ timeout: 120_000 });
}

export async function actAs(context: BrowserContext, role: FixtureRole, baseURL: string): Promise<void> {
  await context.clearCookies();
  await context.addCookies([{ name: "sirkit-fixture-role", value: role, url: baseURL }]);
}

export async function openPcb(page: Page, board: boolean): Promise<void> {
  await page.getByTestId("view-tab-pcb").click();
  if (board) {
    await expect(page.getByTestId("p2g-panel")).toBeVisible();
    await expect(page.getByTestId("p2g-hydration")).toContainText("Durable truth loaded");
  } else {
    await expect(page.getByTestId("pcb-empty-state")).toBeVisible();
  }
}

export async function reloadAs(page: Page, context: BrowserContext, role: FixtureRole, baseURL: string, board: boolean): Promise<void> {
  await actAs(context, role, baseURL);
  await page.clock.setFixedTime(new Date(FIXTURE_CLOCK));
  await page.reload();
  await expect(page.getByTestId("fixture-runtime-banner")).toBeVisible();
  await openPcb(page, board);
}

export async function expectWorkflowState(page: Page, state: string, timeout = 60_000): Promise<void> {
  await expect(page.getByTestId("p2g-workflow-state")).toHaveAttribute("data-state", state, { timeout });
}

/** Prompt → approval → review handoff → sync → explicit apply; ends as the EDITOR on the synchronized board. */
export async function bootstrapSynchronizedBoard(page: Page, context: BrowserContext, origin: string, uuidNamespace: string): Promise<void> {
  await installDeterministicBrowser(page, context, uuidNamespace);
  await actAs(context, "editor", origin);
  await page.goto("/");
  await expect(page.getByTestId("fixture-runtime-banner")).toBeVisible();
  await expectHydrated(page);
  await page.getByTestId("activity-ai chat").click();
  const prompt = page.getByTestId("prompt-input");
  await expect(prompt).toBeEnabled();
  await prompt.fill(BLINKER_ACCEPTANCE_PROMPT);
  await prompt.press("Enter");
  await expect(page.getByTestId("schematic-proposal-review")).toBeVisible({ timeout: 90_000 });
  await page.getByTestId("schematic-proposal-approve").click();
  await expect(page.getByTestId("schematic-proposal-review")).toBeHidden();
  await openPcb(page, false);
  await expect(page.getByTestId("component-review-panel")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("review-request-all").click();
  await expect(page.getByTestId("component-review-pending")).toHaveText(`${REFS.length} pending`, { timeout: 30_000 });
  await reloadAs(page, context, "reviewer", origin, false);
  for (const ref of REFS) {
    await page.getByTestId(`review-approve-${ref}`).click();
    await expect(page.getByTestId(`review-state-${ref}`)).toHaveAttribute("data-state", "approved", { timeout: 30_000 });
  }
  await reloadAs(page, context, "editor", origin, false);
  for (const ref of REFS) await expect(page.getByTestId(`review-state-${ref}`)).toHaveAttribute("data-state", "approved", { timeout: 30_000 });
  await page.getByTestId("sync-schematic-to-pcb").click();
  const apply = page.locator('[data-testid^="apply-sync-plan"]').first();
  await expect(apply).toBeVisible({ timeout: 90_000 });
  await apply.click();
  await expectWorkflowState(page, "awaiting_qualification", 90_000);
}
