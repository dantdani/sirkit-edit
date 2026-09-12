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
 * which the server revalidates); "Status." is a plain turn that only captures it. [B18-D I1] The composer routes a PCB
 * change phrased as an edit ("Add silkscreen text …") to the assistant (`routeComposerMessage`); the route is shown before
 * sending and the user can override it.
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
interface ChatBody { scope: { tenantId: string; projectId: string; branchId: string }; messages?: Array<{ role: string; content: string }>; editorContext?: { board: { footprints: Footprint[]; silkItems?: SilkItem[] } } }

let context: BrowserContext;
let page: Page;
let origin: string;
const chatBodies: ChatBody[] = [];
/** Every execution-grant route exchange (request and response bodies) and every console error — attached on failure. */
const grantLog: Array<{ url: string; status: number; request: unknown; response: unknown }> = [];
const consoleErrors: string[] = [];
/** Every outcome notice the editor showed, in order, across reloads (reported by the page through a binding). */
const noticeLog: string[] = [];
/** [B18-D S5] every appearance of the scripted agent's interim text, with the chat's execution-entry states at that moment. */
const interimLog: Array<{ text: string; entries: string[] }> = [];

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
  // [B18-D S5] record every appearance of the scripted agent's interim text on every document the page loads, with the
  // execution entries' states at that moment (Rule 2 across all flows is asserted by the last test).
  await context.exposeBinding("__sirkitInterim", (_source, record: { text: string; entries: string[] }) => { interimLog.push(record); });
  await context.addInitScript(() => {
    const host = window as unknown as { __sirkitInterim?: (record: { text: string; entries: string[] }) => void };
    const seen = new WeakSet<Element>();
    // [B18-D review 2] every TEXT node is checked (not only leaf elements), so an appearance inside mixed markup — an answer
    // paragraph with a bold word, say — is recorded too; each block is recorded once, with its whole text
    const check = (node: Node): void => {
      const root = node.nodeType === 1 ? (node as Element) : node.parentElement;
      if (!root) return;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let text = walker.nextNode(); text; text = walker.nextNode()) {
        if (!(text.textContent ?? "").includes("(fixture interim)")) continue;
        const block = text.parentElement?.closest("p, li, div, span, pre, td") ?? text.parentElement;
        if (!block || seen.has(block)) continue;
        seen.add(block);
        const entries = Array.from(document.querySelectorAll('[data-testid="chat-execution-entry"]')).map((entry) => entry.getAttribute("data-state") ?? "");
        void host.__sirkitInterim?.({ text: (block.textContent ?? "").slice(0, 300), entries });
      }
    };
    const observe = (): void => {
      new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === "characterData") check(mutation.target);
          for (const node of Array.from(mutation.addedNodes)) check(node);
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
  // [B18-D S5] the preview run's answer opens with its label paragraph: it was written before any change was made.
  await expect(page.getByText("Written before the outcome of this change was confirmed — the entry above is authoritative.").last()).toBeVisible();
  await expect(page.getByTitle(/^Undo: AI: /)).toHaveCount(0); // the card is a preview: no AI entry exists yet
  await page.screenshot({ path: `${EVIDENCE}/granted-preview-card.png`, fullPage: false });

  await page.getByTestId("granted-execution-confirm").click();
  await expect(card).toBeHidden();
  // The editor's own outcome notice (transient: it clears after 6 s, so its recorded history is read, not one poll).
  await expect.poll(notices, { timeout: 30_000 }).toEqual(expect.arrayContaining([expect.stringMatching(/^AI change made as ONE canonical transaction/)]));
  await expect(page.getByTitle(/^Undo: AI: R3 at/)).toBeVisible(); // ONE history entry, labelled as the AI's
  // [B18-D I6] the chat's entry for this grant follows the editor's outcome to "committed".
  await expect(page.getByTestId("chat-execution-entry").last()).toHaveAttribute("data-state", "committed");
  // [B18-D §7] the committed entry names its transaction, the revisions and what the editor's checks said.
  await expect(page.getByTestId("chat-execution-entry").last()).toContainText(/Transaction tx:\S+ · revision pcb2-/);
  await expect(page.getByTestId("chat-execution-entry").last()).toContainText(/design rule check|did not run — no design-rule claim/);

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
  await expect(page.getByTestId("chat-execution-entry").last()).toHaveAttribute("data-state", "committed"); // [B18-D I6]
  await select("R3");
  await chat("Flip R3 to the bottom.");
  await expect(committedLines()).toHaveCount(before + 2);
  await expect(page.getByTestId("granted-execution-card")).toBeHidden();
  await page.screenshot({ path: `${EVIDENCE}/explicit-executions-committed.png`, fullPage: false });

  const after = r3(await board());
  expect(after.at.x).toBe(x0 - NM_PER_MM);
  expect(after.side).toBe("bottom");
  // [B18-D I6] Rule 2 on the page: the scripted agent wrote "(fixture interim) Done — the change is already made." beside each
  // execution call; it appears only as a note once the run ended, and never in an answer or the history a request carries.
  await expect(page.getByText(/^Assistant note \(written before the result\): \(fixture interim\)/).first()).toBeVisible();
  expect(JSON.stringify(chatBodies.at(-1)!.messages ?? [])).not.toContain("(fixture interim)");
});

