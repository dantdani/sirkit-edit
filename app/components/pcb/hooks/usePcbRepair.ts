"use client";

import type { LayoutCandidateStore } from "@/app/lib/pcb/candidates/layout-candidate";
import { projectSelectorHeaders, type ProjectSelectorScope } from "@/app/lib/project/project-selector";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PcbHistory } from "@/app/lib/pcb/history";
import type { PcbBoard } from "@/app/lib/pcb/types";
import type { PcbBoardLifecycleScope } from "@/app/lib/pcb/lifecycle/board-lifecycle";
import type { DrcRules } from "@/app/lib/pcb/drc/types";
import { parseSes } from "@/app/lib/pcb/dsn/read-ses";
import { PCBToolService } from "@/app/lib/pcb/ai/pcb-tool-service";
import type { PCBRepairPlan, RepairExecutionMode, RepairTransactionPreview } from "@/app/lib/pcb/repair/types";
import { withAiBrain } from "@/app/lib/ai-preferences";
import type { PcbNetlist } from "@/app/lib/pcb/netlist-bridge";

export interface PcbRepairEditor {
  getHistory(): PcbHistory | null;
  /** B08.2 — capture THE board lifecycle scope per operation (plan,
   *  preview, apply, undo): every post-await side effect (plan/preview
   *  state, progress, errors, toasts, onApplied) verifies it; the scope's
   *  signal aborts in-flight fetches on lifecycle replacement. */
  captureLifecycle?: () => PcbBoardLifecycleScope;
  getRules(): DrcRules;
  getPresetId?(): string;
  getNetlist?(): PcbNetlist | null;
  toast?(message: string): void;
  onApplied?(): Promise<void> | void;
  /** [B16.0.2 §B] the active project identity — a SELECTOR for the
   *  authenticated, project-scoped autoroute route. */
  getScope?(): ProjectSelectorScope | null;
  /** [B17-E] the editor's shared layout-candidate store and lifecycle generation. */
  candidates?: LayoutCandidateStore;
  getGeneration?: () => number | undefined;
}

export interface PcbRepairHandle {
  state: "idle" | "planning" | "previewing" | "ready" | "applying" | "done" | "cancelled" | "error";
  mode: RepairExecutionMode;
  setMode(mode: RepairExecutionMode): void;
  plan?: PCBRepairPlan;
  preview?: RepairTransactionPreview;
  error?: string;
  progress?: { phase: string; percent: number; elapsedMs: number };
  createPlan(): Promise<void>;
  previewFixes(fixIds: string[]): Promise<void>;
  applyPreview(approvedFixIds: string[]): Promise<void>;
  undoLast(): Promise<void>;
  cancel(): void;
  /** B08.2 — lifecycle replacement: abort in-flight work and discard the
   *  plan/preview (they were produced against the replaced board). Silent
   *  (never toasts) — not a user cancellation. */
  invalidate(): void;
}

