/**
 * Deterministic randomness for auto-place (PCB Stage 8).
 *
 * mulberry32 is the ONLY randomness source in the autoplace pipeline —
 * Math.random is never touched, so the same board + netlist always produces
 * byte-identical placements (the determinism test enforces this).
 *
 * DEVIATION FROM THE PINNED SHAPE (documented in the progress note): the plan
 * pinned `hashBoardNetlist(boardId, netlist)`, but PcbBoard has no `id` field.
 * The seed therefore hashes the board's stable identity — outline, net table,
 * footprint ids + footprint kinds + padNets — plus the netlist when one is
 * available. Footprint POSITIONS are deliberately excluded so re-running
 * auto-place after a manual tweak keeps the same seed.
 */

import type { PcbBoard } from "../types";
import type { PcbNetlist } from "../netlist-bridge";

/** Seeded PRNG returning doubles in [0, 1). Standard mulberry32. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a over a string, returned as an unsigned 32-bit integer. */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Deterministic auto-place seed from the board's stable identity + netlist.
 * Positions/rotations are excluded on purpose (see module note).
 */
export function hashBoardNetlist(board: PcbBoard, netlist: PcbNetlist | null): number {
  const parts: string[] = [JSON.stringify(board.outline), JSON.stringify(board.nets)];
  for (const f of board.footprints) {
    const padNets = Object.entries(f.padNets)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([pad, net]) => `${pad}=${net}`)
      .join(",");
    parts.push(`${f.id}|${f.footprintId}|${f.side}|${padNets}`);
  }
  if (netlist) parts.push(JSON.stringify(netlist));
  return fnv1a(parts.join("\n"));
}
