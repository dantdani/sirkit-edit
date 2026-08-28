"use client";

/**
 * B14 §G — the DISTINCT replacement review surface.
 *
 * Displays the sealed replacement proposal's complete reviewed identity and
 * impact plan, states plainly that NOTHING has changed yet, and offers
 * exactly two actions: `Apply exact replacement` (explicit click, disabled
 * while executing, available only through this trusted interactive channel)
 * and `Cancel`. Approval is NEVER inferred from provider text or from the
 * proposal's existence; dismissal/cancel mutates nothing.
 */

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import type { SealedReplacementProposal } from "@/app/lib/engineering/replacement-proposals";

export interface ReplacementReviewDialogProps {
  proposal: SealedReplacementProposal | null;
  busy: boolean;
  /** Display reference for the component (refDes), when known. */
  componentLabel: string | null;
  currentPartLabel: string | null;
  onApply: () => void;
  onCancel: () => void;
}

export function ReplacementReviewDialog({ proposal, busy, componentLabel, currentPartLabel, onApply, onCancel }: ReplacementReviewDialogProps) {
  return (
    <Dialog open={proposal !== null} onOpenChange={(open) => { if (!open && !busy) onCancel(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Exact component replacement — review before applying</DialogTitle>
        </DialogHeader>
        {proposal && (
          <div className="space-y-3 text-sm">
            <p className="text-zinc-400 text-xs">
              Proposed by {proposal.provenance.provider} · proposal {proposal.proposalId.slice(0, 18)}… ·
              expires {new Date(proposal.expiresAt).toLocaleTimeString()}. <span className="text-zinc-300">Nothing has been
              changed yet.</span> Applying revalidates fresh server authority and executes exactly ONE canonical
              replacement transaction.
            </p>
            <div className="rounded border border-zinc-800 px-2 py-1.5 text-[12px] text-zinc-300 space-y-1">
              <div>
                <span className="text-teal-400">Component</span> {componentLabel ?? proposal.componentInstanceId}{" "}
                <span className="text-zinc-500">(stable id {proposal.componentInstanceId.slice(0, 24)}…)</span>
              </div>
              <div>
                <span className="text-zinc-500">Current part</span> {currentPartLabel ?? proposal.expectedCurrentPartId}
              </div>
              <div>
                <span className="text-zinc-500">Proposed exact part</span>{" "}
                <span className="text-teal-300">{proposal.target.partId}</span> · {proposal.target.manufacturer}
              </div>
              <div className="text-zinc-500">
                atomic {proposal.target.atomicPartRevisionId.slice(0, 24)} · symbol {proposal.target.symbolAssetVersionId.slice(0, 24)} ·
                footprint {proposal.target.footprintAssetVersionId.slice(0, 24)}
              </div>
              <div className="text-zinc-500">
                mapping {proposal.impact.mode} · certificate {proposal.target.mappingCertificateId.slice(0, 24)} ({proposal.impact.mappingEvidence})
              </div>
            </div>
            <div className="rounded border border-zinc-800 px-2 py-1.5 text-[12px] text-zinc-300 space-y-0.5">
              <div>{proposal.impact.preservedConnections.length} connection(s) preserved · 0 dropped (a replacement never drops a connected pin)</div>
              <div>{proposal.impact.wireEndpointMoves.length} wire endpoint move(s) · {proposal.impact.netLabelMoves.length} net-label move(s)</div>
              {proposal.impact.downstream.length > 0 && (
                <div className="text-zinc-500">{proposal.impact.downstream.join(" · ")}</div>
              )}
              {proposal.impact.warnings.length > 0 && (
                <div className="text-amber-400/90">{proposal.impact.warnings.join(" · ")}</div>
              )}
              <div className="text-zinc-500">
                authority fresh as of sealing · re-verified at apply · expires {new Date(proposal.expiresAt).toLocaleTimeString()}
              </div>
            </div>
            <p className="text-red-400/90 text-xs">
              This is a destructive-tier change (identity and authority fields are replaced together). It is undoable, and
              derived outputs (ERC, BOM, physical bindings, PCB sync) will recompute.
            </p>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel — change nothing</Button>
          <Button variant="destructive" onClick={onApply} disabled={busy}>
            {busy ? "Applying…" : "Apply exact replacement"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
