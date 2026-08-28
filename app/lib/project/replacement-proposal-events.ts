/**
 * B14.2 §D — SAFE replacement proposal-event discrimination.
 *
 * Split out of the approval controller so consuming a `proposal_ready`
 * event (which mutates nothing and grants nothing) never requires importing
 * the authority-bearing apply boundary. Freely importable.
 */

import { REPLACEMENT_PROPOSAL_SCHEMA, type SealedReplacementProposal } from "../engineering/replacement-proposals";

/** Production discrimination for agent `proposal_ready` events. */
export function receiveReplacementProposalEvent(event: {
  type?: unknown;
  runId?: unknown;
  proposal?: unknown;
}): { proposal: SealedReplacementProposal; runId: string | null } | null {
  if (event.type !== "proposal_ready") return null;
  const proposal = event.proposal as SealedReplacementProposal | undefined;
  if (!proposal || proposal.schema !== REPLACEMENT_PROPOSAL_SCHEMA) return null;
  return { proposal, runId: typeof event.runId === "string" ? event.runId : null };
}
