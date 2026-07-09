/**
 * useAutoroute (PCB Stage 9) — one-click Freerouting autoroute.
 *
 * Mirrors useNetClass's editor-ref + fetch + commit-through-history shape:
 * snapshot the board, POST it to /api/pcb/autoroute (which spawns the JAR),
 * parse the returned SES client-side, and commit the ENTIRE batch as a single
 * `AutorouteImport` history entry so one Ctrl+Z reverses the whole autoroute.
 *
 * The server never mutates board state — it returns raw SES text; this hook
 * owns parsing + dispatch. A 250 ms interval bumps `elapsedMs` for the toolbar
 * spinner. `cancel()` aborts the fetch (the subprocess keeps running server-side
 * — documented limitation; there is no cancel channel to the JAR in MVP).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { PcbHistory } from "@/app/lib/pcb/history";
import { createEmptyBoard, type PcbBoard } from "@/app/lib/pcb/types";
import { parseSes } from "@/app/lib/pcb/dsn/read-ses";
import { buildAutorouteImportCommand } from "@/app/lib/pcb/autoroute/command";
import { mutateBoardWithCommand } from "@/app/lib/pcb/route-tool.commands";
import { computeConnectivity } from "@/app/lib/pcb/connectivity-board";
import { runDrc } from "@/app/lib/pcb/drc/run-drc";
import type { DrcRules } from "@/app/lib/pcb/drc/types";

export interface AutorouteEditor {
  /** The CURRENT history (PcbEditor recreates it on board reseed). */
  getHistory: () => PcbHistory | null;
  toast?: (message: string) => void;
  /** Stage 12: optional DRC rules — when present, DRC runs on autoroute success. */
  getDrcRules?: () => DrcRules;
}

export type AutorouteState = "idle" | "running" | "done" | "error";

export interface AutorouteResult {
  tracksImported: number;
  viasImported: number;
  routedNets: number;
  totalNets: number;
  drcErrors?: number; // Stage 12: errors from the post-route DRC (undefined if not run)
}

export interface AutorouteHandle {
  state: AutorouteState;
  elapsedMs: number;
  lastResult?: AutorouteResult;
  lastError?: string;
  run(): Promise<void>;
  cancel(): void;
}

export function useAutoroute(editor: AutorouteEditor): AutorouteHandle {
  const editorRef = useRef(editor);
  useEffect(() => {
    editorRef.current = editor;
  });

  const [state, setState] = useState<AutorouteState>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [lastResult, setLastResult] = useState<AutorouteResult | undefined>(undefined);
  const [lastError, setLastError] = useState<string | undefined>(undefined);

  const runningRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startRef = useRef(0);

  const stopTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(
    () => () => {
      stopTimer();
      abortRef.current?.abort();
    },
    [stopTimer],
  );

  const toast = (m: string): void => editorRef.current.toast?.(m);

  const cancel = useCallback(() => {
    if (!runningRef.current) return;
    abortRef.current?.abort();
    runningRef.current = false;
    stopTimer();
    setState("idle");
    toast("Autoroute cancelled");
  }, [stopTimer]);

  const run = useCallback(async () => {
    if (runningRef.current) return;

    // Snapshot BEFORE the async gap; re-read history AFTER it to commit.
    const board: PcbBoard = editorRef.current.getHistory()?.present ?? createEmptyBoard();

    runningRef.current = true;
    setState("running");
    setLastError(undefined);
    setElapsedMs(0);
    startRef.current = Date.now();
    stopTimer();
    timerRef.current = setInterval(() => setElapsedMs(Date.now() - startRef.current), 250);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/pcb/autoroute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ board }),
        signal: controller.signal,
      });
      const body = (await res.json()) as { ok?: boolean; sesText?: string; error?: string };
      if (!res.ok || !body.ok || !body.sesText) {
        throw new Error(body.error ?? `Autoroute failed (${res.status})`);
      }

      const h = editorRef.current.getHistory();
      if (!h) throw new Error("No board to apply routes to");

      // Re-read the CURRENT board after the async gap and build the command
      // against it, so net-name resolution + replacedNetIds/removed stay
      // consistent with the board we actually mutate (see review finding).
      const current = h.present;
      const ses = parseSes(body.sesText, current);

      if (!ses.wasSuccessful || (ses.tracks.length === 0 && ses.vias.length === 0)) {
        const conn = computeConnectivity(current);
        setLastResult({
          tracksImported: 0,
          viasImported: 0,
          routedNets: conn.completion.routedNets,
          totalNets: conn.completion.totalNets,
        });
        setState("done");
        toast("Freerouting returned no routes — board unchanged");
        return;
      }

      const cmd = buildAutorouteImportCommand(current, { tracks: ses.tracks, vias: ses.vias });
      h.execute("Autoroute board", (draft) => mutateBoardWithCommand(draft, cmd));

      // Stage 12: run DRC on the routed board and surface the error count.
      const drcRules = editorRef.current.getDrcRules?.();
      const drcErrors = drcRules
        ? runDrc(h.present, drcRules).violations.filter((v) => v.severity === "error").length
        : undefined;

      const conn = computeConnectivity(h.present);
      const result: AutorouteResult = {
        tracksImported: ses.tracks.length,
        viasImported: ses.vias.length,
        routedNets: conn.completion.routedNets,
        totalNets: conn.completion.totalNets,
        drcErrors,
      };
      setLastResult(result);
      setState("done");
      const secs = ((Date.now() - startRef.current) / 1000).toFixed(1);
      const drcChip = drcErrors === undefined ? "" : ` · DRC: ${drcErrors} error${drcErrors === 1 ? "" : "s"}`;
      toast(
        `Routed ${result.tracksImported} tracks + ${result.viasImported} vias in ${secs}s (${result.routedNets}/${result.totalNets} nets)${drcChip}`,
      );
    } catch (e) {
      if (controller.signal.aborted) return; // cancel() already reset state
      const raw = e instanceof Error ? e.message : String(e);
      // Stage 16: env problems get actionable guidance, not error codes.
      const message =
        raw === "jar-missing"
          ? "Freerouting JAR not found — set FREEROUTING_JAR in .env.local (see docs/pcb-quickstart.md)"
          : raw === "java-missing"
            ? "Java runtime not found — install Java 21+ or set JAVA_HOME (see docs/pcb-quickstart.md)"
            : raw;
      setLastError(message);
      setState("error");
      toast(`Autoroute failed: ${message}`);
    } finally {
      runningRef.current = false;
      stopTimer();
      abortRef.current = null;
    }
  }, [stopTimer]);

  return { state, elapsedMs, lastResult, lastError, run, cancel };
}
