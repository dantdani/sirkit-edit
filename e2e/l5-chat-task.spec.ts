/**
 * [PR-L, 2026-10-18] Runbook L.5, increment 5 (L.7 item 8; task-worker-contract.md section 8): the Build composer and the assistant start,
 * inspect and control the SAME durable generation task, in a FRESH browser under the fixture runtime (the dev server runs with its pump
 * generation worker, playwright.config.ts; the scripted agent and the scripted generation provider answer - zero credits, nothing leaves
 * the origin).
 *
 *  1. Build starts the design (POST /api/generation-tasks, 202); Pause design on its status card; the assistant's task inspection
 *     reports THAT task (its id, paused); the assistant's "Resume the design" is a confirm chip, and NOTHING happens until the human
 *     confirms it; Confirm sends the resume through the task's control route; the SAME task finishes into the ONE review dialog; approval
 *     settles it. One start request, one task.
 *  2. The assistant starts the design: the page follows it on the SAME status card as a Build start; the composer's own start route
 *     answers 409 GENERATION_TASK_ACTIVE naming the SAME task (one active task per project, the same service); the worker's result
 *     reaches the ONE review dialog through the SAME intake, once, with the note that the assistant proposed it; approval settles it.
 *  3. Stop answer vs Stop design: the assistant starts the design and keeps answering; Stop answer ends the streaming turn only - the
 *     task is still working, uncancelled, its status card still offers Stop design; Stop design then cancels the task durably and no
 *     result is ever offered.
 * Fake-backed: this proves the page's, the chat tools' and the task lifecycle's contract, not a live model, catalog or authentication.
 */
import { expect, test, type Page, type Request } from "@playwright/test";
import { BLINKER_ACCEPTANCE_PROMPT } from "../app/lib/fixture-runtime/blinker/catalog";
import { toolLineLabel } from "../app/lib/project/chat-run-view";
import { actAs, expectHydrated, installDeterministicBrowser } from "./fixture-journey";

test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);

/** the generate tool's run-log line (the registry title, Tier 2, the start's status) */
const START_LINE = toolLineLabel({ title: "Start or follow a Build-mode schematic design", tier: 2, ok: true, status: "task_started" });

interface Traffic { starts: Array<{ clientRequestId: string; projectId: string }>; chats: string[]; chatProjects: string[]; controls: Array<{ taskId: string; action: string }>; buildMulti: number; leftOrigin: string[] }
function watch(page: Page, origin: string): Traffic {
  const traffic: Traffic = { starts: [], chats: [], chatProjects: [], controls: [], buildMulti: 0, leftOrigin: [] };
  const host = new URL(origin).hostname;
  page.on("request", (request: Request) => {
    const url = new URL(request.url());
    if (url.hostname !== host && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") traffic.leftOrigin.push(request.url());
    if (request.method() !== "POST") return;
    if (url.pathname === "/api/schematic/build-multi") traffic.buildMulti += 1;
    if (url.pathname === "/api/chat") { try { const body = request.postDataJSON() as { messages?: Array<{ content?: string }>; scope?: { projectId?: string } }; traffic.chats.push(String(body.messages?.at(-1)?.content ?? "")); traffic.chatProjects.push(String(body.scope?.projectId ?? "")); } catch { /* not JSON */ } }
    if (url.pathname === "/api/generation-tasks") traffic.starts.push({ clientRequestId: (request.postDataJSON() as { clientRequestId?: string }).clientRequestId ?? "", projectId: request.headers()["x-sirkit-project-id"] ?? "" });
    const control = /^\/api\/generation-tasks\/([^/]+)\/control$/.exec(url.pathname);
    if (control) traffic.controls.push({ taskId: decodeURIComponent(control[1]!), action: (request.postDataJSON() as { action?: string }).action ?? "" });
  });
  return traffic;
}
const selector = (projectId: string): Record<string, string> => ({ "x-sirkit-tenant-id": "local", "x-sirkit-project-id": projectId, "x-sirkit-branch-id": "main" });
async function serverTasks(page: Page, projectId: string): Promise<{ active: Record<string, any> | null; recent: Array<{ taskId: string; origin: string }> }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const response = await page.request.get("/api/generation-tasks", { headers: selector(projectId) });
  expect(response.status()).toBe(200);
  return (await response.json()) as { active: Record<string, any> | null; recent: Array<{ taskId: string; origin: string }> }; // eslint-disable-line @typescript-eslint/no-explicit-any
}
async function serverTask(page: Page, projectId: string, taskId: string): Promise<Record<string, any>> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const response = await page.request.get(`/api/generation-tasks/${encodeURIComponent(taskId)}`, { headers: selector(projectId) });
  expect(response.status()).toBe(200);
  return ((await response.json()) as { task: Record<string, any> }).task; // eslint-disable-line @typescript-eslint/no-explicit-any
}
async function openFresh(page: Page, context: Parameters<typeof installDeterministicBrowser>[1], origin: string, namespace: string): Promise<void> {
  await installDeterministicBrowser(page, context, namespace);
  await actAs(context, "editor", origin);
  await page.goto("/");
  await expect(page.getByTestId("fixture-runtime-banner")).toBeVisible();
  await expectHydrated(page);
}
async function composer(page: Page): Promise<ReturnType<Page["getByTestId"]>> {
  const prompt = page.getByTestId("prompt-input");
  if ((await prompt.count()) === 0) await page.getByTestId("activity-ai chat").click();
  await expect(prompt).toBeEnabled();
  return prompt;
}
/** A message to the ASSISTANT (the composer's own override when the page would route it elsewhere); `wait`: until the run ends. */
async function askAssistant(page: Page, text: string, options: { wait?: boolean } = {}): Promise<void> {
  const prompt = await composer(page);
  await prompt.fill(text);
  if ((await page.getByTestId("composer-route").getAttribute("data-route")) !== "ask") await page.getByTestId("composer-route-override").click();
  await expect(page.getByTestId("composer-route")).toHaveAttribute("data-route", "ask");
  await expect(page.getByTestId("composer-submit")).toHaveText("Send");
  await page.getByTestId("composer-submit").click();
  if (options.wait !== false) await expect(page.getByTestId("chat-stop")).toBeHidden({ timeout: 60_000 });
}
async function buildGenerate(page: Page): Promise<void> {
  const prompt = await composer(page);
  await prompt.fill(BLINKER_ACCEPTANCE_PROMPT);
  await expect(page.getByTestId("composer-route")).toHaveAttribute("data-route", "generate");
  const accepted = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/generation-tasks" && response.request().method() === "POST");
  await page.getByTestId("composer-submit").click();
  expect((await accepted).status(), "the Build start is accepted durably").toBe(202);
}

