/**
 * Shared part-search helper for the Build-mode AI agent.
 *
 * Retrieval is a three-stage pipeline tuned for part selection:
 *   1. HYBRID RECALL — pull two candidate pools in parallel and fuse them:
 *        a. vector search (HNSW over the OpenAI embeddings) for semantic match;
 *        b. lexical search (exact-token ILIKE over name/mpn/keywords) so exact
 *           identifiers a semantic embedding can miss — an MPN fragment, a
 *           package code like "0805", a family like "ESP32" — still surface.
 *      The two rankings are merged with Reciprocal Rank Fusion (rank-based, so
 *      the two incomparable score scales never need normalizing).
 *   2. RERANK — a cheap Haiku pass reorders the fused pool for the specific
 *      role described by the query. Best-effort: any failure falls back to the
 *      fused order, so search never hard-depends on a second model call.
 *   3. TRIM — return the top `limit` for the agent.
 *
 * Returns a *compact* shape (the fields Claude needs + a token-cheap pin list)
 * so it can be fed back into the tool loop without dragging in the library UI's
 * richer payload. The `/api/parts/search` route keeps its own logic for browse.
 */

import Anthropic from "@anthropic-ai/sdk";
import {
  and,
  cosineDistance,
  desc,
  eq,
  ilike,
  inArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { getDb } from "@/app/lib/db/client";
import { parts, libraries } from "@/app/lib/db/schema";
import { embedQuery } from "@/app/lib/embeddings";
import { RERANK_RANK_TOOL, RERANK_SYSTEM_PROMPT } from "@/app/lib/prompts";
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
  /** Cosine similarity to the query (1 = identical). */
  similarity: number;
};

/**
 * Fetch parts by id in the compact AI shape. Used to seed the edit tool loop
 * with a circuit's EXISTING components so their partIds validate without the
 * model having to re-search for them. `similarity` is 1 (these are exact, not
 * ranked). Order is not guaranteed.
 */
export async function getPartsByIds(ids: string[]): Promise<AiPartResult[]> {
  const unique = [...new Set(ids)].filter((id) => id);
  if (unique.length === 0) return [];
  const db = getDb();
  const rows = await db
    .select({
      id: parts.id,
      name: parts.name,
      mpn: parts.mpn,
      description: parts.description,
      mainCategory: libraries.mainCategory,
      pins: parts.pins,
    })
    .from(parts)
    .innerJoin(libraries, eq(parts.libraryId, libraries.id))
    .where(inArray(parts.id, unique));

  return rows.map((r) => ({
    partId: r.id,
    name: r.name,
    mpn: r.mpn,
    description: r.description,
    mainCategory: r.mainCategory,
    pins: Array.isArray(r.pins)
      ? (r.pins as KicadPin[]).map((p) => ({ number: p.number, name: p.name, type: p.type }))
      : [],
    similarity: 1,
  }));
}

// ─── Retrieval / rerank tuning ──────────────────────────────────────────────

/** Vector candidates pulled via the HNSW index. */
const VECTOR_POOL = 30;
/** Exact-token candidates pulled via ILIKE. */
const LEXICAL_POOL = 30;
/** Size of the fused pool handed to the reranker. */
const CANDIDATE_POOL = 12;
/** Reciprocal-rank-fusion constant (standard default). */
const RRF_K = 60;
/** Small, fast model for the rerank pass. */
const RERANK_MODEL = "claude-haiku-4-5";

let anthropic: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (anthropic) return anthropic;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");
  anthropic = new Anthropic({ apiKey });
  return anthropic;
}

/** Row shape returned by both the vector and lexical queries. */
type SearchRow = {
  id: string;
  name: string;
  mpn: string | null;
  description: string | null;
  mainCategory: string;
  pins: KicadPin[];
  similarity: number;
};

function toAiPart(row: SearchRow): AiPartResult {
  return {
    partId: row.id,
    name: row.name,
    mpn: row.mpn,
    description: row.description,
    mainCategory: row.mainCategory,
    pins: Array.isArray(row.pins)
      ? row.pins.map((p) => ({ number: p.number, name: p.name, type: p.type }))
      : [],
    similarity: row.similarity,
  };
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "for", "to", "with", "in", "on", "at",
  "by", "from", "is", "are", "be", "that", "this", "it", "as", "into", "per",
  "use", "used", "using", "circuit", "part", "component",
]);

/**
 * Pull identifier-ish tokens worth an exact lexical match (MPN fragments,
 * package codes, family names) out of the natural-language query. Drops generic
 * words the embedding already handles and caps the count to bound the scan.
 */
function lexicalTokens(query: string): string[] {
  const matches = query.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of matches) {
    if (t.length < 2 || STOPWORDS.has(t) || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= 10) break;
  }
  return out;
}

/**
 * Rank catalog parts for `query`, optionally scoped to a `mainCategory`, and
 * return at most `limit` candidates. See the file header for the pipeline.
 */
