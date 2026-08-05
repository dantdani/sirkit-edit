import type { EngineeringActor } from "../engineering/types";
import type { DurableEffectHandler } from "../durable-workflow/outbox";
import { assertDurableOutboxEvent, durableAggregateIdentity, durableEventContractKey, durableScopeKey, durableWorkflowId } from "../durable-workflow/stable";
import type { DurableOutboxEvent, DurableWorkflowRepository, DurableWorkflowScope } from "../durable-workflow/types";
import { mappingDigest, mappingId } from "./stable";
import { MAPPING_AUDIT_VERSION, type MappingAuditEvent, type MappingCommitResult, type MappingContext, type MappingContextProvider, type MappingConvergence, type MappingEffectStatus, type MappingInvalidationEvent, type MappingInvalidationTarget, type MappingRecord, type MappingRepository, type MappingRepositoryScope, type MappingVerificationRequest, type MappingVerificationResult, type MappingVerificationResultLookup, type MappingVerificationResultStore, type PhysicalTerminalMappingCandidate, type Stage1MappingProjector } from "./types";

const RECORD = "mapping-verification.record.v1";
const CONTEXT = "mapping-verification.context.v1";
const CANDIDATE = "mapping-verification.candidate.v1";
const RESULT = "mapping-verification.result.v1";
const RECEIPT = "mapping-verification.effect-receipt.v1";

interface MappingEnvelope { record: MappingRecord; audit: MappingAuditEvent; invalidation: MappingInvalidationEvent; stage1Reference: MappingCommitResult["stage1Reference"] }
interface VerificationEnvelope { result: MappingVerificationResult; context: MappingContext; request: MappingVerificationRequest }
type MappingEffectOutcome = { kind: "projection"; stage1Reference: MappingCommitResult["stage1Reference"] } | { kind: "invalidation"; stage2DependencyKeys: string[]; stage3PlansStaled: number };
interface MappingEffectReceipt { schemaVersion: "sirkit.mapping-effect-receipt.v1"; eventId: string; eventDigest: string; ownerAggregateType: string; ownerAggregateKey: string; ownerAggregateRevision: number; eventType: string; eventVersion: number; outcome: MappingEffectOutcome; recordedAt: string }

function scope(value: MappingRepositoryScope): DurableWorkflowScope { return { tenantId: value.tenantId, projectId: value.projectId, branchId: value.branchId }; }
function aggregateKey(input: MappingRepositoryScope): string { return durableWorkflowId("mapping-scope", { tenantId: input.tenantId, projectId: input.projectId, branchId: input.branchId, componentInstanceId: input.componentInstanceId, assemblyVariantId: input.assemblyVariantId }); }
function replayScope(input: MappingRepositoryScope): string { return durableScopeKey(scope(input), `mapping:${input.componentInstanceId}:${input.assemblyVariantId}`); }
function contextScope(value: MappingContext): DurableWorkflowScope { return { tenantId: value.scope.tenantId, projectId: value.scope.projectId, branchId: value.scope.branchId }; }
function repositoryScope(record: MappingRecord): MappingRepositoryScope { return { tenantId: record.scope.tenantId, projectId: record.scope.projectId, branchId: record.scope.branchId, componentInstanceId: record.scope.componentInstanceId, assemblyVariantId: record.scope.assemblyVariantId }; }
function sameScope(left: DurableWorkflowScope, right: DurableWorkflowScope): boolean { return left.tenantId === right.tenantId && left.projectId === right.projectId && left.branchId === right.branchId; }
function invalidationTopic(record: MappingRecord): string { return `mapping.invalidate.${durableWorkflowId("mapping-effect", { mappingRevisionId: record.revisionId, revision: record.revision })}`; }
function terminal(eventType: string, eventVersion: number, code: string, attempts = 0): MappingEffectStatus { return { state: "terminal_failed", eventType, eventVersion, attempts, errorCode: code }; }

