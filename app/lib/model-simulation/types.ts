import type { EngineeringActor } from "../engineering/types";
import type { CircuitReadinessReport, CircuitVerificationProjectState } from "../circuit-verification/types";
import type { SchematicProjectState, SchematicSemanticGraph, VariantGraphProjection } from "../schematic-compiler/types";

export const MODEL_SIMULATION_SCHEMA = "sirkit.model-simulation.v1" as const;
export const MODEL_SIMULATION_PROBLEM_SCHEMA = "sirkit.simulation-verification-problem.v1" as const;
export const MODEL_SIMULATION_POLICY = "model-simulation/1.0.0" as const;

export type SimulationAnalysisKind = "operating_point" | "dc_sweep" | "transient" | "ac" | "noise" | "distortion" | "discrete_corner" | "monte_carlo" | "worst_case";
export type ModelKind = "manufacturer_spice" | "validated_third_party" | "validated_internal" | "behavioral" | "encrypted" | "idealized_test_double" | "black_box" | "digital_cosim" | "primitive";
export type ModelApplicabilityState = "applicable_validated" | "applicable_with_explicit_limitations" | "idealized_test_double_for_surrounding_network_only" | "black_box_narrowly_validated" | "inapplicable_exact_part_or_package" | "inapplicable_operating_domain" | "missing_required_behavior" | "provider_incompatible" | "license_unavailable" | "unvalidated" | "revoked";
export type SimulationAssertionState = "pass" | "fail" | "indeterminate_numeric" | "unknown" | "unsupported" | "not_evaluated" | "stale" | "invalid_testbench" | "invalid_model" | "nonconverged" | "not_applicable";
export type SimulationReadinessState = "simulation_verified_for_supported_scope" | "verified_with_explicit_limitations" | "blocked_assertion_failure" | "blocked_model_or_coverage_gap" | "blocked_nonconvergence" | "blocked_provider_discrepancy" | "external_review_required" | "invalidated";
export type SimulationLifecycle = "draft_problem" | "blocked_prerequisite" | "blocked_model_or_testbench_coverage" | "netlist_compilation_failed" | "campaign_queued" | "campaign_running" | "campaign_partially_complete" | "blocked_nonconvergence" | "blocked_assertion_failure" | "blocked_provider_discrepancy" | "simulation_verified_for_supported_scope" | "verified_with_explicit_limitations" | "invalidated" | "superseded" | "archived";
export type ProcessState = "queued" | "started" | "exited_zero" | "exited_nonzero" | "timeout" | "cancelled" | "resource_killed" | "license_denied" | "executable_missing" | "malformed_output" | "provider_error";
export type ConvergenceState = "credible_converged" | "converged_with_warnings" | "dc_nonconverged" | "transient_nonconverged" | "timestep_failure" | "singular_topology" | "model_error" | "unsupported_feature" | "not_run" | "unknown";

export interface Cd10Diagnostic { diagnosticId: string; code: string; severity: "information" | "warning" | "error" | "blocking"; message: string; objectRefs: string[]; sourceRefs: string[]; ownerStage: "CD-1" | "CD-2" | "CD-3" | "CD-4" | "CD-5" | "CD-6" | "CD-7" | "CD-8" | "CD-9" | "CD-10" | "external"; minimumSafeAction: string }

export interface ModelSimulationCapabilityProfile {
  profileId: "low-voltage-embedded-model-simulation-v1";
  version: "1.0.0";
  supportedAnalyses: SimulationAnalysisKind[];
  diagnosticOnlyAnalyses: SimulationAnalysisKind[];
  unsupportedDomains: string[];
  limits: { maximumComponents: number; maximumModels: number; maximumTerminals: number; maximumTestbenches: number; maximumRequiredInstances: number; maximumRuns: number; maximumWaveformSignals: number; maximumWaveformPointsPerSignal: number; maximumArtifactBytes: number; maximumMonteCarloSamples: number; maximumRunSeconds: number };
  policies: { modelIdentity: string; terminalMapping: string; applicability: string; provider: string; lowering: string; numerical: string; convergence: string; measurement: string; assertion: string; cache: string; readiness: string; sandbox: string };
  approvalState: "approved";
  deterministicDigest: string;
}

