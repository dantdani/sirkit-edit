import { transitionAssumption } from "./assumptions";
import { compileRequirementsPackage } from "./compiler";
import { requirementsDigest, requirementsId } from "./stable";
import type {
  DesignRequirementsPackage,
  ExtractionCandidate,
  RequirementApproval,
  RequirementsCompileInput,
  RequirementsCompileResult,
  RequirementsOperation,
  RequirementsTransaction,
  RequirementsTransactionConflict,
  RequirementsTransactionRecord,
} from "./types";
import { REQUIREMENTS_TRANSACTION_SCHEMA_VERSION } from "./types";

const AI_ALLOWED = new Set<RequirementsOperation["kind"]>(["add_requirement_candidate", "update_requirement_candidate", "add_assumption", "update_verification_obligation"]);
const REVIEWER_ALLOWED = new Set<RequirementsOperation["kind"]>(["accept_assumption", "reject_assumption", "resolve_conflict", "reopen_conflict", "approve_package", "revoke_package_approval", "approve_constraint_proposal"]);

function operationTargets(operation: RequirementsOperation): string[] {
  if (operation.kind === "add_requirement_candidate") return [`candidate:${operation.candidate.candidateId}`, `lineage:${operation.candidate.lineageKey}`];
  if (operation.kind === "update_requirement_candidate") return [`requirement:${operation.requirementId}`];
  if (operation.kind === "supersede_requirement" || operation.kind === "reject_requirement") return [`requirement:${operation.requirementId}`];
  if (operation.kind === "add_assumption") return [`assumption:${operation.assumption.assumptionId}`];
  if (operation.kind === "accept_assumption" || operation.kind === "reject_assumption" || operation.kind === "expire_assumption") return [`assumption:${operation.assumptionId}`];
  if (operation.kind === "apply_default" || operation.kind === "remove_default") return [`default:${operation.defaultId}`];
  if (operation.kind === "answer_question" || operation.kind === "reopen_question") return [`question:${operation.questionId}`];
  if (operation.kind === "resolve_conflict" || operation.kind === "reopen_conflict") return [`conflict:${operation.conflictId}`];
  if (operation.kind === "select_capability_profile") return ["capability-profile-selection"];
  if (operation.kind === "approve_package" || operation.kind === "revoke_package_approval") return [`package-approval:${operation.approval.targetId}`];
  if (operation.kind === "publish_package_revision") return ["package-publication"];
  if (operation.kind === "attach_source_revision" || operation.kind === "detach_source_revision") return [`source:${operation.sourceId}@${operation.sourceVersion}`];
  if (operation.kind === "approve_constraint_proposal") return [`constraint-proposal:${operation.proposalId}`];
  if (operation.kind === "update_verification_obligation") return [`verification-obligation:${operation.obligation.obligationId}`];
  return [`operation:${operation.kind}`];
}

export function createRequirementsTransaction(input: Omit<RequirementsTransaction, "schemaVersion" | "deterministicDigest">): RequirementsTransaction {
  const base = { schemaVersion: REQUIREMENTS_TRANSACTION_SCHEMA_VERSION, ...structuredClone(input) };
  return { ...base, deterministicDigest: requirementsDigest(base) };
}

