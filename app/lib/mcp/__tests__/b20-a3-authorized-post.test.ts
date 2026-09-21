/**
 * [B20 A3] `mcpPostAuthorized`: the one door through which a client-credentials token reaches the transport. It passes
 * every other row through to `mcpPost` untouched; for a client-credentials row under the A3 provider it checks the row's
 * configuration, declares the client-credentials extension on every request (LD-1), takes a token from the cache or one
 * bounded acquisition, and re-sends at most twice: ONE refresh after a 401 on a cached token and ONE step-up after an
 * `insufficient_scope` 403 (OD-62) — each re-send under a new JSON-RPC id, with every token of the call redacted from what
 * comes back and added to the caller's collector before it is sent. The A2 call sites use it unchanged for other rows.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { previewMcpAdmission, recordMcpOutcome, requestMcpAdmission, resetAdmissionControl } from "../../acquisition/admission-control";
import { acceptForeignTools } from "../foreign-tools";
import {
  createMcpRedactionCollector, MCP_AUTH_TRACE_EXCHANGES_MAX, MCP_CALL_REDACTION_SUBJECTS_MAX, mcpAuthorizationStateCounts, mcpAuthorizationTokenProvider, mcpPostAuthorized, resetMcpAuthorization,
} from "../authorization";
import { MCP_REDACT_ALSO_MAX, mcpPost, resetMcpInFlight, type McpPostOptions } from "../http-transport";
import { discoverMcpServer } from "../negotiation";
import type { McpServerRegistryEntry } from "../server-registry";
import { callMcpTool } from "../tool-call";
import { listMcpTools, resetMcpToolCache } from "../tool-discovery";
import { T0 } from "./_fixtures";
import { byMethod, depsOf, discoverResult, fakeMcpServer, rpcError, rpcResult, server as noneServer, survivor, tool, TOKENS, tokenServer } from "./_fake-mcp-server";
import {
  asDocument, authWorld, bareProbe, ccRow, ccServer, CEILING, challengeProbe, CLIENT_SECRET, ENV, EXTENSION, jsonAnswer, listRequest, MARKER, plainAnswer, prmDocument, REFRESH_TOKEN, tokenDocument,
  type AuthCall, type AuthWorld,
} from "./_fake-authorization-server";

const send = (world: AuthWorld, server: McpServerRegistryEntry = ccServer, extra: Record<string, unknown> = {}) => mcpPostAuthorized(server, listRequest(), { purpose: "interactive", deps: world.deps(), ...extra });
const withAuth = (auth: Partial<McpServerRegistryEntry["auth"]>, base: McpServerRegistryEntry = ccServer): McpServerRegistryEntry => ({ ...base, auth: { ...base.auth, ...auth } });
const challenge401 = (params = ""): Response => plainAnswer(null, 401, { "www-authenticate": `Bearer${params === "" ? "" : ` ${params}`}` });
const insufficient = (scope: string): Response => plainAnswer(null, 403, { "www-authenticate": `Bearer error="insufficient_scope", scope="${scope}"` });
const bearer = (call: AuthCall): string => (call.headers.Authorization ?? "").replace(/^Bearer /, "");
const readOnlyScopes = (): Response => jsonAnswer(prmDocument(ccServer.canonicalUri, { scopes_supported: ["docs:read"] }));
const sse = (frames: string[]): Response => new Response(frames.map((frame) => `data: ${frame}\n\n`).join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
/** the client capabilities `_meta` of one recorded request */
const capabilitiesOf = (call: { body: { params?: Record<string, unknown> } }): unknown => (call.body.params?._meta as Record<string, unknown> | undefined)?.["io.modelcontextprotocol/clientCapabilities"];
const leaks = (value: unknown): string[] => [MARKER, CLIENT_SECRET, REFRESH_TOKEN].filter((planted) => JSON.stringify(value).includes(planted));

beforeEach(() => {
  resetAdmissionControl();
  resetMcpInFlight();
  resetMcpAuthorization();
  resetMcpToolCache();
  vi.stubGlobal("fetch", () => { throw new Error("the authorization client bypassed the egress boundary and called the global fetch"); });
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetAdmissionControl();
  resetMcpInFlight();
  resetMcpAuthorization();
  resetMcpToolCache();
});

