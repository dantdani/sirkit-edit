import type { LayerId } from "../pcb/layers";
import { authorizeOperations } from "./authorization";
import { DerivedDependencyGraph } from "./dependency";
import { applyEngineeringOperations, deriveEngineeringChangeSet } from "./operations";
import { createPersistenceEnvelope, InMemoryAtomicProjectStore, nextDurableRecord, type AtomicProjectStore } from "./persistence";
import { changeSetRevisionAudit, computeProjectRevision, revisionMatches } from "./revision";
import { engineeringDigest, omitKey } from "./stable";
import type { CanonicalProjectState, DeclaredMutationScope, DurableTransactionRecord, EngineeringOperation, EngineeringTransaction, ProjectRevision, TransactionAcknowledgement, TransactionOutcome } from "./types";

const EMPTY_ACK: TransactionAcknowledgement = { preview: false, acceptedLocally: false, durableLocal: false, acceptedServer: false, durableServer: false, synchronizedToHead: false, verifiedAtHead: false };

function operationObjectIds(operation: EngineeringOperation): string[] {
  if (operation.kind === "move_footprint" || operation.kind === "set_footprint_protection") return [`footprint:${operation.footprintId}`];
  if (operation.kind === "add_track") return [`track:${operation.track.id}`]; if (operation.kind === "update_track" || operation.kind === "remove_track") return [`track:${operation.trackId}`];
  if (operation.kind === "add_via") return [`via:${operation.via.id}`]; if (operation.kind === "update_via" || operation.kind === "remove_via") return [`via:${operation.viaId}`];
  if (operation.kind === "add_zone") return [`zone:${operation.zone.id}`]; if (operation.kind === "update_zone" || operation.kind === "remove_zone") return [`zone:${operation.zoneId}`];
  if (operation.kind === "update_net") return [`net:${operation.netId}`]; if (operation.kind === "pin_asset") return [`asset:${operation.asset.assetId}`]; if (operation.kind === "remove_pinned_asset") return [`asset:${operation.assetId}`];
  // B08 — collection + protection + settings operations declare exact scope.
  if (operation.kind === "set_copper_protection") return [`${operation.target}:${operation.id}`];
  if (operation.kind === "add_text") return [`text:${operation.text.id}`]; if (operation.kind === "update_text" || operation.kind === "remove_text") return [`text:${operation.textId}`];
  if (operation.kind === "add_silk") return [`silk:${operation.item.id}`]; if (operation.kind === "update_silk" || operation.kind === "remove_silk") return [`silk:${operation.silkId}`];
  if (operation.kind === "add_padstack") return [`padstack:${operation.padstack.id}`]; if (operation.kind === "update_padstack" || operation.kind === "remove_padstack") return [`padstack:${operation.padstackId}`];
  if (operation.kind === "add_keepout") return [`keepout:${operation.keepout.id}`]; if (operation.kind === "update_keepout" || operation.kind === "remove_keepout") return [`keepout:${operation.keepoutId}`];
  if (operation.kind === "add_dimension") return [`dimension:${operation.dimension.id}`]; if (operation.kind === "update_dimension" || operation.kind === "remove_dimension") return [`dimension:${operation.dimensionId}`];
  if (operation.kind === "update_stackup") return ["board:stackup"]; if (operation.kind === "update_net_classing") return ["board:net-classing"]; if (operation.kind === "update_constraint_state") return ["board:constraint-state"];
  if (operation.kind === "update_placement_settings") return ["board:placement-settings"]; if (operation.kind === "update_routing_history") return ["board:routing-history"];
  // B06 — schematic operations declare component + incident-entity scope.
  if (operation.kind === "schematic_delete_component") return [`schcomp:${operation.componentId}`, ...operation.removeWireIds.map((id) => `schwire:${id}`), ...operation.removeNetLabelIds.map((id) => `schlabel:${id}`)];
  if (operation.kind === "schematic_restore_entities") return [...operation.components.map((item) => `schcomp:${item.entity.id}`), ...operation.kicadComponents.map((item) => `schcomp:${item.entity.id}`), ...operation.wires.map((item) => `schwire:${item.entity.id}`), ...operation.netLabels.map((item) => `schlabel:${item.entity.id}`)];
  if (operation.kind === "schematic_replace_component") return [`schcomp:${operation.componentId}`, ...operation.wireEndpointMoves.map((move) => `schwire:${move.wireId}`), ...operation.netLabelMoves.map((move) => `schlabel:${move.labelId}`)];
  if (operation.kind === "schematic_set_component_properties" || operation.kind === "schematic_transform_component") return [`schcomp:${operation.componentId}`];
  // B07 — graph operations declare their exact entity scope.
  if (operation.kind === "schematic_add_wire") return [`schwire:${operation.wire.id}`];
  if (operation.kind === "schematic_delete_wire" || operation.kind === "schematic_update_wire_geometry") return [`schwire:${operation.wireId}`];
  if (operation.kind === "schematic_add_net_label") return [`schlabel:${operation.label.id}`];
  if (operation.kind === "schematic_delete_net_label" || operation.kind === "schematic_update_net_label") return [`schlabel:${operation.labelId}`];
  if (operation.kind === "schematic_add_component") return [`schcomp:${operation.component.id}`];
  return [operation.kind === "update_board_outline" ? "board:outline" : "board:routing-preferences"];
}

