import type { DurableAggregateRecord, DurableAppendOperation, DurableWorkflowRepository, DurableWorkflowScope } from "../durable-workflow/types";
import { durableAggregateIdentity, durableScopeKey, durableWorkflowId } from "../durable-workflow/stable";
import { makeBoardRecord } from "./board";
import type { PcbBoard } from "../pcb/types";
import { authoritativeSnapshotDigest, assertPlanDigest, canonicalAuthoritativeSnapshot, pcbSyncDigest, pcbSyncId } from "./stable";
import { PCB_SYNC_AUDIT_VERSION, PCB_SYNC_DEMO_PUBLICATION_RESULT_VERSION, type PcbSyncApplyResult, type PcbSyncAuditRecord, type PcbSyncAuthoritativeSnapshot, type PcbSyncBoardRecord, type PcbSyncPlan, type PcbSyncPlanLifecycle, type PcbSyncPreflightRequest, type PcbSyncSnapshotProvider, type PcbSyncSnapshotPublicationResult, type PcbSyncSnapshotPublisher } from "./types";
import type { PcbSyncCommitInput, PcbSyncRepository, PcbSyncRepositoryScope } from "./repository";

const BOARD = "pcb-sync.board.v1";
const PLAN = "pcb-sync.plan.v1";
const AUDIT = "pcb-sync.audit-stream.v1";
const SNAPSHOT = "pcb-sync.authoritative-snapshot.v1";

function workflowScope(scope: PcbSyncRepositoryScope): DurableWorkflowScope { return { tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId }; }
function repositoryIdentity(scope: PcbSyncRepositoryScope): PcbSyncRepositoryScope { return { tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId, boardId: scope.boardId }; }
function boardKey(scope: PcbSyncRepositoryScope): string { return durableWorkflowId("pcb-sync-board", repositoryIdentity(scope)); }
function planKey(scope: PcbSyncRepositoryScope, planId: string): string { return durableWorkflowId("pcb-sync-plan-key", { ...repositoryIdentity(scope), planId }); }
function auditKey(scope: PcbSyncRepositoryScope): string { return durableWorkflowId("pcb-sync-audits", repositoryIdentity(scope)); }
function scopeKey(scope: PcbSyncRepositoryScope): string { return durableScopeKey(workflowScope(scope), `pcb-sync:${scope.boardId}`); }
function snapshotKey(input: Pick<PcbSyncAuthoritativeSnapshot, "tenantId" | "projectId" | "branchId" | "designId" | "assemblyVariantId">): string { return durableWorkflowId("pcb-sync-snapshot", { tenantId: input.tenantId, projectId: input.projectId, branchId: input.branchId, designId: input.designId, assemblyVariantId: input.assemblyVariantId }); }
function snapshotScope(input: Pick<PcbSyncAuthoritativeSnapshot, "tenantId" | "projectId" | "branchId">): DurableWorkflowScope { return { tenantId: input.tenantId, projectId: input.projectId, branchId: input.branchId }; }
function withoutSnapshotDigest(snapshot: PcbSyncAuthoritativeSnapshot): Omit<PcbSyncAuthoritativeSnapshot, "snapshotDigest"> { const { snapshotDigest: _digest, ...value } = snapshot; void _digest; return value; }
const PLAN_NUL_STORAGE = "\\u0000";
function storedPlan(plan: PcbSyncPlan): PcbSyncPlan { return { ...plan, operations: plan.operations.map((operation) => ({ ...operation, targetStableId: operation.targetStableId.replaceAll("\0", PLAN_NUL_STORAGE), orderingKey: operation.orderingKey.replaceAll("\0", PLAN_NUL_STORAGE) })) }; }
function loadedPlan(plan: PcbSyncPlan): PcbSyncPlan { return { ...plan, operations: plan.operations.map((operation) => ({ ...operation, targetStableId: operation.targetStableId.replaceAll(PLAN_NUL_STORAGE, "\0"), orderingKey: operation.orderingKey.replaceAll(PLAN_NUL_STORAGE, "\0") })) }; }

interface AuditStream { audits: PcbSyncAuditRecord[] }

/**
 * [B16-A F2] the board publication as ONE append operation, so a caller can
 * commit the board together with other aggregates (the qualification commits
 * the routed board and its manufacturing authority atomically). The record is
 * rebuilt and digest-checked exactly as `publishBoard` does.
 */
