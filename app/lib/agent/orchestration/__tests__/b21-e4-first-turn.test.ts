/**
 * [B21 E4] The coordinator's first turn behind the llm-provider breaker (D21-39). The route consults the SAME pause E1's runtime consults
 * before the follow-up turn - `currentLlmProviderPause` through the process's meters (`PROCESS_LLM_PROVIDER_ADMISSION`), the
 * `interactive` purpose (the whole PROCESS-WIDE window), the coordinator's provider - before the coordinator's first turn, on the flag-on and the flag-off paths
 * (`pausedFirstTurn`, orchestration-runtime.ts). Paused: NO call - `run_started`, then ONE `run_failed` whose reason is
 * `provider_breaker_open` (the card shows its Switch and never its Retry, E1's `providerRetryOffered` rule) and whose message is the
 * meters' own pause sentence; the trace records that line, and the route records the failed terminal. Not paused: nothing is emitted
 * or recorded and the route runs exactly as before. A RESUMED request is never gated here: its first turn is replayed from the record
 * and makes no call - the calls it does make (the specialists, the follow-up turn) consult the breaker themselves (E1). The first turn
 * is gated, not metered: its own outcome neither opens the breaker nor settles a half-open trial (RECORDED).
 * [B21 E4 fix] The review's findings: a half-open breaker whose one trial is in flight never gates the first turn (it takes no trial -
 * case 6, regressions-1); what a gate that is not metered cannot do is pinned as RECORDED (case 7: it only reads the meters, so the
 * first turn opens and re-arms nothing - coverage-1, coverage-2 - and the window it reads is process-wide - security-1).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { currentLlmProviderPause, resetAdmissionControl } from "@/app/lib/acquisition/admission-control";
import { PROCESS_LLM_PROVIDER_ADMISSION, admittedAdapter, type LlmProviderAdmissionPort } from "@/app/lib/agent/orchestration/provider-policy";
import { LLMProviderError } from "@/app/lib/llm/errors";
import type { ProviderAgentAdapter } from "@/app/lib/agent/contracts";
import { isRecoverableProviderFailure, providerRetryOffered } from "@/app/lib/agent/run-consumer";
import { PROVIDER_FAILURES_WITHOUT_RETRY } from "@/app/lib/ai-preferences";
import { AgentTraceRecorder, InMemoryTraceSink } from "@/app/lib/agent/trace-recorder";
import { validateAgentRunTrace } from "@/app/lib/agent/trace";
import { sanitizeTraceText } from "@/app/lib/agent/redaction";
import type { AgentRunEvent } from "@/app/lib/agent/contracts";
import { FIRST_TURN_PAUSED_REASON, firstTurnPausedLine, pausedFirstTurn, type ChatResume } from "@/app/api/chat/orchestration-runtime";
import { START_INPUT, failOnce, heldAdapter } from "./_e1-fixtures";

const NOW = Date.parse("2026-09-28T10:00:00.000Z");
const FRESH: ChatResume = { kind: "fresh" };
const RESUMED: ChatResume = { kind: "resume", runId: "run-00000000-0000-4000-8000-000000000001", grant: { runId: "run-00000000-0000-4000-8000-000000000001", answer: "(recorded) the first answer.", answerWithheld: null, artifacts: [], userMessageDigest: "d", ordinal: 1 } };
function gate(input: { provider?: "openai" | "anthropic"; resume?: ChatResume; at?: number; trace?: AgentTraceRecorder } = {}): { events: AgentRunEvent[]; result: ReturnType<typeof pausedFirstTurn> } {
  const events: AgentRunEvent[] = [];
  const result = pausedFirstTurn({ runId: "run-e4", provider: input.provider ?? "openai", resume: input.resume ?? FRESH, emit: (event) => events.push(event), ...(input.trace ? { trace: input.trace } : {}), now: () => input.at ?? NOW });
  return { events, result };
}
const pauseOf = (provider: "openai" | "anthropic", at: number) => currentLlmProviderPause({ kind: "llm-provider", provider }, at, "interactive");
function recorder(sink = new InMemoryTraceSink()): AgentTraceRecorder {
  return new AgentTraceRecorder({ runId: "run-e4", traceId: "trace-e4", provider: "openai", promptVersion: "1.4.0", promptDigest: "eng1-0000000000000000", registryDigest: "eng1-0000000000000001", scope: { tenantId: "tenant-1", projectId: "project-1", branchId: "main" }, contextDigests: { canonicalRevisionDigest: null, schematicDigest: null, selectionDigest: null, netlistDigest: null, resourceManifestDigest: null } }, sink, () => NOW);
}

/** [B21 E4 fix: regressions-1] ANOTHER request's metered call admitted at `at` - the half-open breaker's one trial - held in flight until
 *  the test settles it with a success or a no-credits answer (through `admittedAdapter`, the production meter wrapper) */
