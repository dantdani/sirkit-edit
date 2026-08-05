import { createEngineeringTransaction, EngineeringTransactionService } from "./transaction-service";
import { engineeringId } from "./stable";
import type { DurableTransactionRecord, EngineeringActor, EngineeringChangeSet, EngineeringConflict, EngineeringOperation, EngineeringProposal, EngineeringTransaction, ProjectRevision, TransactionOutcome } from "./types";

function intersection<T>(left: readonly T[], right: readonly T[]): T[] { const set = new Set(right); return [...new Set(left.filter((item) => set.has(item)))]; }
function operationDeletes(operation: EngineeringOperation): boolean { return operation.kind === "remove_track" || operation.kind === "remove_via" || operation.kind === "remove_zone" || operation.kind === "remove_pinned_asset"; }

export function conflictForTransaction(input: { transaction: EngineeringTransaction; head: ProjectRevision; intervening: readonly DurableTransactionRecord[] }): EngineeringConflict | null {
  const priorChanges = input.intervening.flatMap((record) => record.appliedChangeSet ? [record.appliedChangeSet] : []); const incomingIds = input.transaction.declaredMutationScope.objectIds; const priorIds = [...new Set(priorChanges.flatMap((change) => change.beforeAfterObjectVersions.map((item) => item.objectId)))]; const objectOverlap = intersection(incomingIds, priorIds);
  let conflictClass: EngineeringConflict["conflictClass"] | null = null; let impact = "";
  if (objectOverlap.length) {
    const priorDeleteIds = new Set(priorChanges.flatMap((change) => Object.entries(change.deletedIdsByKind).flatMap(([kind, ids]) => ids.map((id) => `${kind}:${id}`)))); conflictClass = input.transaction.operations.some(operationDeletes) || objectOverlap.some((id) => priorDeleteIds.has(id)) ? "edit_vs_delete" : "same_field"; impact = "Concurrent transactions target the same stable engineering object.";
  } else if (input.transaction.declaredMutationScope.globalDomains.length || priorChanges.some((change) => change.semanticImpactFlags.some((flag) => flag === "manufacturing_capability_changed" || flag === "constraint_program_changed" || flag === "asset_revision_changed"))) { conflictClass = input.transaction.operations.some((operation) => operation.kind === "update_board_outline") ? "outline_stackup_vs_physical" : input.transaction.operations.some((operation) => operation.kind === "pin_asset" || operation.kind === "remove_pinned_asset") ? "asset_upgrade_vs_dependent" : "unknown_interaction"; impact = "A project-wide semantic domain changed and independence is not proven."; }
  else {
    const priorNets = [...new Set(priorChanges.flatMap((change) => change.affectedNetIds))]; const netOverlap = intersection(input.transaction.declaredMutationScope.netIds, priorNets); if (netOverlap.length) { conflictClass = "net_vs_routing"; impact = `Concurrent work intersects net(s) ${netOverlap.join(", ")}.`; }
  }
  // Different IDs are not enough for arbitrary copper. Without declared spatial bounds, remain conservative.
  const hasCopper = input.transaction.operations.some((operation) => /track|via|zone/.test(operation.kind)); const priorPhysical = priorChanges.some((change) => change.semanticImpactFlags.some((flag) => flag === "physical_contact_geometry_changed" || flag === "route_topology_changed")); if (!conflictClass && hasCopper && priorPhysical && Object.keys(input.transaction.declaredMutationScope.boundsByLayer).length === 0) { conflictClass = "unknown_interaction"; impact = "Concurrent physical edits lack sufficient spatial scope to prove independence."; }
  if (!conflictClass) return null;
  return { conflictId: engineeringId("conflict", { incoming: input.transaction.transactionId, head: input.head.canonicalStateDigest, conflictClass, objects: objectOverlap }), projectId: input.transaction.projectId, targetHeadRevision: structuredClone(input.head), incomingTransactionId: input.transaction.transactionId, conflictClass, involvedObjectIds: objectOverlap, involvedTransactionIds: input.intervening.map((record) => record.transaction.transactionId), baseValues: [], headValues: [], proposedValues: [], engineeringImpact: impact, allowedResolutions: ["keep_head", "manual_operation", "proposal_branch", "reject", ...(conflictClass === "unknown_interaction" ? ["rerun_candidate" as const] : [])], status: "open" };
}

export class AuthoritativeCollaborationSession {
  private conflicts = new Map<string, EngineeringConflict>();
  private proposals = new Map<string, EngineeringProposal>();
  constructor(private readonly service: EngineeringTransactionService) {}

  async submit(transaction: EngineeringTransaction): Promise<TransactionOutcome> {
    if (this.service.durableRecords().some((record) => record.transaction.clientOperationId === transaction.clientOperationId)) return this.service.submit(transaction);
    const head = this.service.currentRevision(); if (transaction.baseRevision.headSequence === head.headSequence && transaction.baseRevision.canonicalStateDigest === head.canonicalStateDigest) return this.service.submit(transaction);
    const intervening = this.service.durableRecords().filter((record) => record.serverSequence > transaction.baseRevision.headSequence); const conflict = conflictForTransaction({ transaction, head, intervening }); if (conflict) { this.conflicts.set(conflict.conflictId, conflict); return { state: "conflict", conflict: structuredClone(conflict), revision: head, acknowledgement: { preview: false, acceptedLocally: false, durableLocal: false, acceptedServer: false, durableServer: false, synchronizedToHead: false, verifiedAtHead: false } }; }
    const rebased = createEngineeringTransaction({ ...transaction, transactionId: engineeringId("transaction:rebase", { original: transaction.transactionId, head: head.canonicalStateDigest }), baseRevision: head, receivedAtServer: new Date().toISOString() }); return this.service.submit(rebased, { safelyRebasedFrom: transaction.baseRevision });
  }

