/**
 * [B20 A3] Audience, replay and passthrough (the names `discovery.md` gives the A3 suites: "wrong audience", "replayed
 * token", "passthrough attempt refused"; "scope step-up bounded" is in b20-a3-authorized-post). The client cannot read an
 * opaque token's audience (D8): it binds the audience by sending `resource` = the canonical URI on every token request,
 * by refusing protected-resource metadata that names another resource, and by sending a token to exactly the canonical URI
 * it was requested for. A token is never replayed across rows, never re-sent from the dropped-token ring, and a string a
 * server hands back is never used as a credential.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAdmissionControl } from "../../acquisition/admission-control";
import { mcpPostAuthorized, resetMcpAuthorization } from "../authorization";
import { resetMcpInFlight } from "../http-transport";
import { rpcError, rpcResult, TOKEN_ENV, TOKENS } from "./_fake-mcp-server";
import {
  asDocument, authWorld, basicCredential, ccServer, ccServerB64, CLIENT_ID, CLIENT_SECRET, ENV, formenc, jsonAnswer, listRequest, plainAnswer, prmDocument, tokenDocument, type AuthWorld,
} from "./_fake-authorization-server";

const send = (world: AuthWorld, server = ccServer, extra: Record<string, unknown> = {}) => mcpPostAuthorized(server, listRequest(), { purpose: "interactive", deps: world.deps(), ...extra });
const tokenOf = (authorization: string | undefined): string => (authorization ?? "").replace(/^Bearer /, "");
const wire = (world: AuthWorld, kinds: readonly string[]): string => JSON.stringify(world.calls.filter((call) => kinds.includes(call.kind)).map((call) => ({ url: call.url, headers: call.headers, raw: call.raw })));
/** a bearer-shaped string a hostile server hands back, hoping it will be sent somewhere as a credential */
const FOREIGN = `${["foreign", "bearer", "token"].join("-")}-000001`;

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

