import { evaluateRecipeApplicability, type RecipeApplicabilityContext } from "@/app/lib/circuit-knowledge/applicability";
import { EMBEDDED_CIRCUIT_KNOWLEDGE_PROFILE_V1 } from "@/app/lib/circuit-knowledge/capability";
import type { CircuitRecipeDefinition, RecipeRequest } from "@/app/lib/circuit-knowledge/types";
import { object, scopedJson } from "../_scope";
export const runtime = "nodejs";
export async function POST(request: Request): Promise<Response> {
  const parsed = await scopedJson(request); if (!parsed.ok) return parsed.response; const { body } = parsed;
  if (!object(body.recipe) || !object(body.recipeRequest) || !object(body.context)) return Response.json({ ok: false, error: "recipe, recipeRequest, and context are required" }, { status: 400 });
  const result = evaluateRecipeApplicability({ recipe: body.recipe as unknown as CircuitRecipeDefinition, request: body.recipeRequest as unknown as RecipeRequest, context: body.context as unknown as RecipeApplicabilityContext, capabilityProfile: EMBEDDED_CIRCUIT_KNOWLEDGE_PROFILE_V1 });
  return Response.json({ ok: true, result }, { headers: { "Cache-Control": "no-store" } });
}
