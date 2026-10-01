/**
 * [B21 D3] Runbook scenario 17 end to end through the PRODUCTION POST (adapters mocked - the B18-D / B21-B pattern; the route, the
 * gateway, the loop, the runtime, the scheduler, the merge and the replacement family's sealer are the real ones) over the D3
 * fixture catalog behind the route's own seams. Flag OFF the four streams stay byte-identical to HEAD's (B's recorded digests). Flag
 * ON: "Replace the NE555 timer U1 with a lower-power timer." routes to the `component-replacement` DAG (four specialists, two of them
 * proposing) and the runtime builds the specialist gateway with the published pin-facts reads and nothing else; ONE PARTY CANNOT
 * SEAL - the circuit specialist's delete of U1 is refused by the agent path's Tier 1 compiler (never reaching the merge), the
 * schematic specialist seals the replacement, the merge accepts it, the stream carries the run's one `proposal_ready` and the human
 * APPROVES it through the replacement family's existing path with the run's principal; BOTH SEAL, ESCALATED - both parties seal and
 * verify, both are contradicted, one escalation, nothing presented; the envelope RENDERS OD-130's part review through the scheduler
 * seam (case 5: a test-built resume) while a production POST cannot produce it [superseded 2026-09-29 by the B21 closeout (D21-27, OD-113): since B21-E3 a production POST carrying `resumeRunId` reaches OD-130's part review through the route-level resume - b21-e3-chat-resume case 8; case 7 still pins that two POSTs without it are two runs] - [B21 D3 fix] (review coverage-2, tests-3) case 7:
 * a fresh run id per POST, no resume, the seal always the exact target (the route-level resume is B21-E's, D21-4); an ABSENT
 * pin-facts source blocks the coordinator's and the specialist's replacement alike, `current-pin-authority-unavailable`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SchematicState } from "@/lib/schematic-types";
import { schematicStateDigest } from "@/app/lib/engineering/schematic-model";
import { createEmptyBoard } from "@/app/lib/pcb/types";
import { pcbRevisionId } from "@/app/lib/pcb/revision";
import { replacementHeadDigestFor } from "@/app/lib/engineering/replacement-proposal-assembler";
import { engineeringDigest } from "@/app/lib/engineering/stable";
import { REPLACEMENT_PROPOSAL_SCHEMA } from "@/app/lib/engineering/replacement-proposals";
import { InMemoryDurableWorkflowRepository } from "@/app/lib/durable-workflow/repository";
import { verifyAgentContextIntegrity } from "@/app/lib/agent/gateway";
import { receiveReplacementProposalEvent } from "@/app/lib/project/replacement-proposal-events";
import { DurableOrchestrationRunStore, type OrchestrationRunEntry } from "@/app/lib/agent/orchestration/store";
import { MERGE_TASK_PREFIX } from "@/app/lib/agent/orchestration/merge";
import { runSpecialistDag } from "@/app/lib/agent/orchestration/scheduler";
import { FIXTURE_EXACT } from "@/app/lib/engineering/__tests__/_authority-fixtures";
import { EARLIER, REPLACEMENT, SCENARIO_17, TIER1, TIMER, approveReplacement, earlierAuthority, installCatalog, principalOf, resetCatalog, stubReplacementAuthorityFetch, timerEditor, type TimerEditor } from "@/app/lib/agent/orchestration/__tests__/_d3-fixtures";

const state = vi.hoisted(() => ({
  starts: [] as Array<{ role: string; system: string; userMessage: string; tools: string[] }>,
  /** per turn (a specialist by its role, the coordinator's first turn `coordinator`, its follow-up `coordinator-2`): one tool call before the final text */
  calls: {} as Record<string, { toolId: string; args: Record<string, unknown> }>,
  /** per turn: the tool results handed back to the model */
  results: {} as Record<string, string[]>,
  pending: [] as string[],
  /** the option keys of every gateway the request constructed (null: constructed with no options at all), in construction order */
  gateways: [] as Array<string[] | null>,
}));

