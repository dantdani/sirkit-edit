import { buildPassiveDependencySnapshot } from "./adapters";
import { DeterministicPassivePolicyEvaluator } from "./evaluator";
import { PASSIVE_POLICY_LIMITS } from "./policy";
import { passivePolicyDigest, passivePolicyId } from "./stable";
import { PASSIVE_PREVIEW_VERSION, type PassivePolicyContext, type PassivePolicyEvaluationResult, type PassivePolicyStatus, type PassiveProjectPreview, type ProjectPassivePackagePolicy } from "./types";

const STATUSES: PassivePolicyStatus[] = ["eligible_exact_part", "eligible_characterized_generic", "eligible_layout_reservation", "not_applicable", "excluded_safety", "excluded_specialized_role", "requires_exact_part", "missing_required_facts", "conflicting_facts", "conflicting_rules", "profile_unavailable", "mapping_unverified", "policy_draft_unapproved", "policy_stale", "unsupported", "error"];

export async function previewPassivePolicy(input: { policy: ProjectPassivePackagePolicy; contexts: PassivePolicyContext[]; assemblyVariantId: string; currentResults?: PassivePolicyEvaluationResult[]; affectedStage3PlanCount?: number; routedComponentIds?: string[]; signal?: AbortSignal }): Promise<PassiveProjectPreview> {
  if (input.contexts.length > PASSIVE_POLICY_LIMITS.maxPreviewComponents) throw new Error("PP_PREVIEW_COMPONENT_LIMIT_EXCEEDED");
  const evaluator = new DeterministicPassivePolicyEvaluator(), results: PassivePolicyEvaluationResult[] = [];
  const contexts = [...input.contexts].sort((a, b) => a.component.scope.componentInstanceId.localeCompare(b.component.scope.componentInstanceId));
  for (let index = 0; index < contexts.length; index += 16) {
    if (input.signal?.aborted) throw new Error("PP_REQUEST_CANCELLED");
    const chunk = contexts.slice(index, index + 16);
    results.push(...chunk.map((source) => { const context = structuredClone(source); context.policy = structuredClone(input.policy); context.request = { ...context.request, policyRevisionId: input.policy.revisionId, purpose: "preview" }; context.dependencySnapshot = buildPassiveDependencySnapshot({ component: context.component, policy: input.policy, profiles: context.profiles, assemblyProfile: context.assemblyProfile }); return evaluator.evaluate(context); }));
  }
  results.sort((a, b) => a.componentInstanceId.localeCompare(b.componentInstanceId));
  const currentByComponent = new Map((input.currentResults ?? []).map((item) => [item.componentInstanceId, item]));
  const changedComponentIds = results.filter((item) => { const current = currentByComponent.get(item.componentInstanceId); return !current || current.status !== item.status || current.selectedProfile?.profileDigest !== item.selectedProfile?.profileDigest || current.policyTechnicalDigest !== item.policyTechnicalDigest; }).map((item) => item.componentInstanceId);
  const summary = Object.fromEntries(STATUSES.map((status) => [status, results.filter((item) => item.status === status).length])) as Record<PassivePolicyStatus, number>;
  const gapEntries = results.flatMap((item) => item.unresolvedManufacturingFacts.map((gap) => gap.category)), manufacturingGapCounts = Object.fromEntries([...new Set(gapEntries)].sort().map((category) => [category, gapEntries.filter((item) => item === category).length]));
  const base = { schemaVersion: PASSIVE_PREVIEW_VERSION, policyRevisionId: input.policy.revisionId, assemblyVariantId: input.assemblyVariantId, results, summary, changedComponentIds: changedComponentIds.sort(), manufacturingGapCounts, affectedStage2ComponentIds: changedComponentIds.sort(), affectedStage3PlanCount: input.affectedStage3PlanCount ?? 0, routedBoardRiskComponentIds: [...new Set(input.routedComponentIds ?? [])].filter((id) => changedComponentIds.includes(id)).sort(), boardChanged: false as const };
  return { ...base, previewId: passivePolicyId("passive-policy-preview", base), previewDigest: passivePolicyDigest(base) };
}
