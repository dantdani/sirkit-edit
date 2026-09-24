/**
 * [B20 A3] Authorization-server metadata (RFC 8414, OIDC Discovery) as the client reads it: built ONLY from the PINNED
 * issuer (OD-61), tried in the specification's order, never redirected, bounded, and validated so that the metadata can
 * refuse a row but never widen where Sirkit connects: `issuer` and `token_endpoint` IDENTICAL to the pinned values,
 * `client_credentials` among the grant types (an absent list is RFC 8414's default, which lacks it: D10), and the client
 * authentication chosen by LD-2. Nothing of the document is kept but that choice.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAdmissionControl } from "../../acquisition/admission-control";
import { mcpPostAuthorized, resetMcpAuthorization } from "../authorization";
import { resetMcpInFlight } from "../http-transport";
import { mcpAuthorizationServerMetadataUrls } from "../oauth-discovery";
import {
  asDocument, authWorld, basicCredential, ccRow, ccServer, CLIENT_ID, CLIENT_SECRET, formenc, jsonAnswer, listRequest, MARKER, plainAnswer, trafficTo, type AuthScript, type AuthWorld,
} from "./_fake-authorization-server";

const send = (world: AuthWorld, server = ccServer) => mcpPostAuthorized(server, listRequest(), { purpose: "interactive", deps: world.deps() });
const asAnswer = (overrides: Record<string, unknown>): AuthScript["as"] => (call) => (call.path === "/.well-known/oauth-authorization-server" ? jsonAnswer(asDocument(overrides)) : plainAnswer("not found", 404));
/** the secret in each spelling it could travel in */
const secretSpellings = [CLIENT_SECRET, formenc(CLIENT_SECRET), basicCredential(CLIENT_ID, CLIENT_SECRET)];
const carriesSecret = (world: AuthWorld): boolean => world.calls.some((call) => secretSpellings.some((spelling) => JSON.stringify({ u: call.url, h: call.headers, r: call.raw }).includes(spelling.replace(/"/g, '\\"'))));

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

describe("[B20 A3] the metadata URLs of the pinned issuer (pure)", () => {
  it("an issuer with a path: RFC 8414 path insertion, OIDC path insertion, then OIDC path appending", () => {
    expect(mcpAuthorizationServerMetadataUrls("https://auth.example.com/tenant1")).toEqual([
      "https://auth.example.com/.well-known/oauth-authorization-server/tenant1",
      "https://auth.example.com/.well-known/openid-configuration/tenant1",
      "https://auth.example.com/tenant1/.well-known/openid-configuration",
    ]);
  });

  it("an issuer without a path: the first two only; a terminating slash is removed before inserting; an invalid issuer has none", () => {
    const bare = ["https://auth.example.com/.well-known/oauth-authorization-server", "https://auth.example.com/.well-known/openid-configuration"];
    expect(mcpAuthorizationServerMetadataUrls("https://auth.example.com")).toEqual(bare);
    expect(mcpAuthorizationServerMetadataUrls("https://auth.example.com/")).toEqual(bare);
    expect(mcpAuthorizationServerMetadataUrls("https://auth.example.com/tenant1/")[0]).toBe("https://auth.example.com/.well-known/oauth-authorization-server/tenant1");
    expect(mcpAuthorizationServerMetadataUrls("https://auth.example.com:8443/t")[2]).toBe("https://auth.example.com:8443/t/.well-known/openid-configuration");
    for (const invalid of ["http://auth.example.com", "https://10.0.0.1", "https://auth.example.com/?x", 42]) expect(mcpAuthorizationServerMetadataUrls(invalid as string)).toEqual([]);
  });
});

describe("[B20 A3] the metadata request and the candidate walk", () => {
  it("a 404 moves on; an OIDC document is accepted after the RFC 8414 URL answers 404; a 404 on the last candidate is as_metadata_unavailable; a 500 stops", async () => {
    const oidc = authWorld({ as: (call) => (call.path === "/.well-known/openid-configuration" ? jsonAnswer(asDocument()) : plainAnswer("not found", 404)) });
    expect(await send(oidc)).toMatchObject({ ok: true, kind: "complete" });
    expect(oidc.of("as").map((call) => call.path)).toEqual(["/.well-known/oauth-authorization-server", "/.well-known/openid-configuration"]);
    resetMcpAuthorization();
    const none = authWorld({ as: () => plainAnswer("not found", 404) });
    expect(await send(none)).toMatchObject({ ok: false, code: "as_metadata_unavailable", stage: "as-metadata", httpStatus: 404 });
    expect(none.of("as")).toHaveLength(2);
    expect(none.of("token")).toEqual([]);
    resetMcpAuthorization();
    const stops = authWorld({ as: () => plainAnswer("boom", 500) });
    expect(await send(stops)).toMatchObject({ ok: false, code: "as_metadata_unavailable", httpStatus: 500 });
    expect(stops.of("as")).toHaveLength(1);
  });

  it("an issuer with a path walks all three candidates in order", async () => {
    const pathed = ccRow("docs-tenant", "tenant.example.com", {});
    const row = { ...pathed, auth: { ...pathed.auth, authorizationServer: { issuer: "https://auth.example.com/tenant1", tokenEndpoint: "https://auth.example.com/oauth/token" } } };
    const world = authWorld({
      prm: (call) => jsonAnswer({ resource: "https://tenant.example.com/mcp", authorization_servers: ["https://auth.example.com/tenant1"], planted: MARKER, url: call.url }),
      as: (call) => (call.path === "/tenant1/.well-known/openid-configuration" ? jsonAnswer(asDocument({ issuer: "https://auth.example.com/tenant1" })) : plainAnswer("not found", 404)),
    });
    expect(await send(world, row)).toMatchObject({ ok: true, kind: "complete" });
    expect(world.of("as").map((call) => call.path)).toEqual(["/.well-known/oauth-authorization-server/tenant1", "/.well-known/openid-configuration/tenant1", "/tenant1/.well-known/openid-configuration"]);
  });

  it("is a GET with Accept: application/json only and no credential; a redirect is one request; 65 537 bytes are as_metadata_too_large", async () => {
    const world = authWorld();
    await send(world);
    const [request] = world.of("as");
    expect(request!.httpMethod).toBe("GET");
    expect(request!.headers).toEqual({ Accept: "application/json" });
    resetMcpAuthorization();
    const redirected = authWorld({ as: () => plainAnswer(null, 302, { location: "https://evil.example.net/meta" }) });
    expect(await send(redirected)).toMatchObject({ ok: false, code: "as_metadata_unavailable", httpStatus: 302 });
    expect(redirected.of("as")).toHaveLength(1);
    expect(trafficTo(redirected, "evil.example.net")).toBe("[]");
    resetMcpAuthorization();
    const base = JSON.stringify(asDocument({ pad: "" }));
    const big = authWorld({ as: () => jsonAnswer(JSON.stringify(asDocument({ pad: "p".repeat(65_537 - base.length) }))) });
    expect(await send(big)).toMatchObject({ ok: false, code: "as_metadata_too_large", stage: "as-metadata" });
    resetMcpAuthorization();
    expect(await send(authWorld({ as: () => jsonAnswer("[1,2]") }))).toMatchObject({ ok: false, code: "as_metadata_invalid" });
  });
});

describe("[B20 A3] issuer and token endpoint are identical to the pinned values (OD-61, RFC 8414 section 3.3)", () => {
  it("as_issuer_mismatch for a trailing slash, a case variant, http, another host and another path: it STOPS, and the secret is never sent", async () => {
    for (const issuer of ["https://auth.example.com/", "https://AUTH.example.com", "http://auth.example.com", "https://login.example.org", "https://auth.example.com/other"]) {
      resetMcpAuthorization();
      const world = authWorld({ as: () => jsonAnswer(asDocument({ issuer })) });
      expect(await send(world), issuer).toMatchObject({ ok: false, code: "as_issuer_mismatch", stage: "as-metadata" });
      expect(world.of("as"), `${issuer}: an issuer mismatch stops the walk`).toHaveLength(1);
      expect(world.of("token")).toEqual([]);
      expect(carriesSecret(world)).toBe(false);
    }
    for (const issuer of [undefined, 42, null, ["https://auth.example.com"]]) {
      resetMcpAuthorization();
      const world = authWorld({ as: asAnswer({ issuer }) });
      expect(await send(world), JSON.stringify(issuer) ?? "absent").toMatchObject({ ok: false, code: "as_metadata_invalid" });
      expect(world.of("token")).toEqual([]);
    }
  });

  it("as_token_endpoint_mismatch for another host, another path, a query appended, http and absent — the named host is never contacted", async () => {
    for (const endpoint of ["https://evil.example.net/oauth/token", "https://auth.example.com/oauth/other", "https://auth.example.com/oauth/token?x=1", "http://auth.example.com/oauth/token", undefined]) {
      resetMcpAuthorization();
      const world = authWorld({ as: asAnswer({ token_endpoint: endpoint }) });
      const result = await send(world);
      expect(result, String(endpoint)).toMatchObject({ ok: false, code: "as_token_endpoint_mismatch", stage: "as-metadata" });
      expect(world.of("token")).toEqual([]);
      expect(trafficTo(world, "evil.example.net")).toBe("[]");
      expect(JSON.stringify(result)).not.toContain("evil.example.net");
      expect(carriesSecret(world)).toBe(false);
    }
  });
});

describe("[B20 A3] grant types (D10) and client authentication (LD-2)", () => {
  it("grant_types_supported: absent is as_grant_unsupported with zero token requests; client_credentials accepted; authorization_code alone refused; 33 entries or 129 characters invalid", async () => {
    const outcome = async (grants: unknown): Promise<{ result: unknown; tokens: number }> => {
      resetMcpAuthorization();
      const world = authWorld({ as: asAnswer({ grant_types_supported: grants }) });
      const result = await send(world);
      return { result, tokens: world.of("token").length };
    };
    expect(await outcome(undefined)).toMatchObject({ result: { ok: false, code: "as_grant_unsupported" }, tokens: 0 });
    expect(await outcome(["client_credentials"])).toMatchObject({ result: { ok: true, kind: "complete" }, tokens: 1 });
    expect(await outcome(["authorization_code", "client_credentials"])).toMatchObject({ result: { ok: true }, tokens: 1 });
    expect(await outcome(["authorization_code"])).toMatchObject({ result: { ok: false, code: "as_grant_unsupported" }, tokens: 0 });
    expect(await outcome(Array.from({ length: 33 }, () => "client_credentials"))).toMatchObject({ result: { ok: false, code: "as_metadata_invalid" }, tokens: 0 });
    expect(await outcome(["client_credentials", "g".repeat(129)])).toMatchObject({ result: { ok: false, code: "as_metadata_invalid" }, tokens: 0 });
    expect(await outcome("client_credentials")).toMatchObject({ result: { ok: false, code: "as_metadata_invalid" }, tokens: 0 });
  });

  it("client authentication: absent is basic; post-only is post; both is basic; private_key_jwt or none alone refused; 33 entries invalid", async () => {
    const chosen = async (methods: unknown): Promise<string> => {
      resetMcpAuthorization();
      const world = authWorld({ as: asAnswer({ token_endpoint_auth_methods_supported: methods }) });
      const result = (await send(world)) as { ok: boolean; code?: string };
      if (!result.ok) return result.code ?? "?";
      const [token] = world.of("token");
      const basic = Object.keys(token!.headers).some((name) => name.toLowerCase() === "authorization");
      const post = token!.form!.has("client_secret");
      return basic && !post ? "basic" : post && !basic ? "post" : "both?";
    };
    expect(await chosen(undefined)).toBe("basic");
    expect(await chosen(["client_secret_post"])).toBe("post");
    expect(await chosen(["client_secret_post", "client_secret_basic"])).toBe("basic");
    expect(await chosen(["private_key_jwt"])).toBe("as_client_auth_unsupported");
    expect(await chosen(["none"])).toBe("as_client_auth_unsupported");
    expect(await chosen(Array.from({ length: 33 }, () => "client_secret_basic"))).toBe("as_metadata_invalid");
    expect(await chosen(["client_secret_basic", 42])).toBe("as_metadata_invalid");
  });

  it("no planted AS text reaches any outcome, whichever rule refused it", async () => {
    const outcomes: unknown[] = [];
    for (const overrides of [{}, { issuer: MARKER }, { token_endpoint: `https://auth.example.com/${MARKER}` }, { grant_types_supported: [MARKER] }, { token_endpoint_auth_methods_supported: [MARKER] }]) {
      resetMcpAuthorization();
      outcomes.push(await send(authWorld({ as: asAnswer(overrides) })));
    }
    for (const outcome of outcomes) expect(JSON.stringify(outcome)).not.toContain(MARKER);
  });
});