test("1. Build starts the design; the assistant inspects THAT task and asks to resume it on a chip; only the human's Confirm resumes it; the ONE review dialog settles it", async ({ page, context, baseURL }) => {
  const origin = baseURL!;
  const traffic = watch(page, origin);
  await openFresh(page, context, origin, "1a500001");
  await buildGenerate(page);
  await page.getByRole("button", { name: "Pause design", exact: true }).click();
  const card = page.getByTestId("generation-task-status").first();
  await expect(card).toHaveAttribute("data-state", "paused", { timeout: 30_000 });
  const { projectId } = traffic.starts[0]!;
  const taskId = (await serverTasks(page, projectId)).active!.taskId as string;

  // the assistant inspects the SAME task (its public snapshot): its id and its state, from the durable store
  await askAssistant(page, "Check the design.");
  await expect(page.getByText(new RegExp(`\\(fixture agent\\) design task ${taskId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: paused`))).toBeVisible({ timeout: 30_000 });

  // the assistant's control is a chip: nothing happens until the human confirms it
  await askAssistant(page, "Resume the design.");
  const chip = page.getByTestId("generation-task-control-card");
  await expect(chip).toBeVisible({ timeout: 30_000 });
  await expect(chip).toContainText("The assistant asks: Resume design");
  await expect(page.getByText("(fixture agent) the control request is on a chip for you to confirm - nothing has happened to the design yet.")).toBeVisible();
  expect(traffic.controls.filter((control) => control.action === "resume"), "nothing sent before the human's click").toEqual([]);
  expect((await serverTask(page, projectId, taskId)).state).toBe("paused");
  await page.getByTestId("generation-task-control-confirm").click();
  await expect.poll(() => traffic.controls.filter((control) => control.action === "resume")).toEqual([{ taskId, action: "resume" }]);
  await expect(chip).toContainText("Confirmed: Resume design.");
  await expect(page.getByTestId("generation-task-control-confirm")).toHaveCount(0); // the chip is spent

  // the SAME task finishes into the ONE review dialog; approval settles it
  await expect(page.getByTestId("schematic-proposal-review")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await page.getByTestId("schematic-proposal-approve").click();
  await expect(page.getByTestId("schematic-proposal-review")).toBeHidden();
  await expect.poll(async () => (await serverTask(page, projectId, taskId)).state, { timeout: 30_000 }).toBe("succeeded");
  expect(traffic.starts, "one start: the assistant never started another").toHaveLength(1);
  expect((await serverTasks(page, projectId)).recent).toHaveLength(1);
  expect(traffic.buildMulti).toBe(0);
  expect(traffic.leftOrigin).toEqual([]);
});

test("2. The assistant starts the design: the page follows it on the SAME status card, the composer's start route names the SAME task, and its result reaches the ONE review dialog once", async ({ page, context, baseURL }) => {
  const origin = baseURL!;
  const traffic = watch(page, origin);
  await openFresh(page, context, origin, "1a500002");
  await askAssistant(page, `Generate a schematic: ${BLINKER_ACCEPTANCE_PROMPT}`);
  await expect(page.getByText(START_LINE)).toBeVisible();
  await expect(page.getByText("(fixture agent) the tool answered task_started.")).toBeVisible();
  expect(traffic.starts, "the browser never called the start route: the chat started the task server-side").toEqual([]);
  const card = page.getByTestId("generation-task-status").first();
  await expect(card).toBeVisible({ timeout: 30_000 });
  const pid = traffic.chatProjects[0]!;
  const taskId = (await serverTasks(page, pid)).active?.taskId as string;
  expect(taskId).toMatch(/^generation-task:[0-9a-f]{32}$/);
  await expect(card).toHaveAttribute("data-task-id", taskId); // the card follows the task the assistant started
  // the composer's own start route (the same service) answers the running task: one active task per project
  const second = await page.request.post("/api/generation-tasks", { headers: { ...selector(pid), "content-type": "application/json", origin }, data: { clientRequestId: "00000000-0000-4000-8000-0000000000aa", prompt: BLINKER_ACCEPTANCE_PROMPT, provider: "openai", base: { schematicDigest: "eng1-0123456789abcdef", recipe: "build-pin" } } });
  expect(second.status()).toBe(409);
  expect(((await second.json()) as { code: string; activeTask: { taskId: string; origin: string } })).toMatchObject({ code: "GENERATION_TASK_ACTIVE", activeTask: { taskId, origin: "chat" } });
  // the result: the ONE review dialog, once, with the note that the assistant proposed it
  const review = page.getByTestId("schematic-proposal-review");
  await expect(review).toBeVisible({ timeout: 90_000 });
  await expect(review).toHaveCount(1);
  await expect(page.getByTestId("schematic-proposal-validation")).toContainText(/Proposed by the assistant \(\w+\) for your request/);
  await page.getByTestId("schematic-proposal-approve").click();
  await expect(review).toBeHidden();
  await expect(page.getByTestId("journey-stage-schematic_applied")).toHaveAttribute("data-status", "succeeded", { timeout: 30_000 });
  await expect.poll(async () => (await serverTask(page, pid, taskId)).state, { timeout: 30_000 }).toBe("succeeded");
  const tasks = await serverTasks(page, pid);
  expect(tasks.recent.map((ref) => ref.taskId)).toEqual([taskId]);
  expect(tasks.recent[0]!.origin).toBe("chat");
  expect(traffic.buildMulti).toBe(0);
  expect(traffic.leftOrigin).toEqual([]);
});

test("3. Stop answer ends the streaming turn only - the design keeps working; Stop design cancels the task and no result is offered", async ({ page, context, baseURL }) => {
  const origin = baseURL!;
  const traffic = watch(page, origin);
  await openFresh(page, context, origin, "1a500003");
  await askAssistant(page, `Generate a schematic, then keep answering: ${BLINKER_ACCEPTANCE_PROMPT}`, { wait: false });
  await expect(page.getByText(START_LINE)).toBeVisible({ timeout: 30_000 });
  const stopAnswer = page.getByRole("button", { name: "Stop answer", exact: true });
  await expect(stopAnswer).toBeVisible();
  await stopAnswer.click();
  await expect(page.getByTestId("chat-stop")).toBeHidden({ timeout: 30_000 }); // the turn ended
  await expect(page.getByText(/Stopped by you — the assistant's answer \(Stop answer\) was cancelled\. Stop answer ends the assistant's streaming reply only/)).toBeVisible();
  const card = page.getByTestId("generation-task-status").first();
  await expect(card).toBeVisible();
  const taskId = (await card.getAttribute("data-task-id"))!;
  // the design is still working: not cancelled, Stop design still offered
  expect(["queued", "running", "waiting-for-provider"]).toContain(await card.getAttribute("data-state"));
  const stopDesign = page.getByRole("button", { name: "Stop design", exact: true });
  await expect(stopDesign).toBeVisible();
  expect(traffic.controls, "Stop answer sent nothing to the task").toEqual([]);
  // Stop design cancels the task durably; no result is ever offered
  await stopDesign.click();
  await expect(card).toHaveAttribute("data-state", "cancelled", { timeout: 30_000 });
  expect(traffic.controls).toEqual([{ taskId, action: "cancel" }]);
  expect(await serverTask(page, traffic.chatProjects[0]!, taskId)).toMatchObject({ state: "cancelled", terminal: true, result: null, control: { cancelRequested: true } });
  await page.waitForTimeout(8_000); // well past the fixture design's few seconds
  await expect(page.getByTestId("schematic-proposal-review")).toHaveCount(0);
  expect(traffic.starts).toEqual([]);
  expect(traffic.leftOrigin).toEqual([]);
});
