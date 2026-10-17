/**
 * [B19-D I5b review] One price rule everywhere a price is shown, stored or compared.
 *
 *  - project cost vs line price (low): the project estimate priced a line at its quantity's break, while the BOM table, the
 *    BOM CSV and the procurement packet still showed the quantity-1 price — the total was not the sum of the lines.
 *  - snapshots, notifications and alternates (low): a snapshot labelled a USD price with whichever break shared its number;
 *    the notification job's "now" price and alternate ranking still took the lowest break of any quantity in any currency;
 *    and a snapshot taken before B19 (another price meaning) was compared with a current one, raising false spikes.
 *  - other readers of stored offers (low): the alternates route and both operator scripts used offers stored for a
 *    different exact MPN, or before 0029, for the part they describe.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { BomRow } from "@/app/lib/bom/build";
import { toProcurementPacketCsv } from "@/app/lib/cart-formats";
import { bestOfferPrice } from "@/app/lib/alternates";
import { diffSnapshots, rowToSnapshotRow, type BomSnapshot } from "@/app/lib/snapshots";
import type { PartPricing } from "@/app/lib/distributors/types";

const breaks = [{ qty: 1, price: 0.1, currency: "USD" }, { qty: 10, price: 0.05, currency: "USD" }];
const offer: PartPricing = { distributor: "digikey", mpn: "R", manufacturer: null, description: null, datasheet: null, inStock: 100, minOrderQty: 1, priceBreaks: breaks, bestUnitPrice: 0.1, productUrl: null, package: null, lifecycleStatus: "active", lifecycleRaw: null, fetchedAt: 0 };
const row = (qty: number): BomRow => ({ partId: "p", atomicRevisionId: null, refDes: "R1", refDesList: Array.from({ length: qty }, (_, i) => `R${i + 1}`), qty, name: "R", mpn: "R", manufacturer: null, package: null, value: "10k", datasheet: null, category: null, pricing: { partId: "p", mpn: "R", offers: [offer], bestOverall: offer, lifecycleStatus: "active", sourcesQueried: ["digikey"], sourcesFromCache: 0, sourcesFromLive: 1 }, lifecycleStatus: "active", alternatesCount: 0, riskScore: { total: 0, grade: "A", notes: [] } } as never);

describe("[B19-D I5b review] a line's unit price is the one its total uses", () => {
  it("buildBom exposes the unit price at the line's quantity, and the estimate is the sum of unit × quantity", async () => {
    const { lineUnitPrice } = (await import("@/app/lib/bom/build")) as { lineUnitPrice?: (r: BomRow) => number | null };
    expect(typeof lineUnitPrice).toBe("function");
    expect(lineUnitPrice!(row(10))).toBe(0.05);
    expect(lineUnitPrice!(row(1))).toBe(0.1);
  });

  it("bomToCsv writes the same unit and extended price", async () => {
    const { bomToCsv } = await import("@/app/lib/bom/build");
    const csv = bomToCsv({ rows: [row(10)] } as never);
    const [header, line] = csv.trim().split(/\r?\n/);
    const cells = header!.split(",");
    const values = line!.split(",");
    expect(values[cells.indexOf("Best Unit Price")]).toBe("0.05");
    expect(values[cells.indexOf("Extended Price")]).toBe("0.5");
  });

  it("the procurement packet's extended cost uses the break the total quantity reaches", () => {
    const csv = toProcurementPacketCsv([row(1)], { title: "t", buildQuantity: 10, date: new Date("2026-09-13T00:00:00Z") });
    const total = csv.split(/\r?\n/).find((l) => l.startsWith("TOTAL PROJECT COST"))!;
    expect(Number(total.split(",")[20])).toBe(0.5);
  });

  it("the BOM view reads the line's unit price (tripwire on BomView.tsx)", () => {
    const view = readFileSync(resolve(process.cwd(), "app/components/bom/BomView.tsx"), "utf8");
    expect(view).toMatch(/lineUnitPrice\(row\)/);
  });
});

describe("[B19-D I5b review] snapshots and alternates price the same way", () => {
  it("a snapshot's price is labelled in the pricing currency, whatever other break shares its number", () => {
    const gbpTwin: PartPricing = { ...offer, priceBreaks: [{ qty: 1, price: 0.1, currency: "GBP" }, ...breaks] };
    const r = row(1);
    r.pricing = { ...r.pricing!, offers: [gbpTwin], bestOverall: gbpTwin };
    expect(rowToSnapshotRow(r).bestPriceCurrency).toBe("USD");
  });

  it("alternates compare USD prices at quantity 1, not a volume break or another currency", () => {
    expect(bestOfferPrice([{ priceBreaks: [{ qty: 10000, price: 0.01, currency: "USD" }, { qty: 1, price: 0.2, currency: "USD" }, { qty: 1, price: 0.05, currency: "GBP" }], stock: 1 } as never])).toEqual({ value: 0.2, currency: "USD" });
  });

  it("snapshots with different price meanings are not compared on price or best supplier", () => {
    const snap = (id: string, cents: number, source: string, priceBasis?: string): BomSnapshot => ({ id, projectKey: "k", label: null, takenAt: new Date(), rows: [{ partId: "p", mpn: "R", manufacturer: null, refDesList: ["R1"], qty: 1, lifecycleStatus: "active", totalStock: 10, bestPriceCents: cents, bestPriceCurrency: "USD", bestSourceDistributor: source, alternatesCount: 0, riskScore: 0 }], meta: { totalRows: 1, totalCostCents: null, currency: null, designRiskScore: 0, ...(priceBasis ? { priceBasis } : {}) } as never });
    expect(diffSnapshots(snap("old", 8, "octopart-aggregated"), snap("now", 45, "digikey", "usd-at-quantity-1"))).toEqual([]);
    // same meaning on both sides still compares (baseline)
    expect(diffSnapshots(snap("a", 8, "digikey", "usd-at-quantity-1"), snap("b", 45, "digikey", "usd-at-quantity-1")).map((c) => c.kind)).toEqual(["price_spike"]);
  });
});

describe("[B19-D I5b review] every reader of stored offers applies the exact-MPN rule and the read-time lifecycle expiry", () => {
  it.each([
    ["app/api/parts/[id]/alternates/route.ts", /offersForExactMpn\(/],
    ["scripts/compute-alternates.ts", /offersForExactMpn\(/],
    ["scripts/refresh-bom-pricing.ts", /offersForExactMpn\(/],
  ])("%s", (file, pattern) => {
    expect(readFileSync(resolve(process.cwd(), file), "utf8")).toMatch(pattern);
  });

  /* [PR-D d2, 2026-10-16] pin move: the parts detail route's read moved UNCHANGED into app/lib/atomic/catalog-part-detail.ts (loadCatalogPartDetail), which the route and the agent's sirkit.parts.catalog-inspect share (one reader); the expiring expression is read there, and the route is a thin caller */
  it.each(["app/lib/parts-search.ts", "app/api/parts/search/route.ts", "app/lib/atomic/catalog-part-detail.ts", "app/api/parts/[id]/alternates/route.ts", "scripts/refresh-bom-pricing.ts"])("%s reads lifecycle through the expiring expression", (file) => {
    const source = readFileSync(resolve(process.cwd(), file), "utf8");
    expect(source).not.toMatch(/lifecycleStatus:\s*parts\.lifecycleStatus/);
    expect(source).toMatch(/partLifecycleStatus/);
  });

  it("backfill-parts clears the vendor stamp when it writes a KiCad-derived status", () => {
    const source = readFileSync(resolve(process.cwd(), "scripts/backfill-parts.ts"), "utf8");
    expect(source).toMatch(/lifecycleStatus: lifecycle,\s*\n\s*lastRefreshedAt: null/);
  });
});
