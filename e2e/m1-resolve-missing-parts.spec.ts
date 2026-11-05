/**
 * [PR-M, 2026-10-18] Runbook section M (M1's user-facing half) in a FRESH browser under the fixture runtime (the committed fixture
 * catalog with its two resolution records, the scripted agent, in-memory stores; no database, provider, embedding or distributor):
 *
 *  1. the owner's LED-dimmer reproduction is opened as a project file - U1 / R1 / C1 resolved, D1 and D2 placed from the catalog's
 *     1N4148 with no published exact revision; Prepare PCB refuses and names D1 and D2; the Missing parts list's "Find a replacement in
 *     the library" sends ONE chat request; the run log shows the real resolution steps (inspecting, searching, checking mappings,
 *     awaiting review); the review dialog shows the batch (old / new identity, exact revision, footprint, proved pin mapping, polarity);
 *     Approve commits ONE canonical transaction - the receipt and the new schematic revision are shown, then the recomputed Prepare PCB
 *     preflight; the editor's saved state keeps every reference, value, placement, net and the polarity on each net; the Missing parts
 *     list loses D1 / D2; Prepare PCB proceeds - the binding review and the verified sync plan are reached and applied;
 *  2. the chat sentence reaches the same dialog; Discard changes and records nothing; a batch whose base moves while it is open (Undo
 *     of the last edit) is refused at Approve with its sentence, and nothing changes.
 *
 * Fake-backed: it proves the page's contract and the authority chain, not a live model, a live catalog, a datasheet or a live router.
 */
import { createHash } from "node:crypto";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type { SchematicState } from "../lib/schematic-types";
import { canonicalJson } from "../app/lib/pcb/revision";
import { buildNetlist } from "../app/lib/pcb/netlist-bridge";
import { FIXTURE_ELIGIBLE_DIODE_MPN, FIXTURE_RESOLUTION_PART_IDS, fixtureRuntimeCatalog, resolutionFixtureParts } from "../app/lib/fixture-runtime/blinker/catalog";
import { DIMMER_INSTANCE_IDS, fixtureDimmerSheet } from "../app/lib/fixture-runtime/__tests__/_resolution-sheet";
import { actAs, installDeterministicBrowser, reloadAs } from "./fixture-journey";

test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);

const NOW = Date.parse("2026-10-18T00:00:00.000Z");
const CHAT_SENTENCE = "Replace D1 and D2 with suitable alternatives already in the library.";

/** A valid `.sirkit.json` project file (the importer's envelope and integrity digest) holding the fixture dimmer sheet. */
function dimmerProjectFile(projectId: string, name: string): { name: string; mimeType: string; buffer: Buffer } {
  const payload = { project: { id: projectId, name, state: fixtureDimmerSheet(), createdAt: NOW, updatedAt: NOW, schemaVersion: 2 }, checkpoints: [] };
  const canonical = canonicalJson(payload);
  const envelope = { format: "sirkit-project", formatVersion: 1, exportedAt: new Date(NOW).toISOString(), integrity: `sha256:${createHash("sha256").update(canonical).digest("hex")}`, payload: JSON.parse(canonical) as unknown };
  return { name: `${name}.sirkit.json`, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(envelope)) };
}

async function openDimmer(page: Page, context: BrowserContext, origin: string, namespace: string, projectId: string, name: string): Promise<void> {
  await page.setViewportSize({ width: 1366, height: 768 });
  await installDeterministicBrowser(page, context, namespace);
  await actAs(context, "editor", origin);
  await page.goto("/");
  await expect(page.getByTestId("fixture-runtime-banner")).toBeVisible();
  await expect(page.getByRole("button", { name: /Untitled project/ })).toBeVisible({ timeout: 120_000 });
  await page.locator('input[type="file"][accept*=".sirkit.json"]').setInputFiles(dimmerProjectFile(projectId, name));
  await expect(page.getByRole("button", { name: new RegExp(name) })).toBeVisible({ timeout: 30_000 });
  // the Build Library panel carries the design checks and the Missing parts line
  if (!(await page.getByTestId("missing-parts-open").isVisible())) await page.getByTestId("activity-build library").click();
  await expect(page.getByTestId("missing-parts-open")).toHaveAttribute("data-count", "2", { timeout: 30_000 });
}

/** Open the chat panel only when it is closed (its activity button toggles it). */
async function openChat(page: Page): Promise<void> {
  if (!(await page.getByTestId("prompt-input").isVisible())) await page.getByTestId("activity-ai chat").click();
  await expect(page.getByTestId("prompt-input")).toBeEnabled();
}

