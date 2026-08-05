import type { ConstraintQuantity, TypedRequirement } from "../constraints/types";
import type { EngineeringActor, ProjectRevision } from "../engineering/types";
import type { RequirementPredicate } from "../requirements/types";

export const INTERFACE_SCHEMA_VERSION = "sirkit.interface-planning.v1" as const;
export const INTERFACE_PROBLEM_SCHEMA_VERSION = "sirkit.interface-planning-problem.v1" as const;
export const INTERFACE_TRANSACTION_SCHEMA_VERSION = "sirkit.interface-planning-transaction.v1" as const;
export const INTERFACE_COMPILER_VERSION = "sirkit-interface-planning/1.0.0" as const;
export const INTERFACE_POLICY_REGISTRY_VERSION = "sirkit-interface-policy/1.0.0" as const;
export const PIN_SOLVER_POLICY_VERSION = "sirkit-pin-allocator/1.0.0" as const;

export type InterfaceEvidenceState = "pass" | "fail" | "warning" | "unknown" | "unsupported" | "not_evaluated" | "waived" | "stale" | "external_review_required";
export type InterfaceFeasibilityState = "feasible_at_logical_planning" | "feasible_for_exact_part_package" | "infeasible" | "incomplete_blocking_unknown" | "unsupported_capability" | "external_review_required" | "not_evaluated" | "stale";
export type InterfaceCapabilityState = "supported" | "unsupported" | "external_review_required" | "unknown";
export type ElectricalDirection = "input" | "output" | "bidirectional" | "open_drain" | "open_collector" | "tri_state" | "analog_input" | "analog_output" | "analog_bidirectional" | "differential_input" | "differential_output" | "differential_bidirectional" | "passive" | "clock_source" | "clock_sink" | "reset_source" | "reset_sink";
export type SignalingClass = "push_pull" | "open_drain" | "open_collector" | "tri_state" | "analog_single_ended" | "differential" | "clock" | "reset" | "passive" | "specialized";
export type SystemState = "pre_power" | "power_ramp" | "reset_asserted" | "boot_strap_sample" | "firmware_uninitialized" | "normal" | "sleep" | "update" | "debug" | "brownout" | "shutdown" | "fault" | "disconnected" | "hot_plug";

export interface InterfaceDiagnostic {
  diagnosticId: string;
  code: string;
  severity: "info" | "warning" | "error" | "blocking";
  message: string;
  objectRefs: string[];
  requirementRefs: string[];
  blocks: "logical_planning" | "exact_allocation" | "downstream_verification" | "release";
  derivation: string;
  nextAction: string;
  staleDependencyKeys: string[];
}

export interface Cd4UpstreamCompletionSignoff {
  schemaVersion: "sirkit.cd4-upstream-signoff.v1";
  cd1Verdict: "CD-1 COMPLETE";
  cd2Verdict: "CD-2 COMPLETE";
  cd3Verdict: "CD-3 COMPLETE";
  requirementsDigest: string;
  architectureProblemDigest: string;
  architectureCandidateDigest: string;
  architectureDecisionDigest: string;
  powerProblemDigest: string;
  powerCandidateDigest: string;
  powerDecisionDigest: string;
  approver: EngineeringActor;
  approvedAt: string;
  deterministicDigest: string;
}

export interface InterfaceCapabilityProfile {
  profileId: "embedded-mixed-signal-interface-v1";
  version: "1.0.0";
  supportedProtocolClasses: string[];
  supportedSignalingClasses: SignalingClass[];
  supportedTopologyClasses: InterfaceContract["topologyClass"][];
  externallyReviewedProtocolClasses: string[];
  limits: { maximumInterfaces: number; maximumEndpoints: number; maximumSignals: number; maximumResourceRequirements: number; maximumExactTerminals: number; maximumAllocationSearchNodes: number; maximumAlternatives: number };
  requiredEvaluatorRefs: string[];
  deterministicDigest: string;
}

