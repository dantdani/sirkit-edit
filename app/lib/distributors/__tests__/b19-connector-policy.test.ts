/**
 * [B19-A I3] The connectors take their policy from the source registry — a fake transport, no vendor, no credential.
 *
 * Checked against the vendors' current official documentation (2026-09-13, recorded in `source-registry.md`):
 *  - DigiKey's Product Information API allows 120 requests a minute. The connector spaced requests 200 ms apart — up to
 *    300 a minute, and DigiKey's user agreement suspends an account for 10 minutes over its burst threshold.
 *  - Mouser's API terms prohibit caching or storing its content. Its client never memoized an answer (measured: this case
 *    passes on the pre-B19 client too) and must not start; persistence one layer up is the defect (b19-offer-retention).
 *  - LCSC has an official API that needs an approved partner application. It stays blocked, for the registry's reason.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeDigiKeyClient } from "../digikey";
import { makeMouserClient } from "../mouser";
import { makeLcscClient } from "../lcsc";
import { clearPricingCache } from "../cache";
import { DISTRIBUTOR_EGRESS_POLICIES } from "../egress";
import { SOURCE_REGISTRY } from "../../acquisition/source-registry";

const PUBLIC = async (): Promise<string[]> => ["93.184.216.34"];
const jsonResponse = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });

beforeEach(() => {
  vi.stubGlobal("fetch", () => { throw new Error("a connector bypassed the egress boundary"); });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearPricingCache();
});

describe("[B19-A I3] request spacing honours the documented per-minute limit", () => {
  it("DigiKey: consecutive searches are at least 60 000 / 120 = 500 ms apart", async () => {
    const searchTimes: number[] = [];
    const transport: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/oauth2/token")) return jsonResponse({ access_token: "tok", expires_in: 600 });
      searchTimes.push(Date.now());
      return jsonResponse({ Products: [] });
    };
    const client = makeDigiKeyClient({ clientId: "id", clientSecret: "secret", egress: { fetch: transport, resolve: PUBLIC } });
    await client.lookupBatch(["A-1", "B-2", "C-3"]);
    expect(searchTimes).toHaveLength(3);
    const gaps = searchTimes.slice(1).map((time, index) => time - searchTimes[index]!);
    // a timer may fire a few milliseconds early on a loaded machine; 480 still refuses the old 200 ms spacing
    for (const gap of gaps) expect(gap, `gaps were ${gaps.join(", ")} ms`).toBeGreaterThanOrEqual(480);
  }, 10_000);
});

describe("[B19-A I3] a source whose terms prohibit storage is never memoized", () => {
  it("Mouser: asking twice for the same part asks Mouser twice", async () => {
    let searches = 0;
    const transport: typeof fetch = async () => {
      searches += 1;
      return jsonResponse({ SearchResults: { Parts: [{ ManufacturerPartNumber: "NE555DR", Manufacturer: "TI", AvailabilityInStock: "10", PriceBreaks: [] }] } });
    };
    const client = makeMouserClient({ apiKey: "MOUSER-TEST-KEY", egress: { fetch: transport, resolve: PUBLIC } });
    expect(await client.lookupByMpn("NE555DR")).not.toBeNull();
    expect(await client.lookupByMpn("NE555DR")).not.toBeNull();
    expect(searches, "a second answer served from memory would be stored Mouser content").toBe(2);
  }, 10_000);
});

describe("[B19-A I3] the egress boundary's per-source policy IS the registry's", () => {
  it.each(["digikey", "mouser", "octopart"] as const)("%s", (id) => {
    const entry = SOURCE_REGISTRY[id];
    expect(DISTRIBUTOR_EGRESS_POLICIES[id]).toMatchObject({
      allowedHosts: [...entry.endpoints.hosts],
      deadlineMs: entry.resilience.deadlineMs,
      maxResponseBytes: entry.resilience.maxResponseBytes,
      maxRedirects: 0,
    });
    expect([...(DISTRIBUTOR_EGRESS_POLICIES[id].secretQueryParams ?? [])]).toEqual([...entry.auth.secretQueryParams]);
  });
});

describe("[B19-A I3] LCSC is blocked, and says why", () => {
  it("constructing it refuses with the registry's reason", () => {
    expect(() => makeLcscClient({ apiKey: "anything" })).toThrow(/blocked/i);
    expect(() => makeLcscClient({ apiKey: "anything" })).toThrow(SOURCE_REGISTRY.lcsc.state.reason.slice(0, 40));
  });
});
