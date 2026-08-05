import { actorCapabilities } from "../engineering/authorization";
import type { EngineeringActor } from "../engineering/types";
import { resolveMappingPolicy, validateMappingPolicy } from "./policy";
import { assertCandidateDigest, assertResultDigest, candidateTechnicalPayload, mappingDigest, mappingId } from "./stable";
import { DeterministicMappingVerifier } from "./verifier";
import { MAPPING_RECORD_VERSION, MAPPING_REQUEST_VERSION, MAPPING_VERIFIER_VERSION, type MappingCommitResult, type MappingContext, type MappingContextProvider, type MappingInvalidationEvent, type MappingInvalidationTarget, type MappingMutationRequest, type MappingRecord, type MappingRepository, type MappingRepositoryScope, type MappingVerificationRequest, type MappingVerificationResult, type MappingVerificationResultLookup, type MappingVerificationResultStore, type MappingVerificationState, type Stage1MappingProjector } from "./types";
import { stage1ReferenceForRecord } from "./stage1-projector";
import { MappingTelemetry, type MappingMetric } from "./observability";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+\-]{0,511}$/;
function validId(value: unknown): value is string { return typeof value === "string" && ID.test(value) && !/[\u0000-\u001f\u007f]/.test(value) && !value.includes(".."); }
function repositoryScopeFromContext(context: MappingContext): MappingRepositoryScope { return { tenantId: context.scope.tenantId, projectId: context.scope.projectId, branchId: context.scope.branchId, componentInstanceId: context.scope.componentInstanceId, assemblyVariantId: context.scope.assemblyVariantId }; }
function verificationState(result: MappingVerificationResult): MappingVerificationState {
  if (result.status === "verified") return result.tier === "exact_part" ? "verified_exact_part" : result.tier === "package_family" ? "verified_package_family" : "verified_curated_pair";
  if (result.status === "verified_limited") return "verified_limited_direct_pair";
  if (result.status === "ambiguous") return "ambiguous";
  if (result.status === "conflicting") return "conflicting";
  if (result.status === "incomplete") return "incomplete";
  if (result.status === "unsupported_construct") return "unsupported";
  if (result.status === "stale_dependency") return "stale";
  return "invalid";
}
function recordDigest(record: Omit<MappingRecord, "recordDigest">): MappingRecord { return { ...record, recordDigest: mappingDigest(record) }; }

type StoredVerificationResult = { result: MappingVerificationResult; context: MappingContext; request: MappingVerificationRequest };

function durableResultIdentity(value: StoredVerificationResult): unknown {
  const { requestId: _requestId, evaluatedAt: _evaluatedAt, ...technicalResult } = value.result;
  void _requestId; void _evaluatedAt;
  return {
    context: { contextId: value.context.contextId, scope: value.context.scope, dependencySnapshot: value.context.dependencySnapshot },
    request: { contextId: value.request.contextId, mappingCandidateId: value.request.mappingCandidateId, tenantId: value.request.tenantId, projectId: value.request.projectId, branchId: value.request.branchId, assemblyVariantId: value.request.assemblyVariantId, policyId: value.request.policyId, policyVersion: value.request.policyVersion },
    result: technicalResult,
  };
}

export interface MappingVerificationServiceOptions { provider: MappingContextProvider; repository: MappingRepository; stage1Projector: Stage1MappingProjector; invalidation: MappingInvalidationTarget; resultStore?: MappingVerificationResultStore; effectMode?: "inline" | "outbox"; verifier?: DeterministicMappingVerifier; telemetry?: MappingTelemetry }

