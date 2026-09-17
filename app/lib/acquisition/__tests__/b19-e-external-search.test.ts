/**
 * [B19-E E2] Bounded external candidate search, driven through the real DigiKey and Nexar connectors over FAKE vendor
 * servers (the DistributorEgress fetch/resolve/clock injection) — no network, no vendor, no real credential.
 *
 * A signed-in member searches the enabled sources by exact MPN or keyword and gets at most 5 candidates per source. Each hit
 * is a labelled sourcing observation with an `exactMatch` flag; nothing is persisted and nothing can be placed.
 *  a. only registry hosts are contacted; redirects and private addresses are refused; at most 5 are asked for; Nexar reserves
 *     cost = limit; a used-up quota or an open breaker pauses the source with retryAt and zero requests; no credential or
 *     secret query parameter is echoed.
 *  d. a hit is never relabelled as the requested MPN; unsafe links are dropped; vendor text is inert and bounded.
 *  e. the agent purpose is held to its share of the quota while a person's search still admits (OD-40).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeDigiKeyClient } from "../../distributors/digikey";
import { makeOctopartClient } from "../../distributors/octopart";
import { clearPricingCache, getCached, isKnownNoExactMatch } from "../../distributors/cache";
import type { DistributorEgress } from "../../distributors/egress";
import type { DistributorClient } from "../../distributors/types";
import { currentPause, previewAdmission, recordOutcome, requestAdmission, resetAdmissionControl } from "../admission-control";
import { clearExternalSearchMemo, searchExternalCandidates, type ExternalSearchOptions } from "../external-search";
import { EXTERNAL_OBSERVATION_AUTHORITY, type ExternalCandidateHit, type ExternalSearchResult } from "../external-search-contract";
import { SOURCE_REGISTRY, type AcquisitionSourceId } from "../source-registry";

const Z = (...codes: number[]): string => String.fromCharCode(...codes);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 8, 13, 12, 0, 0);
let now = T0;
const clock = (): number => now;
const PUBLIC = async (): Promise<string[]> => ["93.184.216.34"];

// Obvious fakes, assembled at runtime so no credential-shaped literal sits in the source.
const DIGIKEY_ID = ["fake", "digikey", "client", "id"].join("-");
const DIGIKEY_SECRET = ["FAKE", "DIGIKEY", "SECRET", "SENTINEL", "7781"].join("-");
const NEXAR_TOKEN = ["FAKE", "NEXAR", "TOKEN", "SENTINEL", "7782"].join("-");
const ENV = { DIGIKEY_CLIENT_ID: DIGIKEY_ID, DIGIKEY_CLIENT_SECRET: DIGIKEY_SECRET, OCTOPART_API_KEY: NEXAR_TOKEN };
/** [B19-E E2 review] the requester's trusted tenant and project: the memo is theirs alone */
const SCOPE = { tenantId: "tenant-a", projectId: "project-1" };

const json = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

function dk(mpn: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { ManufacturerProductNumber: mpn, Manufacturer: { Name: "Analog Devices" }, Description: { ProductDescription: "RS-232 transceiver" }, QuantityAvailable: 1200, MinimumOrderQuantity: 1, StandardPricing: [{ BreakQuantity: 1, UnitPrice: 2.5 }], ProductUrl: "https://www.digikey.com/en/products/detail/analog-devices/1", DatasheetUrl: "https://www.analog.com/media/max3232.pdf", ProductStatus: { Status: "Active" }, ...extra };
}

function nx(mpn: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { mpn, manufacturer: { name: "Analog Devices" }, shortDescription: "RS-232 transceiver", bestDatasheet: { url: "https://www.analog.com/media/max3232.pdf" }, totalAvail: 50, lifecycleStatus: "Production", sellers: [{ company: { name: "Seller" }, offers: [{ sku: "S-1", inventoryLevel: 50, clickUrl: "https://octopart.com/click/track?ct=offers", prices: [{ quantity: 1, price: 2.4, currency: "USD" }] }] }], ...extra };
}

type Call = { url: string; body: string };

function vendors(options: { digikeyProducts?: unknown[]; nexarParts?: unknown[]; transport?: typeof fetch; resolve?: (host: string) => Promise<string[]> } = {}) {
  const calls: Call[] = [];
  const answer: typeof fetch = options.transport ?? (async (input) => {
    const url = String(input);
    if (url.includes("/oauth2/token")) return json({ access_token: "fake-access", expires_in: 600 });
    if (url.includes("api.digikey.com")) return json({ Products: options.digikeyProducts ?? [] });
    return json({ data: { s0: { results: (options.nexarParts ?? []).map((part) => ({ part })) } } });
  });
  const transport: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), body: typeof init?.body === "string" ? init.body : String(init?.body ?? "") });
    return answer(input, init);
  };
  const egress: DistributorEgress = { fetch: transport, resolve: options.resolve ?? PUBLIC, clock };
  const clients = new Map<string, DistributorClient>();
  const connect = (id: AcquisitionSourceId, secrets: Readonly<Record<string, string>>): DistributorClient | null => {
    if (!clients.has(id)) {
      if (id === "digikey") clients.set(id, makeDigiKeyClient({ clientId: secrets.DIGIKEY_CLIENT_ID ?? "", clientSecret: secrets.DIGIKEY_CLIENT_SECRET ?? "", egress }));
      else if (id === "octopart") clients.set(id, makeOctopartClient({ apiKey: secrets.OCTOPART_API_KEY ?? "", egress }));
      else return null;
    }
    return clients.get(id)!;
  };
  const searchesOf = (host: string) => calls.filter((call) => new URL(call.url).hostname === host && !call.url.includes("/oauth2/token"));
  return { calls, egress, connect, searchesOf };
}

