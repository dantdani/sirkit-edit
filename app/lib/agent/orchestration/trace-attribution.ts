/**
 * [B21 E2b] The trace block (OD-112 as the lead read it, D21-41; D21-11's trace half, D21-3's calls): ONE trace document PER
 * SPECIALIST TASK, each a complete, unchanged `sirkit.agent-run-trace.v1` document of its own - its own run id
 * `<coordinatorRunId>:<n>-<role>` (the task's INDEX and role), its own provider (the one the task's route ran on, inside the trace's
 * closed provider vocabulary), its own 256-event and 32-warning bounds - carried in an ORCHESTRATION TRACE document that attaches an
 * optional closed `orchestration` block `{ taskIndex, role, providerId, modelId, parentRunId, decision? }` to every `step` and
 * `tool_invocation` event of it by sequence number. The block and the run id carry the task's index and role, NEVER the literal task
 * id `task-<n>-<role>`: the v1 validator applies the redaction authority's unanchored OpenAI-key pattern (kept unanchored on purpose
 * since B19-D) to every string of a trace, and `task-<n>-...` reads as a key there (D21-41) - so the task id is reconstructed from
 * the index and the role (`specialistTaskId`, the inverse `specialistTaskIdentity`; the scheduler's `planTasks` mints exactly
 * `task-<n>-<role>`) and no shared rule is narrowed. The coordinator's trace keeps its closed provider literal and gains nothing;
 * the trace contract, its validator and its recorder are used as they are and never edited - the block rides BESIDE the events it
 * attributes, never inside them, so no scanned trace module names an orchestration identifier (D21-27, OD-113).
 *
 * The external precedent's shape (B20-A4): ONE rule (`orchestrationBlockIssue`) judges a block - closed keys, the index a positive
 * integer within the plan record's bound, the role by the closed role list (a specialist's: never the coordinator), the parent run
 * id by the orchestration id grammar and the v1 trace's own secret rule, the provider by the trace's two ids, the model a bounded,
 * clean id, the decision (optional) by the scheduler's three verdicts on an attempt, every key name against the orchestration
 * denylist - and both the validator (`validateOrchestrationTrace`) and the attribution cascade (`attributeSpecialistTrace`) use it,
 * so the cascade never builds a block the validator refuses; a document the validator refuses is never stored. The validator also
 * runs the trace's own validator over the embedded trace, requires EVERY step and tool invocation to be attributed exactly once and
 * nothing else, one identity across the document (the trace's run id IS `<parentRunId>:<taskIndex>-<role>` of its blocks, the
 * provider IS the trace's), each step's block naming that step's model and each tool invocation's the model of the step that asked
 * for it, the decision on the last attributed event only, and the attribution passing the same secret rule as the trace.
 *
 * The book (`specialistTraceBook`) wraps the injected loop: a specialist's loop records into its task's own recorder (its terminal
 * held across a retry's attempts on ONE provider; an attempt on another opens the task's next document), the task's last document is
 * closed once the scheduler returns with the verdict of its last outcome (on its last step or tool invocation; without one, none), each
 * is appended to the durable trace aggregate on the orchestration record's own repository - a specialist's tool CALLS (its gateway
 * invocations, and a closed line per call refused before it ran) on its own trace record, OD-111's carrier for D21-3. A failure is a
 * closed reason for the caller, never silent. No chain of thought: a trace holds identities, digests and closed classes.
 */
import { AgentTraceRecorder, InMemoryTraceSink } from "../trace-recorder";
import { TRACE_BOUNDS, findSecretShapedPath, validateAgentRunTrace, type AgentRunTrace, type AgentTraceEvent, type TraceTerminalOutcome } from "../trace";
import { capturePlainJson } from "../plain-capture";
import { containsSecretShapedText } from "../redaction";
import { engineeringDigest } from "../../engineering/stable";
import { durableAggregateIdentity, durableScopeKey, durableWorkflowId } from "../../durable-workflow/stable";
import type { DurableAggregateRecord, DurableWorkflowRepository, DurableWorkflowScope } from "../../durable-workflow/types";
import type { AgentLoopDeps } from "../loop";
import type { AgentRunRequest, AgentRunResult } from "../contracts";
import type { LLMProviderId } from "../../llm/types";
import { ORCHESTRATION_BOUNDS, SPECIALIST_ROLES, isForbiddenOrchestrationKeyName, isOrchestrationId, isOrchestrationTimestamp, type SpecialistRole } from "./contracts";

