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
import { containsTokenAnchoredSecretShapedText, redactPathSegment } from "../redaction";
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

/** Never throws: a factory that fails resolves to the unavailable store. The composition root installs the production factory [superseded 2026-09-29 by the B21 closeout (D21-27, OD-113): the composition root binds ITS OWN factory (orchestration-runtime.ts) and calls this only as the unavailable fallback; the setter below is a test seam, store case 11]. */
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

// ─── [B21 E3] The chat resume's record, beside the run's (OD-122's userMessageDigest ledger; D21-4 at the chat surface) ─────────────
// Appended on purpose: the class and map below are read only when a resume store is resolved, so no line cited above moves - the
// constructor line is E2b's C90, so the resume store is derived from the durable record LAZILY, never in it (and the one import it
// adds, the redaction authority's secret rule, joins the module's existing import of that authority in place).

/** [B21 E3] The resume record: its OWN aggregate type on the SAME repository as the run's record (E2b's trace-record precedent), so the
 *  run's history - which the scheduler resumes from, the merge chains its verdicts in and B, D, D2 and D3 pin - is untouched. */
export const ORCHESTRATION_RESUME_AGGREGATE_TYPE = "agent.orchestration-resume.v1" as const;
export const ORCHESTRATION_RESUME_RECORD_SCHEMA = "sirkit.orchestration-resume-record.v1" as const;
/** The closed entries: the coordinator's first turn (the resume binding and its answer - also the START of the run's first request,
 *  ordinal 0), ONE specialist artifact per userMessageDigest (the idempotency key IS the ledger), the follow-up turn's answer (a run
 *  whose follow-up answered is finished), a resumed request's START (`resume`, ordinal 1, 2, ...: claimed by compare-and-set against
 *  the head its caller read, so two requests never hold one run) and a request's END without the follow-up's answer (`settled`). */
export const ORCHESTRATION_RESUME_KINDS = Object.freeze(["coordinator", "artifact", "follow-up", "resume", "settled"] as const);
export type OrchestrationResumeKind = (typeof ORCHESTRATION_RESUME_KINDS)[number];
/** The shape of an artifact event a coordinator's first turn handed the human, as the record holds it: a closed event name (the
 *  runtime writes only its own `COORDINATOR_ARTIFACT_EVENTS` and reads back only those - an unknown name can only keep specialists
 *  read-only, never widen anything). */
export const ORCHESTRATION_RESUME_EVENT_NAME = /^[a-z][a-z_]{0,39}$/;
/** Why a coordinator's answer is not stored (it is then replayed as a closed placeholder): over the bound, or refused by the text rule. */
export const ORCHESTRATION_RESUME_ANSWER_WITHHELD = Object.freeze(["answer_too_long", "answer_refused"] as const);
export type OrchestrationResumeAnswerWithheld = (typeof ORCHESTRATION_RESUME_ANSWER_WITHHELD)[number];
export const ORCHESTRATION_RESUME_BOUNDS = Object.freeze({ maxAnswerChars: 60_000, maxArtifacts: 4, maxActionIndex: ORCHESTRATION_BOUNDS.maxArrayEntries - 1, maxOrdinal: ORCHESTRATION_STORE_BOUNDS.maxAttempt });
type ResumeProvider = "openai" | "anthropic";
/** What a caller appends: the coordinator's RAW final text (the store encodes and judges it). */
export type OrchestrationResumeInput =
  | { kind: "coordinator"; ownerDigest: string; userMessageDigest: string; provider: ResumeProvider; planDigest: string; answer: string; artifacts: readonly string[] }
  | { kind: "artifact"; userMessageDigest: string; taskId: string; attempt: number; actionIndex: number; artifactKind: string; artifactDigest: string; /** [B21 E3 fix: coverage-5] the claiming request's ordinal */ ordinal: number }
  | { kind: "follow-up"; answerDigest: string }
  | { kind: "resume"; ordinal: number; /** [B21 E3 lead] the claiming request's own id (a digest of a fresh nonce): only the request that made a claim marks its end when the claim's outcome is unknown */ claim: string }
  | { kind: "settled"; ordinal: number; /** [B21 E3 fix: coverage-5] whether THIS request presented the message's artifact */ presented: boolean };
