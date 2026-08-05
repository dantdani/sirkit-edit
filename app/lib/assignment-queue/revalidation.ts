import type { DurableEffectHandler } from "../durable-workflow/outbox";
import { assertDurableOutboxEvent, durableEventContractKey } from "../durable-workflow/stable";
import type { EngineeringActor } from "../engineering/types";
import type { FootprintResolutionService } from "../footprint-resolver/service";
import type { PassivePolicyRepository } from "../passive-policy/types";
import type { PassivePolicyService } from "../passive-policy/service";
import type { PcbSynchronizationService } from "../pcb-sync/service";
import type { PhysicalBindingRepository } from "../physical-binding/repository";
import { evaluatePhysicalReadiness } from "../physical-binding/readiness";
import { assignmentCandidateFromBinding, buildAssignmentSourceBundle } from "./adapters";
import { DurableAssignmentQueueRepository } from "./repository";
import { AssignmentQueueService } from "./service";
import { assignmentId } from "./stable";
import type { AssignmentQueueResult } from "./types";

export const ASSIGNMENT_REVALIDATION_EVENT_TYPE = "assignment.revalidation-requested" as const;
export const ASSIGNMENT_REVALIDATION_EVENT_VERSION = 2 as const;
export interface AssignmentRevalidationPayload { tenantId: string; projectId: string; branchId: string; itemId: string; decisionId: string; sourceSnapshotId: string; expectedItemRevision: number; expectedItemDigest: string }

export interface AssignmentRevalidationCoordinatorOptions {
  queueRepository: DurableAssignmentQueueRepository;
  queueService: AssignmentQueueService;
  physicalBindings: PhysicalBindingRepository;
  resolver: FootprintResolutionService;
  pcbSync: PcbSynchronizationService;
  passivePolicy: PassivePolicyService;
  passiveRepository: PassivePolicyRepository;
  clock?: () => string;
}

/** Rebuilds Stage 1/2/3/5 evidence after a committed owner decision. */
export class AssignmentRevalidationCoordinator {
  private readonly clock: () => string;
  constructor(private readonly options: AssignmentRevalidationCoordinatorOptions) { this.clock = options.clock ?? (() => new Date().toISOString()); }

  async revalidate(payload: AssignmentRevalidationPayload, signal?: AbortSignal): Promise<AssignmentQueueResult | null> {
    if (signal?.aborted) throw new Error("AQ_REVALIDATION_CANCELLED");
    const repositoryScope = { tenantId: payload.tenantId, projectId: payload.projectId, branchId: payload.branchId }, item = await this.options.queueRepository.getItem(repositoryScope, payload.itemId);
    if (!item) throw new Error("AQ_REVALIDATION_ITEM_STALE");
    if (item.lifecycle !== "decision_committed_revalidating" || item.itemRevision !== payload.expectedItemRevision || item.itemDigest !== payload.expectedItemDigest) { const decision = await this.options.queueRepository.latestDecision(repositoryScope, payload.decisionId); if (decision?.itemId === item.itemId && item.decisionPlanId === decision.planId && ["superseded", "resolved", "resolved_with_new_blocker"].includes(item.lifecycle)) return null; throw new Error("AQ_REVALIDATION_ITEM_STALE"); }
    if (item.snapshot.snapshotId !== payload.sourceSnapshotId) throw new Error("AQ_REVALIDATION_ITEM_STALE");
    const source = await this.options.queueRepository.getSource(item);
    if (!source) throw new Error("AQ_REVALIDATION_SOURCE_NOT_FOUND");
    const now = this.clock();
    const actor: EngineeringActor = { actorId: "assignment-revalidation-coordinator", actorKind: "automated_engine", role: "automation", sessionId: payload.decisionId };

    const stage1Owner = source.ownerReferences.stage1;
    if (!stage1Owner) throw new Error("AQ_REVALIDATION_STAGE1_OWNER_MISSING");
    const state = await this.options.physicalBindings.load(stage1Owner.setId);
    if (!state || state.set.scope.tenantId !== item.tenantId || state.set.scope.projectId !== item.projectId || state.set.scope.branchId !== item.branchId) throw new Error("AQ_REVALIDATION_STAGE1_STATE_MISSING");
    const activeBindings = state.set.candidateRevisionIds.map((revisionId) => state.bindings.find((binding) => binding.revisionId === revisionId)).filter((binding): binding is NonNullable<typeof binding> => Boolean(binding));
    if (!activeBindings.length) throw new Error("AQ_REVALIDATION_STAGE1_STATE_EMPTY");
    const selected = activeBindings.find((binding) => binding.revisionId === state.set.effectiveSelectedRevisionId) ?? activeBindings[0]!;
    const stage1Gates = evaluatePhysicalReadiness(selected, { assessedAt: now, effectiveSelectedRevisionId: state.set.effectiveSelectedRevisionId }).gates;

    if (!source.resolutionRequest || !source.pcbPreflightRequest) throw new Error("AQ_REVALIDATION_INPUT_INCOMPLETE");
    const resolutionRequest = { ...source.resolutionRequest, requestId: assignmentId("assignment-revalidation-resolution", { decisionId: payload.decisionId, setDigest: state.set.recordDigest }), expectedComponentRevision: source.componentRevision, expectedBindingSetDigest: state.set.recordDigest, actorContext: actor, requestedAt: now };
    const resolution = await this.options.resolver.resolve(resolutionRequest, signal);
    const candidates = activeBindings.map((binding) => assignmentCandidateFromBinding({ binding, set: state.set, disposition: resolution.consideredCandidates.find((candidate) => candidate.readinessAssessment.bindingRevisionId === binding.revisionId) }));

    let passivePolicy = source.passivePolicy;
    let stage5Owner = source.ownerReferences.stage5;
    if (stage5Owner && passivePolicy) {
      const policyHead = await this.options.passiveRepository.getHead({ tenantId: item.tenantId, projectId: item.projectId, branchId: item.branchId, policyId: stage5Owner.policyId });
      if (!policyHead) throw new Error("AQ_REVALIDATION_STAGE5_STATE_MISSING");
      passivePolicy = await this.options.passivePolicy.evaluate({ requestSchemaVersion: "sirkit.passive-policy-evaluation-request.v1", requestId: assignmentId("assignment-revalidation-passive", { decisionId: payload.decisionId, policy: policyHead.policy.technicalDigest }), tenantId: item.tenantId, projectId: item.projectId, branchId: item.branchId, componentInstanceId: item.componentId, assemblyVariantId: item.assemblyVariantId, policyRevisionId: policyHead.policy.revisionId, purpose: "stage2_resolution", actorContext: actor, requestedAt: now }, signal);
      stage5Owner = { policyId: policyHead.policy.policyId, recordId: policyHead.recordId, expectedRevision: policyHead.revision, expectedPolicyDigest: policyHead.policy.technicalDigest };
    }

    const pcbRequest = { ...source.pcbPreflightRequest, requestId: assignmentId("assignment-revalidation-preflight", { decisionId: payload.decisionId, setDigest: state.set.recordDigest }), actorContext: actor, requestedAt: now, mode: "preview" as const };
    const preflight = await this.options.pcbSync.preflight(pcbRequest, signal);
    const pcbComponent = preflight.components.find((component) => component.componentInstanceId === item.componentId);
    if (!pcbComponent) throw new Error("AQ_REVALIDATION_COMPONENT_MISSING");

    const bundle = buildAssignmentSourceBundle({
      tenantId: item.tenantId,
      projectId: item.projectId,
      branchId: item.branchId,
      designId: item.designId,
      componentId: item.componentId,
      componentRevision: source.componentRevision,
      referenceDesignator: source.referenceDesignator,
      displayName: source.displayName,
      assemblyVariantId: item.assemblyVariantId,
      stage1Gates,
      resolution,
      pcbComponent,
      ...(source.mapping ? { mapping: source.mapping } : {}),
      ...(passivePolicy ? { passivePolicy } : {}),
      candidates,
      ownerReferences: { stage1: { setId: state.set.setId, expectedSetRevision: state.set.revision, ...(state.set.effectiveSelectedRevisionId ? { selectedBindingRevisionId: state.set.effectiveSelectedRevisionId } : {}) }, ...(stage5Owner ? { stage5: stage5Owner } : {}) },
      resolutionRequest,
      pcbPreflightRequest: pcbRequest,
      capturedAt: now,
    });
    return this.options.queueService.refresh(bundle, actor);
  }
}

