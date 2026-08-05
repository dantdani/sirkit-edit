import type { DurableEffectHandler } from "../durable-workflow/outbox";
import { assertDurableOutboxEvent, durableAggregateIdentity, durableEventContractKey, durableScopeKey, durableWorkflowId } from "../durable-workflow/stable";
import type { DurableOutboxEvent, DurableWorkflowRepository, DurableWorkflowScope } from "../durable-workflow/types";
import type { DurablePcbSyncRepository } from "../pcb-sync/durable";
import { buildPassiveDependencySnapshot } from "./adapters";
import { passivePolicyDigest, passivePolicyId } from "./stable";
import { PASSIVE_POLICY_AUDIT_VERSION, PASSIVE_POLICY_INVALIDATION_VERSION, type PassivePolicyAuditEvent, type PassivePolicyCommitResult, type PassivePolicyContext, type PassivePolicyContextProvider, type PassivePolicyConvergence, type PassivePolicyEffectStatus, type PassivePolicyEvaluationRequest, type PassivePolicyInvalidationEvent, type PassivePolicyInvalidationTarget, type PassivePolicyRecord, type PassivePolicyRepository, type PassivePolicyRepositoryScope } from "./types";

const POLICY = "passive-policy.record.v1";
const CONTEXT = "passive-policy.context.v1";
const RECEIPT = "passive-policy.effect-receipt.v1";
interface PolicyEnvelope { record: PassivePolicyRecord; audit: PassivePolicyAuditEvent; invalidation: PassivePolicyInvalidationEvent }
interface PassiveEffectReceipt { schemaVersion: "sirkit.passive-effect-receipt.v1"; eventId: string; eventDigest: string; ownerAggregateType: string; ownerAggregateKey: string; ownerAggregateRevision: number; eventType: "passive-policy.invalidate"; eventVersion: 1; outcome: { stage2DependencyKeys: string[]; stage3PlansStaled: number }; recordedAt: string }

function scope(value: PassivePolicyRepositoryScope): DurableWorkflowScope { return { tenantId: value.tenantId, projectId: value.projectId, branchId: value.branchId }; }
function policyKey(value: PassivePolicyRepositoryScope): string { return durableWorkflowId("passive-policy-scope", value); }
function replayScope(value: PassivePolicyRepositoryScope): string { return durableScopeKey(scope(value), `passive-policy:${value.policyId}`); }
function contextKey(value: Pick<PassivePolicyContext["component"]["scope"], "tenantId" | "projectId" | "branchId" | "assemblyVariantId" | "componentInstanceId">): string { return durableWorkflowId("passive-context", { tenantId: value.tenantId, projectId: value.projectId, branchId: value.branchId, assemblyVariantId: value.assemblyVariantId, componentInstanceId: value.componentInstanceId }); }
function terminal(code: string, attempts = 0): PassivePolicyEffectStatus { return { state: "terminal_failed", eventType: "passive-policy.invalidate", eventVersion: 1, attempts, errorCode: code }; }

