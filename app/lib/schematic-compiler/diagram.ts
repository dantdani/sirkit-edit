import { schematicDigest, schematicId } from "./stable";
import type { DiagramItemPlacement, DiagramPoint, SchematicDiagramView, SchematicSemanticGraph, SchematicWireRoute } from "./types";

const GRID = 10, WIDTH = 1120, HEIGHT = 760;
function member<T extends { deterministicDigest: string }>(value: Omit<T, "deterministicDigest">): T { return { ...value, deterministicDigest: schematicDigest(value) } as T; }
const pointKey = (point: DiagramPoint) => `${point.x},${point.y}`;
function intersects(a: { start: DiagramPoint; end: DiagramPoint }, b: { start: DiagramPoint; end: DiagramPoint }): boolean {
  const av = a.start.x === a.end.x, bv = b.start.x === b.end.x;
  if (av === bv) return false;
  const v = av ? a : b, h = av ? b : a;
  return v.start.x > Math.min(h.start.x, h.end.x) && v.start.x < Math.max(h.start.x, h.end.x) && h.start.y > Math.min(v.start.y, v.end.y) && h.start.y < Math.max(v.start.y, v.end.y);
}

/** Geometry is a disposable view. This function never writes connectivity back into the graph. */
export function compileDiagramView(graph: SchematicSemanticGraph, sheetInstanceId: string, input?: { priorView?: SchematicDiagramView; maximumItems?: number }): SchematicDiagramView {
  const before = graph.deterministicDigest, sheet = graph.sheetInstances.find((item) => item.sheetInstanceId === sheetInstanceId);
  if (!sheet) throw new Error("CD8_DIAGRAM_SHEET_MISSING");
  const units = graph.units.filter((item) => item.assignedSheetInstanceId === sheetInstanceId).sort((a, b) => a.unitInstanceId.localeCompare(b.unitInstanceId));
  if (units.length > (input?.maximumItems ?? 131_072)) throw new Error("CD8_DIAGRAM_RESOURCE_LIMIT");
  const prior = new Map((input?.priorView?.placements ?? []).filter((item) => item.lockState === "locked").map((item) => [item.semanticObjectRef, item]));
  const columns = Math.max(1, Math.ceil(Math.sqrt(units.length))), spacingX = 180, spacingY = 120;
  const placements: DiagramItemPlacement[] = units.map((unit, index) => {
    const locked = prior.get(unit.unitInstanceId);
    if (locked) return member<DiagramItemPlacement>({ ...structuredClone(locked), diagramItemId: locked.diagramItemId, deterministicDigest: undefined } as never);
    return member<DiagramItemPlacement>({ diagramItemId: schematicId("diagram-item", { sheetInstanceId, unit: unit.unitInstanceId }), semanticObjectRef: unit.unitInstanceId, itemKind: "component_unit", position: { x: 80 + index % columns * spacingX, y: 80 + Math.floor(index / columns) * spacingY }, orientation: 0, width: 100, height: 70, lockState: "unlocked", placementReason: "deterministic semantic-unit ordering" });
  });
  const placementByUnit = new Map(placements.map((item) => [item.semanticObjectRef, item]));
  const anchor = (endpointId: string): DiagramPoint | undefined => {
    const endpoint = graph.endpoints.find((item) => item.endpointId === endpointId), pin = graph.pins.find((item) => item.pinInstanceId === endpoint?.pinInstanceId);
    const unitId = pin?.unitInstanceIds.find((id) => placementByUnit.has(id)), placement = unitId ? placementByUnit.get(unitId) : undefined;
    if (!placement || !pin) return undefined;
    const pins = graph.pins.filter((item) => item.unitInstanceIds.includes(unitId!)).sort((a, b) => a.pinInstanceId.localeCompare(b.pinInstanceId)), pinIndex = pins.findIndex((item) => item.pinInstanceId === pin.pinInstanceId);
    const left = pinIndex % 2 === 0;
    return { x: placement.position.x + (left ? 0 : placement.width), y: placement.position.y + GRID + Math.floor(pinIndex / 2) * GRID };
  };
  const routes: SchematicWireRoute[] = [];
  for (const net of graph.nets.filter((item) => item.lifecycleState === "active").sort((a, b) => a.netId.localeCompare(b.netId))) {
    const anchored = net.endpointIds.map((id) => ({ id, point: anchor(id) })).filter((item): item is { id: string; point: DiagramPoint } => Boolean(item.point));
    if (anchored.length < 2) continue;
    const hub = { x: Math.round(anchored.reduce((sum, item) => sum + item.point.x, 0) / anchored.length / GRID) * GRID, y: Math.round(anchored.reduce((sum, item) => sum + item.point.y, 0) / anchored.length / GRID) * GRID };
    for (const endpoint of anchored) {
      const bend = { x: hub.x, y: endpoint.point.y }, segments = pointKey(endpoint.point) === pointKey(hub) ? [] : pointKey(endpoint.point) === pointKey(bend) ? [{ start: endpoint.point, end: hub }] : [{ start: endpoint.point, end: bend }, { start: bend, end: hub }];
      routes.push(member<SchematicWireRoute>({ wireRouteId: schematicId("wire-route", { view: sheetInstanceId, net: net.netId, endpoint: endpoint.id }), sourceNetId: net.netId, endpointViewRefs: [endpoint.id], orthogonalSegments: segments.filter((segment) => pointKey(segment.start) !== pointKey(segment.end)), explicitJunctionRefs: anchored.length > 2 ? [schematicId("view-junction", { net: net.netId, hub })] : [], crossoverRefs: [], routeClass: net.railGroundDefinitionId ? "power" : "wire", ambiguityCheckState: "pass" }));
    }
  }
  let ambiguousIntersections = 0;
  for (let i = 0; i < routes.length; i++) for (let j = i + 1; j < routes.length; j++) if (routes[i].sourceNetId !== routes[j].sourceNetId && routes[i].orthogonalSegments.some((a) => routes[j].orthogonalSegments.some((b) => intersects(a, b)))) { ambiguousIntersections++; routes[i].ambiguityCheckState = "fail"; routes[j].ambiguityCheckState = "fail"; }
  for (const route of routes) route.deterministicDigest = schematicDigest({ ...route, deterministicDigest: undefined });
  let overlaps = 0; for (let i = 0; i < placements.length; i++) for (let j = i + 1; j < placements.length; j++) { const a = placements[i], b = placements[j]; if (a.position.x < b.position.x + b.width && a.position.x + a.width > b.position.x && a.position.y < b.position.y + b.height && a.position.y + a.height > b.position.y) overlaps++; }
  const seed = Number.parseInt(schematicDigest({ graph: graph.deterministicDigest, sheetInstanceId }).slice(5, 13), 16);
  const base: Omit<SchematicDiagramView, "diagramViewId" | "deterministicDigest"> = { sourceGraphRevisionId: graph.graphId, sourceGraphDigest: graph.deterministicDigest, sheetInstanceId, pageDefinition: { size: "A3", width: WIDTH, height: HEIGHT, grid: GRID }, placements, wireRoutes: routes.sort((a, b) => a.wireRouteId.localeCompare(b.wireRouteId)), layoutMetrics: { overlaps, ambiguousIntersections, crossings: ambiguousIntersections, bends: routes.reduce((sum, route) => sum + Math.max(0, route.orthogonalSegments.length - 1), 0), churnedItems: placements.filter((item) => input?.priorView && input.priorView.placements.find((old) => old.semanticObjectRef === item.semanticObjectRef)?.deterministicDigest !== item.deterministicDigest).length }, layoutEngineVersion: "sirkit-deterministic-diagram/1.0.0", deterministicSeed: seed, readabilityValidationState: overlaps || ambiguousIntersections ? "fail" : "pass" };
  if (graph.deterministicDigest !== before) throw new Error("CD8_DIAGRAM_MUTATED_SEMANTICS");
  const withId = { ...base, diagramViewId: schematicId("diagram-view", { graph: graph.deterministicDigest, sheetInstanceId }) };
  return { ...withId, deterministicDigest: schematicDigest(withId) };
}