export function boardPublicationOperation(record: PcbSyncBoardRecord, expectedRevision: number): DurableAppendOperation<PcbSyncBoardRecord> {
  const scope: PcbSyncRepositoryScope = record;
  const rebuilt = makeBoardRecord({ ...scope, board: record.board, updatedAt: record.updatedAt });
  if (rebuilt.revision !== record.revision || rebuilt.digest !== record.digest) throw new Error("PS_BOARD_RECORD_DIGEST_MISMATCH");
  return { aggregateType: BOARD, aggregateKey: boardKey(scope), expectedRevision, payload: structuredClone(record), recordDigest: record.digest };
}

export class DurablePcbSyncSnapshotStore implements PcbSyncSnapshotProvider, PcbSyncSnapshotPublisher {
  constructor(private readonly workflow: DurableWorkflowRepository) {}

  async publish(snapshot: PcbSyncAuthoritativeSnapshot, input: { expectedRevision: number; idempotencyKey: string; requestId?: string; boardId?: string; actorId?: string; publishedAt: string }): Promise<PcbSyncSnapshotPublicationResult> {
    const canonicalBase = canonicalAuthoritativeSnapshot(withoutSnapshotDigest(snapshot)), digest = authoritativeSnapshotDigest(canonicalBase);
    if (digest !== snapshot.snapshotDigest) throw new Error("PS_SNAPSHOT_DIGEST_MISMATCH");
    const canonicalSnapshot: PcbSyncAuthoritativeSnapshot = { ...canonicalBase, snapshotDigest: digest };
    const key = snapshotKey(canonicalSnapshot), scope = snapshotScope(canonicalSnapshot), publicationScopeKey = durableScopeKey(scope, `pcb-sync-snapshot:${key}`);
    const requestId = input.requestId ?? `publish-${key}`, boardId = input.boardId ?? "unspecified-board", actorId = input.actorId ?? "trusted-server-coordinator";
    const replay = await this.workflow.getReplay<PcbSyncSnapshotPublicationResult>(scope, publicationScopeKey, input.idempotencyKey);
    if (replay) {
      if (replay.result.snapshotDigest !== digest || replay.result.boardId !== boardId || replay.result.actorId !== actorId) throw new Error("PS_SNAPSHOT_IDEMPOTENCY_CONFLICT");
      return structuredClone({ ...replay.result, created: false, idempotent: true });
    }
    const publication: PcbSyncSnapshotPublicationResult = { resultSchemaVersion: PCB_SYNC_DEMO_PUBLICATION_RESULT_VERSION, requestId, snapshotId: key, snapshotRevision: input.expectedRevision + 1, snapshotDigest: digest, schematicDigest: canonicalSnapshot.schematicDigest, netGraphDigest: canonicalSnapshot.netGraphDigest, scope, actorId, designId: canonicalSnapshot.designId, boardId, assemblyVariantId: canonicalSnapshot.assemblyVariantId, created: true, idempotent: false, publishedAt: input.publishedAt, snapshot: canonicalSnapshot };
    try {
      const committed = await this.workflow.commit({ scope, scopeKey: publicationScopeKey, idempotencyKey: input.idempotencyKey, operations: [{ aggregateType: SNAPSHOT, aggregateKey: key, expectedRevision: input.expectedRevision, payload: structuredClone(canonicalSnapshot), recordDigest: digest }], outbox: [{ owner: { aggregateType: SNAPSHOT, aggregateKey: key }, eventType: "pcb-sync.snapshot-published", eventVersion: 1, topic: "pcb-sync.snapshot-published", payload: { snapshotKey: key, snapshotDigest: digest } }], result: publication, committedAt: input.publishedAt });
      if (committed.result.snapshotDigest !== digest || committed.result.boardId !== boardId || committed.result.actorId !== actorId) throw new Error("PS_SNAPSHOT_IDEMPOTENCY_CONFLICT");
      return structuredClone({ ...committed.result, created: !committed.idempotent, idempotent: committed.idempotent });
    } catch (error) {
      if (error instanceof Error && error.message === "DW_OPTIMISTIC_REVISION_CONFLICT") throw new Error("PS_SNAPSHOT_REVISION_CONFLICT");
      throw error;
    }
  }

