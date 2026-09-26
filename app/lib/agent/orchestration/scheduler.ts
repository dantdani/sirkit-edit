/**
 * [B21 B] The bounded, SEQUENTIAL scheduler (OD-107, OD-122): given a `dag` plan, the coordinator's run and the durable
 * orchestration record, it runs the specialists ONE AT A TIME (parallelism 1) as separate loop runs with their own run ids
 * (`<coordinatorRunId>:<taskId>`), each under a `SpecialistRequest` the contracts validate, and writes every plan / request /
 * result / dissent to the record BEFORE the next task starts, under the attempt-keyed idempotency key. Caps: at most 4
 * specialists per coordinator run (a plan over the cap is refused, never truncated); one attempt per task plus one retry on a
 * provider failure the classifier marks retryable (never on `insufficient_quota`) - counted ABOVE the adapter's own SDK
 * retries (the coordinator's adapter is reused; OD-115 / B21-E owns the breaker and `maxRetries: 0`); the DAG wall time
 * 300 000 ms from the coordinator's start (its own timer, composed into every specialist's signal as a backstop; each
 * specialist's own deadline is bounded to the remaining wall time, so a specialist whose deadline passes is `deadline` for
 * THAT TASK ONLY and the next task still runs while wall time remains - the wall time itself stops everything); a per-DAG
 * output-token ceiling reported, never priced and never enforced: it is the DAG's maximum by construction (steps x the
 * adapters' max output tokens, over both coordinator turns and every attempt of every specialist). Every attempt is measured
 * on the adapter (steps, tool calls, usage, model - a failed attempt counts too) and attributed to its provider and model.
 * Resume: a scheduler started again for the same coordinator run reads the record first and never re-runs a task whose
 * result record exists for the SAME scope and revision (its adapter is never called again); a committed result whose request
 * was bound to another scope/revision is dissent `stale` and the task runs again; a different plan for the same run is refused.
 * Cancellation: aborting the coordinator's signal aborts the running specialist, writes dissent `escalated` with reason
 * `cancelled` for it, and runs nothing further. A store that refuses or throws stops the DAG (single writer: a compare-and-set
 * conflict is never written over; a result that could not be committed is `escalated`, never handed on); a store failure's
 * detail is rendered through the redaction authority, bounded, and never a raw driver message.
 *
 * A specialist has ZERO authority (OD-109, OD-122): the composition root builds its gateway WITHOUT the execution-grant
 * minter, without the external / MCP ports and without the prompt version (nothing but a read can succeed in it), this module
 * wraps that gateway read-only (`role_not_permitted_tool` for every non-read invocation, defense in depth), advertises reads
 * only through a READ-ONLY REGISTRY VIEW (the persisted `allowedToolIds` IS the advertised set: no proposal, no execution, no
 * view control is ever offered to a specialist's model), over a context derived from the coordinator's whose three
 * availability facts are false, with no head mark, no PCB basis and no view. A refused tool call of a specialist reaches the
 * coordinator's stream as a bounded warning line, so it is never silent. B21-C narrows the toolset per role.
 *
 * The loop (`runAgentLoop`, `buildRunToolset`) is INJECTED by the composition root (app/api/chat/orchestration-runtime.ts):
 * the loop's own import closure reaches the fab presets through the read bindings, which the orchestration import gate forbids
 * (RELEASE family), so this module imports only the loop's types. For B a specialist's result reaches the scheduler as the run's
 * final text, parsed as ONE JSON document and validated by `validateSpecialistResult`; anything else is dissent `malformed` -
 * B21-E replaces this with the strict result tool. No chain of thought is stored: the record holds the validated documents and
 * closed dissent reasons only.
 */
import { DEFAULT_AGENT_BUDGET, type AgentExecutionGrantMinter, type AgentRunBudget, type AgentRunContext, type AgentRunEvent, type AgentRunRequest, type AgentRunResult, type AgentStep, type AgentToolInvocationGateway, type ProviderAgentAdapter, type ProviderToolDeclaration } from "../contracts";
import type { AgentLoopDeps } from "../loop";
import { renderUnknownError } from "../redaction";
import { ToolRegistry } from "../../engineering/tool-registry";
import { engineeringDigest } from "../../engineering/stable";
import type { LLMProviderId } from "../../llm/types";
import { isRetryableReason, type LLMProviderFailureReason } from "../../llm/errors";
import { SPECIALIST_REQUEST_SCHEMA, SPECIALIST_RESULT_SCHEMA, isOrchestrationDigest, validateSpecialistRequest, validateSpecialistResult, type RequiredOutputName, type RevisionBoundProjectScope, type SpecialistRole, type ValidatedSpecialistResult } from "./contracts";
import type { OrchestrationDecision, OrchestrationPlanTask, OrchestrationRecord, OrchestrationRunEntry, OrchestrationRunScope, OrchestrationRunStore } from "./store";