export interface SimulatorProviderDefinition {
  providerId: string;
  revision: number;
  semanticName: string;
  simulatorKind: "ngspice" | "xyce" | "analytical_reference" | "project_extension";
  supportedAnalyses: SimulationAnalysisKind[];
  supportedModelDialects: string[];
  supportedFeaturesAndLimits: string[];
  netlistAdapterRevisionId: string;
  waveformAdapterRevisionId: string;
  measurementSemanticsRevisionId: string;
  executionBackendKind: "local_subprocess_diagnostic" | "sandboxed_process" | "container" | "analytical_in_process";
  licenseAndAccessRequirements: string[];
  validationCorpusRefs: string[];
  knownDifferencesAndLimitations: string[];
  reviewState: "unreviewed" | "diagnostic_only" | "validated" | "revoked";
  lifecycleState: "active" | "deprecated" | "revoked";
  authoritativeEligible: boolean;
  reviewer?: EngineeringActor;
  deterministicDigest: string;
}

export interface SimulationExecutionEnvironment {
  environmentId: string;
  providerRevisionId: string;
  executableOrImageDigest?: string;
  simulatorVersion: string;
  operatingSystemAndArchitecture: string;
  dependencyVersions: Array<{ name: string; version: string; digest?: string }>;
  localeAndTimeZone: string;
  floatingPointAndThreadSettings: string[];
  environmentVariablesAllowlist: string[];
  resourceLimits: { timeoutMs: number; memoryMiB: number; outputBytes: number; processCount: number; waveformPoints: number };
  networkPolicy: "deny" | "allowlisted";
  sandboxPolicyRevisionId: string;
  validationState: "unvalidated" | "diagnostic_only" | "validated" | "invalid";
  deterministicDigest: string;
}

export interface ModelLicenseMetadata { licenseId: string; execution: "allowed" | "restricted" | "forbidden" | "unknown"; caching: "allowed" | "restricted" | "forbidden" | "unknown"; teamReview: "allowed" | "restricted" | "forbidden" | "unknown"; export: "allowed" | "restricted" | "forbidden" | "unknown"; retention: "allowed" | "restricted" | "forbidden" | "unknown"; evidenceRefs: string[] }
export interface ModelTerminalDefinition { terminalId: string; ordinal: number; semanticName: string; electricalRole: string; referenceOrGlobalNode?: string; required: boolean }
export interface ModelParameterDefinition { parameterId: string; semanticName: string; dimension: string; required: boolean; defaultValue?: string; defaultAuthority: "model" | "datasheet" | "none" }

export interface SimulationModelAsset {
  modelAssetId: string;
  revision: number;
  semanticName: string;
  modelKind: ModelKind;
  dialectAndProviderCompatibility: Array<{ dialect: string; providerRevisionIds: string[]; state: "supported" | "unsupported" | "unknown" }>;
  exactFamilyPartPackageScopes: Array<{ exactPartRevisionId?: string; familyId?: string; packageRevisionId?: string; scope: "exact" | "family" | "generic" }>;
  sourceAndProvenanceRefs: string[];
  immutableContentDigest: string;
  contentAddressedStorageRef: string;
  includeArtifactDigests: string[];
  licenseMetadata: ModelLicenseMetadata;
  encryptionOrOpacityState: "inspectable" | "encrypted" | "opaque" | "black_box";
  terminalDefinitions: ModelTerminalDefinition[];
  parameterDefinitions: ModelParameterDefinition[];
  modeledBehaviorCapabilities: string[];
  omittedOrIdealizedBehaviors: string[];
  operatingDomain: Array<{ dimension: string; minimum?: number; maximum?: number; unit: string }>;
  requiredExternalElements: string[];
  validationAndOracleRefs: string[];
  knownLimitations: string[];
  reviewState: "quarantined" | "draft" | "reviewed" | "approved" | "revoked";
  lifecycleState: "active" | "deprecated" | "revoked";
  reviewer?: EngineeringActor;
  deterministicDigest: string;
}

