/**
 * [PR-J5, 2026-10-23] Runbook J.3 item 4, J.6.4-J.6.6 and J.9 (:380, :383; OD-259 items 4 and 7), increment J5-C, in a FRESH browser under
 * the FIXTURE runtime: the 555 PWM LED dimmer is built and approved as one flat page (the l7-second-circuit flow); the chat sentence
 * "Organize this schematic into subsystem sheets" reaches the scripted assistant, which inspects the schematic and proposes the dimmer's
 * three groups through the sealed proposal tool (J5-A); the proposal card (J5-B) shows the groups, their members and the one crossing
 * interface, and NOTHING is applied until the human's Approve; Approve applies the organisation as ONE transaction (Overview + 3 sheets,
 * the 14 instances and their identities untouched, the pin-to-net partition kept, U1 OUT -> R2 a port on both sheets); Undo restores the
 * flat page exactly; a second proposal is Discarded and changes nothing; Redo re-organises; a reload keeps it; Prepare PCB through the
 * binding review still syncs 14 footprints. The composer never takes /api/schematic/build-multi, no schematic edit request is sent, and
 * nothing leaves the origin.
 *
 * Fixture proof only (US$0): the scripted agent and provider over a committed catalog, no router recording, no live model (OD-259 item 7).
 * Control ids: the plan's sheet-organization-review / -approve / -discard (J5-B) and the J3 navigator's; which assertion awaits which
 * builder is recorded in artifacts/product-reliability-simple-ui/multi-sheet/j5-generation.md section 3.
 */
import { expect, test, type BrowserContext, type Locator, type Page, type Request } from "@playwright/test";
import { DRONE_SHEET_GROUPS, LED_DIMMER_CROSSINGS, LED_DIMMER_SHEET_GROUPS, ORGANIZE_SHEETS_SENTENCE } from "../app/lib/fixture-runtime/sheet-organization-groups";
import { resolveProjectConnectivity } from "../app/lib/schematic/project-connectivity";
import { fixturePartLookup } from "../app/lib/schematic/__tests__/_j1-fixtures";
import { J4_FLAT_PROJECT_FILE, J4_FLAT_PROJECT_ID, J4_FLAT_PROJECT_NAME, flatDroneProjectState } from "../app/lib/schematic/__tests__/_j4-organize-fixtures";
import type { SchematicState } from "../lib/schematic-types";
import { actAs, expectHydrated, installDeterministicBrowser, reloadAs } from "./fixture-journey";

// the two cases are independent fresh browsers (own uuid namespaces, own projects): a failure of the first must not hide the second
test.describe.configure({ mode: "default" });
test.setTimeout(600_000);

const DIMMER_REQUEST = "Design a 5 V LED dimmer: a 555 timer PWM with a 10k potentiometer setting the brightness, switching the LED through an N-channel MOSFET.";
const SCREENSHOTS = "artifacts/product-reliability-simple-ui/multi-sheet/screenshots";
/** This spec's own hex uuid namespace (the deterministic browser; no other spec shares it). */
const UUID_NAMESPACE = "35aa0002";
const T = {
  chip: "sheets-chip", tree: "sheets-tree", block: (id: string) => `sheet-block-${id}`,
  /** the organise proposal card (J5-B, j5-plan.md section 2): the sealed proposal, its Approve and its Discard */
  card: "sheet-organization-review", approve: "sheet-organization-approve", discard: "sheet-organization-discard",
} as const;

