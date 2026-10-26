/**
 * [PR-J5 integration, 2026-10-23] Review J5R-AI-2 (B16.0.1 §F, runbook J.6.6): the organise proposal's Approve reauthorizes the LIVE
 * project membership against the proposal's sealed authorization binding before anything is applied - the same family-neutral
 * boundary every other human-approved sealed-proposal apply uses (tier-1 through approved-agent-mutations.ts, B14 and PR-M through
 * their approval controllers): `createMembershipReauthorizer` (the ONE narrow same-origin endpoint, read-only, no authority sent) and
 * `evaluateMembershipReauthorization` with the schematic apply roles. A logged-out, replaced, downgraded or revoked author, or a
 * membership whose revision moved since the seal, cannot apply an already-sealed organisation; the refusal names why and nothing is
 * changed.
 *
 * Imported by the trusted UI composition root (`app/page.tsx`) only: the agent, llm, model-simulation and provider layers never reach
 * this module (b16-0-2-gates pins that they import no reauthorization authority). Tests inject a fake reauthorizer from test
 * composition, never through a provider or model surface.
 */
import { SCHEMATIC_APPLY_ROLES } from "../engineering/proposal-authorization";
import type { SealedSheetOrganizationProposal } from "../engineering/sheet-organization-proposal";
import { createMembershipReauthorizer, evaluateMembershipReauthorization, type MembershipReauthorization, type MembershipReauthorizationDenial, type MembershipReauthorizer } from "./membership-reauthorization";

export type SheetOrganizationReauthorization =
  | { ok: true }
  | { ok: false; code: `reauthorization-${MembershipReauthorizationDenial["code"]}` | "reauthorization-unavailable"; detail: string };

/**
 * Reload the live membership for the proposal's project and compare it with the sealed binding (principal, scope, required apply
 * role, membership revision). Fail closed: a thrown or refused reauthorization, or ANY divergence, refuses with a sentence ending
 * "Nothing was changed.".
 */
export async function reauthorizeSheetOrganizationApply(
  proposal: Pick<SealedSheetOrganizationProposal, "proposalId" | "scope" | "authorization">,
  reauthorize: MembershipReauthorizer = createMembershipReauthorizer(),
): Promise<SheetOrganizationReauthorization> {
  let live: MembershipReauthorization;
  try {
    live = await reauthorize({ scope: { tenantId: proposal.scope.tenantId, projectId: proposal.scope.projectId, branchId: proposal.scope.branchId }, proposalId: proposal.proposalId });
  } catch {
    return { ok: false, code: "reauthorization-unavailable", detail: "The live project membership could not be reauthorized. Nothing was changed." };
  }
  const denial = evaluateMembershipReauthorization(proposal.authorization, live, SCHEMATIC_APPLY_ROLES);
  return denial === null ? { ok: true } : { ok: false, code: `reauthorization-${denial.code}`, detail: `${denial.detail} Nothing was changed.` };
}