describe("[B20 A3] pass-through and configuration", () => {
  it("none and pre-issued rows, with and without the A3 provider, answer exactly as mcpPost does, with the same requests on the wire", async () => {
    for (const row of [noneServer, tokenServer]) {
      for (const provider of [undefined, mcpAuthorizationTokenProvider]) {
        const direct = fakeMcpServer(byMethod({ list: (call) => rpcResult(call, { tools: [tool("a")] }) }));
        const passed = fakeMcpServer(byMethod({ list: (call) => rpcResult(call, { tools: [tool("a")] }) }));
        const options = (fake: typeof direct): McpPostOptions => ({ purpose: "interactive", deps: depsOf(fake, TOKENS[0], provider === undefined ? {} : { tokenProvider: provider }) });
        const expected = await mcpPost(row, listRequest(), options(direct));
        resetAdmissionControl();
        const actual = await mcpPostAuthorized(row, listRequest(), { ...options(passed), redaction: createMcpRedactionCollector([]) });
        expect(actual, `${row.id} ${provider === undefined ? "default" : "A3"}`).toEqual(expected);
        expect(passed.calls.map((call) => ({ ...call })), row.id).toEqual(direct.calls.map((call) => ({ ...call })));
        expect(passed.calls[0]!.body.params?._meta).toMatchObject({ "io.modelcontextprotocol/clientCapabilities": {} });
      }
    }
  });

  it("a client-credentials row without the A3 provider is token_unavailable and nothing is fetched", async () => {
    const world = authWorld();
    const result = await mcpPostAuthorized(ccServer, listRequest(), { purpose: "interactive", deps: world.deps({ tokenProvider: undefined }) });
    expect(result).toMatchObject({ ok: false, kind: "closed", code: "token_unavailable" });
    expect(world.calls).toEqual([]);
  });

  it("C4: every configuration failure is authorization_not_configured with zero requests, a hostile NAME never echoed, the outcome frozen", async () => {
    // [B20 A3 review] tests-c4-secret-shaped-name-lowercased: the NAME was lower-cased, so the NAME pattern refused it on case
    // alone. These pass the NAME pattern (upper case, digits) and carry a secret shape the registry refuses (assembled here)
    const keyShaped = ["AKIA", "Z".repeat(16)].join("");
    const lowerShaped = `SK_ANT_${"K".repeat(40)}`.toLowerCase();
    const rows: Array<[string, McpServerRegistryEntry]> = [
      ["a malformed id", { ...ccServer, id: "Bad Id" }],
      ["a canonical URI on another host than the endpoint", { ...ccServer, canonicalUri: "https://other.example.com/mcp" }],
      ["a canonical URI on another port", { ...ccServer, canonicalUri: "https://mcp.example.com:8443/mcp" }],
      ["a canonical URI with another path", { ...ccServer, canonicalUri: "https://mcp.example.com/other" }],
      ["a secret-shaped client-id NAME", withAuth({ secrets: [{ env: keyShaped, role: "client-id" }, { env: "MCP_DOCS_CLIENT_SECRET", role: "client-secret" }] })],
      ["a secret-shaped client-secret NAME", withAuth({ secrets: [{ env: "MCP_DOCS_CLIENT_ID", role: "client-id" }, { env: keyShaped, role: "client-secret" }] })],
      ["a lower-cased secret-shaped NAME", withAuth({ secrets: [{ env: lowerShaped, role: "client-id" }, { env: "MCP_DOCS_CLIENT_SECRET", role: "client-secret" }] })],
      ["a too-long environment NAME", withAuth({ secrets: [{ env: `A${"B".repeat(64)}`, role: "client-id" }, { env: "MCP_DOCS_CLIENT_SECRET", role: "client-secret" }] })],
      ["a lowercase environment NAME", withAuth({ secrets: [{ env: "mcp_docs_client_id", role: "client-id" }, { env: "MCP_DOCS_CLIENT_SECRET", role: "client-secret" }] })],
      ["a duplicated reference", withAuth({ secrets: [{ env: "MCP_DOCS_CLIENT_ID", role: "client-id" }, { env: "MCP_DOCS_CLIENT_ID", role: "client-secret" }] })],
      ["no secret reference", withAuth({ secrets: [{ env: "MCP_DOCS_CLIENT_ID", role: "client-id" }] })],
      ["a duplicate scope", withAuth({ scopes: ["docs:read", "docs:read"] })],
      ["a space-carrying scope", withAuth({ scopes: ["docs read"] })],
      ["33 scopes", withAuth({ scopes: Array.from({ length: 33 }, (_, index) => `s${index}`) })],
      ["no pin", withAuth({ authorizationServer: null })],
      ["an http issuer", withAuth({ authorizationServer: { issuer: "http://auth.example.com", tokenEndpoint: "https://auth.example.com/oauth/token" } })],
      ["a root token endpoint", withAuth({ authorizationServer: { issuer: "https://auth.example.com", tokenEndpoint: "https://auth.example.com" } })],
      ["the token endpoint is the MCP endpoint", withAuth({ authorizationServer: { issuer: "https://auth.example.com", tokenEndpoint: "https://mcp.example.com/mcp" } })],
      // [B20 A3 review] regressions-3: an exact comparison let a terminating slash or a sub-path of the endpoint through
      ["the token endpoint is the MCP endpoint with a terminating slash", withAuth({ authorizationServer: { issuer: "https://auth.example.com", tokenEndpoint: "https://mcp.example.com/mcp/" } })],
      ["the token endpoint lies under the MCP endpoint", withAuth({ authorizationServer: { issuer: "https://auth.example.com", tokenEndpoint: "https://mcp.example.com/mcp/oauth/token" } })],
    ];
    for (const [label, row] of rows) {
      const world = authWorld();
      const result = await send(world, row);
      expect(result, label).toMatchObject({ ok: false, kind: "closed", code: "authorization_not_configured", stage: "configuration" });
      expect(Object.isFrozen(result), label).toBe(true);
      expect(world.calls, label).toEqual([]);
      expect(JSON.stringify(result), label).not.toContain(keyShaped);
      expect(JSON.stringify(result), label).not.toContain(lowerShaped);
      expect((result as { message: string }).message.length, label).toBeLessThanOrEqual(300);
    }
    // the same host on another path is another resource: a server that is its own authorization server stays configurable
    const own = authWorld({ as: (call) => (call.path.endsWith("oauth-authorization-server") ? jsonAnswer(asDocument({ token_endpoint: "https://mcp.example.com/oauth/token" })) : plainAnswer("nf", 404)) });
    expect(await send(own, withAuth({ authorizationServer: { issuer: "https://auth.example.com", tokenEndpoint: "https://mcp.example.com/oauth/token" } }))).toMatchObject({ ok: true, kind: "complete" });
  });

  // [B20 A3 review] regressions-2: the mode was read before the pass-through decision with no guard, so a row whose `auth`
  // cannot be read became `authorization_failed` with a client-credentials trace, not what `mcpPost` answers
  it("a row whose auth cannot be read — a throwing getter, or none at all — passes through to mcpPost exactly: its outcome, its requests, no authorization trace", async () => {
    const throwing = { ...ccServer };
    Object.defineProperty(throwing, "auth", { get: () => { throw new Error("the row cannot be read"); } });
    const missing = { ...ccServer, auth: undefined } as unknown as McpServerRegistryEntry;
    for (const [label, row] of [["a throwing auth getter", throwing], ["no auth", missing]] as const) {
      for (const provider of [undefined, mcpAuthorizationTokenProvider]) {
        const direct = authWorld();
        const passed = authWorld();
        const expected = await mcpPost(row, listRequest(), { purpose: "interactive", deps: direct.deps({ tokenProvider: provider }) });
        const actual = await mcpPostAuthorized(row, listRequest(), { purpose: "interactive", deps: passed.deps({ tokenProvider: provider }), redaction: createMcpRedactionCollector([]) });
        const at = `${label}, ${provider === undefined ? "the default provider" : "the A3 provider"}`;
        expect(actual, at).toEqual(expected);
        expect(actual, at).toMatchObject({ ok: false, kind: "closed", code: "token_unavailable" });
        expect(actual, at).not.toHaveProperty("authorization");
        expect(passed.calls, at).toEqual(direct.calls);
      }
    }
  });

  it("B1: a pre-aborted signal is the transport's `aborted` with a zero attribution, cache cold or warm, and nothing is sent", async () => {
    const aborted = new AbortController();
    aborted.abort();
    const world = authWorld();
    const cold = await send(world, ccServer, { signal: aborted.signal });
    expect(cold).toMatchObject({ ok: false, kind: "closed", code: "aborted", message: 'MCP server "docs-cc": the request was aborted before it started.', elapsedMs: 0, requestBytes: 0, responseBytes: 0 });
    expect(world.calls).toEqual([]);
    await send(world);
    const before = world.calls.length;
    expect(await send(world, ccServer, { signal: aborted.signal })).toMatchObject({ code: "aborted" });
    expect(world.calls.length).toBe(before);
  });
});

