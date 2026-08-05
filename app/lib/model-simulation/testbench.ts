import type { EngineeringActor } from "../engineering/types";
import type { SchematicSemanticGraph, VariantGraphProjection } from "../schematic-compiler/types";
import { finalizeSimulation, simulationId, unique } from "./stable";
import type { SimulationScenario, SimulationTestbenchDefinition, TestbenchRegistrySnapshot } from "./types";

function humanReviewer(actor?: EngineeringActor): boolean { return Boolean(actor?.actorKind === "human" && ["reviewer", "project_admin"].includes(actor.role)); }
function duplicate(values: string[]): boolean { return new Set(values).size !== values.length; }

export function validateTestbench(testbench: SimulationTestbenchDefinition, graph?: SchematicSemanticGraph): string[] {
  const errors: string[] = [];
  if (!testbench.testbenchId || testbench.revision < 1 || !testbench.sourceRequirementRecipeObligationIds.length) errors.push("CD10_TESTBENCH_IDENTITY_OR_TRACEABILITY_INVALID");
  if (testbench.reviewState !== "approved" || testbench.lifecycleState !== "active" || !humanReviewer(testbench.reviewer)) errors.push("CD10_TESTBENCH_NOT_HUMAN_APPROVED");
  if (!testbench.analysisPlans.length || !testbench.measurementDefinitions.length || !testbench.assertionDefinitions.length) errors.push("CD10_TESTBENCH_ORACLE_INCOMPLETE");
  if (duplicate(testbench.analysisPlans.map((item) => item.analysisPlanId)) || duplicate(testbench.measurementDefinitions.map((item) => item.measurementId)) || duplicate(testbench.assertionDefinitions.map((item) => item.assertionId))) errors.push("CD10_TESTBENCH_DUPLICATE_OBJECT_ID");
  const measurements = new Set(testbench.measurementDefinitions.map((item) => item.measurementId));
  for (const assertion of testbench.assertionDefinitions) {
    if (assertion.reviewState !== "approved" || !humanReviewer(assertion.reviewer) || !assertion.requirementId || !assertion.measurementOrTemporalExpressionRefs.length || assertion.measurementOrTemporalExpressionRefs.some((id) => !measurements.has(id))) errors.push(`CD10_ASSERTION_INVALID:${assertion.assertionId}`);
    if (assertion.comparatorAndAllowedDomain.comparator === "between" || assertion.comparatorAndAllowedDomain.comparator === "outside") if (assertion.comparatorAndAllowedDomain.upper === undefined || assertion.comparatorAndAllowedDomain.upper < assertion.comparatorAndAllowedDomain.lower) errors.push(`CD10_ASSERTION_RANGE_INVALID:${assertion.assertionId}`);
  }
  for (const measurement of testbench.measurementDefinitions) if (!measurement.inputWaveformOrBranchSelectors.length || measurement.numericUncertaintyPolicy.absolute < 0 || measurement.numericUncertaintyPolicy.relative < 0) errors.push(`CD10_MEASUREMENT_INVALID:${measurement.measurementId}`);
  if (testbench.analysisPlans.some((plan) => !plan.outputSavePolicy.authoritativeRawRequired)) errors.push("CD10_AUTHORITATIVE_RAW_WAVEFORM_NOT_REQUIRED");
  if (testbench.stimulusDefinitions.some((stimulus) => !stimulus.sourceImpedanceAndReference.referenceNetId)) errors.push("CD10_STIMULUS_REFERENCE_MISSING");
  if (graph) {
    const semanticIds = new Set([...graph.nets.map((item) => item.netId), ...graph.portDefinitions.map((item) => item.portDefinitionId)]);
    const usedIds = [...testbench.stimulusDefinitions.flatMap((item) => [...item.targetSemanticNetOrPortIds, item.sourceImpedanceAndReference.referenceNetId]), ...testbench.loadAndExternalEnvironmentDefinitions.flatMap((item) => [...item.targetSemanticNetOrPortIds, item.referenceNetId]), ...testbench.initialStateDefinitions.flatMap((item) => item.assignments.map((assignment) => assignment.semanticNetId))];
    if (usedIds.some((id) => !semanticIds.has(id))) errors.push("CD10_TESTBENCH_SEMANTIC_TARGET_MISSING");
  }
  if (testbench.deterministicDigest !== finalizeSimulation(testbench).deterministicDigest) errors.push("CD10_TESTBENCH_DIGEST_MISMATCH");
  return unique(errors);
}

