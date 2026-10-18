"use client";

/**
 * [PR-M, 2026-10-18] Runbook section M.2.5: the review surface of ONE sealed component-resolution batch (the agent's
 * `sirkit.schematic.propose-component-resolution`, received by app/lib/project/component-resolution-events.ts).
 *
 * Per target instance it shows the old and the new identity (reference and stable id, the current catalog part and why it is
 * unresolved, the exact candidate revision with its manufacturer part number and package / footprint), the proved pin mapping, the
 * polarity on each terminal, the material warnings and what stays unchanged - and states plainly that NOTHING has changed yet. Exactly
 * two actions: `Approve batch` (one explicit click for the whole batch; disabled while applying; the page's trusted controller then
 * reauthorizes the live membership, re-reads fresh server facts, recompiles the batch and commits ONE canonical transaction) and
 * `Discard`, which changes and records nothing. Approval is never inferred from model text or from the batch's existence; closing
 * the dialog is a discard.
 */

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ComponentResolutionReview, ResolutionReceiptView } from "@/app/lib/project/component-resolution-events";

export interface ComponentResolutionReviewDialogProps {
  review: ComponentResolutionReview | null;
  busy: boolean;
  onApprove: () => void;
  onDiscard: () => void;
}

export function ComponentResolutionReviewDialog({ review, busy, onApprove, onDiscard }: ComponentResolutionReviewDialogProps) {
  return (
    <Dialog open={review !== null} onOpenChange={(open) => { if (!open && !busy) onDiscard(); }}>
      <DialogContent className="sm:max-w-2xl" data-testid="component-resolution-review">
        <DialogHeader>
          <DialogTitle>Resolve {review?.items.length ?? 0} unresolved part{review?.items.length === 1 ? "" : "s"} — review before applying</DialogTitle>
        </DialogHeader>
        {review && (
          <div className="max-h-[60vh] space-y-3 overflow-y-auto text-sm">
            <p className="text-xs text-muted-foreground">
              One batch · proposal {review.proposalId.slice(0, 18)}… · expires {new Date(review.expiresAt).toLocaleTimeString()}.{" "}
              <span className="font-medium text-foreground">Nothing has been changed yet.</span> Approving re-checks your membership, the live schematic and
              fresh library facts, then applies every row below as ONE canonical transaction you can undo.
            </p>
            {review.items.map((item) => (
              <section key={item.componentInstanceId} aria-label={`Resolution of ${item.refDes}`} data-testid={`component-resolution-row-${item.refDes}`} data-mode={item.mode} data-revision={item.revision.atomicPartRevisionId} className="space-y-1 rounded border border-border px-2 py-1.5 text-[12px] text-foreground">
                <div><span className="font-mono font-semibold">{item.refDes}</span> <span className="text-muted-foreground">({item.value || "no value"} · stable id {item.componentInstanceId.slice(0, 24)})</span></div>
                <div><span className="text-muted-foreground">Now</span> {item.from}</div>
                <div data-testid={`component-resolution-target-${item.refDes}`}><span className="text-muted-foreground">Becomes</span> <span className="font-semibold">{item.revision.exactMpn}</span>{item.revision.manufacturer ? ` · ${item.revision.manufacturer}` : ""} · exact revision {item.revision.atomicPartRevisionId.slice(0, 24)} · package / footprint {item.revision.footprint}</div>
                <div data-testid={`component-resolution-mapping-${item.refDes}`}><span className="text-muted-foreground">Pin mapping{item.permutation ? " (a proved permutation)" : ""}</span> {item.mapping.join(" · ")}</div>
                {item.polarity.length > 0 && <div data-testid={`component-resolution-polarity-${item.refDes}`}><span className="text-muted-foreground">Polarity</span> {item.polarity.join(" · ")}</div>}
                <div><span className="text-muted-foreground">Stays unchanged</span> {item.unchanged.join(" · ")}</div>
                {item.warnings.length > 0 && <div className="text-amber-700" data-testid={`component-resolution-warnings-${item.refDes}`}>{item.warnings.join(" · ")}</div>}
                <div className="text-muted-foreground">{item.established}</div>
              </section>
            ))}
            <div className="rounded border border-border px-2 py-1.5 text-[12px] text-muted-foreground">
              {review.unaffectedComponents} other component(s) are not touched.{review.downstream.length > 0 ? ` ${review.downstream.join(" · ")}` : ""}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onDiscard} disabled={busy} data-testid="component-resolution-discard">Discard — change nothing</Button>
          <Button variant="destructive" onClick={onApprove} disabled={busy} data-testid="component-resolution-approve">{busy ? "Applying…" : "Approve batch"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The receipt the page shows after a committed batch (from the real receipt only; dismissing it changes nothing). */
export function ComponentResolutionReceiptNotice({ receipt, onDismiss }: { receipt: ResolutionReceiptView; onDismiss: () => void }) {
  return (
    <div role="status" data-testid="component-resolution-receipt" data-transaction={receipt.transactionId} data-head-sequence={receipt.headAfter.headSequence} className="fixed bottom-28 right-4 z-50 max-w-xs rounded border border-teal-800/60 bg-zinc-900/95 px-3 py-2 text-[11px] text-teal-300 shadow-sm">
      <div className="font-medium text-teal-200">Component resolution applied &amp; verified</div>
      <div className="mt-0.5 text-zinc-400">
        {receipt.items.map((item) => item.refDes).join(", ")} → {[...new Set(receipt.items.map((item) => item.target.exactMpn))].join(", ")} · transaction {receipt.transactionId.slice(0, 12)}… · schematic revision {receipt.headAfter.headSequence} · undoable
      </div>
      <button type="button" className="mt-1 text-zinc-500 hover:text-zinc-300" onClick={onDismiss} aria-label="Dismiss the component resolution receipt">Dismiss</button>
    </div>
  );
}
