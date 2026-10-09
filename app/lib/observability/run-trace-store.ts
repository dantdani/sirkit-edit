/**
 * [B24-C1] D24-20, OD-207: the durable run trace, `agent.run-trace.v1`. The chat route's recorder builds, validates and finalizes one
 * `sirkit.agent-run-trace.v1` document per run (`app/lib/agent/trace-recorder.ts`); this store keeps that validated document on the
 * durable-workflow substrate, so a finished run can be inspected by its run id. The designs copied are B23-B2's
 * `mfg.provider-exchange.v1` (exchange-ledger.ts) and B21-E2b's per-task trace store (`trace-attribution.ts`):
 *  - one silent aggregate per (scope, run id), keyed `durableWorkflowId("agent-run-trace", { ...scope, runId })`; a resume reuses its
 *    run id, so a run's aggregate is a history - one record per trace id, in revision order;
 *  - every append is a compare-and-set commit with no outbox effect (`outbox: []`), idempotent by `agent-run-trace:<runId>:<traceId>`
 *    under the scope key `durableScopeKey(scope, "agent-run-trace:<runId>")`, so the same trace again answers from its replay; a
 *    stale revision is retried on the new head at most `casAttempts` times, then the append answers `stale_exhausted`;
 *  - a document the trace validator refuses (or whose scope the substrate would refuse), a scope other than the document's own, or an
 *    invalid time is a closed refusal, and nothing is written; scopes are compared and keyed AS THE SUBSTRATE STORES THEM (NFC,
 *    trimmed: `canonicalDurableScope`), so an id that differs only by surrounding whitespace names the same aggregate ([B24-C1 review 2]
 *    security-1: such a document was a `scope_mismatch` that silently lost its run; the chat route refuses such an id before its
 *    recorder exists, so this is defense in depth);
 *  - every load recomputes the record digest and the trace digest, re-validates the document and checks the run id, the trace id,
 *    the scope and the revision continuity, refusing any disagreement with one closed error, AGENT_RUN_TRACE_MISMATCH.
 *
 * A record keeps the trace exactly as the recorder validated it: identities, digests, closed classes, usage counts and bounded
 * warnings (a warning may carry up to 80 characters of a model-chosen tool name, `loop.ts`; [B24-C1 review 2] security-5) - never a
 * prompt, an answer, a provider body or hidden reasoning (the v1 contract, `trace.ts`). The repository is INJECTED:
 * the chat composition root binds the durable one (`app/api/chat/trace-runtime.ts`); tests bind the in-memory one or PGlite. This
 * module never imports the durable runtime, the database client or the outbox (b24-c1-durable-trace pins its imports).
 */
import { canonicalDurableScope, durableAggregateIdentity, durableScopeKey, durableWorkflowId } from "../durable-workflow/stable";
import type { DurableAggregateIdentity, DurableAggregateRecord, DurableWorkflowRepository, DurableWorkflowScope } from "../durable-workflow/types";
import { agentRunTraceDigest, validateAgentRunTrace, type AgentRunTrace } from "../agent/trace";
import { engineeringDigest } from "../engineering/stable";

export const RUN_TRACE_AGGREGATE_TYPE = "agent.run-trace.v1" as const;
export const RUN_TRACE_RECORD_SCHEMA = "sirkit.agent-run-trace-record.v1" as const;
/** The record's closed keys, in order. */
export const RUN_TRACE_RECORD_KEYS = Object.freeze(["schema", "runId", "traceId", "revision", "at", "digest", "document"] as const);
export const RUN_TRACE_STORE_BOUNDS = Object.freeze({ casAttempts: 8 });
/** The closed refusals of an append (nothing is written under any of them). */
export const RUN_TRACE_REFUSALS = Object.freeze(["invalid_document", "scope_mismatch", "invalid_time", "stale_exhausted"] as const);
export type RunTraceRefusal = (typeof RUN_TRACE_REFUSALS)[number];
export const RUN_TRACE_MISMATCH = "AGENT_RUN_TRACE_MISMATCH" as const;

export interface RunTraceRecord {
  schema: typeof RUN_TRACE_RECORD_SCHEMA;
  runId: string;
  traceId: string;
  revision: number;
  at: string;
  /** `agentRunTraceDigest(document)` */
  digest: string;
  document: AgentRunTrace;
}
export interface RunTraceRecordEntry { revision: number; recordDigest: string; record: RunTraceRecord }
export type RunTraceAppendResult =
  | { ok: true; revision: number; recordDigest: string; replayed: boolean }
  | { ok: false; code: RunTraceRefusal; message: string };
