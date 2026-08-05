import type { Vec2 } from "../geometry";
import { shapeDistance } from "../geometry";
import { padCopperLayers, padWorldPosition, padWorldShape, trackPadDistance, trackTrackDistance, trackViaDistance, viaSpannedLayers } from "../geometry-copper";
import type { LayerId } from "../layers";
import type { PcbBoard, Track } from "../types";
import { ROUTING_MIN_SEGMENT_NM, ROUTING_TOLERANCE_NM, type RouteContactKind, type RouteTopologyGraph, type RouteTopologyNode } from "./types";
import { routingSemanticHash, routingStableId } from "./stable";

interface SplitPoint { parameter: number; point: Vec2; refs: string[]; kind?: RouteContactKind }

const pointKey = (netId: number, layer: LayerId, point: Vec2): string => `${netId}:${layer}:${point.x}:${point.y}`;
const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;

export function projectPointToTrack(track: Track, point: Vec2): { point: Vec2; parameter: number; distanceNm: number } {
  const dx = track.end.x - track.start.x;
  const dy = track.end.y - track.start.y;
  const length2 = dx * dx + dy * dy;
  const parameter = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - track.start.x) * dx + (point.y - track.start.y) * dy) / length2));
  const projected = { x: Math.round(track.start.x + dx * parameter), y: Math.round(track.start.y + dy * parameter) };
  return { point: projected, parameter, distanceNm: distance(projected, point) };
}

function segmentIntersection(left: Track, right: Track): { point?: Vec2; leftParameter?: number; rightParameter?: number; collinearOverlap: boolean } {
  const p = left.start;
  const q = right.start;
  const r = { x: left.end.x - left.start.x, y: left.end.y - left.start.y };
  const s = { x: right.end.x - right.start.x, y: right.end.y - right.start.y };
  const denominator = cross(r, s);
  const qp = { x: q.x - p.x, y: q.y - p.y };
  if (Math.abs(denominator) < 1e-9) {
    if (Math.abs(cross(qp, r)) > ROUTING_TOLERANCE_NM * Math.max(1, Math.hypot(r.x, r.y))) return { collinearOverlap: false };
    const a = projectPointToTrack(left, right.start).parameter;
    const b = projectPointToTrack(left, right.end).parameter;
    const overlap = Math.max(0, Math.min(1, Math.max(a, b)) - Math.max(0, Math.min(a, b)));
    return { collinearOverlap: overlap * Math.hypot(r.x, r.y) > ROUTING_TOLERANCE_NM };
  }
  const t = cross(qp, s) / denominator;
  const u = cross(qp, r) / denominator;
  if (t < -1e-12 || t > 1 + 1e-12 || u < -1e-12 || u > 1 + 1e-12) return { collinearOverlap: false };
  return { point: { x: Math.round(p.x + t * r.x), y: Math.round(p.y + t * r.y) }, leftParameter: Math.max(0, Math.min(1, t)), rightParameter: Math.max(0, Math.min(1, u)), collinearOverlap: false };
}

function addSplit(map: Map<string, SplitPoint[]>, track: Track, split: SplitPoint): void {
  const list = map.get(track.id) ?? [];
  const existing = list.find((item) => Math.abs(item.parameter - split.parameter) * Math.hypot(track.end.x - track.start.x, track.end.y - track.start.y) <= ROUTING_TOLERANCE_NM);
  if (existing) {
    existing.refs.push(...split.refs);
    if (split.kind && (!existing.kind || split.kind === "pad_contact" || split.kind === "via_contact")) existing.kind = split.kind;
  } else list.push({ ...split, point: { ...split.point }, refs: [...split.refs] });
  map.set(track.id, list);
}