export function validateRequirementsTransaction(transaction: RequirementsTransaction): string[] {
  const errors: string[] = [];
  if (transaction.schemaVersion !== REQUIREMENTS_TRANSACTION_SCHEMA_VERSION) errors.push("UNSUPPORTED_REQUIREMENTS_TRANSACTION_SCHEMA");
  if (!transaction.transactionId || !transaction.projectId || !transaction.branchId || !transaction.reason.trim() || !transaction.operations.length) errors.push("REQUIREMENTS_TRANSACTION_ID_REASON_OPERATIONS_REQUIRED");
  if (requirementsDigest({ ...transaction, deterministicDigest: undefined }) !== transaction.deterministicDigest) errors.push("REQUIREMENTS_TRANSACTION_DIGEST_MISMATCH");
  if (!Number.isInteger(transaction.basePackageRevision) || transaction.basePackageRevision < 0) errors.push("REQUIREMENTS_BASE_REVISION_INVALID");
  if (transaction.actor.actorKind === "ai" && transaction.operations.some((item) => !AI_ALLOWED.has(item.kind))) errors.push("AI_REQUIREMENTS_OPERATION_FORBIDDEN");
  if (transaction.actor.role === "viewer" || transaction.actor.role === "commenter") errors.push("REQUIREMENTS_EDIT_UNAUTHORIZED");
  if (transaction.actor.role === "reviewer" && transaction.operations.some((item) => !REVIEWER_ALLOWED.has(item.kind))) errors.push("REVIEWER_REQUIREMENTS_OPERATION_FORBIDDEN");
  if (transaction.operations.some((item) => (item.kind === "approve_package" || item.kind === "revoke_package_approval" || item.kind === "approve_constraint_proposal") && item.approval.actorKind === "ai")) errors.push("AI_APPROVAL_FORBIDDEN");
  return [...new Set(errors)].sort();
}

function findCandidate(input: RequirementsCompileInput, predicate: (candidate: ExtractionCandidate) => boolean): { envelopeIndex: number; candidateIndex: number; candidate: ExtractionCandidate } | undefined {
  for (let envelopeIndex = 0; envelopeIndex < input.extractionEnvelopes.length; envelopeIndex++) {
    const candidateIndex = input.extractionEnvelopes[envelopeIndex].candidates.findIndex(predicate);
    if (candidateIndex >= 0) return { envelopeIndex, candidateIndex, candidate: input.extractionEnvelopes[envelopeIndex].candidates[candidateIndex] };
  }
  return undefined;
}

function addApproval(approvals: RequirementApproval[], approval: RequirementApproval): void {
  const existing = approvals.find((item) => item.approvalId === approval.approvalId);
  if (existing && requirementsDigest(existing) !== requirementsDigest(approval)) throw new Error("APPROVAL_ID_REUSE");
  if (!existing) approvals.push(structuredClone(approval));
}

