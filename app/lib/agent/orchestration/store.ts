/**
 * [B21 A] The DURABLE orchestration record (OD-111): the aggregate `agent.orchestration-run.v1` on the durable-workflow
 * substrate - the same substrate as the autonomy setting and the manufacturing ledger:
 *
 *  - scoped by tenant/project/branch and keyed by the coordinator run id (through `durableWorkflowId`);
 *  - revisioned: every accepted write is a compare-and-set commit on the aggregate revision (`expectedRevision`; a concurrent
 *    writer refuses `stale_revision`) under the idempotency key `orchestration:<runId>:<taskId>:<attempt>:<kind>` - the task
 *    attempt's identity `orchestration:<runId>:<taskId>:<attempt>` with one segment per record kind, because one attempt
 *    writes its request, then its result, then a decision - in a replay partition PER RUN (the scope key carries the run id:
 *    an id may carry `:`, so the key text alone is not injective across runs); a replay returns the committed result and
 *    writes nothing, so a provider outage or a retried scheduler step never duplicates committed work;
 *  - closed: a record is a plan, a validated request, a validated result, a decision or a dissent, every one a closed key set
 *    with bounded text; a request or result is stored as the validated, frozen snapshot the contracts produced plus its
 *    digest, and nothing else is accepted (`unvalidated_document`); a request is bound to the run and task it is appended
 *    under and a result to the request it answers (`requestDigest`); no reasoning text, no provider state, no credential (the
 *    contracts refused them by name and by value at every level, a wrapped artifact's interior included); tool calls are
 *    NOT persisted here (B21-E's per-task trace record carries them);
 *  - digest-bound: every load recomputes the record digest and the document digest and refuses any disagreement with the
 *    store's one mismatch sentence, as the autonomy store does (`revision` verifies the head, `history` the whole chain); a
 *    malformed scope on a read throws the one scope sentence;
 *  - silent: NO outbox effect (no handler exists for one; D21-28) - `history(scope)` is the replay and audit read;
 *  - retention: RECORDED on the page, not implemented here (OD-111).
 *
 * The repository is INJECTED: this module never imports the durable runtime, because the production repository's import
 * closure reaches a provider SDK through the database schema (D21-32), which the orchestration import gate forbids. The
 * composition root binds the repository through the factory seam (under the fixture runtime the in-memory one the dev
 * server hosts; in production the PostgreSQL one); until it does, or without a database, the store is UNAVAILABLE and every
 * caller fails closed with the unavailable sentence. No runtime binds the store in A (a stated deviation; B21-B binds it).
 */
import { durableAggregateIdentity, durableScopeKey, durableWorkflowId } from "../../durable-workflow/stable";
import type { DurableAggregateIdentity, DurableAggregateRecord, DurableWorkflowRepository, DurableWorkflowScope } from "../../durable-workflow/types";
import { engineeringDigest } from "../../engineering/stable";
import { capturePlainJson, type PlainJsonValue } from "../plain-capture";
import { redactPathSegment } from "../redaction";
import { ORCHESTRATION_BOUNDS, SPECIALIST_REQUEST_SCHEMA, SPECIALIST_RESULT_SCHEMA, SPECIALIST_ROLES, isForbiddenOrchestrationKeyName, isOrchestrationDigest, isOrchestrationId, isOrchestrationTimestamp, judgeOrchestrationText, validatedDigestOf, type SpecialistRole, type ValidatedSpecialistRequest, type ValidatedSpecialistResult } from "./contracts";

export const ORCHESTRATION_AGGREGATE_TYPE = "agent.orchestration-run.v1" as const;
export const ORCHESTRATION_RECORD_SCHEMA = "sirkit.orchestration-run-record.v1" as const;
export const ORCHESTRATION_SCOPE_SUFFIX = "agent-orchestration" as const;
export const ORCHESTRATION_RECORD_KINDS = Object.freeze(["plan", "request", "result", "decision", "dissent"] as const);
export type OrchestrationRecordKind = (typeof ORCHESTRATION_RECORD_KINDS)[number];
/** The closed decision vocabulary a decision or dissent carries (OD-114's vocabulary, recorded here; B21-D produces them). */
export const ORCHESTRATION_DECISIONS = Object.freeze(["accepted", "stale", "contradicted", "expired", "malformed", "escalated"] as const);
export type OrchestrationDecision = (typeof ORCHESTRATION_DECISIONS)[number];
export const ORCHESTRATION_STORE_REFUSALS = Object.freeze(["stale_revision", "unvalidated_document", "invalid_record"] as const);
export type OrchestrationStoreRefusal = (typeof ORCHESTRATION_STORE_REFUSALS)[number];
export const ORCHESTRATION_STORE_BOUNDS = Object.freeze({
  maxReasonChars: ORCHESTRATION_BOUNDS.maxTextChars,
  maxPlanTasks: ORCHESTRATION_BOUNDS.maxArrayEntries,
  maxAttempt: 1_000,
});

