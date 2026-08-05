import type { EngineeringActor } from "../engineering/types";
import type {
  ComponentPhysicalBinding,
  ComponentPhysicalBindingSet,
  PhysicalReadinessAssessment,
  PhysicalReadinessPolicy,
  StableComponentIdentity,
} from "../physical-binding/types";

export const FOOTPRINT_RESOLUTION_REQUEST_VERSION = "sirkit.footprint-resolution-request.v1" as const;
export const FOOTPRINT_RESOLUTION_CONTEXT_VERSION = "sirkit.footprint-resolution-context.v1" as const;
export const FOOTPRINT_RESOLUTION_POLICY_VERSION = "sirkit.footprint-resolution-policy/1.0.0" as const;
export const FOOTPRINT_RESOLUTION_RESULT_VERSION = "sirkit.footprint-resolution-result.v1" as const;
export const FOOTPRINT_RESOLVER_VERSION = "sirkit.footprint-resolver/2.0.0" as const;
export const FOOTPRINT_RESOLVER_NORMALIZATION_VERSION = "sirkit.footprint-resolution-normalization/1" as const;
export const FOOTPRINT_COMPATIBILITY_VALIDATOR_VERSION = "sirkit.footprint-compatibility/1" as const;
export const FOOTPRINT_RESOLUTION_TRACE_VERSION = "sirkit.footprint-resolution-trace.v1" as const;

export type FootprintResolutionPurpose = "preview" | "layout_transfer" | "manufacturing_assessment" | "migration_analysis" | "shadow_comparison";
export type FootprintResolutionStatus = "resolved" | "not_applicable" | "unresolved_missing_data" | "unresolved_ambiguous" | "blocked_conflict" | "blocked_invalid" | "blocked_unapproved" | "blocked_stale" | "blocked_unavailable" | "blocked_unsupported" | "deferred_to_user_decision" | "error";
export type CandidateSourceKind = "selected_stage1_binding" | "approved_exact_part_binding" | "explicit_component_assignment" | "symbol_attached_fact" | "normalized_package_mapping" | "legacy_assignment" | "passive_policy" | "human_suggestion" | "ai_catalog_suggestion" | "generated_overlay";
export type CandidateSourceStatus = "success" | "empty" | "unavailable" | "failed" | "unsupported" | "timeout" | "cancelled";
export type SourceAuthorityClass = "selected_stage1" | "approved_exact_part" | "approved_component_assignment" | "approved_symbol_fact" | "approved_package_mapping" | "approved_passive_policy" | "suggestion_only";
export type CandidateDispositionKind = "selected_authoritative" | "eligible_lower_precedence" | "equivalent_merged" | "suggestion_only" | "inapplicable_variant" | "unapproved" | "technically_unverified" | "technically_invalid" | "stale" | "superseded" | "revoked" | "rejected" | "asset_unavailable" | "package_ambiguous" | "package_incompatible" | "mapping_missing" | "mapping_unverified" | "mapping_stale" | "conflicting" | "unsupported" | "malformed";
export type ResolutionRemediationCategory = "request" | "authorization" | "identity" | "variant" | "source" | "part" | "package" | "asset" | "mapping" | "approval" | "validation" | "freshness" | "lifecycle" | "conflict" | "readiness" | "user_decision" | "developer";

export interface FootprintResolutionRequest {
  schemaVersion: typeof FOOTPRINT_RESOLUTION_REQUEST_VERSION;
  requestId: string;
  tenantId: string;
  projectId: string;
  branchId: string;
  boardInstanceId: string;
  componentId: string;
  hierarchyPath: string[];
  assemblyVariantId: string;
  purpose: FootprintResolutionPurpose;
  expectedComponentRevision?: string;
  expectedBindingSetDigest?: string;
  policyId: string;
  policyVersion: string;
  requestedAt: string;
  actorContext: EngineeringActor;
  traceLevel?: "normal" | "diagnostic";
}

export interface ResolutionPurposeRequirements {
  requireEffectiveSelection: boolean;
  requireApproval: boolean;
  requireTechnicalValidation: boolean;
  requireCurrentFreshness: boolean;
  requireVerifiedMapping: boolean;
  requireAvailableAsset: boolean;
  requirePackageCompatibility: boolean;
  requireLayoutReadiness: boolean;
  requireManufacturingReadiness: boolean;
}

