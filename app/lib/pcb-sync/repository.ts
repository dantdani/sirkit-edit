import type { PcbBoard } from "../pcb/types";
import { assertPlanDigest, pcbSyncDigest, pcbSyncId } from "./stable";
import { makeBoardRecord } from "./board";
import { PCB_SYNC_AUDIT_VERSION, type PcbSyncApplyRequest, type PcbSyncApplyResult, type PcbSyncAuditRecord, type PcbSyncBoardRecord, type PcbSyncPlan, type PcbSyncPlanLifecycle } from "./types";

export interface PcbSyncRepositoryScope { tenantId: string; projectId: string; branchId: string; boardId: string }
export interface PcbSyncCommitInput {
  scope: PcbSyncRepositoryScope;
  expectedBoardRevision: string | null;
  stagedBoard: PcbBoard;
  plan: PcbSyncPlan;
  applyRequest: PcbSyncApplyRequest;
  completedAt: string;
  buildResult(record: PcbSyncBoardRecord, audit: PcbSyncAuditRecord): PcbSyncApplyResult;
}

export interface PcbSyncRepository {
  getBoard(scope: PcbSyncRepositoryScope): Promise<PcbSyncBoardRecord | null>;
  savePlan(plan: PcbSyncPlan): Promise<void>;
  getPlan(scope: PcbSyncRepositoryScope, planId: string): Promise<PcbSyncPlan | null>;
  setPlanLifecycle(scope: PcbSyncRepositoryScope, planId: string, lifecycle: PcbSyncPlanLifecycle): Promise<PcbSyncPlan>;
  getIdempotentResult(scope: PcbSyncRepositoryScope, idempotencyKey: string): Promise<PcbSyncApplyResult | null>;
  withBoardLock<T>(scope: PcbSyncRepositoryScope, timeoutMs: number, operation: () => Promise<T>): Promise<T>;
  commit(input: PcbSyncCommitInput): Promise<PcbSyncApplyResult>;
  listAudits(scope: PcbSyncRepositoryScope): Promise<PcbSyncAuditRecord[]>;
  invalidatePlansByMapping(scope: PcbSyncRepositoryScope, input: { componentInstanceId: string; oldCertificateId: string | null; newCertificateId: string; reason: string; occurredAt: string }): Promise<number>;
  invalidatePlansByPassivePolicy(scope: PcbSyncRepositoryScope, input: { componentInstanceIds: string[]; fromPolicyRevisionId: string | null; toPolicyRevisionId: string; reason: string; occurredAt: string }): Promise<number>;
}

function scopeKey(scope: PcbSyncRepositoryScope): string { return `${scope.tenantId}\0${scope.projectId}\0${scope.branchId}\0${scope.boardId}`; }
function planKey(scope: PcbSyncRepositoryScope, planId: string): string { return `${scopeKey(scope)}\0${planId}`; }
function replayKey(scope: PcbSyncRepositoryScope, idempotencyKey: string): string { return `${scopeKey(scope)}\0${idempotencyKey}`; }

export class InMemoryPcbSyncRepository implements PcbSyncRepository {
  private readonly boards = new Map<string, PcbSyncBoardRecord>();
  private readonly plans = new Map<string, PcbSyncPlan>();
  private readonly audits = new Map<string, PcbSyncAuditRecord[]>();
  private readonly replays = new Map<string, PcbSyncApplyResult>();
  private readonly lockTails = new Map<string, Promise<void>>();

  seedBoard(record: PcbSyncBoardRecord): void { this.boards.set(scopeKey(record), structuredClone(record)); }

  async getBoard(scope: PcbSyncRepositoryScope): Promise<PcbSyncBoardRecord | null> { return structuredClone(this.boards.get(scopeKey(scope)) ?? null); }

  async savePlan(plan: PcbSyncPlan): Promise<void> {
    assertPlanDigest(plan);
    const key = planKey(plan.scope, plan.planId);
    const prior = this.plans.get(key);
    if (prior && prior.planDigest !== plan.planDigest) throw new Error("PS_PLAN_ID_COLLISION");
    this.plans.set(key, structuredClone(plan));
  }

  async getPlan(scope: PcbSyncRepositoryScope, planId: string): Promise<PcbSyncPlan | null> { return structuredClone(this.plans.get(planKey(scope, planId)) ?? null); }

  async setPlanLifecycle(scope: PcbSyncRepositoryScope, planId: string, lifecycle: PcbSyncPlanLifecycle): Promise<PcbSyncPlan> {
    const key = planKey(scope, planId), plan = this.plans.get(key);
    if (!plan) throw new Error("PS_PLAN_NOT_FOUND");
    const next = { ...plan, lifecycle };
    this.plans.set(key, next);
    return structuredClone(next);
  }

