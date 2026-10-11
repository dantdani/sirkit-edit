/**
 * [B24-D3] D24-32, OD-215 - responsive scope: desktop only, with a stated minimum width and a visible notice below it.
 * EDITOR_MIN_WIDTH_PX (app/lib/accessibility/statements.ts) is 1,280: the one width every spec has exercised (`devices["Desktop
 * Chrome"]`, playwright.config.ts). No bootstrap: the spec loads `/` (a fresh, empty project), opens the chat first (the prompt is
 * not rendered on a plain load of `/`), and measures with the left panel closed (the default) and open (its default 240 px).
 *
 *  1. The project's viewport is Desktop Chrome's 1280 x 720.
 *  2. At EDITOR_MIN_WIDTH_PX, closed and then open: the notice is hidden; the activity bar's AI Chat button, the schematic Go to
 *     component field and the chat prompt lie inside the viewport and are hit-testable (the element at each centre is the element
 *     or a descendant); the page does not scroll sideways (scrollWidth <= innerWidth).
 *  3. At EDITOR_MIN_WIDTH_PX - 1 the notice is visible and says exactly MIN_WIDTH_NOTICE.
 *
 * Below 768 px the pre-existing rule in app/globals.css turns the chat into a fixed overlay; that width is not qualified and no case
 * here measures it (accessibility.md section 6). Expected red on 3773c6a: case 3 (no notice). Clicks are used here (this spec is
 * about layout, not keyboard use). No real network, provider or database.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { EDITOR_MIN_WIDTH_PX, MIN_WIDTH_NOTICE } from "../app/lib/accessibility/statements";
import { expectHydrated } from "./fixture-journey";

test.describe.configure({ mode: "serial" });

const HEIGHT = 720;

/** Is the element inside the viewport, and is the element at its centre the element itself or one of its descendants? */
async function reachable(page: Page, locator: Locator): Promise<{ inside: boolean; hit: boolean; box: unknown }> {
  await expect(locator).toBeVisible();
  return locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const inside = box.left >= 0 && box.top >= 0 && box.right <= window.innerWidth && box.bottom <= window.innerHeight && box.width > 0 && box.height > 0;
    const atCentre = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return { inside, hit: atCentre !== null && (atCentre === element || element.contains(atCentre)), box: { left: box.left, top: box.top, right: box.right, bottom: box.bottom } };
  });
}

async function expectUsable(page: Page, label: string): Promise<void> {
  await expect(page.getByTestId("min-width-notice"), `${label}: the notice is hidden at the minimum`).toBeHidden();
  for (const [name, locator] of [
    ["the activity bar's AI Chat button", page.getByTestId("activity-ai chat")],
    ["the schematic Go to component field", page.getByTestId("schematic-goto-input")],
    ["the chat prompt", page.getByTestId("prompt-input")],
  ] as const) {
    const result = await reachable(page, locator);
    expect(result, `${label}: ${name} inside the viewport and hit-testable`).toMatchObject({ inside: true, hit: true });
  }
  const widths = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  expect(widths.scrollWidth, `${label}: no sideways scroll`).toBeLessThanOrEqual(widths.innerWidth);
}

test("1. the project's viewport is Desktop Chrome's 1280 x 720", async ({ page }) => {
  expect(page.viewportSize()).toEqual({ width: 1280, height: HEIGHT });
  expect(EDITOR_MIN_WIDTH_PX).toBe(1280);
});

test("2. at the minimum width, with the left panel closed and open: no notice, the activity bar, Go to and the prompt inside the viewport and hit-testable, no sideways scroll", async ({ page }) => {
  await page.setViewportSize({ width: EDITOR_MIN_WIDTH_PX, height: HEIGHT });
  await page.goto("/");
  await expectHydrated(page);
  await page.getByTestId("activity-ai chat").click();
  await expect(page.getByTestId("prompt-input")).toBeVisible();
  await expectUsable(page, "left panel closed");
  await page.getByTestId("activity-projects").click();
  await expect(page.getByTestId("new-project")).toBeVisible();
  await expectUsable(page, "left panel open");
});

test("3. one pixel below the minimum, the notice is visible and says exactly MIN_WIDTH_NOTICE", async ({ page }) => {
  await page.setViewportSize({ width: EDITOR_MIN_WIDTH_PX - 1, height: HEIGHT });
  await page.goto("/");
  await expectHydrated(page);
  const notice = page.getByTestId("min-width-notice");
  await expect(notice).toBeVisible();
  await expect(notice).toHaveText(MIN_WIDTH_NOTICE);
});
