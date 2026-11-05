"use client";

/**
 * Toolbar "Sync" button (PCB Stage 4): re-runs the schematic → board sync.
 * Shows an amber badge when the schematic's netlist hash has drifted from the
 * last synced one.
 */

import { ChevronDown, Loader2, RefreshCw } from "lucide-react";

export function SyncButton({
  dirty,
  syncing,
  progress,
  onSync,
  onOptions,
  sheetCount = 1,
}: {
  dirty: boolean;
  syncing: boolean;
  /** Live phase text while syncing (e.g. "Binding parts 3/10…"). */
  progress?: string | null;
  onSync: () => void;
  onOptions: () => void;
  /** [PR-J4, 2026-10-23] runbook J.5 / OD-258 item 6: the project's sheet count - the control states that it synchronises the WHOLE project. */
  sheetCount?: number;
}) {
  const whole = `synchronises the whole project (${sheetCount} sheet${sheetCount === 1 ? "" : "s"})`;
  return (
    <div className="flex shrink-0 overflow-hidden rounded-md border border-teal-500/45 bg-teal-500/15 text-teal-200 shadow-sm">
      <button
        type="button"
        onClick={onSync}
        disabled={syncing}
        title={dirty ? `Schematic changed — update the PCB now (${whole}, whatever sheet is open)` : `Place the schematic on the PCB (${whole}, whatever sheet is open)`}
        aria-label={`Schematic to PCB: ${whole}`}
        className="relative flex items-center gap-1.5 px-2.5 py-1 font-medium hover:bg-teal-500/20 disabled:opacity-50"
      >
        {syncing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
        {syncing && progress ? progress : "Schematic → PCB"}
        {dirty && !syncing && (
          <span
            className="absolute right-1 top-0.5 size-1.5 rounded-full bg-amber-400"
            aria-label="Schematic changed since last sync"
          />
        )}
      </button>
      <button
        type="button"
        onClick={onOptions}
        disabled={syncing}
        title="Schematic to PCB placement options"
        aria-label="Schematic to PCB placement options"
        className="border-l border-teal-500/35 px-1.5 hover:bg-teal-500/20 disabled:opacity-50"
      >
        <ChevronDown className="size-3.5" />
      </button>
    </div>
  );
}
