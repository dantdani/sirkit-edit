import { compareQuantities } from "../constraints/quantity";
import { canonicalTopologyGraphDigest, validateRecipeTopology } from "./graph";
import { circuitDigest } from "./stable";
import type { CircuitRecipeDefinition, RecipeParameterDefinition, RecipeVariantOverlay } from "./types";

export interface RecipeOverlayResult { ok: boolean; recipe: CircuitRecipeDefinition; diagnostics: string[]; }

function objectPayload(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  if (["__proto__", "prototype", "constructor"].some((key) => Object.prototype.hasOwnProperty.call(payload, key))) return null;
  return payload;
}

function tightenParameter(target: RecipeParameterDefinition, payload: Record<string, unknown>): string | null {
  const allowed = new Set(["allowedRangeOrSet", "conditions", "requiredForStages", "uncertaintyPolicy", "evidenceRefs"]);
  if (Object.keys(payload).some((key) => !allowed.has(key))) return "RECIPE_OVERLAY_TIGHTEN_FIELD_FORBIDDEN";
  if (payload.allowedRangeOrSet && typeof payload.allowedRangeOrSet === "object") {
    const proposed = payload.allowedRangeOrSet as RecipeParameterDefinition["allowedRangeOrSet"];
    if (proposed?.min && target.allowedRangeOrSet?.min && compareQuantities(proposed.min, target.allowedRangeOrSet.min) < 0) return "RECIPE_OVERLAY_RANGE_WIDENING_FORBIDDEN";
    if (proposed?.max && target.allowedRangeOrSet?.max && compareQuantities(proposed.max, target.allowedRangeOrSet.max) > 0) return "RECIPE_OVERLAY_RANGE_WIDENING_FORBIDDEN";
    if (proposed?.min && proposed.max && compareQuantities(proposed.min, proposed.max) > 0) return "RECIPE_OVERLAY_EMPTY_RANGE";
  }
  Object.assign(target, structuredClone(payload));
  return null;
}

export function validateRecipeOverlay(overlay: RecipeVariantOverlay, recipe: CircuitRecipeDefinition): string[] {
  const errors: string[] = [];
  if (overlay.targetRecipeId !== recipe.recipeId) errors.push("RECIPE_OVERLAY_TARGET_MISMATCH");
  if (!overlay.targetFamilyPartPackageProjectIds.length) errors.push("RECIPE_OVERLAY_SCOPE_TARGET_MISSING");
  if (!overlay.requiredEvidenceRefs.length || overlay.refinements.some((item) => !item.authorityEvidenceRefs.length)) errors.push("RECIPE_OVERLAY_EVIDENCE_MISSING");
  if (overlay.deterministicDigest !== circuitDigest({ ...overlay, deterministicDigest: undefined })) errors.push("RECIPE_OVERLAY_DIGEST_MISMATCH");
  if (overlay.scopeKind === "generic_class") errors.push("RECIPE_OVERLAY_GENERIC_SCOPE_FORBIDDEN");
  if (new Set(overlay.refinements.map((item) => `${item.targetType}:${item.targetId}:${item.operation}`)).size !== overlay.refinements.length) errors.push("RECIPE_OVERLAY_DUPLICATE_REFINEMENT");
  return errors.sort();
}

export function applyApprovedRecipeOverlay(recipeInput: CircuitRecipeDefinition, overlayInput: RecipeVariantOverlay): RecipeOverlayResult {
  const recipe = structuredClone(recipeInput);
  const overlay = structuredClone(overlayInput);
  const diagnostics = validateRecipeOverlay(overlay, recipe);
  if (overlay.reviewState !== "approved" || overlay.lifecycleState !== "approved") diagnostics.push("RECIPE_OVERLAY_NOT_APPROVED");
  if (diagnostics.length) return { ok: false, recipe, diagnostics: [...new Set(diagnostics)].sort() };
  const evidence = new Set(overlay.requiredEvidenceRefs);
  const collections: Record<string, Array<Record<string, unknown>>> = {
    port: recipe.ports as unknown as Array<Record<string, unknown>>,
    role: recipe.componentRoleSlots as unknown as Array<Record<string, unknown>>,
    terminal: recipe.terminalRoleContracts as unknown as Array<Record<string, unknown>>,
    parameter: recipe.parameters as unknown as Array<Record<string, unknown>>,
    equation: recipe.equationModels as unknown as Array<Record<string, unknown>>,
    constraint: recipe.constraintTemplates as unknown as Array<Record<string, unknown>>,
  };
  const idField: Record<string, string> = { port: "portId", role: "roleSlotId", terminal: "terminalRoleId", parameter: "parameterId", equation: "modelId", constraint: "constraintTemplateId" };
  for (const refinement of [...overlay.refinements].sort((a, b) => `${a.targetType}:${a.targetId}`.localeCompare(`${b.targetType}:${b.targetId}`))) {
    if (refinement.authorityEvidenceRefs.some((id) => !evidence.has(id))) { diagnostics.push("RECIPE_OVERLAY_AUTHORITY_EVIDENCE_NOT_DECLARED"); continue; }
    const payload = objectPayload(refinement.payload);
    if (!payload) { diagnostics.push("RECIPE_OVERLAY_PAYLOAD_INVALID"); continue; }
    if (refinement.targetType === "topology") { diagnostics.push("RECIPE_OVERLAY_TOPOLOGY_REQUIRES_NEW_RECIPE_REVISION"); continue; }
    const collection = collections[refinement.targetType];
    const identity = idField[refinement.targetType];
    if (!collection || !identity) { diagnostics.push("RECIPE_OVERLAY_TARGET_TYPE_UNSUPPORTED"); continue; }
    const index = collection.findIndex((item) => item[identity] === refinement.targetId);
    if (refinement.operation === "add") {
      if (index >= 0 || payload[identity] !== refinement.targetId) diagnostics.push("RECIPE_OVERLAY_ADD_ID_INVALID");
      else collection.push(structuredClone(payload));
      continue;
    }
    if (index < 0) { diagnostics.push("RECIPE_OVERLAY_TARGET_ORPHAN"); continue; }
    if (refinement.operation === "prohibit") { collection.splice(index, 1); continue; }
    if (refinement.operation === "replace") {
      if (!["exact_atomic_part", "exact_package", "project_restricted_novel_overlay"].includes(overlay.scopeKind) || payload[identity] !== refinement.targetId) diagnostics.push("RECIPE_OVERLAY_REPLACE_SCOPE_OR_ID_INVALID");
      else collection[index] = structuredClone(payload);
      continue;
    }
    if (refinement.targetType !== "parameter") diagnostics.push("RECIPE_OVERLAY_TIGHTEN_UNSUPPORTED_TARGET");
    else {
      const error = tightenParameter(recipe.parameters[index], payload);
      if (error) diagnostics.push(error);
    }
  }
  if (diagnostics.length) return { ok: false, recipe: structuredClone(recipeInput), diagnostics: [...new Set(diagnostics)].sort() };
  recipe.variantOverlays = [...recipe.variantOverlays.filter((item) => item.overlayId !== overlay.overlayId), overlay].sort((a, b) => a.overlayId.localeCompare(b.overlayId));
  recipe.topologyGraph.canonicalGraphDigest = canonicalTopologyGraphDigest(recipe.topologyGraph);
  recipe.deterministicDigest = circuitDigest({ ...recipe, deterministicDigest: undefined });
  const topologyErrors = validateRecipeTopology(recipe);
  if (topologyErrors.length) return { ok: false, recipe: structuredClone(recipeInput), diagnostics: topologyErrors };
  return { ok: true, recipe, diagnostics: [] };
}
