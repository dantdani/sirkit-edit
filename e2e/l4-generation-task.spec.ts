/**
 * [PR-L, 2026-10-17] Runbook L.4, increment 4 (L.7 items 6, 7 and the browser half of 9): the composer's Generate as a DURABLE design
 * task, in a FRESH browser under the fixture runtime. The dev server runs with a generation worker beside it (playwright.config.ts starts
 * `scripts/dev-with-worker.mjs`, whose worker drives the dev server's in-memory task store through the pump route); the fixture's scripted
 * provider answers the slice core's real turns with the recorded blinker design (zero credits, labelled, nothing leaves the origin).
 *
 *  1. Build mode, a circuit described: the start is ACCEPTED at once (202, before any design work), the activity entry shows the task's
 *     real milestones and its status card (Stop design visible, by its accessible name), a reload in the middle reattaches to the SAME
 *     task without starting it again (one start request, one task, three scripted model calls), the result opens the EXISTING review
 *     dialog, approval applies it and settles the task (succeeded, applied).
 *  2. Stop design: the task is cancelled durably; no result is ever offered afterwards, the server holds no result; Start again is a
 *     NEW task (a new request id) whose result is offered, and its Cancel records the discard on that task.
 *  3. Pause design, then Resume design: the same task continues to its result (one plan, no second start).
 *  4. A project switch: project B shows nothing of project A's design and the server lists no task for B; switching back reattaches A's
 *     task and offers A's result there.
 * Fake-backed: this proves the page's and the task lifecycle's contract, not a live model, live catalog or live authentication.
 */
import { expect, test, type Page, type Request } from "@playwright/test";
import { BLINKER_ACCEPTANCE_PROMPT } from "../app/lib/fixture-runtime/blinker/catalog";
import { actAs, expectHydrated, installDeterministicBrowser } from "./fixture-journey";

test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);

interface Traffic { starts: Array<{ clientRequestId: string; projectId: string }>; buildMulti: number; leftOrigin: string[]; listed: string[] }
function watch(page: Page, origin: string): Traffic {
  const traffic: Traffic = { starts: [], buildMulti: 0, leftOrigin: [], listed: [] };
  const host = new URL(origin).hostname;
  page.on("request", (request: Request) => {
    const url = new URL(request.url());
    if (url.hostname !== host && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") traffic.leftOrigin.push(request.url());
    if (request.method() === "GET" && url.pathname === "/api/generation-tasks") traffic.listed.push(request.headers()["x-sirkit-project-id"] ?? "");
    if (request.method() !== "POST") return;
    if (url.pathname === "/api/schematic/build-multi") traffic.buildMulti += 1;
    if (url.pathname === "/api/generation-tasks") {
      const body = request.postDataJSON() as { clientRequestId?: string };
      traffic.starts.push({ clientRequestId: body.clientRequestId ?? "", projectId: request.headers()["x-sirkit-project-id"] ?? "" });
    }
  });
  return traffic;
}
const selector = (projectId: string): Record<string, string> => ({ "x-sirkit-tenant-id": "local", "x-sirkit-project-id": projectId, "x-sirkit-branch-id": "main" });
async function serverTasks(page: Page, projectId: string): Promise<{ active: Record<string, any> | null; recent: Array<{ taskId: string }> }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const response = await page.request.get("/api/generation-tasks", { headers: selector(projectId) });
  expect(response.status()).toBe(200);
  return (await response.json()) as { active: Record<string, any> | null; recent: Array<{ taskId: string }> }; // eslint-disable-line @typescript-eslint/no-explicit-any
}
async function serverTask(page: Page, projectId: string, taskId: string): Promise<{ task: Record<string, any>; result: Record<string, any> | null }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const response = await page.request.get(`/api/generation-tasks/${encodeURIComponent(taskId)}?include=result`, { headers: selector(projectId) });
  expect(response.status()).toBe(200);
  return (await response.json()) as { task: Record<string, any>; result: Record<string, any> | null }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

async function openFresh(page: Page, context: Parameters<typeof installDeterministicBrowser>[1], origin: string, namespace: string): Promise<void> {
  await installDeterministicBrowser(page, context, namespace);
  await actAs(context, "editor", origin);
  await page.goto("/");
  await expect(page.getByTestId("fixture-runtime-banner")).toBeVisible();
  await expectHydrated(page);
}
async function describeCircuit(page: Page): Promise<void> {
  const prompt = page.getByTestId("prompt-input");
  if ((await prompt.count()) === 0) await page.getByTestId("activity-ai chat").click();
  await expect(prompt).toBeEnabled();
  await prompt.fill(BLINKER_ACCEPTANCE_PROMPT);
  await expect(page.getByTestId("composer-route")).toHaveAttribute("data-route", "generate");
  const accepted = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/generation-tasks" && response.request().method() === "POST");
  await page.getByTestId("composer-submit").click();
  const response = await accepted;
  expect(response.status(), "the start answers 202 once the task is durably accepted").toBe(202);
  expect(((await response.json()) as { task: { state: string } }).task.state).toBe("queued");
}

