import { compareQuantities, validateQuantity } from "../constraints/quantity";
import { countRecipeExpressionNodes, inferRecipeExpressionType } from "./expression";
import { canonicalTopologyGraphDigest, validateRecipeTopology } from "./graph";
import { findRecipeModelAdapter } from "./model-registry";
import { circuitDigest, circuitId } from "./stable";
import { licensePermitsRecipeUse, validateRecipeSourceBundle } from "./source";
import type { CircuitDiagnostic, CircuitHandoff, CircuitKnowledgeCapabilityProfile, CircuitRecipeDefinition, CompiledCircuitRecipe, RecipeSourceBundle } from "./types";
import { CIRCUIT_COMPILER_VERSION, CIRCUIT_RECIPE_SCHEMA_VERSION } from "./types";

export type CircuitRecipeCompileResult = { ok: true; compiled: CompiledCircuitRecipe } | { ok: false; compiled: CompiledCircuitRecipe };

function diagnostic(code: string, recipe: CircuitRecipeDefinition, refs: string[] = [], evidence: string[] = [], severity: CircuitDiagnostic["severity"] = "blocking"): CircuitDiagnostic {
  return { diagnosticId: circuitId("recipe-diagnostic", { code, recipe: recipe.revisionId, refs, evidence }), code, severity, message: code.replaceAll("_", " ").toLowerCase(), recipeOrElementRefs: [...new Set([recipe.revisionId, ...refs])].sort(), sourceEvidenceRefs: [...new Set(evidence)].sort(), requirementRefs: [], conditionScope: [], lifecycleImpact: severity === "blocking" ? "publication_block" : "quarantine", remedy: "Correct the typed recipe source, review, or contract and issue a new immutable revision.", affectedConsumers: ["CD-5", "CD-6", "CD-7", "CD-8"] };
}

function collectExpressions(recipe: CircuitRecipeDefinition): Array<{ id: string; expression: import("./types").RecipeExpression }> {
  const expressions: Array<{ id: string; expression: import("./types").RecipeExpression }> = [];
  for (const model of recipe.equationModels) {
    if (model.expression.kind !== "registered_adapter") expressions.push({ id: model.modelId, expression: model.expression });
    model.validDomainExpressions.forEach((expression, index) => expressions.push({ id: `${model.modelId}:domain:${index}`, expression }));
  }
  if (recipe.applicability.expression) expressions.push({ id: recipe.applicability.applicabilityRuleId, expression: recipe.applicability.expression });
  recipe.topologyGraph.connectionRules.forEach((rule) => { if (rule.conditionExpression) expressions.push({ id: rule.connectionRuleId, expression: rule.conditionExpression }); });
  recipe.constraintTemplates.forEach((constraint) => { if (constraint.quantityOrConditionExpression) expressions.push({ id: constraint.constraintTemplateId, expression: constraint.quantityOrConditionExpression }); });
  return expressions;
}

function validateEvidence(recipe: CircuitRecipeDefinition, source: RecipeSourceBundle): string[] {
  const valid = new Set(source.evidence.map((item) => item.id));
  const refs = [
    ...recipe.applicability.sourceEvidenceRefs,
    ...recipe.ports.flatMap((item) => item.evidenceRefs),
    ...recipe.componentRoleSlots.flatMap((item) => item.evidenceRefs),
    ...recipe.terminalRoleContracts.flatMap((item) => item.evidenceRefs),
    ...recipe.topologyGraph.connectionRules.flatMap((item) => item.evidenceRefs),
    ...recipe.parameters.flatMap((item) => item.evidenceRefs),
    ...recipe.equationModels.flatMap((item) => item.sourceEvidenceRefs),
    ...recipe.decisionPoints.flatMap((item) => item.evidenceRefs),
    ...recipe.constraintTemplates.flatMap((item) => item.evidenceRefs),
    ...recipe.simulationContracts.flatMap((item) => item.evidenceRefs),
  ];
  const errors: string[] = [];
  if (refs.some((id) => !valid.has(id))) errors.push("RECIPE_EVIDENCE_REFERENCE_ORPHAN");
  if (!recipe.applicability.sourceEvidenceRefs.length) errors.push("RECIPE_APPLICABILITY_EVIDENCE_MISSING");
  if (source.conflicts.some((item) => item.state === "open" && item.evidenceIds.some((id) => refs.includes(id)))) errors.push("RECIPE_REFERENCES_OPEN_SOURCE_CONFLICT");
  const authorities = new Map(source.sourceAuthority.map((item) => [item.evidenceId, item.state]));
  if (refs.some((id) => authorities.get(id) !== "authoritative" && authorities.get(id) !== "supporting")) errors.push("RECIPE_EVIDENCE_AUTHORITY_UNASSESSED");
  return errors;
}

