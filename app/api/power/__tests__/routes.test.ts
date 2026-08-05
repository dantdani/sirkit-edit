import { describe, expect, it } from "vitest";
import { POST as alternatives } from "../alternatives/route";
import { POST as candidates } from "../candidates/route";
import { POST as compare } from "../compare/route";
import { POST as problem } from "../problem/route";
import { POST as reconcile } from "../reconcile/route";
import { synthesizePowerArchitectureProposals } from "@/app/lib/power/alternatives";
import { powerCandidate, powerProblem, powerProblemInput } from "@/app/lib/power/__tests__/fixtures";

const headers = { "content-type": "application/json", "x-sirkit-tenant-id": "tenant:test", "x-sirkit-project-id": "project:test", "x-sirkit-branch-id": "main", "x-sirkit-actor-id": "owner" };
describe("CD-3 power API routes", () => {
  it("compiles only a fully pinned problem", async () => { const response = await problem(new Request("http://local/api/power/problem", { method: "POST", headers, body: JSON.stringify(powerProblemInput()) })); expect(response.status).toBe(200); expect((await response.json()).ok).toBe(true); });
  it("generates and compiles bounded alternatives", async () => { const value = powerProblem(); const response = await alternatives(new Request("http://local/api/power/alternatives", { method: "POST", headers, body: JSON.stringify({ problem: value, count: 3 }) })); const body = await response.json(); expect(response.status).toBe(200); expect(body.candidates).toHaveLength(3); });
  it("rejects project scope mismatch", async () => { const response = await candidates(new Request("http://local/api/power/candidates", { method: "POST", headers: { ...headers, "x-sirkit-project-id": "foreign" }, body: JSON.stringify({ problem: powerProblem(), proposal: synthesizePowerArchitectureProposals(powerProblem())[0] }) })); expect(response.status).toBe(403); });
  it("compares raw evidence-backed objective vectors", async () => { const value = powerProblem(); const values = [0, 1, 2].map((index) => powerCandidate(index, value)); const response = await compare(new Request("http://local/api/power/compare", { method: "POST", headers, body: JSON.stringify({ candidates: values }) })); expect(response.status).toBe(200); expect((await response.json()).comparison.objectiveVectors).toHaveLength(3); });
  it("validates reconciliation evidence", async () => { const response = await reconcile(new Request("http://local/api/power/reconcile", { method: "POST", headers, body: JSON.stringify({ candidate: powerCandidate(), expansions: [{ expansionId: "bad" }] }) })); expect(response.status).toBe(200); expect((await response.json()).reconciliation.state).toBe("invalid"); });
});
