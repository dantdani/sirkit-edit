import { afterEach, describe, expect, it } from "vitest";
import { injectAuthorizedPrincipal, injectIdentity, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { POST as applicability } from "../applicability/route";
import { POST as compile } from "../compile/route";
import { POST as compose } from "../compose/route";
import { recipe, sourceBundle } from "../../../lib/circuit-knowledge/__tests__/fixtures";

// B16.0.1: identity/role are SERVER-DERIVED via authorizeRequest — the
// x-sirkit-actor-id / x-sirkit-role headers are no longer read. Only the
// tenant/project/branch headers remain, as a SELECTOR (never authority).
// Same-origin requests carry a matching Origin header.
const headers = { "content-type": "application/json", origin: "http://localhost", "x-sirkit-tenant-id": "tenant:test", "x-sirkit-project-id": "project:test", "x-sirkit-branch-id": "branch:test" };
const request = (path: string, body: unknown, scoped = true) => new Request(`http://localhost/api/circuit-knowledge/${path}`, { method: "POST", headers: scoped ? headers : { "content-type": "application/json", origin: "http://localhost" }, body: JSON.stringify(body) });

describe("CD-5 typed API boundaries", () => {
  afterEach(() => { resetInjectedIdentity(); });
  it("refuses unauthenticated, selector-less, and role-denied requests", async () => {
    // B16.0.1: an unauthenticated request (no verified session) → 401. The old
    // "missing x-sirkit-* identity headers → 401" cannot exist any more —
    // identity is server-derived and cannot be asserted or omitted via headers.
    injectIdentity(null);
    expect((await compile(request("compile", { recipe: recipe(), sourceBundle: sourceBundle() }))).status).toBe(401);
    resetInjectedIdentity();
    // B16.0.1: with a verified principal, a request without the project
    // SELECTOR header is refused 400 AUTH_PROJECT_SELECTOR_REQUIRED — the
    // selector is still required, but it is never authority.
    const selectorless = await compile(request("compile", { recipe: recipe(), sourceBundle: sourceBundle() }, false));
    expect(selectorless.status).toBe(400);
    expect(await selectorless.json()).toMatchObject({ code: "AUTH_PROJECT_SELECTOR_REQUIRED" });
    // B16.0.1: role comes from ACTIVE project membership, never a header. A
    // viewer membership is refused the propose-class route with 403 — a
    // strictly stronger guarantee than the old caller-asserted role.
    injectAuthorizedPrincipal({ userId: "viewer-1", tenantId: "tenant:test", projectId: "project:test", role: "viewer" });
    const denied = await compile(request("compile", { recipe: recipe(), sourceBundle: sourceBundle() }));
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ code: "AUTH_ROLE_DENIED" });
  });
  it("compiles an evidence-backed recipe and returns no-store", async () => { const response = await compile(request("compile", { recipe: recipe(), sourceBundle: sourceBundle() })); const body = await response.json() as { ok: boolean; compiled: { publicationEligible: boolean } }; expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store"); expect(body).toMatchObject({ ok: true, compiled: { publicationEligible: true } }); });
  it("returns explicit applicability without selecting a part", async () => { const response = await applicability(request("applicability", { recipe: recipe(), recipeRequest: { requestId: "request", sourceStage: "CD-4", sourceObligationId: "role", semanticRole: "open_drain_bias", hardCriteria: [], softCriteria: [], operatingConditions: ["active"], requiredPortsDomains: [], requiredModelsChecks: [], exactOverlayRequired: false, requirementIds: [] }, context: { architectureRoleKinds: ["open_drain_bus"], inputOutputEnvelopes: [], topologyClasses: ["shared_bus"], modesStates: ["active"], environmentEnvelopeIds: [], interfaceContracts: [], powerGroundIsolationContracts: [], componentCapabilities: [], evidenceStates: ["pass"], modelCapabilities: [], activeConditions: [] } })); expect(await response.json()).toMatchObject({ ok: true, result: { state: "true" } }); });
  it("rejects malformed composition input", async () => { const response = await compose(request("compose", { bindings: "not-an-array", recipes: [] })); expect(response.status).toBe(400); expect(await response.json()).toMatchObject({ ok: false }); });
});