export interface OrchestrationRunScope extends DurableWorkflowScope { runId: string }
export interface OrchestrationPlanTask { taskId: string; role: SpecialistRole }
/** What a caller appends: only the validated, frozen snapshot type is accepted for a request or a result. */
export type OrchestrationRecord =
  | { kind: "plan"; tasks: readonly OrchestrationPlanTask[]; reason: string }
  | { kind: "request"; document: ValidatedSpecialistRequest }
  | { kind: "result"; document: ValidatedSpecialistResult }
  | { kind: "decision"; decision: OrchestrationDecision; reason: string; subjectDigest: string | null }
  | { kind: "dissent"; decision: OrchestrationDecision; reason: string; subjectDigest: string | null };
/** What the aggregate holds per revision: a request or result rides with its schema and its own whole-body digest; a result
 *  also with the whole-body digest of the request it answers (the latest request record of the same task attempt in this run). */
export type OrchestrationStoredRecord =
  | { kind: "plan"; tasks: readonly OrchestrationPlanTask[]; reason: string }
  | { kind: "request"; schema: typeof SPECIALIST_REQUEST_SCHEMA; digest: string; document: ValidatedSpecialistRequest }
  | { kind: "result"; schema: typeof SPECIALIST_RESULT_SCHEMA; digest: string; requestDigest: string; document: ValidatedSpecialistResult }
  | { kind: "decision" | "dissent"; decision: OrchestrationDecision; reason: string; subjectDigest: string | null };
export interface OrchestrationStoredPayload {
  schema: typeof ORCHESTRATION_RECORD_SCHEMA;
  runId: string;
  taskId: string;
  attempt: number;
  revision: number;
  at: string;
  record: OrchestrationStoredRecord;
}
export interface OrchestrationRunEntry { revision: number; taskId: string; attempt: number; at: string; recordDigest: string; record: OrchestrationStoredRecord }
export interface OrchestrationAppendRequest { scope: OrchestrationRunScope; taskId: string; attempt: number; expectedRevision: number; record: OrchestrationRecord; at: string }
export type OrchestrationAppendResult =
  | { ok: true; revision: number; recordDigest: string; replayed: boolean }
  | { ok: false; code: "stale_revision"; message: string; currentRevision: number }
  | { ok: false; code: "unvalidated_document" | "invalid_record"; message: string; path: string };
export interface OrchestrationRunStore {
  /** the head revision of a run (0 when nothing was written), digest-verified */
  revision(scope: OrchestrationRunScope): Promise<number>;
  /** the append-only records of a run in revision order, every one digest-verified */
  history(scope: OrchestrationRunScope): Promise<OrchestrationRunEntry[]>;
  append(request: OrchestrationAppendRequest): Promise<OrchestrationAppendResult>;
}

/** The task attempt's identity plus the record kind: an attempt writes its request, its result and a decision, each its own commit. */
export function orchestrationIdempotencyKey(runId: string, taskId: string, attempt: number, kind: OrchestrationRecordKind): string {
  return `orchestration:${runId}:${taskId}:${attempt}:${kind}`;
}
export function orchestrationRecordDigest(payload: OrchestrationStoredPayload): string {
  return engineeringDigest({ schema: ORCHESTRATION_AGGREGATE_TYPE, payload });
}
const workflowScope = (scope: OrchestrationRunScope): DurableWorkflowScope => ({ tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId });
/** [B21 A review] The replay partition of ONE run: `durableScopeKey(scope, "agent-orchestration:<runId>")`, so two runs of one
 *  branch never share a replay whatever their ids spell (`run` + `t:0` and `run:t` + `0` build the same key text). */
export function orchestrationReplayScopeKey(scope: OrchestrationRunScope): string {
  return durableScopeKey(workflowScope(scope), `${ORCHESTRATION_SCOPE_SUFFIX}:${scope.runId}`);
}
const aggregateKey = (scope: OrchestrationRunScope): string => durableWorkflowId("agent-orchestration-run", { tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId, runId: scope.runId });
const identityOf = (scope: OrchestrationRunScope): DurableAggregateIdentity => durableAggregateIdentity(workflowScope(scope), ORCHESTRATION_AGGREGATE_TYPE, aggregateKey(scope));

