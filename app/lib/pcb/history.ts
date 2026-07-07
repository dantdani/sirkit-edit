/**
 * PCB undo/redo history (PCB Stage 5) — the pinned stack every board-editing
 * tool goes through. Immer `produceWithPatches` records patch/inverse-patch
 * pairs per committed gesture; structural sharing keeps 200-part boards cheap
 * and the patch log makes future collaborative/AI edit features tractable.
 *
 * The `transient`/`execute` split is load-bearing: during a drag the tool
 * mutates transiently every frame (no history entry, no notification); on
 * drop it calls `execute()` ONCE, which commits from the ORIGINAL
 * pre-transient state — so undo is one step per gesture, not per frame.
 *
 * Subscribers fire only on committed changes (execute/undo/redo). Transient
 * updates are invisible to them by design — the drag tool drives the renderer
 * through the scene's fast transform path instead.
 */

import { applyPatches, enablePatches, produce, produceWithPatches, type Patch } from "immer";
import type { PcbBoard } from "./types";

enablePatches();
// NOTE: immer's default auto-freeze stays ON deliberately. Frozen subtrees are
// immer's "no drafts inside" fast path — with freezing disabled, every
// per-frame transient() deep-walks the whole board (~4× slower at 600
// instances). It also guards read-only consumers (renderer, persistence).

/** Oldest entries are evicted past this depth. */
const MAX_ENTRIES = 200;

interface HistoryEntry {
  label: string;
  patches: Patch[];
  inversePatches: Patch[];
}

export interface PcbHistory {
  readonly present: PcbBoard;
  /** Commit one undoable step. Mutations apply to the pre-transient state. */
  execute(label: string, mutate: (draft: PcbBoard) => void): void;
  undo(): void;
  redo(): void;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** Fires on execute/undo/redo (NOT on transient). Returns unsubscribe. */
  subscribe(cb: (board: PcbBoard, entry: { label: string }) => void): () => void;
  /**
   * Mutate `present` without a history entry — for drag previews. The next
   * `execute()` commits from the ORIGINAL pre-transient state, so a gesture
   * of N transient frames + one execute yields exactly one entry.
   */
  transient(mutate: (draft: PcbBoard) => void): void;
}

export function createHistory(initial: PcbBoard): PcbHistory {
  let present = initial;
  /** Pre-transient state; non-null while uncommitted transient edits exist. */
  let transientBase: PcbBoard | null = null;
  const past: HistoryEntry[] = [];
  const future: HistoryEntry[] = [];
  const subscribers = new Set<(board: PcbBoard, entry: { label: string }) => void>();

  function notify(entry: { label: string }): void {
    for (const cb of subscribers) cb(present, entry);
  }

  /** Roll back any in-flight transient edits (undo/redo discard them). */
  function dropTransient(): void {
    if (transientBase !== null) {
      present = transientBase;
      transientBase = null;
    }
  }

  return {
    get present(): PcbBoard {
      return present;
    },
    get canUndo(): boolean {
      return past.length > 0;
    },
    get canRedo(): boolean {
      return future.length > 0;
    },

    execute(label: string, mutate: (draft: PcbBoard) => void): void {
      const base = transientBase ?? present;
      transientBase = null;
      const [next, patches, inversePatches] = produceWithPatches(base, mutate);
      present = next;
      past.push({ label, patches, inversePatches });
      if (past.length > MAX_ENTRIES) past.shift();
      future.length = 0;
      notify({ label });
    },

    undo(): void {
      dropTransient();
      const entry = past.pop();
      if (!entry) return;
      present = applyPatches(present, entry.inversePatches);
      future.push(entry);
      notify({ label: entry.label });
    },

    redo(): void {
      dropTransient();
      const entry = future.pop();
      if (!entry) return;
      present = applyPatches(present, entry.patches);
      past.push(entry);
      notify({ label: entry.label });
    },

    subscribe(cb: (board: PcbBoard, entry: { label: string }) => void): () => void {
      subscribers.add(cb);
      return () => {
        subscribers.delete(cb);
      };
    },

    transient(mutate: (draft: PcbBoard) => void): void {
      if (transientBase === null) transientBase = present;
      present = produce(present, mutate);
    },
  };
}