/** What a load returns: the coordinator's answer DECODED (null when withheld), its digest always. */
export type OrchestrationResumeEntry =
  | { kind: "coordinator"; ownerDigest: string; userMessageDigest: string; provider: ResumeProvider; planDigest: string; answer: string | null; answerDigest: string; answerWithheld: OrchestrationResumeAnswerWithheld | null; artifacts: readonly string[] }
  | Exclude<OrchestrationResumeInput, { kind: "coordinator" }>;
export interface OrchestrationResumeRecordEntry { revision: number; at: string; recordDigest: string; entry: OrchestrationResumeEntry }
export type OrchestrationResumeAppendResult = { ok: true; revision: number; recordDigest: string; replayed: boolean } | { ok: false; code: "stale_revision" | "invalid_record"; message: string };
export interface OrchestrationResumeStore {
  /** the run's resume entries in revision order, every record digest-verified and re-judged */
  history(scope: OrchestrationRunScope): Promise<OrchestrationResumeRecordEntry[]>;
  /** `expectedRevision`: the head the caller READ (compare-and-set against it); absent, the head at the time of the write */
  append(input: { scope: OrchestrationRunScope; entry: OrchestrationResumeInput; at: string; expectedRevision?: number }): Promise<OrchestrationResumeAppendResult>;
}
/** The stored form: a coordinator's answer ENCODED (`encodeResumeAnswer`), or null when withheld. */
type StoredResumeEntry = OrchestrationResumeEntry;
interface StoredResumePayload { schema: typeof ORCHESTRATION_RESUME_RECORD_SCHEMA; runId: string; revision: number; at: string; entry: StoredResumeEntry }

/** [B21 E3] The key of an entry: the coordinator's and the follow-up's once per run, an artifact once per run AND user message, a
 *  request's start and its end once per run AND ordinal. */
export function orchestrationResumeIdempotencyKey(runId: string, entry: { kind: OrchestrationResumeKind; userMessageDigest?: string; ordinal?: number }): string {
  if (entry.kind === "artifact") return `orchestration-resume:${runId}:artifact:${entry.userMessageDigest ?? ""}`;
  return entry.kind === "resume" || entry.kind === "settled" ? `orchestration-resume:${runId}:${entry.kind}:${entry.ordinal ?? ""}` : `orchestration-resume:${runId}:${entry.kind}`;
}
export function orchestrationResumeAnswerDigest(text: string): string {
  return engineeringDigest({ schema: "sirkit.orchestration-resume-answer.v1", text });
}
const BACKSLASH_U = `${String.fromCharCode(92)}u`;
const hex4 = (code: number): string => `${BACKSLASH_U}${code.toString(16).padStart(4, "0")}`;
const UNSAFE_CHARACTER = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;
/** [B21 E3] The answer as stored: its JSON text (a NUL, the C0 controls and a lone surrogate are escapes there) with every remaining
 *  control, format and separator character written as an escape too - so the stored string passes the orchestration text rule and a
 *  jsonb column, and `decodeResumeAnswer` gives the answer back EXACTLY (an astral format character as its surrogate pair). */
