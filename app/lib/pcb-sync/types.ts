import type { EngineeringActor } from "../engineering/types";
import type { FootprintResolutionBatchResult, FootprintResolutionResult } from "../footprint-resolver/types";
import type { FootprintDef, PcbBoard, PinPadMappingKind } from "../pcb/types";

export const PCB_SYNC_REQUEST_VERSION = "sirkit.pcb-sync-preflight-request.v1" as const;
export const PCB_SYNC_RESULT_VERSION = "sirkit.pcb-sync-preflight-result.v1" as const;
export const PCB_SYNC_SNAPSHOT_VERSION = "sirkit.pcb-sync-snapshot.v1" as const;
export const PCB_SYNC_POLICY_SCHEMA_VERSION = "sirkit.pcb-sync-policy/1.0.0" as const;
export const PCB_SYNC_PLAN_VERSION = "sirkit.pcb-sync-plan.v1" as const;
export const PCB_SYNC_APPLY_REQUEST_VERSION = "sirkit.pcb-sync-apply-request.v1" as const;
export const PCB_SYNC_APPLY_RESULT_VERSION = "sirkit.pcb-sync-apply-result.v1" as const;
export const PCB_SYNC_AUDIT_VERSION = "sirkit.pcb-sync-audit.v1" as const;
export const PCB_ROUTER_HANDOFF_VERSION = "sirkit.pcb-router-handoff.v1" as const;
export const PCB_SYNC_ENGINE_VERSION = "sirkit.pcb-sync-engine/3.0.0" as const;
export const PCB_SYNC_BOARD_ADAPTER_VERSION = "sirkit.json-pcb-board-adapter/1.0.0" as const;
export const PCB_SYNC_DEMO_PUBLICATION_REQUEST_VERSION = "sirkit.pcb-sync-demo-publication-request.v1" as const;
export const PCB_SYNC_DEMO_PUBLICATION_RESULT_VERSION = "sirkit.pcb-sync-demo-publication-result.v1" as const;
export const PCB_SYNC_BOARD_LOAD_RESULT_VERSION = "sirkit.pcb-sync-board-load-result.v1" as const;

export type PcbSyncPreflightStatus =
  | "ready_no_changes"
  | "ready_to_apply"
  | "blocked_component_resolution"
  | "blocked_mapping"
  | "blocked_net_integrity"
  | "blocked_board_risk"
  | "blocked_stale_snapshot"
  | "blocked_conflict"
  | "blocked_unsupported"
  | "blocked_authorization"
  | "error";

export type PcbSyncComponentStatus =
  | "not_applicable"
  | "nonphysical"
  | "ready_add"
  | "ready_no_change"
  | "ready_metadata_update"
  | "ready_net_update_unrouted"
  | "ready_remove_unrouted"
  | "blocked_unresolved_footprint"
  | "blocked_mapping"
  | "blocked_asset_unavailable"
  | "blocked_stale"
  | "blocked_conflict"
  | "blocked_duplicate_identity"
  | "blocked_existing_board_mismatch"
  | "blocked_routed_footprint_change"
  | "blocked_routed_net_change"
  | "blocked_unsupported";

export type PcbSyncNetStatus =
  | "ready_new_net"
  | "ready_unchanged"
  | "ready_safe_rename"
  | "ready_unrouted_membership_update"
  | "blocked_missing_mapping"
  | "blocked_unmapped_pin"
  | "blocked_label_collision"
  | "blocked_stable_identity_mismatch"
  | "blocked_unintended_merge"
  | "blocked_unintended_split"
  | "blocked_routed_change"
  | "blocked_unsupported";

export type PcbSyncRiskClass = "none" | "metadata_only" | "unrouted_structural" | "placement_affecting" | "copper_affecting" | "constraint_affecting" | "destructive" | "unsupported_unknown";
export type PcbSyncBoardClass = "new_board" | "empty_unrouted" | "unplaced_unrouted" | "placed_unrouted" | "locked_unrouted" | "routed" | "zoned" | "constrained" | "unsupported";
export type PcbSyncPlanLifecycle = "draft" | "validated" | "applicable" | "stale" | "applying" | "applied" | "aborted" | "failed";

