import type { LayerId } from "../layers";
import { getBoardStackup } from "../stackup";
import { routingStableId } from "./stable";
import type { RouteMeasurement, RouteTopologyGraph, RoutingSnapshot } from "./types";

export const VIA_LENGTH_POLICY_ID = "uniform-stack-elevation/1.0.0";

interface Adjacency { to: string; key: string; kind: "track" | "via"; layer?: LayerId; lengthNm: number; viaId?: string }

function layerElevations(snapshot: RoutingSnapshot): Map<LayerId, number> {
  const stackup = getBoardStackup(snapshot.board);
  const layers = stackup.copperLayers.filter((layer) => layer.enabled).sort((a, b) => a.order - b.order);
  const thicknessNm = Math.round(stackup.boardThicknessMm * 1_000_000);
  return new Map(layers.map((layer, index) => [layer.id, layers.length <= 1 ? 0 : Math.round((index / (layers.length - 1)) * thicknessNm)]));
}

function adjacency(snapshot: RoutingSnapshot, graph: RouteTopologyGraph, netId: number): Map<string, Adjacency[]> {
  const result = new Map<string, Adjacency[]>();
  const add = (from: string, edge: Adjacency): void => { result.set(from, [...(result.get(from) ?? []), edge]); };
  for (const edge of graph.edges.filter((item) => item.netId === netId)) {
    const lengthNm = Math.hypot(edge.end.x - edge.start.x, edge.end.y - edge.start.y);
    add(edge.endpointNodeIds[0], { to: edge.endpointNodeIds[1], key: edge.edgeId, kind: "track", layer: edge.layerId, lengthNm });
    add(edge.endpointNodeIds[1], { to: edge.endpointNodeIds[0], key: edge.edgeId, kind: "track", layer: edge.layerId, lengthNm });
  }
  const elevations = layerElevations(snapshot);
  for (const transition of graph.transitions.filter((item) => item.netId === netId)) {
    for (let left = 0; left < transition.nodeIds.length; left += 1) for (let right = left + 1; right < transition.nodeIds.length; right += 1) {
      const fromLayer = transition.connectedLayerSet[left]; const toLayer = transition.connectedLayerSet[right];
      const lengthNm = Math.abs((elevations.get(fromLayer) ?? 0) - (elevations.get(toLayer) ?? 0));
      const key = `via:${transition.viaId}:${fromLayer}:${toLayer}`;
      add(transition.nodeIds[left], { to: transition.nodeIds[right], key, kind: "via", lengthNm, viaId: transition.viaId });
      add(transition.nodeIds[right], { to: transition.nodeIds[left], key, kind: "via", lengthNm, viaId: transition.viaId });
    }
  }
  for (const [node, edges] of result) result.set(node, edges.sort((a, b) => a.key.localeCompare(b.key) || a.to.localeCompare(b.to)));
  return result;
}

/** Finds up to two simple paths. Two means topology is ambiguous and no shortest-path guess is returned. */
function paths(graph: Map<string, Adjacency[]>, start: string, end: string, maxNodes: number): Adjacency[][] {
  const found: Adjacency[][] = [];
  const visit = (node: string, usedNodes: Set<string>, path: Adjacency[]): void => {
    if (found.length >= 2 || usedNodes.size > maxNodes) return;
    if (node === end) { found.push([...path]); return; }
    for (const edge of graph.get(node) ?? []) {
      if (usedNodes.has(edge.to)) continue;
      usedNodes.add(edge.to); path.push(edge); visit(edge.to, usedNodes, path); path.pop(); usedNodes.delete(edge.to);
      if (found.length >= 2) return;
    }
  };
  visit(start, new Set([start]), []);
  return found;
}

export function measureRoutePath(input: { snapshot: RoutingSnapshot; topology?: RouteTopologyGraph; netId: number; endpointNodeA: string; endpointNodeB: string; maxVisitedNodes?: number }): RouteMeasurement {
  const graph = input.topology ?? input.snapshot.topology;
  const base = { netId: input.netId, endpointA: input.endpointNodeA, endpointB: input.endpointNodeB, branchPolicy: "explicit_endpoints_unique_path" as const, lengthPolicyId: VIA_LENGTH_POLICY_ID, evidenceRefs: [graph.graphRevision, input.snapshot.revisions.stackupRevision] };
  const candidates = paths(adjacency(input.snapshot, graph, input.netId), input.endpointNodeA, input.endpointNodeB, input.maxVisitedNodes ?? 10_000);
  if (candidates.length === 0) return { ...base, measurementId: routingStableId("route-measurement", { ...base, status: "disconnected" }), pathEdgeIds: [], planarLengthByLayer: {}, viaContributionByVia: [], totalPhysicalModelLength: null, status: "disconnected" };
  if (candidates.length > 1) return { ...base, measurementId: routingStableId("route-measurement", { ...base, status: "ambiguous_path" }), pathEdgeIds: [], planarLengthByLayer: {}, viaContributionByVia: [], totalPhysicalModelLength: null, status: "ambiguous_path" };
  const path = candidates[0];
  const planar: Partial<Record<LayerId, number>> = {};
  const vias = new Map<string, number>();
  for (const edge of path) {
    if (edge.kind === "track" && edge.layer) planar[edge.layer] = (planar[edge.layer] ?? 0) + edge.lengthNm;
    if (edge.kind === "via" && edge.viaId) vias.set(edge.viaId, (vias.get(edge.viaId) ?? 0) + edge.lengthNm);
  }
  const viaContributionByVia = [...vias].map(([viaId, lengthNm]) => ({ viaId, lengthNm, policyId: VIA_LENGTH_POLICY_ID })).sort((a, b) => a.viaId.localeCompare(b.viaId));
  const totalPhysicalModelLength = Object.values(planar).reduce((sum, value) => sum + (value ?? 0), 0) + viaContributionByVia.reduce((sum, via) => sum + via.lengthNm, 0);
  const pathEdgeIds = path.map((edge) => edge.key);
  return { ...base, measurementId: routingStableId("route-measurement", { ...base, pathEdgeIds, totalPhysicalModelLength }), pathEdgeIds, planarLengthByLayer: planar, viaContributionByVia, totalPhysicalModelLength, status: "measured" };
}

export function measureDifferentialSkew(input: { pairId: string; positive: RouteMeasurement; negative: RouteMeasurement }): { pairId: string; status: "measured" | "unavailable"; positiveLengthNm: number | null; negativeLengthNm: number | null; signedSkewNm: number | null; absoluteSkewNm: number | null; policyId: string } {
  const positive = input.positive.totalPhysicalModelLength;
  const negative = input.negative.totalPhysicalModelLength;
  if (input.positive.status !== "measured" || input.negative.status !== "measured" || positive === null || negative === null) return { pairId: input.pairId, status: "unavailable", positiveLengthNm: positive, negativeLengthNm: negative, signedSkewNm: null, absoluteSkewNm: null, policyId: VIA_LENGTH_POLICY_ID };
  const signedSkewNm = positive - negative;
  return { pairId: input.pairId, status: "measured", positiveLengthNm: positive, negativeLengthNm: negative, signedSkewNm, absoluteSkewNm: Math.abs(signedSkewNm), policyId: VIA_LENGTH_POLICY_ID };
}
