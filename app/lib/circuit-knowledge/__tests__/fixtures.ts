import type { EngineeringActor } from "../../engineering/types";
import { canonicalTopologyGraphDigest } from "../graph";
import { createCircuitRecipeLibrary } from "../library";
import { circuitDigest } from "../stable";
import { createRecipeSourceBundle } from "../source";
import type { CircuitRecipeDefinition, CircuitRecipeLibrary, RecipeReviewRecord, RecipeSourceBundle } from "../types";
import { CIRCUIT_RECIPE_SCHEMA_VERSION } from "../types";

export const CREATED_AT = "2026-07-17T12:00:00.000Z";
export const ACTOR: EngineeringActor = { actorId: "engineer:test", actorKind: "human", sessionId: "session:test", role: "reviewer" };
export const EVIDENCE_ID = "evidence:open-drain";

export function sourceBundle(): RecipeSourceBundle {
  const excerpt = "The external bias role is required under the documented operating condition.";
  return createRecipeSourceBundle({
    sources: [{ id: "source:manufacturer", sourceClass: "manufacturer_application_note", name: "Synthetic reviewed application note fixture", canonicalUri: "https://example.invalid/reviewed-fixture", officialDomains: ["example.invalid"], licenseId: "license:fixture" }],
    sourceRecords: [{ id: "source-record:v1", sourceId: "source:manufacturer", revision: "1", contentHash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", retrievedAt: CREATED_AT, locator: "fixture/source.txt", mediaType: "text/plain", confidential: false }],
    evidence: [{ id: EVIDENCE_ID, sourceRecordId: "source-record:v1", locator: "section 1", extractionMethod: "manual", extractorVersion: "fixture/1", extractedAt: CREATED_AT, reviewerId: ACTOR.actorId, reviewedAt: CREATED_AT, confidence: 1 }],
    licenses: [{ id: "license:fixture", spdxId: "CC0-1.0", name: "Synthetic test fixture", rawRedistribution: "redistributable", derivedRedistribution: "redistributable", exportDisposition: "redistributable", reviewedAt: CREATED_AT, reviewedBy: ACTOR.actorId }],
    atomicSnapshots: [], sourceLocations: [{ evidenceId: EVIDENCE_ID, sourceRecordId: "source-record:v1", section: "1", excerpt, excerptHash: circuitDigest(excerpt) }], immutableSourceHashes: ["0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"], documentRevisionDates: [CREATED_AT], sourceAuthority: [{ evidenceId: EVIDENCE_ID, claimKinds: ["topology", "applicability", "role"], state: "authoritative" }], conflicts: [], freshnessPolicy: "Review when source revision changes.", retentionRedistributionPolicy: "Synthetic fixture is redistributable.", reviewerAccessRequirements: ["source record"],
  });
}

function reviews(revisionId: string): RecipeReviewRecord[] {
  return (["source", "topology", "equation_domain", "constraint_verification", "license", "oracle_corpus"] as const).map((reviewKind) => {
    const base: Omit<RecipeReviewRecord, "deterministicDigest"> = { reviewRecordId: `review:${reviewKind}`, recipeRevisionId: revisionId, reviewKind, reviewer: { ...ACTOR, qualification: `fixture-${reviewKind}`, independent: true }, reviewedElementIds: [revisionId], sourceVerificationResults: ["fixture-source-checked"], compilerValidationResults: ["fixture-compiler-checked"], oracleBenchmarkResults: ["fixture-oracle-checked"], issueIds: [], resolutionIds: [], decision: "approve", scopeLimitations: ["Synthetic unit-test fixture only"], approvalAuditRef: `audit:${reviewKind}`, createdAt: CREATED_AT };
    return { ...base, deterministicDigest: circuitDigest(base) };
  });
}

export function recipe(lifecycleState: CircuitRecipeDefinition["lifecycleState"] = "published"): CircuitRecipeDefinition {
  const revisionId = "recipe-revision:open-drain:1";
  const topologyGraph: CircuitRecipeDefinition["topologyGraph"] = { graphId: "graph:open-drain", roleNodeIds: ["role:pull"], portNodeIds: ["port:signal", "port:rail"], internalSemanticNetRoleIds: [], connectionRules: [
    { connectionRuleId: "connect:signal", endpointRoleRefs: ["terminal:signal", "port:signal"], connectionKind: "required", cardinality: { kind: "exactly", count: 1 }, directionCompatibility: "passive_to_bidirectional", railReturnDomainCompatibility: "same_domain", netRoleSemantics: "biased_open_drain_signal", allowedSharingPolicy: "shareable", evidenceRefs: [EVIDENCE_ID], downstreamCheckIds: ["check:signal"] },
    { connectionRuleId: "connect:rail", endpointRoleRefs: ["terminal:rail", "port:rail"], connectionKind: "required", cardinality: { kind: "exactly", count: 1 }, directionCompatibility: "passive_to_power", railReturnDomainCompatibility: "same_domain", netRoleSemantics: "bias_rail", allowedSharingPolicy: "shareable", evidenceRefs: [EVIDENCE_ID], downstreamCheckIds: ["check:rail"] },
  ], requiredRelationshipIds: ["connect:signal", "connect:rail"], forbiddenRelationshipIds: [], conditionalSubgraphIds: [], compositionBoundaryIds: ["port:signal", "port:rail"], canonicalGraphDigest: "" };
  topologyGraph.canonicalGraphDigest = canonicalTopologyGraphDigest(topologyGraph);
  const evidenceBundleBase = { evidenceBundleId: "recipe-evidence:open-drain", sourceBundleId: sourceBundle().sourceBundleId, extractedClaimIds: [], derivedRuleIds: ["connect:signal", "connect:rail"], conflictIds: [], freshnessPolicy: "pinned source revision", reviewerAccessRequirements: ["source record"] };
  const base: Omit<CircuitRecipeDefinition, "deterministicDigest"> = {
    schemaVersion: CIRCUIT_RECIPE_SCHEMA_VERSION, recipeId: "recipe:open-drain", revisionId, semanticVersion: "1.0.0", lineageParentIds: [], semanticRole: "open_drain_bias", semanticDomain: "digital_support", abstractionLevel: "generic_class", lifecycleState,
    applicability: { applicabilityRuleId: "applies:open-drain", requiredArchitectureRoleKinds: ["open_drain_bus"], requiredInputOutputEnvelopes: [], supportedTopologyClasses: ["shared_bus"], supportedModesStates: ["active"], requiredInterfaceContracts: [], requiredPowerGroundIsolationContracts: [], requiredComponentCapabilities: [], allowedPartFamilyIds: [], allowedAtomicPartRevisionIds: [], allowedPackageRevisionIds: [], excludedPartOrPackageIds: [], requiredEvidenceStates: ["pass"], requiredModelCapabilities: [], capabilityProfilePredicates: ["digital_support"], forbiddenConditions: ["push_pull_only"], sourceEvidenceRefs: [EVIDENCE_ID] },
    ports: [
      { portId: "port:signal", semanticRole: "open_drain_signal", portKind: "digital_signal", direction: "bidirectional", cardinality: { kind: "exactly", count: 1 }, electricalDomainContract: "logic_domain", modeStateConditions: ["active"], safeFaultBehavior: "high_impedance", requiredExternalContractKinds: ["open_drain"], composabilityPolicy: "required_shared", aliases: [], evidenceRefs: [EVIDENCE_ID] },
      { portId: "port:rail", semanticRole: "bias_rail", portKind: "rail", direction: "passive", cardinality: { kind: "exactly", count: 1 }, electricalDomainContract: "logic_domain", modeStateConditions: ["active"], safeFaultBehavior: "no_back_power", requiredExternalContractKinds: ["power_domain"], composabilityPolicy: "required_shared", aliases: [], evidenceRefs: [EVIDENCE_ID] },
    ],
    componentRoleSlots: [{ roleSlotId: "role:pull", semanticRole: "bias_element", componentClassRequirements: ["passive_bias"], exactPartBindingPolicy: "required_at_cd6", cardinality: { kind: "exactly", count: 1 }, populationPolicy: "required", modeVariantConditions: ["active"], requiredTerminalRoleIds: ["terminal:signal", "terminal:rail"], requiredCapabilityFacts: ["resistive_bias"], requiredCADModelFacts: ["symbol", "footprint"], electricalEnvelopeRequirements: [], packageEnvironmentRequirements: [], applicationRecipeCompatibility: ["shareable_across_recipe_boundary"], selectionObjectiveHints: [], alternativePolicy: "equivalent_only", evidenceRefs: [EVIDENCE_ID] }],
    terminalRoleContracts: [
      { terminalRoleId: "terminal:signal", componentRoleSlotId: "role:pull", semanticFunction: "signal_side", directionElectricalType: "passive", pinGroupCardinality: { kind: "exactly", count: 1 }, acceptedPinFunctionClasses: ["passive"], voltageRailReturnDomainContract: "logic_domain", modeStateConditions: ["active"], requiredConnectionRoleIds: ["port:signal"], forbiddenConnectionRoleIds: ["port:rail"], exactPinMappingRequired: true, evidenceRefs: [EVIDENCE_ID] },
      { terminalRoleId: "terminal:rail", componentRoleSlotId: "role:pull", semanticFunction: "rail_side", directionElectricalType: "passive", pinGroupCardinality: { kind: "exactly", count: 1 }, acceptedPinFunctionClasses: ["passive"], voltageRailReturnDomainContract: "logic_domain", modeStateConditions: ["active"], requiredConnectionRoleIds: ["port:rail"], forbiddenConnectionRoleIds: ["port:signal"], exactPinMappingRequired: true, evidenceRefs: [EVIDENCE_ID] },
    ], topologyGraph, decisionPoints: [], parameters: [], equationModels: [], variantOverlays: [], constraintTemplates: [], verificationPlan: { verificationPlanId: "verify:open-drain", structuralCheckTemplates: ["required connections"], applicationRuleTemplates: [], calculationObligationIds: ["CD-7:bias-value"], simulationContractIds: [], firmwareTestObligationIds: [], PCBVerificationObligationIds: [], externalReviewObligationIds: [], coverageMatrix: [{ claimOrElementId: "connect:signal", provingStage: "CD-9", state: "not_evaluated", limitation: "Contract only" }], unsupportedCheckIds: [] }, simulationContracts: [], firmwareTestObligationIds: [], evidenceBundle: { ...evidenceBundleBase, deterministicDigest: circuitDigest(evidenceBundleBase) }, reviewRecords: reviews(revisionId), knownLimitations: ["No exact part, value, pin, net, or placement is selected by CD-5."], securitySafetyClass: "ordinary", createdBy: ACTOR, createdAt: CREATED_AT, ...(lifecycleState === "published" ? { publishedAt: CREATED_AT } : {}),
  };
  return { ...base, deterministicDigest: circuitDigest({ ...base, deterministicDigest: undefined }) };
}

export function emptyLibrary(): CircuitRecipeLibrary { return createCircuitRecipeLibrary({ createdAt: CREATED_AT }); }
