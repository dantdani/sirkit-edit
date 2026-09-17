/**
 * Octopart (Nexar) GraphQL client.
 * https://nexar.com/api  ·  https://api.nexar.com/graphql
 *
 * Octopart aggregates offers across every major distributor, so one query
 * yields a cross-market view. We batch many MPNs into a single request using
 * GraphQL aliases (one `supSearchMpn` per MPN), then collapse all sellers/offers
 * for a part into one `PartPricing` flagged "octopart-aggregated".
 *
 * The developer tier is ~1000 queries/MONTH, so the cache (24h TTL for this
 * source) is doing real work — see ./cache.ts.
 */

import {
  asArray,
  asNumber,
  asRecord,
  asString,
  candidateSearchLimit,
  cheapestUnitPrice,
  type CandidateSearchAnswer,
  type CandidateSearchOptions,
  type DistributorClient,
  type LookupBatchOptions,
  type LookupPurpose,
  type PartPricing,
  type PriceBreak,
} from "./types";
import { mapLifecycleString } from "./lifecycle";
import { getCached, isKnownNoExactMatch, rememberNoExactMatch, setCached } from "./cache";
import { distributorJson, type DistributorEgress } from "./egress"; // [B19-B I1] the bounded, validated egress path
import { describeFailure, DistributorRequestError } from "./types";
import { makeCoalescer } from "../acquisition/admission-control";
import { canonicalExactMpn, sameExactMpn } from "../atomic/identity";

const GRAPHQL_URL = "https://api.nexar.com/graphql";

const PART_FRAGMENT = `
  results {
    part {
      mpn
      manufacturer { name }
      shortDescription
      bestDatasheet { url }
      totalAvail
      lifecycleStatus
      sellers {
        company { name }
        offers {
          sku
          inventoryLevel
          clickUrl
          prices { quantity price currency }
        }
      }
    }
  }
`;