export interface InterfacePlanningProblem {
  schemaVersion: typeof INTERFACE_PROBLEM_SCHEMA_VERSION;
  problemId: string;
  tenantId: string;
  projectId: string;
  branchId: string;
  requirementsPackageRevision: { packageId: string; revision: number; digest: string };
  systemArchitectureCandidateRevision: { candidateId: string; revision: number; problemDigest: string; candidateDigest: string; decisionDigest: string };
  powerArchitectureCandidateRevision: { candidateId: string; revision: number; problemDigest: string; candidateDigest: string; decisionDigest: string };
  upstreamSignoffDigest: string;
  capabilityProfileRevision: string;
  interfaceObligationIds: string[];
  architectureEndpointIds: string[];
  architectureFlowIds: string[];
  operatingModeIds: string[];
  voltageDomainIds: string[];
  clockResetPowerDependencyIds: string[];
  externalBoundaryIds: string[];
  activeAssumptionIds: string[];
  blockingUnknownIds: string[];
  policyRuleRegistryRevision: string;
  componentFactSnapshotRevision?: string;
  diagnostics: InterfaceDiagnostic[];
  createdBy: EngineeringActor;
  createdAt: string;
  deterministicDigest: string;
}

export type InterfaceProblemCompileResult =
  | { ok: true; problem: InterfacePlanningProblem; diagnostics: InterfaceDiagnostic[] }
  | { ok: false; verdict: "BLOCKED BY CD-1" | "BLOCKED BY CD-2" | "BLOCKED BY CD-3" | "CD-4 INCOMPLETE"; diagnostics: InterfaceDiagnostic[] };

export interface InterfaceContract {
  interfaceId: string;
  semanticRole: string;
  protocolClass: string;
  protocolVersionOrProfile?: string;
  topologyClass: "point_to_point" | "multidrop" | "multi_controller" | "daisy_chain" | "star" | "broadcast" | "external_proprietary";
  endpointIds: string[];
  signalGroupIds: string[];
  controllerTargetRoles: Array<{ endpointId: string; protocolRole: string }>;
  ownership: { hardwareOwner: string; firmwareOwner?: string; externalOwner?: string };
  modeApplicability: string[];
  bandwidthRateLatencyRequirements: TypedRequirement[];
  reliabilityErrorRequirements: TypedRequirement[];
  electricalDomainContractIds: string[];
  clockDependencyIds: string[];
  resetPowerStateDependencies: string[];
  protectionIsolationObligationIds: string[];
  firmwareHardwareContractIds: string[];
  requirementIds: string[];
  assumptionIds: string[];
  evidenceState: InterfaceEvidenceState;
  capabilityState: InterfaceCapabilityState;
  verificationObligationIds: string[];
}

export interface SignalEndpoint {
  endpointId: string;
  architectureBlockId: string;
  architecturePortId?: string;
  externalBoundaryId?: string;
  interfaceId: string;
  endpointRole: string;
  protocolRole?: string;
  electricalDirection: ElectricalDirection;
  dataFlowDirection?: "source" | "sink" | "bidirectional" | "none";
  signalingClass: SignalingClass;
  voltageDomainContractId: string;
  referenceReturnDomainId: string;
  powerAvailabilityConditions: string[];
  unpoweredBehaviorPolicy: "high_impedance" | "tolerant" | "must_not_be_driven" | "isolate" | "unknown";
  fanoutLoadRole: "driver" | "receiver" | "shared" | "passive" | "unknown";
  ownership: { hardwareOwner: string; configurationOwner?: string; externalOwner?: string };
  safeStateContractIds: string[];
  logicalPinResourceRequirementId?: string;
  selectedPartTerminalId?: string;
  requirementIds: string[];
  downstreamExpansionObligationIds: string[];
}

export interface LogicalSignal {
  signalId: string;
  interfaceId: string;
  semanticRole: string;
  aliases: string[];
  endpointIds: string[];
  directionSemantics: string;
  polarityOrLaneRole?: "positive" | "negative" | "lane" | "active_high" | "active_low";
  groupIds: string[];
  topologyPosition?: string;
  voltageDomainContractId: string;
  referenceIntentId: string;
  timingContractIds: string[];
  safeStateContractIds: string[];
  biasTerminationObligationIds: string[];
  protectionObligationIds: string[];
  requirementIds: string[];
  verificationObligationIds: string[];
}

