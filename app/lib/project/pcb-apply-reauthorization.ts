/**
 * B16.0.1 §F — apply-time membership reauthorization for a bounded PCB edit.
 *
 * A sealed PCB proposal binds the verified principal and the membership
 * revision its role was resolved at (§E). Between sealing and the human
 * "Approve and apply" click, that membership can change: the author can log
 * out, be removed from the project, be downgraded to a viewer, or have their
 * membership re-granted at a new revision. Verifying the seal proves the
 * proposal is INTACT; it says nothing about whether the author may STILL apply.
 *
 * This module is the PCB-family face of the ONE family-neutral reauthorization
 * boundary (`membership-reauthorization.ts` — shared with the B12 tier-1 and
 * B14 replacement apply flows). It performs NO mutation and is never
 * provider-callable.
 */

import { PCB_APPLY_ROLES, type SealedPcbEditProposal } from "../pcb/proposal/sealed-pcb-edit-proposal";
import {
  createMembershipReauthorizer,
  evaluateMembershipReauthorization,
  parseMembershipReauthorization,
  MEMBERSHIP_AUTHORIZATION_ENDPOINT,
  type MembershipReauthorization,
  type MembershipReauthorizationDenial,
  type MembershipReauthorizationRequest,
  type MembershipReauthorizer,
} from "./membership-reauthorization";

export type PcbApplyReauthorizationRequest = MembershipReauthorizationRequest;
export type PcbApplyReauthorization = MembershipReauthorization;
export type PcbApplyReauthorizer = MembershipReauthorizer;
export type PcbApplyReauthorizationDenial = MembershipReauthorizationDenial;

/**
 * Compare a LIVE reauthorization against a sealed PCB proposal's §E
 * authorization binding. Returns null (authorized) or the exact denial.
 * Fail-closed: any uncertainty about the live membership refuses.
 *
 *  - `membership-unavailable`: the live membership could not be resolved
 *    (logged out ⇒ 401, removed/insufficient ⇒ 403 at the endpoint).
 *  - `principal-changed`: a DIFFERENT human is now authenticated — the sealed
 *    proposal was authorized for someone else.
 *  - `scope-changed`: the live project scope no longer matches the binding.
 *  - `role-insufficient`: the principal was downgraded below an apply role.
 *  - `membership-changed`: the membership revision moved since sealing.
 */
export function evaluatePcbApplyReauthorization(
  proposal: SealedPcbEditProposal,
  live: PcbApplyReauthorization,
): PcbApplyReauthorizationDenial | null {
  return evaluateMembershipReauthorization(proposal.authorizationBinding, live, PCB_APPLY_ROLES);
}

/** The one narrow same-origin endpoint the production reauthorizer calls. */
export const PCB_APPLY_AUTHORIZATION_ENDPOINT = MEMBERSHIP_AUTHORIZATION_ENDPOINT;

/** The PRODUCTION reauthorizer (shared transport; see membership-reauthorization.ts). */
export function createPcbApplyReauthorizer(): PcbApplyReauthorizer {
  return createMembershipReauthorizer();
}

/** Parse + validate the endpoint's response body. Fail-closed on any surprise. */
export function parsePcbApplyReauthorization(body: unknown): PcbApplyReauthorization {
  return parseMembershipReauthorization(body);
}
