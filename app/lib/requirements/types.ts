import type {
  ConditionExpression,
  ConstraintDefinition,
  ConstraintDocument,
  ConstraintEvaluationState,
  ConstraintQuantity,
  ConstraintScalar,
  TypedRequirement,
} from "../constraints/types";
import type { EngineeringActor, ProjectRevision } from "../engineering/types";

export const REQUIREMENTS_SCHEMA_VERSION = "sirkit.requirements.v1" as const;
export const REQUIREMENTS_COMPILER_VERSION = "sirkit-requirements/1.0.0" as const;
export const REQUIREMENTS_SOURCE_SCHEMA_VERSION = "sirkit.requirements-source.v1" as const;
export const REQUIREMENTS_TRANSACTION_SCHEMA_VERSION = "sirkit.requirements-transaction.v1" as const;

export type PackageStatus =
  | "draft"
  | "awaiting_clarification"
  | "awaiting_approval"
  | "blocked_by_contradiction"
  | "blocked_by_unsupported_capability"
  | "accepted_for_architecture_exploration"
  | "superseded"
  | "stale";

export type RequirementDomain =
  | "product_functional"
  | "use_case_operating_mode"
  | "electrical_supply_load"
  | "power_energy_battery"
  | "analog_performance"
  | "digital_interface_protocol"
  | "timing_latency_bandwidth"
  | "clock_reset_boot_debug_firmware"
  | "environmental"
  | "mechanical_enclosure_connector"
  | "safety_isolation_compliance"
  | "reliability_lifecycle_serviceability"
  | "component_sourcing_cost_volume"
  | "manufacturing_assembly"
  | "calibration_test_diagnostics"
  | "pcb_placement_routing_stackup"
  | "security_privacy"
  | "documentation_release_process";

export type RequirementKind =
  | "capability_behavior"
  | "minimum"
  | "maximum"
  | "range"
  | "target"
  | "exact_or_set"
  | "required_forbidden_relationship"
  | "budget_allocation"
  | "sequence_state_transition"
  | "interface_contract"
  | "quality_attribute"
  | "process_evidence_obligation"
  | "external_approval_certification"
  | "implementation_mandate"
  | "preference_objective"
  | "informational_context";

export type RequirementStrength =
  | "hard"
  | "target"
  | "soft_preference"
  | "advisory"
  | "externally_mandated"
  | "informational";

export type RequirementAuthorityClass =
  | "project_owner_confirmed"
  | "authorized_stakeholder_confirmed"
  | "organizational_policy"
  | "contractual_customer_source"
  | "manufacturer_component_source"
  | "imported_legacy_data"
  | "ai_proposal"
  | "inferred_observation"
  | "untrusted_reference";

export type RequirementStatus =
  | "proposed"
  | "awaiting_confirmation"
  | "confirmed"
  | "rejected"
  | "superseded"
  | "stale";

export type Criticality = "safety_critical" | "mission_critical" | "high" | "normal" | "low";
export type AccessPolicy = "project_private" | "organization_private" | "restricted" | "public";
export type PrivacyClassification = "public" | "internal" | "confidential" | "restricted";

export type RequirementSourceKind =
  | "direct_user_statement"
  | "structured_project_brief"
  | "uploaded_specification"
  | "existing_project_metadata"
  | "organization_policy_default"
  | "manufacturing_profile"
  | "customer_requirement_document"
  | "benchmark_task_definition"
  | "imported_legacy_constraint"
  | "observed_design_context"
  | "external_regulation_reference"
  | "conversation_message";

export interface SourceLocation {
  page?: number;
  section?: string;
  lineRange?: { start: number; end: number };
  messageId?: string;
  spanStartEnd?: { start: number; end: number };
  jsonPointer?: string;
}

export interface RequirementSourceRef {
  sourceId: string;
  sourceKind: RequirementSourceKind;
  sourceVersion: string;
  authorOrPublisher?: string;
  authorityClass: RequirementAuthorityClass;
  title: string;
  immutableArtifactDigest: string;
  location: SourceLocation;
  quotedOrNormalizedExcerpt?: string;
  capturedAt: string;
  freshness?: { state: "current" | "stale" | "unknown"; checkedAt?: string; expiresAt?: string };
  accessPolicy: AccessPolicy;
}