// ─── The caps (OD-107, the lead's values) and the closed vocabularies ────────────────────────────────────────────────────

export const SPECIALIST_CAPS = Object.freeze({
  /** specialists per coordinator run; a longer plan is refused, never truncated */
  maxSpecialists: 4,
  /** sequential: one specialist runs at a time */
  parallelism: 1,
  /** from the coordinator's start; every specialist's own deadline is bounded to what remains */
  dagWallTimeMs: 300_000,
  /** one attempt plus one retry on a retryable provider failure (above the adapter's own SDK retries) */
  attemptsPerTask: 2,
  /** the coordinator's turn before the specialists and its follow-up turn after them: the runtime's two loop calls */
  coordinatorTurns: 2,
  /** the adapters' MAX_OUTPUT_TOKENS, spelled here as data (the scheduler suite pins the equality): the reported ceiling is steps x this, never priced */
  outputTokensPerStep: 4_096,
  /** a task is not started with less wall time than this */
  minTaskMs: 1_000,
  /** refused tool calls of ONE attempt shown on the coordinator's stream; one more line says the rest are not shown */
  maxRefusalLinesPerAttempt: 4,
});
/** The read-only narrowing's refusal status (B21-C's per-role wrapper keeps the name). */
export const SPECIALIST_REFUSAL_STATUS = "role_not_permitted_tool" as const;
export const SCHEDULER_REFUSALS = Object.freeze(["plan_empty", "plan_exceeds_specialist_cap", "no_verified_state", "dag_deadline_elapsed", "store_unavailable", "store_refused", "store_conflict", "plan_mismatch"] as const);
export type SchedulerRefusal = (typeof SCHEDULER_REFUSALS)[number];
export const SCHEDULER_STOPS = Object.freeze(["completed", "cancelled", "deadline", "provider_outage", "store_unavailable", "store_refused", "store_conflict"] as const);
export type SchedulerStop = (typeof SCHEDULER_STOPS)[number];
export const SPECIALIST_TASK_STATUSES = Object.freeze(["accepted", "malformed", "escalated", "replayed"] as const);
export type SpecialistTaskStatus = (typeof SPECIALIST_TASK_STATUSES)[number];
/** What every specialist request requires of its result (sorted, the contracts' order): the non-artifact outputs. */
export const SPECIALIST_REQUIRED_OUTPUTS: readonly RequiredOutputName[] = Object.freeze(["assumptions", "confidence", "evidence", "risks", "summary", "unresolvedQuestions"]);
/** The plan record's task id (a plan is not a task; the store keys every record by a task id). */
export const PLAN_TASK_ID = "plan";
/** The user message is carried into a specialist's objective bounded (the contracts bound a text to 1 000 characters). */
export const MAX_OBJECTIVE_MESSAGE_CHARS = 700;
/** A store failure's detail: rendered through the redaction authority and bounded to this many characters. */
export const MAX_STORE_DETAIL_CHARS = 120;

