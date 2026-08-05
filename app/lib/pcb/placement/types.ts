import type { ConstraintProgram, ConstraintRelationship, EffectiveConstraintRule, EnforcementSupport } from "@/app/lib/constraints/types";
import type { BBox, Vec2 } from "../geometry";
import type { LayerId } from "../layers";
import type { BoardOutline, PcbBoard } from "../types";

export const PLACEMENT_PROBLEM_SCHEMA = "sirkit.placement-problem.v1" as const;
export const PLACEMENT_CANDIDATE_SCHEMA = "sirkit.placement-candidate.v1" as const;
export const PLACEMENT_ALGORITHM_VERSION = "engineering-placement/1.0.0" as const;
export const PLACEMENT_METRIC_VERSION = "placement-capacity/1.0.0" as const;
export const PLACEMENT_VALIDATOR_VERSION = "placement-hard-validator/1.0.0" as const;

export type PlacementMovementMode =
  | "initial_unrouted"
  | "preserve_routed"
  | "generated_copper_ripup"
  | "selected_scope";

export type PlacementTermination =
  | "completed"
  | "best_known_budget_exhausted"
  | "infeasible"
  | "no_legal_candidate"
  | "cancelled"
  | "timed_out"
  | "limited_search"
  | "stale"
  | "post_validation_regression";

export interface PlacementRegion {
  id: string;
  name: string;
  polygon: Vec2[];
  side?: "top" | "bottom" | "both";
  kind: "room" | "keepout" | "mechanical" | "assembly" | "thermal" | "rf";
  sourceConstraintIds: string[];
}

export interface PlacementCopperAttachment {
  protectedTrackIds: string[];
  generatedTrackIds: string[];
  protectedViaIds: string[];
  generatedViaIds: string[];
  affectedNetIds: number[];
  state: "none" | "protected" | "generated" | "mixed";
}

export interface PlacementInstanceVariable {
  id: string;
  componentTargetId: string;
  footprintRevision: string;
  sourcePosition: Vec2;
  sourceRotationDeg: number;
  sourceSide: "top" | "bottom";
  envelopeLocal: BBox;
  envelopeConfidence: "high" | "medium" | "low";
  movable: boolean;
  fixedReasons: string[];
  allowedRotations: Array<0 | 90 | 180 | 270>;
  allowedSides: Array<"top" | "bottom">;
  allowedRegionIds: string[];
  forbiddenRegionIds: string[];
  groupIds: string[];
  constraintIds: string[];
  copper: PlacementCopperAttachment;
}

export interface PlacementTerminalAnchor {
  id: string;
  componentId: string;
  netId: number;
  netStableId: string;
  padNumbers: string[];
  localPosition: Vec2;
  accessLayers: LayerId[];
  source: "pin-pad-mapping" | "pad-number-group";
}

export interface PlacementHyperedge {
  id: string;
  kind: "signal" | "plane_access";
  netId: number;
  netStableId: string;
  memberTerminalIds: string[];
  memberComponentIds: string[];
  weight: number;
  minTrackWidthNm: number;
  clearanceNm: number;
  allowedLayerIds: LayerId[];
  preferredLayerIds: LayerId[];
  constraintIds: string[];
  decomposition: "two_pin" | "star" | "plane_access";
  electricalState: "proven" | "failed" | "unknown";
  remainingConnections: number;
}

export interface PlacementRelationshipEdge {
  id: string;
  kind: ConstraintRelationship["kind"];
  members: ConstraintRelationship["members"];
  constraintIds: string[];
  evidenceIds: string[];
  support: EnforcementSupport;
}

export interface PlacementCapacityPolicy {
  columns: number;
  rows: number;
  outlineBounds: BBox;
  signalLayerIds: LayerId[];
  planeLayerIds: LayerId[];
  gridCellWidthNm: number;
  gridCellHeightNm: number;
  protectedTrackIds: string[];
  keepoutIds: string[];
  version: typeof PLACEMENT_METRIC_VERSION;
}

