/**
 * [B19-B I1] The three distributor clients, driven through a fake transport — no network, no vendor, no credential.
 *
 * Reproduced against the clients as they were before B19, each of these held: a hung socket held the lookup open forever
 * (no timeout, no signal); any response was buffered whole; a redirect was followed with the credentials attached; and the
 * raw error object — which can carry the request URL, and for Mouser the URL carries the API key — was logged.
 *
 * Mouser's key in the URL is NOT treated as a defect to "fix" by moving it: Mouser's documented Search API authenticates
 * with an `apiKey` query parameter. It is a vendor constraint, so it is CONTAINED: never logged, never in an error, and
 * never carried across a redirect.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeDigiKeyClient } from "../digikey";
import { makeMouserClient } from "../mouser";
import { makeOctopartClient } from "../octopart";
import { clearPricingCache } from "../cache";
import { resetAdmissionControl } from "../../acquisition/admission-control";

const PUBLIC = async (): Promise<string[]> => ["93.184.216.34"];
const MOUSER_KEY = "MOUSER-KEY-DO-NOT-LEAK-0123456789";
const DIGIKEY_SECRET = "DIGIKEY-SECRET-DO-NOT-LEAK-0123";
const NEXAR_KEY = "NEXAR-KEY-DO-NOT-LEAK-0123456789";
const jsonResponse = (value: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" }, ...init });

// Measured while writing this file: run against the clients as they were, the `egress` seam did not exist, so they used
// the REAL global fetch and several cases "passed" only because a real vendor call with dummy credentials failed fast.
// So the real transport is now poisoned for every case: a client that ever bypasses the boundary fails the test loudly
// instead of reaching the internet.
beforeEach(() => {
  vi.stubGlobal("fetch", () => { throw new Error("a distributor client bypassed the egress boundary and called the global fetch"); });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  clearPricingCache();
  resetAdmissionControl(); // [B19-B I3b] each case starts with empty quota meters and closed breakers
});

/** A transport that records every request and answers from a script. */
function recorder(answer: (url: string, init: RequestInit | undefined) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const transport: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return answer(String(input), init);
  };
  return { calls, transport };
}

const DIGIKEY_TOKEN = { access_token: "tok-abc", expires_in: 600 };
const DIGIKEY_PRODUCT = { Products: [{ ManufacturerProductNumber: "NE555DR", Manufacturer: { Name: "TI" }, QuantityAvailable: 10, StandardPricing: [{ BreakQuantity: 1, UnitPrice: 0.5 }] }] };