export interface CoordinatorRun {
  runId: string;
  provider: LLMProviderId;
  userMessage: string;
  history: AgentRunRequest["history"];
  /** the coordinator's start (ms since the epoch): the DAG wall time counts from here */
  startedAt: number;
  /** the coordinator's composed signal; every specialist's signal derives from it */
  signal?: AbortSignal;
}
export type SpecialistLoop = (request: AgentRunRequest, deps: AgentLoopDeps) => Promise<AgentRunResult>;
export type SpecialistToolsetBuilder = (registry: ToolRegistry, context: AgentRunContext, warn: (message: string) => void) => { declarations: readonly ProviderToolDeclaration[] };
export interface SchedulerDeps {
  store: OrchestrationRunStore;
  registry: ToolRegistry;
  /** the coordinator's context; every specialist's is DERIVED from it and can only narrow */
  context: AgentRunContext;
  /** the coordinator's adapter (reused: the same provider and model; its SDK retries sit under the scheduler's counts) */
  adapter: ProviderAgentAdapter;
  /** the SPECIALIST gateway, built by the composition root WITHOUT the minter, the ports and the prompt version (nothing but a
   *  read can succeed in it); the scheduler wraps it read-only for every invocation - defense in depth, never the only barrier */
  gateway: AgentToolInvocationGateway;
  system: string;
  /** the coordinator's stream: the scheduler emits warnings only (one plan line, one line per scheduled specialist, a bounded
   *  line per refused tool call of a specialist) */
  emit(event: AgentRunEvent): void;
  /** injected by the composition root (the loop's closure is outside the gated prefix) */
  runLoop: SpecialistLoop;
  buildToolset: SpecialistToolsetBuilder;
  now?: () => number;
  /** the coordinator's budget; a specialist never exceeds DEFAULT_AGENT_BUDGET */
  budget?: AgentRunBudget;
  /** the coordinator's minter, when a caller spreads the coordinator's deps here: NEVER read and NEVER handed to a specialist */
  executionGrants?: AgentExecutionGrantMinter;
}
export interface SpecialistTaskOutcome {
  taskId: string;
  role: SpecialistRole;
  attempt: number;
  specialistRunId: string;
  status: SpecialistTaskStatus;
  reason: string | null;
  resultDigest: string | null;
  result: ValidatedSpecialistResult | null;
  /** measured on the adapter for this attempt (a failed attempt counts too); zero for a replay */
  steps: number;
  toolCalls: number;
  usage: { inputTokens: number; outputTokens: number };
  /** the provider and the model that produced this attempt (the last step's model; null when no step was answered) */
  provider: LLMProviderId;
  model: string | null;
}
export type SchedulerOutcome =
  | { kind: "refused"; reason: SchedulerRefusal; detail: string }
  | { kind: "ran"; tasks: SpecialistTaskOutcome[]; notStarted: OrchestrationPlanTask[]; stop: SchedulerStop; outputTokenCeiling: number; outputTokensUsed: number };

// ─── Pure helpers ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The plan's tasks: every non-coordinator role in plan order, `task-<n>-<role>`. */
export function planTasks(roles: readonly SpecialistRole[]): OrchestrationPlanTask[] {
  return roles.filter((role) => role !== "coordinator").map((role, index) => ({ taskId: `task-${index + 1}-${role}`, role }));
}
export function specialistRunId(coordinatorRunId: string, taskId: string): string {
  return `${coordinatorRunId}:${taskId}`;
}
/** The DAG's maximum output by construction - steps x (both coordinator turns + every attempt of every specialist) x the
 *  per-step maximum, i.e. 6 x (2 + 2 x specialists) x 4 096 - reported, never priced, never enforced (OD-107). */
export function dagOutputTokenCeiling(specialists: number, maxModelSteps: number = DEFAULT_AGENT_BUDGET.maxModelSteps): number {
  return maxModelSteps * (SPECIALIST_CAPS.coordinatorTurns + SPECIALIST_CAPS.attemptsPerTask * specialists) * SPECIALIST_CAPS.outputTokensPerStep;
}
/** The coordinator's context with its AUTHORITY withdrawn and nothing else changed: the three availability facts false or absent,
 *  the external authorities withdrawn, no grant field, risk ceiling `propose`, no approval tier - so the gateway's integrity check
 *  still holds. The follow-up coordinator turn runs over this (it keeps the head mark, basis and view: its registry is read-only). */
export function withdrawAuthority(context: AgentRunContext): AgentRunContext {
  const { externalAcquisitionAvailable: _external, mcpObservationAvailable: _mcp, ...rest } = context;
  const { grantableCapabilities: _grantable, grantLineageId: _lineage, ...discovery } = context.discovery;
  void _external; void _mcp; void _grantable; void _lineage;
  return {
    ...rest,
    executionGrantsAvailable: false,
    discovery: {
      ...discovery,
      availableAuthority: discovery.availableAuthority.filter((authority) => authority !== "external-observation" && authority !== "external-mcp-observation"),
      riskCeiling: "propose",
      approvalsAvailable: [],
    },
  };
}
/** A specialist's context, derived from the coordinator's and NARROWED further: the authority withdrawn (above), no head mark
 *  (no schematic proposal), no PCB basis (no bounded PCB proposal), no view (no view control, no editor surface) - and otherwise
 *  the coordinator's verified state, so the gateway's integrity check holds. */
export function deriveSpecialistContext(context: AgentRunContext): AgentRunContext {
  const withdrawn = withdrawAuthority(context);
  return {
    ...withdrawn,
    schematicHeadMark: null,
    pcbProposalBasis: null,
    view: null,
    viewDigest: null,
    discovery: {
      ...withdrawn.discovery,
      lineageId: "",
      projectState: withdrawn.discovery.projectState.filter((state) => !state.endsWith("-surface")),
    },
  };
}
const readOnlyRegistries = new WeakMap<ToolRegistry, ToolRegistry>();
/** The READ-ONLY view of a registry (built once per registry): the descriptors of operation class `read` only, validated
 *  against the same reviewed granted-execution list, so a loop over it can advertise nothing else - the advertised set is the
 *  persisted `allowedToolIds`, never a wider one refused only at invocation. */