export function usePcbRepair(editor: PcbRepairEditor): PcbRepairHandle {
  const editorRef = useRef(editor);
  useEffect(() => {
    editorRef.current = editor;
  });
  const serviceRef = useRef<PCBToolService | null>(null);
  // B08 — the service captures ONE history instance at plan time; a
  // lifecycle board replacement (hydration/sync/checkpoint restore)
  // recreates the editor history, and every later service call must refuse
  // rather than commit into the detached, dead history object.
  const serviceHistoryRef = useRef<PcbHistory | null>(null);
  const [state, setState] = useState<PcbRepairHandle["state"]>("idle");
  const [mode, setMode] = useState<RepairExecutionMode>("safe_fixes_automatically");
  const [plan, setPlan] = useState<PCBRepairPlan>();
  const [preview, setPreview] = useState<RepairTransactionPreview>();
  const [error, setError] = useState<string>();
  const [progress, setProgress] = useState<PcbRepairHandle["progress"]>();
  const serviceCurrent = useCallback((): PCBToolService | null => {
    const instance = serviceRef.current;
    if (!instance) return null;
    if (serviceHistoryRef.current !== editorRef.current.getHistory()) {
      editorRef.current.toast?.("The board was reloaded — this repair plan is stale. Create a new plan.");
      setState("error");
      setError("The board was reloaded — this repair plan is stale. Create a new plan.");
      return null;
    }
    return instance;
  }, []);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);

  const stopProgress = useCallback((controller?: AbortController): void => {
    if (controller && abortRef.current !== controller) return;
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = null;
    abortRef.current = null;
  }, []);

  // B08.2 — capture the operation's lifecycle scope; the progress interval
  // and its own controller-keyed cleanup stay request-owned.
  const beginScopedOperation = useCallback((): { scope: PcbBoardLifecycleScope | null; owned: () => boolean } => {
    const scope = editorRef.current.captureLifecycle?.() ?? null;
    const owned = (): boolean => scope === null || scope.isCurrent();
    return { scope, owned };
  }, []);

  const startProgress = useCallback((phase: string, percent: number, owned?: () => boolean): AbortController => {
    abortRef.current?.abort();
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    const controller = new AbortController();
    abortRef.current = controller;
    startedAtRef.current = Date.now();
    setProgress({ phase, percent, elapsedMs: 0 });
    timerRef.current = window.setInterval(() => {
      if (owned && !owned()) return;
      setProgress((current) => current ? { ...current, elapsedMs: Date.now() - startedAtRef.current } : current);
    }, 100);
    return controller;
  }, []);

  useEffect(() => () => {
    abortRef.current?.abort();
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
  }, []);

  const cancel = useCallback((): void => {
    if (!abortRef.current) return;
    abortRef.current.abort();
    stopProgress();
    setState("cancelled");
    setError(undefined);
    editorRef.current.toast?.("PCB repair job cancelled; board unchanged");
  }, [stopProgress]);

  const invalidate = useCallback((): void => {
    abortRef.current?.abort();
    stopProgress();
    serviceRef.current = null;
    serviceHistoryRef.current = null;
    setPlan(undefined);
    setPreview(undefined);
    setError(undefined);
    setProgress(undefined);
    setState("idle");
  }, [stopProgress]);

  const service = (): PCBToolService => {
    const history = editorRef.current.getHistory();
    if (!history) throw new Error("No PCB board is open.");
    serviceHistoryRef.current = history;
    const instance = new PCBToolService({
      history,
      rules: editorRef.current.getRules(),
      netlist: editorRef.current.getNetlist?.() ?? undefined,
      candidates: editorRef.current.candidates,
      generation: editorRef.current.getGeneration,
      autoroute: async (board, netIds) => {
        const response = await fetch("/api/pcb/autoroute", {
          method: "POST",
          headers: { "content-type": "application/json", ...projectSelectorHeaders(editorRef.current.getScope?.() ?? null) },
          body: JSON.stringify({ board, netIds }),
          signal: abortRef.current?.signal,
        });
        const data = (await response.json()) as { ok?: boolean; sesText?: string; routes?: { tracks: PcbBoard["tracks"]; vias: PcbBoard["vias"] }; error?: string };
        if (!response.ok || !data.ok || (!data.routes && !data.sesText)) throw new Error(data.error ?? "Affected-net autoroute failed.");
        if (data.routes) return data.routes;
        const parsed = parseSes(data.sesText ?? "", board);
        return { tracks: parsed.tracks, vias: parsed.vias };
      },
    });
    serviceRef.current = instance;
    return instance;
  };

  const createPlan = useCallback(async (): Promise<void> => {
    const { scope, owned } = beginScopedOperation();
    const controller = startProgress("Inspecting board and grouping violations", 10, owned);
    const onLifecycleAbort = (): void => controller.abort();
    scope?.signal.addEventListener("abort", onLifecycleAbort, { once: true });
    setState("planning");
    setError(undefined);
    setPreview(undefined);
    try {
      const instance = service();
      let next: PCBRepairPlan;
      if (mode === "safe_fixes_automatically") {
        try {
          const board = editorRef.current.getHistory()!.present;
          const response = await fetch("/api/pcb/repair/agent", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(withAiBrain({
              board,
              netlist: editorRef.current.getNetlist?.() ?? undefined,
              presetId: editorRef.current.getPresetId?.(),
              instruction: "Inspect every copper layer, group the DRC errors by root cause, and prepare a safe repair plan. Do not weaken rules.",
            })),
            signal: controller.signal,
          });
          const data = (await response.json()) as { ok?: boolean; plan?: PCBRepairPlan; error?: string };
          if (!response.ok || !data.ok || !data.plan) throw new Error(data.error ?? "AI planning unavailable");
          instance.registerPlan(data.plan);
          next = data.plan;
        } catch (reason) {
          if (controller.signal.aborted) throw reason;
          if (!owned()) throw reason; // stale: no fallback planning either
          setProgress({ phase: "Using native deterministic planner", percent: 65, elapsedMs: Date.now() - startedAtRef.current });
          next = await instance.planRepairs(mode);
          if (owned()) editorRef.current.toast?.(`AI explanation unavailable; native deterministic repair plan prepared (${reason instanceof Error ? reason.message : String(reason)})`);
        }
      } else {
        next = await instance.planRepairs(mode);
      }
      if (!owned()) return; // stale generation: the plan is discarded
      setPlan(next);
      setProgress({ phase: "Repair plan ready", percent: 100, elapsedMs: Date.now() - startedAtRef.current });
      setState("ready");
    } catch (reason) {
      if (controller.signal.aborted) {
        // A user cancel already surfaced "cancelled"; a lifecycle abort is
        // silent (invalidate() owns the reset).
        if (owned()) setState("cancelled");
        return;
      }
      if (!owned()) return;
      setError(reason instanceof Error ? reason.message : String(reason));
      setState("error");
    } finally {
      scope?.signal.removeEventListener("abort", onLifecycleAbort);
      stopProgress(controller);
    }
  }, [mode, beginScopedOperation, startProgress, stopProgress]);

  const previewFixes = useCallback(async (fixIds: string[]): Promise<void> => {
    const instance = serviceCurrent();
    if (!plan || !instance) return;
    const { scope, owned } = beginScopedOperation();
    const controller = startProgress("Building repair candidate", 20, owned);
    const onLifecycleAbort = (): void => controller.abort();
    scope?.signal.addEventListener("abort", onLifecycleAbort, { once: true });
    setState("previewing");
    setError(undefined);
    try {
      const result = await instance.previewChanges({ planId: plan.id, fixIds });
      if (controller.signal.aborted || !owned()) return;
      setPreview(result.preview);
      setProgress({ phase: "DRC and connectivity verified", percent: 100, elapsedMs: Date.now() - startedAtRef.current });
      setState(result.preview.blockers.length > 0 ? "error" : "ready");
      if (result.preview.blockers.length > 0) setError(result.preview.blockers[0]);
    } catch (reason) {
      if (controller.signal.aborted) {
        if (owned()) setState("cancelled");
        return;
      }
      if (!owned()) return;
      setError(reason instanceof Error ? reason.message : String(reason));
      setState("error");
    } finally {
      scope?.signal.removeEventListener("abort", onLifecycleAbort);
      stopProgress(controller);
    }
  }, [plan, serviceCurrent, beginScopedOperation, startProgress, stopProgress]);

  const applyPreview = useCallback(async (approvedFixIds: string[]): Promise<void> => {
    const instance = serviceCurrent();
    if (!preview || !instance) return;
    const { scope, owned } = beginScopedOperation();
    const controller = startProgress("Committing verified transaction", 80, owned);
    const onLifecycleAbort = (): void => controller.abort();
    scope?.signal.addEventListener("abort", onLifecycleAbort, { once: true });
    setState("applying");
    setError(undefined);
    try {
      const result = await instance.applyTransaction({ previewId: preview.id, approvedFixIds });
      if (!owned()) return; // stale: outcome (success OR failure) is discarded
      if (!result.ok) {
        setError(result.error ?? "Repair could not be applied.");
        setState("error");
        stopProgress(controller);
        return;
      }
      setState("done");
      editorRef.current.toast?.(
        `PCB repair: ${preview.metrics.errorsBefore} → ${preview.metrics.errorsAfter} errors · ${preview.metrics.unroutedBefore} → ${preview.metrics.unroutedAfter} unrouted`,
      );
      await editorRef.current.onApplied?.();
      if (!owned()) return;
      setProgress({ phase: "Repair committed", percent: 100, elapsedMs: Date.now() - startedAtRef.current });
    } catch (reason) {
      if (controller.signal.aborted) {
        if (owned()) setState("cancelled");
        return;
      }
      if (!owned()) return;
      setError(reason instanceof Error ? reason.message : String(reason));
      setState("error");
    } finally {
      scope?.signal.removeEventListener("abort", onLifecycleAbort);
      stopProgress(controller);
    }
  }, [preview, serviceCurrent, beginScopedOperation, startProgress, stopProgress]);

  const undoLast = useCallback(async (): Promise<void> => {
    const instance = serviceCurrent();
    if (!preview || !instance) return;
    const { owned } = beginScopedOperation();
    const result = await instance.undoTransaction({ transactionId: preview.id });
    if (!owned()) return; // stale generation: no state, no toast, no onApplied
    if (!result.ok) {
      setError(result.error ?? "Repair could not be undone.");
      setState("error");
      return;
    }
    setState("idle");
    editorRef.current.toast?.("PCB repair undone");
    await editorRef.current.onApplied?.();
  }, [preview, serviceCurrent, beginScopedOperation]);

  return { state, mode, setMode, plan, preview, error, progress, createPlan, previewFixes, applyPreview, undoLast, cancel, invalidate };
}