export interface SignalGroup {
  groupId: string;
  groupKind: "bus" | "differential_pair" | "lane_group" | "source_synchronous" | "chip_select" | "address_data" | "debug_port" | "reset_domain" | "connector_contacts";
  memberSignalIds: string[];
  orderedMembership?: string[];
  requiredSamePeripheralInstance: boolean;
  polaritySwapPolicy?: "forbidden" | "allowed_if_supported" | "allowed";
  matchingSkewTopologyRequirements: string[];
  sharedClockOrStrobeId?: string;
  resourceCouplingConstraints: string[];
}

export interface VoltageDomainContract {
  domainId: string;
  semanticRole: string;
  railId: string;
  returnReferenceId: string;
  nominalVoltage?: ConstraintQuantity;
  operatingVoltageRange?: { min: ConstraintQuantity; max: ConstraintQuantity };
  powerStateConditions: string[];
  signalingStandardOrClass?: string;
  logicLevelContractId?: string;
  analogDomainContractId?: string;
  isolationDomainId?: string;
  toleranceNoiseAllocation?: string;
  requirementIds: string[];
  evidenceState: InterfaceEvidenceState;
  unknownFieldIds: string[];
}

export interface LogicLevelContract {
  logicContractId: string;
  driverOutputHighMinimum?: ConstraintQuantity;
  driverOutputLowMaximum?: ConstraintQuantity;
  receiverInputHighMinimum?: ConstraintQuantity;
  receiverInputLowMaximum?: ConstraintQuantity;
  inputAbsoluteRange?: { min: ConstraintQuantity; max: ConstraintQuantity };
  clampInjectionPolicy?: string;
  driveSinkCurrentConditions?: string[];
  hysteresis?: ConstraintQuantity;
  requiredNoiseMargin?: ConstraintQuantity;
  edgeRateClass?: string;
  openDrainPullDomainId?: string;
  unpoweredTolerancePolicy: SignalEndpoint["unpoweredBehaviorPolicy"];
  temperatureVoltageLoadConditions: string[];
  evidenceRefs: string[];
  unknownFieldIds: string[];
}

export interface AnalogSignalContract {
  analogContractId: string;
  sourceRange: { min: ConstraintQuantity; max: ConstraintQuantity } | null;
  receiverInputRange: { min: ConstraintQuantity; max: ConstraintQuantity } | null;
  commonModeRange?: { min: ConstraintQuantity; max: ConstraintQuantity };
  referenceId: string;
  sourceImpedanceEnvelope?: { min: ConstraintQuantity; max: ConstraintQuantity };
  loadImpedanceEnvelope?: { min: ConstraintQuantity; max: ConstraintQuantity };
  bandwidthOrSampleRate: ConstraintQuantity | null;
  accuracyResolutionRequirement?: TypedRequirement;
  noiseErrorBudget?: TypedRequirement;
  settlingAcquisitionRequirement?: TypedRequirement;
  biasLeakageProtectionLimits?: TypedRequirement;
  overrangeFaultPolicy: string;
  conditions: string[];
  evidenceState: InterfaceEvidenceState;
  verificationObligationIds: string[];
}

export interface DifferentialSignalContract {
  differentialContractId: string;
  pairOrLaneGroupId: string;
  positiveSignalId: string;
  negativeSignalId: string;
  signalingClass: string;
  direction: "input" | "output" | "bidirectional";
  differentialSwingEnvelope?: { min: ConstraintQuantity; max: ConstraintQuantity };
  commonModeEnvelope?: { min: ConstraintQuantity; max: ConstraintQuantity };
  terminationObligation?: string;
  targetDifferentialImpedance?: ConstraintQuantity;
  allowedSkew?: ConstraintQuantity;
  allowedLengthMismatch?: ConstraintQuantity;
  topologyClass: InterfaceContract["topologyClass"];
  couplingUncoupledIntent?: string;
  referenceReturnIntentId: string;
  polaritySwapPolicy: "forbidden" | "allowed_if_supported" | "allowed";
  evidenceState: InterfaceEvidenceState;
  PCBVerificationObligationIds: string[];
}

