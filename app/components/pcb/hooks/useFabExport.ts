/** Client controller for verified native-beta and KiCad-assisted fab exports. */

import { useCallback, useEffect, useRef, useState } from "react";
import type { PcbBoard } from "@/app/lib/pcb/types";
import type { PcbNetlist } from "@/app/lib/pcb/netlist-bridge";
import { runDrc } from "@/app/lib/pcb/drc/run-drc";
import { getPreset } from "@/app/lib/pcb/drc/presets";
import type { DrcResult } from "@/app/lib/pcb/drc/types";
import type { FabPresetId } from "@/app/lib/pcb/fab/types";
import { getFabPreset } from "@/app/lib/pcb/fab/presets";

export type FabEngine = "native-beta" | "kicad";
export type FabExportState =
  | "idle"
  | "checkingDrc"
  | "preflighting"
  | "ready"
  | "compilingNative"
  | "runningKicadCli"
  | "zipping"
  | "done"
  | "error";

export interface NativePreflightSummary {
  packageId: string;
  packageSha256: string;
  files: Array<{ path: string; kind: string; bytes: number; sha256: string }>;
  diagnostics: Array<{
    code: string;
    severity: "info" | "warning" | "error";
    message: string;
    file?: string;
  }>;
  stages: Array<{ stage: string; status: "passed" | "failed"; elapsedMs: number }>;
}

export interface FabExportEditor {
  getBoard: () => PcbBoard | null;
  getNetlist: () => PcbNetlist | null;
  boardName?: string;
}

export interface FabExportHandle {
  state: FabExportState;
  drcResult?: DrcResult;
  lastError?: string;
  lastStats?: { files: number; totalBytes: number };
  nativePreflight?: NativePreflightSummary;
  elapsedMs: number;
  checkDrc(fabPresetId: FabPresetId): DrcResult | undefined;
  preflight(fabPresetId: FabPresetId): Promise<void>;
  start(engine: FabEngine, fabPresetId: FabPresetId, overrideDrcFail?: boolean): Promise<void>;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function filenameFromDisposition(header: string | null, fallback: string): string {
  const match = header?.match(/filename="([^"]+)"/);
  return match ? match[1] : fallback;
}

