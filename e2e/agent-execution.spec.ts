/**
 * [B18-C I10b] Browser proof of granted AI execution against the REAL application: the fixture runtime and the SCRIPTED
 * agent (never a model — app/lib/agent/fixture-agent-adapter.ts), so every authority check runs for real: the loop, the
 * gateway, the seal, the minter, the grant store, the page's SAFE receiver, the PCB editor's granted-execution ritual and
 * the server settle.
 *
 *  1. proposal_only (the default): "Move R3 2 mm to the right." with R3 selected → the confirmation card shows the exact
 *     change and nothing changes until Confirm; Confirm commits ONE canonical transaction (the toast, the editor's Undo
 *     names it, the project timeline lists it, the next chat snapshot carries R3 moved).
 *  2. An administrator opts the project into execute_explicit_tier1 (compare-and-set on the setting revision; an editor is
 *     refused); an explicit move and an explicit flip then execute without a card and settle back to the chat.
 *  3. A silkscreen add (no explicit grammar → the card) is confirmed; "Undo that." undoes it; after a RELOAD "Redo."
 *     re-applies it — the replay reference is resolved from the durable records, never the page's memory.
 *  4. A grant altered in transit (the chat stream rewritten) is dropped by the page's SAFE receiver: no card, no change.
 *
 * The board is read from the editor-context snapshot every chat request carries (the PCB editor's exact working copy,
 * which the server revalidates); "Status." is a plain turn that only captures it. The composer sends a message beginning
 * with "add" to the SCHEMATIC editor (`inferComposerAction`), so the silkscreen instruction begins with "Please" — recorded
 * for B18-D's chat execution UX.
 */
import { mkdirSync } from "node:fs";
import { expect, test, type BrowserContext, type Page, type Request } from "@playwright/test";
import { bootstrapSynchronizedBoard, reloadAs } from "./fixture-journey";

test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);

const EVIDENCE = "artifacts/ai-control-plane-b18/evidence";
const NM_PER_MM = 1_000_000;

interface Footprint { id: string; ref: string; at: { x: number; y: number }; side: "top" | "bottom" }
interface SilkItem { kind: string; text?: string }
interface Board { footprints: Footprint[]; silkItems: SilkItem[] }
interface ChatBody { scope: { tenantId: string; projectId: string; branchId: string }; editorContext?: { board: { footprints: Footprint[]; silkItems?: SilkItem[] } } }

let context: BrowserContext;
let page: Page;
let origin: string;
const chatBodies: ChatBody[] = [];
/** Every execution-grant route exchange (request and response bodies) and every console error — attached on failure. */
const grantLog: Array<{ url: string; status: number; request: unknown; response: unknown }> = [];
const consoleErrors: string[] = [];
/** Every outcome notice the editor showed, in order, across reloads (reported by the page through a binding). */
const noticeLog: string[] = [];

test.beforeAll(async ({ browser, baseURL }) => {
  origin = baseURL!;
  context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  page = await context.newPage();
  page.on("request", (request: Request) => {
    if (request.method() !== "POST" || new URL(request.url()).pathname !== "/api/chat") return;
    try { chatBodies.push(request.postDataJSON() as ChatBody); } catch { /* not JSON */ }
  });
  page.on("response", async (response) => {
    if (!response.url().includes("/api/agent/execution-grant")) return;
    let request: unknown = null;
    try { request = response.request().postDataJSON(); } catch { /* no body */ }
    grantLog.push({ url: new URL(response.url()).pathname, status: response.status(), request, response: await response.json().catch(() => null) });
  });
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text().slice(0, 400)); });
  // The editor's outcome notice is transient (it clears after 6 s and a later notice replaces it): record every one shown,
  // in order, on every document the page loads, and report it to the test (the log survives reloads).
  await context.exposeBinding("__sirkitNotice", (_source, text: string) => { noticeLog.push(text); });
  await context.addInitScript(() => {
    const seen: string[] = [];
    const host = window as unknown as { __sirkitNotices: string[]; __sirkitNotice?: (text: string) => void };
    host.__sirkitNotices = seen;
    const note = (text: string | null | undefined): void => {
      const value = (text ?? "").trim();
      if (value.length > 0 && value.length < 600 && /^(AI change|AI execution recovery|This AI change)/.test(value) && seen.at(-1) !== value) {
        seen.push(value);
        void host.__sirkitNotice?.(value);
      }
    };
    const observe = (): void => {
      new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === "characterData") note(mutation.target.parentElement?.textContent);
          for (const node of Array.from(mutation.addedNodes)) note(node.textContent);
        }
      }).observe(document.documentElement, { subtree: true, childList: true, characterData: true });
    };
    if (document.documentElement) observe(); else document.addEventListener("DOMContentLoaded", observe, { once: true });
  });
  await bootstrapSynchronizedBoard(page, context, origin, "b18c0000");
  mkdirSync(EVIDENCE, { recursive: true });
});

