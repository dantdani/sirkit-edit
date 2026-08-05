import { describe, expect, it } from "vitest";
import { POST as applicability } from "../applicability/route";
import { POST as compile } from "../compile/route";
import { POST as compose } from "../compose/route";
import { recipe, sourceBundle } from "../../../lib/circuit-knowledge/__tests__/fixtures";

const headers = { "content-type": "application/json", "x-sirkit-tenant-id": "tenant:test", "x-sirkit-project-id": "project:test", "x-sirkit-branch-id": "branch:test", "x-sirkit-actor-id": "actor:test", "x-sirkit-role": "reviewer" };
const request = (path: string, body: unknown, scoped = true) => new Request(`http://localhost/api/circuit-knowledge/${path}`, { method: "POST", headers: scoped ? headers : { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("CD-5 typed API boundaries", () => {
  it("requires tenant/project/branch/actor scope", async () => { expect((await compile(request("compile", { recipe: recipe(), sourceBundle: sourceBundle() }, false))).status).toBe(401); });
  it("compiles an evidence-backed recipe and returns no-store", async () => { const response = await compile(request("compile", { recipe: recipe(), sourceBundle: sourceBundle() })); const body = await response.json() as { ok: boolean; compiled: { publicationEligible: boolean } }; expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store"); expect(body).toMatchObject({ ok: true, compiled: { publicationEligible: true } }); });
  it("returns explicit applicability without selecting a part", async () => { const response = await applicability(request("applicability", { recipe: recipe(), recipeRequest: { requestId: "request", sourceStage: "CD-4", sourceObligationId: "role", semanticRole: "open_drain_bias", hardCriteria: [], softCriteria: [], operatingConditions: ["active"], requiredPortsDomains: [], requiredModelsChecks: [], exactOverlayRequired: false, requirementIds: [] }, context: { architectureRoleKinds: ["open_drain_bus"], inputOutputEnvelopes: [], topologyClasses: ["shared_bus"], modesStates: ["active"], environmentEnvelopeIds: [], interfaceContracts: [], powerGroundIsolationContracts: [], componentCapabilities: [], evidenceStates: ["pass"], modelCapabilities: [], activeConditions: [] } })); expect(await response.json()).toMatchObject({ ok: true, result: { state: "true" } }); });
  it("rejects malformed composition input", async () => { const response = await compose(request("compose", { bindings: "not-an-array", recipes: [] })); expect(response.status).toBe(400); expect(await response.json()).toMatchObject({ ok: false }); });
});
