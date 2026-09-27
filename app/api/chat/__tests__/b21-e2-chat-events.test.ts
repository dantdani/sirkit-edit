/**
 * [B21 E2] The additive run events through the PRODUCTION POST (flag on), with the adapters mocked by the B21-B scripted double (a
 * specialist answers through the strict result tool). The DAG's plan, status and degraded facts arrive as the five v1 events - each a
 * closed, bounded shape carrying B21-B's sentence - in ONE stream with one run_started and one terminal; no warning carries a plan,
 * status or stand-down line any more, a refused tool call of a specialist still does; the coordinator's trace (the route's sink)
 * records the same lines B21-B recorded and is still the ONLY trace the route's sink receives, and the orchestration run's record is
 * unchanged; the page's reducer folds the real stream into the one status line while the answer, notes and label stay what an older
 * reducer makes of it. Flag OFF the four streams are HEAD's byte for byte (B21-B's recordings). [B21 E2 fix] Cases 5 to 7 answer the
 * adversarial review: every runtime stand-down pinned by its degraded reason (tests-1), the trace's 12-line cap with its stand-down
 * override (tests-3), the partial result counting what the merge withheld (security-1, coverage-1); case 4 sets the flag off itself (tests-7).
 * [B21 E2b] Cases 8 and 9: every specialist that ran has its OWN trace document on the durable trace record beside the orchestration
 * run's (run id `<runId>:<n>-<role>`, its tool calls on it, no string holding a task id), a failed specialist's document keeps its
 * failure, and a trace record that cannot be written is one visible warning line - the route's sink still receives ONE trace.
 * [B21 E2b fix] Case 10: that line is on the coordinator's trace past the 12-line cap and WHOLE (bounded by construction).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SchematicState } from "@/lib/schematic-types";
import { schematicStateDigest } from "@/app/lib/engineering/schematic-model";
import { createEmptyBoard } from "@/app/lib/pcb/types";
import { pcbRevisionId } from "@/app/lib/pcb/revision";
import { replacementHeadDigestFor } from "@/app/lib/engineering/replacement-proposal-assembler";
import { engineeringDigest } from "@/app/lib/engineering/stable";
import { InMemoryDurableWorkflowRepository } from "@/app/lib/durable-workflow/repository";
import { InMemoryTraceSink, setAgentTraceSinkFactory } from "@/app/lib/agent/trace-recorder";
import { TRACE_BOUNDS, type AgentRunTrace } from "@/app/lib/agent/trace";
import { ORCHESTRATION_RUN_EVENT_TYPES, type DegradedReason } from "@/app/lib/agent/contracts";
import { DurableOrchestrationRunStore, orchestrationTraceStoreOf, type OrchestrationRunStore } from "@/app/lib/agent/orchestration/store";
import { RUN_EVENT_TRACE_TYPES, orchestrationRunEventIssue } from "@/app/lib/agent/orchestration/run-events";
import { ORCHESTRATION_TRACE_AGGREGATE_TYPE, validateOrchestrationTrace } from "@/app/lib/agent/orchestration/trace-attribution";
import { SPECIALIST_ROLES } from "@/app/lib/agent/orchestration/contracts";
import type { DurableCommitRequest, DurableCommitResult } from "@/app/lib/durable-workflow/types";
import { failOnce } from "@/app/lib/agent/orchestration/__tests__/_e1-fixtures";
import { initialRunView, projectRunView, reduceRunView } from "@/app/lib/project/chat-run-view";
import { resetAdmissionControl } from "@/app/lib/acquisition/admission-control";
import { sanitizeTraceText } from "@/app/lib/agent/redaction";

const state = vi.hoisted(() => ({
  starts: [] as Array<{ role: string; tools: string[] }>,
  /** per role: what the scripted adapter does ([B21 E2 fix] + six unadvertised calls in one step; a result written as text) */
  script: {} as Record<string, "throw-quota" | "call-unknown" | "call-unknown-many" | "text-only" | "read-then-result">,
  /** [B21 E2 fix] the coordinator's SECOND turn (the follow-up) fails with a provider network error */
  followUpFails: false,
  /** [B21 E2b] the read each `read-then-result` specialist called */
  reads: [] as Array<{ role: string; toolId: string }>,
}));

