/**
 * In-memory pricing cache, keyed by `${distributor}:${mpn}`.
 *
 * The full distributor response (a `PartPricing`) is cached as one unit. The
 * spec calls for tiered freshness — stock 1h, pricing 24h, metadata 7d — but a
 * `PartPricing` bundles all three, and serving a half-stale object would mean
 * silently returning hour-old stock under a 24h pricing window. So we collapse
 * to a single, per-distributor TTL chosen to honor the *binding* constraint for
 * each source:
 *
 *   - DigiKey: STOCK_TTL (1h). Its 1000 req/day budget is generous, so we
 *     prefer fresh stock and refetch hourly.
 *   - Octopart: PRICING_TTL (24h). Its ~1000 queries/MONTH quota is the binding
 *     constraint, so we cache aggressively and tolerate day-old stock.
 *
 * In-memory only — resets on dev server restart. Production would move this to
 * Redis or the DB; not needed for the MVP.
 */

import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../db/client";
import { partOffers, type PartOffer } from "../db/schema";
import { cheapestUnitPrice, type DistributorName, type PartPricing, type PriceBreak } from "./types";

export const STOCK_TTL_MS = 60 * 60 * 1000; // 1 hour
export const PRICING_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
export const METADATA_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days (informational)

/** TTLs for the persistent (part_offers) cache. */
type CacheTTLs = { pricing: number };
const DEFAULT_TTLS: CacheTTLs = { pricing: 24 * 60 * 60 * 1000 }; // 24h

/** Per-distributor effective TTL. See the module doc for the rationale. */
export function ttlFor(distributor: DistributorName): number {
  return distributor === "digikey" ? STOCK_TTL_MS : PRICING_TTL_MS;
}

type Entry = { value: PartPricing; expiresAt: number };

const store = new Map<string, Entry>();

function keyOf(distributor: DistributorName, mpn: string): string {
  return `${distributor}:${mpn.toLowerCase()}`;
}

/** Fresh cached value for this distributor+mpn, or null on miss/expiry. */
export function getCached(distributor: DistributorName, mpn: string): PartPricing | null {
  const hit = store.get(keyOf(distributor, mpn));
  if (!hit) return null;
  if (Date.now() >= hit.expiresAt) {
    store.delete(keyOf(distributor, mpn));
    return null;
  }
  return hit.value;
}

export function setCached(distributor: DistributorName, mpn: string, value: PartPricing): void {
  store.set(keyOf(distributor, mpn), {
    value,
    expiresAt: Date.now() + ttlFor(distributor),
  });
}

/** Drop a single in-memory entry — used by forceRefresh to compel a live fetch. */
export function evictCached(distributor: DistributorName, mpn: string): void {
  store.delete(keyOf(distributor, mpn));
}

/**
 * Wrap a distributor's per-MPN lookup with read-through caching. The returned
 * function returns the cached `PartPricing` when fresh; otherwise it invokes
 * `fetcher`, caches a non-null result, and returns it. `mpnsToFetch` reports
 * how the last batch split between cache hits and live fetches, so the API
 * route can surface `{ cached, fetched }` counts.
 */
export function makeCachedLookup(
  distributor: DistributorName,
  fetcher: (mpn: string) => Promise<PartPricing | null>,
): {
  lookup: (mpn: string) => Promise<PartPricing | null>;
  wasCached: (mpn: string) => boolean;
} {
  return {
    async lookup(mpn: string): Promise<PartPricing | null> {
      const cached = getCached(distributor, mpn);
      if (cached) return cached;
      const fresh = await fetcher(mpn);
      if (fresh) setCached(distributor, mpn, fresh);
      return fresh;
    },
    wasCached(mpn: string): boolean {
      return getCached(distributor, mpn) !== null;
    },
  };
}

/** Test/maintenance hook — clears the whole cache. */
export function clearPricingCache(): void {
  store.clear();
}

// ─── Persistent (part_offers) cache ─────────────────────────────────────────--
// The DB is the source of truth for served pricing. A tiny request-scope LRU
// sits on top to avoid redundant DB reads within a single BOM page render.

const LRU_TTL_MS = 5 * 60 * 1000; // 5 minutes
const LRU_MAX = 200;
const lru = new Map<string, { value: PartPricing; expiresAt: number }>();

function lruKey(partId: string, distributor: string): string {
  return `${partId}:${distributor}`;
}

function lruGet(key: string): PartPricing | null {
  const hit = lru.get(key);
  if (!hit) return null;
  if (Date.now() >= hit.expiresAt) {
    lru.delete(key);
    return null;
  }
  // Refresh recency (Map keeps insertion order → re-insert moves to newest).
  lru.delete(key);
  lru.set(key, hit);
  return hit.value;
}

