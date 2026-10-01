/**
 * [B21 E2] Shared state for the E2 suites (not a test file): a scripted per-role adapter (the role from the frame's `Role:` line; per
 * role a result through the strict result tool, a provider failure once or always, or an unadvertised call first), a DAG runner
 * over the REAL scheduler, loop, gateway and production registry with the in-memory durable record, and the run-log lines B21-B
 * emitted as warnings (now the plan, status and degraded events' messages). No network, no model, no credential. [B21 E2b] One
 * offered read first (`read-then-result`), and - with `traced` - the trace book bound exactly as the composition root binds it (the
 * record's own trace store, `orchestrationTraceStoreOf`) and settled with the scheduler's outcome after the run.
 */
import { InMemoryDurableWorkflowRepository } from "@/app/lib/durable-workflow/repository";
import { AGENT_SYSTEM_PROMPT, AGENT_SYSTEM_PROMPT_VERSION } from "@/app/lib/prompts";
import { createAgentToolGateway } from "@/app/lib/agent/gateway";
import { buildRunToolset, runAgentLoop } from "@/app/lib/agent/loop";
import { LLMProviderError, type LLMProviderFailureReason } from "@/app/lib/llm/errors";
import { DEFAULT_AGENT_BUDGET, isOrchestrationRunEventType, type AgentRunBudget, type AgentRunContext, type AgentRunEvent, type AgentStep, type AgentToolResult, type ProviderAgentAdapter, type ProviderToolDeclaration } from "@/app/lib/agent/contracts";
import type { SpecialistRole } from "../contracts";
import { DurableOrchestrationRunStore, orchestrationTraceStoreOf, type OrchestrationRunScope, type OrchestrationRunStore } from "../store";
import { planTasks, runSpecialistDag, type CoordinatorRun, type SchedulerOutcome } from "../scheduler";
import { specialistTraceBook, type OrchestrationTraceStore, type SpecialistTraceBook } from "../trace-attribution";
import type { SpecialistProviders } from "../provider-policy";
import { REGISTRY, coordinatorContext } from "./_merge-fixtures";
import { answer, registryToolIds } from "./_result-tool";

export type E2Behaviour =
  | { kind: "result" }
  /** a provider failure on the first start only (the retry's start answers) */
  | { kind: "throw-once"; reason: LLMProviderFailureReason }
  /** a provider failure on every start */
  | { kind: "throw"; reason: LLMProviderFailureReason }
  /** a call of an unadvertised tool (refused `unknown_tool` before it runs), then the result */
  | { kind: "call-unknown" }
  /** [B21 E2 fix] the turn ends with text and never calls the result tool (`malformed`, result_tool_not_called) */
  | { kind: "text-only" }
  /** [B21 E2 fix] the provider stops the turn with this normalized stop (escalated, never parsed) */
  | { kind: "stop"; stop: "max_tokens" }
  /** [B21 E2 fix] the call never answers: the specialist's own deadline ends it (escalated `deadline`) */
  | { kind: "hang" }
  /** [B21 E2 fix] a failure that is not a provider's (escalated `internal_error`) */
  | { kind: "throw-plain" }
  /** [B21 E2 fix] the result carries these keys beside the declared ones (a non-strict provider; A refuses an undeclared key) */
  | { kind: "result-extra"; extra: Readonly<Record<string, unknown>> }
  /** [B21 E2b] one call of an OFFERED read (by tool id, arguments `{}`), then the result */
  | { kind: "read-then-result"; toolId: string };

export function resultDocument(role: string, extra: Readonly<Record<string, unknown>> = {}): string {
  return JSON.stringify({ schema: "sirkit.specialist-result.v1", role, summary: `(scripted) ${role}: read the verified state; nothing changed.`, proposedActions: [], assumptions: [], evidence: [], requiredTools: [], risks: [], unresolvedQuestions: [], validationRequests: [], confidence: "low", ...extra });
}

/** One adapter for every specialist run; behaviour scripted per role. */
export class E2Adapter implements ProviderAgentAdapter {
  readonly provider = "openai" as const;
  readonly starts: Array<{ role: string; tools: string[] }> = [];
  private readonly thrown = new Set<string>();
  private pending: { role: string; offered: readonly ProviderToolDeclaration[] } | null = null;
  constructor(private readonly script: Readonly<Record<string, E2Behaviour>> = {}, private readonly model = "scripted-e2") {}
  private step(partial: Partial<AgentStep>): AgentStep {
    return { text: "", toolCalls: [], stopReason: "completed", stop: "end_turn", usage: { inputTokens: 5, outputTokens: 7 }, model: this.model, continuation: { provider: "openai", state: null }, ...partial };
  }
  async start(input: { system: string; tools: readonly ProviderToolDeclaration[]; signal?: AbortSignal }): Promise<AgentStep> {
    const role = /^Role: ([a-z-]+)$/m.exec(input.system)?.[1] ?? "(none)";
    this.starts.push({ role, tools: registryToolIds(input.tools) });
    const behaviour = this.script[role] ?? { kind: "result" as const };
    if (behaviour.kind === "throw") throw new LLMProviderError("openai", behaviour.reason);
    if (behaviour.kind === "throw-once" && !this.thrown.has(role)) { this.thrown.add(role); throw new LLMProviderError("openai", behaviour.reason); }
    if (behaviour.kind === "call-unknown") {
      this.pending = { role, offered: input.tools };
      return this.step({ toolCalls: [{ callId: `call-unknown-${role}`, providerName: "sirkit_release_now", argumentsText: "{}" }], stopReason: "tool_use" });
    }
    if (behaviour.kind === "text-only") return this.step({ text: `(scripted) ${role}: a result written as text.` });
    if (behaviour.kind === "stop") return this.step({ text: "(scripted) cut off", stopReason: "max_tokens", stop: behaviour.stop });
    if (behaviour.kind === "throw-plain") throw new Error("scripted internal failure");
    if (behaviour.kind === "hang") return new Promise<AgentStep>((_resolve, reject) => { input.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }); });
    if (behaviour.kind === "result-extra") return this.step(answer(resultDocument(role, behaviour.extra), input.tools));
    if (behaviour.kind === "read-then-result") {
      const declaration = input.tools.find((tool) => tool.toolId === behaviour.toolId);
      if (!declaration) throw new Error(`${behaviour.toolId} is not offered to ${role}`);
      this.pending = { role, offered: input.tools };
      return this.step({ toolCalls: [{ callId: `call-read-${role}`, providerName: declaration.providerName, argumentsText: "{}" }], stopReason: "tool_use" });
    }
    return this.step(answer(resultDocument(role), input.tools));
  }
  async continueWith(input: { results: readonly AgentToolResult[]; tools: readonly ProviderToolDeclaration[] }): Promise<AgentStep> {
    const pending = this.pending;
    this.pending = null;
    return this.step(answer(resultDocument(pending?.role ?? "(none)"), input.tools.length > 0 ? input.tools : pending?.offered ?? []));
  }
}

