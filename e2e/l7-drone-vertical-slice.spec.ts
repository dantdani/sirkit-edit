/**
 * [PR-L6, 2026-10-19] Runbook L.7 item 9 (OD-253 (1)-(5)) in a FRESH browser under the fixture runtime: the owner's four-motor sentence,
 * VERBATIM, through Build - the durable generation task (202 at once), the worker's real slices (the scripted fixture provider designs
 * from the committed fixture catalog's search results), the status card's four blocks reaching saved and the disclosed assumptions, the
 * EXISTING review dialog, Approve, a reload that restores every instance with its published exact revision (Missing parts 0), then
 * Prepare PCB through the binding review (editor requests, reviewer approves every reference, editor syncs and applies the plan) to
 * awaiting qualification - where it STOPS: release stays disabled and nothing is qualified (no router recording exists for this board,
 * OD-253 (5)). The composer never takes the request-lifetime route and nothing leaves the origin.
 *
 * Fake-backed: a scripted provider over a committed catalog - not a live model, a live catalog, a datasheet or a live router.
 */
import { expect, test, type Page, type Request } from "@playwright/test";
import type { SchematicState } from "../lib/schematic-types";
import { actAs, expectHydrated, installDeterministicBrowser, reloadAs } from "./fixture-journey";

test.describe.configure({ mode: "serial" });
test.setTimeout(600_000);

/** The owner's sentence (runbook section L.0), verbatim. */
const OWNER_FOUR_MOTOR_SENTENCE = "build me a simple drone controlling circuitly with 4 motors just a simple one";
const DRONE_BLOCKS = ["Power input and 3.3 V regulator", "Motor driver stages", "Flight controller MCU", "IMU"];

interface Traffic { starts: Array<{ clientRequestId: string; projectId: string }>; buildMulti: number; qualify: number; leftOrigin: string[] }
function watch(page: Page, origin: string): Traffic {
  const traffic: Traffic = { starts: [], buildMulti: 0, qualify: 0, leftOrigin: [] };
  const host = new URL(origin).hostname;
  page.on("request", (request: Request) => {
    const url = new URL(request.url());
    if (url.hostname !== host && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") traffic.leftOrigin.push(request.url());
    if (request.method() !== "POST") return;
    if (url.pathname === "/api/schematic/build-multi") traffic.buildMulti += 1;
    if (url.pathname === "/api/pcb/qualify") traffic.qualify += 1;
    if (url.pathname === "/api/generation-tasks") {
      const body = request.postDataJSON() as { clientRequestId?: string };
      traffic.starts.push({ clientRequestId: body.clientRequestId ?? "", projectId: request.headers()["x-sirkit-project-id"] ?? "" });
    }
  });
  return traffic;
}
const selector = (projectId: string): Record<string, string> => ({ "x-sirkit-tenant-id": "local", "x-sirkit-project-id": projectId, "x-sirkit-branch-id": "main" });
async function serverTask(page: Page, projectId: string, taskId: string): Promise<{ task: Record<string, any>; result: Record<string, any> | null }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const response = await page.request.get(`/api/generation-tasks/${encodeURIComponent(taskId)}?include=result`, { headers: selector(projectId) });
  expect(response.status()).toBe(200);
  return (await response.json()) as { task: Record<string, any>; result: Record<string, any> | null }; // eslint-disable-line @typescript-eslint/no-explicit-any
}
async function activeTaskId(page: Page, projectId: string): Promise<string> {
  const response = await page.request.get("/api/generation-tasks", { headers: selector(projectId) });
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { active: { taskId: string } | null; recent: Array<{ taskId: string }> };
  return body.active?.taskId ?? body.recent[0]!.taskId;
}
/** The editor's state as the page persisted it (the autosaved project record). */
async function savedState(page: Page, projectId: string): Promise<SchematicState> {
  return page.evaluate((key) => (JSON.parse(window.localStorage.getItem(key) ?? "null") as { state: SchematicState }).state, `sirkit:project:${projectId}`);
}

