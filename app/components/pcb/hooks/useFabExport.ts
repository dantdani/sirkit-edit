/** Client controller for verified native-beta and KiCad-assisted fab exports. */

import { projectSelectorHeaders, type ProjectSelectorScope } from "@/app/lib/project/project-selector";
import { useCallback, useEffect, useRef, useState } from "react";
import JSZip from "jszip";
import type { PcbBoard } from "@/app/lib/pcb/types";
import type { PcbNetlist } from "@/app/lib/pcb/netlist-bridge";
import { runDrc } from "@/app/lib/pcb/drc/run-drc";
import { getPreset } from "@/app/lib/pcb/drc/presets";
import type { DrcResult } from "@/app/lib/pcb/drc/types";
import type { FabPresetId } from "@/app/lib/pcb/fab/types";
import { getFabPreset } from "@/app/lib/pcb/fab/presets";
import { evaluatePcbFabricationReadiness } from "@/app/lib/pcb/readiness/evaluate";
import type { ManufacturingReleaseManifest, ReadinessReport } from "@/app/lib/pcb/readiness/types";

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
  readiness: ReadinessReport;
}

export interface FabExportEditor {
  getBoard: () => PcbBoard | null;
  getNetlist: () => PcbNetlist | null;
  boardName?: string;
  recordRelease?: (manifest: ManufacturingReleaseManifest) => void;
  /**
   * R06 follow-up: MFG01 server-authoritative verified release. When present,
   * verified (non-override) packages are produced by the server from its own
   * durable authority (fresh RC01–RC03 recompute) — a browser board is never
   * posted as release authority. Engineering overrides keep the legacy
   * explicitly-labelled unverified path.
   */
  verifiedRelease?: () => Promise<{ ok: boolean; message: string }>;
  /** [B16.0.2 §G] the active project identity — a SELECTOR for the
   *  authenticated, project-scoped engineering export route. Attribution is
   *  derived SERVER-side from the session; the browser never sends an actor
   *  or project label. */
  getScope?: () => ProjectSelectorScope | null;
}

