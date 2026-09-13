/**
 * Shared BOM builder + request validation (Stage 6).
 *
 * Extracted so /api/bom and the cart-export / procurement-packet routes all
 * build rows the same way. `buildBomRows` is a thin pass-through to `buildBom`
 * (which already groups, enriches, prices, and risk-scores), so the /api/bom
 * response shape is preserved exactly.
 */

import { buildBom, type BomResult } from "@/app/lib/bom/build";
import type { DistributorChoice } from "@/app/lib/distributors";
import type { SchematicState } from "@/lib/schematic-types";

export const VALID_CHOICES: DistributorChoice[] = ["none", "digikey", "mouser", "octopart", "all"];

/** Coerce an incoming choice (incl. the legacy "both") to the current union. */
export function normalizeChoice(raw: unknown): DistributorChoice {
  if (raw === "both") return "all"; // legacy persisted value
  return VALID_CHOICES.includes(raw as DistributorChoice) ? (raw as DistributorChoice) : "none";
}

/** Minimal structural check — `components` is the only required array. */
export function isSchematicState(value: unknown): value is SchematicState {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.components);
}

/** Build the full BOM result (rows + summaries) for a state and pricing choice. */
export async function buildBomRows(
  state: SchematicState,
  pricingChoice: DistributorChoice,
  /** [B19-B I2] `live` must be granted by an authenticated caller; the default prices from the cache only. */
  pricing: { live?: boolean; forceRefresh?: boolean } = {},
): Promise<BomResult> {
  return buildBom(state, pricingChoice, pricing);
}
