/**
 * [B21 F2] Browser proof of the specialist orchestration against the REAL application with the orchestration flag ON - its own
 * config (`playwright.orchestration.config.ts`: the fixture web server of `playwright.config.ts` plus `SIRKIT_ORCHESTRATION_ENABLED=1`
 * and one role routed to the other provider, run AFTER the existing suite, never beside it; D21-43, the lead's decision). The fixture runtime and the SCRIPTED agent answer every
 * turn (never a model): the coordinator through its single-agent scripts, every specialist through B21-F's per-role script table
 * (`FIXTURE_ROLE_SCRIPTS`, answering through the strict result tool), so the router, the scheduler, the merge, the resume record and
 * the page's run log are the real ones. Every assertion reads what the page renders or the stream the page received - never a clock.
 *
 *  1. F4 / D21-30's browser half: a 3D control request is ONE coordinator turn - the `/api/chat` body intercepted, one `run_started`,
 *     one terminal, no orchestration event and no specialist line (the router's `single`, decided before any model call); the
 *     router is live in this server: a Tier 3 ask is refused before any model call.
 *  2. F6 in part: the runbook's scenario-17 sentence reaches the assistant (E4's composer) and its DAG shows the E2 status line, the
 *     circuit specialist on anthropic (the config's role override) and every other role on the page's openai; where a verifier decides, the one sealed replacement is presented once (the review is cancelled:
 *     the principal's approval stays offline, case 6); where both parties seal and disagree, the escalation line counts TWO sources and NOTHING is presented for approval.
 *  3. F12's browser half (the E3 resume on the chat surface): a DAG run interrupted after its plan (the human's Stop while the scripted
 *     specialist stalls) leaves the offer line; the same message sent again resumes it under the SAME run id - the resuming line, the
 *     first answer replayed from the record - the stalled specialist STARTS again and its own deadline ends it, and the resumed run finishes once, presenting nothing in either request (nothing is presented before the Stop, so a second presentation is not observable here: D21-45 - [B21 F2b] test 4, appended below, observes it).
 */
import { mkdirSync } from "node:fs";
import { expect, test, type BrowserContext, type Page, type Request } from "@playwright/test";
import { isOrchestrationRunEventType } from "../app/lib/agent/contracts";
import { TIER3_REFUSAL_SENTENCE } from "../app/lib/agent/orchestration/router";
import { B21_F_SENTENCES } from "../app/lib/agent/orchestration/__tests__/_f-cases";
import { chatResumeOfferLine, chatResumingLine, initialRunView, orchestrationStatusLine, replacementChatLines } from "../app/lib/project/chat-run-view";
import { bootstrapSynchronizedBoard } from "../e2e/fixture-journey";

test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);

const EVIDENCE = "artifacts/ai-control-plane-b21/evidence";
/** this spec's own id namespace (fixture-journey.ts: two journeys never mint the same project or board ids) */
const UUID_NAMESPACE = "b21f2000";
/** the events that hand the human an artifact to review (the families' own events, `SPECIALIST_PROPOSAL_EVENTS`) */
const PRESENTING_EVENTS: readonly string[] = ["proposal_ready", "pcb_proposal_ready", "layout_candidate_ready"];

type ChatEvent = Record<string, unknown> & { type?: unknown; message?: unknown };
interface ChatBody { provider?: string; messages?: Array<{ role: string; content: string }>; resumeRunId?: unknown }
/** The NDJSON stream the page's reader pulled, line by line, and how it ended: `done` (the body ended), `cancelled` (the page cancelled
 *  its reader: Stop), `error` (the connection failed) - null while it is still open. */
interface ChatStream { events: ChatEvent[]; end: "done" | "cancelled" | "error" | null }
/** One `/api/chat` exchange as the page made it: the body it sent (the network request, intercepted), the response head and the stream. */
interface ChatExchange { body: ChatBody; head: Promise<{ status: number; runId: string | null }>; stream: ChatStream }

let context: BrowserContext;
let page: Page;
const requests: Array<Pick<ChatExchange, "body" | "head">> = [];
const streams: ChatStream[] = [];

