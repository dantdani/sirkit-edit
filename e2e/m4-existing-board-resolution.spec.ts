/**
 * [PR-L6, 2026-10-19] Runbook M.4 / M.5 item 7 (OD-253 item 8) in a FRESH browser under the fixture runtime (the committed fixture catalog,
 * the scripted agent, in-memory stores; no database, provider, embedding or router): replacing a part on a project that already has a
 * durable, UNROUTED board.
 *
 *  1. the LED dimmer: D1 / D2 resolved through review (the dialog's PCB impact says there is no PCB yet), Prepare PCB through the
 *     binding review (the reviewer acts by switching the role cookie, without a reload: the undo history lives in the page's memory),
 *     the verified plan applied - the board carries D1 / D2 and is not behind the schematic;
 *  2. Undo of the resolution leaves D1 / D2 unresolved ON the board: the PCB tab shows the "board is behind the schematic" notice
 *     (derived from the schematic and the durable board, beside the route-stale notice), the journey's PCB applied stage is partial with
 *     Prepare PCB as the one next action, and Qualify & route is refused in the page with the drift named - nothing sent;
 *  3. the journey's Prepare PCB runs the button's preparation on the board behind the schematic and refuses D1 / D2 by name; "Find a
 *     replacement in the library" seals a batch; the review dialog shows the PCB impact rows against the durable board (D1 / D2 on it
 *     with exactly this revision: unchanged, preserved) - Approve is enabled only once the impact is assessed;
 *  4. Approve: the receipt carries the impact; the notice is gone (recomputed) and the journey is back at Qualify & route;
 *  5. Undo shows the notice again, Redo clears it, Undo shows it, and a reload recomputes it from the saved schematic and the durable
 *     board (nothing was remembered).
 *
 * Fixture boundary: the fixture clock is frozen, so a batch re-sealed on the very same head (the head a reload re-derives from the same
 * genesis) is byte-identical to the one applied before it, and the journal refuses it as that earlier, undone commit ("The journal
 * records a commit the canonical history does not contain", measured); the re-resolution therefore happens before the reload, on the
 * head the Undo produced (a real clock gives every sealed batch its own identity).
 *
 * Scope boundary (recorded open): a replacement by ANOTHER revision of a part already bound on the board cannot be carried to the board
 * from the page today - a reviewer's bind of the new revision is refused while the earlier binding is in effect
 * (PB_ACTIVE_SELECTION_CONFLICT, the B19-E rule); the durable suites prove that path at the API level (supersede, then bind:
 * m4-board-impact-agrees-with-preflight). Fake-backed: it proves the page's contract, not a live model, catalog, router or datasheet.
 */
import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import type { SchematicState } from "../lib/schematic-types";
import { canonicalJson } from "../app/lib/pcb/revision";
import { FIXTURE_ELIGIBLE_DIODE_MPN } from "../app/lib/fixture-runtime/blinker/catalog";
import { DIMMER_INSTANCE_IDS, fixtureDimmerSheet } from "../app/lib/fixture-runtime/__tests__/_resolution-sheet";
import { actAs, installDeterministicBrowser, reloadAs } from "./fixture-journey";

test.describe.configure({ mode: "serial" });
test.setTimeout(420_000);

const NOW = Date.parse("2026-10-19T00:00:00.000Z");
const SCREENSHOTS = "artifacts/product-reliability-simple-ui/screenshots";

function dimmerProjectFile(projectId: string, name: string): { name: string; mimeType: string; buffer: Buffer } {
  const payload = { project: { id: projectId, name, state: fixtureDimmerSheet(), createdAt: NOW, updatedAt: NOW, schemaVersion: 2 }, checkpoints: [] };
  const canonical = canonicalJson(payload);
  const envelope = { format: "sirkit-project", formatVersion: 1, exportedAt: new Date(NOW).toISOString(), integrity: `sha256:${createHash("sha256").update(canonical).digest("hex")}`, payload: JSON.parse(canonical) as unknown };
  return { name: `${name}.sirkit.json`, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(envelope)) };
}

