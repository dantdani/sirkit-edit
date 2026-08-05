import { migrateBoardConstraintState } from "@/app/lib/constraints/legacy";
import { constraintSemanticHash } from "@/app/lib/constraints/stable";
import type { EffectiveConstraintRule } from "@/app/lib/constraints/types";
import { boardConstraintTargetRevision } from "@/app/lib/constraints/board-model";
import { buildPlacementEnvelope } from "../autoplace/envelope";
import { bboxesOverlap, courtyardFitsOutline, outlineBBox, worldCourtyardBBox } from "../autoplace/geometry";
import { padWorldPosition } from "../geometry-copper";
import { pcbRevisionId } from "../revision";
import { getBoardStackup } from "../stackup";
import type { FootprintInstance, PcbBoard, Track, Via } from "../types";
import { buildPlacementHypergraph } from "./hypergraph";
import { deepFreezePlacement, placementSemanticHash, placementStableId } from "./stable";
import type {
  EngineeringPlacementOptions,
  PlacementCapacityPolicy,
  PlacementCopperAttachment,
  PlacementDiagnostic,
  PlacementInstanceVariable,
  PlacementProblem,
  PlacementRegion,
  PlacementRelationshipEdge,
} from "./types";
import { PLACEMENT_ALGORITHM_VERSION, PLACEMENT_METRIC_VERSION, PLACEMENT_PROBLEM_SCHEMA } from "./types";

const ROTATIONS = [0, 90, 180, 270] as const;
const SIDES = ["top", "bottom"] as const;

function diagnostic(code: string, message: string, objectIds: string[] = [], constraintIds: string[] = [], severity: PlacementDiagnostic["severity"] = "error"): PlacementDiagnostic {
  return {
    id: placementStableId("placement-diagnostic", { code, message, objectIds, constraintIds }),
    code,
    severity,
    message,
    objectIds: [...objectIds].sort(),
    constraintIds: [...constraintIds].sort(),
    nextActions: [severity === "error" ? "Change the explicit constraint, movement policy, or board geometry and rebuild the placement problem." : "Review the missing placement evidence before applying a candidate."],
  };
}

function componentId(targetId: string): string | undefined {
  if (targetId.startsWith("component:")) return targetId.slice("component:".length);
  if (targetId.startsWith("footprint:")) return targetId.slice("footprint:".length);
  return undefined;
}

function copperProtected(copper: Track | Via): boolean {
  return copper.locked === true || copper.source === undefined || copper.source === "human" || copper.source === "imported";
}

function attachmentFor(board: PcbBoard, footprint: FootprintInstance): PlacementCopperAttachment {
  const points = new Set(footprint.def.pads.filter((pad) => pad.type !== "np_thru_hole").map((pad) => {
    const point = padWorldPosition(footprint, pad);
    return `${point.x}:${point.y}`;
  }));
  const attached = board.tracks.filter((track) => points.has(`${track.start.x}:${track.start.y}`) || points.has(`${track.end.x}:${track.end.y}`));
  const attachedVias = board.vias.filter((via) => points.has(`${via.at.x}:${via.at.y}`));
  const protectedTrackIds = attached.filter(copperProtected).map((track) => track.id).sort();
  const generatedTrackIds = attached.filter((track) => !copperProtected(track)).map((track) => track.id).sort();
  const protectedViaIds = attachedVias.filter(copperProtected).map((via) => via.id).sort();
  const generatedViaIds = attachedVias.filter((via) => !copperProtected(via)).map((via) => via.id).sort();
  const protectedCount = protectedTrackIds.length + protectedViaIds.length;
  const generatedCount = generatedTrackIds.length + generatedViaIds.length;
  const state: PlacementCopperAttachment["state"] = protectedCount > 0 && generatedCount > 0
    ? "mixed"
    : protectedCount > 0
      ? "protected"
      : generatedCount > 0
        ? "generated"
        : "none";
  return { protectedTrackIds, generatedTrackIds, protectedViaIds, generatedViaIds, affectedNetIds: [...new Set([...attached.map((track) => track.netId), ...attachedVias.map((via) => via.netId)])].sort((a, b) => a - b), state };
}

function stringValues(rule: EffectiveConstraintRule): string[] {
  if (rule.requirement.form === "allowed_set") return rule.requirement.values.map(String);
  if (rule.requirement.form === "equals") return [String(rule.requirement.value)];
  return [];
}

function ruleTargets(programRules: EffectiveConstraintRule[], instanceId: string): EffectiveConstraintRule[] {
  return programRules.filter((rule) => componentId(rule.targetId) === instanceId);
}

function intersect<T>(left: readonly T[], right: readonly T[]): T[] {
  const allowed = new Set(right);
  return left.filter((item) => allowed.has(item));
}

