import { calculationDigest, calculationId } from "./stable";
import type { CalculationFeedbackRequest } from "./types";

export function createCalculationFeedback(input: Omit<CalculationFeedbackRequest, "feedbackId" | "deterministicDigest" | "lifecycleState"> & { feedbackId?: string; lifecycleState?: CalculationFeedbackRequest["lifecycleState"] }): CalculationFeedbackRequest {
  if (!input.unsatisfiedConstraintIds.length && !["unknown", "unsupported", "external_review_required", "resource_limit", "stale", "conflict"].includes(input.provenFailureOrUnknown)) throw new Error("CD7_FEEDBACK_HAS_NO_PROVEN_BASIS");
  const base = structuredClone({ ...input, feedbackId: input.feedbackId ?? calculationId("calculation-feedback", input), lifecycleState: input.lifecycleState ?? "proposed", affectedRoleAssignmentIds: [...new Set(input.affectedRoleAssignmentIds)].sort(), affectedRequirementConstraintIds: [...new Set(input.affectedRequirementConstraintIds)].sort(), unsatisfiedConstraintIds: [...new Set(input.unsatisfiedConstraintIds)].sort(), prohibitedLocalWorkaround: [...new Set(input.prohibitedLocalWorkaround)].sort() });
  return { ...base, deterministicDigest: calculationDigest(base) };
}
