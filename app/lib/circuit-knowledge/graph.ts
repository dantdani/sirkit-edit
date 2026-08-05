import { circuitDigest } from "./stable";
import type { Cardinality, CircuitRecipeDefinition, RecipeTopologyGraph } from "./types";

function canonicalGraphValue(graph: RecipeTopologyGraph): unknown {
  return {
    graphId: graph.graphId,
    roleNodeIds: [...graph.roleNodeIds].sort(),
    portNodeIds: [...graph.portNodeIds].sort(),
    internalSemanticNetRoleIds: [...graph.internalSemanticNetRoleIds].sort(),
    connectionRules: graph.connectionRules.map((rule) => ({
      ...rule,
      endpointRoleRefs: [...rule.endpointRoleRefs].sort(),
      evidenceRefs: [...rule.evidenceRefs].sort(),
      downstreamCheckIds: [...rule.downstreamCheckIds].sort(),
    })).sort((a, b) => a.connectionRuleId.localeCompare(b.connectionRuleId)),
    requiredRelationshipIds: [...graph.requiredRelationshipIds].sort(),
    forbiddenRelationshipIds: [...graph.forbiddenRelationshipIds].sort(),
    conditionalSubgraphIds: [...graph.conditionalSubgraphIds].sort(),
    compositionBoundaryIds: [...graph.compositionBoundaryIds].sort(),
  };
}

export function canonicalTopologyGraphDigest(graph: RecipeTopologyGraph): string {
  return circuitDigest(canonicalGraphValue(graph));
}

function cardinalityValid(cardinality: Cardinality): boolean {
  return cardinality.kind === "optional"
    || (["one_per_pin", "one_per_rail", "one_per_group"].includes(cardinality.kind) && Boolean("groupRole" in cardinality && cardinality.groupRole.trim()))
    || ("count" in cardinality && Number.isInteger(cardinality.count) && cardinality.count >= 0);
}

function duplicate(values: string[]): boolean { return new Set(values).size !== values.length; }

