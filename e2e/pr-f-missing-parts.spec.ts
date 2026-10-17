/**
 * [PR-F fA] Missing parts in the ORDINARY workflow, in a FRESH browser under the fixture runtime (recorded design, scripted agent,
 * in-memory stores): the recorded blinker design is approved, a Theory primitive is placed on the sheet, Prepare PCB refuses it
 * BEFORE any server call and the refusal row is a workflow item - its checklist says identity unknown, evidence unknown, "not a
 * physical part"; Search distributors answers every admitted source's state from the fixture server (no source answered live, no
 * hit was faked, and no request left the origin); Request review opens the existing publication review handoff; the journey strip
 * says "1 missing part" and the sidebar's Missing parts line reaches the same list. Fake-backed: it proves the page's contract, not
 * a live model, live authentication, a live distributor or the catalog database.
 *
 * Run with SIRKIT_ACQUISITION_DISABLED_SOURCES=digikey,octopart in the environment (the registry ids of DigiKey and Nexar): the
 * fixture web server inherits the shell's environment, and the operator switch keeps a developer's own distributor credentials out
 * of the proof (a source then answers `operator_disabled`; without credentials it answers `credentials_missing`; either way nothing
 * is called). The Theory primitive is an INDUCTOR: the recorded design already uses R, C and D references, and the canonical
 * validation refuses a Theory display reference that a KiCad instance holds ("display reference R1 is already in use" - nothing is
 * applied), so a resistor could not be placed beside the design's R1; L is free.
 */
import { expect, test, type Request } from "@playwright/test";
import { BLINKER_ACCEPTANCE_PROMPT } from "../app/lib/fixture-runtime/blinker/catalog";
import { FIXTURE_CLOCK_DEFAULT } from "../app/lib/fixture-runtime/clock";
import { actAs, installDeterministicBrowser } from "./fixture-journey";

const FIXTURE_CLOCK = process.env.SIRKIT_FIXTURE_CLOCK?.trim() || FIXTURE_CLOCK_DEFAULT;
/** A source in one of these states was never called (external-search.ts: admission, policy or pause before any connector). */
const NO_CALL_STATES = new Set(["operator_disabled", "credentials_missing", "disabled", "blocked", "not_searchable", "paused"]);

test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);

