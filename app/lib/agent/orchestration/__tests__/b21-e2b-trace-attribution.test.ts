/**
 * [B21 E2b] The trace block (OD-112 as the lead read it, D21-41; D21-11's trace half, D21-3's calls). ONE trace document PER
 * SPECIALIST TASK - a complete, unchanged v1 run trace with its own run id `<runId>:<n>-<role>` (the task's index and role, never the
 * literal task id) and its own 256-event bound - carried in an orchestration trace document that attaches the closed `orchestration`
 * block `{ taskIndex, role, providerId, modelId, parentRunId, decision? }` to every step and tool invocation by sequence number: one
 * rule shared by the validator and the attribution cascade (the B20-A4 `external` precedent's shape), pattern-bound and
 * denylist-checked; the task's tool CALLS persisted on its own durable trace record beside the orchestration run's (its history
 * unchanged); a retry's attempts in one document with one terminal; the nine B11-scanned files byte-identical to HEAD, the trace
 * contract refusing a block placed INSIDE an event (the v1 contract is unchanged: the block rides beside), the coordinator's closed
 * provider literal kept. The held E2 run-1 suite (8 cases), adapted to the lead's reading. REAL scheduler, loop, gateway, registry
 * and recorder; the in-memory durable repository; no network, no model.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { InMemoryDurableWorkflowRepository } from "@/app/lib/durable-workflow/repository";
import { AGENT_SYSTEM_PROMPT } from "@/app/lib/prompts";
import { AgentTraceRecorder, InMemoryTraceSink } from "@/app/lib/agent/trace-recorder";
import { AGENT_RUN_TRACE_SCHEMA, TRACE_BOUNDS, TRACE_OUTCOME_CLASSES, validateAgentRunTrace, type AgentRunTrace } from "@/app/lib/agent/trace";
import type { AgentRunRequest, AgentStep, AgentToolResult, ProviderAgentAdapter, ProviderToolDeclaration } from "@/app/lib/agent/contracts";
import type { AgentLoopDeps } from "@/app/lib/agent/loop";
import { agentProviderName } from "@/app/lib/agent/provider-tools";
import { resetAdmissionControl } from "@/app/lib/acquisition/admission-control";
import type { DurableAggregateRecord, DurableCommitRequest, DurableCommitResult } from "@/app/lib/durable-workflow/types";
import { ORCHESTRATION_DECISIONS, DurableOrchestrationRunStore, orchestrationTraceStoreOf, type OrchestrationRunStore } from "../store";
import { B11_SCANNED_FILES, ORCHESTRATION_IDENTIFIER_PATTERN } from "../tripwires";
import { specialistRunId } from "../scheduler";
import { ROLE_MODELS_ENV } from "../provider-policy";
import {
  DurableOrchestrationTraceStore, MAX_TASK_INDEX, ORCHESTRATION_TRACE_AGGREGATE_TYPE, ORCHESTRATION_TRACE_ATTRIBUTED_KINDS, ORCHESTRATION_TRACE_BLOCK_KEYS, ORCHESTRATION_TRACE_BLOCK_OPTIONAL_KEYS, ORCHESTRATION_TRACE_SCHEMA, TRACE_BLOCK_DECISIONS,
  attributeSpecialistTrace, orchestrationBlockIssue, specialistTraceBook, specialistTraceRunId, validateOrchestrationTrace, validatedOrchestrationTraceDigest, type OrchestrationTraceDocument, type OrchestrationTraceRecord, type OrchestrationTraceStore,
} from "../trace-attribution";
import { E2Adapter, E2_RUN_ID, resultDocument, runE2Dag, type E2Behaviour } from "./_e2-fixtures";
import { answersOpenAI, anthropicResultMessage, failOnce, fakeAnthropic, fakeOpenAI, fakeProviders, openAIResultResponse, roleOf, type Params } from "./_e1-fixtures";
import { REGISTRY, coordinatorContext } from "./_merge-fixtures";
import { answer } from "./_result-tool";

const ROOT = process.cwd();
const SCOPE = { tenantId: "tenant-e2", projectId: "project-e2", branchId: "main" };
const AT = "2026-09-27T12:00:00.000Z";
/** sha256 of the nine B11-scanned files at HEAD 41330e6 (git show HEAD:<path> | sha256sum; identical at 3a32317) - E2b edits none of them [B21 F, 2026-09-28: B21-F moved ONE entry, the replay capsule's, to F's hash - its reason beside it; the other eight are 41330e6's] */
const SCANNED_AT_HEAD: Readonly<Record<string, string>> = {
  "app/lib/agent/trace.ts": "ad933eb059dff859cc0fe910aa82d0eb2ef24f14eedab1bef94c510a7dd60ba5",
  "app/lib/agent/trace-recorder.ts": "61cff587cea51da0dd343a0dfd8c1171f2503acf57fc278dba3b352e3bea914b",
  "app/lib/agent/replay-capsule.ts": "7080ecc24ab874889dd9754e17ffc97e65d73d2635cfde3a0d7e7ab29e4039eb", // [B21 F] reviewed pin move: B21-F extended this file to the capsule v4 (per-task step lists, scripted stalls; evaluation-matrix.md section 2) - at 41330e6 it was 77958c9488b43d490b012aa10638df6b93e1dd2aaf704dee11aac206ea41f1b1; it still carries no orchestration identifier and imports nothing under orchestration (asserted below)
  "app/lib/agent/replay-context.ts": "fcdc9a7d0d6c6f9c09a56732ac643d59503695dc224734a76b030c38261fbbff",
  "app/lib/agent/evaluation.ts": "9d948da7726e6ee5ed8dd266f064d5a35cda25f18c337f70d8b740245d1b1b19",
  "app/lib/agent/evaluation-cases.ts": "6637099755e2d0a968a15e2b4bc73f12c27f026b721dd087c0acc25c3f1ecc16",
  "app/lib/agent/pcb-shape-projection.ts": "e6a58afbd30cb46f9da28b9e43768c7d0a524822adf0b47746eb1fa3ddd44750",
  "app/lib/agent/pcb-shape-types.ts": "b46e801bcb00138aaa5d2c0c8de0b092be50cbd48e2eda43699055d2301bd590",
  "app/lib/agent/generated/pcb-shape-descriptor.ts": "69dc94fcfc6fb939ce22d8ce5e08739f0be6ab3b192b52a496aa183fa3538cfb",
};
const NUL = String.fromCharCode(0);
const BEL = String.fromCharCode(7);
/** the per-task trace run id of the plan's first specialist (circuit-topology) under the fixture's coordinator run */
const CIRCUIT_RUN = specialistTraceRunId(E2_RUN_ID, 1, "circuit-topology");

