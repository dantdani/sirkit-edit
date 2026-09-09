import type { DrcRules, DrcRuleSet } from "../drc/types";
import type { RepairExecutionMode, RepairFix } from "./types";

const SAFETY_MINIMUM_FIELDS: Array<keyof DrcRuleSet> = [
  "clearanceNm",
  "minTrackWidthNm",
  "minViaOuterNm",
  "minViaDrillNm",
  "minAnnularRingNm",
  "minPthAnnularRingNm",
  "minHoleToHoleNm",
  "minEdgeClearanceNm",
  "minSilkPadClearanceNm",
  "minCourtyardClearanceNm",
];

export function validateNoRuleWeakening(before: DrcRules, after: DrcRules): string[] {
  const errors: string[] = [];
  for (const field of SAFETY_MINIMUM_FIELDS) {
    if (after.default[field] < before.default[field]) errors.push(`Repair policy forbids lowering default ${field}.`);
  }
  for (const [classId, beforeValues] of Object.entries(before.perClass)) {
    const afterValues = after.perClass[classId as keyof DrcRules["perClass"]];
    for (const field of SAFETY_MINIMUM_FIELDS) {
      const beforeValue = beforeValues?.[field];
      const afterValue = afterValues?.[field];
      if (beforeValue !== undefined && afterValue !== undefined && afterValue < beforeValue) {
        errors.push(`Repair policy forbids lowering ${classId} ${field}.`);
      }
    }
  }
  return errors;
}

export function canApplyWithoutApproval(fix: RepairFix, mode: RepairExecutionMode): boolean {
  if (mode === "review_every_change") return false;
  if (fix.requiresApproval) return false;
  if (fix.fixability === "manual_only" || fix.fixability === "requires_schematic_change") return false;
  if (mode === "safe_fixes_automatically") return fix.fixability === "safe_auto" || fix.fixability === "auto_with_reroute";
  return fix.fixability !== "requires_approval";
}
