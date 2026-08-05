import { circuitDigest, circuitId } from "./stable";
import type { CircuitKnowledgeCapabilityProfile, CircuitRecipeDefinition, RecipeBindingCandidate, RecipeCompositionPlan, RecipeCoverage, RecipeEvidenceState } from "./types";

function portSignature(port: CircuitRecipeDefinition["ports"][number]): string {
  return circuitDigest({ kind: port.portKind, direction: port.direction, domain: port.electricalDomainContract, modes: [...port.modeStateConditions].sort(), fault: port.safeFaultBehavior ?? "", external: [...port.requiredExternalContractKinds].sort(), sharing: port.composabilityPolicy });
}

export function composeRecipeBindings(input: { bindings: RecipeBindingCandidate[]; recipes: CircuitRecipeDefinition[]; capabilityProfile: CircuitKnowledgeCapabilityProfile }): RecipeCompositionPlan {
  const bindings = [...input.bindings].sort((a, b) => a.bindingCandidateId.localeCompare(b.bindingCandidateId));
  const recipes = new Map(input.recipes.map((item) => [item.revisionId, item]));
  const conflicts: RecipeCompositionPlan["conflicts"] = [];
  const portGroups = new Map<string, Array<{ id: string; signature: string }>>();
  const roleGroups = new Map<string, Array<{ id: string; recipe: CircuitRecipeDefinition }>>();
  let exploredNodes = 0;
  if (bindings.length > input.capabilityProfile.limits.maximumCompositionMembers) conflicts.push({ conflictId: "composition-member-limit", kind: "resource_limit", memberRefs: bindings.map((item) => item.bindingCandidateId), explanation: "Composition member bound exceeded." });
  for (const binding of bindings.slice(0, input.capabilityProfile.limits.maximumCompositionMembers)) {
    exploredNodes += 1;
    for (const revisionId of binding.recipeRevisionIds) {
      const recipe = recipes.get(revisionId);
      if (!recipe) { conflicts.push({ conflictId: circuitId("composition-conflict", [binding.bindingCandidateId, revisionId]), kind: "recipe_reference_orphan", memberRefs: [binding.bindingCandidateId, revisionId], explanation: "A binding references a recipe revision outside the pinned composition set." }); continue; }
      for (const port of recipe.ports.filter((item) => item.composabilityPolicy !== "private")) {
        const group = portGroups.get(port.semanticRole) ?? [];
        group.push({ id: `${revisionId}:${port.portId}`, signature: portSignature(port) });
        portGroups.set(port.semanticRole, group);
      }
      for (const role of recipe.componentRoleSlots) {
        const group = roleGroups.get(role.semanticRole) ?? [];
        group.push({ id: `${revisionId}:${role.roleSlotId}`, recipe });
        roleGroups.set(role.semanticRole, group);
      }
    }
  }
  const sharedPortUnificationRecords: RecipeCompositionPlan["sharedPortUnificationRecords"] = [];
  for (const [semanticRole, members] of [...portGroups].sort(([a], [b]) => a.localeCompare(b))) {
    if (members.length < 2) continue;
    const compatible = new Set(members.map((item) => item.signature)).size === 1;
    sharedPortUnificationRecords.push({ portIds: members.map((item) => item.id).sort(), unifiedRole: semanticRole, state: compatible ? "pass" : "conflict" });
    if (!compatible) conflicts.push({ conflictId: circuitId("composition-conflict", members), kind: "port_contract_conflict", memberRefs: members.map((item) => item.id).sort(), explanation: `Ports named by semantic role '${semanticRole}' differ in direction/domain/mode/safe-state/share policy.` });
  }
  const sharedRoleDeduplicationRecords: RecipeCompositionPlan["sharedRoleDeduplicationRecords"] = [];
  for (const [semanticRole, members] of [...roleGroups].sort(([a], [b]) => a.localeCompare(b))) {
    if (members.length < 2) continue;
    const explicitlyShareable = members.every((member) => member.recipe.componentRoleSlots.find((item) => `${member.recipe.revisionId}:${item.roleSlotId}` === member.id)?.applicationRecipeCompatibility.includes("shareable_across_recipe_boundary"));
    if (explicitlyShareable) sharedRoleDeduplicationRecords.push({ roleSlotIds: members.map((item) => item.id).sort(), deduplicatedRole: semanticRole, justificationEvidenceRefs: [...new Set(members.flatMap((member) => member.recipe.componentRoleSlots.find((item) => `${member.recipe.revisionId}:${item.roleSlotId}` === member.id)?.evidenceRefs ?? []))].sort() });
  }
  const exactBindings = new Map<string, string>();
  for (const binding of bindings) for (const exact of binding.exactPartPackageBindingIds) {
    const [role, value = exact] = exact.split("=");
    const prior = exactBindings.get(role);
    if (prior && prior !== value) conflicts.push({ conflictId: circuitId("composition-conflict", [role, prior, value]), kind: "exact_part_binding_conflict", memberRefs: [role, prior, value], explanation: "The same shared role has incompatible exact bindings." });
    exactBindings.set(role, value);
  }
  const coverageResults: RecipeCoverage[] = bindings.map((binding) => ({ coverageId: circuitId("recipe-coverage", binding.bindingCandidateId), architectureObligationId: binding.architectureRoleId, recipeOrNovelProposalIds: binding.recipeRevisionIds, coverageState: binding.feasibilityState === "feasible_at_recipe_resolution" ? "covered_by_approved_recipe" : binding.feasibilityState === "unsupported" ? "unsupported" : "partially_covered", applicabilityResolution: binding.applicabilityResults.map((item) => item.state).join(","), remainingEvidenceObligationIds: binding.hardGateResults.filter((item) => item.state !== "pass").map((item) => item.gateId), blockerIds: binding.hardGateResults.filter((item) => item.state !== "pass").flatMap((item) => item.objectRefs) }));
  const limitReached = exploredNodes >= input.capabilityProfile.limits.maximumCompositionSearchNodes;
  const base: Omit<RecipeCompositionPlan, "deterministicDigest"> = {
    compositionPlanId: circuitId("recipe-composition", { bindings: bindings.map((item) => item.deterministicDigest), recipes: [...recipes.values()].map((item) => item.deterministicDigest).sort() }),
    memberBindingIds: bindings.map((item) => item.bindingCandidateId),
    sharedPortUnificationRecords,
    sharedRoleDeduplicationRecords,
    parameterUnificationRecords: [],
    topologyMergeGraphId: circuitId("composition-topology", bindings.flatMap((item) => item.recipeRevisionIds).sort()),
    constraintMergeResults: [],
    conflicts: conflicts.sort((a, b) => a.conflictId.localeCompare(b.conflictId)),
    coverageResults,
    downstreamInstantiationPlanId: circuitId("cd8-instantiation-plan", bindings.map((item) => item.bindingCandidateId)),
    feasibilityState: limitReached ? "resource_limit" : conflicts.length ? "incomplete_blocking_unknown" : bindings.every((item) => item.feasibilityState === "feasible_at_recipe_resolution") ? "feasible_at_recipe_resolution" : "incomplete_blocking_unknown",
    searchCertificate: { exploredNodes, complete: !limitReached, prunedReasons: limitReached ? ["maximumCompositionSearchNodes"] : [] },
  };
  return { ...base, deterministicDigest: circuitDigest(base) };
}

/** Independent conflict count used to detect compiler/oracle disagreement. */
export function compositionConflictOracle(plan: RecipeCompositionPlan): { pass: boolean; conflictKinds: string[] } {
  const states: RecipeEvidenceState[] = plan.sharedPortUnificationRecords.map((item) => item.state);
  const conflictKinds = [...new Set([...plan.conflicts.map((item) => item.kind), ...(states.includes("conflict") ? ["port_contract_conflict"] : [])])].sort();
  return { pass: conflictKinds.length === 0 && plan.searchCertificate.complete, conflictKinds };
}
