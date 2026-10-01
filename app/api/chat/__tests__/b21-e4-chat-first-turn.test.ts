/**
 * [B21 E4] The coordinator's first turn behind the llm-provider breaker (D21-39), through the PRODUCTION POST. The adapters module is
 * the ORIGINAL one with its two factories wrapped: the REAL adapter classes answer through in-process fake SDK clients whose every
 * call is counted - no network, no model. With the breaker CLOSED the flag-off path is byte-identical to HEAD (B21-B's four recorded
 * streams; one SDK call each). With the coordinator's provider PAUSED (its breaker open after a no-credits 429) a request makes NO SDK
 * call on the flag-off path and on the flag-on paths (a single plan and a DAG plan): the stream is `run_started` and ONE `run_failed`
 * `provider_breaker_open` carrying the meters' own pause sentence (the card's Retry withheld, its Switch kept), nothing is written to
 * the orchestration record, and a Tier 3 ask is still refused as before. A RESUMED request is not gated (its first turn is replayed,
 * no call): its follow-up turn consults the breaker (E1) and stands down, it makes no call, and its start is settled.
 * [B21 E4 fix] The review's findings: a half-open breaker's trial in flight never gates a first turn (case 6, regressions-1); the gate
 * only reads the meters, so on a flag-off process nothing ever pauses a provider (case 7, coverage-1) and a no-credits account whose
 * first turn fails first never opens the breaker (case 8, coverage-2) - both RECORDED limits, pinned.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SchematicState } from "@/lib/schematic-types";
import { schematicStateDigest } from "@/app/lib/engineering/schematic-model";
import { createEmptyBoard } from "@/app/lib/pcb/types";
import { pcbRevisionId } from "@/app/lib/pcb/revision";
import { replacementHeadDigestFor } from "@/app/lib/engineering/replacement-proposal-assembler";
import { engineeringDigest } from "@/app/lib/engineering/stable";
import { InMemoryDurableWorkflowRepository } from "@/app/lib/durable-workflow/repository";
import { DurableOrchestrationRunStore } from "@/app/lib/agent/orchestration/store";
import { currentLlmProviderPause, resetAdmissionControl } from "@/app/lib/acquisition/admission-control";
import { InMemoryTraceSink, setAgentTraceSinkFactory } from "@/app/lib/agent/trace-recorder";
import type { AgentRunTrace } from "@/app/lib/agent/trace";
import { providerRetryOffered } from "@/app/lib/agent/run-consumer";
import { TIER3_REFUSAL_SENTENCE } from "@/app/lib/agent/orchestration/router";
import { START_INPUT, failOnce, heldAdapter } from "@/app/lib/agent/orchestration/__tests__/_e1-fixtures";
import { PROCESS_LLM_PROVIDER_ADMISSION, admittedAdapter } from "@/app/lib/agent/orchestration/provider-policy";

type Params = Record<string, unknown>;
const state = vi.hoisted(() => ({
  /** every SDK call, by provider: the request params the REAL adapter sent */
  openai: [] as Params[],
  anthropic: [] as Params[],
  /** the follow-up turn's next OpenAI call answers a no-credits 429 */
  followUpQuota: false,
  /** [B21 E4 fix: coverage-1, coverage-2] a no-credits account: EVERY OpenAI call answers a no-credits 429 */
  outOfCredits: false,
}));
const ROLE = /^Role: ([a-z-]+)$/m;
const roleOf = (params: Params): string => ROLE.exec(String(params.instructions ?? params.system ?? ""))?.[1] ?? "coordinator";
const turnOf = (params: Params): string => (roleOf(params) === "coordinator" && lastUser(params).startsWith("ORCHESTRATION RESULTS") ? "coordinator-2" : roleOf(params));
function lastUser(params: Params): string {
  const input = (params.input ?? params.messages) as Array<{ role?: string; content?: unknown }> | undefined;
  const last = [...(input ?? [])].reverse().find((item) => item.role === "user");
  return typeof last?.content === "string" ? last.content : "";
}

