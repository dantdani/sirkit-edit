import { createBindingSet, reviseBindingSet } from "./domain";
import { evaluatePhysicalReadiness } from "./readiness";
import { physicalBindingDigest, physicalBindingId } from "./stable";
import { applyPhysicalBindingTransition, normalizeDecisionEvidenceRefs, physicalBindingTransitionRequestDigest } from "./transitions";
import { detectSelectedVariantConflicts } from "./conflicts";
import type {
  ComponentPhysicalBinding,
  ComponentPhysicalBindingSet,
  PhysicalBindingAuditEvent,
  PhysicalBindingMigrationRecord,
  PhysicalBindingTransitionRequest,
  PhysicalReadinessAssessment,
} from "./types";
import type { LegacyMigrationResult } from "./legacy";
import { compareCodePoints } from "@/app/lib/stable-compare";

export interface PhysicalBindingAggregateState {
  set: ComponentPhysicalBindingSet;
  bindings: ComponentPhysicalBinding[];
  auditEvents: PhysicalBindingAuditEvent[];
  migrationRecords: PhysicalBindingMigrationRecord[];
  assessments: PhysicalReadinessAssessment[];
}

export interface PhysicalBindingRepository {
  load(setId: string): Promise<PhysicalBindingAggregateState | null>;
  findForComponentVariant(scope: Omit<ComponentPhysicalBinding["scope"], "assemblyVariantIds"> & { assemblyVariantId: string }): Promise<PhysicalBindingAggregateState[]>;
  listSelectedPeers(scope: ComponentPhysicalBinding["scope"]): Promise<ComponentPhysicalBinding[]>;
  commit(input: PhysicalBindingCommitRequest): Promise<{ state: PhysicalBindingAggregateState; duplicate: boolean }>;
}

export interface PhysicalBindingCommitRequest {
  setId: string;
  expectedRevision: number;
  idempotencyKey: string;
  /** Canonical logical request identity. Optional only for pre-B01 callers. */
  requestDigest?: string;
  state: PhysicalBindingAggregateState;
}

export function assertPhysicalBindingReplay(event: Pick<PhysicalBindingAuditEvent, "aggregateSetId" | "requestDigest">, input: { setId: string; requestDigest?: string }): void {
  if (event.aggregateSetId === undefined && event.requestDigest === undefined && input.requestDigest === undefined) return;
  if (event.aggregateSetId !== input.setId) throw new Error("PB_IDEMPOTENCY_SCOPE_CONFLICT");
  if (!input.requestDigest || event.requestDigest !== input.requestDigest) throw new Error("PB_IDEMPOTENCY_REQUEST_CONFLICT");
}

const clone = <T>(value: T): T => structuredClone(value);