  /**
   * [B16.1C §C/§F] the CURRENT durable snapshot head for a design/variant: the
   * integer aggregate revision a fresh browser must send as
   * `expectedSnapshotRevision`, plus the schematic identity it describes.
   * Before B16.1C no read exposed this, so a new browser session (localStorage
   * empty → revision 0) could only ever collide with PS_SNAPSHOT_REVISION_CONFLICT
   * on an already-published design (pre-edit probe P1).
   */
  async getSnapshotHead(input: Pick<PcbSyncAuthoritativeSnapshot, "tenantId" | "projectId" | "branchId" | "designId" | "assemblyVariantId">): Promise<{ revision: number; snapshotDigest: string; schematicRevision: string; schematicDigest: string; netGraphDigest: string } | null> {
    const record = await this.workflow.loadHead<PcbSyncAuthoritativeSnapshot>(durableAggregateIdentity(snapshotScope(input), SNAPSHOT, snapshotKey(input)));
    if (!record) return null;
    const snapshot = record.payload;
    if (authoritativeSnapshotDigest(withoutSnapshotDigest(snapshot)) !== snapshot.snapshotDigest || record.recordDigest !== snapshot.snapshotDigest) throw new Error("PS_SNAPSHOT_DIGEST_MISMATCH");
    return { revision: record.revision, snapshotDigest: snapshot.snapshotDigest, schematicRevision: snapshot.schematicRevision, schematicDigest: snapshot.schematicDigest, netGraphDigest: snapshot.netGraphDigest };
  }

  /**
   * [B16-A F4] the EXACT applied snapshot a committed plan names (by digest),
   * read from the snapshot aggregate's durable history and digest-verified —
   * the RC01 parity source for qualification. Null when no such snapshot was
   * ever published for the design/variant.
   */
  async getSnapshotByDigest(input: Pick<PcbSyncAuthoritativeSnapshot, "tenantId" | "projectId" | "branchId" | "designId" | "assemblyVariantId">, snapshotDigest: string): Promise<PcbSyncAuthoritativeSnapshot | null> {
    const records = await this.workflow.history<PcbSyncAuthoritativeSnapshot>(durableAggregateIdentity(snapshotScope(input), SNAPSHOT, snapshotKey(input)));
    const record = [...records].reverse().find((item) => item.payload.snapshotDigest === snapshotDigest);
    if (!record) return null;
    const snapshot = record.payload;
    if (authoritativeSnapshotDigest(withoutSnapshotDigest(snapshot)) !== snapshot.snapshotDigest || record.recordDigest !== snapshot.snapshotDigest) throw new Error("PS_SNAPSHOT_DIGEST_MISMATCH");
    return structuredClone(snapshot);
  }

  async acquire(request: PcbSyncPreflightRequest, signal?: AbortSignal): Promise<PcbSyncAuthoritativeSnapshot> {
    if (signal?.aborted) throw new Error("PS_REQUEST_CANCELLED");
    const key = snapshotKey(request);
    const record = await this.workflow.loadHead<PcbSyncAuthoritativeSnapshot>(durableAggregateIdentity(snapshotScope(request), SNAPSHOT, key));
    if (!record) throw new Error("PS_SNAPSHOT_NOT_FOUND");
    const snapshot = record.payload;
    if (authoritativeSnapshotDigest(withoutSnapshotDigest(snapshot)) !== snapshot.snapshotDigest || record.recordDigest !== snapshot.snapshotDigest) throw new Error("PS_SNAPSHOT_DIGEST_MISMATCH");
    return structuredClone(snapshot);
  }
}

export class DurablePcbSyncRepository implements PcbSyncRepository {
  constructor(private readonly workflow: DurableWorkflowRepository) {}

  async publishBoard(record: PcbSyncBoardRecord, input: { expectedRevision: number; idempotencyKey: string }): Promise<void> {
    const scope: PcbSyncRepositoryScope = record;
    const rebuilt = makeBoardRecord({ ...scope, board: record.board, updatedAt: record.updatedAt });
    if (rebuilt.revision !== record.revision || rebuilt.digest !== record.digest) throw new Error("PS_BOARD_RECORD_DIGEST_MISMATCH");
    try {
      await this.workflow.commit({ scope: workflowScope(scope), scopeKey: scopeKey(scope), idempotencyKey: input.idempotencyKey, operations: [{ aggregateType: BOARD, aggregateKey: boardKey(scope), expectedRevision: input.expectedRevision, payload: structuredClone(record), recordDigest: record.digest }], outbox: [], result: { boardRevision: record.revision }, committedAt: record.updatedAt });
    } catch (error) {
      // [B16.1C] the same translation `commit` performs — a transport CAS
      // conflict is a bounded PS_* code, never a raw DW_* string.
      if (error instanceof Error && error.message === "DW_OPTIMISTIC_REVISION_CONFLICT") throw new Error("PS_DURABLE_PUBLICATION_REVISION_CONFLICT");
      throw error;
    }
  }