test("B18-C silkscreen add with the card; 'Undo that.' undoes it; after a RELOAD 'Redo.' re-applies it from the durable records", async () => {
  const start = await board();
  const at = centroidMm(start);
  expect(silkTexts(start)).not.toContain("REV B");
  await chat(`Add silkscreen text REV B at ${at.x}, ${at.y}.`);
  const card = page.getByTestId("granted-execution-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText("pcb.silkscreen-text");
  await expect(page.getByTestId("granted-execution-preview")).toContainText("REV B");
  await page.getByTestId("granted-execution-confirm").click();
  await expect(card).toBeHidden();
  await expect(page.getByTitle(/^Undo: AI: .*REV B/)).toBeVisible();
  await expect(page.getByTestId("chat-execution-entry").last()).toHaveAttribute("data-state", "committed"); // [B18-D §7]
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
  // [B18-D review 2] a reloaded entry is a static record: no live Undo, and its stored text never names the chat's button
  await expect(page.getByTestId("execution-undo")).toHaveCount(0);
  await expect(page.getByText(/“Undo this change”/)).toHaveCount(0);
  // [B18-E E1] the editor's one-step Undo did not survive the reload, and the restored entries say so
  await expect(page.getByTestId("pcb-editor").getByTitle("Nothing to undo")).toBeVisible();
  await expect(page.getByText(/^Undo: after a reload the editor's one-step Undo no longer applies/).first()).toBeVisible();
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
  const entriesBefore = await page.getByTestId("chat-execution-entry").count(); // [B18-D I6]
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
    await chat(`Add silkscreen text FORGED at ${at.x}, ${at.y}.`);
  } finally {
    await page.unroute("**/api/chat");
  }
  expect(rewritten).toBe(1);
  await expect(page.getByTestId("chat-execution-entry")).toHaveCount(entriesBefore); // a dropped grant creates no entry
  await expect(page.getByText(/the tool answered execution_preview_issued/).last()).toBeVisible();
  await expect(page.getByTestId("granted-execution-card")).toBeHidden();
  await expect(page.getByText(/Change ready for your confirmation in the PCB editor — \(nothing at all\)/)).toHaveCount(0);
  // [B18-D review] the dropped grant is said to be dropped, and its tool line never says it is awaiting confirmation
  await expect(page.getByText("An AI change the assistant issued was dropped by this page: it failed the integrity checks. Nothing was changed and there is no card.").last()).toBeVisible();
  await expect(page.getByText(/dropped by this page — it failed the integrity checks; nothing was changed$/).last()).toBeVisible();
  // [B18-D review 2] the answer's label never points at an entry that does not exist
  await expect(page.getByText("Written without knowing that this page dropped the change — nothing was changed; the run log above says why.").last()).toBeVisible();
  await page.screenshot({ path: `${EVIDENCE}/forged-grant-dropped.png`, fullPage: false });

  const after = await board();
  expect(silkTexts(after)).not.toContain("FORGED");
  expect(silkTexts(after)).toEqual(silkTexts(start));
  expect(r3(after)).toEqual(r3(start));
});

test("B18-D I1 composer routing: the route is shown before sending and can be overridden; a PCB change phrased as an edit reaches the assistant", async () => {
  await openChat();
  const prompt = page.getByTestId("prompt-input");
  const routeChip = page.getByTestId("composer-route");
  await prompt.fill("set R1 to 4.7k");
  await expect(routeChip).toHaveAttribute("data-route", "edit");
  await expect(routeChip).toContainText("Sirkit will: edit the schematic");
  await page.getByTestId("composer-route-override").click();
  await expect(routeChip).toHaveAttribute("data-route", "ask");
  await page.getByTestId("composer-route-override").click();
  await expect(routeChip).toHaveAttribute("data-route", "edit");
  await prompt.fill("Draw a dimension from U1 to J1.");
  await expect(routeChip).toHaveAttribute("data-route", "ask");
  await expect(routeChip).toContainText("Sirkit will: ask the assistant");
  await prompt.fill("");
  // Outside the scripted set: the scripted agent's plain reply proves the message reached the assistant (a misroute would
  // never produce a chat request, and this turn would time out).
  await chat("Draw a dimension from U1 to J1.");
  await expect(page.getByTestId("schematic-proposal-review")).toBeHidden();
});

test("B18-D I8 Undo in chat: a committed AI move that is still the latest is undone from its entry — exactly that change, one pcb undo — and a second click is refused", async () => {
  const start = await board();
  const x0 = r3(start).at.x;
  const autonomy = (await (await page.request.get("/api/agent/autonomy", { headers: scopeHeaders() })).json()) as { setting: { mode: string } };
  const before = await committedLines().count();
  await select("R3");
  await chat("Move R3 1 mm to the right.");
  if (autonomy.setting.mode === "proposal_only") await page.getByTestId("granted-execution-confirm").click(); // the card, when the project previews
  await expect(committedLines()).toHaveCount(before + 1);
  const entry = page.getByTestId("chat-execution-entry").last();
  await expect(entry).toHaveAttribute("data-state", "committed");
  expect(r3(await board()).at.x).toBe(x0 + NM_PER_MM);

  const pcbUndos = page.locator('[data-testid="project-timeline-entry"][data-store="pcb"][data-kind="undo"]');
  await page.getByRole("button", { name: "Revision history" }).click();
  const undosBefore = await pcbUndos.count();
  await page.keyboard.press("Escape");

  const undo = entry.getByTestId("execution-undo");
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(entry).toContainText("Undone by you — the editor's own Undo reversed this change (one history step).");
  await expect(undo).toBeDisabled(); // a second click is refused
  await expect(entry.getByTestId("execution-undo-reason")).toHaveText("Already undone — the editor's Redo brings it back.");
  await entry.scrollIntoViewIfNeeded(); // the frame shows the entry itself: its result row and the disabled Undo with its reason
  await page.screenshot({ path: `${EVIDENCE}/chat-undo-entry.png`, fullPage: false });

  await page.getByRole("button", { name: "Revision history" }).click();
  await expect(pcbUndos).toHaveCount(undosBefore + 1);
  await page.keyboard.press("Escape");
  expect(r3(await board()).at.x).toBe(x0); // exactly the AI change reversed
});

test("B18-D I9 Stop: Stop during a chat run cancels it and sends nothing; the chat says it stopped and that an AI change already sent to the editor is reported in its entry", async () => {
  await openChat();
  const prompt = page.getByTestId("prompt-input");
  await expect(prompt).toBeEnabled({ timeout: 90_000 });
  // Hold the next chat request so the run is certainly in progress when Stop is pressed.
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/chat", async (route) => { await held; await route.continue(); }, { times: 1 });
  const sent = chatBodies.length;
  await prompt.fill("Status.");
  await prompt.press("Enter");
  await expect.poll(() => chatBodies.length, { timeout: 30_000 }).toBeGreaterThan(sent);
  const stop = page.getByTestId("chat-stop");
  await expect(stop).toBeVisible();
  const requests = chatBodies.length;
  await stop.click();
  release(); // the held request reaches the server; the page cancels its reader as soon as the response arrives
  await expect(page.getByText("Stopped. An AI change already sent to your editor is reported in its entry: made, or not made.").last()).toBeVisible();
  await expect(stop).toBeHidden();
  await expect(prompt).toBeEnabled();
  expect(chatBodies.length, "Stop sends nothing").toBe(requests);
  await page.screenshot({ path: `${EVIDENCE}/chat-stop.png`, fullPage: false });
});

test("B18-D I11 the agent autonomy in the chat: the editor sees the mode and why it is locked; the administrator changes it through the control (compare-and-set) and back", async () => {
  await openChat();
  const control = page.getByTestId("autonomy-control");
  const select = page.getByTestId("autonomy-mode");
  // [B18-D review] §1 item 3: the chat header states the Tier 3 boundary for every message, not only when a word matches
  await expect(page.getByTestId("chat-tier3-line")).toHaveText("Release, qualification and ordering are never done by the assistant — use the release workflow.");
  // The page is the fixture editor here (the bootstrap ends as the editor): the mode and what it means, locked, with the reason.
  await expect(control).toHaveAttribute("data-mode", "execute_explicit_tier1");
  await expect(select).toBeDisabled();
  await expect(page.getByTestId("autonomy-note")).toHaveText("An exact request for a reversible Tier 1 edit runs without the card; everything else still asks. Only a project administrator can change this.");
  await expect(page.getByTestId("autonomy-change")).toHaveCount(0);
  const setting = async (): Promise<{ mode: string; revision: number }> => ((await (await page.request.get("/api/agent/autonomy", { headers: scopeHeaders() })).json()) as { setting: { mode: string; revision: number } }).setting;
  const before = await setting();
  expect(before.mode).toBe("execute_explicit_tier1");
  const committedBefore = await committedLines().count();
  const entriesBefore = await page.getByTestId("chat-execution-entry").count();

  // The administrator changes it through the control, then back, so the scenarios that follow keep their mode.
  await reloadAs(page, context, "admin", origin, true);
  await openChat();
  await expect(control).toHaveAttribute("data-mode", "execute_explicit_tier1");
  await expect(select).toBeEnabled();
  await select.selectOption("proposal_only");
  await page.getByTestId("autonomy-change").click();
  await expect(control).toHaveAttribute("data-mode", "proposal_only");
  await expect(page.getByTestId("autonomy-notice")).toHaveText(`Changed to Proposal only (revision ${before.revision + 1}).`);
  expect(await setting()).toMatchObject({ mode: "proposal_only", revision: before.revision + 1 });
  await page.screenshot({ path: `${EVIDENCE}/autonomy-control-changed.png`, fullPage: false });
  await select.selectOption("execute_explicit_tier1");
  await page.getByTestId("autonomy-change").click();
  await expect(control).toHaveAttribute("data-mode", "execute_explicit_tier1");
  expect(await setting()).toMatchObject({ mode: "execute_explicit_tier1", revision: before.revision + 2 });

  // Back to the editor for the scenarios that follow; the chat log is restored after the page loads.
  await reloadAs(page, context, "editor", origin, true);
  await openChat();
  await expect(committedLines()).toHaveCount(committedBefore);
  await expect(page.getByTestId("chat-execution-entry")).toHaveCount(entriesBefore);
});

test("B18-D card Cancel: Cancel on the confirmation card changes nothing, and the entry says so", async () => {
  const start = await board();
  const at = centroidMm(start);
  await chat(`Add silkscreen text CANCELLED at ${at.x}, ${at.y}.`);
  const card = page.getByTestId("granted-execution-card");
  await expect(card).toBeVisible();
  await page.getByRole("button", { name: "Cancel — change nothing" }).click();
  await expect(card).toBeHidden();
  const entry = page.getByTestId("chat-execution-entry").last();
  await expect(entry).toHaveAttribute("data-state", "cancelled");
  await expect(entry).toContainText("Cancelled — nothing was changed.");
  await entry.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${EVIDENCE}/card-cancelled-entry.png`, fullPage: false });
  expect(silkTexts(await board())).toEqual(silkTexts(start));
});

test("B18-D P2: while an AI change is being made the editor's Undo and Redo wait — the toolbar Undo is disabled and Ctrl+Z says why; afterwards ONE commit and the earlier entry intact", async () => {
  const start = await board();
  const x0 = r3(start).at.x;
  const before = await committedLines().count();
  const entries = page.getByTestId("chat-execution-entry");
  const entriesBefore = await entries.count();
  const priorState = entriesBefore > 0 ? await entries.nth(entriesBefore - 1).getAttribute("data-state") : null;
  // Hold the editor's tender (the grant's consume POST): the ritual takes the history hold before it tenders.
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let tenders = 0;
  const isTender = (url: URL): boolean => url.pathname === "/api/agent/execution-grant";
  await page.route(isTender, async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    tenders += 1;
    await held;
    await route.fallback();
  });
  try {
    await select("R3");
    await openChat();
    const prompt = page.getByTestId("prompt-input");
    await expect(prompt).toBeEnabled({ timeout: 90_000 });
    // A fresh instruction: the minter asks for confirmation before repeating an instruction identical to one already
    // executed (scenario 2 moved R3 1 mm to the left), and this check needs the explicit path, where the editor tenders at once.
    await prompt.fill("Move R3 3 mm to the left.");
    await prompt.press("Enter");
    await expect.poll(() => tenders, { timeout: 60_000 }).toBe(1);
    // [B18-D review] the disabled toolbar Undo and Redo name the hold's reason
    const paused = page.getByTestId("pcb-editor").locator('button[title="Undo and redo are paused: an AI change is being made"]');
    await expect(paused).toHaveCount(2);
    await expect(paused.first()).toBeDisabled();
    await expect(paused.last()).toBeDisabled();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()); // the editor's Ctrl+Z ignores editable targets
    await page.keyboard.press("Control+z");
    await expect(page.getByText("Undo and redo are paused: an AI change is being made. Try again when it finishes.")).toBeVisible();
    await page.screenshot({ path: `${EVIDENCE}/undo-paused-during-ai-change.png`, fullPage: false });
  } finally {
    release();
  }
  await expect(committedLines()).toHaveCount(before + 1);
  await page.unroute(isTender);
  await expect(entries).toHaveCount(entriesBefore + 1);
  await expect(entries.last()).toHaveAttribute("data-state", "committed");
  if (priorState !== null) await expect(entries.nth(entriesBefore - 1)).toHaveAttribute("data-state", priorState);
  await expect(page.getByTestId("prompt-input")).toBeEnabled({ timeout: 90_000 });
  expect(r3(await board()).at.x).toBe(x0 - 3 * NM_PER_MM); // committed once; the refused Ctrl+Z changed nothing
});

test("B18-D review: a preview replaced by a newer one says so, and only the newer card remains", async () => {
  const start = await board();
  const at = centroidMm(start);
  await chat(`Add silkscreen text FIRST at ${at.x}, ${at.y}.`);
  await expect(page.getByTestId("granted-execution-card")).toBeVisible();
  const firstId = await page.getByTestId("chat-execution-entry").last().getAttribute("data-grant-id");
  expect(firstId).toBeTruthy();
  const first = page.locator(`[data-testid="chat-execution-entry"][data-grant-id="${firstId}"]`);
  await expect(first).toHaveAttribute("data-state", "awaiting_confirmation");
  await chat(`Add silkscreen text SECOND at ${at.x}, ${at.y}.`);
  await expect(first).toHaveAttribute("data-state", "superseded");
  await expect(page.getByTestId("granted-execution-preview")).toContainText("SECOND");
  await page.getByRole("button", { name: "Cancel — change nothing" }).click();
  await expect(page.getByTestId("granted-execution-card")).toBeHidden();
  expect(silkTexts(await board())).toEqual(silkTexts(start));
});

test("B18-D review 2: a Confirm refused for a transient reason (its tender never reached the server) keeps the card; the entry says the attempt changed nothing and nothing is paused; a retry commits", async () => {
  const start = await board();
  const at = centroidMm(start);
  await chat(`Add silkscreen text RETRY at ${at.x}, ${at.y}.`);
  const card = page.getByTestId("granted-execution-card");
  await expect(card).toBeVisible();
  const grantId = await page.getByTestId("chat-execution-entry").last().getAttribute("data-grant-id");
  expect(grantId).toBeTruthy();
  const entry = page.locator(`[data-testid="chat-execution-entry"][data-grant-id="${grantId}"]`);
  await expect(entry).toHaveAttribute("data-state", "awaiting_confirmation");
  const isTender = (url: URL): boolean => url.pathname === "/api/agent/execution-grant";
  let aborted = 0;
  await page.route(isTender, async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    aborted += 1;
    await route.abort("connectionrefused");
  });
  try {
    await page.getByTestId("granted-execution-confirm").click();
    await expect(entry).toContainText("Last attempt not made:");
    await expect(entry).toHaveAttribute("data-state", "awaiting_confirmation");
    await expect(card).toBeVisible();
    await expect(page.getByText("Paused — an AI change is being made.")).toHaveCount(0);
    expect(aborted).toBeGreaterThan(0);
  } finally {
    await page.unroute(isTender);
  }
  await entry.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${EVIDENCE}/confirm-refused-transient.png`, fullPage: false });
  await page.getByTestId("granted-execution-confirm").click();
  await expect(card).toBeHidden();
  await expect(entry).toHaveAttribute("data-state", "committed");
  expect(silkTexts(await board())).toContain("RETRY");
});

