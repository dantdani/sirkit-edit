import type { EngineeringActor, ProjectRole } from "../engineering/types";
import type { FootprintResolutionRequest, FootprintResolutionResult, SourceAuthorityClass } from "../footprint-resolver/types";
import type { MappingVerificationResult } from "../mapping-verification/types";
import type { PassivePolicyEvaluationResult, PassivePolicyExceptionApproveMutationRequest } from "../passive-policy/types";
import type { ComponentTransferAssessment, PcbSyncPreflightRequest } from "../pcb-sync/types";
import type { PhysicalReadinessGateResult } from "../physical-binding/types";

export const ASSIGNMENT_SOURCE_VERSION = "sirkit.assignment-source-bundle.v1" as const;
export const ASSIGNMENT_ITEM_VERSION = "sirkit.physical-assignment-item.v1" as const;
export const ASSIGNMENT_PLAN_VERSION = "sirkit.assignment-decision-plan.v1" as const;
export const ASSIGNMENT_REQUEST_VERSION = "sirkit.assignment-decision-request.v1" as const;
export const ASSIGNMENT_RESULT_VERSION = "sirkit.assignment-decision-result.v1" as const;
export const ASSIGNMENT_QUEUE_VERSION = "sirkit.assignment-queue/6.0.0" as const;

export type AssignmentCategory = "exact_part_required" | "footprint_missing" | "package_missing_or_ambiguous" | "multiple_candidates_ambiguous" | "authoritative_binding_conflict" | "candidate_unapproved" | "asset_unavailable_or_stale" | "mapping_required" | "mapping_ambiguous_or_conflicting" | "passive_policy_missing_facts" | "passive_policy_excluded_specialized" | "passive_policy_conflict" | "component_identity_conflict" | "variant_applicability_required" | "exact_binding_incompatible" | "unsupported_requires_escalation" | "other_structured_assignment_blocker";
export type AssignmentItemLifecycle = "open" | "triaged" | "assigned" | "in_review" | "waiting_for_data" | "decision_ready" | "decision_committing" | "decision_committed_revalidating" | "resolved" | "resolved_with_new_blocker" | "deferred" | "escalated" | "stale" | "superseded" | "cancelled" | "failed";
export type AssignmentSeverity = "warning" | "error" | "blocking";
export type PhysicalDecisionRiskClass = "low" | "moderate" | "high" | "safety_critical" | "unsupported_unknown";
export type AssignmentSourceStage = "stage1" | "stage2" | "stage3" | "stage4" | "stage5";
export type AssignmentDecisionAction = "select_candidate" | "request_candidate_approval" | "approve_candidate" | "reject_candidate" | "revoke_candidate" | "approve_policy_exception" | "defer" | "assign" | "escalate" | "refresh";

export interface SourceIssueReference { sourceStage: AssignmentSourceStage; sourceVersion: string; sourceResultId: string; sourceIssueCode: string; sourceDependencyDigest: string; }
export interface AssignmentBlocker extends SourceIssueReference { blockerId: string; category: AssignmentCategory; blockingScope: "component" | "variant" | "mapping" | "asset" | "policy" | "identity"; componentInstanceId: string; assemblyVariantId: string; severity: AssignmentSeverity; riskClass: PhysicalDecisionRiskClass; candidateIds: string[]; evidenceRefs: string[]; safeMessage: string; remediationCategory: string; actionable: boolean; operational: boolean; causedBy: string[]; freshness: "current" | "stale" | "unknown"; }