/** a finalized specialist trace: run_started, a step asking for a read, the read, a closing step, the terminal */
function specialistTrace(over: { runId?: string; provider?: "openai" | "anthropic"; model?: string } = {}): AgentRunTrace {
  const recorder = new AgentTraceRecorder({
    runId: over.runId ?? CIRCUIT_RUN, traceId: "trace-e2b-unit", provider: over.provider ?? "openai", promptVersion: "1.4.0", promptDigest: "eng1-0000000000000001", registryDigest: "eng1-0000000000000002",
    scope: SCOPE, contextDigests: { canonicalRevisionDigest: null, schematicDigest: null, selectionDigest: null, netlistDigest: null, resourceManifestDigest: null },
  }, new InMemoryTraceSink(), () => Date.parse(AT));
  recorder.recordRunStarted();
  recorder.recordStep({ model: over.model ?? "gpt-fake", usage: { inputTokens: 5, outputTokens: 7 }, toolCallCount: 1 });
  recorder.recordTool({ callId: "call-1", toolId: "sirkit.validation.connectivity-verify", version: "1.0.0", operationClass: "read", args: {}, outcomeClass: "read", status: "succeeded", verification: "eng1-0000000000000003", output: { ok: true } });
  recorder.recordStep({ model: over.model ?? "gpt-fake", usage: { inputTokens: 5, outputTokens: 7 }, toolCallCount: 0 });
  recorder.recordTerminal("completed", null);
  return recorder.finalize({ outcome: "completed", failureReason: null });
}
const IDENTITY = { taskIndex: 1, role: "circuit-topology" as const, parentRunId: E2_RUN_ID };
function attributed(trace = specialistTrace(), decision: string | undefined = "accepted"): OrchestrationTraceDocument {
  const result = attributeSpecialistTrace(trace, IDENTITY, decision);
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail}`);
  return result.document;
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const secret = (): string => ["sk", "-", "abcdefghijklmnopqrstuvwxyz0123"].join("");
const emptyDigests = { canonicalRevisionDigest: null, schematicDigest: null, selectionDigest: null, netlistDigest: null, resourceManifestDigest: null };

// ─── [B21 E2b fix] the review's cases (9 to 16) ───────────────────────────────────────────────────────────────────────────
/** the read the circuit specialist is offered (case 4), and a clock origin */
const READ = "sirkit.validation.connectivity-verify";
const T0 = Date.parse("2026-09-27T12:00:00.000Z");
/** the server override that routes the circuit specialist to anthropic while the coordinator runs on openai */
const CIRCUIT_ON_ANTHROPIC = { [ROLE_MODELS_ENV]: JSON.stringify({ "circuit-topology": { provider: "anthropic", model: "claude-sonnet-4-5" } }) };
const FAKE_USAGE = { input_tokens: 5, output_tokens: 7 };
/** the read called in each provider's own output shape (the REAL adapters normalize it) */
const openAIRead = (): Record<string, unknown> => ({ output: [{ type: "function_call", call_id: "call-read-circuit", name: agentProviderName(READ), arguments: "{}" }], output_text: "", status: "completed", model: "gpt-fake", usage: FAKE_USAGE });
const anthropicRead = (): Record<string, unknown> => ({ content: [{ type: "tool_use", id: "toolu_read_circuit", name: agentProviderName(READ), input: {} }], stop_reason: "tool_use", model: "claude-fake", usage: FAKE_USAGE });
/** the n-th call (from 0) a fake client received for the role of `params` */
function callsPerRole(): (params: Params) => number {
  const seen = new Map<string, number>();
  return (params) => { const role = roleOf(params); const n = seen.get(role) ?? 0; seen.set(role, n + 1); return n; };
}
/** an SDK-shaped connection failure (`app/lib/llm/errors.ts` classifies it `network`: retryable) */
const connectionError = (): Error => Object.assign(new Error("Connection error."), { name: "APIConnectionError" });
const LONE_SURROGATE = String.fromCharCode(0xd800);
const RIGHT_TO_LEFT_OVERRIDE = String.fromCharCode(0x202e);
/** every control, format and line-separator character, and a lone surrogate (the orchestration record's string rule, and jsonb's refusals) */
const FORBIDDEN_TEXT = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/u;
/** what Postgres's jsonb refuses in JSON text: a NUL (22P05) and a lone surrogate (22P02) - JSON.stringify writes both as an escape */
const JSONB_REFUSED = /(?<!\\)(?:\\\\)*\\u(?:0000|d[89a-f][0-9a-f]{2})/i;
/** the in-memory repository with the production column's refusal: a commit whose payload jsonb would refuse throws, as the driver does */
class JsonbRepository extends InMemoryDurableWorkflowRepository {
  override async commit<TResult extends object = Record<string, unknown>>(request: DurableCommitRequest<TResult>): Promise<DurableCommitResult<TResult>> {
    if (JSONB_REFUSED.test(JSON.stringify(request.operations.map((operation) => operation.payload)))) throw new Error("unsupported Unicode escape sequence");
    return super.commit(request);
  }
}
/** every string and every key of a JSON value */
const allStrings = (value: unknown): string[] => typeof value === "string" ? [value] : value === null || typeof value !== "object" ? [] : Array.isArray(value) ? value.flatMap(allStrings) : Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => [key, ...allStrings(item)]);
const scriptedStep = (partial: Partial<AgentStep>): AgentStep => ({ text: "", toolCalls: [], stopReason: "completed", stop: "end_turn", usage: { inputTokens: 5, outputTokens: 7 }, model: "scripted-e2b", continuation: { provider: "openai", state: null }, ...partial });
/** a store double for the book's failure branches */
const storeThat = (append: OrchestrationTraceStore["append"]): OrchestrationTraceStore => ({ append, history: async () => [] });
/** one task's book, one loop recording `steps` steps, settled with the task's outcome (case 7's shape) */
async function settleOne(store: OrchestrationTraceStore, coordinatorRunId = E2_RUN_ID): Promise<{ recorded: number; failures: string[] }> {
  const book = specialistTraceBook({ coordinatorRunId, tasks: [{ taskId: "task-1-schematic", role: "schematic" }], scope: SCOPE, systemPromptVersion: "1.4.0", newTraceId: () => "trace-e2b-fail", store });
  const deps = { adapter: null, gateway: null, registry: REGISTRY, context: coordinatorContext(), system: AGENT_SYSTEM_PROMPT, emit: () => undefined } as unknown as AgentLoopDeps;
  const request: AgentRunRequest = { runId: specialistRunId(coordinatorRunId, "task-1-schematic"), provider: "openai", history: [], userMessage: "u", budget: { maxModelSteps: 1, maxToolCalls: 1, perToolTimeoutMs: 1, runDeadlineMs: 1, maxIdenticalCalls: 1, executionSettlementTimeoutMs: 1 } };
  await book.loop(async (loopRequest, loopDeps) => {
    loopDeps.trace!.recordRunStarted();
    loopDeps.trace!.recordStep({ model: "m", usage: { inputTokens: 1, outputTokens: 1 }, toolCallCount: 0 });
    loopDeps.trace!.recordTerminal("completed", null);
    return { runId: loopRequest.runId, status: "completed" as const, finalText: "", steps: 1, toolCalls: 0 };
  })(request, deps);
  return book.settle([{ taskId: "task-1-schematic", status: "accepted" }]);
}

vi.stubGlobal("fetch", () => { throw new Error("no network"); });

describe("[B21 E2b] the trace block: one trace document per specialist task (OD-112 as the lead read it)", () => {
  it("1. the block and its ONE rule: the closed keys (five required - the task's INDEX, never its id - `decision` optional), the scheduler's three verdicts inside OD-114's vocabulary, attached to step and tool_invocation only; the rule refuses every other kind, an extra, forbidden or missing key (the literal task id as a key included), an index outside 1..MAX_TASK_INDEX, the coordinator, another provider, a parent run id the v1 rule reads as a key, an unclean or key-shaped model, a verdict outside the three", () => {
    expect(ORCHESTRATION_TRACE_BLOCK_KEYS).toEqual(["taskIndex", "role", "providerId", "modelId", "parentRunId"]);
    expect(ORCHESTRATION_TRACE_BLOCK_OPTIONAL_KEYS).toEqual(["decision"]);
    expect(ORCHESTRATION_TRACE_ATTRIBUTED_KINDS).toEqual(["step", "tool_invocation"]);
    expect(TRACE_BLOCK_DECISIONS).toEqual(["accepted", "malformed", "escalated"]);
    expect(MAX_TASK_INDEX).toBe(32);
    for (const decision of TRACE_BLOCK_DECISIONS) expect(ORCHESTRATION_DECISIONS).toContain(decision);
    const block = { taskIndex: 1, role: "circuit-topology", providerId: "openai", modelId: "gpt-fake", parentRunId: E2_RUN_ID };
    for (const kind of ["step", "tool_invocation"]) { expect(orchestrationBlockIssue(kind, block)).toBeNull(); expect(orchestrationBlockIssue(kind, { ...block, decision: "escalated" })).toBeNull(); expect(orchestrationBlockIssue(kind, { ...block, taskIndex: MAX_TASK_INDEX, role: "verification-critic", providerId: "anthropic" })).toBeNull(); }
    const refused: Array<[string, unknown, unknown]> = [
      ["run_started", "run_started", block], ["terminal", "terminal", block], ["extra", "step", { ...block, attempt: 1 }], ["forbidden", "step", { ...block, reasoning: "x" }],
      ["the task id as a key", "step", { ...block, taskId: "task-1-circuit-topology" }],
      ["missing", "step", { ...block, parentRunId: undefined }], ["index 0", "step", { ...block, taskIndex: 0 }], ["index fraction", "step", { ...block, taskIndex: 1.5 }],
      ["index over", "step", { ...block, taskIndex: MAX_TASK_INDEX + 1 }], ["index text", "step", { ...block, taskIndex: "1" }],
      ["coordinator", "step", { ...block, role: "coordinator" }], ["provider", "step", { ...block, providerId: "gemini" }],
      ["parent as a key", "step", { ...block, parentRunId: "task-1-circuit-topology" }], ["parent grammar", "step", { ...block, parentRunId: "run with spaces" }],
      ["model control", "step", { ...block, modelId: `gpt${NUL}fake` }], ["model long", "step", { ...block, modelId: "m".repeat(101) }], ["model secret", "step", { ...block, modelId: secret() }],
      ["decision", "step", { ...block, decision: "stale" }], ["not an object", "step", "block"],
    ];
    for (const [label, kind, value] of refused) expect(orchestrationBlockIssue(kind, JSON.parse(JSON.stringify(value)) as unknown), label).not.toBeNull();
  });

  it("2. the validator: the cascade's document validates (the embedded trace by the trace's own validator); a document is refused when a step or tool invocation is unattributed or attributed twice, when a block sits on run_started, names another task index, role, provider or model, carries a verdict before the last event, when the trace's run id is not <parent>:<n>-<role> of its blocks, a key is added, a block carries a secret, or the embedded trace is forged - and it never throws on a hostile object", () => {
    const document = attributed();
    expect(validateOrchestrationTrace(document)).toEqual([]);
    expect(document.trace.runId).toBe(`${E2_RUN_ID}:1-circuit-topology`);
    expect(document.attribution.map((entry) => [entry.seq, entry.orchestration.modelId, entry.orchestration.decision ?? null])).toEqual([[2, "gpt-fake", null], [3, "gpt-fake", null], [4, "gpt-fake", "accepted"]]);
    const tamper = (edit: (doc: OrchestrationTraceDocument) => void): string[] => { const copy = clone(document); edit(copy); return validateOrchestrationTrace(copy); };
    const cases: Array<[string, (doc: OrchestrationTraceDocument) => void]> = [
      ["unattributed tool", (doc) => { doc.attribution.splice(1, 1); }],
      ["attributed twice", (doc) => { doc.attribution.splice(2, 0, clone(doc.attribution[1]!)); }],
      ["on run_started", (doc) => { doc.attribution.unshift({ seq: 1, orchestration: clone(doc.attribution[0]!.orchestration) }); }],
      ["another index", (doc) => { doc.attribution[1]!.orchestration.taskIndex = 2; }],
      ["another role", (doc) => { doc.attribution[1]!.orchestration.role = "schematic"; }],
      ["another provider", (doc) => { doc.attribution[0]!.orchestration.providerId = "anthropic"; }],
      ["another model", (doc) => { doc.attribution[1]!.orchestration.modelId = "other-model"; }],
      ["early verdict", (doc) => { doc.attribution[0]!.orchestration.decision = "accepted"; }],
      ["run id", (doc) => { for (const entry of doc.attribution) entry.orchestration.parentRunId = "run-other"; }],
      ["extra key", (doc) => { (doc as unknown as Record<string, unknown>).coordinatorTrace = null; }],
      ["secret", (doc) => { doc.attribution[0]!.orchestration.modelId = secret(); }],
      ["forged totals", (doc) => { doc.trace.terminal.steps = 9; }],
      ["schema", (doc) => { (doc as unknown as Record<string, unknown>).schema = "sirkit.orchestration-trace.v2"; }],
    ];
    for (const [label, edit] of cases) expect(tamper(edit).length, label).toBeGreaterThan(0);
    const hostile = new Proxy({}, { ownKeys: () => { throw new Error("trap"); }, getOwnPropertyDescriptor: () => { throw new Error("trap"); } });
    expect(() => validateOrchestrationTrace(hostile)).not.toThrow();
    expect(validateOrchestrationTrace(hostile).length).toBeGreaterThan(0);
    expect(validateOrchestrationTrace(clone(document))).toEqual([]);
  });

  it("3. the cascade never builds a block the validator refuses: an identity the rule refuses attributes nothing (the coordinator, index 0, a trace whose run id is another task's), a verdict outside the three is dropped (normalized), a model with a control character is named with `?` and still matches its step, a trace with no step validates with no attribution, and only the cascade's own snapshot is vouched for; a trace recorded under the LITERAL task id `<runId>:<taskId>` is refused by the unchanged v1 validator before any block is built (D21-41 stands)", () => {
    expect(attributeSpecialistTrace(specialistTrace(), { ...IDENTITY, role: "coordinator" as never })).toMatchObject({ ok: false, reason: "identity_invalid" });
    expect(attributeSpecialistTrace(specialistTrace(), { ...IDENTITY, taskIndex: 0 })).toMatchObject({ ok: false, reason: "identity_invalid" });
    expect(attributeSpecialistTrace(specialistTrace(), { ...IDENTITY, taskIndex: 2 })).toMatchObject({ ok: false, reason: "identity_invalid" });
    const stale = attributeSpecialistTrace(specialistTrace(), IDENTITY, "stale");
    expect(stale).toMatchObject({ ok: true, normalized: true });
    if (stale.ok) expect(stale.document.attribution.every((entry) => entry.orchestration.decision === undefined)).toBe(true);
    const odd = attributeSpecialistTrace(specialistTrace({ model: `gpt${BEL}fake` }), IDENTITY, "accepted");
    expect(odd).toMatchObject({ ok: true, normalized: true });
    if (odd.ok) { expect(odd.document.attribution.map((entry) => entry.orchestration.modelId)).toEqual(["gpt?fake", "gpt?fake", "gpt?fake"]); expect(validateOrchestrationTrace(odd.document)).toEqual([]); }
    const recorder = new AgentTraceRecorder({ runId: specialistTraceRunId(E2_RUN_ID, 2, "schematic"), traceId: "trace-e2b-empty", provider: "anthropic", promptVersion: "1.4.0", promptDigest: "p", registryDigest: "r", scope: SCOPE, contextDigests: emptyDigests }, new InMemoryTraceSink());
    recorder.recordRunStarted();
    recorder.recordTerminal("failed", "provider_network");
    const empty = attributeSpecialistTrace(recorder.finalize({ outcome: "failed", failureReason: "provider_network" }), { taskIndex: 2, role: "schematic", parentRunId: E2_RUN_ID }, "escalated");
    expect(empty).toMatchObject({ ok: true, normalized: true });
    if (empty.ok) { expect(empty.document.attribution).toEqual([]); expect(validateOrchestrationTrace(empty.document)).toEqual([]); }
    const document = attributed();
    expect(validatedOrchestrationTraceDigest(document)).toMatch(/^eng1-[0-9a-f]{16}$/);
    expect(validatedOrchestrationTraceDigest(clone(document))).toBeNull();
    expect(attributeSpecialistTrace({ ...specialistTrace(), model: "forged" }, IDENTITY)).toMatchObject({ ok: false, reason: "trace_invalid" });
    const literal = specialistTrace({ runId: specialistRunId(E2_RUN_ID, "task-1-circuit-topology") });
    expect(literal.recorderDiagnostics).toContain("trace_validation_failure");
    expect(attributeSpecialistTrace(literal, IDENTITY)).toMatchObject({ ok: false, reason: "trace_invalid", detail: "trace.runId: contains secret-shaped content" });
  });

  it("4. through the REAL scheduler with the book bound as the runtime binds it: ONE document per task that ran, each its own run id <runId>:<n>-<role> under its parent, its own run_started and terminal and seq from 1; the circuit specialist's READ is a tool invocation on ITS OWN trace record with the block (its index and role), the verdict on the last event; every document validates and is persisted on the durable trace record, while the run's own history is exactly the scheduler's", async () => {
    const run = await runE2Dag(["circuit-topology", "verification-critic"], { "circuit-topology": { kind: "read-then-result", toolId: "sirkit.validation.connectivity-verify" } }, { traced: true });
    expect(run.ran!.stop).toBe("completed");
    expect(run.settled).toEqual({ recorded: 2, failures: [] });
    const documents = run.book!.documents();
    expect(documents.map((document) => document.trace.runId)).toEqual([`${E2_RUN_ID}:1-circuit-topology`, `${E2_RUN_ID}:2-verification-critic`]);
    const [circuit, critic] = documents;
    expect(circuit!.trace.events.map((event) => event.kind)).toEqual(["run_started", "step", "tool_invocation", "step", "terminal"]);
    expect(circuit!.trace.events.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5]);
    const call = circuit!.trace.events.find((event) => event.kind === "tool_invocation")!;
    expect(call).toMatchObject({ kind: "tool_invocation", toolId: "sirkit.validation.connectivity-verify", operationClass: "read", callId: "call-read-circuit-topology" });
    expect(circuit!.attribution.map((entry) => entry.seq)).toEqual([2, 3, 4]);
    expect(circuit!.attribution[1]!.orchestration).toEqual({ taskIndex: 1, role: "circuit-topology", providerId: "openai", modelId: "scripted-e2", parentRunId: E2_RUN_ID });
    expect(circuit!.attribution.at(-1)!.orchestration.decision).toBe("accepted");
    expect(circuit!.trace.terminal).toMatchObject({ outcome: "completed", failureReason: null, steps: 2, toolCalls: 1 });
    expect(critic!.trace.events.map((event) => event.kind)).toEqual(["run_started", "step", "terminal"]);
    expect(critic!.attribution.at(-1)!.orchestration).toMatchObject({ taskIndex: 2, role: "verification-critic", decision: "accepted" });
    for (const document of documents) { expect(validateOrchestrationTrace(document)).toEqual([]); expect(document.trace.provider).toBe("openai"); expect(document.trace.schema).toBe(AGENT_RUN_TRACE_SCHEMA); expect(document.trace.recorderDiagnostics).toEqual([]); }
    const circuitHistory = await run.traceStore!.history(SCOPE_OF(run), `${E2_RUN_ID}:1-circuit-topology`);
    expect(circuitHistory).toHaveLength(1);
    expect(circuitHistory[0]!.record).toMatchObject({ runId: `${E2_RUN_ID}:1-circuit-topology`, parentRunId: E2_RUN_ID, taskIndex: 1, role: "circuit-topology", revision: 1 });
    expect(circuitHistory[0]!.record.document.trace.events.filter((event) => event.kind === "tool_invocation").map((event) => event.kind === "tool_invocation" ? event.toolId : null)).toEqual(["sirkit.validation.connectivity-verify"]);
    const heads = await run.repository.listHeads({ aggregateType: ORCHESTRATION_TRACE_AGGREGATE_TYPE, scope: SCOPE_OF(run) });
    expect(heads).toHaveLength(2);
    // the orchestration run's own history is exactly the scheduler's: the trace records live beside it, never in it
    expect((await run.store.history(run.scope)).map((entry) => `${entry.taskId}:${entry.record.kind}`)).toEqual(["plan:plan", "task-1-circuit-topology:request", "task-1-circuit-topology:result", "task-2-verification-critic:request", "task-2-verification-critic:result"]);
  });

  it("5. a retry's attempts share ONE document with ONE terminal (the held terminal): the first attempt's failure leaves no terminal in the document, the retry's steps follow it, and the verdict is the final one; a task that fails outright keeps its failure as its own terminal, with no attributable event and so no verdict ([B21 E2b fix: regressions-1] the earlier title claimed the verdict; case 16)", async () => {
    const run = await runE2Dag(["circuit-topology", "verification-critic"], { "circuit-topology": { kind: "throw-once", reason: "network" }, "verification-critic": { kind: "throw", reason: "insufficient_quota" } }, { traced: true });
    expect(run.settled).toEqual({ recorded: 2, failures: [] });
    const [circuit, critic] = run.book!.documents();
    expect(circuit!.trace.events.map((event) => event.kind)).toEqual(["run_started", "step", "terminal"]);
    expect(circuit!.trace.events.filter((event) => event.kind === "run_started")).toHaveLength(1);
    expect(circuit!.trace.terminal).toMatchObject({ outcome: "completed", failureReason: null });
    expect(circuit!.attribution.at(-1)!.orchestration.decision).toBe("accepted");
    expect(critic!.trace.runId).toBe(`${E2_RUN_ID}:2-verification-critic`);
    expect(critic!.trace.events.map((event) => event.kind)).toEqual(["run_started", "terminal"]);
    expect(critic!.trace.terminal).toMatchObject({ outcome: "failed", failureReason: "provider_insufficient_quota" });
    expect(critic!.attribution).toEqual([]);
  });

  it("6. the durable trace record: only a document the cascade validated is appended (a clone is `unvalidated_document`); an append is idempotent by its trace id; a re-run of the same task appends its next revision; the record names the parent run, the task's index and role (never its id); a tampered stored record is a mismatch on load; another scope sees nothing; only a durable orchestration record has a trace store", async () => {
    const repository = new InMemoryDurableWorkflowRepository();
    const store = new DurableOrchestrationTraceStore(repository);
    const document = attributed();
    expect(await store.append({ scope: SCOPE, document: clone(document), at: AT })).toMatchObject({ ok: false, code: "unvalidated_document" });
    expect(await store.append({ scope: SCOPE, document, at: AT })).toMatchObject({ ok: true, revision: 1, replayed: false });
    expect(await store.append({ scope: SCOPE, document, at: AT })).toMatchObject({ ok: true, revision: 1, replayed: true });
    // a re-run of the task is a NEW document (its own trace id): the trace id makes the append key
    const recorder = new AgentTraceRecorder({ runId: CIRCUIT_RUN, traceId: "trace-e2b-rerun", provider: "openai", promptVersion: "1.4.0", promptDigest: "p", registryDigest: "r", scope: SCOPE, contextDigests: emptyDigests }, new InMemoryTraceSink());
    recorder.recordRunStarted();
    recorder.recordStep({ model: "gpt-fake", usage: { inputTokens: 1, outputTokens: 1 }, toolCallCount: 0 });
    recorder.recordTerminal("completed", null);
    const next = attributed(recorder.finalize({ outcome: "completed", failureReason: null }));
    expect(await store.append({ scope: SCOPE, document: next, at: AT })).toMatchObject({ ok: true, revision: 2, replayed: false });
    const history = await store.history(SCOPE, CIRCUIT_RUN);
    expect(history.map((entry) => [entry.revision, entry.record.traceId, entry.record.parentRunId, entry.record.taskIndex, entry.record.role])).toEqual([[1, "trace-e2b-unit", E2_RUN_ID, 1, "circuit-topology"], [2, "trace-e2b-rerun", E2_RUN_ID, 1, "circuit-topology"]]);
    expect(Object.keys(history[0]!.record)).not.toContain("taskId");
    expect(await store.history({ ...SCOPE, projectId: "project-other" }, CIRCUIT_RUN)).toEqual([]);
    // tamper with the stored copy: every load recomputes both digests
    const heads = await repository.listHeads<{ document: OrchestrationTraceDocument }>({ aggregateType: ORCHESTRATION_TRACE_AGGREGATE_TYPE, scope: SCOPE });
    const stored = await repository.history<{ document: OrchestrationTraceDocument }>({ scope: SCOPE, aggregateType: ORCHESTRATION_TRACE_AGGREGATE_TYPE, aggregateKey: heads[0]!.aggregateKey });
    stored.at(-1)!.payload.document.attribution[0]!.orchestration.modelId = "tampered";
    const tampered = { history: async () => stored } as unknown as InMemoryDurableWorkflowRepository;
    await expect(new DurableOrchestrationTraceStore(tampered).history(SCOPE, CIRCUIT_RUN)).rejects.toThrow(/AGENT_ORCHESTRATION_TRACE_MISMATCH/);
    expect(orchestrationTraceStoreOf(new DurableOrchestrationRunStore(repository))).toBeInstanceOf(DurableOrchestrationTraceStore);
    const double: OrchestrationRunStore = { revision: async () => 0, history: async () => [], append: async () => ({ ok: true, revision: 1, recordDigest: "x", replayed: false }) };
    expect(orchestrationTraceStoreOf(double)).toBeNull();
  });

  it("7. the 256-event bound is PER DOCUMENT: a task whose loop records past the bound fills only its own document (the recorder's own capacity diagnostic), while another task's document of the same run is whole; each closes with the verdict of its task's last outcome", async () => {
    const repository = new InMemoryDurableWorkflowRepository();
    const traceStore = orchestrationTraceStoreOf(new DurableOrchestrationRunStore(repository))!;
    const book = specialistTraceBook({ coordinatorRunId: E2_RUN_ID, tasks: [{ taskId: "task-1-schematic", role: "schematic" }, { taskId: "task-2-verification-critic", role: "verification-critic" }], scope: SCOPE, systemPromptVersion: "1.4.0", newTraceId: (() => { let n = 0; return () => `trace-cap-${(n += 1)}`; })(), store: traceStore });
    const context = coordinatorContext();
    const deps = { adapter: null, gateway: null, registry: REGISTRY, context, system: AGENT_SYSTEM_PROMPT, emit: () => undefined } as unknown as AgentLoopDeps;
    const steps = (count: number) => async (request: AgentRunRequest, loopDeps: AgentLoopDeps) => {
      loopDeps.trace!.recordRunStarted();
      for (let index = 0; index < count; index += 1) loopDeps.trace!.recordStep({ model: "m", usage: { inputTokens: 1, outputTokens: 1 }, toolCallCount: 0 });
      loopDeps.trace!.recordTerminal("completed", null);
      return { runId: request.runId, status: "completed" as const, finalText: "", steps: count, toolCalls: 0 };
    };
    // the loop's request carries the scheduler's specialist run id (`<runId>:<taskId>`); the book maps it to the task's index and role
    const request = (taskId: string): AgentRunRequest => ({ runId: specialistRunId(E2_RUN_ID, taskId), provider: "openai", history: [], userMessage: "u", budget: { maxModelSteps: 1, maxToolCalls: 1, perToolTimeoutMs: 1, runDeadlineMs: 1, maxIdenticalCalls: 1, executionSettlementTimeoutMs: 1 } });
    await book.loop(steps(300))(request("task-1-schematic"), deps);
    await book.loop(steps(3))(request("task-2-verification-critic"), deps);
    expect(await book.settle([{ taskId: "task-1-schematic", status: "escalated" }, { taskId: "task-1-schematic", status: "accepted" }, { taskId: "task-2-verification-critic", status: "malformed" }])).toEqual({ recorded: 2, failures: [] });
    const [full, small] = book.documents();
    expect(full!.trace.runId).toBe(`${E2_RUN_ID}:1-schematic`);
    expect(full!.trace.events).toHaveLength(TRACE_BOUNDS.maxEvents);
    expect(full!.trace.recorderDiagnostics).toContain("trace_event_capacity_reached");
    expect(full!.attribution).toHaveLength(TRACE_BOUNDS.maxEvents - 2);
    expect(full!.attribution.at(-1)!.orchestration.decision).toBe("accepted");
    expect(small!.trace.events.map((event) => event.kind)).toEqual(["run_started", "step", "step", "step", "terminal"]);
    expect(small!.trace.recorderDiagnostics).toEqual([]);
    expect(small!.attribution.at(-1)!.orchestration.decision).toBe("malformed");
  });

  it("8. the nine B11-scanned files are byte-identical to HEAD and carry no orchestration identifier; the v1 trace contract is unchanged - a block placed INSIDE an event is refused as an unknown key, the provider literal and the outcome classes stand - so the block can only ride BESIDE the events; no scanned file imports anything under orchestration", () => { // [B21 F, 2026-09-28] E2b's title: since B21-F eight of the nine are byte-identical to HEAD and the replay capsule's hash is F's (SCANNED_AT_HEAD, its reviewed pin move); the closeout retitles it
    expect([...B11_SCANNED_FILES].sort()).toEqual(Object.keys(SCANNED_AT_HEAD).sort());
    for (const file of B11_SCANNED_FILES) {
      const source = readFileSync(join(ROOT, file));
      expect(createHash("sha256").update(source).digest("hex"), file).toBe(SCANNED_AT_HEAD[file]);
      const text = source.toString("utf8");
      expect(text, file).not.toMatch(ORCHESTRATION_IDENTIFIER_PATTERN);
      expect(text, file).not.toMatch(/modelcontextprotocol|mcpServer|spawnAgent|multiAgent/i);
      expect(text, file).not.toMatch(/from "[^"]*orchestration/);
    }
    expect(readFileSync(join(ROOT, "app/lib/agent/trace-recorder.ts"), "utf8")).toContain('provider: "openai" | "anthropic";');
    expect(TRACE_OUTCOME_CLASSES).toEqual(["read", "proposal", "proposal_blocked", "refused", "view_command", "layout_candidate", "execution_grant", "external_observation"]);
    const trace = clone(specialistTrace());
    (trace.events[1] as unknown as Record<string, unknown>).orchestration = { taskIndex: 1 };
    expect(validateAgentRunTrace(trace).some((issue) => issue.includes("orchestration: unknown key"))).toBe(true);
    const provider = clone(specialistTrace()) as unknown as Record<string, unknown>;
    provider.provider = "openai:1-circuit-topology";
    expect(validateAgentRunTrace(provider)).toContain("trace.provider: unknown provider");
    expect(ORCHESTRATION_TRACE_SCHEMA).toBe("sirkit.orchestration-trace.v1");
    const own = readFileSync(join(ROOT, "app/lib/agent/orchestration/trace-attribution.ts"), "utf8");
    for (const file of B11_SCANNED_FILES) expect(own.includes(file.slice(file.lastIndexOf("/") + 1)), file).toBe(false);
  });

  it("9. [B21 E2b fix: tests-1] a specialist on ANOTHER provider than the coordinator: through the REAL scheduler with the provider layer (the REAL adapters over fake clients), the role the server override routes to anthropic records its OWN document on anthropic - the trace's provider and every block's `providerId` anthropic, each block naming the model anthropic reported, its read a tool invocation on it - while the other task's document of the same run stays on openai with openai's model", async () => {
    resetAdmissionControl();
    try {
      const nth = callsPerRole();
      const openai = fakeOpenAI(answersOpenAI);
      const anthropic = fakeAnthropic((params) => (nth(params) === 0 ? anthropicRead() : anthropicResultMessage(roleOf(params))));
      const { providers } = fakeProviders(openai, anthropic, { env: CIRCUIT_ON_ANTHROPIC });
      const run = await runE2Dag(["circuit-topology", "verification-critic"], {}, { traced: true, providers });
      expect(run.ran!.tasks.map((task) => [task.role, task.status, task.provider])).toEqual([["circuit-topology", "accepted", "anthropic"], ["verification-critic", "accepted", "openai"]]);
      expect(run.settled).toEqual({ recorded: 2, failures: [] });
      const [circuit, critic] = run.book!.documents();
      expect(circuit!.trace.provider).toBe("anthropic");
      expect(circuit!.trace.events.map((event) => event.kind)).toEqual(["run_started", "step", "tool_invocation", "step", "terminal"]);
      expect(circuit!.trace.events.find((event) => event.kind === "tool_invocation")).toMatchObject({ toolId: READ, callId: "toolu_read_circuit" });
      expect(circuit!.attribution.map((entry) => [entry.orchestration.providerId, entry.orchestration.modelId])).toEqual([["anthropic", "claude-fake"], ["anthropic", "claude-fake"], ["anthropic", "claude-fake"]]);
      expect(circuit!.attribution.at(-1)!.orchestration.decision).toBe("accepted");
      expect(critic!.trace.provider).toBe("openai");
      expect(critic!.attribution.map((entry) => [entry.orchestration.providerId, entry.orchestration.modelId, entry.orchestration.decision ?? null])).toEqual([["openai", "gpt-fake", "accepted"]]);
      for (const document of [circuit!, critic!]) expect(validateOrchestrationTrace(document)).toEqual([]);
      const stored = await run.traceStore!.history(SCOPE_OF(run), `${E2_RUN_ID}:1-circuit-topology`);
      expect(stored.map((entry) => [entry.record.document.trace.provider, entry.record.document.attribution[0]!.orchestration.providerId])).toEqual([["anthropic", "anthropic"]]);
    } finally {
      resetAdmissionControl();
    }
  });

  it("10. [B21 E2b fix: security-3, coverage-3, tests-4] a retry the scheduler routes to ANOTHER provider (reachable: every attempt is routed again): the circuit specialist's role is on anthropic by the server override and anthropic's breaker is open, so attempt 0 runs on the compatible fallback openai - a step and a read - and fails `provider_network` as the breaker's window elapses; attempt 1 runs on anthropic and is accepted. The task gets TWO documents under its one per-task run id (revisions 1 and 2 of its durable record), each on ONE provider: the openai document closed at the switch with its failed terminal and NO verdict, the anthropic document with the accepted verdict on anthropic's own step - no attempt runs untraced, no verdict is stamped on another provider's events, nothing is reported as lost", async () => {
    resetAdmissionControl();
    try {
      let clock = T0 + 1;
      await failOnce("anthropic", "rate_limit", T0); // anthropic's breaker opens for its 60-second window
      const nth = callsPerRole();
      const openai = fakeOpenAI((params) => {
        if (roleOf(params) !== "circuit-topology") return openAIResultResponse(roleOf(params));
        if (nth(params) === 0) return openAIRead();
        clock += 61_000; // the window elapses while the fallback's call is in flight
        return connectionError();
      });
      const anthropic = fakeAnthropic((params) => anthropicResultMessage(roleOf(params)));
      const { providers } = fakeProviders(openai, anthropic, { env: CIRCUIT_ON_ANTHROPIC });
      const run = await runE2Dag(["circuit-topology"], {}, { traced: true, providers, now: () => clock });
      expect(run.ran!.tasks.map((task) => [task.attempt, task.status, task.provider, task.route?.fallbackFrom?.provider ?? null])).toEqual([[0, "escalated", "openai", "anthropic"], [1, "accepted", "anthropic", null]]);
      expect(run.settled).toEqual({ recorded: 2, failures: [] });
      const documents = run.book!.documents();
      expect(documents.map((document) => [document.trace.runId, document.trace.provider])).toEqual([[`${E2_RUN_ID}:1-circuit-topology`, "openai"], [`${E2_RUN_ID}:1-circuit-topology`, "anthropic"]]);
      const [fallback, primary] = documents;
      for (const document of documents) {
        expect(validateOrchestrationTrace(document)).toEqual([]);
        for (const entry of document.attribution) expect(entry.orchestration.providerId).toBe(document.trace.provider);
      }
      expect(fallback!.trace.events.map((event) => event.kind)).toEqual(["run_started", "step", "tool_invocation", "terminal"]);
      expect(fallback!.trace.terminal).toMatchObject({ outcome: "failed", failureReason: "provider_network" });
      expect(fallback!.attribution.map((entry) => [entry.orchestration.modelId, entry.orchestration.decision ?? null])).toEqual([["gpt-fake", null], ["gpt-fake", null]]);
      expect(primary!.trace.events.map((event) => event.kind)).toEqual(["run_started", "step", "terminal"]);
      expect(primary!.trace.terminal).toMatchObject({ outcome: "completed", failureReason: null });
      expect(primary!.attribution.map((entry) => [entry.orchestration.providerId, entry.orchestration.modelId, entry.orchestration.decision ?? null])).toEqual([["anthropic", "claude-fake", "accepted"]]);
      const history = await run.traceStore!.history(SCOPE_OF(run), `${E2_RUN_ID}:1-circuit-topology`);
      expect(history.map((entry) => [entry.revision, entry.record.document.trace.provider, entry.record.traceId])).toEqual([[1, "openai", fallback!.trace.traceId], [2, "anthropic", primary!.trace.traceId]]);
    } finally {
      resetAdmissionControl();
    }
  });

  it("11. [B21 E2b fix: tests-4] every way a finished document can fail to be recorded is ONE named failure, never silent: a store that refuses (`stale_revision`, `invalid_record`), a store that throws (`trace_store_unavailable`) and a cascade refusal (a trace the unchanged v1 validator refuses: `trace_invalid`, nothing appended) - each the task by role and index with its closed reason, never the store's message or the driver's", async () => {
    const refusing = (code: "stale_revision" | "invalid_record" | "unvalidated_document") => storeThat(async () => ({ ok: false, code, message: "a store detail that stays in process" }));
    expect(await settleOne(refusing("stale_revision"))).toEqual({ recorded: 0, failures: ["schematic task 1: stale_revision"] });
    expect(await settleOne(refusing("invalid_record"))).toEqual({ recorded: 0, failures: ["schematic task 1: invalid_record"] });
    expect(await settleOne(storeThat(async () => { throw new Error("driver down: db-internal-7"); }))).toEqual({ recorded: 0, failures: ["schematic task 1: trace_store_unavailable"] });
    const appended: unknown[] = [];
    const accepting = storeThat(async (input) => { appended.push(input); return { ok: true, revision: 1, recordDigest: "eng1-0000000000000000", replayed: false }; });
    expect(await settleOne(accepting)).toEqual({ recorded: 1, failures: [] });
    // a coordinator run id the v1 validator reads as a key: the finished trace is refused by the cascade before any append
    expect(await settleOne(accepting, `run-${secret()}`)).toEqual({ recorded: 0, failures: ["schematic task 1: trace_invalid"] });
    expect(appended).toHaveLength(1);
  });

  it("12. [B21 E2b fix: tests-3] every load recomputes BOTH digests: a stored record whose `at`, `traceId`, document digest or record digest was altered - each leaving the document itself valid, so only a digest can catch it - is AGENT_ORCHESTRATION_TRACE_MISMATCH, and the untouched record loads", async () => {
    const repository = new InMemoryDurableWorkflowRepository();
    const store = new DurableOrchestrationTraceStore(repository);
    expect(await store.append({ scope: SCOPE, document: attributed(), at: AT })).toMatchObject({ ok: true, revision: 1 });
    const heads = await repository.listHeads({ aggregateType: ORCHESTRATION_TRACE_AGGREGATE_TYPE, scope: SCOPE });
    const stored = await repository.history<OrchestrationTraceRecord>({ scope: SCOPE, aggregateType: ORCHESTRATION_TRACE_AGGREGATE_TYPE, aggregateKey: heads[0]!.aggregateKey });
    const served = (records: Array<DurableAggregateRecord<OrchestrationTraceRecord>>) => new DurableOrchestrationTraceStore({ history: async () => records } as unknown as InMemoryDurableWorkflowRepository);
    expect(await served(structuredClone(stored)).history(SCOPE, CIRCUIT_RUN)).toHaveLength(1);
    const tampers: Array<[string, (raw: DurableAggregateRecord<OrchestrationTraceRecord>) => void]> = [
      ["at", (raw) => { raw.payload.at = "2026-09-27T12:00:01.000Z"; }],
      ["traceId", (raw) => { raw.payload.traceId = "trace-e2b-other"; }],
      ["document digest", (raw) => { raw.payload.digest = "eng1-0000000000000000"; }],
      ["record digest", (raw) => { raw.recordDigest = "eng1-0000000000000000"; }],
    ];
    for (const [label, tamper] of tampers) {
      const copy = structuredClone(stored);
      tamper(copy.at(-1)!);
      expect(validateOrchestrationTrace(copy.at(-1)!.payload.document), label).toEqual([]);
      await expect(served(copy).history(SCOPE, CIRCUIT_RUN), label).rejects.toThrow(/AGENT_ORCHESTRATION_TRACE_MISMATCH/);
    }
  });

  it("13. [B21 E2b fix: regressions-2] the durable trace record is BOUND to its scope, as the orchestration record's requests are: a document whose trace names one scope is refused under another (`invalid_record`, nothing written), and a record whose document's trace names another scope than the one it is loaded under is a mismatch on load", async () => {
    const repository = new InMemoryDurableWorkflowRepository();
    const store = new DurableOrchestrationTraceStore(repository);
    const document = attributed();
    expect(document.trace.scope).toEqual(SCOPE);
    for (const other of [{ ...SCOPE, tenantId: "tenant-other" }, { ...SCOPE, projectId: "project-other" }, { ...SCOPE, branchId: "branch-other" }]) {
      expect(await store.append({ scope: other, document, at: AT })).toMatchObject({ ok: false, code: "invalid_record" });
      expect(await repository.listHeads({ aggregateType: ORCHESTRATION_TRACE_AGGREGATE_TYPE, scope: other })).toEqual([]);
    }
    expect(await store.append({ scope: SCOPE, document, at: AT })).toMatchObject({ ok: true, revision: 1 });
    const heads = await repository.listHeads({ aggregateType: ORCHESTRATION_TRACE_AGGREGATE_TYPE, scope: SCOPE });
    const stored = await repository.history<OrchestrationTraceRecord>({ scope: SCOPE, aggregateType: ORCHESTRATION_TRACE_AGGREGATE_TYPE, aggregateKey: heads[0]!.aggregateKey });
    const served = new DurableOrchestrationTraceStore({ history: async () => structuredClone(stored) } as unknown as InMemoryDurableWorkflowRepository);
    expect(await served.history(SCOPE, CIRCUIT_RUN)).toHaveLength(1);
    await expect(served.history({ ...SCOPE, tenantId: "tenant-other" }, CIRCUIT_RUN)).rejects.toThrow(/AGENT_ORCHESTRATION_TRACE_MISMATCH/);
  });

  it("14. [B21 E2b fix: security-1] model- or provider-controlled text can neither keep a specialist's record from being written nor persist a hostile character: a specialist whose provider reports a model id holding a NUL, a lone surrogate and a bidirectional override, and asks for an unknown tool whose name and call id hold them too - through the REAL scheduler, loop and recorder, against a repository that refuses what jsonb refuses - IS recorded: each such character a `?` with the recorder's own `trace_input_normalized`, no string or key of the stored record holding one; and the validator refuses a document holding one anywhere", async () => {
    const NASTY = `${NUL}${LONE_SURROGATE}${RIGHT_TO_LEFT_OVERRIDE}`;
    const script: Record<string, E2Behaviour> = { "circuit-topology": { kind: "call-unknown" } };
    const inner = new E2Adapter(script);
    const hostile: ProviderAgentAdapter = {
      provider: "openai",
      start: async (input) => { const step = await inner.start(input); return { ...step, model: `gpt${NASTY}fake`, toolCalls: step.toolCalls.map((call) => ({ ...call, callId: `call${NASTY}`, providerName: `sirkit_release${NASTY}` })) }; },
      continueWith: async (input) => ({ ...(await inner.continueWith(input)), model: `gpt${NASTY}fake` }),
    };
    const run = await runE2Dag(["circuit-topology"], script, { traced: true, adapter: hostile, repository: new JsonbRepository() });
    expect(run.ran!.tasks.map((task) => task.status)).toEqual(["accepted"]);
    expect(run.settled).toEqual({ recorded: 1, failures: [] });
    const history = await run.traceStore!.history(SCOPE_OF(run), `${E2_RUN_ID}:1-circuit-topology`);
    expect(history).toHaveLength(1);
    const record = history[0]!.record;
    expect(allStrings(record).filter((text) => FORBIDDEN_TEXT.test(text))).toEqual([]);
    expect(JSONB_REFUSED.test(JSON.stringify(record))).toBe(false);
    expect(record.document.trace.model).toBe("gpt???fake");
    expect(record.document.trace.warnings).toContain('The model requested unknown tool "sirkit_release???" — refused.');
    expect(record.document.trace.recorderDiagnostics).toContain("trace_input_normalized");
    expect(record.document.attribution.map((entry) => entry.orchestration.modelId)).toEqual(["gpt???fake", "gpt???fake"]);
    expect(validateOrchestrationTrace(record.document)).toEqual([]);
    for (const character of [NUL, LONE_SURROGATE, RIGHT_TO_LEFT_OVERRIDE]) {
      const copy = clone(record.document);
      copy.trace.warnings[0] = `a line${character}`;
      expect(validateAgentRunTrace(copy.trace), character.charCodeAt(0).toString(16)).toEqual([]);
      expect(validateOrchestrationTrace(copy).some((issue) => issue.startsWith("document.trace.warnings[0]: ")), character.charCodeAt(0).toString(16)).toBe(true);
    }
  });

  it("15. [B21 E2b fix: coverage-2] a specialist's calls the loop refuses BEFORE they run - an unknown tool, arguments that are not JSON, a repeated call - are each ONE closed line on its task's OWN document (the registry's tool id or none, and the closed status: never a task id, never the arguments), beside the loop's own unknown-tool line and the reads that did run; the coordinator's stream still carries the scheduler's bounded refusal lines", async () => {
    let offered: readonly ProviderToolDeclaration[] = [];
    const refusing: ProviderAgentAdapter = {
      provider: "openai",
      start: async (input) => {
        offered = input.tools;
        const read = input.tools.find((tool) => tool.toolId === READ)!.providerName;
        return scriptedStep({ stopReason: "tool_use", toolCalls: [
          { callId: "call-a", providerName: "sirkit_release_now", argumentsText: "{}" }, { callId: "call-b", providerName: read, argumentsText: "{not json" },
          { callId: "call-c", providerName: read, argumentsText: "{}" }, { callId: "call-d", providerName: read, argumentsText: "{}" }, { callId: "call-e", providerName: read, argumentsText: "{}" },
        ] });
      },
      continueWith: async (input: { results: readonly AgentToolResult[]; tools: readonly ProviderToolDeclaration[] }) => scriptedStep(answer(resultDocument("circuit-topology"), input.tools.length > 0 ? input.tools : offered)),
    };
    const run = await runE2Dag(["circuit-topology"], {}, { traced: true, adapter: refusing });
    expect(run.ran!.tasks.map((task) => task.status)).toEqual(["accepted"]);
    expect(run.settled).toEqual({ recorded: 1, failures: [] });
    const [document] = run.book!.documents();
    expect(document!.trace.events.filter((event) => event.kind === "tool_invocation").map((event) => (event.kind === "tool_invocation" ? event.callId : null))).toEqual(["call-c", "call-d"]);
    expect(document!.trace.warnings.filter((line) => !line.startsWith("Tool sirkit."))).toEqual([
      'The model requested unknown tool "sirkit_release_now" — refused.',
      "A tool call was refused before it ran: an unknown tool (unknown_tool).",
      `A tool call was refused before it ran: ${READ} (invalid_input).`,
      `A tool call was refused before it ran: ${READ} (repeated_call).`,
    ]);
    expect(allStrings(document).filter((text) => /task-\d+-/.test(text))).toEqual([]);
    expect(validateOrchestrationTrace(document)).toEqual([]);
    expect(run.events.filter((event) => event.type === "warning").map((event) => (event.type === "warning" ? event.message : "")).filter((line) => line.includes(" refused: "))).toEqual([
      "Orchestration: specialist circuit-topology (task task-1-circuit-topology, attempt 0) tool (unknown) refused: unknown_tool.",
      `Orchestration: specialist circuit-topology (task task-1-circuit-topology, attempt 0) tool ${READ} refused: invalid_input.`,
      `Orchestration: specialist circuit-topology (task task-1-circuit-topology, attempt 0) tool ${READ} refused: repeated_call.`,
    ]);
  });

  it("16. [B21 E2b fix: regressions-1, coverage-1, tests-2] the verdict a document carries, as it is: `escalated` on a task that recorded a step (the provider cut its turn off, `max_tokens`) sits on its last attributed event beside its completed terminal; a task that fails BEFORE its first step (a provider outage, no credits, a meter refusal) has no step or tool invocation to carry a verdict or a model - its document keeps the failure as its terminal and carries NEITHER (the cascade drops the verdict and says `normalized`; the trace's model is empty: none was reported), while the orchestration record keeps the verdict as the task's dissent", async () => {
    const run = await runE2Dag(["circuit-topology", "verification-critic"], { "circuit-topology": { kind: "stop", stop: "max_tokens" }, "verification-critic": { kind: "throw", reason: "insufficient_quota" } }, { traced: true });
    expect(run.ran!.tasks.map((task) => [task.role, task.status])).toEqual([["circuit-topology", "escalated"], ["verification-critic", "escalated"]]);
    expect(run.settled).toEqual({ recorded: 2, failures: [] });
    const [circuit, critic] = run.book!.documents();
    expect(circuit!.trace.events.map((event) => event.kind)).toEqual(["run_started", "step", "terminal"]);
    expect(circuit!.trace.terminal).toMatchObject({ outcome: "completed", failureReason: null });
    expect(circuit!.attribution.map((entry) => entry.orchestration.decision ?? null)).toEqual(["escalated"]);
    expect(critic!.trace.events.map((event) => event.kind)).toEqual(["run_started", "terminal"]);
    expect(critic!.trace.terminal).toMatchObject({ outcome: "failed", failureReason: "provider_insufficient_quota" });
    expect(critic!.trace.model).toBe("");
    expect(critic!.attribution).toEqual([]);
    expect(attributeSpecialistTrace(critic!.trace, { taskIndex: 2, role: "verification-critic", parentRunId: E2_RUN_ID }, "escalated")).toMatchObject({ ok: true, normalized: true });
    const dissent = (await run.store.history(run.scope)).filter((entry) => entry.taskId === "task-2-verification-critic").map((entry) => (entry.record.kind === "dissent" ? `dissent:${entry.record.decision}` : entry.record.kind));
    expect(dissent).toEqual(["request", "dissent:escalated"]);
  });
});

function SCOPE_OF(run: { context: { tenantId: string; projectId: string; branchId: string } }): { tenantId: string; projectId: string; branchId: string } {
  return { tenantId: run.context.tenantId, projectId: run.context.projectId, branchId: run.context.branchId };
}
