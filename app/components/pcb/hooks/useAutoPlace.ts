/** Cancellable worker-backed one-click auto-placement. */

import { useCallback, useEffect, useRef, useState } from "react";
import { commitPcbCandidate } from "@/app/lib/engineering/pcb-commit-gateway";
import type { PcbHistory } from "@/app/lib/pcb/history";
import type { PcbBoardLifecycleScope } from "@/app/lib/pcb/lifecycle/board-lifecycle";
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
  /** B08.2 — capture THE board lifecycle scope at submission (run) and at
   *  apply: progress, previews, candidates, errors, and toasts verify it
   *  after every await; the worker terminates on lifecycle replacement.
   *  Preview candidates carry their scope — GENERATION, not the digest pin,
   *  decides staleness (a same-digest checkpoint restore still discards). */
  captureLifecycle?: () => PcbBoardLifecycleScope;
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
  /** B08.2 — lifecycle replacement: terminate the worker, discard the
   *  preview candidate, and release the NEW generation from the old busy
   *  flag. Silent (never toasts) — not a user cancellation. */
  invalidate(): void;
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
  // B08.2 — request-keyed busy ownership (see useAutoroute): a run whose
  // generation ended no longer blocks a fresh-generation run.
  const activeRef = useRef<{ requestId: string; isCurrent: () => boolean } | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  const requestSeqRef = useRef(0);
  const candidateRef = useRef<{ result: AutoPlaceResult; revision: string; scope: PcbBoardLifecycleScope | null } | undefined>(undefined);

  useEffect(() => () => {
    workerRef.current?.terminate();
  }, []);

  const cancel = useCallback((): void => {
    if (!activeRef.current) return;
    cancelRef.current?.();
    cancelRef.current = null;
    workerRef.current = null;
    activeRef.current = null;
    setState("cancelled");
    setLastError(undefined);
    editorRef.current.toast?.("Auto-placement cancelled; board unchanged");
  }, []);

  const invalidate = useCallback((): void => {
    cancelRef.current?.();
    cancelRef.current = null;
    workerRef.current?.terminate();
    workerRef.current = null;
    activeRef.current = null;
    candidateRef.current = undefined;
    setState("idle");
    setLastResult(undefined);
    setLastError(undefined);
    setProgress(undefined);
  }, []);

  const run = useCallback(async (): Promise<void> => {
    if (activeRef.current?.isCurrent()) return;
    const history = editorRef.current.getHistory();
    if (!history) return;
    // B08.2 — lifecycle scope captured at SUBMISSION; verified before every
    // side effect below (progress writes, preview publication, toasts).
    const scope = editorRef.current.captureLifecycle?.() ?? null;
    const owned = (): boolean => scope === null || scope.isCurrent();
    const requestId = scope?.requestId ?? `auto-place-local-${++requestSeqRef.current}`;
    activeRef.current = { requestId, isCurrent: owned };
    setState("running");
    setLastError(undefined);
    const startedAt = Date.now();
    setProgress({ phase: "analyzing", percent: 0, elapsedMs: 0 });
    const elapsedTimer = window.setInterval(() => {
      if (owned()) setProgress((current) => current ? { ...current, elapsedMs: Date.now() - startedAt } : current);
    }, 100);
    const onLifecycleAbort = (): void => {
      // Lifecycle replacement mid-run: the worker dies NOW; the pending
      // promise rejects as a cancellation (classified below, silently).
      cancelRef.current?.();
      cancelRef.current = null;
    };
    scope?.signal.addEventListener("abort", onLifecycleAbort, { once: true });

    try {
      const board = history.present;
      const revision = pcbRevisionId(board);
      const netlist = editorRef.current.getNetlist?.() ?? null;
      const result = typeof Worker === "undefined"
        ? autoPlace(board, netlist, undefined, {
            onProgress: (next) => { if (owned()) setProgress({ ...next, elapsedMs: Date.now() - startedAt }); },
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
                if (owned()) setProgress({ ...event.data.progress, elapsedMs: Date.now() - startedAt });
              } else if (event.data.type === "complete") {
                resolve(event.data.result);
              } else {
                reject(new Error(event.data.error));
              }
            };
            worker.onerror = (event) => reject(new Error(event.message || "Auto-placement worker failed."));
            worker.postMessage({ board, netlist } satisfies AutoPlaceWorkerRequest);
          });

      if (!owned()) return; // stale generation: the candidate is discarded
      if (pcbRevisionId(history.present) !== revision) {
        throw new Error("Board changed while auto-placement was running; candidate discarded.");
      }
      if (!result.report.success) {
        candidateRef.current = { result, revision, scope };
        setLastResult(result);
        setState("done");
        editorRef.current.toast?.(
          `Placement could not satisfy routing spacing — ${result.report.blockedPadEscapes} blocked pad escapes, ${result.report.envelopeOverlaps} envelope overlaps; board unchanged`,
        );
        return;
      }

      const engineering = result.engineering;
      if (!engineering) throw new Error("Placement result is missing Stage 7 candidate evidence.");
      candidateRef.current = { result, revision, scope };
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
        // User cancel already set "cancelled"; a lifecycle abort stays
        // silent (invalidate() owns the reset).
        return;
      }
      if (!owned()) return;
      const message = error instanceof Error ? error.message : String(error);
      setLastError(message);
      setState("error");
      editorRef.current.toast?.(`Auto-place failed: ${message}`);
    } finally {
      window.clearInterval(elapsedTimer);
      scope?.signal.removeEventListener("abort", onLifecycleAbort);
      workerRef.current?.terminate();
      workerRef.current = null;
      cancelRef.current = null;
      // Request-keyed release: only THIS run may clear its own ownership.
      if (activeRef.current?.requestId === requestId) activeRef.current = null;
    }
  }, []);

  const apply = useCallback((): void => {
    const pending = candidateRef.current;
    const history = editorRef.current.getHistory();
    if (!pending || !history) return;
    const { result, revision, scope: candidateScope } = pending;
    // B08.2 — GENERATION is authoritative: a lifecycle replacement (even one
    // restoring a board with the SAME digest) invalidates the preview.
    if (candidateScope && !candidateScope.isCurrent()) {
      candidateRef.current = undefined;
      setLastResult(undefined);
      setState("idle");
      editorRef.current.toast?.("This board was replaced since the placement preview was produced; the candidate was discarded. Nothing was changed.");
      return;
    }
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
    // B08.2 — the apply-side completion callbacks are scoped too.
    const applyScope = editorRef.current.captureLifecycle?.() ?? null;
    const applyOwned = (): boolean => applyScope === null || applyScope.isCurrent();
    // (Re-checked again inside buildCandidate at serialized execution time.)
    // B08 — ONE canonical transaction: the candidate is re-validated against
    // the board at serialized execution time (applyPlacementCandidate pins
    // source revision, problem hash, and constraint program hash) and the
    // approved result board is delta-compiled. A changed base refuses with
    // zero mutation.
    void commitPcbCandidate(history, {
      commandId: "pcb.auto-place",
      label: "Engineering-aware auto-place",
      idempotencyKey: `auto-place:${engineering.selectedCandidate.candidateId}:${revision}`,
      metadata: {
        operationType: "auto_place_footprints",
        actor: "human",
        reason: `Approved Stage 7 candidate ${engineering.selectedCandidate.candidateId}; hard legality verified.`,
        details: { candidateHash: engineering.selectedCandidate.candidateHash, problemHash: engineering.problemHash, objectiveReport: engineering.selectedCandidate.objectiveReport },
      },
      buildCandidate: (board) => {
        if (pcbRevisionId(board) !== revision) throw new Error("Board changed after placement preview; candidate discarded.");
        const approved = applyPlacementCandidate({ board, problem: engineering.problem, candidate: engineering.selectedCandidate, actorId: "user:pcb-editor" });
        if (!approved.ok) throw new Error(approved.message);
        return {
          ...structuredClone(board),
          footprints: structuredClone(approved.board.footprints),
          tracks: structuredClone(approved.board.tracks),
          vias: structuredClone(approved.board.vias),
          zones: structuredClone(approved.board.zones),
          constraintState: structuredClone(approved.board.constraintState),
        };
      },
    }).then((commitResult) => {
      if (!applyOwned()) return; // stale generation: no state, no toast
      if (!commitResult.ok) {
        setLastError(commitResult.message);
        setState("error");
        editorRef.current.toast?.(`Placement apply rejected: ${commitResult.message}`);
        return;
      }
      candidateRef.current = undefined;
      setLastResult(undefined);
      setLastError(undefined);
      setState("idle");
      editorRef.current.toast?.(`Applied ${engineering.selectedCandidate.moves.length} placement moves as one undoable transaction.`);
    });
  }, []);

  const discard = useCallback((): void => {
    candidateRef.current = undefined;
    setLastResult(undefined);
    setLastError(undefined);
    setState("idle");
    editorRef.current.toast?.("Placement candidate discarded; board unchanged.");
  }, []);

  return { state, lastResult, lastError, progress, run, apply, discard, cancel, invalidate };
}
