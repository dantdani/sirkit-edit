import { afterEach, describe, expect, it } from "vitest";
import { POST as alternatives } from "../alternatives/route";
import { POST as allocate } from "../allocate/route";
import { POST as candidates } from "../candidates/route";
import { POST as compare } from "../compare/route";
import { POST as problemRoute } from "../problem/route";
import { injectAuthorizedPrincipal, injectIdentity, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { synthesizeInterfacePlanningProposals } from "@/app/lib/interfaces/alternatives";
import { interfaceDigest } from "@/app/lib/interfaces/stable";
import { allocationProblem, interfaceCandidate, interfaceProblem, interfaceProblemInput } from "@/app/lib/interfaces/__tests__/fixtures";

// B16.0.1: identity is SERVER-DERIVED (authorizeRequest + resolveTrustedRequestContext);
// x-sirkit-actor-id / x-sirkit-role headers are no longer read by any route. Only the
// tenant/project/branch SELECTOR headers remain (never authority). In the test
// environment the identity resolves to the local_dev project_admin principal unless a
// test injects one via @/app/lib/auth/test-support.
const scoped = (projectId: string, branchId: string) => ({ "content-type": "application/json", "x-sirkit-tenant-id": "tenant:test", "x-sirkit-project-id": projectId, "x-sirkit-branch-id": branchId });

describe("CD-4 scoped HTTP APIs", () => {
  afterEach(() => { resetInjectedIdentity(); });
  it("requires server-derived identity and rejects cross-project problem input", async () => {
    const input = interfaceProblemInput();
    // B16.0.1: the old "no scope headers ⇒ 401" relied on caller-asserted identity headers.
    // Stronger server-derived equivalents: an unauthenticated principal ⇒ 401 ...
    injectIdentity(null);
    const unauthenticated = await problemRoute(new Request("http://local/api/interfaces/problem", { method: "POST", headers: scoped(input.requirementsPackage.projectId, input.branchId), body: JSON.stringify(input) }));
    expect(unauthenticated.status).toBe(401);
    expect(await unauthenticated.json()).toMatchObject({ ok: false, code: "AUTH_UNAUTHENTICATED" });
    resetInjectedIdentity();
    // ... a request with NO project selector refuses with 400 AUTH_PROJECT_SELECTOR_REQUIRED ...
    const unselected = await problemRoute(new Request("http://local/api/interfaces/problem", { method: "POST", body: JSON.stringify(input) }));
    expect(unselected.status).toBe(400);
    expect(await unselected.json()).toMatchObject({ ok: false, code: "AUTH_PROJECT_SELECTOR_REQUIRED" });
    // ... and a viewer membership is refused 403 AUTH_ROLE_DENIED before any compile.
    injectAuthorizedPrincipal({ userId: "viewer-1", tenantId: "tenant:test", projectId: input.requirementsPackage.projectId, role: "viewer" });
    const viewerDenied = await problemRoute(new Request("http://local/api/interfaces/problem", { method: "POST", headers: scoped(input.requirementsPackage.projectId, input.branchId), body: JSON.stringify(input) }));
    expect(viewerDenied.status).toBe(403);
    expect(await viewerDenied.json()).toMatchObject({ ok: false, code: "AUTH_ROLE_DENIED" });
    resetInjectedIdentity();
    // Cross-project body scope still refuses (route-level scope mismatch, unchanged).
    const response = await problemRoute(new Request("http://local/api/interfaces/problem", { method: "POST", headers: scoped("foreign", input.branchId), body: JSON.stringify(input) }));
    expect(response.status).toBe(403);
  });
  it("compiles a pinned interface problem", async () => { const input = interfaceProblemInput(); const response = await problemRoute(new Request("http://local/api/interfaces/problem", { method: "POST", headers: scoped(input.requirementsPackage.projectId, input.branchId), body: JSON.stringify(input) })); expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ ok: true, problem: { projectId: input.requirementsPackage.projectId } }); });
  it("generates and compiles bounded alternatives", async () => { const input = interfaceProblemInput(); const problem = interfaceProblem(); const architecture = input.architectureState.candidates.find((item) => item.candidateId === input.architectureState.selection!.candidateId)!; const power = input.powerState.candidates.find((item) => item.candidateId === input.powerState.selection!.candidateId)!; const response = await alternatives(new Request("http://local/api/interfaces/alternatives", { method: "POST", headers: scoped(problem.projectId, problem.branchId), body: JSON.stringify({ problem, architecture, power, count: 3 }) })); expect(response.status).toBe(200); const body = await response.json() as { candidates: unknown[] }; expect(body.candidates).toHaveLength(3); const proposal = synthesizeInterfacePlanningProposals(problem, architecture)[0]; const one = await candidates(new Request("http://local/api/interfaces/candidates", { method: "POST", headers: scoped(problem.projectId, problem.branchId), body: JSON.stringify({ problem, architecture, power, proposal }) })); expect(one.status).toBe(200); });
  it("compares same-project candidates and rejects foreign scope", async () => { const problem = interfaceProblem(); const values = [0, 1, 2].map((index) => interfaceCandidate(index, problem)); const ok = await compare(new Request("http://local/api/interfaces/compare", { method: "POST", headers: scoped(problem.projectId, problem.branchId), body: JSON.stringify({ candidates: values }) })); expect(ok.status).toBe(200); const denied = await compare(new Request("http://local/api/interfaces/compare", { method: "POST", headers: scoped("foreign", problem.branchId), body: JSON.stringify({ candidates: values }) })); expect(denied.status).toBe(403); });
  it("runs exact allocation and its small-problem oracle", async () => { const source = allocationProblem(); const snapshotBase = { snapshotId: source.pinFunctionFactSnapshotId, atomicPartRevisionId: source.atomicPartRevisionId, exactPartId: source.facts[0].exactPartId, packageRevisionId: source.packageRevisionId, factIds: source.facts.map((fact) => fact.factId), facts: source.facts, errataRevisionIds: [], sourceDigests: ["source:digest"], capturedAt: "2026-07-17T12:00:00.000Z" }; const snapshot = { ...snapshotBase, deterministicDigest: interfaceDigest(snapshotBase) }; const response = await allocate(new Request("http://local/api/interfaces/allocate", { method: "POST", headers: scoped("project:test", "main"), body: JSON.stringify({ interfacePlanningCandidateId: source.interfacePlanningCandidateId, snapshot, requirements: source.requirements, constraints: { peripheralResourceConstraints: source.peripheralResourceConstraints } }) })); expect(response.status).toBe(200); const body = await response.json() as { allocations: Array<{ feasibilityState: string }> }; expect(body.allocations).toHaveLength(2); expect(body.allocations.every((item) => item.feasibilityState === "feasible_for_exact_part_package")).toBe(true); });
});