export function encodeResumeAnswer(text: string): string {
  return JSON.stringify(text).replace(UNSAFE_CHARACTER, (character) => {
    const code = character.codePointAt(0)!;
    if (code <= 0xffff) return hex4(code);
    const offset = code - 0x10000;
    return `${hex4(0xd800 + (offset >> 10))}${hex4(0xdc00 + (offset & 0x3ff))}`;
  });
}
export function decodeResumeAnswer(encoded: string): string | null {
  try {
    const decoded: unknown = JSON.parse(encoded);
    return typeof decoded === "string" ? decoded : null;
  } catch {
    return null;
  }
}
const resumeScope = (scope: OrchestrationRunScope): DurableWorkflowScope => ({ tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId });
const resumeAggregateKey = (scope: OrchestrationRunScope): string => durableWorkflowId("agent-orchestration-resume", { ...resumeScope(scope), runId: scope.runId });
const resumeIdentity = (scope: OrchestrationRunScope): DurableAggregateIdentity => durableAggregateIdentity(resumeScope(scope), ORCHESTRATION_RESUME_AGGREGATE_TYPE, resumeAggregateKey(scope));
export const orchestrationResumeRecordDigest = (payload: StoredResumePayload): string => engineeringDigest({ schema: ORCHESTRATION_RESUME_AGGREGATE_TYPE, payload });
function resumeMismatch(): never {
  throw new Error("AGENT_ORCHESTRATION_RESUME_MISMATCH");
}
const RESUME_KEYS: Readonly<Record<OrchestrationResumeKind, readonly string[]>> = Object.freeze({
  coordinator: ["kind", "ownerDigest", "userMessageDigest", "provider", "planDigest", "answer", "artifacts"],
  artifact: ["kind", "userMessageDigest", "taskId", "attempt", "actionIndex", "artifactKind", "artifactDigest", "ordinal"],
  "follow-up": ["kind", "answerDigest"],
  resume: ["kind", "ordinal", "claim"],
  settled: ["kind", "ordinal", "presented"],
});
const STORED_COORDINATOR_KEYS = ["kind", "ownerDigest", "userMessageDigest", "provider", "planDigest", "answer", "answerDigest", "answerWithheld", "artifacts"] as const;
const boundedInteger = (value: unknown, max: number): boolean => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max;
/** The closed judgement of an entry's fields other than a coordinator's answer (the input's and the stored form's alike). */
function judgeResumeFields(entry: PlainRecord, path: string): void {
  switch (entry.kind) {
    case "coordinator": {
      for (const key of ["ownerDigest", "userMessageDigest", "planDigest"] as const) if (!isOrchestrationDigest(entry[key])) refuse("invalid_record", at(path, key));
      if (entry.provider !== "openai" && entry.provider !== "anthropic") refuse("invalid_record", at(path, "provider"));
      const artifacts = entry.artifacts;
      if (!Array.isArray(artifacts) || artifacts.length > ORCHESTRATION_RESUME_BOUNDS.maxArtifacts || !artifacts.every((event) => typeof event === "string" && ORCHESTRATION_RESUME_EVENT_NAME.test(event))) refuse("invalid_record", at(path, "artifacts"));
      return;
    }
    case "artifact":
      for (const key of ["userMessageDigest", "artifactDigest"] as const) if (!isOrchestrationDigest(entry[key])) refuse("invalid_record", at(path, key));
      for (const key of ["taskId", "artifactKind"] as const) if (!isOrchestrationId(entry[key])) refuse("invalid_record", at(path, key));
      if (!boundedInteger(entry.attempt, ORCHESTRATION_STORE_BOUNDS.maxAttempt)) refuse("invalid_record", at(path, "attempt"));
      if (!boundedInteger(entry.actionIndex, ORCHESTRATION_RESUME_BOUNDS.maxActionIndex)) refuse("invalid_record", at(path, "actionIndex")); if (!boundedInteger(entry.ordinal, ORCHESTRATION_RESUME_BOUNDS.maxOrdinal)) refuse("invalid_record", at(path, "ordinal"));
      return;
    case "follow-up":
      if (!isOrchestrationDigest(entry.answerDigest)) refuse("invalid_record", at(path, "answerDigest"));
      return;
    case "resume": // a resumed request's start: ordinal 1 and up (0 is the first request's, whose start is the coordinator entry)
    case "settled":
      if (!boundedInteger(entry.ordinal, ORCHESTRATION_RESUME_BOUNDS.maxOrdinal) || (entry.kind === "resume" && entry.ordinal === 0)) refuse("invalid_record", at(path, "ordinal")); if (entry.kind === "settled" && typeof entry.presented !== "boolean") refuse("invalid_record", at(path, "presented")); if (entry.kind === "resume" && !isOrchestrationDigest(entry.claim)) refuse("invalid_record", at(path, "claim")); // [B21 E3 lead]
      return;
    default:
      refuse("invalid_record", at(path, "kind"));
  }
}
/** [B21 E3] An input judged into its stored form: the entry is read through its OWN data descriptors (an accessor, a symbol key or a
 *  Proxy trap is refused), the fields other than the answer captured as plain data under a small bound and judged closed; a
 *  coordinator's answer - a string of any length - is encoded, bounded and judged by the orchestration text rule (a credential-shaped
 *  value in the answer or its encoding WITHHOLDS it: never stored). Throws the store's closed refusal only. */
