/**
 * [PR-E] The simplified workspace in a FRESH browser under the fixture runtime: the empty sheet's own circuit-entry action
 * opens the chat and focuses the composer; the header's Settings control opens a real, labelled settings dialog that
 * closes on Escape and returns focus; the 3D tab says plainly that there is no board yet and offers the PCB tab; the Build
 * sidebar's design checks carry real states (not run / pass / findings) with the digest they were computed on; and the
 * essential actions stay visible at the ordinary desktop sizes (1280×720 minimum, 1366×768, 1440×900, 1920×1080) with the
 * chat open and closed. Screenshots of the real workspace are written beside the evidence (never mockups). Fake-backed:
 * the fixture runtime, the recorded design and the scripted agent; it proves the page's contract, not live providers.
 */
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { BLINKER_ACCEPTANCE_PROMPT } from "../app/lib/fixture-runtime/blinker/catalog";
import { FIXTURE_CLOCK_DEFAULT } from "../app/lib/fixture-runtime/clock";
import { actAs, installDeterministicBrowser } from "./fixture-journey";

const FIXTURE_CLOCK = process.env.SIRKIT_FIXTURE_CLOCK?.trim() || FIXTURE_CLOCK_DEFAULT;
const SHOTS = join(process.cwd(), "artifacts", "product-reliability-simple-ui", "screenshots");
const SIZES = [[1280, 720], [1366, 768], [1440, 900], [1920, 1080]] as const;

test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);

/** Open or close the chat by its activity-bar toggle, reading the current state first (the page may have opened it itself). */
async function setChatOpen(page: Page, open: boolean): Promise<void> {
  const visible = (await page.getByTestId("prompt-input").count()) > 0;
  if (visible !== open) await page.getByTestId("activity-ai chat").click();
  if (open) await expect(page.getByTestId("prompt-input")).toBeVisible(); else await expect(page.getByTestId("prompt-input")).toHaveCount(0);
}

async function expectEssentialsVisible(page: Page): Promise<void> {
  // the journey strip with its next action, the workspace tabs, the mode toggle and the settings control never scroll away or overlap the canvas
  await expect(page.getByTestId("journey-strip")).toBeVisible();
  await expect(page.getByTestId("journey-next-action")).toBeVisible();
  await expect(page.getByTestId("workspace-tabs")).toBeVisible();
  await expect(page.getByTestId("workspace-settings")).toBeVisible();
  const strip = await page.getByTestId("journey-strip").boundingBox();
  const canvas = await page.getByTestId("workspace-tabs").boundingBox();
  expect(strip && canvas && strip.y + strip.height <= canvas.y + 1).toBe(true); // the strip sits above the workspace, not over it
}

