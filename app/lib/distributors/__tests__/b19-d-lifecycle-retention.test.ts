/**
 * [B19-D I5b row 03] A vendor-derived lifecycle status is not kept past its sources' retention.
 *
 * The pricing layer wrote the consolidated lifecycle verdict into `parts` (with a fresh refresh stamp) on EVERY call — a
 * cache-only BOM export included — and nothing ever cleared it, while the offers it came from are kept at most 1 hour
 * (DigiKey, OD-33) or 24 hours (Nexar's terms). Re-stamping from cached offers extended that derived fact indefinitely.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sets: unknown[] = [];
const cachedRows = new Map<string, Map<string, unknown>>();

vi.mock("../digikey", () => ({ makeDigiKeyClient: () => ({ name: "digikey", lookupByMpn: vi.fn(), lookupBatch: vi.fn(async (mpns: string[]) => new Map(mpns.map((mpn) => [mpn, { distributor: "digikey", mpn, manufacturer: null, description: null, datasheet: null, inStock: 1, minOrderQty: 1, priceBreaks: [], bestUnitPrice: null, productUrl: null, package: null, lifecycleStatus: "nrnd", lifecycleRaw: "NRND", fetchedAt: Date.now() }]))) }) }));
vi.mock("../mouser", () => ({ makeMouserClient: () => ({ name: "mouser", lookupByMpn: vi.fn(), lookupBatch: vi.fn(async () => new Map()) }) }));
vi.mock("../octopart", () => ({ makeOctopartClient: () => ({ name: "octopart-aggregated", lookupByMpn: vi.fn(), lookupBatch: vi.fn(async () => new Map()) }) }));
vi.mock("../cache", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, getCachedOffersForParts: vi.fn(async () => cachedRows), putCachedOffer: vi.fn(async () => undefined), evictCached: vi.fn() };
});
vi.mock("../../db/client", () => ({ getDb: () => ({ update: () => ({ set: (value: unknown) => { sets.push(value); return { where: async () => undefined }; } }) }) }));

beforeEach(() => {
  vi.stubEnv("DIGIKEY_CLIENT_ID", "id");
  vi.stubEnv("DIGIKEY_CLIENT_SECRET", "secret");
  sets.length = 0;
  cachedRows.clear();
});
afterEach(() => vi.unstubAllEnvs());

describe("[B19-D I5b row 03] derived lifecycle is written only from a live answer", () => {
  it("a cache-only read never re-stamps the part's lifecycle", async () => {
    const { getPricingFor } = await import("..");
    cachedRows.set("p-555", new Map([["digikey", { distributor: "digikey", mpn: "NE555DR", manufacturer: null, description: null, datasheet: null, inStock: 1, minOrderQty: 1, priceBreaks: [], bestUnitPrice: null, productUrl: null, package: null, lifecycleStatus: "obsolete", lifecycleRaw: "Obsolete", fetchedAt: Date.now() }]]));
    await getPricingFor([{ partId: "p-555", mpn: "NE555DR" }], "digikey", { live: false });
    expect(sets).toEqual([]);
  });

  it("a live answer writes it (baseline)", async () => {
    const { getPricingFor } = await import("..");
    await getPricingFor([{ partId: "p-555", mpn: "NE555DR" }], "digikey", { live: true });
    expect(sets).toHaveLength(1);
    expect(sets[0]).toMatchObject({ lifecycleStatus: "nrnd" });
  });
});
