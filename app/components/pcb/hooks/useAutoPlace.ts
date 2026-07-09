/**
 * useAutoPlace (PCB Stage 8) — one-click auto-place.
 *
 * Mirrors useAutoroute's editor-ref + commit-through-history shape: snapshot
 * the board, run the (synchronous, sub-500 ms) autoPlace pipeline, and commit
 * the ENTIRE batch as a single "Auto-place" history entry so one Ctrl+Z
 * reverses every placement. Web Worker path deferred (documented in the
 * progress note) — the compute is well inside the main-thread budget.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { PcbHistory } from "@/app/lib/pcb/history";
import type { PcbNetlist } from "@/app/lib/pcb/netlist-bridge";
import { autoPlace } from "@/app/lib/pcb/autoplace/auto-place";
import type { AutoPlaceResult } from "@/app/lib/pcb/autoplace/types";
import { buildAutoPlaceCommand, mutateBoardWithAutoPlace } from "@/app/lib/pcb/autoplace/command";

export interface AutoPlaceEditor {
  /** The CURRENT history (PcbEditor recreates it on board reseed). */
  getHistory: () => PcbHistory | null;
  /** Last synced netlist, if any — sharpens the deterministic seed. */
  getNetlist?: () => PcbNetlist | null;
  toast?: (message: string) => void;
}

export type AutoPlaceState = "idle" | "running" | "done" | "error";

export interface AutoPlaceHandle {
  state: AutoPlaceState;
  lastResult?: AutoPlaceResult;
  lastError?: string;
  run(): Promise<void>;
}

export function useAutoPlace(editor: AutoPlaceEditor): AutoPlaceHandle {
  const editorRef = useRef(editor);
  useEffect(() => {
    editorRef.current = editor;
  });

  const [state, setState] = useState<AutoPlaceState>("idle");
  const [lastResult, setLastResult] = useState<AutoPlaceResult | undefined>(undefined);
  const [lastError, setLastError] = useState<string | undefined>(undefined);
  const runningRef = useRef(false);

  const run = useCallback(async () => {
    if (runningRef.current) return;
    const h = editorRef.current.getHistory();
    if (!h) return;
    runningRef.current = true;
    setState("running");
    setLastError(undefined);
    // Let React paint the spinner before the synchronous compute.
    await new Promise((resolve) => setTimeout(resolve, 0));
    try {
      const board = h.present;
      const result = autoPlace(board, editorRef.current.getNetlist?.() ?? null);
      const cmd = buildAutoPlaceCommand(board, result.placements);
      if (cmd.after.length === 0) {
        setLastResult(result);
        setState("done");
        editorRef.current.toast?.("Auto-place: nothing to move");
        return;
      }
      h.execute("Auto-place", (draft) => mutateBoardWithAutoPlace(draft, cmd));
      setLastResult(result);
      setState("done");
      const { initialRatsnestLengthNm: before, finalRatsnestLengthNm: after, elapsedMs } = result.stats;
      const drop = before > 0 ? ` · rats-nest −${Math.round(((before - after) / before) * 100)}%` : "";
      editorRef.current.toast?.(`Placed ${cmd.after.length} footprints in ${elapsedMs}ms${drop}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setLastError(message);
      setState("error");
      editorRef.current.toast?.(`Auto-place failed: ${message}`);
    } finally {
      runningRef.current = false;
    }
  }, []);

  return { state, lastResult, lastError, run };
}
