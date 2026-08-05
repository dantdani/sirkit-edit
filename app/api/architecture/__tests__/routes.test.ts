import { describe, expect, it } from "vitest";
import { POST as compileProblem } from "../problem/route";
import { POST as compileCandidate } from "../candidates/route";
import { POST as generateAlternatives } from "../alternatives/route";
import { POST as compareCandidates } from "../compare/route";
import { acceptedRequirementsPackage, architectureCandidate, architectureProblem, architectureProposal } from "@/app/lib/architecture/__tests__/fixtures";

const headers = { "content-type": "application/json", "x-sirkit-tenant-id": "tenant:test", "x-sirkit-project-id": "project:test", "x-sirkit-branch-id": "main", "x-sirkit-actor-id": "owner" };

describe("CD-2 scoped architecture APIs", () => {
  it("compiles an accepted package into a pinned problem", async () => { const response = await compileProblem(new Request("http://local/api/architecture/problem", { method: "POST", headers, body: JSON.stringify({ requirementsPackage: acceptedRequirementsPackage() }) })); expect(response.status).toBe(200); const body = await response.json(); expect(body.ok).toBe(true); expect(body.problem.requirementsPackageRef.status).toBe("accepted_for_architecture_exploration"); });
  it("rejects a project scope mismatch", async () => { const response = await compileProblem(new Request("http://local/api/architecture/problem", { method: "POST", headers: { ...headers, "x-sirkit-project-id": "foreign" }, body: JSON.stringify({ requirementsPackage: acceptedRequirementsPackage() }) })); expect(response.status).toBe(403); });
  it("rejects implementation leakage in candidate proposals", async () => { const problem = architectureProblem(); const proposal = architectureProposal(problem); proposal.blocks[0].description = "Use an STM32 part"; const response = await compileCandidate(new Request("http://local/api/architecture/candidates", { method: "POST", headers, body: JSON.stringify({ problem, proposal }) })); expect(response.status).toBe(422); const body = await response.json(); expect(body.diagnostics.map((item: { code: string }) => item.code)).toContain("PROPOSAL_CONCRETE_IMPLEMENTATION_FORBIDDEN"); });
  it("generates three bounded alternatives without LLM authority", async () => { const response = await generateAlternatives(new Request("http://local/api/architecture/alternatives", { method: "POST", headers, body: JSON.stringify({ problem: architectureProblem(), count: 3 }) })); expect(response.status).toBe(200); const body = await response.json(); expect(body.candidates).toHaveLength(3); expect(new Set(body.candidates.map((item: { structuralSignature: string }) => item.structuralSignature)).size).toBe(3); });
  it("refuses to compare duplicate structures", async () => { const candidate = architectureCandidate(); const response = await compareCandidates(new Request("http://local/api/architecture/compare", { method: "POST", headers, body: JSON.stringify({ candidates: [candidate, candidate] }) })); expect(response.status).toBe(422); expect(await response.json()).toMatchObject({ ok: false, error: "ISOMORPHIC_ARCHITECTURE_ALTERNATIVE" }); });
});