// ─── Judging an append before anything is written ────────────────────────────────────────────────────────────────────────

class Refusal extends Error {
  constructor(readonly code: "unvalidated_document" | "invalid_record", readonly path: string) {
    super(code);
  }
}
function refuse(code: "unvalidated_document" | "invalid_record", path: string): never {
  throw new Refusal(code, path);
}
type Refused = Extract<OrchestrationAppendResult, { ok: false; path: string }>;
/** a Refusal as the closed append result, or null for any other error (rethrown by the caller) */
function refused(error: unknown): Refused | null {
  return error instanceof Refusal ? { ok: false, code: error.code, message: `The record was refused at ${error.path} (${error.code}); nothing was written.`, path: error.path } : null;
}
const at = (path: string, key: string): string => `${path}.${redactPathSegment(key)}`;
type PlainRecord = Record<string, PlainJsonValue>;
const isRecord = (value: unknown): value is PlainRecord => typeof value === "object" && value !== null && !Array.isArray(value);
function closedKeyList(present: readonly string[], path: string, expected: readonly string[]): void {
  for (const key of present) if (isForbiddenOrchestrationKeyName(key) || !expected.includes(key)) refuse("invalid_record", at(path, key));
  for (const key of expected) if (!present.includes(key)) refuse("invalid_record", at(path, key));
}
function closedKeys(record: PlainRecord, path: string, expected: readonly string[]): void {
  closedKeyList(Object.keys(record), path, expected);
}
function reason(value: PlainJsonValue | undefined, path: string): string {
  if (judgeOrchestrationText(value, ORCHESTRATION_STORE_BOUNDS.maxReasonChars) !== null) refuse("invalid_record", path);
  return value as string;
}
/** the four scope ids, from a CAPTURED scope (a plain record; never the caller's object) */
function scopeOf(value: unknown): OrchestrationRunScope {
  if (!isRecord(value)) refuse("invalid_record", "$.scope");
  for (const key of ["tenantId", "projectId", "branchId", "runId"] as const) if (!isOrchestrationId(value[key])) refuse("invalid_record", `$.scope.${key}`);
  return { tenantId: value.tenantId as string, projectId: value.projectId as string, branchId: value.branchId as string, runId: value.runId as string };
}
function issuePath(issues: readonly string[], fallback: string): string {
  const first = issues[0] ?? fallback;
  const cut = first.indexOf(": ");
  return cut > 0 ? first.slice(0, cut) : fallback;
}
/** the store's record before a result is bound to its request (the binding needs the run's history) */
type JudgedRecord = Exclude<OrchestrationStoredRecord, { kind: "result" }> | Omit<Extract<OrchestrationStoredRecord, { kind: "result" }>, "requestDigest">;
/** The stored form of a record. A plan, a decision or a dissent is bounded data and is CAPTURED whole (closed keys, bounded text,
 *  closed vocabularies; no accessor, hook, proxy or foreign prototype survives). A request or result is judged by its KIND and its
 *  own keys - read through the descriptors, symbols included, so no accessor runs - and its document is taken by IDENTITY: the very
 *  snapshot the contracts registered (a clone or the caller's object is refused). [B21 A lead] The document is never re-captured,
 *  so a snapshot that validated at the contracts' bounds is never refused here for sitting two levels deeper, and no append pays a
 *  deep copy of it. A request must name the task and the scope it is appended under. */
