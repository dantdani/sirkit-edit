import type { BBox, Vec2 } from "../geometry";
import { segmentDistance } from "../geometry-copper";
import { stableHash } from "./hash";
import {
  bboxContainsPoint,
  bboxOfPoints,
  expandBBox,
  normalizePath,
  octilinearConnection,
  pathEntersAnyBBox,
  pathKey,
  pathLength,
  segmentEntersBBoxInterior,
} from "./geometry";
import { scoreRoute } from "./scoring";
import { validateSmartRoute } from "./validator";
import type {
  EffectiveRoutingRules,
  RoutingWorld,
  RoutingWorldItem,
  SmartRouteCandidate,
  SmartRouteIntent,
  WalkDirection,
} from "./types";
import { classifyNetRelation } from "../copper-policy";

const MIN_SEARCH_NM = 2_000_000;
const MAX_SEARCH_NM = 12_000_000;
const MAX_SEARCH_OBSTACLES = 12;

function candidateId(
  world: RoutingWorld,
  intent: SmartRouteIntent,
  mode: SmartRouteCandidate["mode"],
  direction: WalkDirection | undefined,
  points: readonly Vec2[],
): string {
  return `src-${stableHash(`${world.revision}|${intent.netId}|${intent.layer}|${mode}|${direction ?? "-"}|${pathKey(points)}`)}`;
}
function makeCandidate(
  world: RoutingWorld,
  intent: SmartRouteIntent,
  rules: EffectiveRoutingRules,
  mode: SmartRouteCandidate["mode"],
  direction: WalkDirection | undefined,
  points: readonly Vec2[],
  explanation: string,
  congestion = 0,
): SmartRouteCandidate {
  const normalized = Object.freeze(normalizePath(points));
  return {
    id: candidateId(world, intent, mode, direction, normalized),
    mode,
    ...(direction ? { direction } : {}),
    points: normalized,
    validation: validateSmartRoute(world, intent, rules, normalized),
    score: scoreRoute(normalized, rules, congestion),
    explanation,
  };
}

export function generateDirectCandidates(
  world: RoutingWorld,
  intent: SmartRouteIntent,
  rules: EffectiveRoutingRules,
): SmartRouteCandidate[] {
  if (intent.posture === "arbitrary") {
    return [makeCandidate(
      world,
      intent,
      rules,
      "direct",
      undefined,
      [intent.start, intent.end],
      "Native straight copper at the requested arbitrary angle.",
    )];
  }
  const paths = [
    octilinearConnection(intent.start, intent.end, true),
    octilinearConnection(intent.start, intent.end, false),
  ];
  const seen = new Set<string>();
  const candidates: SmartRouteCandidate[] = [];
  for (let index = 0; index < paths.length; index++) {
    const key = pathKey(paths[index]);
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(makeCandidate(
      world,
      intent,
      rules,
      "direct",
      undefined,
      paths[index],
      index === 0 ? "Shortest direct 45-degree posture." : "Alternate direct 45-degree posture.",
    ));
  }
  return candidates;
}

interface SearchObstacle {
  item: RoutingWorldItem;
  box: BBox;
  center: Vec2;
}

interface SearchNode {
  point: Vec2;
  obstacleId?: string;
}

interface GraphEdge {
  to: number;
  points: Vec2[];
  cost: number;
}

function obstacleDistance(item: RoutingWorldItem, start: Vec2, end: Vec2): number {
  const center = { x: (item.bbox.minX + item.bbox.maxX) / 2, y: (item.bbox.minY + item.bbox.maxY) / 2 };
  return segmentDistance(start, end, center, center);
}

