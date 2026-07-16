/**
 * useDrc (PCB Stage 12) — runs the batch DRC engine against the live board and
 * drives the violations panel. Mirrors useRouteTool's editor-ref pattern: it
 * reads the current board from history and the Pixi scene for zoom-to/highlight.
 * DRC is synchronous (< 200 ms on real boards); `run()` yields a frame first so
 * the "running" state paints.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { PcbScene } from "@/app/lib/pcb/render/scene";
import type { PcbHistory } from "@/app/lib/pcb/history";
import { createEmptyBoard } from "@/app/lib/pcb/types";
import type { PcbBoard } from "@/app/lib/pcb/types";
import { runDrc } from "@/app/lib/pcb/drc/run-drc";
import { getPreset, DEFAULT_PRESET_ID } from "@/app/lib/pcb/drc/presets";
import type { DrcResult, DrcViolation, DrcPresetId } from "@/app/lib/pcb/drc/types";
import { refHighlightId } from "@/app/lib/pcb/drc/format";

export interface DrcEditor {
  scene: PcbScene | null;
  getHistory: () => PcbHistory | null;
  /** Current committed board identity; displayed results are invalid after it changes. */
  board?: PcbBoard | null;
  /** Stage 17: re-apply the user's real selection overlay after the zoom-to
   *  flash (which borrows scene.setSelection). Falls back to clearing. */
  restoreSelection?: () => void;
}

export interface DrcHandle {
  state: "idle" | "running" | "done";
  lastResult?: DrcResult;
  activePresetId: DrcPresetId;
  setActivePresetId(id: DrcPresetId): void;
  run(): Promise<void>;
  zoomToViolation(v: DrcViolation): void;
}

const FLASH_MS = 2000;
const ZOOM_PX_PER_MM = 40;

export function useDrc(editor: DrcEditor): DrcHandle {
  const editorRef = useRef(editor);
  useEffect(() => {
    editorRef.current = editor;
  });

  const [state, setState] = useState<"idle" | "running" | "done">("idle");
  const [completed, setCompleted] = useState<{ board: PcbBoard; result: DrcResult } | undefined>(undefined);
  const [activePresetId, setActivePresetId] = useState<DrcPresetId>(DEFAULT_PRESET_ID);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastResult = editor.board === undefined || completed?.board === editor.board ? completed?.result : undefined;
  const visibleState = state === "done" && !lastResult ? "idle" : state;

  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    [],
  );

  const run = useCallback(async () => {
    const board = editorRef.current.getHistory()?.present ?? createEmptyBoard();
    setState("running");
    // Yield a macrotask so React paints "running" before the sync check blocks.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const result = runDrc(board, getPreset(activePresetId).rules, { presetId: activePresetId });
    if (editorRef.current.board === undefined || editorRef.current.board === board) {
      setCompleted({ board, result });
      setState("done");
    } else {
      setState("idle");
    }
  }, [activePresetId]);

  const zoomToViolation = useCallback((v: DrcViolation) => {
    const scene = editorRef.current.scene;
    if (!scene) return;
    scene.centerOn(v.location, ZOOM_PX_PER_MM);
    // Flash the offending items via the teal selection overlay, then clear.
    const ids = v.items.map(refHighlightId).filter((id) => id.length > 0);
    scene.setSelection(ids);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => {
      const editor = editorRef.current;
      if (editor.restoreSelection) editor.restoreSelection();
      else editor.scene?.setSelection([]);
    }, FLASH_MS);
  }, []);

  return { state: visibleState, lastResult, activePresetId, setActivePresetId, run, zoomToViolation };
}