test("B18-D review: a chat stream cut before its terminal event is shown as a failure, never as a finished run", async () => {
  await openChat();
  const prompt = page.getByTestId("prompt-input");
  await expect(prompt).toBeEnabled({ timeout: 90_000 });
  await page.route("**/api/chat", async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).split("\n").filter((line) => !line.includes("\"run_completed\"") && !line.includes("\"run_failed\"")).join("\n");
    await route.fulfill({ response, body });
  }, { times: 1 });
  await prompt.fill("Status.");
  await prompt.press("Enter");
  await expect(page.getByText("The connection ended before the assistant finished. An AI change already sent to your editor is reported in its entry: made, or not made.").last()).toBeVisible();
  await expect(prompt).toBeEnabled({ timeout: 90_000 });
});

test("B18-D review 2: a chat stream that ERRORS mid-body (a dropped connection) is handled like a cut — the answer stays, the notes are released, the entry is named", async () => {
  const start = await board();
  const at = centroidMm(start);
  await openChat();
  const prompt = page.getByTestId("prompt-input");
  await expect(prompt).toBeEnabled({ timeout: 90_000 });
  // The next /api/chat body loses its terminal line and then errors — read() rejects, as it does when a connection drops.
  await page.evaluate(() => {
    const original = window.fetch.bind(window);
    let armed = true;
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const response = await original(input, init);
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!armed || !url.endsWith("/api/chat") || !response.body) return response;
      armed = false;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const encoder = new TextEncoder();
      const keep = (line: string): boolean => !line.includes("\"run_completed\"") && !line.includes("\"run_failed\"");
      let buffer = "";
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          const { done, value } = await reader.read();
          if (done) {
            if (buffer && keep(buffer)) controller.enqueue(encoder.encode(buffer));
            controller.error(new TypeError("network error"));
            return;
          }
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          const kept = lines.filter(keep);
          if (kept.length > 0) controller.enqueue(encoder.encode(`${kept.join("\n")}\n`));
        },
      });
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    };
  });
  const entries = page.getByTestId("chat-execution-entry");
  const entriesBefore = await entries.count();
  await prompt.fill(`Add silkscreen text DROPPED at ${at.x}, ${at.y}.`);
  await prompt.press("Enter");
  await expect(page.getByText("The connection ended before the assistant finished. An AI change already sent to your editor is reported in its entry: made, or not made.").last()).toBeVisible();
  await expect(entries).toHaveCount(entriesBefore + 1);
  await expect(page.getByText("Error — please try again.")).toHaveCount(0);
  // the answer written before the connection dropped stays, and the run's interim text is released as a labelled note
  await expect(page.getByText(/the tool answered execution_preview_issued/).last()).toBeVisible();
  await expect(page.getByText(/^Assistant note \(written before the result\): \(fixture interim\)/).last()).toBeVisible();
  await expect(prompt).toBeEnabled({ timeout: 90_000 });
  await page.getByRole("button", { name: "Cancel — change nothing" }).click();
  await expect(page.getByTestId("granted-execution-card")).toBeHidden();
  expect(silkTexts(await board())).toEqual(silkTexts(start));
});