function instanceVariable(input: {
  board: PcbBoard;
  footprint: FootprintInstance;
  mode: PlacementProblem["movementMode"];
  selected: Set<string>;
  rules: EffectiveConstraintRule[];
}): PlacementInstanceVariable {
  const { board, footprint, mode } = input;
  const rules = ruleTargets(input.rules, footprint.id);
  const fixedReasons: string[] = [];
  if (footprint.locked) fixedReasons.push("footprint_locked");
  if (footprint.placementConstraints?.fixedPosition) fixedReasons.push("legacy_fixed_position");
  if (footprint.placementConstraints?.mechanical) fixedReasons.push("legacy_mechanical_anchor");
  if (rules.some((rule) => rule.kind === "placement_fixed" && rule.strength === "hard" && rule.requirement.form === "equals" && rule.requirement.value === true)) fixedReasons.push("compiled_fixed_constraint");
  const copper = attachmentFor(board, footprint);
  if (copper.protectedTrackIds.length > 0 || copper.protectedViaIds.length > 0) fixedReasons.push("attached_protected_copper");
  if (mode === "preserve_routed" && (copper.generatedTrackIds.length > 0 || copper.generatedViaIds.length > 0)) fixedReasons.push("preserve_routed_copper");
  if (mode === "selected_scope" && !input.selected.has(footprint.id)) fixedReasons.push("outside_selected_scope");
  let allowedRotations: Array<0 | 90 | 180 | 270> = footprint.placementConstraints?.allowedRotations?.length
    ? [...new Set(footprint.placementConstraints.allowedRotations)].sort((a, b) => a - b)
    : [...ROTATIONS];
  for (const rule of rules.filter((candidate) => candidate.kind === "placement_orientation" && candidate.strength === "hard")) {
    const allowed = stringValues(rule).map(Number).filter((value): value is 0 | 90 | 180 | 270 => ROTATIONS.includes(value as 0 | 90 | 180 | 270));
    allowedRotations = intersect(allowedRotations, allowed);
  }
  let allowedSides: Array<"top" | "bottom"> = footprint.placementConstraints?.allowSideChange ? [...SIDES] : [footprint.side];
  for (const rule of rules.filter((candidate) => candidate.kind === "placement_side" && candidate.strength === "hard")) {
    const allowed = stringValues(rule).filter((value): value is "top" | "bottom" => SIDES.includes(value as "top" | "bottom"));
    allowedSides = intersect(allowedSides, allowed);
  }
  const allowedRegionIds: string[] = [];
  const forbiddenRegionIds: string[] = [];
  for (const rule of rules.filter((candidate) => candidate.kind === "placement_region" && candidate.strength === "hard")) {
    if (rule.requirement.form !== "containment") continue;
    (rule.requirement.mode === "inside" ? allowedRegionIds : forbiddenRegionIds).push(...rule.requirement.regionIds);
  }
  const envelope = buildPlacementEnvelope(board, footprint);
  return {
    id: footprint.id,
    componentTargetId: `component:${footprint.id}`,
    footprintRevision: constraintSemanticHash({ footprintId: footprint.footprintId, def: footprint.def, pinPadMappings: footprint.pinPadMappings }),
    sourcePosition: { ...footprint.at },
    sourceRotationDeg: footprint.rotationDeg,
    sourceSide: footprint.side,
    envelopeLocal: { ...envelope.effectiveBounds },
    envelopeConfidence: envelope.source.confidence,
    movable: fixedReasons.length === 0,
    fixedReasons: [...new Set(fixedReasons)].sort(),
    allowedRotations,
    allowedSides,
    allowedRegionIds: [...new Set(allowedRegionIds)].sort(),
    forbiddenRegionIds: [...new Set(forbiddenRegionIds)].sort(),
    groupIds: [],
    constraintIds: [...new Set(rules.flatMap((rule) => rule.contributingConstraintIds))].sort(),
    copper,
  };
}

function polygonArea(points: Array<{ x: number; y: number }>): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length];
    area += points[index].x * next.y - next.x * points[index].y;
  }
  return Math.abs(area) / 2;
}

function outlineArea(board: PcbBoard): number {
  if (board.outline.kind === "polygon") return polygonArea(board.outline.points);
  return board.outline.width * board.outline.height;
}