export interface RunTraceStore {
  append(input: { scope: DurableWorkflowScope; document: AgentRunTrace; at: string }): Promise<RunTraceAppendResult>;
  /** Every record kept for one run id in its scope, in revision order, each re-verified. */
  history(scope: DurableWorkflowScope, runId: string): Promise<RunTraceRecordEntry[]>;
}

/** A stored record that fails its digests, its document's validation, its identity or the revision order: nothing is returned. */
export class RunTraceIntegrityError extends Error {
  readonly code = RUN_TRACE_MISMATCH;
  constructor() {
    super(`${RUN_TRACE_MISMATCH}: a stored run trace failed its digest, validation or identity check; nothing was returned`);
    this.name = "RunTraceIntegrityError";
  }
}

/** A run or trace id the store keys on: the recorder's ids (`run-<uuid>`, `trace-<uuid>`) and any bounded id of the same alphabet. */
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
/** An ISO-8601 instant in UTC with milliseconds, as `Date.prototype.toISOString` writes it. */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const isInstant = (value: unknown): value is string => typeof value === "string" && INSTANT.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const sameScope = (a: DurableWorkflowScope, b: DurableWorkflowScope): boolean => a.tenantId === b.tenantId && a.projectId === b.projectId && a.branchId === b.branchId;
const scopeOf = (scope: DurableWorkflowScope): DurableWorkflowScope => ({ tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId });

/** The aggregate key of one run's trace history in its scope, as the substrate stores the scope (throws DW_*_INVALID on one it would refuse). */
export function runTraceAggregateKey(scope: DurableWorkflowScope, runId: string): string {
  return durableWorkflowId("agent-run-trace", { ...canonicalDurableScope(scopeOf(scope)), runId });
}
function runTraceIdentity(scope: DurableWorkflowScope, runId: string): DurableAggregateIdentity {
  return durableAggregateIdentity(scopeOf(scope), RUN_TRACE_AGGREGATE_TYPE, runTraceAggregateKey(scope, runId));
}
export function runTraceRecordDigest(record: RunTraceRecord): string {
  return engineeringDigest({ schema: RUN_TRACE_AGGREGATE_TYPE, record });
}
/** The scope as the durable substrate stores it (NFC, trimmed), or null when the substrate would refuse it (blank, oversized, a control character). */
function canonicalOrNull(scope: DurableWorkflowScope): DurableWorkflowScope | null {
  try {
    return canonicalDurableScope(scopeOf(scope)); // [B24-C1 review 2] security-1: a padded id is the same scope, no longer a refusal
  } catch {
    return null;
  }
}
/** A revision conflict or a unique-index refusal: another append moved the head first (in memory, or on PostgreSQL). */
function contended(error: unknown): boolean {
  const seen = new Set<unknown>();
  for (let current: unknown = error; current !== null && typeof current === "object" && !seen.has(current); current = (current as { cause?: unknown }).cause) {
    seen.add(current);
    const message = current instanceof Error ? current.message : "";
    if (message === "DW_OPTIMISTIC_REVISION_CONFLICT" || (current as { code?: unknown }).code === "23505" || message.includes("duplicate key value violates unique constraint")) return true;
  }
  return false;
}
const refuse = (code: RunTraceRefusal, message: string): RunTraceAppendResult => ({ ok: false, code, message });

/** [B24-C1] The durable run trace over an injected durable-workflow repository. */
export class DurableRunTraceStore implements RunTraceStore {
  constructor(private readonly workflow: DurableWorkflowRepository) {}

