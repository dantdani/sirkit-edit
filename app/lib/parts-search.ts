/**
 * Shared semantic part-search helper.
 *
 * Mirrors the ranking logic of the `/api/parts/search` route's semantic mode,
 * but returns a *compact* shape tuned for the Build-mode AI agent: just the
 * fields Claude needs to choose a part, plus a token-cheap pin list (number,
 * name, type — no geometry). The full search route keeps its own richer payload
 * for the library UI; this helper exists so the AI agent can call the same
 * embedding-ranked search without dragging in pagination/browse concerns.
 */

import { cosineDistance, eq, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/app/lib/db/client";
import { parts, libraries } from "@/app/lib/db/schema";
import { embedQuery } from "@/app/lib/embeddings";
import type { KicadPin } from "@/app/lib/kicad/types";

/** Compact pin descriptor handed to the AI — no positions (keeps tokens small). */
export type AiPartPin = {
  number: string;
  name: string;
  type: string;
};

export type AiPartResult = {
  partId: string;
  name: string;
  mpn: string | null;
  description: string | null;
  mainCategory: string;
  pins: AiPartPin[];
  similarity: number;
};

/**
 * Rank catalog parts by cosine similarity against `query`, optionally scoped to
 * a `mainCategory`. Returns at most `limit` candidates in descending similarity.
 */
export async function searchPartsForAI(
  query: string,
  category: string | undefined,
  limit: number,
): Promise<AiPartResult[]> {
  const db = getDb();

  const trimmedCategory =
    typeof category === "string" && category.trim() !== "" ? category.trim() : null;
  const where: SQL | undefined = trimmedCategory
    ? eq(libraries.mainCategory, trimmedCategory)
    : undefined;

  const queryEmbedding = await embedQuery(query);
  const distance = cosineDistance(parts.embedding, queryEmbedding);

  const rows = await db
    .select({
      id: parts.id,
      name: parts.name,
      mpn: parts.mpn,
      description: parts.description,
      mainCategory: libraries.mainCategory,
      pins: parts.pins,
      score: sql<number>`1 - (${distance})`,
    })
    .from(parts)
    .innerJoin(libraries, eq(parts.libraryId, libraries.id))
    .where(where)
    .orderBy(distance)
    .limit(limit);

  return rows.map((r) => ({
    partId: r.id,
    name: r.name,
    mpn: r.mpn,
    description: r.description,
    mainCategory: r.mainCategory,
    pins: Array.isArray(r.pins)
      ? (r.pins as KicadPin[]).map((p) => ({
          number: p.number,
          name: p.name,
          type: p.type,
        }))
      : [],
    similarity: r.score,
  }));
}
