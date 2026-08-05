export type Stage10RolloutPhase = "phase0_inventory" | "phase1_transactions" | "phase2_shadow" | "phase3_selective_reads" | "phase4_local_durability" | "phase5_server_single_writer" | "phase6_collaboration" | "phase7_offline_rebase" | "phase8_cutover";
export type IncrementalEvaluatorFlag = "electrical_truth" | "drc" | "constraints" | "readiness";

export interface Stage10RolloutPolicy {
  policyVersion: "stage10-rollout/1.0.0";
  phase: Stage10RolloutPhase;
  semanticTransactions: boolean;
  shadowVerification: boolean;
  selectiveIncrementalReads: Partial<Record<IncrementalEvaluatorFlag, boolean>>;
  durableLocalStore: boolean;
  authoritativeServer: boolean;
  collaboration: boolean;
  offlineRebase: boolean;
  fullOracleFallback: true;
  circuitBreakers: Partial<Record<IncrementalEvaluatorFlag, { open: boolean; reason: string; openedAt: string }>>;
}

export const SAFE_STAGE10_ROLLOUT: Stage10RolloutPolicy = { policyVersion: "stage10-rollout/1.0.0", phase: "phase2_shadow", semanticTransactions: true, shadowVerification: true, selectiveIncrementalReads: { electrical_truth: false, drc: false, constraints: false, readiness: false }, durableLocalStore: false, authoritativeServer: false, collaboration: false, offlineRebase: false, fullOracleFallback: true, circuitBreakers: {} };

export function canUseIncrementalRead(policy: Stage10RolloutPolicy, evaluator: IncrementalEvaluatorFlag): { allowed: boolean; reason: string } {
  if (policy.circuitBreakers[evaluator]?.open) return { allowed: false, reason: `CIRCUIT_BREAKER:${policy.circuitBreakers[evaluator]!.reason}` }; if (!policy.selectiveIncrementalReads[evaluator]) return { allowed: false, reason: "INCREMENTAL_READ_NOT_CUT_OVER" }; return { allowed: true, reason: "SELECTIVE_READ_ENABLED_WITH_FULL_FALLBACK" };
}

export function openCircuitBreaker(policy: Stage10RolloutPolicy, evaluator: IncrementalEvaluatorFlag, reason: string): Stage10RolloutPolicy { return { ...policy, selectiveIncrementalReads: { ...policy.selectiveIncrementalReads, [evaluator]: false }, circuitBreakers: { ...policy.circuitBreakers, [evaluator]: { open: true, reason, openedAt: new Date().toISOString() } } }; }
