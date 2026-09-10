/**
 * POST /api/pcb/release
 *
 * MFG01 verified manufacturing release. The client supplies only scope; the
 * authority is reloaded from server-owned durable storage by
 * `releaseManufacturingPackage`, which re-runs fresh RC01 parity, RC02
 * connectivity/DRC, placement legality, RC03 capability re-evaluation and
 * profile compatibility, generates Gerber/Excellon natively, independently
 * parses the emitted bytes back, extracts and re-validates the archive, and
 * reloads authority once more before publishing. Any inconsistency fails
 * closed with no artifact.
 *
 * [B16.1C §E] corrected against the pre-edit probes:
 *  - only an authenticated HUMAN project administrator may release (an
 *    AI-originated or machine actor is refused before any durable read);
 *  - the stored authority must describe the board's CURRENT durable revision
 *    and digest — a board re-synchronized after qualification is refused
 *    (409 MFG_AUTHORITY_STALE), never packaged from stale authority;
 *  - the fabrication-profile evidence is re-checked for expiry at RELEASE
 *    time, not only at qualification time;
 *  - every release is recorded in the durable release ledger (idempotent by
 *    release id) so a reload can truthfully show what was released;
 *  - every failure is a bounded public envelope with a correlation id.
 *
 * [B16-A F6] corrected against the review of B16.1C: the administrator's
 * confirmation pins (`expectedAuthorityRevision`, `expectedAuthorityDigest`)
 * are MANDATORY and type-checked — a same-origin administrator POST without
 * them is refused (400), so the "confirm the exact authority" step is a server
 * invariant rather than a browser courtesy; the request body is closed to the
 * declared keys (an unknown key is refused, never ignored).
 *
 * `format: "manifest"` returns the manifest metadata without a ZIP body.
 */

import { DurableManufacturingAuthorityStore } from "@/app/lib/pcb/fab/authority-store";
import { authoritativeBoardDigest, releaseManufacturingPackage, type ManufacturingReleaseLocator } from "@/app/lib/pcb/fab/release-gate";
import { DurableManufacturingReleaseLedger } from "@/app/lib/pcb/fab/release-ledger";
import { boundedManufacturingFailure, manufacturingRefusal } from "@/app/lib/pcb/fab/manufacturing-errors";
import { MANUFACTURING_RULE_PROFILE_SCHEMA, type ManufacturingRuleProfile } from "@/app/lib/pcb/fab/release-manifest";
import { ruleProfileEvidenceStatus } from "@/app/lib/pcb/fab/rule-profile";
import { getDurableWorkflowRepository } from "@/app/lib/durable-workflow/runtime";
import { DurableBoardLineageStore } from "@/app/lib/pcb-sync/board-lineage";
import { authenticatedJsonRoute } from "@/app/lib/auth/route-handlers";
import { PCB_SYNC_API_MAX_BYTES, PCB_SYNC_API_DEADLINE_MS, pcbSyncScopeFromContext, pcbSyncForbiddenAuthorityRefusal } from "../../pcb-sync/_scope";
import { stage3Repository } from "../../pcb-sync/route";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Fabrication-profile evidence older than this at RELEASE time is refused. */
export const RELEASE_PROFILE_EVIDENCE_MAX_AGE_MS = 366 * 24 * 60 * 60 * 1000;

/** [B16-A F6] the ONLY keys a release request may carry. */
export const RELEASE_BODY_KEYS: ReadonlySet<string> = new Set(["boardId", "designId", "expectedAuthorityRevision", "expectedAuthorityDigest", "format"]);

export function releaseFilename(boardId: string, releaseId: string): string {
  return `sirkit-${boardId.replace(/[^A-Za-z0-9_-]/g, "-")}-${releaseId.slice(-12)}.zip`;
}