vi.mock("@/app/lib/agent/adapters", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/app/lib/agent/adapters")>();
  const usage = { input_tokens: 3, output_tokens: 5 };
  const result = (role: string): Record<string, unknown> => ({ role, summary: `(fake ${role}) nothing found; nothing changed.`, assumptions: [], evidence: [], requiredTools: [], risks: [], unresolvedQuestions: [], validationRequests: [], confidence: "low" });
  // B21-B's scripted coordinator text: the flag-off streams reproduce B's pins recorded from HEAD 4b6d0e2
  const coordinatorText = (params: Params): string => (turnOf(params) === "coordinator-2" ? "(scripted) The follow-up turn answers from the merge." : `(scripted) One coordinator turn for: ${lastUser(params).slice(0, 80)}`);
  const openai = {
    responses: {
      create: async (params: Params) => {
        state.openai.push(params);
        const role = roleOf(params);
        if (state.outOfCredits) throw Object.assign(new Error("You exceeded your current quota"), { status: 429, code: "insufficient_quota" });
        if (turnOf(params) === "coordinator-2" && state.followUpQuota) { state.followUpQuota = false; throw Object.assign(new Error("You exceeded your current quota"), { status: 429, code: "insufficient_quota" }); }
        if (role === "coordinator") { const text = coordinatorText(params); return { output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text, annotations: [] }] }], output_text: text, status: "completed", model: "scripted", usage }; }
        return { output: [{ type: "function_call", call_id: `call-${role}`, name: "sirkit_specialist_result", arguments: JSON.stringify(result(role)) }], output_text: "", status: "completed", model: "scripted", usage };
      },
    },
  };
  const anthropic = {
    messages: {
      create: async (params: Params) => {
        state.anthropic.push(params);
        const role = roleOf(params);
        if (role === "coordinator") return { content: [{ type: "text", text: coordinatorText(params) }], stop_reason: "end_turn", model: "scripted", usage };
        return { content: [{ type: "tool_use", id: `toolu_${role.replaceAll("-", "_")}`, name: "sirkit_specialist_result", input: result(role) }], stop_reason: "tool_use", model: "scripted", usage };
      },
    },
  };
  return {
    ...original,
    agentAdapterFor: (provider: "openai" | "anthropic") => (provider === "openai" ? new original.OpenAIAgentAdapter(openai as never, "gpt-fake", undefined) : new original.AnthropicAgentAdapter(anthropic as never, "claude-fake")),
    agentAdapterForRole: (_role: string, provider: "openai" | "anthropic", model?: string) => (provider === "openai" ? new original.OpenAIAgentAdapter(openai as never, model, undefined, 0) : new original.AnthropicAgentAdapter(anthropic as never, model, 0)),
  };
});

import { POST, EDITOR_CONTEXT_SCHEMA } from "../route";
import { CHAT_RESUME_BODY_KEY, ORCHESTRATION_ENABLED_ENV, resetOrchestrationStoreFactory, setOrchestrationStoreFactory } from "../orchestration-runtime";