export interface SignalTimingContract {
  timingContractId: string;
  signalOrGroupId: string;
  timingKind: string;
  sourceClockId?: string;
  rateOrFrequencyRange?: { min: ConstraintQuantity; max: ConstraintQuantity };
  setupHoldRequirements?: TypedRequirement[];
  pulseWidthRequirements?: TypedRequirement[];
  latencyBudget?: TypedRequirement;
  propagationDelayBudget?: TypedRequirement;
  riseFallRequirement?: TypedRequirement;
  dutyCycle?: TypedRequirement;
  phaseSkewRelation?: string;
  jitterAllocation?: TypedRequirement;
  conditions: string[];
  evidenceState: InterfaceEvidenceState;
  downstreamVerificationObligations: string[];
}

export interface SafeStateContract {
  safeStateId: string;
  signalOrEndpointId: string;
  systemState: SystemState;
  sourcePowerState: string;
  receiverPowerState: string;
  requiredElectricalState: "high" | "low" | "high_impedance" | "passive_bias" | "disabled" | "defined_analog_range" | "unknown";
  activeDriverOwner?: string;
  passiveBiasObligation?: string;
  contentionPolicy: "forbidden" | "arbitrated" | "tolerated" | "not_applicable" | "unknown";
  backPowerPolicy: "forbidden" | "limited" | "isolated" | "tolerated" | "unknown";
  externalEffect: string;
  transitionOwner: string;
  deadlineOrOrderRequirement?: string;
  requirementIds: string[];
  verificationObligationIds: string[];
}

export interface ExternalConnectorContract {
  connectorContractId: string;
  boundaryId: string;
  semanticRole: string;
  matingSystemRole: string;
  contactRoleIds: string[];
  signalInterfaceIds: string[];
  powerGroundShieldChassisRoles: string[];
  keyingOrientationRequirement?: string;
  mateFirstLastBreakOrderRequirements: string[];
  hotPlugPolicy: "allowed" | "forbidden" | "controlled" | "unknown";
  cableTopologyAndLengthEnvelope?: string;
  externalVoltageReferenceDomain: string;
  unpoweredExternalDrivePolicy: SignalEndpoint["unpoweredBehaviorPolicy"];
  protectionThreatIds: string[];
  mechanicalEnvironmentRequirements: string[];
  unusedReservedContactPolicy: string;
  exactPartSelectionObligationId: string;
  requirementIds: string[];
  verificationObligationIds: string[];
}

export interface PinResourceRequirement {
  resourceRequirementId: string;
  endpointOrSignalIds: string[];
  requiredElectricalCapabilities: string[];
  requiredPeripheralClass?: string;
  requiredPeripheralInstanceCouplingGroup?: string;
  requiredChannelCapabilities: string[];
  requiredBankOrVoltageDomain?: string;
  requiredPackageBondoutClass?: string;
  requiredClockTimerRoute?: string;
  interruptWakeDMACapabilities: string[];
  analogCapabilities: string[];
  differentialLaneCapabilities: string[];
  bootDebugReservationPolicy: "reserved" | "reusable_after_boot" | "reusable_if_recovery_preserved" | "none";
  directionDrivePullRequirements: string[];
  simultaneousUseConditions: string[];
  modeVariantConditions: string[];
  hardSoftStrength: "hard" | "soft";
  requirementIds: string[];
  evidenceObligationIds: string[];
}

export interface VerifiedPinFunctionFact {
  factId: string;
  atomicPartRevisionId: string;
  exactPartId: string;
  packageRevisionId: string;
  atomicTerminalId: string;
  packagePadId: string;
  logicalPinFunctionId: string;
  alternateFunctionRouteId?: string;
  peripheralClass?: string;
  peripheralInstanceId?: string;
  channelOrLaneId?: string;
  bankId?: string;
  voltageDomainId?: string;
  electricalCapabilities: string[];
  channelCapabilities: string[];
  resourceClaims: string[];
  packageBonded: boolean;
  reserved: boolean;
  errataBlockIds: string[];
  evidenceRefs: string[];
  evidenceState: "source_backed" | "verified";
}

export interface PinFunctionFactSnapshot {
  snapshotId: string;
  atomicPartRevisionId: string;
  exactPartId: string;
  packageRevisionId: string;
  factIds: string[];
  facts: VerifiedPinFunctionFact[];
  errataRevisionIds: string[];
  sourceDigests: string[];
  capturedAt: string;
  deterministicDigest: string;
}