  /**
   * [B16.1C §D] the CURRENT durable board head: the verified board record
   * plus the integer aggregate revision a compare-and-swap publication must
   * pin. Qualification uses this instead of a literal so a board that has
   * been re-synchronized or re-qualified (aggregate revision > 1) publishes
   * safely and a concurrent change is refused, never silently overwritten.
   */
  async getBoardHead(scope: PcbSyncRepositoryScope): Promise<{ record: PcbSyncBoardRecord; aggregateRevision: number } | null> {
    const head = await this.boardHead(scope); if (!head) return null;
    const record = head.payload, rebuilt = makeBoardRecord({ ...scope, board: record.board, updatedAt: record.updatedAt });
    if (rebuilt.revision !== record.revision || rebuilt.digest !== record.digest || head.recordDigest !== record.digest) throw new Error("PS_BOARD_RECORD_DIGEST_MISMATCH");
    return { record: structuredClone(record), aggregateRevision: head.revision };
  }

  private boardHead(scope: PcbSyncRepositoryScope): Promise<DurableAggregateRecord<PcbSyncBoardRecord> | null> { return this.workflow.loadHead(durableAggregateIdentity(workflowScope(scope), BOARD, boardKey(scope))); }
  private async planHead(scope: PcbSyncRepositoryScope, id: string): Promise<DurableAggregateRecord<PcbSyncPlan> | null> { const head = await this.workflow.loadHead<PcbSyncPlan>(durableAggregateIdentity(workflowScope(scope), PLAN, planKey(scope, id))); return head ? { ...head, payload: loadedPlan(head.payload) } : null; }
  async getBoard(scope: PcbSyncRepositoryScope): Promise<PcbSyncBoardRecord | null> {
    const head = await this.boardHead(scope); if (!head) return null;
    const record = head.payload, rebuilt = makeBoardRecord({ ...scope, board: record.board, updatedAt: record.updatedAt });
    if (rebuilt.revision !== record.revision || rebuilt.digest !== record.digest || head.recordDigest !== record.digest) throw new Error("PS_BOARD_RECORD_DIGEST_MISMATCH");
    return structuredClone(record);
  }

  async savePlan(plan: PcbSyncPlan): Promise<void> {
    assertPlanDigest(plan);
    const scope: PcbSyncRepositoryScope = plan.scope, key = planKey(scope, plan.planId), current = await this.workflow.loadHead<PcbSyncPlan>(durableAggregateIdentity(workflowScope(scope), PLAN, key));
    if (current?.payload.planDigest === plan.planDigest) return;
    if (current) throw new Error("PS_PLAN_ID_COLLISION");
    await this.workflow.commit({ scope: workflowScope(scope), scopeKey: scopeKey(scope), idempotencyKey: `save-plan:${plan.planId}:${plan.planDigest}`, operations: [{ aggregateType: PLAN, aggregateKey: key, expectedRevision: 0, payload: storedPlan(plan), recordDigest: plan.planDigest }], outbox: [], result: { planId: plan.planId }, committedAt: plan.createdAt });
  }
  async getPlan(scope: PcbSyncRepositoryScope, id: string): Promise<PcbSyncPlan | null> { return structuredClone((await this.planHead(scope, id))?.payload ?? null); }
  async setPlanLifecycle(scope: PcbSyncRepositoryScope, id: string, lifecycle: PcbSyncPlanLifecycle): Promise<PcbSyncPlan> {
    const head = await this.planHead(scope, id); if (!head) throw new Error("PS_PLAN_NOT_FOUND");
    if (head.payload.lifecycle === lifecycle) return structuredClone(head.payload);
    const plan = { ...head.payload, lifecycle };
    await this.workflow.commit({ scope: workflowScope(scope), scopeKey: scopeKey(scope), idempotencyKey: `plan-lifecycle:${id}:${head.revision}:${lifecycle}`, operations: [{ aggregateType: PLAN, aggregateKey: planKey(scope, id), expectedRevision: head.revision, payload: storedPlan(plan), recordDigest: pcbSyncDigest({ planDigest: plan.planDigest, lifecycle }) }], outbox: [], result: { planId: id, lifecycle }, committedAt: new Date().toISOString() });
    return structuredClone(plan);
  }
  async getIdempotentResult(scope: PcbSyncRepositoryScope, idempotencyKey: string): Promise<PcbSyncApplyResult | null> { const replay = await this.workflow.getReplay<PcbSyncApplyResult>(workflowScope(scope), scopeKey(scope), idempotencyKey); return structuredClone(replay?.result ?? null); }
  async withBoardLock<T>(_scope: PcbSyncRepositoryScope, _timeoutMs: number, operation: () => Promise<T>): Promise<T> { return operation(); }

