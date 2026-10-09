/**
 * [B24-C2] D24-23, OD-209 (its cost half); lead decision D1: the program's ONE price table and the pricing of recorded usage through it.
 * B24-B3 owns the one schema, `sirkit.live-price-table.v1` (per provider and model the input and output price of one million tokens as
 * decimal text, one ISO 4217 currency, a semantic version), its validator `livePriceTableProblems` and the money cap (`live-spend.ts`,
 * OD-216). This module builds no second schema, no second validator and no money cap: it declares the one table constant and prices
 * through B3's validator and the `procurement.ts` decimal helpers.
 *
 *  - `MODEL_PRICE_TABLE` is `null`: no owner table has been supplied (OD-107 "reported, not priced" stays true). Changing it needs an
 *    owner-supplied table that passes B3's validator and a reviewed change; B3's record-only command reads its table from
 *    `--price-table <path>` at run time, so this constant is the one place a table for recorded usage would be declared (B24-E's Q1).
 *  - `priceUsage` answers "unpriced" with a closed reason - `no_owner_price_table` (no table, or one the validator refuses: it is never
 *    used to price), `model_not_in_table` (the model is matched exactly: never a prefix, never a default price), `usage_out_of_range`
 *    (a token count that is not a safe integer in 0..100,000,000, the range `multiplyDecimalByInteger` accepts) - or "priced" with the
 *    table's version and currency and the cost as decimal text.
 *  - Money is decimal text only: `costMicrounits` is `addDecimal(multiplyDecimalByInteger(inputPrice, inputTokens),
 *    multiplyDecimalByInteger(outputPrice, outputTokens))` - a price per million tokens times a token count is the cost in millionths
 *    of the currency (the per-million units B3 compares in), so there is no division and no rounding. Nothing turns money into a number.
 *  - "unpriced" is never zero (runbook :147): a zero cost is a priced zero (zero usage against a table), never the absence of a table.
 *
 * Pure: no file, no environment, no network. C1's call records keep their token counts and are never stored priced; the chat route
 * prices the run's usage at write time and passes the result into the attribution document (`app/api/chat/attribution-runtime.ts`).
 */
import { addDecimal, multiplyDecimalByInteger } from "../release-engineering/procurement";
import { livePriceTableProblems, type LivePriceProvider, type LivePriceTable } from "./live-spend";

/** The one table. `null`: no owner-supplied table exists; every recorded usage is "unpriced" (a test pins the null). */
export const MODEL_PRICE_TABLE: LivePriceTable | null = null;

/** The token range the decimal helpers price (procurement.ts: `multiplyDecimalByInteger` takes a safe integer 0..100,000,000). */
export const PRICEABLE_TOKEN_MAX = 100_000_000;

export const USAGE_PRICING_REASONS = Object.freeze(["no_owner_price_table", "model_not_in_table", "usage_out_of_range"] as const);
export type UsagePricingReason = (typeof USAGE_PRICING_REASONS)[number];

export interface PriceableUsage { readonly inputTokens?: number; readonly outputTokens?: number }
export interface PriceUsageInput { readonly provider: LivePriceProvider; readonly model: string; readonly usage: PriceableUsage }
export type UsagePricing =
  | { readonly status: "unpriced"; readonly reason: UsagePricingReason }
  | { readonly status: "priced"; readonly priceTableVersion: string; readonly currency: string; readonly costMicrounits: string };

const unpriced = (reason: UsagePricingReason): UsagePricing => ({ status: "unpriced", reason });
/** A token count the decimal helpers accept: a safe integer in 0..PRICEABLE_TOKEN_MAX. */
const priceable = (count: unknown): count is number => typeof count === "number" && Number.isSafeInteger(count) && count >= 0 && count <= PRICEABLE_TOKEN_MAX;

/** Price one recorded usage against `table` (the one constant, or a table read at run time). Total: never throws. */
export function priceUsage(input: PriceUsageInput, table: LivePriceTable | null): UsagePricing {
  if (table === null || table === undefined) return unpriced("no_owner_price_table");
  let problems: readonly string[];
  try { problems = livePriceTableProblems(table); } catch { problems = ["PRICE_TABLE_SHAPE"]; }
  if (problems.length > 0) return unpriced("no_owner_price_table"); // a refused table is never used to price
  const entry = table.prices.find((candidate) => candidate.provider === input.provider && candidate.model === input.model);
  if (entry === undefined) return unpriced("model_not_in_table");
  const { inputTokens, outputTokens } = input.usage ?? {};
  if (!priceable(inputTokens) || !priceable(outputTokens)) return unpriced("usage_out_of_range");
  const costMicrounits = addDecimal(multiplyDecimalByInteger(entry.inputPerMillion, inputTokens), multiplyDecimalByInteger(entry.outputPerMillion, outputTokens));
  return { status: "priced", priceTableVersion: table.version, currency: table.currency, costMicrounits };
}
