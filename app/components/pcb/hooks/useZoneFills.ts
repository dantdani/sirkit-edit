"use client";

/**
 * useZoneFills (PCB Stage 11) — reactive zone re-fill.
 *
 * Fills are DERIVED state: they live on the model (`Zone.fill`, persisted
 * with the board) but are never history entries. The hook watches committed
 * board changes (the editor passes `board` from its reducer, which follows
 * history.subscribe), marks every zone dirty on any foreign commit — a
 * conservative superset of "zones on the mutated item's layer"; without
 * patch introspection any commit may have moved copper on any layer — then
 * debounces 250 ms and recomputes all dirty fills in ONE
 * `history.applyDerived` write (no undo entry; subscribers re-render).
 * Undoing a track edit that dirtied a layer just re-triggers the same path.
 *
 * Loop guard: the derived write itself notifies subscribers; the hook
 * recognizes its own output by board identity and skips it.
 *
 * Web Worker path deferred (fills are < 300 ms on target boards; the engine
 * is pure and worker-ready when a board needs it). Main-thread only for MVP.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { PcbBoard } from "@/app/lib/pcb/types";
import type { PcbHistory } from "@/app/lib/pcb/history";
import {
  applyZoneFillCandidate,
  computeZoneFillCandidate,
  zoneFillIsCurrent,
} from "@/app/lib/pcb/zones/fill-lifecycle";

export const ZONE_FILL_LABEL = "Fill zones";
const DEBOUNCE_MS = 250;

export interface ZoneFillsEditor {
  getHistory: () => PcbHistory | null;
  /** The committed board from the editor reducer — drives re-fill scheduling. */
  board: PcbBoard | null;
}

export interface ZoneFillsHandle {
  isFilling: boolean;
  lastFillMs: number;
  /** Manual trigger ("Fill zones" button); also used by the debounced path. */
  fillAllDirty(): Promise<void>;
}

export function useZoneFills(editor: ZoneFillsEditor): ZoneFillsHandle {
  const editorRef = useRef(editor);
  useEffect(() => {
    editorRef.current = editor;
  });

  const [isFilling, setIsFilling] = useState(false);
  const [lastFillMs, setLastFillMs] = useState(0);
  const lastDerivedRef = useRef<PcbBoard | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runFill = useCallback(async (treatAllDirty: boolean): Promise<void> => {
    const h = editorRef.current.getHistory();
    if (!h) return;
    const board = h.present;
    const dirtyIds = new Set(
      board.zones.filter((z) => treatAllDirty || z.dirty || !zoneFillIsCurrent(board, z)).map((z) => z.id),
    );
    if (dirtyIds.size === 0) return;

    setIsFilling(true);
    // Yield a macrotask so the "filling" state paints before the sync engine runs.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const t0 = performance.now();

    const current = h.present; // may have advanced during the yield
    const results = new Map(
      current.zones
        .filter((z) => dirtyIds.has(z.id) || z.dirty || !zoneFillIsCurrent(current, z))
        .map((z) => [z.id, computeZoneFillCandidate(current, z)]),
    );

    h.applyDerived(ZONE_FILL_LABEL, (draft) => {
      for (const candidate of results.values()) applyZoneFillCandidate(draft, candidate);
    });
    lastDerivedRef.current = h.present;
    setLastFillMs(Math.round((performance.now() - t0) * 10) / 10);
    setIsFilling(false);
  }, []);

  const fillAllDirty = useCallback((): Promise<void> => runFill(true), [runFill]);

  const board = editor.board;
  useEffect(() => {
    if (!board || board.zones.length === 0) return;
    if (board === lastDerivedRef.current) return; // our own derived write
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      // Any foreign commit may have moved copper on any layer → all dirty.
      void runFill(true);
    }, DEBOUNCE_MS);
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [board, runFill]);

  return { isFilling, lastFillMs, fillAllDirty };
}
