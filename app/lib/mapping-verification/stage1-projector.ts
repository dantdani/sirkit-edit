import { reviseBindingSet } from "../physical-binding/domain";
import type { PhysicalBindingAggregateState, PhysicalBindingRepository } from "../physical-binding/repository";
import { physicalBindingDigest, physicalBindingId, withBindingDigests, withoutBindingDigests } from "../physical-binding/stable";
import { PHYSICAL_BINDING_AUDIT_SCHEMA_VERSION, type ComponentPhysicalBinding, type PhysicalBindingAuditEvent, type PinPadMappingReference } from "../physical-binding/types";
import type { EngineeringActor } from "../engineering/types";
import { inspectAssemblyVariantScope } from "../footprint-resolver/variant-scope";
import type { MappingRecord, Stage1MappingProjector } from "./types";

function accepted(record: MappingRecord): boolean { return record.approval.state === "approved" && record.freshness.state === "current" && record.conflict.state === "none" && record.lifecycle === "active" && (record.verification.status === "verified" || record.verification.status === "verified_limited") && record.verification.tier !== "limited_direct_pair"; }

export function stage1ReferenceForRecord(record: MappingRecord): PinPadMappingReference {
  const verified = accepted(record);
  return { state: verified ? "verified" : record.freshness.state === "stale" ? "stale" : record.lifecycle === "revoked" ? "failed" : "pending", mappingCertificateId: record.revisionId, symbolAssetVersionId: record.candidate.symbolIdentity.versionId, footprintAssetVersionId: record.candidate.footprintIdentity.versionId, footprintContentDigest: record.candidate.footprintIdentity.contentDigest, verifierVersion: record.verification.verifierVersion, ...(record.verification.tier ? { verificationTier: record.verification.tier } : {}), mappingRevisionId: record.revisionId, mappingContentDigest: record.mappingContentDigest, mappingDependencyDigest: record.verification.dependencySnapshot.dependencyDigest, verificationResultDigest: record.verification.resultDigest, mappingApprovalState: record.approval.state, mappingFreshnessState: record.freshness.state, mappingConflictState: record.conflict.state, mappingLifecycleState: record.lifecycle, ...(record.approval.decisionId ? { approvalDecisionId: record.approval.decisionId } : {}), ...(verified && record.approval.decidedAt ? { verifiedAt: record.approval.decidedAt } : {}), evidenceRefs: [...record.candidate.evidenceRefs], reasonCodes: verified ? [] : [record.approval.state !== "approved" ? "MV_MAPPING_APPROVAL_REQUIRED" : record.freshness.state !== "current" ? "MV_MAPPING_STALE" : record.lifecycle === "revoked" ? "MV_MAPPING_REVOKED" : record.verification.tier === "limited_direct_pair" ? "MV_LIMITED_TIER_NOT_LAYOUT_ACCEPTED" : "MV_MAPPING_NOT_ACCEPTED"] };
}

function successorBinding(current: ComponentPhysicalBinding, record: MappingRecord, reference: PinPadMappingReference, actor: EngineeringActor): ComponentPhysicalBinding {
  if (current.footprint?.assetVersionId !== record.candidate.footprintIdentity.versionId || current.footprint.contentDigest !== record.candidate.footprintIdentity.contentDigest || current.dependencies.symbolAssetVersionId !== record.candidate.symbolIdentity.versionId || current.package?.packageRevisionId !== record.candidate.packageIdentity.packageRevisionId) throw new Error("MV_STAGE1_BINDING_DEPENDENCY_MISMATCH");
  const raw = withoutBindingDigests(current);
  raw.revision = current.revision + 1;
  raw.predecessorRevisionId = current.revisionId;
  raw.revisionId = `${current.bindingId}:r${raw.revision}`;
  raw.pinPadMapping = structuredClone(reference);
  raw.dependencies = { ...raw.dependencies, symbolAssetVersionId: record.candidate.symbolIdentity.versionId, packageRevisionId: record.candidate.packageIdentity.packageRevisionId, footprintAssetVersionId: record.candidate.footprintIdentity.versionId, footprintContentDigest: record.candidate.footprintIdentity.contentDigest, mappingCertificateId: record.revisionId, mappingVerifierVersion: record.verification.verifierVersion };
  raw.evidenceRefs = [...new Set([...raw.evidenceRefs, ...record.candidate.evidenceRefs])].sort();
  raw.freshness = { state: record.freshness.state, evaluatedAt: record.createdAt, reasonCodes: record.freshness.state === "current" ? [] : ["MV_MAPPING_DEPENDENCY_STALE"], staleDependencyIds: [...record.freshness.staleDependencyIds] };
  raw.conflict = { state: record.conflict.state, conflictIds: [...record.conflict.conflictIds], reasonCodes: record.conflict.state === "none" ? [] : ["MV_MAPPING_CONFLICT"] };
  raw.approval = { state: "unreviewed" };
  raw.technicalValidation = { state: "pending", evidenceRefs: [...record.candidate.evidenceRefs], reasonCodes: ["MV_MAPPING_APPROVAL_REQUIRED"] };
  raw.createdAt = record.createdAt;
  raw.createdBy = structuredClone(actor);
  return withBindingDigests(raw);
}

