import { validateCd8UpstreamCompletionSignoff } from "./capability";
import { validateSchematicGraph } from "./graph";
import { validateSchematicCompilationProblem } from "./problem";
import { schematicDigest } from "./stable";
import { SCHEMATIC_COMPILER_SCHEMA_VERSION } from "./types";
import type { Cd8UpstreamCompletionSignoff, SchematicCompilationProblem, SchematicProjectState } from "./types";

export function finalizeSchematicProjectState(value: Omit<SchematicProjectState, "deterministicDigest"> | SchematicProjectState): SchematicProjectState {
  const base = structuredClone(value) as SchematicProjectState; delete (base as Partial<SchematicProjectState>).deterministicDigest;
  return { ...base, deterministicDigest: schematicDigest(base) };
}

export function createSchematicProjectState(input: { projectId: string; branchId: string; upstreamSignoff: Cd8UpstreamCompletionSignoff; problem: SchematicCompilationProblem }): SchematicProjectState {
  if (input.problem.projectId !== input.projectId || input.problem.branchId !== input.branchId || validateCd8UpstreamCompletionSignoff(input.upstreamSignoff).length || validateSchematicCompilationProblem(input.problem).length) throw new Error("CD8_PROJECT_INPUT_INVALID");
  return finalizeSchematicProjectState({ schemaVersion: SCHEMATIC_COMPILER_SCHEMA_VERSION, projectId: input.projectId, branchId: input.branchId, upstreamSignoff: structuredClone(input.upstreamSignoff), problem: structuredClone(input.problem), graphs: [], diagrams: [], artifactManifests: [], roundTripCertificates: [], completenessReports: [], diffs: [], syncContracts: [], candidates: [], decision: null, transactionRecords: [] });
}

function digestValid(value: { deterministicDigest: string }): boolean { return value.deterministicDigest === schematicDigest({ ...value, deterministicDigest: undefined }); }
export function validateSchematicProjectState(state: SchematicProjectState): string[] {
  const errors: string[] = [];
  if (!state || state.schemaVersion !== SCHEMATIC_COMPILER_SCHEMA_VERSION || !state.projectId || !state.branchId || state.problem.projectId !== state.projectId || state.problem.branchId !== state.branchId) errors.push("CD8_PROJECT_IDENTITY_INVALID");
  errors.push(...validateCd8UpstreamCompletionSignoff(state.upstreamSignoff), ...validateSchematicCompilationProblem(state.problem));
  for (const graph of state.graphs) if (graph.projectId !== state.projectId || !validateSchematicGraph(graph).valid) errors.push(`CD8_PROJECT_GRAPH_INVALID:${graph.graphId}`);
  const digestCollections = [state.diagrams, state.artifactManifests, state.roundTripCertificates, state.completenessReports, state.diffs, state.syncContracts, state.candidates];
  for (const collection of digestCollections) for (const item of collection) if (!digestValid(item)) errors.push("CD8_PROJECT_MEMBER_DIGEST_INVALID");
  for (const candidate of state.candidates) {
    if (!state.graphs.some((item) => item.graphId === candidate.semanticGraphRevisionId && item.deterministicDigest === candidate.semanticGraphDigest) || !state.completenessReports.some((item) => item.reportId === candidate.structuralCompletenessReportId) || !state.syncContracts.some((item) => item.contractId === candidate.pcbSynchronizationContractId) || candidate.roundTripCertificateId && !state.roundTripCertificates.some((item) => item.certificateId === candidate.roundTripCertificateId) || candidate.kicadArtifactManifestId && !state.artifactManifests.some((item) => item.manifestId === candidate.kicadArtifactManifestId)) errors.push(`CD8_PROJECT_CANDIDATE_REFERENCES_INVALID:${candidate.candidateId}`);
  }
  if (state.decision && (!digestValid(state.decision) || !state.candidates.some((item) => item.candidateId === state.decision!.candidateId && item.deterministicDigest === state.decision!.candidateDigest))) errors.push("CD8_PROJECT_DECISION_INVALID");
  for (const record of state.transactionRecords) if (record.integrityDigest !== schematicDigest({ transaction: record.transaction, state: record.state, diagnostics: record.diagnostics, resultStateDigest: record.resultStateDigest })) errors.push(`CD8_TRANSACTION_RECORD_INVALID:${record.transaction.transactionId}`);
  if (state.deterministicDigest !== schematicDigest({ ...state, deterministicDigest: undefined })) errors.push("CD8_PROJECT_DIGEST_MISMATCH");
  return [...new Set(errors)].sort();
}

export function invalidateSchematicProjectForUpstreamChange(state: SchematicProjectState, changedStage: "CD-1" | "CD-2" | "CD-3" | "CD-4" | "CD-5" | "CD-6" | "CD-7", newDigest: string): SchematicProjectState {
  const next = structuredClone(state);
  next.problem.lifecycleState = "blocked_prerequisite";
  next.problem.blockingUnknownIds = [...new Set([...next.problem.blockingUnknownIds, `UPSTREAM_CHANGED:${changedStage}:${newDigest}`])].sort();
  next.problem.deterministicDigest = schematicDigest({ ...next.problem, deterministicDigest: undefined });
  next.candidates = next.candidates.map((item) => ({ ...item, lifecycleState: "invalidated" as const, approvalState: item.approvalState === "approved" ? "rejected" as const : item.approvalState, deterministicDigest: "" })).map((item) => ({ ...item, deterministicDigest: schematicDigest({ ...item, deterministicDigest: undefined }) }));
  next.syncContracts = next.syncContracts.map((item) => ({ ...item, synchronizationState: "invalidated" as const, deterministicDigest: "" })).map((item) => ({ ...item, deterministicDigest: schematicDigest({ ...item, deterministicDigest: undefined }) }));
  next.decision = null;
  return finalizeSchematicProjectState(next);
}
