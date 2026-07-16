/** Cancellable worker-backed one-click auto-placement. */

import { useCallback, useEffect, useRef, useState } from "react";
import type { PcbHistory } from "@/app/lib/pcb/history";
import type { PcbNetlist } from "@/app/lib/pcb/netlist-bridge";
import {
  autoPlace,
  AutoPlaceCancelledError,
  type AutoPlaceProgress,
} from "@/app/lib/pcb/autoplace/auto-place";
import type { AutoPlaceResult } from "@/app/lib/pcb/autoplace/types";
import { buildAutoPlaceCommand, mutateBoardWithAutoPlace } from "@/app/lib/pcb/autoplace/command";
import { pcbRevisionId } from "@/app/lib/pcb/ai/snapshot";
import type { AutoPlaceWorkerRequest, AutoPlaceWorkerResponse } from "./autoplace.worker";

export interface AutoPlaceEditor {
  getHistory: () => PcbHistory | null;
  getNetlist?: () => PcbNetlist | null;
  toast?: (message: string) => void;
}

export type AutoPlaceState = "idle" | "running" | "done" | "cancelled" | "error";

export interface AutoPlaceUiProgress extends AutoPlaceProgress {
  elapsedMs: number;
}

export interface AutoPlaceHandle {
  state: AutoPlaceState;
  lastResult?: AutoPlaceResult;
  lastError?: string;
  progress?: AutoPlaceUiProgress;
  run(): Promise<void>;
  cancel(): void;
}

export function useAutoPlace(editor: AutoPlaceEditor): AutoPlaceHandle {
  const editorRef = useRef(editor);
  useEffect(() => {
    editorRef.current = editor;
  });

  const [state, setState] = useState<AutoPlaceState>("idle");
  const [lastResult, setLastResult] = useState<AutoPlaceResult>();
  const [lastError, setLastError] = useState<string>();
  const [progress, setProgress] = useState<AutoPlaceUiProgress>();
  const runningRef = useRef(false);
  const workerRef = useRef<Worker | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);

  useEffect(() => () => {
    workerRef.current?.terminate();
  }, []);

  const cancel = useCallback((): void => {
    if (!runningRef.current) return;
    cancelRef.current?.();
    cancelRef.current = null;
    workerRef.current = null;
    runningRef.current = false;
    setState("cancelled");
    setLastError(undefined);
    editorRef.current.toast?.("Auto-placement cancelled; board unchanged");
  }, []);

  const run = useCallback(async (): Promise<void> => {
    if (runningRef.current) return;
    const history = editorRef.current.getHistory();
    if (!history) return;
    runningRef.current = true;
    setState("running");
    setLastError(undefined);
    const startedAt = Date.now();
    setProgress({ phase: "analyzing", percent: 0, elapsedMs: 0 });
    const elapsedTimer = window.setInterval(() => {
      setProgress((current) => current ? { ...current, elapsedMs: Date.now() - startedAt } : current);
    }, 100);

    try {
      const board = history.present;
      const revision = pcbRevisionId(board);
      const netlist = editorRef.current.getNetlist?.() ?? null;
      const result = typeof Worker === "undefined"
        ? autoPlace(board, netlist, undefined, {
            onProgress: (next) => setProgress({ ...next, elapsedMs: Date.now() - startedAt }),
          })
        : await new Promise<AutoPlaceResult>((resolve, reject) => {
            const worker = new Worker(new URL("./autoplace.worker.ts", import.meta.url), {
              type: "module",
              name: "sirkit-auto-place",
            });
            workerRef.current = worker;
            cancelRef.current = () => {
              worker.terminate();
              reject(new AutoPlaceCancelledError());
            };
            worker.onmessage = (event: MessageEvent<AutoPlaceWorkerResponse>) => {
              if (event.data.type === "progress") {
                setProgress({ ...event.data.progress, elapsedMs: Date.now() - startedAt });
              } else if (event.data.type === "complete") {
                resolve(event.data.result);
              } else {
                reject(new Error(event.data.error));
              }
            };
            worker.onerror = (event) => reject(new Error(event.message || "Auto-placement worker failed."));
            worker.postMessage({ board, netlist } satisfies AutoPlaceWorkerRequest);
          });

      if (pcbRevisionId(history.present) !== revision) {
        throw new Error("Board changed while auto-placement was running; candidate discarded.");
      }
      if (!result.report.success) {
        setLastResult(result);
        setState("done");
        editorRef.current.toast?.(
          `Placement could not satisfy routing spacing — ${result.report.blockedPadEscapes} blocked pad escapes, ${result.report.envelopeOverlaps} envelope overlaps; board unchanged`,
        );
        return;
      }

      const command = buildAutoPlaceCommand(board, result.placements, result.outlineAfter);
      if (command.after.length === 0 && !command.outlineAfter) {
        setLastResult(result);
        setState("done");
        editorRef.current.toast?.("Auto-place: nothing to move");
        return;
      }
      history.execute("Auto-place", (draft) => mutateBoardWithAutoPlace(draft, command));
      setLastResult(result);
      setState("done");
      const { initialRatsnestLengthNm: before, finalRatsnestLengthNm: after, elapsedMs } = result.stats;
      const drop = before > 0 ? ` · rats-nest −${Math.round(((before - after) / before) * 100)}%` : "";
      const outline = result.outlineResized ? " · generated placement region +10%" : "";
      const routeability = result.routeabilityAfter.score < result.routeabilityBefore.score
        ? ` · routeability +${Math.round(result.routeabilityBefore.score - result.routeabilityAfter.score)}`
        : "";
      const envelope = ` · envelope +${Math.round((result.report.envelopeScale - 1) * 100)}%`;
      editorRef.current.toast?.(`Placed ${command.after.length} footprints in ${elapsedMs}ms${envelope}${outline}${drop}${routeability}`);
    } catch (error) {
      if (error instanceof AutoPlaceCancelledError) {
        setState("cancelled");
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      setLastError(message);
      setState("error");
      editorRef.current.toast?.(`Auto-place failed: ${message}`);
    } finally {
      window.clearInterval(elapsedTimer);
      workerRef.current?.terminate();
      workerRef.current = null;
      cancelRef.current = null;
      runningRef.current = false;
    }
  }, []);

  return { state, lastResult, lastError, progress, run, cancel };
}
