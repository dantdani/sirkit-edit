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
import { parts, libraries, alternates, partsAtomicLinks } from "@/app/lib/db/schema";
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
  /**
   * Component values that resolve to a PUBLISHED exact part (verified symbol,
   * footprint, pin-to-pad mapping and package authority). When present, only
   * these values are PCB-ready for this symbol — any other value has no
   * physical authority and will be blocked before the PCB is mutated.
   */
  orderableValues?: string[];
  /**
   * "verified" when this symbol is linked to a published exact part with proven
   * symbol/footprint/pin-pad/package authority — i.e. it can actually reach a
   * manufactured board. Absent means electrically plausible but PCB-unready:
   * durable publication will block it rather than guess a footprint.
   */
  physicalAuthority?: "verified";
  /** Exact footprint bound to this part, e.g. "LED_SMD:LED_0805_2012Metric". */
  verifiedFootprint?: string;
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

  // Carry published atomic authority exactly as /api/parts/[id] does, so a
  // server-side caller builds instances with the same footprint-ready identity
  // the browser cache would have.
  const links = await db
    .select({
      partId: partsAtomicLinks.partId,
      valueKey: partsAtomicLinks.valueKey,
      atomicPartRevisionId: partsAtomicLinks.atomicPartRevisionId,
      symbolAssetVersionId: partsAtomicLinks.symbolAssetVersionId,
      footprintAssetVersionId: partsAtomicLinks.footprintAssetVersionId,
      mappingCertificateId: partsAtomicLinks.mappingCertificateId,
      footprintFullName: partsAtomicLinks.footprintFullName,
    })
    .from(partsAtomicLinks)
    .where(inArray(partsAtomicLinks.partId, unique));
  const byPart = new Map<string, Record<string, NonNullable<CachedPart["atomicAssignment"]>>>();
  for (const link of links) {
    const entry = byPart.get(link.partId) ?? {};
    entry[link.valueKey] = {
      revisionId: link.atomicPartRevisionId,
      symbolVersionId: link.symbolAssetVersionId,
      footprintVersionId: link.footprintAssetVersionId,
      mappingCertificateId: link.mappingCertificateId,
      footprintFullName: link.footprintFullName,
      approved: true,
    };
    byPart.set(link.partId, entry);
  }
  return rows.map((row) => {
    const assignments = byPart.get(row.id);
    return (assignments ? { ...row, atomicAssignments: assignments } : row) as CachedPart;
  });
}

// ─── Retrieval / rerank tuning ──────────────────────────────────────────────