  createProposal(input: { creator: EngineeringActor; purpose: string; transactions: EngineeringTransaction[] }): EngineeringProposal {
    const base = input.transactions[0]?.baseRevision ?? this.service.currentRevision(); const proposal: EngineeringProposal = { proposalId: engineeringId("proposal", { project: base.projectId, creator: input.creator.actorId, purpose: input.purpose, transactions: input.transactions.map((item) => item.deterministicDigest) }), projectId: base.projectId, baseRevision: structuredClone(base), branchId: `proposal:${base.branchId}`, creator: structuredClone(input.creator), purpose: input.purpose, transactions: structuredClone(input.transactions), semanticDiff: [], verificationReport: { state: "pending", evidenceRefs: [] }, conflicts: [], approvals: [], status: "draft" }; this.proposals.set(proposal.proposalId, proposal); return structuredClone(proposal);
  }

  reviewProposal(proposalId: string, actor: EngineeringActor, decision: "approve" | "reject"): EngineeringProposal {
    const proposal = this.proposals.get(proposalId); if (!proposal) throw new Error("PROPOSAL_NOT_FOUND"); if (actor.role !== "reviewer" && actor.role !== "project_admin") throw new Error("PROPOSAL_REVIEW_UNAUTHORIZED"); if (decision === "reject") proposal.status = "rejected"; else { proposal.approvals.push({ approvalId: engineeringId("approval", { proposalId, actor: actor.actorId }), actorId: actor.actorId, capability: "approve_proposal" }); proposal.status = "approved"; } return structuredClone(proposal);
  }

  async undoLastActorTransaction(actor: EngineeringActor, clientOperationId: string): Promise<TransactionOutcome> {
    const records = this.service.durableRecords(); const target = [...records].reverse().find((record) => record.status === "accepted" && record.transaction.actor.actorId === actor.actorId && record.inverseOperations.length); if (!target?.appliedChangeSet) return { state: "rejected_invalid", diagnostics: ["NO_UNDOABLE_TRANSACTION"], revision: this.service.currentRevision(), acknowledgement: { preview: false, acceptedLocally: false, durableLocal: false, acceptedServer: false, durableServer: false, synchronizedToHead: false, verifiedAtHead: false } };
    const targetObjects = new Set(target.appliedChangeSet.beforeAfterObjectVersions.map((item) => item.objectId)); const dependent = records.filter((record) => record.serverSequence > target.serverSequence).find((record) => record.appliedChangeSet?.beforeAfterObjectVersions.some((item) => targetObjects.has(item.objectId)));
    if (dependent) { const conflict = conflictForUndo(target, dependent, this.service.currentRevision()); this.conflicts.set(conflict.conflictId, conflict); return { state: "conflict", conflict, revision: this.service.currentRevision(), acknowledgement: { preview: false, acceptedLocally: false, durableLocal: false, acceptedServer: false, durableServer: false, synchronizedToHead: false, verifiedAtHead: false } }; }
    const transaction = createEngineeringTransaction({ transactionId: engineeringId("transaction:undo", { target: target.transaction.transactionId, head: this.service.currentRevision().canonicalStateDigest }), projectId: target.transaction.projectId, branchId: target.transaction.branchId, clientOperationId, actor, reason: `Undo ${target.transaction.reason}`, baseRevision: this.service.currentRevision(), operations: target.inverseOperations.map((operation, index) => ({ ...operation, operationId: `undo:${target.transaction.transactionId}:${index}` })), approvals: [], provenance: { source: "collaboration", candidateId: target.transaction.transactionId }, createdAtClient: new Date().toISOString() }); return this.service.submit(transaction);
  }

  listConflicts(): EngineeringConflict[] { return [...this.conflicts.values()].map((item) => structuredClone(item)); }
  listProposals(): EngineeringProposal[] { return [...this.proposals.values()].map((item) => structuredClone(item)); }
}

function conflictForUndo(target: DurableTransactionRecord, dependent: DurableTransactionRecord, head: ProjectRevision): EngineeringConflict {
  const targetIds = target.appliedChangeSet?.beforeAfterObjectVersions.map((item) => item.objectId) ?? []; const dependentIds = dependent.appliedChangeSet?.beforeAfterObjectVersions.map((item) => item.objectId) ?? []; const objects = intersection(targetIds, dependentIds);
  return { conflictId: engineeringId("conflict:undo", { target: target.transaction.transactionId, dependent: dependent.transaction.transactionId, head: head.canonicalStateDigest }), projectId: target.transaction.projectId, targetHeadRevision: structuredClone(head), incomingTransactionId: `undo:${target.transaction.transactionId}`, conflictClass: "unknown_interaction", involvedObjectIds: objects, involvedTransactionIds: [target.transaction.transactionId, dependent.transaction.transactionId], baseValues: [], headValues: [], proposedValues: [], engineeringImpact: "Undo would alter objects used by a later collaborator transaction.", allowedResolutions: ["keep_head", "manual_operation", "proposal_branch", "reject"], status: "open" };
}

export function changeSetsSemanticallyIndependent(left: EngineeringChangeSet, right: EngineeringChangeSet): boolean {
  const leftIds = left.beforeAfterObjectVersions.map((item) => item.objectId); const rightIds = right.beforeAfterObjectVersions.map((item) => item.objectId); if (intersection(leftIds, rightIds).length) return false; if (intersection(left.affectedNetIds, right.affectedNetIds).length) return false;
  const broad = new Set(["constraint_program_changed", "manufacturing_capability_changed", "asset_revision_changed"]); return !left.semanticImpactFlags.some((flag) => broad.has(flag)) && !right.semanticImpactFlags.some((flag) => broad.has(flag));
}