const SCOPE = { tenantId: "tenant-1", projectId: "project-1", branchId: "main" };
/** B21-B's request, byte for byte */
const SCHEMATIC: SchematicState = {
  components: [], wires: [], netLabels: [],
  kicadComponents: [{ id: "u1-id", partId: "lib:part-a", x: 300, y: 100, rotation: 0, refDes: "U1", value: "MCU", atomicPartRevisionId: "rev-current", symbolAssetVersionId: "sym-current" }],
};
const BODIES = {
  simple: "Move R3 2 mm to the right.",
  view: "Open the 3D view, hide the top silkscreen, focus on J1, and switch to an isometric view.",
  replacement: "Delete U1 and replace it with the approved lower-power part while preserving compatible nets.",
  tier3: "Release the board to manufacturing.",
} as const;
/** B21-B's streams RECORDED from HEAD 4b6d0e2 (b21-b-chat-router.test.ts, HEAD_STREAMS), reproduced by every later HEAD up to fafc90e */
const HEAD_DIGESTS: Record<keyof typeof BODIES, string> = { simple: "eng1-656c2588b836c043", view: "eng1-07aaf2589736c9f7", replacement: "eng1-bf8822508f100b13", tier3: "eng1-9fbc41d4ee249877" };
function chatBody(sentence: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const board = createEmptyBoard();
  return {
    provider: "openai", messages: [{ role: "user", content: sentence }], scope: SCOPE, schematicState: SCHEMATIC,
    schematicHeadMark: { lineageId: "lin1-a9e2470c11bd8833", headSequence: 3, canonicalStateDigest: replacementHeadDigestFor(SCHEMATIC, SCOPE) },
    editorContext: { schema: EDITOR_CONTEXT_SCHEMA, scope: SCOPE, board, pcbRevisionId: pcbRevisionId(board), selection: { refs: [], primary: null }, netlist: null, schematicDigest: schematicStateDigest(SCHEMATIC), authoritySource: "local-working-copy" },
    ...extra,
  };
}
type Posted = { status: number; runId: string | null; headers: Headers; normalized: string; events: Array<Record<string, unknown>>; json: Record<string, unknown> | null };
async function post(body: Record<string, unknown>): Promise<Posted> {
  const response = await POST(new Request("http://localhost/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  const runId = response.headers.get("X-Sirkit-Run-Id");
  const text = await response.text();
  const ndjson = (response.headers.get("Content-Type") ?? "").includes("ndjson");
  return { status: response.status, runId, headers: response.headers, normalized: runId ? text.replaceAll(runId, "<runId>") : text, events: ndjson ? text.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>) : [], json: ndjson ? null : (JSON.parse(text) as Record<string, unknown>) };
}
const sdkCalls = (): number => state.openai.length + state.anthropic.length;
const types = (events: Array<Record<string, unknown>>): string[] => events.map((event) => String(event.type));
const terminals = (events: Array<Record<string, unknown>>): Array<Record<string, unknown>> => events.filter((event) => event.type === "run_completed" || event.type === "run_failed");
const ORCHESTRATION_TYPES = ["plan", "specialist_started", "specialist_finished", "partial_result", "degraded"];
const openaiPause = () => currentLlmProviderPause({ kind: "llm-provider", provider: "openai" }, Date.now(), "interactive");
function traceCapture(): AgentRunTrace[] {
  const sink = new InMemoryTraceSink();
  const traces: AgentRunTrace[] = [];
  setAgentTraceSinkFactory(() => ({ append: (event) => sink.append(event), complete: (trace) => { traces.push(trace); sink.complete(trace); } }));
  return traces;
}
/** the gated answer: run_started, then ONE run_failed `provider_breaker_open` whose message is the meters' pause sentence */
function expectGated(posted: Posted, label: string): void {
  expect(posted.status, label).toBe(200);
  expect(posted.headers.get("X-Sirkit-Chat-Protocol"), label).toBe("1");
  expect(types(posted.events), label).toEqual(["run_started", "run_failed"]);
  expect(posted.events[0], label).toMatchObject({ v: 1, seq: 1, type: "run_started", runId: posted.runId, provider: "openai" });
  expect(posted.events[1], label).toEqual({ v: 1, seq: 2, type: "run_failed", runId: posted.runId, reason: "provider_breaker_open", message: `No model call was made for this message: ${openaiPause()!.message}` });
  expect(providerRetryOffered(String(posted.events[1]!.reason)), label).toBe(false);
}

vi.stubGlobal("fetch", () => { throw new Error("no network"); });
let store: DurableOrchestrationRunStore;
beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("SIRKIT_ORCHESTRATION_ROLE_MODELS", "");
  vi.stubEnv("SIRKIT_OPENAI_MODEL", "");
  vi.stubEnv("SIRKIT_ANTHROPIC_MODEL", "claude-opus-4-7");
  resetAdmissionControl();
  store = new DurableOrchestrationRunStore(new InMemoryDurableWorkflowRepository());
  setOrchestrationStoreFactory(() => store);
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetOrchestrationStoreFactory();
  resetAdmissionControl();
  setAgentTraceSinkFactory(null);
  state.openai = [];
  state.anthropic = [];
  state.followUpQuota = false;
  state.outOfCredits = false;
});

