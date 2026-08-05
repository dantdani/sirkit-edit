import { createSchematicGraphSuccessor } from "./graph";
import { schematicDigest, schematicId } from "./stable";
import type { HierarchicalPortBinding, HierarchicalPortDefinition, SchematicSemanticGraph, SheetDefinition, SheetInstance, SignalBundleDefinition, SignalBundleInstance } from "./types";

const unique = (values: string[]) => [...new Set(values)].sort();
function member<T extends { deterministicDigest: string }>(value: Omit<T, "deterministicDigest">): T { return { ...value, deterministicDigest: schematicDigest(value) } as T; }

export function addSheetInstance(graph: SchematicSemanticGraph, input: { parentSheetInstanceId: string; semanticName: string; reusableBlockKind: string; instanceName: string; variantApplicability: string[]; provenanceRefs: string[] }): SchematicSemanticGraph {
  const parent = graph.sheetInstances.find((item) => item.sheetInstanceId === input.parentSheetInstanceId);
  if (!parent || !input.semanticName.trim() || !input.instanceName.trim() || input.variantApplicability.some((item) => !graph.variantIds.includes(item))) throw new Error("CD8_SHEET_INPUT_INVALID");
  const definitionId = schematicId("sheet-definition", { semanticName: input.semanticName, kind: input.reusableBlockKind, provenance: unique(input.provenanceRefs) });
  const existingDefinition = graph.sheetDefinitions.find((item) => item.sheetDefinitionId === definitionId);
  const definition = existingDefinition ?? member<SheetDefinition>({ sheetDefinitionId: definitionId, semanticName: input.semanticName.trim(), reusableBlockKind: input.reusableBlockKind, portDefinitionIds: [], parameterDefinitionIds: [], allowedRecipeOrRoleKinds: [input.reusableBlockKind], provenanceRefs: unique(input.provenanceRefs), revision: 1 });
  const instance = member<SheetInstance>({ sheetInstanceId: schematicId("sheet-instance", { parent: parent.sheetInstanceId, definition: definitionId, name: input.instanceName }), sheetDefinitionId: definitionId, parentSheetInstanceId: parent.sheetInstanceId, instanceName: input.instanceName.trim(), parameterBindings: [], assignedComponentUnitIds: [], childSheetInstanceIds: [], portInstanceIds: [], variantApplicability: unique(input.variantApplicability), annotationNamespaceRef: parent.annotationNamespaceRef + "/" + input.instanceName.trim(), provenanceRefs: unique(input.provenanceRefs) });
  return createSchematicGraphSuccessor(graph, (draft) => { if (!existingDefinition) draft.sheetDefinitions.push(definition); draft.sheetInstances.push(instance); const draftParent = draft.sheetInstances.find((item) => item.sheetInstanceId === parent.sheetInstanceId)!; draftParent.childSheetInstanceIds = unique([...draftParent.childSheetInstanceIds, instance.sheetInstanceId]); draftParent.deterministicDigest = schematicDigest({ ...draftParent, deterministicDigest: undefined }); });
}

export function defineHierarchicalPort(graph: SchematicSemanticGraph, input: Omit<HierarchicalPortDefinition, "portDefinitionId" | "deterministicDigest"> & { sheetDefinitionId: string; portDefinitionId?: string }): SchematicSemanticGraph {
  const sheet = graph.sheetDefinitions.find((item) => item.sheetDefinitionId === input.sheetDefinitionId);
  if (!sheet || input.requiredMultiplicity.minimum < 0 || input.requiredMultiplicity.maximum < input.requiredMultiplicity.minimum) throw new Error("CD8_PORT_DEFINITION_INVALID");
  const port = member<HierarchicalPortDefinition>({ portDefinitionId: input.portDefinitionId ?? schematicId("port-definition", { sheet: sheet.sheetDefinitionId, name: input.semanticName, type: input.scalarOrBundleType }), semanticName: input.semanticName, direction: input.direction, electricalTypeOrSignalKind: input.electricalTypeOrSignalKind, scalarOrBundleType: structuredClone(input.scalarOrBundleType), voltageDomainRefs: unique(input.voltageDomainRefs), requiredMultiplicity: structuredClone(input.requiredMultiplicity), provenanceRefs: unique(input.provenanceRefs) });
  return createSchematicGraphSuccessor(graph, (draft) => { draft.portDefinitions.push(port); const definition = draft.sheetDefinitions.find((item) => item.sheetDefinitionId === sheet.sheetDefinitionId)!; definition.portDefinitionIds = unique([...definition.portDefinitionIds, port.portDefinitionId]); definition.deterministicDigest = schematicDigest({ ...definition, deterministicDigest: undefined }); });
}

