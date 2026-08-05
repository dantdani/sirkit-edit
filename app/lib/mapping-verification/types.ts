import type { EngineeringActor } from "../engineering/types";
import type { PinPadMappingReference, PhysicalBindingScope } from "../physical-binding/types";

export const MAPPING_CONTEXT_VERSION = "sirkit.mapping-context.v1" as const;
export const MAPPING_CANDIDATE_VERSION = "sirkit.physical-terminal-mapping.v1" as const;
export const MAPPING_REQUEST_VERSION = "sirkit.mapping-verification-request.v1" as const;
export const MAPPING_RESULT_VERSION = "sirkit.mapping-verification-result.v1" as const;
export const MAPPING_POLICY_VERSION = "sirkit.mapping-verification-policy/1.0.0" as const;
export const MAPPING_RECORD_VERSION = "sirkit.mapping-record.v1" as const;
export const MAPPING_AUDIT_VERSION = "sirkit.mapping-audit.v1" as const;
export const MAPPING_INVALIDATION_VERSION = "sirkit.mapping-invalidation.v1" as const;
export const MAPPING_VERIFIER_ID = "sirkit.mapping-verifier" as const;
export const MAPPING_VERIFIER_VERSION = "sirkit.mapping-verifier/4.0.0" as const;
export const MAPPING_CANONICAL_VERSION = "sirkit.mapping-canonical/1" as const;

export type MappingRiskClass =
  | "symmetric_two_terminal_nonpolar"
  | "polarized_two_terminal"
  | "diode_led_rectifier"
  | "transistor_fet"
  | "simple_connector"
  | "keyed_or_power_connector"
  | "crystal_oscillator"
  | "multi_unit_logic_amplifier"
  | "regulator_power_ic"
  | "complex_ic"
  | "thermal_exposed_pad"
  | "high_density_leadless"
  | "electromechanical"
  | "rf_high_speed_special"
  | "unsupported_unknown";

export type MappingVerificationTier = "exact_part" | "package_family" | "curated_pair" | "limited_direct_pair";
export type MappingVerificationStatus = "verified" | "verified_limited" | "incomplete" | "ambiguous" | "conflicting" | "structurally_invalid" | "electrically_inconsistent" | "evidence_insufficient" | "stale_dependency" | "unsupported_construct" | "unauthorized" | "error";
export type MappingVerificationState = "draft" | "candidate_unverified" | "structurally_valid" | "evidence_pending" | "verification_in_progress" | "verified_exact_part" | "verified_package_family" | "verified_curated_pair" | "verified_limited_direct_pair" | "ambiguous" | "conflicting" | "incomplete" | "invalid" | "unsupported" | "stale" | "revoked" | "superseded";
export type MappingApprovalState = "unreviewed" | "pending" | "approved" | "rejected" | "revoked";
export type MappingFreshnessState = "current" | "stale" | "unknown" | "missing_source";
export type MappingConflictState = "none" | "present";
export type MappingLifecycleState = "candidate" | "active" | "rejected" | "revoked" | "superseded" | "retired";
export type MappingLayer = "symbol" | "package_terminal" | "footprint_pad" | "symbol_to_terminal" | "terminal_to_pad" | "direct_pair" | "equivalence" | "evidence" | "scope" | "lifecycle";
export type MappingFunctionClass = "passive" | "positive" | "negative" | "anode" | "cathode" | "gate" | "source" | "drain" | "base" | "collector" | "emitter" | "power" | "ground" | "input" | "output" | "bidirectional" | "clock" | "enable" | "reset" | "differential_positive" | "differential_negative" | "open_drain" | "open_collector" | "shield" | "thermal" | "no_connect" | "do_not_connect" | "reserved" | "test" | "unknown";
export type MappingItemClassification = "electrical" | "no_connect" | "do_not_connect" | "reserved" | "test" | "mechanical" | "mounting" | "shield" | "thermal_exposed" | "unpopulated" | "nonphysical" | "unknown";
export type MappingRelationshipType = "exact_one_to_one" | "one_pin_to_commoned_terminals" | "multiple_representations_to_terminal" | "terminal_to_commoned_pads" | "terminals_to_common_exposed_pad" | "equivalent_permutation" | "no_connect" | "shield_chassis" | "thermal_exposed";
export type MappingOrigin = "manufacturer_datasheet" | "manufacturer_package_table" | "sirkit_exact_part" | "sirkit_package_family" | "sirkit_curated_pair" | "official_kicad_pair" | "vendor_library" | "legacy_direct" | "number_equality_candidate" | "human_authored" | "api_extraction" | "ai_extracted" | "generated_relationship";