export interface PcbSyncTargetNewBoard {
  kind: "new_board";
  boardId: string;
  boardName: string;
  boardFormatVersion: "sirkit-json-pcb/1";
}

export interface PcbSyncTargetExistingBoard {
  kind: "existing_board";
  boardId: string;
  expectedBoardRevision: string;
}

export interface PcbSyncPreflightRequest {
  requestSchemaVersion: typeof PCB_SYNC_REQUEST_VERSION;
  requestId: string;
  tenantId: string;
  projectId: string;
  branchId: string;
  designId: string;
  schematicRevision: string;
  assemblyVariantId: string;
  target: PcbSyncTargetNewBoard | PcbSyncTargetExistingBoard;
  resolutionPolicyId: string;
  resolutionPolicyVersion: string;
  syncPolicyId: string;
  syncPolicyVersion: string;
  actorContext: EngineeringActor;
  requestedAt: string;
  mode: "preview" | "prepare_apply";
  traceLevel?: "normal" | "diagnostic";
}

export interface PcbSyncSchematicPin {
  pinInstanceId: string;
  number: string;
  name?: string;
  disposition: "connected" | "unconnected" | "no_connect" | "schematic_only";
}

export interface PcbSyncSchematicComponent {
  componentInstanceId: string;
  componentRevision: string;
  referenceDesignator: string;
  value?: string;
  hierarchyPath: string[];
  symbolAssetVersionId: string;
  applicability: "applicable" | "not_applicable" | "nonphysical" | "unknown";
  pins: PcbSyncSchematicPin[];
}

export interface PcbSyncNetMember {
  componentInstanceId: string;
  pinInstanceId: string;
  pinNumber: string;
}

export interface PcbSyncSchematicNet {
  stableNetId: string;
  connectivityRevision: string;
  canonicalScope: string[];
  displayName: string;
  aliases: string[];
  classification: "signal" | "power" | "ground" | "differential" | "other";
  members: PcbSyncNetMember[];
  explicitNoConnectPinIds: string[];
  constraintRefs: string[];
}

export interface PcbSyncAuthoritativeSnapshot {
  schemaVersion: typeof PCB_SYNC_SNAPSHOT_VERSION;
  tenantId: string;
  projectId: string;
  branchId: string;
  designId: string;
  projectRevision: string;
  designRevision: string;
  schematicRevision: string;
  schematicDigest: string;
  componentSetRevision: string;
  netGraphRevision: string;
  netGraphDigest: string;
  assemblyVariantId: string;
  assemblyVariantRevision: string;
  librarySnapshotRevision: string;
  constraintsRevision?: string;
  components: PcbSyncSchematicComponent[];
  nets: PcbSyncSchematicNet[];
  prerequisiteIssues: PcbSyncIssue[];
  newBoardTemplate?: PcbBoard;
  snapshotDigest: string;
}

/** Demo-only ingestion input. Scope and actor authority are always supplied by the server boundary. */
export interface PcbSyncDemoSnapshotPublicationRequest {
  requestSchemaVersion: typeof PCB_SYNC_DEMO_PUBLICATION_REQUEST_VERSION;
  requestId: string;
  designId: string;
  boardId: string;
  boardName: string;
  projectRevision: string;
  designRevision: string;
  schematicRevision: string;
  componentSetRevision: string;
  netGraphRevision: string;
  assemblyVariantId: string;
  assemblyVariantRevision: string;
  librarySnapshotRevision: string;
  constraintsRevision?: string;
  expectedSnapshotRevision: number;
  idempotencyKey: string;
  components: PcbSyncSchematicComponent[];
  nets: PcbSyncSchematicNet[];
  prerequisiteIssues: PcbSyncIssue[];
  sourceDigest?: string;
  requestedAt: string;
}

export interface PcbSyncSnapshotPublicationResult {
  resultSchemaVersion: typeof PCB_SYNC_DEMO_PUBLICATION_RESULT_VERSION;
  requestId: string;
  snapshotId: string;
  snapshotRevision: number;
  snapshotDigest: string;
  schematicDigest: string;
  netGraphDigest: string;
  scope: { tenantId: string; projectId: string; branchId: string };
  actorId: string;
  designId: string;
  boardId: string;
  assemblyVariantId: string;
  created: boolean;
  idempotent: boolean;
  publishedAt: string;
  snapshot: PcbSyncAuthoritativeSnapshot;
}