export interface PinFunctionAssignment {
  assignmentId: string;
  resourceRequirementId: string;
  signalEndpointId: string;
  atomicTerminalId: string;
  logicalPinFunctionId: string;
  alternateFunctionRouteId?: string;
  peripheralInstanceId?: string;
  channelOrLaneId?: string;
  bankId?: string;
  packagePadId: string;
  modeVariantConditions: string[];
  evidenceRefs: string[];
}

export interface PinFunctionAllocationProblem {
  allocationProblemId: string;
  interfacePlanningCandidateId: string;
  atomicPartRevisionId: string;
  packageRevisionId: string;
  pinFunctionFactSnapshotId: string;
  errataRevisionIds: string[];
  resourceRequirementIds: string[];
  requirements: PinResourceRequirement[];
  facts: VerifiedPinFunctionFact[];
  reservedTerminalIds: string[];
  fixedAssignments: Array<{ assignmentId: string; resourceRequirementId: string; factId: string }>;
  allowedAssignmentEdges: Array<{ resourceRequirementId: string; factId: string }>;
  peripheralResourceConstraints: Array<{ couplingGroupId: string; resourceRequirementIds: string[]; relation: "same_instance" | "distinct_instance" }>;
  bankDomainConstraints: Array<{ resourceRequirementId: string; allowedBankIds: string[]; requiredVoltageDomainId?: string }>;
  packageBondoutConstraints: string[];
  simultaneousUseConstraints: Array<{ constraintId: string; resourceRequirementIds: string[]; maximumActive: number }>;
  debugBootClockResetConstraints: Array<{ constraintId: string; resourceRequirementIds: string[]; preserveRecovery: boolean }>;
  PCBFeedbackConstraints: Array<{ constraintId: string; prohibitedTerminalIds: string[]; reason: string; evidenceState: InterfaceEvidenceState }>;
  solverPolicyRevision: string;
  deterministicDigest: string;
}

export interface AllocationConstraintResult { constraintId: string; state: InterfaceEvidenceState; explanation: string; objectRefs: string[]; }
export interface AllocationObjective { objectiveId: string; direction: "minimize" | "maximize"; rawValue: number | null; evidenceState: InterfaceEvidenceState; method: string; }
export interface AllocationUnsatCore { coreId: string; resourceRequirementIds: string[]; constraintIds: string[]; factIds: string[]; explanation: string; minimal: boolean; deterministicDigest: string; }

export interface PinFunctionAllocationCandidate {
  allocationCandidateId: string;
  allocationProblemId: string;
  assignmentRecords: PinFunctionAssignment[];
  peripheralInstanceSelections: Array<{ couplingGroupId: string; peripheralInstanceId: string }>;
  bankDomainAssignments: Array<{ resourceRequirementId: string; bankId: string; voltageDomainId?: string }>;
  sharedResourceAssignments: Array<{ resourceId: string; assignmentIds: string[] }>;
  debugBootRecoveryReservations: string[];
  hardConstraintResults: AllocationConstraintResult[];
  softObjectiveVector: AllocationObjective[];
  feasibilityState: "feasible_for_exact_part_package" | "infeasible" | "incomplete_blocking_unknown" | "resource_limit";
  unsatCores: AllocationUnsatCore[];
  alternativeCandidateIds: string[];
  downstreamPinClosureObligations: string[];
  searchCertificate: { exploredNodes: number; complete: boolean; canonicalVariableOrder: string[]; canonicalFactOrder: string[]; solverPolicyRevision: string };
  createdBy: EngineeringActor;
  createdAt: string;
  deterministicDigest: string;
}