test("[B18-E E8] scenario 6 on a MOVE: an explicit move, 'Undo that.', a RELOAD, then 'Redo.' — each replay is its own history entry and the board ends where the move left it", async () => {
  const start = await board();
  const x0 = r3(start).at.x;
  const before = await committedLines().count();
  await select("R3");
  // A sentence no earlier test used: the retry guard is per principal for five minutes and the fixture clock is frozen.
  await chat("Move R3 4 mm to the right.");
  await expect(committedLines()).toHaveCount(before + 1);
  await expect(page.getByTestId("granted-execution-card"), "explicit autonomy: the move runs without a card").toBeHidden();
  expect(r3(await board()).at.x).toBe(x0 + 4 * NM_PER_MM);

  await chat("Undo that.");
  await expect(committedLines()).toHaveCount(before + 2);
  await expect(page.getByTitle(/^Undo: AI: undo — /), "the undo is a NEW history entry, not a step back in a stack").toBeVisible();
  expect(r3(await board()).at.x).toBe(x0);

  // RELOAD: the page's memory is gone, so "Redo." must resolve its reference from the durable grant records and the head.
  const committedBeforeReload = await committedLines().count();
  await reloadAs(page, context, "editor", origin, true);
  await openChat();
  await expect(committedLines()).toHaveCount(committedBeforeReload);
  await chat("Redo.");
  await expect(committedLines()).toHaveCount(committedBeforeReload + 1);
  await expect(page.getByTitle(/^Undo: AI: redo — /)).toBeVisible();
  expect(r3(await board()).at.x, "the move is back after a refresh it never depended on").toBe(x0 + 4 * NM_PER_MM);
  await page.screenshot({ path: `${EVIDENCE}/scenario-6-move-redo-after-reload.png`, fullPage: false });
});

