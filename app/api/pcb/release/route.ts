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
 * GET returns the release manifest metadata without re-generating bytes.
 */

import { DurableManufacturingAuthorityStore } from "@/app/lib/pcb/fab/authority-store";
import { releaseManufacturingPackage, type ManufacturingReleaseLocator } from "@/app/lib/pcb/fab/release-gate";
import { getDurableWorkflowRepository } from "@/app/lib/durable-workflow/runtime";
import { authenticatedJsonRoute } from "@/app/lib/auth/route-handlers";
import { PCB_SYNC_API_MAX_BYTES, PCB_SYNC_API_DEADLINE_MS, pcbSyncScopeFromContext, pcbSyncForbiddenAuthorityRefusal } from "../../pcb-sync/_scope";

export const runtime = "nodejs";
export const maxDuration = 300;

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
  const boardId = typeof body.boardId === "string" ? body.boardId : "";
  const designId = typeof body.designId === "string" ? body.designId : "";
  if (!boardId || !designId) {
    return Response.json({ ok: false, code: "MFG_API_SCOPE_REQUIRED", error: "designId and boardId are required." }, { status: 400 });
  }

  const store = new DurableManufacturingAuthorityStore(getDurableWorkflowRepository());
  try {
    const stored = await store.get({ tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId, designId, boardId });
    if (!stored) {
      return Response.json({ ok: false, code: "MFG_AUTHORITY_NOT_FOUND", error: "No manufacturing authority exists for this board. Run autonomous qualification first." }, { status: 404 });
    }
    // The locator pins the exact board identity the release must match; the
    // loader re-reads durable storage and refuses anything that drifted.
    const locator: ManufacturingReleaseLocator = {
      tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId, designId, boardId,
      expectedBoardRevision: stored.boardRevision, expectedBoardDigest: stored.boardDigest,
    };
    const artifact = await releaseManufacturingPackage({ locator, loadAuthority: store.loader(locator) });

    if (body.format === "manifest") {
      return Response.json({ ok: true, releaseId: artifact.releaseId, archiveSha256: artifact.archiveSha256, manifest: artifact.manifest, validation: artifact.validation }, { headers: { "Cache-Control": "no-store" } });
    }
    const filename = `sirkit-${boardId.replace(/[^A-Za-z0-9_-]/g, "-")}-${artifact.releaseId.slice(-12)}.zip`;
    return new Response(new Uint8Array(artifact.archiveBytes), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
        "X-Sirkit-Release-Id": artifact.releaseId,
        "X-Sirkit-Release-Disposition": "verified_manufacturing_release",
        "X-Sirkit-Archive-Sha256": artifact.archiveSha256,
        "X-Sirkit-Board-Revision": stored.boardRevision,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = (error as { code?: string })?.code ?? (message.startsWith("MFG_") ? message.split(/[:\s]/)[0]! : "MFG_RELEASE_FAILED");
    return Response.json({ ok: false, code, error: message }, { status: 422, headers: { "Cache-Control": "no-store" } });
  }
});