export interface FootprintResolutionPolicy {
  schemaVersion: typeof FOOTPRINT_RESOLUTION_POLICY_VERSION;
  policyId: "sirkit.default-footprint-resolution";
  version: "1.0.0" | "1.1.0-stage5-passive-policy";
  supportedPurposes: FootprintResolutionPurpose[];
  sourcePrecedence: Array<{ authorityClass: SourceAuthorityClass; rank: number }>;
  sourceAuthority: Record<CandidateSourceKind, SourceAuthorityClass>;
  purposeRequirements: Record<FootprintResolutionPurpose, ResolutionPurposeRequirements>;
  enabledSources: CandidateSourceKind[];
  maxCandidates: number;
  maxTraceSteps: number;
  maxBatchSize: number;
  adapterTimeoutMs: number;
  includeSuggestions: boolean;
  failOnUnavailableAuthoritativeSource: boolean;
  cacheMode: "disabled";
  cacheBehaviorVersion: "no-cache/1";
  acceptedMappingVerifierVersions: string[];
  acceptedLayoutMappingTiers: Array<"exact_part" | "package_family" | "curated_pair">;
  stage1ReadinessPolicy: PhysicalReadinessPolicy;
}

export interface CandidateOriginRecord {
  sourceKind: CandidateSourceKind;
  sourceVersion: string;
  sourceAuthorityClass: SourceAuthorityClass;
  bindingRevisionId: string;
  originKind: ComponentPhysicalBinding["origin"]["kind"];
  sourceRef: string;
  evidenceRefs: string[];
  confidence?: number;
}

export interface RawFootprintCandidate {
  schemaVersion: "sirkit.raw-footprint-candidate.v1";
  rawCandidateId: string;
  sourceKind: CandidateSourceKind;
  sourceVersion: string;
  binding: ComponentPhysicalBinding;
}

export interface CandidateSourceDiagnostic {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
}

export interface CandidateSourceResult {
  sourceKind: CandidateSourceKind;
  sourceVersion: string;
  status: CandidateSourceStatus;
  candidates: RawFootprintCandidate[];
  diagnostics: CandidateSourceDiagnostic[];
  dependencyDigests: string[];
  durationMs: number;
}

export interface CandidateCollectionContext {
  request: FootprintResolutionRequest;
  componentIdentity: StableComponentIdentity;
  bindingSets: ComponentPhysicalBindingSet[];
  bindings: ComponentPhysicalBinding[];
  policy: FootprintResolutionPolicy;
  dependencyDigests: string[];
}

export interface FootprintCandidateSource {
  readonly sourceKind: CandidateSourceKind;
  readonly sourceVersion: string;
  collect(context: CandidateCollectionContext, signal: AbortSignal): Promise<CandidateSourceResult>;
}

export interface NormalizedFootprintCandidate {
  schemaVersion: "sirkit.normalized-footprint-candidate.v1";
  candidateId: string;
  technicalIdentityDigest: string;
  componentId: string;
  assemblyVariantScope: string[];
  exactPartIdentity?: ComponentPhysicalBinding["exactPart"];
  packageIdentity?: ComponentPhysicalBinding["package"];
  footprintAssetIdentity?: ComponentPhysicalBinding["footprint"];
  pinPadMappingRef: ComponentPhysicalBinding["pinPadMapping"];
  originRecords: CandidateOriginRecord[];
  evidenceRefs: string[];
  contributingBindings: ComponentPhysicalBinding[];
  dependencyDigests: string[];
}

export interface ResolutionIssue {
  code: string;
  severity: "info" | "warning" | "error" | "blocking";
  blocking: boolean;
  message: string;
  componentId: string;
  candidateId?: string;
  fieldRefs: string[];
  dependencyRefs: string[];
  remediationCategory: ResolutionRemediationCategory;
  helpId: string;
  safeDetails: Record<string, string | number | boolean>;
  causedBy: string[];
}

export type ResolutionConflictClass = "multiple_active_selections" | "overlapping_variant_scope" | "exact_part_package_mismatch" | "package_footprint_mismatch" | "asset_name_digest_collision" | "pin_pad_mapping_disagreement" | "incompatible_approved_assets" | "library_shadowing" | "provenance_disagreement" | "alias_conflict" | "inconsistent_duplicate_state";

export interface ResolutionConflict {
  conflictId: string;
  conflictClass: ResolutionConflictClass;
  candidateIds: string[];
  blocking: boolean;
  message: string;
  evidenceRefs: string[];
}

export interface CandidateDisposition {
  candidateId: string;
  primary: CandidateDispositionKind;
  authorityClass: SourceAuthorityClass;
  authorityRank: number;
  eligible: boolean;
  blocking: boolean;
  reasonCodes: string[];
  issues: ResolutionIssue[];
  evidenceRefs: string[];
  implicatedFields: string[];
  readinessAssessment: PhysicalReadinessAssessment;
}

export interface ResolutionTraceStep {
  ordinal: number;
  phase: "request" | "snapshot" | "collection" | "normalization" | "eligibility" | "conflict" | "precedence" | "decision" | "shadow";
  code: string;
  message: string;
  candidateIds: string[];
  sourceKind?: CandidateSourceKind;
  safeDetails: Record<string, string | number | boolean>;
}