vi.mock("@/app/lib/agent/gateway", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/app/lib/agent/gateway")>();
  return {
    ...original,
    createAgentToolGateway: (registry: Parameters<typeof original.createAgentToolGateway>[0], options?: Parameters<typeof original.createAgentToolGateway>[1]) => {
      state.gateways.push(options ? Object.keys(options).sort() : null);
      return original.createAgentToolGateway(registry, options);
    },
  };
});

vi.mock("@/app/lib/agent/adapters", async () => {
  const { answer, registryToolIds } = await import("@/app/lib/agent/orchestration/__tests__/_result-tool"); // [B21 E1] pin move: the route binds the provider layer, which builds every specialist's adapter through agentAdapterForRole (the same scripted double here); a specialist answers THROUGH the strict result tool it is offered (OD-116) and the offered tools are recorded without that synthetic declaration
  const scripted = () => {
    const usage = { inputTokens: 3, outputTokens: 5 };
    const continuation = { provider: "openai" as const, state: null };
    const firsts = new Map<string, string>();
    const offered = new Map<string, ReadonlyArray<{ toolId: string; providerName: string }>>();
    const textOf = (turn: string, role: string): string => role !== "coordinator"
      ? JSON.stringify({ schema: "sirkit.specialist-result.v1", role, summary: `(scripted) ${role}: read the verified state; nothing changed.`, proposedActions: [], assumptions: [], evidence: [], requiredTools: [], risks: [], unresolvedQuestions: [], validationRequests: [], confidence: "low" })
      : turn === "coordinator-2" ? "(scripted) The follow-up turn answers from the merge." : `(scripted) One coordinator turn for: ${(firsts.get(turn) ?? "").slice(0, 80)}`; // B's coordinator text, so the flag-off streams reproduce B's recorded digests
    return {
      provider: "openai",
      async start(input: { system: string; userMessage: string; tools: ReadonlyArray<{ toolId: string; providerName: string }> }) {
        const role = /^Role: ([a-z-]+)$/m.exec(input.system)?.[1] ?? "coordinator";
        state.starts.push({ role, system: input.system, userMessage: input.userMessage, tools: registryToolIds(input.tools) });
        offered.set(role, input.tools);
        const turn = role === "coordinator" && state.starts.filter((start) => start.role === "coordinator").length === 2 ? "coordinator-2" : role;
        firsts.set(turn, input.userMessage);
        const call = state.calls[turn];
        const tool = call ? input.tools.find((entry) => entry.toolId === call.toolId) : undefined;
        if (tool) {
          state.pending.push(turn);
          return { text: "", toolCalls: [{ callId: `call-${turn}`, providerName: tool.providerName, argumentsText: JSON.stringify(call!.args) }], stopReason: "tool_use", usage, model: "scripted", continuation };
        }
        return { text: textOf(turn, role), toolCalls: [], stopReason: "completed", usage, model: "scripted", continuation, ...answer(textOf(turn, role), input.tools) };
      },
      async continueWith(input: { results: ReadonlyArray<{ outputText: string }> }) {
        const turn = state.pending.pop() ?? "coordinator";
        state.results[turn] = input.results.map((result) => result.outputText);
        return { text: textOf(turn, turn === "coordinator-2" ? "coordinator" : turn), toolCalls: [], stopReason: "completed", usage, model: "scripted", continuation, ...answer(textOf(turn, turn === "coordinator-2" ? "coordinator" : turn), offered.get(turn === "coordinator-2" ? "coordinator" : turn) ?? []) };
      },
    };
  };
  return { agentAdapterFor: scripted, agentAdapterForRole: scripted };
});

import { POST, EDITOR_CONTEXT_SCHEMA } from "../route";
import { resetAdmissionControl } from "@/app/lib/acquisition/admission-control";
import { ORCHESTRATION_ENABLED_ENV, resetOrchestrationStoreFactory, resetSpecialistSchedulerFactory, setOrchestrationStoreFactory, setSpecialistSchedulerFactory } from "../orchestration-runtime";

