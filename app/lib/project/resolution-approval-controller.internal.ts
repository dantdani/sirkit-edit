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
import { createMembershipReauthorizer, evaluateMembershipReauthorization, type MembershipReauthorization, type MembershipReauthorizer } from "./membership-reauthorization"; import { assessResolutionBoardImpact, resolutionBoardImpactItems, resolutionBoardImpactSummary, type ResolutionBoardBasis, type ResolutionBoardImpactState } from "../component-resolution/board-impact"; // [PR-L6, 2026-10-19] M.4 / M.5-7

/** The apply's dependencies. `reauthorize` is optional ONLY because the one production caller is the page, which uses the production
 *  reauthorizer constructed here; tests inject a fake from test composition, never through a provider or model surface. */
export type ResolutionApplyDeps = Omit<ApprovedResolutionApplyInput, "approval" | "reauthorization" | "boardImpact"> & {
  reauthorize?: MembershipReauthorizer; /** [PR-L6, 2026-10-19] REQUIRED: the board impact the human reviewed in the dialog, and the re-read of its durable basis at Approve (OD-253 item 8) */ boardImpact: ResolutionBoardImpactState; readBoardBasis: () => Promise<ResolutionBoardBasis>;
};

/** [PR-L6, 2026-10-19] the controller's own refusals before any intent: the reviewed PCB impact moved, or it was never assessed / cannot be re-read. */
export type ResolutionBoardImpactRefusalCode = "board-impact-changed" | "board-impact-unavailable";
export type ResolutionApplyOutcome = ApprovedResolutionApplyOutcome | { ok: false; status: "refused"; code: ResolutionBoardImpactRefusalCode; message: string };

/** The explicit-activation apply: the intent minted here is the only accepted approval, the channel built here the only fresh facts. */
export async function approveAndApplyResolution(deps: ResolutionApplyDeps): Promise<ResolutionApplyOutcome> {
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
  const bound = await boundBoardImpact(deps); if (!bound.ok) return bound.refusal; // [PR-L6, 2026-10-19] the reviewed PCB impact, re-read against the durable board BEFORE any intent: fail closed, zero mutation

  const intent = issueResolutionApprovalIntent({
    proposalId: deps.proposal.proposalId,
    scope: { tenantId: deps.tenantId ?? "local", projectId: deps.currentProjectId, branchId: deps.currentBranchId },
    headMark: deps.proposal.scope.headMark,
    authorization: { principalId: deps.proposal.authorization.principalId, membershipRevision: deps.proposal.authorization.membershipRevision },
    now: deps.now ? deps.now() : Date.now(),
  });
  try {
    return await applyApprovedResolutionProposal({ ...deps, approval: intent, reauthorization: createResolutionReauthorization(), boardImpact: resolutionBoardImpactSummary(bound.impact) });
  } finally {
    retireResolutionApprovalIntent(intent.intentId);
  }
}

// ─── [PR-L6, 2026-10-19] runbook M.4 / M.5 item 7 (OD-253 item 8): the reviewed board impact, bound at Approve ─────────────────
/**
 * The impact the human reviewed must still be the impact: the basis (the durable board record, its qualification authority and latest
 * release) is RE-READ and the impact recomputed for the same sealed items; a different digest refuses `board-impact-changed` (the page
 * keeps the batch and shows the new impact), and an impact that was never assessed or a basis that cannot be read refuses
 * `board-impact-unavailable` - both before the one-shot intent is minted and before the fresh-facts endpoint is asked, so nothing is
 * changed. The board can still move after this point: the post-apply gate is derived from the board itself (schematic-drift.ts), so
 * the receipt's impact is disclosure, never authority.
 */
async function boundBoardImpact(deps: ResolutionApplyDeps): Promise<{ ok: true; impact: ReturnType<typeof assessResolutionBoardImpact> } | { ok: false; refusal: ResolutionApplyOutcome }> {
  const refuse = (code: ResolutionBoardImpactRefusalCode, message: string) => ({ ok: false as const, refusal: { ok: false as const, status: "refused" as const, code, message } });
  const reviewed = deps.boardImpact;
  if (!reviewed || reviewed.state !== "assessed") return refuse("board-impact-unavailable", "The PCB impact of this batch was not assessed, so it cannot be approved yet. Nothing was changed.");
  let basis: ResolutionBoardBasis;
  try { basis = await deps.readBoardBasis(); } catch { basis = { state: "unavailable", code: "PS_BOARD_READ_FAILED", detail: "the board read threw" }; }
  if (basis.state === "unavailable") return refuse("board-impact-unavailable", `The project's PCB could not be re-read to confirm the reviewed impact (${basis.code}); the batch was not applied. Nothing was changed.`);
  const impact = assessResolutionBoardImpact({ items: resolutionBoardImpactItems(deps.proposal), basis });
  if (impact.digest !== reviewed.impact.digest) return refuse("board-impact-changed", "The project's PCB changed since you reviewed this batch's PCB impact; review the updated impact and approve again. Nothing was changed.");
  return { ok: true, impact };
}
