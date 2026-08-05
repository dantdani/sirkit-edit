import { schematicEndpointKey } from "../pcb/integrity";
import type { FootprintInstance, PcbBoard, PcbNet } from "../pcb/types";
import type { FootprintResolutionResult } from "../footprint-resolver/types";
import { pcbSyncDigest } from "./stable";
import type { ComponentTransferAssessment, NetPadMember, NetTransferAssessment, PcbSyncFootprintMaterialization, PcbSyncIssue, PcbSyncNetStatus, PcbSyncPreflightContext, PcbSyncRiskClass, PcbSyncSchematicComponent, PcbSyncSchematicNet } from "./types";
import { pcbSyncIssue } from "./validation";

function blockedStatus(result: FootprintResolutionResult): ComponentTransferAssessment["status"] {
  const codes = result.blockers.map((item) => item.code);
  if (codes.some((code) => code.includes("MAPPING"))) return "blocked_mapping";
  if (result.status === "blocked_stale") return "blocked_stale";
  if (result.status === "blocked_conflict" || result.status === "unresolved_ambiguous") return "blocked_conflict";
  if (result.status === "blocked_unavailable") return "blocked_asset_unavailable";
  if (result.status === "blocked_unsupported") return "blocked_unsupported";
  return "blocked_unresolved_footprint";
}

function issueForResolution(component: PcbSyncSchematicComponent, result?: FootprintResolutionResult): PcbSyncIssue {
  const status = result ? blockedStatus(result) : "blocked_unresolved_footprint";
  return pcbSyncIssue({
    code: status === "blocked_mapping" ? "PS_COMPONENT_MAPPING_BLOCKED" : status === "blocked_stale" ? "PS_COMPONENT_BINDING_STALE" : status === "blocked_conflict" ? "PS_COMPONENT_RESOLUTION_CONFLICT" : status === "blocked_asset_unavailable" ? "PS_COMPONENT_ASSET_UNAVAILABLE" : status === "blocked_unsupported" ? "PS_COMPONENT_UNSUPPORTED" : "PS_COMPONENT_UNRESOLVED",
    scope: status === "blocked_mapping" ? "mapping" : status === "blocked_asset_unavailable" ? "asset" : "component",
    message: `${component.referenceDesignator} is not resolved and layout-ready for this assembly variant.`,
    stableIds: [component.componentInstanceId],
    displayRefs: [component.referenceDesignator],
    remediation: status === "blocked_mapping" ? "verify_pin_pad_mapping" : "resolve_footprint_binding",
    causedBy: result?.blockers.map((item) => item.code) ?? ["PS_RESOLVER_RESULT_MISSING"],
  });
}

function riskyBoard(boardClass: PcbSyncPreflightContext["boardAssessment"]["boardClass"]): boolean {
  return ["routed", "zoned", "constrained", "locked_unrouted", "unsupported"].includes(boardClass);
}

