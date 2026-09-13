/**
 * Background refresh for cached BOM data. Run with:
 *   pnpm refresh:bom-pricing              # pricing/stock — parts with stale offers (24h)
 *   pnpm refresh:bom-pricing --lifecycle  # slower-cadence lifecycle sweep (7d / unknown)
 *
 * Pricing and lifecycle move at different speeds, so they refresh on different
 * cadences to avoid wasting API quota. Both modes re-fetch from every configured
 * distributor (the aggregator persists pricing to part_offers and consolidated
 * lifecycle to parts.lifecycleStatus). Built for ops use (e.g. a nightly cron).
 *
 * Concurrency is capped at 50 parts per chunk; the aggregator's per-distributor
 * request queues (spaced by the source registry) further throttle live calls.
 *
 * [B19-A I3] This job is an operator's BULK refresh. It is granted live pricing (after B19-B I2 made live pricing a grant,
 * it passed only `forceRefresh` and silently refreshed nothing) and it declares itself a bulk refresh, so it touches only
 * the sources whose terms permit pre-fetching — none today: DigiKey's agreement prohibits bulk download, Mouser is disabled
 * and prohibits storage, and Nexar's terms are unclear (OD-33).
 */

import { loadEnvLocal } from "../app/lib/load-env-local";

loadEnvLocal();

import { and, desc, eq, gte, inArray, isNull, lt, or } from "drizzle-orm";
import { getDb, getSqlClient } from "../app/lib/db/client";
import {
  partOffers,
  parts,
  alternates,
  bomSnapshots,
  bomNotifications,
  type NewBomNotification,
} from "../app/lib/db/schema";
import { getPricingFor } from "../app/lib/distributors";
import { isOfferServable } from "../app/lib/distributors/cache";
import {
  diffSnapshots,
  type BomSnapshot,
  type SnapshotRow,
} from "../app/lib/snapshots";
import { changeToNotification } from "../app/lib/notifications";

const PRICING_STALE_MS = 24 * 60 * 60 * 1000; // 24h
const LIFECYCLE_STALE_MS = 7 * 24 * 60 * 60 * 1000; // 7d
const SNAPSHOT_LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000; // 90d
const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h
const CHUNK_SIZE = 50;

const lifecycleMode = process.argv.includes("--lifecycle");
const notifyMode = process.argv.includes("--notify");

/** Parts due for a refresh, as { partId, mpn } (MPN required). */
async function findCandidates(): Promise<Array<{ partId: string; mpn: string }>> {
  const db = getDb();

  if (lifecycleMode) {
    // Lifecycle sweep: parts not refreshed in 7 days (or never), or still unknown.
    const cutoff = new Date(Date.now() - LIFECYCLE_STALE_MS);
    const rows = await db
      .select({ id: parts.id, mpn: parts.mpn })
      .from(parts)
      .where(
        or(
          isNull(parts.lastRefreshedAt),
          lt(parts.lastRefreshedAt, cutoff),
          eq(parts.lifecycleStatus, "unknown"),
        ),
      );
    return toItems(rows);
  }

  // Pricing sweep: distinct parts with at least one stale/never-refreshed offer.
  const cutoff = new Date(Date.now() - PRICING_STALE_MS);
  const staleRows = await db
    .selectDistinct({ partId: partOffers.partId })
    .from(partOffers)
    .where(or(isNull(partOffers.lastRefreshedAt), lt(partOffers.lastRefreshedAt, cutoff)));

  const stalePartIds = staleRows.map((r) => r.partId);
  if (stalePartIds.length === 0) return [];

  const partRows = await db
    .select({ id: parts.id, mpn: parts.mpn })
    .from(parts)
    .where(inArray(parts.id, stalePartIds));
  return toItems(partRows);
}

function toItems(rows: Array<{ id: string; mpn: string | null }>): Array<{ partId: string; mpn: string }> {
  return rows
    .filter((r): r is { id: string; mpn: string } => !!r.mpn && r.mpn.trim() !== "")
    .map((r) => ({ partId: r.id, mpn: r.mpn }));
}

async function main(): Promise<void> {
  const mode = lifecycleMode ? "lifecycle (7d)" : "pricing (24h)";
  const items = await findCandidates();

  if (items.length === 0) {
    console.log(`[refresh] ${mode}: nothing stale — nothing to do.`);
  } else {
    console.log(`[refresh] ${mode}: refreshing ${items.length} parts…`);
    let processed = 0;
    let live = 0;
    let withOffers = 0;
    for (let i = 0; i < items.length; i += CHUNK_SIZE) {
      const chunk = items.slice(i, i + CHUNK_SIZE);
      const pricing = await getPricingFor(chunk, "all", { live: true, forceRefresh: true, purpose: "bulk-refresh" });
      for (const agg of pricing.values()) {
        live += agg.sourcesFromLive;
        if (agg.offers.length > 0) withOffers += 1;
      }
      processed += chunk.length;
      console.log(`[refresh] Processed ${processed} / ${items.length} parts`);
    }
    console.log(
      `[refresh] Done (${mode}). ${processed} parts refreshed, ${withOffers} returned offers, ${live} live source fetches.`,
    );
  }

  if (notifyMode) await generateNotifications();

  await getSqlClient().end();
}

// ─── Notification generation (--notify) ─────────────────────────────────────--

/**
 * For each recently-active project, diff its latest snapshot against a synthetic
 * "now" snapshot built from the refreshed cache, and persist notifications.
 * Deduplicated: skip a (projectKey, partId, type) seen within the last 24h.
 */
