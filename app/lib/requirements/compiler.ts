import { aggregateCapabilityBlock, assessRequirementCapability, validateDesignCapabilityProfile } from "./capability";
import { analyzeRequirementQuality, detectRequirementConflicts } from "./diagnostics";
import { validateAssumption } from "./assumptions";
import { lowerRequirementsToConstraintProposal } from "./lowering";
import { generateClarificationQuestions } from "./questions";
import { sourceRefForLocation, sourceSecurityDiagnostics } from "./source";
import { requirementsDigest, requirementsId, withoutRequirementDigest } from "./stable";
import { buildTraceabilityGraph, diffRequirementsPackages } from "./traceability";
import type { DesignRequirementsPackage, ExtractionCandidate, Requirement, RequirementApproval, RequirementDiagnostic, RequirementsCompileInput, RequirementsCompileResult } from "./types";
import { REQUIREMENTS_COMPILER_VERSION, REQUIREMENTS_SCHEMA_VERSION } from "./types";
import { validateDesignRequirementsPackage, validateExtractionEnvelope, validateSourceArtifact } from "./validation";
import { buildAcceptanceMatrix, planVerificationObligations } from "./verification";

const CONFIRMING_AUTHORITIES = new Set(["project_owner_confirmed", "authorized_stakeholder_confirmed", "organizational_policy", "contractual_customer_source"]);

function structuralDiagnostic(code: string, message: string): RequirementDiagnostic {
  return { diagnosticId: requirementsId("reqdiag", { code, message }), code, severity: "error", requirementIds: [], sourceRefs: [], message, missingFields: [], nextActions: ["Correct the compile input and retry; no package revision was published"] };
}

function approvalForRequirement(approvals: readonly RequirementApproval[], requirementId: string, revision: number): RequirementApproval[] {
  return approvals.filter((item) => item.scope === "requirement" && item.targetId === requirementId && item.targetRevision === revision).sort((left, right) => left.approvalId.localeCompare(right.approvalId));
}

function effectiveHumanApproval(approvals: readonly RequirementApproval[], asOf: string): boolean {
  const ordered = [...approvals].sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.approvalId.localeCompare(right.approvalId));
  const latest = ordered.at(-1);
  return Boolean(latest && latest.decision === "approved" && latest.actorKind === "human" && (!latest.expiresAt || Date.parse(latest.expiresAt) > Date.parse(asOf)));
}

function semanticRequirementShape(requirement: Requirement): unknown {
  return { title: requirement.title, normalizedStatement: requirement.normalizedStatement, sourceRefs: requirement.originalSourceRefs, domain: requirement.domain, kind: requirement.kind, strength: requirement.strength, authority: requirement.authority, priority: requirement.priority, criticality: requirement.criticality, applicabilityCondition: requirement.applicabilityCondition, subjects: requirement.subjectRefsOrRoles, predicate: requirement.typedPredicate, conditions: requirement.operatingConditions, tolerancePolicy: requirement.tolerancePolicy, related: requirement.relatedRequirementRefs, assumptions: requirement.assumptionRefs, capabilityDemands: requirement.capabilityDemandIds, owner: requirement.owner };
}

