/**
 * [B21 E1] Shared state for the E1 suites (not a test file): FAKE SDK clients injected into the REAL agent adapters (the
 * b09-provider-contracts pattern - the adapters' own request building, output guard, normalisation and error classification run),
 * SDK-shaped provider failures, the strict result tool's call in each provider's own output shape, the provider layer
 * (`SpecialistProviders`) over those adapters and the process-wide meters, and a DAG runner over the REAL scheduler, loop, gateway
 * and production registry with the in-memory durable record. No network: every client is an in-process fake whose batch and beta
 * surfaces throw when touched (OD-119), and no credential is read (the adapters are handed their clients).
 */
import { vi } from "vitest";
import { InMemoryDurableWorkflowRepository } from "@/app/lib/durable-workflow/repository";
import { AGENT_SYSTEM_PROMPT } from "@/app/lib/prompts";
import { createAgentToolGateway } from "@/app/lib/agent/gateway";
import { buildRunToolset, runAgentLoop } from "@/app/lib/agent/loop";
import { AnthropicAgentAdapter, OpenAIAgentAdapter } from "@/app/lib/agent/adapters";
import { DEFAULT_AGENT_BUDGET, type AgentRunBudget, type AgentRunContext, type AgentRunEvent, type AgentStep, type ProviderAgentAdapter } from "@/app/lib/agent/contracts";
import { LLMProviderError, type LLMProviderFailureReason } from "@/app/lib/llm/errors";
import type { SpecialistRole } from "../contracts";
import { DurableOrchestrationRunStore, type OrchestrationRunScope } from "../store";
import { runSpecialistDag, type SchedulerOutcome } from "../scheduler";
import { PROCESS_LLM_PROVIDER_ADMISSION, admittedAdapter, type LlmProviderAdmissionPort, type SpecialistProviders, type SpecialistRoute } from "../provider-policy";
import { SPECIALIST_RESULT_TOOL_NAME } from "../result-tool";
import { REGISTRY, coordinatorContext } from "./_merge-fixtures";

export type Params = Record<string, unknown>;

/** The role a provider request was made for: the specialist frame's `Role:` line inside the provider's own system field. */
export function roleOf(params: Params): string {
  return /^Role: ([a-z-]+)$/m.exec(String(params.instructions ?? params.system ?? ""))?.[1] ?? "coordinator";
}
/** The strict result tool's arguments for a role (no `schema`, no `proposedActions`: the server writes both). */
export function resultArguments(role: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return { role, summary: `(fake ${role}) read the verified state; nothing changed.`, assumptions: [], evidence: [], requiredTools: [], risks: [], unresolvedQuestions: [], validationRequests: [], confidence: "low", ...over };
}
const usage = { input_tokens: 5, output_tokens: 7 };
/** OpenAI Responses: the result tool called as a FLAT function_call item. */
export function openAIResultResponse(role: string, over: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { output: [{ type: "function_call", call_id: `call-${role}`, name: SPECIALIST_RESULT_TOOL_NAME, arguments: JSON.stringify(resultArguments(role, over)) }], output_text: "", status: "completed", model: "gpt-fake", usage, ...extra };
}
/** OpenAI Responses: a text-only message (the turn ended without the result tool). */
export function openAITextResponse(text: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text, annotations: [] }] }], output_text: text, status: "completed", model: "gpt-fake", usage, ...extra };
}
/** Anthropic Messages: the result tool called as a tool_use block. */
export function anthropicResultMessage(role: string, over: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { content: [{ type: "tool_use", id: `toolu_${role.replaceAll("-", "_")}`, name: SPECIALIST_RESULT_TOOL_NAME, input: resultArguments(role, over) }], stop_reason: "tool_use", model: "claude-fake", usage, ...extra };
}
export function anthropicTextMessage(text: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { content: [{ type: "text", text }], stop_reason: "end_turn", model: "claude-fake", usage, ...extra };
}