function relationships(board: PcbBoard): PlacementRelationshipEdge[] {
  const program = board.constraintState?.activeProgram;
  if (!program) return [];
  const lowerings = new Map([...program.lowerings.placementGraph, ...program.lowerings.routingGraph].map((item) => [item.relationshipId, item]));
  return board.constraintState!.documents.flatMap((document) => document.relationships).filter((relationship) => program.relationshipIds.includes(relationship.id)).map((relationship) => {
    const lowered = lowerings.get(relationship.id);
    return {
      id: relationship.id,
      kind: relationship.kind,
      members: relationship.members.map((member) => ({ ...member })),
      constraintIds: [...new Set(lowered?.constraintIds ?? [])].sort(),
      evidenceIds: [...relationship.evidenceIds].sort(),
      support: lowered?.support ?? "declarative_only",
    };
  }).sort((left, right) => left.id.localeCompare(right.id));
}

function capacityPolicy(board: PcbBoard, options: EngineeringPlacementOptions): PlacementCapacityPolicy {
  const bounds = outlineBBox(board.outline);
  const columns = Math.max(2, Math.min(32, Math.round(options.capacityColumns ?? 8)));
  const rows = Math.max(2, Math.min(32, Math.round(options.capacityRows ?? 6)));
  const layers = getBoardStackup(board).copperLayers.filter((layer) => layer.enabled);
  return {
    columns,
    rows,
    outlineBounds: bounds,
    signalLayerIds: layers.filter((layer) => layer.role !== "plane" && layer.autorouteEnabled).map((layer) => layer.id),
    planeLayerIds: layers.filter((layer) => layer.role === "plane").map((layer) => layer.id),
    gridCellWidthNm: Math.max(1, Math.floor((bounds.maxX - bounds.minX) / columns)),
    gridCellHeightNm: Math.max(1, Math.floor((bounds.maxY - bounds.minY) / rows)),
    protectedTrackIds: board.tracks.filter(copperProtected).map((track) => track.id).sort(),
    keepoutIds: (board.routingKeepouts ?? []).map((keepout) => keepout.id).sort(),
    version: PLACEMENT_METRIC_VERSION,
  };
}

