import { createSchematicGraphSuccessor } from "./graph";
import { schematicDigest, schematicId } from "./stable";
import type { ReferenceDesignationRecord, SchematicSemanticGraph } from "./types";

const unique = (values: string[]) => [...new Set(values)].sort();
function finalized(value: Omit<ReferenceDesignationRecord, "deterministicDigest">): ReferenceDesignationRecord { return { ...value, deterministicDigest: schematicDigest(value) }; }

export interface AnnotationPolicy { policyRevisionId: string; prefixByAtomicRevision: Record<string, string>; defaultPrefix: string; reservedReferences: string[]; tombstonedReferences: string[]; }

export function allocateStableAnnotations(graph: SchematicSemanticGraph, policy: AnnotationPolicy): SchematicSemanticGraph {
  if (!policy.policyRevisionId || !policy.defaultPrefix.trim()) throw new Error("CD8_ANNOTATION_POLICY_INVALID");
  const occupied = new Set(unique([...policy.reservedReferences, ...policy.tombstonedReferences, ...graph.annotations.map((item) => item.renderedReference)]).map((item) => item.toUpperCase()));
  const byComponent = new Map(graph.annotations.map((item) => [item.componentInstanceId, item]));
  const additions: ReferenceDesignationRecord[] = [];
  for (const component of [...graph.components].sort((a, b) => a.componentInstanceId.localeCompare(b.componentInstanceId))) {
    if (byComponent.has(component.componentInstanceId)) continue;
    const prefix = (policy.prefixByAtomicRevision[component.exactAtomicPartRevisionId] ?? policy.defaultPrefix).trim().toUpperCase().replace(/[^A-Z]/g, "") || "U";
    let index = 1;
    while (occupied.has(`${prefix}${index}`)) index++;
    const renderedReference = `${prefix}${index}`; occupied.add(renderedReference);
    additions.push(finalized({ annotationRecordId: schematicId("annotation", { component: component.componentInstanceId, policy: policy.policyRevisionId }), componentInstanceId: component.componentInstanceId, prefix, numericOrPolicySuffix: String(index), renderedReference, allocationNamespace: "root", allocationPolicyRevisionId: policy.policyRevisionId, reservationOrTombstoneRefs: [], previousRenderedReferences: [], conflictState: "none" }));
  }
  if (!additions.length) return graph;
  return createSchematicGraphSuccessor(graph, (draft) => {
    draft.annotations.push(...additions);
    for (const annotation of additions) {
      const component = draft.components.find((item) => item.componentInstanceId === annotation.componentInstanceId)!;
      component.referenceDesignationRecordId = annotation.annotationRecordId;
      component.deterministicDigest = schematicDigest({ ...component, deterministicDigest: undefined });
    }
  });
}

export function annotationUuid(graphId: string, semanticObjectId: string, externalVersion: string): string {
  const hex = schematicDigest({ graphId, semanticObjectId, externalVersion }).slice(5, 37);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