const SCOPE = { tenantId: "tenant-1", projectId: "project-1", branchId: "main" };
/** B's request, byte for byte (b21-b-chat-router.test.ts), so the flag-off streams reproduce B's pins recorded from HEAD 4b6d0e2 */
const B_SCHEMATIC: SchematicState = {
  components: [], wires: [], netLabels: [],
  kicadComponents: [{ id: "u1-id", partId: "lib:part-a", x: 300, y: 100, rotation: 0, refDes: "U1", value: "MCU", atomicPartRevisionId: "rev-current", symbolAssetVersionId: "sym-current" }],
};
const B_HEAD_MARK = { lineageId: "lin1-a9e2470c11bd8833", headSequence: 3, canonicalStateDigest: replacementHeadDigestFor(B_SCHEMATIC, SCOPE) };
const BODIES = {
  simple: "Move R3 2 mm to the right.",
  view: "Open the 3D view, hide the top silkscreen, focus on J1, and switch to an isometric view.",
  replacement: "Delete U1 and replace it with the approved lower-power part while preserving compatible nets.",
  tier3: "Release the board to manufacturing.",
} as const;
/** B's pins: the digests of the four flag-off streams RECORDED from HEAD 4b6d0e2 (b21-b-chat-router.test.ts HEAD_STREAMS) */
const HEAD_DIGESTS: Record<keyof typeof BODIES, string> = { simple: "eng1-656c2588b836c043", view: "eng1-07aaf2589736c9f7", replacement: "eng1-bf8822508f100b13", tier3: "eng1-9fbc41d4ee249877" };
function chatBody(sentence: string, schematic: SchematicState = B_SCHEMATIC, headMark: unknown = B_HEAD_MARK) {
  const board = createEmptyBoard();
  return {
    provider: "openai", messages: [{ role: "user", content: sentence }], scope: SCOPE, schematicState: schematic, schematicHeadMark: headMark,
    editorContext: { schema: EDITOR_CONTEXT_SCHEMA, scope: SCOPE, board, pcbRevisionId: pcbRevisionId(board), selection: { refs: [], primary: null }, netlist: null, schematicDigest: schematicStateDigest(schematic), authoritySource: "local-working-copy" },
  };
}
/** Scenario 17's request: the sentence over the live editor's schematic at its head. */
const scenarioBody = (editor: TimerEditor) => chatBody(SCENARIO_17, editor.visible(), editor.editor.headMark());
async function post(body: unknown): Promise<{ runId: string; normalized: string; events: Array<Record<string, unknown>> }> {
  const response = await POST(new Request("http://localhost/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  expect(response.status).toBe(200);
  const runId = response.headers.get("X-Sirkit-Run-Id")!;
  const text = await response.text();
  return { runId, normalized: text.replaceAll(runId, "<runId>"), events: text.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>) };
}
const types = (events: Array<Record<string, unknown>>): string[] => events.map((event) => String(event.type));
const warningsOf = (events: Array<Record<string, unknown>>): string[] => events.filter((event) => (event.type === "warning" || event.type === "plan" || event.type === "specialist_finished" || event.type === "degraded")).map((event) => String(event.message)); // [B21 E2] pin move (OD-126): B's plan, status and stand-down lines are now the plan / specialist_finished / degraded events carrying the same sentence
const ARTIFACT_EVENTS = new Set(["proposal_ready", "pcb_proposal_ready", "layout_candidate_ready", "execution_grant_ready"]);
const artifactsOf = (events: Array<Record<string, unknown>>): Array<Record<string, unknown>> => events.filter((event) => ARTIFACT_EVENTS.has(String(event.type)));
const verdictsOf = (history: readonly OrchestrationRunEntry[]): string[] => history.filter((entry) => entry.record.kind === "decision" || entry.record.kind === "dissent").map((entry) => `${entry.taskId.startsWith(MERGE_TASK_PREFIX) ? "merge" : entry.taskId.replace(/\.merge-[0-9a-f]{16}$/, ".merge-*")}:${entry.record.kind}:${(entry.record as { decision: string }).decision}`);
const blockersOf = (turn: string): string[] => (JSON.parse(state.results[turn]![0]!) as { blockers?: Array<{ code: string }> }).blockers?.map((blocker) => blocker.code) ?? [];
const inMemoryStore = () => { const store = new DurableOrchestrationRunStore(new InMemoryDurableWorkflowRepository()); setOrchestrationStoreFactory(() => store); return store; };
const REPLACEMENT_DAG = ["coordinator", "circuit-topology", "component-sourcing-evidence", "schematic", "verification-critic", "coordinator"];

describe("[B21 D3] scenario 17 through the chat route: the replacement live for specialists, the disagreement structural and deterministically resolved", () => {
  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", ""); // the shell never decides an outcome (B's rule)
    vi.stubEnv("SIRKIT_ORCHESTRATION_ROLE_MODELS", ""); vi.stubEnv("SIRKIT_OPENAI_MODEL", ""); vi.stubEnv("SIRKIT_ANTHROPIC_MODEL", "claude-opus-4-7"); // [B21 E1 fix] the route's provider layer reads the role policy and the configured models from process.env: pinned, so the shell never decides an outcome
    resetAdmissionControl(); // [B21 E1] the llm-provider meters are the process's own
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    resetAdmissionControl();
    resetCatalog();
    resetOrchestrationStoreFactory();
    resetSpecialistSchedulerFactory();
    state.starts = [];
    state.calls = {};
    state.results = {};
    state.pending = [];
    state.gateways = [];
  });

  it("1. flag OFF (the default): the four streams are byte-identical to HEAD's - B's recorded digests - with the adapter called once per request and one gateway built per request; nothing is presented", async () => {
    expect(process.env[ORCHESTRATION_ENABLED_ENV]).toBeUndefined();
    for (const [name, sentence] of Object.entries(BODIES) as Array<[keyof typeof BODIES, string]>) {
      state.starts = [];
      state.gateways = [];
      const { normalized } = await post(chatBody(sentence));
      expect(engineeringDigest(normalized), name).toBe(HEAD_DIGESTS[name]);
      expect(state.starts, name).toHaveLength(1);
      expect(state.gateways, name).toHaveLength(1);
      expect(normalized).not.toContain("presented for approval");
    }
  });

  it("2. flag ON, the routing: the runbook's scenario-17 sentence routes to the `component-replacement` DAG - the coordinator's turn, then circuit-topology, component-sourcing-evidence, schematic and verification-critic one at a time, then the follow-up turn; the plan line names four specialists under the rule; the request builds TWO gateways - the coordinator's (the route's options, the pin-facts reads among them) and the specialists' with the pin-facts reads and NOTHING else; the schematic specialist is offered the replacement and the Tier 1 edit, the circuit specialist the Tier 1 edit, the others reads only", async () => {
    vi.stubEnv(ORCHESTRATION_ENABLED_ENV, "1");
    const store = inMemoryStore();
    await installCatalog(SCOPE);
    const editor = await timerEditor(SCOPE);
    const { runId, events } = await post(scenarioBody(editor));
    expect(state.starts.map((start) => start.role)).toEqual(REPLACEMENT_DAG);
    expect(state.gateways).toHaveLength(2);
    expect(state.gateways[0]).toEqual(expect.arrayContaining(["promptVersion", "replacementPinFacts", "routingExecutor"]));
    expect(state.gateways[1]).toEqual(["replacementPinFacts"]);
    const proposals = (role: string): string[] => state.starts.find((start) => start.role === role)!.tools.filter((toolId) => toolId.includes(".propose")).sort();
    expect(proposals("schematic")).toEqual([REPLACEMENT, TIER1]);
    expect(proposals("circuit-topology")).toEqual([TIER1]);
    expect(proposals("component-sourcing-evidence")).toEqual([]);
    expect(proposals("verification-critic")).toEqual([]);
    expect(warningsOf(events).some((message) => message.startsWith("Orchestration: 4 specialist(s) scheduled after this turn") && message.includes("under rule D-component-replacement"))).toBe(true);
    const plan = (await store.history({ ...SCOPE, runId })).find((entry) => entry.record.kind === "plan")!.record as unknown as { tasks: Array<{ taskId: string; role: string }> };
    expect(plan.tasks.map((task) => task.taskId)).toEqual(["task-1-circuit-topology", "task-2-component-sourcing-evidence", "task-3-schematic", "task-4-verification-critic"]);
    expect(artifactsOf(events)).toEqual([]); // nobody sealed: nothing presented
    expect(types(events).filter((type) => type === "run_completed" || type === "run_failed")).toEqual(["run_completed"]);
  });

  it("3. flag ON, PRESENTED end to end and APPROVED - one party cannot seal ([B21 D3 fix] retitled, review coverage-3 / tests-2): the circuit specialist's delete of U1 is refused by the agent path's Tier 1 compiler (`pins-unavailable`, one bounded stream line) and seals nothing; the schematic specialist SEALS the replacement through the specialist gateway's pin-facts reads; the merge accepts it (persisted verdicts, no escalation) and the stream carries the run's ONE `proposal_ready` of the replacement family under the stream's run id, before the one terminal, with the presented line and the envelope's approval block; the page's consumer takes it and the human APPROVES it through the replacement family's existing path with the run's principal - one canonical transaction, U1 carries the exact target, the receipt names the run", async () => {
    vi.stubEnv(ORCHESTRATION_ENABLED_ENV, "1");
    const store = inMemoryStore();
    await installCatalog(SCOPE);
    const fetchBoundary = stubReplacementAuthorityFetch();
    const live = await principalOf(SCOPE);
    const editor = await timerEditor(SCOPE);
    state.calls = { "circuit-topology": { toolId: TIER1, args: { ops: [{ op: "delete", target: "U1" }] } }, schematic: { toolId: REPLACEMENT, args: { componentId: TIMER } } };
    const { runId, events } = await post(scenarioBody(editor));
    expect(state.starts.map((start) => start.role)).toEqual(REPLACEMENT_DAG);
    expect(blockersOf("circuit-topology")).toEqual(["pins-unavailable"]);
    const warnings = warningsOf(events);
    expect(warnings).toContain("Orchestration: specialist circuit-topology (task task-1-circuit-topology, attempt 0) tool sirkit.schematic.propose-tier1-edit refused: proposal_blocked.");
    expect(JSON.parse(state.results.schematic![0]!)).toMatchObject({ ok: true, status: "proposal_sealed" });
    const history = await store.history({ ...SCOPE, runId });
    expect(verdictsOf(history)).toEqual(["task-1-circuit-topology.merge-*:decision:accepted", "task-2-component-sourcing-evidence.merge-*:decision:accepted", "task-3-schematic.merge-*:decision:accepted", "task-4-verification-critic.merge-*:decision:accepted"]);
    const artifacts = artifactsOf(events);
    expect(artifacts.map((event) => [event.type, event.toolId, event.runId])).toEqual([["proposal_ready", REPLACEMENT, runId]]);
    const order = types(events);
    expect(order.indexOf("proposal_ready")).toBeLessThan(order.indexOf("run_completed"));
    expect(warnings).toEqual(expect.arrayContaining([expect.stringMatching(/^Orchestration: presented for approval: task-3-schematic action 0 \(sirkit\.schematic-replacement-proposal\.v2, artifact rprop-/)]));
    expect(state.starts[5]!.userMessage).toContain('"approval":{"outcome":"presented"');
    const received = receiveReplacementProposalEvent(artifacts[0]!)!;
    expect(received.proposal.schema).toBe(REPLACEMENT_PROPOSAL_SCHEMA);
    expect(received.proposal.target).toMatchObject({ partId: FIXTURE_EXACT.exactMpn, atomicPartRevisionId: FIXTURE_EXACT.atomicPartRevisionId });
    expect(received.proposal.authorization.principalId).toBe(live.principalId);
    // the human's Apply: the family's approval controller, the live membership, fresh authority through the real endpoint
    const applied = await approveReplacement(editor, received.proposal, received.runId!, SCOPE);
    expect(applied, JSON.stringify(applied)).toMatchObject({ ok: true, status: "committed" });
    if (!applied.ok || applied.status !== "committed") return;
    expect(fetchBoundary.calls()).toBe(1);
    expect(editor.executed()).toBe(1);
    expect(editor.visible().kicadComponents!.find((component) => component.id === TIMER)).toMatchObject({ partId: FIXTURE_EXACT.exactMpn, atomicPartRevisionId: FIXTURE_EXACT.atomicPartRevisionId });
    expect(applied.receipt.originRunId).toBe(runId);
    expect(applied.receipt.authorization.principalId).toBe(live.principalId);
  });

  it("4. flag ON, ESCALATED end to end: the circuit specialist SEALS a Tier 1 relabel of U1 and the schematic specialist SEALS the exact replacement - each verified by its family - and they conflict on U1: both `contradicted`, ONE escalation record, the stream's escalation line, NO artifact event at all, and the follow-up envelope's approval block `escalated` with what the human must decide (the exact authority cited, nothing applied)", async () => {
    vi.stubEnv(ORCHESTRATION_ENABLED_ENV, "1");
    const store = inMemoryStore();
    await installCatalog(SCOPE);
    const editor = await timerEditor(SCOPE);
    state.calls = { "circuit-topology": { toolId: TIER1, args: { ops: [{ op: "set-value", target: "U1", value: "TLC555" }] } }, schematic: { toolId: REPLACEMENT, args: { componentId: TIMER } } };
    const { runId, events } = await post(scenarioBody(editor));
    expect(state.starts.map((start) => start.role)).toEqual(REPLACEMENT_DAG);
    expect(JSON.parse(state.results["circuit-topology"]![0]!)).toMatchObject({ ok: true, status: "proposal_sealed" });
    expect(JSON.parse(state.results.schematic![0]!)).toMatchObject({ ok: true, status: "proposal_sealed" });
    expect(verdictsOf(await store.history({ ...SCOPE, runId }))).toEqual(["task-1-circuit-topology.merge-*:dissent:contradicted", "task-2-component-sourcing-evidence.merge-*:decision:accepted", "task-3-schematic.merge-*:dissent:contradicted", "task-4-verification-critic.merge-*:decision:accepted", "merge:decision:escalated"]);
    expect(artifactsOf(events)).toEqual([]);
    const warnings = warningsOf(events);
    expect(warnings.filter((message) => message.startsWith("Orchestration: merge: ESCALATED to the human (same_field; part): task-1-circuit-topology action 0 vs task-3-schematic action 0"))).toHaveLength(1);
    expect(warnings.some((message) => message.includes("presented for approval"))).toBe(false);
    const envelope = state.starts[5]!.userMessage;
    expect(envelope).toContain('"approval":{"outcome":"escalated","presented":null}');
    expect(envelope).toMatch(/"humanDecision":"The human must decide:[^"]*Nothing was applied\. The server-owned exact authority for u1-id is STM32F411CEU6 \(atomic-revision-1\); only it may be a replacement target \(OD-130\)/);
    expect(editor.executed()).toBe(0);
  });

  it("5. flag ON, the route's envelope RENDERS OD-130's part review - through the scheduler SEAM ([B21 D3 fix] retitled - review coverage-2 / tests-3: a POST without `resumeRunId` never resumes, case 7): an injected scheduler runs the DAG twice inside ONE POST, first over a test-built context whose authority is the catalog's EARLIER selection for U1 (the real scheduler and the specialist gateway the runtime built for this request), then over the route's own context - a replay no POST without `resumeRunId` performs (it mints a fresh run id; since B21-E3 the route-level resume reaches the part review from a production POST - b21-e3-chat-resume case 8, D21-4); the merge contradicts the replayed seal (`part-not-exact-authority`) and writes a part review request for `request_atomic_review`; the stream carries the part review line and NO artifact event; the envelope's approval block says `review_requested`", async () => { // [B21 closeout, 2026-09-29] retitled (D21-27, OD-113): the route-level resume since B21-E3 (D21-4); assertions unchanged
    vi.stubEnv(ORCHESTRATION_ENABLED_ENV, "1");
    const store = inMemoryStore();
    const catalog = await installCatalog(SCOPE);
    const editor = await timerEditor(SCOPE);
    state.calls = { schematic: { toolId: REPLACEMENT, args: { componentId: TIMER } } };
    const earlier = earlierAuthority(catalog.authority);
    setSpecialistSchedulerFactory(() => async (plan, coordinator, deps) => {
      // the attempt that sealed: the SAME coordinator run, the route's context with the authority the catalog held earlier (the
      // assembler's own digest formula), the specialist gateway the runtime built for this request
      const before = { ...deps.context, componentAuthority: earlier, componentAuthorityDigest: engineeringDigest({ schema: "sirkit.component-authority-records.v1", records: earlier.records, candidates: earlier.candidates }) };
      expect(verifyAgentContextIntegrity(before)).toEqual([]);
      const sealed = await runSpecialistDag(plan, coordinator, { ...deps, context: before });
      expect(sealed).toMatchObject({ kind: "ran", stop: "completed" });
      // the resume under the authority as it stands (the route's own context): every committed result replays
      return runSpecialistDag(plan, coordinator, deps);
    });
    const { runId, events } = await post(scenarioBody(editor));
    const history = await store.history({ ...SCOPE, runId });
    const sealedTargets = history.flatMap((entry) => (entry.record.kind === "result" ? entry.record.document.proposedActions : [])).map((action) => (action.payload as unknown as { target: { partId: string } }).target.partId);
    expect(sealedTargets).toEqual([EARLIER.mpn]);
    expect(verdictsOf(history)).toEqual(["task-1-circuit-topology.merge-*:decision:accepted", "task-2-component-sourcing-evidence.merge-*:decision:accepted", "task-3-schematic.merge-*:dissent:contradicted", "task-4-verification-critic.merge-*:decision:accepted", "merge:decision:escalated"]);
    const warnings = warningsOf(events);
    expect(warnings.filter((message) => message.includes("replayed from the record"))).toHaveLength(4);
    expect(warnings).toContain(`Orchestration: merge: PART REVIEW requested (OD-130): task-3-schematic action 0 names ${EARLIER.mpn} for ${TIMER}; the exact authority is ${FIXTURE_EXACT.exactMpn}; request_atomic_review; nothing was applied.`);
    expect(artifactsOf(events)).toEqual([]);
    const envelope = state.starts.at(-1)!.userMessage;
    expect(envelope).toContain('"approval":{"outcome":"review_requested","presented":null}');
    expect(envelope).toContain(`"candidatePartId":"${EARLIER.mpn}","exactAuthority":{"mpn":"${FIXTURE_EXACT.exactMpn}","atomicPartRevisionId":"${FIXTURE_EXACT.atomicPartRevisionId}"},"path":"request_atomic_review"`);
  });

  it("6. flag ON, an ABSENT pin-facts source (no configured catalog reader): the route builds the specialist gateway with NO option and the coordinator's without the reader; the coordinator's own replacement call and the schematic specialist's are BOTH blocked `current-pin-authority-unavailable` by the family's assembler - never faked; nothing is sealed or presented", async () => {
    vi.stubEnv(ORCHESTRATION_ENABLED_ENV, "1");
    const store = inMemoryStore();
    await installCatalog(SCOPE, { pinFacts: null });
    const editor = await timerEditor(SCOPE);
    state.calls = { coordinator: { toolId: REPLACEMENT, args: { componentId: TIMER } }, schematic: { toolId: REPLACEMENT, args: { componentId: TIMER } } };
    const { runId, events } = await post(scenarioBody(editor));
    expect(state.gateways).toHaveLength(2);
    expect(state.gateways[0]).not.toContain("replacementPinFacts");
    expect(state.gateways[1]).toBeNull();
    expect(state.starts.map((start) => start.role)).toEqual(REPLACEMENT_DAG);
    expect(blockersOf("coordinator")).toEqual(["current-pin-authority-unavailable"]);
    expect(blockersOf("schematic")).toEqual(["current-pin-authority-unavailable"]);
    expect(artifactsOf(events)).toEqual([]);
    const committed = (await store.history({ ...SCOPE, runId })).filter((entry) => entry.record.kind === "result").map((entry) => entry.record.kind === "result" ? entry.record.document.proposedActions.length : -1);
    expect(committed).toEqual([0, 0, 0, 0]);
  });

  it("7. [B21 D3 fix] (review coverage-2, tests-3) OD-130's part review is CONFIRMED-UNREACHABLE from a production POST until B21-E's route-level resume (D21-4): through the PRODUCTION scheduler (no seam) two POSTs of the scenario-17 request over one store are two runs - each mints its own run id, the second POST's specialists all RUN again (nothing is replayed from the first run's record), and in each run the schematic specialist's seal targets the exact authority the merge reads, so the merge accepts it and the run presents it: no part review record, no part review line and no `review_requested` in either envelope", async () => {
    vi.stubEnv(ORCHESTRATION_ENABLED_ENV, "1");
    const store = inMemoryStore();
    await installCatalog(SCOPE);
    const editor = await timerEditor(SCOPE);
    state.calls = { schematic: { toolId: REPLACEMENT, args: { componentId: TIMER } } };
    const runs: Array<{ runId: string; events: Array<Record<string, unknown>>; starts: typeof state.starts }> = [];
    for (let request = 0; request < 2; request += 1) {
      state.starts = [];
      state.results = {};
      state.pending = [];
      const { runId, events } = await post(scenarioBody(editor));
      runs.push({ runId, events, starts: state.starts });
    }
    expect(new Set(runs.map((run) => run.runId)).size).toBe(2);
    for (const [index, run] of runs.entries()) {
      expect(run.starts.map((start) => start.role), `POST ${index + 1}`).toEqual(REPLACEMENT_DAG); // every specialist RAN: no resume
      const warnings = warningsOf(run.events);
      expect(warnings.some((message) => message.includes("replayed from the record")), `POST ${index + 1}`).toBe(false);
      expect(warnings.some((message) => message.includes("PART REVIEW")), `POST ${index + 1}`).toBe(false);
      const history = await store.history({ ...SCOPE, runId: run.runId });
      expect(verdictsOf(history), `POST ${index + 1}`).toEqual(["task-1-circuit-topology.merge-*:decision:accepted", "task-2-component-sourcing-evidence.merge-*:decision:accepted", "task-3-schematic.merge-*:decision:accepted", "task-4-verification-critic.merge-*:decision:accepted"]);
      expect(history.some((entry) => entry.taskId.startsWith(MERGE_TASK_PREFIX)), `POST ${index + 1}`).toBe(false);
      const artifacts = artifactsOf(run.events);
      expect(artifacts.map((event) => [event.type, event.runId]), `POST ${index + 1}`).toEqual([["proposal_ready", run.runId]]);
      expect(receiveReplacementProposalEvent(artifacts[0]!)!.proposal.target, `POST ${index + 1}`).toMatchObject({ partId: FIXTURE_EXACT.exactMpn, atomicPartRevisionId: FIXTURE_EXACT.atomicPartRevisionId });
      const envelope = run.starts.at(-1)!.userMessage;
      expect(envelope, `POST ${index + 1}`).toContain('"approval":{"outcome":"presented"');
      expect(envelope, `POST ${index + 1}`).not.toContain("review_requested");
    }
  });
});
