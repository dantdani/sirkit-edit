import { makeFixtureCatalog, TEST_NOW } from "../../atomic/__tests__/fixtures";
import type { RolePartAssignment, SelectedCADBundleCertificate } from "../../component-selection/types";
import { selectionDigest, selectionId } from "../../component-selection/stable";
import { allocateStableAnnotations } from "../annotation";
import { buildKiCadArtifactManifest, validateManifestAfterRoundTrip } from "../artifact";
import { materializeExactAtomicComponent } from "../atomic-binding";
import { createCd8UpstreamCompletionSignoff, LOW_VOLTAGE_SCHEMATIC_PROFILE_V1 } from "../capability";
import { materializeSchematicCandidate } from "../candidate";
import { compileStructuralCompletenessReport } from "../completeness";
import { compileDiagramView } from "../diagram";
import { certifySemanticRoundTrip } from "../equivalence";
import { addComponentBundle, connectPinToNet, createElectricalNet, createEmptySchematicGraph, withGraphValidation } from "../graph";
import { schematicDigest } from "../stable";
import { compilePcbSynchronizationContract } from "../sync";
import { SCHEMATIC_PROBLEM_SCHEMA_VERSION } from "../types";
import type { Cd8UpstreamCompletionSignoff, SchematicCompilationProblem, SchematicCompilerCapabilityProfile, SchematicSemanticGraph } from "../types";
import { projectAllSchematicVariants } from "../variants";

export const HUMAN = { actorId: "user:test-reviewer", actorKind: "human" as const, sessionId: "session:test", role: "project_admin" as const };

export function exactAtomicBundle() {
  const fixture = makeFixtureCatalog(), snapshot = fixture.catalog.portableSnapshot(fixture.published.id, TEST_NOW), mapping = snapshot.mapping!, footprint = snapshot.footprint!;
  const cadBase: Omit<SelectedCADBundleCertificate, "certificateId" | "deterministicDigest"> = { atomicPartRevisionId: snapshot.atomicRevision.id, symbolAssetRevisionId: snapshot.symbol.versionId, footprintAssetRevisionId: footprint.versionId, modelAssetRevisionIds: [], terminalPadMappingCertificateId: mapping.id, packageCompatibilityCertificateId: mapping.packageProofId!, electricalTypeFunctionRevision: selectionDigest(mapping.entries), licenseExportDisposition: "redistributable", reviewPublicationState: "published", policyProfileId: "pcb_assignable", validationResults: [] };
  const cadWithId = { ...cadBase, certificateId: selectionId("cad-certificate", cadBase) }, cadBundleCertificate: SelectedCADBundleCertificate = { ...cadWithId, deterministicDigest: selectionDigest(cadWithId) };
  const assignmentBase: Omit<RolePartAssignment, "assignmentId" | "deterministicDigest"> = { roleRequirementId: "role:controller", atomicPartRevisionId: snapshot.atomicRevision.id, exactPackageRevisionId: footprint.versionId, cadBundleCertificateId: cadBundleCertificate.certificateId, recipeBindingCandidateId: "recipe-binding:test", exactPinAllocationCandidateId: "pin-plan:test", cd3ReconciliationRevision: "power-reconcile:test", calculationEligibilityObligationIds: [], quantityPopulation: 1, variantPopulationConditions: ["variant:default"], sourcingChoiceIds: [], evaluationId: "evaluation:test" };
  const assignmentWithId = { ...assignmentBase, assignmentId: selectionId("role-assignment", assignmentBase) }, assignment: RolePartAssignment = { ...assignmentWithId, deterministicDigest: selectionDigest(assignmentWithId) };
  return { snapshot, assignment, cadBundleCertificate };
}

export function readyGraph(): SchematicSemanticGraph {
  let graph = createEmptySchematicGraph({ projectId: "project:test", variantIds: ["variant:default"], dependencyRefs: ["requirements:test", "calculation:test"], namingPolicyRevisionId: "net-policy:test" });
  const root = graph.sheetInstances[0].sheetInstanceId, exact = exactAtomicBundle();
  graph = addComponentBundle(graph, materializeExactAtomicComponent({ ...exact, architectureRoleInstanceIds: ["architecture-role:controller"], recipeRoleInstanceIds: ["recipe-role:controller"], variants: [{ variantId: "variant:default", populationState: "populated" }], selectedValue: { selectedValueId: "calculated-value:controller", displayedValue: "FX-100-QFN", roleInstanceId: "recipe-role:controller" }, assignedSheetInstanceId: root }));
  for (const name of ["VDD", "GND"]) graph = createElectricalNet(graph, { netId: `net:${name}`, semanticRoleIds: [`role:${name.toLowerCase()}`], canonicalName: name, displayAliases: [], scopeKind: "global", owningHierarchyInstanceId: root, voltageDomainIds: name === "VDD" ? ["domain:3v3"] : ["domain:return"], signalMetadata: [], bundleMembershipIds: [], netClassConstraintRefs: [], provenanceRefs: [`recipe:net:${name}`], lifecycleState: "active" });
  graph = connectPinToNet(graph, { pinInstanceId: graph.pins[0].pinInstanceId, netId: "net:VDD", variants: ["variant:default"], provenanceRefs: ["recipe:connection:vdd"] });
  graph = connectPinToNet(graph, { pinInstanceId: graph.pins[1].pinInstanceId, netId: "net:GND", variants: ["variant:default"], provenanceRefs: ["recipe:connection:gnd"] });
  graph = allocateStableAnnotations(graph, { policyRevisionId: "annotation-policy:test", prefixByAtomicRevision: { [exact.snapshot.atomicRevision.id]: "U" }, defaultPrefix: "U", reservedReferences: [], tombstonedReferences: [] });
  return withGraphValidation(graph);
}

