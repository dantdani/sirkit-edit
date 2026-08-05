import { validateCircuitVerificationProblem } from "./problem";
import { validateRuleRegistry } from "./registry";
import { finalizeVerification, verificationDigest, verificationId } from "./stable";
import { CIRCUIT_VERIFICATION_SCHEMA, type CircuitReadinessReport, type CircuitVerificationProjectState, type CircuitWaiver, type FullOracleRun, type OracleParityReport, type RequiredRuleDenominator, type RequirementCoverageRecord, type VerificationContext } from "./types";

export function createCircuitVerificationProjectState(input: Pick<CircuitVerificationProjectState, "projectId" | "branchId" | "problem" | "capabilityProfile" | "registry">): CircuitVerificationProjectState {
  if (input.problem.projectId !== input.projectId || input.problem.branchId !== input.branchId || validateCircuitVerificationProblem(input.problem).length || validateRuleRegistry(input.registry).length) throw new Error("CD9_PROJECT_INPUT_INVALID");
  return finalizeVerification<CircuitVerificationProjectState>({ schemaVersion: CIRCUIT_VERIFICATION_SCHEMA, ...structuredClone(input), contexts: [], denominators: [], fullOracleRuns: [], incrementalRuns: [], parityReports: [], waivers: [], requirementCoverage: [], readinessReports: [], transactionRecords: [], deterministicDigest: "" });
}

export type CircuitProjectArtifact = VerificationContext[] | RequiredRuleDenominator | FullOracleRun | OracleParityReport | CircuitWaiver | RequirementCoverageRecord[] | CircuitReadinessReport;

export function appendCircuitVerificationArtifact(input: { state: CircuitVerificationProjectState; operation: "set_contexts" | "add_denominator" | "add_full_run" | "add_incremental_run" | "add_parity" | "add_waiver" | "set_requirement_coverage" | "add_readiness"; artifact: CircuitProjectArtifact; actor: CircuitVerificationProjectState["problem"]["createdBy"]; createdAt: string }): CircuitVerificationProjectState {
  const next = structuredClone(input.state);
  const beforeDigest = next.deterministicDigest;
  switch (input.operation) {
    case "set_contexts": next.contexts = structuredClone(input.artifact as VerificationContext[]); break;
    case "add_denominator": next.denominators.push(structuredClone(input.artifact as RequiredRuleDenominator)); break;
    case "add_full_run": next.fullOracleRuns.push(structuredClone(input.artifact as FullOracleRun)); break;
    case "add_incremental_run": next.incrementalRuns.push(structuredClone(input.artifact as FullOracleRun)); break;
    case "add_parity": next.parityReports.push(structuredClone(input.artifact as OracleParityReport)); break;
    case "add_waiver": next.waivers.push(structuredClone(input.artifact as CircuitWaiver)); break;
    case "set_requirement_coverage": next.requirementCoverage = structuredClone(input.artifact as RequirementCoverageRecord[]); break;
    case "add_readiness": next.readinessReports.push(structuredClone(input.artifact as CircuitReadinessReport)); break;
  }
  const afterWithoutRecord = finalizeVerification(next);
  const recordBody = { actor: structuredClone(input.actor), operation: input.operation, beforeDigest, afterDigest: afterWithoutRecord.deterministicDigest, createdAt: input.createdAt };
  const record = { ...recordBody, transactionId: verificationId("circuit-transaction", recordBody), integrityDigest: verificationDigest(recordBody) };
  afterWithoutRecord.transactionRecords.push(record);
  return finalizeVerification(afterWithoutRecord);
}

export function validateCircuitVerificationProjectState(state: CircuitVerificationProjectState): string[] {
  const errors: string[] = [];
  if (!state || state.schemaVersion !== CIRCUIT_VERIFICATION_SCHEMA || !state.projectId || !state.branchId || state.problem.projectId !== state.projectId || state.problem.branchId !== state.branchId) errors.push("CD9_PROJECT_IDENTITY_INVALID");
  errors.push(...validateCircuitVerificationProblem(state.problem), ...validateRuleRegistry(state.registry));
  if (state.problem.ruleRegistryDigest !== state.registry.deterministicDigest || state.problem.capabilityProfileDigest !== state.capabilityProfile.deterministicDigest) errors.push("CD9_PROJECT_PIN_MISMATCH");
  for (const run of [...state.fullOracleRuns, ...state.incrementalRuns]) if (run.graphDigest !== state.problem.semanticGraphDigest || run.registryDigest !== state.registry.deterministicDigest || run.deterministicDigest !== finalizeVerification(run).deterministicDigest) errors.push(`CD9_RUN_INVALID:${run.runId}`);
  for (const record of state.transactionRecords) if (record.integrityDigest !== verificationDigest({ actor: record.actor, operation: record.operation, beforeDigest: record.beforeDigest, afterDigest: record.afterDigest, createdAt: record.createdAt })) errors.push(`CD9_TRANSACTION_INVALID:${record.transactionId}`);
  if (state.deterministicDigest !== finalizeVerification(state).deterministicDigest) errors.push("CD9_PROJECT_DIGEST_MISMATCH");
  return [...new Set(errors)].sort();
}

export function invalidateCircuitVerificationForUpstreamChange(state: CircuitVerificationProjectState, stage: `CD-${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`, digest: string): CircuitVerificationProjectState {
  const next = structuredClone(state);
  next.problem.lifecycleState = "invalidated";
  next.problem.blockingDiagnosticIds = [...new Set([...next.problem.blockingDiagnosticIds, `UPSTREAM_CHANGED:${stage}:${digest}`])].sort();
  next.problem = finalizeVerification(next.problem);
  return finalizeVerification(next);
}
