import type { FootprintInstance, PcbBoard, PcbNet, ResolvedPinPadMapping } from "../pcb/types";
import { boardDigest } from "./board";
import { pcbSyncDigest } from "./stable";
import type { PcbSyncIssue, PcbSyncOperation, PcbSyncPlan } from "./types";
import { pcbSyncIssue } from "./validation";

function materialization(plan: PcbSyncPlan, componentId: string) {
  const found = plan.materializations.find((item) => item.componentInstanceId === componentId);
  if (!found) throw new Error("PS_EXECUTOR_MATERIALIZATION_MISSING");
  return found;
}

function nextNetId(board: PcbBoard): number { return Math.max(0, ...board.nets.map((net) => net.id)) + 1; }
function netByStableId(board: PcbBoard, stableNetId: string): PcbNet | undefined { return board.nets.find((net) => net.stableId === stableNetId); }

function buildInstance(operation: PcbSyncOperation, plan: PcbSyncPlan, prior?: FootprintInstance): FootprintInstance {
  const component = operation.component;
  if (!component) throw new Error("PS_EXECUTOR_COMPONENT_PAYLOAD_MISSING");
  const asset = materialization(plan, component.componentInstanceId);
  const mappings: ResolvedPinPadMapping[] = asset.mapping.entries.map((entry) => ({ componentInstanceId: component.componentInstanceId, endpointKey: `${component.componentInstanceId}::${entry.symbolPinNumber}`, symbolPinNumber: entry.symbolPinNumber, padNumbers: [...entry.padNumbers], mappingKind: entry.mappingKind, provenance: "library-explicit" }));
  const mechanical = Object.fromEntries(asset.mapping.mechanicalPadNumbers.map((pad) => [pad, "mechanical" as const]));
  return {
    ...(prior ?? {}),
    id: component.componentInstanceId,
    ref: component.referenceDesignator,
    footprintId: component.footprintAssetVersionId,
    def: structuredClone(asset.footprintDef),
    at: { ...component.at },
    rotationDeg: component.rotationDeg,
    side: component.side,
    padNets: prior ? { ...prior.padNets } : {},
    pinPadMappings: mappings,
    footprintPadClassifications: mechanical,
    syncIdentity: { componentInstanceId: component.componentInstanceId, bindingRevisionId: component.bindingRevisionId, footprintAssetVersionId: component.footprintAssetVersionId, footprintContentDigest: component.footprintContentDigest, mappingCertificateId: component.mappingCertificateId, symbolAssetVersionId: component.symbolAssetVersionId, syncPlanId: plan.planId },
  };
}

