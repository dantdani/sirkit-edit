// DRC engine (PCB Stage 12). One connectivity pass + the ten checks, run in the
// pinned order, concatenated, then sorted deterministically (errors → warnings →
// info; within a severity by layer, then location, then id).
//
// Perf: << 200 ms on the demo fixture (≤ 15 items). Each check that needs a
// broad phase builds its own flatbush (clearance reuses Stage 7's checkClearance,
// which builds its own). No cross-run caching — a fresh run rebuilds everything.

import type { PcbBoard } from "../types";
import { computeConnectivity } from "../connectivity-board";
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
import { checkZoneFills } from "../zones/drc-check"; // Stage 11

export interface RunDrcOptions {
  presetId?: DrcPresetId; // for stats + reporting
  abortSignal?: AbortSignal; // for long-running boards
}

/** Precompute the shared per-run context: connectivity + memoized effective rules. */
export function buildDrcContext(board: PcbBoard, rules: DrcRules): DrcCheckContext {
  const connectivity = computeConnectivity(board);
  const cache = new Map<number, DrcRuleSet>();
  const eff = (netId: number): DrcRuleSet => {
    let r = cache.get(netId);
    if (!r) {
      r = effectiveRules(rules, netId, getNetClass(board, netId));
      cache.set(netId, r);
    }
    return r;
  };
  return { board, rules, connectivity, eff };
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
  const ctx = buildDrcContext(board, rules);

  // Pinned order. Grouped functions cover multiple kinds: clearance also emits
  // edgeClearance (#7); checkVia emits viaOuterDiameter/viaDrill/annularRing.
  const checks: (() => DrcViolation[])[] = [
    () => checkCopperClearance(ctx), // #1 clearance + #7 edge
    () => checkMinTrackWidth(ctx), // #2
    () => checkVia(ctx), // #3 #4 #5
    () => checkHoleToHole(ctx), // #6
    () => checkCourtyardOverlap(ctx), // #8
    () => checkSilkOverPad(ctx), // #9
    () => checkUnconnectedAndShorts(ctx), // #10 unconnected + short
    () => checkZoneFills(ctx), // Stage 11: zone clearance + zone-to-edge + no-net warning
  ];

  const violations: DrcViolation[] = [];
  for (const check of checks) {
    if (options?.abortSignal?.aborted) break;
    violations.push(...check());
  }

  violations.sort(compareViolations);

  const perCheck: Partial<Record<DrcCheckKind, number>> = {};
  for (const v of violations) perCheck[v.kind] = (perCheck[v.kind] ?? 0) + 1;

  let padCount = 0;
  for (const f of board.footprints) padCount += f.def.pads.length;
  const checkedItems = board.tracks.length + board.vias.length + padCount;

  return {
    ok: violations.every((v) => v.severity !== "error"),
    violations,
    stats: { checkedItems, elapsedMs: performance.now() - t0, perCheck },
    presetId: options?.presetId,
  };
}