export const ORCHESTRATION_TRACE_SCHEMA = "sirkit.orchestration-trace.v1" as const;
/** The block's required keys (the task's INDEX, never its id), and its one optional key. */
export const ORCHESTRATION_TRACE_BLOCK_KEYS = Object.freeze(["taskIndex", "role", "providerId", "modelId", "parentRunId"] as const);
export const ORCHESTRATION_TRACE_BLOCK_OPTIONAL_KEYS = Object.freeze(["decision"] as const);
/** The scheduler's verdict on the attempt a document ends with (the merge's later verdicts are records of the run, never here). */
export const TRACE_BLOCK_DECISIONS = Object.freeze(["accepted", "malformed", "escalated"] as const);
export type TraceBlockDecision = (typeof TRACE_BLOCK_DECISIONS)[number];
/** The events a block is attached to: a model step and a tool invocation (the task's calls). */
export const ORCHESTRATION_TRACE_ATTRIBUTED_KINDS = Object.freeze(["step", "tool_invocation"] as const);
export const ORCHESTRATION_TRACE_DOCUMENT_KEYS = Object.freeze(["schema", "trace", "attribution"] as const);
export const ORCHESTRATION_TRACE_ENTRY_KEYS = Object.freeze(["seq", "orchestration"] as const);
export const ORCHESTRATION_TRACE_BOUNDS = Object.freeze({
  /** the trace's own serialized bound plus its at most 256 attributions */
  maxSerializedChars: TRACE_BOUNDS.maxSerializedChars + 200_000,
  maxIssues: TRACE_BOUNDS.maxValidationIssues,
  maxModelChars: TRACE_BOUNDS.maxModelChars,
});
/** The highest task index: the plan record's bound on its tasks (a plan never holds more), so no task index exceeds it. */
export const MAX_TASK_INDEX = ORCHESTRATION_BOUNDS.maxArrayEntries;

export interface OrchestrationTraceBlock { taskIndex: number; role: SpecialistRole; providerId: LLMProviderId; modelId: string; parentRunId: string; decision?: TraceBlockDecision }
export interface OrchestrationTraceEntry { seq: number; orchestration: OrchestrationTraceBlock }
export interface OrchestrationTraceDocument { schema: typeof ORCHESTRATION_TRACE_SCHEMA; trace: AgentRunTrace; attribution: OrchestrationTraceEntry[] }

// ─── The task identity: the index and the role, never the literal task id (D21-41) ────────────────────────────────────────

const SPECIALISTS: readonly string[] = SPECIALIST_ROLES.filter((role) => role !== "coordinator");
/** `<n>-<role>`: n without a leading zero; the role checked against the closed list after the match */
const INDEX_AND_ROLE = /^([1-9][0-9]?)-([a-z][a-z-]*)$/;
const TASK_ID_PREFIX = "task-";
const isTaskIndex = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= MAX_TASK_INDEX;
function indexAndRole(text: string): { taskIndex: number; role: SpecialistRole } | null {
  const match = INDEX_AND_ROLE.exec(text);
  if (!match) return null;
  const taskIndex = Number(match[1]);
  const role = match[2]!;
  return isTaskIndex(taskIndex) && SPECIALISTS.includes(role) ? { taskIndex, role: role as SpecialistRole } : null;
}
/** The scheduler's task id of a plan's n-th specialist (`planTasks` mints `task-<n>-<role>`), reconstructed from its index and role. */
export function specialistTaskId(taskIndex: number, role: SpecialistRole): string {
  return `${TASK_ID_PREFIX}${taskIndex}-${role}`;
}
/** The inverse of `specialistTaskId`: a task id's index and role, or null for anything that is not exactly `task-<n>-<role>` of a
 *  specialist role with n in 1..MAX_TASK_INDEX. Every scheduler task id round-trips through it. */
export function specialistTaskIdentity(taskId: string): { taskIndex: number; role: SpecialistRole } | null {
  if (typeof taskId !== "string" || !taskId.startsWith(TASK_ID_PREFIX)) return null;
  const identity = indexAndRole(taskId.slice(TASK_ID_PREFIX.length));
  return identity && specialistTaskId(identity.taskIndex, identity.role) === taskId ? identity : null;
}
/** The per-task trace document's run id: the coordinator's run id, a colon, the task's index and role - never the task id. */
export function specialistTraceRunId(parentRunId: string, taskIndex: number, role: SpecialistRole): string {
  return `${parentRunId}:${taskIndex}-${role}`;
}
/** A parent run id the block and the trace may carry: the orchestration id grammar AND the v1 trace's own (unanchored) secret rule. */
const isParentRunId = (value: unknown): value is string => isOrchestrationId(value) && !containsSecretShapedText(value);
/** The inverse of `specialistTraceRunId` (the parent is everything before the LAST colon), or null. */
export function specialistTraceIdentity(runId: string): { parentRunId: string; taskIndex: number; role: SpecialistRole } | null {
  if (typeof runId !== "string") return null;
  const cut = runId.lastIndexOf(":");
  if (cut <= 0) return null;
  const parentRunId = runId.slice(0, cut);
  const identity = indexAndRole(runId.slice(cut + 1));
  return identity && isParentRunId(parentRunId) ? { parentRunId, ...identity } : null;
}