test.afterAll(async () => { await context.close(); });

test.afterEach(async ({}, testInfo) => {
  await testInfo.attach("editor-notices.json", { body: JSON.stringify(noticeLog, null, 2), contentType: "application/json" });
  if (testInfo.status === testInfo.expectedStatus) return;
  await testInfo.attach("execution-grant-exchanges.json", { body: JSON.stringify(grantLog, null, 2), contentType: "application/json" });
  await testInfo.attach("console-errors.json", { body: JSON.stringify(consoleErrors, null, 2), contentType: "application/json" });
});

/** Every outcome notice the editor showed, in order, across reloads. */
const notices = (): string[] => [...noticeLog];

async function openChat(): Promise<void> {
  const prompt = page.getByTestId("prompt-input");
  if (!(await prompt.isVisible())) await page.getByTestId("activity-ai chat").click();
  await expect(prompt).toBeVisible();
}

/** One chat turn: waits until the scripted agent's closing reply lands; returns the request body (its editor context is
 *  the board BEFORE this turn's change). */
async function chat(text: string): Promise<ChatBody> {
  await openChat();
  const replies = page.getByText(/^\(fixture agent\) /);
  const before = await replies.count();
  const sent = chatBodies.length;
  const prompt = page.getByTestId("prompt-input");
  await expect(prompt).toBeEnabled({ timeout: 90_000 });
  await prompt.fill(text);
  await prompt.press("Enter");
  await expect.poll(() => chatBodies.length, { timeout: 30_000 }).toBeGreaterThan(sent);
  await expect.poll(async () => await replies.count(), { timeout: 120_000 }).toBeGreaterThan(before);
  await expect(prompt).toBeEnabled({ timeout: 90_000 });
  return chatBodies[sent]!;
}

/** The PCB editor's exact working copy right now: a plain turn whose request carries it. */
async function board(): Promise<Board> {
  const body = await chat("Status.");
  expect(body.editorContext, "the chat request carries the PCB editor's working copy").toBeTruthy();
  return { footprints: body.editorContext!.board.footprints, silkItems: body.editorContext!.board.silkItems ?? [] };
}

const r3 = (b: Board): Footprint => b.footprints.find((f) => f.ref === "R3")!;
const silkTexts = (b: Board): string[] => b.silkItems.flatMap((item) => (item.kind === "text" && typeof item.text === "string" ? [item.text] : []));
/** An on-board position for new silkscreen text: the footprints' centroid in mm (the scripted grammar takes non-negative mm). */
function centroidMm(b: Board): { x: string; y: string } {
  const x = b.footprints.reduce((sum, f) => sum + f.at.x, 0) / b.footprints.length / NM_PER_MM;
  const y = b.footprints.reduce((sum, f) => sum + f.at.y, 0) / b.footprints.length / NM_PER_MM;
  expect(x).toBeGreaterThanOrEqual(0);
  expect(y).toBeGreaterThanOrEqual(0);
  return { x: x.toFixed(1), y: y.toFixed(1) };
}

function scopeHeaders(): Record<string, string> {
  const scope = chatBodies.at(-1)!.scope;
  return { "content-type": "application/json", origin, "x-sirkit-tenant-id": scope.tenantId, "x-sirkit-project-id": scope.projectId, "x-sirkit-branch-id": scope.branchId };
}

