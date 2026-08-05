import { and, eq } from "drizzle-orm";
import { getDb } from "@/app/lib/db/client";
import { architectureCandidates, architectureComparisons, architectureProblems, architectureSelectionDecisions, architectureTransactionRecords, designRequirementPackages } from "@/app/lib/db/schema";
import { architectureDigest } from "./stable";
import type { ArchitectureProjectState } from "./types";
import { validateArchitectureProjectState } from "./project";
import { validateArchitectureProblem } from "./problem";

export async function persistArchitectureState(input: { tenantId: string; state: ArchitectureProjectState }): Promise<void> {
  const { tenantId, state } = input;
  if (!tenantId.trim() || !validateArchitectureProjectState(state) || validateArchitectureProblem(state.problem).length) throw new Error("ARCHITECTURE_PERSISTENCE_INTEGRITY_FAILED");
  if (state.problem.tenantId !== tenantId) throw new Error("ARCHITECTURE_PERSISTENCE_TENANT_MISMATCH");
  await getDb().transaction(async (tx) => {
    const [requirements] = await tx.select({ digest: designRequirementPackages.packageDigest, status: designRequirementPackages.status }).from(designRequirementPackages).where(and(eq(designRequirementPackages.tenantId, tenantId), eq(designRequirementPackages.projectId, state.projectId), eq(designRequirementPackages.packageDigest, state.problem.requirementsPackageRef.digest))).limit(1);
    if (!requirements || requirements.status !== "accepted_for_architecture_exploration") throw new Error("ACCEPTED_CD1_PACKAGE_NOT_PERSISTED");
    const [existingProblem] = await tx.select({ digest: architectureProblems.problemDigest }).from(architectureProblems).where(eq(architectureProblems.problemDigest, state.problem.deterministicDigest)).limit(1);
    if (!existingProblem) await tx.insert(architectureProblems).values({ problemId: state.problem.problemId, tenantId, projectId: state.projectId, branchId: state.branchId, problemDigest: state.problem.deterministicDigest, requirementsPackageDigest: state.problem.requirementsPackageRef.digest, compilerVersion: state.problem.compilerVersion, problem: state.problem });
    for (const candidate of state.candidates) {
      const [existing] = await tx.select({ digest: architectureCandidates.candidateDigest }).from(architectureCandidates).where(and(eq(architectureCandidates.candidateId, candidate.candidateId), eq(architectureCandidates.revision, candidate.revision))).limit(1);
      if (existing && existing.digest !== candidate.deterministicDigest) throw new Error(`IMMUTABLE_ARCHITECTURE_CANDIDATE_COLLISION:${candidate.candidateId}@${candidate.revision}`);
      if (!existing) await tx.insert(architectureCandidates).values({ candidateId: candidate.candidateId, tenantId, projectId: state.projectId, branchId: state.branchId, lineageId: candidate.lineageId, revision: candidate.revision, candidateDigest: candidate.deterministicDigest, problemDigest: state.problem.deterministicDigest, structuralSignature: candidate.structuralSignature, status: candidate.status, candidate });
    }
    for (const comparison of state.comparisons) {
      if (comparison.deterministicDigest !== architectureDigest({ ...comparison, deterministicDigest: undefined })) throw new Error(`ARCHITECTURE_COMPARISON_INTEGRITY_FAILED:${comparison.comparisonId}`);
      const [existing] = await tx.select({ digest: architectureComparisons.comparisonDigest }).from(architectureComparisons).where(eq(architectureComparisons.comparisonId, comparison.comparisonId)).limit(1);
      if (existing && existing.digest !== comparison.deterministicDigest) throw new Error(`IMMUTABLE_ARCHITECTURE_COMPARISON_COLLISION:${comparison.comparisonId}`);
      if (!existing) await tx.insert(architectureComparisons).values({ comparisonId: comparison.comparisonId, tenantId, projectId: state.projectId, branchId: state.branchId, problemDigest: state.problem.deterministicDigest, comparisonDigest: comparison.deterministicDigest, comparison });
    }
    if (state.selection) {
      const decision = state.selection; if (decision.approver.actorKind !== "human") throw new Error("AI_ARCHITECTURE_SELECTION_FORBIDDEN");
      const [existing] = await tx.select({ digest: architectureSelectionDecisions.decisionDigest }).from(architectureSelectionDecisions).where(eq(architectureSelectionDecisions.decisionId, decision.decisionId)).limit(1);
      if (existing && existing.digest !== decision.deterministicDigest) throw new Error(`IMMUTABLE_ARCHITECTURE_SELECTION_COLLISION:${decision.decisionId}`);
      if (!existing) await tx.insert(architectureSelectionDecisions).values({ decisionId: decision.decisionId, tenantId, projectId: state.projectId, branchId: state.branchId, candidateId: decision.candidateId, candidateDigest: decision.candidateDigest, problemDigest: decision.problemDigest, approverActorId: decision.approver.actorId, decisionDigest: decision.deterministicDigest, decision });
    }
    for (const record of state.transactionRecords) {
      const [existing] = await tx.select({ digest: architectureTransactionRecords.integrityDigest }).from(architectureTransactionRecords).where(eq(architectureTransactionRecords.transactionId, record.transaction.transactionId)).limit(1);
      if (existing && existing.digest !== record.integrityDigest) throw new Error(`ARCHITECTURE_TRANSACTION_ID_COLLISION:${record.transaction.transactionId}`);
      if (!existing) await tx.insert(architectureTransactionRecords).values({ transactionId: record.transaction.transactionId, tenantId, projectId: state.projectId, branchId: state.branchId, actorId: record.transaction.actor.actorId, status: record.state, integrityDigest: record.integrityDigest, record });
    }
  });
}