function searchObstacles(
  world: RoutingWorld,
  intent: SmartRouteIntent,
  rules: EffectiveRoutingRules,
): SearchObstacle[] {
  const span = Math.hypot(intent.end.x - intent.start.x, intent.end.y - intent.start.y);
  const search = Math.max(MIN_SEARCH_NM, Math.min(MAX_SEARCH_NM, span * 0.35));
  const corridor = expandBBox(bboxOfPoints([intent.start, intent.end]), search);
  const escape = rules.clearanceNm + rules.trackWidthNm / 2 + rules.gridNm;
  return world.spatial
    .queryBox(intent.layer, corridor)
    .filter((item) => {
      const sameNet = classifyNetRelation(world.board, item.netId, intent.netId) === "same-proven-net";
      if (item.kind === "zone" && sameNet) return false;
      const endpointItem = sameNet
        && (bboxContainsPoint(item.bbox, intent.start) || bboxContainsPoint(item.bbox, intent.end));
      return !endpointItem;
    })
    .sort((a, b) => obstacleDistance(a, intent.start, intent.end) - obstacleDistance(b, intent.start, intent.end) || a.id.localeCompare(b.id))
    .slice(0, MAX_SEARCH_OBSTACLES)
    .map((item) => {
      const raw = expandBBox(item.bbox, escape);
      const box = {
        minX: Math.floor(raw.minX / rules.gridNm) * rules.gridNm,
        minY: Math.floor(raw.minY / rules.gridNm) * rules.gridNm,
        maxX: Math.ceil(raw.maxX / rules.gridNm) * rules.gridNm,
        maxY: Math.ceil(raw.maxY / rules.gridNm) * rules.gridNm,
      };
      return {
        item,
        box,
        center: { x: Math.round((box.minX + box.maxX) / 2), y: Math.round((box.minY + box.maxY) / 2) },
      };
    });
}

function firstBlockingObstacle(obstacles: readonly SearchObstacle[], directPaths: readonly Vec2[][]): SearchObstacle | undefined {
  const blockers = obstacles.filter((obstacle) =>
    directPaths.some((points) => points.some((point, index) =>
      index + 1 < points.length && segmentEntersBBoxInterior(point, points[index + 1], obstacle.box),
    )),
  );
  return blockers.sort((a, b) =>
    Math.hypot(a.center.x - directPaths[0][0].x, a.center.y - directPaths[0][0].y)
      - Math.hypot(b.center.x - directPaths[0][0].x, b.center.y - directPaths[0][0].y)
      || a.item.id.localeCompare(b.item.id),
  )[0];
}

function sideOfRoute(intent: SmartRouteIntent, point: Vec2): number {
  return (intent.end.x - intent.start.x) * (point.y - intent.start.y)
    - (intent.end.y - intent.start.y) * (point.x - intent.start.x);
}

