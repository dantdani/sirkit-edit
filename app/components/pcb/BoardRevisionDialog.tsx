"use client";

/**
 * [B16-C.1] The rework plan a human reviews before a NEW board revision is
 * derived from a routed board.
 *
 * The plan is the server's (`preview_board_revision`): what is kept, added,
 * removed or changed per component; per net whether copper is retained (with
 * the semantic-equivalence proof) or stripped (with the reason); the explicit
 * carry-forward choices; the structural sync the derivation will apply; and
 * the facts that the old board stays immutable and that placement, routing,
 * DRC and qualification must run again before any release. Deriving requires
 * an explicit acknowledgement and sends the reviewed plan's digests back, so
 * the server refuses anything that drifted.
 */

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { BoardRevisionCarry } from "@/app/lib/pcb-sync/board-revision";
import type { PcbSyncBoardRevisionPreviewResult } from "@/app/lib/pcb-sync/types";

const OUTCOME_LABEL: Record<string, string> = {
  kept: "kept", added: "added", removed: "removed", footprint_changed: "footprint changed → re-added", pin_map_changed: "pin map changed → re-added", symbol_changed: "symbol changed → re-added", placement_reset: "placement reset → re-placed",
  copper_retained: "copper retained", copper_stripped: "copper stripped", unrouted: "unrouted", // nets
};
const OUTCOME_CLASS: Record<string, string> = {
  kept: "text-emerald-200", copper_retained: "text-emerald-200", added: "text-sky-200", removed: "text-red-200", copper_stripped: "text-amber-200", unrouted: "text-zinc-300",
  footprint_changed: "text-amber-200", pin_map_changed: "text-amber-200", symbol_changed: "text-amber-200", placement_reset: "text-amber-200",
};

export interface BoardRevisionDialogProps {
  open: boolean;
  preview: PcbSyncBoardRevisionPreviewResult | null;
  carry: BoardRevisionCarry;
  busy: boolean;
  error: string | null;
  onCarryChange(carry: BoardRevisionCarry): void;
  onDerive(): void;
  onDismiss(): void;
}