export interface MappingScope {
  tenantId: string;
  projectId: string;
  branchId: string;
  boardInstanceId: string;
  componentInstanceId: string;
  bindingSetId: string;
  bindingRevisionId: string;
  hierarchyPath: string[];
  assemblyVariantId: string;
}

export interface SymbolAssetIdentity { logicalAssetId: string; versionId: string; contentDigest: string; semanticDigest: string; formatVersion: string; parserVersion: string }
export interface ExactPartIdentity { atomicPartRevisionId: string; exactPartId: string; manufacturerId: string; exactMpnDigest: string }
export interface PackageIdentity { packageIdentityId: string; packageRevisionId: string; identitySystem: string; exactPartId?: string; evidenceRefs: string[] }
export interface FootprintAssetIdentity { logicalAssetId: string; versionId: string; contentDigest: string; semanticDigest: string; formatVersion: string; parserVersion: string }

export interface LogicalSymbolPin {
  stablePinId: string;
  symbolVersionId: string;
  rawNumber: string;
  normalizedNumber: string;
  rawName: string;
  normalizedName: string;
  electricalType: string;
  functionClass: MappingFunctionClass;
  polarityRole: "positive" | "negative" | "orientation_key" | "none" | "unknown";
  hidden: boolean;
  representations: Array<{ sourcePinId: string; unit: number; bodyStyle: number; alternate: string; hidden: boolean }>;
  stackedGroup?: string;
  alternateFunctions: string[];
  mappingRequirement: "required" | "optional" | "not_applicable";
  evidenceRefs: string[];
}

export interface PackageTerminal {
  stableTerminalId: string;
  packageRevisionId: string;
  exactPartId?: string;
  rawDesignator: string;
  normalizedDesignator: string;
  rawFunction: string;
  normalizedFunction: string;
  functionClass: MappingFunctionClass;
  classification: MappingItemClassification;
  connectionRequirement: "required" | "optional" | "must_not_connect" | "not_applicable";
  alternateFunctions: string[];
  commonGroup?: string;
  polarityRole: "positive" | "negative" | "orientation_key" | "none" | "unknown";
  evidenceRefs: string[];
  sourceRevision: string;
  freshness: MappingFreshnessState;
}

export interface FootprintPad {
  stablePadId: string;
  footprintVersionId: string;
  rawNumber: string;
  normalizedNumber: string;
  padType: string;
  layers: string[];
  classification: MappingItemClassification;
  repeatedPadGroup?: string;
  drillNm?: number;
  plated?: boolean;
  propertyRefs: string[];
}

export interface MappingEvidence {
  evidenceId: string;
  sourceRecordId: string;
  sourceClass: "manufacturer_datasheet" | "manufacturer_cad" | "manufacturer_application_note" | "official_kicad_library" | "organization_authored" | "human_reviewed" | "vendor_library" | "ocr_extraction" | "llm_suggestion" | "other";
  contentDigest: string;
  revision: string;
  locator: string;
  assertionKind: "symbol_pin" | "package_terminal" | "terminal_function" | "package_identity" | "footprint_pad" | "mapping_edge" | "equivalence" | "orientation";
  exactPartId?: string;
  packageRevisionId?: string;
  symbolVersionId?: string;
  footprintVersionId?: string;
  extractionMethod: string;
  extractorVersion: string;
  reviewed: boolean;
  reviewerId?: string;
  freshness: "current" | "stale" | "unavailable" | "conflicting";
  confidential: boolean;
}

export interface MappingDependencySnapshot {
  scopeDigest: string;
  symbolVersionId: string;
  symbolContentDigest: string;
  symbolSemanticDigest: string;
  exactPartRevisionId?: string;
  packageRevisionId: string;
  footprintVersionId: string;
  footprintContentDigest: string;
  footprintSemanticDigest: string;
  evidenceDigests: string[];
  parserVersions: { symbol: string; footprint: string; packageTerminal: string };
  policyId: string;
  policyVersion: string;
  verifierVersion: string;
  dependencyDigest: string;
}