/** Vector candidates pulled via the HNSW index. */
const VECTOR_POOL = 30;
/** Exact-token candidates pulled via ILIKE. */
const LEXICAL_POOL = 30;
/** Candidates with published exact-part authority (their own recall channel). */
const AUTHORITY_POOL = 12;
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
  //
  // Exception: a generic symbol that has been linked to a PUBLISHED atomic part
  // revision *is* buyable — the link carries an exact MPN plus verified
  // symbol/footprint/mapping authority — so it stays visible. Unlinked generics
  // remain hidden.
  const excludeGenerics = options?.excludeGenerics ?? true;
  const genericWhere: SQL | undefined = excludeGenerics
    ? or(
        eq(parts.isGeneric, false),
        sql`exists (select 1 from ${partsAtomicLinks} where ${partsAtomicLinks.partId} = ${parts.id})`,
      )
    : undefined;
  const baseWhere: SQL | undefined = and(categoryWhere, genericWhere);

  // Embeddings are provider-hosted (OpenAI, fixed model). When that provider is
  // unavailable (missing key, exhausted quota, outage), semantic recall
  // degrades to lexical-only instead of failing the entire search: exact-token
  // recall still surfaces canonical parts, and every selected partId is
  // re-validated downstream, so degraded recall can never fabricate a part.
  let queryEmbedding: number[] | null = null;
  try {
    queryEmbedding = await embedQuery(query);
  } catch (error) {
    console.warn("[parts-search] embedding provider unavailable; using lexical-only recall:", error instanceof Error ? error.message : String(error));
  }
  const distance = queryEmbedding ? cosineDistance(parts.embedding, queryEmbedding) : null;
  const similarity = distance ? sql<number>`1 - (${distance})` : sql<number>`0`;

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
  const vectorRows: SearchRow[] = distance
    ? await db
        .select(baseSelect)
        .from(parts)
        .innerJoin(libraries, eq(parts.libraryId, libraries.id))
        .where(baseWhere)
        .orderBy(distance)
        .limit(VECTOR_POOL)
    : [];

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

  // --- Stage 1c: authority recall (parts that can actually be manufactured) ---
  // Text similarity alone can bury a part that has proven symbol/footprint/
  // pin-pad authority beneath dozens of unbuildable near-matches. Give those
  // parts their own recall channel so a manufacturable option is always a
  // candidate whenever it matches the query at all.
  let authorityRows: SearchRow[] = [];
  if (tokens.length > 0) {
    const anyToken = or(...tokens.map((t) => {
      const p = `%${t}%`;
      return or(ilike(parts.name, p), ilike(parts.mpn, p), ilike(parts.keywords, p), ilike(parts.description, p))!;
    }))!;
    const authScore = sql<number>`(${sql.join(
      tokens.map((t) => sql`(case when ${parts.name} ilike ${`%${t}%`} or ${parts.mpn} ilike ${`%${t}%`} or ${parts.keywords} ilike ${`%${t}%`} or ${parts.description} ilike ${`%${t}%`} then 1 else 0 end)`),
      sql` + `,
    )})`;
    authorityRows = await db
      .select(baseSelect)
      .from(parts)
      .innerJoin(libraries, eq(parts.libraryId, libraries.id))
      .innerJoin(partsAtomicLinks, eq(partsAtomicLinks.partId, parts.id))
      .where(and(categoryWhere, anyToken))
      .groupBy(parts.id, libraries.mainCategory)
      .orderBy(desc(authScore))
      .limit(AUTHORITY_POOL);
  }

  // --- Stage 1d: Reciprocal Rank Fusion ---
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
  accumulate(authorityRows);

  // Annotate the FULL fused set before trimming. A part with proven physical
  // authority is the only kind that can actually reach a manufactured board, so
  // it must never be cut by the candidate trim in favour of an unbuildable part
  // that merely scored higher on text similarity.
  const fusedAll = [...fused.values()]
    .sort((a, b) => b.score - a.score)
    .map((entry) => toAiPart(entry.row));
  if (fusedAll.length === 0) return [];
  const annotated = await attachOrderableValues(db, fusedAll);
  const candidates = [
    ...annotated.filter((item) => item.physicalAuthority === "verified"),
    ...annotated.filter((item) => item.physicalAuthority !== "verified"),
  ].slice(0, CANDIDATE_POOL);

  // --- Stage 2 + 3: rerank for the role, then trim ---
  const reranked = await rerankParts(query, candidates, limit);
  return reranked.slice(0, limit);
}

/**
 * Annotate results with the values that have published exact-part authority.
 * A part with no links is left untouched (the field stays absent) so the agent
 * only sees the constraint where one genuinely exists.
 */
async function attachOrderableValues(
  db: ReturnType<typeof getDb>,
  results: AiPartResult[],
): Promise<AiPartResult[]> {
  const ids = results.map((item) => item.partId);
  if (ids.length === 0) return results;
  const links = await db
    .select({ partId: partsAtomicLinks.partId, valueKey: partsAtomicLinks.valueKey, footprintFullName: partsAtomicLinks.footprintFullName })
    .from(partsAtomicLinks)
    .where(inArray(partsAtomicLinks.partId, ids));
  if (links.length === 0) return results;
  const byPart = new Map<string, { values: string[]; footprint: string }>();
  for (const link of links) {
    const entry = byPart.get(link.partId) ?? { values: [], footprint: link.footprintFullName };
    if (link.valueKey) entry.values.push(link.valueKey); // '' = value-agnostic
    byPart.set(link.partId, entry);
  }
  return results.map((item) => {
    const entry = byPart.get(item.partId);
    if (!entry) return item;
    return {
      ...item,
      physicalAuthority: "verified" as const,
      verifiedFootprint: entry.footprint,
      ...(entry.values.length ? { orderableValues: [...entry.values].sort() } : {}),
    };
  });
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
    // Surfaced so the reranker does not demote a part that can actually be
    // manufactured below one that has no footprint authority.
    ...(c.physicalAuthority === "verified" ? { physicalAuthority: "verified", verifiedFootprint: c.verifiedFootprint } : {}),
  }));

  try {
    const resp = await client.messages.create({
      model: RERANK_MODEL,
      max_tokens: 256,
      system: RERANK_SYSTEM_PROMPT,
      tools: [
        {
          name: RERANK_RANK_TOOL.name,
          description: RERANK_RANK_TOOL.description,
          input_schema: RERANK_RANK_TOOL.inputSchema as Anthropic.Tool.InputSchema,
        },
      ],
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
