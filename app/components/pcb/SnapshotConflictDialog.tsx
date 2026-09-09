"use client";

/**
 * [B16-C.3] "Another session published a newer schematic revision."
 *
 * Shown ONLY for `PS_SNAPSHOT_REVISION_CONFLICT` with the server's conflict
 * details — never for malformed input (400/422) or a server failure (5xx),
 * which keep their own bounded messages. It names the revision this session
 * pinned and the revision that is current, and offers two explicit choices:
 *
 *  - Refresh: re-read the durable truth (snapshot head, board, authority);
 *    nothing of this session is published.
 *  - Rebase & publish: adopt the CURRENT revision as the base and republish
 *    THIS session's schematic on top of it — a deliberate, named act, never a
 *    silent overwrite (the newer revision stays in durable history).
 */

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { PcbSyncSnapshotRevisionConflictDetails } from "@/app/lib/pcb-sync/types";

const short = (value: string | null | undefined, n = 18) => value ? (value.length > n ? `${value.slice(0, n)}…` : value) : "—";

export interface SnapshotConflictDialogProps {
  conflict: PcbSyncSnapshotRevisionConflictDetails | null;
  busy: boolean;
  onRefresh(): void;
  onRebase(): void;
  onDismiss(): void;
}

export function SnapshotConflictDialog({ conflict, busy, onRefresh, onRebase, onDismiss }: SnapshotConflictDialogProps) {
  return (
    <Dialog open={conflict !== null} onOpenChange={(open) => { if (!open) onDismiss(); }}>
      <DialogContent className="max-w-lg" data-testid="snapshot-conflict-dialog">
        <DialogHeader>
          <DialogTitle>Another session published a newer schematic revision</DialogTitle>
          <DialogDescription>
            Your synchronization was refused so nothing was overwritten. Choose how to continue.
          </DialogDescription>
        </DialogHeader>
        {conflict && (
          <div className="grid gap-1 text-xs text-zinc-200" data-testid="snapshot-conflict-details">
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
              <span className="text-zinc-400">You expected</span>
              <span data-testid="snapshot-conflict-expected">revision {conflict.expectedRevision}</span>
              <span className="text-zinc-400">Current on the server</span>
              <span data-testid="snapshot-conflict-current">revision {conflict.currentRevision} · schematic {short(conflict.currentSchematicRevision)} · {short(conflict.currentSnapshotDigest, 22)}</span>
              <span className="text-zinc-400">You tried to publish</span>
              <span>schematic {short(conflict.attemptedSchematicRevision)} · {short(conflict.attemptedSnapshotDigest, 22)}</span>
            </div>
            <p className="mt-1 text-zinc-400">
              <strong className="text-zinc-200">Refresh</strong> re-reads the durable board, snapshot and qualification truth; your schematic is not published.
              <strong className="ml-1 text-zinc-200">Rebase &amp; publish</strong> republishes this session&apos;s schematic on top of revision {conflict.currentRevision}; the newer revision stays in history and the resulting sync plan is previewed before anything is applied.
            </p>
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button variant="ghost" size="sm" onClick={onDismiss} disabled={busy} data-testid="snapshot-conflict-dismiss">Not now</Button>
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={busy} data-testid="snapshot-conflict-refresh">Refresh</Button>
          <Button size="sm" onClick={onRebase} disabled={busy} data-testid="snapshot-conflict-rebase">Rebase &amp; publish</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
