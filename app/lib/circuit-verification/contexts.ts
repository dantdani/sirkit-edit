import type { SchematicSemanticGraph, VariantGraphProjection } from "../schematic-compiler/types";
import { finalizeVerification, uniqueSorted, verificationDigest, verificationId } from "./stable";
import type { Cd9Diagnostic, CircuitVerificationCapabilityProfile, CircuitVerificationProblem, RequiredRuleDenominator, RequiredRuleInstance, RuleApplicabilityRecord, RuleRegistrySnapshot, RuleSelector, RuleTargetKind, VerificationContext } from "./types";

export function compileVerificationContexts(input: { problem: CircuitVerificationProblem; graph: SchematicSemanticGraph; additionalContexts?: Array<{ variantId: string; contextKind: VerificationContext["contextKind"]; factRefs: string[]; assumptionRefs?: string[] }> }): VerificationContext[] {
  const contexts: VerificationContext[] = [];
  const requested = input.problem.requiredContextKinds.length ? input.problem.requiredContextKinds : ["static_unpowered", "static_powered"];
  for (const variantId of input.graph.variantIds) for (const kind of requested) {
    const supported = ["static_unpowered", "static_powered", "startup", "shutdown", "programming", "external_power_present"].includes(kind);
    const body = { variantId, contextKind: (supported ? kind : "project_defined") as VerificationContext["contextKind"], factRefs: [] as string[], assumptionRefs: [] as string[], completeness: (supported && ["static_unpowered", "static_powered"].includes(kind) ? "complete" : "unknown") as VerificationContext["completeness"] };
    contexts.push(finalizeVerification<VerificationContext>({ ...body, contextId: verificationId("verification-context", body), deterministicDigest: "" }));
  }
  for (const additional of input.additionalContexts ?? []) {
    if (!input.graph.variantIds.includes(additional.variantId)) continue;
    const body = { variantId: additional.variantId, contextKind: additional.contextKind, factRefs: uniqueSorted(additional.factRefs), assumptionRefs: uniqueSorted(additional.assumptionRefs ?? []), completeness: additional.factRefs.length ? "complete" as const : "unknown" as const };
    contexts.push(finalizeVerification<VerificationContext>({ ...body, contextId: verificationId("verification-context", body), deterministicDigest: "" }));
  }
  return [...new Map(contexts.map((item) => [item.contextId, item])).values()].sort((a, b) => a.variantId.localeCompare(b.variantId) || a.contextKind.localeCompare(b.contextKind));
}

type Selectable = Record<string, unknown> & { id: string };

function selectableTargets(target: RuleTargetKind, graph: SchematicSemanticGraph, projections: VariantGraphProjection[], requirementIds: string[]): Selectable[] {
  switch (target) {
    case "graph": return [{ id: graph.graphId, validationState: graph.validationState }];
    case "component": return graph.components.map((item) => ({ ...item, id: item.componentInstanceId }));
    case "pin": return graph.pins.map((item) => ({ ...item, id: item.pinInstanceId }));
    case "net": return graph.nets.map((item) => ({ ...item, id: item.netId }));
    case "endpoint": return graph.endpoints.map((item) => ({ ...item, id: item.endpointId }));
    case "disposition": return graph.terminalDispositions.map((item) => ({ ...item, id: item.dispositionId }));
    case "rail": return graph.railGroundRegistry.railDefinitions.map((item) => ({ ...item, id: item.definitionId }));
    case "tie": return graph.railGroundRegistry.explicitTies.map((item) => ({ ...item, id: item.tieId }));
    case "port_binding": return graph.portBindings.map((item) => ({ ...item, id: item.bindingId }));
    case "variant_projection": return projections.map((item) => ({ ...item, id: item.projectionId }));
    case "requirement": return requirementIds.map((id) => ({ id }));
  }
}

function matches(item: Selectable, selector: RuleSelector): boolean {
  return (selector.predicates ?? []).every((predicate) => {
    const actual = item[predicate.field];
    if (predicate.operator === "exists") return predicate.value === false ? actual === undefined : actual !== undefined;
    if (predicate.operator === "equals") return actual === predicate.value;
    if (predicate.operator === "not_equals") return actual !== predicate.value;
    return Array.isArray(predicate.value) && predicate.value.includes(String(actual));
  });
}