function lruSet(key: string, value: PartPricing): void {
  if (lru.has(key)) lru.delete(key);
  lru.set(key, { value, expiresAt: Date.now() + LRU_TTL_MS });
  while (lru.size > LRU_MAX) {
    const oldest = lru.keys().next().value;
    if (oldest === undefined) break;
    lru.delete(oldest);
  }
}

/** Reconstruct a PartPricing from a stored part_offers row. */
function offerRowToPricing(row: PartOffer): PartPricing {
  const priceBreaks = (row.priceBreaks ?? []) as PriceBreak[];
  return {
    // The union is wider than the stored string; the writers only ever persist
    // valid distributor names, so this cast is safe.
    distributor: row.distributor as PartPricing["distributor"],
    mpn: "", // unknown from the row alone — the aggregator fills it from input
    manufacturer: null,
    description: null,
    datasheet: null,
    inStock: row.stock ?? null,
    minOrderQty: row.minOrderQty ?? null,
    priceBreaks,
    bestUnitPrice: cheapestUnitPrice(priceBreaks),
    productUrl: row.productUrl ?? null,
    package: null,
    sku: row.distributorSku ?? null,
    lifecycleStatus: row.lifecycleStatus ?? "unknown",
    lifecycleRaw: row.lifecycleRaw ?? null,
    fetchedAt: row.lastRefreshedAt ? new Date(row.lastRefreshedAt).getTime() : Date.now(),
  };
}

function isFresh(lastRefreshedAt: Date | null): boolean {
  const ts = lastRefreshedAt ? new Date(lastRefreshedAt).getTime() : 0;
  return Date.now() - ts < DEFAULT_TTLS.pricing;
}

/**
 * Cached offer for (part, distributor) when present and within TTL; else null.
 * Checks the request-scope LRU first, then the part_offers table.
 */
export async function getCachedOffer(
  partId: string,
  distributor: string,
): Promise<PartPricing | null> {
  const key = lruKey(partId, distributor);
  const memo = lruGet(key);
  if (memo) return memo;

  const db = getDb();
  const rows = await db
    .select()
    .from(partOffers)
    .where(and(eq(partOffers.partId, partId), eq(partOffers.distributor, distributor)))
    .limit(1);

  const row = rows[0];
  if (!row || !isFresh(row.lastRefreshedAt)) return null;

  const pricing = offerRowToPricing(row);
  lruSet(key, pricing);
  return pricing;
}

/** Upsert one distributor offer for a part into part_offers (and the LRU). */
export async function putCachedOffer(
  partId: string,
  distributor: string,
  offer: PartPricing,
): Promise<void> {
  const db = getDb();
  const now = new Date();
  const values = {
    partId,
    distributor,
    distributorSku: offer.sku ?? null,
    priceBreaks: offer.priceBreaks,
    stock: offer.inStock ?? null,
    minOrderQty: offer.minOrderQty ?? null,
    leadTimeDays: null,
    productUrl: offer.productUrl ?? null,
    lifecycleStatus: offer.lifecycleStatus,
    lifecycleRaw: offer.lifecycleRaw ?? null,
    lastRefreshedAt: now,
  };
  await db
    .insert(partOffers)
    .values(values)
    .onConflictDoUpdate({
      target: [partOffers.partId, partOffers.distributor],
      set: {
        distributorSku: values.distributorSku,
        priceBreaks: values.priceBreaks,
        stock: values.stock,
        minOrderQty: values.minOrderQty,
        leadTimeDays: values.leadTimeDays,
        productUrl: values.productUrl,
        lifecycleStatus: values.lifecycleStatus,
        lifecycleRaw: values.lifecycleRaw,
        lastRefreshedAt: values.lastRefreshedAt,
      },
    });
  lruSet(lruKey(partId, distributor), offer);
}

/**
 * Bulk read for the BOM endpoint. Returns partId → (distributor → PartPricing),
 * including only entries within TTL.
 */
export async function getCachedOffersForParts(
  partIds: string[],
): Promise<Map<string, Map<string, PartPricing>>> {
  const out = new Map<string, Map<string, PartPricing>>();
  const ids = [...new Set(partIds)];
  if (ids.length === 0) return out;

  const db = getDb();
  const rows = await db.select().from(partOffers).where(inArray(partOffers.partId, ids));

  for (const row of rows) {
    if (!isFresh(row.lastRefreshedAt)) continue;
    let inner = out.get(row.partId);
    if (!inner) {
      inner = new Map<string, PartPricing>();
      out.set(row.partId, inner);
    }
    inner.set(row.distributor, offerRowToPricing(row));
  }
  return out;
}
