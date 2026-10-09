/**
 * [B24-C2] The attribution document beside the run trace (D24-22, OD-208; D24-23's budget and latency halves, OD-209): one
 * `sirkit.agent-run-trace-attribution.v1` per validated trace, keyed by trace id, written ONCE (compare-and-set at revision 0, no
 * outbox effect) by the chat composition root after the recorder has handed the validated trace to C1's sink. Every value is a digest,
 * an id matching a pattern, a closed class, a count or a bounded number - no text field of any kind - and `findSecretShapedPath` runs
 * over the whole document as defence in depth.
 *
 *  1. the counterexample, red at 4ec18eb: a completed chat request under the fixture runtime leaves ONE attribution for its run, with
 *     the closed keys, bound to the stored trace by digest, its budget the six fields of DEFAULT_AGENT_BUDGET, its cost unpriced;
 *  2. the validator: an unknown key, a text value, a reasoning-shaped key and an unsalted digest are refused, and the store writes nothing;
 *  3. `salt_unavailable` yields null digests and the closed diagnostic, through the builder and through the runtime;
 *  4. the bounds: the refused-call classes, at most 64 reads with 64 resources each, at most 2 x maxModelSteps request ids (the excess,
 *     a malformed id and a secret-shaped id counted in requestIdsWithheld);
 *  5. the budget snapshot (case 1) and a Tier 3-refused plan: kind `refused`, no toolset, no answer, no request id;
 *  6. latency on an injected monotonic clock: one eventOffsets entry per appended trace event keyed by its seq, non-decreasing, at most
 *     256; firstTextOffsetMs at the first text_delta; terminalOffsetMs at the trace's terminal;
 *  7. the real adapters: a fake SDK response carrying `_request_id` yields `providerRequestId` on the AgentStep; one without leaves
 *     the key absent (every older fake-client expectation holds);
 *  8. retryCeiling is 2 (OpenAI) or "sdk_default" (Anthropic), sdkRetriesObserved is "unknown";
 *  9. two concurrent first runs in one scope converge on ONE salt (the store, then two parallel chat requests);
 * 10. recording failure is passive: a throwing store factory is counted, the stream is B21-B's recorded bytes, the terminal stands;
 * 11. the nine B11-scanned files are unchanged (lead decision D20): read from B21-E2b's SCANNED_AT_HEAD, no hash of its own;
 * 12. the import gates: the attribution store, the salt store and the collector reach no provider SDK and none of the durable runtime,
 *     the server repository, the database client or the schema; C1's gates hold unmoved; the chat route keeps its 562 lines and never
 *     reaches app/lib/deployment/configuration.ts (its closure must stay clear of the provider directory);
 * 13. the deployment configuration digest: published by instrumentation.ts after the fixture clock, recorded when published, null with
 *     the closed diagnostic when not;
 * 14. a dag run: the request ids of the coordinator's two turns (first and follow-up) through ONE observed adapter, no specialist id;
 *     an unknown-tool refusal is counted.
 *
 * No real database, provider, model or host: the adapters are scripted (vi.mock), the stores in memory, `DATABASE_URL` emptied.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SchematicState } from "@/lib/schematic-types";
import { schematicStateDigest } from "@/app/lib/engineering/schematic-model";
import { createEmptyBoard } from "@/app/lib/pcb/types";
import { pcbRevisionId } from "@/app/lib/pcb/revision";
import { replacementHeadDigestFor } from "@/app/lib/engineering/replacement-proposal-assembler";
import { engineeringDigest } from "@/app/lib/engineering/stable";
import { InMemoryDurableWorkflowRepository } from "@/app/lib/durable-workflow/repository";
import { DurableOrchestrationRunStore } from "@/app/lib/agent/orchestration/store";
import { AgentTraceRecorder, InMemoryTraceSink, type AgentTraceSink } from "@/app/lib/agent/trace-recorder";
import { TRACE_BOUNDS, agentRunTraceDigest, type AgentRunTrace } from "@/app/lib/agent/trace";
import { DEFAULT_AGENT_BUDGET, type AgentRunEvent, type AgentStep, type ProviderAgentAdapter } from "@/app/lib/agent/contracts";
import { B11_SCANNED_FILES } from "@/app/lib/agent/orchestration/tripwires";
import { fixtureContainer, resetFixtureContainer } from "@/app/lib/fixture-runtime/container";
import { resetAdmissionControl } from "@/app/lib/acquisition/admission-control";
import { SCENARIO_17, installCatalog, resetCatalog, timerEditor, type TimerEditor } from "@/app/lib/agent/orchestration/__tests__/_d3-fixtures";
import { collectProductionFiles, moduleReferences, resolveSpecifier, type FileMap } from "@/app/lib/project/__tests__/_import-gate-helpers";
import { fileOf, importClosure, runtimeDeclarationSpecifiers } from "@/app/lib/mcp/server/__tests__/_import-closure";
import { DurableRunTraceStore } from "@/app/lib/observability/run-trace-store";
import { DurableTraceSaltStore, SALTED_DIGEST_PATTERN, TRACE_SALT_AGGREGATE_TYPE, saltedDigest, traceSaltAggregateKey } from "@/app/lib/observability/trace-salt";
import { ATTRIBUTION_DIAGNOSTICS, ATTRIBUTION_RETRY_CEILINGS, ATTRIBUTION_ROLES, DurableRunTraceAttributionStore, REFUSED_CALL_CLASSES, RUN_TRACE_ATTRIBUTION_AGGREGATE_TYPE, RUN_TRACE_ATTRIBUTION_KEYS, RUN_TRACE_ATTRIBUTION_SCHEMA, validateRunTraceAttribution, type RunTraceAttribution } from "@/app/lib/observability/run-trace-attribution";
import { buildRunTraceAttribution, createRunAttributionCollector, type RunAttributionReadTrace } from "@/app/lib/observability/run-attribution-collector";
import { publishDeploymentConfigurationDigest, publishedDeploymentConfigurationDigest, withdrawDeploymentConfigurationDigest } from "@/app/lib/observability/deployment-configuration-digest";
import { deploymentConfiguration } from "@/app/lib/deployment/configuration";

const state = vi.hoisted(() => ({
  /** the coordinator's first turn: answer, or request a tool of this name, which no run exposes (an untraced tool_refused) */
  unknownTool: null as string | null,
  /** every scripted step carries `providerRequestId: req-<turn>-<n>` */
  requestIds: false,
  starts: [] as string[],
}));

vi.mock("@/app/lib/agent/adapters", async () => {
  const actual = await vi.importActual<typeof import("@/app/lib/agent/adapters")>("@/app/lib/agent/adapters");
  const { answer } = await import("@/app/lib/agent/orchestration/__tests__/_result-tool");
  const scripted = () => {
    const usage = { inputTokens: 3, outputTokens: 5 };
    const continuation = { provider: "openai" as const, state: null };
    const textOf = (turn: string, role: string, userMessage: string): string => role !== "coordinator"
      ? JSON.stringify({ schema: "sirkit.specialist-result.v1", role, summary: `(scripted) ${role}: read the verified state; nothing changed.`, proposedActions: [], assumptions: [], evidence: [], requiredTools: [], risks: [], unresolvedQuestions: [], validationRequests: [], confidence: "low" })
      : turn === "coordinator-2" ? "(scripted) The follow-up turn answers from the merge." : `(scripted) One coordinator turn for: ${userMessage.slice(0, 80)}`; // B21-B's text: the stream reproduces B's recorded digest
    const requestId = (turn: string): { providerRequestId?: string } => (state.requestIds ? { providerRequestId: `req-${turn}-${state.starts.length}` } : {});
    return {
      provider: "openai",
      async start(input: { system: string; userMessage: string; tools: ReadonlyArray<{ toolId: string; providerName: string }>; signal?: AbortSignal }) {
        const role = /^Role: ([a-z-]+)$/m.exec(input.system)?.[1] ?? "coordinator";
        const turn = role === "coordinator" && input.userMessage.startsWith("ORCHESTRATION RESULTS") ? "coordinator-2" : role;
        state.starts.push(turn);
        if (turn === "coordinator" && state.unknownTool !== null) return { text: "", toolCalls: [{ callId: "call-b24c2-unknown", providerName: state.unknownTool, argumentsText: "{}" }], stopReason: "tool_use", usage, model: "scripted", continuation, ...requestId(turn) };
        const text = textOf(turn, role, input.userMessage);
        return { text, toolCalls: [], stopReason: "completed", usage, model: "scripted", continuation, ...answer(text, input.tools), ...requestId(turn) };
      },
      async continueWith() {
        state.starts.push("continue");
        return { text: "(scripted) continued.", toolCalls: [], stopReason: "completed", usage: { inputTokens: 3, outputTokens: 5 }, model: "scripted", continuation: { provider: "openai" as const, state: null }, ...requestId("continue") };
      },
    };
  };
  return { ...actual, agentAdapterFor: scripted, agentAdapterForRole: scripted };
});

