import type { PcbSyncPreflightResult } from "./types";

export type PcbSyncFeatureState = "off" | "observe" | "opt_in" | "authoritative_safe_profile";
export const PCB_SYNC_STAGE3_FLAG = "SIRKIT_PCB_SYNC_STAGE3" as const;

export function pcbSyncFeatureState(environment: Record<string, string | undefined> = process.env): PcbSyncFeatureState {
  const value = environment[PCB_SYNC_STAGE3_FLAG]?.trim().toLowerCase();
  return value === "observe" || value === "opt_in" || value === "authoritative_safe_profile" ? value : "off";
}

export type PcbSyncLegacyComparisonCategory = "equivalent_ready" | "legacy_would_guess_new_blocks" | "legacy_partial_new_atomic_block" | "legacy_ready_new_board_risk" | "legacy_blocked_new_ready" | "both_blocked" | "comparison_unavailable";

export interface PcbSyncLegacyObservation { status: "ready" | "blocked" | "partial" | "error"; guessedOrDefaulted: boolean; mutationStarted: boolean; unresolvedCount: number }
export interface PcbSyncLegacyComparison { category: PcbSyncLegacyComparisonCategory; risk: "none" | "low" | "medium" | "high"; legacy: PcbSyncLegacyObservation; stage3Status: PcbSyncPreflightResult["status"]; stage3BoardChanged: false; productionBehaviorChanged: false }

export function compareLegacyPcbSync(legacy: PcbSyncLegacyObservation, stage3: PcbSyncPreflightResult): PcbSyncLegacyComparison {
  const newReady = stage3.status === "ready_no_changes" || stage3.status === "ready_to_apply";
  let category: PcbSyncLegacyComparisonCategory, risk: PcbSyncLegacyComparison["risk"];
  if (legacy.guessedOrDefaulted && !newReady) { category = "legacy_would_guess_new_blocks"; risk = "high"; }
  else if (legacy.mutationStarted && !newReady) { category = "legacy_partial_new_atomic_block"; risk = "high"; }
  else if (legacy.status === "ready" && stage3.status === "blocked_board_risk") { category = "legacy_ready_new_board_risk"; risk = "high"; }
  else if (legacy.status === "blocked" && newReady) { category = "legacy_blocked_new_ready"; risk = "medium"; }
  else if (legacy.status === "ready" && newReady) { category = "equivalent_ready"; risk = "none"; }
  else if (legacy.status === "blocked" && !newReady) { category = "both_blocked"; risk = "low"; }
  else { category = "comparison_unavailable"; risk = "medium"; }
  return { category, risk, legacy: structuredClone(legacy), stage3Status: stage3.status, stage3BoardChanged: false, productionBehaviorChanged: false };
}

export class ForbiddenLegacyResolverGuard {
  private invocations = 0;
  invoke(): never { this.invocations++; throw new Error("PS_FORBIDDEN_LEGACY_RESOLVER_INVOCATION"); }
  count(): number { return this.invocations; }
}

