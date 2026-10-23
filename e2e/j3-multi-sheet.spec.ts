/**
 * [PR-J3, 2026-10-22] Runbook section J increment 3, J.9's fresh-browser proof under the FIXTURE runtime (OD-257 item 9: fixture proof,
 * no router recording, no live model, US$0): a fresh browser opens the committed multi-sheet project file (the fixture four-motor drone
 * organised into Power / Motor drivers / IMU, app/lib/schematic/__tests__/fixtures/j3-drone-sheets-project.sirkit.json), navigates and
 * edits real subsystem sheets, organises a fourth sheet with the previewed move, follows a cross-sheet signal, reloads, reviews and
 * applies the COMPLETE PCB sync with a child sheet active, undoes and redoes the move, and is refused a flat AI result.
 *
 * Case by case (each starts from a fresh browser and the import, so a failing step names its own increment):
 *  1. import -> the Sheets chip, the tree (Overview + 3), open IMU (only its items), one edit on the active sheet (a placed +3V3 port
 *     carries the sheet), Undo; re-export is formatVersion 2 with the same state;
 *  2. New sheet "MCU" -> Go to U2 -> Move to sheet -> the preview lists the crossings -> Apply -> the overview block -> open MCU ->
 *     Follow I2C_SCL to IMU (highlight) -> Undo / Redo -> reload keeps 5 sheets and 41 instances;
 *  3. with IMU active: Prepare PCB through the binding review -> sync -> apply -> awaiting qualification with 41 footprints; the design
 *     checks list Sheet connections; [PR-J3 integration, 2026-10-23] J3-PAGE-1: the project file exported AFTER the sync carries the
 *     board checkpoint WITH its sheet tree and re-imports (as a copy) with every checkpoint;
 *  4. the AI refusal: the Build sentence on the multi-sheet project is refused with the guard's message; no generation task, no
 *     provider-bound request;
 *  5. at 1280 x 720 the chip overlaps neither Go to, the status bar nor the workspace tabs.
 * Fake-backed: the fixture runtime's committed catalog and scripted provider; nothing leaves the origin.
 *
 * Control ids: the agreed J3-B ids (j3-plan.md section 2). The ones marked PROPOSED are this spec's additions for builder B.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Locator, type Page, type Request } from "@playwright/test";
import { flatReplacementRefusal } from "../app/lib/project/sheet-replace-guard";
import { J3_FIXTURE_PROJECT_ID, J3_FIXTURE_PROJECT_NAME, J3_SHEETS } from "../app/lib/schematic/__tests__/_j3-fixtures";
import type { SchematicState } from "../lib/schematic-types";
import { actAs, expectHydrated, installDeterministicBrowser, reloadAs } from "./fixture-journey";

test.describe.configure({ mode: "serial" });
test.setTimeout(600_000);

const FIXTURE_FILE = join(process.cwd(), "app", "lib", "schematic", "__tests__", "fixtures", "j3-drone-sheets-project.sirkit.json");
const SCREENSHOTS = "artifacts/product-reliability-simple-ui/multi-sheet/screenshots";
/** A hex uuid namespace (the deterministic browser's ids must stay well-formed UUIDs; the plan's "j3000000" is not hex). */
const UUID_NAMESPACE = "33aa0003";
const OWNER_FOUR_MOTOR_SENTENCE = "build me a simple drone controlling circuitly with 4 motors just a simple one";

const T = {
  chip: "sheets-chip", breadcrumb: "sheets-breadcrumb", back: "sheets-back", tree: "sheets-tree", item: (id: string) => `sheets-tree-item-${id}`,
  newSheet: "sheets-new", newName: "sheets-new-name" /* PROPOSED: the New sheet name input; Enter confirms */,
  block: (id: string) => `sheet-block-${id}`,
  move: "sheets-move", moveTarget: "sheets-move-target" /* PROPOSED: a select of the child sheets (value = sheet id) */, movePreview: "sheets-move-preview", moveApply: "sheets-move-apply",
  follow: "sheets-follow", destination: (n: number) => `sheets-follow-destination-${n}`, notice: "sheets-notice",
} as const;

