import { EMBEDDED_CIRCUIT_KNOWLEDGE_PROFILE_V1 } from "@/app/lib/circuit-knowledge/capability";
import { compileCircuitRecipe } from "@/app/lib/circuit-knowledge/compiler";
import type { CircuitRecipeDefinition, RecipeSourceBundle } from "@/app/lib/circuit-knowledge/types";
import { authenticatedJsonRoute } from "@/app/lib/auth/route-handlers";
import { object, CIRCUIT_API_MAX_BYTES, CIRCUIT_API_DEADLINE_MS } from "../_scope";
export const runtime = "nodejs";
export const POST = authenticatedJsonRoute({ maxBytes: CIRCUIT_API_MAX_BYTES, deadlineMs: CIRCUIT_API_DEADLINE_MS }, async ({ body }): Promise<Response> => {
  if (!object(body.recipe) || !object(body.sourceBundle)) return Response.json({ ok: false, error: "recipe and sourceBundle are required" }, { status: 400 });
  const result = compileCircuitRecipe({ recipe: body.recipe as unknown as CircuitRecipeDefinition, sourceBundle: body.sourceBundle as unknown as RecipeSourceBundle, capabilityProfile: EMBEDDED_CIRCUIT_KNOWLEDGE_PROFILE_V1, now: new Date().toISOString() });
  return Response.json(result, { status: result.ok ? 200 : 422, headers: { "Cache-Control": "no-store" } });
});