export function readOnlyToolRegistry(registry: ToolRegistry): ToolRegistry {
  let view = readOnlyRegistries.get(registry);
  if (!view) {
    view = new ToolRegistry(registry.list().filter((descriptor) => descriptor.operationClass === "read"), undefined, { grantedExecutionTools: registry.grantedExecutionTools() });
    readOnlyRegistries.set(registry, view);
  }
  return view;
}
/** The reads the derived context advertises through the read-only registry, sorted: a specialist's `allowedToolIds` (A4L
 *  semantics; B21-C narrows per role). The class filter stays as defense in depth. */
export function specialistAllowedToolIds(registry: ToolRegistry, context: AgentRunContext, buildToolset: SpecialistToolsetBuilder): string[] {
  const view = readOnlyToolRegistry(registry);
  const { declarations } = buildToolset(view, context, () => undefined);
  return declarations.filter((declaration) => view.get(declaration.toolId, declaration.version)?.operationClass === "read").map((declaration) => declaration.toolId).sort();
}
/** The read-only narrowing: a specialist may invoke reads only; a proposal, an execution, a view command or anything else is
 *  refused before the real gateway is asked (B21-C's per-role wrapper refines this). */
export function readOnlySpecialistGateway(gateway: AgentToolInvocationGateway, registry: ToolRegistry): AgentToolInvocationGateway {
  return {
    async invoke(input) {
      const descriptor = registry.get(input.toolId, input.version);
      if (!descriptor || descriptor.operationClass !== "read") {
        return { kind: "refused", ok: false, toolId: input.toolId, version: input.version, status: SPECIALIST_REFUSAL_STATUS, diagnostics: ["A specialist may only read in B21-B; proposals, executions and view commands belong to the coordinator."] };
      }
      return gateway.invoke(input);
    },
  };
}
/** The meter on an adapter: every step the provider answered is counted (steps, usage, the last model), whether or not the
 *  loop then completed - a failed attempt is paid for too. */
export function meteredAdapter(adapter: ProviderAgentAdapter): { adapter: ProviderAgentAdapter; meter: { steps: number; usage: { inputTokens: number; outputTokens: number }; model: string | null } } {
  const meter = { steps: 0, usage: { inputTokens: 0, outputTokens: 0 }, model: null as string | null };
  const count = (step: AgentStep): AgentStep => {
    meter.steps += 1;
    meter.usage.inputTokens += step.usage.inputTokens ?? 0;
    meter.usage.outputTokens += step.usage.outputTokens ?? 0;
    meter.model = step.model;
    return step;
  };
  return {
    meter,
    adapter: {
      provider: adapter.provider,
      start: async (input) => count(await adapter.start(input)),
      continueWith: async (input) => count(await adapter.continueWith(input)),
    },
  };
}
export function specialistObjective(role: SpecialistRole, userMessage: string): string {
  const message = userMessage.replace(/\s+/g, " ").trim().slice(0, MAX_OBJECTIVE_MESSAGE_CHARS);
  return `As the ${role} specialist, address this request with reads only and report structured evidence: ${message}`;
}
/** The coordinator's system prompt plus the specialist's frame: the role and task lines are machine-readable (the adapters'
 *  scripted doubles read them); the final message must be ONE JSON document of the result schema (B21-E: the strict result tool). */
