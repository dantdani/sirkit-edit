import { padWorldPosition } from "../geometry-copper";
import type { LayerId } from "../layers";
import { getNetClass } from "../netclass";
import { adaptBoardToRoutingWorld } from "../smart-routing/world";
import { routeSmart } from "../smart-routing/engine";
import { resolveSmartRoutingRules } from "../smart-routing/rules";
import type { PcbBoard, Track } from "../types";
import { resolveRouteAnchors } from "./anchors";
import { buildRouteCandidate, commitRouteCandidate, type RouteCommitResult } from "./candidate";
import { legalViaTransitions } from "./layers";
import { measureRoutePath } from "./measurement";
import { buildRoutingSnapshot } from "./snapshot";
import { routingStableId } from "./stable";
import type { ProfessionalRouteMode, RouteAnchor, RouteCandidate, RoutePosture, RouteRequest, RouteResult, RoutingSnapshot } from "./types";

function anchorCatalog(snapshot: RoutingSnapshot): RouteAnchor[] {
  const probes: Array<{ point: { x: number; y: number }; layer?: LayerId; netId?: number }> = [];
  for (const footprint of snapshot.board.footprints) for (const pad of footprint.def.pads) {
    probes.push({ point: padWorldPosition(footprint, pad), netId: footprint.padNets[pad.number] ?? 0 });
  }
  for (const via of snapshot.board.vias) probes.push({ point: via.at, netId: via.netId });
  for (const track of snapshot.board.tracks) {
    probes.push({ point: track.start, layer: track.layer, netId: track.netId }, { point: track.end, layer: track.layer, netId: track.netId });
  }
  for (const node of snapshot.topology.nodes) probes.push({ point: node.position, layer: node.layerSet[0], netId: node.netId });
  const unique = new Map<string, RouteAnchor>();
  for (const probe of probes) for (const candidate of resolveRouteAnchors({ snapshot, point: probe.point, preferredLayer: probe.layer, requestedNetId: probe.netId, snapRadiusNm: 1_000 })) {
    if (candidate.eligible) unique.set(candidate.anchorId, candidate);
  }
  return [...unique.values()].sort((a, b) => a.anchorId.localeCompare(b.anchorId));
}

function selectedObjectIds(anchors: readonly RouteAnchor[]): string[] {
  return [...new Set(anchors.filter((anchor) => anchor.contactKind === "interior_track_junction").map((anchor) => anchor.objectId))].sort();
}

/** Provider-neutral deterministic routing surface. AI receives stable IDs and immutable previews, never a raw geometry mutation primitive. */
export class ProfessionalRoutingService {
  constructor(private readonly getBoard: () => PcbBoard) {}

  snapshot(): RoutingSnapshot {
    return buildRoutingSnapshot(this.getBoard());
  }

  anchors(args: { objectId?: string; netId?: number }): RouteAnchor[] {
    return anchorCatalog(this.snapshot()).filter((anchor) =>
      (args.objectId === undefined || anchor.objectId === args.objectId)
      && (args.netId === undefined || anchor.netId === args.netId),
    );
  }

  viaTransitions(args: { netId: number; fromLayer: LayerId }) {
    return legalViaTransitions(this.getBoard(), args.netId, args.fromLayer);
  }