/** B21-B's run-log lines, as the stream now carries them: every warning, and the message of every plan, specialist_finished and
 *  degraded event (the lines they replace; `specialist_started` and `partial_result` replace no B line). */
export function schedulerLines(events: ReadonlyArray<Record<string, unknown> | AgentRunEvent>): string[] {
  return events.flatMap((event) => {
    const record = event as Record<string, unknown>;
    return (record.type === "warning" || record.type === "plan" || record.type === "specialist_finished" || record.type === "degraded") && typeof record.message === "string" ? [record.message] : [];
  });
}
export const orchestrationEvents = (events: readonly AgentRunEvent[]): AgentRunEvent[] => events.filter((event) => isOrchestrationRunEventType(event.type));

export const E2_RUN_ID = "run-b21e2";
export interface E2Run {
  outcome: SchedulerOutcome; ran: Extract<SchedulerOutcome, { kind: "ran" }> | null; events: AgentRunEvent[];
  store: DurableOrchestrationRunStore; repository: InMemoryDurableWorkflowRepository; scope: OrchestrationRunScope; context: AgentRunContext;
  adapter: E2Adapter;
  /** [B21 E2b] with `traced`: the book, the record's own trace store and what the book's settle reported (null otherwise) */
  book: SpecialistTraceBook | null; traceStore: OrchestrationTraceStore | null; settled: { recorded: number; failures: string[] } | null;
}
/** The plan's specialists through the REAL scheduler (the coordinator's run on openai); [B21 E2b] with `traced`, the book bound as the runtime binds it and settled after. */
export async function runE2Dag(roles: readonly SpecialistRole[], script: Readonly<Record<string, E2Behaviour>> = {}, over: { runId?: string; repository?: InMemoryDurableWorkflowRepository; context?: AgentRunContext; coordinator?: Partial<CoordinatorRun>; providers?: SpecialistProviders; adapter?: ProviderAgentAdapter; now?: () => number; /** [B21 E2 fix] the record the scheduler writes to, wrapped (a failing append) */ wrapStore?: (store: OrchestrationRunStore) => OrchestrationRunStore; budget?: AgentRunBudget; /** [B21 E2b] the per-task trace book */ traced?: boolean } = {}): Promise<E2Run> {
  const context = over.context ?? coordinatorContext();
  const repository = over.repository ?? new InMemoryDurableWorkflowRepository();
  const store = new DurableOrchestrationRunStore(repository);
  const adapter = new E2Adapter(script);
  const events: AgentRunEvent[] = [];
  const runId = over.runId ?? E2_RUN_ID;
  const plan = { roles: ["coordinator", ...roles] as SpecialistRole[], rule: "b21-e2-fixture" };
  const coordinator: CoordinatorRun = { runId, provider: "openai", userMessage: "Check U1 against the requirements and the verified board.", history: [], startedAt: (over.now ?? Date.now)(), ...over.coordinator };
  const traceStore = over.traced ? orchestrationTraceStoreOf(store) : null;
  let traceCount = 0;
  const book = traceStore ? specialistTraceBook({ coordinatorRunId: runId, tasks: planTasks(plan.roles), scope: { tenantId: context.tenantId, projectId: context.projectId, branchId: context.branchId }, systemPromptVersion: AGENT_SYSTEM_PROMPT_VERSION, newTraceId: () => `trace-e2b-${(traceCount += 1)}`, store: traceStore, ...(over.now ? { now: over.now } : {}) }) : null;
  const outcome = await runSpecialistDag(plan, coordinator, {
    store: over.wrapStore ? over.wrapStore(store) : store, registry: REGISTRY, context, adapter: over.adapter ?? adapter, gateway: createAgentToolGateway(REGISTRY), system: AGENT_SYSTEM_PROMPT,
    emit: (event) => { events.push(event); },
    runLoop: book ? book.loop(runAgentLoop) : runAgentLoop, buildToolset: buildRunToolset, budget: over.budget ?? DEFAULT_AGENT_BUDGET, ...(over.now ? { now: over.now } : {}), ...(over.providers ? { providers: over.providers } : {}),
  });
  const settled = book ? await book.settle(outcome.kind === "ran" ? outcome.tasks : []) : null;
  return { outcome, ran: outcome.kind === "ran" ? outcome : null, events, store, repository, scope: { tenantId: context.tenantId, projectId: context.projectId, branchId: context.branchId, runId }, context, adapter, book, traceStore, settled };
}
