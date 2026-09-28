/**
 * [B21 E3] The route-level resume through the PRODUCTION POST (adapters mocked - the B18-D / B21-B pattern; the route, the wrapper's
 * identity, membership, role and CSRF checks, the gateway, the loop, the runtime, the scheduler, the merge, the replacement family's
 * sealer and the durable record are the real ones) over runbook scenario 17's fixture catalog. Flag OFF the four streams stay
 * byte-identical to HEAD's (B's recorded digests) and a body carrying `resumeRunId` is refused exactly as HEAD refuses it. Flag ON the
 * optional `resumeRunId` - the run id the client received in `X-Sirkit-Run-Id` - is authorized AFTER the wrapper's checks by the run's
 * resume record: a malformed id 400, an id with no record in THIS project 404, another principal's run 403, another message or provider
 * 409, a finished run 409 - each before any provider call, with no stream. An accepted resume REUSES the run id, replays the coordinator's
 * first turn from the record (no model call), replays every committed specialist bound to the design the request carries and re-runs one
 * whose design moved (the merge judging the LIVE head this request carries), makes the follow-up turn ONCE, and never presents a second
 * side-effecting artifact for the user message (OD-122's ledger). OD-130's part review is reachable from a production POST through the
 * resume (D21-16's route half): a replacement sealed while the catalog's exact target for U1 was its EARLIER selection is replayed after
 * the selection moved and the merge asks for the part review. No network, no model.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SchematicState } from "@/lib/schematic-types";
import { schematicStateDigest } from "@/app/lib/engineering/schematic-model";
import { createEmptyBoard } from "@/app/lib/pcb/types";
import { pcbRevisionId } from "@/app/lib/pcb/revision";
import { replacementHeadDigestFor } from "@/app/lib/engineering/replacement-proposal-assembler";
import { engineeringDigest } from "@/app/lib/engineering/stable";
import { InMemoryDurableWorkflowRepository } from "@/app/lib/durable-workflow/repository";
import type { DurableAggregateIdentity } from "@/app/lib/durable-workflow/types";
import { receiveReplacementProposalEvent } from "@/app/lib/project/replacement-proposal-events";
import { DurableOrchestrationRunStore, ORCHESTRATION_RESUME_AGGREGATE_TYPE, orchestrationResumeStoreOf } from "@/app/lib/agent/orchestration/store";
import { MERGE_TASK_PREFIX } from "@/app/lib/agent/orchestration/merge";
import { injectIdentity, injectMembership, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { FIXTURE_EXACT } from "@/app/lib/engineering/__tests__/_authority-fixtures";
import { EARLIER, REPLACEMENT, SCENARIO_17, TIMER, earlierAuthority, installCatalog, resetCatalog, timerEditor, type TimerEditor } from "@/app/lib/agent/orchestration/__tests__/_d3-fixtures";

const state = vi.hoisted(() => ({
  starts: [] as Array<{ turn: string; role: string; userMessage: string; history: Array<{ role: string; text: string }> }>,
  /** per turn (a specialist by its role, the coordinator's first turn `coordinator`, its follow-up `coordinator-2`): one tool call before the final text */
  calls: {} as Record<string, { toolId: string; args: Record<string, unknown> }>,
  pending: [] as string[],
  /** the follow-up turn fails with a provider failure: the run STANDS DOWN with its record committed (a resumable run) */
  followUpFails: false,
  /** what the route's component-authority load answers instead of the catalog (null: the catalog) */
  authority: null as null | { records: unknown[]; candidates: unknown[] },
  /** when set, the follow-up turn signals `reached` and waits for `released` (a request held IN FLIGHT) */
  gate: null as null | { reached: () => void; released: Promise<void> },
}));

