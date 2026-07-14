"use client";

/**
 * useLivePreview (PCB Stage 17 Phase B) — the debounced (150 ms) live-preview
 * runner behind inspector fields. A field schedules its pending value on
 * every keystroke; 150 ms after the last one the field's `preview` closure
 * runs `previewEdits` (pure, < 20 ms at demo scale) and `hint` carries the
 * first violation's Stage 12-voice summary. Hints never block commits —
 * "live DRC never blocks".
 */

import { useCallback, useEffect, useRef, useState } from "react";
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

export function useLivePreview(preview?: (nm: number) => EditPreview): LivePreview {
  const [hint, setHint] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewRef = useRef(preview);
  previewRef.current = preview;

  const schedule = useCallback((nm: number | null) => {
    if (timer.current) clearTimeout(timer.current);
    if (nm === null || !previewRef.current) {
      setHint(null);
      return;
    }
    timer.current = setTimeout(() => {
      const run = previewRef.current;
      if (run) setHint(previewSummary(run(nm)));
    }, DEBOUNCE_MS);
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return { hint, schedule, clear: () => schedule(null) };
}
