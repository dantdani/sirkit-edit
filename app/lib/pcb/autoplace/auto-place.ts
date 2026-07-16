import { produce } from "immer";
import type { PcbBoard, FootprintInstance, BoardOutline } from "../types";
import type { PcbNetlist } from "../netlist-bridge";
import { computeRatsnest } from "../ratsnest";
import { NM_PER_MM } from "../units";
import type { AutoPlaceParams, AutoPlaceResult, FootprintPlacement, ResolvedAutoPlaceParams } from "./types";
import { resolveParams } from "./types";
import { hashBoardNetlist } from "./prng";
import { runForceDirected } from "./force-directed";
import { optimizeRotations, snapRotation } from "./rotation";
import { resolveCollisions } from "./collision-resolver";
import { outlineBBox, pointInOutline, scaleOutline } from "./geometry";
import { analyzePlacementRouteability } from "./routeability";
import { buildPlacementEnvelope } from "./envelope";
import { padWorldPosition } from "../geometry-copper";

export interface AutoPlaceProgress {
  phase: "analyzing" | "optimizing" | "validating" | "complete";
  percent: number;
  candidate?: number;
  candidateCount?: number;
}

export interface AutoPlaceObserver {
  onProgress?(progress: AutoPlaceProgress): void;
  shouldCancel?(): boolean;
}

export class AutoPlaceCancelledError extends Error {
  constructor() {
    super("Auto-placement was cancelled.");
    this.name = "AutoPlaceCancelledError";
  }
}

function checkCancelled(observer?: AutoPlaceObserver): void {
  if (observer?.shouldCancel?.()) throw new AutoPlaceCancelledError();
}

export function isLocked(inst: FootprintInstance): boolean {
  return inst.locked === true ||
    inst.placementConstraints?.fixedPosition === true ||
    inst.placementConstraints?.mechanical === true ||
    inst.placementConstraints?.edgeConnector !== undefined;
}

export function ratsnestLengthNm(board: PcbBoard): number {
  let totalMm = 0;
  for (const wire of computeRatsnest(board)) {
    totalMm += Math.hypot((wire.to.x - wire.from.x) / NM_PER_MM, (wire.to.y - wire.from.y) / NM_PER_MM);
  }
  return totalMm * NM_PER_MM;
}

function cloneOutline(outline: BoardOutline): BoardOutline {
  if (outline.kind === "polygon") return { kind: "polygon", points: outline.points.map((point) => ({ ...point })) };
  return outline.kind === "roundrect"
    ? { ...outline, origin: { ...outline.origin } }
    : { ...outline, origin: { ...outline.origin } };
}

interface PlacementCandidate {
  placements: AutoPlaceResult["placements"];
  board: PcbBoard;
  iterations: number;
  converged: boolean;
  finalMaxDisplacementNm: number;
  collisionsResolved: number;
  footprintsClippedToBoundary: number;
  routeability: AutoPlaceResult["routeabilityAfter"];
  ratsnestLengthNm: number;
}

function runCandidate(board: PcbBoard, params: ResolvedAutoPlaceParams): PlacementCandidate {
  const placements: FootprintPlacement[] = board.footprints.map((inst) => ({
    id: inst.id,
    position: { ...inst.at },
    rotationDeg: inst.rotationDeg,
    side: inst.side,
    courtyardLocal: buildPlacementEnvelope(board, inst, { scale: params.envelopeScale }).effectiveBounds,
    locked: params.respectLocked && isLocked(inst),
  }));
  const lockedIds = new Set(placements.filter((footprint) => footprint.locked).map((footprint) => footprint.id));
  const forceDirected = runForceDirected({ board, footprints: placements, params });
  const rotations = optimizeRotations(board, forceDirected.positions, lockedIds);
  const preResolve: FootprintPlacement[] = placements.map((footprint) => ({
    ...footprint,
    position: forceDirected.positions.get(footprint.id) ?? footprint.position,
    rotationDeg: footprint.locked
      ? footprint.rotationDeg
      : (rotations.get(footprint.id) ?? snapRotation(footprint.rotationDeg)),
  }));
  const resolved = resolveCollisions(board, preResolve, params.gridNm);
  const result: AutoPlaceResult["placements"] = new Map();
  for (const footprint of resolved.placements) {
    if (footprint.locked) continue;
    result.set(footprint.id, {
      position: { ...footprint.position },
      rotationDeg: snapRotation(footprint.rotationDeg),
      side: footprint.side,
    });
  }
  const placedBoard = produce(board, (draft) => {
    for (const footprint of draft.footprints) {
      const placement = result.get(footprint.id);
      if (!placement) continue;
      footprint.at = { ...placement.position };
      footprint.rotationDeg = placement.rotationDeg;
    }
  });
  return {
    placements: result,
    board: placedBoard,
    iterations: forceDirected.iterations,
    converged: forceDirected.converged,
    finalMaxDisplacementNm: forceDirected.finalMaxDisplacementNm,
    collisionsResolved: resolved.collisionsResolved,
    footprintsClippedToBoundary: resolved.footprintsClippedToBoundary,
    routeability: analyzePlacementRouteability(placedBoard, { envelopeScale: params.envelopeScale }),
    ratsnestLengthNm: ratsnestLengthNm(placedBoard),
  };
}

