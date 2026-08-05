import { validateSchematicGraph } from "../schematic-compiler/graph";
import type { ElectricalNet, NetEndpoint, SchematicPinInstance, VariantGraphProjection } from "../schematic-compiler/types";
import { findingFromResult } from "./identity";
import { compileRequiredRuleDenominator } from "./contexts";
import { finalizeVerification, uniqueSorted, verificationId } from "./stable";
import {
  CIRCUIT_VERIFICATION_RUN_SCHEMA,
  type Cd9Diagnostic,
  type EngineeringResult,
  type FullOracleRun,
  type RequiredRuleInstance,
  type VerificationApplicability,
  type VerificationOracleInput,
  type VerificationRuleDefinition,
  type VerificationRuleResult,
} from "./types";

const EVALUATOR_VERSION = "sirkit-cd9-full-oracle/1.0.0";
const PUSH_PULL_TYPES = new Set(["output", "power_out", "push_pull_output"]);

function diagnostic(code: string, message: string, refs: string[] = []): Cd9Diagnostic {
  const body = { code, severity: "blocking" as const, message, objectRefs: uniqueSorted(refs), sourceRefs: [], ownerStage: "CD-9" as const, minimumSafeAction: "Fix the isolated deterministic checker or its exact inputs, then rerun the complete oracle." };
  return { ...body, diagnosticId: verificationId("diagnostic", body) };
}

interface Evaluation {
  engineeringResult: EngineeringResult;
  reasonCode: string;
  message: string;
  evidenceRefs?: string[];
  remediation?: string[];
}

function applicableProjection(input: VerificationOracleInput, instance: RequiredRuleInstance): VariantGraphProjection | undefined {
  return input.projections.find((item) => item.variantId === instance.variantId);
}

function activeEndpoint(input: VerificationOracleInput, instance: RequiredRuleInstance, endpoint: NetEndpoint): boolean {
  return Boolean(applicableProjection(input, instance)?.activeEndpointIds.includes(endpoint.endpointId));
}

function endpointsForNet(input: VerificationOracleInput, instance: RequiredRuleInstance, net: ElectricalNet): NetEndpoint[] {
  return input.graph.endpoints.filter((item) => item.netId === net.netId && net.endpointIds.includes(item.endpointId) && activeEndpoint(input, instance, item));
}

