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

import { exportToKicadSch } from "@/app/lib/kicad-export";
import { getFullPartsByIds } from "@/app/lib/parts-search";
import type { SchematicState } from "@/lib/schematic-types";

export const runtime = "nodejs";

type ExportBody = {
  state?: SchematicState;
  title?: string;
  description?: string;
  company?: string;
};

/** Make a title safe to use as a file name. */
function sanitizeFilename(raw: string): string {
  const base = raw.trim().replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return base.length > 0 ? base : "sirkit_export";
}

export async function POST(req: Request): Promise<Response> {
  let body: ExportBody;
  try {
    body = (await req.json()) as ExportBody;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

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

  // Collect unique partIds and load full catalog data from the DB (server-side;
  // the client parts cache / ensurePartLoaded can't be called from a route).
  const partIds = [...new Set(kicadComponents.map((c) => c.partId))];
  const loaded = await getFullPartsByIds(partIds);
  const parts = new Map(loaded.map((p) => [p.id, p] as const));
  const failed = partIds.filter((id) => !parts.has(id));

  if (failed.length > 0) {
    return Response.json(
      { ok: false, error: `Failed to load part data for: ${failed.join(", ")}` },
      { status: 500 },
    );
  }

  const sch = exportToKicadSch({
    state,
    parts,
    title: body.title,
    description: body.description,
    company: body.company,
  });

  const filename = `${sanitizeFilename(body.title ?? "sirkit_export")}.kicad_sch`;
  return new Response(sch, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
