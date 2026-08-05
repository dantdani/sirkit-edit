import type { ConstraintProgram } from "@/app/lib/constraints/types";
import type { ElectricalTruthReport } from "../electrical-truth";
import type { Vec2 } from "../geometry";
import type { LayerId } from "../layers";
import type { PcbBoard, Track, Via } from "../types";

export const ROUTING_SNAPSHOT_SCHEMA = "sirkit.routing-snapshot.v1" as const;
export const ROUTE_CANDIDATE_SCHEMA = "sirkit.route-candidate.v1" as const;
export const ROUTING_ENGINE_VERSION = "professional-routing/1.0.0" as const;
export const ROUTING_GEOMETRY_VERSION = "integer-nm-segments/1.0.0" as const;
export const ROUTING_TOLERANCE_NM = 1_000;
export const ROUTING_MIN_SEGMENT_NM = 10_000;

export type RouteOperationKind =
  | "interactive_route"
  | "route_connection"
  | "route_differential_pair"
  | "route_group"
  | "drag_route_item"
  | "reroute_selection"
  | "tune_single_path"
  | "tune_pair_skew"
  | "rip_up_scope"
  | "analyze_route";
export type ProfessionalRouteMode = "highlight_stop" | "walk_around" | "shove";
export type RoutePosture = "orthogonal" | "octilinear_a" | "octilinear_b" | "arbitrary";
export type RouteCandidateStatus = "preview_legal" | "preview_with_collisions" | "infeasible" | "budget_exhausted" | "unsupported" | "cancelled" | "stale" | "committed";
export type RouteSessionState = "idle" | "anchor_selected" | "previewing" | "preview_with_collision" | "via_preview" | "layer_transitioned" | "finishing" | "committing" | "cancelled" | "failed";

export interface RouteInputRevisionSet {
  designRevision: string;
  electricalRevision: string;
  componentLibraryRevisionSet: string;
  stackupRevision: string;
  constraintProgramRevision: string;
  zoneFillRevisionByLayer: Record<string, string>;
  protectedStateRevision: string;
  engineVersion: typeof ROUTING_ENGINE_VERSION;
}

export type RouteContactKind = "pad_contact" | "track_endpoint" | "interior_track_junction" | "via_contact" | "zone_plane_contact" | "branch_junction";

export interface RouteTopologyNode {
  nodeId: string;
  netId: number;
  position: Vec2;
  contactKind: RouteContactKind;
  objectRefs: string[];
  layerSet: LayerId[];
}
export interface RouteTopologyEdge {
  edgeId: string;
  netId: number;
  geometryRef: string;
  layerId: LayerId;
  endpointNodeIds: [string, string];
  start: Vec2;
  end: Vec2;
  widthNm: number;
  sourceObjectId: string;
  lineageObjectIds: string[];
}
export interface RouteTopologyTransition {
  viaId: string;
  netId: number;
  position: Vec2;
  connectedLayerSet: LayerId[];
  nodeIds: string[];
  span: [LayerId, LayerId];
  padstackRef?: string;
}
export interface RouteTopologyGraph {
  graphRevision: string;
  nodes: RouteTopologyNode[];
  edges: RouteTopologyEdge[];
  transitions: RouteTopologyTransition[];
  diagnostics: Array<{ code: string; objectIds: string[]; message: string }>;
}

export interface RoutingSnapshot {
  schemaVersion: typeof ROUTING_SNAPSHOT_SCHEMA;
  snapshotId: string;
  revisions: RouteInputRevisionSet;
  board: Readonly<PcbBoard>;
  topology: RouteTopologyGraph;
  electrical: ElectricalTruthReport;
  constraintProgram?: ConstraintProgram;
  manufacturingCapabilities: { throughVias: boolean; blindVias: false; buriedVias: false; microvias: false; arcs: false };
  geometryPolicy: { units: "nm"; toleranceNm: typeof ROUTING_TOLERANCE_NM; minimumSegmentNm: typeof ROUTING_MIN_SEGMENT_NM; version: typeof ROUTING_GEOMETRY_VERSION };
}

export interface RouteAnchor {
  anchorId: string;
  objectId: string;
  netId: number;
  layers: LayerId[];
  point: Vec2;
  contactKind: RouteContactKind;
  parameter?: number;
  priority: number;
  distanceNm: number;
  eligible: boolean;
  reason: string;
  fillRevision?: string;
}

