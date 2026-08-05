import { calculationDigest, calculationId } from "./stable";
import type { CalculationDecision, CircuitCalculationProblem, CircuitCalculationReport } from "./types";
import type { EngineeringActor } from "../engineering/types";

export function createCalculationDecision(input: { report: CircuitCalculationReport; problem: CircuitCalculationProblem; state: CalculationDecision["state"]; actor: EngineeringActor; rationale: string; createdAt: string }): CalculationDecision {
  if (!input.rationale.trim()) throw new Error("CD7_DECISION_RATIONALE_REQUIRED");
  if (input.state === "approved" && (input.actor.actorKind !== "human" || !["reviewer", "project_admin"].includes(input.actor.role))) throw new Error("CD7_DECISION_HUMAN_APPROVAL_REQUIRED");
  if (input.report.problemRevisionId !== input.problem.problemId || input.report.lifecycleState !== "calculation_complete_pending_review") throw new Error("CD7_DECISION_REPORT_NOT_CURRENT");
  const base: Omit<CalculationDecision, "decisionId" | "deterministicDigest"> = { reportId: input.report.reportId, reportDigest: input.report.deterministicDigest, problemDigest: input.problem.deterministicDigest, state: input.state, approver: input.state === "approved" ? structuredClone(input.actor) : undefined, rationale: input.rationale.trim(), createdAt: input.createdAt };
  const withId = { ...base, decisionId: calculationId("calculation-decision", base) };
  return { ...withId, deterministicDigest: calculationDigest(withId) };
}