export interface PcbSyncBoardLoadResult {
  resultSchemaVersion: typeof PCB_SYNC_BOARD_LOAD_RESULT_VERSION;
  status: "found" | "not_found" | "not_modified";
  scope: { tenantId: string; projectId: string; branchId: string; boardId: string };
  record?: PcbSyncBoardRecord;
}

export interface VerifiedPinPadMappingEntry {
  symbolPinNumber: string;
  pinInstanceId?: string;
  padNumbers: string[];
  mappingKind: PinPadMappingKind;
}

export interface VerifiedPinPadMappingArtifact {
  schemaVersion: "sirkit.verified-pin-pad-mapping.v1";
  mappingCertificateId: string;
  verifierVersion: string;
  state: "verified";
  symbolAssetVersionId: string;
  footprintAssetVersionId: string;
  footprintContentDigest: string;
  entries: VerifiedPinPadMappingEntry[];
  mechanicalPadNumbers: string[];
  evidenceRefs: string[];
  artifactDigest: string;
}

export interface PcbSyncFootprintMaterialization {
  componentInstanceId: string;
  bindingRevisionId: string;
  assetVersionId: string;
  assetContentDigest: string;
  assetSemanticDigest?: string;
  footprintFullName: string;
  footprintDef: FootprintDef;
  mapping: VerifiedPinPadMappingArtifact;
  materializationDigest: string;
}

export interface PcbSyncSnapshotIdentity {
  snapshotDigest: string;
  projectRevision: string;
  designRevision: string;
  schematicRevision: string;
  schematicDigest: string;
  componentSetRevision: string;
  netGraphRevision: string;
  netGraphDigest: string;
  assemblyVariantId: string;
  assemblyVariantRevision: string;
  librarySnapshotRevision: string;
  constraintsRevision?: string;
  targetBoardId: string;
  /**
   * Board name from the originating preflight request when the target is a new
   * board. Preserved so apply-time revalidation reconstructs the identical
   * request instead of substituting the boardId (whose `board:<project>` form
   * is not a legal board name).
   */
  targetBoardName?: string;
  targetBoardRevision: string | null;
  targetBoardDigest: string | null;
}

export type PcbSyncIssueScope = "request" | "authorization" | "snapshot" | "component" | "mapping" | "asset" | "net" | "board" | "plan" | "storage" | "router" | "legacy" | "system";

export interface PcbSyncIssue {
  code: string;
  severity: "info" | "warning" | "error" | "blocking";
  blocking: boolean;
  scope: PcbSyncIssueScope;
  stableIds: string[];
  displayRefs: string[];
  message: string;
  remediationCategory: string;
  evidenceRefs: string[];
  causedBy: string[];
  retryability: "never" | "after_user_action" | "after_refresh" | "transient";
  helpKey: string;
}

export interface PcbSyncGateResult {
  code: string;
  status: "pass" | "fail" | "blocked" | "not_applicable";
  blocking: boolean;
  severity: PcbSyncIssue["severity"];
  scope: PcbSyncIssueScope;
  stableIds: string[];
  message: string;
  remediationCategory: string;
  evidenceRefs: string[];
  causedBy: string[];
}

export interface ComponentTransferAssessment {
  componentInstanceId: string;
  referenceDesignator: string;
  hierarchyPath: string[];
  componentRevision: string;
  applicability: PcbSyncSchematicComponent["applicability"];
  resolutionStatus: FootprintResolutionResult["status"] | "not_requested" | "missing_result";
  resolutionDecisionDigest?: string;
  bindingRevisionId?: string;
  footprintAssetVersionId?: string;
  footprintContentDigest?: string;
  packageRevisionId?: string;
  exactPartId?: string;
  mappingCertificateId?: string;
  mappingStatus: "verified" | "missing" | "stale" | "invalid" | "not_applicable";
  pcbInstanceId?: string;
  currentFootprintAssetVersionId?: string;
  currentFootprintContentDigest?: string;
  proposedOperation: PcbSyncOperationKind | "blocked";
  risk: PcbSyncRiskClass;
  status: PcbSyncComponentStatus;
  blockers: PcbSyncIssue[];
  warnings: PcbSyncIssue[];
  resolverBlockerCodes: string[];
  evidenceRefs: string[];
}