import { POST, EDITOR_CONTEXT_SCHEMA } from "@/app/api/chat/route";
import { ORCHESTRATION_ENABLED_ENV, resetOrchestrationStoreFactory, resetSpecialistSchedulerFactory, setOrchestrationStoreFactory } from "@/app/api/chat/orchestration-runtime";
import { COORDINATOR_SDK_RETRY_CEILING } from "@/app/lib/agent/adapters";
import { RUN_ATTRIBUTION_PENDING_BOUND, RUN_ATTRIBUTION_WRITE_FAILURES, drainRunAttributionWrites, resetRunAttributionStoreFactory, resetRunAttributionWriteCounts, resetTraceSaltStoreFactory, runAttributionWriteCounts, setRunAttributionStoreFactory, setTraceSaltStoreFactory } from "@/app/api/chat/attribution-runtime";
import { drainRunTraceWrites, resetRunTraceStoreFactory, setRunTraceStoreFactory } from "@/app/api/chat/trace-runtime"; // C1's seam: the run trace lands in the same in-memory repository, so the attribution's digest binding can be checked

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");
const SCOPE = { tenantId: "tenant-1", projectId: "project-1", branchId: "main" };
/** B21-B's request, byte for byte: the flag-off stream reproduces B's digest recorded from HEAD 4b6d0e2 */
const SCHEMATIC: SchematicState = {
  components: [], wires: [], netLabels: [],
  kicadComponents: [{ id: "u1-id", partId: "lib:part-a", x: 300, y: 100, rotation: 0, refDes: "U1", value: "MCU", atomicPartRevisionId: "rev-current", symbolAssetVersionId: "sym-current" }],
};
const HEAD_MARK = { lineageId: "lin1-a9e2470c11bd8833", headSequence: 3, canonicalStateDigest: replacementHeadDigestFor(SCHEMATIC, SCOPE) };
const SIMPLE = "Move R3 2 mm to the right.";
const TIER3 = "Release the board to manufacturing.";
/** B21-B's recorded digest of the flag-off stream for SIMPLE (b21-b-chat-router.test.ts HEAD_STREAMS.simple; b24-c1-durable-trace 5) */
const SIMPLE_HEAD_DIGEST = "eng1-656c2588b836c043";
function chatBody(sentence: string, schematic: SchematicState = SCHEMATIC, headMark: unknown = HEAD_MARK): Record<string, unknown> {
  const board = createEmptyBoard();
  return {
    provider: "openai", messages: [{ role: "user", content: sentence }], scope: SCOPE, schematicState: schematic, schematicHeadMark: headMark,
    editorContext: { schema: EDITOR_CONTEXT_SCHEMA, scope: SCOPE, board, pcbRevisionId: pcbRevisionId(board), selection: { refs: [], primary: null }, netlist: null, schematicDigest: schematicStateDigest(schematic), authoritySource: "local-working-copy" },
  };
}
const scenarioBody = (editor: TimerEditor, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ ...chatBody(SCENARIO_17, editor.visible(), editor.editor.headMark()), ...extra });
const request = (body: unknown): Request => new Request("http://localhost/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
type Posted = { status: number; runId: string; normalized: string; events: Array<Record<string, unknown>> };
async function post(body: unknown): Promise<Posted> {
  const response = await POST(request(body));
  const runId = response.headers.get("X-Sirkit-Run-Id") ?? "";
  const text = await response.text();
  const ndjson = (response.headers.get("Content-Type") ?? "").includes("ndjson");
  return { status: response.status, runId, normalized: runId ? text.replaceAll(runId, "<runId>") : text, events: ndjson ? text.trim().split(NEWLINE).map((line) => JSON.parse(line) as Record<string, unknown>) : [] };
}
const terminalOf = (events: Array<Record<string, unknown>>): Record<string, unknown> => events.filter((event) => event.type === "run_completed" || event.type === "run_failed").at(-1)!;
/** A fresh in-memory repository bound as the attribution store's AND the salt store's, with the stores reading it. */
function bound(): { repository: InMemoryDurableWorkflowRepository; attributions: DurableRunTraceAttributionStore; salts: DurableTraceSaltStore; traces: DurableRunTraceStore } {
  const repository = new InMemoryDurableWorkflowRepository();
  setRunAttributionStoreFactory(() => new DurableRunTraceAttributionStore(repository));
  setTraceSaltStoreFactory(() => new DurableTraceSaltStore(repository));
  setRunTraceStoreFactory(() => new DurableRunTraceStore(repository));
  return { repository, attributions: new DurableRunTraceAttributionStore(repository), salts: new DurableTraceSaltStore(repository), traces: new DurableRunTraceStore(repository) };
}
/** The attributions of one run after every scheduled write settled (polled for at least `atLeast`, never an exact count). */
async function attributionsOf(store: DurableRunTraceAttributionStore, runId: string, atLeast = 1): Promise<RunTraceAttribution[]> {
  await vi.waitFor(async () => { await drainRunAttributionWrites(); expect((await store.list(SCOPE)).filter((entry) => entry.record.document.runId === runId).length).toBeGreaterThanOrEqual(atLeast); }, { timeout: 15_000 });
  await drainRunAttributionWrites();
  await drainRunTraceWrites(); // C1's write of the same run settles too, so its record can be compared
  return (await store.list(SCOPE)).filter((entry) => entry.record.document.runId === runId).map((entry) => entry.record.document);
}
/** A valid, finalized trace built by the real recorder through a sink (default: a run-local in-memory one). */
function validTrace(options: { runId?: string; traceId?: string; sink?: AgentTraceSink; clock?: () => number; steps?: number; text?: boolean } = {}): AgentRunTrace {
  let clock = 1_000;
  const recorder = new AgentTraceRecorder({
    runId: options.runId ?? "run-b24c2-unit", traceId: options.traceId ?? "trace-b24c2-unit-1", provider: "openai", promptVersion: "b24-c2", promptDigest: "eng1-b24c2prompt", registryDigest: "eng1-b24c2registry", scope: SCOPE,
    contextDigests: { canonicalRevisionDigest: "pcb2-0123456789abcdef0123456789abcdef", schematicDigest: null, selectionDigest: null, netlistDigest: null, resourceManifestDigest: null },
  }, options.sink ?? new InMemoryTraceSink(), options.clock ?? (() => (clock += 5)));
  recorder.recordRunStarted();
  for (let step = 0; step < (options.steps ?? 1); step += 1) recorder.recordStep({ model: "scripted", usage: { inputTokens: 3, outputTokens: 5 }, toolCallCount: 0 });
  return recorder.finalize({ outcome: "completed", failureReason: null });
}
const TRUSTED = { principalId: "user-b24c2", role: "pcb_editor" as const, membershipRevision: "mbr1-eng1-0123456789abcdef0123456789abcdef", authClass: "local_dev" as const, correlationId: "corr-b24c2-0001" };
const UNPRICED = { status: "unpriced" as const, reason: "no_owner_price_table" as const };
const SALT = new Uint8Array(32).fill(7);
/** A document built from a real recorder's trace through the collector's observations. */
function builtDocument(overrides: Partial<Parameters<typeof buildRunTraceAttribution>[0]> = {}, text = "the answer"): RunTraceAttribution {
  const collector = createRunAttributionCollector({ provider: "openai", budget: DEFAULT_AGENT_BUDGET, clock: (() => { let t = 0; return () => (t += 3); })() });
  const wrapped = collector.wrapSink({ sink: new InMemoryTraceSink(), factoryFailed: false });
  collector.observeEmit({ type: "text_delta", runId: "run-b24c2-unit", text, phase: "final" });
  collector.observeEmit({ type: "run_completed", runId: "run-b24c2-unit", finalText: text, steps: 1, toolCalls: 0, usage: { inputTokens: 3, outputTokens: 5 }, model: "scripted" } as AgentRunEvent);
  validTrace({ sink: wrapped.sink });
  const document = buildRunTraceAttribution({
    observations: collector.observations(), scope: SCOPE, trusted: TRUSTED, userMessage: SIMPLE, planKind: "single", toolsetDeclarations: [], readTraces: [], deploymentConfigurationDigest: "eng1-0123456789abcdef",
    cost: UNPRICED, salt: SALT, budget: DEFAULT_AGENT_BUDGET, retryCeiling: 2, ...overrides,
  });
  if (document === null) throw new Error("no validated trace was captured");
  return document;
}
const ISO = "2026-10-08T12:00:00.000Z";

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("SIRKIT_ORCHESTRATION_ROLE_MODELS", ""); vi.stubEnv("SIRKIT_OPENAI_MODEL", ""); vi.stubEnv("SIRKIT_ANTHROPIC_MODEL", "claude-opus-4-7");
  vi.stubGlobal("fetch", () => { throw new Error("no network call is made in b24-c2-attribution"); });
  resetAdmissionControl();
  resetRunAttributionWriteCounts();
  withdrawDeploymentConfigurationDigest();
});
afterEach(async () => {
  await drainRunAttributionWrites();
  await drainRunTraceWrites();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetAdmissionControl();
  resetRunAttributionStoreFactory();
  resetTraceSaltStoreFactory();
  resetRunTraceStoreFactory();
  resetRunAttributionWriteCounts();
  resetOrchestrationStoreFactory();
  resetSpecialistSchedulerFactory();
  resetCatalog();
  withdrawDeploymentConfigurationDigest();
  state.unknownTool = null;
  state.requestIds = false;
  state.starts = [];
});

