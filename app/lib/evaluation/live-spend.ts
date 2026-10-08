/**
 * [B24-B3] The money bound of a live provider run (D24-18; OD-216 "None without owner-supplied credits and a monetary cap", OD-209 "a
 * monetary cap checked before each request"), and the program's ONE price table (lead decision D1): `sirkit.live-price-table.v1`, its
 * type and its validator. B24-C2 prices recorded usage through this same schema, validator and the `procurement.ts` decimal helpers; it
 * builds no second schema.
 *
 * A price table states, per provider and model, the input and the output price of one million tokens, as decimal text in one currency.
 * Before each request the bound refuses when what is already spent, plus every request still in flight at its worst case, plus this
 * request's worst case (`LIVE_INPUT_TOKEN_RESERVE` input tokens and the adapters' output ceiling) would pass the cap; after the response
 * it replaces that reservation with the priced reported usage, and a response that reports more input tokens than the reserve refuses
 * every later request. A request whose usage is unknown (it failed after it was sent) keeps its worst case, so `spentUpperBound` is an
 * upper bound. Money is decimal text only: every sum, product and comparison goes through `addDecimal`, `multiplyDecimalByInteger` and
 * `compareDecimal`, in per-million units (a price per million tokens times a token count); nothing turns money into a number.
 *
 * Pure: no file, no environment, no network. The record-only command (`scripts/run-b21-live-orchestration-evaluation.ts`) reads the
 * owner's table and cap; nothing here is a price.
 */
import { addDecimal, compareDecimal, multiplyDecimalByInteger } from "../release-engineering/procurement";

export const LIVE_PRICE_TABLE_SCHEMA = "sirkit.live-price-table.v1" as const;
export const LIVE_PRICE_PROVIDERS = Object.freeze(["openai", "anthropic"] as const);
export type LivePriceProvider = (typeof LIVE_PRICE_PROVIDERS)[number];

export interface LivePriceEntry {
  readonly provider: LivePriceProvider;
  readonly model: string;
  /** the price of one million input tokens, decimal text */
  readonly inputPerMillion: string;
  /** the price of one million output tokens, decimal text */
  readonly outputPerMillion: string;
}
export interface LivePriceTable {
  readonly schema: typeof LIVE_PRICE_TABLE_SCHEMA;
  /** the owner's version of the table (semantic version text) */
  readonly version: string;
  /** an ISO 4217 code: three capital letters */
  readonly currency: string;
  readonly prices: readonly LivePriceEntry[];
}

export const LIVE_PRICE_TABLE_PROBLEM_CODES = ["PRICE_TABLE_SHAPE", "PRICE_TABLE_SCHEMA", "PRICE_TABLE_VERSION", "PRICE_TABLE_CURRENCY", "PRICE_NOT_DECIMAL", "PRICE_ENTRY_MISSING", "PRICE_ENTRY_REPEATED"] as const;
export type LivePriceTableProblemCode = (typeof LIVE_PRICE_TABLE_PROBLEM_CODES)[number];

/** Non-negative decimal text, as `procurement.ts` parses it. */
export const DECIMAL_TEXT = /^\d+(?:\.\d+)?$/;
const VERSION_TEXT = /^\d+\.\d+\.\d+$/;
const CURRENCY_CODE = /^[A-Z]{3}$/;
const TABLE_KEYS = ["currency", "prices", "schema", "version"];
const ENTRY_KEYS = ["inputPerMillion", "model", "outputPerMillion", "provider"];
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
/** No key outside `keys` (a missing key is the refusal of its own field). */
const knownKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(value).every((key) => keys.includes(key));

/** Every refusal of a price table, one code per refusal kind in LIVE_PRICE_TABLE_PROBLEM_CODES order; [] for a usable table. `required`
 *  names the provider and model pairs the run will call: each must be priced. Pure. */