describe("[B19-B I1] a hung vendor never holds a lookup open", () => {
  it("DigiKey, Mouser and Nexar each settle at their deadline when the socket never answers", async () => {
    const hang: typeof fetch = (_input, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const egress = { fetch: hang, resolve: PUBLIC, deadlineMs: 60 };
    const started = Date.now();
    const results = await Promise.all([
      makeDigiKeyClient({ clientId: "id", clientSecret: DIGIKEY_SECRET, egress }).lookupByMpn("NE555DR"),
      makeMouserClient({ apiKey: MOUSER_KEY, egress }).lookupByMpn("NE555DR"),
      makeOctopartClient({ apiKey: NEXAR_KEY, egress }).lookupByMpn("NE555DR"),
    ]);
    expect(results, "a timeout is a missing price, never a crash").toEqual([null, null, null]);
    expect(Date.now() - started).toBeLessThan(4_000);
  }, 8_000);
});

describe("[B19-B I1] each client reaches only its own vendor, and only over the boundary", () => {
  it("DigiKey: the token and the search go to api.digikey.com, and nothing is followed implicitly", async () => {
    const { calls, transport } = recorder((url) => (url.includes("/oauth2/token") ? jsonResponse(DIGIKEY_TOKEN) : jsonResponse(DIGIKEY_PRODUCT)));
    const pricing = await makeDigiKeyClient({ clientId: "id", clientSecret: DIGIKEY_SECRET, egress: { fetch: transport, resolve: PUBLIC } }).lookupByMpn("NE555DR");
    expect(pricing).toMatchObject({ distributor: "digikey", mpn: "NE555DR", inStock: 10 });
    expect(calls.map((call) => new URL(call.url).hostname)).toEqual(["api.digikey.com", "api.digikey.com"]);
    for (const call of calls) expect(call.init?.redirect).toBe("manual");
  });

  it("Mouser: the documented apiKey query parameter reaches api.mouser.com — and a redirect is refused rather than carrying it anywhere", async () => {
    const seen = recorder(() => jsonResponse({ SearchResults: { Parts: [{ ManufacturerPartNumber: "NE555DR", Availability: "10 In Stock", PriceBreaks: [] }] } }));
    await makeMouserClient({ apiKey: MOUSER_KEY, egress: { fetch: seen.transport, resolve: PUBLIC } }).lookupByMpn("NE555DR");
    expect(new URL(seen.calls[0]!.url).hostname).toBe("api.mouser.com");
    expect(new URL(seen.calls[0]!.url).searchParams.get("apiKey"), "Mouser authenticates this way by design").toBe(MOUSER_KEY);

    const redirected = recorder((url) => (url.includes("api.mouser.com/api") ? new Response(null, { status: 302, headers: { location: "https://api.mouser.com/elsewhere" } }) : jsonResponse({})));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await makeMouserClient({ apiKey: MOUSER_KEY, egress: { fetch: redirected.transport, resolve: PUBLIC } }).lookupByMpn("NE555DR")).toBeNull();
    expect(redirected.calls, "the redirect was never followed, so the key went nowhere else").toHaveLength(1);
  });

  it("Nexar: one bounded GraphQL POST to api.nexar.com with the key in the Authorization header", async () => {
    const { calls, transport } = recorder(() => jsonResponse({ data: { s0: { results: [] } } }));
    await makeOctopartClient({ apiKey: NEXAR_KEY, egress: { fetch: transport, resolve: PUBLIC } }).lookupByMpn("NE555DR");
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0]!.url).hostname).toBe("api.nexar.com");
    expect((calls[0]!.init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${NEXAR_KEY}`);
    expect(calls[0]!.url, "the Nexar key never rides in the URL").not.toContain(NEXAR_KEY);
  });

  it("a vendor answer that resolves to a private address is never reached", async () => {
    const { calls, transport } = recorder(() => jsonResponse(DIGIKEY_TOKEN));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await makeDigiKeyClient({ clientId: "id", clientSecret: DIGIKEY_SECRET, egress: { fetch: transport, resolve: async () => ["169.254.169.254"] } }).lookupByMpn("NE555DR")).toBeNull();
    expect(calls, "refused before any byte left the process").toHaveLength(0);
  });
});

describe("[B19-B I1] how much a vendor may send, and what an error may say", () => {
  it("an oversized vendor response is refused rather than buffered", async () => {
    const { transport } = recorder((url) => (url.includes("/oauth2/token") ? jsonResponse(DIGIKEY_TOKEN) : jsonResponse({ Products: [{ padding: "x".repeat(3_000_000) }] })));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await makeDigiKeyClient({ clientId: "id", clientSecret: DIGIKEY_SECRET, egress: { fetch: transport, resolve: PUBLIC } }).lookupByMpn("NE555DR")).toBeNull();
  });

  it("nothing any client logs or throws contains a credential — whatever the transport's own error says", async () => {
    const logged: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => { logged.push(parts.map((part) => (part instanceof Error ? `${part.message} ${String(part.stack)}` : typeof part === "string" ? part : JSON.stringify(part))).join(" ")); });
    const leaky: typeof fetch = async (input) => { throw new Error(`connect ECONNREFUSED ${String(input)} key=${MOUSER_KEY} secret=${DIGIKEY_SECRET} ${NEXAR_KEY}`); };
    const egress = { fetch: leaky, resolve: PUBLIC };
    await makeDigiKeyClient({ clientId: "id", clientSecret: DIGIKEY_SECRET, egress }).lookupByMpn("NE555DR");
    await makeMouserClient({ apiKey: MOUSER_KEY, egress }).lookupByMpn("NE555DR");
    await makeOctopartClient({ apiKey: NEXAR_KEY, egress }).lookupByMpn("NE555DR");
    expect(logged.length, "failures are still reported").toBeGreaterThan(0);
    for (const line of logged) {
      for (const secret of [MOUSER_KEY, DIGIKEY_SECRET, NEXAR_KEY]) expect(line, line).not.toContain(secret);
    }
  });

  it("a vendor's own error body is never repeated back", async () => {
    const logged: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => { logged.push(parts.map(String).join(" ")); });
    const { transport } = recorder(() => new Response("upstream says: internal host db-7.corp password=hunter2", { status: 500, headers: { "content-type": "text/plain" } }));
    await makeMouserClient({ apiKey: MOUSER_KEY, egress: { fetch: transport, resolve: PUBLIC } }).lookupByMpn("NE555DR");
    for (const line of logged) expect(line).not.toContain("hunter2");
  });
});