function createHandoffs(recipe: CircuitRecipeDefinition): CircuitHandoff[] {
  const base = { sourceElementIds: [recipe.revisionId], invalidationDependencies: [recipe.deterministicDigest] };
  return [
    { ...base, handoffId: circuitId("circuit-handoff", [recipe.revisionId, "CD-6"]), targetStage: "CD-6", kind: "component_role_and_capability_requirements", contract: { roleSlots: recipe.componentRoleSlots.map((item) => item.roleSlotId), noExactPartSelected: true }, state: "planned_not_verified" },
    { ...base, handoffId: circuitId("circuit-handoff", [recipe.revisionId, "CD-7"]), targetStage: "CD-7", kind: "parameter_equation_and_decision_contract", contract: { parameterIds: recipe.parameters.map((item) => item.parameterId), equationModelIds: recipe.equationModels.map((item) => item.modelId), noExactValueSelected: true }, state: "planned_not_verified" },
    { ...base, handoffId: circuitId("circuit-handoff", [recipe.revisionId, "CD-8"]), targetStage: "CD-8", kind: "semantic_topology_instantiation_contract", contract: { topologyDigest: recipe.topologyGraph.canonicalGraphDigest, terminalRoleIds: recipe.terminalRoleContracts.map((item) => item.terminalRoleId), noNetOrPinInstantiation: true }, state: "planned_not_verified" },
    { ...base, handoffId: circuitId("circuit-handoff", [recipe.revisionId, "CD-9"]), targetStage: "CD-9", kind: "simulation_contracts", contract: { simulationContractIds: recipe.simulationContracts.map((item) => item.simulationContractId), resultsClaimed: false }, state: recipe.simulationContracts.some((item) => item.state === "unsupported") ? "unsupported" : "planned_not_verified" },
    { ...base, handoffId: circuitId("circuit-handoff", [recipe.revisionId, "PCB-6"]), targetStage: "PCB-6", kind: "constraint_templates", contract: { constraintTemplateIds: recipe.constraintTemplates.map((item) => item.constraintTemplateId), coordinatesClaimed: false }, state: "planned_not_verified" },
  ];
}

