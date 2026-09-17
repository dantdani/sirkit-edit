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
import { admittedDistributorClient } from "./clients";
import { consolidateLifecycle } from "./lifecycle";
import { evictCached, getCached, getCachedOffersForExactMpns, getCachedOffersForParts, putCachedOffer } from "./cache";
import { getDb } from "../db/client";
import { parts } from "../db/schema";
import { admitSource, SOURCE_IDS, SOURCE_REGISTRY, type AcquisitionSourceId, type AdmissionRefusal } from "../acquisition/source-registry";
import { currentPause, previewAdmission, type AdmissionPause } from "../acquisition/admission-control";
import { canonicalExactMpn, sameExactMpn } from "../atomic/identity";

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
// Built once so token caches and request queues persist across calls. [B19-E E2] They live in ./clients, shared with the
// external candidate search; [B19-A I3] a client is built only when the registry admits its source.
const CHOICE_SOURCES: readonly AcquisitionSourceId[] = ["digikey", "mouser", "octopart"];
const clientFor = admittedDistributorClient;

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

export type PricingSourceStatus = {
  sourceId: AcquisitionSourceId;
  displayName: string;
  status: "available" | "paused" | AdmissionRefusal;
  ownerDecision: string | null;
  /** When a paused source may be tried again (unix ms); null otherwise. */
  retryAt: number | null;
  freshnessLabel: string;
  attribution: string;
};

/**
 * [B19-E E1] Every registry source a pricing choice names, with its state as data: available, paused (with when it may be
 * tried again), or the admission refusal (blocked, disabled under an owner decision, switched off, credentials missing).
 * "all" names LCSC too, which is blocked. Credentials are checked by presence only; no value is read into the result.
 */
export function pricingSourceStatuses(choice: DistributorChoice, now: number = Date.now()): PricingSourceStatus[] {
  if (choice === "none") return [];
  const out: PricingSourceStatus[] = [];
  for (const id of SOURCE_IDS) {
    if (!(choice === "all" || choice === id)) continue;
    const entry = SOURCE_REGISTRY[id];
    const admission = admitSource(id, process.env);
    const pause = admission.admitted ? currentPause(id, now) : null;
    out.push({
      sourceId: id,
      displayName: entry.displayName,
      status: !admission.admitted ? admission.refusal : pause ? "paused" : "available",
      ownerDecision: entry.state.ownerDecision,
      retryAt: pause ? pause.retryAtMs : null,
      freshnessLabel: entry.freshness.label,
      attribution: entry.license.attribution,
    });
  }
  return out;
}

/** Intended sources that are unavailable, by name only. Prefer `unavailableSources`, which says why. */
export function missingCredentials(choice: DistributorChoice): DistributorName[] {
  return unavailableSources(choice).map((source) => source.name);
}

/**
 * [B19-D I5b row 36] The key a priced line is found under: its catalog part AND its exact MPN, so two exact parts filed
 * under one catalog row are priced separately.
 */
export function pricingKey(partId: string, mpn: string): string {
  let exact = mpn.trim();
  try {
    exact = canonicalExactMpn(mpn);
  } catch {
    // a confusable MPN keeps its raw spelling as a key; no vendor answer will ever match it
  }
  return `${partId}\u0000${exact}`;
}

/**
 * Fetch pricing for a set of parts from the chosen source(s) and aggregate per
 * part. DB cache is consulted first (unless `forceRefresh`); only misses hit a
 * live API, and fresh responses are persisted. Never throws — provider failures
 * degrade to missing offers. Returns a map keyed by `pricingKey(partId, mpn)` (only
 * parts that got at least one offer are present). [B19-D I5b] An offer is attached only
 * when its own published MPN is the requested one; nothing is relabelled.
 */
