/**
 * [B20 B2] POST /api/mcp/token — Sirkit issues the MCP access token (OD-43): a signed-in member's cookie session, confirmed
 * live, same-origin CSRF in production, and the canonical authenticated wrapper run first; then the flag, the configuration,
 * a human cookie principal, an empty body and the per-member mint limit. The token is bound to the member's selected scope
 * and LIVE membership revision, and is returned only in this 200 body. A minted token keeps working until its expiry or a
 * membership change even after the login session is revoked: the recorded relaxation of B16.1B section E (H2).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SupabaseIdentityProvider, type SupabaseVerifiedClaims } from "@/app/lib/auth/identity-provider";
import { setIdentityProviderFactory } from "@/app/lib/auth/identity-runtime";
import { MCP_TOKEN_SECRET_ENV, __setMcpServerClockForTests } from "@/app/lib/auth/mcp-bearer";
import { membershipRevisionOf, type MembershipRole } from "@/app/lib/auth/project-membership";
import { allRoutePolicies, policyFor } from "@/app/lib/auth/route-policy";
import { routeResourceClassification } from "@/app/lib/auth/route-resource-classification";
import type { SessionLivenessOutcome } from "@/app/lib/auth/session-liveness";
import { injectAuthorizedPrincipal, injectIdentity, injectMembership, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { classifyRouteMethodForm } from "@/app/lib/auth/__tests__/_boundary-analysis";
import { ACTION_COVERAGE_REGISTRY, API_ROUTE_COVERAGE } from "@/app/lib/engineering/action-registry";
import { resetMcpInboundLimitsForTests } from "@/app/lib/mcp/server/inbound-limits";
import { issueMcpAccessToken } from "@/app/lib/mcp/server/token-issuance";
import { POST as TOKEN } from "../token/route";
import { POST as MCP } from "../route";

const ROOT = process.cwd();
const ORIGIN = "https://mcp.example.com";
const SECRET = ["b2", "fixture", "mcp", "token", "secret", "0123456789abcdef"].join("-");
const WORKER = ["b2", "fixture", "worker", "secret", "fedcba9876543210"].join("-");
const KICAD = ["b2", "fixture", "kicad", "library", "token", "00112233"].join("-");
const T0 = Date.UTC(2026, 8, 20, 12, 0, 0);
const USER = "user-mcp-0001";
const PROJECT = "proj-mcp";
const SEL = { "x-sirkit-tenant-id": "local", "x-sirkit-project-id": PROJECT, "x-sirkit-branch-id": "main" };
const META = { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {} };
let now = T0;

function stubMcp(): void {
  vi.stubEnv("SIRKIT_MCP_ENABLED", "1");
  vi.stubEnv("SIRKIT_EXPECTED_ORIGIN", ORIGIN);
  vi.stubEnv(MCP_TOKEN_SECRET_ENV, SECRET);
  vi.stubEnv("SIRKIT_WORKFLOW_WORKER_SECRET", undefined);
  vi.stubEnv("KICAD_HTTP_LIBRARY_TOKEN", undefined);
  vi.stubEnv("SIRKIT_AUTH_MODE", undefined);
}
function stubProduction(): void {
  vi.stubEnv("SIRKIT_AUTH_MODE", "production");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-test-key");
}
function mint(body: string = "{}", headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}/api/mcp/token`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, ...SEL, ...headers }, body });
}
function discover(token: string): Request {
  return new Request(`${ORIGIN}/api/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json", "mcp-protocol-version": "2026-07-28", "mcp-method": "server/discover", authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "server/discover", params: { _meta: META } }) });
}
const payloadOf = (token: string): Record<string, unknown> => JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8")) as Record<string, unknown>;
const json = async (response: Response): Promise<Record<string, unknown>> => (await response.json()) as Record<string, unknown>;

beforeEach(() => {
  stubMcp();
  now = T0;
  __setMcpServerClockForTests(() => now);
  resetMcpInboundLimitsForTests();
});
afterEach(() => {
  __setMcpServerClockForTests(null);
  resetInjectedIdentity();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("[B20 B2] F — who may mint", () => {
  it("1. anonymous is 401; production without an Origin is 403 AUTH_ORIGIN_MISSING; cross-origin is 403; nothing is minted", async () => {
    injectIdentity(null);
    const anonymous = await TOKEN(mint());
    expect(anonymous.status).toBe(401);
    stubProduction();
    injectAuthorizedPrincipal({ userId: USER, projectId: PROJECT, role: "editor" });
    const noOrigin = await TOKEN(new Request(`${ORIGIN}/api/mcp/token`, { method: "POST", headers: { "content-type": "application/json", ...SEL }, body: "{}" }));
    expect(noOrigin.status).toBe(403);
    expect(await json(noOrigin)).toMatchObject({ code: "AUTH_ORIGIN_MISSING" });
    const cross = await TOKEN(mint("{}", { origin: "https://evil.example" }));
    expect(cross.status).toBe(403);
    for (const response of [anonymous, noOrigin, cross]) expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("2. every stored role mints: 200 with the exact shape, no-store and Pragma; the token is served at /api/mcp with the selector scope and the live revision", async () => {
    for (const role of ["viewer", "commenter", "editor", "reviewer", "admin"] as MembershipRole[]) {
      resetMcpInboundLimitsForTests();
      const repo = injectAuthorizedPrincipal({ userId: USER, projectId: PROJECT, role });
      const response = await TOKEN(mint());
      expect(response.status, role).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("pragma")).toBe("no-cache");
      const body = await json(response);
      expect(Object.keys(body).sort()).toEqual(["access_token", "expires_in", "ok", "project", "resource", "scope", "token_type"]);
      expect(body).toMatchObject({ ok: true, token_type: "Bearer", expires_in: 3600, scope: "sirkit.mcp", resource: `${ORIGIN}/api/mcp`, project: { tenantId: "local", projectId: PROJECT, branchId: "main" } });
      const token = body.access_token as string;
      const record = (await repo.loadActiveMembership({ tenantId: "local", projectId: PROJECT, userId: USER }))!;
      expect(payloadOf(token)).toMatchObject({ sub: USER, sirkit_tenant: "local", sirkit_project: PROJECT, sirkit_branch: "main", sirkit_mbr: membershipRevisionOf(record), iat: T0 / 1000, exp: T0 / 1000 + 3600 });
      expect((await MCP(discover(token))).status, role).toBe(200);
    }
  });

  it("3. a non-member or a revoked member is 403", async () => {
    injectIdentity({ userId: USER });
    injectMembership([{ projectId: "proj-other", userId: USER, role: "admin" }]);
    expect((await TOKEN(mint())).status).toBe(403);
    injectMembership([{ projectId: PROJECT, userId: USER, role: "admin", state: "revoked" }]);
    const revoked = await TOKEN(mint());
    expect(revoked.status).toBe(403);
    expect(await json(revoked)).toMatchObject({ code: "AUTH_NO_ACTIVE_MEMBERSHIP" });
  });

  it("4. a worker_secret principal is 403 MCP_TOKEN_PRINCIPAL_REFUSED; a local_dev member mints (the recorded local-development limit)", async () => {
    injectIdentity({ userId: USER, authMethod: "worker_secret", authStrength: "service" });
    injectMembership([{ projectId: PROJECT, userId: USER, role: "admin" }]);
    const response = await TOKEN(mint());
    expect(response.status).toBe(403);
    expect(await json(response)).toMatchObject({ code: "MCP_TOKEN_PRINCIPAL_REFUSED" });
    injectAuthorizedPrincipal({ userId: USER, projectId: PROJECT, role: "editor", authMethod: "local_dev" });
    const local = await TOKEN(mint());
    expect(local.status).toBe(200);
    const token = (await json(local)).access_token as string;
    expect(payloadOf(token)).toMatchObject({ sub: USER, sirkit_project: PROJECT });
    expect((await MCP(discover(token))).status).toBe(200);
  });

  it("5. a body other than {} is 400; 257 bytes is 413; text/plain is 415", async () => {
    injectAuthorizedPrincipal({ userId: USER, projectId: PROJECT, role: "editor" });
    for (const body of ['{"ttl":1}', '{"aud":"x"}', '{"scope":"sirkit.mcp"}']) {
      const response = await TOKEN(mint(body));
      expect(response.status, body).toBe(400);
      expect(await json(response)).toMatchObject({ code: "MCP_TOKEN_BODY_INVALID" });
    }
    expect((await TOKEN(mint("[]"))).status).toBe(400);
    const big = `{"pad":"${"x".repeat(257 - 10)}"}`;
    expect(big.length).toBe(257);
    expect((await TOKEN(mint(big))).status).toBe(413);
    expect((await TOKEN(mint("{}", { "content-type": "text/plain" }))).status).toBe(415);
  });

  it("6. the flag off: a member is 404 MCP_NOT_ENABLED only after the wrapper, so an anonymous caller is still 401 and text/plain still 415; not configured is 503", async () => {
    vi.stubEnv("SIRKIT_MCP_ENABLED", undefined);
    injectAuthorizedPrincipal({ userId: USER, projectId: PROJECT, role: "editor" });
    const off = await TOKEN(mint());
    expect(off.status).toBe(404);
    expect(await json(off)).toMatchObject({ code: "MCP_NOT_ENABLED" });
    expect((await TOKEN(mint("{}", { "content-type": "text/plain" }))).status).toBe(415);
    injectIdentity(null);
    expect((await TOKEN(mint())).status).toBe(401);
    vi.stubEnv("SIRKIT_MCP_ENABLED", "1");
    vi.stubEnv(MCP_TOKEN_SECRET_ENV, undefined);
    injectAuthorizedPrincipal({ userId: USER, projectId: PROJECT, role: "editor" });
    const unconfigured = await TOKEN(mint());
    expect(unconfigured.status).toBe(503);
    expect(await json(unconfigured)).toMatchObject({ code: "MCP_NOT_CONFIGURED" });
  });

  it("7. the 11th mint in a minute is 429 with Retry-After, whichever login session asks (the limit is the member's); another project is unaffected", async () => {
    injectMembership([{ projectId: PROJECT, userId: USER, role: "editor" }, { projectId: "proj-mcp-2", userId: USER, role: "editor" }]);
    for (let index = 0; index < 10; index += 1) {
      injectIdentity({ userId: USER, sessionId: `sess-${index}` });
      expect((await TOKEN(mint())).status).toBe(200);
    }
    now = T0 + 15_000;
    injectIdentity({ userId: USER, sessionId: "sess-fresh" });
    const limited = await TOKEN(mint());
    expect(limited.status).toBe(429);
    expect(await json(limited)).toMatchObject({ code: "MCP_RATE_LIMITED" });
    expect(limited.headers.get("retry-after")).toBe("45");
    expect((await TOKEN(mint("{}", { "x-sirkit-project-id": "proj-mcp-2" }))).status).toBe(200);
  });

  it("8. a token never mints a token: an MCP token as Bearer with no cookie, under a cookie-only production provider, is 401", async () => {
    injectAuthorizedPrincipal({ userId: USER, projectId: PROJECT, role: "editor" });
    const token = (await json(await TOKEN(mint()))).access_token as string;
    stubProduction();
    const claims = vi.fn(async (request: Request): Promise<SupabaseVerifiedClaims | null> => (request.headers.get("cookie") ? { sub: USER, exp: Math.floor(Date.now() / 1000) + 3600, session_id: "s" } : null));
    setIdentityProviderFactory(() => new SupabaseIdentityProvider(claims, { verifier: { confirm: async () => ({ live: true, userId: USER }) } }));
    const response = await TOKEN(new Request(`${ORIGIN}/api/mcp/token`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, ...SEL, authorization: `Bearer ${token}` }, body: "{}" }));
    expect(response.status).toBe(401);
  });

  it("9. S2: no response carries the MCP secret, the worker secret or the KiCad token", async () => {
    vi.stubEnv("SIRKIT_WORKFLOW_WORKER_SECRET", WORKER);
    vi.stubEnv("KICAD_HTTP_LIBRARY_TOKEN", KICAD);
    injectAuthorizedPrincipal({ userId: USER, projectId: PROJECT, role: "editor" });
    const texts = [await (await TOKEN(mint())).text(), await (await TOKEN(mint('{"x":1}'))).text()];
    injectIdentity(null);
    texts.push(await (await TOKEN(mint())).text());
    for (const text of texts) for (const secret of [SECRET, WORKER, KICAD]) {
      expect(text.includes(secret)).toBe(false);
      expect(text.includes(Buffer.from(secret).toString("base64url"))).toBe(false);
    }
  });

  it("10. registrations: the policy row, the classification, the canonical wrapper, the route coverage and the record", () => {
    expect(allRoutePolicies().filter((row) => row.path === "/api/mcp/token").map((row) => row.method)).toEqual(["POST"]);
    expect(policyFor("/api/mcp/token", "POST")).toMatchObject({ authClass: "authenticated-read", identitySource: "trusted-context", requiresCsrf: true, providerCredit: false, authoritativeWrite: false });
    expect(routeResourceClassification().find((row) => row.path === "/api/mcp/token")).toMatchObject({ isPublic: false, durableAccess: "none", projectDataSensitivity: "session-identity" });
    const file = join(ROOT, "app", "api", "mcp", "token", "route.ts");
    expect(classifyRouteMethodForm(readFileSync(file, "utf8"), "POST", file, ROOT)).toEqual({ form: "canonical-wrapper", wrapper: "authenticatedJsonRoute" });
    expect(API_ROUTE_COVERAGE.find((entry) => entry.path === "/api/mcp/token")).toEqual({ path: "/api/mcp/token", methods: ["POST"], recordId: "mcp.server", class: "read" });
    expect(ACTION_COVERAGE_REGISTRY.find((record) => record.id === "mcp.server")!.sources).toContain("app/api/mcp/token/route.ts");
  });

  it("11. the recorded relaxation (H2, OD-43): after the login session is revoked the token route is 401, yet the minted token serves until its expiry", async () => {
    stubProduction();
    // the cookie's signed claims are judged by the identity provider's own clock (the real one); the MCP server clock is injected
    let liveness: SessionLivenessOutcome = { live: true, userId: USER };
    const claims = vi.fn(async (): Promise<SupabaseVerifiedClaims | null> => ({ sub: USER, exp: Math.floor(Date.now() / 1000) + 7200, aal: "aal1", session_id: "sess-1" }));
    setIdentityProviderFactory(() => new SupabaseIdentityProvider(claims, { verifier: { confirm: async () => liveness } }));
    injectMembership([{ projectId: PROJECT, userId: USER, role: "editor" }]);
    const minted = await TOKEN(mint("{}", { cookie: "sb-session=cookie-value" }));
    expect(minted.status).toBe(200);
    const token = (await json(minted)).access_token as string;
    liveness = { live: false, reason: "revoked" };
    expect((await TOKEN(mint("{}", { cookie: "sb-session=cookie-value" }))).status).toBe(401);
    expect((await MCP(discover(token))).status).toBe(200);
    now = (T0 / 1000 + 3600) * 1000;
    const expired = await MCP(discover(token));
    expect(expired.status).toBe(401);
    expect(expired.headers.get("www-authenticate")).toContain('error="invalid_token"');
  });

  it("12. a refused mint, or anything thrown inside the issuance, is 503 MCP_TOKEN_MINT_FAILED with a fixed sentence and no token (S4)", async () => {
    const environment = { SIRKIT_MCP_ENABLED: "1", SIRKIT_EXPECTED_ORIGIN: ORIGIN, [MCP_TOKEN_SECRET_ENV]: SECRET };
    const context = { principalId: USER, tenantId: "local", projectId: PROJECT, branchId: "main", actor: { actorKind: "human" }, authMethod: "supabase_cookie", membershipRevision: "mbr1-0123456789abcdef" };
    expect(issueMcpAccessToken({ context: context as never, body: {} }, { environment }).status).toBe(200);
    const refused = issueMcpAccessToken({ context: { ...context, membershipRevision: "not-a-revision" } as never, body: {} }, { environment });
    const hostile = new Proxy(context, { get(target, key) { if (key === "actor") throw new Error("context down"); return Reflect.get(target, key); } });
    const thrown: unknown = (() => {
      try {
        return issueMcpAccessToken({ context: hostile as never, body: {} }, { environment });
      } catch (error) {
        return error;
      }
    })();
    expect(thrown).toBeInstanceOf(Response);
    for (const response of [refused, thrown as Response]) {
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ ok: false, code: "MCP_TOKEN_MINT_FAILED", error: "The MCP access token could not be issued." });
    }
  });
});
