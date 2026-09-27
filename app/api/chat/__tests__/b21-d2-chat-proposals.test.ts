/**
 * [B21 D2] Specialists propose through their existing tools, end to end through the PRODUCTION POST (adapters mocked - the
 * B18-D / B21-B pattern; the gateway, the loop, the scheduler, the merge and the runtime are the real ones). Flag OFF the four
 * streams stay byte-identical to HEAD's (B's recorded digests). Flag ON: two proposing specialists SEAL conflicting values of U1
 * through their own offered Tier 1 tool - the merge escalates once, nothing is emitted for approval, the stream carries the
 * escalation line and the follow-up envelope says what the human must decide; exactly one sealed proposal with nothing sealed by
 * the coordinator is emitted as the run's own `proposal_ready` and is APPROVED through the product's existing Tier 1 path with the
 * run's principal reauthorized by the real apply-authorization route; a coordinator that sealed its own proposal keeps it the run's
 * one artifact; and a non-exact replacement target (OD-130) never reaches the merge at the route - the model-written artifact is
 * refused before it (`proposal_not_sealed_in_run`) and no specialist is offered the replacement tool (dormant: pin facts).
 * [B21 D2 fix] Once the coordinator sealed its own proposal the specialists are offered none (OD-122's `proposal_exists` clause), so a
 * same-component disagreement can never be listed as an accepted specialist action; the presentation is ALWAYS on the finalized trace
 * with its artifact id and digest, past the 12-line cap; and a peer whose conflicting seal never reached the merge withholds it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SchematicState } from "@/lib/schematic-types";
import { schematicStateDigest } from "@/app/lib/engineering/schematic-model";
import { createEmptyBoard } from "@/app/lib/pcb/types";
import { pcbRevisionId } from "@/app/lib/pcb/revision";
import { replacementHeadDigestFor } from "@/app/lib/engineering/replacement-proposal-assembler";
import { engineeringDigest } from "@/app/lib/engineering/stable";
import { InMemoryDurableWorkflowRepository } from "@/app/lib/durable-workflow/repository";
import { SchematicEditorSession } from "@/app/lib/engineering/schematic-session";
import { SchematicGestureCoordinator } from "@/app/lib/engineering/schematic-gesture-coordinator";
import { InMemoryAtomicProjectStore } from "@/app/lib/engineering/persistence";
import { ProjectCommitInterlock } from "@/app/lib/engineering/project-commit-interlock";
import { ApprovedMutationJournal, InMemoryApprovedMutationJournalStore } from "@/app/lib/engineering/approved-mutation-journal";
import { ApprovedMutationAuditLedger, ApprovedMutationRegistry, applyApprovedTier1Proposal } from "@/app/lib/engineering/approved-agent-mutations";
import { TIER1_PROPOSAL_SCHEMA, type SealedTier1Proposal } from "@/app/lib/engineering/schematic-proposals";
import { SchematicHistory } from "@/app/lib/project/schematic-history";
import { adoptCanonicalResult } from "@/app/lib/project/canonical-adoption";
import { receiveReplacementProposalEvent } from "@/app/lib/project/replacement-proposal-events";
import { parseMembershipReauthorization, type MembershipReauthorizer } from "@/app/lib/project/membership-reauthorization";
import { DurableOrchestrationRunStore, type OrchestrationRunEntry } from "@/app/lib/agent/orchestration/store";
import { MERGE_TASK_PREFIX } from "@/app/lib/agent/orchestration/merge";
import { action, sealOtherPartReplacement, sealTier1 } from "@/app/lib/agent/orchestration/__tests__/_merge-fixtures";
import { InMemoryTraceSink, setAgentTraceSinkFactory } from "@/app/lib/agent/trace-recorder";
import { sanitizeTraceText } from "@/app/lib/agent/redaction";
import type { AgentRunTrace } from "@/app/lib/agent/trace";

const state = vi.hoisted(() => ({
  starts: [] as Array<{ role: string; system: string; userMessage: string; tools: string[] }>,
  /** per turn (a specialist by its role, the coordinator's first turn `coordinator`, its follow-up `coordinator-2`): one tool call before
   *  the final text; [B21 D2 fix] `noise` unknown-tool calls ride the same step first (each refused `unknown_tool` by the loop) */
  calls: {} as Record<string, { toolId?: string; args?: Record<string, unknown>; noise?: number }>,
  /** per specialist role: its final text (absent: an empty valid result document) */
  results: {} as Record<string, string>,
  pending: [] as string[],
}));