async function loadReceipt(workflow: DurableWorkflowRepository, event: DurableOutboxEvent): Promise<PassiveEffectReceipt | null> {
  const value = (await workflow.loadHead<PassiveEffectReceipt>(durableAggregateIdentity(event.scope, RECEIPT, event.eventId)))?.payload ?? null;
  if (value && (value.eventDigest !== event.eventDigest || value.ownerAggregateType !== event.ownerAggregateType || value.ownerAggregateKey !== event.ownerAggregateKey || value.ownerAggregateRevision !== event.ownerAggregateRevision || value.eventType !== event.eventType || value.eventVersion !== event.eventVersion)) throw new Error("PP_EFFECT_RECEIPT_CONFLICT");
  return value;
}
async function storeReceipt(workflow: DurableWorkflowRepository, event: DurableOutboxEvent, outcome: PassiveEffectReceipt["outcome"]): Promise<PassiveEffectReceipt> {
  const prior = await loadReceipt(workflow, event); if (prior) return prior;
  const receipt: PassiveEffectReceipt = { schemaVersion: "sirkit.passive-effect-receipt.v1", eventId: event.eventId, eventDigest: event.eventDigest, ownerAggregateType: event.ownerAggregateType, ownerAggregateKey: event.ownerAggregateKey, ownerAggregateRevision: event.ownerAggregateRevision, eventType: "passive-policy.invalidate", eventVersion: 1, outcome: { stage2DependencyKeys: [...new Set(outcome.stage2DependencyKeys)].sort(), stage3PlansStaled: outcome.stage3PlansStaled }, recordedAt: event.createdAt };
  const committed = await workflow.commit({ scope: event.scope, scopeKey: durableScopeKey(event.scope, `passive-effect:${event.eventId}`), idempotencyKey: `passive-effect:${event.eventId}`, operations: [{ aggregateType: RECEIPT, aggregateKey: event.eventId, expectedRevision: 0, payload: receipt, recordDigest: passivePolicyDigest(receipt) }], outbox: [], result: receipt, committedAt: event.createdAt });
  return structuredClone(committed.result);
}
async function ownerEnvelope(workflow: DurableWorkflowRepository, event: DurableOutboxEvent): Promise<PolicyEnvelope> {
  if (event.ownerAggregateType !== POLICY) throw new Error("PP_EFFECT_OWNER_TYPE_MISMATCH");
  const history = await workflow.history<PolicyEnvelope>(durableAggregateIdentity(event.scope, event.ownerAggregateType, event.ownerAggregateKey)), owner = history.find((item) => item.revision === event.ownerAggregateRevision);
  if (!owner || owner.payload.record.revision !== event.ownerAggregateRevision) throw new Error("PP_EFFECT_OWNER_REVISION_MISSING");
  const policy = owner.payload.record.policy;
  if (policy.tenantId !== event.scope.tenantId || policy.projectId !== event.scope.projectId || policy.branchId !== event.scope.branchId || event.ownerAggregateKey !== policyKey({ tenantId: policy.tenantId, projectId: policy.projectId, branchId: policy.branchId, policyId: policy.policyId })) throw new Error("PP_EFFECT_OWNER_AUTHORITY_MISMATCH");
  return owner.payload;
}
async function observed(workflow: DurableWorkflowRepository, event: DurableOutboxEvent | undefined): Promise<{ status: PassivePolicyEffectStatus; receipt: PassiveEffectReceipt | null }> {
  if (!event) return { status: terminal("PP_REQUIRED_EFFECT_MISSING"), receipt: null };
  if (event.eventVersion !== 1) return { status: terminal("PP_EFFECT_CONTRACT_UNSUPPORTED", event.attempts), receipt: null };
  const receipt = await loadReceipt(workflow, event);
  if (event.state === "failed") return { status: terminal(event.lastErrorCode ?? "PP_EFFECT_TERMINAL", event.attempts), receipt };
  if (event.state === "completed") return receipt ? { status: { state: "completed", eventType: "passive-policy.invalidate", eventVersion: 1, attempts: event.attempts, completedAt: event.completedAt ?? event.createdAt }, receipt } : { status: terminal("PP_EFFECT_RECEIPT_MISSING", event.attempts), receipt: null };
  if (event.lastErrorCode) return { status: { state: "retryable_failed", eventType: "passive-policy.invalidate", eventVersion: 1, attempts: event.attempts, errorCode: event.lastErrorCode }, receipt };
  return { status: { state: "pending", eventType: "passive-policy.invalidate", eventVersion: 1, attempts: event.attempts }, receipt };
}
async function reconciledPlanCount(workflow: DurableWorkflowRepository, event: DurableOutboxEvent, policyRevisionId: string, fallback: number): Promise<number> {
  const transitions = (await workflow.listOutbox({ scope: event.scope, eventType: "pcb-sync.plan-staled" })).filter((item) => item.idempotencyKey.startsWith(`policy-invalidation:${policyRevisionId}:`)), plans = new Set(transitions.map((item) => { const value = item.payload as { boardId?: string; planId?: string }; return `${value.boardId ?? ""}\0${value.planId ?? ""}`; }).filter((value) => value !== "\0"));
  return Math.max(fallback, plans.size);
}

