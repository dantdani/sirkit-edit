/**
 * Force-directed placement core (PCB Stage 8) — the pinned algorithm.
 *
 * Springs pull netlist-connected footprints toward `springRestLengthNm`
 * apart, Coulomb 1/d² repulsion keeps every pair from collapsing, and a soft
 * boundary force herds centroids back inside the outline. Rotations are FIXED
 * during iteration (rotation optimization is a post-process, see rotation.ts)
 * and there is NO per-iteration collision resolution (the post-process pass in
 * collision-resolver.ts owns that) — mixing either into the loop makes it
 * non-monotonic and kills convergence.
 *
 * Locked footprints exert forces on others but never integrate: their
 * positions are bit-identical in the output.
 *
 * Determinism: iteration order is ascending footprint id, the only randomness
 * is the seeded jitter on initial grid positions, and all math is plain
 * arithmetic — the same input always produces the same output.
 */

import type { PcbBoard } from "../types";
import type { Vec2 } from "../geometry";
import { mmToNm } from "../units";
import type { FootprintPlacement, ResolvedAutoPlaceParams } from "./types";
import { mulberry32 } from "./prng";
import {
  courtyardFitsOutline,
  nearestPointInOutline,
  outlineBBox,
  outlineCenter,
  pointInOutline,
  worldCourtyardBBox,
} from "./geometry";

export interface ForceDirectedInput {
  /** Read for the outline (boundary force) and padNets (spring graph). */
  board: PcbBoard;
  /** Initial state; rotation/side are held fixed throughout. */
  footprints: FootprintPlacement[];
  params: ResolvedAutoPlaceParams;
}

export interface ForceDirectedResult {
  /** Final centroid per footprint — BEFORE collision resolution & grid snap. */
  positions: Map<string, Vec2>;
  iterations: number;
  converged: boolean;
  finalMaxDisplacementNm: number;
}

/** Broad-phase cutoff: skip repulsion when courtyard bboxes are > 20 mm apart. */
const REPULSION_CUTOFF_NM = mmToNm(20);
/** Repulsion singularity guard (pinned): minimum effective distance. */
const MIN_REPULSION_DIST_NM = 100_000;
/** Seeded jitter on grid-seeded initial positions (~±1 mm). */
const JITTER_NM = mmToNm(1);
/** Gap between cells when seeding off-board footprints into the start grid. */
const SEED_GRID_GAP_NM = mmToNm(1);