describe("[B24-C2] the attribution document through the production chat POST (D24-22, OD-208)", () => {
  it("1. the counterexample, red at 4ec18eb: under the fixture runtime a completed chat request leaves ONE agent.run-trace-attribution.v1 for its run in the fixture's in-memory repository (the production default store), with the closed keys, bound to the stored run trace by trace id and trace digest; its budget is DEFAULT_AGENT_BUDGET's six fields and its cost unpriced (no owner price table)", { timeout: 60_000 }, async () => {
    vi.stubEnv("SIRKIT_FIXTURE_RUNTIME", "blinker");
    publishDeploymentConfigurationDigest("eng1-fedcba9876543210");
    try {
      const posted = await post(chatBody(SIMPLE));
      expect(posted.status).toBe(200);
      expect(terminalOf(posted.events)).toMatchObject({ type: "run_completed" });
      const repository = fixtureContainer().durableRepository;
      const attributions = new DurableRunTraceAttributionStore(repository);
      const documents = await attributionsOf(attributions, posted.runId);
      expect(documents).toHaveLength(1);
      const document = documents[0]!;
      expect(Object.keys(document)).toEqual([...RUN_TRACE_ATTRIBUTION_KEYS]);
      expect(validateRunTraceAttribution(document)).toEqual([]);
      const traces = await new DurableRunTraceStore(repository).history(SCOPE, posted.runId);
      expect(traces).toHaveLength(1);
      expect(document).toMatchObject({ schema: RUN_TRACE_ATTRIBUTION_SCHEMA, runId: posted.runId, traceId: traces[0]!.record.traceId, traceDigest: traces[0]!.record.digest, scope: SCOPE });
      expect(document.plan).toEqual({ kind: "single" });
      expect(document.budget).toEqual({ maxModelSteps: 6, maxToolCalls: 10, perToolTimeoutMs: 15_000, runDeadlineMs: 120_000, maxIdenticalCalls: 2, executionSettlementTimeoutMs: DEFAULT_AGENT_BUDGET.executionSettlementTimeoutMs });
      expect(document.budget).toEqual({ ...DEFAULT_AGENT_BUDGET });
      expect(document.cost).toEqual(UNPRICED);
      expect(document.trustedContext).toMatchObject({ authClass: "local_dev", membershipRevision: expect.stringMatching(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/), correlationId: expect.stringMatching(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/) });
      expect(ATTRIBUTION_ROLES).toContain(document.trustedContext.role); // local_dev's one principal is the project admin; the class is closed
      expect(document.trustedContext.principalRef).toMatch(SALTED_DIGEST_PATTERN);
      expect(document.request.messageDigest).toMatch(SALTED_DIGEST_PATTERN);
      expect(document.request.messageChars).toBe(SIMPLE.length);
      expect(document.toolset).not.toBeNull();
      expect(document.toolset!.toolCount).toBeGreaterThan(0);
      expect(document.toolset!.declarationsDigest).toMatch(/^eng1-[0-9a-f]{16}$/);
      expect(document.reads).toMatchObject({ count: 0, withheld: 0, entries: [] });
      expect(document.refusedCalls).toEqual(Object.fromEntries(REFUSED_CALL_CLASSES.map((status) => [status, 0])));
      expect(document.provider).toEqual({ requestIds: [], requestIdsWithheld: 0, retryCeiling: 2, sdkRetriesObserved: "unknown" });
      expect(document.answer).toMatchObject({ outcome: "completed" });
      expect(document.answer!.digest).toMatch(SALTED_DIGEST_PATTERN);
      expect(document.answer!.chars).toBeGreaterThan(0);
      expect(document.deploymentConfigurationDigest).toBe("eng1-fedcba9876543210");
      expect(document.latency.clock).toBe("monotonic");
      expect(document.latency.eventOffsets.map((entry) => entry.seq)).toEqual(traces[0]!.record.document.events.map((event) => event.seq));
      expect(document.latency.terminalOffsetMs).not.toBeNull();
      expect(document.latency.firstTextOffsetMs).not.toBeNull();
      expect(document.diagnostics).toEqual([]);
      // the salted digests never repeat the text: the message, the principal and the answer appear nowhere in the record
      const serialized = JSON.stringify(document);
      for (const text of [SIMPLE, "user-", "(scripted)"]) expect(serialized).not.toContain(text);
      const saltHeads = await repository.listHeads({ aggregateType: TRACE_SALT_AGGREGATE_TYPE, scope: SCOPE });
      expect(saltHeads.map((head) => head.aggregateKey)).toEqual([traceSaltAggregateKey(SCOPE)]);
      expect(JSON.stringify(document)).not.toContain((saltHeads[0]!.payload as { saltHex: string }).saltHex);
      expect(runAttributionWriteCounts()).toMatchObject({ written: 1, trace_unavailable: 0, store_unavailable: 0, write_failed: 0 });
    } finally {
      resetFixtureContainer();
    }
  });

  it("5b. a Tier 3 ask under the orchestration flag is refused before any provider call (B21-B's refused run: run_completed with no step): plan.kind `refused`, toolset null, no request id, the answer the refusal's text by salted digest, the trace it binds `completed` with zero steps", { timeout: 60_000 }, async () => {
    const { attributions, traces } = bound();
    vi.stubEnv(ORCHESTRATION_ENABLED_ENV, "1");
    setOrchestrationStoreFactory(() => new DurableOrchestrationRunStore(new InMemoryDurableWorkflowRepository()));
    const posted = await post(chatBody(TIER3));
    expect(terminalOf(posted.events)).toMatchObject({ type: "run_completed", steps: 0 });
    expect(state.starts).toEqual([]);
    const [document] = await attributionsOf(attributions, posted.runId);
    expect(document).toMatchObject({ plan: { kind: "refused" }, toolset: null, provider: { requestIds: [], requestIdsWithheld: 0 }, answer: { outcome: "completed" } });
    expect(document!.answer!.digest).toMatch(SALTED_DIGEST_PATTERN);
    expect(document!.answer!.chars).toBe((terminalOf(posted.events).finalText as string).length);
    expect(document!.latency.firstTextOffsetMs).toBeNull(); // no text_delta on a refused run
    const [trace] = await traces.history(SCOPE, posted.runId);
    expect(trace!.record.document.terminal).toMatchObject({ outcome: "completed", steps: 0 });
    expect(document!.traceDigest).toBe(trace!.record.digest);
  });

  it("14. a dag run (B21-E3's scenario 17): the request ids are the coordinator's two turns - the first and the follow-up - through the ONE observed adapter, no specialist id among them, none withheld; an unknown tool the first turn requests is one `unknown_tool` refusal", { timeout: 120_000 }, async () => {
    const { attributions } = bound();
    vi.stubEnv(ORCHESTRATION_ENABLED_ENV, "1");
    setOrchestrationStoreFactory(() => new DurableOrchestrationRunStore(new InMemoryDurableWorkflowRepository()));
    await installCatalog(SCOPE);
    const editor = await timerEditor(SCOPE);
    state.requestIds = true;
    const posted = await post(scenarioBody(editor));
    expect(posted.status).toBe(200);
    expect(terminalOf(posted.events)).toMatchObject({ type: "run_completed" });
    expect(state.starts.filter((turn) => turn !== "coordinator" && turn !== "coordinator-2" && turn !== "continue").length).toBeGreaterThan(0); // specialists ran
    const [document] = await attributionsOf(attributions, posted.runId);
    expect(document!.plan).toEqual({ kind: "dag" });
    expect(document!.provider.requestIds.length).toBeGreaterThanOrEqual(2);
    expect(document!.provider.requestIds.length).toBeLessThanOrEqual(2 * DEFAULT_AGENT_BUDGET.maxModelSteps);
    expect(document!.provider.requestIds.every((id) => id.startsWith("req-coordinator") || id.startsWith("req-continue"))).toBe(true);
    expect(document!.provider.requestIds.some((id) => id.startsWith("req-coordinator-2-"))).toBe(true);
    expect(document!.provider.requestIdsWithheld).toBe(0);
    // an unknown tool requested by the first turn: refused before it runs, counted, and the run still answers
    state.starts = [];
    state.unknownTool = "sirkit_no_such_tool";
    const refused = await post(chatBody(SIMPLE));
    expect(terminalOf(refused.events)).toMatchObject({ type: "run_completed" });
    expect(refused.events.filter((event) => event.type === "tool_refused").map((event) => event.status)).toEqual(["unknown_tool"]);
    const [second] = await attributionsOf(attributions, refused.runId);
    expect(second!.refusedCalls).toEqual({ ...Object.fromEntries(REFUSED_CALL_CLASSES.map((status) => [status, 0])), unknown_tool: 1 });
    expect(second!.provider.requestIds).toHaveLength(2); // the refused step and the continuation
  });

  it("9. two concurrent first runs in one scope converge on ONE salt: the store resolves one aggregate for two concurrent resolves, and two parallel chat requests of one principal carry the same principalRef under one agent.trace-salt.v1 head", { timeout: 60_000 }, async () => {
    const { repository, attributions, salts } = bound();
    const [a, b] = await Promise.all([salts.resolve(SCOPE, ISO), salts.resolve(SCOPE, ISO)]);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) throw new Error("unreachable");
    expect(Buffer.from(a.salt).toString("hex")).toBe(Buffer.from(b.salt).toString("hex"));
    expect([a.created, b.created].filter(Boolean)).toHaveLength(1);
    expect(await repository.history({ scope: SCOPE, aggregateType: TRACE_SALT_AGGREGATE_TYPE, aggregateKey: traceSaltAggregateKey(SCOPE) })).toHaveLength(1);
    const other = await new DurableTraceSaltStore(repository).resolve({ ...SCOPE, projectId: "project-2" }, ISO);
    expect(other.ok && Buffer.from(other.salt).toString("hex") !== Buffer.from(a.salt).toString("hex")).toBe(true); // per scope, not per tenant (a stated choice)
    const fresh = bound();
    const [first, second] = await Promise.all([post(chatBody(SIMPLE)), post(chatBody(SIMPLE))]);
    const [one] = await attributionsOf(fresh.attributions, first.runId);
    const [two] = await attributionsOf(fresh.attributions, second.runId);
    expect(one!.trustedContext.principalRef).toMatch(SALTED_DIGEST_PATTERN);
    expect(one!.trustedContext.principalRef).toBe(two!.trustedContext.principalRef);
    expect(one!.request.messageDigest).toBe(two!.request.messageDigest);
    expect((await fresh.repository.listHeads({ aggregateType: TRACE_SALT_AGGREGATE_TYPE, scope: SCOPE })).map((head) => head.revision)).toEqual([1]);
    void attributions;
  });

  it("10. recording failure is passive: with a throwing store factory the request streams B21-B's recorded bytes and ends in run_completed, the failure is counted `store_unavailable`, and nothing was written; with the salt store throwing the document is written with null digests and `salt_unavailable`", { timeout: 60_000 }, async () => {
    publishDeploymentConfigurationDigest("eng1-0123456789abcdef"); // so the only diagnostic below is the salt's
    setRunAttributionStoreFactory(() => { throw new Error("no store in case 10"); });
    const posted = await post(chatBody(SIMPLE));
    expect(posted.status).toBe(200);
    expect(terminalOf(posted.events)).toMatchObject({ type: "run_completed" });
    expect(engineeringDigest(posted.normalized)).toBe(SIMPLE_HEAD_DIGEST);
    await drainRunAttributionWrites();
    expect(runAttributionWriteCounts()).toMatchObject({ store_unavailable: 1, written: 0 });
    const { attributions } = bound();
    setTraceSaltStoreFactory(() => { throw new Error("no salt store in case 10"); });
    const unsalted = await post(chatBody(SIMPLE));
    const [document] = await attributionsOf(attributions, unsalted.runId);
    expect(document!.trustedContext.principalRef).toBeNull();
    expect(document!.request.messageDigest).toBeNull();
    expect(document!.answer).toMatchObject({ digest: null, outcome: "completed" });
    expect(document!.diagnostics).toEqual(["salt_unavailable"]);
    expect(engineeringDigest(unsalted.normalized)).toBe(SIMPLE_HEAD_DIGEST);
    expect(RUN_ATTRIBUTION_WRITE_FAILURES).toEqual(["trace_unavailable", "store_unavailable", "refused", "write_failed", "dropped"]);
    expect(RUN_ATTRIBUTION_PENDING_BOUND).toBe(64);
  });

  it("13. the deployment configuration digest (OD-199): recorded when published, null with the closed diagnostic when not; instrumentation.ts publishes A1's record digest after the fixture clock under the nodejs runtime, and it equals deploymentConfiguration().digest", { timeout: 60_000 }, async () => {
    const { attributions } = bound();
    const posted = await post(chatBody(SIMPLE));
    const [document] = await attributionsOf(attributions, posted.runId);
    expect(document!.deploymentConfigurationDigest).toBeNull();
    expect(document!.diagnostics).toEqual(["deployment_configuration_unavailable"]);
    expect(publishedDeploymentConfigurationDigest()).toBeNull();
    const { register } = await import("@/instrumentation");
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    await register();
    expect(publishedDeploymentConfigurationDigest()).toBe(deploymentConfiguration().digest);
    const published = await post(chatBody(SIMPLE));
    const [second] = await attributionsOf(attributions, published.runId);
    expect(second!.deploymentConfigurationDigest).toBe(deploymentConfiguration().digest);
    expect(second!.diagnostics).toEqual([]);
    const source = read("instrumentation.ts");
    expect(source.indexOf("installFixtureClock();")).toBeLessThan(source.indexOf("publishDeploymentConfigurationDigest("));
    expect(source.indexOf('if (process.env.NEXT_RUNTIME !== "nodejs") return;')).toBeLessThan(source.indexOf("deployment-configuration-digest"));
    expect(ATTRIBUTION_DIAGNOSTICS).toEqual(["salt_unavailable", "deployment_configuration_unavailable"]);
    expect(publishDeploymentConfigurationDigest("not a digest")).toBe(false); // a value outside the digest rule is never published
  });
});

