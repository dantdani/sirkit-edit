import { deepFreezeBinding } from "../physical-binding/stable";
import { PCB_SYNC_POLICY_SCHEMA_VERSION, type PcbSyncPolicy, type PcbSyncRiskClass } from "./types";

const allowedRisks: PcbSyncRiskClass[] = ["none", "metadata_only", "unrouted_structural"];

export const DEFAULT_PCB_SYNC_POLICY: Readonly<PcbSyncPolicy> = deepFreezeBinding({
  schemaVersion: PCB_SYNC_POLICY_SCHEMA_VERSION,
  policyId: "sirkit.safe-pcb-sync",
  version: "1.0.0",
  supportedBoardFormat: "sirkit-json-pcb/1",
  allowedAutomaticRisks: allowedRisks,
  allowedOperationKinds: [
    "create_board", "add_component_instance", "preserve_component_instance", "update_component_metadata",
    "update_reference_designator", "update_value_display", "add_net", "preserve_net",
    "rename_net_identity_preserving", "assign_pad_to_net", "update_unrouted_net_membership",
    "remove_unrouted_net", "remove_unrouted_component", "replace_unrouted_footprint", "mark_dnp_or_excluded", "no_op",
  ],
  maxComponents: 4_096,
  maxNets: 32_768,
  maxOperations: 131_072,
  maxTraceSteps: 8_192,
  lockTimeoutMs: 2_000,
  planTtlMs: 15 * 60 * 1_000,
  acceptedMappingVerifierVersions: ["sirkit.atomic-mapping/1", "physical-binding-validator/1", "sirkit.mapping-verifier/4.0.0", "stage3-test-mapper/1"],
  requireHumanApply: true,
  blockRoutedStructuralChanges: true,
  requireLosslessKnownBoardModel: true,
});

export function validatePcbSyncPolicy(policy: PcbSyncPolicy): string[] {
  const errors: string[] = [];
  if (policy.schemaVersion !== PCB_SYNC_POLICY_SCHEMA_VERSION || policy.policyId !== "sirkit.safe-pcb-sync" || policy.version !== "1.0.0") errors.push("PS_POLICY_UNSUPPORTED");
  if (policy.supportedBoardFormat !== "sirkit-json-pcb/1") errors.push("PS_BOARD_FORMAT_POLICY_UNSUPPORTED");
  if (policy.allowedAutomaticRisks.some((risk) => risk === "copper_affecting" || risk === "constraint_affecting" || risk === "destructive" || risk === "unsupported_unknown")) errors.push("PS_POLICY_STAGE8_BOUNDARY_WEAKENED");
  if (policy.blockRoutedStructuralChanges !== true || policy.requireLosslessKnownBoardModel !== true) errors.push("PS_POLICY_MANDATORY_GATE_WEAKENED");
  if (policy.maxComponents < 1 || policy.maxComponents > 4_096 || policy.maxNets < 1 || policy.maxNets > 32_768 || policy.maxOperations < 1 || policy.maxOperations > 131_072 || policy.maxTraceSteps < 128 || policy.maxTraceSteps > 8_192) errors.push("PS_POLICY_LIMIT_INVALID");
  if (policy.lockTimeoutMs < 50 || policy.lockTimeoutMs > 30_000 || policy.planTtlMs < 1_000 || policy.planTtlMs > 86_400_000) errors.push("PS_POLICY_TIME_LIMIT_INVALID");
  if (!policy.acceptedMappingVerifierVersions.length) errors.push("PS_POLICY_MAPPING_VERIFIER_MISSING");
  return [...new Set(errors)].sort();
}

export function resolvePcbSyncPolicy(id: string, version: string): PcbSyncPolicy {
  if (id !== DEFAULT_PCB_SYNC_POLICY.policyId || version !== DEFAULT_PCB_SYNC_POLICY.version) throw new Error("PS_POLICY_UNSUPPORTED");
  return structuredClone(DEFAULT_PCB_SYNC_POLICY) as PcbSyncPolicy;
}
