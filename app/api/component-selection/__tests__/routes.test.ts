import { describe, expect, it } from "vitest";
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

const headers = { "content-type": "application/json", "x-sirkit-tenant-id": "tenant:test", "x-sirkit-project-id": "project:test", "x-sirkit-branch-id": "branch:test", "x-sirkit-actor-id": "actor:test", "x-sirkit-role": "reviewer" };
const request = (path: string, body: unknown, scoped = true) => new Request(`http://localhost/api/component-selection/${path}`, { method: "POST", headers: scoped ? headers : { "content-type": "application/json" }, body: JSON.stringify(body) });

function pinnedCatalog() {
  const fixture = makeFixtureCatalog();
  return createEngineeringCatalogSnapshot({ portableSnapshots: [fixture.catalog.portableSnapshot(fixture.published.id, TEST_NOW)], recipeOverlayRevisionIds: [], sourceAdapterRevisionIds: ["fixture"], publicationPolicyRevision: "fixture", createdAt: TEST_NOW.toISOString() });
}

describe("CD-6 typed API boundaries", () => {
  it("requires tenant/project/branch/actor scope", async () => { expect((await catalog(request("catalog", {}, false))).status).toBe(401); });
  it("resolves exact manufacturer identity against a pinned snapshot", async () => { const response = await catalog(request("catalog", { operation: "resolve_identity", catalog: pinnedCatalog(), manufacturerId: "manufacturer_fixture", mpn: "FX-100-QFN", now: TEST_NOW.toISOString() })); expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ ok: true, resolution: { state: "exact", exactManufacturerPartId: "exact_fixture" } }); });
  it("rejects an unpinned problem payload", async () => { expect((await problem(request("problem", {}))).status).toBe(400); });
  it("rejects an unpinned evaluation payload", async () => { expect((await evaluate(request("evaluate", { problemId: "x" }))).status).toBe(400); });
  it("rejects an unpinned solver payload", async () => { expect((await solve(request("solve", { evaluations: [] }))).status).toBe(400); });
  it("does not invent live sourcing when no approved provider is configured", async () => { const response = await sourcing(request("sourcing", { operation: "refresh" })); expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ ok: false }); });
  it("requires an independently evaluated alternative", async () => { expect((await alternative(request("alternative", { requestedClass: "approved_substitute" }))).status).toBe(400); });
  it("accepts typed downstream feedback without mutating a design", async () => { const response = await feedback(request("feedback", { sourceStage: "CD-7", candidateId: "candidate:test", affectedAssignmentIds: ["assignment:test"], dependencyIds: ["model:test"], outcome: "reject", reason: "corner calculation failed", evidenceRefs: ["calculation:test"], createdAt: TEST_NOW.toISOString() })); expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ ok: true, consequence: "invalidate_affected_assignments_and_rerun_bounded_solver" }); });
  it("requires a pinned state for export", async () => { expect((await exportBundle(request("export", { candidateId: "candidate:test" }))).status).toBe(400); });
});
