/**
 * Mouser Search API client.
 * https://www.mouser.com/api-hub/  ·  POST /api/v1/search/partnumber?apiKey=…
 *
 * Simpler than DigiKey — a single API key, no OAuth. The free tier allows
 * 30 requests/minute, so requests are serialized through a 2s-spaced queue.
 * Per-MPN failures resolve to null (logged) rather than throwing, so one bad
 * part never sinks a whole batch.
 *
 * This client always performs a live fetch and never memoizes. [B19-A I3] Mouser's API
 * terms prohibit caching or storing its content, so the offer cache one layer up
 * never persists it either, and the source is DISABLED in the registry (OD-32).
 */

import {
  asArray,
  asNumber,
  asRecord,
  asString,
  cheapestUnitPrice,
  type DistributorClient,
  type LookupBatchOptions,
  type PartPricing,
  type PriceBreak,
} from "./types";
import { mapLifecycleString } from "./lifecycle";
import { distributorJson, type DistributorEgress } from "./egress"; // [B19-B I1] the bounded, validated egress path
import { describeFailure, DistributorRequestError } from "./types";
import { SOURCE_REGISTRY } from "../acquisition/source-registry";
import { makeCoalescer } from "../acquisition/admission-control";
import { canonicalExactMpn, sameExactMpn } from "../atomic/identity";

const SEARCH_URL = "https://api.mouser.com/api/v1/search/partnumber";
// [B19-A I3] the registry derives this from Mouser's documented 30 requests a minute (60 000 ms / 30).
const MIN_REQUEST_SPACING_MS = SOURCE_REGISTRY.mouser.resilience.minRequestSpacingMs;

export function makeMouserClient(opts: { apiKey: string; egress?: DistributorEgress }): DistributorClient {
  const { apiKey } = opts;
  const egress = opts.egress ?? {};
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

  async function search(mpn: string): Promise<{ value: unknown; contentHash: string; retrievedAt: number }> {
    // Mouser's documented Search API authenticates with the `apiKey` query parameter. The boundary treats it as a secret:
    // it is never logged, never in a message, and a request carrying it is never redirected.
    const res = await distributorJson("mouser", {
      url: `${SEARCH_URL}?apiKey=${encodeURIComponent(apiKey)}`,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        SearchByPartRequest: { mouserPartNumber: mpn, partSearchOptions: "string" },
      }),
    }, egress);
    if (!res.ok) throw new DistributorRequestError(`Mouser search failed: ${res.message}`);
    return { value: res.value, contentHash: res.contentHash, retrievedAt: res.retrievedAt };
  }

  async function lookupByMpn(mpn: string): Promise<PartPricing | null> {
    try {
      const answer = await enqueue(() => search(mpn));
      const pricing = mapPart(mpn, answer.value);
      // [B19-C I4] pin the result to the exact bytes Mouser sent (the bytes themselves are never kept)
      return pricing ? { ...pricing, evidence: { rawContentHash: answer.contentHash, retrievedAt: answer.retrievedAt }, provenance: { servedFrom: "live" as const, retrievedAt: answer.retrievedAt } } : null;
    } catch (err) {
      // [B19-B I1] only the boundary's own redacted sentence is ever logged — never the raw error or the request URL.
      console.error(`[mouser] lookup failed: ${describeFailure(err)}`);
      return null;
    }
  }

  // [B19-B I3b] a second identical lookup already in flight joins the first instead of paying for its own search
  const coalesce = makeCoalescer<PartPricing | null>();
  const lookup = (mpn: string): Promise<PartPricing | null> => coalesce(inFlightKey(mpn), () => lookupByMpn(mpn));

  // [B19-E E6] Mouser is disabled (OD-32) and never asked for the agent: an agent purpose is refused, never metered as a person's
  async function lookupBatch(mpns: string[], options: LookupBatchOptions = {}): Promise<Map<string, PartPricing>> {
    if (options.purpose === "agent") return new Map();
    const unique = [...new Set(mpns.filter((m) => m.trim() !== ""))];
    const entries = await Promise.all(
      unique.map(async (mpn): Promise<[string, PartPricing] | null> => {
        const pricing = await lookup(mpn);
        return pricing ? [mpn, pricing] : null;
      }),
    );
    return new Map(entries.filter((e): e is [string, PartPricing] => e !== null));
  }

  return { name: "mouser", lookupByMpn: lookup, lookupBatch };
}

/** [B19-D I5b review] identical requests join; a confusable spelling only ever joins its own byte-identical twin */
function inFlightKey(mpn: string): string {
  try {
    return canonicalExactMpn(mpn);
  } catch {
    return `\u0000raw:${mpn}`;
  }
}

// ─── Response mapping ──────────────────────────────────────────────────────────

function mapPart(requestedMpn: string, json: unknown): PartPricing | null {
  const root = asRecord(json);
  const searchResults = asRecord(root.SearchResults);
  const parts = asArray(searchResults.Parts);
  if (parts.length === 0) return null;

  // [B19-D I5b row 01] only the part whose published MPN IS the requested one — never the first result as a stand-in
  const exact = parts.find((p) => sameExactMpn(asString(asRecord(p).ManufacturerPartNumber), requestedMpn));
  if (!exact) return null;
  const part = asRecord(exact);

  const priceBreaks = mapPriceBreaks(asArray(part.PriceBreaks));
  const lifecycleRaw = asString(part.LifecycleStatus);

  return {
    distributor: "mouser",
    mpn: asString(part.ManufacturerPartNumber)!,
    manufacturer: asString(part.Manufacturer),
    description: asString(part.Description),
    datasheet: asString(part.DataSheetUrl),
    // AvailabilityInStock is a string like "1234" / "1,234"; asNumber reads only an unambiguous form.
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