export interface ModelRegistrySnapshot { registryId: string; revision: number; assets: SimulationModelAsset[]; lifecycleState: "draft" | "approved" | "invalidated"; approvedBy?: EngineeringActor; approvedAt?: string; deterministicDigest: string }

export interface ModelTerminalMappingCertificate {
  certificateId: string;
  modelAssetRevisionId: string;
  exactAtomicPartRevisionId: string;
  schematicPinToModelTerminalMappings: Array<{ pinInstanceId: string; atomicLogicalPinId: string; modelTerminalId: string }>;
  groundReferenceAndGlobalNodeMappings: Array<{ modelTerminalId: string; semanticNetId?: string; policy: "explicit_net" | "testbench_reference" | "internal_model_node" }>;
  duplicateHiddenThermalPinTreatment: Array<{ pinInstanceId: string; treatment: string; evidenceRefs: string[] }>;
  unusedModelTerminalTreatment: Array<{ modelTerminalId: string; treatment: "internal" | "explicit_unconnected" | "external_element_required"; evidenceRefs: string[] }>;
  parameterMappingRefs: string[];
  evidenceAndValidationRefs: string[];
  certificateState: "draft" | "approved" | "invalid" | "revoked";
  reviewerApproval?: { reviewer: EngineeringActor; approvedAt: string; rationale: string };
  deterministicDigest: string;
}

export interface SimulationModelBinding {
  bindingId: string;
  componentInstanceId: string;
  exactAtomicPartRevisionId: string;
  exactPackageRevisionId: string;
  modelAssetRevisionId: string;
  terminalMappingCertificateId: string;
  parameterBindings: Array<{ parameterId: string; typedValue: string; unit: string; sourceRef: string }>;
  selectedValueAndPropertyRefs: string[];
  variantScenarioApplicability: string[];
  claimScope: string[];
  limitationAndDownstreamObligationIds: string[];
  bindingState: "draft" | "approved" | "invalid" | "revoked";
  deterministicDigest: string;
}

export interface ModelApplicabilityResult {
  applicabilityResultId: string;
  modelAssetRevisionId: string;
  exactComponentInstanceId: string;
  exactPartPackageRevisionId: string;
  targetClaimAndAnalysisKinds: string[];
  variantScenarioCornerScope: string[];
  operatingDomainComparison: Array<{ dimension: string; requested?: number; unit: string; state: "inside" | "outside" | "unknown" }>;
  requiredExternalElementResults: Array<{ element: string; state: "present" | "missing" | "unknown" }>;
  providerCompatibilityResult: "pass" | "fail" | "unknown";
  licenseEligibilityResult: "pass" | "fail" | "unknown";
  applicabilityState: ModelApplicabilityState;
  missingOrConflictingInputs: string[];
  evidenceRefs: string[];
  evaluatorVersion: string;
  deterministicDigest: string;
}

