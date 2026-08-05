import { compileRequirementsPackage } from "../../requirements/compiler";
import { candidate, compileInput, packageApproval, requirementApproval, source } from "../../requirements/__tests__/fixtures";
import type { DesignRequirementsPackage } from "../../requirements/types";
import { synthesizeArchitectureProposals } from "../alternatives";
import { compileArchitectureCandidate } from "../compiler";
import { compileArchitectureProblem } from "../problem";
import type { ArchitectureCandidateProposal, ArchitectureProblem, SystemArchitectureCandidate } from "../types";

export const ACTOR = { actorId: "owner", actorKind: "human" as const, sessionId: "test", role: "project_admin" as const };
export const CREATED_AT = "2026-07-17T12:00:00.000Z";

export function acceptedRequirementsPackage(): DesignRequirementsPackage {
  const artifact = source(); const item = candidate(artifact, { requestedStatus: "confirmed" });
  const result = compileRequirementsPackage(compileInput(artifact, [item], { approvals: [requirementApproval(artifact.projectId, item.lineageKey), packageApproval(artifact.projectId)] }));
  if (!result.ok || result.package.status !== "accepted_for_architecture_exploration") throw new Error("accepted CD-1 fixture failed"); return result.package;
}

export function architectureProblem(): ArchitectureProblem {
  const result = compileArchitectureProblem({ tenantId: "tenant:test", branchId: "main", requirementsPackage: acceptedRequirementsPackage() });
  if (!result.ok) throw new Error(result.diagnostics.map((item) => item.code).join(",")); return result.problem;
}

export function architectureProposal(problem = architectureProblem(), index = 0): ArchitectureCandidateProposal { return synthesizeArchitectureProposals(problem)[index]; }

export function architectureCandidate(problem = architectureProblem(), index = 0): SystemArchitectureCandidate {
  const result = compileArchitectureCandidate({ problem, proposal: architectureProposal(problem, index), actor: ACTOR, createdAt: CREATED_AT });
  if (!result.ok) throw new Error(result.diagnostics.map((item) => item.code).join(",")); return result.candidate;
}
