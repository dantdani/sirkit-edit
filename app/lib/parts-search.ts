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
import { parts, libraries, alternates } from "@/app/lib/db/schema";
import { embedQuery } from "@/app/lib/embeddings";
import { RERANK_RANK_TOOL, RERANK_SYSTEM_PROMPT } from "@/app/lib/prompts";
import type { KicadPin } from "@/app/lib/kicad/types";
import type { CachedPart } from "@/app/lib/parts-cache";

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
  /**
   * Supply-chain lifecycle ("active" | "nrnd" | "last_time_buy" | "eol" |
   * "obsolete" | "unknown"). Surfaced so the Build-mode agent can decide whether
   * a chosen part warrants a find_alternates lookup before committing to it.
   */
  lifecycleStatus: string;
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
      lifecycleStatus: parts.lifecycleStatus,
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
    lifecycleStatus: r.lifecycleStatus ?? "unknown",
    similarity: 1,
  }));
}

/**
 * Fetch FULL part records (CachedPart shape, incl. symbolRaw + geometry pins) by
 * id — the server-side equivalent of the client parts cache, for routes that run
 * on the server (e.g. KiCad export) and therefore can't call ensurePartLoaded.
 */
export async function getFullPartsByIds(ids: string[]): Promise<CachedPart[]> {
  const unique = [...new Set(ids)].filter((id) => id);
  if (unique.length === 0) return [];
  const db = getDb();
  const rows = await db
    .select({
      id: parts.id,
      name: parts.name,
      description: parts.description,
      mpn: parts.mpn,
      manufacturer: parts.manufacturer,
      datasheet: parts.datasheet,
      footprintHint: parts.footprintHint,
      mainCategory: libraries.mainCategory,
      libraryName: libraries.name,
      pins: parts.pins,
      symbolRaw: parts.symbolRaw,
      properties: parts.properties,
    })
    .from(parts)
    .innerJoin(libraries, eq(parts.libraryId, libraries.id))
    .where(inArray(parts.id, unique));
  return rows as CachedPart[];
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
  lifecycleStatus: string | null;
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
    lifecycleStatus: row.lifecycleStatus ?? "unknown",
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
  options?: { excludeGenerics?: boolean },
): Promise<AiPartResult[]> {
  const db = getDb();

  const trimmedCategory =
    typeof category === "string" && category.trim() !== "" ? category.trim() : null;
  const categoryWhere: SQL | undefined = trimmedCategory
    ? eq(libraries.mainCategory, trimmedCategory)
    : undefined;

  // Generic KiCad template symbols (Device.R, …) have no orderable MPN; exclude
  // them by default so the AI only ever sees buyable parts. The library panel
  // can opt back in via excludeGenerics: false.
  const excludeGenerics = options?.excludeGenerics ?? true;
  const genericWhere: SQL | undefined = excludeGenerics
    ? eq(parts.isGeneric, false)
    : undefined;
  const baseWhere: SQL | undefined = and(categoryWhere, genericWhere);

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
    lifecycleStatus: parts.lifecycleStatus,
    similarity,
  };

  // --- Stage 1a: vector recall (HNSW, semantic) ---
  const vectorRows: SearchRow[] = await db
    .select(baseSelect)
    .from(parts)
    .innerJoin(libraries, eq(parts.libraryId, libraries.id))
    .where(baseWhere)
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
    const lexWhere = and(baseWhere, anyToken);

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

// ─── Alternates lookup for the Build-mode agent ─────────────────────────────────

/** Compact alternate descriptor for the find_alternates tool result. */
export type AiAlternateResult = {
  partId: string;
  name: string;
  mpn: string | null;
  manufacturer: string | null;
  lifecycleStatus: string;
  /** Precomputed match score from the alternates engine (0-100, higher = better). */
  score: number;
  /** "exact" | "drop_in" | "fff" | "substitute". */
  kind: string;
  matchReasons: string[];
  pinCount: number;
};

/**
 * Return ranked alternates for `partId` from the precomputed `alternates` table,
 * joined to the catalog for display fields. `kind` "all" returns every relation;
 * "drop_in"/"fff" scope to that exact relation kind. Ordered by score DESC,
 * capped at `limit`.
 *
 * Deliberately compact (no pin list, no description) so a tool result stays well
 * under ~1KB. The Build loop separately loads full part records (with pins) for
 * the returned ids so a chosen alternate is still submittable.
 */
export async function fetchAlternatesForAI(
  partId: string,
  kind: "drop_in" | "fff" | "all",
  limit: number,
): Promise<AiAlternateResult[]> {
  if (!partId) return [];
  const db = getDb();

  const kindWhere: SQL | undefined = kind === "all" ? undefined : eq(alternates.kind, kind);

  const rows = await db
    .select({
      partId: parts.id,
      name: parts.name,
      mpn: parts.mpn,
      manufacturer: parts.manufacturer,
      lifecycleStatus: parts.lifecycleStatus,
      score: alternates.score,
      kind: alternates.kind,
      matchReasons: alternates.matchReasons,
      pins: parts.pins,
    })
    .from(alternates)
    .innerJoin(parts, eq(alternates.alternatePartId, parts.id))
    .where(and(eq(alternates.partId, partId), kindWhere))
    .orderBy(desc(alternates.score))
    .limit(limit);

  return rows.map((r) => ({
    partId: r.partId,
    name: r.name,
    mpn: r.mpn,
    manufacturer: r.manufacturer,
    lifecycleStatus: r.lifecycleStatus ?? "unknown",
    score: r.score,
    kind: r.kind,
    matchReasons: Array.isArray(r.matchReasons) ? r.matchReasons : [],
    pinCount: Array.isArray(r.pins) ? r.pins.length : 0,
  }));
}
