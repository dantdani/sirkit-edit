/**
 * [B19-D I5b row 01 — the connectors] A distributor observation is bound only to the exact part number it answers for.
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

const PUBLIC = async (): Promise<string[]> => ["93.184.216.34"];
const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });

describe("[B19-D I5b row 01] the connectors never answer for a different part", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", () => { throw new Error("a connector bypassed the egress boundary"); });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    (await import("../../acquisition/admission-control")).resetAdmissionControl();
    (await import("../cache")).clearPricingCache();
  });

  const substitute = { ManufacturerProductNumber: "MAX3232CSE+", Manufacturer: { Name: "Analog Devices" }, ProductStatus: { Status: "Active" }, QuantityAvailable: 5000, StandardPricing: [{ BreakQuantity: 1, UnitPrice: 4.1, Currency: "USD" }], ProductUrl: "https://www.digikey.com/p/x" };

  it("DigiKey: a search whose only product is a different MPN answers nothing", async () => {
    const { makeDigiKeyClient } = await import("../digikey");
    const transport: typeof fetch = async (input) => (String(input).includes("/oauth2/") ? json({ access_token: "t", expires_in: 600 }) : json({ Products: [substitute] }));
    const client = makeDigiKeyClient({ clientId: "id", clientSecret: "secret", egress: { fetch: transport, resolve: PUBLIC } });
    expect(await client.lookupByMpn("MAX3232CSE")).toBeNull();
  }, 10_000);

  it("DigiKey: the exact product is chosen even when it is not first, and case alone does not matter (baselines)", async () => {
    const { makeDigiKeyClient } = await import("../digikey");
    const exact = { ...substitute, ManufacturerProductNumber: "MAX3232CSE", QuantityAvailable: 7 };
    const transport: typeof fetch = async (input) => (String(input).includes("/oauth2/") ? json({ access_token: "t", expires_in: 600 }) : json({ Products: [substitute, exact] }));
    const client = makeDigiKeyClient({ clientId: "id", clientSecret: "secret", egress: { fetch: transport, resolve: PUBLIC } });
    expect(await client.lookupByMpn("max3232cse")).toMatchObject({ mpn: "MAX3232CSE", inStock: 7 });
  }, 10_000);

  it("Mouser: a search whose only part is a different MPN answers nothing", async () => {
    const { makeMouserClient } = await import("../mouser");
    const transport: typeof fetch = async () => json({ SearchResults: { Parts: [{ ManufacturerPartNumber: "MAX3232CSE+", Manufacturer: "ADI", AvailabilityInStock: "10", PriceBreaks: [] }] } });
    const client = makeMouserClient({ apiKey: "MOUSER-TEST-KEY", egress: { fetch: transport, resolve: PUBLIC } });
    expect(await client.lookupByMpn("MAX3232CSE")).toBeNull();
  }, 10_000);

  it("Nexar: a result for a different MPN answers nothing", async () => {
    const { makeOctopartClient } = await import("../octopart");
    const transport: typeof fetch = async () => json({ data: { s0: { results: [{ part: { mpn: "MAX3232CSE+", manufacturer: { name: "ADI" }, lifecycleStatus: "Production", sellers: [] } }] } } });
    const client = makeOctopartClient({ apiKey: "nexar-test-token", egress: { fetch: transport, resolve: PUBLIC } });
    expect(await client.lookupByMpn("MAX3232CSE")).toBeNull();
  }, 10_000);

  it.each([
    ["a zero-width space", "MAX3232​CSE"],
    ["a Cyrillic homoglyph", "MAX3232СSE"],
    ["a long s that upper-cases to S", "BAT54ſ"],
  ])("Nexar: a result spelled with %s never matches the plain request", async (_label, spelled) => {
    const { makeOctopartClient } = await import("../octopart");
    const requested = spelled.includes("BAT54") ? "BAT54S" : "MAX3232CSE";
    const transport: typeof fetch = async () => json({ data: { s0: { results: [{ part: { mpn: spelled, sellers: [] } }] } } });
    const client = makeOctopartClient({ apiKey: "nexar-test-token", egress: { fetch: transport, resolve: PUBLIC } });
    expect(await client.lookupByMpn(requested)).toBeNull();
  }, 10_000);
});