export function BoardRevisionDialog({ open, preview, carry, busy, error, onCarryChange, onDerive, onDismiss }: BoardRevisionDialogProps) {
  const [acknowledged, setAcknowledged] = useState<string | null>(null);
  const plan = preview?.revisionPlan ?? null;
  const reviewed = plan !== null && acknowledged === plan.planDigest;
  const canDerive = Boolean(preview && preview.status === "ready_to_derive" && reviewed && !busy);
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onDismiss(); }}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto" data-testid="board-revision-dialog">
        <DialogHeader>
          <DialogTitle>Derive a new board revision</DialogTitle>
          <DialogDescription>
            Protected copper blocks a structural change. A new revision keeps only the copper whose nets are proven unchanged, strips the rest, applies the schematic changes, and must be placed, routed, checked and qualified again before any release. The current board, its qualification and its releases stay immutable.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 text-xs text-zinc-200">
          <fieldset className="grid gap-1 rounded border border-zinc-800 p-2" data-testid="board-revision-carry">
            <legend className="px-1 text-[11px] text-zinc-400">Carry forward (each an explicit decision)</legend>
            {(["copper", "placement", "constraints"] as const).map((key) => (
              <label key={key} className="flex items-center gap-2">
                <input type="checkbox" checked={carry[key]} disabled={busy} onChange={(event) => onCarryChange({ ...carry, [key]: event.target.checked })} data-testid={`board-revision-carry-${key}`} />
                <span className="capitalize">{key}</span>
                <span className="text-zinc-500">{key === "copper" ? "tracks, vias and zones of nets that pass the equivalence proof (needs placement)" : key === "placement" ? "footprint positions of components that are unchanged" : "constraint program, net classes and routing keepouts"}</span>
              </label>
            ))}
          </fieldset>
          {!preview && !error && <div className="text-zinc-400" data-testid="board-revision-loading">Computing the rework plan…</div>}
          {error && <div className="rounded border border-red-900 bg-red-950/30 p-2 text-red-200" role="alert" data-testid="board-revision-error">{error}</div>}
          {plan && preview && (
            <>
              <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 rounded border border-zinc-800 p-2 text-[11px]" data-testid="board-revision-summary">
                <span className="text-zinc-400">Parent</span><span>{plan.parent.boardId} · {plan.parent.boardClass} · {plan.parent.revision.slice(0, 18)}…</span>
                <span className="text-zinc-400">Derived id</span><span data-testid="board-revision-derived-id">{plan.derivedBoardId} (generation {plan.generation})</span>
                <span className="text-zinc-400">Components</span><span>{plan.summary.componentsKept} kept · {plan.summary.componentsAdded} added · {plan.summary.componentsRemoved} removed · {plan.summary.componentsChanged} changed</span>
                <span className="text-zinc-400">Nets</span><span>{plan.summary.netsRetained} copper retained · {plan.summary.netsStripped} stripped · {plan.summary.netsUnrouted} unrouted · {plan.summary.netsAdded} added · {plan.summary.netsRemoved} removed</span>
                <span className="text-zinc-400">Copper</span><span>{plan.summary.tracksRetained}/{plan.summary.tracksRetained + plan.summary.tracksStripped} tracks · {plan.summary.viasRetained}/{plan.summary.viasRetained + plan.summary.viasStripped} vias · {plan.summary.zonesRetained}/{plan.summary.zonesRetained + plan.summary.zonesStripped} zones retained</span>
                <span className="text-zinc-400">Outline / constraints</span><span>{plan.outline.changed ? "outline replaced" : "outline carried"} · constraints {plan.constraints.carried ? "carried" : "not carried"}</span>
                <span className="text-zinc-400">After derivation</span><span data-testid="board-revision-status">{preview.status === "ready_to_derive" ? `ready — the schematic sync applies ${preview.derivedPreflight.operations.length} operation${preview.derivedPreflight.operations.length === 1 ? "" : "s"} on the new revision; placement, routing, DRC and qualification run again` : `blocked — ${preview.derivedPreflight.blockers.map((item) => item.code).join(", ") || preview.derivedPreflight.status}`}</span>
              </div>
              <div className="grid gap-1">
                <div className="text-[11px] font-medium text-zinc-100">Components</div>
                <table className="w-full border-collapse text-[11px]" data-testid="board-revision-components">
                  <tbody>
                    {plan.components.map((item) => (
                      <tr key={item.componentInstanceId} className="border-t border-zinc-800/60" data-testid={`board-revision-component-${item.referenceDesignator}`} data-outcome={item.outcome}>
                        <td className="w-12 py-0.5 font-mono">{item.referenceDesignator}</td>
                        <td className={`w-40 py-0.5 ${OUTCOME_CLASS[item.outcome] ?? ""}`}>{OUTCOME_LABEL[item.outcome] ?? item.outcome}</td>
                        <td className="py-0.5 text-zinc-400">{item.reasons.join("; ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="grid gap-1">
                <div className="text-[11px] font-medium text-zinc-100">Nets (copper is retained only with a passing equivalence proof)</div>
                <table className="w-full border-collapse text-[11px]" data-testid="board-revision-nets">
                  <tbody>
                    {plan.nets.map((item) => (
                      <tr key={item.stableNetId} className="border-t border-zinc-800/60" data-testid={`board-revision-net-${item.displayName}`} data-outcome={item.outcome}>
                        <td className="w-28 py-0.5 font-mono">{item.displayName}</td>
                        <td className={`w-32 py-0.5 ${OUTCOME_CLASS[item.outcome] ?? ""}`}>{OUTCOME_LABEL[item.outcome] ?? item.outcome}</td>
                        <td className="w-24 py-0.5 text-zinc-400">{item.copper.tracks}t · {item.copper.vias}v · {item.copper.zones}z</td>
                        <td className="py-0.5 text-zinc-400">{item.proof.equivalent ? "endpoints identical" : `${item.proof.parentEndpoints.length} → ${item.proof.nextEndpoints.length} endpoints`} — {item.proof.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <label className="flex items-start gap-2 rounded border border-amber-900/60 bg-amber-950/20 p-2 text-[11px] text-amber-100">
                <input type="checkbox" checked={reviewed} disabled={busy} onChange={(event) => setAcknowledged(event.target.checked ? plan.planDigest : null)} className="mt-0.5" data-testid="board-revision-acknowledge" />
                I reviewed this rework plan ({plan.planDigest.slice(0, 16)}…). Derive revision {plan.generation}: the current board and its releases stay as history; the new revision must be qualified again before any release.
              </label>
            </>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" size="sm" onClick={onDismiss} disabled={busy} data-testid="board-revision-dismiss">Cancel</Button>
          <Button size="sm" onClick={onDerive} disabled={!canDerive} data-testid="board-revision-derive">{busy ? "Deriving…" : "Derive new revision"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
