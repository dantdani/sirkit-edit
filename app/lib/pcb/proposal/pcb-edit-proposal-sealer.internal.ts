/**
 * B15.2.1 §E — the module-private RAW sealer.
 *
 * This mints a `SealedPcbEditProposal` from an already-verified compiler
 * result plus trusted context. It is INTERNAL: an AST import gate
 * (b15-2-1-seal-boundary) proves the ONLY production importer is
 * `pcb-edit-proposal-service.ts`. Nothing else — no provider path, no public
 * proposal surface — may import it, so a fabricated "compiler result" can
 * never reach a sealer.
 */

import { engineeringDigest } from "../../engineering/stable";
import type { BoundedEditImpactReport } from "./bounded-edit-compiler";
import type { BoundedPcbEditOperation } from "./bounded-edit-operations";
import {
  PCB_EDIT_APPROVAL_TIER,
  PCB_EDIT_PROPOSAL_SCHEMA,
  PCB_EDIT_PROPOSAL_TOOL_ID,
  PCB_EDIT_PROPOSAL_TOOL_VERSION,
  PCB_EDIT_PROPOSAL_TTL_MS,
  resolvePcbValidationPolicy,
  type CompiledPcbEditForSeal,
  type PcbProposalAuthorizationBinding,
  type PcbProposalBaseMark,
  type PcbProposalScope,
  type PcbValidationPolicy,
  type SealedPcbEditProposal,
} from "./sealed-pcb-edit-proposal";

/** [B16.0.1] bumped .v1 → .v2 with the proposal schema. MUST stay
 *  byte-identical to the verifier's copy in `sealed-pcb-edit-proposal.ts`. */
const IDENTITY_DIGEST_SCHEMA = "sirkit.pcb-bounded-edit-proposal-id.v2";
const NORMALIZED_OPS_DIGEST_SCHEMA = "sirkit.pcb-bounded-edit-operations.v1";
const IMPACT_DIGEST_SCHEMA = "sirkit.pcb-bounded-edit-impact.v1";

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export interface RawSealInput {
  compiled: CompiledPcbEditForSeal;
  scope: PcbProposalScope;
  base: PcbProposalBaseMark;
  /** [B15.3] the exact validation policy the compile ran under. */
  validationPolicy: PcbValidationPolicy;
  actor: { actorId: string; kind: string };
  effectiveActor: { actorId: string; kind: string };
  /** [B16.0.1 §E] the sealed authorization binding (principal + membership
   *  revision + scope + required apply role). */
  authorization: PcbProposalAuthorizationBinding;
  discovery: { digest: string; contextDigest: string };
  provenance: { provider: string; model: string; runId: string | null };
  nonce: string;
  now: number;
}

export type RawSealResult =
  | { ok: true; proposal: SealedPcbEditProposal }
  | { ok: false; code: "inconsistent-compilation"; detail: string };

/**
 * Recompute every pin the seal is about to certify, then mint. A compiled
 * object whose digests do not internally agree is refused, never sealed —
 * defence in depth even though the service only ever passes a genuine
 * compiler result.
 */
export function rawSealPcbEditProposal(input: RawSealInput): RawSealResult {
  const compiled = input.compiled;
  const recomputedOperations = engineeringDigest({
    schema: NORMALIZED_OPS_DIGEST_SCHEMA, base: input.base.pcbRevisionId, operations: compiled.request.operations,
  });
  if (recomputedOperations !== compiled.normalizedOperationsDigest) {
    return { ok: false, code: "inconsistent-compilation", detail: "The compiled operations digest does not match its operations." };
  }
  const recomputedImpact = engineeringDigest({ schema: IMPACT_DIGEST_SCHEMA, impact: compiled.impact });
  if (recomputedImpact !== compiled.impactDigest) {
    return { ok: false, code: "inconsistent-compilation", detail: "The compiled impact digest does not match its impact report." };
  }
  if (compiled.candidateDigest !== compiled.impact.candidateBoardDigest) {
    return { ok: false, code: "inconsistent-compilation", detail: "The compiled candidate digest disagrees with the impact report." };
  }
  const changed = new Set(compiled.impact.changedObjectIds);
  for (const minted of compiled.mintedObjectIds) {
    if (!changed.has(minted)) return { ok: false, code: "inconsistent-compilation", detail: "A minted object id is absent from the impact report." };
  }
  // [B15.3] the validation policy is RECOMPUTED from the canonical preset
  // registry before sealing — a caller-shaped policy that disagrees with the
  // registry is refused, never certified.
  const resolvedPolicy = resolvePcbValidationPolicy(input.validationPolicy.presetId);
  if (!resolvedPolicy
    || resolvedPolicy.policy.presetVersion !== input.validationPolicy.presetVersion
    || resolvedPolicy.policy.rulesDigest !== input.validationPolicy.rulesDigest
    || resolvedPolicy.policy.compileSchema !== input.validationPolicy.compileSchema) {
    return { ok: false, code: "inconsistent-compilation", detail: "The validation policy does not match the canonical preset registry." };
  }
  const body = {
    schema: PCB_EDIT_PROPOSAL_SCHEMA,
    nonce: input.nonce,
    scope: { ...input.scope },
    base: {
      canonicalResource: { ...input.base.canonicalResource },
      pcbRevisionId: input.base.pcbRevisionId,
      boardDigest: input.base.boardDigest,
      historyHead: { ...input.base.historyHead },
      lineageId: input.base.lineageId,
    },
    validationPolicy: { ...resolvedPolicy.policy },
    intent: compiled.request.intent,
    operations: structuredClone(compiled.request.operations) as BoundedPcbEditOperation[],
    operationsDigest: compiled.normalizedOperationsDigest,
    candidateDigest: compiled.candidateDigest,
    impact: structuredClone(compiled.impact) as BoundedEditImpactReport,
    impactDigest: compiled.impactDigest,
    mintedObjectIds: [...compiled.mintedObjectIds],
    tool: { toolId: PCB_EDIT_PROPOSAL_TOOL_ID, version: PCB_EDIT_PROPOSAL_TOOL_VERSION },
    actor: { ...input.actor },
    effectiveActor: { ...input.effectiveActor },
    authorizationBinding: { ...input.authorization },
    discovery: { ...input.discovery },
    provenance: { ...input.provenance },
    createdAt: input.now,
    expiresAt: input.now + PCB_EDIT_PROPOSAL_TTL_MS,
    approvalTier: PCB_EDIT_APPROVAL_TIER,
  };
  const proposal = deepFreeze({
    ...body,
    proposalId: `pprop-${engineeringDigest({ schema: IDENTITY_DIGEST_SCHEMA, body }).slice(5, 21)}`,
  }) as SealedPcbEditProposal;
  return { ok: true, proposal };
}
