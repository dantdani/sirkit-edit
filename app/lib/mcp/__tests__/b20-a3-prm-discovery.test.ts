/**
 * [B20 A3] Protected-resource metadata discovery (RFC 9728) as the authorization client does it: ONE credential-free probe
 * of the MCP endpoint for a same-origin 401 challenge (LD-3), else the well-known URIs of the canonical URI in order
 * (path-inserted, then root); the metadata fetched only from the endpoint's own origin, never redirected, bounded, and
 * validated field by field — `resource` IDENTICAL to the canonical URI from every URL (D3, LD-5), the PINNED issuer listed,
 * `header` among the bearer methods — with nothing else of it kept. Every fetch goes through an in-process fake behind
 * `OutboundDeps`; the global fetch is poisoned.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAdmissionControl } from "../../acquisition/admission-control";
import { MCP_AUTH_METADATA_TTL_MS, mcpAuthorizationStateCounts, mcpPostAuthorized, resetMcpAuthorization, MCP_AUTHORIZATION_DEFAULT_DEADLINE_MS } from "../authorization";
import { bearerChallengeParameters, parseBearerChallenge, resetMcpInFlight } from "../http-transport";
import { admitMcpResourceMetadataUrl, MCP_AUTH_METADATA_MAX_BYTES, mcpProtectedResourceMetadataUrls } from "../oauth-discovery";
import { fixtureServer, T0 } from "./_fixtures";
import { rpcResult } from "./_fake-mcp-server";
import {
  asDocument, authWorld, bareProbe, ccRow, ccServer, challengeProbe, CLIENT_SECRET, ENV, EXTENSION, hang, ISSUER, jsonAnswer, listRequest, MARKER, plainAnswer, prmDocument, REFRESH_TOKEN, tokenDocument, trafficTo,
  type AuthScript, type AuthWorld,
} from "./_fake-authorization-server";

const CANONICAL = ccServer.canonicalUri;
const PATH_PRM = "https://mcp.example.com/.well-known/oauth-protected-resource/mcp";
const ROOT_PRM = "https://mcp.example.com/.well-known/oauth-protected-resource";

const send = (world: AuthWorld, server = ccServer, extra: Record<string, unknown> = {}) => mcpPostAuthorized(server, listRequest(), { purpose: "interactive", deps: world.deps(), ...extra });
const prmAnswer = (overrides: Record<string, unknown>): AuthScript["prm"] => () => jsonAnswer(prmDocument(CANONICAL, overrides));
const leaks = (value: unknown): string[] => [MARKER, CLIENT_SECRET, REFRESH_TOKEN].filter((planted) => JSON.stringify(value).includes(planted));

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

describe("[B20 A3] the metadata URLs (pure)", () => {
  it("the well-known URIs of a canonical URI: path-inserted then root; the root alone for a path of /; the port and every segment kept", () => {
    expect(mcpProtectedResourceMetadataUrls(ccServer)).toEqual([PATH_PRM, ROOT_PRM]);
    const rooted = ccRow("docs-root", "root.example.com", {}, "/");
    expect(mcpProtectedResourceMetadataUrls(rooted)).toEqual(["https://root.example.com/.well-known/oauth-protected-resource"]);
    const ported = fixtureServer({ canonicalUri: "https://mcp.example.com:8443/v1/mcp", endpoint: { host: "mcp.example.com", port: 8443, path: "/v1/mcp" } });
    expect(mcpProtectedResourceMetadataUrls(ported)).toEqual(["https://mcp.example.com:8443/.well-known/oauth-protected-resource/v1/mcp", "https://mcp.example.com:8443/.well-known/oauth-protected-resource"]);
    const deep = fixtureServer({ canonicalUri: "https://mcp.example.com/a/b/c", endpoint: { host: "mcp.example.com", port: null, path: "/a/b/c" } });
    expect(mcpProtectedResourceMetadataUrls(deep)[0]).toBe("https://mcp.example.com/.well-known/oauth-protected-resource/a/b/c");
    expect(mcpProtectedResourceMetadataUrls(fixtureServer({ canonicalUri: "http://mcp.example.com/mcp" }))).toEqual([]);
  });

  it("admitMcpResourceMetadataUrl admits a same-origin plain path and refuses every other spelling, read as the raw string", () => {
    expect(admitMcpResourceMetadataUrl(ccServer, "https://mcp.example.com/meta/prm")).toEqual({ ok: true, url: "https://mcp.example.com/meta/prm" });
    expect(admitMcpResourceMetadataUrl(ccServer, PATH_PRM)).toEqual({ ok: true, url: PATH_PRM });
    for (const refused of [
      "https://evil.example.net/meta/prm",
      "https://sub.mcp.example.com/meta/prm",
      "https://mcp.example.com:8443/meta/prm",
      "http://mcp.example.com/meta/prm",
      "https://user:pw@mcp.example.com/meta/prm",
      "https://mcp.example.com/meta/prm?x=1",
      "https://mcp.example.com/meta/prm#frag",
      `https://mcp.example.com/${"a".repeat(2_048)}`,
      "https://mcp.example.com/meta/../prm",
      "https://mcp.example.com/meta/%2e%2e/prm",
      "https://mcp.example.com/meta/p%72m",
      "https://93.184.216.34/meta/prm",
      "https://169.254.169.254/latest/meta-data",
      "https://mcp.example.com./meta/prm",
      "https://MCP.example.com/meta/prm",
      "https://mcp.example.com:443/meta/prm",
      "https://mcp.example.com/meta//prm",
      42,
      null,
    ]) {
      expect(admitMcpResourceMetadataUrl(ccServer, refused), String(refused).slice(0, 80)).toEqual({ ok: false });
    }
  });
});

describe("[B20 A3] the credential-free probe (LD-3)", () => {
  it("a server that publishes its metadata ONLY through the 401 challenge is reached: probe, that URL, the issuer, the token, the call", async () => {
    const world = authWorld({
      probe: challengeProbe("https://mcp.example.com/meta/prm"),
      prm: (call) => (call.path === "/meta/prm" ? jsonAnswer(prmDocument(CANONICAL)) : plainAnswer("not found", 404)),
    });
    const result = await send(world);
    expect(result).toMatchObject({ ok: true, kind: "complete" });
    expect(world.calls.map((call) => `${call.kind} ${call.path}`)).toEqual(["probe /mcp", "prm /meta/prm", "as /.well-known/oauth-authorization-server", "token /oauth/token", "mcp /mcp"]);
    expect(leaks(result)).toEqual([]);
  });

  it("the probe carries the extension declaration and NO Authorization header or credential, and its body never reaches an outcome", async () => {
    const world = authWorld({ probe: () => plainAnswer(JSON.stringify({ planted: MARKER, token: REFRESH_TOKEN }), 401, { "www-authenticate": `Bearer resource_metadata="${PATH_PRM}"`, "content-type": "application/json" }) });
    const result = await send(world);
    const [probe] = world.of("probe");
    expect(probe).toBeDefined();
    expect(Object.keys(probe!.headers).map((name) => name.toLowerCase())).not.toContain("authorization");
    expect(probe!.raw).not.toContain(CLIENT_SECRET);
    expect(probe!.raw).not.toContain(ENV.MCP_DOCS_CLIENT_ID);
    expect(probe!.body.method).toBe("server/discover");
    expect(probe!.body.params?._meta).toMatchObject({ "io.modelcontextprotocol/clientCapabilities": { extensions: { [EXTENSION]: {} } } });
    expect(probe!.headers["Mcp-Method"]).toBe("server/discover");
    expect(result).toMatchObject({ ok: true, kind: "complete" });
    expect(leaks(result)).toEqual([]);
    expect(JSON.stringify(result).includes(REFRESH_TOKEN)).toBe(false);
  });

  it("a 401 without resource_metadata, a 200, a 403 and a network failure each fall back to the well-known URIs in order", async () => {
    for (const probe of [bareProbe, () => rpcResult({ url: "", httpMethod: "POST", headers: {}, body: { id: 1 }, raw: "" }, {}), () => plainAnswer("forbidden", 403), () => { throw new Error("connection reset"); }] as const) {
      resetMcpAuthorization();
      const world = authWorld({ probe: probe as AuthScript["probe"] });
      const result = await send(world);
      expect(result).toMatchObject({ ok: true, kind: "complete" });
      expect(world.of("prm").map((call) => call.url)).toEqual([PATH_PRM]);
    }
  });

  it("a cross-origin challenge URL is refused prm_url_not_allowed and never fetched; nothing reaches the issuer", async () => {
    const world = authWorld({ probe: challengeProbe("https://evil.example.net/prm") });
    const result = await send(world);
    expect(result).toMatchObject({ ok: false, kind: "closed", code: "prm_url_not_allowed", stage: "prm" });
    expect(trafficTo(world, "evil.example.net")).toBe("[]");
    expect(world.of("prm")).toEqual([]);
    expect(world.of("as")).toEqual([]);
    expect(world.of("token")).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("evil.example.net");
  });
});

describe("[B20 A3] a challenge URL is admitted only on the endpoint's own origin", () => {
  it("every URL the transport lets through that is not same-origin and plain is prm_url_not_allowed, from the probe and from a refresh, with zero requests to its host", async () => {
    const rows: Array<[string, string, string]> = [
      ["another host", "https://evil.example.net/prm", "evil.example.net"],
      ["a subdomain", "https://sub.mcp.example.com/prm", "sub.mcp.example.com"],
      ["another port", "https://mcp.example.com:8443/prm", "mcp.example.com:8443"],
      ["a public IP literal", "https://93.184.216.34/prm", "93.184.216.34"],
      ["a query", "https://mcp.example.com/prm?x=1", "mcp.example.com"],
      ["a percent-encoded segment", "https://mcp.example.com/p%72m", "mcp.example.com"],
      ["a trailing-dot host", "https://mcp.example.com./prm", "mcp.example.com."],
    ];
    for (const [label, url, host] of rows) {
      resetMcpAuthorization();
      const cold = authWorld({ probe: challengeProbe(url) });
      const refused = await send(cold);
      expect(refused, label).toMatchObject({ ok: false, code: "prm_url_not_allowed", stage: "prm" });
      expect(cold.of("prm"), label).toEqual([]);
      if (host !== "mcp.example.com") expect(trafficTo(cold, host), label).toBe("[]");
      // the refresh path: a cached token, then a 401 naming the URL
      resetMcpAuthorization();
      let answered = 0;
      const warm = authWorld({ mcp: (call) => (++answered === 2 ? plainAnswer(null, 401, { "www-authenticate": `Bearer resource_metadata="${url}"` }) : rpcResult(call, { tools: [] })) });
      expect(await send(warm), label).toMatchObject({ ok: true, kind: "complete" });
      const refreshed = await send(warm);
      expect(refreshed, label).toMatchObject({ ok: false, code: "prm_url_not_allowed", stage: "prm" });
      expect(warm.of("prm"), label).toHaveLength(1);
      expect(warm.of("token"), label).toHaveLength(1);
    }
  });

  // [B20 A3 review] coverage-02 / coverage-03 / tests-probe-dropped-challenge-url: the probe read the URL the transport's
  // challenge parser kept — which DROPS an http, private-address, userinfo or fragment URL (so discovery fell back to the
  // well-known URIs, against LD-3's fail-closed rule) and NORMALISES the rest (so the raw-string rules never met what the
  // server sent). The probe now judges the raw parameter: any value present and not admitted as written is refused.
  it("the probe judges the challenge's RAW resource_metadata: a URL the transport would drop or normalise, or a repeated parameter, is prm_url_not_allowed with no fallback, and the backoff holds the next call", async () => {
    const WELL_KNOWN = "/.well-known/oauth-protected-resource/mcp";
    const rows: Array<[string, string]> = [
      ["http on another host", 'resource_metadata="http://evil.example.net/prm"'],
      ["the metadata address", 'resource_metadata="https://169.254.169.254/latest/meta-data/prm"'],
      ["a private address", 'resource_metadata="https://10.0.0.1/prm"'],
      ["userinfo on the endpoint's host", 'resource_metadata="https://user:pw@mcp.example.com/prm"'],
      ["a fragment", 'resource_metadata="https://mcp.example.com/prm#x"'],
      ["an uppercase host", `resource_metadata="https://MCP.EXAMPLE.COM${WELL_KNOWN}"`],
      ["a dot segment", `resource_metadata="https://mcp.example.com/x/..${WELL_KNOWN}"`],
      ["an encoded dot segment", `resource_metadata="https://mcp.example.com/x/%2e%2e${WELL_KNOWN}"`],
      ["the default port spelled out", `resource_metadata="https://mcp.example.com:443${WELL_KNOWN}"`],
      ["a dropped URL, then a same-origin one", `resource_metadata="http://evil.example.net/prm", resource_metadata="https://mcp.example.com${WELL_KNOWN}"`],
      ["the same URL twice", `resource_metadata="https://mcp.example.com${WELL_KNOWN}", resource_metadata="https://mcp.example.com${WELL_KNOWN}"`],
    ];
    for (const [label, params] of rows) {
      resetMcpAuthorization();
      const world = authWorld({ probe: () => plainAnswer(null, 401, { "www-authenticate": `Bearer ${params}` }) });
      const refused = await send(world);
      expect(refused, label).toMatchObject({ ok: false, kind: "closed", code: "prm_url_not_allowed", stage: "prm" });
      expect(world.calls.map((call) => call.kind), `${label}: the probe alone, no fallback`).toEqual(["probe"]);
      expect(leaks(refused), label).toEqual([]);
      expect(JSON.stringify(refused), label).not.toContain("evil.example.net");
      // the refusal sets the backoff: the next call sends nothing
      expect(await send(world), label).toMatchObject({ ok: false, code: "authorization_backoff" });
      expect(world.calls, label).toHaveLength(1);
    }
    // the raw value as written, unchanged by the parser, is admitted: the probe's own default challenge
    resetMcpAuthorization();
    const plain = authWorld({ probe: challengeProbe(`https://mcp.example.com${WELL_KNOWN}`) });
    expect(await send(plain)).toMatchObject({ ok: true, kind: "complete" });
    expect(plain.of("prm").map((call) => call.url)).toEqual([`https://mcp.example.com${WELL_KNOWN}`]);
  });

  // [B20 A3 review] coverage-03, the refresh half: a 401 of a post comes back through the transport, which hands over only
  // the URL its parser kept — normalised, or nothing. There the rules meet that normalised URL (always on the endpoint's own
  // origin when admitted), and a dropped one counts as no URL (D2, the next case). Pinned so the page states what runs.
  it("on a refresh the transport's NORMALISED challenge URL is what admission meets: an uppercase host on the endpoint's origin is re-discovered from its lowercase form", async () => {
    let answered = 0;
    const world = authWorld({ mcp: (call) => (++answered === 2 ? plainAnswer(null, 401, { "www-authenticate": 'Bearer resource_metadata="https://MCP.EXAMPLE.COM/v2/prm"' }) : rpcResult(call, { tools: [] })) });
    await send(world);
    expect(await send(world)).toMatchObject({ ok: true, kind: "complete", authorization: { refreshed: true } });
    expect(world.of("prm").map((call) => call.url)).toEqual(["https://mcp.example.com/.well-known/oauth-protected-resource/mcp", "https://mcp.example.com/v2/prm"]);
  });

  it("a challenge URL the transport dropped (http on another host) counts as no URL: the metadata is kept, the refresh proceeds and no PRM request is made", async () => {
    let answered = 0;
    const world = authWorld({ mcp: (call) => (++answered === 2 ? plainAnswer(null, 401, { "www-authenticate": 'Bearer resource_metadata="http://evil.example.net/prm"' }) : rpcResult(call, { tools: [] })) });
    await send(world);
    const result = await send(world);
    expect(result).toMatchObject({ ok: true, kind: "complete", authorization: { refreshed: true } });
    expect(world.of("prm")).toHaveLength(1);
    expect(world.of("as")).toHaveLength(1);
    expect(world.of("token")).toHaveLength(2);
    expect(trafficTo(world, "evil.example.net")).toBe("[]");
  });

  it("T4: a same-origin challenge URL whose path carries a planted marker, answered by a network error, is prm_unavailable and the marker is absent", async () => {
    const world = authWorld({ probe: challengeProbe(`https://mcp.example.com/meta/${MARKER}`), prm: () => { throw new Error(`refused ${MARKER}`); } });
    const result = await send(world);
    expect(result).toMatchObject({ ok: false, code: "prm_unavailable", stage: "prm", egressCode: "network_error" });
    expect(leaks(result)).toEqual([]);
    expect(world.of("prm")).toHaveLength(1);
  });
});

describe("[B20 A3] the metadata request and its answers", () => {
  it("is a GET with Accept: application/json only — no Authorization, no MCP header, no body", async () => {
    const world = authWorld({ probe: bareProbe });
    await send(world);
    const [prm] = world.of("prm");
    expect(prm!.httpMethod).toBe("GET");
    expect(prm!.headers).toEqual({ Accept: "application/json" });
    expect(prm!.raw).toBe("");
  });

  it("a redirect (301, 302, 307, 308) is prm_unavailable after exactly one request", async () => {
    for (const status of [301, 302, 307, 308]) {
      resetMcpAuthorization();
      const world = authWorld({ probe: bareProbe, prm: () => plainAnswer(null, status, { location: "https://evil.example.net/prm" }) });
      const result = await send(world);
      expect(result, String(status)).toMatchObject({ ok: false, code: "prm_unavailable", httpStatus: status });
      expect(world.of("prm"), String(status)).toHaveLength(1);
      expect(trafficTo(world, "evil.example.net")).toBe("[]");
    }
  });

  it("404 then the root; 410 then the root; a 500 stops (the root is never requested); a failed challenge URL has no fallback", async () => {
    for (const status of [404, 410]) {
      resetMcpAuthorization();
      const world = authWorld({ probe: bareProbe, prm: (call) => (call.url === ROOT_PRM ? jsonAnswer(prmDocument(CANONICAL)) : plainAnswer("gone", status)) });
      expect(await send(world), String(status)).toMatchObject({ ok: true, kind: "complete" });
      expect(world.of("prm").map((call) => call.url)).toEqual([PATH_PRM, ROOT_PRM]);
    }
    resetMcpAuthorization();
    const stops = authWorld({ probe: bareProbe, prm: () => plainAnswer("boom", 500) });
    expect(await send(stops)).toMatchObject({ ok: false, code: "prm_unavailable", httpStatus: 500 });
    expect(stops.of("prm").map((call) => call.url)).toEqual([PATH_PRM]);
    resetMcpAuthorization();
    const challenged = authWorld({ probe: challengeProbe("https://mcp.example.com/meta/prm"), prm: (call) => (call.path === "/meta/prm" ? plainAnswer("gone", 404) : jsonAnswer(prmDocument(CANONICAL))) });
    expect(await send(challenged)).toMatchObject({ ok: false, code: "prm_unavailable", httpStatus: 404 });
    expect(challenged.of("prm").map((call) => call.path)).toEqual(["/meta/prm"]);
  });

  it("resource must be IDENTICAL to the canonical URI (LD-5): six spellings are prm_resource_mismatch, absent or not a string prm_invalid, and nothing follows", async () => {
    const mismatches = ["https://other.example.com/mcp", `${CANONICAL}/`, "https://MCP.example.com/mcp", "http://mcp.example.com/mcp", "https://mcp.example.com", `https://mcp.example.com/${"m".repeat(3_000)}`];
    for (const resource of mismatches) {
      resetMcpAuthorization();
      const world = authWorld({ prm: prmAnswer({ resource }) });
      const result = await send(world);
      expect(result, resource.slice(0, 60)).toMatchObject({ ok: false, code: "prm_resource_mismatch", stage: "prm" });
      expect(world.of("as")).toEqual([]);
      expect(world.of("token")).toEqual([]);
      expect(JSON.stringify(result)).not.toContain("other.example.com");
    }
    for (const resource of [undefined, 42, null, ["https://mcp.example.com/mcp"]]) {
      resetMcpAuthorization();
      const world = authWorld({ prm: prmAnswer({ resource }) });
      expect(await send(world), JSON.stringify(resource) ?? "absent").toMatchObject({ ok: false, code: "prm_invalid" });
      expect(world.of("as")).toEqual([]);
    }
  });

  it("authorization_servers: absent, empty, 17 entries, a non-string or a 3 000-character entry is prm_invalid; not listing the pinned issuer is prm_issuer_not_pinned, never contacting the named host", async () => {
    for (const servers of [undefined, [], Array.from({ length: 17 }, () => ISSUER), [ISSUER, 42], [ISSUER, `https://auth.example.com/${"a".repeat(3_000)}`], "https://auth.example.com"]) {
      resetMcpAuthorization();
      const world = authWorld({ prm: prmAnswer({ authorization_servers: servers }) });
      expect(await send(world), JSON.stringify(servers)?.slice(0, 60) ?? "absent").toMatchObject({ ok: false, code: "prm_invalid" });
    }
    for (const servers of [["https://login.example.org"], [`${ISSUER}/`]]) {
      resetMcpAuthorization();
      const world = authWorld({ prm: prmAnswer({ authorization_servers: servers }) });
      expect(await send(world)).toMatchObject({ ok: false, code: "prm_issuer_not_pinned", stage: "prm" });
      expect(trafficTo(world, "login.example.org")).toBe("[]");
      expect(world.of("as")).toEqual([]);
      expect(world.of("token")).toEqual([]);
    }
  });

  it("bearer_methods_supported: [\"body\"] is refused; absent or [\"header\"] is accepted; 33 entries or a 129-character entry is prm_invalid", async () => {
    const outcome = async (methods: unknown): Promise<unknown> => {
      resetMcpAuthorization();
      return send(authWorld({ prm: prmAnswer({ bearer_methods_supported: methods }) }));
    };
    expect(await outcome(["body"])).toMatchObject({ ok: false, code: "prm_invalid" });
    expect(await outcome(undefined)).toMatchObject({ ok: true, kind: "complete" });
    expect(await outcome(["header"])).toMatchObject({ ok: true, kind: "complete" });
    expect(await outcome(["body", "header"])).toMatchObject({ ok: true, kind: "complete" });
    expect(await outcome(Array.from({ length: 33 }, () => "header"))).toMatchObject({ ok: false, code: "prm_invalid" });
    expect(await outcome(["header", "h".repeat(129)])).toMatchObject({ ok: false, code: "prm_invalid" });
  });

  it("hostile scopes_supported is prm_invalid: not an array, 65 entries, a token with a space, a quote, a control character, a non-string, 129 characters", async () => {
    for (const scopes of ["docs:read", Array.from({ length: 65 }, (_, index) => `s${index}`), ["docs read"], ["docs\"read"], [`docs${String.fromCharCode(7)}read`], [42], ["s".repeat(129)]]) {
      resetMcpAuthorization();
      const world = authWorld({ prm: prmAnswer({ scopes_supported: scopes }) });
      expect(await send(world), JSON.stringify(scopes).slice(0, 40)).toMatchObject({ ok: false, code: "prm_invalid" });
      expect(world.of("token")).toEqual([]);
    }
  });

  it("65 536 bytes are accepted and 65 537 are prm_too_large; text/html, not JSON and a JSON array are refused; __proto__ and constructor pollute nothing", async () => {
    const sized = (bytes: number): string => {
      const base = JSON.stringify(prmDocument(CANONICAL, { pad: "" }));
      return JSON.stringify(prmDocument(CANONICAL, { pad: "p".repeat(bytes - base.length) }));
    };
    expect(sized(MCP_AUTH_METADATA_MAX_BYTES)).toHaveLength(MCP_AUTH_METADATA_MAX_BYTES);
    const exact = authWorld({ prm: () => jsonAnswer(sized(MCP_AUTH_METADATA_MAX_BYTES)) });
    expect(await send(exact)).toMatchObject({ ok: true, kind: "complete" });
    resetMcpAuthorization();
    expect(await send(authWorld({ prm: () => jsonAnswer(sized(MCP_AUTH_METADATA_MAX_BYTES + 1)) }))).toMatchObject({ ok: false, code: "prm_too_large" });
    resetMcpAuthorization();
    expect(await send(authWorld({ prm: () => plainAnswer(JSON.stringify(prmDocument(CANONICAL)), 200, { "content-type": "text/html" }) }))).toMatchObject({ ok: false, code: "prm_unavailable", egressCode: "unexpected_content_type" });
    resetMcpAuthorization();
    expect(await send(authWorld({ prm: () => jsonAnswer("{not json") }))).toMatchObject({ ok: false, code: "prm_invalid" });
    resetMcpAuthorization();
    expect(await send(authWorld({ prm: () => jsonAnswer([prmDocument(CANONICAL)]) }))).toMatchObject({ ok: false, code: "prm_invalid" });
    resetMcpAuthorization();
    const polluting = `{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},${JSON.stringify(prmDocument(CANONICAL)).slice(1)}`;
    expect(await send(authWorld({ prm: () => jsonAnswer(polluting) }))).toMatchObject({ ok: true, kind: "complete" });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("egress: an address_blocked answer of the resolver (10.0.0.1, 169.254.169.254), a DNS failure and a timeout at the budget are prm_unavailable", async () => {
    for (const address of ["10.0.0.1", "169.254.169.254"]) {
      resetMcpAuthorization();
      const world = authWorld({ resolve: async (host) => (host === "mcp.example.com" ? [address] : ["93.184.216.34"]) });
      const result = await send(world);
      expect(result, address).toMatchObject({ ok: false, code: "prm_unavailable", egressCode: "address_blocked" });
      expect(JSON.stringify(result)).not.toContain(address);
      expect(world.calls).toEqual([]);
    }
    resetMcpAuthorization();
    const dns = authWorld({ resolve: async (host) => { if (host === "mcp.example.com") throw new Error("ENOTFOUND"); return ["93.184.216.34"]; } });
    expect(await send(dns)).toMatchObject({ ok: false, code: "prm_unavailable", egressCode: "dns_failed" });
    resetMcpAuthorization();
    const slow = ccRow("docs-slow", "slow.example.com", { limits: { ...ccServer.limits, deadlineMs: 1_000 } });
    const hanging = authWorld({ probe: bareProbe, prm: hang });
    const started = Date.now();
    expect(await send(hanging, slow)).toMatchObject({ ok: false, code: "prm_unavailable", egressCode: "timeout" });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(MCP_AUTHORIZATION_DEFAULT_DEADLINE_MS).toBe(10_000);
  }, 15_000);

  // [B20 A3 review] tests-shared-budget-untested: the injected clock never moved during discovery, so every fetch already got
  // the whole budget and "each fetch gets what remains" was indistinguishable from "each fetch gets the budget" (a cold
  // acquisition could then take 4 x the deadline or more). Here the clock moves inside the metadata exchange, and the
  // deadline each later fetch is GIVEN is read where the egress boundary arms it (its deadline timer), not by waiting.
  it("the probe, the metadata and the token request share ONE budget: after the clock moves 9 800 ms inside the metadata exchange, the next fetches are given the 200 ms that remain", async () => {
    const timers = vi.spyOn(globalThis, "setTimeout");
    try {
      const given: Record<string, number> = {};
      // the egress boundary arms its deadline timer immediately before it hands the request to the transport
      const armed = (): number => Number(timers.mock.calls.at(-1)?.[1]);
      const world = authWorld({
        probe: (call, self) => { given.probe = armed(); return bareProbe(call, self); },
        prm: (_call, self) => { given.prm = armed(); self.now += 9_800; return jsonAnswer(prmDocument(CANONICAL)); },
        as: (call) => { given.as = armed(); return call.path === "/.well-known/oauth-authorization-server" ? jsonAnswer(asDocument()) : plainAnswer("not found", 404); },
        token: (_call, self) => { given.token = armed(); return jsonAnswer(tokenDocument(self.issue())); },
      });
      expect(await send(world)).toMatchObject({ ok: true, kind: "complete" });
      expect(ccServer.limits.deadlineMs).toBe(10_000);
      expect(given).toEqual({ probe: 10_000, prm: 10_000, as: 200, token: 200 });
    } finally {
      timers.mockRestore();
    }
  });

  it("the metadata is cached: a hit sends no discovery, it expires after 15 minutes, and a new same-origin challenge URL re-discovers from that URL only; no planted text in any outcome", async () => {
    let answered = 0;
    const world = authWorld({
      mcp: (call) => (++answered === 3 ? plainAnswer(null, 401, { "www-authenticate": 'Bearer resource_metadata="https://mcp.example.com/v2/prm"' }) : rpcResult(call, { tools: [] })),
    });
    const outcomes: unknown[] = [];
    outcomes.push(await send(world));
    expect(world.of("prm")).toHaveLength(1);
    outcomes.push(await send(world)); // a hit: the cached token, no discovery
    expect(world.of("prm")).toHaveLength(1);
    expect(world.of("token")).toHaveLength(1);
    outcomes.push(await send(world)); // the 401 names a new same-origin URL: re-discovered from it alone
    expect(world.of("prm").map((call) => call.path)).toEqual(["/.well-known/oauth-protected-resource/mcp", "/v2/prm"]);
    expect(world.of("probe")).toHaveLength(1);
    expect(world.of("token")).toHaveLength(2);
    world.now += 15 * 60_000 + 3_600_000; // past the metadata TTL and the token
    outcomes.push(await send(world));
    expect(world.of("probe")).toHaveLength(2);
    expect(world.of("prm")).toHaveLength(3);
    expect(mcpAuthorizationStateCounts().metadata).toBe(1);
    for (const outcome of outcomes) expect(leaks(outcome)).toEqual([]);
  });

  // [B20 A3 review] tests-metadata-ttl-boundary: the case above jumps 75 minutes at once, past the metadata AND the token, so
  // any lifetime up to 75 minutes passed. A token of 30 s is never cached, so every call below acquires: only the metadata's
  // own lifetime decides whether discovery runs again, and it is read on both sides of its boundary.
  it(`the metadata lives exactly ${MCP_AUTH_METADATA_TTL_MS} ms: an acquisition 1 ms before re-uses it, one at the boundary discovers again`, async () => {
    const world = authWorld({ token: (_call, self) => jsonAnswer(tokenDocument(self.issue(), { expires_in: 30 })) });
    const discovery = (): number[] => [world.of("probe").length, world.of("prm").length, world.of("as").length];
    expect(await send(world)).toMatchObject({ ok: true, authorization: { tokenSource: "fetched" } });
    expect(discovery()).toEqual([1, 1, 1]);
    world.now = T0 + MCP_AUTH_METADATA_TTL_MS - 1;
    expect(await send(world)).toMatchObject({ ok: true, authorization: { tokenSource: "fetched" } });
    expect(discovery(), "inside the lifetime: no discovery").toEqual([1, 1, 1]);
    world.now = T0 + MCP_AUTH_METADATA_TTL_MS;
    expect(await send(world)).toMatchObject({ ok: true, authorization: { tokenSource: "fetched" } });
    expect(discovery(), "at the boundary: discovered again").toEqual([2, 2, 2]);
    expect(world.of("token")).toHaveLength(3);
  });

  // [B20 A3 lead] the check's new issue: the Bearer challenge's parameters are its OWN - a header may carry several challenges
  // (RFC 9110 section 11.6.1; RFC 9728 section 5.1 allows resource_metadata with other schemes), and a parameter of a later
  // challenge (DPoP) is neither the Bearer challenge's second resource_metadata nor its scope
  it("only the Bearer challenge's own parameters are read: a DPoP challenge's resource_metadata or scope, before or after it, neither refuses the probe nor steers it", async () => {
    const WELL_KNOWN = "/.well-known/oauth-protected-resource/mcp";
    const SAME = `https://mcp.example.com${WELL_KNOWN}`;
    const admitted: Array<[string, string]> = [
      ["Bearer, then a DPoP challenge naming the same URL", `Bearer resource_metadata="${SAME}", DPoP algs="ES256", resource_metadata="${SAME}"`],
      ["Bearer, then a DPoP challenge naming another origin", `Bearer resource_metadata="${SAME}", DPoP algs="ES256", resource_metadata="https://evil.example.net/prm"`],
      ["a DPoP challenge first, then Bearer", `DPoP algs="ES256", resource_metadata="https://evil.example.net/prm", Bearer resource_metadata="${SAME}"`],
      ["a DPoP challenge's scope after Bearer", `Bearer resource_metadata="${SAME}", DPoP algs="ES256", scope="evil.scope"`],
    ];
    for (const [label, header] of admitted) {
      resetMcpAuthorization();
      const world = authWorld({ probe: () => plainAnswer(null, 401, { "www-authenticate": header }) });
      expect(await send(world), label).toMatchObject({ ok: true, kind: "complete" });
      expect(world.of("prm").map((call) => call.url), label).toEqual([SAME]);
      expect(JSON.stringify(world.calls), label).not.toContain("evil.example.net");
    }
    // a Bearer challenge with no parameter of its own, then a DPoP challenge naming a URL: the Bearer challenge names none, so
    // the well-known URIs are used - never the DPoP challenge's URL
    resetMcpAuthorization();
    const bare = authWorld({ probe: () => plainAnswer(null, 401, { "www-authenticate": 'Bearer, DPoP algs="ES256", resource_metadata="https://mcp.example.com/dpop/prm"' }) });
    expect(await send(bare)).toMatchObject({ ok: true, kind: "complete" });
    expect(bare.of("prm").map((call) => call.url)).toEqual([SAME]);
    // the parsers themselves
    const header = `Bearer error="invalid_token", DPoP algs="ES256", scope="a b", resource_metadata="${SAME}"`;
    expect(parseBearerChallenge(header)).toEqual({ scheme: "Bearer", error: "invalid_token" });
    expect(bearerChallengeParameters(header, "resource_metadata")).toEqual([]);
    expect(bearerChallengeParameters(`Bearer resource_metadata="${SAME}", scope="x", DPoP resource_metadata="${SAME}"`, "resource_metadata")).toEqual([SAME]);
    // a parameter repeated INSIDE the Bearer challenge is still read twice (and the probe refuses it: the case above)
    expect(bearerChallengeParameters(`Bearer resource_metadata="${SAME}", resource_metadata="${SAME}"`, "resource_metadata")).toEqual([SAME, SAME]);
  });
});
