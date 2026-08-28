/**
 * B15.2.1 §E — the ONE high-level entry point that can create a sealed
 * bounded PCB-edit proposal.
 *
 * It receives the RAW bounded payload plus the authoritative board/rules and
 * trusted sealing context, runs `compileBoundedPcbEdit` INTERNALLY, and seals
 * ONLY that exact successful result through the module-private raw sealer.
 * A caller cannot supply a fabricated compiler result — there is no parameter
 * for one. `base.pcbRevisionId`/`boardDigest` are DERIVED from the board so
 * the sealed operations digest always recomputes at verify time.
 *
 * This is the single allowlisted importer of
 * `pcb-edit-proposal-sealer.internal.ts` (enforced by an AST import gate).
 */

import { pcbRevisionId } from "../revision";
import type { PcbBoard } from "../types";
import { compileBoundedPcbEdit, type BoundedEditCompileRefusalCode } from "./bounded-edit-compiler";
import { rawSealPcbEditProposal } from "./pcb-edit-proposal-sealer.internal";
import {
  PCB_PROPOSAL_AUTHORIZATION_SCHEMA,
  resolvePcbValidationPolicy,
  type PcbProposalAuthorizationBinding,
  type PcbProposalBaseMark,
  type PcbProposalScope,
  type SealedPcbEditProposal,
} from "./sealed-pcb-edit-proposal";
import type { ProjectRole } from "../../engineering/types";

export interface CreateSealedPcbEditProposalInput {
  /** The raw provider payload — compiled internally, never trusted as-is. */
  payload: unknown;
  board: PcbBoard;
  /**
   * [B15.3] The DRC rules are NO LONGER caller-supplied. The caller names a
   * preset from the canonical in-repo registry; the service resolves it,
   * compiles under exactly those rules, and seals the resolved policy
   * identity (preset id + version + canonical rules digest + compile
   * schema). An arbitrary rules object can never reach the compile, and the
   * sealed policy can never disagree with what was actually used.
   */
  validationPolicy: { presetId: string };
  scope: PcbProposalScope;
  /** Session facts; `pcbRevisionId`/`boardDigest` are overridden from the board. */
  base: Omit<PcbProposalBaseMark, "pcbRevisionId" | "boardDigest"> & { pcbRevisionId?: string; boardDigest?: string };
  actor: { actorId: string; kind: string };
  effectiveActor: { actorId: string; kind: string };
  /**
   * [B16.0.1 §E] the verified principal's membership binding. `principalId`,
   * tenant/project/branch, and `requiredApplyRole` default from the
   * effectiveActor + scope; the caller (the agent handler) supplies the REAL
   * `membershipRevision` the role was resolved at. When omitted entirely, an
   * `unverified` revision is sealed — such a proposal fails apply-time
   * reauthorization unless the live membership revision also reads
   * `unverified` (the local-only build), so a production proposal always
   * carries its true revision.
   */
  authorization?: {
    principalId?: string;
    membershipRevision?: string;
    requiredApplyRole?: ProjectRole;
  };
  discovery: { digest: string; contextDigest: string };
  provenance: { provider: string; model: string; runId: string | null };
  nonce: string;
  now: number;
}

/** The revision sealed when no verified membership revision is supplied. */
export const UNVERIFIED_MEMBERSHIP_REVISION = "membership:unverified" as const;

export type CreateSealedPcbEditProposalResult =
  | { ok: true; proposal: SealedPcbEditProposal }
  | { ok: false; code: BoundedEditCompileRefusalCode | "inconsistent-compilation" | "invalid-validation-policy"; detail: string };

export function createSealedPcbEditProposal(input: CreateSealedPcbEditProposalInput): CreateSealedPcbEditProposalResult {
  const resolvedPolicy = resolvePcbValidationPolicy(input.validationPolicy?.presetId as string);
  if (!resolvedPolicy) {
    return { ok: false, code: "invalid-validation-policy", detail: "The named DRC validation preset does not exist in the canonical registry." };
  }
  const compileResult = compileBoundedPcbEdit({ board: input.board, rules: resolvedPolicy.rules, payload: input.payload });
  if (!compileResult.ok) return { ok: false, code: compileResult.code, detail: compileResult.detail };

  const derivedRevision = pcbRevisionId(input.board);
  const base: PcbProposalBaseMark = {
    canonicalResource: { ...input.base.canonicalResource },
    pcbRevisionId: derivedRevision,
    boardDigest: derivedRevision,
    historyHead: { ...input.base.historyHead },
    lineageId: input.base.lineageId,
  };

  // [B16.0.1 §E] seal the authorization binding: principalId is ALWAYS the
  // verified effective actor (so it can never name a different human), the
  // scope is the proposal scope, and the membership revision is the caller's
  // real value (or the unverified sentinel). requiredApplyRole defaults to the
  // minimum apply role.
  const authorizationBinding: PcbProposalAuthorizationBinding = {
    authorizationSchema: PCB_PROPOSAL_AUTHORIZATION_SCHEMA,
    principalId: input.effectiveActor.actorId,
    membershipRevision: input.authorization?.membershipRevision ?? UNVERIFIED_MEMBERSHIP_REVISION,
    tenantId: input.scope.tenantId,
    projectId: input.scope.projectId,
    branchId: input.scope.branchId,
    requiredApplyRole: input.authorization?.requiredApplyRole ?? "pcb_editor",
  };

  return rawSealPcbEditProposal({
    compiled: {
      request: compileResult.request,
      normalizedOperationsDigest: compileResult.normalizedOperationsDigest,
      candidateDigest: compileResult.candidateDigest,
      impact: compileResult.impact,
      impactDigest: compileResult.impactDigest,
      mintedObjectIds: compileResult.mintedObjectIds,
    },
    scope: input.scope,
    base,
    validationPolicy: resolvedPolicy.policy,
    actor: input.actor,
    effectiveActor: input.effectiveActor,
    authorization: authorizationBinding,
    discovery: input.discovery,
    provenance: input.provenance,
    nonce: input.nonce,
    now: input.now,
  });
}
