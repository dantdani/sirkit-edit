import { validateSchematicGraph } from "./graph";
import { schematicDigest, schematicId } from "./stable";
import type { KiCadRoundTripCertificate, SchematicCompilationProblem, SchematicEvidenceState, SchematicSemanticGraph, StructuralCompletenessReport, VariantGraphProjection } from "./types";

const coverage = (state: boolean): SchematicEvidenceState => state ? "pass" : "fail";
const blockingKinds = new Set(["blocked_unresolved", "unsupported", "reserved_external_review"]);

export function compileStructuralCompletenessReport(input: { problem: SchematicCompilationProblem; graph: SchematicSemanticGraph; projections: VariantGraphProjection[]; roundTripCertificate?: KiCadRoundTripCertificate; requiredArchitectureRoleIds: string[]; requiredRecipeRoleIds: string[] }): StructuralCompletenessReport {
  const { graph } = input, graphValidation = validateSchematicGraph(graph), roleIds = new Set(graph.components.flatMap((item) => item.architectureRoleInstanceIds)), recipeIds = new Set(graph.components.flatMap((item) => item.recipeRoleInstanceIds));
  const roleInstantiationCoverage = [...new Set(input.requiredArchitectureRoleIds)].sort().map((roleId) => ({ roleId, state: coverage(roleIds.has(roleId)) }));
  const recipeSupportRoleCoverage = [...new Set(input.requiredRecipeRoleIds)].sort().map((roleId) => ({ roleId, state: coverage(recipeIds.has(roleId)) }));
  const exactAtomicBindingCoverage = graph.components.map((component) => ({ componentId: component.componentInstanceId, state: coverage(Boolean(component.exactAtomicPartRevisionId && component.exactManufacturerPartRevisionId && component.exactPackageRevisionId && component.symbolRevisionId && component.footprintRevisionId && component.mappingCertificateId)) }));
  const pinDispositionCoverage = graph.pins.flatMap((pin) => graph.variantIds.map((variantId) => { const dispositions = graph.terminalDispositions.filter((item) => item.pinInstanceId === pin.pinInstanceId && item.variantScope.includes(variantId)); return { pinId: pin.pinInstanceId, variantId, state: coverage(dispositions.length === 1 && !blockingKinds.has(dispositions[0].dispositionKind)) }; }));
  const railGroundCoverage = graph.railGroundRegistry.railDefinitions.map((definition) => ({ definitionId: definition.definitionId, state: coverage(graph.nets.some((net) => net.netId === definition.canonicalNetId && net.railGroundDefinitionId === definition.definitionId)) }));
  const interfacePortCoverage = graph.portDefinitions.map((port) => ({ portId: port.portDefinitionId, state: coverage(graph.portBindings.some((binding) => binding.portDefinitionId === port.portDefinitionId && binding.validationState === "pass")) }));
  const valueBindingCoverage = graph.components.map((component) => ({ componentId: component.componentInstanceId, state: coverage(Boolean(component.selectedValueId && component.displayedValue.trim())) }));
  const variantProjectionCoverage = graph.variantIds.map((variantId) => { const projection = input.projections.find((item) => item.variantId === variantId && item.sourceGraphRevisionId === graph.graphId); return { variantId, state: coverage(Boolean(projection && !projection.unresolvedVariantConflictIds.length)) }; });
  const hierarchyBindingCoverage = graph.portBindings.map((binding) => ({ bindingId: binding.bindingId, state: binding.validationState }));
  const certificate = input.roundTripCertificate, kicadRoundTripCoverage = certificate ? [{ certificateId: certificate.certificateId, state: coverage(certificate.certificateState === "semantically_equivalent" && certificate.sourceGraphDigest === graph.deterministicDigest) }] : [{ certificateId: "missing", state: "fail" as const }];
  const all = [...roleInstantiationCoverage, ...recipeSupportRoleCoverage, ...exactAtomicBindingCoverage, ...pinDispositionCoverage, ...railGroundCoverage, ...interfacePortCoverage, ...valueBindingCoverage, ...variantProjectionCoverage, ...hierarchyBindingCoverage, ...kicadRoundTripCoverage];
  const unresolved = [...graphValidation.diagnostics.map((item) => item.diagnosticId), ...all.filter((item) => item.state !== "pass" && item.state !== "not_applicable").map((item) => schematicId("completeness-gap", item))].sort();
  const unsupported = graph.validationState === "unsupported" || certificate?.certificateState === "unsupported_construct";
  const base: Omit<StructuralCompletenessReport, "reportId" | "deterministicDigest"> = { graphRevisionId: graph.graphId, roleInstantiationCoverage, exactAtomicBindingCoverage, pinDispositionCoverage, railGroundCoverage, interfacePortCoverage, recipeSupportRoleCoverage, valueBindingCoverage, variantProjectionCoverage, hierarchyBindingCoverage, kicadRoundTripCoverage, unresolvedDiagnosticIds: unresolved, readinessState: unsupported ? "unsupported" : unresolved.length ? "blocked" : "ready_for_review" };
  const withId = { ...base, reportId: schematicId("structural-completeness", { problem: input.problem.deterministicDigest, graph: graph.deterministicDigest, base }) };
  return { ...withId, deterministicDigest: schematicDigest(withId) };
}