export interface NetPadMember {
  componentInstanceId: string;
  pinInstanceId: string;
  pinNumber: string;
  padNumbers: string[];
}

export interface NetTransferAssessment {
  stableNetId: string;
  canonicalScope: string[];
  displayName: string;
  aliases: string[];
  classification: PcbSyncSchematicNet["classification"];
  members: NetPadMember[];
  existingBoardNetId?: number;
  existingBoardNetName?: string;
  proposedOperation: "add_net" | "preserve_net" | "rename_net_identity_preserving" | "update_unrouted_net_membership" | "remove_unrouted_net" | "blocked";
  connectivityDigest: string;
  routedCopperAffected: boolean;
  status: PcbSyncNetStatus;
  blockers: PcbSyncIssue[];
  warnings: PcbSyncIssue[];
}

export interface BoardTransferAssessment {
  boardId: string;
  boardClass: PcbSyncBoardClass;
  formatSupported: boolean;
  backend: "sirkit_json_board";
  boardRevision: string | null;
  boardDigest: string | null;
  footprintCount: number;
  netCount: number;
  trackCount: number;
  viaCount: number;
  zoneCount: number;
  lockedFootprintCount: number;
  constrained: boolean;
  unknownConstructs: string[];
  risk: PcbSyncRiskClass;
  blockers: PcbSyncIssue[];
  warnings: PcbSyncIssue[];
}

export interface PcbSyncReadinessSummary {
  totalSchematicComponents: number;
  applicableComponents: number;
  notApplicableComponents: number;
  nonphysicalComponents: number;
  resolvedComponents: number;
  layoutReadyComponents: number;
  unresolvedComponents: number;
  mappingBlockedComponents: number;
  staleComponents: number;
  conflictingComponents: number;
  addOperations: number;
  updateOperations: number;
  removeOperations: number;
  footprintReplacementOperations: number;
  blockedOperations: number;
  totalNets: number;
  blockedNets: number;
  boardChanged: false;
}

export type PcbSyncOperationKind =
  | "create_board"
  | "add_component_instance"
  | "preserve_component_instance"
  | "update_component_metadata"
  | "update_reference_designator"
  | "update_value_display"
  | "add_net"
  | "preserve_net"
  | "rename_net_identity_preserving"
  | "assign_pad_to_net"
  | "update_unrouted_net_membership"
  | "remove_unrouted_net"
  | "remove_unrouted_component"
  | "replace_unrouted_footprint"
  | "mark_dnp_or_excluded"
  | "no_op";

export interface PcbSyncOperation {
  operationId: string;
  kind: PcbSyncOperationKind;
  targetStableId: string;
  beforeDigest: string | null;
  afterDigest: string | null;
  sourceRefs: string[];
  dependencies: string[];
  risk: PcbSyncRiskClass;
  reversibility: "trivial" | "snapshot_restore" | "stage8_required";
  requiredRole: "pcb_editor" | "project_admin";
  requiresConfirmation: boolean;
  orderingKey: string;
  validationGateCodes: string[];
  summary: string;
  component?: {
    componentInstanceId: string;
    referenceDesignator: string;
    value?: string;
    footprintAssetVersionId: string;
    footprintContentDigest: string;
    bindingRevisionId: string;
    mappingCertificateId: string;
    symbolAssetVersionId: string;
    at: { x: number; y: number };
    rotationDeg: number;
    side: "top" | "bottom";
  };
  net?: { stableNetId: string; displayName: string; endpointKeys: string[] };
  padAssignment?: { componentInstanceId: string; stableNetId: string; padNumbers: string[] };
}

export interface PcbSyncBlockedOperation {
  blockedOperationId: string;
  intendedKind: string;
  targetStableId: string;
  risk: PcbSyncRiskClass;
  reasonCodes: string[];
  summary: string;
}

export interface PcbSyncPolicyVersions {
  syncPolicyId: string;
  syncPolicyVersion: string;
  resolutionPolicyId: string;
  resolutionPolicyVersion: string;
  resolverVersion: string;
  normalizationVersion: string;
  boardAdapterVersion: string;
  engineVersion: string;
}