describe("[B24-C2] the validator, the builder and the collector", () => {
  it("2. an unknown key, a text value, a reasoning-shaped key and an unsalted digest are refused; the store then writes nothing; a valid document is written once at revision 1, the same trace id again is a replay", async () => {
    const valid = builtDocument();
    expect(validateRunTraceAttribution(valid)).toEqual([]);
    expect(validateRunTraceAttribution({ ...valid, extra: 1 })).not.toEqual([]);
    expect(validateRunTraceAttribution({ ...valid, reasoning: "hidden" })).not.toEqual([]);
    expect(validateRunTraceAttribution({ ...valid, request: { ...valid.request, messageText: SIMPLE } })).not.toEqual([]);
    expect(validateRunTraceAttribution({ ...valid, trustedContext: { ...valid.trustedContext, principalRef: "user-b24c2" } })).not.toEqual([]);
    expect(validateRunTraceAttribution({ ...valid, trustedContext: { ...valid.trustedContext, principalRef: engineeringDigest("user-b24c2") } })).not.toEqual([]); // unsalted
    expect(validateRunTraceAttribution({ ...valid, request: { ...valid.request, messageDigest: `sd1-${"g".repeat(64)}` } })).not.toEqual([]);
    expect(validateRunTraceAttribution({ ...valid, answer: { ...valid.answer!, digest: "the answer" } })).not.toEqual([]);
    expect(validateRunTraceAttribution({ ...valid, provider: { ...valid.provider, requestIds: ["has space"] } })).not.toEqual([]);
    expect(validateRunTraceAttribution({ ...valid, provider: { ...valid.provider, sdkRetriesObserved: 0 } })).not.toEqual([]);
    expect(validateRunTraceAttribution({ ...valid, plan: { kind: "other" } })).not.toEqual([]);
    expect(validateRunTraceAttribution({ ...valid, refusedCalls: { ...valid.refusedCalls, other: -1 } })).not.toEqual([]);
    expect(validateRunTraceAttribution({ ...valid, latency: { ...valid.latency, clock: "wall" } })).not.toEqual([]);
    expect(validateRunTraceAttribution({ ...valid, diagnostics: ["salt_unavailable", "free text"] })).not.toEqual([]);
    const secret = ["sk-", "live", "0123456789abcdefghij"].join("");
    expect(validateRunTraceAttribution({ ...valid, provider: { ...valid.provider, requestIds: [secret] } })).not.toEqual([]); // findSecretShapedPath, defence in depth
    expect(validateRunTraceAttribution({ ...valid, cost: { status: "priced", priceTableVersion: "1.0.0", currency: "XTS", costMicrounits: "1e3" } })).not.toEqual([]);
    expect(validateRunTraceAttribution({ ...valid, cost: { status: "priced", priceTableVersion: "1.0.0", currency: "XTS", costMicrounits: "20" } })).toEqual([]);
    const store = new DurableRunTraceAttributionStore(new InMemoryDurableWorkflowRepository());
    expect(await store.append({ scope: SCOPE, document: { ...valid, extra: 1 } as unknown as RunTraceAttribution, at: ISO })).toMatchObject({ ok: false, code: "invalid_document" });
    expect(await store.append({ scope: { ...SCOPE, projectId: "project-9" }, document: valid, at: ISO })).toMatchObject({ ok: false, code: "scope_mismatch" });
    expect(await store.append({ scope: SCOPE, document: valid, at: "yesterday" })).toMatchObject({ ok: false, code: "invalid_time" });
    expect(await store.list(SCOPE)).toEqual([]);
    const written = await store.append({ scope: SCOPE, document: valid, at: ISO });
    expect(written).toMatchObject({ ok: true, revision: 1, replayed: false });
    expect(await store.append({ scope: SCOPE, document: valid, at: ISO })).toEqual({ ...written, replayed: true });
    const loaded = await store.load(SCOPE, valid.traceId);
    expect(loaded!.record.document).toEqual(valid);
    expect(loaded!.revision).toBe(1);
    expect((await store.list(SCOPE)).map((entry) => entry.record.traceId)).toEqual([valid.traceId]);
  });

  it("3. `salt_unavailable` yields null digests and the closed diagnostic; with a salt every digest is the salted digest of its domain and text, and never an unsalted one", () => {
    const unsalted = builtDocument({ salt: null });
    expect(unsalted.trustedContext.principalRef).toBeNull();
    expect(unsalted.request.messageDigest).toBeNull();
    expect(unsalted.answer).toMatchObject({ digest: null, chars: "the answer".length, outcome: "completed" });
    expect(unsalted.diagnostics).toEqual(["salt_unavailable"]);
    expect(validateRunTraceAttribution(unsalted)).toEqual([]);
    const salted = builtDocument();
    expect(salted.trustedContext.principalRef).toBe(saltedDigest(SALT, "principal", TRUSTED.principalId));
    expect(salted.request.messageDigest).toBe(saltedDigest(SALT, "message", SIMPLE));
    expect(salted.answer!.digest).toBe(saltedDigest(SALT, "answer", "the answer"));
    expect(salted.trustedContext.principalRef).not.toBe(saltedDigest(new Uint8Array(32).fill(8), "principal", TRUSTED.principalId));
    expect(salted.diagnostics).toEqual([]);
  });

  it("4. the bounds: the seven refused-call classes (six statuses plus `other`), at most 64 reads of 64 resources each (the rest counted), at most 2 x maxModelSteps request ids - the excess, a malformed id and a secret-shaped id counted in requestIdsWithheld", async () => {
    const collector = createRunAttributionCollector({ provider: "openai", budget: DEFAULT_AGENT_BUDGET, clock: () => 0 });
    for (const status of ["unknown_tool", "budget_exhausted", "invalid_input", "repeated_call", "proposal_exists", "execution_exists", "something_new", "unknown_tool"]) {
      collector.observeEmit({ type: "tool_refused", runId: "run-b24c2-unit", callId: "c", toolId: null, title: null, tier: null, status });
    }
    const secret = ["sk-", "ant-", "api03-", "0123456789abcdef"].join("");
    const ids = [...Array.from({ length: 2 * DEFAULT_AGENT_BUDGET.maxModelSteps + 3 }, (_, index) => `req_${index}`), "has space", secret, "", "x".repeat(129)];
    const scripted: ProviderAgentAdapter = {
      provider: "openai",
      async start(): Promise<AgentStep> { return { text: "", toolCalls: [], stopReason: null, usage: {}, model: "scripted", continuation: { provider: "openai", state: null }, providerRequestId: ids[0] }; },
      async continueWith(): Promise<AgentStep> { return { text: "", toolCalls: [], stopReason: null, usage: {}, model: "scripted", continuation: { provider: "openai", state: null } }; },
    };
    const observed = collector.observeAdapter(scripted);
    expect(observed.provider).toBe("openai");
    await observed.start({ system: "", history: [], userMessage: "", tools: [] });
    for (const id of ids.slice(1)) {
      scripted.continueWith = async () => ({ text: "", toolCalls: [], stopReason: null, usage: {}, model: "scripted", continuation: { provider: "openai", state: null }, providerRequestId: id });
      await observed.continueWith({ continuation: { provider: "openai", state: null }, results: [], tools: [] });
    }
    scripted.continueWith = async () => ({ text: "", toolCalls: [], stopReason: null, usage: {}, model: "scripted", continuation: { provider: "openai", state: null } });
    await observed.continueWith({ continuation: { provider: "openai", state: null }, results: [], tools: [] }); // a step without an id counts nothing
    const reads: RunAttributionReadTrace[] = Array.from({ length: 70 }, (_, index) => ({
      sourceRevisionDigest: `pcb2-${String(index).padStart(32, "0")}`,
      consumedResources: Array.from({ length: index === 0 ? 70 : 2 }, (_, resource) => ({ resourceId: `res:${index}:${resource}`, kind: "schematic", sourceVersion: `v${resource}`, contentDigest: `eng1-${String(resource).padStart(16, "0")}` })),
    }));
    validTrace({ sink: collector.wrapSink({ sink: new InMemoryTraceSink(), factoryFailed: false }).sink });
    const document = buildRunTraceAttribution({ observations: collector.observations(), scope: SCOPE, trusted: TRUSTED, userMessage: SIMPLE, planKind: "single", toolsetDeclarations: null, readTraces: reads, deploymentConfigurationDigest: null, cost: UNPRICED, salt: SALT, budget: DEFAULT_AGENT_BUDGET, retryCeiling: 2 })!;
    expect(validateRunTraceAttribution(document)).toEqual([]);
    expect(document.refusedCalls).toEqual({ unknown_tool: 2, budget_exhausted: 1, invalid_input: 1, repeated_call: 1, proposal_exists: 1, execution_exists: 1, other: 1 });
    expect(document.provider.requestIds).toEqual(ids.slice(0, 2 * DEFAULT_AGENT_BUDGET.maxModelSteps));
    expect(document.provider.requestIdsWithheld).toBe(3 + 4);
    expect(document.reads.count).toBe(70);
    expect(document.reads.withheld).toBe(6);
    expect(document.reads.entries).toHaveLength(64);
    expect(document.reads.entries[0]!.resources).toHaveLength(64);
    expect(document.reads.entries[0]!.resourcesWithheld).toBe(6);
    expect(document.reads.entries[1]!.resources).toEqual([{ resourceId: "res:1:0", sourceVersion: "v0", contentDigest: `eng1-${"0".repeat(16)}` }, { resourceId: "res:1:1", sourceVersion: "v1", contentDigest: `eng1-${"0".repeat(15)}1` }]);
    expect(document.reads.canonicalRevisionDigest).toBe("pcb2-0123456789abcdef0123456789abcdef");
    expect(document.toolset).toBeNull();
    expect(document.diagnostics).toEqual(["deployment_configuration_unavailable"]);
    expect(JSON.stringify(document)).not.toContain(secret);
    expect(REFUSED_CALL_CLASSES).toEqual(["unknown_tool", "budget_exhausted", "invalid_input", "repeated_call", "proposal_exists", "execution_exists", "other"]);
  });

  it("6. latency on an injected monotonic clock: one eventOffsets entry per appended trace event, keyed by its seq, non-decreasing and at most 256; firstTextOffsetMs at the first text_delta seen by emit; terminalOffsetMs at the trace's terminal event; a sink past the event bound keeps 256", () => {
    let now = 100;
    const clock = () => now;
    const collector = createRunAttributionCollector({ provider: "anthropic", budget: DEFAULT_AGENT_BUDGET, clock });
    const inner = new InMemoryTraceSink();
    const wrapped = collector.wrapSink({ sink: inner, factoryFailed: false });
    expect(wrapped.factoryFailed).toBe(false);
    now = 110;
    collector.observeEmit({ type: "text_delta", runId: "run-b24c2-unit", text: "a", phase: "interim" });
    now = 120;
    collector.observeEmit({ type: "text_delta", runId: "run-b24c2-unit", text: "b", phase: "final" }); // the first text_delta alone is kept
    let recorderClock = 1_000;
    const recorder = new AgentTraceRecorder({
      runId: "run-b24c2-unit", traceId: "trace-b24c2-latency", provider: "anthropic", promptVersion: "b24-c2", promptDigest: "eng1-b24c2prompt", registryDigest: "eng1-b24c2registry", scope: SCOPE,
      contextDigests: { canonicalRevisionDigest: null, schematicDigest: null, selectionDigest: null, netlistDigest: null, resourceManifestDigest: null },
    }, wrapped.sink, () => (recorderClock += 5));
    now = 130; recorder.recordRunStarted();
    now = 140; recorder.recordStep({ model: "scripted", usage: { inputTokens: 1, outputTokens: 1 }, toolCallCount: 0 });
    now = 150; recorder.recordStep({ model: "scripted", usage: { inputTokens: 1, outputTokens: 1 }, toolCallCount: 0 });
    now = 190; const trace = recorder.finalize({ outcome: "completed", failureReason: null });
    expect(inner.appended).toHaveLength(4); // the inner sink saw every event
    expect(inner.completed).toEqual(trace);
    const observations = collector.observations();
    expect(observations.eventOffsets).toEqual([{ seq: 1, offsetMs: 30 }, { seq: 2, offsetMs: 40 }, { seq: 3, offsetMs: 50 }, { seq: 4, offsetMs: 90 }]);
    expect(observations.firstTextOffsetMs).toBe(10);
    expect(observations.terminalOffsetMs).toBe(90);
    expect(observations.trace).toEqual(trace);
    expect(observations.traceDigest).toBe(agentRunTraceDigest(trace));
    const document = buildRunTraceAttribution({ observations, scope: SCOPE, trusted: TRUSTED, userMessage: SIMPLE, planKind: "single", toolsetDeclarations: [], readTraces: [], deploymentConfigurationDigest: null, cost: UNPRICED, salt: SALT, budget: DEFAULT_AGENT_BUDGET, retryCeiling: "sdk_default" })!;
    expect(document.latency).toEqual({ clock: "monotonic", firstTextOffsetMs: 10, terminalOffsetMs: 90, eventOffsets: observations.eventOffsets });
    expect(document.provider.retryCeiling).toBe("sdk_default");
    expect(document.answer).toBeNull(); // no run_completed was observed
    // the event bound: a run that fills the trace keeps at most TRACE_BOUNDS.maxEvents offsets, every one non-decreasing
    const full = createRunAttributionCollector({ provider: "openai", budget: DEFAULT_AGENT_BUDGET, clock: (() => { let t = 0; return () => (t += 1); })() });
    const fullTrace = validTrace({ sink: full.wrapSink({ sink: new InMemoryTraceSink(), factoryFailed: false }).sink, steps: 300 });
    const offsets = full.observations().eventOffsets;
    expect(fullTrace.events.length).toBe(TRACE_BOUNDS.maxEvents);
    expect(offsets).toHaveLength(TRACE_BOUNDS.maxEvents);
    expect(offsets.map((entry) => entry.seq)).toEqual(fullTrace.events.map((event) => event.seq));
    expect(offsets.every((entry, index) => index === 0 || entry.offsetMs >= offsets[index - 1]!.offsetMs)).toBe(true);
    // a throwing inner sink still throws to the recorder (which classifies it), and the wrapper keeps its own bookkeeping
    const throwing = createRunAttributionCollector({ provider: "openai", budget: DEFAULT_AGENT_BUDGET, clock: () => 1 });
    const hostile: AgentTraceSink = { append() { throw new Error("hostile"); }, complete() { throw new Error("hostile"); } };
    const sink = throwing.wrapSink({ sink: hostile, factoryFailed: true }).sink;
    expect(() => sink.append({ seq: 1, kind: "run_started" })).toThrow("hostile");
    expect(throwing.observations().eventOffsets).toEqual([{ seq: 1, offsetMs: 0 }]);
  });

  it("7. the real adapters: a fake SDK response carrying `_request_id` yields providerRequestId on the AgentStep; one without leaves the key ABSENT; a non-string or empty id is absent too", async () => {
    const { OpenAIAgentAdapter, AnthropicAgentAdapter } = await vi.importActual<typeof import("@/app/lib/agent/adapters")>("@/app/lib/agent/adapters");
    const openAIResponse = (extra: Record<string, unknown>) => ({ output: [{ type: "message", role: "assistant", content: [] }], output_text: "Hello.", status: "completed", model: "gpt-test", usage: { input_tokens: 10, output_tokens: 5 }, ...extra });
    const anthropicMessage = (extra: Record<string, unknown>) => ({ content: [{ type: "text", text: "Hello." }], stop_reason: "end_turn", model: "claude-test", usage: { input_tokens: 10, output_tokens: 5 }, ...extra });
    const input = { system: "sys", history: [], userMessage: "hi", tools: [] };
    for (const [extra, expected] of [[{ _request_id: "req_openai_1" }, "req_openai_1"], [{}, undefined], [{ _request_id: null }, undefined], [{ _request_id: "" }, undefined], [{ _request_id: 42 }, undefined]] as const) {
      const create = vi.fn(async () => openAIResponse(extra as Record<string, unknown>));
      const step = await new OpenAIAgentAdapter({ responses: { create } } as never, "gpt-test", undefined).start(input);
      if (expected === undefined) expect("providerRequestId" in step).toBe(false);
      else expect(step.providerRequestId).toBe(expected);
      expect(step.text).toBe("Hello.");
    }
    for (const [extra, expected] of [[{ _request_id: "req_anthropic_1" }, "req_anthropic_1"], [{}, undefined]] as const) {
      const create = vi.fn(async () => anthropicMessage(extra as Record<string, unknown>));
      const step = await new AnthropicAgentAdapter({ messages: { create } } as never, "claude-test").start(input);
      if (expected === undefined) expect("providerRequestId" in step).toBe(false);
      else expect(step.providerRequestId).toBe(expected);
    }
    // the continuation path carries it too
    const create = vi.fn(async () => openAIResponse({ _request_id: "req_openai_2" }));
    const adapter = new OpenAIAgentAdapter({ responses: { create } } as never, "gpt-test", undefined);
    const first = await adapter.start(input);
    const second = await adapter.continueWith({ continuation: first.continuation, results: [], tools: [] });
    expect(second.providerRequestId).toBe("req_openai_2");
    // the installed SDKs type the field (INFERRED from their declarations; no live call)
    for (const sdk of ["@anthropic-ai/sdk", "openai"]) expect(read(`node_modules/${sdk}/internal/parse.d.ts`)).toContain("_request_id?: string | null;");
  });

  it("8. retryCeiling is the coordinator adapter's configured value - 2 for OpenAI (adapters.ts, `maxRetries: number = 2`), \"sdk_default\" for Anthropic (`maxRetries?: number`, passed only when given) - and sdkRetriesObserved is always \"unknown\" (9.5 item 33 stays UNKNOWN, stated)", () => {
    expect(COORDINATOR_SDK_RETRY_CEILING).toEqual({ openai: 2, anthropic: "sdk_default" });
    const adapters = read("app/lib/agent/adapters.ts");
    expect(adapters).toContain("private readonly maxRetries: number = 2,");
    expect(adapters).toContain("private readonly maxRetries?: number)");
    expect(builtDocument({ retryCeiling: COORDINATOR_SDK_RETRY_CEILING.openai }).provider).toMatchObject({ retryCeiling: 2, sdkRetriesObserved: "unknown" });
    expect(builtDocument({ retryCeiling: COORDINATOR_SDK_RETRY_CEILING.anthropic }).provider).toMatchObject({ retryCeiling: "sdk_default", sdkRetriesObserved: "unknown" });
    expect([...ATTRIBUTION_RETRY_CEILINGS].sort()).toEqual([...new Set(Object.values(COORDINATOR_SDK_RETRY_CEILING))].sort()); // the validator's closed class is the adapters' configured values
    expect(validateRunTraceAttribution({ ...builtDocument(), provider: { ...builtDocument().provider, retryCeiling: 3 } })).not.toEqual([]);
    expect(validateRunTraceAttribution({ ...builtDocument(), provider: { ...builtDocument().provider, retryCeiling: "default" } })).not.toEqual([]);
  });
});

