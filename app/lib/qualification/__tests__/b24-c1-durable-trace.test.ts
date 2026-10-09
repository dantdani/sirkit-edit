/**
 * [B24-C1] D24-20, OD-207 - the durable run trace. The chat route's recorder builds, validates and finalizes one
 * `sirkit.agent-run-trace.v1` document per run; until C1 it was handed to a run-local in-memory sink and lost when the request ended
 * (`trace-recorder.ts`, the default factory). C1 binds a durable sink at the chat composition root (`app/api/chat/trace-runtime.ts`)
 * over `agent.run-trace.v1` (`app/lib/observability/run-trace-store.ts`).
 *
 * Red first (recorded on observability-and-replay.md): at a405db9 this suite fails to load (both modules are missing), and the
 * behavioural counterexample - a completed chat request under the fixture runtime leaves no `agent.run-trace.v1` head for its
 * `X-Sirkit-Run-Id` - was run alone against a405db9 and failed (0 heads).
 *
 *  1. under the fixture runtime a completed chat request leaves one record for its run id in the fixture's in-memory repository;
 *  2. one valid record per run: the closed record keys, the trace digest, the validated document and no `trace_sink_*` diagnostic;
 *  3. a failed, a cancelled, a Tier 3-refused and a breaker-paused run each keep one record with the stream's terminal;
 *  4. a resumed run (the same run id) appends revision 2;
 *  5. the stream is byte-identical with the durable sink and with an in-memory sink (B21-B's recorded HEAD digest for both);
 *  6. the store's refusals (nothing written) and its replay; every load re-verifies and refuses a disagreement AGENT_RUN_TRACE_MISMATCH;
 *  7. the sink is synchronous: `complete` returns undefined, and a finalized trace carries no `trace_sink_*` diagnostic;
 *  8. one case per failure class - store_unavailable, refused, stale_exhausted, dropped, write_failed - each counted, never thrown;
 *  9. with DATABASE_URL emptied the production default resolves and the write fails inside getDb(): `write_failed`, nothing else moves;
 * 10. a replay persists nothing;
 * 11. the import gate (AST): the loop, gateway, trace, recorder and store closures reach no durable runtime, database client or
 *     trace-runtime; the approved importers; injected probes caught, a type-only import not; the route's edge and its line;
 * 12. the chat route keeps its 562 lines and B21-E4's markers; its line 40 carries the binding's import;
 * 13. [B24-C1 review] the page: no placeholder, and its cross-references to its own sections land where they point;
 * 14. [B24-C1 review] vitest's one setup file removes an ambient DATABASE_URL before every test file, so no chat suite's scheduled
 *     write can reach a database the shell names.
 * 15. [B24-C1 review 2, security-1] a chat POST whose scope id carries a leading space is authorized against the trimmed selector and
 *     its trace is KEPT: the store keys the aggregate by the scope as the substrate stores it (NFC, trimmed), never by the raw string;
 * 16. [B24-C1 review 2, security-5] RECORDED: a warning may carry up to 80 characters of a model-chosen tool name (loop.ts), and that
 *     text is now durable with the trace; the page says so.
 *
 * Every provider is a scripted adapter (the B21-B / B21-E3 pattern); DATABASE_URL is emptied before every case; no network, no model,
 * nothing written to disk.
 */
import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SchematicState } from "@/lib/schematic-types";
import { schematicStateDigest } from "@/app/lib/engineering/schematic-model";
import { createEmptyBoard } from "@/app/lib/pcb/types";
import { pcbRevisionId } from "@/app/lib/pcb/revision";
import { replacementHeadDigestFor } from "@/app/lib/engineering/replacement-proposal-assembler";
import { engineeringDigest } from "@/app/lib/engineering/stable";
import { InMemoryDurableWorkflowRepository } from "@/app/lib/durable-workflow/repository";
import { getDurableWorkflowRepository } from "@/app/lib/durable-workflow/runtime";
import type { DurableAggregateIdentity, DurableAggregateRecord, DurableWorkflowRepository } from "@/app/lib/durable-workflow/types";
import { DurableOrchestrationRunStore } from "@/app/lib/agent/orchestration/store";
import { AgentTraceRecorder, InMemoryTraceSink, setAgentTraceSinkFactory } from "@/app/lib/agent/trace-recorder";
import { agentRunTraceDigest, validateAgentRunTrace, type AgentRunTrace } from "@/app/lib/agent/trace";
import { fixtureContainer, resetFixtureContainer } from "@/app/lib/fixture-runtime/container";
import { resetAdmissionControl } from "@/app/lib/acquisition/admission-control";
import { failOnce } from "@/app/lib/agent/orchestration/__tests__/_e1-fixtures";
import { SCENARIO_17, installCatalog, resetCatalog, timerEditor, type TimerEditor } from "@/app/lib/agent/orchestration/__tests__/_d3-fixtures";
import { collectProductionFiles, moduleReferences, resolveSpecifier, type FileMap } from "@/app/lib/project/__tests__/_import-gate-helpers";
import { listRouteFiles } from "@/app/lib/auth/route-tree";
import { fileOf, importClosure, runtimeDeclarationSpecifiers } from "@/app/lib/mcp/server/__tests__/_import-closure";
import { DurableRunTraceStore, RUN_TRACE_AGGREGATE_TYPE, RUN_TRACE_MISMATCH, RUN_TRACE_RECORD_KEYS, RUN_TRACE_RECORD_SCHEMA, RUN_TRACE_REFUSALS, RUN_TRACE_STORE_BOUNDS, RunTraceIntegrityError, runTraceAggregateKey, runTraceRecordDigest, type RunTraceRecord, type RunTraceStore } from "@/app/lib/observability/run-trace-store";

const state = vi.hoisted(() => ({
  /** the coordinator's first turn: answer, fail with a network error, or hang until the run's signal aborts */
  coordinator: "answer" as "answer" | "throw-network" | "hang",
  starts: [] as Array<{ turn: string; signal: AbortSignal | undefined }>,
  /** the follow-up turn fails: the run STANDS DOWN with its record committed (a resumable run, B21-E3's case 5) */
  followUpFails: false,
  /** [B24-C1 review 2] the coordinator's first turn requests a tool of this name, which no run exposes (case 16) */
  unknownTool: null as string | null,
}));

