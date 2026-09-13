/**
 * BOM assembly — the shared core behind both /api/bom and /api/bom/export-csv.
 *
 * Walks a SchematicState's Theory components and Build-mode KiCad components,
 * groups them into line items, enriches KiCad rows with catalog metadata from
 * the DB, attaches live distributor pricing, and computes totals. Kept here (not
 * in a route) so the JSON route and the CSV route render the exact same BOM.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/app/lib/db/client";
import { parts, libraries, alternates } from "@/app/lib/db/schema";
import type { SchematicState, SchComponentType } from "@/lib/schematic-types";
import { schDisplayRef } from "@/lib/schematic-types";
import {
  getPricingFor,
  pausedSources,
  pricingKey,
  unavailableSources,
  type AggregatedPricing,
  type DistributorChoice,
  type LifecycleStatus,
} from "@/app/lib/distributors";
import {
  computeLineRisk,
  computeDesignRisk,
  type LineRiskBreakdown,
  type DesignRiskSummary,
} from "@/app/lib/risk-scoring";
import type { ProjectComponentPin } from "@/app/lib/atomic/types";
import { PRICING_CURRENCY } from "@/app/lib/distributors/types"; // [B19-D I5b row 20]
import { lineUnitPrice } from "@/app/lib/bom/line-price"; // [B19-D I5b review]

export { lineUnitPrice };
import { safeSpreadsheetCell } from "@/app/lib/atomic/security";
import { safeHref } from "@/app/lib/net/href-policy"; // [B19-D I5c review]
import { vendorProductPageUrl } from "@/app/lib/distributor-links"; // [B19-D I5c review]

const THEORY_LABEL: Record<SchComponentType, string> = {
  resistor: "Resistor",
  capacitor: "Capacitor",
  inductor: "Inductor",
  diode: "Diode",
  "voltage-source": "Voltage source",
  "current-source": "Current source",
  ground: "Ground",
};

export type BomRow = {
  partId: string | null; // FK to parts table, null for SchComponent (Theory)
  atomicRevisionId: string | null;
  refDes: string; // pretty list, e.g. "U1, U2"
  refDesList: string[]; // individual refDes values
  qty: number;
  name: string; // e.g. "ATmega328P-AU" or "Resistor"
  mpn: string | null;
  manufacturer: string | null;
  package: string | null;
  value: string | null; // e.g. "10k" for passives
  datasheet: string | null;
  category: string | null;
  pricing: AggregatedPricing | null; // null if choice is "none" or no data
  lifecycleStatus: LifecycleStatus; // consolidated; fresh from offers, else persisted
  alternatesCount: number; // # of precomputed drop_in + fff alternates
  riskScore: LineRiskBreakdown; // synthesized supply-chain risk (Stage 5)
};

/** Aggregate lifecycle counts + a single risk verdict for the whole BOM. */
export type BomLifecycleSummary = {
  active: number;
  nrnd: number;
  last_time_buy: number;
  eol: number;
  obsolete: number;
  unknown: number;
  totalRows: number;
  riskRecommendation: "ok" | "review" | "blocked";
};

export type BomResult = {
  ok: true;
  rows: BomRow[];
  totalUnitsAvailable: { mpn: string; available: number | null }[];
  estimatedProjectCost: { value: number | null; currency: string | null };
  pricingSource: DistributorChoice;
  cached: number;
  fetched: number;
  lifecycleSummary: BomLifecycleSummary;
  riskSummary: DesignRiskSummary;
  warnings: string[];
};

// Natural refDes order: alpha prefix, then numeric suffix (R2 < R10).
export function refDesSort(a: string, b: string): number {
  const ma = a.match(/^([A-Za-z]+)(\d*)$/);
  const mb = b.match(/^([A-Za-z]+)(\d*)$/);
  if (ma && mb) {
    if (ma[1] !== mb[1]) return ma[1].localeCompare(mb[1]);
    return (parseInt(ma[2] || "0", 10) || 0) - (parseInt(mb[2] || "0", 10) || 0);
  }
  return a.localeCompare(b);
}