test("1. Build mode: accepted at once, live milestones and a status card, a reload reattaches to the SAME task, the EXISTING review dialog, approval settles it", async ({ page, context, baseURL }) => {
  const origin = baseURL!;
  const traffic = watch(page, origin);
  await openFresh(page, context, origin, "1a400001");
  await describeCircuit(page);
  const status = page.getByTestId("generation-task-status");
  await expect(status).toBeVisible();
  await expect(page.getByText("Design accepted; a generation worker runs it in saved steps — leaving or reloading this page does not stop it")).toBeVisible();
  await expect(page.getByText(/^Design request accepted \(build\); waiting for a generation worker to plan it\.$/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/^A generation worker started the plan slice \(attempt 1\)\.$/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("generation-task-counts")).toContainText("elapsed");
  await expect(page.getByTestId("generation-task-counts")).not.toContainText("%");
  const stop = page.getByRole("button", { name: "Stop design" });
  if (await page.getByTestId("generation-task-status").getAttribute("data-state").then((state) => state !== "awaiting-review")) await expect(stop).toBeVisible();
  const { projectId, clientRequestId } = traffic.starts[0]!;
  const taskId = (await serverTasks(page, projectId)).active!.taskId as string;

  // a reload in the middle: the design keeps running server-side; the page reattaches to ITS task (no second start)
  const reattached = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/generation-tasks" && response.request().method() === "GET");
  await page.reload();
  await expect(page.getByTestId("fixture-runtime-banner")).toBeVisible();
  expect(((await (await reattached).json()) as { active: { taskId: string } | null }).active?.taskId ?? taskId).toBe(taskId);
  await page.getByTestId("activity-ai chat").click({ timeout: 3_000 }).catch(() => undefined); // the conversation (closed on a fresh load) shows the reattached entry; the review dialog may already cover it
  await expect(page.getByTestId("schematic-proposal-review")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId("schematic-proposal-summary")).toContainText(/U1|555/);
  expect(traffic.starts, "one start request: the reload never started the design again").toHaveLength(1);
  const pending = await serverTask(page, projectId, taskId);
  expect(pending.task).toMatchObject({ state: "awaiting-review", clientRequestId, usage: { modelCalls: 3 }, result: { status: "complete" } });
  expect((await serverTasks(page, projectId)).recent).toHaveLength(1);

  // approval: the EXISTING apply; the task records the review and settles
  await page.getByTestId("schematic-proposal-approve").click();
  await expect(page.getByTestId("schematic-proposal-review")).toBeHidden();
  await expect(page.getByTestId("journey-stage-schematic_applied")).toHaveAttribute("data-status", "succeeded", { timeout: 30_000 });
  await expect.poll(async () => (await serverTask(page, projectId, taskId)).task.state, { timeout: 30_000 }).toBe("succeeded");
  expect((await serverTask(page, projectId, taskId)).task.review).toMatchObject({ outcome: "applied" });
  expect((await serverTasks(page, projectId)).active).toBeNull();
  expect(traffic.buildMulti, "the composer never takes the request-lifetime route").toBe(0);
  expect(traffic.leftOrigin).toEqual([]);
});

test("2. Stop design cancels durably and no late result is offered; Start again is a NEW task whose Cancel records the discard", async ({ page, context, baseURL }) => {
  const origin = baseURL!;
  const traffic = watch(page, origin);
  await openFresh(page, context, origin, "1a400002");
  await describeCircuit(page);
  await page.getByRole("button", { name: "Stop design" }).click();
  await expect(page.getByTestId("generation-task-status")).toHaveAttribute("data-state", "cancelled", { timeout: 30_000 });
  await expect(page.getByTestId("generation-task-state")).toHaveText("Stopped by you: nothing more runs, and a late result is refused.");
  const { projectId } = traffic.starts[0]!;
  const taskId = (await serverTasks(page, projectId)).recent[0]!.taskId;
  // the fixture design takes a few seconds: well past it, nothing is offered and the server holds no result
  await page.waitForTimeout(8_000);
  await expect(page.getByTestId("schematic-proposal-review")).toHaveCount(0);
  const stopped = await serverTask(page, projectId, taskId);
  expect(stopped.task).toMatchObject({ state: "cancelled", terminal: true, result: null, control: { cancelRequested: true } });
  expect(stopped.result).toBeNull();
  await expect(page.getByRole("button", { name: "Stop design" })).toHaveCount(0);

  // Start again: a NEW request id, a NEW task; its result is offered; Cancel discards it and records that on the task
  await page.getByRole("button", { name: "Start again" }).click();
  await expect(page.getByTestId("schematic-proposal-review")).toBeVisible({ timeout: 90_000 });
  expect(traffic.starts).toHaveLength(2);
  expect(traffic.starts[1]!.clientRequestId).not.toBe(traffic.starts[0]!.clientRequestId);
  const second = (await serverTasks(page, projectId)).active!.taskId as string;
  expect(second).not.toBe(taskId);
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByTestId("schematic-proposal-review")).toBeHidden();
  await expect.poll(async () => (await serverTask(page, projectId, second)).task.state, { timeout: 30_000 }).toBe("succeeded");
  expect((await serverTask(page, projectId, second)).task.review).toMatchObject({ outcome: "discarded" });
  expect((await serverTask(page, projectId, taskId)).task.state).toBe("cancelled"); // the stopped task was never restarted
});