  async getIdempotentResult(scope: PcbSyncRepositoryScope, idempotencyKey: string): Promise<PcbSyncApplyResult | null> { return structuredClone(this.replays.get(replayKey(scope, idempotencyKey)) ?? null); }

  async withBoardLock<T>(scope: PcbSyncRepositoryScope, timeoutMs: number, operation: () => Promise<T>): Promise<T> {
    const key = scopeKey(scope), prior = this.lockTails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const tail = prior.then(() => held);
    this.lockTails.set(key, tail);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([prior, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("PS_BOARD_LOCK_TIMEOUT")), timeoutMs); })]);
      return await operation();
    } finally {
      if (timer) clearTimeout(timer);
      release();
      if (this.lockTails.get(key) === tail) void tail.then(() => this.lockTails.delete(key));
    }
  }

  async commit(input: PcbSyncCommitInput): Promise<PcbSyncApplyResult> {
    const key = scopeKey(input.scope), current = this.boards.get(key) ?? null;
    if ((current?.revision ?? null) !== input.expectedBoardRevision) throw new Error("PS_BOARD_REVISION_MISMATCH");
    const existingReplay = this.replays.get(replayKey(input.scope, input.applyRequest.idempotencyKey));
    if (existingReplay) return structuredClone(existingReplay);
    const record = makeBoardRecord({ ...input.scope, board: input.stagedBoard, updatedAt: input.completedAt });
    const auditBase = {
      schemaVersion: PCB_SYNC_AUDIT_VERSION,
      auditId: pcbSyncId("pcb-sync-audit", { plan: input.plan.planDigest, board: record.revision, key: input.applyRequest.idempotencyKey }),
      planId: input.plan.planId,
      planDigest: input.plan.planDigest,
      scope: input.plan.scope,
      actor: structuredClone(input.applyRequest.actorContext),
      operationIds: input.plan.operations.map((item) => item.operationId),
      originalBoardRevision: current?.revision ?? null,
      committedBoardRevision: record.revision,
      committedBoardDigest: record.digest,
      idempotencyKey: input.applyRequest.idempotencyKey,
      outcome: "committed" as const,
      occurredAt: input.completedAt,
    };
    const audit: PcbSyncAuditRecord = { ...auditBase, auditDigest: pcbSyncDigest(auditBase) };
    const result = input.buildResult(record, audit);
    const nextPlan = { ...input.plan, lifecycle: "applied" as const };
    this.boards.set(key, structuredClone(record));
    this.plans.set(planKey(input.scope, input.plan.planId), structuredClone(nextPlan));
    this.audits.set(key, [...(this.audits.get(key) ?? []), structuredClone(audit)]);
    this.replays.set(replayKey(input.scope, input.applyRequest.idempotencyKey), structuredClone(result));
    return structuredClone(result);
  }

  async listAudits(scope: PcbSyncRepositoryScope): Promise<PcbSyncAuditRecord[]> { return structuredClone(this.audits.get(scopeKey(scope)) ?? []); }

  async invalidatePlansByMapping(scope: PcbSyncRepositoryScope, input: { componentInstanceId: string; oldCertificateId: string | null; newCertificateId: string; reason: string; occurredAt: string }): Promise<number> {
    void input.reason; void input.occurredAt;
    let count = 0;
    const prefix = `${scopeKey(scope)}\0`;
    for (const [key, plan] of this.plans) {
      if (!key.startsWith(prefix) || !["validated", "applicable"].includes(plan.lifecycle)) continue;
      const materialization = plan.materializations.find((item) => item.componentInstanceId === input.componentInstanceId);
      if (!materialization || (input.oldCertificateId !== null && materialization.mapping.mappingCertificateId !== input.oldCertificateId) || materialization.mapping.mappingCertificateId === input.newCertificateId) continue;
      this.plans.set(key, { ...plan, lifecycle: "stale" });
      count += 1;
    }
    return count;
  }

  async invalidatePlansByPassivePolicy(scope: PcbSyncRepositoryScope, input: { componentInstanceIds: string[]; fromPolicyRevisionId: string | null; toPolicyRevisionId: string; reason: string; occurredAt: string }): Promise<number> {
    void input.reason; void input.occurredAt;
    const affected = new Set(input.componentInstanceIds); let count = 0; const prefix = `${scopeKey(scope)}\0`;
    for (const [key, plan] of this.plans) {
      if (!key.startsWith(prefix) || !["validated", "applicable"].includes(plan.lifecycle)) continue;
      const dependsOnAffectedComponent = plan.resolverEvidence.some((item) => affected.has(item.componentInstanceId));
      if (!dependsOnAffectedComponent) continue;
      this.plans.set(key, { ...plan, lifecycle: "stale" }); count += 1;
    }
    return count;
  }
}