export interface RequirementSourceArtifact {
  schemaVersion: typeof REQUIREMENTS_SOURCE_SCHEMA_VERSION;
  tenantId: string;
  projectId: string;
  sourceId: string;
  sourceKind: RequirementSourceKind;
  sourceVersion: string;
  title: string;
  authorOrPublisher?: string;
  authorityClass: RequirementAuthorityClass;
  mediaType: "text/plain" | "text/markdown" | "application/json";
  normalizedContent: string;
  immutableArtifactDigest: string;
  capturedAt: string;
  accessPolicy: AccessPolicy;
  privacyClassification: PrivacyClassification;
  benchmarkUse: "forbidden" | "explicit_opt_in" | "public_allowed";
  trustBoundary: "untrusted_evidence";
  extractionConfidence?: number;
}

export type RequirementPredicate =
  | TypedRequirement
  | { form: "qualitative_rubric"; rubricId: string; reviewMethod: string; authorizedReviewerRole: string }
  | { form: "external_evidence"; authority: string; evidenceType: string; standardRef?: string }
  | { form: "temporal_sequence"; states: string[]; relation: "before" | "after" | "within"; duration?: ConstraintQuantity };

export interface RequirementApproval {
  approvalId: string;
  actorId: string;
  actorKind: EngineeringActor["actorKind"];
  reviewerRole: string;
  scope: "requirement" | "assumption" | "conflict" | "package" | "constraint_proposal";
  targetId: string;
  targetRevision: number;
  decision: "approved" | "rejected" | "revoked";
  comments?: string;
  createdAt: string;
  expiresAt?: string;
}

export interface CapabilityAssessment {
  profileRef: string;
  capabilityId?: string;
  state:
    | "supported_and_verifiable"
    | "supported_with_limitations"
    | "exploration_only"
    | "external_review_required"
    | "unsupported"
    | "unknown_not_assessed";
  limitations: string[];
  requiredEvidence: string[];
  evaluatorRefs: string[];
  explanation: string;
}

export interface OperatingCondition {
  conditionId: string;
  label: string;
  dimension?: string;
  value?: ConstraintScalar;
  predicate?: RequirementPredicate;
  sourceRefs: RequirementSourceRef[];
}

export interface RequirementLineage {
  lineageKey: string;
  previousRevisionId?: string;
  supersedesRequirementIds: string[];
  splitFromRequirementId?: string;
  mergedFromRequirementIds: string[];
}

export interface Requirement {
  requirementId: string;
  revision: number;
  lineage: RequirementLineage;
  title: string;
  normalizedStatement: string;
  originalSourceRefs: RequirementSourceRef[];
  domain: RequirementDomain;
  kind: RequirementKind;
  strength: RequirementStrength;
  authority: RequirementAuthorityClass;
  priority: number;
  criticality: Criticality;
  applicabilityCondition?: ConditionExpression;
  subjectRefsOrRoles: string[];
  typedPredicate: RequirementPredicate;
  rationale?: string;
  operatingConditions: OperatingCondition[];
  tolerancePolicy?: { basis: "absolute" | "relative" | "measurement_uncertainty"; description: string };
  verificationPlanRefs: string[];
  derivedConstraintRefs: string[];
  relatedRequirementRefs: string[];
  assumptionRefs: string[];
  capabilityDemandIds: string[];
  capabilityAssessment: CapabilityAssessment;
  status: RequirementStatus;
  owner: string;
  approvals: RequirementApproval[];
  createdBy: string;
  createdAt: string;
}

export type AssumptionRiskClass = "low" | "medium" | "high" | "forbidden";
export type AssumptionStatus =
  | "proposed_hypothesis"
  | "awaiting_confirmation"
  | "accepted_for_exploration"
  | "confirmed_as_fact_or_requirement"
  | "rejected"
  | "expired"
  | "invalidated"
  | "superseded";