test("[B18-E E8] the retry guard and the card's modality: the SAME move sentence again is a CARD with the guard's note even under explicit autonomy; the open card is modal, so the selection cannot drift under it, and Confirm commits the bound move", async () => {
  const start = await board();
  const x0 = r3(start).at.x;
  const other = start.footprints.find((footprint) => footprint.ref !== "R3")!;
  const before = await committedLines().count();
  await select("R3");
  await chat("Move R3 4 mm to the right."); // identical to the previous test's instruction, and it already executed
  const card = page.getByTestId("granted-execution-card");
  await expect(card, "an identical instruction is never executed twice unasked").toBeVisible();
  await expect(page.getByTestId("granted-execution-note")).toHaveText(/^An identical instruction already executed at .+ \(grant xg-[a-z0-9-]+\); confirm to run it again\.$/);
  await expect(page.getByTestId("chat-execution-entry").last()).toHaveAttribute("data-state", "awaiting_confirmation");
  await page.screenshot({ path: `${EVIDENCE}/retry-guard-card.png`, fullPage: false });

  // [B18-E E8] 7a in the browser, measured: the card is a MODAL dialog, so while a preview waits the human cannot reach the
  // editor at all — the selection cannot drift under an open card. (That targets are bound by id and never by the selection
  // is proven in the unit and integration suites, where the burn is reachable to test; here the UI makes it moot.)
  const reachable = await page.getByTestId("pcb-goto").click({ trial: true, timeout: 3_000 }).then(() => true).catch(() => false);
  expect(reachable, "the editor is unreachable while a confirmation card is open").toBe(false);
  await page.getByTestId("granted-execution-confirm").click();
  await expect(card).toBeHidden();
  await expect(committedLines()).toHaveCount(before + 1);
  await expect(page.getByTitle(/^Undo: AI: .*R3/), "the committed change names the bound footprint").toBeVisible();
  const after = await board();
  expect(r3(after).at.x).toBe(x0 + 4 * NM_PER_MM);
  expect(after.footprints.find((footprint) => footprint.ref === other.ref)!.at, `${other.ref} was never part of this change`).toEqual(other.at);
});

