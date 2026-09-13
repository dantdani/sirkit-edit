/**
 * Distributor-formatted CSV builders (Stage 6).
 *
 * Each `to*Csv` produces an RFC 4180-compliant string (double-quote escaping,
 * CRLF line endings) whose column headers match the distributor's BOM-upload
 * tool exactly — uploaders match by header name. Rows lacking a usable
 * identifier (SKU and MPN) are skipped; rows with an MPN but no distributor SKU
 * are included MPN-only so the uploader can search by MPN.
 */

import type { BomRow } from "@/app/lib/bom/build";
import type { PartPricing } from "@/app/lib/distributors";
import { digiKeyProductUrl, mouserProductUrl } from "./distributor-links";
import { cheapestUnitPrice, PRICING_CURRENCY } from "./distributors/types"; // [B19-D I5b row 20]

const CRLF = "\r\n";
import { spreadsheetText } from "./spreadsheet-cell"; // [B19-D I5c row 09]
import { safeHref, VENDOR_PAGE_HOSTS } from "./net/href-policy";
import { sourceForDistributorName } from "./acquisition/source-registry"; // [B19-E E1] browser-safe registry

// ─── RFC 4180 helpers ───────────────────────────────────────────────────────--

function csvCell(value: string | number | null | undefined): string {
  // [B19-D I5c row 09] text cells never start a formula; numbers stay numbers
  const s = value === null || value === undefined ? "" : typeof value === "number" ? String(value) : spreadsheetText(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvRow(cells: Array<string | number | null | undefined>): string {
  return cells.map(csvCell).join(",");
}

function csvDocument(lines: string[]): string {
  // Trailing CRLF keeps strict parsers happy.
  return lines.join(CRLF) + CRLF;
}

// ─── Row accessors ──────────────────────────────────────────────────────────--

function offerFor(row: BomRow, distributor: PartPricing["distributor"]): PartPricing | null {
  return row.pricing?.offers.find((o) => o.distributor === distributor) ?? null;
}

function skuFor(row: BomRow, distributor: PartPricing["distributor"]): string | null {
  return offerFor(row, distributor)?.sku ?? null;
}

function refList(row: BomRow): string {
  return row.refDesList.join(",");
}

function descriptionFor(row: BomRow): string {
  return (
    row.pricing?.bestOverall?.description ??
    row.pricing?.offers.find((o) => o.description)?.description ??
    row.name ??
    ""
  );
}

/** Unit price at quantity 1, in the pricing currency. [B19-D I5b row 20] never another currency's number. */
function priceAtQty1(offer: PartPricing | null): number | null {
  if (!offer || offer.priceBreaks.length === 0) return null;
  return cheapestUnitPrice(offer.priceBreaks, { quantity: 1 });
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}

/** Round a price to 4 decimals, dropping binary-float noise for clean CSVs. */
function money(n: number | null): number | "" {
  return n === null ? "" : Number(n.toFixed(4));
}

// ─── DigiKey BOM Manager ────────────────────────────────────────────────────--

export function toDigiKeyCsv(rows: BomRow[]): string {
  const header = [
    "Digi-Key Part Number",
    "Manufacturer Part Number",
    "Manufacturer",
    "Quantity",
    "Customer Reference",
  ];
  const lines = [csvRow(header)];
  for (const row of rows) {
    const sku = skuFor(row, "digikey");
    if (!sku && !row.mpn) continue; // no way for the uploader to find it
    lines.push(csvRow([sku ?? "", row.mpn ?? "", row.manufacturer ?? "", row.qty, refList(row)]));
  }
  return csvDocument(lines);
}

// ─── Mouser Project Cart ────────────────────────────────────────────────────--

export function toMouserCsv(rows: BomRow[]): string {
  const header = [
    "Mouser Part Number",
    "Manufacturer Part Number",
    "Manufacturer",
    "Quantity",
    "Customer Number",
    "Description",
  ];
  const lines = [csvRow(header)];
  for (const row of rows) {
    const sku = skuFor(row, "mouser");
    if (!sku && !row.mpn) continue;
    lines.push(
      csvRow([
        sku ?? "",
        row.mpn ?? "",
        row.manufacturer ?? "",
        row.qty,
        refList(row),
        truncate(descriptionFor(row), 100),
      ]),
    );
  }
  return csvDocument(lines);
}

// ─── LCSC BOM Tool (generic) ────────────────────────────────────────────────--

export function toLcscCsv(rows: BomRow[]): string {
  const header = [
    "C# (LCSC Part Number)",
    "Manufacturer Part Number",
    "Manufacturer",
    "Quantity",
    "Reference",
  ];
  const lines = [csvRow(header)];
  for (const row of rows) {
    if (!row.mpn) continue; // LCSC matches by MPN; no MPN → unusable
    lines.push(
      csvRow([skuFor(row, "lcsc") ?? "", row.mpn, row.manufacturer ?? "", row.qty, refList(row)]),
    );
  }
  return csvDocument(lines);
}

// ─── Procurement packet (comprehensive) ─────────────────────────────────────--

const PACKET_COLUMNS = [
  "Line",
  "RefDes",
  "Qty Per Board",
  "Build Qty",
  "Total Required",
  "MPN",
  "Manufacturer",
  "Description",
  "Package",
  "Value",
  "Lifecycle",
  "DigiKey SKU",
  "DigiKey URL",
  "DigiKey Price (1)",
  "Mouser SKU",
  "Mouser URL",
  "Mouser Price (1)",
  "Best Source",
  "Best Unit Price",
  "Currency",
  "Extended Cost",
  "Risk Score",
  "Risk Notes",
  // [B19-E E1] appended, so every earlier column keeps its index
  "Best Source Observed At (UTC)",
  "Best Source Basis",
];

const SERVED_FROM_CELL: Record<NonNullable<PartPricing["provenance"]>["servedFrom"], string> = {
  live: "live (vendor answer)",
  "process-memo": "cached (recent answer)",
  "offer-cache": "cached (offer cache)",
};

/** [B19-E E1] When the best offer's vendor answered, and whether it was live or cached. */
function observationCells(best: PartPricing | null): [string, string] {
  if (!best) return ["", ""];
  const servedFrom = best.provenance?.servedFrom ?? (best.evidence ? "live" : "offer-cache");
  const at = best.provenance?.retrievedAt ?? best.evidence?.retrievedAt ?? best.fetchedAt;
  return [Number.isFinite(at) && at > 0 ? new Date(at).toISOString() : "", SERVED_FROM_CELL[servedFrom]];
}

/** [B19-E E1] The attribution each source's terms require, for the sources whose offers appear in the packet. */
function licenseLine(rows: BomRow[]): string {
  const attributions: string[] = [];
  for (const row of rows) {
    for (const offer of row.pricing?.offers ?? []) {
      const entry = sourceForDistributorName(offer.distributor);
      if (entry && !attributions.includes(`${entry.displayName}: ${entry.license.attribution}`)) attributions.push(`${entry.displayName}: ${entry.license.attribution}`);
    }
  }
  return attributions.length === 0
    ? "License: no distributor data in this packet."
    : `License: ${attributions.join("; ")}. Distributor values are for this project's sourcing review only and not for redistribution (OD-39).`;
}

const SOURCE_LABEL: Record<PartPricing["distributor"], string> = {
  digikey: "DigiKey",
  mouser: "Mouser",
  "octopart-aggregated": "Octopart",
  lcsc: "LCSC",
};

/** [B19-D I5b row 20] Every unit price is in the one pricing currency, so every priced line and the total are too. */
function bestCurrency(): string {
  return PRICING_CURRENCY;
}

export function toProcurementPacketCsv(
  rows: BomRow[],
  meta: { title: string; buildQuantity: number; date: Date; notes?: string; pricingMode?: "none" | "cache-only" | "live"; warnings?: readonly string[] },
): string {
  const buildQty = Math.max(1, Math.floor(meta.buildQuantity) || 1);
  const lines: string[] = [];

  // Metadata header section (single-cell rows).
  lines.push(csvRow([`Project: ${meta.title}`]));
  lines.push(csvRow([`Build Quantity: ${buildQty}`]));
  lines.push(csvRow([`Date: ${meta.date.toISOString().slice(0, 10)}`]));
  lines.push(csvRow([`Notes: ${meta.notes ?? ""}`]));
  // [B19-E E1] what this file is, how its prices were obtained, and the sources' terms
  lines.push(csvRow(["Status: sourcing worksheet of observed distributor offers; not verified procurement. No order was placed. Prices and stock and lifecycle may have changed since each observation."]));
  lines.push(csvRow([meta.pricingMode === "live"
    ? "Pricing basis: live vendor answers where a source answered and cached offers otherwise; each line's observation time and basis are in the last two columns."
    : "Pricing basis: cached offers only (no vendor was asked for this file); each line's observation time and basis are in the last two columns."]));
  lines.push(csvRow([licenseLine(rows)]));
  for (const warning of meta.warnings ?? []) lines.push(csvRow([`Warning: ${warning}`]));
  lines.push("");
  lines.push(csvRow(PACKET_COLUMNS));

  let totalCost = 0;
  let totalCurrency = "USD";
  let sawPrice = false;

  rows.forEach((row, i) => {
    const totalRequired = row.qty * buildQty;
    const dk = offerFor(row, "digikey");
    const mo = offerFor(row, "mouser");
    const dkPrice1 = priceAtQty1(dk);
    const moPrice1 = priceAtQty1(mo);
    const best = row.pricing?.bestOverall ?? null;
    // [B19-D I5b row 20] the price at the quantity actually ordered, in the pricing currency
    const bestUnit = best ? cheapestUnitPrice(best.priceBreaks, { quantity: totalRequired }) : null;
    const currency = bestCurrency();
    const extended = bestUnit === null ? null : Number((bestUnit * totalRequired).toFixed(4));
    if (extended !== null) {
      totalCost += extended;
      totalCurrency = currency;
      sawPrice = true;
    }

    // [B19-D I5c row 09] a stored vendor link is used only when it is an HTTPS page on a distributor's domain
    const dkUrl = safeHref(dk?.productUrl, "page", VENDOR_PAGE_HOSTS) ?? (dk?.sku ?? row.mpn ? digiKeyProductUrl(dk?.sku ?? row.mpn ?? "") : "");
    const moUrl = safeHref(mo?.productUrl, "page", VENDOR_PAGE_HOSTS) ?? (mo?.sku ?? row.mpn ? mouserProductUrl(mo?.sku ?? row.mpn ?? "") : "");

    lines.push(
      csvRow([
        i + 1,
        row.refDesList.join(", "),
        row.qty,
        buildQty,
        totalRequired,
        row.mpn ?? "",
        row.manufacturer ?? "",
        descriptionFor(row),
        row.package ?? "",
        row.value ?? "",
        row.lifecycleStatus,
        dk?.sku ?? "",
        dkUrl,
        money(dkPrice1),
        mo?.sku ?? "",
        moUrl,
        money(moPrice1),
        best ? SOURCE_LABEL[best.distributor] : "",
        money(bestUnit),
        bestUnit === null ? "" : currency,
        extended ?? "",
        row.riskScore.total,
        row.riskScore.notes.join("; "),
        ...observationCells(best),
      ]),
    );
  });

  // Totals.
  lines.push("");
  const totalRow = new Array<string | number>(PACKET_COLUMNS.length).fill("");
  totalRow[0] = "TOTAL PROJECT COST";
  totalRow[19] = sawPrice ? totalCurrency : ""; // Currency column
  totalRow[20] = sawPrice ? Number(totalCost.toFixed(2)) : ""; // Extended Cost column
  lines.push(csvRow(totalRow));

  return csvDocument(lines);
}