type Vendors = ReturnType<typeof vendors>;

async function search(v: Vendors, input: { query: unknown; mode: unknown; limit: unknown; sources?: unknown }, options: Partial<ExternalSearchOptions> = {}): Promise<ExternalSearchResult> {
  return searchExternalCandidates(input as never, { live: true, purpose: "interactive", env: ENV, clock, connect: v.connect, scope: SCOPE, ...options });
}

function ok(result: ExternalSearchResult) {
  if (!result.ok) throw new Error(`refused: ${result.code}`);
  return result;
}

const statusOf = (result: ExternalSearchResult, id: AcquisitionSourceId) => ok(result).sources.find((source) => source.sourceId === id)!;
const hitsOf = (result: ExternalSearchResult, id: AcquisitionSourceId): ExternalCandidateHit[] => ok(result).hits.filter((hit) => hit.sourceId === id);

beforeEach(() => {
  now = T0;
  vi.stubGlobal("fetch", () => { throw new Error("the external search bypassed the egress boundary"); });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearExternalSearchMemo();
  clearPricingCache();
  resetAdmissionControl();
});

describe("[B19-E E2] a — fake servers: only registered hosts, bounded requests, labelled hits", () => {
  it("an exact search reaches only each source's registered hosts, asks for at most 5, and labels every hit live with when it was observed and when it expires", async () => {
    const v = vendors({ digikeyProducts: [dk("MAX3232CSE"), dk("MAX3232CSE+")], nexarParts: [nx("MAX3232CSE")] });
    const result = ok(await search(v, { query: "MAX3232CSE", mode: "exact", limit: 5 }));
    expect(v.calls.length).toBeGreaterThan(0);
    const allowed = new Set([...SOURCE_REGISTRY.digikey.endpoints.hosts, ...SOURCE_REGISTRY.octopart.endpoints.hosts]);
    for (const call of v.calls) expect(allowed.has(new URL(call.url).hostname), call.url).toBe(true);

    const [digikeySearch] = v.searchesOf("api.digikey.com");
    expect(JSON.parse(digikeySearch!.body)).toEqual({ Keywords: "MAX3232CSE", Limit: 5 });
    const [nexarSearch] = v.searchesOf("api.nexar.com");
    const graphql = JSON.parse(nexarSearch!.body) as { query: string; variables: Record<string, unknown> };
    expect(graphql.query).toMatch(/supSearchMpn\(/);
    expect(graphql.variables).toEqual({ q: "MAX3232CSE", limit: 5 });

    expect(result.hits).toHaveLength(3);
    for (const hit of result.hits) {
      expect(hit.servedFrom, hit.mpn).toBe("live");
      expect(hit.observedAt).toBe(T0);
      expect(hit.expiresAt).toBe(T0 + (hit.sourceId === "digikey" ? HOUR : DAY));
      expect(hit.authority).toBe(EXTERNAL_OBSERVATION_AUTHORITY);
      expect(EXTERNAL_OBSERVATION_AUTHORITY).toBe(`sourcing observation ${Z(0x2014)} not engineering authority`);
      expect(hit.observationId).toMatch(/^observation_/);
      expect(hit.candidateId).toMatch(/^candidate_/);
    }
    expect(statusOf(result, "digikey")).toMatchObject({ status: "available", servedFrom: "live", hitCount: 2, retryAt: null });
    expect(statusOf(result, "octopart")).toMatchObject({ status: "available", servedFrom: "live", hitCount: 1 });
    expect(statusOf(result, "mouser")).toMatchObject({ status: "disabled", ownerDecision: "OD-32", servedFrom: null, hitCount: 0 });
    expect(statusOf(result, "lcsc")).toMatchObject({ status: "blocked", servedFrom: null, hitCount: 0 });
  }, 15_000);

  it("a connector never asks for more than 5, whatever it is handed; a keyword search uses Nexar's supSearch", async () => {
    const v = vendors({ digikeyProducts: [], nexarParts: [] });
    const digikey = v.connect("digikey", ENV)!;
    const nexar = v.connect("octopart", ENV)!;
    await digikey.searchCandidates!("555 timer", { mode: "keyword", limit: 50, purpose: "interactive" });
    await nexar.searchCandidates!("555 timer", { mode: "keyword", limit: 50, purpose: "interactive" });
    expect(JSON.parse(v.searchesOf("api.digikey.com")[0]!.body)).toEqual({ Keywords: "555 timer", Limit: 5 });
    const graphql = JSON.parse(v.searchesOf("api.nexar.com")[0]!.body) as { query: string; variables: Record<string, unknown> };
    expect(graphql.query).toMatch(/supSearch\(/);
    expect(graphql.query).not.toMatch(/supSearchMpn/);
    expect(graphql.variables).toEqual({ q: "555 timer", limit: 5 });
  }, 15_000);

  it("a redirect is refused: nothing is followed, the source reports failed, and no hit is shown", async () => {
    const v = vendors({
      transport: async (input) => {
        const url = String(input);
        if (url.includes("/oauth2/token")) return json({ access_token: "fake-access", expires_in: 600 });
        return new Response(null, { status: 302, headers: { location: "https://evil.example/collect" } });
      },
    });
    const result = ok(await search(v, { query: "NE555DR", mode: "exact", limit: 5 }));
    expect(v.calls.some((call) => call.url.includes("evil.example")), "the redirect target was never contacted").toBe(false);
    expect(v.searchesOf("api.digikey.com")).toHaveLength(1);
    expect(v.searchesOf("api.nexar.com")).toHaveLength(1);
    expect(statusOf(result, "digikey").status).toBe("failed");
    expect(statusOf(result, "octopart").status).toBe("failed");
    expect(result.hits).toEqual([]);
  }, 15_000);

  it("a vendor host that resolves to a private address is never contacted", async () => {
    const v = vendors({ resolve: async () => ["10.20.30.40"], digikeyProducts: [dk("NE555DR")], nexarParts: [nx("NE555DR")] });
    const result = ok(await search(v, { query: "NE555DR", mode: "exact", limit: 5 }));
    expect(v.calls, "refused before any byte left the process").toHaveLength(0);
    expect(statusOf(result, "digikey").status).toBe("failed");
    expect(statusOf(result, "octopart").status).toBe("failed");
  }, 15_000);

  it("Nexar reserves cost = limit matched parts: at 1997 of 2000 a limit-4 search is paused with zero requests and a limit-3 search goes", async () => {
    requestAdmission("octopart", 1997, now);
    const v = vendors({ nexarParts: [nx("NE555DR")] });
    const refused = ok(await search(v, { query: "NE555DR", mode: "exact", limit: 4, sources: ["octopart"] }));
    expect(statusOf(refused, "octopart")).toMatchObject({ status: "paused", retryAt: Date.UTC(2026, 9, 1), hitCount: 0 });
    expect(v.calls).toHaveLength(0);
    const allowed = ok(await search(v, { query: "NE555DR", mode: "exact", limit: 3, sources: ["octopart"] }));
    expect(statusOf(allowed, "octopart")).toMatchObject({ status: "available", servedFrom: "live", hitCount: 1 });
    expect(v.searchesOf("api.nexar.com")).toHaveLength(1);
    expect(currentPause("octopart", now), "exactly 3 more were reserved: the month is used up").toMatchObject({ reason: "quota_exhausted" });
  });

  it("a used-up quota pauses DigiKey with retryAt and zero requests (not even a token request)", async () => {
    expect(requestAdmission("digikey", 120, now)).toEqual({ allowed: true });
    const v = vendors({ digikeyProducts: [dk("NE555DR")] });
    const result = ok(await search(v, { query: "NE555DR", mode: "exact", limit: 5, sources: ["digikey"] }));
    expect(statusOf(result, "digikey")).toMatchObject({ status: "paused", retryAt: T0 + MINUTE, hitCount: 0, servedFrom: null });
    expect(v.calls).toHaveLength(0);
  });

  it("an open breaker pauses Nexar with retryAt and zero requests", async () => {
    recordOutcome("octopart", "rate_limited", now);
    const v = vendors({ nexarParts: [nx("NE555DR")] });
    const result = ok(await search(v, { query: "NE555DR", mode: "exact", limit: 5, sources: ["octopart"] }));
    expect(statusOf(result, "octopart")).toMatchObject({ status: "paused", retryAt: T0 + 10 * MINUTE, hitCount: 0 });
    expect(v.calls).toHaveLength(0);
  });

  it("no credential or secret query parameter is ever echoed: links carrying one are dropped, and a failure says nothing of what the transport said", async () => {
    const v = vendors({
      digikeyProducts: [dk("NE555DR", { ProductUrl: `https://www.digikey.com/en/products/detail/ne555?apiKey=${DIGIKEY_SECRET}`, DatasheetUrl: `https://www.ti.com/lit/ds/ne555.pdf?access_token=${NEXAR_TOKEN}` })],
      nexarParts: [nx("NE555DR", { sellers: [{ company: { name: "Seller" }, offers: [{ inventoryLevel: 5, clickUrl: `https://octopart.com/click/1?client_secret=${DIGIKEY_SECRET}`, prices: [] }] }] })],
    });
    const result = ok(await search(v, { query: "NE555DR", mode: "exact", limit: 5 }));
    expect(result.hits).toHaveLength(2);
    for (const hit of result.hits) {
      expect(hit.productUrl, hit.sourceId).toBeNull();
      expect(hit.datasheetUrl === null || !/token|secret|key/i.test(hit.datasheetUrl), hit.sourceId).toBe(true);
    }
    const text = JSON.stringify(result);
    for (const secret of [DIGIKEY_SECRET, NEXAR_TOKEN, DIGIKEY_ID]) expect(text).not.toContain(secret);

    const logged: string[] = [];
    vi.mocked(console.error).mockImplementation((...parts: unknown[]) => { logged.push(parts.map(String).join(" ")); });
    const leaky = vendors({ transport: async (input, init) => { throw new Error(`ECONNRESET ${String(input)} ${DIGIKEY_SECRET} ${NEXAR_TOKEN} ${String(init?.body)}`); } });
    clearExternalSearchMemo();
    const failed = ok(await search(leaky, { query: "LM358", mode: "exact", limit: 5 }));
    expect(statusOf(failed, "digikey").status).toBe("failed");
    expect(statusOf(failed, "octopart").status).toBe("failed");
    const failedText = JSON.stringify(failed);
    for (const leaked of [DIGIKEY_SECRET, NEXAR_TOKEN, DIGIKEY_ID, "ECONNRESET"]) expect(failedText).not.toContain(leaked);
    for (const line of logged) for (const secret of [DIGIKEY_SECRET, NEXAR_TOKEN]) expect(line).not.toContain(secret);
  }, 20_000);

  it("without live pricing a miss asks no vendor", async () => {
    const v = vendors({ digikeyProducts: [dk("NE555DR")], nexarParts: [nx("NE555DR")] });
    const result = ok(await search(v, { query: "NE555DR", mode: "exact", limit: 5 }, { live: false }));
    expect(v.calls).toHaveLength(0);
    expect(result.hits).toEqual([]);
    expect(statusOf(result, "digikey")).toMatchObject({ status: "available", servedFrom: null, hitCount: 0 });
  });
});

describe("[B19-E E2] the request is bounded before any vendor is asked", () => {
  it.each([
    ["a non-ASCII query", { query: `NE555${Z(0xe9)}` }, "EXTERNAL_SEARCH_QUERY_INVALID"],
    ["a zero-width character inside the query", { query: `NE${Z(0x200b)}555` }, "EXTERNAL_SEARCH_QUERY_INVALID"],
    ["a control character inside the query", { query: `NE555${Z(0x0a)}DR` }, "EXTERNAL_SEARCH_QUERY_INVALID"],
    ["a query of 65 characters", { query: "A".repeat(65) }, "EXTERNAL_SEARCH_QUERY_INVALID"],
    ["an empty query", { query: "    " }, "EXTERNAL_SEARCH_QUERY_INVALID"],
    ["a query that is not a string", { query: 555 }, "EXTERNAL_SEARCH_QUERY_INVALID"],
    ["limit 0", { limit: 0 }, "EXTERNAL_SEARCH_LIMIT_INVALID"],
    ["limit 6", { limit: 6 }, "EXTERNAL_SEARCH_LIMIT_INVALID"],
    ["a fractional limit", { limit: 2.5 }, "EXTERNAL_SEARCH_LIMIT_INVALID"],
    ["a string limit", { limit: "5" }, "EXTERNAL_SEARCH_LIMIT_INVALID"],
    ["an unknown mode", { mode: "fuzzy" }, "EXTERNAL_SEARCH_MODE_INVALID"],
    ["an unknown source", { sources: ["digikey", "farnell"] }, "EXTERNAL_SEARCH_SOURCES_INVALID"],
    ["sources that are not a list", { sources: "digikey" }, "EXTERNAL_SEARCH_SOURCES_INVALID"],
  ])("%s is refused with zero requests", async (_label, patch, code) => {
    const v = vendors({ digikeyProducts: [dk("NE555DR")], nexarParts: [nx("NE555DR")] });
    const result = await search(v, { query: "NE555DR", mode: "exact", limit: 5, ...patch });
    expect(result).toMatchObject({ ok: false, code });
    expect(v.calls).toHaveLength(0);
  });

  it("a query is trimmed: 64 characters inside surrounding spaces is accepted", async () => {
    const v = vendors({ digikeyProducts: [] });
    const result = await search(v, { query: `  ${"A".repeat(64)}  `, mode: "keyword", limit: 1, sources: ["digikey"] });
    expect(result).toMatchObject({ ok: true, query: "A".repeat(64) });
    expect(JSON.parse(v.searchesOf("api.digikey.com")[0]!.body)).toEqual({ Keywords: "A".repeat(64), Limit: 1 });
  }, 15_000);
});

describe("[B19-E E2] d — identity and vendor text", () => {
  it("a MAX3232CSE+ answer to MAX3232CSE is exactMatch:false and keeps its own MPN — it is never relabelled", async () => {
    const v = vendors({ digikeyProducts: [dk("MAX3232CSE+"), dk("max3232cse")], nexarParts: [nx("MAX3232CSE+")] });
    const result = ok(await search(v, { query: "MAX3232CSE", mode: "exact", limit: 5 }));
    expect(hitsOf(result, "digikey").map((hit) => [hit.mpn, hit.exactMatch])).toEqual([["MAX3232CSE+", false], ["max3232cse", true]]);
    expect(hitsOf(result, "octopart").map((hit) => [hit.mpn, hit.exactMatch])).toEqual([["MAX3232CSE+", false]]);
    for (const hit of result.hits.filter((item) => !item.exactMatch)) expect(hit.mpn).toBe("MAX3232CSE+");
  }, 15_000);

  it("a keyword search flags only a literal MPN match as exact", async () => {
    const v = vendors({ digikeyProducts: [dk("MAX3232CSE+"), dk("MAX3232")], nexarParts: [] });
    const result = ok(await search(v, { query: "MAX3232", mode: "keyword", limit: 5, sources: ["digikey"] }));
    expect(hitsOf(result, "digikey").map((hit) => [hit.mpn, hit.exactMatch])).toEqual([["MAX3232CSE+", false], ["MAX3232", true]]);
  }, 15_000);

  it("javascript:, data:, plain-http and off-vendor links are dropped; a safe vendor https link survives", async () => {
    const v = vendors({
      digikeyProducts: [
        dk("NE555DR", { ProductUrl: "javascript:alert(document.cookie)", DatasheetUrl: "data:text/html;base64,PHNjcmlwdD4=" }),
        dk("NE555P", { ProductUrl: "https://evil.example/ne555", DatasheetUrl: "http://www.ti.com/lit/ds/ne555.pdf" }),
        dk("NE555DRG4", { ProductUrl: "https://www.digikey.com/en/products/detail/texas-instruments/NE555DRG4/1", DatasheetUrl: "https://www.ti.com/lit/ds/symlink/ne555.pdf" }),
      ],
    });
    const result = ok(await search(v, { query: "NE555", mode: "keyword", limit: 5, sources: ["digikey"] }));
    const byMpn = new Map(result.hits.map((hit) => [hit.mpn, hit]));
    expect(byMpn.get("NE555DR")).toMatchObject({ productUrl: null, datasheetUrl: null });
    expect(byMpn.get("NE555P")).toMatchObject({ productUrl: null, datasheetUrl: null });
    expect(byMpn.get("NE555DRG4")).toMatchObject({ productUrl: "https://www.digikey.com/en/products/detail/texas-instruments/NE555DRG4/1", datasheetUrl: "https://www.ti.com/lit/ds/symlink/ne555.pdf" });
  }, 15_000);

  it("bidi and zero-width characters are stripped, text is bounded, and a confusable or over-long MPN is withheld rather than shown", async () => {
    const RLO = Z(0x202e), ZWSP = Z(0x200b), LRI = Z(0x2066), ZWJ = Z(0x200d);
    const v = vendors({
      digikeyProducts: [
        dk("NE555DR", { Manufacturer: { Name: `Texas${RLO} Instru${ZWSP}ments` }, Description: { ProductDescription: `${LRI}Timer ${"x".repeat(5000)}` }, Packaging: `Tape${ZWJ} & Reel` }),
        dk(`NE555${ZWJ}DR`),
        dk("N".repeat(65)),
      ],
    });
    const result = ok(await search(v, { query: "NE555DR", mode: "exact", limit: 5, sources: ["digikey"] }));
    expect(result.hits).toHaveLength(1);
    const [hit] = result.hits;
    for (const text of [hit!.manufacturer, hit!.description, hit!.packaging]) {
      expect(text).not.toBeNull();
      expect(/[\p{Cf}\p{Cc}]/u.test(text!), JSON.stringify(text)).toBe(false);
    }
    expect(hit!.manufacturer).toBe("Texas Instru ments");
    expect(Array.from(hit!.description!).length).toBeLessThanOrEqual(200);
    expect(statusOf(result, "digikey")).toMatchObject({ hitCount: 1, withheldHits: 2 });
    expect(JSON.stringify(result)).not.toContain(ZWJ);
  }, 15_000);
});

describe("[B19-E E2] e — the agent purpose is held to its share of the quota (OD-40)", () => {
  it("an agent search is paused at its share with zero requests while a person's search still reaches the vendor", async () => {
    expect(requestAdmission("digikey", 30, now, "agent")).toEqual({ allowed: true });
    const v = vendors({ digikeyProducts: [dk("NE555DR")] });
    const agent = ok(await search(v, { query: "NE555DR", mode: "exact", limit: 5, sources: ["digikey"] }, { purpose: "agent" }));
    expect(statusOf(agent, "digikey")).toMatchObject({ status: "paused", retryAt: T0 + MINUTE });
    expect(v.calls).toHaveLength(0);
    const person = ok(await search(v, { query: "NE555DR", mode: "exact", limit: 5, sources: ["digikey"] }, { purpose: "interactive" }));
    expect(statusOf(person, "digikey")).toMatchObject({ status: "available", servedFrom: "live", hitCount: 1 });
    expect(v.searchesOf("api.digikey.com")).toHaveLength(1);
  }, 15_000);

  it("the agent gets exact MPNs only: an agent keyword search is refused before any request", async () => {
    const v = vendors({ digikeyProducts: [dk("NE555DR")] });
    const result = await search(v, { query: "555 timer", mode: "keyword", limit: 5 }, { purpose: "agent" });
    expect(result).toMatchObject({ ok: false, code: "EXTERNAL_SEARCH_MODE_NOT_PERMITTED" });
    expect(v.calls).toHaveLength(0);
  });
});

describe("[B19-E E2 review] the memo belongs to the requesting tenant and project", () => {
  it("another tenant's identical search (even a limit-1 probe) is asked live and never learns that someone searched it, or when; another project's too", async () => {
    const v = vendors({ digikeyProducts: [dk("MAX3232CSE")], nexarParts: [nx("MAX3232CSE")] });
    const input = { query: "acme-secret-proto 48V BLDC driver", mode: "keyword", limit: 5 };
    const owner = { tenantId: "tenant-b", projectId: "p-1" };
    const first = ok(await search(v, input, { scope: owner }));
    expect(first.hits.map((hit) => hit.servedFrom)).toEqual(["live", "live"]);

    now = T0 + 5 * MINUTE;
    const probe = ok(await search(v, { ...input, limit: 1 }, { scope: { tenantId: "tenant-a", projectId: "p-9" } }));
    expect(probe.sources.filter((source) => source.servedFrom === "process-memo"), "no source says it answered from memory").toEqual([]);
    for (const hit of probe.hits) expect(hit, hit.sourceId).toMatchObject({ servedFrom: "live", observedAt: T0 + 5 * MINUTE });
    expect(v.searchesOf("api.digikey.com")).toHaveLength(2);
    expect(v.searchesOf("api.nexar.com")).toHaveLength(2);

    now = T0 + 6 * MINUTE;
    const sibling = ok(await search(v, input, { scope: { tenantId: "tenant-b", projectId: "p-2" } }));
    for (const hit of sibling.hits) expect(hit, "another project of the same tenant").toMatchObject({ servedFrom: "live", observedAt: T0 + 6 * MINUTE });

    now = T0 + 7 * MINUTE;
    const again = ok(await search(v, input, { scope: owner }));
    for (const hit of again.hits) expect(hit, "the owner's own memo still answers").toMatchObject({ servedFrom: "process-memo", observedAt: T0 });
    expect(v.searchesOf("api.digikey.com")).toHaveLength(3);
    expect(v.searchesOf("api.nexar.com")).toHaveLength(3);
  }, 20_000);

  it("a search without a trusted scope is never memoized nor answered from memory", async () => {
    const v = vendors({ nexarParts: [nx("NE555DR")] });
    const input = { query: "NE555DR", mode: "exact", limit: 5, sources: ["octopart"] };
    ok(await search(v, input, { scope: undefined }));
    ok(await search(v, input, { scope: { tenantId: "", projectId: "" } }));
    const third = ok(await search(v, input, { scope: undefined }));
    expect(v.searchesOf("api.nexar.com")).toHaveLength(3);
    expect(third.hits.map((hit) => hit.servedFrom)).toEqual(["live"]);
  });
});

describe("[B19-E E2 review] a Nexar error answer is a failure, never an empty result", () => {
  it.each([
    ["errors with no data", { errors: [{ message: "part limit exceeded" }], data: null }],
    ["errors with a null field", { errors: [{ message: "part limit exceeded" }], data: { s0: null } }],
    ["no data at all", {}],
  ])("%s: the source reports failed, nothing is memoized and the breaker counts a failure", async (_label, body) => {
    const v = vendors({ transport: async () => json(body) });
    const input = { query: "NE555DR", mode: "exact", limit: 5, sources: ["octopart"] };
    const first = ok(await search(v, input));
    expect(statusOf(first, "octopart")).toMatchObject({ status: "failed", servedFrom: null, hitCount: 0 });
    for (let attempt = 1; attempt < 5; attempt += 1) {
      now = T0 + attempt * MINUTE;
      const again = ok(await search(v, input));
      expect(statusOf(again, "octopart"), `attempt ${attempt + 1}`).toMatchObject({ status: "failed", servedFrom: null });
    }
    expect(v.searchesOf("api.nexar.com"), "asked every time: nothing was kept").toHaveLength(5);
    expect(currentPause("octopart", now), "five error answers in a row open the breaker").toMatchObject({ reason: "breaker_open" });
  });

  // [B19-E E2 follow-up] a field-level error beside usable results is a partial answer: its parts are shown, and it is no failure
  it("errors alongside results show the results, and five such answers never open the shared Nexar breaker", async () => {
    const body = { data: { s0: { results: [{ part: nx("NE555DR") }] } }, errors: [{ message: "field unavailable", path: ["s0", "results", 0, "part", "bestDatasheet"] }] };
    const v = vendors({ transport: async () => json(body) });
    const input = { query: "NE555DR", mode: "exact", limit: 5, sources: ["octopart"] };
    const first = ok(await search(v, input));
    expect(statusOf(first, "octopart")).toMatchObject({ status: "available", servedFrom: "live", hitCount: 1 });
    for (let attempt = 1; attempt < 5; attempt += 1) {
      now = T0 + attempt * MINUTE;
      clearExternalSearchMemo();
      expect(statusOf(ok(await search(v, input)), "octopart"), `attempt ${attempt + 1}`).toMatchObject({ status: "available", hitCount: 1 });
    }
    expect(currentPause("octopart", now), "a partial answer is not a failure for the breaker BOM pricing shares").toBeNull();
  });

  it("a real empty answer is still available with nothing found (results empty or null)", async () => {
    for (const results of [[], null]) {
      const v = vendors({ transport: async () => json({ data: { s0: { results } } }) });
      const result = ok(await search(v, { query: "NE555DR", mode: "exact", limit: 5, sources: ["octopart"] }));
      expect(statusOf(result, "octopart"), JSON.stringify(results)).toMatchObject({ status: "available", servedFrom: "live", hitCount: 0 });
      clearExternalSearchMemo();
    }
  });
});

describe("[B19-E E2 review] vendor links and attribution", () => {
  // [B19-E E2 follow-up; reviewed pin move] `sig` is Octopart's click-tracking tamper check ONLY on an octopart.com page link.
  // Anywhere else it can be a credential (an Azure SAS `sig` on a blob datasheet link), so the DigiKey `?sig=` case now drops.
  it("an Octopart click-tracking page link keeps its sig; a sig on any other page or document link, or a credential-named parameter, drops the link", async () => {
    const click = "https://octopart.com/click/track?ai8=Zx81&ct=offers&sid=459&sig=0b1c2d3&vpid=12345";
    const sas = "https://vendorfiles.blob.core.windows.net/ds/ne555.pdf?sv=2022-11-02&se=2026-09-20&sr=b&sp=r&sig=AbCdEf0123";
    const v = vendors({
      nexarParts: [nx("NE555DR", { bestDatasheet: { url: sas }, sellers: [{ company: { name: "Seller" }, offers: [{ inventoryLevel: 5, clickUrl: click, prices: [] }] }] })],
      digikeyProducts: [dk("NE555DR", { ProductUrl: "https://www.digikey.com/en/products/detail/ne555/1?sig=77aa", DatasheetUrl: sas }), dk("NE555P", { ProductUrl: "https://www.digikey.com/en/products/detail/ne555p/1?signature=77aa" })],
    });
    const result = ok(await search(v, { query: "NE555DR", mode: "exact", limit: 5 }));
    const [nexar] = hitsOf(result, "octopart");
    expect(nexar!.productUrl).toBe(click);
    expect(nexar!.datasheetUrl, "a SAS-signed datasheet link is a credential").toBeNull();
    expect(hitsOf(result, "digikey").map((hit) => [hit.mpn, hit.productUrl])).toEqual([["NE555DR", null], ["NE555P", null]]);
    expect(hitsOf(result, "digikey")[0]!.datasheetUrl).toBeNull();
    expect(JSON.stringify(result)).not.toContain("AbCdEf0123");
  }, 15_000);

  it("every hit and source carries the registry's attribution; a Nexar hit with no product link still carries the octopart.com link its terms require", async () => {
    const v = vendors({ nexarParts: [nx("NE555DR", { sellers: [{ company: { name: "Seller" }, offers: [{ clickUrl: "https://octopart.com/click/track?ct=offers", prices: [{ quantity: 1, price: 0.4, currency: "USD" }] }] }] })], digikeyProducts: [dk("NE555DR")] });
    const result = ok(await search(v, { query: "NE555DR", mode: "exact", limit: 5 }));
    const [nexar] = hitsOf(result, "octopart");
    expect(nexar).toMatchObject({ productUrl: null, attribution: SOURCE_REGISTRY.octopart.license.attribution, attributionLink: "https://octopart.com/" });
    expect(hitsOf(result, "digikey")[0]).toMatchObject({ attribution: SOURCE_REGISTRY.digikey.license.attribution, attributionLink: null });
    expect(statusOf(result, "octopart")).toMatchObject({ attribution: SOURCE_REGISTRY.octopart.license.attribution, attributionLink: "https://octopart.com/" });
  }, 15_000);
});

describe("[B19-E E2 review] a pause that arrives after the preview still reaches the answer", () => {
  it("the connectors themselves answer paused with when to retry", async () => {
    const v = vendors({ digikeyProducts: [dk("NE555DR")], nexarParts: [nx("NE555DR")] });
    requestAdmission("digikey", 120, now);
    requestAdmission("octopart", 2000, now);
    const options = { mode: "exact" as const, limit: 5, purpose: "interactive" as const };
    expect(await v.connect("digikey", ENV)!.searchCandidates!("NE555DR", options)).toEqual({ ok: false, message: "paused", paused: "quota_exhausted", retryAtMs: T0 + MINUTE });
    expect(await v.connect("octopart", ENV)!.searchCandidates!("NE555DR", options)).toEqual({ ok: false, message: "paused", paused: "quota_exhausted", retryAtMs: Date.UTC(2026, 9, 1) });
    expect(v.searchesOf("api.digikey.com")).toHaveLength(0);
    expect(v.searchesOf("api.nexar.com")).toHaveLength(0);
  });

  it.each([
    ["DigiKey quota used up", "digikey", () => requestAdmission("digikey", 120, now), T0 + MINUTE, false],
    ["DigiKey breaker opened (the token request is refused too)", "digikey", () => recordOutcome("digikey", "rate_limited", now), T0 + 10 * MINUTE, true],
    ["Nexar quota used up", "octopart", () => requestAdmission("octopart", 2000, now), Date.UTC(2026, 9, 1), true],
  ] as const)("%s between the preview and the send: paused with retryAt, and no search request", async (_label, id, race, retryAt, noRequestAtAll) => {
    const v = vendors({ digikeyProducts: [dk("NE555DR")], nexarParts: [nx("NE555DR")] });
    const racing = (sourceId: AcquisitionSourceId, secrets: Readonly<Record<string, string>>) => { race(); return v.connect(sourceId, secrets); };
    const result = ok(await search(v, { query: "NE555DR", mode: "exact", limit: 5, sources: [id] }, { connect: racing }));
    expect(statusOf(result, id)).toMatchObject({ status: "paused", retryAt, hitCount: 0, servedFrom: null });
    expect(v.searchesOf(id === "digikey" ? "api.digikey.com" : "api.nexar.com")).toHaveLength(0);
    if (noRequestAtAll) expect(v.calls, "not even a token request").toHaveLength(0);
  }, 15_000);
});

describe("[B19-E E2 review] an admitted agent search is metered against the agent's share (OD-40)", () => {
  it("DigiKey: one agent search reserves one agent unit of the minute's 30", async () => {
    const v = vendors({ digikeyProducts: [dk("NE555DR")] });
    const agent = ok(await search(v, { query: "NE555DR", mode: "exact", limit: 5, sources: ["digikey"] }, { purpose: "agent" }));
    expect(statusOf(agent, "digikey")).toMatchObject({ status: "available", servedFrom: "live", hitCount: 1 });
    expect(previewAdmission("digikey", 29, now, "agent")).toBeNull();
    expect(previewAdmission("digikey", 30, now, "agent"), "the search was reserved as the agent's").toMatchObject({ reason: "quota_exhausted", retryAtMs: T0 + MINUTE });
    expect(previewAdmission("digikey", 119, now, "interactive")).toBeNull();
  }, 15_000);

  it("Nexar: 100 agent searches at limit 5 spend the agent's 500 matched parts; the 101st is paused with zero requests while a person's search still goes", async () => {
    const v = vendors({ nexarParts: [nx("NE555DR")] });
    for (let index = 0; index < 100; index += 1) {
      const answer = ok(await search(v, { query: `NE555DR-${index}`, mode: "exact", limit: 5, sources: ["octopart"] }, { purpose: "agent" }));
      expect(statusOf(answer, "octopart").status, `search ${index + 1}`).toBe("available");
    }
    expect(v.searchesOf("api.nexar.com")).toHaveLength(100);
    const paused = ok(await search(v, { query: "NE555DR-X", mode: "exact", limit: 5, sources: ["octopart"] }, { purpose: "agent" }));
    expect(statusOf(paused, "octopart")).toMatchObject({ status: "paused", retryAt: Date.UTC(2026, 9, 1) });
    expect(v.searchesOf("api.nexar.com")).toHaveLength(100);
    const person = ok(await search(v, { query: "NE555DR-X", mode: "exact", limit: 5, sources: ["octopart"] }, { purpose: "interactive" }));
    expect(statusOf(person, "octopart")).toMatchObject({ status: "available", servedFrom: "live" });
    expect(v.searchesOf("api.nexar.com")).toHaveLength(101);
  }, 20_000);
});

describe("[B19-E E2 review] a search never feeds the pricing memo", () => {
  it("after exact searches with and without an exact hit, and a keyword search, neither source has a remembered miss or a cached price", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0); // the pricing memo reads the wall clock: align it with the vendors' clock so a write would be kept
    try {
      const v = vendors({ digikeyProducts: [dk("MAX3232CSE+"), dk("NE555DR")], nexarParts: [nx("MAX3232CSE+"), nx("NE555DR")] });
      ok(await search(v, { query: "MAX3232CSE", mode: "exact", limit: 5 }));
      ok(await search(v, { query: "NE555DR", mode: "exact", limit: 5 }));
      ok(await search(v, { query: "NE555", mode: "keyword", limit: 5 }));
      expect(v.searchesOf("api.digikey.com")).toHaveLength(3);
      expect(v.searchesOf("api.nexar.com")).toHaveLength(3);
      for (const distributor of ["digikey", "octopart-aggregated"] as const) {
        for (const mpn of ["MAX3232CSE", "MAX3232CSE+", "NE555DR", "NE555"]) {
          expect(isKnownNoExactMatch(distributor, mpn), `${distributor} remembered a miss for ${mpn}`).toBe(false);
          expect(getCached(distributor, mpn), `${distributor} cached ${mpn}`).toBeNull();
        }
      }
    } finally {
      vi.useRealTimers();
    }
  }, 20_000);
});