interface Traffic { starts: Array<{ projectId: string }>; chats: string[]; edits: number; buildMulti: number; qualify: number; leftOrigin: string[] }
function watch(page: Page, origin: string): Traffic {
  const traffic: Traffic = { starts: [], chats: [], edits: 0, buildMulti: 0, qualify: 0, leftOrigin: [] };
  const host = new URL(origin).hostname;
  page.on("request", (request: Request) => {
    const url = new URL(request.url());
    if (url.hostname !== host && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") traffic.leftOrigin.push(request.url());
    if (request.method() !== "POST") return;
    if (url.pathname === "/api/schematic/build-multi") traffic.buildMulti += 1;
    if (url.pathname === "/api/schematic/edit" || url.pathname === "/api/schematic/edit-build" || url.pathname === "/api/schematic/layout-critic") traffic.edits += 1;
    if (url.pathname === "/api/pcb/qualify") traffic.qualify += 1;
    if (url.pathname === "/api/chat") { try { traffic.chats.push(String((request.postDataJSON() as { messages?: Array<{ content?: string }> }).messages?.at(-1)?.content ?? "")); } catch { /* not JSON */ } }
    if (url.pathname === "/api/generation-tasks") traffic.starts.push({ projectId: request.headers()["x-sirkit-project-id"] ?? "" });
  });
  return traffic;
}
async function savedState(page: Page, projectId: string): Promise<SchematicState> {
  return page.evaluate((key) => (JSON.parse(window.localStorage.getItem(key) ?? "null") as { state: SchematicState }).state, `sirkit:project:${projectId}`);
}
async function savedRecord(page: Page, projectId: string): Promise<Record<string, unknown>> {
  return page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? "null") as Record<string, unknown>, `sirkit:project:${projectId}`);
}
/** The persisted state once two reads 500 ms apart agree (the autosave has settled). */
async function settledState(page: Page, projectId: string): Promise<SchematicState> {
  let previous = JSON.stringify(await savedState(page, projectId));
  for (let round = 0; round < 40; round += 1) {
    await page.waitForTimeout(500);
    const current = JSON.stringify(await savedState(page, projectId));
    if (current === previous) return JSON.parse(current) as SchematicState;
    previous = current;
  }
  throw new Error("the autosaved state did not settle");
}
const refsOf = (state: SchematicState): string[] => (state.kicadComponents ?? []).map((item) => item.refDes).sort();
/** Every instance without its placement and sheet: id, reference, value, part and authority fields. */
const identityOf = (state: SchematicState) => state.kicadComponents!.map(({ sheetId: _sheet, x: _x, y: _y, rotation: _r, ...rest }) => { void _sheet; void _x; void _y; void _r; return rest; }).sort((a, b) => a.refDes.localeCompare(b.refDes));
async function composer(page: Page): Promise<Locator> {
  const prompt = page.getByTestId("prompt-input");
  if ((await prompt.count()) === 0 || !(await prompt.isVisible())) await page.getByTestId("activity-ai chat").click();
  await expect(prompt).toBeEnabled();
  return prompt;
}
/** A message to the ASSISTANT (the composer's own override when the page would route it elsewhere). */
async function askAssistant(page: Page, text: string): Promise<void> {
  const prompt = await composer(page);
  await prompt.fill(text);
  if ((await page.getByTestId("composer-route").getAttribute("data-route")) !== "ask") await page.getByTestId("composer-route-override").click();
  await expect(page.getByTestId("composer-route")).toHaveAttribute("data-route", "ask");
  await expect(page.getByTestId("composer-submit")).toHaveText("Send");
  await page.getByTestId("composer-submit").click();
}
/** A fresh browser, the composer's Build of the dimmer, the EXISTING review dialog approved: returns the project id and the flat state. */
async function buildFlatDimmer(page: Page, context: BrowserContext, origin: string, traffic: Traffic): Promise<{ projectId: string; flat: SchematicState }> {
  await page.setViewportSize({ width: 1366, height: 768 });
  await installDeterministicBrowser(page, context, UUID_NAMESPACE);
  await actAs(context, "editor", origin);
  await page.goto("/");
  await expect(page.getByTestId("fixture-runtime-banner")).toBeVisible();
  await expectHydrated(page);
  const prompt = await composer(page);
  await prompt.fill(DIMMER_REQUEST);
  await expect(page.getByTestId("composer-route")).toHaveAttribute("data-route", "generate");
  const accepted = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/generation-tasks" && response.request().method() === "POST");
  await page.getByTestId("composer-submit").click();
  expect((await accepted).status()).toBe(202);
  await expect(page.getByTestId("schematic-proposal-review")).toBeVisible({ timeout: 120_000 });
  expect(traffic.starts).toHaveLength(1);
  const { projectId } = traffic.starts[0]!;
  await page.getByTestId("schematic-proposal-approve").click();
  await expect(page.getByTestId("schematic-proposal-review")).toBeHidden();
  await expect(page.getByTestId("journey-stage-schematic_applied")).toHaveAttribute("data-status", "succeeded", { timeout: 60_000 });
  await expect.poll(async () => (await savedState(page, projectId))?.kicadComponents?.length ?? 0, { timeout: 30_000 }).toBe(14);
  const flat = await settledState(page, projectId);
  expect(flat.sheets).toBeUndefined();
  expect(flat.kicadComponents).toHaveLength(14);
  return { projectId, flat };
}