export function buildPlacementProblem(input: { board: PcbBoard; options?: EngineeringPlacementOptions }): PlacementProblem {
  const options = input.options ?? {};
  const projectId = options.projectId ?? input.board.constraintState?.projectId ?? "placement";
  const sourceBoardRevision = pcbRevisionId(input.board);
  const migrated = migrateBoardConstraintState(structuredClone(input.board), projectId).board;
  const program = migrated.constraintState?.activeProgram;
  if (!program) throw new Error("Stage 7 requires a valid compiled Stage 6 constraint program.");
  const movementMode = options.mode ?? (migrated.tracks.length > 0 || migrated.vias.length > 0 ? "preserve_routed" : "initial_unrouted");
  const selectedInstanceIds = [...new Set(options.selectedInstanceIds ?? [])].sort();
  const selected = new Set(selectedInstanceIds);
  const allRules = program.effectiveRules;
  const instances = migrated.footprints.map((footprint) => instanceVariable({ board: migrated, footprint, mode: movementMode, selected, rules: allRules })).sort((left, right) => left.id.localeCompare(right.id));
  const relationEdges = relationships(migrated);
  for (const instance of instances) instance.groupIds = relationEdges.filter((relation) => ["placement_group", "current_loop", "decoupling"].includes(relation.kind) && relation.members.some((member) => componentId(member.targetId) === instance.id)).map((relation) => relation.id).sort();
  const graph = buildPlacementHypergraph({ board: migrated, program });
  const regions: PlacementRegion[] = [...(options.regions ?? [])].map((region) => ({ ...region, polygon: region.polygon.map((point) => ({ ...point })), sourceConstraintIds: [...region.sourceConstraintIds].sort() })).sort((left, right) => left.id.localeCompare(right.id));
  const diagnostics: PlacementDiagnostic[] = [];
  if (program.designRevision !== boardConstraintTargetRevision(migrated, projectId)) diagnostics.push(diagnostic("CONSTRAINT_PROGRAM_TARGETS_STALE", "The active constraint program does not match the current placement target hierarchy."));
  const boardBounds = outlineBBox(migrated.outline);
  for (const instance of instances) {
    if (instance.allowedRotations.length === 0) diagnostics.push(diagnostic("NO_ALLOWED_ROTATION", `${instance.id} has no legal rotation after restrictive constraint intersection.`, [instance.id], instance.constraintIds));
    if (instance.allowedSides.length === 0) diagnostics.push(diagnostic("NO_ALLOWED_SIDE", `${instance.id} has no legal board side after restrictive constraint intersection.`, [instance.id], instance.constraintIds));
    for (const regionId of [...instance.allowedRegionIds, ...instance.forbiddenRegionIds]) if (!regions.some((region) => region.id === regionId)) diagnostics.push(diagnostic("PLACEMENT_REGION_GEOMETRY_MISSING", `${instance.id} references region ${regionId}, but exact region geometry is unavailable.`, [instance.id, regionId], instance.constraintIds));
    const fitsBoundsAtSomeRotation = instance.allowedRotations.some((rotation) => {
      const bounds = worldCourtyardBBox(instance.envelopeLocal, { x: 0, y: 0 }, rotation, instance.sourceSide === "bottom");
      return bounds.maxX - bounds.minX <= boardBounds.maxX - boardBounds.minX && bounds.maxY - bounds.minY <= boardBounds.maxY - boardBounds.minY;
    });
    if (!fitsBoundsAtSomeRotation) diagnostics.push(diagnostic("INSTANCE_ENVELOPE_EXCEEDS_OUTLINE_BOUNDS", `${instance.id} cannot fit inside the outline bounds at any allowed rotation.`, [instance.id], instance.constraintIds));
    if (!instance.movable) {
      const bounds = worldCourtyardBBox(instance.envelopeLocal, instance.sourcePosition, instance.sourceRotationDeg, instance.sourceSide === "bottom");
      if (!courtyardFitsOutline(bounds, migrated.outline)) diagnostics.push(diagnostic("FIXED_INSTANCE_OUTSIDE_BOARD", `${instance.id} is fixed with its placement envelope outside the exact board outline.`, [instance.id], instance.constraintIds));
    }
  }
  const fixed = instances.filter((instance) => !instance.movable);
  for (let left = 0; left < fixed.length; left += 1) for (let right = left + 1; right < fixed.length; right += 1) {
    const a = worldCourtyardBBox(fixed[left].envelopeLocal, fixed[left].sourcePosition, fixed[left].sourceRotationDeg, fixed[left].sourceSide === "bottom");
    const b = worldCourtyardBBox(fixed[right].envelopeLocal, fixed[right].sourcePosition, fixed[right].sourceRotationDeg, fixed[right].sourceSide === "bottom");
    if (bboxesOverlap(a, b)) diagnostics.push(diagnostic("FIXED_OBJECTS_OVERLAP", `Fixed instances ${fixed[left].id} and ${fixed[right].id} overlap before optimization.`, [fixed[left].id, fixed[right].id], [...fixed[left].constraintIds, ...fixed[right].constraintIds]));
  }
  const requiredEnvelopeArea = instances.reduce((sum, instance) => sum + (instance.envelopeLocal.maxX - instance.envelopeLocal.minX) * (instance.envelopeLocal.maxY - instance.envelopeLocal.minY), 0);
  if (requiredEnvelopeArea > outlineArea(migrated)) diagnostics.push(diagnostic("BOARD_AREA_INFEASIBLE", "The sum of conservative placement envelopes exceeds usable board area; Stage 7 will not silently resize the outline."));
  const hardRules = allRules.filter((rule) => rule.strength === "hard" && (rule.kind.startsWith("placement_") || ["critical_loop", "thermal_relation", "return_reference", "decoupling"].includes(rule.kind)));
  const softRules = allRules.filter((rule) => rule.strength !== "hard" && (rule.kind.startsWith("placement_") || ["critical_loop", "thermal_relation", "return_reference", "decoupling"].includes(rule.kind)));
  const seedSet = [...new Set(options.seeds ?? [Number.parseInt(sourceBoardRevision.slice(-8), 16) >>> 0, (Number.parseInt(sourceBoardRevision.slice(-8), 16) + 1) >>> 0])].slice(0, 8);
  const base = {
    schemaVersion: PLACEMENT_PROBLEM_SCHEMA,
    projectId,
    sourceBoardRevision,
    constraintProgramHash: program.programHash,
    constraintDesignRevision: program.designRevision,
    catalogRevision: program.catalogRevision,
    variantRevision: program.variantRevision,
    manufacturingProfileRevision: program.manufacturingProfileRevision,
    algorithmVersion: PLACEMENT_ALGORITHM_VERSION,
    metricVersion: PLACEMENT_METRIC_VERSION,
    movementMode,
    selectedInstanceIds,
    seedSet,
    sourceOutline: structuredClone(migrated.outline),
    board: migrated,
    program,
    instances,
    terminals: graph.terminals,
    hyperedges: graph.hyperedges,
    relationships: relationEdges,
    regions,
    capacityPolicy: capacityPolicy(migrated, options),
    hardRules,
    softRules,
    diagnostics: diagnostics.sort((left, right) => left.id.localeCompare(right.id)),
    feasible: !diagnostics.some((item) => item.severity === "error"),
  };
  // The exact board/program are retained in the immutable snapshot, while
  // their canonical revisions—not caller array order—define problem identity.
  const problemHash = placementSemanticHash({ ...base, board: undefined, program: undefined });
  const problem: PlacementProblem = { ...base, problemId: `placement-problem:${problemHash.slice(3)}`, problemHash };
  return deepFreezePlacement(problem) as PlacementProblem;
}
