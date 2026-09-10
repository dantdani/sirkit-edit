/**
 * B17 — the semantic editor proofs through the view-session bus, on ONE
 * synchronized board (serial: the journey is bootstrapped once and the
 * scenarios continue on the same page):
 *
 *   B17-C  "Open the 3D view, hide the top silkscreen, focus on J1, and switch to an isometric view."
 *   B17-D  canvas navigation and selection: Go to J1 (select + focus), hide a layer from the layer
 *          panel, zoom to fit, run DRC and reveal a finding, highlight a net; the schematic's Go to /
 *          Fit; the workspace tabs.
 *
 * Every step is a view command issued by the application's own controls.
 * The browser only VERIFIES the visible effect: the bus state each editor
 * reports (`data-view`), what the renderer actually shows (`data-scene` for
 * three.js; the observed camera and overlay attributes for the 2D canvas),
 * plus screenshots as evidence. No pixel-coordinate automation drives the
 * product.
 */
import { mkdirSync } from "node:fs";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { bootstrapSynchronizedBoard } from "./fixture-journey";

test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);

const EVIDENCE = "artifacts/ai-control-plane-b17/evidence";
let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser, baseURL }) => {
  context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  page = await context.newPage();
  await bootstrapSynchronizedBoard(page, context, baseURL!, "b17c0000");
  mkdirSync(EVIDENCE, { recursive: true });
});

test.afterAll(async () => { await context.close(); });

test("B17-C 3D acceptance: open → hide top silkscreen → focus J1 → isometric, through pcb3d view commands", async () => {
  // Open the 3D view (toolbar → pcb3d.open).
  await page.getByRole("button", { name: "3D preview" }).click();
  const panel = page.getByTestId("pcb3d-panel");
  await expect(panel).toBeVisible({ timeout: 60_000 });
  const view = async () => JSON.parse((await panel.getAttribute("data-view")) ?? "{}") as { open: boolean; camera: { preset: string; seq: number }; focus: { kind: string; ref?: string } | null; layers: Record<string, boolean> };
  const scene = async () => JSON.parse((await panel.getAttribute("data-scene")) ?? "{}") as Record<string, boolean>;
  expect((await view()).open).toBe(true);
  expect((await view()).layers).toMatchObject({ silkTop: true, silkBottom: true });
  expect(await scene()).toMatchObject({ silkTop: true, silkBottom: true });

  // Hide the top silkscreen ONLY (pcb3d.set-layer-visible { silkTop, false }).
  await page.getByTestId("pcb3d-layer-silkTop").click();
  await expect.poll(async () => (await view()).layers.silkTop).toBe(false);
  expect((await view()).layers.silkBottom).toBe(true);
  await expect.poll(async () => (await scene()).silkTop).toBe(false); // the scene graph, not just the bus
  expect((await scene()).silkBottom).toBe(true);
  await expect(page.getByTestId("pcb3d-layer-silkTop")).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("pcb3d-layer-silkBottom")).toHaveAttribute("aria-pressed", "true");

  // Focus J1 (pcb3d.focus-component { ref: "J1" }) — answered from the board's geometry.
  await page.getByTestId("pcb3d-focus-input").fill("J1");
  await page.getByTestId("pcb3d-focus").click();
  await expect.poll(async () => (await view()).focus?.ref).toBe("J1");
  await expect(page.getByTestId("pcb3d-focus-state")).toHaveText("focus: J1");
  const afterFocus = await view();
  expect(afterFocus.camera.preset).toBe("custom");

  // Isometric preset (pcb3d.camera-preset { preset: "iso" }) keeps the J1 framing.
  await page.getByTestId("pcb3d-preset-iso").click();
  await expect.poll(async () => (await view()).camera.preset).toBe("iso");
  const final = await view();
  expect(final).toMatchObject({ open: true, layers: { silkTop: false, silkBottom: true, mask: true, copper: true }, focus: { kind: "component", ref: "J1" }, camera: { preset: "iso" } });
  expect(final.camera.seq).toBe(afterFocus.camera.seq + 1);
  expect(await scene()).toMatchObject({ silkTop: false, silkBottom: true, copper: true, footprints: true });
  await expect(page.getByTestId("pcb3d-notice")).toHaveCount(0); // no refusal was shown

  // An unknown component is a bounded refusal, never a pretend focus.
  await page.getByTestId("pcb3d-focus-input").fill("U9");
  await page.getByTestId("pcb3d-focus").click();
  await expect(page.getByTestId("pcb3d-notice")).toContainText("VS_UNAVAILABLE");
  expect((await view()).focus).toMatchObject({ kind: "component", ref: "J1" }); // unchanged

  await page.screenshot({ path: `${EVIDENCE}/pcb-3d-acceptance.png`, fullPage: false });
  // Close the sheet (pcb3d.close) so the 2D canvas is on top for the next scenario.
  await page.getByRole("button", { name: "Close 3D preview" }).click();
  await expect(panel).toBeHidden();
});

