/**
 * [B21 E1] The `llm-provider` admission key and breaker (OD-115, D21-18) through the REAL adapters with fake SDK clients, the REAL
 * scheduler, loop and gateway: `insufficient_quota` opens the breaker AT ONCE for a long window and no second paid call follows in
 * the DAG, in a later DAG or in the follow-up turn; `rate_limit` opens it for its window and the scheduler's one retry is refused
 * without a call; after the window ONE trial goes; a hanging call ends at the task's own deadline; every outcome records the
 * provider and model it ran on. The meters are the process's own (`admission-control.ts`), reset after every case.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDurableWorkflowRepository } from "@/app/lib/durable-workflow/repository";
import { AGENT_SYSTEM_PROMPT } from "@/app/lib/prompts";
import { createAgentToolGateway } from "@/app/lib/agent/gateway";
import { OpenAIAgentAdapter } from "@/app/lib/agent/adapters";
import { DEFAULT_AGENT_BUDGET, type AgentRunEvent } from "@/app/lib/agent/contracts";
import { LLM_PROVIDER_ADMISSION, PURPOSE_QUOTA_SHARE, admissionKeyString, currentLlmProviderPause, recordLlmProviderOutcome, requestLlmProviderAdmission, resetAdmissionControl, resetLlmProviderBreaker, type LlmProviderTicket } from "@/app/lib/acquisition/admission-control";
import { resetOrchestrationStoreFactory, runOrchestratedChat, setOrchestrationStoreFactory } from "@/app/api/chat/orchestration-runtime";
import { DurableOrchestrationRunStore } from "../store";
import { SPECIALIST_CAPS } from "../scheduler";
import { PROCESS_LLM_PROVIDER_ADMISSION, ROLE_MODELS_ENV, admittedAdapter } from "../provider-policy";
import { agentProviderName } from "@/app/lib/agent/provider-tools";
import { HANG, START_INPUT, anthropicQuotaError, anthropicResultMessage, answersAnthropic, answersOpenAI, failOnce, fakeAnthropic, fakeOpenAI, fakeProviders, heldAdapter, openAIQuotaError, openAIRateLimitError, openAIResultResponse, openAITextResponse, roleOf, runE1Dag, type Params } from "./_e1-fixtures";
import { REGISTRY, coordinatorContext } from "./_merge-fixtures";

const T0 = Date.parse("2026-09-27T12:00:00.000Z");
const MINUTE = 60_000;
const OPENAI = { kind: "llm-provider", provider: "openai" } as const;

vi.stubGlobal("fetch", () => { throw new Error("no network"); });
beforeEach(() => resetAdmissionControl());
afterEach(() => { resetAdmissionControl(); resetOrchestrationStoreFactory(); });

describe("[B21 E1] the llm-provider meters and breaker (OD-115)", () => {
  it("1. the admission key gains the `llm-provider` kind (a reviewed extension of B20-A0's union) and its meters: a provider window with the agent held to its share (OD-40) and a per-model window, the process's own", () => {
    expect(admissionKeyString(OPENAI)).toBe("llm-provider:openai");
    expect(admissionKeyString({ kind: "llm-provider", provider: "anthropic", model: "claude-opus-4-7" })).toBe("llm-provider:anthropic/model:claude-opus-4-7");
    expect(LLM_PROVIDER_ADMISSION).toEqual({ requestsPerMinute: 240, consecutiveFailuresToOpen: 3, rateLimitOpenMs: 60_000, quotaOpenMs: 3_600_000 });
    const share = Math.floor(LLM_PROVIDER_ADMISSION.requestsPerMinute * PURPOSE_QUOTA_SHARE.agent);
    expect(share).toBe(60);
    // [B21 E1 fix] an admitted call carries its ticket (the breaker generation it was admitted under, whether it is the trial)
    const closed = { allowed: true, ticket: { generation: expect.any(Number), trial: false } };
    for (let index = 0; index < share; index += 1) expect(requestLlmProviderAdmission({ ...OPENAI, model: "gpt-5.6-sol" }, T0, "agent"), `${index}`).toEqual(closed);
    const refused = requestLlmProviderAdmission({ ...OPENAI, model: "gpt-5.6-sol" }, T0, "agent");
    expect(refused).toMatchObject({ allowed: false, reason: "quota_exhausted", retryAtMs: T0 + MINUTE });
    expect(requestLlmProviderAdmission({ ...OPENAI, model: "gpt-5.6-sol" }, T0, "interactive")).toEqual(closed); // a person's turn still admits
    expect(requestLlmProviderAdmission({ kind: "llm-provider", provider: "anthropic" }, T0, "agent")).toEqual(closed); // another provider's meter
    expect(requestLlmProviderAdmission({ ...OPENAI, model: "gpt-5.6-sol" }, T0 + MINUTE, "agent"), "the next minute opens").toEqual(closed);
  });

  it("2. the breaker: `insufficient_quota` opens it AT ONCE for the long window (until an operator resets it or the window passes), `rate_limit` at once for its window, three transient failures open it; after the window ONE trial goes - its success closes it, a quota failure re-opens it for the long window; [B21 E1 fix: security-2] an abandoned trial learnt nothing and is not counted (the breaker stays half-open, the next call is the trial); the reset forgets", () => {
    /** a call admitted now, its ticket (every outcome is recorded with the ticket its call was admitted under) */
    const admitted = (now: number): LlmProviderTicket => {
      const admission = requestLlmProviderAdmission(OPENAI, now, "agent");
      if (!admission.allowed) throw new Error(admission.message);
      return admission.ticket;
    };
    recordLlmProviderOutcome(OPENAI, admitted(T0), "insufficient_quota", T0);
    const quota = currentLlmProviderPause(OPENAI, T0 + 1, "agent");
    expect(quota).toMatchObject({ reason: "breaker_open", retryAtMs: T0 + LLM_PROVIDER_ADMISSION.quotaOpenMs });
    expect(quota!.message).toMatch(/^LLM provider "openai" is paused \(insufficient_quota\) until 2026-09-27T13:00:00\.000Z or until an operator resets it; no call is made to it before then \(OD-115\)\.$/);
    expect(requestLlmProviderAdmission(OPENAI, T0 + 30 * MINUTE, "agent")).toMatchObject({ allowed: false, reason: "breaker_open" });
    expect(currentLlmProviderPause({ kind: "llm-provider", provider: "anthropic" }, T0 + 1, "agent")).toBeNull();
    // the window passes: one trial (half-open), a second request waits for it; the trial's quota failure re-opens the LONG window
    const after = T0 + LLM_PROVIDER_ADMISSION.quotaOpenMs + 1;
    expect(currentLlmProviderPause(OPENAI, after, "agent")).toBeNull();
    const trial = admitted(after);
    expect(trial.trial).toBe(true);
    expect(requestLlmProviderAdmission(OPENAI, after, "agent")).toMatchObject({ allowed: false, reason: "breaker_open" });
    recordLlmProviderOutcome(OPENAI, trial, "insufficient_quota", after);
    expect(currentLlmProviderPause(OPENAI, after + 1, "agent")).toMatchObject({ retryAtMs: after + LLM_PROVIDER_ADMISSION.quotaOpenMs });
    // an operator reset closes it
    resetLlmProviderBreaker("openai");
    expect(currentLlmProviderPause(OPENAI, after + 2, "agent")).toBeNull();
    // rate_limit: at once, for its window; the trial's success closes it
    recordLlmProviderOutcome(OPENAI, admitted(T0), "rate_limited", T0);
    const limited = currentLlmProviderPause(OPENAI, T0 + 1, "agent");
    expect(limited).toMatchObject({ reason: "breaker_open", retryAtMs: T0 + LLM_PROVIDER_ADMISSION.rateLimitOpenMs });
    expect(limited!.message).toMatch(/is paused \(rate_limit\) until 2026-09-27T12:01:00\.000Z; no call is made/);
    const rateTrial = admitted(T0 + MINUTE + 1);
    expect(rateTrial.trial).toBe(true);
    recordLlmProviderOutcome(OPENAI, rateTrial, "success", T0 + MINUTE + 2);
    expect(currentLlmProviderPause(OPENAI, T0 + MINUTE + 3, "agent")).toBeNull();
    // transient failures open it at the third; a success in between resets the count
    for (const outcome of ["failure", "failure", "success", "failure", "failure"] as const) recordLlmProviderOutcome(OPENAI, admitted(T0), outcome, T0);
    expect(currentLlmProviderPause(OPENAI, T0 + 1, "agent")).toBeNull();
    recordLlmProviderOutcome(OPENAI, admitted(T0), "failure", T0);
    expect(currentLlmProviderPause(OPENAI, T0 + 1, "agent")!.message).toMatch(/is paused \(failures\) until 2026-09-27T12:01:00\.000Z/);
    // [B21 E1 fix: security-2] an abandoned (inconclusive) trial learnt nothing: NOT counted - the breaker stays half-open and the next
    // call is the trial (never re-armed for the long window by a call nobody finished)
    resetAdmissionControl();
    recordLlmProviderOutcome(OPENAI, admitted(T0), "insufficient_quota", T0);
    const abandoned = admitted(after);
    expect(abandoned.trial).toBe(true);
    recordLlmProviderOutcome(OPENAI, abandoned, "inconclusive", after);
    expect(currentLlmProviderPause(OPENAI, after + 1, "agent")).toBeNull();
    expect(admitted(after + 1).trial).toBe(true); // the next call is the trial
    expect(requestLlmProviderAdmission(OPENAI, after + 1, "agent")).toMatchObject({ allowed: false, reason: "breaker_open" }); // one at a time
    resetAdmissionControl();
    expect(currentLlmProviderPause(OPENAI, after + 1, "agent")).toBeNull();
  });

  it("3. a 429 `insufficient_quota` through the REAL adapter in a specialist run: the task is escalated and never retried, the breaker opens at once, the DAG stops before the next specialist - ONE paid call in all; a later DAG while the breaker is open makes NO call at all, every task not started under one visible line", async () => {
    const openai = fakeOpenAI(() => openAIQuotaError());
    const anthropic = fakeAnthropic(answersAnthropic);
    const { providers } = fakeProviders(openai, anthropic);
    const first = await runE1Dag(["requirements-analyst", "verification-critic"], providers, { now: () => T0 });
    expect(first.ran!.stop).toBe("provider_outage");
    expect(first.ran!.tasks.map((task) => [task.role, task.attempt, task.status])).toEqual([["requirements-analyst", 0, "escalated"]]);
    expect(first.ran!.tasks[0]!.reason).toMatch(/^provider_insufficient_quota: the specialist run failed before a result \(not retryable\)/);
    expect(first.ran!.notStarted.map((task) => task.role)).toEqual(["verification-critic"]);
    expect(openai.create).toHaveBeenCalledTimes(1);
    expect(anthropic.create).not.toHaveBeenCalled();
    expect(currentLlmProviderPause(OPENAI, T0 + 1, "agent")).toMatchObject({ reason: "breaker_open", retryAtMs: T0 + LLM_PROVIDER_ADMISSION.quotaOpenMs });
    // a later DAG (another coordinator run) while the breaker is open: no call at all, visibly
    const second = await runE1Dag(["requirements-analyst", "verification-critic"], providers, { now: () => T0 + 5 * MINUTE, runId: "run-b21e1-later" });
    expect(second.ran!.stop).toBe("provider_paused"); // [B21 E1 fix: regressions-3] paused by the meters before any call: no call failed
    expect(second.ran!.tasks).toEqual([]);
    expect(second.ran!.notStarted.map((task) => task.role)).toEqual(["requirements-analyst", "verification-critic"]);
    expect(openai.create).toHaveBeenCalledTimes(1);
    expect(second.warnings.filter((line) => line.includes("not started and no follow-up turn can run"))).toEqual([expect.stringMatching(/^Orchestration: 2 specialist\(s\) not started and no follow-up turn can run - the coordinator's LLM provider "openai" is paused \(insufficient_quota\) until 2026-09-27T13:00:00\.000Z or until an operator resets it; no call is made to it before then \(OD-115\)\.$/)]);
  });

  it("4. `rate_limit` opens the breaker for its window: the specialist's one retry (B's rule) is refused WITHOUT a call and the DAG stops; after the window the next DAG's first call is the half-open trial, and its success closes the breaker", async () => {
    let limited = true;
    const openai = fakeOpenAI((params) => (limited ? openAIRateLimitError() : openAIResultResponse(roleOf(params))));
    const { providers } = fakeProviders(openai, fakeAnthropic(answersAnthropic));
    const first = await runE1Dag(["requirements-analyst", "verification-critic"], providers, { now: () => T0 });
    expect(openai.create).toHaveBeenCalledTimes(1);
    expect(first.ran!.stop).toBe("provider_outage");
    expect(first.ran!.tasks.map((task) => [task.role, task.attempt, task.status])).toEqual([["requirements-analyst", 0, "escalated"]]);
    expect(first.ran!.tasks[0]!.reason).toMatch(/^provider_rate_limit: the specialist run failed before a result \(not retried: LLM provider "openai" is paused \(rate_limit\) until 2026-09-27T12:01:00\.000Z; no call is made to it before then \(OD-115\)\.\)$/);
    expect(currentLlmProviderPause(OPENAI, T0 + 1, "agent")).toMatchObject({ retryAtMs: T0 + LLM_PROVIDER_ADMISSION.rateLimitOpenMs });
    limited = false;
    const later = await runE1Dag(["requirements-analyst", "verification-critic"], providers, { now: () => T0 + MINUTE + 1, runId: "run-b21e1-after-window" });
    expect(later.ran!.stop).toBe("completed");
    expect(later.ran!.tasks.map((task) => [task.role, task.status])).toEqual([["requirements-analyst", "accepted"], ["verification-critic", "accepted"]]);
    expect(openai.create).toHaveBeenCalledTimes(3);
    expect(currentLlmProviderPause(OPENAI, T0 + MINUTE + 2, "agent")).toBeNull();
  });

  it("5. a hanging call ends at the task's OWN deadline: `deadline` for that task only, the next task still runs and is accepted; the abandoned call's reservation is settled inconclusive, so the breaker stays closed", async () => {
    const openai = fakeOpenAI((params) => (roleOf(params) === "requirements-analyst" ? HANG : openAIResultResponse(roleOf(params))));
    const { providers } = fakeProviders(openai, fakeAnthropic(answersAnthropic));
    const run = await runE1Dag(["requirements-analyst", "verification-critic"], providers, { budget: { ...DEFAULT_AGENT_BUDGET, runDeadlineMs: 200 } });
    expect(run.ran!.stop).toBe("completed");
    expect(run.ran!.tasks.map((task) => [task.role, task.status, task.reason])).toEqual([["requirements-analyst", "escalated", "deadline"], ["verification-critic", "accepted", null]]);
    expect(openai.options[0]!.signal).toBeInstanceOf(AbortSignal);
    expect((openai.options[0]!.signal as AbortSignal).aborted).toBe(true);
    expect(currentLlmProviderPause(OPENAI, Date.now(), "agent")).toBeNull();
  }, 20_000);

  it("6. every outcome records the provider and model it ran on: accepted on each provider, malformed, a stopped turn and a route the policy refused each carry their provider, the model the provider reported (null when none answered) and, for a run, the route (provider, model, source, SDK retries 0); a replay carries no route (its provenance is unrecorded - B21-D's rule)", async () => {
    const openai = fakeOpenAI((params) => {
      const role = roleOf(params);
      if (role === "component-sourcing-evidence") return openAITextResponse("I checked the authority; the part is fine.");
      if (role === "verification-critic") return { ...openAIResultResponse(role), status: "incomplete", incomplete_details: { reason: "max_output_tokens" } };
      return openAIResultResponse(role);
    });
    const anthropic = fakeAnthropic((params) => anthropicResultMessage(roleOf(params)));
    const env = { [ROLE_MODELS_ENV]: JSON.stringify({ "requirements-analyst": { provider: "anthropic", model: "claude-sonnet-4-5" }, "manufacturing-readiness-reviewer": { provider: "openai", model: "gpt-6-luna" } }) }; // [PR-F, 2026-10-17] reviewed pin move: the refused example was gpt-6-astra, now admitted when the role map names it (pr-f-astra-profile); gpt-6-luna is a documented sibling without a profile
    const { providers, built } = fakeProviders(openai, anthropic, { env });
    const repository = new InMemoryDurableWorkflowRepository();
    const run = await runE1Dag(["requirements-analyst", "component-sourcing-evidence", "verification-critic", "manufacturing-readiness-reviewer"], providers, { repository });
    expect(run.ran!.stop).toBe("completed");
    expect(run.ran!.tasks.map((task) => [task.role, task.status, task.provider, task.model, task.route ? [task.route.provider, task.route.model, task.route.source, task.route.sdkMaxRetries, task.route.fallbackFrom] : null])).toEqual([
      ["requirements-analyst", "accepted", "anthropic", "claude-fake", ["anthropic", "claude-sonnet-4-5", "env", 0, null]],
      ["component-sourcing-evidence", "malformed", "openai", "gpt-fake", ["openai", "gpt-5.6-sol", "inherit", 0, null]],
      ["verification-critic", "escalated", "openai", "gpt-fake", ["openai", "gpt-5.6-sol", "inherit", 0, null]],
      ["manufacturing-readiness-reviewer", "escalated", "openai", null, null],
    ]);
    expect(run.ran!.tasks[1]!.reason).toMatch(/^result_tool_not_called: /);
    expect(run.ran!.tasks[2]!.reason).toMatch(/^stop_max_tokens: /);
    expect(run.ran!.tasks[3]!.reason).toMatch(/^model_unqualified: .*gpt-6-luna.*LB-9/); // [PR-F, 2026-10-17] the refused example (was gpt-6-astra)
    expect(built.map((route) => [route.role, route.provider, route.model])).toEqual([["requirements-analyst", "anthropic", "claude-sonnet-4-5"], ["component-sourcing-evidence", "openai", "gpt-5.6-sol"], ["verification-critic", "openai", "gpt-5.6-sol"]]);
    expect(anthropic.calls.map((params) => params.model)).toEqual(["claude-sonnet-4-5"]);
    expect(openai.calls.map((params) => params.model)).toEqual(["gpt-5.6-sol", "gpt-5.6-sol"]);
    expect(run.warnings.filter((line) => line.includes("model_unqualified"))).toEqual([expect.stringMatching(/^Orchestration: specialist manufacturing-readiness-reviewer not run \(model_unqualified, task task-4-manufacturing-readiness-reviewer\): /)]);
    // the same coordinator run resumed: the accepted result replays with no route, the rest run again
    const resumed = await runE1Dag(["requirements-analyst", "component-sourcing-evidence", "verification-critic", "manufacturing-readiness-reviewer"], providers, { repository });
    expect(resumed.ran!.tasks[0]).toMatchObject({ role: "requirements-analyst", status: "replayed", provider: "openai", model: null });
    expect(resumed.ran!.tasks[0]!.route).toBeUndefined();
  });

  it("7. the follow-up coordinator turn is never made against a paused provider, and the coordinator never switches provider mid-run: a breaker opened while the run merged (another request's quota failure, landing at the merge's first record) stands the run down visibly - the first answer stands, no follow-up call, no call on the other provider", async () => {
    const base = new DurableOrchestrationRunStore(new InMemoryDurableWorkflowRepository());
    let opened = false;
    // ANOTHER request's quota failure lands while this run's merge writes its first decision (after every specialist call settled)
    setOrchestrationStoreFactory(() => ({ revision: (scope) => base.revision(scope), history: (scope) => base.history(scope), append: async (request) => { if (!opened && request.taskId.includes(".merge-")) { opened = true; await failOnce("openai", "insufficient_quota", Date.now()); } return base.append(request); } }));
    const coordinator = fakeOpenAI(() => openAITextResponse("(fake) the coordinator's first answer."));
    const specialists = fakeOpenAI(answersOpenAI);
    const anthropic = fakeAnthropic(answersAnthropic);
    const { providers } = fakeProviders(specialists, anthropic);
    const events: AgentRunEvent[] = [];
    const result = await runOrchestratedChat({
      request: { runId: "run-b21e1-follow-up", provider: "openai", history: [], userMessage: "Check the board against the requirements.", budget: DEFAULT_AGENT_BUDGET },
      deps: { adapter: new OpenAIAgentAdapter(coordinator.client as never, "gpt-fake", undefined), gateway: createAgentToolGateway(REGISTRY), registry: REGISTRY, context: coordinatorContext(), system: AGENT_SYSTEM_PROMPT, emit: (event) => events.push(event) },
      plan: { kind: "dag", rule: "b21-e1-fixture", roles: ["coordinator", "requirements-analyst", "verification-critic"] },
      startedAt: Date.now(),
      providers,
    });
    expect(result.status).toBe("completed");
    expect(opened).toBe(true);
    expect(coordinator.create).toHaveBeenCalledTimes(1); // the first turn only: no follow-up turn
    expect(specialists.create).toHaveBeenCalledTimes(2);
    expect(anthropic.create).not.toHaveBeenCalled(); // never switched
    const warnings = events.flatMap((event) => ((event.type === "warning" || event.type === "plan" || event.type === "specialist_finished" || event.type === "degraded") ? [event.message] : [])); // [B21 E2] pin move (OD-126): B's plan, status and stand-down lines are now the plan / specialist_finished / degraded events carrying the same sentence
    expect(warnings.at(-1)).toMatch(/^Orchestration: no follow-up turn was made and the assistant's answer above stands \(the coordinator never switches provider mid-run\) - its LLM provider "openai" is paused \(insufficient_quota\) until .* or until an operator resets it; no call is made to it before then \(OD-115\)\.$/);
    const terminal = events.at(-1)!;
    expect(terminal).toMatchObject({ type: "run_completed", finalText: "(fake) the coordinator's first answer." });
    expect(events.filter((event) => event.type === "run_completed" || event.type === "run_failed")).toHaveLength(1);
    expect(SPECIALIST_CAPS.attemptsPerTask).toBe(2); // the per-DAG attempt ceiling stays B's: 2 per task, at most 4 tasks
  });

  it("8. [B21 E1 fix: security-2, tests-hang] an ABANDONED half-open trial learnt nothing and is not counted: a trial whose run's signal aborts first (the client left, its deadline passed) leaves the breaker half-open - never re-armed, least of all for a no-credits hour - so the next call is the new trial; through the DAG, a trial that HANGS until its task's own deadline is settled by the wrapper's abort listener and the next task's call is the new trial, answers and closes the breaker", async () => {
    let clock = T0;
    await failOnce("openai", "insufficient_quota", T0);
    clock = T0 + LLM_PROVIDER_ADMISSION.quotaOpenMs + 1;
    const walkedAway = new AbortController();
    const held = heldAdapter("openai");
    void admittedAdapter(held.adapter, { provider: "openai" }, PROCESS_LLM_PROVIDER_ADMISSION, () => clock).adapter.start({ ...START_INPUT, signal: walkedAway.signal });
    expect(held.pending()).toBe(1); // admitted: the one half-open trial
    walkedAway.abort(); // its client walks away before any answer
    expect(currentLlmProviderPause(OPENAI, clock + 1, "agent")).toBeNull(); // half-open again, NOT paused for another hour
    const next = heldAdapter("openai");
    void admittedAdapter(next.adapter, { provider: "openai" }, PROCESS_LLM_PROVIDER_ADMISSION, () => clock + 2).adapter.start(START_INPUT);
    expect(next.pending()).toBe(1); // the next call is the new trial
    resetAdmissionControl();
    // through the DAG: a rate limit's window passes; the first task's call is the trial and HANGS until its task's own deadline
    await failOnce("openai", "rate_limit", T0);
    expect(currentLlmProviderPause(OPENAI, T0 + 1, "agent")).toMatchObject({ reason: "breaker_open", retryAtMs: T0 + LLM_PROVIDER_ADMISSION.rateLimitOpenMs });
    const after = T0 + LLM_PROVIDER_ADMISSION.rateLimitOpenMs + 1;
    const openai = fakeOpenAI((params) => (roleOf(params) === "requirements-analyst" ? HANG : openAIResultResponse(roleOf(params))));
    const run = await runE1Dag(["requirements-analyst", "verification-critic"], fakeProviders(openai, fakeAnthropic(answersAnthropic)).providers, { now: () => after, budget: { ...DEFAULT_AGENT_BUDGET, runDeadlineMs: 200 } });
    expect(run.ran!.tasks.map((task) => [task.role, task.status, task.reason])).toEqual([["requirements-analyst", "escalated", "deadline"], ["verification-critic", "accepted", null]]);
    expect(run.ran!.stop).toBe("completed");
    expect((openai.options[0]!.signal as AbortSignal).aborted).toBe(true);
    expect(openai.calls.map(roleOf)).toEqual(["requirements-analyst", "verification-critic"]);
    expect(currentLlmProviderPause(OPENAI, after + 1, "agent")).toBeNull(); // the new trial answered: closed
  }, 20_000);

  it("9. [B21 E1 fix: regressions-4, security-4] an outcome counts only under the breaker generation its call was admitted in: a success from a call admitted BEFORE a no-credits opening never closes it; while the half-open trial is in flight a stale outcome neither closes the breaker nor frees the trial's slot (a second call waits for the trial); only the trial's own success closes it", async () => {
    let clock = T0;
    const now = (): number => clock;
    const route = { provider: "openai" as const, model: "gpt-5.6-sol" };
    const early = heldAdapter("openai");
    const first = admittedAdapter(early.adapter, route, PROCESS_LLM_PROVIDER_ADMISSION, now).adapter.start(START_INPUT);
    const second = admittedAdapter(early.adapter, route, PROCESS_LLM_PROVIDER_ADMISSION, now).adapter.start(START_INPUT);
    expect(early.pending()).toBe(2); // both admitted under the closed breaker, both in flight
    await failOnce("openai", "insufficient_quota", T0); // another request's call: no credits - the breaker opens for the long window
    const opened = { reason: "breaker_open", retryAtMs: T0 + LLM_PROVIDER_ADMISSION.quotaOpenMs };
    expect(currentLlmProviderPause(OPENAI, T0 + 1, "agent")).toMatchObject(opened);
    early.release();
    await first; // a call admitted BEFORE the opening answers late: it says nothing about the provider since
    expect(currentLlmProviderPause(OPENAI, T0 + 2, "agent")).toMatchObject(opened);
    // the window passes: ONE trial goes and stays in flight; the other early call answers now - stale, it frees nothing
    clock = T0 + LLM_PROVIDER_ADMISSION.quotaOpenMs + 1;
    const trialHeld = heldAdapter("openai");
    const trial = admittedAdapter(trialHeld.adapter, route, PROCESS_LLM_PROVIDER_ADMISSION, now).adapter.start(START_INPUT);
    expect(trialHeld.pending()).toBe(1);
    early.release();
    await second;
    const waiting = admittedAdapter(heldAdapter("openai").adapter, route, PROCESS_LLM_PROVIDER_ADMISSION, now);
    await expect(waiting.adapter.start(START_INPUT)).rejects.toThrow("LLM_PROVIDER_PAUSED");
    expect(waiting.capture.paused).toMatchObject({ reason: "breaker_open" });
    trialHeld.release();
    await trial; // the trial's own success closes it
    expect(currentLlmProviderPause(OPENAI, clock + 1, "agent")).toBeNull();
  });

  it("10. [B21 E1 fix: regressions-3, security-3, tests-admitted-adapter] a call the meters refuse MID-RUN is never sent and escalates its task `provider_unavailable`: a WINDOW pause (the agent's 60-a-minute share, process-wide, used up by other requests) is no outage - the DAG goes on; a breaker another request opened mid-run pauses the coordinator's provider - the DAG stops `provider_paused` (no call of this run failed), never `provider_outage`", async () => {
    const turns = new Map<string, number>();
    const drc = agentProviderName("sirkit.validation.drc-run");
    const answer = (params: Params): unknown => {
      const role = roleOf(params);
      const turn = turns.get(role) ?? 0;
      turns.set(role, turn + 1);
      return turn === 0 ? { ...openAIResultResponse(role), output: [{ type: "function_call", call_id: `call-read-${role}`, name: drc, arguments: "{}" }] } : openAIResultResponse(role);
    };
    // (a) other requests used 59 of the agent's 60 openai calls this minute: the critic's FIRST call is the 60th, its second is refused
    const share = Math.floor(LLM_PROVIDER_ADMISSION.requestsPerMinute * PURPOSE_QUOTA_SHARE.agent);
    for (let index = 0; index < share - 1; index += 1) expect(requestLlmProviderAdmission(OPENAI, T0, "agent"), `${index}`).toMatchObject({ allowed: true });
    const openai = fakeOpenAI(answer);
    const env = { [ROLE_MODELS_ENV]: JSON.stringify({ "requirements-analyst": { provider: "anthropic", model: "inherit" } }) };
    const windowed = await runE1Dag(["verification-critic", "requirements-analyst"], fakeProviders(openai, fakeAnthropic(answersAnthropic), { env }).providers, { now: () => T0 });
    expect(openai.calls.map(roleOf)).toEqual(["verification-critic"]); // the refused second call was never sent
    expect(windowed.ran!.tasks.map((task) => [task.role, task.status, task.provider])).toEqual([["verification-critic", "escalated", "openai"], ["requirements-analyst", "accepted", "anthropic"]]);
    expect(windowed.ran!.tasks[0]!.reason).toMatch(/^provider_unavailable: LLM provider "openai" is paused for the agent: its share of 60 requests per minute \(OD-40\) is used up until /);
    expect(windowed.ran!.stop).toBe("completed");
    // (b) another request's no-credits failure lands while the critic's first call is being answered: its second call is refused, never sent
    resetAdmissionControl();
    turns.clear();
    const opening = fakeOpenAI((params, index) => (index === 0 ? failOnce("openai", "insufficient_quota", T0).then(() => answer(params)) : answer(params)));
    const paused = await runE1Dag(["verification-critic", "requirements-analyst"], fakeProviders(opening, fakeAnthropic(answersAnthropic)).providers, { now: () => T0, runId: "run-b21e1-opened-mid-run" });
    expect(opening.calls.map(roleOf)).toEqual(["verification-critic"]);
    expect(paused.ran!.tasks.map((task) => [task.role, task.status])).toEqual([["verification-critic", "escalated"]]);
    expect(paused.ran!.tasks[0]!.reason).toMatch(/^provider_unavailable: LLM provider "openai" is paused \(insufficient_quota\)/);
    expect(paused.ran!.stop).toBe("provider_paused");
    expect(paused.ran!.notStarted.map((task) => task.role)).toEqual(["requirements-analyst"]);
  });

  it("11. [B21 E1 fix: tests-transient] transient failures reach the breaker through the REAL adapter's classification (`llmProviderOutcomeOf`): an overload (529), a timeout (408) and a connection failure count one each - the third opens the breaker for its minute and is not retried, and the NEXT DAG makes no specialist call at all", async () => {
    const failures = [Object.assign(new Error("Overloaded"), { status: 529 }), Object.assign(new Error("Request timed out."), { status: 408 }), Object.assign(new Error("Connection error."), { name: "APIConnectionError" })];
    const openai = fakeOpenAI((params, index) => failures[index] ?? openAIResultResponse(roleOf(params)));
    const { providers } = fakeProviders(openai, fakeAnthropic(answersAnthropic));
    const first = await runE1Dag(["requirements-analyst"], providers, { now: () => T0 });
    expect(first.ran!.tasks.map((task) => [task.attempt, task.reason?.split(":")[0]])).toEqual([[0, "provider_overloaded"], [1, "provider_timeout"]]);
    expect(currentLlmProviderPause(OPENAI, T0 + 1, "agent")).toBeNull(); // two consecutive failures: below the threshold
    const second = await runE1Dag(["requirements-analyst"], providers, { now: () => T0, runId: "run-b21e1-third-failure" });
    expect(second.ran!.tasks.map((task) => [task.attempt, task.reason])).toEqual([[0, expect.stringMatching(/^provider_network: the specialist run failed before a result \(not retried: LLM provider "openai" is paused \(failures\) until 2026-09-27T12:01:00\.000Z/)]]);
    const third = await runE1Dag(["requirements-analyst"], providers, { now: () => T0, runId: "run-b21e1-after-three" });
    expect(third.ran!.stop).toBe("provider_paused");
    expect(third.ran!.tasks).toEqual([]);
    expect(openai.create).toHaveBeenCalledTimes(3);
  });

  it("12. [B21 E1 fix: tests-other-provider] another provider's outage stops only its task: the critic, routed to anthropic by the server env, finds anthropic out of credits - escalated, never retried, anthropic's breaker open; the DAG goes on and the coordinator's provider runs the next task; openai's breaker stays closed", async () => {
    const openai = fakeOpenAI(answersOpenAI);
    const anthropic = fakeAnthropic(() => anthropicQuotaError());
    const env = { [ROLE_MODELS_ENV]: JSON.stringify({ "verification-critic": { provider: "anthropic", model: "inherit" } }) };
    const run = await runE1Dag(["verification-critic", "requirements-analyst"], fakeProviders(openai, anthropic, { env }).providers, { now: () => T0 });
    expect(run.ran!.stop).toBe("completed");
    expect(run.ran!.tasks.map((task) => [task.role, task.status, task.provider])).toEqual([["verification-critic", "escalated", "anthropic"], ["requirements-analyst", "accepted", "openai"]]);
    expect(run.ran!.tasks[0]!.reason).toMatch(/^provider_insufficient_quota: /);
    expect(anthropic.create).toHaveBeenCalledTimes(1);
    expect(currentLlmProviderPause({ kind: "llm-provider", provider: "anthropic" }, T0 + 1, "agent")).toMatchObject({ reason: "breaker_open" });
    expect(currentLlmProviderPause(OPENAI, T0 + 1, "agent")).toBeNull();
  });

  it("13. [B21 E1 fix: coverage-followup-not-metered] the follow-up coordinator turn is METERED, not only gated: its no-credits 429 opens the breaker at once (the first answer stands under its line), so the NEXT request's specialists make no call", async () => {
    const store = new DurableOrchestrationRunStore(new InMemoryDurableWorkflowRepository());
    setOrchestrationStoreFactory(() => store);
    const coordinator = fakeOpenAI((_params, index) => (index === 0 ? openAITextResponse("(fake) the coordinator's first answer.") : openAIQuotaError()));
    const specialists = fakeOpenAI(answersOpenAI);
    const { providers } = fakeProviders(specialists, fakeAnthropic(answersAnthropic));
    const events: AgentRunEvent[] = [];
    const result = await runOrchestratedChat({
      request: { runId: "run-b21e1-follow-up-metered", provider: "openai", history: [], userMessage: "Check the board against the requirements.", budget: DEFAULT_AGENT_BUDGET },
      deps: { adapter: new OpenAIAgentAdapter(coordinator.client as never, "gpt-fake", undefined), gateway: createAgentToolGateway(REGISTRY), registry: REGISTRY, context: coordinatorContext(), system: AGENT_SYSTEM_PROMPT, emit: (event) => events.push(event) },
      plan: { kind: "dag", rule: "b21-e1-fixture", roles: ["coordinator", "requirements-analyst"] },
      startedAt: Date.now(),
      providers,
    });
    expect(result.status).toBe("completed");
    expect(coordinator.create).toHaveBeenCalledTimes(2); // the first turn and the follow-up's one call
    expect(specialists.create).toHaveBeenCalledTimes(1);
    const warnings = events.flatMap((event) => ((event.type === "warning" || event.type === "plan" || event.type === "specialist_finished" || event.type === "degraded") ? [event.message] : [])); // [B21 E2] pin move (OD-126): B's plan, status and stand-down lines are now the plan / specialist_finished / degraded events carrying the same sentence
    expect(warnings.at(-1)).toBe("Orchestration: the follow-up coordinator turn did not complete (provider_insufficient_quota); the assistant's answer above stands.");
    expect(currentLlmProviderPause(OPENAI, Date.now(), "agent")).toMatchObject({ reason: "breaker_open" });
    const next = await runE1Dag(["requirements-analyst"], providers, { runId: "run-b21e1-after-follow-up" });
    expect(next.ran!.tasks).toEqual([]);
    expect(specialists.create).toHaveBeenCalledTimes(1);
  });
  it("14. [B21 E1 lead] a no-credits answer is a fact about the ACCOUNT, so it holds even from a call admitted under an earlier opening: a rate-limit opening (one minute) followed by an insufficient_quota from a call admitted before it opens the breaker for the LONG window - never a rate-limit minute for a provider that is out of credits; a stale no-credits answer never shortens a longer opening; and one from a call admitted BEFORE an operator reset never undoes the reset", () => {
    const admitted = (now: number): LlmProviderTicket => {
      const admission = requestLlmProviderAdmission(OPENAI, now, "agent");
      if (!admission.allowed) throw new Error(admission.message);
      return admission.ticket;
    };
    const a = admitted(T0);
    const b = admitted(T0);
    recordLlmProviderOutcome(OPENAI, a, "rate_limited", T0 + 1);
    expect(currentLlmProviderPause(OPENAI, T0 + 2, "agent")).toMatchObject({ reason: "breaker_open", retryAtMs: T0 + 1 + LLM_PROVIDER_ADMISSION.rateLimitOpenMs });
    recordLlmProviderOutcome(OPENAI, b, "insufficient_quota", T0 + 3);
    const quota = currentLlmProviderPause(OPENAI, T0 + 4, "agent");
    expect(quota).toMatchObject({ reason: "breaker_open", retryAtMs: T0 + 3 + LLM_PROVIDER_ADMISSION.quotaOpenMs });
    expect(quota!.message).toMatch(/\(insufficient_quota\)/);
    expect(requestLlmProviderAdmission(OPENAI, T0 + 2 * MINUTE, "agent"), "no trial after the rate-limit minute").toMatchObject({ allowed: false, reason: "breaker_open" });
    // a later stale no-credits answer never SHORTENS the opening it would repeat
    const c = { generation: b.generation, trial: false };
    recordLlmProviderOutcome(OPENAI, c, "insufficient_quota", T0 + 3 - 1000);
    expect(currentLlmProviderPause(OPENAI, T0 + 4, "agent")).toMatchObject({ retryAtMs: T0 + 3 + LLM_PROVIDER_ADMISSION.quotaOpenMs });
    // an operator reset stands against an answer from a call admitted BEFORE it
    resetAdmissionControl();
    const d = admitted(T0);
    resetLlmProviderBreaker("openai");
    recordLlmProviderOutcome(OPENAI, d, "insufficient_quota", T0 + 5);
    expect(currentLlmProviderPause(OPENAI, T0 + 6, "agent")).toBeNull();
  });
});