type Group = {
  partId: string | null;
  type: SchComponentType | null;
  value: string;
  refs: string[];
  componentInstanceIds: string[];
  atomicRevisionId: string | null;
};

/** [B19-D I5b row 20] Every unit price is in the one pricing currency (`cheapestUnitPrice`), so that is its currency. */
function currencyOfBest(pricing: AggregatedPricing | null): string | null {
  const best = pricing?.bestOverall;
  if (!best || best.bestUnitPrice === null) return null;
  return PRICING_CURRENCY;
}

export async function buildBom(
  state: SchematicState,
  pricingChoice: DistributorChoice,
  /** [B19-B I2] `live` must be granted by an authenticated caller; the default prices from the cache only. */
  pricing: { live?: boolean; forceRefresh?: boolean } = {},
  componentSelections: Readonly<Record<string, ProjectComponentPin>> = {},
): Promise<BomResult> {
  const kicadComponents = state.kicadComponents ?? [];
  const components = state.components ?? [];

  // ── Group line items ────────────────────────────────────────────────────────
  const groups = new Map<string, Group>();

  for (const k of kicadComponents) {
    const key = `k|${k.atomicPartRevisionId ?? k.partId}|${k.value}`;
    let g = groups.get(key);
    if (!g) {
      g = { partId: k.partId, type: null, value: k.value, refs: [], componentInstanceIds: [], atomicRevisionId: k.atomicPartRevisionId ?? null };
      groups.set(key, g);
    }
    g.refs.push(k.refDes);
    g.componentInstanceIds.push(k.id);
  }

  for (const c of components) {
    if (c.type === "ground") continue; // a net reference, not an orderable part
    const key = `t|${c.type}|${c.value}`;
    let g = groups.get(key);
    if (!g) {
      g = { partId: null, type: c.type, value: c.value, refs: [], componentInstanceIds: [], atomicRevisionId: null };
      groups.set(key, g);
    }
    // B07.1 — the BOM line shows the DISPLAYED reference (refDes ?? id).
    g.refs.push(schDisplayRef(c));
  }

  // ── Enrich KiCad groups with catalog metadata (one DB round-trip) ────────────
  const partIds = [...new Set([...groups.values()]
    .filter((group) => !group.componentInstanceIds.some((id) => componentSelections[id]))
    .map((g) => g.partId)
    .filter((p): p is string => p !== null))];
  const [partMeta, alternatesCounts] = await Promise.all([
    loadPartMeta(partIds),
    loadAlternatesCounts(partIds),
  ]);

  // ── Fetch pricing for every distinct (part, exact MPN) ───────────────────────
  // [B19-D I5b row 36] keyed by the exact MPN too: two exact parts filed under one catalog row are priced separately
  const partsForPricing: Array<{ partId: string; mpn: string }> = [];
  const seenPricing = new Set<string>();
  for (const g of groups.values()) {
    if (!g.partId) continue;
    const pinned = g.componentInstanceIds.map((id) => componentSelections[id]).find(Boolean)?.embeddedSnapshot;
    const mpn = pinned?.exactPart?.exactMpn ?? partMeta.get(g.partId)?.mpn ?? null;
    if (mpn && !seenPricing.has(pricingKey(g.partId, mpn))) {
      partsForPricing.push({ partId: g.partId, mpn });
      seenPricing.add(pricingKey(g.partId, mpn));
    }
  }

  const warnings: string[] = [];
  let pricingMap = new Map<string, AggregatedPricing>(); // keyed by pricingKey(partId, exact MPN)
  let cached = 0;
  let fetched = 0;

  if (pricingChoice !== "none" && partsForPricing.length > 0) {
    // [B19-A I3] each unavailable source says why: blocked, disabled (with its owner decision), switched off, or missing credentials
    for (const source of unavailableSources(pricingChoice)) {
      warnings.push(source.message);
    }
    pricingMap = await getPricingFor(partsForPricing, pricingChoice, { live: pricing.live === true, forceRefresh: pricing.forceRefresh === true });
    if (pricing.live !== true) {
      warnings.push("Prices shown are cached offers only. Live distributor pricing is fetched in the BOM workbench by a project member.");
    } else {
      // [B19-B I3b] a source whose quota is used up or whose breaker is open says so, and when it may be tried again
      for (const paused of pausedSources(pricingChoice)) warnings.push(paused.message);
    }
    // Counts are per (part, source): sum the aggregator's per-source tallies.
    for (const agg of pricingMap.values()) {
      cached += agg.sourcesFromCache;
      fetched += agg.sourcesFromLive;
    }
  }

  // ── Assemble rows ────────────────────────────────────────────────────────────
  const rows: BomRow[] = [];
  for (const g of groups.values()) {
    const refDesList = [...g.refs].sort(refDesSort);
    const meta = g.partId ? partMeta.get(g.partId) : undefined;
    const pinned = g.componentInstanceIds.map((id) => componentSelections[id]).find(Boolean)?.embeddedSnapshot;
    const mpn = pinned?.exactPart?.exactMpn ?? meta?.mpn ?? null;
    const pricing = g.partId && mpn ? pricingMap.get(pricingKey(g.partId, mpn)) ?? null : null;

    // Lifecycle is sourced from the aggregator's consolidated verdict, which
    // already folds in cached offers. We deliberately do NOT fall back to the
    // part's stored lifecycleStatus: Stage 1 seeded that to "active" for every
    // part, and the contract here is "no distributor data → unknown".
    const lifecycleStatus: LifecycleStatus = pricing?.lifecycleStatus ?? "unknown";

    rows.push({
      partId: g.partId,
      atomicRevisionId: pinned?.atomicRevision.id ?? g.atomicRevisionId,
      refDes: refDesList.join(", "),
      refDesList,
      qty: refDesList.length,
      name: pinned?.exactPart?.exactMpn ?? pinned?.genericDevice?.name ?? meta?.name ?? (g.type ? THEORY_LABEL[g.type] : "Unknown"),
      mpn,
      manufacturer: pinned?.manufacturer?.canonicalName ?? meta?.manufacturer ?? pricing?.bestOverall?.manufacturer ?? null,
      package: pinned?.footprint
        ? `${pinned.footprint.origin.libraryNickname}:${pinned.footprint.footprintName}`
        : meta?.footprintHint ?? pricing?.bestOverall?.package ?? null,
      value: g.value || null,
      datasheet: meta?.datasheet ?? pricing?.bestOverall?.datasheet ?? null,
      category: meta?.mainCategory ?? (g.type ? "Theory" : null),
      pricing,
      lifecycleStatus,
      alternatesCount: g.partId ? alternatesCounts.get(g.partId) ?? 0 : 0,
      riskScore: computeLineRisk({ pricing, lifecycleStatus }),
    });
  }

  rows.sort((a, b) => refDesSort(a.refDesList[0] ?? a.name, b.refDesList[0] ?? b.name));

  // ── Totals ───────────────────────────────────────────────────────────────────
  const totalUnitsAvailable = partsForPricing.map(({ partId, mpn }) => ({
    mpn,
    available: pricingMap.get(pricingKey(partId, mpn))?.bestOverall?.inStock ?? null,
  }));

  let costValue: number | null = null;
  let costCurrency: string | null = null;
  for (const row of rows) {
    // [B19-D I5b row 20 + review] the unit price that applies at the line's quantity — the same one the table and CSV show
    const unit = lineUnitPrice(row);
    if (unit === null) continue;
    costValue = (costValue ?? 0) + unit * row.qty;
    costCurrency = costCurrency ?? currencyOfBest(row.pricing);
  }

  return {
    ok: true,
    rows,
    totalUnitsAvailable,
    estimatedProjectCost: { value: costValue, currency: costCurrency },
    pricingSource: pricingChoice,
    cached,
    fetched,
    lifecycleSummary: summarizeLifecycle(rows),
    riskSummary: computeDesignRisk(rows),
    warnings,
  };
}