export function validateRecipeTopology(recipe: CircuitRecipeDefinition): string[] {
  const errors: string[] = [];
  const graph = recipe.topologyGraph;
  const portIds = recipe.ports.map((item) => item.portId);
  const roleIds = recipe.componentRoleSlots.map((item) => item.roleSlotId);
  const terminalIds = recipe.terminalRoleContracts.map((item) => item.terminalRoleId);
  const internalIds = graph.internalSemanticNetRoleIds;
  const endpointIds = new Set([...portIds, ...roleIds, ...terminalIds, ...internalIds]);
  const evidenceIds = new Set(recipe.ports.flatMap((item) => item.evidenceRefs)
    .concat(recipe.componentRoleSlots.flatMap((item) => item.evidenceRefs))
    .concat(recipe.terminalRoleContracts.flatMap((item) => item.evidenceRefs))
    .concat(graph.connectionRules.flatMap((item) => item.evidenceRefs)));

  if (!graph.graphId.trim()) errors.push("RECIPE_GRAPH_ID_MISSING");
  if (duplicate(portIds) || duplicate(graph.portNodeIds)) errors.push("RECIPE_PORT_ID_REUSE");
  if (duplicate(roleIds) || duplicate(graph.roleNodeIds)) errors.push("RECIPE_ROLE_ID_REUSE");
  if (duplicate(terminalIds)) errors.push("RECIPE_TERMINAL_ROLE_ID_REUSE");
  if (duplicate(internalIds)) errors.push("RECIPE_INTERNAL_NET_ROLE_ID_REUSE");
  if (duplicate(graph.connectionRules.map((item) => item.connectionRuleId))) errors.push("RECIPE_CONNECTION_RULE_ID_REUSE");
  if (JSON.stringify([...portIds].sort()) !== JSON.stringify([...graph.portNodeIds].sort())) errors.push("RECIPE_GRAPH_PORT_NODE_SET_MISMATCH");
  if (JSON.stringify([...roleIds].sort()) !== JSON.stringify([...graph.roleNodeIds].sort())) errors.push("RECIPE_GRAPH_ROLE_NODE_SET_MISMATCH");

  for (const port of recipe.ports) {
    if (!cardinalityValid(port.cardinality)) errors.push("RECIPE_PORT_CARDINALITY_INVALID");
    if (!port.evidenceRefs.length) errors.push("RECIPE_PORT_EVIDENCE_MISSING");
    if (port.quantityEnvelope && port.quantityEnvelope.min.dimension !== port.quantityEnvelope.max.dimension) errors.push("RECIPE_PORT_ENVELOPE_DIMENSION_MISMATCH");
  }
  for (const role of recipe.componentRoleSlots) {
    if (!cardinalityValid(role.cardinality)) errors.push("RECIPE_ROLE_CARDINALITY_INVALID");
    if (!role.evidenceRefs.length) errors.push("RECIPE_ROLE_EVIDENCE_MISSING");
    if (role.requiredTerminalRoleIds.some((id) => !terminalIds.includes(id))) errors.push("RECIPE_ROLE_TERMINAL_REFERENCE_ORPHAN");
  }
  for (const terminal of recipe.terminalRoleContracts) {
    if (!roleIds.includes(terminal.componentRoleSlotId)) errors.push("RECIPE_TERMINAL_COMPONENT_ROLE_ORPHAN");
    if (!cardinalityValid(terminal.pinGroupCardinality)) errors.push("RECIPE_TERMINAL_CARDINALITY_INVALID");
    if (!terminal.evidenceRefs.length) errors.push("RECIPE_TERMINAL_EVIDENCE_MISSING");
    if (terminal.requiredConnectionRoleIds.some((id) => !endpointIds.has(id)) || terminal.forbiddenConnectionRoleIds.some((id) => !endpointIds.has(id))) errors.push("RECIPE_TERMINAL_CONNECTION_REFERENCE_ORPHAN");
    if (terminal.requiredConnectionRoleIds.some((id) => terminal.forbiddenConnectionRoleIds.includes(id))) errors.push("RECIPE_TERMINAL_CONNECTION_CONTRADICTION");
  }
  for (const rule of graph.connectionRules) {
    if (!cardinalityValid(rule.cardinality)) errors.push("RECIPE_CONNECTION_CARDINALITY_INVALID");
    if (rule.endpointRoleRefs.length < 2) errors.push("RECIPE_CONNECTION_ENDPOINT_COUNT_INVALID");
    if (duplicate(rule.endpointRoleRefs)) errors.push("RECIPE_CONNECTION_SELF_SHORT");
    if (rule.endpointRoleRefs.some((id) => !endpointIds.has(id))) errors.push("RECIPE_CONNECTION_ENDPOINT_ORPHAN");
    if (!rule.evidenceRefs.length) errors.push("RECIPE_CONNECTION_EVIDENCE_MISSING");
    const endpointPorts = recipe.ports.filter((port) => rule.endpointRoleRefs.includes(port.portId));
    if (rule.connectionKind === "required" && endpointPorts.length > 1 && endpointPorts.every((port) => port.direction === "output")) errors.push("RECIPE_CONNECTION_OUTPUT_CONTENTION");
  }
  const connected = new Set(graph.connectionRules.flatMap((item) => item.endpointRoleRefs));
  for (const port of recipe.ports) if (port.cardinality.kind !== "optional" && !connected.has(port.portId)) errors.push("RECIPE_REQUIRED_PORT_ORPHAN");
  for (const terminal of recipe.terminalRoleContracts) if (terminal.pinGroupCardinality.kind !== "optional" && !connected.has(terminal.terminalRoleId)) errors.push("RECIPE_REQUIRED_TERMINAL_ORPHAN");
  if (!evidenceIds.size && (recipe.ports.length || recipe.componentRoleSlots.length || graph.connectionRules.length)) errors.push("RECIPE_GRAPH_HAS_NO_EVIDENCE");
  if (graph.canonicalGraphDigest !== canonicalTopologyGraphDigest(graph)) errors.push("RECIPE_GRAPH_DIGEST_MISMATCH");
  return [...new Set(errors)].sort();
}

/** Independent endpoint-incidence oracle; it intentionally does not use the compiler validator. */
export function topologyIncidenceOracle(recipe: CircuitRecipeDefinition): { orphanIds: string[]; invalidEndpointIds: string[]; selfShortRuleIds: string[] } {
  const valid = new Set([
    ...recipe.ports.map((item) => item.portId),
    ...recipe.componentRoleSlots.map((item) => item.roleSlotId),
    ...recipe.terminalRoleContracts.map((item) => item.terminalRoleId),
    ...recipe.topologyGraph.internalSemanticNetRoleIds,
  ]);
  const incident = new Set<string>();
  const invalidEndpointIds: string[] = [];
  const selfShortRuleIds: string[] = [];
  for (const edge of recipe.topologyGraph.connectionRules) {
    if (new Set(edge.endpointRoleRefs).size !== edge.endpointRoleRefs.length) selfShortRuleIds.push(edge.connectionRuleId);
    for (const endpoint of edge.endpointRoleRefs) {
      if (valid.has(endpoint)) incident.add(endpoint);
      else invalidEndpointIds.push(endpoint);
    }
  }
  const required = [
    ...recipe.ports.filter((item) => item.cardinality.kind !== "optional").map((item) => item.portId),
    ...recipe.terminalRoleContracts.filter((item) => item.pinGroupCardinality.kind !== "optional").map((item) => item.terminalRoleId),
  ];
  return { orphanIds: required.filter((id) => !incident.has(id)).sort(), invalidEndpointIds: [...new Set(invalidEndpointIds)].sort(), selfShortRuleIds: selfShortRuleIds.sort() };
}
