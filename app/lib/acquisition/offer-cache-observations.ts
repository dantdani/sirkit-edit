/**
 * [B19-E E4] The offer cache as sourcing observations for one exact MPN — a READ of `part_offers`, never a vendor call.
 *
 * The atomic publication review is cache-only: it spends no quota and asks no vendor. This module reads the stored offers
 * whose exact MPN is the requested one, keeps only rows its source's registered terms still allow Sirkit to keep (a bounded
 * source, within its retention; Mouser and LCSC are never stored and never read), takes the newest row per source, and turns
 * each into an observation through the quarantine front half with rawContentHash null (served from a cache).
 *
 * It deliberately imports no distributor fetch, client, egress or cache module (a tripwire checks the import closure).
 */
import { sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { partOffers } from "../db/schema";
import { canonicalExactMpn, sameExactMpn } from "../atomic/identity";
import type { PartPricing } from "../distributors/types";
import { observationFromPricing, type ExternalObservation } from "./quarantine";
import { sourceForDistributorName } from "./source-registry";

const MAX_ROWS = 64;

export async function loadCachedExternalObservations(exactMpn: string, now: Date = new Date()): Promise<ExternalObservation[]> {
  let canonical: string;
  try {
    canonical = canonicalExactMpn(exactMpn);
  } catch {
    return [];
  }
  const rows = await getDb()
    .select({ distributor: partOffers.distributor, mpn: partOffers.mpn, distributorSku: partOffers.distributorSku, priceBreaks: partOffers.priceBreaks, stock: partOffers.stock, minOrderQty: partOffers.minOrderQty, productUrl: partOffers.productUrl, lifecycleStatus: partOffers.lifecycleStatus, lifecycleRaw: partOffers.lifecycleRaw, lastRefreshedAt: partOffers.lastRefreshedAt })
    .from(partOffers)
    .where(sql`upper(${partOffers.mpn}) = ${canonical}`)
    .limit(MAX_ROWS);

  const newest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const entry = sourceForDistributorName(row.distributor);
    if (!entry || entry.state.status !== "enabled" || entry.license.storage !== "bounded" || entry.license.retentionMaxMs <= 0) continue;
    if (!row.mpn || !sameExactMpn(row.mpn, canonical)) continue;
    const answeredAt = row.lastRefreshedAt.getTime();
    if (!Number.isFinite(answeredAt) || now.getTime() - answeredAt >= entry.license.retentionMaxMs) continue;
    const kept = newest.get(entry.id);
    if (!kept || kept.lastRefreshedAt.getTime() < answeredAt) newest.set(entry.id, row);
  }

  const observations: ExternalObservation[] = [];
  for (const row of [...newest.values()].sort((a, b) => a.distributor.localeCompare(b.distributor))) {
    const retrievedAt = new Date(Math.min(row.lastRefreshedAt.getTime(), now.getTime()));
    const pricing: PartPricing = {
      distributor: row.distributor as PartPricing["distributor"],
      mpn: row.mpn!,
      manufacturer: null,
      description: null,
      datasheet: null,
      inStock: row.stock ?? null,
      minOrderQty: row.minOrderQty ?? null,
      priceBreaks: row.priceBreaks ?? [],
      bestUnitPrice: null,
      productUrl: row.productUrl ?? null,
      package: null,
      sku: row.distributorSku ?? null,
      lifecycleStatus: row.lifecycleStatus ?? "unknown",
      lifecycleRaw: row.lifecycleRaw ?? null,
      fetchedAt: retrievedAt.getTime(),
      provenance: { servedFrom: "offer-cache", retrievedAt: retrievedAt.getTime() },
    };
    observations.push(observationFromPricing(pricing, { rawContentHash: null, retrievedAt, requestedMpn: exactMpn }));
  }
  return observations;
}