export interface ClockNode {
  clockNodeId: string;
  nodeKind: "source" | "oscillator_role" | "mux" | "divider" | "multiplier" | "gate" | "distribution" | "consumer";
  semanticRole: string;
  sourceRoleOrSelectedPartId?: string;
  frequencyRange: { min: ConstraintQuantity; max: ConstraintQuantity } | null;
  accuracyTolerance?: ConstraintQuantity;
  jitterPhaseNoiseBudget?: TypedRequirement;
  dutyCycle?: TypedRequirement;
  startupLockTimeRequirement?: TypedRequirement;
  modeAvailability: string[];
  powerRailDependencies: string[];
  resetDependencies: string[];
  fanoutLoadObligations: string[];
  derivationRelation?: { numerator: number; denominator: number };
  evidenceState: InterfaceEvidenceState;
  unknownFieldIds: string[];
}
export interface ClockEdge { edgeId: string; fromClockNodeId: string; toClockNodeId: string; relation: "source" | "derive" | "mux" | "gate"; numerator?: number; denominator?: number; modeConditions: string[]; }
export interface ClockPlan { clockPlanId: string; clockSourceIds: string[]; clockNodes: ClockNode[]; clockEdges: ClockEdge[]; clockDomainIds: string[]; consumerIds: string[]; CDCObligationIds: string[]; startupAvailabilityDependencies: string[]; feasibilityState: InterfaceFeasibilityState; requirementIds: string[]; verificationObligationIds: string[]; deterministicDigest: string; }

export interface ResetDependencyEdge { edgeId: string; fromId: string; toId: string; relation: "rail_valid_before_release" | "clock_valid_before_release" | "asserts" | "deasserts" | "synchronizes" | "firmware_action"; }
export interface ResetPlan { resetPlanId: string; resetSourceIds: string[]; resetDomainIds: string[]; resetConsumerIds: string[]; dependencyEdges: ResetDependencyEdge[]; assertionPolicies: string[]; deassertionPolicies: string[]; synchronizationObligations: string[]; powerClockDependencies: string[]; watchdogBrownoutDebugSoftwareSources: string[]; timeoutRecoveryPolicies: string[]; feasibilityState: InterfaceFeasibilityState; CD3HandoffIds: string[]; CD11HandoffIds: string[]; verificationObligationIds: string[]; deterministicDigest: string; }
export interface BootConfigurationPlan { bootPlanId: string; bootModeIds: string[]; defaultBootModeId: string; strapSignalIds: string[]; strapSamplingConditions: string[]; passiveBiasObligationIds: string[]; externalDriveRestrictions: string[]; runtimeReusePolicies: Array<{ signalId: string; allowed: boolean; requiredOrder: string[]; exactAllocationConstraintId: string }>; bootSourceRoles: string[]; authenticationSecurityPolicyRefs: string[]; fallbackRecoveryTransitions: string[]; manufacturingProgrammingModes: string[]; failureLockoutRisks: string[]; requirementIds: string[]; verificationObligationIds: string[]; deterministicDigest: string; }
export interface ProgrammingDebugRecoveryPlan { planId: string; programmableDeviceRoleIds: string[]; programmingInterfaceIds: string[]; debugInterfaceIds: string[]; consoleInterfaceIds: string[]; updateTransportIds: string[]; recoveryPathIds: string[]; factoryProvisioningPathIds: string[]; physicalAccessObligations: string[]; powerClockResetDependencies: string[]; pinReservationRequirements: string[]; securityLifecyclePolicyRefs: string[]; authenticationAuthorizationObligations: string[]; lockDisableRecoveryPolicies: string[]; testPointConnectorObligations: string[]; firmwareOwnerIds: string[]; externalToolRequirements: string[]; verificationObligationIds: string[]; deterministicDigest: string; }
export interface FirmwareHardwareInterfaceContract { contractId: string; interfaceOrResourceIds: string[]; firmwareOwner: string; hardwareOwner: string; initializationOrder: string[]; pinmuxConfigurationObligations: string[]; clockEnableConfiguration: string[]; directionDrivePullConfiguration: string[]; peripheralModeParameters: string[]; interruptDMARouting: string[]; safeTransitionRequirements: string[]; timeoutErrorRecovery: string[]; lowPowerWakeBehavior: string[]; bootloaderApplicationOwnership: string[]; diagnosticTelemetry: string[]; generatedArtifactTargets: string[]; verificationObligationIds: string[]; }