// [B16.0.15 §B] canonical wrapper — the authenticated-release policy
// (project_admin only), same-origin CSRF, media-type, and the bounded 8 MB/30 s
// body read all run inside the wrapper BEFORE the callback, so no durable
// authority load or release generation can begin until every boundary succeeds.
// The callback receives the trusted context and parsed body only — never the
// Request, URL, host, origin, or any client-provided identity/role.
export const POST = authenticatedJsonRoute({ maxBytes: PCB_SYNC_API_MAX_BYTES, deadlineMs: PCB_SYNC_API_DEADLINE_MS }, async ({ context, body }): Promise<Response> => {
  const forbidden = pcbSyncForbiddenAuthorityRefusal(body);
  if (forbidden) return forbidden;
  const scope = pcbSyncScopeFromContext(context);
  const correlationId = context.correlationId;
  // [B16.1C §E] human truth: release is a human administrator's act. The
  // trusted context only ever mints human actors for session principals and
  // the policy already requires project_admin; this refusal makes the
  // invariant explicit and test-pinned for any future actor kind.
  if (scope.actor.actorKind !== "human" || scope.actor.role !== "project_admin") return manufacturingRefusal("MFG_RELEASE_HUMAN_REQUIRED", { correlationId });
  // [B16-A F6] closed body: an undeclared key is refused, never silently ignored.
  const unknownFields = Object.keys(body).filter((key) => !RELEASE_BODY_KEYS.has(key)).sort();
  if (unknownFields.length > 0 || (body.format !== undefined && body.format !== "manifest")) return manufacturingRefusal("MFG_API_UNKNOWN_FIELD", { correlationId, extra: { fields: unknownFields.length > 0 ? unknownFields : ["format"] } });
  const boardId = typeof body.boardId === "string" ? body.boardId : "";
  const designId = typeof body.designId === "string" ? body.designId : "";
  if (!boardId || !designId) return manufacturingRefusal("MFG_API_SCOPE_REQUIRED", { correlationId });

  const workflow = getDurableWorkflowRepository();
  const store = new DurableManufacturingAuthorityStore(workflow);
  const ledger = new DurableManufacturingReleaseLedger(workflow);
  const authorityScope = { tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId, designId, boardId };
  try {
    const stored = await store.getHead(authorityScope);
    if (!stored) return manufacturingRefusal("MFG_AUTHORITY_NOT_FOUND", { correlationId });
    // [B16.1C §F / B16-A F6] the administrator confirmed a SPECIFIC authority
    // in the browser. The confirmation is a SERVER invariant: both pins are
    // mandatory and type-checked (an integer revision and the record digest);
    // if the authority moved on between the confirmation and this request the
    // release is refused rather than packaging something never reviewed.
    const expectedRevision = body.expectedAuthorityRevision, expectedDigest = body.expectedAuthorityDigest;
    if (!Number.isSafeInteger(expectedRevision) || (expectedRevision as number) < 1 || typeof expectedDigest !== "string" || expectedDigest.length === 0) {
      return manufacturingRefusal("MFG_AUTHORITY_CONFIRMATION_REQUIRED", { correlationId, extra: { authorityRevision: stored.revision, authorityDigest: stored.recordDigest } });
    }
    if (expectedRevision !== stored.revision || expectedDigest !== stored.recordDigest) {
      return manufacturingRefusal("MFG_AUTHORITY_CONFIRMATION_MISMATCH", { correlationId, extra: { authorityRevision: stored.revision, authorityDigest: stored.recordDigest } });
    }
    // The authority must describe the board's CURRENT durable revision.
    const head = await stage3Repository.getBoardHead({ tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId, boardId });
    // [B16-C.1] an old revision's release can never become current again: releases run only on the current board of a lineage.
    const lineageStore = new DurableBoardLineageStore(getDurableWorkflowRepository());
    const lineage = await lineageStore.describe({ tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId }, boardId);
    if (lineage.state === "superseded") return manufacturingRefusal("MFG_BOARD_SUPERSEDED", { correlationId, extra: { supersededBy: lineage.supersededBy?.boardId ?? null, currentBoardId: (await lineageStore.resolveCurrent({ tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId }, boardId)).currentBoardId } });
    if (!head) return manufacturingRefusal("MFG_AUTHORITATIVE_BOARD_NOT_FOUND", { correlationId });
    if (head.record.revision !== stored.authority.boardRevision || authoritativeBoardDigest(head.record.board) !== stored.authority.boardDigest) {
      return manufacturingRefusal("MFG_AUTHORITY_STALE", { correlationId, extra: { authorityBoardRevision: stored.authority.boardRevision, currentBoardRevision: head.record.revision } });
    }
    // Release-time expiration of the fabrication-profile evidence.
    // [B16-C.4] a pre-split (v1) profile is refused distinctly; the v2 evidence carries its own expiry.
    const storedProfile = stored.authority.manufacturingRuleProfile as { schemaVersion?: string; evidence?: ManufacturingRuleProfile["evidence"] };
    if (storedProfile.schemaVersion !== MANUFACTURING_RULE_PROFILE_SCHEMA) return manufacturingRefusal("MFG_RULE_PROFILE_SCHEMA_RETIRED", { correlationId });
    const evidenceStatus = ruleProfileEvidenceStatus(storedProfile.evidence, new Date().toISOString());
    if (evidenceStatus === "expired") return manufacturingRefusal("MFG_RULE_PROFILE_EXPIRED", { correlationId });
    if (evidenceStatus !== "ok") return manufacturingRefusal("MFG_RULE_PROFILE_STALE_AT_RELEASE", { correlationId });
    const retrievedAt = Date.parse(`${storedProfile.evidence!.retrievedAt}T00:00:00.000Z`);
    if (Date.now() - retrievedAt > RELEASE_PROFILE_EVIDENCE_MAX_AGE_MS) return manufacturingRefusal("MFG_RULE_PROFILE_STALE_AT_RELEASE", { correlationId });
    // The locator pins the exact board identity the release must match; the
    // loader re-reads durable storage and refuses anything that drifted.
    const locator: ManufacturingReleaseLocator = { ...authorityScope, expectedBoardRevision: stored.authority.boardRevision, expectedBoardDigest: stored.authority.boardDigest };
    const artifact = await releaseManufacturingPackage({ locator, loadAuthority: store.loader(locator) });
    const filename = releaseFilename(boardId, artifact.releaseId);
    const recorded = await ledger.record(authorityScope, {
      releaseId: artifact.releaseId,
      archiveSha256: artifact.archiveSha256,
      manifestContentDigest: artifact.manifest.manifestContentDigest,
      filename,
      authorityRecordDigest: stored.recordDigest,
      authorityRevision: stored.revision,
      boardRevision: stored.authority.boardRevision,
      boardDigest: stored.authority.boardDigest,
      schematicRevision: stored.authority.schematic.revision,
      componentAuthorityDigest: stored.authority.qualificationAuthority?.digest ?? stored.authority.componentAuthority.digest,
      actor: scope.actor.actorId,
      releasedAt: new Date().toISOString(),
    });
    const headers: Record<string, string> = {
      "Cache-Control": "no-store",
      "X-Sirkit-Correlation-Id": correlationId,
      "X-Sirkit-Release-Id": artifact.releaseId,
      "X-Sirkit-Release-Disposition": "verified_manufacturing_release",
      "X-Sirkit-Archive-Sha256": artifact.archiveSha256,
      "X-Sirkit-Manifest-Digest": artifact.manifest.manifestContentDigest,
      "X-Sirkit-Board-Revision": stored.authority.boardRevision,
      "X-Sirkit-Authority-Revision": String(stored.revision),
      "X-Sirkit-Authority-Digest": stored.recordDigest,
      "X-Sirkit-Release-Recorded": recorded.created ? "created" : "existing",
    };
    if (body.format === "manifest") {
      return Response.json({ ok: true, releaseId: artifact.releaseId, filename, archiveSha256: artifact.archiveSha256, manifest: artifact.manifest, validation: artifact.validation, authorityRevision: stored.revision, authorityDigest: stored.recordDigest, record: recorded.record }, { headers });
    }
    return new Response(new Uint8Array(artifact.archiveBytes), { status: 200, headers: { ...headers, "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${filename}"` } });
  } catch (error) {
    return boundedManufacturingFailure(error, "release", correlationId);
  }
});
