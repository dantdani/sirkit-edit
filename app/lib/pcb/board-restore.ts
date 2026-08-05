"use client";

/**
 * Explicit board-restore handoff (R06 Section 7).
 *
 * A checkpoint restore is a deliberate user action: the checkpoint's board
 * must become the editor's working board even when the durable server
 * authority has advanced past the checkpoint's base (the working copy is
 * then user content layered on the CURRENT authority — the autosave path
 * records exactly that). A module-level pending slot plus an event keeps
 * this race-free whether the PCB editor is already mounted or mounts later.
 */

import type { PcbBoard } from "./types";

export const BOARD_RESTORE_EVENT = "sirkit:pcb-board-restore";

let pending: PcbBoard | null = null;

export function requestBoardRestore(board: PcbBoard): void {
  pending = structuredClone(board);
  window.dispatchEvent(new Event(BOARD_RESTORE_EVENT));
}

export function consumePendingBoardRestore(): PcbBoard | null {
  const board = pending;
  pending = null;
  return board;
}