export interface PcbSyncPlan {
  planSchemaVersion: typeof PCB_SYNC_PLAN_VERSION;
  planId: string;
  planDigest: string;
  lifecycle: PcbSyncPlanLifecycle;
  scope: { tenantId: string; projectId: string; branchId: string; designId: string; boardId: string };
  snapshot: PcbSyncSnapshotIdentity;
  operations: PcbSyncOperation[];
  blockedOperations: PcbSyncBlockedOperation[];
  prerequisites: PcbSyncGateResult[];
  resolverEvidence: Array<{ componentInstanceId: string; decisionDigest: string; dependencyDigest: string; bindingRevisionId?: string }>;
  materializations: PcbSyncFootprintMaterialization[];
  expectedOutput: { componentIds: string[]; stableNetIds: string[]; boardStructuralDigest: string };
  policyVersions: PcbSyncPolicyVersions;
  createdBy: EngineeringActor;
  createdAt: string;
  expiresAt: string;
}

export interface PcbSyncTraceStep {
  ordinal: number;
  phase: "request" | "snapshot" | "resolver" | "reconciliation" | "inspection" | "plan" | "apply" | "validation" | "commit" | "handoff";
  code: string;
  message: string;
  safeDetails: Record<string, string | number | boolean>;
}

export interface PcbSyncPreflightResult {
  resultSchemaVersion: typeof PCB_SYNC_RESULT_VERSION;
  preflightId: string;
  requestId: string;
  status: PcbSyncPreflightStatus;
  snapshot: PcbSyncSnapshotIdentity;
  summary: PcbSyncReadinessSummary;
  components: ComponentTransferAssessment[];
  nets: NetTransferAssessment[];
  board: BoardTransferAssessment;
  globalGates: PcbSyncGateResult[];
  blockers: PcbSyncIssue[];
  warnings: PcbSyncIssue[];
  plan?: PcbSyncPlan;
  resolverBatchSummary: FootprintResolutionBatchResult["summary"];
  policyVersions: PcbSyncPolicyVersions;
  trace: PcbSyncTraceStep[];
  evaluatedAt: string;
}

export interface PcbSyncApplyRequest {
  requestSchemaVersion: typeof PCB_SYNC_APPLY_REQUEST_VERSION;
  requestId: string;
  tenantId: string;
  projectId: string;
  branchId: string;
  designId: string;
  boardId: string;
  planId: string;
  planDigest: string;
  expectedPlanLifecycle: "applicable";
  confirmation: "apply_exact_plan";
  idempotencyKey: string;
  warningAcknowledgements: string[];
  actorContext: EngineeringActor;
  requestedAt: string;
}

export interface PcbSyncAuditRecord {
  schemaVersion: typeof PCB_SYNC_AUDIT_VERSION;
  auditId: string;
  planId: string;
  planDigest: string;
  scope: PcbSyncPlan["scope"];
  actor: EngineeringActor;
  operationIds: string[];
  originalBoardRevision: string | null;
  committedBoardRevision: string;
  committedBoardDigest: string;
  idempotencyKey: string;
  outcome: "committed" | "idempotent_replay" | "aborted" | "failed";
  occurredAt: string;
  auditDigest: string;
}

export interface PcbRouterHandoff {
  schemaVersion: typeof PCB_ROUTER_HANDOFF_VERSION;
  tenantId: string;
  projectId: string;
  designId: string;
  boardId: string;
  boardRevision: string;
  boardDigest: string;
  assemblyVariantId: string;
  syncPlanId: string;
  syncAuditId: string;
  componentCount: number;
  netCount: number;
  unresolvedComponentCount: 0;
  structuralValidationStatus: "passed";
  placementState: "unplaced" | "partially_placed" | "placed";
  routingState: "unrouted" | "partially_routed" | "routed";
  constraintsRevision?: string;
  generatedAt: string;
}

export interface PcbSyncApplyResult {
  resultSchemaVersion: typeof PCB_SYNC_APPLY_RESULT_VERSION;
  requestId: string;
  status: "applied" | "idempotent_replay" | "blocked_stale" | "blocked_authorization" | "failed_precommit" | "recoverable_commit_uncertainty";
  planId: string;
  planDigest: string;
  boardChanged: boolean;
  originalBoardRevision: string | null;
  committedBoardRevision?: string;
  committedBoardDigest?: string;
  operationOutcomes: Array<{ operationId: string; status: "applied" | "preserved" | "skipped" }>;
  blockers: PcbSyncIssue[];
  warnings: PcbSyncIssue[];
  audit?: PcbSyncAuditRecord;
  routerHandoff?: PcbRouterHandoff;
  completedAt: string;
}