test("3. Pause design keeps the saved work; Resume design continues the SAME task to its result", async ({ page, context, baseURL }) => {
  const origin = baseURL!;
  const traffic = watch(page, origin);
  await openFresh(page, context, origin, "1a400003");
  await describeCircuit(page);
  await page.getByRole("button", { name: "Pause design" }).click();
  await expect(page.getByTestId("generation-task-status")).toHaveAttribute("data-state", "paused", { timeout: 30_000 });
  await expect(page.getByTestId("generation-task-state")).toHaveText("Paused: saved work is kept; Resume continues it.");
  await page.waitForTimeout(4_000); // a paused design does not advance
  await expect(page.getByTestId("generation-task-status")).toHaveAttribute("data-state", "paused");
  await page.getByRole("button", { name: "Resume design" }).click();
  await expect(page.getByTestId("schematic-proposal-review")).toBeVisible({ timeout: 90_000 });
  const { projectId } = traffic.starts[0]!;
  const tasks = await serverTasks(page, projectId);
  expect(tasks.recent).toHaveLength(1);
  const resumed = await serverTask(page, projectId, tasks.active!.taskId as string);
  expect(resumed.task).toMatchObject({ state: "awaiting-review", result: { status: "complete" } });
  expect(traffic.starts).toHaveLength(1);
  await page.getByTestId("schematic-proposal-approve").click();
  await expect(page.getByTestId("schematic-proposal-review")).toBeHidden();
});

test("4. A project switch never attaches a design to another project; switching back reattaches the project's own task and offers its result", async ({ page, context, baseURL }) => {
  const origin = baseURL!;
  const traffic = watch(page, origin);
  await openFresh(page, context, origin, "1a400004");
  await describeCircuit(page);
  const projectA = traffic.starts[0]!.projectId;
  // switch to a NEW project B while A's design runs
  await page.getByTestId("activity-projects").click();
  await page.getByTestId("new-project").click();
  await expect.poll(async () => page.evaluate(() => document.querySelectorAll('aside button[aria-label^="Delete project"]').length)).toBe(1);
  await page.waitForTimeout(8_000); // A's design finishes meanwhile, server-side
  await expect(page.getByTestId("schematic-proposal-review")).toHaveCount(0);
  await expect(page.getByTestId("generation-task-status")).toHaveCount(0);
  // B's own reattach asked the server for B's task (its selector), and the server holds none for B
  await expect.poll(() => traffic.listed.filter((projectId) => projectId && projectId !== projectA).length).toBeGreaterThan(0);
  const projectB = traffic.listed.find((projectId) => projectId && projectId !== projectA)!;
  expect(await serverTasks(page, projectB)).toMatchObject({ active: null, recent: [] });
  expect((await serverTasks(page, projectA)).active).toMatchObject({ state: "awaiting-review" });
  // back to A: its own task is reattached and its result offered there
  await page.locator('aside div.group:has(button[aria-label^="Delete project"]) > button').first().click();
  await expect(page.getByTestId("schematic-proposal-review")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("schematic-proposal-summary")).toContainText(/U1|555/);
  expect(traffic.starts.map((start) => start.projectId)).toEqual([projectA]);
  await page.getByTestId("schematic-proposal-approve").click();
  await expect(page.getByTestId("schematic-proposal-review")).toBeHidden();
});