vi.mock("@/app/lib/agent/adapters", async (importOriginal) => { // [B21 E2 fix] the original module under the two wrapped factories (the E1 fixture's helpers import its classes)
  const original = await importOriginal<typeof import("@/app/lib/agent/adapters")>();
  const { LLMProviderError } = await import("@/app/lib/llm/errors");
  const { answer, registryToolIds } = await import("@/app/lib/agent/orchestration/__tests__/_result-tool");
  const document = (role: string): string => JSON.stringify({ schema: "sirkit.specialist-result.v1", role, summary: `(scripted) ${role}: nothing found; nothing changed.`, proposedActions: [], assumptions: [], evidence: [], requiredTools: [], risks: [], unresolvedQuestions: [], validationRequests: [], confidence: "low" });
  const scripted = () => {
    let pending: { role: string; tools: ReadonlyArray<{ toolId: string; providerName: string }> } | null = null;
    return {
      provider: "openai",
      async start(input: { system: string; userMessage: string; tools: ReadonlyArray<{ toolId: string; providerName: string }> }) {
        const role = /^Role: ([a-z-]+)$/m.exec(input.system)?.[1] ?? "coordinator";
        state.starts.push({ role, tools: registryToolIds(input.tools) });
        if (role === "coordinator" && state.followUpFails && state.starts.filter((start) => start.role === "coordinator").length > 1) throw new LLMProviderError("openai", "network");
        const behaviour = state.script[role];
        if (behaviour === "throw-quota") throw new LLMProviderError("openai", "insufficient_quota");
        if (behaviour === "text-only") return { text: `(scripted) ${role}: a result written as text.`, toolCalls: [], stopReason: "completed", usage: { inputTokens: 3, outputTokens: 5 }, model: "scripted", continuation: { provider: "openai", state: null } };
        const read = behaviour === "read-then-result" ? input.tools.find((tool) => tool.toolId === "sirkit.validation.connectivity-verify") ?? input.tools.find((tool) => tool.toolId === "sirkit.schematic.inspect") : undefined;
        if (read) { // [B21 E2b] one offered read first, then the result (the per-task trace records the call)
          pending = { role, tools: input.tools };
          state.reads.push({ role, toolId: read.toolId });
          return { text: "", toolCalls: [{ callId: `call-read-${role}`, providerName: read.providerName, argumentsText: "{}" }], stopReason: "tool_use", usage: { inputTokens: 3, outputTokens: 5 }, model: "scripted", continuation: { provider: "openai", state: null } };
        }
        if (behaviour === "call-unknown" || behaviour === "call-unknown-many") {
          pending = { role, tools: input.tools };
          const calls = Array.from({ length: behaviour === "call-unknown" ? 1 : 6 }, (_, index) => ({ callId: `call-unknown-${role}${index === 0 ? "" : `-${index}`}`, providerName: "sirkit_release_now", argumentsText: index === 0 ? "{}" : JSON.stringify({ index }) }));
          return { text: "", toolCalls: calls, stopReason: "tool_use", usage: { inputTokens: 3, outputTokens: 5 }, model: "scripted", continuation: { provider: "openai", state: null } };
        }
        const text = role !== "coordinator" ? document(role) : `(scripted) One coordinator turn for: ${input.userMessage.slice(0, 80)}`;
        return { text, toolCalls: [], stopReason: "completed", usage: { inputTokens: 3, outputTokens: 5 }, model: "scripted", continuation: { provider: "openai", state: null }, ...answer(text, input.tools) };
      },
      async continueWith() {
        const held = pending;
        pending = null;
        if (held) return { text: "", toolCalls: [], stopReason: "completed", usage: { inputTokens: 3, outputTokens: 5 }, model: "scripted", continuation: { provider: "openai", state: null }, ...answer(document(held.role), held.tools) };
        return { text: "(scripted) The follow-up turn answers from the results.", toolCalls: [], stopReason: "completed", usage: { inputTokens: 3, outputTokens: 5 }, model: "scripted", continuation: { provider: "openai", state: null } };
      },
    };
  };
  return { ...original, agentAdapterFor: scripted, agentAdapterForRole: scripted };
});

import { POST, EDITOR_CONTEXT_SCHEMA } from "../route";
import { ORCHESTRATION_ENABLED_ENV, ORCHESTRATION_TRACE_LINES_MAX, orchestrationEnabled, resetOrchestrationStoreFactory, setOrchestrationStoreFactory, traceUnrecordedLine } from "../orchestration-runtime";

const SCOPE = { tenantId: "tenant-1", projectId: "project-1", branchId: "main" };
const SCHEMATIC: SchematicState = {
  components: [], wires: [], netLabels: [],
  kicadComponents: [{ id: "u1-id", partId: "lib:part-a", x: 300, y: 100, rotation: 0, refDes: "U1", value: "MCU", atomicPartRevisionId: "rev-current", symbolAssetVersionId: "sym-current" }],
};
function chatBody(sentence: string) {
  const board = createEmptyBoard();
  return {
    provider: "openai", messages: [{ role: "user", content: sentence }], scope: SCOPE, schematicState: SCHEMATIC,
    schematicHeadMark: { lineageId: "lin1-a9e2470c11bd8833", headSequence: 3, canonicalStateDigest: replacementHeadDigestFor(SCHEMATIC, SCOPE) },
    editorContext: { schema: EDITOR_CONTEXT_SCHEMA, scope: SCOPE, board, pcbRevisionId: pcbRevisionId(board), selection: { refs: [], primary: null }, netlist: null, schematicDigest: schematicStateDigest(SCHEMATIC), authoritySource: "local-working-copy" },
  };
}
const BODIES = {
  simple: "Move R3 2 mm to the right.",
  view: "Open the 3D view, hide the top silkscreen, focus on J1, and switch to an isometric view.",
  replacement: "Delete U1 and replace it with the approved lower-power part while preserving compatible nets.",
  tier3: "Release the board to manufacturing.",
} as const;
/** RECORDED from HEAD 4b6d0e2 by B21-B (b21-b-chat-router.test.ts) with the same scripted coordinator double; still HEAD's at 3a32317 */
const HEAD_PREFIX = [
  '{"v":1,"seq":1,"type":"run_started","runId":"<runId>","provider":"openai"}',
  '{"v":1,"seq":2,"type":"warning","runId":"<runId>","message":"The project\'s agent autonomy setting could not be read; this run is proposal-only."}',
  '{"v":1,"seq":3,"type":"warning","runId":"<runId>","message":"Tool sirkit.pcb.propose-bounded-edit unavailable: no verified canonical board and PCB history basis for this run."}',
  '{"v":1,"seq":4,"type":"warning","runId":"<runId>","message":"Tool sirkit.component-authority.inspect unavailable: required resource(s) component-authority-records cannot be supplied for this run."}',
  '{"v":1,"seq":5,"type":"warning","runId":"<runId>","message":"Tool sirkit.project.history-inspect unavailable: required resource(s) project-timeline-snapshot cannot be supplied for this run."}',
  '{"v":1,"seq":6,"type":"warning","runId":"<runId>","message":"Tool sirkit.schematic.propose-component-replacement unavailable: required resource(s) component-authority-records cannot be supplied for this run."}',
  '{"v":1,"seq":7,"type":"warning","runId":"<runId>","message":"Tool sirkit.selection.control unavailable: no view context was captured for this run."}',
  '{"v":1,"seq":8,"type":"warning","runId":"<runId>","message":"Tool sirkit.view.canvas-navigation unavailable: no view context was captured for this run."}',
  '{"v":1,"seq":9,"type":"warning","runId":"<runId>","message":"Tool sirkit.view.read-state unavailable: required resource(s) view-state-snapshot cannot be supplied for this run."}',
];
const headStream = (echo: string): string => [...HEAD_PREFIX,
  `{"v":1,"seq":10,"type":"text_delta","runId":"<runId>","text":"(scripted) One coordinator turn for: ${echo}","phase":"final"}`,
  `{"v":1,"seq":11,"type":"run_completed","runId":"<runId>","finalText":"(scripted) One coordinator turn for: ${echo}","steps":1,"toolCalls":0,"usage":{"inputTokens":3,"outputTokens":5},"model":"scripted"}`,
].join("\n") + "\n";
const HEAD_STREAMS: Record<keyof typeof BODIES, { digest: string; stream: string }> = {
  simple: { digest: "eng1-656c2588b836c043", stream: headStream("Move R3 2 mm to the right.") },
  view: { digest: "eng1-07aaf2589736c9f7", stream: headStream("Open the 3D view, hide the top silkscreen, focus on J1, and switch to an isometr") },
  replacement: { digest: "eng1-bf8822508f100b13", stream: headStream("Delete U1 and replace it with the approved lower-power part while preserving com") },
  tier3: { digest: "eng1-9fbc41d4ee249877", stream: headStream("Release the board to manufacturing.") },
};