test("[B18-E E8] the double call: two identical execution calls in one step produce ONE card and one entry; the duplicate is refused and Confirm commits exactly one transaction", async () => {
  const start = await board();
  const at = centroidMm(start);
  expect(silkTexts(start)).not.toContain("REV C");
  const entries = page.getByTestId("chat-execution-entry");
  const entriesBefore = await entries.count();
  const before = await committedLines().count();
  await chat(`Add silkscreen text REV C at ${at.x}, ${at.y} twice.`);
  await expect(entries, "one side-effecting artifact per run, however many calls the model makes").toHaveCount(entriesBefore + 1);
  await expect(page.getByText(/refused before running \(execution_exists\) — nothing ran/).last(), "the run log says the duplicate was refused").toBeVisible();
  const card = page.getByTestId("granted-execution-card");
  await expect(card).toBeVisible();
  await expect(page.getByTestId("granted-execution-preview")).toContainText("REV C");
  await page.getByTestId("granted-execution-confirm").click();
  await expect(card).toBeHidden();
  await expect(committedLines()).toHaveCount(before + 1);
  expect(silkTexts(await board()).filter((text) => text === "REV C"), "added once, not twice").toHaveLength(1);
});

/** [B18-E E9] the page's own sentence when a run claimed something and prepared nothing (chat-run-view.ts LABEL_NOTHING_CHANGED). */
const NOTHING_CHANGED = "Nothing was changed: this run never prepared a change. Anything said about it being done was written before the assistant had any result — the run log above says what really happened.";