function applyOperation(input: RequirementsCompileInput, current: DesignRequirementsPackage, operation: RequirementsOperation): void {
  if (operation.kind === "add_requirement_candidate") {
    if (findCandidate(input, (item) => item.candidateId === operation.candidate.candidateId || item.lineageKey === operation.candidate.lineageKey)) throw new Error("REQUIREMENT_CANDIDATE_ID_OR_LINEAGE_REUSE");
    let envelope = input.extractionEnvelopes.find((item) => item.sourceId === operation.candidate.sourceRef.sourceId && item.sourceVersion === operation.candidate.sourceRef.sourceVersion);
    if (!envelope) { envelope = { schemaVersion: 1, sourceId: operation.candidate.sourceRef.sourceId, sourceVersion: operation.candidate.sourceRef.sourceVersion, modelRef: operation.candidate.extractionActor.modelRef, promptDigest: operation.candidate.extractionActor.promptDigest, toolSchemaDigest: operation.candidate.extractionActor.toolSchemaDigest, candidates: [] }; input.extractionEnvelopes.push(envelope); }
    envelope.candidates.push(structuredClone(operation.candidate));
  } else if (operation.kind === "update_requirement_candidate") {
    const requirement = current.requirements.find((item) => item.requirementId === operation.requirementId); if (!requirement) throw new Error("REQUIREMENT_NOT_FOUND"); if (requirement.revision !== operation.expectedRevision) throw new Error("REQUIREMENT_REVISION_MISMATCH");
    const found = findCandidate(input, (item) => requirementsId("requirement", { projectId: input.projectId, lineageKey: item.lineageKey }) === operation.requirementId); if (!found) throw new Error("REQUIREMENT_CANDIDATE_NOT_FOUND");
    input.extractionEnvelopes[found.envelopeIndex].candidates.splice(found.candidateIndex, 1);
    let envelope = input.extractionEnvelopes.find((item) => item.sourceId === operation.candidate.sourceRef.sourceId && item.sourceVersion === operation.candidate.sourceRef.sourceVersion); if (!envelope) { envelope = { schemaVersion: 1, sourceId: operation.candidate.sourceRef.sourceId, sourceVersion: operation.candidate.sourceRef.sourceVersion, candidates: [] }; input.extractionEnvelopes.push(envelope); } envelope.candidates.push(structuredClone(operation.candidate));
  } else if (operation.kind === "add_assumption") {
    if (input.assumptions.some((item) => item.assumptionId === operation.assumption.assumptionId)) throw new Error("ASSUMPTION_ID_REUSE");
    if (operation.assumption.status !== "proposed_hypothesis" && operation.assumption.status !== "awaiting_confirmation") throw new Error("NEW_ASSUMPTION_MUST_BE_PROPOSED");
    input.assumptions.push(structuredClone(operation.assumption));
  } else if (operation.kind === "accept_assumption" || operation.kind === "reject_assumption" || operation.kind === "expire_assumption") {
    const index = input.assumptions.findIndex((item) => item.assumptionId === operation.assumptionId); if (index < 0) throw new Error("ASSUMPTION_NOT_FOUND"); if (input.assumptions[index].revision !== operation.expectedRevision) throw new Error("ASSUMPTION_REVISION_MISMATCH");
    const approval = operation.kind === "accept_assumption" ? input.approvals.find((item) => item.approvalId === operation.approvalId) : undefined;
    input.assumptions[index] = transitionAssumption({ assumption: input.assumptions[index], action: operation.kind === "accept_assumption" ? "accept" : operation.kind === "reject_assumption" ? "reject" : "expire", ...(approval ? { approval } : {}), ...(operation.kind === "accept_assumption" ? {} : { reason: operation.reason }) });
  } else if (operation.kind === "remove_default") input.defaultsApplied = input.defaultsApplied.filter((item) => item.defaultId !== operation.defaultId);
  else if (operation.kind === "apply_default") { const item = input.defaultsApplied.find((candidate) => candidate.defaultId === operation.defaultId); if (!item) throw new Error("DEFAULT_DEFINITION_REQUIRED"); item.status = "applied"; }
  else if (operation.kind === "select_capability_profile") input.selectedCapabilityProfileRefs = [...new Set([...input.selectedCapabilityProfileRefs, operation.profileRef])].sort();
  else if (operation.kind === "approve_package" || operation.kind === "approve_constraint_proposal") addApproval(input.approvals, operation.approval);
  else if (operation.kind === "revoke_package_approval") addApproval(input.approvals, { ...operation.approval, decision: "revoked" });
  else if (operation.kind === "detach_source_revision") { input.sourceArtifacts = input.sourceArtifacts.filter((item) => !(item.sourceId === operation.sourceId && item.sourceVersion === operation.sourceVersion)); input.extractionEnvelopes = input.extractionEnvelopes.filter((item) => !(item.sourceId === operation.sourceId && item.sourceVersion === operation.sourceVersion)); }
  else if (operation.kind === "attach_source_revision") { if (!input.sourceArtifacts.some((item) => item.sourceId === operation.sourceId && item.sourceVersion === operation.sourceVersion)) throw new Error("PINNED_SOURCE_ARTIFACT_REQUIRED"); }
  else if (operation.kind === "publish_package_revision") { if (operation.expectedDraftDigest !== current.deterministicDigest) throw new Error("DRAFT_DIGEST_MISMATCH"); }
  else if (operation.kind === "answer_question" || operation.kind === "reopen_question" || operation.kind === "resolve_conflict" || operation.kind === "reopen_conflict") throw new Error("OPERATION_REQUIRES_STRUCTURED_REQUIREMENT_PATCH");
  else if (operation.kind === "supersede_requirement" || operation.kind === "reject_requirement") throw new Error("OPERATION_REQUIRES_DISPOSITION_COMPILER_EXTENSION");
  else if (operation.kind === "update_verification_obligation") throw new Error("VERIFICATION_OVERRIDES_REQUIRE_OWNING_STAGE_EVIDENCE_ADAPTER");
}