interface MappingEdgeBase {
  edgeId: string;
  relationship: MappingRelationshipType;
  assertedFunction: MappingFunctionClass;
  orientationSignificant: boolean;
  evidenceRefs: string[];
  origin: MappingOrigin;
  ruleVersion: string;
  confidence?: number;
  conditions: string[];
  assemblyVariantIds: string[];
  lifecycle: "candidate" | "current" | "stale" | "revoked";
}
export interface SymbolToTerminalEdge extends MappingEdgeBase { symbolPinId: string; packageTerminalId: string }
export interface TerminalToPadEdge extends MappingEdgeBase { packageTerminalId: string; footprintPadId: string }
export interface DirectSymbolToPadEdge extends MappingEdgeBase { symbolPinId: string; footprintPadId: string }

export interface MappingEquivalenceClass {
  equivalenceClassId: string;
  layer: "symbol_to_terminal" | "terminal_to_pad" | "both";
  memberIds: string[];
  allowedPermutations: Array<string[]>;
  canonicalOrder: string[];
  conditions: string[];
  evidenceRefs: string[];
  electricalEquivalent: boolean;
  assemblyEquivalent: boolean;
  layoutRestricted: boolean;
}

export interface ExplicitUnmappedItem { itemId: string; layer: "symbol" | "package_terminal" | "footprint_pad"; disposition: "nonphysical" | "mechanical" | "mounting" | "no_connect" | "do_not_connect" | "reserved" | "test" | "unpopulated" | "optional_omitted"; evidenceRefs: string[]; reason: string }

export interface PhysicalTerminalMappingCandidate {
  mappingSchemaVersion: typeof MAPPING_CANDIDATE_VERSION;
  mappingCandidateId: string;
  scope: MappingScope;
  symbolIdentity: SymbolAssetIdentity;
  exactPartIdentity?: ExactPartIdentity;
  packageIdentity: PackageIdentity;
  footprintIdentity: FootprintAssetIdentity;
  compatibilityMode: "three_layer_exact" | "three_layer_package_family" | "curated_pair" | "limited_direct_pair";
  symbolToTerminalEdges: SymbolToTerminalEdge[];
  terminalToPadEdges: TerminalToPadEdge[];
  directSymbolToPadEdges: DirectSymbolToPadEdge[];
  equivalenceClasses: MappingEquivalenceClass[];
  explicitUnmappedItems: ExplicitUnmappedItem[];
  evidenceRefs: string[];
  origin: MappingOrigin;
  dependencyDigest: string;
  candidateDigest: string;
}

export interface MappingContext {
  contextSchemaVersion: typeof MAPPING_CONTEXT_VERSION;
  contextId: string;
  scope: MappingScope;
  riskClass: MappingRiskClass;
  symbolIdentity: SymbolAssetIdentity;
  exactPartIdentity?: ExactPartIdentity;
  packageIdentity: PackageIdentity;
  footprintIdentity: FootprintAssetIdentity;
  symbolPins: LogicalSymbolPin[];
  packageTerminals: PackageTerminal[];
  footprintPads: FootprintPad[];
  evidence: MappingEvidence[];
  dependencySnapshot: MappingDependencySnapshot;
  diagnostics: Array<{ code: string; blocking: boolean; message: string; identityRefs: string[] }>;
}

export interface MappingVerificationRequest {
  requestSchemaVersion: typeof MAPPING_REQUEST_VERSION;
  requestId: string;
  contextId: string;
  mappingCandidateId: string;
  tenantId: string;
  projectId: string;
  branchId: string;
  assemblyVariantId: string;
  policyId: string;
  policyVersion: string;
  actorContext: EngineeringActor;
  requestedAt: string;
  traceLevel?: "normal" | "diagnostic";
}

export interface MappingFinding {
  findingId: string;
  code: string;
  severity: "info" | "warning" | "error" | "blocking";
  blocking: boolean;
  layer: MappingLayer;
  symbolPinIds: string[];
  packageTerminalIds: string[];
  footprintPadIds: string[];
  edgeIds: string[];
  evidenceRefs: string[];
  fieldRefs: string[];
  message: string;
  expected: string;
  observed: string;
  remediationCategory: "identity" | "coverage" | "cardinality" | "function" | "polarity" | "no_connect" | "thermal" | "mechanical" | "equivalence" | "evidence" | "freshness" | "conflict" | "approval" | "parser" | "authorization";
  causedBy: string[];
  verifierVersion: string;
  ruleVersion: string;
  helpKey: string;
}