  async append(input: { scope: DurableWorkflowScope; document: AgentRunTrace; at: string }): Promise<RunTraceAppendResult> {
    let issues: string[];
    try { issues = validateAgentRunTrace(input.document); } catch { issues = ["validator failed"]; }
    if (issues.length > 0) return refuse("invalid_document", "The trace document failed the run-trace validator; nothing was written.");
    const document = input.document;
    if (!ID.test(document.runId) || !ID.test(document.traceId)) return refuse("invalid_document", "The trace's run or trace id is outside the store's id rule; nothing was written.");
    const scope = canonicalOrNull(document.scope); // keyed by the document's own scope as the substrate stores it
    if (scope === null) return refuse("invalid_document", "The trace's scope is outside the substrate's scope rule; nothing was written.");
    const under = canonicalOrNull(input.scope);
    if (under === null || !sameScope(under, scope)) return refuse("scope_mismatch", "The trace is appended under a scope other than its own; nothing was written.");
    if (!isInstant(input.at)) return refuse("invalid_time", "The record's time is not an ISO-8601 instant; nothing was written.");
    const { runId, traceId } = document;
    const digest = agentRunTraceDigest(document);
    const identity = runTraceIdentity(scope, runId);
    const scopeKey = durableScopeKey(scope, `agent-run-trace:${runId}`);
    const idempotencyKey = `agent-run-trace:${runId}:${traceId}`;
    for (let tries = 0; tries < RUN_TRACE_STORE_BOUNDS.casAttempts; tries += 1) {
      const head = await this.workflow.loadHead<RunTraceRecord>(identity);
      const expectedRevision = head?.revision ?? 0;
      const record: RunTraceRecord = { schema: RUN_TRACE_RECORD_SCHEMA, runId, traceId, revision: expectedRevision + 1, at: input.at, digest, document };
      const recordDigest = runTraceRecordDigest(record);
      try {
        const committed = await this.workflow.commit<{ revision: number; recordDigest: string }>({
          scope, scopeKey, idempotencyKey,
          operations: [{ aggregateType: RUN_TRACE_AGGREGATE_TYPE, aggregateKey: identity.aggregateKey, expectedRevision, payload: record, recordDigest }],
          outbox: [], // silent: a trace is never a command a handler could re-run
          result: { revision: record.revision, recordDigest }, committedAt: input.at,
        });
        return { ok: true, revision: committed.result.revision, recordDigest: committed.result.recordDigest, replayed: committed.idempotent };
      } catch (error) {
        if (!contended(error)) throw error;
        // the head moved: by this very append (a concurrent duplicate), which is a replay, or by another trace of the run - try the new head
        const replay = await this.workflow.getReplay<{ revision: number; recordDigest: string }>(scope, scopeKey, idempotencyKey);
        if (replay) return { ok: true, revision: replay.result.revision, recordDigest: replay.result.recordDigest, replayed: true };
      }
    }
    return refuse("stale_exhausted", `The run's trace head kept moving for ${RUN_TRACE_STORE_BOUNDS.casAttempts} attempts; nothing was written.`);
  }

  async history(scope: DurableWorkflowScope, runId: string): Promise<RunTraceRecordEntry[]> {
    const canonical = canonicalOrNull(scope);
    if (canonical === null || !ID.test(runId)) return [];
    const records = await this.workflow.history<RunTraceRecord>(runTraceIdentity(canonical, runId));
    return [...records].sort((a, b) => a.revision - b.revision).map((raw: DurableAggregateRecord<RunTraceRecord>, index) => verifiedEntry(raw, index, canonical, runId));
  }
}

/** Re-verify one stored record of `runId`'s history at position `index`, or throw AGENT_RUN_TRACE_MISMATCH. */
function verifiedEntry(raw: DurableAggregateRecord<RunTraceRecord>, index: number, scope: DurableWorkflowScope, runId: string): RunTraceRecordEntry {
  try {
    return checkedEntry(raw, index, scope, runId);
  } catch {
    throw new RunTraceIntegrityError(); // one closed error: nothing of the stored row is echoed
  }
}
function checkedEntry(raw: DurableAggregateRecord<RunTraceRecord>, index: number, scope: DurableWorkflowScope, runId: string): RunTraceRecordEntry {
  const mismatch = (): never => { throw new RunTraceIntegrityError(); };
  const record = raw.payload as unknown as Record<string, unknown>;
  if (raw.aggregateType !== RUN_TRACE_AGGREGATE_TYPE || raw.aggregateKey !== runTraceAggregateKey(scope, runId) || !sameScope(raw.scope, scope) || raw.revision !== index + 1) mismatch();
  if (record === null || typeof record !== "object" || Array.isArray(record)) mismatch();
  const keys = Object.keys(record);
  if (keys.length !== RUN_TRACE_RECORD_KEYS.length || !RUN_TRACE_RECORD_KEYS.every((key) => Object.prototype.hasOwnProperty.call(record, key))) mismatch();
  const typed = raw.payload;
  if (typed.schema !== RUN_TRACE_RECORD_SCHEMA || typed.revision !== raw.revision || typed.runId !== runId || !isInstant(typed.at)) mismatch();
  if (runTraceRecordDigest(typed) !== raw.recordDigest) mismatch();
  let issues: string[];
  try { issues = validateAgentRunTrace(typed.document); } catch { issues = ["validator failed"]; }
  if (issues.length > 0 || agentRunTraceDigest(typed.document) !== typed.digest) mismatch();
  if (typed.document.runId !== runId || typed.document.traceId !== typed.traceId || !sameScope(canonicalOrNull(typed.document.scope) ?? mismatch(), scope)) mismatch();
  return { revision: raw.revision, recordDigest: raw.recordDigest, record: structuredClone(typed) };
}
