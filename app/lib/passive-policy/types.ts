import type { EngineeringActor } from "../engineering/types";
import type { ComponentPhysicalBinding, FootprintAssetBinding, PackageBinding, PinPadMappingReference, StableComponentIdentity } from "../physical-binding/types";

export const PASSIVE_POLICY_SCHEMA_VERSION = "sirkit.project-passive-package-policy.v1" as const;
export const PASSIVE_PROFILE_SCHEMA_VERSION = "sirkit.passive-package-profile.v1" as const;
export const PASSIVE_FACT_SNAPSHOT_VERSION = "sirkit.passive-fact-snapshot.v1" as const;
export const PASSIVE_EVALUATION_REQUEST_VERSION = "sirkit.passive-policy-evaluation-request.v1" as const;
export const PASSIVE_EVALUATION_RESULT_VERSION = "sirkit.passive-policy-evaluation-result.v1" as const;
export const PASSIVE_PREVIEW_VERSION = "sirkit.passive-policy-preview.v1" as const;
export const PASSIVE_POLICY_RECORD_VERSION = "sirkit.passive-policy-record.v1" as const;
export const PASSIVE_POLICY_AUDIT_VERSION = "sirkit.passive-policy-audit.v1" as const;
export const PASSIVE_POLICY_INVALIDATION_VERSION = "sirkit.passive-policy-invalidation.v1" as const;
export const PASSIVE_POLICY_EVALUATOR_VERSION = "sirkit.passive-policy-evaluator/5.0.0" as const;
export const PASSIVE_POLICY_CANONICAL_VERSION = "sirkit.passive-policy-canonical/1" as const;
export const PASSIVE_POLICY_RULE_LANGUAGE_VERSION = "sirkit.passive-policy-rules/1.0.0" as const;
export const PASSIVE_EXCEPTION_CONTRACT_VERSION = "sirkit.passive-component-exception.v2" as const;

export type PassiveClass = "resistor" | "capacitor" | "inductor" | "ferrite_bead" | "jumper" | "thermistor" | "varistor" | "fuse" | "diode" | "led" | "crystal" | "network" | "connector" | "switch" | "electromechanical" | "integrated_circuit" | "unknown";
export type PassiveRole = "decoupling" | "bypass" | "bulk_energy_storage" | "pull_up" | "pull_down" | "bias" | "series_signal" | "led_current_limit" | "current_sense" | "shunt" | "filter" | "timing" | "rf_matching" | "rf_termination" | "safety_isolation" | "power_path" | "zero_ohm_link" | "generic" | "unknown";
export type PassiveRiskFlag = "polarized" | "bulk" | "high_voltage" | "safety_rated" | "mains" | "high_power" | "pulse" | "surge" | "current_sense" | "precision" | "low_tempco" | "rf" | "timing_critical" | "high_current" | "ripple_critical" | "dc_bias_critical" | "network_array" | "adjustable" | "magnetic_power" | "unknown_risk";
export type PassiveFactState = "exact" | "approved_inference" | "unknown" | "conflicting" | "stale";
export type PassivePolicyMode = "exact_part_required" | "characterized_generic" | "layout_reservation";
export type PassivePolicyLifecycle = "draft" | "validating" | "invalid" | "ready_for_review" | "approved" | "published" | "stale" | "revoked" | "superseded" | "archived";
export type PassivePolicyApprovalState = "unreviewed" | "pending" | "approved" | "rejected" | "revoked";
export type PassivePolicyStatus = "eligible_exact_part" | "eligible_characterized_generic" | "eligible_layout_reservation" | "not_applicable" | "excluded_safety" | "excluded_specialized_role" | "requires_exact_part" | "missing_required_facts" | "conflicting_facts" | "conflicting_rules" | "profile_unavailable" | "mapping_unverified" | "policy_draft_unapproved" | "policy_stale" | "unsupported" | "error";
export type PassiveRuleAction = "assign_package_profile" | "exclude" | "require_exact_part" | "require_user_decision" | "diagnostic_only";
export type PassiveExceptionAction = "opt_out" | "require_exact_part" | "assign_profile";
export type PassiveFactKey = "value" | "resistance" | "capacitance" | "inductance" | "impedance" | "tolerance" | "working_voltage" | "transient_voltage" | "power" | "current" | "temperature" | "temperature_coefficient" | "dielectric" | "technology" | "polarity" | "esr" | "dcr" | "frequency" | "pulse" | "surge" | "safety_rating" | "dc_bias" | "ripple_current" | "role" | "class" | "subclass";
export type PassiveDimension = "dimensionless" | "resistance" | "capacitance" | "inductance" | "impedance" | "voltage" | "power" | "current" | "temperature" | "temperature_coefficient" | "frequency";