  previewConnection(args: { startAnchorId: string; endAnchorId: string; mode?: ProfessionalRouteMode; posture?: RoutePosture; preferredLayer?: LayerId; actorId: string; actorKind: "human" | "ai" | "system" }): RouteResult {
    const snapshot = this.snapshot();
    const catalog = anchorCatalog(snapshot);
    const start = catalog.find((anchor) => anchor.anchorId === args.startAnchorId);
    const end = catalog.find((anchor) => anchor.anchorId === args.endAnchorId);
    if (!start || !end) throw new Error("The requested route anchor is absent or stale; refresh the routing snapshot.");
    if (start.netId === 0 || start.netId !== end.netId) throw new Error("Ordinary routing requires two exact anchors on the same nonzero net.");
    const layer = args.preferredLayer ?? start.layers.find((candidate) => end.layers.includes(candidate));
    if (!layer) throw new Error("The anchors have no common routable copper layer; choose an explicit legal via transition.");
    const mode = args.mode ?? "walk_around";
    const posture = args.posture ?? "octilinear_a";
    const chosenObjects = selectedObjectIds([start, end]);
    const request: RouteRequest = {
      requestId: routingStableId("route-request", { snapshot: snapshot.snapshotId, start: start.anchorId, end: end.anchorId, mode, posture, layer, actorId: args.actorId }),
      operationKind: "route_connection",
      targetIds: [start.objectId, end.objectId],
      startAnchor: start,
      endAnchor: end,
      routeMode: mode,
      posture,
      preferredLayer: layer,
      viaStrategy: "none",
      hardConstraintIds: [],
      softPreferenceIds: [],
      mutationScope: { kind: chosenObjects.length ? "selected_objects" : "new_candidate", objectIds: chosenObjects },
      preservePolicy: chosenObjects.length ? "selected_manual_movable" : "preserve_manual_imported_unknown",
      searchBudget: { maxNodes: 10_000, maxMovedObjects: 24, maxIterations: 64, timeoutMs: 250 },
      deterministicSeed: 8,
      requestedBy: { actorId: args.actorId, kind: args.actorKind },
    };
    const result = routeSmart(adaptBoardToRoutingWorld(snapshot.board as PcbBoard), {
      schemaVersion: 1,
      netId: start.netId,
      layer,
      start: start.point,
      end: end.point,
      movementPolicy: "keep-existing-copper-fixed",
      routeMode: mode,
      posture,
      maxCandidates: 4,
    }, resolveSmartRoutingRules(snapshot.board as PcbBoard, start.netId, layer));
    const smart = result.candidates.find((candidate) => candidate.id === result.selectedCandidateId);
    let candidate: RouteCandidate | undefined;
    if (smart) {
      const netClass = getNetClass(snapshot.board, start.netId);
      const tracks: Track[] = smart.points.slice(0, -1).map((point, index) => ({
        id: routingStableId("route-service-preview", { request: request.requestId, index }),
        layer,
        width: netClass.trackWidth,
        start: { ...point },
        end: { ...smart.points[index + 1] },
        netId: start.netId,
      }));
      candidate = buildRouteCandidate({ snapshot, request, tracks, anchors: [start, end] });
    }
    const completionState = candidate?.localValidation.legal ? "completed" : mode === "shove" ? "unsupported" : "failed";
    return {
      request,
      ...(candidate ? { selectedCandidate: candidate } : {}),
      candidateSummaries: candidate ? [{ candidateId: candidate.candidateId, status: candidate.status, hardViolations: candidate.localValidation.violations.length, createdLengthNm: candidate.delta.createdTracks.reduce((sum, track) => sum + Math.hypot(track.end.x - track.start.x, track.end.y - track.start.y), 0), viaCount: candidate.delta.createdVias.length }] : [],
      completionState,
      connectivityImpact: candidate?.electricalDelta,
      remainingOpens: candidate?.electricalDelta.remainingOpens ?? snapshot.electrical.realized.remainingConnections,
      newShorts: candidate?.electricalDelta.newShortIds ?? [],
      hardViolations: candidate?.localValidation.violations.map((violation) => violation.code) ?? [],
      unsupportedRequirements: completionState === "unsupported" ? ["bounded-live-shove-service-integration"] : [],
      staleEvidence: [],
      performanceMetrics: { candidates: result.candidates.length, elapsedMs: result.diagnostics.elapsedMs },
      replayBundleRef: routingStableId("route-replay", { snapshot: snapshot.snapshotId, request: request.requestId, candidate: candidate?.candidateDigest }),
    };
  }

  commit(candidate: RouteCandidate, actorId: string): RouteCommitResult {
    return commitRouteCandidate({ board: this.getBoard(), candidate, actorId });
  }

  measure(args: { netId: number; endpointNodeA: string; endpointNodeB: string }) {
    const snapshot = this.snapshot();
    return measureRoutePath({ snapshot, ...args });
  }
}
