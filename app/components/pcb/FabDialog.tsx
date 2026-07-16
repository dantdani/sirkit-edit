"use client";

/**
 * "Send to fab" dialog (PCB Stage 14). Preset picker (soft-linked to Stage
 * 12's DRC presets), auto-run DRC with a hard gate — the primary button stays
 * disabled on errors unless the explicit "Export anyway" checkbox is ticked —
 * then one click generates the full manufacturing bundle via
 * /api/pcb/export/gerbers and downloads the zip. Hand-rolled modal, same
 * idiom as ZoneTool's AddPlaneDialog (no dialog library in the repo).
 */

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FileCheck2, Loader2, ShieldCheck } from "lucide-react";
import type { DrcViolation } from "@/app/lib/pcb/drc/types";
import type { FabPresetId } from "@/app/lib/pcb/fab/types";
import { FAB_PRESETS, DEFAULT_FAB_PRESET_ID, getFabPreset } from "@/app/lib/pcb/fab/presets";
import type { FabEngine, FabExportHandle } from "./hooks/useFabExport";

const BUSY_LABEL: Record<string, string> = {
  checkingDrc: "Checking DRC…",
  preflighting: "Parsing native CAM…",
  compilingNative: "Compiling native package…",
  runningKicadCli: "Running kicad-cli…",
  zipping: "Zipping…",
};