async function loadReceipt(workflow: DurableWorkflowRepository, event: DurableOutboxEvent): Promise<MappingEffectReceipt | null> {
  const value = (await workflow.loadHead<MappingEffectReceipt>(durableAggregateIdentity(event.scope, RECEIPT, event.eventId)))?.payload ?? null;
  if (value && (value.eventDigest !== event.eventDigest || value.ownerAggregateType !== event.ownerAggregateType || value.ownerAggregateKey !== event.ownerAggregateKey || value.ownerAggregateRevision !== event.ownerAggregateRevision || value.eventType !== event.eventType || value.eventVersion !== event.eventVersion)) throw new Error("MV_EFFECT_RECEIPT_CONFLICT");
  return value;
}

async function storeReceipt(workflow: DurableWorkflowRepository, event: DurableOutboxEvent, outcome: MappingEffectOutcome): Promise<MappingEffectReceipt> {
  const prior = await loadReceipt(workflow, event);
  if (prior) return prior;
  const receipt: MappingEffectReceipt = { schemaVersion: "sirkit.mapping-effect-receipt.v1", eventId: event.eventId, eventDigest: event.eventDigest, ownerAggregateType: event.ownerAggregateType, ownerAggregateKey: event.ownerAggregateKey, ownerAggregateRevision: event.ownerAggregateRevision, eventType: event.eventType, eventVersion: event.eventVersion, outcome: structuredClone(outcome), recordedAt: event.createdAt };
  const committed = await workflow.commit({ scope: event.scope, scopeKey: durableScopeKey(event.scope, `mapping-effect:${event.eventId}`), idempotencyKey: `mapping-effect:${event.eventId}`, operations: [{ aggregateType: RECEIPT, aggregateKey: event.eventId, expectedRevision: 0, payload: receipt, recordDigest: mappingDigest(receipt) }], outbox: [], result: receipt, committedAt: event.createdAt });
  return structuredClone(committed.result);
}

async function ownerEnvelope(workflow: DurableWorkflowRepository, event: DurableOutboxEvent): Promise<MappingEnvelope> {
  if (event.ownerAggregateType !== RECORD) throw new Error("MV_EFFECT_OWNER_TYPE_MISMATCH");
  const history = await workflow.history<MappingEnvelope>(durableAggregateIdentity(event.scope, event.ownerAggregateType, event.ownerAggregateKey)), owner = history.find((item) => item.revision === event.ownerAggregateRevision);
  if (!owner) throw new Error("MV_EFFECT_OWNER_REVISION_MISSING");
  const envelope = owner.payload, record = envelope.record;
  if (record.revision !== event.ownerAggregateRevision || event.ownerAggregateKey !== aggregateKey(repositoryScope(record)) || !sameScope(event.scope, contextScope({ scope: record.scope } as MappingContext))) throw new Error("MV_EFFECT_OWNER_AUTHORITY_MISMATCH");
  return envelope;
}

async function observed(workflow: DurableWorkflowRepository, event: DurableOutboxEvent | undefined, expectedType: string, expectedVersion: number): Promise<{ status: MappingEffectStatus; receipt: MappingEffectReceipt | null }> {
  if (!event) return { status: terminal(expectedType, expectedVersion, "MV_REQUIRED_EFFECT_MISSING"), receipt: null };
  if (event.eventType !== expectedType || event.eventVersion !== expectedVersion) return { status: terminal(expectedType, expectedVersion, "MV_EFFECT_CONTRACT_UNSUPPORTED", event.attempts), receipt: null };
  const receipt = await loadReceipt(workflow, event);
  if (event.state === "failed") return { status: terminal(expectedType, expectedVersion, event.lastErrorCode ?? "MV_EFFECT_TERMINAL", event.attempts), receipt };
  if (event.state === "completed") return receipt ? { status: { state: "completed", eventType: expectedType, eventVersion: expectedVersion, attempts: event.attempts, completedAt: event.completedAt ?? event.createdAt }, receipt } : { status: terminal(expectedType, expectedVersion, "MV_EFFECT_RECEIPT_MISSING", event.attempts), receipt: null };
  if (event.lastErrorCode) return { status: { state: "retryable_failed", eventType: expectedType, eventVersion: expectedVersion, attempts: event.attempts, errorCode: event.lastErrorCode }, receipt };
  return { status: { state: "pending", eventType: expectedType, eventVersion: expectedVersion, attempts: event.attempts }, receipt };
}