interface Traffic { generationStarts: number; edits: number; tidies: number; buildMulti: number; leftOrigin: string[] }
function watch(page: Page, origin: string): Traffic {
  const traffic: Traffic = { generationStarts: 0, edits: 0, tidies: 0, buildMulti: 0, leftOrigin: [] };
  const host = new URL(origin).hostname;
  page.on("request", (request: Request) => {
    const url = new URL(request.url());
    if (url.hostname !== host && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") traffic.leftOrigin.push(request.url());
    if (request.method() !== "POST") return;
    if (url.pathname === "/api/generation-tasks") traffic.generationStarts += 1;
    if (url.pathname === "/api/schematic/edit" || url.pathname === "/api/schematic/edit-build") traffic.edits += 1;
    if (url.pathname === "/api/schematic/layout-critic") traffic.tidies += 1;
    if (url.pathname === "/api/schematic/build-multi") traffic.buildMulti += 1;
  });
  return traffic;
}

/** The editor's state as the page persisted it (the autosaved project record). */
async function savedState(page: Page, projectId = J3_FIXTURE_PROJECT_ID): Promise<SchematicState> {
  return page.evaluate((key) => (JSON.parse(window.localStorage.getItem(key) ?? "null") as { state: SchematicState }).state, `sirkit:project:${projectId}`);
}
async function savedRecord(page: Page, projectId = J3_FIXTURE_PROJECT_ID): Promise<Record<string, unknown>> {
  return page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? "null") as Record<string, unknown>, `sirkit:project:${projectId}`);
}
const refs = (state: SchematicState): string[] => (state.kicadComponents ?? []).map((item) => item.refDes).sort();
const fixtureState = (): SchematicState => (JSON.parse(readFileSync(FIXTURE_FILE, "utf8")) as { payload: { project: { state: SchematicState } } }).payload.project.state;

/** A fresh editor opens the committed multi-sheet project file through the page's hidden file input (page.tsx importInputRef). */
async function openFixture(page: Page, context: Parameters<typeof actAs>[0], origin: string, viewport = { width: 1366, height: 768 }): Promise<void> {
  await page.setViewportSize(viewport);
  await installDeterministicBrowser(page, context, UUID_NAMESPACE);
  await actAs(context, "editor", origin);
  await page.goto("/");
  await expect(page.getByTestId("fixture-runtime-banner")).toBeVisible();
  await expectHydrated(page);
  await page.locator('input[type="file"]').setInputFiles(FIXTURE_FILE);
  // [awaits J3-A] until MULTI_SHEET_EDITOR_AVAILABLE flips, the import is refused (SHEETS_EDITOR_PENDING) and this header never appears
  await expect(page.getByRole("button", { name: new RegExp(J3_FIXTURE_PROJECT_NAME.replace(/[()]/g, "\\$&")) })).toBeVisible({ timeout: 60_000 });
  await expect.poll(async () => (await savedState(page))?.sheets?.sheets.length ?? 0, { timeout: 30_000 }).toBe(4);
}

async function openTree(page: Page): Promise<Locator> {
  const tree = page.getByTestId(T.tree);
  if (!(await tree.isVisible())) await page.getByTestId(T.chip).click();
  await expect(tree).toBeVisible();
  return tree;
}
async function openSheet(page: Page, sheetId: string, name: string): Promise<void> {
  await openTree(page);
  await page.getByTestId(T.item(sheetId)).click();
  await expect(page.getByTestId(T.breadcrumb)).toContainText(name);
}
/** The fixture's reference designators drawn on the canvas (KicadInstanceView draws each as a <text>; label names never collide with them). */
async function drawnRefs(page: Page): Promise<string[]> {
  const known = new Set(refs(fixtureState()));
  const texts = await page.getByTestId("schematic-canvas").locator("text").allTextContents();
  return [...new Set(texts.map((text) => text.trim()).filter((text) => known.has(text)))].sort();
}
const disjoint = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): boolean =>
  a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;