export function makeOctopartClient(opts: { apiKey: string; egress?: DistributorEgress }): DistributorClient {
  const { apiKey } = opts;
  const egress = opts.egress ?? {};
  if (!apiKey) {
    throw new Error("OCTOPART credentials not configured");
  }

  async function runQuery(query: string, variables: Record<string, string | number>, matchedPartsAtMost: number, purpose: CandidateSearchOptions["purpose"] = "interactive", isErrorAnswer?: (value: unknown) => boolean): Promise<{ value: unknown; contentHash: string; retrievedAt: number }> {
    const res = await distributorJson("octopart", {
      url: GRAPHQL_URL,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ query, variables }),
    }, egress, matchedPartsAtMost, purpose, isErrorAnswer); // [B19-B I3b] Nexar's quota counts matched parts: each aliased search asks for at most one
    if (!res.ok) throw new DistributorRequestError(`Octopart query failed: ${res.message}`, { paused: res.paused, retryAtMs: res.retryAtMs });
    return { value: res.value, contentHash: res.contentHash, retrievedAt: res.retrievedAt };
  }

  /**
   * [B19-E E2] One supSearchMpn (exact) or supSearch (keyword) query for up to 5 parts. Every part it can return counts against
   * Nexar's matched-part quota, so the whole limit is reserved before it is sent. Nothing is memoized or remembered.
   * [B19-E E2 review] Nexar answers an exceeded part limit (and other faults) with HTTP 200 and GraphQL `errors`: that is a failed
   * search the breaker counts, never "nothing found".
   */
  async function searchCandidates(query: string, options: CandidateSearchOptions): Promise<CandidateSearchAnswer> {
    const limit = candidateSearchLimit(options.limit);
    const field = options.mode === "exact" ? "supSearchMpn" : "supSearch";
    try {
      const graphql = `query CandidateSearch($q: String!, $limit: Int!) {\n  s0: ${field}(q: $q, limit: $limit) { ${PART_FRAGMENT} }\n}`;
      const answer = await runQuery(graphql, { q: query, limit }, limit, options.purpose, candidateAnswerIsError);
      const results = asArray(asRecord(asRecord(asRecord(answer.value).data).s0).results).slice(0, limit);
      const hits = results.flatMap((result) => {
        const pricing = mapNexarPart(asRecord(asRecord(result).part));
        if (!pricing) return [];
        const labelled: PartPricing = { ...pricing, fetchedAt: answer.retrievedAt, evidence: { rawContentHash: answer.contentHash, retrievedAt: answer.retrievedAt }, provenance: { servedFrom: "live", retrievedAt: answer.retrievedAt } };
        return [{ pricing: labelled, exactMatch: sameExactMpn(pricing.mpn, query) }];
      });
      return { ok: true, hits, rawContentHash: answer.contentHash, retrievedAt: answer.retrievedAt };
    } catch (err) {
      console.error(`[octopart] candidate search failed: ${describeFailure(err)}`);
      return err instanceof DistributorRequestError && err.paused
        ? { ok: false, message: "paused", paused: err.paused, ...(err.retryAtMs === undefined ? {} : { retryAtMs: err.retryAtMs }) }
        : { ok: false, message: "the search failed (details withheld)" };
    }
  }

  async function lookupByMpn(mpn: string): Promise<PartPricing | null> {
    const result = await lookupBatch([mpn]);
    return result.get(mpn) ?? null;
  }

  // [B19-B I3b] an MPN already being queried by a concurrent batch is joined, never queried twice
  const coalesce = makeCoalescer<PartPricing | null>();

  /** One aliased GraphQL query for MPNs nobody is querying yet. Never rejects: a failure is an empty result. */
  async function queryMisses(misses: string[], purpose: LookupPurpose = "interactive"): Promise<Map<string, PartPricing>> {
    const found = new Map<string, PartPricing>();
    try {
      const aliases = misses.map((mpn, i) => ({ mpn, alias: `s${i}`, varName: `q${i}` }));
      const varDecls = aliases.map((a) => `$${a.varName}: String!`).join(", ");
      const body = aliases
        .map((a) => `${a.alias}: supSearchMpn(q: $${a.varName}, limit: 1) { ${PART_FRAGMENT} }`)
        .join("\n");
      const query = `query BatchMpn(${varDecls}) {\n${body}\n}`;
      const variables: Record<string, string> = {};
      for (const a of aliases) variables[a.varName] = a.mpn;

      const answer = await runQuery(query, variables, aliases.length, purpose); // [B19-E E6] metered for its purpose
      const data = asRecord(asRecord(answer.value).data);

      for (const a of aliases) {
        const search = asRecord(data[a.alias]);
        const firstResult = asArray(search.results)[0];
        const part = asRecord(asRecord(firstResult).part);
        const mapped = mapPart(a.mpn, part);
        // [B19-C I4] every part in one batch answer is pinned to that answer's bytes
        const pricing = mapped ? { ...mapped, evidence: { rawContentHash: answer.contentHash, retrievedAt: answer.retrievedAt }, provenance: { servedFrom: "live" as const, retrievedAt: answer.retrievedAt } } : null;
        if (pricing) {
          setCached("octopart-aggregated", a.mpn, pricing);
          found.set(a.mpn, pricing);
        } else {
          rememberNoExactMatch("octopart-aggregated", a.mpn); // [B19-D I5b review] answered, but not with this exact part
        }
      }
    } catch (err) {
      // A network/auth error (or a quota or breaker pause) sinks this query's live portion; cached entries still return.
      // [B19-B I1] only the boundary's own redacted sentence is ever logged — never the raw error.
      console.error(`[octopart] batch lookup failed for ${misses.length} part(s): ${describeFailure(err)}`);
    }
    return found;
  }

  async function lookupBatch(mpns: string[], options: LookupBatchOptions = {}): Promise<Map<string, PartPricing>> {
    const purpose = options.purpose ?? "interactive";
    const out = new Map<string, PartPricing>();
    const unique = [...new Set(mpns.filter((m) => m.trim() !== ""))];

    // Serve everything we can from cache; only query the misses.
    const misses: string[] = [];
    for (const mpn of unique) {
      const hit = getCached("octopart-aggregated", mpn);
      if (hit) out.set(mpn, hit);
      else if (!isKnownNoExactMatch("octopart-aggregated", mpn)) misses.push(mpn);
    }
    if (misses.length === 0) return out;

    // Join lookups already in flight; one query for the rest, registered so later batches join it in turn.
    const pending = new Map<string, Promise<PartPricing | null>>();
    const fresh: string[] = [];
    let freshQuery: Promise<Map<string, PartPricing>> | null = null;
    for (const mpn of misses) {
      // [B19-E E6] an agent lookup joins only another agent lookup, so each purpose's meter stays its own
      const key = purpose === "agent" ? `agent\u0000${inFlightKey(mpn)}` : inFlightKey(mpn);
      pending.set(mpn, coalesce(key, () => {
        fresh.push(mpn);
        freshQuery ??= Promise.resolve().then(() => queryMisses(fresh, purpose));
        return freshQuery.then((found) => found.get(mpn) ?? null);
      }));
    }
    for (const [mpn, result] of pending) {
      const pricing = await result;
      if (pricing) out.set(mpn, pricing);
    }
    return out;
  }

  return { name: "octopart-aggregated", lookupByMpn, lookupBatch, searchCandidates };
}