export interface Assumption {
  assumptionId: string;
  revision: number;
  statement: string;
  typedValueOrPredicate?: ConstraintScalar | RequirementPredicate;
  reasonNeeded: string;
  proposedBy: string;
  proposedByKind: EngineeringActor["actorKind"];
  owner: string;
  sourceRefs: RequirementSourceRef[];
  scope: string[];
  riskClass: AssumptionRiskClass;
  confidence: number;
  status: AssumptionStatus;
  approvalPolicy: string;
  approvals: RequirementApproval[];
  affectedRequirementIds: string[];
  affectedDecisionRefs: string[];
  expiryConditionOrDate?: string;
  invalidationDependencies: string[];
  replacementQuestionId?: string;
}

export interface Hypothesis {
  hypothesisId: string;
  statement: string;
  proposedBy: string;
  confidence: number;
  sourceRefs: RequirementSourceRef[];
  relatedRequirementIds: string[];
  status: "proposed" | "promoted_to_assumption" | "rejected" | "superseded";
}

export interface AppliedDefault {
  defaultId: string;
  sourceProfileRevision: string;
  targetField: string;
  value: ConstraintScalar | RequirementPredicate;
  rationale: string;
  authority: RequirementAuthorityClass;
  overridePolicy: "allowed" | "approval_required" | "forbidden";
  applicationCondition?: ConditionExpression;
  status: "applied" | "overridden" | "deprecated" | "stale";
}

export interface QuestionPriorityScore {
  safety: number;
  feasibility: number;
  downstreamImpact: number;
  architectureSensitivity: number;
  wrongAssumptionCost: number;
  capabilityImpact: number;
  verificationImpact: number;
  defaultAvailability: number;
  userEffort: number;
  total: number;
}

export interface RequirementQuestion {
  questionId: string;
  text: string;
  answerSchema: { type: "quantity" | "number" | "string" | "boolean" | "enum" | "range"; dimension?: string; options?: string[]; required: boolean };
  relatedRequirementIds: string[];
  missingFieldOrConflict: string;
  whyItMatters: string;
  downstreamDecisionsAffected: string[];
  riskIfUnanswered: AssumptionRiskClass;
  blockingLevel: "before_package_acceptance" | "before_architecture" | "approved_assumption_allowed" | "open_optimization" | "informational";
  suggestedOptions: string[];
  proposedAssumption?: Assumption;
  priorityScoreBreakdown: QuestionPriorityScore;
  status: "open" | "answered" | "deferred" | "superseded";
  answerSourceRef?: RequirementSourceRef;
}

export interface RequirementConflict {
  conflictId: string;
  conflictKind:
    | "direct_predicate_contradiction"
    | "empty_numeric_range"
    | "allowed_forbidden_set"
    | "capability_limit"
    | "policy_conflict"
    | "assumption_default_conflict"
    | "conditional_overlap"
    | "budget_overcommitment"
    | "authority_ambiguity"
    | "verification_impossible"
    | "source_revision_conflict"
    | "implementation_functional_conflict";
  involvedRequirementIds: string[];
  involvedAssumptionOrDefaultIds: string[];
  capabilityProfileRefs: string[];
  normalizedValues: string[];
  conditions: Array<ConditionExpression | undefined>;
  minimalConflictSet?: string[];
  severity: "info" | "warning" | "blocking";
  explanation: string;
  allowedResolutionActions: Array<"clarify" | "split_condition" | "change_requirement" | "reject_assumption_default" | "choose_external_review" | "mark_unsupported">;
  status: "open" | "resolved" | "reopened";
  resolutionTransactionId?: string;
}

export interface RequirementDiagnostic {
  diagnosticId: string;
  code: string;
  severity: "info" | "warning" | "error" | "blocking";
  requirementIds: string[];
  sourceRefs: RequirementSourceRef[];
  message: string;
  missingFields: string[];
  nextActions: string[];
}

export interface CapabilityLimit {
  field: string;
  predicate: RequirementPredicate;
  explanation: string;
}

