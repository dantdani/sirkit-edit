import type { BBox, Vec2 } from "../geometry";
import type { LayerId } from "../layers";
import type { CopperItemRef } from "../connectivity-board";
import type { PcbBoard } from "../types";
import type { RoutingSpatialIndex } from "./spatial-index";

export const SMART_ROUTING_SCHEMA_VERSION = 1 as const;

export type SmartRouteMode = "direct" | "walk-around";
export type WalkDirection = "cw" | "ccw";
export type RoutingWorldItemKind = "track" | "via" | "pad" | "hole" | "zone" | "keepout";

export interface RoutingWorldItem {
  id: string;
  kind: RoutingWorldItemKind;
  netId: number;
  layers: readonly LayerId[];
  bbox: Readonly<BBox>;
  sourceRef?: CopperItemRef;
}
/** Immutable read model. `board` is read-only input; previews never mutate it. */
export interface RoutingWorld {
  schemaVersion: typeof SMART_ROUTING_SCHEMA_VERSION;
  revision: string;
  board: Readonly<PcbBoard>;
  items: readonly RoutingWorldItem[];
  spatial: RoutingSpatialIndex;
}

export type RoutingRuleField =
  | "trackWidthNm"
  | "clearanceNm"
  | "viaSizeNm"
  | "viaDrillNm"
  | "edgeClearanceNm"
  | "gridNm";

export interface RoutingRuleSource {
  field: RoutingRuleField;
  source: "manufacturing-floor" | "net-class" | "drc" | "board-preference" | "session";
  valueNm: number;
  explanation: string;
}

export interface EffectiveRoutingRules {
  schemaVersion: typeof SMART_ROUTING_SCHEMA_VERSION;
  trackWidthNm: number;
  clearanceNm: number;
  viaSizeNm: number;
  viaDrillNm: number;
  edgeClearanceNm: number;
  gridNm: number;
  sources: readonly RoutingRuleSource[];
  explanation: string;
}

export interface SmartRouteIntent {
  schemaVersion: typeof SMART_ROUTING_SCHEMA_VERSION;
  netId: number;
  layer: LayerId;
  start: Vec2;
  end: Vec2;
  movementPolicy: "keep-existing-copper-fixed";
  /** Stage 8 interaction policy. Highlight never detours; shove is handled by the professional solver. */
  routeMode?: "highlight_stop" | "walk_around" | "shove";
  /** Arbitrary permits one native straight segment at any angle. */
  posture?: "orthogonal" | "octilinear_a" | "octilinear_b" | "arbitrary";
  maxCandidates: number;
}

export type SmartRouteViolationCode =
  | "EMPTY_PATH"
  | "ENDPOINT_MISMATCH"
  | "NON_OCTILINEAR"
  | "SELF_INTERSECTION"
  | "CLEARANCE"
  | "BOARD_EDGE"
  | "KEEPOUT";

export interface SmartRouteViolation {
  code: SmartRouteViolationCode;
  message: string;
  segmentIndex?: number;
  blockedBy?: CopperItemRef;
  blockedByKeepoutId?: string;
  measuredNm?: number;
  requiredNm?: number;
}

export interface SmartRouteValidation {
  legal: boolean;
  violations: readonly SmartRouteViolation[];
}

export interface CandidateScoreBreakdown {
  length: number;
  bends: number;
  vias: number;
  movement: number;
  congestion: number;
  stability: number;
  total: number;
}

export interface SmartRouteCandidate {
  id: string;
  mode: SmartRouteMode;
  direction?: WalkDirection;
  points: readonly Vec2[];
  validation: SmartRouteValidation;
  score: CandidateScoreBreakdown;
  explanation: string;
}

export type SmartRouteStatus = "ready" | "walking-around" | "blocked";

export interface SmartRouteDiagnostics {
  worldRevision: string;
  elapsedMs: number;
  directCandidates: number;
  walkCandidates: number;
  consideredObstacleIds: readonly string[];
  rejectedReasons: readonly string[];
}

export interface SmartRouteResult {
  schemaVersion: typeof SMART_ROUTING_SCHEMA_VERSION;
  intent: SmartRouteIntent;
  rules: EffectiveRoutingRules;
  status: SmartRouteStatus;
  candidates: readonly SmartRouteCandidate[];
  selectedCandidateId?: string;
  diagnostics: SmartRouteDiagnostics;
  explanation: string;
}

export interface PreviewTransaction {
  schemaVersion: typeof SMART_ROUTING_SCHEMA_VERSION;
  id: string;
  baseWorldRevision: string;
  intent: SmartRouteIntent;
  state: "preview" | "committed" | "cancelled";
  candidates: readonly SmartRouteCandidate[];
  selectedCandidateId?: string;
}