export function specialistSystemPrompt(system: string, task: { role: SpecialistRole; taskId: string; specialistRunId: string; objective: string }): string {
  return [
    system,
    "",
    "You are now running as ONE bounded read-only SPECIALIST inside a coordinated run, not as the assistant the user is talking to.",
    `Role: ${task.role}`,
    `Task: ${task.taskId}`,
    `Task run: ${task.specialistRunId}`,
    `Objective: ${task.objective}`,
    "Rules: use only the read tools offered; you cannot propose, execute, approve, bind, qualify, purchase or release anything, and nothing you write has authority - it is evidence the coordinator and the human weigh against deterministic checks. Do not write hidden reasoning into the result.",
    `Your FINAL message must be exactly ONE JSON document and nothing else, of this shape: {"schema":"${SPECIALIST_RESULT_SCHEMA}","role":"${task.role}","summary":"<at most 4000 characters>","proposedActions":[],"assumptions":[{"id":"<id>","statement":"<text>","evidenceIds":[]}],"evidence":[],"requiredTools":[],"risks":[{"id":"<id>","severity":"low|medium|high","statement":"<text>","mitigation":null}],"unresolvedQuestions":[{"id":"<id>","question":"<text>","blocking":false}],"validationRequests":[],"confidence":"low|medium|high"}`,
  ].join("\n");
}
/** A specialist's budget: the coordinator's (never over DEFAULT_AGENT_BUDGET) with the run deadline bounded to the remaining wall time. */
export function specialistBudget(budget: AgentRunBudget, remainingMs: number): AgentRunBudget {
  const bounded = (key: keyof AgentRunBudget): number => Math.min(budget[key], DEFAULT_AGENT_BUDGET[key]);
  return {
    maxModelSteps: bounded("maxModelSteps"),
    maxToolCalls: bounded("maxToolCalls"),
    perToolTimeoutMs: bounded("perToolTimeoutMs"),
    runDeadlineMs: Math.max(0, Math.min(bounded("runDeadlineMs"), Math.floor(remainingMs))),
    maxIdenticalCalls: bounded("maxIdenticalCalls"),
    executionSettlementTimeoutMs: bounded("executionSettlementTimeoutMs"),
  };
}
type ParsedResult = { ok: true; value: ValidatedSpecialistResult; digest: string } | { ok: false; reason: string };
/** B: the run's final text as ONE JSON document, validated by the contracts and bound to the task's role. */
export function parseSpecialistResult(finalText: string, role: SpecialistRole): ParsedResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(finalText.trim());
  } catch {
    return { ok: false, reason: "result_not_json: the final text is not one JSON document" };
  }
  const validated = validateSpecialistResult(parsed);
  if (!validated.ok) return { ok: false, reason: `result_refused: ${validated.refusal} at ${validated.path}` };
  if (validated.value.role !== role) return { ok: false, reason: `result_role_mismatch: ${validated.value.role} is not ${role}` };
  return { ok: true, value: validated.value, digest: validated.digest };
}
/** The request's scope: the coordinator's verified revision and, as labels only, its head mark and PCB basis. A resume replays a
 *  committed result only when the request it answered carried THIS scope (compared by digest). */
export function requestScope(context: AgentRunContext): RevisionBoundProjectScope {
  return {
    tenantId: context.tenantId,
    projectId: context.projectId,
    branchId: context.branchId,
    canonicalRevisionDigest: context.canonicalRevisionDigest ?? "",
    ...(context.schematicHeadMark ? { schematicHeadMark: context.schematicHeadMark } : {}),
    ...(context.pcbProposalBasis ? { pcbBasis: context.pcbProposalBasis } : {}),
  };
}
/** The coordinator's context digests that are engineering digests, as verifiable references. */
function contextReferences(context: AgentRunContext): Array<{ id: string; digest: string }> {
  const candidates: Array<[string, string | null]> = [["canonical-revision", context.canonicalRevisionDigest], ["schematic", context.schematicDigest], ["selection", context.selectionDigest], ["netlist", context.netlistDigest], ["component-authority", context.componentAuthorityDigest]];
  return candidates.flatMap(([id, digest]) => (isOrchestrationDigest(digest) ? [{ id, digest }] : []));
}
const samePlan = (a: readonly OrchestrationPlanTask[], b: readonly OrchestrationPlanTask[]): boolean => a.length === b.length && a.every((task, index) => task.taskId === b[index]!.taskId && task.role === b[index]!.role);
/** A store failure's detail: the redaction authority's rendering (credentials, connection strings redacted), bounded. */
const detailOf = (error: unknown): string => renderUnknownError(error, MAX_STORE_DETAIL_CHARS);

// ─── The scheduler ────────────────────────────────────────────────────────────────────────────────────────────────────────

