import { validateQuantity } from "../constraints/quantity";
import type { ConstraintQuantity, TypedRequirement } from "../constraints/types";
import { isOneOf, REQUIREMENT_ACCESS_POLICIES, REQUIREMENT_AUTHORITY_CLASSES, REQUIREMENT_BENCHMARK_USES, REQUIREMENT_PRIVACY_CLASSIFICATIONS, REQUIREMENT_SOURCE_KINDS, REQUIREMENT_SOURCE_MEDIA_TYPES, sourceRefForLocation } from "./source";
import { requirementsDigest, withoutRequirementDigest } from "./stable";
import type {
  DesignRequirementsPackage,
  ExtractionCandidate,
  RequirementDiagnostic,
  RequirementPredicate,
  RequirementSourceArtifact,
  StructuredExtractionEnvelope,
} from "./types";
import { REQUIREMENTS_COMPILER_VERSION, REQUIREMENTS_SCHEMA_VERSION, REQUIREMENTS_SOURCE_SCHEMA_VERSION } from "./types";

const DOMAINS = new Set([
  "product_functional", "use_case_operating_mode", "electrical_supply_load", "power_energy_battery", "analog_performance",
  "digital_interface_protocol", "timing_latency_bandwidth", "clock_reset_boot_debug_firmware", "environmental",
  "mechanical_enclosure_connector", "safety_isolation_compliance", "reliability_lifecycle_serviceability",
  "component_sourcing_cost_volume", "manufacturing_assembly", "calibration_test_diagnostics", "pcb_placement_routing_stackup",
  "security_privacy", "documentation_release_process",
]);
const KINDS = new Set([
  "capability_behavior", "minimum", "maximum", "range", "target", "exact_or_set", "required_forbidden_relationship",
  "budget_allocation", "sequence_state_transition", "interface_contract", "quality_attribute", "process_evidence_obligation",
  "external_approval_certification", "implementation_mandate", "preference_objective", "informational_context",
]);
const STRENGTHS = new Set(["hard", "target", "soft_preference", "advisory", "externally_mandated", "informational"]);
const AUTHORITIES = new Set(["project_owner_confirmed", "authorized_stakeholder_confirmed", "organizational_policy", "contractual_customer_source", "manufacturer_component_source", "imported_legacy_data", "ai_proposal", "inferred_observation", "untrusted_reference"]);
const ALLOWED_CANDIDATE_KEYS = new Set([
  "candidateId", "lineageKey", "sourceRef", "sourceSpan", "candidateStatement", "title", "proposedDomain", "proposedKind",
  "proposedStrength", "proposedAuthority", "priority", "criticality", "typedPredicate", "conditions", "applicabilityCondition",
  "subjectRefsOrRoles", "capabilityDemandIds", "ambiguityNotes", "missingFields", "confidence", "rationaleForClassification",
  "owner", "requestedStatus", "extractionActor", "createdAt", "relatedRequirementRefs", "assumptionRefs",
]);

function quantities(predicate: RequirementPredicate): ConstraintQuantity[] {
  const typed = predicate as TypedRequirement;
  if (typed.form === "minimum" || typed.form === "maximum") return [typed.value];
  if (typed.form === "range") return [typed.min, typed.max];
  if (typed.form === "target") return [typed.value, typed.toleranceMinus, typed.tolerancePlus];
  if (typed.form === "distance") return [typed.value];
  if (typed.form === "budget") return "dimension" in typed.limit ? [typed.limit, ...(typed.margin ? [typed.margin] : [])] : [];
  if (predicate.form === "temporal_sequence" && predicate.duration) return [predicate.duration];
  return [];
}

export function validateRequirementPredicate(predicate: RequirementPredicate): string[] {
  if (!predicate || typeof predicate !== "object" || typeof predicate.form !== "string") return ["Typed predicate and form are required."];
  const errors = quantities(predicate).flatMap(validateQuantity);
  if (predicate.form === "range") {
    if (predicate.min.dimension !== predicate.max.dimension) errors.push("Range bounds use incompatible dimensions.");
  } else if (predicate.form === "target") {
    if (predicate.value.dimension !== predicate.toleranceMinus.dimension || predicate.value.dimension !== predicate.tolerancePlus.dimension) errors.push("Target tolerances use incompatible dimensions.");
  } else if (predicate.form === "qualitative_rubric" && (!predicate.rubricId.trim() || !predicate.reviewMethod.trim() || !predicate.authorizedReviewerRole.trim())) errors.push("Qualitative requirements need a named rubric, review method, and authorized reviewer role.");
  else if (predicate.form === "external_evidence" && (!predicate.authority.trim() || !predicate.evidenceType.trim())) errors.push("External evidence requirements need an authority and evidence type.");
  else if (predicate.form === "temporal_sequence" && predicate.states.length < 2) errors.push("Temporal sequence requires at least two states.");
  return [...new Set(errors)].sort();
}

