import type { BBox, Vec2 } from "../geometry";
import { shapeBBox } from "../geometry";
import { padCopperLayers, padWorldPosition, padWorldShape } from "../geometry-copper";
import { getNetClass } from "../netclass";
import { getBoardStackup } from "../stackup";
import { mmToNm } from "../units";
import { outlineBBox, pointInOutline } from "../autoplace/geometry";
import { boardWithPlacement, instanceWorldBounds, median, terminalWorldPosition } from "./geometry";
import type {
  PlacementPinEscapeMetric,
  PlacementPinEscapeReport,
  PlacementProblem,
  PlacementTransform,
  PlacementViaPressureCell,
  PlacementViaPressureReport,
} from "./types";
import { PLACEMENT_METRIC_VERSION } from "./types";

const DIRECTIONS: ReadonlyArray<Vec2> = [
  { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
  { x: 0.70710678, y: 0.70710678 }, { x: -0.70710678, y: 0.70710678 },
  { x: 0.70710678, y: -0.70710678 }, { x: -0.70710678, y: -0.70710678 },
];

function boxesOverlap(left: BBox, right: BBox): boolean {
  return left.minX < right.maxX && left.maxX > right.minX && left.minY < right.maxY && left.maxY > right.minY;
}

function corridorBox(from: Vec2, to: Vec2, halfWidth: number): BBox {
  return {
    minX: Math.min(from.x, to.x) - halfWidth,
    minY: Math.min(from.y, to.y) - halfWidth,
    maxX: Math.max(from.x, to.x) + halfWidth,
    maxY: Math.max(from.y, to.y) + halfWidth,
  };
}

function polygonBounds(points: Vec2[]): BBox {
  return {
    minX: Math.min(...points.map((point) => point.x)), minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)), maxY: Math.max(...points.map((point) => point.y)),
  };
}

export function analyzePlacementPinEscape(problem: PlacementProblem, placements: Record<string, PlacementTransform>): PlacementPinEscapeReport {
  const board = boardWithPlacement(problem, placements);
  const edges = new Map(problem.hyperedges.map((edge) => [edge.netStableId, edge]));
  const metrics: PlacementPinEscapeMetric[] = [];
  for (const terminal of problem.terminals) {
    const footprint = board.footprints.find((candidate) => candidate.id === terminal.componentId);
    const edge = edges.get(terminal.netStableId);
    if (!footprint || !edge) continue;
    const pads = footprint.def.pads.filter((pad) => terminal.padNumbers.includes(pad.number));
    if (pads.length === 0) {
      metrics.push({ terminalId: terminal.id, componentId: terminal.componentId, netStableId: terminal.netStableId, attemptedDirections: 0, feasibleDirections: 0, viaLandingOptions: 0, state: "unknown", reasons: ["mapped_pad_geometry_missing"] });
      continue;
    }
    let feasibleDirections = 0;
    let viaLandingOptions = 0;
    const reasons = new Set<string>();
    const rules = getNetClass(board, terminal.netId);
    const routeHalfWidth = rules.trackWidth / 2 + rules.clearance;
    const escapeLength = Math.max(mmToNm(1.25), rules.viaSize + rules.clearance * 2);
    const allowedLayers = new Set(edge.allowedLayerIds);
    for (const pad of pads) {
      const at = padWorldPosition(footprint, pad);
      const padLayers = padCopperLayers(footprint, pad).filter((layer) => allowedLayers.has(layer));
      if (padLayers.length === 0) {
        reasons.add("pad_has_no_allowed_routing_layer");
        continue;
      }
      const neighborPads = footprint.def.pads.filter((candidate) => candidate !== pad).map((candidate) => shapeBBox(padWorldShape(footprint, candidate)));
      for (const direction of DIRECTIONS) {
        const to = { x: Math.round(at.x + direction.x * escapeLength), y: Math.round(at.y + direction.y * escapeLength) };
        if (!pointInOutline(to, board.outline)) {
          reasons.add("escape_leaves_board");
          continue;
        }
        const corridor = corridorBox(at, to, routeHalfWidth);
        const componentBlocked = problem.instances.some((instance) => instance.id !== terminal.componentId && boxesOverlap(corridor, instanceWorldBounds(problem, instance.id, placements)));
        const neighborBlocked = neighborPads.some((box) => boxesOverlap(corridor, box));
        const keepoutBlocked = (board.routingKeepouts ?? []).some((keepout) => keepout.forbidTracks && keepout.layers.some((layer) => padLayers.includes(layer)) && boxesOverlap(corridor, polygonBounds(keepout.polygon)));
        if (componentBlocked || neighborBlocked || keepoutBlocked) {
          reasons.add(componentBlocked ? "component_obstacle" : neighborBlocked ? "neighbor_pad_obstacle" : "routing_keepout");
          continue;
        }
        feasibleDirections += 1;
        const viaRadius = rules.viaSize / 2 + rules.clearance;
        const viaBox = { minX: to.x - viaRadius, minY: to.y - viaRadius, maxX: to.x + viaRadius, maxY: to.y + viaRadius };
        const landingBlocked = problem.instances.some((instance) => instance.id !== terminal.componentId && boxesOverlap(viaBox, instanceWorldBounds(problem, instance.id, placements))) || (board.routingKeepouts ?? []).some((keepout) => keepout.forbidVias && boxesOverlap(viaBox, polygonBounds(keepout.polygon)));
        if (!landingBlocked && pointInOutline(to, board.outline)) viaLandingOptions += 1;
      }
    }
    metrics.push({
      terminalId: terminal.id,
      componentId: terminal.componentId,
      netStableId: terminal.netStableId,
      attemptedDirections: pads.length * DIRECTIONS.length,
      feasibleDirections,
      viaLandingOptions,
      state: feasibleDirections > 0 ? "pass" : "deficit",
      reasons: [...reasons].sort(),
    });
  }
  const byComponent = new Map<string, PlacementPinEscapeMetric[]>();
  for (const metric of metrics.filter((item) => item.state === "deficit")) byComponent.set(metric.componentId, [...(byComponent.get(metric.componentId) ?? []), metric]);
  return {
    version: PLACEMENT_METRIC_VERSION,
    terminals: metrics.sort((left, right) => left.terminalId.localeCompare(right.terminalId)),
    deficits: metrics.filter((metric) => metric.state === "deficit").length,
    unknown: metrics.filter((metric) => metric.state === "unknown").length,
    hotspots: [...byComponent.entries()].map(([componentId, items]) => ({ componentId, deficits: items.length, terminalIds: items.map((item) => item.terminalId).sort() })).sort((left, right) => right.deficits - left.deficits || left.componentId.localeCompare(right.componentId)),
  };
}

