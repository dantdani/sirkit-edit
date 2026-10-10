/**
 * [B24-D3] D24-32, OD-215 - keyboard-only journeys and visible focus against the REAL application (the fixture runtime and its
 * SCRIPTED agent, never a model). One bootstrap (`bootstrapSynchronizedBoard`, its own uuid namespace `b24d3000`); after it, no
 * mouse: the bootstrap and its reloads click (e2e/fixture-journey.ts), and they are setup, not the journey. The fresh load is
 * `page.reload()` plus `expectHydrated`.
 *
 *  1. From a fresh load (the chat closed: `chatOpen` starts false), Tab reaches the activity bar's "AI Chat" button, Enter opens
 *     the chat, and Tab then reaches the prompt (named CHAT_PROMPT_LABEL) within a bounded number of presses, recorded. Every stop
 *     on the way is visibly focused (its computed outline, box-shadow or border colour differs from its blurred state) and none
 *     is `body`. The path crosses controls outside ACCESSIBILITY_SCOPE (the header, the schematic toolbar); a stop that fails is
 *     fixed in place by a focus-visible class and listed on accessibility.md section 7.
 *  2. A scripted turn ("Status.") sent with Enter: the `(fixture agent) ` reply lands inside the polite log, `aria-busy` is
 *     "false" after the terminal event, and focus ends on the prompt (the prompt is disabled while a run streams, so focus fell
 *     to `body` before D3 returned it).
 *  3. Keyboard Go-to: the PCB view by keyboard (Shift+Tab to `view-tab-pcb`, Enter), then Tab to `pcb-goto-input`, "R3", Enter:
 *     the selection's primary is a footprint (read as agent-execution.spec.ts's `select()` reads it).
 *  4. The approval card by keyboard: "Move R3 2 mm to the right." opens `granted-execution-card`; focus is inside the dialog
 *     "AI change — confirm before it is made"; Tab and Shift+Tab cycle only among its Close, Cancel and Confirm, each visibly
 *     focused; Escape reaches onCancel through onOpenChange: the entry reads cancelled with "Cancelled — nothing was changed.",
 *     R3 has not moved, and focus is not on `body`. This is the Tab-trap proof for the Tier 1 card ONLY (discovery section 8
 *     item 10); the other approval dialogs and the BOM dialogs stay INFERRED.
 *  5. Both canvas hosts expose role img with their statement as the accessible name, and each statement names the Go to
 *     component field case 3 used.
 *
 * Expected red on 3773c6a: cases 1 (the prompt has no accessible name), 2 (no log, focus on body) and 5 (no img role). Green
 * first by design, recorded as such: case 3 (keyboard Go-to existed) and possibly case 4 (the shared dialog's trap). No real
 * network, provider or database: the fixture server's stores are in memory.
 */
import { expect, test, type BrowserContext, type ElementHandle, type Locator, type Page, type Request, type TestInfo } from "@playwright/test";
import { CHAT_PROMPT_LABEL, CHAT_TRANSCRIPT_LABEL, PCB_CANVAS_STATEMENT, SCHEMATIC_CANVAS_STATEMENT } from "../app/lib/accessibility/statements";
import { FIXTURE_CLOCK, bootstrapSynchronizedBoard, expectHydrated } from "./fixture-journey";

test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);

const NAMESPACE = "b24d3000";
/** Bounds on Tab presses: the measured path of case 1, and a navigation between two regions of the editor. */
const MAX_TO_AI_CHAT = 40;
const MAX_TO_PROMPT = 120; // [B24-D3 lead, 2026-10-10] from the lead's run, not a guess: 95 presses from AI Chat to the prompt (the chat follows the whole PCB editor in the DOM, focus is not moved on open: accessibility.md section 7); 80 was never measured and failed at press 80
const MAX_NAVIGATION = 300;
/** Tailwind's transitions run 150 ms; a stop is measured once they have settled. */
const SETTLE_MS = 250;
const CARD_TITLE = "AI change — confirm before it is made";

interface Footprint { ref: string; at: { x: number; y: number } }
interface ChatBody { editorContext?: { board: { footprints: Footprint[] } } }
interface FocusStyle { ring: string; boxShadow: string; border: string }
interface Stop { press: number; tag: string; testId: string | null; name: string; focused: FocusStyle | null; blurred: FocusStyle | null }

let context: BrowserContext;
let page: Page;
const chatBodies: ChatBody[] = [];

