/**
 * [B24-C3] The four stored trace kinds as their own producers build them - never hand-built documents - for b24-c3-trace-read and
 * b24-c3-trace-read-pglite: a run trace through B11's recorder (`AgentTraceRecorder`), an attribution through B24-C2's collector
 * (`buildRunTraceAttribution`), a call record of B24-C1's closed shape (`validateLlmCallRecord` admits it) and a specialist trace through
 * B21-E2b's cascade (`attributeSpecialistTrace`). Nothing here touches a database, a file or the network. Not a test file.
 */
import { DEFAULT_AGENT_BUDGET, type AgentRunEvent } from "../../agent/contracts";
import { attributeSpecialistTrace, specialistTraceRunId, type OrchestrationTraceDocument } from "../../agent/orchestration/trace-attribution";
import type { SpecialistRole } from "../../agent/orchestration/contracts";
import type { AgentRunTrace } from "../../agent/trace";
import { AgentTraceRecorder, InMemoryTraceSink, type AgentTraceSink } from "../../agent/trace-recorder";
import type { DurableWorkflowScope } from "../../durable-workflow/types";
import { LLM_CALL_RECORD_SCHEMA, type LlmCallRecord } from "../../observability/llm-call-record";
import { buildRunTraceAttribution, createRunAttributionCollector } from "../../observability/run-attribution-collector";
import type { RunTraceAttribution } from "../../observability/run-trace-attribution";

export const C3_SCOPE: DurableWorkflowScope = Object.freeze({ tenantId: "tenant-b24c3", projectId: "project-b24c3", branchId: "main" });
export const C3_OTHER_SCOPE: DurableWorkflowScope = Object.freeze({ tenantId: "tenant-b24c3-other", projectId: "project-b24c3-other", branchId: "main" });
export const C3_AT = "2026-10-09T12:00:00.000Z";
export const C3_PARENT_RUN = "run-b24c3-parent";
const TRUSTED = { principalId: "user-b24c3", role: "pcb_editor" as const, membershipRevision: "mbr1-eng1-0123456789abcdef0123456789abcdef", authClass: "local_dev" as const, correlationId: "corr-b24c3-0001" };
const SALT = new Uint8Array(32).fill(9);

/** A finalized run trace built by the real recorder: run_started, `steps` steps, the given warnings, the terminal. */
export function c3Trace(runId: string, traceId: string, options: { scope?: DurableWorkflowScope; steps?: number; warnings?: readonly string[]; sink?: AgentTraceSink } = {}): AgentRunTrace {
  let clock = 3_000;
  const recorder = new AgentTraceRecorder({
    runId, traceId, provider: "openai", promptVersion: "b24-c3", promptDigest: "eng1-b24c3prompt0000", registryDigest: "eng1-b24c3registry00", scope: options.scope ?? C3_SCOPE,
    contextDigests: { canonicalRevisionDigest: null, schematicDigest: null, selectionDigest: null, netlistDigest: null, resourceManifestDigest: null },
  }, options.sink ?? new InMemoryTraceSink(), () => (clock += 5));
  recorder.recordRunStarted();
  for (let step = 0; step < (options.steps ?? 1); step += 1) recorder.recordStep({ model: "scripted", usage: { inputTokens: 3, outputTokens: 5 }, toolCallCount: 0 });
  for (const warning of options.warnings ?? []) recorder.recordWarning(warning);
  return recorder.finalize({ outcome: "completed", failureReason: null });
}

/** An attribution document built from a real recorder's trace through B24-C2's collector (its own validator admits it). */
export function c3Attribution(runId: string, traceId: string, scope: DurableWorkflowScope = C3_SCOPE): RunTraceAttribution {
  const collector = createRunAttributionCollector({ provider: "openai", budget: DEFAULT_AGENT_BUDGET, clock: (() => { let t = 0; return () => (t += 3); })() });
  const wrapped = collector.wrapSink({ sink: new InMemoryTraceSink(), factoryFailed: false });
  collector.observeEmit({ type: "text_delta", runId, text: "the answer", phase: "final" } as AgentRunEvent);
  collector.observeEmit({ type: "run_completed", runId, finalText: "the answer", steps: 1, toolCalls: 0, usage: { inputTokens: 3, outputTokens: 5 }, model: "scripted" } as AgentRunEvent);
  c3Trace(runId, traceId, { scope, sink: wrapped.sink });
  const document = buildRunTraceAttribution({
    observations: collector.observations(), scope, trusted: TRUSTED, userMessage: "Move R3 2 mm to the right.", planKind: "single", toolsetDeclarations: [], readTraces: [], deploymentConfigurationDigest: "eng1-0123456789abcdef",
    cost: { status: "unpriced", reason: "no_owner_price_table" }, salt: SALT, budget: DEFAULT_AGENT_BUDGET, retryCeiling: 2,
  });
  if (document === null) throw new Error("b24-c3 fixture: no validated trace was captured");
  return document;
}

/** One call record of the closed shape (`n` numbers the call id); every field inside the validator's bounds. */
export function c3CallRecord(n: number, over: Partial<LlmCallRecord> = {}): LlmCallRecord {
  const id = n.toString(16).padStart(12, "0");
  return { schema: LLM_CALL_RECORD_SCHEMA, callId: `llmc-00000000-0000-4000-8000-${id}`, requestRef: `llmr-00000000-0000-4000-8000-${id}`, seq: 1, routeId: "/api/schematic/review", method: "POST", provider: "openai", model: "scripted", kind: "generate", inputTokens: 3, outputTokens: 5, latencyMs: 12, outcome: "completed", startedAt: C3_AT, ...over };
}

/** One specialist task's finalized trace, attributed through B21-E2b's cascade (the store admits only a document it validated). */
export function c3SpecialistTrace(taskIndex: number, role: SpecialistRole, options: { parentRunId?: string; scope?: DurableWorkflowScope; traceId?: string; decision?: string } = {}): OrchestrationTraceDocument {
  const parentRunId = options.parentRunId ?? C3_PARENT_RUN;
  const trace = c3Trace(specialistTraceRunId(parentRunId, taskIndex, role), options.traceId ?? `trace-b24c3-task-${taskIndex}`, { scope: options.scope ?? C3_SCOPE });
  const attributed = attributeSpecialistTrace(trace, { taskIndex, role, parentRunId }, options.decision ?? "accepted");
  if (!attributed.ok) throw new Error(`b24-c3 fixture: ${attributed.reason}: ${attributed.detail}`);
  return attributed.document;
}
