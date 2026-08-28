/**
 * GET /api/parts/[id]/alternates?kind=<drop_in|fff|all>&limit=<n>
 *
 * Reads the precomputed `alternates` table (populated by `pnpm compute:alternates`),
 * joins catalog details + cached distributor offers, and returns ranked
 * substitution candidates. Default kind "all" (drop_in + fff), default limit 10.
 */

import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/app/lib/db/client";
import { parts, partOffers, alternates } from "@/app/lib/db/schema";
import { bestOfferPrice, type AlternateKind } from "@/app/lib/alternates";
import { publicRoute } from "@/app/lib/auth/route-handlers";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type LifecycleStatus =
  | "active" | "nrnd" | "last_time_buy" | "eol" | "obsolete" | "unknown";

type AlternateOut = {
  partId: string;
  name: string;
  mpn: string | null;
  manufacturer: string | null;
  package: string | null;
  lifecycleStatus: LifecycleStatus;
  stock: number | null;
  bestPrice: { value: number; currency: string } | null;
  kind: AlternateKind;
  score: number;
  matchReasons: string[];
};

function clampLimit(raw: string | null): number {
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return 10;
  return Math.min(50, Math.max(1, Math.floor(n)));
}

// [B16.0.12] canonical wrapper — policy -> bounded metadata/body run inside
// the wrapper; the callback receives only bounded projections, never the Request.
export const GET = publicRoute({ routeParams: ["id"], query: true }, async ({ params, meta }): Promise<Response> => {
  const id = params!.id;
  if (!UUID_RE.test(id)) {
    return Response.json({ ok: false, error: "Invalid part id" }, { status: 400 });
  }

  const kindParam = meta.query?.kind ?? "all";
  const limit = clampLimit(meta.query?.limit ?? null);
  const kinds: AlternateKind[] =
    kindParam === "drop_in" ? ["drop_in"] : kindParam === "fff" ? ["fff"] : ["drop_in", "fff"];

  try {
    const db = getDb();

    const [source] = await db
      .select({
        id: parts.id,
        name: parts.name,
        mpn: parts.mpn,
        manufacturer: parts.manufacturer,
        lifecycleStatus: parts.lifecycleStatus,
      })
      .from(parts)
      .where(eq(parts.id, id))
      .limit(1);

    if (!source) {
      return Response.json({ ok: false, error: "Part not found" }, { status: 404 });
    }

    const rows = await db
      .select({
        alternatePartId: alternates.alternatePartId,
        kind: alternates.kind,
        score: alternates.score,
        matchReasons: alternates.matchReasons,
        name: parts.name,
        mpn: parts.mpn,
        manufacturer: parts.manufacturer,
        packageNormalized: parts.packageNormalized,
        lifecycleStatus: parts.lifecycleStatus,
      })
      .from(alternates)
      .innerJoin(parts, eq(parts.id, alternates.alternatePartId))
      .where(and(eq(alternates.partId, id), inArray(alternates.kind, kinds)))
      .orderBy(desc(alternates.score))
      .limit(limit);

    // Aggregate cached offers (stock + best price) for the listed alternates.
    const altIds = rows.map((r) => r.alternatePartId);
    const offers =
      altIds.length > 0
        ? await db.select().from(partOffers).where(inArray(partOffers.partId, altIds))
        : [];
    const offersByPart = new Map<string, typeof offers>();
    for (const o of offers) {
      const list = offersByPart.get(o.partId) ?? [];
      list.push(o);
      offersByPart.set(o.partId, list);
    }

    const alternatesOut: AlternateOut[] = rows.map((r) => {
      const partOffersForAlt = offersByPart.get(r.alternatePartId) ?? [];
      const stock =
        partOffersForAlt.length > 0
          ? partOffersForAlt.reduce((sum, o) => sum + (o.stock ?? 0), 0)
          : null;
      return {
        partId: r.alternatePartId,
        name: r.name,
        mpn: r.mpn,
        manufacturer: r.manufacturer,
        package: r.packageNormalized,
        lifecycleStatus: r.lifecycleStatus ?? "unknown",
        stock,
        bestPrice: bestOfferPrice(partOffersForAlt),
        kind: r.kind,
        score: r.score,
        matchReasons: r.matchReasons,
      };
    });

    return Response.json({
      ok: true,
      sourcePart: {
        id: source.id,
        name: source.name,
        mpn: source.mpn,
        manufacturer: source.manufacturer,
        lifecycleStatus: source.lifecycleStatus ?? "unknown",
      },
      alternates: alternatesOut,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
});