export interface InterfaceCoverage { coverageId: string; requirementOrObligationId: string; candidateId: string; interfaceElementIds: string[]; coverageState: "covered_at_planning" | "partially_covered" | "uncovered" | "blocked" | "unsupported" | "external_review_required" | "not_applicable"; rationale: string; remainingEvidenceObligationIds: string[]; blockerIds: string[]; }
export interface InterfacePlanningRisk { riskId: string; candidateId: string; category: string; statement: string; causeIds: string[]; affectedRequirementIds: string[]; affectedElementIds: string[]; likelihoodBand?: "low" | "medium" | "high" | "unknown"; impactBand: "low" | "medium" | "high" | "critical"; uncertainty: string; mitigationState: "identified" | "mitigation_planned" | "mitigation_implemented" | "mitigation_verified" | "accepted" | "closed"; plannedMitigationIds: string[]; verificationOwner: string; acceptanceAuthority?: string; staleDependencies: string[]; }
export interface InterfaceHardGate { gateId: string; category: string; state: InterfaceEvidenceState; hard: boolean; explanation: string; objectRefs: string[]; requirementRefs: string[]; }
export interface InterfaceObjective { objectiveId: string; label: string; direction: "minimize" | "maximize"; rawValue: number | null; range: { min: number; max: number } | null; unit: string; evidenceState: InterfaceEvidenceState; method: string; confidence: "low" | "medium" | "high"; }
export interface SignalConstraintProposal { proposalId: string; sourceElementIds: string[]; targetStage: "CD-5" | "CD-7" | "CD-8" | "CD-9" | "CD-10" | "CD-11" | "PCB-6" | "PCB-7" | "PCB-8"; semanticConstraintKind: string; roleGroupDomainRelationshipTargets: string[]; quantityOrCondition?: RequirementPredicate | null; enforcementConsumer?: string | null; enforcementState: "not_enforced" | "partially_supported"; provenance: { problemDigest: string; candidateDigest?: string; ruleRefs: string[] }; activationState: "proposed_not_active"; invalidationDependencies: string[]; }
export interface InterfaceHandoff { handoffId: string; targetStage: "CD-3" | "CD-5" | "CD-6" | "CD-7" | "CD-8" | "CD-9" | "CD-10" | "CD-11" | "CD-12" | "CD-13" | "PCB-6" | "PCB-7" | "PCB-8"; kind: string; sourceElementIds: string[]; requirementIds: string[]; contract: Record<string, unknown>; state: "planned_not_verified" | "feedback_required"; invalidationDependencies: string[]; }

export interface InterfaceContractSet {
  contractSetId: string; revision: number; problemId: string; interfaces: InterfaceContract[]; endpoints: SignalEndpoint[]; signals: LogicalSignal[]; signalGroups: SignalGroup[]; voltageDomains: VoltageDomainContract[]; logicLevels: LogicLevelContract[]; analogContracts: AnalogSignalContract[]; differentialContracts: DifferentialSignalContract[]; timingContracts: SignalTimingContract[]; safeStates: SafeStateContract[]; connectorContracts: ExternalConnectorContract[]; pinResourceRequirements: PinResourceRequirement[]; allocationProblemTemplateIds: string[]; clockPlans: ClockPlan[]; resetPlans: ResetPlan[]; bootPlans: BootConfigurationPlan[]; programmingDebugPlans: ProgrammingDebugRecoveryPlan[]; firmwareHardwareContracts: FirmwareHardwareInterfaceContract[]; coverage: InterfaceCoverage[]; risks: InterfacePlanningRisk[]; constraintProposals: SignalConstraintProposal[]; handoffs: InterfaceHandoff[]; feasibilityState: InterfaceFeasibilityState; hardGateResults: InterfaceHardGate[]; decisionState: "unselected" | "selected" | "rejected"; approvalState: "proposed" | "approved" | "rejected"; staleState: "current" | "stale"; deterministicDigest: string;
}