export interface SimulationStimulusDefinition { stimulusId: string; semanticRole: string; targetSemanticNetOrPortIds: string[]; sourceKind: "dc" | "ramp" | "pulse" | "pwl" | "sine" | "current_profile" | "switch" | "fault" | "behavioral_contract"; typedWaveformOrSweepDefinition: Record<string, string | number | boolean>; sourceImpedanceAndReference: { impedanceOhms?: number; referenceNetId: string }; timingAndRampParameters: Record<string, string>; variantScenarioApplicability: string[]; provenanceOrAssumptionRefs: string[]; deterministicDigest: string }
export interface SimulationLoadDefinition { loadId: string; semanticRole: string; targetSemanticNetOrPortIds: string[]; loadKind: "resistance" | "capacitance" | "inductance" | "current" | "power" | "behavioral_contract"; typedValueOrEnvelope: Record<string, string | number>; referenceNetId: string; provenanceOrAssumptionRefs: string[]; deterministicDigest: string }
export interface SimulationAnalysisPlan { analysisPlanId: string; analysisKind: SimulationAnalysisKind; operatingPointAndInitializationPolicy: "operating_point" | "cold_start" | "warm_restart" | "saved_state" | "forced_initial_state" | "not_applicable"; timeOrFrequencyOrSweepDomain: Record<string, string | number>; numericalSettings: { reltol?: number; abstol?: number; vntol?: number; maxStep?: string; outputStep?: string; integrationMethod?: "trap" | "gear"; maximumIterations?: number }; outputSavePolicy: { semanticSignalIds: string[]; authoritativeRawRequired: boolean }; expectedBehaviorAndLimitations: string[]; providerFeatureRequirements: string[]; retryPolicyRevisionId: string; deterministicDigest: string }
export type MeasurementKind = "minimum" | "maximum" | "mean" | "rms" | "peak_to_peak" | "integral" | "energy" | "threshold_crossing" | "rise_time" | "fall_time" | "delay" | "pulse_width" | "overshoot" | "undershoot" | "settling_time" | "ripple" | "dc_value" | "gain_db" | "phase_deg" | "bandwidth" | "gain_margin" | "phase_margin" | "integrated_noise" | "thd" | "temporal_order";
export interface SimulationMeasurementDefinition { measurementId: string; semanticName: string; sourceRequirementOrAssertionIds: string[]; inputWaveformOrBranchSelectors: string[]; measurementKind: MeasurementKind; evaluationWindowOrEventDefinition: Record<string, string | number | boolean>; interpolationAndEdgePolicy: { interpolation: "linear" | "none"; crossingDirection?: "rising" | "falling" | "either"; crossingOrdinal?: number; settlingDwellSeconds?: number; reentryPolicy?: "reset" | "fail" }; unitsAndReference: { unit: string; reference?: string }; numericUncertaintyPolicy: { absolute: number; relative: number; requireResolutionStudy: boolean }; invalidDataPolicy: "invalid" | "unsupported"; deterministicDigest: string }
export interface SimulationAssertionDefinition { assertionId: string; semanticName: string; requirementId: string; measurementOrTemporalExpressionRefs: string[]; comparatorAndAllowedDomain: { comparator: "<" | "<=" | ">" | ">=" | "between" | "outside"; lower: number; upper?: number; unit: string }; applicableVariantScenarioCornerScope: string[]; numericDecisionPolicy: { useUncertaintyBand: true; boundaryState: "indeterminate_numeric" }; severityAndReadinessPolicyRef: "blocking" | "error" | "warning" | "characterization"; evidenceAndRationaleRefs: string[]; downstreamValidationRefs: string[]; reviewState: "draft" | "approved" | "revoked"; reviewer?: EngineeringActor; deterministicDigest: string }

export interface SimulationTestbenchDefinition { testbenchId: string; revision: number; semanticName: string; sourceRequirementRecipeObligationIds: string[]; applicableGraphBlockAndVariantScopes: string[]; requiredModelCapabilityIds: string[]; stimulusDefinitions: SimulationStimulusDefinition[]; loadAndExternalEnvironmentDefinitions: SimulationLoadDefinition[]; initialStateDefinitions: Array<{ initialStateId: string; policy: SimulationAnalysisPlan["operatingPointAndInitializationPolicy"]; assignments: Array<{ semanticNetId: string; value: string; sourceRef: string }>; deterministicDigest: string }>; analysisPlans: SimulationAnalysisPlan[]; measurementDefinitions: SimulationMeasurementDefinition[]; assertionDefinitions: SimulationAssertionDefinition[]; cornerCampaignDefinitionIds: string[]; knownLimitations: string[]; evidenceAndValidationRefs: string[]; reviewState: "draft" | "approved" | "revoked"; lifecycleState: "active" | "deprecated" | "revoked"; reviewer?: EngineeringActor; deterministicDigest: string }
export interface TestbenchRegistrySnapshot { registryId: string; revision: number; testbenches: SimulationTestbenchDefinition[]; lifecycleState: "draft" | "approved" | "invalidated"; approvedBy?: EngineeringActor; approvedAt?: string; deterministicDigest: string }