export interface MappingConflict { conflictId: string; code: string; identityRefs: string[]; evidenceRefs: string[]; message: string }
export interface MappingAmbiguity { ambiguityId: string; code: string; alternatives: string[]; evidenceRefs: string[]; message: string }
export interface CoverageSummary { total: number; required: number; accounted: number; explicitlyUnmapped: number; missing: number; coveragePercent: number; missingIds: string[] }
export interface EvidenceAssessment { total: number; current: number; stale: number; unavailable: number; conflicting: number; reviewed: number; authoritative: number; sufficient: boolean; reasonCodes: string[] }

export interface MappingVerificationResult {
  resultSchemaVersion: typeof MAPPING_RESULT_VERSION;
  verificationId: string;
  resultDigest: string;
  requestId: string;
  status: MappingVerificationStatus;
  tier?: MappingVerificationTier;
  mappingCandidateId: string;
  candidateDigest: string;
  dependencySnapshot: MappingDependencySnapshot;
  symbolCoverage: CoverageSummary;
  packageTerminalCoverage: CoverageSummary;
  footprintPadCoverage: CoverageSummary;
  findings: MappingFinding[];
  conflicts: MappingConflict[];
  ambiguities: MappingAmbiguity[];
  normalizedMapping?: PhysicalTerminalMappingCandidate;
  evidenceAssessment: EvidenceAssessment;
  policyId: string;
  policyVersion: string;
  verifierId: typeof MAPPING_VERIFIER_ID;
  verifierVersion: typeof MAPPING_VERIFIER_VERSION;
  parserVersions: MappingDependencySnapshot["parserVersions"];
  evaluatedAt: string;
  claims: { selectsFootprint: false; approvesMapping: false; mutatesSchematic: false; mutatesPcb: false; certifiesLandPatternGeometry: false };
}

export interface MappingVerificationPolicy {
  schemaVersion: typeof MAPPING_POLICY_VERSION;
  policyId: "sirkit.mapping-verification";
  version: "1.0.0";
  acceptedParserVersions: { symbol: string[]; footprint: string[]; packageTerminal: string[] };
  acceptedVerifierVersions: string[];
  acceptedEvidenceClasses: MappingEvidence["sourceClass"][];
  acceptedLayoutTiers: MappingVerificationTier[];
  minimumTierByRisk: Record<MappingRiskClass, MappingVerificationTier | "unsupported">;
  allowedLimitedDirectRisks: MappingRiskClass[];
  requireReviewedEvidence: true;
  requireCurrentEvidence: true;
  requireCompleteCoverage: true;
  requireExplicitMechanicalDisposition: true;
  maxPins: number;
  maxTerminals: number;
  maxPads: number;
  maxEdges: number;
  maxEquivalenceClasses: number;
  maxEvidence: number;
  maxFindings: number;
  maxBatchSize: number;
  timeoutMs: number;
}

export interface MappingRecord {
  recordSchemaVersion: typeof MAPPING_RECORD_VERSION;
  mappingId: string;
  revisionId: string;
  revision: number;
  predecessorRevisionId?: string;
  scope: MappingScope;
  candidate: PhysicalTerminalMappingCandidate;
  verification: MappingVerificationResult;
  verificationState: MappingVerificationState;
  approval: { state: MappingApprovalState; mappingContentDigest?: string; decisionId?: string; actor?: EngineeringActor; decidedAt?: string; reason?: string; policyVersion?: string };
  freshness: { state: MappingFreshnessState; staleDependencyIds: string[]; evaluatedAt: string };
  conflict: { state: MappingConflictState; conflictIds: string[] };
  lifecycle: MappingLifecycleState;
  mappingContentDigest: string;
  recordDigest: string;
  createdAt: string;
  createdBy: EngineeringActor;
}

export interface MappingAuditEvent { schemaVersion: typeof MAPPING_AUDIT_VERSION; eventId: string; mappingId: string; fromRevisionId: string | null; toRevisionId: string; action: "persist_verification" | "approve" | "reject" | "revoke" | "mark_stale" | "supersede"; actor: EngineeringActor; reason: string; idempotencyKey: string; occurredAt: string; eventDigest: string }
export interface MappingInvalidationEvent { schemaVersion: typeof MAPPING_INVALIDATION_VERSION; eventId: string; scope: MappingScope; mappingId: string; fromMappingRevisionId: string | null; toMappingRevisionId: string; oldCertificateId: string | null; newCertificateId: string; reason: string; stage2CacheMode: "disabled"; stage2DependencyKeys: string[]; stage3PlansStaled: number | null; occurredAt: string; eventDigest: string }

