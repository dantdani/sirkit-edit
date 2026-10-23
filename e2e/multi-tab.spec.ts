/**
 * [B24-D2] D24-30, OD-214 - two tabs of one browser profile on one synchronized board (a default-configuration spec: the orchestration
 * configuration runs `e2e-orchestration` only; every run of it is recorded in performance-and-reliability.md section 18). One `BrowserContext` is one profile: its two pages share cookies, localStorage and
 * IndexedDB. Page A is bootstrapped by the fixture journey (its own uuid namespace, `b24d2000`); page B opens `/` in the same context
 * with the frozen clock and reaches "Durable truth loaded" too.
 *
 *  1. A durable write, the sync publication (PcbEditor's `publish` path): A edits the schematic (Go to R1, its Value); B, loaded before
 *     that edit, cannot edit over it (the tabs' shared canonical store refuses the stale head: "The schematic is unchanged."); A
 *     publishes. [B24-D2B review, 2026-10-10] B, NEVER reloaded (a fully stale tab), then Syncs: its schematic is the content of the
 *     revision it hydrated, so the server answers that publication's replay and creates nothing; B's preflight is blocked as stale and
 *     B says so; any apply B is offered is refused; the board and the server's head stay A's. Then B reloads (the product's own way onto
 *     the current schematic), A edits and publishes again, B edits and Syncs on the snapshot revision its reload hydrated - refused
 *     PS_SNAPSHOT_REVISION_CONFLICT: the dialog names both revisions, nothing was overwritten, and the server's head (GET /api/pcb-sync,
 *     as the editor reads it) stays A's.
 *  2. The working copy: A edits the board (Go to R3, one arrow-key nudge), then B - which loaded before that edit - makes its own (two
 *     nudges). B's save is refused (compare-before-write, board-persistence.ts), its board is kept as the project's conflict record
 *     and B says so; A's copy is not replaced. After both pages reload, A's board is the working copy and B's the conflict record.
 *     Red on 3d5f225 if the INFERRED silent replacement holds (b24-d2-working-copy reproduced it at the unit level).
 *  3. No cross-tab channel: an init script counts BroadcastChannel constructions, storage-event listeners and navigator.locks
 *     requests on every document of the context; none is made.
 *
 * Stated limits: the fixture server keeps its stores in memory, so there is no server-restart case here (b24-d2-restart-pglite holds
 * the restart offline; a real-store restart is BLOCKED-LIVE-QUALIFICATION, LB-14). No pixel-coordinate automation: every edit is the
 * application's own control (Go to, the properties panel, the select tool's arrow-key nudge).
 */
import { expect, test, type BrowserContext, type Page, type Request, type Response } from "@playwright/test";
import { FIXTURE_CLOCK, bootstrapSynchronizedBoard, expectHydrated, openPcb, reloadAs } from "./fixture-journey";

test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);

/** B's notice when its save is refused (board-persistence.ts WORKING_COPY_CONFLICT_TOAST), matched by its two clauses. */
const WORKING_COPY_CONFLICT = /Another tab saved this project's board after this tab loaded it\.[\s\S]*preserved as a recoverable conflict record/;

let context: BrowserContext;
let pageA: Page;
let pageB: Page;
let origin: string;
/** Every cross-tab channel use any document of the context made: [kind, detail]. */
const crossTab: Array<[string, string]> = [];
/** The editor's board loads (GET /api/pcb-sync?boardId=...), per page: the request (to replay it) and its JSON. */
const boardLoads = new Map<Page, Array<{ request: Request; body: unknown }>>();

interface StoredBoard { footprints: Array<{ ref: string; at: { x: number; y: number } }> }
interface StoredProject { pcbWorking?: { board: StoredBoard; writeId?: string }; pcbWorkingConflict?: { board: StoredBoard; reason: string } }