function diag(code: string, message: string, refs: string[]): Cd9Diagnostic {
  const body = { code, severity: "blocking" as const, message, objectRefs: uniqueSorted(refs), sourceRefs: [], ownerStage: "CD-9" as const, minimumSafeAction: "Correct applicability inputs or the bounded selector; do not treat a missing target as a pass." };
  return { ...body, diagnosticId: verificationId("diagnostic", body) };
}

export function compileRequiredRuleDenominator(input: { problem: CircuitVerificationProblem; graph: SchematicSemanticGraph; projections: VariantGraphProjection[]; registry: RuleRegistrySnapshot; capabilityProfile: CircuitVerificationCapabilityProfile; contexts: VerificationContext[] }): RequiredRuleDenominator {
  const applicability: RuleApplicabilityRecord[] = [];
  const instances: RequiredRuleInstance[] = [];
  const diagnostics: Cd9Diagnostic[] = [];
  const approvedRules = input.registry.rules.filter((item) => item.lifecycleState === "approved");
  if (input.registry.lifecycleState !== "approved") diagnostics.push(diag("CD9_DENOMINATOR_REGISTRY_NOT_APPROVED", "A draft registry cannot define a readiness denominator.", [input.registry.registryId]));
  const requirements = input.problem.requirementRevisionRefs.map((item) => item.requirementId);
  for (const rule of approvedRules) for (const context of input.contexts) {
    const projection = input.projections.find((item) => item.variantId === context.variantId);
    let targets = selectableTargets(rule.selector.target, input.graph, input.projections.filter((item) => item.variantId === context.variantId), requirements).filter((item) => matches(item, rule.selector));
    const limit = Math.min(rule.selector.limit ?? input.capabilityProfile.limits.maximumSelectorResults, input.capabilityProfile.limits.maximumSelectorResults);
    const exceeded = targets.length > limit;
    targets = targets.slice(0, limit);
    const min = rule.selector.expectedCardinality?.minimum ?? 0;
    const max = rule.selector.expectedCardinality?.maximum;
    const cardinalityInvalid = targets.length < min || max !== undefined && targets.length > max;
    const contextState = !projection && rule.selector.target !== "graph" && rule.selector.target !== "requirement" ? "blocked_missing_input" as const : context.completeness === "unsupported" ? "unsupported" as const : context.completeness === "unknown" ? "unknown" as const : exceeded ? "internal_error" as const : cardinalityInvalid ? "blocked_missing_input" as const : targets.length ? "applicable" as const : "not_applicable" as const;
    const selected = targets.length ? targets.map((item) => [item.id]) : [[]];
    for (const targetIds of selected) {
      const appBody = { ruleId: rule.ruleId, ruleDigest: rule.deterministicDigest, contextId: context.contextId, targetIds, state: contextState, reasonCode: contextState === "applicable" ? "SELECTOR_MATCH" : contextState === "not_applicable" ? "SELECTOR_EMPTY_VALID" : contextState === "unknown" ? "CONTEXT_FACTS_INCOMPLETE" : contextState === "unsupported" ? "CONTEXT_UNSUPPORTED" : exceeded ? "SELECTOR_RESOURCE_LIMIT" : "SELECTOR_CARDINALITY_OR_PROJECTION_MISSING", evidenceRefs: [...rule.evidenceRefs, ...context.factRefs] };
      const app = finalizeVerification<RuleApplicabilityRecord>({ ...appBody, applicabilityId: verificationId("applicability", appBody), deterministicDigest: "" });
      applicability.push(app);
      const instanceBody = { ruleId: rule.ruleId, ruleDigest: rule.deterministicDigest, category: rule.category, contextId: context.contextId, variantId: context.variantId, targetIds, applicabilityId: app.applicabilityId, required: true as const };
      instances.push(finalizeVerification<RequiredRuleInstance>({ ...instanceBody, instanceId: verificationId("rule-instance", instanceBody), deterministicDigest: "" }));
    }
    if (exceeded) diagnostics.push(diag("CD9_SELECTOR_RESOURCE_LIMIT", `Rule ${rule.ruleId} exceeded its bounded selector limit.`, [rule.ruleId, context.contextId]));
    if (cardinalityInvalid) diagnostics.push(diag("CD9_SELECTOR_CARDINALITY_INVALID", `Rule ${rule.ruleId} selector cardinality is outside its declared bounds.`, [rule.ruleId, context.contextId]));
  }
  if (instances.length > input.capabilityProfile.limits.maximumRuleInstances) diagnostics.push(diag("CD9_DENOMINATOR_RESOURCE_LIMIT", "The explicit required rule-instance denominator exceeds the approved limit.", []));
  const categoryCoverage = input.capabilityProfile.requiredCategories.map((category) => {
    const rules = approvedRules.filter((item) => item.category === category);
    const supported = input.capabilityProfile.supportedCategories.includes(category);
    return { category, state: (!rules.length ? "missing" : !supported ? "unsupported" : "covered") as "covered" | "missing" | "unsupported", ruleIds: rules.map((item) => item.ruleId).sort() };
  });
  const variantCoverage = input.graph.variantIds.map((variantId) => { const contextIds = input.contexts.filter((item) => item.variantId === variantId).map((item) => item.contextId).sort(); return { variantId, contextIds, state: contextIds.length ? "covered" as const : "missing" as const }; });
  const nonVacuous = approvedRules.length > 0 && instances.length >= approvedRules.length && variantCoverage.every((item) => item.state === "covered");
  if (!nonVacuous) diagnostics.push(diag("CD9_DENOMINATOR_VACUOUS", "The required verification denominator is empty or omits a variant.", []));
  const body = { graphDigest: input.graph.deterministicDigest, registryDigest: input.registry.deterministicDigest, contextDigest: verificationDigest(input.contexts), instances: instances.sort((a, b) => a.instanceId.localeCompare(b.instanceId)), applicability: applicability.sort((a, b) => a.applicabilityId.localeCompare(b.applicabilityId)), categoryCoverage, variantCoverage, nonVacuous, diagnostics: diagnostics.sort((a, b) => a.code.localeCompare(b.code)) };
  return finalizeVerification<RequiredRuleDenominator>({ ...body, denominatorId: verificationId("required-denominator", body), deterministicDigest: "" });
}

