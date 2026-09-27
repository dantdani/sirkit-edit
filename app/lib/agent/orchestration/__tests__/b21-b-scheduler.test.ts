/**
 * [B21 B] The bounded, sequential scheduler (OD-107, OD-122) over the REAL loop, the REAL gateway and the production registry
 * (the B18-C harness composition: a real canonical editor session and board), driven by a scripted per-role adapter, with the
 * in-memory durable repository behind the orchestration record. Sequential order; the caps (a plan over the cap is refused,
 * never run); a SpecialistRequest validated by A's contracts per task whose `allowedToolIds` IS the advertised set (reads only:
 * no execution, no view control, no proposal); results written before the next task; resume after a scripted provider outage
 * replays the committed result and never calls the completed task's adapter again, and a committed result from another
 * scope/revision is `stale` and re-run, never replayed; cancellation mid-DAG aborts the running specialist's signal, writes
 * `escalated`/`cancelled`, runs nothing further and touches no grant of the coordinator's; a specialist's own deadline is
 * `deadline` for that task only (the next task runs while wall time remains; the DAG wall time stops everything);
 * `insufficient_quota` is never retried; a malformed result is dissent `malformed` ([B21 E1] the specialists answer through the strict
 * result tool, OD-116: a turn without it is `result_tool_not_called`); every attempt's steps, tool calls,
 * usage, provider and model are measured (a failed attempt counts too) and the token ceiling covers both coordinator turns and
 * every attempt; a mid-DAG store conflict or failure stops the DAG with nothing written over; the derived specialist context
 * passes the gateway's integrity check with its three availability facts false; the read-only narrowing refuses a proposal;
 * a specialist's refused tool call is a bounded warning line on the coordinator's stream; a store failure's detail is redacted.
 */
import { describe, expect, it } from "vitest";
import { InMemoryDurableWorkflowRepository } from "@/app/lib/durable-workflow/repository";
import { AGENT_SYSTEM_PROMPT } from "@/app/lib/prompts";
import { LLMProviderError, type LLMProviderFailureReason } from "@/app/lib/llm/errors";
import { sirkitToolRegistry } from "@/app/lib/engineering/tool-catalog";
import { createAgentToolGateway, verifyAgentContextIntegrity } from "@/app/lib/agent/gateway";
import { buildRunToolset, runAgentLoop } from "@/app/lib/agent/loop";
import { MAX_OUTPUT_TOKENS } from "@/app/lib/agent/adapters";
import { DEFAULT_AGENT_BUDGET, isOrchestrationRunEventType, type AgentExecutionGrantMinter, type AgentRunContext, type AgentRunEvent, type AgentStep, type AgentToolResult, type ProviderAgentAdapter, type ProviderToolDeclaration } from "@/app/lib/agent/contracts";
import { assembleAgentRunContext } from "@/app/lib/agent/context";
import { DEFAULT_PRESET_ID } from "@/app/lib/pcb/drc/presets";
import { PRINCIPAL, SCOPE as HARNESS_SCOPE, composition, headOf, type Composed } from "@/app/lib/engineering/__tests__/b18c-harness";
import { validateSpecialistRequest, validateSpecialistResult, type SpecialistRole } from "../contracts";
import { DurableOrchestrationRunStore, type OrchestrationAppendRequest, type OrchestrationRunEntry, type OrchestrationRunScope, type OrchestrationRunStore } from "../store";
import { DAG_ROLE_LISTS, FULL_CIRCUIT_RUNBOOK_ROLES } from "../router";
import { SPECIALIST_CAPS, SPECIALIST_REFUSAL_STATUS, dagOutputTokenCeiling, deriveSpecialistContext, planTasks, readOnlySpecialistGateway, readOnlyToolRegistry, runSpecialistDag, specialistAllowedToolIds, specialistRunId, type CoordinatorRun, type SchedulerDeps } from "../scheduler";
import { ROLE_SCHEMATIC, loadedAuthority } from "./_role-fixtures";
import { answer, registryToolIds } from "./_result-tool";

const registry = sirkitToolRegistry();
/** the specialist gateway as the composition root builds it: NO minter, NO port, NO prompt version - nothing but reads can succeed in it */
const gateway = createAgentToolGateway(registry);
const REPLACEMENT = DAG_ROLE_LISTS["component-replacement"]; // [B21 D3] pin move (OD-107 amended): the replacement DAG gained the schematic specialist (task 3, the evidence before the seal; the critic is task 4) - here read-only (no head mark in the rig): every case below that runs it moved with it
const MESSAGE = "Swap U1 for a lower-power alternative.";

type Behaviour =
  | { kind: "result"; role?: string; extra?: Record<string, unknown> }
  | { kind: "text"; text: string }
  | { kind: "throw"; reason: LLMProviderFailureReason; times?: number }
  | { kind: "hang" }
  | { kind: "call-then-result"; toolId: string; args?: string }
  /** one read call, then the continuation throws the provider failure ONCE (the retry's continuation answers) */
  | { kind: "call-then-throw"; toolId: string; reason: LLMProviderFailureReason }
  /** a call to a tool that is not advertised (refused `unknown_tool` by the loop), then the result */
  | { kind: "call-unknown" };

function resultDocument(role: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ schema: "sirkit.specialist-result.v1", role, summary: `(scripted) ${role}: read the board; nothing changed.`, proposedActions: [], assumptions: [], evidence: [], requiredTools: [], risks: [], unresolvedQuestions: [], validationRequests: [], confidence: "low", ...extra });
}

