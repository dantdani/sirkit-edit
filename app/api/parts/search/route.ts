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
 * pagination metadata { total, offset, limit }.
 */

import { and, cosineDistance, count, eq, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/app/lib/db/client";
import { parts, libraries } from "@/app/lib/db/schema";
import { embedQuery } from "@/app/lib/embeddings";
import type { KicadPin } from "@/app/lib/kicad/types";

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

export async function POST(req: Request): Promise<Response> {
  // ── Parse & validate ──────────────────────────────────────────────────────
  let body: SearchBody;
  try {
    body = (await req.json()) as SearchBody;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

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
    new URL(req.url).searchParams.get("includeGenerics") === "true" ||
    body.includeGenerics === true;

  try {
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
}

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
      lifecycleStatus: parts.lifecycleStatus,
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

/** Semantic ranking by cosine similarity; HNSW serves the ORDER BY ... LIMIT. */
async function semantic(
  db: ReturnType<typeof getDb>,
  where: SQL | undefined,
  query: string,
  limit: number,
  offset: number,
): Promise<Row[]> {
  const queryEmbedding = await embedQuery(query);
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
      lifecycleStatus: parts.lifecycleStatus,
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