export function bindHierarchicalPort(graph: SchematicSemanticGraph, input: Omit<HierarchicalPortBinding, "bindingId" | "validationState" | "deterministicDigest">): SchematicSemanticGraph {
  const parent = graph.sheetInstances.find((item) => item.sheetInstanceId === input.parentSheetInstanceId), child = graph.sheetInstances.find((item) => item.sheetInstanceId === input.childSheetInstanceId), port = graph.portDefinitions.find((item) => item.portDefinitionId === input.portDefinitionId);
  if (!parent || !child || child.parentSheetInstanceId !== parent.sheetInstanceId || !port || input.variantApplicability.some((item) => !graph.variantIds.includes(item))) throw new Error("CD8_PORT_BINDING_INVALID");
  const validObjects = new Set([...graph.nets.map((item) => item.netId), ...graph.bundleInstances.map((item) => item.bundleInstanceId)]);
  if (!validObjects.has(input.parentNetOrBundleId) || !validObjects.has(input.childNetOrBundleId)) throw new Error("CD8_PORT_BINDING_TARGET_MISSING");
  const binding = member<HierarchicalPortBinding>({ ...structuredClone(input), bindingId: schematicId("port-binding", input), variantApplicability: unique(input.variantApplicability), validationState: "pass" });
  return createSchematicGraphSuccessor(graph, (draft) => { draft.portBindings.push(binding); });
}

export function defineSignalBundle(graph: SchematicSemanticGraph, input: Omit<SignalBundleDefinition, "bundleId" | "deterministicDigest"> & { bundleId?: string }): SchematicSemanticGraph {
  const keys = input.memberDefinitions.map((item) => item.key), members = input.memberDefinitions.map((item) => item.memberId);
  if (!input.memberDefinitions.length || unique(keys).length !== keys.length || unique(members).length !== members.length) throw new Error("CD8_BUNDLE_MEMBER_IDENTITY_INVALID");
  const bundle = member<SignalBundleDefinition>({ ...structuredClone(input), bundleId: input.bundleId ?? schematicId("bundle-definition", input), memberDefinitions: [...input.memberDefinitions], provenanceRefs: unique(input.provenanceRefs) });
  return createSchematicGraphSuccessor(graph, (draft) => { draft.bundleDefinitions.push(bundle); });
}

export function instantiateSignalBundle(graph: SchematicSemanticGraph, input: Omit<SignalBundleInstance, "bundleInstanceId" | "deterministicDigest"> & { bundleInstanceId?: string }): SchematicSemanticGraph {
  const definition = graph.bundleDefinitions.find((item) => item.bundleId === input.bundleDefinitionId);
  if (!definition) throw new Error("CD8_BUNDLE_DEFINITION_MISSING");
  const expected = new Set(definition.memberDefinitions.map((item) => item.memberId)), mapped = input.memberNetMappings.map((item) => item.memberId);
  if (mapped.length !== expected.size || unique(mapped).length !== mapped.length || mapped.some((item) => !expected.has(item)) || input.memberNetMappings.some((item) => !graph.nets.some((net) => net.netId === item.netId))) throw new Error("CD8_BUNDLE_MAPPING_NOT_EXACT");
  const bundle = member<SignalBundleInstance>({ ...structuredClone(input), bundleInstanceId: input.bundleInstanceId ?? schematicId("bundle-instance", input), memberNetMappings: [...input.memberNetMappings].sort((a, b) => a.memberId.localeCompare(b.memberId)), variantApplicability: unique(input.variantApplicability), hierarchicalBindingRefs: unique(input.hierarchicalBindingRefs) });
  return createSchematicGraphSuccessor(graph, (draft) => { draft.bundleInstances.push(bundle); for (const mapping of bundle.memberNetMappings) { const net = draft.nets.find((item) => item.netId === mapping.netId)!; net.bundleMembershipIds = unique([...net.bundleMembershipIds, bundle.bundleInstanceId]); net.deterministicDigest = schematicDigest({ ...net, deterministicDigest: undefined }); } });
}
