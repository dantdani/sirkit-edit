import { afterEach, describe, expect, it } from "vitest";
import { injectAuthorizedPrincipal, injectIdentity, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { makeFixtureCatalog, TEST_NOW } from "@/app/lib/atomic/__tests__/fixtures";
import { createEngineeringCatalogSnapshot } from "@/app/lib/component-selection/catalog";
import { POST as alternative } from "../alternative/route";
import { POST as catalog } from "../catalog/route";
import { POST as evaluate } from "../evaluate/route";
import { POST as exportBundle } from "../export/route";
import { POST as feedback } from "../feedback/route";
import { POST as problem } from "../problem/route";
import { POST as solve } from "../solve/route";
import { POST as sourcing } from "../sourcing/route";

// B16.0.1: identity/actor/role are SERVER-DERIVED (TrustedRequestContext) — the
// x-sirkit-actor-id / x-sirkit-role headers are no longer read by any route.
// Only the tenant/project/branch SELECTOR headers remain (never authority).
// A same-origin Origin header accompanies every legitimate state-changing
// request per the automatic CSRF policy.
const headers = { "content-type": "application/json", origin: "http://localhost", "x-sirkit-tenant-id": "tenant:test", "x-sirkit-project-id": "project:test", "x-sirkit-branch-id": "branch:test" };
const request = (path: string, body: unknown, scoped = true) => new Request(`http://localhost/api/component-selection/${path}`, { method: "POST", headers: scoped ? headers : { "content-type": "application/json", origin: "http://localhost" }, body: JSON.stringify(body) });

function pinnedCatalog() {
  const fixture = makeFixtureCatalog();
  return createEngineeringCatalogSnapshot({ portableSnapshots: [fixture.catalog.portableSnapshot(fixture.published.id, TEST_NOW)], recipeOverlayRevisionIds: [], sourceAdapterRevisionIds: ["fixture"], publicationPolicyRevision: "fixture", createdAt: TEST_NOW.toISOString() });
}

describe("CD-6 typed API boundaries", () => {
  afterEach(() => { resetInjectedIdentity(); });

  // B16.0.1: the old "missing x-sirkit-* headers => 401" relied on caller-
  // asserted identity headers, which no route reads any more. The equivalent-
  // or-stronger server-derived assertions are:
  //   1. an UNAUTHENTICATED principal is refused 401 before any work;
  //   2. an authenticated request still REQUIRES the project selector (400);
  //   3. an authenticated member whose membership role is insufficient for a
  //      propose route (EDITORS) is refused 403 before any work.
  it("refuses an unauthenticated request", async () => {
    injectIdentity(null);
    const response = await catalog(request("catalog", {}));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ ok: false, code: "AUTH_UNAUTHENTICATED" });
  });
  it("requires the tenant/project/branch selector", async () => {
    const response = await catalog(request("catalog", {}, false));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, code: "AUTH_PROJECT_SELECTOR_REQUIRED" });
  });
  it("refuses a viewer on a propose route", async () => {
    injectAuthorizedPrincipal({ userId: "viewer-1", tenantId: "tenant:test", projectId: "project:test", role: "viewer" });
    const response = await problem(request("problem", {}));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ ok: false, code: "AUTH_ROLE_DENIED" });
  });
  it("resolves exact manufacturer identity against a pinned snapshot", async () => { const response = await catalog(request("catalog", { operation: "resolve_identity", catalog: pinnedCatalog(), manufacturerId: "manufacturer_fixture", mpn: "FX-100-QFN", now: TEST_NOW.toISOString() })); expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ ok: true, resolution: { state: "exact", exactManufacturerPartId: "exact_fixture" } }); });
  it("rejects an unpinned problem payload", async () => { expect((await problem(request("problem", {}))).status).toBe(400); });
  it("rejects an unpinned evaluation payload", async () => { expect((await evaluate(request("evaluate", { problemId: "x" }))).status).toBe(400); });
  it("rejects an unpinned solver payload", async () => { expect((await solve(request("solve", { evaluations: [] }))).status).toBe(400); });
  it("does not invent live sourcing when no approved provider is configured", async () => { const response = await sourcing(request("sourcing", { operation: "refresh" })); expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ ok: false }); });
  it("requires an independently evaluated alternative", async () => { expect((await alternative(request("alternative", { requestedClass: "approved_substitute" }))).status).toBe(400); });
  it("accepts typed downstream feedback without mutating a design", async () => { const response = await feedback(request("feedback", { sourceStage: "CD-7", candidateId: "candidate:test", affectedAssignmentIds: ["assignment:test"], dependencyIds: ["model:test"], outcome: "reject", reason: "corner calculation failed", evidenceRefs: ["calculation:test"], createdAt: TEST_NOW.toISOString() })); expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ ok: true, consequence: "invalidate_affected_assignments_and_rerun_bounded_solver" }); });
  it("requires a pinned state for export", async () => { expect((await exportBundle(request("export", { candidateId: "candidate:test" }))).status).toBe(400); });
});
