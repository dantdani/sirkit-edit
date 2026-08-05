import { quantityToInteger } from "@/app/lib/constraints/quantity";
import type { EffectiveConstraintRule } from "@/app/lib/constraints/types";
import { bboxFitsPolygon, bboxIntersectsPolygon, bboxesOverlap, courtyardFitsOutline, outlineBBox, pointInOutline } from "../autoplace/geometry";
import { padWorldPosition } from "../geometry-copper";
import { boardConstraintTargetRevision } from "@/app/lib/constraints/board-model";
import { boardWithPlacement, instanceWorldBounds } from "./geometry";
import { placementStableId } from "./stable";
import type { PlacementHardReport, PlacementHardViolation, PlacementProblem, PlacementTransform } from "./types";
import { PLACEMENT_VALIDATOR_VERSION } from "./types";

function violation(input: Omit<PlacementHardViolation, "id">): PlacementHardViolation {
  return { ...input, id: placementStableId("placement-hard", input), objectIds: [...input.objectIds].sort(), constraintIds: [...input.constraintIds].sort() };
}

function componentId(targetId: string): string | undefined {
  if (targetId.startsWith("component:")) return targetId.slice("component:".length);
  if (targetId.startsWith("footprint:")) return targetId.slice("footprint:".length);
  return undefined;
}

function referencePosition(problem: PlacementProblem, id: string, placements: Record<string, PlacementTransform>): { x: number; y: number } | undefined {
  const component = componentId(id);
  if (component && placements[component]) return placements[component].position;
  if (placements[id]) return placements[id].position;
  const region = problem.regions.find((candidate) => candidate.id === id);
  if (region) return {
    x: Math.round(region.polygon.reduce((sum, point) => sum + point.x, 0) / region.polygon.length),
    y: Math.round(region.polygon.reduce((sum, point) => sum + point.y, 0) / region.polygon.length),
  };
  return undefined;
}

function validateDistanceRule(problem: PlacementProblem, rule: EffectiveConstraintRule, placements: Record<string, PlacementTransform>): PlacementHardViolation[] {
  const id = componentId(rule.targetId);
  const target = id ? placements[id]?.position : undefined;
  if (!id || !target || rule.requirement.form !== "distance") return [violation({ code: "HARD_PLACEMENT_RELATION_UNSUPPORTED", state: "unsupported", message: `Hard ${rule.kind} does not have a supported distance form and cannot be treated as passed.`, objectIds: [rule.targetId], constraintIds: rule.contributingConstraintIds })];
  const references = rule.requirement.referenceIds.map((referenceId) => referencePosition(problem, referenceId, placements));
  if (references.some((position) => position === undefined)) return [violation({ code: "HARD_PLACEMENT_REFERENCE_UNKNOWN", state: "unknown", message: `A reference for hard ${rule.kind} is missing exact geometry.`, objectIds: [rule.targetId, ...rule.requirement.referenceIds], constraintIds: rule.contributingConstraintIds })];
  const actual = Math.min(...references.map((position) => Math.hypot(target.x - position!.x, target.y - position!.y)));
  const required = quantityToInteger(rule.requirement.value, "length");
  const pass = rule.requirement.relation === "minimum" ? actual >= required : actual <= required;
  return pass ? [] : [violation({ code: "HARD_PLACEMENT_DISTANCE_VIOLATION", state: "fail", message: `${rule.kind} distance is ${Math.round(actual)} nm; required ${rule.requirement.relation} is ${required} nm.`, objectIds: [id, ...rule.requirement.referenceIds], constraintIds: rule.contributingConstraintIds })];
}