async function savedState(page: Page, projectId: string): Promise<SchematicState> {
  return page.evaluate((key) => (JSON.parse(window.localStorage.getItem(key) ?? "null") as { state: SchematicState }).state, `sirkit:project:${projectId}`);
}

const unresolvedRefs = async (page: Page, projectId: string): Promise<string[]> => ((await savedState(page, projectId)).kicadComponents ?? []).filter((instance) => instance.atomicPartRevisionId === undefined).map((instance) => instance.refDes);

/** The journey's one next action toward Prepare PCB (Open PCB first when the editor is not mounted yet), as the M1 proof drives it. */
async function preparePcb(page: Page): Promise<void> {
  let action = await page.getByTestId("journey-next-action").getAttribute("data-action-id");
  if (action === "open_pcb") {
    await page.getByTestId("journey-next-action").click();
    await expect(page.getByTestId("journey-next-action")).toHaveAttribute("data-action-id", "prepare_pcb", { timeout: 30_000 });
    action = "prepare_pcb";
  }
  expect(action).toBe("prepare_pcb");
  await page.getByTestId("journey-next-action").click();
  await expect(page.getByTestId("sync-blockers")).toHaveAttribute("data-kind", "unresolved_instances", { timeout: 60_000 });
}

/** "Find a replacement in the library" from the Missing parts list: the review dialog opens with the sealed batch. */
async function findReplacement(page: Page): Promise<void> {
  const find = page.getByTestId("missing-parts-find-replacement");
  await expect(find).toBeEnabled({ timeout: 30_000 });
  await find.click();
  await expect(page.getByTestId("component-resolution-review")).toBeVisible({ timeout: 60_000 });
}

