import { constraintSemanticHash } from "@/app/lib/constraints/stable";
import { computeElectricalTruth } from "../electrical-truth";
import { pcbRevisionId } from "../revision";
import { getBoardStackup } from "../stackup";
import type { PcbBoard } from "../types";
import { deepFreezeRouting, routingSemanticHash, routingStableId } from "./stable";
import { buildRouteTopology } from "./topology";
import { ROUTING_ENGINE_VERSION, ROUTING_GEOMETRY_VERSION, ROUTING_MIN_SEGMENT_NM, ROUTING_SNAPSHOT_SCHEMA, ROUTING_TOLERANCE_NM, type RouteInputRevisionSet, type RoutingSnapshot } from "./types";

function revisions(board: PcbBoard): RouteInputRevisionSet {
  const designRevision = pcbRevisionId(board);
  const electrical = computeElectricalTruth(board);
  const stackup = getBoardStackup(board);
  return {
    designRevision,
    electricalRevision: routingSemanticHash({ designRevision: electrical.designRevision, intended: electrical.intended, assigned: electrical.assigned, realized: { state: electrical.realized.state, remainingConnections: electrical.realized.remainingConnections }, shorts: electrical.shorts, unresolved: electrical.unresolved }),
    componentLibraryRevisionSet: routingSemanticHash(board.footprints.map((footprint) => ({ id: footprint.id, footprintId: footprint.footprintId, def: footprint.def, mappings: footprint.pinPadMappings })).sort((a, b) => a.id.localeCompare(b.id))),
    stackupRevision: routingSemanticHash(stackup),
    constraintProgramRevision: board.constraintState?.activeProgram?.programHash ?? "constraint-program:none",
    zoneFillRevisionByLayer: Object.fromEntries([...board.zones].sort((a, b) => a.id.localeCompare(b.id)).map((zone) => [`${zone.layer}:${zone.id}`, zone.fillState?.fillHash ?? zone.fillState?.sourceRevision ?? `zone:${zone.dirty ? "dirty" : "unversioned"}`])),
    protectedStateRevision: routingSemanticHash({ tracks: board.tracks.filter((track) => track.locked || !track.source || track.source === "human" || track.source === "imported").map((track) => ({ id: track.id, locked: track.locked, source: track.source, provenance: track.routingProvenance })).sort((a, b) => a.id.localeCompare(b.id)), vias: board.vias.filter((via) => via.locked || !via.source || via.source === "human" || via.source === "imported").map((via) => ({ id: via.id, locked: via.locked, source: via.source, provenance: via.routingProvenance })).sort((a, b) => a.id.localeCompare(b.id)) }),
    engineVersion: ROUTING_ENGINE_VERSION,
  };
}

export function routingInputRevisions(board: PcbBoard): RouteInputRevisionSet {
  return revisions(board);
}

export function buildRoutingSnapshot(board: PcbBoard): RoutingSnapshot {
  const cloned = structuredClone(board);
  const revisionSet = revisions(cloned);
  const electrical = computeElectricalTruth(cloned);
  const topology = buildRouteTopology(cloned);
  const base = {
    schemaVersion: ROUTING_SNAPSHOT_SCHEMA,
    revisions: revisionSet,
    board: cloned,
    topology,
    electrical,
    ...(cloned.constraintState?.activeProgram ? { constraintProgram: structuredClone(cloned.constraintState.activeProgram) } : {}),
    manufacturingCapabilities: { throughVias: getBoardStackup(cloned).routing.viasAllowed, blindVias: false as const, buriedVias: false as const, microvias: false as const, arcs: false as const },
    geometryPolicy: { units: "nm" as const, toleranceNm: ROUTING_TOLERANCE_NM, minimumSegmentNm: ROUTING_MIN_SEGMENT_NM, version: ROUTING_GEOMETRY_VERSION },
  };
  const snapshotId = routingStableId("routing-snapshot", { revisions: revisionSet, topology: topology.graphRevision, program: cloned.constraintState?.activeProgram ? constraintSemanticHash(cloned.constraintState.activeProgram) : undefined });
  return deepFreezeRouting({ ...base, snapshotId }) as RoutingSnapshot;
}