function watchBoardLoads(page: Page): void {
  boardLoads.set(page, []);
  page.on("response", async (response: Response) => {
    const url = new URL(response.url());
    if (response.request().method() !== "GET" || url.pathname !== "/api/pcb-sync" || !url.searchParams.has("boardId")) return;
    boardLoads.get(page)!.push({ request: response.request(), body: await response.json().catch(() => null) });
  });
}
/** The snapshot head revision a board load reported (its manufacturing truth's `snapshot.revision`), found wherever it sits. */
function snapshotRevisionIn(body: unknown): number | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const snapshot = record.snapshot as { revision?: unknown } | null | undefined;
  if (snapshot && typeof snapshot === "object" && typeof snapshot.revision === "number") return snapshot.revision;
  for (const value of Object.values(record)) {
    const found = snapshotRevisionIn(value);
    if (found !== null) return found;
  }
  return null;
}
/** The project record both tabs share, as the browser stores it. */
async function storedProject(page: Page): Promise<StoredProject> {
  return page.evaluate(() => {
    const id = window.localStorage.getItem("sirkit:currentProjectId");
    return JSON.parse(window.localStorage.getItem(`sirkit:project:${id}`) ?? "{}") as StoredProject;
  });
}
const r3x = (board: StoredBoard | undefined): number | null => board?.footprints.find((footprint) => footprint.ref === "R3")?.at.x ?? null;

/** A person's schematic edit: Go to `ref` on the sheet, then its Value in the properties panel (commits on Enter). [B24-D2B] `committed`
 *  false: an edit the canonical store refuses and rolls back, so the field is not held to the typed value (the caller asserts the notice). */
async function editValue(page: Page, ref: string, value: string, committed = true): Promise<void> {
  await page.getByTestId("view-tab-schematic").click();
  const canvas = page.getByTestId("schematic-canvas");
  await expect(canvas).toBeVisible();
  await page.getByTestId("schematic-goto-input").fill(ref);
  await page.getByTestId("schematic-goto").click();
  await expect.poll(async () => (JSON.parse((await canvas.getAttribute("data-view")) ?? "{}") as { selection?: { refdes?: string | null } }).selection?.refdes).toBe(ref);
  const input = page.getByText("Value", { exact: true }).last().locator("xpath=following-sibling::input[1]");
  await expect(input).toBeVisible();
  await input.fill(value);
  await input.press("Enter");
  if (committed) await expect(input).toHaveValue(value);
  await page.getByTestId("view-tab-pcb").click();
  await expect(page.getByTestId("p2g-hydration")).toContainText("Durable truth loaded");
}
/** Sync (bindings -> publication -> preflight) from the toolbar's Schematic -> PCB control (SyncButton.tsx; `sync-schematic-to-pcb` is the empty state's only); resolves with the publication's response JSON. */
async function syncAndPublish(page: Page): Promise<{ status: number; body: Record<string, unknown> }> {
  const published = page.waitForResponse((response) => {
    if (response.request().method() !== "POST" || new URL(response.url()).pathname !== "/api/pcb-sync") return false;
    try { const sent = response.request().postDataJSON() as { operation?: unknown; request?: { requestId?: unknown } }; return sent.operation === "publish_demo_snapshot" && String(sent.request?.requestId ?? "").startsWith("publish:"); } catch { return false; } // [B24-D2B, 2026-10-10] the wire shape is { operation, request } (d2b-multitab-3's trace)
  }, { timeout: 90_000 });
  await page.getByRole("button", { name: /^Schematic to PCB: synchronises the whole project/ }).click(); // [PR-J4 integration, 2026-10-23] pin move: the control states it synchronises the whole project (OD-258 item 6; was the exact "Schematic to PCB"; the anchored regex still excludes the "placement options" button); [B24-D2B, 2026-10-10] the board's toolbar control (d2b-multitab-2: the empty state's test id waited 90 s)
  const response = await published;
  return { status: response.status(), body: (await response.json().catch(() => ({}))) as Record<string, unknown> };
}
/** A person's board edit: Go to `ref` (select + focus), then the select tool's arrow-key nudge, `steps` times. */
async function nudge(page: Page, ref: string, steps: number): Promise<void> {
  await page.getByTestId("pcb-goto-input").fill(ref);
  await page.getByTestId("pcb-goto").click();
  await expect.poll(async () => JSON.parse((await page.getByTestId("pcb-editor").getAttribute("data-view")) ?? "{}").selection?.primary?.kind).toBe("footprint");
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()); // the editor's keys ignore editable targets
  for (let index = 0; index < steps; index += 1) await page.keyboard.press("ArrowRight");
}

