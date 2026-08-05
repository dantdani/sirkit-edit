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
import { applyPlacementCandidate } from "@/app/lib/pcb/placement/transaction";
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
  apply(): void;
  discard(): void;
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
  const candidateRef = useRef<{ result: AutoPlaceResult; revision: string } | undefined>(undefined);

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
        candidateRef.current = { result, revision };
        setLastResult(result);
        setState("done");
        editorRef.current.toast?.(
          `Placement could not satisfy routing spacing — ${result.report.blockedPadEscapes} blocked pad escapes, ${result.report.envelopeOverlaps} envelope overlaps; board unchanged`,
        );
        return;
      }

      const engineering = result.engineering;
      if (!engineering) throw new Error("Placement result is missing Stage 7 candidate evidence.");
      candidateRef.current = { result, revision };
      setLastResult(result);
      setState("done");
      if (engineering.selectedCandidate.moves.length === 0 && engineering.selectedCandidate.copperPlan.removeTrackIds.length === 0) {
        editorRef.current.toast?.("Auto-place: nothing to move");
        return;
      }
      const { initialRatsnestLengthNm: before, finalRatsnestLengthNm: after, elapsedMs } = result.stats;
      const drop = before > 0 ? ` · rats-nest −${Math.round(((before - after) / before) * 100)}%` : "";
      const outline = result.outlineResized ? " · generated placement region +10%" : "";
      const routeability = result.routeabilityAfter.score < result.routeabilityBefore.score
        ? ` · routeability +${Math.round(result.routeabilityBefore.score - result.routeabilityAfter.score)}`
        : "";
      const envelope = ` · envelope +${Math.round((result.report.envelopeScale - 1) * 100)}%`;
      editorRef.current.toast?.(`Placement preview ready: ${engineering.selectedCandidate.moves.length} moves in ${elapsedMs}ms${envelope}${outline}${drop}${routeability}. Review and apply explicitly.`);
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

  const apply = useCallback((): void => {
    const pending = candidateRef.current;
    const history = editorRef.current.getHistory();
    if (!pending || !history) return;
    const { result, revision } = pending;
    const engineering = result.engineering;
    if (!engineering || !result.report.success) {
      editorRef.current.toast?.("This placement candidate is not hard-legal and cannot be applied.");
      return;
    }
    if (pcbRevisionId(history.present) !== revision) {
      setLastError("Board changed after placement preview; candidate discarded.");
      setState("error");
      setLastResult(undefined);
      candidateRef.current = undefined;
      editorRef.current.toast?.("Board changed after placement preview; candidate discarded.");
      return;
    }
    const approved = applyPlacementCandidate({ board: history.present, problem: engineering.problem, candidate: engineering.selectedCandidate, actorId: "user:pcb-editor" });
    if (!approved.ok) {
      setLastError(approved.message);
      setState("error");
      editorRef.current.toast?.(`Placement apply rejected: ${approved.message}`);
      return;
    }
    history.execute("Engineering-aware auto-place", (draft) => {
      draft.footprints = structuredClone(approved.board.footprints);
      draft.tracks = structuredClone(approved.board.tracks);
      draft.vias = structuredClone(approved.board.vias);
      draft.zones = structuredClone(approved.board.zones);
      draft.constraintState = structuredClone(approved.board.constraintState);
    }, {
      operationType: "auto_place_footprints",
      actor: "human",
      reason: `Approved Stage 7 candidate ${engineering.selectedCandidate.candidateId}; hard legality verified.`,
      transactionId: approved.transaction.id,
      details: { candidateHash: engineering.selectedCandidate.candidateHash, problemHash: engineering.problemHash, objectiveReport: engineering.selectedCandidate.objectiveReport },
    });
    candidateRef.current = undefined;
    setLastResult(undefined);
    setLastError(undefined);
    setState("idle");
    editorRef.current.toast?.(`Applied ${engineering.selectedCandidate.moves.length} placement moves as one undoable transaction.`);
  }, []);

  const discard = useCallback((): void => {
    candidateRef.current = undefined;
    setLastResult(undefined);
    setLastError(undefined);
    setState("idle");
    editorRef.current.toast?.("Placement candidate discarded; board unchanged.");
  }, []);

  return { state, lastResult, lastError, progress, run, apply, discard, cancel };
}
