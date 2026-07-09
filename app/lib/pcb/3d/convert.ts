/**
 * nm → scene-mm conversion (PCB Stage 15). Board space is integer nm with +y
 * DOWN; scene space is mm with +y UP and +Z out of the board top, so y is
 * negated exactly once, here. (Stage 1 rotations — CCW positive under +y-down
 * — become standard CCW rotations in scene space under this flip.)
 */

import type { Vec2 } from "../geometry";

export const NM_TO_MM = 1 / 1_000_000;

export function mmLen(nm: number): number {
  return nm * NM_TO_MM;
}

/** Board point → scene point (y flipped; −0 normalized to +0). */
export function toMm(p: Vec2): { x: number; y: number } {
  return { x: p.x * NM_TO_MM, y: -p.y * NM_TO_MM + 0 };
}