export async function getPricingFor(
  parts: Array<{ partId: string; mpn: string }>,
  choice: DistributorChoice,
  opts: { forceRefresh?: boolean; live?: boolean; purpose?: "interactive" | "bulk-refresh" } = {},
): Promise<Map<string, AggregatedPricing>> {
  const result = new Map<string, AggregatedPricing>();
  if (choice === "none") return result;

  // Dedupe by (partId, exact MPN); require a non-empty MPN.
  const items: Array<{ partId: string; mpn: string; key: string }> = [];
  const seen = new Set<string>();
  for (const p of parts) {
    if (!p.partId || !p.mpn || p.mpn.trim() === "") continue;
    const key = pricingKey(p.partId, p.mpn);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ partId: p.partId, mpn: p.mpn, key });
  }
  if (items.length === 0) return result;

  const sources = activeSources(choice);
  if (sources.length === 0) return result;

  // [B19-B I2] Live pricing spends a metered vendor quota, so it is a capability the CALLER must be granted: without an
  // explicit `live: true` this serves the cache and never calls a vendor, and `forceRefresh` means nothing without it.
  // The safe value is the default, so a new caller that forgets to decide cannot spend quota by accident.
  const livePricing = opts.live === true;
  const forceRefresh = livePricing && opts.forceRefresh === true;

  // Seed an aggregation accumulator per part.
  for (const it of items) {
    result.set(it.key, {
      partId: it.partId,
      mpn: it.mpn,
      offers: [],
      bestOverall: null,
      lifecycleStatus: "unknown",
      sourcesQueried: [], // [B19-E E1] filled with the sources actually asked for this part
      sourcesFromCache: 0,
      sourcesFromLive: 0,
    });
  }

  // One bulk cache read for every part (skipped entirely on forceRefresh).
  const cacheMap = forceRefresh
    ? new Map<string, Map<string, PartPricing>>()
    : await getCachedOffersForParts(items.map((i) => i.partId));

  const bulkRefresh = opts.purpose === "bulk-refresh";
  const liveOffersByKey = new Map<string, PartPricing[]>();
  const refusedForTerms: string[] = [];

  for (const { id, name, client } of sources) {
    // [B19-A I3] A bulk refresh (an operator job pre-fetching many parts) touches only a source whose terms permit it.
    if (bulkRefresh && SOURCE_REGISTRY[id].license.bulkRefresh !== "permitted") {
      refusedForTerms.push(`${SOURCE_REGISTRY[id].displayName} (bulk refresh ${SOURCE_REGISTRY[id].license.bulkRefresh})`);
      continue;
    }
    // Split this distributor's work into cache hits and live misses.
    const misses: Array<{ partId: string; mpn: string; key: string }> = [];
    for (const it of items) {
      const stored = cacheMap.get(it.partId)?.get(name) ?? null;
      // [B19-D I5b rows 01, 36] a stored offer answers only for the exact MPN it was stored for (a row without one never does)
      const cached = stored && sameExactMpn(stored.mpn, it.mpn) ? stored : null;
      if (cached) {
        const agg = result.get(it.key);
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
    for (const m of misses) result.get(m.key)?.sourcesQueried.push(name); // [B19-E E1] asked, whatever the answer

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
      // [B19-D I5b row 01] an answer for a different part is dropped, never relabelled as the requested one
      if (!offer || !sameExactMpn(offer.mpn, it.mpn)) continue;
      const agg = result.get(it.key);
      if (agg) {
        agg.offers.push(offer);
        // [B19-E E1] only an answer a vendor sent for this lookup is live; a connector's memo answer is a cached one
        if (offer.provenance?.servedFrom === "live" || (!offer.provenance && offer.evidence)) agg.sourcesFromLive += 1;
        else agg.sourcesFromCache += 1;
        liveOffersByKey.set(it.key, [...(liveOffersByKey.get(it.key) ?? []), offer]);
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
  const lifecycleWrites: Array<{ partId: string; status: LifecycleStatus; answeredAt: number }> = [];
  for (const [key, agg] of result) {
    if (agg.offers.length === 0) {
      result.delete(key);
      continue;
    }
    agg.bestOverall = pickBestOverall(agg.offers);
    agg.lifecycleStatus = consolidateLifecycle(agg.offers.map((o) => o.lifecycleStatus));
    // Only persist a real verdict — never overwrite stored data with "unknown".
    // [B19-D I5b row 03 + review] and only from LIVE answers, consolidated from those answers alone (a cached offer's verdict is
    // never re-stamped because another source answered), stamped with when the vendor answered (a memo answer is not "now")
    const liveOffers = liveOffersByKey.get(key) ?? [];
    const liveVerdict = consolidateLifecycle(liveOffers.map((o) => o.lifecycleStatus));
    if (liveVerdict !== "unknown") {
      const answeredAt = Math.min(...liveOffers.map((o) => o.evidence?.retrievedAt ?? o.fetchedAt));
      lifecycleWrites.push({ partId: agg.partId, status: liveVerdict, answeredAt });
    }
  }

  await persistLifecycle(lifecycleWrites);

  return result;
}

/** Write consolidated lifecycle (and a refresh stamp) back to the parts table. */
async function persistLifecycle(
  writes: Array<{ partId: string; status: LifecycleStatus; answeredAt: number }>,
): Promise<void> {
  if (writes.length === 0) return;
  const db = getDb();
  await Promise.all(
    writes.map(({ partId, status, answeredAt }) =>
      db
        .update(parts)
        .set({ lifecycleStatus: status, lastRefreshedAt: new Date(answeredAt) })
        .where(eq(parts.id, partId))
        .catch((err: unknown) => {
          console.error(`[distributors] failed to persist lifecycle for ${partId} (details withheld): ${err instanceof Error ? err.name : "non-error"}`);
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

// ── [B19-E E6] Exact-MPN lookups for the agent's external search ─────────────

/**
 * cached: served from the connector's in-process memo or the offer cache; live: answered by a vendor request made now;
 * not_cached: no cached answer and no live lookup allowed; no_exact_answer: asked, but no product with exactly this MPN came
 * back (or the lookup failed); pending: asked, no answer before the deadline; paused: the agent's share or the breaker says no;
 * unavailable: the source is not admitted or its connector could not be built.
 */
export type ExactMpnLookupOutcome = "cached" | "live" | "not_cached" | "no_exact_answer" | "pending" | "paused" | "unavailable";

export interface ExactMpnLookupOptions {
  /** The SERVER's decision that this call may ask the vendor (never a model or request flag). */
  live: boolean;
  /** The agent: its live lookups are metered at its purpose share (OD-40). */
  purpose: "agent";
  /** How long a live answer may take before it is reported pending (the connector keeps its own deadline). */
  deadlineMs: number;
  signal?: AbortSignal;
  clock?: () => number;
  env?: Readonly<Record<string, string | undefined>>;
  /** Test seam: builds the admitted connector from its admission's secrets (default: the process-wide client). */
  connect?: (id: AcquisitionSourceId, secrets: Readonly<Record<string, string>>) => DistributorClient | null;
  /** Test seam: the offer cache read (default: `getCachedOffersForExactMpns`). */
  readOfferCache?: (mpns: readonly string[], now: number) => Promise<ReadonlyMap<string, ReadonlyMap<string, PartPricing>>>;
}

export interface ExactMpnLookupResult {
  sourceId: AcquisitionSourceId;
  answers: Array<{ mpn: string; outcome: ExactMpnLookupOutcome; pricing: PartPricing | null }>;
  /** The MPNs this call sent to the vendor. */
  liveMpns: string[];
  retryAtMs: number | null;
}

function canonicalMpns(mpns: readonly string[]): string[] {
  const out: string[] = [];
  for (const mpn of mpns) {
    try {
      const canonical = canonicalExactMpn(mpn);
      if (!out.includes(canonical)) out.push(canonical);
    } catch {
      // a confusable spelling is never looked up
    }
  }
  return out;
}

/** The live answer, or "pending" once the deadline passes or the caller aborts; a late answer is discarded here. */
function liveWithinDeadline(work: Promise<Map<string, PartPricing>>, deadlineMs: number, signal?: AbortSignal): Promise<Map<string, PartPricing> | "pending"> {
  return new Promise((resolve) => {
    if (signal?.aborted) { resolve("pending"); return; }
    let settled = false;
    const finish = (value: Map<string, PartPricing> | "pending"): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve(value);
    };
    function onAbort(): void { finish("pending"); }
    const timer = setTimeout(() => finish("pending"), Math.max(1, deadlineMs));
    signal?.addEventListener("abort", onAbort, { once: true });
    work.then((value) => finish(value), () => finish(new Map()));
  });
}

/**
 * [B19-E E6] One registered source's answer for exact MPNs, for the agent. Cache first: the connector's in-process memo, then
 * the offer cache. The admitted connector's lookupBatch is called only for the misses, only when the server's live policy
 * allows, and metered at the agent's purpose share; an answer late for the deadline is pending. Nothing is written, refreshed or
 * pre-fetched here, and an answer is attached only to its own exact MPN.
 */
export async function lookupExactMpns(sourceId: AcquisitionSourceId, mpns: readonly string[], options: ExactMpnLookupOptions): Promise<ExactMpnLookupResult> {
  const clock = options.clock ?? Date.now;
  const now = clock();
  const startedAt = Date.now(); // the deadline counts from here: the cache read before a live lookup never extends it
  const entry = SOURCE_REGISTRY[sourceId];
  const name = entry.distributorName as DistributorName;
  const requested = canonicalMpns(mpns);
  const result: ExactMpnLookupResult = { sourceId, answers: [], liveMpns: [], retryAtMs: null };
  const answers = new Map<string, { outcome: ExactMpnLookupOutcome; pricing: PartPricing | null }>();
  const settleAll = (list: readonly string[], outcome: ExactMpnLookupOutcome): void => { for (const mpn of list) answers.set(mpn, { outcome, pricing: null }); };
  const admission = admitSource(sourceId, options.env ?? process.env);
  if (!admission.admitted) {
    settleAll(requested, "unavailable");
  } else if (requested.length > 0) {
    let stored: ReadonlyMap<string, ReadonlyMap<string, PartPricing>> = new Map();
    try {
      stored = await (options.readOfferCache ?? getCachedOffersForExactMpns)(requested, now);
    } catch (err) {
      console.error(`[distributors] offer cache read for exact MPNs failed (details withheld): ${err instanceof Error ? err.name : "non-error"}`);
    }
    for (const mpn of requested) {
      const memo = getCached(name, mpn);
      const row = stored.get(mpn)?.get(name) ?? null;
      const hit = memo && sameExactMpn(memo.mpn, mpn) ? memo : row && sameExactMpn(row.mpn, mpn) ? row : null;
      if (hit) answers.set(mpn, { outcome: "cached", pricing: hit });
    }
    const misses = requested.filter((mpn) => !answers.has(mpn));
    if (misses.length > 0 && !options.live) {
      settleAll(misses, "not_cached");
    } else if (misses.length > 0) {
      const pause = previewAdmission(sourceId, misses.length, now, options.purpose);
      let client: DistributorClient | null = null;
      if (!pause) {
        try {
          client = (options.connect ?? ((id: AcquisitionSourceId) => clientFor(id)))(sourceId, admission.secrets);
        } catch {
          client = null;
        }
      }
      if (pause) {
        result.retryAtMs = pause.retryAtMs;
        settleAll(misses, "paused");
      } else if (!client) {
        settleAll(misses, "unavailable");
      } else {
        const remainingMs = options.deadlineMs - (Date.now() - startedAt);
        // [B19-E E6 review follow-up] a deadline the cache reads already used up: the misses are pending and the vendor is not
        // asked — a request whose answer could only be discarded would still be metered and charged to the run
        const live = remainingMs <= 0 ? "pending" : await (result.liveMpns = [...misses], liveWithinDeadline(client.lookupBatch(misses, { purpose: options.purpose }), remainingMs, options.signal));
        if (live === "pending") {
          settleAll(misses, "pending");
        } else {
          const after = live.size === 0 ? currentPause(sourceId, clock(), options.purpose) : null;
          for (const mpn of misses) {
            const offer = live.get(mpn);
            if (offer && sameExactMpn(offer.mpn, mpn)) answers.set(mpn, { outcome: "live", pricing: offer });
            else answers.set(mpn, { outcome: after ? "paused" : "no_exact_answer", pricing: null });
          }
          if (after) result.retryAtMs = after.retryAtMs;
        }
      }
    }
  }
  result.answers = requested.map((mpn) => ({ mpn, ...(answers.get(mpn) ?? { outcome: "unavailable" as const, pricing: null }) }));
  return result;
}