function storedResumeEntry(raw: unknown): StoredResumeEntry {
  if (!isRecord(raw)) refuse("invalid_record", "$.entry");
  const fields: Record<string, unknown> = {};
  let answer: unknown;
  let answered = false;
  for (const key of Reflect.ownKeys(raw)) {
    const descriptor = typeof key === "string" ? Reflect.getOwnPropertyDescriptor(raw, key) : undefined;
    if (typeof key !== "string" || !descriptor || !("value" in descriptor)) refuse("invalid_record", "$.entry");
    if (key === "answer") { answer = descriptor.value; answered = true; } else fields[key] = descriptor.value;
  }
  const captured = capturePlainJson(fields, "$.entry", 16_384);
  if (!captured.ok) refuse("invalid_record", issuePath(captured.issues, "$.entry"));
  const entry = captured.value;
  if (!isRecord(entry)) refuse("invalid_record", "$.entry");
  const kind = entry.kind;
  if (typeof kind !== "string" || !(ORCHESTRATION_RESUME_KINDS as readonly string[]).includes(kind)) refuse("invalid_record", "$.entry.kind");
  closedKeyList([...Object.keys(entry), ...(answered ? ["answer"] : [])], "$.entry", RESUME_KEYS[kind as OrchestrationResumeKind]);
  judgeResumeFields(entry, "$.entry");
  if (kind !== "coordinator") return entry as unknown as StoredResumeEntry;
  if (typeof answer !== "string") refuse("invalid_record", "$.entry.answer");
  const encoded = encodeResumeAnswer(answer);
  const withheld: OrchestrationResumeAnswerWithheld | null = encoded.length > ORCHESTRATION_RESUME_BOUNDS.maxAnswerChars ? "answer_too_long"
    : containsTokenAnchoredSecretShapedText(answer) || resumeAnswerCredentialShape(answer) !== null || judgeOrchestrationText(encoded, ORCHESTRATION_RESUME_BOUNDS.maxAnswerChars) !== null ? "answer_refused" : null; // [B21 E3 fix: security-1] + the resume record's own shapes
  const coordinator = entry as unknown as Omit<Extract<OrchestrationResumeInput, { kind: "coordinator" }>, "answer">;
  return { kind: "coordinator", ownerDigest: coordinator.ownerDigest, userMessageDigest: coordinator.userMessageDigest, provider: coordinator.provider, planDigest: coordinator.planDigest, answer: withheld === null ? encoded : null, answerDigest: orchestrationResumeAnswerDigest(answer), answerWithheld: withheld, artifacts: [...coordinator.artifacts] };
}
/** [B21 E3] A stored entry re-judged on load and returned DECODED; anything that does not hold is the one mismatch sentence. */
function loadedResumeEntry(raw: unknown): OrchestrationResumeEntry {
  try {
    if (!isRecord(raw)) resumeMismatch();
    const kind = raw.kind;
    if (kind === "coordinator") {
      closedKeyList(Object.keys(raw), "$.entry", STORED_COORDINATOR_KEYS);
      judgeResumeFields(raw, "$.entry");
      if (!isOrchestrationDigest(raw.answerDigest)) resumeMismatch();
      const withheld = raw.answerWithheld;
      if (withheld !== null && !(ORCHESTRATION_RESUME_ANSWER_WITHHELD as readonly unknown[]).includes(withheld)) resumeMismatch();
      let answer: string | null = null;
      if (withheld === null) {
        if (typeof raw.answer !== "string" || judgeOrchestrationText(raw.answer, ORCHESTRATION_RESUME_BOUNDS.maxAnswerChars) !== null) resumeMismatch();
        answer = decodeResumeAnswer(raw.answer);
        if (answer === null || orchestrationResumeAnswerDigest(answer) !== raw.answerDigest || encodeResumeAnswer(answer) !== raw.answer) resumeMismatch();
      } else if (raw.answer !== null) resumeMismatch();
      return { kind, ownerDigest: raw.ownerDigest as string, userMessageDigest: raw.userMessageDigest as string, provider: raw.provider as ResumeProvider, planDigest: raw.planDigest as string, answer, answerDigest: raw.answerDigest, answerWithheld: withheld as OrchestrationResumeAnswerWithheld | null, artifacts: [...(raw.artifacts as string[])] };
    }
    if (kind !== "artifact" && kind !== "follow-up" && kind !== "resume" && kind !== "settled") resumeMismatch();
    closedKeyList(Object.keys(raw), "$.entry", RESUME_KEYS[kind]);
    judgeResumeFields(raw, "$.entry");
    return structuredClone(raw) as unknown as OrchestrationResumeEntry;
  } catch (error) {
    if (error instanceof Refusal) resumeMismatch();
    throw error;
  }
}

