/**
 * Distributor orchestrator — the single entry point the BOM layer calls. It
 * resolves a user's source choice to the configured distributor clients, serves
 * pricing from the persistent part_offers cache first, fetches only the misses
 * live, persists fresh responses, and aggregates per part into a best-overall
 * view across all queried sources.
 *
 * Re-exports the public surface so callers import everything from
 * "@/app/lib/distributors".
 */

import type { DistributorClient, DistributorName, PartPricing } from "./types";
import { makeDigiKeyClient } from "./digikey";
import { makeOctopartClient } from "./octopart";
import { makeMouserClient } from "./mouser";
import { evictCached, getCachedOffersForParts, putCachedOffer } from "./cache";

export type { PartPricing, PriceBreak, DistributorClient, DistributorName } from "./types";
export {
  getCachedOffer,
  putCachedOffer,
  getCachedOffersForParts,
} from "./cache";

// LCSC is excluded from the union until partner API access lands (stub throws).
export type DistributorChoice = "none" | "digikey" | "mouser" | "octopart" | "all";

export type AggregatedPricing = {
  partId: string;
  mpn: string;
  offers: PartPricing[]; // one entry per distributor that returned data
  bestOverall: PartPricing | null;
  sourcesQueried: string[]; // which distributors were actually called
  sourcesFromCache: number;
  sourcesFromLive: number;
};

// ── Lazy, process-wide client singletons ──────────────────────────────────────
// Built once so token caches and request queues persist across calls.
let digikeyClient: DistributorClient | null | undefined;
let octopartClient: DistributorClient | null | undefined;
let mouserClient: DistributorClient | null | undefined;

function getDigiKeyClient(): DistributorClient | null {
  if (digikeyClient !== undefined) return digikeyClient;
  const clientId = process.env.DIGIKEY_CLIENT_ID ?? "";
  const clientSecret = process.env.DIGIKEY_CLIENT_SECRET ?? "";
  try {
    digikeyClient = makeDigiKeyClient({ clientId, clientSecret });
  } catch {
    digikeyClient = null; // credentials not configured — handled gracefully
  }
  return digikeyClient;
}

function getOctopartClient(): DistributorClient | null {
  if (octopartClient !== undefined) return octopartClient;
  const apiKey = process.env.OCTOPART_API_KEY ?? process.env.NEXAR_API_KEY ?? "";
  try {
    octopartClient = makeOctopartClient({ apiKey });
  } catch {
    octopartClient = null;
  }
  return octopartClient;
}

function getMouserClient(): DistributorClient | null {
  if (mouserClient !== undefined) return mouserClient;
  const apiKey = process.env.MOUSER_API_KEY ?? "";
  try {
    mouserClient = makeMouserClient({ apiKey });
  } catch {
    mouserClient = null;
  }
  return mouserClient;
}

/** Does `choice` intend to query distributor `which`? */
function intends(choice: DistributorChoice, which: "digikey" | "mouser" | "octopart"): boolean {
  return choice === "all" || choice === which;
}

type ActiveSource = { name: DistributorName; client: DistributorClient };

/** Configured clients a choice resolves to (after credential checks). */
function activeSources(choice: DistributorChoice): ActiveSource[] {
  const out: ActiveSource[] = [];
  if (intends(choice, "digikey")) {
    const c = getDigiKeyClient();
    if (c) out.push({ name: "digikey", client: c });
  }
  if (intends(choice, "mouser")) {
    const c = getMouserClient();
    if (c) out.push({ name: "mouser", client: c });
  }
  if (intends(choice, "octopart")) {
    const c = getOctopartClient();
    if (c) out.push({ name: "octopart-aggregated", client: c });
  }
  return out;
}

/** Intended sources that lack configured credentials (for surfaced warnings). */
export function missingCredentials(choice: DistributorChoice): DistributorName[] {
  const missing: DistributorName[] = [];
  if (intends(choice, "digikey") && !getDigiKeyClient()) missing.push("digikey");
  if (intends(choice, "mouser") && !getMouserClient()) missing.push("mouser");
  if (intends(choice, "octopart") && !getOctopartClient()) missing.push("octopart-aggregated");
  return missing;
}

