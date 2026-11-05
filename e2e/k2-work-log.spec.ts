/**
 * [K2, 2026-11-04] Section K, increment K2 (runbook K.2, K.8 item 1; OD-260 items 5, 6 and 8) in a FRESH browser under the fixture
 * runtime (the committed fixture catalog, the fixture CAD source's committed KiCad bytes through the production egress path, the dev
 * server's pump worker on the component-resolution topic, the scripted agent, in-memory stores; no database, provider, embedding or live
 * network). A sheet whose D1 / D2 are placed from the catalog's 1N4001 (no published revision anywhere in the library) is opened as a
 * project file and the assistant is asked "Obtain the assets for D1 and D2.":
 *
 *  1. while the answer is still being written (Stop answer shown, no answer text yet) the activity entry's Work log - collapsed under
 *     "Show details" - already shows the run's real steps: the instance inspection sent and its result received, the acquisition task
 *     started (a dispatch, never "done"), the follow; the default UI stays one summary line;
 *  2. the task's own recorded steps arrive as the worker reports them (the local search, the fixture source used, the bytes received,
 *     stored, validated, waiting for a person) with the fixture source's registry documentation link and the next action;
 *  3. no secret or URL leaks: the Work log's text carries no URL, every link is the CAD registry's documentation, nothing secret-shaped;
 *  4. a reload recovers the stored log (the same rows, collapsed again) and only READS the task again: no chat turn and no acquisition
 *     start is sent after the reload; [K2 review, 2026-11-04] tests-K2-R2: it IS read again (at least once), at the waiting cadence;
 *  5. [K2 review, 2026-11-04] events-K2-EV-1: the task waits for a person and the page still reads it: a person stops it elsewhere (the
 *     page's own control route, not this chat) and the task's recorded step reaches the Work log without a reload; the ended task is
 *     read no more;
 *  6. (test 2) [K2 review, 2026-11-04] tests-K2-R3: a stream that ends without its run's final event (a dropped connection, a canned
 *     NDJSON answer that stops after the run's first steps) - the Work log says the answer ended without it, once, after the steps it
 *     recorded (the page's endRun; Stop answer's ending is l5-chat-task 3's).
 *
 * Fake-backed: it proves the page's Work log contract over fixture evidence - not a live CAD source, model or catalog.
 */
import { createHash } from "node:crypto";
import { expect, test, type BrowserContext, type Page, type Request } from "@playwright/test";
import type { SchematicState } from "../lib/schematic-types";
import { canonicalJson } from "../app/lib/pcb/revision";
import { M2_ACQUISITION_PART_ID } from "../app/lib/fixture-runtime/blinker/catalog";
import { DIMMER_INSTANCE_IDS, fixtureDimmerSheet } from "../app/lib/fixture-runtime/__tests__/_resolution-sheet";
import { CAD_SOURCE_ENTRIES } from "../app/lib/acquisition/cad-source-registry";
import { WORK_LOG_WAITING_POLL_MS } from "../app/components/chat/hooks/useChatWorkLog";
import { actAs, expectHydrated, installDeterministicBrowser } from "./fixture-journey";

test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);

const NOW = Date.parse("2026-11-04T00:00:00.000Z");
const PART = M2_ACQUISITION_PART_ID;
const SHOTS = "artifacts/product-reliability-simple-ui/work-log-and-assets/screenshots";
const ASK = "Obtain the assets for D1 and D2.";
const REGISTRY_DOCS = new Set(CAD_SOURCE_ENTRIES.flatMap((entry) => [...entry.provider.documentation]));

