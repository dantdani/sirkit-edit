/**
 * [B21 D2] Shared state for the D2 suites (not a test file): a scripted specialist adapter that, per task or role, CALLS one of
 * the tools its run was offered (resolved from the advertised declarations - never a name the run did not offer) and then answers
 * with a result document, so a proposing role's specialist really seals through its own gateway; and a DAG runner over the REAL
 * scheduler, the REAL loop, the production registry and the bare specialist gateway (as the composition root builds it), with the
 * in-memory durable record. The coordinator's context is the B21-D merge fixture's (a schematic with U1 and its canonical head
 * mark, the routed board with a PCB history basis, U1's exact authority), assembled by the production assembler.
 */
import { InMemoryDurableWorkflowRepository } from "@/app/lib/durable-workflow/repository";
import { AGENT_SYSTEM_PROMPT } from "@/app/lib/prompts";
import { createAgentToolGateway } from "@/app/lib/agent/gateway";
import { buildRunToolset, runAgentLoop } from "@/app/lib/agent/loop";
import type { AgentRunContext, AgentRunEvent, AgentStep, AgentToolInvocationGateway, AgentToolResult, ProviderAgentAdapter, ProviderToolDeclaration } from "@/app/lib/agent/contracts";
import { LLMProviderError, type LLMProviderFailureReason } from "@/app/lib/llm/errors";
import { SPECIALIST_RESULT_SCHEMA, type SpecialistRole } from "../contracts";
import { DurableOrchestrationRunStore, type OrchestrationRunScope, type OrchestrationRunStore } from "../store";
import { runSpecialistDag, type SchedulerOutcome, type SpecialistLoop } from "../scheduler";
import { REGISTRY, coordinatorContext } from "./_merge-fixtures";
import { answer, registryToolIds } from "./_result-tool";

/** A specialist's result document (the role's own), with overrides. */
export function specialistResult(role: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ schema: SPECIALIST_RESULT_SCHEMA, role, summary: `(scripted) ${role}: read the verified state.`, proposedActions: [], assumptions: [], evidence: [], requiredTools: [], risks: [], unresolvedQuestions: [], validationRequests: [], confidence: "medium", ...extra });
}

export interface SpecialistScript {
  /** one call before the final text, by tool id: sent only when the run offered that tool (else the specialist just answers) */
  call?: { toolId: string; args: Record<string, unknown> };
  /** [B21 D2 fix] further calls, one per later step after `call` (each sent only when offered) - the loop's own single-flight
   *  refuses a second proposal (`proposal_exists`) */
  more?: ReadonlyArray<{ toolId: string; args: Record<string, unknown> }>;
  /** [B21 D2 fix] the calls are made on the task's FIRST attempt only (a retried attempt just answers) */
  firstAttemptOnly?: boolean;
  /** [B21 D2 fix] the task's first `times` continueWith calls throw this provider failure AFTER the call ran (a seal, then an outage) */
  failContinue?: { reason: LLMProviderFailureReason; times: number };
  /** the final result document; a function receives the tool results the run handed back */
  text?: string | ((results: readonly AgentToolResult[]) => string);
}

/** One adapter for every specialist run: the role and task from the frame's `Role:` / `Task:` lines; scripted per task, then per role.
 *  [B21 D2 fix] A run without a `Role:` line is the COORDINATOR's (runOrchestratedChat reuses the adapter): its first turn is
 *  scripted under `coordinator`, its follow-up turn under `coordinator-2`. */
