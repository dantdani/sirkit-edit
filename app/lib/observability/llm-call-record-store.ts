/**
 * [B24-C1] D24-21, OD-207: the durable LLM call record, `llm.call-record.v1` - one silent aggregate per call (`callId`), revision 1,
 * on the durable-workflow substrate, under the scope the call was made in (the route's tenant, project and branch; the reserved
 * operator scope for the two public paths). The record is `sirkit.llm-call-record.v1` itself (`llm-call-record.ts`): route, method,
 * provider, model, call kind, token counts, latency, outcome class and start time - never content.
 *
 *  - an append is a compare-and-set commit at revision 0 with no outbox effect, idempotent by `llm-call:<callId>`: the same record
 *    again answers from its replay, and a record the validator refuses, or a scope the substrate would rewrite, writes nothing;
 *  - `load` and `list(scope)` recompute the record digest and re-validate every record, refusing any disagreement with one closed error,
 *    LLM_CALL_RECORD_MISMATCH (B24-C3 reads through them).
 *
 * Pure: the repository is INJECTED (`llm-call-record-runtime.ts` binds the durable one; tests the in-memory one or PGlite); this module
 * never imports the durable runtime, the database client or the outbox.
 */
import { canonicalDurableScope, durableAggregateIdentity, durableScopeKey, durableWorkflowId } from "../durable-workflow/stable";
import type { DurableAggregateIdentity, DurableAggregateRecord, DurableWorkflowRepository, DurableWorkflowScope } from "../durable-workflow/types";
import { engineeringDigest } from "../engineering/stable";
import { LLM_CALL_RECORD_KEYS, validateLlmCallRecord, type LlmCallRecord } from "./llm-call-record";

export const LLM_CALL_AGGREGATE_TYPE = "llm.call-record.v1" as const;
export const LLM_CALL_RECORD_MISMATCH = "LLM_CALL_RECORD_MISMATCH" as const;
export const LLM_CALL_STORE_REFUSALS = Object.freeze(["invalid_record", "invalid_scope"] as const);
export type LlmCallStoreRefusal = (typeof LLM_CALL_STORE_REFUSALS)[number];
export const LLM_CALL_LIST_LIMIT = 1_000;

export interface LoadedLlmCallRecord { readonly revision: number; readonly recordDigest: string; readonly record: LlmCallRecord }
export type LlmCallAppendResult = { ok: true; recordDigest: string; replayed: boolean } | { ok: false; code: LlmCallStoreRefusal; message: string };
export interface LlmCallRecordStore {
  append(input: { scope: DurableWorkflowScope; record: LlmCallRecord }): Promise<LlmCallAppendResult>;
  /** One call's record, re-verified; null when none was kept. */
  load(scope: DurableWorkflowScope, callId: string): Promise<LoadedLlmCallRecord | null>;
  /** Every call record of a scope (at most `limit`, by aggregate key), each re-verified. */
  list(scope: DurableWorkflowScope, options?: { limit?: number }): Promise<LoadedLlmCallRecord[]>;
}

/** A stored call record that fails its digest, its validation or its identity: nothing is returned. */
export class LlmCallRecordIntegrityError extends Error {
  readonly code = LLM_CALL_RECORD_MISMATCH;
  constructor() {
    super(`${LLM_CALL_RECORD_MISMATCH}: a stored LLM call record failed its digest, validation or identity check; nothing was returned`);
    this.name = "LlmCallRecordIntegrityError";
  }
}

const scopeOf = (scope: DurableWorkflowScope): DurableWorkflowScope => ({ tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId });
const sameScope = (a: DurableWorkflowScope, b: DurableWorkflowScope): boolean => a.tenantId === b.tenantId && a.projectId === b.projectId && a.branchId === b.branchId;
function canonicalOrNull(scope: DurableWorkflowScope): DurableWorkflowScope | null {
  try {
    const canonical = canonicalDurableScope(scopeOf(scope));
    return sameScope(canonical, scope) ? canonical : null;
  } catch {
    return null;
  }
}
export function llmCallAggregateKey(scope: DurableWorkflowScope, callId: string): string {
  return durableWorkflowId("llm-call-record", { ...scopeOf(scope), callId });
}
function callIdentity(scope: DurableWorkflowScope, callId: string): DurableAggregateIdentity {
  return durableAggregateIdentity(scopeOf(scope), LLM_CALL_AGGREGATE_TYPE, llmCallAggregateKey(scope, callId));
}
export function llmCallRecordDigest(record: LlmCallRecord): string {
  return engineeringDigest({ schema: LLM_CALL_AGGREGATE_TYPE, record });
}
function contended(error: unknown): boolean {
  const seen = new Set<unknown>();
  for (let current: unknown = error; current !== null && typeof current === "object" && !seen.has(current); current = (current as { cause?: unknown }).cause) {
    seen.add(current);
    const message = current instanceof Error ? current.message : "";
    if (message === "DW_OPTIMISTIC_REVISION_CONFLICT" || (current as { code?: unknown }).code === "23505" || message.includes("duplicate key value violates unique constraint")) return true;
  }
  return false;
}

