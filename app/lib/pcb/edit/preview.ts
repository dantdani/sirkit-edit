/**
 * Live preview DRC for edit commands (PCB Stage 17 Phase B) — PURE, no
 * React/Pixi. `previewEdits` dry-runs a command batch on a throwaway immer
 * draft and runs SINGLE-ITEM-SCOPE checks against only the touched items'
 * neighborhoods — never the full `runDrc`:
 *
 * - min track width / via outer / drill / annular ring: the landed Stage 12
 *   check functions over a board scoped to the touched items (they read only
 *   `ctx.board` + `ctx.eff`, verified — the connectivity slot is a facade).
 * - copper clearance + edge clearance: Stage 7's `checkClearance` (flatbush
 *   per call), one call per touched item's net group.
 *
 * Violations are HINTS: they never block a commit ("live DRC never blocks");
 * the same board state then also surfaces in the DRC panel's batch run.
 * This module is also the AI-assist gate's dry-run — keep it pure.
 */

import type { PcbBoard, Track } from "../types";
import type { LayerId } from "../layers";
import type { Vec2 } from "../geometry";
import type { CopperItemRef } from "../connectivity-board";
import type { BoardConnectivity } from "../connectivity-board";
import type { DrcCheckContext, DrcRules, DrcRuleSet, DrcViolation } from "../drc/types";
import { effectiveRules } from "../drc/rules";
import { checkMinTrackWidth, checkVia } from "../drc/checks/geometry";
import { fmtMm, layerName, violationId } from "../drc/format";
import { getPreset, DEFAULT_PRESET_ID } from "../drc/presets";
import { getNetClass } from "../netclass";
import { checkClearance, type ClearanceGuardResult } from "../route-tool";
import type { EditCommand } from "./commands";
import { validateCommand } from "./validate";
import { dryRunEdits } from "./apply";

export interface EditPreview {
  /** Validation errors — these DO block a commit (applyEdits rejects). */
  errors: string[];
  /** Preset violations the edit would create/keep — hints, never blocking. */
  violations: DrcViolation[];
}

/** Memoized default → class → per-net rule merge (mirrors run-drc's ctx.eff). */
function makeEff(board: PcbBoard, rules: DrcRules): (netId: number) => DrcRuleSet {
  const cache = new Map<number, DrcRuleSet>();
  return (netId) => {
    let r = cache.get(netId);
    if (!r) {
      r = effectiveRules(rules, netId, getNetClass(board, netId));
      cache.set(netId, r);
    }
    return r;
  };
}

/** Track/via ids a batch touches — deletes excluded (nothing left to check). */
function touchedCopper(cmds: EditCommand[]): { trackIds: Set<string>; viaIds: Set<string> } {
  const trackIds = new Set<string>();
  const viaIds = new Set<string>();
  for (const cmd of cmds) {
    switch (cmd.op) {
      case "set-track-width":
        for (const id of cmd.ids) trackIds.add(id);
        break;
      case "set-item-layer":
      case "move-items":
      case "rotate-items":
        for (const ref of cmd.refs) {
          if (ref.kind === "track") trackIds.add(ref.id);
          else if (ref.kind === "via") viaIds.add(ref.id);
        }
        break;
      case "set-position":
        if (cmd.ref.kind === "via") viaIds.add(cmd.ref.id);
        break;
      case "set-via-padstack": // Phase C
        for (const id of cmd.viaIds) viaIds.add(id);
        break;
      default:
        break;
    }
  }
  return { trackIds, viaIds };
}

function trackMid(t: Track): Vec2 {
  return { x: (t.start.x + t.end.x) / 2, y: (t.start.y + t.end.y) / 2 };
}

