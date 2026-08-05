import { schematicDigest, schematicId } from "./stable";
import type { PopulationState, SchematicSemanticGraph, VariantGraphProjection } from "./types";

const unique = (values: string[]) => [...new Set(values)].sort();
const conductiveStates = new Set<PopulationState>(["populated", "assembly_option"]);

/** A variant is a projection of the same graph, never a separately inferred netlist. */
export function projectSchematicVariant(graph: SchematicSemanticGraph, variantId: string): VariantGraphProjection {
  if (!graph.variantIds.includes(variantId)) throw new Error("CD8_VARIANT_UNKNOWN");
  const conflicts: string[] = [];
  const populated: string[] = [];
  for (const component of graph.components) {
    const rule = graph.populationRules.find((item) => item.populationRuleId === component.variantPopulationRuleId && item.targetComponentInstanceId === component.componentInstanceId);
    const states = rule?.populationStateByVariant.filter((item) => item.variantId === variantId) ?? [];
    if (states.length !== 1 || states[0].state === "blocked_unresolved" || states[0].state === "optional") conflicts.push(`population:${component.componentInstanceId}:${variantId}`);
    if (states.length === 1 && conductiveStates.has(states[0].state)) populated.push(component.componentInstanceId);
  }
  const populatedSet = new Set(populated);
  const endpoints: string[] = [];
  for (const endpoint of graph.endpoints) {
    if (!endpoint.variantApplicability.includes(variantId)) continue;
    if (endpoint.endpointKind !== "pin") { endpoints.push(endpoint.endpointId); continue; }
    const pin = graph.pins.find((item) => item.pinInstanceId === endpoint.pinInstanceId);
    if (!pin || !populatedSet.has(pin.componentInstanceId)) continue;
    const disposition = graph.terminalDispositions.filter((item) => item.pinInstanceId === pin.pinInstanceId && item.variantScope.includes(variantId));
    if (disposition.length !== 1 || disposition[0].dispositionKind !== "connected" || disposition[0].connectedNetEndpointId !== endpoint.endpointId) conflicts.push(`connectivity:${pin.pinInstanceId}:${variantId}`);
    else endpoints.push(endpoint.endpointId);
  }
  for (const pin of graph.pins) {
    const dispositions = graph.terminalDispositions.filter((item) => item.pinInstanceId === pin.pinInstanceId && item.variantScope.includes(variantId));
    if (dispositions.length !== 1 || ["blocked_unresolved", "unsupported", "reserved_external_review"].includes(dispositions[0]?.dispositionKind ?? "blocked_unresolved")) conflicts.push(`disposition:${pin.pinInstanceId}:${variantId}`);
  }
  const endpointSet = new Set(endpoints);
  const activeNets = graph.nets.filter((net) => net.endpointIds.some((id) => endpointSet.has(id))).map((net) => net.netId);
  const ties = graph.railGroundRegistry.explicitTies.filter((tie) => tie.variantApplicability.includes(variantId) && (!tie.componentInstanceId || populatedSet.has(tie.componentInstanceId))).map((tie) => tie.tieId);
  const base: Omit<VariantGraphProjection, "projectionId" | "deterministicDigest"> = { sourceGraphRevisionId: graph.graphId, variantId, populatedComponentInstanceIds: unique(populated), activeEndpointIds: unique(endpoints), activeNetIds: unique(activeNets), conductiveTieIds: unique(ties), unresolvedVariantConflictIds: unique(conflicts) };
  const withId = { ...base, projectionId: schematicId("variant-projection", { graph: graph.deterministicDigest, variantId }) };
  return { ...withId, deterministicDigest: schematicDigest(withId) };
}

export function projectAllSchematicVariants(graph: SchematicSemanticGraph): VariantGraphProjection[] { return graph.variantIds.map((variantId) => projectSchematicVariant(graph, variantId)); }