/** [B21 E3] The durable resume record: one aggregate per coordinator run, every append a compare-and-set commit of an entry judged
 *  closed - against the head its caller READ when it names one (a request's start), else the head at the time of the write -
 *  idempotent by its entry's key (a second coordinator entry, a second artifact for the same user message, a second follow-up, a second
 *  start or end of one ordinal write NOTHING and read back as a replay), no outbox effect; every load recomputes the record digest,
 *  checks the aggregate and scope it was read under and re-judges the entry. */
export class DurableOrchestrationResumeStore implements OrchestrationResumeStore {
  constructor(private readonly workflow: DurableWorkflowRepository) {}

  async append(input: { scope: OrchestrationRunScope; entry: OrchestrationResumeInput; at: string; expectedRevision?: number }): Promise<OrchestrationResumeAppendResult> {
    let judged: { scope: OrchestrationRunScope; at: string; entry: StoredResumeEntry; expectedRevision: number | null };
    try {
      if (!isRecord(input as unknown)) refuse("invalid_record", "$");
      const own = (key: string): unknown => Reflect.getOwnPropertyDescriptor(input, key)?.value;
      const envelope = capturePlainJson({ scope: own("scope"), at: own("at"), expectedRevision: own("expectedRevision") ?? null }, "$", 4_096);
      if (!envelope.ok) refuse("invalid_record", issuePath(envelope.issues, "$"));
      const value = envelope.value;
      if (!isRecord(value)) refuse("invalid_record", "$");
      const scope = scopeOf(value.scope);
      if (!isOrchestrationTimestamp(value.at)) refuse("invalid_record", "$.at");
      if (value.expectedRevision !== null && !boundedInteger(value.expectedRevision, Number.MAX_SAFE_INTEGER - 1)) refuse("invalid_record", "$.expectedRevision");
      judged = { scope, at: value.at, entry: storedResumeEntry(own("entry")), expectedRevision: value.expectedRevision as number | null };
    } catch (error) {
      const outcome = refused(error);
      return { ok: false, code: "invalid_record", message: outcome ? outcome.message : "The resume entry could not be judged (a hostile object); nothing was written." };
    }
    const { scope, entry } = judged;
    const identity = resumeIdentity(scope);
    const expectedRevision = judged.expectedRevision ?? (await this.workflow.loadHead<StoredResumePayload>(identity))?.revision ?? 0;
    const payload: StoredResumePayload = { schema: ORCHESTRATION_RESUME_RECORD_SCHEMA, runId: scope.runId, revision: expectedRevision + 1, at: judged.at, entry };
    const recordDigest = orchestrationResumeRecordDigest(payload);
    try {
      const committed = await this.workflow.commit<{ revision: number; recordDigest: string }>({
        scope: resumeScope(scope), scopeKey: durableScopeKey(resumeScope(scope), `agent-orchestration-resume:${scope.runId}`), idempotencyKey: orchestrationResumeIdempotencyKey(scope.runId, entry),
        operations: [{ aggregateType: ORCHESTRATION_RESUME_AGGREGATE_TYPE, aggregateKey: identity.aggregateKey, expectedRevision, payload, recordDigest }],
        result: { revision: payload.revision, recordDigest }, committedAt: judged.at, outbox: [] /* no outbox effect (D21-28) */,
      });
      return { ok: true, revision: committed.result.revision, recordDigest: committed.result.recordDigest, replayed: committed.idempotent };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/REVISION|CONFLICT|STALE/i.test(message)) return { ok: false, code: "stale_revision", message: "The resume record moved while this write was in flight; nothing was written over." };
      throw error;
    }
  }

  async history(scope: OrchestrationRunScope): Promise<OrchestrationResumeRecordEntry[]> {
    const run = readScope(scope);
    const identity = resumeIdentity(run);
    const records = await this.workflow.history<StoredResumePayload>(identity);
    return [...records].sort((a, b) => a.revision - b.revision).map((raw, index) => {
      const payload = raw.payload;
      if (raw.aggregateType !== ORCHESTRATION_RESUME_AGGREGATE_TYPE || raw.aggregateKey !== identity.aggregateKey || raw.scope?.tenantId !== identity.scope.tenantId || raw.scope.projectId !== identity.scope.projectId || raw.scope.branchId !== identity.scope.branchId) resumeMismatch();
      if (raw.revision !== index + 1 || !isRecord(payload as unknown) || payload.schema !== ORCHESTRATION_RESUME_RECORD_SCHEMA || payload.runId !== run.runId || payload.revision !== raw.revision) resumeMismatch();
      if (Object.keys(payload).sort().join(",") !== "at,entry,revision,runId,schema" || !isOrchestrationTimestamp(payload.at) || orchestrationResumeRecordDigest(payload) !== raw.recordDigest) resumeMismatch();
      return { revision: raw.revision, at: payload.at, recordDigest: raw.recordDigest, entry: loadedResumeEntry(payload.entry) };
    });
  }
}

