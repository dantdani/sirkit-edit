/**
 * Pricing caches: an in-memory per-MPN memo, and the persistent `part_offers` table.
 *
 * [B19-A I3] How long an offer may be served and kept is no longer chosen here: it comes from the source registry
 * (`app/lib/acquisition/source-registry.ts`), which records each vendor's current terms.
 *   - DigiKey: served 1 h, kept 1 h (no database may be built from its data; retention unstated — OD-33).
 *   - Octopart via Nexar: served and kept at most 24 h, the limit its terms set.
 *   - Mouser: never memoized, never persisted — its terms prohibit caching or storing its content.
 *   - an unregistered source: never served, and purged.
 * Every reader of stored offers applies `isOfferServable`, and `purgeExpiredOffers` deletes what may no longer be kept.
 */

import { and, eq, gte, inArray, isNotNull, lt, ne, not, or } from "drizzle-orm";
import { getDb } from "../db/client";
import { partOffers, parts, type PartOffer } from "../db/schema";
import { cheapestUnitPrice, type DistributorName, type PartPricing, type PriceBreak } from "./types";
import { SOURCE_IDS, SOURCE_REGISTRY, sourceForDistributorName } from "../acquisition/source-registry";
import { canonicalExactMpn } from "../atomic/identity";

export const STOCK_TTL_MS = 60 * 60 * 1000; // 1 hour
export const PRICING_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
export const METADATA_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days (informational)


/**
 * Per-distributor effective TTL. [B19-A I3] Taken from the source registry: DigiKey 1 h, Nexar 24 h (its terms' storage
 * limit), and 0 — never cached — for a source whose terms prohibit storage (Mouser) or that is not registered.
 */
export function ttlFor(distributor: DistributorName | string): number {
  const entry = sourceForDistributorName(distributor);
  return entry && entry.license.storage === "bounded" ? entry.freshness.offerTtlMs : 0;
}

type Entry = { value: PartPricing; expiresAt: number };

const store = new Map<string, Entry>();

/**
 * [B19-D I5b review] A memo key is the canonical exact MPN; a confusable spelling has no key and is never memoized, so it can
 * never be answered from the plain MPN's entry (Unicode case-folding turned a Kelvin sign K into k).
 */
function keyOf(distributor: DistributorName | string, mpn: string): string | null {
  try {
    return `${distributor}:${canonicalExactMpn(mpn)}`;
  } catch {
    return null;
  }
}

/** [B19-D I5b review] "The vendor has no exact product for this MPN", remembered for the source's freshness. */
const noExactMatch = new Map<string, number>();

export function rememberNoExactMatch(distributor: DistributorName, mpn: string): void {
  const key = keyOf(distributor, mpn);
  const ttl = ttlFor(distributor);
  if (key && ttl > 0) noExactMatch.set(key, Date.now() + ttl);
}

export function isKnownNoExactMatch(distributor: DistributorName, mpn: string): boolean {
  const key = keyOf(distributor, mpn);
  if (!key) return false;
  const until = noExactMatch.get(key);
  if (until === undefined) return false;
  if (Date.now() >= until) {
    noExactMatch.delete(key);
    return false;
  }
  return true;
}

/** [B19-E E1] When the vendor answered: the recorded retrieval, else the fetch time; never later than now. */
export function offerRetrievedAt(offer: PartPricing, now: number = Date.now()): number {
  const at = offer.provenance?.retrievedAt ?? offer.evidence?.retrievedAt ?? offer.fetchedAt;
  return Number.isFinite(at) ? Math.min(at, now) : now;
}

/** Fresh cached value for this distributor+mpn, or null on miss/expiry. [B19-E E1] Labelled as a memo answer. */
export function getCached(distributor: DistributorName, mpn: string): PartPricing | null {
  const key = keyOf(distributor, mpn);
  if (!key) return null;
  const hit = store.get(key);
  if (!hit) return null;
  if (Date.now() >= hit.expiresAt) {
    store.delete(key);
    return null;
  }
  return { ...hit.value, provenance: { servedFrom: "process-memo", retrievedAt: offerRetrievedAt(hit.value) } };
}

export function setCached(distributor: DistributorName, mpn: string, value: PartPricing): void {
  if (ttlFor(distributor) <= 0) return; // [B19-A I3] a source whose terms prohibit storage is never memoized
  const key = keyOf(distributor, mpn);
  if (!key) return;
  // [B19-E E1] the memo expires a freshness window after the vendor answered, not after it was memoized
  const expiresAt = offerRetrievedAt(value) + ttlFor(distributor);
  if (expiresAt <= Date.now()) return;
  store.set(key, { value, expiresAt });
}

