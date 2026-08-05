import type { PcbSyncPlanLifecycle } from "./types";

const allowed: Record<PcbSyncPlanLifecycle, PcbSyncPlanLifecycle[]> = {
  draft: ["validated", "aborted", "failed"],
  validated: ["applicable", "stale", "aborted", "failed"],
  applicable: ["applying", "stale", "aborted", "failed"],
  stale: ["aborted"],
  applying: ["applied", "applicable", "failed"],
  applied: [],
  aborted: [],
  failed: [],
};

export function assertPcbSyncPlanTransition(from: PcbSyncPlanLifecycle, to: PcbSyncPlanLifecycle): void {
  if (!allowed[from].includes(to)) throw new Error(`PS_PLAN_LIFECYCLE_TRANSITION_INVALID:${from}:${to}`);
}