async function projectionCompleted(workflow: DurableWorkflowRepository, dependent: DurableOutboxEvent): Promise<boolean> {
  const events = (await workflow.listOutbox({ scope: dependent.scope, eventType: "mapping.stage1-project" })).filter((item) => item.ownerAggregateType === dependent.ownerAggregateType && item.ownerAggregateKey === dependent.ownerAggregateKey && item.ownerAggregateRevision === dependent.ownerAggregateRevision && item.eventVersion === 1);
  return events.length === 1 && events[0]!.state === "completed" && Boolean(await loadReceipt(workflow, events[0]!));
}

async function reconciledPlanCount(workflow: DurableWorkflowRepository, event: DurableOutboxEvent, prefix: string, fallback: number): Promise<number> {
  const transitions = (await workflow.listOutbox({ scope: event.scope, eventType: "pcb-sync.plan-staled" })).filter((item) => item.idempotencyKey.startsWith(`${prefix}:`)), plans = new Set(transitions.map((item) => { const value = item.payload as { boardId?: string; planId?: string }; return `${value.boardId ?? ""}\0${value.planId ?? ""}`; }).filter((value) => value !== "\0"));
  return Math.max(fallback, plans.size);
}

export async function readyMappingInvalidationTopics(workflow: DurableWorkflowRepository): Promise<string[]> {
  const events = (await workflow.listOutbox({ eventType: "mapping.invalidate" })).filter((event) => event.eventVersion === 2 && event.state !== "completed" && event.state !== "failed"), topics: string[] = [];
  for (const event of events) {
    const envelope = await ownerEnvelope(workflow, event);
    if (event.topic === invalidationTopic(envelope.record) && await projectionCompleted(workflow, event)) topics.push(event.topic);
  }
  return [...new Set(topics)].sort();
}