/**
 * Fetch pricing for a set of parts from the chosen source(s) and aggregate per
 * part. DB cache is consulted first (unless `forceRefresh`); only misses hit a
 * live API, and fresh responses are persisted. Never throws — provider failures
 * degrade to missing offers. Returns a map keyed by partId (only parts that got
 * at least one offer are present).
 */
export async function getPricingFor(
  parts: Array<{ partId: string; mpn: string }>,
  choice: DistributorChoice,
  opts: { forceRefresh?: boolean } = {},
): Promise<Map<string, AggregatedPricing>> {
  const result = new Map<string, AggregatedPricing>();
  if (choice === "none") return result;

  // Dedupe by partId; require a non-empty MPN.
  const items: Array<{ partId: string; mpn: string }> = [];
  const seen = new Set<string>();
  for (const p of parts) {
    if (!p.partId || !p.mpn || p.mpn.trim() === "" || seen.has(p.partId)) continue;
    seen.add(p.partId);
    items.push({ partId: p.partId, mpn: p.mpn });
  }
  if (items.length === 0) return result;

  const sources = activeSources(choice);
  if (sources.length === 0) return result;

  const forceRefresh = opts.forceRefresh === true;
  const sourceNames = sources.map((s) => s.name);

  // Seed an aggregation accumulator per part.
  for (const it of items) {
    result.set(it.partId, {
      partId: it.partId,
      mpn: it.mpn,
      offers: [],
      bestOverall: null,
      sourcesQueried: sourceNames,
      sourcesFromCache: 0,
      sourcesFromLive: 0,
    });
  }

  // One bulk cache read for every part (skipped entirely on forceRefresh).
  const cacheMap = forceRefresh
    ? new Map<string, Map<string, PartPricing>>()
    : await getCachedOffersForParts(items.map((i) => i.partId));

  for (const { name, client } of sources) {
    // Split this distributor's work into cache hits and live misses.
    const misses: Array<{ partId: string; mpn: string }> = [];
    for (const it of items) {
      const cached = cacheMap.get(it.partId)?.get(name) ?? null;
      if (cached) {
        cached.mpn = it.mpn; // row doesn't carry the MPN; fill from input
        const agg = result.get(it.partId);
        if (agg) {
          agg.offers.push(cached);
          agg.sourcesFromCache += 1;
        }
      } else {
        misses.push(it);
      }
    }
    if (misses.length === 0) continue;

    // forceRefresh must pierce the clients' own in-memory MPN caches too.
    if (forceRefresh) {
      for (const m of misses) evictCached(name, m.mpn);
    }

    let live: Map<string, PartPricing>;
    try {
      live = await client.lookupBatch(misses.map((m) => m.mpn));
    } catch (err) {
      console.error(`[distributors] ${name} batch failed:`, err);
      live = new Map();
    }

    for (const it of misses) {
      const offer = live.get(it.mpn);
      if (!offer) continue;
      offer.mpn = it.mpn;
      const agg = result.get(it.partId);
      if (agg) {
        agg.offers.push(offer);
        agg.sourcesFromLive += 1;
      }
      try {
        await putCachedOffer(it.partId, name, offer);
      } catch (err) {
        console.error(`[distributors] failed to cache ${name} offer for ${it.partId}:`, err);
      }
    }
  }

  // Finalize: compute bestOverall and drop parts that got no offers.
  for (const [partId, agg] of result) {
    if (agg.offers.length === 0) {
      result.delete(partId);
      continue;
    }
    agg.bestOverall = pickBestOverall(agg.offers);
  }

  return result;
}

/** The offer with the lowest non-null bestUnitPrice (ties: first seen). */
function pickBestOverall(offers: PartPricing[]): PartPricing | null {
  let best: PartPricing | null = null;
  for (const p of offers) {
    if (p.bestUnitPrice === null) continue;
    if (best === null || best.bestUnitPrice === null || p.bestUnitPrice < best.bestUnitPrice) {
      best = p;
    }
  }
  // If nobody had a price, still surface the first entry (stock/metadata useful).
  return best ?? offers[0] ?? null;
}