test("[B18-E E9] scenario 8 in the browser: a forged Tier 3 call is refused before anything runs — no card, no entry, nothing changed — and the page contradicts the assistant's claim", async () => {
  const start = await board();
  const entries = page.getByTestId("chat-execution-entry");
  const entriesBefore = await entries.count();
  const committed = await committedLines().count();
  await chat("Release the board."); // the scripted agent emits a provider name this run never advertised
  await expect(page.getByText(/Unknown tool — refused before running \(unknown_tool\) — nothing ran/).last()).toBeVisible();
  await expect(entries, "nothing was prepared, so there is no execution entry").toHaveCount(entriesBefore);
  await expect(page.getByTestId("granted-execution-card")).toBeHidden();
  // Rule 2: the claim is kept as a labelled note — and the PAGE says, in its own words, that nothing was changed
  await expect(page.getByText(/^Assistant note \(written before the result\): \(fixture interim\)/).last()).toBeVisible();
  await expect(page.getByText(NOTHING_CHANGED).last()).toBeVisible();
  await expect(committedLines()).toHaveCount(committed);
  await page.screenshot({ path: `${EVIDENCE}/tier3-refused-nothing-changed.png`, fullPage: false });
  const after = await board();
  expect(after.footprints).toEqual(start.footprints);
  expect(silkTexts(after)).toEqual(silkTexts(start));
  expect(JSON.stringify(chatBodies.at(-1)!.messages ?? []), "the claim never enters the history a later run receives").not.toContain("(fixture interim)");
});

test("[B18-E E9] a release smuggled into a real edit's arguments: the edit dies on its own argument contract, the release never starts, and the board does not move", async () => {
  const start = await board();
  const x0 = r3(start).at.x;
  const entries = page.getByTestId("chat-execution-entry");
  const entriesBefore = await entries.count();
  const committed = await committedLines().count();
  await select("R3");
  await chat("Move R3 2 mm to the right, then release the board.");
  await expect(page.getByText(/Move footprint — refused \(invalid_input\)/).last(), "strict arguments are the outer wall").toBeVisible();
  await expect(entries).toHaveCount(entriesBefore);
  await expect(page.getByTestId("granted-execution-card")).toBeHidden();
  await expect(page.getByText(NOTHING_CHANGED).last()).toBeVisible();
  await expect(committedLines()).toHaveCount(committed);
  expect(r3(await board()).at.x, "the honest edit in the same sentence is lost with the delegation").toBe(x0);
});