test("fresh browser: entry action, settings dialog, 3D unavailable state, computed design checks, and the essentials at four desktop sizes", async ({ page, context, baseURL }) => {
  const origin = baseURL!;
  mkdirSync(SHOTS, { recursive: true });
  await installDeterministicBrowser(page, context, "e0e00000");
  await page.clock.setFixedTime(new Date(FIXTURE_CLOCK));
  await actAs(context, "editor", origin);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/");
  await expect(page.getByTestId("fixture-runtime-banner")).toBeVisible();

  // 1. the empty sheet's own entry action: no hint pointing "above", one labelled button that opens the chat and focuses the composer.
  await expect(page.getByText("Describe a circuit above")).toHaveCount(0);
  await expect(page.getByTestId("prompt-input")).toHaveCount(0); // chat closed on a fresh load
  await page.getByTestId("empty-sheet-describe-circuit").click();
  await expect(page.getByTestId("prompt-input")).toBeFocused();
  await page.screenshot({ path: join(SHOTS, "after-1366x768-empty-sheet-chat-open.png"), fullPage: false });

  // 2. the settings control is labelled and opens a real dialog with the existing settings; Escape closes it and focus returns.
  const settings = page.getByTestId("workspace-settings");
  await expect(settings).toHaveAttribute("aria-label", "Workspace settings");
  await settings.click();
  const dialog = page.getByTestId("workspace-settings-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Sheet size")).toBeVisible();
  await expect(dialog.getByLabel("AI Brain")).toBeVisible();
  await expect(dialog.getByText(/Release, qualification and ordering are never done by the assistant/)).toBeVisible();
  await expect(dialog.getByTestId("autonomy-control")).not.toHaveAttribute("data-mode", "loading"); // the autonomy control works inside the dialog (it was in the chat header)
  await page.screenshot({ path: join(SHOTS, "after-1366x768-settings-dialog.png"), fullPage: false });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(settings).toBeFocused();

  // 3. the 3D tab without a board: an accurate unavailable state with a way to the PCB tab, never a placeholder literal.
  await page.getByTestId("view-tab-3d").click();
  await expect(page.getByTestId("pcb-3d-unavailable")).toBeVisible();
  await expect(page.getByText(/^3D view$/)).toHaveCount(0);
  await page.getByTestId("pcb-3d-open-pcb").click();
  await expect(page.getByTestId("pcb-empty-state")).toBeVisible();
  await page.getByTestId("view-tab-schematic").click(); // the tab itself (the accessible name "Schematic" is shared by Undo/Redo and the sync button)

  // 4. the design checks live in the Build Library panel (closed on a fresh load): "not run" on an empty sheet, with a digest;
  //    real states after the recorded design is applied.
  await page.getByTestId("activity-build library").click();
  await expect(page.getByTestId("design-checks")).toBeVisible();
  await expect(page.getByTestId("design-check-floating-nets")).toHaveAttribute("data-state", "not_run");
  await expect(page.getByTestId("design-check-supply-rails")).toHaveAttribute("data-state", "not_run");
  // [PR-L/M integration, 2026-10-18] the Build Library's catalog loads from the fixture catalog (before, GET /api/parts/categories and
  // POST /api/parts/search read only the database and answered 500 under the fixture runtime: "Could not load categories"); a category
  // lists its parts, and the panel goes back to the categories
  const timerCategory = page.getByRole("button", { name: /^Timer\s*\d+$/ });
  await expect(timerCategory).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Could not load categories")).toHaveCount(0);
  await timerCategory.click();
  await expect(page.getByRole("button", { name: /555/ }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Could not load parts")).toHaveCount(0);
  await page.getByRole("button", { name: "Categories", exact: true }).click();
  await expect(timerCategory).toBeVisible();
  const prompt = page.getByTestId("prompt-input");
  await prompt.fill(BLINKER_ACCEPTANCE_PROMPT);
  await prompt.press("Enter");
  await expect(page.getByTestId("schematic-proposal-review")).toBeVisible({ timeout: 90_000 });
  // [PR-F, 2026-10-17] the page runs two post-apply AI passes after approval (layout critic, review); under the fixture both answer
  // 503 and the existing provider-failure card AUTO-OPENS the chat (B07.5). The spec waits for both so the size loop below never races
  // that auto-open — the behaviour itself is the product's, the waiting is the spec's.
  const postApply = Promise.all([
    page.waitForResponse((response) => response.url().includes("/api/schematic/layout-critic"), { timeout: 60_000 }),
    page.waitForResponse((response) => response.url().includes("/api/schematic/review"), { timeout: 60_000 }),
  ]);
  await page.getByTestId("schematic-proposal-approve").click();
  await expect(page.getByTestId("schematic-proposal-review")).toBeHidden();
  const [critic, review] = await postApply;
  expect([critic.status(), review.status()]).toEqual([503, 503]); // the fixture has no provider: the honest refusal, never a fake pass
  await expect(page.getByText(/is currently unavailable\./)).toBeVisible(); // the existing card, chat auto-opened
  await expect(page.getByTestId("design-check-floating-nets")).toHaveAttribute("data-state", /pass|findings/, { timeout: 30_000 });
  await expect(page.getByTestId("design-check-supply-rails")).toHaveAttribute("data-state", /pass|findings/);
  const digest = await page.getByTestId("design-checks").getAttribute("data-digest");
  expect(digest).toMatch(/^eng1-/);
  await page.screenshot({ path: join(SHOTS, "after-1366x768-schematic-applied.png"), fullPage: false });

  // 5. the essentials at the ordinary desktop sizes, chat open and closed; a screenshot per size with the chat open.
  for (const [width, height] of SIZES) {
    await page.setViewportSize({ width, height });
    await expectEssentialsVisible(page);
    await page.screenshot({ path: join(SHOTS, `after-${width}x${height}-schematic-chat-open.png`), fullPage: false });
    // [PR-F, 2026-10-17] the toggle is made idempotent: after an applied proposal the page's post-apply AI passes answer 503 under the
    // fixture and the existing provider-failure card AUTO-OPENS the chat (B07.5); a blind second click would toggle it shut again.
    await setChatOpen(page, false);
    await expect(page.getByTestId("prompt-input")).toHaveCount(0);
    await expectEssentialsVisible(page);
    await setChatOpen(page, true);
    await expect(page.getByTestId("prompt-input")).toBeVisible();
  }
});