/** Tally lifecycle states across rows and derive the overall risk verdict. */
function summarizeLifecycle(rows: BomRow[]): BomLifecycleSummary {
  const summary: BomLifecycleSummary = {
    active: 0,
    nrnd: 0,
    last_time_buy: 0,
    eol: 0,
    obsolete: 0,
    unknown: 0,
    totalRows: rows.length,
    riskRecommendation: "ok",
  };
  for (const row of rows) summary[row.lifecycleStatus] += 1;

  if (summary.eol > 0 || summary.obsolete > 0) summary.riskRecommendation = "blocked";
  else if (summary.nrnd > 0 || summary.last_time_buy > 0) summary.riskRecommendation = "review";
  else summary.riskRecommendation = "ok";

  return summary;
}

// ─── Catalog metadata ──────────────────────────────────────────────────────────

type PartMeta = {
  id: string;
  name: string;
  mpn: string | null;
  manufacturer: string | null;
  datasheet: string | null;
  footprintHint: string | null;
  mainCategory: string;
};

async function loadPartMeta(partIds: string[]): Promise<Map<string, PartMeta>> {
  const map = new Map<string, PartMeta>();
  if (partIds.length === 0) return map;

  const db = getDb();
  const rows = await db
    .select({
      id: parts.id,
      name: parts.name,
      mpn: parts.mpn,
      manufacturer: parts.manufacturer,
      datasheet: parts.datasheet,
      footprintHint: parts.footprintHint,
      mainCategory: libraries.mainCategory,
    })
    .from(parts)
    .innerJoin(libraries, eq(parts.libraryId, libraries.id))
    .where(inArray(parts.id, partIds));

  for (const r of rows) map.set(r.id, r);
  return map;
}

