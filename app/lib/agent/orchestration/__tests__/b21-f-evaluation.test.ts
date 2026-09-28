/**
 * [B21 F] The twelve runbook evaluations of B21-F (runbook :861-874), OFFLINE, each a deterministic case through the REAL runtime:
 * the PRODUCTION chat POST (the wrapper's identity, membership, role and CSRF checks, the router, the loop, the gateway, the runtime,
 * the scheduler, the merge, the families' sealers and approval path, the durable record and the per-task trace documents are the real
 * ones) with the orchestration flag ON. The adapters module is the ORIGINAL one with its two factories wrapped: every adapter is the
 * REAL `OpenAIAgentAdapter` / `AnthropicAgentAdapter` over an in-process FAKE SDK client (`_f-fixture-clients.ts`) that answers from the
 * scripted fixture agent - the browser harness's own script table, whose per-role specialists answer through the strict result tool
 * (`fixture-agent-adapter.ts` FIXTURE_ROLE_SCRIPTS, D21-40). No network, no model, no credential. Every case asserts the closed outcome
 * vocabulary, the record, the trace and the stream's events - never a wall clock (the one timeout case advances fake timers).
 * Model-in-loop is record-only (OD-125): the same cases run live only by swapping the adapter - no live block is committed (OD-102).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SchematicState } from "@/lib/schematic-types";
import { schematicStateDigest } from "@/app/lib/engineering/schematic-model";
import { createEmptyBoard, type PcbBoard } from "@/app/lib/pcb/types";
import { pcbRevisionId } from "@/app/lib/pcb/revision";
import { replacementHeadDigestFor } from "@/app/lib/engineering/replacement-proposal-assembler";
import { InMemoryDurableWorkflowRepository } from "@/app/lib/durable-workflow/repository";
import { receiveReplacementProposalEvent } from "@/app/lib/project/replacement-proposal-events";
import { InMemoryTraceSink, setAgentTraceSinkFactory } from "@/app/lib/agent/trace-recorder";
import type { AgentRunTrace } from "@/app/lib/agent/trace";
import { DEGRADED_REASONS, ORCHESTRATION_RUN_EVENT_TYPES, SPECIALIST_FINISHED_STATUSES } from "@/app/lib/agent/contracts";
import { providerRetryOffered } from "@/app/lib/agent/run-consumer";
import { currentLlmProviderPause, resetAdmissionControl } from "@/app/lib/acquisition/admission-control";
import { fixtureBoard } from "@/app/lib/engineering/__tests__/b18c-harness";
import { FIXTURE_EXACT } from "@/app/lib/engineering/__tests__/_authority-fixtures";
import { FIXTURE_AGENT_ENV, FIXTURE_AGENT_SCRIPTED, FIXTURE_RESULT_TOOL_NAME, FIXTURE_ROLE_SCRIPTS, FixtureAgentAdapter, fixtureSentenceKey } from "@/app/lib/agent/fixture-agent-adapter";
import { DurableOrchestrationRunStore, ORCHESTRATION_DECISIONS, ORCHESTRATION_RECORD_KINDS, orchestrationResumeStoreOf, orchestrationTraceStoreOf, type OrchestrationRunEntry } from "../store";
import { MERGE_TASK_PREFIX } from "../merge";
import { routeTaskComplexity } from "../router";
import { SPECIALIST_RESULT_TOOL_ID, SPECIALIST_RESULT_TOOL_NAME } from "../result-tool";
import { sirkitToolRegistry } from "@/app/lib/engineering/tool-catalog";
import { SCENARIO_17, SCENARIO_17_VARIANTS, REPLACEMENT, approveReplacement, installCatalog, principalOf, resetCatalog, stubReplacementAuthorityFetch, timerEditor, type TimerEditor } from "./_d3-fixtures";
import { fixtureClientLog, type FixtureClientLog } from "./_f-fixture-clients";
import { B21_F_CASES, B21_F_SENTENCES, evaluationMatrixCsv, evaluationMatrixJson } from "./_f-cases";
import { B11_REPLAY_PINS_FILE, B21_REPLAY_PINS_FILE, B21_REPLAY_PINS_SCHEMA, ORCHESTRATION_EVALUATION_CATEGORY, buildOrchestrationEvaluationCases, runOrchestrationCase, scoreOrchestrationCase } from "./_f-capsules";

const state = vi.hoisted(() => ({ log: null as FixtureClientLog | null, factories: [] as Array<[string, string, string, string | undefined]> }));

vi.mock("@/app/lib/agent/adapters", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/app/lib/agent/adapters")>();
  const { FixtureAgentAdapter: Fixture } = await import("@/app/lib/agent/fixture-agent-adapter");
  const clients = await import("@/app/lib/agent/orchestration/__tests__/_f-fixture-clients");
  /** the REAL adapter class over a fake SDK client answering from ONE scripted fixture agent */
  const build = (provider: "openai" | "anthropic", model: string | undefined, maxRetries: number | undefined) => {
    const fixture = new Fixture(provider);
    const log = state.log ?? clients.fixtureClientLog();
    return provider === "openai"
      ? new original.OpenAIAgentAdapter(clients.fixtureOpenAIClient(fixture, log) as never, model ?? undefined, undefined, maxRetries ?? 2)
      : new original.AnthropicAgentAdapter(clients.fixtureAnthropicClient(fixture, log) as never, model ?? undefined, maxRetries);
  };
  return {
    ...original,
    agentAdapterFor: (provider: "openai" | "anthropic") => { state.factories.push(["agentAdapterFor", "coordinator", provider, undefined]); return build(provider, undefined, undefined); },
    agentAdapterForRole: (role: string, provider: "openai" | "anthropic", model?: string) => { state.factories.push(["agentAdapterForRole", role, provider, model]); return build(provider, model, original.SPECIALIST_SDK_MAX_RETRIES); },
  };
});

import { POST, EDITOR_CONTEXT_SCHEMA } from "@/app/api/chat/route";
import { ORCHESTRATION_ENABLED_ENV, resetOrchestrationStoreFactory, setOrchestrationStoreFactory } from "@/app/api/chat/orchestration-runtime";

const ROOT = process.cwd();
const SCOPE = { tenantId: "tenant-1", projectId: "project-1", branchId: "main" };
type Event = Record<string, unknown>;
type Posted = { status: number; runId: string | null; json: Record<string, unknown> | null; events: Event[] };