test("1. a fresh browser opens the multi-sheet project: the Sheets chip and tree (Overview + Power, Motor drivers, IMU); IMU shows only its items; an edit on the active sheet carries the sheet and undoes; re-export is formatVersion 2 with the same state", async ({ page, context, baseURL }) => {
  const origin = baseURL!;
  const traffic = watch(page, origin);
  await openFixture(page, context, origin);
  const fixture = fixtureState();
  const opened = await savedState(page);
  expect(opened.sheets).toEqual(fixture.sheets);
  expect(refs(opened)).toEqual(refs(fixture));
  expect(opened.kicadComponents).toHaveLength(41);

  // the chip and the tree: the overview and the three subsystem sheets, in document order
  const chip = page.getByTestId(T.chip);
  await expect(chip).toBeVisible();
  const tree = await openTree(page);
  const items = tree.locator('[data-testid^="sheets-tree-item-"]');
  await expect(items).toHaveCount(4);
  expect(await items.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-testid")))).toEqual(["root", ...J3_SHEETS.map((sheet) => sheet.id)].map((id) => T.item(id)));
  for (const sheet of J3_SHEETS) await expect(page.getByTestId(T.item(sheet.id))).toContainText(sheet.name);
  await expect(page.getByTestId(T.item("root"))).toContainText("Overview");
  // the overview draws the three blocks
  for (const sheet of J3_SHEETS) await expect(page.getByTestId(T.block(sheet.id))).toBeVisible();
  await page.keyboard.press("Escape");
  await page.screenshot({ path: `${SCREENSHOTS}/j3-overview-1366x768.png` });

  // open IMU: only its five parts are drawn; the project keeps all 41
  await openSheet(page, "sheet-imu", "IMU");
  expect(await drawnRefs(page)).toEqual(["C10", "C9", "R11", "R12", "U3"]);
  expect((await savedState(page)).kicadComponents).toHaveLength(41);
  await page.screenshot({ path: `${SCREENSHOTS}/j3-imu-sheet-1366x768.png` });

  // one edit on the active sheet: a placed +3V3 power port is a NEW label carrying the IMU sheet (the lens stamps it; nothing else moves)
  const labelsBefore = (await savedState(page)).netLabels!.length;
  await page.getByTitle("Place a +3V3 power port").click();
  const canvas = await page.getByTestId("schematic-canvas").boundingBox();
  await page.mouse.click(canvas!.x + canvas!.width * 0.62, canvas!.y + canvas!.height * 0.88);
  await expect.poll(async () => (await savedState(page)).netLabels!.length, { timeout: 30_000 }).toBe(labelsBefore + 1);
  const edited = await savedState(page);
  const added = edited.netLabels!.find((label) => !fixture.netLabels!.some((item) => item.id === label.id))!;
  expect(added).toMatchObject({ name: "+3V3", kind: "power", sheetId: "sheet-imu" });
  expect(edited.netLabels!.filter((label) => label.id !== added.id)).toEqual(fixture.netLabels);
  expect(edited.kicadComponents).toEqual(fixture.kicadComponents);
  expect(edited.sheets).toEqual(fixture.sheets);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Undo schematic action" }).click();
  await expect.poll(async () => (await savedState(page)).netLabels!.length, { timeout: 30_000 }).toBe(labelsBefore);
  expect(await savedState(page)).toEqual(opened);
  await expect(page.getByTestId(T.breadcrumb)).toContainText("IMU"); // undo never switches the sheet

  // Back / Overview
  await page.getByTestId(T.back).click();
  await expect(page.getByTestId(T.breadcrumb)).toContainText("Overview");
  expect(await drawnRefs(page)).toEqual(["C4", "C5", "C6", "C7", "C8", "D5", "J6", "J7", "R10", "R9", "U2"]);

  // re-export: formatVersion 2, the same state, the same tree (J.8.2)
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project file" }).click();
  const download = await downloadPromise;
  const exported = JSON.parse(readFileSync((await download.path())!, "utf8")) as { formatVersion: number; payload: { project: { id: string; state: SchematicState } } };
  expect(exported.formatVersion).toBe(2);
  expect(exported.payload.project.id).toBe(J3_FIXTURE_PROJECT_ID);
  expect(exported.payload.project.state).toEqual(fixture);
  expect(traffic.leftOrigin).toEqual([]);
  expect([traffic.generationStarts, traffic.edits, traffic.tidies, traffic.buildMulti]).toEqual([0, 0, 0, 0]);
});

test("2. organise further: New sheet MCU, Go to U2, Move to sheet with the previewed crossings, Apply; the overview block; Follow I2C_SCL into IMU with the highlight; Undo / Redo; reload keeps 5 sheets and 41 instances", async ({ page, context, baseURL }) => {
  const origin = baseURL!;
  await openFixture(page, context, origin);
  const fixture = fixtureState();

  // New sheet (a sheet-structure transaction; the id comes from randomGenerationUuid, never crypto.randomUUID)
  await openTree(page);
  await page.getByTestId(T.newSheet).click();
  const nameInput = page.getByTestId(T.newName);
  if (await nameInput.count()) { await nameInput.fill("MCU"); await nameInput.press("Enter"); }
  await expect.poll(async () => (await savedState(page)).sheets!.sheets.length, { timeout: 30_000 }).toBe(5);
  const created = (await savedState(page)).sheets!.sheets[4]!;
  if (created.name !== "MCU") throw new Error(`[awaits J3-B] the New sheet action named the sheet "${created.name}"; the spec expects a name input (${T.newName}) or the name MCU`);
  expect(created.parentId).toBe("root");
  expect(created.id).not.toMatch(/^33aa0003-e2e0-4000-8000-/); // not a crypto.randomUUID draw (the fixture browser numbers those)
  await expect(page.getByTestId(T.item(created.id))).toContainText("MCU");
  await page.keyboard.press("Escape");

  // select U2 (Go to), then Move to sheet -> the preview lists every crossing as a port
  await page.getByTestId("schematic-goto-input").fill("U2");
  await page.getByTestId("schematic-goto").click();
  await expect(page.getByTestId("schematic-notice")).toHaveCount(0);
  await page.getByTestId(T.move).click();
  const target = page.getByTestId(T.moveTarget);
  if (await target.count()) await target.selectOption(created.id);
  const preview = page.getByTestId(T.movePreview);
  await expect(preview).toBeVisible();
  for (const net of ["PWM1", "PWM2", "PWM3", "PWM4", "I2C_SDA", "I2C_SCL", "IMU_INT1", "RESET"]) await expect(preview).toContainText(net);
  await page.screenshot({ path: `${SCREENSHOTS}/j3-move-preview-1366x768.png` });
  await page.getByTestId(T.moveApply).click();
  await expect(preview).toBeHidden();
  await expect.poll(async () => (await savedState(page)).kicadComponents!.find((item) => item.refDes === "U2")?.sheetId ?? null, { timeout: 30_000 }).toBe(created.id);
  const moved = await savedState(page);
  expect(moved.kicadComponents).toHaveLength(41);
  expect(refs(moved)).toEqual(refs(fixture));
  const mcuPorts = moved.sheets!.sheets.find((sheet) => sheet.id === created.id)!.ports!.map((port) => port.name);
  for (const net of ["PWM1", "PWM2", "PWM3", "PWM4", "I2C_SDA", "I2C_SCL", "IMU_INT1", "RESET"]) expect(mcuPorts).toContain(net);
  // identities: every instance keeps its id, reference, value and authority
  const identity = (state: SchematicState) => state.kicadComponents!.map(({ sheetId: _sheet, x: _x, y: _y, ...rest }) => { void _sheet; void _x; void _y; return rest; }).sort((a, b) => a.refDes.localeCompare(b.refDes));
  expect(identity(moved)).toEqual(identity(fixture));
  // the overview shows the fourth block with its sheet pins; the MCU sheet shows U2
  await expect(page.getByTestId(T.block(created.id))).toBeVisible();
  await page.screenshot({ path: `${SCREENSHOTS}/j3-overview-four-blocks-1366x768.png` });
  await openSheet(page, created.id, "MCU");
  expect(await drawnRefs(page)).toContain("U2");
  expect(await drawnRefs(page)).not.toContain("U3");

  // Follow the I2C_SCL signal from the MCU sheet into IMU: the destination opens IMU with the highlight on the net
  // [PR-J3-A, 2026-10-22] the signal's own glyph on this sheet is the hierarchical label the move created (data-scope="hierarchical"); the
  // moved local label of the same name sits under it, so a click on the first <text> was intercepted by the glyph above it
  await page.getByTestId("schematic-canvas").locator('[data-testid^="scoped-label-"][data-scope="hierarchical"]', { hasText: /^I2C_SCL$/ }).first().click();
  await page.getByTestId(T.follow).click();
  const destinations = page.locator('[data-testid^="sheets-follow-destination-"]');
  await expect(destinations.first()).toBeVisible();
  const imuDestination = destinations.filter({ hasText: /IMU/ }).first();
  await expect(imuDestination).toBeVisible();
  await imuDestination.click();
  await expect(page.getByTestId(T.breadcrumb)).toContainText("IMU");
  await expect(page.getByTestId("schematic-highlight")).toHaveAttribute("data-net", "I2C_SCL");
  await page.screenshot({ path: `${SCREENSHOTS}/j3-follow-signal-imu-1366x768.png` });

  // Undo the move (one transaction): U2 is back on the overview and the MCU sheet is empty but present; Redo moves it again
  await page.getByRole("button", { name: "Undo schematic action" }).click();
  await expect.poll(async () => (await savedState(page)).kicadComponents!.find((item) => item.refDes === "U2")?.sheetId ?? null, { timeout: 30_000 }).toBeNull();
  const undone = await savedState(page);
  expect(undone.sheets!.sheets).toHaveLength(5);
  expect(undone.sheets!.sheets.find((sheet) => sheet.id === created.id)!.ports).toBeUndefined();
  expect(undone.netLabels).toEqual(fixture.netLabels);
  expect(undone.kicadComponents).toEqual(fixture.kicadComponents);
  await page.getByRole("button", { name: "Redo schematic action" }).click();
  await expect.poll(async () => (await savedState(page)).kicadComponents!.find((item) => item.refDes === "U2")?.sheetId ?? null, { timeout: 30_000 }).toBe(created.id);
  expect(await savedState(page)).toEqual(moved);

  // reload: the same sheets, the same 41 instances, the same references
  await page.reload();
  await expect(page.getByTestId("fixture-runtime-banner")).toBeVisible();
  await expect(page.getByRole("button", { name: /Drone \(sheets\)/ })).toBeVisible({ timeout: 120_000 });
  const restored = await savedState(page);
  expect(restored.sheets!.sheets.map((sheet) => sheet.name)).toEqual(["Overview", "Power", "Motor drivers", "IMU", "MCU"]);
  expect(restored.kicadComponents).toHaveLength(41);
  expect(refs(restored)).toEqual(refs(fixture));
  expect(restored).toEqual(moved);
  await openTree(page);
  await expect(page.locator('[data-testid^="sheets-tree-item-"]')).toHaveCount(5);
});

test("3. with the IMU sheet active: Prepare PCB through the binding review, the complete sync and the applied plan reach awaiting qualification with all 41 footprints; the design checks list Sheet connections", async ({ page, context, baseURL }) => {
  const origin = baseURL!;
  await openFixture(page, context, origin);
  // the design checks of a document with sheets add Sheet connections (the design-checks panel lives beside the schematic)
  if (!(await page.getByTestId("design-checks").isVisible())) await page.getByTestId("activity-build library").click();
  await expect(page.getByTestId("design-checks")).toContainText("Sheet connections");
  await expect(page.getByTestId("missing-parts-open")).toHaveAttribute("data-count", "0", { timeout: 30_000 });
  await openSheet(page, "sheet-imu", "IMU");

  // Prepare PCB: the binding review (editor requests all, a reviewer approves every reference), the sync, the plan applied
  await page.getByTestId("view-tab-pcb").click();
  await expect(page.getByTestId("pcb-empty-state")).toBeVisible();
  await expect(page.getByTestId("component-review-panel")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("review-request-all").click();
  await expect(page.getByTestId("component-review-pending")).toHaveText("41 pending", { timeout: 60_000 });
  await reloadAs(page, context, "reviewer", origin, false);
  await expect(page.getByTestId("component-review-pending")).toHaveText("41 pending", { timeout: 60_000 });
  const reviewed = await page.locator('[data-testid^="review-approve-"]').evaluateAll((nodes) => nodes.map((node) => (node.getAttribute("data-testid") ?? "").slice("review-approve-".length)));
  expect(reviewed.sort()).toEqual(refs(fixtureState()));
  for (const ref of reviewed) {
    await page.getByTestId(`review-approve-${ref}`).click();
    await expect(page.getByTestId(`review-state-${ref}`)).toHaveAttribute("data-state", "approved", { timeout: 30_000 });
  }
  await expect(page.getByTestId("component-review-pending")).toHaveText("0 pending");
  await reloadAs(page, context, "editor", origin, false);
  await page.getByTestId("sync-schematic-to-pcb").click();
  const apply = page.locator('[data-testid^="apply-sync-plan"]').first();
  await expect(apply).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId("sync-blockers")).toHaveCount(0);
  await apply.click();
  await expect(page.getByTestId("p2g-workflow-state")).toHaveAttribute("data-state", "awaiting_qualification", { timeout: 120_000 });
  await expect(page.getByTestId("p2g-request-release")).toBeDisabled();
  // the board carries every physical part of every sheet: 41 footprints, one per instance
  const record = await savedRecord(page);
  const board = ((record["pcbWorking"] as { board?: { footprints?: unknown[] } } | undefined)?.board ?? (record["pcb"] as { footprints?: unknown[] } | undefined)) as { footprints?: unknown[] } | undefined;
  expect(board?.footprints ?? []).toHaveLength(41);
  await page.screenshot({ path: `${SCREENSHOTS}/j3-pcb-awaiting-qualification-1366x768.png` });
  // the active sheet survived the reloads and the sync never narrowed to it
  // [PR-J3-A, 2026-10-22] a DOM click: at 1366 x 768 the PCB tab's component review panel (41 rows) extends over the workspace tabs and
  // intercepts a pointer click on them (a pre-existing PCB-tab layout, not J3; reported to the lead); the tab switch is what is under test
  await page.getByTestId("view-tab-schematic").dispatchEvent("click");
  await expect(page.getByTestId(T.breadcrumb)).toContainText("IMU");

  // [PR-J3 integration, 2026-10-23] review J3-PAGE-1: the board checkpoint the sync wrote (PcbEditor boardCheckpoint) carries the sheet
  // tree, so the project file exported AFTER the sync (case 1 exported before any checkpoint existed) re-imports with its checkpoints
  // instead of being refused as "A checkpoint's schematic in the file is invalid"
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project file" }).click();
  const downloadPath = (await (await downloadPromise).path())!;
  const exported = JSON.parse(readFileSync(downloadPath, "utf8")) as { formatVersion: number; payload: { checkpoints: Array<{ label: string; schematic: SchematicState }> } };
  expect(exported.formatVersion).toBe(2);
  expect(exported.payload.checkpoints.length).toBeGreaterThanOrEqual(1);
  expect(exported.payload.checkpoints.some((checkpoint) => /Synchronized PCB/.test(checkpoint.label))).toBe(true);
  for (const checkpoint of exported.payload.checkpoints) {
    expect(checkpoint.schematic.sheets, checkpoint.label).toEqual(fixtureState().sheets);
    expect(checkpoint.schematic.kicadComponents, checkpoint.label).toHaveLength(41);
  }
  await page.locator('input[type="file"][accept*=".sirkit.json"]').setInputFiles({ name: "drone-sheets-after-sync.sirkit.json", mimeType: "application/json", buffer: readFileSync(downloadPath) });
  await expect(page.getByRole("button", { name: /Drone \(sheets\) \(imported copy\)/ })).toBeVisible({ timeout: 60_000 });
  const copyId = await page.evaluate(() => Object.keys(window.localStorage).filter((key) => key.startsWith("sirkit:project:")).map((key) => JSON.parse(window.localStorage.getItem(key)!) as { id: string; name: string }).find((record) => record.name.endsWith("(imported copy)"))!.id);
  expect(copyId).not.toBe(J3_FIXTURE_PROJECT_ID);
  expect((await savedState(page, copyId)).sheets).toEqual(fixtureState().sheets);
  const restoredCheckpoints = await page.evaluate((projectId) => new Promise<number>((resolve, reject) => {
    const open = indexedDB.open("sirkit-checkpoints");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const request = db.transaction("checkpoints", "readonly").objectStore("checkpoints").index("byProject").getAll(projectId);
      request.onsuccess = () => { db.close(); resolve((request.result as unknown[]).length); };
      request.onerror = () => reject(request.error);
    };
  }), copyId);
  expect(restoredCheckpoints).toBe(exported.payload.checkpoints.length);
});