/** One adapter for every specialist run: the role is read from the system prompt's `Role:` line; behaviour is scripted per role. */
class SpecialistAdapter implements ProviderAgentAdapter {
  readonly provider = "openai" as const;
  readonly starts: Array<{ role: string; runId: string | null; system: string; userMessage: string; tools: string[]; signal: AbortSignal | undefined; at: number }> = [];
  readonly abortedRoles: string[] = [];
  readonly continueInputs: Array<{ role: string; results: readonly AgentToolResult[] }> = [];
  private inFlight = 0;
  maxInFlight = 0;
  private readonly thrown = new Map<string, number>();
  private readonly pendingCalls = new Map<string, string>();
  private readonly throwOnContinue = new Map<string, LLMProviderFailureReason>();
  private readonly offered = new Map<string, readonly ProviderToolDeclaration[]>();
  constructor(private readonly script: Record<string, Behaviour>, private readonly onStart?: (role: string) => Promise<void> | void) {}
  private step(partial: Partial<AgentStep>): AgentStep {
    return { text: "", toolCalls: [], stopReason: "completed", usage: { inputTokens: 7, outputTokens: 11 }, model: "scripted", continuation: { provider: "openai", state: null }, ...partial };
  }
  private roleOf(system: string): string { return /^Role: ([a-z-]+)$/m.exec(system)?.[1] ?? "(none)"; }
  async start(input: { system: string; userMessage: string; tools: readonly ProviderToolDeclaration[]; signal?: AbortSignal }): Promise<AgentStep> {
    const role = this.roleOf(input.system);
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    this.starts.push({ role, runId: /^Task run: (.+)$/m.exec(input.system)?.[1] ?? null, system: input.system, userMessage: input.userMessage, tools: registryToolIds(input.tools), signal: input.signal, at: Date.now() }); // [B21 E1] the synthetic result tool recorded apart
    this.offered.set(role, input.tools);
    input.signal?.addEventListener("abort", () => this.abortedRoles.push(role), { once: true });
    await this.onStart?.(role);
    try {
      const behaviour = this.script[role] ?? { kind: "result" as const };
      if (behaviour.kind === "hang") return await new Promise<AgentStep>(() => { /* only the signal ends this run */ });
      if (behaviour.kind === "throw") {
        const seen = (this.thrown.get(role) ?? 0) + 1;
        this.thrown.set(role, seen);
        if (behaviour.times === undefined || seen <= behaviour.times) throw new LLMProviderError("openai", behaviour.reason);
        return this.step(answer(resultDocument(role), input.tools)); // [B21 E1] pin move (OD-116): through the strict result tool
      }
      if (behaviour.kind === "text") return this.step({ text: behaviour.text });
      if (behaviour.kind === "call-unknown") {
        this.pendingCalls.set(role, "(unknown)");
        return this.step({ toolCalls: [{ callId: `call-${role}`, providerName: "sirkit_release_now", argumentsText: "{}" }], stopReason: "tool_use" });
      }
      if (behaviour.kind === "call-then-result" || behaviour.kind === "call-then-throw") {
        const declaration = input.tools.find((tool) => tool.toolId === behaviour.toolId);
        if (!declaration) return this.step({ text: `(scripted) ${behaviour.toolId} is not advertised` });
        this.pendingCalls.set(role, behaviour.toolId);
        if (behaviour.kind === "call-then-throw" && !this.thrown.has(role)) { this.thrown.set(role, 1); this.throwOnContinue.set(role, behaviour.reason); }
        return this.step({ toolCalls: [{ callId: `call-${role}`, providerName: declaration.providerName, argumentsText: behaviour.kind === "call-then-result" ? (behaviour.args ?? "{}") : "{}" }], stopReason: "tool_use" });
      }
      return this.step(answer(resultDocument(behaviour.role ?? role, behaviour.extra), input.tools)); // [B21 E1] pin move (OD-116): through the strict result tool
    } finally {
      this.inFlight -= 1;
    }
  }
  async continueWith(input: { results: readonly AgentToolResult[] }): Promise<AgentStep> {
    const role = [...this.pendingCalls.keys()].at(-1) ?? "(none)";
    this.pendingCalls.delete(role);
    this.continueInputs.push({ role, results: input.results });
    const failure = this.throwOnContinue.get(role);
    if (failure) { this.throwOnContinue.delete(role); throw new LLMProviderError("openai", failure); }
    return this.step(answer(resultDocument(role), this.offered.get(role) ?? [])); // [B21 E1] pin move (OD-116): through the strict result tool
  }
  count(role: string): number { return this.starts.filter((start) => start.role === role).length; }
}

function minterDouble(): AgentExecutionGrantMinter & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async mint() { calls.push("mint"); throw new Error("never"); },
    async awaitSettlement() { calls.push("awaitSettlement"); throw new Error("never"); },
    async retireIssued(reason) { calls.push(`retireIssued:${reason}`); return []; },
  };
}

/** [B21 C] pin move: the harness's run context PLUS the server-owned component authority - the one thing the sourcing specialist
 *  can read under OD-109 (its other reviewed reads need the ports a specialist never holds). Without it the sourcing role has no
 *  tools and B21-C does not run it (`role_has_no_tools`, b21-c-least-privilege case 4); with it, B's DAG proofs keep their three
 *  specialists. [B21 C fix] (review: an EMPTY record set is a state the route's loader never produces) the authority is what
 *  production loads for a schematic whose U1 holds one durable binding: the schematic joins the context and the record is U1's,
 *  loaded by the route's own loader. Still assembled by the production assembler from the live board, as `runContext` does. */
const RIG_AUTHORITY = await loadedAuthority(HARNESS_SCOPE);
function rigContext(c: Composed): AgentRunContext {
  const head = headOf(c);
  const assembly = assembleAgentRunContext({
    ...HARNESS_SCOPE, board: JSON.parse(JSON.stringify(c.history.committedPresent)), schematic: ROLE_SCHEMATIC,
    pcbProposalBasis: { historyHeadSequence: head.headSequence, historyHeadLabel: null, lineageId: head.lineageId, activeDrcPresetId: DEFAULT_PRESET_ID },
    verifiedActor: { principalId: PRINCIPAL.principalId, actorRole: "pcb_editor", membershipRevision: PRINCIPAL.membershipRevision, authMethod: "local_dev" },
    executionGrantsAvailable: true, autonomy: c.autonomy, componentAuthority: RIG_AUTHORITY,
  });
  if (!assembly.ok) throw new Error(assembly.reason);
  return assembly.context;
}

interface Rig { store: OrchestrationRunStore; repository: InMemoryDurableWorkflowRepository; adapter: SpecialistAdapter; events: AgentRunEvent[]; minter: ReturnType<typeof minterDouble>; deps: SchedulerDeps; coordinator: CoordinatorRun; scope: OrchestrationRunScope; controller: AbortController }
async function rig(script: Record<string, Behaviour>, over: { runId?: string; startedAt?: number; store?: OrchestrationRunStore; repository?: InMemoryDurableWorkflowRepository; adapter?: SpecialistAdapter; onStart?: (role: string) => Promise<void> | void } = {}): Promise<Rig> {
  const c = await composition("proposal_only");
  const context = rigContext(c);
  const repository = over.repository ?? new InMemoryDurableWorkflowRepository();
  const store = over.store ?? new DurableOrchestrationRunStore(repository);
  const adapter = over.adapter ?? new SpecialistAdapter(script, over.onStart);
  const events: AgentRunEvent[] = [];
  const minter = minterDouble();
  const controller = new AbortController();
  const runId = over.runId ?? "run-b21b";
  const coordinator: CoordinatorRun = { runId, provider: "openai", userMessage: MESSAGE, history: [], startedAt: over.startedAt ?? Date.now(), signal: controller.signal };
  const deps: SchedulerDeps = { store, registry, context, adapter, gateway, system: AGENT_SYSTEM_PROMPT, emit: (event) => events.push(event), runLoop: runAgentLoop, buildToolset: buildRunToolset };
  // the coordinator's own deps carry the minter; the scheduler must never hand it on (proven by the minter double's call log)
  void minter;
  return { store, repository, adapter, events, minter, deps, coordinator, scope: { tenantId: context.tenantId, projectId: context.projectId, branchId: context.branchId, runId }, controller };
}
const kinds = (history: OrchestrationRunEntry[]): string[] => history.map((entry) => `${entry.taskId}:${entry.attempt}:${entry.record.kind}`);
const operationClass = (toolId: string): string | undefined => registry.list().find((descriptor) => descriptor.toolId === toolId)?.operationClass;
const warningsOf = (events: AgentRunEvent[]): string[] => events.flatMap((event) => ((event.type === "warning" || event.type === "plan" || event.type === "specialist_finished" || event.type === "degraded") ? [event.message] : [])); // [B21 E2] pin move (OD-126): B's plan, status and stand-down lines are now the plan / specialist_finished / degraded events carrying the same sentence