test.beforeAll(async ({ browser, baseURL }) => {
  origin = baseURL!;
  context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  await context.exposeBinding("__sirkitCrossTab", (_source, kind: string, detail: string) => { crossTab.push([kind, detail]); });
  await context.addInitScript(() => {
    const report = (kind: string, detail: string): void => { void (window as unknown as { __sirkitCrossTab?: (kind: string, detail: string) => Promise<void> }).__sirkitCrossTab?.(kind, detail); };
    const Native = window.BroadcastChannel;
    if (typeof Native === "function") {
      window.BroadcastChannel = class extends Native { constructor(name: string) { report("BroadcastChannel", String(name)); super(name); } } as typeof BroadcastChannel;
    }
    const add = window.addEventListener.bind(window) as (...args: unknown[]) => void;
    window.addEventListener = ((type: string, ...rest: unknown[]) => { if (type === "storage") report("storage-listener", "addEventListener"); add(type, ...rest); }) as typeof window.addEventListener;
    Object.defineProperty(window, "onstorage", { configurable: true, get: () => null, set: () => { report("storage-listener", "onstorage"); } });
    const locks = (navigator as unknown as { locks?: { request: (...args: unknown[]) => unknown } }).locks; // a plain shape: LockManager's overloads cannot take a spread
    if (locks) {
      const request = locks.request.bind(locks);
      locks.request = (...args: unknown[]) => { report("navigator.locks", String(args[0])); return request(...args); };
    }
  });
  pageA = await context.newPage();
  watchBoardLoads(pageA);
  await bootstrapSynchronizedBoard(pageA, context, origin, "b24d2000");
  pageB = await context.newPage();
  watchBoardLoads(pageB);
  await pageB.clock.setFixedTime(new Date(FIXTURE_CLOCK));
  await pageB.goto("/");
  await expect(pageB.getByTestId("fixture-runtime-banner")).toBeVisible();
  await expectHydrated(pageB);
  await openPcb(pageB, true);
  await expect(pageA.getByTestId("p2g-hydration")).toContainText("Durable truth loaded");
});

test.afterAll(async () => { await context.close(); });