export interface DesignCapabilityEntry {
  capabilityId: string;
  domain: string;
  task: string;
  requirementDomains: RequirementDomain[];
  requirementKinds: RequirementKind[];
  supportedPredicateForms: RequirementPredicate["form"][];
  limits: CapabilityLimit[];
  requiredPrerequisiteData: string[];
  evaluatorRefs: string[];
  evidenceLevel: "deterministic" | "simulation" | "prototype" | "external" | "exploration_only";
  supportState: CapabilityAssessment["state"];
  externalReviewRequirement?: string;
  knownLimitations: string[];
  benchmarkCoverage: string[];
  version: string;
}

export interface DesignCapabilityProfile {
  profileId: string;
  version: string;
  title: string;
  scope: string;
  capabilityEntries: DesignCapabilityEntry[];
  defaultPolicies: string[];
  externalReviewRules: string[];
  owner: string;
  evidenceRefs: string[];
  effectiveFrom: string;
  deprecatedAt?: string;
  deterministicDigest: string;
}

export type VerificationMethod =
  | "inspection"
  | "deterministic_analysis"
  | "erc_application_rule"
  | "simulation"
  | "pcb_drc_connectivity"
  | "benchmark_replay"
  | "prototype_measurement"
  | "factory_test"
  | "demonstration"
  | "supplier_manufacturer_evidence"
  | "external_laboratory_certification"
  | "human_expert_review";

export interface VerificationObligation {
  obligationId: string;
  requirementId: string;
  requirementRevision: number;
  verificationMethod: VerificationMethod;
  responsibleStageOrExternalAuthority: string;
  requiredInputs: string[];
  expectedMeasurementOrEvidence: string;
  passPredicateOrRubric: RequirementPredicate;
  operatingConditions: OperatingCondition[];
  sampleCountOrCoverage?: string;
  requiredToolCapability?: string;
  status: "planned" | ConstraintEvaluationState;
  evidenceRefs: string[];
}

export interface DeferredRequirementScope {
  role: string;
  expectedObjectType: string;
  resolutionStage: string;
  selectorMustNotInventObjects: true;
}

export interface ConstraintProposalItem {
  proposalItemId: string;
  requirementId: string;
  requirementRevision: number;
  sourceRefIds: string[];
  assumptionRefs: string[];
  normalizedUnits: string[];
  condition?: ConditionExpression;
  strength: RequirementStrength;
  loweringRuleVersion: string;
  state: "ready" | "deferred" | "unsupported";
  deferredScope?: DeferredRequirementScope;
  constraint?: ConstraintDefinition;
  limitations: string[];
}

export interface ConstraintPatchProposal {
  proposalId: string;
  projectId: string;
  packageId: string;
  packageRevision: number;
  stage6Document: ConstraintDocument;
  items: ConstraintProposalItem[];
  approvalStatus: "proposed" | "approved" | "rejected";
  activationState: "not_active";
  compilerVersion: string;
  deterministicDigest: string;
}

export interface TraceabilityNode {
  id: string;
  kind: "source" | "requirement" | "assumption" | "default" | "question" | "conflict" | "constraint_proposal" | "verification_obligation" | "downstream_artifact" | "evidence";
  revision?: string;
  label: string;
}

export interface TraceabilityEdge {
  from: string;
  to: string;
  relation: "derived_from" | "clarifies" | "conflicts_with" | "depends_on" | "lowers_to" | "verified_by" | "invalidates" | "answers";
}

export interface TraceabilityGraph {
  nodes: TraceabilityNode[];
  edges: TraceabilityEdge[];
  deterministicDigest: string;
}

export type RequirementCoverageState =
  | "no_verification_plan"
  | "planned"
  | "partially_covered"
  | "fully_planned"
  | "not_run"
  | "pass"
  | "fail"
  | "unknown"
  | "unsupported"
  | "external_evidence_required"
  | "stale";

export interface AcceptanceMatrixRow {
  requirementId: string;
  requirementRevision: number;
  sourceIds: string[];
  strength: RequirementStrength;
  criticality: Criticality;
  assumptionDefaultDependencies: string[];
  capabilityState: CapabilityAssessment["state"];
  proposedConstraintIds: string[];
  verificationObligationIds: string[];
  responsibleStagesOrAuthorities: string[];
  currentEvidenceState: RequirementCoverageState;
  blockingImpact: string;
}

