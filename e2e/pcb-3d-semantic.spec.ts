/**
 * B17-C — the required 3D scenario through the SEMANTIC bus:
 *
 *   "Open the 3D view, hide the top silkscreen, focus on J1, and switch to an isometric view."
 *
 * Every step is a `pcb3d.*` view command issued by the application's own
 * controls (toolbar, layer toggle, focus input, preset button). The browser
 * only VERIFIES the visible effect: the bus state the panel reports
 * (`data-view`) and what the three.js scene graph actually shows
 * (`data-scene`, read from the scene objects' visibility), plus a screenshot
 * as evidence. No pixel-coordinate automation drives the product.
 */
import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { bootstrapSynchronizedBoard } from "./fixture-journey";

test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);

test("3D acceptance: open → hide top silkscreen → focus J1 → isometric, through pcb3d view commands", async ({ page, context, baseURL }) => {
  await bootstrapSynchronizedBoard(page, context, baseURL!, "b17c0000");

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

  mkdirSync("artifacts/ai-control-plane-b17/evidence", { recursive: true });
  await page.screenshot({ path: "artifacts/ai-control-plane-b17/evidence/pcb-3d-acceptance.png", fullPage: false });
});
