/**
 * B15 — the SAFE discrimination half of the PCB proposal event path
 * (the B14.2 §D split): freely importable by any UI surface because it
 * carries NO authority. It only answers "is this event a sealed bounded
 * PCB-edit proposal?" — it can neither approve, mint a capability, commit,
 * nor mutate anything.
 *
 * The authority-bearing controller lives in
 * `app/lib/project/pcb-edit-approval-controller.internal.ts` and is
 * importable ONLY by the trusted PCB composition root.
 */

import {
  PCB_EDIT_PROPOSAL_SCHEMA,
  verifySealedPcbEditProposalIntegrity,
  type SealedPcbEditProposal,
} from "../pcb/proposal/sealed-pcb-edit-proposal";

export function isSealedPcbEditProposal(candidate: unknown): candidate is SealedPcbEditProposal {
  return typeof candidate === "object" && candidate !== null
    && (candidate as { schema?: unknown }).schema === PCB_EDIT_PROPOSAL_SCHEMA;
}

/** Narrow an agent `pcb_proposal_ready` event payload without granting anything. */
export function receivePcbProposalEvent(event: { proposal?: unknown } | null | undefined): SealedPcbEditProposal | null {
  if (!event || typeof event !== "object") return null;
  return isSealedPcbEditProposal(event.proposal) ? event.proposal : null;
}

/**
 * [B15.3] the FULL event discriminator the chat stream consumer uses: the
 * event must be the DISTINCT `pcb_proposal_ready` kind AND carry a sealed
 * PCB proposal that passes complete structural verification — a fabricated
 * or malformed event yields null and grants nothing. Verification here is
 * display-gating only; the apply boundary re-verifies everything against
 * live state.
 */
export function receivePcbProposalReadyEvent(
  event: { type?: unknown; runId?: unknown; proposal?: unknown } | null | undefined,
): { proposal: SealedPcbEditProposal; runId: string | null } | null {
  if (!event || typeof event !== "object") return null;
  if (event.type !== "pcb_proposal_ready") return null;
  if (!isSealedPcbEditProposal(event.proposal)) return null;
  if (!verifySealedPcbEditProposalIntegrity(event.proposal).ok) return null;
  return {
    proposal: event.proposal,
    runId: typeof event.runId === "string" && event.runId.length > 0 && event.runId.length <= 128 ? event.runId : null,
  };
}
