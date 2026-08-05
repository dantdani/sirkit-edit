import { createPhysicalBindingCandidate } from "../../physical-binding/domain";
import { InMemoryPhysicalBindingRepository, PhysicalBindingService } from "../../physical-binding/repository";
import { createApprovedValidation } from "../../physical-binding/transitions";
import { withBindingDigests, withoutBindingDigests } from "../../physical-binding/stable";
import type { ComponentPhysicalBinding } from "../../physical-binding/types";
import { ACTOR, AI_ACTOR, exactCandidate, NOW, scope, transition } from "../../physical-binding/__tests__/fixtures";
import { migrateLegacyPhysicalBinding } from "../../physical-binding/legacy";
import { FOOTPRINT_RESOLUTION_REQUEST_VERSION, type FootprintResolutionRequest } from "../types";

export { ACTOR, AI_ACTOR, NOW, exactCandidate, scope };

export function resolverRequest(componentId: string, options: Partial<FootprintResolutionRequest> = {}): FootprintResolutionRequest {
  return {
    schemaVersion: FOOTPRINT_RESOLUTION_REQUEST_VERSION,
    requestId: `request-${componentId}`,
    tenantId: "tenant-1",
    projectId: "project-1",
    branchId: "main",
    boardInstanceId: "board-1",
    componentId,
    hierarchyPath: ["root", "motor-control"],
    assemblyVariantId: "variant-default",
    purpose: "layout_transfer",
    policyId: "sirkit.default-footprint-resolution",
    policyVersion: "1.0.0",
    requestedAt: "2026-07-18T14:00:00.000Z",
    actorContext: ACTOR,
    ...options,
  };
}

export async function addReadyCandidate(repository: InMemoryPhysicalBindingRepository, candidate: ComponentPhysicalBinding): Promise<ComponentPhysicalBinding> {
  const service = new PhysicalBindingService(repository);
  let state = await service.createCandidate(candidate, `create-${candidate.bindingId}`);
  state = await service.transition(state.set.setId, { ...transition(candidate, state.set.revision, "select", ACTOR), decisionEvidenceRefs: [...candidate.evidenceRefs] });
  let current = state.bindings.find((binding) => binding.revisionId === state.set.effectiveSelectedRevisionId)!;
  const validation = transition(current, state.set.revision, "revalidate", ACTOR);
  validation.validation = createApprovedValidation(current, { validatorVersion: "physical-binding-validator/1", at: validation.at, evidenceRefs: ["evidence-mapping"] });
  state = await service.transition(state.set.setId, validation);
  current = state.bindings.find((binding) => binding.revisionId === state.set.effectiveSelectedRevisionId)!;
  state = await service.transition(state.set.setId, { ...transition(current, state.set.revision, "approve", ACTOR), decisionEvidenceRefs: [...current.evidenceRefs] });
  return state.bindings.find((binding) => binding.revisionId === state.set.effectiveSelectedRevisionId)!;
}

export async function readyRepository(componentId = "resolver-ready", options: { manufacturingComplete?: boolean } = {}): Promise<{ repository: InMemoryPhysicalBindingRepository; binding: ComponentPhysicalBinding }> {
  const repository = new InMemoryPhysicalBindingRepository();
  const binding = await addReadyCandidate(repository, exactCandidate(componentId, { manufacturingComplete: options.manufacturingComplete }));
  return { repository, binding };
}

export async function legacyRepository(componentId: string, rawComponent: Record<string, unknown>): Promise<{ repository: InMemoryPhysicalBindingRepository; binding: ComponentPhysicalBinding }> {
  const repository = new InMemoryPhysicalBindingRepository();
  const migration = migrateLegacyPhysicalBinding({ sourceSchemaVersion: "sirkit.project.legacy-v3", scope: scope(componentId), rawComponent, actor: { ...ACTOR, actorKind: "system_migration", role: "migration_admin" }, migratedAt: NOW });
  const state = await new PhysicalBindingService(repository).migrate(migration);
  return { repository, binding: state.bindings[0]! };
}

export async function dnpRepository(componentId: string): Promise<{ repository: InMemoryPhysicalBindingRepository; binding: ComponentPhysicalBinding }> {
  const repository = new InMemoryPhysicalBindingRepository();
  const base = createPhysicalBindingCandidate({ scope: scope(componentId), classification: { populationKind: "dnp", deviceClass: "passive", mountingTechnology: "unknown", polarity: "unknown", classificationEvidenceRefs: ["variant-rule"] }, origin: { kind: "human_selection", actor: ACTOR, sourceRef: "variant-rule", createdAt: NOW, evidenceRefs: ["variant-rule"] }, evidenceRefs: ["variant-rule"], applicabilityState: "not_applicable", createdAt: NOW, createdBy: ACTOR, candidateKey: `dnp-${componentId}` });
  const service = new PhysicalBindingService(repository);
  let state = await service.createCandidate(base, `create-dnp-${componentId}`);
  state = await service.transition(state.set.setId, { ...transition(base, state.set.revision, "select", ACTOR), decisionEvidenceRefs: [...base.evidenceRefs] });
  const current = state.bindings.find((binding) => binding.revisionId === state.set.effectiveSelectedRevisionId)!;
  const revalidate = transition(current, state.set.revision, "revalidate", ACTOR);
  revalidate.validation = createApprovedValidation(current, { validatorVersion: "variant-validator/1", at: revalidate.at, evidenceRefs: ["variant-rule"] });
  state = await service.transition(state.set.setId, revalidate);
  return { repository, binding: state.bindings.find((binding) => binding.revisionId === state.set.effectiveSelectedRevisionId)! };
}

export function aiSuggestion(componentId: string): ComponentPhysicalBinding {
  const exact = exactCandidate(componentId, { candidateKeySuffix: "ai" });
  return withBindingDigests({ ...withoutBindingDigests(exact), lifecycleState: "candidate", origin: { kind: "ai_suggestion", actor: AI_ACTOR, sourceRef: "ai-suggestion", createdAt: NOW, evidenceRefs: ["catalog-search"], confidence: 1 }, approval: { state: "unreviewed" }, technicalValidation: { state: "pending", evidenceRefs: [], reasonCodes: ["PENDING"] }, freshness: { state: "current", evaluatedAt: NOW, reasonCodes: [], staleDependencyIds: [] } });
}