export class DurablePassivePolicyRepository implements PassivePolicyRepository {
  constructor(private readonly workflow: DurableWorkflowRepository) {}
  private async envelope(value: PassivePolicyRepositoryScope): Promise<PolicyEnvelope | null> { return (await this.workflow.loadHead<PolicyEnvelope>(durableAggregateIdentity(scope(value), POLICY, policyKey(value))))?.payload ?? null; }
  async getHead(value: PassivePolicyRepositoryScope): Promise<PassivePolicyRecord | null> { return structuredClone((await this.envelope(value))?.record ?? null); }
  async getRecord(value: PassivePolicyRepositoryScope, recordId: string): Promise<PassivePolicyRecord | null> { return (await this.history(value)).find((item) => item.recordId === recordId) ?? null; }
  async history(value: PassivePolicyRepositoryScope): Promise<PassivePolicyRecord[]> { return (await this.workflow.history<PolicyEnvelope>(durableAggregateIdentity(scope(value), POLICY, policyKey(value)))).map((entry) => structuredClone(entry.payload.record)); }
  async audits(value: PassivePolicyRepositoryScope): Promise<PassivePolicyAuditEvent[]> { return (await this.workflow.history<PolicyEnvelope>(durableAggregateIdentity(scope(value), POLICY, policyKey(value)))).map((entry) => structuredClone(entry.payload.audit)); }
  async invalidations(value: PassivePolicyRepositoryScope): Promise<PassivePolicyInvalidationEvent[]> { return (await this.workflow.history<PolicyEnvelope>(durableAggregateIdentity(scope(value), POLICY, policyKey(value)))).map((entry) => structuredClone(entry.payload.invalidation)); }
  async getPublished(input: { tenantId: string; projectId: string; branchId: string; assemblyVariantId: string }): Promise<PassivePolicyRecord[]> { const heads = await this.workflow.listHeads<PolicyEnvelope>({ aggregateType: POLICY, scope: input, limit: 1_000 }); return heads.map((head) => head.payload.record).filter((record) => record.lifecycle === "published" && record.policy.assemblyVariantIds.includes(input.assemblyVariantId)).sort((a, b) => a.policy.policyId.localeCompare(b.policy.policyId)).map((record) => structuredClone(record)); }
  async getIdempotent(value: PassivePolicyRepositoryScope, key: string): Promise<PassivePolicyCommitResult | null> { return structuredClone((await this.workflow.getReplay<PassivePolicyCommitResult>(scope(value), replayScope(value), key))?.result ?? null); }
  async withLock<T>(_scope: PassivePolicyRepositoryScope, _timeoutMs: number, operation: () => Promise<T>): Promise<T> { return operation(); }
  async convergence(value: PassivePolicyRepositoryScope, recordId: string): Promise<PassivePolicyConvergence> {
    const records = await this.workflow.history<PolicyEnvelope>(durableAggregateIdentity(scope(value), POLICY, policyKey(value))), owner = records.find((item) => item.payload.record.recordId === recordId);
    if (!owner) throw new Error("PP_POLICY_RECORD_NOT_FOUND");
    if (!owner.payload.invalidation.affectedComponentIds.length) return { owner: { aggregateType: POLICY, aggregateKey: owner.aggregateKey, aggregateRevision: owner.revision, recordId }, state: "completed", invalidation: { state: "not_required" }, outcome: { stage2DependencyKeys: [], stage3PlansStaled: 0 } };
    const events = (await this.workflow.listOutbox({ scope: scope(value), eventType: "passive-policy.invalidate" })).filter((event) => event.ownerAggregateType === POLICY && event.ownerAggregateKey === owner.aggregateKey && event.ownerAggregateRevision === owner.revision), effect = events.length === 1 ? await observed(this.workflow, events[0]) : { status: terminal("PP_INVALIDATION_EFFECT_CARDINALITY"), receipt: null };
    const state = effect.status.state === "completed" ? "completed" : effect.status.state === "terminal_failed" ? "terminal_failed" : effect.status.state === "retryable_failed" ? "retryable_failed" : "pending", outcome = effect.receipt ? structuredClone(effect.receipt.outcome) : null;
    return { owner: { aggregateType: POLICY, aggregateKey: owner.aggregateKey, aggregateRevision: owner.revision, recordId }, state, invalidation: effect.status, outcome };
  }
  async commit(input: Parameters<PassivePolicyRepository["commit"]>[0]): Promise<PassivePolicyCommitResult> {
    const prior = await this.workflow.loadHead<PolicyEnvelope>(durableAggregateIdentity(scope(input.scope), POLICY, policyKey(input.scope)));
    if ((prior?.payload.record.revision ?? 0) !== input.expectedRevision) throw new Error("PP_OPTIMISTIC_REVISION_CONFLICT");
    const auditBase = { schemaVersion: PASSIVE_POLICY_AUDIT_VERSION, eventId: passivePolicyId("passive-policy-audit", { record: input.record.recordDigest, action: input.action, key: input.idempotencyKey }), policyId: input.record.policy.policyId, fromRecordId: prior?.payload.record.recordId ?? null, toRecordId: input.record.recordId, action: input.action, actor: structuredClone(input.actor), reason: input.reason, idempotencyKey: input.idempotencyKey, occurredAt: input.record.createdAt }, audit: PassivePolicyAuditEvent = { ...auditBase, eventDigest: passivePolicyDigest(auditBase) };
    const invalidationBase = { ...input.invalidation, schemaVersion: PASSIVE_POLICY_INVALIDATION_VERSION }, invalidation: PassivePolicyInvalidationEvent = { ...invalidationBase, eventId: passivePolicyId("passive-policy-invalidation", invalidationBase), eventDigest: passivePolicyDigest(invalidationBase) };
    const result: PassivePolicyCommitResult = { record: structuredClone(input.record), audit, invalidation, idempotent: false }, envelope: PolicyEnvelope = { record: result.record, audit, invalidation }, owner = { aggregateType: POLICY, aggregateKey: policyKey(input.scope) };
    const outbox = invalidation.affectedComponentIds.length ? [{ owner, eventType: "passive-policy.invalidate", eventVersion: 1, topic: "passive-policy.invalidate", payload: { tenantId: invalidation.tenantId, projectId: invalidation.projectId, branchId: invalidation.branchId, assemblyVariantIds: invalidation.assemblyVariantIds, affectedComponentIds: invalidation.affectedComponentIds, fromPolicyRevisionId: invalidation.fromPolicyRevisionId, toPolicyRevisionId: invalidation.toPolicyRevisionId, reason: input.reason, occurredAt: invalidation.occurredAt } as unknown as Record<string, unknown> }] : [];
    const committed = await this.workflow.commit({ scope: scope(input.scope), scopeKey: replayScope(input.scope), idempotencyKey: input.idempotencyKey, operations: [{ ...owner, expectedRevision: prior?.revision ?? 0, payload: envelope, recordDigest: input.record.recordDigest }], outbox, result, committedAt: input.record.createdAt });
    return structuredClone(committed.result);
  }
}