function validateMaterialization(component: PcbSyncSchematicComponent, result: FootprintResolutionResult, materialization: PcbSyncFootprintMaterialization, context: PcbSyncPreflightContext): PcbSyncIssue[] {
  const issues: PcbSyncIssue[] = [];
  const resolved = result.resolvedBinding!;
  const mapping = materialization.mapping;
  const mismatch = materialization.bindingRevisionId !== resolved.bindingRevisionId || materialization.assetVersionId !== resolved.footprintAsset.assetVersionId || materialization.assetContentDigest !== resolved.footprintAsset.contentDigest || mapping.mappingCertificateId !== resolved.pinPadMapping.mappingCertificateId || mapping.symbolAssetVersionId !== resolved.pinPadMapping.symbolAssetVersionId || mapping.footprintAssetVersionId !== resolved.pinPadMapping.footprintAssetVersionId || mapping.footprintContentDigest !== resolved.pinPadMapping.footprintContentDigest;
  if (mismatch) issues.push(pcbSyncIssue({ code: "PS_MATERIALIZATION_REVISION_MISMATCH", scope: "asset", message: `${component.referenceDesignator} materialized asset or mapping does not match the resolver result.`, stableIds: [component.componentInstanceId], displayRefs: [component.referenceDesignator], remediation: "refresh_assets", retryability: "after_refresh" }));
  if (!context.policy.acceptedMappingVerifierVersions.includes(mapping.verifierVersion)) issues.push(pcbSyncIssue({ code: "PS_MAPPING_VERIFIER_UNSUPPORTED", scope: "mapping", message: `${component.referenceDesignator} mapping verifier is not accepted by the sync policy.`, stableIds: [component.componentInstanceId], displayRefs: [component.referenceDesignator], remediation: "verify_pin_pad_mapping" }));
  const padNumbers = new Set(materialization.footprintDef.pads.map((pad) => pad.number));
  const mappingByPin = new Map(mapping.entries.map((entry) => [entry.symbolPinNumber, entry]));
  for (const pin of component.pins) {
    const entry = mappingByPin.get(pin.number);
    if (!entry) {
      issues.push(pcbSyncIssue({ code: "PS_MAPPING_PIN_MISSING", scope: "mapping", message: `${component.referenceDesignator}.${pin.number} has no entry in the verified mapping artifact.`, stableIds: [component.componentInstanceId, pin.pinInstanceId], displayRefs: [component.referenceDesignator], remediation: "verify_pin_pad_mapping" }));
      continue;
    }
    const allowsNoPad = pin.disposition === "no_connect" || pin.disposition === "schematic_only" || entry.mappingKind === "intentional-no-connect" || entry.mappingKind === "schematic-only";
    if (!allowsNoPad && entry.padNumbers.length === 0) issues.push(pcbSyncIssue({ code: "PS_MAPPING_PAD_MISSING", scope: "mapping", message: `${component.referenceDesignator}.${pin.number} has no verified physical pad.`, stableIds: [component.componentInstanceId, pin.pinInstanceId], displayRefs: [component.referenceDesignator], remediation: "verify_pin_pad_mapping" }));
    for (const pad of entry.padNumbers) if (!padNumbers.has(pad)) issues.push(pcbSyncIssue({ code: "PS_MAPPING_NONEXISTENT_PAD", scope: "mapping", message: `${component.referenceDesignator}.${pin.number} maps to a pad absent from the immutable footprint.`, stableIds: [component.componentInstanceId, pin.pinInstanceId], displayRefs: [component.referenceDesignator], remediation: "verify_pin_pad_mapping" }));
  }
  return issues.sort((a, b) => a.code.localeCompare(b.code) || a.stableIds.join("\0").localeCompare(b.stableIds.join("\0")));
}

