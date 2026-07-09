/**
 * One-click auto-place orchestrator (PCB Stage 8) — the pinned entry point.
 *
 * Pipeline: force-directed layout (rotations fixed) → rotation optimization
 * (post-process, 90° snaps) → grid snap + boundary clip + collision
 * resolution. The output is a placement map + stats; applying it to the board
 * is the caller's job (useAutoPlace commits it as ONE history entry via
 * autoplace/command.ts).
 *
 * Deterministic: the seed defaults to hashBoardNetlist(board, netlist) and
 * every stage is pure arithmetic in a fixed order — the same board + netlist
 * always produces byte-identical placements. `netlist` may be null (boards
 * loaded without a sync); it only sharpens the seed, connectivity comes from
 * the board's own padNets (the same source the rats-nest uses).
 *
 * Locked footprints (`locked: true` on the instance — forward-compatible
 * optional flag, absent in today's model) never move and are omitted from the
 * result. Pass `respectLocked: false` to place everything.
 */

import { produce } from "immer";
import type { PcbBoard, FootprintInstance } from "../types";
import type { PcbNetlist } from "../netlist-bridge";
import { computeRatsnest } from "../ratsnest";
import { NM_PER_MM } from "../units";
import type { AutoPlaceParams, AutoPlaceResult, FootprintPlacement } from "./types";
import { resolveParams } from "./types";
import { hashBoardNetlist } from "./prng";
import { runForceDirected } from "./force-directed";
import { optimizeRotations, snapRotation } from "./rotation";
import { resolveCollisions } from "./collision-resolver";
import { localCourtyardBBox } from "./geometry";

/** Read the forward-compatible optional lock flag off an instance. */
export function isLocked(inst: FootprintInstance): boolean {
  return (inst as FootprintInstance & { locked?: boolean }).locked === true;
}

/** Total airwire length of a board's rats-nest, in nm (double). */
export function ratsnestLengthNm(board: PcbBoard): number {
  let totalMm = 0;
  for (const w of computeRatsnest(board)) {
    totalMm += Math.hypot((w.to.x - w.from.x) / NM_PER_MM, (w.to.y - w.from.y) / NM_PER_MM);
  }
  return totalMm * NM_PER_MM;
}

export function autoPlace(
  board: PcbBoard,
  netlist: PcbNetlist | null,
  params?: AutoPlaceParams,
): AutoPlaceResult {
  const t0 = Date.now();
  const p = resolveParams(params, hashBoardNetlist(board, netlist));

  const initialRatsnestLengthNm = ratsnestLengthNm(board);

  const placements: FootprintPlacement[] = board.footprints.map((inst) => ({
    id: inst.id,
    position: { ...inst.at },
    rotationDeg: inst.rotationDeg,
    side: inst.side,
    courtyardLocal: localCourtyardBBox(inst.def),
    locked: p.respectLocked && isLocked(inst),
  }));
  const lockedIds = new Set(placements.filter((f) => f.locked).map((f) => f.id));

  // 1. Force-directed layout, rotations fixed.
  const fd = runForceDirected({ board, footprints: placements, params: p });

  // 2. Rotation optimization (post-process; locked keep their rotation).
  const rotations = optimizeRotations(board, fd.positions, lockedIds);

  // 3. Grid snap + hard boundary clip + collision resolution, on the
  //    post-rotation courtyards.
  const preResolve: FootprintPlacement[] = placements.map((f) => ({
    ...f,
    position: fd.positions.get(f.id) ?? f.position,
    rotationDeg: f.locked ? f.rotationDeg : (rotations.get(f.id) ?? snapRotation(f.rotationDeg)),
  }));
  const resolved = resolveCollisions(board, preResolve, p.gridNm);

  const result: AutoPlaceResult["placements"] = new Map();
  for (const f of resolved.placements) {
    if (f.locked) continue;
    result.set(f.id, {
      position: { ...f.position },
      rotationDeg: snapRotation(f.rotationDeg),
      side: f.side,
    });
  }

  // Final rats-nest on a hypothetical board carrying the new placements.
  const placedBoard = produce(board, (draft) => {
    for (const fp of draft.footprints) {
      const f = result.get(fp.id);
      if (!f) continue;
      fp.at = { ...f.position };
      fp.rotationDeg = f.rotationDeg;
    }
  });
  const finalRatsnestLengthNm = ratsnestLengthNm(placedBoard);

  return {
    placements: result,
    stats: {
      iterations: fd.iterations,
      converged: fd.converged,
      elapsedMs: Date.now() - t0,
      finalMaxDisplacementNm: fd.finalMaxDisplacementNm,
      initialRatsnestLengthNm,
      finalRatsnestLengthNm,
      collisionsResolved: resolved.collisionsResolved,
      footprintsClippedToBoundary: resolved.footprintsClippedToBoundary,
    },
  };
}
