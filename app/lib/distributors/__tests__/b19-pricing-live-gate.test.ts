/**
 * [B19-B I2] Live distributor pricing is a capability a caller must be granted — never the default.
 *
 * The drain, as discovery found it and I2 measured it: six PUBLIC routes (`/api/bom`, the CSV export, the procurement
 * packet and the three cart routes) price the caller's schematic through `getPricingFor`, and every cache miss is a live,
 * quota-metered vendor call. Nexar's developer tier is about 1000 queries a MONTH. `/api/bom` also honours a caller-sent
 * `forceRefresh`, which bypasses the cache for parts already priced. The priced MPNs resolve server-side from the parts
 * catalog, so the spend is bounded by the catalog — but `forceRefresh` makes it unbounded in repetition, and nothing asked
 * who the caller was.
 *
 * So the pricing layer now FAILS CLOSED: without an explicit `live: true` it serves the cache and never calls a vendor,
 * and `forceRefresh` means nothing unless live pricing was granted.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lookups: Record<string, number> = { digikey: 0, mouser: 0, octopart: 0 };
const fakeClient = (name: string) => ({
  name,
  lookupByMpn: vi.fn(async () => { lookups[name] = (lookups[name] ?? 0) + 1; return null; }),
  lookupBatch: vi.fn(async (mpns: string[]) => {
    lookups[name] = (lookups[name] ?? 0) + mpns.length;
    return new Map(mpns.map((mpn) => [mpn, { distributor: name, mpn, manufacturer: null, description: null, datasheet: null, inStock: 5, minOrderQty: 1, priceBreaks: [], bestUnitPrice: 1, productUrl: null, package: null, lifecycleStatus: "active", lifecycleRaw: "Active", fetchedAt: 0 }]));
  }),
});

vi.mock("../digikey", () => ({ makeDigiKeyClient: () => fakeClient("digikey") }));
vi.mock("../mouser", () => ({ makeMouserClient: () => fakeClient("mouser") }));
vi.mock("../octopart", () => ({ makeOctopartClient: () => fakeClient("octopart") }));

const cacheReads: string[][] = [];
const evictions: string[] = [];
vi.mock("../cache", async (orig) => {
  const actual = await orig() as Record<string, unknown>;
  return {
    ...actual,
    getCachedOffersForParts: vi.fn(async (partIds: string[]) => { cacheReads.push(partIds); return new Map(); }),
    putCachedOffer: vi.fn(async () => undefined),
    evictCached: vi.fn((name: string, mpn: string) => { evictions.push(`${name}:${mpn}`); }),
  };
});
vi.mock("../../db/client", () => ({
  getDb: () => ({ update: () => ({ set: () => ({ where: async () => undefined }) }) }),
}));

import { getPricingFor } from "..";

const PARTS = [{ partId: "p-555", mpn: "NE555DR" }, { partId: "p-r1", mpn: "RC0805FR-0710KL" }];

beforeEach(() => {
  for (const key of Object.keys(lookups)) lookups[key] = 0;
  cacheReads.length = 0;
  evictions.length = 0;
});
afterEach(() => vi.clearAllMocks());

const totalLookups = (): number => Object.values(lookups).reduce((sum, value) => sum + value, 0);

describe("[B19-B I2] the pricing layer fails closed", () => {
  it("with NO options it serves the cache and never calls a vendor — the safe default, not the expensive one", async () => {
    await getPricingFor(PARTS, "all");
    expect(totalLookups(), "no vendor was called").toBe(0);
    expect(cacheReads, "the cache is still served").toHaveLength(1);
  });

  it("`live: false` never calls a vendor, and `forceRefresh` cannot pierce the cache without live pricing", async () => {
    await getPricingFor(PARTS, "all", { live: false, forceRefresh: true });
    expect(totalLookups()).toBe(0);
    expect(cacheReads, "the cache is read, not skipped").toHaveLength(1);
    expect(evictions, "and nothing is evicted").toEqual([]);
  });

  it("only an explicit `live: true` looks up the misses — once per source, for exactly the uncached parts", async () => {
    await getPricingFor(PARTS, "all", { live: true });
    expect(lookups).toEqual({ digikey: 2, mouser: 2, octopart: 2 });
  });

  it("`live: true` with `forceRefresh` is the one path that bypasses the cache", async () => {
    await getPricingFor(PARTS, "digikey", { live: true, forceRefresh: true });
    expect(cacheReads, "the cache read is skipped").toHaveLength(0);
    expect(evictions).toEqual(["digikey:NE555DR", "digikey:RC0805FR-0710KL"]);
    expect(lookups.digikey).toBe(2);
  });
});