test("the owner's four-motor sentence: 202 at once, four blocks saved, the assumptions shown, the review dialog, Approve, reload restores every published instance (Missing parts 0), Prepare PCB through the binding review to awaiting qualification - release disabled, nothing qualified", async ({ page, context, baseURL }) => {
  const origin = baseURL!;
  const traffic = watch(page, origin);
  await page.setViewportSize({ width: 1366, height: 768 });
  await installDeterministicBrowser(page, context, "17d00001");
  await actAs(context, "editor", origin);
  await page.goto("/");
  await expect(page.getByTestId("fixture-runtime-banner")).toBeVisible();
  await expectHydrated(page);

  // 1. Build: the sentence verbatim, accepted durably at once
  const prompt = page.getByTestId("prompt-input");
  if ((await prompt.count()) === 0 || !(await prompt.isVisible())) await page.getByTestId("activity-ai chat").click();
  await expect(prompt).toBeEnabled();
  await prompt.fill(OWNER_FOUR_MOTOR_SENTENCE);
  await expect(page.getByTestId("composer-route")).toHaveAttribute("data-route", "generate");
  const accepted = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/generation-tasks" && response.request().method() === "POST");
  await page.getByTestId("composer-submit").click();
  const response = await accepted;
  expect(response.status(), "the start answers 202 once the task is durably accepted").toBe(202);
  expect(((await response.json()) as { task: { state: string } }).task.state).toBe("queued");
  expect(traffic.starts).toHaveLength(1);
  const { projectId } = traffic.starts[0]!;

  // 2. the status card: the four planned blocks reach saved; the disclosed assumptions are listed
  await expect(page.getByTestId("generation-task-status")).toBeVisible();
  for (const [index, name] of DRONE_BLOCKS.entries()) {
    const block = page.getByTestId(`generation-task-block-b${index + 1}`);
    await expect(block).toContainText(name, { timeout: 120_000 });
    await expect(block).toHaveAttribute("data-status", "saved", { timeout: 120_000 });
  }
  const assumptions = page.getByTestId("generation-task-assumptions");
  await expect(assumptions).toContainText("brushed 1S coreless DC motor");
  await expect(assumptions).toContainText("1S LiPo");
  await expect(assumptions).toContainText("internal 8 MHz oscillator");
  await expect(assumptions).toContainText("No firmware and no flight qualification");

  // 3. the EXISTING review dialog, and the server's validated result behind it
  await expect(page.getByTestId("schematic-proposal-review")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId("schematic-proposal-review")).toContainText("brushed 1S coreless motors");
  const taskId = await activeTaskId(page, projectId);
  const pending = await serverTask(page, projectId, taskId);
  expect(pending.task).toMatchObject({ state: "awaiting-review", plan: { planner: "planned" }, result: { status: "complete", omittedBlocks: [] }, usage: { modelCalls: 9 } });
  expect(pending.result!.sharedNets.findings).toEqual([]);
  expect(pending.result!.electricalCheck).toMatchObject({ state: "passed", criticalCount: 0 });
  const components = pending.result!.netlist.components as Array<{ refDes: string; partId: string; value: string }>;
  expect(components).toHaveLength(41);
  const count = (partId: string): number => components.filter((component) => component.partId === partId).length;
  expect([count("l7-part-ao3400a"), count("l7-part-ss14"), count("l7-part-mic5504-3v3"), count("l7-part-atmega328p-au"), count("l7-part-lsm6ds3tr-c")]).toEqual([4, 4, 1, 1, 1]);

  // 4. Approve: the EXISTING apply; the task records the review and settles
  await page.getByTestId("schematic-proposal-approve").click();
  await expect(page.getByTestId("schematic-proposal-review")).toBeHidden();
  await expect(page.getByTestId("journey-stage-schematic_applied")).toHaveAttribute("data-status", "succeeded", { timeout: 60_000 });
  await expect.poll(async () => (await serverTask(page, projectId, taskId)).task.state, { timeout: 30_000 }).toBe("succeeded");
  expect((await serverTask(page, projectId, taskId)).task.review).toMatchObject({ outcome: "applied" });

  // 5. reload: every instance comes back with its published exact revision; Missing parts is 0
  await expect.poll(async () => (await savedState(page, projectId))?.kicadComponents?.length ?? 0, { timeout: 30_000 }).toBe(41);
  await page.reload();
  await expect(page.getByTestId("fixture-runtime-banner")).toBeVisible();
  await expectHydrated(page);
  const restored = await savedState(page, projectId);
  expect(restored.kicadComponents).toHaveLength(41);
  expect(restored.kicadComponents!.filter((instance) => !instance.atomicPartRevisionId).map((instance) => instance.refDes)).toEqual([]);
  expect(restored.kicadComponents!.map((instance) => instance.refDes).sort()).toEqual(components.map((component) => component.refDes).sort());
  if (!(await page.getByTestId("missing-parts-open").isVisible())) await page.getByTestId("activity-build library").click();
  await expect(page.getByTestId("missing-parts-open")).toHaveAttribute("data-count", "0", { timeout: 30_000 });

  // 6. Prepare PCB: the binding review (the editor requests all, a reviewer approves every reference), the sync, the plan applied
  await page.getByTestId("view-tab-pcb").click();
  await expect(page.getByTestId("pcb-empty-state")).toBeVisible();
  await expect(page.getByTestId("component-review-panel")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("review-request-all").click();
  await expect(page.getByTestId("component-review-pending")).toHaveText("41 pending", { timeout: 60_000 });
  await reloadAs(page, context, "reviewer", origin, false);
  await expect(page.getByTestId("component-review-pending")).toHaveText("41 pending", { timeout: 60_000 });
  const refs = await page.locator('[data-testid^="review-approve-"]').evaluateAll((nodes) => nodes.map((node) => (node.getAttribute("data-testid") ?? "").slice("review-approve-".length)));
  expect(refs.sort()).toEqual(components.map((component) => component.refDes).sort());
  for (const ref of refs) {
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

  // 7. the handoff stops here: release is disabled and nothing was qualified (no router recording exists for this board)
  await expect(page.getByTestId("p2g-request-release")).toBeDisabled();
  await page.screenshot({ path: "artifacts/product-reliability-simple-ui/persistent-generation/screenshots/l7-drone-awaiting-qualification-1366x768.png" });
  expect(traffic.qualify, "no qualification was requested").toBe(0);
  expect(traffic.starts, "one start request").toHaveLength(1);
  expect(traffic.buildMulti, "the composer never takes the request-lifetime route").toBe(0);
  expect(traffic.leftOrigin).toEqual([]);
});
