/**
 * [B19-D I5b review] A persisted lifecycle verdict comes only from live answers, and is stamped with when they were fetched.
 *
 *  - mixed live and cached (low): a cached offer's lifecycle was re-stamped into `parts` whenever any OTHER source answered
 *    live, extending it past its source's retention.
 *  - memo hits (low): a connector's in-process memo answer counted as live, and the verdict was stamped `now` although the
 *    vendor answered up to a full freshness window earlier.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sets: Array<Record<string, unknown>> = [];
const cachedRows = new Map<string, Map<string, unknown>>();
const liveAnswers = new Map<string, Record<string, unknown>>();
const offer = (distributor: string, mpn: string, lifecycleStatus: string, fetchedAt: number, evidence?: { rawContentHash: string; retrievedAt: number }) => ({ distributor, mpn, manufacturer: null, description: null, datasheet: null, inStock: 1, minOrderQty: 1, priceBreaks: [], bestUnitPrice: null, productUrl: null, package: null, lifecycleStatus, lifecycleRaw: null, fetchedAt, ...(evidence ? { evidence } : {}) });

vi.mock("../digikey", () => ({ makeDigiKeyClient: () => ({ name: "digikey", lookupByMpn: vi.fn(), lookupBatch: vi.fn(async (mpns: string[]) => new Map(mpns.filter((mpn) => liveAnswers.has(`digikey:${mpn}`)).map((mpn) => [mpn, liveAnswers.get(`digikey:${mpn}`)]))) }) }));
vi.mock("../mouser", () => ({ makeMouserClient: () => ({ name: "mouser", lookupByMpn: vi.fn(), lookupBatch: vi.fn(async () => new Map()) }) }));
vi.mock("../octopart", () => ({ makeOctopartClient: () => ({ name: "octopart-aggregated", lookupByMpn: vi.fn(), lookupBatch: vi.fn(async (mpns: string[]) => new Map(mpns.filter((mpn) => liveAnswers.has(`octopart:${mpn}`)).map((mpn) => [mpn, liveAnswers.get(`octopart:${mpn}`)]))) }) }));
vi.mock("../cache", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, getCachedOffersForParts: vi.fn(async () => cachedRows), putCachedOffer: vi.fn(async () => undefined), evictCached: vi.fn() };
});
vi.mock("../../db/client", () => ({ getDb: () => ({ update: () => ({ set: (value: Record<string, unknown>) => { sets.push(value); return { where: async () => undefined }; } }) }) }));

beforeEach(() => {
  for (const [name, value] of Object.entries({ DIGIKEY_CLIENT_ID: "id", DIGIKEY_CLIENT_SECRET: "secret", OCTOPART_API_KEY: "token" })) vi.stubEnv(name, value);
  sets.length = 0;
  cachedRows.clear();
  liveAnswers.clear();
});
afterEach(() => vi.unstubAllEnvs());

describe("[B19-D I5b review] only live answers decide the persisted verdict", () => {
  it("a cached 'obsolete' and a live 'unknown' persist nothing", async () => {
    const { getPricingFor } = await import("..");
    cachedRows.set("p-555", new Map([["digikey", offer("digikey", "NE555DR", "obsolete", Date.now() - 50 * 60_000)]]));
    liveAnswers.set("octopart:NE555DR", offer("octopart-aggregated", "NE555DR", "unknown", Date.now(), { rawContentHash: "a".repeat(64), retrievedAt: Date.now() }));
    await getPricingFor([{ partId: "p-555", mpn: "NE555DR" }], "all", { live: true });
    expect(sets).toEqual([]);
  });

  it("a live verdict is stamped with when the vendor answered, not with now", async () => {
    const { getPricingFor } = await import("..");
    const answeredAt = Date.now() - 40 * 60_000; // a memo answer from forty minutes ago
    liveAnswers.set("digikey:NE555DR", offer("digikey", "NE555DR", "nrnd", answeredAt, { rawContentHash: "b".repeat(64), retrievedAt: answeredAt }));
    await getPricingFor([{ partId: "p-555", mpn: "NE555DR" }], "digikey", { live: true });
    expect(sets).toHaveLength(1);
    expect(sets[0]!.lifecycleStatus).toBe("nrnd");
    expect((sets[0]!.lastRefreshedAt as Date).getTime()).toBe(answeredAt);
  });
});
