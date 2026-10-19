/**
 * [PR-L/M integration, 2026-10-18] The FIXTURE runtime's Build Library catalog reads: the category list (GET /api/parts/categories) and the
 * browse / search (POST /api/parts/search), answered from the committed fixture catalog the container holds - the SAME catalog every other
 * fixture catalog read serves (GET /api/parts/[id] through catalog-part-detail.ts, the agent's catalog reads through parts-search.ts).
 *
 * Root cause of "Could not load categories": the two routes read ONLY the database. Under the fixture runtime there is no DATABASE_URL, so
 * every Build Library load answered 500 (the panel's categories, then any category's parts); and with a database configured beside the
 * fixture runtime they would have listed parts the fixture's part reads do not know. Each route now consults the fixture runtime FIRST,
 * as the part detail read does (B16-C section 5), whatever the environment's database.
 *
 * The production semantics are mirrored: categories count every part of a main category, most-populated first; browse is alphabetical
 * by name with generic KiCad templates excluded unless asked for (the ingestion's own `isGenericPart` classifier); a non-empty query is
 * the routes' exact-token LEXICAL ranking (name or MPN 2, description 1) - the fixture runtime never asks an embedding provider.
 * Pure over the parts handed in: no database, provider, embedding or network.
 */
import type { CachedPart } from "@/app/lib/parts-cache";
import { isGenericPart } from "@/app/lib/parts-normalization";

export interface FixtureCatalogCategory { mainCategory: string; partCount: number }
export interface FixtureCatalogSearchInput { query: string; category: string | null; offset: number; limit: number; includeGenerics: boolean }
/** The search route's `PartSummary` (its BOM fields are not held by the fixture catalog: null, lifecycle "unknown" as parts-search.ts reports it). */
export interface FixtureCatalogSummary {
  id: string; name: string; description: string | null; keywords: string | null; mpn: string | null; manufacturer: string | null; datasheet: string | null;
  mainCategory: string; libraryName: string; pinCount: number; score: number;
  internalPartNumber: null; lifecycleStatus: "unknown"; rohsStatus: null; packageNormalized: null;
}

const byName = (a: CachedPart, b: CachedPart): number => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Every main category with its part count, most-populated first (ties by name, so the order is stable). */
export function fixtureCatalogCategories(parts: Iterable<CachedPart>): FixtureCatalogCategory[] {
  const counts = new Map<string, number>();
  for (const part of parts) counts.set(part.mainCategory, (counts.get(part.mainCategory) ?? 0) + 1);
  return [...counts].map(([mainCategory, partCount]) => ({ mainCategory, partCount })).sort((a, b) => b.partCount - a.partCount || (a.mainCategory < b.mainCategory ? -1 : a.mainCategory > b.mainCategory ? 1 : 0));
}

/** The routes' lexical tokens: lower-case alphanumeric runs of at least two characters, at most eight. */
function tokensOf(query: string): string[] {
  const tokens = [...new Set((query.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((token) => token.length >= 2))].slice(0, 8);
  return tokens.length > 0 ? tokens : [query.trim().toLowerCase()];
}

function lexicalScore(part: CachedPart, tokens: readonly string[]): number {
  const name = part.name.toLowerCase(), mpn = (part.mpn ?? "").toLowerCase(), description = (part.description ?? "").toLowerCase();
  return tokens.reduce((score, token) => score + (name.includes(token) || mpn.includes(token) ? 2 : description.includes(token) ? 1 : 0), 0);
}

function summaryOf(part: CachedPart, score: number): FixtureCatalogSummary {
  return {
    id: part.id, name: part.name, description: part.description, keywords: null, mpn: part.mpn, manufacturer: part.manufacturer, datasheet: part.datasheet,
    mainCategory: part.mainCategory, libraryName: part.libraryName, pinCount: Array.isArray(part.pins) ? part.pins.length : 0, score,
    internalPartNumber: null, lifecycleStatus: "unknown", rohsStatus: null, packageNormalized: null,
  };
}

/** Browse (empty query: alphabetical, score 0) or the lexical ranking (score desc, then name), within the category and the generic rule. */
export function fixtureCatalogSearch(parts: Iterable<CachedPart>, input: FixtureCatalogSearchInput): { results: FixtureCatalogSummary[]; total: number } {
  const scoped = [...parts].filter((part) => (input.category === null || part.mainCategory === input.category) && (input.includeGenerics || !isGenericPart({ name: part.name, libraryName: part.libraryName })));
  if (input.query === "") {
    const sorted = scoped.sort(byName);
    return { results: sorted.slice(input.offset, input.offset + input.limit).map((part) => summaryOf(part, 0)), total: scoped.length };
  }
  const tokens = tokensOf(input.query);
  const ranked = scoped.map((part) => ({ part, score: lexicalScore(part, tokens) })).filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score || byName(a.part, b.part));
  return { results: ranked.slice(input.offset, input.offset + input.limit).map((entry) => summaryOf(entry.part, entry.score)), total: scoped.length };
}
