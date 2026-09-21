/**
 * [B20 A3] The in-process token cache and the state around it (OD-63): process memory only, keyed unambiguously by
 * (server id, canonical URI, pinned issuer, requested scope set), the secret never stored, a lifetime of min(expires_in,
 * 3 600 s) less 30 s judged against a guarded clock, one shared acquisition per key made with the first caller's context,
 * four token requests per server per UTC minute, a 60 s backoff, a ring of dropped tokens kept for redaction only, and a
 * provider that never hands a client-credentials token to anyone but `mcpPostAuthorized`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAdmissionControl } from "../../acquisition/admission-control";
import {
  MCP_AUTHORIZATION_BACKOFF_MS, MCP_STATE_PROBE_MIN_CHARS, MCP_TOKEN_CACHE_MAX, mcpAuthorizationStateCarries, mcpAuthorizationStateCounts, mcpAuthorizationTokenProvider, mcpPostAuthorized, resetMcpAuthorization,
} from "../authorization";
import { mcpInFlight, noneTokenProvider, preIssuedTokenEnvProvider, resetMcpInFlight } from "../http-transport";
import type { McpServerRegistryEntry } from "../server-registry";
import { fixtureServer, T0 } from "./_fixtures";
import { rpcResult, TOKEN_ENV, TOKENS, tokenServer } from "./_fake-mcp-server";
import {
  asDocument, authWorld, ccRow, ccServer, ccServerB64, CLIENT_SECRET, CLIENT_SECRET_ENV, ENV, jsonAnswer, listRequest, plainAnswer, prmDocument, tokenDocument, type AuthHandler, type AuthWorld,
} from "./_fake-authorization-server";

const send = (world: AuthWorld, server: McpServerRegistryEntry = ccServer, extra: Record<string, unknown> = {}) => mcpPostAuthorized(server, listRequest(), { purpose: "interactive", deps: world.deps(), ...extra });
const withCeiling = (scopes: string[], base: McpServerRegistryEntry = ccServer): McpServerRegistryEntry => ({ ...base, auth: { ...base.auth, scopes } });
const lifetime = (seconds: number | undefined): AuthHandler => (_call, world) => jsonAnswer(tokenDocument(world.issue(), { expires_in: seconds }));
const bearerOf = (world: AuthWorld): string[] => world.of("mcp").map((call) => call.headers.Authorization ?? "");

beforeEach(() => {
  resetAdmissionControl();
  resetMcpInFlight();
  resetMcpAuthorization();
  vi.stubGlobal("fetch", () => { throw new Error("the authorization client bypassed the egress boundary and called the global fetch"); });
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetAdmissionControl();
  resetMcpInFlight();
  resetMcpAuthorization();
});

describe("[B20 A3] lifetime and expiry", () => {
  it("expires_in 3 600 is used until T0 + 3 569 999 ms and re-fetched at T0 + 3 570 000 ms (a 30 s skew)", async () => {
    const world = authWorld();
    await send(world);
    world.now = T0 + 3_569_999;
    await send(world);
    expect(world.of("token")).toHaveLength(1);
    world.now = T0 + 3_570_000;
    await send(world);
    expect(world.of("token")).toHaveLength(2);
    expect(bearerOf(world)).toEqual([`Bearer ${world.issued[0]}`, `Bearer ${world.issued[0]}`, `Bearer ${world.issued[1]}`]);
  });

  it("an absent expires_in is 300 s; expires_in 7 200 is clamped to 3 600 s; expires_in 30 is used once and never cached", async () => {
    const defaulted = authWorld({ token: lifetime(undefined) });
    await send(defaulted);
    defaulted.now = T0 + 269_999;
    await send(defaulted);
    defaulted.now = T0 + 270_000;
    await send(defaulted);
    expect(defaulted.of("token")).toHaveLength(2);
    resetMcpAuthorization();
    const clamped = authWorld({ token: lifetime(7_200) });
    await send(clamped);
    clamped.now = T0 + 3_570_000;
    await send(clamped);
    expect(clamped.of("token")).toHaveLength(2);
    resetMcpAuthorization();
    const short = authWorld({ token: lifetime(30) });
    expect(await send(short)).toMatchObject({ ok: true, kind: "complete" });
    expect(mcpAuthorizationStateCounts().tokens).toBe(0);
    await send(short);
    expect(short.of("token")).toHaveLength(2);
  });
});

describe("[B20 A3] the cache key (OD-63)", () => {
  it("different requested scope sets of one server are different entries", async () => {
    let answered = 0;
    const world = authWorld({
      prm: () => jsonAnswer(prmDocument(ccServer.canonicalUri, { scopes_supported: ["docs:read"] })),
      mcp: (call) => (++answered === 1 ? plainAnswer(null, 403, { "www-authenticate": 'Bearer error="insufficient_scope", scope="docs:search"' }) : rpcResult(call, { tools: [] })),
    });
    expect(await send(world)).toMatchObject({ ok: true, authorization: { steppedUp: true, scopes: ["docs:read", "docs:search"] } });
    expect(mcpAuthorizationStateCounts().tokens).toBe(2);
    expect(world.of("token").map((call) => call.form!.get("scope"))).toEqual(["docs:read", "docs:read docs:search"]);
  });

  it("B6: two spellings of one row whose ceilings are [\"a|b\"] and [\"a\",\"b\"] hold two entries and make two token requests (the key is JSON, never a joined string)", async () => {
    const world = authWorld({ prm: () => jsonAnswer(prmDocument(ccServer.canonicalUri, { scopes_supported: ["a|b", "a", "b"] })) });
    expect(await send(world, withCeiling(["a|b"]))).toMatchObject({ ok: true });
    expect(await send(world, withCeiling(["a", "b"]))).toMatchObject({ ok: true });
    expect(world.of("token").map((call) => call.form!.get("scope"))).toEqual(["a|b", "a b"]);
    expect(mcpAuthorizationStateCounts().tokens).toBe(2);
    expect(bearerOf(world)).toEqual([`Bearer ${world.issued[0]}`, `Bearer ${world.issued[1]}`]);
  });

  it("two rows sharing the issuer and the client-id variable make two requests, each with its own resource; row A's token never reaches row B", async () => {
    const world = authWorld();
    await send(world, ccServer);
    await send(world, ccServerB64);
    await send(world, ccServer);
    await send(world, ccServerB64);
    expect(world.of("token").map((call) => call.form!.get("resource"))).toEqual(["https://mcp.example.com/mcp", "https://b64.example.com/mcp"]);
    const byHost = (host: string): string[] => world.of("mcp").filter((call) => call.host === host).map((call) => call.headers.Authorization!);
    expect(new Set(byHost("mcp.example.com"))).toEqual(new Set([`Bearer ${world.issued[0]}`]));
    expect(new Set(byHost("b64.example.com"))).toEqual(new Set([`Bearer ${world.issued[1]}`]));
  });
});

describe("[B20 A3] the guarded clock", () => {
  it("a clock that answers NaN when the token is obtained is not cached (the last good tick decides validity, the raw read decides the write)", async () => {
    const world = authWorld();
    await send(world, ccServerB64); // a good tick first
    const nan = await mcpPostAuthorized(ccServer, listRequest(), { purpose: "interactive", deps: world.deps({ clock: () => Number.NaN }) });
    expect(nan).toMatchObject({ ok: true, kind: "complete" });
    expect(mcpAuthorizationStateCounts().tokens).toBe(1);
    await send(world, ccServer);
    expect(world.of("token")).toHaveLength(3);
  });

  it("a clock stepping back one hour drops the entry; a clock that throws falls back to the last good tick", async () => {
    const world = authWorld();
    await send(world);
    const thrown = await mcpPostAuthorized(ccServer, listRequest(), { purpose: "interactive", deps: world.deps({ clock: () => { throw new Error("clock gone"); } }) });
    expect(thrown).toMatchObject({ ok: true, kind: "complete", authorization: { tokenSource: "cache" } });
    expect(world.of("token")).toHaveLength(1);
    world.now = T0 - 3_600_000;
    expect(await send(world)).toMatchObject({ ok: true, authorization: { tokenSource: "fetched" } });
    expect(world.of("token")).toHaveLength(2);
  });
});

describe("[B20 A3] bounded state", () => {
  it(`${MCP_TOKEN_CACHE_MAX + 1} keys evict the least recently used to ${MCP_TOKEN_CACHE_MAX}; ${MCP_TOKEN_CACHE_MAX + 1} servers' working sets evict to ${MCP_TOKEN_CACHE_MAX}`, async () => {
    const world = authWorld();
    for (let index = 0; index <= MCP_TOKEN_CACHE_MAX; index += 1) {
      const row = ccRow(`docs-e${index}`, `e${index}.example.com`);
      expect(await send(world, row), row.id).toMatchObject({ ok: true });
    }
    const counts = mcpAuthorizationStateCounts();
    expect(counts.tokens).toBe(MCP_TOKEN_CACHE_MAX);
    expect(counts.workingSets).toBe(MCP_TOKEN_CACHE_MAX);
    expect(counts.metadata).toBe(MCP_TOKEN_CACHE_MAX);
    // the first server's entry was evicted: its next call acquires again
    await send(world, ccRow("docs-e0", "e0.example.com"));
    expect(world.of("token")).toHaveLength(MCP_TOKEN_CACHE_MAX + 2);
  });

  // [B20 A3 review] tests-token-cache-lru-not-distinguished: the case above uses each key once, so insertion order (FIFO)
  // and least-recently-USED evict the same entry. Here the oldest key is used again before the 65th arrives.
  it("eviction is least recently USED: a key read again before the 65th key arrives stays cached, and the next-oldest is evicted instead", async () => {
    const world = authWorld();
    const rows = Array.from({ length: MCP_TOKEN_CACHE_MAX + 1 }, (_, index) => ccRow(`docs-l${index}`, `l${index}.example.com`));
    for (const row of rows.slice(0, MCP_TOKEN_CACHE_MAX)) expect(await send(world, row), row.id).toMatchObject({ ok: true, authorization: { tokenSource: "fetched" } });
    const requests = world.of("token").length;
    expect(await send(world, rows[0]!), "the oldest key read again: a hit").toMatchObject({ ok: true, authorization: { tokenSource: "cache" } });
    expect(await send(world, rows[MCP_TOKEN_CACHE_MAX]!), "the 65th key").toMatchObject({ ok: true, authorization: { tokenSource: "fetched" } });
    expect(mcpAuthorizationStateCounts().tokens).toBe(MCP_TOKEN_CACHE_MAX);
    expect(await send(world, rows[0]!), "the key read last is still cached").toMatchObject({ ok: true, authorization: { tokenSource: "cache" } });
    expect(await send(world, rows[1]!), "the least recently used key was evicted").toMatchObject({ ok: true, authorization: { tokenSource: "fetched" } });
    expect(world.of("token").length - requests).toBe(2);
  });

  it("the ring keeps 4 of 5 dropped tokens, each until its own expiry; redaction subjects are the cached tokens then the ring, most recent first, at most 8", async () => {
    const revoked = new Set<string>();
    let lifetimeSeconds = 0;
    const world = authWorld({
      token: (_call, self) => { lifetimeSeconds += 100; return jsonAnswer(tokenDocument(self.issue(), { expires_in: lifetimeSeconds })); },
      mcp: (call) => (revoked.has(call.headers.Authorization!.slice("Bearer ".length)) ? plainAnswer(null, 401, { "www-authenticate": "Bearer" }) : rpcResult(call, { tools: [] })),
    });
    lifetimeSeconds = 900; // t1: 1 000 s; each later token 100 s longer
    await send(world);
    // one drop per UTC minute (the window allows four token requests per server per minute): t(n) is obtained at T0 + 60 (n - 1) s
    for (let drop = 0; drop < 5; drop += 1) {
      world.now = T0 + (drop + 1) * 60_000;
      revoked.add(world.issued.at(-1)!);
      expect(await send(world), `drop ${drop}`).toMatchObject({ ok: true, authorization: { refreshed: true } });
    }
    expect(mcpAuthorizationStateCounts().ring).toBe(4);
    const subjects = mcpAuthorizationTokenProvider.redactionSubjects!(ccServer, ENV);
    expect(subjects).toEqual([world.issued[5], world.issued[4], world.issued[3], world.issued[2], world.issued[1]]);
    // t2 (obtained T0 + 60 s, 1 100 s) expires at T0 + 1 130 s; t3 at T0 + 1 290 s; t4 at T0 + 1 450 s: each leaves at its own
    world.now = T0 + 1_130_000;
    await send(world);
    expect(mcpAuthorizationStateCounts().ring).toBe(3);
    world.now = T0 + 1_450_000;
    await send(world);
    expect(mcpAuthorizationStateCounts().ring).toBe(1);
    // more held tokens than 8: five cached spellings of the row plus the ring
    resetMcpAuthorization();
    const many = authWorld({ prm: () => jsonAnswer(prmDocument(ccServer.canonicalUri, { scopes_supported: ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9"] })) });
    // one UTC minute per spelling: the window allows four token requests per server per minute
    for (let index = 1; index <= 9; index += 1) {
      many.now += 60_000;
      expect(await send(many, withCeiling([`s${index}`])), `s${index}`).toMatchObject({ ok: true });
    }
    const capped = mcpAuthorizationTokenProvider.redactionSubjects!(ccServer, ENV);
    expect(capped).toHaveLength(8);
    expect(capped[0]).toBe(many.issued[8]);
  });
});

describe("[B20 A3] one shared acquisition per key (D13)", () => {
  it("ten concurrent calls make exactly one probe, one PRM, one AS and one token request; one that aborts is authorization_aborted and the other nine complete", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const world = authWorld({ token: async (_call, self) => { await gate; return jsonAnswer(tokenDocument(self.issue())); } });
    const aborter = new AbortController();
    const calls = Array.from({ length: 10 }, (_, index) => send(world, ccServer, index === 3 ? { signal: aborter.signal } : {}));
    await vi.waitFor(() => expect(world.of("token")).toHaveLength(1));
    aborter.abort();
    release();
    const outcomes = await Promise.all(calls);
    expect(outcomes[3]).toMatchObject({ ok: false, kind: "closed", code: "authorization_aborted" });
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(9);
    expect([world.of("probe").length, world.of("prm").length, world.of("as").length, world.of("token").length]).toEqual([1, 1, 1, 1]);
    expect(world.of("mcp")).toHaveLength(9);
    expect(mcpAuthorizationStateCounts().inflight).toBe(0);
    expect(mcpInFlight(ccServer.id)).toBe(0);
  });

  it("C7: a joiner with a different environment gets the first caller's token (the flight runs with the first caller's context)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const world = authWorld({ token: async (_call, self) => { await gate; return jsonAnswer(tokenDocument(self.issue())); } });
    const first = send(world);
    await vi.waitFor(() => expect(world.of("token")).toHaveLength(1));
    const joiner = mcpPostAuthorized(ccServer, listRequest(), { purpose: "interactive", deps: world.deps({ environment: { ...ENV, [CLIENT_SECRET_ENV]: `${CLIENT_SECRET}-rotated` } }) });
    release();
    const [a, b] = await Promise.all([first, joiner]);
    expect(a).toMatchObject({ ok: true });
    expect(b).toMatchObject({ ok: true, authorization: { tokenSource: "fetched" } });
    expect(world.of("token")).toHaveLength(1);
    expect(new Set(bearerOf(world))).toEqual(new Set([`Bearer ${world.issued[0]}`]));
  });
});

describe("[B20 A3] the token-request window and the backoff", () => {
  it("the fifth acquisition in one UTC minute is token_requests_exhausted with retryAtMs the window end; the next minute is allowed", async () => {
    const world = authWorld({ token: lifetime(30) });
    for (let index = 0; index < 4; index += 1) expect(await send(world), String(index)).toMatchObject({ ok: true });
    const fifth = await send(world);
    expect(fifth).toMatchObject({ ok: false, code: "token_requests_exhausted", stage: "configuration", retryAtMs: T0 + 60_000 });
    expect(world.of("token")).toHaveLength(4);
    expect(mcpAuthorizationStateCounts().tokenRequests).toBe(4);
    world.now = T0 + 60_000;
    expect(await send(world)).toMatchObject({ ok: true });
    expect(world.of("token")).toHaveLength(5);
  });

  it("tokenRequests counts attempts, including one the egress boundary refused before the transport", async () => {
    const elsewhere = ccRow("docs-elsewhere", "elsewhere.example.com");
    const pinned = { ...elsewhere, auth: { ...elsewhere.auth, authorizationServer: { issuer: "https://auth.example.com", tokenEndpoint: "https://tokens.example.org/oauth/token" } } };
    const world = authWorld({
      resolve: async (host) => (host === "tokens.example.org" ? ["10.1.2.3"] : ["93.184.216.34"]),
      as: (call) => (call.path.endsWith("oauth-authorization-server") ? jsonAnswer(asDocument({ token_endpoint: "https://tokens.example.org/oauth/token" })) : plainAnswer("nf", 404)),
    });
    expect(await send(world, pinned)).toMatchObject({ ok: false, code: "token_endpoint_unavailable", egressCode: "address_blocked" });
    expect(world.of("token")).toEqual([]);
    expect(mcpAuthorizationStateCounts().tokenRequests).toBe(1);
  });

  it("a failure sets a 60 s backoff: zero requests inside it, released at 60 s, and a cached token for another key is still used", async () => {
    let failing = true;
    let answered = 0;
    const world = authWorld({
      token: (_call, self) => (failing && self.issued.length >= 1 ? plainAnswer("boom", 500) : jsonAnswer(tokenDocument(self.issue()))),
      mcp: (call) => (++answered === 2 ? plainAnswer(null, 403, { "www-authenticate": 'Bearer error="insufficient_scope", scope="docs:search"' }) : rpcResult(call, { tools: [] })),
      prm: () => jsonAnswer(prmDocument(ccServer.canonicalUri, { scopes_supported: ["docs:read"] })),
    });
    expect(await send(world)).toMatchObject({ ok: true });
    expect(await send(world)).toMatchObject({ ok: false, code: "token_endpoint_unavailable", stage: "token", httpStatus: 500 });
    const before = world.calls.length;
    // the step-up's failure: the backoff holds acquisitions, the cached token of the working set is still used
    expect(await send(world)).toMatchObject({ ok: true, authorization: { tokenSource: "cache" } });
    expect(world.calls.length - before).toBe(1);
    const cold = await send(world, withCeiling(["docs:search"]));
    expect(cold).toMatchObject({ ok: false, code: "authorization_backoff", retryAtMs: T0 + MCP_AUTHORIZATION_BACKOFF_MS });
    expect(world.calls.length - before).toBe(1);
    failing = false;
    world.now = T0 + MCP_AUTHORIZATION_BACKOFF_MS;
    expect(await send(world, withCeiling(["docs:search"]))).toMatchObject({ ok: true });
  });
});

describe("[B20 A3] the state probe (S3) and the provider (S4)", () => {
  it("state carries the token and never the secret, after success and after failure; a 15-character piece of the token answers false; reset forgets", async () => {
    const world = authWorld();
    await send(world);
    const token = world.issued[0]!;
    expect(mcpAuthorizationStateCarries(token)).toBe(true);
    expect(mcpAuthorizationStateCarries(token.toUpperCase())).toBe(true);
    expect(mcpAuthorizationStateCarries(CLIENT_SECRET)).toBe(false);
    for (let start = 0; start + MCP_STATE_PROBE_MIN_CHARS - 1 <= token.length; start += 1) expect(mcpAuthorizationStateCarries(token.slice(start, start + MCP_STATE_PROBE_MIN_CHARS - 1))).toBe(false);
    expect(mcpAuthorizationStateCarries(token.slice(0, MCP_STATE_PROBE_MIN_CHARS))).toBe(true);
    for (const junk of [undefined, 42, null, "x".repeat(8_193)]) expect(mcpAuthorizationStateCarries(junk)).toBe(false);
    resetMcpAuthorization();
    expect(mcpAuthorizationStateCarries(token)).toBe(false);
    await send(authWorld({ token: () => plainAnswer("boom", 500) }));
    expect(mcpAuthorizationStateCarries(CLIENT_SECRET)).toBe(false);
    expect(mcpAuthorizationStateCarries(CLIENT_SECRET.slice(0, 20))).toBe(false);
  });

  it("the provider answers the fixed token_unavailable sentence for a client-credentials row, cold and warm; for none and pre-issued rows it is the A1 provider; redactionSubjects is non-writable", async () => {
    const sentence = 'MCP server "docs-cc": a client-credentials token is handed only to mcpPostAuthorized; nothing was sent.';
    expect(await mcpAuthorizationTokenProvider(ccServer, ENV)).toEqual({ ok: false, code: "token_unavailable", message: sentence });
    await send(authWorld());
    expect(await mcpAuthorizationTokenProvider(ccServer, ENV)).toEqual({ ok: false, code: "token_unavailable", message: sentence });
    const none = fixtureServer();
    const environment = { [TOKEN_ENV]: TOKENS[0]! };
    expect(await mcpAuthorizationTokenProvider(none, environment)).toEqual(await noneTokenProvider(none, environment));
    expect(await mcpAuthorizationTokenProvider(tokenServer, environment)).toEqual(await preIssuedTokenEnvProvider(tokenServer, environment));
    expect(await mcpAuthorizationTokenProvider(tokenServer, {})).toEqual(await preIssuedTokenEnvProvider(tokenServer, {}));
    expect(mcpAuthorizationTokenProvider.redactionSubjects!(tokenServer, environment)).toEqual([TOKENS[0]]);
    expect(mcpAuthorizationTokenProvider.redactionSubjects!(none, environment)).toEqual([]);
    expect(Object.getOwnPropertyDescriptor(mcpAuthorizationTokenProvider, "redactionSubjects")).toMatchObject({ writable: false, configurable: false });
    expect(() => { (mcpAuthorizationTokenProvider as { redactionSubjects?: unknown }).redactionSubjects = () => ["x"]; }).toThrow(TypeError);
    const malformed = { ...ccServer, id: "Bad Id" };
    expect(await mcpAuthorizationTokenProvider(malformed, ENV)).toMatchObject({ ok: false, message: 'MCP server "(malformed id)": a client-credentials token is handed only to mcpPostAuthorized; nothing was sent.' });
  });
});