function cellFor(problem: PlacementProblem, point: Vec2): { column: number; row: number; id: string } {
  const { outlineBounds, columns, rows, gridCellWidthNm, gridCellHeightNm } = problem.capacityPolicy;
  const column = Math.max(0, Math.min(columns - 1, Math.floor((point.x - outlineBounds.minX) / gridCellWidthNm)));
  const row = Math.max(0, Math.min(rows - 1, Math.floor((point.y - outlineBounds.minY) / gridCellHeightNm)));
  return { column, row, id: `via-pressure:${column}:${row}` };
}

export function analyzePlacementViaPressure(problem: PlacementProblem, placements: Record<string, PlacementTransform>): PlacementViaPressureReport {
  const cells = new Map<string, { column: number; row: number; demand: number; netStableIds: Set<string>; unsupported: boolean }>();
  const terminalById = new Map(problem.terminals.map((terminal) => [terminal.id, terminal]));
  const stackup = getBoardStackup(problem.board);
  for (const edge of problem.hyperedges) {
    const physical = problem.program.lowerings.physicalByTarget[edge.netStableId];
    const viaTypeUnsupported = physical?.allowedViaTypes && !physical.allowedViaTypes.includes("through");
    const points = edge.memberTerminalIds.map((id) => terminalById.get(id)).filter((terminal) => terminal !== undefined).map((terminal) => ({ terminal: terminal!, point: terminalWorldPosition(terminal!, placements) }));
    if (points.length === 0) continue;
    const center = { x: median(points.map((item) => item.point.x)), y: median(points.map((item) => item.point.y)) };
    for (const item of points) {
      const access = new Set(item.terminal.accessLayers);
      const planeLayers = stackup.copperLayers.filter((layer) => layer.role === "plane" && layer.planeNetId === edge.netId).map((layer) => layer.id);
      const directionTransition = edge.kind === "signal" && edge.allowedLayerIds.length > 1 && item.point.x !== center.x && item.point.y !== center.y;
      const planeTransition = edge.kind === "plane_access" && planeLayers.some((layer) => !access.has(layer));
      if (!directionTransition && !planeTransition) continue;
      const cell = cellFor(problem, directionTransition ? { x: Math.round((item.point.x + center.x) / 2), y: Math.round((item.point.y + center.y) / 2) } : item.point);
      const current = cells.get(cell.id) ?? { column: cell.column, row: cell.row, demand: 0, netStableIds: new Set<string>(), unsupported: false };
      current.demand += 1;
      current.netStableIds.add(edge.netStableId);
      current.unsupported ||= Boolean(viaTypeUnsupported) || !stackup.routing.viasAllowed;
      cells.set(cell.id, current);
    }
  }
  const boardBounds = outlineBBox(problem.board.outline);
  const cellArea = ((boardBounds.maxX - boardBounds.minX) / problem.capacityPolicy.columns) * ((boardBounds.maxY - boardBounds.minY) / problem.capacityPolicy.rows);
  const occupied = new Map<string, number>();
  for (const instance of problem.instances) {
    const cell = cellFor(problem, placements[instance.id].position);
    const box = instanceWorldBounds(problem, instance.id, placements);
    occupied.set(cell.id, (occupied.get(cell.id) ?? 0) + Math.max(0, (box.maxX - box.minX) * (box.maxY - box.minY)));
  }
  const metrics: PlacementViaPressureCell[] = [];
  for (let row = 0; row < problem.capacityPolicy.rows; row += 1) for (let column = 0; column < problem.capacityPolicy.columns; column += 1) {
    const id = `via-pressure:${column}:${row}`;
    const current = cells.get(id);
    const freeFraction = Math.max(0.02, 1 - (occupied.get(id) ?? 0) / Math.max(1, cellArea));
    const landingCapacity = Math.max(1, Math.floor(freeFraction * 16));
    const demand = current?.demand ?? 0;
    metrics.push({
      id,
      column,
      row,
      demand,
      landingCapacity,
      pressure: Math.round((demand / landingCapacity) * 1000) / 1000,
      netStableIds: [...(current?.netStableIds ?? [])].sort(),
      state: current?.unsupported ? "unsupported" : "estimated",
    });
  }
  const hotspots = metrics.filter((cell) => cell.demand > 0).sort((left, right) => right.pressure - left.pressure || left.id.localeCompare(right.id)).slice(0, 20);
  return {
    version: PLACEMENT_METRIC_VERSION,
    totalDemand: metrics.reduce((sum, cell) => sum + cell.demand, 0),
    maximumPressure: hotspots[0]?.pressure ?? 0,
    cells: metrics,
    hotspots,
  };
}