export interface RequirementsCoverageReport {
  rows: AcceptanceMatrixRow[];
  counts: Record<RequirementCoverageState, number>;
  hardRequirementIds: string[];
  uncoveredHardRequirementIds: string[];
  deterministicDigest: string;
}

export interface FeasibilityDiagnostic {
  diagnosticId: string;
  state: "feasible_precheck" | "infeasible" | "unknown" | "external_review_required";
  requirementIds: string[];
  explanation: string;
  architectureIndependent: true;
}

export interface DesignRequirementsPackage {
  schemaVersion: typeof REQUIREMENTS_SCHEMA_VERSION;
  packageId: string;
  projectId: string;
  revision: number;
  schemaRevision: 1;
  status: PackageStatus;
  title: string;
  purpose: string;
  selectedCapabilityProfileRefs: string[];
  sourceDocumentRefs: RequirementSourceRef[];
  requirements: Requirement[];
  assumptions: Assumption[];
  hypotheses: Hypothesis[];
  defaultsApplied: AppliedDefault[];
  openQuestions: RequirementQuestion[];
  conflicts: RequirementConflict[];
  qualityDiagnostics: RequirementDiagnostic[];
  feasibilityDiagnostics: FeasibilityDiagnostic[];
  verificationObligations: VerificationObligation[];
  constraintProposalRefs: string[];
  constraintProposal?: ConstraintPatchProposal;
  traceabilityGraph: TraceabilityGraph;
  coverageReport: RequirementsCoverageReport;
  approvals: RequirementApproval[];
  compilerVersion: typeof REQUIREMENTS_COMPILER_VERSION;
  sourceSetDigest: string;
  deterministicDigest: string;
}

export interface ExtractionCandidate {
  candidateId: string;
  lineageKey: string;
  sourceRef: RequirementSourceRef;
  sourceSpan: SourceLocation;
  candidateStatement: string;
  title: string;
  proposedDomain: RequirementDomain;
  proposedKind: RequirementKind;
  proposedStrength: RequirementStrength;
  proposedAuthority: RequirementAuthorityClass;
  priority: number;
  criticality: Criticality;
  typedPredicate: RequirementPredicate;
  conditions: OperatingCondition[];
  applicabilityCondition?: ConditionExpression;
  subjectRefsOrRoles: string[];
  capabilityDemandIds: string[];
  ambiguityNotes: string[];
  missingFields: string[];
  confidence: number;
  rationaleForClassification: string;
  owner: string;
  requestedStatus: "proposed" | "confirmed";
  extractionActor: { actorId: string; actorKind: EngineeringActor["actorKind"]; modelRef?: string; promptDigest?: string; toolSchemaDigest?: string };
  createdAt: string;
  relatedRequirementRefs?: string[];
  assumptionRefs?: string[];
}

export interface StructuredExtractionEnvelope {
  schemaVersion: 1;
  sourceId: string;
  sourceVersion: string;
  modelRef?: string;
  promptDigest?: string;
  toolSchemaDigest?: string;
  candidates: ExtractionCandidate[];
}

export interface RequirementsCompileInput {
  tenantId: string;
  projectId: string;
  title: string;
  purpose: string;
  sourceArtifacts: RequirementSourceArtifact[];
  extractionEnvelopes: StructuredExtractionEnvelope[];
  capabilityProfiles: DesignCapabilityProfile[];
  selectedCapabilityProfileRefs: string[];
  assumptions: Assumption[];
  hypotheses: Hypothesis[];
  defaultsApplied: AppliedDefault[];
  approvals: RequirementApproval[];
  previousPackage?: DesignRequirementsPackage;
  downstreamArtifactRefs?: Array<{ artifactId: string; dependencyKeys: string[]; evidenceState?: ConstraintEvaluationState }>;
}

export type RequirementsCompileResult =
  | { ok: true; package: DesignRequirementsPackage; diagnostics: RequirementDiagnostic[]; semanticDiff: RequirementsSemanticDiff }
  | { ok: false; candidateDigest: string; diagnostics: RequirementDiagnostic[] };

