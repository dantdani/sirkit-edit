/**
 * [B24-C2] Cost through the program's ONE price table (D24-23, OD-209's cost half; lead decision D1): `app/lib/evaluation/model-price-table.ts`
 * declares `MODEL_PRICE_TABLE: LivePriceTable | null = null` - no owner table has been supplied - and `priceUsage` prices recorded
 * usage through B24-B3's `sirkit.live-price-table.v1` schema, its validator and the `procurement.ts` decimal helpers. Money is decimal
 * text only: a price per million tokens times a token count is the cost in millionths of the currency (per-million units), so there is
 * no division and no rounding; "unpriced" is never zero (runbook :147).
 *
 *  1. unpriced (`no_owner_price_table`) without a table - the module's constant is null;
 *  2. exact decimal text with a fixture table B3's validator accepts (`costMicrounits` equals the hand-computed sum, fractional prices
 *     included);
 *  3. a table B3's validator refuses is never used to price; an unknown model, a prefix or another provider's model is `model_not_in_table`;
 *     a token count above 100,000,000, negative, fractional or missing is `usage_out_of_range`, never a throw;
 *  4. one schema: the module imports B3's `LivePriceTable` type and validator from live-spend.ts; no second schema literal (the
 *     `sirkit.model` + `-price-table` name) exists under app/ or scripts/ (the needle is joined here, so this file never matches
 *     itself); no `Number(`, `parseFloat` or
 *     `parseInt` touches money in the module;
 *  5. `MODEL_PRICE_TABLE === null` pinned, with the closed reasons and the token bound.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { addDecimal, multiplyDecimalByInteger } from "@/app/lib/release-engineering/procurement";
import { LIVE_PRICE_TABLE_SCHEMA, livePriceTableProblems, type LivePriceTable } from "@/app/lib/evaluation/live-spend";
import { MODEL_PRICE_TABLE, PRICEABLE_TOKEN_MAX, USAGE_PRICING_REASONS, priceUsage } from "@/app/lib/evaluation/model-price-table";

const ROOT = process.cwd();
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");
const FIXTURE = JSON.parse(read("app/lib/qualification/__tests__/fixtures/b24-b3-price-table.fake.json")) as LivePriceTable;
const FRACTIONAL: LivePriceTable = { schema: LIVE_PRICE_TABLE_SCHEMA, version: "2.1.0", currency: "XTS", prices: [{ provider: "openai", model: "gpt-fake-mini", inputPerMillion: "0.15", outputPerMillion: "0.60" }, { provider: "anthropic", model: "claude-fake", inputPerMillion: "3", outputPerMillion: "15.5" }] };
const UNPRICED = (reason: string) => ({ status: "unpriced", reason });

describe("[B24-C2] cost through the one price table (D24-23, OD-209, D1)", () => {
  it("1. unpriced without a table: MODEL_PRICE_TABLE is null, and recorded usage is `no_owner_price_table` - never zero, never a price", () => {
    expect(MODEL_PRICE_TABLE).toBeNull();
    expect(priceUsage({ provider: "openai", model: "gpt-fake-mini", usage: { inputTokens: 10, outputTokens: 5 } }, MODEL_PRICE_TABLE)).toEqual(UNPRICED("no_owner_price_table"));
    expect(priceUsage({ provider: "anthropic", model: "claude-fake", usage: { inputTokens: 0, outputTokens: 0 } }, null)).toEqual(UNPRICED("no_owner_price_table"));
    expect(JSON.stringify(priceUsage({ provider: "openai", model: "gpt-fake-mini", usage: { inputTokens: 10, outputTokens: 5 } }, null))).not.toContain("0");
  });

  it("2. exact decimal text with a table B3's validator accepts: the fixture table (integer prices) and a fractional table each price to the hand-computed sum in per-million units", () => {
    expect(livePriceTableProblems(FIXTURE)).toEqual([]);
    expect(livePriceTableProblems(FRACTIONAL)).toEqual([]);
    expect(priceUsage({ provider: "openai", model: "gpt-5.6-sol", usage: { inputTokens: 10, outputTokens: 5 } }, FIXTURE)).toEqual({ status: "priced", priceTableVersion: "1.0.0", currency: "XTS", costMicrounits: "20" });
    expect(priceUsage({ provider: "anthropic", model: "claude-opus-4-7", usage: { inputTokens: 1_000_000, outputTokens: 250_000 } }, FIXTURE)).toEqual({ status: "priced", priceTableVersion: "1.0.0", currency: "XTS", costMicrounits: "4000000" });
    const priced = priceUsage({ provider: "openai", model: "gpt-fake-mini", usage: { inputTokens: 1234, outputTokens: 567 } }, FRACTIONAL);
    expect(priced).toEqual({ status: "priced", priceTableVersion: "2.1.0", currency: "XTS", costMicrounits: "525.3" }); // 0.15 x 1234 + 0.60 x 567 = 185.1 + 340.2
    expect(priced).toMatchObject({ costMicrounits: addDecimal(multiplyDecimalByInteger("0.15", 1234), multiplyDecimalByInteger("0.60", 567)) });
    expect(priceUsage({ provider: "anthropic", model: "claude-fake", usage: { inputTokens: 3, outputTokens: 1 } }, FRACTIONAL)).toMatchObject({ costMicrounits: "24.5" });
    expect(priceUsage({ provider: "anthropic", model: "claude-fake", usage: { inputTokens: 0, outputTokens: 0 } }, FRACTIONAL)).toMatchObject({ status: "priced", costMicrounits: "0" }); // zero usage is a priced zero, not an unpriced one
    expect(priceUsage({ provider: "openai", model: "gpt-fake-mini", usage: { inputTokens: PRICEABLE_TOKEN_MAX, outputTokens: PRICEABLE_TOKEN_MAX } }, FRACTIONAL)).toMatchObject({ costMicrounits: "75000000" });
  });

  it("3. a table the validator refuses is never used to price; an unknown model, a prefix match or the other provider's model is `model_not_in_table`; a token count outside 0..100,000,000, a fractional or a missing one is `usage_out_of_range` - never a throw", () => {
    const malformed = JSON.parse(read("app/lib/qualification/__tests__/fixtures/b24-b3-price-table.malformed.json")) as unknown;
    expect(livePriceTableProblems(malformed)).not.toEqual([]);
    expect(priceUsage({ provider: "openai", model: "gpt-5.6-sol", usage: { inputTokens: 10, outputTokens: 5 } }, malformed as LivePriceTable)).toEqual(UNPRICED("no_owner_price_table"));
    expect(priceUsage({ provider: "openai", model: "gpt-5.6-sol", usage: { inputTokens: 10, outputTokens: 5 } }, { ...FIXTURE, currency: "xts" })).toEqual(UNPRICED("no_owner_price_table"));
    expect(priceUsage({ provider: "openai", model: "gpt-5.6-sol", usage: { inputTokens: 10, outputTokens: 5 } }, { ...FIXTURE, prices: [...FIXTURE.prices, { ...FIXTURE.prices[0]! }] })).toEqual(UNPRICED("no_owner_price_table")); // a repeated entry
    expect(priceUsage({ provider: "openai", model: "gpt-5.6", usage: { inputTokens: 10, outputTokens: 5 } }, FIXTURE)).toEqual(UNPRICED("model_not_in_table")); // a prefix, never
    expect(priceUsage({ provider: "openai", model: "gpt-5.6-sol-2", usage: { inputTokens: 10, outputTokens: 5 } }, FIXTURE)).toEqual(UNPRICED("model_not_in_table"));
    expect(priceUsage({ provider: "openai", model: "claude-opus-4-7", usage: { inputTokens: 10, outputTokens: 5 } }, FIXTURE)).toEqual(UNPRICED("model_not_in_table")); // the other provider's model
    expect(priceUsage({ provider: "openai", model: " gpt-5.6-sol", usage: { inputTokens: 10, outputTokens: 5 } }, FIXTURE)).toEqual(UNPRICED("model_not_in_table"));
    expect(priceUsage({ provider: "openai", model: "", usage: { inputTokens: 10, outputTokens: 5 } }, FIXTURE)).toEqual(UNPRICED("model_not_in_table"));
    for (const usage of [{ inputTokens: PRICEABLE_TOKEN_MAX + 1, outputTokens: 1 }, { inputTokens: 1, outputTokens: -1 }, { inputTokens: 1.5, outputTokens: 1 }, { inputTokens: Number.NaN, outputTokens: 1 }, { inputTokens: 1 }, { outputTokens: 1 }, {}]) {
      expect(priceUsage({ provider: "openai", model: "gpt-5.6-sol", usage }, FIXTURE), JSON.stringify(usage)).toEqual(UNPRICED("usage_out_of_range"));
    }
    expect(PRICEABLE_TOKEN_MAX).toBe(100_000_000); // multiplyDecimalByInteger's range (procurement.ts)
  });

  it("4. one schema (D1): the module imports B3's type and validator from live-spend.ts, declares no schema literal, no second schema name (sirkit.model + -price-table) exists under app/ or scripts/, and no Number(, parseFloat or parseInt touches money in the module", () => {
    const source = read("app/lib/evaluation/model-price-table.ts");
    expect(source).toMatch(/import \{[^}]*livePriceTableProblems[^}]*\} from "\.\/live-spend";/);
    expect(source).toMatch(/import (?:type )?\{[^}]*(?:type )?LivePriceTable\b[^}]*\} from "\.\/live-spend";/);
    expect(source).toMatch(/import \{[^}]*addDecimal[^}]*multiplyDecimalByInteger[^}]*\} from "\.\.\/release-engineering\/procurement";/);
    expect(source).not.toMatch(/\bNumber\(|parseFloat|parseInt|BigInt\(/);
    expect(source).not.toMatch(/=\s*"sirkit\.live-price-table\.v1"/); // the schema literal is declared by B3 alone (the module's comment may name it)
    expect(source.match(/export const [A-Z_]+_SCHEMA\b/g) ?? []).toEqual([]); // no schema constant of its own
    expect(source).toContain("MODEL_PRICE_TABLE: LivePriceTable | null = null");
    const needle = ["sirkit.model", "-price-table"].join("");
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) { if (entry !== "node_modules" && entry !== ".next") walk(full); continue; }
        if (!/\.(?:ts|tsx|mts|cts|js|mjs|json|md)$/.test(entry)) continue;
        if (readFileSync(full, "utf8").includes(needle)) offenders.push(full);
      }
    };
    walk(join(ROOT, "app"));
    walk(join(ROOT, "scripts"));
    expect(offenders).toEqual([]);
    // the live-spend module keeps its own money rule (B3's pin, re-read here)
    expect(read("app/lib/evaluation/live-spend.ts")).not.toMatch(/\bNumber\(|parseFloat|parseInt/);
  });

  it("5. the pins: MODEL_PRICE_TABLE is null, the reasons are the closed three, a priced answer carries the table's version and currency, and priceUsage never throws on a hostile table", () => {
    expect(MODEL_PRICE_TABLE).toBeNull();
    expect(USAGE_PRICING_REASONS).toEqual(["no_owner_price_table", "model_not_in_table", "usage_out_of_range"]);
    expect(priceUsage({ provider: "openai", model: "gpt-5.6-sol", usage: { inputTokens: 1, outputTokens: 1 } }, FIXTURE)).toEqual({ status: "priced", priceTableVersion: "1.0.0", currency: "XTS", costMicrounits: "3" });
    for (const hostile of [42, "table", [], { schema: LIVE_PRICE_TABLE_SCHEMA }, { ...FIXTURE, prices: null }, Object.create(null)]) {
      expect(priceUsage({ provider: "openai", model: "gpt-5.6-sol", usage: { inputTokens: 1, outputTokens: 1 } }, hostile as LivePriceTable)).toEqual(UNPRICED("no_owner_price_table"));
    }
  });
});