export async function searchPartsForAI(
  query: string,
  category: string | undefined,
  limit: number,
): Promise<AiPartResult[]> {
  const db = getDb();

  const trimmedCategory =
    typeof category === "string" && category.trim() !== "" ? category.trim() : null;
  const categoryWhere: SQL | undefined = trimmedCategory
    ? eq(libraries.mainCategory, trimmedCategory)
    : undefined;

  const queryEmbedding = await embedQuery(query);
  const distance = cosineDistance(parts.embedding, queryEmbedding);
  const similarity = sql<number>`1 - (${distance})`;

  const baseSelect = {
    id: parts.id,
    name: parts.name,
    mpn: parts.mpn,
    description: parts.description,
    mainCategory: libraries.mainCategory,
    pins: parts.pins,
    similarity,
  };

  // --- Stage 1a: vector recall (HNSW, semantic) ---
  const vectorRows: SearchRow[] = await db
    .select(baseSelect)
    .from(parts)
    .innerJoin(libraries, eq(parts.libraryId, libraries.id))
    .where(categoryWhere)
    .orderBy(distance)
    .limit(VECTOR_POOL);

  // --- Stage 1b: lexical recall (exact tokens over name/mpn/keywords) ---
  // The cosine `similarity` is still computed here so fused rows carry a real
  // score regardless of which ranker surfaced them. The table is small (~22k
  // rows); if this scan ever becomes hot, a pg_trgm GIN index is the next step.
  const tokens = lexicalTokens(query);
  let lexicalRows: SearchRow[] = [];
  if (tokens.length > 0) {
    const tokenMatch = (t: string): SQL => {
      const p = `%${t}%`;
      return or(ilike(parts.name, p), ilike(parts.mpn, p), ilike(parts.keywords, p))!;
    };
    const lexScore = sql<number>`(${sql.join(
      tokens.map(
        (t) =>
          sql`(case when ${parts.name} ilike ${`%${t}%`} or ${parts.mpn} ilike ${`%${t}%`} or ${parts.keywords} ilike ${`%${t}%`} then 1 else 0 end)`,
      ),
      sql` + `,
    )})`;
    const anyToken = or(...tokens.map(tokenMatch))!;
    const lexWhere = categoryWhere ? and(categoryWhere, anyToken) : anyToken;

    lexicalRows = await db
      .select(baseSelect)
      .from(parts)
      .innerJoin(libraries, eq(parts.libraryId, libraries.id))
      .where(lexWhere)
      .orderBy(desc(lexScore))
      .limit(LEXICAL_POOL);
  }

  // --- Stage 1c: Reciprocal Rank Fusion ---
  const fused = new Map<string, { row: SearchRow; score: number }>();
  const accumulate = (rows: SearchRow[]) => {
    rows.forEach((row, idx) => {
      const inc = 1 / (RRF_K + idx + 1);
      const existing = fused.get(row.id);
      if (existing) existing.score += inc;
      else fused.set(row.id, { row, score: inc });
    });
  };
  accumulate(vectorRows);
  accumulate(lexicalRows);

  const candidates = [...fused.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, CANDIDATE_POOL)
    .map((entry) => toAiPart(entry.row));

  if (candidates.length === 0) return [];

  // --- Stage 2 + 3: rerank for the role, then trim ---
  const reranked = await rerankParts(query, candidates, limit);
  return reranked.slice(0, limit);
}

// ─── Stage 2: rerank ─────────────────────────────────────────────────────────

/**
 * Reorder the fused candidate pool for the specific role. Best-effort: returns
 * the input order unchanged on any failure (no key, API error, malformed
 * output) so retrieval never hard-depends on this second model call.
 */
async function rerankParts(
  query: string,
  candidates: AiPartResult[],
  limit: number,
): Promise<AiPartResult[]> {
  if (candidates.length <= 1) return candidates;

  let client: Anthropic;
  try {
    client = getAnthropic();
  } catch {
    return candidates;
  }

  const list = candidates.map((c, i) => ({
    index: i,
    name: c.name,
    mpn: c.mpn ?? "",
    category: c.mainCategory,
    pinCount: c.pins.length,
    description: (c.description ?? "").slice(0, 200),
  }));

  try {
    const resp = await client.messages.create({
      model: RERANK_MODEL,
      max_tokens: 256,
      system: RERANK_SYSTEM_PROMPT,
      tools: [RERANK_RANK_TOOL],
      tool_choice: { type: "tool", name: "rank_parts" },
      messages: [
        {
          role: "user",
          content: JSON.stringify({ role: query, topN: limit, candidates: list }),
        },
      ],
    });

    const toolUse = resp.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    const ranking = (toolUse?.input as { ranking?: unknown } | undefined)?.ranking;
    if (!Array.isArray(ranking)) return candidates;

    const ordered: AiPartResult[] = [];
    const used = new Set<number>();
    for (const raw of ranking) {
      const i = typeof raw === "number" ? raw : Number(raw);
      if (Number.isInteger(i) && i >= 0 && i < candidates.length && !used.has(i)) {
        used.add(i);
        ordered.push(candidates[i]);
      }
    }
    // Append any candidates the reranker left out, preserving fused order.
    for (let i = 0; i < candidates.length; i++) {
      if (!used.has(i)) ordered.push(candidates[i]);
    }
    return ordered;
  } catch {
    return candidates;
  }
}
