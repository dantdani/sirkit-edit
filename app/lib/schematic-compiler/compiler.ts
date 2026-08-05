import type { CalculationProjectState, SelectedCircuitValue } from "../calculation/types";
import type { ComponentSelectionCandidate, ComponentSelectionProjectState, RolePartAssignment } from "../component-selection/types";
import { allocateStableAnnotations } from "./annotation";
import { materializeExactAtomicComponent } from "./atomic-binding";
import { addComponentBundle, createEmptySchematicGraph, withGraphValidation } from "./graph";
import { schematicId } from "./stable";
import type { PopulationState, SchematicCompilationProblem, SchematicSemanticGraph } from "./types";

function renderedValue(value: SelectedCircuitValue | undefined, fallback: string): string {
  if (!value) return fallback;
  const quantity = value.engineeringValue, exact = quantity.exactValue;
  return exact.denominator === "1" ? `${exact.numerator} ${quantity.canonicalUnit}` : `${exact.numerator}/${exact.denominator} ${quantity.canonicalUnit}`;
}
function population(candidate: ComponentSelectionCandidate, assignment: RolePartAssignment, variantId: string): PopulationState {
  const view = candidate.variantBOMViews.find((item) => item.variantId === variantId);
  if (view) { const lines = candidate.preliminaryBOMLines.filter((item) => view.bomLineIds.includes(item.bomLineId)); return lines.some((line) => line.roleAssignmentIds.includes(assignment.assignmentId) && (line.quantityByVariant.find((item) => item.variantId === variantId)?.placedQuantity ?? 0) > 0) ? "populated" : "not_populated"; }
  return !assignment.variantPopulationConditions.length || assignment.variantPopulationConditions.includes(variantId) ? "populated" : "not_populated";
}
function prefix(category: string): string { const value = category.toLowerCase(); if (value.includes("resistor")) return "R"; if (value.includes("capacitor")) return "C"; if (value.includes("inductor") || value.includes("ferrite")) return "L"; if (value.includes("connector")) return "J"; if (value.includes("diode") || value.includes("led")) return "D"; if (value.includes("transistor") || value.includes("mosfet")) return "Q"; if (value.includes("crystal") || value.includes("oscillator")) return "Y"; if (value.includes("switch")) return "SW"; return "U"; }

/**
 * Instantiates exact CD-6 identities and CD-7 values only. It deliberately
 * leaves electrical pins blocked-unresolved until typed recipe/interface/net
 * rules are compiled; no legacy coordinates or label strings are consulted.
 */
export function compileExactSchematicSkeleton(input: { problem: SchematicCompilationProblem; componentSelectionState: ComponentSelectionProjectState; calculationState: CalculationProjectState }): { graph: SchematicSemanticGraph; blockingObligations: string[] } {
  const selectionDecision = input.componentSelectionState.decision, candidate = selectionDecision?.selectedCandidateId ? input.componentSelectionState.candidates.find((item) => item.candidateId === selectionDecision.selectedCandidateId && item.candidateId === input.problem.componentSelectionCandidateId) : undefined;
  const calculationDecision = input.calculationState.decision, report = calculationDecision?.state === "approved" ? input.calculationState.reports.find((item) => item.reportId === calculationDecision.reportId && item.deterministicDigest === calculationDecision.reportDigest && item.reportId === input.problem.circuitCalculationReportId) : undefined;
  if (!candidate || !report || !input.problem.variantIds.length) throw new Error("CD8_EXACT_SKELETON_PREREQUISITE_INVALID");
  let graph = createEmptySchematicGraph({ projectId: input.problem.projectId, variantIds: input.problem.variantIds, dependencyRefs: input.problem.upstreamRevisionRefs.map((item) => item.digest), namingPolicyRevisionId: input.problem.netNamingPolicyRevisionId });
  const root = graph.sheetInstances[0].sheetInstanceId, prefixByAtomicRevision: Record<string, string> = {}, blocking: string[] = [];
  for (const assignment of [...candidate.roleAssignments].sort((a, b) => a.assignmentId.localeCompare(b.assignmentId))) {
    const requirement = input.componentSelectionState.problem.componentRoleRequirements.find((item) => item.roleRequirementId === assignment.roleRequirementId), evaluation = input.componentSelectionState.evaluations.find((item) => item.evaluationId === assignment.evaluationId), cadBundleCertificate = evaluation?.cadBundleCertificate, snapshot = input.componentSelectionState.catalogSnapshot.portableSnapshots.find((item) => item.atomicRevision.id === assignment.atomicPartRevisionId);
    if (!requirement || !cadBundleCertificate || !snapshot) throw new Error(`CD8_EXACT_ASSIGNMENT_PROOF_MISSING:${assignment.assignmentId}`);
    prefixByAtomicRevision[assignment.atomicPartRevisionId] = prefix(requirement.category);
    const selected = report.selectedValues.find((item) => [assignment.roleRequirementId, requirement.recipeRoleSlotId, assignment.recipeBindingCandidateId].includes(item.roleInstanceId));
    const quantity = Math.max(1, assignment.quantityPopulation);
    for (let ordinal = 1; ordinal <= quantity; ordinal++) {
      const componentInstanceId = schematicId("component-instance", { assignment: assignment.assignmentId, ordinal }), bundle = materializeExactAtomicComponent({ assignment, cadBundleCertificate, snapshot, componentInstanceId, architectureRoleInstanceIds: [...requirement.architectureRoleIds], recipeRoleInstanceIds: [requirement.recipeRoleSlotId, assignment.recipeBindingCandidateId], variants: input.problem.variantIds.map((variantId) => ({ variantId, populationState: population(candidate, assignment, variantId) })), selectedValue: selected ? { selectedValueId: selected.selectedValueId, displayedValue: renderedValue(selected, snapshot.exactPart?.exactMpn ?? assignment.atomicPartRevisionId), roleInstanceId: selected.roleInstanceId } : undefined, assignedSheetInstanceId: root });
      graph = addComponentBundle(graph, bundle);
      blocking.push(...bundle.initialDispositions.filter((item) => item.dispositionKind === "blocked_unresolved" || item.dispositionKind === "unsupported").map((item) => `${item.pinInstanceId}:${item.variantScope.join(",")}`));
    }
  }
  graph = allocateStableAnnotations(graph, { policyRevisionId: input.problem.annotationPolicyRevisionId, prefixByAtomicRevision, defaultPrefix: "U", reservedReferences: [], tombstonedReferences: [] });
  graph = withGraphValidation(graph);
  return { graph, blockingObligations: [...new Set(blocking)].sort() };
}
