/**
 * [B18-B] The DURABLE execution-grant store — server authority over the
 * durable-workflow repository (D18-2):
 *
 *  - one aggregate per grant (`agent.execution-grant.v1`, branch-scoped) whose
 *    aggregate revision is the grant's state revision; every transition is ONE
 *    compare-and-set commit with `expectedRevision` = the head just read;
 *  - one index aggregate per (principal, editor) written in the SAME commit
 *    (`agent.execution-grant-index.v1`: the live grant ids and a bounded
 *    retry-guard tail) so supersession and sweeps never scan heads;
 *  - one outbox event per transition (ids/digests/principal/family/decision/
 *    reason — never instruction text, never operations, never the nonce);
 *  - digest-verified loads: a head whose repository digest, revision or grant
 *    digest disagrees with its payload is refused, never trusted;
 *  - lazy expiry applied on every load (`expired`, `consumed_unsettled`).
 *
 * This module never decides policy: minting decisions live in `mint.ts`,
 * consumption checks in `consume.ts`. Import-gated: never from the agent or
 * provider layers.
 */
import { getDurableWorkflowRepository } from "../durable-workflow/runtime";
import { durableAggregateIdentity, durableScopeKey, durableWorkflowDigest, durableWorkflowId } from "../durable-workflow/stable";
import type { DurableAppendOperation, DurableOutboxEffect, DurableWorkflowRepository, DurableWorkflowScope } from "../durable-workflow/types";
import {
  EXECUTION_GRANT_AGGREGATE_TYPE, EXECUTION_GRANT_INDEX_AGGREGATE_TYPE, MAX_INDEX_RECENT, RETRY_GUARD_WINDOW_MS,
  grantDigestFor, lazyExpiryTransition, transitionGrant,
  type ExecutionGrantConsumption, type ExecutionGrantIndex, type ExecutionGrantRecord, type ExecutionGrantRetirement, type ExecutionGrantSettlement, type ExecutionGrantState, type GrantTransition,
} from "../engineering/execution-grant";

export interface LoadedGrant { record: ExecutionGrantRecord; revision: number }

export type GrantStoreResult =
  | { ok: true; grant: LoadedGrant; idempotent: boolean }
  | { ok: false; code: "not_found" | "invalid_transition" | "conflict"; message: string; grant: LoadedGrant | null };

const grantKey = (grantId: string): string => durableWorkflowId("agent-execution-grant", { grantId });
const indexKey = (principalId: string, editor: string): string => durableWorkflowId("agent-execution-grant-index", { principalId, editor });
const scopeKeyFor = (scope: DurableWorkflowScope): string => durableScopeKey(scope, "agent-execution-grant");
const EMPTY_INDEX: ExecutionGrantIndex = { live: [], recent: [] };

function auditPayload(record: ExecutionGrantRecord, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const b = record.binding;
  return {
    grantId: record.grantId, identityKey: record.identityKey, principalId: b.authorization.principalId, membershipRevision: b.authorization.membershipRevision,
    family: b.operation.family, decision: b.operation.decision, status: record.state.status, operationsDigest: b.proposal.operationsDigest, targetsDigest: b.targets.targetsDigest, runId: b.session.runId,
    ...extra,
  };
}

function outbox(record: ExecutionGrantRecord, eventType: string, extra: Record<string, unknown> = {}): DurableOutboxEffect {
  return { owner: { aggregateType: EXECUTION_GRANT_AGGREGATE_TYPE, aggregateKey: grantKey(record.grantId) }, eventType, eventVersion: 1, topic: eventType, payload: auditPayload(record, extra) };
}

/** What a recent identical execution may have done (the minter words its note from it). */
export type RetryGuardOutcome = "in_flight" | "committed" | "poisoned" | "unknown";
/** Retirements AFTER a consumption whose commit outcome the server never learned. */
const OUTCOME_UNKNOWN_RETIREMENTS: readonly string[] = Object.freeze(["recovery_required", "consumed_unsettled"]);

function mayHaveChanged(entry: ExecutionGrantIndex["recent"][number]): RetryGuardOutcome | null {
  if (entry.status === "consumed") return "in_flight";
  if (entry.status === "settled" && entry.outcome === "committed") return "committed";
  if (entry.status === "settled" && entry.outcome === "poisoned") return "poisoned";
  if (entry.status === "retired" && typeof entry.reason === "string" && OUTCOME_UNKNOWN_RETIREMENTS.includes(entry.reason)) return "unknown";
  return null;
}