describe("[B21 B] the bounded sequential scheduler", () => {
  it("1. sequential (parallelism 1): three specialists run ONE AT A TIME in plan order as separate loop runs under `<coordinatorRunId>:<taskId>`; the store holds the plan, then per task its request and its result, every result committed BEFORE the next task's adapter is called; one warning line per scheduled specialist; the token ceiling covers both coordinator turns and every attempt (6 x (2 + 2 x specialists) x 4096), reported", async () => {
    const seen: Array<{ role: string; resultsBefore: string[] }> = [];
    let r: Rig | null = null;
    r = await rig({}, { onStart: async (role) => { const history = await r!.store.history(r!.scope); seen.push({ role, resultsBefore: history.filter((entry) => entry.record.kind === "result").map((entry) => entry.taskId) }); } });
    const outcome = await runSpecialistDag({ roles: REPLACEMENT, rule: "D-component-replacement" }, r.coordinator, r.deps);
    expect(outcome.kind).toBe("ran");
    if (outcome.kind !== "ran") return;
    expect(outcome.stop).toBe("completed");
    // [B21 D3] pin move (OD-107 amended): the replacement DAG gained the schematic specialist (task 3, the evidence before the seal; the critic is task 4) - here read-only (no head mark in the rig)
    expect(outcome.tasks.map((task) => [task.taskId, task.role, task.attempt, task.status])).toEqual([
      ["task-1-circuit-topology", "circuit-topology", 0, "accepted"],
      ["task-2-component-sourcing-evidence", "component-sourcing-evidence", 0, "accepted"],
      ["task-3-schematic", "schematic", 0, "accepted"],
      ["task-4-verification-critic", "verification-critic", 0, "accepted"],
    ]);
    expect(outcome.tasks.map((task) => task.specialistRunId)).toEqual(["run-b21b:task-1-circuit-topology", "run-b21b:task-2-component-sourcing-evidence", "run-b21b:task-3-schematic", "run-b21b:task-4-verification-critic"]);
    expect(specialistRunId("run-b21b", "task-1-circuit-topology")).toBe("run-b21b:task-1-circuit-topology");
    expect(r.adapter.starts.map((start) => start.role)).toEqual(["circuit-topology", "component-sourcing-evidence", "schematic", "verification-critic"]);
    expect(r.adapter.starts.map((start) => start.runId)).toEqual(outcome.tasks.map((task) => task.specialistRunId));
    expect(r.adapter.maxInFlight).toBe(1);
    expect(seen).toEqual([
      { role: "circuit-topology", resultsBefore: [] },
      { role: "component-sourcing-evidence", resultsBefore: ["task-1-circuit-topology"] },
      { role: "schematic", resultsBefore: ["task-1-circuit-topology", "task-2-component-sourcing-evidence"] },
      { role: "verification-critic", resultsBefore: ["task-1-circuit-topology", "task-2-component-sourcing-evidence", "task-3-schematic"] },
    ]);
    const history = await r.store.history(r.scope);
    expect(kinds(history)).toEqual(["plan:0:plan", "task-1-circuit-topology:0:request", "task-1-circuit-topology:0:result", "task-2-component-sourcing-evidence:0:request", "task-2-component-sourcing-evidence:0:result", "task-3-schematic:0:request", "task-3-schematic:0:result", "task-4-verification-critic:0:request", "task-4-verification-critic:0:result"]);
    expect(history[0]!.record).toMatchObject({ kind: "plan", tasks: planTasks(REPLACEMENT) });
    expect(outcome.outputTokenCeiling).toBe(6 * (2 + 2 * 4) * 4096);
    expect(dagOutputTokenCeiling(4)).toBe(outcome.outputTokenCeiling);
    expect(outcome.outputTokensUsed).toBe(4 * 11);
    const warnings = r.events.filter((event): event is Extract<AgentRunEvent, { type: "warning" | "plan" | "specialist_finished" | "degraded" }> => (event.type === "warning" || event.type === "plan" || event.type === "specialist_finished" || event.type === "degraded")); // [B21 E2] pin move (OD-126): B's plan, status and stand-down lines are now the plan / specialist_finished / degraded events carrying the same sentence
    expect(r.events.filter((event) => event.type !== "warning" && !isOrchestrationRunEventType(event.type))).toEqual([]); // nothing of a specialist run reaches the coordinator's stream; [B21 E2] pin move (OD-126): the scheduler's own status facts are the additive run events
    for (const role of ["circuit-topology", "component-sourcing-evidence", "schematic", "verification-critic"]) expect(warnings.some((warning) => warning.message.includes(role) && warning.message.includes("accepted")), role).toBe(true);
    expect(warnings.every((warning) => warning.runId === "run-b21b")).toBe(true);
    for (const task of outcome.tasks) { expect(task.result).not.toBeNull(); expect(task.resultDigest).toMatch(/^eng1-[0-9a-f]{16}$/); }
  });

  it("2. the caps: a plan with five specialists (and the runbook's six-specialist full-circuit list) is REFUSED before anything runs or is written - never truncated, never run; an empty plan is refused too; SPECIALIST_CAPS carries the lead's values and its per-step figure IS the adapters' MAX_OUTPUT_TOKENS", async () => {
    const r = await rig({});
    const five = ["coordinator", "requirements-analyst", "circuit-topology", "component-sourcing-evidence", "schematic", "verification-critic"] as const satisfies readonly SpecialistRole[];
    expect(await runSpecialistDag({ roles: five }, r.coordinator, r.deps)).toEqual({ kind: "refused", reason: "plan_exceeds_specialist_cap", detail: expect.stringContaining("5") });
    // [B21 C] pin move: the router's full-circuit list is trimmed to four (OD-107 resolved); the runbook's six stay refused by the cap
    expect(await runSpecialistDag({ roles: FULL_CIRCUIT_RUNBOOK_ROLES }, r.coordinator, r.deps)).toMatchObject({ kind: "refused", reason: "plan_exceeds_specialist_cap" });
    expect(await runSpecialistDag({ roles: ["coordinator"] }, r.coordinator, r.deps)).toMatchObject({ kind: "refused", reason: "plan_empty" });
    expect(r.adapter.starts).toEqual([]);
    expect(await r.store.history(r.scope)).toEqual([]);
    expect(SPECIALIST_CAPS).toEqual({ maxSpecialists: 4, parallelism: 1, dagWallTimeMs: 300_000, attemptsPerTask: 2, coordinatorTurns: 2, outputTokensPerStep: 4_096, minTaskMs: 1_000, maxRefusalLinesPerAttempt: 4 });
    expect(SPECIALIST_CAPS.outputTokensPerStep).toBe(MAX_OUTPUT_TOKENS);
  });

  it("3. every task's stored request is a SpecialistRequest A's contracts validate: bound to the run's scope and verified revision, its `allowedToolIds` sorted reads only and EQUAL to the set advertised to the specialist's model (no granted execution, no view-session control, no proposal advertised), its budget at or under DEFAULT_AGENT_BUDGET, its deadline at or before the DAG deadline, and its objective bounded", async () => {
    const r = await rig({});
    const before = Date.now();
    const outcome = await runSpecialistDag({ roles: REPLACEMENT }, r.coordinator, r.deps);
    expect(outcome.kind).toBe("ran");
    const requests = (await r.store.history(r.scope)).filter((entry) => entry.record.kind === "request");
    expect(requests).toHaveLength(4); // [B21 D3] pin move (OD-107 amended): the replacement DAG gained the schematic specialist (task 3, the evidence before the seal; the critic is task 4) - here read-only (no head mark in the rig)
    for (const [index, entry] of requests.entries()) {
      const record = entry.record;
      if (record.kind !== "request") throw new Error("request expected");
      const document = record.document;
      expect(validateSpecialistRequest(JSON.parse(JSON.stringify(document))).ok).toBe(true);
      expect(document.taskId).toBe(entry.taskId);
      expect(document.scope).toMatchObject({ tenantId: r.scope.tenantId, projectId: r.scope.projectId, branchId: r.scope.branchId, canonicalRevisionDigest: r.deps.context.canonicalRevisionDigest });
      expect(document.allowedToolIds.length).toBeGreaterThan(0);
      expect([...document.allowedToolIds]).toEqual([...document.allowedToolIds].sort());
      for (const toolId of document.allowedToolIds) expect(operationClass(toolId), toolId).toBe("read");
      // [review] the record describes the run: what the model was offered IS what the record says
      expect([...r.adapter.starts[index]!.tools].sort(), `${entry.taskId} advertised`).toEqual([...document.allowedToolIds]);
      for (const key of ["maxModelSteps", "maxToolCalls", "perToolTimeoutMs", "runDeadlineMs", "maxIdenticalCalls", "executionSettlementTimeoutMs"] as const) expect(document.budget[key], key).toBeLessThanOrEqual(DEFAULT_AGENT_BUDGET[key]);
      expect(document.budget.maxOutputTokens).toBe(DEFAULT_AGENT_BUDGET.maxModelSteps * SPECIALIST_CAPS.outputTokensPerStep);
      expect(Date.parse(document.deadlineAt)).toBeLessThanOrEqual(r.coordinator.startedAt + SPECIALIST_CAPS.dagWallTimeMs);
      expect(Date.parse(document.deadlineAt)).toBeGreaterThanOrEqual(before);
      expect(document.objective).toContain(MESSAGE);
      expect(document.objective.length).toBeLessThanOrEqual(1_000);
      expect(document.requiredOutputs).toEqual(["assumptions", "confidence", "evidence", "risks", "summary", "unresolvedQuestions"]);
    }
    // the ids the scheduler computes are exactly the reads the derived context advertises through the read-only registry
    const derived = deriveSpecialistContext(r.deps.context);
    // [B21 C] pin move: the set is per role now (the role's reviewed list intersected with the admitted reads); request 0 is the circuit specialist's
    expect(specialistAllowedToolIds(registry, derived, buildRunToolset, "circuit-topology")).toEqual([...(requests[0]!.record as { document: { allowedToolIds: readonly string[] } }).document.allowedToolIds]);
    expect(readOnlyToolRegistry(registry).list().map((descriptor) => descriptor.operationClass)).toEqual(readOnlyToolRegistry(registry).list().map(() => "read"));
    expect(readOnlyToolRegistry(registry)).toBe(readOnlyToolRegistry(registry)); // built once per registry
    // and every specialist run advertised reads only: no execution, no view control and no proposal (the layout proposals included)
    for (const start of r.adapter.starts) {
      for (const toolId of start.tools) expect(operationClass(toolId), `${start.role}: ${toolId}`).toBe("read");
      expect(start.tools).not.toContain("sirkit.placement.propose");
      expect(start.tools).not.toContain("sirkit.routing.propose");
    }
  });

  it("4. the derived specialist context passes the gateway's integrity check with its three availability facts false, no head mark, no PCB basis and no view, while the coordinator's context is untouched; the read-only narrowing refuses a proposal call as role_not_permitted_tool (defense in depth: with the read-only registry no proposal is even advertised) and passes a read through to the real gateway", async () => {
    // [B21 C] pin move: the verification critic reads within its own row (OD-120: board-inspect is not the critic's tool)
    const r = await rig({ "pcb-placement-routing": { kind: "call-then-result", toolId: "sirkit.pcb.board-inspect" }, "verification-critic": { kind: "call-then-result", toolId: "sirkit.pcb.revision-inspect" } });
    const coordinator = r.deps.context;
    expect(coordinator.executionGrantsAvailable).toBe(true);
    const derived = deriveSpecialistContext(coordinator);
    expect(verifyAgentContextIntegrity(derived)).toEqual([]);
    expect(derived.executionGrantsAvailable).toBe(false);
    expect(derived.externalAcquisitionAvailable).toBeUndefined();
    expect(derived.mcpObservationAvailable).toBeUndefined();
    expect(derived.schematicHeadMark).toBeNull();
    expect(derived.pcbProposalBasis).toBeNull();
    expect(derived.view).toBeNull();
    expect(derived.discovery).toMatchObject({ riskCeiling: "propose", approvalsAvailable: [], lineageId: "" });
    expect(derived.discovery.grantableCapabilities).toBeUndefined();
    expect(derived.discovery.grantLineageId).toBeUndefined();
    expect(derived.discovery.availableAuthority.filter((authority) => authority.startsWith("external"))).toEqual([]);
    expect(derived.canonicalRevisionDigest).toBe(coordinator.canonicalRevisionDigest);
    expect(derived.canonicalState).toBe(coordinator.canonicalState);
    expect(coordinator.executionGrantsAvailable).toBe(true); // never mutated
    expect(coordinator.pcbProposalBasis).not.toBeNull();
    const narrowed = readOnlySpecialistGateway(gateway, registry);
    const propose = registry.list().find((descriptor) => descriptor.toolId === "sirkit.placement.propose")!;
    expect(await narrowed.invoke({ runId: "run-x", provider: "openai", toolId: propose.toolId, version: propose.version, args: { scope: "all" }, context: derived, timeoutMs: 1_000 })).toMatchObject({ kind: "refused", ok: false, status: SPECIALIST_REFUSAL_STATUS });
    const outcome = await runSpecialistDag({ roles: ["coordinator", "pcb-placement-routing", "verification-critic"] }, r.coordinator, r.deps);
    expect(outcome.kind).toBe("ran");
    if (outcome.kind !== "ran") return;
    expect(outcome.tasks.map((task) => task.status)).toEqual(["accepted", "accepted"]);
    // the placement specialist was offered no layout proposal although the derived context keeps the verified board
    const placementStart = r.adapter.starts.find((start) => start.role === "pcb-placement-routing")!;
    expect(placementStart.tools).not.toContain("sirkit.placement.propose");
    expect(placementStart.tools).toContain("sirkit.pcb.board-inspect");
    for (const [role, tool] of [["pcb-placement-routing", "sirkit.pcb.board-inspect"], ["verification-critic", "sirkit.pcb.revision-inspect"]] as const) {
      const inspect = r.adapter.continueInputs.find((input) => input.role === role)!;
      expect(JSON.parse(inspect.results[0]!.outputText), role).toMatchObject({ ok: true, tool });
    }
    expect(outcome.tasks.map((task) => task.result?.proposedActions.length)).toEqual([0, 0]);
    expect(outcome.tasks.map((task) => task.toolCalls)).toEqual([1, 1]);
  });

  it("5. resume after a scripted provider outage: run 1 commits task 1, task 2 fails `network` twice (one attempt plus one retry) and the DAG stops; run 2 for the SAME coordinator run and scope replays task 1 from the record - its adapter is never called again - and runs task 2 at the next attempt and task 3; the store holds exactly one result for task 1", async () => {
    const first = await rig({ "component-sourcing-evidence": { kind: "throw", reason: "network", times: 2 } });
    const outcome1 = await runSpecialistDag({ roles: REPLACEMENT }, first.coordinator, first.deps);
    expect(outcome1.kind).toBe("ran");
    if (outcome1.kind !== "ran") return;
    expect(outcome1.stop).toBe("provider_outage");
    expect(outcome1.tasks.map((task) => [task.role, task.attempt, task.status])).toEqual([["circuit-topology", 0, "accepted"], ["component-sourcing-evidence", 0, "escalated"], ["component-sourcing-evidence", 1, "escalated"]]);
    expect(outcome1.tasks[1]!.reason).toMatch(/^provider_network/);
    expect(outcome1.notStarted.map((task) => task.role)).toEqual(["schematic", "verification-critic"]); // [B21 D3] pin move (OD-107 amended): the replacement DAG gained the schematic specialist (task 3, the evidence before the seal; the critic is task 4) - here read-only (no head mark in the rig)
    expect(first.adapter.count("circuit-topology")).toBe(1);
    expect(first.adapter.count("schematic")).toBe(0);
    expect(first.adapter.count("component-sourcing-evidence")).toBe(2);
    expect(first.adapter.count("verification-critic")).toBe(0);
    expect(kinds(await first.store.history(first.scope))).toEqual(["plan:0:plan", "task-1-circuit-topology:0:request", "task-1-circuit-topology:0:result", "task-2-component-sourcing-evidence:0:request", "task-2-component-sourcing-evidence:0:dissent", "task-2-component-sourcing-evidence:1:request", "task-2-component-sourcing-evidence:1:dissent"]);
    // the provider is back: a second scheduler over the same store and run id
    const second = await rig({}, { repository: first.repository, store: first.store });
    const outcome2 = await runSpecialistDag({ roles: REPLACEMENT }, second.coordinator, second.deps);
    expect(outcome2.kind).toBe("ran");
    if (outcome2.kind !== "ran") return;
    expect(outcome2.stop).toBe("completed");
    expect(outcome2.tasks.map((task) => [task.role, task.attempt, task.status])).toEqual([["circuit-topology", 0, "replayed"], ["component-sourcing-evidence", 2, "accepted"], ["schematic", 0, "accepted"], ["verification-critic", 0, "accepted"]]);
    expect(second.adapter.count("circuit-topology")).toBe(0);
    expect(second.adapter.starts.map((start) => start.role)).toEqual(["component-sourcing-evidence", "schematic", "verification-critic"]);
    const history = await second.store.history(second.scope);
    expect(history.filter((entry) => entry.taskId === "task-1-circuit-topology" && entry.record.kind === "result")).toHaveLength(1);
    expect(history.filter((entry) => entry.record.kind === "plan")).toHaveLength(1);
    expect(outcome2.tasks[0]!.resultDigest).toBe(outcome1.tasks[0]!.resultDigest);
    // a different plan for the same run id is refused, never merged into the record
    expect(await runSpecialistDag({ roles: DAG_ROLE_LISTS["manufacturing-readiness"] }, second.coordinator, second.deps)).toMatchObject({ kind: "refused", reason: "plan_mismatch" });
  });

  it("6. cancellation mid-DAG: aborting the coordinator's signal aborts the running specialist's signal, the task ends `escalated`/`cancelled` in the record, nothing further runs, and the coordinator's own grants are untouched (the scheduler never hands the minter on)", async () => {
    const r = await rig({ "component-sourcing-evidence": { kind: "hang" } });
    const minter = minterDouble();
    // the coordinator's deps carry its minter; the scheduler builds every specialist's deps WITHOUT it
    const running = runSpecialistDag({ roles: REPLACEMENT }, r.coordinator, { ...r.deps, executionGrants: minter });
    while (r.adapter.count("component-sourcing-evidence") === 0) await new Promise((resolve) => setTimeout(resolve, 5));
    r.controller.abort();
    const outcome = await running;
    expect(outcome.kind).toBe("ran");
    if (outcome.kind !== "ran") return;
    expect(outcome.stop).toBe("cancelled");
    expect(outcome.tasks.map((task) => [task.role, task.status, task.reason])).toEqual([["circuit-topology", "accepted", null], ["component-sourcing-evidence", "escalated", "cancelled"]]);
    expect(r.adapter.abortedRoles).toEqual(["component-sourcing-evidence"]);
    expect(r.adapter.count("verification-critic")).toBe(0);
    expect(r.adapter.count("schematic")).toBe(0);
    expect(outcome.notStarted.map((task) => task.role)).toEqual(["schematic", "verification-critic"]); // [B21 D3] pin move (OD-107 amended): the replacement DAG gained the schematic specialist (task 3, the evidence before the seal; the critic is task 4) - here read-only (no head mark in the rig)
    const history = await r.store.history(r.scope);
    expect(history.at(-1)!.record).toEqual({ kind: "dissent", decision: "escalated", reason: "cancelled", subjectDigest: null });
    // every specialist run was built without the minter: a cancelled loop that held one would have called retireIssued("run_cancelled", true)
    expect(minter.calls).toEqual([]);
  });

  it("7. the DAG wall time: a coordinator that starts the scheduler with almost no wall time left runs one specialist whose bounded deadline passes (`deadline` for that task), then stops `deadline` with the rest not started; a coordinator that starts the scheduler after the wall time is refused outright", async () => {
    const r = await rig({ "circuit-topology": { kind: "hang" } }, { startedAt: Date.now() - (SPECIALIST_CAPS.dagWallTimeMs - 1_100) });
    const outcome = await runSpecialistDag({ roles: REPLACEMENT }, r.coordinator, r.deps);
    expect(outcome.kind).toBe("ran");
    if (outcome.kind !== "ran") return;
    expect(outcome.stop).toBe("deadline");
    expect(outcome.tasks.map((task) => [task.role, task.status, task.reason])).toEqual([["circuit-topology", "escalated", "deadline"]]);
    expect(outcome.notStarted.map((task) => task.role)).toEqual(["component-sourcing-evidence", "schematic", "verification-critic"]); // [B21 D3] pin move (OD-107 amended): the replacement DAG gained the schematic specialist (task 3, the evidence before the seal; the critic is task 4) - here read-only (no head mark in the rig)
    expect(r.adapter.starts.map((start) => start.role)).toEqual(["circuit-topology"]);
    const requests = (await r.store.history(r.scope)).filter((entry) => entry.record.kind === "request");
    expect(requests).toHaveLength(1);
    expect((requests[0]!.record as { document: { budget: { runDeadlineMs: number } } }).document.budget.runDeadlineMs).toBeLessThanOrEqual(1_100);
    const late = await rig({}, { startedAt: Date.now() - SPECIALIST_CAPS.dagWallTimeMs });
    expect(await runSpecialistDag({ roles: REPLACEMENT }, late.coordinator, late.deps)).toMatchObject({ kind: "refused", reason: "dag_deadline_elapsed" });
    expect(late.adapter.starts).toEqual([]);
  }, 20_000);

  it("8. failures the classifier marks: `insufficient_quota` is never retried (one attempt, dissent, the DAG stops); a retryable `rate_limit` is retried exactly once and succeeds; a non-provider failure (max_steps) is dissent and the DAG continues", async () => {
    const quota = await rig({ "circuit-topology": { kind: "throw", reason: "insufficient_quota" } });
    const outcome = await runSpecialistDag({ roles: REPLACEMENT }, quota.coordinator, quota.deps);
    expect(outcome.kind).toBe("ran");
    if (outcome.kind !== "ran") return;
    expect(outcome.stop).toBe("provider_outage");
    expect(outcome.tasks.map((task) => [task.role, task.attempt, task.status, task.reason])).toEqual([["circuit-topology", 0, "escalated", "provider_insufficient_quota: the specialist run failed before a result (not retryable)"]]);
    expect(quota.adapter.count("circuit-topology")).toBe(1);
    expect(quota.adapter.starts).toHaveLength(1);
    const limited = await rig({ "circuit-topology": { kind: "throw", reason: "rate_limit", times: 1 } });
    const retried = await runSpecialistDag({ roles: REPLACEMENT }, limited.coordinator, limited.deps);
    expect(retried.kind).toBe("ran");
    if (retried.kind !== "ran") return;
    expect(retried.stop).toBe("completed");
    expect(retried.tasks.map((task) => [task.role, task.attempt, task.status])).toEqual([["circuit-topology", 0, "escalated"], ["circuit-topology", 1, "accepted"], ["component-sourcing-evidence", 0, "accepted"], ["schematic", 0, "accepted"], ["verification-critic", 0, "accepted"]]); // [B21 D3] pin move (OD-107 amended): the replacement DAG gained the schematic specialist (task 3, the evidence before the seal; the critic is task 4) - here read-only (no head mark in the rig)
    expect(limited.adapter.count("circuit-topology")).toBe(2);
    // [B21 C] pin move: the circuit specialist calls a read of its own row (OD-120: board-inspect is not its tool)
    const steps = await rig({ "circuit-topology": { kind: "call-then-result", toolId: "sirkit.validation.connectivity-verify" } });
    const exhausted = await runSpecialistDag({ roles: REPLACEMENT }, steps.coordinator, { ...steps.deps, budget: { ...DEFAULT_AGENT_BUDGET, maxModelSteps: 1 } });
    expect(exhausted.kind).toBe("ran");
    if (exhausted.kind !== "ran") return;
    expect(exhausted.stop).toBe("completed");
    expect(exhausted.tasks.map((task) => [task.role, task.status, task.reason])).toEqual([["circuit-topology", "escalated", "max_steps"], ["component-sourcing-evidence", "accepted", null], ["schematic", "accepted", null], ["verification-critic", "accepted", null]]);
  });

  it("9. a malformed final text is dissent `malformed` with a bounded reason and the DAG continues: prose, a JSON document the contracts refuse (a release named as a tool request) and a result for another role", async () => { // [B21 E1] the prose now ENDS the turn without the result tool (the B-era final-text parse is removed): see its reason below
    const r = await rig({
      "circuit-topology": { kind: "text", text: "I looked at the board and I think R1 is fine." },
      "component-sourcing-evidence": { kind: "result", extra: { requiredTools: [{ toolId: "sirkit.manufacturing.release", version: "1.0.0", reason: "ship it" }] } },
      "verification-critic": { kind: "result", role: "schematic" },
    });
    const outcome = await runSpecialistDag({ roles: REPLACEMENT }, r.coordinator, r.deps);
    expect(outcome.kind).toBe("ran");
    if (outcome.kind !== "ran") return;
    expect(outcome.stop).toBe("completed");
    // [B21 D3] pin move (OD-107 amended): the replacement DAG gained the schematic specialist (task 3, the evidence before the seal; the critic is task 4) - here read-only (no head mark in the rig): it answers a well-formed result, the other three stay malformed
    expect(outcome.tasks.map((task) => [task.role, task.status])).toEqual([["circuit-topology", "malformed"], ["component-sourcing-evidence", "malformed"], ["schematic", "accepted"], ["verification-critic", "malformed"]]);
    // [B21 E1] pin move (OD-116): prose without the strict result tool is `result_tool_not_called` (B's `result_not_json` parse is removed)
    expect(outcome.tasks[0]!.reason).toBe("result_tool_not_called: the specialist ended its turn without calling sirkit_specialist_result; a result written as text is never parsed");
    expect(outcome.tasks[1]!.reason).toBe("result_refused: tool_request_not_permitted at $.requiredTools[0].toolId");
    expect(outcome.tasks[3]!.reason).toBe("result_role_mismatch: schematic is not verification-critic");
    const dissent = (await r.store.history(r.scope)).filter((entry) => entry.record.kind === "dissent");
    expect(dissent.map((entry) => (entry.record as { decision: string }).decision)).toEqual(["malformed", "malformed", "malformed"]);
    expect(r.adapter.starts).toHaveLength(4);
    expect(validateSpecialistResult(JSON.parse(resultDocument("schematic"))).ok).toBe(true);
  });

  it("10. the store fails closed: an UNAVAILABLE store (nothing bound) refuses the DAG before any adapter call; a store that refuses the plan write refuses the DAG; a coordinator context without a verified canonical state refuses the DAG; a driver-style error's detail is REDACTED (a connection string never survives) and bounded", async () => {
    const unavailable: OrchestrationRunStore = { async revision() { throw new Error("AGENT_ORCHESTRATION_STORE_UNAVAILABLE"); }, async history() { throw new Error("AGENT_ORCHESTRATION_STORE_UNAVAILABLE"); }, async append() { throw new Error("AGENT_ORCHESTRATION_STORE_UNAVAILABLE"); } };
    const r = await rig({}, { store: unavailable });
    expect(await runSpecialistDag({ roles: REPLACEMENT }, r.coordinator, r.deps)).toEqual({ kind: "refused", reason: "store_unavailable", detail: "AGENT_ORCHESTRATION_STORE_UNAVAILABLE" });
    expect(r.adapter.starts).toEqual([]);
    const refusing = await rig({}, { runId: "run with a space" });
    expect(await runSpecialistDag({ roles: REPLACEMENT }, refusing.coordinator, refusing.deps)).toMatchObject({ kind: "refused", reason: "store_refused" });
    expect(refusing.adapter.starts).toEqual([]);
    const boardless = await rig({});
    const context = { ...boardless.deps.context, canonicalState: null, canonicalRevisionDigest: null };
    expect(await runSpecialistDag({ roles: REPLACEMENT }, boardless.coordinator, { ...boardless.deps, context })).toMatchObject({ kind: "refused", reason: "no_verified_state" });
    expect(boardless.adapter.starts).toEqual([]);
    // [review] the detail of a store failure is rendered through the redaction authority: credentials in a driver message are gone
    const connection = ["postgres", "://", "sirkit_user", ":", "hunter2", "@", "db.internal.example", ":5432/sirkit"].join("");
    const leaking: OrchestrationRunStore = { async revision() { throw new Error(`connect ECONNREFUSED ${connection}`); }, async history() { throw new Error(`connect ECONNREFUSED ${connection}`); }, async append() { throw new Error(`connect ECONNREFUSED ${connection}`); } };
    const leaky = await rig({}, { store: leaking });
    const refused = await runSpecialistDag({ roles: REPLACEMENT }, leaky.coordinator, leaky.deps);
    expect(refused).toMatchObject({ kind: "refused", reason: "store_unavailable" });
    if (refused.kind !== "refused") return;
    expect(refused.detail).not.toContain("hunter2");
    expect(refused.detail).not.toContain("sirkit_user");
    expect(refused.detail).toContain("[redacted]");
    expect(refused.detail.length).toBeLessThanOrEqual(120);
  });

  it("11. a store that loses the compare-and-set or throws AFTER a task started stops the DAG with nothing written over: the committed entries stay exactly as they were, the running task ends `escalated` (its result not committed), the next task is not started and its adapter never called", async () => {
    const conflict = (base: OrchestrationRunStore, fail: (request: OrchestrationAppendRequest) => Promise<never> | null): OrchestrationRunStore => ({
      revision: (scope) => base.revision(scope),
      history: (scope) => base.history(scope),
      append: async (request) => {
        if (request.taskId === "task-2-component-sourcing-evidence" && request.record.kind === "result") {
          const outcome = fail(request);
          if (outcome) return outcome;
          return { ok: false, code: "stale_revision", message: "The run moved to revision 9 while this write was in flight; re-read it and decide again.", currentRevision: 9 };
        }
        return base.append(request);
      },
    });
    for (const [expectedStop, fail] of [["store_conflict", () => null], ["store_unavailable", () => Promise.reject(new Error("the repository is gone"))]] as const) {
      const repository = new InMemoryDurableWorkflowRepository();
      const base = new DurableOrchestrationRunStore(repository);
      const r = await rig({}, { repository, store: conflict(base, fail) });
      const outcome = await runSpecialistDag({ roles: REPLACEMENT }, r.coordinator, r.deps);
      expect(outcome.kind, expectedStop).toBe("ran");
      if (outcome.kind !== "ran") return;
      expect(outcome.stop, expectedStop).toBe(expectedStop);
      expect(outcome.tasks.map((task) => [task.role, task.status]), expectedStop).toEqual([["circuit-topology", "accepted"], ["component-sourcing-evidence", "escalated"]]);
      expect(outcome.tasks[1]!.reason, expectedStop).toMatch(new RegExp(`^${expectedStop}: the result was not committed`));
      expect(outcome.notStarted.map((task) => task.role), expectedStop).toEqual(["schematic", "verification-critic"]); // [B21 D3] pin move (OD-107 amended): the replacement DAG gained the schematic specialist (task 3, the evidence before the seal; the critic is task 4) - here read-only (no head mark in the rig)
      expect(r.adapter.starts.map((start) => start.role), expectedStop).toEqual(["circuit-topology", "component-sourcing-evidence"]);
      expect(kinds(await base.history(r.scope)), expectedStop).toEqual(["plan:0:plan", "task-1-circuit-topology:0:request", "task-1-circuit-topology:0:result", "task-2-component-sourcing-evidence:0:request"]);
    }
  });

  it("12. a specialist's OWN deadline (bounded to the remaining wall time) is `deadline` for that task only: with wall time left the next tasks still run and the DAG completes; the hanging specialist's signal was aborted", async () => {
    const r = await rig({ "circuit-topology": { kind: "hang" } });
    const outcome = await runSpecialistDag({ roles: REPLACEMENT }, r.coordinator, { ...r.deps, budget: { ...DEFAULT_AGENT_BUDGET, runDeadlineMs: 200 } });
    expect(outcome.kind).toBe("ran");
    if (outcome.kind !== "ran") return;
    expect(outcome.stop).toBe("completed");
    // [B21 D3] pin move (OD-107 amended): the replacement DAG gained the schematic specialist (task 3, the evidence before the seal; the critic is task 4) - here read-only (no head mark in the rig)
    expect(outcome.tasks.map((task) => [task.role, task.attempt, task.status, task.reason])).toEqual([["circuit-topology", 0, "escalated", "deadline"], ["component-sourcing-evidence", 0, "accepted", null], ["schematic", 0, "accepted", null], ["verification-critic", 0, "accepted", null]]);
    expect(outcome.notStarted).toEqual([]);
    expect(r.adapter.abortedRoles).toEqual(["circuit-topology"]);
    expect(r.adapter.starts.map((start) => start.role)).toEqual(["circuit-topology", "component-sourcing-evidence", "schematic", "verification-critic"]);
    const history = await r.store.history(r.scope);
    expect(kinds(history)).toEqual(["plan:0:plan", "task-1-circuit-topology:0:request", "task-1-circuit-topology:0:dissent", "task-2-component-sourcing-evidence:0:request", "task-2-component-sourcing-evidence:0:result", "task-3-schematic:0:request", "task-3-schematic:0:result", "task-4-verification-critic:0:request", "task-4-verification-critic:0:result"]);
    expect((history[1]!.record as { document: { budget: { runDeadlineMs: number } } }).document.budget.runDeadlineMs).toBe(200);
    expect(history[2]!.record).toEqual({ kind: "dissent", decision: "escalated", reason: "deadline", subjectDigest: null });
  }, 20_000);

  it("13. resume checks the revision: a committed result whose request was bound to another scope/revision is dissent `stale` (with the stale result's digest) and the task RUNS AGAIN at the next attempt ([B21 D] one past its stale dissent), never replayed as current evidence; the same scope replays (case 5)", async () => {
    const first = await rig({});
    const outcome1 = await runSpecialistDag({ roles: REPLACEMENT }, first.coordinator, first.deps);
    expect(outcome1.kind).toBe("ran");
    if (outcome1.kind !== "ran") return;
    expect(outcome1.stop).toBe("completed");
    // the board moved: the same run id resumed against another verified revision
    const second = await rig({}, { repository: first.repository, store: first.store });
    const moved = { ...second.deps.context, canonicalRevisionDigest: `eng1-${"0".repeat(16)}` };
    const outcome2 = await runSpecialistDag({ roles: REPLACEMENT }, second.coordinator, { ...second.deps, context: moved });
    expect(outcome2.kind).toBe("ran");
    if (outcome2.kind !== "ran") return;
    expect(outcome2.stop).toBe("completed");
    // [B21 D] pin move: the re-run takes the attempt AFTER its stale dissent (2), so the merge's verdict on the re-run never shares a key
    // with the stale dissent about the old result (the durable repository replays a repeated key's first commit without comparing payloads)
    // [B21 D3] pin move (OD-107 amended): the replacement DAG gained the schematic specialist (task 3, the evidence before the seal; the critic is task 4) - here read-only (no head mark in the rig)
    expect(outcome2.tasks.map((task) => [task.role, task.attempt, task.status])).toEqual([["circuit-topology", 2, "accepted"], ["component-sourcing-evidence", 2, "accepted"], ["schematic", 2, "accepted"], ["verification-critic", 2, "accepted"]]);
    expect(second.adapter.starts.map((start) => start.role)).toEqual(["circuit-topology", "component-sourcing-evidence", "schematic", "verification-critic"]);
    const history = await second.store.history(second.scope);
    const stale = history.filter((entry) => entry.record.kind === "dissent");
    // [B21 B lead] the stale dissent is keyed by the RESUMING attempt (1), not by the committed result's (0): two resumes under two
    // other scopes then record two dissents instead of the second replaying the first under an identical idempotency key
    expect(stale.map((entry) => [entry.taskId, entry.attempt, (entry.record as { decision: string }).decision])).toEqual([["task-1-circuit-topology", 1, "stale"], ["task-2-component-sourcing-evidence", 1, "stale"], ["task-3-schematic", 1, "stale"], ["task-4-verification-critic", 1, "stale"]]);
    expect((stale[0]!.record as { reason: string; subjectDigest: string | null })).toMatchObject({ reason: expect.stringMatching(/^stale_scope: /), subjectDigest: outcome1.tasks[0]!.resultDigest });
    expect(history.filter((entry) => entry.record.kind === "result").map((entry) => [entry.taskId, entry.attempt])).toEqual([["task-1-circuit-topology", 0], ["task-2-component-sourcing-evidence", 0], ["task-3-schematic", 0], ["task-4-verification-critic", 0], ["task-1-circuit-topology", 2], ["task-2-component-sourcing-evidence", 2], ["task-3-schematic", 2], ["task-4-verification-critic", 2]]);
    expect(warningsOf(second.events).filter((message) => /is STALE/.test(message))).toHaveLength(4);
    // the new requests are bound to the moved revision
    const rebound = history.filter((entry) => entry.record.kind === "request" && entry.attempt === 2);
    expect(rebound).toHaveLength(4);
    for (const entry of rebound) expect((entry.record as { document: { scope: { canonicalRevisionDigest: string } } }).document.scope.canonicalRevisionDigest).toBe(moved.canonicalRevisionDigest);
    // [B21 B lead] a THIRD resume under a third scope: the attempt-2 results ([B21 D]; attempt 1 before) are stale in turn, the new dissents
    // land under attempt 3 (their own key) and the re-runs at attempt 4, and every earlier record stays - nothing is replayed over
    const third = await rig({}, { repository: first.repository, store: first.store });
    const movedAgain = { ...third.deps.context, canonicalRevisionDigest: `eng1-${"1".repeat(16)}` };
    const outcome3 = await runSpecialistDag({ roles: REPLACEMENT }, third.coordinator, { ...third.deps, context: movedAgain });
    expect(outcome3.kind).toBe("ran");
    if (outcome3.kind !== "ran") return;
    expect(outcome3.tasks.map((task) => [task.role, task.attempt, task.status])).toEqual([["circuit-topology", 4, "accepted"], ["component-sourcing-evidence", 4, "accepted"], ["schematic", 4, "accepted"], ["verification-critic", 4, "accepted"]]);
    const laterHistory = await third.store.history(third.scope);
    const dissents = laterHistory.filter((entry) => entry.record.kind === "dissent" && entry.taskId === "task-1-circuit-topology");
    expect(dissents.map((entry) => entry.attempt)).toEqual([1, 3]);
    expect(dissents.map((entry) => (entry.record as { reason: string }).reason)).toEqual([expect.stringMatching(/^stale_scope: /), expect.stringMatching(/^stale_scope: /)]);
    expect(dissents.map((entry) => (entry.record as { subjectDigest: string | null }).subjectDigest)).toEqual([outcome1.tasks[0]!.resultDigest, outcome2.tasks[0]!.resultDigest]);
    expect(laterHistory.filter((entry) => entry.record.kind === "result" && entry.taskId === "task-1-circuit-topology").map((entry) => entry.attempt)).toEqual([0, 2, 4]);
  });

  it("14. every attempt is measured and attributed: steps, tool calls and usage of a FAILED attempt count too (the meter sits on the adapter, not on run_completed), each outcome carries its provider and model, the DAG's used tokens sum every attempt, and a specialist's refused tool call reaches the coordinator's stream as ONE bounded warning line", async () => {
    // [B21 C] pin move: the circuit specialist calls a read of its own row (OD-120: board-inspect is not its tool)
    const r = await rig({ "circuit-topology": { kind: "call-then-throw", toolId: "sirkit.validation.connectivity-verify", reason: "network" }, "component-sourcing-evidence": { kind: "call-unknown" } });
    const outcome = await runSpecialistDag({ roles: REPLACEMENT }, r.coordinator, r.deps);
    expect(outcome.kind).toBe("ran");
    if (outcome.kind !== "ran") return;
    expect(outcome.stop).toBe("completed");
    expect(outcome.tasks.map((task) => [task.role, task.attempt, task.status, task.steps, task.toolCalls, task.usage, task.provider, task.model])).toEqual([
      ["circuit-topology", 0, "escalated", 1, 1, { inputTokens: 7, outputTokens: 11 }, "openai", "scripted"],
      ["circuit-topology", 1, "accepted", 2, 1, { inputTokens: 14, outputTokens: 22 }, "openai", "scripted"],
      ["component-sourcing-evidence", 0, "accepted", 2, 0, { inputTokens: 14, outputTokens: 22 }, "openai", "scripted"],
      ["schematic", 0, "accepted", 1, 0, { inputTokens: 7, outputTokens: 11 }, "openai", "scripted"], // [B21 D3] pin move (OD-107 amended): the replacement DAG gained the schematic specialist (task 3, the evidence before the seal; the critic is task 4) - here read-only (no head mark in the rig)
      ["verification-critic", 0, "accepted", 1, 0, { inputTokens: 7, outputTokens: 11 }, "openai", "scripted"],
    ]);
    expect(outcome.outputTokensUsed).toBe(11 + 22 + 22 + 11 + 11);
    const warnings = warningsOf(r.events);
    expect(warnings).toContain("Orchestration: specialist component-sourcing-evidence (task task-2-component-sourcing-evidence, attempt 0) tool (unknown) refused: unknown_tool.");
    expect(warnings.filter((message) => / refused: /.test(message))).toHaveLength(1);
    expect(r.events.filter((event) => event.type !== "warning" && !isOrchestrationRunEventType(event.type))).toEqual([]); // [B21 E2] pin move (OD-126): the scheduler's own status facts are the additive run events
  });
});