export class InMemoryPhysicalBindingRepository implements PhysicalBindingRepository {
  private readonly states = new Map<string, PhysicalBindingAggregateState>();
  private readonly commits = new Map<string, { setId: string; requestDigest: string; state: PhysicalBindingAggregateState }>();
  async load(setId: string): Promise<PhysicalBindingAggregateState | null> { const value = this.states.get(setId); return value ? clone(value) : null; }
  async findForComponentVariant(scope: Omit<ComponentPhysicalBinding["scope"], "assemblyVariantIds"> & { assemblyVariantId: string }): Promise<PhysicalBindingAggregateState[]> {
    return [...this.states.values()].filter((state) =>
      state.set.scope.tenantId === scope.tenantId && state.set.scope.projectId === scope.projectId && state.set.scope.branchId === scope.branchId
      && state.set.scope.boardInstanceId === scope.boardInstanceId && state.set.scope.componentInstanceId === scope.componentInstanceId
      && state.set.scope.hierarchyPath.join("\0") === scope.hierarchyPath.join("\0")
      && (state.set.scope.assemblyVariantIds.length === 0 || state.set.scope.assemblyVariantIds.includes(scope.assemblyVariantId)),
    ).map(clone).sort((a, b) => compareCodePoints(a.set.setId, b.set.setId));
  }
  async listSelectedPeers(scope: ComponentPhysicalBinding["scope"]): Promise<ComponentPhysicalBinding[]> {
    const peers: ComponentPhysicalBinding[] = [];
    for (const state of this.states.values()) {
      if (!state.set.effectiveSelectedRevisionId) continue;
      if (state.set.scope.tenantId !== scope.tenantId || state.set.scope.projectId !== scope.projectId || state.set.scope.branchId !== scope.branchId || state.set.scope.boardInstanceId !== scope.boardInstanceId || state.set.scope.componentInstanceId !== scope.componentInstanceId) continue;
      const selected = state.bindings.find((binding) => binding.revisionId === state.set.effectiveSelectedRevisionId);
      if (selected) peers.push(clone(selected));
    }
    return peers.sort((a, b) => compareCodePoints(a.revisionId, b.revisionId));
  }
  async commit(input: PhysicalBindingCommitRequest): Promise<{ state: PhysicalBindingAggregateState; duplicate: boolean }> {
    const requestDigest = input.requestDigest ?? physicalBindingDigest({ setId: input.setId, idempotencyKey: input.idempotencyKey, state: input.state });
    const scope = input.state.set.scope;
    const replayKey = `${scope.tenantId}\0${scope.projectId}\0${scope.branchId}\0${input.idempotencyKey}`;
    const duplicate = this.commits.get(replayKey);
    if (duplicate) {
      if (duplicate.setId !== input.setId) throw new Error("PB_IDEMPOTENCY_SCOPE_CONFLICT");
      if (duplicate.requestDigest !== requestDigest) throw new Error("PB_IDEMPOTENCY_REQUEST_CONFLICT");
      return { state: clone(duplicate.state), duplicate: true };
    }
    const current = this.states.get(input.setId);
    const actual = current?.set.revision ?? 0;
    if (actual !== input.expectedRevision) throw new Error(`PB_OPTIMISTIC_LOCK_CONFLICT:${actual}`);
    const state = clone(input.state);
    this.states.set(input.setId, state);
    this.commits.set(replayKey, { setId: input.setId, requestDigest, state });
    return { state: clone(state), duplicate: false };
  }
}

function auditEvent(input: { setId: string; requestDigest: string; binding: ComponentPhysicalBinding; successor: ComponentPhysicalBinding; request: PhysicalBindingTransitionRequest }): PhysicalBindingAuditEvent {
  const decisionEvidenceRefs = normalizeDecisionEvidenceRefs(input.binding, input.request);
  const base = {
    schemaVersion: "sirkit.physical-binding-audit.v1" as const,
    eventId: physicalBindingId("physical-binding-audit", { revision: input.successor.revisionId, action: input.request.action, idempotency: input.request.idempotencyKey }),
    tenantId: input.binding.scope.tenantId,
    projectId: input.binding.scope.projectId,
    branchId: input.binding.scope.branchId,
    componentInstanceId: input.binding.scope.componentInstanceId,
    bindingId: input.binding.bindingId,
    fromRevisionId: input.binding.revisionId,
    toRevisionId: input.successor.revisionId,
    action: input.request.action,
    actor: structuredClone(input.request.actor),
    reason: input.request.reason,
    idempotencyKey: input.request.idempotencyKey,
    occurredAt: input.request.at,
    aggregateSetId: input.setId,
    requestDigest: input.requestDigest,
    ...(decisionEvidenceRefs.length ? { decisionEvidenceRefs } : {}),
  };
  return { ...base, eventDigest: physicalBindingDigest(base) };
}

export class PhysicalBindingService {
  constructor(private readonly repository: PhysicalBindingRepository) {}

