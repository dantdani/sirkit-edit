/**
 * Distributor abstraction — the shape every pricing source (DigiKey, Octopart,
 * …) normalizes its response into, plus the client interface the orchestrator
 * programs against.
 *
 * Everything here is provider-agnostic on purpose: the DigiKey and Octopart
 * clients each own the messy job of mapping their own loose JSON into a
 * `PartPricing`, so consumers (the cache, the orchestrator, the API route)
 * never touch a vendor-specific shape.
 */

export type PriceBreak = {
  qty: number;
  price: number;
  currency: string;
};

/** Manufacturing lifecycle, normalized across distributors (worst-known wins). */
export type LifecycleStatus =
  | "active"
  | "nrnd" // Not Recommended for New Design
  | "last_time_buy"
  | "eol" // End of Life
  | "obsolete"
  | "unknown";

export type PartPricing = {
  distributor: "digikey" | "octopart-aggregated" | "mouser" | "lcsc";
  mpn: string;
  manufacturer: string | null;
  description: string | null;
  datasheet: string | null;
  inStock: number | null; // total units available
  minOrderQty: number | null;
  priceBreaks: PriceBreak[];
  bestUnitPrice: number | null; // computed convenience field — cheapest price across all breaks
  productUrl: string | null; // link to the distributor's product page
  package: string | null;
  sku?: string | null; // distributor SKU/order number, when the source provides one
  lifecycleStatus: LifecycleStatus; // normalized lifecycle for this source
  lifecycleRaw: string | null; // the distributor's original term, kept for debugging
  fetchedAt: number; // unix ms
  /**
   * [B19-C I4] The live answer this came from: the SHA-256 of the exact response bytes and when they were retrieved.
   * Absent when served from a cache (a stored offer keeps no raw-content reference).
   */
  evidence?: { rawContentHash: string; retrievedAt: number };
};

export type DistributorName = PartPricing["distributor"];

export interface DistributorClient {
  name: DistributorName;
  lookupByMpn(mpn: string): Promise<PartPricing | null>;
  lookupBatch(mpns: string[]): Promise<Map<string, PartPricing>>;
}

// ─── Parsing helpers (the `unknown` boundary) ──────────────────────────────────
// Distributor APIs return loosely-typed JSON. Rather than scatter `any` casts
// through the clients, every field read goes through one of these narrow
// helpers so the untyped surface is contained to this file.

/** Treat an unknown as an indexable record without asserting `any`. */
export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * Coerce numbers and numeric strings, including a leading currency sign ("$1.23") and US thousands separators ("1,234.56").
 * [B19-D I5b row 51] Only an unambiguous form is read: a decimal comma ("0,34"), a European group separator ("1.234,56"),
 * or digits mixed with text ("12abc34") are NOT numbers — they used to be read by deleting every other character.
 */
export function asNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const match = /^\s*[$\u00a3\u20ac\u00a5]?\s*(-?)(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s*$/.exec(value);
    if (!match) return null;
    const n = Number(`${match[1]}${match[2]!.replace(/,/g, "")}${match[3] ?? ""}`);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** [B19-D I5b row 20] The one currency Sirkit compares and totals prices in (every registered source's default). */
export const PRICING_CURRENCY = "USD";

/**
 * The unit price that applies at `quantity` (default 1), in ONE currency (default USD).
 * [B19-D I5b row 20] It used to be the minimum over EVERY break — a 10 000-piece break priced a one-off line, and a GBP or
 * JPY number could win. Now: among the breaks in the currency, those whose quantity is reachable (≤ `quantity`) apply and
 * the cheapest wins (several sellers may quote); when none is reachable, the smallest order's price applies (the order
 * minimum). No break in the currency is no price.
 */
export function cheapestUnitPrice(breaks: PriceBreak[], options: { quantity?: number; currency?: string } = {}): number | null {
  const quantity = Number.isFinite(options.quantity) && (options.quantity ?? 0) > 0 ? options.quantity! : 1;
  const currency = (options.currency ?? PRICING_CURRENCY).trim().toUpperCase();
  const usable = breaks.filter((b) => Number.isFinite(b.price) && b.price > 0 && Number.isFinite(b.qty) && b.qty > 0 && (b.currency ?? PRICING_CURRENCY).trim().toUpperCase() === currency);
  if (usable.length === 0) return null;
  const reachable = usable.filter((b) => b.qty <= quantity);
  if (reachable.length > 0) return Math.min(...reachable.map((b) => b.price));
  const smallest = Math.min(...usable.map((b) => b.qty));
  return Math.min(...usable.filter((b) => b.qty === smallest).map((b) => b.price));
}

/**
 * [B19-B I1] A vendor request that failed at the boundary. Its message is the boundary's own redacted sentence and never
 * the transport's text, the request URL or a credential.
 */
export class DistributorRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DistributorRequestError";
  }
}

/** What a client may log about a failure: a boundary sentence, or a fixed string for anything it did not produce. */
export function describeFailure(error: unknown): string {
  return error instanceof DistributorRequestError ? error.message : "the lookup failed (details withheld)";
}
