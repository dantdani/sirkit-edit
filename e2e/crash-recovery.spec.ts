/**
 * [B24-D2] D24-30, OD-214 - a page closed mid-commit, then reopened (a default-configuration spec: the orchestration configuration runs
 * `e2e-orchestration` only; [B24-D2B review 3] performance-and-reliability.md section 19 lists every run of it, and sections 15, 18, 22 and 27 cite runs of it too; [B24-D2B review 4] section 26, once named here, cites none). The agent-execution pattern: the fixture runtime's SCRIPTED agent (never a model), "Move R3 2 mm to the
 * right." with R3 selected, the confirmation card, and the editor's tender (POST /api/agent/execution-grant) held by a route
 * (e2e/agent-execution.spec.ts, the B18-D P2 hold); its own uuid namespace, `b24d2c00`.
 *
 *  (a) Before the server: the tender is held before it reaches the server; the page is closed (`runBeforeUnload: false`) and a new
 *      page of the same context opened. Nothing was applied (R3 where it was, read from the editor's own chat snapshot), the entry
 *      does not show as committed, and the server's grant was never consumed. [B24-D2B reviews, 2026-10-10] If the reopened page shows the entry (an entry
 *      it lost is not judged here), it reads not started and open (`outcome_unknown`: the grant is still issued, and another open tab could hold its card), never "awaiting the editor's result" and never "Not made". [B24-D2 CI fix, 2026-10-10] The hold is a sink (`sinkTender`): CI run 38049453257 showed a never-answered route released by the page close and the tender consumed on the server; the sink accepts the connection and never answers, so a close releases nothing to the server.
 *  (b) After the server: the tender reaches the server and the grant is consumed (`route.fetch()`), and the page closes before the
 *      response arrives. On reopen the editor's recovery sweep (`recoverGrantedExecutionsForEditor`; its notice "AI execution
 *      recovery: ...") settles it by B18's recovery contract (`b18-c-recovery-inflight`; [B24-D2B] `b24-d2-crash-recovery` for the notice): the change is never
 *      applied twice, and never lost without a notice - if R3 did not move, the grant's entry is not shown as committed and the page
 *      says so: the recovery notice naming the grant, or the entry settled as not made or of unknown outcome (`not_made`,
 *      `outcome_unknown`, `landed_unverified`). [B24-D2 review] An entry merely shown in its persisted pre-crash state
 *      (`awaiting_confirmation`, `issued`, `executing`) with no notice IS the silent loss, never a pass; the wait for the notice ends
 *      only on a settlement, never on the entry being present; and the server's grant must show its consumption (the positive
 *      control: otherwise the tender never reached the server and this is (a) again). The outcome found (moved once, or not moved
 *      with its notice, and the server's grant state) is attached to the run for the record (crash-outcome.json). A double apply or a
 *      silent loss is a counterexample (fix it, or STOP). [B24-D2B review, 2026-10-10] And the notice must be durable and true: the
 *      recovery notice names the grant without calling it in progress, AND - after that transient notice is gone - the entry itself
 *      shows a not-landed state, never its pre-crash "awaiting the editor's result".
 *
 * Found (B24-D2B): (b) a silent loss; and (a)'s reopened entry kept its pre-crash "Executing … awaiting the editor's result (interrupted by reload)" - both fixed
 * test-first (`b24-d2-crash-recovery`). No real network, provider or database: the fixture server's stores are in memory.
 */
import { expect, test, type BrowserContext, type Page, type Request, type Route } from "@playwright/test";
import { FIXTURE_CLOCK, bootstrapSynchronizedBoard, expectHydrated, openPcb } from "./fixture-journey";

test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);

const NM_PER_MM = 1_000_000;
interface Footprint { ref: string; at: { x: number; y: number } }
interface ChatBody { scope: { tenantId: string; projectId: string; branchId: string }; editorContext?: { board: { footprints: Footprint[] } } }

let context: BrowserContext;
let page: Page;
let origin: string;
const chatBodies: ChatBody[] = [];
/** Every outcome notice the editor showed, in order, across pages (reported through a binding, as agent-execution does). */
const noticeLog: string[] = [];
const outcomes: Record<string, unknown> = {};
/** [B24-D2 review, 2026-10-09] The entry states that settle a granted execution (chat-run-view.ts ExecutionEntryState's terminal ones). */
const SETTLED_STATES = new Set(["committed", "not_made", "landed_unverified", "outcome_unknown", "cancelled", "superseded"]);
/** The settled states that tell the person a change was not made, or that its outcome is unknown: a notice of their own. */
const NOT_LANDED_NOTICE_STATES = new Set(["not_made", "outcome_unknown", "landed_unverified"]);

