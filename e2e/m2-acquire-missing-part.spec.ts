/**
 * [PR-M, 2026-10-18] Section M2 (runbook M.5 item 4's browser half) in a FRESH browser under the fixture runtime (the committed fixture
 * catalog, the fixture CAD source's committed KiCad bytes served through the production egress path, the real generation worker pumping
 * the component-resolution topic, the scripted agent, in-memory stores; no database, provider, embedding, distributor or live network):
 *
 *  1. a sheet whose D1 / D2 are placed from the catalog's 1N4001 - a part with NO published revision of the same exact part anywhere in
 *     the library - is opened as a project file; Prepare PCB refuses and names D1 and D2;
 *  2. the Missing parts list's "Obtain the part's assets" starts the durable acquisition task: its stages show the real steps (the local
 *     library searched with its result, the admitted fixture source used, the stored objects' hashes, the parse and validation) and a
 *     VALIDATED GENERIC KiCad candidate (FIXTURE evidence, CC-BY-SA licence) waiting for a person; nothing in the design changed;
 *  3. the editor sends it for component review; in the catalog governance project the component review inbox lists the package and
 *     opens the EXISTING publication review prefilled with the acquired symbol and footprint objects and the link the handoff decided;
 *     the editor requests review (entering the manufacturer they verified), a reviewer approves, a DIFFERENT administrator publishes;
 *  4. back in the project, "Check again" lets the task find the published revision (M1's candidate search) and offer it; "Offer the
 *     replacement" takes the existing replacement path: the review dialog shows the batch, Approve commits ONE canonical transaction with
 *     its receipt; the task records the receipt and the server-computed Prepare PCB check (no unresolved part).
 *
 * Fake-backed: it proves the page's contract and the authority chain over fixture evidence - not a live CAD source, a manufacturer
 * datasheet, a live model or a live catalog.
 */
import { createHash } from "node:crypto";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type { SchematicState } from "../lib/schematic-types";
import { canonicalJson } from "../app/lib/pcb/revision";
import { M2_ACQUISITION_PART_ID } from "../app/lib/fixture-runtime/blinker/catalog";
import { FIXTURE_CATALOG_GOVERNANCE } from "../app/lib/fixture-runtime/container";
import { DIMMER_INSTANCE_IDS, fixtureDimmerSheet } from "../app/lib/fixture-runtime/__tests__/_resolution-sheet";
import { actAs, installDeterministicBrowser } from "./fixture-journey";

test.describe.configure({ mode: "serial" });
test.setTimeout(420_000);

const NOW = Date.parse("2026-10-18T00:00:00.000Z");
const PART = M2_ACQUISITION_PART_ID;
const SCREENSHOTS = "artifacts/product-reliability-simple-ui/screenshots";

/** The fixture dimmer with D1 / D2 placed from the acquisition part (1N4001): same ids, references, positions and wires. */
function acquisitionSheet(): SchematicState {
  const sheet = fixtureDimmerSheet();
  return { ...sheet, kicadComponents: (sheet.kicadComponents ?? []).map((instance) => (instance.id === DIMMER_INSTANCE_IDS.D1 || instance.id === DIMMER_INSTANCE_IDS.D2 ? { id: instance.id, partId: PART, x: instance.x, y: instance.y, rotation: instance.rotation, refDes: instance.refDes, value: "1N4001" } : instance)) };
}

/** A valid `.sirkit.json` project file (the importer's envelope and integrity digest). */
function projectFile(projectId: string, name: string, state: SchematicState): { name: string; mimeType: string; buffer: Buffer } {
  const payload = { project: { id: projectId, name, state, createdAt: NOW, updatedAt: NOW, schemaVersion: 2 }, checkpoints: [] };
  const canonical = canonicalJson(payload);
  const envelope = { format: "sirkit-project", formatVersion: 1, exportedAt: new Date(NOW).toISOString(), integrity: `sha256:${createHash("sha256").update(canonical).digest("hex")}`, payload: JSON.parse(canonical) as unknown };
  return { name: `${name}.sirkit.json`, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(envelope)) };
}

async function openProject(page: Page, projectId: string, name: string, state: SchematicState, missingParts = true): Promise<void> {
  await page.locator('input[type="file"][accept*=".sirkit.json"]').setInputFiles(projectFile(projectId, name, state));
  await expect(page.getByRole("button", { name: new RegExp(name) })).toBeVisible({ timeout: 30_000 });
  // the Build Library panel carries the design checks and the Missing parts line (its activity button toggles it)
  if (missingParts && !(await page.getByTestId("missing-parts-open").isVisible())) await page.getByTestId("activity-build library").click();
}

