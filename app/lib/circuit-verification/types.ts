import type { EngineeringActor } from "../engineering/types";
import type {
  SchematicProjectState,
  SchematicSemanticDiff,
  SchematicSemanticGraph,
  VariantGraphProjection,
} from "../schematic-compiler/types";

export const CIRCUIT_VERIFICATION_SCHEMA = "sirkit.circuit-verification.v1" as const;
export const CIRCUIT_VERIFICATION_PROBLEM_SCHEMA = "sirkit.circuit-verification-problem.v1" as const;
export const CIRCUIT_VERIFICATION_RUN_SCHEMA = "sirkit.circuit-verification-run.v1" as const;
export const CIRCUIT_VERIFICATION_POLICY = "circuit-verification/1.0.0" as const;

export type VerificationApplicability =
  | "applicable"
  | "not_applicable"
  | "unknown"
  | "unsupported"
  | "blocked_missing_input"
  | "internal_error";

export type EngineeringResult =
  | "pass"
  | "violation"
  | "unknown"
  | "unsupported"
  | "not_evaluated"
  | "stale"
  | "internal_error"
  | "not_applicable";

export type VerificationSeverity = "blocking" | "error" | "warning" | "information";
export type FindingWorkflowState = "open" | "acknowledged" | "waived" | "resolved" | "reopened" | "obsolete" | "pending_external_review";
export type CircuitVerificationVerdict = "READY" | "BLOCKED" | "VERIFICATION_INCOMPLETE" | "STALE";

export type RuleCategory =
  | "graph_integrity"
  | "atomic_binding"
  | "pin_compatibility"
  | "power_ground_domain"
  | "application_support"
  | "interface_connector_test"
  | "variant_population"
  | "requirement_coverage"
  | "currency_lineage"
  | "external_specialist_review";

export interface CircuitVerificationCapabilityProfile {
  profileId: "low-voltage-embedded-circuit-verification-v1";
  version: "1.0.0";
  supportedCategories: RuleCategory[];
  requiredCategories: RuleCategory[];
  externalReviewDomains: string[];
  unsupportedDomains: string[];
  limits: {
    maximumComponents: number;
    maximumPins: number;
    maximumNets: number;
    maximumVariants: number;
    maximumContextsPerVariant: number;
    maximumRuleInstances: number;
    maximumSelectorResults: number;
  };
  policies: {
    registry: string;
    applicability: string;
    fullOracle: string;
    stableIdentity: string;
    waiver: string;
    parity: string;
    readiness: string;
  };
  approvalState: "approved";
  deterministicDigest: string;
}

export interface Cd9Diagnostic {
  diagnosticId: string;
  code: string;
  severity: VerificationSeverity;
  message: string;
  objectRefs: string[];
  sourceRefs: string[];
  ownerStage: "CD-1" | "CD-2" | "CD-3" | "CD-4" | "CD-5" | "CD-6" | "CD-7" | "CD-8" | "CD-9" | "external";
  minimumSafeAction: string;
}

export interface Cd9UpstreamCompletionSignoff {
  schemaVersion: "sirkit.cd9-upstream-signoff.v1";
  cd1Verdict: "CD-1 COMPLETE";
  cd2Verdict: "CD-2 COMPLETE";
  cd3Verdict: "CD-3 COMPLETE";
  cd4Verdict: "CD-4 COMPLETE";
  cd5Verdict: "CD-5 COMPLETE";
  cd6Verdict: "CD-6 COMPLETE";
  cd7Verdict: "CD-7 COMPLETE";
  cd8Verdict: "CD-8 COMPLETE";
  stageDigests: Array<{ stage: "CD-1" | "CD-2" | "CD-3" | "CD-4" | "CD-5" | "CD-6" | "CD-7" | "CD-8"; stateDigest: string; decisionDigest: string }>;
  approvedSchematicCandidateId: string;
  approvedSchematicCandidateDigest: string;
  semanticGraphDigest: string;
  roundTripCertificateDigest: string;
  approver: EngineeringActor;
  approvedAt: string;
  deterministicDigest: string;
}

