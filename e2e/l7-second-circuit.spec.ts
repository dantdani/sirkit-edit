/**
 * [PR-L6, 2026-10-19] Runbook L.7 item 10 (OD-253 (4), (5)) in a FRESH browser under the fixture runtime: a second ordinary circuit - a
 * 555 PWM LED dimmer - through the SAME path as the four-motor request (Build, the durable task, the worker's real slices, the review
 * dialog, Approve, reload with every instance published, Prepare PCB through the binding review to awaiting qualification, release
 * disabled, nothing qualified); and, in the same file, the historical blinker request still yields its recorded 555 design. Together with
 * e2e/l7-drone-vertical-slice.spec.ts this shows the scripted provider designs by REQUEST, not one fixed answer.
 *
 * Fake-backed: a scripted provider over a committed catalog - not a live model, a live catalog, a datasheet or a live router.
 */
import { expect, test, type BrowserContext, type Page, type Request } from "@playwright/test";
import type { SchematicState } from "../lib/schematic-types";
import { BLINKER_ACCEPTANCE_PROMPT, BLINKER_NETLIST } from "../app/lib/fixture-runtime/blinker/catalog";
import { actAs, expectHydrated, installDeterministicBrowser, reloadAs } from "./fixture-journey";

test.describe.configure({ mode: "serial" });
test.setTimeout(420_000);

const DIMMER_REQUEST = "Design a 5 V LED dimmer: a 555 timer PWM with a 10k potentiometer setting the brightness, switching the LED through an N-channel MOSFET.";

interface Traffic { starts: Array<{ projectId: string }>; buildMulti: number; qualify: number; leftOrigin: string[] }
function watch(page: Page, origin: string): Traffic {
  const traffic: Traffic = { starts: [], buildMulti: 0, qualify: 0, leftOrigin: [] };
  const host = new URL(origin).hostname;
  page.on("request", (request: Request) => {
    const url = new URL(request.url());
    if (url.hostname !== host && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") traffic.leftOrigin.push(request.url());
    if (request.method() !== "POST") return;
    if (url.pathname === "/api/schematic/build-multi") traffic.buildMulti += 1;
    if (url.pathname === "/api/pcb/qualify") traffic.qualify += 1;
    if (url.pathname === "/api/generation-tasks") traffic.starts.push({ projectId: request.headers()["x-sirkit-project-id"] ?? "" });
  });
  return traffic;
}
const selector = (projectId: string): Record<string, string> => ({ "x-sirkit-tenant-id": "local", "x-sirkit-project-id": projectId, "x-sirkit-branch-id": "main" });
async function serverResult(page: Page, projectId: string): Promise<{ task: Record<string, any>; result: Record<string, any> | null }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const listed = (await (await page.request.get("/api/generation-tasks", { headers: selector(projectId) })).json()) as { active: { taskId: string } | null; recent: Array<{ taskId: string }> };
  const taskId = listed.active?.taskId ?? listed.recent[0]!.taskId;
  const response = await page.request.get(`/api/generation-tasks/${encodeURIComponent(taskId)}?include=result`, { headers: selector(projectId) });
  expect(response.status()).toBe(200);
  return (await response.json()) as { task: Record<string, any>; result: Record<string, any> | null }; // eslint-disable-line @typescript-eslint/no-explicit-any
}
async function savedState(page: Page, projectId: string): Promise<SchematicState> {
  return page.evaluate((key) => (JSON.parse(window.localStorage.getItem(key) ?? "null") as { state: SchematicState }).state, `sirkit:project:${projectId}`);
}
/** A fresh browser, the composer's Build of `request`, and the EXISTING review dialog open on its result; returns the project id. */
async function buildInFreshBrowser(page: Page, context: BrowserContext, origin: string, namespace: string, request: string, traffic: Traffic): Promise<string> {
  await page.setViewportSize({ width: 1366, height: 768 });
  await installDeterministicBrowser(page, context, namespace);
  await actAs(context, "editor", origin);
  await page.goto("/");
  await expect(page.getByTestId("fixture-runtime-banner")).toBeVisible();
  await expectHydrated(page);
  const prompt = page.getByTestId("prompt-input");
  if ((await prompt.count()) === 0 || !(await prompt.isVisible())) await page.getByTestId("activity-ai chat").click();
  await expect(prompt).toBeEnabled();
  await prompt.fill(request);
  await expect(page.getByTestId("composer-route")).toHaveAttribute("data-route", "generate");
  const accepted = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/generation-tasks" && response.request().method() === "POST");
  await page.getByTestId("composer-submit").click();
  expect((await accepted).status()).toBe(202);
  await expect(page.getByTestId("schematic-proposal-review")).toBeVisible({ timeout: 120_000 });
  expect(traffic.starts).toHaveLength(1);
  return traffic.starts[0]!.projectId;
}

