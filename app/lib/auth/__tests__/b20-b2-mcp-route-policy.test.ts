/**
 * [B20 B2] The MCP endpoint's place in the exact route policy (D-5, OD-44, OD-54): one `authenticated-mcp` / `mcp-bearer` row,
 * served ONLY by the canonical wrapper `mcpBearerJsonRoute`. Every other wrapper that consults the policy refuses such a row
 * before any identity, CSRF or body work (so an ambient cookie can never authenticate the bearer-only endpoint), the
 * policy-blind `kicadLibraryRoute` is closed by a static wrapper-policy tie in both directions, and the CSRF exemption is
 * exactly that one row.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authorizeRequest, scopedTrustedJson } from "../authorize";
import { setIdentityProviderFactory } from "../identity-runtime";
import { MCP_TOKEN_SECRET_ENV, __setMcpServerClockForTests, mintMcpAccessToken, resetMcpAccessTokenVerifierFactory } from "../mcp-bearer";
import { membershipRevisionOf } from "../project-membership";
import { requireSameOrigin } from "../request-security";
import {
  agentStreamRoute,
  authenticatedJsonRoute,
  authenticatedRoute,
  kicadLibraryRoute,
  mcpBearerJsonRoute,
  publicJsonRoute,
  publicRoute,
  selectorEnvelopeJsonRoute,
  workerJsonRoute,
  workerRoute,
} from "../route-handlers";
import { buildAuthRouteCoverage } from "../route-coverage";
import { allRoutePolicies, policyFor } from "../route-policy";
import { classificationViolations, routeResourceClassification } from "../route-resource-classification";
import { listRouteFiles, routePathOf } from "../route-tree";
import { injectMembership, resetInjectedIdentity } from "../test-support";
import { APPROVED_ROUTE_WRAPPERS, classifyRouteMethodForm, exportedHttpMethods } from "./_boundary-analysis";
import { collectProductionFiles, identifierReferences } from "../../project/__tests__/_import-gate-helpers";
import { ACTION_COVERAGE_REGISTRY, API_ROUTE_COVERAGE } from "../../engineering/action-registry";
import { resetMcpInboundLimitsForTests } from "../../mcp/server/inbound-limits";

const ROOT = process.cwd();
const ORIGIN = "https://mcp.example.com";
const SECRET = ["b2", "fixture", "mcp", "token", "secret", "0123456789abcdef"].join("-");
const T0 = Date.UTC(2026, 8, 20, 12, 0, 0);
const ALL_MEMBERS = ["viewer", "commenter", "pcb_editor", "automation", "reviewer", "project_admin", "migration_admin"];
const METADATA_PATH = "/.well-known/oauth-protected-resource/api/mcp";

function counting(url: string, headers: Record<string, string>, counter: { pulls: number }): Request {
  const stream = new ReadableStream<Uint8Array>({ pull(controller) { counter.pulls += 1; controller.enqueue(new TextEncoder().encode("{}")); controller.close(); } }, { highWaterMark: 0 });
  return new Request(url, { method: "POST", headers, body: stream, duplex: "half" } as RequestInit);
}
function stubMcp(): void {
  vi.stubEnv("SIRKIT_MCP_ENABLED", "1");
  vi.stubEnv("SIRKIT_EXPECTED_ORIGIN", ORIGIN);
  vi.stubEnv(MCP_TOKEN_SECRET_ENV, SECRET);
  vi.stubEnv("SIRKIT_WORKFLOW_WORKER_SECRET", undefined);
  vi.stubEnv("KICAD_HTTP_LIBRARY_TOKEN", undefined);
  vi.stubEnv("SIRKIT_AUTH_MODE", undefined);
}

beforeEach(() => { resetMcpInboundLimitsForTests(); __setMcpServerClockForTests(() => T0); });
afterEach(() => {
  resetInjectedIdentity();
  resetMcpAccessTokenVerifierFactory();
  __setMcpServerClockForTests(null);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** The static wrapper-policy tie (H1): an mcp-bearer row is served only by mcpBearerJsonRoute, and that wrapper only serves mcp-bearer rows. */