export class ExecutionGrantStore {
  constructor(private readonly workflow: DurableWorkflowRepository) {}

  private grantIdentity(scope: DurableWorkflowScope, grantId: string) {
    return durableAggregateIdentity(scope, EXECUTION_GRANT_AGGREGATE_TYPE, grantKey(grantId));
  }
  private indexIdentity(scope: DurableWorkflowScope, principalId: string, editor: string) {
    return durableAggregateIdentity(scope, EXECUTION_GRANT_INDEX_AGGREGATE_TYPE, indexKey(principalId, editor));
  }

  /** The raw head (no expiry pass); digest-, revision- and grant-digest-verified. */
  private async head(scope: DurableWorkflowScope, grantId: string): Promise<LoadedGrant | null> {
    const head = await this.workflow.loadHead<ExecutionGrantRecord>(this.grantIdentity(scope, grantId));
    if (!head) return null;
    const record = head.payload;
    if (!record || record.grantId !== grantId || durableWorkflowDigest(record) !== head.recordDigest || grantDigestFor(record.nonce, record.binding) !== record.grantDigest) {
      throw new Error("EXECUTION_GRANT_RECORD_MISMATCH");
    }
    return { record: structuredClone(record), revision: head.revision };
  }

  async index(scope: DurableWorkflowScope, principalId: string, editor: string): Promise<{ index: ExecutionGrantIndex; revision: number }> {
    const head = await this.workflow.loadHead<ExecutionGrantIndex>(this.indexIdentity(scope, principalId, editor));
    if (!head) return { index: structuredClone(EMPTY_INDEX), revision: 0 };
    if (durableWorkflowDigest(head.payload) !== head.recordDigest) throw new Error("EXECUTION_GRANT_INDEX_MISMATCH");
    return { index: structuredClone(head.payload), revision: head.revision };
  }

  private indexOperation(scope: DurableWorkflowScope, principalId: string, editor: string, current: { index: ExecutionGrantIndex; revision: number }, next: ExecutionGrantIndex): DurableAppendOperation<ExecutionGrantIndex> {
    void scope;
    return { aggregateType: EXECUTION_GRANT_INDEX_AGGREGATE_TYPE, aggregateKey: indexKey(principalId, editor), expectedRevision: current.revision, payload: next };
  }

  private nextIndex(index: ExecutionGrantIndex, record: ExecutionGrantRecord, at: string): ExecutionGrantIndex {
    const live = index.live.filter((id) => id !== record.grantId);
    if (record.state.status === "issued" || record.state.status === "consumed") live.push(record.grantId);
    const recent = index.recent.filter((entry) => entry.grantId !== record.grantId);
    recent.push({ grantId: record.grantId, userMessageDigest: record.binding.instruction.userMessageDigest, family: record.binding.operation.family, targetsDigest: record.binding.targets.targetsDigest, status: record.state.status, outcome: record.state.settlement?.outcome ?? null, reason: record.state.retirement?.reason ?? null, at });
    while (recent.length > MAX_INDEX_RECENT) recent.shift();
    return { live, recent };
  }