test.beforeAll(async ({ browser, baseURL }) => {
  context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  page = await context.newPage();
  page.on("request", (request: Request) => {
    if (request.method() !== "POST" || new URL(request.url()).pathname !== "/api/chat") return;
    let body: ChatBody = {};
    try { body = request.postDataJSON() as ChatBody; } catch { /* not JSON */ }
    requests.push({ body, head: request.response().then((answer) => ({ status: answer?.status() ?? 0, runId: answer?.headers()["x-sirkit-run-id"] ?? null })) });
  });
  // The stream the page received, as its reader pulled it: a PULL-THROUGH body (the B18-D review 2 technique) observes every NDJSON line
  // and hands the page the same bytes - and its cancel() cancels the source, so the page's Stop still closes the connection (a tee
  // would keep it open). Playwright's own response body is not used: DevTools does not keep a long streamed body.
  const byKey = new Map<string, ChatStream>();
  await context.exposeBinding("__sirkitChatStream", (_source, record: { key: string; open?: boolean; line?: string; end?: ChatStream["end"] }) => {
    let stream = byKey.get(record.key);
    if (!stream) { stream = { events: [], end: null }; byKey.set(record.key, stream); streams.push(stream); }
    if (typeof record.line === "string") { try { stream.events.push(JSON.parse(record.line) as ChatEvent); } catch { stream.events.push({ type: "(unparsed line)" }); } }
    if (record.end && stream.end === null) stream.end = record.end;
  });
  await context.addInitScript(() => {
    const host = window as unknown as { __sirkitChatStream?: (record: { key: string; open?: boolean; line?: string; end?: string }) => Promise<void> };
    const original = window.fetch.bind(window);
    const documentKey = String(performance.timeOrigin);
    let count = 0;
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const response = await original(input, init);
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if ((init?.method ?? "GET").toUpperCase() !== "POST" || new URL(url, window.location.href).pathname !== "/api/chat" || !response.body) return response;
      count += 1;
      const key = `${documentKey}:${count}`;
      const report = (record: { open?: boolean; line?: string; end?: string }): void => { void host.__sirkitChatStream?.({ key, ...record }); };
      report({ open: true });
      const source = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let ended = false; // the FIRST end is the stream's: a read pending when the page cancels resolves done afterwards
      const finish = (how: string): void => { if (!ended) { ended = true; report({ end: how }); } };
      const flush = (final: boolean): void => {
        for (let newline = buffer.indexOf("\n"); newline >= 0; newline = buffer.indexOf("\n")) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (line) report({ line });
        }
        if (final && buffer.trim()) report({ line: buffer.trim() });
        if (final) buffer = "";
      };
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          let chunk: ReadableStreamReadResult<Uint8Array>;
          try {
            chunk = await source.read();
          } catch (error) {
            if (ended) return;
            flush(true);
            finish("error");
            controller.error(error);
            return;
          }
          if (ended) return; // cancelled by the page while this read was pending
          if (chunk.done) {
            buffer += decoder.decode();
            flush(true);
            finish("done");
            controller.close();
            return;
          }
          buffer += decoder.decode(chunk.value, { stream: true });
          flush(false);
          controller.enqueue(chunk.value);
        },
        cancel(reason) {
          finish("cancelled");
          return source.cancel(reason);
        },
      });
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    };
  });
  await bootstrapSynchronizedBoard(page, context, baseURL!, UUID_NAMESPACE);
  mkdirSync(EVIDENCE, { recursive: true });
});

test.afterAll(async () => { await context.close(); });

async function openChat(): Promise<void> {
  const prompt = page.getByTestId("prompt-input");
  if (!(await prompt.isVisible())) await page.getByTestId("activity-ai chat").click();
  await expect(prompt).toBeVisible();
}

/** Types the sentence, checks the route the composer shows for it (overriding a `generate` route to the assistant with the page's own
 *  control, as a person would), sends it and returns its exchange. */
async function send(text: string, shown: "ask" | "generate" = "ask"): Promise<ChatExchange> {
  await openChat();
  const prompt = page.getByTestId("prompt-input");
  await expect(prompt).toBeEnabled({ timeout: 90_000 });
  await prompt.fill(text);
  const route = page.getByTestId("composer-route");
  await expect(route).toHaveAttribute("data-route", shown);
  if (shown !== "ask") await page.getByTestId("composer-route-override").click();
  await expect(route).toHaveAttribute("data-route", "ask");
  const sent = requests.length;
  expect(streams, "one observed stream per chat request").toHaveLength(sent);
  await prompt.press("Enter");
  await expect.poll(() => requests.length, { timeout: 30_000 }).toBeGreaterThan(sent);
  await expect.poll(() => streams.length, { timeout: 30_000 }).toBeGreaterThan(sent);
  return { ...requests[sent]!, stream: streams[sent]! };
}