export interface RequirementsSemanticDiff {
  fromRevision?: number;
  toRevision: number;
  sourceChanges: Array<{ sourceId: string; change: "added" | "updated" | "removed" | "unchanged" }>;
  requirementChanges: Array<{ requirementId: string; change: "added" | "changed" | "removed" | "unchanged"; fields: string[] }>;
  assumptionChanges: Array<{ assumptionId: string; change: "added" | "changed" | "removed" | "unchanged" }>;
  capabilityChanges: Array<{ requirementId: string; from?: string; to: string }>;
  obligationChanges: Array<{ obligationId: string; change: "added" | "changed" | "removed" | "unchanged" }>;
  invalidatedDownstreamArtifactIds: string[];
  deterministicDigest: string;
}

export type RequirementsOperation =
  | { kind: "add_requirement_candidate"; candidate: ExtractionCandidate }
  | { kind: "update_requirement_candidate"; requirementId: string; expectedRevision: number; candidate: ExtractionCandidate }
  | { kind: "supersede_requirement"; requirementId: string; expectedRevision: number; replacementCandidateId: string }
  | { kind: "reject_requirement"; requirementId: string; expectedRevision: number; reason: string }
  | { kind: "add_assumption"; assumption: Assumption }
  | { kind: "accept_assumption"; assumptionId: string; expectedRevision: number; approvalId: string }
  | { kind: "reject_assumption" | "expire_assumption"; assumptionId: string; expectedRevision: number; reason: string }
  | { kind: "apply_default" | "remove_default"; defaultId: string }
  | { kind: "answer_question"; questionId: string; answerSourceRef: RequirementSourceRef }
  | { kind: "reopen_question"; questionId: string; reason: string }
  | { kind: "resolve_conflict" | "reopen_conflict"; conflictId: string; reason: string }
  | { kind: "select_capability_profile"; profileRef: string }
  | { kind: "approve_package" | "revoke_package_approval"; approval: RequirementApproval }
  | { kind: "publish_package_revision"; expectedDraftDigest: string }
  | { kind: "attach_source_revision" | "detach_source_revision"; sourceId: string; sourceVersion: string }
  | { kind: "approve_constraint_proposal"; proposalId: string; approval: RequirementApproval }
  | { kind: "update_verification_obligation"; obligation: VerificationObligation };

export interface RequirementsTransaction {
  schemaVersion: typeof REQUIREMENTS_TRANSACTION_SCHEMA_VERSION;
  transactionId: string;
  projectId: string;
  branchId: string;
  basePackageRevision: number;
  basePackageDigest: string;
  baseProjectRevision: ProjectRevision;
  actor: EngineeringActor;
  reason: string;
  operations: RequirementsOperation[];
  approvals: RequirementApproval[];
  provenance: { source: "ui" | "api" | "ai" | "import" | "migration" | "collaboration"; sourceRefIds: string[]; toolVersion?: string };
  createdAt: string;
  deterministicDigest: string;
}

export interface RequirementsTransactionConflict {
  conflictId: string;
  transactionId: string;
  conflictClass: "stale_base" | "same_requirement" | "assumption_approval" | "profile_change" | "conflict_resolution" | "source_revision" | "authorization";
  involvedIds: string[];
  explanation: string;
  allowedResolutions: Array<"keep_head" | "apply_incoming" | "manual_merge" | "proposal_branch" | "reject">;
  status: "open" | "resolved" | "rejected";
}

export interface RequirementsTransactionRecord {
  transaction: RequirementsTransaction;
  resultPackageRevision?: number;
  resultPackageDigest?: string;
  semanticDiff?: RequirementsSemanticDiff;
  conflict?: RequirementsTransactionConflict;
  invalidatedDependencyKeys: string[];
  status: "accepted" | "rejected" | "conflicted" | "undone";
  integrityDigest: string;
}

export interface LegacyIntentInput {
  projectId: string;
  projectName: string;
  description?: string;
  existingConstraintDocuments: ConstraintDocument[];
  sourceCapturedAt: string;
  actorId: string;
}

export interface LegacyMigrationResult {
  sourceArtifacts: RequirementSourceArtifact[];
  extractionEnvelopes: StructuredExtractionEnvelope[];
  orphanConstraintIds: string[];
  diagnostics: RequirementDiagnostic[];
}
