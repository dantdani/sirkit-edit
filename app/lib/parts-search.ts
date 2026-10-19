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
import { parts, libraries, alternates, partsAtomicLinks, atomicRevisionStatusEvents } from "@/app/lib/db/schema"; // [PR-L6, 2026-10-19] + the status events the catalog epoch reads (readCatalogEpoch, after the last line)
import { selectableRevisionIdSql } from "@/app/lib/atomic/revision-status-sql";
import { embedQuery } from "@/app/lib/embeddings";
import { RERANK_RANK_TOOL, RERANK_SYSTEM_PROMPT } from "@/app/lib/prompts";
import { rerankCandidatePayload } from "@/app/lib/parts-rerank-payload"; // [B19-D I5e row 05]
import type { KicadPin } from "@/app/lib/kicad/types";
import type { CachedPart } from "@/app/lib/parts-cache";

import { fixtureContainer } from "@/app/lib/fixture-runtime/container";
import { fixtureRuntimeEnabled } from "@/app/lib/fixture-runtime/mode";
import { partLifecycleStatus } from "@/app/lib/distributors/lifecycle-sql"; // [B19-D I5b review] vendor lifecycle expires at read time
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
  // [B16-C §5] fixture runtime: the committed blinker catalog stands in for the parts table.
  if (fixtureRuntimeEnabled()) {
    return unique.flatMap((id) => { const part = fixtureContainer().catalog.cachedParts.get(id); return part ? [{ partId: part.id, name: part.name, mpn: part.mpn, description: part.description, mainCategory: part.mainCategory, pins: part.pins.map((pin) => ({ number: pin.number, name: pin.name, type: pin.type })), lifecycleStatus: "unknown", similarity: 1 }] : []; });
  }
  const db = getDb();
  const rows = await db
    .select({
      id: parts.id,
      name: parts.name,
      mpn: parts.mpn,
      description: parts.description,
      mainCategory: libraries.mainCategory,
      pins: parts.pins,
      lifecycleStatus: partLifecycleStatus,
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
  // [B16-C §5] fixture runtime: the committed blinker catalog (CachedPart shape, incl. atomic assignments).
  if (fixtureRuntimeEnabled()) return unique.flatMap((id) => { const part = fixtureContainer().catalog.cachedParts.get(id); return part ? [structuredClone(part)] : []; });
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
      selectable: selectableRevisionIdSql(partsAtomicLinks.atomicPartRevisionId),
    })
    .from(partsAtomicLinks)
    .where(inArray(partsAtomicLinks.partId, unique));
  const byPart = new Map<string, Record<string, NonNullable<CachedPart["atomicAssignment"]>>>();
  const withdrawnByPart = new Map<string, string[]>();
  for (const link of links) {
    // [B19-E E3] a link to a withdrawn or missing revision carries no authority into a new instance; approved is derived
    if (link.selectable !== true) {
      // [B19-E E3 review] ...and its value never falls back to the '' default. [B19-E E4 review follow-up] the '' default is reported
      // too, as /api/parts/[id] does (valueKeyLink reads only a value's own key there, so no value's link changes)
      withdrawnByPart.set(link.partId, [...(withdrawnByPart.get(link.partId) ?? []), link.valueKey]);
      continue;
    }
    const entry = byPart.get(link.partId) ?? {};
    entry[link.valueKey] = {
      revisionId: link.atomicPartRevisionId,
      symbolVersionId: link.symbolAssetVersionId,
      footprintVersionId: link.footprintAssetVersionId,
      mappingCertificateId: link.mappingCertificateId,
      footprintFullName: link.footprintFullName,
      approved: link.selectable,
    };
    byPart.set(link.partId, entry);
  }
  return rows.map((row) => {
    const assignments = byPart.get(row.id);
    const withdrawn = withdrawnByPart.get(row.id);
    return { ...row, ...(assignments ? { atomicAssignments: assignments } : {}), ...(withdrawn ? { withdrawnValueKeys: withdrawn } : {}) } as CachedPart;
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
  options?: {
    excludeGenerics?: boolean;
    signal?: AbortSignal;
    /** [PR-L, 2026-10-17] the reranker refusal memo: the process-wide one unless a caller (a generation task) injects its own */
    rerankMemo?: RerankRefusalMemo;
    /** [PR-L, 2026-10-17] told how this search ran - its category resolution and ranking - just before the results return */
    onOutcome?: (outcome: PartsSearchOutcome) => void; /** [PR-L6, 2026-10-19] L.6 part 2 item 1: a caller's query embedder (a generation task's per-task cache); this module's embedQuery by default */ embedQuery?: (text: string) => Promise<QueryEmbedding>;
  },
): Promise<AiPartResult[]> {
  const signal = options?.signal;
  assertCatalogLookupCurrent(signal);
  const db = getDb();

  // [PR-L, 2026-10-17] the category is resolved against the catalog's real vocabulary (kicad/categories.ts): a name as given, or the
  // one name a request means; an unrecognised request filters NOTHING and the outcome's note says so. Before, the model's string was
  // matched exactly against names it was never shown, and a miss returned nothing from all three channels (limit-and-stall-map.md 4).
  const categoryResolution = resolveMainCategory(category);
  const categoryWhere: SQL | undefined = categoryResolution.applied
    ? eq(libraries.mainCategory, categoryResolution.applied)
    : undefined;

  // Generic KiCad template symbols (Device.R, …) have no orderable MPN; exclude
  // them by default so the AI only ever sees buyable parts. The library panel
  // can opt back in via excludeGenerics: false.
  //
  // Exception: a generic symbol that has been linked to a PUBLISHED atomic part
  // revision *is* buyable — the link carries an exact MPN plus verified
  // symbol/footprint/mapping authority — so it stays visible. Unlinked generics
  // remain hidden. [B19-E E3] so do generics whose links all name withdrawn revisions.
  const excludeGenerics = options?.excludeGenerics ?? true;
  const genericWhere: SQL | undefined = excludeGenerics
    ? or(
        eq(parts.isGeneric, false),
        sql`exists (select 1 from ${partsAtomicLinks} where ${partsAtomicLinks.partId} = ${parts.id} and ${selectableRevisionIdSql(partsAtomicLinks.atomicPartRevisionId)})`,
      )
    : undefined;
  const baseWhere: SQL | undefined = and(categoryWhere, genericWhere);

  // Embeddings are provider-hosted (OpenAI, fixed model). When that provider is
  // unavailable (missing key, exhausted quota, outage), semantic recall
  // degrades to lexical-only instead of failing the entire search: exact-token
  // recall still surfaces canonical parts, and every selected partId is
  // re-validated downstream, so degraded recall can never fabricate a part.
  let queryEmbedding: number[] | null = null; let embedding: PartsSearchOutcome["embedding"]; // [PR-L6, 2026-10-19] how the query embedding was obtained, for the outcome
  try {
    assertCatalogLookupCurrent(signal);
    const embedded = options?.embedQuery ? await options.embedQuery(query) : { vector: await embedQuery(query), cached: false }; queryEmbedding = embedded.vector; embedding = embedded.cached ? "cached" : "called"; // [PR-L6, 2026-10-19] in place: the injected embedder, else this module's
    assertCatalogLookupCurrent(signal);
  } catch (error) {
    // A cancelled generation must not degrade into another retrieval stage.
    assertCatalogLookupCurrent(signal);
    embedding = "failed"; console.warn("[parts-search] embedding provider unavailable; using lexical-only recall:", error instanceof Error ? error.message : String(error));
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
    lifecycleStatus: partLifecycleStatus,
    similarity,
  };

  // --- Stage 1a: vector recall (HNSW, semantic) ---
  assertCatalogLookupCurrent(signal);
  const vectorRows: SearchRow[] = distance
    ? await db
        .select(baseSelect)
        .from(parts)
        .innerJoin(libraries, eq(parts.libraryId, libraries.id))
        .where(baseWhere)
        .orderBy(distance)
        .limit(VECTOR_POOL)
    : [];
  assertCatalogLookupCurrent(signal);

  // --- Stage 1b: lexical recall (exact tokens over name/mpn/keywords) ---
  // The cosine `similarity` is still computed here so fused rows carry a real
  // score regardless of which ranker surfaced them. The table is small (~22k
  // rows); if this scan ever becomes hot, a pg_trgm GIN index is the next step.
  const tokens = lexicalTokens(query);
  let lexicalRows: SearchRow[] = [];
  if (tokens.length > 0) {
    assertCatalogLookupCurrent(signal);
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
    assertCatalogLookupCurrent(signal);
  }

  // --- Stage 1c: authority recall (parts that can actually be manufactured) ---
  // Text similarity alone can bury a part that has proven symbol/footprint/
  // pin-pad authority beneath dozens of unbuildable near-matches. Give those
  // parts their own recall channel so a manufacturable option is always a
  // candidate whenever it matches the query at all.
  let authorityRows: SearchRow[] = [];
  if (tokens.length > 0) {
    assertCatalogLookupCurrent(signal);
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
      .where(and(categoryWhere, anyToken, selectableRevisionIdSql(partsAtomicLinks.atomicPartRevisionId))) // [B19-E E3] selectable authority only
      .groupBy(parts.id, libraries.mainCategory)
      .orderBy(desc(authScore))
      .limit(AUTHORITY_POOL);
    assertCatalogLookupCurrent(signal);
  }

  // --- Stage 1d: Reciprocal Rank Fusion ---
  // [PR-L, 2026-10-17] `relevance` keeps the vector and lexical evidence apart from the authority channel's: that channel ranks only
  // published parts, so its places say "published and shares a token", not "relevant" - it decides candidacy (recall), never order.
  const fused = new Map<string, { row: SearchRow; score: number; relevance: number }>();
  const accumulate = (rows: SearchRow[], relevant: boolean) => {
    rows.forEach((row, idx) => {
      const inc = 1 / (RRF_K + idx + 1);
      const existing = fused.get(row.id);
      if (existing) {
        existing.score += inc;
        if (relevant) existing.relevance += inc;
      } else fused.set(row.id, { row, score: inc, relevance: relevant ? inc : 0 });
    });
  };
  accumulate(vectorRows, true);
  accumulate(lexicalRows, true);
  accumulate(authorityRows, false);

  // Annotate the FULL fused set before trimming, so the order below sees every
  // candidate's physical authority. [PR-L, 2026-10-17] Authority no longer
  // outranks relevance: with the reranker refused (every search on 2026-10-17)
  // published passives sharing one token were hoisted above every relevant
  // MOSFET or MCU, and blocks searched for 11-12 turns (limit-and-stall-map.md
  // section 4). A published part now breaks ties inside a relevance band
  // (`relevanceBandedOrder`), for the reranker's pool and the fallback alike.
  const fusedAll = [...fused.values()]
    .sort((a, b) => b.score - a.score)
    .map((entry) => toAiPart(entry.row));
  assertCatalogLookupCurrent(signal);
  const report = (rerank: RerankDisposition) => options?.onOutcome?.({ category: categoryResolution, ranking: rerank.state === "used" ? "reranked" : "fused", rerank, ...(embedding ? { embedding } : {}) });
  if (fusedAll.length === 0) {
    report({ state: "not_needed" });
    return [];
  }
  const annotated = await attachOrderableValues(db, fusedAll, signal);
  assertCatalogLookupCurrent(signal);
  const relevance = new Map([...fused.values()].map((entry) => [entry.row.id, entry.relevance] as const));
  const candidates = relevanceBandedOrder(annotated, relevance).slice(0, CANDIDATE_POOL);

  // --- Stage 2 + 3: rerank for the role, then trim ---
  const { ordered, rerank } = await rerankParts(query, candidates, limit, signal, options?.rerankMemo ?? PROCESS_RERANK_REFUSAL_MEMO);
  assertCatalogLookupCurrent(signal);
  report(rerank);
  return ordered.slice(0, limit);
}

/**
 * Annotate results with the values that have published exact-part authority.
 * A part with no links is left untouched (the field stays absent) so the agent
 * only sees the constraint where one genuinely exists.
 */
async function attachOrderableValues(
  db: ReturnType<typeof getDb>,
  results: AiPartResult[],
  signal?: AbortSignal,
): Promise<AiPartResult[]> {
  assertCatalogLookupCurrent(signal);
  const ids = results.map((item) => item.partId);
  if (ids.length === 0) return results;
  const links = await db
    .select({ partId: partsAtomicLinks.partId, valueKey: partsAtomicLinks.valueKey, footprintFullName: partsAtomicLinks.footprintFullName })
    .from(partsAtomicLinks)
    .where(and(inArray(partsAtomicLinks.partId, ids), selectableRevisionIdSql(partsAtomicLinks.atomicPartRevisionId))); // [B19-E E3] a withdrawn revision is not orderable authority
  assertCatalogLookupCurrent(signal);
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
 * [PR-L, 2026-10-17] It also reports what happened (`RerankDisposition`) and
 * keeps `memo`: a non-transient refusal (quota or credit, authentication, model
 * access) is remembered, so later searches skip the call until its cooldown ends.
 */
async function rerankParts(
  query: string,
  candidates: AiPartResult[],
  limit: number,
  signal: AbortSignal | undefined,
  memo: RerankRefusalMemo,
): Promise<{ ordered: AiPartResult[]; rerank: RerankDisposition }> {
  assertCatalogLookupCurrent(signal);
  if (candidates.length <= 1) return { ordered: candidates, rerank: { state: "not_needed" } };

  let client: Anthropic;
  try {
    client = getAnthropic();
  } catch {
    assertCatalogLookupCurrent(signal);
    return { ordered: candidates, rerank: { state: "unavailable" } };
  }

  const list = rerankCandidatePayload(candidates);
  // [PR-L, 2026-10-17] a remembered refusal skips the call - no request, no charge - until its cooldown ends; then ONE search probes
  const admission = memo.admit();
  if (admission.decision === "skip") return { ordered: candidates, rerank: { state: "skipped", reason: admission.reason, probeAfterMs: admission.probeAfterMs } };
  let answered = false;

  try {
    const resp = await recordedRerank(client, { // [B24-C1] D24-21, OD-207: the SDK call through the call-record seam (`recordedRerank`, at the end of this file)
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
    }, signal);
    answered = true;
    memo.recordAnswer(); // [PR-L, 2026-10-17] the provider answered: a remembered refusal is over (a genuine recovery)
    assertCatalogLookupCurrent(signal);

    const toolUse = resp.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    const ranking = (toolUse?.input as { ranking?: unknown } | undefined)?.ranking;
    if (!Array.isArray(ranking)) return { ordered: candidates, rerank: { state: "failed" } };

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
    return { ordered, rerank: { state: "used" } };
  } catch (error) {
    if (!answered) {
      // [PR-L, 2026-10-17] an abort is never a refusal; a transient or unknown failure is not remembered and releases a probe
      const reason = signal?.aborted ? null : rerankRefusalReason(error);
      if (reason) {
        memo.recordRefusal(reason);
        console.warn(`[parts-search] the optional reranker was refused (${reason}); searches keep the relevance-banded fused order and skip it for ${Math.round(memo.cooldownMs / 60_000)} min, then one search probes it again`);
      } else memo.release(admission.decision === "probe");
      assertCatalogLookupCurrent(signal);
      if (reason) return { ordered: candidates, rerank: { state: "refused", reason } };
    }
    assertCatalogLookupCurrent(signal);
    return { ordered: candidates, rerank: { state: "failed" } };
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
  options?: { signal?: AbortSignal },
): Promise<AiAlternateResult[]> {
  assertCatalogLookupCurrent(options?.signal);
  if (!partId) return [];
  const db = getDb();

  const kindWhere: SQL | undefined = kind === "all" ? undefined : eq(alternates.kind, kind);

  const rows = await db
    .select({
      partId: parts.id,
      name: parts.name,
      mpn: parts.mpn,
      manufacturer: parts.manufacturer,
      lifecycleStatus: partLifecycleStatus,
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
  assertCatalogLookupCurrent(options?.signal);

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

// [B24-C1] D24-21, OD-207: the rerank call through the call-record seam, appended after the last line - an import and a function
// declaration are hoisted, so no line cited in this file moves. `rerankParts` obtains the client first: without a key there is no
// call and no record. One record per SDK call; the SDK's own retries are not visible here.
import { recordModelCall, type ModelCallUsage } from "@/app/lib/observability/llm-call-record";

function recordedRerank(client: Anthropic, body: Anthropic.MessageCreateParamsNonStreaming, signal?: AbortSignal): Promise<Anthropic.Message> {
  assertCatalogLookupCurrent(signal);
  // Preserve the historical one-argument SDK call when no signal was supplied.
  const requestOptions: [options?: { signal: AbortSignal }] = signal ? [{ signal }] : [];
  return recordModelCall({ provider: "anthropic", model: RERANK_MODEL, kind: "rerank", usage: rerankUsage }, () => {
    assertCatalogLookupCurrent(signal);
    return client.messages.create(body, ...requestOptions);
  });
}
/** What a call record keeps of a rerank answer: its model and token counts, never its ranking. */
function rerankUsage(message: Anthropic.Message): ModelCallUsage {
  return { model: message.model, inputTokens: message.usage?.input_tokens, outputTokens: message.usage?.output_tokens };
}

/** Stop follow-up catalog work without echoing a caller's arbitrary abort reason.
 * An already-running SQL/embedding operation is not claimed to be cancelled. */
function assertCatalogLookupCurrent(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("The catalog lookup was cancelled.", "AbortError");
}

// ─── [PR-L, 2026-10-17] Category vocabulary, relevance band and reranker refusal memo (runbook L.6) ─────────────────────────────
// Appended after the last line on purpose: these imports and declarations are read only when a search runs, by which time the whole
// module has been evaluated, so no line cited in this file moves (app/lib/deployment/configuration.ts cites :215 and :222).
import { resolveMainCategory, type MainCategoryResolution } from "@/app/lib/kicad/categories";
import { toProviderError } from "@/app/lib/llm/errors";
import { unfrozenNowMs } from "@/app/lib/fixture-runtime/clock";

/** What the optional reranker did on one search. */
export type RerankDisposition =
  /** it ordered the pool */
  | { state: "used" }
  /** fewer than two candidates: nothing to order, no call */
  | { state: "not_needed" }
  /** no reranker key is configured: no call */
  | { state: "unavailable" }
  /** a remembered refusal: no call until `probeAfterMs` */
  | { state: "skipped"; reason: RerankRefusalReason; probeAfterMs: number }
  /** this call was refused; the memo now remembers it */
  | { state: "refused"; reason: RerankRefusalReason }
  /** a transient failure or an unusable answer: nothing is remembered */
  | { state: "failed" };

/** How one search ran, for a caller that reports it (the Build loop's tool result; a generation task's counters). */
export interface PartsSearchOutcome {
  category: MainCategoryResolution;
  /** "reranked": the reranker ordered the results; "fused": the relevance-banded fused order, the truthful fallback */
  ranking: "reranked" | "fused";
  rerank: RerankDisposition;
  /** [PR-L6, 2026-10-19] how the query embedding was obtained: a provider call, a cached vector (no call), or a failed call (lexical-only
   *  recall followed); absent when the search embedded nothing */
  embedding?: "called" | "cached" | "failed";
  /** [PR-L6, 2026-10-19] answered from a generation task's facts: nothing reached the catalog, the embedder or the reranker */
  cached?: boolean;
}
/** [PR-L6, 2026-10-19] What a caller's query embedder answers: the vector and whether a cache supplied it (no provider call). */
export interface QueryEmbedding { vector: number[]; cached: boolean }

/**
 * The relevance band. A part's relevance is the sum of its reciprocal ranks in the vector and lexical channels (never the authority
 * channel's). A published (verified) part is ordered ahead of an unverified part only when its relevance is at least
 * VERIFIED_RELEVANCE_BAND (90 %) of that part's; outside the band relevance decides. Equivalently, each verified part's relevance is
 * divided by 0.9 before one stable sort; an exact tie keeps verified first, then the fused order. So an irrelevant verified part is
 * never placed above a relevant unverified one, while of two parts that fit the role about equally well the one that can reach a
 * manufactured board comes first.
 */
export const VERIFIED_RELEVANCE_BAND = 0.9;

export function relevanceBandedOrder(parts: readonly AiPartResult[], relevance: ReadonlyMap<string, number>): AiPartResult[] {
  return parts
    .map((part, index) => {
      const verified = part.physicalAuthority === "verified";
      return { part, index, verified, key: (relevance.get(part.partId) ?? 0) / (verified ? VERIFIED_RELEVANCE_BAND : 1) };
    })
    .sort((a, b) => b.key - a.key || Number(b.verified) - Number(a.verified) || a.index - b.index)
    .map((entry) => entry.part);
}

/** How long a non-transient reranker refusal is remembered before one search probes again; a later genuine recovery is seen then. */
export const RERANK_REFUSAL_COOLDOWN_MS = 10 * 60_000;
/** The refusals worth remembering: the account or key cannot be served until a person acts (the llm/errors.ts reasons). */
export type RerankRefusalReason = "insufficient_quota" | "authentication" | "model_access";
const REMEMBERED_RERANK_REFUSALS: ReadonlySet<string> = new Set<RerankRefusalReason>(["insufficient_quota", "authentication", "model_access"]);

function rerankRefusalReason(error: unknown): RerankRefusalReason | null {
  const { reason } = toProviderError("anthropic", error);
  return REMEMBERED_RERANK_REFUSALS.has(reason) ? (reason as RerankRefusalReason) : null;
}

/**
 * [PR-L, 2026-10-17] Remembers a non-transient reranker refusal for a bounded cooldown. Before, the reranker was called on every
 * search with two or more candidates and refused every time (322 of 322 on 2026-10-17, 119-628 ms each), and nothing remembered it.
 * `admit` answers "call" (nothing remembered), "skip" (a refusal is remembered and its cooldown runs, or another search is probing)
 * or "probe" (the cooldown is over: this one search calls while the others keep skipping). An answer clears the memo (a genuine
 * recovery), a refusal re-arms it, anything else releases the probe. Searches already in flight when the first refusal lands were
 * admitted before it and still call, so a concurrent first wave is bounded by the searches in flight. The clock is the real wall
 * clock (`unfrozenNowMs`: the fixture runtime freezes `Date.now()`, which would never end a cooldown). A process keeps one memo by
 * default; a generation task can inject its own through `searchPartsForAI`'s `rerankMemo`. Which provider is called is unchanged.
 */
export class RerankRefusalMemo {
  readonly cooldownMs: number;
  private readonly now: () => number;
  private refusal: { reason: RerankRefusalReason; probeAfterMs: number } | null = null;
  private probing = false;

  constructor(options: { cooldownMs?: number; now?: () => number } = {}) {
    this.cooldownMs = Math.max(1, Math.floor(options.cooldownMs ?? RERANK_REFUSAL_COOLDOWN_MS));
    this.now = options.now ?? unfrozenNowMs;
  }

  admit(): { decision: "call" | "probe" } | { decision: "skip"; reason: RerankRefusalReason; probeAfterMs: number } {
    if (!this.refusal) return { decision: "call" };
    if (this.probing || this.now() < this.refusal.probeAfterMs) return { decision: "skip", reason: this.refusal.reason, probeAfterMs: this.refusal.probeAfterMs };
    this.probing = true;
    return { decision: "probe" };
  }

  recordRefusal(reason: RerankRefusalReason): void {
    this.refusal = { reason, probeAfterMs: this.now() + this.cooldownMs };
    this.probing = false;
  }

  recordAnswer(): void {
    this.refusal = null;
    this.probing = false;
  }

  /** A call that ended with neither an answer nor a refusal (a transient failure, an abort): a probe is released for the next search. */
  release(wasProbe: boolean): void {
    if (wasProbe) this.probing = false;
  }

  /** The remembered refusal, if any (diagnostics and tests). */
  remembered(): { reason: RerankRefusalReason; probeAfterMs: number } | null {
    return this.refusal ? { ...this.refusal } : null;
  }
}

const PROCESS_RERANK_REFUSAL_MEMO = new RerankRefusalMemo();
/** The process-wide memo `searchPartsForAI` uses when its caller injects none. */
export function processRerankRefusalMemo(): RerankRefusalMemo {
  return PROCESS_RERANK_REFUSAL_MEMO;
}

// ─── [PR-L6, 2026-10-19] The catalog epoch (L.6 part 2, item 2b), appended after the last line so no cited line moves ────────────
// A generation task's cached lookups are keyed by the catalog identity they were answered under: a part published or withdrawn while
// the task runs (M2 publication writes parts and link rows; a revision status event withdraws one) changes the epoch, so the cached
// lookups miss and the next search sees the catalog as it is now. One cheap read; the production port memoizes it (build-loop.ts).

/** The catalog's identity now: the published links (count, newest), the revision status events (count, newest) and the newest library
 *  ingestion, as one identifier (`pg1-...`, no whitespace). */
export async function readCatalogEpoch(): Promise<string> {
  const db = getDb();
  const ms = (column: SQL) => sql<string>`coalesce(floor(extract(epoch from max(${column})) * 1000), 0)::bigint::text`;
  const [links] = await db.select({ n: sql<string>`count(*)::bigint::text`, at: ms(sql`${partsAtomicLinks.createdAt}`) }).from(partsAtomicLinks);
  const [events] = await db.select({ n: sql<string>`count(*)::bigint::text`, at: ms(sql`${atomicRevisionStatusEvents.at}`) }).from(atomicRevisionStatusEvents);
  const [ingested] = await db.select({ at: ms(sql`${libraries.ingestedAt}`) }).from(libraries);
  const part = (value: unknown): string => (/^\d{1,19}$/.test(String(value ?? "")) ? String(value) : "0");
  return `pg1-${part(links?.n)}-${part(links?.at)}-${part(events?.n)}-${part(events?.at)}-${part(ingested?.at)}`;
}
