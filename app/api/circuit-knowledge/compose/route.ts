import { EMBEDDED_CIRCUIT_KNOWLEDGE_PROFILE_V1 } from "@/app/lib/circuit-knowledge/capability";
import { composeRecipeBindings, compositionConflictOracle } from "@/app/lib/circuit-knowledge/composition";
import type { CircuitRecipeDefinition, RecipeBindingCandidate } from "@/app/lib/circuit-knowledge/types";
import { scopedJson } from "../_scope";
export const runtime = "nodejs";
export async function POST(request: Request): Promise<Response> {
  const parsed = await scopedJson(request); if (!parsed.ok) return parsed.response; const { body } = parsed;
  if (!Array.isArray(body.bindings) || !Array.isArray(body.recipes)) return Response.json({ ok: false, error: "bindings and recipes arrays are required" }, { status: 400 });
  const plan = composeRecipeBindings({ bindings: body.bindings as RecipeBindingCandidate[], recipes: body.recipes as CircuitRecipeDefinition[], capabilityProfile: EMBEDDED_CIRCUIT_KNOWLEDGE_PROFILE_V1 });
  const oracle = compositionConflictOracle(plan);
  return Response.json({ ok: plan.feasibilityState === "feasible_at_recipe_resolution", plan, oracle }, { status: plan.feasibilityState === "resource_limit" ? 422 : 200, headers: { "Cache-Control": "no-store" } });
}