function requirementFromCandidate(input: RequirementsCompileInput, candidate: ExtractionCandidate, asOf: string): Requirement {
  const requirementId = requirementsId("requirement", { projectId: input.projectId, lineageKey: candidate.lineageKey });
  const previous = input.previousPackage?.requirements.find((item) => item.requirementId === requirementId);
  const artifact = input.sourceArtifacts.find((item) => item.sourceId === candidate.sourceRef.sourceId && item.sourceVersion === candidate.sourceRef.sourceVersion)!;
  const sourceRef = sourceRefForLocation(artifact, candidate.sourceSpan);
  const provisionalRevision = previous?.revision ?? 1;
  const provisional: Requirement = {
    requirementId,
    revision: provisionalRevision,
    lineage: { lineageKey: candidate.lineageKey, ...(previous ? { previousRevisionId: `${previous.requirementId}@${previous.revision}` } : {}), supersedesRequirementIds: [], mergedFromRequirementIds: [] },
    title: candidate.title.trim(),
    normalizedStatement: candidate.candidateStatement.replace(/\s+/g, " ").trim(),
    originalSourceRefs: [sourceRef],
    domain: candidate.proposedDomain,
    kind: candidate.proposedKind,
    strength: candidate.proposedStrength,
    authority: candidate.proposedAuthority,
    priority: candidate.priority,
    criticality: candidate.criticality,
    ...(candidate.applicabilityCondition ? { applicabilityCondition: structuredClone(candidate.applicabilityCondition) } : {}),
    subjectRefsOrRoles: [...new Set(candidate.subjectRefsOrRoles)].sort(),
    typedPredicate: structuredClone(candidate.typedPredicate),
    rationale: candidate.rationaleForClassification,
    operatingConditions: structuredClone(candidate.conditions).sort((left, right) => left.conditionId.localeCompare(right.conditionId)),
    verificationPlanRefs: [], derivedConstraintRefs: [], relatedRequirementRefs: [...new Set(candidate.relatedRequirementRefs ?? [])].sort(), assumptionRefs: [...new Set(candidate.assumptionRefs ?? [])].sort(), capabilityDemandIds: [...new Set(candidate.capabilityDemandIds)].sort(),
    capabilityAssessment: { profileRef: "pending", state: "unknown_not_assessed", limitations: [], requiredEvidence: [], evaluatorRefs: [], explanation: "Capability assessment has not run." },
    status: "proposed",
    owner: candidate.owner,
    approvals: [],
    createdBy: previous?.createdBy ?? candidate.extractionActor.actorId,
    createdAt: previous?.createdAt ?? candidate.createdAt,
  };
  const changed = previous ? requirementsDigest(semanticRequirementShape(previous)) !== requirementsDigest(semanticRequirementShape(provisional)) : false;
  provisional.revision = previous && changed ? previous.revision + 1 : previous?.revision ?? 1;
  provisional.approvals = approvalForRequirement(input.approvals, requirementId, provisional.revision);
  const hasApproval = effectiveHumanApproval(provisional.approvals, asOf);
  const canConfirm = candidate.requestedStatus === "confirmed" && CONFIRMING_AUTHORITIES.has(candidate.proposedAuthority) && hasApproval;
  provisional.status = previous && !changed && previous.status === "confirmed" ? "confirmed" : canConfirm ? "confirmed" : candidate.requestedStatus === "confirmed" ? "awaiting_confirmation" : "proposed";
  return provisional;
}

function packageApprovalValid(approvals: readonly RequirementApproval[], packageId: string, revision: number, asOf: string): boolean {
  return effectiveHumanApproval(approvals.filter((item) => item.scope === "package" && item.targetId === packageId && item.targetRevision === revision), asOf);
}