function payload(value: Record<string, unknown>): AssignmentRevalidationPayload {
  const keys = ["tenantId", "projectId", "branchId", "itemId", "decisionId", "sourceSnapshotId", "expectedItemRevision", "expectedItemDigest"];
  if (Object.keys(value).some((key) => !keys.includes(key)) || keys.slice(0, 6).some((key) => typeof value[key] !== "string" || !(value[key] as string).trim()) || !Number.isInteger(value.expectedItemRevision) || Number(value.expectedItemRevision) < 1 || typeof value.expectedItemDigest !== "string" || !value.expectedItemDigest) throw new Error("AQ_REVALIDATION_PAYLOAD_INVALID");
  return { tenantId: String(value.tenantId), projectId: String(value.projectId), branchId: String(value.branchId), itemId: String(value.itemId), decisionId: String(value.decisionId), sourceSnapshotId: String(value.sourceSnapshotId), expectedItemRevision: Number(value.expectedItemRevision), expectedItemDigest: value.expectedItemDigest };
}
export function assignmentRevalidationOutboxHandlers(coordinator: AssignmentRevalidationCoordinator): ReadonlyMap<string, DurableEffectHandler> {
  return new Map([[durableEventContractKey(ASSIGNMENT_REVALIDATION_EVENT_TYPE, ASSIGNMENT_REVALIDATION_EVENT_VERSION), async (event, signal) => {
    assertDurableOutboxEvent(event);
    if (event.eventType !== ASSIGNMENT_REVALIDATION_EVENT_TYPE || event.eventVersion !== ASSIGNMENT_REVALIDATION_EVENT_VERSION || event.topic !== ASSIGNMENT_REVALIDATION_EVENT_TYPE || event.ownerAggregateType !== "assignment-queue.decision.v1" || event.ownerAggregateRevision !== 1) throw new Error("AQ_REVALIDATION_EVENT_CONTRACT_UNSUPPORTED");
    const input = payload(event.payload);
    if (input.tenantId !== event.scope.tenantId || input.projectId !== event.scope.projectId || input.branchId !== event.scope.branchId || input.decisionId !== event.ownerAggregateKey) throw new Error("AQ_REVALIDATION_EVENT_SCOPE_MISMATCH");
    await coordinator.revalidate(input, signal);
  }]]);
}
