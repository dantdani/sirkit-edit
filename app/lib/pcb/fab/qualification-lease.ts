/**
 * [B16-A F7] Durable single-flight lease for board qualification.
 *
 * Reproduced defect: "one qualification per board at a time" was a
 * process-local Map, so on any multi-instance or serverless deployment two
 * concurrent qualifications of the same board BOTH created a router and ran
 * FreeRouting; only the aggregate compare-and-swap at commit refused the
 * loser (as MFG_BOARD_REVISION_CONFLICT, not MFG_QUALIFICATION_IN_PROGRESS).
 *
 * The lease is an aggregate in the durable workflow repository, so every
 * instance sees the same truth: acquisition is a compare-and-swap append on
 * the lease's current revision (two racing acquirers cannot both win — the
 * second sees DW_OPTIMISTIC_REVISION_CONFLICT), a held lease refuses new
 * acquirers until it is released or its TTL lapses (a crashed holder never
 * blocks a board forever), and release is refused for a token that no longer
 * holds the lease (an expired holder cannot release its successor's lease).
 */

import type { DurableWorkflowRepository, DurableWorkflowScope } from "../../durable-workflow/types";
import { durableAggregateIdentity, durableScopeKey, durableWorkflowId } from "../../durable-workflow/stable";

const LEASE = "mfg.qualification-lease.v1";

export interface QualificationLeaseScope { tenantId: string; projectId: string; branchId: string; boardId: string }

export interface QualificationLeaseRecord {
  schemaVersion: "sirkit.qualification-lease.v1";
  state: "held" | "released";
  /** Opaque holder label (the request's correlation id) — never a credential. */
  holder: string;
  token: string;
  acquiredAt: string;
  expiresAt: string;
  releasedAt?: string;
}

export type QualificationLeaseAcquisition =
  | { ok: true; token: string; revision: number; expiresAt: string }
  | { ok: false; reason: "held" | "raced"; holder?: string; expiresAt?: string };

/** Longer than the route's own maximum duration (300 s) so a live run is never pre-empted, short enough that a crashed holder is not a permanent lock. */
export const QUALIFICATION_LEASE_TTL_MS = 330_000;

function workflowScope(scope: QualificationLeaseScope): DurableWorkflowScope {
  return { tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId };
}
function leaseKey(scope: QualificationLeaseScope): string {
  return durableWorkflowId("mfg-qualification-lease", { tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId, boardId: scope.boardId });
}

export class DurableQualificationLease {
  constructor(private readonly workflow: DurableWorkflowRepository, private readonly options: { ttlMs?: number; now?: () => number } = {}) {}

  private head(scope: QualificationLeaseScope) {
    return this.workflow.loadHead<QualificationLeaseRecord>(durableAggregateIdentity(workflowScope(scope), LEASE, leaseKey(scope)));
  }

  async acquire(scope: QualificationLeaseScope, holder: string): Promise<QualificationLeaseAcquisition> {
    const now = this.options.now?.() ?? Date.now();
    const current = await this.head(scope);
    if (current && current.payload.state === "held" && Date.parse(current.payload.expiresAt) > now) {
      return { ok: false, reason: "held", holder: current.payload.holder, expiresAt: current.payload.expiresAt };
    }
    const acquiredAt = new Date(now).toISOString();
    const expiresAt = new Date(now + (this.options.ttlMs ?? QUALIFICATION_LEASE_TTL_MS)).toISOString();
    const token = durableWorkflowId("mfg-qualification-lease-token", { scope, holder, acquiredAt, revision: current?.revision ?? 0 });
    const payload: QualificationLeaseRecord = { schemaVersion: "sirkit.qualification-lease.v1", state: "held", holder, token, acquiredAt, expiresAt };
    try {
      const committed = await this.workflow.commit({
        scope: workflowScope(scope),
        scopeKey: durableScopeKey(workflowScope(scope), `mfg-qualification-lease:${scope.boardId}`),
        idempotencyKey: `lease-acquire:${scope.boardId}:${token}`,
        operations: [{ aggregateType: LEASE, aggregateKey: leaseKey(scope), expectedRevision: current?.revision ?? 0, payload }],
        outbox: [],
        result: { token },
        committedAt: acquiredAt,
      });
      return { ok: true, token, revision: committed.records[0]?.revision ?? (current?.revision ?? 0) + 1, expiresAt };
    } catch (error) {
      if (error instanceof Error && error.message === "DW_OPTIMISTIC_REVISION_CONFLICT") return { ok: false, reason: "raced" };
      throw error;
    }
  }

  /** Release only the lease this token holds; a lapsed holder cannot release a successor's lease. Never throws on a lost race. */
  async release(scope: QualificationLeaseScope, token: string): Promise<boolean> {
    const current = await this.head(scope);
    if (!current || current.payload.state !== "held" || current.payload.token !== token) return false;
    const releasedAt = new Date(this.options.now?.() ?? Date.now()).toISOString();
    try {
      await this.workflow.commit({
        scope: workflowScope(scope),
        scopeKey: durableScopeKey(workflowScope(scope), `mfg-qualification-lease:${scope.boardId}`),
        idempotencyKey: `lease-release:${scope.boardId}:${token}`,
        operations: [{ aggregateType: LEASE, aggregateKey: leaseKey(scope), expectedRevision: current.revision, payload: { ...current.payload, state: "released", releasedAt } }],
        outbox: [],
        result: { token, released: true },
        committedAt: releasedAt,
      });
      return true;
    } catch (error) {
      if (error instanceof Error && error.message === "DW_OPTIMISTIC_REVISION_CONFLICT") return false;
      throw error;
    }
  }

  /** Read-only: the current holder if the lease is live. */
  async current(scope: QualificationLeaseScope): Promise<{ holder: string; expiresAt: string; revision: number } | null> {
    const now = this.options.now?.() ?? Date.now();
    const head = await this.head(scope);
    if (!head || head.payload.state !== "held" || Date.parse(head.payload.expiresAt) <= now) return null;
    return { holder: head.payload.holder, expiresAt: head.payload.expiresAt, revision: head.revision };
  }
}
