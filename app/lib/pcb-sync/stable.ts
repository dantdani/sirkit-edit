import { physicalBindingDigest, physicalBindingId } from "../physical-binding/stable";
import { pcbRevisionPayload } from "../pcb/revision";
import type { PcbSyncAuthoritativeSnapshot, PcbSyncIssue, PcbSyncPlan, PcbSyncSnapshotIdentity } from "./types";
import { compareCodePoints } from "@/app/lib/stable-compare";

export const pcbSyncDigest = physicalBindingDigest;
export const pcbSyncId = physicalBindingId;

function canonicalIssue(issue: PcbSyncIssue): PcbSyncIssue {
  return { ...issue, stableIds: [...issue.stableIds].sort(), displayRefs: [...issue.displayRefs].sort(), evidenceRefs: [...issue.evidenceRefs].sort(), causedBy: [...issue.causedBy].sort() };
}

/** The graph portion of a snapshot: what the publication source digest covers. */
export interface PcbSyncPublicationGraphParts {
  components: PcbSyncAuthoritativeSnapshot["components"];
  nets: PcbSyncAuthoritativeSnapshot["nets"];
  prerequisiteIssues: PcbSyncIssue[];
}

/**
 * Canonical ordering for the published graph — the single definition shared by
 * the publisher and by whoever builds the graph client-side. Both sides MUST
 * digest this exact form, or a byte-identical graph produces two different
 * source digests and publication fails with PS_SOURCE_DIGEST_MISMATCH.
 */
export function canonicalPublicationGraph(input: PcbSyncPublicationGraphParts): PcbSyncPublicationGraphParts {
  return {
    components: [...input.components].map((component) => ({ ...component, hierarchyPath: [...component.hierarchyPath], pins: [...component.pins].sort((a, b) => compareCodePoints(a.pinInstanceId, b.pinInstanceId)) })).sort((a, b) => compareCodePoints(a.componentInstanceId, b.componentInstanceId)),
    nets: [...input.nets].map((net) => ({ ...net, canonicalScope: [...net.canonicalScope], aliases: [...net.aliases].sort(), members: [...net.members].sort((a, b) => compareCodePoints(a.componentInstanceId, b.componentInstanceId) || compareCodePoints(a.pinInstanceId, b.pinInstanceId)), explicitNoConnectPinIds: [...net.explicitNoConnectPinIds].sort(), constraintRefs: [...net.constraintRefs].sort() })).sort((a, b) => compareCodePoints(a.stableNetId, b.stableNetId)),
    prerequisiteIssues: [...input.prerequisiteIssues].map(canonicalIssue).sort((a, b) => compareCodePoints(a.code, b.code) || compareCodePoints(a.stableIds.join("\0"), b.stableIds.join("\0"))),
  };
}

/** Source digest over the canonical published graph. */
export function publicationSourceDigest(input: PcbSyncPublicationGraphParts): string {
  return pcbSyncDigest(canonicalPublicationGraph(input));
}

export function canonicalAuthoritativeSnapshot(snapshot: Omit<PcbSyncAuthoritativeSnapshot, "snapshotDigest">): Omit<PcbSyncAuthoritativeSnapshot, "snapshotDigest"> {
  const graph = canonicalPublicationGraph(snapshot);
  return {
    ...snapshot,
    components: graph.components,
    nets: graph.nets,
    prerequisiteIssues: graph.prerequisiteIssues,
    newBoardTemplate: snapshot.newBoardTemplate ? structuredClone(snapshot.newBoardTemplate) : undefined,
  };
}

export function authoritativeSnapshotDigest(snapshot: Omit<PcbSyncAuthoritativeSnapshot, "snapshotDigest">): string {
  const canonical = canonicalAuthoritativeSnapshot(snapshot);
  return pcbSyncDigest({ ...canonical, newBoardTemplate: canonical.newBoardTemplate ? pcbRevisionPayload(canonical.newBoardTemplate) : undefined });
}

export function snapshotTechnicalPayload(snapshot: Omit<PcbSyncSnapshotIdentity, "targetBoardRevision" | "targetBoardDigest"> & { targetBoardRevision: string | null; targetBoardDigest: string | null }): unknown {
  return snapshot;
}

export function planTechnicalPayload(plan: Omit<PcbSyncPlan, "planId" | "planDigest" | "lifecycle" | "createdBy" | "createdAt" | "expiresAt">): unknown {
  return {
    planSchemaVersion: plan.planSchemaVersion,
    scope: plan.scope,
    snapshot: plan.snapshot,
    operations: [...plan.operations].sort((a, b) => compareCodePoints(a.orderingKey, b.orderingKey) || compareCodePoints(a.operationId, b.operationId)).map(({ summary: _summary, ...operation }) => { void _summary; return operation; }),
    blockedOperations: [...plan.blockedOperations].sort((a, b) => compareCodePoints(a.blockedOperationId, b.blockedOperationId)),
    prerequisites: [...plan.prerequisites].sort((a, b) => compareCodePoints(a.code, b.code) || compareCodePoints(a.stableIds.join("\0"), b.stableIds.join("\0"))),
    resolverEvidence: [...plan.resolverEvidence].sort((a, b) => compareCodePoints(a.componentInstanceId, b.componentInstanceId)),
    materializations: [...plan.materializations].map((item) => ({
      componentInstanceId: item.componentInstanceId,
      bindingRevisionId: item.bindingRevisionId,
      assetVersionId: item.assetVersionId,
      assetContentDigest: item.assetContentDigest,
      assetSemanticDigest: item.assetSemanticDigest,
      footprintFullName: item.footprintFullName,
      mappingCertificateId: item.mapping.mappingCertificateId,
      mappingArtifactDigest: item.mapping.artifactDigest,
      materializationDigest: item.materializationDigest,
    })).sort((a, b) => compareCodePoints(a.componentInstanceId, b.componentInstanceId)),
    expectedOutput: plan.expectedOutput,
    policyVersions: plan.policyVersions,
  };
}

export function assertPlanDigest(plan: PcbSyncPlan): void {
  const { planId: _planId, planDigest: _planDigest, lifecycle: _lifecycle, createdBy: _createdBy, createdAt: _createdAt, expiresAt: _expiresAt, ...technical } = plan;
  void _planId; void _planDigest; void _lifecycle; void _createdBy; void _createdAt; void _expiresAt;
  if (pcbSyncDigest(planTechnicalPayload(technical)) !== plan.planDigest) throw new Error("PS_PLAN_DIGEST_MISMATCH");
  if (pcbSyncId("pcb-sync-plan", plan.planDigest) !== plan.planId) throw new Error("PS_PLAN_ID_MISMATCH");
}
