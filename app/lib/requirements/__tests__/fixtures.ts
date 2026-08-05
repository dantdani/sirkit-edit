import { EMBEDDED_LOW_VOLTAGE_PROFILE_V1 } from "../capability";
import { ingestRequirementSource, sourceRefForLocation } from "../source";
import { requirementsId } from "../stable";
import type { ExtractionCandidate, RequirementApproval, RequirementsCompileInput, RequirementSourceArtifact } from "../types";

export const NOW = "2026-07-17T12:00:00.000Z";

export function source(overrides: Partial<Parameters<typeof ingestRequirementSource>[0]> = {}): RequirementSourceArtifact {
  return ingestRequirementSource({ tenantId: "tenant:test", projectId: "project:test", sourceId: "brief", sourceKind: "direct_user_statement", sourceVersion: "1", title: "Test brief", authorOrPublisher: "owner", authorityClass: "project_owner_confirmed", mediaType: "text/plain", content: "Trace width shall be at least 0.20 mm.", capturedAt: NOW, accessPolicy: "project_private", privacyClassification: "confidential", benchmarkUse: "forbidden", ...overrides });
}

export function candidate(artifact = source(), overrides: Partial<ExtractionCandidate> = {}): ExtractionCandidate {
  const sourceSpan = { spanStartEnd: { start: 0, end: artifact.normalizedContent.length } };
  return {
    candidateId: "candidate:trace-width",
    lineageKey: "trace-width-main",
    sourceRef: sourceRefForLocation(artifact, sourceSpan),
    sourceSpan,
    candidateStatement: artifact.normalizedContent,
    title: "Minimum trace width",
    proposedDomain: "pcb_placement_routing_stackup",
    proposedKind: "minimum",
    proposedStrength: "hard",
    proposedAuthority: "project_owner_confirmed",
    priority: 70,
    criticality: "normal",
    typedPredicate: { form: "minimum", value: { dimension: "length", value: "0.20", unit: "mm" } },
    conditions: [{ conditionId: "fabrication-profile", label: "Selected fabrication profile", value: "prototype", sourceRefs: [sourceRefForLocation(artifact, sourceSpan)] }],
    subjectRefsOrRoles: ["pcb.trace_width:net-class:default"],
    capabilityDemandIds: ["pcb-2-4-layer"],
    ambiguityNotes: [], missingFields: [], confidence: 1, rationaleForClassification: "The statement contains an explicit minimum and unit.", owner: "owner", requestedStatus: "proposed",
    extractionActor: { actorId: "owner", actorKind: "human", toolSchemaDigest: "fixture-v1" }, createdAt: NOW,
    ...overrides,
  };
}

export function requirementApproval(projectId: string, lineageKey: string, revision = 1): RequirementApproval {
  const requirementId = requirementsId("requirement", { projectId, lineageKey });
  return { approvalId: `approval:${requirementId}:${revision}`, actorId: "owner", actorKind: "human", reviewerRole: "project_admin", scope: "requirement", targetId: requirementId, targetRevision: revision, decision: "approved", createdAt: NOW };
}

export function packageApproval(projectId = "project:test", revision = 1): RequirementApproval {
  return { approvalId: `approval:package:${revision}`, actorId: "owner", actorKind: "human", reviewerRole: "project_admin", scope: "package", targetId: requirementsId("requirements-package", { projectId }), targetRevision: revision, decision: "approved", createdAt: NOW };
}

export function compileInput(artifact = source(), candidates: ExtractionCandidate[] = [candidate(artifact)], overrides: Partial<RequirementsCompileInput> = {}): RequirementsCompileInput {
  return { tenantId: artifact.tenantId, projectId: artifact.projectId, title: "Test requirements", purpose: "Verify the CD-1 compiler", sourceArtifacts: [artifact], extractionEnvelopes: [{ schemaVersion: 1, sourceId: artifact.sourceId, sourceVersion: artifact.sourceVersion, toolSchemaDigest: "fixture-v1", candidates }], capabilityProfiles: [EMBEDDED_LOW_VOLTAGE_PROFILE_V1], selectedCapabilityProfileRefs: [`${EMBEDDED_LOW_VOLTAGE_PROFILE_V1.profileId}@${EMBEDDED_LOW_VOLTAGE_PROFILE_V1.version}`], assumptions: [], hypotheses: [], defaultsApplied: [], approvals: [], ...overrides };
}

