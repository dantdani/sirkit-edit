/**
 * B15.3 §J — the UNFORGEABLE one-shot human approval for a sealed bounded
 * PCB edit proposal (the B14.1 `ReplacementApprovalIntent` pattern).
 *
 * - `PcbEditApprovalIntent` is a BRANDED frozen class: private constructor,
 *   `static {}`-scoped factory closure — structural copies, JSON round
 *   trips, and provider-supplied objects can never be instances.
 * - A module-private registry holds every live intent; consumption BURNS
 *   the registration before validating anything, so any tender — valid,
 *   forged, or replayed — spends the one shot.
 * - The intent binds the COMPLETE approval basis: the sealed proposal body
 *   digest (identity key), proposal id, tenant/project/branch/board
 *   instance, canonical resource id+digest, base PCB revision + board
 *   digest, history head sequence + lineage, the sealed validation-policy
 *   identity, the sealed authorization identity (verified principal +
 *   membership revision, [B16.0.1 §E]), expiry, and the human approval
 *   action identity.
 * - `toJSON` is inert: an intent can never be serialized into provider-
 *   visible state; import gates pin who may even import this module.
 */

import { engineeringDigest } from "./stable";

export const PCB_EDIT_APPROVAL_INTENT_TTL_MS = 2 * 60 * 1000;
const INTENT_REGISTRY_LIMIT = 16;

const activeIntents = new Map<string, PcbEditApprovalIntent>();

export interface PcbEditApprovalBinding {
  /** Digest over the COMPLETE sealed proposal body (the identity key). */
  proposalBodyDigest: string;
  proposalId: string;
  scope: { tenantId: string; projectId: string; branchId: string; boardInstanceId: string };
  canonicalResource: { resourceId: string; contentDigest: string };
  basePcbRevisionId: string;
  baseBoardDigest: string;
  baseHeadSequence: number;
  lineageId: string;
  validationPolicy: { presetId: string; presetVersion: number; rulesDigest: string };
  /** [B16.0.1 §E] the sealed proposal's authorization identity — the verified
   *  principal and the membership revision the apply role was resolved at.
   *  Bound into the one-shot intent so an approval minted for one principal/
   *  revision can never be tendered against a proposal sealed for another. */
  authorization: { principalId: string; membershipRevision: string };
  /** The human UI action identity that minted this approval. */
  approvalActionId: string;
}

let make: (input: PcbEditApprovalBinding & { issuedAt: number }) => PcbEditApprovalIntent;

export class PcbEditApprovalIntent {
  readonly intentId: string;
  readonly binding: Readonly<PcbEditApprovalBinding>;
  readonly issuedAt: number;
  readonly expiresAt: number;

  private constructor(input: PcbEditApprovalBinding & { issuedAt: number }) {
    this.intentId = `pai-${engineeringDigest({ schema: "sirkit.pcb-edit-approval-intent.v1", binding: { ...input } }).slice(5, 37)}`;
    this.binding = Object.freeze({
      proposalBodyDigest: input.proposalBodyDigest,
      proposalId: input.proposalId,
      scope: Object.freeze({ ...input.scope }),
      canonicalResource: Object.freeze({ ...input.canonicalResource }),
      basePcbRevisionId: input.basePcbRevisionId,
      baseBoardDigest: input.baseBoardDigest,
      baseHeadSequence: input.baseHeadSequence,
      lineageId: input.lineageId,
      validationPolicy: Object.freeze({ ...input.validationPolicy }),
      authorization: Object.freeze({ ...input.authorization }),
      approvalActionId: input.approvalActionId,
    });
    this.issuedAt = input.issuedAt;
    this.expiresAt = input.issuedAt + PCB_EDIT_APPROVAL_INTENT_TTL_MS;
    Object.freeze(this);
  }

  static {
    make = (input) => new PcbEditApprovalIntent(input);
  }

  /** Inert serialization — the capability never travels as data. */
  toJSON(): string {
    return "[pcb-edit-approval-intent]";
  }
}

