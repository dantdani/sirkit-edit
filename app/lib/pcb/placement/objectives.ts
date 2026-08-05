import { quantityToInteger } from "@/app/lib/constraints/quantity";
import type { EffectiveConstraintRule } from "@/app/lib/constraints/types";
import { outlineBBox } from "../autoplace/geometry";
import { terminalWorldPosition } from "./geometry";
import type {
  PlacementCongestionReport,
  PlacementObjectiveKind,
  PlacementObjectiveMetric,
  PlacementObjectivePolicy,
  PlacementObjectiveReport,
  PlacementPinEscapeReport,
  PlacementProblem,
  PlacementTransform,
  PlacementViaPressureReport,
} from "./types";
import { PLACEMENT_METRIC_VERSION } from "./types";
import { placementStableId } from "./stable";

export const DEFAULT_PLACEMENT_OBJECTIVE_POLICY: PlacementObjectivePolicy = {
  priorities: ["routing_congestion", "pin_escape", "wirelength", "via_pressure", "critical_loop", "decoupling", "placement_stability"],
  weights: {
    wirelength: 1,
    routing_congestion: 2,
    pin_escape: 2,
    via_pressure: 1,
    decoupling: 1.5,
    critical_loop: 1.5,
    plane_return_access: 1,
    high_speed_ordering: 1,
    sensitive_separation: 1,
    thermal_intent: 1,
    mechanical_edge: 1,
    assembly_test: 0.5,
    placement_stability: 1,
  },
};

function metric(input: Omit<PlacementObjectiveMetric, "id" | "version" | "weight" | "weightedPenalty"> & { weight: number }): PlacementObjectiveMetric {
  return {
    ...input,
    id: placementStableId("placement-objective", { kind: input.kind, objectIds: input.objectIds, constraintIds: input.constraintIds }),
    version: `${PLACEMENT_METRIC_VERSION}/${input.kind}`,
    weightedPenalty: input.normalizedPenalty === null ? null : input.normalizedPenalty * input.weight,
  };
}

function boardDiagonal(problem: PlacementProblem): number {
  const bounds = outlineBBox(problem.board.outline);
  return Math.max(1, Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY));
}

function wirelength(problem: PlacementProblem, placements: Record<string, PlacementTransform>, weight: number): PlacementObjectiveMetric {
  const terminals = new Map(problem.terminals.map((terminal) => [terminal.id, terminal]));
  let hpwlNm = 0;
  let edges = 0;
  for (const edge of problem.hyperedges.filter((candidate) => candidate.kind === "signal")) {
    const points = edge.memberTerminalIds.map((id) => terminals.get(id)).filter((terminal) => terminal !== undefined).map((terminal) => terminalWorldPosition(terminal!, placements));
    if (points.length < 2) continue;
    hpwlNm += (Math.max(...points.map((point) => point.x)) - Math.min(...points.map((point) => point.x)) + Math.max(...points.map((point) => point.y)) - Math.min(...points.map((point) => point.y))) * edge.weight;
    edges += 1;
  }
  const denominator = boardDiagonal(problem) * Math.max(1, edges);
  return metric({ kind: "wirelength", state: edges > 0 ? "evaluated" : "not_applicable", rawValue: hpwlNm, rawUnit: "nm_weighted_hpwl", normalization: { kind: "board_diagonal", denominator }, normalizedPenalty: edges > 0 ? hpwlNm / denominator : 0, weight, constraintIds: [...new Set(problem.hyperedges.flatMap((edge) => edge.constraintIds))].sort(), evidenceIds: [], objectIds: problem.hyperedges.map((edge) => edge.id), explanation: "Pin-aware weighted HPWL; plane-connected nets are excluded from ordinary signal wirelength.", limitations: ["HPWL is a placement proxy, not routed length."] });
}

