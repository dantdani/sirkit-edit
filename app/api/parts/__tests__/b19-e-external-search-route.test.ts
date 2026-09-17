/**
 * [B19-E E2] f — POST /api/parts/external-search: a member's bounded candidate search, through the canonical wrapper.
 *
 * Live vendor search spends metered quota, so the route is an authenticated project read declared as spending provider
 * credit — the same policy shape as /api/bom (OD-31). Live search is a server decision for an authenticated member, never a
 * body flag; the body is small (about 4 KB) with a deadline; authority- and transport-shaped keys are refused; a failure
 * answers one fixed sentence. The route is NOT under /api/component-selection, whose confinement gate bans distributor ids.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { injectAuthorizedPrincipal, injectIdentity, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { allRoutePolicies, policyFor } from "@/app/lib/auth/route-policy";
import { routeResourceClassification } from "@/app/lib/auth/route-resource-classification";
import { classifyRouteMethodForm } from "@/app/lib/auth/__tests__/_boundary-analysis";
import { ACTION_COVERAGE_REGISTRY, API_ROUTE_COVERAGE } from "@/app/lib/engineering/action-registry";

vi.mock("@/app/lib/acquisition/external-search", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, searchExternalCandidates: vi.fn() };
});
import { searchExternalCandidates } from "@/app/lib/acquisition/external-search";
import { POST } from "../external-search/route";

const mockSearch = vi.mocked(searchExternalCandidates);
const PATH = "/api/parts/external-search";
const PROJECT = "proj-e2";
const SEL = { "x-sirkit-tenant-id": "local", "x-sirkit-project-id": PROJECT, "x-sirkit-branch-id": "main" };
const SENTINEL = ["FAKE", "VENDOR", "SECRET", "SENTINEL", "9931"].join("-");
const OK_RESULT = { ok: true as const, query: "NE555DR", mode: "exact" as const, limit: 5, live: true, registryVersion: "1.1.0", authority: "sourcing observation", sources: [], hits: [], generatedAt: 0 };

function req(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost${PATH}`, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...SEL, ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
}
function stubProduction(): void {
  vi.stubEnv("SIRKIT_AUTH_MODE", "production");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-test-key");
  vi.stubEnv("SIRKIT_EXPECTED_ORIGIN", "http://localhost");
}
const member = (role: "viewer" | "editor" | "admin" = "viewer"): void => { injectAuthorizedPrincipal({ userId: "u-e2", tenantId: "local", projectId: PROJECT, role }); };
const payload = async (res: Response): Promise<Record<string, unknown>> => (await res.json()) as Record<string, unknown>;

afterEach(() => {
  resetInjectedIdentity();
  vi.unstubAllEnvs();
  mockSearch.mockReset();
  vi.restoreAllMocks();
});

describe("[B19-E E2] f — the route's registrations", () => {
  it("the policy row is an authenticated read that spends provider credit: the same shape as /api/bom", () => {
    const policy = policyFor(PATH, "POST");
    const bom = policyFor("/api/bom", "POST");
    expect(policy).toMatchObject({ authClass: "authenticated-read", identitySource: "trusted-context", requiresAuth: true, providerCredit: true, requiresCsrf: true, authoritativeWrite: false, releaseOrQualification: false });
    const shape = (row: typeof policy) => ({ ...row, path: undefined, evidence: undefined });
    expect(shape(policy)).toEqual(shape(bom));
    // exactly one row for the path, POST only (a GET falls to the static route's 405 in Next, never to /api/parts/[id])
    expect(allRoutePolicies().filter((row) => row.path === PATH).map((row) => row.method)).toEqual(["POST"]);
    expect(PATH.startsWith("/api/component-selection")).toBe(false);
  });

  it("is classified: no durable access, caller-supplied only, provider credit, never public", () => {
    const row = routeResourceClassification().find((item) => item.path === PATH && item.method === "POST");
    expect(row).toMatchObject({ isPublic: false, durableAccess: "none", projectDataSensitivity: "caller-supplied-only", providerCredit: true, externalProcess: "", authoritativeWrite: false, staticOrCatalog: false });
  });

  it("is a canonical wrapper, covered by the action record parts.external-observation-read (a read; chat tools since E6)", () => {
    const source = readFileSync(join(process.cwd(), "app", "api", "parts", "external-search", "route.ts"), "utf8");
    expect(classifyRouteMethodForm(source, "POST", join(process.cwd(), "app", "api", "parts", "external-search", "route.ts"), process.cwd()).form).toBe("canonical-wrapper");
    const record = ACTION_COVERAGE_REGISTRY.find((item) => item.id === "parts.external-observation-read");
    // [B19-E E6] reviewed pin move: toolExposure "none" -> "chat". Reason: E6 exposes the two bounded Tier 0 agent reads this record
    // owns (sirkit.parts.external-search, sirkit.parts.evidence-read); the route itself is unchanged (pinned in b19-e-external-read-descriptors).
    expect(record).toMatchObject({ kind: "read", toolExposure: "chat", approvalTier: "none", status: "implemented" });
    expect(record!.sources).toEqual(expect.arrayContaining(["app/api/parts/external-search/route.ts", "app/lib/acquisition/external-search.ts", "app/components/editor/BuildLibraryPanel.tsx"]));
    expect(API_ROUTE_COVERAGE.find((entry) => entry.path === PATH)).toEqual({ path: PATH, methods: ["POST"], recordId: "parts.external-observation-read", class: "read" });
  });
});

describe("[B19-E E2] f — refused before any vendor is asked", () => {
  it("an anonymous caller gets 401 and no search runs", async () => {
    stubProduction();
    const res = await POST(req({ query: "NE555DR", mode: "exact", limit: 5 }));
    expect(res.status).toBe(401);
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it("a cross-origin request from a signed-in member is refused (CSRF) and no search runs", async () => {
    stubProduction();
    member();
    const res = await POST(req({ query: "NE555DR", mode: "exact", limit: 5 }, { origin: "http://evil.example" }));
    expect(res.status).toBe(403);
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it("a body over the bound is 413; a non-JSON media type is 415", async () => {
    member();
    const big = await POST(req({ query: "NE555DR", mode: "exact", limit: 5, padding: "x".repeat(5_000) }));
    expect(big.status).toBe(413);
    const text = await POST(req("{}", { "content-type": "text/plain" }));
    expect(text.status).toBe(415);
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it.each(["live", "forceRefresh", "url", "host", "apiKey", "token"])("the body key `%s` is refused with 400", async (key) => {
    member();
    const res = await POST(req({ query: "NE555DR", mode: "exact", limit: 5, [key]: key === "live" || key === "forceRefresh" ? true : "https://evil.example" }));
    expect(res.status).toBe(400);
    expect((await payload(res)).code).toBe("AUTH_AUTHORITATIVE_INPUT_FORBIDDEN");
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it.each([
    ["an undeclared key", { query: "NE555DR", mode: "exact", limit: 5, purpose: "agent" }],
    ["an ownership claim", { query: "NE555DR", mode: "exact", limit: 5, projectId: "other" }],
  ])("%s is refused with 400", async (_label, body) => {
    member();
    const res = await POST(req(body));
    expect(res.status).toBe(400);
    expect(mockSearch).not.toHaveBeenCalled();
  });
});

describe("[B19-E E2] f — a member's search", () => {
  it("live search is the server's decision for an authenticated member, never the body's; the answer is not stored", async () => {
    member("viewer");
    mockSearch.mockResolvedValue(OK_RESULT as never);
    const res = await POST(req({ query: "NE555DR", mode: "exact", limit: 5, sources: ["digikey"] }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await payload(res)).toEqual(OK_RESULT);
    expect(mockSearch).toHaveBeenCalledTimes(1);
    const [input, options] = mockSearch.mock.calls[0]!;
    expect(input).toEqual({ query: "NE555DR", mode: "exact", limit: 5, sources: ["digikey"] });
    // [B19-E E2 review] the memo is scoped to the trusted tenant and project, never one the body names
    expect(options).toEqual({ live: true, purpose: "interactive", scope: { tenantId: "local", projectId: PROJECT } });
  });

  it("[B19-E E2 review] members of different projects search under their own trusted scopes", async () => {
    mockSearch.mockResolvedValue(OK_RESULT as never);
    injectAuthorizedPrincipal({ userId: "u-e2-other", tenantId: "local", projectId: "proj-other", role: "viewer" });
    const res = await POST(req({ query: "NE555DR", mode: "keyword", limit: 5 }, { "x-sirkit-project-id": "proj-other" }));
    expect(res.status).toBe(200);
    expect(mockSearch.mock.calls[0]![1]).toMatchObject({ scope: { tenantId: "local", projectId: "proj-other" } });
  });

  it("the orchestrator's refusal is a 400 with its code", async () => {
    member();
    mockSearch.mockResolvedValue({ ok: false, code: "EXTERNAL_SEARCH_QUERY_INVALID", error: "The query must be 1 to 64 printable ASCII characters." } as never);
    const res = await POST(req({ query: "", mode: "exact", limit: 5 }));
    expect(res.status).toBe(400);
    expect(await payload(res)).toMatchObject({ ok: false, code: "EXTERNAL_SEARCH_QUERY_INVALID" });
  });

  it("a failure answers one fixed sentence: no secret, no vendor text, no transport text", async () => {
    member();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockSearch.mockRejectedValue(new Error(`upstream said: <html>Access denied for key=${SENTINEL}</html> connect ECONNREFUSED db-7.corp:5432 password=hunter2`));
    const res = await POST(req({ query: "NE555DR", mode: "exact", limit: 5 }));
    expect(res.status).toBe(500);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const text = await res.text();
    for (const leaked of [SENTINEL, "Access denied", "upstream", "ECONNREFUSED", "db-7", "hunter2"]) expect(text).not.toContain(leaked);
    expect(JSON.parse(text)).toEqual({ ok: false, error: "The distributor search could not be completed. Try again; if it persists, the server log has the details." });
    const logged = vi.mocked(console.error).mock.calls.flat().map(String).join("\n");
    expect(logged).not.toContain(SENTINEL);
    expect(logged).not.toContain("hunter2");
  });

  it("an unauthenticated local identity is still refused", async () => {
    stubProduction();
    injectIdentity(null);
    const res = await POST(req({ query: "NE555DR", mode: "exact", limit: 5 }));
    expect(res.status).toBe(401);
    expect(mockSearch).not.toHaveBeenCalled();
  });
});
