/**
 * BOM assembly — the shared core behind both /api/bom and /api/bom/export-csv.
 *
 * Walks a SchematicState's Theory components and Build-mode KiCad components,
 * groups them into line items, enriches KiCad rows with catalog metadata from
 * the DB, attaches live distributor pricing, and computes totals. Kept here (not
 * in a route) so the JSON route and the CSV route render the exact same BOM.
 */

import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/app/lib/db/client";
import { parts, libraries } from "@/app/lib/db/schema";
import type { SchematicState, SchComponentType } from "@/lib/schematic-types";
import {
  getPricingFor,
  missingCredentials,
  type AggregatedPricing,
  type DistributorChoice,
  type DistributorName,
} from "@/app/lib/distributors";

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
};

export type BomResult = {
  ok: true;
  rows: BomRow[];
  totalUnitsAvailable: { mpn: string; available: number | null }[];
  estimatedProjectCost: { value: number | null; currency: string | null };
  pricingSource: DistributorChoice;
  cached: number;
  fetched: number;
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
};

/** Currency of the price break that produced `bestUnitPrice`, defaulting USD. */
function currencyOfBest(pricing: AggregatedPricing | null): string | null {
  const best = pricing?.bestOverall;
  if (!best || best.bestUnitPrice === null) return null;
  const match = best.priceBreaks.find((b) => b.price === best.bestUnitPrice);
  return match?.currency ?? "USD";
}

export async function buildBom(
  state: SchematicState,
  pricingChoice: DistributorChoice,
  forceRefresh = false,
): Promise<BomResult> {
  const kicadComponents = state.kicadComponents ?? [];
  const components = state.components ?? [];

  // ── Group line items ────────────────────────────────────────────────────────
  const groups = new Map<string, Group>();

  for (const k of kicadComponents) {
    const key = `k|${k.partId}|${k.value}`;
    let g = groups.get(key);
    if (!g) {
      g = { partId: k.partId, type: null, value: k.value, refs: [] };
      groups.set(key, g);
    }
    g.refs.push(k.refDes);
  }

  for (const c of components) {
    if (c.type === "ground") continue; // a net reference, not an orderable part
    const key = `t|${c.type}|${c.value}`;
    let g = groups.get(key);
    if (!g) {
      g = { partId: null, type: c.type, value: c.value, refs: [] };
      groups.set(key, g);
    }
    g.refs.push(c.id);
  }

  // ── Enrich KiCad groups with catalog metadata (one DB round-trip) ────────────
  const partIds = [...new Set([...groups.values()].map((g) => g.partId).filter((p): p is string => p !== null))];
  const partMeta = await loadPartMeta(partIds);

  // ── Fetch pricing for every distinct part (by partId + its catalog MPN) ───────
  const partsForPricing: Array<{ partId: string; mpn: string }> = [];
  const seenPid = new Set<string>();
  for (const g of groups.values()) {
    if (!g.partId || seenPid.has(g.partId)) continue;
    const mpn = partMeta.get(g.partId)?.mpn ?? null;
    if (mpn) {
      partsForPricing.push({ partId: g.partId, mpn });
      seenPid.add(g.partId);
    }
  }

  const warnings: string[] = [];
  let pricingMap = new Map<string, AggregatedPricing>(); // keyed by partId
  let cached = 0;
  let fetched = 0;

  if (pricingChoice !== "none" && partsForPricing.length > 0) {
    for (const name of missingCredentials(pricingChoice)) {
      warnings.push(credentialWarning(name));
    }
    pricingMap = await getPricingFor(partsForPricing, pricingChoice, { forceRefresh });
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
    const mpn = meta?.mpn ?? null;
    const pricing = g.partId ? pricingMap.get(g.partId) ?? null : null;

    rows.push({
      partId: g.partId,
      refDes: refDesList.join(", "),
      refDesList,
      qty: refDesList.length,
      name: meta?.name ?? (g.type ? THEORY_LABEL[g.type] : "Unknown"),
      mpn,
      manufacturer: meta?.manufacturer ?? pricing?.bestOverall?.manufacturer ?? null,
      package: meta?.footprintHint ?? pricing?.bestOverall?.package ?? null,
      value: g.value || null,
      datasheet: meta?.datasheet ?? pricing?.bestOverall?.datasheet ?? null,
      category: meta?.mainCategory ?? (g.type ? "Theory" : null),
      pricing,
    });
  }

  rows.sort((a, b) => refDesSort(a.refDesList[0] ?? a.name, b.refDesList[0] ?? b.name));

  // ── Totals ───────────────────────────────────────────────────────────────────
  const totalUnitsAvailable = partsForPricing.map(({ partId, mpn }) => ({
    mpn,
    available: pricingMap.get(partId)?.bestOverall?.inStock ?? null,
  }));

  let costValue: number | null = null;
  let costCurrency: string | null = null;
  for (const row of rows) {
    const unit = row.pricing?.bestOverall?.bestUnitPrice ?? null;
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
    warnings,
  };
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

function credentialWarning(name: DistributorName): string {
  switch (name) {
    case "digikey":
      return "DigiKey API key not configured — add DIGIKEY_CLIENT_ID and DIGIKEY_CLIENT_SECRET to .env.local.";
    case "mouser":
      return "Mouser API key not configured — add MOUSER_API_KEY to .env.local.";
    case "lcsc":
      return "LCSC integration is not yet available (partner API access required).";
    case "octopart-aggregated":
      return "Octopart API key not configured — add OCTOPART_API_KEY (or NEXAR_API_KEY) to .env.local.";
  }
}

// ─── CSV serialization (shared with the export route) ──────────────────────────

function csvCell(v: string | number | null): string {
  const s = v === null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function bomToCsv(result: BomResult): string {
  const header = [
    "refDes",
    "Qty",
    "Name",
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
  ];

  const rows = result.rows.map((row) => {
    const best = row.pricing?.bestOverall ?? null;
    const unit = best?.bestUnitPrice ?? null;
    const currency = currencyOfBest(row.pricing);
    const ext = unit === null ? null : Number((unit * row.qty).toFixed(4));
    return [
      row.refDes,
      row.qty,
      row.name,
      row.mpn ?? "",
      row.manufacturer ?? "",
      row.package ?? "",
      row.value ?? "",
      unit ?? "",
      currency ?? "",
      ext ?? "",
      best?.inStock ?? "",
      row.datasheet ?? "",
      best?.productUrl ?? "",
    ];
  });

  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
}