/** The chat body the page sends: the message, the schematic and its head mark, and the PCB editor's working copy. */
function chatBody(sentence: string, input: { schematic?: SchematicState | null; headMark?: unknown; board?: PcbBoard; extra?: Record<string, unknown> } = {}): Record<string, unknown> {
  const board = input.board ?? createEmptyBoard();
  const schematic = input.schematic ?? null;
  return {
    provider: "openai", messages: [{ role: "user", content: sentence }], scope: SCOPE,
    ...(schematic ? { schematicState: schematic, schematicHeadMark: input.headMark } : {}),
    editorContext: { schema: EDITOR_CONTEXT_SCHEMA, scope: SCOPE, board, pcbRevisionId: pcbRevisionId(board), selection: { refs: [], primary: null }, netlist: null, schematicDigest: schematic ? schematicStateDigest(schematic) : null, authoritySource: "local-working-copy" },
    ...(input.extra ?? {}),
  };
}
const timerBody = (editor: TimerEditor, sentence: string, extra: Record<string, unknown> = {}) => chatBody(sentence, { schematic: editor.visible(), headMark: editor.editor.headMark(), extra });
/** the design MOVED: one unrelated label added and a new head - U1 and its wire untouched (E3's `movedBody`) */
function movedTimerBody(editor: TimerEditor, sentence: string, extra: Record<string, unknown> = {}) {
  const moved: SchematicState = { ...editor.visible(), netLabels: [{ id: "label-f", position: { x: 900, y: 900 }, name: "AUX1", kind: "label", orientation: 0 }] };
  const mark = editor.editor.headMark()!;
  return chatBody(sentence, { schematic: moved, headMark: { lineageId: mark.lineageId, headSequence: mark.headSequence + 1, canonicalStateDigest: headDigest(moved) }, extra });
}
const headDigest = (schematic: SchematicState): string => replacementHeadDigestFor(schematic, SCOPE);
async function post(body: unknown): Promise<Posted> {
  return posted(await POST(new Request("http://localhost/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })));
}
async function posted(response: Response): Promise<Posted> {
  const runId = response.headers.get("X-Sirkit-Run-Id");
  const text = await response.text();
  const ndjson = (response.headers.get("Content-Type") ?? "").includes("ndjson");
  return { status: response.status, runId, json: ndjson ? null : (JSON.parse(text) as Record<string, unknown>), events: ndjson ? text.trim().split("\n").map((line) => JSON.parse(line) as Event) : [] };
}

const of = (events: Event[], type: string): Event[] => events.filter((event) => event.type === type);
const lines = (events: Event[]): string[] => events.flatMap((event) => (typeof event.message === "string" ? [event.message] : []));
const terminals = (events: Event[]): Event[] => events.filter((event) => event.type === "run_completed" || event.type === "run_failed");
const ARTIFACT_EVENTS = new Set(["proposal_ready", "pcb_proposal_ready", "layout_candidate_ready", "execution_grant_ready"]);
const artifactsOf = (events: Event[]): Event[] => events.filter((event) => ARTIFACT_EVENTS.has(String(event.type)));
const texts = (events: Event[]): string[] => of(events, "text_delta").map((event) => String(event.text));
const verdictsOf = (history: readonly OrchestrationRunEntry[]): string[] => history.filter((entry) => entry.record.kind === "decision" || entry.record.kind === "dissent").map((entry) => `${entry.taskId.startsWith(MERGE_TASK_PREFIX) ? "merge" : entry.taskId.replace(/\.merge-[0-9a-f]{16}$/, ".merge-*")}:${entry.record.kind}:${(entry.record as { decision: string }).decision}`);
/** [B21 F fix: security-3, tests-02] a registry tool's operation class (the result tool is the specialist's answer, not a registry tool) */
const classOf = (toolId: string): string => (toolId === SPECIALIST_RESULT_TOOL_ID ? "result" : sirkitToolRegistry().list().find((descriptor) => descriptor.toolId === toolId)?.operationClass ?? "unknown");
/** [B21 F fix: coverage-3, tests-05] every `evidence` list anywhere in a value (the record, the follow-up's envelope) */
function evidenceLists(value: unknown, found: unknown[][] = []): unknown[][] {
  if (Array.isArray(value)) for (const item of value) evidenceLists(item, found);
  else if (value !== null && typeof value === "object") for (const [key, item] of Object.entries(value)) { if (key === "evidence" && Array.isArray(item)) found.push(item); evidenceLists(item, found); }
  return found;
}
/** the JSON document of a follow-up envelope (the header line, then the document) */
const envelopeBody = (envelope: string): unknown => JSON.parse(envelope.slice(envelope.indexOf(String.fromCharCode(10)) + 1));
/** which specialist roles the fake SDK clients were called for, in order (one entry per started turn) */
const startedRoles = (log: FixtureClientLog): string[] => log.calls.filter((call) => call.turn === "start").map((call) => (call.followUp ? "coordinator-2" : call.role));

/** The CLOSED outcome vocabulary of one stream (and its record): every event type is the protocol's, run_started first and once,
 *  exactly ONE terminal and last, every degraded reason and specialist status and every record kind and decision in its closed list. */
const AGENT_EVENT_TYPES = ["run_started", "text_delta", "tool_started", "tool_finished", "tool_refused", "proposal_ready", "pcb_proposal_ready", "view_command_ready", "layout_candidate_ready", "execution_grant_ready", "execution_settled", "warning", "run_failed", "run_completed"];
function expectClosedVocabulary(events: Event[], history: readonly OrchestrationRunEntry[] = []): void {
  for (const event of events) expect([...AGENT_EVENT_TYPES, ...ORCHESTRATION_RUN_EVENT_TYPES], String(event.type)).toContain(event.type);
  expect(events[0]).toMatchObject({ type: "run_started" });
  expect(of(events, "run_started")).toHaveLength(1);
  expect(terminals(events)).toHaveLength(1);
  expect(events.at(-1)).toBe(terminals(events)[0]);
  for (const event of of(events, "degraded")) expect(DEGRADED_REASONS, String(event.reason)).toContain(event.reason);
  for (const event of of(events, "specialist_finished")) expect(SPECIALIST_FINISHED_STATUSES, String(event.status)).toContain(event.status);
  for (const entry of history) {
    expect(ORCHESTRATION_RECORD_KINDS).toContain(entry.record.kind);
    if (entry.record.kind === "decision" || entry.record.kind === "dissent") expect(ORCHESTRATION_DECISIONS).toContain(entry.record.decision);
  }
}

let store: DurableOrchestrationRunStore;
let traces: AgentRunTrace[] = [];
const historyOf = (runId: string | null): Promise<OrchestrationRunEntry[]> => store.history({ ...SCOPE, runId: runId! });
/** the per-task trace documents recorded for one task of a run (`<runId>:<n>-<role>`) */
const taskTraces = async (runId: string, index: number, role: string) => (await orchestrationTraceStoreOf(store)!.history(SCOPE, `${runId}:${index}-${role}`)).map((entry) => entry.record.document.trace);

describe("[B21 F] the twelve runbook evaluations, offline through the real runtime (fake SDK clients, scripted per-role specialists)", () => {
  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv(ORCHESTRATION_ENABLED_ENV, "1");
    vi.stubEnv("SIRKIT_ORCHESTRATION_ROLE_MODELS", ""); vi.stubEnv("SIRKIT_OPENAI_MODEL", ""); vi.stubEnv("SIRKIT_ANTHROPIC_MODEL", "claude-opus-4-7");
    vi.stubGlobal("fetch", () => { throw new Error("no network"); });
    resetAdmissionControl();
    state.log = fixtureClientLog();
    state.factories = [];
    store = new DurableOrchestrationRunStore(new InMemoryDurableWorkflowRepository());
    setOrchestrationStoreFactory(() => store);
    const sink = new InMemoryTraceSink();
    traces = [];
    setAgentTraceSinkFactory(() => ({ append: (event) => sink.append(event), complete: (trace) => { traces.push(trace); sink.complete(trace); } }));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    resetAdmissionControl();
    resetCatalog();
    resetOrchestrationStoreFactory();
    setAgentTraceSinkFactory(null);
    state.log = null;
  });

  it("1. delete/replace component (:863): the runbook's scenario-4 sentence routes to the component-replacement DAG; the coordinator's OWN first turn reads the schematic and seals the server-chosen replacement (one `proposal_ready`), so OD-122 keeps every specialist read-only (`coordinator_artifact_held`) and the follow-up's envelope says `coordinator_sealed`; the record holds the plan and four accepted results; the coordinator's trace holds the read and the seal", async () => {
    await installCatalog(SCOPE);
    const editor = await timerEditor(SCOPE);
    const sentence = B21_F_SENTENCES.deleteReplace;
    expect(routeTaskComplexity(sentence, { hasSchematic: true, hasBoard: false, actorRole: "pcb_editor", autonomyMode: "proposal_only", selectionCount: 0 })).toMatchObject({ kind: "dag", rule: "D-component-replacement" });
    const run = await post(timerBody(editor, sentence));
    expect(run.status).toBe(200);
    const history = await historyOf(run.runId);
    expectClosedVocabulary(run.events, history);
    expect(startedRoles(state.log!)).toEqual(["coordinator", "circuit-topology", "component-sourcing-evidence", "schematic", "verification-critic", "coordinator-2"]);
    const specialistCalls = state.log!.calls.filter((call) => call.role !== "coordinator");
    for (const call of specialistCalls) expect(call.tools.filter((toolId) => classOf(toolId) !== "read" && classOf(toolId) !== "result"), `${call.role} ${call.turn}: OFFERED no proposal beside the coordinator's artifact (OD-122)`).toEqual([]); // [B21 F fix: tests-02] what each specialist could reach, not only what it did
    expect(specialistCalls.every((call) => call.tools.includes(SPECIALIST_RESULT_TOOL_ID) && call.tools.some((toolId) => classOf(toolId) === "read"))).toBe(true);
    expect(artifactsOf(run.events).map((event) => [event.type, event.toolId, event.runId])).toEqual([["proposal_ready", REPLACEMENT, run.runId]]);
    expect(receiveReplacementProposalEvent(artifactsOf(run.events)[0]!)!.proposal.target).toMatchObject({ partId: FIXTURE_EXACT.exactMpn });
    expect(of(run.events, "degraded").map((event) => event.reason)).toEqual(["coordinator_artifact_held"]);
    expect(of(run.events, "plan")).toHaveLength(1);
    expect(of(run.events, "specialist_finished").map((event) => event.status)).toEqual(["accepted", "accepted", "accepted", "accepted"]);
    expect(texts(run.events).at(-1)).toMatch(/^\(fixture agent\) The specialists' results as the deterministic merge judged them: 4 accepted, 0 withheld; 0 escalation\(s\); approval: coordinator_sealed\./);
    expect(history.filter((entry) => entry.record.kind === "result")).toHaveLength(4);
    expect(verdictsOf(history).every((verdict) => verdict.endsWith("decision:accepted"))).toBe(true);
    expect(traces).toHaveLength(1);
    const invocations = traces[0]!.events.filter((event) => event.kind === "tool_invocation").map((event) => [event.toolId, event.status]);
    expect(invocations).toEqual([["sirkit.schematic.inspect", "succeeded"], [REPLACEMENT, "proposal_sealed"]]);
    expect(traces[0]!.events.at(-1)).toMatchObject({ kind: "terminal", outcome: "completed" });
    expect(terminals(run.events)[0]).toMatchObject({ type: "run_completed" });
  });

  it("2. via changes (:864): a Tier 1/2 via request stays ONE coordinator turn under the router (`single`, no swarm): no plan, no specialist, nothing written to the orchestration record; the scripted agent reads the net's vias first and answers from what the board holds; one run_started, one terminal", async () => {
    const sentence = B21_F_SENTENCES.vias;
    const run = await post(chatBody(sentence, { board: fixtureBoard({ vias: true }) }));
    expect(run.status).toBe(200);
    const history = await historyOf(run.runId);
    expectClosedVocabulary(run.events, history);
    expect(history).toEqual([]);
    expect(startedRoles(state.log!)).toEqual(["coordinator"]);
    for (const type of ORCHESTRATION_RUN_EVENT_TYPES) expect(of(run.events, type), type).toEqual([]);
    expect(of(run.events, "tool_finished").map((event) => event.toolId)).toContain("sirkit.pcb.via-inspect");
    expect(texts(run.events).at(-1)).toMatch(/^\(fixture agent\) /);
    expect(traces).toHaveLength(1);
    expect(traces[0]!.events.filter((event) => event.kind === "tool_invocation").map((event) => event.toolId)).toContain("sirkit.pcb.via-inspect");
  });

  it("3. dimensions (:865): the runbook's dimension sentence stays ONE coordinator turn (`single`): the scripted agent reads the bounded mechanical view before it plans anything; no plan, no specialist, no record; one terminal", async () => {
    const sentence = B21_F_SENTENCES.dimensions;
    const run = await post(chatBody(sentence, { board: fixtureBoard() }));
    expect(run.status).toBe(200);
    const history = await historyOf(run.runId);
    expectClosedVocabulary(run.events, history);
    expect(history).toEqual([]);
    expect(startedRoles(state.log!)).toEqual(["coordinator"]);
    for (const type of ORCHESTRATION_RUN_EVENT_TYPES) expect(of(run.events, type), type).toEqual([]);
    expect(of(run.events, "tool_finished").map((event) => event.toolId)).toContain("sirkit.pcb.mechanical-inspect");
    expect(traces).toHaveLength(1);
    expect(traces[0]!.events.filter((event) => event.kind === "step")).toHaveLength(state.log!.calls.length);
  });

  it("4. 3D control request routed directly without a swarm (:866): the router answers `single` (S-default) BEFORE any model call and the run is exactly ONE coordinator turn - one provider call, zero specialists, no plan / specialist / partial / degraded event, nothing in the orchestration record, one run_started and one terminal, and the coordinator's trace is one document with one step", async () => {
    const sentence = B21_F_SENTENCES.view3d;
    expect(routeTaskComplexity(sentence, { hasSchematic: true, hasBoard: true, actorRole: "pcb_editor", autonomyMode: "proposal_only", selectionCount: 0 })).toEqual({ kind: "single", rule: "S-default" });
    const run = await post(chatBody(sentence, { board: fixtureBoard() }));
    expect(run.status).toBe(200);
    const history = await historyOf(run.runId);
    expectClosedVocabulary(run.events, history);
    expect(history).toEqual([]);
    expect(state.log!.calls.map((call) => [call.provider, call.role, call.turn])).toEqual([["openai", "coordinator", "start"]]);
    expect(state.factories).toEqual([["agentAdapterFor", "coordinator", "openai", undefined]]);
    for (const type of ORCHESTRATION_RUN_EVENT_TYPES) expect(of(run.events, type), type).toEqual([]);
    expect(run.events.filter((event) => event.type !== "warning").map((event) => event.type)).toEqual(["run_started", "text_delta", "run_completed"]);
    expect(lines(run.events).filter((line) => line.startsWith("Orchestration"))).toEqual([]); // only the context's own warnings: no orchestration line
    expect(traces).toHaveLength(1);
    expect(traces[0]!.events.filter((event) => event.kind === "step")).toHaveLength(1);
    expect(traces[0]!.events.map((event) => event.kind)).toEqual(["run_started", "step", "terminal"]);
  });

  it("5. compact placement/routing (:867): the runbook's own scenario-5 sentence stays `single` (no layout noun); the DAG phrasing \"Compact the placement and reroute the affected traces.\" routes to the bounded-pcb-proposal DAG - the coordinator's turn, the PCB specialist (who reads the board and answers through the result tool), the follow-up turn; its task is accepted, its per-task trace document holds its read; one terminal", async () => {
    expect(routeTaskComplexity(B21_F_SENTENCES.compactScenario5, { hasSchematic: true, hasBoard: true, actorRole: "pcb_editor", autonomyMode: "proposal_only", selectionCount: 0 })).toMatchObject({ kind: "single" });
    const sentence = B21_F_SENTENCES.compact;
    expect(routeTaskComplexity(sentence, { hasSchematic: false, hasBoard: true, actorRole: "pcb_editor", autonomyMode: "proposal_only", selectionCount: 0 })).toMatchObject({ kind: "dag", rule: "D-bounded-pcb-proposal" });
    const run = await post(chatBody(sentence, { board: fixtureBoard() }));
    expect(run.status).toBe(200);
    const history = await historyOf(run.runId);
    expectClosedVocabulary(run.events, history);
    expect(startedRoles(state.log!)).toEqual(["coordinator", "pcb-placement-routing", "coordinator-2"]);
    expect(of(run.events, "specialist_finished").map((event) => [event.role, event.status])).toEqual([["pcb-placement-routing", "accepted"]]);
    expect(verdictsOf(history)).toEqual(["task-1-pcb-placement-routing.merge-*:decision:accepted"]);
    const [document] = await taskTraces(run.runId!, 1, "pcb-placement-routing");
    expect(document!.events.filter((event) => event.kind === "tool_invocation").map((event) => event.toolId)).toEqual(["sirkit.pcb.board-inspect"]);
    expect(traces).toHaveLength(1);
    expect(traces[0]!.terminal).toMatchObject({ outcome: "completed" });
    expect(terminals(run.events)[0]).toMatchObject({ type: "run_completed" });
  });

  it("6. lower-power timer replacement with provider disagreement (:868): runbook scenario 17 (:1183) - the circuit specialist runs on ANTHROPIC and the schematic specialist on OPENAI (server-env routing, OD-117), each through its own real adapter; where a verifier decides - the circuit specialist's delete of U1 is refused by the Tier 1 compiler (`pins-unavailable`), the schematic specialist's exact replacement seals - the one accepted replacement is emitted through its family's event and APPROVED by the run's principal through the existing path; where both seal and disagree on U1, both are `contradicted`, ONE escalation cites the server-owned exact authority, no majority, NOTHING is emitted for approval", async () => {
    vi.stubEnv("SIRKIT_ORCHESTRATION_ROLE_MODELS", JSON.stringify({ "circuit-topology": { provider: "anthropic", model: "inherit" } }));
    await installCatalog(SCOPE);
    const fetchBoundary = stubReplacementAuthorityFetch();
    const live = await principalOf(SCOPE);
    // (a) a deterministic verifier decides
    const editor = await timerEditor(SCOPE);
    const decided = await post(timerBody(editor, SCENARIO_17));
    const decidedHistory = await historyOf(decided.runId);
    expectClosedVocabulary(decided.events, decidedHistory);
    const providerOf = (role: string): string[] => state.log!.calls.filter((call) => call.role === role).map((call) => `${call.provider}:${call.model}`);
    expect([...new Set(providerOf("circuit-topology"))]).toEqual(["anthropic:claude-opus-4-7"]);
    expect([...new Set(providerOf("schematic"))]).toEqual(["openai:gpt-5.6-sol"]);
    const started = of(decided.events, "specialist_started");
    expect(started.filter((event) => event.role === "circuit-topology").map((event) => event.provider)).toEqual(["anthropic"]);
    expect(started.filter((event) => event.role === "schematic").map((event) => event.provider)).toEqual(["openai"]);
    expect(lines(decided.events)).toContain("Orchestration: specialist circuit-topology (task task-1-circuit-topology, attempt 0) tool sirkit.schematic.propose-tier1-edit refused: proposal_blocked.");
    expect(verdictsOf(decidedHistory)).toEqual(["task-1-circuit-topology.merge-*:decision:accepted", "task-2-component-sourcing-evidence.merge-*:decision:accepted", "task-3-schematic.merge-*:decision:accepted", "task-4-verification-critic.merge-*:decision:accepted"]);
    const presented = artifactsOf(decided.events);
    expect(presented.map((event) => [event.type, event.toolId, event.runId])).toEqual([["proposal_ready", REPLACEMENT, decided.runId]]);
    const received = receiveReplacementProposalEvent(presented[0]!)!;
    expect(received.proposal.target).toMatchObject({ partId: FIXTURE_EXACT.exactMpn, atomicPartRevisionId: FIXTURE_EXACT.atomicPartRevisionId });
    const [circuitTrace] = await taskTraces(decided.runId!, 1, "circuit-topology");
    expect(circuitTrace!.provider).toBe("anthropic");
    const [schematicTrace] = await taskTraces(decided.runId!, 3, "schematic");
    expect(schematicTrace!.provider).toBe("openai");
    const applied = await approveReplacement(editor, received.proposal, received.runId!, SCOPE);
    expect(applied, JSON.stringify(applied)).toMatchObject({ ok: true, status: "committed" });
    if (!applied.ok || applied.status !== "committed") return;
    expect(fetchBoundary.calls()).toBe(1);
    expect(applied.receipt.originRunId).toBe(decided.runId);
    expect(applied.receipt.authorization.principalId).toBe(live.principalId);
    // (b) both seal and disagree on U1: escalated, nothing presented
    state.log = fixtureClientLog();
    const second = await timerEditor(SCOPE);
    const escalated = await post(timerBody(second, SCENARIO_17_VARIANTS[0]));
    const escalatedHistory = await historyOf(escalated.runId);
    expectClosedVocabulary(escalated.events, escalatedHistory);
    expect(verdictsOf(escalatedHistory)).toEqual(["task-1-circuit-topology.merge-*:dissent:contradicted", "task-2-component-sourcing-evidence.merge-*:decision:accepted", "task-3-schematic.merge-*:dissent:contradicted", "task-4-verification-critic.merge-*:decision:accepted", "merge:decision:escalated"]);
    expect(lines(escalated.events).filter((line) => line.startsWith("Orchestration: merge: ESCALATED to the human (same_field; part): task-1-circuit-topology action 0 vs task-3-schematic action 0"))).toHaveLength(1);
    expect(artifactsOf(escalated.events)).toEqual([]);
    expect(lines(escalated.events).some((line) => line.includes("presented for approval:"))).toBe(false);
    expect(texts(escalated.events).at(-1)).toContain("approval: escalated");
    const escalation = escalatedHistory.find((entry) => entry.taskId.startsWith(MERGE_TASK_PREFIX))!.record as { reason: string };
    expect(escalation.reason).toMatch(/^merge escalated same_field \(part\) over component:u1-id: task-1-circuit-topology#0, task-3-schematic#0; /);
    const envelope = state.log!.envelopes.at(-1)!;
    expect(envelope).toContain('"approval":{"outcome":"escalated","presented":null}');
    expect(envelope).toContain('"humanDecision":"The human must decide:');
    expect(envelope).toContain(`Nothing was applied. The server-owned exact authority for u1-id is ${FIXTURE_EXACT.exactMpn} (${FIXTURE_EXACT.atomicPartRevisionId}); only it may be a replacement target (OD-130)`);
    expect(second.executed()).toBe(0);
  });

  it("7. missing component evidence (:869): the sourcing specialist reads the authority and returns NO evidence - its result is accepted as its own claim with an empty evidence list and its blocking question, the merge invents none (no evidence reference anywhere in the record or the envelope); and where no component authority binding loads the sourcing specialist is NOT RUN (`role_has_no_tools`): its task records the gap as dissent `escalated` and the partial result counts it", async () => {
    await installCatalog(SCOPE);
    const editor = await timerEditor(SCOPE);
    const sentence = SCENARIO_17_VARIANTS[1];
    const run = await post(timerBody(editor, sentence));
    const history = await historyOf(run.runId);
    expectClosedVocabulary(run.events, history);
    const sourcing = history.find((entry) => entry.taskId === "task-2-component-sourcing-evidence" && entry.record.kind === "result")!.record as unknown as { document: { evidence: unknown[]; unresolvedQuestions: Array<{ blocking: boolean }> } };
    expect(sourcing.document.evidence).toEqual([]);
    expect(sourcing.document.unresolvedQuestions).toEqual([expect.objectContaining({ id: "q-evidence-gap", blocking: true })]);
    for (const entry of history.filter((item) => item.record.kind === "result")) expect((entry.record as unknown as { document: { evidence: unknown[] } }).document.evidence, entry.taskId).toEqual([]);
    expect(evidenceLists(history).filter((list) => list.length > 0), "no evidence reference anywhere in the record").toEqual([]); // [B21 F fix: tests-05] every record entry, the merge's verdicts among them
    const judgedEnvelope = envelopeBody(state.log!.envelopes.at(-1)!);
    expect(evidenceLists(judgedEnvelope).length, "the envelope carries its evidence lists (claims, verifications)").toBeGreaterThan(0);
    expect(evidenceLists(judgedEnvelope).filter((list) => list.length > 0), "no evidence reference anywhere in the envelope: the merge invents none").toEqual([]);
    const followUp = state.log!.calls.findIndex((call) => call.followUp);
    expect(followUp).toBeGreaterThan(0);
    expect(verdictsOf(history).every((verdict) => verdict.endsWith("decision:accepted"))).toBe(true);
    const [sourcingTrace] = await taskTraces(run.runId!, 2, "component-sourcing-evidence");
    expect(sourcingTrace!.events.filter((event) => event.kind === "tool_invocation").map((event) => event.toolId)).toEqual(["sirkit.component-authority.inspect"]);
    expect(state.log!.envelopes.at(-1)).toContain('"unresolvedQuestions":[{"id":"q-evidence-gap"');
    // no binding at all: the sourcing specialist is not run
    resetCatalog();
    state.log = fixtureClientLog();
    const bare = await timerEditor(SCOPE);
    const gap = await post(timerBody(bare, sentence));
    const gapHistory = await historyOf(gap.runId);
    expectClosedVocabulary(gap.events, gapHistory);
    expect(startedRoles(state.log!)).not.toContain("component-sourcing-evidence");
    expect(of(gap.events, "degraded").filter((event) => event.reason === "role_has_no_tools").map((event) => event.role)).toEqual(["component-sourcing-evidence"]);
    const dissent = gapHistory.find((entry) => entry.taskId === "task-2-component-sourcing-evidence" && entry.record.kind === "dissent")!.record as { decision: string; reason: string };
    expect(dissent.decision).toBe("escalated");
    expect(dissent.reason).toMatch(/^role_has_no_tools: .*its evidence stays missing$/);
    expect(of(gap.events, "partial_result").length).toBeGreaterThan(0);
    expect(await taskTraces(gap.runId!, 2, "component-sourcing-evidence")).toEqual([]); // never ran: no trace document
  });

  it("8. stale revision during parallel specialists (:870): the specialists commit against head H1 and the run stands down (its follow-up turn failed); a commit lands (H2) and the RESUME under the same run id finds every result committed against H1 `stale` - dissent with the committed digest, re-run once under its next attempt against H2 (the merge's scope is H2's) - while the H1 records stay in the append-only record unchanged; a resume at an unmoved head replays instead (never re-run, never re-paid)", async () => {
    await installCatalog(SCOPE);
    const editor = await timerEditor(SCOPE);
    const sentence = B21_F_SENTENCES.stale;
    state.log!.followUpFails = true;
    const first = await post(timerBody(editor, sentence));
    expect(of(first.events, "degraded").map((event) => event.reason)).toEqual(["follow_up_failed"]);
    const before = (await historyOf(first.runId)).filter((entry) => entry.record.kind === "result").map((entry) => [entry.taskId, entry.attempt, entry.recordDigest]);
    expect(before).toHaveLength(4);
    // the commit lands: the resume carries H2
    state.log = fixtureClientLog();
    state.log.followUpFails = true;
    const resumed = await post(movedTimerBody(editor, sentence, { resumeRunId: first.runId }));
    expect(resumed.runId).toBe(first.runId);
    const history = await historyOf(first.runId);
    expectClosedVocabulary(resumed.events, history);
    expect(of(resumed.events, "specialist_finished").filter((event) => event.status === "stale").map((event) => event.role)).toEqual(["circuit-topology", "component-sourcing-evidence", "schematic", "verification-critic"]);
    expect(startedRoles(state.log)).toEqual(["circuit-topology", "component-sourcing-evidence", "schematic", "verification-critic", "coordinator-2"]);
    const stale = history.filter((entry) => entry.record.kind === "dissent" && (entry.record as { decision: string }).decision === "stale");
    expect(stale.map((entry) => [entry.taskId, entry.attempt])).toEqual([["task-1-circuit-topology", 1], ["task-2-component-sourcing-evidence", 1], ["task-3-schematic", 1], ["task-4-verification-critic", 1]]);
    for (const [index, entry] of stale.entries()) expect((entry.record as { subjectDigest: string }).subjectDigest).toBe((history.find((item) => item.taskId === before[index]![0] && item.record.kind === "result" && item.attempt === 0)!.record as { digest: string }).digest);
    expect(history.filter((entry) => entry.record.kind === "result").map((entry) => [entry.taskId, entry.attempt])).toEqual([...before.map(([taskId, attempt]) => [taskId, attempt]), ["task-1-circuit-topology", 2], ["task-2-component-sourcing-evidence", 2], ["task-3-schematic", 2], ["task-4-verification-critic", 2]]);
    for (const [taskId, attempt, digest] of before) expect(history.find((entry) => entry.taskId === taskId && entry.attempt === attempt && entry.record.kind === "result")!.recordDigest).toBe(digest);
    // an unmoved head: the committed H2 results replay
    state.log = fixtureClientLog();
    const replay = await post(movedTimerBody(editor, sentence, { resumeRunId: first.runId }));
    expectClosedVocabulary(replay.events, await historyOf(first.runId));
    expect(of(replay.events, "specialist_finished").map((event) => event.status)).toEqual(["replayed", "replayed", "replayed", "replayed"]);
    expect(startedRoles(state.log)).toEqual(["coordinator-2"]);
    expect((await taskTraces(first.runId!, 1, "circuit-topology")).map((trace) => trace.terminal.outcome)).toEqual(["completed", "completed"]); // H1's document and the re-run's next one; the replay adds none
    expect(traces).toHaveLength(3); // one coordinator trace per request
  });

  it("9. one specialist timeout (:871): the first specialist never answers; its OWN deadline ends it - `deadline` for that task only (dissent `escalated`), every later specialist still runs and the follow-up turn answers over the partial set; the stream names the one escalated task and the partial result; one terminal, `run_completed`", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    await installCatalog(SCOPE);
    const editor = await timerEditor(SCOPE);
    const pending = post(timerBody(editor, B21_F_SENTENCES.timeout));
    await vi.advanceTimersByTimeAsync(121_000);
    const run = await pending;
    vi.useRealTimers();
    const history = await historyOf(run.runId);
    expectClosedVocabulary(run.events, history);
    expect(of(run.events, "specialist_finished").map((event) => [event.role, event.status, event.reason])).toEqual([["circuit-topology", "escalated", "deadline"], ["component-sourcing-evidence", "accepted", null], ["schematic", "accepted", null], ["verification-critic", "accepted", null]]);
    expect(history.find((entry) => entry.taskId === "task-1-circuit-topology" && entry.record.kind === "dissent")!.record).toMatchObject({ decision: "escalated", reason: "deadline" });
    expect(of(run.events, "partial_result").at(-1)).toMatchObject({ planned: 4, usable: 3, handedOn: true });
    expect(startedRoles(state.log!).at(-1)).toBe("coordinator-2");
    const [stalled] = await taskTraces(run.runId!, 1, "circuit-topology");
    expect(stalled!.terminal).toMatchObject({ outcome: "failed", failureReason: "deadline" });
    expect(terminals(run.events)[0]).toMatchObject({ type: "run_completed" });
  });

  it("10. provider quota failure (:872): the first specialist's call answers `429 insufficient_quota` - the breaker opens at once, the task is escalated and NO further paid call is made (no retry, no other specialist, no follow-up turn); the degradation is visible (`provider_outage`) and the coordinator's answer stands; no Retry is offered for the quota reason, and the NEXT request makes no call at all - ONE `run_failed` `provider_breaker_open`, which the card never retries", async () => {
    await installCatalog(SCOPE);
    const editor = await timerEditor(SCOPE);
    state.log!.quotaForSpecialists = true;
    const run = await post(timerBody(editor, B21_F_SENTENCES.quota));
    const history = await historyOf(run.runId);
    expectClosedVocabulary(run.events, history);
    expect(state.log!.calls.map((call) => call.role)).toEqual(["coordinator", "circuit-topology"]);
    expect(of(run.events, "degraded").map((event) => event.reason)).toEqual(["provider_outage"]);
    expect(of(run.events, "specialist_finished").map((event) => [event.role, event.status])).toEqual([["circuit-topology", "escalated"]]);
    expect(String(of(run.events, "specialist_finished")[0]!.reason)).toMatch(/^provider_insufficient_quota: .*not retryable/);
    expect(currentLlmProviderPause({ kind: "llm-provider", provider: "openai" }, Date.now(), "agent")).toMatchObject({ reason: "breaker_open" });
    expect(history.filter((entry) => entry.record.kind === "result")).toEqual([]);
    expect(history.find((entry) => entry.taskId === "task-1-circuit-topology" && entry.record.kind === "dissent")!.record).toMatchObject({ decision: "escalated" });
    const [quotaTrace] = await taskTraces(run.runId!, 1, "circuit-topology");
    expect(quotaTrace!.terminal).toMatchObject({ outcome: "failed", failureReason: "provider_insufficient_quota" });
    expect(terminals(run.events)[0]).toMatchObject({ type: "run_completed" });
    expect(providerRetryOffered("provider_insufficient_quota")).toBe(false);
    const next = await post(timerBody(editor, B21_F_SENTENCES.quota));
    expect(next.events.map((event) => event.type)).toEqual(["run_started", "run_failed"]);
    expect(next.events[1]).toMatchObject({ reason: "provider_breaker_open" });
    expect(providerRetryOffered("provider_breaker_open")).toBe(false);
    expect(state.log!.calls).toHaveLength(2);
  });

  it("11. malicious specialist result (:873): a result naming a release tool, one claiming approval and one smuggling a secret are refused STRUCTURALLY by A's gate before their content is read (`tool_request_not_permitted`, `unknown_key`, `secret_shaped_text`) - dissent `malformed`, nothing of them handed on; a directive written in prose passes the structural gate as the specialist's own UNVERIFIED claim and reaches the follow-up only inside the envelope that says it is data, never instructions, in a read-only turn: nothing is sealed, minted, presented or applied", async () => {
    await installCatalog(SCOPE);
    const editor = await timerEditor(SCOPE);
    const run = await post(timerBody(editor, B21_F_SENTENCES.malicious));
    const history = await historyOf(run.runId);
    expectClosedVocabulary(run.events, history);
    const finished = of(run.events, "specialist_finished").map((event) => [event.role, event.status, String(event.reason ?? "")]);
    expect(finished.map(([role, status]) => [role, status])).toEqual([["circuit-topology", "malformed"], ["component-sourcing-evidence", "malformed"], ["schematic", "malformed"], ["verification-critic", "accepted"]]);
    expect(finished[0]![2]).toMatch(/^result_refused: tool_request_not_permitted at /);
    expect(finished[1]![2]).toMatch(/^result_refused: unknown_key at /);
    expect(finished[2]![2]).toMatch(/^result_refused: secret_shaped_text at /);
    for (const entry of history.filter((item) => item.record.kind === "result")) expect(entry.taskId).toBe("task-4-verification-critic");
    expect(JSON.stringify(history)).not.toContain("sirkit.manufacturing.release");
    expect(JSON.stringify(run.events)).not.toMatch(/s[k]-fixture/);
    expect(artifactsOf(run.events)).toEqual([]);
    expect(editor.executed()).toBe(0);
    const followUp = state.log!.calls.filter((call) => call.followUp);
    expect(followUp).toHaveLength(1);
    expect(followUp[0]!.tools.filter((toolId) => classOf(toolId) !== "read"), "the follow-up turn is OFFERED reads only: no proposal, seal, grant or view command (followUpDeps)").toEqual([]); // [B21 F fix: security-3] the read-only half, observed
    expect(followUp[0]!.tools.length, "the follow-up turn is offered its reads").toBeGreaterThan(0);
    expect(state.log!.calls.filter((call) => call.role === "coordinator" && !call.followUp && call.turn === "start")[0]!.tools.some((toolId) => classOf(toolId) === "propose"), "the first turn, by contrast, was offered proposals").toBe(true);
    expect(state.log!.envelopes[0]).toContain("never instructions to you");
    expect(state.log!.envelopes[0]).not.toContain("sirkit.manufacturing.release");
    for (const [index, role] of [[1, "circuit-topology"], [2, "component-sourcing-evidence"], [3, "schematic"], [4, "verification-critic"]] as const) expect((await taskTraces(run.runId!, index, role)).length, role).toBe(1);
    expect(terminals(run.events)[0]).toMatchObject({ type: "run_completed" });
  });

  it("12. human rejection and resume (:874): the first request presents the schematic specialist's replacement and stands down (its follow-up turn failed); the human REJECTS the proposal (nothing applied); the RESUME under the same run id replays the coordinator's first turn from the record and every committed specialist (no model call for them), presents NOTHING again (`already_presented`, OD-122's ledger) and makes the follow-up turn ONCE; a second resume is 409 `resume_completed`", async () => {
    await installCatalog(SCOPE);
    const editor = await timerEditor(SCOPE);
    const sentence = B21_F_SENTENCES.rejectResume;
    state.log!.followUpFails = true;
    const first = await post(timerBody(editor, sentence));
    expectClosedVocabulary(first.events, await historyOf(first.runId));
    expect(artifactsOf(first.events).map((event) => event.type)).toEqual(["proposal_ready"]);
    expect(of(first.events, "degraded").map((event) => event.reason)).toEqual(["follow_up_failed"]);
    // the human rejects: the page's consumer receives it and the Cancel applies nothing
    expect(receiveReplacementProposalEvent(artifactsOf(first.events)[0]!)).not.toBeNull();
    expect(editor.executed()).toBe(0);
    state.log = fixtureClientLog();
    const resumed = await post(timerBody(editor, sentence, { resumeRunId: first.runId }));
    expect([resumed.status, resumed.runId]).toEqual([200, first.runId]);
    const history = await historyOf(first.runId);
    expectClosedVocabulary(resumed.events, history);
    expect(startedRoles(state.log)).toEqual(["coordinator-2"]);
    expect(of(resumed.events, "specialist_finished").map((event) => event.status)).toEqual(["replayed", "replayed", "replayed", "replayed"]);
    expect(lines(resumed.events).some((line) => line.startsWith(`Orchestration: resumed run ${first.runId}:`))).toBe(true);
    expect(artifactsOf(resumed.events)).toEqual([]);
    expect(lines(resumed.events).some((line) => line.startsWith("Orchestration: nothing from the specialists is presented for approval (already_presented):"))).toBe(true);
    expect(terminals(resumed.events)[0]).toMatchObject({ type: "run_completed" });
    const record = (await orchestrationResumeStoreOf(store)!.history({ ...SCOPE, runId: first.runId! })).map((entry) => entry.entry.kind);
    expect(record.filter((kind) => kind === "artifact")).toHaveLength(1);
    expect(record.at(-1)).toBe("follow-up");
    expect(traces).toHaveLength(2); // the first request's and the resume's coordinator traces
    expect(traces[1]!.events.filter((event) => event.kind === "step")).toHaveLength(1); // the replayed first turn makes no step: only the follow-up's
    state.log = fixtureClientLog();
    const finished = await post(timerBody(editor, sentence, { resumeRunId: first.runId }));
    expect([finished.status, finished.json?.code]).toEqual([409, "resume_completed"]);
    expect(state.log.calls).toEqual([]);
  });

  it("13. D21-40 closed: under the fixture runtime's opt-in the production factory hands every specialist the scripted fixture agent, and it answers THROUGH the strict result tool - its provider name is the result tool's, every scripted sentence routes to a DAG, and each of its roles is a specialist role", async () => {
    expect(FIXTURE_RESULT_TOOL_NAME).toBe(SPECIALIST_RESULT_TOOL_NAME);
    vi.stubEnv("SIRKIT_FIXTURE_RUNTIME", "blinker"); vi.stubEnv("SIRKIT_AUTH_MODE", "local_dev"); vi.stubEnv(FIXTURE_AGENT_ENV, FIXTURE_AGENT_SCRIPTED);
    const adapters = await vi.importActual<typeof import("@/app/lib/agent/adapters")>("@/app/lib/agent/adapters");
    const specialist = adapters.agentAdapterForRole("verification-critic", "openai");
    expect(specialist).toBeInstanceOf(FixtureAgentAdapter);
    const tools = [{ providerName: SPECIALIST_RESULT_TOOL_NAME, toolId: "orchestration.specialist-result", version: "1.0.0", description: "", inputSchema: {} }];
    const step = await specialist.start({ system: "frame\nRole: verification-critic\n", history: [], userMessage: `As the verification-critic specialist, address this request with reads only and report structured evidence: ${SCENARIO_17}`, tools });
    expect(step.toolCalls).toHaveLength(1);
    expect(step.toolCalls[0]!.providerName).toBe(SPECIALIST_RESULT_TOOL_NAME);
    expect(JSON.parse(step.toolCalls[0]!.argumentsText)).toMatchObject({ role: "verification-critic", confidence: "low" });
    for (const [key, roles] of Object.entries(FIXTURE_ROLE_SCRIPTS)) {
      const sentence = Object.values(B21_F_SENTENCES).find((candidate) => fixtureSentenceKey(candidate) === key) ?? SCENARIO_17_VARIANTS.find((candidate) => fixtureSentenceKey(candidate) === key) ?? (fixtureSentenceKey(SCENARIO_17) === key ? SCENARIO_17 : undefined);
      expect(sentence, key).toBeDefined();
      expect(routeTaskComplexity(sentence!, { hasSchematic: true, hasBoard: true, actorRole: "pcb_editor", autonomyMode: "proposal_only", selectionCount: 0 }).kind, key).toBe("dag");
      for (const role of Object.keys(roles)) expect(["circuit-topology", "component-sourcing-evidence", "schematic", "pcb-placement-routing", "verification-critic", "manufacturing-readiness-reviewer", "requirements-analyst"], role).toContain(role);
    }
  });

  it("14. the matrix byte-gate: `evaluation-matrix.csv` and `evaluation-matrix.json` ARE the case table's rendering byte for byte (the generator's output); twelve rows, one per runbook line :863..:874, each naming a case title of THIS suite that exists exactly once", () => {
    expect(readFileSync(join(ROOT, "artifacts/ai-control-plane-b21/evaluation-matrix.csv"), "utf8")).toBe(evaluationMatrixCsv());
    expect(readFileSync(join(ROOT, "artifacts/ai-control-plane-b21/evaluation-matrix.json"), "utf8")).toBe(evaluationMatrixJson());
    expect(B21_F_CASES.map((entry) => entry.runbookLine)).toEqual([863, 864, 865, 866, 867, 868, 869, 870, 871, 872, 873, 874]);
    const suite = readFileSync(join(ROOT, "app/lib/agent/orchestration/__tests__/b21-f-evaluation.test.ts"), "utf8");
    for (const entry of B21_F_CASES) expect(suite.split(`it("${entry.suiteCase} (:${entry.runbookLine})`).length - 1, entry.id).toBe(1);
    expect([B21_F_SENTENCES.timer, B21_F_SENTENCES.timerBothSeal, B21_F_SENTENCES.missing]).toEqual([SCENARIO_17, ...SCENARIO_17_VARIANTS]); // D3's own sentences, verbatim
  });

  it("15. the pins: every `orchestration` capsule (v4, per-task step lists, scripted stalls and failures) replays through the real runtime to the digests `replay-trace-pins-b21.json` pins - its coordinator trace and its replay (events, record, per-task traces) - passes its own checks, and names the runbook line of a matrix row that lists it; the B11 pins it extends are named by their sha256 and were not moved", async () => {
    const pinned = JSON.parse(readFileSync(join(ROOT, B21_REPLAY_PINS_FILE), "utf8")) as { schema: string; extends: { file: string; sha256: string; moved: unknown[] }; category: string; pins: Record<string, { trace: string; replay: string }> };
    expect(pinned.schema).toBe(B21_REPLAY_PINS_SCHEMA);
    expect(pinned.category).toBe(ORCHESTRATION_EVALUATION_CATEGORY);
    expect(pinned.extends).toMatchObject({ file: B11_REPLAY_PINS_FILE, moved: [] });
    expect(pinned.extends.sha256).toBe(createHash("sha256").update(readFileSync(join(ROOT, B11_REPLAY_PINS_FILE))).digest("hex"));
    const cases = buildOrchestrationEvaluationCases();
    expect(Object.keys(pinned.pins).sort()).toEqual(cases.map((entry) => entry.caseId).sort());
    for (const entry of cases) {
      const replay = await runOrchestrationCase(entry);
      expect(replay.route, `${entry.caseId}: the router's answer for its sentence and context, observed in the replay`).toEqual((entry.capsule.tasks ?? []).length > 0 ? expect.objectContaining({ kind: "dag" }) : { kind: "single", rule: "S-default" }); // [B21 F fix: tests-03] a single capsule is routed, never assumed
      const scored = scoreOrchestrationCase(entry, replay);
      expect(scored.checks.filter((item) => !item.pass), entry.caseId).toEqual([]);
      expect({ trace: replay.traceDigest, replay: replay.replayDigest }, entry.caseId).toEqual(pinned.pins[entry.caseId]);
      expect(B21_F_CASES.find((row) => row.runbookLine === entry.runbookLine)!.pins, entry.caseId).toContain(entry.caseId);
    }
  }, 60_000);

  it("16. provider quota failure on the coordinator's FIRST turn (:872, D21-42's limit): on a no-credits account whose first turn answers the `429 insufficient_quota` the request stands down before any specialist - one `run_failed` `provider_insufficient_quota`, no plan, no specialist, nothing recorded, no Retry offered - and, the first turn being GATED but not METERED, the breaker stays CLOSED: the next request makes its one paid call again and fails the same way (RECORDED: only a metered call - a specialist's or the follow-up turn's - opens the breaker)", async () => {
    await installCatalog(SCOPE);
    const editor = await timerEditor(SCOPE);
    state.log!.quotaForCoordinator = true;
    for (const attempt of [1, 2]) {
      const run = await post(timerBody(editor, B21_F_SENTENCES.quota));
      const history = await historyOf(run.runId);
      expectClosedVocabulary(run.events, history);
      expect(history, `request ${attempt}`).toEqual([]);
      expect(terminals(run.events), `request ${attempt}`).toEqual([expect.objectContaining({ type: "run_failed", reason: "provider_insufficient_quota" })]);
      for (const type of ORCHESTRATION_RUN_EVENT_TYPES) expect(of(run.events, type), `request ${attempt}: ${type}`).toEqual([]);
      expect(currentLlmProviderPause({ kind: "llm-provider", provider: "openai" }, Date.now(), "agent"), `request ${attempt}: the breaker stays closed`).toBeNull();
      expect(state.log!.calls.map((call) => [call.role, call.turn]), `request ${attempt}`).toEqual(Array.from({ length: attempt }, () => ["coordinator", "start"]));
    }
    expect(providerRetryOffered("provider_insufficient_quota")).toBe(false);
  });
});
