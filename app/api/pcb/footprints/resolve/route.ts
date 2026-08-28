/**
 * GET /api/pcb/footprints/resolve?hint=<Lib:Name>
 *
 * Exact-match resolution of a KiCad footprint reference — Stage 4's fast path
 * for the footprint hints already stored on ~30k symbols. One indexed query
 * (unique index on source, lib_name, name); no embedding call.
 *
 * Returns { hit: FootprintSearchHit | null } — null when the hint is unknown,
 * so callers fall back to /search without treating a miss as an error.
 */

import { and, eq } from "drizzle-orm";
import { getDb } from "@/app/lib/db/client";
import { pcbFootprints } from "@/app/lib/db/schema";
import type { BBox } from "@/app/lib/pcb/geometry";
import type { FootprintResolveResponse } from "@/app/lib/pcb/footprint-api-types";
import { publicRoute } from "@/app/lib/auth/route-handlers";

export const runtime = "nodejs";

// [B16.0.12] canonical wrapper — policy -> bounded metadata/body run inside
// the wrapper; the callback receives only bounded projections, never the Request.
export const GET = publicRoute({ query: true }, async ({ meta }): Promise<Response> => {
  const hint = (meta.query?.hint ?? "").trim();
  const sep = hint.indexOf(":");
  if (hint === "" || sep <= 0 || sep === hint.length - 1) {
    return Response.json(
      { ok: false, error: "hint must be of the form Lib:Name" },
      { status: 400 },
    );
  }
  const libName = hint.slice(0, sep);
  const name = hint.slice(sep + 1);

  try {
    const rows = await getDb()
      .select({
        id: pcbFootprints.id,
        libName: pcbFootprints.libName,
        name: pcbFootprints.name,
        description: pcbFootprints.description,
        padCount: pcbFootprints.padCount,
        attrSmd: pcbFootprints.attrSmd,
        attrTht: pcbFootprints.attrTht,
        bodyBBox: pcbFootprints.bodyBbox,
      })
      .from(pcbFootprints)
      .where(
        and(
          // Leading column of the unique index — keeps this a pure index seek.
          eq(pcbFootprints.source, "kicad-footprints"),
          eq(pcbFootprints.libName, libName),
          eq(pcbFootprints.name, name),
        ),
      )
      .limit(1);

    const row = rows[0];
    const body: FootprintResolveResponse = {
      hit: row
        ? {
            id: row.id,
            libName: row.libName,
            name: row.name,
            fullName: `${row.libName}:${row.name}`,
            description: row.description,
            padCount: row.padCount,
            attrSmd: row.attrSmd,
            attrTht: row.attrTht,
            bodyBBox: row.bodyBBox as BBox,
            score: 1,
          }
        : null,
    };
    return Response.json(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
});
