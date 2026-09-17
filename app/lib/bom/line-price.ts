/**
 * [B19-D I5b review] The unit price a BOM line is shown and totalled at: the price its quantity reaches, in the pricing
 * currency. Browser-safe (the BOM view imports it); the estimate, the BOM CSV and the view all use this one rule.
 */
import { cheapestUnitPrice, PRICING_CURRENCY, type PartPricing } from "../distributors/types";

export function lineUnitPrice(row: { qty: number; pricing: { bestOverall: PartPricing | null } | null }): number | null {
  const best = row.pricing?.bestOverall ?? null;
  if (!best) return null;
  return cheapestUnitPrice(best.priceBreaks, { quantity: Math.max(1, row.qty) });
}

export function lineCurrency(row: { qty: number; pricing: { bestOverall: PartPricing | null } | null }): string | null {
  return lineUnitPrice(row) === null ? null : PRICING_CURRENCY;
}
