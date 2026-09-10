/** Cancellable worker-backed one-click auto-placement.
 *
 * [B17-E] The result is the SHARED layout candidate (`sirkit.layout-candidate.v1`)
 * registered in the editor's candidate store — the same artifact the agent's
 * placement preview and the preview route produce — and Apply is
 * `applyLayoutCandidate`: ONE canonical transaction with the exact base
 * revision + lifecycle generation re-checked at serialized execution time.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { PcbHistory } from "@/app/lib/pcb/history";
import type { PcbBoardLifecycleScope } from "@/app/lib/pcb/lifecycle/board-lifecycle";
import type { PcbNetlist } from "@/app/lib/pcb/netlist-bridge";
import {
  autoPlace,
  AutoPlaceCancelledError,
  type AutoPlaceProgress,
} from "@/app/lib/pcb/autoplace/auto-place";
import type { AutoPlaceResult } from "@/app/lib/pcb/autoplace/types";
import { applyLayoutCandidate, producePlacementCandidate, type LayoutCandidateStore, type PlacementLayoutCandidate } from "@/app/lib/pcb/candidates/layout-candidate";
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
  /** [B17-E] the editor's shared candidate store (one per editor mount). */
  candidates?: LayoutCandidateStore;
  /** [B17-E] the current lifecycle generation number (pinned into the candidate). */
  getGeneration?: () => number | undefined;
}

export type AutoPlaceState = "idle" | "running" | "done" | "cancelled" | "error";

export interface AutoPlaceUiProgress extends AutoPlaceProgress {
  elapsedMs: number;
}

export interface AutoPlaceHandle {
  state: AutoPlaceState;
  lastResult?: AutoPlaceResult;
  /** [B17-E] the shared candidate produced by the last successful run (registered in the store). */
  candidate?: PlacementLayoutCandidate;
  lastError?: string;
  progress?: AutoPlaceUiProgress;
  run(): Promise<void>;
  /** Apply the last run's candidate, or any candidate in the store by id (an agent's, for instance). */
  apply(candidateId?: string): void;
  discard(candidateId?: string): void;
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
  const [candidate, setCandidate] = useState<PlacementLayoutCandidate>();
  const [lastError, setLastError] = useState<string>();
  const [progress, setProgress] = useState<AutoPlaceUiProgress>();
  // B08.2 — request-keyed busy ownership (see useAutoroute): a run whose
  // generation ended no longer blocks a fresh-generation run.
  const activeRef = useRef<{ requestId: string; isCurrent: () => boolean } | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  const requestSeqRef = useRef(0);
  const scopeRef = useRef<PcbBoardLifecycleScope | null>(null);

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
    scopeRef.current = null;
    setCandidate(undefined);
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
      scopeRef.current = scope;
      const engineering = result.engineering;
      if (!result.report.success || !engineering) {
        setCandidate(undefined);
        setLastResult(result);
        setState("done");
        editorRef.current.toast?.(
          `Placement could not satisfy routing spacing — ${result.report.blockedPadEscapes} blocked pad escapes, ${result.report.envelopeOverlaps} envelope overlaps; board unchanged`,
        );
        return;
      }
      // [B17-E] the shared candidate: the worker's run wrapped once, registered where every consumer sees it.
      const produced = producePlacementCandidate({
        board,
        run: { runId: `run:${engineering.problemHash}`, problem: engineering.problem, candidates: [engineering.selectedCandidate], frontierCandidateIds: engineering.frontierCandidateIds, selectedCandidateId: engineering.selectedCandidate.candidateId, termination: engineering.termination, searchComplete: engineering.searchComplete, elapsedMs: result.stats.elapsedMs, diagnostics: [] },
        producer: "editor",
        generation: editorRef.current.getGeneration?.(),
      });
      if (!produced) throw new Error("Placement result is missing Stage 7 candidate evidence.");
      editorRef.current.candidates?.register(produced);
      setCandidate(produced);
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

  const resolveCandidate = (candidateId?: string): PlacementLayoutCandidate | undefined => {
    if (candidateId) {
      const found = editorRef.current.candidates?.get(candidateId);
      return found?.kind === "placement" ? found : undefined;
    }
    return candidate;
  };

  const apply = useCallback((candidateId?: string): void => {
    // B08.2 — GENERATION is authoritative: a lifecycle replacement (even one
    // restoring a board with the SAME digest) invalidates the preview — a
    // partial preview (no candidate, only a report) included. [B17 validation]
    // this check precedes the candidate lookup; B17-E had moved it behind it.
    const candidateScope = candidateId ? null : scopeRef.current;
    if (candidateScope && !candidateScope.isCurrent()) {
      const stale = resolveCandidate(candidateId);
      if (stale) editorRef.current.candidates?.retire(stale.candidateId, "stale");
      scopeRef.current = null;
      setCandidate(undefined);
      setLastResult(undefined);
      setState("idle");
      editorRef.current.toast?.("This board was replaced since the placement preview was produced; the candidate was discarded. Nothing was changed.");
      return;
    }
    const pending = resolveCandidate(candidateId);
    const history = editorRef.current.getHistory();
    if (!pending || !history) return;
    // B08.2 — the apply-side completion callbacks are scoped too.
    const applyScope = editorRef.current.captureLifecycle?.() ?? null;
    const applyOwned = (): boolean => applyScope === null || applyScope.isCurrent();
    // [B17-E] ONE canonical transaction through the shared apply path: the exact base revision, the lifecycle
    // generation, hard legality, problem/program hashes and protected copper are re-checked at serialized execution.
    void applyLayoutCandidate({ history, candidate: pending, actorId: "user:pcb-editor", generation: editorRef.current.getGeneration?.() }).then((commitResult) => {
      if (!applyOwned()) return; // stale generation: no state, no toast
      if (!commitResult.ok) {
        const message = commitResult.message;
        if ("code" in commitResult && (commitResult.code === "STALE_REVISION" || commitResult.code === "STALE_GENERATION" || commitResult.code === "EXPIRED")) {
          editorRef.current.candidates?.retire(pending.candidateId, "stale");
          if (!candidateId) { setCandidate(undefined); setLastResult(undefined); }
        }
        setLastError(message);
        setState("error");
        editorRef.current.toast?.(`Placement apply rejected: ${message}`);
        return;
      }
      editorRef.current.candidates?.retire(pending.candidateId, "applied");
      if (!candidateId || pending.candidateId === candidate?.candidateId) { setCandidate(undefined); setLastResult(undefined); }
      setLastError(undefined);
      setState("idle");
      editorRef.current.toast?.(`Applied ${pending.candidate.moves.length} placement moves from the ${pending.producer} candidate as one undoable transaction.`);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidate]);

  const discard = useCallback((candidateId?: string): void => {
    const pending = resolveCandidate(candidateId);
    if (pending) editorRef.current.candidates?.retire(pending.candidateId, "discarded");
    if (!candidateId || pending?.candidateId === candidate?.candidateId) {
      setCandidate(undefined);
      setLastResult(undefined);
      setLastError(undefined);
      setState("idle");
    }
    editorRef.current.toast?.("Placement candidate discarded; board unchanged.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidate]);

  return { state, lastResult, candidate, lastError, progress, run, apply, discard, cancel, invalidate };
}