test.beforeAll(async ({ browser, baseURL }) => {
  context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  page = await context.newPage();
  page.on("request", (request: Request) => {
    if (request.method() !== "POST" || new URL(request.url()).pathname !== "/api/chat") return;
    try { chatBodies.push(request.postDataJSON() as ChatBody); } catch { /* not JSON */ }
  });
  await bootstrapSynchronizedBoard(page, context, baseURL!, NAMESPACE);
});

test.afterAll(async () => { await context.close(); });

/** The focus indicator of an element as computed now: its outline (when drawn), its box-shadow and its border colour (when it
 *  has a border). */
async function styleOf(element: ElementHandle<Node>): Promise<FocusStyle | null> {
  return element.evaluate((node) => {
    if (!(node instanceof Element) || !node.isConnected) return null;
    const style = getComputedStyle(node);
    const ring = style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0 ? `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}` : "none";
    const border = parseFloat(style.borderTopWidth) > 0 || parseFloat(style.borderBottomWidth) > 0 ? `${style.borderTopColor} ${style.borderRightColor} ${style.borderBottomColor} ${style.borderLeftColor}` : "none";
    return { ring, boxShadow: style.boxShadow, border };
  });
}
const visiblyDiffers = (focused: FocusStyle, blurred: FocusStyle): boolean => focused.ring !== blurred.ring || focused.boxShadow !== blurred.boxShadow || focused.border !== blurred.border;