export function useFabExport(editor: FabExportEditor): FabExportHandle {
  const editorRef = useRef(editor);
  useEffect(() => {
    editorRef.current = editor;
  });

  const [state, setState] = useState<FabExportState>("idle");
  const [drcResult, setDrcResult] = useState<DrcResult>();
  const [lastError, setLastError] = useState<string>();
  const [lastStats, setLastStats] = useState<{ files: number; totalBytes: number }>();
  const [nativePreflight, setNativePreflight] = useState<NativePreflightSummary>();
  const [elapsedMs, setElapsedMs] = useState(0);

  const checkDrc = useCallback((fabPresetId: FabPresetId): DrcResult | undefined => {
    const board = editorRef.current.getBoard();
    if (!board) return undefined;
    const fab = getFabPreset(fabPresetId);
    const drcPreset = getPreset(fab.drcPresetId);
    const result = runDrc(board, drcPreset.rules, { presetId: drcPreset.id });
    setDrcResult(result);
    return result;
  }, []);

  const preflight = useCallback(async (fabPresetId: FabPresetId): Promise<void> => {
    const board = editorRef.current.getBoard();
    if (!board) return;
    const started = Date.now();
    const boardName = editorRef.current.boardName ?? "sirkit-board";
    setNativePreflight(undefined);
    setLastError(undefined);
    setState("checkingDrc");
    await new Promise((resolve) => setTimeout(resolve, 0));
    const drc = checkDrc(fabPresetId);
    if (drc && !drc.ok) {
      const errors = drc.violations.filter((violation) => violation.severity === "error").length;
      setLastError(`Native export is fail-closed: fix ${errors} DRC error${errors === 1 ? "" : "s"} before preflight.`);
      setElapsedMs(Date.now() - started);
      setState("error");
      return;
    }

    setState("preflighting");
    try {
      const response = await fetch("/api/pcb/export/gerbers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          board,
          netlist: editorRef.current.getNetlist() ?? undefined,
          fabPresetId,
          boardName,
          engine: "native-beta",
          action: "preflight",
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
          diagnostics?: Array<{ message?: string }>;
        };
        const first = body.diagnostics?.find((item) => item.message)?.message;
        throw new Error(first ?? body.message ?? body.error ?? `preflight failed (HTTP ${response.status})`);
      }
      setNativePreflight((await response.json()) as NativePreflightSummary);
      setState("ready");
    } catch (error) {
      setLastError(error instanceof Error ? error.message : String(error));
      setState("error");
    } finally {
      setElapsedMs(Date.now() - started);
    }
  }, [checkDrc]);

  const start = useCallback(async (
    engine: FabEngine,
    fabPresetId: FabPresetId,
    overrideDrcFail = false,
  ): Promise<void> => {
    const board = editorRef.current.getBoard();
    if (!board) return;
    const boardName = editorRef.current.boardName ?? "sirkit-board";
    const started = Date.now();
    const tick = (): void => setElapsedMs(Date.now() - started);
    setLastError(undefined);
    setLastStats(undefined);

    setState("checkingDrc");
    await new Promise((resolve) => setTimeout(resolve, 0));
    const drc = checkDrc(fabPresetId);
    tick();
    if (drc && !drc.ok && (engine === "native-beta" || !overrideDrcFail)) {
      const errors = drc.violations.filter((violation) => violation.severity === "error").length;
      setLastError(
        engine === "native-beta"
          ? `Native export is fail-closed: fix ${errors} DRC error${errors === 1 ? "" : "s"}.`
          : `DRC found ${errors} error${errors === 1 ? "" : "s"} - fix them or check "Export anyway".`,
      );
      setState("error");
      return;
    }

    setState(engine === "native-beta" ? "compilingNative" : "runningKicadCli");
    try {
      const response = await fetch("/api/pcb/export/gerbers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          board,
          netlist: editorRef.current.getNetlist() ?? undefined,
          fabPresetId,
          overrideDrcFail: engine === "kicad" && overrideDrcFail,
          boardName,
          engine,
          action: "package",
        }),
      });
      tick();
      if (!response.ok) {
        let message = `export failed (HTTP ${response.status})`;
        try {
          const body = (await response.json()) as { error?: string; message?: string };
          if (body.error === "drc-failed") message = "DRC failed on the server - re-run DRC and review.";
          else if (body.error === "native-preflight-failed") {
            message = body.message ?? "Native parse-back or manufacturing preflight failed.";
          } else if (body.error === "kicad-cli-missing") {
            message = "kicad-cli not found - set KICAD_CLI in .env.local (see docs/pcb-quickstart.md).";
          } else if (body.message || body.error) message = body.message ?? body.error!;
        } catch {
          // Keep the HTTP status message for non-JSON failures.
        }
        setLastError(message);
        setState("error");
        return;
      }

      setState("zipping");
      const blob = await response.blob();
      tick();
      const statsHeader = response.headers.get("X-Sirkit-Bundle-Stats");
      if (statsHeader) {
        try {
          const parsed = JSON.parse(statsHeader) as { files?: number; totalBytes?: number };
          setLastStats({ files: parsed.files ?? 0, totalBytes: parsed.totalBytes ?? blob.size });
        } catch {
          setLastStats({ files: 0, totalBytes: blob.size });
        }
      } else setLastStats({ files: 0, totalBytes: blob.size });
      triggerDownload(blob, filenameFromDisposition(response.headers.get("Content-Disposition"), `${boardName}.zip`));
      tick();
      setState("done");
    } catch (error) {
      setLastError(error instanceof Error ? error.message : String(error));
      setState("error");
    }
  }, [checkDrc]);

  return {
    state,
    drcResult,
    lastError,
    lastStats,
    nativePreflight,
    elapsedMs,
    checkDrc,
    preflight,
    start,
  };
}