export async function runSpecialistDag(plan: { roles: readonly SpecialistRole[]; rule?: string }, coordinator: CoordinatorRun, deps: SchedulerDeps): Promise<SchedulerOutcome> {
  const now = deps.now ?? ((): number => Date.now());
  const refused = (reason: SchedulerRefusal, detail: string): SchedulerOutcome => ({ kind: "refused", reason, detail });
  const tasks = planTasks(plan.roles);
  if (tasks.length === 0) return refused("plan_empty", "the plan names no specialist");
  if (tasks.length > SPECIALIST_CAPS.maxSpecialists) return refused("plan_exceeds_specialist_cap", `the plan names ${tasks.length} specialists; at most ${SPECIALIST_CAPS.maxSpecialists} run per coordinator run (OD-107) - the plan is refused, never truncated`);
  const context = deps.context;
  if (context.canonicalState === null || context.canonicalRevisionDigest === null) return refused("no_verified_state", "a specialist needs the coordinator's verified canonical state; none exists for this run");
  const dagDeadline = coordinator.startedAt + SPECIALIST_CAPS.dagWallTimeMs;
  if (dagDeadline - now() < SPECIALIST_CAPS.minTaskMs) return refused("dag_deadline_elapsed", `the DAG wall time (${SPECIALIST_CAPS.dagWallTimeMs} ms from the coordinator's start) has elapsed`);
  const scope: OrchestrationRunScope = { tenantId: context.tenantId, projectId: context.projectId, branchId: context.branchId, runId: coordinator.runId };
  const warn = (message: string): void => deps.emit({ type: "warning", runId: coordinator.runId, message });

  // the record FIRST: a resume reads what was committed and never re-runs it
  let history: OrchestrationRunEntry[];
  try {
    history = await deps.store.history(scope);
  } catch (error) {
    const detail = detailOf(error);
    return refused(detail === "AGENT_ORCHESTRATION_SCOPE_INVALID" ? "store_refused" : "store_unavailable", detail);
  }
  type Written = { ok: true } | { ok: false; reason: "store_unavailable" | "store_refused" | "store_conflict"; detail: string };
  const write = async (taskId: string, attempt: number, record: OrchestrationRecord): Promise<Written> => {
    try {
      const expectedRevision = await deps.store.revision(scope);
      const result = await deps.store.append({ scope, taskId, attempt, expectedRevision, at: new Date(now()).toISOString(), record });
      if (result.ok) return { ok: true };
      if (result.code === "stale_revision") return { ok: false, reason: "store_conflict", detail: result.message };
      return { ok: false, reason: "store_refused", detail: `${result.code} at ${result.path}` };
    } catch (error) {
      return { ok: false, reason: "store_unavailable", detail: detailOf(error) };
    }
  };
  const dissent = (decision: OrchestrationDecision, reason: string, subjectDigest: string | null = null): OrchestrationRecord => ({ kind: "dissent", decision, reason: reason.slice(0, 1_000), subjectDigest });

  const existingPlan = history.find((entry) => entry.record.kind === "plan");
  if (existingPlan) {
    if (existingPlan.record.kind !== "plan" || !samePlan(existingPlan.record.tasks, tasks)) return refused("plan_mismatch", "the record holds a different plan for this coordinator run; a resume replays the committed plan only");
  } else {
    const written = await write(PLAN_TASK_ID, 0, { kind: "plan", tasks, reason: plan.rule ? `router rule ${plan.rule}` : "the coordinator's plan" });
    if (!written.ok) return refused(written.reason, written.detail);
  }

  const outputTokenCeiling = dagOutputTokenCeiling(tasks.length);
  warn(`Orchestration: ${tasks.length} specialist(s) scheduled after this turn, one at a time (parallelism ${SPECIALIST_CAPS.parallelism}; DAG wall time ${SPECIALIST_CAPS.dagWallTimeMs / 1_000} s; output-token ceiling ${outputTokenCeiling} reported, not priced)${plan.rule ? ` under rule ${plan.rule}` : ""}.`);
  const outcomes: SpecialistTaskOutcome[] = [];
  const notStarted: OrchestrationPlanTask[] = [];
  let stop: SchedulerStop = "completed";
  let outputTokensUsed = 0;
  const currentScopeDigest = engineeringDigest(requestScope(context));
  // the DAG's own timer, composed into every specialist's signal as a backstop one grace period after the wall time: a
  // specialist's OWN deadline (bounded to the remaining wall time) fires first, so the task fails `deadline`, never `cancelled`
  const dagController = new AbortController();
  const dagTimer = setTimeout(() => dagController.abort(), Math.max(0, dagDeadline + SPECIALIST_CAPS.minTaskMs - now()));
  try {
    for (const task of tasks) {
      if (stop !== "completed") { notStarted.push(task); continue; }
      if (coordinator.signal?.aborted) { stop = "cancelled"; notStarted.push(task); continue; }
      // the attempt this resume would run at: one past every record of the task (a stale dissent is written UNDER IT, so two
      // resumes under two other scopes record two dissents - keyed by the committed attempt they would collide, [B21 B lead])
      const baseAttempt = history.filter((entry) => entry.taskId === task.taskId).reduce((max, entry) => Math.max(max, entry.attempt + 1), 0);
      // resume: the LAST committed result of this task, replayed only when its request was bound to this very scope and revision
      const committed = history.filter((entry) => entry.taskId === task.taskId && entry.record.kind === "result").at(-1);
      if (committed && committed.record.kind === "result") {
        const answered = history.find((entry) => entry.taskId === task.taskId && entry.attempt === committed.attempt && entry.record.kind === "request");
        const committedScopeDigest = answered && answered.record.kind === "request" ? engineeringDigest(answered.record.document.scope) : null;
        if (committedScopeDigest === currentScopeDigest) {
          outcomes.push({ taskId: task.taskId, role: task.role, attempt: committed.attempt, specialistRunId: specialistRunId(coordinator.runId, task.taskId), status: "replayed", reason: null, resultDigest: committed.record.digest, result: committed.record.document, steps: 0, toolCalls: 0, usage: { inputTokens: 0, outputTokens: 0 }, provider: coordinator.provider, model: null });
          warn(`Orchestration: specialist ${task.role} replayed from the record (task ${task.taskId}, attempt ${committed.attempt}, result ${committed.record.digest}); it did not run again.`);
          continue;
        }
        // the board moved (or the scope differs): the committed result is STALE - dissent, then the task runs again
        const reason = `stale_scope: committed under scope ${committedScopeDigest ?? "(unknown)"}, resumed under ${currentScopeDigest}`;
        const written = await write(task.taskId, baseAttempt, dissent("stale", reason, committed.record.digest));
        if (!written.ok) { stop = written.reason; notStarted.push(task); continue; }
        warn(`Orchestration: specialist ${task.role} committed result (task ${task.taskId}, attempt ${committed.attempt}, result ${committed.record.digest}) is STALE - it was produced against another scope or revision; the task runs again.`);
      }
      for (let offset = 0; offset < SPECIALIST_CAPS.attemptsPerTask; offset += 1) {
        const attempt = baseAttempt + offset;
        const remainingMs = dagDeadline - now();
        if (remainingMs < SPECIALIST_CAPS.minTaskMs) { stop = "deadline"; notStarted.push(task); break; }
        const runId = specialistRunId(coordinator.runId, task.taskId);
        const budget = specialistBudget(deps.budget ?? DEFAULT_AGENT_BUDGET, remainingMs);
        const derived = deriveSpecialistContext(context);
        const objective = specialistObjective(task.role, coordinator.userMessage);
        const maxOutputTokens = budget.maxModelSteps * SPECIALIST_CAPS.outputTokensPerStep;
        const validated = validateSpecialistRequest({
          schema: SPECIALIST_REQUEST_SCHEMA, taskId: task.taskId, role: task.role, objective, scope: requestScope(context), contextRefs: contextReferences(context),
          allowedToolIds: specialistAllowedToolIds(deps.registry, derived, deps.buildToolset),
          budget: { ...budget, maxInputTokens: 4 * maxOutputTokens, maxOutputTokens },
          requiredOutputs: [...SPECIALIST_REQUIRED_OUTPUTS],
          deadlineAt: new Date(now() + budget.runDeadlineMs).toISOString(),
        });
        const outcome = (status: SpecialistTaskStatus, reason: string | null, extra: Partial<SpecialistTaskOutcome> = {}): SpecialistTaskOutcome => ({ taskId: task.taskId, role: task.role, attempt, specialistRunId: runId, status, reason, resultDigest: null, result: null, steps: 0, toolCalls: 0, usage: { inputTokens: 0, outputTokens: 0 }, provider: coordinator.provider, model: null, ...extra });
        if (!validated.ok) {
          const reason = `request_invalid: ${validated.refusal} at ${validated.path}`;
          const written = await write(task.taskId, attempt, dissent("malformed", reason));
          if (!written.ok) { stop = written.reason; break; }
          outcomes.push(outcome("malformed", reason));
          warn(`Orchestration: specialist ${task.role} malformed (task ${task.taskId}, attempt ${attempt}): ${reason}.`);
          break;
        }
        const requested = await write(task.taskId, attempt, { kind: "request", document: validated.value });
        if (!requested.ok) { stop = requested.reason; break; }
        // the specialist's signal: the coordinator's plus the DAG backstop; the loop composes its own bounded deadline
        const controller = new AbortController();
        for (const source of [coordinator.signal, dagController.signal]) {
          if (!source) continue;
          if (source.aborted) controller.abort();
          else source.addEventListener("abort", () => controller.abort(), { once: true });
        }
        const metered = meteredAdapter(deps.adapter);
        let refusalLines = 0;
        const result = await deps.runLoop(
          { runId, provider: coordinator.provider, history: [], userMessage: objective, budget, signal: controller.signal },
          {
            adapter: metered.adapter,
            gateway: readOnlySpecialistGateway(deps.gateway, deps.registry),
            registry: readOnlyToolRegistry(deps.registry),
            context: derived,
            system: specialistSystemPrompt(deps.system, { role: task.role, taskId: task.taskId, specialistRunId: runId, objective }),
            // nothing of a specialist run reaches the coordinator's stream except a bounded line per REFUSED tool call
            emit: (event) => {
              if (event.type !== "tool_refused" && !(event.type === "tool_finished" && !event.ok)) return;
              refusalLines += 1;
              if (refusalLines <= SPECIALIST_CAPS.maxRefusalLinesPerAttempt) warn(`Orchestration: specialist ${task.role} (task ${task.taskId}, attempt ${attempt}) tool ${event.toolId ?? "(unknown)"} refused: ${event.status}.`);
              else if (refusalLines === SPECIALIST_CAPS.maxRefusalLinesPerAttempt + 1) warn(`Orchestration: specialist ${task.role} (task ${task.taskId}, attempt ${attempt}): further refused tool calls are not shown.`);
            },
            contextWarnings: [],
            ...(deps.now ? { now: deps.now } : {}),
          },
        );
        outputTokensUsed += metered.meter.usage.outputTokens;
        const measured = { steps: result.steps, toolCalls: result.toolCalls, usage: { ...metered.meter.usage }, model: metered.meter.model };
        /** a record that could not be written after the specialist ran: the task is escalated and NOTHING of it is handed on */
        const uncommitted = (written: Extract<Written, { ok: false }>, kind: string): void => {
          const reason = `${written.reason}: the ${kind} was not committed`;
          outcomes.push(outcome("escalated", reason, measured));
          warn(`Orchestration: specialist ${task.role} escalated (task ${task.taskId}, attempt ${attempt}): ${reason}.`);
          stop = written.reason;
        };
        if (result.status === "completed") {
          const parsed = parseSpecialistResult(result.finalText, task.role);
          if (parsed.ok) {
            const written = await write(task.taskId, attempt, { kind: "result", document: parsed.value });
            if (!written.ok) { uncommitted(written, "result"); break; }
            outcomes.push(outcome("accepted", null, { ...measured, resultDigest: parsed.digest, result: parsed.value }));
            warn(`Orchestration: specialist ${task.role} accepted (task ${task.taskId}, attempt ${attempt}, result ${parsed.digest}).`);
          } else {
            const written = await write(task.taskId, attempt, dissent("malformed", parsed.reason));
            if (!written.ok) { uncommitted(written, "dissent"); break; }
            outcomes.push(outcome("malformed", parsed.reason, measured));
            warn(`Orchestration: specialist ${task.role} malformed (task ${task.taskId}, attempt ${attempt}): ${parsed.reason}.`);
          }
          break;
        }
        const failure = result.status === "cancelled" ? "cancelled" : (result.failureReason ?? "internal_error");
        if (failure === "cancelled" || failure === "deadline") {
          const written = await write(task.taskId, attempt, dissent("escalated", failure));
          if (!written.ok) { uncommitted(written, "dissent"); break; }
          outcomes.push(outcome("escalated", failure, measured));
          warn(`Orchestration: specialist ${task.role} escalated (task ${task.taskId}, attempt ${attempt}): ${failure}.`);
          // cancelled: nothing further runs; deadline: this task only - the next task runs while wall time remains
          if (failure === "cancelled") stop = "cancelled";
          break;
        }
        if (failure.startsWith("provider_")) {
          const providerReason = failure.slice("provider_".length) as LLMProviderFailureReason;
          const retry = providerReason !== "insufficient_quota" && isRetryableReason(providerReason) && offset + 1 < SPECIALIST_CAPS.attemptsPerTask;
          const reason = `${failure}: the specialist run failed before a result (${retry ? "retrying once" : "not retryable"})`;
          const written = await write(task.taskId, attempt, dissent("escalated", reason));
          if (!written.ok) { uncommitted(written, "dissent"); break; }
          outcomes.push(outcome("escalated", reason, measured));
          warn(`Orchestration: specialist ${task.role} escalated (task ${task.taskId}, attempt ${attempt}): ${reason}.`);
          if (retry) continue;
          stop = "provider_outage";
          break;
        }
        // max_steps, toolset_invalid, internal_error: this task's dissent; the next task still runs
        const written = await write(task.taskId, attempt, dissent("escalated", failure));
        if (!written.ok) { uncommitted(written, "dissent"); break; }
        outcomes.push(outcome("escalated", failure, measured));
        warn(`Orchestration: specialist ${task.role} escalated (task ${task.taskId}, attempt ${attempt}): ${failure}.`);
        break;
      }
    }
  } finally {
    clearTimeout(dagTimer);
  }
  return { kind: "ran", tasks: outcomes, notStarted, stop, outputTokenCeiling, outputTokensUsed };
}