export function declaredScopeForOperations(operations: readonly EngineeringOperation[]): DeclaredMutationScope {
  const objectIds = operations.flatMap(operationObjectIds); const netIds: number[] = []; const layers: LayerId[] = []; const globalDomains = new Set<keyof ProjectRevision["domainRevisions"]>();
  for (const operation of operations) {
    if (operation.kind === "add_track") { netIds.push(operation.track.netId); layers.push(operation.track.layer); } else if (operation.kind === "add_via") { netIds.push(operation.via.netId); layers.push(...operation.via.layers); } else if (operation.kind === "add_zone") { netIds.push(operation.zone.netId); layers.push(operation.zone.layer); }
    if (operation.kind === "update_board_outline") globalDomains.add("boardGeometry"); if (operation.kind === "update_routing_preferences") globalDomains.add("copperTopology"); if (operation.kind === "update_net") { globalDomains.add("electricalIntent"); netIds.push(operation.netId); } if (operation.kind === "pin_asset" || operation.kind === "remove_pinned_asset") globalDomains.add("assets");
    if (operation.kind.startsWith("schematic_")) globalDomains.add("schematic");
  }
  return { objectIds: [...new Set(objectIds)].sort(), netIds: [...new Set(netIds)].sort((a, b) => a - b), layers: [...new Set(layers)].sort(), boundsByLayer: {}, globalDomains: [...globalDomains].sort() };
}

export function createEngineeringTransaction(input: Omit<EngineeringTransaction, "schemaVersion" | "deterministicDigest" | "declaredMutationScope"> & { declaredMutationScope?: DeclaredMutationScope }): EngineeringTransaction {
  const cleanInput = Object.fromEntries(Object.entries(input).filter(([key]) => key !== "schemaVersion" && key !== "deterministicDigest")) as typeof input;
  const base = { schemaVersion: "sirkit.engineering-transaction.v1" as const, ...cleanInput, operations: structuredClone(input.operations), declaredMutationScope: input.declaredMutationScope ?? declaredScopeForOperations(input.operations), approvals: structuredClone(input.approvals), provenance: structuredClone(input.provenance) };
  return { ...base, deterministicDigest: engineeringDigest(base) };
}

export function validateTransactionEnvelope(transaction: EngineeringTransaction): string[] {
  const errors: string[] = []; if (transaction.schemaVersion !== "sirkit.engineering-transaction.v1") errors.push("UNSUPPORTED_TRANSACTION_SCHEMA");
  if (!transaction.transactionId || !transaction.clientOperationId || !transaction.reason.trim()) errors.push("TRANSACTION_ID_REASON_REQUIRED"); if (!transaction.operations.length) errors.push("OPERATIONS_REQUIRED");
  if (engineeringDigest(omitKey(transaction as unknown as Record<string, unknown>, "deterministicDigest")) !== transaction.deterministicDigest) errors.push("TRANSACTION_DIGEST_MISMATCH");
  if (new Set(transaction.operations.map((operation) => operation.operationId)).size !== transaction.operations.length) errors.push("DUPLICATE_OPERATION_ID");
  return errors;
}

