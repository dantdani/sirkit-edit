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

import { eq } from "drizzle-orm";
import type { DistributorClient, DistributorName, LifecycleStatus, PartPricing } from "./types";
import type { DistributorChoice, AggregatedPricing } from "./shared";
import { makeDigiKeyClient } from "./digikey";
import { makeOctopartClient } from "./octopart";
import { makeMouserClient } from "./mouser";
import { consolidateLifecycle } from "./lifecycle";
import { evictCached, getCachedOffersForParts, putCachedOffer } from "./cache";
import { getDb } from "../db/client";
import { parts } from "../db/schema";
import { admitSource, SOURCE_REGISTRY, type AcquisitionSourceId, type AdmissionRefusal } from "../acquisition/source-registry";
import { currentPause, type AdmissionPause } from "../acquisition/admission-control";

// Re-export the browser-safe surface (types, lifecycle helpers, DistributorChoice,
// AggregatedPricing) so server callers can keep importing from this barrel. Client
// Components must import these from "./shared" instead — this barrel pulls in the
// DB/Postgres graph and cannot be bundled for the browser. See ./shared.ts.
export type {
  PartPricing,
  PriceBreak,
  DistributorClient,
  DistributorName,
  LifecycleStatus,
  DistributorChoice,
  AggregatedPricing,
} from "./shared";
export { LIFECYCLE_SEVERITY, consolidateLifecycle, mapLifecycleString } from "./shared";
export {
  getCachedOffer,
  putCachedOffer,
  getCachedOffersForParts,
} from "./cache";

// ── Lazy, process-wide client singletons, admitted by the source registry ─────
// Built once so token caches and request queues persist across calls.
// [B19-A I3] A client is built only when the registry ADMITS its source: never a blocked one, a disabled one only after a
// reviewed registry change, and not when the operator has switched it off or its credentials are missing. Credentials are
// read by reference (the registry names the variables) and handed only to the connector that uses them. The decision is
// taken once per process, like the credentials were before.
const CHOICE_SOURCES: readonly AcquisitionSourceId[] = ["digikey", "mouser", "octopart"];
const clients = new Map<AcquisitionSourceId, DistributorClient | null>();

function clientFor(id: AcquisitionSourceId): DistributorClient | null {
  if (clients.has(id)) return clients.get(id) ?? null;
  const admission = admitSource(id, process.env);
  let client: DistributorClient | null = null;
  if (admission.admitted) {
    const secret = (name: string): string => admission.secrets[name] ?? "";
    try {
      if (id === "digikey") client = makeDigiKeyClient({ clientId: secret("DIGIKEY_CLIENT_ID"), clientSecret: secret("DIGIKEY_CLIENT_SECRET") });
      else if (id === "mouser") client = makeMouserClient({ apiKey: secret("MOUSER_API_KEY") });
      else if (id === "octopart") client = makeOctopartClient({ apiKey: secret("OCTOPART_API_KEY") });
    } catch {
      client = null;
    }
  }
  clients.set(id, client);
  return client;
}

/** Does `choice` intend to query source `id`? */
function intends(choice: DistributorChoice, id: AcquisitionSourceId): boolean {
  return choice === "all" || choice === id;
}

type ActiveSource = { id: AcquisitionSourceId; name: DistributorName; client: DistributorClient };

/** Admitted clients a choice resolves to. */
function activeSources(choice: DistributorChoice): ActiveSource[] {
  const out: ActiveSource[] = [];
  for (const id of CHOICE_SOURCES) {
    if (!intends(choice, id)) continue;
    const client = clientFor(id);
    if (client) out.push({ id, name: SOURCE_REGISTRY[id].distributorName as DistributorName, client });
  }
  return out;
}

export type UnavailableSource = { name: DistributorName; refusal: AdmissionRefusal; message: string };

/**
 * [B19-A I3] Intended sources the registry does not admit, each with its reason: blocked, disabled (with the owner
 * decision), switched off by the operator, or missing credentials. Messages name variables, never values.
 */
export function unavailableSources(choice: DistributorChoice): UnavailableSource[] {
  const out: UnavailableSource[] = [];
  for (const id of CHOICE_SOURCES) {
    if (!intends(choice, id)) continue;
    const admission = admitSource(id, process.env);
    if (!admission.admitted) out.push({ name: SOURCE_REGISTRY[id].distributorName as DistributorName, refusal: admission.refusal, message: admission.message });
  }
  return out;
}

export type PausedSource = { name: DistributorName; reason: AdmissionPause["reason"]; message: string; retryAtMs: number };

/**
 * [B19-B I3b] Admitted sources that are paused right now — a registered quota used up, or the circuit breaker open after
 * repeated failures — each with its sentence and when it may be tried again.
 */