function nodeFor(input: { nodes: Map<string, RouteTopologyNode>; netId: number; layer: LayerId; point: Vec2; refs: string[]; kind?: RouteContactKind }): RouteTopologyNode {
  const key = pointKey(input.netId, input.layer, input.point);
  const existing = input.nodes.get(key);
  if (existing) {
    existing.objectRefs = [...new Set([...existing.objectRefs, ...input.refs])].sort();
    if (input.kind && (existing.contactKind === "track_endpoint" || input.kind === "pad_contact" || input.kind === "via_contact")) existing.contactKind = input.kind;
    return existing;
  }
  const node: RouteTopologyNode = {
    nodeId: routingStableId("route-node", { netId: input.netId, layer: input.layer, point: input.point }),
    netId: input.netId,
    position: { ...input.point },
    contactKind: input.kind ?? "track_endpoint",
    objectRefs: [...new Set(input.refs)].sort(),
    layerSet: [input.layer],
  };
  input.nodes.set(key, node);
  return node;
}

/** Exact segment topology for native straight tracks. Visual ordering is irrelevant. */
export function buildRouteTopology(board: PcbBoard): RouteTopologyGraph {
  const tracks = [...board.tracks].sort((a, b) => a.id.localeCompare(b.id));
  const splits = new Map<string, SplitPoint[]>();
  const diagnostics: RouteTopologyGraph["diagnostics"] = [];
  for (const track of tracks) {
    addSplit(splits, track, { parameter: 0, point: track.start, refs: [`track:${track.id}`], kind: "track_endpoint" });
    addSplit(splits, track, { parameter: 1, point: track.end, refs: [`track:${track.id}`], kind: "track_endpoint" });
    if (distance(track.start, track.end) < ROUTING_MIN_SEGMENT_NM) diagnostics.push({ code: "ROUTE_SEGMENT_TOO_SHORT", objectIds: [`track:${track.id}`], message: "Track is below the minimum representable routing segment length." });
  }
  for (let left = 0; left < tracks.length; left += 1) for (let right = left + 1; right < tracks.length; right += 1) {
    const a = tracks[left]; const b = tracks[right];
    if (a.layer !== b.layer) continue;
    if (a.netId !== b.netId) {
      if (trackTrackDistance(a, b) <= 0) diagnostics.push({ code: "DIFFERENT_NET_COPPER_CONTACT", objectIds: [`track:${a.id}`, `track:${b.id}`].sort(), message: "Different-net tracks touch or overlap on the same layer." });
      continue;
    }
    const contact = segmentIntersection(a, b);
    if (contact.collinearOverlap) {
      diagnostics.push({ code: "AMBIGUOUS_COLLINEAR_OVERLAP", objectIds: [`track:${a.id}`, `track:${b.id}`].sort(), message: "Overlapping collinear copper is conductive but is not silently normalized." });
      for (const point of [a.start, a.end, b.start, b.end]) {
        const pa = projectPointToTrack(a, point); const pb = projectPointToTrack(b, point);
        if (pa.distanceNm <= ROUTING_TOLERANCE_NM) addSplit(splits, a, { parameter: pa.parameter, point: pa.point, refs: [`track:${b.id}`], kind: "branch_junction" });
        if (pb.distanceNm <= ROUTING_TOLERANCE_NM) addSplit(splits, b, { parameter: pb.parameter, point: pb.point, refs: [`track:${a.id}`], kind: "branch_junction" });
      }
    } else if (contact.point && contact.leftParameter !== undefined && contact.rightParameter !== undefined) {
      addSplit(splits, a, { parameter: contact.leftParameter, point: contact.point, refs: [`track:${b.id}`], kind: "branch_junction" });
      addSplit(splits, b, { parameter: contact.rightParameter, point: contact.point, refs: [`track:${a.id}`], kind: "branch_junction" });
    }
  }
  for (const via of [...board.vias].sort((a, b) => a.id.localeCompare(b.id))) {
    const layers = viaSpannedLayers(via);
    for (const track of tracks.filter((item) => item.netId === via.netId && layers.includes(item.layer) && trackViaDistance(item, via) <= 0)) {
      const projected = projectPointToTrack(track, via.at);
      addSplit(splits, track, { parameter: projected.parameter, point: projected.point, refs: [`via:${via.id}`], kind: "via_contact" });
    }
  }
  for (const footprint of [...board.footprints].sort((a, b) => a.id.localeCompare(b.id))) for (const pad of footprint.def.pads) {
    if (pad.type === "np_thru_hole") continue;
    const netId = footprint.padNets[pad.number] ?? 0;
    if (netId === 0) continue;
    const layers = padCopperLayers(footprint, pad);
    const center = padWorldPosition(footprint, pad);
    for (const track of tracks.filter((item) => item.netId === netId && layers.includes(item.layer) && trackPadDistance(item, footprint, pad) <= 0)) {
      const projected = projectPointToTrack(track, center);
      addSplit(splits, track, { parameter: projected.parameter, point: projected.point, refs: [`pad:${footprint.id}:${pad.number}`], kind: "pad_contact" });
    }
  }

  const nodes = new Map<string, RouteTopologyNode>();
  const edges: RouteTopologyGraph["edges"] = [];
  for (const track of tracks) {
    const ordered = (splits.get(track.id) ?? []).sort((a, b) => a.parameter - b.parameter || a.point.x - b.point.x || a.point.y - b.point.y);
    for (let index = 0; index + 1 < ordered.length; index += 1) {
      const a = ordered[index]; const b = ordered[index + 1];
      if (distance(a.point, b.point) <= ROUTING_TOLERANCE_NM) continue;
      const left = nodeFor({ nodes, netId: track.netId, layer: track.layer, point: a.point, refs: [...a.refs, `track:${track.id}`], kind: a.kind });
      const right = nodeFor({ nodes, netId: track.netId, layer: track.layer, point: b.point, refs: [...b.refs, `track:${track.id}`], kind: b.kind });
      edges.push({ edgeId: routingStableId("route-edge", { source: track.id, a: a.parameter, b: b.parameter }), netId: track.netId, geometryRef: `track:${track.id}@${a.parameter.toFixed(12)}:${b.parameter.toFixed(12)}`, layerId: track.layer, endpointNodeIds: [left.nodeId, right.nodeId], start: { ...a.point }, end: { ...b.point }, widthNm: track.width, sourceObjectId: track.id, lineageObjectIds: [...new Set([track.id, ...(track.routingProvenance?.lineageObjectIds ?? [])])].sort() });
    }
  }
  const transitions: RouteTopologyGraph["transitions"] = [];
  for (const via of [...board.vias].sort((a, b) => a.id.localeCompare(b.id))) {
    const layers = viaSpannedLayers(via);
    const nodeIds = layers.map((layer) => nodeFor({ nodes, netId: via.netId, layer, point: via.at, refs: [`via:${via.id}`], kind: "via_contact" }).nodeId);
    transitions.push({ viaId: via.id, netId: via.netId, position: { ...via.at }, connectedLayerSet: [...layers], nodeIds, span: [...via.layers], ...(via.padstackId ? { padstackRef: via.padstackId } : {}) });
  }
  const nodeValues = [...nodes.values()].map((node) => ({ ...node, objectRefs: [...node.objectRefs].sort(), layerSet: [...node.layerSet].sort() as LayerId[] })).sort((a, b) => a.nodeId.localeCompare(b.nodeId));
  const sortedEdges = edges.sort((a, b) => a.edgeId.localeCompare(b.edgeId));
  const sortedTransitions = transitions.sort((a, b) => a.viaId.localeCompare(b.viaId));
  return { graphRevision: routingSemanticHash({ nodes: nodeValues, edges: sortedEdges, transitions: sortedTransitions, diagnostics }), nodes: nodeValues, edges: sortedEdges, transitions: sortedTransitions, diagnostics: diagnostics.sort((a, b) => a.code.localeCompare(b.code) || a.objectIds.join().localeCompare(b.objectIds.join())) };
}

export function pointTouchesPad(board: PcbBoard, footprintId: string, padNumber: string, point: Vec2): boolean {
  const footprint = board.footprints.find((item) => item.id === footprintId);
  const pad = footprint?.def.pads.find((item) => item.number === padNumber);
  if (!footprint || !pad) return false;
  return shapeDistance(padWorldShape(footprint, pad), { shape: { kind: "circle", radius: 0 }, at: point, rotationDeg: 0 }) <= 0;
}