/** Go to <ref> — the editor's own pcb.select + pcb.focus; the scripted agent reads its target from this selection. */
async function select(ref: string): Promise<void> {
  await page.getByTestId("pcb-goto-input").fill(ref);
  await page.getByTestId("pcb-goto").click();
  await expect.poll(async () => JSON.parse((await page.getByTestId("pcb-editor").getAttribute("data-view")) ?? "{}").selection?.primary?.kind).toBe("footprint");
}

const committedLines = () => page.getByText(/AI change committed by your editor \(one canonical transaction/);

test("B18-C preview: under proposal_only an AI move is shown on the confirmation card and changes nothing until Confirm; Confirm commits ONE canonical transaction", async () => {
  const start = await board();
  const x0 = r3(start).at.x;
  const autonomy = await page.request.get("/api/agent/autonomy", { headers: scopeHeaders() });
  expect(await autonomy.json()).toMatchObject({ ok: true, setting: { mode: "proposal_only" } });

  await select("R3");
  await chat("Move R3 2 mm to the right.");
  const card = page.getByTestId("granted-execution-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText("pcb.move-footprint, 1 operation");
  await expect(card).toContainText("Nothing has been changed yet.");
  await expect(page.getByTestId("granted-execution-preview")).toContainText("R3 at (");
  await expect(page.getByText(/Change ready for your confirmation in the PCB editor — R3 at/)).toBeVisible();
  await expect(page.getByTitle(/^Undo: AI: /)).toHaveCount(0); // the card is a preview: no AI entry exists yet
  await page.screenshot({ path: `${EVIDENCE}/granted-preview-card.png`, fullPage: false });

  await page.getByTestId("granted-execution-confirm").click();
  await expect(card).toBeHidden();
  // The editor's own outcome notice (transient: it clears after 6 s, so its recorded history is read, not one poll).
  await expect.poll(notices, { timeout: 30_000 }).toEqual(expect.arrayContaining([expect.stringMatching(/^AI change made as ONE canonical transaction/)]));
  await expect(page.getByTitle(/^Undo: AI: R3 at/)).toBeVisible(); // ONE history entry, labelled as the AI's

  await page.getByRole("button", { name: "Revision history" }).click();
  const aiEntries = page.getByTestId("project-timeline-entry").filter({ hasText: "AI: R3 at" });
  await expect(aiEntries).toHaveCount(1);
  await expect(aiEntries.first()).toHaveAttribute("data-store", "pcb");
  await expect(aiEntries.first()).toHaveAttribute("data-kind", "commit");
  await page.keyboard.press("Escape");

  expect(r3(await board()).at.x).toBe(x0 + 2 * NM_PER_MM);
  // The editor's crash-recovery sweep never adopts the page's own in-flight execution (found here; I10b).
  expect(notices().filter((notice) => notice.startsWith("AI execution recovery")), "a normal execution is never reported as a recovery").toEqual([]);
});

test("B18-C explicit: an administrator opts the project into execute_explicit_tier1 (an editor may not); an explicit move and an explicit flip execute without a card and settle back to the chat", async ({ playwright }) => {
  // The cookie-less local principal is the project administrator; the role cookie selects the fixture editor.
  const admin = await playwright.request.newContext({ baseURL: origin });
  const editor = await playwright.request.newContext({ baseURL: origin, extraHTTPHeaders: { cookie: "sirkit-fixture-role=editor" } });
  try {
    const read = (await (await admin.get("/api/agent/autonomy", { headers: scopeHeaders() })).json()) as { setting: { mode: string; revision: number } };
    expect(read.setting.mode).toBe("proposal_only");
    const refused = await editor.post("/api/agent/autonomy", { headers: scopeHeaders(), data: { mode: "execute_explicit_tier1", expectedRevision: read.setting.revision } });
    expect(refused.status()).toBe(403);
    const changed = await admin.post("/api/agent/autonomy", { headers: scopeHeaders(), data: { mode: "execute_explicit_tier1", expectedRevision: read.setting.revision } });
    expect(changed.status()).toBe(200);
    expect(await changed.json()).toMatchObject({ ok: true, setting: { mode: "execute_explicit_tier1", revision: read.setting.revision + 1 } });
  } finally {
    await admin.dispose();
    await editor.dispose();
  }

  const start = await board();
  const x0 = r3(start).at.x;
  const before = await committedLines().count();
  await select("R3");
  await chat("Move R3 1 mm to the left.");
  await expect(committedLines()).toHaveCount(before + 1);
  await expect(page.getByTestId("granted-execution-card")).toBeHidden();
  await select("R3");
  await chat("Flip R3 to the bottom.");
  await expect(committedLines()).toHaveCount(before + 2);
  await expect(page.getByTestId("granted-execution-card")).toBeHidden();
  await page.screenshot({ path: `${EVIDENCE}/explicit-executions-committed.png`, fullPage: false });

  const after = r3(await board());
  expect(after.at.x).toBe(x0 - NM_PER_MM);
  expect(after.side).toBe("bottom");
});

test("B18-C silkscreen add with the card; 'Undo that.' undoes it; after a RELOAD 'Redo.' re-applies it from the durable records", async () => {
  const start = await board();
  const at = centroidMm(start);
  expect(silkTexts(start)).not.toContain("REV B");
  await chat(`Please add silkscreen text REV B at ${at.x}, ${at.y}.`);
  const card = page.getByTestId("granted-execution-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText("pcb.silkscreen-text");
  await expect(page.getByTestId("granted-execution-preview")).toContainText("REV B");
  await page.getByTestId("granted-execution-confirm").click();
  await expect(card).toBeHidden();
  await expect(page.getByTitle(/^Undo: AI: .*REV B/)).toBeVisible();
  expect(silkTexts(await board())).toContain("REV B");

  const before = await committedLines().count();
  await chat("Undo that.");
  await expect(committedLines()).toHaveCount(before + 1);
  await expect(page.getByTitle(/^Undo: AI: undo — /)).toBeVisible(); // the replay is a NEW history entry naming its direction
  expect(silkTexts(await board())).not.toContain("REV B");
  await page.screenshot({ path: `${EVIDENCE}/ai-undo-committed.png`, fullPage: false });

  // RELOAD: the page's memory is gone; the redo reference comes from the durable grant records and the canonical head.
  const committedBeforeReload = await committedLines().count();
  await reloadAs(page, context, "editor", origin, true);
  await openChat();
  await expect(committedLines()).toHaveCount(committedBeforeReload); // the chat log is restored after the page loads
  await chat("Redo.");
  await expect(committedLines()).toHaveCount(committedBeforeReload + 1);
  await expect(page.getByText(/^\(fixture agent\) the tool answered /).last()).toHaveText("(fixture agent) the tool answered executed.");
  await expect(page.getByTitle(/^Undo: AI: redo — /)).toBeVisible();
  expect(silkTexts(await board())).toContain("REV B");
  expect(notices().filter((notice) => notice.startsWith("AI execution recovery")), "the first execution after a reload is never reported as a recovery").toEqual([]);
});

test("B18-C a grant altered in transit is dropped by the page's SAFE receiver: no card, nothing changed", async () => {
  const start = await board();
  const at = centroidMm(start);
  let rewritten = 0;
  await page.route("**/api/chat", async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).split("\n").map((line) => {
      if (!line.includes("\"execution_grant_ready\"")) return line;
      const event = JSON.parse(line) as { grant: { binding: { proposal: { preview: { after: string } } } } };
      event.grant.binding.proposal.preview.after = "(nothing at all)"; // what the human would be shown, forged
      rewritten += 1;
      return JSON.stringify(event);
    }).join("\n");
    await route.fulfill({ response, body });
  });
  try {
    await chat(`Please add silkscreen text FORGED at ${at.x}, ${at.y}.`);
  } finally {
    await page.unroute("**/api/chat");
  }
  expect(rewritten).toBe(1);
  await expect(page.getByText(/the tool answered execution_preview_issued/).last()).toBeVisible();
  await expect(page.getByTestId("granted-execution-card")).toBeHidden();
  await expect(page.getByText(/Change ready for your confirmation in the PCB editor — \(nothing at all\)/)).toHaveCount(0);
  await page.screenshot({ path: `${EVIDENCE}/forged-grant-dropped.png`, fullPage: false });

  const after = await board();
  expect(silkTexts(after)).not.toContain("FORGED");
  expect(silkTexts(after)).toEqual(silkTexts(start));
  expect(r3(after)).toEqual(r3(start));
});
