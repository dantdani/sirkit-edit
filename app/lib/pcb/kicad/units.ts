// KiCad export units (PCB Stage 13). KiCad's native file unit is the
// millimeter (float, 6-decimal convention); sirkit's model is integer
// nanometers. Conversion happens only here, at the emit boundary.
//
// `nmToMm` always produces exactly 6 decimal places — 1 nm resolution — so
// (nm → mm-string → nm) round-trips EXACTLY for every integer-nm value in
// range (kicad-units.test.ts enforces it).

import type { Nm } from "../units";
import type { Vec2 } from "../geometry";

const NM_PER_MM = 1_000_000;

/** Integer nm → KiCad mm string with exactly 6 decimals: 1_270_000 → "1.270000". */
export function nmToMm(nm: Nm): string {
  const s = (nm / NM_PER_MM).toFixed(6);
  return s === "-0.000000" ? "0.000000" : s;
}

/** KiCad mm (number or file string) → integer nm, rounded to the nearest nm. */
export function mmToNm(mm: number | string): Nm {
  const v = typeof mm === "string" ? Number(mm) : mm;
  return Math.round(v * NM_PER_MM) + 0; // normalize -0
}

/** Vector convenience for `(start x y)`-style children. */
export function nmVec2ToMm(v: Vec2): { x: string; y: string } {
  return { x: nmToMm(v.x), y: nmToMm(v.y) };
}

/**
 * Rotation for emission. sirkit stores KiCad-convention degrees already
 * (CCW-positive with +y down — see geometry.ts), so this is numerically the
 * identity, normalized to (-180, 180]: the UI's one-click 90° CW rotation is
 * stored as 270 and emits as "-90.000000". NO sign flip — the model angle IS
 * the KiCad angle (kicad-emit-footprint.test.ts pins both directions).
 */
export function formatDeg(deg: number): string {
  let d = ((deg % 360) + 360) % 360;
  if (d > 180) d -= 360;
  const s = d.toFixed(6);
  return s === "-0.000000" ? "0.000000" : s;
}
