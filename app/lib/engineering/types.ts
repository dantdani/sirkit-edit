import type { BBox, Vec2 } from "../pcb/geometry";
import type { LayerId } from "../pcb/layers";
import type { PcbBoard, PcbNet, RoutingPreferences, Track, Via, Zone } from "../pcb/types";

export const STAGE10_SCHEMA_VERSION = "sirkit.engineering.v1" as const;
export const PROJECT_REVISION_SCHEMA = "sirkit.project-revision.v1" as const;
export const ENGINEERING_TRANSACTION_SCHEMA = "sirkit.engineering-transaction.v1" as const;
export const ENGINEERING_CHANGESET_SCHEMA = "sirkit.engineering-changeset.v1" as const;
export const DURABLE_RECORD_SCHEMA = "sirkit.durable-transaction-record.v1" as const;
export const PERSISTENCE_ENVELOPE_SCHEMA = "sirkit.project-persistence-envelope.v1" as const;

export type ActorKind = "human" | "ai" | "import_adapter" | "system_migration" | "automated_engine";
export type ProjectRole = "viewer" | "commenter" | "pcb_editor" | "automation" | "reviewer" | "project_admin" | "migration_admin";
export type EngineeringCapability =
  | "read_project" | "edit_placement" | "edit_copper" | "edit_zones" | "edit_stackup_outline"
  | "edit_constraints" | "edit_components" | "manage_protection" | "run_automation"
  | "approve_proposal" | "restore_project" | "migrate_project" | "export_project";

export interface EngineeringActor {
  actorId: string;
  actorKind: ActorKind;
  sessionId: string;
  role: ProjectRole;
  delegatedByActorId?: string;
  delegatedCapabilities?: EngineeringCapability[];
  delegationExpiresAt?: string;
}

export interface CanonicalProjectState {
  schemaVersion: typeof STAGE10_SCHEMA_VERSION;
  tenantId: string;
  projectId: string;
  branchId: string;
  pcb: PcbBoard;
  /** Stage 10 does not reinterpret schematic semantics; the existing state is pinned as canonical opaque JSON. */
  schematic?: unknown;
  pinnedAssets: Array<{ assetId: string; kind: string; contentDigest: string; versionId: string; required: boolean }>;
}

export interface ProjectRevision {
  schemaVersion: typeof PROJECT_REVISION_SCHEMA;
  projectId: string;
  branchId: string;
  headSequence: number;
  headTransactionId: string;
  canonicalStateDigest: string;
  domainRevisions: {
    schematic: string;
    electricalIntent: string;
    componentBindings: string;
    boardGeometry: string;
    copperTopology: string;
    zonesAndFill: string;
    stackup: string;
    constraints: string;
    protectedState: string;
    waivers: string;
    assets: string;
  };
}

export type ConflictClass =
  | "edit_vs_delete" | "same_field" | "footprint_vs_dependent_copper" | "net_vs_routing"
  | "schematic_vs_pcb" | "outline_stackup_vs_physical" | "zone_vs_copper" | "constraint_vs_candidate"
  | "protection_vs_mutation" | "waiver_release" | "shared_route_topology" | "asset_upgrade_vs_dependent"
  | "restore_migration_vs_edit" | "authorization" | "stale_base" | "unknown_interaction";

interface OperationBase {
  operationId: string;
  schemaVersion: 1;
  units: "nm";
  expectedObjectVersion?: string;
}

