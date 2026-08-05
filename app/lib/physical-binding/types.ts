import type { EngineeringActor } from "../engineering/types";

export const PHYSICAL_BINDING_SCHEMA_VERSION = "sirkit.physical-binding.v1" as const;
export const PHYSICAL_BINDING_SET_SCHEMA_VERSION = "sirkit.physical-binding-set.v1" as const;
export const PHYSICAL_READINESS_SCHEMA_VERSION = "sirkit.physical-readiness.v1" as const;
export const PHYSICAL_BINDING_AUDIT_SCHEMA_VERSION = "sirkit.physical-binding-audit.v1" as const;
export const PHYSICAL_BINDING_MIGRATION_SCHEMA_VERSION = "sirkit.physical-binding-migration.v1" as const;
export const PHYSICAL_BINDING_POLICY_VERSION = "sirkit.physical-binding-policy/1.0.0" as const;
export const PHYSICAL_BINDING_CANONICAL_VERSION = "sirkit.physical-binding-canonical/1" as const;

export type PhysicalApplicabilityState = "applicable" | "not_applicable" | "unknown";
export type BindingLifecycleState = "draft" | "candidate" | "selected" | "superseded" | "withdrawn" | "orphaned" | "obsolete";
export type BindingApprovalState = "unreviewed" | "pending" | "approved" | "rejected" | "expired" | "revoked";
export type BindingTechnicalState = "pending" | "valid" | "invalid" | "unsupported";
export type BindingFreshnessState = "current" | "stale" | "unknown" | "missing_source";
export type BindingConflictState = "none" | "present";
export type PhysicalReadinessState = "ready" | "not_ready" | "not_applicable";
export type MappingVerificationState = "missing" | "pending" | "legacy_unverified" | "verified" | "failed" | "unsupported" | "stale";
export type FootprintAssetAvailability = "available" | "unresolved" | "missing" | "unsupported";
export type PackageCompatibilityState = "compatible" | "incompatible" | "pending" | "ambiguous" | "unknown";

export interface PhysicalBindingScope {
  tenantId: string;
  projectId: string;
  branchId: string;
  boardInstanceId: string;
  componentInstanceId: string;
  hierarchyPath: string[];
  assemblyVariantIds: string[];
}

/** Durable identity is scoped and instance based. refdes is deliberately absent. */
export interface StableComponentIdentity {
  identityKind: "schematic_component_instance";
  componentInstanceId: string;
  projectId: string;
  branchId: string;
  boardInstanceId: string;
  hierarchyPath: string[];
  origin:
    | { kind: "native"; sourceInstanceId: string }
    | { kind: "imported"; sourceFormat: string; sourceStableId: string }
    | { kind: "legacy_reconciled"; reconciliationKey: string; sourceLocator: string }
    | { kind: "copied"; sourceComponentInstanceId: string; copyOperationId: string };
}

export interface ComponentPhysicalClassification {
  populationKind: "physical" | "schematic_only" | "dnp" | "unknown";
  deviceClass: string;
  mountingTechnology: "smd" | "through_hole" | "mixed" | "unknown";
  polarity: "polarized" | "nonpolar" | "unknown";
  classificationEvidenceRefs: string[];
}

export interface ExactPartBinding {
  atomicPartRevisionId?: string;
  exactPartId: string;
  manufacturerId: string;
  exactPublishedMpn: string;
  supplierParts: Array<{ supplierId: string; supplierSku: string; supplierPartId?: string }>;
  evidenceRefs: string[];
}

export interface PackageBinding {
  packageIdentityId: string;
  packageRevisionId: string;
  identitySystem: "jedec" | "manufacturer" | "ipc" | "metric_imperial_explicit" | "project_defined";
  canonicalName: string;
  sourceToken: string;
  mountingTechnology: "smd" | "through_hole" | "mixed" | "unknown";
  pinCount?: number;
  pitchNm?: number;
  bodyWidthNm?: number;
  bodyLengthNm?: number;
  exposedPad: "present" | "absent" | "unknown";
  exactPartId?: string;
  evidenceRefs: string[];
}

export interface FootprintAssetBinding {
  logicalAssetId: string;
  assetVersionId: string;
  contentDigest?: string;
  semanticDigest?: string;
  sourceNamespace: "atomic_catalog" | "project_library" | "kicad_library" | "generated_overlay" | "legacy_locator";
  sourceRevision: string;
  libraryNickname: string;
  footprintName: string;
  availability: FootprintAssetAvailability;
  validationState: "valid" | "valid_with_limitations" | "pending" | "invalid" | "unsupported";
  packageCompatibility: PackageCompatibilityState;
  padIdentifiers: string[];
  duplicatePadIdentifiers: string[];
  electricalPadCount?: number;
  mechanicalPadCount?: number;
  geometry: {
    hasCourtyard: boolean;
    hasFabrication: boolean;
    hasSolderMaskDefinition: boolean;
    hasPasteDefinition: boolean;
    hasDrillDefinition: boolean;
    manufacturingValidated: boolean;
  };
  evidenceRefs: string[];
}

