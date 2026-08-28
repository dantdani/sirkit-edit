"use client";

/**
 * B15.3 §I — the DISTINCT PCB proposal review surface, mounted inside
 * `PcbEditor` (the owner of the live board and PCB history).
 *
 * Pure presentational: it holds NO authority. It displays the sealed
 * bounded PCB edit proposal's COMPLETE evidence, states plainly that
 * nothing has changed yet, that DRC/connectivity results are engineering
 * evidence — not a safety or manufacturing guarantee — and that
 * manufacturing readiness is unavailable. It offers exactly two actions:
 * `Approve and apply PCB edits` (explicit click; one atomic canonical PCB
 * transaction) and `Cancel`. Approval is disabled — with the precise reason
 * shown — whenever revalidation has not passed against the LIVE editor
 * state. It NEVER applies a safety, readiness, or manufacturability claim
 * to a proposal (a source gate scans this file for the prohibited phrases).
 */

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import type { SealedPcbEditProposal } from "@/app/lib/pcb/proposal/sealed-pcb-edit-proposal";

export interface PcbProposalReviewDialogProps {
  proposal: SealedPcbEditProposal | null;
  busy: boolean;
  /** null ⇒ approval enabled. Otherwise the PRECISE, visible reason approval
   *  is disabled (verification failure, expiry, stale revision/head/lineage,
   *  foreign scope, policy mismatch, revalidation pending, apply active). */
  disableReason: string | null;
  onApply: () => void;
  onCancel: () => void;
}

export function PcbProposalReviewDialog({ proposal, busy, disableReason, onApply, onCancel }: PcbProposalReviewDialogProps) {
  const impact = proposal?.impact ?? null;
  return (
    <Dialog open={proposal !== null} onOpenChange={(open) => { if (!open && !busy) onCancel(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bounded PCB edits — review before applying</DialogTitle>
        </DialogHeader>
        {proposal && impact && (
          <div className="space-y-3 text-sm">
            <p className="text-zinc-400 text-xs">
              Proposed by {proposal.provenance.provider} ({proposal.provenance.model}
              {proposal.provenance.runId ? ` · run ${proposal.provenance.runId.slice(0, 24)}` : ""}) ·
              proposal {proposal.proposalId.slice(0, 18)}… · expires {new Date(proposal.expiresAt).toLocaleTimeString()}.{" "}
              <span className="text-zinc-300">Nothing has been changed yet.</span> Approving revalidates everything
              against the live board and executes exactly ONE atomic canonical PCB transaction (one history entry,
              exactly undoable).
            </p>
            <div className="rounded border border-zinc-800 px-2 py-1.5 text-[12px] text-zinc-300 space-y-0.5" data-testid="pcb-proposal-scope">
              <div>
                <span className="text-teal-400">Scope</span> project {proposal.scope.projectId} · branch {proposal.scope.branchId} ·
                board {proposal.scope.boardInstanceId}
              </div>
              <div className="text-zinc-500">
                base revision {proposal.base.pcbRevisionId.slice(0, 24)}… · board digest {proposal.base.boardDigest.slice(0, 24)}…
              </div>
              <div className="text-zinc-500">
                history head #{proposal.base.historyHead.sequence}
                {proposal.base.historyHead.label ? ` (“${proposal.base.historyHead.label}”)` : ""} · lineage {proposal.base.lineageId.slice(0, 24)}…
              </div>
              <div className="text-zinc-500">
                validation policy {proposal.validationPolicy.presetId} v{proposal.validationPolicy.presetVersion} ·
                rules {proposal.validationPolicy.rulesDigest.slice(0, 20)}…
              </div>
              <div className="text-zinc-500">
                candidate {proposal.candidateDigest.slice(0, 24)}… · impact certificate {proposal.impactDigest.slice(0, 20)}…
              </div>
            </div>
            <div className="rounded border border-zinc-800 px-2 py-1.5 text-[12px] text-zinc-300 space-y-0.5" data-testid="pcb-proposal-operations">
              <div className="text-teal-400">Operations ({proposal.operations.length})</div>
              {impact.operationSummaries.map((summary, index) => (
                <div key={index} className="text-zinc-300">{index + 1}. {summary}</div>
              ))}
              <div className="text-zinc-500">
                changes {impact.changedObjectIds.join(", ") || "—"}
              </div>
              <div className="text-zinc-500">
                nets {impact.affectedNetIds.join(", ") || "—"} · layers {impact.affectedLayers.join(", ") || "—"}
              </div>
              {impact.ruleChanges.length > 0 && (
                <div className="text-zinc-400">rule changes: {impact.ruleChanges.join(" · ")}</div>
              )}
            </div>
            <div className="rounded border border-zinc-800 px-2 py-1.5 text-[12px] text-zinc-300 space-y-0.5" data-testid="pcb-proposal-evidence">
              <div>
                <span className="text-teal-400">DRC</span> errors {impact.drc.beforeErrors} → {impact.drc.afterErrors} ·
                warnings {impact.drc.beforeWarnings} → {impact.drc.afterWarnings}
              </div>
              <div className="text-zinc-500">
                new violations {impact.drc.newViolationIds.length > 0 ? impact.drc.newViolationIds.join(", ") : "none"} ·
                resolved {impact.drc.resolvedViolationIds.length > 0 ? impact.drc.resolvedViolationIds.join(", ") : "none"}
              </div>
              <div>
                <span className="text-teal-400">Connectivity</span> routed {impact.connectivity.beforeRoutedNets}/{impact.connectivity.beforeTotalNets} →{" "}
                {impact.connectivity.afterRoutedNets}/{impact.connectivity.afterTotalNets} · unrouted {impact.connectivity.beforeUnrouted} → {impact.connectivity.afterUnrouted} ·
                shorts {impact.connectivity.beforeShorts} → {impact.connectivity.afterShorts}
              </div>
              <div className="text-zinc-500">
                routing completion {impact.routingCompletion.beforePercent}% → {impact.routingCompletion.afterPercent}%
                {" "}(Δ {impact.routingCompletion.delta >= 0 ? "+" : ""}{impact.routingCompletion.delta})
              </div>
              {impact.warnings.length > 0 && (
                <div className="text-amber-400/90">{impact.warnings.join(" · ")}</div>
              )}
            </div>
            <p className="text-amber-400/90 text-xs" data-testid="pcb-proposal-limitations">
              Manufacturing readiness is unavailable for this proposal: {impact.readiness.reason} DRC and connectivity
              results above are engineering evidence only — they are NOT a guarantee of safety or manufacturability.
            </p>
            {disableReason !== null && (
              <p className="text-red-400/90 text-xs" data-testid="pcb-proposal-disable-reason">
                Approval unavailable: {disableReason}
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button variant="destructive" onClick={onApply} disabled={busy || disableReason !== null}>
            {busy ? "Applying…" : "Approve and apply PCB edits"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
