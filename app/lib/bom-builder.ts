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
  return checkBomState(value).ok;
}

/**
 * [B19-D I5e row 19] The table a BOM route may be asked to price. Checked before any catalog or pricing lookup: the routes
 * are public, their bodies may be eight megabytes, and every distinct part id becomes a database lookup. The bounds sit far
 * above a real board (a dense 1 000-part design has a few hundred distinct parts).
 */
export const BOM_TABLE_LIMITS = Object.freeze({ instances: 10_000, theoryComponents: 10_000, distinctParts: 2_000, textChars: 256 });

export type BomStateCheck =
  | { ok: true; state: SchematicState }
  | { ok: false; status: 400 | 413; code: "BOM_STATE_INVALID" | "BOM_TABLE_TOO_LARGE"; error: string };

const boundedText = (value: unknown, allowEmpty = true): boolean =>
  typeof value === "string" && value.length <= BOM_TABLE_LIMITS.textChars && (allowEmpty || value.length > 0);

export function checkBomState(
  value: unknown,
  /** each route's own historical wording for a missing or non-schematic `state` (pinned by the B16.0.11 parity tests) */
  missingStateError = "Body must include a `state` with components/kicadComponents.",
): BomStateCheck {
  const invalid = (error: string): BomStateCheck => ({ ok: false, status: 400, code: "BOM_STATE_INVALID", error });
  if (!value || typeof value !== "object") return invalid(missingStateError);
  const state = value as Record<string, unknown>;
  if (!Array.isArray(state.components)) return invalid(missingStateError);
  const kicad = state.kicadComponents;
  if (kicad !== undefined && !Array.isArray(kicad)) return invalid("`state.kicadComponents` must be a list of placed parts.");
  const instances = (kicad ?? []) as unknown[];
  const tooLarge = (error: string): BomStateCheck => ({ ok: false, status: 413, code: "BOM_TABLE_TOO_LARGE", error });
  if (instances.length > BOM_TABLE_LIMITS.instances) return tooLarge(`The BOM has too many placed parts (${instances.length}; the limit is ${BOM_TABLE_LIMITS.instances}).`);
  if (state.components.length > BOM_TABLE_LIMITS.theoryComponents) return tooLarge(`The BOM has too many schematic components (the limit is ${BOM_TABLE_LIMITS.theoryComponents}).`);
  const partIds = new Set<string>();
  for (const item of instances) {
    if (!item || typeof item !== "object") return invalid("Every placed part must be an object.");
    const instance = item as Record<string, unknown>;
    if (!boundedText(instance.partId, false) || !boundedText(instance.refDes) || !boundedText(instance.value)) return invalid("Every placed part needs a part id, a reference and a value (bounded text).");
    if (instance.atomicPartRevisionId !== undefined && !boundedText(instance.atomicPartRevisionId, false)) return invalid("A placed part's atomic revision id must be bounded text.");
    partIds.add(instance.partId as string);
  }
  if (partIds.size > BOM_TABLE_LIMITS.distinctParts) return tooLarge(`The BOM references too many distinct parts (${partIds.size}; the limit is ${BOM_TABLE_LIMITS.distinctParts}).`);
  for (const item of state.components as unknown[]) if (!item || typeof item !== "object") return invalid("Every schematic component must be an object.");
  return { ok: true, state: value as SchematicState };
}

/** The refusal a BOM route answers with when `checkBomState` fails. */
export function bomStateRefusal(check: Extract<BomStateCheck, { ok: false }>): Response {
  return Response.json({ ok: false, code: check.code, error: check.error }, { status: check.status, headers: { "Cache-Control": "no-store" } });
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
