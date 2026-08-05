import type { PlacedShape, Vec2 } from "../geometry";
import { shapeDistance } from "../geometry";
import { padCopperLayers, padWorldPosition, padWorldShape, trackShape, viaShape, viaSpannedLayers } from "../geometry-copper";
import type { LayerId } from "../layers";
import { zoneFillIsCurrent } from "../zones/fill-lifecycle";
import { regionShapeDistance } from "../zones/geometry";
import { routingStableId } from "./stable";
import { projectPointToTrack } from "./topology";
import { ROUTING_TOLERANCE_NM, type RouteAnchor, type RoutingSnapshot } from "./types";

const pointShape = (point: Vec2): PlacedShape => ({ shape: { kind: "circle", radius: 0 }, at: point, rotationDeg: 0 });

function eligibility(candidateNetId: number, requestedNetId?: number): { eligible: boolean; reason: string } {
  if (candidateNetId === 0) return { eligible: false, reason: "Net-0 copper cannot start, finish, or adopt a net during ordinary routing." };
  if (requestedNetId !== undefined && requestedNetId !== candidateNetId) return { eligible: false, reason: `Anchor belongs to net ${candidateNetId}, not requested net ${requestedNetId}.` };
  return { eligible: true, reason: "Exact same-net contact is eligible." };
}

function anchor(input: Omit<RouteAnchor, "anchorId">): RouteAnchor {
  return { ...input, anchorId: routingStableId("route-anchor", { objectId: input.objectId, netId: input.netId, layers: input.layers, point: input.point, contactKind: input.contactKind, parameter: input.parameter }) };
}

/** Resolves exact native contacts; render order and array order cannot select the winner. */
export function resolveRouteAnchors(input: { snapshot: RoutingSnapshot; point: Vec2; preferredLayer?: LayerId; requestedNetId?: number; snapRadiusNm?: number }): RouteAnchor[] {
  const { board } = input.snapshot;
  const radius = Math.max(0, input.snapRadiusNm ?? 300_000);
  const candidates: RouteAnchor[] = [];
  const pointer = pointShape(input.point);
  for (const footprint of [...board.footprints].sort((a, b) => a.id.localeCompare(b.id))) for (const pad of footprint.def.pads) {
    if (pad.type === "np_thru_hole") continue;
    const layers = padCopperLayers(footprint, pad);
    if (input.preferredLayer && !layers.includes(input.preferredLayer)) continue;
    const physicalDistance = Math.max(0, shapeDistance(padWorldShape(footprint, pad), pointer));
    if (physicalDistance > radius) continue;
    const netId = footprint.padNets[pad.number] ?? 0;
    const state = eligibility(netId, input.requestedNetId);
    candidates.push(anchor({ objectId: `pad:${footprint.id}:${pad.number}`, netId, layers: [...layers].sort() as LayerId[], point: padWorldPosition(footprint, pad), contactKind: "pad_contact", priority: 0, distanceNm: physicalDistance, ...state }));
  }
  for (const via of [...board.vias].sort((a, b) => a.id.localeCompare(b.id))) {
    const layers = viaSpannedLayers(via);
    if (input.preferredLayer && !layers.includes(input.preferredLayer)) continue;
    const physicalDistance = Math.max(0, shapeDistance(viaShape(via), pointer));
    if (physicalDistance > radius) continue;
    const state = eligibility(via.netId, input.requestedNetId);
    candidates.push(anchor({ objectId: `via:${via.id}`, netId: via.netId, layers: [...layers], point: { ...via.at }, contactKind: "via_contact", priority: 1, distanceNm: physicalDistance, ...state }));
  }
  for (const node of input.snapshot.topology.nodes) {
    if (input.preferredLayer && !node.layerSet.includes(input.preferredLayer)) continue;
    if (node.contactKind !== "branch_junction" && node.objectRefs.filter((ref) => ref.startsWith("track:")).length < 2) continue;
    const physicalDistance = Math.hypot(node.position.x - input.point.x, node.position.y - input.point.y);
    if (physicalDistance > radius) continue;
    const state = eligibility(node.netId, input.requestedNetId);
    candidates.push(anchor({ objectId: node.nodeId, netId: node.netId, layers: [...node.layerSet], point: { ...node.position }, contactKind: "branch_junction", priority: 2, distanceNm: physicalDistance, ...state }));
  }
  for (const track of [...board.tracks].sort((a, b) => a.id.localeCompare(b.id))) {
    if (input.preferredLayer && track.layer !== input.preferredLayer) continue;
    const physicalDistance = Math.max(0, shapeDistance(trackShape(track), pointer));
    if (physicalDistance > radius) continue;
    const projected = projectPointToTrack(track, input.point);
    const length = Math.hypot(track.end.x - track.start.x, track.end.y - track.start.y);
    const endpoint = Math.min(projected.parameter, 1 - projected.parameter) * length <= ROUTING_TOLERANCE_NM;
    const state = eligibility(track.netId, input.requestedNetId);
    candidates.push(anchor({ objectId: `track:${track.id}`, netId: track.netId, layers: [track.layer], point: endpoint ? projected.parameter < 0.5 ? { ...track.start } : { ...track.end } : projected.point, contactKind: endpoint ? "track_endpoint" : "interior_track_junction", parameter: endpoint ? projected.parameter < 0.5 ? 0 : 1 : projected.parameter, priority: 3, distanceNm: physicalDistance, ...state }));
  }
  for (const zone of [...board.zones].sort((a, b) => a.id.localeCompare(b.id))) {
    if (input.preferredLayer && zone.layer !== input.preferredLayer) continue;
    if (!zoneFillIsCurrent(board, zone)) continue;
    zone.fill.forEach((region, regionIndex) => {
      const physicalDistance = Math.max(0, regionShapeDistance(region, pointer, input.point));
      if (physicalDistance > radius) return;
      const state = eligibility(zone.netId, input.requestedNetId);
      candidates.push(anchor({ objectId: `zone:${zone.id}#${regionIndex}`, netId: zone.netId, layers: [zone.layer], point: { ...input.point }, contactKind: "zone_plane_contact", priority: 4, distanceNm: physicalDistance, fillRevision: zone.fillState?.fillHash ?? zone.fillState?.sourceRevision, ...state }));
    });
  }
  const unique = new Map<string, RouteAnchor>();
  for (const candidate of candidates) if (!unique.has(candidate.anchorId)) unique.set(candidate.anchorId, candidate);
  return [...unique.values()].sort((a, b) => Number(b.eligible) - Number(a.eligible) || a.priority - b.priority || a.distanceNm - b.distanceNm || a.objectId.localeCompare(b.objectId) || a.anchorId.localeCompare(b.anchorId));
}

export function bestRouteAnchor(input: Parameters<typeof resolveRouteAnchors>[0]): RouteAnchor | undefined {
  return resolveRouteAnchors(input).find((candidate) => candidate.eligible);
}