function evaluateApplicable(rule: VerificationRuleDefinition, instance: RequiredRuleInstance, input: VerificationOracleInput): Evaluation {
  const graph = input.graph;
  const target = instance.targetIds[0];
  const projection = applicableProjection(input, instance);
  switch (rule.implementationRef) {
    case "builtin.graph_integrity": {
      const validation = validateSchematicGraph(graph, {
        maximumComponents: input.capabilityProfile.limits.maximumComponents,
        maximumPins: input.capabilityProfile.limits.maximumPins,
        maximumNets: input.capabilityProfile.limits.maximumNets,
        maximumEndpoints: input.capabilityProfile.limits.maximumPins,
        maximumSheets: input.capabilityProfile.limits.maximumComponents,
        maximumVariants: input.capabilityProfile.limits.maximumVariants,
      });
      return validation.valid
        ? { engineeringResult: "pass", reasonCode: "GRAPH_VALID", message: "The authoritative CD-8 semantic graph passed all structural invariants.", evidenceRefs: [graph.deterministicDigest] }
        : { engineeringResult: "violation", reasonCode: "GRAPH_INVALID", message: `The authoritative semantic graph has ${validation.diagnostics.length} blocking invariant violation(s).`, evidenceRefs: validation.diagnostics.map((item) => item.diagnosticId) };
    }
    case "builtin.variant_projection_integrity": {
      if (!projection || projection.projectionId !== target) return { engineeringResult: "unknown", reasonCode: "VARIANT_PROJECTION_MISSING", message: "The required variant projection is missing." };
      if (projection.sourceGraphRevisionId !== graph.graphId) return { engineeringResult: "stale", reasonCode: "VARIANT_PROJECTION_STALE", message: "The variant projection belongs to another graph revision." };
      return projection.unresolvedVariantConflictIds.length
        ? { engineeringResult: "violation", reasonCode: "VARIANT_CONFLICTS", message: `Variant ${instance.variantId} has unresolved population or connectivity conflicts.`, evidenceRefs: projection.unresolvedVariantConflictIds }
        : { engineeringResult: "pass", reasonCode: "VARIANT_PROJECTION_VALID", message: `Variant ${instance.variantId} has a complete deterministic projection.`, evidenceRefs: [projection.deterministicDigest] };
    }
    case "builtin.exact_component_binding": {
      const component = graph.components.find((item) => item.componentInstanceId === target);
      if (!component) return { engineeringResult: "internal_error", reasonCode: "COMPONENT_TARGET_MISSING", message: "The selected component target disappeared during evaluation." };
      const complete = component.lifecycleState === "active" && Boolean(component.exactAtomicPartRevisionId && component.exactManufacturerPartRevisionId && component.exactPackageRevisionId && component.symbolRevisionId && component.footprintRevisionId && component.mappingCertificateId && component.evidenceAndProvenanceRefs.length);
      return complete
        ? { engineeringResult: "pass", reasonCode: "EXACT_BINDING_COMPLETE", message: "The component has exact atomic, package, CAD, mapping, and provenance bindings.", evidenceRefs: component.evidenceAndProvenanceRefs }
        : { engineeringResult: "violation", reasonCode: "EXACT_BINDING_INCOMPLETE", message: "The component is missing one or more exact atomic/CAD/provenance bindings." };
    }
    case "builtin.pin_disposition_complete": {
      const pin = graph.pins.find((item) => item.pinInstanceId === target);
      if (!pin) return { engineeringResult: "internal_error", reasonCode: "PIN_TARGET_MISSING", message: "The selected pin target disappeared during evaluation." };
      const dispositions = graph.terminalDispositions.filter((item) => item.pinInstanceId === pin.pinInstanceId && item.variantScope.includes(instance.variantId));
      if (dispositions.length !== 1) return { engineeringResult: "violation", reasonCode: "PIN_DISPOSITION_CARDINALITY", message: `The pin has ${dispositions.length} dispositions in ${instance.variantId}; exactly one is required.`, evidenceRefs: dispositions.map((item) => item.dispositionId) };
      const disposition = dispositions[0];
      if (disposition.dispositionKind === "blocked_unresolved" || disposition.dispositionKind === "unsupported") return { engineeringResult: disposition.dispositionKind === "unsupported" ? "unsupported" : "unknown", reasonCode: "PIN_DISPOSITION_UNRESOLVED", message: "The terminal disposition is not resolved to an evaluable electrical state.", evidenceRefs: [disposition.dispositionId] };
      return { engineeringResult: "pass", reasonCode: "PIN_DISPOSITION_EXACT", message: "The pin has exactly one explicit disposition for this variant.", evidenceRefs: [disposition.deterministicDigest] };
    }
    case "builtin.endpoint_reciprocity": {
      const endpoint = graph.endpoints.find((item) => item.endpointId === target);
      if (!endpoint) return { engineeringResult: "internal_error", reasonCode: "ENDPOINT_TARGET_MISSING", message: "The selected endpoint target disappeared during evaluation." };
      const net = graph.nets.find((item) => item.netId === endpoint.netId);
      const dispositions = endpoint.endpointKind === "pin" ? graph.terminalDispositions.filter((item) => item.connectedNetEndpointId === endpoint.endpointId && item.pinInstanceId === endpoint.pinInstanceId && item.variantScope.includes(instance.variantId)) : [];
      const valid = Boolean(net?.endpointIds.includes(endpoint.endpointId)) && (endpoint.endpointKind !== "pin" || dispositions.length === 1);
      return valid ? { engineeringResult: "pass", reasonCode: "ENDPOINT_RECIPROCAL", message: "The endpoint has reciprocal semantic membership.", evidenceRefs: [endpoint.deterministicDigest, net!.deterministicDigest] } : { engineeringResult: "violation", reasonCode: "ENDPOINT_NOT_RECIPROCAL", message: "Endpoint, net, pin, or disposition membership is not reciprocal." };
    }
    case "builtin.connected_atomic_nc": {
      const pin = graph.pins.find((item) => item.pinInstanceId === target);
      if (!pin) return { engineeringResult: "internal_error", reasonCode: "PIN_TARGET_MISSING", message: "The selected atomic NC target disappeared." };
      const connected = graph.endpoints.some((item) => item.pinInstanceId === pin.pinInstanceId && activeEndpoint(input, instance, item));
      return connected ? { engineeringResult: "violation", reasonCode: "ATOMIC_NC_CONNECTED", message: `An atomic ${pin.terminalClassification.toUpperCase()} terminal is electrically connected.`, evidenceRefs: pin.provenanceRefs } : { engineeringResult: "pass", reasonCode: "ATOMIC_NC_ISOLATED", message: `The atomic ${pin.terminalClassification.toUpperCase()} terminal remains non-conductive.`, evidenceRefs: pin.provenanceRefs };
    }
    case "builtin.push_pull_contention": {
      const net = graph.nets.find((item) => item.netId === target);
      if (!net) return { engineeringResult: "internal_error", reasonCode: "NET_TARGET_MISSING", message: "The selected net target disappeared." };
      const pinIds = endpointsForNet(input, instance, net).map((item) => item.pinInstanceId).filter((item): item is string => Boolean(item));
      const pins = pinIds.map((id) => graph.pins.find((item) => item.pinInstanceId === id)).filter((item): item is SchematicPinInstance => Boolean(item));
      const drivers = pins.filter((pin) => PUSH_PULL_TYPES.has(pin.electricalType));
      return drivers.length > 1 ? { engineeringResult: "violation", reasonCode: "PUSH_PULL_CONTENTION", message: `The net has ${drivers.length} active push-pull drivers in this context.`, evidenceRefs: drivers.flatMap((item) => item.provenanceRefs) } : { engineeringResult: "pass", reasonCode: "NO_PUSH_PULL_CONTENTION", message: "No multiple active push-pull drivers were proven on this net.", evidenceRefs: pins.flatMap((item) => item.provenanceRefs) };
    }
    case "builtin.required_input_driver": {
      const pin = graph.pins.find((item) => item.pinInstanceId === target);
      if (!pin) return { engineeringResult: "internal_error", reasonCode: "PIN_TARGET_MISSING", message: "The selected input pin target disappeared." };
      const disposition = graph.terminalDispositions.find((item) => item.pinInstanceId === pin.pinInstanceId && item.variantScope.includes(instance.variantId));
      if (disposition?.dispositionKind === "component_not_populated" || disposition?.dispositionKind === "atomic_non_electrical") return { engineeringResult: "not_applicable", reasonCode: "INPUT_NOT_POPULATED_OR_ELECTRICAL", message: "The input is not electrically present in this variant." };
      if (disposition?.dispositionKind === "leave_floating" && disposition.authority.state === "approved") return { engineeringResult: "pass", reasonCode: "INPUT_FLOAT_APPROVED", message: "The exact atomic rule explicitly permits this input to float.", evidenceRefs: disposition.sourceRefs };
      const endpoint = graph.endpoints.find((item) => item.pinInstanceId === pin.pinInstanceId && activeEndpoint(input, instance, item));
      if (!endpoint) return { engineeringResult: "violation", reasonCode: "REQUIRED_INPUT_UNCONNECTED", message: "A required input has no active connection or approved float disposition." };
      const net = graph.nets.find((item) => item.netId === endpoint.netId);
      if (!net) return { engineeringResult: "internal_error", reasonCode: "INPUT_NET_MISSING", message: "The input endpoint references a missing net." };
      const otherPins = endpointsForNet(input, instance, net).filter((item) => item.pinInstanceId !== pin.pinInstanceId).map((item) => graph.pins.find((pinItem) => pinItem.pinInstanceId === item.pinInstanceId)).filter((item): item is SchematicPinInstance => Boolean(item));
      const explicitDriver = otherPins.some((item) => PUSH_PULL_TYPES.has(item.electricalType) || ["open_collector", "open_drain"].includes(item.electricalType));
      const rail = Boolean(net.railGroundDefinitionId);
      return explicitDriver || rail ? { engineeringResult: "pass", reasonCode: "INPUT_DRIVEN_OR_BIASED", message: "The input is connected to an explicit driver or defined rail.", evidenceRefs: [...pin.provenanceRefs, ...otherPins.flatMap((item) => item.provenanceRefs)] } : { engineeringResult: "unknown", reasonCode: "INPUT_DRIVE_NOT_PROVEN", message: "The input is connected, but the exact driver or bias behavior is not proven by the current semantic facts." };
    }
    case "builtin.rail_source_presence": {
      const rail = graph.railGroundRegistry.railDefinitions.find((item) => item.definitionId === target);
      if (!rail) return { engineeringResult: "internal_error", reasonCode: "RAIL_TARGET_MISSING", message: "The selected rail target disappeared." };
      if (!graph.nets.some((item) => item.netId === rail.canonicalNetId)) return { engineeringResult: "violation", reasonCode: "RAIL_NET_MISSING", message: "The declared rail references no semantic net." };
      const sourceComponents = graph.components.filter((item) => rail.sourceRoleIds.some((role) => item.architectureRoleInstanceIds.includes(role) || item.recipeRoleInstanceIds.includes(role)));
      const sourcePinIds = new Set(sourceComponents.flatMap((item) => graph.pins.filter((pin) => pin.componentInstanceId === item.componentInstanceId).map((pin) => pin.pinInstanceId)));
      const sourceConnected = graph.endpoints.some((item) => item.netId === rail.canonicalNetId && item.pinInstanceId && sourcePinIds.has(item.pinInstanceId) && activeEndpoint(input, instance, item));
      return sourceConnected ? { engineeringResult: "pass", reasonCode: "RAIL_SOURCE_CONNECTED", message: "The rail has an exact source-role component with an active endpoint on the rail.", evidenceRefs: [...rail.provenanceRefs, ...rail.sourceRoleIds, ...sourceComponents.flatMap((item) => item.evidenceAndProvenanceRefs)] } : { engineeringResult: "unknown", reasonCode: "RAIL_SOURCE_NOT_PROVEN", message: "No exact compatible source-role endpoint is proven on this declared rail.", evidenceRefs: rail.provenanceRefs };
    }
    case "builtin.distinct_tie_integrity": {
      const tie = graph.railGroundRegistry.explicitTies.find((item) => item.tieId === target);
      if (!tie) return { engineeringResult: "internal_error", reasonCode: "TIE_TARGET_MISSING", message: "The selected tie target disappeared." };
      const valid = tie.leftNetId !== tie.rightNetId && graph.nets.some((item) => item.netId === tie.leftNetId) && graph.nets.some((item) => item.netId === tie.rightNetId);
      return valid ? { engineeringResult: "pass", reasonCode: "TIE_NETS_DISTINCT", message: "The intentional tie preserves distinct net identities.", evidenceRefs: tie.provenanceRefs } : { engineeringResult: "violation", reasonCode: "TIE_NETS_COLLAPSED", message: "An intentional tie no longer has two existing distinct net identities." };
    }
    case "builtin.hierarchy_binding_integrity": {
      const binding = graph.portBindings.find((item) => item.bindingId === target);
      if (!binding) return { engineeringResult: "internal_error", reasonCode: "PORT_BINDING_TARGET_MISSING", message: "The selected hierarchy binding disappeared." };
      return binding.validationState === "pass" ? { engineeringResult: "pass", reasonCode: "PORT_BINDING_VALID", message: "The hierarchical electrical binding is valid.", evidenceRefs: [binding.deterministicDigest] } : { engineeringResult: binding.validationState === "unsupported" ? "unsupported" : binding.validationState === "fail" ? "violation" : "unknown", reasonCode: "PORT_BINDING_NOT_PROVEN", message: "The hierarchical electrical binding is not proven valid.", evidenceRefs: [binding.deterministicDigest] };
    }
    case "builtin.round_trip_current":
      return input.problem.semanticGraphDigest === graph.deterministicDigest && Boolean(input.problem.roundTripCertificateDigest) ? { engineeringResult: "pass", reasonCode: "ROUND_TRIP_PIN_CURRENT", message: "The verification problem pins the current approved semantic graph and its equivalent round-trip certificate.", evidenceRefs: [input.problem.roundTripCertificateDigest] } : { engineeringResult: "stale", reasonCode: "ROUND_TRIP_PIN_STALE", message: "The round-trip certificate does not pin this graph digest." };
    case "builtin.requirement_traceability": {
      const coverage = input.requirementCoverage?.find((item) => item.requirementId === target);
      if (!coverage) return { engineeringResult: "unknown", reasonCode: "REQUIREMENT_COVERAGE_MISSING", message: "No separate implementation/verification/satisfaction record exists for this requirement." };
      if (coverage.implementationState === "not_implemented" || coverage.verificationState === "failed" || coverage.satisfactionState === "not_satisfied") return { engineeringResult: "violation", reasonCode: "REQUIREMENT_NOT_SATISFIED", message: "The requirement has a proven implementation, verification, or satisfaction failure.", evidenceRefs: coverage.evidenceRefs };
      if (coverage.implementationState === "implemented" && coverage.verificationState === "verified" && coverage.satisfactionState === "satisfied") return { engineeringResult: "pass", reasonCode: "REQUIREMENT_SATISFIED", message: "Implementation, deterministic verification, and satisfaction evidence are complete.", evidenceRefs: coverage.evidenceRefs };
      return { engineeringResult: coverage.verificationState === "unsupported" ? "unsupported" : "unknown", reasonCode: "REQUIREMENT_COVERAGE_INCOMPLETE", message: "Requirement implementation, verification, and satisfaction are not all proven.", evidenceRefs: coverage.evidenceRefs };
    }
  }
}