/** Stage 4 owns verification. Stage 1 stores and checks only its versioned result contract. */
export interface PinPadMappingReference {
  state: MappingVerificationState;
  mappingCertificateId?: string;
  symbolAssetVersionId?: string;
  footprintAssetVersionId?: string;
  footprintContentDigest?: string;
  verifierVersion?: string;
  verificationTier?: "exact_part" | "package_family" | "curated_pair" | "limited_direct_pair";
  mappingRevisionId?: string;
  mappingContentDigest?: string;
  mappingDependencyDigest?: string;
  verificationResultDigest?: string;
  mappingApprovalState?: "unreviewed" | "pending" | "approved" | "rejected" | "revoked";
  mappingFreshnessState?: "current" | "stale" | "unknown" | "missing_source";
  mappingConflictState?: "none" | "present";
  mappingLifecycleState?: "candidate" | "active" | "rejected" | "revoked" | "superseded" | "retired";
  approvalDecisionId?: string;
  verifiedAt?: string;
  evidenceRefs: string[];
  reasonCodes: string[];
}

export type BindingOriginKind =
  | "exact_catalog_binding"
  | "symbol_property_import"
  | "legacy_migration"
  | "project_passive_policy"
  | "human_selection"
  | "ai_suggestion"
  | "package_derived"
  | "generated_overlay"
  | "upstream_library_import"
  | "api_enrichment";

export interface BindingOrigin {
  kind: BindingOriginKind;
  actor: EngineeringActor;
  sourceRef: string;
  createdAt: string;
  evidenceRefs: string[];
  ruleVersion?: string;
  confidence?: number;
}

export interface BindingApproval {
  state: BindingApprovalState;
  contentDigest?: string;
  approvalScope?: "layout" | "manufacturing";
  decisionId?: string;
  decidedBy?: EngineeringActor;
  decidedAt?: string;
  expiresAt?: string;
  reason?: string;
  policyVersion?: string;
  /** Evidence explicitly relied on by the human approval decision. */
  decisionEvidenceRefs?: string[];
}

export interface BindingTechnicalValidation {
  state: BindingTechnicalState;
  validatorVersion?: string;
  validatedDigest?: string;
  validatedAt?: string;
  evidenceRefs: string[];
  reasonCodes: string[];
}

export interface BindingFreshness {
  state: BindingFreshnessState;
  evaluatedAt?: string;
  reasonCodes: string[];
  staleDependencyIds: string[];
}

export interface BindingConflict {
  state: BindingConflictState;
  conflictIds: string[];
  reasonCodes: string[];
}

export interface PhysicalDependencySnapshot {
  symbolAssetVersionId?: string;
  packageRevisionId?: string;
  footprintAssetVersionId?: string;
  footprintContentDigest?: string;
  mappingCertificateId?: string;
  mappingVerifierVersion?: string;
  exactPartEvidenceDigest?: string;
  approvalPolicyVersion: string;
  variantDefinitionDigest: string;
  packagePolicyRevision?: string;
  electricalConstraintValidationRef?: string;
  assemblyDataRef?: string;
  exactPartFootprintCompatibility: "compatible" | "incompatible" | "pending" | "unknown";
  manufacturingEvidenceRefs: string[];
  supplyEvidenceRefs: string[];
  externalValidationRefs: string[];
}

export interface LegacySourceCapture {
  migrationKey: string;
  sourceSchemaVersion: string;
  rawFields: Record<string, unknown>;
  recognizedFields: string[];
  unrecognizedFields: string[];
  diagnostics: string[];
}

/** Immutable candidate revision. Technical changes create a successor revision. */
export interface ComponentPhysicalBinding {
  schemaVersion: typeof PHYSICAL_BINDING_SCHEMA_VERSION;
  bindingId: string;
  revisionId: string;
  lineageId: string;
  revision: number;
  predecessorRevisionId?: string;
  supersedesRevisionId?: string;
  scope: PhysicalBindingScope;
  componentIdentity: StableComponentIdentity;
  classification: ComponentPhysicalClassification;
  exactPart?: ExactPartBinding;
  package?: PackageBinding;
  footprint?: FootprintAssetBinding;
  pinPadMapping: PinPadMappingReference;
  origin: BindingOrigin;
  evidenceRefs: string[];
  lifecycleState: BindingLifecycleState;
  applicabilityState: PhysicalApplicabilityState;
  approval: BindingApproval;
  technicalValidation: BindingTechnicalValidation;
  freshness: BindingFreshness;
  conflict: BindingConflict;
  dependencies: PhysicalDependencySnapshot;
  legacySource?: LegacySourceCapture;
  technicalDigest: string;
  recordDigest: string;
  createdAt: string;
  createdBy: EngineeringActor;
}

