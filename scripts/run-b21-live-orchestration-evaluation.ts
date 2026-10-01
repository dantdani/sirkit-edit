/**
 * [B21 F] The MODEL-IN-LOOP track of B21-F, RECORD-ONLY (OD-125, D21-25): the `orchestration` category's task-graph cases run through
 * the SAME runtime and the same task-graph runner as their offline replays (`_f-capsules.ts`), with the adapters swapped (and the production run budget always; an offline scripted stall replays under 2 s):
 * the production adapter classes (real SDK clients, the credentials the owner supplies in the shell). It is NOT a test and no suite
 * runs it (OD-102: no permanently skipped block is committed); it asserts nothing about a model's answer - it RECORDS what happened in
 * the closed vocabulary (per case: the events' types and degraded reasons, each specialist's status and provider/model, the record's
 * decisions, the offline checks' verdicts as information) and prints one JSON document on stdout. It never prints a credential, an
 * env value, a prompt or a model's text.
 *
 *   SIRKIT_LIVE_ORCHESTRATION_EVALUATION=1 [SIRKIT_LIVE_ORCHESTRATION_PROVIDER=anthropic] <tsx> scripts/run-b21-live-orchestration-evaluation.ts
 *
 * The provider is the capsules' (openai) unless SIRKIT_LIVE_ORCHESTRATION_PROVIDER names the other one (OpenAI answered 429 no-credits
 * for the configured keys on 2026-09-24); the configured models are the defaults the replay pins (gpt-5.6-sol, claude-opus-4-7).
 *
 * [B21 F fix: coverage-1] What it can evaluate: the four task-graph capsules (liveEvaluationCases), every turn answered by a live model
 * on ONE provider - so it never reproduces a capsule's SCRIPTED fault (the stall, the 429, the hostile results: those cases run as
 * their DAG shapes only) and it can produce no provider disagreement and no provider fallback; the other runbook cases have no live
 * path. LB-9's disagreement and fallback stay BLOCKED-LIVE-QUALIFICATION whatever this command records.
 *
 * Refused (exit 2, no adapter built, no call made) unless SIRKIT_LIVE_ORCHESTRATION_EVALUATION is exactly "1". The spend bound: at
 * most LIVE_CALL_BOUND provider REQUESTS in the whole run - [B21 F fix: security-1] every live adapter, the coordinator's too, is built
 * with SDK retries 0, so a counted call is one request (the SDK re-sends nothing: no retry of a 429, a 5xx or a timeout), and the call
 * past the bound is refused before it is sent - each at most the adapters' MAX_OUTPUT_TOKENS output tokens: LIVE_CALL_BOUND x
 * MAX_OUTPUT_TOKENS output tokens at most. The implementer never runs it; the lead may run it once, sparingly (owner authorization of
 * 2026-09-24), and records the outcome on evaluation-matrix.md.
 */
import { AnthropicAgentAdapter, MAX_OUTPUT_TOKENS, OpenAIAgentAdapter, agentAdapterFor, agentAdapterForRole } from "../app/lib/agent/adapters";
import { LLMProviderError } from "../app/lib/llm/errors";
import type { ProviderAgentAdapter } from "../app/lib/agent/contracts";
import { buildOrchestrationEvaluationCases, runOrchestrationCase, scoreOrchestrationCase, type LiveOrchestrationAdapters, type OrchestrationEvaluationCase } from "../app/lib/agent/orchestration/__tests__/_f-capsules";

export const LIVE_FLAG = "SIRKIT_LIVE_ORCHESTRATION_EVALUATION";
export const LIVE_PROVIDER_FLAG = "SIRKIT_LIVE_ORCHESTRATION_PROVIDER";
/** Every provider request of the whole run, at most (the spend bound). */
export const LIVE_CALL_BOUND = 40;
export const LIVE_OUTPUT_TOKEN_BOUND = LIVE_CALL_BOUND * MAX_OUTPUT_TOKENS;
/** The SDK retries of every live adapter: none - one counted call is one provider request. */
export const LIVE_SDK_MAX_RETRIES = 0;

/** [B21 F fix: security-1] The live adapters: the coordinator's is agentAdapterFor's (the scripted agent under the fixture opt-in, as
 *  there) rebuilt with SDK retries 0 - the chat path keeps the SDK's 2 - and a specialist's is agentAdapterForRole's (retries 0, OD-115).
 *  Each SDK client is built lazily on the first call, never here. */
