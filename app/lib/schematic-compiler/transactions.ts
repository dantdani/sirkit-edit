import { validateSchematicGraph } from "./graph";
import { finalizeSchematicProjectState, validateSchematicProjectState } from "./project";
import { schematicDigest, schematicId } from "./stable";
import { SCHEMATIC_TRANSACTION_SCHEMA_VERSION } from "./types";
import type { EngineeringActor } from "../engineering/types";
import type { SchematicOperation, SchematicProjectState, SchematicTransaction, SchematicTransactionRecord } from "./types";

function transactionRecord(transaction: SchematicTransaction, state: SchematicTransactionRecord["state"], diagnostics: string[], resultStateDigest?: string): SchematicTransactionRecord { const base = { transaction: structuredClone(transaction), state, diagnostics: [...new Set(diagnostics)].sort(), resultStateDigest }; return { ...base, integrityDigest: schematicDigest(base) }; }
function authorized(actor: EngineeringActor, operation: SchematicOperation): boolean {
  if (actor.actorKind === "ai") return false;
  if (operation.kind === "approve_candidate") return actor.actorKind === "human" && ["reviewer", "project_admin"].includes(actor.role);
  if (operation.kind === "invalidate_candidate") return actor.actorKind === "human" && actor.role === "project_admin";
  return ["pcb_editor", "project_admin"].includes(actor.role) && ["human", "import_adapter", "automated_engine"].includes(actor.actorKind);
}

export function createSchematicTransaction(input: Omit<SchematicTransaction, "schemaVersion" | "transactionId" | "deterministicDigest">): SchematicTransaction {
  if (!input.reason.trim() || !input.idempotencyKey.trim() || !input.operations.length || new Set(input.operations.map((item) => item.operationId)).size !== input.operations.length) throw new Error("CD8_TRANSACTION_INPUT_INVALID");
  const base = { schemaVersion: SCHEMATIC_TRANSACTION_SCHEMA_VERSION, ...structuredClone(input), reason: input.reason.trim(), idempotencyKey: input.idempotencyKey.trim() };
  const withId = { ...base, transactionId: schematicId("schematic-transaction", base) };
  return { ...withId, deterministicDigest: schematicDigest(withId) };
}