test("1. a durable write, the sync publication: A publishes first; B, never reloaded, creates no publication, its preflight is blocked and its stale plan never applied; B, reloaded, on the snapshot revision it hydrated, is refused PS_SNAPSHOT_REVISION_CONFLICT - the dialog names both revisions, nothing was overwritten, and the server's head stays A's", async ({}, testInfo) => {
  const hydratedB = snapshotRevisionIn(headLoad(pageB)?.body);
  expect(hydratedB, "B hydrated a snapshot head").not.toBeNull();
  await editValue(pageA, "R1", "4.7k");
  // [B24-D2B, 2026-10-10] B, loaded before A's edit, cannot edit the schematic over it: the tabs share the canonical schematic store,
  // which refuses B's stale head, and B says so (d2b-multitab-4: the first premise, that both tabs edit, does not hold)
  await editValue(pageB, "R1", "6.8k", false);
  await expect(pageB.getByText(/"Changed R1 value to 6\.8k" could not be committed and was rolled back \(STORE_HEAD_MISMATCH:\d+\)\. The schematic is unchanged\./).first()).toBeVisible();
  const a = await syncAndPublish(pageA);
  expect(a.status, JSON.stringify(a.body).slice(0, 300)).toBe(201); expect(a.body).toMatchObject({ ok: true, result: { created: true, snapshotRevision: hydratedB! + 1 } }); // [B24-D2B, 2026-10-10] a NEW publication answers 201 (handler.ts:130; d2b-multitab-3: A's was created at revision 2)

  // [B24-D2B review, 2026-10-10] The fully stale tab (the original spec's path, d2b-multitab-4): B never reloaded and Syncs after A's
  // publication. Its schematic is the content of the revision it hydrated, so the content-addressed publication key is that revision's
  // and the server answers its replay (durable.ts:82-85 compares the digest, the board and the actor, not the expected revision):
  // nothing is created. B's preflight must be blocked as stale and B must say so; any apply B is offered must be refused; the board
  // and the server's head must stay A's - each read back from the server, never inferred.
  const boardBefore = await serverBoard(pageA);
  const preflightB = nextSyncCall(pageB, "preflight");
  const stale = await syncAndPublish(pageB);
  expect(stale.status, JSON.stringify(stale.body).slice(0, 300)).not.toBe(201);
  expect(stale.body, "B's stale Sync creates no publication: the replay of the revision it hydrated").toMatchObject({ ok: true, result: { created: false, idempotent: true, snapshotRevision: hydratedB } }); // [B24-D2B review 2, 2026-10-10] this pin records TODAY's behaviour (a replay, not a conflict) under an open owner question (durable.ts:84, OD-214): if the owner chooses the conflict, it moves by review to a 409 PS_SNAPSHOT_REVISION_CONFLICT, with the preflight and apply steps after it; "nothing created" and the board and head unchanged hold either way
  const preflighted = await preflightB;
  const preflightResult = (preflighted.body.result ?? {}) as { status?: unknown; blockers?: Array<{ code?: unknown }> };
  expect(preflighted.status).toBe(200);
  expect(preflightResult.status, "B's preflight is blocked as stale").toBe("blocked_stale_snapshot");
  expect((preflightResult.blockers ?? []).map((blocker) => blocker.code)).toContain("PS_SCHEMATIC_REVISION_MISMATCH");
  await expect(pageB.getByText(/^Sync blocked: .*PS_SCHEMATIC_REVISION_MISMATCH/).first(), "B says its Sync is blocked").toBeVisible();
  const applyB = pageB.getByTestId("apply-sync-plan-toolbar");
  const offered = await applyB.isVisible();
  testInfo.annotations.push({ type: "stale-tab-apply", description: offered ? "offered for the blocked plan; clicked; refused" : "not offered" });
  let applyAnswer: { status: number; body: Record<string, unknown> } | null = null;
  if (offered) {
    const applied = nextSyncCall(pageB, "apply");
    await applyB.click();
    const answer = await applied;
    applyAnswer = answer;
    expect(answer.status, JSON.stringify(answer.body).slice(0, 300)).toBeGreaterThanOrEqual(400);
    expect(answer.body, "the stale plan's apply is refused").toMatchObject({ ok: false });
    expect(answer.body.boardChanged ?? false).toBe(false);
    await expect(pageB.getByText(/^Apply failed: /).first(), "B says the apply failed").toBeVisible();
  }
  const boardAfter = await serverBoard(pageA);
  const headAfter = await serverHeadRevision(pageA);
  await testInfo.attach("stale-tab.json", { contentType: "application/json", body: JSON.stringify({ hydratedB, publication: { status: stale.status, ...(({ created, idempotent, snapshotRevision }) => ({ created, idempotent, snapshotRevision }))((stale.body.result ?? {}) as Record<string, unknown>) }, preflight: { status: preflighted.status, result: preflightResult.status, blockers: (preflightResult.blockers ?? []).map((blocker) => blocker.code) }, applyOffered: offered, apply: applyAnswer, boardBefore, boardAfter, headAfter }, null, 2) });
  expect(boardAfter, "the board B's stale plan targeted is unchanged").toEqual(boardBefore);
  expect(headAfter, "the server's head stays A's publication").toBe(hydratedB! + 1);

  // B reloads - the product's own way onto the current schematic - after A's next edit and before A publishes it
  await editValue(pageA, "R1", "5.6k");
  const headLoadsB = headLoads(pageB).length;
  await reloadAs(pageB, context, "editor", origin, true);
  await expect.poll(() => headLoads(pageB).length).toBeGreaterThan(headLoadsB);
  const reloadedB = snapshotRevisionIn(headLoad(pageB)?.body);
  expect(reloadedB, "B's head after its reload: A's first publication (A has not published its next edit yet)").toBe(hydratedB! + 1);
  const a2 = await syncAndPublish(pageA);
  expect(a2.status, JSON.stringify(a2.body).slice(0, 300)).toBe(201); expect(a2.body).toMatchObject({ ok: true, result: { created: true, snapshotRevision: reloadedB! + 1 } });
  await editValue(pageB, "R1", "6.8k"); // on the current schematic now; its publication base is still reloadedB
  const b = await syncAndPublish(pageB);
  expect(b.status).toBe(409);
  expect(b.body).toMatchObject({ code: "PS_SNAPSHOT_REVISION_CONFLICT" });
  const dialog = pageB.getByTestId("snapshot-conflict-dialog");
  await expect(dialog).toBeVisible();
  await expect(pageB.getByTestId("snapshot-conflict-expected")).toHaveText(`revision ${reloadedB}`);
  await expect(pageB.getByTestId("snapshot-conflict-current")).toContainText(`revision ${reloadedB! + 1}`);
  await expect(pageB.getByText(/nothing was overwritten/).first()).toBeVisible();
  // the server's head, read as the editor reads it (its own board load, replayed): A's publication
  expect(await serverHeadRevision(pageA)).toBe(reloadedB! + 1);
  await pageB.getByTestId("snapshot-conflict-dismiss").click();
  await expect(dialog).toBeHidden();
});