/** Minted ONLY by the trusted PCB approval controller behind the review
 *  dialog's explicit Approve click. */
export function issuePcbEditApprovalIntent(input: PcbEditApprovalBinding & { now: number }): PcbEditApprovalIntent {
  const { now, ...binding } = input;
  const intent = make({ ...binding, issuedAt: now });
  activeIntents.set(intent.intentId, intent);
  while (activeIntents.size > INTENT_REGISTRY_LIMIT) {
    const oldest = activeIntents.keys().next().value;
    if (oldest === undefined) break;
    activeIntents.delete(oldest);
  }
  return intent;
}

export function retirePcbEditApprovalIntent(intentId: string): void {
  activeIntents.delete(intentId);
}

export type PcbApprovalConsumptionFailure =
  | "approval-missing"
  | "approval-forged"
  | "approval-replayed"
  | "approval-wrong-proposal"
  | "approval-wrong-scope"
  | "approval-stale-base"
  | "approval-wrong-policy"
  // [B16.0.1 §E] the intent's sealed authorization identity (principal +
  // membership revision) does not match the expected proposal's binding.
  | "approval-wrong-authorization"
  | "approval-expired";

/**
 * ONE-SHOT consumption. The registration is burned on ANY tender before
 * validation, so a failed tender can never be retried with the same intent.
 */
export function consumePcbEditApprovalIntent(
  candidate: unknown,
  expected: Omit<PcbEditApprovalBinding, "approvalActionId"> & { now: number },
): { ok: true; approvalActionId: string } | { ok: false; code: PcbApprovalConsumptionFailure } {
  if (candidate === null || candidate === undefined) return { ok: false, code: "approval-missing" };
  if (!(candidate instanceof PcbEditApprovalIntent)) return { ok: false, code: "approval-forged" };
  const registered = activeIntents.get(candidate.intentId);
  // ONE-SHOT: burn the registration on ANY tender before validating.
  activeIntents.delete(candidate.intentId);
  if (registered !== candidate) return { ok: false, code: "approval-replayed" };
  const binding = candidate.binding;
  if (binding.proposalBodyDigest !== expected.proposalBodyDigest || binding.proposalId !== expected.proposalId) {
    return { ok: false, code: "approval-wrong-proposal" };
  }
  if (binding.scope.tenantId !== expected.scope.tenantId || binding.scope.projectId !== expected.scope.projectId
    || binding.scope.branchId !== expected.scope.branchId || binding.scope.boardInstanceId !== expected.scope.boardInstanceId
    || binding.canonicalResource.resourceId !== expected.canonicalResource.resourceId
    || binding.canonicalResource.contentDigest !== expected.canonicalResource.contentDigest) {
    return { ok: false, code: "approval-wrong-scope" };
  }
  if (binding.basePcbRevisionId !== expected.basePcbRevisionId || binding.baseBoardDigest !== expected.baseBoardDigest
    || binding.baseHeadSequence !== expected.baseHeadSequence || binding.lineageId !== expected.lineageId) {
    return { ok: false, code: "approval-stale-base" };
  }
  if (binding.validationPolicy.presetId !== expected.validationPolicy.presetId
    || binding.validationPolicy.presetVersion !== expected.validationPolicy.presetVersion
    || binding.validationPolicy.rulesDigest !== expected.validationPolicy.rulesDigest) {
    return { ok: false, code: "approval-wrong-policy" };
  }
  // [B16.0.1 §E] the approval must have been minted for the SAME verified
  // principal at the SAME membership revision the proposal was sealed for.
  if (binding.authorization.principalId !== expected.authorization.principalId
    || binding.authorization.membershipRevision !== expected.authorization.membershipRevision) {
    return { ok: false, code: "approval-wrong-authorization" };
  }
  if (expected.now >= candidate.expiresAt) return { ok: false, code: "approval-expired" };
  return { ok: true, approvalActionId: binding.approvalActionId };
}