/** The stream a finished exchange received - its body ENDED (never cancelled or failed) - and the page ready for the next message. */
async function finished(exchange: ChatExchange, timeout = 90_000): Promise<ChatEvent[]> {
  await expect.poll(() => exchange.stream.end, { timeout, message: "the stream reached its end" }).not.toBeNull();
  expect(exchange.stream.end).toBe("done");
  await expect(page.getByTestId("prompt-input")).toBeEnabled({ timeout: 90_000 });
  return exchange.stream.events;
}

const typesOf = (events: readonly ChatEvent[]): string[] => events.map((event) => String(event.type));
const terminalsOf = (events: readonly ChatEvent[]): string[] => typesOf(events).filter((type) => type === "run_completed" || type === "run_failed");
const linesOf = (events: readonly ChatEvent[], prefix: string): string[] => events.flatMap((event) => (typeof event.message === "string" && event.message.startsWith(prefix) ? [event.message] : []));
/** The run's ONE status line as the page words it (chat-run-view.ts `orchestrationStatusLine`), for the counters given. */
const statusLine = (scheduled: number, finishedCount: number): string => orchestrationStatusLine({ ...initialRunView(), orchestrated: true, specialistsScheduled: scheduled, specialistsFinished: finishedCount })!;
/** The follow-up turn's answers in a stream: the scripted coordinator answers it from the merged envelope's own counts. */
const followUpOf = (events: readonly ChatEvent[]): string[] => events.flatMap((event) => (event.type === "text_delta" && event.phase === "final" && String(event.text).startsWith("(fixture agent) The specialists' results") ? [String(event.text)] : []));

test("[B21 F2] F4 / D21-30: a 3D control request is ONE coordinator turn in the browser - the router (live in this server: a Tier 3 ask is refused before any model call) answers single, so the stream the page received carries one run_started, one terminal and no orchestration event, and the run log shows no specialist line", async () => {
  // the router is consulted by THIS server (the flag is on): the Tier 3 ask never reaches the scripted agent
  const refusal = await send("Release the board.");
  const refused = await finished(refusal);
  expect(typesOf(refused)).toEqual(["run_started", "warning", "run_completed"]);
  expect(refused.at(-1)).toMatchObject({ finalText: TIER3_REFUSAL_SENTENCE, steps: 0, toolCalls: 0 });
  await expect(page.getByText(TIER3_REFUSAL_SENTENCE).last()).toBeVisible();

  const view3d = await send(B21_F_SENTENCES.view3d);
  expect(view3d.body.messages?.at(-1), "the request carries the sentence as the user's last message").toEqual({ role: "user", content: B21_F_SENTENCES.view3d });
  expect(view3d.body, "a fresh run: nothing to resume").not.toHaveProperty("resumeRunId");
  expect((await view3d.head).status).toBe(200);
  const events = await finished(view3d);
  const types = typesOf(events);
  expect(types.filter((type) => type === "run_started"), "one run_started").toHaveLength(1);
  expect(terminalsOf(events), "one terminal: the run completed").toEqual(["run_completed"]);
  expect(types[0]).toBe("run_started");
  expect(types.at(-1)).toBe("run_completed");
  expect(types.filter((type) => isOrchestrationRunEventType(type)), "no plan, no specialist_started / finished, no partial result, no degraded notice").toEqual([]);
  expect(types).not.toContain("specialist_started");
  expect(linesOf(events, "Orchestration:"), "no orchestration line").toEqual([]);
  expect(events.at(-1)).toMatchObject({ steps: 1, toolCalls: 0 });
  // the page: the scripted coordinator's one reply, and no specialist or orchestration line anywhere in the chat
  await expect(page.getByText(/^\(fixture agent\) /).last()).toBeVisible();
  await expect(page.getByText(/^Specialists: /)).toHaveCount(0);
  await expect(page.getByText(/^Orchestration: /)).toHaveCount(0);
  await page.screenshot({ path: `${EVIDENCE}/f4-view3d-one-coordinator-turn.png`, fullPage: false });
});