export interface ResolutionTrace {
  schemaVersion: typeof FOOTPRINT_RESOLUTION_TRACE_VERSION;
  steps: ResolutionTraceStep[];
  truncated: boolean;
  technicalTraceDigest: string;
}

export interface ResolutionInputSnapshot {
  componentIdentityDigest: string;
  componentId: string;
  assemblyVariantId: string;
  bindingSetDigests: string[];
  effectiveSelectedRevisionIds: string[];
  sourceVersions: Array<{ sourceKind: CandidateSourceKind; sourceVersion: string; status: CandidateSourceStatus }>;
  dependencyDigest: string;
  stage1SchemaVersion: string;
  stage1ReadinessPolicyVersion: string;
}

export interface ImmutableResolutionContext {
  schemaVersion: typeof FOOTPRINT_RESOLUTION_CONTEXT_VERSION;
  request: FootprintResolutionRequest;
  componentIdentity: StableComponentIdentity;
  componentRevisionDigest: string;
  variantRevisionDigest: string;
  bindingSets: ComponentPhysicalBindingSet[];
  effectiveSelectedRevisionIds: string[];
  sourceResults: CandidateSourceResult[];
  policy: FootprintResolutionPolicy;
  libraryAvailability: "available" | "unavailable" | "unknown";
  dependencyDigests: string[];
  dependencyDigest: string;
  collectionDiagnostics: CandidateSourceDiagnostic[];
}

export interface ResolvedFootprintBinding {
  componentId: string;
  assemblyVariantId: string;
  bindingRevisionId: string;
  bindingTechnicalDigest: string;
  footprintAsset: NonNullable<ComponentPhysicalBinding["footprint"]>;
  packageIdentity: NonNullable<ComponentPhysicalBinding["package"]>;
  exactPartIdentity?: ComponentPhysicalBinding["exactPart"];
  pinPadMapping: ComponentPhysicalBinding["pinPadMapping"];
  approvalEvidenceRefs: string[];
  readiness: { layout: PhysicalReadinessAssessment["layout"]; manufacturing: PhysicalReadinessAssessment["manufacturing"] };
  purpose: FootprintResolutionPurpose;
  dependencyDigest: string;
  authorityClass: SourceAuthorityClass;
  authorityReasonCode: string;
}

export interface SuggestedCandidateView {
  candidateId: string;
  footprintAsset: ComponentPhysicalBinding["footprint"] | null;
  packageIdentity: ComponentPhysicalBinding["package"] | null;
  sourceKinds: CandidateSourceKind[];
  confidence?: number;
  reasonCodes: string[];
  requires: Array<"selection" | "approval" | "technical_validation" | "mapping_verification" | "package_clarification" | "asset_availability">;
}

export interface ResolutionCacheInfo {
  mode: "disabled";
  status: "not_applicable";
  behaviorVersion: "no-cache/1";
  dependencyDigest: string;
}

export interface FootprintResolutionResult {
  resultSchemaVersion: typeof FOOTPRINT_RESOLUTION_RESULT_VERSION;
  requestId: string;
  status: FootprintResolutionStatus;
  resolvedBinding?: ResolvedFootprintBinding;
  suggestedCandidates: SuggestedCandidateView[];
  consideredCandidates: CandidateDisposition[];
  blockers: ResolutionIssue[];
  warnings: ResolutionIssue[];
  conflicts: ResolutionConflict[];
  trace: ResolutionTrace;
  readinessAssessment: PhysicalReadinessAssessment | null;
  readinessAssessments: Record<string, PhysicalReadinessAssessment>;
  inputSnapshot: ResolutionInputSnapshot;
  policyId: string;
  policyVersion: string;
  resolverVersion: typeof FOOTPRINT_RESOLVER_VERSION;
  normalizationVersion: typeof FOOTPRINT_RESOLVER_NORMALIZATION_VERSION;
  compatibilityValidatorVersion: typeof FOOTPRINT_COMPATIBILITY_VALIDATOR_VERSION;
  cache: ResolutionCacheInfo;
  evaluatedAt: string;
  decisionDigest: string;
}

export interface FootprintResolutionBatchRequest {
  schemaVersion: "sirkit.footprint-resolution-batch-request.v1";
  batchId: string;
  requests: FootprintResolutionRequest[];
}

export interface FootprintResolutionBatchResult {
  schemaVersion: "sirkit.footprint-resolution-batch-result.v1";
  batchId: string;
  policyId: string;
  policyVersion: string;
  results: FootprintResolutionResult[];
  summary: Record<FootprintResolutionStatus, number>;
  dependencyDigest: string;
  evaluatedAt: string;
}