vi.mock("@/app/lib/agent/adapters", async () => {
  const { answer } = await import("@/app/lib/agent/orchestration/__tests__/_result-tool");
  const { LLMProviderError } = await import("@/app/lib/llm/errors");
  const scripted = () => {
    const usage = { inputTokens: 3, outputTokens: 5 };
    const continuation = { provider: "openai" as const, state: null };
    const textOf = (turn: string, role: string, userMessage: string): string => role !== "coordinator"
      ? JSON.stringify({ schema: "sirkit.specialist-result.v1", role, summary: `(scripted) ${role}: read the verified state; nothing changed.`, proposedActions: [], assumptions: [], evidence: [], requiredTools: [], risks: [], unresolvedQuestions: [], validationRequests: [], confidence: "low" })
      : turn === "coordinator-2" ? "(scripted) The follow-up turn answers from the merge." : `(scripted) One coordinator turn for: ${userMessage.slice(0, 80)}`; // B21-B's text: the stream reproduces B's recorded digest
    return {
      provider: "openai",
      async start(input: { system: string; userMessage: string; tools: ReadonlyArray<{ toolId: string; providerName: string }>; signal?: AbortSignal }) {
        const role = /^Role: ([a-z-]+)$/m.exec(input.system)?.[1] ?? "coordinator";
        const turn = role === "coordinator" && input.userMessage.startsWith("ORCHESTRATION RESULTS") ? "coordinator-2" : role;
        state.starts.push({ turn, signal: input.signal });
        if (turn === "coordinator" && state.coordinator === "hang") return new Promise<never>(() => { /* only the run's signal ends this run */ });
        if (turn === "coordinator" && state.coordinator === "throw-network") throw new LLMProviderError("openai", "network");
        if (turn === "coordinator-2" && state.followUpFails) throw new LLMProviderError("openai", "overloaded");
        if (turn === "coordinator" && state.unknownTool !== null) return { text: "", toolCalls: [{ callId: "call-b24c1-unknown", providerName: state.unknownTool, argumentsText: "{}" }], stopReason: "tool_use", usage, model: "scripted", continuation }; // [B24-C1 review 2] case 16: the loop refuses it and continues
        const text = textOf(turn, role, input.userMessage);
        return { text, toolCalls: [], stopReason: "completed", usage, model: "scripted", continuation, ...answer(text, input.tools) };
      },
      async continueWith() {
        return { text: "(scripted) continued.", toolCalls: [], stopReason: "completed", usage: { inputTokens: 3, outputTokens: 5 }, model: "scripted", continuation: { provider: "openai" as const, state: null } };
      },
    };
  };
  return { agentAdapterFor: scripted, agentAdapterForRole: scripted };
});

import { POST, EDITOR_CONTEXT_SCHEMA } from "@/app/api/chat/route";
import { ORCHESTRATION_ENABLED_ENV, resetOrchestrationStoreFactory, resetSpecialistSchedulerFactory, setOrchestrationStoreFactory } from "@/app/api/chat/orchestration-runtime";
import { DurableRunTraceSink, RUN_TRACE_PENDING_BOUND, RUN_TRACE_WRITE_FAILURES, drainRunTraceWrites, durableRunTraceSinkFactory, resetRunTraceStoreFactory, resetRunTraceWriteCounts, runTraceWriteCounts, setRunTraceStoreFactory } from "@/app/api/chat/trace-runtime";

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
/** B21-B's recorded digest of the flag-off stream for SIMPLE (b21-b-chat-router.test.ts HEAD_STREAMS.simple) */
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
/** A fresh in-memory repository bound as the run-trace store's, returned with a store reading it. */
function boundStore(): { repository: InMemoryDurableWorkflowRepository; store: DurableRunTraceStore } {
  const repository = new InMemoryDurableWorkflowRepository();
  const store = new DurableRunTraceStore(repository);
  setRunTraceStoreFactory(() => new DurableRunTraceStore(repository));
  return { repository, store };
}
/** One run's records, after every scheduled write settled (polled for at least `atLeast`, never an exact count). */
async function recordsOf(store: RunTraceStore, runId: string, atLeast = 1) {
  await vi.waitFor(async () => { await drainRunTraceWrites(); expect((await store.history(SCOPE, runId)).length).toBeGreaterThanOrEqual(atLeast); });
  await drainRunTraceWrites();
  return store.history(SCOPE, runId);
}
/** A valid, finalized trace built by the real recorder (a run-local sink), for the store and sink cases. */
function validTrace(runId = "run-b24c1-unit", traceId = "trace-b24c1-unit-1", scope = SCOPE): AgentRunTrace {
  let clock = 1_000;
  const recorder = new AgentTraceRecorder({
    runId, traceId, provider: "openai", promptVersion: "b24-c1", promptDigest: "eng1-b24c1prompt", registryDigest: "eng1-b24c1registry", scope,
    contextDigests: { canonicalRevisionDigest: null, schematicDigest: null, selectionDigest: null, netlistDigest: null, resourceManifestDigest: null },
  }, new InMemoryTraceSink(), () => (clock += 5));
  recorder.recordRunStarted();
  recorder.recordStep({ model: "scripted", usage: { inputTokens: 3, outputTokens: 5 }, toolCallCount: 0 });
  return recorder.finalize({ outcome: "completed", failureReason: null });
}
const ISO = "2026-10-08T12:00:00.000Z";

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("SIRKIT_ORCHESTRATION_ROLE_MODELS", ""); vi.stubEnv("SIRKIT_OPENAI_MODEL", ""); vi.stubEnv("SIRKIT_ANTHROPIC_MODEL", "claude-opus-4-7");
  vi.stubGlobal("fetch", () => { throw new Error("no network in b24-c1-durable-trace"); });
  resetAdmissionControl();
  resetRunTraceWriteCounts();
});
afterEach(async () => {
  await drainRunTraceWrites();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetAdmissionControl();
  resetRunTraceStoreFactory();
  resetRunTraceWriteCounts();
  resetOrchestrationStoreFactory();
  resetSpecialistSchedulerFactory();
  resetCatalog();
  setAgentTraceSinkFactory(durableRunTraceSinkFactory); // the binding stays the route's, whatever a case set
  state.coordinator = "answer";
  state.starts = [];
  state.followUpFails = false;
  state.unknownTool = null;
});