describe("[B20 A3] the happy path and the declared extension (LD-1)", () => {
  it("probe, PRM, AS, token, MCP in that order; the Bearer header carries the issued token; the trace names hosts, never a path or a token", async () => {
    const world = authWorld();
    const result = await send(world);
    expect(world.calls.map((call) => call.kind)).toEqual(["probe", "prm", "as", "token", "mcp"]);
    expect(world.of("mcp")[0]!.headers.Authorization).toBe(`Bearer ${world.issued[0]}`);
    expect(result).toMatchObject({ ok: true, kind: "complete", authorization: { mode: "client-credentials-env", tokenSource: "fetched", refreshed: false, steppedUp: false, scopes: ["docs:read", "docs:search"] } });
    const trace = (result as unknown as { authorization: { exchanges: Array<{ stage: string; host: string; status: number | null }> } }).authorization;
    expect(trace.exchanges.map((exchange) => [exchange.stage, exchange.host, exchange.status])).toEqual([["probe", "mcp.example.com", 401], ["prm", "mcp.example.com", 200], ["as-metadata", "auth.example.com", 200], ["token", "auth.example.com", 200]]);
    expect(JSON.stringify(trace)).not.toContain("/.well-known");
    expect(JSON.stringify(trace)).not.toContain("/oauth/token");
    expect(JSON.stringify(trace)).not.toContain(world.issued[0]);
    expect(Object.isFrozen(trace)).toBe(true);
    expect(leaks(result)).toEqual([]);
    const second = await send(world);
    expect(second).toMatchObject({ ok: true, authorization: { tokenSource: "cache", exchanges: [] } });
  });

  it("every request of a client-credentials row declares exactly the extension, merged with the caller's capabilities; none and pre-issued rows declare nothing", async () => {
    let answered = 0;
    const world = authWorld({ mcp: (call) => (++answered === 2 ? challenge401() : rpcResult(call, { tools: [] })) });
    await send(world);
    await send(world);
    const declared = world.calls.filter((call) => call.kind === "mcp" || call.kind === "probe").map(capabilitiesOf);
    expect(declared).toHaveLength(4);
    for (const capabilities of declared) expect(capabilities).toEqual({ extensions: { [EXTENSION]: {} } });
    await send(world, ccServer, { clientCapabilities: { sampling: {}, extensions: { "x.example/other": { depth: 1 } } } });
    expect(capabilitiesOf(world.of("mcp").at(-1)!)).toEqual({ sampling: {}, extensions: { "x.example/other": { depth: 1 }, [EXTENSION]: {} } });
    for (const row of [noneServer, tokenServer]) {
      const fake = fakeMcpServer(byMethod({}));
      await mcpPostAuthorized(row, listRequest(), { purpose: "interactive", deps: depsOf(fake, TOKENS[0], { tokenProvider: mcpAuthorizationTokenProvider }) });
      expect(capabilitiesOf(fake.calls[0]!), row.id).toEqual({});
    }
  });
});

describe("[B20 A3] a 401 on a cached token: one refresh", () => {
  it("compare-and-drop, one token request, the re-send under a NEW id, then success: 2 POSTs and 1 token request", async () => {
    let answered = 0;
    const world = authWorld({ mcp: (call) => (++answered === 2 ? challenge401('error="invalid_token"') : rpcResult(call, { tools: [] })) });
    await send(world);
    // [B20 A3 review] tests-new-id-assertion-order-dependent: the caller's id was 7 and the re-send's was compared with 7, so
    // the test passed or failed by the counter's position. The caller's id is now one the counter never mints (a string); the
    // re-send's must be minted (a number), differ from the refused post's, and come after every id the client minted before
    // (the probe's) — whatever the counter's position — and the caller's own message object must come back unchanged.
    const message = listRequest("caller-7");
    const result = await mcpPostAuthorized(ccServer, message, { purpose: "interactive", deps: world.deps() });
    expect(result).toMatchObject({ ok: true, kind: "complete", authorization: { refreshed: true, tokenSource: "fetched", priorExchanges: [expect.objectContaining({ method: "tools/list" })] } });
    const posts = world.of("mcp").slice(1);
    expect(posts.map(bearer)).toEqual([world.issued[0], world.issued[1]]);
    expect(posts[0]!.body.id).toBe("caller-7");
    const resent = posts[1]!.body.id;
    expect(typeof resent, "a minted id").toBe("number");
    expect(resent, "not the refused post's id").not.toBe(posts[0]!.body.id);
    const minted = world.of("probe").map((call) => call.body.id as number);
    expect(minted.length).toBeGreaterThan(0);
    for (const earlier of minted) expect(resent as number, "a new id from the counter").toBeGreaterThan(earlier);
    expect(message, "the caller's message is never mutated").toEqual(listRequest("caller-7"));
    expect(world.of("token")).toHaveLength(2);
    expect(mcpAuthorizationStateCounts()).toMatchObject({ tokens: 1, ring: 1 });
  });

  // [B20 A3 review] tests-compare-and-drop-compare-half-untested: every 401 above lands while the cache still holds the refused
  // token, so deleting the entry unconditionally passed. Here two calls send cached T1 at once; A's 401 lands first and A
  // refreshes to T2; B's 401 lands after that and must leave A's T2 in the cache — B re-sends T2 with no token request.
  it("compare-and-drop leaves a newer token alone: two calls refused on one cached token make ONE token request, and both re-send the refreshed token", async () => {
    let holding = false;
    const held: Array<(answer: Response) => void> = [];
    const world = authWorld({ mcp: (call, self) => (holding && bearer(call) === self.issued[0] ? new Promise<Response>((resolve) => { held.push(resolve); }) : rpcResult(call, { tools: [] })) });
    expect(await send(world)).toMatchObject({ ok: true });
    holding = true;
    const a = send(world);
    const b = send(world);
    await vi.waitFor(() => expect(held).toHaveLength(2));
    held[0]!(challenge401());
    expect(await a).toMatchObject({ ok: true, authorization: { refreshed: true, tokenSource: "fetched" } });
    held[1]!(challenge401());
    expect(await b).toMatchObject({ ok: true, authorization: { refreshed: true, tokenSource: "cache" } });
    expect(world.of("token")).toHaveLength(2);
    expect(world.of("mcp").slice(-2).map(bearer)).toEqual([world.issued[1], world.issued[1]]);
    expect(mcpAuthorizationStateCounts()).toMatchObject({ tokens: 1, ring: 1 });
  });

  it("a second 401 returns the transport's unauthorized and sets the backoff; the next call is authorization_backoff with zero requests", async () => {
    let answered = 0;
    const world = authWorld({ mcp: (call) => (++answered === 1 ? rpcResult(call, { tools: [] }) : challenge401()) });
    await send(world);
    expect(await send(world)).toMatchObject({ ok: false, kind: "unauthorized", httpStatus: 401, authorization: { refreshed: true } });
    const before = world.calls.length;
    expect(await send(world)).toMatchObject({ ok: false, code: "authorization_backoff", stage: "configuration" });
    expect(world.calls.length).toBe(before);
  });

  it("a failing refresh acquisition returns its code with the refused post in priorExchanges, and the metadata is dropped after a token-stage failure", async () => {
    let answered = 0;
    const world = authWorld({
      mcp: (call) => (++answered === 2 ? challenge401() : rpcResult(call, { tools: [] })),
      token: (_call, self) => (self.issued.length >= 1 ? plainAnswer("boom", 503) : jsonAnswer(tokenDocument(self.issue()))),
    });
    await send(world);
    expect(mcpAuthorizationStateCounts().metadata).toBe(1);
    const result = await send(world);
    expect(result).toMatchObject({ ok: false, code: "token_endpoint_unavailable", stage: "token", httpStatus: 503 });
    expect((result as unknown as { authorization: { priorExchanges: unknown[] } }).authorization.priorExchanges).toHaveLength(1);
    expect(mcpAuthorizationStateCounts().metadata).toBe(0);
  });

  it("a 401 on a FRESH token is not refreshed — a joined single flight counts as fresh — and sets the backoff", async () => {
    const world = authWorld({ mcp: () => challenge401() });
    expect(await send(world)).toMatchObject({ ok: false, kind: "unauthorized", authorization: { refreshed: false, tokenSource: "fetched" } });
    expect(world.of("token")).toHaveLength(1);
    expect(world.of("mcp")).toHaveLength(1);
    // [B20 A3 review] tests-fresh-401-backoff-not-asserted: the backoff this case names is read, at the same tick
    const before = world.calls.length;
    expect(await send(world)).toMatchObject({ ok: false, kind: "closed", code: "authorization_backoff", stage: "configuration" });
    expect(world.calls.length, "nothing is sent inside the backoff").toBe(before);
    resetMcpAuthorization();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const joined = authWorld({ mcp: () => challenge401(), token: async (_call, self) => { await gate; return jsonAnswer(tokenDocument(self.issue())); } });
    const first = send(joined);
    await vi.waitFor(() => expect(joined.of("token")).toHaveLength(1));
    const second = send(joined);
    release();
    const outcomes = await Promise.all([first, second]);
    for (const outcome of outcomes) expect(outcome).toMatchObject({ kind: "unauthorized", authorization: { refreshed: false } });
    expect(joined.of("token")).toHaveLength(1);
    expect(joined.of("mcp")).toHaveLength(2);
    const after = joined.calls.length;
    expect(await send(joined)).toMatchObject({ ok: false, code: "authorization_backoff" });
    expect(joined.calls.length).toBe(after);
  });

  it("a 401 loop over five calls: exact request counts, never more than one refresh per call", async () => {
    let answered = 0;
    const world = authWorld({ mcp: (call) => (++answered === 1 ? rpcResult(call, { tools: [] }) : challenge401()) });
    const outcomes = [];
    for (let index = 0; index < 5; index += 1) {
      outcomes.push(await send(world));
      world.now += 61_000;
    }
    expect(outcomes.map((outcome) => (outcome as { code?: string; kind: string }).code ?? outcome.kind)).toEqual(["complete", "unauthorized", "unauthorized", "unauthorized", "unauthorized"]);
    // call 1: probe, prm, as, token, mcp; call 2: mcp (401), token, mcp (401); calls 3-5: cold again after the backoff: a fresh token, one post, no refresh
    expect(world.of("mcp")).toHaveLength(1 + 2 + 3);
    expect(world.of("token")).toHaveLength(1 + 1 + 3);
  });

  it("a refresh that returns the same token is not re-sent: the transport's unauthorized with the backoff", async () => {
    let answered = 0;
    const fixed = `${["fake", "access", "token"].join("-")}-same0001x`;
    const world = authWorld({ mcp: (call) => (++answered === 2 ? challenge401() : rpcResult(call, { tools: [] })), token: () => jsonAnswer(tokenDocument(fixed)) });
    await send(world);
    expect(await send(world)).toMatchObject({ ok: false, kind: "unauthorized", authorization: { refreshed: false } });
    expect(world.of("mcp")).toHaveLength(2);
    expect(world.of("token")).toHaveLength(2);
    expect(await send(world)).toMatchObject({ code: "authorization_backoff" });
  });

  it("a new same-origin challenge URL re-discovers from it; a cross-origin one is prm_url_not_allowed; a 400 with a challenge is never refreshed", async () => {
    let answered = 0;
    const world = authWorld({ mcp: (call) => (++answered === 2 ? challenge401('resource_metadata="https://mcp.example.com/meta/v2"') : rpcResult(call, { tools: [] })) });
    await send(world);
    expect(await send(world)).toMatchObject({ ok: true, authorization: { refreshed: true } });
    expect(world.of("prm").map((call) => call.path)).toEqual(["/.well-known/oauth-protected-resource/mcp", "/meta/v2"]);
    resetMcpAuthorization();
    answered = 0;
    const cross = authWorld({ mcp: (call) => (++answered === 2 ? challenge401('resource_metadata="https://evil.example.net/meta"') : rpcResult(call, { tools: [] })) });
    await send(cross);
    expect(await send(cross)).toMatchObject({ ok: false, code: "prm_url_not_allowed" });
    // [B20 A3 review] the refusal sets the backoff: the next call is held with nothing sent
    const crossCalls = cross.calls.length;
    expect(await send(cross)).toMatchObject({ ok: false, code: "authorization_backoff" });
    expect(cross.calls.length).toBe(crossCalls);
    resetMcpAuthorization();
    answered = 0;
    const bad = authWorld({ mcp: (call) => (++answered === 2 ? plainAnswer(null, 400, { "www-authenticate": 'Bearer error="invalid_request"' }) : rpcResult(call, { tools: [] })) });
    await send(bad);
    expect(await send(bad)).toMatchObject({ ok: false, kind: "unauthorized", httpStatus: 400, authorization: { refreshed: false } });
    expect(bad.of("token")).toHaveLength(1);
  });
});

