import { evaluateRecipeExpression, type RecipeExpressionValue } from "./expression";
import { circuitDigest, circuitId } from "./stable";
import type { ApplicabilityResult, CircuitKnowledgeCapabilityProfile, CircuitRecipeDefinition, RecipeApplicabilityState, RecipeRequest } from "./types";

export interface RecipeApplicabilityContext {
  architectureRoleKinds: string[];
  inputOutputEnvelopes: string[];
  topologyClasses: string[];
  modesStates: string[];
  environmentEnvelopeIds: string[];
  interfaceContracts: string[];
  powerGroundIsolationContracts: string[];
  componentCapabilities: string[];
  exactPartFamilyId?: string;
  exactAtomicPartRevisionId?: string;
  exactPackageRevisionId?: string;
  evidenceStates: string[];
  modelCapabilities: string[];
  activeConditions: string[];
  expressionBindings?: ReadonlyMap<string, RecipeExpressionValue>;
  staleDependencyIds?: string[];
  conflictingDependencyIds?: string[];
}

function missing(required: string[], actual: string[]): string[] {
  const set = new Set(actual);
  return required.filter((item) => !set.has(item));
}

export function evaluateRecipeApplicability(input: {
  recipe: CircuitRecipeDefinition;
  request: RecipeRequest;
  context: RecipeApplicabilityContext;
  capabilityProfile: CircuitKnowledgeCapabilityProfile;
}): ApplicabilityResult {
  const { recipe, request, context, capabilityProfile } = input;
  const matched: string[] = [];
  const failed: string[] = [];
  const unknown: string[] = [];
  const rule = recipe.applicability;
  const check = (name: string, required: string[], actual: string[]) => {
    const absent = missing(required, actual);
    (absent.length ? failed : matched).push(absent.length ? `${name}:${absent.join(",")}` : name);
  };
  if (recipe.semanticRole === request.semanticRole || request.hardCriteria.includes(recipe.semanticRole)) matched.push("semantic_role");
  else failed.push(`semantic_role:${request.semanticRole}`);
  check("architecture_roles", rule.requiredArchitectureRoleKinds, context.architectureRoleKinds);
  check("io_envelopes", rule.requiredInputOutputEnvelopes, context.inputOutputEnvelopes);
  if (rule.supportedTopologyClasses.length && !rule.supportedTopologyClasses.some((item) => context.topologyClasses.includes(item))) failed.push("topology_class"); else matched.push("topology_class");
  if (rule.supportedModesStates.length && !context.modesStates.every((item) => rule.supportedModesStates.includes(item))) failed.push("mode_state"); else matched.push("mode_state");
  if (rule.supportedEnvironmentEnvelope && !context.environmentEnvelopeIds.includes(rule.supportedEnvironmentEnvelope)) failed.push("environment_envelope"); else if (rule.supportedEnvironmentEnvelope) matched.push("environment_envelope");
  check("interface_contracts", rule.requiredInterfaceContracts, context.interfaceContracts);
  check("power_ground_contracts", rule.requiredPowerGroundIsolationContracts, context.powerGroundIsolationContracts);
  check("component_capabilities", rule.requiredComponentCapabilities, context.componentCapabilities);
  check("model_capabilities", rule.requiredModelCapabilities, context.modelCapabilities);
  check("evidence_states", rule.requiredEvidenceStates, context.evidenceStates);
  if (rule.forbiddenConditions.some((item) => context.activeConditions.includes(item))) failed.push("forbidden_condition");
  if (rule.excludedPartOrPackageIds.some((item) => [context.exactPartFamilyId, context.exactAtomicPartRevisionId, context.exactPackageRevisionId].includes(item))) failed.push("explicit_part_package_exclusion");
  const exactChecks: Array<[string, string[], string | undefined]> = [
    ["part_family", rule.allowedPartFamilyIds, context.exactPartFamilyId],
    ["atomic_part", rule.allowedAtomicPartRevisionIds, context.exactAtomicPartRevisionId],
    ["package", rule.allowedPackageRevisionIds, context.exactPackageRevisionId],
  ];
  for (const [name, allowed, selected] of exactChecks) {
    if (!allowed.length) continue;
    if (!selected) unknown.push(`${name}:binding_required`);
    else (allowed.includes(selected) ? matched : failed).push(name);
  }
  for (const predicate of rule.capabilityProfilePredicates) {
    const supported = capabilityProfile.supportedSemanticDomains.includes(predicate) || capabilityProfile.supportedRecipeRoles.includes(predicate);
    (supported ? matched : failed).push(`profile:${predicate}`);
  }
  if (request.exactOverlayRequired && !["exact_atomic_part", "exact_package"].includes(recipe.abstractionLevel)) unknown.push("exact_overlay_required");
  if (rule.expression) {
    const result = evaluateRecipeExpression({ expression: rule.expression, parameterDefinitions: recipe.parameters, bindings: context.expressionBindings, capabilityProfile });
    if (result.state === "value" && result.value === true) matched.push("applicability_expression");
    else if (result.state === "value" && result.value === false) failed.push("applicability_expression");
    else if (result.state === "resource_limit") failed.push("applicability_expression_resource_limit");
    else unknown.push(`applicability_expression:${result.diagnostics.join(",")}`);
  }
  let state: RecipeApplicabilityState = failed.length ? "false" : unknown.length ? "unknown" : "true";
  if (context.conflictingDependencyIds?.length) state = "conflict";
  else if (context.staleDependencyIds?.length) state = "stale";
  else if (capabilityProfile.unsupportedDomains.includes(recipe.semanticDomain) || recipe.securitySafetyClass === "unsupported") state = "unsupported";
  const base = {
    applicabilityResultId: circuitId("recipe-applicability", { recipe: recipe.revisionId, request: request.requestId, context }),
    recipeRevisionId: recipe.revisionId,
    requestId: request.requestId,
    state,
    matchedPredicates: [...new Set(matched)].sort(),
    failedPredicates: [...new Set(failed)].sort(),
    unknownPredicates: [...new Set(unknown)].sort(),
    explanation: state === "true" ? "All declared hard applicability predicates are satisfied at recipe resolution." : `Applicability is ${state}; failed=${failed.length}, unknown=${unknown.length}.`,
    blockerIds: [...new Set([...failed, ...unknown, ...(context.staleDependencyIds ?? []), ...(context.conflictingDependencyIds ?? [])])].sort(),
  };
  return { ...base, deterministicDigest: circuitDigest(base) };
}