export interface NormalizedPassiveValue { dimension: PassiveDimension; valueSI: number; canonicalUnit: string; sourceText: string; parserVersion: "sirkit.passive-value-parser/1" }
export interface PassiveFact<T = string | boolean | number | string[] | NormalizedPassiveValue> { factId: string; key: PassiveFactKey; state: PassiveFactState; value?: T; sourceRefs: string[]; evidenceRefs: string[]; approvedBy?: EngineeringActor; observedAt?: string }

export interface PassiveComponentScope { tenantId: string; projectId: string; branchId: string; boardInstanceId: string; componentInstanceId: string; hierarchyPath: string[]; assemblyVariantId: string }
export interface PassiveComponentSnapshot {
  schemaVersion: typeof PASSIVE_FACT_SNAPSHOT_VERSION;
  snapshotId: string;
  scope: PassiveComponentScope;
  componentRevisionId: string;
  stableIdentity: StableComponentIdentity;
  populationState: "populated" | "not_populated" | "optional" | "unknown";
  passiveClass: PassiveFact<PassiveClass>;
  subclass: PassiveFact<string>;
  applicationRoles: PassiveFact<PassiveRole[]>;
  technology: PassiveFact<string>;
  polarity: PassiveFact<"polarized" | "nonpolar" | "unknown">;
  facts: Partial<Record<PassiveFactKey, PassiveFact>>;
  riskFlags: Partial<Record<PassiveRiskFlag, PassiveFact<boolean>>>;
  approvedTags: string[];
  voltageDomainIds: string[];
  exactBinding?: { binding: ComponentPhysicalBinding; effectiveSelected: boolean; currentApproved: boolean };
  exactPartCompatibleProfileIds: string[];
  evidenceRefs: string[];
  dependencyDigest: string;
}

export interface NormalizedPackageIdentity {
  identitySystem: "metric_imperial_explicit";
  canonicalId: string;
  imperialCode: "0201" | "0402" | "0603" | "0805" | "1206";
  metricCode: "0603" | "1005" | "1608" | "2012" | "3216";
  lengthUm: number;
  widthUm: number;
  acceptedAliases: string[];
}

export interface PassiveFeasibilityEnvelope {
  numericRanges: Array<{ fact: PassiveFactKey; dimension: PassiveDimension; minSI?: number; maxSI?: number; minInclusive: boolean; maxInclusive: boolean }>;
  allowedTechnologies: string[];
  forbiddenRiskFlags: PassiveRiskFlag[];
  notes: string[];
}

export interface AssemblyProfileSnapshot { assemblyProfileId: string; revisionId: string; state: "approved" | "draft" | "stale" | "unavailable"; allowedMountingTechnologies: Array<"smd" | "through_hole">; minimumChipLengthUm?: number; process: "hand" | "reflow" | "mixed" | "unknown"; dependencyDigest: string }

export interface PassivePackageProfile {
  profileSchemaVersion: typeof PASSIVE_PROFILE_SCHEMA_VERSION;
  profileId: string;
  revisionId: string;
  revision: number;
  displayName: string;
  normalizedPackageIdentity: NormalizedPackageIdentity;
  mountingTechnology: "smd" | "through_hole";
  exactPackageIdentity: PackageBinding;
  exactFootprintAssetIdentity: FootprintAssetBinding;
  stage4MappingProfileRef: PinPadMappingReference;
  supportedPassiveClasses: PassiveClass[];
  feasibilityEnvelope: PassiveFeasibilityEnvelope;
  assemblyProfileIds: string[];
  sourceEvidenceRefs: string[];
  approvalState: PassivePolicyApprovalState;
  technicalState: "valid" | "invalid" | "pending" | "unsupported";
  freshnessState: "current" | "stale" | "unknown" | "missing_source";
  lifecycleState: "draft" | "active" | "revoked" | "superseded" | "archived";
  dependencyDigests: string[];
  profileDigest: string;
}