export function assessComponents(context: PcbSyncPreflightContext): ComponentTransferAssessment[] {
  const board = context.boardRecord?.board ?? context.snapshot.newBoardTemplate;
  const footprints = board?.footprints ?? [];
  const materializationByComponent = new Map(context.materializations.map((item) => [item.componentInstanceId, item]));
  return [...context.snapshot.components].sort((a, b) => a.componentInstanceId.localeCompare(b.componentInstanceId)).map((component): ComponentTransferAssessment => {
    const matches = footprints.filter((footprint) => footprint.id === component.componentInstanceId || footprint.syncIdentity?.componentInstanceId === component.componentInstanceId);
    const resolution = context.resolutionByComponent[component.componentInstanceId];
    const common = { componentInstanceId: component.componentInstanceId, referenceDesignator: component.referenceDesignator, hierarchyPath: [...component.hierarchyPath], componentRevision: component.componentRevision, applicability: component.applicability };
    if (component.applicability === "nonphysical") return { ...common, resolutionStatus: "not_requested", mappingStatus: "not_applicable", proposedOperation: "no_op", risk: "none", status: "nonphysical", blockers: [], warnings: [], resolverBlockerCodes: [], evidenceRefs: [] };
    if (component.applicability === "not_applicable") {
      const blocked = matches.length && riskyBoard(context.boardAssessment.boardClass);
      const blockers = blocked ? [pcbSyncIssue({ code: "PS_ROUTED_COMPONENT_REMOVAL_REQUIRES_STAGE8", scope: "board", message: `${component.referenceDesignator} is not populated in this variant but its existing board instance cannot be removed safely before Stage 8.`, stableIds: [component.componentInstanceId], displayRefs: [component.referenceDesignator], remediation: "stage8_copper_protection" })] : [];
      return { ...common, resolutionStatus: resolution?.status ?? "not_requested", mappingStatus: "not_applicable", pcbInstanceId: matches[0]?.id, proposedOperation: matches.length ? blocked ? "blocked" : "remove_unrouted_component" : "mark_dnp_or_excluded", risk: matches.length ? blocked ? "copper_affecting" : "unrouted_structural" : "none", status: blocked ? "blocked_routed_footprint_change" : "not_applicable", blockers, warnings: [], resolverBlockerCodes: resolution?.blockers.map((item) => item.code) ?? [], evidenceRefs: [] };
    }
    if (component.applicability === "unknown") {
      const issue = pcbSyncIssue({ code: "PS_COMPONENT_APPLICABILITY_UNKNOWN", scope: "component", message: `${component.referenceDesignator} population state is unknown for the requested variant.`, stableIds: [component.componentInstanceId], displayRefs: [component.referenceDesignator], remediation: "variant_population" });
      return { ...common, resolutionStatus: resolution?.status ?? "not_requested", mappingStatus: "missing", proposedOperation: "blocked", risk: "none", status: "blocked_unresolved_footprint", blockers: [issue], warnings: [], resolverBlockerCodes: resolution?.blockers.map((item) => item.code) ?? [], evidenceRefs: [] };
    }
    if (!resolution || resolution.status !== "resolved" || !resolution.resolvedBinding) {
      const issue = issueForResolution(component, resolution);
      const status = resolution ? blockedStatus(resolution) : "blocked_unresolved_footprint";
      return { ...common, resolutionStatus: resolution?.status ?? "missing_result", resolutionDecisionDigest: resolution?.decisionDigest, mappingStatus: status === "blocked_mapping" ? "invalid" : status === "blocked_stale" ? "stale" : "missing", proposedOperation: "blocked", risk: "none", status, blockers: [issue], warnings: [], resolverBlockerCodes: resolution?.blockers.map((item) => item.code) ?? ["PS_RESOLVER_RESULT_MISSING"], evidenceRefs: [] };
    }
    const resolved = resolution.resolvedBinding;
    const materialization = materializationByComponent.get(component.componentInstanceId);
    if (!materialization) {
      const issue = pcbSyncIssue({ code: "PS_COMPONENT_ASSET_MATERIALIZATION_MISSING", scope: "asset", message: `${component.referenceDesignator} immutable footprint/mapping content is unavailable.`, stableIds: [component.componentInstanceId], displayRefs: [component.referenceDesignator], remediation: "refresh_assets", retryability: "after_refresh" });
      return { ...common, resolutionStatus: resolution.status, resolutionDecisionDigest: resolution.decisionDigest, bindingRevisionId: resolved.bindingRevisionId, footprintAssetVersionId: resolved.footprintAsset.assetVersionId, footprintContentDigest: resolved.footprintAsset.contentDigest, packageRevisionId: resolved.packageIdentity.packageRevisionId, exactPartId: resolved.exactPartIdentity?.exactPartId, mappingCertificateId: resolved.pinPadMapping.mappingCertificateId, mappingStatus: "missing", proposedOperation: "blocked", risk: "none", status: "blocked_asset_unavailable", blockers: [issue], warnings: [], resolverBlockerCodes: [], evidenceRefs: resolved.approvalEvidenceRefs };
    }
    const materializationIssues = validateMaterialization(component, resolution, materialization, context);
    if (materializationIssues.length) return { ...common, resolutionStatus: resolution.status, resolutionDecisionDigest: resolution.decisionDigest, bindingRevisionId: resolved.bindingRevisionId, footprintAssetVersionId: resolved.footprintAsset.assetVersionId, footprintContentDigest: resolved.footprintAsset.contentDigest, packageRevisionId: resolved.packageIdentity.packageRevisionId, exactPartId: resolved.exactPartIdentity?.exactPartId, mappingCertificateId: resolved.pinPadMapping.mappingCertificateId, mappingStatus: "invalid", proposedOperation: "blocked", risk: "none", status: "blocked_mapping", blockers: materializationIssues, warnings: [], resolverBlockerCodes: [], evidenceRefs: resolved.approvalEvidenceRefs };
    if (matches.length > 1) {
      const issue = pcbSyncIssue({ code: "PS_COMPONENT_IDENTITY_DUPLICATE", scope: "component", message: `${component.referenceDesignator} maps to multiple PCB instances.`, stableIds: [component.componentInstanceId], displayRefs: [component.referenceDesignator], remediation: "identity_reconciliation" });
      return { ...common, resolutionStatus: resolution.status, resolutionDecisionDigest: resolution.decisionDigest, bindingRevisionId: resolved.bindingRevisionId, footprintAssetVersionId: resolved.footprintAsset.assetVersionId, footprintContentDigest: resolved.footprintAsset.contentDigest, packageRevisionId: resolved.packageIdentity.packageRevisionId, exactPartId: resolved.exactPartIdentity?.exactPartId, mappingCertificateId: resolved.pinPadMapping.mappingCertificateId, mappingStatus: "verified", proposedOperation: "blocked", risk: "none", status: "blocked_duplicate_identity", blockers: [issue], warnings: [], resolverBlockerCodes: [], evidenceRefs: resolved.approvalEvidenceRefs };
    }
    const current = matches[0];
    let status: ComponentTransferAssessment["status"] = "ready_no_change", proposedOperation: ComponentTransferAssessment["proposedOperation"] = "preserve_component_instance", risk: PcbSyncRiskClass = "none";
    const blockers: PcbSyncIssue[] = [];
    if (!current) {
      if (context.request.target.kind === "existing_board" && riskyBoard(context.boardAssessment.boardClass)) {
        status = "blocked_routed_net_change"; proposedOperation = "blocked"; risk = context.boardAssessment.risk;
        blockers.push(pcbSyncIssue({ code: "PS_STRUCTURAL_ADD_REQUIRES_UNROUTED_BOARD", scope: "board", message: `${component.referenceDesignator} cannot be added automatically to this routed, locked, zoned, constrained, or unsupported board.`, stableIds: [component.componentInstanceId], displayRefs: [component.referenceDesignator], remediation: "stage8_copper_protection" }));
      } else { status = "ready_add"; proposedOperation = "add_component_instance"; risk = "unrouted_structural"; }
    } else {
      const identity = current.syncIdentity;
      const assetSame = identity?.footprintAssetVersionId === resolved.footprintAsset.assetVersionId && identity?.footprintContentDigest === resolved.footprintAsset.contentDigest && identity?.mappingCertificateId === resolved.pinPadMapping.mappingCertificateId;
      if (!assetSame) {
        if (riskyBoard(context.boardAssessment.boardClass) || current.locked || current.placementConstraints?.fixedPosition) {
          status = "blocked_routed_footprint_change"; proposedOperation = "blocked"; risk = context.boardAssessment.boardClass === "locked_unrouted" ? "placement_affecting" : "copper_affecting";
          blockers.push(pcbSyncIssue({ code: "PS_FOOTPRINT_REPLACEMENT_REQUIRES_STAGE8", scope: "board", message: `${component.referenceDesignator} requires an immutable footprint or mapping replacement on a protected board.`, stableIds: [component.componentInstanceId], displayRefs: [component.referenceDesignator], remediation: "stage8_copper_protection" }));
        } else { status = "ready_metadata_update"; proposedOperation = "replace_unrouted_footprint"; risk = "unrouted_structural"; }
      } else if (current.ref !== component.referenceDesignator) { status = "ready_metadata_update"; proposedOperation = "update_reference_designator"; risk = "metadata_only"; }
    }
    return { ...common, resolutionStatus: resolution.status, resolutionDecisionDigest: resolution.decisionDigest, bindingRevisionId: resolved.bindingRevisionId, footprintAssetVersionId: resolved.footprintAsset.assetVersionId, footprintContentDigest: resolved.footprintAsset.contentDigest, packageRevisionId: resolved.packageIdentity.packageRevisionId, exactPartId: resolved.exactPartIdentity?.exactPartId, mappingCertificateId: resolved.pinPadMapping.mappingCertificateId, mappingStatus: "verified", pcbInstanceId: current?.id, currentFootprintAssetVersionId: current?.syncIdentity?.footprintAssetVersionId, currentFootprintContentDigest: current?.syncIdentity?.footprintContentDigest, proposedOperation, risk, status, blockers, warnings: [], resolverBlockerCodes: [], evidenceRefs: resolved.approvalEvidenceRefs };
  });
}