function candidateDiagnostic(candidate: ExtractionCandidate, code: string, message: string, fields: string[]): RequirementDiagnostic {
  return {
    diagnosticId: `reqdiag:${requirementsDigest({ candidate: candidate.candidateId, code, fields }).slice(5)}`,
    code,
    severity: "error",
    requirementIds: [],
    sourceRefs: [candidate.sourceRef],
    message,
    missingFields: fields,
    nextActions: ["Correct the structured extraction candidate and compile again"],
  };
}

export function validateExtractionCandidate(candidate: ExtractionCandidate, artifact: RequirementSourceArtifact | undefined): RequirementDiagnostic[] {
  const diagnostics: RequirementDiagnostic[] = [];
  const unknownKeys = Object.keys(candidate as unknown as Record<string, unknown>).filter((key) => !ALLOWED_CANDIDATE_KEYS.has(key));
  if (unknownKeys.length) diagnostics.push(candidateDiagnostic(candidate, "EXTRACTION_UNKNOWN_FIELDS", `Candidate contains unsupported fields: ${unknownKeys.sort().join(", ")}.`, unknownKeys));
  if (!candidate.candidateId?.trim() || !candidate.lineageKey?.trim()) diagnostics.push(candidateDiagnostic(candidate, "EXTRACTION_IDENTITY_REQUIRED", "Candidate and stable lineage identities are required.", ["candidateId", "lineageKey"]));
  if (!candidate.candidateStatement?.trim() || !candidate.title?.trim() || !candidate.owner?.trim()) diagnostics.push(candidateDiagnostic(candidate, "EXTRACTION_TEXT_OWNER_REQUIRED", "Candidate statement, title, and owner are required.", ["candidateStatement", "title", "owner"]));
  if (!DOMAINS.has(candidate.proposedDomain) || !KINDS.has(candidate.proposedKind) || !STRENGTHS.has(candidate.proposedStrength) || !AUTHORITIES.has(candidate.proposedAuthority)) diagnostics.push(candidateDiagnostic(candidate, "EXTRACTION_ENUM_INVALID", "Candidate classification contains an unsupported enum value.", ["classification"]));
  if (!Number.isInteger(candidate.priority) || candidate.priority < 0 || candidate.priority > 100) diagnostics.push(candidateDiagnostic(candidate, "EXTRACTION_PRIORITY_INVALID", "Priority must be an integer from 0 through 100.", ["priority"]));
  if (!Number.isFinite(candidate.confidence) || candidate.confidence < 0 || candidate.confidence > 1) diagnostics.push(candidateDiagnostic(candidate, "EXTRACTION_CONFIDENCE_INVALID", "Confidence must be between 0 and 1.", ["confidence"]));
  const predicateErrors = validateRequirementPredicate(candidate.typedPredicate);
  if (predicateErrors.length) diagnostics.push(candidateDiagnostic(candidate, "EXTRACTION_PREDICATE_INVALID", predicateErrors.join(" "), ["typedPredicate"]));
  if (!artifact || artifact.sourceId !== candidate.sourceRef.sourceId || artifact.sourceVersion !== candidate.sourceRef.sourceVersion || artifact.immutableArtifactDigest !== candidate.sourceRef.immutableArtifactDigest) diagnostics.push(candidateDiagnostic(candidate, "EXTRACTION_SOURCE_NOT_PINNED", "Candidate does not reference the exact pinned source artifact.", ["sourceRef"]));
  else {
    try { sourceRefForLocation(artifact, candidate.sourceSpan); } catch (error) { diagnostics.push(candidateDiagnostic(candidate, "EXTRACTION_SPAN_INVALID", error instanceof Error ? error.message : "Invalid source span.", ["sourceSpan"])); }
    if (candidate.proposedAuthority !== artifact.authorityClass || candidate.sourceRef.authorityClass !== artifact.authorityClass) diagnostics.push(candidateDiagnostic(candidate, "EXTRACTION_AUTHORITY_MISMATCH", "Candidate authority must exactly match the pinned source authority; extraction cannot promote source authority.", ["proposedAuthority", "sourceRef.authorityClass"]));
  }
  if (candidate.extractionActor.actorKind === "ai" && candidate.requestedStatus !== "proposed") diagnostics.push(candidateDiagnostic(candidate, "AI_CANNOT_CONFIRM_REQUIREMENT", "AI extraction must remain proposed until an authorized source and approval confirm it.", ["requestedStatus"]));
  if (candidate.proposedAuthority === "ai_proposal" && candidate.requestedStatus === "confirmed") diagnostics.push(candidateDiagnostic(candidate, "AI_AUTHORITY_CANNOT_CONFIRM", "AI authority cannot publish a confirmed requirement.", ["proposedAuthority", "requestedStatus"]));
  if (!Number.isFinite(Date.parse(candidate.createdAt))) diagnostics.push(candidateDiagnostic(candidate, "EXTRACTION_DATE_INVALID", "Candidate createdAt must be an ISO date-time.", ["createdAt"]));
  return diagnostics;
}