export function createTestbenchRegistry(input: { testbenches: SimulationTestbenchDefinition[]; revision?: number; reviewer?: EngineeringActor; approvedAt?: string; graph?: SchematicSemanticGraph }): TestbenchRegistrySnapshot {
  const testbenches = [...input.testbenches].sort((a, b) => a.testbenchId.localeCompare(b.testbenchId));
  const approved = humanReviewer(input.reviewer) && testbenches.length > 0 && testbenches.every((testbench) => validateTestbench(testbench, input.graph).length === 0);
  const body = { revision: input.revision ?? 1, testbenches, lifecycleState: approved ? "approved" as const : "draft" as const, ...(approved ? { approvedBy: structuredClone(input.reviewer), approvedAt: input.approvedAt } : {}) };
  return finalizeSimulation<TestbenchRegistrySnapshot>({ ...body, registryId: simulationId("testbench-registry", body), deterministicDigest: "" });
}

export function validateTestbenchRegistry(registry: TestbenchRegistrySnapshot, graph?: SchematicSemanticGraph): string[] {
  const errors = registry.testbenches.flatMap((testbench) => validateTestbench(testbench, graph));
  if (!registry.testbenches.length) errors.push("CD10_TESTBENCH_REGISTRY_EMPTY");
  if (duplicate(registry.testbenches.map((item) => item.testbenchId))) errors.push("CD10_TESTBENCH_REGISTRY_DUPLICATE_ID");
  if (registry.lifecycleState !== "approved" || !humanReviewer(registry.approvedBy) || !registry.approvedAt) errors.push("CD10_TESTBENCH_REGISTRY_NOT_APPROVED");
  if (registry.deterministicDigest !== finalizeSimulation(registry).deterministicDigest) errors.push("CD10_TESTBENCH_REGISTRY_DIGEST_MISMATCH");
  return unique(errors);
}

export function createSimulationScenario(input: { projection: VariantGraphProjection; graph: SchematicSemanticGraph; operatingModeAndState: string; supplyAndRampAssignments?: string[]; loadAndExternalAssignments?: string[]; temperatureAssignments?: SimulationScenario["temperatureAssignments"]; componentParameterAssignmentsOrDomains?: string[]; initialConditionPolicy?: SimulationScenario["initialConditionPolicy"]; faultInjectionAssignments?: string[]; assumptionRefs?: string[] }): SimulationScenario {
  if (input.projection.sourceGraphRevisionId !== input.graph.graphId || !input.graph.variantIds.includes(input.projection.variantId) || input.projection.unresolvedVariantConflictIds.length) throw new Error("CD10_SCENARIO_VARIANT_PROJECTION_INVALID");
  const body = { variantProjectionId: input.projection.projectionId, variantId: input.projection.variantId, operatingModeAndState: input.operatingModeAndState, supplyAndRampAssignments: unique(input.supplyAndRampAssignments ?? []), loadAndExternalAssignments: unique(input.loadAndExternalAssignments ?? []), temperatureAssignments: [...(input.temperatureAssignments ?? [{ temperatureC: 25, sourceRef: "explicit:nominal-ambient" }])].sort((a, b) => a.temperatureC - b.temperatureC), componentParameterAssignmentsOrDomains: unique(input.componentParameterAssignmentsOrDomains ?? []), initialConditionPolicy: input.initialConditionPolicy ?? "cold_start", faultInjectionAssignments: unique(input.faultInjectionAssignments ?? []), assumptionRefs: unique(input.assumptionRefs ?? []) };
  return finalizeSimulation<SimulationScenario>({ ...body, scenarioId: simulationId("simulation-scenario", body), deterministicDigest: "" });
}
