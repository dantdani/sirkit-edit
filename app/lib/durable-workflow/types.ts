export const DURABLE_WORKFLOW_RECORD_VERSION = "sirkit.durable-workflow-record.v1" as const;
export const DURABLE_WORKFLOW_OUTBOX_VERSION = "sirkit.durable-workflow-outbox.v2" as const;

export interface DurableWorkflowScope { tenantId: string; projectId: string; branchId: string; }
export interface DurableAggregateIdentity { scope: DurableWorkflowScope; aggregateType: string; aggregateKey: string; }

export interface DurableAggregateRecord<T extends object = object> {
  schemaVersion: typeof DURABLE_WORKFLOW_RECORD_VERSION;
  recordId: string; headId: string; aggregateType: string; aggregateKey: string;
  scope: DurableWorkflowScope; revision: number; recordDigest: string; payload: T; createdAt: string;
}

export interface DurableAppendOperation<T extends object = object> {
  aggregateType: string; aggregateKey: string; expectedRevision: number; payload: T; recordDigest?: string;
}

export interface DurableOutboxEffect {
  owner: { aggregateType: string; aggregateKey: string };
  eventType: string; eventVersion: number; topic: string;
  payload: Record<string, unknown>; idempotencyKey?: string;
  /** [PR-L, 2026-10-17] S1 (task-worker-contract.md section 3.4): the earliest dispatch time, at or after the commit's `committedAt`
   *  (the default), so a delayed retry (backoff, Retry-After) is scheduled atomically with the checkpoint that decided it. Both
   *  repositories refuse an unparseable or earlier value (DW_OUTBOX_AVAILABLE_AT_INVALID); `claimOutbox` honours it. Not digested:
   *  like `failOutbox`'s `retryAt`, it is dispatch state, not event identity. */
  availableAt?: string;
}

export type DurableOutboxState = "pending" | "processing" | "completed" | "failed";

export interface DurableOutboxEvent<T extends object = Record<string, unknown>> {
  schemaVersion: typeof DURABLE_WORKFLOW_OUTBOX_VERSION;
  eventId: string; scope: DurableWorkflowScope; scopeKey: string;
  ownerAggregateType: string; ownerAggregateKey: string; ownerAggregateRevision: number;
  eventType: string; eventVersion: number; topic: string; idempotencyKey: string;
  payloadDigest: string; eventDigest: string; payload: T; state: DurableOutboxState;
  attempts: number; availableAt: string; leaseOwner?: string; leaseToken?: string;
  leaseExpiresAt?: string; lastErrorCode?: string; createdAt: string; completedAt?: string; terminalAt?: string;
}

export interface DurableCommitRequest<TResult extends object = object> {
  scope: DurableWorkflowScope; scopeKey: string; idempotencyKey: string;
  operations: Array<DurableAppendOperation<object>>; outbox: DurableOutboxEffect[];
  result: TResult; committedAt: string;
}

export interface DurableCommitResult<TResult extends object = object> {
  records: DurableAggregateRecord[]; outbox: DurableOutboxEvent[]; result: TResult; idempotent: boolean;
}

export interface DurableWorkflowRepository {
  loadHead<T extends object = object>(identity: DurableAggregateIdentity): Promise<DurableAggregateRecord<T> | null>;
  listHeads<T extends object = object>(input: { aggregateType: string; scope: DurableWorkflowScope; limit?: number }): Promise<Array<DurableAggregateRecord<T>>>;
  loadRecord<T extends object = object>(scope: DurableWorkflowScope, recordId: string): Promise<DurableAggregateRecord<T> | null>;
  history<T extends object = object>(identity: DurableAggregateIdentity): Promise<Array<DurableAggregateRecord<T>>>;
  getReplay<TResult extends object = object>(scope: DurableWorkflowScope, scopeKey: string, idempotencyKey: string): Promise<DurableCommitResult<TResult> | null>;
  commit<TResult extends object = object>(request: DurableCommitRequest<TResult>): Promise<DurableCommitResult<TResult>>;
  claimOutbox(input: { workerId: string; now: string; leaseUntil: string; limit: number; topics?: string[]; scope?: DurableWorkflowScope }): Promise<DurableOutboxEvent[]>;
  completeOutbox(input: { scope: DurableWorkflowScope; eventId: string; workerId: string; leaseToken: string; completedAt: string }): Promise<void>;
  failOutbox(input: { scope: DurableWorkflowScope; eventId: string; workerId: string; leaseToken: string; errorCode: string; failedAt: string; retryAt: string; terminal: boolean }): Promise<void>;
  listOutbox(input?: { scope?: DurableWorkflowScope; scopeKey?: string; state?: DurableOutboxState; topic?: string; eventType?: string }): Promise<DurableOutboxEvent[]>;
  /** [PR-L, 2026-10-17] S2 (task-worker-contract.md section 3.4): extend a HELD lease - one fenced update that matches only the
   *  `processing` event of this scope, owner and token whose lease has not yet expired at `now`; anything else (lapsed, re-claimed,
   *  completed, failed, another scope) is DW_OUTBOX_LEASE_LOST and changes nothing. `leaseUntil` must be after `now`
   *  (DW_OUTBOX_LEASE_INVALID). The token is unchanged, so complete/fail stay fenced by it. Optional on the interface so the read-only
   *  views and test doubles that enumerate the repository keep compiling; both concrete repositories implement it, and a caller that
   *  needs renewal (the generation-task store) refuses a repository without it. */
  renewOutboxLease?(input: { scope: DurableWorkflowScope; eventId: string; workerId: string; leaseToken: string; now: string; leaseUntil: string }): Promise<void>;
}
