/**
 * B16.0.14 §F — the shared, Request-free footprint search service.
 *
 * The substantive hybrid-search algorithm formerly embedded in
 * `app/api/pcb/footprints/search/route.ts`, lifted verbatim so BOTH consumers
 * — the public `GET /api/pcb/footprints/search` route and the
 * `POST /api/pcb/assign/suggest` provider loop — share ONE implementation and
 * neither reconstructs an internal HTTP request.
 *
 * The service accepts only typed, already-bounded values. It NEVER accepts a
 * Request, URL, URLSearchParams, origin, host, headers, cookies, or
 * Authorization — the callers own transport, identity, and bounds; the service
 * owns only the search.
 *
 * Behavior preserved exactly: the exact `Lib:Name` fast path (zero embedding
 * calls on a hit), one embedding call for free text, the vector + trigram
 * candidate pools with identical SQL filters, the 0.6·cosine + 0.4·trigram
 * score, result sorting, the `FootprintSearchHit` output shape, and the
 * database/embedding call ordering.
 */

import { and, cosineDistance, eq, isNotNull, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/app/lib/db/client";
import { pcbFootprints } from "@/app/lib/db/schema";
import { embedQuery } from "@/app/lib/embeddings";
import type { BBox } from "@/app/lib/pcb/geometry";
import type { FootprintSearchHit } from "@/app/lib/pcb/footprint-api-types";

/** Per-pool candidate count; the merged pools feed the hybrid re-rank. */
const POOL_CANDIDATES = 50;
/** "Lib_Name:Footprint.Name-1" — an exact footprint reference, not free text. */
const EXACT_REF_RE = /^[\w-]+:[\w.\-]+$/;

/** Typed, already-bounded search inputs. Callers are responsible for validating
 *  and clamping these (query non-empty and within length, limit clamped,
 *  padCount a non-negative integer or null, smd a boolean or null). */
export interface FootprintSearchInput {
  q: string;
  limit: number;
  padCount: number | null;
  smd: boolean | null;
}

/** Run the hybrid footprint search. Throws on database failure — callers map
 *  that to their own error contract (the public route → 500 JSON; the provider
 *  loop → an in-band tool error). */
export async function searchFootprints(input: FootprintSearchInput): Promise<FootprintSearchHit[]> {
  const { q, limit, padCount, smd } = input;
  const db = getDb();

  // Exact "Lib:Name" reference → indexed lookup, no embedding call.
  if (EXACT_REF_RE.test(q)) {
    const exact = await findExact(db, q);
    if (exact) return [exact];
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

  return [...byId.values()]
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
