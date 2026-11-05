"use client";

import { Loader2, X } from "lucide-react";
import { useState } from "react";
import type { SyncOptions } from "@/app/lib/pcb/netlist-bridge";

type Placement = NonNullable<SyncOptions["placement"]>;

export function SyncPlacementDialog({
  open,
  syncing,
  onClose,
  onConfirm,
}: {
  open: boolean;
  syncing: boolean;
  onClose(): void;
  onConfirm(placement: Placement): void;
}) {
  const [mode, setMode] = useState<"center" | "preserve">("center");
  const [spread, setSpread] = useState(true);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/65 p-4" role="dialog" aria-modal="true" aria-label="Schematic import placement">
      <div className="w-full max-w-md overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-sm">
        <div className="flex items-start justify-between border-b border-zinc-800 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">Place imported footprints</h2>
            <p className="mt-0.5 text-[11px] text-zinc-500">Existing placed parts keep their exact coordinates.</p>
          </div>
          <button type="button" aria-label="Close import placement" onClick={onClose} disabled={syncing} className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-white disabled:opacity-40">
            <X className="size-4" />
          </button>
        </div>
        <fieldset className="space-y-2 p-4">
          <label className={`block cursor-pointer rounded-lg border p-3 ${mode === "center" ? "border-teal-500/50 bg-teal-500/10" : "border-zinc-800 bg-zinc-950/50"}`}>
            <span className="flex items-start gap-2">
              <input type="radio" name="sync-placement" checked={mode === "center"} onChange={() => setMode("center")} className="mt-0.5 accent-teal-500" />
              <span>
                <span className="block text-xs font-medium text-zinc-200">Place new parts near board center</span>
                <span className="mt-0.5 block text-[10px] leading-relaxed text-zinc-500">Recommended for schematic imports that do not contain trusted PCB coordinates.</span>
              </span>
            </span>
          </label>
          <label className={`block cursor-pointer rounded-lg border p-3 ${mode === "preserve" ? "border-teal-500/50 bg-teal-500/10" : "border-zinc-800 bg-zinc-950/50"}`}>
            <span className="flex items-start gap-2">
              <input type="radio" name="sync-placement" checked={mode === "preserve"} onChange={() => setMode("preserve")} className="mt-0.5 accent-teal-500" />
              <span>
                <span className="block text-xs font-medium text-zinc-200">Preserve import coordinates</span>
                <span className="mt-0.5 block text-[10px] leading-relaxed text-zinc-500">Use for trusted PCB coordinates. Imports without coordinates remain in the visible staging area.</span>
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
            <input type="checkbox" checked={spread} onChange={(event) => setSpread(event.target.checked)} disabled={mode === "preserve"} className="mt-0.5 accent-teal-500 disabled:opacity-40" />
            <span>
              <span className="block text-xs font-medium text-zinc-200">Spread overlapping or unplaced parts</span>
              <span className="mt-0.5 block text-[10px] text-zinc-500">Uses courtyard bounds and keeps the operation deterministic.</span>
            </span>
          </label>
        </fieldset>
        <div className="flex justify-end gap-2 border-t border-zinc-800 px-4 py-3">
          <button type="button" onClick={onClose} disabled={syncing} className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:text-white disabled:opacity-40">Cancel</button>
          <button
            type="button"
            onClick={() => onConfirm({ centerNewParts: mode === "center", spreadOverlaps: spread, preserveAbsoluteCoordinates: mode === "preserve" })}
            disabled={syncing}
            className="flex items-center gap-1.5 rounded bg-teal-600 px-3 py-1.5 text-xs text-white hover:bg-teal-500 disabled:opacity-50"
          >
            {syncing && <Loader2 className="size-3.5 animate-spin" />}
            Sync schematic
          </button>
        </div>
      </div>
    </div>
  );
}
