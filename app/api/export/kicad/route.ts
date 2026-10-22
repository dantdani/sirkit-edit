/**
 * POST /api/export/kicad
 *
 * Convert a sirkit `SchematicState` to a downloadable KiCad 8.x `.kicad_sch`
 * file. Loads the static catalog data for every placed KiCad part through the
 * shared parts cache (never the DB directly), then hands off to the pure
 * `exportToKicadSch` serializer.
 *
 * Body: { state: SchematicState; title?: string; description?: string; company?: string }
 */

import { exportToKicadSch, EXPORT_HIERARCHY_PENDING, SchematicExportHierarchyPendingError, SchematicExportLicenseError, SchematicExportValidationError } from "@/app/lib/kicad-export";
import { validateSchematicStateIntegrity } from "@/app/lib/engineering/schematic-model";
import { getFullPartsByIds } from "@/app/lib/parts-search";
import type { SchematicState } from "@/lib/schematic-types";
import type { PortableAtomicSnapshot, ProjectComponentPin } from "@/app/lib/atomic/types";
import { loadPublishedPortableSnapshot } from "@/app/lib/atomic/server-catalog";
import { publicJsonRoute } from "@/app/lib/auth/route-handlers";
import { redactSecrets } from "@/app/lib/atomic/security";

export const runtime = "nodejs";

/** [B19-D I5c review] published revisions loaded at once (each load is several catalog queries). */
const PINNED_LOAD_CONCURRENCY = 4;

type ExportBody = {
  state?: SchematicState;
  title?: string;
  description?: string;
  company?: string;
  /** [B19-D I5c row 16] accepted for compatibility and IGNORED: pinned parts come from the server's published snapshots */
  componentSelections?: unknown;
};

/** Make a title safe to use as a file name. */
function sanitizeFilename(raw: string): string {
  const base = raw.trim().replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return base.length > 0 ? base : "sirkit_export";
}

