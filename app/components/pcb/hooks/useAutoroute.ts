/** One-click bounded multilayer FreeRouting completion with one atomic commit. */

import { useCallback, useEffect, useRef, useState } from "react";
import type { PcbHistory } from "@/app/lib/pcb/history";
import { createEmptyBoard, type PcbBoard, type Track, type Via } from "@/app/lib/pcb/types";
import { parseSes, type SesLayerUsage } from "@/app/lib/pcb/dsn/read-ses";
import { buildAutorouteImportCommand } from "@/app/lib/pcb/autoroute/command";
import { applyRouteCommand, mutateBoardWithCommand } from "@/app/lib/pcb/route-tool.commands";
import { computeElectricalTruth } from "@/app/lib/pcb/electrical-truth";
import { runDrc } from "@/app/lib/pcb/drc/run-drc";
import type { DrcRules } from "@/app/lib/pcb/drc/types";
import type { LayerId } from "@/app/lib/pcb/layers";
import type { AutoroutePassReport, AutorouteUnresolvedConnection } from "@/app/lib/pcb/autoroute/completion";
import { pcbRevisionId } from "@/app/lib/pcb/ai/snapshot";
import type { PcbNetlist } from "@/app/lib/pcb/netlist-bridge";
import type { DrcPresetId } from "@/app/lib/pcb/drc/types";
import type { ReadinessReport } from "@/app/lib/pcb/readiness/types";

export interface AutorouteEditor {
  getHistory: () => PcbHistory | null;
  toast?: (message: string) => void;
  getDrcRules?: () => DrcRules;
  getNetlist?: () => PcbNetlist | null;
  getDrcPresetId?: () => DrcPresetId;
}

export type AutorouteState = "idle" | "queued" | "running" | "complete" | "partial" | "failed" | "cancelled";

export interface AutorouteResult {
  status: "complete" | "partial";
  tracksImported: number;
  viasImported: number;
  routedNets: number;
  totalNets: number;
  drcErrors?: number;
  requiredConnections: number;
  completedConnections: number;
  remainingConnections: number;
  layerUsage: Partial<Record<LayerId, SesLayerUsage>>;
  passCount: number;
  acceptedPasses: number;
  failures: AutorouteUnresolvedConnection[];
  passReports: AutoroutePassReport[];
  debugDirectory?: string;
  fabricationReadiness: ReadinessReport;
}

export interface AutorouteHandle {
  state: AutorouteState;
  elapsedMs: number;
  lastResult?: AutorouteResult;
  lastError?: string;
  run(): Promise<void>;
  cancel(): void;
}

interface AutorouteApiResponse {
  ok?: boolean;
  sourceRevision?: string;
  candidateRevision?: string;
  routeAttemptId?: string;
  sesText?: string;
  routes?: { tracks: Track[]; vias: Via[] };
  error?: string;
  engine?: { name?: string; version?: string; apiKeyRequired?: boolean };
  job?: { id?: string; status?: "complete" | "partial" | "failed" };
  verification?: {
    requiredConnections?: number;
    completedConnections?: number;
    remainingConnections?: number;
    routedNets?: number;
    totalNets?: number;
  };
  completion?: {
    acceptedPasses?: number;
    passes?: AutoroutePassReport[];
    failures?: AutorouteUnresolvedConnection[];
  };
  stats?: {
    elapsedMs?: number;
    tracksImported?: number;
    viasImported?: number;
    layerUsage?: Partial<Record<LayerId, SesLayerUsage>>;
  };
  debugDirectory?: string;
  readiness?: ReadinessReport;
}