function watch(target: Page): void {
  target.on("request", (request: Request) => {
    if (request.method() !== "POST" || new URL(request.url()).pathname !== "/api/chat") return;
    try { chatBodies.push(request.postDataJSON() as ChatBody); } catch { /* not JSON */ }
  });
}
async function openChat(): Promise<void> {
  const prompt = page.getByTestId("prompt-input");
  if (!(await prompt.isVisible())) await page.getByTestId("activity-ai chat").click();
  await expect(prompt).toBeVisible();
}
/** One chat turn, waiting for the scripted agent's closing reply; returns the request body (the board BEFORE this turn). */
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
/** R3's x in the PCB editor's exact working copy right now (a plain turn whose request carries it). */
async function r3x(): Promise<number> {
  const body = await chat("Status.");
  return body.editorContext!.board.footprints.find((footprint) => footprint.ref === "R3")!.at.x;
}
async function select(ref: string): Promise<void> {
  await page.getByTestId("pcb-goto-input").fill(ref);
  await page.getByTestId("pcb-goto").click();
  await expect.poll(async () => JSON.parse((await page.getByTestId("pcb-editor").getAttribute("data-view")) ?? "{}").selection?.primary?.kind).toBe("footprint");
}
function scopeHeaders(): Record<string, string> {
  const scope = chatBodies.at(-1)!.scope;
  return { "content-type": "application/json", origin, "x-sirkit-tenant-id": scope.tenantId, "x-sirkit-project-id": scope.projectId, "x-sirkit-branch-id": scope.branchId };
}
/** The server's own record of a grant (GET /api/agent/execution-grant?grantId=...). */
async function serverGrant(grantId: string): Promise<{ status: string | null; consumed: boolean; body: unknown }> {
  const response = await page.request.get(`/api/agent/execution-grant?grantId=${encodeURIComponent(grantId)}`, { headers: scopeHeaders() });
  const body = (await response.json().catch(() => null)) as { grant?: { state?: { status?: string; consumption?: unknown } } } | null;
  // [B24-D2 review, 2026-10-09] consumed: the grant's state records a consumption (it stays recorded once the grant is settled or retired)
  return { status: body?.grant?.state?.status ?? null, consumed: body?.grant?.state?.consumption != null, body };
}
/** Close the page as a crash would (no beforeunload), then open a new page of the same profile on the same project. */
async function crashAndReopen(): Promise<void> {
  await page.close({ runBeforeUnload: false });
  page = await context.newPage();
  watch(page);
  await page.clock.setFixedTime(new Date(FIXTURE_CLOCK));
  await page.goto("/");
  await expect(page.getByTestId("fixture-runtime-banner")).toBeVisible();
  await expectHydrated(page);
  await openPcb(page, true);
}
/** Ask for the move, take the card's grant id, and Confirm while `onTender` holds the tender. */
async function confirmHeldMove(onTender: (route: Route) => Promise<void>): Promise<{ grantId: string; tendered: () => number }> {
  await select("R3");
  await chat("Move R3 2 mm to the right.");
  const card = page.getByTestId("granted-execution-card");
  await expect(card).toBeVisible();
  const grantId = (await page.getByTestId("chat-execution-entry").last().getAttribute("data-grant-id"))!;
  expect(grantId).toBeTruthy();
  let tenders = 0;
  await page.route((url) => url.pathname === "/api/agent/execution-grant", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    tenders += 1;
    await onTender(route);
  });
  await page.getByTestId("granted-execution-confirm").click();
  await expect.poll(() => tenders, { timeout: 60_000 }).toBeGreaterThanOrEqual(1);
  return { grantId, tendered: () => tenders };
}

