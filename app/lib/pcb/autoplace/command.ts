/**
 * Auto-place history command (PCB Stage 8).
 *
 * The entire auto-place batch is ONE command, so a single Ctrl+Z reverses
 * every placement (Stage 5's immer patch log owns live undo; this pure
 * apply/invert pair is the testable reference, exactly like Stage 9's
 * `AutorouteImport`). The live editor commits via
 * `history.execute("Auto-place", d => mutateBoardWithAutoPlace(d, cmd))`.
 *
 * DEVIATION FROM THE PINNED SHAPE (documented in the progress note): the plan
 * pinned extending a `PlacementCommand` union in Stage 5's `commands.ts`, but
 * no such union exists in this codebase — Stage 5 history is immer-patch
 * based with no command layer for placement gestures. Following the Stage 9
 * precedent, the command is self-contained here; no read-only file changes.
 *
 * Semantics: apply sets every footprint named in `after` to that snapshot;
 * invert swaps `before`/`after`. Footprints that didn't move (and locked
 * ones) are omitted from both arrays; snapshot ids no longer on the board are
 * skipped cleanly (deleted-since-snapshot safety).
 */

import { produce } from "immer";
import type { PcbBoard } from "../types";
import type { Vec2 } from "../geometry";
import type { AutoPlaceResult } from "./types";

export interface FootprintSnapshot {
  id: string;
  at: Vec2;
  rotationDeg: number;
  side: "top" | "bottom";
}

export interface AutoPlaceApplyCommand {
  kind: "AutoPlaceApply";
  before: FootprintSnapshot[];
  after: FootprintSnapshot[];
}

const cloneSnap = (s: FootprintSnapshot): FootprintSnapshot => ({ ...s, at: { ...s.at } });

/**
 * Build the command from the CURRENT board (captures `before`) and an
 * auto-place result (populates `after`). Footprints whose placement is
 * unchanged are omitted from both arrays.
 */
export function buildAutoPlaceCommand(
  board: PcbBoard,
  placements: AutoPlaceResult["placements"],
): AutoPlaceApplyCommand {
  const before: FootprintSnapshot[] = [];
  const after: FootprintSnapshot[] = [];
  for (const inst of board.footprints) {
    const p = placements.get(inst.id);
    if (!p) continue;
    if (
      p.position.x === inst.at.x &&
      p.position.y === inst.at.y &&
      p.rotationDeg === inst.rotationDeg &&
      p.side === inst.side
    ) {
      continue;
    }
    before.push({ id: inst.id, at: { ...inst.at }, rotationDeg: inst.rotationDeg, side: inst.side });
    after.push({ id: inst.id, at: { ...p.position }, rotationDeg: p.rotationDeg, side: p.side });
  }
  return { kind: "AutoPlaceApply", before, after };
}

/**
 * Apply by mutating an immer draft (or any writable board). Snapshot ids not
 * present on the board are a clean no-op.
 */
export function mutateBoardWithAutoPlace(board: PcbBoard, cmd: AutoPlaceApplyCommand): void {
  const byId = new Map(cmd.after.map((s) => [s.id, s]));
  for (const fp of board.footprints) {
    const s = byId.get(fp.id);
    if (!s) continue;
    fp.at = { ...s.at };
    fp.rotationDeg = s.rotationDeg;
    fp.side = s.side;
  }
}

/** Pure form — returns a new board. Tests and redo reference. */
export function applyAutoPlaceCommand(board: PcbBoard, cmd: AutoPlaceApplyCommand): PcbBoard {
  return produce(board, (draft) => mutateBoardWithAutoPlace(draft, cmd));
}

/** Self-dual: swap before/after. */
export function invertAutoPlaceCommand(cmd: AutoPlaceApplyCommand): AutoPlaceApplyCommand {
  return {
    kind: "AutoPlaceApply",
    before: cmd.after.map(cloneSnap),
    after: cmd.before.map(cloneSnap),
  };
}
