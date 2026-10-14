"use client";

/**
 * useLivePreview (PCB Stage 17 Phase B) — the debounced (150 ms) live-preview
 * runner behind inspector fields. A field schedules its pending value on
 * every keystroke; 150 ms after the last one the field's `preview` closure
 * runs `previewEdits` (pure, < 20 ms at demo scale) and `hint` carries the
 * first violation's Stage 12-voice summary. Hints never block commits —
 * "live DRC never blocks".
 */

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { EditPreview } from "@/app/lib/pcb/edit/preview";
import { previewSummary } from "@/app/lib/pcb/edit/preview";

const DEBOUNCE_MS = 150;

export interface LivePreview {
  /** First warning/error line for the pending value, or null when clean. */
  hint: string | null;
  /** Debounce-run the preview for a pending nm value; null cancels. */
  schedule(nm: number | null): void;
  clear(): void;
}

export function useLivePreview(preview?: (nm: number) => EditPreview, resetKey?: string): LivePreview {
  const [hint, setHint] = useState<{ key: string | undefined; value: string | null }>({ key: resetKey, value: null });
  // A hint belongs to the identity it was computed for. When that identity changes the hint is RETIRED during render, not
  // merely hidden: an A→B→A round trip (an external edit and its undo) must not revive A's old warning without a new preview.
  if (hint.key !== resetKey) setHint({ key: resetKey, value: null });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewRef = useRef(preview);
  useLayoutEffect(() => { previewRef.current = preview; }, [preview]);

  const schedule = useCallback((nm: number | null) => {
    if (timer.current) clearTimeout(timer.current);
    if (nm === null || !previewRef.current) {
      timer.current = null;
      setHint({ key: resetKey, value: null });
      return;
    }
    timer.current = setTimeout(() => {
      const run = previewRef.current;
      timer.current = null;
      if (run) setHint({ key: resetKey, value: previewSummary(run(nm)) });
    }, DEBOUNCE_MS);
  }, [resetKey]);

  useLayoutEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    },
    [resetKey],
  );

  return { hint: hint.key === resetKey ? hint.value : null, schedule, clear: () => schedule(null) };
}