export interface TransactionServiceOptions {
  store?: AtomicProjectStore;
  buildId: string;
  serverMode?: boolean;
  validateCandidate?: (before: CanonicalProjectState, after: CanonicalProjectState, transaction: EngineeringTransaction) => string[] | Promise<string[]>;
}

export class EngineeringTransactionService {
  private project: CanonicalProjectState;
  private revision: ProjectRevision;
  private records: DurableTransactionRecord[];
  private readonly graph = new DerivedDependencyGraph();
  private readonly subscribers = new Set<(outcome: Extract<TransactionOutcome, { state: "accepted" | "duplicate" | "rebased" }>) => void>();
  private constructor(project: CanonicalProjectState, revision: ProjectRevision, records: DurableTransactionRecord[], private readonly options: Required<Pick<TransactionServiceOptions, "buildId" | "serverMode">> & TransactionServiceOptions, private readonly store: AtomicProjectStore) { this.project = project; this.revision = revision; this.records = records; }

  static async open(initial: CanonicalProjectState, options: TransactionServiceOptions): Promise<EngineeringTransactionService> {
    const store = options.store ?? new InMemoryAtomicProjectStore(); const initialRevision = computeProjectRevision(initial); const persisted = await store.load(initial.projectId, initial.branchId) ?? await store.initialize(initial, initialRevision, options.buildId);
    if (persisted.snapshotRevision.canonicalStateDigest !== computeProjectRevision(persisted.canonicalSnapshot, persisted.snapshotRevision.headSequence, persisted.snapshotRevision.headTransactionId).canonicalStateDigest) throw new Error("PERSISTED_REVISION_STATE_MISMATCH");
    return new EngineeringTransactionService(structuredClone(persisted.canonicalSnapshot), structuredClone(persisted.snapshotRevision), structuredClone(persisted.transactionLog), { ...options, serverMode: options.serverMode ?? false }, store);
  }

  currentProject(): CanonicalProjectState { return structuredClone(this.project); }
  currentRevision(): ProjectRevision { return structuredClone(this.revision); }
  durableRecords(): DurableTransactionRecord[] { return structuredClone(this.records); }
  derivedArtifacts() { return this.graph.list(); }
  subscribe(callback: (outcome: Extract<TransactionOutcome, { state: "accepted" | "duplicate" | "rebased" }>) => void): () => void { this.subscribers.add(callback); return () => this.subscribers.delete(callback); }

