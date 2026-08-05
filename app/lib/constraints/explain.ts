import type { ConstraintProgram } from "./types";

export interface EffectiveRuleExplanation {
  targetId: string;
  programHash: string;
  selectorSnapshots: ConstraintProgram["targetSnapshots"];
  matchedRules: ConstraintProgram["effectiveRules"];
  conflicts: ConstraintProgram["conflicts"];
  coverage: ConstraintProgram["coverage"];
  summary: string;
}

/** One canonical explanation service for UI, API, AI, and debug tooling. */
export function explainEffectiveRules(program: ConstraintProgram, targetId: string): EffectiveRuleExplanation {
  const matchedRules = program.effectiveRules.filter((rule) => rule.targetId === targetId).sort((a, b) => a.id.localeCompare(b.id));
  const constraintIds = new Set(matchedRules.flatMap((rule) => rule.contributingConstraintIds));
  const selectorSnapshots = program.targetSnapshots.filter((snapshot) => snapshot.targetIds.includes(targetId) || constraintIds.has(snapshot.constraintId)).sort((a, b) => a.constraintId.localeCompare(b.constraintId));
  const conflicts = program.conflicts.filter((conflict) => conflict.targetId === targetId).sort((a, b) => a.id.localeCompare(b.id));
  const coverage = program.coverage.filter((item) => item.targetIds.includes(targetId) || constraintIds.has(item.constraintId)).sort((a, b) => a.constraintId.localeCompare(b.constraintId));
  return {
    targetId,
    programHash: program.programHash,
    selectorSnapshots,
    matchedRules,
    conflicts,
    coverage,
    summary: conflicts.length > 0
      ? `${conflicts.length} unresolved conflict(s) affect ${targetId}.`
      : matchedRules.length === 0
        ? `No active compiled rule targets ${targetId}.`
        : `${matchedRules.length} effective rule(s) target ${targetId}; ${coverage.filter((item) => item.support === "unsupported" || item.support === "unknown" || item.support === "declarative_only").length} lack complete enforcement.`,
  };
}