export class PhysicalBindingMappingProjector implements Stage1MappingProjector {
  constructor(private readonly repository: PhysicalBindingRepository) {}
  async project(record: MappingRecord, actor: EngineeringActor, idempotencyKey: string): Promise<PinPadMappingReference> {
    const state = await this.repository.load(record.scope.bindingSetId);
    if (!state) throw new Error("MV_STAGE1_BINDING_SET_NOT_FOUND");
    const variant = inspectAssemblyVariantScope(state.set.scope.assemblyVariantIds, record.scope.assemblyVariantId);
    if (variant.kind === "invalid") throw new Error("MV_STAGE1_BINDING_VARIANT_SCOPE_INVALID");
    if (state.set.scope.tenantId !== record.scope.tenantId || state.set.scope.projectId !== record.scope.projectId || state.set.scope.branchId !== record.scope.branchId || state.set.scope.componentInstanceId !== record.scope.componentInstanceId || !variant.applies) throw new Error("MV_STAGE1_BINDING_SCOPE_MISMATCH");
    const current = state.bindings.find((item) => item.revisionId === state.set.effectiveSelectedRevisionId);
    if (!current) throw new Error("MV_STAGE1_SELECTED_BINDING_MISSING");
    const reference = stage1ReferenceForRecord(record);
    if (current.pinPadMapping.mappingRevisionId === record.revisionId) {
      if (current.pinPadMapping.mappingContentDigest !== record.mappingContentDigest) throw new Error("MV_STAGE1_PROJECTION_COLLISION");
      return reference;
    }
    const projectedRevision = current.pinPadMapping.mappingRevisionId?.match(/:r(\d+)$/)?.[1];
    if (projectedRevision && Number(projectedRevision) > record.revision) throw new Error("MV_STAGE1_PROJECTION_STALE");
    if (current.revisionId !== record.scope.bindingRevisionId && current.pinPadMapping.mappingRevisionId !== record.predecessorRevisionId) throw new Error("MV_STAGE1_BINDING_REVISION_STALE");
    const successor = successorBinding(current, record, reference, actor);
    const set = reviseBindingSet(state.set, { replaceRevisionId: current.revisionId, addRevisionId: successor.revisionId, selectedRevisionId: successor.revisionId, at: record.createdAt });
    const requestDigest = physicalBindingDigest({ setId: set.setId, fromRevisionId: current.revisionId, mappingRevisionId: record.revisionId, mappingContentDigest: record.mappingContentDigest });
    const auditBase = { schemaVersion: PHYSICAL_BINDING_AUDIT_SCHEMA_VERSION, eventId: physicalBindingId("physical-binding-audit", { mappingRevision: record.revisionId, bindingRevision: successor.revisionId, idempotencyKey }), tenantId: current.scope.tenantId, projectId: current.scope.projectId, branchId: current.scope.branchId, componentInstanceId: current.scope.componentInstanceId, bindingId: current.bindingId, fromRevisionId: current.revisionId, toRevisionId: successor.revisionId, action: "mapping_update" as const, actor: structuredClone(actor), reason: `Project Stage 4 mapping ${record.revisionId}.`, idempotencyKey, occurredAt: record.createdAt, aggregateSetId: set.setId, requestDigest };
    const audit: PhysicalBindingAuditEvent = { ...auditBase, eventDigest: physicalBindingDigest(auditBase) };
    const next: PhysicalBindingAggregateState = { ...state, set, bindings: [...state.bindings.filter((item) => item.revisionId !== current.revisionId), successor].sort((a, b) => a.revisionId.localeCompare(b.revisionId)), auditEvents: [...state.auditEvents, audit] };
    await this.repository.commit({ setId: set.setId, expectedRevision: state.set.revision, idempotencyKey: `mapping-project:${idempotencyKey}`, requestDigest, state: next });
    return reference;
  }
}

export class InMemoryStage1MappingProjector implements Stage1MappingProjector {
  readonly references: PinPadMappingReference[] = [];
  async project(record: MappingRecord): Promise<PinPadMappingReference> { const reference = stage1ReferenceForRecord(record); this.references.push(structuredClone(reference)); return reference; }
}