export function livePriceTableProblems(table: unknown, required: ReadonlyArray<{ readonly provider: LivePriceProvider; readonly model: string }> = []): LivePriceTableProblemCode[] {
  const found = new Set<LivePriceTableProblemCode>();
  if (!isRecord(table)) return ["PRICE_TABLE_SHAPE"];
  if (!knownKeys(table, TABLE_KEYS) || !Array.isArray(table.prices)) found.add("PRICE_TABLE_SHAPE");
  if (table.schema !== LIVE_PRICE_TABLE_SCHEMA) found.add("PRICE_TABLE_SCHEMA");
  if (typeof table.version !== "string" || !VERSION_TEXT.test(table.version)) found.add("PRICE_TABLE_VERSION");
  if (typeof table.currency !== "string" || !CURRENCY_CODE.test(table.currency)) found.add("PRICE_TABLE_CURRENCY");
  const seen = new Set<string>();
  for (const entry of Array.isArray(table.prices) ? (table.prices as unknown[]) : []) {
    if (!isRecord(entry) || !knownKeys(entry, ENTRY_KEYS)) { found.add("PRICE_TABLE_SHAPE"); continue; }
    for (const price of [entry.inputPerMillion, entry.outputPerMillion]) if (typeof price !== "string" || !DECIMAL_TEXT.test(price)) found.add("PRICE_NOT_DECIMAL");
    const provider = entry.provider;
    const model = entry.model;
    if (typeof provider !== "string" || !(LIVE_PRICE_PROVIDERS as readonly string[]).includes(provider) || typeof model !== "string" || model.trim() === "" || model !== model.trim()) { found.add("PRICE_ENTRY_MISSING"); continue; }
    const key = `${provider} ${model}`;
    if (seen.has(key)) found.add("PRICE_ENTRY_REPEATED");
    seen.add(key);
  }
  for (const pair of required) if (!seen.has(`${pair.provider} ${pair.model}`)) found.add("PRICE_ENTRY_MISSING");
  return LIVE_PRICE_TABLE_PROBLEM_CODES.filter((code) => found.has(code));
}

/** The input tokens one request is priced at before it is sent (its worst case; a response that reports more refuses every later
 *  request). A stated constant: the record-only command's longest prompt with its context stays far below it (INFERRED; no live run has
 *  measured one). */
export const LIVE_INPUT_TOKEN_RESERVE = 100_000;
const PER_MILLION = 1_000_000;

export type LiveSpendRefusalCode = "LIVE_SPEND_CAP" | "LIVE_SPEND_RESERVE_OVERRUN" | "LIVE_SPEND_MODEL_UNPRICED";
/** A request the money bound refuses before it is sent. */
export class LiveSpendRefusal extends Error {
  constructor(readonly code: LiveSpendRefusalCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = "LiveSpendRefusal";
  }
}
/** What the run's record states about money (decimal text, in the table's currency). */
export interface LiveSpendRecord {
  readonly currency: string;
  readonly cap: string;
  readonly spentUpperBound: string;
  readonly priceTableVersion: string;
}
export interface LiveTokenUsage { readonly inputTokens?: number; readonly outputTokens?: number }
export interface LiveSpendBound {
  /** One request's worst case, in the table's currency. */
  worstCase(provider: LivePriceProvider, model: string): string;
  /** Reserve one request's worst case, or refuse it before it is sent. */
  admit(provider: LivePriceProvider, model: string): void;
  /** The response arrived: its priced usage replaces the reservation (null: unknown, the worst case stays). */
  settle(provider: LivePriceProvider, model: string, usage: LiveTokenUsage | null): void;
  /** The admitted request was never sent: its reservation is returned. */
  release(provider: LivePriceProvider, model: string): void;
  record(): LiveSpendRecord;
}

