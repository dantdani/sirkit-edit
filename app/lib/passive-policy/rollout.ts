export type PassivePolicyFeatureState = "off" | "observe" | "opt_in" | "authoritative_supported_profile";
export const PASSIVE_POLICY_FEATURE_FLAG = "SIRKIT_PASSIVE_POLICY_STAGE5" as const;
export function passivePolicyFeatureState(environment: Record<string, string | undefined> = process.env): PassivePolicyFeatureState { const value = environment[PASSIVE_POLICY_FEATURE_FLAG]?.trim().toLowerCase(); return value === "observe" || value === "opt_in" || value === "authoritative_supported_profile" ? value : "off"; }