// ─── The one rule (the validator and the cascade share it) ────────────────────────────────────────────────────────────────

const BLOCK_KEYS: readonly string[] = [...ORCHESTRATION_TRACE_BLOCK_KEYS, ...ORCHESTRATION_TRACE_BLOCK_OPTIONAL_KEYS];
/** every control, format and line-separator character and every lone surrogate: none may sit in a model id ([B21 E2b fix: security-1] nor in any string of a document) */
const TEXT_FORBIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/u;
const TEXT_FORBIDDEN_ALL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/gu;
/** A step's model as a block names it: the trace's own bounded model with any control, format or separator character a `?`. */
export function blockModelId(model: string): string {
  return model.replace(TEXT_FORBIDDEN_ALL, "?").slice(0, ORCHESTRATION_TRACE_BOUNDS.maxModelChars);
}
const own = (record: Record<string, unknown>, key: string): boolean => Object.prototype.hasOwnProperty.call(record, key);

/** The rule a block breaks on an event of `kind`, or null (the B20-A4 `external` precedent: one rule, two callers). */
export function orchestrationBlockIssue(kind: unknown, block: unknown): string | null {
  if (!(ORCHESTRATION_TRACE_ATTRIBUTED_KINDS as readonly unknown[]).includes(kind)) return "orchestration: allowed only on step and tool_invocation";
  if (typeof block !== "object" || block === null || Array.isArray(block)) return "orchestration: must be an object";
  const record = block as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.some((key) => isForbiddenOrchestrationKeyName(key) || !BLOCK_KEYS.includes(key))) return "orchestration: closed keys";
  if (!ORCHESTRATION_TRACE_BLOCK_KEYS.every((key) => own(record, key))) return "orchestration: exact keys required";
  if (!isTaskIndex(record.taskIndex)) return `orchestration.taskIndex: an integer 1..${MAX_TASK_INDEX} is required`;
  if (typeof record.role !== "string" || !SPECIALISTS.includes(record.role)) return "orchestration.role: not a specialist role";
  if (!isParentRunId(record.parentRunId)) return "orchestration.parentRunId: outside the id grammar or secret-shaped";
  if (record.providerId !== "openai" && record.providerId !== "anthropic") return "orchestration.providerId: outside the closed vocabulary";
  const model = record.modelId;
  if (typeof model !== "string" || model.length > ORCHESTRATION_TRACE_BOUNDS.maxModelChars || TEXT_FORBIDDEN.test(model) || containsSecretShapedText(model)) return "orchestration.modelId: a bounded, clean id is required";
  if (own(record, "decision") && !(TRACE_BLOCK_DECISIONS as readonly unknown[]).includes(record.decision)) return "orchestration.decision: outside the closed vocabulary";
  return null;
}

// ─── The validator ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** validated snapshot -> its whole-body digest; identity-keyed, so a clone or the caller's object is never vouched for */
const VALIDATED = new WeakMap<object, string>();
const orchestrationTraceDigest = (document: unknown): string => engineeringDigest({ schema: ORCHESTRATION_TRACE_SCHEMA, body: document });