/** [B19-E E2 review] A candidate-search answer carrying GraphQL errors, or without its own `s0` result set, is an error. */
function candidateAnswerIsError(value: unknown): boolean {
  const answer = asRecord(value);
  const search = asRecord(answer.data).s0;
  if (typeof search !== "object" || search === null || Array.isArray(search)) return true;
  // [B19-E E2 follow-up] errors beside a usable result list are a partial answer (e.g. one part's datasheet field failed): its
  // parts are shown, and it does not count toward the breaker BOM pricing shares. Errors with no result list are a failure.
  const hasErrors = answer.errors !== undefined && answer.errors !== null && !(Array.isArray(answer.errors) && answer.errors.length === 0);
  const results = asRecord(search).results;
  return hasErrors && !Array.isArray(results);
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

function mapPart(requestedMpn: string, part: Record<string, unknown>): PartPricing | null {
  // [B19-D I5b row 01] a search result for a different (or confusably spelled) MPN answers nothing
  if (!sameExactMpn(asString(part.mpn), requestedMpn)) return null;
  return mapNexarPart(part);
}

/** One Nexar part, its sellers' offers collapsed, under the MPN Nexar published; null without one. */
function mapNexarPart(part: Record<string, unknown>): PartPricing | null {
  const mpn = asString(part.mpn);
  if (!mpn) return null;

  const sellers = asArray(part.sellers);
  const priceBreaks: PriceBreak[] = [];
  let inStockSum = 0;
  let sawInventory = false;
  let bestSeller: { stock: number; clickUrl: string | null } = { stock: -1, clickUrl: null };

  for (const sellerRaw of sellers) {
    const seller = asRecord(sellerRaw);
    for (const offerRaw of asArray(seller.offers)) {
      const offer = asRecord(offerRaw);
      const inventory = asNumber(offer.inventoryLevel);
      if (inventory !== null) {
        inStockSum += inventory;
        sawInventory = true;
        if (inventory > bestSeller.stock) {
          bestSeller = { stock: inventory, clickUrl: asString(offer.clickUrl) };
        }
      }
      for (const priceRaw of asArray(offer.prices)) {
        const price = asRecord(priceRaw);
        const qty = asNumber(price.quantity);
        const unit = asNumber(price.price);
        if (qty === null || unit === null) continue;
        priceBreaks.push({ qty, price: unit, currency: asString(price.currency) ?? "USD" });
      }
    }
  }

  priceBreaks.sort((a, b) => a.qty - b.qty);

  const lifecycleRaw = asString(part.lifecycleStatus);

  return {
    distributor: "octopart-aggregated",
    mpn,
    manufacturer: asString(asRecord(part.manufacturer).name),
    description: asString(part.shortDescription),
    datasheet: asString(asRecord(part.bestDatasheet).url),
    inStock: sawInventory ? inStockSum : asNumber(part.totalAvail),
    minOrderQty: null, // Octopart offers expose MOQ per-offer; omitted for the aggregated view.
    priceBreaks,
    bestUnitPrice: cheapestUnitPrice(priceBreaks),
    productUrl: bestSeller.clickUrl,
    package: null,
    lifecycleStatus: mapLifecycleString(lifecycleRaw),
    lifecycleRaw,
    fetchedAt: Date.now(),
  };
}