// ── the B11 hashes (D20) and the import gates ──────────────────────────────────────────────────────────────────────────────
const E2B = "app/lib/agent/orchestration/__tests__/b21-e2b-trace-attribution.test.ts";
const ROUTE = "app/api/chat/route.ts";
const TRACE_RUNTIME = "app/api/chat/trace-runtime.ts";
const ATTRIBUTION_RUNTIME = "app/api/chat/attribution-runtime.ts";
const STORE = "app/lib/observability/run-trace-store.ts";
const ATTRIBUTION_STORE = "app/lib/observability/run-trace-attribution.ts";
const SALT_STORE = "app/lib/observability/trace-salt.ts";
const COLLECTOR = "app/lib/observability/run-attribution-collector.ts";
const DIGEST_SLOT = "app/lib/observability/deployment-configuration-digest.ts";
const PRICE_TABLE = "app/lib/evaluation/model-price-table.ts";
const NEVER = ["app/lib/durable-workflow/runtime.ts", "app/lib/durable-workflow/server-repository.ts", "app/lib/db/client.ts", "app/lib/db/schema.ts", TRACE_RUNTIME, ATTRIBUTION_RUNTIME];
const SDK_SPECIFIERS = new Set(["openai", "@anthropic-ai/sdk"]);
let production: FileMap | null = null;
const files = (): FileMap => (production ??= collectProductionFiles(ROOT));
function runtimeEdges(map: FileMap, file: string): string[] {
  const source = map.get(file)!;
  const runtime = runtimeDeclarationSpecifiers(file, source);
  const edges: string[] = [];
  for (const reference of moduleReferences(file, source)) {
    if (reference.kind === "import-type") continue;
    if ((reference.kind === "static-import" || reference.kind === "re-export") && !runtime.has(reference.specifier)) continue;
    const resolution = resolveSpecifier(file, reference.specifier);
    if (resolution.kind !== "module") continue;
    const target = fileOf(map, resolution.module);
    if (target !== null && !edges.includes(target)) edges.push(target);
  }
  return edges;
}
/** The direct runtime importers of `target` (a type-only import does not count); only a file naming the target's basename can. */
function importersOf(map: FileMap, target: string): string[] {
  const name = target.split("/").at(-1)!.replace(/\.ts$/, "");
  return [...map.keys()].filter((file) => file !== target && map.get(file)!.includes(name) && runtimeEdges(map, file).includes(target)).sort();
}
const reached = (map: FileMap, entry: string): string[] => { const closure = importClosure(map, [entry]); return NEVER.filter((never) => closure.has(never)).map((never) => closure.get(never)!.join(" -> ")); };
/** Every bare SDK specifier a closure imports for its value. */
function sdkSpecifiersIn(map: FileMap, entry: string): string[] {
  return [...importClosure(map, [entry]).keys()].flatMap((file) => [...runtimeDeclarationSpecifiers(file, map.get(file)!)].filter((specifier) => SDK_SPECIFIERS.has(specifier)).map((specifier) => `${file}: ${specifier}`));
}

