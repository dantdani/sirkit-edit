export type MappingStage4FeatureState = "off" | "observe" | "opt_in" | "authoritative_supported_profile";
export const MAPPING_STAGE4_FLAG = "SIRKIT_MAPPING_STAGE4" as const;
export function mappingStage4FeatureState(environment: Record<string, string | undefined> = process.env): MappingStage4FeatureState { const value = environment[MAPPING_STAGE4_FLAG]?.trim().toLowerCase(); return value === "observe" || value === "opt_in" || value === "authoritative_supported_profile" ? value : "off"; }