test("a 555 PWM LED dimmer: one circuit with the published 1N4148W pair, the pot and the AO3400A; Approve, reload with every instance published, Prepare PCB to awaiting qualification - release disabled, nothing qualified", async ({ page, context, baseURL }) => {
  const origin = baseURL!;
  const traffic = watch(page, origin);
  const projectId = await buildInFreshBrowser(page, context, origin, "17d00002", DIMMER_REQUEST, traffic);
  const pending = await serverResult(page, projectId);
  expect(pending.task).toMatchObject({ state: "awaiting-review", plan: { planner: "single" }, result: { status: "complete" }, usage: { modelCalls: 3 } });
  expect(pending.result!.electricalCheck).toMatchObject({ state: "passed", criticalCount: 0 });
  const components = pending.result!.netlist.components as Array<{ refDes: string; partId: string; value: string }>;
  const byRef = new Map(components.map((component) => [component.refDes, component] as const));
  expect(components).toHaveLength(14);
  expect(byRef.get("U1")).toMatchObject({ partId: "b16-1c-part-ne555d" });
  expect(byRef.get("RV1")).toMatchObject({ partId: "l7-part-pot-3386p-10k", value: "10k" });
  expect([byRef.get("D1"), byRef.get("D2")]).toEqual([expect.objectContaining({ partId: "pr-m-part-1n4148w", value: "1N4148W" }), expect.objectContaining({ partId: "pr-m-part-1n4148w", value: "1N4148W" })]);
  expect(byRef.get("Q1")).toMatchObject({ partId: "l7-part-ao3400a" });

  await page.getByTestId("schematic-proposal-approve").click();
  await expect(page.getByTestId("schematic-proposal-review")).toBeHidden();
  await expect(page.getByTestId("journey-stage-schematic_applied")).toHaveAttribute("data-status", "succeeded", { timeout: 60_000 });
  await expect.poll(async () => (await savedState(page, projectId))?.kicadComponents?.length ?? 0, { timeout: 30_000 }).toBe(14);
  await page.reload();
  await expect(page.getByTestId("fixture-runtime-banner")).toBeVisible();
  await expectHydrated(page);
  const restored = await savedState(page, projectId);
  expect(restored.kicadComponents!.filter((instance) => !instance.atomicPartRevisionId).map((instance) => instance.refDes)).toEqual([]);
  if (!(await page.getByTestId("missing-parts-open").isVisible())) await page.getByTestId("activity-build library").click();
  await expect(page.getByTestId("missing-parts-open")).toHaveAttribute("data-count", "0", { timeout: 30_000 });

  await page.getByTestId("view-tab-pcb").click();
  await expect(page.getByTestId("pcb-empty-state")).toBeVisible();
  await expect(page.getByTestId("component-review-panel")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("review-request-all").click();
  await expect(page.getByTestId("component-review-pending")).toHaveText("14 pending", { timeout: 60_000 });
  await reloadAs(page, context, "reviewer", origin, false);
  for (const ref of components.map((component) => component.refDes)) {
    await page.getByTestId(`review-approve-${ref}`).click();
    await expect(page.getByTestId(`review-state-${ref}`)).toHaveAttribute("data-state", "approved", { timeout: 30_000 });
  }
  await reloadAs(page, context, "editor", origin, false);
  await page.getByTestId("sync-schematic-to-pcb").click();
  const apply = page.locator('[data-testid^="apply-sync-plan"]').first();
  await expect(apply).toBeVisible({ timeout: 120_000 });
  await apply.click();
  await expect(page.getByTestId("p2g-workflow-state")).toHaveAttribute("data-state", "awaiting_qualification", { timeout: 120_000 });
  await expect(page.getByTestId("p2g-request-release")).toBeDisabled();
  expect(traffic.qualify).toBe(0);
  expect(traffic.buildMulti).toBe(0);
  expect(traffic.leftOrigin).toEqual([]);
});

test("the historical blinker request still yields the recorded 555 blinker design (selection by request, not a fixed answer)", async ({ page, context, baseURL }) => {
  const origin = baseURL!;
  const traffic = watch(page, origin);
  const projectId = await buildInFreshBrowser(page, context, origin, "17d00003", BLINKER_ACCEPTANCE_PROMPT, traffic);
  await expect(page.getByTestId("schematic-proposal-summary")).toContainText(/U1|555/);
  const pending = await serverResult(page, projectId);
  expect(pending.task).toMatchObject({ state: "awaiting-review", plan: { planner: "single" }, result: { status: "complete" }, usage: { modelCalls: 3 } });
  expect(pending.result!.netlist.components).toEqual(BLINKER_NETLIST.components);
  // Cancel: the discard is recorded on the task; nothing is applied
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByTestId("schematic-proposal-review")).toBeHidden();
  await expect.poll(async () => (await serverResult(page, projectId)).task.state, { timeout: 30_000 }).toBe("succeeded");
  expect((await serverResult(page, projectId)).task.review).toMatchObject({ outcome: "discarded" });
  expect(traffic.buildMulti).toBe(0);
  expect(traffic.leftOrigin).toEqual([]);
});