test("[B21 F2] F6: the runbook's scenario-17 sentence reaches the assistant from the composer and its replacement DAG shows the E2 status line; where a verifier decides the one sealed replacement is presented once, and where both scripted parties seal and disagree the run log shows the escalation line and NOTHING is presented for approval", async () => {
  const dialog = page.getByRole("dialog").filter({ hasText: "Exact component replacement — review before applying" });
  const roles = ["circuit-topology", "component-sourcing-evidence", "schematic", "verification-critic"];
  // [B21 F2 fix: security-1, coverage-1, tests-01] the config routes the circuit specialist to anthropic; every other role inherits the page's openai
  const providers = [["circuit-topology", "anthropic"], ["component-sourcing-evidence", "openai"], ["schematic", "openai"], ["verification-critic", "openai"]];

  // (a) a verifier decides: the circuit specialist's delete of U1 cannot seal, the schematic specialist's exact replacement is presented
  const decided = await send(B21_F_SENTENCES.timer);
  expect(decided.body.provider, "the page's default provider").toBe("openai");
  const first = await finished(decided);
  expect(typesOf(first).filter((type) => type === "run_started")).toHaveLength(1);
  expect(terminalsOf(first)).toEqual(["run_completed"]);
  expect(first.filter((event) => event.type === "plan")).toEqual([expect.objectContaining({ rule: "D-component-replacement", scheduled: 4 })]);
  expect(first.filter((event) => event.type === "specialist_started").map((event) => event.role)).toEqual(roles);
  expect(first.filter((event) => event.type === "specialist_started").map((event) => [event.role, event.provider]), "each role on its routed provider").toEqual(providers);
  expect(first.filter((event) => PRESENTING_EVENTS.includes(String(event.type))).map((event) => event.type), "ONE artifact presented").toEqual(["proposal_ready"]);
  expect(linesOf(first, "Orchestration: presented for approval:"), "presented once, by the merge's rule").toHaveLength(1);
  expect(linesOf(first, "Orchestration: merge: ESCALATED"), "nothing to escalate").toEqual([]);
  expect(linesOf(first, "Orchestration: specialist circuit-topology (task ").filter((line) => line.includes(" tool sirkit.schematic.propose-tier1-edit refused: ")), "the verifier decides: the circuit specialist's delete of U1 never seals").toHaveLength(1);
  expect(followUpOf(first), "ONE follow-up turn, told the outcome").toEqual([expect.stringContaining("approval: presented.")]);
  await expect(page.getByText(statusLine(4, 4), { exact: true }).last(), "the E2 status line").toBeVisible();
  await expect(dialog, "the one accepted replacement opens the family's own review").toBeVisible({ timeout: 30_000 });
  await expect(dialog).toContainText("Nothing has been changed yet.");
  await page.screenshot({ path: `${EVIDENCE}/f6-verifier-decides-presented-once.png`, fullPage: false });
  await dialog.getByRole("button", { name: "Cancel — change nothing" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Replacement proposal discarded — nothing was changed.").last()).toBeVisible();

  // (b) both scripted parties seal and disagree on U1: both contradicted, ONE escalation, nothing presented
  const presentedBefore = await page.getByText(/^Orchestration: presented for approval:/).count();
  const disagreed = await send(B21_F_SENTENCES.timerBothSeal);
  const second = await finished(disagreed);
  expect(terminalsOf(second)).toEqual(["run_completed"]);
  expect(second.filter((event) => event.type === "specialist_started").map((event) => event.role)).toEqual(roles);
  expect(second.filter((event) => event.type === "specialist_started").map((event) => [event.role, event.provider]), "the two parties on two providers").toEqual(providers);
  expect(second.filter((event) => PRESENTING_EVENTS.includes(String(event.type))), "NOTHING presented for approval").toEqual([]);
  expect(linesOf(second, "Orchestration: presented for approval:")).toEqual([]);
  const escalations = linesOf(second, "Orchestration: merge: ESCALATED to the human (");
  expect(escalations, "ONE escalation").toHaveLength(1);
  expect(escalations[0], "TWO sources: the circuit specialist on anthropic and the schematic specialist on openai (one provider is one source, never more)").toContain("; 2 source(s);");
  expect(linesOf(second, "Orchestration: merge: specialist ").filter((line) => / contradicted: /.test(line)), "both parties contradicted").toHaveLength(2);
  expect(second.filter((event) => event.type === "partial_result"), "the two contradicted results withheld by the merge").toEqual([expect.objectContaining({ planned: 4, usable: 2 })]);
  expect(followUpOf(second), "ONE follow-up turn, told of the escalation").toEqual([expect.stringContaining("1 escalation(s)")]);
  await expect(page.getByText(escalations[0]!, { exact: true }), "the escalation line in the run log").toBeVisible();
  await expect(page.getByText(orchestrationStatusLine({ ...initialRunView(), orchestrated: true, specialistsScheduled: 4, specialistsFinished: 4, partialResult: { usable: 2, planned: 4 } })!, { exact: true }).last(), "the E2 status line (the merge's withheld results counted)").toBeVisible();
  await expect(dialog, "no review opens").toBeHidden();
  await expect(page.getByText(/^Orchestration: presented for approval:/)).toHaveCount(presentedBefore);
  await page.getByText(escalations[0]!, { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${EVIDENCE}/f6-disagreement-escalated-nothing-presented.png`, fullPage: false });
});

test("[B21 F2] F12's browser half: a DAG run interrupted after its plan (Stop while the scripted specialist stalls) leaves the E3 offer line; the same message sent again resumes it under the SAME run id - the resuming line, the first answer replayed from the record - and the resumed run finishes once, nothing presented in either request", async () => {
  const sentence = B21_F_SENTENCES.timeout; // the scripted stall: the circuit specialist never answers until its run's signal ends it
  const presentedBefore = await page.getByText(/^Orchestration: presented for approval:/).count();

  // the first request: the coordinator answers, the plan is recorded, the stalled specialist runs - then the human stops the run
  const interrupted = await send(sentence, "generate");
  const head = await interrupted.head;
  expect(head.status).toBe(200);
  expect(head.runId).toMatch(/^run-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  const runId = head.runId!;
  const provider = interrupted.body.provider!;
  await expect(page.getByText(/^Orchestration: specialist circuit-topology started \(task /).last(), "the stalled specialist is running").toBeVisible({ timeout: 60_000 });
  await page.getByTestId("chat-stop").click();
  await expect(page.getByText("Stopped by you — the assistant's answer (Stop answer) was cancelled.").last()).toBeVisible(); // [PR-L/M integration, 2026-10-18] the run-log line runbook L.5 renamed (app/page.tsx: Stop answer vs Stop design; e2e/l5-chat-task.spec.ts pins its full text) - the same Stop, the same visible line
  await expect.poll(() => interrupted.stream.end, { message: "Stop cancelled the stream the page was reading" }).toBe("cancelled");
  const before = interrupted.stream.events;
  expect(typesOf(before).slice(0, 1)).toEqual(["run_started"]);
  expect(terminalsOf(before), "no terminal reached the page: the run was stopped mid-DAG").toEqual([]);
  expect(before.filter((event) => event.type === "plan"), "the plan was recorded first").toEqual([expect.objectContaining({ rule: "D-full-circuit-creation", scheduled: 4 })]);
  expect(before.filter((event) => event.type === "specialist_started").map((event) => event.role), "the stalled specialist was running").toEqual(["circuit-topology"]);
  expect(before.filter((event) => PRESENTING_EVENTS.includes(String(event.type))), "nothing presented").toEqual([]);
  const firstAnswer = before.filter((event) => event.type === "text_delta" && event.phase === "final").map((event) => String(event.text)).join("");
  expect(firstAnswer, "the coordinator's first answer reached the page").toMatch(/^\(fixture agent\) /);
  await expect(page.getByText(statusLine(4, 0), { exact: true }).last(), "the stopped run's status line").toBeVisible();
  const offer = page.getByText(chatResumeOfferLine(runId, provider), { exact: true });
  await expect(offer, "the E3 offer line names this run and its provider").toHaveCount(1);
  await expect(offer).toBeVisible();
  await offer.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${EVIDENCE}/f12-resume-offer-after-stop.png`, fullPage: false });

  // the same message again: the page resumes the offered run (the body names it), the route reuses its run id
  const resumed = await send(sentence, "generate");
  expect(resumed.body.resumeRunId, "the resume names the offered run").toBe(runId);
  expect(resumed.body.messages?.at(-1)).toEqual({ role: "user", content: sentence });
  await expect(page.getByText(chatResumingLine(runId), { exact: true }), "the resuming line").toHaveCount(1);
  const resumedHead = await resumed.head;
  expect(resumedHead, "the route reused the run id").toEqual({ status: 200, runId });
  const events = await finished(resumed, 240_000); // the stalled specialist runs again (it never finished) until its OWN deadline ends it
  const types = typesOf(events);
  expect(types.filter((type) => type === "run_started")).toHaveLength(1);
  expect(terminalsOf(events), "the resumed run finished").toEqual(["run_completed"]);
  const replayed = linesOf(events, `Orchestration: resumed run ${runId}: `);
  expect(replayed, "the first answer replayed from the record").toHaveLength(1);
  expect(replayed[0]).toContain("the first answer is replayed from the record, no model call");
  const finals = events.filter((event) => event.type === "text_delta" && event.phase === "final").map((event) => String(event.text));
  expect(finals[0], "the recorded first answer, replayed verbatim").toBe(firstAnswer);
  expect(finals.filter((text) => text.startsWith("(fixture agent) The specialists' results")), "ONE follow-up turn").toHaveLength(1);
  // [B21 F2 fix: tests-02] the stalled specialist STARTS again (it never finished: E3 runs it again, never closes it unrun) ...
  expect(events.filter((event) => event.type === "specialist_started" && event.role === "circuit-topology").map((event) => event.attempt), "the stalled specialist starts again in the resumed run, at attempt 1").toEqual([1]);
  // ... and its OWN deadline ends it - the deadline branch's reason, never a not-run, step-limit or provider path's
  expect(events.filter((event) => event.type === "specialist_finished" && event.role === "circuit-topology").map((event) => [event.status, event.attempt, event.reason]), "the stalled specialist's OWN deadline ends it - this task only").toEqual([["escalated", 1, "deadline"]]);
  expect(events.filter((event) => event.type === "specialist_finished" && event.role !== "circuit-topology").map((event) => event.status), "every other specialist delivered").toEqual(["accepted", "accepted", "accepted"]);
  expect(events.filter((event) => event.type === "partial_result"), "the timeout is visible").toEqual([expect.objectContaining({ planned: 4, usable: 3 })]);
  expect(events.filter((event) => PRESENTING_EVENTS.includes(String(event.type))), "nothing presented").toEqual([]);
  expect(linesOf(events, "Orchestration: presented for approval:")).toEqual([]);
  await expect(page.getByText(replayed[0]!, { exact: true })).toBeVisible();
  await expect(page.getByText(orchestrationStatusLine({ ...initialRunView(), orchestrated: true, specialistsScheduled: 4, specialistsFinished: 4, partialResult: { usable: 3, planned: 4 } })!, { exact: true }).last(), "the resumed run's status line").toBeVisible();
  // the offer was spent: the run finished, so no second offer line; nothing was ever presented for approval
  await expect(page.getByText(/^Resume: send the same message again on /)).toHaveCount(1);
  await expect(page.getByText(/^Orchestration: presented for approval:/)).toHaveCount(presentedBefore);
  await expect(page.getByRole("dialog").filter({ hasText: "review before applying" })).toHaveCount(0);
  await page.getByText(replayed[0]!, { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${EVIDENCE}/f12-resumed-run-finished.png`, fullPage: false });
});

/**
 * [B21 F2b] 4. F12 / D21-45, the lead's option (a): a run that PRESENTS and then stands down, in the browser. The browser's F12 sentence
 * (`B21_F_SENTENCES.rejectResumeBrowser`) recruits the replacement DAG, whose schematic specialist seals U1's exact replacement - presented
 * ONCE through its family's review, as test 2's verifier-decides leg presents it - and whose coordinator follow-up turn then FAILS: the
 * scripted agent's one scripted provider failure (`FIXTURE_FOLLOW_UP_FAILURES`: overloaded, the answer b21-f-evaluation case 12's fake SDK
 * client gives), made only while the merged envelope says that request presented. The human REJECTS the replacement through the review's
 * own Cancel (no new control); the page offers the resume; the same message resumes the run under its run id - the first answer and every
 * committed specialist replayed - and OD-122's ledger presents NOTHING again (`already_presented`), the follow-up turn answering once.
 */
test("[B21 F2b] F12 / D21-45: a run that PRESENTS and then stands down - the schematic specialist's replacement is presented once, the human REJECTS it through its review's own Cancel, the run stands down (its scripted follow-up turn failed) and the page shows the E3 offer line; the same message sent again resumes it under the SAME run id - the resuming line, the first answer and every committed specialist replayed - presents NOTHING again (already_presented, the run log's line) and the follow-up turn answers once, one terminal: ONE presentation in all", async () => {
  const sentence = B21_F_SENTENCES.rejectResumeBrowser;
  const dialog = page.getByRole("dialog").filter({ hasText: "Exact component replacement — review before applying" });
  const presentedLines = page.getByText(/^Orchestration: presented for approval:/);
  const offerLines = page.getByText(/^Resume: send the same message again on /);
  const presentedBefore = await presentedLines.count();
  const offersBefore = await offerLines.count();
  const finalsOf = (events: readonly ChatEvent[]): string[] => events.filter((event) => event.type === "text_delta" && event.phase === "final").map((event) => String(event.text));
  // [B21 F2b review: regressions-2, tests-2, tests-3] the serial spec shares ONE page and test 2 left a discard line and the status line
  // `Specialists: 4 scheduled · 4 finished` in its chat: every line here that an earlier test also renders is COUNTED before and after,
  // among the chat's own lines - never the transient toast (`role="status"`), which repeats a discard line for a few seconds - and the
  // status lines are literal counters through the page's builder, never the page's own reducer over the stream it received
  const chatLines = (text: string | RegExp) => page.getByText(text, { exact: true }).and(page.locator('xpath=//*[not(ancestor-or-self::*[@role="status"])]'));
  const discardedLines = chatLines(replacementChatLines.discarded());
  const appliedLines = chatLines(/^Replacement (?:(?:was already )?applied — |NOT applied: )/);
  const stoodDownStatus = orchestrationStatusLine({ ...initialRunView(), orchestrated: true, specialistsScheduled: 4, specialistsFinished: 4, specialistsDegraded: 1 })!;
  const [discardedBefore, appliedBefore, stoodDownStatusBefore] = [await discardedLines.count(), await appliedLines.count(), await chatLines(stoodDownStatus).count()];

  // the first request: the replacement DAG runs, the schematic specialist's exact replacement is presented - then the follow-up turn fails
  const presenting = await send(sentence); // E4's composer: a genuine replacement request asks the assistant
  expect(presenting.body, "a fresh run: nothing to resume").not.toHaveProperty("resumeRunId");
  const head = await presenting.head;
  expect(head.status).toBe(200);
  expect(head.runId).toMatch(/^run-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  const runId = head.runId!;
  const provider = presenting.body.provider!;
  const first = await finished(presenting);
  const firstTypes = typesOf(first);
  expect(firstTypes.filter((type) => type === "run_started"), "one run_started").toHaveLength(1);
  expect(terminalsOf(first), "one terminal: the coordinator's answer stands").toEqual(["run_completed"]);
  expect(first.filter((event) => event.type === "plan")).toEqual([expect.objectContaining({ rule: "D-component-replacement", scheduled: 4 })]);
  expect(first.filter((event) => event.type === "specialist_finished").map((event) => [event.role, event.status]), "every specialist delivered").toEqual([["circuit-topology", "accepted"], ["component-sourcing-evidence", "accepted"], ["schematic", "accepted"], ["verification-critic", "accepted"]]);
  expect(first.filter((event) => event.type === "partial_result"), "every result usable: no partial result").toEqual([]);
  expect(first.filter((event) => PRESENTING_EVENTS.includes(String(event.type))).map((event) => event.type), "ONE artifact presented").toEqual(["proposal_ready"]);
  expect(linesOf(first, "Orchestration: presented for approval: task-3-schematic action 0 ("), "the schematic specialist's replacement, presented by the merge's rule").toHaveLength(1);
  const standDown = first.filter((event) => event.type === "degraded");
  expect(standDown.map((event) => event.reason), "the run stood down: its follow-up turn failed").toEqual(["follow_up_failed"]);
  expect(String(standDown[0]!.message), "the scripted provider failure: overloaded, as case 12's").toContain("(provider_overloaded)");
  expect(firstTypes.indexOf("degraded"), "the stand-down came AFTER the presentation").toBeGreaterThan(firstTypes.indexOf("proposal_ready"));
  expect(followUpOf(first), "the follow-up turn never answered").toEqual([]);
  const firstAnswer = finalsOf(first).join("");
  expect(firstAnswer, "the coordinator's first answer reached the page").toMatch(/^\(fixture agent\) /);
  // the review opens; the human REJECTS it through its own Cancel - nothing is changed
  await expect(dialog, "the one presented replacement opens the family's own review").toBeVisible({ timeout: 30_000 });
  await expect(dialog).toContainText("Nothing has been changed yet.");
  await dialog.getByRole("button", { name: "Cancel — change nothing" }).click();
  await expect(dialog).toBeHidden();
  await expect(discardedLines, "rejected: nothing applied").toHaveCount(discardedBefore + 1);
  await expect(appliedLines, "the Cancel applied nothing: no applied line").toHaveCount(appliedBefore);
  // the page: the stand-down line (this run's own: no earlier test stands down), the status line - 4 scheduled, 4 finished and its ONE
  // degraded notice, as literal counters - and E3's offer
  await expect(chatLines(String(standDown[0]!.message)), "the stand-down line").toHaveCount(1);
  await expect(chatLines(stoodDownStatus), "the stood-down run's status line").toHaveCount(stoodDownStatusBefore + 1);
  const offer = page.getByText(chatResumeOfferLine(runId, provider), { exact: true });
  await expect(offer, "the E3 offer line names this run and its provider").toHaveCount(1);
  await expect(offerLines, "one new offer").toHaveCount(offersBefore + 1);
  await expect(presentedLines, "presented once").toHaveCount(presentedBefore + 1);
  await offer.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${EVIDENCE}/f12-presented-rejected-stood-down.png`, fullPage: false });

  // the same message again: the page resumes the offered run (the body names it), the route reuses its run id
  const resumedStatusBefore = await chatLines(statusLine(4, 4)).count();
  const resumed = await send(sentence);
  expect(resumed.body.resumeRunId, "the resume names the offered run").toBe(runId);
  expect(resumed.body.messages?.at(-1)).toEqual({ role: "user", content: sentence });
  await expect(page.getByText(chatResumingLine(runId), { exact: true }), "the resuming line").toHaveCount(1);
  expect(await resumed.head, "the route reused the run id").toEqual({ status: 200, runId });
  const events = await finished(resumed);
  expect(typesOf(events).filter((type) => type === "run_started"), "one run_started").toHaveLength(1);
  expect(terminalsOf(events), "one terminal: the resumed run finished").toEqual(["run_completed"]);
  const replayed = linesOf(events, `Orchestration: resumed run ${runId}: `);
  expect(replayed, "the first answer replayed from the record").toHaveLength(1);
  expect(replayed[0]).toContain("the first answer is replayed from the record, no model call");
  expect(finalsOf(events)[0], "the recorded first answer, replayed verbatim").toBe(firstAnswer);
  expect(events.filter((event) => event.type === "specialist_finished").map((event) => [event.role, event.status]), "every committed specialist replayed, none run again").toEqual([["circuit-topology", "replayed"], ["component-sourcing-evidence", "replayed"], ["schematic", "replayed"], ["verification-critic", "replayed"]]);
  expect(events.filter((event) => event.type === "partial_result"), "every replayed result usable: no partial result").toEqual([]);
  expect(events.filter((event) => PRESENTING_EVENTS.includes(String(event.type))), "NOTHING presented again").toEqual([]);
  expect(linesOf(events, "Orchestration: presented for approval:")).toEqual([]);
  const already = linesOf(events, "Orchestration: nothing from the specialists is presented for approval (already_presented): ");
  expect(already, "OD-122's ledger: the first request presented this message's one artifact").toHaveLength(1);
  expect(events.filter((event) => event.type === "degraded"), "no stand-down: the follow-up answered").toEqual([]);
  expect(followUpOf(events), "ONE follow-up turn, told nothing was presented again").toEqual([expect.stringContaining("approval: already_presented.")]);
  await expect(page.getByText(already[0]!, { exact: true }), "the run log's already_presented line").toBeVisible();
  await expect(page.getByText(replayed[0]!, { exact: true })).toBeVisible();
  await expect(chatLines(statusLine(4, 4)), "the resumed run's status line: 4 scheduled, 4 finished, no notice").toHaveCount(resumedStatusBefore + 1);
  // ONE presentation in all: no second review, no second presented line, and the finished run leaves no second offer
  expect([...first, ...events].filter((event) => PRESENTING_EVENTS.includes(String(event.type))), "one presentation across both requests").toHaveLength(1);
  await expect(presentedLines, "presented once in all").toHaveCount(presentedBefore + 1);
  await expect(dialog, "no review opens again").toBeHidden();
  await expect(offerLines, "the finished run leaves no second offer").toHaveCount(offersBefore + 1);
  await expect(appliedLines, "nothing applied in all: no applied line").toHaveCount(appliedBefore);
  await page.getByText(already[0]!, { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${EVIDENCE}/f12-resume-nothing-presented-again.png`, fullPage: false });
});
