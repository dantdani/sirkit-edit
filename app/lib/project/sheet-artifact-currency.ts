/**
 * [PR-G, 2026-10-17] The ONE currency check the page runs on a sealed SHEET artifact before it offers it - the agent's part draft
 * request (`sirkit.part-draft-request.v1`) and its module contract set (`sirkit.module-contract-proposal.v1`) are both sealed under
 * the tier-1 scope contract (tenant / project / branch + the editor's canonical head mark), a base schematic digest and an expiry,
 * as the v1 Build-mode generation proposal was (its `generationProposalCurrency`, whose order and sentences this keeps; [PR-L, 2026-10-18]
 * removed with the in-turn generation by runbook L.5). Checked against the LIVE editor: the sealed scope must be this project's, the sealed head
 * mark the session's live head, the artifact unexpired, and the base digest the sheet's digest as the chat run posted it. Every
 * refusal carries the run-log sentence the page shows, worded for the artifact (`noun`). Pure and node-free.
 */
import type { Tier1ProposalScope } from "../engineering/schematic-proposals";
import type { SchematicCanonicalMark } from "../engineering/schematic-projection";

/** What a sealed sheet artifact binds for currency (every sheet artifact family carries exactly these). */
export interface SealedSheetArtifactBase {
  scope: Tier1ProposalScope;
  baseSchematicDigest: string;
  expiresAt: number;
}

export interface SheetArtifactLiveEditor {
  /** the page's scope as the chat run posted it (tenant, project, branch) */
  scope: { tenantId: string; projectId: string; branchId: string };
  /** the schematic session's live canonical head mark (null: the session is not ready) */
  headMark: SchematicCanonicalMark | null;
  /** `schematicStateDigest` of the live sheet AS THE CHAT RUN POSTS IT (the authoritative state with the page's sheet-size fallback) */
  baseDigest: string;
  now: number;
}

export type SheetArtifactCurrency =
  | { ok: true }
  | { ok: false; code: "foreign-scope" | "expired" | "stale-head" | "stale-base"; detail: string };

/** The intake's currency check; `noun` names the artifact in the page's sentence ("draft request", "module contract set"). */
export function sheetArtifactCurrency(artifact: SealedSheetArtifactBase, live: SheetArtifactLiveEditor, noun: string): SheetArtifactCurrency {
  const { scope } = artifact;
  if (scope.tenantId !== live.scope.tenantId || scope.projectId !== live.scope.projectId || scope.branchId !== live.scope.branchId) {
    return { ok: false, code: "foreign-scope", detail: `the ${noun} was sealed for another project or branch; nothing was changed.` };
  }
  if (!(artifact.expiresAt > live.now)) {
    return { ok: false, code: "expired", detail: `the ${noun} expired before it could be reviewed; ask for it again. Nothing was changed.` };
  }
  const head = scope.headMark;
  if (!live.headMark || head.lineageId !== live.headMark.lineageId || head.headSequence !== live.headMark.headSequence || head.canonicalStateDigest !== live.headMark.canonicalStateDigest) {
    return { ok: false, code: "stale-head", detail: live.headMark ? `the schematic's canonical head moved since the ${noun} was sealed; nothing was changed.` : "the schematic session is not ready; nothing was changed." };
  }
  if (artifact.baseSchematicDigest !== live.baseDigest) {
    return { ok: false, code: "stale-base", detail: `the schematic changed since the ${noun} was sealed — it is stale and was not offered.` };
  }
  return { ok: true };
}

/** The sealed run id as audit metadata only (never authority), bounded as the generation receiver bounds it. */
export function auditRunId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 128 ? value : null;
}
