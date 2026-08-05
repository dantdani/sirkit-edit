import { mmToNm } from "../pcb/units";
import type { ComponentTransferAssessment, NetTransferAssessment, PcbSyncBlockedOperation, PcbSyncGateResult, PcbSyncOperation, PcbSyncOperationKind, PcbSyncPlan, PcbSyncPreflightContext, PcbSyncRiskClass, PcbSyncSnapshotIdentity } from "./types";
import { PCB_SYNC_BOARD_ADAPTER_VERSION, PCB_SYNC_ENGINE_VERSION, PCB_SYNC_PLAN_VERSION } from "./types";
import { extraBoardFootprints } from "./reconciliation";
import { pcbSyncDigest, pcbSyncId, planTechnicalPayload } from "./stable";

const operationRank: Record<PcbSyncOperationKind, number> = {
  create_board: 0, add_net: 10, preserve_net: 11, rename_net_identity_preserving: 12, update_unrouted_net_membership: 13, remove_unrouted_net: 14,
  add_component_instance: 20, preserve_component_instance: 21, update_component_metadata: 22, update_reference_designator: 23, update_value_display: 24,
  replace_unrouted_footprint: 25, assign_pad_to_net: 30, remove_unrouted_component: 40, mark_dnp_or_excluded: 41, no_op: 99,
};

function operation(input: Omit<PcbSyncOperation, "operationId" | "orderingKey">): PcbSyncOperation {
  const orderingKey = `${String(operationRank[input.kind]).padStart(3, "0")}\0${input.targetStableId}\0${input.kind}`;
  const base = { ...input, orderingKey };
  const { summary: _summary, ...technical } = base;
  void _summary;
  return { ...base, operationId: pcbSyncId("pcb-sync-operation", technical) };
}

function blocked(targetStableId: string, intendedKind: string, risk: PcbSyncRiskClass, reasonCodes: string[], summary: string): PcbSyncBlockedOperation {
  const base = { intendedKind, targetStableId, risk, reasonCodes: [...new Set(reasonCodes)].sort(), summary };
  return { ...base, blockedOperationId: pcbSyncId("pcb-sync-blocked-operation", base) };
}

function componentPosition(index: number): { x: number; y: number } {
  const column = index % 10, row = Math.floor(index / 10);
  return { x: -mmToNm(50) + column * mmToNm(4), y: row * mmToNm(4) };
}

export function snapshotIdentity(context: PcbSyncPreflightContext): PcbSyncSnapshotIdentity {
  const snapshot = context.snapshot;
  return {
    snapshotDigest: snapshot.snapshotDigest,
    projectRevision: snapshot.projectRevision,
    designRevision: snapshot.designRevision,
    schematicRevision: snapshot.schematicRevision,
    schematicDigest: snapshot.schematicDigest,
    componentSetRevision: snapshot.componentSetRevision,
    netGraphRevision: snapshot.netGraphRevision,
    netGraphDigest: snapshot.netGraphDigest,
    assemblyVariantId: snapshot.assemblyVariantId,
    assemblyVariantRevision: snapshot.assemblyVariantRevision,
    librarySnapshotRevision: snapshot.librarySnapshotRevision,
    ...(snapshot.constraintsRevision ? { constraintsRevision: snapshot.constraintsRevision } : {}),
    targetBoardId: context.request.target.boardId,
    ...(context.request.target.kind === "new_board" ? { targetBoardName: context.request.target.boardName } : {}),
    targetBoardRevision: context.boardRecord?.revision ?? null,
    targetBoardDigest: context.boardRecord?.digest ?? null,
  };
}

