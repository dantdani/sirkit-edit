import { schematicDigest, schematicId } from "./stable";
import type { SchematicDiagramView, SchematicSemanticDiff, SchematicSemanticGraph } from "./types";

type Indexed = { id: string; digest: string };
const unique = (values: string[]) => [...new Set(values)].sort();
function compareObjects(kind: string, base: Indexed[], candidate: Indexed[]): SchematicSemanticDiff["addedRemovedChangedObjects"] {
  const left = new Map(base.map((item) => [item.id, item.digest])), right = new Map(candidate.map((item) => [item.id, item.digest]));
  const changes: SchematicSemanticDiff["addedRemovedChangedObjects"] = [];
  for (const id of unique([...left.keys(), ...right.keys()])) changes.push(...!left.has(id) ? [{ objectKind: kind, objectId: id, change: "added" as const }] : !right.has(id) ? [{ objectKind: kind, objectId: id, change: "removed" as const }] : left.get(id) !== right.get(id) ? [{ objectKind: kind, objectId: id, change: "changed" as const }] : []);
  return changes;
}
function connectivityKey(graph: SchematicSemanticGraph, netId: string): string {
  const net = graph.nets.find((item) => item.netId === netId);
  const endpoints = (net?.endpointIds ?? []).map((id) => graph.endpoints.find((item) => item.endpointId === id)).filter(Boolean).map((item) => `${item!.endpointKind}:${item!.pinInstanceId ?? item!.hierarchicalPortBindingId ?? item!.testAccessPointId ?? item!.explicitTieSideId}:${[...item!.variantApplicability].sort().join(",")}`).sort();
  return schematicDigest(endpoints);
}

export function diffSchematicGraphs(base: SchematicSemanticGraph, candidate: SchematicSemanticGraph, views?: { base: SchematicDiagramView[]; candidate: SchematicDiagramView[] }): SchematicSemanticDiff {
  const objects: SchematicSemanticDiff["addedRemovedChangedObjects"] = [
    ...compareObjects("component", base.components.map((item) => ({ id: item.componentInstanceId, digest: item.deterministicDigest })), candidate.components.map((item) => ({ id: item.componentInstanceId, digest: item.deterministicDigest }))),
    ...compareObjects("pin", base.pins.map((item) => ({ id: item.pinInstanceId, digest: item.deterministicDigest })), candidate.pins.map((item) => ({ id: item.pinInstanceId, digest: item.deterministicDigest }))),
    ...compareObjects("net", base.nets.map((item) => ({ id: item.netId, digest: item.deterministicDigest })), candidate.nets.map((item) => ({ id: item.netId, digest: item.deterministicDigest }))),
    ...compareObjects("sheet", base.sheetInstances.map((item) => ({ id: item.sheetInstanceId, digest: item.deterministicDigest })), candidate.sheetInstances.map((item) => ({ id: item.sheetInstanceId, digest: item.deterministicDigest }))),
    ...compareObjects("port_binding", base.portBindings.map((item) => ({ id: item.bindingId, digest: item.deterministicDigest })), candidate.portBindings.map((item) => ({ id: item.bindingId, digest: item.deterministicDigest }))),
  ].sort((a, b) => `${a.objectKind}:${a.objectId}`.localeCompare(`${b.objectKind}:${b.objectId}`));
  const netIds = unique([...base.nets.map((item) => item.netId), ...candidate.nets.map((item) => item.netId)]);
  const connectivityChanges = netIds.filter((id) => connectivityKey(base, id) !== connectivityKey(candidate, id)).map((id) => `net:${id}`);
  const hierarchyChanges = objects.filter((item) => ["sheet", "port_binding"].includes(item.objectKind)).map((item) => `${item.change}:${item.objectKind}:${item.objectId}`);
  const identityAnnotationChanges = compareObjects("annotation", base.annotations.map((item) => ({ id: item.annotationRecordId, digest: item.deterministicDigest })), candidate.annotations.map((item) => ({ id: item.annotationRecordId, digest: item.deterministicDigest }))).map((item) => `${item.change}:${item.objectId}`);
  const variantPopulationChanges = compareObjects("population", base.populationRules.map((item) => ({ id: item.populationRuleId, digest: item.deterministicDigest })), candidate.populationRules.map((item) => ({ id: item.populationRuleId, digest: item.deterministicDigest }))).map((item) => `${item.change}:${item.objectId}`);
  const componentIds = unique([...base.components.map((item) => item.componentInstanceId), ...candidate.components.map((item) => item.componentInstanceId)]);
  const valuePartFootprintChanges = componentIds.filter((id) => { const a = base.components.find((item) => item.componentInstanceId === id), b = candidate.components.find((item) => item.componentInstanceId === id); return !a || !b || schematicDigest({ value: a.displayedValue, part: a.exactAtomicPartRevisionId, footprint: a.footprintRevisionId }) !== schematicDigest({ value: b.displayedValue, part: b.exactAtomicPartRevisionId, footprint: b.footprintRevisionId }); }).map((id) => `component:${id}`);
  const diagramOnlyChanges = views ? unique([...views.base.map((item) => item.diagramViewId), ...views.candidate.map((item) => item.diagramViewId)]).filter((id) => views.base.find((item) => item.diagramViewId === id)?.deterministicDigest !== views.candidate.find((item) => item.diagramViewId === id)?.deterministicDigest).map((id) => `view:${id}`) : [];
  const affected = unique(objects.flatMap((change) => candidate.provenanceEdges.filter((edge) => edge.targetObjectId === change.objectId).map((edge) => edge.sourceRef)));
  const baseValue = { baseGraphRevisionId: base.graphId, candidateGraphRevisionId: candidate.graphId, addedRemovedChangedObjects: objects, connectivityChanges, hierarchyChanges, identityAnnotationChanges, variantPopulationChanges, valuePartFootprintChanges, diagramOnlyChanges, affectedRequirementRecipeIds: affected, downstreamInvalidationImpact: connectivityChanges.length || valuePartFootprintChanges.length ? ["CD-9_PCB_SYNC_INVALIDATED", "BOM_NETLIST_REVIEW_REQUIRED"] : diagramOnlyChanges.length ? ["DIAGRAM_ARTIFACT_REGENERATION_REQUIRED"] : [], conflictIds: [] };
  const withId = { ...baseValue, diffId: schematicId("schematic-diff", baseValue) };
  return { ...withId, deterministicDigest: schematicDigest(withId) };
}
