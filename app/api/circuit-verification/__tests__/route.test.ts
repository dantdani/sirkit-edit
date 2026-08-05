import { describe, expect, it } from "vitest";
import { POST as problemPost } from "../problem/route";
import { POST as readinessPost } from "../readiness/route";
import { POST as runPost } from "../run/route";
import { verificationFixture } from "@/app/lib/circuit-verification/__tests__/fixtures";

function request(path: string, projectId: string, branchId: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", "x-sirkit-tenant-id": "tenant:test", "x-sirkit-project-id": projectId, "x-sirkit-branch-id": branchId, "x-sirkit-actor-id": "user:test", "x-sirkit-role": "project_admin" }, body: JSON.stringify(body) });
}

describe("CD-9 scoped APIs", () => {
  it("compiles only the exact approved CD-8 handoff", async () => {
    const fixture = verificationFixture(), response = await problemPost(request("/api/circuit-verification/problem", fixture.problem.projectId, fixture.problem.branchId, { schematicProject: fixture.schematicProject, upstreamSignoff: fixture.upstreamSignoff, registry: fixture.registry, requirementRevisionRefs: [], requiredContextKinds: ["static_unpowered", "static_powered"] }));
    const body = await response.json() as { ok: boolean; problem?: { semanticGraphDigest: string } };
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.problem?.semanticGraphDigest).toBe(fixture.graph.deterministicDigest);
  });

  it("runs the complete denominator through the full oracle", async () => {
    const fixture = verificationFixture(), response = await runPost(request("/api/circuit-verification/run", fixture.problem.projectId, fixture.problem.branchId, { problem: fixture.problem, graph: fixture.graph, registry: fixture.registry, requirementCoverage: [] }));
    const body = await response.json() as { ok: boolean; denominator?: { instances: unknown[] }; run?: { runKind: string; results: unknown[] } };
    expect(response.status).toBe(200);
    expect(body.run?.runKind).toBe("full");
    expect(body.run?.results).toHaveLength(body.denominator?.instances.length ?? -1);
  });

  it("keeps incomplete coverage out of READY", async () => {
    const fixture = verificationFixture(), response = await readinessPost(request("/api/circuit-verification/readiness", fixture.problem.projectId, fixture.problem.branchId, { problem: fixture.problem, graphDigest: fixture.graph.deterministicDigest, registry: fixture.registry, denominator: fixture.denominator, requirementCoverage: [] }));
    const body = await response.json() as { report?: { verdict: string; permittedActions: string[] } };
    expect(body.report?.verdict).toBe("VERIFICATION_INCOMPLETE");
    expect(body.report?.permittedActions).not.toContain("approve_for_CD10");
  });

  it("rejects an out-of-scope request", async () => {
    const fixture = verificationFixture(), response = await runPost(request("/api/circuit-verification/run", "project:other", fixture.problem.branchId, { problem: fixture.problem, graph: fixture.graph, registry: fixture.registry }));
    expect(response.status).toBe(422);
  });
});