/** The focused element now (a handle), with what identifies it in the record; `body` is reported as such. */
async function focusedNow(): Promise<{ handle: ElementHandle<Node> | null; tag: string; testId: string | null; name: string; isBody: boolean }> {
  const handle = await page.evaluateHandle(() => document.activeElement ?? document.body);
  const info = await handle.evaluate((node) => {
    const element = node as HTMLElement;
    const isBody = element === document.body || element === document.documentElement;
    const name = (element.getAttribute("aria-label") ?? element.getAttribute("title") ?? element.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
    return { tag: element.tagName.toLowerCase(), testId: element.getAttribute("data-testid"), name, isBody };
  });
  return { handle: handle.asElement(), ...info };
}

const isFocused = (locator: Locator): Promise<boolean> => locator.evaluate((element) => element === document.activeElement);

/**
 * Press `key` until `target` holds focus (at most `max` presses). With `measure` (the measured path of case 1), every stop is
 * recorded with its focused style and, once focus has moved on, its blurred style - the target's blurred style is its style before
 * the walk began - and no stop may be `body`. Without it (a navigation between two regions), the walk may wrap through `body`.
 */
async function pressUntil(target: Locator, key: "Tab" | "Shift+Tab", max: number, measure: boolean): Promise<Stop[]> {
  if (!measure && (await isFocused(target))) return [];
  const targetBlurred = measure ? await styleOf((await target.elementHandle())!) : null;
  const stops: Stop[] = [];
  let previous: ElementHandle<Node> | null = null;
  for (let press = 1; press <= max; press += 1) {
    await page.keyboard.press(key);
    if (measure) await page.waitForTimeout(SETTLE_MS);
    if (measure && previous !== null) stops[stops.length - 1]!.blurred = await styleOf(previous);
    const now = await focusedNow();
    if (measure) expect(now.isBody, `${key} press ${press} left focus on body`).toBe(false);
    stops.push({ press, tag: now.tag, testId: now.testId, name: now.name, focused: measure && now.handle ? await styleOf(now.handle) : null, blurred: null });
    previous = now.handle;
    if (await isFocused(target)) {
      if (measure) stops[stops.length - 1]!.blurred = targetBlurred;
      return stops;
    }
  }
  throw new Error(`${key} did not reach the target within ${max} presses; the last stops: ${JSON.stringify(stops.slice(-5).map((stop) => [stop.tag, stop.testId, stop.name]))}`);
}

function expectVisiblyFocused(stops: readonly Stop[]): void {
  const invisible = stops.filter((stop) => stop.focused === null || stop.blurred === null || !visiblyDiffers(stop.focused, stop.blurred)).map((stop) => `${stop.press}: <${stop.tag}> ${stop.testId ?? ""} "${stop.name}" ${JSON.stringify(stop.focused)} vs ${JSON.stringify(stop.blurred)}`);
  expect(invisible, "every stop is visibly focused").toEqual([]);
}

async function record(testInfo: TestInfo, name: string, body: unknown): Promise<void> {
  await testInfo.attach(name, { body: JSON.stringify(body, null, 2), contentType: "application/json" });
}

/** One chat turn typed and sent from the keyboard (focus is on the prompt); waits for the scripted agent's closing reply and
 *  for the prompt to come back; returns the request body (its editor context is the board BEFORE this turn). */
async function sendByKeyboard(text: string): Promise<ChatBody> {
  const prompt = page.getByRole("textbox", { name: CHAT_PROMPT_LABEL });
  await expect(prompt).toBeFocused();
  const replies = page.getByText(/^\(fixture agent\) /);
  const before = await replies.count();
  const sent = chatBodies.length;
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
  await expect.poll(() => chatBodies.length, { timeout: 30_000 }).toBeGreaterThan(sent);
  await expect.poll(async () => await replies.count(), { timeout: 120_000 }).toBeGreaterThan(before);
  await expect(prompt).toBeEnabled({ timeout: 90_000 });
  return chatBodies[sent]!;
}
const r3x = (body: ChatBody): number => body.editorContext!.board.footprints.find((footprint) => footprint.ref === "R3")!.at.x;

test("1. from a fresh load, Tab reaches AI Chat, Enter opens the chat, Tab reaches the prompt; every stop visibly focused, never body", async ({}, testInfo) => {
  await page.clock.setFixedTime(new Date(FIXTURE_CLOCK));
  await page.reload();
  await expectHydrated(page);
  await expect(page.getByTestId("prompt-input"), "the chat is closed on a fresh load").toHaveCount(0);
  const aiChat = page.getByRole("button", { name: "AI Chat", exact: true });
  const toAiChat = await pressUntil(aiChat, "Tab", MAX_TO_AI_CHAT, true);
  await page.keyboard.press("Enter");
  const prompt = page.getByRole("textbox", { name: CHAT_PROMPT_LABEL, exact: true });
  await expect(prompt).toBeVisible();
  const toPrompt = await pressUntil(prompt, "Tab", MAX_TO_PROMPT, true);
  await record(testInfo, "case-1-tab-stops.json", { toAiChat: toAiChat.length, toPrompt: toPrompt.length, stops: [...toAiChat, ...toPrompt] });
  testInfo.annotations.push({ type: "tab-presses", description: `${toAiChat.length} to AI Chat, then ${toPrompt.length} to the prompt` });
  expectVisiblyFocused([...toAiChat, ...toPrompt]);
});

test("2. Status. sent with Enter: the reply lands in the polite log, aria-busy is false after the terminal event, focus ends on the prompt", async () => {
  const prompt = page.getByRole("textbox", { name: CHAT_PROMPT_LABEL, exact: true });
  await expect(prompt).toBeFocused();
  const log = page.locator('[role="log"][aria-live="polite"]');
  await expect(log).toHaveCount(1);
  await expect(log).toHaveAttribute("aria-label", CHAT_TRANSCRIPT_LABEL);
  const replies = log.getByText(/^\(fixture agent\) /);
  const before = await replies.count();
  await sendByKeyboard("Status.");
  await expect.poll(async () => await replies.count()).toBeGreaterThan(before);
  await expect(log).toHaveAttribute("aria-busy", "false");
  await expect(prompt).toBeFocused({ timeout: 10_000 });
});

test("3. keyboard Go-to: the PCB view by keyboard, Go to component R3 with Enter selects a footprint", async ({}, testInfo) => {
  const pcbTab = page.getByTestId("view-tab-pcb");
  const back = await pressUntil(pcbTab, "Shift+Tab", MAX_NAVIGATION, false);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("p2g-panel")).toBeVisible();
  await expect(page.getByTestId("p2g-hydration")).toContainText("Durable truth loaded");
  const goTo = page.getByTestId("pcb-goto-input");
  const forward = await pressUntil(goTo, "Tab", MAX_NAVIGATION, false);
  testInfo.annotations.push({ type: "tab-presses", description: `${back.length} Shift+Tab to the PCB tab, ${forward.length} Tab to Go to component` });
  await page.keyboard.type("R3");
  await page.keyboard.press("Enter");
  await expect.poll(async () => JSON.parse((await page.getByTestId("pcb-editor").getAttribute("data-view")) ?? "{}").selection?.primary?.kind).toBe("footprint");
});