function trialInFlight(at: number): { settle(outcome: "success" | "insufficient_quota"): Promise<void> } {
  const held = heldAdapter("openai");
  let fail: ((error: unknown) => void) | null = null;
  const adapter: ProviderAgentAdapter = { provider: "openai", start: (input) => new Promise((resolve, reject) => { fail = reject; void held.adapter.start(input).then(resolve); }), continueWith: held.adapter.continueWith };
  const call = admittedAdapter(adapter, { provider: "openai" }, PROCESS_LLM_PROVIDER_ADMISSION, () => at).adapter.start(START_INPUT).catch(() => undefined);
  expect(held.pending()).toBe(1);
  return { settle: async (outcome) => { if (outcome === "success") held.release(); else fail!(new LLMProviderError("openai", "insufficient_quota")); await call; } };
}

beforeEach(() => resetAdmissionControl());
afterEach(() => resetAdmissionControl());

describe("[B21 E4] the coordinator's first turn behind the llm-provider breaker (D21-39)", () => {
  it("1. not paused: the gate answers null and emits and records NOTHING, for either provider - the route then runs exactly as before (the flag-off stream byte-identical to HEAD's, the route suite's case 1)", () => {
    const trace = recorder();
    for (const provider of ["openai", "anthropic"] as const) {
      const { events, result } = gate({ provider, trace });
      expect(result, provider).toBeNull();
      expect(events, provider).toEqual([]);
    }
    trace.recordRunStarted();
    trace.recordTerminal("completed", null);
    expect(trace.finalize({ outcome: "completed", failureReason: null }).warnings).toEqual([]);
  });

  it("2. a provider out of credits (a 429 `insufficient_quota` opened its breaker for the long window): NO call - run_started, then ONE run_failed `provider_breaker_open` carrying the meters' own pause sentence; the result is a zero-step failure; the card shows the Switch and withholds Retry; the trace records the line and validates with the failed terminal", async () => {
    await failOnce("openai", "insufficient_quota", NOW);
    const pause = pauseOf("openai", NOW + 1);
    expect(pause).toMatchObject({ reason: "breaker_open" });
    expect(pause!.message).toMatch(/^LLM provider "openai" is paused \(insufficient_quota\) until .+ or until an operator resets it; no call is made to it before then \(OD-115\)\.$/);
    const sink = new InMemoryTraceSink();
    const trace = recorder(sink);
    trace.recordRunStarted();
    const { events, result } = gate({ at: NOW + 1, trace });
    const line = firstTurnPausedLine(pause!);
    expect(line).toBe(`No model call was made for this message: ${pause!.message}`);
    expect(events).toEqual([{ type: "run_started", runId: "run-e4", provider: "openai" }, { type: "run_failed", runId: "run-e4", reason: "provider_breaker_open", message: line }]);
    expect(result).toEqual({ runId: "run-e4", status: "failed", finalText: "", steps: 0, toolCalls: 0, failureReason: "provider_breaker_open" });
    expect(FIRST_TURN_PAUSED_REASON).toBe("provider_breaker_open");
    expect(PROVIDER_FAILURES_WITHOUT_RETRY).toContain(FIRST_TURN_PAUSED_REASON);
    expect(isRecoverableProviderFailure(FIRST_TURN_PAUSED_REASON)).toBe(true); // the card is shown: its "Use <other> instead"
    expect(providerRetryOffered(FIRST_TURN_PAUSED_REASON)).toBe(false); // ...and never its Retry
    trace.recordTerminal("failed", result!.failureReason!);
    const finalized = trace.finalize({ outcome: "failed", failureReason: result!.failureReason! });
    expect(validateAgentRunTrace(finalized)).toEqual([]);
    expect(finalized.warnings).toEqual([sanitizeTraceText(line)]);
    expect(finalized.events.map((event) => event.kind)).toEqual(["run_started", "terminal"]);
    expect(finalized.terminal).toMatchObject({ outcome: "failed", failureReason: "provider_breaker_open" });
  });

  it("3. a rate limit opens the breaker for its short window: the first turn is gated until then; once the window has passed the breaker is half-open and the first turn GOES (null) - it is gated, not metered, so it neither takes nor settles the one trial (the pause still reads half-open after it)", async () => {
    await failOnce("openai", "rate_limit", NOW);
    expect(gate({ at: NOW + 1 }).result).toMatchObject({ failureReason: "provider_breaker_open" });
    expect(gate({ at: NOW + 1 }).events.at(-1)).toMatchObject({ message: firstTurnPausedLine(pauseOf("openai", NOW + 1)!) });
    expect(pauseOf("openai", NOW + 1)!.message).toMatch(/is paused \(rate_limit\) until /);
    const later = NOW + 60_001;
    expect(gate({ at: later }).result).toBeNull();
    expect(gate({ at: later }).events).toEqual([]);
    expect(pauseOf("openai", later)).toBeNull();
    expect(PROCESS_LLM_PROVIDER_ADMISSION.request("openai", undefined, "interactive", later)).toMatchObject({ allowed: true, ticket: { trial: true } });
  });

  it("4. a WINDOW pause (the person's whole share of the provider's minute used up) gates the first turn with the window's own sentence and the same no-Retry reason; the AGENT's share used up does not (a person's request is `interactive`, as the follow-up turn's is)", () => {
    // [B21 E4 fix: security-1] the title's "the person's whole share" is the `interactive` purpose's ceiling: the whole PROCESS-WIDE window,
    // which every principal's metered calls fill (case 7) - kept as titled (the stale-title convention)
    for (let index = 0; index < 60; index += 1) expect(PROCESS_LLM_PROVIDER_ADMISSION.request("openai", undefined, "agent", NOW).allowed).toBe(true);
    expect(currentLlmProviderPause({ kind: "llm-provider", provider: "openai" }, NOW, "agent")).toMatchObject({ reason: "quota_exhausted" });
    expect(gate().result).toBeNull();
    for (let index = 60; index < 240; index += 1) expect(PROCESS_LLM_PROVIDER_ADMISSION.request("openai", undefined, "interactive", NOW).allowed).toBe(true);
    const pause = pauseOf("openai", NOW);
    expect(pause).toMatchObject({ reason: "quota_exhausted" });
    expect(pause!.message).toMatch(/^LLM provider "openai" is paused: its quota of 240 requests per minute is used up until /);
    const { events, result } = gate();
    expect(result).toMatchObject({ status: "failed", failureReason: "provider_breaker_open", steps: 0 });
    expect(events.at(-1)).toEqual({ type: "run_failed", runId: "run-e4", reason: "provider_breaker_open", message: `No model call was made for this message: ${pause!.message}` });
  });

  it("5. a RESUMED request is never gated (its first turn is replayed from the record, no call): null and nothing emitted even while its provider is paused - its specialists and its follow-up turn consult the breaker themselves (the route suite's case 5); and one provider's breaker never gates the other's request", async () => {
    await failOnce("openai", "insufficient_quota", NOW);
    expect(gate({ at: NOW + 1 }).result).not.toBeNull();
    expect(gate({ at: NOW + 1, resume: RESUMED })).toEqual({ events: [], result: null });
    expect(gate({ at: NOW + 1, provider: "anthropic" })).toEqual({ events: [], result: null });
    await failOnce("anthropic", "insufficient_quota", NOW);
    expect(gate({ at: NOW + 1, provider: "anthropic" }).events.at(-1)).toMatchObject({ type: "run_failed", reason: "provider_breaker_open", message: expect.stringContaining('LLM provider "anthropic" is paused (insufficient_quota)') });
  });

  it("6. [B21 E4 fix: regressions-1] a half-open breaker whose ONE trial call is IN FLIGHT (another request's metered call admitted as the trial) does not gate the first turn: the first turn is not metered - it neither takes nor settles the trial - so it goes (null, nothing emitted) exactly as before the trial was taken (case 3), never refused 'until' an instant already reached; the trial's own answer then decides - a success closes the breaker, no credits re-opens the long window and the first turn is gated again, naming an instant still to come", async () => {
    await failOnce("openai", "rate_limit", NOW);
    const later = NOW + 60_001;
    const success = trialInFlight(later);
    // the meters' own pause while the trial is out: a breaker pause "until" the very instant it is asked at - what the metered calls meet
    expect(pauseOf("openai", later + 1)).toMatchObject({ reason: "breaker_open", retryAtMs: later + 1 });
    expect(currentLlmProviderPause({ kind: "llm-provider", provider: "openai" }, later + 1, "agent")).toMatchObject({ reason: "breaker_open", retryAtMs: later + 1 });
    expect(gate({ at: later + 1 })).toEqual({ events: [], result: null });
    expect(gate({ at: later + 30_000 })).toEqual({ events: [], result: null });
    await success.settle("success");
    expect(pauseOf("openai", later + 2)).toBeNull();
    // another opening whose trial answers no credits: the long window, and the first turn gated again with its end still to come
    await failOnce("openai", "rate_limit", later + 3);
    const trialAt = later + 60_004;
    const noCredits = trialInFlight(trialAt);
    expect(gate({ at: trialAt + 1 })).toEqual({ events: [], result: null });
    await noCredits.settle("insufficient_quota");
    const { events, result } = gate({ at: trialAt + 2 });
    expect(result).toMatchObject({ status: "failed", failureReason: "provider_breaker_open", steps: 0 });
    const pause = pauseOf("openai", trialAt + 2)!;
    expect(pause).toMatchObject({ reason: "breaker_open", retryAtMs: trialAt + 3_600_000 });
    expect(pause.retryAtMs).toBeGreaterThan(trialAt + 2);
    expect(events.at(-1)).toEqual({ type: "run_failed", runId: "run-e4", reason: "provider_breaker_open", message: firstTurnPausedLine(pause) });
    expect(firstTurnPausedLine(pause)).toContain(`until ${new Date(trialAt + 3_600_000).toISOString()} or until an operator resets it`);
  });

  it("7. [B21 E4 fix: coverage-1, coverage-2, security-1] RECORDED limits of a gate that is not metered, pinned: (a) the gate only ever READS the meters - it never admits or records a call, whatever the first turn then answers - so the first turn opens, re-opens and settles nothing (on a flag-off process, which meters no call, nothing ever pauses a provider: the route suite's case 7); (b) once opened for no credits the breaker holds ONE window: after it every first turn goes and the half-open trial waits for a metered call (a specialist or a follow-up turn); (c) the window the gate reads is PROCESS-WIDE - no principal or tenant in the meters - so metered calls made for other people fill it and gate everyone's first turn on that provider", async () => {
    const asked: string[] = [];
    const port: LlmProviderAdmissionPort = {
      pause: (provider, model, purpose, now) => { asked.push(`pause:${purpose}`); return PROCESS_LLM_PROVIDER_ADMISSION.pause(provider, model, purpose, now); },
      request: (provider, model, purpose, now) => { asked.push("request"); return PROCESS_LLM_PROVIDER_ADMISSION.request(provider, model, purpose, now); },
      record: (provider, model, ticket, outcome, now) => { asked.push("record"); PROCESS_LLM_PROVIDER_ADMISSION.record(provider, model, ticket, outcome, now); },
    };
    const run = (at: number) => pausedFirstTurn({ runId: "run-e4", provider: "openai", resume: FRESH, emit: () => undefined, admission: port, now: () => at });
    expect(run(NOW)).toBeNull();
    await failOnce("openai", "insufficient_quota", NOW);
    expect(run(NOW + 1)).toMatchObject({ failureReason: "provider_breaker_open" });
    expect(asked).toEqual(["pause:interactive", "pause:interactive"]); // (a) read only: never an admission, never an outcome
    // (b) one window: past it the breaker is half-open, first turns go, and nothing a first turn answers re-opens it
    const after = NOW + 3_600_001;
    expect(gate({ at: after })).toEqual({ events: [], result: null });
    expect(gate({ at: after + 600_000 })).toEqual({ events: [], result: null });
    expect(PROCESS_LLM_PROVIDER_ADMISSION.request("openai", undefined, "agent", after + 600_000)).toMatchObject({ allowed: true, ticket: { trial: true } }); // the trial was still untaken
    // (c) process-wide: 60 agent calls and 180 follow-up turns' calls of OTHER people's runs fill the one window every first turn reads
    resetAdmissionControl();
    for (let index = 0; index < 60; index += 1) expect(PROCESS_LLM_PROVIDER_ADMISSION.request("openai", undefined, "agent", NOW).allowed).toBe(true);
    for (let index = 0; index < 180; index += 1) expect(PROCESS_LLM_PROVIDER_ADMISSION.request("openai", undefined, "interactive", NOW).allowed).toBe(true);
    expect(gate().result).toMatchObject({ failureReason: "provider_breaker_open" });
    expect(gate().events.at(-1)).toMatchObject({ message: expect.stringContaining('LLM provider "openai" is paused: its quota of 240 requests per minute is used up until ') });
    expect(gate({ at: NOW + 60_000 }).result).toBeNull(); // the next minute's window is empty
    expect(gate({ provider: "anthropic" }).result).toBeNull();
  });
});