test("the LED dimmer flat; 'Organize this schematic into subsystem sheets' yields the sealed proposal card and applies nothing; Approve is ONE transaction (Overview + 3, partition and identities kept, U1 OUT -> R2 a port); Undo restores the flat page; Discard records nothing; Redo and a reload keep it; Prepare PCB still syncs 14 footprints", async ({ page, context, baseURL }) => {
  const origin = baseURL!;
  const traffic = watch(page, origin);
  const { projectId, flat } = await buildFlatDimmer(page, context, origin, traffic);
  const lookup = fixturePartLookup();
  const flatConnectivity = resolveProjectConnectivity(flat, lookup);
  expect(flatConnectivity.ok).toBe(true);
  expect(LED_DIMMER_SHEET_GROUPS.flatMap((group) => group.refs).sort()).toEqual(refsOf(flat));
  // the one crossing (U1 OUT -> R2) as the page drew it: a wire (the planner's port takes the first free SIG<n>) or, when no clean route
  // existed, a deterministically named label pair (the port takes the label's name); the model suggests PWM_OUT for it either way
  const u1 = flat.kicadComponents!.find((item) => item.refDes === "U1")!;
  const crossingNet = flatConnectivity.nets.find((net) => net.pins.some((pin) => pin.componentId === u1.id && pin.pinId === "3"))!;
  const crossingNames = [crossingNet.name ?? "SIG1", LED_DIMMER_CROSSINGS[0]!.name];
  await page.screenshot({ path: `${SCREENSHOTS}/j5-organize-flat-dimmer-1366x768.png` });

  // 1. the sentence reaches the assistant; the scripted agent inspects, then proposes the dimmer's groups through the sealed tool; the card
  //    lists the groups, their members and the crossing; NOTHING is applied before Approve (J.6.6, J.9 :383)
  await askAssistant(page, ORGANIZE_SHEETS_SENTENCE);
  const card = page.getByTestId(T.card);
  await expect(card).toBeVisible({ timeout: 90_000 }); // [awaits J5-A: the adapter's organise turn answering the DIMMER from sheet-organization-groups.ts fixtureSheetOrganizationFor, and the planner following wire chains (j5-fixture-recipes OPEN ISSUE J5-C-1)]
  const rows = card.getByTestId("sheet-organization-group");
  await expect(rows).toHaveCount(LED_DIMMER_SHEET_GROUPS.length);
  expect(await rows.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-name")))).toEqual(LED_DIMMER_SHEET_GROUPS.map((group) => group.name));
  expect((await rows.evaluateAll((nodes) => nodes.map((node) => (node.getAttribute("data-refs") ?? "").split(" ").sort().join(" "))))).toEqual(LED_DIMMER_SHEET_GROUPS.map((group) => [...group.refs].sort().join(" ")));
  const interfaces = card.getByTestId("sheet-organization-interface");
  await expect(interfaces).toHaveCount(2); // the one crossing (U1 OUT -> R2) as a port on each of the two sheets it joins
  for (const port of await interfaces.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-port")))) expect(crossingNames).toContain(port);
  expect(traffic.chats).toEqual([ORGANIZE_SHEETS_SENTENCE]);
  expect(await savedState(page, projectId), "the proposal changed nothing").toEqual(flat);
  expect(traffic.edits, "no provider-bound schematic edit").toBe(0);
  await page.screenshot({ path: `${SCREENSHOTS}/j5-organize-proposal-1366x768.png` });

  // 2. Approve: ONE schematic.move-to-sheet transaction - the overview and the three sheets, every instance on its group's sheet with its
  //    identity untouched, the partition digest the flat page's, the crossing a port on both sheets (J.9 :380)
  await page.getByTestId(T.approve).click();
  await expect(card).toBeHidden({ timeout: 30_000 });
  await expect.poll(async () => (await savedState(page, projectId)).sheets?.sheets.length ?? 0, { timeout: 30_000 }).toBe(LED_DIMMER_SHEET_GROUPS.length + 1);
  const organised = await settledState(page, projectId);
  const sheets = organised.sheets!.sheets;
  expect(sheets[0]!.parentId).toBeNull();
  expect(sheets.slice(1).map((sheet) => sheet.name)).toEqual(LED_DIMMER_SHEET_GROUPS.map((group) => group.name));
  expect(organised.kicadComponents).toHaveLength(14);
  expect(refsOf(organised)).toEqual(refsOf(flat));
  expect(identityOf(organised)).toEqual(identityOf(flat));
  for (const group of LED_DIMMER_SHEET_GROUPS) {
    const sheet = sheets.find((item) => item.name === group.name)!;
    expect(organised.kicadComponents!.filter((item) => item.sheetId === sheet.id).map((item) => item.refDes).sort(), group.name).toEqual([...group.refs].sort());
  }
  expect(organised.kicadComponents!.filter((item) => item.sheetId === undefined), "no part stays on the overview").toEqual([]);
  const portsOf = (name: string): string[] => (sheets.find((item) => item.name === name)!.ports ?? []).map((port) => port.name);
  expect(portsOf("555 PWM timing")).toHaveLength(1);
  expect(crossingNames, "the crossing's port: the net's own name, or the name the model suggested").toContain(portsOf("555 PWM timing")[0]);
  expect(portsOf("LED driver")).toEqual(portsOf("555 PWM timing"));
  expect(portsOf("Power input")).toEqual([]);
  expect(resolveProjectConnectivity(organised, lookup).partitionDigest).toBe(flatConnectivity.partitionDigest);
  await expect(page.getByTestId("chat-stop")).toBeHidden({ timeout: 60_000 });
  for (const sheet of sheets.slice(1)) await expect(page.getByTestId(T.block(sheet.id))).toBeVisible();
  await expect(page.getByTestId(T.chip)).toContainText("4 sheets");
  await page.screenshot({ path: `${SCREENSHOTS}/j5-organize-applied-1366x768.png` });

  // 3. Undo (one step): the flat page exactly as approved
  await page.getByRole("button", { name: "Undo schematic action" }).click();
  await expect.poll(async () => (await savedState(page, projectId)).sheets === undefined, { timeout: 30_000 }).toBe(true);
  expect(await settledState(page, projectId)).toEqual(flat);

  // 4. a second proposal, Discarded: the card closes and nothing changes (the assistant never applies anything itself)
  await askAssistant(page, ORGANIZE_SHEETS_SENTENCE);
  await expect(card).toBeVisible({ timeout: 90_000 });
  await page.getByTestId(T.discard).click();
  await expect(card).toBeHidden();
  await expect(page.getByTestId("chat-stop")).toBeHidden({ timeout: 60_000 });
  await page.waitForTimeout(1_000);
  expect(await savedState(page, projectId), "Discard changed nothing").toEqual(flat);
  expect(traffic.edits).toBe(0);
  expect(traffic.chats).toEqual([ORGANIZE_SHEETS_SENTENCE, ORGANIZE_SHEETS_SENTENCE]);

  // 5. Redo re-organises; a reload keeps the organised project
  await page.getByRole("button", { name: "Redo schematic action" }).click();
  await expect.poll(async () => (await savedState(page, projectId)).sheets?.sheets.length ?? 0, { timeout: 30_000 }).toBe(LED_DIMMER_SHEET_GROUPS.length + 1);
  expect(await settledState(page, projectId)).toEqual(organised);
  await page.reload();
  await expect(page.getByTestId("fixture-runtime-banner")).toBeVisible();
  await expectHydrated(page);
  expect(await savedState(page, projectId)).toEqual(organised);
  if (!(await page.getByTestId(T.tree).isVisible())) await page.getByTestId(T.chip).click();
  await expect(page.locator('[data-testid^="sheets-tree-item-"]')).toHaveCount(LED_DIMMER_SHEET_GROUPS.length + 1);
  await page.keyboard.press("Escape");

  // 6. Prepare PCB through the binding review: the complete sync still carries the 14 footprints (J.5, J.9 :380)
  if (!(await page.getByTestId("missing-parts-open").isVisible())) await page.getByTestId("activity-build library").click();
  await expect(page.getByTestId("missing-parts-open")).toHaveAttribute("data-count", "0", { timeout: 30_000 });
  await page.getByTestId("view-tab-pcb").click();
  await expect(page.getByTestId("pcb-empty-state")).toBeVisible();
  await expect(page.getByTestId("component-review-panel")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("review-request-all").click();
  await expect(page.getByTestId("component-review-pending")).toHaveText("14 pending", { timeout: 60_000 });
  await reloadAs(page, context, "reviewer", origin, false);
  for (const ref of refsOf(flat)) {
    await page.getByTestId(`review-approve-${ref}`).click();
    await expect(page.getByTestId(`review-state-${ref}`)).toHaveAttribute("data-state", "approved", { timeout: 30_000 });
  }
  await reloadAs(page, context, "editor", origin, false);
  await page.getByTestId("sync-schematic-to-pcb").click();
  const apply = page.locator('[data-testid^="apply-sync-plan"]').first();
  await expect(apply).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId("sync-blockers")).toHaveCount(0);
  await apply.click();
  await expect(page.getByTestId("p2g-workflow-state")).toHaveAttribute("data-state", "awaiting_qualification", { timeout: 120_000 });
  await expect(page.getByTestId("p2g-request-release")).toBeDisabled();
  const record = await savedRecord(page, projectId);
  const board = ((record["pcbWorking"] as { board?: { footprints?: unknown[] } } | undefined)?.board ?? (record["pcb"] as { footprints?: unknown[] } | undefined)) as { footprints?: unknown[] } | undefined;
  expect(board?.footprints ?? [], "one footprint per instance of every sheet").toHaveLength(14);

  // 7. one start, no request-lifetime route, no qualification, nothing left the origin
  expect(traffic.starts).toHaveLength(1);
  expect(traffic.buildMulti).toBe(0);
  expect(traffic.qualify).toBe(0);
  expect(traffic.leftOrigin).toEqual([]);
});

test("the committed FLAT drone (41 parts, label-joined): the same sentence proposes the generation plan's four blocks as sheets; Approve is ONE transaction (Overview + 4, 41 instances, partition kept); Undo restores the flat page", async ({ page, context, baseURL }) => {
  // The drone's connections are labels, so this case does not depend on the wire-chain attachment the dimmer needs (OPEN ISSUE J5-C-1,
  // j5-fixture-recipes): it is the organise proposal tool's path A and B can prove first.
  const origin = baseURL!;
  const traffic = watch(page, origin);
  await page.setViewportSize({ width: 1366, height: 768 });
  await installDeterministicBrowser(page, context, "35aa0003");
  await actAs(context, "editor", origin);
  await page.goto("/");
  await expect(page.getByTestId("fixture-runtime-banner")).toBeVisible();
  await expectHydrated(page);
  await page.locator('input[type="file"]').setInputFiles(J4_FLAT_PROJECT_FILE);
  await expect(page.getByRole("button", { name: new RegExp(J4_FLAT_PROJECT_NAME.replace(/[()]/g, "\\$&")) })).toBeVisible({ timeout: 60_000 });
  await expect.poll(async () => (await savedState(page, J4_FLAT_PROJECT_ID))?.kicadComponents?.length ?? 0, { timeout: 30_000 }).toBe(41);
  const flat = await settledState(page, J4_FLAT_PROJECT_ID);
  expect(flat.sheets).toBeUndefined();
  expect(refsOf(flat)).toEqual(refsOf(flatDroneProjectState()));
  const lookup = fixturePartLookup();
  const flatDigest = resolveProjectConnectivity(flat, lookup).partitionDigest;

  await askAssistant(page, ORGANIZE_SHEETS_SENTENCE);
  const card = page.getByTestId(T.card);
  await expect(card).toBeVisible({ timeout: 90_000 }); // [awaits J5-A and J5-B]
  // the groups the fixture model proposes: the generation plan's blocks (sheet-organization-groups.ts DRONE_SHEET_GROUPS) or J4's default
  // proposal (the adapter's own FIXTURE_DRONE_ORGANIZE_GROUPS) - the lead's choice; either way every row names parts of this drone, the
  // card lists the seven crossing interfaces, and Approve creates exactly the sheets the card showed
  const rows = card.getByTestId("sheet-organization-group");
  const proposed = (await rows.evaluateAll((nodes) => nodes.map((node) => ({ name: node.getAttribute("data-name") ?? "", refs: (node.getAttribute("data-refs") ?? "").split(" ").filter(Boolean).sort() })))) as Array<{ name: string; refs: string[] }>;
  expect(proposed.length).toBeGreaterThanOrEqual(2);
  expect(proposed.length).toBeLessThanOrEqual(8);
  const allRefs = new Set(refsOf(flat));
  const seen = new Set<string>();
  for (const group of proposed) { expect(group.name.length).toBeGreaterThan(0); for (const ref of group.refs) { expect(allRefs.has(ref), `${ref} is a part of the drone`).toBe(true); expect(seen.has(ref), `${ref} is in one group only`).toBe(false); seen.add(ref); } }
  if (proposed.map((group) => group.name).join("|") === DRONE_SHEET_GROUPS.map((group) => group.name).join("|")) expect(proposed.map((group) => group.refs)).toEqual(DRONE_SHEET_GROUPS.map((group) => [...group.refs].sort()));
  for (const net of ["PWM1", "PWM2", "PWM3", "PWM4", "I2C_SDA", "I2C_SCL", "IMU_INT1"]) await expect(card).toContainText(net);
  expect(await savedState(page, J4_FLAT_PROJECT_ID), "the proposal changed nothing").toEqual(flat);
  await page.screenshot({ path: `${SCREENSHOTS}/j5-organize-drone-proposal-1366x768.png` });

  await page.getByTestId(T.approve).click();
  await expect(card).toBeHidden({ timeout: 30_000 });
  await expect.poll(async () => (await savedState(page, J4_FLAT_PROJECT_ID)).sheets?.sheets.length ?? 0, { timeout: 30_000 }).toBe(proposed.length + 1);
  const organised = await settledState(page, J4_FLAT_PROJECT_ID);
  expect(organised.sheets!.sheets.slice(1).map((sheet) => sheet.name)).toEqual(proposed.map((group) => group.name));
  expect(organised.kicadComponents).toHaveLength(41);
  expect(identityOf(organised)).toEqual(identityOf(flat));
  for (const group of proposed) {
    const sheet = organised.sheets!.sheets.find((item) => item.name === group.name)!;
    expect(organised.kicadComponents!.filter((item) => item.sheetId === sheet.id).map((item) => item.refDes).sort(), group.name).toEqual(group.refs);
  }
  expect(organised.kicadComponents!.filter((item) => item.sheetId === undefined).map((item) => item.refDes).sort(), "the parts no group named stay on the overview").toEqual(refsOf(flat).filter((ref) => !seen.has(ref)));
  expect(resolveProjectConnectivity(organised, lookup).partitionDigest).toBe(flatDigest);
  await expect(page.getByTestId("chat-stop")).toBeHidden({ timeout: 60_000 });
  for (const sheet of organised.sheets!.sheets.slice(1)) await expect(page.getByTestId(T.block(sheet.id))).toBeVisible();

  await page.getByRole("button", { name: "Undo schematic action" }).click();
  await expect.poll(async () => (await savedState(page, J4_FLAT_PROJECT_ID)).sheets === undefined, { timeout: 30_000 }).toBe(true);
  expect(await settledState(page, J4_FLAT_PROJECT_ID)).toEqual(flat);
  expect(traffic.edits).toBe(0);
  expect(traffic.starts).toHaveLength(0);
  expect(traffic.buildMulti).toBe(0);
  expect(traffic.leftOrigin).toEqual([]);
});