export interface AssignmentCandidateReference {
  candidateId: string;
  candidateDigest: string;
  origin: string[];
  authorityClass: SourceAuthorityClass | "suggestion_only";
  authorityRank: number;
  exactPart?: { exactPartId: string; manufacturerId: string; exactMpn: string; supplierSkus: string[] };
  package?: { packageIdentityId: string; packageRevisionId: string; canonicalName: string; mountingTechnology: string; pinCount?: number; pitchNm?: number; bodyWidthNm?: number; bodyLengthNm?: number; exposedPad?: string };
  footprint?: { logicalAssetId: string; assetVersionId: string; contentDigest?: string; libraryNickname: string; footprintName: string; availability: string; validationState: string };
  mapping: { state: string; tier?: string; revisionId?: string; contentDigest?: string };
  approvalState: string;
  technicalState: string;
  freshnessState: string;
  lifecycleState: string;
  conflictState: string;
  applicabilityState: string;
  evidenceRefs: string[];
  missingFacts: string[];
  disqualificationReasons: string[];
  selectable: boolean;
  approvalReady: boolean;
  suggestionOnly: boolean;
  stage1?: { setId: string; bindingRevisionId: string; expectedSetRevision: number };
}

export interface AssignmentActionDescriptor { action: AssignmentDecisionAction; label: string; requiredRoles: ProjectRole[]; candidateRequired: boolean; reasonRequired: boolean; destructive: boolean; supported: true; }
export interface AssignmentDependencySnapshot { snapshotId: string; snapshotDigest: string; componentRevision: string; sourceDigests: Array<{ stage: AssignmentSourceStage; resultId: string; digest: string; version: string }>; candidateSetDigest: string; dependencyDigest: string; }
export interface AssignmentReadinessSnapshot { layout: "ready" | "not_ready" | "not_applicable" | "unknown"; manufacturing: "ready" | "not_ready" | "not_applicable" | "unknown"; resolutionStatus: string; mappingStatus: string; pcbComponentStatus: string; passivePolicyStatus: string; }
export interface AssignmentImpactSummary { blocksPcbSync: boolean; boardChanged: false; routedImpact: boolean; affectedPlanIds: string[]; riskClass: PhysicalDecisionRiskClass; }
export interface AssignmentOwnerReferences { stage1?: { setId: string; expectedSetRevision: number; selectedBindingRevisionId?: string }; stage5?: { policyId: string; recordId: string; expectedRevision: number; expectedPolicyDigest: string }; }

export interface PhysicalAssignmentItem {
  itemSchemaVersion: typeof ASSIGNMENT_ITEM_VERSION;
  itemId: string;
  itemKey: string;
  itemRevision: number;
  itemDigest: string;
  tenantId: string;
  projectId: string;
  branchId: string;
  designId: string;
  componentId: string;
  referenceDesignator: string;
  displayName: string;
  assemblyVariantId: string;
  lifecycle: AssignmentItemLifecycle;
  category: AssignmentCategory;
  severity: AssignmentSeverity;
  riskClass: PhysicalDecisionRiskClass;
  sourceIssues: SourceIssueReference[];
  primaryBlocker: AssignmentBlocker;
  secondaryBlockers: AssignmentBlocker[];
  candidateSet: AssignmentCandidateReference[];
  allowedActions: AssignmentActionDescriptor[];
  snapshot: AssignmentDependencySnapshot;
  currentReadiness: AssignmentReadinessSnapshot;
  impact: AssignmentImpactSummary;
  ownerReferences: AssignmentOwnerReferences;
  assignee?: { actorOrGroupId: string; kind: "actor" | "group" };
  priority: { rank: number; reasons: string[] };
  createdAt: string;
  updatedAt: string;
  supersedes?: string;
  decisionPlanId?: string;
}

export interface AssignmentSourceBundle {
  sourceSchemaVersion: typeof ASSIGNMENT_SOURCE_VERSION;
  sourceBundleId: string;
  sourceBundleDigest: string;
  tenantId: string;
  projectId: string;
  branchId: string;
  designId: string;
  componentId: string;
  componentRevision: string;
  referenceDesignator: string;
  displayName: string;
  assemblyVariantId: string;
  stage1Gates: PhysicalReadinessGateResult[];
  resolution?: FootprintResolutionResult;
  pcbComponent?: ComponentTransferAssessment;
  mapping?: MappingVerificationResult;
  passivePolicy?: PassivePolicyEvaluationResult;
  candidates: AssignmentCandidateReference[];
  ownerReferences: AssignmentOwnerReferences;
  resolutionRequest?: FootprintResolutionRequest;
  pcbPreflightRequest?: PcbSyncPreflightRequest;
  capturedAt: string;
}

