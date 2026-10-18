/**
 * [PR-M, 2026-10-17] Section M.2.5: the ONE-SHOT interactive approval capability of a component RESOLUTION apply - the sibling of
 * the B14.1 replacement approval intent (the engineering layer's internal replacement approval module; its path is not spelled
 * here, so B14.1's source-text gate stays exact), kept separate so neither import boundary widens. A `ResolutionApprovalIntent` is an OPAQUE, RUNTIME-ONLY capability the trusted review boundary issues when the
 * human activates Apply on the exact reviewed resolution, consumed EXACTLY ONCE by the approved-resolution service:
 *
 *  - private constructor, a module-scoped factory assigned in a `static {}` block, frozen instances, an inert `toJSON`: JSON,
 *    structural copies and spread clones fail the `instanceof` check, so the capability never survives serialization;
 *  - bound to the exact proposal id, scope, lineage, head mark, the sealed authorization identity and a bounded expiry;
 *  - consumption burns the registration BEFORE validation, so a replay - even after a refused apply - grants nothing.
 *
 * A chat statement such as "replace D1 and D2" expresses intent; it never issues one of these. IMPORT BOUNDARY (permanent AST gate,
 * app/lib/component-resolution/__tests__/m1-boundaries.test.ts): production importers are this module and the approved-resolution
 * service only (the page's review controller joins in the next round); the agent, the gateway, routes and registries never reach it.
 */
import { engineeringDigest } from "../engineering/stable";
import type { Tier1ProposalHeadMark } from "../engineering/schematic-proposals";

const INTENT_REGISTRY_LIMIT = 16;
const activeIntents = new Map<string, ResolutionApprovalIntent>();
export const RESOLUTION_APPROVAL_INTENT_TTL_MS = 2 * 60 * 1000;

interface IntentInput {
  intentId: string;
  proposalId: string;
  scope: { tenantId: string; projectId: string; branchId: string };
  headMark: Tier1ProposalHeadMark;
  authorization: { principalId: string; membershipRevision: string };
  issuedAt: number;
  expiresAt: number;
}
let make: (input: IntentInput) => ResolutionApprovalIntent;

export class ResolutionApprovalIntent {
  readonly intentId: string;
  readonly proposalId: string;
  readonly scope: Readonly<{ tenantId: string; projectId: string; branchId: string }>;
  readonly headMark: Readonly<Tier1ProposalHeadMark>;
  readonly authorization: Readonly<{ principalId: string; membershipRevision: string }>;
  readonly issuedAt: number;
  readonly expiresAt: number;

  private constructor(input: IntentInput) {
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
    make = (input) => new ResolutionApprovalIntent(input);
  }

  toJSON(): string {
    return "[resolution-approval-intent]";
  }
}

/** Issue a one-shot intent for EXACTLY one sealed resolution identity (the trusted review boundary's Apply click only). */
export function issueResolutionApprovalIntent(input: { proposalId: string; scope: { tenantId: string; projectId: string; branchId: string }; headMark: Tier1ProposalHeadMark; authorization: { principalId: string; membershipRevision: string }; now: number }): ResolutionApprovalIntent {
  const intentId = `cai-${engineeringDigest({ schema: "sirkit.resolution-approval-intent.v1", proposalId: input.proposalId, scope: input.scope, headMark: input.headMark, authorization: input.authorization, issuedAt: input.now, entropy: `${activeIntents.size}:${Math.trunc(input.now)}` }).slice(5)}`;
  const intent = make({ intentId, proposalId: input.proposalId, scope: { ...input.scope }, headMark: { ...input.headMark }, authorization: { principalId: input.authorization.principalId, membershipRevision: input.authorization.membershipRevision }, issuedAt: input.now, expiresAt: input.now + RESOLUTION_APPROVAL_INTENT_TTL_MS });
  activeIntents.set(intentId, intent);
  if (activeIntents.size > INTENT_REGISTRY_LIMIT) {
    const oldest = activeIntents.keys().next().value;
    if (oldest !== undefined) activeIntents.delete(oldest);
  }
  return intent;
}

/** Retire an un-tendered intent (cancel / dismiss / project switch). */
export function retireResolutionApprovalIntent(intentId: string): void {
  activeIntents.delete(intentId);
}

export type ResolutionApprovalFailure = "approval-missing" | "approval-forged" | "approval-replayed" | "approval-wrong-proposal" | "approval-wrong-scope" | "approval-wrong-authorization" | "approval-stale-head" | "approval-expired";

/** Consume an intent for one apply attempt. ONE-SHOT: the tendered registration is burned before validation. */
export function consumeResolutionApprovalIntent(candidate: unknown, expected: { proposalId: string; scope: { tenantId: string; projectId: string; branchId: string }; headMark: Tier1ProposalHeadMark; authorization: { principalId: string; membershipRevision: string }; now: number }): { ok: true } | { ok: false; code: ResolutionApprovalFailure } {
  if (candidate === undefined || candidate === null) return { ok: false, code: "approval-missing" };
  if (!(candidate instanceof ResolutionApprovalIntent)) return { ok: false, code: "approval-forged" };
  const registered = activeIntents.get(candidate.intentId);
  activeIntents.delete(candidate.intentId);
  if (registered !== candidate) return { ok: false, code: "approval-replayed" };
  if (candidate.proposalId !== expected.proposalId) return { ok: false, code: "approval-wrong-proposal" };
  if (candidate.scope.tenantId !== expected.scope.tenantId || candidate.scope.projectId !== expected.scope.projectId || candidate.scope.branchId !== expected.scope.branchId) return { ok: false, code: "approval-wrong-scope" };
  if (candidate.authorization.principalId !== expected.authorization.principalId || candidate.authorization.membershipRevision !== expected.authorization.membershipRevision) return { ok: false, code: "approval-wrong-authorization" };
  if (candidate.headMark.lineageId !== expected.headMark.lineageId || candidate.headMark.headSequence !== expected.headMark.headSequence || candidate.headMark.canonicalStateDigest !== expected.headMark.canonicalStateDigest) return { ok: false, code: "approval-stale-head" };
  if (expected.now > candidate.expiresAt) return { ok: false, code: "approval-expired" };
  return { ok: true };
}