export function useAutoroute(editor: AutorouteEditor): AutorouteHandle {
  const editorRef = useRef(editor);
  useEffect(() => {
    editorRef.current = editor;
  });
  const [state, setState] = useState<AutorouteState>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [lastResult, setLastResult] = useState<AutorouteResult>();
  const [lastError, setLastError] = useState<string>();
  const runningRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startRef = useRef(0);

  const stopTimer = useCallback(() => {
    if (timerRef.current !== null) clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  useEffect(() => () => {
    stopTimer();
    abortRef.current?.abort();
  }, [stopTimer]);

  const toast = (message: string): void => editorRef.current.toast?.(message);

  const cancel = useCallback(() => {
    if (!runningRef.current) return;
    abortRef.current?.abort();
    runningRef.current = false;
    stopTimer();
    setState("cancelled");
    toast("Autoroute cancelled; board unchanged");
  }, [stopTimer]);

  const run = useCallback(async (): Promise<void> => {
    if (runningRef.current) return;
    const board: PcbBoard = editorRef.current.getHistory()?.present ?? createEmptyBoard();
    const baseRevision = pcbRevisionId(board);
    runningRef.current = true;
    setState("queued");
    setLastError(undefined);
    setElapsedMs(0);
    startRef.current = Date.now();
    stopTimer();
    timerRef.current = setInterval(() => setElapsedMs(Date.now() - startRef.current), 250);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
      setState("running");
      const response = await fetch("/api/pcb/autoroute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          board,
          netlist: editorRef.current.getNetlist?.() ?? undefined,
          fabPresetId: editorRef.current.getDrcPresetId?.(),
        }),
        signal: controller.signal,
      });
      const body = await response.json() as AutorouteApiResponse;
      if (!response.ok || !body.ok || (!body.routes && !body.sesText)) {
        throw new Error(body.error ?? `Autoroute failed (${response.status})`);
      }
      if (!body.readiness) throw new Error("Autoroute response is missing the authoritative fabrication-readiness report.");
      const history = editorRef.current.getHistory();
      if (!history) throw new Error("No board to apply routes to");
      if (pcbRevisionId(history.present) !== baseRevision) {
        throw new Error("Board changed while autorouting; the stale route candidate was discarded.");
      }
      if (body.sourceRevision && body.sourceRevision !== baseRevision) {
        throw new Error("Autoroute response was generated from a different board revision and was discarded.");
      }
      const current = history.present;
      const parsed = body.routes ? undefined : parseSes(body.sesText ?? "", current);
      const imported = body.routes ?? { tracks: parsed?.tracks ?? [], vias: parsed?.vias ?? [] };
      const acceptedPasses = body.completion?.acceptedPasses ?? (imported.tracks.length + imported.vias.length > 0 ? 1 : 0);
      const passReports = body.completion?.passes ?? [];
      const failures = body.completion?.failures ?? [];

      if (acceptedPasses > 0) {
        const command = buildAutorouteImportCommand(current, imported);
        const projected = applyRouteCommand(current, command);
        if (body.candidateRevision && pcbRevisionId(projected) !== body.candidateRevision) {
          throw new Error("Autoroute candidate provenance check failed; board was left unchanged.");
        }
        history.execute("Autoroute board", (draft) => mutateBoardWithCommand(draft, command), {
          operationType: "autoroute_completion",
          actor: "autorouter",
          reason: `Applied ${acceptedPasses} monotonic high-effort routing pass(es).`,
          details: {
            routeAttemptId: body.routeAttemptId,
            sourceRevision: body.sourceRevision ?? baseRevision,
            candidateRevision: body.candidateRevision,
            passReports,
            failures,
          },
        });
      }

      const electricalTruth = computeElectricalTruth(history.present);
      const drcRules = editorRef.current.getDrcRules?.();
      const drcErrors = drcRules
        ? runDrc(history.present, drcRules).violations.filter((violation) => violation.severity === "error").length
        : undefined;
      const requiredConnections = electricalTruth.realized.requiredConnections;
      const completedConnections = electricalTruth.realized.completedConnections;
      const remainingConnections = electricalTruth.realized.remainingConnections;
      const result: AutorouteResult = {
        status: body.job?.status === "complete" && remainingConnections === 0 ? "complete" : "partial",
        tracksImported: body.stats?.tracksImported ?? imported.tracks.length,
        viasImported: body.stats?.viasImported ?? imported.vias.length,
        routedNets: electricalTruth.realized.routedNets,
        totalNets: electricalTruth.realized.totalNets,
        drcErrors,
        requiredConnections,
        completedConnections,
        remainingConnections,
        layerUsage: body.stats?.layerUsage ?? parsed?.layerUsage ?? {},
        passCount: passReports.length,
        acceptedPasses,
        failures,
        passReports,
        debugDirectory: body.debugDirectory,
        fabricationReadiness: body.readiness,
      };
      setLastResult(result);
      setState(result.status);
      const seconds = ((Date.now() - startRef.current) / 1000).toFixed(1);
      const engine = body.engine?.version ? `Freerouting ${body.engine.version} local · ` : "";
      const drcChip = drcErrors === undefined ? "" : ` · DRC: ${drcErrors} error${drcErrors === 1 ? "" : "s"}`;
      if (result.status === "complete") {
        toast(`${engine}Autoroute complete — ${result.completedConnections}/${result.requiredConnections} connections completed · 0 unrouted · ${result.passCount} pass${result.passCount === 1 ? "" : "es"} in ${seconds}s${drcChip}`);
      } else {
        const blocker = failures[0]?.primaryBlockers[0] ? ` · ${failures[0].primaryBlockers[0]}` : "";
        toast(`${engine}Autoroute partial — ${result.completedConnections}/${result.requiredConnections} connections completed · ${result.remainingConnections} remain · ${result.acceptedPasses}/${result.passCount} passes improved${blocker}${drcChip}`);
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      const raw = error instanceof Error ? error.message : String(error);
      const message = raw === "jar-missing"
        ? "Local Freerouting is not installed — run npm run setup:freerouting (no API key required)"
        : raw === "java-missing"
          ? "Freerouting's local Java runtime is missing — run npm run setup:freerouting"
          : raw;
      setLastError(message);
      setState("failed");
      toast(`Autoroute failed: ${message}`);
    } finally {
      runningRef.current = false;
      stopTimer();
      abortRef.current = null;
    }
  }, [stopTimer]);

  return { state, elapsedMs, lastResult, lastError, run, cancel };
}
