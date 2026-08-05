export type AssignmentQueueFeatureState = "off" | "observe" | "opt_in";
export const ASSIGNMENT_QUEUE_FEATURE_FLAG = "SIRKIT_ASSIGNMENT_QUEUE_STAGE6" as const;
export function assignmentQueueFeatureState(env: Record<string, string | undefined> = process.env): AssignmentQueueFeatureState { const value = env[ASSIGNMENT_QUEUE_FEATURE_FLAG]?.trim().toLowerCase(); return value === "observe" || value === "opt_in" ? value : "off"; }
