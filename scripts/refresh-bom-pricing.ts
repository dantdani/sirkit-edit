/**
 * Background refresh for cached BOM pricing. Run with: `pnpm refresh:bom-pricing`
 *
 * Finds every part that has stale (or null) cached offers in part_offers and
 * re-fetches them from all configured distributors. Built for ops use (e.g. a
 * nightly cron); it doesn't run automatically.
 *
 * Concurrency is capped at 50 parts per chunk to avoid blowing API quotas. The
 * aggregator's own per-distributor request queues (DigiKey 200ms, Mouser 2s)
 * further throttle live calls within each chunk.
 */

import { loadEnvLocal } from "../app/lib/load-env-local";

loadEnvLocal();

import { inArray, isNull, lt, or } from "drizzle-orm";
import { getDb, getSqlClient } from "../app/lib/db/client";
import { partOffers, parts } from "../app/lib/db/schema";
import { getPricingFor } from "../app/lib/distributors";

const STALE_MS = 24 * 60 * 60 * 1000; // 24h
const CHUNK_SIZE = 50;

async function main(): Promise<void> {
  const db = getDb();
  const cutoff = new Date(Date.now() - STALE_MS);

  // Distinct parts with at least one stale/never-refreshed offer.
  const staleRows = await db
    .selectDistinct({ partId: partOffers.partId })
    .from(partOffers)
    .where(or(isNull(partOffers.lastRefreshedAt), lt(partOffers.lastRefreshedAt, cutoff)));

  const stalePartIds = staleRows.map((r) => r.partId);
  if (stalePartIds.length === 0) {
    console.log("[refresh] No stale offers — nothing to do.");
    await getSqlClient().end();
    return;
  }

  // Resolve each part's catalog MPN (skip parts without one).
  const partRows = await db
    .select({ id: parts.id, mpn: parts.mpn })
    .from(parts)
    .where(inArray(parts.id, stalePartIds));

  const items = partRows
    .filter((r): r is { id: string; mpn: string } => !!r.mpn && r.mpn.trim() !== "")
    .map((r) => ({ partId: r.id, mpn: r.mpn }));

  const noMpn = stalePartIds.length - items.length;
  console.log(
    `[refresh] ${stalePartIds.length} parts with stale offers (${noMpn} without an MPN, skipped). Refreshing ${items.length}…`,
  );

  let processed = 0;
  let live = 0;
  let withOffers = 0;

  for (let i = 0; i < items.length; i += CHUNK_SIZE) {
    const chunk = items.slice(i, i + CHUNK_SIZE);
    const pricing = await getPricingFor(chunk, "all", { forceRefresh: true });
    for (const agg of pricing.values()) {
      live += agg.sourcesFromLive;
      if (agg.offers.length > 0) withOffers += 1;
    }
    processed += chunk.length;
    console.log(`[refresh] Processed ${processed} / ${items.length} parts`);
  }

  console.log(
    `[refresh] Done. ${processed} parts refreshed, ${withOffers} returned offers, ${live} live source fetches.`,
  );

  await getSqlClient().end();
}

main().catch((err) => {
  console.error("[refresh] failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
  void getSqlClient().end();
});