describe("[B24-C2] the hash pins and the import gates", () => {
  it("11. the nine B11-scanned files are unchanged (lead decision D20): B21-E2b's SCANNED_AT_HEAD, read from its source, names exactly B11_SCANNED_FILES and every file hashes to its entry - this case holds no hash of its own", () => {
    const block = read(E2B).split("const SCANNED_AT_HEAD")[1]!.split("};")[0]!;
    const entries = [...block.matchAll(/"([^"]+\.ts)": "([0-9a-f]{64})"/g)].map((match) => [match[1]!, match[2]!] as const);
    expect(entries.map(([path]) => path).sort()).toEqual([...B11_SCANNED_FILES].sort());
    for (const [path, expected] of entries) expect(createHash("sha256").update(readFileSync(join(ROOT, path))).digest("hex"), path).toBe(expected);
  });

  it("12. the import gates: the attribution store, the salt store, the collector, the digest slot and the price table reach no provider SDK and none of the durable runtime, the server repository, the database client, the schema or the two chat runtimes; C1's gates hold unmoved (trace-runtime's one importer is the route, the run-trace store's importers are trace-runtime and app/lib/observability/); attribution-runtime's one production importer is the route, on its line 35; the route keeps its 562 lines and B21-E4's markers and never reaches app/lib/deployment/configuration.ts", { timeout: 180_000 }, async () => {
    const map = files();
    for (const entry of [ATTRIBUTION_STORE, SALT_STORE, COLLECTOR, DIGEST_SLOT, PRICE_TABLE, STORE, "app/lib/agent/loop.ts", "app/lib/agent/gateway.ts", "app/lib/agent/trace.ts", "app/lib/agent/trace-recorder.ts"]) {
      expect(map.has(entry), entry).toBe(true);
      expect(reached(map, entry), entry).toEqual([]);
      expect(sdkSpecifiersIn(map, entry), entry).toEqual([]);
      await new Promise((resolve) => setImmediate(resolve)); // yield between walks (lead lesson 3)
    }
    expect([...runtimeDeclarationSpecifiers(ATTRIBUTION_STORE, map.get(ATTRIBUTION_STORE)!)].sort()).toEqual(["../agent/trace", "../durable-workflow/stable", "../engineering/stable"]);
    expect([...runtimeDeclarationSpecifiers(SALT_STORE, map.get(SALT_STORE)!)].sort()).toEqual(["../durable-workflow/stable", "node:crypto"]);
    expect([...runtimeDeclarationSpecifiers(PRICE_TABLE, map.get(PRICE_TABLE)!)].sort()).toEqual(["../release-engineering/procurement", "./live-spend"]);
    expect([...runtimeDeclarationSpecifiers(STORE, map.get(STORE)!)].sort()).toEqual(["../agent/trace", "../durable-workflow/stable", "../engineering/stable"]); // C1's pin, unmoved
    expect([...runtimeDeclarationSpecifiers(TRACE_RUNTIME, map.get(TRACE_RUNTIME)!)].sort()).toEqual(["@/app/lib/agent/trace-recorder", "@/app/lib/durable-workflow/runtime", "@/app/lib/observability/run-trace-store"]); // C1's pin, unmoved
    expect(importersOf(map, TRACE_RUNTIME)).toEqual([ROUTE]);
    expect(importersOf(map, ATTRIBUTION_RUNTIME)).toEqual([ROUTE]);
    expect(importersOf(map, STORE).filter((file) => file !== TRACE_RUNTIME && !file.startsWith("app/lib/observability/"))).toEqual([]);
    for (const pure of [ATTRIBUTION_STORE, SALT_STORE, COLLECTOR]) expect(importersOf(map, pure).filter((file) => file !== ATTRIBUTION_RUNTIME && !file.startsWith("app/lib/observability/")), pure).toEqual([]);
    expect(importersOf(map, PRICE_TABLE)).toEqual([ATTRIBUTION_RUNTIME]);
    expect([...map].filter(([, source]) => /new\s+PostgresDurableWorkflowRepository\s*\(/.test(source)).map(([path]) => path).sort()).toEqual(["app/lib/durable-workflow/runtime.ts", "scripts/retention-purge.ts"]); // D11: neither runtime constructs one [B24-C3, 2026-10-09] reviewed pin move: + the purge CLI, whose read mode constructs the PostgreSQL repository for its read-only adapter (b24-c3-trace-read 10 pins the pair); was the durable runtime alone
    const route = read(ROUTE).split(NEWLINE);
    expect(route.length - 1).toBe(562);
    expect(route.flatMap((line, index) => (line.includes("[B21 E4]") ? [index + 1] : []))).toEqual([35, 504, 507]);
    expect(route[34]).toContain('import { beginRunAttribution } from "./attribution-runtime";');
    expect(route.filter((line) => line.includes("attribution-runtime"))).toHaveLength(1);
    expect(route[39]).toMatch(/^import \{ AgentTraceRecorder, createAgentTraceSink \} from "@\/app\/lib\/agent\/trace-recorder"; import "\.\/trace-runtime"; \/\/ \[B24-C1\] D24-20, OD-207: /); // C1's line, unmoved
    const chatClosure = importClosure(map, [ROUTE]);
    expect(chatClosure.has("app/lib/deployment/configuration.ts")).toBe(false); // it would pull the provider directory into the chat closure (b19-d's FORBIDDEN list, b23-a-tier3-vocabulary 7)
    expect([...chatClosure.keys()].filter((file) => file.startsWith("app/lib/manufacturing-providers/"))).toEqual([]);
    expect(chatClosure.has(ATTRIBUTION_RUNTIME) && chatClosure.has(ATTRIBUTION_STORE) && chatClosure.has(SALT_STORE) && chatClosure.has(COLLECTOR) && chatClosure.has(PRICE_TABLE)).toBe(true);
    // the recorder and the trace contract are not edited (case 11 holds their hashes): neither names this document's schema or aggregate (OD-208: never inside trace.ts)
    for (const scanned of ["app/lib/agent/trace.ts", "app/lib/agent/trace-recorder.ts"]) for (const name of [RUN_TRACE_ATTRIBUTION_SCHEMA, RUN_TRACE_ATTRIBUTION_AGGREGATE_TYPE, "B24-C2"]) expect(map.get(scanned)!, `${scanned}: ${name}`).not.toContain(name);
    // the aggregate names appear in the two stores, the composition root that writes them and the retention policy that lists them - nowhere else
    const POLICY = "app/lib/observability/retention-policy.ts";
    expect([...map].filter(([, source]) => source.includes(RUN_TRACE_ATTRIBUTION_AGGREGATE_TYPE)).map(([path]) => path).sort()).toEqual([ATTRIBUTION_RUNTIME, ATTRIBUTION_STORE, POLICY].sort());
    expect([...map].filter(([, source]) => source.includes(TRACE_SALT_AGGREGATE_TYPE)).map(([path]) => path).sort()).toEqual([ATTRIBUTION_RUNTIME, SALT_STORE, POLICY].sort());
  });
});
