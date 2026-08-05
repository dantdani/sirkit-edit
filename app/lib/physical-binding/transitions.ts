import { physicalBindingDigest, withBindingDigests, withoutBindingDigests } from "./stable";
import type { ComponentPhysicalBinding, PhysicalBindingAction, PhysicalBindingTransitionRequest } from "./types";

const EVIDENCE_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,511}$/;
const DECISION_EVIDENCE_LIMIT = 64;

function normalizeDecisionEvidenceInput(request: PhysicalBindingTransitionRequest, required = false): string[] {
  if (request.action !== "select" && request.action !== "approve") return [];
  if (!Array.isArray(request.decisionEvidenceRefs) || request.decisionEvidenceRefs.length === 0) {
    if (required) throw new Error("PB_DECISION_EVIDENCE_REQUIRED");
    return [];
  }
  if (request.decisionEvidenceRefs.length > DECISION_EVIDENCE_LIMIT || request.decisionEvidenceRefs.some((ref) => typeof ref !== "string" || !EVIDENCE_REF_PATTERN.test(ref.normalize("NFC")))) throw new Error("PB_DECISION_EVIDENCE_INVALID");
  return [...new Set(request.decisionEvidenceRefs.map((ref) => ref.normalize("NFC")))].sort();
}

export function normalizeDecisionEvidenceRefs(binding: ComponentPhysicalBinding, request: PhysicalBindingTransitionRequest): string[] {
  const normalized = normalizeDecisionEvidenceInput(request, true);
  const available = new Set(binding.evidenceRefs.map((ref) => ref.normalize("NFC")));
  if (normalized.some((ref) => !available.has(ref))) throw new Error("PB_DECISION_EVIDENCE_NOT_FOUND");
  return normalized;
}

export function physicalBindingTransitionRequestDigest(request: PhysicalBindingTransitionRequest): string {
  const decisionEvidenceRefs = normalizeDecisionEvidenceInput(request);
  return physicalBindingDigest({
    schemaVersion: request.schemaVersion,
    action: request.action,
    bindingRevisionId: request.bindingRevisionId,
    expectedSetRevision: request.expectedSetRevision,
    idempotencyKey: request.idempotencyKey,
    reason: request.reason,
    actor: request.actor,
    at: request.at,
    approvalScope: request.approvalScope,
    expiresAt: request.expiresAt,
    validation: request.validation,
    staleDependencyIds: request.staleDependencyIds,
    decisionEvidenceRefs,
  });
}

const LEGAL_LIFECYCLE: Record<PhysicalBindingAction, readonly ComponentPhysicalBinding["lifecycleState"][]> = {
  submit_candidate: ["draft"],
  select: ["candidate", "selected"],
  request_approval: ["candidate", "selected"],
  approve: ["selected"],
  reject: ["candidate", "selected"],
  revoke: ["selected"],
  mark_stale: ["candidate", "selected"],
  revalidate: ["candidate", "selected"],
  supersede: ["selected", "candidate"],
  orphan: ["candidate", "selected", "superseded"],
  withdraw: ["draft", "candidate", "selected"],
};

function authorize(request: PhysicalBindingTransitionRequest): void {
  const humanDecision = new Set<PhysicalBindingAction>(["select", "approve", "reject", "revoke", "supersede", "withdraw"]);
  if (humanDecision.has(request.action) && request.actor.actorKind !== "human") throw new Error("PB_TRANSITION_HUMAN_REQUIRED");
  if (["approve", "reject", "revoke"].includes(request.action) && !["reviewer", "project_admin"].includes(request.actor.role)) throw new Error("PB_TRANSITION_APPROVAL_UNAUTHORIZED");
  if (["select", "supersede"].includes(request.action) && !["reviewer", "project_admin"].includes(request.actor.role)) throw new Error("PB_TRANSITION_SELECTION_UNAUTHORIZED");
  if (request.action === "mark_stale" && !["automated_engine", "system_migration", "human"].includes(request.actor.actorKind)) throw new Error("PB_TRANSITION_STALE_UNAUTHORIZED");
  if (!request.reason.trim()) throw new Error("PB_TRANSITION_REASON_REQUIRED");
  if (!request.idempotencyKey.trim()) throw new Error("PB_TRANSITION_IDEMPOTENCY_REQUIRED");
  if (!Number.isFinite(Date.parse(request.at))) throw new Error("PB_TRANSITION_TIMESTAMP_INVALID");
}