/** Drop a single in-memory entry — used by forceRefresh to compel a live fetch. */
export function evictCached(distributor: DistributorName, mpn: string): void {
  const key = keyOf(distributor, mpn);
  if (!key) return;
  store.delete(key);
  noExactMatch.delete(key); // a forced refresh asks the vendor again
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
      if (isKnownNoExactMatch(distributor, mpn)) return null; // [B19-D I5b review] remembered: no exact product
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
  noExactMatch.clear();
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
  // [B19-A I3] never past the source's own freshness: a memo may not outlive what the offer cache itself would serve
  const sourceExpiry = value.fetchedAt + ttlFor(value.distributor);
  if (sourceExpiry <= Date.now()) return;
  lru.set(key, { value, expiresAt: Math.min(Date.now() + LRU_TTL_MS, sourceExpiry) });
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
    mpn: row.mpn ?? "", // [B19-D I5b] the exact MPN stored with the offer; "" (never matches) for rows stored before 0029
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
    // [B19-E E1] a stored row was served from the offer cache; its stamp is when the vendor answered
    provenance: { servedFrom: "offer-cache", retrievedAt: row.lastRefreshedAt ? new Date(row.lastRefreshedAt).getTime() : 0 },
  };
}

/**
 * [B19-A I3] The ONE rule every reader of stored offers applies: a row is served only while it is within its source's
 * registered freshness. A no-storage source, an unregistered source and a row without a timestamp are never served.
 */
export function isOfferServable(distributor: string, lastRefreshedAt: Date | null, now: number = Date.now()): boolean {
  if (!lastRefreshedAt) return false;
  const ttl = ttlFor(distributor);
  if (ttl <= 0) return false;
  return now - new Date(lastRefreshedAt).getTime() < ttl;
}

/**
 * [B19-A I3] Delete every stored offer its source's terms no longer allow Sirkit to keep: rows older than a bounded
 * source's retention, and every row of a no-storage or unregistered source. Returns the number of rows deleted.
 */
export async function purgeExpiredOffers(now: Date = new Date()): Promise<number> {
  const db = getDb();
  const keep = SOURCE_IDS.map((id) => SOURCE_REGISTRY[id])
    .filter((entry) => entry.license.storage === "bounded" && entry.license.retentionMaxMs > 0)
    .map((entry) => and(eq(partOffers.distributor, entry.distributorName), gte(partOffers.lastRefreshedAt, new Date(now.getTime() - entry.license.retentionMaxMs))));
  const kept = or(...keep);
  const deleted = kept
    ? await db.delete(partOffers).where(not(kept)).returning({ id: partOffers.id })
    : await db.delete(partOffers).returning({ id: partOffers.id });
  // [B19-D I5b row 03] a lifecycle status the pricing layer derived from vendor offers (it stamps `last_refreshed_at`) expires
  // with them: its provenance mixes sources, so it is kept no longer than the STRICTEST bounded retention. KiCad-derived
  // statuses carry no stamp and are untouched.
  const strictest = Math.min(...SOURCE_IDS.map((id) => SOURCE_REGISTRY[id]).filter((entry) => entry.license.storage === "bounded" && entry.license.retentionMaxMs > 0).map((entry) => entry.license.retentionMaxMs));
  if (Number.isFinite(strictest)) {
    await db.update(parts)
      .set({ lifecycleStatus: "unknown", lastRefreshedAt: null })
      .where(and(isNotNull(parts.lastRefreshedAt), lt(parts.lastRefreshedAt, new Date(now.getTime() - strictest)), ne(parts.lifecycleStatus, "unknown")));
  }
  return deleted.length;
}

const PURGE_INTERVAL_MS = 5 * 60 * 1000;
let lastPurgeAt = 0;

/** Purge at most every five minutes per process, on the read path, so retention holds even when no job runs. */
async function purgeExpiredOffersThrottled(): Promise<void> {
  if (Date.now() - lastPurgeAt < PURGE_INTERVAL_MS) return;
  lastPurgeAt = Date.now();
  try {
    await purgeExpiredOffers();
  } catch (err) {
    console.error(`[distributors] offer purge failed (details withheld): ${err instanceof Error ? err.name : "non-error"}`);
  }
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
  if (!row || !isOfferServable(row.distributor, row.lastRefreshedAt)) return null;

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
  // [B19-A I3] only a source the registry allows to store is ever persisted (Mouser's terms prohibit storing its content)
  if (ttlFor(distributor) <= 0) return;
  const db = getDb();
  // [B19-E E1] stamped with when the vendor answered (a memo answer is not "now"), so freshness is measured from the answer
  const now = new Date(offerRetrievedAt(offer));
  const values = {
    partId,
    distributor,
    mpn: offer.mpn || null, // [B19-D I5b] the exact MPN the offer answers for
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
        mpn: values.mpn,
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
  lruSet(lruKey(partId, distributor), { ...offer, fetchedAt: now.getTime() });
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

  await purgeExpiredOffersThrottled();
  const db = getDb();
  const rows = await db.select().from(partOffers).where(inArray(partOffers.partId, ids));

  for (const row of rows) {
    if (!isOfferServable(row.distributor, row.lastRefreshedAt)) continue;
    let inner = out.get(row.partId);
    if (!inner) {
      inner = new Map<string, PartPricing>();
      out.set(row.partId, inner);
    }
    inner.set(row.distributor, offerRowToPricing(row));
  }
  return out;
}
