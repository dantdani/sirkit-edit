/**
 * B14.1 §A — the ONE-SHOT interactive replacement-approval capability.
 *
 * A `ReplacementApprovalIntent` is an OPAQUE, RUNTIME-ONLY capability issued
 * by the trusted interactive composition boundary (the replacement approval
 * controller behind the review UI's Apply click) and consumed EXACTLY ONCE
 * by the approved-replacement service. Authority is the module-private
 * registry plus class identity — never booleans, strings, provenance
 * fields, React state, `Event.isTrusted`, or caller-supplied callbacks:
 *
 *  - the constructor is private; the only factory is a module-scoped
 *    closure assigned in a `static {}` block, so `new` is impossible
 *    outside this module and the factory is never exported;
 *  - instances are frozen and `toJSON()` collapses to an inert string, so
 *    the capability never survives serialization; deserialized JSON,
 *    structural copies, and spread-clones fail the `instanceof` check;
 *  - the intent is bound to the EXACT proposal (proposalId), scope
 *    (tenant/project/branch), lineage, head mark, a bounded expiry, and
 *    [B16.0.1 §E] the sealed authorization identity (verified principal +
 *    membership revision) the reviewed artifact carries;
 *  - consumption is ONE-SHOT: any tender of an intent removes it from the
 *    registry BEFORE validation, so a replay — even after a refused apply —
 *    grants nothing;
 *  - a canceled review retires the outstanding intent explicitly.
 *
 * IMPORT BOUNDARY (enforced by a permanent walker test): the ONLY approved
 * production importers are the trusted approval controller
 * (`app/lib/project/replacement-approval-controller.ts` — issuing/retiring)
 * and the approved-replacement service
 * (`app/lib/engineering/approved-replacement-mutations.ts` — consuming).
 * The engineering barrel, API routes, agent gateway, provider adapters, and
 * tool registry never export or reach this module, so provider/model code
 * cannot acquire or invoke it.
 */

import { engineeringDigest } from "./stable";
import type { Tier1ProposalHeadMark } from "./schematic-proposals";

const INTENT_REGISTRY_LIMIT = 16;
const activeIntents = new Map<string, ReplacementApprovalIntent>();

/** Default lifetime of an issued intent: one interactive click-to-apply
 *  window. Long enough for the apply round-trip, far too short to stash. */
export const REPLACEMENT_APPROVAL_INTENT_TTL_MS = 2 * 60 * 1000;

let make: (input: {
  intentId: string;
  proposalId: string;
  scope: { tenantId: string; projectId: string; branchId: string };
  headMark: Tier1ProposalHeadMark;
  /** [B16.0.1 §E] the sealed authorization identity the reviewed proposal was
   *  authorized for — the intent is bound to the EXACT principal + membership
   *  revision, so an approval minted for one authorization can never tender
   *  an apply under another. */
  authorization: { principalId: string; membershipRevision: string };
  issuedAt: number;
  expiresAt: number;
}) => ReplacementApprovalIntent;

export class ReplacementApprovalIntent {
  readonly intentId: string;
  readonly proposalId: string;
  readonly scope: Readonly<{ tenantId: string; projectId: string; branchId: string }>;
  readonly headMark: Readonly<Tier1ProposalHeadMark>;
  /** [B16.0.1 §E] the bound authorization identity. */
  readonly authorization: Readonly<{ principalId: string; membershipRevision: string }>;
  readonly issuedAt: number;
  readonly expiresAt: number;

  private constructor(input: Parameters<typeof make>[0]) {
    this.intentId = input.intentId;
    this.proposalId = input.proposalId;
    this.scope = Object.freeze({ ...input.scope });
    this.headMark = Object.freeze({ ...input.headMark });
    this.authorization = Object.freeze({ principalId: input.authorization.principalId, membershipRevision: input.authorization.membershipRevision });
    this.issuedAt = input.issuedAt;
    this.expiresAt = input.expiresAt;
    Object.freeze(this);
  }

  static {
    make = (input) => new ReplacementApprovalIntent(input);
  }

  toJSON(): string {
    return "[replacement-approval-intent]";
  }
}

/**
 * Issue a one-shot approval intent for EXACTLY one sealed proposal identity.
 * Called ONLY by the trusted approval controller when the human activates
 * Apply in the review UI. Registration is the only path to a valid intent.
 */