/** Per-million units back to the currency: the decimal point moves six places (text only). */
function fromPerMillion(value: string): string {
  const [whole, fraction = ""] = value.split(".");
  const digits = whole!.padStart(7, "0");
  const integer = digits.slice(0, -6).replace(/^0+(?=\d)/, "");
  const decimals = `${digits.slice(-6)}${fraction}`.replace(/0+$/, "");
  return decimals === "" ? integer : `${integer}.${decimals}`;
}
/** A reported token count the decimal helpers can price (procurement.ts takes at most 100 000 000), or null: then the worst case stays. */
const tokens = (count: number | undefined): number | null => (typeof count === "number" && Number.isSafeInteger(count) && count >= 0 && count <= 100_000_000 ? count : null);

/** The bound over one run: `cap` is decimal text in the table's currency; `maxOutputTokens` is the adapters' output ceiling. Throws
 *  LIVE_PRICE_TABLE_INVALID or LIVE_SPEND_CAP_INVALID when either is unusable (the command refuses both first). */
export function liveSpendBound(table: LivePriceTable, cap: string, maxOutputTokens: number): LiveSpendBound {
  const problems = livePriceTableProblems(table);
  if (problems.length > 0) throw new Error(`LIVE_PRICE_TABLE_INVALID: ${problems.join(", ")}`);
  if (!DECIMAL_TEXT.test(cap)) throw new Error("LIVE_SPEND_CAP_INVALID: the cap is not decimal text");
  const capUnits = multiplyDecimalByInteger(cap, PER_MILLION);
  const priceOf = (provider: LivePriceProvider, model: string): LivePriceEntry => {
    const entry = table.prices.find((candidate) => candidate.provider === provider && candidate.model === model);
    if (!entry) throw new LiveSpendRefusal("LIVE_SPEND_MODEL_UNPRICED", `${provider} ${model} has no price in table ${table.version}`);
    return entry;
  };
  const worstUnits = (provider: LivePriceProvider, model: string): string => {
    const price = priceOf(provider, model);
    return addDecimal(multiplyDecimalByInteger(price.inputPerMillion, LIVE_INPUT_TOKEN_RESERVE), multiplyDecimalByInteger(price.outputPerMillion, maxOutputTokens));
  };
  let spent = "0";
  const inFlight: string[] = [];
  let overrun = false;
  const reserved = (): string => inFlight.reduce((sum, units) => addDecimal(sum, units), "0");
  const returnOne = (units: string): void => {
    const at = inFlight.indexOf(units);
    if (at >= 0) inFlight.splice(at, 1);
  };
  return {
    worstCase: (provider, model) => fromPerMillion(worstUnits(provider, model)),
    admit(provider, model) {
      if (overrun) throw new LiveSpendRefusal("LIVE_SPEND_RESERVE_OVERRUN", `a response reported more than ${LIVE_INPUT_TOKEN_RESERVE} input tokens, so no later request is priced; nothing more is sent`);
      const worst = worstUnits(provider, model);
      if (compareDecimal(addDecimal(addDecimal(spent, reserved()), worst), capUnits) > 0) throw new LiveSpendRefusal("LIVE_SPEND_CAP", `this request's worst case (${fromPerMillion(worst)} ${table.currency}) would pass the cap (${cap} ${table.currency}); it was not sent`);
      inFlight.push(worst);
    },
    settle(provider, model, usage) {
      const worst = worstUnits(provider, model);
      returnOne(worst);
      const reportedInput = usage?.inputTokens;
      if (typeof reportedInput === "number" && reportedInput > LIVE_INPUT_TOKEN_RESERVE) overrun = true;
      const input = tokens(usage?.inputTokens);
      const output = tokens(usage?.outputTokens);
      if (usage === null || input === null || output === null) { spent = addDecimal(spent, worst); return; }
      const price = priceOf(provider, model);
      spent = addDecimal(spent, addDecimal(multiplyDecimalByInteger(price.inputPerMillion, input), multiplyDecimalByInteger(price.outputPerMillion, output)));
    },
    release(provider, model) {
      returnOne(worstUnits(provider, model));
    },
    record: () => ({ currency: table.currency, cap, spentUpperBound: fromPerMillion(addDecimal(spent, reserved())), priceTableVersion: table.version }),
  };
}