function storedRecord(raw: unknown, scope: OrchestrationRunScope, taskId: string): JudgedRecord {
  if (!isRecord(raw)) refuse("invalid_record", "$.record");
  const rawKind: unknown = Reflect.getOwnPropertyDescriptor(raw, "kind")?.value;
  if (typeof rawKind !== "string" || !(ORCHESTRATION_RECORD_KINDS as readonly string[]).includes(rawKind)) refuse("invalid_record", "$.record.kind");
  const kind = rawKind as OrchestrationRecordKind;
  if (kind === "request" || kind === "result") {
    const document: unknown = Reflect.getOwnPropertyDescriptor(raw, "document")?.value;
    const known = validatedDigestOf(document);
    const schema = kind === "request" ? SPECIALIST_REQUEST_SCHEMA : SPECIALIST_RESULT_SCHEMA;
    if (!known || known.schema !== schema) refuse("unvalidated_document", "$.record.document");
    const prototype: unknown = Object.getPrototypeOf(raw);
    if (prototype !== Object.prototype && prototype !== null) refuse("invalid_record", "$.record");
    const ownKeys = Reflect.ownKeys(raw);
    if (ownKeys.some((key) => typeof key !== "string")) refuse("invalid_record", "$.record");
    closedKeyList(ownKeys as string[], "$.record", ["kind", "document"]);
    if (kind === "request") {
      const request = document as ValidatedSpecialistRequest;
      if (request.taskId !== taskId) refuse("invalid_record", "$.record.document.taskId");
      if (request.scope.tenantId !== scope.tenantId || request.scope.projectId !== scope.projectId || request.scope.branchId !== scope.branchId) refuse("invalid_record", "$.record.document.scope");
      return { kind, schema: SPECIALIST_REQUEST_SCHEMA, digest: known.digest, document: request };
    }
    return { kind, schema: SPECIALIST_RESULT_SCHEMA, digest: known.digest, document: document as ValidatedSpecialistResult };
  }
  const captured = capturePlainJson(raw, "$.record", ORCHESTRATION_BOUNDS.maxSerializedChars);
  if (!captured.ok) refuse("invalid_record", issuePath(captured.issues, "$.record"));
  const record = captured.value;
  if (!isRecord(record)) refuse("invalid_record", "$.record");
  switch (kind) {
    case "plan": {
      closedKeys(record, "$.record", ["kind", "tasks", "reason"]);
      const tasks = record.tasks;
      if (!Array.isArray(tasks) || tasks.length > ORCHESTRATION_STORE_BOUNDS.maxPlanTasks) refuse("invalid_record", "$.record.tasks");
      const planned = tasks.map((task, index): OrchestrationPlanTask => {
        const taskPath = `$.record.tasks[${index}]`;
        if (!isRecord(task)) refuse("invalid_record", taskPath);
        closedKeys(task, taskPath, ["taskId", "role"]);
        if (!isOrchestrationId(task.taskId)) refuse("invalid_record", at(taskPath, "taskId"));
        if (typeof task.role !== "string" || !(SPECIALIST_ROLES as readonly string[]).includes(task.role)) refuse("invalid_record", at(taskPath, "role"));
        return { taskId: task.taskId, role: task.role as SpecialistRole };
      });
      return { kind: "plan", tasks: planned, reason: reason(record.reason, "$.record.reason") };
    }
    case "decision":
    case "dissent": {
      closedKeys(record, "$.record", ["kind", "decision", "reason", "subjectDigest"]);
      const decision = record.decision;
      if (typeof decision !== "string" || !(ORCHESTRATION_DECISIONS as readonly string[]).includes(decision)) refuse("invalid_record", "$.record.decision");
      const subjectDigest = record.subjectDigest;
      if (subjectDigest !== null && !isOrchestrationDigest(subjectDigest)) refuse("invalid_record", "$.record.subjectDigest");
      return { kind, decision: decision as OrchestrationDecision, reason: reason(record.reason, "$.record.reason"), subjectDigest };
    }
  }
}
type Judged = { ok: true; scope: OrchestrationRunScope; taskId: string; attempt: number; expectedRevision: number; at: string; record: JudgedRecord } | Refused;
/** the envelope's own scalar fields (four ids, a task id, two integers, a timestamp) fit here many times over */
const ENVELOPE_CAPTURE_CHARS = 4_096;
/** [B21 A lead] The envelope is read through its OWN data-property descriptors only (an accessor never runs), its scalar fields
 *  captured as plain data under a small bound, and its record judged on its own by `storedRecord` (a plan, decision or dissent
 *  captured whole; a request or result by kind, keys and the document's identity - never re-captured). A throw anywhere while
 *  judging - a Proxy trap, a revoked Proxy, a hostile prototype - is the closed refusal `invalid_record`, never an escape. */
