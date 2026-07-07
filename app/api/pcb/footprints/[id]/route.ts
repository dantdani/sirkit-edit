/**
 * GET /api/pcb/footprints/[id]
 *
 * Full detail for one footprint, including `rawSexpr` — the VERBATIM
 * .kicad_mod source that Stage 13's .kicad_pcb exporter splices in.
 * Returns FootprintDetail, or 404 JSON for a missing/malformed id.
 */

import { eq } from "drizzle-orm";
import { getDb } from "@/app/lib/db/client";
import { pcbFootprints } from "@/app/lib/db/schema";
import type { BBox } from "@/app/lib/pcb/geometry";
import type { Pad, FootprintModelRef } from "@/app/lib/pcb/types";
import type { FootprintDetail } from "@/app/lib/pcb/footprint-api-types";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return Response.json({ ok: false, error: "Footprint not found" }, { status: 404 });
  }

  try {
    const rows = await getDb()
      .select()
      .from(pcbFootprints)
      .where(eq(pcbFootprints.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) {
      return Response.json({ ok: false, error: "Footprint not found" }, { status: 404 });
    }

    const body: FootprintDetail = {
      id: row.id,
      libName: row.libName,
      name: row.name,
      fullName: `${row.libName}:${row.name}`,
      description: row.description,
      padCount: row.padCount,
      attrSmd: row.attrSmd,
      attrTht: row.attrTht,
      bodyBBox: row.bodyBbox as BBox,
      tags: row.tags,
      pads: row.pads as Pad[],
      courtyardBBox: (row.courtyardBbox as BBox | null) ?? null,
      models: row.models as FootprintModelRef[],
      rawSexpr: row.rawSexpr,
      source: row.source,
      sourceCommit: row.sourceCommit,
    };
    return Response.json(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