async function start(page: Page, context: BrowserContext, origin: string, namespace: string): Promise<void> {
  await page.setViewportSize({ width: 1366, height: 768 });
  await installDeterministicBrowser(page, context, namespace);
  await actAs(context, "editor", origin);
  await page.goto("/");
  await expect(page.getByTestId("fixture-runtime-banner")).toBeVisible();
  await expect(page.getByRole("button", { name: /Untitled project/ })).toBeVisible({ timeout: 120_000 });
}

/** Show the Build Library panel (its activity button toggles it; the active button carries the highlighted background). */
async function ensureBuildLibrary(page: Page): Promise<void> {
  const button = page.getByTestId("activity-build library");
  if (!((await button.getAttribute("class")) ?? "").split(/ +/).includes("bg-zinc-800")) await button.click();
}

async function preparePcb(page: Page): Promise<void> {
  let action = await page.getByTestId("journey-next-action").getAttribute("data-action-id");
  if (action === "open_pcb") {
    await page.getByTestId("journey-next-action").click();
    await expect(page.getByTestId("pcb-empty-state")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("journey-next-action")).toHaveAttribute("data-action-id", "prepare_pcb", { timeout: 30_000 });
    action = "prepare_pcb";
  }
  expect(action).toBe("prepare_pcb");
  await page.getByTestId("journey-next-action").click();
}

/** The task's public view through the page's own route (the same view the agent's acquisition-status reads). */
async function taskView(page: Page, projectId: string, taskId: string): Promise<Record<string, any>> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const response = await page.request.get(`/api/parts/acquisitions?taskId=${encodeURIComponent(taskId)}`, { headers: { "x-sirkit-tenant-id": "local", "x-sirkit-project-id": projectId, "x-sirkit-branch-id": "main" } });
  expect(response.status()).toBe(200);
  return ((await response.json()) as { task: Record<string, any> }).task; // eslint-disable-line @typescript-eslint/no-explicit-any
}