export interface InterfacePlanningCandidate {
  schemaVersion: typeof INTERFACE_SCHEMA_VERSION; candidateId: string; parentCandidateId?: string; projectId: string; branchId: string; revision: number; problemId: string; problemDigest: string; contractSet: InterfaceContractSet; protocolTopologyChoiceIds: string[]; translationIsolationRoleIds: string[]; resourcePartitionChoiceIds: string[]; clockResetBootChoiceIds: string[]; abstractAllocationState: "closed" | "incomplete" | "infeasible"; exactAllocationCandidates: PinFunctionAllocationCandidate[]; feasibilityState: InterfaceFeasibilityState; objectiveVector: InterfaceObjective[]; paretoState: "unknown" | "pareto" | "dominated"; risks: InterfacePlanningRisk[]; decisionState: "unselected" | "selected" | "rejected"; createdBy: EngineeringActor; createdAt: string; structuralSignature: string; deterministicDigest: string;
}

export interface InterfacePlanningDecision { decisionId: string; problemDigest: string; candidateId: string; candidateDigest: string; candidateIdsCompared: string[]; exactPartAllocationCandidateIds: string[]; hardGateSummary: Array<{ candidateId: string; passed: boolean }>; objectiveVectors: Array<{ candidateId: string; objectives: InterfaceObjective[] }>; paretoCandidateIds: string[]; sensitivitySummary: string[]; rejectedReasons: Array<{ candidateId: string; reason: string }>; unresolvedRiskIds: string[]; approver: EngineeringActor; rationale: string; approvalState: "approved"; approvedAt: string; invalidationDependencies: string[]; deterministicDigest: string; }

export interface InterfaceProjectState { schemaVersion: typeof INTERFACE_SCHEMA_VERSION; projectId: string; branchId: string; upstreamSignoff: Cd4UpstreamCompletionSignoff; problem: InterfacePlanningProblem; candidates: InterfacePlanningCandidate[]; selection: InterfacePlanningDecision | null; transactionRecords: InterfaceTransactionRecord[]; deterministicDigest: string; }
export type InterfaceOperation = { operationId: string; kind: "add_candidate"; candidate: InterfacePlanningCandidate } | { operationId: string; kind: "remove_candidate"; candidateId: string; expectedDigest: string } | { operationId: string; kind: "replace_candidate"; candidate: InterfacePlanningCandidate; expectedDigest: string } | { operationId: string; kind: "select_candidate"; decision: InterfacePlanningDecision } | { operationId: string; kind: "clear_selection"; expectedDecisionDigest: string } | { operationId: string; kind: "mark_stale"; candidateId: string; expectedDigest: string; dependencyKeys: string[] } | { operationId: string; kind: "attach_exact_allocation"; candidateId: string; expectedDigest: string; allocation: PinFunctionAllocationCandidate };
export interface InterfaceTransaction { schemaVersion: typeof INTERFACE_TRANSACTION_SCHEMA_VERSION; transactionId: string; projectId: string; branchId: string; actor: EngineeringActor; reason: string; baseStateDigest: string; baseProjectRevision?: ProjectRevision; idempotencyKey: string; operations: InterfaceOperation[]; createdAt: string; deterministicDigest: string; }
export interface InterfaceTransactionRecord { transaction: InterfaceTransaction; state: "accepted" | "rejected" | "conflict" | "undone"; resultStateDigest?: string; diagnostics: string[]; inverseOperations: InterfaceOperation[]; integrityDigest: string; }

export interface InterfaceProblemCompileInput { tenantId: string; branchId: string; requirementsPackage: import("../requirements/types").DesignRequirementsPackage; architectureState: import("../architecture/types").ArchitectureProjectState; powerState: import("../power/types").PowerProjectState; upstreamSignoff: Cd4UpstreamCompletionSignoff; capabilityProfile: InterfaceCapabilityProfile; policyRuleRegistryRevision: string; componentFactSnapshotRevision?: string; actor: EngineeringActor; createdAt: string; }

export interface ProtocolPattern { patternId: string; version: string; protocolClass: string; title: string; supportedTopologies: InterfaceContract["topologyClass"][]; requiredEndpointRoles: string[]; minimumEndpointCount: number; maximumEndpointCount: number; signalRoles: Array<{ role: string; signalingClass: SignalingClass; required: boolean }>; requiredCompanionRoles: string[]; resourceRequirements: string[]; safeStateObligations: string[]; firmwareObligations: string[]; PCBObligations: string[]; capabilityState: "supported" | "external_review_required"; evidenceRefs: string[]; deterministicDigest: string; }