export class DurableMappingRepository implements MappingRepository {
  constructor(private readonly workflow: DurableWorkflowRepository) {}
  private async envelope(input: MappingRepositoryScope): Promise<MappingEnvelope | null> { return (await this.workflow.loadHead<MappingEnvelope>(durableAggregateIdentity(scope(input), RECORD, aggregateKey(input))))?.payload ?? null; }
  async getHead(input: MappingRepositoryScope): Promise<MappingRecord | null> { return structuredClone((await this.envelope(input))?.record ?? null); }
  async getRevision(input: MappingRepositoryScope, revisionId: string): Promise<MappingRecord | null> { const records = await this.history(input); return records.find((item) => item.revisionId === revisionId) ?? null; }
  async history(input: MappingRepositoryScope): Promise<MappingRecord[]> { return (await this.workflow.history<MappingEnvelope>(durableAggregateIdentity(scope(input), RECORD, aggregateKey(input)))).map((entry) => structuredClone(entry.payload.record)); }
  async audits(input: MappingRepositoryScope): Promise<MappingAuditEvent[]> { return (await this.workflow.history<MappingEnvelope>(durableAggregateIdentity(scope(input), RECORD, aggregateKey(input)))).map((entry) => structuredClone(entry.payload.audit)); }
  async invalidations(input: MappingRepositoryScope): Promise<MappingInvalidationEvent[]> { return (await this.workflow.history<MappingEnvelope>(durableAggregateIdentity(scope(input), RECORD, aggregateKey(input)))).map((entry) => structuredClone(entry.payload.invalidation)); }
  async getIdempotent(input: MappingRepositoryScope, key: string): Promise<MappingCommitResult | null> { return structuredClone((await this.workflow.getReplay<MappingCommitResult>(scope(input), replayScope(input), key))?.result ?? null); }
  async withLock<T>(_scope: MappingRepositoryScope, _timeoutMs: number, operation: () => Promise<T>): Promise<T> { return operation(); }
  async convergence(input: MappingRepositoryScope, revisionId: string): Promise<MappingConvergence> {
    const records = await this.workflow.history<MappingEnvelope>(durableAggregateIdentity(scope(input), RECORD, aggregateKey(input))), owner = records.find((item) => item.payload.record.revisionId === revisionId);
    if (!owner) throw new Error("MV_MAPPING_REVISION_NOT_FOUND");
    const events = (await this.workflow.listOutbox({ scope: scope(input) })).filter((event) => event.ownerAggregateType === RECORD && event.ownerAggregateKey === owner.aggregateKey && event.ownerAggregateRevision === owner.revision), projections = events.filter((event) => event.eventType === "mapping.stage1-project"), invalidations = events.filter((event) => event.eventType === "mapping.invalidate");
    const projection = projections.length === 1 ? await observed(this.workflow, projections[0], "mapping.stage1-project", 1) : { status: terminal("mapping.stage1-project", 1, "MV_PROJECTION_EFFECT_CARDINALITY"), receipt: null };
    let invalidation = invalidations.length === 1 ? await observed(this.workflow, invalidations[0], "mapping.invalidate", 2) : { status: terminal("mapping.invalidate", 2, "MV_INVALIDATION_EFFECT_CARDINALITY"), receipt: null };
    if (invalidations.length === 1 && invalidations[0]!.topic !== invalidationTopic(owner.payload.record)) invalidation = { status: terminal("mapping.invalidate", 2, "MV_INVALIDATION_TOPIC_MISMATCH", invalidations[0]!.attempts), receipt: null };
    if (projection.status.state === "terminal_failed" && invalidation.status.state !== "completed") invalidation = { status: terminal("mapping.invalidate", 2, "MV_PROJECTION_TERMINAL_BLOCK", invalidations[0]?.attempts ?? 0), receipt: invalidation.receipt };
    const statuses = [projection.status.state, invalidation.status.state], state = statuses.includes("terminal_failed") ? "terminal_failed" : statuses.includes("retryable_failed") ? "retryable_failed" : statuses.every((value) => value === "completed") ? "completed" : "pending";
    const outcome = invalidation.receipt?.outcome.kind === "invalidation" ? { stage2DependencyKeys: [...invalidation.receipt.outcome.stage2DependencyKeys], stage3PlansStaled: invalidation.receipt.outcome.stage3PlansStaled } : null;
    return { owner: { aggregateType: RECORD, aggregateKey: owner.aggregateKey, aggregateRevision: owner.revision, mappingRevisionId: revisionId }, state, projection: projection.status, invalidation: invalidation.status, outcome };
  }
  async commit(input: Parameters<MappingRepository["commit"]>[0]): Promise<MappingCommitResult> {
    const prior = await this.workflow.loadHead<MappingEnvelope>(durableAggregateIdentity(scope(input.scope), RECORD, aggregateKey(input.scope)));
    if ((prior?.payload.record.revision ?? 0) !== input.expectedRevision) throw new Error("MV_OPTIMISTIC_REVISION_CONFLICT");
    if (input.record.revision !== input.expectedRevision + 1 || input.record.predecessorRevisionId !== prior?.payload.record.revisionId) throw new Error("MV_RECORD_SUCCESSOR_INVALID");
    const auditBase = { schemaVersion: MAPPING_AUDIT_VERSION, eventId: mappingId("mapping-audit", { mapping: input.record.mappingId, revision: input.record.revisionId, action: input.action, idempotencyKey: input.idempotencyKey }), mappingId: input.record.mappingId, fromRevisionId: prior?.payload.record.revisionId ?? null, toRevisionId: input.record.revisionId, action: input.action, actor: structuredClone(input.actor), reason: input.reason, idempotencyKey: input.idempotencyKey, occurredAt: input.record.createdAt };
    const audit: MappingAuditEvent = { ...auditBase, eventDigest: mappingDigest(auditBase) };
    const invalidationBase = { ...input.invalidation, eventId: mappingId("mapping-invalidation", { mapping: input.record.mappingId, revision: input.record.revisionId, reason: input.invalidation.reason }) }, invalidation: MappingInvalidationEvent = { ...invalidationBase, eventDigest: mappingDigest(invalidationBase) };
    const result: MappingCommitResult = { record: structuredClone(input.record), audit, invalidation, stage1Reference: structuredClone(input.stage1Reference), idempotent: false }, envelope: MappingEnvelope = { record: result.record, audit, invalidation, stage1Reference: result.stage1Reference }, owner = { aggregateType: RECORD, aggregateKey: aggregateKey(input.scope) };
    const prerequisite = { eventType: "mapping.stage1-project", eventVersion: 1 }, invalidationPayload = { scope: input.record.scope, ownerRevisionId: input.record.revisionId, ownerRevision: input.record.revision, prerequisite, oldCertificateId: input.invalidation.oldCertificateId, newCertificateId: input.invalidation.newCertificateId, newMappingRevisionId: input.record.revisionId, reason: input.reason, occurredAt: input.record.createdAt };
    const committed = await this.workflow.commit({ scope: scope(input.scope), scopeKey: replayScope(input.scope), idempotencyKey: input.idempotencyKey, operations: [{ ...owner, expectedRevision: prior?.revision ?? 0, payload: envelope, recordDigest: input.record.recordDigest }], outbox: [{ owner, eventType: "mapping.stage1-project", eventVersion: 1, topic: "mapping.stage1-project", payload: { record: input.record, actor: input.actor, idempotencyKey: input.idempotencyKey } as unknown as Record<string, unknown> }, { owner, eventType: "mapping.invalidate", eventVersion: 2, topic: invalidationTopic(input.record), payload: invalidationPayload as unknown as Record<string, unknown> }], result, committedAt: input.record.createdAt });
    return structuredClone(committed.result);
  }
}