describe("[B24-C1] the durable run trace through the production chat POST (D24-20, OD-207)", () => {
  it("1. the counterexample, red at a405db9: under the fixture runtime a completed chat request leaves ONE `agent.run-trace.v1` record for its X-Sirkit-Run-Id in the fixture's in-memory repository (the production default store), its terminal the stream's", { timeout: 60_000 }, async () => {
    vi.stubEnv("SIRKIT_FIXTURE_RUNTIME", "blinker");
    try {
      const posted = await post(chatBody(SIMPLE));
      expect(posted.status).toBe(200);
      expect(terminalOf(posted.events)).toMatchObject({ type: "run_completed" });
      const store = new DurableRunTraceStore(fixtureContainer().durableRepository);
      const records = await recordsOf(store, posted.runId);
      expect(records).toHaveLength(1);
      expect(records[0]!.record.document).toMatchObject({ runId: posted.runId, scope: SCOPE, terminal: { outcome: "completed", failureReason: null } });
      const heads = await fixtureContainer().durableRepository.listHeads({ aggregateType: RUN_TRACE_AGGREGATE_TYPE, scope: SCOPE });
      expect(heads.map((head) => head.aggregateKey)).toEqual([runTraceAggregateKey(SCOPE, posted.runId)]);
      expect(runTraceWriteCounts()).toMatchObject({ written: 1, write_failed: 0, store_unavailable: 0 });
    } finally {
      resetFixtureContainer();
    }
  });

  it("2. one valid record per run: exactly the closed keys, the record schema, the run and trace ids, revision 1, the server time, the trace digest of a document the validator accepts, and no `trace_sink_*` diagnostic on it", { timeout: 60_000 }, async () => {
    const { store } = boundStore();
    const posted = await post(chatBody(SIMPLE));
    const [entry] = await recordsOf(store, posted.runId);
    expect(Object.keys(entry!.record)).toEqual([...RUN_TRACE_RECORD_KEYS]);
    const record: RunTraceRecord = entry!.record;
    expect(record).toMatchObject({ schema: RUN_TRACE_RECORD_SCHEMA, runId: posted.runId, revision: 1 });
    expect(record.traceId).toMatch(/^trace-[0-9a-f-]{36}$/);
    expect(new Date(record.at).toISOString()).toBe(record.at);
    expect(validateAgentRunTrace(record.document)).toEqual([]);
    expect(record.digest).toBe(agentRunTraceDigest(record.document));
    expect(entry!.recordDigest).toBe(runTraceRecordDigest(record));
    expect(record.document.recorderDiagnostics.filter((diagnostic) => diagnostic.startsWith("trace_sink"))).toEqual([]);
    expect(record.document.events.map((event) => event.kind)).toEqual(["run_started", "step", "terminal"]);
    expect(record.document.terminal).toMatchObject({ outcome: "completed", steps: 1, usage: { inputTokens: 3, outputTokens: 5 } });
    expect(runTraceWriteCounts()).toMatchObject({ written: 1, replayed: 0, refused: 0, write_failed: 0, dropped: 0 });
  });

  it("3. a failed run (a network failure), a cancelled run (Stop while the turn hangs), a Tier 3-refused run (no provider call) and a breaker-paused run (no provider call) each keep ONE record whose terminal is the stream's", { timeout: 60_000 }, async () => {
    const { store } = boundStore();
    state.coordinator = "throw-network";
    const failed = await post(chatBody(SIMPLE));
    expect(terminalOf(failed.events)).toMatchObject({ type: "run_failed", reason: "provider_network" });
    expect((await recordsOf(store, failed.runId)).map((entry) => entry.record.document.terminal)).toEqual([expect.objectContaining({ outcome: "failed", failureReason: "provider_network" })]);
    // Stop: the page cancels the response; the run-owned signal aborts the hanging turn
    state.coordinator = "hang";
    const response = await POST(request(chatBody(SIMPLE)));
    const runId = response.headers.get("X-Sirkit-Run-Id")!;
    const reader = response.body!.getReader();
    await reader.read();
    await vi.waitFor(() => expect(state.starts.some((start) => start.signal !== undefined)).toBe(true));
    await reader.cancel();
    expect((await recordsOf(store, runId)).map((entry) => entry.record.document.terminal)).toEqual([expect.objectContaining({ outcome: "cancelled", failureReason: "cancelled" })]);
    // a Tier 3 ask with the orchestration flag on: refused before any provider call, the run completes with no step
    state.coordinator = "answer";
    state.starts = [];
    vi.stubEnv(ORCHESTRATION_ENABLED_ENV, "1");
    setOrchestrationStoreFactory(() => new DurableOrchestrationRunStore(new InMemoryDurableWorkflowRepository()));
    const refused = await post(chatBody(TIER3));
    expect(state.starts).toEqual([]);
    expect(terminalOf(refused.events)).toMatchObject({ type: "run_completed", steps: 0 });
    const refusedRecord = (await recordsOf(store, refused.runId)).map((entry) => entry.record.document);
    expect(refusedRecord).toHaveLength(1);
    expect(refusedRecord[0]!.terminal).toMatchObject({ outcome: "completed", steps: 0, toolCalls: 0 });
    expect(refusedRecord[0]!.warnings.some((line) => line.startsWith("Refused before any model call"))).toBe(true);
    vi.stubEnv(ORCHESTRATION_ENABLED_ENV, "");
    // the coordinator's provider paused by the llm-provider meters (a no-credits 429 opened its breaker): no call, one run_failed
    await failOnce("openai", "insufficient_quota", Date.now());
    const paused = await post(chatBody(SIMPLE));
    expect(state.starts).toEqual([]);
    expect(terminalOf(paused.events)).toMatchObject({ type: "run_failed", reason: "provider_breaker_open" });
    expect((await recordsOf(store, paused.runId)).map((entry) => entry.record.document.terminal)).toEqual([expect.objectContaining({ outcome: "failed", failureReason: "provider_breaker_open", steps: 0 })]);
    expect(runTraceWriteCounts()).toMatchObject({ written: 4, refused: 0, write_failed: 0, dropped: 0 });
  });

  it("4. a resumed run reuses its run id, so its history is two records: the stood-down first request's trace at revision 1 and the resume's at revision 2, two trace ids in one aggregate (B21-E3's scenario 17)", { timeout: 120_000 }, async () => {
    const { store } = boundStore();
    vi.stubEnv(ORCHESTRATION_ENABLED_ENV, "1");
    const orchestration = new DurableOrchestrationRunStore(new InMemoryDurableWorkflowRepository());
    setOrchestrationStoreFactory(() => orchestration); // one record for both requests: the resume is authorized by it
    await installCatalog(SCOPE);
    const editor = await timerEditor(SCOPE);
    state.followUpFails = true;
    const first = await post(scenarioBody(editor));
    expect(first.events.filter((event) => event.type === "degraded").map((event) => event.reason)).toEqual(["follow_up_failed"]);
    expect(await recordsOf(store, first.runId)).toHaveLength(1);
    state.followUpFails = false;
    const resumed = await post(scenarioBody(editor, { resumeRunId: first.runId }));
    expect([resumed.status, resumed.runId]).toEqual([200, first.runId]);
    expect(terminalOf(resumed.events)).toMatchObject({ type: "run_completed" });
    const history = await recordsOf(store, first.runId, 2);
    expect(history.map((entry) => [entry.revision, entry.record.revision, entry.record.runId])).toEqual([[1, 1, first.runId], [2, 2, first.runId]]);
    expect(new Set(history.map((entry) => entry.record.traceId)).size).toBe(2);
    expect(history.map((entry) => entry.record.document.terminal.outcome)).toEqual(["completed", "completed"]);
  });

  it("5. the stream is byte-identical with the durable sink bound and with a run-local in-memory sink: both reproduce B21-B's digest recorded from HEAD 4b6d0e2", { timeout: 60_000 }, async () => {
    const { store } = boundStore();
    const durable = await post(chatBody(SIMPLE));
    expect(await recordsOf(store, durable.runId)).toHaveLength(1);
    setAgentTraceSinkFactory(() => new InMemoryTraceSink());
    const local = await post(chatBody(SIMPLE));
    await drainRunTraceWrites();
    expect(await store.history(SCOPE, local.runId)).toEqual([]);
    expect(durable.normalized).toBe(local.normalized);
    expect(engineeringDigest(durable.normalized)).toBe(SIMPLE_HEAD_DIGEST);
  });
});

