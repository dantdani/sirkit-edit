import { describe, expect, it } from "vitest";
import type { EngineeringClaim, PortableAtomicSnapshot } from "../../atomic/types";
import { makeFixtureCatalog, TEST_NOW, VOLTAGE_ABS_MAX } from "../../atomic/__tests__/fixtures";
import { createCd5PcbFoundationSignoff, createCd5UpstreamCompletionSignoff, CURRENT_PCB_FOUNDATION_REVISIONS, EMBEDDED_CIRCUIT_KNOWLEDGE_PROFILE_V1 } from "../../circuit-knowledge/capability";
import { createCircuitRecipeLibrary } from "../../circuit-knowledge/library";
import { compileCircuitKnowledgeProblem } from "../../circuit-knowledge/problem";
import { createCircuitKnowledgeProjectState } from "../../circuit-knowledge/project";
import type { EngineeringActor } from "../../engineering/types";
import { interfaceCandidate, interfaceProblem, interfaceProblemInput } from "../../interfaces/__tests__/fixtures";
import { createInterfaceProjectState } from "../../interfaces/project";
import { createInterfacePlanningDecision } from "../../interfaces/selection";
import { interfaceDigest } from "../../interfaces/stable";
import { createComponentAlternativePlan } from "../alternatives";
import { materializePreliminaryBom, preliminaryBomExport } from "../bom";
import { createCd6UpstreamCompletionSignoff, EMBEDDED_COMPONENT_SELECTION_PROFILE_V1 } from "../capability";
import { createEngineeringCatalogSnapshot, createCatalogQuery, queryEngineeringCatalog } from "../catalog";
import { approveComponentSelectionDecision, createComponentSelectionDecision } from "../decision";
import { runSelectionFixedPoint } from "../fixed-point";
import { evaluatePartCompatibility } from "../gates";
import { resolveExactIdentity } from "../identity";
import { aggregateHardEvidence, andFour, orFour } from "../logic";
import { createComponentSelectionProjectState, validateComponentSelectionProjectState } from "../project";
import { compileComponentSelectionProblem } from "../problem";
import { createReconciliationCertificate } from "../reconciliation";
import { createBomConstraintModel, exhaustiveJointAssignmentOracle, solveJointBom } from "../solver";
import { createSupplierOfferObservation, createSupplierSourcingSnapshot, normalizeProcurementCost } from "../sourcing";
import { selectionDigest } from "../stable";
import { applyComponentSelectionTransaction, createComponentSelectionTransaction } from "../transactions";
import type {
  Cd6UpstreamCompletionSignoff,
  CompiledSelectionPredicate,
  ComponentRoleRequirement,
  ComponentSelectionProblem,
  PartCompatibilityEvaluation,
} from "../types";
import { COMPONENT_SELECTION_PROBLEM_VERSION } from "../types";

const NOW = TEST_NOW.toISOString();
const REVIEWER: EngineeringActor = { actorId: "human:test", actorKind: "human", sessionId: "session:test", role: "reviewer" };
const AI: EngineeringActor = { actorId: "ai:test", actorKind: "ai", sessionId: "session:ai", role: "automation" };

const CATEGORY_CLAIM: EngineeringClaim = {
  id: "claim_category_resistor",
  property: "category",
  facet: "identity",
  value: "resistor",
  limit: "guaranteed",
  conditions: {},
  scope: { kind: "part", id: "exact_fixture" },
  state: "source_backed",
  evidenceIds: ["evidence_fixture"],
  conflictsWith: [],
  safetyCritical: false,
};

function catalogWithCategory(claims?: EngineeringClaim[]) {
  const fixture = makeFixtureCatalog(claims ? { claims } : {});
  const portable = fixture.catalog.portableSnapshot(fixture.published.id, TEST_NOW);
  portable.claims.push(CATEGORY_CLAIM);
  return {
    fixture,
    portable,
    catalog: createEngineeringCatalogSnapshot({
      portableSnapshots: [portable],
      recipeOverlayRevisionIds: ["recipe:test:1"],
      sourceAdapterRevisionIds: ["adapter:test:1"],
      publicationPolicyRevision: "publication:test:1",
      createdAt: NOW,
    }),
  };
}