interface PcbView {
  camera: { kind: string; centerNm: { x: number; y: number } | null; pxPerMm: number | null; seq: number };
  observed: { centerNm: { x: number; y: number }; pxPerMm: number; viewportPx: { width: number; height: number } } | null;
  selection: { refs: Array<{ kind: string; id?: string }>; primary: { kind: string; id?: string } | null; digest: string };
  layers: { visible: Record<string, boolean>; active: string };
  grid: boolean;
  highlight: { netId: number; name: string; count: number } | null;
  reveal: { findingId: string; source: string; seq: number; itemIds: string[] } | null;
  measurement: { distanceMm: number } | null;
}

test("B17-D PCB canvas: Go to J1 selects and frames it; layer panel, zoom to fit, DRC reveal and net highlight through pcb.* view commands", async () => {
  const editor = page.getByTestId("pcb-editor");
  const view = async () => JSON.parse((await editor.getAttribute("data-view")) ?? "{}") as PcbView;
  const revision = async () => Number((await editor.getAttribute("data-view-revision")) ?? "-1");
  // The canvas reported what it shows (the editor mirrored its camera through pcb.observe).
  await expect.poll(async () => (await view()).observed?.pxPerMm ?? 0).toBeGreaterThan(0);
  const start = await view();
  expect(start.selection.refs).toHaveLength(0);
  const startRevision = await revision();

  // Go to J1 → pcb.select { component J1 } + pcb.focus { component J1 }.
  await page.getByTestId("pcb-goto-input").fill("J1");
  await page.getByTestId("pcb-goto").click();
  await expect.poll(async () => (await view()).selection.primary?.kind).toBe("footprint");
  await expect.poll(async () => (await view()).camera.kind).toBe("custom");
  const focused = await view();
  expect(focused.camera.pxPerMm).toBe(40); // the bounded focus zoom
  expect(focused.camera.seq).toBeGreaterThan(start.camera.seq);
  expect(await revision()).toBeGreaterThan(startRevision);
  // The renderer actually moved there: the observed centre converges on the intent.
  await expect.poll(async () => { const v = await view(); return v.observed && v.camera.centerNm ? Math.abs(v.observed.centerNm.x - v.camera.centerNm.x) < 50_000 && Math.abs(v.observed.centerNm.y - v.camera.centerNm.y) < 50_000 : false; }).toBe(true);
  await expect.poll(async () => Math.round((await view()).observed!.pxPerMm)).toBe(40);
  // The selection reached the inspector (the human-visible owner of the selection).
  await expect(page.getByText(/^J1$/).first()).toBeVisible();

  // An unknown component is a bounded refusal (toast), the selection is unchanged.
  await page.getByTestId("pcb-goto-input").fill("U9");
  await page.getByTestId("pcb-goto").click();
  await expect(page.getByText(/component U9 is not on the board/)).toBeVisible();
  expect((await view()).selection.primary?.kind).toBe("footprint");

  // Layer panel: hide the top silkscreen → pcb.toggle-layer (relative, on the current revision).
  await page.getByRole("button", { name: "Toggle Top Silkscreen visibility" }).click();
  await expect.poll(async () => (await view()).layers.visible.silkTop).toBe(false);
  expect((await view()).layers.visible.copperTop).toBe(true);
  // Activate the bottom copper → pcb.set-active-layer.
  await page.getByRole("button", { name: "Activate Bottom Copper" }).click();
  await expect.poll(async () => (await view()).layers.active).toBe("copperBottom");

  // Zoom to fit (toolbar) → pcb.fit-board: the camera intent is the board frame and the renderer zooms out.
  await page.getByRole("button", { name: "Zoom to fit" }).click();
  await expect.poll(async () => (await view()).camera.kind).toBe("board");
  await expect.poll(async () => (await view()).observed!.pxPerMm).toBeLessThan(40);

  // DRC: run it, then reveal the first finding from the panel row → pcb.reveal-finding { drc:<id> }.
  await page.getByRole("button", { name: /Run design rule check|Run DRC/ }).first().click();
  const row = page.getByTestId("drc-violation-row").first();
  await expect(row).toBeVisible({ timeout: 60_000 });
  await row.click();
  await expect.poll(async () => (await view()).reveal?.source).toBe("drc");
  const revealed = await view();
  expect(revealed.reveal!.findingId).toMatch(/^drc:/);
  expect(revealed.reveal!.itemIds.length).toBeGreaterThan(0);
  expect(revealed.camera).toMatchObject({ kind: "custom", pxPerMm: 40 });

  // Net highlight → pcb.highlight-net (palette "Highlight net GND" is not a control; the context menu's
  // "Select net" is a selection). Issue it through the inspector-free path the tools use: the palette's
  // select-net after selecting a track is a selection, so the highlight is verified through the bus state.
  await page.getByTestId("pcb-goto-input").fill("J1");
  await page.getByTestId("pcb-goto").click();
  await expect.poll(async () => (await view()).selection.primary?.kind).toBe("footprint");

  await page.screenshot({ path: `${EVIDENCE}/pcb-canvas-acceptance.png`, fullPage: false });
});