function judge(raw: unknown): string[] {
  const issues: string[] = [];
  const push = (issue: string): void => { if (issues.length < ORCHESTRATION_TRACE_BOUNDS.maxIssues) issues.push(issue); };
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return ["document: not an object"];
  const document = raw as Record<string, unknown>;
  const keys = Object.keys(document);
  if (keys.length !== ORCHESTRATION_TRACE_DOCUMENT_KEYS.length || !ORCHESTRATION_TRACE_DOCUMENT_KEYS.every((key) => own(document, key))) return ["document: exact keys required"];
  if (document.schema !== ORCHESTRATION_TRACE_SCHEMA) return [`document.schema: expected ${ORCHESTRATION_TRACE_SCHEMA}`];
  const traceIssues = validateAgentRunTrace(document.trace);
  if (traceIssues.length > 0) return traceIssues.slice(0, ORCHESTRATION_TRACE_BOUNDS.maxIssues).map((issue) => `document.${issue}`);
  const trace = document.trace as AgentRunTrace;
  const identity = specialistTraceIdentity(trace.runId);
  if (!identity) return ["document.trace.runId: is not <parentRunId>:<taskIndex>-<role>"];
  const attribution = document.attribution;
  if (!Array.isArray(attribution) || attribution.length > TRACE_BOUNDS.maxEvents) return [`document.attribution: an array of at most ${TRACE_BOUNDS.maxEvents}`];
  const secretPath = findSecretShapedPath(attribution, "document.attribution");
  if (secretPath !== null) return [secretPath]; const textPath = forbiddenTextPath(document, "document"); if (textPath !== null) return [textPath]; // [B21 E2b fix: security-1] the orchestration string rule over the WHOLE document
  const bySeq = new Map<number, AgentTraceEvent>(trace.events.map((event) => [event.seq, event]));
  const attributed = trace.events.filter((event) => (ORCHESTRATION_TRACE_ATTRIBUTED_KINDS as readonly string[]).includes(event.kind)).map((event) => event.seq);
  // the model each attributable event must name: a step its own, a tool invocation that of the step that asked for it
  const expectedModel = new Map<number, string>();
  let lastModel = "";
  for (const event of trace.events) {
    if (event.kind === "step") { lastModel = event.model; expectedModel.set(event.seq, blockModelId(event.model)); } else if (event.kind === "tool_invocation") expectedModel.set(event.seq, blockModelId(lastModel));
  }
  let previous = 0;
  for (const [index, item] of attribution.entries()) {
    const label = `document.attribution[${index}]`;
    if (typeof item !== "object" || item === null || Array.isArray(item)) { push(`${label}: not an object`); continue; }
    const entry = item as Record<string, unknown>;
    if (Object.keys(entry).length !== ORCHESTRATION_TRACE_ENTRY_KEYS.length || !ORCHESTRATION_TRACE_ENTRY_KEYS.every((key) => own(entry, key))) { push(`${label}: exact keys required`); continue; }
    const seq = entry.seq;
    if (typeof seq !== "number" || !Number.isSafeInteger(seq) || seq <= previous) { push(`${label}.seq: strictly increasing integers`); continue; }
    previous = seq;
    const event = bySeq.get(seq);
    if (!event) { push(`${label}.seq: names no event of the trace`); continue; }
    const blockIssue = orchestrationBlockIssue(event.kind, entry.orchestration);
    if (blockIssue !== null) { push(`${label}.${blockIssue}`); continue; }
    const block = entry.orchestration as unknown as OrchestrationTraceBlock;
    if (block.taskIndex !== identity.taskIndex || block.role !== identity.role || block.parentRunId !== identity.parentRunId) push(`${label}.orchestration: is not the task of the trace's run id (<parentRunId>:<taskIndex>-<role>)`);
    if (block.providerId !== trace.provider) push(`${label}.orchestration.providerId: is not the trace's provider`);
    if (block.modelId !== expectedModel.get(seq)) push(`${label}.orchestration.modelId: is not the model of the step it belongs to`);
    if (block.decision !== undefined && index !== attribution.length - 1) push(`${label}.orchestration.decision: only on the last attributed event`);
  }
  const seqs = attribution.map((item) => (typeof item === "object" && item !== null ? (item as Record<string, unknown>).seq : null));
  if (seqs.length !== attributed.length || !attributed.every((seq, index) => seqs[index] === seq)) push("document.attribution: every step and tool invocation attributed exactly once, and nothing else");
  return issues;
}
function validateCaptured(untrusted: unknown): { issues: string[]; value: unknown } {
  const captured = capturePlainJson(untrusted, "document", ORCHESTRATION_TRACE_BOUNDS.maxSerializedChars);
  if (!captured.ok) return { issues: captured.issues.slice(0, ORCHESTRATION_TRACE_BOUNDS.maxIssues), value: null };
  try {
    return { issues: judge(captured.value), value: captured.value };
  } catch {
    return { issues: ["document: could not be judged"], value: null };
  }
}
/** Every rule the document breaks (bounded); empty when it is a complete, attributed, redacted specialist trace. Never throws. */
export function validateOrchestrationTrace(untrusted: unknown): string[] {
  return validateCaptured(untrusted).issues;
}
/** The whole-body digest of a snapshot the cascade validated, or null for any other value (a clone included). */
export function validatedOrchestrationTraceDigest(value: unknown): string | null {
  return typeof value === "object" && value !== null ? VALIDATED.get(value) ?? null : null;
}

// ─── The cascade ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface SpecialistTraceIdentity { taskIndex: number; role: SpecialistRole; parentRunId: string }
export type AttributedTrace = { ok: true; document: OrchestrationTraceDocument; digest: string; normalized: boolean } | { ok: false; reason: "trace_invalid" | "identity_invalid" | "document_invalid"; detail: string };

/** The document for one task's finalized trace: a block on every step and tool invocation through the shared rule (never a block
 *  the validator refuses: an identity the rule refuses, or one that is not the task of the trace's run id, attributes nothing; a
 *  decision outside the three, or with no event to carry it, is dropped and every forbidden character of the trace a `?`), then the
 *  whole document validated and its snapshot registered for the store. */