export interface PcbSyncBoardRecord {
  tenantId: string;
  projectId: string;
  branchId: string;
  boardId: string;
  revision: string;
  digest: string;
  board: PcbBoard;
  updatedAt: string;
}

export interface PcbSyncPolicy {
  schemaVersion: typeof PCB_SYNC_POLICY_SCHEMA_VERSION;
  policyId: "sirkit.safe-pcb-sync";
  version: "1.0.0";
  supportedBoardFormat: "sirkit-json-pcb/1";
  allowedAutomaticRisks: PcbSyncRiskClass[];
  allowedOperationKinds: PcbSyncOperationKind[];
  maxComponents: number;
  maxNets: number;
  maxOperations: number;
  maxTraceSteps: number;
  lockTimeoutMs: number;
  planTtlMs: number;
  acceptedMappingVerifierVersions: string[];
  requireHumanApply: boolean;
  blockRoutedStructuralChanges: true;
  requireLosslessKnownBoardModel: true;
}

export interface PcbSyncPreflightContext {
  request: PcbSyncPreflightRequest;
  snapshot: PcbSyncAuthoritativeSnapshot;
  boardRecord: PcbSyncBoardRecord | null;
  boardAssessment: BoardTransferAssessment;
  resolverBatch: FootprintResolutionBatchResult;
  resolutionByComponent: Record<string, FootprintResolutionResult>;
  materializations: PcbSyncFootprintMaterialization[];
  policy: PcbSyncPolicy;
  contextIssues: PcbSyncIssue[];
}

export interface PcbSyncSnapshotProvider {
  acquire(request: PcbSyncPreflightRequest, signal?: AbortSignal): Promise<PcbSyncAuthoritativeSnapshot>;
}

export interface PcbSyncSnapshotPublisher {
  publish(snapshot: PcbSyncAuthoritativeSnapshot, input: { expectedRevision: number; idempotencyKey: string; requestId: string; boardId: string; actorId: string; publishedAt: string }): Promise<PcbSyncSnapshotPublicationResult>;
}

export interface PcbSyncFootprintResolver {
  resolveBatch(request: Parameters<import("../footprint-resolver/service").FootprintResolutionService["resolveBatch"]>[0], signal?: AbortSignal): Promise<FootprintResolutionBatchResult>;
}

export interface PcbSyncResourceProvider {
  materialize(component: PcbSyncSchematicComponent, result: FootprintResolutionResult, signal?: AbortSignal): Promise<PcbSyncFootprintMaterialization | null>;
}

export interface PcbSyncAuthorizationProvider {
  authorizePreflight(request: PcbSyncPreflightRequest): Promise<{ allowed: boolean; reasonCode: string }>;
  authorizeApply(request: PcbSyncApplyRequest, plan: PcbSyncPlan): Promise<{ allowed: boolean; reasonCode: string }>;
}

/** Server-owned time source. Apply never derives authority time from request fields. */
export type PcbSyncTrustedClock = () => string;

export interface PcbSyncFaultInjector {
  hit(point: "after_lock" | "after_revalidation" | "after_stage" | "after_mutation" | "after_serialize" | "after_reparse" | "after_validation" | "before_commit" | "during_commit" | "after_commit"): void | Promise<void>;
}

/**
 * [B16-C.3] What a `PS_SNAPSHOT_REVISION_CONFLICT` carries to the browser so
 * "another session published a newer revision" is DISTINCT from malformed
 * input or a server failure: the revision the caller pinned, the revision and
 * identity that are current, and what the caller tried to publish. The
 * browser offers refresh / rebase; it never overwrites silently.
 */
export interface PcbSyncSnapshotRevisionConflictDetails {
  kind: "snapshot_revision";
  expectedRevision: number;
  currentRevision: number;
  currentSnapshotDigest: string;
  currentSchematicRevision: string;
  currentSchematicDigest: string;
  attemptedSchematicRevision: string;
  attemptedSnapshotDigest: string;
}