export type RequirementsTransactionOutcome =
  | { state: "accepted" | "rebased"; package: DesignRequirementsPackage; compile: RequirementsCompileResult & { ok: true }; record: RequirementsTransactionRecord; input: RequirementsCompileInput }
  | { state: "rejected"; diagnostics: string[] }
  | { state: "conflict"; conflict: RequirementsTransactionConflict };

export class RequirementsTransactionService {
  private records: RequirementsTransactionRecord[] = [];
  constructor(private input: RequirementsCompileInput, private current: DesignRequirementsPackage) { this.input = structuredClone(input); this.current = structuredClone(current); }

  currentPackage(): DesignRequirementsPackage { return structuredClone(this.current); }
  currentInput(): RequirementsCompileInput { return structuredClone(this.input); }
  durableRecords(): RequirementsTransactionRecord[] { return structuredClone(this.records); }

  submit(transaction: RequirementsTransaction): RequirementsTransactionOutcome {
    const errors = validateRequirementsTransaction(transaction);
    if (transaction.projectId !== this.current.projectId) errors.push("REQUIREMENTS_PROJECT_SCOPE_MISMATCH");
    const exactBase = transaction.basePackageRevision === this.current.revision && transaction.basePackageDigest === this.current.deterministicDigest;
    let rebased = false;
    if (!exactBase) {
      const incoming = new Set(transaction.operations.flatMap(operationTargets));
      const intervening = this.records.filter((record) => (record.resultPackageRevision ?? 0) > transaction.basePackageRevision).flatMap((record) => record.transaction.operations.flatMap(operationTargets));
      const overlap = [...incoming].filter((item) => intervening.includes(item));
      if (overlap.length) {
        const conflict: RequirementsTransactionConflict = { conflictId: requirementsId("requirements-transaction-conflict", { transaction: transaction.transactionId, head: this.current.deterministicDigest, overlap }), transactionId: transaction.transactionId, conflictClass: transaction.basePackageRevision !== this.current.revision ? "stale_base" : "same_requirement", involvedIds: overlap.sort(), explanation: "Concurrent semantic edits overlap; last-writer-wins is forbidden.", allowedResolutions: ["keep_head", "manual_merge", "proposal_branch", "reject"], status: "open" };
        const record: RequirementsTransactionRecord = { transaction: structuredClone(transaction), conflict, invalidatedDependencyKeys: [], status: "conflicted", integrityDigest: requirementsDigest({ transaction, conflict, previous: this.records.at(-1)?.integrityDigest }) }; this.records.push(record); return { state: "conflict", conflict };
      }
      rebased = true;
    }
    if (errors.length) return { state: "rejected", diagnostics: [...new Set(errors)].sort() };
    const candidateInput = structuredClone(this.input); candidateInput.previousPackage = structuredClone(this.current);
    try { transaction.operations.forEach((operation) => applyOperation(candidateInput, this.current, operation)); } catch (error) { return { state: "rejected", diagnostics: [error instanceof Error ? error.message : String(error)] }; }
    const compiled = compileRequirementsPackage(candidateInput); if (!compiled.ok) return { state: "rejected", diagnostics: compiled.diagnostics.map((item) => `${item.code}:${item.message}`) };
    const invalidatedDependencyKeys = [...new Set([...compiled.semanticDiff.requirementChanges.filter((item) => item.change !== "unchanged").map((item) => `requirement:${item.requirementId}`), ...compiled.semanticDiff.assumptionChanges.filter((item) => item.change !== "unchanged").map((item) => `assumption:${item.assumptionId}`), `requirements-package:${this.current.packageId}`])].sort();
    const recordBase = { transaction: structuredClone(transaction), resultPackageRevision: compiled.package.revision, resultPackageDigest: compiled.package.deterministicDigest, semanticDiff: compiled.semanticDiff, invalidatedDependencyKeys, status: "accepted" as const };
    const record = { ...recordBase, integrityDigest: requirementsDigest({ ...recordBase, previous: this.records.at(-1)?.integrityDigest }) };
    this.input = candidateInput; this.current = compiled.package; this.records.push(record);
    return { state: rebased ? "rebased" : "accepted", package: structuredClone(this.current), compile: compiled, record: structuredClone(record), input: structuredClone(this.input) };
  }
}
