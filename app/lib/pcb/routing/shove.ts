import { trackTrackDistance } from "../geometry-copper";
import type { Track } from "../types";
import { canMutateCopper } from "./protection";
import type { RouteRequest, RoutingSnapshot } from "./types";

export interface ShoveResult {
  status: "solved" | "infeasible" | "budget_exhausted";
  moved: Array<{ before: Track; after: Track; displacementNm: number }>;
  springback: Array<{ objectId: string; original: Track; current: Track }>;
  dependencyChain: string[];
  iterations: number;
  explanation: string;
}

function connectedDegree(snapshot: RoutingSnapshot, trackId: string): number {
  const edges = snapshot.topology.edges.filter((edge) => edge.sourceObjectId === trackId);
  const nodeIds = new Set(edges.flatMap((edge) => edge.endpointNodeIds));
  return [...nodeIds].reduce((sum, nodeId) => sum + snapshot.topology.edges.filter((edge) => edge.endpointNodeIds.includes(nodeId) && edge.sourceObjectId !== trackId).length, 0);
}

/** Bounded local solver. It currently moves only isolated eligible straight tracks; anchored chains fail explicitly. */
export function solveBoundedShove(input: { snapshot: RoutingSnapshot; request: RouteRequest; head: Track[]; clearanceNm: number; maximumDisplacementNm: number }): ShoveResult {
  const moved = new Map<string, { before: Track; after: Track; displacementNm: number }>();
  const queue = [...input.head].sort((a, b) => a.id.localeCompare(b.id));
  let iterations = 0;
  while (queue.length > 0) {
    if (iterations >= input.request.searchBudget.maxIterations || moved.size >= input.request.searchBudget.maxMovedObjects) return { status: "budget_exhausted", moved: [...moved.values()], springback: [...moved.values()].map((item) => ({ objectId: `track:${item.before.id}`, original: item.before, current: item.after })), dependencyChain: [...moved.keys()].map((id) => `track:${id}`), iterations, explanation: "Shove reached its explicit iteration or moved-object budget." };
    const moving = queue.shift()!; iterations += 1;
    const obstacles = input.snapshot.board.tracks.filter((track) => track.layer === moving.layer && track.netId !== moving.netId && trackTrackDistance(moving, moved.get(track.id)?.after ?? track) < input.clearanceNm).sort((a, b) => a.id.localeCompare(b.id));
    for (const obstacle of obstacles) {
      if (moved.has(obstacle.id)) continue;
      const permission = canMutateCopper(obstacle, input.request);
      if (!permission.allowed) return { status: "infeasible", moved: [...moved.values()], springback: [...moved.values()].map((item) => ({ objectId: `track:${item.before.id}`, original: item.before, current: item.after })), dependencyChain: [...moved.keys(), obstacle.id].map((id) => `track:${id}`), iterations, explanation: permission.reason };
      if (connectedDegree(input.snapshot, obstacle.id) > 0) return { status: "infeasible", moved: [...moved.values()], springback: [...moved.values()].map((item) => ({ objectId: `track:${item.before.id}`, original: item.before, current: item.after })), dependencyChain: [...moved.keys(), obstacle.id].map((id) => `track:${id}`), iterations, explanation: "The bounded Stage 8 shove solver will not break an anchored junction; topology-preserving chain displacement is required." };
      const dx = moving.end.x - moving.start.x; const dy = moving.end.y - moving.start.y;
      const length = Math.max(1, Math.hypot(dx, dy));
      let nx = -dy / length; let ny = dx / length;
      const movingCenter = { x: (moving.start.x + moving.end.x) / 2, y: (moving.start.y + moving.end.y) / 2 };
      const obstacleCenter = { x: (obstacle.start.x + obstacle.end.x) / 2, y: (obstacle.start.y + obstacle.end.y) / 2 };
      if ((obstacleCenter.x - movingCenter.x) * nx + (obstacleCenter.y - movingCenter.y) * ny < 0) { nx = -nx; ny = -ny; }
      const displacementNm = Math.ceil(input.clearanceNm - trackTrackDistance(moving, obstacle) + 1);
      if (displacementNm > input.maximumDisplacementNm) return { status: "infeasible", moved: [...moved.values()], springback: [...moved.values()].map((item) => ({ objectId: `track:${item.before.id}`, original: item.before, current: item.after })), dependencyChain: [...moved.keys(), obstacle.id].map((id) => `track:${id}`), iterations, explanation: "Required shove displacement exceeds the explicit budget." };
      const translation = { x: Math.round(nx * displacementNm), y: Math.round(ny * displacementNm) };
      const after = { ...structuredClone(obstacle), start: { x: obstacle.start.x + translation.x, y: obstacle.start.y + translation.y }, end: { x: obstacle.end.x + translation.x, y: obstacle.end.y + translation.y } };
      moved.set(obstacle.id, { before: structuredClone(obstacle), after, displacementNm });
      queue.push(after);
    }
  }
  const values = [...moved.values()].sort((a, b) => a.before.id.localeCompare(b.before.id));
  return { status: "solved", moved: values, springback: values.map((item) => ({ objectId: `track:${item.before.id}`, original: structuredClone(item.before), current: structuredClone(item.after) })), dependencyChain: values.map((item) => `track:${item.before.id}`), iterations, explanation: values.length ? `Moved ${values.length} eligible isolated tracks with deterministic springback snapshots.` : "No shove was required." };
}
