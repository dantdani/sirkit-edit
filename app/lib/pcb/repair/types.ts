import type { DrcResult, DrcRules } from "../drc/types";
import type { EditCommand } from "../edit/commands";
import type { PcbBoard, Track, Via } from "../types";
import type { NormalizedDrcViolation, RepairFixability } from "../ai/violation-normalizer";

export type RepairExecutionMode = "review_every_change" | "safe_fixes_automatically" | "fully_automatic_within_constraints";

export type RepairAction =
  | { kind: "edit"; command: EditCommand }
  | { kind: "refill_zones"; zoneIds: string[] }
  | { kind: "reroute_nets"; netIds: number[] }
  | { kind: "manual_review" };

export interface RepairFix {
  id: string;
  title: string;
  reason: string;
  fixability: RepairFixability;
  requiresApproval: boolean;
  sourceViolationIds: string[];
  affectedObjectIds: string[];
  affectedNetIds: number[];
  action: RepairAction;
}

export interface RepairGroup {
  id: string;
  title: string;
  rootCause: string;
  violationIds: string[];
  fixIds: string[];
  requiresApproval: boolean;
}

export interface PCBRepairPlan {
  id: string;
  baseRevisionId: string;
  mode: RepairExecutionMode;
  createdAt: string;
  violations: NormalizedDrcViolation[];
  groups: RepairGroup[];
  fixes: RepairFix[];
  rules: DrcRules;
  drcBefore: DrcResult;
}

export interface RepairMetrics {
  errorsBefore: number;
  errorsAfter: number;
  warningsBefore: number;
  warningsAfter: number;
  unroutedBefore: number;
  unroutedAfter: number;
  totalTrackLengthBefore: number;
  totalTrackLengthAfter: number;
  viaCountBefore: number;
  viaCountAfter: number;
  movedFootprints: number;
  reroutedNets: string[];
  newViolationsIntroduced: number;
}

export interface RepairTransactionPreview {
  id: string;
  planId: string;
  baseRevisionId: string;
  selectedFixIds: string[];
  sourceViolationIds: string[];
  affectedObjectIds: string[];
  candidateBoard: PcbBoard;
  drcBefore: DrcResult;
  drcAfter: DrcResult;
  metrics: RepairMetrics;
  newViolationIds: string[];
  resolvedViolationIds: string[];
  blockers: string[];
  status: "preview" | "approved" | "committed" | "rejected";
}

export interface AutorouteRepairResult {
  tracks: Track[];
  vias: Via[];
}

export type AutorouteRepairExecutor = (board: PcbBoard, netIds: number[]) => Promise<AutorouteRepairResult>;