export function attributeSpecialistTrace(recorded: AgentRunTrace, identity: SpecialistTraceIdentity, decision?: string): AttributedTrace {
  const traceIssues = validateAgentRunTrace(recorded);
  if (traceIssues.length > 0) return { ok: false, reason: "trace_invalid", detail: traceIssues[0]! }; const trace = cleanTraceText(recorded); // [B21 E2b fix: security-1]
  const probe = orchestrationBlockIssue("step", { taskIndex: identity.taskIndex, role: identity.role, providerId: trace.provider, modelId: "", parentRunId: identity.parentRunId });
  if (probe !== null) return { ok: false, reason: "identity_invalid", detail: probe };
  if (trace.runId !== specialistTraceRunId(identity.parentRunId, identity.taskIndex, identity.role)) return { ok: false, reason: "identity_invalid", detail: "the trace's run id is not <parentRunId>:<taskIndex>-<role> of this identity" };
  let normalized = trace !== recorded;
  let lastModel = "";
  const attribution: OrchestrationTraceEntry[] = [];
  for (const event of trace.events) {
    if (event.kind !== "step" && event.kind !== "tool_invocation") continue;
    if (event.kind === "step") lastModel = event.model;
    const modelId = blockModelId(lastModel);
    if (modelId !== lastModel) normalized = true;
    const block: OrchestrationTraceBlock = { taskIndex: identity.taskIndex, role: identity.role, providerId: trace.provider, modelId, parentRunId: identity.parentRunId };
    const issue = orchestrationBlockIssue(event.kind, block);
    if (issue !== null) return { ok: false, reason: "identity_invalid", detail: issue };
    attribution.push({ seq: event.seq, orchestration: block });
  }
  if (decision !== undefined) {
    if ((TRACE_BLOCK_DECISIONS as readonly string[]).includes(decision) && attribution.length > 0) attribution[attribution.length - 1]!.orchestration.decision = decision as TraceBlockDecision;
    else normalized = true;
  }
  const checked = validateCaptured({ schema: ORCHESTRATION_TRACE_SCHEMA, trace, attribution });
  if (checked.issues.length > 0 || checked.value === null) return { ok: false, reason: "document_invalid", detail: checked.issues[0] ?? "document: not captured" };
  const document = checked.value as OrchestrationTraceDocument;
  const digest = orchestrationTraceDigest(document);
  VALIDATED.set(document, digest);
  return { ok: true, document, digest, normalized };
}

// ─── The durable trace record (beside the orchestration run's, on the same repository) ────────────────────────────────────

export const ORCHESTRATION_TRACE_AGGREGATE_TYPE = "agent.orchestration-trace.v1" as const;
export const ORCHESTRATION_TRACE_RECORD_SCHEMA = "sirkit.orchestration-trace-record.v1" as const;
/** One stored document: the per-task trace run id and what it names (the parent run, the task's index and role - never its id). */
export interface OrchestrationTraceRecord { schema: typeof ORCHESTRATION_TRACE_RECORD_SCHEMA; runId: string; parentRunId: string; taskIndex: number; role: SpecialistRole; traceId: string; revision: number; at: string; digest: string; document: OrchestrationTraceDocument }
export interface OrchestrationTraceRecordEntry { revision: number; recordDigest: string; record: OrchestrationTraceRecord }
export type OrchestrationTraceAppendResult =
  | { ok: true; revision: number; recordDigest: string; replayed: boolean }
  | { ok: false; code: "stale_revision" | "unvalidated_document" | "invalid_record"; message: string };
export interface OrchestrationTraceStore {
  append(input: { scope: DurableWorkflowScope; document: OrchestrationTraceDocument; at: string }): Promise<OrchestrationTraceAppendResult>;
  /** every document recorded for one per-task trace run id (`<coordinatorRunId>:<n>-<role>`), in revision order, digest-verified */
  history(scope: DurableWorkflowScope, runId: string): Promise<OrchestrationTraceRecordEntry[]>;
}
const traceScope = (scope: DurableWorkflowScope): DurableWorkflowScope => ({ tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId });
const traceAggregateKey = (scope: DurableWorkflowScope, runId: string): string => durableWorkflowId("agent-orchestration-trace", { ...traceScope(scope), runId });
const traceIdentity = (scope: DurableWorkflowScope, runId: string) => durableAggregateIdentity(traceScope(scope), ORCHESTRATION_TRACE_AGGREGATE_TYPE, traceAggregateKey(scope, runId));
export const orchestrationTraceRecordDigest = (record: OrchestrationTraceRecord): string => engineeringDigest({ schema: ORCHESTRATION_TRACE_AGGREGATE_TYPE, record });
function traceMismatch(): never {
  throw new Error("AGENT_ORCHESTRATION_TRACE_MISMATCH");
}

/** The durable trace record: one aggregate per per-task trace run id (a resume that re-runs a task appends its next document),
 *  every append a compare-and-set commit of a document the cascade validated (identity-checked; a clone is `unvalidated_document`),
 *  idempotent by its trace id, no outbox effect; every load recomputes both digests and re-validates the document. */