function judgeAppend(request: OrchestrationAppendRequest): Judged {
  try {
    if (!isRecord(request as unknown)) refuse("invalid_record", "$");
    const own = (key: string): unknown => Reflect.getOwnPropertyDescriptor(request, key)?.value;
    const captured = capturePlainJson({ scope: own("scope"), taskId: own("taskId"), attempt: own("attempt"), expectedRevision: own("expectedRevision"), at: own("at") }, "$", ENVELOPE_CAPTURE_CHARS);
    if (!captured.ok) refuse("invalid_record", issuePath(captured.issues, "$"));
    const envelope = captured.value;
    if (!isRecord(envelope)) refuse("invalid_record", "$");
    const scope = scopeOf(envelope.scope);
    if (!isOrchestrationId(envelope.taskId)) refuse("invalid_record", "$.taskId");
    const attempt = envelope.attempt;
    if (typeof attempt !== "number" || !Number.isSafeInteger(attempt) || attempt < 0 || attempt > ORCHESTRATION_STORE_BOUNDS.maxAttempt) refuse("invalid_record", "$.attempt");
    const expectedRevision = envelope.expectedRevision;
    if (typeof expectedRevision !== "number" || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) refuse("invalid_record", "$.expectedRevision");
    if (!isOrchestrationTimestamp(envelope.at)) refuse("invalid_record", "$.at");
    return { ok: true, scope, taskId: envelope.taskId, attempt, expectedRevision, at: envelope.at, record: storedRecord(own("record"), scope, envelope.taskId) };
  } catch (error) {
    return refused(error) ?? { ok: false, code: "invalid_record", message: "The append envelope could not be judged (a hostile object); nothing was written.", path: "$" };
  }
}

// ─── The store ───────────────────────────────────────────────────────────────────────────────────────────────────────────

function mismatch(): never {
  throw new Error("AGENT_ORCHESTRATION_RECORD_MISMATCH");
}
/** One stored record, verified before it is trusted: identity, schema, run, revision, record digest and document digest. */
function verified(scope: OrchestrationRunScope, raw: DurableAggregateRecord<OrchestrationStoredPayload>, expectedRevision: number): OrchestrationRunEntry {
  const expected = identityOf(scope);
  const payload = raw.payload;
  if (raw.aggregateType !== expected.aggregateType || raw.aggregateKey !== expected.aggregateKey) mismatch();
  if (raw.scope.tenantId !== expected.scope.tenantId || raw.scope.projectId !== expected.scope.projectId || raw.scope.branchId !== expected.scope.branchId) mismatch();
  if (!isRecord(payload as unknown) || payload.schema !== ORCHESTRATION_RECORD_SCHEMA || payload.runId !== scope.runId) mismatch();
  if (payload.revision !== raw.revision || raw.revision !== expectedRevision) mismatch();
  if (orchestrationRecordDigest(payload) !== raw.recordDigest) mismatch();
  const record = payload.record;
  if ((record.kind === "request" || record.kind === "result") && engineeringDigest({ schema: record.schema, body: record.document }) !== record.digest) mismatch();
  return { revision: raw.revision, taskId: payload.taskId, attempt: payload.attempt, at: payload.at, recordDigest: raw.recordDigest, record: structuredClone(record) };
}
/** A read's scope, captured and judged like an append's; a malformed one throws the one documented scope sentence. */
function readScope(scope: OrchestrationRunScope): OrchestrationRunScope {
  const captured = capturePlainJson(scope, "$.scope", 4_096);
  try {
    if (!captured.ok) refuse("invalid_record", "$.scope");
    return scopeOf(captured.value);
  } catch (error) {
    if (error instanceof Refusal) throw new Error("AGENT_ORCHESTRATION_SCOPE_INVALID");
    throw error;
  }
}

export class DurableOrchestrationRunStore implements OrchestrationRunStore {
  constructor(private readonly workflow: DurableWorkflowRepository) { TRACE_STORES.set(this, new DurableOrchestrationTraceStore(workflow)); } // [B21 E2b] the per-task trace records on the SAME repository (OD-112; appended below)

  async revision(scope: OrchestrationRunScope): Promise<number> {
    const run = readScope(scope);
    const head = await this.workflow.loadHead<OrchestrationStoredPayload>(identityOf(run));
    return head ? verified(run, head, head.revision).revision : 0;
  }

  async history(scope: OrchestrationRunScope): Promise<OrchestrationRunEntry[]> {
    const run = readScope(scope);
    const records = await this.workflow.history<OrchestrationStoredPayload>(identityOf(run));
    return [...records].sort((a, b) => a.revision - b.revision).map((record, index) => verified(run, record, index + 1));
  }

