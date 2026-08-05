import { evaluateModelApplicability } from "./applicability";
import { rational } from "./rational";
import { calculationDigest, calculationId } from "./stable";
import type { CalculationDerivationGraph, CalculationNode, CalculationObligation, CalculationVariable, CircuitCalculationProblem, EngineeringModelDefinition, EquationModelRegistrySnapshot } from "./types";

function node(input: Omit<CalculationNode, "nodeId" | "deterministicDigest">): CalculationNode {
  const base = structuredClone({ ...input, nodeId: calculationId("calculation-node", input) });
  return { ...base, deterministicDigest: calculationDigest(base) };
}

function selectModel(obligation: CalculationObligation, registry: EquationModelRegistrySnapshot): EngineeringModelDefinition | undefined {
  const requested = new Set([obligation.requiredModelClass, ...obligation.requestedAnalysisKinds].filter(Boolean));
  return registry.modelDefinitions.find((model) => model.reviewState === "approved" && model.lifecycleState === "active" && (requested.has(model.modelKind) || requested.has(model.semanticName) || model.topologyApplicability.some((item) => requested.has(item))));
}

export function compileCalculationGraph(input: { problem: CircuitCalculationProblem; registry: EquationModelRegistrySnapshot; variables: CalculationVariable[]; topologyRefs: string[]; exactIdentityRefs: string[]; maximumNodes: number }): CalculationDerivationGraph {
  const nodes: CalculationNode[] = [];
  for (const variable of input.variables) nodes.push(node({ nodeKind: "source_quantity", semanticName: variable.semanticRole, inputBindings: [{ portId: variable.variableId, variableId: variable.variableId }], outputQuantityIds: [variable.nominalValue?.quantityId, variable.guaranteedInterval?.intervalId, variable.characterizedInterval?.intervalId].filter((item): item is string => Boolean(item)), numericMethod: "pinned_source", precisionAndTolerance: { representation: "exact_rational", roundingMode: "exact", numericErrorBound: rational(0) }, evaluationStatus: variable.freshnessState === "current" ? variable.supportState === "supported" ? "pass" : variable.supportState === "characterized_only" ? "external_review_required" : variable.supportState : "stale", diagnosticIds: [], provenanceRefs: variable.provenanceRefs }));
  for (const obligation of input.problem.calculationObligations) {
    const model = selectModel(obligation, input.registry);
    if (!model) { nodes.push(node({ nodeKind: "unsupported", semanticName: obligation.obligationId, inputBindings: [], outputQuantityIds: [], numericMethod: "none", precisionAndTolerance: { representation: "exact_rational", roundingMode: "exact" }, evaluationStatus: "unsupported", diagnosticIds: ["CD7_APPROVED_MODEL_MISSING"], provenanceRefs: obligation.sourceRequirementRecipePartIds })); continue; }
    const applicability = evaluateModelApplicability({ model, topologyRefs: input.topologyRefs, exactIdentityRefs: input.exactIdentityRefs, variables: input.variables, conditionRefs: obligation.applicableVariantsModesCorners });
    nodes.push(node({ nodeKind: "model", semanticName: obligation.obligationId, equationOrModelRevisionId: `${model.modelId}:${model.revision}`, inputBindings: model.typedInputs.map((port) => ({ portId: port.portId, variableId: input.variables.find((variable) => variable.semanticRole === port.portId)?.variableId })), outputQuantityIds: [], applicabilityResult: applicability, numericMethod: model.modelKind, precisionAndTolerance: { representation: "verified_interval", roundingMode: "outward", numericErrorBound: rational(0) }, evaluationStatus: applicability.state, diagnosticIds: applicability.state === "pass" ? [] : ["CD7_MODEL_APPLICABILITY_NOT_PROVEN"], provenanceRefs: [...model.evidenceRefs, ...obligation.sourceRequirementRecipePartIds] }));
  }
  if (nodes.length > input.maximumNodes) throw new Error("CD7_GRAPH_NODE_RESOURCE_LIMIT");
  const edges = nodes.flatMap((target) => target.inputBindings.filter((binding) => binding.variableId).flatMap((binding) => { const source = nodes.find((candidate) => candidate.nodeKind === "source_quantity" && candidate.inputBindings.some((item) => item.variableId === binding.variableId)); return source ? [{ edgeId: calculationId("calculation-edge", { from: source.nodeId, to: target.nodeId, port: binding.portId }), fromNodeId: source.nodeId, toNodeId: target.nodeId, portId: binding.portId }] : []; }));
  const topologicalOrder = [...nodes.filter((item) => item.nodeKind === "source_quantity"), ...nodes.filter((item) => item.nodeKind !== "source_quantity")].map((item) => item.nodeId);
  const validationState = nodes.some((item) => item.nodeKind === "unsupported" || item.evaluationStatus === "fail") ? "invalid" as const : "valid" as const;
  const base: Omit<CalculationDerivationGraph, "graphId" | "deterministicDigest"> = { problemRevisionId: input.problem.problemId, nodes, edges, topologicalOrder, stronglyConnectedComponents: [], externalSolverContractIds: [], dependencyDigest: calculationDigest({ problem: input.problem.deterministicDigest, registry: input.registry.deterministicDigest, variables: input.variables.map((item) => item.deterministicDigest) }), validationState };
  const withId = { ...base, graphId: calculationId("calculation-graph", base) };
  return { ...withId, deterministicDigest: calculationDigest(withId) };
}

export function affectedGraphNodeIds(graph: CalculationDerivationGraph, changedRefs: string[]): string[] {
  const changed = new Set(changedRefs); const affected = new Set(graph.nodes.filter((node) => node.provenanceRefs.some((ref) => changed.has(ref)) || node.inputBindings.some((binding) => binding.variableId && changed.has(binding.variableId))).map((node) => node.nodeId));
  let grew = true; while (grew) { grew = false; for (const edge of graph.edges) if (affected.has(edge.fromNodeId) && !affected.has(edge.toNodeId)) { affected.add(edge.toNodeId); grew = true; } }
  return [...affected].sort();
}