test("2. the working copy: A edits, then B (loaded before that edit) edits - B's save is refused, its board kept as the conflict record, and B says so; after both reload, A's board is the working copy and B's the conflict record", async () => {
  const before = await storedProject(pageA);
  const x0 = r3x(before.pcbWorking?.board);
  expect(x0, "the synchronized board's working copy carries R3").not.toBeNull();
  await nudge(pageA, "R3", 1);
  await expect.poll(async () => r3x((await storedProject(pageA)).pcbWorking?.board), { timeout: 30_000 }).not.toBe(x0);
  const xa = r3x((await storedProject(pageA)).pcbWorking?.board)!;
  await nudge(pageB, "R3", 2);
  await expect(pageB.getByText(WORKING_COPY_CONFLICT).first()).toBeVisible({ timeout: 30_000 }).catch(async (error: unknown) => { await explainNoConflict(xa); throw error; }); // [B24-D2 CI fix, 2026-10-10] the same expectation; on its failure the state is printed first
  await expect(pageB.getByTestId("pcb-save-status")).toBeVisible();
  const after = await storedProject(pageB);
  expect(r3x(after.pcbWorking?.board), "A's copy is not replaced").toBe(xa);
  const xb = r3x(after.pcbWorkingConflict?.board);
  expect(xb, "B's board is kept as the conflict record").not.toBeNull();
  expect(xb).not.toBe(xa);
  expect(after.pcbWorkingConflict?.reason).toMatch(/another tab/i);
  // both pages reload: the surviving state and the record stand
  await reloadAs(pageA, context, "editor", origin, true);
  await reloadAs(pageB, context, "editor", origin, true);
  const reloaded = await storedProject(pageA);
  expect(r3x(reloaded.pcbWorking?.board)).toBe(xa);
  expect(r3x(reloaded.pcbWorkingConflict?.board)).toBe(xb);
  await expect(pageA.getByText(WORKING_COPY_CONFLICT)).toHaveCount(0);
});

test("3. no cross-tab channel: no document of the context made a BroadcastChannel, a storage-event listener or a navigator.locks request", async () => {
  expect(crossTab).toEqual([]);
});

/** [B24-D2B, 2026-10-10] The page's last board load that carries the snapshot head: the editor takes its publication base from the
 *  manufacturing truth (`include=manufacturing`, PcbEditor.tsx:1185-1196); a plain board load carries the board record only. The
 *  first runs read `.at(-1)` of every load, in the order the responses completed, and met a plain one (d2b-multitab-1: B's second
 *  plain load completed last, 351 ms against the manufacturing load's 267 ms): null, "B hydrated a snapshot head" red with the head
 *  present beside it (revision 1). Declared last so no test line above moves. */
