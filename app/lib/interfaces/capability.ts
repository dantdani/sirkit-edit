import { interfaceDigest } from "./stable";
import type { Cd4UpstreamCompletionSignoff, InterfaceCapabilityProfile } from "./types";

const baseProfile: Omit<InterfaceCapabilityProfile, "deterministicDigest"> = {
  profileId: "embedded-mixed-signal-interface-v1",
  version: "1.0.0",
  supportedProtocolClasses: ["custom_typed_transport", "discrete_control", "analog_channel", "clock_distribution", "reset_distribution", "debug_access", "i2c", "spi", "uart", "can", "usb2"],
  supportedSignalingClasses: ["push_pull", "open_drain", "open_collector", "tri_state", "analog_single_ended", "differential", "clock", "reset", "passive", "specialized"],
  supportedTopologyClasses: ["point_to_point", "multidrop", "multi_controller", "daisy_chain", "star", "broadcast", "external_proprietary"],
  externallyReviewedProtocolClasses: ["ethernet", "lvds", "mipi", "pcie", "serdes", "ddr", "rf", "proprietary_high_speed"],
  limits: { maximumInterfaces: 256, maximumEndpoints: 2048, maximumSignals: 2048, maximumResourceRequirements: 2048, maximumExactTerminals: 2048, maximumAllocationSearchNodes: 250_000, maximumAlternatives: 8 },
  requiredEvaluatorRefs: ["sirkit-interface-graph/1.0.0", "sirkit-electrical-compatibility/1.0.0", "sirkit-pin-allocator/1.0.0", "sirkit-clock-reset-dependency/1.0.0"],
};

export const EMBEDDED_MIXED_SIGNAL_INTERFACE_PROFILE_V1: InterfaceCapabilityProfile = { ...baseProfile, deterministicDigest: interfaceDigest(baseProfile) };

export function validateInterfaceCapabilityProfile(profile: InterfaceCapabilityProfile): string[] {
  const errors: string[] = [];
  if (profile.profileId !== "embedded-mixed-signal-interface-v1" || profile.version !== "1.0.0") errors.push("INTERFACE_PROFILE_IDENTITY_INVALID");
  if (profile.deterministicDigest !== interfaceDigest({ ...profile, deterministicDigest: undefined })) errors.push("INTERFACE_PROFILE_DIGEST_MISMATCH");
  if (Object.values(profile.limits).some((value) => !Number.isInteger(value) || value < 1)) errors.push("INTERFACE_PROFILE_LIMIT_INVALID");
  if (!profile.supportedProtocolClasses.length || !profile.requiredEvaluatorRefs.length) errors.push("INTERFACE_PROFILE_CAPABILITY_EMPTY");
  return errors.sort();
}

export function createCd4UpstreamCompletionSignoff(input: Omit<Cd4UpstreamCompletionSignoff, "schemaVersion" | "deterministicDigest">): Cd4UpstreamCompletionSignoff {
  if (input.approver.actorKind !== "human" || !["reviewer", "project_admin"].includes(input.approver.role)) throw new Error("CD4_UPSTREAM_SIGNOFF_UNAUTHORIZED");
  const base = { schemaVersion: "sirkit.cd4-upstream-signoff.v1" as const, ...structuredClone(input) };
  return { ...base, deterministicDigest: interfaceDigest(base) };
}

export function validateCd4UpstreamCompletionSignoff(signoff: Cd4UpstreamCompletionSignoff): string[] {
  const errors: string[] = [];
  if (signoff.schemaVersion !== "sirkit.cd4-upstream-signoff.v1" || signoff.cd1Verdict !== "CD-1 COMPLETE" || signoff.cd2Verdict !== "CD-2 COMPLETE" || signoff.cd3Verdict !== "CD-3 COMPLETE") errors.push("CD4_UPSTREAM_COMPLETION_VERDICT_MISSING");
  if (signoff.approver.actorKind !== "human" || !["reviewer", "project_admin"].includes(signoff.approver.role)) errors.push("CD4_UPSTREAM_SIGNOFF_UNAUTHORIZED");
  if (!Number.isFinite(Date.parse(signoff.approvedAt))) errors.push("CD4_UPSTREAM_SIGNOFF_DATE_INVALID");
  if ([signoff.requirementsDigest, signoff.architectureProblemDigest, signoff.architectureCandidateDigest, signoff.architectureDecisionDigest, signoff.powerProblemDigest, signoff.powerCandidateDigest, signoff.powerDecisionDigest].some((value) => !value.trim())) errors.push("CD4_UPSTREAM_DIGEST_CHAIN_INCOMPLETE");
  if (signoff.deterministicDigest !== interfaceDigest({ ...signoff, deterministicDigest: undefined })) errors.push("CD4_UPSTREAM_SIGNOFF_DIGEST_MISMATCH");
  return errors.sort();
}