  /** Persist a freshly ISSUED record; the same commit updates the principal's index and retires every earlier live ISSUED grant of that editor (`superseded_by_new_grant`). */
  async mint(scope: DurableWorkflowScope, record: ExecutionGrantRecord, input: { idempotencyKey: string; now: string }): Promise<{ grantId: string; revision: number; superseded: string[]; idempotent: boolean }> {
    if (record.state.status !== "issued") throw new Error("EXECUTION_GRANT_MINT_NOT_ISSUED");
    const principalId = record.binding.authorization.principalId, editor = record.binding.session.editor;
    const existing = await this.head(scope, record.grantId);
    if (existing) return { grantId: record.grantId, revision: existing.revision, superseded: [], idempotent: true };
    const current = await this.index(scope, principalId, editor);
    const operations: Array<DurableAppendOperation<object>> = [];
    const effects: DurableOutboxEffect[] = [];
    const superseded: string[] = [];
    let index = current.index;
    for (const liveId of current.index.live) {
      const live = await this.head(scope, liveId);
      if (!live || live.record.state.status !== "issued") continue;
      const retired = transitionGrant(live.record.state, { type: "retire", retirement: { reason: "superseded_by_new_grant", detail: `superseded by ${record.grantId}`, at: input.now, observedBy: "server" } });
      if (!retired.ok) continue;
      const next: ExecutionGrantRecord = { ...live.record, state: retired.state };
      operations.push({ aggregateType: EXECUTION_GRANT_AGGREGATE_TYPE, aggregateKey: grantKey(liveId), expectedRevision: live.revision, payload: next });
      effects.push(outbox(next, "agent.execution-grant-retired", { reason: "superseded_by_new_grant" }));
      index = this.nextIndex(index, next, input.now);
      superseded.push(liveId);
    }
    index = this.nextIndex(index, record, input.now);
    operations.push({ aggregateType: EXECUTION_GRANT_AGGREGATE_TYPE, aggregateKey: grantKey(record.grantId), expectedRevision: 0, payload: structuredClone(record) });
    operations.push(this.indexOperation(scope, principalId, editor, current, index));
    effects.push(outbox(record, "agent.execution-grant-issued", { ttlMs: record.binding.ttlMs, explicit: record.binding.instruction.explicit.proven }));
    const committed = await this.workflow.commit({ scope, scopeKey: scopeKeyFor(scope), idempotencyKey: input.idempotencyKey, operations, outbox: effects, result: { grantId: record.grantId, superseded }, committedAt: input.now });
    // A replayed mint (the same run + call) answers with the grant the FIRST commit minted — never a phantom id.
    const replayed = committed.idempotent ? (committed.result as { grantId?: string; superseded?: string[] }) : null;
    const grantId = replayed?.grantId ?? record.grantId;
    const head = await this.head(scope, grantId);
    if (!head) throw new Error("EXECUTION_GRANT_MINT_UNVERIFIED");
    return { grantId, revision: head.revision, superseded: replayed?.superseded ?? superseded, idempotent: committed.idempotent };
  }

  /** The grant with lazy expiry applied (an expiry is itself a durable transition). */
  /** The raw head WITHOUT the expiry pass — for the forgery checks that must write nothing (digest- and grant-digest-verified). */
  peek(scope: DurableWorkflowScope, grantId: string): Promise<LoadedGrant | null> {
    return this.head(scope, grantId);
  }