/** SDK-shaped provider failures: the fields `app/lib/llm/errors.ts` classifies (the HTTP status and the provider's code / body). */
export function openAIQuotaError(): Error {
  return Object.assign(new Error("You exceeded your current quota, please check your plan and billing details."), { status: 429, code: "insufficient_quota" });
}
export function openAIRateLimitError(): Error {
  return Object.assign(new Error("Rate limit reached for requests"), { status: 429, code: "rate_limit_exceeded" });
}
export function anthropicQuotaError(): Error {
  return Object.assign(new Error("400 invalid_request_error"), { status: 400, error: { type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." } } });
}
/** A call that never settles and ignores its signal: only the run's own deadline ends it. */
export const HANG = Symbol("hang");

export interface FakeClient {
  /** the client the REAL adapter is handed */
  client: unknown;
  /** every request params object, in order */
  calls: Params[];
  /** every request's options object, in order */
  options: Array<Record<string, unknown> | undefined>;
  create: ReturnType<typeof vi.fn>;
}
type Answer = (params: Params, index: number) => unknown;
function fake(answer: Answer): Pick<FakeClient, "calls" | "options" | "create"> {
  const calls: Params[] = [];
  const options: Array<Record<string, unknown> | undefined> = [];
  const create = vi.fn(async (params: Params, requestOptions?: Record<string, unknown>) => {
    calls.push(params);
    options.push(requestOptions);
    const value = answer(params, calls.length - 1);
    if (value === HANG) return new Promise<never>(() => undefined);
    if (value instanceof Error) throw value;
    return value;
  });
  return { calls, options, create };
}
/** A fake OpenAI client (`responses.create` only); its batch and file surfaces throw when touched (OD-119: never a batch). */
export function fakeOpenAI(answer: Answer): FakeClient {
  const parts = fake(answer);
  const client = { responses: { create: parts.create }, get batches(): never { throw new Error("the OpenAI batch surface was touched"); }, get files(): never { throw new Error("the OpenAI file surface was touched"); } };
  return { ...parts, client };
}
/** A fake Anthropic client (`messages.create` only); its batch and beta surfaces throw when touched (OD-119, OD-90). */
export function fakeAnthropic(answer: Answer): FakeClient {
  const parts = fake(answer);
  const client = { messages: { create: parts.create, get batches(): never { throw new Error("the Anthropic batch surface was touched"); } }, get beta(): never { throw new Error("the Anthropic beta surface was touched"); } };
  return { ...parts, client };
}
/** Answer every specialist through the result tool (per provider shape), a coordinator turn with text. */
export const answersOpenAI: Answer = (params) => (roleOf(params) === "coordinator" ? openAITextResponse("(fake) the coordinator's turn.") : openAIResultResponse(roleOf(params)));
export const answersAnthropic: Answer = (params) => (roleOf(params) === "coordinator" ? anthropicTextMessage("(fake) the coordinator's turn.") : anthropicResultMessage(roleOf(params)));

export interface FakeProviders { providers: SpecialistProviders; built: SpecialistRoute[] }
/** The provider layer over REAL adapters with fake clients (production binds `agentAdapterForRole`, which builds its own SDK client
 *  with `maxRetries: 0` - proven by b21-e1-provider-policy with the SDK modules mocked). */
export function fakeProviders(openai: FakeClient, anthropic: FakeClient, over: { env?: Readonly<Record<string, string | undefined>>; admission?: LlmProviderAdmissionPort } = {}): FakeProviders {
  const built: SpecialistRoute[] = [];
  return {
    built,
    providers: {
      adapterFor: (route) => {
        built.push(route);
        return route.provider === "openai" ? new OpenAIAgentAdapter(openai.client as never, route.model, undefined, 0) : new AnthropicAgentAdapter(anthropic.client as never, route.model, 0);
      },
      admission: over.admission ?? PROCESS_LLM_PROVIDER_ADMISSION,
      environment: over.env ?? {},
    },
  };
}
/** The coordinator's adapter in a scheduler-only run: never a specialist's once the provider layer is bound. */
export const COORDINATOR_ONLY: ProviderAgentAdapter = {
  provider: "openai",
  start: async () => { throw new Error("the coordinator's adapter ran a specialist"); },
  continueWith: async () => { throw new Error("the coordinator's adapter ran a specialist"); },
};

export interface E1Run { outcome: SchedulerOutcome; ran: Extract<SchedulerOutcome, { kind: "ran" }> | null; events: AgentRunEvent[]; warnings: string[]; store: DurableOrchestrationRunStore; repository: InMemoryDurableWorkflowRepository; scope: OrchestrationRunScope; context: AgentRunContext }
/** The plan's specialists through the REAL scheduler (the coordinator run on `provider`) with the provider layer bound. */
export async function runE1Dag(roles: readonly SpecialistRole[], providers: SpecialistProviders | undefined, over: { runId?: string; repository?: InMemoryDurableWorkflowRepository; now?: () => number; budget?: AgentRunBudget; context?: AgentRunContext; provider?: "openai" | "anthropic"; adapter?: ProviderAgentAdapter; signal?: AbortSignal } = {}): Promise<E1Run> {
  const context = over.context ?? coordinatorContext();
  const repository = over.repository ?? new InMemoryDurableWorkflowRepository();
  const store = new DurableOrchestrationRunStore(repository);
  const events: AgentRunEvent[] = [];
  const runId = over.runId ?? "run-b21e1";
  const now = over.now ?? ((): number => Date.now());
  const outcome = await runSpecialistDag({ roles: ["coordinator", ...roles], rule: "b21-e1-fixture" }, { runId, provider: over.provider ?? "openai", userMessage: "Check the board against the requirements.", history: [], startedAt: now(), ...(over.signal ? { signal: over.signal } : {}) }, {
    store, registry: REGISTRY, context, adapter: over.adapter ?? COORDINATOR_ONLY, gateway: createAgentToolGateway(REGISTRY), system: AGENT_SYSTEM_PROMPT, emit: (event) => events.push(event),
    runLoop: runAgentLoop, buildToolset: buildRunToolset, budget: over.budget ?? DEFAULT_AGENT_BUDGET, ...(over.now ? { now: over.now } : {}), ...(providers ? { providers } : {}),
  });
  const warnings = events.flatMap((event) => ((event.type === "warning" || event.type === "plan" || event.type === "specialist_finished" || event.type === "degraded") ? [event.message] : [])); // [B21 E2] pin move (OD-126): B's plan, status and stand-down lines are now the plan / specialist_finished / degraded events carrying the same sentence
  return { outcome, ran: outcome.kind === "ran" ? outcome : null, events, warnings, store, repository, scope: { tenantId: context.tenantId, projectId: context.projectId, branchId: context.branchId, runId }, context };
}

// ─── [B21 E1 fix] Another request's call, through the production meter wrapper ─────────────────────────────────────────────

export const START_INPUT = { system: "s", history: [], userMessage: "u", tools: [] };
/** ANOTHER request's admitted call to `provider` that failed with `reason`: through `admittedAdapter` (the production meter wrapper),
 *  so its outcome reaches the breaker exactly as a specialist call's does - never a direct write into the meters. */
export async function failOnce(provider: "openai" | "anthropic", reason: LLMProviderFailureReason, now: number, admission: LlmProviderAdmissionPort = PROCESS_LLM_PROVIDER_ADMISSION): Promise<void> {
  const failing: ProviderAgentAdapter = { provider, start: async () => { throw new LLMProviderError(provider, reason); }, continueWith: async () => { throw new LLMProviderError(provider, reason); } };
  await admittedAdapter(failing, { provider }, admission, () => now).adapter.start(START_INPUT).catch(() => undefined);
}
/** An answer the test releases by hand: the call stays in flight until then. */
export function heldAdapter(provider: "openai" | "anthropic"): { adapter: ProviderAgentAdapter; release: (text?: string) => void; pending: () => number } {
  const waiting: Array<(step: AgentStep) => void> = [];
  const held = (): Promise<AgentStep> => new Promise((resolve) => { waiting.push(resolve); });
  return {
    adapter: { provider, start: held, continueWith: held },
    release: (text = "ok") => waiting.shift()!({ text, toolCalls: [], stopReason: "end_turn", stop: "end_turn", usage: { inputTokens: 1, outputTokens: 1 }, model: "held", continuation: { provider, state: null } }),
    pending: () => waiting.length,
  };
}
