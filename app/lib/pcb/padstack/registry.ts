/**
 * Padstack registry (PCB Stage 17 Phase C) — PURE helpers over
 * `board.padstacks`. Vias only (pads are rawSexpr-owned, see types.ts).
 *
 * DENORMALIZATION INVARIANT (load-bearing): a via with a `padstackId` keeps
 * its `size`/`drill` fields equal to the padstack's dims — every mutation
 * path (set-via-padstack, edit-padstack, migration, route placement) writes
 * both. Geometry consumers (renderer, DRC, clearance guard, KiCad/DSN export)
 * therefore stay correct reading the via directly, while `resolveVia` is the
 * read-through API new code should use.
 */

import type { PcbBoard, Via } from "../types";
import type { Padstack, PadstackInput } from "./types";

export function getPadstack(board: PcbBoard, id: string): Padstack | undefined {
  return (board.padstacks ?? []).find((p) => p.id === id);
}

/** Vias currently referencing the padstack. */
export function usageCount(board: PcbBoard, id: string): number {
  let n = 0;
  for (const via of board.vias) {
    if (via.padstackId === id) n++;
  }
  return n;
}

/** Deterministic fresh id: ps-<n> above every existing numeric suffix.
 *  Exported so a batch can predict the id `create-padstack` will assign
 *  (the fork rule pairs it with a `set-via-padstack` in the same batch). */
export function nextPadstackId(board: PcbBoard): string {
  let max = 0;
  for (const p of board.padstacks ?? []) {
    const m = /^ps-(\d+)$/.exec(p.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `ps-${max + 1}`;
}

/** Add a padstack (mutates — call on an immer draft or a load-time board). */
export function addPadstack(board: PcbBoard, input: PadstackInput, id?: string): Padstack {
  const padstack: Padstack = { id: id ?? nextPadstackId(board), ...input };
  (board.padstacks ?? (board.padstacks = [])).push(padstack);
  return padstack;
}

/** Remove a padstack. Throws while any via still uses it — remap first. */
export function removePadstack(board: PcbBoard, id: string): void {
  const used = usageCount(board, id);
  if (used > 0) {
    throw new Error(`Padstack ${id} is used by ${used} via${used === 1 ? "" : "s"} — remap first.`);
  }
  board.padstacks = (board.padstacks ?? []).filter((p) => p.id !== id);
}

export interface ResolvedVia {
  outerNm: number;
  drillNm: number;
  tented: boolean;
  zoneConnect: "solid" | "thermal";
}

/** Via dims through the registry; legacy vias (no padstackId, or a dangling
 *  one) fall back to their own `size`/`drill` so nothing breaks mid-migration. */
export function resolveVia(board: PcbBoard, via: Via): ResolvedVia {
  const ps = via.padstackId !== undefined ? getPadstack(board, via.padstackId) : undefined;
  if (!ps) {
    return { outerNm: via.size, drillNm: via.drill, tented: true, zoneConnect: "solid" };
  }
  return {
    outerNm: ps.outerNm,
    drillNm: ps.drillNm,
    tented: ps.tented,
    zoneConnect: ps.zoneConnect,
  };
}

/** Re-assert the denormalization invariant on every member via (mutates). */
export function syncViasToPadstack(board: PcbBoard, padstackId: string): void {
  const ps = getPadstack(board, padstackId);
  if (!ps) return;
  for (const via of board.vias) {
    if (via.padstackId === padstackId) {
      via.size = ps.outerNm;
      via.drill = ps.drillNm;
    }
  }
}