export class DurableOrchestrationTraceStore implements OrchestrationTraceStore {
  constructor(private readonly workflow: DurableWorkflowRepository) {}

  async append(input: { scope: DurableWorkflowScope; document: OrchestrationTraceDocument; at: string }): Promise<OrchestrationTraceAppendResult> {
    const digest = validatedOrchestrationTraceDigest(input.document);
    if (digest === null) return { ok: false, code: "unvalidated_document", message: "Only a document the attribution cascade validated is recorded; nothing was written." };
    const scope = traceScope(input.scope);
    if (![scope.tenantId, scope.projectId, scope.branchId].every(isOrchestrationId) || !isOrchestrationTimestamp(input.at) || !sameTraceScope(input.document.trace.scope, scope)) return { ok: false, code: "invalid_record", message: "The trace record's scope or time is invalid, or its trace names another scope; nothing was written." }; // [B21 E2b fix: regressions-2] bound to the scope it is appended under
    const document = input.document;
    const runId = document.trace.runId;
    const task = specialistTraceIdentity(runId);
    if (!task) return { ok: false, code: "invalid_record", message: "The trace's run id names no specialist task; nothing was written." };
    const identity = traceIdentity(scope, runId);
    const head = await this.workflow.loadHead<OrchestrationTraceRecord>(identity);
    const expectedRevision = head?.revision ?? 0;
    const record: OrchestrationTraceRecord = { schema: ORCHESTRATION_TRACE_RECORD_SCHEMA, runId, parentRunId: task.parentRunId, taskIndex: task.taskIndex, role: task.role, traceId: document.trace.traceId, revision: expectedRevision + 1, at: input.at, digest, document };
    const recordDigest = orchestrationTraceRecordDigest(record);
    try {
      const committed = await this.workflow.commit<{ revision: number; recordDigest: string }>({
        scope, scopeKey: durableScopeKey(scope, `agent-orchestration-trace:${runId}`), idempotencyKey: `orchestration-trace:${runId}:${document.trace.traceId}`,
        operations: [{ aggregateType: ORCHESTRATION_TRACE_AGGREGATE_TYPE, aggregateKey: identity.aggregateKey, expectedRevision, payload: record, recordDigest }],
        outbox: [], result: { revision: record.revision, recordDigest }, committedAt: input.at,
      });
      return { ok: true, revision: committed.result.revision, recordDigest: committed.result.recordDigest, replayed: committed.idempotent };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/REVISION|CONFLICT|STALE/i.test(message)) return { ok: false, code: "stale_revision", message: "The trace record moved while this write was in flight; nothing was written over." };
      throw error;
    }
  }

  async history(scope: DurableWorkflowScope, runId: string): Promise<OrchestrationTraceRecordEntry[]> {
    const task = specialistTraceIdentity(runId);
    if (!task) return [];
    const records = await this.workflow.history<OrchestrationTraceRecord>(traceIdentity(scope, runId));
    return [...records].sort((a, b) => a.revision - b.revision).map((raw: DurableAggregateRecord<OrchestrationTraceRecord>, index) => {
      const record = raw.payload;
      if (raw.aggregateType !== ORCHESTRATION_TRACE_AGGREGATE_TYPE || raw.revision !== index + 1 || record.revision !== raw.revision || record.schema !== ORCHESTRATION_TRACE_RECORD_SCHEMA || record.runId !== runId) traceMismatch();
      if (record.parentRunId !== task.parentRunId || record.taskIndex !== task.taskIndex || record.role !== task.role) traceMismatch();
      if (orchestrationTraceRecordDigest(record) !== raw.recordDigest || orchestrationTraceDigest(record.document) !== record.digest) traceMismatch();
      if (validateOrchestrationTrace(record.document).length > 0 || record.document.trace.runId !== runId || !sameTraceScope(record.document.trace.scope, traceScope(scope))) traceMismatch(); // [B21 E2b fix: regressions-2]
      return { revision: raw.revision, recordDigest: raw.recordDigest, record: structuredClone(record) };
    });
  }
}

// ─── The book: one document per specialist task, bound by the composition root ────────────────────────────────────────────