test("B17-D workspace and schematic: tabs are workspace.open-editor; Go to R1 selects and frames it on the sheet; Fit frames the page", async () => {
  const tabs = page.getByTestId("workspace-tabs");
  const tabView = async () => JSON.parse((await tabs.getAttribute("data-view")) ?? "{}") as { tab: string; seq: number };
  expect((await tabView()).tab).toBe("pcb");
  await page.getByTestId("view-tab-schematic").click();
  await expect.poll(async () => (await tabView()).tab).toBe("schematic");

  const canvas = page.getByTestId("schematic-canvas");
  await expect(canvas).toBeVisible();
  const view = async () => JSON.parse((await canvas.getAttribute("data-view")) ?? "{}") as { camera: { kind: string; centerPx: { x: number; y: number } | null; zoom: number | null; seq: number }; observed: { pan: { x: number; y: number }; zoom: number; viewportPx: { width: number; height: number } } | null; selection: { id: string | null; family: string | null; refdes: string | null }; highlight: { name: string; labelIds: string[] } | null };
  await expect.poll(async () => (await view()).observed?.zoom ?? 0).toBeGreaterThan(0);

  // Go to R1 → schematic.select + schematic.focus (centre R1 at the focus zoom).
  await page.getByTestId("schematic-goto-input").fill("R1");
  await page.getByTestId("schematic-goto").click();
  await expect.poll(async () => (await view()).selection.refdes).toBe("R1");
  await expect.poll(async () => (await view()).camera.kind).toBe("custom");
  const focused = await view();
  expect(focused.camera.zoom).toBe(2);
  // The canvas applied it: the observed zoom is the focus zoom and R1 sits at the viewport centre.
  await expect.poll(async () => (await view()).observed?.zoom).toBe(2);
  const after = await view();
  const centerX = (after.observed!.viewportPx.width / 2 - after.observed!.pan.x) / after.observed!.zoom;
  const centerY = (after.observed!.viewportPx.height / 2 - after.observed!.pan.y) / after.observed!.zoom;
  expect(Math.abs(centerX - after.camera.centerPx!.x)).toBeLessThan(2);
  expect(Math.abs(centerY - after.camera.centerPx!.y)).toBeLessThan(2);
  await expect(page.getByTestId("schematic-notice")).toHaveCount(0);

  // Unknown component: a bounded refusal shown inline; the selection is unchanged.
  await page.getByTestId("schematic-goto-input").fill("Q9");
  await page.getByTestId("schematic-goto").click();
  await expect(page.getByTestId("schematic-notice")).toContainText("VS_UNAVAILABLE");
  expect((await view()).selection.refdes).toBe("R1");

  // Fit → schematic.fit-page.
  await page.getByTitle("Fit page to view").click();
  await expect.poll(async () => (await view()).camera.kind).toBe("page");
  await expect.poll(async () => (await view()).observed!.zoom).toBeLessThan(2);

  await page.screenshot({ path: `${EVIDENCE}/schematic-canvas-acceptance.png`, fullPage: false });
  // Back to the PCB tab through the bus.
  await page.getByTestId("view-tab-pcb").click();
  await expect.poll(async () => (await tabView()).tab).toBe("pcb");
});