function predicate(input: Omit<CompiledSelectionPredicate, "deterministicDigest">): CompiledSelectionPredicate {
  return { ...input, deterministicDigest: selectionDigest(input) };
}

function role(roleRequirementId = "role:r1", electrical: CompiledSelectionPredicate[] = []): ComponentRoleRequirement {
  const base: Omit<ComponentRoleRequirement, "deterministicDigest"> = {
    roleRequirementId,
    architectureRoleIds: [`architecture:${roleRequirementId}`],
    recipeRoleSlotId: `slot:${roleRequirementId}`,
    semanticRole: "test resistor",
    category: "resistor",
    quantityCardinality: { minimum: 1, maximum: 1, exact: 1 },
    populationPolicy: "required",
    modeVariantConditions: [],
    hardElectricalRequirements: electrical,
    hardFunctionalResourceRequirements: [],
    hardEnvironmentalQualificationRequirements: [],
    hardPackageMechanicalRequirements: [],
    hardCADModelRecipeRequirements: [predicate({ predicateId: `pred:cad:${roleRequirementId}`, sourceIds: ["recipe:test:1"], strength: "hard", applicabilityConditions: [], predicate: { kind: "cad", requiredProfile: "pcb_assignable", requireModel: false, requireExportableLicense: true }, evidenceRule: "exact reviewed CAD", unknownBehavior: "block", failureDiagnosticTemplate: "Exact CAD required", evaluatorId: "cad" })],
    hardLifecycleLicenseSourcingRequirements: [],
    preferredCriteria: [],
    mandatedPartOrVendorConstraints: [],
    alternativePolicy: "independent_proof_required",
    cd3ReconciliationObligations: ["rail:test"],
    cd4AllocationProblemTemplateId: "pin-allocation:test",
    cd5BindingRequirements: ["recipe:test:1"],
    cd7ParameterModelRequirements: ["model:test"],
    requirementIds: ["requirement:test"],
    evidenceObligationIds: ["evidence_fixture"],
    completenessState: "complete",
    blockerIds: [],
  };
  return { ...base, deterministicDigest: selectionDigest(base) };
}

function reconciliations(snapshot: PortableAtomicSnapshot, roleId: string) {
  return (["CD-3", "CD-4", "CD-5"] as const).map((kind) => createReconciliationCertificate({
    kind,
    atomicPartRevisionId: snapshot.atomicRevision.id,
    exactPackageRevisionId: snapshot.footprint!.versionId,
    sourceProblemDigest: `source:${kind}`,
    state: "pass",
    exactTerminalOrResourceRefs: snapshot.mapping!.entries.map((entry) => entry.manufacturerTerminalId),
    expandedRoleRequirementIds: [roleId],
    blockerIds: [],
    downstreamObligationIds: kind === "CD-5" ? ["cd7:model:test"] : [],
  }));
}