export interface PassiveNumericConstraint { fact: PassiveFactKey; operator: "equal" | "between" | "at_most" | "at_least"; dimension: PassiveDimension; valueSI?: number; minSI?: number; maxSI?: number; minInclusive?: boolean; maxInclusive?: boolean }
export interface PassiveRuleMatcher { passiveClasses: PassiveClass[]; subclasses: string[]; roles: PassiveRole[]; assemblyVariantIds: string[]; voltageDomainIds: string[]; approvedTags: string[]; numericConstraints: PassiveNumericConstraint[]; requiredKnownFacts: PassiveFactKey[]; factEquals: Array<{ fact: PassiveFactKey; values: Array<string | boolean> }>; maximumTerms: number }

export interface PassivePackageRule {
  ruleId: string;
  revision: number;
  enabled: boolean;
  title: string;
  description: string;
  action: PassiveRuleAction;
  matcher: PassiveRuleMatcher;
  permittedUnknownFacts: PassiveFactKey[];
  forbiddenRiskFlags: PassiveRiskFlag[];
  targetProfileId?: string;
  targetProfileRevisionId?: string;
  specificity: 1 | 2 | 3 | 4 | 5;
  priority: number;
  issueCode: string;
  evidenceRefs: string[];
  dependencyDigests: string[];
  authoredBy: EngineeringActor;
}

export interface PassiveExclusionRule { exclusionId: string; enabled: boolean; title: string; matcher: PassiveRuleMatcher; action: "exclude" | "require_exact_part" | "require_user_decision"; issueCode: string; evidenceRefs: string[] }
export interface PassiveExceptionVariantAuthority {
  assemblyVariantId: string;
  boardInstanceId: string;
  componentSnapshotId: string;
  componentRevisionId: string;
  componentDigest: string;
  stableComponentIdentityDigest: string;
  contextDependencyDigest: string;
}
export interface PassiveExceptionAuthoritySnapshot {
  tenantId: string;
  projectId: string;
  branchId: string;
  componentInstanceId: string;
  variants: PassiveExceptionVariantAuthority[];
  policyId: string;
  approvedAgainstPolicyRevisionId: string;
  approvedAgainstPolicyDigest: string;
  expectedPolicyRecordRevision: number;
  effectivePolicyRevisionId?: string;
  assemblyProfileId: string;
  assemblyProfileRevisionId: string;
  assemblyProfileDigest: string;
}
export interface PassiveExceptionNoSelection { kind: "none" }
export interface PassiveExceptionProfileSelection {
  kind: "profile";
  profileId: string;
  profileRevisionId: string;
  profileDigest: string;
  packageIdentityId: string;
  packageRevisionId: string;
  footprintLogicalAssetId: string;
  footprintAssetVersionId: string;
  footprintContentDigest: string;
  mappingRevisionId: string;
  mappingContentDigest: string;
  mappingResultDigest: string;
}
export type PassiveExceptionSelection = PassiveExceptionNoSelection | PassiveExceptionProfileSelection;
export interface PassiveComponentException {
  exceptionContractVersion?: typeof PASSIVE_EXCEPTION_CONTRACT_VERSION;
  exceptionId: string;
  decisionId?: string;
  decisionRevision?: number;
  predecessorDecisionId?: string;
  supersededByDecisionId?: string;
  componentInstanceId: string;
  assemblyVariantIds: string[];
  action: PassiveExceptionAction;
  targetProfileId?: string;
  selection?: PassiveExceptionSelection;
  authority?: PassiveExceptionAuthoritySnapshot;
  state: "approved" | "pending" | "rejected" | "revoked" | "superseded" | "stale";
  approvalDigest?: string;
  mutationDigest?: string;
  reason: string;
  evidenceRefs: string[];
  expiresAt?: string;
  approvedAt?: string;
  createdBy: EngineeringActor;
}
type RevisionCompletePassiveExceptionCore = Omit<PassiveComponentException, "exceptionContractVersion" | "decisionId" | "decisionRevision" | "action" | "selection" | "authority" | "approvalDigest" | "mutationDigest" | "approvedAt"> & {
  exceptionContractVersion: typeof PASSIVE_EXCEPTION_CONTRACT_VERSION;
  decisionId: string;
  decisionRevision: number;
  authority: PassiveExceptionAuthoritySnapshot & { effectivePolicyRevisionId: string };
  approvalDigest: string;
  mutationDigest: string;
  approvedAt: string;
};
export type RevisionCompletePassiveComponentException =
  | (RevisionCompletePassiveExceptionCore & { action: "opt_out" | "require_exact_part"; selection: PassiveExceptionNoSelection })
  | (RevisionCompletePassiveExceptionCore & { action: "assign_profile"; selection: PassiveExceptionProfileSelection; targetProfileId: string });