function applicabilityResult(state: VerificationApplicability): EngineeringResult {
  if (state === "not_applicable") return "not_applicable";
  if (state === "unsupported") return "unsupported";
  if (state === "internal_error") return "internal_error";
  return state === "applicable" ? "not_evaluated" : "unknown";
}

export function runFullCircuitOracle(input: VerificationOracleInput, options: { runKind?: FullOracleRun["runKind"]; instanceIds?: string[] } = {}): FullOracleRun {
  const runKind = options.runKind ?? "full";
  const denominator = compileRequiredRuleDenominator({ problem: input.problem, graph: input.graph, projections: input.projections, registry: input.registry, capabilityProfile: input.capabilityProfile, contexts: input.contexts });
  const selected = options.instanceIds ? new Set(options.instanceIds) : undefined;
  const instances = selected ? denominator.instances.filter((item) => selected.has(item.instanceId)) : denominator.instances;
  const runSeed = { runKind, projectId: input.problem.projectId, graph: input.graph.deterministicDigest, registry: input.registry.deterministicDigest, denominator: denominator.deterministicDigest, startedAt: input.startedAt };
  const runId = verificationId("oracle-run", runSeed);
  const results: VerificationRuleResult[] = [];
  const executions: FullOracleRun["executions"] = [];
  const diagnostics: Cd9Diagnostic[] = [...denominator.diagnostics];
  if (input.denominator.deterministicDigest !== finalizeVerification(input.denominator).deterministicDigest || input.denominator.deterministicDigest !== denominator.deterministicDigest) diagnostics.push(diagnostic("CD9_DENOMINATOR_RECOMPUTE_MISMATCH", "The supplied denominator differed from the independent full-oracle recomputation.", [input.denominator.denominatorId, denominator.denominatorId]));
  for (const instance of instances) {
    const rule = input.registry.rules.find((item) => item.ruleId === instance.ruleId && item.deterministicDigest === instance.ruleDigest);
    const applicability = denominator.applicability.find((item) => item.applicabilityId === instance.applicabilityId);
    const startedAt = input.startedAt;
    try {
      if (!rule || !applicability) throw new Error("RULE_OR_APPLICABILITY_MISSING");
      const evaluation = applicability.state === "applicable" ? evaluateApplicable(rule, instance, input) : { engineeringResult: applicabilityResult(applicability.state), reasonCode: applicability.reasonCode, message: `Rule applicability is ${applicability.state.replaceAll("_", " ")}.`, evidenceRefs: applicability.evidenceRefs };
      const body = { ruleInstanceId: instance.instanceId, ruleId: rule.ruleId, ruleDigest: rule.deterministicDigest, category: rule.category, contextId: instance.contextId, variantId: instance.variantId, targetIds: uniqueSorted(instance.targetIds), applicability: applicability.state, engineeringResult: evaluation.engineeringResult, severity: rule.severity, reasonCode: evaluation.reasonCode, message: evaluation.message, evidenceRefs: uniqueSorted([...(evaluation.evidenceRefs ?? []), ...rule.evidenceRefs]), remediation: uniqueSorted(evaluation.remediation ?? [rule.remediationTemplate]), evaluatorVersion: EVALUATOR_VERSION, durationMs: 0 };
      results.push(finalizeVerification<VerificationRuleResult>({ ...body, resultId: verificationId("rule-result", body), deterministicDigest: "" }));
      const record = { ruleInstanceId: instance.instanceId, startedAt, finishedAt: input.finishedAt ?? input.startedAt, state: "completed" as const, diagnosticIds: [] as string[] };
      executions.push(finalizeVerification({ ...record, executionId: verificationId("rule-execution", record), deterministicDigest: "" }));
    } catch (error) {
      const failure = diagnostic("CD9_RULE_EXECUTION_INTERNAL_ERROR", error instanceof Error ? error.message : String(error), [instance.instanceId, instance.ruleId]);
      diagnostics.push(failure);
      const body = { ruleInstanceId: instance.instanceId, ruleId: instance.ruleId, ruleDigest: instance.ruleDigest, category: instance.category, contextId: instance.contextId, variantId: instance.variantId, targetIds: uniqueSorted(instance.targetIds), applicability: "internal_error" as const, engineeringResult: "internal_error" as const, severity: "blocking" as const, reasonCode: "ISOLATED_EVALUATOR_FAILURE", message: "The deterministic evaluator failed in isolation; the remaining denominator continued.", evidenceRefs: [failure.diagnosticId], remediation: ["Repair the named evaluator and rerun the complete oracle."], evaluatorVersion: EVALUATOR_VERSION, durationMs: 0 };
      results.push(finalizeVerification<VerificationRuleResult>({ ...body, resultId: verificationId("rule-result", body), deterministicDigest: "" }));
      const record = { ruleInstanceId: instance.instanceId, startedAt, finishedAt: input.finishedAt ?? input.startedAt, state: "failed_isolated" as const, diagnosticIds: [failure.diagnosticId] };
      executions.push(finalizeVerification({ ...record, executionId: verificationId("rule-execution", record), deterministicDigest: "" }));
    }
  }
  results.sort((a, b) => a.resultId.localeCompare(b.resultId));
  const findings = results.map((result) => {
    const rule = input.registry.rules.find((item) => item.ruleId === result.ruleId)!;
    const context = input.contexts.find((item) => item.contextId === result.contextId)!;
    return findingFromResult({ rule, result, context, runId });
  }).filter((item): item is NonNullable<typeof item> => Boolean(item)).sort((a, b) => a.stableIdentity.localeCompare(b.stableIdentity));
  const body = { schemaVersion: CIRCUIT_VERIFICATION_RUN_SCHEMA, runKind, projectId: input.problem.projectId, branchId: input.problem.branchId, problemDigest: input.problem.deterministicDigest, graphRevisionId: input.graph.graphId, graphDigest: input.graph.deterministicDigest, registryDigest: input.registry.deterministicDigest, denominatorDigest: denominator.deterministicDigest, contexts: structuredClone(input.contexts), results, findings, executions: executions.sort((a, b) => a.executionId.localeCompare(b.executionId)), diagnostics: diagnostics.sort((a, b) => a.code.localeCompare(b.code) || a.diagnosticId.localeCompare(b.diagnosticId)), executionState: diagnostics.some((item) => item.code === "CD9_RULE_EXECUTION_INTERNAL_ERROR" || item.code === "CD9_DENOMINATOR_RECOMPUTE_MISMATCH") ? "completed_with_isolated_errors" as const : "completed" as const, startedAt: input.startedAt, finishedAt: input.finishedAt ?? input.startedAt, evaluatorVersion: EVALUATOR_VERSION };
  return finalizeVerification<FullOracleRun>({ ...body, runId, deterministicDigest: "" });
}