test("4. the AI refusal: the Build sentence on the multi-sheet project is refused with the guard's message; no generation task is started and nothing provider-bound is sent", async ({ page, context, baseURL }) => {
  const origin = baseURL!;
  const traffic = watch(page, origin);
  await openFixture(page, context, origin);
  const expected = flatReplacementRefusal(await savedState(page), {})!; // a flat result carries no sheets
  expect(expected).toContain("This project has 4 schematic sheets (Overview, Power, Motor drivers, IMU).");
  const prompt = page.getByTestId("prompt-input");
  if ((await prompt.count()) === 0 || !(await prompt.isVisible())) await page.getByTestId("activity-ai chat").click();
  await expect(prompt).toBeEnabled();
  await prompt.fill(OWNER_FOUR_MOTOR_SENTENCE);
  await expect(page.getByTestId("composer-route")).toHaveAttribute("data-route", "generate");
  await page.getByTestId("composer-submit").click();
  await expect(page.getByText(expected, { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("generation-task-status")).toHaveCount(0);
  await expect(page.getByTestId("schematic-proposal-review")).toHaveCount(0);
  await page.waitForTimeout(1_000);
  expect(traffic.generationStarts, "no generation task was started").toBe(0);
  expect([traffic.edits, traffic.tidies, traffic.buildMulti], "nothing provider-bound was sent").toEqual([0, 0, 0]);
  expect(traffic.leftOrigin).toEqual([]);
  expect(await savedState(page)).toEqual(fixtureState()); // nothing was changed
  await page.screenshot({ path: `${SCREENSHOTS}/j3-ai-refusal-1366x768.png` });
});

test("5. at the editor's minimum width (1280 x 720) the Sheets chip overlaps neither Go to, the status bar nor the workspace tabs", async ({ page, context, baseURL }) => {
  const origin = baseURL!;
  await openFixture(page, context, origin, { width: 1280, height: 720 });
  const chip = await page.getByTestId(T.chip).boundingBox();
  expect(chip).not.toBeNull();
  const goTo = await page.getByTestId("schematic-goto-input").locator("xpath=ancestor::div[contains(@class,'absolute')][1]").boundingBox();
  const statusBar = await page.getByTestId("schematic-canvas").locator("xpath=preceding-sibling::div[contains(@class,'bottom-3') and contains(@class,'left-3')]").boundingBox();
  const tabs = await page.getByTestId("workspace-tabs").boundingBox();
  expect(goTo).not.toBeNull();
  expect(statusBar).not.toBeNull();
  expect(tabs).not.toBeNull();
  expect(disjoint(chip!, goTo!), "chip vs Go to").toBe(true);
  expect(disjoint(chip!, statusBar!), "chip vs status bar").toBe(true);
  expect(disjoint(chip!, tabs!), "chip vs workspace tabs").toBe(true);
  const viewport = page.viewportSize()!;
  const canvas = (await page.getByTestId("schematic-canvas").boundingBox())!;
  expect(chip!.x).toBeGreaterThanOrEqual(0);
  expect(chip!.y).toBeGreaterThanOrEqual(0);
  expect(chip!.x + chip!.width).toBeLessThanOrEqual(viewport.width);
  // [PR-J3-A, 2026-10-22] inside the editor's own area: under the fixture runtime's identity banner the workspace is a few px taller than
  // a 720 px viewport (the status bar at bottom-3 is clipped the same way; pre-existing, not J3), so the chip is held to the canvas box
  expect(chip!.x).toBeGreaterThanOrEqual(canvas.x);
  expect(chip!.x + chip!.width).toBeLessThanOrEqual(canvas.x + canvas.width);
  expect(chip!.y).toBeGreaterThanOrEqual(canvas.y);
  expect(chip!.y + chip!.height).toBeLessThanOrEqual(canvas.y + canvas.height);
  const widths = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  expect(widths.scrollWidth).toBeLessThanOrEqual(widths.innerWidth);
  await page.screenshot({ path: `${SCREENSHOTS}/j3-chip-layout-1280x720.png` });
});
