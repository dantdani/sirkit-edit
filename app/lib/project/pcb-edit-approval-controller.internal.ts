/**
 * B15.3 §I/§J — the TRUSTED PCB approval controller (composition-boundary
 * module; the authority-bearing half of the split that
 * `pcb-proposal-events.ts` documents).
 *
 * Called ONLY from the PCB review dialog's explicit "Approve and apply PCB
 * edits" click inside `PcbEditor` — the PCB composition root, which owns the
 * live board and PCB history. An AST import gate pins the approved
 * importers to THIS module + `app/components/pcb/PcbEditor.tsx`; API
 * routes, the agent runtime, providers, and arbitrary components can never
 * reach approval authority (negative tripwires prove it).
 *
 * The flow: verify the seal here, mint the one-shot branded
 * `PcbEditApprovalIntent` bound to the EXACT verified proposal basis, run
 * the apply service, and retire the intent on EVERY path — an un-tendered
 * intent can never leak.
 */

import {
  applyApprovedPcbProposal,
  pcbProposalIdentityKey,
  type ApprovedPcbApplyInput,
  type ApprovedPcbApplyOutcome,
} from "../engineering/approved-pcb-mutations";
import {
  issuePcbEditApprovalIntent,
  retirePcbEditApprovalIntent,
} from "../engineering/pcb-edit-approval.internal";
import {
  verifySealedPcbEditProposalIntegrity,
  type SealedPcbEditProposal,
} from "../pcb/proposal/sealed-pcb-edit-proposal";
import {
  evaluatePcbApplyReauthorization,
  type PcbApplyReauthorizer,
} from "./pcb-apply-reauthorization";

/** Callers can never supply the capability — it is minted here, from the
 *  human click, and nowhere else. [B16.0.1 §F] the `reauthorize` step is
 *  REQUIRED: the live membership is reloaded before the capability is minted,
 *  so a revoked/downgraded/logged-out author can never apply a sealed
 *  proposal. */
export type PcbEditApplyDeps = Omit<ApprovedPcbApplyInput, "approval"> & {
  proposal: SealedPcbEditProposal;
  reauthorize: PcbApplyReauthorizer;
};

export async function approveAndApplyPcbEdit(deps: PcbEditApplyDeps): Promise<ApprovedPcbApplyOutcome> {
  // The intent binds the VERIFIED proposal basis — a proposal that does not
  // verify cannot even mint an approval.
  const verification = verifySealedPcbEditProposalIntegrity(deps.proposal);
  if (!verification.ok) {
    // [B16.0.1] a LEGACY v1 artifact surfaces its PRECISE refusal code —
    // membership authority is never guessed or backfilled into old artifacts.
    if (verification.code === "legacy-authorization-missing") {
      return { ok: false, status: "refused", code: "legacy-authorization-missing", message: `${verification.detail} Nothing was changed.` };
    }
    return { ok: false, status: "refused", code: "proposal-invalid", message: "The PCB proposal failed integrity verification. Nothing was changed." };
  }

  // [B16.0.1 §F] reauthorize the LIVE membership BEFORE minting the one-shot
  // apply capability. Seal integrity is not authority to apply: the author may
  // have logged out, been removed, been downgraded below an apply role, or had
  // their membership re-granted at a new revision since sealing. The live
  // snapshot is compared against the proposal's sealed §E authorization
  // binding; any divergence refuses with ZERO mutation, ZERO capability minted.
  let live;
  try {
    live = await deps.reauthorize({
      scope: {
        tenantId: deps.proposal.scope.tenantId,
        projectId: deps.proposal.scope.projectId,
        branchId: deps.proposal.scope.branchId,
      },
      proposalId: deps.proposal.proposalId,
    });
  } catch {
    return { ok: false, status: "refused", code: "reauthorization-unavailable", message: "The live membership could not be reauthorized; nothing was changed." };
  }
  const denial = evaluatePcbApplyReauthorization(deps.proposal, live);
  if (denial) {
    return { ok: false, status: "refused", code: `reauthorization-${denial.code}`, message: `${denial.detail} Nothing was changed.` };
  }

  const now = deps.now ?? (() => Date.now());
  const intent = issuePcbEditApprovalIntent({
    proposalBodyDigest: pcbProposalIdentityKey(deps.proposal),
    proposalId: deps.proposal.proposalId,
    scope: { ...deps.proposal.scope },
    canonicalResource: { ...deps.proposal.base.canonicalResource },
    basePcbRevisionId: deps.proposal.base.pcbRevisionId,
    baseBoardDigest: deps.proposal.base.boardDigest,
    baseHeadSequence: deps.proposal.base.historyHead.sequence,
    lineageId: deps.proposal.base.lineageId,
    validationPolicy: {
      presetId: deps.proposal.validationPolicy.presetId,
      presetVersion: deps.proposal.validationPolicy.presetVersion,
      rulesDigest: deps.proposal.validationPolicy.rulesDigest,
    },
    // [B16.0.1 §E] bind the sealed authorization identity into the one-shot
    // intent — the apply's consumption re-compares it against the proposal.
    authorization: {
      principalId: deps.proposal.authorizationBinding.principalId,
      membershipRevision: deps.proposal.authorizationBinding.membershipRevision,
    },
    approvalActionId: "pcb-review-dialog:approve-and-apply",
    now: now(),
  });
  try {
    return await applyApprovedPcbProposal({ ...deps, approval: intent });
  } finally {
    // Retire on EVERY path — consumption already burned it on tender; this
    // covers the paths that refuse before tender.
    retirePcbEditApprovalIntent(intent.intentId);
  }
}
