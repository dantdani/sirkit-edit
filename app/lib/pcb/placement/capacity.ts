import type { BBox, Vec2 } from "../geometry";
import type { LayerId } from "../layers";
import { getBoardStackup } from "../stackup";
import { instanceWorldBounds, median, terminalWorldPosition } from "./geometry";
import type {
  PlacementCongestionReport,
  PlacementCutlineMetric,
  PlacementHyperedge,
  PlacementProblem,
  PlacementTransform,
} from "./types";
import { PLACEMENT_METRIC_VERSION } from "./types";

interface CutlineAccumulator {
  metric: PlacementCutlineMetric;
  netDemand: Map<string, number>;
}

function overlapsCoordinate(box: BBox, direction: "horizontal" | "vertical", coordinate: number): boolean {
  return direction === "horizontal"
    ? coordinate > box.minY && coordinate < box.maxY
    : coordinate > box.minX && coordinate < box.maxX;
}

function intervalFor(box: BBox, direction: "horizontal" | "vertical"): [number, number] {
  return direction === "horizontal" ? [box.minX, box.maxX] : [box.minY, box.maxY];
}

function unionLength(intervals: Array<[number, number]>, min: number, max: number): number {
  const clipped = intervals.map(([left, right]) => [Math.max(min, left), Math.min(max, right)] as [number, number]).filter(([left, right]) => right > left).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let length = 0;
  let start = 0;
  let end = 0;
  for (const [left, right] of clipped) {
    if (right <= end) continue;
    if (left > end) {
      length += Math.max(0, end - start);
      start = left;
    }
    end = right;
  }
  return length + Math.max(0, end - start);
}

