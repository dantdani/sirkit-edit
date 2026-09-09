// DRC rules + violations (PCB Stage 12) — PINNED cross-stage contract.
// Stage 9 (auto-DRC-on-autoroute) and Stage 14 (export gate) consume `DrcResult`.
// All physical values are integer nanometers (see units.ts).

import type { LayerId } from "../layers";
import type { PcbBoard } from "../types";
import type { BoardConnectivity, CopperItemRef } from "../connectivity-board";
import type { NetClassId } from "../netclass";
import type { ElectricalTruthReport } from "../electrical-truth";

export type DrcCheckKind =
  | "clearance"
  | "minTrackWidth"
  | "viaOuterDiameter"
  | "viaDrill"
  | "annularRing"
  | "pthAnnularRing"
  | "holeToHole"
  | "edgeClearance"
  | "courtyardOverlap"
  | "silkOverPad"
  | "unconnected"
  | "incompleteNet"
  | "footprintOutsideBoard"
  | "padOutsideBoard"
  | "holeOutsideBoard"
  | "trackOutsideBoard"
  | "viaOutsideBoard"
  | "zoneOutsideBoard"
  | "referenceTextOutsideBoard"
  | "disabledLayer"
  | "unsupportedViaSpan"
  | "short";

export type DrcSeverity = "error" | "warning" | "info";

export interface DrcRuleSet {
  clearanceNm: number;
  minTrackWidthNm: number;
  minViaOuterNm: number;
  minViaDrillNm: number;
  /** VIA annular ring only: (viaOuter - viaDrill) / 2. Not a plated-through-hole limit. */
  minAnnularRingNm: number;
  /**
   * [B16-C.4] PLATED-THROUGH-HOLE (component pad) annular ring: the narrowest
   * copper between the hole wall and the pad edge, measured per pad. Split
   * from the via ring because the manufacturer states separate limits (JLCPCB
   * two-layer: via ring follows from the 0.15/0.25 mm hole/diameter pair, PTH
   * ring is a stated 0.25 mm recommended / 0.18 mm absolute minimum).
   */
  minPthAnnularRingNm: number;
  minHoleToHoleNm: number;
  minEdgeClearanceNm: number;
  minSilkPadClearanceNm: number; // silk-to-pad gap
  minCourtyardClearanceNm: number; // 0 = touching allowed, positive = required gap
}

export interface DrcRules {
  default: DrcRuleSet;
  perClass: Partial<Record<NetClassId, Partial<DrcRuleSet>>>; // sparse — only override what differs
  perNet?: Record<number, Partial<DrcRuleSet>>; // rare user tweak
}

export type DrcPresetId = "jlcpcb-2l" | "jlcpcb-4l" | "pcbway-standard" | "oshpark-4l";

export interface DrcPreset {
  id: DrcPresetId;
  name: string; // "JLCPCB economy 2-layer"
  fab: string; // "JLCPCB"
  version: number; // preset schema version — bump on breaking change
  verifiedAt: string; // ISO date the spec was last cross-checked
  specUrl: string; // link to the fab's capability page
  rules: DrcRules;
}

export interface DrcViolation {
  id: string; // stable per-run — hash of (kind, items, values)
  kind: DrcCheckKind;
  severity: DrcSeverity;
  items: CopperItemRef[]; // 1 for single-item checks, 2 for pair checks
  /** Exact non-copper model IDs (footprints, zones, text, etc.). */
  objectIds?: string[];
  layer?: LayerId; // where the violation is visible
  location: { x: number; y: number }; // zoom-to point (world nm)
  measuredNm: number; // the offending measurement
  thresholdNm: number; // the rule threshold
  summary: string; // <=120 chars, human, no codes
  detail: string; // 2-3 sentences with values in mm
  /** Stage 6 exact effective-rule lineage for this measurement. */
  constraintIds?: string[];
  constraintProgramHash?: string;
  ruleResolutionHash?: string;
}

export interface DrcResult {
  schemaVersion: "sirkit.pcb-drc.v2";
  checkVersion: "pcb-drc/2";
  execution: "completed" | "aborted";
  completedChecks: string[];
  /** Exact semantic board revision described by this result. */
  designRevision: string;
  ok: boolean; // true when zero errors
  violations: DrcViolation[]; // sorted: errors→warnings→info; within each by layer then location
  stats: {
    checkedItems: number;
    elapsedMs: number;
    perCheck: Partial<Record<DrcCheckKind, number>>; // count per kind
  };
  presetId?: DrcPresetId; // which preset was used
  /** Stage 6 source program plus the resolved manufacturing-input hash. */
  constraintProgramHash?: string;
  ruleResolutionHash?: string;
  electrical: {
    schemaVersion: ElectricalTruthReport["schemaVersion"];
    state: ElectricalTruthReport["realized"]["state"];
    requiredConnections: number;
    completedConnections: number;
    remainingConnections: number;
    stableNetIds: string[];
    shortIds: string[];
    orphanObjectIds: string[];
    unresolvedCodes: string[];
  };
  /** DRC-only execution summary. This is not a fabrication-readiness claim. */
  summary: {
    state: "passed" | "warnings" | "failed" | "incomplete";
    errors: number;
    warnings: number;
    incompleteNets: number;
    unroutedConnections: number;
    message: string;
  };
}

/**
 * Shared, precomputed context every check receives from `runDrc` — the board,
 * the merged rules, one connectivity pass, and a memoized effective-rule lookup
 * (default → net-class → per-net). Built once per run. `buildDrcContext` in
 * run-drc.ts constructs it; tests call individual checks with it directly.
 */
export interface DrcCheckContext {
  board: PcbBoard;
  rules: DrcRules;
  electricalTruth: ElectricalTruthReport;
  connectivity: BoardConnectivity;
  /** effectiveRules(rules, netId, getNetClass(board, netId)), memoized per netId. */
  eff: (netId: number) => DrcRuleSet;
  constraintProgramHash?: string;
  ruleResolutionHash?: string;
  ruleLineage?: (netId: number) => string[];
}