function problem(roles: ComponentRoleRequirement[], catalogDigest: string): ComponentSelectionProblem {
  const base: Omit<ComponentSelectionProblem, "deterministicDigest"> = {
    schemaVersion: COMPONENT_SELECTION_PROBLEM_VERSION,
    problemId: "problem:test",
    tenantId: "tenant:test",
    projectId: "project:test",
    branchId: "branch:test",
    requirementsPackageRevision: { id: "requirements:test", revision: 1, digest: "requirements:digest" },
    systemArchitectureCandidateRevision: { id: "architecture:test", revision: 1, digest: "architecture:digest", decisionDigest: "architecture:decision" },
    powerArchitectureCandidateRevision: { id: "power:test", revision: 1, digest: "power:digest", decisionDigest: "power:decision" },
    interfacePlanningCandidateRevision: { id: "interface:test", revision: 1, digest: "interface:digest", decisionDigest: "interface:decision" },
    recipeBindingProblemRevision: { problemDigest: "recipe:problem", decisionDigest: "recipe:decision", stateDigest: "recipe:state" },
    upstreamSignoffDigest: "signoff:digest",
    capabilityProfileRevision: EMBEDDED_COMPONENT_SELECTION_PROFILE_V1.deterministicDigest,
    componentRoleRequirements: roles,
    operatingModeVariantIds: ["variant:default"],
    projectPolicyRevision: "project-policy:1",
    catalogSnapshotRevision: catalogDigest,
    sourcingPolicyRevision: "sourcing-policy:1",
    solverEvaluatorRegistryRevision: "solver-registry:1",
    activeAssumptionIds: [],
    blockingUnknownIds: [],
    createdBy: REVIEWER,
    createdAt: NOW,
  };
  return { ...base, deterministicDigest: selectionDigest(base) };
}

function exactEvaluation(roleValue: ComponentRoleRequirement, data = catalogWithCategory()): PartCompatibilityEvaluation {
  return evaluatePartCompatibility({
    problemId: "problem:test",
    requirement: roleValue,
    catalog: data.catalog,
    atomicPartRevisionId: data.portable.atomicRevision.id,
    reconciliations: reconciliations(data.portable, roleValue.roleRequirementId),
    capabilityProfile: EMBEDDED_COMPONENT_SELECTION_PROFILE_V1,
    now: NOW,
  });
}