function polygonBounds(points: Vec2[]): BBox {
  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

function outerLayerObstacle(problem: PlacementProblem, instanceId: string, layerId: LayerId, placements: Record<string, PlacementTransform>): boolean {
  const placement = placements[instanceId];
  const footprint = problem.board.footprints.find((candidate) => candidate.id === instanceId);
  if (!placement || !footprint) return false;
  if (footprint.def.attributes.throughHole) return true;
  return layerId === (placement.side === "top" ? "copperTop" : "copperBottom");
}

function capacityPitch(problem: PlacementProblem, layerId: LayerId): number {
  const layer = getBoardStackup(problem.board).copperLayers.find((candidate) => candidate.id === layerId);
  const explicit = problem.hyperedges.filter((edge) => edge.allowedLayerIds.includes(layerId));
  const worst = explicit.reduce((maximum, edge) => Math.max(maximum, edge.minTrackWidthNm + edge.clearanceNm), 0);
  return Math.max(1, worst, Math.round((layer?.defaultTraceWidthMm ?? 0.25) * 1_000_000 + 200_000));
}

function preferredFactor(problem: PlacementProblem, layerId: LayerId, direction: "horizontal" | "vertical"): number {
  const preferred = getBoardStackup(problem.board).copperLayers.find((candidate) => candidate.id === layerId)?.preferredDirection;
  return preferred === "any" || preferred === direction ? 1 : 0.55;
}

function buildCutlines(problem: PlacementProblem, placements: Record<string, PlacementTransform>): Map<string, CutlineAccumulator> {
  const { outlineBounds, columns, rows } = problem.capacityPolicy;
  const map = new Map<string, CutlineAccumulator>();
  for (const layerId of problem.capacityPolicy.signalLayerIds) {
    const pitch = capacityPitch(problem, layerId);
    for (const direction of ["vertical", "horizontal"] as const) {
      const count = direction === "vertical" ? columns : rows;
      for (let index = 1; index < count; index += 1) {
        const coordinateNm = direction === "vertical"
          ? outlineBounds.minX + index * problem.capacityPolicy.gridCellWidthNm
          : outlineBounds.minY + index * problem.capacityPolicy.gridCellHeightNm;
        const spanMin = direction === "vertical" ? outlineBounds.minY : outlineBounds.minX;
        const spanMax = direction === "vertical" ? outlineBounds.maxY : outlineBounds.maxX;
        const obstacles: Array<[number, number]> = [];
        for (const instance of problem.instances) {
          if (!outerLayerObstacle(problem, instance.id, layerId, placements)) continue;
          const box = instanceWorldBounds(problem, instance.id, placements);
          if (overlapsCoordinate(box, direction, coordinateNm)) obstacles.push(intervalFor(box, direction));
        }
        for (const keepout of problem.board.routingKeepouts ?? []) {
          if (!keepout.forbidTracks || !keepout.layers.includes(layerId) || keepout.polygon.length < 3) continue;
          const box = polygonBounds(keepout.polygon);
          if (overlapsCoordinate(box, direction, coordinateNm)) obstacles.push(intervalFor(box, direction));
        }
        const blockedNm = unionLength(obstacles, spanMin, spanMax);
        const usableNm = Math.max(0, spanMax - spanMin - blockedNm);
        const protectedCrossings = problem.board.tracks.filter((track) => track.layer === layerId && problem.capacityPolicy.protectedTrackIds.includes(track.id) && (
          direction === "vertical"
            ? (track.start.x - coordinateNm) * (track.end.x - coordinateNm) <= 0
            : (track.start.y - coordinateNm) * (track.end.y - coordinateNm) <= 0
        )).length;
        const capacityTracks = Math.max(0, Math.floor((usableNm / pitch) * preferredFactor(problem, layerId, direction === "vertical" ? "horizontal" : "vertical")) - protectedCrossings);
        const id = `cutline:${layerId}:${direction}:${index}`;
        map.set(id, {
          metric: {
            id,
            layerId,
            direction,
            index,
            coordinateNm,
            capacityTracks,
            demandTracks: 0,
            overflowTracks: 0,
            ratio: 0,
            contributingNetIds: [],
            capacityAssumptions: [`pitch_nm:${pitch}`, `blocked_nm:${Math.round(blockedNm)}`, `protected_crossings:${protectedCrossings}`],
          },
          netDemand: new Map(),
        });
      }
    }
  }
  return map;
}

function chosenLayer(problem: PlacementProblem, edge: PlacementHyperedge, routeDirection: "horizontal" | "vertical"): LayerId | undefined {
  const stackup = getBoardStackup(problem.board);
  const eligible = edge.allowedLayerIds.filter((id) => problem.capacityPolicy.signalLayerIds.includes(id));
  const preferred = edge.preferredLayerIds.filter((id) => eligible.includes(id));
  return [...preferred, ...eligible].find((id) => {
    const direction = stackup.copperLayers.find((layer) => layer.id === id)?.preferredDirection;
    return direction === routeDirection || direction === "any";
  }) ?? preferred[0] ?? eligible[0];
}

function addSegmentDemand(input: {
  problem: PlacementProblem;
  cutlines: Map<string, CutlineAccumulator>;
  edge: PlacementHyperedge;
  from: Vec2;
  to: Vec2;
  direction: "horizontal" | "vertical";
}): void {
  const layerId = chosenLayer(input.problem, input.edge, input.direction);
  if (!layerId) return;
  const cutDirection = input.direction === "horizontal" ? "vertical" : "horizontal";
  const pitch = input.edge.minTrackWidthNm + input.edge.clearanceNm;
  const basePitch = capacityPitch(input.problem, layerId);
  const demand = Math.max(1, pitch / basePitch);
  for (const accumulator of input.cutlines.values()) {
    const metric = accumulator.metric;
    if (metric.layerId !== layerId || metric.direction !== cutDirection) continue;
    const crosses = input.direction === "horizontal"
      ? Math.min(input.from.x, input.to.x) < metric.coordinateNm && Math.max(input.from.x, input.to.x) >= metric.coordinateNm
      : Math.min(input.from.y, input.to.y) < metric.coordinateNm && Math.max(input.from.y, input.to.y) >= metric.coordinateNm;
    if (!crosses) continue;
    const previous = accumulator.netDemand.get(input.edge.netStableId) ?? 0;
    const next = Math.max(previous, demand);
    accumulator.metric.demandTracks += next - previous;
    accumulator.netDemand.set(input.edge.netStableId, next);
  }
}

/** Deterministic star/RUDY-like cutline demand. Complexity is O(terminals × cutlines), never O(fanout²). */
export function analyzePlacementCongestion(problem: PlacementProblem, placements: Record<string, PlacementTransform>): PlacementCongestionReport {
  const cutlines = buildCutlines(problem, placements);
  const terminalById = new Map(problem.terminals.map((terminal) => [terminal.id, terminal]));
  for (const edge of problem.hyperedges) {
    if (edge.kind !== "signal" || (edge.electricalState === "proven" && edge.remainingConnections === 0)) continue;
    const points = edge.memberTerminalIds.map((id) => terminalById.get(id)).filter((terminal) => terminal !== undefined).map((terminal) => terminalWorldPosition(terminal!, placements));
    if (points.length < 2) continue;
    const center = { x: median(points.map((point) => point.x)), y: median(points.map((point) => point.y)) };
    for (const point of points) {
      const horizontalFirst = (Number.parseInt(edge.id.slice(-1), 36) + Math.abs(point.x + point.y)) % 2 === 0;
      const corner = horizontalFirst ? { x: center.x, y: point.y } : { x: point.x, y: center.y };
      if (point.x !== corner.x) addSegmentDemand({ problem, cutlines, edge, from: point, to: corner, direction: "horizontal" });
      if (point.y !== corner.y) addSegmentDemand({ problem, cutlines, edge, from: point, to: corner, direction: "vertical" });
      if (corner.x !== center.x) addSegmentDemand({ problem, cutlines, edge, from: corner, to: center, direction: "horizontal" });
      if (corner.y !== center.y) addSegmentDemand({ problem, cutlines, edge, from: corner, to: center, direction: "vertical" });
    }
  }
  const metrics = [...cutlines.values()].map(({ metric, netDemand }) => {
    const demandTracks = Math.round(metric.demandTracks * 1000) / 1000;
    const overflowTracks = Math.max(0, demandTracks - metric.capacityTracks);
    return {
      ...metric,
      demandTracks,
      overflowTracks: Math.round(overflowTracks * 1000) / 1000,
      ratio: metric.capacityTracks > 0 ? Math.round((demandTracks / metric.capacityTracks) * 1000) / 1000 : demandTracks > 0 ? 1_000_000 : 0,
      contributingNetIds: [...netDemand.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([id]) => id),
    };
  }).sort((left, right) => left.id.localeCompare(right.id));
  const hotspots = metrics.filter((metric) => metric.overflowTracks > 0).sort((left, right) => right.overflowTracks - left.overflowTracks || left.id.localeCompare(right.id));
  const criticalNetIds = [...new Set(hotspots.flatMap((metric) => metric.contributingNetIds))];
  return {
    version: PLACEMENT_METRIC_VERSION,
    cutlines: metrics,
    totalCapacityTracks: metrics.reduce((sum, metric) => sum + metric.capacityTracks, 0),
    totalDemandTracks: Math.round(metrics.reduce((sum, metric) => sum + metric.demandTracks, 0) * 1000) / 1000,
    totalOverflowTracks: Math.round(metrics.reduce((sum, metric) => sum + metric.overflowTracks, 0) * 1000) / 1000,
    maximumOverflowTracks: hotspots[0]?.overflowTracks ?? 0,
    overCapacityCutlines: hotspots.length,
    hotspots: hotspots.slice(0, 20),
    criticalNetIds,
  };
}