export type MappingEffectStatus =
  | { state: "pending"; eventType: string; eventVersion: number; attempts: number }
  | { state: "retryable_failed"; eventType: string; eventVersion: number; attempts: number; errorCode: string }
  | { state: "terminal_failed"; eventType: string; eventVersion: number; attempts: number; errorCode: string }
  | { state: "completed"; eventType: string; eventVersion: number; attempts: number; completedAt: string };
export interface MappingConvergence {
  owner: { aggregateType: string; aggregateKey: string; aggregateRevision: number; mappingRevisionId: string };
  state: "pending" | "retryable_failed" | "terminal_failed" | "completed";
  projection: MappingEffectStatus;
  invalidation: MappingEffectStatus;
  outcome: { stage2DependencyKeys: string[]; stage3PlansStaled: number } | null;
}

export interface MappingMutationRequest { requestId: string; tenantId: string; projectId: string; branchId: string; componentInstanceId: string; assemblyVariantId: string; mappingId?: string; verificationId?: string; expectedRevision: number; expectedMappingContentDigest?: string; idempotencyKey: string; reason: string; actorContext: EngineeringActor; requestedAt: string }
export interface MappingCommitResult { record: MappingRecord; audit: MappingAuditEvent; invalidation: MappingInvalidationEvent; stage1Reference: PinPadMappingReference; idempotent: boolean }

export interface MappingContextProvider { getContext(request: MappingVerificationRequest, signal?: AbortSignal): Promise<MappingContext>; getCandidate(request: MappingVerificationRequest, signal?: AbortSignal): Promise<PhysicalTerminalMappingCandidate> }
export interface MappingVerificationResultLookup { verificationId: string; tenantId: string; projectId: string; branchId: string }
export interface MappingVerificationResultStore { put(input: { result: MappingVerificationResult; context: MappingContext; request: MappingVerificationRequest }): Promise<void>; get(input: MappingVerificationResultLookup): Promise<{ result: MappingVerificationResult; context: MappingContext; request: MappingVerificationRequest } | null> }
export interface MappingInvalidationTarget { invalidate(input: { scope: MappingScope; oldCertificateId: string | null; newCertificateId: string; newMappingRevisionId: string; reason: string; occurredAt: string }): Promise<{ stage2DependencyKeys: string[]; stage3PlansStaled: number }> }
export interface Stage1MappingProjector { project(record: MappingRecord, actor: EngineeringActor, idempotencyKey: string): Promise<PinPadMappingReference> }

export interface MappingRepositoryScope { tenantId: string; projectId: string; branchId: string; componentInstanceId: string; assemblyVariantId: string }
export interface MappingRepository { getHead(scope: MappingRepositoryScope): Promise<MappingRecord | null>; getRevision(scope: MappingRepositoryScope, revisionId: string): Promise<MappingRecord | null>; history(scope: MappingRepositoryScope): Promise<MappingRecord[]>; audits(scope: MappingRepositoryScope): Promise<MappingAuditEvent[]>; invalidations(scope: MappingRepositoryScope): Promise<MappingInvalidationEvent[]>; convergence?(scope: MappingRepositoryScope, revisionId: string): Promise<MappingConvergence>; getIdempotent(scope: MappingRepositoryScope, key: string): Promise<MappingCommitResult | null>; withLock<T>(scope: MappingRepositoryScope, timeoutMs: number, operation: () => Promise<T>): Promise<T>; commit(input: { scope: MappingRepositoryScope; expectedRevision: number; record: MappingRecord; action: MappingAuditEvent["action"]; actor: EngineeringActor; reason: string; idempotencyKey: string; invalidation: Omit<MappingInvalidationEvent, "eventId" | "eventDigest">; stage1Reference: PinPadMappingReference }): Promise<MappingCommitResult> }

export function mappingScopeFromPhysical(scope: PhysicalBindingScope, bindingSetId: string, bindingRevisionId: string, assemblyVariantId: string): MappingScope {
  return { tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId, boardInstanceId: scope.boardInstanceId, componentInstanceId: scope.componentInstanceId, bindingSetId, bindingRevisionId, hierarchyPath: [...scope.hierarchyPath], assemblyVariantId };
}