export interface ProjectPassivePackagePolicy {
  policySchemaVersion: typeof PASSIVE_POLICY_SCHEMA_VERSION;
  ruleLanguageVersion: typeof PASSIVE_POLICY_RULE_LANGUAGE_VERSION;
  evaluatorVersion: typeof PASSIVE_POLICY_EVALUATOR_VERSION;
  policyId: string;
  revisionId: string;
  revision: number;
  tenantId: string;
  projectId: string;
  branchId: string;
  assemblyVariantIds: string[];
  lifecycleState: PassivePolicyLifecycle;
  approvalState: PassivePolicyApprovalState;
  evaluationMode: PassivePolicyMode;
  layoutReservationEnabled: boolean;
  rules: PassivePackageRule[];
  globalExclusions: PassiveExclusionRule[];
  componentExceptions: PassiveComponentException[];
  assemblyProfileRef: { assemblyProfileId: string; revisionId: string; dependencyDigest: string };
  systemExclusionPolicyVersion: "sirkit.passive-mandatory-exclusions/1.0.0";
  policyOwner: EngineeringActor;
  evidenceRefs: string[];
  createdAt: string;
  publishedAt?: string;
  supersedesRevisionId?: string;
  dependencyDigests: string[];
  technicalDigest: string;
}

export interface PassivePolicyDependencySnapshot { componentDigest: string; policyDigest: string; profileDigests: string[]; mappingDigests: string[]; footprintDigests: string[]; assemblyProfileDigest: string; evaluatorVersion: typeof PASSIVE_POLICY_EVALUATOR_VERSION; dependencyDigest: string }
export interface PassivePolicyGate { gateId: string; code: string; category: "policy" | "component" | "safety" | "rule" | "profile" | "mapping" | "assembly" | "mode" | "override"; state: "pass" | "fail" | "pending" | "unknown" | "not_applicable"; blocking: boolean; message: string; factRefs: string[]; dependencyRefs: string[] }
export interface PassivePolicyIssue { issueId: string; code: string; severity: "info" | "warning" | "error" | "blocking"; blocking: boolean; message: string; componentInstanceId: string; ruleIds: string[]; factRefs: string[]; profileRefs: string[]; remediation: "provide_facts" | "choose_exact_part" | "review_conflict" | "fix_profile" | "approve_policy" | "edit_policy" | "opt_out" | "unsupported"; safeDetails: Record<string, string | number | boolean> }
export interface PassiveManufacturingGap { gapId: string; category: "exact_part" | "rating" | "derating" | "availability" | "assembly" | "lifecycle" | "evidence" | "specialized_validation"; code: string; factKey?: PassiveFactKey; message: string; blockingManufacturing: true }
export type PassiveRuleDispositionState = "matched_eligible" | "matched_excluded_safety" | "matched_exact_override" | "disqualified_class" | "disqualified_role" | "disqualified_scope" | "disqualified_value" | "disqualified_missing_fact" | "disqualified_conflicting_fact" | "target_profile_invalid" | "mapping_invalid" | "lower_precedence" | "equivalent_merged" | "conflicting_outcome" | "disabled";
export interface PassiveRuleDisposition { ruleId: string; state: PassiveRuleDispositionState; profileId?: string; reasonCodes: string[]; specificity: number; priority: number }
export interface PassivePolicyTraceStep { ordinal: number; phase: "validate" | "facts" | "override" | "safety" | "exceptions" | "rules" | "profiles" | "decision"; code: string; message: string; ruleIds: string[]; factRefs: string[]; safeDetails: Record<string, string | number | boolean> }

export interface PassivePolicyEvaluationRequest { requestSchemaVersion: typeof PASSIVE_EVALUATION_REQUEST_VERSION; requestId: string; tenantId: string; projectId: string; branchId: string; componentInstanceId: string; assemblyVariantId: string; policyRevisionId?: string; purpose: "preview" | "stage2_resolution" | "migration_analysis"; actorContext: EngineeringActor; requestedAt: string }
export interface PassivePolicyContext { request: PassivePolicyEvaluationRequest; component: PassiveComponentSnapshot; policy?: ProjectPassivePackagePolicy; profiles: PassivePackageProfile[]; assemblyProfile: AssemblyProfileSnapshot; overlappingPublishedPolicyIds: string[]; dependencySnapshot: PassivePolicyDependencySnapshot }

