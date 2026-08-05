/**
 * Thermal-relief spokes (PCB Stage 11). A same-net pad inside a thermal-
 * connection zone gets an annular clearance gap (the cutout is made by
 * compute-fill) plus N rectangular spokes UNIONed back over the gap — the
 * classic wagon wheel that keeps the pad solderable against a copper pour.
 */

import type { Vec2 } from "../geometry";
import type { Pad } from "../types";
import { shapeOuterBoundNm } from "./geometry";

const DEG_TO_RAD = Math.PI / 180;

/** Stage 1 rotation convention: CCW positive, +y down. */
function direction(angleDeg: number): { x: number; y: number } {
  const a = angleDeg * DEG_TO_RAD;
  return { x: Math.cos(a), y: -Math.sin(a) };
}

export interface ThermalSpokeParams {
  spokeWidthNm: number;
  gapNm: number;
  spokes: 2 | 4;
  angleOffsetDeg: number;
}

export function generateRadialThermalSpokes(
  worldPosition: Vec2,
  reachNm: number,
  worldRotationDeg: number,
  params: ThermalSpokeParams,
): Vec2[][] {
  const { spokeWidthNm, spokes, angleOffsetDeg } = params;
  const half = spokeWidthNm / 2;
  const out: Vec2[][] = [];
  for (let i = 0; i < spokes; i++) {
    const angle = (360 / spokes) * i + angleOffsetDeg + worldRotationDeg;
    const u = direction(angle);
    const n = { x: -u.y, y: u.x };
    const c = worldPosition;
    out.push([
      { x: Math.round(c.x - n.x * half), y: Math.round(c.y - n.y * half) },
      { x: Math.round(c.x + u.x * reachNm - n.x * half), y: Math.round(c.y + u.y * reachNm - n.y * half) },
      { x: Math.round(c.x + u.x * reachNm + n.x * half), y: Math.round(c.y + u.y * reachNm + n.y * half) },
      { x: Math.round(c.x + n.x * half), y: Math.round(c.y + n.y * half) },
    ]);
  }
  return out;
}

/**
 * Spoke polygons for one same-net pad, in world coordinates. Each spoke is a
 * rectangle of width `spokeWidthNm` running from the pad center outward at
 * `(360 / spokes) · i + angleOffsetDeg` (plus the pad's world rotation),
 * long enough to cross the pad, the thermal gap, and bite into the
 * surrounding fill. compute-fill unions these back into the raw fill after
 * subtracting the pad's gap cutout.
 */
export function generateThermalSpokes(
  pad: Pad,
  worldPosition: Vec2,
  worldRotationDeg: number,
  params: ThermalSpokeParams,
): Vec2[][] {
  const { gapNm } = params;
  const length =
    shapeOuterBoundNm({ shape: pad.shape, at: worldPosition, rotationDeg: worldRotationDeg }) +
    2 * gapNm;
  return generateRadialThermalSpokes(worldPosition, length, worldRotationDeg, params);
}