export interface CircuitVerificationProblem {
  schemaVersion: typeof CIRCUIT_VERIFICATION_PROBLEM_SCHEMA;
  problemId: string;
  tenantId: string;
  projectId: string;
  branchId: string;
  revision: number;
  cd8ProjectDigest: string;
  cd8CandidateId: string;
  cd8CandidateDigest: string;
  semanticGraphRevisionId: string;
  semanticGraphDigest: string;
  roundTripCertificateId: string;
  roundTripCertificateDigest: string;
  upstreamRevisionRefs: Cd9UpstreamCompletionSignoff["stageDigests"];
  capabilityProfileDigest: string;
  ruleRegistryDigest: string;
  requiredVariantIds: string[];
  requiredContextKinds: string[];
  requirementRevisionRefs: Array<{ requirementId: string; revisionDigest: string; safetyCritical: boolean }>;
  dependencyDigest: string;
  lifecycleState: "blocked_prerequisite" | "ready_for_verification" | "invalidated";
  blockingDiagnosticIds: string[];
  createdBy: EngineeringActor;
  createdAt: string;
  deterministicDigest: string;
}

export type CircuitVerificationProblemResult =
  | { ok: true; problem: CircuitVerificationProblem; graph: SchematicSemanticGraph; diagnostics: Cd9Diagnostic[] }
  | { ok: false; verdict: "BLOCKED BY CD-8" | "BLOCKED"; diagnostics: Cd9Diagnostic[] };

export type RuleTargetKind = "graph" | "component" | "pin" | "net" | "endpoint" | "disposition" | "rail" | "tie" | "port_binding" | "variant_projection" | "requirement";
export type RulePredicateField =
  | "electricalType"
  | "terminalClassification"
  | "dispositionKind"
  | "semanticKind"
  | "scopeKind"
  | "validationState"
  | "lifecycleState";

export interface RuleSelector {
  target: RuleTargetKind;
  predicates?: Array<{ field: RulePredicateField; operator: "equals" | "not_equals" | "in" | "exists"; value?: string | string[] | boolean }>;
  expectedCardinality?: { minimum: number; maximum?: number };
  limit?: number;
}

export type RuleImplementationRef =
  | "builtin.graph_integrity"
  | "builtin.variant_projection_integrity"
  | "builtin.exact_component_binding"
  | "builtin.pin_disposition_complete"
  | "builtin.endpoint_reciprocity"
  | "builtin.connected_atomic_nc"
  | "builtin.push_pull_contention"
  | "builtin.required_input_driver"
  | "builtin.rail_source_presence"
  | "builtin.distinct_tie_integrity"
  | "builtin.hierarchy_binding_integrity"
  | "builtin.round_trip_current"
  | "builtin.requirement_traceability";

export interface VerificationRuleDefinition {
  ruleId: string;
  revision: number;
  semanticVersion: string;
  title: string;
  category: RuleCategory;
  severity: VerificationSeverity;
  selector: RuleSelector;
  implementationRef: RuleImplementationRef;
  requiredInputs: string[];
  evidenceRefs: string[];
  remediationTemplate: string;
  waiverPolicy: "non_waivable" | "independent_approval" | "external_authority_only";
  lifecycleState: "draft" | "reviewed" | "approved" | "deprecated" | "withdrawn";
  reviewer?: EngineeringActor;
  reviewedAt?: string;
  deterministicDigest: string;
}

export interface RuleRegistrySnapshot {
  registryId: string;
  revision: number;
  profileId: CircuitVerificationCapabilityProfile["profileId"];
  rules: VerificationRuleDefinition[];
  requiredCategoryIds: RuleCategory[];
  lifecycleState: "draft" | "approved" | "invalidated";
  approvedBy?: EngineeringActor;
  approvedAt?: string;
  deterministicDigest: string;
}

export interface VerificationContext {
  contextId: string;
  variantId: string;
  contextKind: "static_unpowered" | "static_powered" | "startup" | "shutdown" | "programming" | "external_power_present" | "project_defined";
  factRefs: string[];
  assumptionRefs: string[];
  completeness: "complete" | "unknown" | "unsupported";
  deterministicDigest: string;
}

