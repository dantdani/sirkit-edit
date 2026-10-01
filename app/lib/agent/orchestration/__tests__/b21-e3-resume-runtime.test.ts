/**
 * [B21 E3] The route-level resume through the REAL runtime (`runOrchestratedChat`: the coordinator turn, the real scheduler, loop,
 * specialist gateway, merge and presentation rule) over runbook scenario 17's fixture catalog (`_d3-fixtures.ts`), resumed exactly as
 * the chat route resumes it: `resolveChatResume` judges the body's `resumeRunId` against the resume record (the owner, the message, the
 * provider, the plan, a finished follow-up - each a closed refusal) and `resumeChatRun` hands its grant to the runtime for THAT request.
 * A fresh DAG run records its coordinator turn BEFORE any specialist runs and its follow-up's answer after it, adding nothing to the
 * stream; a resumed run REPLAYS the first turn from the record (no model call), replays every committed specialist result bound to the
 * design the resuming request carries, re-runs one whose design moved (the scheduler's existing rule, judged by the merge against the
 * LIVE head of the resuming request - D21-17's live-head half), and makes the follow-up turn once; one side-effecting artifact per
 * userMessageDigest across resumes (OD-122's ledger): a specialist proposal already presented is never presented again, and a
 * coordinator's own artifact keeps every specialist read-only on the resume too. No network, no model.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SchematicState } from "@/lib/schematic-types";
import { sirkitToolRegistry } from "@/app/lib/engineering/tool-catalog";
import { engineeringDigest } from "@/app/lib/engineering/stable";
import { replacementHeadDigestFor } from "@/app/lib/engineering/replacement-proposal-assembler";
import { InMemoryDurableWorkflowRepository } from "@/app/lib/durable-workflow/repository";
import type { DurableAggregateIdentity, DurableAggregateRecord, DurableCommitRequest, DurableCommitResult } from "@/app/lib/durable-workflow/types";
import { assembleAgentRunContext } from "@/app/lib/agent/context";
import { createAgentToolGateway } from "@/app/lib/agent/gateway";
import { AGENT_SYSTEM_PROMPT, AGENT_SYSTEM_PROMPT_VERSION } from "@/app/lib/prompts";
import { DEFAULT_AGENT_BUDGET, type AgentRunContext, type AgentRunEvent, type AgentRunRequest, type ProviderAgentAdapter } from "@/app/lib/agent/contracts";
import { LLMProviderError } from "@/app/lib/llm/errors";
import { createEmptyBoard } from "@/app/lib/pcb/types";
import { DEFAULT_PIN_FACTS_DEADLINE_MS, loadRunReplacementPinFacts, resolveReplacementPinFactsSource } from "@/app/api/chat/replacement-facts-runtime";
import {
  CHAT_RESUME_REFUSALS, ORCHESTRATION_ENABLED_ENV, RESUME_LEASE_MS, chatResumeOf, resetOrchestrationStoreFactory, resetSpecialistSchedulerFactory, resetTaskComplexityRouterFactory, resolveChatResume, resumeChatRun, resumedRunLine,
  routerFactsOf, runOrchestratedChat, setOrchestrationStoreFactory, setSpecialistSchedulerFactory, setTaskComplexityRouterFactory, type ChatResume,
} from "@/app/api/chat/orchestration-runtime";
import { DurableOrchestrationRunStore, ORCHESTRATION_AGGREGATE_TYPE, ORCHESTRATION_RESUME_AGGREGATE_TYPE, ORCHESTRATION_RESUME_BOUNDS, orchestrationResumeAnswerDigest, orchestrationResumeStoreOf, orchestrationTraceStoreOf, type OrchestrationRunStore } from "../store";
import { specialistTraceRunId } from "../trace-attribution";
import { routeTaskComplexity } from "../router";
import { RESUME_REPLAY_APPROVAL_WINDOW_MS, requestScope, runSpecialistDag } from "../scheduler";
import { routedBoard } from "./_sealed-artifacts";
import { SPECIALIST_APPROVAL_OUTCOMES, specialistApprovalDecision, type MergeOutcome } from "../merge";
import { ToolCallingSpecialists, type SpecialistScript } from "./_d2-fixtures";
import { REPLACEMENT, SCENARIO_17, TIMER, D3_SCOPE, earlierAuthority, installCatalog, principalOf, resetCatalog, timerContext, timerEditor, type Catalog, type TimerEditor } from "./_d3-fixtures";

const REGISTRY = sirkitToolRegistry();
const FLAG_ON = { [ORCHESTRATION_ENABLED_ENV]: "1" };
const T0 = Date.parse("2026-09-27T12:00:00.000Z");
const RUN = "run-0e3b0000-0000-4000-8000-000000000001";
const REPLACE_U1 = { componentId: TIMER };
const ENVELOPE_OPENING = "ORCHESTRATION RESULTS";
const SPECIALISTS = ["circuit-topology", "component-sourcing-evidence", "schematic", "verification-critic"];
const isFollowUp = (input: { system: string; userMessage: string }): boolean => !/^Role: /m.test(input.system) && input.userMessage.startsWith(ENVELOPE_OPENING);

/** The scripted double of D2 with the conversation each start received recorded, and (optionally) a follow-up turn that fails and
 *  [B21 E3 fix] roles whose every start fails (a provider outage among the specialists). */
class Recording extends ToolCallingSpecialists {
  readonly histories: Array<{ follow: boolean; history: ReadonlyArray<{ role: string; text: string }> }> = [];
  constructor(scripts: Readonly<Record<string, SpecialistScript>> = {}, private readonly failFollowUp = false, private readonly failRoles: readonly string[] = []) { super(scripts); }
  override async start(input: Parameters<ProviderAgentAdapter["start"]>[0]) {
    this.histories.push({ follow: isFollowUp(input), history: input.history });
    if (this.failFollowUp && isFollowUp(input)) throw new LLMProviderError("openai", "overloaded");
    if (this.failRoles.includes(/^Role: ([a-z-]+)$/m.exec(input.system)?.[1] ?? "coordinator")) throw new LLMProviderError("openai", "overloaded");
    return super.start(input);
  }
}
/** The coordinator's gateway as the chat route builds it (the prompt version and the published pin-facts reads). */
function coordinatorGateway(signal: AbortSignal) {
  const source = resolveReplacementPinFactsSource();
  return createAgentToolGateway(REGISTRY, { promptVersion: AGENT_SYSTEM_PROMPT_VERSION, ...(source ? { replacementPinFacts: (atomicPartRevisionId: string, role: "current" | "target") => loadRunReplacementPinFacts(source, atomicPartRevisionId, signal, DEFAULT_PIN_FACTS_DEADLINE_MS, role) } : {}) });
}
interface ChatRun { events: AgentRunEvent[]; status: string; adapter: Recording; request: AgentRunRequest }
/** One chat request through the runtime, as the route drives it: a `resume` (from `resolveChatResume`) is handed over first. */
async function chat(context: AgentRunContext, adapter: Recording, over: { resume?: ChatResume; runId?: string; message?: string; now?: () => number; aborted?: boolean; onEvent?: (event: AgentRunEvent) => void; recordDeadlineMs?: number } = {}): Promise<ChatRun> {
  const message = over.message ?? SCENARIO_17;
  const plan = routeTaskComplexity(message, routerFactsOf(context));
  if (plan.kind !== "dag") throw new Error(`the request must route to a DAG: ${JSON.stringify(plan)}`);
  const controller = new AbortController();
  if (over.aborted) controller.abort(); // the human's Stop before anything of this request ran
  const request: AgentRunRequest = { runId: over.runId ?? RUN, provider: "openai", history: [], userMessage: message, budget: DEFAULT_AGENT_BUDGET, signal: controller.signal };
  if (over.resume) resumeChatRun(request, over.resume);
  const events: AgentRunEvent[] = [];
  const result = await runOrchestratedChat({ request, deps: { adapter, gateway: coordinatorGateway(controller.signal), registry: REGISTRY, context, system: AGENT_SYSTEM_PROMPT, emit: (event) => { events.push(event); over.onEvent?.(event); }, ...(over.now ? { now: over.now } : {}) }, plan, startedAt: over.now ? over.now() : Date.now(), ...(over.recordDeadlineMs !== undefined ? { recordDeadlineMs: over.recordDeadlineMs } : {}) });
  return { events, status: result.status, adapter, request };
}
const lines = (events: readonly AgentRunEvent[]): string[] => events.flatMap((event) => ("message" in event && typeof event.message === "string" ? [event.message] : []));
const ofType = <T extends AgentRunEvent["type"]>(events: readonly AgentRunEvent[], type: T): Array<Extract<AgentRunEvent, { type: T }>> => events.filter((event): event is Extract<AgentRunEvent, { type: T }> => event.type === type);
const artifacts = (events: readonly AgentRunEvent[]): AgentRunEvent[] => events.filter((event) => ["proposal_ready", "pcb_proposal_ready", "layout_candidate_ready", "execution_grant_ready"].includes(event.type));
const resumeOf = (context: AgentRunContext, over: { runId?: string; message?: string; provider?: "openai" | "anthropic"; environment?: Record<string, string | undefined>; deadlineMs?: number; signal?: AbortSignal; now?: () => number } = {}): Promise<ChatResume> =>
  resolveChatResume({ body: { resumeRunId: over.runId ?? RUN }, context, userMessage: over.message ?? SCENARIO_17, provider: over.provider ?? "openai", environment: over.environment ?? FLAG_ON, ...(over.deadlineMs !== undefined ? { deadlineMs: over.deadlineMs } : {}), ...(over.signal ? { signal: over.signal } : {}), ...(over.now ? { now: over.now } : {}) });