export type EngineeringOperation =
  | (OperationBase & { kind: "move_footprint"; footprintId: string; at: Vec2; rotationDeg?: number; side?: "top" | "bottom" })
  | (OperationBase & { kind: "set_footprint_protection"; footprintId: string; locked: boolean })
  | (OperationBase & { kind: "add_track"; track: Track })
  | (OperationBase & { kind: "update_track"; trackId: string; patch: Partial<Pick<Track, "start" | "end" | "width" | "layer" | "netId" | "locked">> })
  | (OperationBase & { kind: "remove_track"; trackId: string })
  | (OperationBase & { kind: "add_via"; via: Via })
  | (OperationBase & { kind: "update_via"; viaId: string; patch: Partial<Pick<Via, "at" | "size" | "drill" | "layers" | "netId" | "locked" | "padstackId">> })
  | (OperationBase & { kind: "remove_via"; viaId: string })
  | (OperationBase & { kind: "add_zone"; zone: Zone })
  | (OperationBase & { kind: "update_zone"; zoneId: string; patch: Partial<Pick<Zone, "polygon" | "netId" | "layer" | "priority" | "connection" | "clearanceOverrideNm" | "locked">> })
  | (OperationBase & { kind: "remove_zone"; zoneId: string })
  | (OperationBase & { kind: "update_board_outline"; outline: PcbBoard["outline"] })
  | (OperationBase & { kind: "update_routing_preferences"; preferences: RoutingPreferences })
  | (OperationBase & { kind: "update_net"; netId: number; patch: Partial<Pick<PcbNet, "name" | "endpointKeys">> })
  | (OperationBase & { kind: "pin_asset"; asset: CanonicalProjectState["pinnedAssets"][number] })
  | (OperationBase & { kind: "remove_pinned_asset"; assetId: string });

export interface DeclaredMutationScope {
  objectIds: string[];
  netIds: number[];
  layers: LayerId[];
  boundsByLayer: Partial<Record<LayerId, BBox[]>>;
  globalDomains: Array<keyof ProjectRevision["domainRevisions"]>;
}

export interface EngineeringTransaction {
  schemaVersion: typeof ENGINEERING_TRANSACTION_SCHEMA;
  transactionId: string;
  projectId: string;
  branchId: string;
  clientOperationId: string;
  actor: EngineeringActor;
  reason: string;
  baseRevision: ProjectRevision;
  operations: EngineeringOperation[];
  declaredMutationScope: DeclaredMutationScope;
  approvals: Array<{ approvalId: string; actorId: string; capability: EngineeringCapability }>;
  provenance: { source: "ui" | "api" | "ai" | "import" | "worker" | "migration" | "collaboration"; candidateId?: string; toolVersion?: string };
  createdAtClient?: string;
  receivedAtServer?: string;
  deterministicDigest: string;
}

export type SemanticImpactFlag =
  | "logical_connectivity_changed" | "physical_contact_geometry_changed" | "net_ownership_changed"
  | "constraint_program_changed" | "effective_rule_changed" | "zone_fill_dirty" | "route_topology_changed"
  | "path_measurement_changed" | "placement_analysis_changed" | "manufacturing_capability_changed"
  | "readiness_dependency_changed" | "asset_revision_changed" | "protected_state_changed";

export interface EngineeringChangeSet {
  schemaVersion: typeof ENGINEERING_CHANGESET_SCHEMA;
  transactionId: string;
  baseRevision: ProjectRevision;
  resultRevision: ProjectRevision;
  /** B03.1: semantic (derived-fill-normalized) state digests — the verified
   *  undo/redo replay domain. Absent on pre-B03.1 records: such records are
   *  NOT replayable and fail closed to the rebase rule. */
  baseSemanticStateDigest?: string;
  resultSemanticStateDigest?: string;
  createdIdsByKind: Record<string, string[]>;
  updatedIdsByKind: Record<string, string[]>;
  deletedIdsByKind: Record<string, string[]>;
  beforeAfterObjectVersions: Array<{ objectId: string; before?: string; after?: string }>;
  affectedNetIds: number[];
  affectedTerminalIds: string[];
  affectedTopologyIds: string[];
  affectedConstraintIds: string[];
  affectedComponentRevisionIds: string[];
  affectedLayers: LayerId[];
  beforeBoundsByLayer: Partial<Record<LayerId, BBox[]>>;
  afterBoundsByLayer: Partial<Record<LayerId, BBox[]>>;
  affectedZones: string[];
  affectedStackupRanges: Array<{ from: LayerId; to: LayerId }>;
  affectedEvidenceKinds: string[];
  semanticImpactFlags: SemanticImpactFlag[];
  dependencyKeys: string[];
}

export type DerivedArtifactStatus = "current" | "stale" | "pending" | "failed" | "unsupported" | "not_evaluated" | "cancelled" | "divergence_detected";