export class DurableMappingContextStore implements MappingContextProvider, MappingVerificationResultStore {
  constructor(private readonly workflow: DurableWorkflowRepository) {}
  async publishContext(value: MappingContext, input: { expectedRevision: number; idempotencyKey: string; publishedAt: string }): Promise<void> { const s = contextScope(value); await this.workflow.commit({ scope: s, scopeKey: durableScopeKey(s, `mapping-context:${value.contextId}`), idempotencyKey: input.idempotencyKey, operations: [{ aggregateType: CONTEXT, aggregateKey: value.contextId, expectedRevision: input.expectedRevision, payload: structuredClone(value), recordDigest: mappingDigest(value) }], outbox: [], result: { contextId: value.contextId }, committedAt: input.publishedAt }); }
  async publishCandidate(value: PhysicalTerminalMappingCandidate, context: MappingContext, input: { expectedRevision: number; idempotencyKey: string; publishedAt: string }): Promise<void> { const s = contextScope(context); await this.workflow.commit({ scope: s, scopeKey: durableScopeKey(s, `mapping-candidate:${value.mappingCandidateId}`), idempotencyKey: input.idempotencyKey, operations: [{ aggregateType: CANDIDATE, aggregateKey: value.mappingCandidateId, expectedRevision: input.expectedRevision, payload: structuredClone(value), recordDigest: value.candidateDigest }], outbox: [], result: { candidateId: value.mappingCandidateId }, committedAt: input.publishedAt }); }
  async getContext(request: MappingVerificationRequest, signal?: AbortSignal): Promise<MappingContext> { if (signal?.aborted) throw new Error("MV_REQUEST_CANCELLED"); const s = { tenantId: request.tenantId, projectId: request.projectId, branchId: request.branchId }, value = (await this.workflow.loadHead<MappingContext>(durableAggregateIdentity(s, CONTEXT, request.contextId)))?.payload; if (!value) throw new Error("MV_CONTEXT_NOT_FOUND"); return structuredClone(value); }
  async getCandidate(request: MappingVerificationRequest, signal?: AbortSignal): Promise<PhysicalTerminalMappingCandidate> { if (signal?.aborted) throw new Error("MV_REQUEST_CANCELLED"); const s = { tenantId: request.tenantId, projectId: request.projectId, branchId: request.branchId }, value = (await this.workflow.loadHead<PhysicalTerminalMappingCandidate>(durableAggregateIdentity(s, CANDIDATE, request.mappingCandidateId)))?.payload; if (!value) throw new Error("MV_CANDIDATE_NOT_FOUND"); return structuredClone(value); }
  async put(input: VerificationEnvelope): Promise<void> { const s = contextScope(input.context), prior = await this.workflow.loadHead<VerificationEnvelope>(durableAggregateIdentity(s, RESULT, input.result.verificationId)); if (prior?.payload.result.resultDigest === input.result.resultDigest) return; if (prior) throw new Error("MV_VERIFICATION_ID_COLLISION"); await this.workflow.commit({ scope: s, scopeKey: durableScopeKey(s, `mapping-result:${input.result.verificationId}`), idempotencyKey: `mapping-result:${input.result.verificationId}`, operations: [{ aggregateType: RESULT, aggregateKey: input.result.verificationId, expectedRevision: 0, payload: structuredClone(input), recordDigest: input.result.resultDigest }], outbox: [], result: { verificationId: input.result.verificationId }, committedAt: input.result.evaluatedAt }); }
  async get(input: MappingVerificationResultLookup): Promise<VerificationEnvelope | null> { const s = { tenantId: input.tenantId, projectId: input.projectId, branchId: input.branchId }; return structuredClone((await this.workflow.loadHead<VerificationEnvelope>(durableAggregateIdentity(s, RESULT, input.verificationId)))?.payload ?? null); }
}