export function executePcbSyncPlan(base: PcbBoard, plan: PcbSyncPlan): { board: PcbBoard; outcomes: Array<{ operationId: string; status: "applied" | "preserved" | "skipped" }> } {
  if (plan.lifecycle !== "applicable" && plan.lifecycle !== "applying") throw new Error("PS_PLAN_NOT_APPLICABLE");
  if (plan.blockedOperations.length) throw new Error("PS_PLAN_HAS_BLOCKED_OPERATIONS");
  const board = structuredClone(base), outcomes: Array<{ operationId: string; status: "applied" | "preserved" | "skipped" }> = [];
  for (const operation of [...plan.operations].sort((a, b) => a.orderingKey.localeCompare(b.orderingKey))) {
    switch (operation.kind) {
      case "create_board":
      case "mark_dnp_or_excluded":
      case "no_op":
        outcomes.push({ operationId: operation.operationId, status: operation.kind === "create_board" ? "applied" : "skipped" });
        break;
      case "add_net": {
        if (!operation.net) throw new Error("PS_EXECUTOR_NET_PAYLOAD_MISSING");
        if (!netByStableId(board, operation.net.stableNetId)) board.nets.push({ id: nextNetId(board), name: operation.net.displayName, stableId: operation.net.stableNetId, endpointKeys: [...operation.net.endpointKeys] });
        outcomes.push({ operationId: operation.operationId, status: "applied" });
        break;
      }
      case "preserve_net":
        outcomes.push({ operationId: operation.operationId, status: "preserved" });
        break;
      case "rename_net_identity_preserving":
      case "update_unrouted_net_membership": {
        if (!operation.net) throw new Error("PS_EXECUTOR_NET_PAYLOAD_MISSING");
        const net = netByStableId(board, operation.net.stableNetId);
        if (!net) throw new Error("PS_EXECUTOR_NET_MISSING");
        net.name = operation.net.displayName;
        net.endpointKeys = [...operation.net.endpointKeys];
        outcomes.push({ operationId: operation.operationId, status: "applied" });
        break;
      }
      case "remove_unrouted_net": {
        const net = netByStableId(board, operation.targetStableId);
        if (net && (board.tracks.some((item) => item.netId === net.id) || board.vias.some((item) => item.netId === net.id) || board.zones.some((item) => item.netId === net.id))) throw new Error("PS_EXECUTOR_PROTECTED_NET_REMOVAL");
        if (net) board.nets = board.nets.filter((item) => item !== net);
        outcomes.push({ operationId: operation.operationId, status: net ? "applied" : "skipped" });
        break;
      }
      case "add_component_instance": {
        if (board.footprints.some((item) => item.id === operation.targetStableId || item.syncIdentity?.componentInstanceId === operation.targetStableId)) throw new Error("PS_EXECUTOR_COMPONENT_ALREADY_EXISTS");
        board.footprints.push(buildInstance(operation, plan));
        outcomes.push({ operationId: operation.operationId, status: "applied" });
        break;
      }
      case "preserve_component_instance": {
        const current = board.footprints.find((item) => item.id === operation.targetStableId || item.syncIdentity?.componentInstanceId === operation.targetStableId);
        if (!current) throw new Error("PS_EXECUTOR_COMPONENT_MISSING");
        outcomes.push({ operationId: operation.operationId, status: "preserved" });
        break;
      }
      case "update_component_metadata":
      case "update_reference_designator":
      case "update_value_display":
      case "replace_unrouted_footprint": {
        const current = board.footprints.find((item) => item.id === operation.targetStableId || item.syncIdentity?.componentInstanceId === operation.targetStableId);
        if (!current) throw new Error("PS_EXECUTOR_COMPONENT_MISSING");
        if (operation.kind === "replace_unrouted_footprint" && (current.locked || board.tracks.some((item) => Object.values(current.padNets).includes(item.netId)) || board.vias.some((item) => Object.values(current.padNets).includes(item.netId)) || board.zones.some((item) => Object.values(current.padNets).includes(item.netId)))) throw new Error("PS_EXECUTOR_ROUTED_FOOTPRINT_REPLACEMENT");
        board.footprints[board.footprints.indexOf(current)] = buildInstance(operation, plan, current);
        outcomes.push({ operationId: operation.operationId, status: "applied" });
        break;
      }
      case "remove_unrouted_component": {
        const current = board.footprints.find((item) => item.id === operation.targetStableId || item.syncIdentity?.componentInstanceId === operation.targetStableId);
        if (!current) { outcomes.push({ operationId: operation.operationId, status: "skipped" }); break; }
        const netIds = new Set(Object.values(current.padNets).filter((id) => id !== 0));
        if (current.locked || board.tracks.some((item) => netIds.has(item.netId)) || board.vias.some((item) => netIds.has(item.netId)) || board.zones.some((item) => netIds.has(item.netId))) throw new Error("PS_EXECUTOR_PROTECTED_COMPONENT_REMOVAL");
        board.footprints = board.footprints.filter((item) => item !== current);
        outcomes.push({ operationId: operation.operationId, status: "applied" });
        break;
      }
      case "assign_pad_to_net": {
        if (!operation.padAssignment) throw new Error("PS_EXECUTOR_PAD_ASSIGNMENT_MISSING");
        const instance = board.footprints.find((item) => item.id === operation.padAssignment!.componentInstanceId || item.syncIdentity?.componentInstanceId === operation.padAssignment!.componentInstanceId);
        const net = netByStableId(board, operation.padAssignment.stableNetId);
        if (!instance || !net) throw new Error("PS_EXECUTOR_PAD_ASSIGNMENT_TARGET_MISSING");
        for (const pad of operation.padAssignment.padNumbers) {
          const current = instance.padNets[pad];
          if (current && current !== net.id) throw new Error("PS_EXECUTOR_PAD_NET_CONFLICT");
          instance.padNets[pad] = net.id;
        }
        outcomes.push({ operationId: operation.operationId, status: "applied" });
        break;
      }
      default: throw new Error("PS_EXECUTOR_OPERATION_UNSUPPORTED");
    }
  }
  board.nets.sort((a, b) => a.id - b.id);
  board.footprints.sort((a, b) => a.id.localeCompare(b.id));
  return { board, outcomes };
}

