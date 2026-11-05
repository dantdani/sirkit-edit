import type { BBox, Vec2 } from "../pcb/geometry";
import type { LayerId } from "../pcb/layers";
import type { BoardDimension, BoardText, PcbBoard, PcbNet, RoutingHistoryEvent, RoutingKeepout, RoutingPreferences, Track, Via, Zone } from "../pcb/types";
import type { SilkItem } from "../pcb/silk/types";
import type { Padstack } from "../pcb/padstack/types";

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
  /** Geometry unit contract: board operations are integer nanometres;
   *  schematic operations (B06) are integer canvas pixels (10px grid). */
  units: "nm" | "px";
  expectedObjectVersion?: string;
}

export type EngineeringOperation =
  | (OperationBase & { kind: "move_footprint"; footprintId: string; at: Vec2; rotationDeg?: number; side?: "top" | "bottom" })
  | (OperationBase & { kind: "set_footprint_protection"; footprintId: string; locked: boolean })
  // ── B08 — exact-inverse PCB collection operations ──────────────────────────
  // Adds carry an optional exact insertion index (`atIndex`, default append)
  // so a remove's inverse restores the EXACT array position — deleting the
  // middle track from [a,b,c] and undoing yields [a,b,c] again, digest-exact.
  // Updates carry EITHER a `patch` (forward UI merges; `locked` is protection
  // state and structurally excluded — see set_copper_protection) OR an exact
  // `replace` snapshot (full mutable object, same id) — kernel-minted
  // inverses are ALWAYS `replace` snapshots so field ABSENCE round-trips
  // (a patch that added `padstackId` undoes to a via without the property).
  // Kernel-minted remove inverses may set `pruneEmptyCollection` on removes
  // of OPTIONAL collections so `undo(add-first-item)` restores collection
  // absence exactly (forward UI removes never set it).
  | (OperationBase & { kind: "add_track"; track: Track; atIndex?: number })
  | (OperationBase & { kind: "update_track"; trackId: string; patch?: Partial<Pick<Track, "start" | "end" | "width" | "layer" | "netId">>; replace?: Track })
  | (OperationBase & { kind: "remove_track"; trackId: string })
  | (OperationBase & { kind: "add_via"; via: Via; atIndex?: number })
  | (OperationBase & { kind: "update_via"; viaId: string; patch?: Partial<Pick<Via, "at" | "size" | "drill" | "layers" | "netId" | "padstackId">>; replace?: Via })
  | (OperationBase & { kind: "remove_via"; viaId: string })
  | (OperationBase & { kind: "add_zone"; zone: Zone; atIndex?: number })
  | (OperationBase & { kind: "update_zone"; zoneId: string; patch?: Partial<Pick<Zone, "polygon" | "netId" | "layer" | "priority" | "connection" | "clearanceOverrideNm">>; replace?: Zone })
  | (OperationBase & { kind: "remove_zone"; zoneId: string })
  // B08 — copper/zone protection is its OWN authorized operation
  // (manage_protection), exactly invertible, and exempt from the
  // locked-object mutation guard so its inverse can never self-block.
  | (OperationBase & { kind: "set_copper_protection"; target: "track" | "via" | "zone"; id: string; locked: boolean })
  // B08 — board text annotations.
  | (OperationBase & { kind: "add_text"; text: BoardText; atIndex?: number })
  | (OperationBase & { kind: "update_text"; textId: string; replace: BoardText })
  | (OperationBase & { kind: "remove_text"; textId: string })
  // B08 — silkscreen items (optional collection).
  | (OperationBase & { kind: "add_silk"; item: SilkItem; atIndex?: number })
  | (OperationBase & { kind: "update_silk"; silkId: string; replace: SilkItem })
  | (OperationBase & { kind: "remove_silk"; silkId: string; pruneEmptyCollection?: boolean })
  // B08 — via padstacks (optional collection; deletion validates no via
  // still references the padstack — referential integrity, atomic).
  | (OperationBase & { kind: "add_padstack"; padstack: Padstack; atIndex?: number })
  | (OperationBase & { kind: "update_padstack"; padstackId: string; replace: Padstack })
  | (OperationBase & { kind: "remove_padstack"; padstackId: string; pruneEmptyCollection?: boolean })
  // B08 — routing keepouts (optional collection).
  | (OperationBase & { kind: "add_keepout"; keepout: RoutingKeepout; atIndex?: number })
  | (OperationBase & { kind: "update_keepout"; keepoutId: string; replace: RoutingKeepout })
  | (OperationBase & { kind: "remove_keepout"; keepoutId: string; pruneEmptyCollection?: boolean })
  // B08 — dimension annotations (optional collection).
  | (OperationBase & { kind: "add_dimension"; dimension: BoardDimension; atIndex?: number })
  | (OperationBase & { kind: "update_dimension"; dimensionId: string; replace: BoardDimension })
  | (OperationBase & { kind: "remove_dimension"; dimensionId: string; pruneEmptyCollection?: boolean })
  // B08 — exact-snapshot board settings (null = the field is ABSENT; the op
  // always carries the complete target value, so inverses are trivially
  // digest-exact). These are settings payloads, not geometry — the integer-nm
  // walker does not apply (they may carry floats like envelopeScale or
  // boardThicknessMm).
  | (OperationBase & { kind: "update_stackup"; stackup: PcbBoard["stackup"]; stackupConfig: NonNullable<PcbBoard["stackupConfig"]> | null })
  | (OperationBase & { kind: "update_net_classing"; netClassing: NonNullable<PcbBoard["netClassing"]> | null })
  | (OperationBase & { kind: "update_constraint_state"; constraintState: NonNullable<PcbBoard["constraintState"]> | null })
  | (OperationBase & { kind: "update_placement_settings"; placementPreferences: NonNullable<PcbBoard["placementPreferences"]> | null; placementPolicy: NonNullable<PcbBoard["placementPolicy"]> | null })
  | (OperationBase & { kind: "update_routing_history"; events: RoutingHistoryEvent[] | null })
  | (OperationBase & { kind: "update_board_outline"; outline: PcbBoard["outline"] })
  | (OperationBase & { kind: "update_routing_preferences"; preferences: RoutingPreferences | null })
  | (OperationBase & { kind: "update_net"; netId: number; patch: Partial<Pick<PcbNet, "name" | "endpointKeys">> })
  | (OperationBase & { kind: "pin_asset"; asset: CanonicalProjectState["pinnedAssets"][number] })
  | (OperationBase & { kind: "remove_pinned_asset"; assetId: string })
  // ── B06 — canonical schematic operations (units: "px") ─────────────────────
  // Deterministic delete: the component plus its PRE-PLANNED incident cleanup
  // (wires whose first/last vertex sits on a deleted pin coordinate; labels
  // positioned exactly at a deleted pin coordinate — the audited tier-1
  // policy applied uniformly). The plan is part of the operation, so it is
  // validated, replayable, and visible in the durable record.
  | (OperationBase & { kind: "schematic_delete_component"; family: "theory" | "kicad"; componentId: string; removeWireIds: string[]; removeNetLabelIds: string[] })
  // Exact inverse of delete: insert-only, and ORDER-EXACT — every entity
  // carries the array index it was removed from, so replaying the inverse
  // reproduces the exact base state (digest-identical, not merely
  // set-identical). Any id collision rejects the whole operation.
  | (OperationBase & { kind: "schematic_restore_entities"; components: Array<RestoreEntry<SchematicComponentSnapshot>>; kicadComponents: Array<RestoreEntry<SchematicKicadSnapshot>>; wires: Array<RestoreEntry<SchematicWireSnapshot>>; netLabels: Array<RestoreEntry<SchematicNetLabelSnapshot>> })
  // Atomic replacement of ONE kicad component instance: identity fields are
  // replaced TOGETHER (partId + every authority field — stale authority can
  // never be silently retained), and wire endpoints AND net labels move per
  // the validated pin mapping. `expectedCurrentPartId` is a hard
  // precondition; label moves validate the label's exact current coordinate.
  | (OperationBase & {
      kind: "schematic_replace_component";
      componentId: string;
      expectedCurrentPartId: string;
      replacement: { partId: string; value?: string; atomicPartRevisionId?: string; symbolAssetVersionId?: string; footprintAssetVersionId?: string; mappingCertificateId?: string; selectionRecordId?: string };
      /** Validated old-pin → new-pin identity mapping (audit record). */
      pinMapping: Array<{ fromPin: string; toPin: string }>;
      /** Wire endpoint moves required to preserve mapped connectivity. */
      wireEndpointMoves: Array<{ wireId: string; end: "start" | "end"; to: { x: number; y: number } }>;
      /** B06.1: net-label moves that preserve label-attached connectivity.
       *  `from` is a hard precondition on the label's current position. */
      netLabelMoves: Array<{ labelId: string; from: { x: number; y: number }; to: { x: number; y: number } }>;
      /** B06.1: authority resources consumed to authorize a verified-atomic
       *  replacement (ids + content digests) — durable audit provenance.
       *  Absent for catalog-unverified replacements. B06.2: recorded in the
       *  durable record only after the runtime grant validated; NEVER proof
       *  by itself. */
      consumedAuthorityResources?: Array<{ resourceId: string; contentDigest: string }>;
      /** B06.2: registry handle of the runtime authority grant. Worthless
       *  without the registered branded grant — the executor verifies the
       *  grant itself, never this string. Absent for catalog-unverified. */
      authorityGrantId?: string;
    })
  // B07: theory `refDes` accepts `null` = clear the display override (display
  // falls back to the stable id) — required so the inverse of a FIRST rename
  // restores field-absence digest-exactly. Kicad refDes never accepts null.
  | (OperationBase & { kind: "schematic_set_component_properties"; family: "theory" | "kicad"; componentId: string; patch: { value?: string; refDes?: string | null } })
  | (OperationBase & { kind: "schematic_transform_component"; family: "theory" | "kicad"; componentId: string; x: number; y: number; rotation: 0 | 90 | 180 | 270 })
  // ── B07 — canonical schematic graph operations (units: "px") ───────────────
  // Wires and net labels are order-preserving collections: adds carry the
  // exact insertion index so delete/undo/redo reproduce array order, and
  // every delete's inverse is an indexed add. Geometry updates capture their
  // exact inverse from the pre-apply state. Components never appear or
  // disappear through these ops except via schematic_add_component (whose
  // inverse is a plain delete — a fresh add has no incident cleanup).
  | (OperationBase & { kind: "schematic_add_wire"; wire: SchematicWireSnapshot; atIndex: number })
  | (OperationBase & { kind: "schematic_delete_wire"; wireId: string })
  | (OperationBase & { kind: "schematic_update_wire_geometry"; wireId: string; vertices: Array<{ x: number; y: number }> })
  | (OperationBase & { kind: "schematic_add_net_label"; label: SchematicNetLabelSnapshot; atIndex: number })
  | (OperationBase & { kind: "schematic_delete_net_label"; labelId: string })
  | (OperationBase & { kind: "schematic_update_net_label"; labelId: string; patch: { position?: { x: number; y: number }; name?: string; orientation?: 0 | 90 | 180 | 270 } })
  | (OperationBase & { kind: "schematic_add_component"; family: "theory"; component: SchematicComponentSnapshot; atIndex: number })
  | (OperationBase & { kind: "schematic_add_component"; family: "kicad"; component: SchematicKicadSnapshot; atIndex: number })
  // ── [PR-J, 2026-10-22] canonical schematic SHEET operations (units: "px"; runbook J, OD-255) ───────────────
  // Each has an exact inverse. The sheet tree exists only while a child sheet exists: the first create carries
  // the root record (`root`) and turns the document into sirkit.schematic.v2; deleting the last child sheet
  // removes the tree (back to v1) and its inverse carries the root record again. Deleting a populated sheet,
  // a port still referenced by a label, or any batch that would join two different rail / isolation domains
  // is refused (OD-255 item 4).
  | (OperationBase & { kind: "schematic_create_sheet"; sheet: SchematicSheetSnapshot; atIndex: number; root?: SchematicSheetSnapshot })
  | (OperationBase & { kind: "schematic_delete_sheet"; sheetId: string })
  | (OperationBase & { kind: "schematic_rename_sheet"; sheetId: string; name: string })
  /** The complete new sheet order (a permutation of every sheet id, root first). */
  | (OperationBase & { kind: "schematic_reorder_sheets"; order: string[] })
  | (OperationBase & { kind: "schematic_add_sheet_port"; sheetId: string; port: SchematicSheetPortSnapshot; atIndex: number })
  | (OperationBase & { kind: "schematic_remove_sheet_port"; sheetId: string; portId: string })
  /** A sheet pin is a net label with scope "sheet-pin" on the child's parent sheet. */
  | (OperationBase & { kind: "schematic_add_sheet_pin"; pin: SchematicNetLabelSnapshot; atIndex: number })
  | (OperationBase & { kind: "schematic_remove_sheet_pin"; labelId: string })
  /** Exact snapshot of a label's connection fields (null = absent). */
  | (OperationBase & { kind: "schematic_set_label_scope"; labelId: string; scope: "global" | "hierarchical" | "sheet-pin" | null; portId: string | null; childSheetId: string | null })
  /** Move entities between sheets. `from` is a hard precondition ("root" = no sheetId), `to` the target ("root" = clear it). */
  | (OperationBase & { kind: "schematic_assign_sheet"; entries: SchematicSheetAssignment[] });

