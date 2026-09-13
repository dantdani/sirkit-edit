/**
 * [B19-E E1] The procurement packet says what it is: a sourcing worksheet of observed offers, not verified procurement, with
 * how its prices were obtained, each best offer's observation time and basis, and the sources' attribution and redistribution
 * terms. The distributor cart files keep their exact bytes (their headers are the vendors' import formats).
 */
import { describe, expect, it } from "vitest";
import { toDigiKeyCsv, toLcscCsv, toMouserCsv, toProcurementPacketCsv } from "@/app/lib/cart-formats";
import type { PartPricing } from "@/app/lib/distributors/types";
import { SOURCE_REGISTRY } from "@/app/lib/acquisition/source-registry";

const CRLF = String.fromCharCode(13) + String.fromCharCode(10);
const AT = Date.UTC(2026, 8, 13, 11, 30);
const offer: PartPricing = {
  distributor: "digikey", mpn: "NE555DR", manufacturer: "TI", description: "timer", datasheet: null, inStock: 100, minOrderQty: 1,
  priceBreaks: [{ qty: 1, price: 0.4, currency: "USD" }], bestUnitPrice: 0.4, productUrl: null, package: "SOIC-8", sku: "296-NE555DR",
  lifecycleStatus: "active", lifecycleRaw: "Active", fetchedAt: AT, provenance: { servedFrom: "offer-cache", retrievedAt: AT },
};
const row = (title: string) => ({
  partId: "p", atomicRevisionId: null, refDes: "U1", refDesList: ["U1"], qty: 1, name: title, mpn: "NE555DR", manufacturer: "TI", package: "SOIC-8",
  value: "NE555", datasheet: null, category: null, lifecycleStatus: "active", alternatesCount: 0, riskScore: { total: 10, grade: "A", notes: [] },
  pricing: { partId: "p", mpn: "NE555DR", offers: [offer], bestOverall: offer, lifecycleStatus: "active", sourcesQueried: [], sourcesFromCache: 1, sourcesFromLive: 0 },
});
const DATE = new Date("2026-09-13T00:00:00Z");

function cells(line: string): string[] {
  return line.split(",");
}

describe("[B19-E E1] the procurement packet states its status, pricing basis and license", () => {
  it("has Status, Pricing basis and License lines, and appends the observation time and basis of each best offer", () => {
    const csv = toProcurementPacketCsv([row("NE555DR")] as never, { title: "Board", buildQuantity: 2, date: DATE });
    const lines = csv.split(CRLF);
    expect(lines.slice(0, 4)).toEqual(["Project: Board", "Build Quantity: 2", "Date: 2026-09-13", "Notes: "]);
    const status = lines.find((line) => line.startsWith("Status: "))!;
    expect(status).toMatch(/sourcing worksheet/i);
    expect(status).toMatch(/not verified procurement/i);
    expect(status).toMatch(/no order was placed/i);
    expect(lines.find((line) => line.startsWith("Pricing basis: "))).toMatch(/cached offers only/i);
    const license = lines.find((line) => line.startsWith("License: "))!;
    expect(license).toContain(SOURCE_REGISTRY.digikey.license.attribution);
    expect(license).toMatch(/not for redistribution/i);
    const header = cells(lines.find((line) => line.startsWith("Line,RefDes"))!);
    expect(header.slice(-2)).toEqual(["Best Source Observed At (UTC)", "Best Source Basis"]);
    expect(header[19]).toBe("Currency");
    expect(header[20]).toBe("Extended Cost");
    const data = cells(lines.find((line) => line.startsWith("1,"))!);
    expect(data.slice(-2)).toEqual(["2026-09-13T11:30:00.000Z", "cached (offer cache)"]);
    const total = cells(lines.find((line) => line.startsWith("TOTAL PROJECT COST"))!);
    expect(total[19]).toBe("USD");
    expect(total).toHaveLength(header.length);
  });

  it("a live best offer is labelled live, and a live-priced packet says so", () => {
    const live = { ...offer, provenance: { servedFrom: "live" as const, retrievedAt: AT } };
    const liveRow = { ...row("NE555DR"), pricing: { ...row("NE555DR").pricing, offers: [live], bestOverall: live } };
    const csv = toProcurementPacketCsv([liveRow] as never, { title: "Board", buildQuantity: 1, date: DATE, pricingMode: "live" });
    expect(csv).toContain("live (vendor answer)");
    expect(csv.split(CRLF).find((line) => line.startsWith("Pricing basis: "))).toMatch(/live/i);
  });

  it("no cell starts with a spreadsheet formula character, even from a hostile title, notes or description", () => {
    const hostile = "=HYPERLINK(\"https://evil.example\",\"x\")";
    const csv = toProcurementPacketCsv([{ ...row(hostile), mpn: "+NE555", manufacturer: "@TI", value: "-1" }] as never, { title: hostile, buildQuantity: 1, date: DATE, notes: hostile });
    for (const line of csv.split(CRLF)) {
      for (const cell of cells(line)) expect(/^"?[=+\-@]/.test(cell), cell).toBe(false);
    }
  });

  it("an empty packet has the lines too, with no distributor attribution (baseline for the parity pin)", () => {
    const csv = toProcurementPacketCsv([], { title: "t", buildQuantity: 1, date: DATE });
    expect(csv).toContain("Status: ");
    expect(csv.split(CRLF).find((line) => line.startsWith("License: "))).toMatch(/no distributor data/i);
  });

  it("the distributor cart files keep their exact bytes", () => {
    expect(toDigiKeyCsv([])).toBe(`Digi-Key Part Number,Manufacturer Part Number,Manufacturer,Quantity,Customer Reference${CRLF}`);
    expect(toMouserCsv([])).toBe(`Mouser Part Number,Manufacturer Part Number,Manufacturer,Quantity,Customer Number,Description${CRLF}`);
    expect(toLcscCsv([])).toBe(`C# (LCSC Part Number),Manufacturer Part Number,Manufacturer,Quantity,Reference${CRLF}`);
  });
});