test("4. the Tier 1 card by keyboard: focus inside, Tab and Shift+Tab cycle among Close, Cancel and Confirm, each visibly focused; Escape cancels and changes nothing", async ({}, testInfo) => {
  const prompt = page.getByRole("textbox", { name: CHAT_PROMPT_LABEL, exact: true });
  await pressUntil(prompt, "Tab", MAX_NAVIGATION, false);
  const x0 = r3x(await sendByKeyboard("Status."));
  await expect(prompt).toBeFocused({ timeout: 10_000 });
  const entries = page.getByTestId("chat-execution-entry");
  await page.keyboard.type("Move R3 2 mm to the right.");
  await page.keyboard.press("Enter");
  const card = page.getByTestId("granted-execution-card");
  await expect(card).toBeVisible({ timeout: 120_000 });
  const dialog = page.getByRole("dialog", { name: CARD_TITLE, exact: true });
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.evaluate((element) => element.contains(document.activeElement)), { timeout: 10_000 }).toBe(true);
  const controls: ReadonlyArray<readonly [string, Locator]> = [
    ["Close", dialog.getByRole("button", { name: "Close", exact: true })],
    ["Cancel", dialog.getByRole("button", { name: "Cancel — change nothing", exact: true })],
    ["Confirm", dialog.getByTestId("granted-execution-confirm")],
  ];
  for (const [, locator] of controls) await expect(locator).toBeEnabled();
  const cycle: Array<{ key: string; control: string | null; stop: Stop }> = [];
  for (const key of ["Tab", "Shift+Tab"] as const) {
    let previous: ElementHandle<Node> | null = null;
    for (let press = 1; press <= 6; press += 1) {
      await page.keyboard.press(key);
      await page.waitForTimeout(SETTLE_MS);
      if (previous !== null) cycle[cycle.length - 1]!.stop.blurred = await styleOf(previous);
      const now = await focusedNow();
      let control: string | null = null;
      for (const [name, locator] of controls) if (await isFocused(locator)) control = name;
      cycle.push({ key, control, stop: { press, tag: now.tag, testId: now.testId, name: now.name, focused: now.handle ? await styleOf(now.handle) : null, blurred: null } });
      previous = now.handle;
    }
    // the last stop of each direction is measured blurred by one more press the other way round the cycle
    await page.keyboard.press(key === "Tab" ? "Shift+Tab" : "Tab");
    await page.waitForTimeout(SETTLE_MS);
    if (previous !== null) cycle[cycle.length - 1]!.stop.blurred = await styleOf(previous);
  }
  await record(testInfo, "case-4-card-cycle.json", cycle);
  expect(cycle.filter((entry) => entry.control === null).map((entry) => `${entry.key} ${entry.stop.press}: <${entry.stop.tag}> "${entry.stop.name}"`), "every stop is one of the card's three controls").toEqual([]);
  for (const key of ["Tab", "Shift+Tab"]) expect(new Set(cycle.filter((entry) => entry.key === key).map((entry) => entry.control)), key).toEqual(new Set(["Close", "Cancel", "Confirm"]));
  expectVisiblyFocused(cycle.map((entry) => entry.stop));
  await page.keyboard.press("Escape");
  await expect(card).toBeHidden();
  const entry = entries.last();
  await expect(entry).toHaveAttribute("data-state", "cancelled");
  await expect(entry).toContainText("Cancelled — nothing was changed.");
  expect(await page.evaluate(() => document.activeElement !== null && document.activeElement !== document.body), "focus is not on body after Escape").toBe(true);
  await pressUntil(prompt, "Tab", MAX_NAVIGATION, false);
  expect(r3x(await sendByKeyboard("Status.")), "R3 has not moved").toBe(x0);
});

test("5. both canvas hosts are images named by their statements, and each statement names the Go to component field", async () => {
  const pcbGoTo = await page.getByTestId("pcb-goto-input").getAttribute("aria-label");
  expect(pcbGoTo).toBe("Go to component");
  expect(PCB_CANVAS_STATEMENT).toContain(pcbGoTo!);
  await expect(page.getByRole("img", { name: PCB_CANVAS_STATEMENT, exact: true })).toHaveCount(1);
  const schematicTab = page.getByTestId("view-tab-schematic");
  await pressUntil(schematicTab, "Shift+Tab", MAX_NAVIGATION, false);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("schematic-canvas")).toBeVisible();
  const schematicGoTo = await page.getByTestId("schematic-goto-input").getAttribute("aria-label");
  expect(schematicGoTo).toBe("Go to component");
  expect(SCHEMATIC_CANVAS_STATEMENT).toContain(schematicGoTo!);
  await expect(page.getByRole("img", { name: SCHEMATIC_CANVAS_STATEMENT, exact: true })).toHaveCount(1);
});