export interface PlacementDiagnostic {
  id: string;
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  objectIds: string[];
  constraintIds: string[];
  nextActions: string[];
}

export interface PlacementProblem {
  schemaVersion: typeof PLACEMENT_PROBLEM_SCHEMA;
  problemId: string;
  problemHash: string;
  projectId: string;
  sourceBoardRevision: string;
  constraintProgramHash: string;
  constraintDesignRevision: string;
  catalogRevision: string;
  variantRevision: string;
  manufacturingProfileRevision: string;
  algorithmVersion: typeof PLACEMENT_ALGORITHM_VERSION;
  metricVersion: typeof PLACEMENT_METRIC_VERSION;
  movementMode: PlacementMovementMode;
  selectedInstanceIds: string[];
  seedSet: number[];
  sourceOutline: BoardOutline;
  board: PcbBoard;
  program: ConstraintProgram;
  instances: PlacementInstanceVariable[];
  terminals: PlacementTerminalAnchor[];
  hyperedges: PlacementHyperedge[];
  relationships: PlacementRelationshipEdge[];
  regions: PlacementRegion[];
  capacityPolicy: PlacementCapacityPolicy;
  hardRules: EffectiveConstraintRule[];
  softRules: EffectiveConstraintRule[];
  diagnostics: PlacementDiagnostic[];
  feasible: boolean;
}

export interface PlacementTransform {
  position: Vec2;
  rotationDeg: 0 | 90 | 180 | 270;
  side: "top" | "bottom";
}

export interface PlacementHardViolation {
  id: string;
  code: string;
  state: "fail" | "unknown" | "unsupported" | "stale";
  message: string;
  objectIds: string[];
  constraintIds: string[];
}

export interface PlacementHardReport {
  validatorVersion: typeof PLACEMENT_VALIDATOR_VERSION;
  sourceProblemHash: string;
  constraintProgramHash: string;
  violations: PlacementHardViolation[];
  overlapCount: number;
  outsideCount: number;
  padOutsideCount: number;
  protectedStatePreserved: boolean;
  legal: boolean;
}

export interface PlacementCutlineMetric {
  id: string;
  layerId: LayerId;
  direction: "horizontal" | "vertical";
  index: number;
  coordinateNm: number;
  capacityTracks: number;
  demandTracks: number;
  overflowTracks: number;
  ratio: number;
  contributingNetIds: string[];
  capacityAssumptions: string[];
}

export interface PlacementCongestionReport {
  version: typeof PLACEMENT_METRIC_VERSION;
  cutlines: PlacementCutlineMetric[];
  totalCapacityTracks: number;
  totalDemandTracks: number;
  totalOverflowTracks: number;
  maximumOverflowTracks: number;
  overCapacityCutlines: number;
  hotspots: PlacementCutlineMetric[];
  criticalNetIds: string[];
}

export interface PlacementPinEscapeMetric {
  terminalId: string;
  componentId: string;
  netStableId: string;
  attemptedDirections: number;
  feasibleDirections: number;
  viaLandingOptions: number;
  state: "pass" | "deficit" | "unknown";
  reasons: string[];
}

export interface PlacementPinEscapeReport {
  version: typeof PLACEMENT_METRIC_VERSION;
  terminals: PlacementPinEscapeMetric[];
  deficits: number;
  unknown: number;
  hotspots: Array<{ componentId: string; deficits: number; terminalIds: string[] }>;
}

export interface PlacementViaPressureCell {
  id: string;
  column: number;
  row: number;
  demand: number;
  landingCapacity: number;
  pressure: number;
  netStableIds: string[];
  state: "estimated" | "unsupported" | "unknown";
}

export interface PlacementViaPressureReport {
  version: typeof PLACEMENT_METRIC_VERSION;
  totalDemand: number;
  maximumPressure: number;
  cells: PlacementViaPressureCell[];
  hotspots: PlacementViaPressureCell[];
}

