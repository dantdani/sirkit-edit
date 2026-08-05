import { mappingDigest, mappingId } from "./stable";
import { MAPPING_AUDIT_VERSION, type MappingAuditEvent, type MappingCommitResult, type MappingInvalidationEvent, type MappingRecord, type MappingRepository, type MappingRepositoryScope } from "./types";

function scopeKey(scope: MappingRepositoryScope): string { return `${scope.tenantId}\0${scope.projectId}\0${scope.branchId}\0${scope.componentInstanceId}\0${scope.assemblyVariantId}`; }
function replayKey(scope: MappingRepositoryScope, key: string): string { return `${scopeKey(scope)}\0${key}`; }

export class InMemoryMappingRepository implements MappingRepository {
  private readonly records = new Map<string, MappingRecord[]>();
  private readonly auditEvents = new Map<string, MappingAuditEvent[]>();
  private readonly invalidationEvents = new Map<string, MappingInvalidationEvent[]>();
  private readonly replays = new Map<string, MappingCommitResult>();
  private readonly lockTails = new Map<string, Promise<void>>();
  async getHead(scope: MappingRepositoryScope): Promise<MappingRecord | null> { return structuredClone(this.records.get(scopeKey(scope))?.at(-1) ?? null); }
  async getRevision(scope: MappingRepositoryScope, revisionId: string): Promise<MappingRecord | null> { return structuredClone(this.records.get(scopeKey(scope))?.find((item) => item.revisionId === revisionId) ?? null); }
  async history(scope: MappingRepositoryScope): Promise<MappingRecord[]> { return structuredClone(this.records.get(scopeKey(scope)) ?? []); }
  async audits(scope: MappingRepositoryScope): Promise<MappingAuditEvent[]> { return structuredClone(this.auditEvents.get(scopeKey(scope)) ?? []); }
  async invalidations(scope: MappingRepositoryScope): Promise<MappingInvalidationEvent[]> { return structuredClone(this.invalidationEvents.get(scopeKey(scope)) ?? []); }
  async getIdempotent(scope: MappingRepositoryScope, key: string): Promise<MappingCommitResult | null> { return structuredClone(this.replays.get(replayKey(scope, key)) ?? null); }
  async withLock<T>(scope: MappingRepositoryScope, timeoutMs: number, operation: () => Promise<T>): Promise<T> {
    const key = scopeKey(scope), prior = this.lockTails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; }), tail = prior.then(() => held);
    this.lockTails.set(key, tail);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([prior, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("MV_MAPPING_LOCK_TIMEOUT")), timeoutMs); })]);
      return await operation();
    } finally {
      if (timer) clearTimeout(timer);
      release();
      if (this.lockTails.get(key) === tail) void tail.then(() => this.lockTails.delete(key));
    }
  }
  async commit(input: Parameters<MappingRepository["commit"]>[0]): Promise<MappingCommitResult> {
    const key = scopeKey(input.scope), existingReplay = this.replays.get(replayKey(input.scope, input.idempotencyKey));
    if (existingReplay) return structuredClone(existingReplay);
    const history = this.records.get(key) ?? [], head = history.at(-1) ?? null;
    if ((head?.revision ?? 0) !== input.expectedRevision) throw new Error("MV_OPTIMISTIC_REVISION_CONFLICT");
    if (input.record.revision !== input.expectedRevision + 1 || input.record.predecessorRevisionId !== (head?.revisionId ?? undefined)) throw new Error("MV_RECORD_SUCCESSOR_INVALID");
    const auditBase = { schemaVersion: MAPPING_AUDIT_VERSION, eventId: mappingId("mapping-audit", { mapping: input.record.mappingId, revision: input.record.revisionId, action: input.action, idempotencyKey: input.idempotencyKey }), mappingId: input.record.mappingId, fromRevisionId: head?.revisionId ?? null, toRevisionId: input.record.revisionId, action: input.action, actor: structuredClone(input.actor), reason: input.reason, idempotencyKey: input.idempotencyKey, occurredAt: input.record.createdAt };
    const audit: MappingAuditEvent = { ...auditBase, eventDigest: mappingDigest(auditBase) };
    const invalidationBase = { ...input.invalidation, eventId: mappingId("mapping-invalidation", { mapping: input.record.mappingId, revision: input.record.revisionId, reason: input.invalidation.reason }) };
    const invalidation: MappingInvalidationEvent = { ...invalidationBase, eventDigest: mappingDigest(invalidationBase) };
    const result: MappingCommitResult = { record: structuredClone(input.record), audit, invalidation, stage1Reference: structuredClone(input.stage1Reference), idempotent: false };
    this.records.set(key, [...history, structuredClone(input.record)]);
    this.auditEvents.set(key, [...(this.auditEvents.get(key) ?? []), structuredClone(audit)]);
    this.invalidationEvents.set(key, [...(this.invalidationEvents.get(key) ?? []), structuredClone(invalidation)]);
    this.replays.set(replayKey(input.scope, input.idempotencyKey), structuredClone(result));
    return structuredClone(result);
  }
}

export function repositoryScope(record: Pick<MappingRecord, "scope">): MappingRepositoryScope { return { tenantId: record.scope.tenantId, projectId: record.scope.projectId, branchId: record.scope.branchId, componentInstanceId: record.scope.componentInstanceId, assemblyVariantId: record.scope.assemblyVariantId }; }
