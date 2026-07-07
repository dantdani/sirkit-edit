/**
 * GET /api/pcb/footprints/search?q=<text>&limit=20&padCount=<n?>&smd=<bool?>
 *
 * Hybrid footprint search over the pcb_footprints table:
 *   1. If `q` is shaped like an exact "Lib:Name" reference, short-circuit to an
 *      indexed exact lookup and return that hit with score 1 at rank 0.
 *   2. Otherwise embed `q` and pull TWO candidate pools (padCount/smd applied
 *      as SQL filters in both): top 50 by pgvector cosine similarity
 *      (HNSW-indexed) and top 50 by pg_trgm similarity on "Lib:Name" — then
 *      merge and re-rank with
 *          score = 0.6 * cosineSim + 0.4 * trigramSim(fullName, q).
 *      The trigram pool rescues name-shaped queries ("0805", "SOIC-8",
 *      "USB_C 16P") whose embeddings drown in a large near-duplicate family;
 *      the vector pool covers free-text intent the names don't spell out.
 *
 * Returns { hits: FootprintSearchHit[] } — the pinned Stage 2 contract that
 * Stage 4 (AI-assisted footprint assignment) consumes.
 */

import { and, cosineDistance, eq, isNotNull, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/app/lib/db/client";
import { pcbFootprints } from "@/app/lib/db/schema";
import { embedQuery } from "@/app/lib/embeddings";
import type { BBox } from "@/app/lib/pcb/geometry";
import type {
  FootprintSearchHit,
  FootprintSearchResponse,
} from "@/app/lib/pcb/footprint-api-types";

export const runtime = "nodejs";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_QUERY_LENGTH = 500;
/** Per-pool candidate count; the merged pools feed the hybrid re-rank. */
const POOL_CANDIDATES = 50;
/** "Lib_Name:Footprint.Name-1" — an exact footprint reference, not free text. */
const EXACT_REF_RE = /^[\w-]+:[\w.\-]+$/;

export async function GET(req: Request): Promise<Response> {
  const params = new URL(req.url).searchParams;

  const q = (params.get("q") ?? "").trim();
  if (q === "") {
    return Response.json({ ok: false, error: "q is required" }, { status: 400 });
  }
  if (q.length > MAX_QUERY_LENGTH) {
    return Response.json(
      { ok: false, error: `q must be under ${MAX_QUERY_LENGTH} characters` },
      { status: 400 },
    );
  }
  const limit = clampInt(params.get("limit"), DEFAULT_LIMIT, 1, MAX_LIMIT);

  const padCountRaw = params.get("padCount");
  const padCount = padCountRaw === null ? null : Number(padCountRaw);
  if (padCount !== null && (!Number.isInteger(padCount) || padCount < 0)) {
    return Response.json(
      { ok: false, error: "padCount must be a non-negative integer" },
      { status: 400 },
    );
  }
  const smdRaw = params.get("smd");
  if (smdRaw !== null && smdRaw !== "true" && smdRaw !== "false") {
    return Response.json({ ok: false, error: "smd must be true or false" }, { status: 400 });
  }
  const smd = smdRaw === null ? null : smdRaw === "true";

  try {
    const db = getDb();

    // Exact "Lib:Name" reference → indexed lookup, no embedding call.
    if (EXACT_REF_RE.test(q)) {
      const exact = await findExact(db, q);
      if (exact) {
        const body: FootprintSearchResponse = { hits: [exact] };
        return Response.json(body);
      }
      // Not present verbatim — fall through to hybrid search ("SOIC-8" also
      // matches the exact-ref shape but is really a free-text query).
    }

    const filters: SQL[] = [isNotNull(pcbFootprints.embedding)];
    if (padCount !== null) filters.push(eq(pcbFootprints.padCount, padCount));
    if (smd !== null) filters.push(eq(pcbFootprints.attrSmd, smd));

    const queryEmbedding = await embedQuery(q);
    const distance = cosineDistance(pcbFootprints.embedding, queryEmbedding);
    const fullName = sql<string>`${pcbFootprints.libName} || ':' || ${pcbFootprints.name}`;
    const trigramSim = sql<number>`similarity(${fullName}, ${q})`;

    const selection = {
      id: pcbFootprints.id,
      libName: pcbFootprints.libName,
      name: pcbFootprints.name,
      description: pcbFootprints.description,
      padCount: pcbFootprints.padCount,
      attrSmd: pcbFootprints.attrSmd,
      attrTht: pcbFootprints.attrTht,
      bodyBBox: pcbFootprints.bodyBbox,
      cosineSim: sql<number>`1 - (${distance})`,
      trigramSim,
    };

    const [vectorPool, trigramPool] = await Promise.all([
      db
        .select(selection)
        .from(pcbFootprints)
        .where(and(...filters))
        .orderBy(distance)
        .limit(POOL_CANDIDATES),
      db
        .select(selection)
        .from(pcbFootprints)
        .where(and(...filters, sql`${trigramSim} > 0`))
        .orderBy(sql`${trigramSim} desc`)
        .limit(POOL_CANDIDATES),
    ]);

    const byId = new Map<string, (typeof vectorPool)[number]>();
    for (const row of [...vectorPool, ...trigramPool]) byId.set(row.id, row);

    const hits: FootprintSearchHit[] = [...byId.values()]
      .map((row) => ({
        id: row.id,
        libName: row.libName,
        name: row.name,
        fullName: `${row.libName}:${row.name}`,
        description: row.description,
        padCount: row.padCount,
        attrSmd: row.attrSmd,
        attrTht: row.attrTht,
        bodyBBox: row.bodyBBox as BBox,
        score: 0.6 * Number(row.cosineSim) + 0.4 * Number(row.trigramSim),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    const body: FootprintSearchResponse = { hits };
    return Response.json(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}

/** Indexed exact lookup on (source, lib_name, name); score pinned to 1. */
async function findExact(
  db: ReturnType<typeof getDb>,
  ref: string,
): Promise<FootprintSearchHit | null> {
  const sep = ref.indexOf(":");
  const libName = ref.slice(0, sep);
  const name = ref.slice(sep + 1);
  const rows = await db
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
  if (!row) return null;
  return {
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
  };
}

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  const n = raw === null ? NaN : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}