export class DurablePassivePolicyContextStore implements PassivePolicyContextProvider {
  constructor(private readonly workflow: DurableWorkflowRepository) {}
  private async hydratePolicy(context: PassivePolicyContext, expectedRevisionId?: string): Promise<PassivePolicyContext> { const policyId = context.policy?.policyId; if (!policyId) return context; const repositoryScope = { tenantId: context.component.scope.tenantId, projectId: context.component.scope.projectId, branchId: context.component.scope.branchId, policyId }, head = await this.workflow.loadHead<PolicyEnvelope>(durableAggregateIdentity(scope(repositoryScope), POLICY, policyKey(repositoryScope))); if (!head) throw new Error("PP_POLICY_RECORD_NOT_FOUND"); if (expectedRevisionId && head.payload.record.policy.revisionId !== expectedRevisionId) throw new Error("PP_POLICY_REVISION_NOT_FOUND"); const next = structuredClone(context); next.policy = structuredClone(head.payload.record.policy); next.dependencySnapshot = buildPassiveDependencySnapshot({ component: next.component, policy: next.policy, profiles: next.profiles, assemblyProfile: next.assemblyProfile }); return next; }
  async publish(value: PassivePolicyContext, input: { expectedRevision: number; idempotencyKey: string; publishedAt: string }): Promise<void> { const next = structuredClone(value); next.dependencySnapshot = buildPassiveDependencySnapshot({ component: next.component, ...(next.policy ? { policy: next.policy } : {}), profiles: next.profiles, assemblyProfile: next.assemblyProfile }); const s = { tenantId: next.component.scope.tenantId, projectId: next.component.scope.projectId, branchId: next.component.scope.branchId }, key = contextKey(next.component.scope); await this.workflow.commit({ scope: s, scopeKey: durableScopeKey(s, `passive-context:${key}`), idempotencyKey: input.idempotencyKey, operations: [{ aggregateType: CONTEXT, aggregateKey: key, expectedRevision: input.expectedRevision, payload: next, recordDigest: next.dependencySnapshot.dependencyDigest }], outbox: [], result: { contextKey: key }, committedAt: input.publishedAt }); }
  async getContext(request: PassivePolicyEvaluationRequest, signal?: AbortSignal): Promise<PassivePolicyContext> { if (signal?.aborted) throw new Error("PP_REQUEST_CANCELLED"); const key = contextKey(request), s = { tenantId: request.tenantId, projectId: request.projectId, branchId: request.branchId }, value = (await this.workflow.loadHead<PassivePolicyContext>(durableAggregateIdentity(s, CONTEXT, key)))?.payload; if (!value) throw new Error("PP_CONTEXT_NOT_FOUND"); const context = await this.hydratePolicy(structuredClone(value), request.policyRevisionId); context.request = structuredClone(request); return context; }
  async listProjectContexts(input: { tenantId: string; projectId: string; branchId: string; assemblyVariantId: string; policyRevisionId: string }, signal?: AbortSignal): Promise<PassivePolicyContext[]> { if (signal?.aborted) throw new Error("PP_REQUEST_CANCELLED"); const heads = await this.workflow.listHeads<PassivePolicyContext>({ aggregateType: CONTEXT, scope: input, limit: 10_000 }), values = heads.map((head) => head.payload).filter((context) => context.component.scope.assemblyVariantId === input.assemblyVariantId).sort((a, b) => a.component.scope.componentInstanceId.localeCompare(b.component.scope.componentInstanceId)); return Promise.all(values.map((context) => this.hydratePolicy(structuredClone(context)))); }
}