export interface RuleApplicabilityRecord {
  applicabilityId: string;
  ruleId: string;
  ruleDigest: string;
  contextId: string;
  targetIds: string[];
  state: VerificationApplicability;
  reasonCode: string;
  evidenceRefs: string[];
  deterministicDigest: string;
}

export interface RequiredRuleInstance {
  instanceId: string;
  ruleId: string;
  ruleDigest: string;
  category: RuleCategory;
  contextId: string;
  variantId: string;
  targetIds: string[];
  applicabilityId: string;
  required: true;
  deterministicDigest: string;
}

export interface RequiredRuleDenominator {
  denominatorId: string;
  graphDigest: string;
  registryDigest: string;
  contextDigest: string;
  instances: RequiredRuleInstance[];
  applicability: RuleApplicabilityRecord[];
  categoryCoverage: Array<{ category: RuleCategory; state: "covered" | "missing" | "unknown" | "unsupported"; ruleIds: string[] }>;
  variantCoverage: Array<{ variantId: string; contextIds: string[]; state: "covered" | "missing" }>;
  nonVacuous: boolean;
  diagnostics: Cd9Diagnostic[];
  deterministicDigest: string;
}

export interface VerificationRuleResult {
  resultId: string;
  ruleInstanceId: string;
  ruleId: string;
  ruleDigest: string;
  category: RuleCategory;
  contextId: string;
  variantId: string;
  targetIds: string[];
  applicability: VerificationApplicability;
  engineeringResult: EngineeringResult;
  severity: VerificationSeverity;
  reasonCode: string;
  message: string;
  evidenceRefs: string[];
  remediation: string[];
  evaluatorVersion: string;
  durationMs: number;
  deterministicDigest: string;
}

export interface CircuitFinding {
  findingId: string;
  stableIdentity: string;
  resultId: string;
  ruleId: string;
  ruleDigest: string;
  contextId: string;
  variantId: string;
  semanticAnchorIds: string[];
  engineeringResult: Exclude<EngineeringResult, "pass" | "not_applicable">;
  severity: VerificationSeverity;
  workflowState: FindingWorkflowState;
  physicalResultPreserved: true;
  summary: string;
  evidenceRefs: string[];
  remediation: string[];
  firstSeenRunId: string;
  currentRunId: string;
  deterministicDigest: string;
}

export interface VerificationExecutionRecord {
  executionId: string;
  ruleInstanceId: string;
  startedAt: string;
  finishedAt: string;
  state: "completed" | "failed_isolated" | "not_evaluated";
  diagnosticIds: string[];
  deterministicDigest: string;
}

export interface FullOracleRun {
  schemaVersion: typeof CIRCUIT_VERIFICATION_RUN_SCHEMA;
  runId: string;
  runKind: "full" | "incremental_provisional";
  projectId: string;
  branchId: string;
  problemDigest: string;
  graphRevisionId: string;
  graphDigest: string;
  registryDigest: string;
  denominatorDigest: string;
  contexts: VerificationContext[];
  results: VerificationRuleResult[];
  findings: CircuitFinding[];
  executions: VerificationExecutionRecord[];
  diagnostics: Cd9Diagnostic[];
  executionState: "completed" | "completed_with_isolated_errors" | "aborted";
  startedAt: string;
  finishedAt: string;
  evaluatorVersion: string;
  deterministicDigest: string;
}

export interface IncrementalImpactReport {
  impactId: string;
  diffId: string;
  affectedRuleIds: string[];
  affectedContextIds: string[];
  affectedTargetIds: string[];
  fullOracleRequired: boolean;
  reasonCodes: string[];
  deterministicDigest: string;
}

export interface OracleParityReport {
  parityId: string;
  fullRunId: string;
  incrementalRunId: string;
  state: "equivalent" | "mismatch" | "not_compared";
  missingResultIds: string[];
  extraResultIds: string[];
  changedResultIds: string[];
  deterministicDigest: string;
}

