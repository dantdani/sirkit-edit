"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PcbHistory } from "@/app/lib/pcb/history";
import type { PcbBoard } from "@/app/lib/pcb/types";
import type { DrcRules } from "@/app/lib/pcb/drc/types";
import { parseSes } from "@/app/lib/pcb/dsn/read-ses";
import { PCBToolService } from "@/app/lib/pcb/ai/pcb-tool-service";
import type { PCBRepairPlan, RepairExecutionMode, RepairTransactionPreview } from "@/app/lib/pcb/repair/types";
import { withAiBrain } from "@/app/lib/ai-preferences";

export interface PcbRepairEditor {
  getHistory(): PcbHistory | null;
  getRules(): DrcRules;
  getPresetId?(): string;
  toast?(message: string): void;
  onApplied?(): Promise<void> | void;
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
}

export function usePcbRepair(editor: PcbRepairEditor): PcbRepairHandle {
  const editorRef = useRef(editor);
  useEffect(() => {
    editorRef.current = editor;
  });
  const serviceRef = useRef<PCBToolService | null>(null);
  const [state, setState] = useState<PcbRepairHandle["state"]>("idle");
  const [mode, setMode] = useState<RepairExecutionMode>("safe_fixes_automatically");
  const [plan, setPlan] = useState<PCBRepairPlan>();
  const [preview, setPreview] = useState<RepairTransactionPreview>();
  const [error, setError] = useState<string>();
  const [progress, setProgress] = useState<PcbRepairHandle["progress"]>();
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);

  const stopProgress = useCallback((controller?: AbortController): void => {
    if (controller && abortRef.current !== controller) return;
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = null;
    abortRef.current = null;
  }, []);

  const startProgress = useCallback((phase: string, percent: number): AbortController => {
    abortRef.current?.abort();
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    const controller = new AbortController();
    abortRef.current = controller;
    startedAtRef.current = Date.now();
    setProgress({ phase, percent, elapsedMs: 0 });
    timerRef.current = window.setInterval(() => {
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

  const service = (): PCBToolService => {
    const history = editorRef.current.getHistory();
    if (!history) throw new Error("No PCB board is open.");
    const instance = new PCBToolService({
      history,
      rules: editorRef.current.getRules(),
      autoroute: async (board, netIds) => {
        const response = await fetch("/api/pcb/autoroute", {
          method: "POST",
          headers: { "content-type": "application/json" },
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
    const controller = startProgress("Inspecting board and grouping violations", 10);
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
          setProgress({ phase: "Using native deterministic planner", percent: 65, elapsedMs: Date.now() - startedAtRef.current });
          next = await instance.planRepairs(mode);
          editorRef.current.toast?.(`AI explanation unavailable; native deterministic repair plan prepared (${reason instanceof Error ? reason.message : String(reason)})`);
        }
      } else {
        next = await instance.planRepairs(mode);
      }
      setPlan(next);
      setProgress({ phase: "Repair plan ready", percent: 100, elapsedMs: Date.now() - startedAtRef.current });
      setState("ready");
    } catch (reason) {
      if (controller.signal.aborted) {
        setState("cancelled");
        return;
      }
      setError(reason instanceof Error ? reason.message : String(reason));
      setState("error");
    } finally {
      stopProgress(controller);
    }
  }, [mode, startProgress, stopProgress]);

  const previewFixes = useCallback(async (fixIds: string[]): Promise<void> => {
    if (!plan || !serviceRef.current) return;
    const controller = startProgress("Building repair candidate", 20);
    setState("previewing");
    setError(undefined);
    try {
      const result = await serviceRef.current.previewChanges({ planId: plan.id, fixIds });
      if (controller.signal.aborted) return;
      setPreview(result.preview);
      setProgress({ phase: "DRC and connectivity verified", percent: 100, elapsedMs: Date.now() - startedAtRef.current });
      setState(result.preview.blockers.length > 0 ? "error" : "ready");
      if (result.preview.blockers.length > 0) setError(result.preview.blockers[0]);
    } catch (reason) {
      if (controller.signal.aborted) {
        setState("cancelled");
        return;
      }
      setError(reason instanceof Error ? reason.message : String(reason));
      setState("error");
    } finally {
      stopProgress(controller);
    }
  }, [plan, startProgress, stopProgress]);

  const applyPreview = useCallback(async (approvedFixIds: string[]): Promise<void> => {
    if (!preview || !serviceRef.current) return;
    const controller = startProgress("Committing verified transaction", 80);
    setState("applying");
    setError(undefined);
    try {
    const result = await serviceRef.current.applyTransaction({ previewId: preview.id, approvedFixIds });
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
    setProgress({ phase: "Repair committed", percent: 100, elapsedMs: Date.now() - startedAtRef.current });
    } catch (reason) {
      if (controller.signal.aborted) {
        setState("cancelled");
        return;
      }
      setError(reason instanceof Error ? reason.message : String(reason));
      setState("error");
    } finally {
      stopProgress(controller);
    }
  }, [preview, startProgress, stopProgress]);

  const undoLast = useCallback(async (): Promise<void> => {
    if (!preview || !serviceRef.current) return;
    const result = await serviceRef.current.undoTransaction({ transactionId: preview.id });
    if (!result.ok) {
      setError(result.error ?? "Repair could not be undone.");
      setState("error");
      return;
    }
    setState("idle");
    editorRef.current.toast?.("PCB repair undone");
    await editorRef.current.onApplied?.();
  }, [preview]);

  return { state, mode, setMode, plan, preview, error, progress, createPlan, previewFixes, applyPreview, undoLast, cancel };
}
