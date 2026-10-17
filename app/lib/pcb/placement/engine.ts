import { analyzePlacementRouteability } from "../autoplace/routeability";
import { resolveCollisions } from "../autoplace/collision-resolver";
import { runForceDirected } from "../autoplace/force-directed";
import { optimizeRotations, snapRotation } from "../autoplace/rotation";
import { resolveParams } from "../autoplace/types";
import type { FootprintPlacement } from "../autoplace/types";
import { outlineBBox } from "../autoplace/geometry";
import { analyzePlacementCongestion } from "./capacity";
import { analyzePlacementPinEscape, analyzePlacementViaPressure } from "./escape";
import { boardWithPlacement, sourcePlacementRecord, terminalWorldPosition } from "./geometry";
import { evaluatePlacementObjectives, DEFAULT_PLACEMENT_OBJECTIVE_POLICY } from "./objectives";
import { buildPlacementProblem } from "./problem";
import { deepFreezePlacement, placementSemanticHash, placementStableId } from "./stable";
import type {
  EngineeringPlacementOptions,
  PlacementCandidate,
  PlacementCopperPlan,
  PlacementMoveDiff,
  PlacementObjectiveKind,
  PlacementProblem,
  PlacementRunResult,
  PlacementTransform,
} from "./types";
import { PLACEMENT_ALGORITHM_VERSION, PLACEMENT_CANDIDATE_SCHEMA, PLACEMENT_METRIC_VERSION } from "./types";
import { validatePlacementCandidate } from "./validator";

export interface EngineeringPlacementProgress {
  phase: "capture" | "precheck" | "initialize" | "global" | "orientation" | "legalize" | "evaluate" | "select" | "complete";
  percent: number;
  candidate?: number;
  candidateCount?: number;
  bestKnownCandidateId?: string;
}

export interface EngineeringPlacementObserver {
  onProgress?(progress: EngineeringPlacementProgress): void;
  shouldCancel?(): boolean;
}

export class EngineeringPlacementCancelledError extends Error {
  constructor() {
    super("Engineering placement was cancelled; board unchanged.");
    this.name = "EngineeringPlacementCancelledError";
  }
}