/** the durable record of the suite (the in-memory repository), bound through the runtime's store seam */
function durable(repository = new InMemoryDurableWorkflowRepository()): { store: DurableOrchestrationRunStore; repository: InMemoryDurableWorkflowRepository } {
  const store = new DurableOrchestrationRunStore(repository);
  setOrchestrationStoreFactory(() => store);
  return { store, repository };
}
/** [B21 E3 fix] the resume record's entries as committed (a replay of a key is not a write), with the terminals interleaved by the
 *  test: `settled:<n>` for a request that presented nothing, `settled:<n>+presented` for one that presented the message's artifact */
type ResumeEntry = { kind: string; ordinal?: number; presented?: boolean };
const resumeEntryOf = (request: DurableCommitRequest<object>): ResumeEntry | null => {
  const operation = request.operations.find((entry) => entry.aggregateType === ORCHESTRATION_RESUME_AGGREGATE_TYPE);
  return operation ? (operation.payload as { entry: ResumeEntry }).entry : null;
};
const labelOf = (entry: ResumeEntry): string => `${entry.kind}${entry.ordinal === undefined ? "" : `:${entry.ordinal}`}${entry.presented === true ? "+presented" : ""}`;
class ResumeRepository extends InMemoryDurableWorkflowRepository {
  readonly order: string[] = [];
  /** a resume-record commit that throws (a driver that is down) */
  fail: (entry: ResumeEntry) => boolean = () => false;
  /** a resume-record commit that never settles (a repository that hangs) */
  hang: (entry: ResumeEntry) => boolean = () => false;
  /** a resume-record commit that LANDS and then answers after this many ms (a slow acknowledgement) */
  slowAck: (entry: ResumeEntry) => number = () => 0;
  override async commit<TResult extends object = Record<string, unknown>>(request: DurableCommitRequest<TResult>): Promise<DurableCommitResult<TResult>> {
    const entry = resumeEntryOf(request);
    if (entry && this.hang(entry)) return new Promise(() => undefined);
    if (entry && this.fail(entry)) throw new Error("resume driver down: connection refused");
    const committed = await super.commit(request);
    if (entry && !committed.idempotent) this.order.push(labelOf(entry));
    const late = entry ? this.slowAck(entry) : 0;
    if (late > 0) await new Promise((resolve) => setTimeout(resolve, late));
    return committed;
  }
}
const terminalInto = (order: string[]) => (event: AgentRunEvent): void => { if (event.type === "run_completed" || event.type === "run_failed") order.push(`terminal:${event.type}`); };
const codeOf = (resume: ChatResume): string => (resume.kind === "refused" ? resume.code : resume.kind);
const recordOf = async (store: DurableOrchestrationRunStore, runId = RUN): Promise<string[]> => (await orchestrationResumeStoreOf(store)!.history({ ...D3_SCOPE, runId })).map((entry) => labelOf(entry.entry as ResumeEntry));
/** [B21 E3 fix: security-2] the scenario's context over a routed board, one of its tracks selected or not: the SAME design (scope and
 *  revision equal) under another selection */
function boardContext(editor: TimerEditor, authority: Catalog["authority"], live: Awaited<ReturnType<typeof principalOf>>, selected: boolean): AgentRunContext {
  const board = routedBoard();
  const assembly = assembleAgentRunContext({
    ...D3_SCOPE, schematic: editor.visible(), board, schematicHeadMark: editor.editor.headMark(), componentAuthority: authority,
    selection: selected ? { refs: [{ kind: "track", id: "t-auto-1" }], primary: { kind: "track", id: "t-auto-1" } } : { refs: [], primary: null },
    verifiedActor: { principalId: live.principalId, actorRole: live.role, membershipRevision: live.membershipRevision, authMethod: "local_dev" },
  });
  if (!assembly.ok) throw new Error(assembly.reason);
  return assembly.context;
}
/** the scenario's schematic with one unrelated label added: the design MOVED (a new head), U1 and its wire untouched */
function movedContext(editor: TimerEditor, catalog: Catalog, live: Awaited<ReturnType<typeof principalOf>>): AgentRunContext {
  const moved: SchematicState = { ...editor.visible(), netLabels: [{ id: "label-e3", position: { x: 900, y: 900 }, name: "AUX1", kind: "label", orientation: 0 }] };
  const mark = editor.editor.headMark()!;
  const assembly = assembleAgentRunContext({
    ...D3_SCOPE, schematic: moved, board: createEmptyBoard(), selection: { refs: [], primary: null }, componentAuthority: catalog.authority,
    schematicHeadMark: { lineageId: mark.lineageId, headSequence: mark.headSequence + 1, canonicalStateDigest: replacementHeadDigestFor(moved, D3_SCOPE) },
    verifiedActor: { principalId: live.principalId, actorRole: live.role, membershipRevision: live.membershipRevision, authMethod: "local_dev" },
  });
  if (!assembly.ok) throw new Error(assembly.reason);
  return assembly.context;
}