describe("[B20 A3] scope step-up bounded (OD-62)", () => {
  it("within the ceiling: the union goes in the form body sorted, the call succeeds, and the next call uses the working set", async () => {
    let answered = 0;
    const world = authWorld({ prm: readOnlyScopes, mcp: (call) => (++answered === 1 ? insufficient("docs:search") : rpcResult(call, { tools: [] })) });
    expect(await send(world)).toMatchObject({ ok: true, authorization: { steppedUp: true, scopes: ["docs:read", "docs:search"] } });
    expect(world.of("token").map((call) => call.form!.get("scope"))).toEqual(["docs:read", "docs:read docs:search"]);
    expect(await send(world)).toMatchObject({ ok: true, authorization: { tokenSource: "cache", scopes: ["docs:read", "docs:search"] } });
    expect(bearer(world.of("mcp").at(-1)!)).toBe(world.issued[1]);
  });

  it("a second insufficient_scope is step_up_exhausted; a 403 that names nothing new is step_up_exhausted with zero token requests", async () => {
    const twice = authWorld({ prm: readOnlyScopes, mcp: () => insufficient("docs:search") });
    expect(await send(twice)).toMatchObject({ ok: false, code: "step_up_exhausted", stage: "retry" });
    expect(twice.of("token")).toHaveLength(2);
    expect(twice.of("mcp")).toHaveLength(2);
    resetMcpAuthorization();
    const nothingNew = authWorld({ mcp: () => insufficient("docs:read") });
    expect(await send(nothingNew)).toMatchObject({ ok: false, code: "step_up_exhausted" });
    expect(nothingNew.of("token")).toHaveLength(1);
    resetMcpAuthorization();
    const unnamed = authWorld({ mcp: () => plainAnswer(null, 403, { "www-authenticate": 'Bearer error="insufficient_scope"' }) });
    expect(await send(unnamed)).toMatchObject({ ok: false, code: "step_up_exhausted" });
    expect(unnamed.of("token")).toHaveLength(1);
  });

  it("a challenged scope outside the ceiling is scope_exceeds_row: nothing requested, the count reported, the name never echoed", async () => {
    const world = authWorld({ mcp: () => insufficient("docs:read admin:write files:delete") });
    const result = await send(world);
    expect(result).toMatchObject({ ok: false, code: "scope_exceeds_row", stage: "retry", scopesOutsideRow: 2 });
    expect(JSON.stringify(result)).not.toContain("admin:write");
    expect(world.of("token")).toHaveLength(1);
  });

  it("a 403 with another error is the transport's forbidden, unchanged", async () => {
    const world = authWorld({ mcp: () => plainAnswer(null, 403, { "www-authenticate": 'Bearer error="access_denied"' }) });
    expect(await send(world)).toMatchObject({ ok: false, kind: "forbidden", httpStatus: 403, challenge: { error: "access_denied" }, authorization: { steppedUp: false } });
    expect(world.of("token")).toHaveLength(1);
  });

  it("refresh then step-up is the maximum: exactly 3 POSTs and 2 token requests; step-up then 401 is not refreshed", async () => {
    let answered = 0;
    const world = authWorld({
      prm: readOnlyScopes,
      mcp: (call) => {
        answered += 1;
        if (answered === 2) return challenge401();
        if (answered === 3) return insufficient("docs:search");
        return rpcResult(call, { tools: [] });
      },
    });
    await send(world);
    const before = { mcp: world.of("mcp").length, token: world.of("token").length };
    expect(await send(world)).toMatchObject({ ok: true, authorization: { refreshed: true, steppedUp: true } });
    expect(world.of("mcp").length - before.mcp).toBe(3);
    expect(world.of("token").length - before.token).toBe(2);
    expect(new Set(world.of("mcp").slice(before.mcp).map((call) => call.body.id)).size).toBe(3);
    resetMcpAuthorization();
    answered = 0;
    const stepThen401 = authWorld({ prm: readOnlyScopes, mcp: () => (++answered === 1 ? insufficient("docs:search") : challenge401()) });
    expect(await send(stepThen401)).toMatchObject({ ok: false, kind: "unauthorized", authorization: { steppedUp: true, refreshed: false } });
    expect(stepThen401.of("mcp")).toHaveLength(2);
  });

  it("a failing step-up acquisition returns its code", async () => {
    const world = authWorld({ prm: readOnlyScopes, mcp: () => insufficient("docs:search"), token: (call, self) => (call.form!.get("scope") === "docs:read" ? jsonAnswer(tokenDocument(self.issue())) : jsonAnswer({ error: "invalid_scope" }, 400)) });
    expect(await send(world)).toMatchObject({ ok: false, code: "token_request_refused", oauthError: "invalid_scope" });
  });

  it("an empty ceiling sends no scope, and a 403 on it is scope_exceeds_row; the initial set is scopes_supported ∩ the ceiling, or the probe's challenge scope (LD-4)", async () => {
    const empty = authWorld({ mcp: () => insufficient("docs:read") });
    expect(await send(empty, withAuth({ scopes: [] }))).toMatchObject({ ok: false, code: "scope_exceeds_row", scopesOutsideRow: 1 });
    expect(empty.of("token")[0]!.form!.has("scope")).toBe(false);
    resetMcpAuthorization();
    const intersected = authWorld({ prm: () => jsonAnswer(prmDocument(ccServer.canonicalUri, { scopes_supported: ["docs:search", "other:x"] })) });
    await send(intersected);
    expect(intersected.of("token")[0]!.form!.get("scope")).toBe("docs:search");
    resetMcpAuthorization();
    const challenged = authWorld({ probe: challengeProbe("https://mcp.example.com/.well-known/oauth-protected-resource/mcp", "docs:read") });
    await send(challenged);
    expect(challenged.of("token")[0]!.form!.get("scope")).toBe("docs:read");
    resetMcpAuthorization();
    const beyond = authWorld({ probe: challengeProbe("https://mcp.example.com/.well-known/oauth-protected-resource/mcp", "docs:read admin:all") });
    expect(await send(beyond)).toMatchObject({ ok: false, code: "scope_exceeds_row", scopesOutsideRow: 1 });
    expect(beyond.of("token")).toEqual([]);
  });
});