function checkBudget(startedAt: number, timeoutMs: number, observer?: EngineeringPlacementObserver): "ok" | "timed_out" {
  if (observer?.shouldCancel?.()) throw new EngineeringPlacementCancelledError();
  return Date.now() - startedAt > timeoutMs ? "timed_out" : "ok";
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function projectHardAnchors(problem: PlacementProblem, placements: Record<string, PlacementTransform>): void {
  const boardBounds = outlineBBox(problem.board.outline);
  for (const instance of problem.instances) {
    const placement = placements[instance.id];
    if (!placement || !instance.movable) continue;
    const footprint = problem.board.footprints.find((candidate) => candidate.id === instance.id);
    const edge = footprint?.placementConstraints?.edgeConnector;
    const local = instance.envelopeLocal;
    if (edge === "left") placement.position.x = boardBounds.minX - local.minX;
    if (edge === "right") placement.position.x = boardBounds.maxX - local.maxX;
    if (edge === "top") placement.position.y = boardBounds.minY - local.minY;
    if (edge === "bottom") placement.position.y = boardBounds.maxY - local.maxY;
    if (instance.allowedRegionIds.length > 0) {
      const region = problem.regions.find((candidate) => candidate.id === instance.allowedRegionIds[0]);
      if (region) {
        const minX = Math.min(...region.polygon.map((point) => point.x));
        const maxX = Math.max(...region.polygon.map((point) => point.x));
        const minY = Math.min(...region.polygon.map((point) => point.y));
        const maxY = Math.max(...region.polygon.map((point) => point.y));
        placement.position.x = clamp(placement.position.x, minX - local.minX, maxX - local.maxX);
        placement.position.y = clamp(placement.position.y, minY - local.minY, maxY - local.maxY);
      }
    }
  }
}

function legalize(problem: PlacementProblem, placements: Record<string, PlacementTransform>, gridNm: number): { placements: Record<string, PlacementTransform>; collisionsResolved: number; clipped: number; warning?: string } {
  const input: FootprintPlacement[] = problem.instances.map((instance) => ({
    id: instance.id,
    position: { ...placements[instance.id].position },
    rotationDeg: placements[instance.id].rotationDeg,
    side: placements[instance.id].side,
    courtyardLocal: { ...instance.envelopeLocal },
    locked: !instance.movable,
  }));
  try {
    const result = resolveCollisions(problem.board, input, gridNm);
    const next = structuredClone(placements);
    for (const placement of result.placements) {
      next[placement.id] = { position: { ...placement.position }, rotationDeg: snapRotation(placement.rotationDeg), side: placement.side };
    }
    projectHardAnchors(problem, next);
    return { placements: next, collisionsResolved: result.collisionsResolved, clipped: result.footprintsClippedToBoundary };
  } catch (error) {
    return { placements: structuredClone(placements), collisionsResolved: 0, clipped: 0, warning: error instanceof Error ? error.message : "Exact legalization failed." };
  }
}

function constructivePlacement(problem: PlacementProblem, gridNm: number): Record<string, PlacementTransform> {
  const placements = sourcePlacementRecord(problem);
  const bounds = problem.capacityPolicy.outlineBounds;
  const movable = problem.instances.filter((instance) => instance.movable).sort((left, right) => left.id.localeCompare(right.id));
  const columns = Math.max(1, Math.ceil(Math.sqrt(movable.length * Math.max(1, (bounds.maxX - bounds.minX) / Math.max(1, bounds.maxY - bounds.minY)))));
  const rows = Math.max(1, Math.ceil(movable.length / columns));
  const cellWidth = (bounds.maxX - bounds.minX) / columns;
  const cellHeight = (bounds.maxY - bounds.minY) / rows;
  movable.forEach((instance, index) => {
    placements[instance.id] = {
      position: {
        x: Math.round((bounds.minX + (index % columns + 0.5) * cellWidth) / gridNm) * gridNm,
        y: Math.round((bounds.minY + (Math.floor(index / columns) + 0.5) * cellHeight) / gridNm) * gridNm,
      },
      rotationDeg: instance.allowedRotations.includes(snapRotation(instance.sourceRotationDeg)) ? snapRotation(instance.sourceRotationDeg) : instance.allowedRotations[0],
      side: instance.allowedSides.includes(instance.sourceSide) ? instance.sourceSide : instance.allowedSides[0],
    };
  });
  projectHardAnchors(problem, placements);
  return placements;
}

/** [PR-F, 2026-10-17] The intent-seeded start: the source record with the seed's transforms applied to MOVABLE instances only
 *  (a locked, fixed or out-of-scope instance keeps its source transform; a rotation or side outside the allowed set is ignored),
 *  then the same hard anchors every initializer passes through. Returns how many instances the seed actually moved. */
function intentSeedPlacement(problem: PlacementProblem, seed: NonNullable<EngineeringPlacementOptions["intentSeed"]>): { placements: Record<string, PlacementTransform>; seeded: number } {
  const placements = sourcePlacementRecord(problem);
  let seeded = 0;
  for (const instance of problem.instances) {
    const requested = seed.placements[instance.id];
    if (!requested || !instance.movable) continue;
    const current = placements[instance.id];
    const rotationDeg = requested.rotationDeg !== undefined && instance.allowedRotations.includes(requested.rotationDeg) ? requested.rotationDeg : current.rotationDeg;
    const side = requested.side !== undefined && instance.allowedSides.includes(requested.side) ? requested.side : current.side;
    const position = requested.position ? { x: Math.round(requested.position.x), y: Math.round(requested.position.y) } : current.position;
    placements[instance.id] = { position, rotationDeg, side };
    seeded += 1;
  }
  projectHardAnchors(problem, placements);
  return { placements, seeded };
}

function forcePlacement(problem: PlacementProblem, seed: number, maxIterations: number, gridNm: number): { placements: Record<string, PlacementTransform>; iterations: number; converged: boolean; incidences: number } {
  const board = structuredClone(problem.board);
  for (const instance of problem.instances) {
    const footprint = board.footprints.find((candidate) => candidate.id === instance.id);
    if (!footprint) continue;
    footprint.placementConstraints = { ...footprint.placementConstraints, allowedRotations: [...instance.allowedRotations] };
  }
  const footprints: FootprintPlacement[] = problem.instances.map((instance) => ({
    id: instance.id,
    position: { ...instance.sourcePosition },
    rotationDeg: instance.sourceRotationDeg,
    side: instance.sourceSide,
    courtyardLocal: { ...instance.envelopeLocal },
    locked: !instance.movable,
  }));
  const params = resolveParams({ seed, maxIterations, gridNm, candidateCount: 1, expandGeneratedOutline: false, allowBoardResize: false }, seed);
  const force = runForceDirected({ board, footprints, params });
  const lockedIds = new Set(problem.instances.filter((instance) => !instance.movable).map((instance) => instance.id));
  const rotations = optimizeRotations(board, force.positions, lockedIds);
  const placements = sourcePlacementRecord(problem);
  for (const instance of problem.instances) {
    if (!instance.movable) continue;
    placements[instance.id] = {
      position: { ...(force.positions.get(instance.id) ?? instance.sourcePosition) },
      rotationDeg: rotations.get(instance.id) ?? instance.allowedRotations[0],
      side: instance.allowedSides.includes(instance.sourceSide) ? instance.sourceSide : instance.allowedSides[0],
    };
  }
  projectHardAnchors(problem, placements);
  return { placements, iterations: force.iterations, converged: force.converged, incidences: force.springIncidences };
}

function quickPinHpwl(problem: PlacementProblem, placements: Record<string, PlacementTransform>, instanceId: string): number {
  const terminalById = new Map(problem.terminals.map((terminal) => [terminal.id, terminal]));
  let result = 0;
  for (const edge of problem.hyperedges.filter((candidate) => candidate.kind === "signal" && candidate.memberComponentIds.includes(instanceId))) {
    const points = edge.memberTerminalIds.map((id) => terminalById.get(id)).filter((terminal) => terminal !== undefined).map((terminal) => terminalWorldPosition(terminal!, placements));
    if (points.length < 2) continue;
    result += Math.max(...points.map((point) => point.x)) - Math.min(...points.map((point) => point.x)) + Math.max(...points.map((point) => point.y)) - Math.min(...points.map((point) => point.y));
  }
  return result;
}

function refineOrientation(problem: PlacementProblem, placements: Record<string, PlacementTransform>, pinned?: ReadonlySet<string>): Record<string, PlacementTransform> {
  const next = structuredClone(placements);
  // [PR-F, 2026-10-17] an instance whose rotation / side the intent seed pinned keeps it here (legalization still runs over it)
  for (const instance of problem.instances.filter((candidate) => candidate.movable && !pinned?.has(candidate.id)).sort((left, right) => left.id.localeCompare(right.id))) {
    let best = next[instance.id];
    let bestScore = quickPinHpwl(problem, next, instance.id);
    for (const side of instance.allowedSides) for (const rotationDeg of instance.allowedRotations) {
      const proposed = { ...best, side, rotationDeg };
      next[instance.id] = proposed;
      const score = quickPinHpwl(problem, next, instance.id);
      const tie = `${side}:${rotationDeg}`.localeCompare(`${best.side}:${best.rotationDeg}`) < 0;
      if (score < bestScore || (score === bestScore && tie)) {
        best = proposed;
        bestScore = score;
      }
    }
    next[instance.id] = best;
  }
  return next;
}

function copperPlan(problem: PlacementProblem, placements: Record<string, PlacementTransform>): PlacementCopperPlan {
  const moved = problem.instances.filter((instance) => {
    const placement = placements[instance.id];
    return placement.position.x !== instance.sourcePosition.x || placement.position.y !== instance.sourcePosition.y || placement.rotationDeg !== instance.sourceRotationDeg || placement.side !== instance.sourceSide;
  });
  const removeTrackIds = problem.movementMode === "generated_copper_ripup" ? [...new Set(moved.flatMap((instance) => instance.copper.generatedTrackIds))].sort() : [];
  const removeViaIds = problem.movementMode === "generated_copper_ripup" ? [...new Set(moved.flatMap((instance) => instance.copper.generatedViaIds))].sort() : [];
  const affectedNetIds = [...new Set(moved.flatMap((instance) => instance.copper.affectedNetIds))].sort((a, b) => a - b);
  return {
    mode: problem.movementMode,
    removeTrackIds,
    removeViaIds,
    removeZoneIds: [],
    affectedNetIds,
    protectedObjectIds: [...new Set(moved.flatMap((instance) => [...instance.copper.protectedTrackIds, ...instance.copper.protectedViaIds]))].sort(),
    resultingConnectivity: removeTrackIds.length + removeViaIds.length > 0 ? "incomplete" : "unchanged",
    requiresRoutingFollowUp: removeTrackIds.length + removeViaIds.length > 0,
  };
}

function moveDiffs(problem: PlacementProblem, placements: Record<string, PlacementTransform>): PlacementMoveDiff[] {
  return problem.instances.flatMap((instance) => {
    const after = placements[instance.id];
    const before: PlacementTransform = { position: { ...instance.sourcePosition }, rotationDeg: snapRotation(instance.sourceRotationDeg), side: instance.sourceSide };
    const displacementNm = Math.hypot(after.position.x - before.position.x, after.position.y - before.position.y);
    if (displacementNm === 0 && after.rotationDeg === before.rotationDeg && after.side === before.side) return [];
    return [{ instanceId: instance.id, before, after: structuredClone(after), displacementNm, rotated: after.rotationDeg !== before.rotationDeg, flipped: after.side !== before.side, reasonIds: [...instance.constraintIds] }];
  }).sort((left, right) => left.instanceId.localeCompare(right.instanceId));
}

function evaluateCandidate(input: {
  problem: PlacementProblem;
  placements: Record<string, PlacementTransform>;
  seed: number;
  initializer: PlacementCandidate["initializer"];
  phaseStats: PlacementCandidate["phaseStats"];
  warnings: string[];
  policy: NonNullable<EngineeringPlacementOptions["objectivePolicy"]>;
}): PlacementCandidate {
  const hardReport = validatePlacementCandidate(input.problem, input.placements);
  const congestion = analyzePlacementCongestion(input.problem, input.placements);
  const pinEscape = analyzePlacementPinEscape(input.problem, input.placements);
  const viaPressure = analyzePlacementViaPressure(input.problem, input.placements);
  const objectiveReport = evaluatePlacementObjectives({ problem: input.problem, placements: input.placements, congestion, pinEscape, viaPressure, policy: input.policy });
  const legacyBoard = boardWithPlacement(input.problem, input.placements);
  legacyBoard.footprints.sort((left, right) => left.id.localeCompare(right.id));
  legacyBoard.nets.sort((left, right) => (left.stableId ?? "").localeCompare(right.stableId ?? "") || left.id - right.id);
  const legacy = analyzePlacementRouteability(legacyBoard);
  const semantic = {
    schemaVersion: PLACEMENT_CANDIDATE_SCHEMA,
    problemHash: input.problem.problemHash,
    sourceBoardRevision: input.problem.sourceBoardRevision,
    constraintProgramHash: input.problem.constraintProgramHash,
    algorithmVersion: PLACEMENT_ALGORITHM_VERSION,
    metricVersion: PLACEMENT_METRIC_VERSION,
    seed: input.seed,
    initializer: input.initializer,
    placements: Object.fromEntries(Object.entries(input.placements).sort(([left], [right]) => left.localeCompare(right))),
    moves: moveDiffs(input.problem, input.placements),
    copperPlan: copperPlan(input.problem, input.placements),
    hardReport,
    congestion,
    pinEscape,
    viaPressure,
    objectiveReport,
    legacyDiagnostics: { airwireCrossings: legacy.airwireCrossings, ratsnestLengthNm: legacy.ratsnestLengthNm },
    warnings: [...input.warnings].sort(),
  };
  const candidateHash = placementSemanticHash(semantic);
  return { ...semantic, candidateId: `placement-candidate:${candidateHash.slice(3)}`, candidateHash, phaseStats: input.phaseStats, selected: false };
}

function objectivePenalty(candidate: PlacementCandidate, kind: PlacementObjectiveKind): number {
  const metric = candidate.objectiveReport.objectives.find((objective) => objective.kind === kind);
  if (!metric || metric.state === "not_applicable") return 0;
  // Missing or unsupported evidence must never become a free optimization win.
  return metric.normalizedPenalty ?? 1;
}

function compareCandidates(left: PlacementCandidate, right: PlacementCandidate, priorities: PlacementObjectiveKind[]): number {
  if (left.hardReport.legal !== right.hardReport.legal) return left.hardReport.legal ? -1 : 1;
  if (!left.hardReport.legal && left.hardReport.violations.length !== right.hardReport.violations.length) return left.hardReport.violations.length - right.hardReport.violations.length;
  for (const kind of priorities) {
    const delta = objectivePenalty(left, kind) - objectivePenalty(right, kind);
    if (Math.abs(delta) > 1e-12) return delta;
  }
  if (left.objectiveReport.evaluatedWeightedPenalty !== right.objectiveReport.evaluatedWeightedPenalty) return left.objectiveReport.evaluatedWeightedPenalty - right.objectiveReport.evaluatedWeightedPenalty;
  return left.candidateHash.localeCompare(right.candidateHash);
}

function dominates(left: PlacementCandidate, right: PlacementCandidate): boolean {
  const dimensions: PlacementObjectiveKind[] = ["routing_congestion", "pin_escape", "wirelength", "via_pressure", "placement_stability"];
  const noWorse = dimensions.every((kind) => objectivePenalty(left, kind) <= objectivePenalty(right, kind));
  const better = dimensions.some((kind) => objectivePenalty(left, kind) < objectivePenalty(right, kind));
  return left.hardReport.legal && right.hardReport.legal && noWorse && better;
}

function localRefine(problem: PlacementProblem, candidate: PlacementCandidate, passes: number, gridNm: number, policy: NonNullable<EngineeringPlacementOptions["objectivePolicy"]>): PlacementCandidate {
  if (!candidate.hardReport.legal || passes <= 0) return candidate;
  let best = candidate;
  const hotspotComponents = [...new Set(candidate.pinEscape.hotspots.flatMap((hotspot) => hotspot.componentId))];
  const congestionComponents = problem.hyperedges.filter((edge) => candidate.congestion.criticalNetIds.includes(edge.netStableId)).flatMap((edge) => edge.memberComponentIds);
  const targets = [...hotspotComponents, ...congestionComponents].filter((id, index, values) => values.indexOf(id) === index).slice(0, 16);
  for (let pass = 0; pass < passes; pass += 1) for (const instanceId of targets) {
    const instance = problem.instances.find((item) => item.id === instanceId);
    if (!instance?.movable) continue;
    const base = best.placements[instanceId];
    for (const [dx, dy] of [[gridNm, 0], [-gridNm, 0], [0, gridNm], [0, -gridNm]] as const) {
      const placements = structuredClone(best.placements);
      placements[instanceId] = { ...base, position: { x: base.position.x + dx, y: base.position.y + dy } };
      const evaluated = evaluateCandidate({ problem, placements, seed: best.seed, initializer: best.initializer, phaseStats: best.phaseStats, warnings: best.warnings, policy });
      if (evaluated.hardReport.legal && compareCandidates(evaluated, best, policy.priorities) < 0) best = evaluated;
    }
  }
  return best;
}

export function runEngineeringPlacement(input: { board: PlacementProblem["board"]; options?: EngineeringPlacementOptions; observer?: EngineeringPlacementObserver }): PlacementRunResult {
  const startedAt = Date.now();
  const options = input.options ?? {};
  const timeoutMs = Math.max(50, Math.min(120_000, Math.round(options.timeoutMs ?? 15_000)));
  input.observer?.onProgress?.({ phase: "capture", percent: 2 });
  const problem = buildPlacementProblem({ board: input.board, options });
  input.observer?.onProgress?.({ phase: "precheck", percent: 7 });
  if (!problem.feasible) return deepFreezePlacement({ runId: placementStableId("placement-run", { problemHash: problem.problemHash }), problem, candidates: [], frontierCandidateIds: [], termination: "infeasible", searchComplete: true, elapsedMs: Date.now() - startedAt, diagnostics: problem.diagnostics }) as PlacementRunResult;
  const policy = options.objectivePolicy ?? DEFAULT_PLACEMENT_OBJECTIVE_POLICY;
  const gridNm = Math.max(10_000, Math.round(options.gridNm ?? 100_000));
  const candidateCount = Math.max(2, Math.min(8, Math.round(options.candidateCount ?? 4)));
  const maxIterations = Math.max(1, Math.min(2_000, Math.round(options.maxIterations ?? 400)));
  const specs: Array<{ initializer: PlacementCandidate["initializer"]; seed: number }> = [
    ...(options.intentSeed ? [{ initializer: "intent_seed" as const, seed: problem.seedSet[0] }] : []), // [PR-F] one extra candidate that starts from the intent
    { initializer: "current", seed: problem.seedSet[0] },
    { initializer: "hypergraph_force", seed: problem.seedSet[0] },
    ...(candidateCount >= 3 ? [{ initializer: "constructive" as const, seed: problem.seedSet[0] }] : []),
    ...Array.from({ length: Math.max(0, candidateCount - 3) }, (_, index) => ({ initializer: "hypergraph_force" as const, seed: problem.seedSet[(index + 1) % problem.seedSet.length] + index + 1 })),
  ];
  const candidates: PlacementCandidate[] = [];
  let timedOut = false;
  for (let index = 0; index < specs.length; index += 1) {
    if (checkBudget(startedAt, timeoutMs, input.observer) === "timed_out") {
      timedOut = true;
      break;
    }
    const spec = specs[index];
    input.observer?.onProgress?.({ phase: "initialize", percent: 10 + Math.round((index / specs.length) * 55), candidate: index + 1, candidateCount: specs.length });
    const phaseStats: PlacementCandidate["phaseStats"] = [];
    const warnings: string[] = [];
    let placements: Record<string, PlacementTransform>;
    if (spec.initializer === "current") {
      placements = sourcePlacementRecord(problem);
      phaseStats.push({ phase: "current-seed", elapsedMs: 0, iterations: 0, termination: "captured" });
    } else if (spec.initializer === "intent_seed") {
      // [PR-F, 2026-10-17] the intent's transforms on movable instances, then the SAME orientation refinement (pinned ids kept),
      // exact legalization, hard validation and objective evaluation as every other candidate
      const seeded = intentSeedPlacement(problem, options.intentSeed!);
      placements = seeded.placements;
      phaseStats.push({ phase: "intent-seed", elapsedMs: 0, iterations: seeded.seeded, termination: "captured" });
    } else if (spec.initializer === "constructive") {
      placements = constructivePlacement(problem, gridNm);
      phaseStats.push({ phase: "constructive", elapsedMs: 0, iterations: problem.instances.length, termination: "bounded" });
    } else {
      input.observer?.onProgress?.({ phase: "global", percent: 15 + Math.round((index / specs.length) * 55), candidate: index + 1, candidateCount: specs.length });
      const phaseStarted = Date.now();
      const force = forcePlacement(problem, spec.seed, maxIterations, gridNm);
      placements = force.placements;
      phaseStats.push({ phase: "hypergraph-force", elapsedMs: Date.now() - phaseStarted, iterations: force.iterations, termination: force.converged ? "converged" : "iteration_limit" });
      if (force.incidences !== problem.hyperedges.filter((edge) => edge.kind === "signal").reduce((sum, edge) => sum + edge.memberComponentIds.length, 0)) warnings.push("Force incidences differ from pin-aware hypergraph incidences because the legacy force initializer groups by footprint/net; no pair clique is used.");
    }
    input.observer?.onProgress?.({ phase: "orientation", percent: 20 + Math.round((index / specs.length) * 55), candidate: index + 1, candidateCount: specs.length });
    placements = refineOrientation(problem, placements, spec.initializer === "intent_seed" ? new Set(options.intentSeed?.orientationPinnedIds ?? []) : undefined);
    input.observer?.onProgress?.({ phase: "legalize", percent: 25 + Math.round((index / specs.length) * 55), candidate: index + 1, candidateCount: specs.length });
    const legalized = legalize(problem, placements, gridNm);
    placements = legalized.placements;
    if (legalized.warning) warnings.push(legalized.warning);
    phaseStats.push({ phase: "exact-legalization", elapsedMs: 0, iterations: legalized.collisionsResolved, termination: legalized.warning ? "failed" : "completed" });
    input.observer?.onProgress?.({ phase: "evaluate", percent: 30 + Math.round(((index + 1) / specs.length) * 55), candidate: index + 1, candidateCount: specs.length });
    let candidate = evaluateCandidate({ problem, placements, seed: spec.seed, initializer: spec.initializer, phaseStats, warnings, policy });
    candidate = localRefine(problem, candidate, Math.max(0, Math.min(3, Math.round(options.localRefinementPasses ?? 1))), gridNm, policy);
    candidates.push(candidate);
  }
  input.observer?.onProgress?.({ phase: "select", percent: 92 });
  const sorted = [...candidates].sort((left, right) => compareCandidates(left, right, policy.priorities));
  // [PR-F, 2026-10-17] a hard-legal intent-seeded candidate is preferred when the seed asks for it; otherwise the order above decides
  const preferredSeed = options.intentSeed?.preferSeeded ? sorted.find((candidate) => candidate.initializer === "intent_seed" && candidate.hardReport.legal) : undefined;
  const selected = preferredSeed ?? sorted.find((candidate) => candidate.hardReport.legal);
  const frontier = sorted.filter((candidate) => candidate.hardReport.legal && !sorted.some((other) => other.candidateId !== candidate.candidateId && dominates(other, candidate)));
  const finalized = sorted.map((candidate) => candidate.candidateId === selected?.candidateId ? { ...candidate, selected: true, selectionReason: preferredSeed ? "Intent-seeded candidate preferred: hard-legal after exact legalization (the objective order did not decide)." : timedOut ? "Best legal candidate found before the explicit time budget." : "Selected lexicographically by hard legality, explicit objective priorities, normalized penalties, and stable hash tie-break." } : candidate);
  const result: PlacementRunResult = {
    runId: placementStableId("placement-run", { problemHash: problem.problemHash, candidates: finalized.map((candidate) => candidate.candidateHash), timedOut }),
    problem,
    candidates: finalized,
    frontierCandidateIds: frontier.map((candidate) => candidate.candidateId).sort(),
    ...(selected ? { selectedCandidateId: selected.candidateId } : {}),
    termination: timedOut ? selected ? "best_known_budget_exhausted" : "timed_out" : selected ? "completed" : "no_legal_candidate",
    searchComplete: !timedOut,
    elapsedMs: Date.now() - startedAt,
    diagnostics: problem.diagnostics,
  };
  input.observer?.onProgress?.({ phase: "complete", percent: 100, bestKnownCandidateId: selected?.candidateId });
  return deepFreezePlacement(result) as PlacementRunResult;
}

export function placementReplayArtifact(result: PlacementRunResult): unknown {
  return {
    schemaVersion: 1,
    runId: result.runId,
    problem: {
      problemHash: result.problem.problemHash,
      sourceBoardRevision: result.problem.sourceBoardRevision,
      constraintProgramHash: result.problem.constraintProgramHash,
      algorithmVersion: result.problem.algorithmVersion,
      metricVersion: result.problem.metricVersion,
      movementMode: result.problem.movementMode,
      seedSet: result.problem.seedSet,
      instances: result.problem.instances,
      hyperedges: result.problem.hyperedges,
      relationships: result.problem.relationships,
      capacityPolicy: result.problem.capacityPolicy,
    },
    candidates: result.candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      candidateHash: candidate.candidateHash,
      seed: candidate.seed,
      initializer: candidate.initializer,
      placements: candidate.placements,
      moves: candidate.moves,
      copperPlan: candidate.copperPlan,
      hardReport: candidate.hardReport,
      congestion: candidate.congestion,
      pinEscape: candidate.pinEscape,
      viaPressure: candidate.viaPressure,
      objectiveReport: candidate.objectiveReport,
      warnings: candidate.warnings,
    })),
    frontierCandidateIds: result.frontierCandidateIds,
    selectedCandidateId: result.selectedCandidateId,
    termination: result.termination,
    searchComplete: result.searchComplete,
  };
}

export function comparePlacementCandidates(left: PlacementCandidate, right: PlacementCandidate, priorities = DEFAULT_PLACEMENT_OBJECTIVE_POLICY.priorities) {
  return {
    leftCandidateId: left.candidateId,
    rightCandidateId: right.candidateId,
    hard: { leftLegal: left.hardReport.legal, rightLegal: right.hardReport.legal, leftViolations: left.hardReport.violations.length, rightViolations: right.hardReport.violations.length },
    objectives: priorities.map((kind) => ({ kind, left: objectivePenalty(left, kind), right: objectivePenalty(right, kind), preferred: objectivePenalty(left, kind) === objectivePenalty(right, kind) ? "tie" : objectivePenalty(left, kind) < objectivePenalty(right, kind) ? "left" : "right" })),
    deterministicOrder: compareCandidates(left, right, priorities),
  };
}