describe("[B24-C1] the store, the sink and the write's failure classes", () => {
  it("6. the store: a document the validator refuses, a scope other than the document's own and an invalid time write nothing (closed refusals); a padded id names the scope as the substrate stores it (the same aggregate), a blank id is an invalid document; the same trace id again is a replay; a second trace of the run is revision 2; every load recomputes both digests and re-validates, and a tampered digest, document, run id, revision, schema or key is AGENT_RUN_TRACE_MISMATCH", async () => {
    expect([...RUN_TRACE_REFUSALS]).toEqual(["invalid_document", "scope_mismatch", "invalid_time", "stale_exhausted"]);
    const repository = new InMemoryDurableWorkflowRepository();
    const store = new DurableRunTraceStore(repository);
    const trace = validTrace();
    const invalid = { ...trace, events: [] } as unknown as AgentRunTrace;
    expect(await store.append({ scope: SCOPE, document: invalid, at: ISO })).toMatchObject({ ok: false, code: "invalid_document" });
    expect(await store.append({ scope: { ...SCOPE, projectId: "project-other" }, document: trace, at: ISO })).toMatchObject({ ok: false, code: "scope_mismatch" });
    const padded = { ...SCOPE, projectId: " project-1" };
    // [B24-C1 review 2, 2026-10-08] security-1: a padded id names the scope as the substrate stores it (NFC, trimmed) - was `scope_mismatch`, which let a padded chat scope suppress its own record
    expect(await store.append({ scope: SCOPE, document: validTrace("run-b24c1-blank", "trace-b24c1-blank", { ...SCOPE, projectId: " " }), at: ISO })).toMatchObject({ ok: false, code: "invalid_document" });
    for (const at of ["2026-10-08", "not a time", "2026-02-30T12:00:00.000Z"]) expect(await store.append({ scope: SCOPE, document: trace, at }), at).toMatchObject({ ok: false, code: "invalid_time" });
    expect(await repository.listHeads({ aggregateType: RUN_TRACE_AGGREGATE_TYPE, scope: SCOPE })).toEqual([]);
    const first = await store.append({ scope: SCOPE, document: trace, at: ISO });
    expect(first).toMatchObject({ ok: true, revision: 1, replayed: false });
    expect(await store.append({ scope: SCOPE, document: trace, at: "2026-10-08T12:00:01.000Z" })).toEqual({ ...first, replayed: true });
    expect(await store.append({ scope: padded, document: trace, at: ISO })).toEqual({ ...first, replayed: true }); // the same aggregate under the padded id: its replay
    const second = await store.append({ scope: SCOPE, document: validTrace("run-b24c1-unit", "trace-b24c1-unit-2"), at: ISO });
    expect(second).toMatchObject({ ok: true, revision: 2, replayed: false });
    const history = await store.history(SCOPE, "run-b24c1-unit");
    expect(history.map((entry) => entry.record.traceId)).toEqual(["trace-b24c1-unit-1", "trace-b24c1-unit-2"]);
    expect(await store.history(padded, "run-b24c1-unit")).toEqual(history);
    expect(await store.history({ ...SCOPE, projectId: "project-other" }, "run-b24c1-unit")).toEqual([]);
    // a document whose OWN scope carries the padded id: kept under the same project's aggregate key, the document as the recorder wrote it
    const paddedDocument = validTrace("run-b24c1-padded", "trace-b24c1-padded", padded);
    expect(await store.append({ scope: padded, document: paddedDocument, at: ISO })).toMatchObject({ ok: true, revision: 1, replayed: false });
    expect(await store.append({ scope: { ...SCOPE, projectId: "project-other" }, document: paddedDocument, at: ISO })).toMatchObject({ ok: false, code: "scope_mismatch" });
    expect(runTraceAggregateKey(padded, "run-b24c1-padded")).toBe(runTraceAggregateKey(SCOPE, "run-b24c1-padded"));
    expect((await store.history(SCOPE, "run-b24c1-padded")).map((entry) => entry.record.document.scope.projectId)).toEqual([" project-1"]);
    expect((await repository.listHeads({ aggregateType: RUN_TRACE_AGGREGATE_TYPE, scope: SCOPE })).map((head) => head.scope.projectId)).toEqual(["project-1", "project-1"]);
    // tampering: a repository whose history hands back an edited copy of the stored rows
    const tampered = (edit: (records: Array<DurableAggregateRecord<RunTraceRecord>>) => void): DurableRunTraceStore => new DurableRunTraceStore(new Proxy(repository, {
      get(target, property) {
        if (property !== "history") return Reflect.get(target, property, target);
        return async (identity: DurableAggregateIdentity) => { const records = await target.history<RunTraceRecord>(identity); edit(records); return records; };
      },
    }) as DurableWorkflowRepository);
    const edits: Record<string, (records: Array<DurableAggregateRecord<RunTraceRecord>>) => void> = {
      "record digest": (records) => { records[0]!.recordDigest = `${records[0]!.recordDigest}0`; },
      "document": (records) => { records[0]!.payload.document.terminal.usage.outputTokens = 6; },
      "document and both digests": (records) => { const record = records[0]!.payload; record.document.model = "other"; record.digest = agentRunTraceDigest(record.document); records[0]!.recordDigest = runTraceRecordDigest(record); },
      "run id": (records) => { const record = records[0]!.payload; record.runId = "run-other"; records[0]!.recordDigest = runTraceRecordDigest(record); },
      "revision gap": (records) => { records.splice(0, 1); },
      "schema": (records) => { const record = records[0]!.payload as unknown as Record<string, unknown>; record.schema = "sirkit.other.v1"; records[0]!.recordDigest = runTraceRecordDigest(record as unknown as RunTraceRecord); },
      "an extra key": (records) => { const record = records[0]!.payload as unknown as Record<string, unknown>; record.note = "x"; records[0]!.recordDigest = runTraceRecordDigest(record as unknown as RunTraceRecord); },
      "another trace's document": (records) => { const record = records[0]!.payload; record.document = records[1]!.payload.document; record.digest = agentRunTraceDigest(record.document); records[0]!.recordDigest = runTraceRecordDigest(record); },
    };
    for (const [name, edit] of Object.entries(edits)) {
      const error = await tampered(edit).history(SCOPE, "run-b24c1-unit").then(() => null, (thrown: unknown) => thrown);
      expect(error, name).toBeInstanceOf(RunTraceIntegrityError);
      expect((error as RunTraceIntegrityError).code, name).toBe(RUN_TRACE_MISMATCH);
      expect((error as Error).message, name).not.toContain("run-b24c1-unit");
    }
    expect(await store.history(SCOPE, "run-b24c1-unit")).toHaveLength(2);
  });

  it("7. the sink is synchronous and total: `complete` returns undefined at once and `append` keeps nothing; a recorder holding the durable sink finalizes a valid trace with no `trace_sink_*` diagnostic, and the write lands only after `complete` returned", async () => {
    const { store } = boundStore();
    const sink = new DurableRunTraceSink();
    expect(sink.append({ seq: 1, kind: "run_started" })).toBeUndefined();
    const recorder = new AgentTraceRecorder({
      runId: "run-b24c1-sink", traceId: "trace-b24c1-sink", provider: "anthropic", promptVersion: "b24-c1", promptDigest: "eng1-b24c1prompt", registryDigest: "eng1-b24c1registry", scope: SCOPE,
      contextDigests: { canonicalRevisionDigest: null, schematicDigest: null, selectionDigest: null, netlistDigest: null, resourceManifestDigest: null },
    }, sink);
    recorder.recordRunStarted();
    const returned = recorder.finalize({ outcome: "completed", failureReason: null });
    expect(returned.recorderDiagnostics.filter((diagnostic) => diagnostic.startsWith("trace_sink"))).toEqual([]);
    expect(await store.history(SCOPE, "run-b24c1-sink")).toEqual([]); // nothing ran inside complete
    const records = await recordsOf(store, "run-b24c1-sink");
    expect(records.map((entry) => entry.record.traceId)).toEqual(["trace-b24c1-sink"]);
    expect(new DurableRunTraceSink().complete(validTrace("run-b24c1-sync", "trace-b24c1-sync"))).toBeUndefined();
  });

  it("8. each failure class is caught and counted, never thrown and never a message: a store factory that throws (`store_unavailable`), a closed store refusal (`refused`), conflicts past casAttempts (`stale_exhausted`, the commit tried exactly casAttempts times), a write past the pending bound (`dropped`) and a repository that rejects (`write_failed`)", async () => {
    expect([...RUN_TRACE_WRITE_FAILURES]).toEqual(["store_unavailable", "refused", "stale_exhausted", "write_failed", "dropped"]);
    const complete = (trace: AgentRunTrace): void => { expect(new DurableRunTraceSink().complete(trace)).toBeUndefined(); };
    setRunTraceStoreFactory(() => { throw new Error("factory down"); });
    complete(validTrace("run-c1-a", "trace-c1-a"));
    await drainRunTraceWrites();
    expect(runTraceWriteCounts()).toMatchObject({ store_unavailable: 1, written: 0 });
    setRunTraceStoreFactory(() => ({ append: async () => ({ ok: false, code: "invalid_document", message: "refused" }), history: async () => [] }));
    complete(validTrace("run-c1-b", "trace-c1-b"));
    await drainRunTraceWrites();
    expect(runTraceWriteCounts()).toMatchObject({ refused: 1 });
    let commits = 0;
    const conflicting = new Proxy(new InMemoryDurableWorkflowRepository(), {
      get(target, property) {
        if (property === "commit") return async () => { commits += 1; throw new Error("DW_OPTIMISTIC_REVISION_CONFLICT"); };
        return Reflect.get(target, property, target);
      },
    }) as DurableWorkflowRepository;
    setRunTraceStoreFactory(() => new DurableRunTraceStore(conflicting));
    complete(validTrace("run-c1-c", "trace-c1-c"));
    await drainRunTraceWrites();
    expect(runTraceWriteCounts()).toMatchObject({ stale_exhausted: 1 });
    expect(commits).toBe(RUN_TRACE_STORE_BOUNDS.casAttempts);
    const held: Array<() => void> = [];
    setRunTraceStoreFactory(() => ({ append: () => new Promise((resolve) => { held.push(() => resolve({ ok: true, revision: 1, recordDigest: "x", replayed: false })); }), history: async () => [] }));
    for (let index = 0; index <= RUN_TRACE_PENDING_BOUND; index += 1) complete(validTrace(`run-c1-d-${index}`, `trace-c1-d-${index}`));
    expect(runTraceWriteCounts()).toMatchObject({ dropped: 1 });
    await vi.waitFor(() => expect(held.length).toBeGreaterThanOrEqual(RUN_TRACE_PENDING_BOUND));
    for (const release of held) release();
    await drainRunTraceWrites();
    expect(runTraceWriteCounts()).toMatchObject({ written: RUN_TRACE_PENDING_BOUND, dropped: 1 });
    const rejecting = new Proxy(new InMemoryDurableWorkflowRepository(), {
      get(target, property) {
        if (property === "commit") return async () => { throw new Error("connection reset by the database"); };
        return Reflect.get(target, property, target);
      },
    }) as DurableWorkflowRepository;
    setRunTraceStoreFactory(() => new DurableRunTraceStore(rejecting));
    complete(validTrace("run-c1-e", "trace-c1-e"));
    await drainRunTraceWrites();
    const counts = runTraceWriteCounts();
    expect(counts).toEqual({ written: RUN_TRACE_PENDING_BOUND, replayed: 0, store_unavailable: 1, refused: 1, stale_exhausted: 1, write_failed: 1, dropped: 1 });
    expect(Object.values(counts).every((value) => typeof value === "number")).toBe(true);
  });

  it("9. with DATABASE_URL emptied the production default resolves (getDurableWorkflowRepository never throws) and the write fails inside getDb(): the run counts `write_failed` and nothing else changes - the status, the stream (B21-B's digest) and the terminal", { timeout: 60_000 }, async () => {
    expect(process.env.DATABASE_URL).toBe("");
    expect(() => getDurableWorkflowRepository()).not.toThrow();
    await expect(new DurableRunTraceStore(getDurableWorkflowRepository()).append({ scope: SCOPE, document: validTrace(), at: ISO })).rejects.toThrow(/DATABASE_URL is not set/);
    const posted = await post(chatBody(SIMPLE));
    expect(posted.status).toBe(200);
    expect(engineeringDigest(posted.normalized)).toBe(SIMPLE_HEAD_DIGEST);
    await vi.waitFor(async () => { await drainRunTraceWrites(); expect(runTraceWriteCounts().write_failed).toBeGreaterThanOrEqual(1); });
    expect(runTraceWriteCounts()).toEqual({ written: 0, replayed: 0, store_unavailable: 0, refused: 0, stale_exhausted: 0, write_failed: 1, dropped: 0 });
  });

  it("10. a replay persists nothing: with the durable factory bound, replaying an authored capsule (B11's e03-valid-board) builds no store and schedules no write - `replayCapsule` hands its recorder `options.sink ?? new InMemoryTraceSink()`, never the factory", { timeout: 60_000 }, async () => {
    let built = 0;
    setRunTraceStoreFactory(() => { built += 1; return new DurableRunTraceStore(new InMemoryDurableWorkflowRepository()); });
    const { buildEvaluationCases } = await import("@/app/lib/agent/evaluation-cases");
    const { replayCapsule } = await import("@/app/lib/agent/replay-capsule");
    const pins = (JSON.parse(read("artifacts/ai-control-plane-b11/replay-trace-pins.json")) as { pins: Record<string, string> }).pins;
    const capsule = buildEvaluationCases(pins).find((item) => item.caseId === "e03-valid-board")!.capsule;
    const outcome = await replayCapsule(capsule);
    expect(outcome.trace.runId.length).toBeGreaterThan(0);
    await drainRunTraceWrites();
    expect(built).toBe(0);
    expect(runTraceWriteCounts()).toEqual({ written: 0, replayed: 0, store_unavailable: 0, refused: 0, stale_exhausted: 0, write_failed: 0, dropped: 0 });
    expect(read("app/lib/agent/replay-capsule.ts")).toContain("}, options?.sink ?? new InMemoryTraceSink(), clock);");
  });
});

