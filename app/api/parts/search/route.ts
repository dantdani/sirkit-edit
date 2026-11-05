/**
 * POST /api/parts/search
 *
 * Body:  { query?: string; category?: string; offset?: number; limit?: number }
 *
 * Two modes:
 *   - Browse (empty/absent query): parts in the category ordered alphabetically
 *     by name. No embedding call.
 *   - Semantic (non-empty query): parts ranked by cosine similarity against the
 *     query embedding (HNSW-indexed).
 *
 * Both modes support category filtering and offset/limit pagination, and return
 * pagination metadata { total, offset, limit }. [PR-L/M integration, 2026-10-18] Under the fixture runtime the committed fixture catalog answers (browse, or the lexical ranking: no embedding provider is asked) with no database read, as GET /api/parts/[id] does there; before, the Build Library's parts list answered 500 in the fixture runtime (app/lib/fixture-runtime/catalog-browse.ts).
 */

import { and, cosineDistance, count, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/app/lib/db/client";
import { parts, libraries } from "@/app/lib/db/schema";
import { admittedEmbedQuery } from "@/app/lib/embedding-admission"; // [B24-A3] OD-197: every query embedding goes through the embedding meter (embeddings.ts unchanged) [B24-closeout, 2026-10-10] superseded: B24-C1's record, artifacts/ai-control-plane-b24/observability-and-replay.md:338.
import type { KicadPin } from "@/app/lib/kicad/types";
import { publicJsonRoute } from "@/app/lib/auth/route-handlers"; import { fixtureRuntimeEnabled } from "@/app/lib/fixture-runtime/mode"; import { fixtureContainer } from "@/app/lib/fixture-runtime/container"; import { fixtureCatalogSearch } from "@/app/lib/fixture-runtime/catalog-browse"; // [PR-L/M integration, 2026-10-18] the fixture catalog (on this line: no line moves)
import { partLifecycleStatus } from "@/app/lib/distributors/lifecycle-sql"; // [B19-D I5b review] vendor lifecycle expires at read time

export const runtime = "nodejs";

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;
const MAX_QUERY_LENGTH = 500;

type SearchBody = {
  query?: unknown;
  category?: unknown;
  offset?: unknown;
  limit?: unknown;
  includeGenerics?: unknown;
};

type PartSummary = {
  id: string;
  name: string;
  description: string | null;
  keywords: string | null;
  mpn: string | null;
  manufacturer: string | null;
  datasheet: string | null;
  mainCategory: string;
  libraryName: string;
  pinCount: number;
  score: number;
  // BOM data-model fields (Stage 1). keySpecs is intentionally omitted here to
  // keep the search payload compact — fetch it from /api/parts/[id].
  internalPartNumber: string | null;
  lifecycleStatus: LifecycleStatus | null;
  rohsStatus: RohsStatus | null;
  packageNormalized: string | null;
};

type LifecycleStatus =
  | "active" | "nrnd" | "last_time_buy" | "eol" | "obsolete" | "unknown";
type RohsStatus = "compliant" | "non_compliant" | "unknown";

// [B16.0.8] canonical wrapper — policy → media → bounded body inside the
// wrapper; the callback receives the parsed body + a bounded query projection.
export const POST = publicJsonRoute({ maxBytes: 200000, deadlineMs: 10000, query: true }, async ({ body: parsed, meta }) => {
  const body = parsed as unknown as SearchBody;

  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (query.length > MAX_QUERY_LENGTH) {
    return Response.json(
      { ok: false, error: `query must be under ${MAX_QUERY_LENGTH} characters` },
      { status: 400 },
    );
  }

  const category =
    typeof body.category === "string" && body.category.trim() !== ""
      ? body.category.trim()
      : null;

  const limit = clampInt(body.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const offset = clampInt(body.offset, 0, 0, Number.MAX_SAFE_INTEGER);

  // Generic KiCad templates are excluded by default; opt in with
  // ?includeGenerics=true (or { includeGenerics: true } in the body).
  const includeGenerics =
    meta.query?.includeGenerics === "true" ||
    body.includeGenerics === true;

  try { if (fixtureRuntimeEnabled()) { const found = fixtureCatalogSearch(fixtureContainer().catalog.cachedParts.values(), { query, category, offset, limit, includeGenerics }); return Response.json({ ok: true, results: found.results, pagination: { total: found.total, offset, limit } }); } // [PR-L/M integration, 2026-10-18] the fixture runtime: the committed fixture catalog, no database read (on this line: no line moves)
    const db = getDb();
    const categoryWhere: SQL | undefined = category
      ? eq(libraries.mainCategory, category)
      : undefined;
    const genericWhere: SQL | undefined = includeGenerics
      ? undefined
      : eq(parts.isGeneric, false);
    const where: SQL | undefined = and(categoryWhere, genericWhere);

    // Total count for the current filter scope (drives "Load more").
    const totalRows = await db
      .select({ value: count() })
      .from(parts)
      .innerJoin(libraries, eq(parts.libraryId, libraries.id))
      .where(where);
    const total = Number(totalRows[0]?.value ?? 0);

    const rows =
      query === ""
        ? await browse(db, where, limit, offset)
        : await semantic(db, where, query, limit, offset);

    const results: PartSummary[] = rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      keywords: r.keywords,
      mpn: r.mpn,
      manufacturer: r.manufacturer,
      datasheet: r.datasheet,
      mainCategory: r.mainCategory,
      libraryName: r.libraryName,
      pinCount: Array.isArray(r.pins) ? r.pins.length : 0,
      score: r.score,
      internalPartNumber: r.internalPartNumber,
      lifecycleStatus: r.lifecycleStatus,
      rohsStatus: r.rohsStatus,
      packageNormalized: r.packageNormalized,
    }));

    return Response.json({ ok: true, results, pagination: { total, offset, limit } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
});

// ── Query modes ─────────────────────────────────────────────────────────────

type Row = {
  id: string;
  name: string;
  description: string | null;
  keywords: string | null;
  mpn: string | null;
  manufacturer: string | null;
  datasheet: string | null;
  mainCategory: string;
  libraryName: string;
  pins: KicadPin[] | null;
  score: number;
  internalPartNumber: string | null;
  lifecycleStatus: LifecycleStatus | null;
  rohsStatus: RohsStatus | null;
  packageNormalized: string | null;
};

/** Alphabetical browse — no embedding. Score is reported as 0 (not ranked). */
function browse(
  db: ReturnType<typeof getDb>,
  where: SQL | undefined,
  limit: number,
  offset: number,
): Promise<Row[]> {
  return db
    .select({
      id: parts.id,
      name: parts.name,
      description: parts.description,
      keywords: parts.keywords,
      mpn: parts.mpn,
      manufacturer: parts.manufacturer,
      datasheet: parts.datasheet,
      mainCategory: libraries.mainCategory,
      libraryName: libraries.name,
      pins: parts.pins,
      score: sql<number>`0`,
      internalPartNumber: parts.internalPartNumber,
      lifecycleStatus: partLifecycleStatus,
      rohsStatus: parts.rohsStatus,
      packageNormalized: parts.packageNormalized,
    })
    .from(parts)
    .innerJoin(libraries, eq(parts.libraryId, libraries.id))
    .where(where)
    .orderBy(parts.name)
    .limit(limit)
    .offset(offset);
}

/** Exact-token ranking used when the embedding provider is unavailable. */
function lexical(
  db: ReturnType<typeof getDb>,
  where: SQL | undefined,
  query: string,
  limit: number,
  offset: number,
): Promise<Row[]> {
  // Tokenized, not whole-phrase: "555 timer" must still match a part named
  // "NE555D" described as a timer.
  const tokens = [...new Set((query.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length >= 2))].slice(0, 8);
  const patterns = (tokens.length ? tokens : [query.trim()]).map((t) => `%${t}%`);
  const score = sql<number>`(${sql.join(
    patterns.map((p) => sql`(case when ${parts.name} ilike ${p} then 2 when ${parts.mpn} ilike ${p} then 2 when ${parts.keywords} ilike ${p} or ${parts.description} ilike ${p} then 1 else 0 end)`),
    sql` + `,
  )})`;
  const match = or(...patterns.map((p) => or(ilike(parts.name, p), ilike(parts.mpn, p), ilike(parts.keywords, p), ilike(parts.description, p))!));
  return db
    .select({
      id: parts.id,
      name: parts.name,
      description: parts.description,
      keywords: parts.keywords,
      mpn: parts.mpn,
      manufacturer: parts.manufacturer,
      datasheet: parts.datasheet,
      mainCategory: libraries.mainCategory,
      libraryName: libraries.name,
      pins: parts.pins,
      score,
      internalPartNumber: parts.internalPartNumber,
      lifecycleStatus: partLifecycleStatus,
      rohsStatus: parts.rohsStatus,
      packageNormalized: parts.packageNormalized,
    })
    .from(parts)
    .innerJoin(libraries, eq(parts.libraryId, libraries.id))
    .where(and(where, match))
    .orderBy(desc(score), parts.name)
    .limit(limit)
    .offset(offset);
}

/**
 * Semantic ranking by cosine similarity; HNSW serves the ORDER BY ... LIMIT.
 *
 * Embeddings come from a hosted provider. When it is unavailable (missing key,
 * exhausted quota, outage) the browser must still be able to find parts, so
 * ranking degrades to an exact-token lexical match rather than failing the
 * whole request.
 */
async function semantic(
  db: ReturnType<typeof getDb>,
  where: SQL | undefined,
  query: string,
  limit: number,
  offset: number,
): Promise<Row[]> {
  let queryEmbedding: number[];
  try {
    queryEmbedding = await admittedEmbedQuery(query, { purpose: "interactive" }); // [B24-A3] a refusal (EmbeddingAdmissionRefused) takes the lexical fallback below, with no provider call
  } catch (error) {
    console.warn("[parts/search] embedding provider unavailable; lexical fallback:", error instanceof Error ? error.message : String(error));
    return lexical(db, where, query, limit, offset);
  }
  const distance = cosineDistance(parts.embedding, queryEmbedding);
  return db
    .select({
      id: parts.id,
      name: parts.name,
      description: parts.description,
      keywords: parts.keywords,
      mpn: parts.mpn,
      manufacturer: parts.manufacturer,
      datasheet: parts.datasheet,
      mainCategory: libraries.mainCategory,
      libraryName: libraries.name,
      pins: parts.pins,
      score: sql<number>`1 - (${distance})`,
      internalPartNumber: parts.internalPartNumber,
      lifecycleStatus: partLifecycleStatus,
      rohsStatus: parts.rohsStatus,
      packageNormalized: parts.packageNormalized,
    })
    .from(parts)
    .innerJoin(libraries, eq(parts.libraryId, libraries.id))
    .where(where)
    .orderBy(distance)
    .limit(limit)
    .offset(offset);
}

function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}