  /** A result answers exactly one request of THIS run: the latest request record of the same task attempt, whose role it must
   *  carry; its whole-body digest rides with the result. A result with no such request is refused before anything is written. */
  private async bound(scope: OrchestrationRunScope, taskId: string, attempt: number, judged: JudgedRecord): Promise<OrchestrationStoredRecord | Refused> {
    if (judged.kind !== "result") return judged;
    const history = await this.history(scope);
    const answered = history.filter((entry) => entry.taskId === taskId && entry.attempt === attempt && entry.record.kind === "request").at(-1)?.record;
    try {
      if (!answered || answered.kind !== "request") refuse("invalid_record", "$.record.document");
      if (answered.document.role !== judged.document.role) refuse("invalid_record", "$.record.document.role");
      return { ...judged, requestDigest: answered.digest };
    } catch (error) {
      const outcome = refused(error);
      if (outcome) return outcome;
      throw error;
    }
  }

  async append(request: OrchestrationAppendRequest): Promise<OrchestrationAppendResult> {
    const judged = judgeAppend(request);
    if (!judged.ok) return judged;
    const { scope, taskId, attempt, expectedRevision, at: committedAt } = judged;
    const record = await this.bound(scope, taskId, attempt, judged.record);
    if ("ok" in record) return record;
    const revision = expectedRevision + 1;
    const payload: OrchestrationStoredPayload = { schema: ORCHESTRATION_RECORD_SCHEMA, runId: scope.runId, taskId, attempt, revision, at: committedAt, record };
    const recordDigest = orchestrationRecordDigest(payload);
    try {
      const committed = await this.workflow.commit<{ revision: number; recordDigest: string }>({
        scope: workflowScope(scope),
        scopeKey: orchestrationReplayScopeKey(scope),
        idempotencyKey: orchestrationIdempotencyKey(scope.runId, taskId, attempt, record.kind),
        operations: [{ aggregateType: ORCHESTRATION_AGGREGATE_TYPE, aggregateKey: aggregateKey(scope), expectedRevision, payload, recordDigest }],
        outbox: [],
        result: { revision, recordDigest },
        committedAt,
      });
      // a replay hands back the FIRST commit's result: the revision and digest that were written then, never this attempt's
      return { ok: true, revision: committed.result.revision, recordDigest: committed.result.recordDigest, replayed: committed.idempotent };
    } catch (error) {
      // A concurrent writer won the compare-and-set: report the CURRENT revision, never a guess.
      const message = error instanceof Error ? error.message : String(error);
      if (/REVISION|CONFLICT|STALE/i.test(message)) {
        const current = await this.revision(scope);
        return { ok: false, code: "stale_revision", message: `The run moved to revision ${current} while this write was in flight; re-read it and decide again.`, currentRevision: current };
      }
      throw error;
    }
  }
}

// ── the composition seam ─────────────────────────────────────────────────────

function unavailable(): never {
  throw new Error("AGENT_ORCHESTRATION_STORE_UNAVAILABLE");
}
/** No repository bound: every call fails closed. */
const UNAVAILABLE_STORE: OrchestrationRunStore = Object.freeze({
  revision: async (): Promise<number> => unavailable(),
  history: async (): Promise<OrchestrationRunEntry[]> => unavailable(),
  append: async (): Promise<OrchestrationAppendResult> => unavailable(),
});
type Factory = () => OrchestrationRunStore;
const unavailableFactory: Factory = () => UNAVAILABLE_STORE;
let factory: Factory = unavailableFactory;

/** Never throws: a factory that fails resolves to the unavailable store. The composition root installs the production factory. */
export function resolveOrchestrationRunStore(): OrchestrationRunStore {
  try {
    return factory();
  } catch {
    return UNAVAILABLE_STORE;
  }
}
export function setOrchestrationRunStoreFactory(next: Factory): void {
  factory = next;
}
export function resetOrchestrationRunStoreFactory(): void {
  factory = unavailableFactory;
}

// ─── [B21 E2b] The per-task trace records beside the run's (OD-112 as the lead read it; D21-3's calls) ───────────────────────
// Appended on purpose: an import is hoisted and the map is read only when a store is constructed, so no line cited above moves.

import { DurableOrchestrationTraceStore, type OrchestrationTraceStore } from "./trace-attribution";

/** Every durable record's trace store: the per-task trace documents (trace-attribution) go to their own aggregate type on the SAME
 *  repository the record is bound to - so they persist wherever the record does, never in the run's own history (its records and
 *  revisions are unchanged) - and nothing else of the repository is handed out: the trace store appends only a document the
 *  attribution cascade validated. A store that is not durable (a test double, the unavailable default) has none. */
const TRACE_STORES = new WeakMap<OrchestrationRunStore, OrchestrationTraceStore>();
export function orchestrationTraceStoreOf(store: OrchestrationRunStore): OrchestrationTraceStore | null {
  return TRACE_STORES.get(store) ?? null;
}
