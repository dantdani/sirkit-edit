import type { EngineeringActor } from "../engineering/types";
import { humanReviewer } from "./capability";
import { finalizeVerification, uniqueSorted, verificationId } from "./stable";
import type { CircuitFinding, FullOracleRun } from "./types";

export interface FindingWorkflowEvent {
  eventId: string;
  findingStableIdentity: string;
  from: CircuitFinding["workflowState"];
  to: CircuitFinding["workflowState"];
  actor: EngineeringActor;
  reason: string;
  evidenceRefs: string[];
  createdAt: string;
  physicalResultPreserved: true;
  deterministicDigest: string;
}

export function transitionFindingWorkflow(input: { finding: CircuitFinding; to: Exclude<CircuitFinding["workflowState"], "waived">; actor: EngineeringActor; reason: string; evidenceRefs?: string[]; createdAt: string; currentFullRun: FullOracleRun }): { finding: CircuitFinding; event: FindingWorkflowEvent } {
  if (input.currentFullRun.runKind !== "full" || input.finding.currentRunId !== input.currentFullRun.runId) throw new Error("CD9_FINDING_WORKFLOW_REQUIRES_CURRENT_FULL_RUN");
  if (!input.reason.trim()) throw new Error("CD9_FINDING_WORKFLOW_REASON_REQUIRED");
  if (["resolved", "obsolete"].includes(input.to) && (!humanReviewer(input.actor) || !(input.evidenceRefs?.length))) throw new Error("CD9_FINDING_RESOLUTION_REQUIRES_HUMAN_EVIDENCE");
  if (input.actor.actorKind === "ai" && !["acknowledged", "pending_external_review"].includes(input.to)) throw new Error("CD9_AI_WORKFLOW_AUTHORITY_DENIED");
  const eventBody = { findingStableIdentity: input.finding.stableIdentity, from: input.finding.workflowState, to: input.to, actor: structuredClone(input.actor), reason: input.reason.trim(), evidenceRefs: uniqueSorted(input.evidenceRefs ?? []), createdAt: input.createdAt, physicalResultPreserved: true as const };
  const event = finalizeVerification<FindingWorkflowEvent>({ ...eventBody, eventId: verificationId("finding-workflow", eventBody), deterministicDigest: "" });
  return { finding: finalizeVerification<CircuitFinding>({ ...input.finding, workflowState: input.to, evidenceRefs: uniqueSorted([...input.finding.evidenceRefs, ...event.evidenceRefs]), physicalResultPreserved: true, deterministicDigest: "" }), event };
}
