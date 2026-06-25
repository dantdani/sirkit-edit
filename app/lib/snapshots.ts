/**
 * BOM snapshots + snapshot-to-snapshot diffing (Stage 7).
 *
 * A snapshot is a compact, durable record of the supply-chain state of each
 * orderable part in a BOM (stock, best price, lifecycle, alternates, risk) —
 * NOT the full SchematicState. `diffSnapshots` compares two snapshots and emits
 * the significant supply-chain changes between them; user-driven edits
 * (parts added/removed) are intentionally NOT treated as changes.
 */

import type { BomRow } from "@/app/lib/bom/build";
import type { LifecycleStatus } from "@/app/lib/distributors/shared";
import { LIFECYCLE_SEVERITY } from "@/app/lib/distributors/lifecycle";

// ─── Thresholds ─────────────────────────────────────────────────────────────--
export const STOCK_DROP_THRESHOLD_PCT = 50; // ≥50% drop (or to zero) → notify
export const PRICE_SPIKE_THRESHOLD_PCT = 25; // ≥25% best-price increase → notify
export const ALTERNATE_NEW_MIN_COUNT_GAIN = 1; // ≥1 new alternate → info

// ─── Types ──────────────────────────────────────────────────────────────────--

export type SnapshotRow = {
  partId: string;
  mpn: string | null;
  manufacturer: string | null;
  refDesList: string[];
  qty: number;
  lifecycleStatus: LifecycleStatus;
  totalStock: number;
  bestPriceCents: number | null; // cents, to avoid float drift
  bestPriceCurrency: string | null;
  bestSourceDistributor: string | null;
  alternatesCount: number;
  riskScore: number;
};

export type BomSnapshotMeta = {
  totalRows: number;
  totalCostCents: number | null;
  currency: string | null;
  designRiskScore: number;
};

export type BomSnapshot = {
  id: string;
  projectKey: string;
  label: string | null;
  takenAt: Date;
  rows: SnapshotRow[];
  meta: BomSnapshotMeta;
};

export type Change =
  | { kind: "stock_dropped"; partId: string; before: number; after: number; pct: number }
  | { kind: "lifecycle_changed"; partId: string; before: LifecycleStatus; after: LifecycleStatus }
  | { kind: "price_spike"; partId: string; beforeCents: number; afterCents: number; pct: number; currency: string }
  | { kind: "alternate_available"; partId: string; alternateCountBefore: number; alternateCountAfter: number }
  | { kind: "supplier_lost"; partId: string };

// ─── BomRow → SnapshotRow ───────────────────────────────────────────────────--

/** Compact a live BomRow into a durable SnapshotRow (cents for price). */
export function rowToSnapshotRow(row: BomRow): SnapshotRow {
  const offers = row.pricing?.offers ?? [];
  const totalStock = offers.reduce((sum, o) => sum + (o.inStock ?? 0), 0);

  const best = row.pricing?.bestOverall ?? null;
  const bestUnit = best?.bestUnitPrice ?? null;
  const bestPriceCents = bestUnit === null ? null : Math.round(bestUnit * 100);
  const bestPriceCurrency =
    best && bestUnit !== null
      ? best.priceBreaks.find((b) => b.price === bestUnit)?.currency ?? "USD"
      : null;

  return {
    partId: row.partId ?? "",
    mpn: row.mpn,
    manufacturer: row.manufacturer,
    refDesList: row.refDesList,
    qty: row.qty,
    lifecycleStatus: row.lifecycleStatus,
    totalStock,
    bestPriceCents,
    bestPriceCurrency,
    bestSourceDistributor: best?.distributor ?? null,
    alternatesCount: row.alternatesCount,
    riskScore: row.riskScore.total,
  };
}

// ─── Diff ───────────────────────────────────────────────────────────────────--

function pctDrop(before: number, after: number): number {
  if (before <= 0) return after === 0 ? 0 : 0;
  return Math.round((1 - after / before) * 100);
}

function pctRise(before: number, after: number): number {
  if (before <= 0) return 0;
  return Math.round((after / before - 1) * 100);
}

/**
 * Significant supply-chain changes between two snapshots, keyed by the parts
 * present in BOTH. Parts only in one snapshot are user edits, not changes.
 */
export function diffSnapshots(prev: BomSnapshot, curr: BomSnapshot): Change[] {
  const prevByPart = new Map(prev.rows.map((r) => [r.partId, r]));
  const changes: Change[] = [];

  for (const after of curr.rows) {
    if (!after.partId) continue;
    const before = prevByPart.get(after.partId);
    if (!before) continue; // newly added part — not a supply-chain change

    // Stock dropped ≥50% or to zero.
    const droppedHalf = after.totalStock < before.totalStock * (STOCK_DROP_THRESHOLD_PCT / 100);
    const wentZero = before.totalStock > 0 && after.totalStock === 0;
    if (droppedHalf || wentZero) {
      changes.push({
        kind: "stock_dropped",
        partId: after.partId,
        before: before.totalStock,
        after: after.totalStock,
        pct: pctDrop(before.totalStock, after.totalStock),
      });
    }

    // Lifecycle worsened.
    if (LIFECYCLE_SEVERITY[after.lifecycleStatus] > LIFECYCLE_SEVERITY[before.lifecycleStatus]) {
      changes.push({
        kind: "lifecycle_changed",
        partId: after.partId,
        before: before.lifecycleStatus,
        after: after.lifecycleStatus,
      });
    }

    // Best price spiked ≥25%.
    if (
      before.bestPriceCents !== null &&
      after.bestPriceCents !== null &&
      after.bestPriceCents > before.bestPriceCents * (1 + PRICE_SPIKE_THRESHOLD_PCT / 100)
    ) {
      changes.push({
        kind: "price_spike",
        partId: after.partId,
        beforeCents: before.bestPriceCents,
        afterCents: after.bestPriceCents,
        pct: pctRise(before.bestPriceCents, after.bestPriceCents),
        currency: after.bestPriceCurrency ?? before.bestPriceCurrency ?? "USD",
      });
    }

    // New alternates appeared.
    if (after.alternatesCount - before.alternatesCount >= ALTERNATE_NEW_MIN_COUNT_GAIN) {
      changes.push({
        kind: "alternate_available",
        partId: after.partId,
        alternateCountBefore: before.alternatesCount,
        alternateCountAfter: after.alternatesCount,
      });
    }

    // The previously-best supplier no longer leads (changed/disappeared) while it
    // had stock before — a "supplier lost" signal.
    if (
      before.bestSourceDistributor !== null &&
      before.totalStock > 0 &&
      after.bestSourceDistributor !== before.bestSourceDistributor
    ) {
      changes.push({ kind: "supplier_lost", partId: after.partId });
    }
  }

  return changes;
}
