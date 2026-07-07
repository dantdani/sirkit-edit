"use client";

/**
 * Toolbar "Sync" button (PCB Stage 4): re-runs the schematic → board sync.
 * Shows an amber badge when the schematic's netlist hash has drifted from the
 * last synced one.
 */

import { Loader2, RefreshCw } from "lucide-react";

export function SyncButton({
  dirty,
  syncing,
  onSync,
}: {
  dirty: boolean;
  syncing: boolean;
  onSync: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSync}
      disabled={syncing}
      title={dirty ? "Schematic changed since last sync" : "Sync board from schematic"}
      className="relative flex items-center gap-1.5 px-2 py-1 rounded text-teal-400 hover:text-teal-300 hover:bg-teal-500/10 transition-colors disabled:opacity-50"
    >
      {syncing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
      Sync
      {dirty && !syncing && (
        <span
          className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-amber-400"
          aria-label="Schematic changed since last sync"
        />
      )}
    </button>
  );
}
