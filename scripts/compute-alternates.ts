/**
 * One-shot backfill that populates the `alternates` table. Run with:
 *   pnpm compute:alternates
 *
 * Walks every part that has normalized spec data (keySpecs.kind != 'unknown'
 * AND packageNormalized IS NOT NULL), finds candidate alternates, scores them,
 * and persists the top 20 per source part.
 *
 * Idempotent + resumable: scoring is deterministic, and any part whose
 * alternates were computed within the last 7 days is skipped — so an interrupted
 * run picks up where it left off, and a re-run is a no-op.
 *
 * Estimated runtime scales with the number of spec'd parts and group sizes.
 */

import { loadEnvLocal } from "../app/lib/load-env-local";

loadEnvLocal();

import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { getDb, getSqlClient } from "../app/lib/db/client";
import { parts, partOffers, alternates, type Part, type PartOffer } from "../app/lib/db/schema";
import {
  findCandidateAlternates,
  computeAlternateScore,
  type AlternateMatch,
} from "../app/lib/alternates";

const BATCH_SIZE = 500;
const TOP_N = 20;
const SKIP_IF_COMPUTED_WITHIN_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const summary = { scanned: 0, skipped: 0, withAlternates: 0, pairsWritten: 0 };

async function main(): Promise<void> {
  const db = getDb();

  // Only parts with usable spec data can have alternates.
  const specFilter = and(
    isNotNull(parts.packageNormalized),
    sql`(${parts.keySpecs} ->> 'kind') IS NOT NULL`,
    sql`(${parts.keySpecs} ->> 'kind') <> 'unknown'`,
  );

  const totalRow = await db
    .select({ value: sql<number>`count(*)` })
    .from(parts)
    .where(specFilter);
  const total = Number(totalRow[0]?.value ?? 0);
  console.log(`[alternates] ${total} parts with spec data to scan (batch ${BATCH_SIZE}).`);

  for (let offset = 0; offset < total; offset += BATCH_SIZE) {
    const sources = await db
      .select()
      .from(parts)
      .where(specFilter)
      .orderBy(parts.id)
      .limit(BATCH_SIZE)
      .offset(offset);
    if (sources.length === 0) break;

    const recent = await recentlyComputed(sources.map((s) => s.id));

    for (const source of sources) {
      summary.scanned += 1;
      if (recent.has(source.id)) {
        summary.skipped += 1;
        continue;
      }
      await processPart(source);
    }

    console.log(`[alternates] Processed ${Math.min(offset + sources.length, total)} / ${total} parts`);
    if (sources.length < BATCH_SIZE) break;
  }

  console.log(
    `[alternates] Done. scanned=${summary.scanned}, skipped(recent)=${summary.skipped}, ` +
      `withAlternates=${summary.withAlternates}, pairsWritten=${summary.pairsWritten}.`,
  );

  await getSqlClient().end();
}

/** partIds whose alternates were computed within the skip window. */
async function recentlyComputed(partIds: string[]): Promise<Set<string>> {
  const db = getDb();
  const cutoff = new Date(Date.now() - SKIP_IF_COMPUTED_WITHIN_MS);
  const rows = await db
    .select({ partId: alternates.partId, computedAt: sql<Date>`max(${alternates.computedAt})` })
    .from(alternates)
    .where(inArray(alternates.partId, partIds))
    .groupBy(alternates.partId);
  const fresh = new Set<string>();
  for (const r of rows) {
    if (r.computedAt && new Date(r.computedAt) >= cutoff) fresh.add(r.partId);
  }
  return fresh;
}

async function processPart(source: Part): Promise<void> {
  const db = getDb();
  const matches = await findCandidateAlternates(source.id);
  if (matches.length === 0) {
    // Clear any stale rows so a part that lost all alternates ends up empty.
    await db.delete(alternates).where(eq(alternates.partId, source.id));
    return;
  }

  const altIds = matches.map((m) => m.alternatePartId);
  const altParts = await db.select().from(parts).where(inArray(parts.id, altIds));
  const altById = new Map(altParts.map((p) => [p.id, p]));

  // One offers query for the source + all candidate alternates.
  const offerRows = await db
    .select()
    .from(partOffers)
    .where(inArray(partOffers.partId, [source.id, ...altIds]));
  const offersByPart = new Map<string, PartOffer[]>();
  for (const o of offerRows) {
    const list = offersByPart.get(o.partId) ?? [];
    list.push(o);
    offersByPart.set(o.partId, list);
  }
  const sourceOffers = offersByPart.get(source.id) ?? [];

  const scored: AlternateMatch[] = [];
  for (const m of matches) {
    const alt = altById.get(m.alternatePartId);
    if (!alt) continue;
    const altOffers = offersByPart.get(m.alternatePartId) ?? [];
    const { score, reasons } = computeAlternateScore(source, alt, m.kind, altOffers, sourceOffers);
    scored.push({ ...m, score, matchReasons: reasons });
  }

  // Deterministic ranking: score desc, then alternatePartId for stable ties.
  scored.sort((a, b) => b.score - a.score || a.alternatePartId.localeCompare(b.alternatePartId));
  const top = scored.slice(0, TOP_N);

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.delete(alternates).where(eq(alternates.partId, source.id));
    if (top.length > 0) {
      await tx.insert(alternates).values(
        top.map((m) => ({
          partId: m.partId,
          alternatePartId: m.alternatePartId,
          kind: m.kind,
          score: m.score,
          matchReasons: m.matchReasons,
          computedAt: now,
        })),
      );
    }
  });

  if (top.length > 0) {
    summary.withAlternates += 1;
    summary.pairsWritten += top.length;
  }
}

main().catch((err) => {
  console.error("[alternates] failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
  void getSqlClient().end();
});