// ── The import gate (section 7; the B23-C approved-importer pattern) ─────────────────────────────────────────────────────────
const TRACE_RUNTIME = "app/api/chat/trace-runtime.ts";
const STORE = "app/lib/observability/run-trace-store.ts";
const ROUTE = "app/api/chat/route.ts";
const NEVER = ["app/lib/durable-workflow/runtime.ts", "app/lib/durable-workflow/server-repository.ts", "app/lib/db/client.ts", TRACE_RUNTIME] as const;
const PURE_ENTRIES = ["app/lib/agent/loop.ts", "app/lib/agent/gateway.ts", "app/lib/agent/trace.ts", "app/lib/agent/trace-recorder.ts", STORE] as const;
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

describe("[B24-C1] the import gate: durable reach stays at the composition root (section 7)", () => {
  it("11. the closures of the loop, the gateway, the trace contract, the recorder and the store reach none of the durable runtime, the server repository, the database client or trace-runtime; trace-runtime's one importer is the chat route (its line 40) and the store's are trace-runtime and app/lib/observability/ only; their runtime imports are exactly the reviewed ones; the PostgreSQL repository constructions are the durable runtime's and the purge CLI's ([B24-C3, 2026-10-09] reviewed pin move, D11: was the durable runtime's alone); an injected loop-side import of trace-runtime and a store-side import of the durable runtime are caught with their chains, a type-only import is not", { timeout: 180_000 }, async () => {
    const map = files();
    for (const entry of PURE_ENTRIES) {
      expect(map.has(entry), entry).toBe(true);
      expect(reached(map, entry), entry).toEqual([]);
      await new Promise((resolve) => setImmediate(resolve)); // yield between walks (lead lesson 3)
    }
    expect(importClosure(map, ["app/lib/agent/loop.ts"]).size).toBeGreaterThan(100); // not vacuous
    expect(importersOf(map, TRACE_RUNTIME)).toEqual([ROUTE]);
    const storeImporters = importersOf(map, STORE);
    expect(storeImporters).toContain(TRACE_RUNTIME);
    expect(storeImporters.filter((file) => file !== TRACE_RUNTIME && !file.startsWith("app/lib/observability/"))).toEqual([]);
    const routeFiles = new Set(listRouteFiles(ROOT).map((file) => relative(ROOT, file).split(sep).join("/"))); // the route tree's own enumeration (b20-b2-route-tree case 3: no second route-file matcher)
    expect(routeFiles.size).toBeGreaterThan(100);
    expect(storeImporters.filter((file) => file.startsWith("app/lib/agent/") || file.startsWith("app/lib/mcp/") || routeFiles.has(file))).toEqual([]);
    expect(runtimeEdges(map, ROUTE)).toContain(TRACE_RUNTIME);
    expect(read(ROUTE).split(NEWLINE)[39]).toContain('import "./trace-runtime";');
    expect([...runtimeDeclarationSpecifiers(STORE, map.get(STORE)!)].sort()).toEqual(["../agent/trace", "../durable-workflow/stable", "../engineering/stable"]);
    expect([...runtimeDeclarationSpecifiers(TRACE_RUNTIME, map.get(TRACE_RUNTIME)!)].sort()).toEqual(["@/app/lib/agent/trace-recorder", "@/app/lib/durable-workflow/runtime", "@/app/lib/observability/run-trace-store"]);
    expect([...map].filter(([, source]) => /new\s+PostgresDurableWorkflowRepository\s*\(/.test(source)).map(([path]) => path).sort()).toEqual(["app/lib/durable-workflow/runtime.ts", "scripts/retention-purge.ts"]); // [B24-C3, 2026-10-09] reviewed pin move (D11): + the purge CLI, whose read mode constructs the PostgreSQL repository for its read-only adapter (b24-c3-trace-read 10 pins the pair); was the durable runtime alone
    // the probes
    const loop = "app/lib/agent/loop.ts";
    const probe = (path: string, append: string): FileMap => new Map(map).set(path, `${map.get(path)!}${NEWLINE}${append}${NEWLINE}`);
    const loopProbe = probe(loop, 'import { durableRunTraceSinkFactory } from "@/app/api/chat/trace-runtime";' + NEWLINE + "export const b24c1Probe = durableRunTraceSinkFactory;");
    expect(reached(loopProbe, loop)).toEqual(expect.arrayContaining([`${loop} -> ${TRACE_RUNTIME}`, `${loop} -> ${TRACE_RUNTIME} -> app/lib/durable-workflow/runtime.ts`]));
    expect(reached(probe(loop, 'import type { RunTraceWriteCounts } from "@/app/api/chat/trace-runtime";' + NEWLINE + "export type B24c1Probe = RunTraceWriteCounts;"), loop)).toEqual([]);
    const storeProbe = probe(STORE, 'import { getDurableWorkflowRepository } from "../durable-workflow/runtime";' + NEWLINE + "export const b24c1Probe = getDurableWorkflowRepository;");
    expect(reached(storeProbe, STORE)).toEqual(expect.arrayContaining([`${STORE} -> app/lib/durable-workflow/runtime.ts`]));
    expect(reached(probe(STORE, 'import type * as runtime from "../durable-workflow/runtime";' + NEWLINE + "export type B24c1Probe = typeof runtime;"), STORE)).toEqual([]);
    expect(importersOf(probe("app/lib/mcp/server/dispatch.ts", 'import { DurableRunTraceStore as B24c1Probe } from "@/app/lib/observability/run-trace-store";' + NEWLINE + "export const b24c1Probe = B24c1Probe;"), STORE)).toContain("app/lib/mcp/server/dispatch.ts");
  });

  it("12. the chat route keeps its 562 lines and B21-E4's three markers; line 40 holds the recorder's import, then the binding's side-effect import, then the dated tag; no other line names trace-runtime", () => {
    const route = read(ROUTE).split(NEWLINE);
    expect(route.length - 1).toBe(562);
    expect(route.flatMap((line, index) => (line.includes("[B21 E4]") ? [index + 1] : []))).toEqual([35, 504, 507]);
    expect(route[39]).toMatch(/^import \{ AgentTraceRecorder, createAgentTraceSink \} from "@\/app\/lib\/agent\/trace-recorder"; import "\.\/trace-runtime"; \/\/ \[B24-C1\] D24-20, OD-207: /);
    expect(route.filter((line) => line.includes("trace-runtime"))).toHaveLength(1);
  });
});

// ── [B24-C1 review, 2026-10-08] the page and the test process ───────────────────────────────────────────────────────────────
const PAGE = "artifacts/ai-control-plane-b24/observability-and-replay.md";
/** Each cross-reference on the page that names one of its own sections, and what that section must hold. */
const PAGE_XREFS: ReadonlyArray<readonly [anchor: string, held: string]> = [
  ["`production-smoke`'s CI run, are the lead's (section ", "### The lead's runs"],
  ["and all three suites ran before and after the edit (section ", "**The closeout tripwires**"],
  ["(the closure clause for D24-20 in section ", "D24-20: closed offline"],
  ["`next start`, `next dev` (section ", "### The lead's runs"],
];
/** Did vitest run the database guard before this file was evaluated? (Read at load, before any case imports the guard.) */
const GUARD_RAN_BEFORE_LOAD = (globalThis as unknown as Record<symbol, unknown>)[Symbol.for("sirkit.b24-c1.database-env-guard")] === true;

describe("[B24-C1 review] the page and the test process", () => {
  it("13. the page: no placeholder survives under a CONFIRMED label, and each cross-reference that names one of the page's own sections lands in the section that holds what it points to (correctness-1, correctness-6)", () => {
    const page = read(PAGE);
    const problems: string[] = (page.match(/\b[A-Z][A-Z0-9]*-FINAL\b|\bTODO\b|\bTBD\b|\bFIXME\b/g) ?? []).map((token) => `placeholder ${token}`);
    const flat = (text: string): string => text.replace(/\s+/g, " ");
    const sections = new Map<number, string>();
    const parts = page.split(/^## (\d+)\. /m);
    for (let index = 1; index < parts.length; index += 2) sections.set(Number(parts[index]), flat(parts[index + 1]!));
    expect([...sections.keys()]).toEqual(Array.from({ length: sections.size }, (_, index) => index));
    const text = flat(page);
    for (const [anchor, held] of PAGE_XREFS) {
      const at = text.indexOf(anchor);
      if (at < 0 || text.indexOf(anchor, at + 1) >= 0) { problems.push(`not exactly one: ${anchor}`); continue; }
      const target = Number(/^\d+/.exec(text.slice(at + anchor.length))?.[0] ?? "-1");
      if (!(sections.get(target) ?? "").includes(flat(held))) problems.push(`${anchor}${target}): section ${target} does not hold ${held}`);
    }
    expect(problems).toEqual([]);
  });

  it("14. no suite reaches a database the shell names (correctness-5, security-4): vitest's one setup file removes an ambient DATABASE_URL before every test file - the chat route now schedules a durable write per finalized run - and touches nothing else; it ran before this file", async () => {
    const config = read("vitest.config.ts").split(NEWLINE).filter((line) => line.includes("setupFiles"));
    expect(config).toHaveLength(1);
    expect(config[0]!.trim().startsWith('setupFiles: ["./app/lib/qualification/__tests__/_database-env-guard.ts"],')).toBe(true);
    expect(GUARD_RAN_BEFORE_LOAD).toBe(true);
    const { clearAmbientDatabaseUrl } = await import("./_database-env-guard");
    const env: Record<string, string | undefined> = { DATABASE_URL: ["postgres:", "", "b24c1-shell.invalid", "db"].join("/"), SIRKIT_DB_QUALIFICATION: "1", NODE_ENV: "test" };
    clearAmbientDatabaseUrl(env);
    expect(env).toEqual({ SIRKIT_DB_QUALIFICATION: "1", NODE_ENV: "test" });
  });
});

// ── [B24-C1 review 2, 2026-10-08] the scope as the substrate stores it, and what a warning may carry ────────────────────────────
/** One numbered section of the page, whitespace flattened (the empty string when the section is absent). */
function pageSection(page: string, number: number): string {
  const parts = page.split(/^## (\d+)\. /m);
  const at = parts.indexOf(String(number));
  return at > 0 && at % 2 === 1 ? parts[at + 1]!.replace(/\s+/g, " ") : "";
}

describe("[B24-C1 review 2] a padded scope id keeps its record; a warning's text is durable", () => {
  it("15. (security-1) a chat POST whose project id carries a leading space is refused by the context assembler BEFORE a run id or a recorder exists (`context.ts:268-270`: 400 `projectId is not a well-formed identifier`; the trusted context trimmed the selector, the route did not): no run, no trace, nothing scheduled - the review's chat-level scenario does not reach the store; and the store's keying is defense in depth: a document whose own scope carries the padded id, handed to the durable sink, is kept under the aggregate of the scope as the substrate stores it, found through the canonical scope and through the padded one, nothing counted `refused`", { timeout: 60_000 }, async () => {
    const { repository, store } = boundStore();
    const padded = { ...SCOPE, projectId: ` ${SCOPE.projectId}` };
    const body = chatBody(SIMPLE, SCHEMATIC, { ...HEAD_MARK, canonicalStateDigest: replacementHeadDigestFor(SCHEMATIC, padded) });
    body.scope = padded;
    (body.editorContext as Record<string, unknown>).scope = padded;
    const posted = await post(body);
    expect([posted.status, posted.runId, posted.normalized]).toEqual([400, "", JSON.stringify({ ok: false, error: "projectId is not a well-formed identifier" })]);
    expect(read("app/lib/agent/context.ts")).toContain("return { ok: false, reason: `${name} is not a well-formed identifier` };"); // the assembler's refusal, by content (the page cites its lines)
    await drainRunTraceWrites();
    expect(await repository.listHeads({ aggregateType: RUN_TRACE_AGGREGATE_TYPE, scope: SCOPE })).toEqual([]);
    expect(runTraceWriteCounts()).toEqual({ written: 0, replayed: 0, store_unavailable: 0, refused: 0, stale_exhausted: 0, write_failed: 0, dropped: 0 });
    // defense in depth: the sink and the store keep a document whose scope the substrate would rewrite (nothing reaches them with one today)
    expect(new DurableRunTraceSink().complete(validTrace("run-b24c1-padded-sink", "trace-b24c1-padded-sink", padded))).toBeUndefined();
    const records = await recordsOf(store, "run-b24c1-padded-sink"); // read through the canonical scope
    expect(records.map((entry) => entry.record.document.scope)).toEqual([padded]); // the recorder's document, verbatim (B11's contract; not edited)
    expect(await store.history(padded, "run-b24c1-padded-sink")).toEqual(records);
    expect((await repository.listHeads({ aggregateType: RUN_TRACE_AGGREGATE_TYPE, scope: SCOPE })).map((head) => head.scope)).toEqual([SCOPE]);
    expect(runTraceWriteCounts()).toMatchObject({ written: 1, refused: 0, write_failed: 0, dropped: 0 });
  });

  it("16. (security-5, RECORDED) the record keeps what the recorder's warning carries: a run whose model requested an unknown tool whose name is 157 characters of text leaves one record whose warning holds the first 80 characters of that name and none of the rest (the loop's slice; the recorder's 300-character bound), and the page says so in its sections 2 and 12", { timeout: 60_000 }, async () => {
    const { store } = boundStore();
    const head = `sirkit_b24c1_${"r3_2k2_0805_".repeat(5)}abcdefg`; // the 80 characters the loop keeps
    const tail = `${"x9_".repeat(25)}yz`; // 77 more, of a shape that never occurs in the head
    const name = `${head}${tail}`;
    expect([head.length, name.length]).toEqual([80, 157]);
    state.unknownTool = name;
    const posted = await post(chatBody(SIMPLE));
    expect(posted.status).toBe(200);
    expect(posted.events.filter((event) => event.type === "tool_refused").map((event) => event.status)).toEqual(["unknown_tool"]);
    expect(terminalOf(posted.events)).toMatchObject({ type: "run_completed" });
    const [entry] = await recordsOf(store, posted.runId);
    const warnings = entry!.record.document.warnings.filter((line) => line.startsWith("The model requested unknown tool")); // beside the run's resource-availability warnings
    expect(warnings, JSON.stringify(entry!.record.document.warnings)).toHaveLength(1);
    expect(warnings[0]!.startsWith(`The model requested unknown tool "${head}"`)).toBe(true);
    expect(warnings[0]!).not.toContain(tail.slice(0, 12));
    expect(warnings[0]!.length).toBeLessThanOrEqual(300);
    const page = read(PAGE);
    expect(pageSection(page, 2)).toContain("model-chosen tool name");
    expect(pageSection(page, 12)).toContain("model-chosen tool name");
  });
});