async function generateNotifications(): Promise<void> {
  const db = getDb();
  const since = new Date(Date.now() - SNAPSHOT_LOOKBACK_MS);

  const projectRows = await db
    .selectDistinct({ projectKey: bomSnapshots.projectKey })
    .from(bomSnapshots)
    .where(gte(bomSnapshots.takenAt, since));
  const projectKeys = projectRows.map((r) => r.projectKey);

  let totalNotifs = 0;
  let projectsWithNotifs = 0;

  for (const projectKey of projectKeys) {
    const [latest] = await db
      .select()
      .from(bomSnapshots)
      .where(eq(bomSnapshots.projectKey, projectKey))
      .orderBy(desc(bomSnapshots.takenAt))
      .limit(1);
    if (!latest) continue;

    const prevSnap: BomSnapshot = {
      id: latest.id,
      projectKey: latest.projectKey,
      label: latest.label,
      takenAt: latest.takenAt,
      rows: latest.snapshotData,
      meta: latest.bomMeta,
    };

    const nowRows = await buildSyntheticNowRows(prevSnap.rows);
    const nowSnap: BomSnapshot = {
      id: "now",
      projectKey,
      label: null,
      takenAt: new Date(),
      rows: nowRows,
      meta: prevSnap.meta,
    };

    const changes = diffSnapshots(prevSnap, nowSnap);
    if (changes.length === 0) continue;

    // Pre-load (partId,type) pairs already notified within the dedupe window.
    const dedupeSince = new Date(Date.now() - DEDUPE_WINDOW_MS);
    const recent = await db
      .select({ partId: bomNotifications.partId, type: bomNotifications.type })
      .from(bomNotifications)
      .where(
        and(eq(bomNotifications.projectKey, projectKey), gte(bomNotifications.createdAt, dedupeSince)),
      );
    const seen = new Set(recent.map((r) => `${r.partId}:${r.type}`));

    const infoByPart = new Map(prevSnap.rows.map((r) => [r.partId, r]));
    const inserts: NewBomNotification[] = [];
    for (const change of changes) {
      const part = infoByPart.get(change.partId);
      const draft = changeToNotification(change, {
        mpn: part?.mpn ?? null,
        manufacturer: part?.manufacturer ?? null,
        refDesList: part?.refDesList ?? [],
      });
      if (seen.has(`${change.partId}:${draft.type}`)) continue; // dedupe
      seen.add(`${change.partId}:${draft.type}`);
      inserts.push({
        projectKey,
        sourceSnapshotId: prevSnap.id,
        type: draft.type,
        severity: draft.severity,
        partId: change.partId,
        summary: draft.summary,
        detailsJson: draft.details,
      });
    }

    if (inserts.length > 0) {
      await db.insert(bomNotifications).values(inserts);
      totalNotifs += inserts.length;
      projectsWithNotifs += 1;
    }
  }

  console.log(`[refresh] Generated ${totalNotifs} notifications across ${projectsWithNotifs} projects.`);
}

/**
 * Rebuild SnapshotRows for the same parts/refDes/qty using current cached
 * market data (part_offers stock+price, parts.lifecycleStatus, alternates).
 */
async function buildSyntheticNowRows(prevRows: SnapshotRow[]): Promise<SnapshotRow[]> {
  const db = getDb();
  const partIds = [...new Set(prevRows.map((r) => r.partId).filter((id) => id !== ""))];
  if (partIds.length === 0) return prevRows.map((r) => ({ ...r }));

  // Current lifecycle per part.
  const partRows = await db
    .select({ id: parts.id, lifecycleStatus: parts.lifecycleStatus })
    .from(parts)
    .where(inArray(parts.id, partIds));
  const lifecycleById = new Map(partRows.map((p) => [p.id, p.lifecycleStatus ?? "unknown"]));

  // Current offers per part.
  const offerRows = await db.select().from(partOffers).where(inArray(partOffers.partId, partIds));
  const offersByPart = new Map<string, typeof offerRows>();
  for (const o of offerRows) {
    if (!isOfferServable(o.distributor, o.lastRefreshedAt)) continue; // [B19-A I3] the registry's serving rule
    const list = offersByPart.get(o.partId) ?? [];
    list.push(o);
    offersByPart.set(o.partId, list);
  }

  // Current alternates count (drop_in + fff) per part.
  const altRows = await db
    .select({ partId: alternates.partId, kind: alternates.kind })
    .from(alternates)
    .where(inArray(alternates.partId, partIds));
  const altCountByPart = new Map<string, number>();
  for (const a of altRows) {
    if (a.kind === "drop_in" || a.kind === "fff") {
      altCountByPart.set(a.partId, (altCountByPart.get(a.partId) ?? 0) + 1);
    }
  }

  return prevRows.map((prev) => {
    const offers = offersByPart.get(prev.partId) ?? [];
    const totalStock = offers.reduce((s, o) => s + (o.stock ?? 0), 0);

    let bestCents: number | null = null;
    let bestCurrency: string | null = null;
    let bestSource: string | null = null;
    for (const o of offers) {
      for (const b of o.priceBreaks ?? []) {
        if (b.price > 0 && (bestCents === null || b.price * 100 < bestCents)) {
          bestCents = Math.round(b.price * 100);
          bestCurrency = b.currency;
          bestSource = o.distributor;
        }
      }
    }

    return {
      ...prev,
      lifecycleStatus: lifecycleById.get(prev.partId) ?? prev.lifecycleStatus,
      totalStock,
      bestPriceCents: bestCents,
      bestPriceCurrency: bestCurrency,
      bestSourceDistributor: bestSource,
      alternatesCount: altCountByPart.get(prev.partId) ?? 0,
    };
  });
}

main().catch((err) => {
  console.error("[refresh] failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
  void getSqlClient().end();
});