export interface PassivePolicyEvaluationResult {
  resultSchemaVersion: typeof PASSIVE_EVALUATION_RESULT_VERSION;
  evaluationId: string;
  resultDigest: string;
  componentInstanceId: string;
  assemblyVariantId: string;
  componentRevisionId: string;
  status: PassivePolicyStatus;
  mode?: PassivePolicyMode;
  selectedProfile?: PassivePackageProfile;
  selectedRuleIds: string[];
  matchedRules: PassiveRuleDisposition[];
  factAssessment: { known: PassiveFactKey[]; unknown: PassiveFactKey[]; conflicting: PassiveFactKey[]; stale: PassiveFactKey[]; permittedUnknown: PassiveFactKey[] };
  eligibilityGates: PassivePolicyGate[];
  unresolvedManufacturingFacts: PassiveManufacturingGap[];
  blockers: PassivePolicyIssue[];
  warnings: PassivePolicyIssue[];
  trace: PassivePolicyTraceStep[];
  policyId?: string;
  policyRevisionId?: string;
  policyTechnicalDigest?: string;
  appliedException?: { decisionId: string; decisionRevision: number; approvalDigest: string; mutationDigest: string; action: PassiveExceptionAction; evidenceRefs: string[]; profileRevisionId?: string };
  evaluatorVersion: typeof PASSIVE_POLICY_EVALUATOR_VERSION;
  dependencySnapshot: PassivePolicyDependencySnapshot;
  evaluatedAt: string;
  claims: { reservesLayoutPackage: boolean; selectsExactPart: false; manufacturingReady: false; certifiesAvailability: false; certifiesDerating: false; mutatesSchematic: false; mutatesPcb: false };
}

export interface PassiveProjectPreview { schemaVersion: typeof PASSIVE_PREVIEW_VERSION; previewId: string; policyRevisionId: string; assemblyVariantId: string; results: PassivePolicyEvaluationResult[]; summary: Record<PassivePolicyStatus, number>; changedComponentIds: string[]; manufacturingGapCounts: Record<string, number>; affectedStage2ComponentIds: string[]; affectedStage3PlanCount: number; routedBoardRiskComponentIds: string[]; boardChanged: false; previewDigest: string }

export interface PassivePolicyValidationReport { valid: boolean; policyDigest: string; errors: string[]; warnings: string[]; validatedAt: string }
export interface PassivePolicyRecord { schemaVersion: typeof PASSIVE_POLICY_RECORD_VERSION; recordId: string; revision: number; predecessorRecordId?: string; policy: ProjectPassivePackagePolicy; validation?: PassivePolicyValidationReport; approval: { state: PassivePolicyApprovalState; decisionId?: string; contentDigest?: string; actor?: EngineeringActor; decidedAt?: string; reason?: string }; lifecycle: PassivePolicyLifecycle; createdAt: string; createdBy: EngineeringActor; recordDigest: string }
export interface PassivePolicyAuditEvent { schemaVersion: typeof PASSIVE_POLICY_AUDIT_VERSION; eventId: string; policyId: string; fromRecordId: string | null; toRecordId: string; action: "create_draft" | "edit_draft" | "validate" | "submit" | "approve" | "publish" | "revoke" | "supersede" | "archive" | "edit_exception" | "approve_exception" | "revoke_exception" | "supersede_exception"; actor: EngineeringActor; reason: string; idempotencyKey: string; occurredAt: string; eventDigest: string }
export interface PassivePolicyInvalidationEvent { schemaVersion: typeof PASSIVE_POLICY_INVALIDATION_VERSION; eventId: string; tenantId: string; projectId: string; branchId: string; assemblyVariantIds: string[]; affectedComponentIds: string[]; fromPolicyRevisionId: string | null; toPolicyRevisionId: string; stage2CacheMode: "disabled"; stage2DependencyKeys: string[]; stage3PlansStaled: number | null; boardChanged: false; occurredAt: string; eventDigest: string }
export type PassivePolicyEffectStatus =
  | { state: "not_required" }
  | { state: "pending"; eventType: string; eventVersion: number; attempts: number }
  | { state: "retryable_failed"; eventType: string; eventVersion: number; attempts: number; errorCode: string }
  | { state: "terminal_failed"; eventType: string; eventVersion: number; attempts: number; errorCode: string }
  | { state: "completed"; eventType: string; eventVersion: number; attempts: number; completedAt: string };
