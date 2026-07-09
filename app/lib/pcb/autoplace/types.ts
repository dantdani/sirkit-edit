/**
 * Auto-place model (PCB Stage 8) — the pinned parameter/result contract.
 *
 * All distances are integer nanometers (see units.ts). Force weights are the
 * pinned defaults; every knob is overridable per call for research/tuning.
 */

import type { Vec2, BBox } from "../geometry";
import { mmToNm } from "../units";

export type AutoPlaceRotation = 0 | 90 | 180 | 270;

export interface AutoPlaceParams {
  /** Default: derived from hashBoardNetlist(board, netlist). */
  seed?: number;
  maxIterations?: number; // default 400
  convergenceThresholdNm?: number; // default 5_000 (5 μm)
  convergenceStableFrames?: number; // default 10
  gridNm?: number; // default 100_000 (100 μm)
  respectLocked?: boolean; // default true
  // Force weights — pinned defaults, tunable for research
  springK?: number; // default 0.02 (per-net attraction strength)
  springRestLengthNm?: number; // default 5 mm — target centroid distance for connected parts
  repulsionK?: number; // default 4e14 (Coulomb constant tuned for nm scale)
  boundaryK?: number; // default 0.05
  damping?: number; // default 0.85 (velocity decay per frame)
  maxStepNm?: number; // default 2 mm per iteration
}

export const AUTO_PLACE_DEFAULTS = {
  maxIterations: 400,
  convergenceThresholdNm: 5_000,
  convergenceStableFrames: 10,
  gridNm: 100_000,
  respectLocked: true,
  springK: 0.02,
  springRestLengthNm: mmToNm(5),
  repulsionK: 4e14,
  boundaryK: 0.05,
  damping: 0.85,
  maxStepNm: mmToNm(2),
} as const;

/** Params with every knob resolved; `seed` is filled by the orchestrator. */
export type ResolvedAutoPlaceParams = Required<AutoPlaceParams>;

export function resolveParams(params: AutoPlaceParams | undefined, fallbackSeed: number): ResolvedAutoPlaceParams {
  return { seed: fallbackSeed, ...AUTO_PLACE_DEFAULTS, ...params };
}

/**
 * One footprint's mutable placement state as it flows through the pipeline
 * (force-directed → rotation → collision resolution). `courtyardLocal` is the
 * footprint-LOCAL courtyard bbox (unrotated, unmirrored) — world bboxes are
 * derived from it per stage because rotation changes between stages.
 */
export interface FootprintPlacement {
  id: string;
  position: Vec2;
  rotationDeg: number;
  side: "top" | "bottom";
  courtyardLocal: BBox;
  locked: boolean;
}

export interface AutoPlaceResult {
  /** Final placement per moved footprint. Locked footprints are omitted. */
  placements: Map<string, { position: Vec2; rotationDeg: AutoPlaceRotation; side: "top" | "bottom" }>;
  stats: {
    iterations: number;
    converged: boolean;
    elapsedMs: number;
    finalMaxDisplacementNm: number;
    initialRatsnestLengthNm: number; // sum of MST edge lengths BEFORE placement
    finalRatsnestLengthNm: number; // sum AFTER placement (goal: ≥ 60% reduction on demo)
    collisionsResolved: number; // # nudges/relocations made in collision-resolution pass
    footprintsClippedToBoundary: number;
  };
}
