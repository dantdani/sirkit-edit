/**
 * [PR-J5, 2026-10-23] Runbook J.6.3 and J.9 (:377, :382, :385; OD-259 items 1, 3, 5, 7), increment J5-C, in a FRESH browser under the FIXTURE
 * runtime: the owner's four-motor sentence, VERBATIM, through Build. The durable task's planned result arrives WITH its sheet set
 * (`sirkit.generation-sheets.v1`, J5-1) and the page lays it out as REAL sheets (J5-B, lib/build-sheet-layout.ts): the ONE review dialog
 * names the overview, the four subsystem sheets and the seven interfaces; Approve applies the whole design as one undoable transaction;
 * the Sheets navigator shows the overview with four blocks and the four sheets with their ports (the sheet pins on the overview, the
 * hierarchical labels inside); Follow PWM1 from the MCU sheet lands on the motor stages with the highlight; a reload keeps the five sheets
 * and the 41 published instances (Missing parts 0); with a child sheet active, Prepare PCB through the binding review syncs the WHOLE
 * project to awaiting qualification with 41 footprints (the flat result's count), the design checks list Sheet connections and release
 * stays disabled; the composer never takes /api/schematic/build-multi and nothing leaves the origin.
 *
 * Fixture proof only (US$0): a scripted provider over a committed catalog, no router recording for this board, no live model (OD-259 item 7).
 * Control ids: the J3 navigator's (e2e/j3-multi-sheet.spec.ts T) and the EXISTING review dialog's; which assertion awaits which builder is
 * recorded in artifacts/product-reliability-simple-ui/multi-sheet/j5-generation.md section 3 (a failing step is a J5 defect, not a spec defect).
 */
import { expect, test, type Locator, type Page, type Request } from "@playwright/test";
import type { NetLabel, SchematicState } from "../lib/schematic-types";
import { actAs, expectHydrated, installDeterministicBrowser, reloadAs } from "./fixture-journey";

test.describe.configure({ mode: "serial" });
test.setTimeout(600_000);

/** The owner's sentence (runbook section L.0), verbatim. */
const OWNER_FOUR_MOTOR_SENTENCE = "build me a simple drone controlling circuitly with 4 motors just a simple one";
const DRONE_BLOCKS = ["Power input and 3.3 V regulator", "Motor driver stages", "Flight controller MCU", "IMU"] as const;
const INTERFACES = ["PWM1", "PWM2", "PWM3", "PWM4", "I2C_SDA", "I2C_SCL", "IMU_INT1"] as const;
/** The ports each generated sheet carries (the result's sheet set: l7-fixture-vertical-slice `expectDroneSheets`). */
const PORTS: Readonly<Record<string, readonly string[]>> = {
  [DRONE_BLOCKS[0]]: [],
  [DRONE_BLOCKS[1]]: ["PWM1", "PWM2", "PWM3", "PWM4"],
  [DRONE_BLOCKS[2]]: INTERFACES,
  [DRONE_BLOCKS[3]]: ["I2C_SDA", "I2C_SCL", "IMU_INT1"],
};
const SCREENSHOTS = "artifacts/product-reliability-simple-ui/multi-sheet/screenshots";
/** This spec's own hex uuid namespace (the deterministic browser; no other spec shares it). */
const UUID_NAMESPACE = "35aa0001";
const T = { chip: "sheets-chip", breadcrumb: "sheets-breadcrumb", tree: "sheets-tree", item: (id: string) => `sheets-tree-item-${id}`, block: (id: string) => `sheet-block-${id}`, follow: "sheets-follow" } as const;