function kb(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function FabDialog({
  open,
  onClose,
  fab,
  boardName = "sirkit-board",
  onZoomToViolation,
}: {
  open: boolean;
  onClose: () => void;
  fab: FabExportHandle;
  boardName?: string;
  onZoomToViolation?: (v: DrcViolation) => void;
}) {
  const [presetId, setPresetId] = useState<FabPresetId>(DEFAULT_FAB_PRESET_ID);
  const [engine, setEngine] = useState<FabEngine>("kicad");
  const [override, setOverride] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Stage 16: focus moves into the dialog on open so Esc closes it (and the
  // editor's modal guard keeps Ctrl+Z etc. from firing underneath).
  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  // Re-check DRC whenever the dialog opens or the preset changes.
  useEffect(() => {
    if (open) {
      fab.checkDrc(presetId);
      if (engine === "native-beta") void fab.preflight(presetId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- checkDrc is stable; drc depends on (open, preset)
  }, [open, presetId, engine]);

  // Reset the override on each open (render-time adjustment, AddPlaneDialog idiom).
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setOverride(false);
  }

  if (!open) return null;

  const preset = getFabPreset(presetId);
  const drc = fab.drcResult;
  const errors = drc?.violations.filter((v) => v.severity === "error") ?? [];
  const warnings = drc ? drc.violations.length - errors.length : 0;
  const busy =
    fab.state === "checkingDrc" ||
    fab.state === "preflighting" ||
    fab.state === "compilingNative" ||
    fab.state === "runningKicadCli" ||
    fab.state === "zipping";
  const nativeReady = engine === "native-beta" && fab.state === "ready" && Boolean(fab.nativePreflight);
  const gated =
    (errors.length > 0 && (engine === "native-beta" || !override)) ||
    (engine === "native-beta" && !nativeReady);

  const fileExamples = preset.layerBundle
    .filter((e) => e.enabled)
    .slice(0, 4)
    .map((e) => `${boardName}${e.fileSuffix}`)
    .join(", ");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-label="Send to fab"
        className="w-[46rem] max-w-[92vw] max-h-[84vh] overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 p-4 text-xs shadow-xl flex flex-col gap-3 outline-none"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !busy) {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <p className="text-sm font-medium text-zinc-100">Send to fab</p>

        <div className="grid grid-cols-2 gap-2" aria-label="Manufacturing engine">
          <button
            type="button"
            onClick={() => setEngine("native-beta")}
            disabled={busy}
            className={`rounded border p-2.5 text-left transition-colors ${
              engine === "native-beta"
                ? "border-teal-500 bg-teal-950/35 text-zinc-100"
                : "border-zinc-700 bg-zinc-950/40 text-zinc-400 hover:border-zinc-600"
            }`}
          >
            <span className="flex items-center gap-1.5 font-medium"><ShieldCheck className="size-3.5" /> Sirkit native beta</span>
            <span className="mt-1 block text-[11px] text-zinc-500">Deterministic X2/X3 + XNC, independent parse-back, fail-closed.</span>
          </button>
          <button
            type="button"
            onClick={() => setEngine("kicad")}
            disabled={busy}
            className={`rounded border p-2.5 text-left transition-colors ${
              engine === "kicad"
                ? "border-teal-500 bg-teal-950/35 text-zinc-100"
                : "border-zinc-700 bg-zinc-950/40 text-zinc-400 hover:border-zinc-600"
            }`}
          >
            <span className="flex items-center gap-1.5 font-medium"><FileCheck2 className="size-3.5" /> KiCad-assisted fallback</span>
            <span className="mt-1 block text-[11px] text-zinc-500">Existing production route and migration oracle.</span>
          </button>
        </div>

        {/* Preset picker */}
        <label className="flex flex-col gap-1 text-zinc-400">
          Fab preset
          <span className="flex items-center gap-2">
            <select
              aria-label="Fab preset"
              value={presetId}
              onChange={(e) => setPresetId(e.target.value as FabPresetId)}
              disabled={busy}
              className="flex-1 bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-zinc-200 focus:outline-none focus:border-teal-600"
            >
              {FAB_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 whitespace-nowrap">
              verified {preset.verifiedAt}
            </span>
          </span>
        </label>

        {/* DRC summary chip + brief error list */}
        {drc &&
          (errors.length > 0 ? (
            <div className="rounded border border-red-900/60 bg-red-950/40 p-2 flex flex-col gap-1">
              <span className="flex items-center gap-1.5 text-red-400 font-medium">
                <AlertTriangle className="size-3.5" />
                {errors.length} error{errors.length === 1 ? "" : "s"}, {warnings} warning{warnings === 1 ? "" : "s"}
              </span>
              <ul className="flex flex-col gap-0.5 text-red-200/80">
                {errors.slice(0, 5).map((v) => (
                  <li key={v.id}>
                    <button
                      type="button"
                      onClick={() => onZoomToViolation?.(v)}
                      className="text-left hover:underline"
                      title="Zoom to violation"
                    >
                      {v.kind}: {v.summary}
                    </button>
                  </li>
                ))}
                {errors.length > 5 && <li className="text-red-300/60">…and {errors.length - 5} more</li>}
              </ul>
            </div>
          ) : (
            <span className="flex items-center gap-1.5 self-start px-2 py-1 rounded bg-emerald-950/50 border border-emerald-900/60 text-emerald-400">
              <CheckCircle2 className="size-3.5" />0 errors{warnings > 0 ? `, ${warnings} warning${warnings === 1 ? "" : "s"}` : ""}
            </span>
          ))}

        {engine === "kicad" ? (
          <>
            <label className={`flex items-center gap-2 ${errors.length === 0 ? "text-zinc-600" : "text-zinc-300"}`}>
              <input
                type="checkbox"
                checked={override}
                disabled={errors.length === 0 || busy}
                onChange={(e) => setOverride(e.target.checked)}
                className="accent-teal-600"
              />
              Export anyway (I&apos;ll review manually)
            </label>
            {override && errors.length > 0 && (
              <p className="rounded border border-red-900/60 bg-red-950/40 p-2 text-red-300">
                Fab may reject boards with DRC violations. Review manually before ordering.
              </p>
            )}
          </>
        ) : (
          <p className="rounded border border-amber-800/50 bg-amber-950/25 p-2 text-amber-200/80">
            Native export has no generic override. Stale zones, DRC errors, invalid syntax, or MIR/parse-back differences block the ZIP.
          </p>
        )}

        {/* Preset detail */}
        <div className="text-zinc-500 flex flex-col gap-1">
          <p>
            Files will be named <span className="text-zinc-300 font-mono">{fileExamples}, …</span>
          </p>
          <p>{preset.notes}</p>
        </div>

        {engine === "native-beta" && fab.nativePreflight && (
          <div className="rounded border border-emerald-900/60 bg-emerald-950/25 p-2.5 flex flex-col gap-2">
            <span className="flex items-center gap-1.5 text-emerald-400 font-medium">
              <ShieldCheck className="size-3.5" /> Native parse-back passed
            </span>
            <div className="grid grid-cols-2 gap-1 text-[11px] text-zinc-400">
              {fab.nativePreflight.stages.map((item) => (
                <span key={item.stage} className="flex items-center gap-1">
                  <CheckCircle2 className="size-3 text-emerald-500" /> {item.stage}
                </span>
              ))}
            </div>
            <div className="max-h-28 overflow-y-auto rounded bg-zinc-950/60 p-1.5 font-mono text-[10px] text-zinc-400">
              {fab.nativePreflight.files.map((item) => (
                <div key={item.path} className="flex justify-between gap-3">
                  <span className="truncate">{item.path}</span><span className="shrink-0">{kb(item.bytes)}</span>
                </div>
              ))}
            </div>
            <span className="font-mono text-[10px] text-zinc-500">package {fab.nativePreflight.packageId.slice(0, 20)}…</span>
          </div>
        )}

        {/* Status line */}
        {fab.state === "done" && fab.lastStats && (
          <span className="flex items-center gap-1.5 self-start px-2 py-1 rounded bg-emerald-950/50 border border-emerald-900/60 text-emerald-400">
            <CheckCircle2 className="size-3.5" />
            Bundle ready — {fab.lastStats.files} files, {kb(fab.lastStats.totalBytes)}
          </span>
        )}
        {fab.state === "error" && fab.lastError && (
          <p className="rounded border border-red-900/60 bg-red-950/40 p-2 text-red-300">{fab.lastError}</p>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2 mt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-2.5 py-1.5 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          >
            Close
          </button>
          <button
            type="button"
            disabled={busy || gated}
            onClick={() => void fab.start(engine, presetId, override)}
            className={`px-2.5 py-1.5 rounded transition-colors flex items-center gap-1.5 ${
              gated
                ? "bg-zinc-800 text-zinc-500 cursor-not-allowed"
                : "bg-teal-600 text-white hover:bg-teal-500 disabled:opacity-60"
            }`}
          >
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            {busy
              ? BUSY_LABEL[fab.state]
              : gated
                ? errors.length > 0
                  ? `Fix DRC (${errors.length} error${errors.length === 1 ? "" : "s"})`
                  : "Native preflight required"
                : engine === "native-beta"
                  ? "Generate verified native package"
                  : "Generate KiCad-assisted files"}
          </button>
        </div>
      </div>
    </div>
  );
}
