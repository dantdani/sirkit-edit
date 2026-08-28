import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { injectAuthorizedPrincipal, injectIdentity, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { POST as execute } from "../execute/route";
import { POST as problem } from "../problem/route";
import { POST as propose } from "../propose/route";

// B16.0.1: identity/actor/role are SERVER-DERIVED via TrustedRequestContext.
// x-sirkit-actor-id / x-sirkit-role / x-sirkit-actor-kind headers are no
// longer read by any route; only tenant/project/branch remain as a SELECTOR
// (never authority). Same-origin CSRF is automatic for POST, so legitimate
// requests carry a matching Origin header.
function request(path: string, body: unknown, extra: Record<string, string> = {}) { return new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", "x-sirkit-tenant-id": "tenant:test", "x-sirkit-project-id": "project:test", "x-sirkit-branch-id": "branch:test", ...extra }, body: JSON.stringify(body) }); }

beforeEach(() => { injectAuthorizedPrincipal({ userId: "human-1", tenantId: "tenant:test", projectId: "project:test", role: "admin" }); });
afterEach(() => { resetInjectedIdentity(); });

describe("CD-10 scoped API authority", () => {
  it("rejects unauthenticated, unscoped, and role-denied calls", async () => {
    // B16.0.1: the old "no identity headers => 401" relied on caller-asserted
    // identity. The server-derived equivalent-or-stronger checks are:
    // (1) no verified session => 401 — identity can never be forged via headers.
    injectIdentity(null);
    const unauthenticatedResponse = await problem(request("/api/model-simulation/problem", {}));
    expect(unauthenticatedResponse.status).toBe(401);
    expect((await unauthenticatedResponse.json()).code).toBe("AUTH_UNAUTHENTICATED");

    // (2) an authenticated call with NO project selector is refused 400 before
    // any membership/authority load — the modern "unscoped" refusal.
    injectAuthorizedPrincipal({ userId: "human-1", tenantId: "tenant:test", projectId: "project:test", role: "admin" });
    const unscoped = await problem(new Request("http://localhost/api/model-simulation/problem", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost" }, body: "{}" }));
    expect(unscoped.status).toBe(400);
    expect((await unscoped.json()).code).toBe("AUTH_PROJECT_SELECTOR_REQUIRED");

    // (3) a viewer MEMBERSHIP role (server-derived, never a header) is denied
    // the propose-class route with 403 before any compile work happens.
    injectAuthorizedPrincipal({ userId: "viewer-1", tenantId: "tenant:test", projectId: "project:test", role: "viewer" });
    const denied = await problem(request("/api/model-simulation/problem", {}));
    expect(denied.status).toBe(403);
    expect((await denied.json()).code).toBe("AUTH_ROLE_DENIED");
  });
  // B16.0.1: an AI actor kind can no longer be asserted via x-sirkit-actor-kind
  // (a strictly stronger guarantee). The propose route mints PROPOSAL-ONLY
  // artifacts requiring human review for EVERY permitted actor, so the CD-10
  // proposal-authority invariant is unchanged.
  it("creates only proposal-only artifacts that require human review", async () => { const response = await propose(request("/api/model-simulation/propose", { problemDigest: "problem:test", proposalKind: "diagnostic", proposedActions: [{ action: "review_model", rationale: "Missing exact model" }] })); const body = await response.json(); expect(response.status).toBe(200); expect(body.proposal.authority).toBe("proposal_only"); expect(body.requiresHumanReview).toBe(true); });
  it("denies execution when provider/environment authority is absent", async () => { const response = await execute(request("/api/model-simulation/execute", { provider: { deterministicDigest: "provider:test", reviewState: "diagnostic_only", lifecycleState: "active", authoritativeEligible: false }, environment: { providerRevisionId: "provider:test", validationState: "diagnostic_only", networkPolicy: "allowlisted", resourceLimits: { timeoutMs: 1000, outputBytes: 1000, memoryMiB: 0 } }, manifest: { providerRevisionId: "provider:test", modelIncludeAndDigestMappings: [], structuralValidationResults: [] }, availableContentDigests: [], requestedTimeoutMs: 100, requestedOutputBytes: 100 })); const body = await response.json(); expect(response.status).toBe(409); expect(body.authorization.mode).not.toBe("authoritative"); });
});