  async commit(input: PcbSyncCommitInput): Promise<PcbSyncApplyResult> {
    const replay = await this.getIdempotentResult(input.scope, input.applyRequest.idempotencyKey);
    if (replay) {
      if (replay.planId !== input.plan.planId || replay.planDigest !== input.plan.planDigest) throw new Error("PS_IDEMPOTENCY_SCOPE_CONFLICT");
      return { ...replay, requestId: input.applyRequest.requestId, status: "idempotent_replay", boardChanged: false };
    }
    const boardHead = await this.boardHead(input.scope), current = boardHead?.payload ?? null;
    if ((current?.revision ?? null) !== input.expectedBoardRevision) throw new Error("PS_BOARD_REVISION_MISMATCH");
    const planHead = await this.planHead(input.scope, input.plan.planId);
    if (!planHead || planHead.payload.planDigest !== input.plan.planDigest || !["applicable", "applying"].includes(planHead.payload.lifecycle)) throw new Error("PS_PLAN_DIGEST_OR_LIFECYCLE_MISMATCH");
    const record = makeBoardRecord({ ...input.scope, board: input.stagedBoard, updatedAt: input.completedAt });
    const auditBase = { schemaVersion: PCB_SYNC_AUDIT_VERSION, auditId: pcbSyncId("pcb-sync-audit", { plan: input.plan.planDigest, board: record.revision, key: input.applyRequest.idempotencyKey }), planId: input.plan.planId, planDigest: input.plan.planDigest, scope: input.plan.scope, actor: structuredClone(input.applyRequest.actorContext), operationIds: input.plan.operations.map((item) => item.operationId), originalBoardRevision: current?.revision ?? null, committedBoardRevision: record.revision, committedBoardDigest: record.digest, idempotencyKey: input.applyRequest.idempotencyKey, outcome: "committed" as const, occurredAt: input.completedAt };
    const audit: PcbSyncAuditRecord = { ...auditBase, auditDigest: pcbSyncDigest(auditBase) }, result = input.buildResult(record, audit), nextPlan = { ...input.plan, lifecycle: "applied" as const };
    const auditHead = await this.workflow.loadHead<AuditStream>(durableAggregateIdentity(workflowScope(input.scope), AUDIT, auditKey(input.scope))), audits = [...(auditHead?.payload.audits ?? []), audit];
    try {
      const committed = await this.workflow.commit({ scope: workflowScope(input.scope), scopeKey: scopeKey(input.scope), idempotencyKey: input.applyRequest.idempotencyKey, operations: [{ aggregateType: BOARD, aggregateKey: boardKey(input.scope), expectedRevision: boardHead?.revision ?? 0, payload: record, recordDigest: record.digest }, { aggregateType: PLAN, aggregateKey: planKey(input.scope, input.plan.planId), expectedRevision: planHead.revision, payload: storedPlan(nextPlan), recordDigest: pcbSyncDigest({ planDigest: nextPlan.planDigest, lifecycle: nextPlan.lifecycle }) }, { aggregateType: AUDIT, aggregateKey: auditKey(input.scope), expectedRevision: auditHead?.revision ?? 0, payload: { audits }, recordDigest: pcbSyncDigest(audits.map((item) => item.auditDigest)) }], outbox: [{ owner: { aggregateType: BOARD, aggregateKey: boardKey(input.scope) }, eventType: "pcb-sync.applied", eventVersion: 1, topic: "pcb-sync.applied", payload: { auditId: audit.auditId, planId: input.plan.planId, boardId: input.scope.boardId, boardRevision: record.revision } }], result, committedAt: input.completedAt });
      if (committed.idempotent) {
        if (committed.result.planId !== input.plan.planId || committed.result.planDigest !== input.plan.planDigest) throw new Error("PS_IDEMPOTENCY_SCOPE_CONFLICT");
        return structuredClone({ ...committed.result, requestId: input.applyRequest.requestId, status: "idempotent_replay" as const, boardChanged: false });
      }
      return structuredClone(committed.result);
    } catch (error) {
      if (error instanceof Error && error.message === "DW_OPTIMISTIC_REVISION_CONFLICT") throw new Error("PS_DURABLE_PUBLICATION_REVISION_CONFLICT");
      throw error;
    }
  }
  async listAudits(scope: PcbSyncRepositoryScope): Promise<PcbSyncAuditRecord[]> { return structuredClone((await this.workflow.loadHead<AuditStream>(durableAggregateIdentity(workflowScope(scope), AUDIT, auditKey(scope))))?.payload.audits ?? []); }