type Line = Record<string, unknown>;
async function post(sentence: string): Promise<{ runId: string; normalized: string; events: Line[]; header: string | null }> {
  const response = await POST(new Request("http://localhost/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(chatBody(sentence)) }));
  expect(response.status).toBe(200);
  const runId = response.headers.get("X-Sirkit-Run-Id")!;
  const text = await response.text();
  return { runId, normalized: text.replaceAll(runId, "<runId>"), events: text.trim().split("\n").map((line) => JSON.parse(line) as Line), header: response.headers.get("X-Sirkit-Chat-Protocol") };
}
const types = (events: Line[]): string[] => events.map((event) => String(event.type));
const orchestration = (events: Line[]): Line[] => events.filter((event) => (ORCHESTRATION_RUN_EVENT_TYPES as readonly unknown[]).includes(event.type));
const warnings = (events: Line[]): string[] => events.filter((event) => event.type === "warning").map((event) => String(event.message));
/** a B21-B line that is a FACT of the plan, a specialist's status or a stand-down (never a refusal, merge or approval line) */
const STATUS_LINE = /^Orchestration: (?:\d+ specialist\(s\) (?:scheduled|not started)|specialist [a-z-]+ (?:accepted|malformed|escalated|replayed|not run|committed result)|specialist [a-z-]+ \(task [^)]+\) runs on|no specialist ran|the provider failed during|the coordinator's|no specialist result|the merge could not|no follow-up turn was made|the follow-up coordinator turn did not complete)/;
function inMemory(): { repository: InMemoryDurableWorkflowRepository; store: DurableOrchestrationRunStore } {
  const repository = new InMemoryDurableWorkflowRepository();
  return { repository, store: new DurableOrchestrationRunStore(repository) };
}
function traceCapture(): AgentRunTrace[] {
  const sink = new InMemoryTraceSink();
  const traces: AgentRunTrace[] = [];
  setAgentTraceSinkFactory(() => ({ append: (event) => sink.append(event), complete: (trace) => { traces.push(trace); sink.complete(trace); } }));
  return traces;
}

vi.stubGlobal("fetch", () => { throw new Error("no network"); });
beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("SIRKIT_ORCHESTRATION_ROLE_MODELS", ""); vi.stubEnv("SIRKIT_OPENAI_MODEL", ""); vi.stubEnv("SIRKIT_ANTHROPIC_MODEL", "claude-opus-4-7");
  resetAdmissionControl();
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetAdmissionControl();
  resetOrchestrationStoreFactory();
  setAgentTraceSinkFactory(null);
  state.starts = [];
  state.script = {};
  state.followUpFails = false;
  state.reads = [];
});
/** [B21 E2b] every string and every key of a JSON value */
const strings = (value: unknown): string[] => typeof value === "string" ? [value] : value === null || typeof value !== "object" ? [] : Array.isArray(value) ? value.flatMap(strings) : Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => [key, ...strings(item)]);
/** [B21 E2b] a repository whose trace-record commits fail (a driver message that must never reach the client) */
class TraceRecordsDown extends InMemoryDurableWorkflowRepository {
  override async commit<TResult extends object = Record<string, unknown>>(request: DurableCommitRequest<TResult>): Promise<DurableCommitResult<TResult>> {
    if (request.operations.some((operation) => operation.aggregateType === ORCHESTRATION_TRACE_AGGREGATE_TYPE)) throw new Error("trace driver down: connection to db-internal-7 refused");
    return super.commit(request);
  }
}

