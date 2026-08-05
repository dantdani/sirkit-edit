import { decideSchematicCandidate } from "../../schematic-compiler/candidate";
import { createSchematicProjectState, finalizeSchematicProjectState } from "../../schematic-compiler/project";
import { schematicDigest } from "../../schematic-compiler/stable";
import type { SchematicProjectState } from "../../schematic-compiler/types";
import { projectAllSchematicVariants } from "../../schematic-compiler/variants";
import { HUMAN, readyCandidateBundle, validSignoff } from "../../schematic-compiler/__tests__/fixtures";
import { createCd9UpstreamCompletionSignoff, defaultCircuitVerificationCapabilityProfile } from "../capability";
import { compileVerificationContexts, compileRequiredRuleDenominator } from "../contexts";
import { compileCircuitVerificationProblem } from "../problem";
import { createFoundationalRuleRegistry } from "../registry";
import type { CircuitVerificationProblem } from "../types";

export const NOW = "2026-07-18T16:00:00.000Z";

export function approvedSchematicState(): SchematicProjectState {
  const bundle = readyCandidateBundle();
  const state = createSchematicProjectState({ projectId: "project:test", branchId: "branch:test", upstreamSignoff: validSignoff(), problem: bundle.problem });
  const candidate = structuredClone(bundle.candidate);
  candidate.approvalState = "approved";
  candidate.lifecycleState = "approved_for_CD9";
  candidate.deterministicDigest = schematicDigest({ ...candidate, deterministicDigest: undefined });
  const decision = decideSchematicCandidate({ candidate: bundle.candidate, graph: bundle.graph, certificate: bundle.certificate, actor: HUMAN, decision: "approved", rationale: "Independent semantic and round-trip review complete.", createdAt: NOW });
  decision.candidateDigest = candidate.deterministicDigest;
  decision.deterministicDigest = schematicDigest({ ...decision, deterministicDigest: undefined });
  return finalizeSchematicProjectState({ ...state, graphs: [bundle.graph], diagrams: bundle.diagrams, artifactManifests: [bundle.manifest], roundTripCertificates: [bundle.certificate], completenessReports: [bundle.completeness], syncContracts: [bundle.syncContract], candidates: [candidate], decision });
}

export function verificationFixture(requirements: CircuitVerificationProblem["requirementRevisionRefs"] = []) {
  const schematicProject = approvedSchematicState();
  const candidate = schematicProject.candidates[0], graph = schematicProject.graphs[0], certificate = schematicProject.roundTripCertificates[0];
  const registry = createFoundationalRuleRegistry({ reviewer: HUMAN, reviewedAt: NOW });
  const capabilityProfile = defaultCircuitVerificationCapabilityProfile();
  const s = schematicProject.upstreamSignoff;
  const stageDigests = [
    { stage: "CD-1" as const, stateDigest: s.requirementsDigest, decisionDigest: s.requirementsDigest },
    { stage: "CD-2" as const, stateDigest: s.architectureCandidateDigest, decisionDigest: s.architectureDecisionDigest },
    { stage: "CD-3" as const, stateDigest: s.powerCandidateDigest, decisionDigest: s.powerDecisionDigest },
    { stage: "CD-4" as const, stateDigest: s.interfaceCandidateDigest, decisionDigest: s.interfaceDecisionDigest },
    { stage: "CD-5" as const, stateDigest: s.circuitKnowledgeStateDigest, decisionDigest: s.circuitKnowledgeDecisionDigest },
    { stage: "CD-6" as const, stateDigest: s.componentSelectionStateDigest, decisionDigest: s.componentSelectionDecisionDigest },
    { stage: "CD-7" as const, stateDigest: s.calculationStateDigest, decisionDigest: s.calculationDecisionDigest },
  ];
  const upstreamSignoff = createCd9UpstreamCompletionSignoff({ cd1Verdict: "CD-1 COMPLETE", cd2Verdict: "CD-2 COMPLETE", cd3Verdict: "CD-3 COMPLETE", cd4Verdict: "CD-4 COMPLETE", cd5Verdict: "CD-5 COMPLETE", cd6Verdict: "CD-6 COMPLETE", cd7Verdict: "CD-7 COMPLETE", cd8Verdict: "CD-8 COMPLETE", stageDigests: [...stageDigests, { stage: "CD-8", stateDigest: schematicProject.deterministicDigest, decisionDigest: schematicProject.decision!.deterministicDigest }], approvedSchematicCandidateId: candidate.candidateId, approvedSchematicCandidateDigest: candidate.deterministicDigest, semanticGraphDigest: graph.deterministicDigest, roundTripCertificateDigest: certificate.deterministicDigest, approver: HUMAN, approvedAt: NOW });
  const result = compileCircuitVerificationProblem({ tenantId: "tenant:test", branchId: "branch:test", schematicProject, upstreamSignoff, capabilityProfile, registry, requirementRevisionRefs: requirements, requiredContextKinds: ["static_unpowered", "static_powered"], actor: HUMAN, createdAt: NOW });
  if (!result.ok) throw new Error(result.diagnostics.map((item) => item.code).join(","));
  const projections = projectAllSchematicVariants(graph);
  const contexts = compileVerificationContexts({ problem: result.problem, graph });
  const denominator = compileRequiredRuleDenominator({ problem: result.problem, graph, projections, registry, capabilityProfile, contexts });
  return { schematicProject, graph, projections, registry, capabilityProfile, upstreamSignoff, problem: result.problem, contexts, denominator };
}