describe("[B19-E E2 review] the memo key separates the modes", () => {
  it("a keyword memo never answers an exact search for the same text, nor an exact memo a keyword search", async () => {
    const v = vendors({ digikeyProducts: [dk("NE555DR")], nexarParts: [nx("NE555DR")] });
    ok(await search(v, { query: "NE555DR", mode: "keyword", limit: 5 }));
    now = T0 + MINUTE;
    const exact = ok(await search(v, { query: "NE555DR", mode: "exact", limit: 5 }));
    now = T0 + 2 * MINUTE;
    const keyword = ok(await search(v, { query: "NE555DR", mode: "keyword", limit: 5 }));
    const nexar = v.searchesOf("api.nexar.com").map((call) => (JSON.parse(call.body) as { query: string }).query);
    expect(nexar).toHaveLength(2);
    expect(nexar[0]).toMatch(/supSearch\(/);
    expect(nexar[1]).toMatch(/supSearchMpn\(/);
    expect(v.searchesOf("api.digikey.com")).toHaveLength(2);
    for (const hit of exact.hits) expect(hit, hit.sourceId).toMatchObject({ servedFrom: "live", observedAt: T0 + MINUTE });
    for (const hit of keyword.hits) expect(hit, `${hit.sourceId}: the keyword memo answers its own mode`).toMatchObject({ servedFrom: "process-memo", observedAt: T0 });
  }, 20_000);
});
