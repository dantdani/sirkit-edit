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

const CRLF = "\r\n";

// ─── RFC 4180 helpers ───────────────────────────────────────────────────────--

function csvCell(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? "" : String(value);
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

/** Unit price at quantity 1: the highest break with qty ≤ 1, else the smallest. */
function priceAtQty1(offer: PartPricing | null): number | null {
  if (!offer || offer.priceBreaks.length === 0) return null;
  const sorted = [...offer.priceBreaks].sort((a, b) => a.qty - b.qty);
  const atMost1 = sorted.filter((b) => b.qty <= 1).pop();
  return (atMost1 ?? sorted[0]).price;
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
];

const SOURCE_LABEL: Record<PartPricing["distributor"], string> = {
  digikey: "DigiKey",
  mouser: "Mouser",
  "octopart-aggregated": "Octopart",
  lcsc: "LCSC",
};

/** Currency of the best-overall offer's cheapest break, defaulting USD. */
function bestCurrency(row: BomRow): string {
  const best = row.pricing?.bestOverall;
  if (!best) return "USD";
  return best.priceBreaks.find((b) => b.price === best.bestUnitPrice)?.currency ?? "USD";
}

export function toProcurementPacketCsv(
  rows: BomRow[],
  meta: { title: string; buildQuantity: number; date: Date; notes?: string },
): string {
  const buildQty = Math.max(1, Math.floor(meta.buildQuantity) || 1);
  const lines: string[] = [];

  // Metadata header section (single-cell rows).
  lines.push(csvRow([`Project: ${meta.title}`]));
  lines.push(csvRow([`Build Quantity: ${buildQty}`]));
  lines.push(csvRow([`Date: ${meta.date.toISOString().slice(0, 10)}`]));
  lines.push(csvRow([`Notes: ${meta.notes ?? ""}`]));
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
    const bestUnit = best?.bestUnitPrice ?? null;
    const currency = bestCurrency(row);
    const extended = bestUnit === null ? null : Number((bestUnit * totalRequired).toFixed(4));
    if (extended !== null) {
      totalCost += extended;
      totalCurrency = currency;
      sawPrice = true;
    }

    const dkUrl = dk?.productUrl ?? (dk?.sku ?? row.mpn ? digiKeyProductUrl(dk?.sku ?? row.mpn ?? "") : "");
    const moUrl = mo?.productUrl ?? (mo?.sku ?? row.mpn ? mouserProductUrl(mo?.sku ?? row.mpn ?? "") : "");

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