function wrapperPolicyTieViolations(routes: ReadonlyArray<{ file: string; path: string; source: string }>): string[] {
  const violations: string[] = [];
  for (const route of routes) {
    for (const method of exportedHttpMethods(route.source, route.file)) {
      const policy = policyFor(route.path.replace(/\[[^\]]+\]/g, "x"), method) ?? policyFor(route.path, method);
      const form = classifyRouteMethodForm(route.source, method, route.file, ROOT);
      const servedByMcpWrapper = form.form === "canonical-wrapper" && form.wrapper === "mcpBearerJsonRoute";
      if (policy?.identitySource === "mcp-bearer" && !servedByMcpWrapper) violations.push(`${method} ${route.path}: an mcp-bearer row not served by mcpBearerJsonRoute`);
      if (servedByMcpWrapper && policy?.identitySource !== "mcp-bearer") violations.push(`${method} ${route.path}: mcpBearerJsonRoute serving a non-mcp-bearer row`);
    }
  }
  return violations;
}

describe("[B20 B2] B — the vocabulary and the rows", () => {
  it("1. both vocabularies carry authenticated-mcp and mcp-bearer, ordered after authenticated-propose and migrated", () => {
    for (const rel of ["app/lib/auth/route-policy.ts", "app/lib/auth/route-coverage.ts"]) {
      const source = readFileSync(join(ROOT, rel), "utf8");
      expect(source, rel).toMatch(/export type AuthRouteClass =[^;]*\| "authenticated-mcp"/);
      expect(source, rel).toMatch(/export type IdentitySource =[^;]*\| "mcp-bearer"/);
    }
    const coverage = readFileSync(join(ROOT, "app/lib/auth/route-coverage.ts"), "utf8");
    expect(coverage).toMatch(/"authenticated-propose", "authenticated-mcp", "authenticated-read"/);
    expect(coverage).toMatch(/IDENTITY_PRECEDENCE: readonly IdentitySource\[\] = \[[^\]]*"mcp-bearer"\]/);
    expect(coverage).toMatch(/identitySource === "mcp-bearer"/);
  });

  it("2. exactly one mcp-bearer row, POST /api/mcp, with the D-5 shape; a sub-path has no policy", () => {
    const rows = allRoutePolicies().filter((policy) => policy.identitySource === "mcp-bearer" || policy.authClass === "authenticated-mcp");
    expect(rows.map((row) => ({ ...row, evidence: undefined }))).toEqual([{ path: "/api/mcp", method: "POST", authClass: "authenticated-mcp", identitySource: "mcp-bearer", requiresAuth: true, permittedRoles: ALL_MEMBERS, providerCredit: false, requiresCsrf: false, authoritativeWrite: false, releaseOrQualification: false, evidence: undefined }]);
    expect(policyFor("/api/mcp/evil", "POST")).toBeNull();
    expect(policyFor("/api/mcp", "GET")).toBeNull();
    expect(policyFor("/api/mcp", "DELETE")).toBeNull();
  });

  it("3. the token row is an authenticated same-origin read for every member; the metadata row is public, GET only, no CSRF", () => {
    expect(allRoutePolicies().filter((row) => row.path === "/api/mcp/token").map((row) => ({ ...row, evidence: undefined }))).toEqual([{ path: "/api/mcp/token", method: "POST", authClass: "authenticated-read", identitySource: "trusted-context", requiresAuth: true, permittedRoles: ALL_MEMBERS, providerCredit: false, requiresCsrf: true, authoritativeWrite: false, releaseOrQualification: false, evidence: undefined }]);
    expect(allRoutePolicies().filter((row) => row.path === METADATA_PATH).map((row) => ({ ...row, evidence: undefined }))).toEqual([{ path: METADATA_PATH, method: "GET", authClass: "public", identitySource: "none", requiresAuth: false, permittedRoles: [], providerCredit: false, requiresCsrf: false, authoritativeWrite: false, releaseOrQualification: false, evidence: undefined }]);
  });

  it("4. CSRF restated: the exemption from same-origin CSRF is exactly POST /api/mcp; a production POST without Origin elsewhere is still 403 AUTH_ORIGIN_MISSING", async () => {
    const exempt = allRoutePolicies().filter((policy) => policy.requiresAuth && policy.identitySource !== "worker-secret" && policy.method !== "GET" && policy.method !== "HEAD" && !policy.requiresCsrf);
    expect(exempt.map((policy) => `${policy.method} ${policy.path}`)).toEqual(["POST /api/mcp"]);
    const refusal = requireSameOrigin(new Request(`${ORIGIN}/api/mcp/token`, { method: "POST" }), { NODE_ENV: "production", SIRKIT_EXPECTED_ORIGIN: ORIGIN });
    expect(refusal?.status).toBe(403);
    expect(await refusal!.json()).toMatchObject({ code: "AUTH_ORIGIN_MISSING" });
  });
});

