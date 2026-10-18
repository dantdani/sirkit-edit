/**
 * [PR-G, 2026-10-17] The agent's generation turn in a FRESH browser under the fixture runtime (recorded design, scripted agent,
 * in-memory stores; G.11): on an EMPTY Build-mode sheet the user asks the ASSISTANT - through the composer's own override, since
 * an empty project routes a circuit description to its Generate - "Generate a schematic: <the blinker request>". The scripted agent
 * (app/lib/agent/fixture-agent-adapter.ts) makes the ONE tool call a model would, sirkit.schematic.generate-proposal, through the
 * real loop, gateway, injected generation port and seal; the run log shows the tool line, the page's intake line, the offer line
 * and the agent's closing reply; the SAME schematic-proposal-review dialog as the composer's Generate opens (one dialog, modal: the
 * composer takes no second instruction while a proposal is pending), carrying the intake's validation note; its pending record
 * survives a reload and the proposal is offered again, restored; approval applies the recorded design (the design checks compute
 * real states); the record is gone and a reload offers nothing twice. No request left the origin and the composer's own generation
 * route was never called. Fake-backed: it proves the page's and the adapter's contract, not a live model or live authentication.
 */
import { expect, test, type Page, type Request } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { BLINKER_ACCEPTANCE_PROMPT } from "../app/lib/fixture-runtime/blinker/catalog";
import { FIXTURE_CLOCK_DEFAULT } from "../app/lib/fixture-runtime/clock";
// the page's own tool-line formatter, IMPORTED rather than copied (as agent-execution.spec imports its label): a reworded label fails here, not in a reviewer's eye
import { toolLineLabel } from "../app/lib/project/chat-run-view";
import { actAs, installDeterministicBrowser } from "./fixture-journey";

const FIXTURE_CLOCK = process.env.SIRKIT_FIXTURE_CLOCK?.trim() || FIXTURE_CLOCK_DEFAULT;
const SHOTS = join(process.cwd(), "artifacts", "product-reliability-simple-ui", "screenshots");
/** the scripted agent's one generation instruction (fixture-agent-adapter.ts, PR-G) around the recorded design's own request */
const INSTRUCTION = `Generate a schematic: ${BLINKER_ACCEPTANCE_PROMPT}`;
/** the run log's tool line: the registry title (tool-catalog.ts generateProposalDescriptor), the propose tier, the sealed status */
const TOOL_LINE = toolLineLabel({ title: "Propose a generated Build-mode schematic", tier: 2, ok: true, status: "proposal_sealed" });
/** the pending-proposal store's key prefix (journey-contract.spec asserts the composer's record by the same prefix) */
const PENDING_KEY = "sirkit:pending-proposal:";

interface ChatBody { messages?: Array<{ role: string; content: string }>; schematicState?: { components?: unknown[]; kicadComponents?: unknown[] } }

test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);

const pendingRecords = (page: Page): Promise<number> => page.evaluate((prefix) => Object.keys(window.localStorage).filter((key) => key.startsWith(prefix)).length, PENDING_KEY);

