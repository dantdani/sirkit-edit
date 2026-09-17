/**
 * [B19-E E1] The orchestrator's counts say what actually happened.
 *
 * Before E1 every aggregate listed all active sources in `sourcesQueried` even when the build was cache-only and nothing was
 * asked, and an answer a connector served from its in-process memo was counted as live (`sourcesFromLive`), so the BOM said
 * "fetched live" for prices no vendor had just sent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cachedRows = new Map<string, Map<string, unknown>>();
const answers = new Map<string, Record<string, unknown>>();
const batchCalls: string[] = [];
const offer = (distributor: string, servedFrom: "live" | "process-memo" | "offer-cache", retrievedAt: number) => ({
  distributor, mpn: "NE555DR", manufacturer: null, description: null, datasheet: null, inStock: 1, minOrderQty: 1, priceBreaks: [],
  bestUnitPrice: null, productUrl: null, package: null, lifecycleStatus: "unknown", lifecycleRaw: null, fetchedAt: retrievedAt,
  ...(servedFrom === "offer-cache" ? {} : { evidence: { rawContentHash: "d".repeat(64), retrievedAt } }),
  provenance: { servedFrom, retrievedAt },
});
const client = (name: string, key: string) => ({ name, lookupByMpn: vi.fn(), lookupBatch: vi.fn(async (mpns: string[]) => { batchCalls.push(name); return new Map(mpns.filter((mpn) => answers.has(`${key}:${mpn}`)).map((mpn) => [mpn, answers.get(`${key}:${mpn}`)])); }) });

vi.mock("../digikey", () => ({ makeDigiKeyClient: () => client("digikey", "digikey") }));
vi.mock("../mouser", () => ({ makeMouserClient: () => client("mouser", "mouser") }));
vi.mock("../octopart", () => ({ makeOctopartClient: () => client("octopart-aggregated", "octopart") }));
vi.mock("../cache", async (orig) => ({ ...((await orig()) as Record<string, unknown>), getCachedOffersForParts: vi.fn(async () => cachedRows), putCachedOffer: vi.fn(async () => undefined), evictCached: vi.fn() }));
vi.mock("../../db/client", () => ({ getDb: () => ({ update: () => ({ set: () => ({ where: async () => undefined }) }) }) }));

beforeEach(() => {
  for (const [name, value] of Object.entries({ DIGIKEY_CLIENT_ID: "id", DIGIKEY_CLIENT_SECRET: "secret", OCTOPART_API_KEY: "token" })) vi.stubEnv(name, value);
  cachedRows.clear();
  answers.clear();
  batchCalls.length = 0;
});
afterEach(() => vi.unstubAllEnvs());

describe("[B19-E E1] sources queried, cached and live are counted truthfully", () => {
  it("a cache-only build queries no source and counts nothing live", async () => {
    const { getPricingFor, pricingKey } = await import("..");
    cachedRows.set("p-555", new Map([["digikey", offer("digikey", "offer-cache", Date.now() - 10 * 60_000)]]));
    const result = await getPricingFor([{ partId: "p-555", mpn: "NE555DR" }], "all", { live: false });
    const aggregate = result.get(pricingKey("p-555", "NE555DR"))!;
    expect(aggregate.sourcesQueried).toEqual([]);
    expect(aggregate.sourcesFromLive).toBe(0);
    expect(aggregate.sourcesFromCache).toBe(1);
    expect(batchCalls).toEqual([]);
  });

  it("a memo answer is counted as cached, not live; a live answer is counted live; only the asked sources are listed", async () => {
    const { getPricingFor, pricingKey } = await import("..");
    answers.set("digikey:NE555DR", offer("digikey", "process-memo", Date.now() - 30 * 60_000));
    answers.set("octopart:NE555DR", offer("octopart-aggregated", "live", Date.now()));
    const result = await getPricingFor([{ partId: "p-555", mpn: "NE555DR" }], "all", { live: true });
    const aggregate = result.get(pricingKey("p-555", "NE555DR"))!;
    expect(aggregate.sourcesFromLive).toBe(1);
    expect(aggregate.sourcesFromCache).toBe(1);
    expect([...aggregate.sourcesQueried].sort()).toEqual(["digikey", "octopart-aggregated"]);
  });

  it("an offer already served from the offer cache is not asked for again, and its source is not listed as queried", async () => {
    const { getPricingFor, pricingKey } = await import("..");
    cachedRows.set("p-555", new Map([["digikey", offer("digikey", "offer-cache", Date.now() - 10 * 60_000)]]));
    answers.set("octopart:NE555DR", offer("octopart-aggregated", "live", Date.now()));
    const result = await getPricingFor([{ partId: "p-555", mpn: "NE555DR" }], "all", { live: true });
    expect(result.get(pricingKey("p-555", "NE555DR"))!.sourcesQueried).toEqual(["octopart-aggregated"]);
  });
});
