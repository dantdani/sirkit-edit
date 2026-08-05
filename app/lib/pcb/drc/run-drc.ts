// DRC engine (PCB Stage 12). One connectivity pass + the ten checks, run in the
// pinned order, concatenated, then sorted deterministically (errors → warnings →
// info; within a severity by layer, then location, then id).
//
// Perf: << 200 ms on the demo fixture (≤ 15 items). Each check that needs a
// broad phase builds its own flatbush (clearance reuses Stage 7's checkClearance,
// which builds its own). No cross-run caching — a fresh run rebuilds everything.

import type { PcbBoard } from "../types";
import { computeElectricalTruth, type ElectricalTruthReport } from "../electrical-truth";
import { getNetClass } from "../netclass";
import type {
  DrcRules,
  DrcResult,
  DrcViolation,
  DrcCheckContext,
  DrcCheckKind,
  DrcPresetId,
  DrcRuleSet,
} from "./types";
import { effectiveRules } from "./rules";
import { checkCopperClearance } from "./checks/clearance";
import { checkMinTrackWidth, checkVia, checkHoleToHole, checkCourtyardOverlap } from "./checks/geometry";
import { checkSilkOverPad } from "./checks/silk";
import { checkUnconnectedAndShorts } from "./checks/connectivity";
import { checkBoardContainmentAndLayers } from "./checks/containment";
import { checkZoneFills } from "../zones/drc-check"; // Stage 11
import { constraintSemanticHash, stableConstraintId } from "@/app/lib/constraints/stable";
import type { CopperItemRef } from "../connectivity-board";
import type { ConstraintProgram } from "@/app/lib/constraints/types";

export interface RunDrcOptions {
  presetId?: DrcPresetId; // for stats + reporting
  abortSignal?: AbortSignal; // for long-running boards
  /** Reuse the exact report already computed for this revision. */
  electricalReport?: ElectricalTruthReport;
  /** Exact Stage 6 program to use for this run (for example, with a selected manufacturing profile). */
  constraintProgram?: ConstraintProgram;
}

/** Precompute the shared per-run context: connectivity + memoized effective rules. */
export function buildDrcContext(
  board: PcbBoard,
  rules: DrcRules,
  electricalTruth: ElectricalTruthReport = computeElectricalTruth(board),
): DrcCheckContext {
  const connectivity = electricalTruth.realized.connectivity;
  const cache = new Map<number, DrcRuleSet>();
  const lineage = new Map<number, string[]>();
  const constraintProgramHash = board.constraintState?.activeProgram?.programHash;
  const manufacturingRuleId = stableConstraintId("manufacturing-rule", rules);
  const ruleResolutionHash = constraintSemanticHash({ constraintProgramHash: constraintProgramHash ?? "legacy-uncompiled", manufacturingRuleId });
  const eff = (netId: number): DrcRuleSet => {
    let r = cache.get(netId);
    if (!r) {
      const design = getNetClass(board, netId);
      const fabrication = effectiveRules(rules, netId, design);
      const constrained = design.constraintProgramHash !== undefined || board.netClassing?.assignments[netId] !== undefined;
      r = constrained
        ? {
            ...fabrication,
            clearanceNm: Math.max(fabrication.clearanceNm, design.clearance),
            minTrackWidthNm: Math.max(fabrication.minTrackWidthNm, design.trackWidth),
            minViaOuterNm: Math.max(fabrication.minViaOuterNm, design.viaSize),
            minViaDrillNm: Math.max(fabrication.minViaDrillNm, design.viaDrill),
            minAnnularRingNm: Math.max(
              fabrication.minAnnularRingNm,
              Math.max(0, Math.round((design.viaSize - design.viaDrill) / 2)),
            ),
          }
        : fabrication;
      cache.set(netId, r);
      lineage.set(netId, [...new Set([manufacturingRuleId, ...(design.constraintIds ?? [])])].sort());
    }
    return r;
  };
  return { board, rules, electricalTruth, connectivity, eff, constraintProgramHash, ruleResolutionHash, ruleLineage: (netId) => {
    if (!lineage.has(netId)) eff(netId);
    return lineage.get(netId) ?? [manufacturingRuleId];
  } };
}

function netIdForRef(board: PcbBoard, ref: CopperItemRef): number | undefined {
  if (ref.kind === "track") return board.tracks.find((item) => item.id === ref.id)?.netId;
  if (ref.kind === "via") return board.vias.find((item) => item.id === ref.id)?.netId;
  if (ref.kind === "zone-region") return board.zones.find((item) => item.id === ref.zoneId)?.netId;
  return board.footprints.find((item) => item.id === ref.instanceId)?.padNets[ref.padNumber];
}

const SEVERITY_RANK: Record<DrcViolation["severity"], number> = { error: 0, warning: 1, info: 2 };

function compareViolations(a: DrcViolation, b: DrcViolation): number {
  const sev = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (sev !== 0) return sev;
  const la = a.layer ?? "~"; // undefined sorts last
  const lb = b.layer ?? "~";
  if (la !== lb) return la < lb ? -1 : 1;
  if (a.location.y !== b.location.y) return a.location.y - b.location.y;
  if (a.location.x !== b.location.x) return a.location.x - b.location.x;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; // final stable tiebreak
}

