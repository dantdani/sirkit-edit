/**
 * [B19-D I5b rows 20, 26, 51] What a vendor's numbers and words are taken to mean.
 *
 *  - row 20: the "best unit price" was the minimum over EVERY break — a 10 000-piece break priced a one-off BOM line, and a
 *    GBP or JPY number could win against USD. The BOM's estimate and the procurement packet then summed those numbers
 *    under one currency label.
 *  - row 26: a lifecycle term containing "active" mapped to active, so "Inactive" read as active.
 *  - row 51: numbers were read by deleting every character outside [0-9.eE+-], so a decimal comma ("0,34") became 34.
 */
import { describe, expect, it } from "vitest";
import { asNumber, cheapestUnitPrice } from "../types";
import { mapLifecycleString } from "../lifecycle";
import { toProcurementPacketCsv } from "../../cart-formats";
import type { PartPricing } from "../types";

describe("[B19-D I5b row 20] a unit price is the price at the quantity, in one currency", () => {
  const breaks = [
    { qty: 1, price: 0.5, currency: "USD" },
    { qty: 10_000, price: 0.02, currency: "USD" },
    { qty: 1, price: 0.45, currency: "GBP" },
    { qty: 1, price: 75, currency: "JPY" },
  ];

  it("a one-off unit price never comes from a volume break or another currency", () => {
    expect(cheapestUnitPrice(breaks)).toBe(0.5);
  });

  it("at a volume that reaches the break, the volume price applies", () => {
    expect(cheapestUnitPrice(breaks, { quantity: 10_000 })).toBe(0.02);
  });

  it("across sellers in one currency, the cheapest price available at the quantity wins", () => {
    expect(cheapestUnitPrice([{ qty: 1, price: 0.6, currency: "USD" }, { qty: 1, price: 0.55, currency: "USD" }, { qty: 100, price: 0.1, currency: "USD" }])).toBe(0.55);
  });

  it("when every break needs a larger order, the smallest order's price applies (the order minimum)", () => {
    expect(cheapestUnitPrice([{ qty: 10, price: 0.3, currency: "USD" }, { qty: 100, price: 0.2, currency: "USD" }])).toBe(0.3);
  });

  it("no price in the currency is no price", () => {
    expect(cheapestUnitPrice([{ qty: 1, price: 0.45, currency: "GBP" }])).toBeNull();
  });

  it("the procurement packet never labels a total in a currency it did not sum in", () => {
    const usd: PartPricing = { distributor: "digikey", mpn: "A", manufacturer: null, description: null, datasheet: null, inStock: 1, minOrderQty: 1, priceBreaks: [{ qty: 1, price: 2, currency: "USD" }], bestUnitPrice: 2, productUrl: null, package: null, lifecycleStatus: "active", lifecycleRaw: null, fetchedAt: 0 };
    const gbp: PartPricing = { ...usd, mpn: "B", priceBreaks: [{ qty: 1, price: 3, currency: "GBP" }], bestUnitPrice: cheapestUnitPrice([{ qty: 1, price: 3, currency: "GBP" }]) };
    const row = (mpn: string, offer: PartPricing) => ({ refDesList: [mpn], qty: 1, name: mpn, mpn, manufacturer: null, value: null, package: null, lifecycleStatus: "active", riskScore: { total: 0, grade: "A", notes: [] }, pricing: { offers: [offer], bestOverall: offer } });
    const csv = toProcurementPacketCsv([row("A", usd), row("B", gbp)] as never, { title: "t", buildQuantity: 1, date: new Date("2026-09-13T00:00:00Z") });
    const total = csv.split(/\r?\n/).find((line) => line.startsWith("TOTAL PROJECT COST"))!;
    const cells = total.split(",");
    expect(cells[19]).toBe("USD");
    expect(Number(cells[20])).toBe(2);
  });
});

describe("[B19-D I5b row 26] a negated lifecycle term is never active", () => {
  it.each(["Inactive", "Not Active", "Non-Active", "inactive part"])("%s", (term) => {
    expect(mapLifecycleString(term)).not.toBe("active");
  });
  it.each([["Active", "active"], ["Discontinued at Digi-Key", "obsolete"], ["In Production", "active"], ["NRND", "nrnd"]])("%s → %s (baselines)", (term, expected) => {
    expect(mapLifecycleString(term)).toBe(expected);
  });
});

describe("[B19-D I5b row 51] a number is read only when its form is unambiguous", () => {
  it.each(["0,34", "€1.234,56", "1.234.567", "12abc34", "--5"])("%s is not a number", (raw) => {
    expect(asNumber(raw)).toBeNull();
  });
  it.each([["$1.23", 1.23], ["1,234", 1234], ["$1,234.56", 1234.56], ["0.34", 0.34], [" 12 ", 12], ["-3", -3]] as const)("%s → %s (baselines)", (raw, expected) => {
    expect(asNumber(raw)).toBe(expected);
  });
  it("numbers stay numbers", () => {
    expect(asNumber(5)).toBe(5);
    expect(asNumber(Number.NaN)).toBeNull();
  });
});