function relationDistance(problem: PlacementProblem, placements: Record<string, PlacementTransform>, kind: "decoupling" | "current_loop"): { value: number; count: number; constraintIds: string[]; evidenceIds: string[]; objectIds: string[] } {
  let value = 0;
  let count = 0;
  const constraintIds: string[] = [];
  const evidenceIds: string[] = [];
  const objectIds: string[] = [];
  for (const relation of problem.relationships.filter((candidate) => candidate.kind === kind)) {
    const ids = relation.members.map((member) => member.targetId.replace(/^(component|footprint):/, "")).filter((id) => placements[id]);
    if (ids.length < 2) continue;
    objectIds.push(relation.id, ...ids);
    constraintIds.push(...relation.constraintIds);
    evidenceIds.push(...relation.evidenceIds);
    if (kind === "decoupling") {
      let closest = Number.POSITIVE_INFINITY;
      const terminalSets = ids.map((id) => problem.terminals.filter((terminal) => terminal.componentId === id));
      for (const left of terminalSets[0]) for (const right of terminalSets.slice(1).flat()) {
        if (left.netStableId !== right.netStableId) continue;
        const a = terminalWorldPosition(left, placements);
        const b = terminalWorldPosition(right, placements);
        closest = Math.min(closest, Math.hypot(a.x - b.x, a.y - b.y));
      }
      if (Number.isFinite(closest)) {
        value += closest;
        count += 1;
      }
    } else {
      const points = ids.map((id) => placements[id].position);
      for (let index = 0; index < points.length; index += 1) value += Math.hypot(points[index].x - points[(index + 1) % points.length].x, points[index].y - points[(index + 1) % points.length].y);
      count += 1;
    }
  }
  return { value, count, constraintIds: [...new Set(constraintIds)].sort(), evidenceIds: [...new Set(evidenceIds)].sort(), objectIds: [...new Set(objectIds)].sort() };
}

function distanceRequirement(problem: PlacementProblem, kind: "placement_separation" | "placement_proximity"): EffectiveConstraintRule[] {
  return [...problem.hardRules, ...problem.softRules].filter((rule) => rule.kind === kind && rule.requirement.form === "distance");
}

function sourcedSeparation(problem: PlacementProblem, placements: Record<string, PlacementTransform>, kind: "sensitive_separation" | "thermal_intent", weight: number): PlacementObjectiveMetric {
  const rules = distanceRequirement(problem, "placement_separation");
  if (rules.length === 0) return metric({ kind, state: "unknown", rawValue: null, rawUnit: "nm", normalization: { kind: "ratio_to_target", denominator: 1 }, normalizedPenalty: null, weight, constraintIds: [], evidenceIds: [], objectIds: [], explanation: "No source-backed separation distance exists; Stage 7 did not invent one.", limitations: [kind === "thermal_intent" ? "No thermal signoff is inferred." : "No EMI/RF signoff is inferred."] });
  let penalty = 0;
  let actualTotal = 0;
  for (const rule of rules) {
    if (rule.requirement.form !== "distance") continue;
    const id = rule.targetId.replace(/^(component|footprint):/, "");
    const at = placements[id]?.position;
    const refs = rule.requirement.referenceIds.map((reference) => placements[reference.replace(/^(component|footprint):/, "")]?.position).filter((point) => point !== undefined);
    if (!at || refs.length === 0) continue;
    const actual = Math.min(...refs.map((point) => Math.hypot(point!.x - at.x, point!.y - at.y)));
    const target = quantityToInteger(rule.requirement.value, "length");
    actualTotal += actual;
    penalty += rule.requirement.relation === "minimum" ? Math.max(0, (target - actual) / Math.max(1, target)) : Math.max(0, (actual - target) / Math.max(1, target));
  }
  return metric({ kind, state: "evaluated", rawValue: actualTotal, rawUnit: "nm_total", normalization: { kind: "ratio_to_target", denominator: Math.max(1, rules.length) }, normalizedPenalty: penalty / Math.max(1, rules.length), weight, constraintIds: [...new Set(rules.flatMap((rule) => rule.contributingConstraintIds))].sort(), evidenceIds: [...new Set(rules.flatMap((rule) => rule.evidenceIds))].sort(), objectIds: rules.map((rule) => rule.targetId), explanation: "Source-backed separation/proximity distances only.", limitations: [kind === "thermal_intent" ? "Geometric thermal proxy only." : "Geometric isolation proxy only."] });
}

