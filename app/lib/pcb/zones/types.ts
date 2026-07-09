/**
 * Zone fill types (PCB Stage 11) — PINNED cross-stage contract.
 *
 * The `Zone` and `FilledRegion` shapes live on the board model in
 * `app/lib/pcb/types.ts` (they persist with the board); this module re-exports
 * them and adds the fill-engine input/output types plus the effective-
 * clearance / thermal-parameter helpers Stages 12 (DRC) and 13 (export)
 * consume. All coordinates are integer nanometers.
 */

import type { PcbBoard, Zone, FilledRegion } from "../types";
import type { LayerId } from "../layers";
import { getNetClass } from "../netclass";

export type { Zone, FilledRegion } from "../types";

/** Default fill keep-out from the board outline when no DRC preset is in scope. */
export const DEFAULT_BOARD_EDGE_CLEARANCE_NM = 300_000; // 300 µm

export interface ComputeFillInput {
  board: PcbBoard;
  zone: Zone;
  /**
   * Effective clearance between the zone's net and another item's net —
   * reads getNetClass on both sides and honors zone.clearanceOverrideNm
   * (see makeEffectiveClearance). The layer parameter is available for
   * future per-layer rules; the MVP ignores it.
   */
  effectiveClearance(itemNetId: number, itemLayer: LayerId): number;
  /** Fill inset from the board outline; defaults to 300 µm. */
  boardEdgeClearanceNm?: number;
}

export interface ComputeFillResult {
  regions: FilledRegion[];
  stats: { rawRegions: number; islandsDropped: number; elapsedMs: number };
}

/** Fully-resolved thermal-relief parameters (zone overrides merged over defaults). */
export interface ThermalParams {
  spokeWidthNm: number;
  gapNm: number;
  spokes: 2 | 4;
  angleOffsetDeg: number;
}

/** The zone's own clearance: explicit override, else its net class's clearance. */
export function zoneClearanceNm(board: PcbBoard, zone: Zone): number {
  return zone.clearanceOverrideNm ?? getNetClass(board, zone.netId).clearance;
}

/**
 * Pinned rule: zone-to-item clearance is the MAX of the zone's net-class
 * clearance and the item's net-class clearance — never hard-coded. An
 * EXPLICIT `clearanceOverrideNm` is absolute, though: the user asked for that
 * exact gap, so it bypasses the max (this is what lets Stage 12's DRC fire
 * when an override is set below the fab rules — the pour obeys the user, the
 * rules complain).
 */
export function makeEffectiveClearance(
  board: PcbBoard,
  zone: Zone,
): (itemNetId: number, itemLayer: LayerId) => number {
  if (zone.clearanceOverrideNm !== undefined) {
    const override = zone.clearanceOverrideNm;
    return () => override;
  }
  const zoneClr = getNetClass(board, zone.netId).clearance;
  return (itemNetId: number) => Math.max(zoneClr, getNetClass(board, itemNetId).clearance);
}

/**
 * Thermal defaults: 4 spokes at 45°, spoke width = the zone class's track
 * width, gap = half the zone clearance. `zone.thermal` overrides per field.
 */
export function thermalParamsFor(board: PcbBoard, zone: Zone): ThermalParams {
  const cls = getNetClass(board, zone.netId);
  return {
    spokeWidthNm: zone.thermal?.spokeWidthNm ?? cls.trackWidth,
    gapNm: zone.thermal?.gapNm ?? Math.round(zoneClearanceNm(board, zone) / 2),
    spokes: zone.thermal?.spokes ?? 4,
    angleOffsetDeg: zone.thermal?.angleOffsetDeg ?? 45,
  };
}