vi.mock("@/app/lib/agent/adapters", async () => {
  const { answer, registryToolIds } = await import("@/app/lib/agent/orchestration/__tests__/_result-tool"); // [B21 E1] pin move: the route binds the provider layer, which builds every specialist's adapter through agentAdapterForRole (the same scripted double here); a specialist answers THROUGH the strict result tool it is offered (OD-116) and the offered tools are recorded without that synthetic declaration
  const scripted = () => {
    const usage = { inputTokens: 3, outputTokens: 5 };
    const continuation = { provider: "openai" as const, state: null };
    const textOf = (turn: string, role: string, userMessage: string): string => role !== "coordinator"
      ? state.results[role] ?? JSON.stringify({ schema: "sirkit.specialist-result.v1", role, summary: `(scripted) ${role}: nothing found; nothing changed.`, proposedActions: [], assumptions: [], evidence: [], requiredTools: [], risks: [], unresolvedQuestions: [], validationRequests: [], confidence: "low" })
      : turn === "coordinator-2" ? "(scripted) The follow-up turn answers from the merge." : `(scripted) One coordinator turn for: ${userMessage.slice(0, 80)}`;
    const firsts = new Map<string, string>();
    const offered = new Map<string, ReadonlyArray<{ toolId: string; providerName: string }>>();
    return {
      provider: "openai",
      async start(input: { system: string; userMessage: string; tools: ReadonlyArray<{ toolId: string; providerName: string }> }) {
        const role = /^Role: ([a-z-]+)$/m.exec(input.system)?.[1] ?? "coordinator";
        state.starts.push({ role, system: input.system, userMessage: input.userMessage, tools: registryToolIds(input.tools) });
        offered.set(role, input.tools);
        const turn = role === "coordinator" && state.starts.filter((start) => start.role === "coordinator").length === 2 ? "coordinator-2" : role;
        firsts.set(turn, input.userMessage);
        const call = state.calls[turn];
        const tool = call?.toolId ? input.tools.find((entry) => entry.toolId === call.toolId) : undefined;
        const noise = Array.from({ length: call?.noise ?? 0 }, (_, index) => ({ callId: `noise-${turn}-${index}`, providerName: `sirkit_not_offered_${index}`, argumentsText: "{}" }));
        const toolCalls = [...noise, ...(tool ? [{ callId: `call-${turn}`, providerName: tool.providerName, argumentsText: JSON.stringify(call?.args ?? {}) }] : [])];
        if (toolCalls.length > 0) {
          state.pending.push(turn);
          return { text: "", toolCalls, stopReason: "tool_use", usage, model: "scripted", continuation };
        }
        return { text: textOf(turn, role, input.userMessage), toolCalls: [], stopReason: "completed", usage, model: "scripted", continuation, ...answer(textOf(turn, role, input.userMessage), input.tools) };
      },
      async continueWith() {
        const turn = state.pending.pop() ?? "coordinator";
        const role = turn === "coordinator-2" ? "coordinator" : turn;
        return { text: textOf(turn, role, firsts.get(turn) ?? ""), toolCalls: [], stopReason: "completed", usage, model: "scripted", continuation, ...answer(textOf(turn, role, firsts.get(turn) ?? ""), offered.get(role) ?? []) };
      },
    };
  };
  return { agentAdapterFor: scripted, agentAdapterForRole: scripted };
});

import { POST, EDITOR_CONTEXT_SCHEMA } from "../route";
import { resetAdmissionControl } from "@/app/lib/acquisition/admission-control";
import { POST as APPLY_AUTHORIZATION } from "../../pcb/apply-authorization/route";
import { ORCHESTRATION_ENABLED_ENV, resetOrchestrationStoreFactory, setOrchestrationStoreFactory } from "../orchestration-runtime";

