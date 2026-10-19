/**
 * GET /api/parts/categories
 *
 * Returns the list of user-facing categories with how many parts each holds,
 * most-populated first. Cached for an hour — the category list barely changes.
 * [B16.0.8] canonical wrapper — the callback receives no Request. [PR-L/M integration, 2026-10-18] Under the fixture runtime the committed fixture catalog answers (no database is read, whatever DATABASE_URL says) - the same catalog GET /api/parts/[id] serves there; before, this route read only the database and answered 500 on every Build Library load in the fixture runtime ("Could not load categories"); app/lib/fixture-runtime/catalog-browse.ts.
 */

import { count, desc, eq } from "drizzle-orm";
import { getDb } from "@/app/lib/db/client";
import { parts, libraries } from "@/app/lib/db/schema";
import { publicRoute } from "@/app/lib/auth/route-handlers"; import { fixtureRuntimeEnabled } from "@/app/lib/fixture-runtime/mode"; import { fixtureContainer } from "@/app/lib/fixture-runtime/container"; import { fixtureCatalogCategories } from "@/app/lib/fixture-runtime/catalog-browse"; // [PR-L/M integration, 2026-10-18] the fixture catalog (on this line: no line moves)

export const runtime = "nodejs";

export const GET = publicRoute(undefined, async () => {
  try { if (fixtureRuntimeEnabled()) return Response.json({ ok: true, categories: fixtureCatalogCategories(fixtureContainer().catalog.cachedParts.values()) }, { headers: { "Cache-Control": "public, max-age=3600" } }); // [PR-L/M integration, 2026-10-18] the fixture runtime: the committed fixture catalog, no database read
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
