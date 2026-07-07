/**
 * Rats-nest airwires (PCB Stage 5) — per-net minimum spanning tree over pad
 * world positions, straight from `padNets`.
 *
 * NOTE for Stage 6: once copper exists, `computeConnectivity().airwires`
 * (cluster-MST over copper-connected islands) supersedes this. The pad-MST
 * below is its degenerate no-copper case — the editor's call site swaps to
 * the connectivity version in the wave-end integration window. Replace the
 * internals, keep the `Airwire` shape and `computeRatsnest` signature.
 */

import type { PcbBoard, FootprintInstance, Pad } from "./types";
import type { Vec2 } from "./geometry";
import { transformPoint } from "./geometry";
import { NM_PER_MM } from "./units";

/** One airwire segment, integer-nm world space. */
export interface Airwire {
  netId: number;
  from: Vec2;
  to: Vec2;
}

/**
 * World position of a pad on a placed instance: footprint-local `pad.at`
 * mirrored in X for bottom-side instances, rotated, then translated.
 */
export function padWorldPosition(inst: FootprintInstance, pad: Pad): Vec2 {
  return transformPoint(pad.at, inst.at, inst.rotationDeg, inst.side === "bottom");
}

// Per-net result cache. Module-level and board-agnostic on purpose: a call
// WITHOUT `changedNets` clears it (full recompute — drop, undo, sync, board
// swap), so stale entries never survive a board replacement. Calls WITH
// `changedNets` recompute only those nets; untouched nets return the SAME
// Airwire objects (identity-stable — downstream diffing relies on it).
const netCache = new Map<number, Airwire[]>();

/**
 * Airwires for every net on the board. Nets with fewer than 2 pads (and the
 * reserved unconnected net 0) produce none. `changedNets` = the nets touched
 * by moved instances (union of their `padNets` values); everything else is
 * served from cache.
 */
export function computeRatsnest(board: PcbBoard, changedNets?: number[]): Airwire[] {
  // Partial path (per-frame during drags): touch ONLY the changed nets — skip
  // even the pad-position gather for everything else, so per-frame cost scales
  // with the moved nets, not the board.
  if (changedNets !== undefined) {
    const changed = new Set(changedNets);
    const padsByNet = gatherPads(board, changed);
    for (const netId of changed) {
      const pads = padsByNet.get(netId);
      if (pads === undefined) netCache.delete(netId);
      else netCache.set(netId, mstAirwires(netId, pads));
    }
    const out: Airwire[] = [];
    for (const wires of netCache.values()) for (const w of wires) out.push(w);
    return out;
  }

  // Full path (drop, undo, sync, board swap): rebuild the cache from scratch,
  // so stale entries never survive a board replacement.
  netCache.clear();
  const padsByNet = gatherPads(board, null);
  const out: Airwire[] = [];
  for (const [netId, pads] of padsByNet) {
    const wires = mstAirwires(netId, pads);
    netCache.set(netId, wires);
    for (const w of wires) out.push(w);
  }
  return out;
}

/** Pad world positions per net; `only` restricts the gather to those nets. */
function gatherPads(board: PcbBoard, only: ReadonlySet<number> | null): Map<number, Vec2[]> {
  const padsByNet = new Map<number, Vec2[]>();
  for (const inst of board.footprints) {
    for (const pad of inst.def.pads) {
      const netId = inst.padNets[pad.number];
      if (netId === undefined || netId === 0) continue; // unconnected
      if (only !== null && !only.has(netId)) continue;
      let pads = padsByNet.get(netId);
      if (!pads) {
        pads = [];
        padsByNet.set(netId, pads);
      }
      pads.push(padWorldPosition(inst, pad));
    }
  }
  return padsByNet;
}

/**
 * Prim's algorithm, O(k²) over the k pads of one net — the right tool up to
 * k ≈ 200. Deliberately NOT spatially accelerated: Stage 6's connectivity
 * pass replaces this wholesale, so complexity here would be wasted.
 */
function mstAirwires(netId: number, pads: Vec2[]): Airwire[] {
  const k = pads.length;
  if (k < 2) return [];

  // Distances compared in mm doubles — nm² overflows 53-bit precision on
  // large boards; MST only needs correct comparisons, not exact values.
  // Typed arrays keep the O(k²) inner loops on the fast path.
  const xs = new Float64Array(k);
  const ys = new Float64Array(k);
  for (let i = 0; i < k; i++) {
    xs[i] = pads[i].x / NM_PER_MM;
    ys[i] = pads[i].y / NM_PER_MM;
  }

  const inTree = new Uint8Array(k);
  const bestDist = new Float64Array(k).fill(Infinity);
  const bestFrom = new Int32Array(k);
  inTree[0] = 1;
  for (let j = 1; j < k; j++) {
    const dx = xs[j] - xs[0];
    const dy = ys[j] - ys[0];
    bestDist[j] = dx * dx + dy * dy;
  }

  const wires: Airwire[] = [];
  for (let added = 1; added < k; added++) {
    let next = -1;
    let min = Infinity;
    for (let j = 0; j < k; j++) {
      if (inTree[j] === 0 && bestDist[j] < min) {
        min = bestDist[j];
        next = j;
      }
    }
    if (next === -1) break; // unreachable; keeps the loop total
    inTree[next] = 1;
    wires.push({ netId, from: pads[bestFrom[next]], to: pads[next] });
    const nx = xs[next];
    const ny = ys[next];
    for (let j = 0; j < k; j++) {
      if (inTree[j] === 1) continue;
      const dx = xs[j] - nx;
      const dy = ys[j] - ny;
      const d = dx * dx + dy * dy;
      if (d < bestDist[j]) {
        bestDist[j] = d;
        bestFrom[j] = next;
      }
    }
  }
  return wires;
}
