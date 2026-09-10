"use client";

/**
 * [B18-B] The confirmation surface for a `preview_then_confirm` execution
 * grant, mounted inside `PcbEditor` (the owner of the live board and the PCB
 * history).
 *
 * Pure presentational: it holds NO authority. It shows the exact change the
 * server-minted grant covers (the preview the server digested), states
 * plainly that nothing has changed yet, and offers exactly two actions:
 * `Confirm and apply` (the explicit click; ONE canonical PCB transaction,
 * exactly undoable) and `Cancel — change nothing`. Confirmation is disabled
 * — with the precise reason shown — whenever the live editor state no longer
 * matches the grant's base. It NEVER applies a safety, readiness or
 * manufacturability claim to a change.
 */

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import type { PublicExecutionGrant } from "@/app/lib/engineering/execution-grant";

export interface GrantedExecutionDialogProps {
  grant: PublicExecutionGrant | null;
  /** The minter's note (for example the retry guard's explanation), if any. */
  note: string | null;
  busy: boolean;
  /** null ⇒ confirmation enabled; otherwise the PRECISE, visible reason it is disabled. */
  disableReason: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export function GrantedExecutionDialog({ grant, note, busy, disableReason, onConfirm, onCancel }: GrantedExecutionDialogProps) {
  const base = grant?.binding.base.pcb ?? null;
  return (
    <Dialog open={grant !== null} onOpenChange={(open) => { if (!open && !busy) onCancel(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>AI change — confirm before it is made</DialogTitle>
        </DialogHeader>
        {grant && base && (
          <div className="space-y-3 text-sm" data-testid="granted-execution-card">
            <p className="text-zinc-400 text-xs">
              The assistant asks to make exactly this change ({grant.binding.operation.family}, {grant.binding.proposal.operationCount} operation
              {grant.binding.proposal.operationCount === 1 ? "" : "s"}) · grant {grant.grantId.slice(0, 14)}… · expires {new Date(grant.binding.expiresAt).toLocaleTimeString()}.{" "}
              <span className="text-zinc-300">Nothing has been changed yet.</span> Confirming revalidates everything against the live board and
              executes exactly ONE canonical PCB transaction (one history entry, exactly undoable).
            </p>
            <div className="rounded border border-zinc-800 px-2 py-1.5 text-[12px] text-zinc-300 space-y-0.5" data-testid="granted-execution-preview">
              <div><span className="text-teal-400">Before</span> {grant.binding.proposal.preview.before}</div>
              <div><span className="text-teal-400">After</span> {grant.binding.proposal.preview.after}</div>
              {grant.binding.proposal.preview.warnings.length > 0 && (
                <div className="text-amber-400/90">{grant.binding.proposal.preview.warnings.join(" · ")}</div>
              )}
            </div>
            <div className="rounded border border-zinc-800 px-2 py-1.5 text-[12px] text-zinc-500 space-y-0.5" data-testid="granted-execution-scope">
              <div>project {grant.binding.scope.projectId} · branch {grant.binding.scope.branchId} · base revision {base.pcbRevisionId.slice(0, 24)}… · history head #{base.headSequence}</div>
              <div>validation policy {base.validationPolicy.presetId} v{base.validationPolicy.presetVersion} · instruction “{grant.binding.instruction.excerpt.slice(0, 120)}”</div>
            </div>
            {note !== null && (
              <p className="text-amber-400/90 text-xs" data-testid="granted-execution-note">{note}</p>
            )}
            {disableReason !== null && (
              <p className="text-red-400/90 text-xs" data-testid="granted-execution-disable-reason">
                Confirmation unavailable: {disableReason}
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel — change nothing</Button>
          <Button variant="destructive" onClick={onConfirm} disabled={busy || disableReason !== null} data-testid="granted-execution-confirm">
            {busy ? "Applying…" : "Confirm and apply"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
