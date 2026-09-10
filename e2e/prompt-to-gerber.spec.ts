/**
 * B16-C.5 — page-level browser proof of the prompt-to-Gerber flow against the
 * REAL Next.js application under the env-gated FIXTURE RUNTIME (no database,
 * no provider credits, no live router; recorded provider design, recorded
 * FreeRouting run replayed by placed-board revision, dev-only role cookie).
 *
 * A FRESH browser (empty storage, no cookies) proves, in order:
 *  1. project bootstrap and hydration of the fixture runtime;
 *  2. prompt entry;
 *  3. the schematic proposal and its explicit approval;
 *  4. the component-review handoff (editor requests, reviewer approves, editor resumes);
 *  5. PCB sync and the explicit approval of the exact plan;
 *  6. qualification (duplicate click → one request);
 *  7. the SEPARATE administrator release authorization;
 *  8. download and INDEPENDENT verification of the archive bytes;
 *  9. refresh after every durable boundary (state comes back from the server);
 * 10. cross-project isolation;
 * 11. clear, bounded failures (a viewer's request is refused with a code, nothing changes).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { verifyReleaseArchiveIndependently } from "../app/lib/pcb/fab/independent-archive-verifier";
import { BLINKER_ACCEPTANCE_PROMPT } from "../app/lib/fixture-runtime/blinker/catalog";
import { FIXTURE_CLOCK_DEFAULT } from "../app/lib/fixture-runtime/clock";

/** The fixture runtime's frozen instant (server: instrumentation.ts; browser: Playwright's fixed clock). */
const FIXTURE_CLOCK = process.env.SIRKIT_FIXTURE_CLOCK?.trim() || FIXTURE_CLOCK_DEFAULT;

type Role = "editor" | "reviewer" | "admin" | "viewer";
const REFS = ["U1", "R1", "R2", "R3", "C1", "C2", "C3", "D1", "J1"] as const;

async function actAs(context: BrowserContext, role: Role, baseURL: string): Promise<void> {
  await context.clearCookies();
  await context.addCookies([{ name: "sirkit-fixture-role", value: role, url: baseURL }]);
}

/** Open the PCB view. Before a board exists the editor shows its empty state (no manufacturing
 *  panel: there is nothing durable to hydrate); once a board exists the panel hydrates durable truth. */
async function openPcb(page: Page, board: boolean): Promise<void> {
  await page.getByTestId("view-tab-pcb").click();
  if (board) {
    await expect(page.getByTestId("p2g-panel")).toBeVisible();
    await expect(page.getByTestId("p2g-hydration")).toContainText("Durable truth loaded");
  } else {
    await expect(page.getByTestId("pcb-empty-state")).toBeVisible();
  }
}

async function reloadAs(page: Page, context: BrowserContext, role: Role, baseURL: string, board: boolean): Promise<void> {
  await actAs(context, role, baseURL);
  await page.clock.setFixedTime(new Date(FIXTURE_CLOCK));
  await page.reload();
  await expect(page.getByTestId("fixture-runtime-banner")).toBeVisible();
  await openPcb(page, board);
}

async function expectWorkflowState(page: Page, state: string, timeout = 60_000): Promise<void> {
  await expect(page.getByTestId("p2g-workflow-state")).toHaveAttribute("data-state", state, { timeout });
}

test.describe.configure({ mode: "serial" });

// Replay (CI default) answers the router from the committed recording in seconds; RECORD runs the
// bundled FreeRouting for real (minutes) — the budget follows the mode, nothing else changes.
const RECORDING = process.env.SIRKIT_FIXTURE_ROUTER === "record" || process.env.SIRKIT_FIXTURE_ROUTER === "live";
const QUALIFY_BUDGET_MS = RECORDING ? 900_000 : 170_000;
test.setTimeout(RECORDING ? 1_500_000 : 300_000);