export interface SimulationScenario { scenarioId: string; variantProjectionId: string; variantId: string; operatingModeAndState: string; supplyAndRampAssignments: string[]; loadAndExternalAssignments: string[]; temperatureAssignments: Array<{ temperatureC: number; sourceRef: string }>; componentParameterAssignmentsOrDomains: string[]; initialConditionPolicy: SimulationAnalysisPlan["operatingPointAndInitializationPolicy"]; faultInjectionAssignments: string[]; assumptionRefs: string[]; deterministicDigest: string }
export interface SimulationObligation { obligationId: string; sourceStage: "CD-1" | "CD-3" | "CD-4" | "CD-5" | "CD-7" | "CD-9"; requirementId?: string; claimKind: string; requiredAnalysisKinds: SimulationAnalysisKind[]; requiredVariantIds: string[]; requiredScenarioIds: string[]; requiredAssertionIds: string[]; requiredCrossProviderCount: number; applicabilityState: "required" | "not_applicable" | "unsupported" | "unknown"; evidenceRefs: string[]; deterministicDigest: string }

export interface RequiredSimulationInstance { instanceId: string; obligationId: string; testbenchId: string; testbenchDigest: string; variantId: string; scenarioId: string; cornerOrSampleId: string; analysisPlanId: string; analysisKind: SimulationAnalysisKind; providerRevisionId: string; measurementId: string; assertionId: string; requiredModelBindingIds: string[]; state: "required" | "not_applicable" | "unsupported" | "blocked_missing_input"; reasonCode: string; deterministicDigest: string }
export interface SimulationCoverageDenominator { denominatorId: string; problemDigest: string; graphDigest: string; modelRegistryDigest: string; testbenchRegistryDigest: string; providerPolicyDigest: string; instances: RequiredSimulationInstance[]; obligationCoverage: Array<{ obligationId: string; instanceIds: string[]; state: "covered" | "missing" | "unsupported" | "not_applicable" }>; variantCoverage: Array<{ variantId: string; scenarioIds: string[]; instanceIds: string[]; state: "covered" | "missing" }>; nonVacuous: boolean; diagnostics: Cd10Diagnostic[]; deterministicDigest: string }

export interface SimulationVerificationProblem { schemaVersion: typeof MODEL_SIMULATION_PROBLEM_SCHEMA; problemId: string; tenantId: string; projectId: string; branchId: string; revision: number; schematicCandidateId: string; cd8ProjectDigest: string; semanticGraphRevisionId: string; semanticGraphDigest: string; circuitVerificationProjectDigest: string; circuitVerificationReportId: string; circuitVerificationReportDigest: string; requiredVariantProjectionIds: string[]; upstreamRevisionRefs: Array<{ stage: `CD-${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`; stateDigest: string; decisionDigest: string }>; modelRegistrySnapshotId: string; modelRegistryDigest: string; testbenchRegistrySnapshotId: string; testbenchRegistryDigest: string; simulatorProviderPolicyRevisionId: string; providerPolicyDigest: string; numericalPolicyRevisionId: string; convergencePolicyRevisionId: string; assertionPolicyRevisionId: string; artifactAndCachePolicyRevisionId: string; capabilityProfileRevisionId: string; requiredSimulationObligationIds: string[]; controlledAssumptionIds: string[]; activeWaiverIds: string[]; dependencyDigest: string; lifecycleState: "blocked_prerequisite" | "ready_for_campaign" | "invalidated"; blockingDiagnosticIds: string[]; createdBy: EngineeringActor; createdAt: string; deterministicDigest: string }
export type SimulationProblemResult = { ok: true; problem: SimulationVerificationProblem; graph: SchematicSemanticGraph; projections: VariantGraphProjection[]; cd9Report: CircuitReadinessReport; diagnostics: Cd10Diagnostic[] } | { ok: false; verdict: "BLOCKED BY CD-9" | "BLOCKED"; diagnostics: Cd10Diagnostic[] };

