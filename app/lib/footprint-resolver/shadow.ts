import type { FootprintResolutionResult } from "./types";

export const FOOTPRINT_RESOLVER_SHADOW_FLAG = "SIRKIT_FOOTPRINT_RESOLVER_SHADOW" as const;

export type ResolutionShadowCategory = "equivalent_resolution" | "legacy_resolved_new_unresolved_missing_data" | "legacy_default_new_requires_policy" | "legacy_hint_new_unapproved" | "legacy_asset_new_asset_mismatch" | "legacy_unresolved_new_resolved" | "both_unresolved_equivalent_reason" | "both_unresolved_different_reason" | "comparison_unavailable" | "legacy_error" | "new_error";

export interface LegacyResolutionObservation {
  status: "resolved" | "unresolved" | "error";
  footprint: string | null;
  source: "atomic-approved" | "hint" | "heuristic" | "default" | "manual" | "none" | "error";
  guessedOrDefaulted: boolean;
  reasonCode?: string;
}

export interface FootprintResolutionShadowComparison {
  schemaVersion: "sirkit.footprint-resolution-shadow.v1";
  category: ResolutionShadowCategory;
  risk: "none" | "low" | "medium" | "high";
  legacy: LegacyResolutionObservation;
  resolverStatus: FootprintResolutionResult["status"] | "error";
  resolverFootprint: string | null;
  technicallyEquivalent: boolean | null;
  reasonCode: string;
  productionBehaviorChanged: false;
  resolverDecisionDigest?: string;
}

export function compareLegacyResolution(legacy: LegacyResolutionObservation, result: FootprintResolutionResult | null): FootprintResolutionShadowComparison {
  const resolverFootprint = result?.resolvedBinding ? `${result.resolvedBinding.footprintAsset.libraryNickname}:${result.resolvedBinding.footprintAsset.footprintName}` : null;
  let category: ResolutionShadowCategory;
  let risk: FootprintResolutionShadowComparison["risk"] = "low";
  let equivalent: boolean | null = null;
  let reasonCode: string;
  if (!result) { category = "new_error"; risk = "medium"; reasonCode = "FR_SHADOW_NEW_ERROR"; }
  else if (legacy.status === "error") { category = "legacy_error"; risk = "medium"; reasonCode = "FR_SHADOW_LEGACY_ERROR"; }
  else if (legacy.status === "resolved" && result.status === "resolved") {
    equivalent = legacy.footprint === resolverFootprint;
    category = equivalent ? "equivalent_resolution" : "legacy_asset_new_asset_mismatch";
    risk = equivalent ? "none" : "high";
    reasonCode = equivalent ? "FR_SHADOW_EQUIVALENT" : "FR_SHADOW_ASSET_MISMATCH";
  } else if (legacy.status === "resolved" && result.status !== "resolved") {
    if (legacy.source === "default") { category = "legacy_default_new_requires_policy"; risk = "high"; reasonCode = "FR_SHADOW_LEGACY_DEFAULT"; }
    else if (legacy.source === "hint") { category = "legacy_hint_new_unapproved"; risk = "medium"; reasonCode = "FR_SHADOW_HINT_UNAPPROVED"; }
    else { category = "legacy_resolved_new_unresolved_missing_data"; risk = "high"; reasonCode = "FR_SHADOW_NEW_BLOCKED"; }
  } else if (legacy.status === "unresolved" && result.status === "resolved") { category = "legacy_unresolved_new_resolved"; risk = "medium"; reasonCode = "FR_SHADOW_NEW_RESOLUTION"; }
  else if (legacy.status === "unresolved" && result.status !== "resolved") {
    const equivalentReason = legacy.reasonCode && result.blockers.some((blocker) => blocker.code === legacy.reasonCode);
    category = equivalentReason ? "both_unresolved_equivalent_reason" : "both_unresolved_different_reason";
    risk = equivalentReason ? "none" : "low";
    reasonCode = equivalentReason ? "FR_SHADOW_BOTH_UNRESOLVED_EQUIVALENT" : "FR_SHADOW_BOTH_UNRESOLVED_DIFFERENT";
  } else { category = "comparison_unavailable"; risk = "low"; reasonCode = "FR_SHADOW_COMPARISON_UNAVAILABLE"; }
  return { schemaVersion: "sirkit.footprint-resolution-shadow.v1", category, risk, legacy: structuredClone(legacy), resolverStatus: result?.status ?? "error", resolverFootprint, technicallyEquivalent: equivalent, reasonCode, productionBehaviorChanged: false, ...(result ? { resolverDecisionDigest: result.decisionDigest } : {}) };
}

export async function withFootprintResolverShadow<T>(input: {
  production: () => Promise<T>;
  observeLegacy: (result: T) => LegacyResolutionObservation;
  resolve: (signal: AbortSignal) => Promise<FootprintResolutionResult>;
  enabled: boolean;
  timeoutMs: number;
  observe?: (comparison: FootprintResolutionShadowComparison) => void;
}): Promise<T> {
  const productionResult = await input.production();
  if (!input.enabled) return productionResult;
  const legacy = input.observeLegacy(productionResult);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resolution: FootprintResolutionResult | null = null;
  try {
    resolution = await Promise.race([
      input.resolve(controller.signal),
      new Promise<null>((resolve) => { timer = setTimeout(() => { controller.abort(); resolve(null); }, input.timeoutMs); }),
    ]);
  } catch { resolution = null; }
  finally { if (timer) clearTimeout(timer); }
  input.observe?.(compareLegacyResolution(legacy, resolution));
  return productionResult;
}

export function footprintResolverShadowEnabled(environment: Record<string, string | undefined> = process.env): boolean {
  return environment[FOOTPRINT_RESOLVER_SHADOW_FLAG]?.trim().toLowerCase() === "true";
}