export function evaluatePlacementObjectives(input: {
  problem: PlacementProblem;
  placements: Record<string, PlacementTransform>;
  congestion: PlacementCongestionReport;
  pinEscape: PlacementPinEscapeReport;
  viaPressure: PlacementViaPressureReport;
  policy?: PlacementObjectivePolicy;
}): PlacementObjectiveReport {
  const policy = input.policy ?? DEFAULT_PLACEMENT_OBJECTIVE_POLICY;
  const weight = (kind: PlacementObjectiveKind) => policy.weights[kind] ?? 0;
  const metrics: PlacementObjectiveMetric[] = [wirelength(input.problem, input.placements, weight("wirelength"))];
  metrics.push(metric({ kind: "routing_congestion", state: "evaluated", rawValue: input.congestion.totalOverflowTracks, rawUnit: "overflow_tracks", normalization: { kind: "capacity_ratio", denominator: Math.max(1, input.congestion.totalCapacityTracks) }, normalizedPenalty: input.congestion.totalOverflowTracks / Math.max(1, input.congestion.totalCapacityTracks), weight: weight("routing_congestion"), constraintIds: [...new Set(input.problem.hyperedges.flatMap((edge) => edge.constraintIds))].sort(), evidenceIds: [], objectIds: input.congestion.hotspots.map((hotspot) => hotspot.id), explanation: "Sum of per-layer/direction cutline demand beyond physically estimated capacity.", limitations: ["Coarse estimator; not routing completion."] }));
  metrics.push(metric({ kind: "pin_escape", state: input.pinEscape.unknown > 0 ? "unknown" : "evaluated", rawValue: input.pinEscape.deficits, rawUnit: "terminal_deficits", normalization: { kind: "fraction", denominator: Math.max(1, input.pinEscape.terminals.length) }, normalizedPenalty: input.pinEscape.unknown > 0 ? null : input.pinEscape.deficits / Math.max(1, input.pinEscape.terminals.length), weight: weight("pin_escape"), constraintIds: [], evidenceIds: [], objectIds: input.pinEscape.hotspots.map((hotspot) => hotspot.componentId), explanation: "Eight-direction, pad/layer/obstacle-aware escape feasibility.", limitations: ["Escape feasibility is not a detailed routed fanout."] }));
  metrics.push(metric({ kind: "via_pressure", state: input.viaPressure.cells.some((cell) => cell.state === "unsupported") ? "unsupported" : "evaluated", rawValue: input.viaPressure.maximumPressure, rawUnit: "demand_per_landing_capacity", normalization: { kind: "capacity_ratio", denominator: 1 }, normalizedPenalty: input.viaPressure.cells.some((cell) => cell.state === "unsupported") ? null : input.viaPressure.maximumPressure, weight: weight("via_pressure"), constraintIds: [], evidenceIds: [], objectIds: input.viaPressure.hotspots.map((cell) => cell.id), explanation: "Spatial transition/plane-access demand divided by estimated landing capacity.", limitations: ["Via pressure is not a via-count or routed proof."] }));
  const decoupling = relationDistance(input.problem, input.placements, "decoupling");
  metrics.push(metric({ kind: "decoupling", state: decoupling.count > 0 ? "evaluated" : input.problem.relationships.some((relation) => relation.kind === "decoupling") ? "unknown" : "not_applicable", rawValue: decoupling.count > 0 ? decoupling.value : null, rawUnit: "nm_terminal_distance", normalization: { kind: "board_diagonal", denominator: boardDiagonal(input.problem) * Math.max(1, decoupling.count) }, normalizedPenalty: decoupling.count > 0 ? decoupling.value / (boardDiagonal(input.problem) * decoupling.count) : null, weight: weight("decoupling"), constraintIds: decoupling.constraintIds, evidenceIds: decoupling.evidenceIds, objectIds: decoupling.objectIds, explanation: "Closest same-rail exact terminal distance for explicit decoupling relationships.", limitations: ["Proximity does not prove electrical decoupling performance."] }));
  const loop = relationDistance(input.problem, input.placements, "current_loop");
  metrics.push(metric({ kind: "critical_loop", state: loop.count > 0 ? "evaluated" : input.problem.relationships.some((relation) => relation.kind === "current_loop") ? "unknown" : "not_applicable", rawValue: loop.count > 0 ? loop.value : null, rawUnit: "nm_loop_perimeter", normalization: { kind: "board_diagonal", denominator: boardDiagonal(input.problem) * Math.max(1, loop.count) }, normalizedPenalty: loop.count > 0 ? loop.value / (boardDiagonal(input.problem) * loop.count) : null, weight: weight("critical_loop"), constraintIds: loop.constraintIds, evidenceIds: loop.evidenceIds, objectIds: loop.objectIds, explanation: "Perimeter proxy for explicit current-loop members.", limitations: ["Not EMI, current-capacity, or PI proof."] }));
  const planeEdges = input.problem.hyperedges.filter((edge) => edge.kind === "plane_access");
  metrics.push(metric({ kind: "plane_return_access", state: planeEdges.length > 0 ? input.viaPressure.cells.some((cell) => cell.state === "unsupported") ? "unsupported" : "evaluated" : "not_applicable", rawValue: planeEdges.length > 0 ? input.viaPressure.totalDemand : null, rawUnit: "estimated_access_transitions", normalization: { kind: "fraction", denominator: Math.max(1, planeEdges.reduce((sum, edge) => sum + edge.memberTerminalIds.length, 0)) }, normalizedPenalty: planeEdges.length > 0 ? input.viaPressure.totalDemand / Math.max(1, planeEdges.reduce((sum, edge) => sum + edge.memberTerminalIds.length, 0)) : 0, weight: weight("plane_return_access"), constraintIds: [...new Set(planeEdges.flatMap((edge) => edge.constraintIds))].sort(), evidenceIds: [], objectIds: planeEdges.map((edge) => edge.id), explanation: "Access-transition demand for nets with a current native plane/fill.", limitations: ["Dirty or absent plane geometry is never treated as access."] }));
  metrics.push(sourcedSeparation(input.problem, input.placements, "sensitive_separation", weight("sensitive_separation")));
  metrics.push(sourcedSeparation(input.problem, input.placements, "thermal_intent", weight("thermal_intent")));
  const terminalById = new Map(input.problem.terminals.map((terminal) => [terminal.id, terminal]));
  let highSpeedRaw = 0;
  let highSpeedCount = 0;
  const highSpeedRelations = input.problem.relationships.filter((relation) => relation.kind === "differential_pair" || relation.kind === "termination");
  for (const relation of highSpeedRelations) {
    if (relation.kind === "differential_pair") {
      const spans = relation.members.map((member) => input.problem.hyperedges.find((edge) => edge.netStableId === member.targetId)).filter((edge) => edge !== undefined).map((edge) => {
        const points = edge!.memberTerminalIds.map((id) => terminalById.get(id)).filter((terminal) => terminal !== undefined).map((terminal) => terminalWorldPosition(terminal!, input.placements));
        return points.length < 2 ? undefined : Math.max(...points.map((point) => point.x)) - Math.min(...points.map((point) => point.x)) + Math.max(...points.map((point) => point.y)) - Math.min(...points.map((point) => point.y));
      }).filter((span): span is number => span !== undefined);
      if (spans.length === 2) {
        highSpeedRaw += Math.abs(spans[0] - spans[1]);
        highSpeedCount += 1;
      }
    } else {
      const points = [...relation.members].sort((left, right) => (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER) || left.role.localeCompare(right.role)).map((member) => input.placements[member.targetId.replace(/^(component|footprint):/, "")]?.position).filter((point) => point !== undefined);
      if (points.length >= 2) {
        for (let index = 1; index < points.length; index += 1) highSpeedRaw += Math.hypot(points[index]!.x - points[index - 1]!.x, points[index]!.y - points[index - 1]!.y);
        highSpeedCount += 1;
      }
    }
  }
  metrics.push(metric({ kind: "high_speed_ordering", state: highSpeedCount > 0 ? "evaluated" : highSpeedRelations.length > 0 ? "unknown" : "not_applicable", rawValue: highSpeedCount > 0 ? highSpeedRaw : null, rawUnit: "nm_pair_span_mismatch_or_chain", normalization: { kind: "board_diagonal", denominator: boardDiagonal(input.problem) * Math.max(1, highSpeedCount) }, normalizedPenalty: highSpeedCount > 0 ? highSpeedRaw / (boardDiagonal(input.problem) * highSpeedCount) : null, weight: weight("high_speed_ordering"), constraintIds: [...new Set(highSpeedRelations.flatMap((relation) => relation.constraintIds))].sort(), evidenceIds: [...new Set(highSpeedRelations.flatMap((relation) => relation.evidenceIds))].sort(), objectIds: highSpeedRelations.map((relation) => relation.id), explanation: "Differential endpoint-span symmetry and explicit termination-chain distance feasibility proxy.", limitations: ["Stage 8 must route and verify actual length/skew/impedance."] }));
  const outline = outlineBBox(input.problem.board.outline);
  const edgeInstances = input.problem.instances.filter((instance) => input.problem.board.footprints.find((footprint) => footprint.id === instance.id)?.placementConstraints?.edgeConnector);
  const edgeGap = edgeInstances.reduce((sum, instance) => {
    const edge = input.problem.board.footprints.find((footprint) => footprint.id === instance.id)!.placementConstraints!.edgeConnector!;
    const bounds = input.placements[instance.id].position;
    return sum + (edge === "left" ? Math.abs(bounds.x - outline.minX) : edge === "right" ? Math.abs(outline.maxX - bounds.x) : edge === "top" ? Math.abs(bounds.y - outline.minY) : Math.abs(outline.maxY - bounds.y));
  }, 0);
  metrics.push(metric({ kind: "mechanical_edge", state: edgeInstances.length > 0 ? "evaluated" : "not_applicable", rawValue: edgeInstances.length > 0 ? edgeGap : null, rawUnit: "nm_origin_edge_distance", normalization: { kind: "board_diagonal", denominator: boardDiagonal(input.problem) * Math.max(1, edgeInstances.length) }, normalizedPenalty: edgeInstances.length > 0 ? edgeGap / (boardDiagonal(input.problem) * edgeInstances.length) : 0, weight: weight("mechanical_edge"), constraintIds: [...new Set(edgeInstances.flatMap((instance) => instance.constraintIds))].sort(), evidenceIds: [], objectIds: edgeInstances.map((instance) => instance.id), explanation: "Explicit connector-edge relationship distance; exact envelope legality is enforced separately.", limitations: ["Enclosure alignment beyond represented board-edge geometry is not inferred."] }));
  const moved = input.problem.instances.filter((instance) => {
    const placement = input.placements[instance.id];
    return placement && (placement.position.x !== instance.sourcePosition.x || placement.position.y !== instance.sourcePosition.y || placement.rotationDeg !== instance.sourceRotationDeg || placement.side !== instance.sourceSide);
  });
  const totalDisplacement = moved.reduce((sum, instance) => sum + Math.hypot(input.placements[instance.id].position.x - instance.sourcePosition.x, input.placements[instance.id].position.y - instance.sourcePosition.y), 0);
  metrics.push(metric({ kind: "placement_stability", state: "evaluated", rawValue: totalDisplacement, rawUnit: "nm_total_displacement", normalization: { kind: "board_diagonal", denominator: boardDiagonal(input.problem) * Math.max(1, input.problem.instances.length) }, normalizedPenalty: totalDisplacement / (boardDiagonal(input.problem) * Math.max(1, input.problem.instances.length)), weight: weight("placement_stability"), constraintIds: [], evidenceIds: [], objectIds: moved.map((instance) => instance.id), explanation: "Total displacement normalized by board diagonal and instance count.", limitations: [] }));
  const testRelations = input.problem.relationships.filter((relation) => relation.kind === "test_point_coverage" || relation.kind === "connector_edge");
  metrics.push(metric({ kind: "assembly_test", state: testRelations.length > 0 ? "unknown" : "not_applicable", rawValue: null, rawUnit: "none", normalization: { kind: "fraction", denominator: Math.max(1, testRelations.length) }, normalizedPenalty: null, weight: weight("assembly_test"), constraintIds: [...new Set(testRelations.flatMap((relation) => relation.constraintIds))].sort(), evidenceIds: [...new Set(testRelations.flatMap((relation) => relation.evidenceIds))].sort(), objectIds: testRelations.map((relation) => relation.id), explanation: testRelations.length > 0 ? "Assembly/test relationships are preserved but fixture accessibility has no proven geometric checker." : "No assembly/test relationship applies.", limitations: ["Unknown is not converted to zero penalty or pass."] }));
  const ordered = metrics.sort((left, right) => left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id));
  return {
    version: PLACEMENT_METRIC_VERSION,
    objectives: ordered,
    evaluatedWeightedPenalty: ordered.reduce((sum, objective) => sum + (objective.weightedPenalty ?? 0), 0),
    unknownObjectiveIds: ordered.filter((objective) => objective.state === "unknown").map((objective) => objective.id),
    unsupportedObjectiveIds: ordered.filter((objective) => objective.state === "unsupported").map((objective) => objective.id),
  };
}