export interface SimulationIrNode { nodeId: string; semanticNetId: string; variantId: string; referenceRole: "explicit_reference" | "ordinary" | "isolated_return"; provenanceRefs: string[]; deterministicDigest: string }
export interface SimulationIrModelInstance { modelInstanceId: string; componentInstanceId: string; modelBindingId: string; modelAssetRevisionId: string; terminals: Array<{ modelTerminalId: string; pinInstanceId: string; nodeId: string }>; parameters: Array<{ parameterId: string; typedValue: string; unit: string }>; deterministicDigest: string }
export interface ControlledTestElement { testElementId: string; kind: "voltage_source" | "current_source" | "resistive_load" | "capacitive_load" | "inductive_load" | "switch" | "probe" | "loop_injection" | "initial_condition" | "fault" | "convergence_aid"; positiveNodeId?: string; negativeNodeId?: string; targetNodeId?: string; typedProperties: Record<string, string | number | boolean>; sourceDefinitionRef: string; designGraphMutation: false; deterministicDigest: string }
export interface SimulationNetlistIR { netlistIrId: string; sourceGraphRevisionId: string; sourceGraphDigest: string; variantProjectionId: string; variantId: string; componentModelInstances: SimulationIrModelInstance[]; stableNodes: SimulationIrNode[]; branchAndReferenceDefinitions: Array<{ branchId: string; referenceNodeId: string; reason: string }>; parameterDefinitions: Array<{ parameterId: string; typedValue: string; unit: string; sourceRef: string }>; hierarchyLoweringMap: Array<{ semanticObjectId: string; hierarchyPath: string[] }>; controlledIdealTestElements: ControlledTestElement[]; excludedUnsupportedRegionIds: string[]; provenanceMap: Array<{ simulatorObjectId: string; semanticObjectIds: string[] }>; semanticDigest: string; deterministicDigest: string }
export interface NetlistLoweringManifest { manifestId: string; netlistIrId: string; netlistIrDigest: string; providerRevisionId: string; adapterRevisionId: string; generatedNetlistArtifactId: string; generatedNetlistDigest: string; componentInstanceMappings: Array<{ componentInstanceId: string; providerElementName: string }>; semanticNetToSimulatorNodeMappings: Array<{ semanticNetId: string; providerNodeName: string }>; modelIncludeAndDigestMappings: Array<{ modelAssetRevisionId: string; sandboxRelativePath: string; contentDigest: string }>; parameterFormattingMappings: Array<{ parameterId: string; rendered: string }>; groundAndReferenceMappings: Array<{ semanticNetId: string; providerNodeName: string; policy: string }>; hierarchyFlatteningMappings: Array<{ semanticObjectId: string; providerPath: string }>; insertedTestElementMappings: Array<{ testElementId: string; providerElementName: string }>; unsupportedOrExcludedMappings: Array<{ semanticObjectId: string; reason: string }>; structuralValidationResults: Array<{ code: string; state: "pass" | "fail" | "unknown"; refs: string[] }>; deterministicDigest: string }