export function runForceDirected(input: ForceDirectedInput): ForceDirectedResult {
  const { board, params } = input;
  const fps = [...input.footprints].sort((a, b) => a.id.localeCompare(b.id));
  const n = fps.length;
  if (n === 0) {
    return { positions: new Map(), iterations: 0, converged: true, finalMaxDisplacementNm: 0 };
  }

  const rng = mulberry32(params.seed);
  const outline = board.outline;
  const oBox = outlineBBox(outline);
  const oCenter = outlineCenter(outline);

  // Rotation-fixed world courtyard extents relative to the centroid.
  const offMinX = new Float64Array(n);
  const offMinY = new Float64Array(n);
  const offMaxX = new Float64Array(n);
  const offMaxY = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const f = fps[i];
    const b = worldCourtyardBBox(f.courtyardLocal, { x: 0, y: 0 }, f.rotationDeg, f.side === "bottom");
    offMinX[i] = b.minX;
    offMinY[i] = b.minY;
    offMaxX[i] = b.maxX;
    offMaxY[i] = b.maxY;
  }

  // Initial positions: keep valid on-board positions; seed the rest into a
  // jittered grid around the board center to break symmetry.
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const seeded: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = fps[i].position;
    if (fps[i].locked || pointInOutline(p, outline)) {
      x[i] = p.x;
      y[i] = p.y;
    } else {
      seeded.push(i);
    }
  }
  if (seeded.length > 0) {
    let cell = 0;
    for (const i of seeded) {
      cell = Math.max(cell, offMaxX[i] - offMinX[i], offMaxY[i] - offMinY[i]);
    }
    cell += SEED_GRID_GAP_NM;
    const cols = Math.ceil(Math.sqrt(seeded.length));
    const rows = Math.ceil(seeded.length / cols);
    const originX = oCenter.x - ((cols - 1) / 2) * cell;
    const originY = oCenter.y - ((rows - 1) / 2) * cell;
    seeded.forEach((i, k) => {
      x[i] = originX + (k % cols) * cell + (rng() * 2 - 1) * JITTER_NM;
      y[i] = originY + Math.floor(k / cols) * cell + (rng() * 2 - 1) * JITTER_NM;
    });
  }

  // Spring graph from padNets: one spring per (pair, shared net). Stored as a
  // pair → multiplicity map so a pair sharing k nets pulls k× as hard.
  const indexById = new Map<string, number>(fps.map((f, i) => [f.id, i]));
  const netMembers = new Map<number, Set<number>>();
  for (const inst of board.footprints) {
    const i = indexById.get(inst.id);
    if (i === undefined) continue;
    for (const netId of Object.values(inst.padNets)) {
      if (netId === 0) continue;
      let members = netMembers.get(netId);
      if (!members) {
        members = new Set();
        netMembers.set(netId, members);
      }
      members.add(i);
    }
  }
  const springCount = new Map<number, number>(); // key = i * n + j (i < j)
  for (const members of netMembers.values()) {
    const list = [...members].sort((a, b) => a - b);
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) {
        const key = list[a] * n + list[b];
        springCount.set(key, (springCount.get(key) ?? 0) + 1);
      }
    }
  }
  const springI: number[] = [];
  const springJ: number[] = [];
  const springMult: number[] = [];
  for (const key of [...springCount.keys()].sort((a, b) => a - b)) {
    springI.push(Math.floor(key / n));
    springJ.push(key % n);
    springMult.push(springCount.get(key) ?? 1);
  }

  const vx = new Float64Array(n);
  const vy = new Float64Array(n);
  const fx = new Float64Array(n);
  const fy = new Float64Array(n);

  const { springK, springRestLengthNm, repulsionK, boundaryK, damping, maxStepNm } = params;
  let iterations = 0;
  let converged = false;
  let stable = 0;
  let maxDisp = Infinity;

  for (let iter = 0; iter < params.maxIterations; iter++) {
    iterations = iter + 1;
    fx.fill(0);
    fy.fill(0);

    // Springs (attractive toward rest length; repels when compressed).
    for (let s = 0; s < springI.length; s++) {
      const i = springI[s];
      const j = springJ[s];
      const dx = x[j] - x[i];
      const dy = y[j] - y[i];
      const d = Math.max(Math.hypot(dx, dy), 1);
      let f = springK * (d - springRestLengthNm) * springMult[s];
      if (f > maxStepNm) f = maxStepNm; // cap per pair — no explosions
      else if (f < -maxStepNm) f = -maxStepNm;
      const ux = dx / d;
      const uy = dy / d;
      fx[i] += f * ux;
      fy[i] += f * uy;
      fx[j] -= f * ux;
      fy[j] -= f * uy;
    }

    // Coulomb repulsion between every pair, broad-phased on bbox gap.
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const gapX = Math.max(x[i] + offMinX[i] - (x[j] + offMaxX[j]), x[j] + offMinX[j] - (x[i] + offMaxX[i]), 0);
        const gapY = Math.max(y[i] + offMinY[i] - (y[j] + offMaxY[j]), y[j] + offMinY[j] - (y[i] + offMaxY[i]), 0);
        if (gapX > REPULSION_CUTOFF_NM || gapY > REPULSION_CUTOFF_NM) continue;
        const dx = x[j] - x[i];
        const dy = y[j] - y[i];
        const dist = Math.hypot(dx, dy);
        const d = Math.max(dist, MIN_REPULSION_DIST_NM);
        const f = repulsionK / (d * d);
        let ux: number;
        let uy: number;
        if (dist > 1) {
          ux = dx / dist;
          uy = dy / dist;
        } else {
          // Coincident centroids: deterministic symmetry-breaking direction.
          const angle = (((i * 31 + j * 17) % 360) * Math.PI) / 180;
          ux = Math.cos(angle);
          uy = Math.sin(angle);
        }
        fx[i] -= f * ux;
        fy[i] -= f * uy;
        fx[j] += f * ux;
        fy[j] += f * uy;
      }
    }

    // Boundary: centroids outside pull toward the nearest outline point;
    // courtyards clipping the outline get a smaller per-axis inward push.
    for (let i = 0; i < n; i++) {
      const p = { x: Math.round(x[i]), y: Math.round(y[i]) };
      if (!pointInOutline(p, outline)) {
        const target = nearestPointInOutline(p, outline);
        fx[i] += boundaryK * (target.x - x[i]);
        fy[i] += boundaryK * (target.y - y[i]);
        continue;
      }
      const box = {
        minX: x[i] + offMinX[i],
        minY: y[i] + offMinY[i],
        maxX: x[i] + offMaxX[i],
        maxY: y[i] + offMaxY[i],
      };
      if (!courtyardFitsOutline(box, outline)) {
        const inK = boundaryK * 0.5;
        if (box.minX < oBox.minX) fx[i] += inK * (oBox.minX - box.minX);
        if (box.maxX > oBox.maxX) fx[i] -= inK * (box.maxX - oBox.maxX);
        if (box.minY < oBox.minY) fy[i] += inK * (oBox.minY - box.minY);
        if (box.maxY > oBox.maxY) fy[i] -= inK * (box.maxY - oBox.maxY);
        // Non-rect outlines with no bbox overhang: nudge toward board center.
        if (box.minX >= oBox.minX && box.maxX <= oBox.maxX && box.minY >= oBox.minY && box.maxY <= oBox.maxY) {
          fx[i] += inK * 0.1 * (oCenter.x - x[i]);
          fy[i] += inK * 0.1 * (oCenter.y - y[i]);
        }
      }
    }

    // Integrate (dt = 1) with damping; locked footprints never move.
    maxDisp = 0;
    for (let i = 0; i < n; i++) {
      if (fps[i].locked) continue;
      vx[i] = (vx[i] + fx[i]) * damping;
      vy[i] = (vy[i] + fy[i]) * damping;
      const speed = Math.hypot(vx[i], vy[i]);
      if (speed > maxStepNm) {
        const scale = maxStepNm / speed;
        vx[i] *= scale;
        vy[i] *= scale;
      }
      x[i] += vx[i];
      y[i] += vy[i];
      const disp = Math.hypot(vx[i], vy[i]);
      if (disp > maxDisp) maxDisp = disp;
    }

    if (maxDisp < params.convergenceThresholdNm) {
      stable++;
      if (stable >= params.convergenceStableFrames) {
        converged = true;
        break;
      }
    } else {
      stable = 0;
    }
  }

  const positions = new Map<string, Vec2>();
  for (let i = 0; i < n; i++) {
    positions.set(
      fps[i].id,
      fps[i].locked ? { ...fps[i].position } : { x: Math.round(x[i]), y: Math.round(y[i]) },
    );
  }
  return { positions, iterations, converged, finalMaxDisplacementNm: maxDisp };
}
