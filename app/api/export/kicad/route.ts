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

import { exportToKicadSch, SchematicExportValidationError } from "@/app/lib/kicad-export";
import { validateSchematicStateIntegrity } from "@/app/lib/engineering/schematic-model";
import { getFullPartsByIds } from "@/app/lib/parts-search";
import type { SchematicState } from "@/lib/schematic-types";
import type { ProjectComponentPin } from "@/app/lib/atomic/types";
import { publicJsonRoute } from "@/app/lib/auth/route-handlers";

export const runtime = "nodejs";

type ExportBody = {
  state?: SchematicState;
  title?: string;
  description?: string;
  company?: string;
  componentSelections?: Record<string, ProjectComponentPin>;
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
  }

  // Collect unique partIds and load full catalog data from the DB (server-side;
  // the client parts cache / ensurePartLoaded can't be called from a route).
  const hasExactSelection = (component: (typeof kicadComponents)[number]): boolean => {
    const selection = body.componentSelections?.[component.id];
    return Boolean(
      selection
      && selection.atomicRevisionId === component.atomicPartRevisionId
      && selection.symbolVersionId === component.symbolAssetVersionId
      && selection.embeddedSnapshot.atomicRevision.id === selection.atomicRevisionId
      && selection.embeddedSnapshot.symbol.versionId === selection.symbolVersionId,
    );
  };
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
      componentSelections: body.componentSelections,
    });
  } catch (error) {
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