vi.mock("@/app/lib/agent/adapters", async () => {
  const { answer } = await import("@/app/lib/agent/orchestration/__tests__/_result-tool");
  const { LLMProviderError } = await import("@/app/lib/llm/errors");
  const scripted = () => {
    const usage = { inputTokens: 3, outputTokens: 5 };
    const continuation = { provider: "openai" as const, state: null };
    const offered = new Map<string, ReadonlyArray<{ toolId: string; providerName: string }>>();
    const firsts = new Map<string, string>();
    const textOf = (turn: string, role: string): string => role !== "coordinator"
      ? JSON.stringify({ schema: "sirkit.specialist-result.v1", role, summary: `(scripted) ${role}: read the verified state; nothing changed.`, proposedActions: [], assumptions: [], evidence: [], requiredTools: [], risks: [], unresolvedQuestions: [], validationRequests: [], confidence: "low" })
      : turn === "coordinator-2" ? "(scripted) The follow-up turn answers from the merge." : `(scripted) One coordinator turn for: ${(firsts.get(turn) ?? "").slice(0, 80)}`; // B's coordinator text: the flag-off streams reproduce B's recorded digests
    return {
      provider: "openai",
      async start(input: { system: string; userMessage: string; history: Array<{ role: string; text: string }>; tools: ReadonlyArray<{ toolId: string; providerName: string }> }) {
        const role = /^Role: ([a-z-]+)$/m.exec(input.system)?.[1] ?? "coordinator";
        const turn = role === "coordinator" && input.userMessage.startsWith("ORCHESTRATION RESULTS") ? "coordinator-2" : role;
        state.starts.push({ turn, role, userMessage: input.userMessage, history: [...input.history] });
        if (turn === "coordinator-2" && state.gate) { const gate = state.gate; gate.reached(); await gate.released; }
        if (turn === "coordinator-2" && state.followUpFails) throw new LLMProviderError("openai", "overloaded");
        offered.set(turn, input.tools);
        firsts.set(turn, input.userMessage);
        const call = state.calls[turn];
        const tool = call ? input.tools.find((entry) => entry.toolId === call.toolId) : undefined;
        if (tool) {
          state.pending.push(turn);
          return { text: "", toolCalls: [{ callId: `call-${turn}`, providerName: tool.providerName, argumentsText: JSON.stringify(call!.args) }], stopReason: "tool_use", usage, model: "scripted", continuation };
        }
        return { text: textOf(turn, role), toolCalls: [], stopReason: "completed", usage, model: "scripted", continuation, ...answer(textOf(turn, role), input.tools) };
      },
      async continueWith() {
        const turn = state.pending.pop() ?? "coordinator";
        const role = turn === "coordinator-2" ? "coordinator" : turn;
        return { text: textOf(turn, role), toolCalls: [], stopReason: "completed", usage, model: "scripted", continuation, ...answer(textOf(turn, role), offered.get(turn) ?? []) };
      },
    };
  };
  return { agentAdapterFor: scripted, agentAdapterForRole: scripted };
});
vi.mock("@/app/lib/engineering/component-authority-source", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/app/lib/engineering/component-authority-source")>();
  return { ...original, loadRunComponentAuthority: (...args: Parameters<typeof original.loadRunComponentAuthority>) => (state.authority ? Promise.resolve(structuredClone(state.authority) as never) : original.loadRunComponentAuthority(...args)) };
});

import { POST, EDITOR_CONTEXT_SCHEMA } from "../route";
import { resetAdmissionControl } from "@/app/lib/acquisition/admission-control";
import { CHAT_RESUME_BODY_KEY, ORCHESTRATION_ENABLED_ENV, resetOrchestrationStoreFactory, resetSpecialistSchedulerFactory, setOrchestrationStoreFactory, setSpecialistSchedulerFactory } from "../orchestration-runtime";
import { runSpecialistDag } from "@/app/lib/agent/orchestration/scheduler";