export interface DerivedArtifactState<T = unknown> {
  artifactId: string;
  artifactKind: string;
  scope: string;
  inputRevisionVector: ProjectRevision;
  evaluatorVersion: string;
  status: DerivedArtifactStatus;
  value?: T;
  invalidatedByTransactionIds: string[];
  computedAt?: string;
  durationMs?: number;
  digest: string;
  fullOracleDigest?: string;
  equivalenceStatus?: "equivalent" | "diverged" | "not_compared";
}

export interface DurableTransactionRecord {
  schemaVersion: typeof DURABLE_RECORD_SCHEMA;
  serverSequence: number;
  transaction: EngineeringTransaction;
  authorizationDecision: { allowed: boolean; capability?: EngineeringCapability; reason: string };
  validationDecision: { valid: boolean; diagnostics: string[] };
  conflictDecision: { state: "none" | "rebased" | "conflict"; conflictId?: string; reason?: string };
  appliedChangeSet?: EngineeringChangeSet;
  resultingRevision?: ProjectRevision;
  inverseOperations: EngineeringOperation[];
  persistenceCommitId: string;
  integrityDigest: string;
  previousRecordDigest?: string;
  status: "accepted" | "rejected" | "conflicted" | "undone" | "migrated" | "restored";
}

export interface EngineeringConflict {
  conflictId: string;
  projectId: string;
  targetHeadRevision: ProjectRevision;
  incomingTransactionId: string;
  conflictClass: ConflictClass;
  involvedObjectIds: string[];
  involvedTransactionIds: string[];
  baseValues: unknown[];
  headValues: unknown[];
  proposedValues: unknown[];
  engineeringImpact: string;
  allowedResolutions: Array<"keep_head" | "apply_incoming" | "manual_operation" | "rerun_candidate" | "proposal_branch" | "reject">;
  status: "open" | "resolved" | "rejected";
  resolver?: string;
  resolutionTransactionId?: string;
}

export interface EngineeringProposal {
  proposalId: string;
  projectId: string;
  baseRevision: ProjectRevision;
  branchId: string;
  creator: EngineeringActor;
  purpose: string;
  transactions: EngineeringTransaction[];
  semanticDiff: EngineeringChangeSet[];
  verificationReport?: { state: "pending" | "passed" | "failed" | "diverged"; evidenceRefs: string[] };
  conflicts: EngineeringConflict[];
  approvals: Array<{ approvalId: string; actorId: string; capability: EngineeringCapability }>;
  status: "draft" | "in_review" | "approved" | "rejected" | "merged" | "stale";
}

export interface ProjectPersistenceEnvelope {
  formatId: typeof PERSISTENCE_ENVELOPE_SCHEMA;
  schemaVersion: 1;
  projectId: string;
  branchId: string;
  /** B03.2: durable lineage identity (set by the editor-session envelope
   *  mirror; absent on store-internal envelopes). When present it is part of
   *  the envelope digest and must agree with the persisted head claim. */
  lineageId?: string;
  canonicalSnapshot: CanonicalProjectState;
  snapshotRevision: ProjectRevision;
  transactionLog: DurableTransactionRecord[];
  pinnedAssetManifest: CanonicalProjectState["pinnedAssets"];
  migrationHistory: Array<{ migrationId: string; fromVersion: string; toVersion: string; actorId: string; completedAt: string; preDigest: string; postDigest: string }>;
  integrityManifest: { snapshotDigest: string; logDigest: string; envelopeDigest: string; lastRecordDigest?: string };
  createdByBuild: string;
}

export interface TransactionAcknowledgement {
  preview: boolean;
  acceptedLocally: boolean;
  durableLocal: boolean;
  acceptedServer: boolean;
  durableServer: boolean;
  synchronizedToHead: boolean;
  verifiedAtHead: boolean;
}

export type TransactionOutcome =
  | { state: "accepted" | "duplicate" | "rebased"; record: DurableTransactionRecord; project: CanonicalProjectState; revision: ProjectRevision; derivedArtifacts: DerivedArtifactState[]; acknowledgement: TransactionAcknowledgement }
  | { state: "rejected_unauthorized" | "rejected_invalid" | "rejected_stale" | "persistence_failed"; diagnostics: string[]; revision: ProjectRevision; acknowledgement: TransactionAcknowledgement }
  | { state: "conflict"; conflict: EngineeringConflict; revision: ProjectRevision; acknowledgement: TransactionAcknowledgement };
