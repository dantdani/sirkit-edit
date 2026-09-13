/**
 * [B19-D I5b review] Two verified findings from the adversarial review of the I5b diff, at the real connectors.
 *
 *  - no-negative-cache (medium): once connectors stopped substituting the first search result, a "no exact match" answer
 *    was never remembered — every live BOM view re-queried the vendor for such MPNs, spending the daily request budget and
 *    Nexar's matched-part quota.
 *  - memo key folding (low): the connectors' memo and in-flight keys were `toLowerCase()`d, so a confusable request (a Kelvin
 *    sign K) was answered from the memo of the plain MPN's offer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PUBLIC = async (): Promise<string[]> => ["93.184.216.34"];
const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });

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

describe("[B19-D I5b review] a 'no exact match' answer is remembered for the source's freshness", () => {
  it("DigiKey: asking twice for an MPN the vendor has no exact product for searches once", async () => {
    const { makeDigiKeyClient } = await import("../digikey");
    let searches = 0;
    const transport: typeof fetch = async (input) => {
      if (String(input).includes("/oauth2/")) return json({ access_token: "t", expires_in: 600 });
      searches += 1;
      return json({ Products: [{ ManufacturerProductNumber: "LM358DR", QuantityAvailable: 1, StandardPricing: [] }] });
    };
    const client = makeDigiKeyClient({ clientId: "id", clientSecret: "secret", egress: { fetch: transport, resolve: PUBLIC } });
    expect(await client.lookupByMpn("LM358")).toBeNull();
    expect(await client.lookupByMpn("LM358")).toBeNull();
    expect(searches).toBe(1);
  }, 10_000);

  it("DigiKey: a failed request is NOT remembered as 'no match' — the next ask tries again (baseline)", async () => {
    const { makeDigiKeyClient } = await import("../digikey");
    let searches = 0;
    const transport: typeof fetch = async (input) => {
      if (String(input).includes("/oauth2/")) return json({ access_token: "t", expires_in: 600 });
      searches += 1;
      return new Response("{}", { status: 500, headers: { "content-type": "application/json" } });
    };
    const client = makeDigiKeyClient({ clientId: "id", clientSecret: "secret", egress: { fetch: transport, resolve: PUBLIC } });
    await client.lookupByMpn("LM358");
    await client.lookupByMpn("LM358");
    expect(searches).toBe(2);
  }, 10_000);

  it("Nexar: an MPN whose search returned a different part is not queried again", async () => {
    const { makeOctopartClient } = await import("../octopart");
    let queries = 0;
    const transport: typeof fetch = async () => {
      queries += 1;
      return json({ data: { s0: { results: [{ part: { mpn: "LM358DR", sellers: [] } }] } } });
    };
    const client = makeOctopartClient({ apiKey: "nexar-test-token", egress: { fetch: transport, resolve: PUBLIC } });
    expect(await client.lookupByMpn("LM358")).toBeNull();
    expect(await client.lookupByMpn("LM358")).toBeNull();
    expect(queries).toBe(1);
  });
});

describe("[B19-D I5b review] a confusable request never reads the plain MPN's memo", () => {
  it("Nexar: after pricing RC0805FR-0710KL, a request spelled with a Kelvin sign answers nothing", async () => {
    const { makeOctopartClient } = await import("../octopart");
    const transport: typeof fetch = async (_input, init) => {
      const variables = (JSON.parse(String(init?.body)) as { variables: Record<string, string> }).variables;
      const mpn = Object.values(variables)[0]!;
      return json({ data: { s0: { results: [{ part: { mpn, sellers: [] } }] } } });
    };
    const client = makeOctopartClient({ apiKey: "nexar-test-token", egress: { fetch: transport, resolve: PUBLIC } });
    expect(await client.lookupByMpn("RC0805FR-0710KL")).not.toBeNull();
    expect(await client.lookupByMpn("RC0805FR-0710KL")).toBeNull();
  });

  it("DigiKey: the same, through its memo", async () => {
    const { makeDigiKeyClient } = await import("../digikey");
    const transport: typeof fetch = async (input, init) => {
      if (String(input).includes("/oauth2/")) return json({ access_token: "t", expires_in: 600 });
      const keywords = (JSON.parse(String(init?.body)) as { Keywords: string }).Keywords;
      return json({ Products: [{ ManufacturerProductNumber: keywords, QuantityAvailable: 3, StandardPricing: [] }] });
    };
    const client = makeDigiKeyClient({ clientId: "id", clientSecret: "secret", egress: { fetch: transport, resolve: PUBLIC } });
    expect(await client.lookupByMpn("RC0805FR-0710KL")).not.toBeNull();
    expect(await client.lookupByMpn("RC0805FR-0710KL")).toBeNull();
  }, 10_000);
});
