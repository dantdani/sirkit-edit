/**
 * [B19-B I3b] Request quotas, circuit breakers and in-flight coalescing at the connectors — a fake transport, no vendor.
 *
 * The registry (I3) records each source's documented quota and a breaker policy. Before I3b nothing enforced either: a
 * client would send the 121st DigiKey request of a minute, keep calling a vendor that answered 503 or 429 every time, and
 * two concurrent BOM builds pricing the same part each paid for their own vendor call.
 *
 * Every case loads the connector modules fresh, so the process-wide meters start empty.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PUBLIC = async (): Promise<string[]> => ["93.184.216.34"];
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

async function fresh() {
  vi.resetModules();
  const egress = await import("../egress");
  const digikey = await import("../digikey");
  const octopart = await import("../octopart");
  return { ...egress, ...digikey, ...octopart };
}

function recorder(answer: (url: string, init: RequestInit | undefined) => Response | Promise<Response>) {
  const calls: string[] = [];
  const transport: typeof fetch = async (input, init) => {
    calls.push(String(input));
    return answer(String(input), init);
  };
  return { calls, transport };
}

beforeEach(() => {
  vi.stubGlobal("fetch", () => { throw new Error("a connector bypassed the egress boundary"); });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("[B19-B I3b] a documented quota is never exceeded", () => {
  it("DigiKey: the 121st request within a minute is refused before it leaves the process", async () => {
    const { distributorJson } = await fresh();
    const { calls, transport } = recorder(() => json({ Products: [] }));
    const results = [];
    for (let i = 0; i < 121; i++) {
      results.push(await distributorJson("digikey", { url: "https://api.digikey.com/products/v4/search/keyword", method: "POST", body: "{}" }, { fetch: transport, resolve: PUBLIC }));
    }
    expect(calls).toHaveLength(120);
    expect(results[120]).toMatchObject({ ok: false });
    expect(results[120]!.ok ? "" : results[120]!.message).toMatch(/120 requests per minute/);
  });

  it("Nexar: matched parts count against the monthly quota — a batch that would pass 2000 is refused whole", async () => {
    const { makeOctopartClient } = await fresh();
    const { calls, transport } = recorder(() => json({ data: {} }));
    const client = makeOctopartClient({ apiKey: "nexar-test-token", egress: { fetch: transport, resolve: PUBLIC } });
    const batch = (prefix: string, size: number) => Array.from({ length: size }, (_, i) => `${prefix}-${i}`);
    await client.lookupBatch(batch("A", 1000));
    await client.lookupBatch(batch("B", 999));
    expect(calls).toHaveLength(2);
    await client.lookupBatch(batch("C", 2)); // 1999 + 2 > 2000
    expect(calls, "the third batch would exceed the month's matched parts").toHaveLength(2);
    await client.lookupBatch(batch("D", 1)); // exactly 2000
    expect(calls).toHaveLength(3);
  });
});

describe("[B19-B I3b] a failing vendor is not hammered", () => {
  it("after five consecutive 503s the breaker opens: the sixth request is not made", async () => {
    const { distributorJson } = await fresh();
    const { calls, transport } = recorder(() => json({}, 503));
    for (let i = 0; i < 6; i++) {
      await distributorJson("digikey", { url: "https://api.digikey.com/products/v4/search/keyword", method: "POST", body: "{}" }, { fetch: transport, resolve: PUBLIC });
    }
    expect(calls).toHaveLength(5);
  });

  it("a 429 opens the breaker at once: the next request is not made", async () => {
    const { distributorJson } = await fresh();
    const { calls, transport } = recorder(() => json({ ErrorMessage: "BurstLimit exceeded" }, 429));
    const first = await distributorJson("digikey", { url: "https://api.digikey.com/products/v4/search/keyword", method: "POST", body: "{}" }, { fetch: transport, resolve: PUBLIC });
    const second = await distributorJson("digikey", { url: "https://api.digikey.com/products/v4/search/keyword", method: "POST", body: "{}" }, { fetch: transport, resolve: PUBLIC });
    expect(first).toMatchObject({ ok: false, status: 429 });
    expect(calls).toHaveLength(1);
    expect(second.ok ? "" : second.message).toMatch(/paused/);
  });

  it("an answer that is not a failure (a 404) does not count toward opening the breaker", async () => {
    const { distributorJson } = await fresh();
    const { calls, transport } = recorder(() => json({}, 404));
    for (let i = 0; i < 8; i++) {
      await distributorJson("digikey", { url: "https://api.digikey.com/products/v4/search/keyword", method: "POST", body: "{}" }, { fetch: transport, resolve: PUBLIC });
    }
    expect(calls).toHaveLength(8);
  });
});

describe("[B19-B I3b] identical lookups in flight share one vendor call", () => {
  it("DigiKey: two concurrent lookups of the same MPN make one search", async () => {
    const { makeDigiKeyClient } = await fresh();
    const { calls, transport } = recorder((url) => (url.includes("/oauth2/token") ? json({ access_token: "tok", expires_in: 600 }) : json({ Products: [{ ManufacturerProductNumber: "NE555DR", QuantityAvailable: 3, StandardPricing: [] }] })));
    const client = makeDigiKeyClient({ clientId: "id", clientSecret: "secret", egress: { fetch: transport, resolve: PUBLIC } });
    const [a, b] = await Promise.all([client.lookupByMpn("NE555DR"), client.lookupByMpn("NE555DR")]);
    expect(a).toMatchObject({ mpn: "NE555DR" });
    expect(b).toMatchObject({ mpn: "NE555DR" });
    expect(calls.filter((url) => url.includes("/search/keyword"))).toHaveLength(1);
  }, 10_000);

  it("Nexar: two concurrent batches that overlap query each MPN once", async () => {
    const { makeOctopartClient } = await fresh();
    const queried: string[][] = [];
    const transport: typeof fetch = async (_input, init) => {
      const variables = (JSON.parse(String(init?.body)) as { variables: Record<string, string> }).variables;
      queried.push(Object.values(variables).sort());
      await new Promise((resolve) => setTimeout(resolve, 20));
      return json({ data: {} });
    };
    const client = makeOctopartClient({ apiKey: "nexar-test-token", egress: { fetch: transport, resolve: PUBLIC } });
    await Promise.all([client.lookupBatch(["A", "B"]), client.lookupBatch(["B", "C"])]);
    expect(queried.flat().sort()).toEqual(["A", "B", "C"]);
  });
});