  async createCandidate(binding: ComponentPhysicalBinding, idempotencyKey: string): Promise<PhysicalBindingAggregateState> {
    const initialSet = createBindingSet(binding);
    const requestDigest = physicalBindingDigest({ operation: "create_candidate", setId: initialSet.setId, bindingRecordDigest: binding.recordDigest, idempotencyKey });
    const prior = await this.repository.load(initialSet.setId);
    const sameCandidate = prior?.bindings.find((item) => item.bindingId === binding.bindingId);
    if (sameCandidate) {
      if (sameCandidate.recordDigest !== binding.recordDigest) throw new Error("PB_CANDIDATE_IDENTITY_COLLISION");
      return prior!;
    }
    if (prior && prior.bindings.length >= 256) throw new Error("PB_CANDIDATE_LIMIT");
    const set = prior ? reviseBindingSet(prior.set, { addRevisionId: binding.revisionId, at: binding.createdAt }) : initialSet;
    const baseAudit = {
      schemaVersion: "sirkit.physical-binding-audit.v1" as const,
      eventId: physicalBindingId("physical-binding-audit", { binding: binding.revisionId, idempotencyKey }),
      tenantId: binding.scope.tenantId, projectId: binding.scope.projectId, branchId: binding.scope.branchId, componentInstanceId: binding.scope.componentInstanceId,
      bindingId: binding.bindingId, fromRevisionId: binding.revisionId, toRevisionId: binding.revisionId, action: "create_candidate" as const,
      actor: structuredClone(binding.createdBy), reason: "Create immutable physical binding candidate.", idempotencyKey, occurredAt: binding.createdAt,
      aggregateSetId: set.setId, requestDigest,
    };
    const event: PhysicalBindingAuditEvent = { ...baseAudit, eventDigest: physicalBindingDigest(baseAudit) };
    const state: PhysicalBindingAggregateState = { set, bindings: [...(prior?.bindings ?? []), binding].sort((a, b) => compareCodePoints(a.revisionId, b.revisionId)), auditEvents: [...(prior?.auditEvents ?? []), event], migrationRecords: prior?.migrationRecords ?? [], assessments: prior?.assessments ?? [] };
    return (await this.repository.commit({ setId: set.setId, expectedRevision: prior?.set.revision ?? 0, idempotencyKey, requestDigest, state })).state;
  }

  /**
   * `known` lets a caller chaining transitions reuse the state returned by the
   * previous commit instead of re-reading it. Purely an I/O optimization: the
   * repository's optimistic-lock check inside the commit transaction still
   * rejects any stale state, exactly as it does for a racy load().
   */
  async transition(setId: string, request: PhysicalBindingTransitionRequest, known?: PhysicalBindingAggregateState): Promise<PhysicalBindingAggregateState> {
    const current = known && known.set.setId === setId ? known : await this.repository.load(setId);
    if (!current) throw new Error("PB_BINDING_SET_NOT_FOUND");
    const requestDigest = physicalBindingTransitionRequestDigest(request);
    const replay = current.auditEvents.find((event) => event.idempotencyKey === request.idempotencyKey);
    if (replay) {
      assertPhysicalBindingReplay(replay, { setId, requestDigest });
      return current;
    }
    if (request.expectedSetRevision !== current.set.revision) throw new Error(`PB_OPTIMISTIC_LOCK_CONFLICT:${current.set.revision}`);
    const binding = current.bindings.find((item) => item.revisionId === request.bindingRevisionId);
    if (!binding) throw new Error("PB_BINDING_REVISION_NOT_FOUND");
    if (request.action === "select" && current.set.effectiveSelectedRevisionId && current.set.effectiveSelectedRevisionId !== binding.revisionId) throw new Error("PB_ACTIVE_SELECTION_CONFLICT");
    if (request.action === "select") {
      const conflict = detectSelectedVariantConflicts(binding, await this.repository.listSelectedPeers(binding.scope));
      if (conflict.state === "present") throw new Error("PB_OVERLAPPING_VARIANT_SELECTION");
    }
    const successor = applyPhysicalBindingTransition(binding, request);
    const selectedRevisionId = request.action === "select"
      ? successor.revisionId
      : request.action === "supersede" || request.action === "withdraw" || request.action === "orphan"
        ? null
        : current.set.effectiveSelectedRevisionId === binding.revisionId
          ? successor.revisionId
          : undefined;
    const set = reviseBindingSet(current.set, { replaceRevisionId: binding.revisionId, addRevisionId: successor.revisionId, selectedRevisionId, at: request.at });
    const bindings = current.bindings.filter((item) => item.revisionId !== binding.revisionId);
    bindings.push(successor);
    const state: PhysicalBindingAggregateState = { ...current, set, bindings: bindings.sort((a, b) => compareCodePoints(a.revisionId, b.revisionId)), auditEvents: [...current.auditEvents, auditEvent({ setId, requestDigest, binding, successor, request })] };
    return (await this.repository.commit({ setId, expectedRevision: current.set.revision, idempotencyKey: request.idempotencyKey, requestDigest, state })).state;
  }

