/**
 * [B19-D I5b rows 01, 36 — the pricing layer] A distributor observation is bound only to the exact part number it answers for.
 *
 * Reproduced from the import-security matrix: DigiKey and Mouser fell back to the FIRST search result when no product
 * matched the requested MPN, Nexar took `results[0]` without comparing, and the pricing layer then RELABELLED whatever came
 * back (`offer.mpn = requested`) before caching it and writing its lifecycle into `parts`. So a request for `MAX3232CSE`
 * could carry the price, stock and lifecycle of `MAX3232CSE+`. Cached offers had no MPN at all and were relabelled the same
 * way.
 *
 * Policy (recorded as OD-34): exact published MPNs compare after trimming and ASCII case-folding only — every suffix
 * character (`+`, `#`, `/`, `-`, `.`) is significant, and anything outside printable ASCII never matches.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── the pricing layer ────────────────────────────────────────────────────────

const offer = (mpn: string, distributor = "digikey") => ({ distributor, mpn, manufacturer: null, description: null, datasheet: null, inStock: 5, minOrderQty: 1, priceBreaks: [{ qty: 1, price: 1, currency: "USD" }], bestUnitPrice: 1, productUrl: null, package: null, lifecycleStatus: "obsolete", lifecycleRaw: "Obsolete", fetchedAt: Date.now() });

const answers = new Map<string, ReturnType<typeof offer>>();
const cachedRows = new Map<string, Map<string, ReturnType<typeof offer>>>();
const puts: string[] = [];
const lifecycleSets: unknown[] = [];

vi.mock("../digikey", () => ({ makeDigiKeyClient: () => ({ name: "digikey", lookupByMpn: vi.fn(), lookupBatch: vi.fn(async (mpns: string[]) => new Map(mpns.filter((mpn) => answers.has(mpn)).map((mpn) => [mpn, { ...answers.get(mpn)! }]))) }) }));
vi.mock("../mouser", () => ({ makeMouserClient: () => ({ name: "mouser", lookupByMpn: vi.fn(), lookupBatch: vi.fn(async () => new Map()) }) }));
vi.mock("../octopart", () => ({ makeOctopartClient: () => ({ name: "octopart-aggregated", lookupByMpn: vi.fn(), lookupBatch: vi.fn(async () => new Map()) }) }));
vi.mock("../cache", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    getCachedOffersForParts: vi.fn(async () => cachedRows),
    putCachedOffer: vi.fn(async (partId: string, name: string, value: { mpn: string }) => { puts.push(`${partId}:${name}:${value.mpn}`); }),
    evictCached: vi.fn(),
  };
});
vi.mock("../../db/client", () => ({ getDb: () => ({ update: () => ({ set: (value: unknown) => { lifecycleSets.push(value); return { where: async () => undefined }; } }) }) }));

/** The result key for a (part, MPN) pair: `pricingKey` once pricing is keyed by exact MPN, the bare partId before. */
async function keyFor(partId: string, mpn: string): Promise<string> {
  const mod = (await import("..")) as { pricingKey?: (partId: string, mpn: string) => string };
  return typeof mod.pricingKey === "function" ? mod.pricingKey(partId, mpn) : partId;
}

describe("[B19-D I5b row 01] the pricing layer never relabels an offer", () => {
  beforeEach(() => {
    vi.stubEnv("DIGIKEY_CLIENT_ID", "id");
    vi.stubEnv("DIGIKEY_CLIENT_SECRET", "secret");
    answers.clear();
    cachedRows.clear();
    puts.length = 0;
    lifecycleSets.length = 0;
  });
  afterEach(() => vi.unstubAllEnvs());

  it("a live answer for a different MPN is dropped: not attached, not cached, no lifecycle written", async () => {
    const { getPricingFor } = await import("..");
    answers.set("MAX3232CSE", offer("MAX3232CSE+"));
    const result = await getPricingFor([{ partId: "p-232", mpn: "MAX3232CSE" }], "digikey", { live: true });
    expect(result.get(await keyFor("p-232", "MAX3232CSE"))?.offers ?? []).toEqual([]);
    expect(puts).toEqual([]);
    expect(lifecycleSets).toEqual([]);
  });

  it("a live answer for the exact MPN is attached and cached with its own MPN (baseline)", async () => {
    const { getPricingFor } = await import("..");
    answers.set("NE555DR", offer("NE555DR"));
    const result = await getPricingFor([{ partId: "p-555", mpn: "NE555DR" }], "digikey", { live: true });
    expect(result.get(await keyFor("p-555", "NE555DR"))?.offers.map((item) => item.mpn)).toEqual(["NE555DR"]);
    expect(puts).toEqual(["p-555:digikey:NE555DR"]);
  });

  it("a cached offer stored for a different MPN is not served for this one", async () => {
    const { getPricingFor } = await import("..");
    cachedRows.set("p-555", new Map([["digikey", offer("NE555P")]]));
    const result = await getPricingFor([{ partId: "p-555", mpn: "NE555DR" }], "digikey", { live: false });
    expect(result.get(await keyFor("p-555", "NE555DR"))?.offers ?? []).toEqual([]);
  });

  it("a cached offer stored without an MPN (a row written before B19) is not served", async () => {
    const { getPricingFor } = await import("..");
    cachedRows.set("p-555", new Map([["digikey", offer("")]]));
    const result = await getPricingFor([{ partId: "p-555", mpn: "NE555DR" }], "digikey", { live: false });
    expect(result.get(await keyFor("p-555", "NE555DR"))?.offers ?? []).toEqual([]);
  });

  it("[row 36] two exact MPNs under one catalog part are priced separately", async () => {
    const { getPricingFor, pricingKey } = await import("..");
    answers.set("RC0805FR-0710KL", offer("RC0805FR-0710KL"));
    answers.set("RC0805FR-0756KL", offer("RC0805FR-0756KL"));
    const result = await getPricingFor([{ partId: "P", mpn: "RC0805FR-0710KL" }, { partId: "P", mpn: "RC0805FR-0756KL" }], "digikey", { live: true });
    expect(typeof pricingKey).toBe("function");
    expect(result.get(pricingKey("P", "RC0805FR-0710KL"))?.bestOverall?.mpn).toBe("RC0805FR-0710KL");
    expect(result.get(pricingKey("P", "RC0805FR-0756KL"))?.bestOverall?.mpn).toBe("RC0805FR-0756KL");
  });
});