export function supportedProfile(): SchematicCompilerCapabilityProfile { const next = { ...structuredClone(LOW_VOLTAGE_SCHEMATIC_PROFILE_V1), supportedKiCadVersions: ["20250114"], deterministicDigest: "" }; next.deterministicDigest = schematicDigest({ ...next, deterministicDigest: undefined }); return next; }

export function validSignoff(): Cd8UpstreamCompletionSignoff { return createCd8UpstreamCompletionSignoff({ cd1Verdict: "CD-1 COMPLETE", cd2Verdict: "CD-2 COMPLETE", cd3Verdict: "CD-3 COMPLETE", cd4Verdict: "CD-4 COMPLETE", cd5Verdict: "CD-5 COMPLETE", cd6Verdict: "CD-6 COMPLETE", cd7Verdict: "CD-7 COMPLETE", requirementsDigest: "digest:requirements", architectureCandidateDigest: "digest:architecture", architectureDecisionDigest: "digest:architecture-decision", powerCandidateDigest: "digest:power", powerDecisionDigest: "digest:power-decision", interfaceCandidateDigest: "digest:interface", interfaceDecisionDigest: "digest:interface-decision", circuitKnowledgeStateDigest: "digest:knowledge", circuitKnowledgeDecisionDigest: "digest:knowledge-decision", componentSelectionStateDigest: "digest:selection", componentSelectionCandidateDigest: "digest:selection-candidate", componentSelectionDecisionDigest: "digest:selection-decision", calculationStateDigest: "digest:calculation", calculationReportDigest: "digest:calculation-report", calculationDecisionDigest: "digest:calculation-decision", approver: HUMAN, approvedAt: "2026-07-18T12:00:00.000Z" }); }

export function validProblem(): SchematicCompilationProblem {
  const upstreamRevisionRefs: SchematicCompilationProblem["upstreamRevisionRefs"] = ([1, 2, 3, 4, 5, 6, 7] as const).map((stage) => ({ stage: `CD-${stage}` as SchematicCompilationProblem["upstreamRevisionRefs"][number]["stage"], objectId: `object:${stage}`, digest: `digest:${stage}` }));
  const base: Omit<SchematicCompilationProblem, "problemId" | "deterministicDigest"> = { schemaVersion: SCHEMATIC_PROBLEM_SCHEMA_VERSION, tenantId: "tenant:test", projectId: "project:test", branchId: "branch:test", revision: 1, upstreamRevisionRefs, architectureCandidateId: "architecture:test", powerPlanId: "power:test", interfacePlanId: "interface:test", recipeCompositionPlanId: "recipe:test", componentSelectionCandidateId: "selection:test", circuitCalculationReportId: "calculation:test", atomicLibrarySnapshotId: "atomic-snapshot:test", variantIds: ["variant:default"], capabilityProfileRevisionId: "profile:test", hierarchyPolicyRevisionId: "hierarchy:test", annotationPolicyRevisionId: "annotation:test", netNamingPolicyRevisionId: "naming:test", layoutPolicyRevisionId: "layout:test", kicadAdapterPolicyRevisionId: "kicad:test", userConstraintRevisionIds: [], dependencyDigest: "dependency:test", lifecycleState: "draft_problem", blockingUnknownIds: [], createdBy: HUMAN, createdAt: "2026-07-18T12:00:00.000Z" };
  const withId = { ...base, problemId: "schematic-problem:test" }; return { ...withId, deterministicDigest: schematicDigest(withId) };
}

export function readyCandidateBundle() {
  const graph = readyGraph(), problem = validProblem(), profile = supportedProfile(), candidateId = `schematic-candidate:${schematicDigest({ problem: problem.deterministicDigest, graph: graph.deterministicDigest }).slice(5, 37)}`;
  let manifest = buildKiCadArtifactManifest({ candidateId, version: "20250114", adapterRevisionId: "test-independent-adapter:1", rootPath: "design/root.kicad_sch", childPaths: [], files: [{ path: "design/root.kicad_sch", content: "(kicad_sch (version 20250114) (generator sirkit-test))" }], externalMappings: [], profile });
  const certificate = certifySemanticRoundTrip({ source: graph, reparsed: structuredClone(graph), artifactManifestId: manifest.manifestId, independentParserRevisionId: "test-independent-parser:1", equivalencePolicyRevisionId: profile.policies.equivalence });
  manifest = validateManifestAfterRoundTrip(manifest, certificate);
  const projections = projectAllSchematicVariants(graph), completeness = compileStructuralCompletenessReport({ problem, graph, projections, roundTripCertificate: certificate, requiredArchitectureRoleIds: ["architecture-role:controller"], requiredRecipeRoleIds: ["recipe-role:controller"] });
  const syncContract = compilePcbSynchronizationContract({ candidateId, graph, projections });
  const diagrams = [compileDiagramView(graph, graph.sheetInstances[0].sheetInstanceId)];
  const candidate = materializeSchematicCandidate({ problem, graph, diagrams, manifest, certificate, completeness, syncContract, actor: HUMAN, createdAt: "2026-07-18T12:00:00.000Z" });
  return { graph, problem, profile, candidateId, manifest, certificate, projections, completeness, syncContract, diagrams, candidate };
}
