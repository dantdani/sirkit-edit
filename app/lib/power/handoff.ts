import { powerId } from "./stable";
import type { PowerArchitectureCandidate, PowerConstraintProposal, PowerHandoffObligation } from "./types";

export function buildPowerHandoffs(candidate: Pick<PowerArchitectureCandidate, "problemDigest" | "rails" | "demands" | "transferEdges" | "groundReturnDomains" | "returnPathIntents" | "isolationBoundaries" | "sequenceMachines" | "threats" | "protectionPolicies" | "transientSupportRequirements">): PowerHandoffObligation[] {
  const stages: Array<{ targetStage: PowerHandoffObligation["targetStage"]; kind: string; sourceElementIds: string[]; contract: Record<string, unknown> }> = [
    { targetStage: "CD-4", kind: "power_interface_reset_boot_contracts", sourceElementIds: [...candidate.rails.map((item) => item.railId), ...candidate.sequenceMachines.map((item) => item.machineId), ...candidate.isolationBoundaries.map((item) => item.boundaryId)], contract: { requirements: ["rail/return identity and ranges", "unpowered drive/back-power policy", "enable/power-good/reset dependencies", "isolation signal crossings"] } },
    { targetStage: "CD-5", kind: "power_recipe_requests", sourceElementIds: candidate.transferEdges.map((item) => item.edgeId), contract: { abstractOnly: true, roles: ["conversion", "distribution", "reverse blocking", "protection", "supervision", "support"] } },
    { targetStage: "CD-6", kind: "power_role_component_criteria", sourceElementIds: [...candidate.transferEdges.map((item) => item.edgeId), ...candidate.protectionPolicies.map((item) => item.policyId)], contract: { exactPartsForbiddenHere: true, poweredPinExpansionRequired: true } },
    { targetStage: "CD-7", kind: "power_calculation_corner_obligations", sourceElementIds: [...candidate.rails.map((item) => item.railId), ...candidate.protectionPolicies.map((item) => item.policyId), ...candidate.transientSupportRequirements.map((item) => item.supportRequirementId)], contract: { exactValuesDeferred: true, corners: ["source", "load", "temperature", "tolerance", "fault"] } },
    { targetStage: "CD-8", kind: "authoritative_power_graph_expansion", sourceElementIds: [...candidate.rails.map((item) => item.railId), ...candidate.demands.map((item) => item.demandId), ...candidate.groundReturnDomains.map((item) => item.domainId)], contract: { pinsNetsComponentsCreatedOnlyAtCD8: true, exactPoweredPinClosureRequired: true } },
    { targetStage: "CD-9", kind: "power_application_verification", sourceElementIds: [...candidate.rails.map((item) => item.railId), ...candidate.protectionPolicies.map((item) => item.policyId)], contract: { architectureEvidenceDoesNotPass: true } },
    { targetStage: "CD-10", kind: "power_behavior_simulation", sourceElementIds: [...candidate.sequenceMachines.map((item) => item.machineId), ...candidate.threats.map((item) => item.threatId)], contract: { modelsAndCornersRequired: true } },
    { targetStage: "CD-11", kind: "firmware_test_bringup_power", sourceElementIds: candidate.sequenceMachines.map((item) => item.machineId), contract: { sequencingBrownoutTelemetryRecovery: true } },
    { targetStage: "CD-12", kind: "power_critical_release_evidence", sourceElementIds: candidate.protectionPolicies.map((item) => item.policyId), contract: { ratingsFreshnessAndAlternateRisk: true } },
    { targetStage: "CD-13", kind: "power_orchestration_invalidation", sourceElementIds: [candidate.problemDigest], contract: { controlledCandidateRevisionRequired: true } },
    { targetStage: "PCB-4", kind: "power_ground_plane_physical_feedback", sourceElementIds: candidate.groundReturnDomains.map((item) => item.domainId), contract: { geometryNotCreated: true, physicalContinuityNotVerified: true } },
    { targetStage: "PCB-6", kind: "typed_power_constraints", sourceElementIds: [...candidate.returnPathIntents.map((item) => item.returnIntentId), ...candidate.transientSupportRequirements.map((item) => item.supportRequirementId)], contract: { proposedNotActive: true } },
    { targetStage: "PCB-7", kind: "power_placement_feedback", sourceElementIds: candidate.transferEdges.map((item) => item.edgeId), contract: { converterProtectionSupportGrouping: true } },
    { targetStage: "PCB-8", kind: "power_routing_return_feedback", sourceElementIds: candidate.returnPathIntents.map((item) => item.returnIntentId), contract: { returnContinuityAndCurrentCapacity: true } },
    { targetStage: "PCB-9", kind: "power_benchmark_feedback", sourceElementIds: [candidate.problemDigest], contract: { correctnessFirst: true } },
    { targetStage: "PCB-10", kind: "power_incremental_evidence", sourceElementIds: [candidate.problemDigest], contract: { exactInvalidationRequired: true } },
  ];
  return stages.map((item) => ({ obligationId: powerId("power-handoff", { problem: candidate.problemDigest, stage: item.targetStage, kind: item.kind }), targetStage: item.targetStage, kind: item.kind, sourceElementIds: [...item.sourceElementIds].sort(), requirementIds: [], contract: item.contract, state: "planned_not_verified" as const, invalidationDependencyKeys: [...item.sourceElementIds].map((id) => `power:${id}`).sort() })).sort((a, b) => a.obligationId.localeCompare(b.obligationId));
}

export function buildPowerConstraintProposals(candidate: Pick<PowerArchitectureCandidate, "problemDigest" | "rails" | "groundReturnDomains" | "returnPathIntents" | "protectionPolicies" | "transientSupportRequirements" | "isolationBoundaries">): PowerConstraintProposal[] {
  const specs: Array<{ kind: PowerConstraintProposal["semanticConstraintKind"]; ids: string[] }> = [
    { kind: "rail_return_domain", ids: candidate.rails.flatMap((rail) => [rail.railId, rail.groundReturnDomainId]) },
    { kind: "current_loop", ids: candidate.returnPathIntents.map((item) => item.returnIntentId) },
    { kind: "aggressor_victim", ids: candidate.returnPathIntents.filter((item) => item.sharedImpedanceSensitivity === "high").map((item) => item.returnIntentId) },
    { kind: "decoupling_relationship", ids: candidate.transientSupportRequirements.map((item) => item.supportRequirementId) },
    { kind: "protection_order", ids: candidate.protectionPolicies.map((item) => item.policyId) },
    { kind: "isolation_no_crossing", ids: candidate.isolationBoundaries.map((item) => item.boundaryId) },
  ];
  return specs.filter((item) => item.ids.length).map((item) => ({ proposalId: powerId("power-constraint-proposal", { problem: candidate.problemDigest, kind: item.kind, ids: item.ids.sort() }), sourceElementIds: [...item.ids].sort(), targetStage: "PCB-6" as const, semanticConstraintKind: item.kind, roleDomainRelationshipTargets: [...item.ids].sort(), quantityOrCondition: null, enforcementConsumer: null, enforcementState: "not_enforced" as const, provenance: { problemDigest: candidate.problemDigest, ruleRefs: ["sirkit-power-to-stage6/1.0.0"] }, activationState: "proposed_not_active" as const, invalidationDependencies: item.ids.map((id) => `power:${id}`).sort() })).sort((a, b) => a.proposalId.localeCompare(b.proposalId));
}