/** partId → count of drop_in + fff alternates, in one grouped query (no N+1). */
async function loadAlternatesCounts(partIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (partIds.length === 0) return map;

  const db = getDb();
  const rows = await db
    .select({ partId: alternates.partId, count: sql<number>`count(*)` })
    .from(alternates)
    .where(
      and(
        inArray(alternates.partId, partIds),
        inArray(alternates.kind, ["drop_in", "fff"]),
      ),
    )
    .groupBy(alternates.partId);

  for (const r of rows) map.set(r.partId, Number(r.count));
  return map;
}

// ─── CSV serialization (shared with the export route) ──────────────────────────

function csvCell(v: string | number | null): string {
  const s = v === null ? "" : safeSpreadsheetCell(String(v));
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; // [B19-D I5c row 10] a lone CR is quoted too
}

export function bomToCsv(result: BomResult): string {
  const header = [
    "refDes",
    "Qty",
    "Name",
    "Sirkit Atomic Revision",
    "MPN",
    "Manufacturer",
    "Package",
    "Value",
    "Best Unit Price",
    "Currency",
    "Extended Price",
    "In Stock",
    "Datasheet",
    "Distributor URL",
    "Risk Score",
    "Risk Grade",
    "Risk Notes",
  ];

  const rows = result.rows.map((row) => {
    const best = row.pricing?.bestOverall ?? null;
    const unit = lineUnitPrice(row); // [B19-D I5b review] the price the line's quantity reaches, as the estimate uses
    const currency = unit === null ? null : currencyOfBest(row.pricing);
    const ext = unit === null ? null : Number((unit * row.qty).toFixed(4));
    return [
      row.refDes,
      row.qty,
      row.name,
      row.atomicRevisionId ?? "",
      row.mpn ?? "",
      row.manufacturer ?? "",
      row.package ?? "",
      row.value ?? "",
      unit ?? "",
      currency ?? "",
      ext ?? "",
      best?.inStock ?? "",
      // [B19-D I5c review] the link columns follow the same policy as the view and the procurement packet
      safeHref(row.datasheet, "document") ?? "",
      vendorProductPageUrl(best?.productUrl) ?? "",
      row.riskScore.total,
      row.riskScore.grade,
      row.riskScore.notes.join("; "),
    ];
  });

  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
}
