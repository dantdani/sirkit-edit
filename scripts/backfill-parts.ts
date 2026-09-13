/**
 * One-shot backfill for the Stage 1 BOM columns. Run with: `pnpm backfill:parts`
 *
 * Walks every row in `parts` in id order (batches of 500), computes the new
 * normalized fields, and writes them back. Updates within a batch are pipelined
 * over the postgres-js connection so 30k rows complete well under five minutes.
 *
 * Idempotent: all derivations are deterministic and no random ids are minted,
 * so re-running produces identical data.
 *
 * normalizedMpn note: only parts that actually carry an MPN get one (the column
 * exists for distributor MPN matching, and a UNIQUE partial index guards it).
 * We additionally skip duplicates — the first part in id order wins — so the
 * unique index can never be violated.
 */

import { loadEnvLocal } from "../app/lib/load-env-local";

loadEnvLocal();

import { count, eq } from "drizzle-orm";
import { getDb, getSqlClient } from "../app/lib/db/client";
import { parts, libraries } from "../app/lib/db/schema";
import {
  normalizeMpn,
  normalizePackage,
  categorizeForKeySpecs,
  extractKeySpecs,
  generateInternalPartNumber,
  deriveLifecycleStatusFromKicad,
  deriveRohsStatusFromKicad,
  type PartRow,
} from "../app/lib/parts-normalization";

const BATCH_SIZE = 500;

async function main(): Promise<void> {
  const db = getDb();

  const totalRows = await db.select({ value: count() }).from(parts);
  const total = Number(totalRows[0]?.value ?? 0);
  console.log(`[backfill] ${total} parts to process (batch ${BATCH_SIZE}).`);

  // Tracks normalized MPNs already assigned this run so the partial UNIQUE
  // index is never violated (first id wins, deterministically).
  const seenMpn = new Set<string>();

  let processed = 0;
  let normalizedCount = 0;
  let noMpn = 0;
  let unknownCat = 0;

  for (let offset = 0; offset < total; offset += BATCH_SIZE) {
    const rows = await db
      .select({
        id: parts.id,
        libraryId: parts.libraryId,
        name: parts.name,
        description: parts.description,
        keywords: parts.keywords,
        mpn: parts.mpn,
        manufacturer: parts.manufacturer,
        datasheet: parts.datasheet,
        footprintHint: parts.footprintHint,
        properties: parts.properties,
        pins: parts.pins,
        symbolRaw: parts.symbolRaw,
        embedding: parts.embedding,
        normalizedMpn: parts.normalizedMpn,
        internalPartNumber: parts.internalPartNumber,
        lifecycleStatus: parts.lifecycleStatus,
        rohsStatus: parts.rohsStatus,
        packageNormalized: parts.packageNormalized,
        keySpecs: parts.keySpecs,
        lastRefreshedAt: parts.lastRefreshedAt,
        createdAt: parts.createdAt,
        updatedAt: parts.updatedAt,
        libraryName: libraries.name,
      })
      .from(parts)
      .innerJoin(libraries, eq(parts.libraryId, libraries.id))
      .orderBy(parts.id)
      .limit(BATCH_SIZE)
      .offset(offset);

    const updates = rows.map((row) => {
      const part = row as PartRow;

      // normalizedMpn — real MPNs only, deduped to honor the unique index.
      let normalized: string | null = null;
      if (part.mpn && part.mpn.trim() !== "") {
        const candidate = normalizeMpn(part.mpn);
        if (candidate !== "" && !seenMpn.has(candidate)) {
          seenMpn.add(candidate);
          normalized = candidate;
        }
      } else {
        noMpn++;
      }
      if (normalized) normalizedCount++;

      const pkg = normalizePackage(
        part.footprintHint ?? part.properties?.["Package"] ?? part.properties?.["package"] ?? null,
      );
      const kind = categorizeForKeySpecs(part);
      if (kind === "unknown") unknownCat++;
      const specs = extractKeySpecs(part);
      const ipn = generateInternalPartNumber(part, specs, pkg);
      const lifecycle = deriveLifecycleStatusFromKicad(part);
      const rohs = deriveRohsStatusFromKicad(part);

      return db
        .update(parts)
        .set({
          normalizedMpn: normalized,
          internalPartNumber: ipn,
          lifecycleStatus: lifecycle,
          lastRefreshedAt: null, // [B19-D I5b review] a KiCad-derived status carries no vendor stamp
          rohsStatus: rohs,
          packageNormalized: pkg,
          keySpecs: specs,
        })
        .where(eq(parts.id, part.id));
    });

    // Pipeline the batch's updates over the connection.
    await Promise.all(updates);

    processed += rows.length;
    console.log(`[backfill] Processed ${processed} / ${total} parts`);

    if (rows.length < BATCH_SIZE) break;
  }

  console.log(
    `[backfill] Done. ${normalizedCount} normalized, ${noMpn} had no MPN, ${unknownCat} had unknown category.`,
  );

  await getSqlClient().end();
}

main().catch((err) => {
  console.error("[backfill] failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
  void getSqlClient().end();
});