test("a missing part with no local candidate: Obtain the part's assets → validated GENERIC candidate → Send for component review → governance request, reviewer approves, a different admin publishes → Check again → Offer the replacement → Approve → receipt and the task's Prepare PCB check", async ({ page, context, baseURL, browser }) => {
  const origin = baseURL!;
  const projectId = "m2-acquire-0001";
  await start(page, context, origin, "m2000001");
  await openProject(page, projectId, "LED dimmer M2", acquisitionSheet());
  await expect(page.getByTestId("missing-parts-open")).toHaveAttribute("data-count", "2", { timeout: 30_000 });

  // 1. Prepare PCB refuses and names D1 and D2
  await preparePcb(page);
  await expect(page.getByTestId("sync-blockers")).toBeVisible({ timeout: 60_000 });
  for (const ref of ["D1", "D2"]) await expect(page.getByTestId(`sync-unresolved-${ref}`)).toHaveAttribute("data-missing", "published_exact_revision");

  // 2. Obtain the part's assets: the durable task runs in the worker; each stage carries its own evidence
  const panel = page.getByTestId(`missing-acquisition-${PART}`);
  await expect(panel).toHaveAttribute("data-next", "start");
  const started = page.waitForResponse((response) => response.url().endsWith("/api/parts/acquisitions") && response.request().method() === "POST");
  await page.getByTestId(`missing-acquire-start-${PART}`).click();
  const startBody = (await (await started).json()) as { ok: boolean; task: { taskId: string } };
  expect(startBody.ok).toBe(true);
  const taskId = startBody.task.taskId;
  expect(taskId).toMatch(/^cr-task:[0-9a-f]{32}$/);
  await expect(panel).toHaveAttribute("data-next", "send-for-review", { timeout: 180_000 });
  await expect(page.getByTestId(`missing-acquisition-stage-${PART}-local-search`)).toHaveAttribute("data-status", "done");
  await expect(page.getByTestId(`missing-acquisition-stage-${PART}-local-search`)).toContainText(/no (published|eligible local) revision of this exact part/);
  for (const stage of ["source-selection", "retrieve", "validate"]) await expect(page.getByTestId(`missing-acquisition-stage-${PART}-${stage}`)).toHaveAttribute("data-status", "done");
  await expect(page.getByTestId(`missing-acquisition-attempts-${PART}`).locator('[data-source="fixture-kicad"]')).toHaveAttribute("data-outcome", "used");
  const candidate = page.getByTestId(`missing-acquisition-candidate-${PART}`);
  await expect(candidate).toHaveAttribute("data-verdict", "validated");
  await expect(candidate).toHaveAttribute("data-identity", "generic");
  await expect(candidate).toHaveAttribute("data-fixture", "true");
  await expect(candidate).toContainText("GENERIC KiCad candidate");
  expect(((await candidate.innerText()).match(/GENERIC KiCad/g) ?? []).length, "the identity line names its kind once").toBe(1); // [PR-L/M integration, 2026-10-18]
  // [PR-L/M integration, 2026-10-18] the step that waits for a PERSON reads "awaiting", never "running"
  await expect(page.getByTestId(`missing-acquisition-stage-${PART}-handoff`)).toHaveAttribute("data-status", "awaiting");
  await expect(page.getByTestId(`missing-acquisition-stage-${PART}-handoff`)).not.toContainText("running");
  await expect(candidate).toContainText("CC-BY-SA-4.0");
  await expect(candidate.locator('[data-testid="missing-acquisition-object"][data-role="symbol-file"]')).toContainText("sha256:");
  await expect(candidate.locator('[data-testid="missing-acquisition-object"][data-role="footprint"]')).toContainText("sha256:");
  await page.screenshot({ path: `${SCREENSHOTS}/m2-acquisition-validated-1366x768.png` });
  const viewed = await taskView(page, projectId, taskId);
  expect(viewed.candidate.identity.kind).toBe("generic");
  expect(viewed.attempts.map((attempt: { sourceId: string; outcome: string }) => `${attempt.sourceId}:${attempt.outcome}`)).toContain("fixture-kicad:used");

  // 3. a PERSON sends it for component review
  await page.getByTestId(`missing-acquisition-handoff-send-${PART}`).click();
  await expect(page.getByTestId(`missing-acquisition-handoff-${PART}`)).toContainText("Sent for component review by local-dev-principal:editor", { timeout: 30_000 });
  await expect(panel).toHaveAttribute("data-next", "await-publication");
  await expect(page.getByTestId(`missing-acquisition-stage-${PART}-handoff`)).toHaveAttribute("data-status", "done"); // [PR-L/M integration, 2026-10-18]
  await expect(page.getByTestId(`missing-acquisition-stage-${PART}-awaiting-publication`)).toHaveAttribute("data-status", "awaiting"); // two people review: awaiting, never "running"

  //    the catalog governance project (its own browser: the reviewers' roles never touch the editor's session): the inbox lists the
  //    package and opens the existing publication review, prefilled
  const governanceContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const governance = await governanceContext.newPage();
  await start(governance, governanceContext, origin, "m2000002");
  await openProject(governance, FIXTURE_CATALOG_GOVERNANCE.projectId, "Catalog governance", { components: [], wires: [], netLabels: [], kicadComponents: [], pageSize: "A4" }, false);
  await ensureBuildLibrary(governance);
  const openInbox = async (): Promise<void> => {
    await ensureBuildLibrary(governance);
    await expect(governance.getByTestId("component-review-inbox")).toBeVisible({ timeout: 30_000 });
    await governance.getByTestId("component-review-inbox").locator('[data-testid^="component-review-open-"]').first().click();
  };
  const reloadGovernanceAs = async (role: "reviewer" | "admin"): Promise<void> => {
    await actAs(governanceContext, role, origin);
    await governance.reload();
    await expect(governance.getByRole("button", { name: /Catalog governance/ })).toBeVisible({ timeout: 120_000 });
    await openInbox();
  };
  const inbox = governance.getByTestId("component-review-inbox");
  await expect(inbox).toBeVisible({ timeout: 30_000 });
  await expect(inbox).toHaveAttribute("data-count", "1");
  await expect(inbox).toContainText("GENERIC KiCad candidate");
  expect(((await inbox.innerText()).match(/GENERIC KiCad/g) ?? []).length, "the inbox's identity line names its kind once").toBe(1); // [PR-L/M integration, 2026-10-18]
  await expect(inbox).toContainText("FIXTURE evidence");
  await governance.screenshot({ path: `${SCREENSHOTS}/m2-component-review-inbox-1366x768.png` });
  await inbox.locator('[data-testid^="component-review-open-"]').first().click();
  const acquired = governance.getByTestId("atomic-submit-acquired");
  await expect(acquired).toBeVisible({ timeout: 30_000 });
  await expect(acquired).toContainText("Diode:1N4001 sha256:");
  await expect(acquired).toContainText("Diode_THT:D_DO-41_SOD81_P10.16mm_Horizontal sha256:");
  await expect(acquired).toContainText(`Publishing links catalog part ${PART}`);
  await expect(governance.getByTestId("atomic-submit-exact-mpn")).toHaveValue("1N4001");
  await governance.getByLabel("Manufacturer", { exact: true }).fill("onsemi");
  await governance.getByLabel("Datasheet citation").fill("FIXTURE pin table 1N4001 (not a manufacturer datasheet)");
  await governance.getByLabel("Request reason").fill("acquired from the fixture CAD source; pin table checked against the symbol");
  await governance.getByTestId("atomic-submit").click();
  const request = governance.locator('[data-testid^="atomic-publication-request-"]').first();
  await expect(request).toBeVisible({ timeout: 30_000 });
  await expect(request.locator("[data-state]").first()).toHaveAttribute("data-state", "pending");
  const requestId = (await request.getAttribute("data-testid"))!.replace("atomic-publication-request-", "");

  //    a reviewer approves (resolving the manufacturer and every listed conflict, deciding every quarantined fact)
  await reloadGovernanceAs("reviewer");
  await governance.getByTestId(`atomic-expand-${requestId}`).click();
  await governance.getByTestId(`atomic-manufacturer-${requestId}`).selectOption({ index: 1 });
  for (const select of await governance.locator(`[data-testid^="atomic-resolution-${requestId}-"]`).all()) await select.selectOption({ index: 1 });
  for (const select of await governance.locator('[data-testid^="atomic-disposition-"]').all()) await select.selectOption("reviewed");
  await governance.getByTestId(`atomic-approve-reason-${requestId}`).fill("symbol, footprint and fixture pin table reviewed");
  await governance.getByTestId(`atomic-approve-${requestId}`).click();
  await expect(governance.getByTestId(`atomic-publication-request-${requestId}`).locator("[data-state]").first()).toHaveAttribute("data-state", "approved", { timeout: 30_000 });

  //    a DIFFERENT administrator publishes
  await reloadGovernanceAs("admin");
  await governance.getByTestId(`atomic-expand-${requestId}`).click();
  await expect(governance.getByTestId(`atomic-publish-links-${requestId}`)).toContainText(PART);
  await governance.getByTestId(`atomic-publish-reason-${requestId}`).fill("two-person publication of the acquired part");
  await governance.getByTestId(`atomic-publish-${requestId}`).click();
  await expect(governance.getByTestId(`atomic-publication-request-${requestId}`).locator("[data-state]").first()).toHaveAttribute("data-state", "published", { timeout: 30_000 });
  await governanceContext.close();

  // 4. back in the project (the editor's page never left it): Check again finds the published revision through M1's candidate search
  await expect(panel).toHaveAttribute("data-next", "await-publication");
  await page.getByTestId(`missing-acquisition-recheck-${PART}`).click();
  await expect(panel).toHaveAttribute("data-next", "offer-replacement", { timeout: 120_000 });
  const proposal = page.getByTestId(`missing-acquisition-proposal-${PART}`);
  const revision = (await proposal.getAttribute("data-revision"))!;
  expect(revision.length).toBeGreaterThan(10);
  await page.screenshot({ path: `${SCREENSHOTS}/m2-acquisition-offer-1366x768.png` });

  //    Offer the replacement: the existing review path; Approve commits one canonical transaction
  await page.getByTestId(`missing-acquisition-offer-${PART}`).click();
  const dialog = page.getByTestId("component-resolution-review");
  await expect(dialog).toBeVisible({ timeout: 90_000 });
  for (const ref of ["D1", "D2"]) await expect(page.getByTestId(`component-resolution-row-${ref}`)).toHaveAttribute("data-revision", revision);
  await page.getByTestId("component-resolution-approve").click();
  await expect(page.getByTestId("component-resolution-receipt")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("missing-parts-open")).toHaveAttribute("data-count", "0", { timeout: 30_000 });

  //    the task records the receipt and the server-computed Prepare PCB check
  await expect.poll(async () => (await taskView(page, projectId, taskId)).applied?.receiptId ?? null, { timeout: 30_000 }).not.toBeNull();
  const done = await taskView(page, projectId, taskId);
  expect(done.preflight).toMatchObject({ unresolvedCount: 0 });
  expect(done.proposal.atomicPartRevisionId).toBe(revision);
});