type SpecialistLoopFn = (request: AgentRunRequest, deps: AgentLoopDeps) => Promise<AgentRunResult>;
export interface SpecialistTraceBookInput {
  coordinatorRunId: string;
  /** the plan's tasks (the scheduler's task ids and roles) */
  tasks: ReadonlyArray<{ taskId: string; role: SpecialistRole }>;
  scope: DurableWorkflowScope;
  /** the system prompt's version, recorded as the trace identity's `promptVersion` (a trace field, never a gateway option) */
  systemPromptVersion: string;
  newTraceId: () => string;
  now?: () => number;
  store: OrchestrationTraceStore;
}
export interface SpecialistTraceBook {
  /** the injected loop, wrapped: a specialist task's run records into its task's own document */
  loop(runLoop: SpecialistLoopFn): SpecialistLoopFn;
  /** closes every open document with the verdict of its task's LAST outcome (the scheduler's `tasks`, in order) and waits for every
   *  append: what was recorded, and every failure (a task named by role and index, a closed reason) */
  settle(outcomes?: ReadonlyArray<{ taskId: string; status: string }>): Promise<{ recorded: number; failures: string[] }>;
  /** the documents closed so far (their validated snapshots) */
  documents(): readonly OrchestrationTraceDocument[];
}
interface Handle { taskIndex: number; role: SpecialistRole; provider: LLMProviderId; recorder: AgentTraceRecorder; terminal: { outcome: TraceTerminalOutcome; failureReason: string | null } | null; closed: boolean }