export interface SimulationAttempt { attemptId: string; runId: string; attemptIndex: number; settingsDigest: string; deltaFromPrior: string[]; processState: ProcessState; signoffEligibility: "eligible" | "diagnostic_only" | "ineligible"; stdoutDigest?: string; stderrDigest?: string; artifactRefs: string[]; startedAt: string; completedAt?: string; deterministicDigest: string }
export interface SimulationConvergenceDiagnostic { diagnosticId: string; runId: string; convergenceState: ConvergenceState; solverMethodAndIntegrationMethod: string[]; tolerancesAndStepControls: Array<{ name: string; value: string }>; residualAndErrorSummaries: string[]; rejectedStepAndIterationCounts: Array<{ kind: string; count: number }>; convergenceAidRecords: Array<{ aid: string; disclosed: true; signoffImpact: "none" | "requires_study" | "diagnostic_only" | "invalid" }>; warningAndLogClassifications: Array<{ code: string; severity: "info" | "warning" | "error"; excerptDigest: string }>; skippedOrInvalidPointIds: string[]; retryRelationshipRefs: string[]; credibilityImpact: "credible" | "limited" | "diagnostic_only" | "invalid"; deterministicDigest: string }
export interface WaveformSignal { signalId: string; semanticObjectId: string; name: string; unit: string; values: number[]; deterministicDigest: string }
export interface WaveformArtifact { waveformArtifactId: string; runId: string; immutableArtifactDigest: string; formatAndSchema: "sirkit.waveform.v1"; axis: { semanticName: string; unit: string; values: number[] }; signals: WaveformSignal[]; rawOrDerivedState: "authoritative_raw" | "lossless_normalized" | "display_derived"; parentArtifactRefs: string[]; compressionAndDownsamplingMetadata?: { method: string; sourcePointCount: number; resultPointCount: number; authoritativeForMeasurement: false }; retentionAndLicensePolicy: string; validationState: "valid" | "invalid" | "resource_limit"; deterministicDigest: string }
export interface SimulationMeasurementResult { measurementResultId: string; runId: string; measurementDefinitionId: string; measuredValueOrInterval?: { value?: number; minimum?: number; maximum?: number }; units: string; eventAndWindowWitness: Array<{ axis: number; value: number; label: string }>; numericUncertainty: { absolute: number; relative: number; method: string }; dataResolutionAdequacy: "adequate" | "inadequate" | "unknown"; resultState: "valid" | "indeterminate_numeric" | "invalid_data" | "unsupported" | "not_evaluated"; provenanceArtifactRefs: string[]; deterministicDigest: string }
export interface SimulationAssertionResult { assertionResultId: string; runId: string; assertionDefinitionId: string; requirementId: string; applicableScenarioCorner: string; expectedConstraint: SimulationAssertionDefinition["comparatorAndAllowedDomain"]; actualMeasurementRefs: string[]; marginOrViolationMagnitude?: number; numericIndeterminacyBand: { lower: number; upper: number }; assertionState: SimulationAssertionState; evidenceAndWaveformWitnessRefs: string[]; deterministicDigest: string }
export interface SimulationRun { runId: string; campaignId: string; requiredInstanceId: string; testbenchRevisionId: string; scenarioId: string; providerRevisionId: string; executionEnvironmentId: string; netlistLoweringManifestId: string; exactModelBindingIds: string[]; analysisPlanId: string; numericSettingsDigest: string; seed?: number; attemptLineage: SimulationAttempt[]; startedAt: string; completedAt?: string; processStatus: ProcessState; convergenceDiagnosticId: string; waveformArtifactIds: string[]; measurementResultIds: string[]; assertionResultIds: string[]; runState: "planned" | "completed" | "failed" | "nonconverged" | "unsupported" | "not_evaluated"; reproducibilityDigest: string; deterministicDigest: string }

export interface SimulationCoverageMatrix { coverageMatrixId: string; problemRevisionId: string; denominatorDigest: string; requiredInstanceIds: string[]; passedAssertionInstanceIds: string[]; failedAssertionInstanceIds: string[]; indeterminateAssertionInstanceIds: string[]; unsupportedModelOrAnalysisInstanceIds: string[]; notEvaluatedInstanceIds: string[]; nonconvergedInstanceIds: string[]; staleInstanceIds: string[]; notApplicableInstanceIds: string[]; modelCapabilityCoverage: Array<{ modelBindingId: string; state: ModelApplicabilityState }>; variantAndCornerCoverage: Array<{ variantId: string; required: number; completed: number; state: "complete" | "incomplete" }>; requirementCoverage: Array<{ requirementId: string; assertionIds: string[]; states: SimulationAssertionState[] }>; coverageDigest: string; deterministicDigest: string }
export interface SimulationFinding { findingId: string; stableFindingIdentity: string; problemAndGraphRevisionRefs: string[]; modelTestbenchRunAssertionRefs: string[]; variantScenarioCornerScope: string; findingKind: string; engineeringState: SimulationAssertionState | ModelApplicabilityState | ConvergenceState; severityAndReadinessImpact: "blocking" | "error" | "warning" | "information"; witnessArtifactAndMeasurementRefs: string[]; rootCauseClassification: "design_behavior" | "model_missing" | "model_invalid_or_out_of_scope" | "terminal_or_parameter_binding" | "testbench_definition" | "assertion_definition" | "numerical_or_convergence" | "provider_discrepancy" | "coverage_gap" | "stale_dependency" | "unknown"; rootCauseConfidence: number; upstreamFeedbackProposalRefs: string[]; lifecycleAndLineage: { state: "open" | "acknowledged" | "resolved" | "reopened" | "obsolete"; priorFindingIds: string[] }; deterministicDigest: string }
export interface SimulationCacheKey { cacheKeyId: string; dependencyDigests: Array<{ kind: string; digest: string }>; licenseAndAccessDigest: string; deterministicDigest: string }
export interface SimulationReproducibilityManifest { manifestId: string; graphDigest: string; modelDigests: string[]; bindingDigests: string[]; testbenchDigests: string[]; scenarioDigests: string[]; providerDigest: string; environmentDigest: string; loweringPolicyDigest: string; numericalPolicyDigest: string; assertionPolicyDigest: string; seedDigests: string[]; artifactDigests: string[]; networkRequired: false; deterministicDigest: string }
export interface SimulationCampaign { campaignId: string; problemRevisionId: string; semanticGraphRevisionId: string; circuitVerificationReportId: string; modelManifestId: string; testbenchRevisionIds: string[]; netlistLoweringManifestIds: string[]; runIds: string[]; coverageMatrixId: string; findingIds: string[]; analyticalCrossCheckResults: Array<{ checkId: string; state: "pass" | "fail" | "indeterminate" | "not_evaluated"; refs: string[] }>; crossSimulatorComparisonResults: Array<{ comparisonId: string; state: "pass" | "discrepancy" | "unsupported" | "not_evaluated"; refs: string[] }>; modelAndTestbenchLimitationSummary: string[]; requirementAssertionSummary: Array<{ requirementId: string; states: SimulationAssertionState[] }>; upstreamFeedbackIds: string[]; downstreamObligationIds: string[]; readinessState: SimulationReadinessState; approvalState: "unreviewed" | "approved" | "rejected"; reproducibilityManifestId: string; lifecycleState: SimulationLifecycle; createdBy: EngineeringActor; createdAt: string; deterministicDigest: string }
export interface SimulationReadinessReport { reportId: string; problemDigest: string; campaignId?: string; readinessState: SimulationReadinessState; graphDigest: string; modelRegistryDigest: string; testbenchRegistryDigest: string; providerDigest: string; environmentDigest: string; denominatorDigest?: string; coverageMatrixId?: string; blockingFindingIds: string[]; gapCodes: string[]; limitations: string[]; permittedActions: Array<"edit_upstream" | "review_model" | "review_testbench" | "run_diagnostic" | "run_authoritative_campaign" | "approve_for_CD11">; deterministicDigest: string }