export function applySchematicTransaction(state: SchematicProjectState, transaction: SchematicTransaction): { state: SchematicProjectState; record: SchematicTransactionRecord } {
  const duplicate = state.transactionRecords.find((item) => item.transaction.idempotencyKey === transaction.idempotencyKey);
  if (duplicate) return { state, record: duplicate };
  const initialErrors = validateSchematicProjectState(state);
  const integrity = transaction.schemaVersion === SCHEMATIC_TRANSACTION_SCHEMA_VERSION && transaction.deterministicDigest === schematicDigest({ ...transaction, deterministicDigest: undefined });
  const scoped = transaction.projectId === state.projectId && transaction.branchId === state.branchId;
  const baseMatches = transaction.baseStateDigest === state.deterministicDigest;
  if (initialErrors.length || !integrity || !scoped || !baseMatches || transaction.operations.some((item) => !authorized(transaction.actor, item))) {
    const diagnostics = [...initialErrors, ...(!integrity ? ["CD8_TRANSACTION_DIGEST_INVALID"] : []), ...(!scoped ? ["CD8_TRANSACTION_SCOPE_MISMATCH"] : []), ...(!baseMatches ? ["CD8_TRANSACTION_STALE_BASE"] : []), ...(transaction.operations.some((item) => !authorized(transaction.actor, item)) ? ["CD8_TRANSACTION_UNAUTHORIZED"] : [])];
    const record = transactionRecord(transaction, !baseMatches ? "conflict" : "rejected", diagnostics);
    const rejected = structuredClone(state); rejected.transactionRecords.push(record);
    return { state: finalizeSchematicProjectState(rejected), record };
  }
  try {
    const draft = structuredClone(state);
    for (const operation of transaction.operations) {
      if (operation.kind === "add_graph") {
        if (operation.graph.projectId !== state.projectId || !validateSchematicGraph(operation.graph).valid || draft.graphs.some((item) => item.graphId === operation.graph.graphId)) throw new Error("CD8_OPERATION_GRAPH_INVALID");
        draft.graphs.push(structuredClone(operation.graph));
      } else if (operation.kind === "add_candidate_bundle") {
        if (!validateSchematicGraph(operation.graph).valid || operation.candidate.semanticGraphDigest !== operation.graph.deterministicDigest || operation.candidate.structuralCompletenessReportId !== operation.completenessReport.reportId || operation.candidate.pcbSynchronizationContractId !== operation.syncContract.contractId || operation.candidate.roundTripCertificateId !== operation.roundTripCertificate?.certificateId || operation.candidate.kicadArtifactManifestId !== operation.artifactManifest?.manifestId || operation.completenessReport.readinessState !== "ready_for_review" || operation.roundTripCertificate?.certificateState !== "semantically_equivalent" || operation.artifactManifest?.publicationState !== "validated") throw new Error("CD8_OPERATION_CANDIDATE_BUNDLE_INVALID");
        draft.graphs.push(structuredClone(operation.graph)); draft.diagrams.push(...structuredClone(operation.diagrams)); if (operation.artifactManifest) draft.artifactManifests.push(structuredClone(operation.artifactManifest)); if (operation.roundTripCertificate) draft.roundTripCertificates.push(structuredClone(operation.roundTripCertificate)); draft.completenessReports.push(structuredClone(operation.completenessReport)); if (operation.diff) draft.diffs.push(structuredClone(operation.diff)); draft.syncContracts.push(structuredClone(operation.syncContract)); draft.candidates.push(structuredClone(operation.candidate));
      } else if (operation.kind === "approve_candidate") {
        const candidate = draft.candidates.find((item) => item.candidateId === operation.decision.candidateId && item.deterministicDigest === operation.decision.candidateDigest), certificate = draft.roundTripCertificates.find((item) => item.deterministicDigest === operation.decision.roundTripCertificateDigest);
        if (!candidate || !certificate || certificate.certificateState !== "semantically_equivalent" || operation.decision.state !== "approved" || operation.decision.approver?.actorId !== transaction.actor.actorId) throw new Error("CD8_OPERATION_APPROVAL_INVALID");
        candidate.approvalState = "approved"; candidate.lifecycleState = "approved_for_CD9"; candidate.deterministicDigest = schematicDigest({ ...candidate, deterministicDigest: undefined }); draft.decision = structuredClone(operation.decision);
      } else {
        const candidate = draft.candidates.find((item) => item.candidateId === operation.candidateId && item.deterministicDigest === operation.expectedDigest);
        if (!candidate || !operation.reason.trim() || !operation.dependencyRefs.length) throw new Error("CD8_OPERATION_INVALIDATION_INVALID");
        candidate.lifecycleState = "invalidated"; candidate.approvalState = "rejected"; candidate.unresolvedDiagnosticIds = [...new Set([...candidate.unresolvedDiagnosticIds, ...operation.dependencyRefs])].sort(); candidate.deterministicDigest = schematicDigest({ ...candidate, deterministicDigest: undefined }); if (draft.decision?.candidateId === candidate.candidateId) draft.decision = null;
      }
    }
    const provisional = finalizeSchematicProjectState(draft), errors = validateSchematicProjectState(provisional);
    if (errors.length) throw new Error(`CD8_TRANSACTION_RESULT_INVALID:${errors.join(",")}`);
    const record = transactionRecord(transaction, "accepted", [], provisional.deterministicDigest); provisional.transactionRecords.push(record);
    return { state: finalizeSchematicProjectState(provisional), record };
  } catch (error) {
    const record = transactionRecord(transaction, "rejected", [error instanceof Error ? error.message : String(error)]), rejected = structuredClone(state); rejected.transactionRecords.push(record);
    return { state: finalizeSchematicProjectState(rejected), record };
  }
}