describe("[B20 A3] the MCP server's breaker (C5, D7)", () => {
  it("a cold cache with an open breaker is authorization_paused with zero authorization requests; so is a half-open trial in flight", async () => {
    requestMcpAdmission(ccServer, undefined, 1, T0);
    recordMcpOutcome(ccServer, "rate_limited", T0);
    const world = authWorld();
    expect(await send(world)).toMatchObject({ ok: false, code: "authorization_paused", stage: "configuration", retryAtMs: T0 + 60_000 });
    expect(world.calls).toEqual([]);
    world.now = T0 + 60_000;
    requestMcpAdmission(ccServer, undefined, 1, T0 + 60_000); // the one half-open trial, still in flight
    expect(await send(world)).toMatchObject({ ok: false, code: "authorization_paused" });
    expect(world.calls).toEqual([]);
  });

  it("a cached token with an open breaker goes to mcpPost: admission_refused with the pause, the same as a none row", async () => {
    const world = authWorld();
    await send(world);
    requestMcpAdmission(ccServer, undefined, 1, T0);
    recordMcpOutcome(ccServer, "rate_limited", T0);
    const cc = await send(world);
    requestMcpAdmission(noneServer, undefined, 1, T0);
    recordMcpOutcome(noneServer, "rate_limited", T0);
    const none = await mcpPostAuthorized(noneServer, listRequest(), { purpose: "interactive", deps: depsOf(fakeMcpServer(byMethod({}))) });
    expect(cc).toMatchObject({ ok: false, kind: "closed", code: "admission_refused", pause: { reason: "breaker_open", retryAtMs: T0 + 60_000 } });
    expect(none).toMatchObject({ ok: false, kind: "closed", code: "admission_refused", pause: { reason: "breaker_open", retryAtMs: T0 + 60_000 } });
    expect(world.of("token")).toHaveLength(1);
  });

  it("ten A3 failures leave the MCP server's admission untouched; a refresh re-send uses one more window slot", async () => {
    const row = ccRow("docs-meter", "meter.example.com", { limits: { ...ccServer.limits, requestsPerMinute: 4 } });
    for (let index = 0; index < 10; index += 1) {
      resetMcpAuthorization();
      expect(await send(authWorld({ token: () => plainAnswer("boom", 500) }), row)).toMatchObject({ code: "token_endpoint_unavailable" });
    }
    expect(previewMcpAdmission(row, undefined, 4, T0)).toBeNull();
    resetMcpAuthorization();
    let answered = 0;
    const world = authWorld({ mcp: (call) => (++answered === 2 ? challenge401() : rpcResult(call, { tools: [] })) });
    await send(world, row);
    await send(world, row);
    expect(previewMcpAdmission(row, undefined, 1, T0)).toBeNull();
    expect(previewMcpAdmission(row, undefined, 2, T0)).toMatchObject({ reason: "quota_exhausted" });
  });
});

