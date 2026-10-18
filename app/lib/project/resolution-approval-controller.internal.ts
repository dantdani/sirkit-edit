/**
 * [PR-M, 2026-10-18] Runbook section M.2.5: the AUTHORITY-BEARING component-resolution approval controller (INTERNAL composition
 * boundary module) - the sibling of the B14 replacement approval controller in this directory (its path is not spelled here, so the
 * B14.2 section D source-text gate stays exact), with the same ritual and its own import boundary.
 *
 * The ONE trusted interactive boundary between the page's resolution review dialog and the approved-resolution service:
 * `approveAndApplyResolution` runs ONLY on the human's explicit Approve on the rendered dialog. It
 *
 *  1. verifies the sealed batch (schema, closed key set, every sealed digest) - a batch that does not verify mints nothing;
 *  2. reloads the LIVE project membership through the ONE narrow reauthorization endpoint and compares it with the batch's sealed
 *     authorization binding (principal, scope, role, membership revision) - any divergence refuses with zero mutation and zero
 *     capability minted;
 *  3. issues the one-shot `ResolutionApprovalIntent` bound to the reviewed proposal, scope, head mark and authorization identity;
 *  4. constructs the PRODUCTION fresh-facts channel (`createResolutionReauthorization`: the same-origin POST to
 *     /api/component-resolution-authority, behind the shared authorization boundary - so membership is proved AGAIN at commit time);
 *  5. invokes `applyApprovedResolutionProposal`, which verifies the live base and head, re-reads the candidate authority, recompiles
 *     the whole batch, byte-matches it against the reviewed one, commits ONE canonical `schematic.resolve-components` transaction and
 *     returns the real receipt; and retires any un-consumed intent on every path.
 *
 * IMPORT BOUNDARY (permanent AST gate, app/lib/component-resolution/__tests__/m1-boundaries.test.ts): production importers are this
 * module's one caller, the trusted UI composition root (`app/page.tsx`). API routes, the agent runtime / gateway / loop, provider
 * adapters, registries and generic engineering services never reach it.
 *
 * HONEST GUARANTEE: this proves TRUSTED INTERACTIVE COMPOSITION and an explicit shipped-UI activation (the rendered dialog's click is
 * the only production path here), not a physical human - no browser API can prove that.
 */
import { applyApprovedResolutionProposal, type ApprovedResolutionApplyInput, type ApprovedResolutionApplyOutcome } from "../component-resolution/approved-resolution-mutations";
import { issueResolutionApprovalIntent, retireResolutionApprovalIntent } from "../component-resolution/resolution-approval.internal";
import { verifySealedResolutionProposalIntegrity } from "../component-resolution/resolution-proposal";
import { createResolutionReauthorization } from "../component-resolution/resolution-reauthorization";
import { SCHEMATIC_APPLY_ROLES } from "../engineering/proposal-authorization";
import { createMembershipReauthorizer, evaluateMembershipReauthorization, type MembershipReauthorization, type MembershipReauthorizer } from "./membership-reauthorization";

/** The apply's dependencies. `reauthorize` is optional ONLY because the one production caller is the page, which uses the production
 *  reauthorizer constructed here; tests inject a fake from test composition, never through a provider or model surface. */
export type ResolutionApplyDeps = Omit<ApprovedResolutionApplyInput, "approval" | "reauthorization"> & {
  reauthorize?: MembershipReauthorizer;
};

/** The explicit-activation apply: the intent minted here is the only accepted approval, the channel built here the only fresh facts. */
export async function approveAndApplyResolution(deps: ResolutionApplyDeps): Promise<ApprovedResolutionApplyOutcome> {
  let verification: ReturnType<typeof verifySealedResolutionProposalIntegrity>;
  try {
    verification = verifySealedResolutionProposalIntegrity(deps.proposal);
  } catch {
    verification = { ok: false, code: "malformed", detail: "The resolution proposal is structurally invalid." } as ReturnType<typeof verifySealedResolutionProposalIntegrity>;
  }
  if (!verification.ok) {
    return { ok: false, status: "refused", code: "verification-failed", message: `Component resolution rejected: ${verification.detail} Nothing was changed.` };
  }
  const reauthorize = deps.reauthorize ?? createMembershipReauthorizer();
  let live: MembershipReauthorization;
  try {
    live = await reauthorize({ scope: { tenantId: deps.proposal.scope.tenantId, projectId: deps.proposal.scope.projectId, branchId: deps.proposal.scope.branchId }, proposalId: deps.proposal.proposalId });
  } catch {
    return { ok: false, status: "refused", code: "reauthorization-unavailable", message: "The live project membership could not be reauthorized; the component resolution was not applied. Nothing was changed." };
  }
  const denial = evaluateMembershipReauthorization(deps.proposal.authorization, live, SCHEMATIC_APPLY_ROLES);
  if (denial) return { ok: false, status: "refused", code: `reauthorization-${denial.code}`, message: `${denial.detail} Nothing was changed.` };

  const intent = issueResolutionApprovalIntent({
    proposalId: deps.proposal.proposalId,
    scope: { tenantId: deps.tenantId ?? "local", projectId: deps.currentProjectId, branchId: deps.currentBranchId },
    headMark: deps.proposal.scope.headMark,
    authorization: { principalId: deps.proposal.authorization.principalId, membershipRevision: deps.proposal.authorization.membershipRevision },
    now: deps.now ? deps.now() : Date.now(),
  });
  try {
    return await applyApprovedResolutionProposal({ ...deps, approval: intent, reauthorization: createResolutionReauthorization() });
  } finally {
    retireResolutionApprovalIntent(intent.intentId);
  }
}