export function pausedSources(choice: DistributorChoice, now: number = Date.now()): PausedSource[] {
  const out: PausedSource[] = [];
  for (const id of CHOICE_SOURCES) {
    if (!intends(choice, id) || !admitSource(id, process.env).admitted) continue;
    const pause = currentPause(id, now);
    if (pause) out.push({ name: SOURCE_REGISTRY[id].distributorName as DistributorName, reason: pause.reason, message: pause.message, retryAtMs: pause.retryAtMs });
  }
  return out;
}

/** Intended sources that are unavailable, by name only. Prefer `unavailableSources`, which says why. */
export function missingCredentials(choice: DistributorChoice): DistributorName[] {
  return unavailableSources(choice).map((source) => source.name);
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
  opts: { forceRefresh?: boolean; live?: boolean; purpose?: "interactive" | "bulk-refresh" } = {},
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

  // [B19-B I2] Live pricing spends a metered vendor quota, so it is a capability the CALLER must be granted: without an
  // explicit `live: true` this serves the cache and never calls a vendor, and `forceRefresh` means nothing without it.
  // The safe value is the default, so a new caller that forgets to decide cannot spend quota by accident.
  const livePricing = opts.live === true;
  const forceRefresh = livePricing && opts.forceRefresh === true;
  const sourceNames = sources.map((s) => s.name);

  // Seed an aggregation accumulator per part.
  for (const it of items) {
    result.set(it.partId, {
      partId: it.partId,
      mpn: it.mpn,
      offers: [],
      bestOverall: null,
      lifecycleStatus: "unknown",
      sourcesQueried: sourceNames,
      sourcesFromCache: 0,
      sourcesFromLive: 0,
    });
  }

  // One bulk cache read for every part (skipped entirely on forceRefresh).
  const cacheMap = forceRefresh
    ? new Map<string, Map<string, PartPricing>>()
    : await getCachedOffersForParts(items.map((i) => i.partId));

  const bulkRefresh = opts.purpose === "bulk-refresh";
  const refusedForTerms: string[] = [];

  for (const { id, name, client } of sources) {
    // [B19-A I3] A bulk refresh (an operator job pre-fetching many parts) touches only a source whose terms permit it.
    if (bulkRefresh && SOURCE_REGISTRY[id].license.bulkRefresh !== "permitted") {
      refusedForTerms.push(`${SOURCE_REGISTRY[id].displayName} (bulk refresh ${SOURCE_REGISTRY[id].license.bulkRefresh})`);
      continue;
    }
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
    // [B19-B I2] a caller without live pricing gets the cache and nothing else.
    if (!livePricing) continue;

    // forceRefresh must pierce the clients' own in-memory MPN caches too.
    if (forceRefresh) {
      for (const m of misses) evictCached(name, m.mpn);
    }

    let live: Map<string, PartPricing>;
    try {
      live = await client.lookupBatch(misses.map((m) => m.mpn));
    } catch (err) {
      // [B19-B I1/I2] never the raw error: it can carry the request or the transport's own text.
      console.error(`[distributors] ${name} batch failed (details withheld): ${err instanceof Error ? err.name : "non-error"}`);
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
        console.error(`[distributors] failed to cache ${name} offer for ${it.partId} (details withheld): ${err instanceof Error ? err.name : "non-error"}`);
      }
    }
  }

  if (refusedForTerms.length > 0) {
    console.info(`[distributors] bulk refresh skipped by the source registry: ${refusedForTerms.join(", ")}`);
  }

  // Finalize: compute bestOverall + consolidated lifecycle; drop empty parts.
  const lifecycleWrites: Array<{ partId: string; status: LifecycleStatus }> = [];
  for (const [partId, agg] of result) {
    if (agg.offers.length === 0) {
      result.delete(partId);
      continue;
    }
    agg.bestOverall = pickBestOverall(agg.offers);
    agg.lifecycleStatus = consolidateLifecycle(agg.offers.map((o) => o.lifecycleStatus));
    // Only persist a real verdict — never overwrite stored data with "unknown".
    if (agg.lifecycleStatus !== "unknown") {
      lifecycleWrites.push({ partId, status: agg.lifecycleStatus });
    }
  }

  await persistLifecycle(lifecycleWrites);

  return result;
}

/** Write consolidated lifecycle (and a refresh stamp) back to the parts table. */
async function persistLifecycle(
  writes: Array<{ partId: string; status: LifecycleStatus }>,
): Promise<void> {
  if (writes.length === 0) return;
  const db = getDb();
  const now = new Date();
  await Promise.all(
    writes.map(({ partId, status }) =>
      db
        .update(parts)
        .set({ lifecycleStatus: status, lastRefreshedAt: now })
        .where(eq(parts.id, partId))
        .catch((err: unknown) => {
          console.error(`[distributors] failed to persist lifecycle for ${partId}:`, err);
        }),
    ),
  );
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