describe("CD-6 evidence-backed selection", () => {
  it("returns BLOCKED BY CD-5 when the current recipe stage has no approved binding", () => {
    const upstream = interfaceProblemInput(); const interfaceProblemValue = interfaceProblem();
    const makeSelectable = (candidateInput: ReturnType<typeof interfaceCandidate>) => { const contractSet = structuredClone(candidateInput.contractSet); contractSet.safeStates = contractSet.safeStates.map((row) => ({ ...row, requiredElectricalState: "high_impedance" as const, contentionPolicy: "forbidden" as const, backPowerPolicy: "forbidden" as const })); contractSet.hardGateResults = contractSet.hardGateResults.map((gate) => ({ ...gate, state: "pass" as const })); contractSet.feasibilityState = "feasible_at_logical_planning"; contractSet.deterministicDigest = interfaceDigest({ ...contractSet, deterministicDigest: undefined }); const next = { ...candidateInput, contractSet, feasibilityState: "feasible_at_logical_planning" as const }; return { ...next, deterministicDigest: interfaceDigest({ ...next, deterministicDigest: undefined }) }; };
    const interfaceCandidates = [0, 1, 2].map((index) => makeSelectable(interfaceCandidate(index, interfaceProblemValue))); const selectedInterface = interfaceCandidates[0]; const interfaceDecision = createInterfacePlanningDecision({ candidates: interfaceCandidates, candidateId: selectedInterface.candidateId, unresolvedRiskIds: selectedInterface.risks.filter((risk) => !["closed", "mitigation_verified"].includes(risk.mitigationState)).map((risk) => risk.riskId), approver: REVIEWER, rationale: "CD-6 prerequisite fixture", approvedAt: NOW }); const interfaceState = createInterfaceProjectState({ projectId: interfaceProblemValue.projectId, branchId: interfaceProblemValue.branchId, upstreamSignoff: upstream.upstreamSignoff, problem: interfaceProblemValue, candidates: interfaceCandidates, selection: interfaceDecision });
    const architecture = upstream.architectureState.candidates.find((item) => item.candidateId === upstream.architectureState.selection!.candidateId)!; const power = upstream.powerState.candidates.find((item) => item.candidateId === upstream.powerState.selection!.candidateId)!; const cd5Signoff = createCd5UpstreamCompletionSignoff({ cd1Verdict: "CD-1 COMPLETE", cd2Verdict: "CD-2 COMPLETE", cd3Verdict: "CD-3 COMPLETE", cd4Verdict: "CD-4 COMPLETE", requirementsDigest: upstream.requirementsPackage.deterministicDigest, architectureCandidateDigest: architecture.deterministicDigest, architectureDecisionDigest: upstream.architectureState.selection!.deterministicDigest, powerCandidateDigest: power.deterministicDigest, powerDecisionDigest: upstream.powerState.selection!.deterministicDigest, interfaceCandidateDigest: selectedInterface.deterministicDigest, interfaceDecisionDigest: interfaceDecision.deterministicDigest, approver: REVIEWER, approvedAt: NOW }); const pcbSignoff = createCd5PcbFoundationSignoff({ pcbStage1Verdict: "PCB STAGE 1 COMPLETE", pcbStage2Verdict: "PCB STAGE 2 COMPLETE", pcbStage3Verdict: "PCB STAGE 3 COMPLETE", pcbStage4Verdict: "PCB STAGE 4 COMPLETE", pcbStage5Verdict: "PCB STAGE 5 COMPLETE", pcbStage6Verdict: "PCB STAGE 6 COMPLETE", pcbStage9Verdict: "PCB STAGE 9 COMPLETE", pcbStage10Verdict: "PCB STAGE 10 COMPLETE", ...CURRENT_PCB_FOUNDATION_REVISIONS, approver: REVIEWER, approvedAt: NOW }); const library = createCircuitRecipeLibrary({ createdAt: NOW }); const cd5 = compileCircuitKnowledgeProblem({ tenantId: "tenant:test", branchId: interfaceState.branchId, requirementsPackage: upstream.requirementsPackage, architectureState: upstream.architectureState, powerState: upstream.powerState, interfaceState, upstreamSignoff: cd5Signoff, pcbFoundationSignoff: pcbSignoff, capabilityProfile: EMBEDDED_CIRCUIT_KNOWLEDGE_PROFILE_V1, componentKnowledgeSnapshotRevision: "atomic:test", recipeLibraryRevision: library.deterministicDigest, policyRuleRegistryRevision: "circuit-policy:test", actor: REVIEWER, createdAt: NOW }); expect(cd5.ok).toBe(true); if (!cd5.ok) return; const knowledge = createCircuitKnowledgeProjectState({ projectId: interfaceState.projectId, branchId: interfaceState.branchId, upstreamSignoff: cd5Signoff, pcbFoundationSignoff: pcbSignoff, problem: cd5.problem, library }); const catalog = catalogWithCategory().catalog; const signoff = createCd6UpstreamCompletionSignoff({ cd1Verdict: "CD-1 COMPLETE", cd2Verdict: "CD-2 COMPLETE", cd3Verdict: "CD-3 COMPLETE", cd4Verdict: "CD-4 COMPLETE", cd5Verdict: "CD-5 COMPLETE", requirementsDigest: upstream.requirementsPackage.deterministicDigest, architectureCandidateDigest: architecture.deterministicDigest, architectureDecisionDigest: upstream.architectureState.selection!.deterministicDigest, powerCandidateDigest: power.deterministicDigest, powerDecisionDigest: upstream.powerState.selection!.deterministicDigest, interfaceCandidateDigest: selectedInterface.deterministicDigest, interfaceDecisionDigest: interfaceDecision.deterministicDigest, circuitKnowledgeProblemDigest: knowledge.problem.deterministicDigest, circuitKnowledgeDecisionDigest: "missing-decision", circuitKnowledgeStateDigest: knowledge.deterministicDigest, approver: REVIEWER, approvedAt: NOW }); const result = compileComponentSelectionProblem({ tenantId: "tenant:test", branchId: interfaceState.branchId, requirementsPackage: upstream.requirementsPackage, architectureState: upstream.architectureState, powerState: upstream.powerState, interfaceState, circuitKnowledgeState: knowledge, upstreamSignoff: signoff, capabilityProfile: EMBEDDED_COMPONENT_SELECTION_PROFILE_V1, projectPolicyRevision: "project-policy:test", catalogSnapshotRevision: catalog.deterministicDigest, sourcingPolicyRevision: "sourcing-policy:test", mandates: [], operatingModeVariantIds: ["default"], actor: REVIEWER, createdAt: NOW }); expect(result).toMatchObject({ ok: false, verdict: "BLOCKED BY CD-5" });
  });
  it("uses four-valued logic without treating unknown as pass", () => {
    expect(andFour(["pass", "unknown"])).toBe("unknown");
    expect(orFour(["fail", "unknown"])).toBe("unknown");
    expect(aggregateHardEvidence(["pass", "stale"])).toBe("stale");
  });

  it("resolves identity only within an exact manufacturer namespace", () => {
    const { portable } = catalogWithCategory();
    expect(resolveExactIdentity({ manufacturerId: "manufacturer_fixture", mpn: "FX-100-QFN", snapshots: [portable], now: NOW }).state).toBe("exact");
    expect(resolveExactIdentity({ manufacturerId: "manufacturer_other", mpn: "FX-100-QFN", snapshots: [portable], now: NOW }).state).toBe("unresolved");
    expect(resolveExactIdentity({ manufacturerId: "manufacturer_fixture", mpn: "FX-100", snapshots: [portable], now: NOW }).state).toBe("incomplete");
  });

  it("queries one immutable catalog deterministically and requires evidence-backed category", () => {
    const { catalog, portable } = catalogWithCategory();
    const query = createCatalogQuery({ catalogSnapshotId: catalog.catalogSnapshotId, roleRequirementId: "role:r1", categories: ["resistor"], exactAtomicRevisionIds: [], manufacturerIds: [], predicates: [], requiredCadProfile: "pcb_assignable", pageSize: 10 });
    expect(queryEngineeringCatalog(catalog, query).atomicRevisionIds).toEqual([portable.atomicRevision.id]);
    const withoutCategory = structuredClone(catalog);
    withoutCategory.portableSnapshots[0].claims = withoutCategory.portableSnapshots[0].claims.filter((claim) => claim.property !== "category");
    expect(queryEngineeringCatalog(withoutCategory, query).atomicRevisionIds).toEqual([]);
  });

  it("passes an exact published part only with CAD and CD-3/CD-4/CD-5 reconciliation", () => {
    const evaluation = exactEvaluation(role());
    expect(evaluation.feasibilityState).toBe("feasible_pre_cd7");
    expect(evaluation.cadBundleCertificate?.packageCompatibilityCertificateId).toBeTruthy();
    expect(evaluation.gateResults.filter((gate) => EMBEDDED_COMPONENT_SELECTION_PROFILE_V1.requiredGateIds.includes(gate.gateId)).every((gate) => gate.state === "pass" || gate.state === "not_applicable")).toBe(true);
  });

  it("does not use absolute maximum data to prove an operating interval", () => {
    const data = catalogWithCategory([VOLTAGE_ABS_MAX]);
    const voltage = predicate({
      predicateId: "pred:supply",
      sourceIds: ["requirement:supply"],
      strength: "hard",
      applicabilityConditions: ["temperature=operating range"],
      predicate: { kind: "interval", property: "supply_voltage", required: { min: { dimension: "voltage", value: "3.0", unit: "V" }, max: { dimension: "voltage", value: "3.3", unit: "V" }, minInclusive: true, maxInclusive: true }, acceptableLimitSemantics: ["recommended_operating", "guaranteed"] },
      evidenceRule: "manufacturer operating envelope",
      unknownBehavior: "block",
      failureDiagnosticTemplate: "Operating range required",
      evaluatorId: "interval",
    });
    const evaluation = exactEvaluation(role("role:r1", [voltage]), data);
    expect(evaluation.feasibilityState).toBe("blocking_unknown");
    expect(evaluation.gateResults.find((gate) => gate.predicateId === voltage.predicateId)?.diagnostic).toContain("absolute-maximum");
  });

  it("normalizes frozen sourcing observations with MOQ, multiples, packs, and freshness", () => {
    const quantity = { scenarioId: "prototype", buildQuantity: 11, attritionBasisPoints: 1000, variantIds: ["variant:default"] };
    const snapshot = createSupplierSourcingSnapshot({ providerId: "fixture", adapterRevision: "1", region: "US", currency: "USD", requestedQuantityProfile: [quantity], observedAt: NOW, freshnessPolicyRevision: "freshness:1", requestDigest: "request:1", responseRecordIds: ["response:1"], errorPartialState: "complete", termsLicenseMetadata: { retention: "project", redistribution: "none", accountPricing: false } });
    const offer = createSupplierOfferObservation({ snapshotId: snapshot.snapshotId, supplierId: "authorized:test", supplierSku: "SKU-1", linkedExactManufacturerPartId: "exact_fixture", packagingForm: "cut_tape", moq: 10, orderMultiple: 5, stockQuantity: 100, stockKind: "distributor", leadTimeDays: 2, factoryAvailability: null, priceBreaks: [{ quantity: 1, unitPriceMinor: "25", currency: "USD", unitBasis: "pack", packQuantity: 5 }], lifecycleComplianceClaims: [], authorizedDistributionState: "authorized", sourceRecordIdOrUrl: "fixture://offer", observationState: "fresh" });
    const cost = normalizeProcurementCost({ observation: offer, snapshot, quantityProfile: quantity, now: NOW, maximumPriceAgeDays: 7 });
    expect(cost.buyUnits).toBe(15);
    expect(cost.extendedPriceMinor).toBe("75");
    expect(normalizeProcurementCost({ observation: offer, snapshot, quantityProfile: quantity, now: "2026-08-18T12:00:00.000Z", maximumPriceAgeDays: 7 }).state).toBe("stale");
  });

  it("solves the BOM jointly and reports a global compatibility conflict", () => {
    const data = catalogWithCategory();
    const r1 = role("role:r1"); const r2 = role("role:r2");
    const e1 = exactEvaluation(r1, data); const e2base = exactEvaluation(r2, data); const e2 = { ...e2base, evaluationId: "evaluation:r2" };
    const p = problem([r1, r2], data.catalog.deterministicDigest);
    const model = createBomConstraintModel({ candidatePartDomainsByRole: {}, roleCardinalityConstraints: [], sharedRoleConstraints: [], compatibilityConstraints: [{ leftEvaluationId: e1.evaluationId, rightEvaluationId: e2.evaluationId, allowed: false, reason: "shared rail mode conflict" }], variantPopulationConstraints: [], costAreaPowerBudgetConstraints: [], vendorLifecycleSourcingConstraints: [], commonalityDiversityConstraints: [], alternativeCoverageConstraints: [], downstreamFeedbackConstraints: [], objectiveDefinitions: [], solverPolicyRevision: "solver-policy:1" });
    const solved = solveJointBom({ problem: p, model, evaluations: [e1, e2], sourcingObservations: [], normalizedCosts: [], sourcingSnapshotIds: [], capabilityProfile: EMBEDDED_COMPONENT_SELECTION_PROFILE_V1, actor: REVIEWER, createdAt: NOW, seed: 7 });
    expect(solved.state).toBe("infeasible");
    expect(solved.unsatCore[0].constraintId).toBe("global-combination");
    expect(exhaustiveJointAssignmentOracle([r1.roleRequirementId, r2.roleRequirementId], [e1, e2], model)).toEqual([]);
  });

  it("never offsets an unknown hard cost budget with a soft objective", () => {
    const data = catalogWithCategory(); const r1 = role(); const evaluation = exactEvaluation(r1, data); const p = problem([r1], data.catalog.deterministicDigest);
    const model = createBomConstraintModel({ candidatePartDomainsByRole: {}, roleCardinalityConstraints: [], sharedRoleConstraints: [], compatibilityConstraints: [], variantPopulationConstraints: [], costAreaPowerBudgetConstraints: [{ metricId: "observed_cost_minor", maximum: 100, hard: true }], vendorLifecycleSourcingConstraints: [], commonalityDiversityConstraints: [], alternativeCoverageConstraints: [], downstreamFeedbackConstraints: [], objectiveDefinitions: [{ metricId: "unique_line_count", direction: "minimize" }], solverPolicyRevision: "solver-policy:1" });
    const solved = solveJointBom({ problem: p, model, evaluations: [evaluation], sourcingObservations: [], normalizedCosts: [], sourcingSnapshotIds: [], capabilityProfile: EMBEDDED_COMPONENT_SELECTION_PROFILE_V1, actor: REVIEWER, createdAt: NOW, seed: 1 });
    expect(solved.state).toBe("infeasible");
  });

  it("groups only exact atomic assignments and labels BOM output preliminary", () => {
    const data = catalogWithCategory(); const r1 = role(); const evaluation = exactEvaluation(r1, data); const p = problem([r1], data.catalog.deterministicDigest);
    const model = createBomConstraintModel({ candidatePartDomainsByRole: {}, roleCardinalityConstraints: [], sharedRoleConstraints: [], compatibilityConstraints: [], variantPopulationConstraints: [], costAreaPowerBudgetConstraints: [], vendorLifecycleSourcingConstraints: [], commonalityDiversityConstraints: [], alternativeCoverageConstraints: [], downstreamFeedbackConstraints: [], objectiveDefinitions: [], solverPolicyRevision: "solver-policy:1" });
    const candidate = solveJointBom({ problem: p, model, evaluations: [evaluation], sourcingObservations: [], normalizedCosts: [], sourcingSnapshotIds: [], capabilityProfile: EMBEDDED_COMPONENT_SELECTION_PROFILE_V1, actor: REVIEWER, createdAt: NOW, seed: 1 }).candidates[0];
    const lines = materializePreliminaryBom({ assignments: candidate.roleAssignments, evaluations: [evaluation], costs: [] });
    expect(lines).toHaveLength(1);
    expect(lines[0].exactManufacturerPartId).toBe("exact_fixture");
    expect(preliminaryBomExport({ candidateId: candidate.candidateId, problemDigest: p.deterministicDigest, lines, sourcingSnapshotIds: [], variantIds: ["variant:default"] }).status).toBe("NOT_RELEASED_FOR_PURCHASING_OR_PRODUCTION");
  });

  it("independently evaluates alternatives and never enables automatic substitution", () => {
    const primary = exactEvaluation(role());
    const incomplete = { ...primary, evaluationId: "evaluation:alternative", atomicPartRevisionId: "atomic:alternative", exactManufacturerPartId: "exact:alternative", feasibilityState: "blocking_unknown" as const, unresolvedUnknownIds: ["unknown:test"] };
    const plan = createComponentAlternativePlan({ primary, alternative: incomplete, requestedClass: "approved_substitute", evidenceRefs: [], impacts: { schematic: [], pcb: [], firmware: [], calculation: [], recipe: [], sourcing: [], qualificationCompliance: [] } });
    expect(plan.alternativeClass).toBe("search_alternative");
    expect(plan.automaticSubstitutionAllowed).toBe(false);
  });

  it("detects fixed-point oscillation rather than accepting unstable selection", () => {
    const result = runSelectionFixedPoint([], (state) => ({ roleRequirements: [], dependencyKeys: state.dependencyKeys.length ? [] : ["toggle"], blockers: [] }), 5);
    expect(result.state).toBe("oscillation");
  });

  it("requires a human reviewer to approve a candidate", () => {
    const data = catalogWithCategory(); const r1 = role(); const evaluation = exactEvaluation(r1, data); const p = problem([r1], data.catalog.deterministicDigest);
    const model = createBomConstraintModel({ candidatePartDomainsByRole: {}, roleCardinalityConstraints: [], sharedRoleConstraints: [], compatibilityConstraints: [], variantPopulationConstraints: [], costAreaPowerBudgetConstraints: [], vendorLifecycleSourcingConstraints: [], commonalityDiversityConstraints: [], alternativeCoverageConstraints: [], downstreamFeedbackConstraints: [], objectiveDefinitions: [], solverPolicyRevision: "solver-policy:1" });
    const candidate = solveJointBom({ problem: p, model, evaluations: [evaluation], sourcingObservations: [], normalizedCosts: [], sourcingSnapshotIds: [], capabilityProfile: EMBEDDED_COMPONENT_SELECTION_PROFILE_V1, actor: REVIEWER, createdAt: NOW, seed: 1 }).candidates[0];
    const decision = createComponentSelectionDecision({ problemDigest: p.deterministicDigest, candidates: [candidate], createdAt: NOW });
    expect(() => approveComponentSelectionDecision(decision, candidate, AI)).toThrow("CD6_SELECTION_APPROVAL_UNAUTHORIZED");
    expect(approveComponentSelectionDecision(decision, candidate, REVIEWER).approvalState).toBe("approved");
  });

  it("rejects AI transactions atomically and preserves idempotency", () => {
    const data = catalogWithCategory(); const r1 = role(); const evaluation = exactEvaluation(r1, data); const p = problem([r1], data.catalog.deterministicDigest);
    const signoffBase: Omit<Cd6UpstreamCompletionSignoff, "deterministicDigest"> = { schemaVersion: "sirkit.cd6-upstream-signoff.v1", cd1Verdict: "CD-1 COMPLETE", cd2Verdict: "CD-2 COMPLETE", cd3Verdict: "CD-3 COMPLETE", cd4Verdict: "CD-4 COMPLETE", cd5Verdict: "CD-5 COMPLETE", requirementsDigest: "requirements:digest", architectureCandidateDigest: "architecture:digest", architectureDecisionDigest: "architecture:decision", powerCandidateDigest: "power:digest", powerDecisionDigest: "power:decision", interfaceCandidateDigest: "interface:digest", interfaceDecisionDigest: "interface:decision", circuitKnowledgeProblemDigest: "recipe:problem", circuitKnowledgeDecisionDigest: "recipe:decision", circuitKnowledgeStateDigest: "recipe:state", approver: REVIEWER, approvedAt: NOW };
    const signoff = { ...signoffBase, deterministicDigest: selectionDigest(signoffBase) };
    p.upstreamSignoffDigest = signoff.deterministicDigest; p.deterministicDigest = selectionDigest({ ...p, deterministicDigest: undefined });
    const state = createComponentSelectionProjectState({ projectId: p.projectId, branchId: p.branchId, upstreamSignoff: signoff, problem: p, catalogSnapshot: data.catalog });
    expect(validateComponentSelectionProjectState(state)).toEqual([]);
    const aiTx = createComponentSelectionTransaction({ projectId: p.projectId, branchId: p.branchId, actor: AI, reason: "AI may propose but cannot commit", baseStateDigest: state.deterministicDigest, idempotencyKey: "ai-denied", operations: [{ operationId: "op:1", kind: "add_evaluation", evaluation }], createdAt: NOW });
    expect(applyComponentSelectionTransaction(state, aiTx).record.state).toBe("rejected");
    const humanTx = createComponentSelectionTransaction({ projectId: p.projectId, branchId: p.branchId, actor: REVIEWER, reason: "Record reviewed evaluation", baseStateDigest: state.deterministicDigest, idempotencyKey: "human-accepted", operations: [{ operationId: "op:2", kind: "add_evaluation", evaluation }], createdAt: NOW });
    const first = applyComponentSelectionTransaction(state, humanTx);
    const replay = applyComponentSelectionTransaction(first.state, humanTx);
    expect(first.record.state).toBe("accepted");
    expect(validateComponentSelectionProjectState(first.state)).toEqual([]);
    expect(replay.record.integrityDigest).toBe(first.record.integrityDigest);
    expect(replay.state.evaluations).toHaveLength(1);
  });
});