export function applyPhysicalBindingTransition(binding: ComponentPhysicalBinding, request: PhysicalBindingTransitionRequest): ComponentPhysicalBinding {
  authorize(request);
  if (request.bindingRevisionId !== binding.revisionId) throw new Error("PB_TRANSITION_REVISION_MISMATCH");
  if (!LEGAL_LIFECYCLE[request.action].includes(binding.lifecycleState)) throw new Error(`PB_TRANSITION_ILLEGAL:${binding.lifecycleState}:${request.action}`);
  const decisionEvidenceRefs = normalizeDecisionEvidenceRefs(binding, request);
  const next = structuredClone(binding);
  next.revision += 1;
  next.predecessorRevisionId = binding.revisionId;
  next.revisionId = `${binding.bindingId}:r${next.revision}`;
  next.createdAt = request.at;
  next.createdBy = structuredClone(request.actor);

  switch (request.action) {
    case "submit_candidate": next.lifecycleState = "candidate"; break;
    case "select": next.lifecycleState = "selected"; break;
    case "request_approval":
      next.approval = { state: "pending", contentDigest: binding.technicalDigest, approvalScope: request.approvalScope ?? "layout", reason: request.reason };
      break;
    case "approve":
      next.approval = { state: "approved", contentDigest: binding.technicalDigest, approvalScope: request.approvalScope ?? binding.approval.approvalScope ?? "layout", decisionId: `approval:${physicalBindingDigest({ binding: binding.technicalDigest, actor: request.actor.actorId, at: request.at, reason: request.reason, decisionEvidenceRefs }).slice(4, 36)}`, decidedBy: structuredClone(request.actor), decidedAt: request.at, ...(request.expiresAt ? { expiresAt: request.expiresAt } : {}), reason: request.reason, policyVersion: binding.dependencies.approvalPolicyVersion, decisionEvidenceRefs };
      break;
    case "reject":
      next.approval = { state: "rejected", contentDigest: binding.technicalDigest, approvalScope: request.approvalScope ?? binding.approval.approvalScope ?? "layout", decisionId: `approval:${physicalBindingDigest({ binding: binding.technicalDigest, action: "reject", at: request.at }).slice(4, 36)}`, decidedBy: structuredClone(request.actor), decidedAt: request.at, reason: request.reason, policyVersion: binding.dependencies.approvalPolicyVersion };
      break;
    case "revoke":
      next.approval = { ...next.approval, state: "revoked", decidedBy: structuredClone(request.actor), decidedAt: request.at, reason: request.reason };
      break;
    case "mark_stale":
      next.freshness = { state: "stale", evaluatedAt: request.at, reasonCodes: ["PB_DEPENDENCY_CHANGED"], staleDependencyIds: [...new Set(request.staleDependencyIds ?? [])].sort() };
      if (next.pinPadMapping.state === "verified" && (next.freshness.staleDependencyIds.includes("symbol") || next.freshness.staleDependencyIds.includes("footprint") || next.freshness.staleDependencyIds.includes("mapping"))) next.pinPadMapping.state = "stale";
      break;
    case "revalidate":
      if (!request.validation || request.validation.state !== "valid" || request.validation.validatedDigest !== binding.technicalDigest || !request.validation.validatorVersion) throw new Error("PB_REVALIDATION_PROOF_INVALID");
      next.technicalValidation = structuredClone(request.validation);
      next.freshness = { state: "current", evaluatedAt: request.at, reasonCodes: [], staleDependencyIds: [] };
      break;
    case "supersede":
      next.lifecycleState = "superseded";
      next.supersedesRevisionId = binding.revisionId;
      break;
    case "orphan": next.lifecycleState = "orphaned"; break;
    case "withdraw": next.lifecycleState = "withdrawn"; break;
    default: request.action satisfies never;
  }
  return withBindingDigests(withoutBindingDigests(next));
}

export function createApprovedValidation(binding: ComponentPhysicalBinding, input: { validatorVersion: string; at: string; evidenceRefs: string[] }): ComponentPhysicalBinding["technicalValidation"] {
  return { state: "valid", validatorVersion: input.validatorVersion, validatedDigest: binding.technicalDigest, validatedAt: input.at, evidenceRefs: [...new Set(input.evidenceRefs)].sort(), reasonCodes: [] };
}
