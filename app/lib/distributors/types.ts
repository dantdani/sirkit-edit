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

/** Coerce numbers, numeric strings, and currency-formatted strings ("$1.23"). */
export function asNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const cleaned = value.replace(/[^0-9.eE+-]/g, "");
    if (cleaned === "") return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Cheapest unit price across a set of price breaks, or null when none exist. */
export function cheapestUnitPrice(breaks: PriceBreak[]): number | null {
  const prices = breaks.map((b) => b.price).filter((p) => Number.isFinite(p) && p > 0);
  return prices.length > 0 ? Math.min(...prices) : null;
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