function boardNetName(net: PcbSyncSchematicNet): string { return net.canonicalScope.length ? `/${net.canonicalScope.join("/")}/${net.displayName}` : net.displayName; }
function netHasProtectedState(board: PcbBoard | undefined, netId: number): boolean {
  if (!board) return false;
  return board.tracks.some((item) => item.netId === netId) || board.vias.some((item) => item.netId === netId) || board.zones.some((item) => item.netId === netId) || Boolean(board.constraintState || board.netClassing);
}

export function assessNets(context: PcbSyncPreflightContext, components: ComponentTransferAssessment[]): NetTransferAssessment[] {
  const board = context.boardRecord?.board ?? context.snapshot.newBoardTemplate;
  const materializationByComponent = new Map(context.materializations.map((item) => [item.componentInstanceId, item]));
  const componentById = new Map(context.snapshot.components.map((item) => [item.componentInstanceId, item]));
  const assessmentById = new Map(components.map((item) => [item.componentInstanceId, item]));
  const boardByStableId = new Map<string, PcbNet[]>();
  for (const net of board?.nets ?? []) if (net.stableId) boardByStableId.set(net.stableId, [...(boardByStableId.get(net.stableId) ?? []), net]);
  const canonicalNames = new Map<string, string[]>();
  for (const net of context.snapshot.nets) {
    const key = boardNetName(net).normalize("NFC").trim().toLocaleLowerCase("en-US");
    canonicalNames.set(key, [...(canonicalNames.get(key) ?? []), net.stableNetId]);
  }
  return [...context.snapshot.nets].sort((a, b) => a.stableNetId.localeCompare(b.stableNetId)).map((net): NetTransferAssessment => {
    const blockers: PcbSyncIssue[] = [];
    const members: NetPadMember[] = [];
    const seen = new Set<string>();
    for (const member of [...net.members].sort((a, b) => a.componentInstanceId.localeCompare(b.componentInstanceId) || a.pinInstanceId.localeCompare(b.pinInstanceId))) {
      const memberKey = `${member.componentInstanceId}\0${member.pinInstanceId}`;
      if (seen.has(memberKey)) blockers.push(pcbSyncIssue({ code: "PS_NET_MEMBER_DUPLICATE", scope: "net", message: "Canonical net graph contains a duplicate pin member.", stableIds: [net.stableNetId, member.componentInstanceId, member.pinInstanceId], remediation: "schematic_connectivity" }));
      seen.add(memberKey);
      const component = componentById.get(member.componentInstanceId), assessment = assessmentById.get(member.componentInstanceId), materialization = materializationByComponent.get(member.componentInstanceId);
      if (!component || !assessment || assessment.mappingStatus !== "verified" || !materialization) {
        blockers.push(pcbSyncIssue({ code: "PS_NET_MEMBER_MAPPING_MISSING", scope: "mapping", message: "A net member has no accepted current pin-pad mapping.", stableIds: [net.stableNetId, member.componentInstanceId, member.pinInstanceId], remediation: "verify_pin_pad_mapping" }));
        continue;
      }
      const mapping = materialization.mapping.entries.find((entry) => entry.pinInstanceId === member.pinInstanceId || entry.symbolPinNumber === member.pinNumber);
      if (!mapping || !mapping.padNumbers.length || mapping.mappingKind === "intentional-no-connect" || mapping.mappingKind === "schematic-only") {
        blockers.push(pcbSyncIssue({ code: "PS_NET_MEMBER_UNMAPPED_PIN", scope: "mapping", message: "A connected schematic pin does not map to an electrical footprint pad.", stableIds: [net.stableNetId, member.componentInstanceId, member.pinInstanceId], remediation: "verify_pin_pad_mapping" }));
        continue;
      }
      members.push({ ...member, padNumbers: [...mapping.padNumbers].sort() });
    }
    const key = boardNetName(net).normalize("NFC").trim().toLocaleLowerCase("en-US");
    if ((canonicalNames.get(key)?.length ?? 0) > 1) blockers.push(pcbSyncIssue({ code: "PS_NET_LABEL_COLLISION", scope: "net", message: "Distinct stable nets collapse to the same canonical board label.", stableIds: canonicalNames.get(key), remediation: "schematic_connectivity" }));
    const existingMatches = boardByStableId.get(net.stableNetId) ?? [];
    if (existingMatches.length > 1) blockers.push(pcbSyncIssue({ code: "PS_BOARD_NET_IDENTITY_DUPLICATE", scope: "net", message: "Multiple board nets claim one stable schematic net identity.", stableIds: [net.stableNetId], remediation: "identity_reconciliation" }));
    const existing = existingMatches[0];
    const endpointKeys = [...net.members.map((member) => schematicEndpointKey(member.componentInstanceId, member.pinNumber))].sort();
    const membershipChanged = Boolean(existing) && JSON.stringify([...(existing?.endpointKeys ?? [])].sort()) !== JSON.stringify(endpointKeys);
    const protectedChange = Boolean(existing && membershipChanged && netHasProtectedState(board, existing.id));
    if (protectedChange) blockers.push(pcbSyncIssue({ code: "PS_ROUTED_NET_CHANGE_REQUIRES_STAGE8", scope: "board", message: "Net membership change affects routed copper, zones, or constraints and requires Stage 8.", stableIds: [net.stableNetId], remediation: "stage8_copper_protection" }));
    let status: PcbSyncNetStatus, proposedOperation: NetTransferAssessment["proposedOperation"];
    if (blockers.some((item) => item.code.includes("LABEL_COLLISION"))) { status = "blocked_label_collision"; proposedOperation = "blocked"; }
    else if (blockers.some((item) => item.code.includes("UNMAPPED") || item.code.includes("MAPPING"))) { status = "blocked_missing_mapping"; proposedOperation = "blocked"; }
    else if (protectedChange) { status = "blocked_routed_change"; proposedOperation = "blocked"; }
    else if (blockers.length) { status = "blocked_stable_identity_mismatch"; proposedOperation = "blocked"; }
    else if (!existing) { status = "ready_new_net"; proposedOperation = "add_net"; }
    else if (membershipChanged) { status = "ready_unrouted_membership_update"; proposedOperation = "update_unrouted_net_membership"; }
    else if (existing.name !== boardNetName(net)) { status = "ready_safe_rename"; proposedOperation = "rename_net_identity_preserving"; }
    else { status = "ready_unchanged"; proposedOperation = "preserve_net"; }
    return { stableNetId: net.stableNetId, canonicalScope: [...net.canonicalScope], displayName: boardNetName(net), aliases: [...net.aliases].sort(), classification: net.classification, members, ...(existing ? { existingBoardNetId: existing.id, existingBoardNetName: existing.name } : {}), proposedOperation, connectivityDigest: pcbSyncDigest({ stableNetId: net.stableNetId, members: endpointKeys, classification: net.classification }), routedCopperAffected: protectedChange, status, blockers: blockers.sort((a, b) => a.code.localeCompare(b.code)), warnings: [] };
  });
}

export function extraBoardFootprints(context: PcbSyncPreflightContext): FootprintInstance[] {
  const board = context.boardRecord?.board;
  if (!board) return [];
  const ids = new Set(context.snapshot.components.map((item) => item.componentInstanceId));
  return board.footprints.filter((item) => !ids.has(item.syncIdentity?.componentInstanceId ?? item.id)).sort((a, b) => a.id.localeCompare(b.id));
}
