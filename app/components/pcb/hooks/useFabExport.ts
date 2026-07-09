/**
 * useFabExport (PCB Stage 14) — drives the "Send to fab" dialog: client-side
 * DRC preview (same engine the server gate re-runs authoritatively), POST to
 * /api/pcb/export/gerbers, browser download of the returned zip. Mirrors
 * useDrc's editor-ref pattern.
 *
 * The DRC gate is HARD by default — `start` refuses on errors unless the
 * user's explicit `overrideDrcFail` is passed through; the server re-checks
 * regardless, so a misbehaving client still can't skip it.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { PcbBoard } from "@/app/lib/pcb/types";
import type { PcbNetlist } from "@/app/lib/pcb/netlist-bridge";
import { runDrc } from "@/app/lib/pcb/drc/run-drc";
import { getPreset } from "@/app/lib/pcb/drc/presets";
import type { DrcResult } from "@/app/lib/pcb/drc/types";
import type { FabPresetId } from "@/app/lib/pcb/fab/types";
import { getFabPreset } from "@/app/lib/pcb/fab/presets";

export type FabExportState =
  | "idle"
  | "checkingDrc"
  | "runningKicadCli"
  | "zipping"
  | "done"
  | "error";

export interface FabExportEditor {
  getBoard: () => PcbBoard | null;
  getNetlist: () => PcbNetlist | null;
  boardName?: string;
}

export interface FabExportHandle {
  state: FabExportState;
  drcResult?: DrcResult;
  lastError?: string;
  /** From the response headers on success: file count + zip size. */
  lastStats?: { files: number; totalBytes: number };
  elapsedMs: number;
  /** Synchronous client-side DRC against the fab preset's linked rules —
   * feeds the dialog chip; the server re-runs the same check on export. */
  checkDrc(fabPresetId: FabPresetId): DrcResult | undefined;
  start(fabPresetId: FabPresetId, overrideDrcFail?: boolean): Promise<void>;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
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
  const [drcResult, setDrcResult] = useState<DrcResult | undefined>(undefined);
  const [lastError, setLastError] = useState<string | undefined>(undefined);
  const [lastStats, setLastStats] = useState<{ files: number; totalBytes: number } | undefined>(undefined);
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

  const start = useCallback(
    async (fabPresetId: FabPresetId, overrideDrcFail = false): Promise<void> => {
      const board = editorRef.current.getBoard();
      if (!board) return;
      const boardName = editorRef.current.boardName ?? "sirkit-board";
      const t0 = Date.now();
      const tick = (): void => setElapsedMs(Date.now() - t0);
      setLastError(undefined);
      setLastStats(undefined);

      setState("checkingDrc");
      // Yield a frame so the state paints before the sync DRC blocks.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const drc = checkDrc(fabPresetId);
      tick();
      if (drc && !drc.ok && !overrideDrcFail) {
        const errors = drc.violations.filter((v) => v.severity === "error").length;
        setLastError(`DRC found ${errors} error${errors === 1 ? "" : "s"} — fix them or check "Export anyway".`);
        setState("error");
        return;
      }

      setState("runningKicadCli");
      try {
        const res = await fetch("/api/pcb/export/gerbers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            board,
            netlist: editorRef.current.getNetlist() ?? undefined,
            fabPresetId,
            overrideDrcFail,
            boardName,
          }),
        });
        tick();
        if (!res.ok) {
          let message = `export failed (HTTP ${res.status})`;
          try {
            const body = (await res.json()) as { error?: string; message?: string };
            if (body.error === "drc-failed") message = "DRC failed on the server — re-run DRC and review.";
            else if (body.error === "kicad-cli-missing") {
              message = "kicad-cli not found — set KICAD_CLI in .env.local (see docs/pcb-quickstart.md).";
            } else if (body.message || body.error) message = body.message ?? body.error!;
          } catch {
            /* non-JSON error body — keep the HTTP message */
          }
          setLastError(message);
          setState("error");
          return;
        }

        setState("zipping");
        const blob = await res.blob();
        tick();
        const statsHeader = res.headers.get("X-Sirkit-Bundle-Stats");
        if (statsHeader) {
          try {
            const s = JSON.parse(statsHeader) as { files?: number; totalBytes?: number };
            setLastStats({ files: s.files ?? 0, totalBytes: s.totalBytes ?? blob.size });
          } catch {
            setLastStats({ files: 0, totalBytes: blob.size });
          }
        } else {
          setLastStats({ files: 0, totalBytes: blob.size });
        }
        triggerDownload(
          blob,
          filenameFromDisposition(res.headers.get("Content-Disposition"), `${boardName}.zip`),
        );
        tick();
        setState("done");
      } catch (e) {
        setLastError(e instanceof Error ? e.message : String(e));
        setState("error");
      }
    },
    [checkDrc],
  );

  return { state, drcResult, lastError, lastStats, elapsedMs, checkDrc, start };
}