export class DurablePassivePolicyInvalidationTarget implements PassivePolicyInvalidationTarget {
  constructor(private readonly pcbSync: DurablePcbSyncRepository) {}
  async invalidate(input: Parameters<PassivePolicyInvalidationTarget["invalidate"]>[0]): Promise<{ stage2DependencyKeys: string[]; stage3PlansStaled: number }> { const affectedComponentIds = [...new Set(input.affectedComponentIds)].sort(), assemblyVariantIds = [...new Set(input.assemblyVariantIds)].sort(), stage2DependencyKeys = affectedComponentIds.map((componentInstanceId) => passivePolicyDigest({ tenantId: input.tenantId, projectId: input.projectId, branchId: input.branchId, assemblyVariantIds, componentInstanceId, policyRevisionId: input.toPolicyRevisionId })).sort(); const stage3PlansStaled = await this.pcbSync.invalidateProjectPlansByPassivePolicy({ tenantId: input.tenantId, projectId: input.projectId, branchId: input.branchId, componentInstanceIds: affectedComponentIds, fromPolicyRevisionId: input.fromPolicyRevisionId, toPolicyRevisionId: input.toPolicyRevisionId, reason: input.reason, occurredAt: input.occurredAt }); return { stage2DependencyKeys, stage3PlansStaled }; }
}

export function passivePolicyOutboxHandlers(input: { workflow: DurableWorkflowRepository; target: PassivePolicyInvalidationTarget }): ReadonlyMap<string, DurableEffectHandler> {
  return new Map([[durableEventContractKey("passive-policy.invalidate", 1), async (event) => {
    assertDurableOutboxEvent(event); const envelope = await ownerEnvelope(input.workflow, event), value = event.payload as unknown as Parameters<PassivePolicyInvalidationTarget["invalidate"]>[0];
    if (value.tenantId !== envelope.invalidation.tenantId || value.projectId !== envelope.invalidation.projectId || value.branchId !== envelope.invalidation.branchId || value.fromPolicyRevisionId !== envelope.invalidation.fromPolicyRevisionId || value.toPolicyRevisionId !== envelope.invalidation.toPolicyRevisionId || value.occurredAt !== envelope.invalidation.occurredAt || passivePolicyDigest([...value.affectedComponentIds].sort()) !== passivePolicyDigest(envelope.invalidation.affectedComponentIds) || passivePolicyDigest([...value.assemblyVariantIds].sort()) !== passivePolicyDigest(envelope.invalidation.assemblyVariantIds)) throw new Error("PP_INVALIDATION_OWNER_PAYLOAD_MISMATCH");
    const prior = await loadReceipt(input.workflow, event); if (prior) return;
    const outcome = await input.target.invalidate(value), stage3PlansStaled = await reconciledPlanCount(input.workflow, event, value.toPolicyRevisionId, outcome.stage3PlansStaled); await storeReceipt(input.workflow, event, { ...outcome, stage3PlansStaled });
  }]]);
}