  async assess(setId: string, input: { bindingRevisionId?: string; assessedAt: string; brokenEvidenceRefs?: string[] }): Promise<PhysicalReadinessAssessment> {
    const current = await this.repository.load(setId);
    if (!current) throw new Error("PB_BINDING_SET_NOT_FOUND");
    const revisionId = input.bindingRevisionId ?? current.set.effectiveSelectedRevisionId ?? current.set.candidateRevisionIds[0];
    const binding = current.bindings.find((item) => item.revisionId === revisionId);
    if (!binding) throw new Error("PB_BINDING_REVISION_NOT_FOUND");
    return evaluatePhysicalReadiness(binding, { assessedAt: input.assessedAt, effectiveSelectedRevisionId: current.set.effectiveSelectedRevisionId, brokenEvidenceRefs: input.brokenEvidenceRefs });
  }

  async assessAndPersist(setId: string, input: { bindingRevisionId?: string; assessedAt: string; brokenEvidenceRefs?: string[]; idempotencyKey: string }): Promise<PhysicalBindingAggregateState> {
    const current = await this.repository.load(setId);
    if (!current) throw new Error("PB_BINDING_SET_NOT_FOUND");
    const assessment = await this.assess(setId, input);
    const existing = current.assessments.find((item) => item.assessmentDigest === assessment.assessmentDigest);
    if (existing) return current;
    const state = { ...current, assessments: [...current.assessments, assessment] };
    const requestDigest = physicalBindingDigest({ operation: "assess", setId, input });
    return (await this.repository.commit({ setId, expectedRevision: current.set.revision, idempotencyKey: input.idempotencyKey, requestDigest, state })).state;
  }

  async migrate(result: LegacyMigrationResult): Promise<PhysicalBindingAggregateState> {
    if (result.record.dryRun) throw new Error("PB_DRY_RUN_CANNOT_PERSIST");
    const setId = physicalBindingId("physical-binding-set", result.candidate.scope);
    const requestDigest = physicalBindingDigest({ operation: "legacy_migrate", setId, migrationKey: result.migrationKey, recordDigest: result.record.recordDigest, candidateRecordDigest: result.candidate.recordDigest });
    const prior = await this.repository.load(setId);
    if (prior?.migrationRecords.some((item) => item.migrationKey === result.migrationKey)) return prior;
    const set = prior ? reviseBindingSet(prior.set, { addRevisionId: result.candidate.revisionId, at: result.record.createdAt }) : createBindingSet(result.candidate);
    const auditBase = {
      schemaVersion: "sirkit.physical-binding-audit.v1" as const,
      eventId: physicalBindingId("physical-binding-audit", { migration: result.migrationKey }),
      tenantId: result.candidate.scope.tenantId, projectId: result.candidate.scope.projectId, branchId: result.candidate.scope.branchId, componentInstanceId: result.candidate.scope.componentInstanceId,
      bindingId: result.candidate.bindingId, fromRevisionId: result.candidate.revisionId, toRevisionId: result.candidate.revisionId, action: "legacy_migrate" as const,
      actor: structuredClone(result.candidate.createdBy), reason: "Preserve legacy footprint-bearing fields as an unapproved shadow candidate.", idempotencyKey: result.migrationKey, occurredAt: result.record.createdAt,
      aggregateSetId: setId, requestDigest,
    };
    const audit: PhysicalBindingAuditEvent = { ...auditBase, eventDigest: physicalBindingDigest(auditBase) };
    const state: PhysicalBindingAggregateState = {
      set,
      bindings: [...(prior?.bindings ?? []), result.candidate].sort((a, b) => compareCodePoints(a.revisionId, b.revisionId)),
      auditEvents: [...(prior?.auditEvents ?? []), audit],
      migrationRecords: [...(prior?.migrationRecords ?? []), result.record],
      assessments: prior?.assessments ?? [],
    };
    return (await this.repository.commit({ setId, expectedRevision: prior?.set.revision ?? 0, idempotencyKey: result.migrationKey, requestDigest, state })).state;
  }
}