export class ToolCallingSpecialists implements ProviderAgentAdapter {
  readonly provider = "openai" as const;
  readonly starts: Array<{ role: string; task: string; tools: string[]; system: string; userMessage: string }> = [];
  readonly continued: Array<{ task: string; results: readonly AgentToolResult[] }> = [];
  /** every final text the scripted model wrote, per task (what the MODEL listed, before the scheduler attached anything) */
  readonly finals: Array<{ task: string; text: string }> = [];
  private pending: { role: string; task: string; queue: Array<{ toolId: string; args: Record<string, unknown> }>; tools: readonly ProviderToolDeclaration[]; results: AgentToolResult[] } | null = null;
  private readonly attempts = new Map<string, number>();
  private readonly failures = new Map<string, number>();
  private coordinatorTurns = 0;
  private callSequence = 0;
  constructor(private readonly scripts: Readonly<Record<string, SpecialistScript>> = {}) {}
  private step(partial: Partial<AgentStep>): AgentStep {
    return { text: "", toolCalls: [], stopReason: "completed", usage: { inputTokens: 2, outputTokens: 3 }, model: "scripted", continuation: { provider: "openai", state: null }, ...partial };
  }
  private scriptOf(role: string, task: string): SpecialistScript {
    if (role === "coordinator") return this.scripts[task] ?? {};
    return this.scripts[task] ?? this.scripts[role] ?? {};
  }
  private textOf(role: string, task: string, results: readonly AgentToolResult[]): string {
    const script = this.scriptOf(role, task).text;
    const text = typeof script === "function" ? script(results) : script ?? (role === "coordinator" ? `(scripted) the coordinator's ${task} turn.` : specialistResult(role));
    this.finals.push({ task, text });
    return text;
  }
  /** the next OFFERED call of the queue as one tool_use step, else the final text */
  private next(role: string, task: string, queue: Array<{ toolId: string; args: Record<string, unknown> }>, tools: readonly ProviderToolDeclaration[], results: AgentToolResult[]): AgentStep {
    while (queue.length > 0) {
      const call = queue.shift()!;
      const declaration = tools.find((tool) => tool.toolId === call.toolId);
      if (!declaration) continue;
      this.pending = { role, task, queue, tools, results };
      this.callSequence += 1;
      return this.step({ toolCalls: [{ callId: `call-${task}-${this.callSequence}`, providerName: declaration.providerName, argumentsText: JSON.stringify(call.args) }], stopReason: "tool_use" });
    }
    return this.step(answer(this.textOf(role, task, results), tools)); // [B21 E1] pin move (OD-116): through the strict result tool when the run offers it
  }
  async start(input: { system: string; userMessage: string; tools: readonly ProviderToolDeclaration[] }): Promise<AgentStep> {
    const role = /^Role: ([a-z-]+)$/m.exec(input.system)?.[1] ?? "coordinator";
    const task = /^Task: (\S+)$/m.exec(input.system)?.[1] ?? (role === "coordinator" ? ((this.coordinatorTurns += 1) === 1 ? "coordinator" : "coordinator-2") : "(none)");
    this.starts.push({ role, task, tools: registryToolIds(input.tools), system: input.system, userMessage: input.userMessage }); // [B21 E1] the synthetic result tool recorded apart
    const attempt = this.attempts.get(task) ?? 0;
    this.attempts.set(task, attempt + 1);
    const script = this.scriptOf(role, task);
    const queue = script.firstAttemptOnly === true && attempt > 0 ? [] : [...(script.call ? [script.call] : []), ...(script.more ?? [])];
    return this.next(role, task, queue, input.tools, []);
  }
  async continueWith(input: { results: readonly AgentToolResult[] }): Promise<AgentStep> {
    const pending = this.pending ?? { role: "(none)", task: "(none)", queue: [], tools: [], results: [] };
    this.pending = null;
    this.continued.push({ task: pending.task, results: input.results });
    const failure = this.scriptOf(pending.role, pending.task).failContinue;
    const failed = this.failures.get(pending.task) ?? 0;
    if (failure && failed < failure.times) {
      this.failures.set(pending.task, failed + 1);
      throw new LLMProviderError("openai", failure.reason);
    }
    return this.next(pending.role, pending.task, pending.queue, pending.tools, [...pending.results, ...input.results]);
  }
}

/** The Tier 1 edit a proposing specialist asks its gateway to seal (U1's value), and the bounded PCB edit (t-auto-1's width). */
export const TIER1_ARGS = (value: string): Record<string, unknown> => ({ ops: [{ op: "set-value", target: "U1", value }] });
export const PCB_EDIT_ARGS = (widthNm = 500_000): Record<string, unknown> => ({ intent: "widen the net 1 trace", operations: [{ kind: "update_track", trackId: "t-auto-1", widthNm }] });

export interface D2Run { outcome: Extract<SchedulerOutcome, { kind: "ran" }>; store: DurableOrchestrationRunStore; repository: InMemoryDurableWorkflowRepository; scope: OrchestrationRunScope; context: AgentRunContext; adapter: ToolCallingSpecialists; events: AgentRunEvent[]; loops: Array<{ runId: string; events: AgentRunEvent[] }> }

/** The plan's specialists through the REAL scheduler over the coordinator's context, each specialist's run events recorded. */
export async function runProposingDag(roles: readonly SpecialistRole[], scripts: Readonly<Record<string, SpecialistScript>>, over: { context?: AgentRunContext; runId?: string; gateway?: AgentToolInvocationGateway; runLoop?: SpecialistLoop; repository?: InMemoryDurableWorkflowRepository; artifactHeld?: boolean; wrapStore?: (store: DurableOrchestrationRunStore) => OrchestrationRunStore } = {}): Promise<D2Run> {
  const context = over.context ?? coordinatorContext();
  const repository = over.repository ?? new InMemoryDurableWorkflowRepository();
  const store = new DurableOrchestrationRunStore(repository);
  const adapter = new ToolCallingSpecialists(scripts);
  const events: AgentRunEvent[] = [];
  const loops: D2Run["loops"] = [];
  const runId = over.runId ?? "run-b21d2";
  const inner = over.runLoop ?? runAgentLoop;
  const outcome = await runSpecialistDag({ roles: ["coordinator", ...roles], rule: "b21-d2-fixture" }, { runId, provider: "openai", userMessage: "Set U1 to a lower-power value and widen its trace.", history: [], startedAt: Date.now(), ...(over.artifactHeld === true ? { artifactHeld: true } : {}) }, {
    store: over.wrapStore ? over.wrapStore(store) : store, registry: REGISTRY, context, adapter, /* [B21 D2 lead] a store double for the write-failure paths */ gateway: over.gateway ?? createAgentToolGateway(REGISTRY), system: AGENT_SYSTEM_PROMPT, emit: (event) => events.push(event), buildToolset: buildRunToolset,
    runLoop: async (request, deps) => {
      const seen: AgentRunEvent[] = [];
      loops.push({ runId: request.runId, events: seen });
      return inner(request, { ...deps, emit: (event) => { seen.push(event); deps.emit(event); } });
    },
  });
  if (outcome.kind !== "ran") throw new Error(`the D2 DAG must run: ${outcome.reason} ${outcome.detail}`);
  return { outcome, store, repository, scope: { tenantId: context.tenantId, projectId: context.projectId, branchId: context.branchId, runId }, context, adapter, events, loops };
}
