import { validateSchematicGraph } from "../schematic-compiler/graph";
import { validateSchematicProjectState } from "../schematic-compiler/project";
import { validateCd9UpstreamCompletionSignoff } from "./capability";
import { validateRuleRegistry } from "./registry";
import { finalizeVerification, uniqueSorted, verificationDigest, verificationId } from "./stable";
import { CIRCUIT_VERIFICATION_PROBLEM_SCHEMA, type Cd9Diagnostic, type CircuitVerificationProblem, type CircuitVerificationProblemInput, type CircuitVerificationProblemResult } from "./types";

function diagnostic(code: string, message: string, refs: string[] = [], ownerStage: Cd9Diagnostic["ownerStage"] = "CD-8"): Cd9Diagnostic {
  const base = { code, severity: "blocking" as const, message, objectRefs: uniqueSorted(refs), sourceRefs: [], ownerStage, minimumSafeAction: ownerStage === "CD-8" ? "Complete CD-8 with one human-approved semantic graph and an independent semantically-equivalent KiCad round trip." : "Resolve the named prerequisite and recompile the CD-9 problem." };
  return { ...base, diagnosticId: verificationId("diagnostic", base) };
}

export function compileCircuitVerificationProblem(input: CircuitVerificationProblemInput): CircuitVerificationProblemResult {
  const state = input.schematicProject;
  const upstreamErrors = validateCd9UpstreamCompletionSignoff(input.upstreamSignoff);
  const stateErrors = validateSchematicProjectState(state);
  const registryErrors = validateRuleRegistry(input.registry);
  const candidate = state?.decision?.state === "approved"
    ? state.candidates.find((item) => item.candidateId === state.decision?.candidateId && item.approvalState === "approved" && item.lifecycleState === "approved_for_CD9")
    : undefined;
  const graph = candidate ? state.graphs.find((item) => item.graphId === candidate.semanticGraphRevisionId && item.deterministicDigest === candidate.semanticGraphDigest) : undefined;
  const certificate = candidate?.roundTripCertificateId ? state.roundTripCertificates.find((item) => item.certificateId === candidate.roundTripCertificateId) : undefined;
  const completeness = candidate ? state.completenessReports.find((item) => item.reportId === candidate.structuralCompletenessReportId) : undefined;
  const sync = candidate ? state.syncContracts.find((item) => item.contractId === candidate.pcbSynchronizationContractId) : undefined;
  const diagnostics: Cd9Diagnostic[] = [];
  const s = state?.upstreamSignoff;
  const expectedStageDigests = s && state.decision ? [
    { stage: "CD-1" as const, stateDigest: s.requirementsDigest, decisionDigest: s.requirementsDigest },
    { stage: "CD-2" as const, stateDigest: s.architectureCandidateDigest, decisionDigest: s.architectureDecisionDigest },
    { stage: "CD-3" as const, stateDigest: s.powerCandidateDigest, decisionDigest: s.powerDecisionDigest },
    { stage: "CD-4" as const, stateDigest: s.interfaceCandidateDigest, decisionDigest: s.interfaceDecisionDigest },
    { stage: "CD-5" as const, stateDigest: s.circuitKnowledgeStateDigest, decisionDigest: s.circuitKnowledgeDecisionDigest },
    { stage: "CD-6" as const, stateDigest: s.componentSelectionStateDigest, decisionDigest: s.componentSelectionDecisionDigest },
    { stage: "CD-7" as const, stateDigest: s.calculationStateDigest, decisionDigest: s.calculationDecisionDigest },
    { stage: "CD-8" as const, stateDigest: state.deterministicDigest, decisionDigest: state.decision.deterministicDigest },
  ] : [];

  if (stateErrors.length) diagnostics.push(diagnostic("CD9_CD8_PROJECT_INVALID", "The CD-8 project state failed integrity validation.", stateErrors));
  if (!candidate || !graph || !certificate || !completeness || !sync) diagnostics.push(diagnostic("CD9_CD8_APPROVED_HANDOFF_MISSING", "CD-9 requires exactly one current human-approved CD-8 candidate and its complete semantic bundle."));
  if (graph && !validateSchematicGraph(graph).valid) diagnostics.push(diagnostic("CD9_CD8_GRAPH_INVALID", "The authoritative CD-8 semantic graph is invalid.", [graph.graphId]));
  if (certificate && (certificate.certificateState !== "semantically_equivalent" || certificate.sourceGraphDigest !== graph?.deterministicDigest || certificate.semanticDifferenceIds.length || certificate.unsupportedConstructIds.length)) diagnostics.push(diagnostic("CD9_CD8_ROUND_TRIP_NOT_EQUIVALENT", "The approved schematic lacks current independent semantic round-trip equivalence.", [certificate.certificateId]));
  if (completeness && completeness.readinessState !== "ready_for_review") diagnostics.push(diagnostic("CD9_CD8_STRUCTURAL_COMPLETENESS_BLOCKED", "CD-8 structural completeness is not ready.", [completeness.reportId]));
  if (sync && (sync.graphDigest !== graph?.deterministicDigest || sync.synchronizationState === "invalidated")) diagnostics.push(diagnostic("CD9_CD8_SYNC_CONTRACT_INVALID", "The CD-8 PCB synchronization contract is stale or invalid.", [sync.contractId]));
  if (upstreamErrors.length || verificationDigest(input.upstreamSignoff.stageDigests) !== verificationDigest(expectedStageDigests) || input.upstreamSignoff.approvedSchematicCandidateId !== candidate?.candidateId || input.upstreamSignoff.approvedSchematicCandidateDigest !== candidate?.deterministicDigest || input.upstreamSignoff.semanticGraphDigest !== graph?.deterministicDigest || input.upstreamSignoff.roundTripCertificateDigest !== certificate?.deterministicDigest) diagnostics.push(diagnostic("CD9_CD8_SIGNOFF_INVALID", "The CD-9 upstream signoff does not pin the approved CD-8 bundle and complete CD-1 through CD-8 chain.", upstreamErrors));
  if (state?.branchId !== input.branchId) diagnostics.push(diagnostic("CD9_SCOPE_MISMATCH", "CD-8 project and requested CD-9 scope do not match.", [], "CD-9"));
  if (registryErrors.length || input.registry.lifecycleState !== "approved") diagnostics.push(diagnostic("CD9_RULE_REGISTRY_NOT_APPROVED", "The selected deterministic rule registry is invalid or has not received independent human approval.", registryErrors, "CD-9"));
  if (input.capabilityProfile.approvalState !== "approved" || input.capabilityProfile.deterministicDigest !== finalizeVerification(input.capabilityProfile).deterministicDigest) diagnostics.push(diagnostic("CD9_CAPABILITY_PROFILE_NOT_APPROVED", "The CD-9 capability profile is not approved or failed integrity validation.", [], "CD-9"));
  if (diagnostics.length || !candidate || !graph || !certificate) return { ok: false, verdict: diagnostics.some((item) => item.ownerStage === "CD-8") ? "BLOCKED BY CD-8" : "BLOCKED", diagnostics: diagnostics.sort((a, b) => a.code.localeCompare(b.code)) };

  const upstreamRevisionRefs = structuredClone(input.upstreamSignoff.stageDigests).sort((a, b) => a.stage.localeCompare(b.stage));
  const body = {
    schemaVersion: CIRCUIT_VERIFICATION_PROBLEM_SCHEMA,
    tenantId: input.tenantId,
    projectId: state.projectId,
    branchId: state.branchId,
    revision: 1,
    cd8ProjectDigest: state.deterministicDigest,
    cd8CandidateId: candidate.candidateId,
    cd8CandidateDigest: candidate.deterministicDigest,
    semanticGraphRevisionId: graph.graphId,
    semanticGraphDigest: graph.deterministicDigest,
    roundTripCertificateId: certificate.certificateId,
    roundTripCertificateDigest: certificate.deterministicDigest,
    upstreamRevisionRefs,
    capabilityProfileDigest: input.capabilityProfile.deterministicDigest,
    ruleRegistryDigest: input.registry.deterministicDigest,
    requiredVariantIds: uniqueSorted(graph.variantIds),
    requiredContextKinds: uniqueSorted(input.requiredContextKinds),
    requirementRevisionRefs: [...input.requirementRevisionRefs].sort((a, b) => a.requirementId.localeCompare(b.requirementId)),
    dependencyDigest: verificationDigest({ upstreamRevisionRefs, graph: graph.deterministicDigest, registry: input.registry.deterministicDigest, capability: input.capabilityProfile.deterministicDigest, requirements: input.requirementRevisionRefs }),
    lifecycleState: "ready_for_verification" as const,
    blockingDiagnosticIds: [],
    createdBy: structuredClone(input.actor),
    createdAt: input.createdAt,
  };
  const problem = finalizeVerification<CircuitVerificationProblem>({ ...body, problemId: verificationId("verification-problem", body), deterministicDigest: "" });
  return { ok: true, problem, graph, diagnostics: [] };
}

export function validateCircuitVerificationProblem(problem: CircuitVerificationProblem): string[] {
  const errors: string[] = [];
  if (!problem || problem.schemaVersion !== CIRCUIT_VERIFICATION_PROBLEM_SCHEMA || !problem.problemId || !problem.projectId || !problem.branchId || problem.revision < 1) errors.push("CD9_PROBLEM_IDENTITY_INVALID");
  if (problem?.upstreamRevisionRefs?.length !== 8 || !problem.semanticGraphDigest || !problem.cd8CandidateDigest || !problem.ruleRegistryDigest) errors.push("CD9_PROBLEM_PIN_SET_INCOMPLETE");
  if (problem?.deterministicDigest !== finalizeVerification(problem).deterministicDigest) errors.push("CD9_PROBLEM_DIGEST_MISMATCH");
  return errors.sort();
}
