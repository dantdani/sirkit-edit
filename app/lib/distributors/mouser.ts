/**
 * Mouser Search API client.
 * https://www.mouser.com/api-hub/  ·  POST /api/v1/search/partnumber?apiKey=…
 *
 * Simpler than DigiKey — a single API key, no OAuth. The free tier allows
 * 30 requests/minute, so requests are serialized through a 2s-spaced queue.
 * Per-MPN failures resolve to null (logged) rather than throwing, so one bad
 * part never sinks a whole batch.
 *
 * Caching is handled one layer up by the aggregator (DB-backed part_offers +
 * a small request-scope LRU), so this client always performs a live fetch.
 */

import {
  asArray,
  asNumber,
  asRecord,
  asString,
  cheapestUnitPrice,
  type DistributorClient,
  type PartPricing,
  type PriceBreak,
} from "./types";
import { mapLifecycleString } from "./lifecycle";

const SEARCH_URL = "https://api.mouser.com/api/v1/search/partnumber";
// 30 req/min on the free tier → a 2s minimum spacing keeps us comfortably under.
const MIN_REQUEST_SPACING_MS = 2000;

export function makeMouserClient(opts: { apiKey: string }): DistributorClient {
  const { apiKey } = opts;
  if (!apiKey) {
    throw new Error("MOUSER_API_KEY not configured");
  }

  // ── 2s-spaced request queue (30 req/min ceiling) ───────────────────────────
  let queueTail: Promise<unknown> = Promise.resolve();
  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = queueTail.then(async () => {
      const result = await task();
      await delay(MIN_REQUEST_SPACING_MS);
      return result;
    });
    queueTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async function search(mpn: string): Promise<unknown> {
    const res = await fetch(`${SEARCH_URL}?apiKey=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        SearchByPartRequest: { mouserPartNumber: mpn, partSearchOptions: "string" },
      }),
    });
    if (!res.ok) {
      throw new Error(`Mouser search failed for "${mpn}" (${res.status})`);
    }
    return res.json();
  }

  async function lookupByMpn(mpn: string): Promise<PartPricing | null> {
    try {
      const json = await enqueue(() => search(mpn));
      return mapPart(mpn, json);
    } catch (err) {
      console.error(`[mouser] lookup failed for ${mpn}:`, err);
      return null;
    }
  }

  async function lookupBatch(mpns: string[]): Promise<Map<string, PartPricing>> {
    const unique = [...new Set(mpns.filter((m) => m.trim() !== ""))];
    const entries = await Promise.all(
      unique.map(async (mpn): Promise<[string, PartPricing] | null> => {
        const pricing = await lookupByMpn(mpn);
        return pricing ? [mpn, pricing] : null;
      }),
    );
    return new Map(entries.filter((e): e is [string, PartPricing] => e !== null));
  }

  return { name: "mouser", lookupByMpn, lookupBatch };
}

// ─── Response mapping ──────────────────────────────────────────────────────────

function mapPart(requestedMpn: string, json: unknown): PartPricing | null {
  const root = asRecord(json);
  const searchResults = asRecord(root.SearchResults);
  const parts = asArray(searchResults.Parts);
  if (parts.length === 0) return null;

  // Prefer an exact (case-insensitive) MPN match; fall back to the first result.
  const wanted = requestedMpn.trim().toLowerCase();
  const exact = parts.find(
    (p) => asString(asRecord(p).ManufacturerPartNumber)?.toLowerCase() === wanted,
  );
  const part = asRecord(exact ?? parts[0]);

  const priceBreaks = mapPriceBreaks(asArray(part.PriceBreaks));
  const lifecycleRaw = asString(part.LifecycleStatus);

  return {
    distributor: "mouser",
    mpn: asString(part.ManufacturerPartNumber) ?? requestedMpn,
    manufacturer: asString(part.Manufacturer),
    description: asString(part.Description),
    datasheet: asString(part.DataSheetUrl),
    // AvailabilityInStock is a string like "1234" / "1,234"; asNumber strips it.
    inStock: asNumber(part.AvailabilityInStock),
    minOrderQty: asNumber(part.MinOrderQty) ?? asNumber(part.Mult),
    priceBreaks,
    bestUnitPrice: cheapestUnitPrice(priceBreaks),
    productUrl: asString(part.ProductDetailUrl),
    package: null,
    sku: asString(part.MouserPartNumber),
    lifecycleStatus: mapLifecycleString(lifecycleRaw),
    lifecycleRaw,
    fetchedAt: Date.now(),
  };
}

function mapPriceBreaks(raw: unknown[]): PriceBreak[] {
  const breaks: PriceBreak[] = [];
  for (const entry of raw) {
    const rec = asRecord(entry);
    const qty = asNumber(rec.Quantity);
    // Price arrives as "$0.34" or "0.34"; asNumber handles the currency prefix.
    const price = asNumber(rec.Price);
    if (qty === null || price === null) continue;
    breaks.push({ qty, price, currency: asString(rec.Currency) ?? "USD" });
  }
  return breaks.sort((a, b) => a.qty - b.qty);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