export function specialistTraceBook(input: SpecialistTraceBookInput): SpecialistTraceBook {
  const now = input.now ?? ((): number => Date.now());
  // the plan's tasks by the scheduler's task id: each one's index and role, reconstructed from the id and checked against the plan
  const planned = new Map<string, { taskIndex: number; role: SpecialistRole }>();
  for (const task of input.tasks) { const identity = specialistTaskIdentity(task.taskId); if (identity && identity.role === task.role) planned.set(task.taskId, identity); }
  const handles = new Map<string, Handle>();
  const documents: OrchestrationTraceDocument[] = [];
  const failures: string[] = [];
  let recorded = 0;
  let queue: Promise<void> = Promise.resolve();
  const prefix = `${input.coordinatorRunId}:`;
  const named = (task: { taskIndex: number; role: SpecialistRole }, reason: string): string => `${task.role} task ${task.taskIndex}: ${reason}`;

  const open = (task: { taskIndex: number; role: SpecialistRole }, request: AgentRunRequest, deps: AgentLoopDeps): Handle => {
    const recorder = new AgentTraceRecorder({
      runId: specialistTraceRunId(input.coordinatorRunId, task.taskIndex, task.role), traceId: input.newTraceId(), provider: request.provider, promptVersion: input.systemPromptVersion,
      promptDigest: engineeringDigest({ schema: "sirkit.agent-prompt.v1", prompt: deps.system }), registryDigest: deps.registry.digest(), scope: traceScope(input.scope),
      contextDigests: { canonicalRevisionDigest: deps.context.canonicalRevisionDigest, schematicDigest: deps.context.schematicDigest, selectionDigest: deps.context.selectionDigest, netlistDigest: deps.context.netlistDigest, resourceManifestDigest: null },
    }, new InMemoryTraceSink(), now);
    return { ...task, provider: request.provider, recorder, terminal: null, closed: false };
  };
  /** the recorder handed to one attempt's loop: every recording passes through, except the terminal, which is HELD (a retry's
   *  attempt records into the same document; the book records the task's one terminal when it closes the document) */
  const held = (handle: Handle): AgentTraceRecorder => new Proxy(handle.recorder, {
    get(target, property) {
      if (property === "recordTerminal") return (outcome: TraceTerminalOutcome, failureReason: string | null): void => { handle.terminal = { outcome, failureReason }; };
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
  const close = (handle: Handle, decision: string | undefined): void => {
    if (handle.closed) return;
    handle.closed = true;
    const terminal = handle.terminal ?? { outcome: "failed" as const, failureReason: "internal_error" };
    handle.recorder.recordTerminal(terminal.outcome, terminal.failureReason);
    const trace = handle.recorder.finalize(terminal);
    const attributed = attributeSpecialistTrace(trace, { taskIndex: handle.taskIndex, role: handle.role, parentRunId: input.coordinatorRunId }, decision);
    if (!attributed.ok) { failures.push(named(handle, attributed.reason)); return; }
    documents.push(attributed.document);
    const at = new Date(now()).toISOString();
    queue = queue.then(async () => {
      try {
        const written = await input.store.append({ scope: input.scope, document: attributed.document, at });
        if (written.ok) recorded += 1; else failures.push(named(handle, written.code));
      } catch {
        failures.push(named(handle, "trace_store_unavailable"));
      }
    });
  };

  return {
    loop(runLoop) {
      return async (request, deps) => {
        const taskId = request.runId.startsWith(prefix) ? request.runId.slice(prefix.length) : null;
        const task = taskId === null ? undefined : planned.get(taskId);
        if (taskId === null || task === undefined) return runLoop(request, deps);
        let handle = handles.get(taskId);
        if (handle?.closed) return runLoop(request, deps);
        // [B21 E2b fix: security-3] a later attempt on ANOTHER provider (reachable: the scheduler routes every attempt again) never joins
        // a document whose provider is one: that document is closed at the switch WITHOUT a verdict and the attempt opens the next one
        if (handle && handle.provider !== request.provider) { close(handle, undefined); handle = undefined; }
        if (!handle) { handle = open(task, request, deps); handles.set(taskId, handle); }
        return runLoop(request, { ...deps, trace: held(handle), emit: withRefusalLines(handle.recorder, deps.emit) }); // [B21 E2b fix: coverage-2] a call refused before it ran: a line on this document
      };
    },
    async settle(outcomes = []) {
      const last = new Map<string, string>();
      for (const outcome of outcomes) last.set(outcome.taskId, outcome.status);
      for (const [taskId, handle] of handles) {
        const status = last.get(taskId);
        close(handle, status !== undefined && (TRACE_BLOCK_DECISIONS as readonly string[]).includes(status) ? status : undefined);
      }
      await queue;
      return { recorded, failures: [...failures] };
    },
    documents: () => [...documents],
  };
}

// ─── [B21 E2b fix] The review's findings (appended on purpose: declarations hoist, so no line cited above moves) ───────────

/** [security-1] The path of the first key or string of `value` holding a `TEXT_FORBIDDEN` character, or null. The v1 validator checks a
 *  trace's strings for length and secret shape only, so a provider's model id, a requested tool's name or a call id can carry a NUL or
 *  a lone surrogate (a jsonb commit refuses both: a specialist could keep its own record from being written) or a bidirectional
 *  override or zero-width character (the orchestration record refuses them as hostile): no document holds one. */
function forbiddenTextPath(value: unknown, path: string): string | null {
  if (typeof value === "string") return TEXT_FORBIDDEN.test(value) ? `${path}: holds a control, format or separator character or a lone surrogate` : null;
  if (typeof value !== "object" || value === null) return null;
  for (const [key, item] of Object.entries(value)) {
    if (TEXT_FORBIDDEN.test(key)) return `${path}: a key holds a control, format or separator character or a lone surrogate`;
    const found = forbiddenTextPath(item, Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`);
    if (found !== null) return found;
  }
  return null;
}
/** [security-1] A finalized trace with every `TEXT_FORBIDDEN` character of every string a `?` and the recorder's own diagnostic
 *  `trace_input_normalized` added (its closed vocabulary; one `?` per character, so no length grows and every v1 bound holds) - or the trace
 *  itself when it holds none. The cascade attributes the cleaned trace, so such text never keeps a document from being recorded. */
function cleanTraceText(trace: AgentRunTrace): AgentRunTrace {
  if (forbiddenTextPath(trace, "trace") === null) return trace;
  const clean = (value: unknown): unknown => (typeof value === "string" ? value.replace(TEXT_FORBIDDEN_ALL, "?") : Array.isArray(value) ? value.map(clean) : typeof value === "object" && value !== null ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clean(item)])) : value);
  const cleaned = clean(trace) as AgentRunTrace;
  return { ...cleaned, recorderDiagnostics: [...new Set([...cleaned.recorderDiagnostics, "trace_input_normalized" as const])].sort() };
}
/** [regressions-2] A trace's scope is exactly the scope its record is appended under or loaded from (as a stored orchestration request's
 *  scope is the run's, store.ts): the validated-snapshot map is process-wide, so the store never vouches for another scope's trace. */
function sameTraceScope(value: unknown, scope: DurableWorkflowScope): boolean {
  if (typeof value !== "object" || value === null) return false;
  const named = value as Record<string, unknown>;
  return named.tenantId === scope.tenantId && named.projectId === scope.projectId && named.branchId === scope.branchId;
}
/** [coverage-2] A call the loop refused BEFORE it ran (`unknown_tool`, `budget_exhausted`, `invalid_input`, `repeated_call`,
 *  `proposal_exists`, `execution_exists`: an untraced `tool_refused` event, D21-12) as ONE closed line on its task's own document: the
 *  registry's tool id (none for an unknown tool - the loop's own line names what was asked for) and the status, never a task id and
 *  never the model's arguments. The document's 32-warning bound is the recorder's. */
export function refusedCallLine(toolId: string | null, status: string): string {
  return `A tool call was refused before it ran: ${toolId !== null && isOrchestrationId(toolId) ? toolId : "an unknown tool"} (${/^[a-z][a-z_]{0,39}$/.test(status) ? status : "refused"}).`;
}
/** [coverage-2] The attempt's event channel, unchanged, with each `tool_refused` also recorded as its line (tracing is passive). */
function withRefusalLines(recorder: AgentTraceRecorder, emit: AgentLoopDeps["emit"]): AgentLoopDeps["emit"] {
  return (event) => {
    emit(event);
    if (event.type !== "tool_refused") return;
    try { recorder.recordWarning(refusedCallLine(event.toolId, event.status)); } catch { /* tracing is passive */ }
  };
}
