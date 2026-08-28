/**
 * B14.1 §A / B14.2 §D — the AUTHORITY-BEARING replacement-approval
 * controller (INTERNAL composition-boundary module).
 *
 * The ONE trusted interactive boundary between the review UI and the
 * approved-replacement service: `approveAndApplyReplacement` runs ONLY on an
 * explicit human Apply activation — it verifies the sealed artifact,
 * [B16.0.1 §F] reloads the LIVE membership and compares it against the
 * proposal's sealed §E authorization binding (any divergence refuses with
 * zero mutation and zero capability minted), issues the one-shot
 * `ReplacementApprovalIntent` bound to the reviewed proposal + scope +
 * lineage/head + sealed authorization identity + expiry, constructs the
 * PRODUCTION reauthorization channel (real same-origin transport, no
 * injection), invokes the approved-replacement service, and retires any
 * un-consumed intent on every path. Safe proposal-event discrimination lives
 * separately in `replacement-proposal-events.ts`.
 *
 * IMPORT BOUNDARY (B14.2 §D permanent walker): production importers are
 * restricted to THIS module and the trusted UI composition root
 * (`app/page.tsx`). API routes, the agent runtime/gateway/loop, provider
 * adapters, registries, generic engineering services, scripts, and barrels
 * are explicitly forbidden — a synthetic-injection tripwire proves the gate
 * detects violations.
 *
 * HONEST GUARANTEE: this boundary proves TRUSTED INTERACTIVE COMPOSITION
 * and explicit shipped-UI activation (the rendered dialog's click is the
 * only production path that reaches this module). It is NOT cryptographic
 * proof of a physical human — no browser API can provide that; the
 * load-bearing evidence is the rendered-dialog click integration test plus
 * this import gate.
 */

import {
  issueReplacementApprovalIntent,
  retireReplacementApprovalIntent,
} from "../engineering/replacement-approval.internal";
import {
  applyApprovedReplacementProposal,
  type ApprovedReplacementApplyInput,
  type ApprovedReplacementApplyOutcome,
} from "../engineering/approved-replacement-mutations";
import { verifySealedReplacementProposalIntegrity } from "../engineering/replacement-proposals";
import { SCHEMATIC_APPLY_ROLES } from "../engineering/proposal-authorization";
import {
  createMembershipReauthorizer,
  evaluateMembershipReauthorization,
  type MembershipReauthorization,
  type MembershipReauthorizer,
} from "./membership-reauthorization";
import { createReplacementReauthorization } from "./replacement-reauthorization";

/** [B16.0.1 §F] the apply-time membership reauthorization step is part of the
 *  controller contract. The dep is OPTIONAL ONLY because the one production
 *  caller is the trusted UI composition root (`app/page.tsx`, pinned by the
 *  B14.2 §D import gate), which must not need editing for this closure: when
 *  omitted, the controller constructs the PRODUCTION
 *  `createMembershipReauthorizer()` (real same-origin POST to the ONE narrow
 *  membership endpoint) INSIDE this trusted module — a caller can inject a
 *  fake only from test composition, never through provider/model surfaces
 *  (the import gate keeps them out of this module entirely). */
export type ReplacementApplyDeps = Omit<ApprovedReplacementApplyInput, "approval" | "reauthorization"> & {
  reauthorize?: MembershipReauthorizer;
};

/**
 * The explicit-activation apply. Nothing else may call the service: the
 * intent minted here is the only accepted approval capability, and the
 * channel constructed here is the only accepted reauthorization source.
 *
 * [B16.0.1 §F] BEFORE minting the one-shot approval intent, the controller
 * verifies the sealed artifact and reloads the LIVE membership, comparing it
 * against the proposal's sealed §E authorization binding. Seal integrity is
 * not authority to apply: a logged-out, replaced, downgraded, or revoked
 * author — or a membership whose revision moved since sealing — refuses with
 * ZERO mutation, ZERO journal entries, and ZERO capability minted.
 */
export async function approveAndApplyReplacement(deps: ReplacementApplyDeps): Promise<ApprovedReplacementApplyOutcome> {
  // The intent binds the VERIFIED proposal basis — a proposal that does not
  // verify cannot even mint an approval (mirrors the PCB §F controller).
  const verification = verifySealedReplacementProposalIntegrity(deps.proposal);
  if (!verification.ok) {
    return { ok: false, status: "refused", code: "verification-failed", message: `Replacement rejected (${verification.code}): ${verification.detail} Nothing was changed.` };
  }

  // [B16.0.1 §F] reauthorize the LIVE membership BEFORE minting the one-shot
  // apply capability. Any divergence from the sealed §E binding refuses; a
  // throwing reauthorizer fails closed the same way.
  const reauthorize = deps.reauthorize ?? createMembershipReauthorizer();
  let live: MembershipReauthorization;
  try {
    live = await reauthorize({
      scope: {
        tenantId: deps.proposal.scope.tenantId,
        projectId: deps.proposal.scope.projectId,
        branchId: deps.proposal.scope.branchId,
      },
      proposalId: deps.proposal.proposalId,
    });
  } catch {
    return { ok: false, status: "refused", code: "reauthorization-unavailable", message: "The live project membership could not be reauthorized; the replacement was not applied. Nothing was changed." };
  }
  const denial = evaluateMembershipReauthorization(deps.proposal.authorization, live, SCHEMATIC_APPLY_ROLES);
  if (denial) {
    return { ok: false, status: "refused", code: `reauthorization-${denial.code}`, message: `${denial.detail} Nothing was changed.` };
  }

  const intent = issueReplacementApprovalIntent({
    proposalId: deps.proposal.proposalId,
    scope: { tenantId: deps.tenantId ?? "local", projectId: deps.currentProjectId, branchId: deps.currentBranchId },
    headMark: deps.proposal.scope.headMark,
    // [B16.0.1 §E] the intent is bound to the sealed authorization identity —
    // derived from the verified proposal here, never caller-supplied.
    authorization: { principalId: deps.proposal.authorization.principalId, membershipRevision: deps.proposal.authorization.membershipRevision },
    now: deps.now ? deps.now() : Date.now(),
  });
  try {
    return await applyApprovedReplacementProposal({
      ...deps,
      approval: intent,
      reauthorization: createReplacementReauthorization(),
    });
  } finally {
    // Consumption burns the registration; retiring after a refusal that
    // never tendered it (e.g. capture failure) closes the window anyway.
    retireReplacementApprovalIntent(intent.intentId);
  }
}