const SCOPE = { tenantId: "tenant-1", projectId: "project-1", branchId: "main" };
const TIER1 = "sirkit.schematic.propose-tier1-edit";
const REPLACEMENT = "sirkit.schematic.propose-component-replacement";
/** B's request, byte for byte (b21-b-chat-router.test.ts), so the flag-off streams reproduce B's pins recorded from HEAD 4b6d0e2 */
const B_SCHEMATIC: SchematicState = {
  components: [], wires: [], netLabels: [],
  kicadComponents: [{ id: "u1-id", partId: "lib:part-a", x: 300, y: 100, rotation: 0, refDes: "U1", value: "MCU", atomicPartRevisionId: "rev-current", symbolAssetVersionId: "sym-current" }],
};
const B_HEAD_MARK = { lineageId: "lin1-a9e2470c11bd8833", headSequence: 3, canonicalStateDigest: replacementHeadDigestFor(B_SCHEMATIC, SCOPE) };
function chatBody(sentence: string, schematic: SchematicState = B_SCHEMATIC, headMark: unknown = B_HEAD_MARK) {
  const board = createEmptyBoard();
  return {
    provider: "openai", messages: [{ role: "user", content: sentence }], scope: SCOPE, schematicState: schematic, schematicHeadMark: headMark,
    editorContext: { schema: EDITOR_CONTEXT_SCHEMA, scope: SCOPE, board, pcbRevisionId: pcbRevisionId(board), selection: { refs: [], primary: null }, netlist: null, schematicDigest: schematicStateDigest(schematic), authoritySource: "local-working-copy" },
  };
}
const BODIES = {
  simple: "Move R3 2 mm to the right.",
  view: "Open the 3D view, hide the top silkscreen, focus on J1, and switch to an isometric view.",
  replacement: "Delete U1 and replace it with the approved lower-power part while preserving compatible nets.",
  tier3: "Release the board to manufacturing.",
} as const;
/** B's pins: the digests of the four flag-off streams RECORDED from HEAD 4b6d0e2 (b21-b-chat-router.test.ts HEAD_STREAMS) */
const HEAD_DIGESTS: Record<keyof typeof BODIES, string> = { simple: "eng1-656c2588b836c043", view: "eng1-07aaf2589736c9f7", replacement: "eng1-bf8822508f100b13", tier3: "eng1-9fbc41d4ee249877" };
/** a new circuit named from words: the full-circuit DAG - the circuit and schematic specialists are both proposing roles */
const DESIGN = "Design a 555 timer circuit.";
/** a circuit-level rework: the bounded schematic DAG - the schematic specialist alone */
const REWORK = "Rework the bias network of this circuit.";