/** The editor's state as the page persisted it (the autosaved project record). */
async function savedState(page: Page, projectId: string): Promise<SchematicState> {
  return page.evaluate((key) => (JSON.parse(window.localStorage.getItem(key) ?? "null") as { state: SchematicState }).state, `sirkit:project:${projectId}`);
}

/** The sheet's named nets as {name: sorted "REF.pinName"} over the fixture catalog's pins - polarity-aware (K / A per net). */
function netsByFunction(state: SchematicState): Record<string, string[]> {
  const parts = fixtureRuntimeCatalog().cachedParts;
  const netlist = buildNetlist(state, (partId) => { const part = parts.get(partId); return part ? { pins: part.pins, footprintHint: part.footprintHint, mpn: part.mpn, name: part.name, description: part.description } : null; });
  const byId = new Map((state.kicadComponents ?? []).map((instance) => [instance.id, instance] as const));
  const nameOf = (componentId: string, pin: string): string => {
    const instance = byId.get(componentId)!;
    const name = parts.get(instance.partId)?.pins.find((entry) => entry.number === pin)?.name ?? pin;
    return `${instance.refDes}.${name === "~" ? pin : name}`;
  };
  return Object.fromEntries(netlist.nets.filter((net) => !net.name.startsWith("N$")).map((net) => [net.name, net.nodes.map((node) => nameOf(node.componentId, node.pinNumber)).sort()]));
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

test("the LED-dimmer D1/D2 → Prepare PCB names them → Find a replacement in the library → review → Approve → receipt and new revision → nets and polarity kept → Missing parts empty → Prepare PCB proceeds", async ({ page, context, baseURL }) => {
  const origin = baseURL!;
  const projectId = "m1-dimmer-resolve-0001";
  await openDimmer(page, context, origin, "m1000001", projectId, "LED dimmer M1");
  const before = await savedState(page, projectId);
  expect((before.kicadComponents ?? []).filter((instance) => instance.atomicPartRevisionId === undefined).map((instance) => instance.refDes)).toEqual(["D1", "D2"]);
  const netsBefore = netsByFunction(before);

  // 1. Prepare PCB refuses BEFORE any server call and names D1 and D2 (no published exact revision)
  await preparePcb(page);
  const blockers = page.getByTestId("sync-blockers");
  await expect(blockers).toBeVisible({ timeout: 60_000 });
  await expect(blockers).toHaveAttribute("data-kind", "unresolved_instances");
  for (const ref of ["D1", "D2"]) await expect(page.getByTestId(`sync-unresolved-${ref}`)).toHaveAttribute("data-missing", "published_exact_revision");
  await expect(page.locator('[data-testid^="sync-unresolved-"][data-missing]')).toHaveCount(2);

  // 2. "Find a replacement in the library": ONE chat request through the composer's ask route; the run log's real steps
  const find = page.getByTestId("missing-parts-find-replacement");
  await expect(find).toHaveAttribute("data-count", "2");
  await expect(find).toBeEnabled();
  const chatRequest = page.waitForRequest((request) => request.url().endsWith("/api/chat") && request.method() === "POST");
  await find.click();
  const sent = (await chatRequest).postDataJSON() as { messages: Array<{ role: string; content: string }> };
  expect(sent.messages.at(-1)?.content).toBe(`Find a replacement in the library for D1 and D2 (instances ${DIMMER_INSTANCE_IDS.D1}, ${DIMMER_INSTANCE_IDS.D2}).`);
  await expect(page.getByText("Inspecting the unresolved instances on the sheet").first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Searching the local library for eligible published revisions").first()).toBeVisible();
  await expect(page.getByText("Checking candidate pin mappings, polarity and packages").first()).toBeVisible();
  await expect(page.getByText(/^Awaiting your review: one batch for D1, D2/).first()).toBeVisible();

  // 3. the review dialog: per instance the old and new identity, the exact revision, the footprint, the proved mapping, the polarity
  const dialog = page.getByTestId("component-resolution-review");
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  const revision = resolutionFixtureParts().eligibleRevisionId;
  for (const [ref, cathodeNet, anodeNet] of [["D1", "TIMING", "RA"], ["D2", "RB", "TIMING"]] as const) {
    const row = page.getByTestId(`component-resolution-row-${ref}`);
    await expect(row).toHaveAttribute("data-revision", revision);
    await expect(row).toHaveAttribute("data-mode", "part-replacement");
    await expect(row).toContainText("no published exact revision");
    await expect(page.getByTestId(`component-resolution-target-${ref}`)).toContainText(`${FIXTURE_ELIGIBLE_DIODE_MPN} · Diodes Incorporated`);
    await expect(page.getByTestId(`component-resolution-target-${ref}`)).toContainText("Diode_SMD:D_SOD-123");
    await expect(page.getByTestId(`component-resolution-mapping-${ref}`)).toContainText("1 -> 1 cathode (pad 1)");
    await expect(page.getByTestId(`component-resolution-mapping-${ref}`)).toContainText("2 -> 2 anode (pad 2)");
    await expect(page.getByTestId(`component-resolution-polarity-${ref}`)).toContainText(`cathode: pin 1 -> pin 1 (pad 1) stays on ${cathodeNet}`);
    await expect(page.getByTestId(`component-resolution-polarity-${ref}`)).toContainText(`anode: pin 2 -> pin 2 (pad 2) stays on ${anodeNet}`);
    await expect(row).toContainText(`reference ${ref} and its stable id`);
  }
  await expect(dialog).toContainText("Nothing has been changed yet.");
  expect(await savedState(page, projectId)).toEqual(before); // reviewing changed nothing
  await page.screenshot({ path: "artifacts/product-reliability-simple-ui/screenshots/m1-resolution-review-1366x768.png" });

  // 4. Approve: ONE canonical transaction, the real receipt and the new schematic revision, then the recomputed preflight
  const facts = page.waitForResponse((response) => response.url().endsWith("/api/component-resolution-authority"));
  await page.getByTestId("component-resolution-approve").click();
  expect((await facts).status()).toBe(200); // the fresh server facts were read at commit
  const receipt = page.getByTestId("component-resolution-receipt");
  await expect(receipt).toBeVisible({ timeout: 30_000 });
  await expect(dialog).toBeHidden();
  const headSequence = await receipt.getAttribute("data-head-sequence");
  expect(Number(headSequence)).toBeGreaterThan(0);
  await expect(receipt).toContainText(`D1, D2 → ${FIXTURE_ELIGIBLE_DIODE_MPN}`);
  await expect(page.getByText(new RegExp(`^Committed: D1, D2 resolved to ${FIXTURE_ELIGIBLE_DIODE_MPN} in ONE canonical transaction .* new schematic revision ${headSequence} `)).first()).toBeVisible();
  await expect(page.getByText(/^Prepare PCB preflight updated: no instance is refused any more/).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/^Electrical check on the new revision: /).first()).toBeVisible();

  // 5. the editor's state: references, values, placements, every net and the polarity on it are kept; D1 / D2 carry the exact revision
  await expect.poll(async () => (await savedState(page, projectId)).kicadComponents?.find((instance) => instance.id === DIMMER_INSTANCE_IDS.D1)?.atomicPartRevisionId ?? null, { timeout: 30_000 }).toBe(revision);
  const after = await savedState(page, projectId);
  for (const id of [DIMMER_INSTANCE_IDS.D1, DIMMER_INSTANCE_IDS.D2]) {
    const was = before.kicadComponents!.find((instance) => instance.id === id)!;
    expect(after.kicadComponents!.find((instance) => instance.id === id)).toMatchObject({ partId: FIXTURE_RESOLUTION_PART_IDS.eligibleDiode, atomicPartRevisionId: revision, refDes: was.refDes, value: was.value, x: was.x, y: was.y, rotation: was.rotation });
  }
  for (const id of [DIMMER_INSTANCE_IDS.U1, DIMMER_INSTANCE_IDS.R1, DIMMER_INSTANCE_IDS.C1]) expect(after.kicadComponents!.find((instance) => instance.id === id)).toEqual(before.kicadComponents!.find((instance) => instance.id === id));
  expect(after.wires).toEqual(before.wires);
  expect(after.netLabels).toEqual(before.netLabels);
  expect(netsByFunction(after)).toEqual(netsBefore);
  expect(netsByFunction(after).TIMING).toEqual(expect.arrayContaining(["D1.K", "D2.A"]));

  // 6. the Missing parts list loses D1 / D2: the PCB tab's list is gone and the sidebar line says none
  await expect(page.getByTestId("sync-unresolved-D1")).toHaveCount(0);
  await expect(page.getByTestId("sync-unresolved-D2")).toHaveCount(0);
  await expect(page.getByTestId("missing-parts-open")).toHaveAttribute("data-count", "0");

  // 7. Prepare PCB proceeds past the refusal: the binding review (D1 and D2 now among the bindable instances), a reviewer approves,
  //    and the editor's Prepare PCB reaches the verified sync plan and applies it
  await page.getByTestId("view-tab-pcb").click();
  await expect(page.getByTestId("pcb-empty-state")).toBeVisible();
  await expect(page.getByTestId("component-review-panel")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("review-request-all").click();
  await expect(page.getByTestId("component-review-pending")).toHaveText("5 pending", { timeout: 30_000 });
  await reloadAs(page, context, "reviewer", origin, false);
  for (const ref of ["U1", "R1", "C1", "D1", "D2"]) {
    await page.getByTestId(`review-approve-${ref}`).click();
    await expect(page.getByTestId(`review-state-${ref}`)).toHaveAttribute("data-state", "approved", { timeout: 30_000 });
  }
  await reloadAs(page, context, "editor", origin, false);
  await page.getByTestId("sync-schematic-to-pcb").click();
  await expect(page.getByTestId("sync-blockers")).toHaveCount(0);
  const apply = page.locator('[data-testid^="apply-sync-plan"]').first();
  await expect(apply).toBeVisible({ timeout: 90_000 });
  await apply.click();
  await expect(page.getByTestId("p2g-workflow-state")).toHaveAttribute("data-state", "awaiting_qualification", { timeout: 90_000 });
});

test("the chat sentence reaches the same review; Discard changes and records nothing; a base that moves while the batch is open is refused at Approve", async ({ page, context, baseURL }) => {
  const origin = baseURL!;
  const projectId = "m1-dimmer-discard-0002";
  await openDimmer(page, context, origin, "m1000002", projectId, "LED dimmer M1 discard");
  const before = await savedState(page, projectId);
  await openChat(page);
  const prompt = page.getByTestId("prompt-input");

  // 1. the chat sentence: the composer routes it to the assistant; the same dialog opens
  await prompt.fill(CHAT_SENTENCE);
  await expect(page.getByTestId("composer-route")).toHaveAttribute("data-route", "ask");
  await prompt.press("Enter");
  const dialog = page.getByTestId("component-resolution-review");
  await expect(dialog).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("component-resolution-row-D1")).toBeVisible();
  await expect(page.getByTestId("component-resolution-row-D2")).toBeVisible();

  // 2. Discard: nothing changes, nothing is fetched, nothing is recorded
  let factsCalls = 0;
  page.on("request", (request) => { if (request.url().endsWith("/api/component-resolution-authority")) factsCalls += 1; });
  await page.getByTestId("component-resolution-discard").click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Component resolution discarded — nothing was changed and nothing was recorded.").first()).toBeVisible();
  await expect(page.getByTestId("component-resolution-receipt")).toHaveCount(0);
  expect(await savedState(page, projectId)).toEqual(before);
  await expect(page.getByTestId("missing-parts-open")).toHaveAttribute("data-count", "2");
  expect(factsCalls).toBe(0);

  // 3. an undoable edit (a Theory inductor, L1), then the same request: a batch sealed against THAT head
  await page.getByRole("button", { name: "Theory", exact: true }).click();
  if (!(await page.getByRole("button", { name: /^Inductor/ }).isVisible())) await page.getByTestId("activity-theory library").click(); // the library panel is already open from the Build Library (its button toggles it)
  await page.getByRole("button", { name: /^Inductor/ }).click();
  const canvas = page.getByTestId("schematic-canvas");
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + 120, box.y + box.height - 120);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Build", exact: true }).click();
  await expect(page.getByTestId("missing-parts-open")).toHaveAttribute("data-count", "3");
  await expect.poll(async () => (await savedState(page, projectId)).components.length, { timeout: 30_000 }).toBe(1); // the inductor is committed and saved
  await openChat(page);
  await prompt.fill(CHAT_SENTENCE);
  await prompt.press("Enter");
  await expect(dialog).toBeVisible({ timeout: 60_000 });

  // 4. the base moves while the batch is open (Undo of the inductor): Approve refuses with its sentence; nothing changes
  await page.getByTestId("component-resolution-discard").focus();
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("missing-parts-open")).toHaveAttribute("data-count", "2", { timeout: 30_000 });
  await expect.poll(async () => (await savedState(page, projectId)).components.length, { timeout: 30_000 }).toBe(0); // the undo committed: the sealed base is gone
  const moved = await savedState(page, projectId);
  await page.getByTestId("component-resolution-approve").click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  // the apply's live check refuses the moved base with the service's own sentence (measured: the page's Undo leaves the session on
  // another lineage mark than the one the batch was sealed on, so the scope check speaks first; a moved head or base reads the same way)
  await expect(page.getByText(/^The component resolution was not applied: .*(head moved|schematic changed|different project\/branch\/lineage)/).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("component-resolution-receipt")).toHaveCount(0);
  expect(await savedState(page, projectId)).toEqual(moved);
  expect((await savedState(page, projectId)).kicadComponents?.filter((instance) => instance.atomicPartRevisionId === undefined).map((instance) => instance.refDes)).toEqual(["D1", "D2"]);
  expect(factsCalls).toBe(0); // a stale batch never reaches the fresh-facts endpoint
});
