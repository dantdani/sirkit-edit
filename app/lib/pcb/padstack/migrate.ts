/**
 * Padstack migration (PCB Stage 17 Phase C) — runs on board LOAD, outside
 * history (not undoable), mirroring the Stage 11 normalizeZones posture in
 * board-persistence.ts. Legacy vias are hashed by (size, drill): each dim
 * pair reuses a matching padstack (seeded defaults included) or auto-creates
 * one named `Auto 0.6/0.3`. IDEMPOTENT: a second run is a no-op — the tests
 * assert deep equality.
 *
 * Dims never change here (only `padstackId` is assigned), so a migrated board
 * renders and exports byte-identically to its pre-migration self.
 */

import type { PcbBoard } from "../types";
import { formatMm } from "../units";
import type { Padstack } from "./types";
import { addPadstack } from "./registry";
import { seedDefaultPadstacks } from "./defaults";

/** Assign padstacks to every legacy via. Mutates; returns true if changed. */
export function migrateViaPadstacks(board: PcbBoard): boolean {
  let changed = false;
  const list = board.padstacks ?? (board.padstacks = []);

  const byDims = new Map<string, Padstack>();
  for (const p of list) {
    if (p.kind === "via") byDims.set(`${p.outerNm}/${p.drillNm}`, p);
  }

  for (const via of board.vias) {
    if (via.padstackId !== undefined && list.some((p) => p.id === via.padstackId)) continue;
    const key = `${via.size}/${via.drill}`;
    let ps = byDims.get(key);
    if (!ps) {
      ps = addPadstack(board, {
        name: `Auto ${formatMm(via.size)}/${formatMm(via.drill)}`,
        kind: "via",
        outerNm: via.size,
        drillNm: via.drill,
        tented: true,
        zoneConnect: "solid",
      });
      byDims.set(key, ps);
    }
    via.padstackId = ps.id;
    changed = true;
  }
  return changed;
}

/** Load-time hook: seed the class defaults, then migrate legacy vias. */
export function ensureBoardPadstacks(board: PcbBoard): boolean {
  const seeded = seedDefaultPadstacks(board);
  const migrated = migrateViaPadstacks(board);
  return seeded || migrated;
}