export interface PassivePolicyConvergence {
  owner: { aggregateType: string; aggregateKey: string; aggregateRevision: number; recordId: string };
  state: "pending" | "retryable_failed" | "terminal_failed" | "completed";
  invalidation: PassivePolicyEffectStatus;
  outcome: { stage2DependencyKeys: string[]; stage3PlansStaled: number } | null;
}
export interface PassivePolicyCommitResult { record: PassivePolicyRecord; audit: PassivePolicyAuditEvent; invalidation: PassivePolicyInvalidationEvent; idempotent: boolean }
export interface PassivePolicyMutationRequest { requestId: string; tenantId: string; projectId: string; branchId: string; policyId: string; recordId?: string; expectedRevision: number; expectedPolicyDigest?: string; idempotencyKey: string; reason: string; actorContext: EngineeringActor; requestedAt: string }
export interface PassivePolicyExceptionApproveMutationRequest extends PassivePolicyMutationRequest { operation?: "approve"; exception: PassiveComponentException }
export interface PassivePolicyExceptionRevokeMutationRequest extends PassivePolicyMutationRequest { operation: "revoke"; exceptionId: string; expectedExceptionDecisionRevision: number; decisionEvidenceRefs: string[] }
export interface PassivePolicyExceptionSupersedeMutationRequest extends PassivePolicyMutationRequest { operation: "supersede"; predecessorExceptionId: string; expectedExceptionDecisionRevision: number; decisionEvidenceRefs: string[]; exception: PassiveComponentException }
export type PassivePolicyExceptionMutationRequest = PassivePolicyExceptionApproveMutationRequest | PassivePolicyExceptionRevokeMutationRequest | PassivePolicyExceptionSupersedeMutationRequest;

export interface PassivePolicyRepositoryScope { tenantId: string; projectId: string; branchId: string; policyId: string }
export interface PassivePolicyRepository { getHead(scope: PassivePolicyRepositoryScope): Promise<PassivePolicyRecord | null>; getRecord(scope: PassivePolicyRepositoryScope, recordId: string): Promise<PassivePolicyRecord | null>; history(scope: PassivePolicyRepositoryScope): Promise<PassivePolicyRecord[]>; audits(scope: PassivePolicyRepositoryScope): Promise<PassivePolicyAuditEvent[]>; getPublished(input: { tenantId: string; projectId: string; branchId: string; assemblyVariantId: string }): Promise<PassivePolicyRecord[]>; convergence?(scope: PassivePolicyRepositoryScope, recordId: string): Promise<PassivePolicyConvergence>; getIdempotent(scope: PassivePolicyRepositoryScope, key: string): Promise<PassivePolicyCommitResult | null>; withLock<T>(scope: PassivePolicyRepositoryScope, timeoutMs: number, operation: () => Promise<T>): Promise<T>; commit(input: { scope: PassivePolicyRepositoryScope; expectedRevision: number; record: PassivePolicyRecord; action: PassivePolicyAuditEvent["action"]; actor: EngineeringActor; reason: string; idempotencyKey: string; invalidation: Omit<PassivePolicyInvalidationEvent, "eventId" | "eventDigest"> }): Promise<PassivePolicyCommitResult> }
export interface PassivePolicyContextProvider { getContext(request: PassivePolicyEvaluationRequest, signal?: AbortSignal): Promise<PassivePolicyContext>; listProjectContexts(input: { tenantId: string; projectId: string; branchId: string; assemblyVariantId: string; policyRevisionId: string }, signal?: AbortSignal): Promise<PassivePolicyContext[]> }
export interface PassivePolicyInvalidationTarget { invalidate(input: { tenantId: string; projectId: string; branchId: string; assemblyVariantIds: string[]; affectedComponentIds: string[]; fromPolicyRevisionId: string | null; toPolicyRevisionId: string; reason: string; occurredAt: string }): Promise<{ stage2DependencyKeys: string[]; stage3PlansStaled: number }> }