describe("[B21 E3] the route-level resume through the real runtime", () => {
  let catalog: Catalog;
  let live: Awaited<ReturnType<typeof principalOf>>;
  let editor: TimerEditor;
  let context: AgentRunContext;
  beforeEach(async () => {
    vi.stubEnv("DATABASE_URL", "");
    catalog = await installCatalog();
    live = await principalOf();
    editor = await timerEditor();
    context = timerContext(editor, catalog.authority, live);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    resetCatalog();
    resetOrchestrationStoreFactory();
    resetTaskComplexityRouterFactory();
    resetSpecialistSchedulerFactory();
  });

  it("1. a FRESH DAG run records its coordinator turn on the resume record BEFORE any specialist is planned or run, and its follow-up's answer after the merge - and adds NOTHING to the stream: the same run over a record with no resume store streams the same events", async () => {
    const repository = new (class extends InMemoryDurableWorkflowRepository {
      readonly order: string[] = [];
      override async commit<TResult extends object = Record<string, unknown>>(request: DurableCommitRequest<TResult>): Promise<DurableCommitResult<TResult>> {
        for (const operation of request.operations) this.order.push(operation.aggregateType === ORCHESTRATION_RESUME_AGGREGATE_TYPE ? `resume:${(operation.payload as { entry: { kind: string } }).entry.kind}` : operation.aggregateType === ORCHESTRATION_AGGREGATE_TYPE ? `run:${(operation.payload as { record: { kind: string } }).record.kind}` : "trace");
        return super.commit(request);
      }
    })();
    const { store } = durable(repository);
    const fresh = await chat(context, new Recording(), { now: () => T0 });
    expect(fresh.status).toBe("completed");
    expect(repository.order[0]).toBe("resume:coordinator");
    expect(repository.order.indexOf("resume:coordinator")).toBeLessThan(repository.order.indexOf("run:plan"));
    expect(repository.order.at(-1)).toBe("resume:follow-up");
    expect(repository.order.filter((entry) => entry.startsWith("resume:"))).toEqual(["resume:coordinator", "resume:follow-up"]);
    const resume = orchestrationResumeStoreOf(store)!;
    const [recorded] = await resume.history({ ...D3_SCOPE, runId: RUN });
    expect(recorded!.entry).toMatchObject({ kind: "coordinator", provider: "openai", answer: "(scripted) the coordinator's coordinator turn.", answerWithheld: null, artifacts: [] });
    // the same run over a store DOUBLE (no durable record: no resume store) - its stream is the fresh run's, event for event
    const base = new DurableOrchestrationRunStore(new InMemoryDurableWorkflowRepository());
    const double: OrchestrationRunStore = { revision: (scope) => base.revision(scope), history: (scope) => base.history(scope), append: (request) => base.append(request) };
    setOrchestrationStoreFactory(() => double);
    const plain = await chat(context, new Recording(), { now: () => T0 });
    expect(plain.events.map((event) => event.type)).toEqual(fresh.events.map((event) => event.type));
    expect(lines(plain.events)).toEqual(lines(fresh.events));
  });

  it("2. `resolveChatResume` - the flag off, an absent or null key: a fresh run; otherwise a CLOSED refusal in this order: malformed, unavailable (a hanging or aborted read - for now), unusable ([B21 E3 fix: coverage-7] no durable record, tampered storage - for good), unknown (no record in THIS project), foreign (another principal), mismatch (another message or provider), plan changed, completed, in progress; a granted resume has CLAIMED its start (the next resolution, before it runs, is in progress)", async () => {
    expect(Object.entries(CHAT_RESUME_REFUSALS).map(([code, refusal]) => [code, refusal.status])).toEqual([["resume_malformed", 400], ["resume_unavailable", 503], ["resume_unusable", 409], ["resume_unknown", 404], ["resume_foreign", 403], ["resume_mismatch", 409], ["resume_plan_changed", 409], ["resume_completed", 409], ["resume_in_progress", 409]]);
    const code = (resume: ChatResume): string => (resume.kind === "refused" ? resume.code : resume.kind);
    const { repository } = durable();
    await chat(context, new Recording({}, true)); // a stood-down run: its follow-up failed, its record holds the coordinator turn
    expect(code(await resumeOf(context, { environment: {} }))).toBe("fresh");
    expect(code(await resolveChatResume({ body: {}, context, userMessage: SCENARIO_17, provider: "openai", environment: FLAG_ON }))).toBe("fresh");
    expect(code(await resolveChatResume({ body: { resumeRunId: null }, context, userMessage: SCENARIO_17, provider: "openai", environment: FLAG_ON }))).toBe("fresh");
    for (const malformed of [42, "run-1", RUN.toUpperCase(), `${RUN}0`, "task-1-schematic", ["sk-", "ant-", "x".repeat(40)].join(""), ` ${RUN}`, { runId: RUN }]) {
      expect(code(await resolveChatResume({ body: { resumeRunId: malformed }, context, userMessage: SCENARIO_17, provider: "openai", environment: FLAG_ON })), String(malformed)).toBe("resume_malformed");
    }
    expect(code(await resumeOf(context, { runId: "run-0e3b0000-0000-4000-8000-00000000ffff" }))).toBe("resume_unknown");
    const elsewhere = timerContext(await timerEditor({ ...D3_SCOPE, projectId: "project-e3-other" }), null, live, { ...D3_SCOPE, projectId: "project-e3-other" });
    expect(code(await resumeOf(elsewhere))).toBe("resume_unknown"); // the lookup is scoped: another project's run is never found
    expect(code(await resumeOf(timerContext(editor, catalog.authority, { ...live, principalId: "human-e3-other" })))).toBe("resume_foreign");
    expect(code(await resumeOf(context, { message: "Replace the NE555 timer U1 with a CMOS timer." }))).toBe("resume_mismatch");
    expect(code(await resumeOf(context, { provider: "anthropic" }))).toBe("resume_mismatch");
    setTaskComplexityRouterFactory(() => () => ({ kind: "single", rule: "e3-fixture" }));
    expect(code(await resumeOf(context))).toBe("resume_plan_changed");
    setTaskComplexityRouterFactory(() => () => ({ kind: "dag", rule: "e3-fixture", roles: ["coordinator", "circuit-topology"] }));
    expect(code(await resumeOf(context))).toBe("resume_plan_changed");
    resetTaskComplexityRouterFactory();
    const granted = await resumeOf(context);
    expect(code(granted)).toBe("resume");
    expect(code(await resumeOf(context))).toBe("resume_in_progress"); // the grant claimed its start; it has not run (or settled) yet
    // the record unavailable: a store double (no resume store), a read that hangs (bounded by the deadline), an aborted request, tampering
    const base = new DurableOrchestrationRunStore(repository);
    setOrchestrationStoreFactory(() => ({ revision: (scope) => base.revision(scope), history: (scope) => base.history(scope), append: (request) => base.append(request) }));
    expect(code(await resumeOf(context))).toBe("resume_unusable"); // [B21 E3 fix: coverage-7] no durable record bound: for good
    const hanging = new InMemoryDurableWorkflowRepository();
    hanging.history = (() => new Promise(() => undefined)) as typeof hanging.history;
    setOrchestrationStoreFactory(() => new DurableOrchestrationRunStore(hanging));
    const started = Date.now();
    expect(code(await resumeOf(context, { deadlineMs: 50 }))).toBe("resume_unavailable");
    expect(Date.now() - started).toBeLessThan(5_000);
    const aborted = new AbortController();
    aborted.abort();
    durable(repository);
    expect(code(await resumeOf(context, { signal: aborted.signal }))).toBe("resume_unavailable");
    const tampered = new InMemoryDurableWorkflowRepository();
    tampered.history = (async (identity: Parameters<InMemoryDurableWorkflowRepository["history"]>[0]) => (await repository.history<Record<string, unknown>>(identity)).map((record) => ({ ...record, payload: { ...record.payload, runId: "run-0e3b0000-0000-4000-8000-00000000eeee" } }))) as typeof tampered.history;
    setOrchestrationStoreFactory(() => new DurableOrchestrationRunStore(tampered));
    expect(code(await resumeOf(context))).toBe("resume_unusable"); // [B21 E3 fix: coverage-7] a record that fails verification: for good
    // completed: the granted resume runs, its follow-up answers and closes the run - a further resume is refused
    durable(repository);
    await chat(context, new Recording(), { resume: granted });
    expect(code(await resumeOf(context))).toBe("resume_completed");
  });

  it("3. a RESUMED run replays the coordinator's first turn from the record - no model call for it: run_started first, the resume line, the recorded answer as ONE final text - replays every committed specialist result (none runs again), makes the follow-up turn ONCE over the replayed answer, and its one terminal counts only this request's own steps", async () => {
    durable();
    const first = await chat(context, new Recording({}, true));
    expect(ofType(first.events, "degraded").map((event) => event.reason)).toEqual(["follow_up_failed"]);
    const firstAnswer = "(scripted) the coordinator's coordinator turn.";
    expect(ofType(first.events, "text_delta").map((event) => event.text)).toEqual([firstAnswer]);
    const resume = await resumeOf(context);
    expect(resume).toMatchObject({ kind: "resume", runId: RUN });
    if (resume.kind !== "resume") return;
    const adapter = new Recording({ coordinator: { text: "(scripted) the follow-up answers from the replayed results." } });
    const resumed = await chat(context, adapter, { resume });
    expect(resumed.status).toBe("completed");
    // no model call for the first turn and none for any specialist: the ONE start is the follow-up turn
    expect(adapter.starts.map((start) => start.role)).toEqual(["coordinator"]);
    expect(adapter.starts[0]!.userMessage.startsWith(ENVELOPE_OPENING)).toBe(true);
    expect(adapter.histories).toHaveLength(1);
    expect(adapter.histories[0]!.history).toEqual([{ role: "user", text: SCENARIO_17 }, { role: "assistant", text: firstAnswer }]);
    // the stream: run_started first, the resume line, the replayed answer, the replays, the follow-up's answer, one terminal
    expect(resumed.events[0]).toEqual({ type: "run_started", runId: RUN, provider: "openai" });
    expect(resumed.events[1]).toEqual({ type: "warning", runId: RUN, message: resumedRunLine(RUN, resume.grant) });
    expect(resumed.events[2]).toEqual({ type: "text_delta", runId: RUN, text: firstAnswer, phase: "final" });
    expect(resumedRunLine(RUN, resume.grant).length).toBeLessThanOrEqual(300);
    expect(ofType(resumed.events, "run_started")).toHaveLength(1);
    expect(lines(resumed.events).filter((line) => line.startsWith("Orchestration: specialist ") && line.includes("replayed from the record"))).toHaveLength(4);
    expect(ofType(resumed.events, "specialist_started")).toEqual([]);
    const terminals = resumed.events.filter((event) => event.type === "run_completed" || event.type === "run_failed");
    expect(terminals.map((event) => event.type)).toEqual(["run_completed"]);
    expect(terminals[0]).toMatchObject({ steps: 1, toolCalls: 0, usage: { inputTokens: 2, outputTokens: 3 } });
    expect(ofType(resumed.events, "text_delta").map((event) => event.text)).toEqual([firstAnswer, "(scripted) the follow-up answers from the replayed results."]);
    // the follow-up's answer is recorded: the run is finished
    expect(await resumeOf(context)).toMatchObject({ kind: "refused", code: "resume_completed" });
  });

  it("4. ONE side-effecting artifact per userMessageDigest across resumes (OD-122's ledger): the schematic specialist's replacement is presented ONCE by the first request; the resume replays its seal, the merge accepts it again - and NOTHING is presented (`already_presented`, the withheld line, the envelope); the resume record holds that one claim; `already_presented` only ever takes the place of `presented`", async () => {
    const { store } = durable();
    const first = await chat(context, new Recording({ schematic: { call: { toolId: REPLACEMENT, args: REPLACE_U1 } } }, true));
    expect(artifacts(first.events).map((event) => event.type)).toEqual(["proposal_ready"]);
    const resume = await resumeOf(context);
    if (resume.kind !== "resume") throw new Error(JSON.stringify(resume));
    const adapter = new Recording();
    const resumed = await chat(context, adapter, { resume });
    expect(adapter.starts.map((start) => start.role)).toEqual(["coordinator"]);
    expect(artifacts(resumed.events)).toEqual([]);
    expect(lines(resumed.events).some((line) => line.startsWith("Orchestration: nothing from the specialists is presented for approval (already_presented):"))).toBe(true);
    expect(lines(resumed.events).some((line) => line.startsWith("Orchestration: presented for approval"))).toBe(false);
    expect(adapter.starts[0]!.userMessage).toContain('"approval":{"outcome":"already_presented","presented":null}');
    const claims = (await orchestrationResumeStoreOf(store)!.history({ ...D3_SCOPE, runId: RUN })).filter((entry) => entry.entry.kind === "artifact");
    expect(claims).toHaveLength(1);
    expect(claims[0]!.entry).toMatchObject({ kind: "artifact", taskId: "task-3-schematic", attempt: 0, actionIndex: 0, artifactKind: "sirkit.schematic-replacement-proposal.v2" });
    // the pure rule: the closed list ends with it; it replaces `presented` and nothing else
    expect(SPECIALIST_APPROVAL_OUTCOMES.at(-1)).toBe("already_presented");
    const merged = { kind: "merged", tasks: [], accepted: [{ provenance: "sealed-in-run" }], escalations: [], reviewRequests: [] } as unknown as Extract<MergeOutcome, { kind: "merged" }>;
    const outcome = { kind: "ran", tasks: [], notStarted: [], stop: "completed", outputTokenCeiling: 0, outputTokensUsed: 0 } as never;
    expect(specialistApprovalDecision(merged, { coordinatorSealed: false, outcome }).outcome).toBe("presented");
    expect(specialistApprovalDecision(merged, { coordinatorSealed: false, alreadyPresented: true, outcome }).outcome).toBe("already_presented");
    expect(specialistApprovalDecision(merged, { coordinatorSealed: true, alreadyPresented: true, outcome }).outcome).toBe("coordinator_sealed");
    expect(specialistApprovalDecision({ ...merged, escalations: [{}] } as never, { coordinatorSealed: false, alreadyPresented: true, outcome }).outcome).toBe("escalated");
    expect(specialistApprovalDecision({ ...merged, reviewRequests: [{}] } as never, { coordinatorSealed: false, alreadyPresented: true, outcome }).outcome).toBe("review_requested");
    expect(specialistApprovalDecision({ ...merged, accepted: [] } as never, { coordinatorSealed: false, alreadyPresented: true, outcome }).outcome).toBe("none_accepted");
  });

  it("5. the COORDINATOR's own artifact across resumes: its first turn seals the replacement (recorded with its turn) and every specialist stays read-only; the resume emits no artifact at all (the replay never re-emits the coordinator's), keeps every specialist read-only (the held-artifact notice) and answers `coordinator_sealed`", async () => {
    const { store } = durable();
    const first = await chat(context, new Recording({ coordinator: { call: { toolId: REPLACEMENT, args: REPLACE_U1 } } }, true));
    expect(artifacts(first.events).map((event) => event.type)).toEqual(["proposal_ready"]);
    expect(ofType(first.events, "degraded").map((event) => event.reason)).toEqual(["coordinator_artifact_held", "follow_up_failed"]);
    const [turn] = await orchestrationResumeStoreOf(store)!.history({ ...D3_SCOPE, runId: RUN });
    expect(turn!.entry).toMatchObject({ kind: "coordinator", artifacts: ["proposal_ready"] });
    const resume = await resumeOf(context);
    if (resume.kind !== "resume") throw new Error(JSON.stringify(resume));
    expect(resume.grant.artifacts).toEqual(["proposal_ready"]);
    const adapter = new Recording();
    const resumed = await chat(context, adapter, { resume });
    expect(artifacts(resumed.events)).toEqual([]);
    expect(ofType(resumed.events, "degraded").map((event) => event.reason)).toEqual(["coordinator_artifact_held"]);
    expect(adapter.starts[0]!.userMessage).toContain('"approval":{"outcome":"coordinator_sealed","presented":null}');
  });

  it("6. the merge judges the LIVE head of the RESUMING request, never the first request's snapshot (D21-17's live-head half): after the design moved, every committed result is STALE and its specialist runs again against the new head (the scheduler's existing rule), the merge's scope IS the new head's, and the one proposal sealed against it is presented - the ledger held nothing yet; each re-run specialist's calls land in its task's next trace document; under an unmoved design the same resume replays (the contrast)", async () => {
    const { store } = durable();
    await chat(context, new Recording({}, true));
    const moved = movedContext(editor, catalog, live);
    expect(engineeringDigest(requestScope(moved))).not.toBe(engineeringDigest(requestScope(context)));
    const resume = await resumeOf(moved);
    if (resume.kind !== "resume") throw new Error(JSON.stringify(resume));
    const adapter = new Recording({ schematic: { call: { toolId: REPLACEMENT, args: REPLACE_U1 } } });
    const resumed = await chat(moved, adapter, { resume });
    expect(adapter.starts.map((start) => start.role)).toEqual([...SPECIALISTS, "coordinator"]);
    expect(lines(resumed.events).filter((line) => line.includes("is STALE"))).toHaveLength(4);
    expect(ofType(resumed.events, "specialist_finished").filter((event) => event.status === "stale")).toHaveLength(4);
    const envelope = adapter.starts.at(-1)!.userMessage;
    expect(envelope).toContain(`"scopeDigest":"${engineeringDigest(requestScope(moved))}"`);
    expect(envelope).not.toContain(`"scopeDigest":"${engineeringDigest(requestScope(context))}"`);
    expect(artifacts(resumed.events).map((event) => event.type)).toEqual(["proposal_ready"]);
    // each specialist that ran again opened its task's NEXT trace document (its calls on the durable record, D21-3), beside the first request's
    const traced = await orchestrationTraceStoreOf(store)!.history(D3_SCOPE, specialistTraceRunId(RUN, 1, "circuit-topology"));
    expect(traced).toHaveLength(2);
    expect(new Set(traced.map((entry) => entry.record.traceId)).size).toBe(2);
    // the contrast: a second stood-down run under ONE design - its resume replays all four
    const again = "run-0e3b0000-0000-4000-8000-000000000002";
    await chat(context, new Recording({}, true), { runId: again });
    const same = await resumeOf(context, { runId: again });
    if (same.kind !== "resume") throw new Error(JSON.stringify(same));
    const replayed = new Recording();
    const sameRun = await chat(context, replayed, { resume: same, runId: again });
    expect(replayed.starts.map((start) => start.role)).toEqual(["coordinator"]);
    expect(lines(sameRun.events).filter((line) => line.startsWith("Orchestration: specialist ") && line.includes("replayed from the record"))).toHaveLength(4);
  });

  it("7. a coordinator turn that cannot be recorded STANDS DOWN before any specialist (the run could never be resumed): no specialist planned or run, B21-B's degraded line with the scheduler's closed store reason, the first answer the one terminal; an answer the record WITHHOLDS (a credential-shaped value) still records the turn - its resume replays no text, and the follow-up's conversation carries the closed placeholder", async () => {
    const failing = new (class extends InMemoryDurableWorkflowRepository {
      override async commit<TResult extends object = Record<string, unknown>>(request: DurableCommitRequest<TResult>): Promise<DurableCommitResult<TResult>> {
        if (request.operations.some((operation) => operation.aggregateType === ORCHESTRATION_RESUME_AGGREGATE_TYPE)) throw new Error("resume driver down: connection refused");
        return super.commit(request);
      }
    })();
    durable(failing);
    const adapter = new Recording();
    const down = await chat(context, adapter);
    expect(adapter.starts.map((start) => start.role)).toEqual(["coordinator"]);
    expect(ofType(down.events, "plan")).toEqual([]);
    expect(ofType(down.events, "degraded").map((event) => [event.reason, event.message])).toEqual([["no_specialist_ran", "Orchestration: no specialist ran (store_unavailable); the assistant's answer above stands."]]);
    expect(lines(down.events).join(" ")).not.toContain("connection refused");
    expect(down.events.at(-1)).toMatchObject({ type: "run_completed", finalText: "(scripted) the coordinator's coordinator turn." });
    // a withheld answer
    durable();
    const secret = `(scripted) the key is ${["sk-", "ant-api03-", "B".repeat(40)].join("")}.`;
    await chat(context, new Recording({ coordinator: { text: secret } }, true));
    const resume = await resumeOf(context);
    if (resume.kind !== "resume") throw new Error(JSON.stringify(resume));
    expect(resume.grant).toMatchObject({ answer: null, answerWithheld: "answer_refused" });
    expect(resumedRunLine(RUN, resume.grant)).toContain("the first answer is not replayed (answer_refused)");
    expect(resumedRunLine(RUN, { answer: null, answerWithheld: "answer_too_long" }).length).toBeLessThanOrEqual(300); // whole on the coordinator's trace (its 300-character warning bound)
    const replay = new Recording();
    const resumed = await chat(context, replay, { resume });
    expect(ofType(resumed.events, "text_delta").map((event) => event.text)).not.toContain(secret);
    expect(JSON.stringify(resumed.events)).not.toContain(secret);
    expect(replay.histories[0]!.history.at(-1)).toEqual({ role: "assistant", text: "(The coordinator's first answer of this run was not recorded (answer_refused) and is not replayed.)" });
  });

  it("8. the grant is the route's for THAT request only: a grant for another run id is ignored (the first turn runs), a fresh or refused resolution hands nothing over", async () => {
    durable();
    await chat(context, new Recording({}, true));
    const resume = await resumeOf(context);
    if (resume.kind !== "resume") throw new Error(JSON.stringify(resume));
    const other: AgentRunRequest = { runId: "run-0e3b0000-0000-4000-8000-000000000003", provider: "openai", history: [], userMessage: SCENARIO_17, budget: DEFAULT_AGENT_BUDGET };
    resumeChatRun(other, resume);
    expect(chatResumeOf(other)).toBeNull();
    const fresh: AgentRunRequest = { ...other };
    resumeChatRun(fresh, { kind: "fresh" });
    resumeChatRun(fresh, { kind: "refused", code: "resume_unknown", ...CHAT_RESUME_REFUSALS.resume_unknown });
    expect(chatResumeOf(fresh)).toBeNull();
    const adapter = new Recording();
    await chat(context, adapter, { runId: other.runId, resume });
    expect(adapter.starts[0]).toMatchObject({ role: "coordinator", userMessage: SCENARIO_17 }); // the grant was ignored: the first turn RAN
  });

  it("9. ONE request of a run at a time: every request's START is on the resume record (a fresh run's coordinator entry, a resume's claimed `resume` entry) and every way it ends SETTLES it before its terminal is emitted (a completed follow-up's entry, a stand-down's or a cancellation's `settled`); a resume while another request of the run is unsettled is `resume_in_progress` - until it settles, or its start is RESUME_LEASE_MS old (a request that died unsettled); two resumes resolved together from one head: exactly one is granted; no specialist or follow-up of a refused resume runs", async () => {
    const repository = new (class extends InMemoryDurableWorkflowRepository {
      readonly order: string[] = [];
      override async commit<TResult extends object = Record<string, unknown>>(request: DurableCommitRequest<TResult>): Promise<DurableCommitResult<TResult>> {
        const committed = await super.commit(request);
        for (const operation of request.operations) if (operation.aggregateType === ORCHESTRATION_RESUME_AGGREGATE_TYPE && !committed.idempotent) { const entry = (operation.payload as { entry: { kind: string; ordinal?: number } }).entry; this.order.push(`${entry.kind}${entry.ordinal === undefined ? "" : `:${entry.ordinal}`}`); }
        return committed;
      }
    })();
    const { store } = durable(repository);
    const terminal = (event: AgentRunEvent): void => { if (event.type === "run_completed" || event.type === "run_failed") repository.order.push(`terminal:${event.type}`); };
    const code = (resume: ChatResume): string => (resume.kind === "refused" ? resume.code : resume.kind);
    // a fresh run that STANDS DOWN settles its start (ordinal 0) before its terminal
    await chat(context, new Recording({}, true), { now: () => T0, onEvent: terminal });
    expect(repository.order).toEqual(["coordinator", "settled:0", "terminal:run_completed"]);
    // a granted resume CLAIMED its start: until it settles, every other resume is in progress (no model call, nothing written)
    const first = await resumeOf(context, { now: () => T0 + 1_000 });
    expect(first).toMatchObject({ kind: "resume", grant: { ordinal: 1 } });
    expect(code(await resumeOf(context, { now: () => T0 + 2_000 }))).toBe("resume_in_progress");
    expect(code(await resumeOf(context, { now: () => T0 + 1_000 + RESUME_LEASE_MS - 1 }))).toBe("resume_in_progress");
    // that request died without settling (it never ran): once its start is RESUME_LEASE_MS old the run can be resumed again
    const second = await resumeOf(context, { now: () => T0 + 1_000 + RESUME_LEASE_MS });
    expect(second).toMatchObject({ kind: "resume", grant: { ordinal: 2 } });
    // the second request stands down again: settled before its terminal
    const adapter = new Recording({}, true);
    await chat(context, adapter, { resume: second, now: () => T0 + 2_000 + RESUME_LEASE_MS, onEvent: terminal });
    expect(repository.order.slice(3)).toEqual(["resume:1", "resume:2", "settled:2", "terminal:run_completed"]);
    // two resumes resolved together from one head: exactly one is granted, the other is in progress
    const together = await Promise.all([resumeOf(context, { now: () => T0 + 3_000 + RESUME_LEASE_MS }), resumeOf(context, { now: () => T0 + 3_000 + RESUME_LEASE_MS })]);
    expect(together.map(code).sort()).toEqual(["resume", "resume_in_progress"]);
    const granted = together.find((resume) => resume.kind === "resume")!;
    expect(granted).toMatchObject({ grant: { ordinal: 3 } });
    // the granted request is CANCELLED (the human's Stop) before any specialist: it settles too, and the run can be resumed at once
    const stopped = await chat(context, new Recording(), { resume: granted, aborted: true, now: () => T0 + 4_000 + RESUME_LEASE_MS, onEvent: terminal });
    expect(stopped.status).toBe("cancelled");
    expect(stopped.adapter.starts).toEqual([]);
    expect(repository.order.slice(-3)).toEqual(["resume:3", "settled:3", "terminal:run_failed"]);
    expect(code(await resumeOf(context, { now: () => T0 + 5_000 + RESUME_LEASE_MS }))).toBe("resume");
    const history = await orchestrationResumeStoreOf(store)!.history({ ...D3_SCOPE, runId: RUN });
    expect(history.map((entry) => `${entry.entry.kind}${"ordinal" in entry.entry ? `:${entry.entry.ordinal}` : ""}`)).toEqual(["coordinator", "settled:0", "resume:1", "resume:2", "settled:2", "resume:3", "settled:3", "resume:4"]);
  });

  it("10. [B21 E3 fix: regressions-1, tests-1] a ledger claim that cannot be written stands the run down AFTER the merge judged: the partial result counts what the merge withheld (never null), the stand-down line names the CLAIM (never \"the merge could not record its decisions\" - the merge did), nothing is presented, no follow-up turn is made and the request's end - nothing presented - is settled before its terminal; the next resume claims afresh and presents the artifact exactly once", async () => {
    const repository = new ResumeRepository();
    repository.fail = (entry) => entry.kind === "artifact";
    const { store } = durable(repository);
    const scripts = { schematic: { call: { toolId: REPLACEMENT, args: REPLACE_U1 } }, "verification-critic": { text: "not a result document" } };
    const adapter = new Recording(scripts);
    const first = await chat(context, adapter, { onEvent: terminalInto(repository.order) });
    expect(adapter.starts.map((start) => start.role)).toEqual(["coordinator", ...SPECIALISTS]); // no follow-up turn
    expect(ofType(first.events, "degraded").map((event) => [event.reason, event.message])).toEqual([["merge_unrecorded", "Orchestration: the user message's one artifact could not be claimed on the run's resume record (store_unavailable); nothing was presented, no follow-up turn was made and the assistant's answer above stands."]]);
    expect(lines(first.events).join(" ")).not.toContain("the merge could not record its decisions");
    expect(lines(first.events).join(" ")).not.toContain("connection refused");
    expect(artifacts(first.events)).toEqual([]);
    expect(ofType(first.events, "partial_result")).toMatchObject([{ planned: 4, usable: 3, unusable: 1, mergeWithheld: 0, handedOn: false }]); // judged by the merge: its verdicts stand
    expect(repository.order).toEqual(["coordinator", "settled:0", "terminal:run_completed"]);
    // the store heals; the resume replays the seal, the merge accepts it again, the claim is fresh: presented ONCE
    repository.fail = () => false;
    const resume = await resumeOf(context);
    expect(resume).toMatchObject({ kind: "resume", grant: { ordinal: 1 } });
    const resumed = await chat(context, new Recording(scripts), { resume });
    expect(artifacts(resumed.events).map((event) => event.type)).toEqual(["proposal_ready"]);
    expect((await recordOf(store)).filter((entry) => entry.startsWith("artifact"))).toEqual(["artifact:1"]);
  });

  it("11. [B21 E3 fix: tests-1, coverage-7] every other record write that fails is VISIBLE: a follow-up answer that cannot be recorded is one line (\"a resume of this run would answer again\") and the request's start is settled instead - a resume is then granted; an end that cannot be recorded is one line BEFORE the terminal and the lease holds the run; a start claim that cannot be written is `resume_unavailable` (its end marked, so a claim landing late never holds the run); a claim the record refuses - the run's bound of requests reached - is `resume_unusable`", async () => {
    // (a) the follow-up's entry
    const answered = new ResumeRepository();
    answered.fail = (entry) => entry.kind === "follow-up";
    durable(answered);
    const run = await chat(context, new Recording({ coordinator: { text: "(scripted) first." }, "coordinator-2": { text: "(scripted) the follow-up answers." } }), { onEvent: terminalInto(answered.order) });
    expect(run.status).toBe("completed");
    expect(lines(run.events)).toContain("Orchestration: the follow-up turn's answer could not be recorded (store_unavailable); a resume of this run would answer again.");
    expect(run.events.at(-1)).toMatchObject({ type: "run_completed", finalText: "(scripted) the follow-up answers." });
    expect(answered.order).toEqual(["coordinator", "settled:0", "terminal:run_completed"]);
    answered.fail = () => false;
    expect(codeOf(await resumeOf(context))).toBe("resume"); // not finished on the record: a resume answers again
    // (b) the end
    const ended = new ResumeRepository();
    ended.fail = (entry) => entry.kind === "settled";
    durable(ended);
    const down = await chat(context, new Recording({}, true), { runId: "run-0e3b0000-0000-4000-8000-000000000b11", now: () => T0 });
    const unsettled = "Orchestration: the end of this request could not be recorded (store_unavailable); the run can be resumed once this request's start is 10 minutes old.";
    const at = down.events.findIndex((event) => event.type === "warning" && event.message === unsettled);
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(down.events.findIndex((event) => event.type === "run_completed"));
    ended.fail = () => false;
    expect(codeOf(await resumeOf(context, { runId: "run-0e3b0000-0000-4000-8000-000000000b11", now: () => T0 + 1_000 }))).toBe("resume_in_progress");
    expect(codeOf(await resumeOf(context, { runId: "run-0e3b0000-0000-4000-8000-000000000b11", now: () => T0 + RESUME_LEASE_MS }))).toBe("resume");
    // (c) the start claim
    const claims = new ResumeRepository();
    durable(claims);
    await chat(context, new Recording({}, true));
    claims.fail = (entry) => entry.kind === "resume";
    expect(codeOf(await resumeOf(context))).toBe("resume_unavailable");
    expect(claims.order.filter((entry) => entry.startsWith("resume"))).toEqual([]);
    claims.fail = () => false;
    expect(await resumeOf(context)).toMatchObject({ kind: "resume", grant: { ordinal: 2 } }); // ordinal 1's end was marked: never reused
    // (d) the run's bound of requests reached: the claim the record refuses is permanent
    const bound = durable();
    const capped = "run-0e3b0000-0000-4000-8000-000000000d12";
    await chat(context, new Recording({}, true), { runId: capped });
    expect(await orchestrationResumeStoreOf(bound.store)!.append({ scope: { ...D3_SCOPE, runId: capped }, at: new Date().toISOString(), entry: { kind: "settled", ordinal: ORCHESTRATION_RESUME_BOUNDS.maxOrdinal, presented: false } as never })).toMatchObject({ ok: true });
    expect(codeOf(await resumeOf(context, { runId: capped }))).toBe("resume_unusable");
  });

  it("12. [B21 E3 fix: tests-2] EVERY write to the resume record is bounded by the record deadline (injected here; RESUME_RECORD_DEADLINE_MS in production): against a repository whose commit never settles, a hanging coordinator entry stands the run down before any specialist, a hanging ledger claim before anything is presented, a hanging follow-up entry and a hanging end each leave their line - every request emits its ONE terminal within the deadline; a hanging start claim is `resume_unavailable`", async () => {
    const deadline = 50;
    const cases: Array<[string, Readonly<Record<string, SpecialistScript>>, boolean, string[], string | null]> = [
      ["coordinator", {}, false, ["no_specialist_ran"], null],
      ["artifact", { schematic: { call: { toolId: REPLACEMENT, args: REPLACE_U1 } } }, false, ["merge_unrecorded"], null],
      ["follow-up", {}, false, [], "Orchestration: the follow-up turn's answer could not be recorded (store_unavailable); a resume of this run would answer again."],
      ["settled", {}, true, ["follow_up_failed"], "Orchestration: the end of this request could not be recorded (store_unavailable); the run can be resumed once this request's start is 10 minutes old."],
    ];
    for (const [index, [kind, scripts, failFollowUp, reasons, line]] of cases.entries()) {
      const repository = new ResumeRepository();
      repository.hang = (entry) => entry.kind === kind;
      durable(repository);
      const began = Date.now();
      const run = await chat(context, new Recording(scripts, failFollowUp), { runId: `run-0e3b0000-0000-4000-8000-0000000012${index}0`, recordDeadlineMs: deadline });
      expect(Date.now() - began, kind).toBeLessThan(4_000);
      expect(run.events.filter((event) => event.type === "run_completed" || event.type === "run_failed"), kind).toHaveLength(1);
      expect(ofType(run.events, "degraded").map((event) => event.reason), kind).toEqual(reasons);
      if (line) expect(lines(run.events), kind).toContain(line);
      expect(artifacts(run.events), kind).toEqual([]);
    }
    const claims = new ResumeRepository();
    durable(claims);
    await chat(context, new Recording({}, true));
    claims.hang = (entry) => entry.kind === "resume";
    const began = Date.now();
    expect(codeOf(await resumeOf(context, { deadlineMs: deadline }))).toBe("resume_unavailable");
    expect(Date.now() - began).toBeLessThan(4_000);
  }, 30_000);

  it("13. [B21 E3 fix: tests-3] the start claim is a compare-and-set against the head the resolution READ, not only an idempotent key: when another entry lands between the read and the claim (a request past its lease answering its follow-up), the claim loses - `resume_in_progress`, no start written - and the next resolution reads the finished run", async () => {
    const repository = new (class extends InMemoryDurableWorkflowRepository {
      interleave: (() => Promise<void>) | null = null;
      override async history<T extends object = object>(identity: DurableAggregateIdentity): Promise<Array<DurableAggregateRecord<T>>> {
        const read = await super.history<T>(identity);
        if (identity.aggregateType === ORCHESTRATION_RESUME_AGGREGATE_TYPE && this.interleave) { const land = this.interleave; this.interleave = null; await land(); }
        return read;
      }
    })();
    const { store } = durable(repository);
    await chat(context, new Recording({}, true), { now: () => T0 });
    expect(codeOf(await resumeOf(context, { now: () => T0 + 1_000 }))).toBe("resume"); // resume:1 - it never settles (a request past its lease)
    repository.interleave = async () => {
      await orchestrationResumeStoreOf(store)!.append({ scope: { ...D3_SCOPE, runId: RUN }, at: new Date(T0 + 2_000 + RESUME_LEASE_MS).toISOString(), entry: { kind: "follow-up", answerDigest: orchestrationResumeAnswerDigest("(scripted) the late follow-up.") } });
    };
    expect(codeOf(await resumeOf(context, { now: () => T0 + 2_000 + RESUME_LEASE_MS }))).toBe("resume_in_progress");
    expect(await recordOf(store)).toEqual(["coordinator", "settled:0", "resume:1", "follow-up"]);
    expect(codeOf(await resumeOf(context, { now: () => T0 + 3_000 + RESUME_LEASE_MS }))).toBe("resume_completed");
  });

  it("14. [B21 E3 fix: tests-4] the OWNER is decided before anything else about the run: another principal is `resume_foreign` whatever else is wrong - another message, another provider, a changed plan, a run another request still holds, a finished run - and nothing is written", async () => {
    const repository = new ResumeRepository();
    const { store } = durable(repository);
    const foreign = timerContext(editor, catalog.authority, { ...live, principalId: "human-e3-other" });
    await chat(context, new Recording({}, true), { now: () => T0 });
    const held = await resumeOf(context, { now: () => T0 + 1_000 }); // the owner's resume holds the run
    expect(codeOf(held)).toBe("resume");
    const written = repository.order.length;
    expect(codeOf(await resumeOf(foreign, { message: "Replace the NE555 timer U1 with a CMOS timer.", now: () => T0 + 2_000 }))).toBe("resume_foreign");
    expect(codeOf(await resumeOf(foreign, { provider: "anthropic", now: () => T0 + 2_000 }))).toBe("resume_foreign");
    setTaskComplexityRouterFactory(() => () => ({ kind: "single", rule: "e3-fixture" }));
    expect(codeOf(await resumeOf(foreign, { now: () => T0 + 2_000 }))).toBe("resume_foreign");
    resetTaskComplexityRouterFactory();
    expect(codeOf(await resumeOf(foreign, { now: () => T0 + 2_000 }))).toBe("resume_foreign"); // held by the owner's request
    expect(repository.order).toHaveLength(written);
    await chat(context, new Recording(), { resume: held, now: () => T0 + 3_000 });
    expect(codeOf(await resumeOf(context, { now: () => T0 + 4_000 }))).toBe("resume_completed");
    const finished = repository.order.length;
    expect(codeOf(await resumeOf(foreign, { now: () => T0 + 4_000 }))).toBe("resume_foreign");
    expect(repository.order).toHaveLength(finished);
    expect((await recordOf(store)).filter((entry) => entry.startsWith("resume"))).toEqual(["resume:1"]);
  });

  it("15. [B21 E3 fix: regressions-2] a request whose start is on the record SETTLES it when something throws past the runtime (the route's catch then answers `stream_error`): a fresh run whose scheduler throws after its plan, and a resumed request that throws, each leave their end before the throw leaves the runtime - the run can be resumed at once, never held for the lease", async () => {
    const repository = new ResumeRepository();
    const { store } = durable(repository);
    setSpecialistSchedulerFactory(() => async (plan, coordinator, deps) => runSpecialistDag(plan, coordinator, { ...deps, emit: (event) => { deps.emit(event); if (event.type === "plan") throw new Error("the scheduler failed after its plan"); } }));
    const events: AgentRunEvent[] = [];
    await expect(chat(context, new Recording(), { now: () => T0, onEvent: (event) => events.push(event) })).rejects.toThrow("the scheduler failed after its plan");
    expect(ofType(events, "plan")).toHaveLength(1);
    expect(await recordOf(store)).toEqual(["coordinator", "settled:0"]);
    const resume = await resumeOf(context, { now: () => T0 + 1_000 });
    expect(resume).toMatchObject({ kind: "resume", grant: { ordinal: 1 } });
    await expect(chat(context, new Recording(), { resume, now: () => T0 + 2_000 })).rejects.toThrow("the scheduler failed after its plan");
    expect(await recordOf(store)).toEqual(["coordinator", "settled:0", "resume:1", "settled:1"]);
    resetSpecialistSchedulerFactory();
    expect(await resumeOf(context, { now: () => T0 + 3_000 })).toMatchObject({ kind: "resume", grant: { ordinal: 2 } });
  });

  it("16. [B21 E3 fix: security-2] a route-level resume replays a committed result only when it is ALSO bound to this request's selection, netlist and schematic (beside its scope): the same design under another selection makes every committed result STALE (`stale_context`) and it runs again; the component authority is deliberately NOT part of the key - under the catalog's earlier authority every result replays, and a replayed seal is re-judged by the merge against the authority the resuming request loaded (OD-130's part review, route case 8)", async () => {
    durable();
    const plain = boardContext(editor, catalog.authority, live, false);
    const selected = boardContext(editor, catalog.authority, live, true);
    expect(selected.selectionDigest).not.toBe(plain.selectionDigest);
    expect(engineeringDigest(requestScope(selected))).toBe(engineeringDigest(requestScope(plain)));
    await chat(plain, new Recording({}, true));
    const resume = await resumeOf(selected);
    if (resume.kind !== "resume") throw new Error(JSON.stringify(resume));
    const adapter = new Recording();
    const resumed = await chat(selected, adapter, { resume });
    expect(adapter.starts.map((start) => start.role)).toEqual([...SPECIALISTS, "coordinator"]);
    const stale = ofType(resumed.events, "specialist_finished").filter((event) => event.status === "stale");
    expect(stale.map((event) => event.reason)).toEqual(SPECIALISTS.map(() => "stale_context: committed under another selection than this request carries"));
    expect(stale.every((event) => event.message.includes("is STALE - it was produced for another selection than this request carries; the task runs again."))).toBe(true);
    // the authority moved (the catalog's earlier selection of U1's exact part): the same design and selection replay every result
    const again = "run-0e3b0000-0000-4000-8000-000000000016";
    await chat(plain, new Recording({}, true), { runId: again });
    const earlier = boardContext(editor, earlierAuthority(catalog.authority), live, false);
    expect(earlier.componentAuthorityDigest).not.toBe(plain.componentAuthorityDigest);
    const moved = await resumeOf(earlier, { runId: again });
    if (moved.kind !== "resume") throw new Error(JSON.stringify(moved));
    const replayed = new Recording();
    const sameRun = await chat(earlier, replayed, { resume: moved, runId: again });
    expect(replayed.starts.map((start) => start.role)).toEqual(["coordinator"]);
    expect(lines(sameRun.events).filter((line) => line.startsWith("Orchestration: specialist ") && line.includes("replayed from the record"))).toHaveLength(4);
  });

  it("17. [B21 E3 fix: coverage-2] a replayed seal must OUTLIVE the approval window (OD-107: the 10-minute proposal TTL minus the 2-minute window, RESUME_REPLAY_APPROVAL_WINDOW_MS): the first request sealed U1's replacement and then stood down on a provider outage before any merge; resumed with less than the window left, the seal is NOT replayed - `stale_lifetime`, the schematic specialist runs again and its fresh seal is presented; resumed with more than the window left, the seal replays", async () => {
    const replace = { schematic: { call: { toolId: REPLACEMENT, args: REPLACE_U1 } } };
    durable();
    const first = await chat(context, new Recording(replace, false, ["verification-critic"]));
    expect(ofType(first.events, "degraded").map((event) => event.reason)).toEqual(["provider_outage"]);
    expect(artifacts(first.events)).toEqual([]);
    const late = (): number => Date.now() + 9 * 60_000; // one minute left of the seal's ten
    const resume = await resumeOf(context, { now: late });
    if (resume.kind !== "resume") throw new Error(JSON.stringify(resume));
    const adapter = new Recording(replace);
    const resumed = await chat(context, adapter, { resume, now: late });
    const stale = ofType(resumed.events, "specialist_finished").filter((event) => event.status === "stale");
    expect(stale.map((event) => [event.role, event.reason?.replace(/ \(.*$/, "")])).toEqual([["schematic", "stale_lifetime: a sealed artifact of the committed result expires within the approval window"]]);
    expect(adapter.starts.map((start) => start.role)).toEqual(["schematic", "verification-critic", "coordinator"]);
    expect(artifacts(resumed.events).map((event) => event.type)).toEqual(["proposal_ready"]);
    // the contrast: three minutes left - the seal replays
    const again = "run-0e3b0000-0000-4000-8000-000000000017";
    await chat(context, new Recording(replace, false, ["verification-critic"]), { runId: again });
    const early = (): number => Date.now() + 2 * 60_000; // [B21 E3 lead] three minutes of the seal left at the resumed DAG's deadline (+5 minutes)
    const inTime = await resumeOf(context, { runId: again, now: early });
    if (inTime.kind !== "resume") throw new Error(JSON.stringify(inTime));
    const replayed = new Recording(replace);
    await chat(context, replayed, { resume: inTime, runId: again, now: early });
    expect(replayed.starts.map((start) => start.role)).toEqual(["verification-critic", "coordinator"]);
    expect(RESUME_REPLAY_APPROVAL_WINDOW_MS).toBe(120_000);
  });

  it("18. [B21 E3 fix: coverage-5] a write that timed out is UNKNOWN, never taken as unwritten: a ledger claim that timed out but landed is VOID - its request stood down and recorded that it presented nothing - so the next request presents the artifact, exactly once (a later resume finds that presentation: `already_presented`); a claim whose request's end is unknown counts as presented (at most once); a start claim that timed out but landed never holds the run - its end is marked", async () => {
    const deadline = 50;
    const scripts = { schematic: { call: { toolId: REPLACEMENT, args: REPLACE_U1 } } };
    const repository = new ResumeRepository();
    repository.slowAck = (entry) => (entry.kind === "artifact" ? deadline * 4 : 0);
    const { store } = durable(repository);
    const first = await chat(context, new Recording(scripts), { recordDeadlineMs: deadline });
    expect(ofType(first.events, "degraded").map((event) => event.reason)).toEqual(["merge_unrecorded"]);
    expect(artifacts(first.events)).toEqual([]);
    expect(await recordOf(store)).toEqual(["coordinator", "artifact:0", "settled:0"]); // the claim LANDED; its request presented nothing
    repository.slowAck = () => 0;
    const resume = await resumeOf(context);
    if (resume.kind !== "resume") throw new Error(JSON.stringify(resume));
    const second = await chat(context, new Recording(scripts, true), { resume });
    expect(artifacts(second.events).map((event) => event.type)).toEqual(["proposal_ready"]); // the void claim: presented now
    expect(await recordOf(store)).toEqual(["coordinator", "artifact:0", "settled:0", "resume:1", "settled:1+presented"]);
    const third = await resumeOf(context);
    if (third.kind !== "resume") throw new Error(JSON.stringify(third));
    const withheld = await chat(context, new Recording(scripts), { resume: third });
    expect(artifacts(withheld.events)).toEqual([]);
    expect(lines(withheld.events).some((line) => line.startsWith("Orchestration: nothing from the specialists is presented for approval (already_presented):"))).toBe(true);
    // a claim whose request's end is unknown (its end could not be written): counted as presented
    const unknown = new ResumeRepository();
    unknown.slowAck = (entry) => (entry.kind === "artifact" ? deadline * 4 : 0);
    unknown.fail = (entry) => entry.kind === "settled";
    const lost = durable(unknown);
    const run = "run-0e3b0000-0000-4000-8000-000000000018";
    await chat(context, new Recording(scripts), { runId: run, recordDeadlineMs: deadline });
    unknown.slowAck = () => 0;
    unknown.fail = () => false;
    const afterLease = await resumeOf(context, { runId: run, now: () => Date.now() + RESUME_LEASE_MS }); // its start unsettled: held until the lease passed
    if (afterLease.kind !== "resume") throw new Error(JSON.stringify(afterLease));
    const unsure = await chat(context, new Recording(scripts), { resume: afterLease, runId: run });
    expect(artifacts(unsure.events)).toEqual([]);
    expect(await recordOf(lost.store, run)).toEqual(["coordinator", "artifact:0", "resume:1", "follow-up"]);
    // the route's start claim: it timed out but landed - its end is marked, so the run is not held
    const starts = new ResumeRepository();
    const held = durable(starts);
    const third3 = "run-0e3b0000-0000-4000-8000-000000000118";
    await chat(context, new Recording({}, true), { runId: third3 });
    starts.slowAck = (entry) => (entry.kind === "resume" ? deadline * 4 : 0);
    expect(codeOf(await resumeOf(context, { runId: third3, deadlineMs: deadline }))).toBe("resume_unavailable");
    await new Promise((resolve) => setTimeout(resolve, deadline * 6));
    starts.slowAck = () => 0;
    expect(await resumeOf(context, { runId: third3 })).toMatchObject({ kind: "resume", grant: { ordinal: 2 } });
    expect(await recordOf(held.store, third3)).toEqual(["coordinator", "settled:0", "resume:1", "settled:1", "resume:2"]);
  }, 30_000);

  it("19. [B21 E3 lead] a start claim of UNKNOWN outcome marks only its OWN end: two requests read the same head and claim the same ordinal; the winner's claim lands and the loser's write fails - the loser re-reads, finds ANOTHER request's start (another claim id) and marks nothing, so the winner's start still holds the run (`resume_in_progress`) and the winner's own end lands with what it presented, never swallowed by a marker of the same key", async () => {
    const repository = new (class extends InMemoryDurableWorkflowRepository {
      winner: (() => Promise<unknown>) | null = null;
      override async commit<TResult extends object = Record<string, unknown>>(request: DurableCommitRequest<TResult>): Promise<DurableCommitResult<TResult>> {
        const entry = resumeEntryOf(request);
        if (entry?.kind === "resume" && this.winner) { const land = this.winner; this.winner = null; await land(); throw new Error("resume driver down: connection reset"); }
        return super.commit(request);
      }
    })();
    const { store } = durable(repository);
    const resumes = orchestrationResumeStoreOf(store)!;
    const scope = { ...D3_SCOPE, runId: RUN };
    await chat(context, new Recording({}, true), { now: () => T0 });
    expect(await recordOf(store)).toEqual(["coordinator", "settled:0"]);
    // the winner read the same head and its claim of ordinal 1 lands first; the loser's own write then fails
    repository.winner = () => resumes.append({ scope, at: new Date(T0 + 1_000).toISOString(), entry: { kind: "resume", ordinal: 1, claim: engineeringDigest({ schema: "b21-e3-lead.winner-claim" }) } });
    expect(codeOf(await resumeOf(context, { now: () => T0 + 1_000 }))).toBe("resume_unavailable");
    expect(await recordOf(store)).toEqual(["coordinator", "settled:0", "resume:1"]); // the winner's start - NOT settled by the loser
    expect(codeOf(await resumeOf(context, { now: () => T0 + 2_000 }))).toBe("resume_in_progress"); // one request of a run at a time
    expect(await resumes.append({ scope, at: new Date(T0 + 3_000).toISOString(), entry: { kind: "settled", ordinal: 1, presented: true } })).toMatchObject({ ok: true, replayed: false });
    expect(await recordOf(store)).toEqual(["coordinator", "settled:0", "resume:1", "settled:1+presented"]);
    expect(await resumeOf(context, { now: () => T0 + 4_000 })).toMatchObject({ kind: "resume", grant: { ordinal: 2 } });
    // a start entry without its claim id, or with one that is not a digest, is refused whole
    for (const entry of [{ kind: "resume", ordinal: 3 }, { kind: "resume", ordinal: 3, claim: "winner" }]) {
      expect(await resumes.append({ scope, at: new Date(T0 + 5_000).toISOString(), entry: entry as never })).toMatchObject({ ok: false, code: "invalid_record" });
    }
  });

  it("20. [B21 E3 lead] a replayed seal's approval window is measured at the resumed DAG's DEADLINE, not when its replay is decided (the DAG may run its whole wall time after the replay, OD-107): resumed with six minutes of the seal left now but one at the deadline, the seal is NOT replayed - `stale_lifetime`, its schematic specialist runs again and its fresh seal is presented", async () => {
    const replace = { schematic: { call: { toolId: REPLACEMENT, args: REPLACE_U1 } } };
    durable();
    const first = await chat(context, new Recording(replace, false, ["verification-critic"]));
    expect(ofType(first.events, "degraded").map((event) => event.reason)).toEqual(["provider_outage"]);
    const mid = (): number => Date.now() + 4 * 60_000; // six minutes of the seal's ten left now, one at the DAG's deadline (+5 minutes)
    const resume = await resumeOf(context, { now: mid });
    if (resume.kind !== "resume") throw new Error(JSON.stringify(resume));
    const adapter = new Recording(replace);
    const resumed = await chat(context, adapter, { resume, now: mid });
    const stale = ofType(resumed.events, "specialist_finished").filter((event) => event.status === "stale");
    expect(stale.map((event) => [event.role, event.reason?.replace(/ \(.*$/, "")])).toEqual([["schematic", "stale_lifetime: a sealed artifact of the committed result expires within the approval window"]]);
    expect(stale[0]?.reason).toMatch(/\(\d+ s left at the DAG's deadline, 120 s needed - OD-107\)$/);
    expect(adapter.starts.map((start) => start.role)).toEqual(["schematic", "verification-critic", "coordinator"]);
    expect(artifacts(resumed.events).map((event) => event.type)).toEqual(["proposal_ready"]);
  });
});