export function validateStagedBoard(staged: PcbBoard, original: PcbBoard | null, plan: PcbSyncPlan): PcbSyncIssue[] {
  const issues: PcbSyncIssue[] = [];
  if ((staged as { formatVersion?: number }).formatVersion !== 1) issues.push(pcbSyncIssue({ code: "PS_STAGED_BOARD_FORMAT_INVALID", scope: "board", message: "Staged board format is unsupported." }));
  const componentIds = staged.footprints.map((item) => item.syncIdentity?.componentInstanceId ?? item.id).sort();
  if (JSON.stringify(componentIds) !== JSON.stringify(plan.expectedOutput.componentIds)) issues.push(pcbSyncIssue({ code: "PS_STAGED_COMPONENT_SET_MISMATCH", scope: "board", message: "Staged component set differs from the plan." }));
  const stableNetIds = staged.nets.filter((item) => item.id !== 0).map((item) => item.stableId).filter((id): id is string => Boolean(id)).sort();
  if (JSON.stringify(stableNetIds) !== JSON.stringify(plan.expectedOutput.stableNetIds)) issues.push(pcbSyncIssue({ code: "PS_STAGED_NET_SET_MISMATCH", scope: "net", message: "Staged stable net set differs from the plan." }));
  if (new Set(componentIds).size !== componentIds.length) issues.push(pcbSyncIssue({ code: "PS_STAGED_COMPONENT_IDENTITY_DUPLICATE", scope: "component", message: "Staged board contains duplicate stable component identities." }));
  if (new Set(stableNetIds).size !== stableNetIds.length) issues.push(pcbSyncIssue({ code: "PS_STAGED_NET_IDENTITY_DUPLICATE", scope: "net", message: "Staged board contains duplicate stable net identities." }));
  for (const operation of plan.operations.filter((item) => item.component)) {
    const expected = operation.component!, actual = staged.footprints.find((item) => item.syncIdentity?.componentInstanceId === expected.componentInstanceId);
    if (!actual || actual.syncIdentity?.footprintAssetVersionId !== expected.footprintAssetVersionId || actual.syncIdentity.footprintContentDigest !== expected.footprintContentDigest || actual.syncIdentity.mappingCertificateId !== expected.mappingCertificateId || actual.syncIdentity.bindingRevisionId !== expected.bindingRevisionId) issues.push(pcbSyncIssue({ code: "PS_STAGED_ASSET_IDENTITY_MISMATCH", scope: "asset", message: "Staged footprint identity does not match the exact plan.", stableIds: [expected.componentInstanceId] }));
  }
  for (const operation of plan.operations.filter((item) => item.padAssignment)) {
    const expected = operation.padAssignment!, actual = staged.footprints.find((item) => item.syncIdentity?.componentInstanceId === expected.componentInstanceId), net = netByStableId(staged, expected.stableNetId);
    if (!actual || !net || expected.padNumbers.some((pad) => actual.padNets[pad] !== net.id)) issues.push(pcbSyncIssue({ code: "PS_STAGED_PAD_NET_MISMATCH", scope: "mapping", message: "Staged pad-to-net assignment differs from the verified plan.", stableIds: [expected.componentInstanceId, expected.stableNetId] }));
  }
  if (original) {
    for (const key of ["tracks", "vias", "zones", "texts", "silkItems", "routingKeepouts", "routingHistory", "stackup", "stackupConfig", "outline", "constraintState", "netClassing"] as const) if (pcbSyncDigest(original[key]) !== pcbSyncDigest(staged[key])) issues.push(pcbSyncIssue({ code: "PS_STAGED_UNRELATED_STATE_CHANGED", scope: "board", message: `Staged synchronization unexpectedly changed preserved board state: ${key}.` }));
  }
  try { boardDigest(staged); } catch { issues.push(pcbSyncIssue({ code: "PS_STAGED_SERIALIZATION_FAILED", scope: "board", message: "Staged board could not be canonically serialized." })); }
  return issues.sort((a, b) => a.code.localeCompare(b.code) || a.stableIds.join("\0").localeCompare(b.stableIds.join("\0")));
}