  async load(scope: DurableWorkflowScope, grantId: string, now: number): Promise<LoadedGrant | null> {
    let loaded = await this.head(scope, grantId);
    if (!loaded) return null;
    // The lazy expiry is itself a durable transition; a lost compare-and-set (a sibling grant's transition moved the
    // principal's index) is retried once against the fresh head so an overdue grant is never handed back as live.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const expiry = lazyExpiryTransition(loaded.record, now);
      if (!expiry) return loaded;
      const applied = await this.transition(scope, loaded, expiry, { idempotencyKey: `grant-expire:${grantId}:${loaded.revision}`, now: new Date(now).toISOString() });
      if (applied.ok) return applied.grant;
      if (!applied.grant) return loaded;
      loaded = applied.grant;
    }
    return loaded;
  }

  /** ONE compare-and-set transition; a conflict re-loads the head and reports it (the caller decides idempotency). */
  async transition(scope: DurableWorkflowScope, loaded: LoadedGrant, transition: GrantTransition, input: { idempotencyKey: string; now: string }): Promise<GrantStoreResult> {
    const next = transitionGrant(loaded.record.state, transition);
    if (!next.ok) return { ok: false, code: "invalid_transition", message: next.message, grant: loaded };
    const record: ExecutionGrantRecord = { ...loaded.record, state: next.state };
    const principalId = record.binding.authorization.principalId, editor = record.binding.session.editor;
    const current = await this.index(scope, principalId, editor);
    const eventType = transition.type === "consume" ? "agent.execution-grant-consumed" : transition.type === "settle" ? "agent.execution-grant-settled" : "agent.execution-grant-retired";
    const extra = transition.type === "consume" ? { attemptId: transition.consumption.attemptId, commitment: transition.consumption.commitment }
      : transition.type === "settle" ? { outcome: transition.settlement.outcome, attestation: transition.settlement.attestation, transactionId: transition.settlement.transactionId, revisionAfter: transition.settlement.revisionAfter, late: next.state.settlement?.late ?? false }
      : { reason: transition.retirement.reason, observedBy: transition.retirement.observedBy };
    try {
      const committed = await this.workflow.commit({
        scope, scopeKey: scopeKeyFor(scope), idempotencyKey: input.idempotencyKey,
        operations: [
          { aggregateType: EXECUTION_GRANT_AGGREGATE_TYPE, aggregateKey: grantKey(record.grantId), expectedRevision: loaded.revision, payload: structuredClone(record) },
          this.indexOperation(scope, principalId, editor, current, this.nextIndex(current.index, record, input.now)),
        ],
        outbox: [outbox(record, eventType, extra)],
        result: { grantId: record.grantId, status: record.state.status },
        committedAt: input.now,
      });
      const head = await this.head(scope, record.grantId);
      if (!head) throw new Error("EXECUTION_GRANT_TRANSITION_UNVERIFIED");
      return { ok: true, grant: head, idempotent: committed.idempotent };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/REVISION|CONFLICT|STALE/i.test(message)) {
        const latest = await this.head(scope, record.grantId);
        return { ok: false, code: "conflict", message: "The grant changed while this transition was in flight.", grant: latest };
      }
      throw error;
    }
  }

  consume(scope: DurableWorkflowScope, loaded: LoadedGrant, consumption: ExecutionGrantConsumption, now: string): Promise<GrantStoreResult> {
    return this.transition(scope, loaded, { type: "consume", consumption }, { idempotencyKey: `grant-consume:${loaded.record.grantId}:${consumption.attemptId}`, now });
  }

  settle(scope: DurableWorkflowScope, loaded: LoadedGrant, settlement: Omit<ExecutionGrantSettlement, "late">, now: string): Promise<GrantStoreResult> {
    const attemptId = loaded.record.state.consumption?.attemptId ?? "none";
    return this.transition(scope, loaded, { type: "settle", settlement }, { idempotencyKey: `grant-settle:${loaded.record.grantId}:${attemptId}:${settlement.outcome}`, now });
  }

  retire(scope: DurableWorkflowScope, loaded: LoadedGrant, retirement: ExecutionGrantRetirement): Promise<GrantStoreResult> {
    return this.transition(scope, loaded, { type: "retire", retirement }, { idempotencyKey: `grant-retire:${loaded.record.grantId}:${retirement.reason}:${loaded.revision}`, now: retirement.at });
  }

  /** The retry guard (§3.6): an identical instruction + family + targets that MAY have changed the board within the window —
   *  in flight (consumed), settled committed, settled POISONED (a transaction landed but could not be verified), or retired
   *  after consumption with an unknown outcome. Only a settlement that provably changed nothing (not-committed) or a grant
   *  that was never consumed leaves nothing to double-execute. [B18-C review V1] */
  async recentIdenticalExecution(scope: DurableWorkflowScope, principalId: string, editor: string, probe: { userMessageDigest: string; family: string; targetsDigest: string }, now: number): Promise<{ grantId: string; at: string; outcome: RetryGuardOutcome } | null> {
    const { index } = await this.index(scope, principalId, editor);
    for (const entry of [...index.recent].reverse()) {
      if (entry.userMessageDigest !== probe.userMessageDigest || entry.family !== probe.family || entry.targetsDigest !== probe.targetsDigest) continue;
      const outcome = mayHaveChanged(entry);
      if (!outcome) continue;
      if (now - Date.parse(entry.at) <= RETRY_GUARD_WINDOW_MS) return { grantId: entry.grantId, at: entry.at, outcome };
    }
    return null;
  }

  /** The principal's live grants of an editor (issued | consumed), expiry applied. */
  async liveGrants(scope: DurableWorkflowScope, principalId: string, editor: string, now: number): Promise<LoadedGrant[]> {
    const { index } = await this.index(scope, principalId, editor);
    const out: LoadedGrant[] = [];
    for (const grantId of index.live) {
      const loaded = await this.load(scope, grantId, now);
      if (loaded && (loaded.record.state.status === "issued" || loaded.record.state.status === "consumed")) out.push(loaded);
    }
    return out;
  }
}

export type { ExecutionGrantState };

// ── the server composition seam ─────────────────────────────────────────────
type Factory = () => ExecutionGrantStore;
const productionFactory: Factory = () => new ExecutionGrantStore(getDurableWorkflowRepository());
let factory: Factory = productionFactory;
export function resolveExecutionGrantStore(): ExecutionGrantStore { return factory(); }
export function setExecutionGrantStoreFactory(next: Factory): void { factory = next; }
export function resetExecutionGrantStoreFactory(): void { factory = productionFactory; }