test("fresh browser, empty Build sheet: 'Generate a schematic: …' to the assistant → tool line + intake → the SAME review dialog (one, modal) → reload keeps it → approve → the recorded design and its checks → reload offers nothing; no request left the origin", async ({ page, context, baseURL }) => {
  const origin = baseURL!;
  const originHost = new URL(origin).hostname;
  const leftOrigin: string[] = [];
  const chatBodies: ChatBody[] = [];
  let composerGenerations = 0; // POST /api/schematic/build-multi: the composer's own Generate, which this journey must never take ([PR-L, 2026-10-17] and POST /api/generation-tasks, its durable start since runbook L.4)
  page.on("request", (request: Request) => {
    const url = new URL(request.url());
    if (url.hostname !== originHost && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") leftOrigin.push(request.url());
    if (request.method() !== "POST") return;
    if (url.pathname === "/api/chat") { try { chatBodies.push(request.postDataJSON() as ChatBody); } catch { /* not JSON */ } }
    if (url.pathname === "/api/schematic/build-multi" || url.pathname === "/api/generation-tasks") composerGenerations += 1; // [PR-L, 2026-10-17] the composer's Generate starts a durable design task (POST /api/generation-tasks) since runbook L.4; both routes count
  });
  mkdirSync(SHOTS, { recursive: true });
  await page.setViewportSize({ width: 1366, height: 768 });
  await installDeterministicBrowser(page, context, "a9e00001");
  await page.clock.setFixedTime(new Date(FIXTURE_CLOCK));
  await actAs(context, "editor", origin);
  await page.goto("/");
  await expect(page.getByTestId("fixture-runtime-banner")).toBeVisible();

  // 1. an EMPTY sheet in Build mode (the page's own words), the chat opened by the strip's action with the composer focused.
  await expect(page.getByTestId("empty-sheet-describe-circuit")).toBeVisible();
  await expect(page.getByText(/place parts yourself from the Build Library/)).toBeVisible();
  await expect(page.getByTestId("journey-next-action")).toHaveAttribute("data-action-id", "describe_circuit");
  await page.getByTestId("journey-next-action").click();
  const prompt = page.getByTestId("prompt-input");
  await expect(prompt).toBeFocused();

  // 2. the instruction to the ASSISTANT: an empty project routes a circuit description to the composer's Generate, so the user takes
  //    the page's own override ("Ask the assistant instead"); the route is shown before sending; the labelled Send control submits.
  await prompt.fill(INSTRUCTION);
  await expect(page.getByTestId("composer-route")).toHaveAttribute("data-route", "generate");
  await page.getByTestId("composer-route-override").click();
  await expect(page.getByTestId("composer-route")).toHaveAttribute("data-route", "ask");
  const submit = page.getByTestId("composer-submit");
  await expect(submit).toHaveText("Send");
  await submit.click();

  // 3. the run: ONE chat request carrying the instruction and the EMPTY sheet (never the composer's generation route); the run log
  //    shows the tool line (the real loop sealed the proposal), the page's intake line, the offer line and the agent's closing reply.
  await expect.poll(() => chatBodies.length, { timeout: 30_000 }).toBe(1);
  expect(chatBodies[0]!.messages?.at(-1)).toMatchObject({ role: "user", content: INSTRUCTION });
  expect(chatBodies[0]!.schematicState, "the sheet the proposal replaces is empty").toMatchObject({ components: [], kicadComponents: [] });
  await expect(page.getByText(TOOL_LINE)).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(/Generated schematic received — \d+ part\(s\), complete; preparing it for your review/)).toBeVisible();
  await expect(page.getByText("Generated schematic proposal — waiting for your approval in the review dialog; nothing has been changed")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("(fixture agent) the tool answered proposal_sealed.")).toBeVisible();
  await expect(page.getByTestId("chat-stop")).toBeHidden({ timeout: 60_000 }); // the run ended
  expect(composerGenerations, "the agent's path, never the composer's Generate").toBe(0);

  // 4. the SAME dialog as the composer's Generate: one review dialog on the page, the summary names the recorded design, the intake's
  //    note says who proposed it and that nothing changed; the journey marks the proposal awaiting approval.
  const review = page.getByTestId("schematic-proposal-review");
  await expect(review).toBeVisible({ timeout: 30_000 });
  await expect(review).toHaveCount(1);
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(page.getByTestId("schematic-proposal-summary")).toContainText(/U1|555/);
  await expect(page.getByTestId("schematic-proposal-validation")).toContainText(/Proposed by the assistant \(\w+\) for your request; approving replaces the sheet it was generated against\. Nothing has been changed yet\./);
  await expect(page.getByTestId("journey-stage-schematic_proposal")).toHaveAttribute("data-status", "awaiting_approval");
  await expect(page.getByTestId("journey-next-action")).toHaveAttribute("data-action-id", "review_proposal");
  await page.screenshot({ path: join(SHOTS, "after-g-agent-generation-1366x768.png"), fullPage: false });

  // 5. while the proposal is pending the dialog is MODAL: the workspace behind it - the composer included - takes no input, so a
  //    second instruction cannot be sent until this one is decided (the page's single-flight for proposals; no second dialog state).
  await expect(page.locator('[data-slot="dialog-overlay"]')).toBeVisible();
  expect(await pendingRecords(page), "the record exists the moment the proposal is offered").toBe(1);

  // 6. a reload with the proposal pending offers the SAME proposal again, restored, against the same base; the intake's note travels.
  await page.reload();
  await expect(page.getByTestId("fixture-runtime-banner")).toBeVisible();
  await expect(page.getByTestId("journey-stage-requirements")).toBeVisible();
  expect(await pendingRecords(page), "the record survives the reload until the proposal is decided").toBe(1);
  await expect(review).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("schematic-proposal-validation")).toContainText(/Restored after a reload/);
  await expect(page.getByTestId("schematic-proposal-validation")).toContainText(/Proposed by the assistant/);

  // 7. approval applies the recorded design: the stage succeeds, the record is gone, the design checks compute real states on the
  //    sheet (as simple-workspace.spec proves for the composer's path). [PR-F] the page's two post-apply AI passes (503 under the
  //    fixture; the provider card opens the chat) are awaited so the steps below never race them.
  const postApply = Promise.all([
    page.waitForResponse((response) => response.url().includes("/api/schematic/layout-critic"), { timeout: 60_000 }),
    page.waitForResponse((response) => response.url().includes("/api/schematic/review"), { timeout: 60_000 }),
  ]);
  await page.getByTestId("schematic-proposal-approve").click();
  await expect(review).toBeHidden();
  await expect(page.getByTestId("journey-stage-schematic_applied")).toHaveAttribute("data-status", "succeeded", { timeout: 30_000 });
  await postApply;
  expect(await pendingRecords(page), "approved: the record is gone").toBe(0);
  await expect(page.getByTestId("empty-sheet-describe-circuit")).toHaveCount(0); // the sheet holds the design
  await page.getByTestId("activity-build library").click();
  await expect(page.getByTestId("design-checks")).toBeVisible();
  await expect(page.getByTestId("design-check-floating-nets")).toHaveAttribute("data-state", /pass|findings/, { timeout: 30_000 });
  await expect(page.getByTestId("design-check-supply-rails")).toHaveAttribute("data-state", /pass|findings/);
  expect(await page.getByTestId("design-checks").getAttribute("data-digest")).toMatch(/^eng1-/);
  await expect(page.getByTestId("journey-next-action")).toHaveAttribute("data-action-id", /open_pcb|prepare_pcb/);

  // 8. nothing is offered twice; nothing left the origin.
  await page.reload();
  await expect(page.getByTestId("fixture-runtime-banner")).toBeVisible();
  await expect(page.getByTestId("journey-stage-requirements")).toBeVisible();
  await expect(review).toHaveCount(0);
  expect(await pendingRecords(page)).toBe(0);
  expect(leftOrigin, "no browser request left the origin").toEqual([]);
});