const SCOPE = { tenantId: "tenant-1", projectId: "project-1", branchId: "main" };
/** B's request, byte for byte, so the flag-off streams reproduce B's pins recorded from HEAD 4b6d0e2 */
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
const HEAD_DIGESTS: Record<keyof typeof BODIES, string> = { simple: "eng1-656c2588b836c043", view: "eng1-07aaf2589736c9f7", replacement: "eng1-bf8822508f100b13", tier3: "eng1-9fbc41d4ee249877" };
function chatBody(sentence: string, schematic: SchematicState = B_SCHEMATIC, headMark: unknown = B_HEAD_MARK, scope = SCOPE) {
  const board = createEmptyBoard();
  return {
    provider: "openai", messages: [{ role: "user", content: sentence }], scope, schematicState: schematic, schematicHeadMark: headMark,
    editorContext: { schema: EDITOR_CONTEXT_SCHEMA, scope, board, pcbRevisionId: pcbRevisionId(board), selection: { refs: [], primary: null }, netlist: null, schematicDigest: schematicStateDigest(schematic), authoritySource: "local-working-copy" },
  };
}
const scenarioBody = (editor: TimerEditor, extra: Record<string, unknown> = {}) => ({ ...chatBody(SCENARIO_17, editor.visible(), editor.editor.headMark()), ...extra });
/** the scenario's design MOVED: one unrelated label added, a new head - U1 and its wire untouched */
function movedBody(editor: TimerEditor, extra: Record<string, unknown> = {}) {
  const moved: SchematicState = { ...editor.visible(), netLabels: [{ id: "label-e3", position: { x: 900, y: 900 }, name: "AUX1", kind: "label", orientation: 0 }] };
  const mark = editor.editor.headMark()!;
  return { ...chatBody(SCENARIO_17, moved, { lineageId: mark.lineageId, headSequence: mark.headSequence + 1, canonicalStateDigest: replacementHeadDigestFor(moved, SCOPE) }), ...extra };
}
type Posted = { status: number; runId: string | null; text: string; json: Record<string, unknown> | null; events: Array<Record<string, unknown>> };
async function post(body: unknown, headers: Record<string, string> = {}): Promise<Posted> {
  return posted(await POST(new Request("http://localhost/api/chat", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) })));
}
async function posted(response: Response): Promise<Posted> {
  const runId = response.headers.get("X-Sirkit-Run-Id");
  const text = await response.text();
  const ndjson = (response.headers.get("Content-Type") ?? "").includes("ndjson");
  return { status: response.status, runId, text, json: ndjson ? null : (JSON.parse(text) as Record<string, unknown>), events: ndjson ? text.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>) : [] };
}
const messages = (events: Array<Record<string, unknown>>): string[] => events.flatMap((event) => (typeof event.message === "string" ? [event.message] : []));
const ARTIFACT_EVENTS = new Set(["proposal_ready", "pcb_proposal_ready", "layout_candidate_ready", "execution_grant_ready"]);
const artifactsOf = (events: Array<Record<string, unknown>>): Array<Record<string, unknown>> => events.filter((event) => ARTIFACT_EVENTS.has(String(event.type)));
const terminalsOf = (events: Array<Record<string, unknown>>): string[] => events.filter((event) => event.type === "run_completed" || event.type === "run_failed").map((event) => String(event.type));
const turns = (): string[] => state.starts.map((start) => start.turn);
const RESUMABLE = (): void => { state.followUpFails = true; };
/** the durable record, with every read of the RESUME record counted (the route's authorization read) */
function durable(): { store: DurableOrchestrationRunStore; resumeReads: () => number } {
  let reads = 0;
  const repository = new InMemoryDurableWorkflowRepository();
  const history = repository.history.bind(repository);
  repository.history = (async (identity: DurableAggregateIdentity) => { if (identity.aggregateType === ORCHESTRATION_RESUME_AGGREGATE_TYPE) reads += 1; return history(identity); }) as typeof repository.history;
  const store = new DurableOrchestrationRunStore(repository);
  setOrchestrationStoreFactory(() => store);
  return { store, resumeReads: () => reads };
}
const reset = (): void => { state.starts = []; state.calls = {}; state.pending = []; state.followUpFails = false; state.gate = null; };
const chatRequest = (body: unknown): Request => new Request("http://localhost/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

describe("[B21 E3] the route-level resume and the userMessageDigest ledger through the production POST", () => {
  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("SIRKIT_ORCHESTRATION_ROLE_MODELS", ""); vi.stubEnv("SIRKIT_OPENAI_MODEL", ""); vi.stubEnv("SIRKIT_ANTHROPIC_MODEL", "claude-opus-4-7");
    resetAdmissionControl();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    resetAdmissionControl();
    resetCatalog();
    resetOrchestrationStoreFactory();
    resetSpecialistSchedulerFactory();
    resetInjectedIdentity();
    reset();
    state.authority = null;
  });

  it("1. flag OFF (the default): the four streams are byte-identical to HEAD's (B's recorded digests), and a body carrying `resumeRunId` is refused EXACTLY as HEAD refuses it - the same status and body, no run id, no provider call, the resume record never read", async () => {
    expect(process.env[ORCHESTRATION_ENABLED_ENV]).toBeUndefined();
    const { resumeReads } = durable();
    for (const [name, sentence] of Object.entries(BODIES) as Array<[keyof typeof BODIES, string]>) {
      reset();
      const posted = await post(chatBody(sentence));
      expect(engineeringDigest(posted.text.replaceAll(posted.runId!, "<runId>")), name).toBe(HEAD_DIGESTS[name]);
      expect(state.starts, name).toHaveLength(1);
    }
    reset();
    const refused = await post({ ...chatBody(BODIES.replacement), [CHAT_RESUME_BODY_KEY]: "run-0e3d0000-0000-4000-8000-000000000001" });
    expect(refused.status).toBe(400);
    expect(refused.json).toEqual({ ok: false, error: 'unexpected request key "resumeRunId" (authority, actor, role, capability, approval, durable-board, release, and idempotency claims are refused)' });
    expect(refused.runId).toBeNull();
    expect(state.starts).toEqual([]);
    expect(resumeReads()).toBe(0);
  });

  it("2. flag ON, the closed refusals before any provider call and with no stream: a malformed id 400 `resume_malformed`; an id with no record 404 `resume_unknown` - and a run of ANOTHER project, by the same principal, is unknown here too (the lookup is scoped)", async () => {
    vi.stubEnv(ORCHESTRATION_ENABLED_ENV, "1");
    durable();
    await installCatalog(SCOPE);
    const editor = await timerEditor(SCOPE);
    RESUMABLE();
    const first = await post(scenarioBody(editor));
    expect(first.status).toBe(200);
    reset();
    for (const malformed of [42, "run-1", first.runId!.toUpperCase(), `${first.runId} `, "task-1-schematic", ["sk-", "ant-", "x".repeat(40)].join(""), [first.runId], { runId: first.runId }]) {
      const refused = await post(scenarioBody(editor, { resumeRunId: malformed }));
      expect([refused.status, refused.json?.code], JSON.stringify(malformed)).toEqual([400, "resume_malformed"]);
      expect(refused.runId).toBeNull();
    }
    const unknown = await post(scenarioBody(editor, { resumeRunId: "run-0e3d0000-0000-4000-8000-00000000ffff" }));
    expect([unknown.status, unknown.json?.code]).toEqual([404, "resume_unknown"]);
    const other = { ...SCOPE, projectId: "project-2" };
    const elsewhere = await post({ ...chatBody(SCENARIO_17, editor.visible(), editor.editor.headMark(), other), resumeRunId: first.runId });
    expect([elsewhere.status, elsewhere.json?.code]).toEqual([404, "resume_unknown"]);
    expect(state.starts).toEqual([]);
  });

  it("3. flag ON, the owner: another principal's run is 403 `resume_foreign`; the existing boundary still decides first - a viewer is refused by the chat policy's role gate and a cross-origin POST in production by CSRF, both BEFORE the resume record is read", async () => {
    vi.stubEnv(ORCHESTRATION_ENABLED_ENV, "1");
    const { resumeReads } = durable();
    await installCatalog(SCOPE);
    const editor = await timerEditor(SCOPE);
    injectMembership([{ tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, userId: "human-e3-1", role: "editor" }, { tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, userId: "human-e3-2", role: "editor" }, { tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, userId: "viewer-e3", role: "viewer" }]);
    injectIdentity({ userId: "human-e3-1" });
    RESUMABLE();
    const first = await post(scenarioBody(editor));
    expect(first.status).toBe(200);
    reset();
    injectIdentity({ userId: "human-e3-2" });
    const foreign = await post(scenarioBody(editor, { resumeRunId: first.runId }));
    expect([foreign.status, foreign.json?.code]).toEqual([403, "resume_foreign"]);
    expect(foreign.runId).toBeNull();
    const reads = resumeReads();
    expect(reads).toBeGreaterThan(0);
    injectIdentity({ userId: "viewer-e3" });
    const viewer = await post(scenarioBody(editor, { resumeRunId: first.runId }));
    expect([viewer.status, viewer.json?.code]).toEqual([403, "AUTH_ROLE_DENIED"]);
    vi.stubEnv("SIRKIT_AUTH_MODE", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-test-key");
    vi.stubEnv("SIRKIT_EXPECTED_ORIGIN", "http://localhost");
    injectIdentity({ userId: "human-e3-1" });
    const crossOrigin = await post(scenarioBody(editor, { resumeRunId: first.runId }), { origin: "http://evil.example" });
    expect(crossOrigin.status).toBe(403);
    expect(crossOrigin.runId).toBeNull();
    expect(resumeReads()).toBe(reads); // neither refused request reached the resume record
    expect(state.starts).toEqual([]);
  });

  it("4. flag ON, the same owner with another message or on another provider is 409 `resume_mismatch` (the ledger is keyed by the user message; the coordinator never switches provider mid-run); no provider call", async () => {
    vi.stubEnv(ORCHESTRATION_ENABLED_ENV, "1");
    durable();
    await installCatalog(SCOPE);
    const editor = await timerEditor(SCOPE);
    RESUMABLE();
    const first = await post(scenarioBody(editor));
    reset();
    const message = await post({ ...chatBody("Replace the NE555 timer U1 with a CMOS timer.", editor.visible(), editor.editor.headMark()), resumeRunId: first.runId });
    expect([message.status, message.json?.code]).toEqual([409, "resume_mismatch"]);
    const provider = await post(scenarioBody(editor, { resumeRunId: first.runId, provider: "anthropic" }));
    expect([provider.status, provider.json?.code]).toEqual([409, "resume_mismatch"]);
    expect(state.starts).toEqual([]);
  });

  it("5. the resume end to end: a run that STOOD DOWN (its follow-up failed) is resumed under the SAME run id - its first turn replayed from the record with no model call, all four specialists replayed, the follow-up turn made ONCE over the replayed answer, one run_started and one terminal; the finished run is then 409 `resume_completed`", async () => {
    vi.stubEnv(ORCHESTRATION_ENABLED_ENV, "1");
    durable();
    await installCatalog(SCOPE);
    const editor = await timerEditor(SCOPE);
    RESUMABLE();
    const first = await post(scenarioBody(editor));
    expect(turns()).toEqual(["coordinator", "circuit-topology", "component-sourcing-evidence", "schematic", "verification-critic", "coordinator-2"]);
    expect(first.events.filter((event) => event.type === "degraded").map((event) => event.reason)).toEqual(["follow_up_failed"]);
    const firstAnswer = first.events.filter((event) => event.type === "text_delta").map((event) => event.text);
    expect(firstAnswer).toEqual([`(scripted) One coordinator turn for: ${SCENARIO_17}`]);
    reset();
    const resumed = await post(scenarioBody(editor, { resumeRunId: first.runId }));
    expect(resumed.status).toBe(200);
    expect(resumed.runId).toBe(first.runId);
    expect(turns()).toEqual(["coordinator-2"]);
    expect(state.starts[0]!.history.slice(-2)).toEqual([{ role: "user", text: SCENARIO_17 }, { role: "assistant", text: firstAnswer[0] }]);
    expect(resumed.events[0]).toMatchObject({ type: "run_started", runId: first.runId });
    expect(resumed.events.filter((event) => event.type === "run_started")).toHaveLength(1);
    expect(messages(resumed.events).some((line) => line.startsWith(`Orchestration: resumed run ${first.runId}:`))).toBe(true);
    expect(resumed.events.filter((event) => event.type === "text_delta").map((event) => event.text)).toEqual([...firstAnswer, "(scripted) The follow-up turn answers from the merge."]);
    expect(messages(resumed.events).filter((line) => line.startsWith("Orchestration: specialist ") && line.includes("replayed from the record"))).toHaveLength(4);
    expect(terminalsOf(resumed.events)).toEqual(["run_completed"]);
    expect(resumed.events.at(-1)).toMatchObject({ type: "run_completed", steps: 1, toolCalls: 0 });
    reset();
    const finished = await post(scenarioBody(editor, { resumeRunId: first.runId }));
    expect([finished.status, finished.json?.code]).toEqual([409, "resume_completed"]);
    expect(state.starts).toEqual([]);
  });

  it("6. ONE side-effecting artifact per userMessageDigest across resumes (OD-122's ledger): the schematic specialist's replacement is presented ONCE by the first POST; the resume replays the seal and the merge accepts it again, but NOTHING is presented (`already_presented`); a coordinator's own first-turn artifact is never re-emitted either, and keeps the resume's specialists read-only (`coordinator_sealed`)", async () => {
    vi.stubEnv(ORCHESTRATION_ENABLED_ENV, "1");
    const { store } = durable();
    await installCatalog(SCOPE);
    const editor = await timerEditor(SCOPE);
    RESUMABLE();
    state.calls = { schematic: { toolId: REPLACEMENT, args: { componentId: TIMER } } };
    const first = await post(scenarioBody(editor));
    expect(artifactsOf(first.events).map((event) => [event.type, event.runId])).toEqual([["proposal_ready", first.runId]]);
    reset();
    const resumed = await post(scenarioBody(editor, { resumeRunId: first.runId }));
    expect(artifactsOf(resumed.events)).toEqual([]);
    expect(messages(resumed.events).some((line) => line.startsWith("Orchestration: nothing from the specialists is presented for approval (already_presented):"))).toBe(true);
    expect(state.starts.at(-1)!.userMessage).toContain('"approval":{"outcome":"already_presented","presented":null}');
    const claims = (await orchestrationResumeStoreOf(store)!.history({ ...SCOPE, runId: first.runId! })).filter((entry) => entry.entry.kind === "artifact");
    expect(claims).toHaveLength(1);
    // the coordinator's own artifact
    reset();
    RESUMABLE();
    state.calls = { coordinator: { toolId: REPLACEMENT, args: { componentId: TIMER } } };
    const sealed = await post(scenarioBody(editor));
    expect(artifactsOf(sealed.events).map((event) => event.type)).toEqual(["proposal_ready"]);
    reset();
    state.calls = { schematic: { toolId: REPLACEMENT, args: { componentId: TIMER } } };
    const again = await post(scenarioBody(editor, { resumeRunId: sealed.runId }));
    expect(artifactsOf(again.events)).toEqual([]);
    expect(again.events.filter((event) => event.type === "degraded").map((event) => event.reason)).toEqual(["coordinator_artifact_held"]);
    expect(state.starts.at(-1)!.userMessage).toContain('"approval":{"outcome":"coordinator_sealed","presented":null}');
  });

  it("7. the merge judges the LIVE head the RESUMING request carries (D21-17's live-head half): after the human's design moved, every committed result is STALE and its specialist runs again against the new head (the scheduler's existing rule), the merge's scope IS the new head's, and the one replacement sealed against it is presented - the ledger held nothing yet", async () => {
    vi.stubEnv(ORCHESTRATION_ENABLED_ENV, "1");
    durable();
    await installCatalog(SCOPE);
    const editor = await timerEditor(SCOPE);
    RESUMABLE();
    const first = await post(scenarioBody(editor));
    const firstScope = /"scopeDigest":"(eng1-[0-9a-f]{16})"/.exec(state.starts.at(-1)!.userMessage)?.[1];
    expect(firstScope).toMatch(/^eng1-/);
    reset();
    state.calls = { schematic: { toolId: REPLACEMENT, args: { componentId: TIMER } } };
    const resumed = await post(movedBody(editor, { resumeRunId: first.runId }));
    expect(resumed.status).toBe(200);
    expect(turns()).toEqual(["circuit-topology", "component-sourcing-evidence", "schematic", "verification-critic", "coordinator-2"]);
    expect(messages(resumed.events).filter((line) => line.includes("is STALE"))).toHaveLength(4);
    const liveScope = /"scopeDigest":"(eng1-[0-9a-f]{16})"/.exec(state.starts.at(-1)!.userMessage)?.[1];
    expect(liveScope).toMatch(/^eng1-/);
    expect(liveScope).not.toBe(firstScope);
    const presented = artifactsOf(resumed.events);
    expect(presented.map((event) => [event.type, event.runId])).toEqual([["proposal_ready", first.runId]]);
    expect(receiveReplacementProposalEvent(presented[0]!)!.proposal.target).toMatchObject({ partId: FIXTURE_EXACT.exactMpn });
  });

  it("8. OD-130's part review is REACHABLE from a production POST through the resume (D21-16's route half): the first POST ran while the catalog's exact target for U1 was its EARLIER part - the schematic specialist sealed that target and it was presented; the catalog's authority then moved (the editor selection did not), and the resume replays the committed seal: the merge contradicts it (`part-not-exact-authority`) against the authority as it stands, writes a part review request for `request_atomic_review`, the stream carries the part review line and NO artifact event, and the envelope says `review_requested`", async () => {
    vi.stubEnv(ORCHESTRATION_ENABLED_ENV, "1");
    const { store } = durable();
    const catalog = await installCatalog(SCOPE);
    const editor = await timerEditor(SCOPE);
    state.authority = earlierAuthority(catalog.authority) as never;
    RESUMABLE();
    state.calls = { schematic: { toolId: REPLACEMENT, args: { componentId: TIMER } } };
    const first = await post(scenarioBody(editor));
    const sealed = artifactsOf(first.events);
    expect(sealed.map((event) => event.type)).toEqual(["proposal_ready"]);
    expect(receiveReplacementProposalEvent(sealed[0]!)!.proposal.target).toMatchObject({ partId: EARLIER.mpn, atomicPartRevisionId: EARLIER.atomicPartRevisionId });
    // the selection moves back to the catalog's exact authority; the human resumes the run
    state.authority = null;
    reset();
    const resumed = await post(scenarioBody(editor, { resumeRunId: first.runId }));
    expect(resumed.status).toBe(200);
    expect(turns()).toEqual(["coordinator-2"]);
    expect(messages(resumed.events).filter((line) => line.startsWith("Orchestration: specialist ") && line.includes("replayed from the record"))).toHaveLength(4);
    expect(messages(resumed.events)).toContain(`Orchestration: merge: PART REVIEW requested (OD-130): task-3-schematic action 0 names ${EARLIER.mpn} for ${TIMER}; the exact authority is ${FIXTURE_EXACT.exactMpn}; request_atomic_review; nothing was applied.`);
    expect(artifactsOf(resumed.events)).toEqual([]);
    const envelope = state.starts.at(-1)!.userMessage;
    expect(envelope).toContain('"approval":{"outcome":"review_requested","presented":null}');
    expect(envelope).toContain(`"candidatePartId":"${EARLIER.mpn}","exactAuthority":{"mpn":"${FIXTURE_EXACT.exactMpn}","atomicPartRevisionId":"${FIXTURE_EXACT.atomicPartRevisionId}"},"path":"request_atomic_review"`);
    const history = await store.history({ ...SCOPE, runId: first.runId! });
    const reviews = history.filter((entry) => entry.taskId.startsWith(MERGE_TASK_PREFIX)).map((entry) => entry.record as { kind: string; decision: string; reason: string });
    expect(reviews.map((review) => [review.kind, review.decision])).toEqual([["decision", "escalated"]]);
    expect(reviews[0]!.reason).toBe(`merge part review (OD-130): task-3-schematic#0 names ${EARLIER.mpn} for ${TIMER}; exact authority ${FIXTURE_EXACT.exactMpn} (${FIXTURE_EXACT.atomicPartRevisionId}); path request_atomic_review`);
  });

  it("9. ONE request of a run at a time through the production POST: a resume POSTed while the first request of the run is still IN FLIGHT (its follow-up turn held open) is 409 `resume_in_progress` with no provider call; once that request stood down, two resume POSTs sent together - exactly one streams under the run id and the other is 409 `resume_in_progress`: the follow-up turn is made ONCE, and the record holds each request's start and end", async () => {
    vi.stubEnv(ORCHESTRATION_ENABLED_ENV, "1");
    const { store } = durable();
    await installCatalog(SCOPE);
    const editor = await timerEditor(SCOPE);
    RESUMABLE();
    /** holds the next follow-up turn open until released: the request stays IN FLIGHT */
    const hold = (): { arrived: Promise<void>; release: () => void } => {
      let reached!: () => void;
      let release!: () => void;
      const arrived = new Promise<void>((resolve) => { reached = resolve; });
      state.gate = { reached, released: new Promise<void>((resolve) => { release = resolve; }) };
      return { arrived, release };
    };
    const firstHold = hold();
    const running = await POST(chatRequest(scenarioBody(editor)));
    const runId = running.headers.get("X-Sirkit-Run-Id")!;
    const draining = posted(running);
    await firstHold.arrived; // the first request is in its follow-up turn: its start (the coordinator entry) is unsettled
    const starts = state.starts.length;
    const early = await post(scenarioBody(editor, { resumeRunId: runId }));
    expect([early.status, early.json?.code]).toEqual([409, "resume_in_progress"]);
    expect(early.runId).toBeNull();
    expect(state.starts).toHaveLength(starts);
    state.gate = null;
    firstHold.release();
    const first = await draining;
    expect(first.events.filter((event) => event.type === "degraded").map((event) => event.reason)).toEqual(["follow_up_failed"]);
    // two resume POSTs together, the winner held in its follow-up turn: the other is decided while the winner is IN FLIGHT
    reset();
    const secondHold = hold();
    const responses = await Promise.all([POST(chatRequest(scenarioBody(editor, { resumeRunId: runId }))), POST(chatRequest(scenarioBody(editor, { resumeRunId: runId })))]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    await secondHold.arrived;
    secondHold.release();
    const together = await Promise.all(responses.map(posted));
    const refused = together.find((entry) => entry.status === 409)!;
    const resumed = together.find((entry) => entry.status === 200)!;
    expect([refused.json?.code, refused.runId]).toEqual(["resume_in_progress", null]);
    expect(resumed.runId).toBe(runId);
    expect(terminalsOf(resumed.events)).toEqual(["run_completed"]);
    expect(turns()).toEqual(["coordinator-2"]);
    const record = await orchestrationResumeStoreOf(store)!.history({ ...SCOPE, runId });
    expect(record.map((entry) => `${entry.entry.kind}${"ordinal" in entry.entry ? `:${entry.entry.ordinal}` : ""}`)).toEqual(["coordinator", "settled:0", "resume:1", "follow-up"]);
  });

  it("10. [B21 E3 fix: tests-8] the ledger across a MOVED head: the first POST presented the replacement against head H1; the human edits the design (H2) and resumes - every committed result is STALE and runs again, the schematic specialist seals against H2 and the merge accepts it, but the message's one artifact was already presented: `already_presented`, NO artifact event, one claim on the record (the first artifact is stale against H2: its apply is refused by the family's own currency check - OD-122's at-most-once, recorded on the page)", async () => {
    vi.stubEnv(ORCHESTRATION_ENABLED_ENV, "1");
    const { store } = durable();
    await installCatalog(SCOPE);
    const editor = await timerEditor(SCOPE);
    RESUMABLE();
    state.calls = { schematic: { toolId: REPLACEMENT, args: { componentId: TIMER } } };
    const first = await post(scenarioBody(editor));
    expect(artifactsOf(first.events).map((event) => event.type)).toEqual(["proposal_ready"]);
    const firstScope = /"scopeDigest":"(eng1-[0-9a-f]{16})"/.exec(state.starts.at(-1)!.userMessage)?.[1];
    reset();
    state.calls = { schematic: { toolId: REPLACEMENT, args: { componentId: TIMER } } };
    const resumed = await post(movedBody(editor, { resumeRunId: first.runId }));
    expect(resumed.status).toBe(200);
    expect(turns()).toEqual(["circuit-topology", "component-sourcing-evidence", "schematic", "verification-critic", "coordinator-2"]);
    expect(messages(resumed.events).filter((line) => line.includes("is STALE"))).toHaveLength(4);
    const envelope = state.starts.at(-1)!.userMessage;
    expect(/"scopeDigest":"(eng1-[0-9a-f]{16})"/.exec(envelope)?.[1]).not.toBe(firstScope);
    expect(envelope).toMatch(/"acceptedActions":\[\{"taskId":"task-3-schematic"/);
    expect(artifactsOf(resumed.events)).toEqual([]);
    expect(messages(resumed.events).some((line) => line.startsWith("Orchestration: nothing from the specialists is presented for approval (already_presented):"))).toBe(true);
    expect(envelope).toContain('"approval":{"outcome":"already_presented","presented":null}');
    const claims = (await orchestrationResumeStoreOf(store)!.history({ ...SCOPE, runId: first.runId! })).filter((entry) => entry.entry.kind === "artifact");
    expect(claims).toHaveLength(1);
  });

  it("11. [B21 E3 fix: regressions-2] a request that fails with `stream_error` AFTER its plan settled its start first: the page offers a resume for a failed run with a plan, and the resume POST is granted at once - never `resume_in_progress` for the lease", async () => {
    vi.stubEnv(ORCHESTRATION_ENABLED_ENV, "1");
    const { store } = durable();
    await installCatalog(SCOPE);
    const editor = await timerEditor(SCOPE);
    setSpecialistSchedulerFactory(() => async (plan, coordinator, deps) => runSpecialistDag(plan, coordinator, { ...deps, emit: (event) => { deps.emit(event); if (event.type === "plan") throw new Error("the scheduler failed after its plan"); } }));
    const first = await post(scenarioBody(editor));
    expect(first.status).toBe(200);
    expect(first.events.some((event) => event.type === "plan")).toBe(true);
    expect(first.events.at(-1)).toMatchObject({ type: "run_failed", reason: "stream_error" });
    expect(first.text).not.toContain("the scheduler failed after its plan");
    const record = (await orchestrationResumeStoreOf(store)!.history({ ...SCOPE, runId: first.runId! })).map((entry) => `${entry.entry.kind}${"ordinal" in entry.entry ? `:${entry.entry.ordinal}` : ""}`);
    expect(record).toEqual(["coordinator", "settled:0"]);
    resetSpecialistSchedulerFactory();
    reset();
    const resumed = await post(scenarioBody(editor, { resumeRunId: first.runId }));
    expect([resumed.status, resumed.runId]).toEqual([200, first.runId]);
    expect(terminalsOf(resumed.events)).toEqual(["run_completed"]);
  });
});