export function validateExtractionEnvelope(envelope: StructuredExtractionEnvelope, artifacts: readonly RequirementSourceArtifact[]): RequirementDiagnostic[] {
  if (envelope.schemaVersion !== 1) return [{ diagnosticId: `reqdiag:${requirementsDigest(envelope).slice(5)}`, code: "EXTRACTION_SCHEMA_UNSUPPORTED", severity: "error", requirementIds: [], sourceRefs: [], message: "Only structured extraction schema version 1 is supported.", missingFields: [], nextActions: ["Migrate the extraction envelope"] }];
  const artifact = artifacts.find((item) => item.sourceId === envelope.sourceId && item.sourceVersion === envelope.sourceVersion);
  return envelope.candidates.flatMap((candidate) => validateExtractionCandidate(candidate, artifact));
}

export function validateSourceArtifact(artifact: RequirementSourceArtifact): string[] {
  const errors: string[] = [];
  if (artifact.schemaVersion !== REQUIREMENTS_SOURCE_SCHEMA_VERSION) errors.push("UNSUPPORTED_REQUIREMENTS_SOURCE_SCHEMA");
  const expected = requirementsDigest({
    schema: REQUIREMENTS_SOURCE_SCHEMA_VERSION,
    tenantId: artifact.tenantId, projectId: artifact.projectId, sourceId: artifact.sourceId, sourceKind: artifact.sourceKind,
    sourceVersion: artifact.sourceVersion, title: artifact.title, authorOrPublisher: artifact.authorOrPublisher,
    authorityClass: artifact.authorityClass, mediaType: artifact.mediaType, normalizedContent: artifact.normalizedContent,
  });
  if (expected !== artifact.immutableArtifactDigest) errors.push("REQUIREMENTS_SOURCE_DIGEST_MISMATCH");
  if (artifact.trustBoundary !== "untrusted_evidence") errors.push("REQUIREMENTS_SOURCE_TRUST_BOUNDARY_INVALID");
  // [B19-D I5e row 28] a matching digest proves only that the declared values were hashed — not that they are allowed
  if (!isOneOf(REQUIREMENT_SOURCE_MEDIA_TYPES, artifact.mediaType)) errors.push("REQUIREMENTS_SOURCE_MEDIA_TYPE_INVALID");
  if (!isOneOf(REQUIREMENT_SOURCE_KINDS, artifact.sourceKind)) errors.push("REQUIREMENTS_SOURCE_KIND_INVALID");
  if (!isOneOf(REQUIREMENT_AUTHORITY_CLASSES, artifact.authorityClass)) errors.push("REQUIREMENTS_SOURCE_AUTHORITY_INVALID");
  if (!isOneOf(REQUIREMENT_ACCESS_POLICIES, artifact.accessPolicy)) errors.push("REQUIREMENTS_SOURCE_ACCESS_POLICY_INVALID");
  if (!isOneOf(REQUIREMENT_PRIVACY_CLASSIFICATIONS, artifact.privacyClassification)) errors.push("REQUIREMENTS_SOURCE_PRIVACY_INVALID");
  if (!isOneOf(REQUIREMENT_BENCHMARK_USES, artifact.benchmarkUse)) errors.push("REQUIREMENTS_SOURCE_BENCHMARK_USE_INVALID");
  if (artifact.privacyClassification !== "public" && artifact.benchmarkUse === "public_allowed") errors.push("PRIVATE_SOURCE_BENCHMARK_POLICY_INVALID");
  return errors;
}

export function validateDesignRequirementsPackage(value: unknown): value is DesignRequirementsPackage {
  if (!value || typeof value !== "object") return false;
  const pkg = value as DesignRequirementsPackage;
  if (pkg.schemaVersion !== REQUIREMENTS_SCHEMA_VERSION || pkg.compilerVersion !== REQUIREMENTS_COMPILER_VERSION) return false;
  if (!pkg.packageId || !pkg.projectId || !Number.isInteger(pkg.revision) || pkg.revision < 1) return false;
  if (!Array.isArray(pkg.requirements) || !Array.isArray(pkg.assumptions) || !Array.isArray(pkg.sourceDocumentRefs)) return false;
  const expected = requirementsDigest(withoutRequirementDigest(pkg as unknown as Record<string, unknown>));
  return expected === pkg.deterministicDigest;
}
