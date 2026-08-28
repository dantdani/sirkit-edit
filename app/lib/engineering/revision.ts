import { pcbRevisionId } from "../pcb/revision";
import type { PcbBoard } from "../pcb/types";
import { engineeringDigest } from "./stable";
import type { CanonicalProjectState, EngineeringChangeSet, ProjectRevision, SemanticImpactFlag } from "./types";

function parts(board: PcbBoard) {
  return {
    electricalIntent: board.nets.map((net) => ({ id: net.id, stableId: net.stableId, name: net.name, endpointKeys: [...(net.endpointKeys ?? [])].sort() })).sort((a, b) => a.id - b.id),
    componentBindings: board.footprints.map((item) => ({ id: item.id, footprintId: item.footprintId, ref: item.ref, padNets: item.padNets, pinPadMappings: item.pinPadMappings, def: item.def })).sort((a, b) => a.id.localeCompare(b.id)),
    // B08: dimensions join board geometry conditionally so pre-B08 boards
    // keep their exact domain revisions (existing envelopes stay verifiable).
    boardGeometry: { outline: board.outline, footprints: board.footprints.map((item) => ({ id: item.id, at: item.at, rotationDeg: item.rotationDeg, side: item.side, bodyMayOverhang: item.bodyMayOverhang })).sort((a, b) => a.id.localeCompare(b.id)), texts: [...board.texts].sort((a, b) => a.id.localeCompare(b.id)), silk: [...(board.silkItems ?? [])].sort((a, b) => a.id.localeCompare(b.id)), ...(board.dimensions?.length ? { dimensions: [...board.dimensions].sort((a, b) => a.id.localeCompare(b.id)) } : {}) },
    copperTopology: { tracks: [...board.tracks].sort((a, b) => a.id.localeCompare(b.id)), vias: [...board.vias].sort((a, b) => a.id.localeCompare(b.id)), routingKeepouts: [...(board.routingKeepouts ?? [])].sort((a, b) => a.id.localeCompare(b.id)), routingPreferences: board.routingPreferences },
    zonesAndFill: board.zones.map((zone) => ({ ...zone, fill: [...zone.fill] })).sort((a, b) => a.id.localeCompare(b.id)),
    stackup: { stackup: board.stackup, stackupConfig: board.stackupConfig },
    constraints: { constraintState: board.constraintState, netClassing: board.netClassing, placementPolicy: board.placementPolicy, placementPreferences: board.placementPreferences },
    protectedState: { footprints: board.footprints.map((item) => [item.id, item.locked]), tracks: board.tracks.map((item) => [item.id, item.locked]), vias: board.vias.map((item) => [item.id, item.locked]), zones: board.zones.map((item) => [item.id, item.locked]) },
    waivers: board.constraintState?.waivers ?? [],
  };
}

export function computeProjectRevision(project: CanonicalProjectState, headSequence = 0, headTransactionId = "genesis"): ProjectRevision {
  const domains = parts(project.pcb);
  return {
    schemaVersion: "sirkit.project-revision.v1", projectId: project.projectId, branchId: project.branchId, headSequence, headTransactionId,
    canonicalStateDigest: engineeringDigest({ project: { ...project, pcbRevision: pcbRevisionId(project.pcb), pcb: undefined } }),
    domainRevisions: {
      schematic: engineeringDigest(project.schematic ?? null), electricalIntent: engineeringDigest(domains.electricalIntent), componentBindings: engineeringDigest(domains.componentBindings), boardGeometry: engineeringDigest(domains.boardGeometry), copperTopology: engineeringDigest(domains.copperTopology), zonesAndFill: engineeringDigest(domains.zonesAndFill), stackup: engineeringDigest(domains.stackup), constraints: engineeringDigest(domains.constraints), protectedState: engineeringDigest(domains.protectedState), waivers: engineeringDigest(domains.waivers), assets: engineeringDigest(project.pinnedAssets),
    },
  };
}

/**
 * B03.1 — SEMANTIC state digest: the canonical state with zone-fill DERIVED
 * lifecycle (fill regions, dirty flags, fill state/hash) normalized away.
 * This is the exact-invertible domain of the operation model: geometry
 * operations mark affected zones dirty on apply AND on inverse-apply, so a
 * recorded inverse provably restores the semantic state while fill
 * bookkeeping legitimately differs. Verified undo/redo replay operates here;
 * head identity and stale detection keep using the full canonicalStateDigest.
 */
export function semanticStateDigest(project: CanonicalProjectState): string {
  return engineeringDigest({
    schema: "sirkit.semantic-state.v1",
    project: {
      ...project,
      pcb: {
        ...project.pcb,
        zones: project.pcb.zones.map((zone) => ({ ...zone, fill: [], dirty: false, fillState: undefined, fillHash: undefined })),
      },
    },
  });
}

export function changedDomains(before: ProjectRevision, after: ProjectRevision): Array<keyof ProjectRevision["domainRevisions"]> {
  return (Object.keys(before.domainRevisions) as Array<keyof ProjectRevision["domainRevisions"]>).filter((key) => before.domainRevisions[key] !== after.domainRevisions[key]);
}

const DOMAIN_FLAGS: Partial<Record<keyof ProjectRevision["domainRevisions"], SemanticImpactFlag[]>> = {
  schematic: ["logical_connectivity_changed", "readiness_dependency_changed"], electricalIntent: ["logical_connectivity_changed", "net_ownership_changed", "readiness_dependency_changed"], componentBindings: ["physical_contact_geometry_changed", "readiness_dependency_changed"], boardGeometry: ["placement_analysis_changed", "readiness_dependency_changed"], copperTopology: ["physical_contact_geometry_changed", "route_topology_changed", "path_measurement_changed", "readiness_dependency_changed"], zonesAndFill: ["zone_fill_dirty", "physical_contact_geometry_changed", "readiness_dependency_changed"], stackup: ["manufacturing_capability_changed", "physical_contact_geometry_changed", "path_measurement_changed", "readiness_dependency_changed"], constraints: ["constraint_program_changed", "effective_rule_changed", "readiness_dependency_changed"], protectedState: ["protected_state_changed"], waivers: ["readiness_dependency_changed"], assets: ["asset_revision_changed", "readiness_dependency_changed"],
};

export function flagsForRevisionDelta(before: ProjectRevision, after: ProjectRevision): SemanticImpactFlag[] {
  return [...new Set(changedDomains(before, after).flatMap((domain) => DOMAIN_FLAGS[domain] ?? []))].sort();
}

export function revisionMatches(left: ProjectRevision, right: ProjectRevision): boolean {
  return left.projectId === right.projectId && left.branchId === right.branchId && left.headSequence === right.headSequence && left.canonicalStateDigest === right.canonicalStateDigest;
}

export function changeSetRevisionAudit(changeSet: EngineeringChangeSet): string[] {
  const diagnostics: string[] = [];
  if (changeSet.baseRevision.canonicalStateDigest === changeSet.resultRevision.canonicalStateDigest) diagnostics.push("NO_SEMANTIC_REVISION_CHANGE");
  for (const domain of changedDomains(changeSet.baseRevision, changeSet.resultRevision)) if (!changeSet.dependencyKeys.some((key) => key === `source:${domain}` || key.startsWith(`source:${domain}:`))) diagnostics.push(`MISSING_DOMAIN_DEPENDENCY:${domain}`);
  return diagnostics;
}