export function autoPlace(
  board: PcbBoard,
  netlist: PcbNetlist | null,
  params?: AutoPlaceParams,
  observer?: AutoPlaceObserver,
): AutoPlaceResult {
  const startedAt = Date.now();
  checkCancelled(observer);
  observer?.onProgress?.({ phase: "analyzing", percent: 5 });
  const resolved = resolveParams(
    { ...params, envelopeScale: params?.envelopeScale ?? board.placementPreferences?.envelopeScale ?? 1.15 },
    hashBoardNetlist(board, netlist),
  );
  const outlineBefore = cloneOutline(board.outline);
  const resizeApproved =
    board.placementPolicy?.outlineSource === "generated" ||
    board.placementPolicy?.allowBoardResize === true ||
    resolved.allowBoardResize;
  const outlineAfter = resolved.expandGeneratedOutline && resizeApproved
    ? scaleOutline(board.outline, 1.1)
    : cloneOutline(board.outline);
  const workingBoard = produce(board, (draft) => {
    draft.outline = cloneOutline(outlineAfter);
  });
  const routeabilityBefore = analyzePlacementRouteability(board, { envelopeScale: resolved.envelopeScale });
  const initialRatsnestLengthNm = ratsnestLengthNm(board);

  const candidateCount = Math.max(1, Math.min(4, Math.round(resolved.candidateCount)));
  let chosen: PlacementCandidate | undefined;
  for (let index = 0; index < candidateCount; index++) {
    checkCancelled(observer);
    observer?.onProgress?.({
      phase: "optimizing",
      percent: 10 + Math.round((index / candidateCount) * 70),
      candidate: index + 1,
      candidateCount,
    });
    const candidate = runCandidate(workingBoard, { ...resolved, seed: resolved.seed + index });
    if (
      !chosen ||
      candidate.routeability.score < chosen.routeability.score ||
      (candidate.routeability.score === chosen.routeability.score && candidate.ratsnestLengthNm < chosen.ratsnestLengthNm)
    ) {
      chosen = candidate;
    }
    observer?.onProgress?.({
      phase: "optimizing",
      percent: 10 + Math.round(((index + 1) / candidateCount) * 70),
      candidate: index + 1,
      candidateCount,
    });
  }
  checkCancelled(observer);
  observer?.onProgress?.({ phase: "validating", percent: 85 });
  if (!chosen) throw new Error("Auto-place produced no placement candidate");

  let totalPads = 0;
  let padsInsideBoard = 0;
  for (const footprint of chosen.board.footprints) {
    for (const pad of footprint.def.pads) {
      if (pad.type === "np_thru_hole") continue;
      totalPads += 1;
      if (pointInOutline(padWorldPosition(footprint, pad), chosen.board.outline)) padsInsideBoard += 1;
    }
  }
  const estimatedRequiredAreaMm2 = chosen.board.footprints.reduce((sum, footprint) => {
    const bounds = buildPlacementEnvelope(chosen!.board, footprint, { scale: resolved.envelopeScale }).effectiveBounds;
    return sum + ((bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY)) / 1_000_000_000_000;
  }, 0);
  const boardBounds = outlineBBox(chosen.board.outline);
  const availableBoardAreaMm2 = ((boardBounds.maxX - boardBounds.minX) * (boardBounds.maxY - boardBounds.minY)) / 1_000_000_000_000;
  const blockedPadEscapes = chosen.routeability.pinAccessFailures.length;
  const success =
    chosen.routeability.courtyardOverlaps === 0 &&
    chosen.routeability.footprintsOutside === 0 &&
    padsInsideBoard === totalPads &&
    blockedPadEscapes === 0;
  const congestion: AutoPlaceResult["report"]["congestion"] =
    blockedPadEscapes > 0 || chosen.routeability.courtyardOverlaps > 0 || chosen.routeability.congestionScore >= 500
      ? "High"
      : chosen.routeability.congestionScore >= 50
        ? "Medium"
        : "Low";
  const spacingPreset = board.placementPreferences?.spacingPreset ?? (
    Math.abs(resolved.envelopeScale - 1.1) < 0.0001
      ? "compact"
      : Math.abs(resolved.envelopeScale - 1.15) < 0.0001
        ? "comfortable"
        : Math.abs(resolved.envelopeScale - 1.2) < 0.0001
          ? "spacious"
          : "custom"
  );

  const result: AutoPlaceResult = {
    placements: chosen.placements,
    outlineBefore,
    outlineAfter,
    outlineResized: JSON.stringify(outlineBefore) !== JSON.stringify(outlineAfter),
    routeabilityBefore,
    routeabilityAfter: chosen.routeability,
    report: {
      footprintsPlaced: board.footprints.length,
      totalFootprints: board.footprints.length,
      lockedFootprintsPreserved: board.footprints.filter(isLocked).length,
      padsInsideBoard,
      totalPads,
      envelopeOverlaps: chosen.routeability.courtyardOverlaps,
      blockedPadEscapes,
      congestion,
      envelopeScale: resolved.envelopeScale,
      spacingPreset,
      estimatedRequiredAreaMm2: Math.round(estimatedRequiredAreaMm2 * 10) / 10,
      availableBoardAreaMm2: Math.round(availableBoardAreaMm2 * 10) / 10,
      success,
    },
    stats: {
      iterations: chosen.iterations,
      converged: chosen.converged,
      elapsedMs: Date.now() - startedAt,
      finalMaxDisplacementNm: chosen.finalMaxDisplacementNm,
      initialRatsnestLengthNm,
      finalRatsnestLengthNm: chosen.ratsnestLengthNm,
      collisionsResolved: chosen.collisionsResolved,
      footprintsClippedToBoundary: chosen.footprintsClippedToBoundary,
    },
  };
  observer?.onProgress?.({ phase: "complete", percent: 100 });
  return result;
}