export function buildSyncPlan(context: PcbSyncPreflightContext, components: ComponentTransferAssessment[], nets: NetTransferAssessment[], gates: PcbSyncGateResult[]): PcbSyncPlan {
  const operations: PcbSyncOperation[] = [], blockedOperations: PcbSyncBlockedOperation[] = [];
  const board = context.boardRecord?.board ?? context.snapshot.newBoardTemplate;
  const materializationByComponent = new Map(context.materializations.map((item) => [item.componentInstanceId, item]));
  const componentAssessmentById = new Map(components.map((item) => [item.componentInstanceId, item]));
  const schematicById = new Map(context.snapshot.components.map((item) => [item.componentInstanceId, item]));
  const boardFootprintById = new Map((board?.footprints ?? []).map((item) => [item.syncIdentity?.componentInstanceId ?? item.id, item]));
  if (context.request.target.kind === "new_board") operations.push(operation({ kind: "create_board", targetStableId: context.request.target.boardId, beforeDigest: null, afterDigest: pcbSyncDigest(context.snapshot.newBoardTemplate), sourceRefs: [context.snapshot.snapshotDigest], dependencies: [context.snapshot.projectRevision, context.snapshot.constraintsRevision ?? "none"], risk: "none", reversibility: "snapshot_restore", requiredRole: "pcb_editor", requiresConfirmation: true, validationGateCodes: ["PS_BOARD_TEMPLATE_READY"], summary: `Create board ${context.request.target.boardName} from validated project board data.` }));
  let newIndex = 0;
  for (const assessment of components) {
    const schematic = schematicById.get(assessment.componentInstanceId)!, materialization = materializationByComponent.get(assessment.componentInstanceId), current = boardFootprintById.get(assessment.componentInstanceId);
    if (assessment.blockers.length || assessment.proposedOperation === "blocked") {
      blockedOperations.push(blocked(assessment.componentInstanceId, assessment.proposedOperation, assessment.risk, assessment.blockers.map((item) => item.code), `${assessment.referenceDesignator} cannot be synchronized.`));
      continue;
    }
    if (assessment.proposedOperation === "mark_dnp_or_excluded") {
      operations.push(operation({ kind: "mark_dnp_or_excluded", targetStableId: assessment.componentInstanceId, beforeDigest: null, afterDigest: pcbSyncDigest({ applicability: "not_applicable" }), sourceRefs: [schematic.componentRevision], dependencies: [context.snapshot.assemblyVariantRevision], risk: "none", reversibility: "trivial", requiredRole: "pcb_editor", requiresConfirmation: true, validationGateCodes: ["PS_COMPONENT_NOT_APPLICABLE"], summary: `${assessment.referenceDesignator} remains excluded for this assembly variant.` }));
      continue;
    }
    if (assessment.proposedOperation === "remove_unrouted_component" && current) {
      operations.push(operation({ kind: "remove_unrouted_component", targetStableId: assessment.componentInstanceId, beforeDigest: pcbSyncDigest(current), afterDigest: null, sourceRefs: [schematic.componentRevision], dependencies: [context.snapshot.assemblyVariantRevision, context.boardRecord?.revision ?? "new"], risk: "unrouted_structural", reversibility: "snapshot_restore", requiredRole: "pcb_editor", requiresConfirmation: true, validationGateCodes: ["PS_COMPONENT_REMOVAL_UNROUTED"], summary: `Remove unpopulated ${assessment.referenceDesignator} from the unrouted board.` }));
      continue;
    }
    if (!materialization || !assessment.bindingRevisionId || !assessment.mappingCertificateId || !assessment.footprintAssetVersionId || !assessment.footprintContentDigest) continue;
    const at = current?.at ?? componentPosition(newIndex++);
    const componentPayload = { componentInstanceId: assessment.componentInstanceId, referenceDesignator: assessment.referenceDesignator, ...(schematic.value ? { value: schematic.value } : {}), footprintAssetVersionId: assessment.footprintAssetVersionId, footprintContentDigest: assessment.footprintContentDigest, bindingRevisionId: assessment.bindingRevisionId, mappingCertificateId: assessment.mappingCertificateId, symbolAssetVersionId: schematic.symbolAssetVersionId, at, rotationDeg: current?.rotationDeg ?? 0, side: current?.side ?? "top" as const };
    const kind = assessment.proposedOperation as PcbSyncOperationKind;
    operations.push(operation({ kind, targetStableId: assessment.componentInstanceId, beforeDigest: current ? pcbSyncDigest({ syncIdentity: current.syncIdentity, ref: current.ref, at: current.at, rotationDeg: current.rotationDeg, side: current.side }) : null, afterDigest: pcbSyncDigest(componentPayload), sourceRefs: [schematic.componentRevision, assessment.resolutionDecisionDigest!], dependencies: [materialization.materializationDigest, materialization.mapping.artifactDigest, context.snapshot.snapshotDigest], risk: assessment.risk, reversibility: assessment.risk === "metadata_only" ? "trivial" : "snapshot_restore", requiredRole: "pcb_editor", requiresConfirmation: true, validationGateCodes: ["PS_COMPONENT_RESOLVED", "PS_MAPPING_VERIFIED", "PS_ASSET_AVAILABLE"], summary: kind === "add_component_instance" ? `Add resolved ${assessment.referenceDesignator} to the board staging area.` : kind === "replace_unrouted_footprint" ? `Replace the unrouted footprint for ${assessment.referenceDesignator}.` : kind === "update_reference_designator" ? `Rename the existing stable PCB instance to ${assessment.referenceDesignator}.` : `Preserve ${assessment.referenceDesignator} with its exact immutable footprint.`, component: componentPayload }));
  }
  for (const assessment of nets) {
    if (assessment.blockers.length || assessment.proposedOperation === "blocked") {
      blockedOperations.push(blocked(assessment.stableNetId, assessment.proposedOperation, assessment.routedCopperAffected ? "copper_affecting" : "unrouted_structural", assessment.blockers.map((item) => item.code), `Net ${assessment.displayName} cannot be synchronized.`));
      continue;
    }
    const endpointKeys = assessment.members.map((member) => `${member.componentInstanceId}::${member.pinNumber}`).sort();
    const kind = assessment.proposedOperation;
    operations.push(operation({ kind, targetStableId: assessment.stableNetId, beforeDigest: assessment.existingBoardNetId === undefined ? null : pcbSyncDigest({ id: assessment.existingBoardNetId, name: assessment.existingBoardNetName }), afterDigest: pcbSyncDigest({ stableNetId: assessment.stableNetId, name: assessment.displayName, endpointKeys }), sourceRefs: [assessment.connectivityDigest], dependencies: [context.snapshot.netGraphRevision, context.snapshot.netGraphDigest], risk: kind === "preserve_net" ? "none" : kind === "rename_net_identity_preserving" ? "metadata_only" : "unrouted_structural", reversibility: kind === "preserve_net" ? "trivial" : "snapshot_restore", requiredRole: "pcb_editor", requiresConfirmation: true, validationGateCodes: ["PS_NET_GRAPH_VALID", "PS_NET_CHANGE_UNROUTED"], summary: kind === "add_net" ? `Add net ${assessment.displayName}.` : kind === "rename_net_identity_preserving" ? `Rename stable net to ${assessment.displayName}.` : kind === "update_unrouted_net_membership" ? `Update unrouted membership for ${assessment.displayName}.` : `Preserve net ${assessment.displayName}.`, net: { stableNetId: assessment.stableNetId, displayName: assessment.displayName, endpointKeys } }));
    for (const member of assessment.members) {
      const componentAssessment = componentAssessmentById.get(member.componentInstanceId), instance = boardFootprintById.get(member.componentInstanceId), existingNetId = assessment.existingBoardNetId;
      const componentChanges = componentAssessment?.proposedOperation === "add_component_instance" || componentAssessment?.proposedOperation === "replace_unrouted_footprint";
      const alreadyAssigned = instance && existingNetId !== undefined && member.padNumbers.every((pad) => instance.padNets[pad] === existingNetId);
      if (!componentChanges && assessment.status === "ready_unchanged" && alreadyAssigned) continue;
      operations.push(operation({ kind: "assign_pad_to_net", targetStableId: `${member.componentInstanceId}\0${assessment.stableNetId}\0${member.pinInstanceId}`, beforeDigest: alreadyAssigned ? pcbSyncDigest({ netId: existingNetId, padNumbers: member.padNumbers }) : null, afterDigest: pcbSyncDigest({ stableNetId: assessment.stableNetId, padNumbers: member.padNumbers }), sourceRefs: [assessment.connectivityDigest], dependencies: [materializationByComponent.get(member.componentInstanceId)?.mapping.artifactDigest ?? "missing"], risk: "unrouted_structural", reversibility: "snapshot_restore", requiredRole: "pcb_editor", requiresConfirmation: true, validationGateCodes: ["PS_MAPPING_VERIFIED", "PS_NET_GRAPH_VALID"], summary: `Assign verified pads for one member of ${assessment.displayName}.`, padAssignment: { componentInstanceId: member.componentInstanceId, stableNetId: assessment.stableNetId, padNumbers: [...member.padNumbers] } }));
    }
  }
  for (const extra of extraBoardFootprints(context)) {
    const protectedBoard = ["routed", "zoned", "constrained", "locked_unrouted"].includes(context.boardAssessment.boardClass) || extra.locked;
    if (protectedBoard) blockedOperations.push(blocked(extra.id, "remove_unrouted_component", "copper_affecting", ["PS_EXTRA_BOARD_COMPONENT_PROTECTED"], `Existing board-only component ${extra.ref} cannot be removed before Stage 8.`));
    else operations.push(operation({ kind: "remove_unrouted_component", targetStableId: extra.id, beforeDigest: pcbSyncDigest(extra), afterDigest: null, sourceRefs: [context.snapshot.componentSetRevision], dependencies: [context.boardRecord?.revision ?? "new"], risk: "unrouted_structural", reversibility: "snapshot_restore", requiredRole: "project_admin", requiresConfirmation: true, validationGateCodes: ["PS_BOARD_COMPONENT_NOT_IN_SCHEMATIC"], summary: `Remove board-only unrouted component ${extra.ref}.` }));
  }
  operations.sort((a, b) => a.orderingKey.localeCompare(b.orderingKey) || a.operationId.localeCompare(b.operationId));
  blockedOperations.sort((a, b) => a.blockedOperationId.localeCompare(b.blockedOperationId));
  if (operations.length > context.policy.maxOperations) blockedOperations.push(blocked(context.request.target.boardId, "operation_limit", "unsupported_unknown", ["PS_OPERATION_LIMIT_EXCEEDED"], "Synchronization operation count exceeds the policy limit."));
  const applicable = blockedOperations.length === 0 && gates.every((gate) => !gate.blocking || gate.status === "pass" || gate.status === "not_applicable");
  const expectedComponentIds = context.snapshot.components.filter((item) => item.applicability === "applicable").map((item) => item.componentInstanceId).sort();
  const expectedStableNetIds = context.snapshot.nets.map((item) => item.stableNetId).sort();
  const expectedOutput = { componentIds: expectedComponentIds, stableNetIds: expectedStableNetIds, boardStructuralDigest: pcbSyncDigest({ componentIds: expectedComponentIds, stableNetIds: expectedStableNetIds, operations: operations.map((item) => item.operationId) }) };
  const policyVersions = { syncPolicyId: context.policy.policyId, syncPolicyVersion: context.policy.version, resolutionPolicyId: context.request.resolutionPolicyId, resolutionPolicyVersion: context.request.resolutionPolicyVersion, resolverVersion: context.resolverBatch.results[0]?.resolverVersion ?? "sirkit.footprint-resolver/2.0.0", normalizationVersion: context.resolverBatch.results[0]?.normalizationVersion ?? "sirkit.footprint-resolution-normalization/1", boardAdapterVersion: PCB_SYNC_BOARD_ADAPTER_VERSION, engineVersion: PCB_SYNC_ENGINE_VERSION };
  const technical = { planSchemaVersion: PCB_SYNC_PLAN_VERSION, scope: { tenantId: context.request.tenantId, projectId: context.request.projectId, branchId: context.request.branchId, designId: context.request.designId, boardId: context.request.target.boardId }, snapshot: snapshotIdentity(context), operations, blockedOperations, prerequisites: gates, resolverEvidence: context.resolverBatch.results.map((result) => ({ componentInstanceId: result.inputSnapshot.componentId, decisionDigest: result.decisionDigest, dependencyDigest: result.inputSnapshot.dependencyDigest, ...(result.resolvedBinding ? { bindingRevisionId: result.resolvedBinding.bindingRevisionId } : {}) })).sort((a, b) => a.componentInstanceId.localeCompare(b.componentInstanceId)), materializations: context.materializations, expectedOutput, policyVersions };
  const planDigest = pcbSyncDigest(planTechnicalPayload(technical));
  const hasMaterialOperations = operations.some((item) => !["preserve_component_instance", "preserve_net", "mark_dnp_or_excluded", "no_op"].includes(item.kind));
  return { ...technical, planId: pcbSyncId("pcb-sync-plan", planDigest), planDigest, lifecycle: applicable && hasMaterialOperations && context.request.mode === "prepare_apply" ? "applicable" : "validated", createdBy: structuredClone(context.request.actorContext), createdAt: context.request.requestedAt, expiresAt: new Date(Date.parse(context.request.requestedAt) + context.policy.planTtlMs).toISOString() };
}