export function runDrc(board: PcbBoard, rules: DrcRules, options?: RunDrcOptions): DrcResult {
  const t0 = performance.now();
  const effectiveBoard = options?.constraintProgram
    ? {
        ...board,
        constraintState: {
          ...(board.constraintState ?? { schemaVersion: 1 as const, documents: [], waivers: [], legacyMigration: { version: 1 as const, sourceHash: "ephemeral" }, history: [] }),
          activeProgram: options.constraintProgram,
        },
      }
    : board;
  const ctx = buildDrcContext(effectiveBoard, rules, options?.electricalReport ?? computeElectricalTruth(board));

  // Pinned order. Grouped functions cover multiple kinds: clearance also emits
  // edgeClearance (#7); checkVia emits viaOuterDiameter/viaDrill/annularRing.
  const checks: Array<{ code: string; run: () => DrcViolation[] }> = [
    { code: "containment-and-layers", run: () => checkBoardContainmentAndLayers(ctx) },
    { code: "copper-clearance", run: () => checkCopperClearance(ctx) }, // #1 clearance + #7 edge
    { code: "minimum-track-width", run: () => checkMinTrackWidth(ctx) }, // #2
    { code: "via-geometry", run: () => checkVia(ctx) }, // #3 #4 #5
    { code: "hole-to-hole", run: () => checkHoleToHole(ctx) }, // #6
    { code: "courtyard-overlap", run: () => checkCourtyardOverlap(ctx) }, // #8
    { code: "silkscreen", run: () => checkSilkOverPad(ctx) }, // #9
    { code: "electrical-connectivity", run: () => checkUnconnectedAndShorts(ctx) }, // #10
    { code: "zone-fills", run: () => checkZoneFills(ctx) },
  ];

  const violations: DrcViolation[] = [];
  const completedChecks: string[] = [];
  for (const check of checks) {
    if (options?.abortSignal?.aborted) break;
    violations.push(...check.run());
    completedChecks.push(check.code);
  }
  for (const violation of violations) {
    const netIds = [...new Set(violation.items.map((item) => netIdForRef(board, item)).filter((id): id is number => id !== undefined))];
    violation.constraintIds = [...new Set(netIds.flatMap((netId) => ctx.ruleLineage?.(netId) ?? []))].sort();
    violation.constraintProgramHash = ctx.constraintProgramHash;
    violation.ruleResolutionHash = ctx.ruleResolutionHash;
  }
  const execution = completedChecks.length === checks.length ? "completed" : "aborted";

  violations.sort(compareViolations);

  const perCheck: Partial<Record<DrcCheckKind, number>> = {};
  for (const v of violations) perCheck[v.kind] = (perCheck[v.kind] ?? 0) + 1;

  let padCount = 0;
  for (const f of board.footprints) padCount += f.def.pads.length;
  const checkedItems = board.tracks.length + board.vias.length + padCount;
  const errors = violations.filter((violation) => violation.severity === "error").length;
  const warnings = violations.filter((violation) => violation.severity === "warning").length;
  const incompleteNets = violations.filter((violation) => violation.kind === "incompleteNet").length;
  const unroutedConnections = ctx.electricalTruth.realized.remainingConnections;
  const state = execution !== "completed" ? "incomplete" : errors > 0 ? "failed" : warnings > 0 ? "warnings" : "passed";
  const message = execution !== "completed"
    ? `DRC incomplete: ${completedChecks.length}/${checks.length} check stages ran.`
    : errors > 0
    ? unroutedConnections > 0
      ? `DRC failed: ${unroutedConnections} unrouted connection${unroutedConnections === 1 ? "" : "s"} and ${errors} blocking issue${errors === 1 ? "" : "s"}.`
      : `DRC failed: ${errors} blocking issue${errors === 1 ? "" : "s"}.`
    : warnings > 0
      ? `Needs review: ${warnings} warning${warnings === 1 ? "" : "s"}.`
      : "DRC completed with no blocking violations.";

  return {
    schemaVersion: "sirkit.pcb-drc.v2",
    checkVersion: "pcb-drc/2",
    execution,
    completedChecks,
    designRevision: ctx.electricalTruth.designRevision,
    ok: execution === "completed" && errors === 0,
    violations,
    stats: { checkedItems, elapsedMs: performance.now() - t0, perCheck },
    presetId: options?.presetId,
    constraintProgramHash: ctx.constraintProgramHash,
    ruleResolutionHash: ctx.ruleResolutionHash,
    electrical: {
      schemaVersion: ctx.electricalTruth.schemaVersion,
      state: ctx.electricalTruth.realized.state,
      requiredConnections: ctx.electricalTruth.realized.requiredConnections,
      completedConnections: ctx.electricalTruth.realized.completedConnections,
      remainingConnections: ctx.electricalTruth.realized.remainingConnections,
      stableNetIds: ctx.electricalTruth.nets.map((net) => net.stableNetId).sort(),
      shortIds: ctx.electricalTruth.shorts.map((short) => short.id),
      orphanObjectIds: ctx.electricalTruth.orphanCopper.map((orphan) => orphan.objectId),
      unresolvedCodes: [...new Set(ctx.electricalTruth.unresolved.map((item) => item.code))].sort(),
    },
    summary: { state, errors, warnings, incompleteNets, unroutedConnections, message },
  };
}
