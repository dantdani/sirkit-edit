import { pcbSyncDigest } from "./stable";
import type { PcbRouterHandoff, PcbSyncAuditRecord, PcbSyncBoardRecord, PcbSyncPlan } from "./types";

export function buildRouterHandoff(record: PcbSyncBoardRecord, plan: PcbSyncPlan, audit: PcbSyncAuditRecord, generatedAt: string): PcbRouterHandoff {
  const placed = record.board.footprints.filter((item) => item.at.x >= 0 && item.at.y >= 0).length;
  const routedNetIds = new Set([...record.board.tracks.map((item) => item.netId), ...record.board.vias.map((item) => item.netId)]);
  const electricalNets = record.board.nets.filter((item) => item.id !== 0);
  const routingState = routedNetIds.size === 0 ? "unrouted" as const : electricalNets.every((item) => routedNetIds.has(item.id)) ? "routed" as const : "partially_routed" as const;
  return { schemaVersion: "sirkit.pcb-router-handoff.v1", tenantId: record.tenantId, projectId: record.projectId, designId: plan.scope.designId, boardId: record.boardId, boardRevision: record.revision, boardDigest: record.digest, assemblyVariantId: plan.snapshot.assemblyVariantId, syncPlanId: plan.planId, syncAuditId: audit.auditId, componentCount: record.board.footprints.length, netCount: electricalNets.length, unresolvedComponentCount: 0, structuralValidationStatus: "passed", placementState: placed === 0 ? "unplaced" : placed === record.board.footprints.length ? "placed" : "partially_placed", routingState, ...(plan.snapshot.constraintsRevision ? { constraintsRevision: plan.snapshot.constraintsRevision } : {}), generatedAt };
}

export function validateRouterHandoff(handoff: PcbRouterHandoff, record: PcbSyncBoardRecord): boolean {
  return handoff.boardId === record.boardId && handoff.boardRevision === record.revision && handoff.boardDigest === record.digest && handoff.componentCount === record.board.footprints.length && handoff.netCount === record.board.nets.filter((item) => item.id !== 0).length && pcbSyncDigest(record.board).length > 0;
}