/** Map a clearance-guard block to a Stage 12-voiced violation. */
function clearanceViolation(
  selfRef: CopperItemRef,
  layer: LayerId | undefined,
  location: Vec2,
  res: ClearanceGuardResult,
  eff: DrcRuleSet,
): DrcViolation | null {
  if (res.legal) return null;
  const dist = res.distance ?? 0;
  if (res.blockedByEdge) {
    return {
      id: violationId("edgeClearance", [selfRef], dist, eff.minEdgeClearanceNm),
      kind: "edgeClearance",
      severity: "error",
      items: [selfRef],
      layer,
      location,
      measuredNm: dist,
      thresholdNm: eff.minEdgeClearanceNm,
      summary: `Copper is ${fmtMm(dist)} mm from the board edge; need ≥ ${fmtMm(eff.minEdgeClearanceNm)} mm (a negative value means it crosses the edge).`,
      detail: `This fab needs ${fmtMm(eff.minEdgeClearanceNm)} mm between copper and the board outline. Pull the copper inward.`,
    };
  }
  const items: CopperItemRef[] = res.blockedBy ? [selfRef, res.blockedBy] : [selfRef];
  const where = layerName(layer);
  const short = dist <= 0;
  return {
    id: violationId(short ? "short" : "clearance", items, dist, eff.clearanceNm),
    kind: short ? "short" : "clearance",
    severity: "error",
    items,
    layer,
    location,
    measuredNm: dist,
    thresholdNm: short ? 0 : eff.clearanceNm,
    summary: short
      ? `Copper on ${where} touches another net's copper — that's a short.`
      : `Two ${where} objects are ${fmtMm(dist)} mm apart; need ≥ ${fmtMm(eff.clearanceNm)} mm.`,
    detail: short
      ? `The edited copper overlaps copper on a different net. Move it clear or reroute.`
      : `This fab needs ${fmtMm(eff.clearanceNm)} mm between different-net copper. Widen the spacing or move one object.`,
  };
}

/**
 * Dry-run `cmds` and check ONLY the touched items against `rules` (defaults
 * to the jlcpcb-2l preset — pass the DRC panel's active preset rules).
 * Pure and synchronous; target < 20 ms at demo scale so a 150 ms debounce
 * keeps the warning row under the field honest.
 */
export function previewEdits(
  board: PcbBoard,
  cmds: EditCommand[],
  rules: DrcRules = getPreset(DEFAULT_PRESET_ID).rules,
): EditPreview {
  const errors = cmds.flatMap((cmd) => validateCommand(board, cmd));
  if (errors.length > 0 || cmds.length === 0) {
    return { errors, violations: [] };
  }

  const next = dryRunEdits(board, cmds);
  const { trackIds, viaIds } = touchedCopper(cmds);
  const tracks = next.tracks.filter((t) => trackIds.has(t.id));
  const vias = next.vias.filter((v) => viaIds.has(v.id));
  if (tracks.length === 0 && vias.length === 0) {
    return { errors: [], violations: [] };
  }

  const eff = makeEff(next, rules);
  const violations: DrcViolation[] = [];

  // Geometry checks — the landed Stage 12 functions over a scoped board.
  // They read only ctx.board and ctx.eff; the connectivity slot is a facade.
  const scopedCtx: DrcCheckContext = {
    board: { ...next, tracks, vias },
    rules,
    connectivity: undefined as unknown as BoardConnectivity,
    eff,
  };
  violations.push(...checkMinTrackWidth(scopedCtx), ...checkVia(scopedCtx));

  // Clearance + edge — one guard call per touched item, self excluded.
  for (const t of tracks) {
    const r = eff(t.netId);
    const res = checkClearance(next, {
      candidateSegments: [t],
      ignoreItemIds: new Set([t.id]),
      netId: t.netId,
      clearance: r.clearanceNm,
      edgeClearance: r.minEdgeClearanceNm,
    });
    const v = clearanceViolation({ kind: "track", id: t.id }, t.layer, trackMid(t), res, r);
    if (v) violations.push(v);
  }
  for (const via of vias) {
    const r = eff(via.netId);
    const res = checkClearance(next, {
      candidateSegments: [],
      candidateVias: [via],
      ignoreItemIds: new Set([via.id]),
      netId: via.netId,
      clearance: r.clearanceNm,
      edgeClearance: r.minEdgeClearanceNm,
    });
    const v = clearanceViolation(
      { kind: "via", id: via.id },
      via.layers[0],
      { ...via.at },
      res,
      r,
    );
    if (v) violations.push(v);
  }

  // Deduplicate (a track and its neighbor can both report the same pair).
  const seen = new Set<string>();
  return {
    errors: [],
    violations: violations.filter((v) => {
      if (seen.has(v.id)) return false;
      seen.add(v.id);
      return true;
    }),
  };
}

/** One warning line for a field's hint row: worst violation first. */
export function previewSummary(preview: EditPreview): string | null {
  if (preview.errors.length > 0) return preview.errors[0];
  return preview.violations[0]?.summary ?? null;
}
