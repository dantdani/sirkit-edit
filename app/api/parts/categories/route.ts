/**
 * GET /api/parts/categories
 *
 * Returns the list of user-facing categories with how many parts each holds,
 * most-populated first. Cached for an hour — the category list barely changes.
 * [B16.0.8] canonical wrapper — the callback receives no Request.
 */

import { count, desc, eq } from "drizzle-orm";
import { getDb } from "@/app/lib/db/client";
import { parts, libraries } from "@/app/lib/db/schema";
import { publicRoute } from "@/app/lib/auth/route-handlers";

export const runtime = "nodejs";

export const GET = publicRoute(undefined, async () => {
  try {
    const db = getDb();
    const rows = await db
      .select({
        mainCategory: libraries.mainCategory,
        partCount: count(parts.id),
      })
      .from(libraries)
      .innerJoin(parts, eq(parts.libraryId, libraries.id))
      .groupBy(libraries.mainCategory)
      .orderBy(desc(count(parts.id)));

    const categories = rows.map((r) => ({
      mainCategory: r.mainCategory,
      partCount: Number(r.partCount),
    }));

    return Response.json(
      { ok: true, categories },
      { headers: { "Cache-Control": "public, max-age=3600" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
});
