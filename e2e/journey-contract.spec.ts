/**
 * [PR-C] The journey contract in a FRESH browser under the fixture runtime (recorded design, scripted agent, in-memory
 * stores): the primary task is visible before anything is typed; a question is sent with a labelled control and answered
 * by the scripted agent (nothing generated); a circuit request shows its route and the prepare-PCB intent; the proposal
 * carries its validation note; a reload with the proposal pending offers it again against the same base; approval turns
 * the next action into "Prepare PCB", which starts the SAME preparation the PCB tab's button starts and stops at the
 * editor's binding handoff (no board is created; apply stays a click). Fake-backed: it proves the page's contract, not a
 * live model, live authentication or real routing.
 */
import { expect, test } from "@playwright/test";
import { BLINKER_ACCEPTANCE_PROMPT } from "../app/lib/fixture-runtime/blinker/catalog";
import { FIXTURE_CLOCK_DEFAULT } from "../app/lib/fixture-runtime/clock";
import { actAs, installDeterministicBrowser } from "./fixture-journey";

const FIXTURE_CLOCK = process.env.SIRKIT_FIXTURE_CLOCK?.trim() || FIXTURE_CLOCK_DEFAULT;

test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);

test("fresh browser: visible next action → question answered, nothing generated → proposal with its note → reload keeps it → approval → Prepare PCB → binding handoff", async ({ page, context, baseURL }) => {
  const origin = baseURL!;
  await installDeterministicBrowser(page, context, "c0de0000");
  await page.clock.setFixedTime(new Date(FIXTURE_CLOCK));
  await actAs(context, "editor", origin);
  await page.goto("/");
  await expect(page.getByTestId("fixture-runtime-banner")).toBeVisible();

  // 1. the primary task is visible before anything is typed: ten stages, the first current, one next action.
  const strip = page.getByTestId("journey-strip");
  await expect(strip).toBeVisible();
  await expect(page.locator('[data-testid^="journey-stage-"]')).toHaveCount(10);
  await expect(page.getByTestId("journey-stage-requirements")).toHaveAttribute("data-current", "true");
  const next = page.getByTestId("journey-next-action");
  await expect(next).toHaveAttribute("data-action-id", "describe_circuit");
  await next.click();
  const prompt = page.getByTestId("prompt-input");
  await expect(prompt).toBeFocused(); // the action opened the chat and focused the composer: no Tab hunt

  // 2. a pure question on an empty project is a question: the labelled Send control, the scripted agent answers, no proposal.
  await prompt.fill("What does the control pin of a 555 timer do?");
  await expect(page.getByTestId("composer-route")).toHaveAttribute("data-route", "ask");
  const submit = page.getByTestId("composer-submit");
  await expect(submit).toHaveText("Send");
  await submit.click();
  await expect(page.getByTestId("chat-stop")).toBeHidden({ timeout: 60_000 }); // the run ended
  await expect(page.getByTestId("schematic-proposal-review")).toHaveCount(0);
  await expect(page.getByTestId("journey-stage-schematic_proposal")).toHaveAttribute("data-status", "pending");

  // 3. the circuit request: its route and the prepare-PCB intent are shown before sending; the proposal carries its note.
  await prompt.fill(BLINKER_ACCEPTANCE_PROMPT);
  await expect(page.getByTestId("composer-route")).toHaveAttribute("data-route", "generate");
  await expect(page.getByTestId("composer-prepare-pcb-hint")).toBeVisible();
  await expect(submit).toHaveText("Generate");
  await submit.click();
  await expect(page.getByTestId("schematic-proposal-review")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId("schematic-proposal-summary")).toContainText(/U1|555/);
  await expect(page.getByTestId("journey-stage-schematic_proposal")).toHaveAttribute("data-status", "awaiting_approval");
  await expect(page.getByTestId("journey-next-action")).toHaveAttribute("data-action-id", "review_proposal");

  // 4. a reload with the proposal pending: the record exists the moment the proposal is offered, and the same proposal is
  //    offered again after the reload (same base), marked as restored.
  expect(await page.evaluate(() => Object.keys(window.localStorage).filter((key) => key.startsWith("sirkit:pending-proposal:")).length)).toBe(1);
  await page.reload();
  await expect(page.getByTestId("fixture-runtime-banner")).toBeVisible();
  await expect(page.getByTestId("journey-stage-requirements")).toBeVisible();
  expect(await page.evaluate(() => Object.keys(window.localStorage).filter((key) => key.startsWith("sirkit:pending-proposal:")).length), "the record survives the reload until the proposal is decided").toBe(1);
  await expect(page.getByTestId("schematic-proposal-review")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("schematic-proposal-validation")).toContainText(/Restored after a reload/);

  // 5. approval → the schematic is applied → the next permitted stage is offered; nothing beyond it happens by itself.
  await page.getByTestId("schematic-proposal-approve").click();
  await expect(page.getByTestId("schematic-proposal-review")).toBeHidden();
  await expect(page.getByTestId("journey-stage-schematic_applied")).toHaveAttribute("data-status", "succeeded", { timeout: 30_000 });
  await expect(page.getByTestId("journey-next-action")).toHaveAttribute("data-action-id", /open_pcb|prepare_pcb/);
  expect(await page.evaluate(() => Object.keys(window.localStorage).filter((key) => key.startsWith("sirkit:pending-proposal:")).length)).toBe(0); // approved: the record is gone
  await page.reload(); // nothing is offered twice
  await expect(page.getByTestId("fixture-runtime-banner")).toBeVisible();
  await expect(page.getByTestId("schematic-proposal-review")).toHaveCount(0);

  // 6. Prepare PCB from the strip: opens the PCB tab and starts the same preparation the button starts; an editor cannot
  //    publish a binding, so it stops at the review handoff with the reason, and no board exists.
  let action = await page.getByTestId("journey-next-action").getAttribute("data-action-id");
  if (action === "open_pcb") {
    await page.getByTestId("journey-next-action").click();
    await expect(page.getByTestId("pcb-empty-state")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("journey-next-action")).toHaveAttribute("data-action-id", "prepare_pcb", { timeout: 30_000 });
    action = "prepare_pcb";
  }
  expect(action).toBe("prepare_pcb");
  await page.getByTestId("journey-next-action").click();
  await expect(page.getByText(/reviewer approval required/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("pcb-empty-state")).toBeVisible(); // no board was created
  await expect(page.getByTestId("component-review-panel")).toBeVisible();
  await expect(page.getByTestId("journey-stage-parts_footprints")).not.toHaveAttribute("data-status", "succeeded");
});
