/**
 * [B20 B2] GET /.well-known/oauth-protected-resource/api/mcp — the RFC 9728 protected-resource metadata of the MCP endpoint
 * (D-11, OD-66), served from `app/.well-known` through the canonical `publicRoute`. It names the resource, the one scope and
 * the header bearer method. It names NO authorization server: none exists in B20 (OD-43). The MCP 2026-07-28 authorization
 * specification makes `authorization_servers` (at least one) a MUST, so this is a recorded, owner-visible deviation.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MCP_TOKEN_SECRET_ENV, __setMcpServerClockForTests, mintMcpAccessToken } from "@/app/lib/auth/mcp-bearer";
import { membershipRevisionOf } from "@/app/lib/auth/project-membership";
import { allRoutePolicies, policyFor } from "@/app/lib/auth/route-policy";
import { routeResourceClassification } from "@/app/lib/auth/route-resource-classification";
import { injectMembership, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { classifyRouteMethodForm, exportedHttpMethods } from "@/app/lib/auth/__tests__/_boundary-analysis";
import { resetMcpInboundLimitsForTests } from "@/app/lib/mcp/server/inbound-limits";
import { renderMcpResourceMetadata } from "@/app/lib/mcp/server/resource-metadata";
import * as metadataRoute from "../../../.well-known/oauth-protected-resource/api/mcp/route";
import { POST as MCP } from "../route";

const ROOT = process.cwd();
const ORIGIN = "https://mcp.example.com";
const PATH = "/.well-known/oauth-protected-resource/api/mcp";
const SECRET = ["b2", "fixture", "mcp", "token", "secret", "0123456789abcdef"].join("-");
const T0 = Date.UTC(2026, 8, 20, 12, 0, 0);
const get = (): Request => new Request(`${ORIGIN}${PATH}`, { method: "GET" });

beforeEach(() => {
  vi.stubEnv("SIRKIT_MCP_ENABLED", "1");
  vi.stubEnv("SIRKIT_EXPECTED_ORIGIN", ORIGIN);
  vi.stubEnv(MCP_TOKEN_SECRET_ENV, SECRET);
  vi.stubEnv("SIRKIT_WORKFLOW_WORKER_SECRET", undefined);
  vi.stubEnv("KICAD_HTTP_LIBRARY_TOKEN", undefined);
  vi.stubEnv("SIRKIT_AUTH_MODE", undefined);
  __setMcpServerClockForTests(() => T0);
  resetMcpInboundLimitsForTests();
});
afterEach(() => { __setMcpServerClockForTests(null); resetInjectedIdentity(); vi.unstubAllEnvs(); });

describe("[B20 B2] G — the protected-resource metadata", () => {
  it("1. 200 with exactly resource, scopes_supported, bearer_methods_supported and resource_name; resource equals the token audience; no authorization_servers (the recorded deviation)", async () => {
    const response = await metadataRoute.GET(get());
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({ resource: `${ORIGIN}/api/mcp`, scopes_supported: ["sirkit.mcp"], bearer_methods_supported: ["header"], resource_name: "Sirkit" });
    expect(Object.hasOwn(body, "authorization_servers")).toBe(false);
    const repo = injectMembership([{ projectId: "proj-mcp", userId: "user-mcp-0001", role: "viewer" }]);
    const record = (await repo.loadActiveMembership({ tenantId: "local", projectId: "proj-mcp", userId: "user-mcp-0001" }))!;
    const minted = mintMcpAccessToken({ subject: "user-mcp-0001", tenantId: "local", projectId: "proj-mcp", branchId: "main", membershipRevision: membershipRevisionOf(record) }, { environment: process.env, nowMs: T0 });
    expect(minted.ok && minted.claims.audience).toBe(body.resource);
  });

  it("2. the challenge URL from /api/mcp is this route's URL, derived by RFC 9728 path insertion from the resource", async () => {
    const response = await MCP(new Request(`${ORIGIN}/api/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
    expect(response.status).toBe(401);
    const challenge = response.headers.get("www-authenticate")!;
    const url = /resource_metadata="([^"]+)"/.exec(challenge)![1]!;
    expect(url).toBe(`${ORIGIN}${PATH}`);
    const resource = new URL(`${ORIGIN}/api/mcp`);
    expect(url).toBe(`${resource.origin}/.well-known/oauth-protected-resource${resource.pathname}`);
  });

  it("3. the flag off is 404 and a missing configuration is 503; every answer is no-store JSON", async () => {
    const ok = await metadataRoute.GET(get());
    expect(ok.headers.get("cache-control")).toBe("no-store");
    expect(ok.headers.get("content-type")).toMatch(/^application\/json/);
    vi.stubEnv("SIRKIT_MCP_ENABLED", undefined);
    const off = await metadataRoute.GET(get());
    expect(off.status).toBe(404);
    expect(await off.json()).toMatchObject({ ok: false, code: "MCP_NOT_ENABLED" });
    expect(off.headers.get("cache-control")).toBe("no-store");
    vi.stubEnv("SIRKIT_MCP_ENABLED", "1");
    vi.stubEnv("SIRKIT_EXPECTED_ORIGIN", undefined);
    const unconfigured = await metadataRoute.GET(get());
    expect(unconfigured.status).toBe(503);
    expect(await unconfigured.json()).toMatchObject({ ok: false, code: "MCP_NOT_CONFIGURED" });
    expect(unconfigured.headers.get("cache-control")).toBe("no-store");
    expect(renderMcpResourceMetadata({ ok: true, issuer: ORIGIN, resourceUri: `${ORIGIN}/api/mcp`, resourceMetadataUrl: `${ORIGIN}${PATH}` })).toEqual({ resource: `${ORIGIN}/api/mcp`, scopes_supported: ["sirkit.mcp"], bearer_methods_supported: ["header"], resource_name: "Sirkit" });
  });

  it("4. a public row, static classification, the canonical publicRoute; the module exports GET, runtime and dynamic only", () => {
    expect(policyFor(PATH, "GET")).toMatchObject({ authClass: "public", identitySource: "none", requiresAuth: false, requiresCsrf: false });
    expect(routeResourceClassification().find((row) => row.path === PATH)).toMatchObject({ isPublic: true, durableAccess: "none", staticOrCatalog: true, providerCredit: false, externalProcess: "" });
    const file = join(ROOT, "app", ".well-known", "oauth-protected-resource", "api", "mcp", "route.ts");
    const source = readFileSync(file, "utf8");
    expect(exportedHttpMethods(source, file)).toEqual(["GET"]);
    expect(classifyRouteMethodForm(source, "GET", file, ROOT)).toEqual({ form: "canonical-wrapper", wrapper: "publicRoute" });
    expect(Object.keys(metadataRoute).sort()).toEqual(["GET", "dynamic", "runtime"]);
    expect(metadataRoute.runtime).toBe("nodejs");
    expect(metadataRoute.dynamic).toBe("force-dynamic");
  });

  it("5. no other method has a policy on the metadata path", () => {
    expect(allRoutePolicies().filter((row) => row.path === PATH).map((row) => row.method)).toEqual(["GET"]);
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) expect(policyFor(PATH, method), method).toBeNull();
  });
});