interface Traffic { starts: Array<{ clientRequestId: string; projectId: string }>; buildMulti: number; qualify: number; leftOrigin: string[] }
function watch(page: Page, origin: string): Traffic {
  const traffic: Traffic = { starts: [], buildMulti: 0, qualify: 0, leftOrigin: [] };
  const host = new URL(origin).hostname;
  page.on("request", (request: Request) => {
    const url = new URL(request.url());
    if (url.hostname !== host && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") traffic.leftOrigin.push(request.url());
    if (request.method() !== "POST") return;
    if (url.pathname === "/api/schematic/build-multi") traffic.buildMulti += 1;
    if (url.pathname === "/api/pcb/qualify") traffic.qualify += 1;
    if (url.pathname === "/api/generation-tasks") {
      const body = request.postDataJSON() as { clientRequestId?: string };
      traffic.starts.push({ clientRequestId: body.clientRequestId ?? "", projectId: request.headers()["x-sirkit-project-id"] ?? "" });
    }
  });
  return traffic;
}
const selector = (projectId: string): Record<string, string> => ({ "x-sirkit-tenant-id": "local", "x-sirkit-project-id": projectId, "x-sirkit-branch-id": "main" });
async function serverTask(page: Page, projectId: string, taskId: string): Promise<{ task: Record<string, any>; result: Record<string, any> | null }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const response = await page.request.get(`/api/generation-tasks/${encodeURIComponent(taskId)}?include=result`, { headers: selector(projectId) });
  expect(response.status()).toBe(200);
  return (await response.json()) as { task: Record<string, any>; result: Record<string, any> | null }; // eslint-disable-line @typescript-eslint/no-explicit-any
}
async function activeTaskId(page: Page, projectId: string): Promise<string> {
  const response = await page.request.get("/api/generation-tasks", { headers: selector(projectId) });
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { active: { taskId: string } | null; recent: Array<{ taskId: string }> };
  return body.active?.taskId ?? body.recent[0]!.taskId;
}
/** The editor's state as the page persisted it (the autosaved project record). */
async function savedState(page: Page, projectId: string): Promise<SchematicState> {
  return page.evaluate((key) => (JSON.parse(window.localStorage.getItem(key) ?? "null") as { state: SchematicState }).state, `sirkit:project:${projectId}`);
}
async function savedRecord(page: Page, projectId: string): Promise<Record<string, unknown>> {
  return page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? "null") as Record<string, unknown>, `sirkit:project:${projectId}`);
}
const refsOf = (state: SchematicState): string[] => (state.kicadComponents ?? []).map((item) => item.refDes).sort();
const scopeOf = (label: NetLabel): string | undefined => (label as { scope?: string }).scope;
async function openTree(page: Page): Promise<Locator> {
  const tree = page.getByTestId(T.tree);
  if (!(await tree.isVisible())) await page.getByTestId(T.chip).click();
  await expect(tree).toBeVisible();
  return tree;
}
async function openSheet(page: Page, sheetId: string, name: string): Promise<void> {
  await openTree(page);
  await page.getByTestId(T.item(sheetId)).click();
  await expect(page.getByTestId(T.breadcrumb)).toContainText(name);
}
/** The reference designators drawn on the canvas (KicadInstanceView draws each as a <text>; label names never collide with them). */
async function drawnRefs(page: Page, known: ReadonlySet<string>): Promise<string[]> {
  const texts = await page.getByTestId("schematic-canvas").locator("text").allTextContents();
  return [...new Set(texts.map((text) => text.trim()).filter((text) => known.has(text)))].sort();
}

