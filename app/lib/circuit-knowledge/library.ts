import { circuitDigest, circuitId } from "./stable";
import type { CircuitRecipeLibrary } from "./types";
import { CIRCUIT_COMPILER_VERSION, EXPRESSION_MODEL_REGISTRY_VERSION } from "./types";

export function createCircuitRecipeLibrary(input: Partial<Omit<CircuitRecipeLibrary, "libraryId" | "revision" | "deterministicDigest">> & { libraryId?: string; revision?: number; createdAt: string }): CircuitRecipeLibrary {
  const base: Omit<CircuitRecipeLibrary, "deterministicDigest"> = {
    libraryId: input.libraryId ?? circuitId("recipe-library", input.createdAt),
    revision: input.revision ?? 1,
    recipePacks: structuredClone(input.recipePacks ?? []), recipes: structuredClone(input.recipes ?? []), compiledRecipes: structuredClone(input.compiledRecipes ?? []), sourceBundles: structuredClone(input.sourceBundles ?? []), proposedClaims: structuredClone(input.proposedClaims ?? []),
    compilerSchemaVersion: input.compilerSchemaVersion ?? CIRCUIT_COMPILER_VERSION,
    expressionModelRegistryRevision: input.expressionModelRegistryRevision ?? EXPRESSION_MODEL_REGISTRY_VERSION,
    capabilityCoverage: [...(input.capabilityCoverage ?? [])].sort(),
    publicationPolicyRevision: input.publicationPolicyRevision ?? "sirkit-recipe-publication-policy/1.0.0",
    sourceLicensePolicyRevision: input.sourceLicensePolicyRevision ?? "sirkit-recipe-license-policy/1.0.0",
    reviewerPolicyRevision: input.reviewerPolicyRevision ?? "sirkit-recipe-review-policy/1.0.0",
    createdAt: input.createdAt,
  };
  return { ...base, deterministicDigest: circuitDigest(base) };
}

export function validateCircuitRecipeLibrary(library: CircuitRecipeLibrary): string[] {
  const errors: string[] = [];
  const recipeIds = new Set(library.recipes.map((item) => item.revisionId));
  const sourceIds = new Set(library.sourceBundles.map((item) => item.sourceBundleId));
  if (recipeIds.size !== library.recipes.length) errors.push("RECIPE_LIBRARY_REVISION_ID_REUSE");
  if (sourceIds.size !== library.sourceBundles.length) errors.push("RECIPE_LIBRARY_SOURCE_ID_REUSE");
  if (library.compiledRecipes.some((item) => !recipeIds.has(item.recipeRevisionId))) errors.push("RECIPE_LIBRARY_COMPILED_ORPHAN");
  for (const pack of library.recipePacks) {
    if (pack.recipeDefinitionIds.some((id) => !recipeIds.has(id))) errors.push("RECIPE_PACK_RECIPE_ORPHAN");
    if (pack.sourceBundleIds.some((id) => !sourceIds.has(id))) errors.push("RECIPE_PACK_SOURCE_ORPHAN");
    if (pack.deterministicDigest !== circuitDigest({ ...pack, deterministicDigest: undefined })) errors.push("RECIPE_PACK_DIGEST_MISMATCH");
  }
  if (library.deterministicDigest !== circuitDigest({ ...library, deterministicDigest: undefined })) errors.push("RECIPE_LIBRARY_DIGEST_MISMATCH");
  return [...new Set(errors)].sort();
}