async function post(body: unknown): Promise<{ runId: string; normalized: string; events: Array<Record<string, unknown>> }> {
  const response = await POST(new Request("http://localhost/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  expect(response.status).toBe(200);
  const runId = response.headers.get("X-Sirkit-Run-Id")!;
  const text = await response.text();
  return { runId, normalized: text.replaceAll(runId, "<runId>"), events: text.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>) };
}
const types = (events: Array<Record<string, unknown>>): string[] => events.map((event) => String(event.type));
const warningsOf = (events: Array<Record<string, unknown>>): string[] => events.filter((event) => event.type === "warning").map((event) => String(event.message));
const recordsOf = (history: OrchestrationRunEntry[]): string[] => history.filter((entry) => entry.record.kind === "decision" || entry.record.kind === "dissent").map((entry) => `${entry.taskId.startsWith(MERGE_TASK_PREFIX) ? "merge" : entry.taskId.replace(/\.merge-[0-9a-f]{16}$/, ".merge-*")}:${entry.record.kind}:${(entry.record as { decision: string }).decision}`);
const inMemoryStore = () => { const repository = new InMemoryDurableWorkflowRepository(); return { repository, store: new DurableOrchestrationRunStore(repository) }; };
const tier1Args = (target: string, value: string) => ({ ops: [{ op: "set-value", target, value }] });
/** The product's own reauthorization step, through the REAL apply-authorization route (the production reauthorizer minus `fetch`). */
const throughRoute: MembershipReauthorizer = async ({ scope, proposalId }) => {
  const response = await APPLY_AUTHORIZATION(new Request("http://localhost/api/pcb/apply-authorization", { method: "POST", headers: { "Content-Type": "application/json", origin: "http://localhost" }, body: JSON.stringify({ scope, proposalId }) })); // the same-origin POST the browser sends (the route enforces CSRF)
  if (!response.ok) return { ok: false, code: `http-${response.status}`, detail: "The reauthorization endpoint refused the request." };
  return parseMembershipReauthorization(await response.json());
};
/** The B12.1 production composition: a live SchematicEditorSession behind the page-host coordinator, over theory R1 / R2. */
const R_SCHEMATIC: SchematicState = { components: [{ id: "R1", type: "resistor", x: 100, y: 100, rotation: 0, value: "1k" }, { id: "R2", type: "resistor", x: 100, y: 300, rotation: 0, value: "2k" }], wires: [] };
async function schematicEditor() {
  const editor = new SchematicEditorSession(SCOPE, { store: new InMemoryAtomicProjectStore() });
  await editor.openForProject(structuredClone(R_SCHEMATIC), null);
  let visible: SchematicState = structuredClone(R_SCHEMATIC);
  const history = new SchematicHistory<SchematicState>(structuredClone(R_SCHEMATIC), { label: "Opened project" });
  const coordinator: SchematicGestureCoordinator = new SchematicGestureCoordinator({
    currentState: () => structuredClone(visible),
    applyPreviewFrame: () => {},
    applyCanonicalProjection: (label, next) => {
      const outcome = adoptCanonicalResult<SchematicState>({
        flushPendingRecord: () => {}, history: () => history,
        applyProjection: (authoritative) => { visible = structuredClone(authoritative); coordinator.notifyAuthoritativeProjection(authoritative); },
        snapshot: (authoritative) => structuredClone(authoritative), historyRecorded: () => {}, suppressEffectRecord: () => {}, scheduleAutosave: () => {},
      }, label, next);
      if (!outcome.ok) throw new Error(outcome.detail);
    },
    applyRollbackProjection: (next) => { visible = structuredClone(next); },
    execute: (base, request) => editor.execute(base, request),
    notify: () => {},
  });
  return { editor, coordinator, visible: () => structuredClone(visible) };
}
/** [B21 D2 fix] every finalized run trace, captured through the trace-sink seam (B's route suite pattern) */
function traceCapture(): AgentRunTrace[] {
  const sink = new InMemoryTraceSink();
  const traces: AgentRunTrace[] = [];
  setAgentTraceSinkFactory(() => ({ append: (event) => sink.append(event), complete: (trace) => { traces.push(trace); sink.complete(trace); } }));
  return traces;
}

describe("[B21 D2] specialists propose through their existing tools, through the chat route", () => {
  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", ""); // the shell never decides an outcome (B's rule)
    vi.stubEnv("SIRKIT_ORCHESTRATION_ROLE_MODELS", ""); vi.stubEnv("SIRKIT_OPENAI_MODEL", ""); vi.stubEnv("SIRKIT_ANTHROPIC_MODEL", "claude-opus-4-7"); // [B21 E1 fix] the route's provider layer reads the role policy and the configured models from process.env: pinned, so the shell never decides an outcome
    resetAdmissionControl(); // [B21 E1] the llm-provider meters are the process's own
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    resetAdmissionControl();
    resetOrchestrationStoreFactory();
    setAgentTraceSinkFactory(null);
    state.starts = [];
    state.calls = {};
    state.results = {};
    state.pending = [];
  });

  it("1. flag OFF (the default): the four streams are byte-identical to HEAD's - B's recorded digests - with the adapter called once per request; nothing is presented", async () => {
    expect(process.env[ORCHESTRATION_ENABLED_ENV]).toBeUndefined();
    for (const [name, sentence] of Object.entries(BODIES) as Array<[keyof typeof BODIES, string]>) {
      state.starts = [];
      const { normalized } = await post(chatBody(sentence));
      expect(engineeringDigest(normalized), name).toBe(HEAD_DIGESTS[name]);
      expect(state.starts, name).toHaveLength(1);
      expect(normalized).not.toContain("presented for approval");
    }
  });

  it("2. flag ON, the conflicting-proposals escalation END TO END: the full-circuit DAG's circuit and schematic specialists each SEAL a value of U1 through their own offered Tier 1 tool (the real gateway, in their own runs) - the merge judges both sealed-in-run, finds the same field, makes both contradicted and writes ONE escalation record; NOTHING is emitted for approval (no proposal event reaches the stream at all); the stream carries the escalation line and the follow-up envelope says what the human must decide", async () => {
    vi.stubEnv(ORCHESTRATION_ENABLED_ENV, "1");
    const { store } = inMemoryStore();
    setOrchestrationStoreFactory(() => store);
    state.calls = { "circuit-topology": { toolId: TIER1, args: tier1Args("U1", "10k") }, schematic: { toolId: TIER1, args: tier1Args("U1", "4k7") } };
    const { runId, events } = await post(chatBody(DESIGN));
    expect(state.starts.map((start) => start.role)).toEqual(["coordinator", "circuit-topology", "schematic", "verification-critic", "coordinator"]);
    for (const role of ["circuit-topology", "schematic"]) {
      const start = state.starts.find((entry) => entry.role === role)!;
      expect(start.tools, role).toContain(TIER1);
      expect(start.tools, role).not.toContain(REPLACEMENT);
    }
    expect(state.starts.find((entry) => entry.role === "verification-critic")!.tools.some((toolId) => toolId.includes("propose"))).toBe(false);
    expect(types(events).filter((type) => type === "proposal_ready" || type === "pcb_proposal_ready" || type === "layout_candidate_ready" || type === "execution_grant_ready")).toEqual([]);
    expect(types(events).filter((type) => type === "run_completed" || type === "run_failed")).toEqual(["run_completed"]);
    const warnings = warningsOf(events);
    expect(warnings.filter((message) => /^Orchestration: merge: specialist (circuit-topology|schematic) \(task [^)]+\) contradicted: conflict:same_field/.test(message))).toHaveLength(2);
    expect(warnings.filter((message) => message.startsWith("Orchestration: merge: ESCALATED to the human (same_field; part)"))).toHaveLength(1);
    expect(warnings.some((message) => message.includes("presented for approval:"))).toBe(false);
    const history = await store.history({ ...SCOPE, runId });
    expect(recordsOf(history)).toEqual(["task-2-component-sourcing-evidence:dissent:escalated", "task-1-circuit-topology.merge-*:dissent:contradicted", "task-3-schematic.merge-*:dissent:contradicted", "task-4-verification-critic.merge-*:decision:accepted", "merge:decision:escalated"]);
    // each committed result carries exactly the artifact its own run sealed
    const results = history.filter((entry) => entry.record.kind === "result").map((entry) => (entry.record as unknown as { document: { role: string; proposedActions: ReadonlyArray<{ kind: string; payload: { authorization: { principalId: string } } }> } }).document);
    expect(results.map((document) => [document.role, document.proposedActions.map((action) => action.kind)])).toEqual([["circuit-topology", [TIER1_PROPOSAL_SCHEMA]], ["schematic", [TIER1_PROPOSAL_SCHEMA]], ["verification-critic", []]]);
    const envelope = state.starts[4]!.userMessage;
    expect(envelope).toMatch(/judged by the deterministic merge/i);
    expect(envelope).toMatch(/"humanDecision":"The human must decide:[^"]*Allowed resolutions: keep_head, manual_operation, proposal_branch, reject\. Nothing was applied\./);
    expect(envelope).toContain('"conflictClass":"same_field"');
    expect(envelope).toContain('"approval":{"outcome":"escalated","presented":null}');
    expect(envelope).not.toContain('"operations"');
    expect(envelope).not.toContain('"acceptedActions":[{"taskId":"task-1');
  });

  it("3. flag ON, EXACTLY ONE sealed proposal and nothing sealed by the coordinator: the schematic specialist seals a Tier 1 edit in its own run, the merge accepts it (provenance sealed-in-run), and the runtime emits it as the run's ONE `proposal_ready` under the stream's run id; the page's consumer path takes it, and the human APPROVES it through the existing Tier 1 path - a live SchematicEditorSession at the very head the chat captured, the run's principal reauthorized by the real apply-authorization route: committed exactly once", async () => {
    vi.stubEnv(ORCHESTRATION_ENABLED_ENV, "1");
    const { store } = inMemoryStore();
    setOrchestrationStoreFactory(() => store);
    const live = await schematicEditor();
    state.calls = { schematic: { toolId: TIER1, args: tier1Args("R1", "4k7") } };
    const { runId, events } = await post(chatBody(REWORK, live.visible(), live.editor.headMark()));
    expect(state.starts.map((start) => start.role)).toEqual(["coordinator", "schematic", "coordinator"]);
    const ready = events.filter((event) => event.type === "proposal_ready");
    expect(ready).toHaveLength(1);
    expect(ready[0]).toMatchObject({ type: "proposal_ready", runId, toolId: TIER1 });
    const proposal = ready[0]!.proposal as SealedTier1Proposal;
    expect(proposal.schema).toBe(TIER1_PROPOSAL_SCHEMA);
    // emitted after the merge accepted it, before the follow-up turn and the one terminal
    const order = types(events);
    expect(order.indexOf("proposal_ready")).toBeLessThan(order.indexOf("run_completed"));
    expect(warningsOf(events)).toEqual(expect.arrayContaining([expect.stringMatching(/^Orchestration: presented for approval: task-1-schematic action 0 \(sirkit\.schematic-tier1-proposal\.v3/)]));
    const history = await store.history({ ...SCOPE, runId });
    const committed = history.find((entry) => entry.record.kind === "result")!.record as { document: { proposedActions: ReadonlyArray<{ artifactDigest: string }> } };
    expect(committed.document.proposedActions.map((action) => action.artifactDigest)).toEqual([engineeringDigest(JSON.parse(JSON.stringify(proposal)))]);
    expect(state.starts[2]!.userMessage).toContain('"approval":{"outcome":"presented"');
    // the page's consumer path, then the human's Apply through the existing boundary
    expect(receiveReplacementProposalEvent(ready[0] as never)).toBeNull();
    const applied = await applyApprovedTier1Proposal({
      proposal, session: live.editor, gateway: live.coordinator, interlock: new ProjectCommitInterlock(),
      journal: new ApprovedMutationJournal(new InMemoryApprovedMutationJournalStore(), SCOPE), reauthorize: throughRoute,
      stillCurrent: () => true, currentProjectId: SCOPE.projectId, currentBranchId: SCOPE.branchId, tenantId: SCOPE.tenantId,
      originRunId: runId, registry: new ApprovedMutationRegistry(), audit: new ApprovedMutationAuditLedger(),
    });
    expect(applied, JSON.stringify(applied)).toMatchObject({ ok: true, status: "committed" });
    expect(live.visible().components.find((component) => component.id === "R1")?.value).toBe("4k7");
    expect(live.editor.headMark()!.headSequence).toBe(1);
  });

  it("4. flag ON, the coordinator's first turn SEALS its own proposal and the schematic specialist is scripted to seal a CONFLICTING one on the same component (R1 3k3 vs 4k7): the coordinator's stays the run's one side-effecting artifact - exactly ONE `proposal_ready` on the stream, the coordinator's - and, OD-122's `proposal_exists` clause, the specialist is offered NO proposal (reads only, B's read-only frame), so nothing of it is sealed, accepted or listed; one line says why and the envelope says `coordinator_sealed`", async () => {
    vi.stubEnv(ORCHESTRATION_ENABLED_ENV, "1");
    const { store } = inMemoryStore();
    setOrchestrationStoreFactory(() => store);
    const live = await schematicEditor();
    // [B21 D2 fix] pin move (review regressions-2 / coverage): the same component now (R1 in both), and the specialist is never offered
    // its proposal once the coordinator sealed one - before the fix it sealed R1=4k7 and the merge accepted it unseen beside 3k3
    state.calls = { coordinator: { toolId: TIER1, args: tier1Args("R1", "3k3") }, schematic: { toolId: TIER1, args: tier1Args("R1", "4k7") } };
    const { runId, events } = await post(chatBody(REWORK, live.visible(), live.editor.headMark()));
    expect(state.starts.map((start) => start.role)).toEqual(["coordinator", "schematic", "coordinator"]);
    expect(state.starts[0]!.tools).toContain(TIER1);
    expect(state.starts[1]!.tools).toEqual(["sirkit.schematic.inspect"]);
    expect(state.starts[1]!.system).toContain("You are now running as ONE bounded read-only SPECIALIST");
    const ready = events.filter((event) => event.type === "proposal_ready");
    expect(ready).toHaveLength(1);
    const operations = JSON.stringify((ready[0]!.proposal as SealedTier1Proposal).operations);
    expect(operations).toContain("3k3");
    expect(operations).not.toContain("4k7");
    const warnings = warningsOf(events);
    expect(warnings.filter((message) => message.startsWith("Orchestration: the coordinator's own turn already handed the human an artifact"))).toHaveLength(1);
    expect(warnings.some((message) => message.includes("presented for approval:"))).toBe(false);
    const history = await store.history({ ...SCOPE, runId });
    const results = history.filter((entry) => entry.record.kind === "result").map((entry) => (entry.record as unknown as { document: { proposedActions: unknown[] } }).document.proposedActions);
    expect(results).toEqual([[]]);
    expect(state.starts[2]!.userMessage).toContain('"approval":{"outcome":"coordinator_sealed","presented":null}');
    expect(state.starts[2]!.userMessage).toContain('"acceptedActions":[]');
    expect(state.starts[2]!.userMessage).not.toContain("4k7");
  });

  it("5. flag ON, a NON-EXACT replacement target (OD-130) never reaches the merge at the route: the schematic specialist is not offered the replacement tool (dormant: its sealer needs the pin-facts reads only the coordinator's gateway holds) and the replacement its MODEL writes - a real artifact of the family naming another part - is refused BEFORE the merge (`proposal_not_sealed_in_run`, dissent malformed): no part review record, no escalation, nothing presented, one malformed line on the stream", async () => {
    vi.stubEnv(ORCHESTRATION_ENABLED_ENV, "1");
    const { store } = inMemoryStore();
    setOrchestrationStoreFactory(() => store);
    const other = sealOtherPartReplacement();
    const payload = JSON.parse(JSON.stringify(other)) as Record<string, unknown>;
    state.results = { schematic: JSON.stringify({ schema: "sirkit.specialist-result.v1", role: "schematic", summary: "(scripted) schematic: prefers another part for U1.", proposedActions: [{ kind: String(payload.schema), payload, artifactDigest: engineeringDigest(payload) }], assumptions: [], evidence: [], requiredTools: [], risks: [], unresolvedQuestions: [], validationRequests: [], confidence: "medium" }) };
    const { runId, events } = await post(chatBody(REWORK));
    expect(state.starts.map((start) => start.role)).toEqual(["coordinator", "schematic"]);
    expect(state.starts[1]!.tools).not.toContain(REPLACEMENT);
    const warnings = warningsOf(events);
    expect(warnings).toEqual(expect.arrayContaining([expect.stringMatching(/^Orchestration: specialist schematic malformed \(task task-1-schematic, attempt 0\): proposal_not_sealed_in_run: /)]));
    expect(warnings.some((message) => message.includes("PART REVIEW") || message.includes("ESCALATED"))).toBe(false);
    expect(types(events).filter((type) => type === "proposal_ready")).toEqual([]);
    const history = await store.history({ ...SCOPE, runId });
    expect(recordsOf(history)).toEqual(["task-1-schematic:dissent:malformed"]);
    expect(history.some((entry) => entry.taskId.startsWith(MERGE_TASK_PREFIX))).toBe(false);
  });

  it("6. flag ON, the presentation is ALWAYS on the finalized run trace - past the 12-line orchestration cap - with the presented artifact's kind, id and digest: the full-circuit DAG's specialists fill the cap with refused tool calls (15 orchestration lines before the presentation), the circuit specialist seals the one accepted proposal, and the trace holds the first 12 lines plus the presentation line naming the proposal the stream carried", async () => {
    vi.stubEnv(ORCHESTRATION_ENABLED_ENV, "1");
    const { store } = inMemoryStore();
    setOrchestrationStoreFactory(() => store);
    const traces = traceCapture();
    state.calls = { "circuit-topology": { toolId: TIER1, args: tier1Args("U1", "10k"), noise: 6 }, schematic: { noise: 6 } };
    const { events } = await post(chatBody(DESIGN));
    expect(state.starts.map((start) => start.role)).toEqual(["coordinator", "circuit-topology", "schematic", "verification-critic", "coordinator"]);
    const ready = events.filter((event) => event.type === "proposal_ready");
    expect(ready).toHaveLength(1);
    const proposal = JSON.parse(JSON.stringify(ready[0]!.proposal)) as { proposalId: string };
    const digest = engineeringDigest(proposal);
    const streamed = warningsOf(events).filter((message) => message.startsWith("Orchestration:"));
    const presentedAt = streamed.findIndex((message) => message.startsWith("Orchestration: presented for approval: "));
    expect(presentedAt).toBeGreaterThan(12);
    const presented = streamed[presentedAt]!;
    expect(presented).toMatch(/^Orchestration: presented for approval: task-1-circuit-topology action 0 /);
    expect(presented).toContain(TIER1_PROPOSAL_SCHEMA);
    expect(presented).toContain(proposal.proposalId);
    expect(presented).toContain(digest);
    await vi.waitFor(() => expect(traces).toHaveLength(1));
    // the trace holds each line as its own sanitizer records it (a task id like `task-...` reads as key-shaped to it and is redacted)
    const traced = traces[0]!.warnings.filter((message) => message.startsWith("Orchestration:"));
    expect(traced.slice(0, 12)).toEqual(streamed.slice(0, 12).map((line) => sanitizeTraceText(line)));
    expect(traced.slice(12)).toEqual([sanitizeTraceText(presented)]);
    expect(traced[12]).toMatch(/^Orchestration: presented for approval: /);
    for (const identity of [TIER1_PROPOSAL_SCHEMA, proposal.proposalId, digest]) expect(traced[12], identity).toContain(identity);
  });

  it("7. flag ON, a peer whose CONFLICTING seal never reaches the merge withholds the presentation (`incomplete`): the full-circuit DAG's circuit specialist seals U1=10k (the one accepted action) while the schematic specialist seals U1=4k7 and then lists an artifact its run did not seal - its whole result is refused before the merge (`proposal_not_sealed_in_run`) - so NOTHING is emitted for approval, one line says why and the envelope says `incomplete`", async () => {
    vi.stubEnv(ORCHESTRATION_ENABLED_ENV, "1");
    const { store } = inMemoryStore();
    setOrchestrationStoreFactory(() => store);
    const forged = action(sealTier1([{ op: "set-value", target: "U1", value: "22k" }]));
    state.calls = { "circuit-topology": { toolId: TIER1, args: tier1Args("U1", "10k") }, schematic: { toolId: TIER1, args: tier1Args("U1", "4k7") } };
    state.results = { schematic: JSON.stringify({ schema: "sirkit.specialist-result.v1", role: "schematic", summary: "(scripted) schematic: set U1 to 4k7.", proposedActions: [forged], assumptions: [], evidence: [], requiredTools: [], risks: [], unresolvedQuestions: [], validationRequests: [], confidence: "medium" }) };
    const { runId, events } = await post(chatBody(DESIGN));
    expect(state.starts.map((start) => start.role)).toEqual(["coordinator", "circuit-topology", "schematic", "verification-critic", "coordinator"]);
    expect(types(events).filter((type) => type === "proposal_ready" || type === "pcb_proposal_ready" || type === "layout_candidate_ready" || type === "execution_grant_ready")).toEqual([]);
    const warnings = warningsOf(events);
    expect(warnings).toEqual(expect.arrayContaining([expect.stringMatching(/^Orchestration: specialist schematic malformed \(task task-3-schematic, attempt 0\): proposal_not_sealed_in_run: /)]));
    expect(warnings.filter((message) => /^Orchestration: nothing from the specialists is presented for approval \(incomplete\): [^\n]*task-3-schematic/.test(message))).toHaveLength(1);
    expect(warnings.some((message) => message.includes("presented for approval:") || message.includes("ESCALATED"))).toBe(false);
    const history = await store.history({ ...SCOPE, runId });
    expect(recordsOf(history)).toEqual(["task-2-component-sourcing-evidence:dissent:escalated", "task-3-schematic:dissent:malformed", "task-1-circuit-topology.merge-*:decision:accepted", "task-4-verification-critic.merge-*:decision:accepted"]);
    expect(state.starts[4]!.userMessage).toContain('"approval":{"outcome":"incomplete","presented":null}');
  });
});
