import { passivePolicyDigest, passivePolicyId } from "./stable";
import { PASSIVE_POLICY_AUDIT_VERSION, PASSIVE_POLICY_INVALIDATION_VERSION, type PassivePolicyAuditEvent, type PassivePolicyCommitResult, type PassivePolicyInvalidationEvent, type PassivePolicyRecord, type PassivePolicyRepository, type PassivePolicyRepositoryScope } from "./types";

function key(scope: PassivePolicyRepositoryScope): string { return `${scope.tenantId}\0${scope.projectId}\0${scope.branchId}\0${scope.policyId}`; }
export class InMemoryPassivePolicyRepository implements PassivePolicyRepository {
  private readonly records = new Map<string, PassivePolicyRecord[]>();
  private readonly events = new Map<string, PassivePolicyAuditEvent[]>();
  private readonly invalidationEvents = new Map<string, PassivePolicyInvalidationEvent[]>();
  private readonly replays = new Map<string, PassivePolicyCommitResult>();
  private readonly locks = new Map<string, Promise<void>>();
  async getHead(scope: PassivePolicyRepositoryScope): Promise<PassivePolicyRecord | null> { return structuredClone(this.records.get(key(scope))?.at(-1) ?? null); }
  async getRecord(scope: PassivePolicyRepositoryScope, recordId: string): Promise<PassivePolicyRecord | null> { return structuredClone(this.records.get(key(scope))?.find((item) => item.recordId === recordId) ?? null); }
  async history(scope: PassivePolicyRepositoryScope): Promise<PassivePolicyRecord[]> { return structuredClone(this.records.get(key(scope)) ?? []); }
  async audits(scope: PassivePolicyRepositoryScope): Promise<PassivePolicyAuditEvent[]> { return structuredClone(this.events.get(key(scope)) ?? []); }
  async invalidations(scope: PassivePolicyRepositoryScope): Promise<PassivePolicyInvalidationEvent[]> { return structuredClone(this.invalidationEvents.get(key(scope)) ?? []); }
  async getPublished(input: { tenantId: string; projectId: string; branchId: string; assemblyVariantId: string }): Promise<PassivePolicyRecord[]> { return [...this.records.values()].flat().filter((item) => item.policy.tenantId === input.tenantId && item.policy.projectId === input.projectId && item.policy.branchId === input.branchId && item.lifecycle === "published" && item.policy.assemblyVariantIds.includes(input.assemblyVariantId)).map((item) => structuredClone(item)); }
  async getIdempotent(scope: PassivePolicyRepositoryScope, idempotencyKey: string): Promise<PassivePolicyCommitResult | null> { return structuredClone(this.replays.get(`${key(scope)}\0${idempotencyKey}`) ?? null); }
  async withLock<T>(scope: PassivePolicyRepositoryScope, timeoutMs: number, operation: () => Promise<T>): Promise<T> { const scopeKey = key(scope), prior = this.locks.get(scopeKey) ?? Promise.resolve(); let release!: () => void; const held = new Promise<void>((resolve) => { release = resolve; }), tail = prior.then(() => held); this.locks.set(scopeKey, tail); let timer: ReturnType<typeof setTimeout> | undefined; try { await Promise.race([prior, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("PP_POLICY_LOCK_TIMEOUT")), timeoutMs); })]); return await operation(); } finally { if (timer) clearTimeout(timer); release(); if (this.locks.get(scopeKey) === tail) void tail.then(() => this.locks.delete(scopeKey)); } }
  async commit(input: { scope: PassivePolicyRepositoryScope; expectedRevision: number; record: PassivePolicyRecord; action: PassivePolicyAuditEvent["action"]; actor: PassivePolicyAuditEvent["actor"]; reason: string; idempotencyKey: string; invalidation: Omit<PassivePolicyInvalidationEvent, "eventId" | "eventDigest"> }): Promise<PassivePolicyCommitResult> {
    const scopeKey = key(input.scope), replayKey = `${scopeKey}\0${input.idempotencyKey}`, replay = this.replays.get(replayKey); if (replay) return structuredClone({ ...replay, idempotent: true });
    const history = this.records.get(scopeKey) ?? [], head = history.at(-1); if ((head?.revision ?? 0) !== input.expectedRevision) throw new Error("PP_OPTIMISTIC_REVISION_CONFLICT");
    const auditBase = { schemaVersion: PASSIVE_POLICY_AUDIT_VERSION, eventId: passivePolicyId("passive-policy-audit", { record: input.record.recordDigest, action: input.action, key: input.idempotencyKey }), policyId: input.record.policy.policyId, fromRecordId: head?.recordId ?? null, toRecordId: input.record.recordId, action: input.action, actor: structuredClone(input.actor), reason: input.reason, idempotencyKey: input.idempotencyKey, occurredAt: input.record.createdAt };
    const audit = { ...auditBase, eventDigest: passivePolicyDigest(auditBase) }, invalidationBase = { ...input.invalidation, schemaVersion: PASSIVE_POLICY_INVALIDATION_VERSION }, invalidation = { ...invalidationBase, eventId: passivePolicyId("passive-policy-invalidation", invalidationBase), eventDigest: passivePolicyDigest(invalidationBase) };
    const result = { record: structuredClone(input.record), audit, invalidation, idempotent: false };
    this.records.set(scopeKey, [...history, structuredClone(input.record)]); this.events.set(scopeKey, [...(this.events.get(scopeKey) ?? []), structuredClone(audit)]); this.invalidationEvents.set(scopeKey, [...(this.invalidationEvents.get(scopeKey) ?? []), structuredClone(invalidation)]); this.replays.set(replayKey, structuredClone(result)); return result;
  }
}
