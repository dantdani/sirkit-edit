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
 *
 * [B18-D I5] Two blocks, never mixed (chat-execution-ux.md §2, R1-3 and R1-4):
 *  - "what changes" shows ONLY digest-covered content — the tier, the family, the preview, the targets and the exact
 *    operations (references come from the live board passed for display);
 *  - "As issued by the server" shows the rest — why a confirmation is required, what you asked (the recorded excerpt),
 *    the scope and base, the minter's note — which a forged-but-coherent grant could word differently and which
 *    therefore never describes the change itself.
 * The card stays inert: no inputs; Confirm and Cancel take no arguments.
 */

import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import type { PublicExecutionGrant } from "@/app/lib/engineering/execution-grant";
import type { PcbBoard } from "@/app/lib/pcb/types";
import { confirmationReason, operationLines, targetLines, tierLabel } from "@/app/lib/project/execution-display";

export interface GrantedExecutionDialogProps {
  grant: PublicExecutionGrant | null;
  /** The minter's note (for example the retry guard's explanation), if any. */
  note: string | null;
  busy: boolean;
  /** null ⇒ confirmation enabled; otherwise the PRECISE, visible reason it is disabled. */
  disableReason: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  /** [B18-D I5] the live board, for display only: the targets' and operations' reference designators. */
  board?: PcbBoard | null;
}

export function GrantedExecutionDialog({ grant, note, busy, disableReason, onConfirm, onCancel, board }: GrantedExecutionDialogProps) {
  const disableReasonId = useId(); // [B18-D review] the disabled Confirm is described by its reason
  const base = grant?.binding.base.pcb ?? null;
  const refOf = (objectId: string): string | null => board?.footprints.find((footprint) => footprint.id === objectId)?.ref ?? null;
  const targets = grant ? targetLines(grant, refOf) : null;
  const operations = grant ? operationLines(grant, refOf) : [];
  const tier = tierLabel(grant?.binding.operation?.tier ?? 1);
  return (
    <Dialog open={grant !== null} onOpenChange={(open) => { if (!open && !busy) onCancel(); }}>
      <DialogContent className="max-w-xl" finalFocus={promptFocus}>{/* [B24-D4, 2026-10-10] D24-32 (2.4.3): when the card closes, focus returns to the prompt (promptFocus, below) */}
        <DialogHeader>
          <DialogTitle>AI change — confirm before it is made</DialogTitle>
        </DialogHeader>
        {grant && base && (
          <div className="space-y-3 text-sm" data-testid="granted-execution-card">
            <p className="text-zinc-400 text-xs">
              The assistant asks to make exactly this change ({grant.binding.operation.family}, {grant.binding.proposal.replay
                ? `${grant.binding.proposal.replay.direction} of the assistant's latest change`
                : `${grant.binding.proposal.operationCount} operation${grant.binding.proposal.operationCount === 1 ? "" : "s"}`}) · grant {grant.grantId.slice(0, 14)}… · expires {new Date(grant.binding.expiresAt).toLocaleTimeString()}.{" "}
              <span className="text-zinc-300">Nothing has been changed yet.</span> Confirming revalidates everything against the live board and
              executes exactly ONE canonical PCB transaction (one history entry, exactly undoable).
            </p>
            <div className="rounded border border-zinc-700 px-2 py-1.5 space-y-1.5" data-testid="granted-execution-change">
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
                <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-200" data-testid="granted-execution-tier" title={tier?.title}>{tier?.short ?? "Tier 1 · reversible edit"}</span>
                <span className="font-mono">{grant.binding.operation.family}</span>
              </div>
              <div className="text-[12px] text-zinc-300 space-y-0.5" data-testid="granted-execution-preview">
                <div><span className="text-teal-400">Before</span> {grant.binding.proposal.preview.before}</div>
                <div><span className="text-teal-400">After</span> {grant.binding.proposal.preview.after}</div>
                {grant.binding.proposal.preview.warnings.length > 0 && (
                  <div className="text-amber-400/90">{grant.binding.proposal.preview.warnings.join(" · ")}</div>
                )}
              </div>
              <div className="text-[12px] text-zinc-300" data-testid="granted-execution-targets">
                <span className="text-teal-400">Targets</span> {targets ? `${targets.objects.join(", ")} · ${targets.nets}` : "(not displayable)"}
              </div>
              <div className="text-[12px] text-zinc-300">
                <span className="text-teal-400">Operations ({operations.length})</span>
                <ol className="list-decimal pl-5" data-testid="granted-execution-operations">
                  {operations.map((line, index) => <li key={index}>{line}</li>)}
                </ol>
              </div>
            </div>
            <div className="rounded border border-zinc-800 px-2 py-1.5 text-[12px] text-zinc-500 space-y-0.5" data-testid="granted-execution-context">
              <div className="text-[10px] uppercase tracking-wide text-zinc-600">As issued by the server</div>
              <div className="text-zinc-400" data-testid="granted-execution-reason">{confirmationReason(grant, note)}</div>
              <div>You asked (as recorded): “{grant.binding.instruction.excerpt.slice(0, 120)}”</div>
              <div data-testid="granted-execution-scope">project {grant.binding.scope.projectId} · branch {grant.binding.scope.branchId} · base revision {base.pcbRevisionId.slice(0, 24)}… · history head #{base.headSequence} · validation policy {base.validationPolicy.presetId} v{base.validationPolicy.presetVersion}</div>
              {note !== null && (
                <p className="text-amber-400/90 text-xs" data-testid="granted-execution-note">{note}</p>
              )}
            </div>
            {disableReason !== null && (
              <p id={disableReasonId} className="text-red-400/90 text-xs" data-testid="granted-execution-disable-reason">
                Confirmation unavailable: {disableReason}
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onCancel()} disabled={busy}>Cancel — change nothing</Button>
          <Button variant="destructive" onClick={() => onConfirm()} disabled={busy || disableReason !== null} aria-describedby={disableReason !== null ? disableReasonId : undefined} data-testid="granted-execution-confirm">
            {busy ? "Applying…" : "Confirm and apply"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * [B24-D4, 2026-10-10] D24-32 (2.4.3), CI run 38061798204 (keyboard-and-focus 4): the card opens from a chat run sent from the prompt, which
 * is disabled while the run streams, so focus is on `body` then and Base UI's default return target is what an earlier popup recorded (on CI
 * nothing: focus stayed on `body`; locally the header's first button). On close (Escape, Cancel, Confirm) focus goes to the prompt; [B24-D4
 * review, 2026-10-10] correctness-1: a prompt still disabled cannot take it, so no focus moves (`false`): `body`, where page.tsx's run-end return acts.
 */
function promptFocus(): HTMLElement | false {
  const prompt = typeof document === "undefined" ? null : document.querySelector<HTMLTextAreaElement>('[data-testid="prompt-input"]');
  return prompt && !prompt.disabled ? prompt : false;
}