test("fresh browser: prompt → approval → review handoff → sync/apply → qualify → admin release → download + independent verification → refresh → duplicate click → cross-project → bounded failure", async ({ page, context, baseURL }) => {
  const origin = baseURL!;
  // Deterministic browser identities: the application mints project, component and wire ids
  // with `crypto.randomUUID()`, and the placed-board revision (the router recording's key)
  // includes the footprint/sync identities, so a random browser could never replay the
  // committed FreeRouting run. The test replaces ONLY the browser's UUID source with a
  // sequence persisted in localStorage (so reloads continue it and no two ids ever collide);
  // the application code is untouched.
  await context.addInitScript(() => {
    const next = (): string => {
      let n = 0;
      try { n = Number(window.localStorage.getItem("sirkit-e2e-uuid-seq") ?? "0"); } catch { n = 0; }
      n += 1;
      try { window.localStorage.setItem("sirkit-e2e-uuid-seq", String(n)); } catch { /* storage unavailable: still unique within this document */ }
      return `b16c0000-e2e0-4000-8000-${String(n).padStart(12, "0")}`;
    };
    Object.defineProperty(crypto, "randomUUID", { value: next, configurable: true });
  });
  // The browser's Date is frozen at the fixture runtime's instant (timers keep running): the request
  // timestamps the page sends are part of the durable identities the router recording is keyed by.
  await page.clock.setFixedTime(new Date(FIXTURE_CLOCK));
  // 1. fresh browser, fixture runtime on, project bootstrapped from nothing durable.
  await actAs(context, "editor", origin);
  await page.goto("/");
  await expect(page.getByTestId("fixture-runtime-banner")).toBeVisible();
  await expect(page.getByTestId("local-dev-identity-banner")).toBeVisible();

  // 2–3. prompt (the AI chat composer is a panel the user opens) → recorded provider design → explicit approval of the proposal.
  await page.getByTestId("activity-ai chat").click();
  const prompt = page.getByTestId("prompt-input");
  await expect(prompt).toBeEnabled();
  await prompt.fill(BLINKER_ACCEPTANCE_PROMPT);
  await prompt.press("Enter");
  await expect(page.getByTestId("schematic-proposal-review")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId("schematic-proposal-summary")).toContainText(/U1|555/);
  await page.getByTestId("schematic-proposal-approve").click();
  await expect(page.getByTestId("schematic-proposal-review")).toBeHidden();

  // 4. the component-review handoff: an editor cannot publish a binding, so Sync stops and says so; the editor requests review.
  await openPcb(page, false);
  await expect(page.getByTestId("component-review-panel")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("component-review-viewer")).toContainText("pcb_editor");
  await page.getByTestId("sync-schematic-to-pcb").click();
  await expect(page.getByText(/reviewer approval required/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("pcb-empty-state")).toBeVisible(); // no board was created
  await page.getByTestId("review-request-all").click();
  await expect(page.getByTestId("component-review-pending")).toHaveText(`${REFS.length} pending`, { timeout: 30_000 });
  for (const ref of REFS) await expect(page.getByTestId(`review-state-${ref}`)).toHaveAttribute("data-state", "pending");
  // 9. refresh: the requests are durable, not browser memory — and still no board (nothing durable was written by the refused sync).
  await reloadAs(page, context, "editor", origin, false);
  await expect(page.getByTestId("component-review-pending")).toHaveText(`${REFS.length} pending`, { timeout: 30_000 });
  // the reviewer decides against the server-projected evidence.
  await reloadAs(page, context, "reviewer", origin, false);
  await expect(page.getByTestId("component-review-viewer")).toContainText("reviewer · may approve");
  await page.getByTestId("review-evidence-toggle-U1").click();
  await expect(page.getByTestId("review-evidence-U1")).toContainText(/Pin → pad/);
  for (const ref of REFS) {
    await page.getByTestId(`review-approve-${ref}`).click();
    await expect(page.getByTestId(`review-state-${ref}`)).toHaveAttribute("data-state", "approved", { timeout: 30_000 });
  }
  await expect(page.getByTestId("component-review-pending")).toHaveText("0 pending");
  await expect(page.getByTestId("review-approve-U1")).toHaveCount(0); // nothing left for the reviewer to decide
  // the editor resumes: nothing unrelated was rebuilt.
  await reloadAs(page, context, "editor", origin, false);
  for (const ref of REFS) await expect(page.getByTestId(`review-state-${ref}`)).toHaveAttribute("data-state", "approved", { timeout: 30_000 });

  // 5. PCB sync: publication → preflight → the exact plan → explicit apply.
  await page.getByTestId("sync-schematic-to-pcb").click();
  const apply = page.locator('[data-testid^="apply-sync-plan"]').first();
  await expect(apply).toBeVisible({ timeout: 90_000 });
  await apply.click();
  await expectWorkflowState(page, "awaiting_qualification", 90_000);
  await expect(page.getByTestId("pcb-save-status")).toBeVisible();
  await reloadAs(page, context, "editor", origin, true);
  await expectWorkflowState(page, "awaiting_qualification");

  // 6. qualification: two rapid clicks → ONE request (the button is disabled while pending, the server refuses a concurrent run).
  let qualifyRequests = 0;
  page.on("request", (request) => { if (request.method() === "POST" && new URL(request.url()).pathname === "/api/pcb/qualify") qualifyRequests += 1; });
  const qualify = page.getByTestId("p2g-qualify");
  await expect(qualify).toBeEnabled();
  await qualify.click();
  await qualify.click({ force: true, noWaitAfter: true }).catch(() => undefined);
  // fail fast on a refused/failed qualification instead of waiting the whole router budget.
  await expect(page.locator('[data-testid="p2g-workflow-state"]:is([data-state="qualified"], [data-state="qualification_failed"]), [data-testid="p2g-error"]').first()).toBeVisible({ timeout: QUALIFY_BUDGET_MS });
  await expect(page.getByTestId("p2g-error")).toHaveCount(0);
  await expectWorkflowState(page, "qualified", 5_000);
  expect(qualifyRequests).toBe(1);
  await reloadAs(page, context, "editor", origin, true);
  await expectWorkflowState(page, "qualified");
  // an editor may not release: the server-derived capability disables it and says why.
  await expect(page.getByTestId("p2g-request-release")).toBeDisabled();
  await expect(page.getByTestId("p2g-release-capability")).toBeVisible();

  // 7. the SEPARATE administrator authorization, naming the exact sealed authority.
  await reloadAs(page, context, "admin", origin, true);
  const downloadLog: string[] = [];
  page.on("download", (item) => {
    downloadLog.push(`download event: ${item.suggestedFilename()} from ${item.url().slice(0, 40)}`);
    void item.failure().then((failure) => downloadLog.push(`download settled: ${item.suggestedFilename()} failure=${failure ?? "none"}`));
  });
  page.on("console", (message) => { if (message.type() === "error" || message.type() === "warning") downloadLog.push(`console ${message.type()}: ${message.text().slice(0, 200)}`); });
  await expectWorkflowState(page, "qualified");
  await page.getByTestId("p2g-request-release").click();
  await expect(page.getByTestId("p2g-release-dialog")).toBeVisible();
  await expect(page.getByTestId("p2g-release-confirmation")).toContainText(/authority/i);
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 120_000 }),
    page.getByTestId("p2g-authorize-release").click(),
  ]);
  await expectWorkflowState(page, "released", 120_000);
  await expect(page.getByTestId("p2g-release-result")).toBeVisible();
  const sha = (await page.getByTestId("p2g-release-sha").textContent())?.trim() ?? "";
  expect(sha).toMatch(/^[0-9a-f]{64}$/);
  await expect(page.getByTestId("p2g-release-authority")).toHaveText("1"); // the first and only authority of this board

  // 8. the downloaded bytes ARE the released archive, and an independent reader agrees with the manifest and the board.
  const path = await download.path().catch((error: unknown) => { throw new Error(`download.path failed: ${error instanceof Error ? error.message : String(error)}\n${downloadLog.join("\n")}`); });
  expect(path, downloadLog.join("\n")).toBeTruthy();
  const bytes = new Uint8Array(readFileSync(path!));
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(sha);
  const report = await verifyReleaseArchiveIndependently(bytes, { archiveSha256: sha, expectedComponents: REFS.length });
  expect(report.checks.filter((item) => !item.ok).map((item) => `${item.name}: ${item.detail}`)).toEqual([]);
  expect(report.ok).toBe(true);

  // 9. refresh after the release: the released state comes back from the server, not from browser memory.
  await reloadAs(page, context, "admin", origin, true);
  await expectWorkflowState(page, "released");
  // a second authorization of the SAME authority is idempotent (same archive digest), never a second release.
  await page.getByTestId("p2g-request-release").click();
  await expect(page.getByTestId("p2g-release-dialog")).toBeVisible();
  const [again] = await Promise.all([page.waitForEvent("download", { timeout: 120_000 }), page.getByTestId("p2g-authorize-release").click()]);
  await expect(page.getByTestId("p2g-release-result")).toBeVisible();
  const againSha = (await page.getByTestId("p2g-release-sha").textContent())?.trim();
  expect(againSha).toBe(sha);
  expect(createHash("sha256").update(readFileSync((await again.path())!)).digest("hex")).toBe(sha);

  // 10. cross-project isolation: a NEW project sees nothing of this one.
  await page.getByTestId("activity-projects").click();
  await page.getByTestId("new-project").click();
  await openPcb(page, false);
  await expect(page.getByTestId("p2g-panel")).toHaveCount(0); // no board, no manufacturing state
  await expect(page.getByTestId("p2g-release-result")).toHaveCount(0);
  await expect(page.getByTestId("component-review-panel")).toHaveCount(0); // no exact candidates in an empty project

  // 11. a clear, bounded failure: a viewer's qualification request is refused with a public code and changes nothing.
  await actAs(context, "viewer", origin);
  const refused = await page.request.post("/api/pcb/qualify", { headers: { "content-type": "application/json", origin, "x-sirkit-tenant-id": "local", "x-sirkit-project-id": "any", "x-sirkit-branch-id": "main" }, data: { boardId: "board:any", designId: "design:any" } });
  expect([401, 403]).toContain(refused.status());
  const body = (await refused.json()) as { ok?: boolean; code?: string; error?: string };
  expect(body.ok).toBe(false);
  expect(typeof body.code).toBe("string");
  expect(String(body.error ?? "")).not.toMatch(/at .*\.(ts|js):\d+/); // no stack, no internals
});
