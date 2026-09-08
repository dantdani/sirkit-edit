/**
 * Rotation optimization (PCB Stage 8) — POST-PROCESS, not per-iteration.
 *
 * Force-directed runs with rotations fixed; afterwards each footprint scores
 * the four axis rotations {0, 90, 180, 270} by the sum of squared distances
 * from each of its connected pads to that pad's connected external pads, and
 * keeps the minimum (ties prefer 0, then 90, 180, 270). Scoring per-pad —
 * each pad measured against its OWN net's external pads rather than one
 * global centroid — subsumes the pinned single-centroid scheme and picks
 * meaningful rotations for multi-net ICs too.
 *
 * External pad positions are computed once from the force-directed positions
 * with every footprint's ORIGINAL rotation, so results don't depend on
 * processing order (deterministic by construction).
 *
 * Locked footprints keep their existing rotation and are omitted from the
 * returned map.
 */

import type { PcbBoard } from "../types";
import type { Vec2 } from "../geometry";
import { transformPoint } from "../geometry";
import { NM_PER_MM } from "../units";
import type { AutoPlaceRotation } from "./types";
import { compareCodePoints } from "@/app/lib/stable-compare";

const ROTATIONS: readonly AutoPlaceRotation[] = [0, 90, 180, 270];

/** Nearest axis rotation for footprints with no connections to vote. */
export function snapRotation(rotationDeg: number): AutoPlaceRotation {
  const norm = ((rotationDeg % 360) + 360) % 360;
  const snapped = (Math.round(norm / 90) * 90) % 360;
  return snapped as AutoPlaceRotation;
}

export function optimizeRotations(
  board: PcbBoard,
  positions: Map<string, Vec2>,
  lockedIds: ReadonlySet<string>,
): Map<string, AutoPlaceRotation> {
  // World pad positions per net at force-directed positions, original rotations.
  const padsByNet = new Map<number, { instId: string; pos: Vec2 }[]>();
  for (const inst of board.footprints) {
    const at = positions.get(inst.id) ?? inst.at;
    for (const pad of inst.def.pads) {
      const netId = inst.padNets[pad.number];
      if (netId === undefined || netId === 0) continue;
      let list = padsByNet.get(netId);
      if (!list) {
        list = [];
        padsByNet.set(netId, list);
      }
      list.push({ instId: inst.id, pos: transformPoint(pad.at, at, inst.rotationDeg, inst.side === "bottom") });
    }
  }

  const out = new Map<string, AutoPlaceRotation>();
  for (const inst of [...board.footprints].sort((a, b) => compareCodePoints(a.id, b.id))) {
    if (lockedIds.has(inst.id)) continue;
    const at = positions.get(inst.id) ?? inst.at;
    const mirror = inst.side === "bottom";

    // Each connected own pad + the external pads on its net (mm doubles —
    // nm² sums overflow 53-bit precision on large boards).
    const votes: { local: Vec2; targets: { x: number; y: number }[] }[] = [];
    for (const pad of inst.def.pads) {
      const netId = inst.padNets[pad.number];
      if (netId === undefined || netId === 0) continue;
      const targets = (padsByNet.get(netId) ?? [])
        .filter((p) => p.instId !== inst.id)
        .map((p) => ({ x: p.pos.x / NM_PER_MM, y: p.pos.y / NM_PER_MM }));
      if (targets.length > 0) votes.push({ local: pad.at, targets });
    }

    const allowed = inst.placementConstraints?.allowedRotations?.length
      ? ROTATIONS.filter((rotation) => inst.placementConstraints?.allowedRotations?.includes(rotation))
      : ROTATIONS;
    if (votes.length === 0) {
      const snapped = snapRotation(inst.rotationDeg);
      out.set(inst.id, allowed.includes(snapped) ? snapped : allowed[0]);
      continue;
    }

    let best: AutoPlaceRotation = 0;
    let bestScore = Infinity;
    for (const r of allowed) {
      let score = 0;
      for (const v of votes) {
        const world = transformPoint(v.local, at, r, mirror);
        const wx = world.x / NM_PER_MM;
        const wy = world.y / NM_PER_MM;
        for (const t of v.targets) {
          const dx = wx - t.x;
          const dy = wy - t.y;
          score += dx * dx + dy * dy;
        }
      }
      if (score < bestScore) {
        bestScore = score;
        best = r;
      }
    }
    out.set(inst.id, best);
  }
  return out;
}