export interface RouteRequest {
  requestId: string;
  operationKind: RouteOperationKind;
  targetIds: string[];
  startAnchor?: RouteAnchor;
  endAnchor?: RouteAnchor;
  routeMode: ProfessionalRouteMode;
  posture: RoutePosture;
  preferredLayer?: LayerId;
  allowedLayerSubset?: LayerId[];
  viaStrategy?: "through" | "none";
  hardConstraintIds: string[];
  softPreferenceIds: string[];
  mutationScope: { kind: "new_candidate" | "selected_objects" | "selected_path" | "selected_connection" | "selected_pair" | "selected_net"; objectIds: string[] };
  preservePolicy: "preserve_manual_imported_unknown" | "selected_manual_movable";
  searchBudget: { maxNodes: number; maxMovedObjects: number; maxIterations: number; timeoutMs: number };
  deterministicSeed: number;
  requestedBy: { actorId: string; kind: "human" | "ai" | "system" };
}

export interface RouteObjectDelta {
  createdTracks: Track[];
  createdVias: Via[];
  modifiedTracks: Array<{ before: Track; after: Track }>;
  modifiedVias: Array<{ before: Via; after: Via }>;
  removedTracks: Track[];
  removedVias: Via[];
}

export interface RouteConstraintEvaluation {
  constraintId: string;
  state: "passed" | "failed" | "unsupported" | "not_evaluated" | "stale" | "not_applicable";
  evaluatorId: string;
  objectIds: string[];
  explanation: string;
  measured?: { value: number; unit: "nm" | "count" | "nm_per_nm" };
  required?: { value: number; unit: "nm" | "count" | "nm_per_nm" };
}

export interface RouteValidationReport {
  horizon: "interactive_local" | "authoritative_commit";
  legal: boolean;
  violations: Array<{ code: string; state: "failed" | "unsupported" | "not_evaluated" | "stale"; objectIds: string[]; message: string }>;
  constraintEvaluations: RouteConstraintEvaluation[];
  globalState: "not_yet_evaluated" | "evaluated" | "stale";
}

export interface RouteConnectivityDelta {
  intendedRemainingBefore: number;
  intendedRemainingAfter: number;
  opensClosed: number;
  remainingOpens: number;
  newShortIds: string[];
  ambiguousContactIds: string[];
  zoneEvidence: "current" | "dirty" | "stale";
}

export interface RouteMeasurement {
  measurementId: string;
  netId: number;
  endpointA: string;
  endpointB: string;
  pathEdgeIds: string[];
  branchPolicy: "explicit_endpoints_unique_path";
  planarLengthByLayer: Partial<Record<LayerId, number>>;
  viaContributionByVia: Array<{ viaId: string; lengthNm: number; policyId: string }>;
  totalPhysicalModelLength: number | null;
  lengthPolicyId: string;
  status: "measured" | "disconnected" | "ambiguous_path" | "stale" | "unsupported";
  pairId?: string;
  skewNm?: number;
  coupledLengthNm?: number;
  uncoupledLengthNm?: number;
  evidenceRefs: string[];
}

export interface RouteCandidate {
  schemaVersion: typeof ROUTE_CANDIDATE_SCHEMA;
  candidateId: string;
  candidateDigest: string;
  request: RouteRequest;
  inputRevisionSet: RouteInputRevisionSet;
  settingsDigest: string;
  seed: number;
  delta: RouteObjectDelta;
  topologyDelta: { splitSourceIds: string[]; createdNodeIds: string[]; createdEdgeIds: string[] };
  shoveDisplacements: Array<{ objectId: string; before: unknown; after: unknown }>;
  springbackState: Array<{ objectId: string; original: unknown; current: unknown }>;
  measurements: RouteMeasurement[];
  localValidation: RouteValidationReport;
  electricalDelta: RouteConnectivityDelta;
  constraintEvaluation: RouteConstraintEvaluation[];
  unresolvedEvidence: string[];
  warnings: string[];
  status: RouteCandidateStatus;
}

export interface RouteResult {
  request: RouteRequest;
  selectedCandidate?: RouteCandidate;
  candidateSummaries: Array<{ candidateId: string; status: RouteCandidateStatus; hardViolations: number; createdLengthNm: number; viaCount: number }>;
  completionState: "completed" | "incomplete" | "failed" | "unsupported" | "stale";
  connectivityImpact?: RouteConnectivityDelta;
  remainingOpens: number;
  newShorts: string[];
  hardViolations: string[];
  unsupportedRequirements: string[];
  staleEvidence: string[];
  performanceMetrics: Record<string, number>;
  replayBundleRef: string;
}

export interface ViaTransitionChoice {
  choiceId: string;
  fromLayer: LayerId;
  targetLayer: LayerId;
  viaType: "through";
  physicalSpan: [LayerId, LayerId];
  connectedLayers: LayerId[];
  legal: boolean;
  constraintIds: string[];
  explanation: string;
}
