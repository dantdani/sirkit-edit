import type { EngineeringActor } from "../engineering/types";
import { nativeComponentIdentity } from "../physical-binding/identity";
import type { ComponentPhysicalBinding } from "../physical-binding/types";
import { passivePolicyDigest, passivePolicyId } from "./stable";
import { PASSIVE_FACT_SNAPSHOT_VERSION, PASSIVE_POLICY_EVALUATOR_VERSION, type AssemblyProfileSnapshot, type PassiveComponentScope, type PassiveComponentSnapshot, type PassiveFact, type PassiveFactKey, type PassiveFactState, type PassivePackageProfile, type PassivePolicyDependencySnapshot, type PassivePolicyEvaluationRequest, type PassiveRole, type ProjectPassivePackagePolicy } from "./types";

export function passiveFact<T>(key: PassiveFactKey, state: PassiveFactState, value: T | undefined, input: { sourceRefs: string[]; evidenceRefs: string[]; approvedBy?: EngineeringActor; observedAt?: string }): PassiveFact<T> {
  if ((state === "exact" || state === "approved_inference") && value === undefined) throw new Error("PP_KNOWN_FACT_VALUE_REQUIRED");
  if ((state === "unknown" || state === "conflicting") && value !== undefined) throw new Error("PP_UNKNOWN_OR_CONFLICTING_FACT_VALUE_FORBIDDEN");
  const technical = { key, state, value, sourceRefs: [...new Set(input.sourceRefs)].sort(), evidenceRefs: [...new Set(input.evidenceRefs)].sort() };
  return { ...technical, factId: passivePolicyId("passive-fact", technical), ...(input.approvedBy ? { approvedBy: structuredClone(input.approvedBy) } : {}), ...(input.observedAt ? { observedAt: input.observedAt } : {}) };
}

export function buildPassiveComponentSnapshot(input: {
  scope: PassiveComponentScope;
  componentRevisionId: string;
  populationState: PassiveComponentSnapshot["populationState"];
  passiveClass: PassiveComponentSnapshot["passiveClass"];
  subclass: PassiveComponentSnapshot["subclass"];
  applicationRoles: PassiveComponentSnapshot["applicationRoles"];
  technology: PassiveComponentSnapshot["technology"];
  polarity: PassiveComponentSnapshot["polarity"];
  facts?: PassiveComponentSnapshot["facts"];
  riskFlags?: PassiveComponentSnapshot["riskFlags"];
  approvedTags?: string[];
  voltageDomainIds?: string[];
  exactBinding?: { binding: ComponentPhysicalBinding; effectiveSelected: boolean; currentApproved: boolean };
  exactPartCompatibleProfileIds?: string[];
  evidenceRefs: string[];
}): PassiveComponentSnapshot {
  if (input.passiveClass.state === "approved_inference" && !input.passiveClass.approvedBy) throw new Error("PP_CLASS_INFERENCE_APPROVAL_REQUIRED");
  if (input.applicationRoles.state === "approved_inference" && !input.applicationRoles.approvedBy) throw new Error("PP_ROLE_INFERENCE_APPROVAL_REQUIRED");
  const stableIdentity = input.exactBinding?.binding.componentIdentity ?? nativeComponentIdentity({ tenantId: input.scope.tenantId, projectId: input.scope.projectId, branchId: input.scope.branchId, boardInstanceId: input.scope.boardInstanceId, componentInstanceId: input.scope.componentInstanceId, hierarchyPath: input.scope.hierarchyPath, assemblyVariantIds: [input.scope.assemblyVariantId] });
  const technical = { scope: input.scope, componentRevisionId: input.componentRevisionId, populationState: input.populationState, passiveClass: input.passiveClass, subclass: input.subclass, applicationRoles: input.applicationRoles, technology: input.technology, polarity: input.polarity, facts: input.facts ?? {}, riskFlags: input.riskFlags ?? {}, approvedTags: [...new Set(input.approvedTags ?? [])].sort(), voltageDomainIds: [...new Set(input.voltageDomainIds ?? [])].sort(), exactBindingDigest: input.exactBinding?.binding.recordDigest, exactPartCompatibleProfileIds: [...new Set(input.exactPartCompatibleProfileIds ?? [])].sort(), evidenceRefs: [...new Set(input.evidenceRefs)].sort() };
  return { schemaVersion: PASSIVE_FACT_SNAPSHOT_VERSION, snapshotId: passivePolicyId("passive-component-snapshot", technical), ...technical, stableIdentity, ...(input.exactBinding ? { exactBinding: structuredClone(input.exactBinding) } : {}), dependencyDigest: passivePolicyDigest(technical) };
}

export function buildPassiveDependencySnapshot(input: { component: PassiveComponentSnapshot; policy?: ProjectPassivePackagePolicy; profiles: PassivePackageProfile[]; assemblyProfile: AssemblyProfileSnapshot }): PassivePolicyDependencySnapshot {
  const base = { componentDigest: input.component.dependencyDigest, policyDigest: input.policy?.technicalDigest ?? "pp1-no-policy", profileDigests: input.profiles.map((item) => item.profileDigest).sort(), mappingDigests: input.profiles.map((item) => item.stage4MappingProfileRef.mappingContentDigest).filter((item): item is string => Boolean(item)).sort(), footprintDigests: input.profiles.map((item) => item.exactFootprintAssetIdentity.contentDigest).filter((item): item is string => Boolean(item)).sort(), assemblyProfileDigest: input.assemblyProfile.dependencyDigest, evaluatorVersion: PASSIVE_POLICY_EVALUATOR_VERSION };
  return { ...base, dependencyDigest: passivePolicyDigest(base) };
}

export function contextRequestForComponent(request: PassivePolicyEvaluationRequest, component: PassiveComponentSnapshot): PassivePolicyEvaluationRequest { return { ...request, tenantId: component.scope.tenantId, projectId: component.scope.projectId, branchId: component.scope.branchId, componentInstanceId: component.scope.componentInstanceId, assemblyVariantId: component.scope.assemblyVariantId } }
export function ordinaryRole(role: PassiveRole): boolean { return ["decoupling", "bypass", "pull_up", "pull_down", "bias", "series_signal", "led_current_limit", "generic", "zero_ohm_link"].includes(role); }