export interface ModelSimulationProjectState { schemaVersion: typeof MODEL_SIMULATION_SCHEMA; projectId: string; branchId: string; problem: SimulationVerificationProblem; capabilityProfile: ModelSimulationCapabilityProfile; providers: SimulatorProviderDefinition[]; environments: SimulationExecutionEnvironment[]; modelRegistry: ModelRegistrySnapshot; terminalMappingCertificates: ModelTerminalMappingCertificate[]; modelBindings: SimulationModelBinding[]; applicabilityResults: ModelApplicabilityResult[]; testbenchRegistry: TestbenchRegistrySnapshot; obligations: SimulationObligation[]; scenarios: SimulationScenario[]; denominators: SimulationCoverageDenominator[]; netlistIrs: SimulationNetlistIR[]; loweringManifests: NetlistLoweringManifest[]; runs: SimulationRun[]; convergenceDiagnostics: SimulationConvergenceDiagnostic[]; waveformArtifacts: WaveformArtifact[]; measurementResults: SimulationMeasurementResult[]; assertionResults: SimulationAssertionResult[]; coverageMatrices: SimulationCoverageMatrix[]; findings: SimulationFinding[]; campaigns: SimulationCampaign[]; readinessReports: SimulationReadinessReport[]; reproducibilityManifests: SimulationReproducibilityManifest[]; transactionRecords: Array<{ transactionId: string; operation: string; actor: EngineeringActor; beforeDigest?: string; afterDigest: string; createdAt: string; integrityDigest: string }>; deterministicDigest: string }

export interface SimulationProblemInput { tenantId: string; branchId: string; schematicProject: SchematicProjectState; circuitVerificationProject: CircuitVerificationProjectState; modelRegistry: ModelRegistrySnapshot; testbenchRegistry: TestbenchRegistrySnapshot; providers: SimulatorProviderDefinition[]; capabilityProfile: ModelSimulationCapabilityProfile; requiredSimulationObligationIds: string[]; controlledAssumptionIds: string[]; actor: EngineeringActor; createdAt: string }