  private async invalidate(scope: PcbSyncRepositoryScope, predicate: (plan: PcbSyncPlan) => boolean, idempotencyPrefix: string, occurredAt: string): Promise<number> {
    const heads = await this.workflow.listHeads<PcbSyncPlan>({ aggregateType: PLAN, scope: workflowScope(scope), limit: 10_000 }); let count = 0;
    for (const head of heads) {
      const plan = head.payload;
      if (plan.scope.boardId !== scope.boardId || !["validated", "applicable"].includes(plan.lifecycle) || !predicate(plan)) continue;
      const next = { ...plan, lifecycle: "stale" as const };
      await this.workflow.commit({ scope: workflowScope(scope), scopeKey: scopeKey(scope), idempotencyKey: `${idempotencyPrefix}:${plan.planId}:${head.revision}`, operations: [{ aggregateType: PLAN, aggregateKey: head.aggregateKey, expectedRevision: head.revision, payload: storedPlan(next), recordDigest: pcbSyncDigest({ planDigest: plan.planDigest, lifecycle: "stale" }) }], outbox: [{ owner: { aggregateType: PLAN, aggregateKey: head.aggregateKey }, eventType: "pcb-sync.plan-staled", eventVersion: 1, topic: "pcb-sync.plan-staled", payload: { planId: plan.planId, boardId: scope.boardId } }], result: { planId: plan.planId }, committedAt: occurredAt }); count += 1;
    }
    return count;
  }
  async invalidatePlansByMapping(scope: PcbSyncRepositoryScope, input: { componentInstanceId: string; oldCertificateId: string | null; newCertificateId: string; reason: string; occurredAt: string }): Promise<number> { void input.reason; return this.invalidate(scope, (plan) => { const materialization = plan.materializations.find((item) => item.componentInstanceId === input.componentInstanceId); return Boolean(materialization && (input.oldCertificateId === null || materialization.mapping.mappingCertificateId === input.oldCertificateId) && materialization.mapping.mappingCertificateId !== input.newCertificateId); }, `mapping-invalidation:${input.componentInstanceId}:${input.newCertificateId}`, input.occurredAt); }
  async invalidatePlansByPassivePolicy(scope: PcbSyncRepositoryScope, input: { componentInstanceIds: string[]; fromPolicyRevisionId: string | null; toPolicyRevisionId: string; reason: string; occurredAt: string }): Promise<number> { void input.fromPolicyRevisionId; void input.reason; const affected = new Set(input.componentInstanceIds); return this.invalidate(scope, (plan) => plan.resolverEvidence.some((item) => affected.has(item.componentInstanceId)), `policy-invalidation:${input.toPolicyRevisionId}`, input.occurredAt); }
  async invalidateProjectPlansByPassivePolicy(input: { tenantId: string; projectId: string; branchId: string; componentInstanceIds: string[]; fromPolicyRevisionId: string | null; toPolicyRevisionId: string; reason: string; occurredAt: string }): Promise<number> {
    const projectScope = { tenantId: input.tenantId, projectId: input.projectId, branchId: input.branchId };
    const plans = await this.workflow.listHeads<PcbSyncPlan>({ aggregateType: PLAN, scope: projectScope, limit: 10_000 });
    const boards = [...new Set(plans.map((head) => head.payload.scope.boardId))].sort(); let count = 0;
    for (const boardId of boards) count += await this.invalidatePlansByPassivePolicy({ ...projectScope, boardId }, input);
    return count;
  }
}

export function trustedBoardRecord(input: { scope: PcbSyncRepositoryScope; board: PcbBoard; capturedAt: string }): PcbSyncBoardRecord { return makeBoardRecord({ ...input.scope, board: input.board, updatedAt: input.capturedAt }); }
