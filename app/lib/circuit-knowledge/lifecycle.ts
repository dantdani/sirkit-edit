import type { EngineeringActor } from "../engineering/types";
import { compileCircuitRecipe } from "./compiler";
import { circuitDigest } from "./stable";
import type { CircuitKnowledgeCapabilityProfile, CircuitRecipeDefinition, RecipeLifecycleState, RecipeSourceBundle } from "./types";

const TRANSITIONS: Record<RecipeLifecycleState, RecipeLifecycleState[]> = {
  draft: ["extracted_proposal", "validated", "rejected", "quarantined"], extracted_proposal: ["validated", "rejected", "quarantined"], validated: ["in_review", "rejected", "quarantined"], in_review: ["approved", "rejected", "quarantined"], approved: ["published", "deprecated", "revoked"], published: ["deprecated", "revoked", "superseded"], rejected: ["draft"], quarantined: ["draft", "rejected"], deprecated: ["revoked", "superseded"], revoked: [], superseded: ["revoked"],
};

export function transitionRecipeLifecycle(input: { recipe: CircuitRecipeDefinition; to: RecipeLifecycleState; actor: EngineeringActor; at: string; sourceBundle: RecipeSourceBundle; capabilityProfile: CircuitKnowledgeCapabilityProfile }): CircuitRecipeDefinition {
  const { recipe, to, actor } = input;
  if (!TRANSITIONS[recipe.lifecycleState].includes(to)) throw new Error("RECIPE_LIFECYCLE_TRANSITION_INVALID");
  if (["approved", "published", "deprecated", "revoked", "superseded"].includes(to) && (actor.actorKind !== "human" || !["reviewer", "project_admin"].includes(actor.role))) throw new Error("RECIPE_LIFECYCLE_HUMAN_AUTHORITY_REQUIRED");
  const next = structuredClone(recipe);
  next.lifecycleState = to;
  if (to === "published") next.publishedAt = input.at;
  next.deterministicDigest = circuitDigest({ ...next, deterministicDigest: undefined });
  if (to === "published") {
    const compiled = compileCircuitRecipe({ recipe: next, sourceBundle: input.sourceBundle, capabilityProfile: input.capabilityProfile, now: input.at });
    if (!compiled.ok || !compiled.compiled.publicationEligible) throw new Error(`RECIPE_PUBLICATION_GATE_FAILED:${compiled.compiled.diagnostics.map((item) => item.code).join(",")}`);
  }
  return next;
}

export function semanticRecipeChangeLevel(before: CircuitRecipeDefinition, after: CircuitRecipeDefinition): "patch" | "minor" | "major" {
  if (before.recipeId !== after.recipeId || before.semanticRole !== after.semanticRole || before.semanticDomain !== after.semanticDomain) return "major";
  const topologyBefore = before.topologyGraph.canonicalGraphDigest;
  const topologyAfter = after.topologyGraph.canonicalGraphDigest;
  if (topologyBefore !== topologyAfter || circuitDigest(before.ports) !== circuitDigest(after.ports) || circuitDigest(before.componentRoleSlots) !== circuitDigest(after.componentRoleSlots)) return "major";
  if (circuitDigest(before.parameters) !== circuitDigest(after.parameters) || circuitDigest(before.equationModels) !== circuitDigest(after.equationModels) || circuitDigest(before.applicability) !== circuitDigest(after.applicability)) return "minor";
  return "patch";
}