/** [PR-J, 2026-10-22] Sheet-operation payload shapes (structural; the canonical validator owns the rules). */
export interface SchematicSheetPortSnapshot { id: string; name: string; direction: "input" | "output" | "bidirectional" | "passive" | "power_in" | "power_out" }
export interface SchematicSheetSnapshot { id: string; name: string; parentId: string | null; block?: { x: number; y: number; width: number; height: number }; ports?: SchematicSheetPortSnapshot[] }
export interface SchematicSheetAssignment { family: "theory" | "kicad" | "wire" | "label"; id: string; from: string; to: string }

/** An entity snapshot plus the array index it is restored at (order-exact inverse). */
export interface RestoreEntry<T> { at: number; entity: T }

/** Snapshot shapes for schematic_restore_entities (structural, versioned via the operation schema).
 *  B07: theory components carry an optional editable display reference
 *  (`refDes`); the immutable stable identity is `id`, and display falls back
 *  to `id` when `refDes` is absent (the deterministic legacy rule). */
export interface SchematicComponentSnapshot { id: string; type: string; x: number; y: number; rotation: 0 | 90 | 180 | 270; value: string; refDes?: string; sheetId?: string }
export interface SchematicKicadSnapshot { id: string; partId: string; x: number; y: number; rotation: 0 | 90 | 180 | 270; refDes: string; value: string; atomicPartRevisionId?: string; symbolAssetVersionId?: string; footprintAssetVersionId?: string; mappingCertificateId?: string; selectionRecordId?: string; sheetId?: string }
export interface SchematicWireSnapshot { id: string; vertices: Array<{ x: number; y: number }>; sheetId?: string }
export interface SchematicNetLabelSnapshot { id: string; position: { x: number; y: number }; name: string; kind: string; orientation: 0 | 90 | 180 | 270; sheetId?: string; scope?: "global" | "hierarchical" | "sheet-pin"; portId?: string; childSheetId?: string }

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