test("approved design + a Theory inductor → Prepare PCB refuses it → checklist → Search distributors (fixture states, no live call) → Request review handoff → sidebar line", async ({ page, context, baseURL }) => {
  const origin = baseURL!;
  const originHost = new URL(origin).hostname;
  const leftOrigin: string[] = [];
  page.on("request", (request: Request) => {
    const host = new URL(request.url()).hostname;
    if (host !== originHost && host !== "localhost" && host !== "127.0.0.1") leftOrigin.push(request.url());
  });
  await page.setViewportSize({ width: 1366, height: 768 });
  await installDeterministicBrowser(page, context, "f0000001");
  await page.clock.setFixedTime(new Date(FIXTURE_CLOCK));
  await actAs(context, "editor", origin);
  await page.goto("/");
  await expect(page.getByTestId("fixture-runtime-banner")).toBeVisible();

  // 1. the recorded design: described, proposed, approved (the journey-contract spec's steps, without its detours)
  await page.getByTestId("journey-next-action").click();
  const prompt = page.getByTestId("prompt-input");
  await expect(prompt).toBeFocused();
  await prompt.fill(BLINKER_ACCEPTANCE_PROMPT);
  await expect(page.getByTestId("composer-route")).toHaveAttribute("data-route", "generate");
  await page.getByTestId("composer-submit").click();
  await expect(page.getByTestId("schematic-proposal-review")).toBeVisible({ timeout: 90_000 });
  await page.getByTestId("schematic-proposal-approve").click();
  await expect(page.getByTestId("schematic-proposal-review")).toBeHidden();
  await expect(page.getByTestId("journey-stage-schematic_applied")).toHaveAttribute("data-status", "succeeded", { timeout: 30_000 });

  // 2. a Theory primitive on the sheet: Theory mode, the Theory Library's Inductor (L1: a reference the design does not hold), one
  //    click on the canvas, back to Build mode. The sidebar's Missing parts line counts it before any PCB run (the same pure
  //    listing the run refuses at).
  await page.getByRole("button", { name: "Theory", exact: true }).click();
  await page.getByTestId("activity-theory library").click();
  await page.getByRole("button", { name: /^Inductor/ }).click();
  const canvas = page.getByTestId("schematic-canvas");
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + 120, box.y + box.height - 120);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Build", exact: true }).click();
  const sidebarLine = page.getByTestId("missing-parts-open");
  await expect(sidebarLine).toHaveAttribute("data-count", "1");
  await expect(sidebarLine).toHaveText(/Missing parts \(1\)/);

  // 3. Prepare PCB from the strip: the run refuses BEFORE any server call and the refusal lists the Theory instance; the journey
  //    says "1 missing part" and its one action is Resolve parts.
  let action = await page.getByTestId("journey-next-action").getAttribute("data-action-id");
  if (action === "open_pcb") {
    await page.getByTestId("journey-next-action").click();
    await expect(page.getByTestId("pcb-empty-state")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("journey-next-action")).toHaveAttribute("data-action-id", "prepare_pcb", { timeout: 30_000 });
    action = "prepare_pcb";
  }
  expect(action).toBe("prepare_pcb");
  await page.getByTestId("journey-next-action").click();
  const blockers = page.getByTestId("sync-blockers");
  await expect(blockers).toBeVisible({ timeout: 60_000 });
  await expect(blockers).toHaveAttribute("data-kind", "unresolved_instances");
  await expect(page.getByTestId("pcb-empty-state")).toBeVisible(); // no board was created, nothing was bound
  const row = page.locator('[data-testid^="sync-unresolved-"][data-missing="theory_symbol_only"]');
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute("data-physical", "false");
  const ref = (await row.getAttribute("data-testid"))!.replace("sync-unresolved-", "");
  await expect(page.getByTestId("journey-stage-parts_footprints")).toHaveAttribute("data-status", "blocked");
  await expect(page.getByTestId("journey-stage-parts_footprints")).toHaveAttribute("title", /1 missing part/);
  await expect(page.getByTestId("journey-next-action")).toHaveAttribute("data-action-id", "fix_blockers");
  await expect(page.getByTestId("journey-next-action")).toHaveText("Resolve parts");

  // 4. the checklist: identity unknown, evidence unknown, "not a physical part"; the draft is not available with its reason.
  await page.getByTestId(`missing-checklist-toggle-${ref}`).click();
  await expect(page.getByTestId(`missing-checklist-${ref}`)).toBeVisible();
  await expect(page.getByTestId(`missing-headline-${ref}`)).toContainText("not a physical part");
  for (const fact of ["manufacturer", "exact_mpn", "package_variant", "symbol", "footprint", "pin_to_pad_mapping"]) {
    await expect(page.getByTestId(`missing-fact-${ref}-${fact}`)).toHaveAttribute("data-state", "unknown");
  }
  await expect(page.getByTestId(`missing-fact-${ref}-stock`)).toHaveAttribute("data-state", "unknown");
  await expect(page.getByTestId(`missing-action-${ref}-create_draft`)).toHaveAttribute("data-available", "false");
  await expect(page.getByTestId(`missing-action-reason-${ref}-create_draft`)).toContainText("not a physical part");

  // 5. Search distributors: the fixture server answers every admitted source's state - none answered live, no hit was faked,
  //    and no browser request left the origin.
  const externalResponse = page.waitForResponse((response) => response.url().endsWith("/api/parts/external-search"));
  await page.getByTestId(`missing-action-${ref}-search_distributors`).click();
  const external = (await (await externalResponse).json()) as { ok: boolean; live: boolean; hits: unknown[]; sources: Array<{ sourceId: string; status: string; servedFrom: string | null; hitCount: number }> };
  expect(external.ok).toBe(true);
  expect(external.sources.length).toBeGreaterThan(0);
  for (const source of external.sources) {
    expect(NO_CALL_STATES.has(source.status), `${source.sourceId} answered ${source.status}: a vendor was called`).toBe(true);
    expect(source.servedFrom, `${source.sourceId} served ${source.servedFrom}`).toBeNull();
    expect(source.hitCount).toBe(0);
  }
  expect(external.hits).toEqual([]);
  await expect(page.getByTestId(`missing-external-${ref}`)).toBeVisible();
  for (const source of external.sources) {
    await expect(page.getByTestId(`missing-source-${ref}-${source.sourceId}`)).toHaveAttribute("data-status", source.status);
    await expect(page.getByTestId(`missing-source-${ref}-${source.sourceId}`)).toHaveAttribute("data-served-from", "none");
  }
  await expect(page.getByTestId(`missing-external-${ref}`)).toContainText("No sourcing observation: no admitted source answered.");
  await expect(page.locator('[data-testid="missing-hit"]')).toHaveCount(0);
  // stock and pricing stay unknown; identity and evidence were never touched by the search
  await expect(page.getByTestId(`missing-fact-${ref}-stock`)).toHaveAttribute("data-state", "unknown");
  await expect(page.getByTestId(`missing-fact-${ref}-exact_mpn`)).toHaveAttribute("data-state", "unknown");

  // 6. Request review: the EXISTING publication review handoff opens inline (the server decides the governance project and roles;
  //    the fixture has no governance project, so the panel says so - nothing is requested).
  await page.getByTestId(`missing-action-${ref}-request_review`).click();
  const review = page.getByTestId(`missing-review-${ref}`);
  await expect(review).toBeVisible();
  await expect(review).toHaveAttribute("data-kind", "review");
  await expect(review.getByTestId("atomic-publication-panel")).toBeVisible();
  await expect(review.getByTestId("atomic-publication-banner")).toBeVisible();
  await expect(review.getByTestId("atomic-publication-viewer")).not.toHaveText(/^Reading requests…$/, { timeout: 30_000 });
  await page.screenshot({ path: "artifacts/product-reliability-simple-ui/screenshots/after-f-missing-parts-1366x768.png" });

  // 7. the sidebar line reaches the same list: dismiss the refusal, open the schematic tab, click Missing parts (1) → the PCB tab's
  //    list is back (no run, no server call).
  await page.getByTestId("sync-blockers-dismiss").click();
  await expect(blockers).toHaveCount(0);
  await page.getByTestId("view-tab-schematic").click();
  await expect(sidebarLine).toHaveAttribute("data-count", "1");
  await sidebarLine.click();
  await expect(page.getByTestId("sync-blockers")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-testid^="sync-unresolved-"][data-missing="theory_symbol_only"]')).toHaveCount(1);
  await expect(page.getByTestId("pcb-empty-state")).toBeVisible();

  expect(leftOrigin, "no browser request left the origin").toEqual([]);
});
