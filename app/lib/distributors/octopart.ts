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
  cheapestUnitPrice,
  type DistributorClient,
  type PartPricing,
  type PriceBreak,
} from "./types";
import { getCached, setCached } from "./cache";

const GRAPHQL_URL = "https://api.nexar.com/graphql";

const PART_FRAGMENT = `
  results {
    part {
      mpn
      manufacturer { name }
      shortDescription
      bestDatasheet { url }
      totalAvail
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

export function makeOctopartClient(opts: { apiKey: string }): DistributorClient {
  const { apiKey } = opts;
  if (!apiKey) {
    throw new Error("OCTOPART credentials not configured");
  }

  async function runQuery(query: string, variables: Record<string, string>): Promise<unknown> {
    const res = await fetch(GRAPHQL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) {
      throw new Error(`Octopart query failed (${res.status})`);
    }
    return res.json();
  }

  async function lookupByMpn(mpn: string): Promise<PartPricing | null> {
    const result = await lookupBatch([mpn]);
    return result.get(mpn) ?? null;
  }

  async function lookupBatch(mpns: string[]): Promise<Map<string, PartPricing>> {
    const out = new Map<string, PartPricing>();
    const unique = [...new Set(mpns.filter((m) => m.trim() !== ""))];

    // Serve everything we can from cache; only query the misses.
    const misses: string[] = [];
    for (const mpn of unique) {
      const hit = getCached("octopart-aggregated", mpn);
      if (hit) out.set(mpn, hit);
      else misses.push(mpn);
    }
    if (misses.length === 0) return out;

    try {
      const aliases = misses.map((mpn, i) => ({ mpn, alias: `s${i}`, varName: `q${i}` }));
      const varDecls = aliases.map((a) => `$${a.varName}: String!`).join(", ");
      const body = aliases
        .map((a) => `${a.alias}: supSearchMpn(q: $${a.varName}, limit: 1) { ${PART_FRAGMENT} }`)
        .join("\n");
      const query = `query BatchMpn(${varDecls}) {\n${body}\n}`;
      const variables: Record<string, string> = {};
      for (const a of aliases) variables[a.varName] = a.mpn;

      const json = await runQuery(query, variables);
      const data = asRecord(asRecord(json).data);

      for (const a of aliases) {
        const search = asRecord(data[a.alias]);
        const firstResult = asArray(search.results)[0];
        const part = asRecord(asRecord(firstResult).part);
        const pricing = mapPart(a.mpn, part);
        if (pricing) {
          setCached("octopart-aggregated", a.mpn, pricing);
          out.set(a.mpn, pricing);
        }
      }
    } catch (err) {
      // A network/auth error sinks the whole batch's *live* portion; cached
      // entries already collected above still return.
      console.error(`[octopart] batch lookup failed for [${misses.join(", ")}]:`, err);
    }

    return out;
  }

  return { name: "octopart-aggregated", lookupByMpn, lookupBatch };
}

// ─── Response mapping ──────────────────────────────────────────────────────────

function mapPart(requestedMpn: string, part: Record<string, unknown>): PartPricing | null {
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
    fetchedAt: Date.now(),
  };
}