export function validateRequiredRuleDenominator(input: { denominator: RequiredRuleDenominator; problem: CircuitVerificationProblem; registry: RuleRegistrySnapshot; capabilityProfile: CircuitVerificationCapabilityProfile }): string[] {
  const { denominator, problem, registry, capabilityProfile } = input;
  const errors: string[] = [];
  if (!denominator || denominator.graphDigest !== problem.semanticGraphDigest || denominator.registryDigest !== registry.deterministicDigest) errors.push("CD9_DENOMINATOR_PIN_MISMATCH");
  if (denominator?.deterministicDigest !== finalizeVerification(denominator).deterministicDigest) errors.push("CD9_DENOMINATOR_DIGEST_MISMATCH");
  if (!denominator?.nonVacuous || !denominator.instances.length || denominator.instances.length !== denominator.applicability.length) errors.push("CD9_DENOMINATOR_VACUOUS_OR_CARDINALITY_INVALID");
  const approvedRules = registry.rules.filter((item) => item.lifecycleState === "approved");
  for (const instance of denominator?.instances ?? []) {
    const rule = approvedRules.find((item) => item.ruleId === instance.ruleId && item.deterministicDigest === instance.ruleDigest);
    const applicability = denominator.applicability.find((item) => item.applicabilityId === instance.applicabilityId && item.ruleId === instance.ruleId && item.ruleDigest === instance.ruleDigest && item.contextId === instance.contextId);
    if (!rule || !applicability || instance.category !== rule.category || !problem.requiredVariantIds.includes(instance.variantId)) errors.push(`CD9_DENOMINATOR_INSTANCE_INVALID:${instance.instanceId}`);
  }
  for (const variantId of problem.requiredVariantIds) if (!denominator.variantCoverage.some((item) => item.variantId === variantId && item.state === "covered" && item.contextIds.length > 0)) errors.push(`CD9_DENOMINATOR_VARIANT_MISSING:${variantId}`);
  for (const category of capabilityProfile.requiredCategories) {
    const expectedRules = approvedRules.filter((item) => item.category === category).map((item) => item.ruleId).sort();
    const expectedState = expectedRules.length === 0 ? "missing" : capabilityProfile.supportedCategories.includes(category) ? "covered" : "unsupported";
    const actual = denominator.categoryCoverage.find((item) => item.category === category);
    if (!actual || actual.state !== expectedState || actual.ruleIds.join("\0") !== expectedRules.join("\0")) errors.push(`CD9_DENOMINATOR_CATEGORY_INVALID:${category}`);
  }
  return [...new Set(errors)].sort();
}