export class MappingVerificationService {
  private readonly verifier: DeterministicMappingVerifier;
  private readonly telemetry?: MappingTelemetry;
  constructor(private readonly options: MappingVerificationServiceOptions) { this.verifier = options.verifier ?? new DeterministicMappingVerifier(); this.telemetry = options.telemetry; }
  private verifiedStoredResult(verificationId: string, value: StoredVerificationResult, expected?: StoredVerificationResult): StoredVerificationResult {
    assertResultDigest(value.result);
    if (value.result.verificationId !== verificationId) throw new Error("MV_RESULT_STORE_ID_MISMATCH");
    const scope = value.context.scope, request = value.request, result = value.result;
    if (value.context.contextId !== request.contextId || result.requestId !== request.requestId || result.evaluatedAt !== request.requestedAt || result.mappingCandidateId !== request.mappingCandidateId || result.policyId !== request.policyId || result.policyVersion !== request.policyVersion || scope.tenantId !== request.tenantId || scope.projectId !== request.projectId || scope.branchId !== request.branchId || scope.assemblyVariantId !== request.assemblyVariantId || mappingDigest(value.context.dependencySnapshot) !== mappingDigest(result.dependencySnapshot)) throw new Error("MV_RESULT_STORE_INTEGRITY_CONFLICT");
    if (result.normalizedMapping) {
      assertCandidateDigest(result.normalizedMapping);
      if (result.normalizedMapping.mappingCandidateId !== result.mappingCandidateId || result.normalizedMapping.candidateDigest !== result.candidateDigest || result.normalizedMapping.dependencyDigest !== result.dependencySnapshot.dependencyDigest || mappingDigest(result.normalizedMapping.scope) !== mappingDigest(scope)) throw new Error("MV_RESULT_STORE_INTEGRITY_CONFLICT");
    }
    if (expected && mappingDigest(durableResultIdentity(value)) !== mappingDigest(durableResultIdentity(expected))) throw new Error("MV_RESULT_STORE_INTEGRITY_CONFLICT");
    return structuredClone(value);
  }
  private async storedResult(lookup: MappingVerificationResultLookup): Promise<StoredVerificationResult | null> {
    if (!this.options.resultStore) throw new Error("MV_RESULT_STORE_UNAVAILABLE");
    const stored = await this.options.resultStore.get(lookup);
    return stored ? this.verifiedStoredResult(lookup.verificationId, stored) : null;
  }
  private async rememberResult(value: StoredVerificationResult): Promise<StoredVerificationResult> {
    const intended = this.verifiedStoredResult(value.result.verificationId, value);
    if (!this.options.resultStore) return intended;
    await this.options.resultStore.put(structuredClone(intended));
    const stored = await this.options.resultStore.get({ verificationId: intended.result.verificationId, tenantId: intended.request.tenantId, projectId: intended.request.projectId, branchId: intended.request.branchId });
    if (!stored) throw new Error("MV_RESULT_STORE_WRITE_NOT_VISIBLE");
    return this.verifiedStoredResult(intended.result.verificationId, stored, intended);
  }