export interface FabExportHandle {
  state: FabExportState;
  drcResult?: DrcResult;
  lastError?: string;
  lastStats?: { files: number; totalBytes: number };
  nativePreflight?: NativePreflightSummary;
  readiness?: ReadinessReport;
  elapsedMs: number;
  checkDrc(fabPresetId: FabPresetId): DrcResult | undefined;
  preflight(engine: FabEngine, fabPresetId: FabPresetId): Promise<void>;
  start(engine: FabEngine, fabPresetId: FabPresetId, engineeringOverride?: boolean, waiverReason?: string): Promise<void>;
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

function isReleaseManifest(value: unknown): value is ManufacturingReleaseManifest {
  if (typeof value !== "object" || value === null) return false;
  const manifest = value as Partial<ManufacturingReleaseManifest>;
  return manifest.schemaVersion === "sirkit.manufacturing-release.v1" &&
    typeof manifest.transactionId === "string" &&
    typeof manifest.designRevision === "string" &&
    typeof manifest.readinessReportId === "string" &&
    Array.isArray(manifest.artifacts);
}

async function releaseManifestFromBundle(blob: Blob): Promise<ManufacturingReleaseManifest> {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const entry = Object.values(zip.files).find((item) =>
    !item.dir && (item.name.endsWith("/SIRKIT_RELEASE_MANIFEST.json") ||
      item.name === "SIRKIT_RELEASE_MANIFEST.json" ||
      item.name.endsWith("/release-manifest.json") ||
      item.name === "release-manifest.json"),
  );
  if (!entry) throw new Error("Manufacturing package is missing its release manifest.");
  const parsed: unknown = JSON.parse(await entry.async("string"));
  if (!isReleaseManifest(parsed)) throw new Error("Manufacturing package contains an invalid release manifest.");
  return parsed;
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
  const [readiness, setReadiness] = useState<ReadinessReport>();
  const [elapsedMs, setElapsedMs] = useState(0);

  const checkDrc = useCallback((fabPresetId: FabPresetId): DrcResult | undefined => {
    const board = editorRef.current.getBoard();
    if (!board) return undefined;
    const fab = getFabPreset(fabPresetId);
    const drcPreset = getPreset(fab.drcPresetId);
    const result = runDrc(board, drcPreset.rules, { presetId: drcPreset.id });
    setDrcResult(result);
    setReadiness(evaluatePcbFabricationReadiness({
      board,
      netlist: editorRef.current.getNetlist() ?? undefined,
      fabPreset: fab,
      drcPreset,
      drcResult: result,
    }));
    return result;
  }, []);

  const preflight = useCallback(async (engine: FabEngine, fabPresetId: FabPresetId): Promise<void> => {
    const board = editorRef.current.getBoard();
    if (!board) return;
    const started = Date.now();
    const boardName = editorRef.current.boardName ?? "sirkit-board";
    setNativePreflight(undefined);
    setLastError(undefined);
    setState("checkingDrc");
    await new Promise((resolve) => setTimeout(resolve, 0));
    checkDrc(fabPresetId);

    setState("preflighting");
    try {
      const response = await fetch("/api/pcb/export/gerbers", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...projectSelectorHeaders(editorRef.current.getScope?.() ?? null) },
        body: JSON.stringify({
          board,
          netlist: editorRef.current.getNetlist() ?? undefined,
          fabPresetId,
          boardName,
          engine,
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
      const summary = (await response.json()) as NativePreflightSummary;
      setNativePreflight(summary);
      setReadiness(summary.readiness);
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
    engineeringOverride = false,
    waiverReason = "",
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
    const currentDrc = checkDrc(fabPresetId);
    const currentFab = getFabPreset(fabPresetId);
    const currentPreset = getPreset(currentFab.drcPresetId);
    const currentReadiness = evaluatePcbFabricationReadiness({
      board,
      netlist: editorRef.current.getNetlist() ?? undefined,
      fabPreset: currentFab,
      drcPreset: currentPreset,
      drcResult: currentDrc,
    });
    setReadiness(currentReadiness);
    tick();
    if (!engineeringOverride && currentReadiness.overallState !== "ready") {
      setLastError(`Verified release denied: ${currentReadiness.overallState.replace("_", " ")}. Review the exact blockers or create an engineering override.`);
      setState("error");
      return;
    }
    if (engineeringOverride && waiverReason.trim().length < 8) {
      setLastError("Engineering export requires a reason of at least 8 characters.");
      setState("error");
      return;
    }

    // Verified releases come from the MFG01 server-authoritative loader when
    // the editor provides it — never from this browser board. [B16.0.2 §G]
    // When no server-authoritative release flow exists (demo / unpersisted
    // board) a verified request is refused HERE — it is never routed to the
    // legacy engineering-export path, which can only ever produce an
    // explicitly-labelled unverified engineering prototype export.
    if (!engineeringOverride && !editorRef.current.verifiedRelease) {
      setLastError("Verified manufacturing release is only available through the server-authoritative release flow for a persisted project. This dialog can only generate an explicitly-labelled UNVERIFIED engineering prototype export (enable the override).");
      setState("error");
      return;
    }
    if (!engineeringOverride && editorRef.current.verifiedRelease) {
      setState("compilingNative");
      try {
        const result = await editorRef.current.verifiedRelease();
        tick();
        if (!result.ok) {
          setLastError(result.message);
          setState("error");
          return;
        }
        setState("done");
      } catch (error) {
        setLastError(error instanceof Error ? error.message : String(error));
        setState("error");
      }
      return;
    }

    setState(engine === "native-beta" ? "compilingNative" : "runningKicadCli");
    try {
      const response = await fetch("/api/pcb/export/gerbers", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...projectSelectorHeaders(editorRef.current.getScope?.() ?? null) },
        body: JSON.stringify({
          board,
          netlist: editorRef.current.getNetlist() ?? undefined,
          fabPresetId,
          // Only the explicitly-labelled engineering prototype export is ever
          // requested from this legacy path (see the refusal above).
          releaseMode: "engineering",
          waiverReason: waiverReason.trim(),
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
          if (body.error === "readiness-gate-failed") message = body.message ?? "Scoped PCB fabrication readiness gate denied release.";
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
      const releaseManifest = await releaseManifestFromBundle(blob);
      editorRef.current.recordRelease?.(releaseManifest);
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
    readiness,
    elapsedMs,
    checkDrc,
    preflight,
    start,
  };
}