export function compileCircuitRecipe(input: { recipe: CircuitRecipeDefinition; sourceBundle: RecipeSourceBundle; capabilityProfile: CircuitKnowledgeCapabilityProfile; now?: string }): CircuitRecipeCompileResult {
  const recipe = structuredClone(input.recipe);
  const diagnostics: CircuitDiagnostic[] = [];
  const add = (code: string, refs: string[] = [], evidence: string[] = [], severity: CircuitDiagnostic["severity"] = "blocking") => diagnostics.push(diagnostic(code, recipe, refs, evidence, severity));
  if (recipe.schemaVersion !== CIRCUIT_RECIPE_SCHEMA_VERSION || !recipe.recipeId || !recipe.revisionId) add("RECIPE_IDENTITY_INVALID");
  if (recipe.deterministicDigest !== circuitDigest({ ...recipe, deterministicDigest: undefined })) add("RECIPE_DIGEST_MISMATCH");
  if (recipe.evidenceBundle.sourceBundleId !== input.sourceBundle.sourceBundleId) add("RECIPE_SOURCE_BUNDLE_MISMATCH");
  for (const code of validateRecipeSourceBundle(input.sourceBundle, { now: input.now, publicationScope: recipe.lifecycleState === "published" ? "public_library" : "private_review" })) add(code);
  for (const code of validateRecipeTopology(recipe)) add(code);
  for (const code of validateEvidence(recipe, input.sourceBundle)) add(code);

  const profile = input.capabilityProfile;
  if (profile.unsupportedDomains.includes(recipe.semanticDomain) || recipe.securitySafetyClass === "unsupported") add("RECIPE_DOMAIN_UNSUPPORTED");
  if (profile.externalReviewRoles.includes(recipe.semanticRole) && recipe.securitySafetyClass !== "external_review_required") add("RECIPE_EXTERNAL_REVIEW_CLASS_REQUIRED");
  if (!profile.supportedRecipeRoles.includes(recipe.semanticRole) && !profile.externalReviewRoles.includes(recipe.semanticRole)) add("RECIPE_ROLE_OUTSIDE_CAPABILITY_PROFILE");
  if (recipe.ports.length > profile.limits.maximumPortsPerRecipe || recipe.componentRoleSlots.length > profile.limits.maximumRolesPerRecipe || recipe.topologyGraph.connectionRules.length > profile.limits.maximumEdgesPerRecipe) add("RECIPE_RESOURCE_LIMIT_EXCEEDED");

  const parameterMap = new Map(recipe.parameters.map((item) => [item.parameterId, item]));
  if (parameterMap.size !== recipe.parameters.length) add("RECIPE_PARAMETER_ID_REUSE");
  for (const parameter of recipe.parameters) {
    if (parameter.allowedRangeOrSet?.min && validateQuantity(parameter.allowedRangeOrSet.min).length) add("RECIPE_PARAMETER_RANGE_INVALID", [parameter.parameterId]);
    if (parameter.allowedRangeOrSet?.max && validateQuantity(parameter.allowedRangeOrSet.max).length) add("RECIPE_PARAMETER_RANGE_INVALID", [parameter.parameterId]);
    if (parameter.allowedRangeOrSet?.min && parameter.allowedRangeOrSet.max && compareQuantities(parameter.allowedRangeOrSet.min, parameter.allowedRangeOrSet.max) > 0) add("RECIPE_PARAMETER_RANGE_REVERSED", [parameter.parameterId]);
    if (["specification_constant", "exact_part_fact", "exact_package_fact"].includes(parameter.valueState) && !parameter.evidenceRefs.length) add("RECIPE_PARAMETER_EVIDENCE_MISSING", [parameter.parameterId]);
    if (parameter.defaultPolicy !== "none" && parameter.valueState === "unknown") add("RECIPE_UNKNOWN_PARAMETER_DEFAULT_FORBIDDEN", [parameter.parameterId]);
  }
  const expressions = collectExpressions(recipe);
  let expressionNodeCount = 0;
  for (const item of expressions) {
    expressionNodeCount += countRecipeExpressionNodes(item.expression);
    if (inferRecipeExpressionType(item.expression, parameterMap) === "unknown") add("RECIPE_EXPRESSION_STATIC_TYPE_INVALID", [item.id]);
  }
  if (expressionNodeCount > profile.limits.maximumExpressionNodes) add("RECIPE_EXPRESSION_NODE_LIMIT_EXCEEDED");
  for (const model of recipe.equationModels) {
    if (model.inputParameterIds.some((id) => !parameterMap.has(id)) || model.outputParameterIds.some((id) => !parameterMap.has(id))) add("RECIPE_EQUATION_PARAMETER_ORPHAN", [model.modelId]);
    if (!model.sourceEvidenceRefs.length || !model.oracleTestIds.length || !model.validDomainExpressions.length) add("RECIPE_EQUATION_ASSURANCE_INCOMPLETE", [model.modelId]);
    if (model.downstreamStageOwner !== "CD-7") add("RECIPE_EQUATION_STAGE_OWNERSHIP_INVALID", [model.modelId]);
    if (model.outputParameterIds.length !== 1) add("RECIPE_EQUATION_SINGLE_OUTPUT_REQUIRED", [model.modelId]);
    if (model.expression.kind === "registered_adapter") {
      const adapter = findRecipeModelAdapter(model.expression.adapterId, model.expression.version);
      if (!adapter) add("RECIPE_MODEL_ADAPTER_UNREGISTERED", [model.modelId]);
      else {
        const inputTypes = model.inputParameterIds.map((id) => parameterMap.get(id)?.quantityType);
        const outputTypes = model.outputParameterIds.map((id) => parameterMap.get(id)?.quantityType);
        if (JSON.stringify(inputTypes) !== JSON.stringify(adapter.inputDimensions) || JSON.stringify(outputTypes) !== JSON.stringify(adapter.outputDimensions)) add("RECIPE_MODEL_ADAPTER_SIGNATURE_MISMATCH", [model.modelId]);
      }
    }
  }
  const outputOwners = new Map<string, string>();
  for (const model of recipe.equationModels) for (const output of model.outputParameterIds) {
    if (outputOwners.has(output)) add("RECIPE_EQUATION_OUTPUT_MULTIPLE_OWNERS", [output, model.modelId]);
    outputOwners.set(output, model.modelId);
  }
  const modelDependencies = new Map(recipe.equationModels.map((model) => [model.modelId, recipe.equationModels.filter((candidate) => candidate.modelId !== model.modelId && candidate.outputParameterIds.some((output) => model.inputParameterIds.includes(output))).map((candidate) => candidate.modelId)]));
  const visiting = new Set<string>(); const visited = new Set<string>();
  const cycle = (id: string): boolean => { if (visiting.has(id)) return true; if (visited.has(id)) return false; visiting.add(id); for (const dependency of modelDependencies.get(id) ?? []) if (cycle(dependency)) return true; visiting.delete(id); visited.add(id); return false; };
  if (recipe.equationModels.some((model) => model.inputParameterIds.some((id) => model.outputParameterIds.includes(id))) || recipe.equationModels.some((model) => cycle(model.modelId))) add("RECIPE_DERIVATION_DAG_CYCLE");
  for (const overlay of recipe.variantOverlays) {
    if (overlay.targetRecipeId !== recipe.recipeId) add("RECIPE_OVERLAY_TARGET_MISMATCH", [overlay.overlayId]);
    if (overlay.reviewState !== "approved" && recipe.lifecycleState === "published") add("RECIPE_UNAPPROVED_OVERLAY_IN_PUBLISHED_RECIPE", [overlay.overlayId]);
    if (overlay.scopeKind === "project_restricted_novel_overlay" && recipe.lifecycleState === "published") add("RECIPE_PROJECT_OVERLAY_PUBLICATION_FORBIDDEN", [overlay.overlayId]);
    if (overlay.deterministicDigest !== circuitDigest({ ...overlay, deterministicDigest: undefined })) add("RECIPE_OVERLAY_DIGEST_MISMATCH", [overlay.overlayId]);
  }
  for (const simulation of recipe.simulationContracts) if (!simulation.evidenceRefs.length || !["contract_only", "unsupported", "external_review_required"].includes(simulation.state)) add("RECIPE_SIMULATION_RESULT_CLAIM_FORBIDDEN", [simulation.simulationContractId]);

  const approvedReviews = new Set(recipe.reviewRecords.filter((item) => item.decision === "approve" && item.reviewer.actorKind === "human" && item.reviewer.independent && item.deterministicDigest === circuitDigest({ ...item, deterministicDigest: undefined })).map((item) => item.reviewKind));
  const requiredReviews = [...profile.requiredReviewKinds, ...(recipe.securitySafetyClass === "external_review_required" ? ["safety_external" as const] : [])];
  for (const kind of requiredReviews) if (!approvedReviews.has(kind)) add("RECIPE_REQUIRED_REVIEW_MISSING", [kind]);
  if (recipe.lifecycleState === "published" && !recipe.publishedAt) add("RECIPE_PUBLICATION_TIME_MISSING");
  if (recipe.lifecycleState === "published" && input.sourceBundle.sources.some((source) => {
    const license = input.sourceBundle.licenses.find((item) => item.id === source.licenseId);
    return !license || !licensePermitsRecipeUse(license, "public_library");
  })) add("RECIPE_PUBLICATION_LICENSE_BLOCKED");
  if (["extracted_proposal", "quarantined", "rejected", "revoked"].includes(recipe.lifecycleState)) add("RECIPE_LIFECYCLE_NOT_BINDABLE");

  const blocking = diagnostics.some((item) => item.severity === "blocking");
  const publicationEligible = recipe.lifecycleState === "published" && !blocking;
  const base: Omit<CompiledCircuitRecipe, "deterministicDigest"> = {
    compiledRecipeId: circuitId("compiled-recipe", { revision: recipe.revisionId, compiler: CIRCUIT_COMPILER_VERSION, source: input.sourceBundle.deterministicDigest, profile: profile.deterministicDigest }),
    recipeRevisionId: recipe.revisionId,
    compilerVersion: CIRCUIT_COMPILER_VERSION,
    canonicalTopologyDigest: canonicalTopologyGraphDigest(recipe.topologyGraph),
    resolvedReferenceIds: [...new Set([input.sourceBundle.sourceBundleId, ...input.sourceBundle.evidence.map((item) => item.id), ...recipe.parameters.map((item) => item.parameterId)])].sort(),
    expressionNodeCount,
    publicationEligible,
    diagnostics: diagnostics.sort((a, b) => a.code.localeCompare(b.code)),
    constraintTemplates: structuredClone(recipe.constraintTemplates),
    verificationPlan: structuredClone(recipe.verificationPlan),
    downstreamHandoffs: createHandoffs(recipe),
  };
  const compiled = { ...base, deterministicDigest: circuitDigest(base) };
  return blocking ? { ok: false, compiled } : { ok: true, compiled };
}