function headLoad(page: Page): { request: Request; body: unknown } | undefined {
  return headLoads(page).at(-1);
}
/** [B24-D2B, 2026-10-10] Every board load of the page that carries the snapshot head, in the order the responses completed. */
function headLoads(page: Page): Array<{ request: Request; body: unknown }> {
  return boardLoads.get(page)!.filter((load) => new URL(load.request.url()).searchParams.get("include") === "manufacturing");
}
/** [B24-D2B review, 2026-10-10] Replay one of the page's own board loads (its URL and headers, as the editor sent them): 200 and its JSON. */
async function replayLoad(page: Page, load: { request: Request } | undefined): Promise<unknown> {
  expect(load, "the page made this board load").toBeDefined();
  const answer = await page.request.get(load!.request.url(), { headers: await load!.request.allHeaders() });
  expect(answer.status()).toBe(200);
  return answer.json();
}
/** [B24-D2B review, 2026-10-10] The server's snapshot head now, read as the editor reads it (its manufacturing board load, replayed). */
async function serverHeadRevision(page: Page): Promise<number | null> {
  return snapshotRevisionIn(await replayLoad(page, headLoad(page)));
}
/** [B24-D2B review, 2026-10-10] The server's board record now (its plain board load, replayed): the revision and digest. */
async function serverBoard(page: Page): Promise<{ revision: unknown; digest: unknown }> {
  const plain = boardLoads.get(page)!.filter((load) => !new URL(load.request.url()).searchParams.has("include")).at(-1);
  const record = ((await replayLoad(page, plain)) as { result?: { record?: { revision?: unknown; digest?: unknown } } }).result?.record;
  expect(record, "the board load carries the board record").toBeDefined();
  return { revision: record!.revision, digest: record!.digest };
}
/** [B24-D2B review, 2026-10-10] The page's next POST /api/pcb-sync of one operation (`preflight`, `apply`): its status and JSON. */
async function nextSyncCall(page: Page, operation: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await page.waitForResponse((candidate) => {
    if (candidate.request().method() !== "POST" || new URL(candidate.url()).pathname !== "/api/pcb-sync") return false;
    try { return (candidate.request().postDataJSON() as { operation?: unknown }).operation === operation; } catch { return false; }
  }, { timeout: 90_000 });
  return { status: response.status(), body: (await response.json().catch(() => ({}))) as Record<string, unknown> };
}

/** [B24-D2 CI fix, 2026-10-10] CI run 38049453257 (`3773c6a`) failed case 2 here (B's conflict notice not visible in 30 s) and kept
 *  nothing that says why; it passed every local run, 4x CPU-throttled included. Never an assertion: printed to the run's output before
 *  the expectation's own error is rethrown - B's selection, its focus, its save status and any toast it shows; R3 in the stored working
 *  copy (A's position is `xa`) and in the conflict record, and the copy's write token. Declared last so no line above moves. */
async function explainNoConflict(xa: number): Promise<void> {
  const stored = await storedProject(pageB);
  const view = JSON.parse((await pageB.getByTestId("pcb-editor").getAttribute("data-view").catch(() => null)) ?? "{}") as { selection?: unknown };
  const saveStatus = await pageB.getByTestId("pcb-save-status").innerText({ timeout: 1_000 }).catch(() => "(no save status)");
  const focus = await pageB.evaluate(() => { const active = document.activeElement as HTMLElement | null; return active ? `${active.tagName}${active.getAttribute("data-testid") ? `[data-testid=${active.getAttribute("data-testid")}]` : ""}` : "(none)"; });
  const toasts = await pageB.getByText(/Another tab|autosave|could not|refused|conflict/i).allInnerTexts().catch(() => [] as string[]);
  const working = stored.pcbWorking as (StoredProject["pcbWorking"] & { writeId?: unknown; updatedAt?: unknown }) | undefined;
  console.log(`[B24-D2 CI fix] case 2, no conflict notice on B: ${JSON.stringify({ xa, storedWorkingR3: r3x(stored.pcbWorking?.board), storedWorkingToken: working?.writeId ?? null, storedWorkingUpdatedAt: working?.updatedAt ?? null, conflictR3: r3x(stored.pcbWorkingConflict?.board), conflictReason: stored.pcbWorkingConflict?.reason ?? null, bSelection: view.selection ?? null, bFocus: focus, bSaveStatus: saveStatus, bTexts: toasts.map((text) => text.slice(0, 200)).slice(0, 6) })}`);
}
