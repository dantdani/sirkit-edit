/**
 * [PR-D] The SAFE receiver for the agent's `generation_proposal_ready` event (the Build-mode generation proposal,
 * `sirkit.schematic.generate-proposal`, app/lib/agent/generation-proposals.ts): a structurally verified
 * `sirkit.schematic-generation-proposal.v1` artifact (schema, exact key set, both sealed digests intact) or nothing. A
 * fabricated, altered or malformed event yields null and offers nothing. Receiving a proposal mutates NOTHING: the page lays
 * it out through the SAME path as the composer's Generate and offers it in the SAME review dialog, where only the human's
 * approval applies it (the exact-base apply re-checks everything against the live editor).
 *
 * `generationProposalCurrency` is the intake's currency check against the LIVE editor (the tool catalog's verification
 * strategy): the sealed scope must be this project's, the sealed canonical head mark must be the session's live head, the
 * proposal must not have expired, and the base digest it was sealed against must still be the sheet's digest as the chat
 * run posted it. Pure and node-free; freely importable (the consumer never imports the service or the gateway).
 */
import { GENERATION_PROPOSAL_SCHEMA, verifySealedSchematicGenerationProposalIntegrity, type SealedSchematicGenerationProposal } from "../agent/generation-proposals";
import type { SchematicCanonicalMark } from "../engineering/schematic-projection";

export interface ReceivedGenerationProposal {
  proposal: SealedSchematicGenerationProposal;
  /** audit metadata only (never authority): the run that sealed it */
  runId: string | null;
}

/** Narrow an agent `generation_proposal_ready` event payload without granting anything. */
export function receiveGenerationProposalEvent(
  event: { type?: unknown; runId?: unknown; proposal?: unknown; [key: string]: unknown } | null | undefined,
): ReceivedGenerationProposal | null {
  if (!event || typeof event !== "object") return null;
  if (event.type !== "generation_proposal_ready") return null;
  const proposal = event.proposal;
  if (typeof proposal !== "object" || proposal === null || Array.isArray(proposal)) return null;
  if ((proposal as { schema?: unknown }).schema !== GENERATION_PROPOSAL_SCHEMA) return null;
  if (!verifySealedSchematicGenerationProposalIntegrity(proposal).ok) return null;
  return {
    proposal: proposal as SealedSchematicGenerationProposal,
    runId: typeof event.runId === "string" && event.runId.length > 0 && event.runId.length <= 128 ? event.runId : null,
  };
}

export interface GenerationProposalLiveEditor {
  /** the page's scope as the chat run posted it (tenant, project, branch) */
  scope: { tenantId: string; projectId: string; branchId: string };
  /** the schematic session's live canonical head mark (null: the session is not ready) */
  headMark: SchematicCanonicalMark | null;
  /** `schematicStateDigest` of the live sheet AS THE CHAT RUN POSTS IT (the authoritative state with the page's sheet-size fallback) */
  baseDigest: string;
  now: number;
}

export type GenerationProposalCurrency =
  | { ok: true }
  | { ok: false; code: "foreign-scope" | "expired" | "stale-head" | "stale-base"; detail: string };

/** The intake's currency check against the live editor; every refusal carries the page's own sentence. Checked before the
 *  catalog loads and again before the proposal is offered (the loads await). */
export function generationProposalCurrency(proposal: SealedSchematicGenerationProposal, live: GenerationProposalLiveEditor): GenerationProposalCurrency {
  const { scope } = proposal;
  if (scope.tenantId !== live.scope.tenantId || scope.projectId !== live.scope.projectId || scope.branchId !== live.scope.branchId) {
    return { ok: false, code: "foreign-scope", detail: "the proposal was sealed for another project or branch; nothing was changed." };
  }
  if (!(proposal.expiresAt > live.now)) {
    return { ok: false, code: "expired", detail: "the proposal expired before it could be reviewed; ask for it again. Nothing was changed." };
  }
  const head = scope.headMark;
  if (!live.headMark || head.lineageId !== live.headMark.lineageId || head.headSequence !== live.headMark.headSequence || head.canonicalStateDigest !== live.headMark.canonicalStateDigest) {
    return { ok: false, code: "stale-head", detail: live.headMark ? "the schematic's canonical head moved since the proposal was sealed; nothing was changed." : "the schematic session is not ready; nothing was changed." };
  }
  if (proposal.baseSchematicDigest !== live.baseDigest) {
    return { ok: false, code: "stale-base", detail: "the schematic changed since the proposal was generated — the result is stale and was not offered." };
  }
  return { ok: true };
}