export const LIVE_ADAPTER_FACTORIES: LiveOrchestrationAdapters = Object.freeze<LiveOrchestrationAdapters>({
  coordinator: (provider: "openai" | "anthropic"): ProviderAgentAdapter => {
    const adapter = agentAdapterFor(provider);
    if (adapter instanceof OpenAIAgentAdapter) return new OpenAIAgentAdapter(undefined, undefined, undefined, LIVE_SDK_MAX_RETRIES);
    if (adapter instanceof AnthropicAgentAdapter) return new AnthropicAgentAdapter(undefined, undefined, LIVE_SDK_MAX_RETRIES);
    return adapter;
  },
  specialist: (role, provider, model) => agentAdapterForRole(role, provider, model),
});

/** The live adapters behind ONE shared call counter: the call past the bound is refused before the adapter it wraps is invoked. */
export function boundedLiveAdapters(bound: number = LIVE_CALL_BOUND, factories: LiveOrchestrationAdapters = LIVE_ADAPTER_FACTORIES): { adapters: LiveOrchestrationAdapters; calls: () => number } {
  let calls = 0;
  const counted = (adapter: ProviderAgentAdapter): ProviderAgentAdapter => {
    const admit = (): void => {
      if (calls >= bound) throw new LLMProviderError(adapter.provider, "unknown");
      calls += 1;
    };
    return { provider: adapter.provider, start: async (input) => { admit(); return adapter.start(input); }, continueWith: async (input) => { admit(); return adapter.continueWith(input); } };
  };
  return {
    adapters: { coordinator: (provider) => counted(factories.coordinator(provider)), specialist: (role, provider, model) => counted(factories.specialist(role, provider, model)) },
    calls: () => calls,
  };
}

/** [B21 F fix: coverage-1] The cases the command runs: the task-graph capsules, EVERY turn on the one provider (no second provider is
 *  routed, so no disagreement or fallback can arise); a capsule's scripted steps are never read live. */
export function liveEvaluationCases(provider: "openai" | "anthropic"): OrchestrationEvaluationCase[] {
  return buildOrchestrationEvaluationCases().filter((entry) => (entry.capsule.tasks ?? []).length > 0).map((entry) => ({ ...entry, capsule: { ...entry.capsule, provider, tasks: (entry.capsule.tasks ?? []).map((task) => ({ ...task, provider })) } }));
}

export async function main(environment: Record<string, string | undefined> = process.env, factories: LiveOrchestrationAdapters = LIVE_ADAPTER_FACTORIES): Promise<number> {
  if (environment[LIVE_FLAG] !== "1") {
    console.log(`refused: ${LIVE_FLAG} is not "1" - the model-in-loop track is record-only (OD-125) and runs only when the owner's operator opts in; nothing was run.`);
    return 2;
  }
  const provider: "openai" | "anthropic" = environment[LIVE_PROVIDER_FLAG] === "anthropic" ? "anthropic" : "openai";
  const live = boundedLiveAdapters(LIVE_CALL_BOUND, factories);
  const recorded: unknown[] = [];
  for (const entry of liveEvaluationCases(provider)) {
    const replay = await runOrchestrationCase(entry, { live: live.adapters });
    const scored = scoreOrchestrationCase(entry, replay);
    recorded.push({
      caseId: entry.caseId, runbookLine: entry.runbookLine,
      scriptedFault: entry.scriptedFault, faultReproduced: entry.scriptedFault === null ? null : false,
      events: replay.events.map((event) => event.type),
      degraded: replay.events.flatMap((event) => (event.type === "degraded" ? [event.reason] : [])),
      specialists: replay.events.flatMap((event) => (event.type === "specialist_finished" ? [{ role: event.role, status: event.status, provider: event.provider, model: event.model }] : [])),
      terminal: replay.events.at(-1)?.type ?? null,
      decisions: replay.record.flatMap((item) => (item.decision ? [`${item.taskId}:${item.decision}`] : [])),
      offlineChecks: scored.checks.map((item) => `${item.id}=${item.pass ? "pass" : "fail"}`),
    });
  }
  console.log(JSON.stringify({ schema: "sirkit.b21-model-in-loop-record.v1", provider, callBound: LIVE_CALL_BOUND, sdkMaxRetries: LIVE_SDK_MAX_RETRIES, outputTokenBound: LIVE_OUTPUT_TOKEN_BOUND, calls: live.calls(), cases: recorded }, null, 2));
  return 0;
}

if (process.argv[1]?.endsWith("run-b21-live-orchestration-evaluation.ts")) void main().then((code) => { process.exitCode = code; });