export function issueReplacementApprovalIntent(input: {
  proposalId: string;
  scope: { tenantId: string; projectId: string; branchId: string };
  headMark: Tier1ProposalHeadMark;
  /** [B16.0.1 §E] the sealed authorization identity from the reviewed
   *  proposal's §E binding (`proposal.authorization`) — the trusted approval
   *  controller derives it; it is never caller-invented. */
  authorization: { principalId: string; membershipRevision: string };
  now: number;
}): ReplacementApprovalIntent {
  const intentId = `rai-${engineeringDigest({
    schema: "sirkit.replacement-approval-intent.v2",
    proposalId: input.proposalId,
    scope: input.scope,
    headMark: input.headMark,
    authorization: { principalId: input.authorization.principalId, membershipRevision: input.authorization.membershipRevision },
    issuedAt: input.now,
    entropy: `${activeIntents.size}:${Math.trunc(input.now)}`,
  }).slice(5)}`;
  const intent = make({
    intentId,
    proposalId: input.proposalId,
    scope: { ...input.scope },
    headMark: { ...input.headMark },
    authorization: { principalId: input.authorization.principalId, membershipRevision: input.authorization.membershipRevision },
    issuedAt: input.now,
    expiresAt: input.now + REPLACEMENT_APPROVAL_INTENT_TTL_MS,
  });
  activeIntents.set(intentId, intent);
  if (activeIntents.size > INTENT_REGISTRY_LIMIT) {
    const oldest = activeIntents.keys().next().value;
    if (oldest !== undefined) activeIntents.delete(oldest);
  }
  return intent;
}

/** Retire an un-tendered intent (cancel/dismiss/timeout/project switch). */
export function retireReplacementApprovalIntent(intentId: string): void {
  activeIntents.delete(intentId);
}

export type ApprovalConsumptionFailure =
  | "approval-missing"
  | "approval-forged"
  | "approval-replayed"
  | "approval-wrong-proposal"
  | "approval-wrong-scope"
  /** [B16.0.1 §E] the intent was minted for a different sealed authorization
   *  identity (principal or membership revision) than the artifact tendered. */
  | "approval-wrong-authorization"
  | "approval-stale-head"
  | "approval-expired";

/**
 * Consume an approval intent for one apply attempt. ONE-SHOT: the tendered
 * intent is removed from the registry BEFORE validation, so a second tender
 * (replay, duplicate click racing past the UI guard, or retry after a
 * refusal) grants nothing — a fresh explicit click must issue a fresh
 * intent. Serialized/structural forgeries fail the registry+instanceof
 * check; wrong-proposal/scope/head/expired intents fail their bindings.
 */
export function consumeReplacementApprovalIntent(candidate: unknown, expected: {
  proposalId: string;
  scope: { tenantId: string; projectId: string; branchId: string };
  headMark: Tier1ProposalHeadMark;
  /** [B16.0.1 §E] the sealed authorization identity of the artifact being
   *  applied — the intent must have been minted for EXACTLY this principal +
   *  membership revision. */
  authorization: { principalId: string; membershipRevision: string };
  now: number;
}): { ok: true } | { ok: false; code: ApprovalConsumptionFailure } {
  if (candidate === undefined || candidate === null) return { ok: false, code: "approval-missing" };
  if (!(candidate instanceof ReplacementApprovalIntent)) return { ok: false, code: "approval-forged" };
  const registered = activeIntents.get(candidate.intentId);
  // ONE-SHOT: burn the registration on ANY tender before validating.
  activeIntents.delete(candidate.intentId);
  if (registered !== candidate) return { ok: false, code: "approval-replayed" };
  if (candidate.proposalId !== expected.proposalId) return { ok: false, code: "approval-wrong-proposal" };
  if (candidate.scope.tenantId !== expected.scope.tenantId
    || candidate.scope.projectId !== expected.scope.projectId
    || candidate.scope.branchId !== expected.scope.branchId) {
    return { ok: false, code: "approval-wrong-scope" };
  }
  // [B16.0.1 §E] the intent's bound authorization identity must EXACTLY match
  // the sealed authorization of the artifact tendered — an approval minted
  // under one principal/membership revision authorizes nothing else.
  if (candidate.authorization.principalId !== expected.authorization.principalId
    || candidate.authorization.membershipRevision !== expected.authorization.membershipRevision) {
    return { ok: false, code: "approval-wrong-authorization" };
  }
  if (candidate.headMark.lineageId !== expected.headMark.lineageId
    || candidate.headMark.headSequence !== expected.headMark.headSequence
    || candidate.headMark.canonicalStateDigest !== expected.headMark.canonicalStateDigest) {
    return { ok: false, code: "approval-stale-head" };
  }
  if (expected.now > candidate.expiresAt) return { ok: false, code: "approval-expired" };
  return { ok: true };
}