export interface AssignmentQueueSummary { totalApplicable: number; pcbReady: number; open: number; stale: number; deferred: number; resolved: number; escalated: number; byCategory: Partial<Record<AssignmentCategory, number>>; }
export interface AssignmentQueueResult { queueVersion: typeof ASSIGNMENT_QUEUE_VERSION; projectId: string; assemblyVariantId: string; items: PhysicalAssignmentItem[]; summary: AssignmentQueueSummary; operationalIssues: AssignmentBlocker[]; refreshedAt: string; boardChanged: false; }

export interface AssignmentDecisionRequest {
  requestSchemaVersion: typeof ASSIGNMENT_REQUEST_VERSION;
  requestId: string;
  tenantId: string;
  projectId: string;
  branchId: string;
  itemId: string;
  expectedItemRevision: number;
  expectedItemDigest: string;
  action: AssignmentDecisionAction;
  selectedCandidateId?: string;
  selectedCandidateDigest?: string;
  decisionEvidenceRefs?: string[];
  policyException?: PassivePolicyExceptionApproveMutationRequest | { exceptionId: string; action: "require_exact_part"; assemblyVariantIds: string[]; reason: string; evidenceRefs: string[] };
  assignee?: { actorOrGroupId: string; kind: "actor" | "group" };
  reason: string;
  actorContext: EngineeringActor;
  mode: "preview" | "commit";
  idempotencyKey: string;
  planId?: string;
  planDigest?: string;
  requestedAt: string;
}

export interface AssignmentAuthoritativeOperation { operationId: string; owner: "stage1" | "stage5" | "assignment_queue"; action: string; beforeRevision: string; targetRevision?: string; idempotencyKey: string; requiredRole: ProjectRole[]; decisionEvidenceRefs?: string[]; }
export interface AssignmentDecisionPlan { planSchemaVersion: typeof ASSIGNMENT_PLAN_VERSION; planId: string; planDigest: string; decisionInputDigest: string; itemId: string; itemRevision: number; itemDigest: string; itemLifecycleBefore: AssignmentItemLifecycle; dependencyDigest: string; action: AssignmentDecisionAction; selectedCandidateId?: string; selectedCandidateDigest?: string; decisionEvidenceRefs?: string[]; policyException?: PassivePolicyExceptionApproveMutationRequest; operations: AssignmentAuthoritativeOperation[]; requiredAcknowledgements: string[]; expectedInvalidations: string[]; expectedOutcome: string; warnings: string[]; riskClass: PhysicalDecisionRiskClass; reversible: boolean; lifecycle: "validated" | "stale" | "committing" | "committed" | "failed"; createdBy: EngineeringActor; createdAt: string; expiresAt: string; }
export interface AssignmentDecisionResult { resultSchemaVersion: typeof ASSIGNMENT_RESULT_VERSION; requestId: string; decisionId: string; itemId: string; planId: string; planDigest: string; status: "previewed" | "committed" | "resolved" | "resolved_with_new_blocker" | "revalidation_pending" | "stale" | "conflict" | "unauthorized" | "failed"; operations: Array<AssignmentAuthoritativeOperation & { status: "planned" | "completed" | "failed"; resultingRevision?: string }>; auditIds: string[]; invalidationIds: string[]; itemLifecycleBefore: AssignmentItemLifecycle; itemLifecycleAfter: AssignmentItemLifecycle; boardChanged: false; warnings: string[]; idempotent: boolean; completedAt: string; }
