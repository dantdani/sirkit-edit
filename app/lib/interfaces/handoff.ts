import { interfaceId } from "./stable";
import type { InterfaceContractSet, InterfaceHandoff, SignalConstraintProposal } from "./types";

export function buildInterfaceHandoffs(problemDigest: string, set: Pick<InterfaceContractSet, "interfaces" | "signals" | "signalGroups" | "voltageDomains" | "safeStates" | "pinResourceRequirements" | "clockPlans" | "resetPlans" | "bootPlans" | "programmingDebugPlans" | "firmwareHardwareContracts">): InterfaceHandoff[] {
  const rows: Array<{ targetStage: InterfaceHandoff["targetStage"]; kind: string; ids: string[]; state?: InterfaceHandoff["state"]; contract: Record<string, unknown> }> = [
    { targetStage: "CD-3", kind: "interface_power_feedback", ids: [...set.voltageDomains.map((item) => item.domainId), ...set.safeStates.map((item) => item.safeStateId), ...set.resetPlans.map((item) => item.resetPlanId)], state: "feedback_required", contract: { loadProtectionSequenceReview: true, automaticMutationForbidden: true } },
    { targetStage: "CD-5", kind: "interface_recipe_roles", ids: set.interfaces.map((item) => item.interfaceId), contract: { abstractRolesOnly: ["translator", "isolator", "transceiver", "bias", "termination", "connector", "protection"], exactPartsAndValuesForbidden: true } },
    { targetStage: "CD-6", kind: "interface_part_capability_criteria", ids: set.pinResourceRequirements.map((item) => item.resourceRequirementId), contract: { exactAtomicPartAndPackageFactsRequiredForAllocation: true, familyOrPeripheralCountInsufficient: true } },
    { targetStage: "CD-7", kind: "interface_calculation_obligations", ids: [...set.signals.map((item) => item.signalId), ...set.clockPlans.map((item) => item.clockPlanId)], contract: { thresholdsPullTimingLoadingClockCornersRequired: true, exactValuesDeferred: true } },
    { targetStage: "CD-8", kind: "authoritative_signal_graph_and_pin_closure", ids: [...set.signals.map((item) => item.signalId), ...set.pinResourceRequirements.map((item) => item.resourceRequirementId)], contract: { netsCreatedOnlyAtCD8: true, exactTerminalSymbolPadClosureRequired: true } },
    { targetStage: "CD-9", kind: "interface_application_verification", ids: set.interfaces.map((item) => item.interfaceId), contract: { planningEvidenceDoesNotPassCircuitOrProtocolVerification: true } },
    { targetStage: "CD-10", kind: "interface_behavior_simulation", ids: [...set.clockPlans.map((item) => item.clockPlanId), ...set.resetPlans.map((item) => item.resetPlanId), ...set.bootPlans.map((item) => item.bootPlanId)], contract: { modelsCornersStartupBrownoutFaultRequired: true } },
    { targetStage: "CD-11", kind: "firmware_test_bringup_contracts", ids: [...set.firmwareHardwareContracts.map((item) => item.contractId), ...set.programmingDebugPlans.map((item) => item.planId)], contract: { manifestIsNotFirmwareEvidence: true, initializationRecoveryProductionTestRequired: true } },
    { targetStage: "CD-12", kind: "interface_release_evidence", ids: set.interfaces.map((item) => item.interfaceId), contract: { componentErrataFirmwareProtocolComplianceEvidenceRequired: true } },
    { targetStage: "CD-13", kind: "interface_orchestration_invalidation", ids: [problemDigest], contract: { controlledCandidateRevisionRequired: true } },
    { targetStage: "PCB-6", kind: "typed_signal_constraints", ids: [...set.signals.map((item) => item.signalId), ...set.signalGroups.map((item) => item.groupId)], contract: { proposedNotActive: true, achievedPhysicalBehaviorFalse: true } },
    { targetStage: "PCB-7", kind: "interface_placement_feedback", ids: set.interfaces.map((item) => item.interfaceId), contract: { connectorProtectionClockAnalogGroupingFeedback: true } },
    { targetStage: "PCB-8", kind: "interface_routing_feedback", ids: set.signalGroups.map((item) => item.groupId), contract: { escapeLayerTopologyReturnImpedanceLengthSkewFeedback: true, achievedRoutingFalse: true } },
  ];
  return rows.map((row) => ({ handoffId: interfaceId("interface-handoff", { problemDigest, target: row.targetStage, kind: row.kind, ids: row.ids.sort() }), targetStage: row.targetStage, kind: row.kind, sourceElementIds: [...row.ids].sort(), requirementIds: [], contract: row.contract, state: row.state ?? "planned_not_verified", invalidationDependencies: row.ids.map((id) => `interface:${id}`).sort() })).sort((a, b) => a.handoffId.localeCompare(b.handoffId));
}

export function buildSignalConstraintProposals(problemDigest: string, set: Pick<InterfaceContractSet, "signals" | "signalGroups" | "voltageDomains" | "safeStates" | "connectorContracts" | "programmingDebugPlans">): SignalConstraintProposal[] {
  const specs: Array<{ kind: string; ids: string[]; stage: SignalConstraintProposal["targetStage"] }> = [
    { kind: "interface_group_membership", ids: set.signalGroups.map((item) => item.groupId), stage: "PCB-6" },
    { kind: "differential_pair_polarity", ids: set.signalGroups.filter((item) => item.groupKind === "differential_pair").map((item) => item.groupId), stage: "PCB-6" },
    { kind: "signal_return_reference", ids: set.signals.flatMap((item) => [item.signalId, item.referenceIntentId]), stage: "PCB-6" },
    { kind: "voltage_domain_crossing", ids: set.voltageDomains.map((item) => item.domainId), stage: "CD-5" },
    { kind: "safe_state_bias", ids: set.safeStates.map((item) => item.safeStateId), stage: "CD-7" },
    { kind: "connector_protection_order", ids: set.connectorContracts.map((item) => item.connectorContractId), stage: "PCB-7" },
    { kind: "programming_debug_test_access", ids: set.programmingDebugPlans.map((item) => item.planId), stage: "PCB-7" },
  ];
  return specs.filter((item) => item.ids.length).map((item): SignalConstraintProposal => ({ proposalId: interfaceId("signal-constraint-proposal", { problemDigest, kind: item.kind, ids: item.ids.sort() }), sourceElementIds: [...item.ids].sort(), targetStage: item.stage, semanticConstraintKind: item.kind, roleGroupDomainRelationshipTargets: [...item.ids].sort(), quantityOrCondition: null, enforcementConsumer: null, enforcementState: "not_enforced", provenance: { problemDigest, ruleRefs: ["sirkit-interface-to-stage6/1.0.0"] }, activationState: "proposed_not_active", invalidationDependencies: item.ids.map((id) => `interface:${id}`).sort() })).sort((a, b) => a.proposalId.localeCompare(b.proposalId));
}
