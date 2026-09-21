/**
 * [B20 A3] The client-credentials token request (RFC 6749 section 4.4.2, RFC 8707): the credentials read by the row's
 * environment NAMES at the start of every acquisition and held only in its local scope, the exact form body with the
 * canonical URI as `resource`, the client authentication LD-2 chose, the pinned token endpoint alone receiving the secret,
 * no redirect, bounded bodies, and a strict parse of the answer — a Bearer token of the b64token alphabet that carries the
 * secret in no spelling (D15), a safe-integer lifetime, a scope within the row's ceiling. A refused token is never cached
 * and never sent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAdmissionControl } from "../../acquisition/admission-control";
import { MCP_ACCESS_TOKEN_MAX_CHARS, mcpAuthorizationStateCarries, mcpPostAuthorized, resetMcpAuthorization } from "../authorization";
import { resetMcpInFlight } from "../http-transport";
import { fullwidth, ZERO_WIDTH_JOINER } from "./_fake-mcp-server";
import {
  asDocument, authWorld, B64_SECRET, B64_SECRET_ENV, basicCredential, ccRow, ccServer, ccServerB64, ccServerSlash, ccServerSpace, CLIENT_ID, CLIENT_ID_ENV, CLIENT_SECRET, CLIENT_SECRET_ENV, ENV, formenc, hang, jsonAnswer, listRequest, MARKER,
  plainAnswer, REFRESH_TOKEN, SLASH_SECRET, SPACE_SECRET, tokenDocument, trafficTo, type AuthHandler, type AuthWorld,
} from "./_fake-authorization-server";

const send = (world: AuthWorld, server = ccServer, extra: Record<string, unknown> = {}) => mcpPostAuthorized(server, listRequest(), { purpose: "interactive", deps: world.deps(extra), });
const answer = (value: unknown, status = 200, headers: Record<string, string> = {}): AuthHandler => () => jsonAnswer(value, status, headers);
const TOKEN = `${["fake", "access", "token"].join("-")}-fixed0001x`;
const spellings = (id: string, secret: string): string[] => [secret, formenc(secret), basicCredential(id, secret)];
const leaks = (value: unknown): string[] => [MARKER, CLIENT_SECRET, formenc(CLIENT_SECRET), B64_SECRET, REFRESH_TOKEN].filter((planted) => JSON.stringify(value).includes(planted));

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

describe("[B20 A3] the request bytes", () => {
  it("the exact form body: grant_type, the canonical URI as resource, and the scope sorted and space-joined — no scope parameter for an empty set", async () => {
    const world = authWorld();
    await send(world);
    const [request] = world.of("token");
    expect(request!.httpMethod).toBe("POST");
    expect(request!.url).toBe("https://auth.example.com/oauth/token");
    expect(request!.raw).toBe(`grant_type=client_credentials&resource=${formenc("https://mcp.example.com/mcp")}&scope=${formenc("docs:read docs:search")}`);
    expect(request!.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(request!.headers.Accept).toBe("application/json");
    resetMcpAuthorization();
    const empty = authWorld({ prm: (call) => jsonAnswer({ resource: "https://mcp.example.com/mcp", authorization_servers: ["https://auth.example.com"], scopes_supported: ["other:scope"], url: call.url }) });
    await send(empty);
    expect(empty.of("token")[0]!.raw).toBe(`grant_type=client_credentials&resource=${formenc("https://mcp.example.com/mcp")}`);
  });

  it("the exact Basic header for the special-character secret (id and secret form-encoded, RFC 6749 section 2.3.1); the post form carries both in the body instead", async () => {
    const world = authWorld();
    await send(world);
    const [basic] = world.of("token");
    expect(basic!.headers.Authorization).toBe(`Basic ${basicCredential(CLIENT_ID, CLIENT_SECRET)}`);
    expect(atob(basic!.headers.Authorization!.slice("Basic ".length))).toBe(`${formenc(CLIENT_ID)}:${formenc(CLIENT_SECRET)}`);
    expect(basic!.form!.has("client_secret")).toBe(false);
    resetMcpAuthorization();
    const post = authWorld({ as: (call) => (call.path.endsWith("oauth-authorization-server") ? jsonAnswer(asDocument({ token_endpoint_auth_methods_supported: ["client_secret_post"] })) : plainAnswer("nf", 404)) });
    await send(post);
    const [form] = post.of("token");
    expect(Object.keys(form!.headers).map((name) => name.toLowerCase())).not.toContain("authorization");
    expect(form!.raw.endsWith(`&client_id=${formenc(CLIENT_ID)}&client_secret=${formenc(CLIENT_SECRET)}`)).toBe(true);
    expect(form!.form!.get("client_secret")).toBe(CLIENT_SECRET);
  });

  it("the secret — raw, form-encoded or as the Basic credential — appears only in the token request and never in any URL", async () => {
    const world = authWorld();
    await send(world);
    for (const call of world.calls) {
      for (const spelling of spellings(CLIENT_ID, CLIENT_SECRET)) {
        expect(call.url.includes(spelling) || call.url.includes(encodeURIComponent(spelling)), call.url).toBe(false);
        if (call.kind !== "token") expect(JSON.stringify(call.headers) + call.raw, call.kind).not.toContain(spelling);
      }
    }
    expect(world.of("token")).toHaveLength(1);
  });
});

describe("[B20 A3] the environment is read by NAME before anything is sent", () => {
  it("unset, empty, a control character, non-ASCII, a 513-character secret and a 257-character id: the code applies, only the NAME appears, and nothing is sent", async () => {
    const rows: Array<[string, Record<string, string | undefined>, string, string]> = [
      ["the id unset", { [CLIENT_ID_ENV]: undefined }, "client_credentials_unavailable", CLIENT_ID_ENV],
      ["the secret unset", { [CLIENT_SECRET_ENV]: undefined }, "client_credentials_unavailable", CLIENT_SECRET_ENV],
      ["the secret empty", { [CLIENT_SECRET_ENV]: "" }, "client_credentials_unavailable", CLIENT_SECRET_ENV],
      ["a control character", { [CLIENT_SECRET_ENV]: `${CLIENT_SECRET}${String.fromCharCode(10)}` }, "client_credentials_malformed", CLIENT_SECRET_ENV],
      ["non-ASCII", { [CLIENT_SECRET_ENV]: `${CLIENT_SECRET}${String.fromCharCode(233)}` }, "client_credentials_malformed", CLIENT_SECRET_ENV],
      ["a 513-character secret", { [CLIENT_SECRET_ENV]: `${CLIENT_SECRET}${"s".repeat(513 - CLIENT_SECRET.length)}` }, "client_credentials_malformed", CLIENT_SECRET_ENV],
      ["a 257-character id", { [CLIENT_ID_ENV]: "i".repeat(257) }, "client_credentials_malformed", CLIENT_ID_ENV],
    ];
    for (const [label, change, code, name] of rows) {
      resetMcpAuthorization();
      const world = authWorld();
      const environment: Record<string, string | undefined> = { ...ENV, ...change };
      for (const key of Object.keys(environment)) if (environment[key] === undefined) delete environment[key];
      const result = await mcpPostAuthorized(ccServer, listRequest(), { purpose: "interactive", deps: world.deps({ environment }) });
      expect(result, label).toMatchObject({ ok: false, kind: "closed", code, stage: "configuration" });
      expect((result as { message: string }).message, label).toContain(name);
      expect(world.calls, label).toEqual([]);
      expect(leaks(result), label).toEqual([]);
      if (label === "a 257-character id") expect(JSON.stringify(result)).not.toContain("i".repeat(257));
    }
  });

  it("an inherited name is no value: the environment is read by own property only", async () => {
    const world = authWorld();
    const environment = Object.create({ [CLIENT_SECRET_ENV]: CLIENT_SECRET }) as Record<string, string>;
    environment[CLIENT_ID_ENV] = CLIENT_ID;
    expect(await mcpPostAuthorized(ccServer, listRequest(), { purpose: "interactive", deps: world.deps({ environment }) })).toMatchObject({ ok: false, code: "client_credentials_unavailable" });
    expect(world.calls).toEqual([]);
  });
});

describe("[B20 A3] redirects and error answers of the token endpoint", () => {
  it("each of 301, 302, 303, 307 and 308 is token_endpoint_redirect after ONE POST; the Location host is never contacted and the secret is sent once", async () => {
    for (const status of [301, 302, 303, 307, 308]) {
      resetMcpAuthorization();
      const world = authWorld({ token: () => plainAnswer(null, status, { location: "https://evil.example.net/token" }) });
      expect(await send(world), String(status)).toMatchObject({ ok: false, code: "token_endpoint_redirect", stage: "token", httpStatus: status });
      expect(world.of("token"), String(status)).toHaveLength(1);
      expect(trafficTo(world, "evil.example.net")).toBe("[]");
      expect(world.of("mcp")).toEqual([]);
    }
  });

  it("each RFC 6749 error code and invalid_target maps to its oauthError; a 401 with WWW-Authenticate: Basic is token_request_refused", async () => {
    for (const error of ["invalid_request", "invalid_client", "invalid_grant", "unauthorized_client", "unsupported_grant_type", "invalid_scope", "invalid_target"]) {
      resetMcpAuthorization();
      const world = authWorld({ token: answer({ error, error_description: MARKER }, 400) });
      expect(await send(world), error).toMatchObject({ ok: false, code: "token_request_refused", stage: "token", oauthError: error, httpStatus: 400 });
    }
    resetMcpAuthorization();
    const basic = authWorld({ token: answer({ error: "invalid_client" }, 401, { "www-authenticate": 'Basic realm="token"' }) });
    expect(await send(basic)).toMatchObject({ ok: false, code: "token_request_refused", oauthError: "invalid_client", httpStatus: 401 });
  });

  it("unknown text, the secret as error, a 100 000-character description, an error_uri, a text/html 400 and a JSON 400 over 16 KiB are all oauthError other, and nothing is echoed", async () => {
    const bodies: Array<[string, AuthHandler]> = [
      ["unknown text", answer({ error: "server_on_fire" }, 400)],
      ["the secret as error", answer({ error: CLIENT_SECRET }, 400)],
      ["a 100 000-character description", answer({ error: "other", error_description: MARKER.repeat(6_000) }, 400)],
      ["an error_uri", answer({ error: "nope", error_uri: `https://evil.example.net/${MARKER}` }, 400)],
      ["a text/html 400", () => plainAnswer(`<p>${MARKER}</p>`, 400, { "content-type": "text/html" })],
      ["a JSON 400 over 16 KiB", answer({ error: "invalid_client", pad: "p".repeat(17_000) }, 400)],
    ];
    for (const [label, handler] of bodies) {
      resetMcpAuthorization();
      const result = await send(authWorld({ token: handler }));
      expect(result, label).toMatchObject({ ok: false, code: "token_request_refused", oauthError: "other" });
      expect(leaks(result), label).toEqual([]);
      expect(JSON.stringify(result), label).not.toContain("server_on_fire");
    }
  });

  it("429, 500, 503, 204 and 418 are token_endpoint_unavailable, as are a network error, a hang and a private address", async () => {
    for (const status of [429, 500, 503, 204, 418]) {
      resetMcpAuthorization();
      const world = authWorld({ token: () => plainAnswer(status === 204 ? null : "no", status) });
      expect(await send(world), String(status)).toMatchObject({ ok: false, code: "token_endpoint_unavailable", stage: "token" });
    }
    resetMcpAuthorization();
    expect(await send(authWorld({ token: () => { throw new Error(`reset ${MARKER}`); } }))).toMatchObject({ ok: false, code: "token_endpoint_unavailable", egressCode: "network_error" });
    resetMcpAuthorization();
    const slow = ccRow("docs-slow", "slow.example.com", { limits: { ...ccServer.limits, deadlineMs: 1_000 } });
    expect(await send(authWorld({ token: hang }), slow)).toMatchObject({ ok: false, code: "token_endpoint_unavailable", egressCode: "timeout" });
    resetMcpAuthorization();
    // a token endpoint on its own host, which resolves to a private address: refused at the egress boundary, never reached
    const elsewhere = ccRow("docs-elsewhere", "elsewhere.example.com");
    const pinned = { ...elsewhere, auth: { ...elsewhere.auth, authorizationServer: { issuer: "https://auth.example.com", tokenEndpoint: "https://tokens.example.org/oauth/token" } } };
    const privateTokens = authWorld({
      resolve: async (host) => (host === "tokens.example.org" ? ["192.168.1.10"] : ["93.184.216.34"]),
      as: (call) => (call.path.endsWith("oauth-authorization-server") ? jsonAnswer(asDocument({ token_endpoint: "https://tokens.example.org/oauth/token" })) : plainAnswer("nf", 404)),
    });
    const blocked = await send(privateTokens, pinned);
    expect(blocked).toMatchObject({ ok: false, code: "token_endpoint_unavailable", egressCode: "address_blocked" });
    expect(JSON.stringify(blocked)).not.toContain("192.168");
    expect(privateTokens.of("token")).toEqual([]);
  }, 15_000);
});

describe("[B20 A3] parsing a 200", () => {
  it("token_type Bearer, bearer and BEARER are accepted; DPoP, mac, N_A, absent and a number are token_type_unsupported", async () => {
    for (const type of ["Bearer", "bearer", "BEARER"]) {
      resetMcpAuthorization();
      expect(await send(authWorld({ token: answer(tokenDocument(TOKEN, { token_type: type })) })), type).toMatchObject({ ok: true, kind: "complete" });
    }
    for (const type of ["DPoP", "mac", "N_A", undefined, 1, "b".repeat(33)]) {
      resetMcpAuthorization();
      const world = authWorld({ token: answer(tokenDocument(TOKEN, { token_type: type })) });
      expect(await send(world), String(type)).toMatchObject({ ok: false, code: "token_type_unsupported", stage: "token" });
      expect(world.of("mcp")).toEqual([]);
    }
  });

  it("access_token structural rows are token_response_invalid with zero MCP requests; 8 192 characters are accepted", async () => {
    const rows: Array<[string, unknown]> = [
      ["absent", undefined], ["empty", ""], ["a number", 12_345], ["an object", { token: TOKEN }], ["a control character", `${TOKEN}${String.fromCharCode(10)}`],
      ["a space", `${TOKEN} x`], ["quoted", `"${TOKEN}"`], ["Bearer x", `Bearer ${TOKEN}`], ["non-ASCII", `${TOKEN}${String.fromCharCode(233)}`],
      ["8 193 characters", "t".repeat(MCP_ACCESS_TOKEN_MAX_CHARS + 1)], ["digits only", "12345678901234567890"], ["fullwidth", fullwidth(TOKEN)], ["a zero-width joiner inside", `${TOKEN.slice(0, 8)}${ZERO_WIDTH_JOINER}${TOKEN.slice(8)}`],
    ];
    for (const [label, token] of rows) {
      resetMcpAuthorization();
      const world = authWorld({ token: answer(tokenDocument("placeholder-token-00x", { access_token: token })) });
      const result = await send(world);
      expect(result, label).toMatchObject({ ok: false, code: "token_response_invalid", stage: "token" });
      expect(world.of("mcp"), label).toEqual([]);
    }
    resetMcpAuthorization();
    const long = authWorld({ token: answer(tokenDocument("t".repeat(MCP_ACCESS_TOKEN_MAX_CHARS))) });
    expect(await send(long)).toMatchObject({ ok: true, kind: "complete" });
    expect(long.of("mcp")[0]!.headers.Authorization).toBe(`Bearer ${"t".repeat(MCP_ACCESS_TOKEN_MAX_CHARS)}`);
  });

  it("B2: on ccServerB64 a token equal to the secret, containing it, or the secret upper-cased passes isBearerToken and is refused ONLY by the secret check", async () => {
    for (const [label, token] of [["equal", B64_SECRET], ["containing", `pre${B64_SECRET}post`], ["upper-cased", B64_SECRET.toUpperCase()]] as const) {
      resetMcpAuthorization();
      expect(/^[A-Za-z0-9._~+/-]+=*$/.test(token), `${label} is b64token-shaped`).toBe(true);
      const world = authWorld({ token: answer(tokenDocument(token)) });
      const result = await send(world, ccServerB64);
      expect(result, label).toMatchObject({ ok: false, code: "token_response_invalid" });
      expect(world.of("mcp"), label).toEqual([]);
      expect(JSON.stringify(result)).not.toContain(B64_SECRET);
      expect(mcpAuthorizationStateCarries(B64_SECRET)).toBe(false);
    }
  });

  it("D15: a token equal to or containing the Basic credential, or that value upper-cased, is refused on both rows — the secret never reaches the MCP server", async () => {
    for (const [row, secret, env] of [[ccServer, CLIENT_SECRET, CLIENT_SECRET_ENV], [ccServerB64, B64_SECRET, B64_SECRET_ENV]] as const) {
      const credential = basicCredential(CLIENT_ID, secret);
      for (const token of [credential, `x${credential}y`, credential.toUpperCase()]) {
        resetMcpAuthorization();
        const world = authWorld({ token: answer(tokenDocument(token)) });
        expect(await send(world, row), `${env} ${token.slice(0, 12)}`).toMatchObject({ ok: false, code: "token_response_invalid" });
        expect(world.of("mcp")).toEqual([]);
      }
    }
  });

  // [B20 A3 review] tests-d15-formenc-spelling-untested: on ccServerB64 the raw and the form-encoded spelling are one string,
  // and the special-character secret's spellings are no b64token, so no case told the two checks apart. Each row below
  // isolates ONE spelling — the token is a b64token and carries neither other spelling — so dropping either check fails it.
  it("D15, one spelling at a time: a token carrying only the form-encoded secret (a space as '+') or only the raw secret (a b64token whose form encoding is not) is refused by that check alone", async () => {
    const b64token = /^[A-Za-z0-9._~+/-]+=*$/;
    const rows = [["the form-encoded spelling", ccServerSpace, SPACE_SECRET, formenc(SPACE_SECRET)], ["the raw spelling", ccServerSlash, SLASH_SECRET, SLASH_SECRET]] as const;
    for (const [label, row, secret, spelling] of rows) {
      for (const token of [spelling, `pre${spelling}post`, spelling.toUpperCase()]) {
        expect(b64token.test(token), `${label}: ${token} is b64token-shaped`).toBe(true);
        for (const other of spellings(CLIENT_ID, secret).filter((entry) => entry !== spelling)) expect(token.toLowerCase().includes(other.toLowerCase()), `${label}: carries no other spelling`).toBe(false);
        resetMcpAuthorization();
        const world = authWorld({ token: answer(tokenDocument(token)) });
        expect(await send(world, row), `${label}: ${token}`).toMatchObject({ ok: false, code: "token_response_invalid", stage: "token" });
        expect(world.of("mcp"), label).toEqual([]);
        expect(mcpAuthorizationStateCarries(token), label).toBe(false);
      }
    }
  });

  it("expires_in: absent (300 s), 1, 3 600, 7 200 and MAX_SAFE_INTEGER are accepted; MAX_SAFE_INTEGER+1, 1e300, 1e400, 0, -1, 1.5, \"3600\", null, true and a literal NaN are token_response_invalid", async () => {
    for (const lifetime of [undefined, 1, 3_600, 7_200, Number.MAX_SAFE_INTEGER]) {
      resetMcpAuthorization();
      expect(await send(authWorld({ token: answer(tokenDocument(TOKEN, { expires_in: lifetime })) })), String(lifetime)).toMatchObject({ ok: true, kind: "complete" });
    }
    const raw = (literal: string): AuthHandler => () => jsonAnswer(`{"access_token":"${TOKEN}","token_type":"Bearer","expires_in":${literal}}`);
    for (const [label, handler] of [
      ["MAX_SAFE_INTEGER+1", raw("9007199254740992")], ["1e300", raw("1e300")], ["1e400", raw("1e400")], ["0", raw("0")], ["-1", raw("-1")], ["1.5", raw("1.5")],
      ["a string", raw('"3600"')], ["null", raw("null")], ["true", raw("true")], ["a literal NaN", raw("NaN")],
    ] as const) {
      resetMcpAuthorization();
      const world = authWorld({ token: handler });
      expect(await send(world), label).toMatchObject({ ok: false, code: "token_response_invalid" });
      expect(world.of("mcp"), label).toEqual([]);
    }
  });

  it("scope: absent, empty, a subset and the requested set are accepted; a superset beyond the row is token_scope_exceeds_row, not cached and not sent; malformed strings are token_response_invalid", async () => {
    for (const scope of [undefined, "", "docs:read", "docs:search docs:read"]) {
      resetMcpAuthorization();
      expect(await send(authWorld({ token: answer(tokenDocument(TOKEN, { scope })) })), String(scope)).toMatchObject({ ok: true, kind: "complete" });
    }
    resetMcpAuthorization();
    const beyond = authWorld({ token: answer(tokenDocument(TOKEN, { scope: "docs:read docs:admin files:write" })) });
    const refused = await send(beyond);
    expect(refused).toMatchObject({ ok: false, code: "token_scope_exceeds_row", stage: "token", scopesOutsideRow: 2 });
    expect(JSON.stringify(refused)).not.toContain("docs:admin");
    expect(beyond.of("mcp")).toEqual([]);
    expect(mcpAuthorizationStateCarries(TOKEN)).toBe(false);
    for (const [label, scope] of [["a double space", "docs:read  docs:search"], ["a leading space", " docs:read"], ["33 tokens", Array.from({ length: 33 }, () => "docs:read").join(" ")], ["4 097 characters", "s".repeat(4_097)], ["a control character", `docs:read${String.fromCharCode(9)}docs:search`], ["not a string", ["docs:read"]]] as const) {
      resetMcpAuthorization();
      expect(await send(authWorld({ token: answer(tokenDocument(TOKEN, { scope })) })), label).toMatchObject({ ok: false, code: "token_response_invalid" });
    }
  });

  it("refresh_token and id_token are ignored and never stored; 32 769 bytes, a JSON array and __proto__ are refused or inert", async () => {
    const world = authWorld({ token: answer(tokenDocument(TOKEN)) });
    expect(await send(world)).toMatchObject({ ok: true, kind: "complete" });
    expect(mcpAuthorizationStateCarries(TOKEN)).toBe(true);
    expect(mcpAuthorizationStateCarries(REFRESH_TOKEN)).toBe(false);
    expect(mcpAuthorizationStateCarries(`${MARKER}-long-enough`)).toBe(false);
    resetMcpAuthorization();
    const base = JSON.stringify(tokenDocument(TOKEN, { pad: "" }));
    expect(await send(authWorld({ token: () => jsonAnswer(JSON.stringify(tokenDocument(TOKEN, { pad: "p".repeat(32_769 - base.length) }))) }))).toMatchObject({ ok: false, code: "token_endpoint_unavailable", egressCode: "response_too_large" });
    resetMcpAuthorization();
    expect(await send(authWorld({ token: () => jsonAnswer([tokenDocument(TOKEN)]) }))).toMatchObject({ ok: false, code: "token_response_invalid" });
    resetMcpAuthorization();
    const polluting = `{"__proto__":{"access_token":"${TOKEN}","polluted":true},"token_type":"Bearer"}`;
    expect(await send(authWorld({ token: () => jsonAnswer(polluting) }))).toMatchObject({ ok: false, code: "token_response_invalid" });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("T6: with a clock that advances during the exchange, the expiry is computed from the tick read immediately before the token request", async () => {
    const world = authWorld({ token: (_call, self) => { self.now += 120_000; return jsonAnswer(tokenDocument(TOKEN, { expires_in: 3_600 })); } });
    const start = world.now;
    expect(await send(world)).toMatchObject({ ok: true, kind: "complete" });
    // obtained at `start` (the clock moved only inside the exchange): valid until start + 3 600 000 - 30 000
    world.now = start + 3_569_999;
    await send(world);
    expect(world.of("token")).toHaveLength(1);
    world.now = start + 3_570_000;
    await send(world);
    expect(world.of("token")).toHaveLength(2);
  });
});
