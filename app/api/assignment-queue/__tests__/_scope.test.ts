import { afterEach, describe, expect, it } from "vitest";
import { ASSIGNMENT_API_MAX_BYTES, assignmentApiScope, scopedAssignmentJson } from "../_scope";
import { authorizeRequest } from "@/app/lib/auth/authorize";
import { injectAuthorizedPrincipal, resetInjectedIdentity } from "@/app/lib/auth/test-support";

// B16.0: identity/actor/role are now SERVER-DERIVED (default local_dev fixed
// principal in tests); `x-sirkit-project-id`/`-tenant-id`/`-branch-id` remain
// SELECTORS. This suite keeps the request-boundary checks (same-origin,
// selector shape, media type, size, authoritative-input refusal); the
// identity/membership authz invariants live in the dedicated B16.0 suites.
const baseHeaders = { "content-type": "application/json", "x-sirkit-tenant-id": "tenant-1", "x-sirkit-project-id": "project-1", "x-sirkit-branch-id": "main", origin: "http://localhost" };
function request(body: unknown = {}, headers: Record<string, string> = {}): Request { return new Request("http://localhost/api/assignment-queue", { method: "POST", headers: { ...baseHeaders, ...headers }, body: JSON.stringify(body) }); }

// B16.0.1: same-origin CSRF is enforced by the exact route policy inside
// authorizeRequest, and ONLY in production auth mode (mode.ts §G —
// local_dev/tests need no browser origin). Production mode is entered here
// via the injectable environment, exactly as in the dedicated B16.0 suite.
const PRODUCTION_ENV = { SIRKIT_AUTH_MODE: "production", NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x", SIRKIT_EXPECTED_ORIGIN: "http://localhost" } as const;

describe("assignment queue API boundary", () => {
  afterEach(() => resetInjectedIdentity());

  it("requires a bounded safe project selector and rejects cross-origin requests", async () => {
    // Missing project selector (a bare GET carries none) → refused.
    expect((await assignmentApiScope(new Request("http://localhost/api/assignment-queue"))).ok).toBe(false);
    // Malformed selector → refused.
    expect((await assignmentApiScope(request({}, { "x-sirkit-project-id": "../other" }))).ok).toBe(false);
    // B16.0.1: a cross-origin state-changing request is refused (CSRF) by the
    // POST /api/assignment-queue policy (requiresCsrf) in PRODUCTION auth
    // mode — even for a fully authenticated, role-authorized member. In
    // local_dev the origin check is deliberately skipped, so the refusal is
    // proven through authorizeRequest with a production environment.
    injectAuthorizedPrincipal({ userId: "u1", tenantId: "tenant-1", projectId: "project-1", role: "editor" });
    const crossOrigin = await authorizeRequest(request({}, { origin: "https://attacker.example" }), { environment: PRODUCTION_ENV });
    expect(crossOrigin.ok).toBe(false);
    if (!crossOrigin.ok) {
      expect(crossOrigin.response.status).toBe(403);
      expect(((await crossOrigin.response.json()) as { code?: string }).code).toBe("AUTH_CROSS_ORIGIN_DENIED");
    }
    // B16.0.1: an origin-LESS mutation is likewise refused in production.
    const headersWithoutOrigin: Record<string, string> = { ...baseHeaders };
    delete headersWithoutOrigin.origin;
    const noOrigin = await authorizeRequest(new Request("http://localhost/api/assignment-queue", { method: "POST", headers: headersWithoutOrigin, body: "{}" }), { environment: PRODUCTION_ENV });
    expect(noOrigin.ok).toBe(false);
    if (!noOrigin.ok) {
      expect(noOrigin.response.status).toBe(403);
      expect(((await noOrigin.response.json()) as { code?: string }).code).toBe("AUTH_ORIGIN_MISSING");
    }
    resetInjectedIdentity();
    // Same-origin, valid selector → accepted (identity is the local_dev principal).
    expect((await assignmentApiScope(request({}))).ok).toBe(true);
  });

  it("rejects oversized, malformed, non-object, and authoritative mutation payloads", async () => {
    const oversized = request({}, { "content-length": String(ASSIGNMENT_API_MAX_BYTES + 1) });
    expect((await scopedAssignmentJson(oversized)).ok).toBe(false);
    const malformed = new Request("http://localhost/api/assignment-queue", { method: "POST", headers: baseHeaders, body: "{" });
    expect((await scopedAssignmentJson(malformed)).ok).toBe(false);
    expect((await scopedAssignmentJson(request([]))).ok).toBe(false);
    expect((await scopedAssignmentJson(request({ board: {} }))).ok).toBe(false);
  });

  it("uses the authenticated scope rather than a body-supplied scope", async () => {
    const parsed = await scopedAssignmentJson(request({ operation: "preview", tenantId: "attacker" }));
    expect(parsed.ok && parsed.scope.tenantId).toBe("tenant-1");
  });
});
