import { afterEach, describe, expect, it } from "vitest";
import { injectAuthorizedPrincipal, injectIdentity, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { POST as problem } from "../problem/route";
import { POST as propose } from "../propose/route";
// B16.0.1: identity is SERVER-DERIVED (authorizeRequest → resolveTrustedRequestContext); the
// x-sirkit-actor-id / x-sirkit-role / x-sirkit-actor-kind headers are no longer read. Only the
// tenant/project/branch SELECTOR headers remain (never authority). Legitimate requests carry a
// same-origin Origin header; in the test environment the fixed local_dev principal authenticates
// unless a test injects identity through @/app/lib/auth/test-support.
function request(path: string, body: unknown) { return new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", "x-sirkit-tenant-id": "tenant:test", "x-sirkit-project-id": "project:test", "x-sirkit-branch-id": "branch:test" }, body: JSON.stringify(body) }); }
describe("CD-11 API authority", () => {
  afterEach(() => { resetInjectedIdentity(); });
  // B16.0.1: the old "rejects missing scope → 401" relied on caller-asserted identity headers.
  // Its server-derived equivalents are stronger: an UNAUTHENTICATED principal is refused 401
  // regardless of headers; an authenticated request without a project selector is refused 400.
  it("rejects an unauthenticated principal with 401", async () => { injectIdentity(null); const response = await problem(request("/api/firmware-bringup/problem", {})), body = await response.json(); expect(response.status).toBe(401); expect(body.code).toBe("AUTH_UNAUTHENTICATED"); });
  it("rejects a request without a project selector with 400", async () => { const response = await problem(new Request("http://localhost/api/firmware-bringup/problem", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost" }, body: "{}" })), body = await response.json(); expect(response.status).toBe(400); expect(body.code).toBe("AUTH_PROJECT_SELECTOR_REQUIRED"); });
  // B16.0.1: propose routes permit EDITORS only — a viewer membership is refused 403 before any work.
  it("rejects a viewer membership with 403", async () => { injectAuthorizedPrincipal({ userId: "viewer-1", tenantId: "tenant:test", projectId: "project:test", role: "viewer" }); const response = await problem(request("/api/firmware-bringup/problem", {})), body = await response.json(); expect(response.status).toBe(403); expect(body.code).toBe("AUTH_ROLE_DENIED"); });
  it("returns BLOCKED BY CD-10 without fabricating later artifacts", async () => { const response = await problem(request("/api/firmware-bringup/problem", { requestedScope: ["bringup"], equipmentProfileRefs: ["lab:test"], toolchainProviderRefs: ["tool:test"], firmwareArchitecturePolicyRef: "fw:policy", securityPolicyRef: "security:policy" })), body = await response.json(); expect(response.status).toBe(409); expect(body.verdict).toBe("BLOCKED BY CD-10"); });
  // B16.0.1: actor kind is server-derived (this HTTP boundary only ever yields a human actor);
  // proposals remain proposal_only and require human review regardless of who proposes.
  it("keeps AI changes proposal-only", async () => { const response = await propose(request("/api/firmware-bringup/propose", { problemDigest: "problem:test", kind: "dft_access", targetRefs: ["net:rail"], actions: [{ action: "request_test_access", rationale: "critical rail unobservable", typedInputRefs: ["dft:rail"] }] })), body = await response.json(); expect(body.proposal.authority).toBe("proposal_only"); expect(body.requiresHumanReview).toBe(true); });
});