/** Re-verify one stored call record of `scope`, or throw LLM_CALL_RECORD_MISMATCH. */
function verified(raw: DurableAggregateRecord<LlmCallRecord>, scope: DurableWorkflowScope): LoadedLlmCallRecord {
  try {
    const record = raw.payload;
    const mismatch = (): never => { throw new LlmCallRecordIntegrityError(); };
    if (raw.aggregateType !== LLM_CALL_AGGREGATE_TYPE || raw.revision !== 1 || !sameScope(raw.scope, scope)) mismatch();
    if (validateLlmCallRecord(record).length > 0 || Object.keys(record).length !== LLM_CALL_RECORD_KEYS.length) mismatch();
    if (raw.aggregateKey !== llmCallAggregateKey(scope, record.callId) || llmCallRecordDigest(record) !== raw.recordDigest) mismatch();
    return { revision: raw.revision, recordDigest: raw.recordDigest, record: structuredClone(record) };
  } catch {
    throw new LlmCallRecordIntegrityError(); // one closed error: nothing of the stored row is echoed
  }
}

/** [B24-C1] The durable call record over an injected durable-workflow repository. */
export class DurableLlmCallRecordStore implements LlmCallRecordStore {
  constructor(private readonly workflow: DurableWorkflowRepository) {}

  async append(input: { scope: DurableWorkflowScope; record: LlmCallRecord }): Promise<LlmCallAppendResult> {
    if (validateLlmCallRecord(input.record).length > 0) return { ok: false, code: "invalid_record", message: "The call record failed its validator; nothing was written." };
    const scope = canonicalOrNull(input.scope);
    if (scope === null) return { ok: false, code: "invalid_scope", message: "The call record's scope is not a canonical durable scope; nothing was written." };
    const record: LlmCallRecord = { ...input.record };
    const identity = callIdentity(scope, record.callId);
    const scopeKey = durableScopeKey(scope, "llm-call-record");
    const idempotencyKey = `llm-call:${record.callId}`;
    const recordDigest = llmCallRecordDigest(record);
    try {
      const committed = await this.workflow.commit<{ recordDigest: string }>({
        scope, scopeKey, idempotencyKey,
        operations: [{ aggregateType: LLM_CALL_AGGREGATE_TYPE, aggregateKey: identity.aggregateKey, expectedRevision: 0, payload: record, recordDigest }],
        outbox: [], // silent: a call record is never a command a handler could re-run
        result: { recordDigest }, committedAt: record.startedAt,
      });
      return { ok: true, recordDigest: committed.result.recordDigest, replayed: committed.idempotent };
    } catch (error) {
      if (!contended(error)) throw error;
      const replay = await this.workflow.getReplay<{ recordDigest: string }>(scope, scopeKey, idempotencyKey);
      if (replay) return { ok: true, recordDigest: replay.result.recordDigest, replayed: true };
      throw error;
    }
  }

  async load(scope: DurableWorkflowScope, callId: string): Promise<LoadedLlmCallRecord | null> {
    const canonical = canonicalOrNull(scope);
    if (canonical === null) return null;
    const head = await this.workflow.loadHead<LlmCallRecord>(callIdentity(canonical, callId));
    if (head === null) return null;
    const loaded = verified(head, canonical);
    if (loaded.record.callId !== callId) throw new LlmCallRecordIntegrityError();
    return loaded;
  }

  async list(scope: DurableWorkflowScope, options: { limit?: number } = {}): Promise<LoadedLlmCallRecord[]> {
    const canonical = canonicalOrNull(scope);
    if (canonical === null) return [];
    const limit = Math.max(1, Math.min(LLM_CALL_LIST_LIMIT, Math.floor(options.limit ?? LLM_CALL_LIST_LIMIT)));
    const heads = await this.workflow.listHeads<LlmCallRecord>({ aggregateType: LLM_CALL_AGGREGATE_TYPE, scope: canonical, limit });
    return heads.map((head) => verified(head, canonical));
  }
}