describe("[B20 A3] the trace and redactAlso (T3)", () => {
  it("the longest reachable trace — the probe, both PRM fallbacks, three AS candidates, the token, then a step-up — has 8 entries under a cap of 12", async () => {
    const pathed = ccRow("docs-long", "long.example.com");
    const row = withAuth({ scopes: ["docs:read", "docs:search"], authorizationServer: { issuer: "https://auth.example.com/t1", tokenEndpoint: "https://auth.example.com/oauth/token" } }, pathed);
    let answered = 0;
    const world = authWorld({
      probe: bareProbe,
      prm: (call) => (call.path === "/.well-known/oauth-protected-resource" ? jsonAnswer({ resource: "https://long.example.com/mcp", authorization_servers: ["https://auth.example.com/t1"], scopes_supported: ["docs:read"] }) : plainAnswer("nf", 404)),
      as: (call) => (call.path === "/t1/.well-known/openid-configuration" ? jsonAnswer({ issuer: "https://auth.example.com/t1", token_endpoint: "https://auth.example.com/oauth/token", grant_types_supported: ["client_credentials"] }) : plainAnswer("nf", 404)),
      mcp: (call) => (++answered === 1 ? insufficient("docs:search") : rpcResult(call, { tools: [] })),
    });
    const result = await send(world, row);
    const exchanges = (result as unknown as { authorization: { exchanges: Array<{ stage: string }> } }).authorization.exchanges;
    expect(exchanges.map((exchange) => exchange.stage)).toEqual(["probe", "prm", "prm", "as-metadata", "as-metadata", "as-metadata", "token", "token"]);
    expect(exchanges.length).toBeLessThanOrEqual(MCP_AUTH_TRACE_EXCHANGES_MAX);
    expect(MCP_AUTH_TRACE_EXCHANGES_MAX).toBe(12);
  });

  // [B20 A3 review] reviewed pin move, 8 -> 16: a post reads as many `redactAlso` entries as a call's collector can hold
  // (security-2: the collector's subjects now go into every post's list), so no subject of the call can fall off it
  it(`redactAlso reads at most ${MCP_REDACT_ALSO_MAX} entries (a 10^6-length array is not iterated) and skips an oversized, a non-bearer and a non-string entry; absent, the outcome is byte-identical`, async () => {
    expect(MCP_REDACT_ALSO_MAX, "one post's list holds every subject of a call").toBe(MCP_CALL_REDACTION_SUBJECTS_MAX);
    const extra = Array.from({ length: MCP_REDACT_ALSO_MAX + 1 }, (_, index) => `${["fake", "extra", "subject"].join("-")}-${index}x`);
    const echo = (call: { body: { id?: string | number } }): Response => rpcResult(call as Parameters<typeof rpcResult>[0], { content: extra.map((text) => ({ type: "text", text })) });
    let reads = 0;
    const huge = new Proxy(new Array<string>(1_000_000), { get: (target, key, receiver) => { if (typeof key === "string" && /^\d+$/.test(key)) { reads += 1; return extra[Number(key)]; } return Reflect.get(target, key, receiver); } });
    const fake = fakeMcpServer(echo);
    const redacted = await mcpPost(tokenServer, listRequest(), { purpose: "interactive", redactAlso: huge, deps: depsOf(fake) });
    expect(reads).toBeLessThanOrEqual(MCP_REDACT_ALSO_MAX);
    const text = JSON.stringify(redacted);
    for (const subject of extra.slice(0, MCP_REDACT_ALSO_MAX)) expect(text).not.toContain(subject);
    expect(text).toContain(extra[MCP_REDACT_ALSO_MAX]);
    const skipped = await mcpPost(tokenServer, listRequest(), { purpose: "interactive", redactAlso: ["t".repeat(8_193), "not a bearer!", 42 as unknown as string], deps: depsOf(fakeMcpServer(echo)) });
    const absent = await mcpPost(tokenServer, listRequest(), { purpose: "interactive", deps: depsOf(fakeMcpServer(echo)) });
    expect(JSON.stringify(skipped)).toBe(JSON.stringify(absent));
    expect(JSON.stringify(skipped)).not.toContain("not a bearer!");
  });

  it("the token dropped by a refresh, echoed in its exact spelling in a result leaf and key, an error message or a notification, is absent", async () => {
    for (const shape of ["leaf and key", "error message", "notification"] as const) {
      resetMcpAuthorization();
      let answered = 0;
      const world = authWorld({
        mcp: (call, self) => {
          answered += 1;
          if (answered === 2) return challenge401();
          if (answered !== 3) return rpcResult(call, { tools: [] });
          const dropped = self.issued[0]!;
          if (shape === "leaf and key") return rpcResult(call, { tools: [], echo: dropped, [dropped]: "key" });
          if (shape === "error message") return rpcError(call, -32000, `stale ${dropped}`, undefined, 200);
          return sse([JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress", params: { note: dropped } }), JSON.stringify({ jsonrpc: "2.0", id: call.body.id, result: { resultType: "complete", tools: [] } })]);
        },
      });
      await send(world);
      const result = await send(world);
      expect((result as { authorization?: { refreshed: boolean } }).authorization?.refreshed, shape).toBe(true);
      expect(survivor(result, world.issued[0]!), shape).toBeNull();
    }
  });

  // [B20 A3 review] tests-redact-also-priority-untested: no case held more tokens than the list's cap, so the held tokens could
  // have gone first. Seventeen other tokens are held for the row here — more than one post's list can carry beside the one
  // it sends — and the token this call dropped, echoed in the retry's result, must still be redacted: this call's first.
  it(`this call's tokens come first in redactAlso: with ${MCP_REDACT_ALSO_MAX + 1} other tokens held for the row, the token a refresh dropped, echoed in the retry's result, is absent`, async () => {
    const spellings = Array.from({ length: MCP_REDACT_ALSO_MAX + 1 }, (_, index) => `docs:s${index + 1}`);
    let armed = false;
    let answered = 0;
    const world = authWorld({
      prm: () => jsonAnswer(prmDocument(ccServer.canonicalUri, { scopes_supported: [...spellings, ...CEILING] })),
      mcp: (call, self) => {
        if (!armed) return rpcResult(call, { tools: [] });
        answered += 1;
        return answered === 1 ? challenge401() : rpcResult(call, { tools: [], echo: self.issued.at(-2)! });
      },
    });
    // one cached token per spelling of the row (one id, so every one is held for it); four token requests per UTC minute
    for (const [index, scope] of spellings.entries()) {
      world.now = T0 + index * 15_000;
      expect(await send(world, withAuth({ scopes: [scope] })), scope).toMatchObject({ ok: true, authorization: { tokenSource: "fetched", scopes: [scope] } });
    }
    world.now += 60_000;
    expect(await send(world)).toMatchObject({ ok: true, authorization: { tokenSource: "fetched" } });
    const dropped = world.issued.at(-1)!;
    expect(mcpAuthorizationStateCounts().tokens).toBe(MCP_REDACT_ALSO_MAX + 2);
    world.now += 60_000;
    armed = true;
    const result = await send(world);
    expect(result).toMatchObject({ ok: true, kind: "complete", authorization: { refreshed: true } });
    expect(world.issued.at(-2)).toBe(dropped);
    expect(survivor(result, dropped)).toBeNull();
  });

  // [B20 A3 review] security-2: an outcome the client layer hands back UNCHANGED (an error, an unauthorized) was scrubbed only
  // with this post's own list — never with the caller's collector — so a token a walk sent on an earlier page, and no longer
  // held (never cached, evicted, past its skewed expiry), surfaced verbatim. Here page 2's refreshed token lives 30 s (never
  // cached), page 3 acquires a third, and page 3's JSON-RPC error message echoes page 2's token.
  it("a pass-through outcome is scrubbed with the caller's collector: a token an earlier page sent, no longer held, echoed in a later page's error, is absent", async () => {
    const world = authWorld({
      // the second token (page 2's refresh) lives 30 s: used once, never cached, so no longer held when page 3 is answered
      token: (_call, self) => { const token = self.issue(); return jsonAnswer(tokenDocument(token, { expires_in: self.issued.length === 2 ? 30 : 3_600 })); },
      mcp: (call, self) => {
        if (call.body.method === "server/discover") return rpcResult(call, discoverResult());
        const cursor = call.body.params?.cursor;
        if (cursor === undefined) return rpcResult(call, { tools: [tool("a")], nextCursor: "page-2", ttlMs: 0, cacheScope: "private" });
        if (cursor === "page-2") return bearer(call) === self.issued[0] ? challenge401() : rpcResult(call, { tools: [tool("b")], nextCursor: "page-3", ttlMs: 0, cacheScope: "private" });
        return rpcError(call, -32000, `stale credential ${self.issued[1]}`, undefined, 200);
      },
    });
    const negotiated = await discoverMcpServer(ccServer, { purpose: "interactive", deps: world.deps() });
    if (!negotiated.ok) throw new Error("negotiation failed");
    const outcome = await listMcpTools(ccServer, negotiated, { purpose: "interactive", deps: world.deps() });
    expect(outcome).toMatchObject({ ok: false, kind: "error", code: -32000 });
    expect(world.issued).toHaveLength(3);
    expect(mcpAuthorizationTokenProvider.redactionSubjects!(ccServer, ENV), "no longer held for the row").not.toContain(world.issued[1]);
    expect(world.of("mcp").map(bearer)).toContain(world.issued[1]);
    expect(survivor(outcome, world.issued[1]!)).toBeNull();
  });
});

describe("[B20 A3 review] a token the transport could not redact is never sent (regressions-1)", () => {
  // the collector's seed, the provider's held tokens and every redaction list read subjects of at most 8 192 characters; a
  // pre-issued token longer than that was SENT (the transport put no bound on it) and then redacted by no list the A2 layer
  // reads, so an echo in changed case surfaced. The transport now refuses such a token before anything is sent.
  it("a pre-issued token over 8 192 characters is token_malformed with nothing sent, under either provider and at every A2 call site; one of 8 192 is sent and its echo in changed case is replaced whole", async () => {
    // upper-case padding: the server's lower-cased echo is not the exact spelling the transport's own result redaction replaces
    const lengthed = (length: number): string => `${TOKENS[0]}${"Q".repeat(length - TOKENS[0]!.length)}`;
    const echoing = (): ReturnType<typeof fakeMcpServer> => fakeMcpServer(byMethod({
      discover: (call) => rpcResult(call, discoverResult({ instructions: `Use ${(call.headers.Authorization ?? "").slice("Bearer ".length).toLowerCase()} always.` })),
    }));
    for (const provider of [undefined, mcpAuthorizationTokenProvider]) {
      const at = provider === undefined ? "the default provider" : "the A3 provider";
      const long = lengthed(8_193);
      const refusedPost = fakeMcpServer(byMethod({}));
      expect(await mcpPost(tokenServer, listRequest(), { purpose: "interactive", deps: depsOf(refusedPost, long, provider === undefined ? {} : { tokenProvider: provider }) }), at).toMatchObject({ ok: false, kind: "closed", code: "token_malformed" });
      expect(refusedPost.calls, at).toEqual([]);
      const fake = echoing();
      const outcome = await discoverMcpServer(tokenServer, { purpose: "interactive", deps: depsOf(fake, lengthed(9_000), provider === undefined ? {} : { tokenProvider: provider }) });
      expect(outcome, at).toMatchObject({ ok: false, kind: "closed", code: "token_malformed" });
      expect(fake.calls, `${at}: nothing was sent`).toEqual([]);
      expect(survivor(outcome, lengthed(9_000)), at).toBeNull();
      const edge = lengthed(8_192);
      const sent = echoing();
      const negotiated = await discoverMcpServer(tokenServer, { purpose: "interactive", deps: depsOf(sent, edge, provider === undefined ? {} : { tokenProvider: provider }) });
      expect(negotiated, at).toMatchObject({ ok: true, kind: "negotiated" });
      expect(sent.calls, at).toHaveLength(1);
      expect(survivor(negotiated, edge), `${at}: the echo in changed case is replaced whole`).toBeNull();
    }
  });
});

describe("[B20 A3] the A2 call sites on a client-credentials row", () => {
  it("discoverMcpServer negotiates through the authorization client", async () => {
    const world = authWorld();
    const negotiated = await discoverMcpServer(ccServer, { purpose: "interactive", deps: world.deps() });
    expect(negotiated).toMatchObject({ ok: true, kind: "negotiated", negotiatedVersion: "2026-07-28" });
    expect(world.calls.map((call) => call.kind)).toEqual(["probe", "prm", "as", "token", "mcp"]);
  });

  it("listMcpTools: a 401 on page 2, one refresh, and the walk continues", async () => {
    const world = authWorld();
    const negotiated = await discoverMcpServer(ccServer, { purpose: "interactive", deps: world.deps() });
    if (!negotiated.ok) throw new Error("negotiation failed");
    let page2 = 0;
    const listing = authWorld({
      mcp: (call) => {
        if (call.body.params?.cursor === undefined) return rpcResult(call, { tools: [tool("a")], nextCursor: "page-2", ttlMs: 0, cacheScope: "private" });
        return ++page2 === 1 ? challenge401() : rpcResult(call, { tools: [tool("b")], ttlMs: 0, cacheScope: "private" });
      },
    });
    listing.issued.push(...world.issued);
    const outcome = await listMcpTools(ccServer, negotiated, { purpose: "interactive", deps: listing.deps() });
    expect(outcome).toMatchObject({ ok: true, kind: "tools", pages: 2 });
    expect((outcome as unknown as { tools: Array<{ name: string }> }).tools.map((entry) => entry.name)).toEqual(["a", "b"]);
    expect(listing.of("token")).toHaveLength(1);
    expect(listing.of("mcp")).toHaveLength(3);
  });

  it("callMcpTool: a 403 names a scope within the ceiling, one step-up, and the call completes", async () => {
    const world = authWorld({ prm: readOnlyScopes, mcp: (call) => (call.body.method === "tools/call" && world.of("token").length === 1 ? insufficient("docs:search") : byMethod({})(call, 0)) });
    const negotiated = await discoverMcpServer(ccServer, { purpose: "interactive", deps: world.deps() });
    if (!negotiated.ok) throw new Error("negotiation failed");
    const [accepted] = acceptForeignTools(ccServer, [tool("part.search")]).accepted;
    const outcome = await callMcpTool(ccServer, negotiated, accepted!, { mpn: "NE555" }, { purpose: "agent", deps: world.deps() });
    expect(outcome).toMatchObject({ ok: true, kind: "complete", authorization: { steppedUp: true } });
    expect(world.of("token").map((call) => call.form!.get("scope"))).toEqual(["docs:read", "docs:read docs:search"]);
  });
});

describe("[B20 A3] the per-call redaction collector (B5, D12)", () => {
  const upper = (token: string): string => token.toUpperCase();
  /** a token of letters no other gate reads as a word or a credential name, so only the collector can redact its echo */
  const neutralIssue = (world: AuthWorld): string => {
    const token = `qzkvwmbxjrtn${String(world.issued.length + 1).padStart(3, "0")}p`;
    world.issued.push(token);
    return token;
  };
  const acceptedNames = (listing: unknown): string[] => ((listing as { tools?: Array<{ name: string }> }).tools ?? []).map((entry) => entry.name);

  it("(a) a token echoed upper-cased by page 1 is replaced whole in the accepted tools even when the clock passes its ring expiry before the walk ends", async () => {
    let page2 = 0;
    const world = authWorld({
      token: (_call, self) => {
        const first = self.issued.length === 0;
        return jsonAnswer(tokenDocument(neutralIssue(self), { expires_in: first ? 60 : 3_600 }));
      },
      mcp: (call, self) => {
        if (call.body.method === "server/discover") return rpcResult(call, discoverResult());
        if (call.body.params?.cursor === undefined) return rpcResult(call, { tools: [tool("a", { description: `Search. ${upper(self.issued[0]!)}` })], nextCursor: "page-2", ttlMs: 0, cacheScope: "private" });
        if (++page2 === 1) { self.now = T0 + 31_000; return challenge401(); }
        return rpcResult(call, { tools: [tool("b")], ttlMs: 0, cacheScope: "private" });
      },
    });
    const negotiated = await discoverMcpServer(ccServer, { purpose: "interactive", deps: world.deps() });
    if (!negotiated.ok) throw new Error("negotiation failed");
    const listing = await listMcpTools(ccServer, negotiated, { purpose: "interactive", deps: world.deps() });
    expect(listing).toMatchObject({ ok: true, kind: "tools" });
    expect(acceptedNames(listing), "the echoing tool is accepted, its text redacted").toEqual(["a", "b"]);
    expect(survivor(listing, world.issued[0]!)).toBeNull();
    expect(mcpAuthorizationStateCounts().ring).toBe(0);
  });

  it("(b) the same when 64 other keys evict the token's cache entry mid-walk", async () => {
    let evicted = false;
    const world = authWorld({
      token: (_call, self) => jsonAnswer(tokenDocument(neutralIssue(self))),
      mcp: async (call, self) => {
        if (call.body.method === "server/discover") return rpcResult(call, discoverResult());
        if (call.body.params?.cursor === undefined) return rpcResult(call, { tools: [tool("a", { title: `Title ${upper(self.issued[0]!)}` })], nextCursor: "page-2", ttlMs: 0, cacheScope: "private" });
        if (!evicted) {
          evicted = true;
          for (let index = 0; index < 64; index += 1) await mcpPostAuthorized(ccRow(`docs-v${index}`, `v${index}.example.com`), listRequest(), { purpose: "interactive", deps: self.deps() });
        }
        return rpcResult(call, { tools: [tool("b")], ttlMs: 0, cacheScope: "private" });
      },
    });
    const negotiated = await discoverMcpServer(ccServer, { purpose: "interactive", deps: world.deps() });
    if (!negotiated.ok) throw new Error("negotiation failed");
    const listing = await listMcpTools(ccServer, negotiated, { purpose: "interactive", deps: world.deps() });
    expect(listing).toMatchObject({ ok: true, kind: "tools" });
    expect(acceptedNames(listing), "the echoing tool is accepted, its text redacted").toEqual(["a", "b"]);
    expect(mcpAuthorizationTokenProvider.redactionSubjects!(ccServer, ENV)).not.toContain(world.issued[0]);
    expect(survivor(listing, world.issued[0]!)).toBeNull();
  });

  it("A2-retained text carrying the REFRESHED token upper-cased — instructions, a title, a description, a cursor — is replaced whole or refused", async () => {
    let discovered = 0;
    const world = authWorld({
      token: (_call, self) => jsonAnswer(tokenDocument(neutralIssue(self))),
      mcp: (call, self) => {
        const latest = upper(self.issued.at(-1)!);
        if (call.body.method === "server/discover") return ++discovered === 2 ? challenge401() : rpcResult(call, discoverResult({ instructions: `Use ${latest} always.`, _meta: { "io.modelcontextprotocol/serverInfo": { name: latest, version: "1.0" } } }));
        return rpcResult(call, { tools: [] });
      },
    });
    await discoverMcpServer(ccServer, { purpose: "interactive", deps: world.deps() });
    const negotiated = await discoverMcpServer(ccServer, { purpose: "interactive", deps: world.deps() });
    expect(negotiated).toMatchObject({ ok: true });
    expect(world.issued).toHaveLength(2);
    expect(survivor(negotiated, world.issued[1]!)).toBeNull();
    if (!negotiated.ok) throw new Error("negotiation failed");
    let listed = 0;
    const lists = authWorld({
      token: (_call, self) => jsonAnswer(tokenDocument(neutralIssue(self))),
      mcp: (call, self) => {
        const latest = upper(self.issued.at(-1)!);
        if (++listed === 1) return challenge401();
        return rpcResult(call, { tools: [tool("a", { title: `T ${latest}`, description: `D ${latest}` })], ttlMs: 0, cacheScope: "private" });
      },
    });
    lists.issued.push(...world.issued);
    const listing = await listMcpTools(ccServer, negotiated, { purpose: "interactive", deps: lists.deps() });
    expect(listing).toMatchObject({ ok: true, kind: "tools" });
    expect(acceptedNames(listing)).toEqual(["a"]);
    expect(survivor(listing, lists.issued.at(-1)!)).toBeNull();
    let cursored = 0;
    const cursors = authWorld({ token: (_call, self) => jsonAnswer(tokenDocument(neutralIssue(self))), mcp: (call, self) => (++cursored === 1 ? challenge401() : rpcResult(call, { tools: [tool("a")], nextCursor: upper(self.issued.at(-1)!), ttlMs: 0, cacheScope: "private" })) });
    cursors.issued.push(...lists.issued);
    expect(await listMcpTools(ccServer, negotiated, { purpose: "interactive", deps: cursors.deps() })).toMatchObject({ ok: false, code: "cursor_invalid" });
  });

  it(`a collector already holding ${MCP_CALL_REDACTION_SUBJECTS_MAX} subjects is authorization_subjects_exhausted, and nothing is sent`, async () => {
    const seed = Array.from({ length: 8 }, (_, index) => `${["fake", "seed", "subject"].join("-")}-${index}x`);
    const collector = createMcpRedactionCollector(seed);
    const world = authWorld({ token: (_call, self) => jsonAnswer(tokenDocument(self.issue(), { expires_in: 30 })) });
    for (let index = 0; index < 8; index += 1) {
      if (index % 4 === 0) world.now += 60_000;
      expect(await send(world, ccServer, { redaction: collector }), String(index)).toMatchObject({ ok: true });
    }
    expect(collector.subjects()).toHaveLength(MCP_CALL_REDACTION_SUBJECTS_MAX);
    world.now += 60_000;
    const mcpBefore = world.of("mcp").length;
    expect(await send(world, ccServer, { redaction: collector })).toMatchObject({ ok: false, code: "authorization_subjects_exhausted", stage: "retry" });
    expect(world.of("mcp").length).toBe(mcpBefore);
    expect(Object.isFrozen(collector.subjects())).toBe(true);
    // a forged collector counts as absent: the call proceeds and nothing is added to it
    const forged = Object.freeze({ subjects: () => Object.freeze([] as string[]) });
    expect(await send(world, ccServer, { redaction: forged })).toMatchObject({ ok: true });
  });
});