  private authorizeRead(actor: EngineeringActor, at: string): void { if (!actorCapabilities(actor, new Date(at)).has("read_project")) throw new Error("MV_VERIFY_AUTHORIZATION_DENIED"); }
  private validateRequest(request: MappingVerificationRequest): void {
    if (request.requestSchemaVersion !== MAPPING_REQUEST_VERSION) throw new Error("MV_REQUEST_SCHEMA_UNSUPPORTED");
    for (const value of [request.requestId, request.contextId, request.mappingCandidateId, request.tenantId, request.projectId, request.branchId, request.assemblyVariantId, request.policyId, request.policyVersion, request.actorContext?.actorId, request.actorContext?.sessionId]) if (!validId(value)) throw new Error("MV_REQUEST_ID_INVALID");
    if (!Number.isFinite(Date.parse(request.requestedAt))) throw new Error("MV_REQUEST_TIMESTAMP_INVALID");
    if (request.traceLevel === "diagnostic" && !["reviewer", "project_admin"].includes(request.actorContext.role)) throw new Error("MV_DIAGNOSTIC_TRACE_UNAUTHORIZED");
  }
  private assertScope(request: MappingVerificationRequest, context: MappingContext, candidate: Awaited<ReturnType<MappingContextProvider["getCandidate"]>>): void {
    if (context.scope.tenantId !== request.tenantId || context.scope.projectId !== request.projectId || context.scope.branchId !== request.branchId || context.scope.assemblyVariantId !== request.assemblyVariantId || candidate.scope.tenantId !== request.tenantId || candidate.scope.projectId !== request.projectId || candidate.scope.branchId !== request.branchId || candidate.scope.assemblyVariantId !== request.assemblyVariantId || candidate.scope.componentInstanceId !== context.scope.componentInstanceId || candidate.scope.bindingRevisionId !== context.scope.bindingRevisionId) throw new Error("MV_CONTEXT_SCOPE_MISMATCH");
  }
  private async loadAuthoritative(request: MappingVerificationRequest, signal: AbortSignal | undefined, timeoutMs: number): Promise<[MappingContext, Awaited<ReturnType<MappingContextProvider["getCandidate"]>>]> {
    if (signal?.aborted) throw new Error("MV_REQUEST_CANCELLED");
    const controller = new AbortController();
    const relay = () => controller.abort(); signal?.addEventListener("abort", relay, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const aborted = new Promise<never>((_resolve, reject) => controller.signal.addEventListener("abort", () => reject(new Error(signal?.aborted ? "MV_REQUEST_CANCELLED" : "MV_REQUEST_TIMEOUT")), { once: true }));
    try {
      return await Promise.race([Promise.all([this.options.provider.getContext(request, controller.signal), this.options.provider.getCandidate(request, controller.signal)]), aborted]);
    } finally {
      clearTimeout(timer); signal?.removeEventListener("abort", relay);
    }
  }
  async inspect(request: MappingVerificationRequest, signal?: AbortSignal): Promise<{ context: MappingContext; candidateDigest: string; boardChanged: false }> {
    this.validateRequest(request); this.authorizeRead(request.actorContext, request.requestedAt);
    const policy = resolveMappingPolicy(request.policyId, request.policyVersion);
    const [context, candidate] = await this.loadAuthoritative(request, signal, policy.timeoutMs);
    this.assertScope(request, context, candidate);
    const safeContext = structuredClone(context);
    safeContext.evidence = safeContext.evidence.map((item) => item.confidential ? { ...item, locator: "[restricted]", reviewerId: undefined } : item);
    return { context: safeContext, candidateDigest: mappingDigest(candidateTechnicalPayload(candidate)), boardChanged: false };
  }
  async verify(request: MappingVerificationRequest, signal?: AbortSignal): Promise<MappingVerificationResult> {
    const started = performance.now(); this.validateRequest(request); this.authorizeRead(request.actorContext, request.requestedAt);
    const policy = resolveMappingPolicy(request.policyId, request.policyVersion), policyErrors = validateMappingPolicy(policy); if (policyErrors.length) throw new Error(policyErrors[0]);
    const [context, candidate] = await this.loadAuthoritative(request, signal, policy.timeoutMs);
    if (signal?.aborted) throw new Error("MV_REQUEST_CANCELLED");
    this.assertScope(request, context, candidate);
    if (context.symbolPins.length > policy.maxPins || context.packageTerminals.length > policy.maxTerminals || context.footprintPads.length > policy.maxPads || context.evidence.length > policy.maxEvidence || candidate.equivalenceClasses.length > policy.maxEquivalenceClasses) throw new Error("MV_CONTEXT_LIMIT_EXCEEDED");
    const generated = this.verifier.verify(request, context, candidate, policy);
    const { result } = await this.rememberResult({ result: structuredClone(generated), context: structuredClone(context), request: structuredClone(request) });
    const common = { tenantId: request.tenantId, projectId: request.projectId, occurredAt: request.requestedAt, verifierVersion: MAPPING_VERIFIER_VERSION, policyVersion: policy.version, riskClass: context.riskClass };
    this.telemetry?.record({ ...common, metric: "verify", value: 1, status: result.status, tier: result.tier }); this.telemetry?.record({ ...common, metric: "verify_ms", value: Math.max(0, performance.now() - started), status: result.status, tier: result.tier });
    this.telemetry?.record({ ...common, metric: "pin_count", value: context.symbolPins.length, status: result.status, tier: result.tier }); this.telemetry?.record({ ...common, metric: "terminal_count", value: context.packageTerminals.length, status: result.status, tier: result.tier }); this.telemetry?.record({ ...common, metric: "pad_count", value: context.footprintPads.length, status: result.status, tier: result.tier });
    for (const item of result.findings) this.telemetry?.record({ ...common, metric: "finding", value: 1, status: result.status, reasonCode: item.code });
    for (const item of result.conflicts) this.telemetry?.record({ ...common, metric: "conflict", value: 1, status: result.status, reasonCode: item.code });
    for (const item of result.ambiguities) this.telemetry?.record({ ...common, metric: "ambiguity", value: 1, status: result.status, reasonCode: item.code });
    return result;
  }
  async verifyBatch(requests: MappingVerificationRequest[], signal?: AbortSignal): Promise<MappingVerificationResult[]> {
    if (requests.length > 64) throw new Error("MV_BATCH_LIMIT_EXCEEDED");
    const results: MappingVerificationResult[] = [];
    for (let index = 0; index < requests.length; index += 8) { if (signal?.aborted) throw new Error("MV_REQUEST_CANCELLED"); results.push(...await Promise.all(requests.slice(index, index + 8).map((request) => this.verify(request, signal)))); }
    return results.sort((a, b) => a.mappingCandidateId.localeCompare(b.mappingCandidateId));
  }

  private authorizeMutation(request: MappingMutationRequest, approval = false): void {
    if (!request.reason.trim() || ![request.requestId, request.tenantId, request.projectId, request.branchId, request.componentInstanceId, request.assemblyVariantId, request.idempotencyKey].every(validId) || !Number.isFinite(Date.parse(request.requestedAt))) throw new Error("MV_MUTATION_REQUEST_INVALID");
    if (request.actorContext.actorKind !== "human") throw new Error("MV_MAPPING_MUTATION_HUMAN_REQUIRED");
    const roles = approval ? ["reviewer", "project_admin"] : ["pcb_editor", "reviewer", "project_admin"];
    if (!roles.includes(request.actorContext.role)) throw new Error(approval ? "MV_MAPPING_APPROVAL_UNAUTHORIZED" : "MV_MAPPING_MUTATION_UNAUTHORIZED");
  }
  private async replay(scope: MappingRepositoryScope, request: MappingMutationRequest): Promise<MappingCommitResult | null> { return this.options.repository.getIdempotent(scope, request.idempotencyKey); }
  private async revalidate(verificationId: string, mutation: MappingMutationRequest): Promise<{ result: MappingVerificationResult; context: MappingContext; request: MappingVerificationRequest }> {
    const lookup = { verificationId, tenantId: mutation.tenantId, projectId: mutation.projectId, branchId: mutation.branchId }, stored = await this.storedResult(lookup); if (!stored) throw new Error("MV_APPROVAL_REVALIDATION_REQUIRED");
    const refreshed = await this.verify({ ...stored.request, requestId: `revalidate-${mutation.requestId}`, actorContext: mutation.actorContext, requestedAt: mutation.requestedAt });
    if (refreshed.resultDigest !== stored.result.resultDigest || !["verified", "verified_limited"].includes(refreshed.status) || !refreshed.normalizedMapping) throw new Error("MV_VERIFICATION_STALE");
    return (await this.storedResult({ ...lookup, verificationId: refreshed.verificationId }))!;
  }
  private recordMutation(metric: MappingMetric, request: MappingMutationRequest, result: MappingCommitResult): void {
    this.telemetry?.record({ tenantId: request.tenantId, projectId: request.projectId, metric, value: 1, occurredAt: request.requestedAt, status: result.record.verification.status, tier: result.record.verification.tier, verifierVersion: MAPPING_VERIFIER_VERSION, policyVersion: result.record.verification.policyVersion });
    if (result.invalidation.stage3PlansStaled !== null) this.telemetry?.record({ tenantId: request.tenantId, projectId: request.projectId, metric: "invalidation", value: result.invalidation.stage3PlansStaled, occurredAt: request.requestedAt, status: result.record.verification.status, tier: result.record.verification.tier, verifierVersion: MAPPING_VERIFIER_VERSION, policyVersion: result.record.verification.policyVersion });
  }
  private async invalidation(record: MappingRecord, oldCertificateId: string | null, reason: string): Promise<Omit<MappingInvalidationEvent, "eventId" | "eventDigest">> {
    const outcome = this.options.effectMode === "outbox" ? { stage2DependencyKeys: [mappingDigest({ tenantId: record.scope.tenantId, projectId: record.scope.projectId, branchId: record.scope.branchId, componentInstanceId: record.scope.componentInstanceId, assemblyVariantId: record.scope.assemblyVariantId, oldCertificateId })], stage3PlansStaled: null } : await this.options.invalidation.invalidate({ scope: record.scope, oldCertificateId, newCertificateId: record.revisionId, newMappingRevisionId: record.revisionId, reason, occurredAt: record.createdAt });
    return { schemaVersion: "sirkit.mapping-invalidation.v1", scope: record.scope, mappingId: record.mappingId, fromMappingRevisionId: record.predecessorRevisionId ?? null, toMappingRevisionId: record.revisionId, oldCertificateId, newCertificateId: record.revisionId, reason, stage2CacheMode: "disabled", stage2DependencyKeys: outcome.stage2DependencyKeys, stage3PlansStaled: outcome.stage3PlansStaled, occurredAt: record.createdAt };
  }
  async persistVerification(request: MappingMutationRequest): Promise<MappingCommitResult> {
    this.authorizeMutation(request); if (!request.verificationId) throw new Error("MV_VERIFICATION_ID_REQUIRED");
    const initial = await this.storedResult({ verificationId: request.verificationId, tenantId: request.tenantId, projectId: request.projectId, branchId: request.branchId }); if (!initial || !["verified", "verified_limited"].includes(initial.result.status) || !initial.result.normalizedMapping) throw new Error("MV_VERIFICATION_NOT_PERSISTABLE");
    const scope = repositoryScopeFromContext(initial.context);
    if (scope.tenantId !== request.tenantId || scope.projectId !== request.projectId || scope.branchId !== request.branchId || scope.componentInstanceId !== request.componentInstanceId || scope.assemblyVariantId !== request.assemblyVariantId) throw new Error("MV_MAPPING_MUTATION_SCOPE_MISMATCH");
    const committed = await this.options.repository.withLock(scope, 2_000, async () => {
      const replay = await this.replay(scope, request); if (replay) return { ...replay, idempotent: true };
      const stored = await this.revalidate(request.verificationId!, request), normalizedMapping = stored.result.normalizedMapping!;
      const head = await this.options.repository.getHead(scope); if ((head?.revision ?? 0) !== request.expectedRevision) throw new Error("MV_OPTIMISTIC_REVISION_CONFLICT");
      const mappingIdValue = head?.mappingId ?? mappingId("physical-terminal-mapping", stored.context.scope), revision = (head?.revision ?? 0) + 1, revisionId = `${mappingIdValue}:r${revision}`;
      const base = { recordSchemaVersion: MAPPING_RECORD_VERSION, mappingId: mappingIdValue, revisionId, revision, ...(head ? { predecessorRevisionId: head.revisionId } : {}), scope: stored.context.scope, candidate: normalizedMapping, verification: stored.result, verificationState: verificationState(stored.result), approval: { state: "unreviewed" as const }, freshness: { state: "current" as const, staleDependencyIds: [], evaluatedAt: request.requestedAt }, conflict: { state: stored.result.conflicts.length ? "present" as const : "none" as const, conflictIds: stored.result.conflicts.map((item) => item.conflictId) }, lifecycle: "candidate" as const, mappingContentDigest: mappingDigest({ scope: stored.context.scope, candidate: candidateTechnicalPayload(normalizedMapping), verificationResultDigest: stored.result.resultDigest }), createdAt: request.requestedAt, createdBy: structuredClone(request.actorContext) };
      const record = recordDigest(base), stage1Reference = this.options.effectMode === "outbox" ? stage1ReferenceForRecord(record) : await this.options.stage1Projector.project(record, request.actorContext, request.idempotencyKey), invalidation = await this.invalidation(record, head?.revisionId ?? null, request.reason);
      return this.options.repository.commit({ scope, expectedRevision: request.expectedRevision, record, action: "persist_verification", actor: request.actorContext, reason: request.reason, idempotencyKey: request.idempotencyKey, invalidation, stage1Reference });
    });
    this.recordMutation("persist", request, committed); return committed;
  }
  private async transition(request: MappingMutationRequest, action: "approve" | "reject" | "revoke" | "mark_stale"): Promise<MappingCommitResult> {
    this.authorizeMutation(request, action === "approve" || action === "reject" || action === "revoke");
    if (!request.mappingId) throw new Error("MV_MAPPING_ID_REQUIRED");
    const scope: MappingRepositoryScope = { tenantId: request.tenantId, projectId: request.projectId, branchId: request.branchId, componentInstanceId: request.componentInstanceId, assemblyVariantId: request.assemblyVariantId };
    const committed = await this.options.repository.withLock(scope, 2_000, async () => {
      const replay = await this.replay(scope, request); if (replay) return { ...replay, idempotent: true };
      const head = await this.options.repository.getHead(scope); if (!head || head.mappingId !== request.mappingId) throw new Error("MV_MAPPING_NOT_FOUND");
      if (head.revision !== request.expectedRevision) throw new Error("MV_OPTIMISTIC_REVISION_CONFLICT");
      if (request.expectedMappingContentDigest && request.expectedMappingContentDigest !== head.mappingContentDigest) throw new Error("MV_MAPPING_CONTENT_DIGEST_MISMATCH");
      if (action === "approve") {
        if (!["verified", "verified_limited"].includes(head.verification.status)) throw new Error("MV_MAPPING_NOT_VERIFIED");
        const refreshed = await this.revalidate(head.verification.verificationId, request);
        if (refreshed.result.resultDigest !== head.verification.resultDigest) throw new Error("MV_VERIFICATION_STALE");
      }
      const revision = head.revision + 1, revisionId = `${head.mappingId}:r${revision}`, approval = action === "approve" ? { state: "approved" as const, mappingContentDigest: head.mappingContentDigest, decisionId: mappingId("mapping-approval", { mapping: head.mappingContentDigest, actor: request.actorContext.actorId, at: request.requestedAt }), actor: structuredClone(request.actorContext), decidedAt: request.requestedAt, reason: request.reason, policyVersion: head.verification.policyVersion } : action === "reject" ? { state: "rejected" as const, mappingContentDigest: head.mappingContentDigest, actor: structuredClone(request.actorContext), decidedAt: request.requestedAt, reason: request.reason, policyVersion: head.verification.policyVersion } : action === "revoke" ? { ...head.approval, state: "revoked" as const, actor: structuredClone(request.actorContext), decidedAt: request.requestedAt, reason: request.reason } : head.approval;
      const base = { ...head, revisionId, revision, predecessorRevisionId: head.revisionId, approval, freshness: action === "mark_stale" ? { state: "stale" as const, staleDependencyIds: ["mapping-dependency"], evaluatedAt: request.requestedAt } : head.freshness, lifecycle: action === "approve" ? "active" as const : action === "reject" ? "rejected" as const : action === "revoke" ? "revoked" as const : head.lifecycle, verificationState: action === "revoke" ? "revoked" as const : action === "mark_stale" ? "stale" as const : head.verificationState, createdAt: request.requestedAt, createdBy: structuredClone(request.actorContext), recordDigest: "" };
      const { recordDigest: _recordDigest, ...raw } = base; void _recordDigest; const record = recordDigest(raw), stage1Reference = this.options.effectMode === "outbox" ? stage1ReferenceForRecord(record) : await this.options.stage1Projector.project(record, request.actorContext, request.idempotencyKey), invalidation = await this.invalidation(record, head.revisionId, request.reason);
      return this.options.repository.commit({ scope, expectedRevision: request.expectedRevision, record, action, actor: request.actorContext, reason: request.reason, idempotencyKey: request.idempotencyKey, invalidation, stage1Reference });
    });
    this.recordMutation(action === "approve" ? "approve" : action === "revoke" ? "revoke" : "persist", request, committed); return committed;
  }
  approve(request: MappingMutationRequest): Promise<MappingCommitResult> { return this.transition(request, "approve"); }
  reject(request: MappingMutationRequest): Promise<MappingCommitResult> { return this.transition(request, "reject"); }
  revoke(request: MappingMutationRequest): Promise<MappingCommitResult> { return this.transition(request, "revoke"); }
  markStale(request: MappingMutationRequest): Promise<MappingCommitResult> { return this.transition(request, "mark_stale"); }
  async convergence(scope: MappingRepositoryScope, revisionId: string, actor: EngineeringActor, at: string) { this.authorizeRead(actor, at); if (!this.options.repository.convergence) throw new Error("MV_CONVERGENCE_UNAVAILABLE"); return this.options.repository.convergence(scope, revisionId); }
  async history(scope: MappingRepositoryScope, actor: EngineeringActor, at: string): Promise<MappingRecord[]> { this.authorizeRead(actor, at); return this.options.repository.history(scope); }
}