describe("[B20 B2] B — no other wrapper serves an mcp-bearer row", () => {
  it("5. every policy-consulting wrapper refuses a Request to /api/mcp with 500 before identity, CSRF or body work; kicadLibraryRoute is policy-blind", async () => {
    const verify = vi.fn(async () => ({ userId: "user-mcp-0001", sessionId: "cookie-session", authMethod: "supabase_cookie" as const, authStrength: "aal1" as const }));
    setIdentityProviderFactory(() => ({ verify }));
    injectMembership([{ projectId: "proj-mcp", userId: "user-mcp-0001", role: "admin" }]);
    const handler = vi.fn(async () => Response.json({ ok: true }));
    const headers = { "content-type": "application/json", origin: ORIGIN, cookie: "sb-session=cookie-value", "x-sirkit-project-id": "proj-mcp" };
    const wrappers: Array<[string, (request: Request) => Promise<Response>]> = [
      ["authenticatedJsonRoute", authenticatedJsonRoute({ maxBytes: 1000 }, handler)],
      ["authenticatedRoute", authenticatedRoute(undefined, handler)],
      ["publicJsonRoute", publicJsonRoute({ maxBytes: 1000 }, handler)],
      ["publicRoute", publicRoute(undefined, handler)],
      ["workerJsonRoute", workerJsonRoute({ maxBytes: 1000 }, handler)],
      ["workerRoute", workerRoute({}, handler)],
      ["selectorEnvelopeJsonRoute", selectorEnvelopeJsonRoute({ maxBytes: 1000 }, handler)],
      ["agentStreamRoute", agentStreamRoute({ maxBytes: 1000, defaultScope: { tenantId: "local", projectId: "proj-mcp", branchId: "main" } }, handler)],
      ["scopedTrustedJson", async (request) => { const out = await scopedTrustedJson(request, { maxBytes: 1000 }); return out.ok ? Response.json({ ok: true }) : out.response; }],
      ["authorizeRequest", async (request) => { const out = await authorizeRequest(request); return out.ok ? Response.json({ ok: true }) : out.response; }],
    ];
    for (const [name, wrapper] of wrappers) {
      const counter = { pulls: 0 };
      const response = await wrapper(counting("http://localhost/api/mcp", headers, counter));
      expect(response.status, name).toBe(500);
      expect(await response.json(), name).toMatchObject({ ok: false, code: "AUTH_POLICY_WRAPPER_MISMATCH" });
      expect(counter.pulls, name).toBe(0);
    }
    expect(verify).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
    // the policy-blind wrapper: with the KiCad token configured, its handler runs for /api/mcp — why the static tie (case 12) exists
    const kicadToken = ["b2", "kicad", "fixture", "7788"].join("-");
    vi.stubEnv("KICAD_HTTP_LIBRARY_TOKEN", kicadToken);
    const kicad = kicadLibraryRoute(undefined, handler);
    const response = await kicad(new Request("http://localhost/api/mcp", { method: "POST", headers: { authorization: `Token ${kicadToken}` } }));
    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("6. mcpBearerJsonRoute refuses a row that is not mcp-bearer, and invalid options answer 500 without throwing at construction", async () => {
    stubMcp();
    const handler = vi.fn(async () => Response.json({ ok: true }));
    const mismatch = await mcpBearerJsonRoute({ maxBytes: 1000 }, handler)(new Request("http://localhost/api/parts/external-search", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
    expect(mismatch.status).toBe(500);
    expect(await mismatch.json()).toEqual({ ok: false, code: "AUTH_POLICY_WRAPPER_MISMATCH", error: expect.any(String) });
    const badBytes = [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5, 2 ** 40];
    const badDeadlines = [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5, 60_001, 2 ** 40];
    for (const [maxBytes, deadlineMs] of [...badBytes.map((value) => [value, 1000]), ...badDeadlines.map((value) => [1000, value])] as Array<[number, number]>) {
      let route: ((request: Request) => Promise<Response>) | null = null;
      expect(() => { route = mcpBearerJsonRoute({ maxBytes, deadlineMs }, handler); }).not.toThrow();
      const response = await route!(new Request("http://localhost/api/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
      expect(response.status, `${maxBytes}/${deadlineMs}`).toBe(500);
      expect(await response.json()).toMatchObject({ code: "AUTH_ROUTE_MISCONFIGURED" });
    }
    expect(handler).not.toHaveBeenCalled();
  });

  it("7. mcpBearerJsonRoute is an approved wrapper and a canonical request sink, declared in route-handlers.ts, adopted by /api/mcp alone", { timeout: 120_000 }, () => {
    expect(APPROVED_ROUTE_WRAPPERS as readonly string[]).toContain("mcpBearerJsonRoute");
    const analysis = readFileSync(join(ROOT, "app/lib/auth/__tests__/_boundary-analysis.ts"), "utf8");
    const sinks = analysis.split("\n").find((line) => line.includes('moduleSuffix: "app/lib/auth/route-handlers.ts"'));
    expect(sinks).toContain('"mcpBearerJsonRoute"');
    const handlers = readFileSync(join(ROOT, "app/lib/auth/route-handlers.ts"), "utf8");
    expect(handlers).toMatch(/^export function mcpBearerJsonRoute\(/m);
    expect(handlers).not.toMatch(/export \{[^}]*mcpBearerJsonRoute/);
    const adopters = identifierReferences(collectProductionFiles(ROOT), "mcpBearerJsonRoute", new Set(["app/lib/auth/route-handlers.ts"]));
    expect(adopters).toEqual(["app/api/mcp/route.ts"]);
  });

  it("8. classification: /api/mcp and /api/mcp/token are session-identity, /api/mcp reads durable state (B3), the token route none; the metadata row is public and static; no violation", () => {
    const rows = routeResourceClassification();
    // [B20 B3] pin move: tools/call now serves reads from the durable board (resolveMcpReadDependencies), so durable is "read"
    expect(rows.find((row) => row.path === "/api/mcp")).toMatchObject({ method: "POST", isPublic: false, durableAccess: "read", projectDataSensitivity: "session-identity", providerCredit: false, externalProcess: "", staticOrCatalog: false });
    expect(rows.find((row) => row.path === "/api/mcp/token")).toMatchObject({ method: "POST", isPublic: false, durableAccess: "none", projectDataSensitivity: "session-identity", staticOrCatalog: false });
    expect(rows.find((row) => row.path === METADATA_PATH)).toMatchObject({ method: "GET", isPublic: true, durableAccess: "none", projectDataSensitivity: "none", staticOrCatalog: true });
    expect(classificationViolations()).toEqual({ publicTouchesDurableData: [], publicSpawnsProcess: [], publicHasCreditOrWrite: [] });
  });

  it("9. route coverage: /api/mcp is mcp-bearer, authenticated-mcp, migrated", () => {
    const byPath = new Map(buildAuthRouteCoverage().map((entry) => [entry.path, entry]));
    expect(byPath.get("/api/mcp")).toEqual({ path: "/api/mcp", methods: ["POST"], authClass: "authenticated-mcp", identitySource: "mcp-bearer", migrated: true });
    expect(byPath.get("/api/mcp/token")).toMatchObject({ authClass: "authenticated-read", identitySource: "trusted-context", migrated: true });
    expect(byPath.get(METADATA_PATH)).toMatchObject({ authClass: "public", identitySource: "none", migrated: false });
  });

  it("10. the three API_ROUTE_COVERAGE entries and the mcp.server record", () => {
    expect(API_ROUTE_COVERAGE.filter((entry) => entry.recordId === "mcp.server")).toEqual([
      { path: METADATA_PATH, methods: ["GET"], recordId: "mcp.server", class: "read" },
      { path: "/api/mcp", methods: ["POST"], recordId: "mcp.server", class: "read" },
      { path: "/api/mcp/token", methods: ["POST"], recordId: "mcp.server", class: "read" },
    ]);
    const record = ACTION_COVERAGE_REGISTRY.find((item) => item.id === "mcp.server");
    expect(record).toMatchObject({ area: "ai", kind: "read", status: "api-only", toolExposure: "none", approvalTier: "none", domainCommand: null });
    expect([...record!.sources].sort()).toEqual([
      "app/.well-known/oauth-protected-resource/api/mcp/route.ts",
      "app/api/mcp/route.ts",
      "app/api/mcp/token/route.ts",
      "app/lib/auth/mcp-bearer.ts",
      "app/lib/mcp/server/dispatch.ts",
      "app/lib/mcp/server/token-issuance.ts",
    ]);
  });

  it("11. identity-provider.ts never reads the Authorization header (a cookie session can never become a bearer principal)", () => {
    const source = readFileSync(join(ROOT, "app/lib/auth/identity-provider.ts"), "utf8");
    expect(source).not.toMatch(/["'`]authorization["'`]/i);
    expect(source).not.toMatch(/bearer/i);
  });

  it("12. the static wrapper-policy tie holds over both route roots, and catches both synthetic offenders", { timeout: 120_000 }, () => {
    const routes = listRouteFiles(ROOT).map((file) => ({ file, path: routePathOf(ROOT, file), source: readFileSync(file, "utf8") }));
    expect(routes.some((route) => route.path === "/api/mcp")).toBe(true);
    expect(wrapperPolicyTieViolations(routes)).toEqual([]);
    const kicadOnMcp = { file: join(ROOT, "app", "api", "mcp", "route.ts"), path: "/api/mcp", source: 'import { kicadLibraryRoute } from "@/app/lib/auth/route-handlers";\nexport const POST = kicadLibraryRoute(undefined, () => Response.json({ ok: true }));\n' };
    expect(wrapperPolicyTieViolations([kicadOnMcp])).toEqual(["POST /api/mcp: an mcp-bearer row not served by mcpBearerJsonRoute"]);
    const mcpElsewhere = { file: join(ROOT, "app", "api", "parts", "external-search", "route.ts"), path: "/api/parts/external-search", source: 'import { mcpBearerJsonRoute } from "@/app/lib/auth/route-handlers";\nexport const POST = mcpBearerJsonRoute({ maxBytes: 1000 }, () => Response.json({ ok: true }));\n' };
    expect(wrapperPolicyTieViolations([mcpElsewhere])).toEqual(["POST /api/parts/external-search: mcpBearerJsonRoute serving a non-mcp-bearer row"]);
  });

  it("13. the handler receives exactly { bytes, mcp, message, meta, principal, signal }", async () => {
    stubMcp();
    const repo = injectMembership([{ projectId: "proj-mcp", userId: "user-mcp-0001", role: "viewer" }]);
    const record = (await repo.loadActiveMembership({ tenantId: "local", projectId: "proj-mcp", userId: "user-mcp-0001" }))!;
    const minted = mintMcpAccessToken({ subject: "user-mcp-0001", tenantId: "local", projectId: "proj-mcp", branchId: "main", membershipRevision: membershipRevisionOf(record) }, { environment: process.env, nowMs: T0 });
    expect(minted.ok).toBe(true);
    let keys: string[] = [];
    const route = mcpBearerJsonRoute({ maxBytes: 1000, deadlineMs: 1000 }, (input) => { keys = Object.keys(input).sort(); return Response.json({ ok: true }); });
    const response = await route(new Request(`${ORIGIN}/api/mcp`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${minted.ok ? minted.token : ""}` }, body: "{}" }));
    expect(response.status).toBe(200);
    expect(keys).toEqual(["bytes", "mcp", "message", "meta", "principal", "signal"]);
  });
});