export interface CircuitWaiver {
  waiverId: string;
  findingStableIdentities: string[];
  ruleIds: string[];
  semanticAnchorIds: string[];
  variantIds: string[];
  contextIds: string[];
  graphDigest: string;
  registryDigest: string;
  justification: string;
  riskStatement: string;
  requestedBy: EngineeringActor;
  approvedBy: EngineeringActor;
  createdAt: string;
  expiresAt: string;
  state: "active" | "expired" | "invalidated" | "revoked";
  physicalResultPreserved: true;
  deterministicDigest: string;
}

export interface RequirementCoverageRecord {
  requirementId: string;
  implementationState: "implemented" | "not_implemented" | "unknown" | "not_applicable";
  verificationState: "verified" | "failed" | "unknown" | "unsupported" | "not_evaluated" | "not_applicable";
  satisfactionState: "satisfied" | "not_satisfied" | "unknown" | "not_applicable";
  implementationRefs: string[];
  ruleResultIds: string[];
  evidenceRefs: string[];
  deterministicDigest: string;
}

export interface VerificationCurrencyReport {
  currencyId: string;
  state: "current" | "stale" | "unknown";
  checkedDigests: Array<{ kind: string; expected: string; actual?: string; state: "current" | "stale" | "missing" }>;
  deterministicDigest: string;
}

export interface CircuitReadinessReport {
  reportId: string;
  claim: "CIRCUIT_VERIFICATION_READINESS";
  verdict: CircuitVerificationVerdict;
  graphDigest: string;
  registryDigest: string;
  denominatorDigest: string;
  fullOracleRunId?: string;
  currency: VerificationCurrencyReport;
  requirementCoverage: RequirementCoverageRecord[];
  blockingFindingIds: string[];
  unwaivedFindingIds: string[];
  coverageGapCodes: string[];
  parityState: OracleParityReport["state"];
  activeWaiverIds: string[];
  limitations: string[];
  permittedActions: Array<"edit_design" | "rerun_full_verification" | "request_external_review" | "approve_for_CD10">;
  deterministicDigest: string;
}

export interface CircuitVerificationProjectState {
  schemaVersion: typeof CIRCUIT_VERIFICATION_SCHEMA;
  projectId: string;
  branchId: string;
  problem: CircuitVerificationProblem;
  capabilityProfile: CircuitVerificationCapabilityProfile;
  registry: RuleRegistrySnapshot;
  contexts: VerificationContext[];
  denominators: RequiredRuleDenominator[];
  fullOracleRuns: FullOracleRun[];
  incrementalRuns: FullOracleRun[];
  parityReports: OracleParityReport[];
  waivers: CircuitWaiver[];
  requirementCoverage: RequirementCoverageRecord[];
  readinessReports: CircuitReadinessReport[];
  transactionRecords: Array<{ transactionId: string; actor: EngineeringActor; operation: string; beforeDigest?: string; afterDigest: string; createdAt: string; integrityDigest: string }>;
  deterministicDigest: string;
}

export interface CircuitVerificationProblemInput {
  tenantId: string;
  branchId: string;
  schematicProject: SchematicProjectState;
  upstreamSignoff: Cd9UpstreamCompletionSignoff;
  capabilityProfile: CircuitVerificationCapabilityProfile;
  registry: RuleRegistrySnapshot;
  requirementRevisionRefs: CircuitVerificationProblem["requirementRevisionRefs"];
  requiredContextKinds: string[];
  actor: EngineeringActor;
  createdAt: string;
}

export interface VerificationOracleInput {
  problem: CircuitVerificationProblem;
  graph: SchematicSemanticGraph;
  projections: VariantGraphProjection[];
  registry: RuleRegistrySnapshot;
  capabilityProfile: CircuitVerificationCapabilityProfile;
  contexts: VerificationContext[];
  denominator: RequiredRuleDenominator;
  requirementCoverage?: RequirementCoverageRecord[];
  startedAt: string;
  finishedAt?: string;
}

export interface IncrementalVerificationInput extends Omit<VerificationOracleInput, "denominator"> {
  diff: SchematicSemanticDiff;
  denominator: RequiredRuleDenominator;
}
