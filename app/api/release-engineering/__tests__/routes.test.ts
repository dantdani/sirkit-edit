import { describe, expect, it } from "vitest";
import { POST as compileProblem } from "../problem/route";
import { POST as propose } from "../propose/route";
const headers = { "content-type": "application/json", "x-sirkit-tenant-id": "tenant:test", "x-sirkit-project-id": "project:test", "x-sirkit-branch-id": "branch:test", "x-sirkit-actor-id": "engineer:test", "x-sirkit-role": "project_admin" };
describe("CD-12 API authority and prerequisite behavior", () => {
  it("returns the exact CD-11 blocker without creating partial authority", async () => { const response = await compileProblem(new Request("http://localhost/api/release-engineering/problem", { method: "POST", headers, body: JSON.stringify({ requestedReleaseLevel: "CAD-ready", upstreamRefs: [], assemblyVariantIds: ["base"] }) })); expect(response.status).toBe(409); const body = await response.json(); expect(body.verdict).toBe("BLOCKED BY CD-11"); });
  it("accepts narrow proposals but exposes no side effect", async () => { const response = await propose(new Request("http://localhost/api/release-engineering/propose", { method: "POST", headers: { ...headers, "x-sirkit-actor-kind": "ai" }, body: JSON.stringify({ problemDigest: "problem:1", kind: "release_level_review", targetRefs: ["candidate:1"], typedActions: [{ action: "evaluate", typedInputRefs: ["manifest:1"], rationale: "show blockers" }] }) })); expect(response.status).toBe(200); const body = await response.json(); expect(body.proposal.authority).toBe("proposal_only"); expect(body.hasExternalOrPurchasingSideEffects).toBe(false); });
});