function payload<T>(event: DurableOutboxEvent): T { return event.payload as unknown as T; }
export function mappingOutboxHandlers(input: { workflow: DurableWorkflowRepository; projector: Stage1MappingProjector; invalidation: MappingInvalidationTarget }): ReadonlyMap<string, DurableEffectHandler> {
  return new Map<string, DurableEffectHandler>([
    [durableEventContractKey("mapping.stage1-project", 1), async (event) => {
      assertDurableOutboxEvent(event); const envelope = await ownerEnvelope(input.workflow, event), value = payload<{ record: MappingRecord; actor: EngineeringActor; idempotencyKey: string }>(event);
      if (mappingDigest(value.record) !== mappingDigest(envelope.record) || value.idempotencyKey !== envelope.audit.idempotencyKey || mappingDigest(value.actor) !== mappingDigest(envelope.audit.actor)) throw new Error("MV_PROJECTION_OWNER_PAYLOAD_MISMATCH");
      const prior = await loadReceipt(input.workflow, event); if (prior) { if (prior.outcome.kind !== "projection") throw new Error("MV_EFFECT_RECEIPT_CONFLICT"); return; }
      const stage1Reference = await input.projector.project(value.record, value.actor, value.idempotencyKey); await storeReceipt(input.workflow, event, { kind: "projection", stage1Reference });
    }],
    [durableEventContractKey("mapping.invalidate", 2), async (event) => {
      assertDurableOutboxEvent(event); const envelope = await ownerEnvelope(input.workflow, event), value = payload<{ scope: MappingRecord["scope"]; ownerRevisionId: string; ownerRevision: number; prerequisite: { eventType: string; eventVersion: number }; oldCertificateId: string | null; newCertificateId: string; newMappingRevisionId: string; reason: string; occurredAt: string }>(event);
      if (event.topic !== invalidationTopic(envelope.record) || value.ownerRevisionId !== envelope.record.revisionId || value.ownerRevision !== event.ownerAggregateRevision || value.prerequisite?.eventType !== "mapping.stage1-project" || value.prerequisite.eventVersion !== 1 || mappingDigest(value.scope) !== mappingDigest(envelope.record.scope) || value.newMappingRevisionId !== envelope.record.revisionId || value.newCertificateId !== envelope.invalidation.newCertificateId || value.oldCertificateId !== envelope.invalidation.oldCertificateId || value.reason !== envelope.invalidation.reason || value.occurredAt !== envelope.invalidation.occurredAt) throw new Error("MV_INVALIDATION_OWNER_PAYLOAD_MISMATCH");
      if (!await projectionCompleted(input.workflow, event)) throw new Error("MV_PROJECTION_PREREQUISITE_PENDING");
      const prior = await loadReceipt(input.workflow, event); if (prior) { if (prior.outcome.kind !== "invalidation") throw new Error("MV_EFFECT_RECEIPT_CONFLICT"); return; }
      const outcome = await input.invalidation.invalidate(value), stage3PlansStaled = await reconciledPlanCount(input.workflow, event, `mapping-invalidation:${value.scope.componentInstanceId}:${value.newCertificateId}`, outcome.stage3PlansStaled); await storeReceipt(input.workflow, event, { kind: "invalidation", stage2DependencyKeys: [...new Set(outcome.stage2DependencyKeys)].sort(), stage3PlansStaled });
    }],
  ]);
}