const RESUME_STORES = new WeakMap<OrchestrationRunStore, OrchestrationResumeStore>();
/** [B21 E3] The durable record's resume store, on the SAME repository (one per record); a store that is not the durable one (a test
 *  double, the unavailable default) has none - its runs are then never recorded for a resume and a resume of them is unavailable. The
 *  repository is the record's own private field, read here by name because the constructor line is pinned (E2b's C90). */
export function orchestrationResumeStoreOf(store: OrchestrationRunStore): OrchestrationResumeStore | null {
  if (!(store instanceof DurableOrchestrationRunStore)) return null;
  const known = RESUME_STORES.get(store);
  if (known) return known;
  const bound = new DurableOrchestrationResumeStore(store["workflow"]);
  RESUME_STORES.set(store, bound);
  return bound;
}

// ─── [B21 E3 fix: security-1] The credential shapes the resume record withholds an answer for ───────────────────────────────────────
// Appended on purpose: the list is read only when an answer is stored, so no line cited above moves. The shared rule of the redaction
// authority (`containsTokenAnchoredSecretShapedText`, unchanged) knows the model keys, bearer tokens and upper-case `KEY=value` dumps;
// the coordinator's answer is the one text E3 persists whole, so the record refuses these further shapes as well - a false positive
// only replays the closed placeholder instead of the answer (never a leak), a false negative would persist a credential.

/** [B21 E3 fix: security-1] Each shape by name; an answer matching any is WITHHELD (`answer_refused`, its digest kept), never stored. */
export const ORCHESTRATION_RESUME_CREDENTIAL_SHAPES: ReadonlyArray<{ name: string; pattern: RegExp }> = Object.freeze([ // every quantifier bounded: linear on a 60 000-character answer
  { name: "pem-private-key", pattern: /-{5}BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY(?: BLOCK)?-{5}/ }, // [B21 E3 lead] a PGP private key block too
  { name: "aws-key-id", pattern: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA)[0-9A-Z]{16}\b/ },
  { name: "github-token", pattern: /\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{20}/ },
  { name: "slack-token", pattern: /\bxox[abposr]-[A-Za-z0-9-]{10}/ },
  { name: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{8,1024}\.eyJ[A-Za-z0-9_-]{8,1024}\.[A-Za-z0-9_-]{8}/ },
  { name: "url-password", pattern: /\b[a-z][a-z0-9+.-]{0,30}:\/\/[^\s/:@]{1,256}:[^\s/@]{6,256}@/i },
  { name: "secret-pair", pattern: /\b[a-z0-9_.-]{0,40}(?:secret|token|passw(?:or)?d|pwd|api[_-]?key|private[_-]?key|access[_-]?key|credential)[a-z0-9_.-]{0,40}["']?\s{0,8}[:=]\s{0,8}["']?[^\s"',;]{8}/i },
]);
/** [B21 E3 fix: security-1] The first credential shape an answer holds, by name, or null. */
export function resumeAnswerCredentialShape(text: string): string | null {
  return ORCHESTRATION_RESUME_CREDENTIAL_SHAPES.find((shape) => shape.pattern.test(text))?.name ?? null;
}