export function validatePlacementCandidate(problem: PlacementProblem, placements: Record<string, PlacementTransform>): PlacementHardReport {
  const violations: PlacementHardViolation[] = [];
  if (problem.program.programHash !== problem.constraintProgramHash || problem.program.designRevision !== problem.constraintDesignRevision) violations.push(violation({ code: "PLACEMENT_PROGRAM_STALE", state: "stale", message: "Candidate problem/program identity is internally inconsistent.", objectIds: [], constraintIds: [] }));
  if (problem.program.designRevision !== boardConstraintTargetRevision(problem.board, problem.projectId)) violations.push(violation({ code: "PLACEMENT_TARGETS_STALE", state: "stale", message: "Candidate target hierarchy no longer matches the compiled constraint program.", objectIds: [], constraintIds: [] }));
  for (const instance of problem.instances) {
    const placement = placements[instance.id];
    if (!placement) {
      violations.push(violation({ code: "PLACEMENT_TRANSFORM_MISSING", state: "fail", message: `Candidate omitted ${instance.id}.`, objectIds: [instance.id], constraintIds: instance.constraintIds }));
      continue;
    }
    if (!instance.movable && (placement.position.x !== instance.sourcePosition.x || placement.position.y !== instance.sourcePosition.y || placement.rotationDeg !== instance.sourceRotationDeg || placement.side !== instance.sourceSide)) violations.push(violation({ code: "PROTECTED_INSTANCE_MOVED", state: "fail", message: `${instance.id} moved despite fixed/protected policy: ${instance.fixedReasons.join(", ")}.`, objectIds: [instance.id, ...instance.copper.protectedTrackIds, ...instance.copper.protectedViaIds], constraintIds: instance.constraintIds }));
    if (!instance.allowedRotations.includes(placement.rotationDeg)) violations.push(violation({ code: "PLACEMENT_ROTATION_NOT_ALLOWED", state: "fail", message: `${instance.id} rotation ${placement.rotationDeg} is not allowed.`, objectIds: [instance.id], constraintIds: instance.constraintIds }));
    if (!instance.allowedSides.includes(placement.side)) violations.push(violation({ code: "PLACEMENT_SIDE_NOT_ALLOWED", state: "fail", message: `${instance.id} side ${placement.side} is not allowed.`, objectIds: [instance.id], constraintIds: instance.constraintIds }));
    const bounds = instanceWorldBounds(problem, instance.id, placements);
    for (const regionId of instance.allowedRegionIds) {
      const region = problem.regions.find((candidate) => candidate.id === regionId);
      if (!region) violations.push(violation({ code: "PLACEMENT_REGION_UNKNOWN", state: "unknown", message: `Required region ${regionId} has no exact geometry.`, objectIds: [instance.id, regionId], constraintIds: instance.constraintIds }));
      else if (!bboxFitsPolygon(bounds, region.polygon)) violations.push(violation({ code: "PLACEMENT_REGION_CONTAINMENT", state: "fail", message: `${instance.id} envelope is not fully inside ${regionId}.`, objectIds: [instance.id, regionId], constraintIds: [...instance.constraintIds, ...region.sourceConstraintIds] }));
    }
    for (const regionId of instance.forbiddenRegionIds) {
      const region = problem.regions.find((candidate) => candidate.id === regionId);
      if (!region) violations.push(violation({ code: "PLACEMENT_REGION_UNKNOWN", state: "unknown", message: `Forbidden region ${regionId} has no exact geometry.`, objectIds: [instance.id, regionId], constraintIds: instance.constraintIds }));
      else if (bboxIntersectsPolygon(bounds, region.polygon)) violations.push(violation({ code: "PLACEMENT_REGION_EXCLUSION", state: "fail", message: `${instance.id} envelope enters forbidden region ${regionId}.`, objectIds: [instance.id, regionId], constraintIds: [...instance.constraintIds, ...region.sourceConstraintIds] }));
    }
    const legacyEdge = problem.board.footprints.find((footprint) => footprint.id === instance.id)?.placementConstraints?.edgeConnector;
    if (legacyEdge) {
      const outline = outlineBBox(problem.board.outline);
      const gap = legacyEdge === "left" ? Math.abs(bounds.minX - outline.minX)
        : legacyEdge === "right" ? Math.abs(outline.maxX - bounds.maxX)
          : legacyEdge === "top" ? Math.abs(bounds.minY - outline.minY)
            : Math.abs(outline.maxY - bounds.maxY);
      if (gap > 500_000) violations.push(violation({ code: "EDGE_RELATION_VIOLATION", state: "fail", message: `${instance.id} is ${gap} nm from required ${legacyEdge} edge; tolerance is 500000 nm.`, objectIds: [instance.id], constraintIds: instance.constraintIds }));
    }
  }
  let overlapCount = 0;
  let outsideCount = 0;
  for (let left = 0; left < problem.instances.length; left += 1) {
    const a = problem.instances[left];
    if (!placements[a.id]) continue;
    const aBox = instanceWorldBounds(problem, a.id, placements);
    if (!courtyardFitsOutline(aBox, problem.board.outline)) {
      outsideCount += 1;
      violations.push(violation({ code: "FOOTPRINT_OUTSIDE_BOARD", state: "fail", message: `${a.id} exact supported placement envelope is outside the board.`, objectIds: [a.id], constraintIds: a.constraintIds }));
    }
    for (let right = left + 1; right < problem.instances.length; right += 1) {
      const b = problem.instances[right];
      if (!placements[b.id]) continue;
      const oppositeSmdSides = placements[a.id].side !== placements[b.id].side && !problem.board.footprints.find((item) => item.id === a.id)?.def.attributes.throughHole && !problem.board.footprints.find((item) => item.id === b.id)?.def.attributes.throughHole;
      if (!oppositeSmdSides && bboxesOverlap(aBox, instanceWorldBounds(problem, b.id, placements))) {
        overlapCount += 1;
        violations.push(violation({ code: "FOOTPRINT_ENVELOPE_OVERLAP", state: "fail", message: `${a.id} overlaps ${b.id}.`, objectIds: [a.id, b.id], constraintIds: [...a.constraintIds, ...b.constraintIds] }));
      }
    }
  }
  const board = boardWithPlacement(problem, placements);
  let padOutsideCount = 0;
  for (const footprint of board.footprints) for (const pad of footprint.def.pads) {
    if (pad.type === "np_thru_hole") continue;
    if (!pointInOutline(padWorldPosition(footprint, pad), board.outline)) {
      padOutsideCount += 1;
      violations.push(violation({ code: "PAD_OUTSIDE_BOARD", state: "fail", message: `${footprint.id} pad ${pad.number} is outside the board.`, objectIds: [footprint.id, `pad:${footprint.id}:${pad.number}`], constraintIds: problem.instances.find((instance) => instance.id === footprint.id)?.constraintIds ?? [] }));
    }
  }
  for (const rule of problem.hardRules.filter((candidate) => candidate.kind === "placement_proximity" || candidate.kind === "placement_separation")) violations.push(...validateDistanceRule(problem, rule, placements));
  const handled = new Set(["placement_fixed", "placement_side", "placement_orientation", "placement_region", "placement_proximity", "placement_separation", "placement_group", "critical_loop", "thermal_relation", "return_reference", "decoupling"]);
  for (const rule of problem.hardRules.filter((candidate) => !handled.has(candidate.kind))) violations.push(violation({ code: "HARD_PLACEMENT_RULE_UNSUPPORTED", state: "unsupported", message: `Hard placement rule ${rule.kind} is not enforced by validator ${PLACEMENT_VALIDATOR_VERSION}.`, objectIds: [rule.targetId], constraintIds: rule.contributingConstraintIds }));
  const ordered = [...new Map(violations.map((item) => [item.id, item])).values()].sort((left, right) => left.id.localeCompare(right.id));
  return {
    validatorVersion: PLACEMENT_VALIDATOR_VERSION,
    sourceProblemHash: problem.problemHash,
    constraintProgramHash: problem.constraintProgramHash,
    violations: ordered,
    overlapCount,
    outsideCount,
    padOutsideCount,
    protectedStatePreserved: !ordered.some((item) => item.code === "PROTECTED_INSTANCE_MOVED"),
    legal: ordered.length === 0,
  };
}
