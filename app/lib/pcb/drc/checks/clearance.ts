// Copper clearance (#1) + edge clearance (#7) — PCB Stage 12.
//
// Reuses Stage 7's `checkClearance` VERBATIM at batch scope: every track/via is
// treated as a candidate and run against everything else (ignoring itself), with
// the effective per-net-class clearance + edge keep-out. checkClearance returns
// the first offender (pads < tracks < vias < edge), classified here into a
// `clearance` or `edgeClearance` violation.
//
// A touching/overlapping different-net pair (distance ≤ 0) is a SHORT, not a
// clearance issue — the connectivity check owns it, so we only emit `clearance`
// for a real positive gap that's too small.

import { checkClearance } from "../../route-tool";
import type { CopperItemRef } from "../../connectivity-board";
import type { LayerId } from "../../layers";
import type { Vec2 } from "../../geometry";
import type { DrcCheckContext, DrcViolation } from "../types";
import { fmtMm, layerName, refKey, violationId } from "../format";
import { trackInsideBoard, viaInsideBoard } from "./containment";

export function checkCopperClearance(ctx: DrcCheckContext): DrcViolation[] {
  const { board } = ctx;
  const out: DrcViolation[] = [];
  const seenPairs = new Set<string>();
  const seenEdge = new Set<string>();

  const emitClearance = (
    cand: CopperItemRef,
    loc: Vec2,
    layer: LayerId,
    blockedBy: CopperItemRef,
    distance: number,
    threshold: number,
  ): void => {
    const key = [refKey(cand), refKey(blockedBy)].sort().join("|");
    if (seenPairs.has(key)) return;
    seenPairs.add(key);
    const items = [cand, blockedBy];
    const where = layerName(layer);
    out.push({
      id: violationId("clearance", items, distance, threshold),
      kind: "clearance",
      severity: "error",
      items,
      layer,
      location: loc,
      measuredNm: distance,
      thresholdNm: threshold,
      summary: `Two ${where} objects are ${fmtMm(distance)} mm apart; need ≥ ${fmtMm(threshold)} mm.`,
      detail: `A copper clearance violation on ${where}: the gap measures ${fmtMm(distance)} mm, but this fab needs at least ${fmtMm(threshold)} mm between copper on different nets. Widen the spacing or move one object.`,
    });
  };

  const emitEdge = (
    cand: CopperItemRef,
    loc: Vec2,
    layer: LayerId,
    distance: number,
    threshold: number,
  ): void => {
    const key = refKey(cand);
    if (seenEdge.has(key)) return;
    seenEdge.add(key);
    const items = [cand];
    out.push({
      id: violationId("edgeClearance", items, distance, threshold),
      kind: "edgeClearance",
      severity: "error",
      items,
      layer,
      location: loc,
      measuredNm: distance,
      thresholdNm: threshold,
      summary: `Copper is ${fmtMm(distance)} mm from the board edge; need ≥ ${fmtMm(threshold)} mm.`,
      detail: `Copper sits ${fmtMm(distance)} mm from the board outline — inside the ${fmtMm(threshold)} mm edge keep-out this fab requires (a negative value means it crosses the edge). Pull the copper inward.`,
    });
  };

  for (const track of board.tracks) {
    const eff = ctx.eff(track.netId);
    const res = checkClearance(board, {
      candidateSegments: [track],
      ignoreItemIds: new Set([track.id]),
      netId: track.netId,
      clearance: eff.clearanceNm,
      edgeClearance: eff.minEdgeClearanceNm,
    });
    if (res.legal) continue;
    const cand: CopperItemRef = { kind: "track", id: track.id };
    const loc: Vec2 = { x: (track.start.x + track.end.x) / 2, y: (track.start.y + track.end.y) / 2 };
    if (res.blockedByEdge) {
      if (trackInsideBoard(board, track)) emitEdge(cand, loc, track.layer, res.distance ?? 0, eff.minEdgeClearanceNm);
    } else if (res.blockedBy && (res.distance ?? 0) > 0) {
      emitClearance(cand, loc, track.layer, res.blockedBy, res.distance ?? 0, eff.clearanceNm);
    }
  }

  for (const via of board.vias) {
    const eff = ctx.eff(via.netId);
    const res = checkClearance(board, {
      candidateSegments: [],
      candidateVias: [via],
      ignoreItemIds: new Set([via.id]),
      netId: via.netId,
      clearance: eff.clearanceNm,
      edgeClearance: eff.minEdgeClearanceNm,
    });
    if (res.legal) continue;
    const cand: CopperItemRef = { kind: "via", id: via.id };
    const loc: Vec2 = { ...via.at };
    if (res.blockedByEdge) {
      if (viaInsideBoard(board, via)) emitEdge(cand, loc, via.layers[0], res.distance ?? 0, eff.minEdgeClearanceNm);
    } else if (res.blockedBy && (res.distance ?? 0) > 0) {
      emitClearance(cand, loc, via.layers[0], res.blockedBy, res.distance ?? 0, eff.clearanceNm);
    }
  }

  return out;
}