// [B16.0.12] canonical wrapper — policy -> bounded metadata/body run inside
// the wrapper; the callback receives only bounded projections, never the Request.
export const POST = publicJsonRoute({ maxBytes: 8_000_000, deadlineMs: 30_000 }, async ({ body: rawBody }): Promise<Response> => {
  const body = rawBody as unknown as ExportBody;

  const state = body.state;
  if (!state) {
    return Response.json({ ok: false, error: "Missing 'state'" }, { status: 400 });
  }

  const components = state.components ?? [];
  const kicadComponents = state.kicadComponents ?? [];
  if (components.length === 0 && kicadComponents.length === 0) {
    return Response.json(
      { ok: false, error: "Schematic has no components to export" },
      { status: 400 },
    );
  }

  // B07.2 — FAIL-CLOSED: the complete state is validated against the shared
  // canonical identity + geometry contract BEFORE any catalog lookup or
  // serialization. Duplicate stable ids, duplicate case-insensitive
  // displayed references, invalid rotations/geometry, malformed wires or
  // labels all reject with a structured, sanitized 422 — export never
  // conceals canonical corruption by renaming references.
  const validationIssues = validateSchematicStateIntegrity(state);
  if (validationIssues.length > 0) {
    return Response.json(
      {
        ok: false,
        code: "SCHEMATIC_STATE_INVALID",
        error: "The schematic failed canonical identity/geometry validation and was not exported. Nothing was changed.",
        issues: validationIssues.slice(0, 20).map((issue) => issue.slice(0, 300)),
        issueCount: validationIssues.length,
      },
      { status: 422 },
    );
  } if (state.sheets !== undefined) return Response.json({ ok: false, code: "EXPORT_HIERARCHY_PENDING", error: EXPORT_HIERARCHY_PENDING }, { status: 422, headers: { "Cache-Control": "no-store" } }); // [PR-J, 2026-10-22] J2: a project with sheets is never exported as one flat page (before any catalog read)

  // [B19-D I5c rows 15, 16] Every instance that declares an atomic revision is exported from the PUBLISHED snapshot the server
  // loads for that revision — its symbol and its licenses — and the declared symbol version must match. Selections in the
  // request body are never trusted (a body snapshot could carry its own s-expressions or claim any license). An instance
  // whose pinned revision cannot be loaded is refused, never silently exported from a catalog row.
  // [B19-D I5c review] each revision is loaded once (a board of sixty passives pins a handful of revisions), a few at a time.
  // A loader that THROWS means the catalog could not be reached — a 503, logged and redacted — never "not published".
  const revisionIds = [...new Set(kicadComponents.map((component) => component.atomicPartRevisionId).filter((id): id is string => Boolean(id)))];
  const snapshotsByRevision = new Map<string, PortableAtomicSnapshot | null>();
  try {
    for (let index = 0; index < revisionIds.length; index += PINNED_LOAD_CONCURRENCY) {
      const batch = revisionIds.slice(index, index + PINNED_LOAD_CONCURRENCY);
      const loaded = await Promise.all(batch.map((revisionId) => loadPublishedPortableSnapshot(revisionId)));
      batch.forEach((revisionId, position) => snapshotsByRevision.set(revisionId, loaded[position] ?? null));
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : typeof error === "string" ? error : "non-error rejection";
    const safe = redactSecrets(detail).replace(/\b(password|passwd|pwd|secret|token|apikey|api_key|key)=\S+/gi, "$1=[REDACTED]");
    console.error(`[api/export/kicad] loading published component revisions failed: ${safe.slice(0, 300)}`);
    return Response.json(
      { ok: false, code: "EXPORT_CATALOG_UNAVAILABLE", error: "The component catalog could not be reached, so nothing was exported. Try again shortly." },
      { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "30" } },
    );
  }
  const pinnedSelections: Record<string, ProjectComponentPin> = {};
  const unavailable: string[] = [];
  for (const component of kicadComponents) {
    if (!component.atomicPartRevisionId) continue;
    const snapshot = snapshotsByRevision.get(component.atomicPartRevisionId) ?? null;
    if (!snapshot || !component.symbolAssetVersionId || snapshot.symbol.versionId !== component.symbolAssetVersionId) {
      unavailable.push(component.refDes);
      continue;
    }
    pinnedSelections[component.id] = {
      selectionRecordId: component.selectionRecordId ?? `published:${snapshot.atomicRevision.id}`,
      atomicRevisionId: snapshot.atomicRevision.id,
      symbolVersionId: snapshot.symbol.versionId,
      ...(snapshot.footprint ? { footprintVersionId: snapshot.footprint.versionId } : {}),
      ...(snapshot.mapping ? { mappingCertificateId: snapshot.mapping.id } : {}),
      modelVersionIds: snapshot.models.map((model) => model.versionId),
      embeddedSnapshot: snapshot,
    };
  }
  if (unavailable.length > 0) {
    return Response.json(
      {
        ok: false,
        code: "EXPORT_PINNED_PART_UNAVAILABLE",
        error: "Some parts are pinned to a component revision that is not published (or no longer matches), so nothing was exported.",
        components: [...new Set(unavailable)].sort(),
      },
      { status: 422, headers: { "Cache-Control": "no-store" } },
    );
  }
  const hasExactSelection = (component: (typeof kicadComponents)[number]): boolean => Boolean(pinnedSelections[component.id]);
  const partIds = [...new Set(kicadComponents.filter((component) => !hasExactSelection(component)).map((c) => c.partId))];
  const loaded = await getFullPartsByIds(partIds);
  const parts = new Map(loaded.map((p) => [p.id, p] as const));
  const failed = partIds.filter((id) => !parts.has(id));

  if (failed.length > 0) {
    return Response.json(
      { ok: false, error: `Failed to load part data for: ${failed.join(", ")}` },
      { status: 500 },
    );
  }

  let sch: string;
  try {
    sch = exportToKicadSch({
      state,
      parts,
      title: body.title,
      description: body.description,
      company: body.company,
      componentSelections: pinnedSelections,
    });
  } catch (error) {
    // [B19-D I5a] a pinned symbol whose license does not permit export: refuse, name the components, send nothing of the symbol
    if (error instanceof SchematicExportHierarchyPendingError) return Response.json({ ok: false, code: error.code, error: error.message }, { status: 422, headers: { "Cache-Control": "no-store" } }); if (error instanceof SchematicExportLicenseError) { // [PR-J J2] the hierarchy refusal: defense in depth
      return Response.json(
        {
          ok: false,
          code: "EXPORT_LICENSE_PROHIBITED",
          error: "Some pinned parts' symbol licenses do not permit export, so nothing was exported. Replace or re-license these parts.",
          components: [...new Set(error.violations.map((item) => item.refDes))].sort(),
          violations: error.violations.slice(0, 50),
        },
        { status: 422, headers: { "Cache-Control": "no-store" } },
      );
    }
    // Defense in depth: the serializer's own typed validation (should be
    // unreachable after the pre-check above) still maps to a structured 422.
    if (error instanceof SchematicExportValidationError) {
      return Response.json(
        {
          ok: false,
          code: "SCHEMATIC_STATE_INVALID",
          error: "The schematic failed canonical identity/geometry validation and was not exported. Nothing was changed.",
          issues: error.issues.slice(0, 20).map((issue) => issue.slice(0, 300)),
          issueCount: error.issues.length,
        },
        { status: 422 },
      );
    }
    throw error;
  }

  const filename = `${sanitizeFilename(body.title ?? "sirkit_export")}.kicad_sch`;
  return new Response(sch, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
});