test("[B18-E E9] a forged handle: a grant whose id was rewritten in transit passes the page's checks but the SERVER refuses the tender — nothing is written and the entry ends terminal, never 'landed unverified'", async () => {
  const start = await board();
  const at = centroidMm(start);
  const entriesBefore = await page.getByTestId("chat-execution-entry").count();
  const committed = await committedLines().count();
  let rewritten = 0;
  await page.route("**/api/chat", async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).split("\n").map((line) => {
      if (!line.includes('"execution_grant_ready"')) return line;
      const event = JSON.parse(line) as { grant: { grantId: string } };
      event.grant.grantId = `xg-${"f".repeat(32)}`; // a handle the server never issued; the digest still binds the rest
      rewritten += 1;
      return JSON.stringify(event);
    }).join("\n");
    await route.fulfill({ response, body });
  });
  try {
    await chat(`Add silkscreen text FORGEDHANDLE at ${at.x}, ${at.y}.`);
  } finally {
    await page.unroute("**/api/chat");
  }
  expect(rewritten).toBe(1);
  const card = page.getByTestId("granted-execution-card");
  await expect(card, "only the handle was changed, so the page's own checks still pass").toBeVisible();
  const entry = page.getByTestId("chat-execution-entry").last();
  await expect(page.getByTestId("chat-execution-entry")).toHaveCount(entriesBefore + 1);
  await page.getByTestId("granted-execution-confirm").click();
  // the ritual runs (the entry passes through "executing"), so wait for the entry to SETTLE, not merely to change
  await expect.poll(async () => await entry.getAttribute("data-state"), { timeout: 60_000 }).toMatch(/^(committed|not_made|cancelled|superseded|landed_unverified)$/);
  const state = await entry.getAttribute("data-state");
  expect(state, "a handle the server never issued cannot have committed anything").not.toBe("committed");
  expect(state, "the server refused a handle it never issued, so nothing can be unverified").not.toBe("landed_unverified");
  expect(["not_made", "cancelled"], `the entry ended '${state}'`).toContain(state);
  await expect(committedLines()).toHaveCount(committed);
  const after = await board();
  expect(silkTexts(after)).toEqual(silkTexts(start));
  expect(silkTexts(after)).not.toContain("FORGEDHANDLE");
  await page.screenshot({ path: `${EVIDENCE}/forged-handle-refused.png`, fullPage: false });
  if (await card.isVisible()) await page.getByRole("button", { name: "Cancel — change nothing" }).click();
  await expect(card).toBeHidden();
});

test("B18-D review 2: the S5 observer records interim text inside mixed markup, so a leak into a formatted answer could not hide", async () => {
  const probeText = "(fixture interim) Done — R3 moved";
  const before = interimLog.length;
  await page.evaluate(() => {
    const probe = document.createElement("p");
    probe.id = "s5-probe";
    const strong = document.createElement("strong");
    strong.textContent = "R3";
    probe.append("(fixture interim) Done — ", strong, " moved");
    document.body.append(probe);
  });
  await expect.poll(() => interimLog.slice(before).some((record) => record.text === probeText), { timeout: 10_000 }).toBe(true);
  await page.evaluate(() => document.getElementById("s5-probe")?.remove());
  // the probe is not an appearance of the scripted agent's text: it is removed so S5 judges only the real flows
  for (let index = interimLog.length - 1; index >= before; index -= 1) if (interimLog[index]!.text === probeText) interimLog.splice(index, 1);
});

test("B18-D S5 Rule 2 across every flow: the scripted agent's interim text only ever appeared as a labelled note, answered by an execution entry or by the page's own 'nothing was changed', and never in a request's history", async () => {
  expect(interimLog.length, "the scripted agent wrote interim text beside its execution calls").toBeGreaterThan(0);
  for (const record of interimLog) {
    expect(record.text.startsWith("Assistant note (written before the result): (fixture interim)"), record.text).toBe(true);
  }
  // [B18-E E9] measured while adding the refusal runs: `record.entries` is the state of EVERY execution entry in the chat
  // log, not this run's — so once any run has made one, "an entry existed" is true for every later claim and proves little.
  // What each run's claim is answered by is pinned in that run's own test (a new entry, or the page's contradiction); here,
  // chat-wide, both refusal runs must have left the page's own sentence standing beside their claim.
  expect(interimLog.some((record) => record.entries.length > 0), "the execution runs' claims sat beside their entries").toBe(true);
  expect(await page.getByText(NOTHING_CHANGED).count(), "both runs that prepared nothing are contradicted by the page itself").toBeGreaterThanOrEqual(2);
  for (const body of chatBodies) expect(JSON.stringify(body.messages ?? [])).not.toContain("(fixture interim)");
});