test("an existing unrouted board: resolve and sync D1 / D2 -> Undo leaves them unresolved ON the board (notice, journey, qualify refused) -> the journey's Prepare PCB names them -> Find a replacement shows the PCB impact -> Approve -> receipt with the impact -> notice gone -> Undo / Redo / reload recompute it", async ({ page, context, baseURL }) => {
  const origin = baseURL!;
  const projectId = "m4-existing-board-0001";
  await page.setViewportSize({ width: 1366, height: 768 });
  await installDeterministicBrowser(page, context, "m4000001");
  await actAs(context, "editor", origin);
  await page.goto("/");
  await expect(page.getByTestId("fixture-runtime-banner")).toBeVisible();
  await expect(page.getByRole("button", { name: /Untitled project/ })).toBeVisible({ timeout: 120_000 });
  await page.locator('input[type="file"][accept*=".sirkit.json"]').setInputFiles(dimmerProjectFile(projectId, "LED dimmer M4"));
  await expect(page.getByRole("button", { name: /LED dimmer M4/ })).toBeVisible({ timeout: 30_000 });
  if (!(await page.getByTestId("missing-parts-open").isVisible())) await page.getByTestId("activity-build library").click();
  await expect(page.getByTestId("missing-parts-open")).toHaveAttribute("data-count", "2", { timeout: 30_000 });

  // ── 1. resolve D1 / D2 (no PCB yet: the impact says so, Approve is enabled once it is assessed), then Prepare PCB through the review ──
  await preparePcb(page);
  await findReplacement(page);
  const impact = page.getByTestId("component-resolution-board-impact");
  await expect(impact).toHaveAttribute("data-state", "assessed", { timeout: 30_000 });
  await expect(impact).toContainText("this project has no PCB yet");
  await expect(page.getByTestId("component-resolution-approve")).toBeEnabled();
  await page.getByTestId("component-resolution-approve").click();
  await expect(page.getByTestId("component-resolution-receipt")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("component-resolution-receipt-board-impact")).toContainText("no PCB exists for this project yet");
  await expect.poll(() => unresolvedRefs(page, projectId), { timeout: 30_000 }).toEqual([]);
  await page.getByTestId("view-tab-pcb").click();
  await expect(page.getByTestId("component-review-panel")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("review-request-all").click();
  await expect(page.getByTestId("component-review-pending")).toHaveText("5 pending", { timeout: 30_000 });
  // the reviewer's decisions WITHOUT a reload: the schematic's undo history lives in this page's memory (a reload drops it, and this
  // proof undoes the resolution below), so the role cookie changes and the panel re-reads the requests as the reviewer
  await actAs(context, "reviewer", origin);
  await page.getByTestId("component-review-refresh").click();
  for (const ref of ["U1", "R1", "C1", "D1", "D2"]) {
    await page.getByTestId(`review-approve-${ref}`).click();
    await expect(page.getByTestId(`review-state-${ref}`)).toHaveAttribute("data-state", "approved", { timeout: 30_000 });
  }
  await actAs(context, "editor", origin);
  await page.getByTestId("component-review-refresh").click();
  await page.getByTestId("sync-schematic-to-pcb").click();
  const apply = page.locator('[data-testid^="apply-sync-plan"]').first();
  await expect(apply).toBeVisible({ timeout: 90_000 });
  await apply.click();
  await expect(page.getByTestId("p2g-workflow-state")).toHaveAttribute("data-state", "awaiting_qualification", { timeout: 90_000 });
  await expect(page.getByTestId("board-behind-schematic-banner")).toHaveCount(0); // a freshly synchronized board is not behind (the domain guard)
  await expect(page.getByTestId("journey-next-action")).toHaveAttribute("data-action-id", "qualify_route", { timeout: 30_000 });

  // ── 2. Undo of the resolution: D1 / D2 lose their exact part while their footprints stay on the board ──
  await page.getByTestId("view-tab-schematic").click();
  await page.getByRole("button", { name: "Undo schematic action" }).click();
  await expect.poll(() => unresolvedRefs(page, projectId), { timeout: 30_000 }).toEqual(["D1", "D2"]);
  await page.getByTestId("view-tab-pcb").click();
  const banner = page.getByTestId("board-behind-schematic-banner");
  await expect(banner).toBeVisible({ timeout: 30_000 });
  await expect(banner).toHaveAttribute("data-count", "2");
  await expect(banner).toContainText("The board is behind the schematic: 2 part(s) differ - D1 (without an exact part in the schematic), D2 (without an exact part in the schematic).");
  await expect(page.getByTestId("journey-stage-pcb_applied")).toHaveAttribute("data-status", "partial");
  await expect(page.getByTestId("journey-next-action")).toHaveAttribute("data-action-id", "prepare_pcb");
  for (const id of ["placement", "routing", "validation", "export"]) await expect(page.getByTestId(`journey-stage-${id}`)).not.toHaveAttribute("data-status", "succeeded");
  // Qualify & route is refused IN THE PAGE: the qualification endpoint is never asked
  let qualifyCalls = 0;
  page.on("request", (request) => { if (request.url().endsWith("/api/pcb/qualify")) qualifyCalls += 1; });
  await page.getByTestId("p2g-qualify").click();
  await expect(page.getByText(/^Qualification refused: the board is behind the schematic \(D1 \(without an exact part in the schematic\), D2/).first()).toBeVisible({ timeout: 30_000 });
  expect(qualifyCalls).toBe(0);
  await page.screenshot({ path: `${SCREENSHOTS}/m4-board-behind-schematic-1366x768.png` });

  // ── 3. the journey's Prepare PCB (a board behind the schematic runs the button's preparation) refuses D1 / D2 by name; Find a
  //       replacement; the dialog shows the PCB impact against the durable board ──
  await preparePcb(page);
  await findReplacement(page);
  await expect(impact).toHaveAttribute("data-state", "assessed", { timeout: 30_000 });
  await expect(impact).toContainText(`PCB impact on the durable board board:${projectId} (revision`);
  await expect(impact).toContainText("unsaved PCB edits are not part of it");
  for (const ref of ["D1", "D2"]) {
    const row = page.getByTestId(`component-resolution-board-impact-row-${ref}`);
    await expect(row).toHaveAttribute("data-outcome", "unchanged");
    await expect(row).toHaveAttribute("data-operation", "preserve_component_instance");
    await expect(row).toContainText(`${ref} (board ${ref}): on the board with this exact identity (unchanged)`);
    await expect(row).toContainText("Prepare PCB: preserve component instance");
  }
  await expect(page.getByTestId("component-resolution-approve-reason")).toHaveCount(0);
  await expect(page.getByTestId("component-resolution-approve")).toBeEnabled();
  await impact.scrollIntoViewIfNeeded(); // the evidence shows the PCB impact section and the enabled Approve
  await page.screenshot({ path: `${SCREENSHOTS}/m4-board-impact-review-1366x768.png` });

  // ── 4. Approve: the receipt carries the impact; the notice is gone (recomputed); the journey is back at Qualify & route ──
  await page.getByTestId("component-resolution-approve").click();
  const receipt = page.getByTestId("component-resolution-receipt");
  await expect(receipt).toBeVisible({ timeout: 30_000 });
  await expect(receipt).toContainText(`D1, D2 → ${FIXTURE_ELIGIBLE_DIODE_MPN}`);
  await expect(page.getByTestId("component-resolution-receipt-board-impact")).toHaveAttribute("data-state", "assessed");
  await expect(page.getByTestId("component-resolution-receipt-board-impact")).toContainText(`PCB impact: board board:${projectId} (revision`);
  await expect(page.getByTestId("component-resolution-receipt-board-impact")).toContainText("already carries these exact parts; nothing on it goes stale");
  await expect.poll(() => unresolvedRefs(page, projectId), { timeout: 30_000 }).toEqual([]);
  await expect(page.getByTestId("board-behind-schematic-banner")).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByTestId("journey-stage-pcb_applied")).toHaveAttribute("data-status", "succeeded");
  await expect(page.getByTestId("journey-next-action")).toHaveAttribute("data-action-id", "qualify_route", { timeout: 30_000 });
  expect((await savedState(page, projectId)).kicadComponents!.find((instance) => instance.id === DIMMER_INSTANCE_IDS.D1)!.atomicPartRevisionId).toBeTruthy();

  // ── 5. Undo / Redo / reload recompute the notice from the facts (nothing is remembered) ──
  await page.getByTestId("view-tab-schematic").click();
  await page.getByRole("button", { name: "Undo schematic action" }).click();
  await expect.poll(() => unresolvedRefs(page, projectId), { timeout: 30_000 }).toEqual(["D1", "D2"]);
  await page.getByTestId("view-tab-pcb").click();
  await expect(page.getByTestId("board-behind-schematic-banner")).toHaveAttribute("data-count", "2", { timeout: 30_000 });
  await page.getByTestId("view-tab-schematic").click(); // the header's Undo / Redo act on the schematic view
  await page.getByRole("button", { name: "Redo schematic action" }).click();
  await expect.poll(() => unresolvedRefs(page, projectId), { timeout: 30_000 }).toEqual([]);
  await page.getByTestId("view-tab-pcb").click();
  await expect(page.getByTestId("pcb-editor")).toBeVisible();
  await expect(page.getByTestId("board-behind-schematic-banner")).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByTestId("journey-next-action")).toHaveAttribute("data-action-id", "qualify_route", { timeout: 30_000 });
  await page.getByTestId("view-tab-schematic").click();
  await page.getByRole("button", { name: "Undo schematic action" }).click();
  await expect.poll(() => unresolvedRefs(page, projectId), { timeout: 30_000 }).toEqual(["D1", "D2"]);
  await page.getByTestId("view-tab-pcb").click();
  await expect(page.getByTestId("board-behind-schematic-banner")).toHaveAttribute("data-count", "2", { timeout: 30_000 });
  // a reload: the notice is derived again from the saved schematic and the durable board
  await reloadAs(page, context, "editor", origin, true);
  await expect(page.getByTestId("board-behind-schematic-banner")).toHaveAttribute("data-count", "2", { timeout: 60_000 });
  await expect(page.getByTestId("board-behind-schematic-banner")).toContainText("D1 (without an exact part in the schematic), D2 (without an exact part in the schematic)");
  await expect(page.getByTestId("journey-stage-pcb_applied")).toHaveAttribute("data-status", "partial");
  await expect(page.getByTestId("journey-next-action")).toHaveAttribute("data-action-id", "prepare_pcb", { timeout: 30_000 });
});