  async submit(transaction: EngineeringTransaction, context?: { safelyRebasedFrom?: ProjectRevision }): Promise<TransactionOutcome> {
    const envelopeErrors = validateTransactionEnvelope(transaction); if (transaction.projectId !== this.project.projectId || transaction.branchId !== this.project.branchId) envelopeErrors.push("PROJECT_BRANCH_SCOPE_MISMATCH");
    const duplicate = this.records.find((record) => record.transaction.clientOperationId === transaction.clientOperationId); if (duplicate?.resultingRevision && duplicate.appliedChangeSet) return this.acceptedOutcome("duplicate", duplicate);
    const authorization = authorizeOperations(transaction.actor, transaction.operations); if (!authorization.allowed) return { state: "rejected_unauthorized", diagnostics: [authorization.reason], revision: this.currentRevision(), acknowledgement: { ...EMPTY_ACK } };
    if (envelopeErrors.length) return { state: "rejected_invalid", diagnostics: envelopeErrors, revision: this.currentRevision(), acknowledgement: { ...EMPTY_ACK } };
    if (!revisionMatches(transaction.baseRevision, this.revision)) return { state: "rejected_stale", diagnostics: ["BASE_REVISION_MISMATCH"], revision: this.currentRevision(), acknowledgement: { ...EMPTY_ACK } };
    let applied; try { applied = applyEngineeringOperations(this.project, transaction.operations); } catch (error) { return { state: "rejected_invalid", diagnostics: [error instanceof Error ? error.message : String(error)], revision: this.currentRevision(), acknowledgement: { ...EMPTY_ACK } }; }
    const changeSet = deriveEngineeringChangeSet(this.project, applied.project, this.revision, transaction.transactionId); const diagnostics = changeSetRevisionAudit(changeSet);
    const actualObjectIds = new Set(changeSet.beforeAfterObjectVersions.map((item) => item.objectId)); const declared = new Set(transaction.declaredMutationScope.objectIds); for (const id of actualObjectIds) if (!declared.has(id) && !id.startsWith("zone:")) diagnostics.push(`DECLARED_SCOPE_MISSING_OBJECT:${id}`);
    if (changeSet.baseRevision.canonicalStateDigest === changeSet.resultRevision.canonicalStateDigest) diagnostics.push("NO_OP_TRANSACTION");
    if (this.options.validateCandidate) diagnostics.push(...await this.options.validateCandidate(this.project, applied.project, transaction));
    if (diagnostics.length) return { state: "rejected_invalid", diagnostics: [...new Set(diagnostics)].sort(), revision: this.currentRevision(), acknowledgement: { ...EMPTY_ACK } };
    const record = nextDurableRecord({ schemaVersion: "sirkit.durable-transaction-record.v1", serverSequence: this.revision.headSequence + 1, transaction: structuredClone(transaction), authorizationDecision: authorization, validationDecision: { valid: true, diagnostics: [] }, conflictDecision: context?.safelyRebasedFrom ? { state: "rebased", reason: `Safely rebased from sequence ${context.safelyRebasedFrom.headSequence}.` } : { state: "none" }, appliedChangeSet: changeSet, resultingRevision: changeSet.resultRevision, inverseOperations: applied.inverseOperations, previousRecordDigest: this.records.at(-1)?.integrityDigest, status: "accepted" });
    try { await this.store.commit({ expectedHeadSequence: this.revision.headSequence, project: applied.project, revision: changeSet.resultRevision, record, buildId: this.options.buildId }); }
    catch (error) {
      const recovered = await this.store.load(this.project.projectId, this.project.branchId); const durable = recovered?.transactionLog.find((candidate) => candidate.transaction.clientOperationId === transaction.clientOperationId);
      if (!recovered || !durable?.resultingRevision || !durable.appliedChangeSet) return { state: "persistence_failed", diagnostics: [error instanceof Error ? error.message : String(error)], revision: this.currentRevision(), acknowledgement: { ...EMPTY_ACK } };
      this.project = structuredClone(recovered.canonicalSnapshot); this.revision = structuredClone(recovered.snapshotRevision); this.records = structuredClone(recovered.transactionLog); this.graph.invalidate(durable.appliedChangeSet); return this.acceptedOutcome("duplicate", durable);
    }
    // Persistence is durable before publication; invalidation is synchronous before subscribers see the new head.
    this.graph.invalidate(changeSet); this.project = applied.project; this.revision = changeSet.resultRevision; this.records.push(record); const outcome = this.acceptedOutcome(context?.safelyRebasedFrom ? "rebased" : "accepted", record); for (const subscriber of this.subscribers) subscriber(outcome); return outcome;
  }

  private acceptedOutcome(state: "accepted" | "duplicate" | "rebased", record: DurableTransactionRecord): Extract<TransactionOutcome, { state: "accepted" | "duplicate" | "rebased" }> {
    return { state, record: structuredClone(record), project: this.currentProject(), revision: this.currentRevision(), derivedArtifacts: this.graph.list(), acknowledgement: { preview: false, acceptedLocally: true, durableLocal: true, acceptedServer: this.options.serverMode, durableServer: this.options.serverMode, synchronizedToHead: true, verifiedAtHead: false } };
  }

  /** Readiness remains unavailable while any required artifact is pending/stale/diverged. */
  verificationState(): "current" | "pending" | "diverged" {
    const artifacts = this.graph.list(); if (artifacts.some((item) => item.status === "divergence_detected")) return "diverged"; return artifacts.some((item) => item.status !== "current") ? "pending" : "current";
  }

  unsafeTestEnvelope() { return createPersistenceEnvelope({ project: this.project, revision: this.revision, transactionLog: this.records, buildId: this.options.buildId }); }
}