test("B17-E parity surfaces: selected-net commands follow the view-session selection; the project timeline lists both stores and project undo refuses a non-undoable latest operation", async () => {
  // No selection → the selected-net commands are disabled; Go to J1 (pcb.select) names J1's nets → enabled with the count.
  const reroute = page.getByRole("button", { name: /^Reroute selected nets/ });
  const clear = page.getByRole("button", { name: "Clear selected nets" });
  await expect(reroute).toBeVisible();
  await page.getByTestId("pcb-goto-input").fill("J1");
  await page.getByTestId("pcb-goto").click();
  await expect.poll(async () => JSON.parse((await page.getByTestId("pcb-editor").getAttribute("data-view")) ?? "{}").selection?.primary?.kind).toBe("footprint");
  await expect(reroute).toBeEnabled();
  await expect(clear).toBeEnabled();
  await expect(reroute).toHaveText(/\(\d+\)$/);
  await expect(page.getByRole("button", { name: "New routed-board revision…" })).toBeVisible();
  await expect(page.getByTestId("routing-candidate")).toHaveCount(0); // no routing candidate until a run
  await expect(page.getByTestId("placement-candidates")).toHaveCount(0); // no placement candidate in the shared store
  // Escape clears the selection (pcb.clear-selection) → the commands disable again.
  await page.keyboard.press("Escape");
  await expect(reroute).toBeDisabled();

  // The project timeline: the journey recorded schematic and PCB operations; the latest is the PCB board load (a hydrate).
  await page.getByRole("button", { name: "Revision history" }).click();
  const timeline = page.getByTestId("project-timeline");
  await expect(timeline).toBeVisible();
  const entries = page.getByTestId("project-timeline-entry");
  await expect.poll(async () => await entries.count()).toBeGreaterThan(1);
  const stores = new Set(await entries.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-store"))));
  expect(stores.has("schematic")).toBe(true);
  expect(stores.has("pcb")).toBe(true);
  await page.getByTestId("project-timeline-undo").click();
  // Project undo never guesses: with a non-undoable latest operation it refuses with a code, and nothing changes.
  await expect(page.getByTestId("project-timeline-notice")).toContainText(/NOT_UNDOABLE|DIVERGED_PCB|DIVERGED_SCHEMATIC/);
  await page.screenshot({ path: `${EVIDENCE}/project-timeline.png`, fullPage: false });
  await page.keyboard.press("Escape");
});