describe("[B21 E2] the run events through the production POST", () => { // [B21 E2 fix: tests-7] the events' cases; [B21 E2b] cases 8 and 9 the per-task trace records (the trace block applied, D21-41 closed)
  it("1. flag ON, the replacement DAG: ONE stream (protocol 1, one run_started, one terminal - last) carrying the plan, a started and a finished event per specialist that ran, the not-run role's degraded event and the partial result - each a closed shape the judge accepts, carrying B21-B's sentence; no warning carries a plan or status line; the route's sink receives ONE trace, the coordinator's, whose warnings are B21-B's lines", async () => {
    vi.stubEnv(ORCHESTRATION_ENABLED_ENV, "1");
    const { store } = inMemory();
    setOrchestrationStoreFactory(() => store);
    const traces = traceCapture();
    const { runId, events, header } = await post(BODIES.replacement);
    expect(header).toBe("1");
    expect(events.every((event) => event.v === 1)).toBe(true);
    expect(types(events).filter((type) => type === "run_started")).toHaveLength(1);
    expect(types(events).filter((type) => type === "run_completed" || type === "run_failed")).toEqual(["run_completed"]);
    expect(types(events).at(-1)).toBe("run_completed");
    const facts = orchestration(events);
    expect(facts.map((event) => `${String(event.type)}${event.taskId ? `:${String(event.taskId)}` : ""}`)).toEqual([
      "plan",
      "specialist_started:task-1-circuit-topology", "specialist_finished:task-1-circuit-topology",
      "degraded:task-2-component-sourcing-evidence",
      "specialist_started:task-3-schematic", "specialist_finished:task-3-schematic",
      "specialist_started:task-4-verification-critic", "specialist_finished:task-4-verification-critic",
      "partial_result",
    ]);
    for (const event of facts) {
      const { v, seq, ...shape } = event;
      void v; void seq;
      expect(orchestrationRunEventIssue(shape), String(event.type)).toBeNull();
      expect(event.runId).toBe(runId);
    }
    expect(facts[0]).toMatchObject({ type: "plan", scheduled: 3, notRun: 1, parallelism: 1, wallTimeMs: 300_000 });
    expect(String(facts[0]!.message)).toMatch(/^Orchestration: 3 specialist\(s\) scheduled after this turn, one at a time \(parallelism 1; DAG wall time 300 s; .* under rule .*; 1 planned specialist\(s\) with no tools this run \(role_has_no_tools\) will not run\.$/);
    expect(facts.at(-1)).toMatchObject({ type: "partial_result", planned: 4, usable: 3, unusable: 1, notStarted: 0, handedOn: true });
    for (const finished of facts.filter((event) => event.type === "specialist_finished")) expect(finished).toMatchObject({ status: "accepted", runsAgain: false, provider: "openai", model: "scripted", resultDigest: expect.stringMatching(/^eng1-/) });
    expect(warnings(events).filter((line) => STATUS_LINE.test(line))).toEqual([]);
    expect(traces).toHaveLength(1);
    const traced = traces[0]!.warnings;
    // the trace records each line through its own redactor, exactly as it recorded B21-B's warning (a task id reads `ta[redacted]` there, as it did at HEAD)
    for (const event of facts.filter((fact) => fact.type !== "specialist_started" && fact.type !== "partial_result")) expect(traced, String(event.message)).toContain(sanitizeTraceText(String(event.message)));
    expect(traced.some((line) => line.includes("started (task"))).toBe(false);
    expect(new Set(traced).size).toBe(traced.length);
    // the orchestration run's own record is exactly B21-B..D3's (the events change the stream, never the record)
    expect((await store.history({ ...SCOPE, runId })).map((entry) => `${entry.taskId.replace(/\.merge-[0-9a-f]{16}$/, ".merge-*")}:${entry.record.kind}`)).toEqual(["plan:plan", "task-1-circuit-topology:request", "task-1-circuit-topology:result", "task-2-component-sourcing-evidence:dissent", "task-3-schematic:request", "task-3-schematic:result", "task-4-verification-critic:request", "task-4-verification-critic:result", "task-1-circuit-topology.merge-*:decision", "task-3-schematic.merge-*:decision", "task-4-verification-critic.merge-*:decision"]);
  });

  it("2. a provider outage among the specialists stands down as a `degraded` event carrying B21-B's sentence, followed by the partial result (nothing usable, nothing handed on) and the coordinator's answer as the one terminal - the line recorded on the coordinator's trace, never a warning; the orchestration record holds what B21-B recorded", async () => {
    vi.stubEnv(ORCHESTRATION_ENABLED_ENV, "1");
    const { store } = inMemory();
    setOrchestrationStoreFactory(() => store);
    const traces = traceCapture();
    state.script = { "circuit-topology": "throw-quota" };
    const { runId, events } = await post(BODIES.replacement);
    const sentence = "Orchestration: the provider failed during the specialists (provider_outage); no follow-up turn was made and the assistant's answer above stands. 0 specialist result(s) are committed in the record.";
    const facts = orchestration(events);
    expect(facts.map((event) => event.type)).toEqual(["plan", "specialist_started", "specialist_finished", "degraded", "partial_result"]);
    expect(facts[2]).toMatchObject({ status: "escalated", runsAgain: false, reason: expect.stringMatching(/^provider_insufficient_quota: /) });
    expect(facts[3]).toMatchObject({ type: "degraded", reason: "provider_outage", taskId: null, message: sentence });
    expect(facts[4]).toMatchObject({ type: "partial_result", planned: 4, usable: 0, unusable: 1, notStarted: 3, handedOn: false });
    expect(warnings(events)).not.toContain(sentence);
    expect(types(events).at(-1)).toBe("run_completed");
    expect(events.at(-1)).toMatchObject({ steps: 1, finalText: expect.stringContaining("(scripted) One coordinator turn for: Delete U1") });
    expect(traces).toHaveLength(1);
    expect(traces[0]!.warnings).toContain(sanitizeTraceText(sentence));
    expect((await store.history({ ...SCOPE, runId })).map((entry) => `${entry.attempt}:${entry.record.kind}`)).toEqual(["0:plan", "0:request", "0:dissent"]);
  });

  it("3. a specialist's refused tool call stays a WARNING line; and the page's reducer folds the real stream into the ONE status line while the answer, notes, label, history and failure are exactly what an older reducer makes of the stream without the five events", async () => {
    vi.stubEnv(ORCHESTRATION_ENABLED_ENV, "1");
    const { store } = inMemory();
    setOrchestrationStoreFactory(() => store);
    state.script = { "verification-critic": "call-unknown" };
    const { events } = await post(BODIES.replacement);
    expect(warnings(events)).toContain("Orchestration: specialist verification-critic (task task-4-verification-critic, attempt 0) tool (unknown) refused: unknown_tool.");
    const all = events.reduce(reduceRunView, initialRunView());
    const older = events.filter((event) => !(ORCHESTRATION_RUN_EVENT_TYPES as readonly unknown[]).includes(event.type)).reduce(reduceRunView, initialRunView());
    const { status, ...projection } = projectRunView(all);
    const { status: none, ...baseline } = projectRunView(older);
    expect(projection).toEqual(baseline);
    expect(none).toBeNull();
    expect(status).toBe("Specialists: 3 scheduled · 3 finished · degraded mode (1 notice in the log above) · partial result: 3 of 4 usable");
  });

  it("4. flag OFF: the four streams are byte-identical to HEAD's recorded streams, carry none of the five events, and the adapter is called exactly once per request (green at the base by design: a pin of the flag-off identity)", async () => {
    vi.stubEnv(ORCHESTRATION_ENABLED_ENV, "0"); // [B21 E2 fix: tests-7] the flag OFF by the case itself, never by the shell's environment
    expect(orchestrationEnabled()).toBe(false);
    for (const [name, sentence] of Object.entries(BODIES) as Array<[keyof typeof BODIES, string]>) {
      state.starts = [];
      const { normalized, events } = await post(sentence);
      expect(normalized, name).toBe(HEAD_STREAMS[name].stream);
      expect(engineeringDigest(normalized), name).toBe(HEAD_STREAMS[name].digest);
      expect(orchestration(events), name).toEqual([]);
      expect(state.starts, name).toHaveLength(1);
    }
  });

  it("5. [B21 E2 fix: tests-1] every RUNTIME stand-down arrives as a `degraded` event with its own closed reason and B21-B's sentence - no specialist ran (the record unavailable), the coordinator's provider paused, nothing usable to hand on, the merge unable to record, the follow-up turn paused, the follow-up turn failed - never as a warning; each is on the coordinator's trace; a stand-down after the scheduler ran reports the partial result (what the merge withheld once it judged, null before)", async () => {
    vi.stubEnv(ORCHESTRATION_ENABLED_ENV, "1");
    type Scenario = { reason: DegradedReason; sentence: RegExp; partial: Record<string, unknown> | null; prepare(base: DurableOrchestrationRunStore): OrchestrationRunStore };
    const pass = (base: DurableOrchestrationRunStore): OrchestrationRunStore => base;
    const scenarios: Scenario[] = [
      { reason: "no_specialist_ran", sentence: /^Orchestration: no specialist ran \(store_unavailable\); the assistant's answer above stands\.$/, partial: null, prepare: (base) => ({ revision: (scope) => base.revision(scope), history: async () => { throw new Error("the store is down"); }, append: (request) => base.append(request) }) },
      { reason: "provider_paused", sentence: /^Orchestration: the coordinator's LLM provider is paused by Sirkit's own llm-provider meters \(provider_paused, OD-115\) - no further call is made to it/, partial: { planned: 4, usable: 0, unusable: 0, mergeWithheld: null, notStarted: 4, handedOn: false }, prepare: pass },
      { reason: "no_usable_result", sentence: /^Orchestration: no specialist result to hand on \(completed\); the assistant's answer above stands\.$/, partial: { planned: 4, usable: 0, unusable: 4, mergeWithheld: null, notStarted: 0, handedOn: false }, prepare: pass },
      { reason: "merge_unrecorded", sentence: /^Orchestration: the merge could not record its decisions \(store_unavailable\); no follow-up turn was made and the assistant's answer above stands\.$/, partial: { planned: 4, usable: 3, unusable: 1, mergeWithheld: null, notStarted: 0, handedOn: false }, prepare: (base) => ({ revision: (scope) => base.revision(scope), history: (scope) => base.history(scope), append: async (request) => { if (request.taskId.includes(".merge-") || request.taskId.startsWith("merge-")) throw new Error("the store is down"); return base.append(request); } }) },
      { reason: "follow_up_paused", sentence: /^Orchestration: no follow-up turn was made and the assistant's answer above stands \(the coordinator never switches provider mid-run\) - its LLM provider "openai" is paused \(insufficient_quota\)/, partial: { planned: 4, usable: 3, unusable: 1, mergeWithheld: 0, notStarted: 0, handedOn: false }, prepare: (base) => { let opened = false; return { revision: (scope) => base.revision(scope), history: (scope) => base.history(scope), append: async (request) => { if (!opened && request.taskId.includes(".merge-")) { opened = true; await failOnce("openai", "insufficient_quota", Date.now()); } return base.append(request); } }; } },
      { reason: "follow_up_failed", sentence: /^Orchestration: the follow-up coordinator turn did not complete \(provider_network\); the assistant's answer above stands\.$/, partial: { planned: 4, usable: 3, unusable: 1, mergeWithheld: 0, notStarted: 0, handedOn: false }, prepare: pass },
    ];
    for (const scenario of scenarios) {
      resetAdmissionControl();
      state.starts = [];
      state.script = scenario.reason === "no_usable_result" ? { "circuit-topology": "text-only", schematic: "text-only", "verification-critic": "text-only" } : {};
      state.followUpFails = scenario.reason === "follow_up_failed";
      if (scenario.reason === "provider_paused") await failOnce("openai", "insufficient_quota", Date.now());
      const { store } = inMemory();
      const wrapped = scenario.prepare(store);
      setOrchestrationStoreFactory(() => wrapped);
      const traces = traceCapture();
      const { events } = await post(BODIES.replacement);
      const label = scenario.reason;
      const downs = orchestration(events).filter((event) => event.type === "degraded" && event.taskId === null);
      const down = downs.at(-1)!;
      expect(down, label).toMatchObject({ type: "degraded", reason: scenario.reason, taskId: null, role: null, provider: null, model: null });
      expect(String(down.message), label).toMatch(scenario.sentence);
      expect(orchestrationRunEventIssue(Object.fromEntries(Object.entries(down).filter(([key]) => key !== "v" && key !== "seq"))), label).toBeNull();
      expect(warnings(events), label).not.toContain(String(down.message));
      expect(warnings(events).filter((line) => STATUS_LINE.test(line)), label).toEqual([]);
      expect(types(events).at(-1), label).toBe("run_completed");
      expect(types(events).filter((type) => type === "run_completed" || type === "run_failed"), label).toHaveLength(1);
      expect(traces, label).toHaveLength(1);
      expect(traces[0]!.warnings, label).toContain(sanitizeTraceText(String(down.message)));
      const partial = orchestration(events).filter((event) => event.type === "partial_result");
      if (scenario.partial === null) expect(partial, label).toEqual([]);
      else expect(partial, label).toMatchObject([scenario.partial]);
      setAgentTraceSinkFactory(null);
    }
  }, 120_000);

  it("6. [B21 E2 fix: tests-3] the coordinator's trace takes the FIRST ORCHESTRATION_TRACE_LINES_MAX (12) orchestration lines - status events and refusal warnings on ONE budget, in stream order, never a specialist_started or partial_result line - and the stand-down line past the cap; every line still reaches the stream", async () => {
    vi.stubEnv(ORCHESTRATION_ENABLED_ENV, "1");
    const { store } = inMemory();
    setOrchestrationStoreFactory(() => store);
    const traces = traceCapture();
    state.script = { "circuit-topology": "call-unknown-many", schematic: "call-unknown-many" };
    state.followUpFails = true;
    const { events } = await post(BODIES.replacement);
    const counted = events.filter((event) => (event.type === "warning" || (RUN_EVENT_TRACE_TYPES as readonly unknown[]).includes(event.type)) && String(event.message).startsWith("Orchestration:")).map((event) => String(event.message));
    const standDown = counted.at(-1)!;
    expect(standDown).toMatch(/^Orchestration: the follow-up coordinator turn did not complete \(provider_network\)/);
    expect(counted.length).toBeGreaterThan(ORCHESTRATION_TRACE_LINES_MAX + 2);
    expect(counted.filter((line) => line.endsWith("refused: unknown_tool."))).toHaveLength(8);
    const traced = traces[0]!.warnings.filter((line) => line.startsWith("Orchestration:"));
    expect(traced).toEqual([...counted.slice(0, ORCHESTRATION_TRACE_LINES_MAX), standDown].map((line) => sanitizeTraceText(line)));
    expect(traced.some((line) => line.includes(" started (task ") || line.includes("partial result"))).toBe(false);
    expect(orchestration(events).filter((event) => event.type === "specialist_started")).toHaveLength(3);
    expect(orchestration(events).filter((event) => event.type === "partial_result")).toHaveLength(1);
  });

  it("7. [B21 E2 fix: security-1, coverage-1] the partial result and the status line count what the deterministic MERGE withheld: the manufacturing-readiness reviewer's shape-valid result without a readiness reference (free text) is accepted by the scheduler and judged malformed by the merge - the stream says 0 of 1 usable, 1 withheld by the merge, and the one status line says so", async () => {
    vi.stubEnv(ORCHESTRATION_ENABLED_ENV, "1");
    const { store } = inMemory();
    setOrchestrationStoreFactory(() => store);
    const { events } = await post("Review the board's manufacturing readiness.");
    expect(state.starts.map((start) => start.role)).toEqual(["coordinator", "manufacturing-readiness-reviewer", "coordinator"]);
    expect(orchestration(events).filter((event) => event.type === "specialist_finished")).toMatchObject([{ role: "manufacturing-readiness-reviewer", status: "accepted", runsAgain: false }]);
    expect(warnings(events).some((line) => line.startsWith("Orchestration: merge:") && line.includes("readiness-claim-unreferenced"))).toBe(true);
    const partial = orchestration(events).filter((event) => event.type === "partial_result");
    expect(partial).toMatchObject([{ planned: 1, usable: 0, unusable: 0, mergeWithheld: 1, notStarted: 0, handedOn: true }]);
    expect(partial[0]!.message).toBe("Orchestration: partial result - 0 of 1 planned specialist(s) delivered a usable result (0 escalated or malformed, 1 withheld by the deterministic merge, 0 not started); the follow-up turn used what was committed, and says what stays missing.");
    expect(projectRunView(events.reduce(reduceRunView, initialRunView())).status).toBe("Specialists: 1 scheduled · 1 finished · partial result: 0 of 1 usable");
    expect(types(events).at(-1)).toBe("run_completed");
  });

  it("8. [B21 E2b] every specialist that ran has its OWN trace document on the durable trace record beside the orchestration run's - run id <runId>:<n>-<role>, the parent the coordinator's run, every block naming the task's index and role and the verdict on the last - the circuit specialist's read call on its own record; the not-run role has none; no string or key of any record holds a task id; the route's sink still receives ONE trace (the coordinator's) and the orchestration run's own history is exactly case 1's", async () => {
    vi.stubEnv(ORCHESTRATION_ENABLED_ENV, "1");
    const { repository, store } = inMemory();
    setOrchestrationStoreFactory(() => store);
    const traces = traceCapture();
    state.script = { "circuit-topology": "read-then-result" };
    const { runId, events } = await post(BODIES.replacement);
    expect(state.reads.map((read) => read.role)).toEqual(["circuit-topology"]);
    const traceStore = orchestrationTraceStoreOf(store)!;
    expect(await repository.listHeads({ aggregateType: ORCHESTRATION_TRACE_AGGREGATE_TYPE, scope: SCOPE })).toHaveLength(3);
    for (const [taskIndex, role] of [[1, "circuit-topology"], [3, "schematic"], [4, "verification-critic"]] as const) {
      const history = await traceStore.history(SCOPE, `${runId}:${taskIndex}-${role}`);
      expect(history, role).toHaveLength(1);
      const record = history[0]!.record;
      expect(record, role).toMatchObject({ runId: `${runId}:${taskIndex}-${role}`, parentRunId: runId, taskIndex, role });
      expect(validateOrchestrationTrace(record.document), role).toEqual([]);
      expect(record.document.trace.provider, role).toBe("openai");
      expect(record.document.attribution.length, role).toBeGreaterThan(0);
      for (const entry of record.document.attribution) expect(entry.orchestration, role).toMatchObject({ taskIndex, role, parentRunId: runId, providerId: "openai", modelId: "scripted" });
      expect(record.document.attribution.at(-1)!.orchestration.decision, role).toBe("accepted");
      expect(strings(record).filter((text) => /task-\d+-/.test(text)), role).toEqual([]);
    }
    const circuit = (await traceStore.history(SCOPE, `${runId}:1-circuit-topology`))[0]!.record.document;
    const calls = circuit.trace.events.filter((event) => event.kind === "tool_invocation");
    expect(calls.map((event) => (event.kind === "tool_invocation" ? event.toolId : null))).toEqual([state.reads[0]!.toolId]);
    expect(circuit.attribution.find((entry) => entry.seq === calls[0]!.seq)!.orchestration).toEqual({ taskIndex: 1, role: "circuit-topology", providerId: "openai", modelId: "scripted", parentRunId: runId });
    expect(await traceStore.history(SCOPE, `${runId}:2-component-sourcing-evidence`)).toEqual([]);
    expect(traces).toHaveLength(1);
    expect(traces[0]!.runId).toBe(runId);
    expect(warnings(events).some((line) => line.includes("trace document"))).toBe(false);
    expect((await store.history({ ...SCOPE, runId })).map((entry) => `${entry.taskId.replace(/\.merge-[0-9a-f]{16}$/, ".merge-*")}:${entry.record.kind}`)).toEqual(["plan:plan", "task-1-circuit-topology:request", "task-1-circuit-topology:result", "task-2-component-sourcing-evidence:dissent", "task-3-schematic:request", "task-3-schematic:result", "task-4-verification-critic:request", "task-4-verification-critic:result", "task-1-circuit-topology.merge-*:decision", "task-3-schematic.merge-*:decision", "task-4-verification-critic.merge-*:decision"]);
  });

  it("9. [B21 E2b] a failed specialist's own trace document keeps its failure as its terminal (the provider outage) and a task never started has none; a trace record that cannot be written is ONE visible warning line naming each task by role and index with its closed reason - never silent, never the driver's message - recorded on the coordinator's trace, while everything else stands: the events, the specialists' results, the merge, the follow-up turn, the one terminal and the orchestration run's record", async () => {
    vi.stubEnv(ORCHESTRATION_ENABLED_ENV, "1");
    const { store } = inMemory();
    setOrchestrationStoreFactory(() => store);
    state.script = { "circuit-topology": "throw-quota" };
    const failed = await post(BODIES.replacement);
    const circuit = (await orchestrationTraceStoreOf(store)!.history(SCOPE, `${failed.runId}:1-circuit-topology`))[0]!.record.document;
    expect(circuit.trace.events.map((event) => event.kind)).toEqual(["run_started", "terminal"]);
    expect(circuit.trace.terminal).toMatchObject({ outcome: "failed", failureReason: "provider_insufficient_quota" });
    expect(circuit.attribution).toEqual([]);
    expect(await orchestrationTraceStoreOf(store)!.history(SCOPE, `${failed.runId}:3-schematic`)).toEqual([]);
    // the trace records down: the run is otherwise exactly case 1's
    resetAdmissionControl();
    state.script = {};
    state.starts = [];
    const repository = new TraceRecordsDown();
    const down = new DurableOrchestrationRunStore(repository);
    setOrchestrationStoreFactory(() => down);
    const traces = traceCapture();
    const { runId, events } = await post(BODIES.replacement);
    const line = "Orchestration: 3 specialist trace document(s) were not recorded (circuit-topology task 1: trace_store_unavailable; schematic task 3: trace_store_unavailable; verification-critic task 4: trace_store_unavailable); the specialists' results stand, but their tool calls are not in the record.";
    expect(warnings(events).filter((text) => text.includes("trace document"))).toEqual([line]);
    expect(events.map((event) => JSON.stringify(event)).join("\n")).not.toContain("db-internal");
    expect(traces).toHaveLength(1);
    expect(traces[0]!.warnings).toContain(sanitizeTraceText(line));
    expect(orchestration(events).map((event) => `${String(event.type)}${event.taskId ? `:${String(event.taskId)}` : ""}`)).toEqual(["plan", "specialist_started:task-1-circuit-topology", "specialist_finished:task-1-circuit-topology", "degraded:task-2-component-sourcing-evidence", "specialist_started:task-3-schematic", "specialist_finished:task-3-schematic", "specialist_started:task-4-verification-critic", "specialist_finished:task-4-verification-critic", "partial_result"]);
    expect(types(events).filter((type) => type === "run_completed" || type === "run_failed")).toEqual(["run_completed"]);
    expect(events.at(-1)).toMatchObject({ type: "run_completed", steps: 2 });
    expect(await repository.listHeads({ aggregateType: ORCHESTRATION_TRACE_AGGREGATE_TYPE, scope: SCOPE })).toEqual([]);
    expect((await down.history({ ...SCOPE, runId })).map((entry) => `${entry.taskId.replace(/\.merge-[0-9a-f]{16}$/, ".merge-*")}:${entry.record.kind}`)).toEqual(["plan:plan", "task-1-circuit-topology:request", "task-1-circuit-topology:result", "task-2-component-sourcing-evidence:dissent", "task-3-schematic:request", "task-3-schematic:result", "task-4-verification-critic:request", "task-4-verification-critic:result", "task-1-circuit-topology.merge-*:decision", "task-3-schematic.merge-*:decision", "task-4-verification-critic.merge-*:decision"]);
  });

  it("10. [B21 E2b fix: tests-5, regressions-3] the unrecorded-trace line is ALWAYS on the coordinator's trace - past the 12-line orchestration cap - and WHOLE: at most the recorder's 300-character warning bound by construction (whole task entries, the rest counted as `+N more`, its closing clause never cut), so the trace holds exactly the stream's line; one to four failing documents of the longest specialist roles at two-digit indices stay within the bound", async () => {
    const longest = SPECIALIST_ROLES.filter((role) => role !== "coordinator").sort((a, b) => b.length - a.length).slice(0, 4);
    for (let count = 1; count <= longest.length; count += 1) {
      const line = traceUnrecordedLine(longest.slice(0, count).map((role, index) => `${role} task ${29 + index}: trace_store_unavailable`));
      expect(line.length, `${count} failing`).toBeLessThanOrEqual(TRACE_BOUNDS.maxWarningChars);
      expect(sanitizeTraceText(line), `${count} failing`).toBe(line);
      expect(line.startsWith(`Orchestration: ${count} specialist trace document(s) were not recorded (${longest[0]} task 29: `), `${count} failing`).toBe(true);
      expect(line, `${count} failing`).toMatch(/^Orchestration: \d specialist trace document\(s\) were not recorded \([a-z-]+ task \d+: trace_store_unavailable(?:; [a-z-]+ task \d+: trace_store_unavailable)*(?:; \+\d+ more)?\); the specialists' results stand, but their tool calls are not in the record\.$/);
    }
    expect(traceUnrecordedLine(longest.map((role, index) => `${role} task ${29 + index}: trace_store_unavailable`))).toMatch(/; \+\d+ more\); the specialists' results stand/);
    // through the production POST: the trace records down and two specialists filling the 12-line cap with refused calls first
    vi.stubEnv(ORCHESTRATION_ENABLED_ENV, "1");
    const down = new DurableOrchestrationRunStore(new TraceRecordsDown());
    setOrchestrationStoreFactory(() => down);
    const traces = traceCapture();
    state.script = { "circuit-topology": "call-unknown-many", schematic: "call-unknown-many" };
    const { events } = await post(BODIES.replacement);
    const counted = events.filter((event) => (event.type === "warning" || (RUN_EVENT_TRACE_TYPES as readonly unknown[]).includes(event.type)) && String(event.message).startsWith("Orchestration:")).map((event) => String(event.message));
    const unrecorded = counted.filter((line) => line.includes("trace document"));
    expect(unrecorded).toEqual(["Orchestration: 3 specialist trace document(s) were not recorded (circuit-topology task 1: trace_store_unavailable; schematic task 3: trace_store_unavailable; verification-critic task 4: trace_store_unavailable); the specialists' results stand, but their tool calls are not in the record."]);
    expect(counted.indexOf(unrecorded[0]!)).toBeGreaterThan(ORCHESTRATION_TRACE_LINES_MAX);
    expect(traces).toHaveLength(1);
    const traced = traces[0]!.warnings.filter((line) => line.startsWith("Orchestration:"));
    expect(traced).toEqual([...counted.slice(0, ORCHESTRATION_TRACE_LINES_MAX).map((line) => sanitizeTraceText(line)), unrecorded[0]]);
    expect(traces[0]!.warnings.length).toBeLessThanOrEqual(TRACE_BOUNDS.maxWarnings);
  });
});