export type PlacementObjectiveKind =
  | "wirelength"
  | "routing_congestion"
  | "pin_escape"
  | "via_pressure"
  | "decoupling"
  | "critical_loop"
  | "plane_return_access"
  | "high_speed_ordering"
  | "sensitive_separation"
  | "thermal_intent"
  | "mechanical_edge"
  | "assembly_test"
  | "placement_stability";

export interface PlacementObjectiveMetric {
  id: string;
  kind: PlacementObjectiveKind;
  version: string;
  state: "evaluated" | "unknown" | "unsupported" | "not_applicable";
  rawValue: number | null;
  rawUnit: string;
  normalization: { kind: "ratio_to_target" | "board_diagonal" | "fraction" | "capacity_ratio"; denominator: number; target?: number };
  normalizedPenalty: number | null;
  weight: number;
  weightedPenalty: number | null;
  constraintIds: string[];
  evidenceIds: string[];
  objectIds: string[];
  explanation: string;
  limitations: string[];
}

export interface PlacementObjectiveReport {
  version: typeof PLACEMENT_METRIC_VERSION;
  objectives: PlacementObjectiveMetric[];
  evaluatedWeightedPenalty: number;
  unknownObjectiveIds: string[];
  unsupportedObjectiveIds: string[];
}

export interface PlacementMoveDiff {
  instanceId: string;
  before: PlacementTransform;
  after: PlacementTransform;
  displacementNm: number;
  rotated: boolean;
  flipped: boolean;
  reasonIds: string[];
}

export interface PlacementCopperPlan {
  mode: PlacementMovementMode;
  removeTrackIds: string[];
  removeViaIds: string[];
  removeZoneIds: string[];
  affectedNetIds: number[];
  protectedObjectIds: string[];
  resultingConnectivity: "unchanged" | "incomplete";
  requiresRoutingFollowUp: boolean;
}

export interface PlacementCandidate {
  schemaVersion: typeof PLACEMENT_CANDIDATE_SCHEMA;
  candidateId: string;
  candidateHash: string;
  problemHash: string;
  sourceBoardRevision: string;
  constraintProgramHash: string;
  algorithmVersion: typeof PLACEMENT_ALGORITHM_VERSION;
  metricVersion: typeof PLACEMENT_METRIC_VERSION;
  seed: number;
  initializer: "current" | "constructive" | "hypergraph_force";
  parentCandidateId?: string;
  placements: Record<string, PlacementTransform>;
  moves: PlacementMoveDiff[];
  copperPlan: PlacementCopperPlan;
  hardReport: PlacementHardReport;
  congestion: PlacementCongestionReport;
  pinEscape: PlacementPinEscapeReport;
  viaPressure: PlacementViaPressureReport;
  objectiveReport: PlacementObjectiveReport;
  legacyDiagnostics: { airwireCrossings: number; ratsnestLengthNm: number };
  phaseStats: Array<{ phase: string; elapsedMs: number; iterations: number; termination: string }>;
  warnings: string[];
  selected: boolean;
  selectionReason?: string;
}

export interface PlacementRunResult {
  runId: string;
  problem: PlacementProblem;
  candidates: PlacementCandidate[];
  frontierCandidateIds: string[];
  selectedCandidateId?: string;
  termination: PlacementTermination;
  searchComplete: boolean;
  elapsedMs: number;
  diagnostics: PlacementDiagnostic[];
}

export interface PlacementObjectivePolicy {
  weights: Partial<Record<PlacementObjectiveKind, number>>;
  priorities: PlacementObjectiveKind[];
}

export interface EngineeringPlacementOptions {
  projectId?: string;
  mode?: PlacementMovementMode;
  selectedInstanceIds?: string[];
  regions?: PlacementRegion[];
  seeds?: number[];
  candidateCount?: number;
  maxIterations?: number;
  localRefinementPasses?: number;
  gridNm?: number;
  capacityColumns?: number;
  capacityRows?: number;
  timeoutMs?: number;
  allowGeneratedOutlineResize?: boolean;
  objectivePolicy?: PlacementObjectivePolicy;
}
