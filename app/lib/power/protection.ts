import type { PowerCapabilityProfile, PowerRail, PowerSourceEnvelope, ProtectionPolicy, ProtectionThreat } from "./types";
import { powerId } from "./stable";

export function discoverProtectionThreats(problemDigest: string, sources: readonly PowerSourceEnvelope[], rails: readonly PowerRail[], profile: PowerCapabilityProfile): ProtectionThreat[] {
  const threats: ProtectionThreat[] = [];
  for (const source of sources) {
    const kinds: ProtectionThreat["threatKind"][] = ["reverse_polarity", "overcurrent", "short_circuit", "overvoltage", "undervoltage", "reverse_current", ...(source.hotPlugPolicy !== "not_applicable" ? ["hot_plug_inrush" as const] : []), ...(source.sourceKind === "test_programming_source" ? ["back_power" as const] : [])];
    for (const threatKind of kinds) {
      const supported = profile.supportedThreatKinds.includes(threatKind); const threatId = powerId("power-threat", { problemDigest, boundary: source.boundaryId, threatKind });
      threats.push({ threatId, threatKind, boundaryId: source.boundaryId, sourceOrAggressor: source.sourceId, exposedAssetIds: rails.filter((rail) => rail.sourcePathIds.some((id) => id === source.sourceId)).map((rail) => rail.railId), couplingOrFaultPath: `${source.sourceId} -> ${source.boundaryId} -> source-rooted rail path`, operatingOrFaultEnvelope: threatKind === "overvoltage" || threatKind === "undervoltage" ? source.voltageRange : threatKind === "overcurrent" ? source.continuousCurrentRange : null, severityClass: threatKind === "short_circuit" || threatKind === "overvoltage" ? "high" : "medium", requirementIds: [...source.requirementIds], evidenceState: supported ? "not_evaluated" : "unsupported", unknownFieldIds: threatKind === "overvoltage" || threatKind === "undervoltage" || threatKind === "overcurrent" ? [] : [`${threatId}:fault-waveform-or-energy`], capabilityState: supported ? "supported" : "unsupported" });
    }
  }
  return threats.sort((a, b) => a.threatId.localeCompare(b.threatId));
}

export function planProtectionPolicies(problemDigest: string, threats: readonly ProtectionThreat[], strategy: "centralized" | "distributed" = "centralized"): ProtectionPolicy[] {
  return threats.map((threat) => {
    const actions: ProtectionPolicy["abstractActionRoles"] = threat.threatKind === "reverse_polarity" || threat.threatKind === "reverse_current" || threat.threatKind === "back_power" || threat.threatKind === "source_contention" ? ["reverse_block"] : threat.threatKind === "overcurrent" || threat.threatKind === "short_circuit" ? ["limit_interrupt", "supervisory_shutdown"] : threat.threatKind === "overvoltage" ? ["divert_clamp", "limit_interrupt"] : threat.threatKind === "undervoltage" ? ["supervisory_shutdown"] : threat.threatKind === "hot_plug_inrush" ? ["limit_interrupt"] : ["fault_containment"];
    const boundaryZone = powerId("protection-zone", { boundary: threat.boundaryId });
    const assetZones = strategy === "distributed" ? threat.exposedAssetIds.map((assetId) => powerId("protection-zone", { boundary: threat.boundaryId, assetId })) : [];
    const defenseZoneIds = [...new Set([boundaryZone, ...assetZones])].sort();
    const policyId = powerId("protection-policy", { problemDigest, threat: threat.threatId, actions, strategy, defenseZoneIds }); return { policyId, threatIds: [threat.threatId], protectedAssetIds: [...threat.exposedAssetIds], defenseZoneIds, abstractActionRoles: actions, coordinationOrder: strategy === "distributed" ? ["1:boundary-defense", "2:branch-defense", ...actions.map((action, index) => `${index + 3}:${action}`)] : actions.map((action, index) => `${index + 1}:${action}`), passThroughOperatingEnvelope: threat.operatingOrFaultEnvelope, clampLimitInterruptTarget: null, energyHandlingObligation: threat.unknownFieldIds.length ? powerId("protection-energy-obligation", threat.threatId) : null, currentLimitingObligation: ["overcurrent", "short_circuit", "hot_plug_inrush"].includes(threat.threatKind) ? powerId("protection-current-obligation", threat.threatId) : null, failOpenClosedSafePolicy: "Exact safe failure behavior must be selected and verified by CD-5/CD-6/CD-7.", downstreamWithstandObligations: [powerId("downstream-withstand", { threat: threat.threatId, stage: "CD-6/CD-7" })], sideEffectRisks: ["normal-path voltage drop unknown", "leakage/capacitance/heat unknown", "fault return injection requires later physical proof"], capabilityState: threat.capabilityState, verificationObligationIds: [powerId("protection-verification", { policyId, stage: "CD-7/CD-9/CD-10" })], requirementIds: [...threat.requirementIds], assumptionIds: [] };
  }).sort((a, b) => a.policyId.localeCompare(b.policyId));
}

export function validateProtectionCoverage(threats: readonly ProtectionThreat[], policies: readonly ProtectionPolicy[]): string[] {
  const errors: string[] = []; const ids = new Set(threats.map((item) => item.threatId));
  for (const threat of threats) { const matches = policies.filter((item) => item.threatIds.includes(threat.threatId)); if (!matches.length) errors.push(`THREAT_UNCOVERED:${threat.threatId}`); if (matches.some((item) => !item.protectedAssetIds.length)) errors.push(`PROTECTION_ASSET_MISSING:${threat.threatId}`); }
  for (const policy of policies) if (policy.threatIds.some((id) => !ids.has(id)) || !policy.abstractActionRoles.length || !policy.coordinationOrder.length) errors.push(`PROTECTION_POLICY_INVALID:${policy.policyId}`);
  return errors.sort();
}
