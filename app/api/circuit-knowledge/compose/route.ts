import { EMBEDDED_CIRCUIT_KNOWLEDGE_PROFILE_V1 } from "@/app/lib/circuit-knowledge/capability";
import { composeRecipeBindings, compositionConflictOracle } from "@/app/lib/circuit-knowledge/composition";
import type { CircuitRecipeDefinition, RecipeBindingCandidate } from "@/app/lib/circuit-knowledge/types";
import { authenticatedJsonRoute } from "@/app/lib/auth/route-handlers";
import { CIRCUIT_API_MAX_BYTES, CIRCUIT_API_DEADLINE_MS } from "../_scope";
export const runtime = "nodejs";
export const POST = authenticatedJsonRoute({ maxBytes: CIRCUIT_API_MAX_BYTES, deadlineMs: CIRCUIT_API_DEADLINE_MS }, async ({ body }): Promise<Response> => {
  if (!Array.isArray(body.bindings) || !Array.isArray(body.recipes)) return Response.json({ ok: false, error: "bindings and recipes arrays are required" }, { status: 400 });
  const plan = composeRecipeBindings({ bindings: body.bindings as RecipeBindingCandidate[], recipes: body.recipes as CircuitRecipeDefinition[], capabilityProfile: EMBEDDED_CIRCUIT_KNOWLEDGE_PROFILE_V1 });
  const oracle = compositionConflictOracle(plan);
  return Response.json({ ok: plan.feasibilityState === "feasible_at_recipe_resolution", plan, oracle }, { status: plan.feasibilityState === "resource_limit" ? 422 : 200, headers: { "Cache-Control": "no-store" } });
});