function graphNodes(
  intent: SmartRouteIntent,
  obstacles: readonly SearchObstacle[],
  first: SearchObstacle,
  direction: WalkDirection,
): SearchNode[] {
  const nodes: SearchNode[] = [{ point: intent.start }, { point: intent.end }];
  for (const obstacle of obstacles) {
    const corners: Vec2[] = [
      { x: obstacle.box.minX, y: obstacle.box.minY },
      { x: obstacle.box.maxX, y: obstacle.box.minY },
      { x: obstacle.box.maxX, y: obstacle.box.maxY },
      { x: obstacle.box.minX, y: obstacle.box.maxY },
    ];
    for (const point of corners) {
      if (obstacle.item.id === first.item.id) {
        const side = sideOfRoute(intent, point);
        if (direction === "cw" && side > 0) continue;
        if (direction === "ccw" && side < 0) continue;
      }
      nodes.push({ point, obstacleId: obstacle.item.id });
    }
  }
  const seen = new Set<string>();
  return nodes.filter((node) => {
    const key = `${node.point.x},${node.point.y}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildGraph(nodes: readonly SearchNode[], boxes: readonly BBox[], rules: EffectiveRoutingRules): GraphEdge[][] {
  const graph: GraphEdge[][] = nodes.map(() => []);
  for (let a = 0; a < nodes.length; a++) {
    for (let b = a + 1; b < nodes.length; b++) {
      const options = [
        octilinearConnection(nodes[a].point, nodes[b].point, true),
        octilinearConnection(nodes[a].point, nodes[b].point, false),
      ];
      let best: Vec2[] | null = null;
      let bestCost = Infinity;
      for (const points of options) {
        if (pathEntersAnyBBox(points, boxes)) continue;
        const cost = pathLength(points) + Math.max(0, points.length - 2) * rules.gridNm * 4;
        if (cost < bestCost || (cost === bestCost && pathKey(points) < pathKey(best ?? []))) {
          best = points;
          bestCost = cost;
        }
      }
      if (!best) continue;
      graph[a].push({ to: b, points: best, cost: bestCost });
      graph[b].push({ to: a, points: [...best].reverse(), cost: bestCost });
    }
  }
  for (const edges of graph) edges.sort((a, b) => a.cost - b.cost || a.to - b.to);
  return graph;
}

function shortestPath(nodes: readonly SearchNode[], graph: readonly GraphEdge[][]): Vec2[] | null {
  const distance = nodes.map(() => Infinity);
  const visited = nodes.map(() => false);
  const previous: ({ node: number; edge: GraphEdge } | null)[] = nodes.map(() => null);
  distance[0] = 0;
  for (let iteration = 0; iteration < nodes.length; iteration++) {
    let current = -1;
    for (let index = 0; index < nodes.length; index++) {
      if (!visited[index] && (current < 0 || distance[index] < distance[current] || (distance[index] === distance[current] && index < current))) {
        current = index;
      }
    }
    if (current < 0 || !Number.isFinite(distance[current])) break;
    if (current === 1) break;
    visited[current] = true;
    for (const edge of graph[current]) {
      const next = distance[current] + edge.cost;
      if (next < distance[edge.to]) {
        distance[edge.to] = next;
        previous[edge.to] = { node: current, edge };
      }
    }
  }
  if (!Number.isFinite(distance[1])) return null;
  const edges: GraphEdge[] = [];
  let cursor = 1;
  while (cursor !== 0) {
    const step = previous[cursor];
    if (!step) return null;
    edges.push(step.edge);
    cursor = step.node;
  }
  edges.reverse();
  const points: Vec2[] = [];
  for (const edge of edges) {
    if (!points.length) points.push(...edge.points);
    else points.push(...edge.points.slice(1));
  }
  return normalizePath(points);
}

export interface WalkCandidateResult {
  candidates: SmartRouteCandidate[];
  consideredObstacleIds: string[];
  rejectedReasons: string[];
}

export function generateWalkAroundCandidates(
  world: RoutingWorld,
  intent: SmartRouteIntent,
  rules: EffectiveRoutingRules,
  directCandidates: readonly SmartRouteCandidate[],
): WalkCandidateResult {
  const obstacles = searchObstacles(world, intent, rules);
  const consideredObstacleIds = obstacles.map((value) => value.item.id);
  const rejectedReasons: string[] = [];
  const first = firstBlockingObstacle(obstacles, directCandidates.map((candidate) => [...candidate.points]));
  if (!first) {
    return { candidates: [], consideredObstacleIds, rejectedReasons: ["No traversable obstacle boundary was found."] };
  }
  const boxes = obstacles.map((obstacle) => obstacle.box);
  const candidates: SmartRouteCandidate[] = [];
  const seen = new Set<string>();
  for (const direction of ["cw", "ccw"] as const) {
    const nodes = graphNodes(intent, obstacles, first, direction);
    const points = shortestPath(nodes, buildGraph(nodes, boxes, rules));
    if (!points) {
      rejectedReasons.push(`${direction.toUpperCase()} search found no bounded path.`);
      continue;
    }
    const candidate = makeCandidate(
      world,
      intent,
      rules,
      "walk-around",
      direction,
      points,
      `${direction.toUpperCase()} walk around ${first.item.id}; existing copper stays fixed.`,
      obstacles.length,
    );
    if (!candidate.validation.legal) {
      rejectedReasons.push(`${direction.toUpperCase()} candidate failed independent validation: ${candidate.validation.violations[0]?.message ?? "unknown"}`);
      continue;
    }
    const key = pathKey(candidate.points);
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(candidate);
  }
  candidates.sort((a, b) => a.score.total - b.score.total || a.id.localeCompare(b.id));
  return { candidates, consideredObstacleIds, rejectedReasons };
}