test("the owner's four-motor sentence becomes an overview and four real sheets: the review names them, Approve applies them, the navigator shows them with their interfaces, Follow PWM1 crosses to the motor stages, a reload keeps them, Prepare PCB with a child sheet active syncs the whole project (41 footprints) to awaiting qualification", async ({ page, context, baseURL }) => {
  const origin = baseURL!;
  const traffic = watch(page, origin);
  await page.setViewportSize({ width: 1366, height: 768 });
  await installDeterministicBrowser(page, context, UUID_NAMESPACE);
  await actAs(context, "editor", origin);
  await page.goto("/");
  await expect(page.getByTestId("fixture-runtime-banner")).toBeVisible();
  await expectHydrated(page);

  // 1. Build: the sentence verbatim, accepted durably at once; the four planned blocks reach saved
  const prompt = page.getByTestId("prompt-input");
  if ((await prompt.count()) === 0 || !(await prompt.isVisible())) await page.getByTestId("activity-ai chat").click();
  await expect(prompt).toBeEnabled();
  await prompt.fill(OWNER_FOUR_MOTOR_SENTENCE);
  await expect(page.getByTestId("composer-route")).toHaveAttribute("data-route", "generate");
  const accepted = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/generation-tasks" && response.request().method() === "POST");
  await page.getByTestId("composer-submit").click();
  expect((await accepted).status(), "the start answers 202 once the task is durably accepted").toBe(202);
  expect(traffic.starts).toHaveLength(1);
  const { projectId } = traffic.starts[0]!;
  await expect(page.getByTestId("generation-task-status")).toBeVisible();
  for (const [index, name] of DRONE_BLOCKS.entries()) {
    const block = page.getByTestId(`generation-task-block-b${index + 1}`);
    await expect(block).toContainText(name, { timeout: 120_000 });
    await expect(block).toHaveAttribute("data-status", "saved", { timeout: 120_000 });
  }

  // 2. the ONE review dialog names the overview, the four sheets and the seven interfaces (J.6.1: assumptions and interfaces explained
  //    without an extra prompt) - the server's result behind it carries the sheet set beside its flat netlist (J5-1)
  const review = page.getByTestId("schematic-proposal-review");
  await expect(review).toBeVisible({ timeout: 120_000 });
  const taskId = await activeTaskId(page, projectId);
  const pending = await serverTask(page, projectId, taskId);
  expect(pending.task).toMatchObject({ state: "awaiting-review", plan: { planner: "planned" }, result: { status: "complete", omittedBlocks: [] }, usage: { modelCalls: 9 } });
  const components = pending.result!.netlist.components as Array<{ refDes: string; partId: string; value: string }>;
  expect(components).toHaveLength(41);
  const resultSheets = pending.result!.sheets as { schema: string; sheets: { children: Array<{ name: string; status: string; components: string[]; ports: Array<{ net: string }> }>; interfaces: Array<{ net: string; state: string }> } | null; findings: string[] };
  expect(resultSheets.schema).toBe("sirkit.generation-sheets.v1");
  expect(resultSheets.sheets!.children.map((child) => [child.name, child.status])).toEqual(DRONE_BLOCKS.map((name) => [name, "designed"]));
  expect(resultSheets.sheets!.interfaces.map((entry) => `${entry.net}:${entry.state}`)).toEqual(INTERFACES.map((net) => `${net}:bound`));
  expect(resultSheets.findings).toEqual([]);
  await expect(review).toContainText("brushed 1S coreless motors");
  await page.screenshot({ path: `${SCREENSHOTS}/j5-generated-review-1366x768.png` });
  const summary = page.getByTestId("schematic-proposal-summary");
  await expect(summary).toContainText("System overview"); // [awaits J5-B] the sheet lines of describeSchematicProposal
  for (const name of DRONE_BLOCKS) await expect(summary).toContainText(name);
  for (const net of INTERFACES) await expect(summary).toContainText(net);

  // 3. Approve: the whole design as ONE undoable transaction; the task records the review and settles
  await page.getByTestId("schematic-proposal-approve").click();
  await expect(review).toBeHidden();
  await expect(page.getByTestId("journey-stage-schematic_applied")).toHaveAttribute("data-status", "succeeded", { timeout: 60_000 });
  await expect.poll(async () => (await serverTask(page, projectId, taskId)).task.state, { timeout: 30_000 }).toBe("succeeded");
  expect((await serverTask(page, projectId, taskId)).task.review).toMatchObject({ outcome: "applied" });

  // 4. the persisted document: an overview and four child sheets, every one of the 41 instances on exactly one child, each child's ports
  //    the result's interfaces of that block, one sheet pin per port on the overview and a hierarchical label per port inside (J.4)
  await expect.poll(async () => (await savedState(page, projectId))?.sheets?.sheets.length ?? 0, { timeout: 30_000 }).toBe(5); // [awaits J5-B] layoutGeneratedSheets + the apply
  const applied = await savedState(page, projectId);
  const sheets = applied.sheets!.sheets;
  const root = sheets.find((sheet) => sheet.parentId === null)!;
  const children = sheets.filter((sheet) => sheet.parentId !== null);
  expect(children.map((sheet) => sheet.name)).toEqual([...DRONE_BLOCKS]);
  expect(children.every((sheet) => sheet.parentId === root.id)).toBe(true);
  expect(applied.kicadComponents).toHaveLength(41);
  expect(refsOf(applied)).toEqual(components.map((component) => component.refDes).sort());
  const childIds = new Set(children.map((sheet) => sheet.id));
  expect(applied.kicadComponents!.filter((item) => !item.sheetId || !childIds.has(item.sheetId)).map((item) => item.refDes), "no part stays on the overview").toEqual([]);
  for (const child of children) {
    const expectedRefs = resultSheets.sheets!.children.find((entry) => entry.name === child.name)!.components;
    expect(applied.kicadComponents!.filter((item) => item.sheetId === child.id).map((item) => item.refDes).sort(), child.name).toEqual([...expectedRefs].sort());
    expect((child.ports ?? []).map((port) => port.name).sort(), `${child.name} ports`).toEqual([...PORTS[child.name]!].sort());
  }
  const labels = applied.netLabels ?? [];
  const portIds = new Set(children.flatMap((sheet) => (sheet.ports ?? []).map((port) => port.id)));
  const sheetPins = labels.filter((label) => scopeOf(label) === "sheet-pin");
  const hierarchical = labels.filter((label) => scopeOf(label) === "hierarchical");
  expect(sheetPins).toHaveLength(14); // 4 + 7 + 3 ports
  expect(sheetPins.every((label) => portIds.has((label as { portId?: string }).portId ?? "") && label.sheetId === undefined)).toBe(true);
  expect(new Set(hierarchical.map((label) => (label as { portId?: string }).portId))).toEqual(portIds);
  expect(hierarchical.every((label) => label.sheetId !== undefined && childIds.has(label.sheetId))).toBe(true);

  // 5. the Sheets navigator: the chip, the tree (Overview + 4, document order), the four blocks on the overview
  await expect(page.getByTestId(T.chip)).toBeVisible();
  const tree = await openTree(page);
  const items = tree.locator('[data-testid^="sheets-tree-item-"]');
  await expect(items).toHaveCount(5);
  expect(await items.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-testid")))).toEqual([root.id, ...children.map((sheet) => sheet.id)].map((id) => T.item(id)));
  for (const child of children) await expect(page.getByTestId(T.item(child.id))).toContainText(child.name);
  for (const child of children) await expect(page.getByTestId(T.block(child.id))).toBeVisible();
  await page.keyboard.press("Escape");
  await page.screenshot({ path: `${SCREENSHOTS}/j5-generated-overview-1366x768.png` });

  // 6. open the MCU sheet (only its parts drawn), then Follow PWM1 across to the motor stages: the destination opens with the highlight
  const known = new Set(components.map((component) => component.refDes));
  const mcu = children.find((sheet) => sheet.name === DRONE_BLOCKS[2])!;
  const motors = children.find((sheet) => sheet.name === DRONE_BLOCKS[1])!;
  await openSheet(page, mcu.id, mcu.name);
  const mcuRefs = resultSheets.sheets!.children.find((entry) => entry.name === mcu.name)!.components;
  expect(await drawnRefs(page, known)).toEqual([...mcuRefs].sort());
  expect(await drawnRefs(page, known)).not.toContain("Q1");
  await page.getByTestId("schematic-canvas").locator('[data-testid^="scoped-label-"][data-scope="hierarchical"]', { hasText: /^PWM1$/ }).first().click();
  await page.getByTestId(T.follow).click();
  const destinations = page.locator('[data-testid^="sheets-follow-destination-"]');
  await expect(destinations.first()).toBeVisible();
  const motorsDestination = destinations.filter({ hasText: new RegExp(motors.name) }).first();
  await expect(motorsDestination).toBeVisible();
  await motorsDestination.click();
  await expect(page.getByTestId(T.breadcrumb)).toContainText(motors.name);
  await expect(page.getByTestId("schematic-highlight")).toHaveAttribute("data-net", "PWM1");
  const motorRefs = resultSheets.sheets!.children.find((entry) => entry.name === motors.name)!.components;
  expect(await drawnRefs(page, known)).toEqual([...motorRefs].sort());
  await page.screenshot({ path: `${SCREENSHOTS}/j5-generated-follow-pwm1-1366x768.png` });

  // 7. reload: the same five sheets, every instance with its published exact revision, Missing parts 0
  await page.reload();
  await expect(page.getByTestId("fixture-runtime-banner")).toBeVisible();
  await expectHydrated(page);
  const restored = await savedState(page, projectId);
  expect(restored.sheets).toEqual(applied.sheets);
  expect(restored.kicadComponents).toHaveLength(41);
  expect(refsOf(restored)).toEqual(refsOf(applied));
  expect(restored.kicadComponents!.filter((instance) => !instance.atomicPartRevisionId).map((instance) => instance.refDes)).toEqual([]);
  if (!(await page.getByTestId("missing-parts-open").isVisible())) await page.getByTestId("activity-build library").click();
  await expect(page.getByTestId("missing-parts-open")).toHaveAttribute("data-count", "0", { timeout: 30_000 });
  await expect(page.getByTestId("design-checks")).toContainText("Sheet connections");

  // 8. with the IMU sheet active: Prepare PCB through the binding review (editor requests all, a reviewer approves every reference), the
  //    complete sync and the applied plan reach awaiting qualification with all 41 footprints (J.5: the whole design, not the visible sheet)
  const imu = children.find((sheet) => sheet.name === DRONE_BLOCKS[3])!;
  await openSheet(page, imu.id, imu.name);
  await page.getByTestId("view-tab-pcb").click();
  await expect(page.getByTestId("pcb-empty-state")).toBeVisible();
  await expect(page.getByTestId("component-review-panel")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("review-request-all").click();
  await expect(page.getByTestId("component-review-pending")).toHaveText("41 pending", { timeout: 60_000 });
  await reloadAs(page, context, "reviewer", origin, false);
  await expect(page.getByTestId("component-review-pending")).toHaveText("41 pending", { timeout: 60_000 });
  const reviewed = await page.locator('[data-testid^="review-approve-"]').evaluateAll((nodes) => nodes.map((node) => (node.getAttribute("data-testid") ?? "").slice("review-approve-".length)));
  expect(reviewed.sort()).toEqual(refsOf(applied));
  for (const ref of reviewed) {
    await page.getByTestId(`review-approve-${ref}`).click();
    await expect(page.getByTestId(`review-state-${ref}`)).toHaveAttribute("data-state", "approved", { timeout: 30_000 });
  }
  await expect(page.getByTestId("component-review-pending")).toHaveText("0 pending");
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
  expect(board?.footprints ?? [], "one footprint per instance of every sheet").toHaveLength(41);
  await page.screenshot({ path: `${SCREENSHOTS}/j5-generated-pcb-awaiting-qualification-1366x768.png` });

  // 9. nothing qualified, one start, the composer never took the request-lifetime route, nothing left the origin
  expect(traffic.qualify, "no qualification was requested").toBe(0);
  expect(traffic.starts, "one start request").toHaveLength(1);
  expect(traffic.buildMulti, "the composer never takes the request-lifetime route").toBe(0);
  expect(traffic.leftOrigin).toEqual([]);
});