function acquisitionSheet(): SchematicState {
  const sheet = fixtureDimmerSheet();
  return { ...sheet, kicadComponents: (sheet.kicadComponents ?? []).map((instance) => (instance.id === DIMMER_INSTANCE_IDS.D1 || instance.id === DIMMER_INSTANCE_IDS.D2 ? { id: instance.id, partId: PART, x: instance.x, y: instance.y, rotation: instance.rotation, refDes: instance.refDes, value: "1N4001" } : instance)) };
}
function projectFile(projectId: string, name: string, state: SchematicState): { name: string; mimeType: string; buffer: Buffer } {
  const payload = { project: { id: projectId, name, state, createdAt: NOW, updatedAt: NOW, schemaVersion: 2 }, checkpoints: [] };
  const canonical = canonicalJson(payload);
  const envelope = { format: "sirkit-project", formatVersion: 1, exportedAt: new Date(NOW).toISOString(), integrity: `sha256:${createHash("sha256").update(canonical).digest("hex")}`, payload: JSON.parse(canonical) as unknown };
  return { name: `${name}.sirkit.json`, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(envelope)) };
}

interface Traffic { chats: number; starts: number; reads: number; readAt: number[]; leftOrigin: string[] }
function watch(page: Page, origin: string): Traffic {
  const traffic: Traffic = { chats: 0, starts: 0, reads: 0, readAt: [], leftOrigin: [] };
  const host = new URL(origin).hostname;
  page.on("request", (request: Request) => {
    const url = new URL(request.url());
    if (url.hostname !== host && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") traffic.leftOrigin.push(request.url());
    if (url.pathname === "/api/chat" && request.method() === "POST") traffic.chats += 1;
    if (url.pathname === "/api/parts/acquisitions" && request.method() === "POST") traffic.starts += 1;
    if (url.pathname === "/api/parts/acquisitions" && request.method() === "GET" && url.searchParams.has("taskId")) { traffic.reads += 1; traffic.readAt.push(Date.now()); } // [K2 review, 2026-11-04] + when (the reads' cadence)
  });
  return traffic;
}

async function start(page: Page, context: BrowserContext, origin: string, namespace: string): Promise<void> {
  await page.setViewportSize({ width: 1366, height: 768 });
  await installDeterministicBrowser(page, context, namespace);
  await actAs(context, "editor", origin);
  await page.goto("/");
  await expect(page.getByTestId("fixture-runtime-banner")).toBeVisible();
  await expectHydrated(page);
}
async function openChat(page: Page): Promise<void> {
  if ((await page.getByTestId("prompt-input").count()) === 0) await page.getByTestId("activity-ai chat").click();
  await expect(page.getByTestId("prompt-input")).toBeEnabled();
}
/** The stored chat's Work logs (the project record the autosave writes). */
async function storedWorkLogs(page: Page, projectId: string): Promise<Array<{ rows: Array<{ text: string; phase: string; origin: string }> }>> {
  return page.evaluate((key) => {
    const record = JSON.parse(window.localStorage.getItem(key) ?? "null") as { chat?: Array<{ role: string; work?: { rows: Array<{ text: string; phase: string; origin: string }> } }> } | null;
    return (record?.chat ?? []).filter((message) => message.role === "log" && message.work).map((message) => message.work!);
  }, `sirkit:project:${projectId}`);
}
async function noLeak(workLog: ReturnType<Page["getByTestId"]>): Promise<void> {
  const text = await workLog.innerText();
  expect(text).not.toMatch(/https?:\/\/|www\./i);
  const rows = (await workLog.locator('[data-testid="work-log-row"]').allInnerTexts()).join("\n"); // the rows (the footer names what they are not)
  expect(rows).not.toMatch(/\bsk-[A-Za-z0-9_-]{8,}|Bearer\s+\S{8,}|X-Amz-|api[_-]?key|password|reasoning|encrypted|system prompt/i);
  for (const href of await workLog.locator("a").evaluateAll((anchors) => anchors.map((anchor) => anchor.getAttribute("href") ?? ""))) expect(REGISTRY_DOCS.has(href), href).toBe(true);
}

test("the Work log: live rows before the final answer, collapsed under Show details, the task's recorded steps with registry links, no leak, and a reload that recovers the stored log without replaying anything", async ({ page, context, baseURL }) => {
  const origin = baseURL!;
  const projectId = "k2-work-log-0001";
  const traffic = watch(page, origin);
  await start(page, context, origin, "4b200001");
  await page.locator('input[type="file"][accept*=".sirkit.json"]').setInputFiles(projectFile(projectId, "Work log K2", acquisitionSheet()));
  await expect(page.getByRole("button", { name: /Work log K2/ })).toBeVisible({ timeout: 30_000 });
  await openChat(page);

  // 1. ask; while the answer is still being written, the Work log shows the run's real steps
  await page.getByTestId("prompt-input").fill(ASK);
  if ((await page.getByTestId("composer-route").getAttribute("data-route")) !== "ask") await page.getByTestId("composer-route-override").click();
  await expect(page.getByTestId("composer-route")).toHaveAttribute("data-route", "ask");
  await page.getByTestId("composer-submit").click();
  const workLog = page.getByTestId("work-log").last();
  await expect(workLog).toBeVisible({ timeout: 60_000 });
  await expect(workLog).toHaveAttribute("data-expanded", "false"); // quiet by default: one summary line
  await expect(page.getByTestId("work-log-row")).toHaveCount(0);
  await expect(workLog.getByTestId("work-log-summary")).toContainText(/\d+ steps? · latest: /);
  await expect(page.getByText(/acquisition task started — a worker runs it in saved steps/).first()).toBeVisible({ timeout: 60_000 }); // the entry's plain row: the start answered
  await expect(page.getByTestId("chat-stop")).toBeVisible(); // the answer is still being written
  await expect(page.getByText(/\(fixture agent\) acquisition task/)).toHaveCount(0);
  await workLog.getByTestId("work-log-toggle").click();
  await expect(workLog).toHaveAttribute("data-expanded", "true");
  const runRows = workLog.locator('[data-testid="work-log-row"][data-origin="run"]');
  await expect(runRows.filter({ hasText: "Inspecting the unresolved instances" })).toHaveAttribute("data-phase", "dispatched");
  await expect(runRows.filter({ hasText: /acquisition task started — a worker runs it in saved steps; nothing in the design changed/ })).toHaveAttribute("data-phase", "dispatched");
  await expect(workLog.locator('[data-testid="work-log-row"][data-origin="page"]').filter({ hasText: "Following acquisition task" })).toHaveAttribute("data-phase", "waiting");
  await expect(page.getByTestId("chat-stop")).toBeVisible(); // still before the final answer
  await expect(page.getByText(/\(fixture agent\) acquisition task/)).toHaveCount(0);
  await noLeak(workLog);
  await workLog.getByTestId("work-log-details").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/k2-work-log-live-before-answer-1366x768.png` });

  // 2. the final answer comes after; the task's own recorded steps arrive as the worker reports them
  await expect(page.getByText(/\(fixture agent\) acquisition task cr-task:[0-9a-f]{32}: /)).toBeVisible({ timeout: 60_000 });
  const taskId = /(cr-task:[0-9a-f]{32})/.exec(await page.getByText(/\(fixture agent\) acquisition task cr-task:[0-9a-f]{32}: /).first().innerText())![1]!; // [K2 review, 2026-11-04] for step 5
  await expect(page.getByTestId("chat-stop")).toBeHidden({ timeout: 30_000 });
  const taskRows = (phase: string) => workLog.locator(`[data-testid="work-log-row"][data-origin="acquisition"][data-phase="${phase}"]`);
  await expect(taskRows("validated").first()).toBeVisible({ timeout: 180_000 });
  await expect(taskRows("waiting").last()).toContainText("Next: Send the package for component review", { timeout: 60_000 });
  for (const phase of ["dispatched", "received", "stored", "validated", "waiting"]) await expect(taskRows(phase).first(), phase).toBeVisible();
  await expect(workLog.getByTestId("work-log-source").first()).toBeVisible();
  await noLeak(workLog);
  await expect(workLog).toHaveAttribute("data-run", "completed");
  const before = await workLog.locator('[data-testid="work-log-row"]').allInnerTexts();
  expect(before.length).toBeGreaterThanOrEqual(8);
  await workLog.getByTestId("work-log-details").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/k2-work-log-task-steps-1366x768.png` });

  // 3. the stored log is written with the project (the autosave), then a reload recovers it and only READS the task again
  await expect.poll(async () => (await storedWorkLogs(page, projectId)).reduce((count, log) => Math.max(count, log.rows.length), 0), { timeout: 30_000 }).toBe(before.length);
  const chatsBefore = traffic.chats, startsBefore = traffic.starts;
  const navigated = page.waitForEvent("framenavigated", (frame) => frame === page.mainFrame()).then(() => Date.now());
  await page.reload();
  const reloaded = await navigated; // the new document committed: the page before the reload runs nothing more, so every read from here is the restored page's
  await expect(page.getByTestId("fixture-runtime-banner")).toBeVisible();
  await expect(page.getByRole("button", { name: /Work log K2/ })).toBeVisible({ timeout: 120_000 });
  await openChat(page);
  const restored = page.getByTestId("work-log").last();
  await expect(restored).toBeVisible({ timeout: 30_000 });
  await expect(restored).toHaveAttribute("data-expanded", "false");
  await restored.getByTestId("work-log-toggle").click();
  await expect.poll(async () => (await restored.locator('[data-testid="work-log-row"]').allInnerTexts()).slice(0, before.length), { timeout: 30_000 }).toEqual(before);
  await expect(restored).toHaveAttribute("data-run", "completed"); // the turn had ended: nothing says interrupted
  await noLeak(restored);
  await page.waitForTimeout(3_000);
  expect(traffic.chats, "no chat turn is replayed after the reload").toBe(chatsBefore);
  expect(traffic.starts, "no acquisition is started again").toBe(startsBefore);
  // [K2 review, 2026-11-04] tests-K2-R2, reviewed pin move: was `traffic.reads - readsBefore <= 2` with no lower bound - zero reads passed,
  // so a broken re-follow shipped green. The restored follow READS the task again (at least once) and, the task waiting for a person, at
  // the waiting cadence (events-K2-EV-1: a waiting task is read every WORK_LOG_WAITING_POLL_MS, never dropped, never faster)
  const afterReload = traffic.readAt.filter((at) => at >= reloaded);
  expect(afterReload.length, "the restored follow reads the task again").toBeGreaterThanOrEqual(1);
  expect(afterReload.length, "a bounded number of times: the waiting cadence").toBeLessThanOrEqual(1 + Math.ceil((Date.now() - afterReload[0]!) / WORK_LOG_WAITING_POLL_MS));
  for (let at = 1; at < afterReload.length; at += 1) expect(afterReload[at]! - afterReload[at - 1]!, "never faster than the waiting cadence").toBeGreaterThanOrEqual(WORK_LOG_WAITING_POLL_MS - 1_000);
  await restored.getByTestId("work-log-details").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/k2-work-log-after-reload-1366x768.png` });

  // 5. [K2 review, 2026-11-04] events-K2-EV-1: the task waits for a PERSON and the page still reads it - a person stops it elsewhere (the
  //    page's own control route, as another tab would; never this chat) and the task's own recorded step reaches the Work log, no reload
  const stoppedElsewhere = await page.request.post("/api/parts/acquisitions", { headers: { "x-sirkit-tenant-id": "local", "x-sirkit-project-id": projectId, "x-sirkit-branch-id": "main", "content-type": "application/json", origin }, data: { operation: "control", taskId, action: "cancel", clientActionId: "cancel:k2-review-0001" } });
  expect(stoppedElsewhere.status()).toBe(200);
  const cancelledRow = restored.locator('[data-testid="work-log-row"][data-origin="acquisition"][data-phase="cancelled"]');
  await expect(cancelledRow).toHaveText(/The acquisition was stopped; the stored objects and the candidate are kept\./, { timeout: WORK_LOG_WAITING_POLL_MS + 15_000 });
  await expect(restored.getByTestId("work-log-summary")).toContainText("latest: Stopped (acquisition task)");
  const readsAtEnd = traffic.reads;
  await page.waitForTimeout(WORK_LOG_WAITING_POLL_MS + 2_000);
  expect(traffic.reads, "an ended task is read no more").toBe(readsAtEnd);
  expect(traffic.chats).toBe(chatsBefore);
  expect(traffic.starts).toBe(startsBefore);
  expect(traffic.leftOrigin).toEqual([]);
});

test("2. [K2 review] a stream that ends without its run's final event: the Work log says the answer ended without it, once, after the steps it recorded", async ({ page, context, baseURL }) => {
  const origin = baseURL!;
  const traffic = watch(page, origin);
  await start(page, context, origin, "4b200002");
  await page.locator('input[type="file"][accept*=".sirkit.json"]').setInputFiles(projectFile("k2-work-log-0002", "Work log K2 dropped", acquisitionSheet()));
  await expect(page.getByRole("button", { name: /Work log K2 dropped/ })).toBeVisible({ timeout: 30_000 });
  await openChat(page);
  // the chat route's answer is canned: the run's first steps, then the stream simply ends (no run_completed, no run_failed) - a dropped
  // connection as the page sees it; nothing reaches the server's chat route
  const runId = "run-k2-dropped-0001";
  const inspect = { callId: "c1", toolId: "sirkit.schematic.instance-inspect", title: "Inspect schematic instances", tier: 0 };
  const lines = [
    { v: 1, seq: 1, type: "run_started", runId, provider: "openai" },
    { v: 1, seq: 2, type: "tool_started", runId, ...inspect },
    { v: 1, seq: 3, type: "tool_finished", runId, ...inspect, ok: true, status: "succeeded" },
  ];
  await page.route("**/api/chat", async (route) => {
    if (route.request().method() !== "POST") { await route.continue(); return; }
    await route.fulfill({ status: 200, headers: { "content-type": "application/x-ndjson; charset=utf-8", "x-sirkit-run-id": runId, "cache-control": "no-store" }, body: `${lines.map((line) => JSON.stringify(line)).join("\n")}\n` });
  });
  await page.getByTestId("prompt-input").fill("Status.");
  if ((await page.getByTestId("composer-route").getAttribute("data-route")) !== "ask") await page.getByTestId("composer-route-override").click();
  await expect(page.getByTestId("composer-route")).toHaveAttribute("data-route", "ask");
  await page.getByTestId("composer-submit").click();
  await expect(page.getByTestId("chat-stop")).toBeHidden({ timeout: 60_000 });
  const workLog = page.getByTestId("work-log").last();
  await expect(workLog).toHaveAttribute("data-run", "interrupted", { timeout: 30_000 });
  await workLog.getByTestId("work-log-toggle").click();
  const rows = workLog.locator('[data-testid="work-log-row"]');
  await expect(rows).toHaveCount(3);
  expect(await rows.evaluateAll((items) => items.map((item) => `${item.getAttribute("data-origin")}:${item.getAttribute("data-phase")}`))).toEqual(["run:dispatched", "run:received", "page:interrupted"]);
  await expect(rows.last()).toContainText("The answer ended without its final event (the connection dropped or the request failed)");
  await expect(rows.last()).toContainText("Next: Send the message again, or ask the assistant to continue");
  await expect(workLog.getByTestId("work-log-summary")).toHaveText("3 steps · latest: Interrupted (this page)");
  await page.unroute("**/api/chat");
  expect(traffic.leftOrigin).toEqual([]);
});