export function compileRequirementsPackage(input: RequirementsCompileInput): RequirementsCompileResult {
  const structural: RequirementDiagnostic[] = [];
  if (!input.tenantId.trim() || !input.projectId.trim() || !input.title.trim() || !input.purpose.trim()) structural.push(structuralDiagnostic("PACKAGE_IDENTITY_REQUIRED", "Tenant, project, title, and purpose are required."));
  if (input.previousPackage && (!validateDesignRequirementsPackage(input.previousPackage) || input.previousPackage.projectId !== input.projectId)) structural.push(structuralDiagnostic("PREVIOUS_PACKAGE_INTEGRITY_FAILED", "The previous requirements package is invalid or belongs to another project."));
  const sourceKeys = new Set<string>();
  for (const artifact of input.sourceArtifacts) {
    if (artifact.tenantId !== input.tenantId || artifact.projectId !== input.projectId) structural.push(structuralDiagnostic("SOURCE_SCOPE_MISMATCH", `Source ${artifact.sourceId}@${artifact.sourceVersion} is outside the compile tenant/project.`));
    for (const error of validateSourceArtifact(artifact)) structural.push(structuralDiagnostic(error, `Source ${artifact.sourceId}@${artifact.sourceVersion} failed integrity validation.`));
    const key = `${artifact.sourceId}@${artifact.sourceVersion}`; if (sourceKeys.has(key)) structural.push(structuralDiagnostic("DUPLICATE_SOURCE_REVISION", `Source revision ${key} occurs more than once.`)); sourceKeys.add(key);
  }
  for (const envelope of input.extractionEnvelopes) structural.push(...validateExtractionEnvelope(envelope, input.sourceArtifacts));
  for (const profile of input.capabilityProfiles) for (const error of validateDesignCapabilityProfile(profile)) structural.push(structuralDiagnostic(error, `Capability profile ${profile.profileId}@${profile.version} failed integrity validation.`));
  for (const selected of input.selectedCapabilityProfileRefs) if (!input.capabilityProfiles.some((profile) => `${profile.profileId}@${profile.version}` === selected)) structural.push(structuralDiagnostic("SELECTED_CAPABILITY_PROFILE_NOT_PINNED", `Selected capability profile ${selected} is not present at the exact pinned revision.`));
  const candidates = input.extractionEnvelopes.flatMap((item) => item.candidates);
  if (new Set(candidates.map((item) => item.candidateId)).size !== candidates.length) structural.push(structuralDiagnostic("DUPLICATE_CANDIDATE_ID", "Extraction candidate IDs must be unique."));
  if (new Set(candidates.map((item) => item.lineageKey)).size !== candidates.length) structural.push(structuralDiagnostic("DUPLICATE_LINEAGE_KEY", "A package revision cannot contain multiple candidates for the same stable lineage key; use explicit split or merge lineage."));
  if (structural.length) return { ok: false, candidateDigest: requirementsDigest({ sources: input.sourceArtifacts.map((item) => item.immutableArtifactDigest), envelopes: input.extractionEnvelopes }), diagnostics: structural.sort((left, right) => left.code.localeCompare(right.code) || left.diagnosticId.localeCompare(right.diagnosticId)) };

  const packageId = requirementsId("requirements-package", { projectId: input.projectId });
  const revision = (input.previousPackage?.revision ?? 0) + 1;
  const asOf = input.sourceArtifacts.map((item) => item.capturedAt).sort().at(-1) ?? "1970-01-01T00:00:00.000Z";
  let requirements = candidates.map((candidate) => requirementFromCandidate(input, candidate, asOf)).sort((left, right) => left.requirementId.localeCompare(right.requirementId));
  requirements = requirements.map((requirement) => ({ ...requirement, capabilityAssessment: assessRequirementCapability(requirement, input.capabilityProfiles, input.selectedCapabilityProfileRefs) }));
  const metadata = new Map(candidates.map((candidate) => [requirementsId("requirement", { projectId: input.projectId, lineageKey: candidate.lineageKey }), { ambiguityNotes: candidate.ambiguityNotes, missingFields: candidate.missingFields }]));
  const sourceDiagnostics = input.sourceArtifacts.flatMap(sourceSecurityDiagnostics);
  const qualityDiagnostics = analyzeRequirementQuality(requirements, metadata);
  const capabilityDiagnostics: RequirementDiagnostic[] = requirements.filter((item) => item.capabilityAssessment.state === "unknown_not_assessed").map((item) => ({ diagnosticId: requirementsId("reqdiag", { requirement: item.requirementId, code: "CAPABILITY_NOT_ASSESSED" }), code: "CAPABILITY_NOT_ASSESSED", severity: item.strength === "hard" || item.strength === "externally_mandated" ? "error" as const : "warning" as const, requirementIds: [item.requirementId], sourceRefs: item.originalSourceRefs, message: item.capabilityAssessment.explanation, missingFields: ["supported capability profile entry or clarification"], nextActions: ["Clarify the capability demand", "Select an authorized capability pack", "Mark the demand external or unsupported explicitly"] }));
  const assumptionDiagnostics = input.assumptions.flatMap((assumption) => validateAssumption(assumption, requirements, asOf));
  const conflicts = detectRequirementConflicts(requirements);
  const allDiagnostics = [...sourceDiagnostics, ...qualityDiagnostics, ...capabilityDiagnostics, ...assumptionDiagnostics].sort((left, right) => left.code.localeCompare(right.code) || left.diagnosticId.localeCompare(right.diagnosticId));
  const questions = generateClarificationQuestions(requirements, allDiagnostics, conflicts);
  const proposal = lowerRequirementsToConstraintProposal({ projectId: input.projectId, packageId, packageRevision: revision, requirements });
  const obligations = planVerificationObligations(requirements);
  requirements = requirements.map((requirement) => ({ ...requirement, verificationPlanRefs: obligations.filter((item) => item.requirementId === requirement.requirementId).map((item) => item.obligationId), derivedConstraintRefs: proposal.items.filter((item) => item.requirementId === requirement.requirementId).map((item) => item.proposalItemId) }));
  const coverage = buildAcceptanceMatrix(requirements, obligations, proposal);
  const traceabilityGraph = buildTraceabilityGraph({ requirements, assumptions: input.assumptions, defaults: input.defaultsApplied, questions, conflicts, proposal, obligations });
  const feasibilityDiagnostics = [
    ...conflicts.filter((item) => item.severity === "blocking").map((item) => ({ diagnosticId: requirementsId("feasibility", { conflict: item.conflictId }), state: "infeasible" as const, requirementIds: item.involvedRequirementIds, explanation: item.explanation, architectureIndependent: true as const })),
    ...requirements.filter((item) => item.capabilityAssessment.state === "unknown_not_assessed").map((item) => ({ diagnosticId: requirementsId("feasibility", { requirement: item.requirementId, state: "unknown" }), state: "unknown" as const, requirementIds: [item.requirementId], explanation: item.capabilityAssessment.explanation, architectureIndependent: true as const })),
    ...requirements.filter((item) => item.capabilityAssessment.state === "external_review_required").map((item) => ({ diagnosticId: requirementsId("feasibility", { requirement: item.requirementId, state: "external" }), state: "external_review_required" as const, requirementIds: [item.requirementId], explanation: item.capabilityAssessment.explanation, architectureIndependent: true as const })),
  ].sort((left, right) => left.diagnosticId.localeCompare(right.diagnosticId));
  const blockingConflict = conflicts.some((item) => item.severity === "blocking" && item.conflictKind !== "capability_limit");
  const unsupported = aggregateCapabilityBlock(requirements).length > 0;
  const blockingQuestion = questions.some((item) => item.status === "open" && ["before_package_acceptance", "before_architecture"].includes(item.blockingLevel));
  const blockingDiagnostic = allDiagnostics.some((item) => item.severity === "error" || item.severity === "blocking");
  const unconfirmed = requirements.some((item) => ["hard", "target", "externally_mandated"].includes(item.strength) && item.status !== "confirmed");
  const packageApproved = packageApprovalValid(input.approvals, packageId, revision, asOf);
  const status: DesignRequirementsPackage["status"] = !requirements.length ? "draft" : blockingConflict ? "blocked_by_contradiction" : unsupported ? "blocked_by_unsupported_capability" : blockingQuestion || blockingDiagnostic ? "awaiting_clarification" : unconfirmed || !packageApproved ? "awaiting_approval" : "accepted_for_architecture_exploration";
  const sourceDocumentRefs = input.sourceArtifacts.map((artifact) => sourceRefForLocation(artifact, {})).sort((left, right) => left.sourceId.localeCompare(right.sourceId) || left.sourceVersion.localeCompare(right.sourceVersion));
  const base: Omit<DesignRequirementsPackage, "deterministicDigest"> = {
    schemaVersion: REQUIREMENTS_SCHEMA_VERSION, packageId, projectId: input.projectId, revision, schemaRevision: 1, status, title: input.title, purpose: input.purpose,
    selectedCapabilityProfileRefs: [...new Set(input.selectedCapabilityProfileRefs)].sort(), sourceDocumentRefs, requirements,
    assumptions: structuredClone(input.assumptions).sort((left, right) => left.assumptionId.localeCompare(right.assumptionId)), hypotheses: structuredClone(input.hypotheses).sort((left, right) => left.hypothesisId.localeCompare(right.hypothesisId)), defaultsApplied: structuredClone(input.defaultsApplied).sort((left, right) => left.defaultId.localeCompare(right.defaultId)),
    openQuestions: questions, conflicts, qualityDiagnostics: allDiagnostics, feasibilityDiagnostics, verificationObligations: obligations,
    constraintProposalRefs: [proposal.proposalId], constraintProposal: proposal, traceabilityGraph, coverageReport: coverage,
    approvals: structuredClone(input.approvals).sort((left, right) => left.approvalId.localeCompare(right.approvalId)), compilerVersion: REQUIREMENTS_COMPILER_VERSION,
    sourceSetDigest: requirementsDigest(input.sourceArtifacts.map((item) => ({ sourceId: item.sourceId, version: item.sourceVersion, digest: item.immutableArtifactDigest })).sort((left, right) => left.sourceId.localeCompare(right.sourceId) || left.version.localeCompare(right.version))),
  };
  const semanticDiff = diffRequirementsPackages(input.previousPackage, base, input.downstreamArtifactRefs ?? []);
  const pkg: DesignRequirementsPackage = { ...base, deterministicDigest: requirementsDigest(withoutRequirementDigest(base as unknown as Record<string, unknown>)) };
  return { ok: true, package: pkg, diagnostics: allDiagnostics, semanticDiff };
}