describe("[B21 E4] the coordinator's first turn behind the llm-provider breaker, through the production POST (D21-39)", () => {
  it("1. flag OFF with the breaker CLOSED: the four streams are byte-identical to HEAD's (B21-B's recorded digests) and each request makes exactly ONE SDK call - the gate reads the meters and changes nothing", async () => {
    expect(process.env[ORCHESTRATION_ENABLED_ENV]).toBeUndefined();
    for (const [name, sentence] of Object.entries(BODIES) as Array<[keyof typeof BODIES, string]>) {
      state.openai = [];
      const posted = await post(chatBody(sentence));
      expect(engineeringDigest(posted.normalized), name).toBe(HEAD_DIGESTS[name]);
      expect(state.openai.map(roleOf), name).toEqual(["coordinator"]);
    }
    expect(state.anthropic).toEqual([]);
  });

  it("2. flag OFF with the coordinator's provider OUT OF CREDITS (its breaker opened by a no-credits 429): NO SDK call for any of the four messages - each stream is run_started then ONE run_failed `provider_breaker_open` carrying the meters' pause sentence, the card's Retry withheld; the trace's terminal is that failure with no step and the line on it", async () => {
    // [B21 E4 fix: coverage-1] the breaker is opened by a METERED call (the fixture's admitted call - a flag-on process's specialist); a
    // flag-off process meters no call, so by itself it never reaches this state (case 7): this case proves the gate's flag-off path
    await failOnce("openai", "insufficient_quota", Date.now());
    expect(openaiPause()).toMatchObject({ reason: "breaker_open" });
    const traces = traceCapture();
    for (const [name, sentence] of Object.entries(BODIES) as Array<[keyof typeof BODIES, string]>) expectGated(await post(chatBody(sentence)), name);
    expect(sdkCalls()).toBe(0);
    expect(traces).toHaveLength(4);
    for (const trace of traces) {
      expect(trace.events.map((event) => event.kind)).toEqual(["run_started", "terminal"]);
      expect(trace.terminal).toMatchObject({ outcome: "failed", failureReason: "provider_breaker_open" });
      expect(trace.warnings.some((line) => line.startsWith("No model call was made for this message: LLM provider \"openai\" is paused (insufficient_quota)"))).toBe(true);
    }
  });

  it("3. flag ON while paused: a SINGLE plan (the simple command, the 3D request) and the DAG plan (the replacement) make NO SDK call and answer the same gated stream - no plan, no specialist, no degraded line - and nothing is written to the orchestration record (a resume of the gated run is refused `resume_unknown`); a Tier 3 ask is answered by the refusal exactly as before (no call either way)", async () => {
    vi.stubEnv(ORCHESTRATION_ENABLED_ENV, "1");
    await failOnce("openai", "insufficient_quota", Date.now());
    for (const name of ["simple", "view", "replacement"] as const) {
      const posted = await post(chatBody(BODIES[name]));
      expectGated(posted, name);
      expect(types(posted.events).filter((type) => ORCHESTRATION_TYPES.includes(type)), name).toEqual([]);
      const resumed = await post(chatBody(BODIES[name], { [CHAT_RESUME_BODY_KEY]: posted.runId }));
      expect(resumed.status, name).toBe(404);
      expect(resumed.json, name).toMatchObject({ ok: false, code: "resume_unknown" });
    }
    const refused = await post(chatBody(BODIES.tier3));
    expect(types(refused.events)).toEqual(["run_started", "warning", "run_completed"]);
    expect(terminals(refused.events)[0]).toMatchObject({ type: "run_completed", finalText: TIER3_REFUSAL_SENTENCE, steps: 0 });
    expect(sdkCalls()).toBe(0);
  });

  it("4. one provider's breaker gates only its own requests: with OpenAI paused a request on Anthropic makes its one coordinator call there and completes; OpenAI is never called", async () => {
    await failOnce("openai", "insufficient_quota", Date.now());
    const posted = await post({ ...chatBody(BODIES.simple), provider: "anthropic" });
    expect(terminals(posted.events)).toEqual([expect.objectContaining({ type: "run_completed", finalText: `(scripted) One coordinator turn for: ${BODIES.simple}` })]);
    expect(state.anthropic.map(roleOf)).toEqual(["coordinator"]);
    expect(state.openai).toEqual([]);
  });

  it("5. a RESUMED request while paused is not gated at its first turn (replayed from the record, no call) and still makes NO SDK call: the first request's follow-up turn answered a no-credits 429 (its breaker opened, the run stood down resumable); the resume replays the first answer and the committed specialists, makes no follow-up turn (`follow_up_paused`), ends with ONE run_completed carrying the replayed answer, and SETTLES its start - with the breaker reset the next resume is admitted and its follow-up answers", async () => {
    vi.stubEnv(ORCHESTRATION_ENABLED_ENV, "1");
    state.followUpQuota = true;
    const first = await post(chatBody(BODIES.replacement));
    const answer = `(scripted) One coordinator turn for: ${BODIES.replacement.slice(0, 80)}`;
    expect(terminals(first.events)).toEqual([expect.objectContaining({ type: "run_completed", finalText: answer })]);
    expect(state.openai.map(turnOf)).toEqual(["coordinator", "circuit-topology", "schematic", "verification-critic", "coordinator-2"]);
    expect(openaiPause()).toMatchObject({ reason: "breaker_open" });
    const calls = sdkCalls();
    const resumed = await post(chatBody(BODIES.replacement, { [CHAT_RESUME_BODY_KEY]: first.runId }));
    expect(resumed.status).toBe(200);
    expect(resumed.runId).toBe(first.runId);
    expect(sdkCalls()).toBe(calls);
    expect(types(resumed.events)).not.toContain("run_failed");
    expect(terminals(resumed.events)).toEqual([expect.objectContaining({ type: "run_completed", finalText: answer, steps: 0 })]);
    expect(resumed.events.filter((event) => event.type === "degraded" && event.taskId === null).map((event) => event.reason)).toEqual(["follow_up_paused"]); // the run's stand-down (the sourcing task's no-tools line is its own, taskId set)
    resetAdmissionControl();
    const again = await post(chatBody(BODIES.replacement, { [CHAT_RESUME_BODY_KEY]: first.runId }));
    expect(again.status).toBe(200);
    expect(state.openai.slice(calls).map(turnOf)).toEqual(["coordinator-2"]);
    expect(terminals(again.events)).toEqual([expect.objectContaining({ type: "run_completed", finalText: "(scripted) The follow-up turn answers from the merge." })]);
  });

  it("6. [B21 E4 fix: regressions-1] flag OFF while a half-open breaker's ONE trial call is in flight (another request's metered call, admitted once the rate-limit minute was over): the first turn is NOT gated - it takes no trial and settles none - so the request makes its one call and its stream is byte-identical to HEAD's; the trial's own answer then closes the breaker", async () => {
    await failOnce("openai", "rate_limit", Date.now() - 61_000);
    const held = heldAdapter("openai");
    const trial = admittedAdapter(held.adapter, { provider: "openai" }, PROCESS_LLM_PROVIDER_ADMISSION, () => Date.now()).adapter.start(START_INPUT);
    expect(held.pending()).toBe(1);
    expect(openaiPause()).toMatchObject({ reason: "breaker_open" }); // what a metered call meets while the trial is out
    const posted = await post(chatBody(BODIES.simple));
    expect(engineeringDigest(posted.normalized)).toBe(HEAD_DIGESTS.simple);
    expect(state.openai.map(roleOf)).toEqual(["coordinator"]);
    held.release();
    await trial;
    expect(openaiPause()).toBeNull();
  });

  it("7. [B21 E4 fix: coverage-1] flag OFF on a no-credits account: the coordinator's call answers a 429 `insufficient_quota` (the run fails `provider_insufficient_quota`, the card's Retry withheld) and NOTHING reaches the breaker - a flag-off process meters no call - so the next request makes its one call again and fails the same way: on a flag-off process the gate never fires (RECORDED; case 2 opens the breaker through a metered call no flag-off request makes)", async () => {
    expect(process.env[ORCHESTRATION_ENABLED_ENV]).toBeUndefined();
    state.outOfCredits = true;
    const streams: string[] = [];
    for (const attempt of [1, 2]) {
      const posted = await post(chatBody(BODIES.simple));
      streams.push(posted.normalized);
      expect(terminals(posted.events), `request ${attempt}`).toEqual([expect.objectContaining({ type: "run_failed", reason: "provider_insufficient_quota" })]);
      expect(types(posted.events).filter((type) => ORCHESTRATION_TYPES.includes(type)), `request ${attempt}`).toEqual([]);
      expect(providerRetryOffered("provider_insufficient_quota")).toBe(false);
      expect(openaiPause(), `request ${attempt}`).toBeNull();
      expect(state.openai.map(roleOf), `request ${attempt}`).toEqual(Array.from({ length: attempt }, () => "coordinator"));
    }
    expect(streams[1]).toBe(streams[0]); // the second request is answered exactly as the first: its own paid-path call, never the gate
  });

  it("8. [B21 E4 fix: coverage-2] flag ON on a no-credits account whose first turn fails first: the replacement's coordinator turn answers the 429, the DAG stands down before any specialist - no metered call is made, no plan written - and the breaker stays CLOSED, so the next request's first turn makes its 429 call again: the breaker opens only on a metered call's answer (a specialist's or a follow-up turn's), which such an account never reaches (RECORDED; gate case 7 pins the one-window limit once it has opened)", async () => {
    vi.stubEnv(ORCHESTRATION_ENABLED_ENV, "1");
    state.outOfCredits = true;
    for (const attempt of [1, 2]) {
      const posted = await post(chatBody(BODIES.replacement));
      expect(terminals(posted.events), `request ${attempt}`).toEqual([expect.objectContaining({ type: "run_failed", reason: "provider_insufficient_quota" })]);
      expect(types(posted.events).filter((type) => ORCHESTRATION_TYPES.includes(type)), `request ${attempt}`).toEqual([]);
      expect(openaiPause(), `request ${attempt}`).toBeNull();
      expect(state.openai.map(turnOf), `request ${attempt}`).toEqual(Array.from({ length: attempt }, () => "coordinator"));
    }
  });
});