export interface ComponentPhysicalBindingSet {
  schemaVersion: typeof PHYSICAL_BINDING_SET_SCHEMA_VERSION;
  setId: string;
  scope: PhysicalBindingScope;
  revision: number;
  candidateRevisionIds: string[];
  effectiveSelectedRevisionId?: string;
  recordDigest: string;
  updatedAt: string;
}

export type ReadinessGateStatus = "pass" | "fail" | "pending" | "unknown" | "not_applicable";
export type ReadinessRemediationCategory = "identity" | "classification" | "part" | "package" | "asset" | "mapping" | "approval" | "validation" | "freshness" | "conflict" | "variant" | "evidence" | "manufacturing" | "lifecycle";

export interface PhysicalReadinessGateResult {
  code: string;
  status: ReadinessGateStatus;
  message: string;
  recordPath: string;
  remediationCategory: ReadinessRemediationCategory;
  severity: "info" | "warning" | "error" | "blocking";
  blocking: boolean;
  evidenceRefs: string[];
}

export interface PhysicalReadinessPolicy {
  policyVersion: typeof PHYSICAL_BINDING_POLICY_VERSION;
  requireExactPartForLayout: boolean;
  requireSupplyEvidenceForManufacturing: boolean;
  requireExternalStageRefsForManufacturing: boolean;
}

export interface PhysicalReadinessAssessment {
  schemaVersion: typeof PHYSICAL_READINESS_SCHEMA_VERSION;
  assessmentId: string;
  bindingRevisionId: string;
  bindingRecordDigest: string;
  policyVersion: string;
  layout: PhysicalReadinessState;
  manufacturing: PhysicalReadinessState;
  gates: PhysicalReadinessGateResult[];
  assessedAt: string;
  assessmentDigest: string;
  claims: {
    certifiesManufacturability: false;
    certifiesAvailability: false;
    authorizesProductionRelease: false;
    predictsFirstPassHardware: false;
  };
}

export interface LegacyFootprintAssignmentView {
  schemaVersion: "sirkit.legacy-footprint-assignment-view.v1";
  authoritative: false;
  sourceBindingRevisionId: string;
  componentInstanceId: string;
  footprint: string | null;
  package: string | null;
  manufacturerPartNumber: string | null;
  proofState: "approved" | "candidate" | "unresolved";
  warnings: string[];
}

export type PhysicalBindingAction =
  | "submit_candidate"
  | "select"
  | "request_approval"
  | "approve"
  | "reject"
  | "revoke"
  | "mark_stale"
  | "revalidate"
  | "supersede"
  | "orphan"
  | "withdraw";

export interface PhysicalBindingTransitionRequest {
  schemaVersion: "sirkit.physical-binding-transition.v1";
  action: PhysicalBindingAction;
  bindingRevisionId: string;
  expectedSetRevision: number;
  idempotencyKey: string;
  reason: string;
  actor: EngineeringActor;
  at: string;
  approvalScope?: "layout" | "manufacturing";
  expiresAt?: string;
  validation?: BindingTechnicalValidation;
  staleDependencyIds?: string[];
  /** Required at runtime for select and approve; optional here for legacy callers. */
  decisionEvidenceRefs?: string[];
}

export interface PhysicalBindingAuditEvent {
  schemaVersion: typeof PHYSICAL_BINDING_AUDIT_SCHEMA_VERSION;
  eventId: string;
  tenantId: string;
  projectId: string;
  branchId: string;
  componentInstanceId: string;
  bindingId: string;
  fromRevisionId: string;
  toRevisionId: string;
  action: PhysicalBindingAction | "create_candidate" | "legacy_migrate" | "mapping_update";
  actor: EngineeringActor;
  reason: string;
  idempotencyKey: string;
  occurredAt: string;
  /** Aggregate owner and canonical logical request identity for safe replay. */
  aggregateSetId?: string;
  requestDigest?: string;
  /** Exact normalized evidence used by select/approve decisions. */
  decisionEvidenceRefs?: string[];
  eventDigest: string;
}

export interface PhysicalBindingMigrationRecord {
  schemaVersion: typeof PHYSICAL_BINDING_MIGRATION_SCHEMA_VERSION;
  migrationKey: string;
  tenantId: string;
  projectId: string;
  branchId: string;
  componentInstanceId: string;
  sourceSchemaVersion: string;
  candidateRevisionId: string;
  status: "migrated" | "skipped" | "ambiguous" | "failed";
  dryRun: boolean;
  diagnosticCodes: string[];
  createdAt: string;
  recordDigest: string;
}

export interface ShadowBindingComparison {
  schemaVersion: "sirkit.physical-binding-shadow.v1";
  productionBehaviorChanged: false;
  componentInstanceId: string;
  legacyFootprint: string | null;
  shadowFootprint: string | null;
  agreement: "same" | "different" | "both_unresolved";
  assessment: PhysicalReadinessAssessment;
  diagnostics: string[];
}