test.beforeAll(async ({ browser, baseURL }) => {
  origin = baseURL!;
  context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  await context.exposeBinding("__sirkitNotice", (_source, text: string) => { noticeLog.push(text); });
  await context.addInitScript(() => {
    const seen: string[] = [];
    const host = window as unknown as { __sirkitNotice?: (text: string) => void };
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
  page = await context.newPage();
  watch(page);
  await bootstrapSynchronizedBoard(page, context, origin, "b24d2c00");
});

test.afterAll(async ({}, testInfo) => {
  await testInfo.attach("crash-outcome.json", { body: JSON.stringify({ outcomes, notices: noticeLog }, null, 2), contentType: "application/json" });
  await context.close();
});

test("(a) before the server: the tender is held before it reaches the server and the page closes; on reopen nothing was applied, the entry is not committed, and the server never consumed the grant", async () => {
  const x0 = await r3x();
  const never = new Promise<void>(() => undefined);
  const { grantId } = await confirmHeldMove(async (route) => { await sinkTender(route); await never; }); // [B24-D2 CI fix, 2026-10-10] held at a sink, never at the route alone
  await crashAndReopen();
  expect(await r3x(), "nothing was applied").toBe(x0);
  const entry = page.locator(`[data-testid="chat-execution-entry"][data-grant-id="${grantId}"]`);
  if (await entry.count()) await expect(entry).not.toHaveAttribute("data-state", "committed");
  if (await entry.count()) {
    // [B24-D2B reviews, 2026-10-10] the reopened page says so: once its sweep has read the grant (still issued: not started, no card survives a reload, and another
    // open tab could still hold its card), the entry leaves its pre-crash state for `outcome_unknown` - never "Executing … awaiting", never "Not made"
    await expect.poll(async () => entry.getAttribute("data-state"), { timeout: 30_000 }).toBe("outcome_unknown");
    const said = await entry.innerText(); expect(said, "the entry never claims the editor's result is still awaited").not.toMatch(/awaiting the editor's (result|settlement)/); expect(said, "it says not started").toMatch(/^Not started — /m); expect(said, "never not made while the grant is issued").not.toMatch(/Not made|Nothing was changed/);
  }
  const grant = await serverGrant(grantId);
  expect(grant.status, JSON.stringify(grant.body).slice(0, 300)).not.toBe("consumed");
  expect(grant.consumed, "[B24-D2 review] and no consumption is recorded on it").toBe(false);
  outcomes.a = { grantId, x0, xAfter: x0, entryState: (await entry.count()) ? await entry.getAttribute("data-state") : null, serverGrant: grant.status, serverConsumed: grant.consumed };
});

test("(b) after the server: the grant is consumed and the page closes before the response; on reopen the change is never applied twice and never lost without a notice", async () => {
  const x0 = await r3x();
  const never = new Promise<void>(() => undefined);
  const { grantId } = await confirmHeldMove(async (route) => {
    await route.fetch(); // the tender reaches the server: the one-shot grant is consumed
    await never; // the response never reaches the page
  });
  await crashAndReopen();
  const entry = page.locator(`[data-testid="chat-execution-entry"][data-grant-id="${grantId}"]`);
  const recoveredFor = (): string[] => noticeLog.filter((notice) => notice.startsWith("AI execution recovery") && notice.includes(grantId.slice(0, 12)));
  const stateOf = async (): Promise<string | null> => ((await entry.count()) ? await entry.getAttribute("data-state") : null);
  // the hydration sweep has run once the board is loaded; give its notice the editor's own notice window. [B24-D2 review, 2026-10-09]
  // the wait ends only on a settlement the person can see (the notice naming the grant, or the entry in a settled state) - never on
  // the entry merely being present, which its persisted pre-crash state always is; with neither, the window runs out and the page
  // is judged below as it stands
  await expect.poll(async () => recoveredFor().length > 0 || SETTLED_STATES.has((await stateOf()) ?? ""), { timeout: 30_000 }).toBe(true).catch(() => undefined);
  const xAfter = await r3x();
  expect([x0, x0 + 2 * NM_PER_MM], "never applied twice").toContain(xAfter);
  const entryState = await stateOf();
  const recovered = recoveredFor();
  const grant = await serverGrant(grantId);
  // the positive control: the tender reached the server and the one-shot grant was consumed - else this run is (a) again, not (b)
  expect(grant.consumed, `the server consumed the grant (status ${String(grant.status)}): ${JSON.stringify(grant.body).slice(0, 300)}`).toBe(true);
  if (xAfter === x0) {
    expect(entryState, "a change that did not land is never shown committed").not.toBe("committed");
    expect(recovered.length > 0 || NOT_LANDED_NOTICE_STATES.has(entryState ?? ""), `never lost without a notice: no recovery notice names ${grantId.slice(0, 12)} and the entry shows ${entryState ?? "nothing"} (a pre-crash state with no notice is the silent loss)`).toBe(true);
    // [B24-D2B review, 2026-10-10] the notice is true and durable: the transient notice names the grant without calling it in
    // progress, AND the entry itself - which outlives that notice (PcbEditor clears it after 6 s) - shows a not-landed state, never
    // its pre-crash "awaiting the editor's result"
    expect(recovered.length, `a recovery notice names ${grantId.slice(0, 12)}`).toBeGreaterThan(0);
    expect(recovered.join(" | "), "the notice never calls the crashed execution in progress").not.toMatch(/left-in-flight|in progress/i);
    await expect(page.getByText(/^AI execution recovery/), "the transient notice is gone").toHaveCount(0, { timeout: 30_000 });
    expect(await entry.count(), "the chat entry that names the grant is still there").toBe(1);
    const durableState = await stateOf();
    const durableText = await entry.innerText();
    outcomes.bDurable = { entryState: durableState, entryText: durableText.slice(0, 600) };
    expect(NOT_LANDED_NOTICE_STATES.has(durableState ?? ""), `the entry itself says the change did not land (it shows ${durableState ?? "nothing"}: ${durableText.slice(0, 160)})`).toBe(true);
    expect(durableText, "the entry never claims the editor's result is still awaited").not.toMatch(/awaiting the editor's (result|settlement)/);
  } else {
    expect(entryState === null || entryState === "committed", "a change that landed is never shown as not made").toBe(true);
  }
  outcomes.b = { grantId, x0, xAfter, entryState, recovered, serverGrant: grant.status, serverConsumed: grant.consumed, aEntryAtThisReopen: await entryRecord((outcomes.a as { grantId?: unknown } | undefined)?.grantId) }; // [B24-D2B review 2] a record, never asserted
});

/** [B24-D2B review 2, 2026-10-10] A record for crash-outcome.json, never an assertion: (a)'s entry in the page reopened for (b) - its
 *  state, its text and its grant's server state. When the server no longer holds (a)'s grant as issued by then, the sweep of (b)'s reopen
 *  reads it and settles (a)'s restored entry - [B24-D2B review 3] whichever record the chat restored there (its pre-crash `executing` one or the not-started one): this record does not show which.
 *  Declared last so no line above moves. */
async function entryRecord(grantId: unknown): Promise<{ grantId: string; state: string | null; text: string; serverGrant: string | null } | null> {
  if (typeof grantId !== "string") return null;
  const entry = page.locator(`[data-testid="chat-execution-entry"][data-grant-id="${grantId}"]`);
  const shown = (await entry.count()) > 0;
  return { grantId, state: shown ? await entry.getAttribute("data-state") : null, text: shown ? (await entry.innerText()).slice(0, 600) : "", serverGrant: (await serverGrant(grantId)).status };
}

/** [B24-D2 CI fix, 2026-10-10] (a)'s hold. A route handler that never answers does not hold a request past its page: CI run
 *  38049453257 (`3773c6a`) logged the tender reaching the server (`POST /api/agent/execution-grant 200`) 105 ms before the reopened
 *  page's first request, with the grant then consumed, so the premise "held before it reaches the server" failed and the product
 *  answered, truthfully, for a consumed grant. The tender is sent instead to a local sink that accepts the connection and never
 *  answers or forwards (Playwright's `route.continue` with another URL, invisible to the page): the page still waits for the answer
 *  when it closes, and nothing a close releases can reach the server. The sink is closed after the run. Declared last so no line above moves. */
const sinkSockets = new Set<import("node:net").Socket>();
let sinkServer: import("node:net").Server | null = null;
async function sinkTender(route: Route): Promise<void> {
  if (!sinkServer) {
    const { createServer } = await import("node:net");
    const server = createServer((socket) => { sinkSockets.add(socket); socket.on("error", () => undefined); socket.on("close", () => sinkSockets.delete(socket)); });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    sinkServer = server;
  }
  const address = sinkServer.address() as import("node:net").AddressInfo;
  await route.continue({ url: `http://127.0.0.1:${address.port}${new URL(route.request().url()).pathname}` });
}
test.afterAll(async () => {
  for (const socket of sinkSockets) socket.destroy();
  if (sinkServer) await new Promise<void>((resolve) => sinkServer!.close(() => resolve()));
});
