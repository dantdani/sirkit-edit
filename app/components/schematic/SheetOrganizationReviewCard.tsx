"use client";

/**
 * [PR-J5, 2026-10-23] Runbook J.3 item 4 and J.6 items 4-6 (OD-259 items 4 and 5): the review surface of ONE sealed sheet-organisation
 * proposal (the agent's `sirkit.schematic.propose-sheet-organization`, received by app/lib/project/sheet-organization-events.ts).
 *
 * It shows the sheets the organisation creates with their members, the interfaces (the crossing nets and the ports that carry them),
 * the parts that stay on the source sheet, "check these" (parts the connectivity grouping would place elsewhere), the board names that
 * change, the equivalence facts - and states plainly that NOTHING has changed yet. Exactly two actions: `Approve` (one explicit click;
 * the page's Sheets controller re-plans the sealed groups on the canonical base inside the serialized queue and applies ONE
 * schematic.move-to-sheet transaction only when the digests agree; disabled, with its visible reason, while the proposal is stale,
 * expired, foreign or already applied) and `Discard`, which changes and records nothing. Closing the card is a discard. Controls are
 * named for a person; data-testids are the J5 plan's (sheet-organization-review / -approve / -discard).
 */

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { SheetOrganizationReview } from "@/app/lib/project/sheet-organization-events";

export interface SheetOrganizationReviewCardProps {
  review: SheetOrganizationReview | null;
  busy: boolean;
  onApprove: () => void;
  onDiscard: () => void;
}

export function SheetOrganizationReviewCard({ review, busy, onApprove, onDiscard }: SheetOrganizationReviewCardProps) {
  const blocked = review?.approveBlockedReason ?? null;
  const parts = review?.groups.reduce((sum, group) => sum + group.members.length, 0) ?? 0;
  return (
    <Dialog open={review !== null} onOpenChange={(open) => { if (!open && !busy) onDiscard(); }}>
      <DialogContent className="sm:max-w-2xl" data-testid="sheet-organization-review">
        <DialogHeader>
          <DialogTitle>Organize {parts} part{parts === 1 ? "" : "s"} into {review?.groups.length ?? 0} sheet{review?.groups.length === 1 ? "" : "s"} — review before applying</DialogTitle>
        </DialogHeader>
        {review && (
          <div className="max-h-[60vh] space-y-3 overflow-y-auto text-sm">
            <p className="text-xs text-muted-foreground">
              Proposed by the assistant · proposal {review.proposalId.slice(0, 18)}… · expires {new Date(review.expiresAt).toLocaleTimeString()}.{" "}
              <span className="font-medium text-foreground">Nothing has been changed yet.</span> Approving re-plans these groups on the live schematic and applies
              them as ONE undoable transaction (the same Organize into sheets the Sheets navigator offers); every connection and every part identity stays as it is.
            </p>
            {review.rationale.length > 0 && <p className="text-xs text-muted-foreground" data-testid="sheet-organization-rationale">{review.rationale}</p>}
            <table className="w-full text-left text-[12px]" data-testid="sheet-organization-groups">
              <thead><tr className="text-muted-foreground"><th className="pr-2 font-medium">New sheet</th><th className="font-medium">Parts</th></tr></thead>
              <tbody>
                {review.groups.map((group) => (
                  <tr key={group.sheetId} data-testid="sheet-organization-group" data-name={group.name} data-refs={group.members.join(" ")} className="align-top">
                    <td className="pr-2 font-medium">{group.name}</td>
                    <td className="font-mono">{group.members.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <section aria-label="Interfaces between the sheets" data-testid="sheet-organization-interfaces" className="rounded border border-border px-2 py-1.5 text-[12px] text-foreground">
              <div className="font-medium">Interfaces ({review.interfaces.length})</div>
              {review.interfaces.length === 0 ? <div className="text-muted-foreground">No signal crosses a sheet boundary; power and ground stay project rails.</div> : (
                <ul className="list-disc pl-4">
                  {review.interfaces.map((entry) => <li key={`${entry.childSheetName}:${entry.portName}`} data-testid="sheet-organization-interface" data-port={entry.portName}>{entry.line}</li>)}
                </ul>
              )}
            </section>
            {review.unassigned.length > 0 && (
              <div className="text-[12px] text-muted-foreground" data-testid="sheet-organization-unassigned">Stays on the {review.sourceSheetName}: {review.unassigned.join(", ")}</div>
            )}
            {(review.checkThese.length > 0 || review.checkNote) && (
              <section aria-label="Check these placements" data-testid="sheet-organization-check" className="rounded border border-amber-800/60 px-2 py-1.5 text-[12px] text-amber-700">
                <div className="font-medium">Check these</div>
                {review.checkNote && <div>{review.checkNote}</div>}
                <ul className="list-disc pl-4">
                  {review.checkThese.map((check) => <li key={check.refs.join(",")} data-testid="sheet-organization-check-item" data-refs={check.refs.join(" ")}>{check.reason}</li>)}
                </ul>
              </section>
            )}
            {review.renamedNets.length > 0 && (
              <div className="text-[12px] text-amber-700" data-testid="sheet-organization-renamed">Board names change (connections do not): {review.renamedNets.join(", ")}</div>
            )}
            <div className="rounded border border-border px-2 py-1.5 text-[12px] text-muted-foreground" data-testid="sheet-organization-equivalence">
              Equivalence proven at proposal time: {review.equivalence.componentCount} components keep their identities; the pin-to-net partition {review.equivalence.partitionDigest.slice(0, 16)}… is unchanged; {review.equivalence.operationCount} operations in one transaction. Approve proves it again on the live schematic.
            </div>
          </div>
        )}
        <DialogFooter>
          {blocked && !busy && <p className="mr-auto self-center text-[11px] text-amber-700" data-testid="sheet-organization-approve-reason">{blocked}</p>}
          <Button variant="ghost" onClick={onDiscard} disabled={busy} data-testid="sheet-organization-discard">Discard — change nothing</Button>
          <Button onClick={onApprove} disabled={busy || blocked !== null} data-testid="sheet-organization-approve">{busy ? "Applying…" : `Approve — organize into ${review?.groups.length ?? 0} sheet${review?.groups.length === 1 ? "" : "s"}`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