describe("[B20 A3] wrong audience", () => {
  it("resource is the canonical URI on the initial, the refresh and the step-up token requests", async () => {
    let answered = 0;
    const world = authWorld({
      prm: () => jsonAnswer(prmDocument(ccServer.canonicalUri, { scopes_supported: ["docs:read"] })),
      mcp: (call) => {
        answered += 1;
        if (answered === 2) return plainAnswer(null, 401, { "www-authenticate": "Bearer" });
        if (answered === 3) return plainAnswer(null, 403, { "www-authenticate": 'Bearer error="insufficient_scope", scope="docs:search"' });
        return rpcResult(call, { tools: [] });
      },
    });
    await send(world);
    expect(await send(world)).toMatchObject({ ok: true, authorization: { refreshed: true, steppedUp: true } });
    expect(world.of("token").map((call) => call.form!.getAll("resource"))).toEqual([[ccServer.canonicalUri], [ccServer.canonicalUri], [ccServer.canonicalUri]]);
  });

  it("protected-resource metadata naming another server is refused before anything reaches the issuer", async () => {
    const world = authWorld({ prm: () => jsonAnswer(prmDocument(ccServerB64.canonicalUri)) });
    expect(await send(world)).toMatchObject({ ok: false, code: "prm_resource_mismatch" });
    expect(world.of("as")).toEqual([]);
    expect(world.of("token")).toEqual([]);
  });

  it("a JWT-shaped token with a foreign aud is sent as it is: the client never decodes a token (D8)", async () => {
    const segment = (value: unknown): string => btoa(JSON.stringify(value)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
    const jwt = `${segment({ alg: "RS256", typ: "JWT" })}.${segment({ aud: "https://other.example.com/mcp", sub: "fixture" })}.${"s".repeat(43)}`;
    const world = authWorld({ token: () => jsonAnswer(tokenDocument(jwt)) });
    expect(await send(world)).toMatchObject({ ok: true, kind: "complete" });
    expect(world.of("mcp")[0]!.headers.Authorization).toBe(`Bearer ${jwt}`);
  });

  it("a server that answers 401 to every token: two POSTs (the cached token, one refresh), then the backoff with nothing sent", async () => {
    let answered = 0;
    const world = authWorld({ mcp: (call) => (++answered === 1 ? rpcResult(call, { tools: [] }) : plainAnswer(null, 401, { "www-authenticate": "Bearer" })) });
    await send(world);
    const before = world.of("mcp").length;
    expect(await send(world)).toMatchObject({ ok: false, kind: "unauthorized", httpStatus: 401, authorization: { refreshed: true } });
    expect(world.of("mcp").length - before).toBe(2);
    const calls = world.calls.length;
    expect(await send(world)).toMatchObject({ ok: false, code: "authorization_backoff" });
    expect(world.calls.length).toBe(calls);
  });
});

describe("[B20 A3] replayed token", () => {
  it("a token of row A is never sent to row B, whichever answers come back", async () => {
    const world = authWorld({ mcp: (call) => (call.host === "b64.example.com" ? plainAnswer(null, 401, { "www-authenticate": "Bearer" }) : rpcResult(call, { tools: [] })) });
    await send(world, ccServer);
    const tokenA = world.issued[0]!;
    await send(world, ccServerB64);
    await send(world, ccServer);
    const toB = world.of("mcp").filter((call) => call.host === "b64.example.com").map((call) => tokenOf(call.headers.Authorization));
    expect(toB.length).toBeGreaterThan(0);
    expect(toB).not.toContain(tokenA);
    expect(world.of("token").filter((call) => call.form!.get("resource") === ccServerB64.canonicalUri).length).toBeGreaterThan(0);
  });

  it("a token dropped after a 401 is never sent again: the ring is a redaction list only", async () => {
    let answered = 0;
    const world = authWorld({
      mcp: (call) => (++answered === 2 ? plainAnswer(null, 401, { "www-authenticate": "Bearer" }) : rpcResult(call, { tools: [] })),
      token: (_call, self) => (self.issued.length === 1 && answered >= 2 && self.calls.filter((c) => c.kind === "token").length === 2 ? plainAnswer("boom", 500) : jsonAnswer(tokenDocument(self.issue()))),
    });
    await send(world);
    const dropped = world.issued[0]!;
    expect(await send(world)).toMatchObject({ ok: false, code: "token_endpoint_unavailable", authorization: { priorExchanges: [expect.objectContaining({ method: "tools/list" })] } });
    world.now += 60_000;
    expect(await send(world)).toMatchObject({ ok: true });
    await send(world);
    const carrying = world.of("mcp").filter((call) => tokenOf(call.headers.Authorization) === dropped);
    expect(carrying).toHaveLength(2); // the call that cached it, and the one refused 401 — never again
  });

  it("a pre-issued row's token in the environment never goes to a client-credentials row", async () => {
    const world = authWorld();
    await mcpPostAuthorized(ccServer, listRequest(), { purpose: "interactive", deps: world.deps({ environment: { ...ENV, [TOKEN_ENV]: TOKENS[0]! } }) });
    expect(wire(world, ["mcp", "probe", "prm", "as", "token"])).not.toContain(TOKENS[0]);
    expect(world.of("mcp")[0]!.headers.Authorization).toBe(`Bearer ${world.issued[0]}`);
  });
});

describe("[B20 A3] passthrough attempt refused", () => {
  it("a bearer-shaped string a server returns — in a result, an error, a challenge, a PRM or an AS field — is never sent as a credential anywhere", async () => {
    let answered = 0;
    const world = authWorld({
      probe: () => plainAnswer(null, 401, { "www-authenticate": `Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp", error_description="${FOREIGN}"` }),
      prm: () => jsonAnswer(prmDocument(ccServer.canonicalUri, { access_token: FOREIGN, token: FOREIGN })),
      as: (call) => (call.path.endsWith("oauth-authorization-server") ? jsonAnswer(asDocument({ access_token: FOREIGN, client_secret: FOREIGN })) : plainAnswer("nf", 404)),
      mcp: (call) => {
        answered += 1;
        if (answered === 1) return rpcResult(call, { tools: [], token: FOREIGN, _meta: { authorization: `Bearer ${FOREIGN}` } });
        if (answered === 2) return rpcError(call, -32603, `use ${FOREIGN}`, { token: FOREIGN }, 200);
        if (answered === 3) return plainAnswer(null, 401, { "www-authenticate": `Bearer error="invalid_token", error_description="${FOREIGN}", scope="${FOREIGN}"` });
        return rpcResult(call, { tools: [] });
      },
    });
    await send(world);
    await send(world);
    await send(world);
    for (const call of world.calls) {
      expect(call.headers.Authorization ?? "", call.kind).not.toContain(FOREIGN);
      expect(call.url + call.raw, call.kind).not.toContain(FOREIGN);
    }
  });

  it("the MCP access token appears only as Authorization: Bearer to the canonical URI — never to the PRM, AS or token hosts, never in a URL", async () => {
    const world = authWorld();
    await send(world);
    await send(world);
    const token = world.issued[0]!;
    for (const call of world.calls) {
      expect(call.url, call.kind).not.toContain(token);
      if (call.kind === "mcp") {
        expect(call.url).toBe(ccServer.canonicalUri);
        expect(call.headers.Authorization).toBe(`Bearer ${token}`);
        expect(call.raw).not.toContain(token);
      } else {
        expect(JSON.stringify(call.headers) + call.raw, call.kind).not.toContain(token);
      }
    }
  });

  it("the client secret never reaches the MCP, PRM or AS hosts, in any spelling", async () => {
    const world = authWorld();
    await send(world);
    const others = wire(world, ["probe", "mcp", "prm", "as"]);
    for (const spelling of [CLIENT_SECRET, formenc(CLIENT_SECRET), basicCredential(CLIENT_ID, CLIENT_SECRET), encodeURIComponent(CLIENT_SECRET)]) expect(others).not.toContain(spelling);
    expect(world.of("token")).toHaveLength(1);
  });
});
